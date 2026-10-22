use super::Constant;
use super::evaluate::{Primitive, Value};
use super::folder::Folder;
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingStability, CommonJsVariable, Decl, SymbolId,
};
use crate::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, Flags, IdList, MemberKey, NodeData,
};
use crate::import_sites::{ImportSiteKind, ImportSpecifier, call_site_kind};
use crate::util::FxHashSet;
use bun_core::strings;
use smallvec::SmallVec;

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
    /// `__dirname`, `import.meta.dir` or `import.meta.dirname` of the file.
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

enum BindingSource {
    Expression {
        source: ExprId,
        members: SmallVec<[Atom; 2]>,
    },
    ModuleExport {
        specifier: Atom,
        export: Option<Atom>,
    },
    Unknown,
}

impl<'s> Folder<'_, 's> {
    pub(super) fn find_specifier(&self, argument: ExprId) -> ImportSpecifier {
        if let Value::Known(value) = self.folded(argument).value {
            return match self.evaluator.to_constant(value) {
                Constant::String(text) => ImportSpecifier::Constant(text),
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::Number(_)
                | Constant::BigInt(_) => ImportSpecifier::Unknown,
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

    /// Whether the "." at the head of the prefix stands for `__dirname`: the text of the program begins with the folder itself.
    pub(super) fn starts_at_own_directory(&self, argument: ExprId) -> bool {
        self.collect_prefix(argument, Nesting::Outermost)
            .starts_at_own_directory
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
                Some(initializer) => Expansion::Parts(vec![Part::Expr(initializer)]),
                None => Expansion::Unknown,
            },
            ExprKind::Call(call) => self.expand_call(hir[call]),
            ExprKind::Cond { .. } => Expansion::Alternatives(self.collect_alternatives(e)),
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
            | ExprKind::JsxText(_) => Expansion::Unknown,
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

    fn expand_call(&self, call: Call) -> Expansion {
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

    /// `path.join(__dirname, "lib", name + ".js")`: the folder of the file, "/lib/", and the last argument.
    fn expand_path_from_own_directory(&self, call: Call, function: Atom) -> Option<Expansion> {
        let is_join = function == known::join;
        let mut ends_with_slash = false;
        let mut arguments = self.hir.ids(call.args);
        let first = arguments.next()?;
        if !matches!(self.expand(first), Expansion::OwnDirectory) {
            return None;
        }
        let mut segments: Vec<Vec<u8>> = Vec::new();
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
            // `path.resolve` begins again at an absolute path.
            if !is_join && text.starts_with(b"/") || bun_core::strings::contains_char(&text, b'\\')
            {
                return None;
            }
            if !text.is_empty() {
                ends_with_slash = text.ends_with(b"/");
            }
            for segment in bun_core::strings::split(&text, b"/") {
                match segment {
                    b"" | b"." => {}
                    b".." if segments.last().is_some_and(|last| last != b"..") => {
                        segments.pop();
                    }
                    _ => segments.push(segment.to_vec()),
                }
            }
        }
        let leaves_folder = segments.first().is_some_and(|first| first == b"..");
        if computed.is_some() && (leaves_folder || arguments.next().is_some()) {
            return None;
        }
        let mut written = Vec::new();
        for segment in &segments {
            written.push(b'/');
            written.extend_from_slice(segment);
        }
        // `path.join` keeps a trailing slash, which names the folder and not a file of that name. `path.resolve` drops it.
        if computed.is_some() || is_join && ends_with_slash {
            written.push(b'/');
        }
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
                    // What follows the folder of the file at the head of a specifier is a path from that folder.
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
        // `__dirname + "2/a.js"` names a file of another folder.
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
        // The prefix and the suffix of a pattern never share a byte of a value.
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
        let hir = self.hir;
        let mut pending_members: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut e = callee;
        let is_path_module = loop {
            e = hir.skip_type_assertions(e);
            match hir[e].kind {
                ExprKind::Dot {
                    chain: Chain::No, ..
                }
                | ExprKind::Index {
                    chain: Chain::No, ..
                } => match hir.member_key(e) {
                    Some((object, MemberKey::Name(name))) => {
                        pending_members.push(name);
                        e = object;
                    }
                    Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => {
                        break false;
                    }
                },
                ExprKind::Ident(_) => match self.find_binding_source(e) {
                    BindingSource::Expression { source, members } if source < e => {
                        pending_members.extend(members.iter().rev().copied());
                        e = source;
                    }
                    BindingSource::ModuleExport { specifier, export } => {
                        pending_members.extend(export);
                        break is_path_specifier(specifier);
                    }
                    BindingSource::Expression { .. } | BindingSource::Unknown => break false,
                },
                ExprKind::Call(call) => break self.is_path_module_request(e, hir[call]),
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
                | ExprKind::Template { .. }
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
                | ExprKind::JsxText(_) => break false,
            }
        };
        let joins_paths = |member: Atom| member == known::join || member == known::resolve;
        match pending_members[..] {
            [member] if is_path_module && joins_paths(member) => Some(member),
            _ => None,
        }
    }

    fn is_path_module_request(&self, request: ExprId, call: Call) -> bool {
        let returns_exports = match call_site_kind(self.hir, self.bound, request) {
            Some(
                ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::GetBuiltinModule(_),
            ) => true,
            Some(
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportEquals(_)
                | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_),
            )
            | None => false,
        };
        if !returns_exports {
            return false;
        }
        let argument = self.hir.ids(call.args).next();
        let Some(Value::Known(specifier)) = argument.map(|argument| self.folded(argument).value)
        else {
            return false;
        };
        match self.evaluator.to_constant(specifier) {
            Constant::String(text) => is_path_specifier(text),
            Constant::Undefined
            | Constant::Null
            | Constant::Boolean(_)
            | Constant::Number(_)
            | Constant::BigInt(_) => false,
        }
    }

    fn find_binding_source(&self, ident: ExprId) -> BindingSource {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = match bound.binding(ident) {
            Binding::Symbol(symbol) => symbol,
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                return BindingSource::Unknown;
            }
        };
        if bound.dynamic_lookup_scope(NodeData::Expr(ident)).is_some() {
            return BindingSource::Unknown;
        }
        match bound.binding_stability(symbol) {
            BindingStability::Stable | BindingStability::Linked => {}
            BindingStability::NoBinding
            | BindingStability::Stored
            | BindingStability::NotInitializedOnce
            | BindingStability::VisibleToEval
            | BindingStability::MappedArgument
            | BindingStability::ContainerMember => return BindingSource::Unknown,
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => BindingSource::Expression {
                source,
                members: SmallVec::new(),
            },
            BindingInitializer::PatternProperty { source, path } => BindingSource::Expression {
                source,
                members: path,
            },
            BindingInitializer::Import => self.find_import_source(symbol),
            BindingInitializer::Class(_)
            | BindingInitializer::Function(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_)
            | BindingInitializer::EntityName(_)
            | BindingInitializer::Opaque => BindingSource::Unknown,
        }
    }

    fn find_import_source(&self, symbol: SymbolId) -> BindingSource {
        let hir = self.hir;
        for &decl in self.bound.symbol(symbol).decls {
            let (specifier, export, is_type_only) = match decl {
                Decl::ImportDefault(import) | Decl::ImportNamespace(import) => {
                    (hir[import].spec, None, hir[import].type_only)
                }
                Decl::ImportSpec(spec) => {
                    let spec = &hir[spec];
                    let import = &hir[spec.import];
                    let export = (spec.imported != known::default).then_some(spec.imported);
                    (import.spec, export, spec.type_only || import.type_only)
                }
                Decl::ImportEquals(import) => {
                    let import = &hir[import];
                    let is_type_only = import.flags.contains(Flags::TYPE_ONLY);
                    (import.target.spec(), None, is_type_only)
                }
                Decl::Var(_)
                | Decl::Param(_)
                | Decl::Fn(_)
                | Decl::Class(_)
                | Decl::Interface(_)
                | Decl::Alias(_)
                | Decl::Enum(_)
                | Decl::EnumMember(_)
                | Decl::Module(_)
                | Decl::TypeParam(_)
                | Decl::ExportSpec(_)
                | Decl::ExportStarAs(_)
                | Decl::ExportExpr(_)
                | Decl::UmdGlobal(_)
                | Decl::File
                | Decl::Require(_)
                | Decl::ModuleExports(_)
                | Decl::ExportsProperty(_)
                | Decl::Expando(_)
                | Decl::ObjectLiteral(_)
                | Decl::CommonJsVariable
                | Decl::Member(_)
                | Decl::ParameterProperty(_)
                | Decl::ThisProperty(_)
                | Decl::Property(_)
                | Decl::TypeLiteral(_) => continue,
            };
            if !is_type_only {
                return BindingSource::ModuleExport { specifier, export };
            }
        }
        BindingSource::Unknown
    }
}

fn is_path_specifier(specifier: Atom) -> bool {
    specifier == known::path || specifier == known::node_path
}

fn is_segment_boundary(byte: u8) -> bool {
    matches!(byte, b'/' | b'\\' | b':')
}

fn trim_to_last_segment(text: &mut Vec<u8>) -> bool {
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

fn trim_lead_surrogate_at_end(text: &mut Vec<u8>) {
    if matches!(text[..], [.., 0xED, 0xA0..=0xAF, _]) {
        text.truncate(text.len() - 3);
    }
}

fn trim_trail_surrogate_at_start(text: &mut Vec<u8>) {
    if matches!(text[..], [0xED, 0xB0..=0xBF, _, ..]) {
        text.drain(..3);
    }
}
