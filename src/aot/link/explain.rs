use super::accesses::{Access, Accesses, Kind, Verdict};
use super::typedness::Typedness;
use crate::id::LayoutId;
use crate::ir::{Def, Func, FuncKind, Op, Program, Term, func_flags};
use bun_sema::check::{Assertion, Checker, CompilerDiagnostic, Derivation, Explaining, MissingLayout, ObjectOrigin, Place, Program as Checked, UntypedOrigin, compute_ecma_line_starts};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::messages;
use bun_sema::program::FileId;
use bun_sema::resolve::get_relative_path_from_directory;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};

const FUNCTIONS_PER_TASK: usize = 256;
const MAX_ROWS_SHOWN: usize = 20;
const MAX_STEPS_SHOWN: usize = 4;
const MAX_STEPS_FOLLOWED: usize = 8;
const MAX_CROSSINGS_SHOWN: usize = 8;
const MAX_NAMES_SHOWN: usize = 8;
const MAX_EXAMPLES_KEPT: usize = 100;
const MAX_EXAMPLES_SHOWN: usize = 3;
const MAX_SOURCE_SHOWN: usize = 120;
const MAX_LOOP_DEPTH_COUNTED: u32 = 2;
const WEIGHT_OF_A_LOOP: f64 = 8.0;
const WEIGHT_AT_START: f64 = 1.0 / 64.0;
const PAGE: &str = "https://bun.com/docs/bundler/aot-explain";

fn successors(term: &Term, mut visit: impl FnMut(usize)) {
    match term {
        Term::Jump(target) => visit(target.block.idx()),
        Term::Branch { then, otherwise, .. } => {
            visit(then.block.idx());
            visit(otherwise.block.idx());
        }
        Term::Switch { cases, default, .. } => {
            for case in cases {
                visit(case.1.block.idx());
            }
            visit(default.block.idx());
        }
        Term::Invoke { normal, unwind } => {
            visit(normal.block.idx());
            visit(unwind.block.idx());
        }
        Term::Throw { unwind: Some(unwind), .. } => visit(unwind.block.idx()),
        Term::Throw { unwind: None, .. } | Term::Return(_) | Term::Unreachable => {}
    }
}

fn loop_depths(func: &Func) -> Vec<u32> {
    let count = func.blocks.len();
    let mut depths = vec![0; count];
    if count == 0 {
        return depths;
    }
    let mut following: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut preceding: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (block, contents) in func.blocks.iter().enumerate() {
        if let Some(term) = &contents.term {
            successors(term, |next| {
                following[block].push(next);
                preceding[next].push(block);
            });
        }
    }
    let (mut is_entered, mut is_open) = (vec![false; count], vec![false; count]);
    let mut latches_of: FxHashMap<usize, Vec<usize>> = FxHashMap::default();
    let mut path: Vec<(usize, usize)> = vec![(0, 0)];
    (is_entered[0], is_open[0]) = (true, true);
    while let Some(&mut (block, ref mut next)) = path.last_mut() {
        let Some(&target) = following[block].get(*next) else {
            is_open[block] = false;
            path.pop();
            continue;
        };
        *next += 1;
        if is_open[target] {
            latches_of.entry(target).or_default().push(block);
        } else if !std::mem::replace(&mut is_entered[target], true) {
            is_open[target] = true;
            path.push((target, 0));
        }
    }
    for (head, latches) in latches_of {
        let mut is_inside = vec![false; count];
        is_inside[head] = true;
        let mut pending = latches;
        while let Some(block) = pending.pop() {
            if !std::mem::replace(&mut is_inside[block], true) {
                pending.extend_from_slice(&preceding[block]);
            }
        }
        for (depth, _) in depths.iter_mut().zip(is_inside).filter(|block| block.1) {
            *depth += 1;
        }
    }
    depths
}

fn find_functions_running_only_at_start(program: &Program) -> Vec<bool> {
    let mut is_held_as_value: Vec<bool> = program.funcs.iter().map(|func| func.has(func_flags::IS_VALUE)).collect();
    let mut callees: Vec<Vec<u32>> = vec![Vec::new(); program.funcs.len()];
    let mut is_called = vec![false; program.funcs.len()];
    for (caller, func) in program.funcs.iter().enumerate() {
        for value in &func.values {
            match value.def {
                Def::Op(Op::Closure { func, .. } | Op::ClosureOnce { func, .. } | Op::FuncRef(func)) => is_held_as_value[func.idx()] = true,
                Def::Op(Op::CallDirect { func, .. }) => {
                    callees[caller].push(func.idx() as u32);
                    is_called[func.idx()] = true;
                }
                _ => {}
            }
        }
    }
    for layout in &program.layouts {
        for func in layout.methods.iter().map(|method| method.func).chain([layout.constructor]).filter(|func| func.is_some()) {
            is_held_as_value[func.idx()] = true;
        }
    }
    let mut is_only_at_start: Vec<bool> = (0..program.funcs.len()).map(|func| program.funcs[func].kind == FuncKind::Module || is_called[func] && !is_held_as_value[func]).collect();
    let mut pending: Vec<usize> = (0..program.funcs.len()).filter(|&func| !is_only_at_start[func]).collect();
    while let Some(caller) = pending.pop() {
        for &callee in &callees[caller] {
            if program.funcs[callee as usize].kind != FuncKind::Module && std::mem::replace(&mut is_only_at_start[callee as usize], false) {
                pending.push(callee as usize);
            }
        }
    }
    is_only_at_start
}

#[derive(Copy, Clone)]
struct Untyped {
    module: u32,
    pos: u32,
    name: crate::id::StrId,
    kind: Kind,
    verdict: Verdict,
    is_in_dependency: bool,
    frequency: f64,
}

#[derive(Default)]
struct Counted {
    untyped: Vec<Untyped>,
    accesses: [usize; 2],
    typed_accesses: [usize; 2],
}

fn count(program: &Program, accesses: &Accesses<'_>, in_parallel: InParallel<'_>) -> Counted {
    let is_only_at_start = find_functions_running_only_at_start(program);
    let mut tasks: Vec<(usize, &[Func], Counted)> = program.funcs.chunks(FUNCTIONS_PER_TASK).enumerate().map(|(task, funcs)| (task * FUNCTIONS_PER_TASK, funcs, Counted::default())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(first, funcs, counted)| {
        for (index, func) in funcs.iter().enumerate() {
            let mut depths: Option<Vec<u32>> = None;
            accesses.for_each_in(func, |Access { value, block, kind, verdict, is_in_dependency }| {
                counted.accesses[usize::from(is_in_dependency)] += 1;
                if verdict == Verdict::Typed {
                    counted.typed_accesses[usize::from(is_in_dependency)] += 1;
                    return;
                }
                let depth = depths.get_or_insert_with(|| loop_depths(func))[block];
                let frequency = WEIGHT_OF_A_LOOP.powi(depth.min(MAX_LOOP_DEPTH_COUNTED) as i32) * if is_only_at_start[*first + index] { WEIGHT_AT_START } else { 1.0 };
                let Def::Op(Op::PropGet { name, .. } | Op::PropSet { name, .. } | Op::CallMethod { name, .. }) = func.values[value.idx()].def else { return };
                counted.untyped.push(Untyped { module: func.module.idx() as u32, pos: func.values[value.idx()].pos, name, kind, verdict, is_in_dependency, frequency });
            });
        }
    });
    let mut all = Counted::default();
    for (_, _, counted) in tasks {
        all.untyped.extend(counted.untyped);
        for side in 0..2 {
            all.accesses[side] += counted.accesses[side];
            all.typed_accesses[side] += counted.typed_accesses[side];
        }
    }
    all
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
enum Code {
    Any,
    ImplicitAny,
    JsonParse,
    UntypedApi,
    UncheckedCast,
    UntypedPackage,
    JavaScriptFile,
    TypeErrors,
    PassedToJavaScript,
    DeclarationOnly,
    CallbackParameter,
    IndexSignature,
    TypeParameter,
    ClassLayout,
    ObjectCreate,
    NoLayout,
}

impl Code {
    fn name(self) -> &'static str {
        match self {
            Code::Any => "any",
            Code::ImplicitAny => "implicit-any",
            Code::JsonParse => "json-parse",
            Code::UntypedApi => "untyped-api",
            Code::UncheckedCast => "unchecked-cast",
            Code::UntypedPackage => "untyped-package",
            Code::JavaScriptFile => "javascript-file",
            Code::TypeErrors => "type-errors",
            Code::PassedToJavaScript => "passed-to-javascript",
            Code::DeclarationOnly => "declaration-only",
            Code::CallbackParameter => "callback-parameter",
            Code::IndexSignature => "index-signature",
            Code::TypeParameter => "type-parameter",
            Code::ClassLayout => "class-layout",
            Code::ObjectCreate => "object-create",
            Code::NoLayout => "no-layout",
        }
    }

    fn of_message(code: u32) -> Code {
        match code {
            100092 | 100096 => Code::Any,
            100093 => Code::ImplicitAny,
            100094 => Code::JsonParse,
            100095 | 100100 | 100104 | 100077 => Code::UntypedApi,
            100040..=100044 | 100048 | 100063 | 100066..=100068 | 100097 => Code::UncheckedCast,
            100026 | 100099 | 100088 => Code::UntypedPackage,
            100083 => Code::JavaScriptFile,
            100009..=100011 | 100084 => Code::TypeErrors,
            100046 | 100047 | 100064 | 100065 => Code::PassedToJavaScript,
            100045 | 100102 => Code::DeclarationOnly,
            100103 | 100106 => Code::CallbackParameter,
            100078 => Code::IndexSignature,
            100079 => Code::TypeParameter,
            100023 | 100024 | 100027 | 100085 | 100050..=100062 => Code::ClassLayout,
            100091 | 100105 => Code::ObjectCreate,
            _ => Code::NoLayout,
        }
    }

    fn fix(self) -> &'static str {
        match self {
            Code::Any => "write the type that the value has in place of it",
            Code::ImplicitAny => "annotate it with the type that it holds",
            Code::JsonParse => "pass the type of the data as a type argument, JSON.parse<T>(text): the value is checked once, here, and is typed from then on. Data that does not match throws a TypeError",
            Code::UntypedApi => "for JSON, read the text and write JSON.parse<T>(text); keep objects of your own in an array, a Map or a Set, which the compiler sees through; for any other value, Bun.validate<T>(value) checks it and returns a typed copy",
            Code::UncheckedCast => "create the object in typed code, with an object literal or `new`; or let Bun.validate<T>(value) check it and return a typed copy",
            Code::UntypedPackage => "write a typed version of the package",
            Code::JavaScriptFile => "rename the file to .ts and annotate its functions",
            Code::TypeErrors => "fix the type errors: the build lists them in a warning",
            Code::PassedToJavaScript => "pass a copy, or only the fields that are needed, to the JavaScript code",
            Code::DeclarationOnly => "move the declaration into a .ts file, if typed code creates the objects",
            Code::CallbackParameter => "write the type of the parameter",
            Code::IndexSignature => "keep dictionaries apart from objects with declared properties: use a Map for the dictionary, or declare the keys that are known as properties",
            Code::TypeParameter => "constrain the type parameter to a type that declares the properties that are read",
            Code::ClassLayout => "declare the class once, at the top level of a module, with constant member names and no decorator",
            Code::ObjectCreate => "make the object with a class or an object literal of a declared type",
            Code::NoLayout => "give the value a declared object type: an interface or a class whose objects typed code creates",
        }
    }
}

struct Edit {
    file: FileId,
    start: u32,
    end: u32,
    replacement: String,
}

struct Cause {
    code: Code,
    at: CompilerDiagnostic,
    steps: Vec<CompilerDiagnostic>,
    annotation: Option<(u32, u32)>,
    parsed_by: Option<(u32, u32)>,
    asserted: Option<Assertion>,
    parameter: Option<(FnId, u32)>,
    reported_at: Option<(FileId, u32)>,
    imports: Vec<(Vec<u8>, FileId)>,
}

struct Row {
    cause: Cause,
    reads: u32,
    stores: u32,
    calls: u32,
    accesses: [u32; 2],
    weight: [f64; 2],
    names: Vec<Vec<u8>>,
    types: Vec<Vec<u8>>,
    wanted: Vec<(Vec<Derivation>, Vec<u8>)>,
    examples: Vec<(bool, FileId, u32)>,
    other_causes: Vec<(FileId, u32)>,
    package: Vec<u8>,
    crossings: Vec<(FileId, u32)>,
}

impl Row {
    fn add_crossing(&mut self, at: (FileId, u32)) {
        if !self.crossings.contains(&at) {
            self.crossings.push(at);
        }
    }

    fn add_type(&mut self, name: Vec<u8>, wanted: Option<(Vec<Derivation>, Vec<u8>)>) {
        self.wanted.extend(wanted.filter(|wanted| !wanted.1.is_empty()));
        if !name.is_empty() && !self.types.contains(&name) {
            self.types.push(name);
        }
    }
}

struct Locations<'a, 's> {
    checked: &'a Checked<'s>,
    shown_from: &'a [u8],
    line_starts: FxHashMap<FileId, Vec<u32>>,
}

impl Locations<'_, '_> {
    fn path(&self, file: FileId) -> String {
        const INSTALLED_IN: &[u8] = b"/node_modules/";
        let name = self.checked.files.module(file).file_name();
        let shown = match bun_core::strings::last_index_of(name, INSTALLED_IN) {
            Some(at) if self.checked.files.module(file).is_dependency => name[at + 1..].to_vec(),
            _ if name.starts_with(b"/") => get_relative_path_from_directory(self.shown_from, name, self.checked.files.is_case_sensitive),
            _ => name.to_vec(),
        };
        bstr::BStr::new(&shown).to_string()
    }

    fn line_and_column(&mut self, file: FileId, pos: u32) -> (usize, usize) {
        let text = &self.checked.files.hir(file).text;
        let starts = self.line_starts.entry(file).or_insert_with(|| compute_ecma_line_starts(text));
        let line = starts.partition_point(|&start| start <= pos).max(1) - 1;
        let before = &text[(starts[line] as usize).min(text.len())..(pos as usize).min(text.len())];
        (line + 1, bstr::BStr::new(before).to_string().encode_utf16().count() + 1)
    }

    fn source_line_and_caret(&mut self, file: FileId, pos: u32, end: u32) -> (String, String) {
        let line = self.line_and_column(file, pos).0 - 1;
        let text = &self.checked.files.hir(file).text;
        let starts = &self.line_starts[&file];
        let (start, line_end) = ((starts[line] as usize).min(text.len()), starts.get(line + 1).map_or(text.len(), |&next| next as usize).min(text.len()));
        let whole = &text[start..line_end];
        let indentation = whole.len() - whole.trim_ascii_start().len();
        let written = bstr::BStr::new(whole.trim_ascii()).to_string();
        let from = (pos as usize).clamp(start + indentation, line_end.max(start + indentation));
        let before = bstr::BStr::new(&text[start + indentation..from]).to_string().chars().count();
        let marked = bstr::BStr::new(&text[from..(end as usize).clamp(from, line_end.max(from))]).to_string().trim_end().chars().count().max(1);
        let first_shown = if before + marked > MAX_SOURCE_SHOWN { before.saturating_sub(MAX_SOURCE_SHOWN / 2) } else { 0 };
        let mut source: String = written.chars().skip(first_shown).take(MAX_SOURCE_SHOWN).collect();
        if first_shown > 0 {
            source.replace_range(..source.char_indices().nth(2).map_or(source.len(), |at| at.0), "..");
        }
        if written.chars().count() > first_shown + MAX_SOURCE_SHOWN {
            source.push_str(" ..");
        }
        let caret = format!("{}^{}", " ".repeat(before - first_shown), "~".repeat((marked - 1).min(MAX_SOURCE_SHOWN.saturating_sub(before - first_shown + 1))));
        (source, caret)
    }
}

fn copy_of(found: &CompilerDiagnostic) -> CompilerDiagnostic {
    CompilerDiagnostic { file: found.file, start: found.start, end: found.end, code: found.code, args: found.args.clone(), related: Vec::new() }
}

fn text_of(found: &CompilerDiagnostic) -> String {
    let mut text = Vec::new();
    if let Some((_, template)) = messages::message(found.code) {
        messages::format(&mut text, template, &found.args);
    }
    bstr::BStr::new(&text).to_string()
}

fn counted(count: u32, one: &str, many: &str) -> Option<String> {
    (count > 0).then(|| format!("{count} {}", if count == 1 { one } else { many }))
}

fn quoted(text: &str) -> String {
    let mut out = String::new();
    let _ = bun_core::fmt::encode_json_string(&mut out, text.as_bytes());
    out
}

fn is_where_a_chain_ends(code: u32) -> bool {
    matches!(code, 100063..=100065 | 100072 | 100075..=100079 | 100085 | 100091 | 100102..=100104 | 100106)
}

impl Cause {
    fn at(code: Code, at: CompilerDiagnostic) -> Cause {
        Cause { code, at, steps: Vec::new(), annotation: None, parsed_by: None, asserted: None, parameter: None, reported_at: None, imports: Vec::new() }
    }

    fn of_finding(finding: &CompilerDiagnostic) -> Cause {
        let end = finding.related.iter().position(|step| is_where_a_chain_ends(step.code)).or_else(|| finding.related.len().checked_sub(1));
        let (root, steps) = match end {
            Some(end) => (&finding.related[end], &finding.related[..end]),
            None => (finding, &[][..]),
        };
        Cause { steps: steps.iter().map(copy_of).collect(), ..Cause::at(Code::of_message(root.code), copy_of(root)) }
    }

    fn of_class_without_layout(finding: &CompilerDiagnostic) -> Cause {
        let code = finding.related.first().map_or(Code::ClassLayout, |reason| Code::of_message(reason.code));
        Cause { steps: finding.related.iter().rev().map(copy_of).collect(), ..Cause::at(code, copy_of(finding)) }
    }

    fn followed_to_its_origin(self, checker: &mut Checker<'_, '_>, explaining: &mut Explaining, used_as: Option<&[u8]>, classes_without_layout: &FxHashSet<(FileId, ClassId)>) -> Followed {
        if !matches!(self.at.code, 100040..=100042 | 100063) {
            return Followed::To(Box::new(self), None);
        }
        let used_as = used_as.map(<[u8]>::to_vec).or_else(|| self.at.args.first().cloned()).unwrap_or_default();
        let (here, steps_before) = ((self.at.file, self.at.start), self.steps.len());
        let with_use_site = |cause: Cause| {
            let use_site = if used_as.is_empty() { cause.at } else { CompilerDiagnostic { code: 100101, args: vec![used_as.clone()], ..cause.at } };
            cause.steps.into_iter().chain([use_site]).collect::<Vec<CompilerDiagnostic>>()
        };
        match checker.find_untyped_operand_at(explaining, self.at.file, self.at.start) {
            Some(operand) => {
                let origin = checker.find_untyped_origin(self.at.file, operand);
                let expected = checker.expected_type_text(self.at.file, operand).unwrap_or_else(|| used_as.clone());
                let wanted = (origin.derivation.clone(), expected.clone());
                let (start, end) = checker.span_of_expression(self.at.file, operand);
                let use_site = CompilerDiagnostic { code: 100101, args: vec![expected], start, end, ..self.at };
                let imports = if origin.asserted.is_none() { checker.find_types_to_import(origin.root.file, self.at.file, operand) } else { Vec::new() };
                Followed::To(Box::new(Cause { reported_at: Some(here), imports, ..Cause::of_origin(origin, self.steps.into_iter().chain([use_site]).collect()) }), Some(wanted))
            }
            None => match checker.explain_missing_layout_at(explaining, self.at.file, self.at.start, classes_without_layout) {
                Some(MissingLayout::Package { declared_in, .. }) => Followed::ToPackage(declared_in, here),
                Some(MissingLayout::UntypedValue(origin)) => Followed::To(Box::new(Cause::of_origin(*origin, with_use_site(self))), None),
                Some(MissingLayout::Reasons(reasons)) if !reasons.is_empty() => {
                    let found = Cause::of_finding(&CompilerDiagnostic { related: reasons, ..copy_of(&self.at) });
                    let found = Cause { steps: with_use_site(self).into_iter().chain(found.steps).collect(), ..found };
                    match (found.at.file, found.at.start) != here && steps_before < MAX_STEPS_FOLLOWED {
                        true => found.followed_to_its_origin(checker, explaining, None, classes_without_layout),
                        false => Followed::To(Box::new(found), None),
                    }
                }
                _ => match checker.find_package_given_what_is_at(explaining, self.at.file, self.at.start) {
                    Some(package) => Followed::ToPackage(package, here),
                    None => Followed::To(Box::new(self), None),
                },
            },
        }
    }

    fn of_origin(origin: UntypedOrigin, steps: Vec<CompilerDiagnostic>) -> Cause {
        Cause { code: Code::of_message(origin.root.code), at: origin.root, steps, annotation: origin.annotation, parsed_by: origin.parsed_by, asserted: origin.asserted, parameter: origin.parameter, reported_at: None, imports: Vec::new() }
    }
}

enum Followed {
    To(Box<Cause>, Option<(Vec<Derivation>, Vec<u8>)>),
    ToPackage(FileId, (FileId, u32)),
}

#[derive(Default)]
struct Table {
    rows: Vec<Row>,
    row_of: FxHashMap<Key, usize>,
}

impl Table {
    fn row(&mut self, key: Key, cause: Cause) -> usize {
        *self.row_of.entry(key).or_insert_with(|| {
            self.rows.push(Row { cause, reads: 0, stores: 0, calls: 0, accesses: [0; 2], weight: [0.0; 2], names: Vec::new(), types: Vec::new(), wanted: Vec::new(), examples: Vec::new(), other_causes: Vec::new(), package: Vec::new(), crossings: Vec::new() });
            self.rows.len() - 1
        })
    }

    fn row_at(&mut self, cause: Cause) -> usize {
        self.row(Key::At(cause.code, cause.at.file, cause.at.start), cause)
    }
}

fn type_wrapped_by(derivation: &[Derivation], inner: &str, atoms: &bun_sema::atom::Interner<'_>) -> Option<String> {
    let mut ty = inner.to_owned();
    for step in derivation.iter().rev() {
        ty = match *step {
            Derivation::Element if ty.as_bytes().contains(&b' ') => format!("({ty})[]"),
            Derivation::Element => format!("{ty}[]"),
            Derivation::Property(name) => format!("{{ {}: {ty} }}", bstr::BStr::new(atoms.bytes(name))),
            Derivation::Other => return None,
        };
    }
    Some(ty)
}

pub(super) struct Sources<'a, 's> {
    pub program: &'a Program,
    pub checked: &'a Checked<'s>,
    pub modules: &'a [FileId],
    pub shown_from: &'a [u8],
    pub accesses: &'a Accesses<'a>,
    pub found: &'a [CompilerDiagnostic],
    pub open_layouts: &'a [(LayoutId, usize)],
    pub classes: &'a [Option<(FileId, ClassId)>],
    pub classes_without_layout: &'a FxHashSet<(FileId, ClassId)>,
    pub other_places_where_external_data_enters: &'a [(Place, CompilerDiagnostic)],
}

#[derive(PartialEq, Eq, Hash, Clone)]
enum Key {
    At(Code, FileId, u32),
    Package(Vec<u8>),
}

pub(super) fn explain(sources: &Sources<'_, '_>, as_json: bool, in_parallel: InParallel<'_>) -> Vec<String> {
    let Sources { program, checked, modules, shown_from, accesses, found, open_layouts, classes, classes_without_layout, other_places_where_external_data_enters } = *sources;
    let counted_in_code = count(program, accesses, in_parallel);
    let mut checker = checked.checker();
    let mut explaining = checker.begin_explaining();
    let fallen = checked.compiled_untyped.lock();

    let finding_of_layout: FxHashMap<LayoutId, usize> = open_layouts.iter().copied().collect();
    let finding_at: FxHashMap<(FileId, u32), usize> = found.iter().enumerate().filter(|finding| matches!(finding.1.code, 100023 | 100024 | 100027)).map(|(index, finding)| ((finding.file, finding.start), index)).collect();
    let package_finding: FxHashMap<&[u8], usize> = found.iter().enumerate().filter(|finding| finding.1.code == 100026).filter_map(|(index, finding)| Some((finding.args.first()?.as_slice(), index))).collect();

    let mut table = Table::default();
    let mut row_of_receiver: FxHashMap<(u32, u32, u32), usize> = FxHashMap::default();
    let mut row_of_layout: FxHashMap<LayoutId, usize> = FxHashMap::default();
    let mut row_of_module: FxHashMap<u32, usize> = FxHashMap::default();
    let class_at: FxHashMap<(FileId, u32), (FileId, ClassId)> = (classes.iter().flatten())
        .map(|&class| {
            let at = checker.class_declaration_site(class);
            ((at.file, at.pos), class)
        })
        .collect();
    let row_of_code_in = |table: &mut Table, checker: &Checker<'_, '_>, file: FileId| match checker.name_of_package_holding(file).filter(|_| checker.origin_of_declarations_in(file) == ObjectOrigin::Package && !fallen.iter().any(|record| record.file == file)) {
        Some(package) => {
            let package = package.strip_prefix(b"@types/").map_or_else(|| package.clone(), <[u8]>::to_vec);
            let known = package_finding.get(package.as_slice()).map(|&index| copy_of(&found[index]));
            let at = known.unwrap_or_else(|| CompilerDiagnostic { file, start: 0, end: 0, code: 100088, args: vec![[b"the package '".as_slice(), &package, b"'"].concat()], related: Vec::new() });
            let row = table.row(Key::Package(package.clone()), Cause::at(Code::UntypedPackage, at));
            table.rows[row].package = package;
            row
        }
        None => {
            let record = fallen.iter().find(|record| record.file == file).map(copy_of);
            let name = get_relative_path_from_directory(shown_from, checked.files.module(file).file_name(), checked.files.is_case_sensitive);
            let code = if checked.files.module(file).hir.is_js { 100083 } else { 100084 };
            let at = record.unwrap_or_else(|| CompilerDiagnostic { file, start: 0, end: 0, code, args: vec![name], related: Vec::new() });
            table.row_at(Cause::at(Code::of_message(at.code), at))
        }
    };
    let row_of_class = |table: &mut Table, checker: &mut Checker<'_, '_>, finding: &CompilerDiagnostic| {
        let untyped_base = class_at.get(&(finding.file, finding.start)).and_then(|&class| checker.find_untyped_file_declaring_base(class));
        match untyped_base {
            Some(file) => row_of_code_in(table, checker, file),
            None => table.row_at(Cause::of_class_without_layout(finding)),
        }
    };

    for site in &counted_in_code.untyped {
        let file = modules[site.module as usize];
        let row = match site.verdict {
            Verdict::Typed => continue,
            Verdict::InUntypedCode(access) if access.origin != ObjectOrigin::Package || checked.files.module(file).is_dependency => *row_of_module.entry(site.module).or_insert_with(|| row_of_code_in(&mut table, &checker, file)),
            Verdict::ByName(access) | Verdict::InUntypedCode(access) => match row_of_receiver.get(&(site.module, access.receiver.0, access.pattern.0)) {
                Some(&row) => row,
                None => {
                    let row = if access.origin == ObjectOrigin::Package {
                        let declared_in = checker.file_declaring_objects_of(file, access.receiver, access.pattern);
                        row_of_code_in(&mut table, &checker, declared_in.unwrap_or(file))
                    } else {
                        match checker.explain_missing_layout(&explaining, file, access.receiver, access.pattern, classes_without_layout) {
                            MissingLayout::UntypedValue(origin) => table.row_at(Cause::of_origin(*origin, Vec::new())),
                            MissingLayout::Package { declared_in, given_at } => {
                                let row = row_of_code_in(&mut table, &checker, declared_in);
                                table.rows[row].add_crossing((given_at.file, given_at.pos));
                                row
                            }
                            MissingLayout::Reasons(reasons) => {
                                let direct = Cause::of_finding(&CompilerDiagnostic { file, start: site.pos, end: site.pos, code: 100030, args: vec![program.strs.get(site.name).to_vec()], related: reasons });
                                let used_as = direct.at.args.first().cloned().filter(|_| direct.at.code == 100063).unwrap_or_default();
                                match direct.followed_to_its_origin(&mut checker, &mut explaining, None, classes_without_layout) {
                                    Followed::ToPackage(declared_in, given_at) => {
                                        let row = row_of_code_in(&mut table, &checker, declared_in);
                                        table.rows[row].add_crossing(given_at);
                                        row
                                    }
                                    Followed::To(cause, wanted) => {
                                        let row = match finding_at.get(&(cause.at.file, cause.at.start)).filter(|_| cause.at.code == 100085) {
                                            Some(&class) => row_of_class(&mut table, &mut checker, &found[class]),
                                            None if cause.at.code == 100083 => row_of_code_in(&mut table, &checker, cause.at.file),
                                            None if cause.at.code == 100088 && checker.origin_of_declarations_in(cause.at.file) == ObjectOrigin::Package => row_of_code_in(&mut table, &checker, cause.at.file),
                                            None if cause.at.code == 100088 => table.row_at(Cause { code: Code::NoLayout, ..*cause }),
                                            None => table.row_at(*cause),
                                        };
                                        table.rows[row].add_type(used_as, wanted);
                                        row
                                    }
                                }
                            }
                        }
                    };
                    row_of_receiver.insert((site.module, access.receiver.0, access.pattern.0), row);
                    row
                }
            },
            Verdict::ThroughLayout(layout) => match row_of_layout.get(&layout) {
                Some(&row) => row,
                None => {
                    let of_class = classes.get(layout.idx()).copied().flatten().map(|class| checker.class_declaration_site(class)).and_then(|at| finding_at.get(&(at.file, at.pos)));
                    let finding = finding_of_layout.get(&layout).or(of_class).map(|&index| &found[index]);
                    let name = Some(program.layouts[layout.idx()].name).filter(|name| name.is_some()).map_or_else(Vec::new, |name| program.strs.get(name).to_vec());
                    let row = match finding {
                        Some(finding) if matches!(finding.code, 100023 | 100024 | 100027) => row_of_class(&mut table, &mut checker, finding),
                        Some(finding) => match Cause::of_finding(finding).followed_to_its_origin(&mut checker, &mut explaining, Some(&name), classes_without_layout) {
                            Followed::ToPackage(declared_in, given_at) => {
                                let row = row_of_code_in(&mut table, &checker, declared_in);
                                table.rows[row].add_crossing(given_at);
                                row
                            }
                            Followed::To(cause, wanted) => {
                                let row = table.row_at(*cause);
                                table.rows[row].add_type(Vec::new(), wanted);
                                row
                            }
                        },
                        None => table.row_at(Cause::at(Code::NoLayout, CompilerDiagnostic { file, start: site.pos, end: site.pos, code: 100089, args: vec![if name.is_empty() { b"the type of this object".to_vec() } else { name.clone() }], related: Vec::new() })),
                    };
                    table.rows[row].add_type(name, None);
                    row_of_layout.insert(layout, row);
                    row
                }
            },
        };
        let row = &mut table.rows[row];
        *match site.kind {
            Kind::Read => &mut row.reads,
            Kind::Store => &mut row.stores,
            Kind::Call => &mut row.calls,
        } += 1;
        row.accesses[usize::from(site.is_in_dependency)] += 1;
        row.weight[usize::from(site.is_in_dependency)] += site.frequency;
        if matches!(site.verdict, Verdict::ByName(_)) {
            let name = program.strs.get(site.name);
            if row.names.len() <= MAX_NAMES_SHOWN && !row.names.iter().any(|known| known == name) {
                row.names.push(name.to_vec());
            }
        }
        if row.examples.len() < MAX_EXAMPLES_KEPT && !row.examples.contains(&(site.is_in_dependency, file, site.pos)) && (file, site.pos) != (row.cause.at.file, row.cause.at.start) {
            row.examples.push((site.is_in_dependency, file, site.pos));
        }
    }
    let mut rows = table.rows;
    for row in &mut rows {
        let is_of_row = |at: &Place| row.cause.reported_at == Some((at.file, at.pos)) || std::iter::once(&row.cause.at).chain(&row.cause.steps).any(|step| (step.file, step.start) == (at.file, at.pos));
        let others = other_places_where_external_data_enters.iter().filter(|other| is_of_row(&other.0)).map(|other| (other.1.file, other.1.start));
        let is_of_the_program = |file: FileId| checked.files.module(file).builtin.is_none() && !bun_core::strings::contains(checked.files.module(file).path.text, b"/.bun-aot-prelude/");
        row.other_causes = others.filter(|&other| other != (row.cause.at.file, row.cause.at.start) && is_of_the_program(other.0)).collect();
        row.other_causes.sort_unstable_by_key(|&(file, pos)| (checked.files.rank_of_file(file), pos));
        row.other_causes.dedup();
        row.examples.sort_unstable_by_key(|&(is_in_dependency, file, pos)| (is_in_dependency, checked.files.rank_of_file(file), pos));
        row.crossings.sort_unstable_by_key(|&(file, pos)| (checked.files.rank_of_file(file), pos));
    }
    drop(fallen);

    let is_charged_to_dependency = |row: &Row| row.accesses[0] == 0;
    let may_follow_from_another_cause = |row: &Row| matches!(row.cause.at.code, 100040..=100042);
    rows.sort_by(|a, b| {
        (is_charged_to_dependency(a).cmp(&is_charged_to_dependency(b)))
            .then_with(|| may_follow_from_another_cause(a).cmp(&may_follow_from_another_cause(b)))
            .then_with(|| b.weight[0].total_cmp(&a.weight[0]))
            .then_with(|| b.weight[1].total_cmp(&a.weight[1]))
            .then_with(|| (b.accesses[0] + b.accesses[1]).cmp(&(a.accesses[0] + a.accesses[1])))
            .then_with(|| (checked.files.rank_of_file(a.cause.at.file), a.cause.at.start, a.cause.code).cmp(&(checked.files.rank_of_file(b.cause.at.file), b.cause.at.start, b.cause.code)))
    });

    let points = |given_back: u32, all: usize| 100.0 * f64::from(given_back) / all.max(1) as f64;
    let [own, in_dependencies] = counted_in_code.accesses;
    let [own_typed, typed_in_dependencies] = counted_in_code.typed_accesses;
    let atoms = &checked.files.atoms;
    let mut locations = Locations { checked, shown_from, line_starts: FxHashMap::default() };
    let mut lines = Vec::new();
    if !as_json {
        match counted(rows.len() as u32, "cause", "causes") {
            Some(causes) => {
                lines.push(Typedness { accesses: own, typed_accesses: own_typed, dependency_accesses: in_dependencies, typed_dependency_accesses: typed_in_dependencies, ..Typedness::default() }.summary());
                lines.push(format!("{causes}, the most expensive first. Fix one, then run this again: a fix can uncover another cause behind it."));
            }
            None => lines.push("every property access is typed: there is nothing to explain".to_owned()),
        }
    } else {
        let percent = |typed: usize, all: usize| if all == 0 { 100.0 } else { 100.0 * typed as f64 / all as f64 };
        lines.push(format!(
            "{{\"percent\":{:.1},\"typed\":{own_typed},\"accesses\":{own},\"dependencyPercent\":{:.1},\"typedInDependencies\":{typed_in_dependencies},\"dependencyAccesses\":{in_dependencies},\"causes\":{}}}",
            percent(own_typed, own),
            percent(typed_in_dependencies, in_dependencies),
            rows.len(),
        ));
    }
    let shown = if as_json { rows.len() } else { rows.len().min(MAX_ROWS_SHOWN) };
    let parameters: Vec<(usize, (FileId, FnId, u32))> = rows.iter().take(shown).enumerate().filter_map(|(row, described)| described.cause.parameter.map(|(function, index)| (row, (described.cause.at.file, function, index)))).collect();
    let passed = checker.find_types_passed_to_parameters(&parameters.iter().map(|parameter| parameter.1).collect::<Vec<_>>());
    let passed_to_parameter: FxHashMap<usize, String> = parameters.iter().zip(passed).filter_map(|(parameter, passed)| Some((parameter.0, bstr::BStr::new(&passed?).to_string()))).collect();
    for (rank, row) in rows.iter().take(shown).enumerate() {
        let cause = &row.cause;
        let (line, column) = locations.line_and_column(cause.at.file, cause.at.start);
        let path = locations.path(cause.at.file);
        let is_whole_file = cause.at.start == 0;
        let (source, caret) = if is_whole_file { (String::new(), String::new()) } else { locations.source_line_and_caret(cause.at.file, cause.at.start, cause.at.end) };
        let in_dependency = is_charged_to_dependency(row);
        let [given_back, given_back_in_dependencies] = row.accesses;
        let (gained, gained_in_dependencies) = (points(given_back, own), points(given_back_in_dependencies, in_dependencies));
        let names: Vec<String> = row.names.iter().map(|name| bstr::BStr::new(name).to_string()).collect();
        let types: Vec<String> = row.types.iter().map(|name| bstr::BStr::new(name).to_string()).collect();
        let mut suggested: Vec<String> = row.wanted.iter().filter_map(|(derivation, name)| type_wrapped_by(derivation, &bstr::BStr::new(name).to_string(), atoms)).collect();
        suggested.sort();
        suggested.dedup();
        let suggested = if suggested.len() == 1 { suggested.pop() } else { None };
        let mut edits: Vec<Edit> = Vec::new();
        let suggested = match &cause.asserted {
            Some(asserted) => Some(bstr::BStr::new(&asserted.written_type).to_string()),
            None if cause.at.code == 100104 => cause.at.args.get(2).map(|awaited| bstr::BStr::new(awaited).to_string()),
            None => suggested.or_else(|| passed_to_parameter.get(&rank).cloned()),
        };
        let suggested = suggested.or_else(|| if let (Code::UncheckedCast, [only]) = (cause.code, &types[..]) { Some(only.clone()) } else { None });
        let fix = match (cause.code, &suggested) {
            (Code::JsonParse, Some(ty)) if cause.asserted.is_some() => {
                if let Some((_, callee_end)) = cause.parsed_by {
                    edits.push(Edit { file: cause.at.file, start: callee_end, end: callee_end, replacement: format!("<{ty}>") });
                }
                let cast = cause.asserted.as_ref().and_then(|asserted| asserted.cast);
                if let Some((start, end)) = cast {
                    edits.push(Edit { file: cause.at.file, start, end, replacement: String::new() });
                }
                format!("write JSON.parse<{ty}>(..){}: the value is checked once, here, and is typed from then on. Data that does not match throws a TypeError", if cast.is_some() { " in place of the cast" } else { "" })
            }
            (Code::JsonParse, Some(ty)) => {
                if let Some((_, callee_end)) = cause.parsed_by {
                    edits.push(Edit { file: cause.at.file, start: callee_end, end: callee_end, replacement: format!("<{ty}>") });
                }
                if let Some((start, end)) = cause.annotation {
                    edits.push(Edit { file: cause.at.file, start, end, replacement: ty.clone() });
                }
                format!("write JSON.parse<{ty}>(..){}: the value is checked once, here, and is typed from then on. Data that does not match throws a TypeError", if cause.annotation.is_some() { format!(" and declare the variable '{ty}'") } else { String::new() })
            }
            (Code::Any, Some(ty)) => {
                if let Some((start, end)) = cause.annotation {
                    edits.push(Edit { file: cause.at.file, start, end, replacement: ty.clone() });
                }
                format!("write '{ty}' in place of it")
            }
            (Code::ImplicitAny, Some(ty)) => {
                edits.push(Edit { file: cause.at.file, start: cause.at.end, end: cause.at.end, replacement: format!(": {ty}") });
                format!("annotate it: '{}: {ty}'", cause.at.args.first().map_or_else(String::new, |name| bstr::BStr::new(name).to_string()))
            }
            (Code::UntypedApi, Some(ty)) => format!("for JSON, read the text and write JSON.parse<{ty}>(text); keep objects of your own in an array, a Map or a Set, which the compiler sees through; for any other value, Bun.validate<{ty}>(value) checks it and returns a typed copy"),
            (Code::UntypedPackage, _) => {
                let package = bstr::BStr::new(&row.package);
                let inside = format!("write a typed version of the package in .sound/{package}");
                let at_the_border = "keep your typed objects away from it: pass it copies or plain values, and copy what you need from its results into objects of your own types";
                match (given_back > 0, given_back_in_dependencies > 0) {
                    (true, true) => format!("if the package is yours, build it with `bun compile --library`. If not, {at_the_border}; for the code inside it, {inside}"),
                    (true, false) => format!("if the package is yours, build it with `bun compile --library`. If not, {at_the_border}"),
                    (false, _) => format!("{inside}; if the package is yours, build it with `bun compile --library`"),
                }
            }
            (Code::UncheckedCast, Some(ty)) => format!("create the '{ty}' in typed code, with an object literal or `new`, in place of the cast; or let Bun.validate<{ty}>(value) check the value and return a typed copy"),
            (Code::CallbackParameter, _) if cause.at.code == 100106 => "pass a callback that is not async, and call the async part from it".to_owned(),
            (Code::CallbackParameter, _) if cause.at.args.len() == 2 => format!("write the type of the parameter: ({}: {})", bstr::BStr::new(&cause.at.args[0]), bstr::BStr::new(&cause.at.args[1])),
            (Code::Any | Code::ImplicitAny | Code::JsonParse | Code::UntypedApi, None) if !names.is_empty() => {
                format!("{}; the code reads {} from it", cause.code.fix(), names.iter().take(MAX_NAMES_SHOWN).map(|name| format!("'{name}'")).collect::<Vec<String>>().join(", "))
            }
            _ => cause.code.fix().to_owned(),
        };
        let imports: Vec<String> = (cause.imports.iter().filter(|_| !edits.is_empty()))
            .map(|(name, declared_in)| {
                let importer = checked.files.module(cause.at.file).file_name();
                let directory = &importer[..importer.iter().rposition(|&byte| byte == b'/').unwrap_or(0)];
                let from = get_relative_path_from_directory(directory, checked.files.module(*declared_in).file_name(), checked.files.is_case_sensitive);
                let from = bstr::BStr::new(&from[..from.iter().rposition(|&byte| byte == b'.').unwrap_or(from.len())]).to_string();
                format!("import type {{ {} }} from \"{}{from}\";", bstr::BStr::new(name), if from.as_bytes().first() == Some(&b'.') { "" } else { "./" })
            })
            .collect();
        let fix = if imports.is_empty() { fix } else { format!("{fix}. Add: {}", imports.join(" ")) };
        edits.extend(imports.iter().map(|import| Edit { file: cause.at.file, start: 0, end: 0, replacement: format!("{import}\n") }));
        edits.sort_by_key(|edit| std::cmp::Reverse((edit.start, edit.end)));
        let steps: Vec<(String, usize, usize, String)> = (cause.steps.iter().rev())
            .map(|step| {
                let (line, column) = locations.line_and_column(step.file, step.start);
                (locations.path(step.file), line, column, text_of(step))
            })
            .collect();
        let examples: Vec<(String, usize, usize)> = (row.examples.iter())
            .map(|&(_, file, pos)| {
                let (line, column) = locations.line_and_column(file, pos);
                (locations.path(file), line, column)
            })
            .collect();
        let other_causes: Vec<(String, usize, usize)> = (row.other_causes.iter())
            .map(|&(file, pos)| {
                let (line, column) = locations.line_and_column(file, pos);
                (locations.path(file), line, column)
            })
            .collect();
        let crossings: Vec<(String, usize, usize)> = (row.crossings.iter())
            .map(|&(file, pos)| {
                let (line, column) = locations.line_and_column(file, pos);
                (locations.path(file), line, column)
            })
            .collect();
        let url = format!("{PAGE}#{}", cause.code.name());
        if as_json {
            let because: Vec<String> = steps.iter().map(|(path, line, column, text)| format!("{{\"file\":{},\"line\":{line},\"column\":{column},\"message\":{}}}", quoted(path), quoted(text))).collect();
            let as_strings = |list: &[String]| list.iter().map(|name| quoted(name)).collect::<Vec<String>>().join(",");
            let as_places = |places: &[(String, usize, usize)]| places.iter().map(|(path, line, column)| format!("{{\"file\":{},\"line\":{line},\"column\":{column}}}", quoted(path))).collect::<Vec<String>>().join(",");
            let edits: Vec<String> = edits.iter().map(|edit| format!("{{\"file\":{},\"start\":{},\"end\":{},\"replacement\":{}}}", quoted(&locations.path(edit.file)), edit.start, edit.end, quoted(&edit.replacement))).collect();
            lines.push(format!(
                "{{\"rank\":{},\"code\":\"{}\",\"file\":{},\"line\":{line},\"column\":{column},\"start\":{},\"end\":{},\"inDependency\":{in_dependency},\"source\":{},\"message\":{},\"because\":[{}],\"accesses\":{given_back},\"points\":{gained:.2},\"dependencyAccesses\":{given_back_in_dependencies},\"dependencyPoints\":{gained_in_dependencies:.2},\"reads\":{},\"stores\":{},\"calls\":{},\"weight\":{:.2},\"types\":[{}],\"properties\":[{}],\"examples\":[{}],\"otherCauses\":[{}],\"crossings\":[{}],\"fix\":{},\"edits\":[{}],\"url\":{}}}",
                rank + 1,
                cause.code.name(),
                quoted(&path),
                cause.at.start,
                cause.at.end,
                quoted(&source),
                quoted(&text_of(&cause.at)),
                because.join(","),
                row.reads,
                row.stores,
                row.calls,
                row.weight[0] + row.weight[1],
                as_strings(&types),
                as_strings(&names),
                as_places(&examples),
                as_places(&other_causes),
                as_places(&crossings),
                quoted(&fix),
                edits.join(","),
                quoted(&url)
            ));
            continue;
        }
        lines.push(String::new());
        let place = if is_whole_file { path } else { format!("{path}:{line}:{column}") };
        let worth: Vec<String> = [
            counted(given_back, "access", "accesses").map(|accesses| format!("{accesses} (+{gained:.1} points)")),
            counted(given_back_in_dependencies, "access", "accesses").map(|accesses| format!("{accesses} in dependencies (+{gained_in_dependencies:.1} points)")),
        ]
        .into_iter()
        .flatten()
        .collect();
        lines.push(format!(" {:>2}. {} {place}: fixing it types up to {}", rank + 1, cause.code.name(), worth.join(" and ")));
        if !source.is_empty() {
            let number = format!("{line} | ");
            lines.push(format!("     {number}{source}"));
            lines.push(format!("     {}{caret}", " ".repeat(number.len())));
        }
        lines.push(format!("     {}", text_of(&cause.at)));
        for (path, line, column, text) in steps.iter().take(MAX_STEPS_SHOWN) {
            lines.push(format!("     {path}:{line}:{column}: {text}"));
        }
        if steps.len() > MAX_STEPS_SHOWN {
            lines.push(format!("     and {} more steps", steps.len() - MAX_STEPS_SHOWN));
        }
        if may_follow_from_another_cause(row) && rows.len() > 1 {
            lines.push("     the compiler cannot say where that value comes from. It may follow from another entry: fix those first".to_owned());
        }
        if !types.is_empty() {
            let more = types.len().saturating_sub(MAX_NAMES_SHOWN);
            let named = types.iter().take(MAX_NAMES_SHOWN).map(|name| format!("'{name}'")).collect::<Vec<String>>().join(", ");
            lines.push(format!("     types that lose their layout: {named}{}", if more > 0 { format!(" and {more} more") } else { String::new() }));
        }
        if !examples.is_empty() {
            lines.push(format!("     not typed because of it: {}", examples.iter().take(MAX_EXAMPLES_SHOWN).map(|(path, line, column)| format!("{path}:{line}:{column}")).collect::<Vec<String>>().join(", ")));
        }
        if !crossings.is_empty() {
            let shown: Vec<String> = crossings.iter().take(MAX_CROSSINGS_SHOWN).map(|(path, line, column)| format!("{path}:{line}:{column}")).collect();
            let more = if crossings.len() > MAX_CROSSINGS_SHOWN { format!(" and {} more", crossings.len() - MAX_CROSSINGS_SHOWN) } else { String::new() };
            lines.push(format!("     it gets your objects or calls your functions here: {}{more}", shown.join(", ")));
        }
        if !other_causes.is_empty() {
            lines.push(format!("     {} the same, and the accesses stay untyped until all of them are fixed:", if other_causes.len() == 1 { "1 other place does" } else { "other places do" }));
            for (path, line, column) in other_causes.iter().take(MAX_STEPS_SHOWN) {
                lines.push(format!("       {path}:{line}:{column}"));
            }
            if other_causes.len() > MAX_STEPS_SHOWN {
                lines.push(format!("       and {} more", other_causes.len() - MAX_STEPS_SHOWN));
            }
        }
        lines.push(format!("     fix: {fix}"));
        lines.push(format!("     {url}"));
    }
    if !as_json && rows.len() > shown {
        lines.push(String::new());
        lines.push(format!(" {} more causes are not shown. With =json after the flag, every one is printed, one object per line.", rows.len() - shown));
    }
    lines
}
