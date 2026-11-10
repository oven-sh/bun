use std::borrow::Cow;
use std::mem::take;

use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{
    BindOptions, Binding, BindingInitializer, Bound, Decl, Parent, RuntimeBindOptions,
};
use bun_sema::file_analysis::{FileAnalysis, FileInputs, analyze_file};
use bun_sema::fold::{Constant, FoldInputs, FoldOptions, FoldedValue};
use bun_sema::hir::{BinOp, ExportSpecId, ExprId, ExprKind, File, FileKind, Flags, PatKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, JsxMode, TextsOfFile};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::resolve::{
    FinishedFile, JsxSettings, TransformRequest, TranspileSettings, TreeChange,
};
use bun_sema::session::Session;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::from_argument;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::{FoundInTexts, LeftOpenByText};
use crate::builtins::{
    BuiltinId, BuiltinNames, ImportTargets, ResolveInput, ResolvedBuiltins, RuntimeModule,
    SourceDialect, resolve_file, table,
};
use crate::load::host_platform;
use crate::load::runtime_modules::find_module_named;
use crate::load::test_runner_names::{FileOfTestRun, import_used_names};

const MAX_FOLDED_STRING_BYTES: usize = 256;

const PATH_OF_TEXT: &[u8] = b"/text.ts";

const IMPORT_OF_NAMES_OF_TEST_RUNNER: &[u8] = b"import { jest, spyOn, vi } from \"bun:test\";\n";
const MODULE_THAT_NOBODY_KNOWS: &[u8] = b"?";
const VALUE_THAT_NOBODY_KNOWS: &[u8] = b"valueThatNobodyKnows";

const WAYS_TO_TEST_RUNNER: [&[u8]; 8] = [
    b"spyOn",
    b"mock",
    b"jest",
    b"vi",
    b"vitest",
    b"bun:test",
    b"Bun",
    b"globalThis",
];

pub(super) fn without_extension(path: &[u8]) -> &[u8] {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mts", b".mjs", b".cts", b".cjs",
    ];
    let has_dot = |from_end: usize| path.len() >= from_end && path[path.len() - from_end] == b'.';
    if !has_dot(3) && !has_dot(4) {
        return path;
    }
    let stem = EXTENSIONS.iter().find_map(|end| path.strip_suffix(*end));
    stem.unwrap_or(path)
}

pub(super) fn ends_with_module_in_text(path: &[u8], written: &[u8]) -> bool {
    let mut tail = written;
    while let Some(rest) = (tail.strip_prefix(b"../"))
        .or_else(|| tail.strip_prefix(b"./"))
        .or_else(|| tail.strip_prefix(b"/"))
    {
        tail = rest;
    }
    let tail = without_extension(tail);
    let path = without_extension(path);
    let ends_in = |path: &[u8]| {
        path.strip_suffix(tail)
            .is_some_and(|folder| folder.is_empty() || folder.ends_with(b"/"))
    };
    !tail.is_empty() && (ends_in(path) || path.strip_suffix(b"/index").is_some_and(ends_in))
}

fn names_module(before: &[u8]) -> bool {
    let before = trim_end_of_code(before);
    [&b"from"[..], b"import(", b"require("]
        .iter()
        .any(|end| before.ends_with(end))
}

fn trim_end_of_code(code: &[u8]) -> &[u8] {
    let mut code = code.trim_ascii_end();
    while let Some(inner) = code.strip_suffix(b"*/")
        && let Some(start) = strings::last_index_of(inner, b"/*")
    {
        code = inner[..start].trim_ascii_end();
    }
    code
}

#[derive(Default)]
struct PlaceInCode {
    string: Option<usize>,
    comment: Option<u8>,
}

impl PlaceInCode {
    fn pass(&mut self, text: &[u8], mut at: usize) {
        while at < text.len() {
            let byte = text[at];
            match (self.comment, self.string) {
                (Some(b'/'), _) if byte == b'\n' => self.comment = None,
                (Some(b'*'), _) if text[at..].starts_with(b"*/") => {
                    self.comment = None;
                    at += 1;
                }
                (Some(_), _) => {}
                (None, Some(_)) if byte == b'\\' => at += 1,
                (None, Some(quote)) if byte == text[quote] || byte == b'\n' => self.string = None,
                (None, Some(_)) => {}
                (None, None) if matches!(byte, b'"' | b'\'' | b'`') => self.string = Some(at),
                (None, None) if text[at..].starts_with(b"//") || text[at..].starts_with(b"/*") => {
                    self.comment = Some(text[at + 1]);
                    at += 1;
                }
                (None, None) => {}
            }
            at += 1;
        }
    }
}

fn find_end_of_string(parts: &[&[u8]], quote: u8) -> Option<(usize, usize)> {
    for (index, part) in parts.iter().enumerate() {
        let mut at = 0;
        while at < part.len() {
            match part[at] {
                b'\\' => at += 1,
                b'\n' => return None,
                byte if byte == quote => return Some((index, at)),
                _ => {}
            }
            at += 1;
        }
    }
    None
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum StringsWithHoles {
    AreUnknown,
    HoldFiller,
}

fn join_texts(texts: &[&[u8]], filler: &[u8], strings_with_holes: StringsWithHoles) -> Vec<u8> {
    let mut text: Vec<u8> = Vec::new();
    let mut place = PlaceInCode::default();
    let mut string_without_end: Option<usize> = None;
    let (mut index, mut start) = (0, 0);
    while index < texts.len() {
        let part = &texts[index][start..];
        let passed = text.len();
        text.extend_from_slice(part);
        (index, start) = (index + 1, 0);
        if index == texts.len() {
            break;
        }
        let module = || [b"\"", MODULE_THAT_NOBODY_KNOWS, b"\""].concat();
        if strings_with_holes == StringsWithHoles::AreUnknown {
            place.pass(&text, passed);
            if let Some(open) = place.string.filter(|_| place.string != string_without_end) {
                if let Some((parts_passed, end)) = find_end_of_string(&texts[index..], text[open]) {
                    text.truncate(open);
                    place.string = None;
                    match names_module(&text) || trim_end_of_code(&text).ends_with(b"import") {
                        true => text.extend(module()),
                        false => text.extend_from_slice(VALUE_THAT_NOBODY_KNOWS),
                    }
                    (index, start) = (index + parts_passed, end + 1);
                    continue;
                }
                string_without_end = place.string;
            }
        }
        match names_module(part) {
            true => text.extend(module()),
            false => text.extend_from_slice(filler),
        }
    }
    text
}

fn may_hold_code(text: &[u8]) -> bool {
    may_hold_code_together(&[text])
}

fn may_hold_code_together(texts: &[&[u8]]) -> bool {
    let (one, other) = find_marks_of_code(texts);
    one && other
}

fn find_marks_of_code(texts: &[&[u8]]) -> (bool, bool) {
    let holds = |byte: u8| texts.iter().any(|text| strings::contains_char(text, byte));
    let spells = |word: &[u8]| texts.iter().any(|text| strings::contains(text, word));
    (
        holds(b'.') || holds(b'[') || spells(b"bun:test"),
        holds(b'=') || holds(b'(') || spells(b"delete "),
    )
}

fn is_part_of_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || !byte.is_ascii()
}

fn spells_name(text: &[u8], name: &[u8]) -> bool {
    let mut from = 0;
    while let Some(found) = strings::index_of(&text[from..], name) {
        let (start, end) = (from + found, from + found + name.len());
        let begins = start == 0 || !is_part_of_name(text[start - 1]);
        let ends = text.get(end).is_none_or(|&byte| !is_part_of_name(byte));
        if begins && ends {
            return true;
        }
        from = start + 1;
    }
    false
}

fn may_reach_test_runner(texts: &[&[u8]]) -> bool {
    texts.iter().any(|text| {
        strings::contains(text, b"\\u")
            || (WAYS_TO_TEST_RUNNER.iter()).any(|name| spells_name(text, name))
    })
}

fn may_write_on_builtins(texts: &[&[u8]]) -> bool {
    let names_global = |text: &&[u8]| {
        let mut words = text.split(|&byte| !is_part_of_name(byte));
        words.any(|word| table::find_name(word).and_then(table::global).is_some())
    };
    let writes = |text: &&[u8]| {
        let (marks, names): ([&[u8]; 3], [&[u8]; 3]) = (
            [b"++", b"--", b"__define"],
            [b"delete", b"Object", b"Reflect"],
        );
        strings::contains_char(text, b'=')
            || marks.iter().any(|mark| strings::contains(text, mark))
            || names.iter().any(|name| spells_name(text, name))
    };
    texts.iter().any(names_global) && texts.iter().any(writes)
}

fn may_be_code_that_counts(texts: &[&[u8]]) -> bool {
    texts.iter().any(|text| may_hold_code(text))
        && (may_reach_test_runner(texts) || may_write_on_builtins(texts))
}

fn quote(text: &[u8]) -> Vec<u8> {
    let mut quoted = vec![b'"'];
    for &byte in text {
        match byte {
            b'"' | b'\\' => quoted.extend([b'\\', byte]),
            b'\n' => quoted.extend_from_slice(b"\\n"),
            b'\r' => quoted.extend_from_slice(b"\\r"),
            _ => quoted.push(byte),
        }
    }
    quoted.push(b'"');
    quoted
}

struct CodeInTexts {
    written: FoundInCode,
    handed_on: FoundInCode,
}

#[derive(Default)]
struct FoundInCode {
    names_spied: Vec<Vec<u8>>,
    modules_replaced: Vec<Vec<u8>>,
    exports_spied: Vec<(Vec<u8>, Vec<u8>)>,
    replaced_members: Vec<BuiltinId>,
    opened_holders: Vec<BuiltinId>,
    names_added: Vec<(BuiltinId, Vec<u8>)>,
    left_open: LeftOpenByText,
}

impl FoundInCode {
    fn leaves_nothing_open(&self) -> bool {
        self.left_open == LeftOpenByText::Nothing
            && self.names_spied.is_empty()
            && self.modules_replaced.is_empty()
            && self.exports_spied.is_empty()
            && self.replaced_members.is_empty()
            && self.opened_holders.is_empty()
            && self.names_added.is_empty()
    }

    fn append(&mut self, mut other: FoundInCode) {
        self.names_spied.append(&mut other.names_spied);
        self.modules_replaced.append(&mut other.modules_replaced);
        self.exports_spied.append(&mut other.exports_spied);
        self.replaced_members.append(&mut other.replaced_members);
        self.opened_holders.append(&mut other.opened_holders);
        self.names_added.append(&mut other.names_added);
        self.left_open = self.left_open.max(other.left_open);
    }

    fn take_what_code_in_text_does(&mut self, inner: ReadAsCode) {
        self.names_spied.extend(inner.names_spied);
        for (module, name) in inner.exports_spied {
            match module == MODULE_THAT_NOBODY_KNOWS {
                true => self.names_spied.push(name),
                false => self.exports_spied.push((module, name)),
            }
        }
        self.replaced_members.extend(inner.replaced_members);
        self.opened_holders.extend(inner.opened_holders);
        self.names_added.extend(inner.names_added);
        let by_itself = match (inner.mocks_any_module, inner.spies_under_any_name) {
            (true, _) => LeftOpenByText::MocksOfAnyModule,
            (false, true) => LeftOpenByText::SpiesUnderAnyName,
            (false, false) => LeftOpenByText::Nothing,
        };
        self.left_open = self.left_open.max(by_itself);
        for module in inner.modules {
            match module == MODULE_THAT_NOBODY_KNOWS {
                true => self.left_open = LeftOpenByText::MocksOfAnyModule,
                false => self.modules_replaced.push(module),
            }
        }
        self.append(inner.in_texts);
    }

    fn intern(mut self, atoms: &Interner<'_>) -> FoundInTexts {
        self.exports_spied.shared_sort_unstable();
        self.exports_spied.dedup();
        for texts in [&mut self.names_spied, &mut self.modules_replaced] {
            texts.shared_sort_unstable();
            texts.dedup();
        }
        let intern = |texts: Vec<Vec<u8>>| texts.iter().map(|text| atoms.intern(text)).collect();
        FoundInTexts {
            names_spied: intern(self.names_spied),
            modules_replaced: intern(self.modules_replaced),
            exports_spied: (self.exports_spied.iter())
                .map(|(module, name)| (atoms.intern(module), atoms.intern(name)))
                .collect(),
            replaced_members: self.replaced_members,
            opened_holders: self.opened_holders,
            names_added: (self.names_added.iter())
                .map(|(holder, name)| (*holder, atoms.intern(name)))
                .collect(),
            left_open: self.left_open,
        }
    }
}

#[derive(Default)]
struct ReadAsCode {
    has_syntax_error: bool,
    names_spied: Vec<Vec<u8>>,
    modules: Vec<Vec<u8>>,
    exports_spied: Vec<(Vec<u8>, Vec<u8>)>,
    spies_under_any_name: bool,
    mocks_any_module: bool,
    replaced_members: Vec<BuiltinId>,
    opened_holders: Vec<BuiltinId>,
    names_added: Vec<(BuiltinId, Vec<u8>)>,
    in_texts: FoundInCode,
}

#[derive(Copy, Clone)]
struct Tree<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    atoms: &'a Interner<'s>,
    builtins: &'a ResolvedBuiltins,
    folder: Option<&'a [u8]>,
}

impl<'a, 's> Tree<'a, 's> {
    fn text_of(&self, text: Atom) -> &'a [u8] {
        match text.is_none() {
            true => &b""[..],
            false => self.atoms.bytes(text),
        }
    }

    fn is_dead(&self, expression: ExprId) -> bool {
        self.analysis.decisions.is_dead_expr(expression)
    }

    fn find_module_loaded_by(&self, value: ExprId) -> Option<Atom> {
        let value = self.hir.skip_type_assertions(value);
        let call = match self.hir[value].kind {
            ExprKind::Await(promise) => self.hir.skip_type_assertions(promise),
            _ => value,
        };
        let site = &self.analysis.import_sites[self.analysis.import_site_of_call(call)?];
        let loads = matches!(
            site.kind,
            ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportCall(_)
        );
        match site.specifier {
            ImportSpecifier::Constant(module) if loads => Some(module),
            _ => None,
        }
    }

    fn find_module_whose_object_is(&self, object: ExprId) -> Option<Atom> {
        let (hir, bound) = (self.hir, self.bound);
        let object = hir.skip_type_assertions(object);
        let (ExprKind::Ident(_), Binding::Symbol(holder)) =
            (hir[object].kind, bound.binding(object))
        else {
            return self.find_module_loaded_by(object);
        };
        if let &[Decl::ImportNamespace(import)] = bound.symbol(holder).decls {
            return Some(hir[import].spec).filter(|module| module.is_some());
        }
        match bound.binding_initializer(hir, holder) {
            BindingInitializer::Expression(value) if bound.is_stable_binding(holder) => {
                self.find_module_loaded_by(value)
            }
            _ => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum WhereTextGoes {
    IntoMessages,
    IntoFiles,
    Anywhere,
}

fn find_where_text_goes(
    tree: Tree<'_, '_>,
    texts: &TextsOfFile<'_, '_>,
    text: ExprId,
    variables_left: usize,
) -> WhereTextGoes {
    let (hir, bound) = (tree.hir, tree.bound);
    let mut value = text;
    while let Parent::Expr(parent) = bound.parent_of_expr(value)
        && (hir.type_assertion_operand(parent) == Some(value)
            || matches!(
                hir[parent].kind,
                ExprKind::Binary { op: BinOp::Add, .. } | ExprKind::Template { .. }
            ))
    {
        value = parent;
    }
    match bound.parent_of_expr(value) {
        Parent::Expr(user) => match hir[user].kind {
            ExprKind::Call(call)
                if texts.writes_second_operand_into_file(hir[call].callee)
                    && hir.ids(hir[call].args).nth(1) == Some(value) =>
            {
                WhereTextGoes::IntoFiles
            }
            ExprKind::Call(call) | ExprKind::New(call)
                if hir[call].callee != value && takes_messages(tree, hir[call].callee) =>
            {
                WhereTextGoes::IntoMessages
            }
            ExprKind::Dot { obj, name, .. } if obj == value && tree.text_of(name) == b"length" => {
                WhereTextGoes::IntoFiles
            }
            _ => WhereTextGoes::Anywhere,
        },
        Parent::VarInit(declaration) if variables_left > 0 => {
            let declaration = hir[declaration];
            if !matches!(hir[declaration.pat].kind, PatKind::Ident(_))
                || declaration.flags.contains(Flags::EXPORT)
            {
                return WhereTextGoes::Anywhere;
            }
            let holder = bound.declared_symbol(Decl::Var(declaration.pat));
            let is_holder = |binding: Binding| binding == Binding::Symbol(holder);
            let mut exported = (0..hir.export_specs.len() as u32).map(ExportSpecId);
            if holder.is_none()
                || !bound.is_stable_binding(holder)
                || bound.is_visible_to_eval(holder)
                || exported.any(|spec| is_holder(bound.exported_binding(spec)))
            {
                return WhereTextGoes::Anywhere;
            }
            let mentions = (0..hir.exprs.len() as u32).map(ExprId).filter(|&mention| {
                matches!(hir[mention].kind, ExprKind::Ident(_)) && is_holder(bound.binding(mention))
            });
            let ways = mentions
                .map(|mention| find_where_text_goes(tree, texts, mention, variables_left - 1));
            ways.max().unwrap_or(WhereTextGoes::IntoFiles)
        }
        Parent::Stmt(_) => WhereTextGoes::IntoFiles,
        _ => WhereTextGoes::Anywhere,
    }
}

fn makes_error(constructor: BuiltinId) -> bool {
    let error = table::entry(BuiltinId::Error).class;
    let mut class = table::entry(table::canonical_id(constructor)).class;
    while let Some(made) = class {
        if class == error {
            return true;
        }
        class = table::class_data(made).parent;
    }
    false
}

fn takes_messages(tree: Tree<'_, '_>, callee: ExprId) -> bool {
    let callee = tree.builtins.builtin_of_expression(callee);
    callee.is_some_and(|callee| {
        let holder = table::entry(table::canonical_id(callee)).holder;
        makes_error(callee) || holder.map(table::canonical_id) == Some(BuiltinId::Console)
    })
}

struct Look<'t> {
    session: &'t Session,
    atoms: Interner<'t>,
    names: BuiltinNames,
}

impl<'t> Look<'t> {
    fn look_at_text(&self, text: &[u8]) -> Option<ReadAsCode> {
        let (arena, atoms) = (self.session.arena(), &self.atoms);
        let parse_options = CompileParseOptions {
            path: PATH_OF_TEXT,
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            ignores_pure_comments: false,
        };
        let text: &'t [u8] = arena.alloc_slice_copy(text);
        let mut hir = parse_for_compile(arena, &parse_options, text, atoms);
        if hir.has_errors
            || hir.ran_out_of_stack
            || matches!(hir.kind, FileKind::Json | FileKind::Declaration)
        {
            return None;
        }
        let has_syntax_error = hir.has_parse_diagnostics;
        hir.text = Cow::Borrowed(text);
        let fold_options = FoldOptions {
            features_are_unknown: true,
            max_string_bytes: MAX_FOLDED_STRING_BYTES,
            ..FoldOptions::default()
        };
        let fold = FoldInputs::new(fold_options, arena);
        let bind_options = BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        };
        let file = inputs_of_file_that_nobody_describes();
        let (mut bound, mut analysis) =
            analyze_file(&mut hir, bind_options, &fold, file, atoms, arena);
        if bound.ran_out_of_stack {
            return None;
        }
        let mut request = TransformRequest {
            path: PATH_OF_TEXT,
            hir: &mut hir,
            bound: &bound,
            analysis: &analysis,
            settings: &TranspileSettings {
                jsx: JsxSettings::default(),
                experimental_decorators: false,
                emits_decorator_metadata: false,
                use_define_for_class_fields: None,
                bun_run_assigns_class_fields: false,
            },
            import_meta_main: None,
        };
        let file_of_run = FileOfTestRun::default();
        if import_used_names(arena, atoms, &mut request, file_of_run) == TreeChange::Changed {
            (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, atoms, arena);
        }
        if bound.ran_out_of_stack {
            return None;
        }
        let module_of = |specifier: ImportSpecifier| match specifier {
            ImportSpecifier::Constant(text) => match atoms.bytes(text) {
                b"@jest/globals" | b"vitest" => table::test_runner(),
                text => find_module_named(text),
            },
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => None,
        };
        let sites = analysis.import_sites.iter();
        let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
            .map(|site| (site.kind, module_of(site.specifier)))
            .collect();
        targets.shared_sort_unstable_by_key(|target| target.0);
        let resolved = resolve_file(&ResolveInput {
            hir: &hir,
            bound: &bound,
            decisions: &analysis.decisions,
            atoms,
            module_format: analysis.module_format,
            targets: &ImportTargets::new(&targets),
            names: &self.names,
            platform: host_platform(),
            dialect: SourceDialect::Program,
            replaced: &[],
            runs_tests: true,
            holds_language: true,
            is_text_asked: false,
        });
        let tree = Tree {
            hir: &hir,
            bound: &bound,
            analysis: &analysis,
            atoms,
            builtins: &resolved,
            folder: None,
        };
        let mut read = ReadAsCode {
            has_syntax_error,
            spies_under_any_name: resolved.hands_spy_on(),
            mocks_any_module: resolved.hands_mock_on(),
            replaced_members: resolved.replaced_members().to_vec(),
            opened_holders: resolved.opened_holders().to_vec(),
            names_added: (resolved.names_added().iter())
                .map(|&(holder, name)| (holder, tree.text_of(name).to_vec()))
                .collect(),
            ..ReadAsCode::default()
        };
        for spy in resolved.spy_calls() {
            if tree.is_dead(spy.call) {
                continue;
            }
            match (spy.name, tree.find_module_whose_object_is(spy.object)) {
                (Some(name), Some(module)) => {
                    let module = tree.text_of(module).to_vec();
                    read.exports_spied
                        .push((module, tree.text_of(name).to_vec()));
                }
                (Some(name), None) => read.names_spied.push(tree.text_of(name).to_vec()),
                (None, Some(module)) => read.modules.push(tree.text_of(module).to_vec()),
                (None, None) => read.spies_under_any_name = true,
            }
        }
        for site in analysis.import_sites {
            let ImportSiteKind::MockModule(call) = site.kind else {
                continue;
            };
            if tree.is_dead(call) {
                continue;
            }
            for name in analysis.alternatives_of(&site.specifier) {
                match *name {
                    ImportSpecifier::Constant(module) => {
                        read.modules.push(tree.text_of(module).to_vec());
                    }
                    ImportSpecifier::Pattern { .. }
                    | ImportSpecifier::OneOf(_)
                    | ImportSpecifier::Unknown => read.mocks_any_module = true,
                }
            }
        }
        let mut texts = TextReader::of_tree(tree, &fold, &file);
        for (expression, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
            if !tree.is_dead(expression) {
                texts.look_at(expression, node.kind);
            }
        }
        let CodeInTexts { written, handed_on } = texts.read_with(self);
        read.in_texts.append(written);
        read.in_texts.append(handed_on);
        Some(read)
    }

    fn look_at_code_in_texts(&self, texts: &[&[u8]]) -> FoundInCode {
        let mut found = FoundInCode::default();
        if !texts.iter().any(|text| may_hold_code(text)) {
            return found;
        }
        let fillers: &[&[u8]] = match texts.len() {
            1 => &[b""],
            _ => &[VALUE_THAT_NOBODY_KNOWS, b"", b"0"],
        };
        let mut read_with_syntax_error: Vec<ReadAsCode> = Vec::new();
        for filler in fillers {
            let unknown = join_texts(texts, filler, StringsWithHoles::AreUnknown);
            let filled = join_texts(texts, filler, StringsWithHoles::HoldFiller);
            let filled = (filled != unknown).then_some(filled);
            for text in [Some(unknown), filled].into_iter().flatten() {
                let body = [b"async function body() {\n", &text[..], b"\n}"].concat();
                let with_names = [IMPORT_OF_NAMES_OF_TEST_RUNNER, &text[..]].concat();
                let takes_spy_from_nowhere =
                    strings::contains(&text, b"spyOn") && !strings::contains(&text, b"bun:test");
                let ways = [
                    takes_spy_from_nowhere.then_some(&with_names[..]),
                    Some(&text[..]),
                    Some(&body[..]),
                ];
                for way in ways.into_iter().flatten() {
                    let Some(inner) = self.look_at_text(way) else {
                        continue;
                    };
                    if inner.has_syntax_error {
                        read_with_syntax_error.push(inner);
                        continue;
                    }
                    found.take_what_code_in_text_does(inner);
                    return found;
                }
            }
        }
        if texts.len() > 1 {
            for mut inner in read_with_syntax_error {
                inner.spies_under_any_name = false;
                inner.mocks_any_module = false;
                inner.opened_holders.clear();
                inner.in_texts.left_open = LeftOpenByText::Nothing;
                found.take_what_code_in_text_does(inner);
            }
        }
        found
    }
}

pub(super) fn inputs_of_file_that_nobody_describes<'s>() -> FileInputs<'s> {
    FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
        own_name: b"text.ts",
    }
}

pub(super) struct TextReader<'a, 's> {
    tree: Tree<'a, 's>,
    texts_of_file: TextsOfFile<'a, 's>,
    candidates: Vec<(ExprId, Vec<Vec<u8>>)>,
}

impl<'a, 's> TextReader<'a, 's> {
    fn of_tree(
        tree: Tree<'a, 's>,
        fold: &'a FoldInputs<'s>,
        file: &'a FileInputs<'s>,
    ) -> TextReader<'a, 's> {
        let decisions = &tree.analysis.decisions;
        TextReader {
            tree,
            texts_of_file: TextsOfFile::new(
                tree.hir, tree.bound, decisions, fold, file, tree.atoms,
            ),
            candidates: Vec::new(),
        }
    }

    pub(super) fn new(
        request: &'a FinishedFile<'a, 's>,
        builtins: &'a ResolvedBuiltins,
        fold: &'a FoldInputs<'s>,
        file: &'a FileInputs<'s>,
    ) -> TextReader<'a, 's> {
        let tree = Tree {
            hir: request.hir,
            bound: request.bound,
            analysis: request.analysis,
            atoms: request.atoms,
            builtins,
            folder: Some(dirname::<Posix>(request.path)),
        };
        TextReader::of_tree(tree, fold, file)
    }

    fn find_text_of(&self, part: ExprId) -> Option<Vec<u8>> {
        let Tree { hir, builtins, .. } = self.tree;
        let part = hir.skip_type_assertions(part);
        let quoted = match hir[part].kind {
            ExprKind::Call(call)
                if hir[call].args.len() == 1
                    && builtins
                        .builtin_of_expression(hir[call].callee)
                        .map(table::canonical_id)
                        == Some(table::canonical_id(BuiltinId::JSONStringify)) =>
            {
                hir.ids(hir[call].args).next()
            }
            _ => None,
        };
        let value = hir.skip_type_assertions(quoted.unwrap_or(part));
        let (text, starts_at_own_directory) = self.texts_of_file.find_path(value)?;
        let text = match starts_at_own_directory {
            true => from_argument(self.tree.folder?, self.tree.text_of(text)),
            false => self.tree.text_of(text).to_vec(),
        };
        Some(match quoted {
            Some(_) => quote(&text),
            None => text,
        })
    }

    fn join_what_is_known(&self, parts: &[Result<&[u8], ExprId>]) -> Vec<Vec<u8>> {
        let (mut texts, mut last): (Vec<Vec<u8>>, Vec<u8>) = (Vec::new(), Vec::new());
        for &part in parts {
            let known = match part {
                Ok(text) => Some(text.to_vec()),
                Err(part) => self.find_text_of(part),
            };
            match known {
                Some(text) => last.extend(text),
                None => texts.push(take(&mut last)),
            }
        }
        texts.push(last);
        texts
    }

    fn join_what_may_hold_code(&self, parts: &[Result<&[u8], ExprId>]) -> Option<Vec<Vec<u8>>> {
        let written: Vec<&[u8]> = parts.iter().filter_map(|part| part.ok()).collect();
        let texts = match find_marks_of_code(&written) {
            (false, false) => return None,
            (true, true) => return Some(self.join_what_is_known(parts)),
            _ => self.join_what_is_known(parts),
        };
        let joined: Vec<&[u8]> = texts.iter().map(Vec::as_slice).collect();
        may_hold_code_together(&joined).then_some(texts)
    }

    fn is_left_of_sum(&self, expression: ExprId) -> bool {
        match self.tree.bound.parent_of_expr(expression) {
            Parent::Expr(parent) => matches!(
                self.tree.hir[parent].kind,
                ExprKind::Binary { op: BinOp::Add, left, .. } if left == expression
            ),
            _ => false,
        }
    }

    fn join_sum(&self, mut sum: ExprId) -> Option<Vec<Vec<u8>>> {
        let hir = self.tree.hir;
        let mut parts: Vec<Result<&[u8], ExprId>> = Vec::new();
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = hir[sum].kind
        {
            parts.push(Err(right));
            sum = left;
        }
        parts.push(Err(sum));
        parts.reverse();
        for part in &mut parts {
            if let Err(operand) = *part
                && let ExprKind::String(text) = hir[operand].kind
            {
                *part = Ok(self.tree.text_of(text));
            }
        }
        let texts = self.join_what_may_hold_code(&parts);
        texts.filter(|texts| texts.len() == 1)
    }

    fn is_piece_of_sum_read_whole(&self, piece: ExprId) -> bool {
        let Tree { hir, bound, .. } = self.tree;
        let mut sum = piece;
        while let Parent::Expr(parent) = bound.parent_of_expr(sum)
            && matches!(hir[parent].kind, ExprKind::Binary { op: BinOp::Add, .. })
        {
            sum = parent;
        }
        sum != piece && self.join_sum(sum).is_some()
    }

    fn keep(&mut self, written_at: ExprId, texts: Vec<Vec<u8>>) {
        let parts: Vec<&[u8]> = texts.iter().map(Vec::as_slice).collect();
        if may_be_code_that_counts(&parts) {
            self.candidates.push((written_at, texts));
        }
    }

    pub(super) fn keep_whole(&mut self, written_at: ExprId, text: &[u8]) {
        if may_be_code_that_counts(&[text]) {
            self.candidates.push((written_at, vec![text.to_vec()]));
        }
    }

    pub(super) fn look_at(&mut self, expression: ExprId, kind: ExprKind) {
        let Tree { hir, analysis, .. } = self.tree;
        match kind {
            ExprKind::String(text) => {
                let text = self.tree.text_of(text);
                if may_be_code_that_counts(&[text]) && !self.is_piece_of_sum_read_whole(expression)
                {
                    self.candidates.push((expression, vec![text.to_vec()]));
                }
            }
            ExprKind::Binary { op: BinOp::Add, .. } if !self.is_left_of_sum(expression) => {
                if let Some(texts) = self.join_sum(expression) {
                    self.keep(expression, texts);
                }
            }
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs));
                let mut parts: Vec<Result<&[u8], ExprId>> = Vec::new();
                parts.extend(texts.next().map(|text| Ok(self.tree.text_of(text))));
                for (substitution, text) in hir.ids(exprs).zip(texts) {
                    parts.extend([Err(substitution), Ok(self.tree.text_of(text))]);
                }
                if let Some(texts) = self.join_what_may_hold_code(&parts) {
                    self.keep(expression, texts);
                }
            }
            ExprKind::Call(_) => {
                if let FoldedValue::Constant(Constant::String(text))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) =
                    analysis.decisions.constant(hir, expression)
                {
                    self.keep_whole(expression, self.tree.text_of(text));
                }
            }
            _ => {}
        }
    }

    fn read_with(self, look: &Look<'_>) -> CodeInTexts {
        let (mut written, mut handed_on) = (FoundInCode::default(), FoundInCode::default());
        for (written_at, texts) in &self.candidates {
            let texts: Vec<&[u8]> = texts.iter().map(Vec::as_slice).collect();
            let of_text = look.look_at_code_in_texts(&texts);
            if of_text.leaves_nothing_open() {
                continue;
            }
            match find_where_text_goes(self.tree, &self.texts_of_file, *written_at, 2) {
                WhereTextGoes::IntoMessages => {}
                WhereTextGoes::IntoFiles => written.append(of_text),
                WhereTextGoes::Anywhere => handed_on.append(of_text),
            }
        }
        CodeInTexts { written, handed_on }
    }

    pub(super) fn finish(self) -> (FoundInTexts, FoundInTexts) {
        if self.candidates.is_empty() {
            return Default::default();
        }
        let atoms_of_file = self.tree.atoms;
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let look = Look {
            session: &session,
            names: BuiltinNames::new(&atoms),
            atoms,
        };
        let CodeInTexts { written, handed_on } = self.read_with(&look);
        (
            written.intern(atoms_of_file),
            handed_on.intern(atoms_of_file),
        )
    }
}
