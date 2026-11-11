use super::Constant;
use super::evaluate::{Primitive, Value};
use super::folder::Folder;
use crate::atom::{Atom, Interner, known};
use crate::bind::{Binding, BindingInitializer, Bound, CommonJsVariable, Decl, SymbolId};
use crate::hir::{BinOp, Branches, Call, Chain, ExprId, ExprKind, File, IdList, MemberKey};
use crate::import_sites::{
    ENCODERS, ImportSiteKind, ImportSpecifier, LONGEST_CHAIN_OF_BINDINGS, LibraryModule,
    call_site_arguments, call_site_kind, find_imported_export, iife_return_value, is_process,
    names_own_file, settled_symbol,
};
use crate::util::{FxHashMap, FxHashSet};
use bun_core::strings;
use smallvec::SmallVec;
use std::cell::RefCell;

#[derive(Copy, Clone)]
enum Part {
    Known(Primitive),
    Expr(ExprId),
    LastPathSegment(ExprId),
    Unknown,
}

enum Expansion {
    Known(Primitive),
    Parts(Vec<Part>),
    Alternatives(Vec<ExprId>),
    OwnDirectory,
    Unknown,
}

#[derive(Copy, Clone)]
enum Nesting {
    Outermost,
    InAlternative,
}

struct Affix {
    text: Vec<u8>,
    is_whole_value: bool,
    starts_at_own_directory: bool,
}

struct SharedPrefix {
    text: Vec<u8>,
    shortest_whole_value: Option<usize>,
}

impl<'s> Folder<'_, 's> {
    pub(super) fn find_specifier(&self, argument: ExprId) -> ImportSpecifier {
        if let Value::Known(value) = self.folded(argument).value {
            return match self.evaluator.to_constant(value) {
                Constant::String(text) => ImportSpecifier::Constant(text),
                _ => ImportSpecifier::Unknown,
            };
        }
        let mut prefix = self.collect_prefix(argument, Nesting::Outermost);
        if prefix.is_whole_value {
            return ImportSpecifier::Constant(self.atoms.intern(&prefix.text));
        }
        let remaining_bytes = self.evaluator.max_string_bytes() - prefix.text.len();
        let mut suffix = self.collect_suffix(argument, remaining_bytes, Nesting::Outermost);
        trim_lead_surrogate_at_end(&mut prefix.text);
        trim_trail_surrogate_at_start(&mut suffix.text);
        if prefix.text.is_empty() && suffix.text.is_empty() {
            return ImportSpecifier::Unknown;
        }
        ImportSpecifier::Pattern {
            prefix: self.atoms.intern(&prefix.text),
            suffix: self.atoms.intern(&suffix.text),
        }
    }

    pub(super) fn starts_at_own_directory(&self, argument: ExprId) -> bool {
        self.collect_prefix(argument, Nesting::Outermost)
            .starts_at_own_directory
    }

    pub(super) fn note_path_written_from_own_directory(&mut self, e: ExprId, end: Atom) {
        if !ends_in_name_with_extension(self.atoms.bytes(end)) {
            return;
        }
        let path = self.collect_prefix(e, Nesting::Outermost);
        if path.is_whole_value && path.starts_at_own_directory {
            let path = self.atoms.intern(&path.text);
            self.paths_written_from_own_directory.push((e, path));
        }
    }

    pub(super) fn starts_with_whole_path_made_by_call(&self, argument: ExprId) -> bool {
        let hir = self.hir;
        let mut start = argument;
        let mut is_joined = false;
        loop {
            start = hir.skip_type_assertions(start);
            let first_part = match hir[start].kind {
                ExprKind::Ident(_) | ExprKind::Dot { .. } if self.names_own_directory(start) => {
                    return is_joined;
                }
                ExprKind::Template { exprs } => {
                    let first_text = hir.ids(hir.template_texts(exprs)).next();
                    let is_first = first_text.is_none_or(|text| self.atoms.bytes(text).is_empty());
                    hir.ids(exprs).next().filter(|_| is_first)
                }
                ExprKind::Binary { op: BinOp::Add, .. } => {
                    self.collect_addends(start).first().copied()
                }
                ExprKind::Ident(_) => self.find_const_initializer(start),
                ExprKind::Call(call)
                    if self.is_dirname_of_own_file(hir[call])
                        || self.asks_for_working_directory(hir[call]) =>
                {
                    return true;
                }
                ExprKind::Call(call) => match self.find_path_joining_call(hir[call]) {
                    Some(function) if function == known::resolve => return true,
                    Some(_) => {
                        is_joined = true;
                        hir.ids(hir[call].args).next()
                    }
                    None => None,
                },
                _ => None,
            };
            let Some(first_part) = first_part else {
                return false;
            };
            start = first_part;
        }
    }

    fn asks_for_working_directory(&self, call: Call) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        matches!(call.chain, Chain::No)
            && call.args.len() == 0
            && matches!(hir.member_key(hir.skip_type_assertions(call.callee)), Some((object, MemberKey::Name(name)))
                if self.atoms.bytes(name) == b"cwd"
                    && is_process(hir, bound, object, &[known::globalThis, known::global]))
    }

    fn expand(&self, e: ExprId) -> Expansion {
        let hir = self.hir;
        let e = hir.skip_type_assertions(e);
        if let Value::Known(value) = self.folded(e).value {
            return Expansion::Known(value);
        }
        match hir[e].kind {
            ExprKind::Template { exprs } => self.expand_template(exprs),
            ExprKind::Binary { op: BinOp::Add, .. } => self.expand_addition(e),
            ExprKind::Ident(_) | ExprKind::Dot { .. } if self.names_own_directory(e) => {
                Expansion::OwnDirectory
            }
            ExprKind::Ident(_) => match self.find_const_initializer(e) {
                Some(initializer) => match hir[hir.skip_type_assertions(initializer)].kind {
                    ExprKind::Call(call) if self.is_dirname_of_own_file(hir[call]) => {
                        Expansion::OwnDirectory
                    }
                    _ => Expansion::Parts(vec![Part::Expr(initializer)]),
                },
                None => Expansion::Unknown,
            },
            ExprKind::Call(call) if self.is_dirname_of_own_file(hir[call]) => {
                Expansion::OwnDirectory
            }
            ExprKind::Call(call) => self.expand_call(hir[call]),
            ExprKind::Cond { .. } => Expansion::Alternatives(self.collect_alternatives(e)),
            _ => Expansion::Unknown,
        }
    }

    fn names_own_directory(&self, e: ExprId) -> bool {
        let hir = self.hir;
        match hir.member_key(e) {
            Some((object, MemberKey::Name(name))) => {
                matches!(
                    hir[hir.skip_type_assertions(object)].kind,
                    ExprKind::ImportMeta
                ) && (name == known::meta_dir || name == known::meta_dirname)
                    && matches!(
                        hir[e].kind,
                        ExprKind::Dot {
                            chain: Chain::No,
                            ..
                        }
                    )
                    && !self.is_replaced_by_define(e)
                    && !self.bound.import_meta_may_be_modified()
            }
            Some(_) => false,
            None => self.find_loader_name(e) == Some(CommonJsVariable::Dirname),
        }
    }

    fn is_dirname_of_own_file(&self, call: Call) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let function = find_export_of_path(hir, bound, call.callee, &|_| None);
        matches!(call.chain, Chain::No)
            && call.args.len() == 1
            && function == Some(known::meta_dirname)
            && names_own_file(hir, bound, hir.id_at(call.args, 0))
    }

    fn collect_alternatives(&self, conditional: ExprId) -> Vec<ExprId> {
        let hir = self.hir;
        let mut alternatives = Vec::new();
        let mut stack = vec![conditional];
        while let Some(e) = stack.pop() {
            let e = hir.skip_type_assertions(e);
            if let ExprKind::Cond { branches, .. } = hir[e].kind {
                let Branches { yes, no } = hir.branches(branches);
                stack.extend([no, yes]);
            } else {
                alternatives.push(e);
            }
        }
        alternatives
    }

    fn expand_template(&self, exprs: IdList<ExprId>) -> Expansion {
        let hir = self.hir;
        let texts = hir.ids(hir.template_texts(exprs));
        let mut texts = texts.map(|text| Part::Known(Primitive::Constant(Constant::String(text))));
        let mut parts = Vec::with_capacity(2 * exprs.len() + 1);
        parts.extend(texts.next());
        for (substitution, text) in hir.ids(exprs).zip(texts) {
            parts.push(Part::Expr(substitution));
            parts.push(text);
        }
        Expansion::Parts(parts)
    }

    fn expand_addition(&self, outermost: ExprId) -> Expansion {
        let addends = self.collect_addends(outermost);
        let first_string = addends
            .iter()
            .position(|&addend| self.is_surely_string(addend));
        let Some(first_string) = first_string else {
            return Expansion::Unknown;
        };
        let (leading_addends, concatenated_addends) = addends.split_at(first_string);
        let mut parts = Vec::with_capacity(concatenated_addends.len() + 1);
        if !leading_addends.is_empty() {
            let values = leading_addends
                .iter()
                .map(|&addend| self.folded(addend).value);
            parts.push(match self.evaluator.add_all(values) {
                Value::Known(sum) => Part::Known(sum),
                Value::Unknown => Part::Unknown,
            });
        }
        parts.extend(
            concatenated_addends
                .iter()
                .map(|&addend| Part::Expr(addend)),
        );
        Expansion::Parts(parts)
    }

    fn expand_encoded_text(&self, call: Call) -> Option<Expansion> {
        let hir = self.hir;
        let callee = hir.skip_type_assertions(call.callee);
        let ExprKind::Ident(name) = hir[callee].kind else {
            return None;
        };
        let (_, encode) = *ENCODERS.iter().find(|it| it.0 == self.atoms.bytes(name))?;
        let is_global =
            self.bound.binding(callee) == Binding::Free && self.has_static_lookup(callee);
        if !is_global || call.chain != Chain::No {
            return None;
        }
        let text = self.collect_prefix(hir.ids(call.args).next()?, Nesting::InAlternative);
        if !text.is_whole_value {
            return None;
        }
        let encoded = Constant::String(self.atoms.intern(&encode(&text.text)?));
        self.has_followed_path_call.set(true);
        Some(Expansion::Known(Primitive::Constant(encoded)))
    }

    fn expand_call(&self, call: Call) -> Expansion {
        if let Some(encoded) = self.expand_encoded_text(call) {
            return encoded;
        }
        let last_argument = self.hir.ids(call.args).next_back();
        match (last_argument, self.find_path_joining_call(call)) {
            (Some(last_argument), Some(function)) => {
                let from_own_directory = self.expand_path_from_own_directory(call, function);
                if from_own_directory.is_some() {
                    self.has_followed_path_call.set(true);
                }
                from_own_directory.unwrap_or_else(|| {
                    Expansion::Parts(vec![Part::Unknown, Part::LastPathSegment(last_argument)])
                })
            }
            (Some(_) | None, Some(_) | None) => Expansion::Unknown,
        }
    }

    fn expand_path_from_own_directory(&self, call: Call, function: Atom) -> Option<Expansion> {
        let is_join = function == known::join;
        let mut arguments = self.hir.ids(call.args);
        let first = arguments.next()?;
        if !matches!(self.expand(first), Expansion::OwnDirectory) {
            return None;
        }
        let mut path = PathBelowFolder::default();
        let mut computed = None;
        for argument in arguments.by_ref() {
            let Value::Known(value) = self.folded(argument).value else {
                computed = Some(argument);
                break;
            };
            if !self.evaluator.is_string(value) {
                return None;
            }
            let mut text = Vec::new();
            self.evaluator.push_text(&mut text, value);
            path.push(&text, is_join)?;
        }
        if computed.is_some() && (path.leaves_folder() || arguments.next().is_some()) {
            return None;
        }
        let written = path.write(is_join, computed.is_some());
        let written = Constant::String(self.atoms.intern(&written));
        let mut parts = vec![Part::Expr(first), Part::Known(Primitive::Constant(written))];
        parts.extend(computed.map(Part::Expr));
        Some(Expansion::Parts(parts))
    }

    fn is_surely_string(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let mut visited_initializers = FxHashSet::default();
        let mut stack = vec![e];
        while let Some(candidate) = stack.pop() {
            let candidate = hir.skip_type_assertions(candidate);
            if let Value::Known(value) = self.folded(candidate).value {
                if self.evaluator.is_string(value) {
                    return true;
                }
                continue;
            }
            match hir[candidate].kind {
                ExprKind::Template { .. } => return true,
                ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    right,
                } => stack.extend([left, right]),
                ExprKind::Ident(_) | ExprKind::Dot { .. }
                    if self.names_own_directory(candidate) =>
                {
                    return true;
                }
                ExprKind::Ident(_) => {
                    let initializer = self.find_const_initializer(candidate);
                    stack.extend(initializer.filter(|&init| visited_initializers.insert(init)));
                }
                ExprKind::Call(call) => {
                    if self.find_path_joining_call(hir[call]).is_some() {
                        return true;
                    }
                }
                ExprKind::Missing
                | ExprKind::PrivateIdentifier(_)
                | ExprKind::This
                | ExprKind::Super
                | ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex { .. }
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Array(_)
                | ExprKind::Object(_)
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::New(_)
                | ExprKind::Unary { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Assign { .. }
                | ExprKind::Cond { .. }
                | ExprKind::Spread(_)
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_)
                | ExprKind::Instantiation { .. }
                | ExprKind::Jsx(_)
                | ExprKind::ImportCall { .. }
                | ExprKind::ImportMeta
                | ExprKind::NewTarget(_)
                | ExprKind::JsxText(_) => {}
            }
        }
        false
    }

    fn collect_prefix(&self, root: ExprId, nesting: Nesting) -> Affix {
        let max_bytes = self.evaluator.max_string_bytes();
        let mut text = Vec::new();
        let mut piece = Vec::new();
        let mut stack = vec![Part::Expr(root)];
        let mut starts_at_own_directory = false;
        let is_whole_value = loop {
            let Some(part) = stack.pop() else {
                break true;
            };
            let value = match part {
                Part::Known(value) => value,
                Part::Expr(e) => match self.expand(e) {
                    Expansion::Known(value) => value,
                    Expansion::Parts(parts) => {
                        stack.extend(parts.into_iter().rev());
                        continue;
                    }
                    Expansion::OwnDirectory
                        if text.is_empty() && matches!(nesting, Nesting::Outermost) =>
                    {
                        text.push(b'.');
                        starts_at_own_directory = true;
                        continue;
                    }
                    Expansion::Alternatives(alternatives) => {
                        let shared = self.collect_shared_prefix(&alternatives, nesting);
                        if text.len() + shared.text.len() > max_bytes {
                            self.evaluator.note_over_limit();
                        } else {
                            strings::push_wtf8(&mut text, &shared.text);
                        }
                        break false;
                    }
                    Expansion::OwnDirectory | Expansion::Unknown => break false,
                },
                Part::LastPathSegment(_) | Part::Unknown => break false,
            };
            piece.clear();
            self.evaluator.push_text(&mut piece, value);
            if text.len() + piece.len() > max_bytes {
                self.evaluator.note_over_limit();
                break false;
            }
            strings::push_wtf8(&mut text, &piece);
        };
        let is_path_from_folder = text.starts_with(b"./") || is_whole_value && text == b".";
        if starts_at_own_directory && !is_path_from_folder {
            return Affix {
                text: Vec::new(),
                is_whole_value: false,
                starts_at_own_directory: false,
            };
        }
        Affix {
            text,
            is_whole_value,
            starts_at_own_directory,
        }
    }

    fn collect_shared_prefix(&self, alternatives: &[ExprId], nesting: Nesting) -> SharedPrefix {
        let mut shared = SharedPrefix {
            text: Vec::new(),
            shortest_whole_value: None,
        };
        let Nesting::Outermost = nesting else {
            return shared;
        };
        for (index, &alternative) in alternatives.iter().enumerate() {
            let prefix = self.collect_prefix(alternative, Nesting::InAlternative);
            if prefix.is_whole_value {
                let shortest = shared.shortest_whole_value.unwrap_or(usize::MAX);
                shared.shortest_whole_value = Some(shortest.min(prefix.text.len()));
            }
            if index == 0 {
                shared.text = prefix.text;
            } else {
                shared
                    .text
                    .truncate(shared_prefix_length(&shared.text, &prefix.text));
            }
        }
        shared
    }

    fn collect_shared_suffix(
        &self,
        alternatives: &[ExprId],
        max_bytes: usize,
        nesting: Nesting,
    ) -> Vec<u8> {
        let Nesting::Outermost = nesting else {
            return Vec::new();
        };
        let prefix = self.collect_shared_prefix(alternatives, nesting);
        let mut max_length = match prefix.shortest_whole_value {
            Some(length) => length - prefix.text.len(),
            None => usize::MAX,
        };
        let mut shared = Vec::new();
        for (index, &alternative) in alternatives.iter().enumerate() {
            let suffix = self
                .collect_suffix(alternative, max_bytes, Nesting::InAlternative)
                .text;
            let compared = if index == 0 { &suffix } else { &shared };
            max_length = shared_suffix_length(compared, &suffix, max_length);
            if index == 0 {
                shared = suffix;
            }
        }
        shared.drain(..shared.len() - max_length);
        shared
    }

    fn collect_suffix(&self, root: ExprId, max_bytes: usize, nesting: Nesting) -> Affix {
        let mut pieces: Vec<Vec<u8>> = Vec::new();
        let mut length = 0;
        let mut segment_starts = Vec::new();
        let mut stack = vec![Part::Expr(root)];
        let is_whole_value = loop {
            let Some(part) = stack.pop() else {
                break true;
            };
            let value = match part {
                Part::Known(value) => value,
                Part::Expr(e) => match self.expand(e) {
                    Expansion::Known(value) => value,
                    Expansion::Parts(parts) => {
                        stack.extend(parts);
                        continue;
                    }
                    Expansion::Alternatives(alternatives) => {
                        let remaining_bytes = max_bytes - length;
                        let mut piece =
                            self.collect_shared_suffix(&alternatives, remaining_bytes, nesting);
                        if !segment_starts.is_empty() {
                            trim_to_last_segment(&mut piece);
                        }
                        length += piece.len();
                        pieces.push(piece);
                        break false;
                    }
                    Expansion::OwnDirectory | Expansion::Unknown => break false,
                },
                Part::LastPathSegment(argument) => {
                    segment_starts.push(pieces.len());
                    stack.push(Part::Expr(argument));
                    continue;
                }
                Part::Unknown => break false,
            };
            let mut piece = Vec::new();
            self.evaluator.push_text(&mut piece, value);
            let starts_segment = !segment_starts.is_empty() && trim_to_last_segment(&mut piece);
            if length + piece.len() > max_bytes {
                self.evaluator.note_over_limit();
                break false;
            }
            length += piece.len();
            pieces.push(piece);
            if starts_segment {
                break false;
            }
        };
        discard_dot_segments(&mut pieces, segment_starts);
        let mut text = Vec::with_capacity(length);
        for piece in pieces.iter().rev() {
            strings::push_wtf8(&mut text, piece);
        }
        Affix {
            text,
            is_whole_value,
            starts_at_own_directory: false,
        }
    }

    fn find_path_joining_call(&self, call: Call) -> Option<Atom> {
        match call.chain {
            Chain::No => self.find_path_joining_function(call.callee),
            Chain::Start | Chain::Continue => None,
        }
    }

    fn find_path_joining_function(&self, callee: ExprId) -> Option<Atom> {
        find_path_joining_function(self.hir, self.bound, callee, &|argument| match self
            .folded(argument)
            .value
        {
            Value::Known(specifier) => Some(self.evaluator.to_constant(specifier)),
            Value::Unknown => None,
        })
    }
}

pub fn ends_in_name_with_extension(text: &[u8]) -> bool {
    let name = text.rsplit(|&byte| byte == b'/').next().unwrap_or(text);
    matches!(strings::last_index_of_char(name, b'.'), Some(dot) if dot != 0 && dot + 1 != name.len())
}

#[derive(Default)]
pub(crate) struct PathBelowFolder {
    segments: Vec<Vec<u8>>,
    ends_with_slash: bool,
}

impl PathBelowFolder {
    pub(crate) fn push(&mut self, text: &[u8], is_join: bool) -> Option<()> {
        if !is_join && text.starts_with(b"/") || strings::contains_char(text, b'\\') {
            return None;
        }
        if !text.is_empty() {
            self.ends_with_slash = text.ends_with(b"/");
        }
        for segment in strings::split(text, b"/") {
            match segment {
                b"" | b"." => {}
                b".." if self.segments.last().is_some_and(|last| last != b"..") => {
                    self.segments.pop();
                }
                _ => self.segments.push(segment.to_vec()),
            }
        }
        Some(())
    }

    pub(crate) fn leaves_folder(&self) -> bool {
        self.segments.first().is_some_and(|first| first == b"..")
    }

    pub(crate) fn write(&self, is_join: bool, is_followed: bool) -> Vec<u8> {
        let mut written = Vec::new();
        for segment in &self.segments {
            written.push(b'/');
            written.extend_from_slice(segment);
        }
        if is_followed || is_join && self.ends_with_slash {
            written.push(b'/');
        }
        written
    }
}

fn find_path_joining_function(
    hir: &File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
    find_constant: &dyn Fn(ExprId) -> Option<Constant>,
) -> Option<Atom> {
    let joins_paths = |member: &Atom| *member == known::join || *member == known::resolve;
    find_export_of_path(hir, bound, callee, find_constant).filter(joins_paths)
}

pub fn find_export_of_path_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    named: ExprId,
) -> Option<Atom> {
    let find_written_text = |text: ExprId| match hir[hir.skip_type_assertions(text)].kind {
        ExprKind::String(text) => Some(Constant::String(text)),
        _ => None,
    };
    find_export_of_path(hir, bound, named, &find_written_text)
}

/// `LibraryModule::Path` alone: the fold takes `dirname()`, `join()` and `resolve()` for the functions of the platform,
/// which those of `PathPosix` are not on Windows.
fn find_export_of_path(
    hir: &File<'_>,
    bound: &Bound<'_>,
    read: ExprId,
    find_constant: &dyn Fn(ExprId) -> Option<Constant>,
) -> Option<Atom> {
    let walk = Walk::OF_VALUE;
    match find_export_of_library_module(hir, bound, read, walk, find_constant, None, None)? {
        (LibraryModule::Path, export) => Some(export),
        _ => None,
    }
}

/// The module of the library that `read` was read off, and the members that it names below it.
pub(crate) fn find_members_below_library_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    read: ExprId,
    walk: Walk,
    find_constant: &dyn Fn(ExprId) -> Option<Constant>,
    atoms: Option<&Interner<'_>>,
    known: Option<&MembersBehindNames>,
) -> Option<(LibraryModule, SmallVec<[Atom; 4]>)> {
    let find_asked = |e: ExprId| find_module_that_value_asks_for(hir, bound, e, find_constant);
    let read = walk_to_module(hir, bound, read, walk, &find_asked, known)?;
    Some((
        LibraryModule::of_specifier(read.specifier, atoms)?,
        read.members,
    ))
}

pub(crate) fn find_export_of_library_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    read: ExprId,
    walk: Walk,
    find_constant: &dyn Fn(ExprId) -> Option<Constant>,
    atoms: Option<&Interner<'_>>,
    known: Option<&MembersBehindNames>,
) -> Option<(LibraryModule, Atom)> {
    let (module, members) =
        find_members_below_library_module(hir, bound, read, walk, find_constant, atoms, known)?;
    module.export_of(&members, atoms)
}

/// For a module of the program or of the test runner. `LibraryModule` names the modules of the library.
pub(crate) fn find_members_below_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    read: ExprId,
    walk: Walk,
    find_constant: &dyn Fn(ExprId) -> Option<Constant>,
    is_module: &dyn Fn(Atom) -> bool,
) -> Option<ReadOffModule> {
    let find_asked = |e: ExprId| find_module_that_value_asks_for(hir, bound, e, find_constant);
    walk_to_module(hir, bound, read, walk, &find_asked, None).filter(|it| is_module(it.specifier))
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ModuleFace {
    Namespace,
    Exports,
}

/// What one reader follows on the way from an expression to the module it was read off, and another does not.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct Walk {
    follows_later_bindings: bool,
    follows_called_functions: bool,
    follows_awaited_imports: bool,
    reads_optional_members: bool,
    reads_default_of_namespace: bool,
    most_steps: usize,
}

impl Walk {
    /// A value: a name holds what is written in front of the read, and nothing else is known to have run.
    pub(crate) const OF_VALUE: Walk = Walk {
        follows_later_bindings: false,
        follows_called_functions: false,
        follows_awaited_imports: false,
        reads_optional_members: false,
        reads_default_of_namespace: false,
        most_steps: usize::MAX,
    };

    pub(crate) const OF_CHANGED_FILES: Walk = Walk {
        follows_awaited_imports: true,
        ..Walk::OF_VALUE
    };

    /// The maker of a require and the calls inside its base. A name may be bound behind the read: code that runs
    /// before the binding throws under `bun run` too. A base that went through a call is held against the path of the
    /// run.
    pub(crate) const OF_MAKER: Walk = Walk {
        follows_later_bindings: true,
        follows_called_functions: true,
        follows_awaited_imports: true,
        reads_optional_members: true,
        reads_default_of_namespace: true,
        most_steps: LONGEST_CHAIN_OF_BINDINGS + 1,
    };
}

/// `members` start at the one that is read last: `m.a.b` is `[b, a]` below `m`.
pub(crate) struct ReadOffModule {
    pub(crate) specifier: Atom,
    pub(crate) members: SmallVec<[Atom; 4]>,
}

/// What `Walk::OF_VALUE` found behind a name: the specifier and the members below it, or that no module is there.
#[derive(Default)]
pub(crate) struct MembersBehindNames(
    RefCell<FxHashMap<SymbolId, Option<(Atom, SmallVec<[Atom; 4]>)>>>,
);

/// The one loop from an expression to the module it was read off. `find_asked` answers for what is no name and no
/// member: the module that a call or an awaited `import()` asks for.
pub(crate) fn walk_to_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    read: ExprId,
    walk: Walk,
    find_asked: &dyn Fn(ExprId) -> Option<(Atom, ModuleFace)>,
    known: Option<&MembersBehindNames>,
) -> Option<ReadOffModule> {
    debug_assert!(known.is_none() || walk == Walk::OF_VALUE);
    let mut members: SmallVec<[Atom; 4]> = SmallVec::new();
    let mut came_by: Vec<(SymbolId, usize)> = Vec::new();
    let mut steps_left = walk.most_steps;
    let mut e = read;
    let module = loop {
        e = hir.skip_type_assertions(e);
        let Some(kind) = hir.exprs.get(e.idx()).map(|it| it.kind) else {
            break None;
        };
        if let ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } = kind {
            let Some((object, MemberKey::Name(name))) = hir.member_key(e) else {
                break None;
            };
            if chain != Chain::No && !walk.reads_optional_members {
                break None;
            }
            members.push(name);
            e = object;
            continue;
        }
        let Some(left) = steps_left.checked_sub(1) else {
            break None;
        };
        steps_left = left;
        if walk.follows_called_functions
            && let Some(returned) = iife_return_value(hir, e)
        {
            e = returned;
            continue;
        }
        let symbol = match kind {
            ExprKind::Ident(_) => settled_symbol(hir, bound, e),
            ExprKind::Await(_) if !walk.follows_awaited_imports => break None,
            _ => break find_asked(e),
        };
        let Some(symbol) = symbol else {
            break None;
        };
        let initializer = bound.binding_initializer(hir, symbol);
        let goes_on = matches!(
            initializer,
            BindingInitializer::Expression(source)
            | BindingInitializer::PatternProperty { source, .. }
                if walk.follows_later_bindings || source < e
        );
        if goes_on && let Some(known) = known {
            match known.0.borrow().get(&symbol) {
                Some(Some((specifier, rest))) => {
                    members.extend(rest.iter().copied());
                    break Some((*specifier, ModuleFace::Exports));
                }
                Some(None) => break None,
                None => came_by.push((symbol, members.len())),
            }
        }
        match initializer {
            BindingInitializer::Expression(source) if goes_on => e = source,
            BindingInitializer::PatternProperty { source, path } if goes_on => {
                members.extend(path.iter().rev().copied());
                e = source;
            }
            BindingInitializer::Import => {
                let Some((specifier, export)) = find_imported_export(hir, bound, symbol) else {
                    break None;
                };
                members.extend(export);
                let mut declarations = bound.symbol(symbol).decls.iter();
                let is_namespace = export.is_some()
                    || declarations.any(|it| matches!(it, Decl::ImportNamespace(_)));
                break Some(match is_namespace {
                    true => (specifier, ModuleFace::Namespace),
                    false => (specifier, ModuleFace::Exports),
                });
            }
            _ => break None,
        }
    };
    if let Some((_, ModuleFace::Namespace)) = module
        && walk.reads_default_of_namespace
        && members.last() == Some(&known::default)
    {
        members.pop();
    }
    if let Some(known) = known {
        let mut known = known.0.borrow_mut();
        for (symbol, passed) in came_by {
            let rest = module.map(|(specifier, _)| (specifier, members[passed..].into()));
            known.insert(symbol, rest);
        }
    }
    let (specifier, _) = module?;
    Some(ReadOffModule { specifier, members })
}

/// A call that the scan takes for `require()`, `import.meta.require()` or `process.getBuiltinModule()`, and an
/// awaited `import()`, by what the first argument folds to.
fn find_module_that_value_asks_for(
    hir: &File<'_>,
    bound: &Bound<'_>,
    request: ExprId,
    find_constant: &dyn Fn(ExprId) -> Option<Constant>,
) -> Option<(Atom, ModuleFace)> {
    let (arguments, face) = match hir[request].kind {
        ExprKind::Call(call) => match call_site_kind(hir, bound, request)? {
            ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
            | ImportSiteKind::GetBuiltinModule(_) => (hir[call].args, ModuleFace::Exports),
            ImportSiteKind::JsxRuntime
            | ImportSiteKind::JsxPackage
            | ImportSiteKind::Import(_)
            | ImportSiteKind::ExportFrom(_)
            | ImportSiteKind::ExportStar(_)
            | ImportSiteKind::ImportEquals(_)
            | ImportSiteKind::ImportCall(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaResolve(_)
            | ImportSiteKind::MockModule(_)
            | ImportSiteKind::ImportByTestRunner(_)
            | ImportSiteKind::RequireByTestRunner(_) => return None,
        },
        ExprKind::Await(awaited) => {
            let awaited = hir.skip_type_assertions(awaited);
            match call_site_kind(hir, bound, awaited)? {
                ImportSiteKind::ImportCall(_) => (
                    call_site_arguments(hir, bound, awaited)?,
                    ModuleFace::Namespace,
                ),
                _ => return None,
            }
        }
        _ => return None,
    };
    match find_constant(hir.ids(arguments).next()?)? {
        Constant::String(specifier) => Some((specifier, face)),
        _ => None,
    }
}

fn is_segment_boundary(byte: u8) -> bool {
    matches!(byte, b'/' | b'\\' | b':')
}

pub(crate) fn trim_to_last_segment(text: &mut Vec<u8>) -> bool {
    match text.iter().rposition(|&byte| is_segment_boundary(byte)) {
        Some(boundary) => {
            text.drain(..=boundary);
            true
        }
        None => false,
    }
}

fn discard_dot_segments(pieces: &mut Vec<Vec<u8>>, mut segment_starts: Vec<usize>) {
    while let Some(start) = segment_starts.pop() {
        if pieces[start..].iter().flatten().any(|&byte| byte != b'.') {
            return;
        }
        pieces.truncate(start);
    }
}

fn is_continuation_byte(byte: u8) -> bool {
    byte & 0xC0 == 0x80
}

fn shared_prefix_length(first: &[u8], second: &[u8]) -> usize {
    let splits_character = |text: &[u8], at: usize| {
        let next = text.get(at);
        next.is_some_and(|&byte| is_continuation_byte(byte))
    };
    let pairs = first.iter().zip(second);
    let mut length = pairs.take_while(|(a, b)| a == b).count();
    while splits_character(first, length) || splits_character(second, length) {
        length -= 1;
    }
    length
}

fn shared_suffix_length(first: &[u8], second: &[u8], max_length: usize) -> usize {
    let pairs = first.iter().rev().zip(second.iter().rev());
    let mut length = pairs.take_while(|(a, b)| a == b).count().min(max_length);
    while length > 0 && is_continuation_byte(first[first.len() - length]) {
        length -= 1;
    }
    length
}

pub(crate) fn trim_lead_surrogate_at_end(text: &mut Vec<u8>) {
    if matches!(text[..], [.., 0xED, 0xA0..=0xAF, _]) {
        text.truncate(text.len() - 3);
    }
}

pub(crate) fn trim_trail_surrogate_at_start(text: &mut Vec<u8>) {
    if matches!(text[..], [0xED, 0xB0..=0xBF, _, ..]) {
        text.drain(..3);
    }
}
