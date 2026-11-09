//! A file's syntax tree, as lint rules and the formatter see it.
//!
//! Nothing is converted or copied. This is the HIR the parser produces for the type checker (`bun_sema::hir`), plus the
//! binder's tables (`bun_sema::bind`), wrapped in handles that can't be misused. A handle ([`Expr`], [`Stmt`],
//! [`TypeNode`], [`Pat`], [`Func`], ..) is a reference to the [`File`] plus an index. It's `Copy`, two words wide, and
//! compares by identity. `kind()` returns an enum to `match` on, whose fields are handles too.
//!
//! - An id that the HIR leaves empty is an `Option`, never a sentinel.
//! - Parentheses aren't nodes. `(a)` is `a`, [`Expr::is_parenthesized`] is true for it, and [`Expr::outer_span`]
//!   includes them.
//! - Every handle has a [`Span`], from its first token to the end of its last.
//! - [`Node`] is any handle, for operations that apply to all of them: `parent()`, `ancestors()`, reports.
//!
//! The HIR is built for the type checker. Where it contains something that isn't in the source, the handles hide it or
//! flag it:
//! - Nodes synthesized from JSDoc comments in JavaScript are skipped by every list and accessor. The cast in
//!   `/** @type {T} */ (e)` is just a parenthesized `e`.
//! - A template without substitutions is a [`ExprKind::Template`], though the HIR stores a string.
//! - These aren't nodes: the [wrapper](Stmt::is_wrapper) statement around the expression in a `for` head or around a
//!   `with` statement's object, the [nested](Module::nested) `B` of `namespace A.B`, and the object of
//!   `with { type: "json" }` ([`ImportAttributes`]). No listener is called with them, a walk skips over them, and
//!   nothing has them as its parent.
//! - Placeholders are [`ExprKind::Missing`] and [`PatKind::Missing`]: a hole in an array, the empty `{}` of JSX. They
//!   aren't nodes either.
//! - `x!!` is a single [`ExprKind::NonNull`]. See [`Expr::inner_non_null_spans`].
//! - The default in the shorthand `{ a = 1 }` is an [`ExprKind::Assign`] that's the property's value. Every element of
//!   a tuple type has a [`TupleElem`], even a plain `T`.

pub mod comments;
mod decl;
mod entities;
mod expr;
mod flow;
pub mod jsdoc;
mod list;
mod name;
mod node;
mod pat;
mod reach;
mod stmt;
mod ty;
pub mod walk;

pub use decl::*;
pub use expr::*;
pub use list::{Iter as ListIter, List};
pub use name::{Ident, Name};
pub use node::{Ancestors, Node, Packed};
pub use pat::*;
#[doc(hidden)]
pub use reach::NOT_IN_TREE;
pub use stmt::*;
pub use ty::*;

pub use bun_sema::hir::{
    BinOp, Chain, ExprTag, FileKind, Flags, FnKind, Keyword, MappedModifier, MemberKind, PropKind,
    UnOp, VarKind,
};

use crate::language::LanguageOptions;
use crate::span::Span;
use bun_sema::atom::{Atom, Intern};
use bun_sema::{bind, hir};
use std::cell::{Cell, OnceCell};

macro_rules! slices {
    ($(#[$doc:meta])* $name:ident of $module:ident::$source:ident { $($field:ident: $ty:ty,)* }) => {
        $(#[$doc])*
        pub(crate) struct $name<'a> {
            $(pub(crate) $field: &'a [$ty],)*
        }

        impl<'a> $name<'a> {
            /// Generic over where the lists are stored.
            fn new<S: hir::Storage>(source: &'a $module::$source<S>) -> Self {
                $name { $($field: &source.$field[..],)* }
            }
        }
    };
}

slices! {
    /// The vectors of a `hir::File` as slices. That type is invariant in its session's lifetime and these slices
    /// aren't, which is what lets every handle have a single lifetime.
    Hir of hir::FileIn {
        text: u8,
        ids: u32,
        numbers: f64,
        exprs: hir::Expr,
        stmts: hir::Stmt,
        types: hir::TypeNode,
        pats: hir::Pat,
        pat_props: hir::PatProp,
        pat_elems: hir::PatElem,
        fns: hir::Func,
        params: hir::Param,
        type_params: hir::TypeParam,
        classes: hir::Class,
        interfaces: hir::Interface,
        aliases: hir::Alias,
        enums: hir::Enum,
        enum_members: hir::EnumMember,
        modules: hir::Module,
        members: hir::Member,
        props: hir::Prop,
        var_decls: hir::VarDecl,
        calls: hir::Call,
        cases: hir::Case,
        jsx: hir::Jsx,
        imports: hir::Import,
        import_specs: hir::ImportSpec,
        import_equals: hir::ImportEquals,
        exports: hir::Export,
        export_specs: hir::ExportSpec,
        tuple_elems: hir::TupleElem,
        mapped: hir::Mapped,
        modifiers: hir::Modifier,
        names: hir::Name,
        parens: (hir::ExprId, u32, u32),
        non_null_ends: (hir::ExprId, u32),
        far_names: (hir::ExprId, u32),
        tagged_templates: (hir::CallId, hir::ExprId),
        jsx_expressions: (hir::ExprId, u32, u32),
        body_starts: (hir::FnId, u32),
        modifiers_of_params: hir::Span<hir::ModifierId>,
        modifiers_of_stmts: (hir::StmtId, hir::Span<hir::ModifierId>),
        modifiers_of_props: (hir::PropId, hir::Span<hir::ModifierId>),
        with_bodies: (u32, u32),
        detached_semicolons: (u32, u32),
        import_attributes: (u32, hir::ExprId),
        deferred_import_calls: (hir::ExprId, u32),
        jsdoc_comments: (u32, u32),
        comments: hir::Comment,
        keyword_identifier_positions: u32,
        mentioned: u64,
        diagnostics: hir::Diagnostic,
    }
}

slices! {
    /// Same, for a `bind::Bound`'s side tables.
    Bound of bind::BoundIn {
        ids: u32,
        expr_parent: bind::PackedParent,
        stmt_parent: bind::PackedParent,
        type_scope: bind::ScopeId,
        pat_parent: bind::PatParent,
        prop_owner: hir::ExprId,
        member_owner: bind::MemberOwner,
        param_fn: hir::FnId,
        type_param_scope: bind::ScopeId,
        fns: bind::FnInfo,
        class_owner: bind::ClassOwner,
        class_scope: bind::ScopeId,
        enum_member_owner: hir::EnumId,
        var_stmt: hir::StmtId,
        case_stmt: hir::StmtId,
        type_query_operands: hir::ExprId,
        expr_kinds: u8,
        expr_kind_counts: u32,
        kind_counts: u32,
    }
}

impl Hir<'_> {
    /// Returns the modifiers of statement `s`, like `node.Modifiers()`.
    pub(crate) fn stmt_modifiers(&self, s: hir::StmtId) -> hir::Span<hir::ModifierId> {
        hir::stmt_modifiers_in(self.modifiers_of_stmts, s)
    }

    /// Returns the offset where the property name of the `Dot` expression `e` starts.
    #[inline]
    pub(crate) fn name_pos(&self, e: hir::ExprId) -> u32 {
        hir::name_pos_in(self.exprs, self.far_names, e)
    }

    #[inline]
    pub(crate) fn branches(&self, at: hir::BranchesAt) -> hir::Branches {
        at.of(self.ids)
    }

    #[inline]
    pub(crate) fn list_at<T>(&self, list: hir::ListAt<T>) -> hir::IdList<T> {
        list.of(self.ids)
    }
}

impl Bound<'_> {
    /// Returns `Parent::None` if `e` isn't an expression in this file.
    #[inline]
    pub(crate) fn parent_of_expr(&self, e: hir::ExprId) -> bind::Parent {
        let parent = self.expr_parent.get(e.idx()).copied();
        parent.unwrap_or_default().get()
    }

    /// Returns `Parent::None` if `s` isn't a statement in this file.
    #[inline]
    pub(crate) fn parent_of_stmt(&self, s: hir::StmtId) -> bind::Parent {
        let parent = self.stmt_parent.get(s.idx()).copied();
        parent.unwrap_or_default().get()
    }
}

/// The first and last of [`Lazy::unicode_escapes`]. It covers the whole text until those are computed, and it's empty
/// if there are none.
struct UnicodeEscapeRange(Cell<(u32, u32)>);

impl Default for UnicodeEscapeRange {
    fn default() -> Self {
        UnicodeEscapeRange(Cell::new((0, u32::MAX)))
    }
}

/// Values computed from a file lazily, once each.
#[derive(Default)]
pub(crate) struct Lazy {
    pub(crate) lines: OnceCell<crate::source::Lines>,
    pub(crate) tokens: OnceCell<crate::tokens::TokenStore>,
    pub(crate) parents: OnceCell<node::Parents>,
    pub(crate) jsdoc: OnceCell<bun_sema::check::jsdoc::Outline>,
    has_error_types: OnceCell<bool>,
    /// [`crate::utils::oxlint::source_type`]
    pub(crate) oxc_source_type: OnceCell<crate::language::SourceType>,
    /// [`File::backslashes`]
    backslashes: OnceCell<Box<[u32]>>,
    /// The offset of every `\u` in the text, in order.
    unicode_escapes: OnceCell<Box<[u32]>>,
    unicode_escape_range: UnicodeEscapeRange,
    /// One bit per expression, set if it's in parentheses.
    parenthesized: OnceCell<Box<[u64]>>,
    /// [`Node::index`]
    pub(crate) kind_index_offsets: OnceCell<[u32; node::KINDS + 1]>,
    /// [`Stmt::directive`]
    pub(crate) directives: Cell<Option<(u32, u32)>>,
    /// The enclosing array or object from the last [`Expr::is_assignment_target`] call, and its answer.
    pub(crate) last_assignment_target: Cell<Option<(hir::ExprId, bool)>>,
    /// Maps each `a, b` nested deep at the start of a long `a, b, c, ..` to the whole sequence.
    pub(crate) sequence_roots: OnceCell<rustc_hash::FxHashMap<hir::ExprId, hir::ExprId>>,
    /// The start and end of the `a.b` in each `<a.b>` and `</a.b>`, in order.
    jsx_tags_with_dots: OnceCell<Box<[(u32, u32)]>>,
    pub(crate) references: crate::semantic::ReferenceIndex,
    pub(crate) by_kind: crate::runner::ByKind,
    pub(crate) code_paths: crate::code_path::Store,
    pub(crate) linter: crate::linter::PerFile,
    extensions: [OnceCell<Box<dyn std::any::Any>>; 2],
}

/// The file being linted or formatted.
pub struct File<'a> {
    pub(crate) hir: Hir<'a>,
    /// `hir.exprs`, if there are no casts to hide. Otherwise empty.
    plain_exprs: &'a [hir::Expr],
    /// `hir.stmts`, if there are no casts to hide. Otherwise empty.
    plain_stmts: &'a [hir::Stmt],
    pub(crate) bound: Bound<'a>,
    pub(crate) atoms: &'a dyn Intern,
    pub(crate) texts: bun_sema::atom::OwnTexts<'a>,
    pub(crate) lazy: Lazy,
    pub(crate) types: Option<crate::types::Checker<'a>>,
    pub(crate) sink: crate::context::Sink,
    pub(crate) modules: std::cell::Cell<Option<&'a dyn crate::modules::Modules>>,
    pub(crate) formatter: std::cell::Cell<Option<crate::formats::Formatter<'a>>>,
    pub(crate) handed_back: std::cell::Cell<Option<crate::formats::Reason>>,
    pub(crate) package_module: std::cell::OnceCell<std::sync::Arc<[u8]>>,
    pub(crate) inferred_from: Cell<Option<&'a dyn crate::linter::globals::InferredGlobals>>,
    pub(crate) inferred_globals: OnceCell<Option<crate::linter::globals::ProgramGlobals<'a>>>,
    is_later_script: Cell<bool>,
    /// [`File::in_language`]
    parsed: Option<(&'a crate::languages::Parsed, crate::source::LineBreaks)>,
    language: &'a LanguageOptions,
    configured_language: &'a LanguageOptions,
    body: hir::IdList<hir::StmtId>,
    path: &'a [u8],
    kind: FileKind,
    is_js: bool,
    is_flow: bool,
    /// True if there may be casts synthesized from JSDoc comments.
    hides_casts: bool,
    has_parse_errors: bool,
    may_bind_a_parameter_twice: bool,
    rare_syntax: u32,
}

impl<'a> File<'a> {
    /// `path` is the path to report. `types` is the type checker, if the file is part of a checked program. `language`
    /// is the file's configured options. [`File::language`] can [differ](LanguageOptions::without_module_syntax).
    pub fn new<H: hir::Storage, B: hir::Storage>(
        path: &'a [u8],
        hir: &'a hir::FileIn<H>,
        bound: &'a bind::BoundIn<B>,
        atoms: &'a dyn Intern,
        language: &'a LanguageOptions,
        types: Option<crate::types::Checker<'a>>,
    ) -> File<'a> {
        let makes_a_module = hir::rare::TOP_LEVEL_AWAIT | hir::rare::IMPORT_META;
        let configured_language = language;
        let language = match language.without_module_syntax.as_deref() {
            Some(commonjs) if !hir.has_module_syntax && hir.rare_syntax & makes_a_module == 0 => {
                commonjs
            }
            _ => language,
        };
        let hides_casts = hir.is_js && !hir.jsdoc_comments.is_empty();
        // Every lookup in the list is a binary search by the keyword's position.
        debug_assert!(hir.import_attributes.is_sorted_by_key(|it| it.0));
        File {
            language,
            configured_language,
            body: hir.body,
            kind: hir.kind,
            is_js: hir.is_js,
            is_flow: hir.is_flow,
            hides_casts,
            plain_exprs: match hides_casts {
                true => &[],
                false => &hir.exprs[..],
            },
            plain_stmts: match hides_casts {
                true => &[],
                false => &hir.stmts[..],
            },
            has_parse_errors: hir.has_errors || hir.has_parse_diagnostics,
            may_bind_a_parameter_twice: hir.may_bind_a_parameter_twice,
            // The type checker parses its files the way tsc does, so it never sets these bits. Setting them here means
            // "maybe".
            rare_syntax: match types {
                Some(_) => hir.rare_syntax | hir::rare::ONLY_IN_OXC_DIALECT,
                None => hir.rare_syntax,
            },
            hir: Hir::new(hir),
            bound: Bound::new(bound),
            atoms,
            texts: atoms.own_texts(),
            lazy: Lazy::default(),
            types,
            sink: crate::context::Sink::default(),
            modules: std::cell::Cell::new(None),
            formatter: std::cell::Cell::new(None),
            handed_back: std::cell::Cell::new(None),
            package_module: std::cell::OnceCell::new(),
            inferred_from: Cell::new(None),
            inferred_globals: OnceCell::new(),
            is_later_script: Cell::new(false),
            parsed: None,
            path,
        }
    }

    /// Turns a `File` that was built from an empty `hir` into a file in another [language](crate::languages). `text` is
    /// the file's text, which isn't JavaScript, and `parsed` is what the language parsed it into.
    pub fn in_language(
        mut self,
        text: &'a [u8],
        parsed: &'a crate::languages::Parsed,
        line_breaks: crate::source::LineBreaks,
    ) -> File<'a> {
        self.parsed = Some((parsed, line_breaks));
        self.with_text(text)
    }

    #[inline]
    pub(crate) fn parsed(&self) -> Option<&'a crate::languages::Parsed> {
        Some(self.parsed?.0)
    }

    #[inline]
    pub(crate) fn line_breaks(&self) -> crate::source::LineBreaks {
        self.parsed.map_or_else(Default::default, |it| it.1)
    }

    /// True for a script in a `.vue`, `.svelte` or `.astro` file that has another script before it. oxlint lints each
    /// script as a separate program.
    #[inline]
    pub fn is_later_script(&self) -> bool {
        self.is_later_script.get()
    }

    pub fn set_later_script(&self, is_later: bool) {
        self.is_later_script.set(is_later);
    }

    /// For a `hir` that doesn't store its text.
    pub fn with_text(mut self, text: &'a [u8]) -> File<'a> {
        self.hir.text = text;
        self
    }

    #[inline]
    pub fn path(&self) -> &'a [u8] {
        self.path
    }

    /// The source text. Every [`Span`] is a range of it.
    #[inline]
    pub fn text(&self) -> &'a [u8] {
        self.hir.text
    }

    /// The text of `span`.
    #[inline]
    pub fn slice(&self, span: Span) -> &'a [u8] {
        self.hir.text.get(span.range()).unwrap_or_default()
    }

    /// `.js`, `.jsx`, `.mjs`, `.cjs`
    #[inline]
    pub fn is_javascript(&self) -> bool {
        self.is_js
    }

    /// True if `hir::File::rare_syntax` has `bit`, a `hir::rare` flag. With several flags, true if any is set.
    #[inline]
    pub(crate) fn has_rare_syntax(&self, bit: u32) -> bool {
        self.rare_syntax & bit != 0
    }

    /// `hir::File::may_bind_a_parameter_twice`
    #[inline]
    pub(crate) fn may_bind_a_parameter_twice(&self) -> bool {
        self.may_bind_a_parameter_twice
    }

    /// `.d.ts`, `.d.mts`, `.d.cts`
    #[inline]
    pub fn is_declaration_file(&self) -> bool {
        self.kind == FileKind::Declaration
    }

    /// ESLint's `context.languageOptions`.
    #[inline]
    pub fn language(&self) -> &'a LanguageOptions {
        self.language
    }

    /// Returns the options passed to [`File::new`]. Use them to read another file with this file's options. Unlike
    /// [`File::language`], they don't make the other file CommonJS just because this one is.
    #[inline]
    pub fn configured_language(&self) -> &'a LanguageOptions {
        self.configured_language
    }

    /// ESLint's `context.settings`.
    #[inline]
    pub fn settings(&self) -> &'a crate::options::Json {
        &self.language.settings
    }

    /// True if `languageOptions.sourceType` is `"module"`.
    #[inline]
    pub fn is_module(&self) -> bool {
        self.language.source_type == crate::language::SourceType::Module
    }

    /// True if ESLint's `Program.sourceType` is `"module"`. Both parsers just copy the configured value, regardless of
    /// whether the file has an `import` or `export`.
    #[inline]
    pub fn is_module_program(&self) -> bool {
        self.language.scope_source_type() == crate::language::SourceType::Module
    }

    /// True if the parser reported an error. Whether ESLint would reject the file depends on its parser. See
    /// `linter::parse_error`.
    #[inline]
    pub fn has_parse_errors(&self) -> bool {
        self.has_parse_errors
    }

    /// The offset of the first TypeScript-only syntax in a JavaScript file, which still parses: `a: T`, `a as T`,
    /// `class A<T> {}`, `enum A {}`.
    pub fn first_typescript_syntax_in_javascript(&self) -> Option<u32> {
        (self.hir.diagnostics.iter())
            .filter(|it| it.kind == hir::DiagnosticKind::Js)
            .map(|it| it.start)
            .min()
    }

    /// The top-level statements.
    #[inline]
    pub fn body(&'a self) -> List<'a, Stmt<'a>> {
        List::ids(self, self.body)
    }

    #[inline]
    pub fn span(&self) -> Span {
        Span::new(0, self.hir.text.len() as u32)
    }

    /// A per-file cache for other crates: one value per type, computed by `init` on first use and kept as long as the
    /// file. `None` if both slots already have values of other types. jest and the React Compiler use the two slots, so
    /// a third type needs a third slot.
    pub fn extension<T: 'static>(&'a self, init: impl FnOnce() -> T) -> Option<&'a T> {
        let mut init = Some(init);
        self.lazy.extensions.iter().find_map(|slot| {
            let made = || -> Box<dyn std::any::Any> {
                match init.take() {
                    Some(init) => Box::new(init()),
                    None => Box::new(()),
                }
            };
            slot.get_or_init(made).downcast_ref()
        })
    }

    /// ESLint's `sourceCode.hasBOM`: the text starts with a byte order mark. It's part of [`File::text`], where it's
    /// three bytes long, but ESLint strips it from its text.
    #[inline]
    pub fn has_bom(&self) -> bool {
        self.hir.text.starts_with(b"\xEF\xBB\xBF")
    }

    /// The offset of every `\` in the text, in order, whether in a string, template, regular expression, name or
    /// comment. The text is scanned once and the result is cached.
    pub fn backslashes(&self) -> &[u32] {
        self.lazy.backslashes.get_or_init(|| {
            let (mut all, mut from) = (Vec::new(), 0);
            while let Some(at) = (self.hir.text.get(from..))
                .and_then(|rest| bun_core::strings::index_of_char_usize(rest, b'\\'))
            {
                all.push((from + at) as u32);
                from += at + 1;
            }
            all.into_boxed_slice()
        })
    }

    /// True if the text is known to have no `\u` from `pos` to `end`, so an identifier there ends where the HIR says.
    /// Most files have none at all, and most of the rest have a few in strings.
    #[inline]
    pub(crate) fn has_no_unicode_escape_in(&self, pos: u32, end: u32) -> bool {
        let (first, last) = self.lazy.unicode_escape_range.0.get();
        end <= first || last < pos
    }

    /// The end of the identifier at `pos`. The HIR says `end`, but for some identifiers written with an escape that's
    /// `pos` plus the name's length. That's always past the first escape, so checking `pos..end` for a `\u` is enough.
    #[inline]
    pub(crate) fn end_of_identifier(&self, pos: u32, end: u32) -> u32 {
        match self.has_no_unicode_escape_in(pos, end) {
            true => end,
            false => self.end_of_identifier_slow(pos, end),
        }
    }

    #[inline(never)]
    fn end_of_identifier_slow(&self, pos: u32, end: u32) -> u32 {
        let text = self.hir.text;
        let escapes = self.lazy.unicode_escapes.get_or_init(|| {
            let is_before_u = |at: &u32| text.get(*at as usize + 1) == Some(&b'u');
            let all = self.backslashes().iter().copied().filter(is_before_u);
            let all: Vec<u32> = all.collect();
            self.lazy
                .unicode_escape_range
                .0
                .set(match (all.first(), all.last()) {
                    (Some(&first), Some(&last)) => (first, last),
                    _ => (u32::MAX, 0),
                });
            all.into_boxed_slice()
        });
        match escapes.get(escapes.partition_point(|&at| at < pos)) {
            Some(&at) if at < end => end.max(
                pos + crate::tokens::token_len(text.get(pos as usize..).unwrap_or_default()) as u32,
            ),
            _ => end,
        }
    }

    /// The end of the token before the one that starts at `at`, skipping whitespace and comments. 0 if there is none.
    ///
    /// Unlike [`skip_trivia_back`](crate::tokens::skip_trivia_back), it's never fooled by the contents of a comment or
    /// string. If only whitespace is in between, it scans just that. If there's a comment, the comment has the answer
    /// recorded. Otherwise it falls back to the file's token list.
    pub fn end_of_token_before(&'a self, at: u32) -> u32 {
        let text = self.hir.text;
        let mut end = (at as usize).min(text.len());
        loop {
            match text[..end].last() {
                None => return 0,
                Some(b' ' | b'\t' | 0x0B | 0x0C) => end -= 1,
                Some(b'\n' | b'\r') => {
                    end -= 1;
                    // The previous line can only end in a comment if it contains `//`.
                    let line = bun_core::strings::last_index_of_any(&text[..end], b"\n\r")
                        .map_or(0, |it| it + 1);
                    if bun_core::strings::contains(&text[line..end], b"//") {
                        break;
                    }
                }
                Some(b'/') if text[..end].ends_with(b"*/") => break,
                // Non-ASCII whitespace, or part of a name.
                Some(0x80..) => break,
                Some(_) => return end as u32,
            }
        }
        let comments = self.hir.comments;
        let count_before = comments.partition_point(|comment| comment.pos < at);
        if let Some(last) = count_before
            .checked_sub(1)
            .and_then(|index| comments.get(index))
            && last.next_token_start == at
        {
            return last.prev_token_end;
        }
        self.tokens_before(Span::empty(at))
            .next()
            .map_or(0, crate::tokens::Token::end)
    }

    /// True if the expression `id` is in parentheses, either its own or those after a JSDoc cast.
    #[inline]
    pub(crate) fn is_parenthesized(&self, id: hir::ExprId) -> bool {
        if self.hir.parens.is_empty() {
            return false;
        }
        let bits = self.lazy.parenthesized.get_or_init(|| {
            let mut bits = vec![0u64; self.hir.exprs.len() / 64 + 1].into_boxed_slice();
            for &(id, ..) in self.hir.parens {
                for id in [id, self.unwrap_jsdoc_casts(id)] {
                    if let Some(word) = bits.get_mut(id.idx() / 64) {
                        *word |= 1 << (id.idx() % 64);
                    }
                }
            }
            bits
        });
        bits.get(id.idx() / 64)
            .is_some_and(|word| word & (1 << (id.idx() % 64)) != 0)
    }

    /// The range of ESLint's `Program`: from the first token, after a `#!` line and comments, to
    /// the end of the text.
    pub fn program_span(&self) -> Span {
        Span::new(
            crate::tokens::skip_trivia(self.hir.text, 0),
            self.hir.text.len() as u32,
        )
    }

    /// The name for `atom`.
    #[inline]
    pub(crate) fn name(&'a self, atom: Atom) -> Name<'a> {
        Name::new(self, atom)
    }

    /// The name `#x` for `atom`. In a checked program, the HIR mangles it so that one class's `#x` differs from
    /// another's, and this undoes that.
    #[inline]
    pub(crate) fn private_name(&'a self, atom: Atom) -> Name<'a> {
        match self.mangles_private_names() && atom.is_some() {
            true => self.unmangled_private_name(atom),
            false => self.name(atom),
        }
    }

    /// See [`File::private_name`].
    #[inline]
    pub(crate) fn mangles_private_names(&self) -> bool {
        self.types.is_some()
    }

    #[inline(never)]
    fn unmangled_private_name(&'a self, atom: Atom) -> Name<'a> {
        let spelled = self.atoms.bytes(atom);
        match bun_sema::atom::written_name(spelled) {
            unmangled if unmangled.len() == spelled.len() => self.name(atom),
            unmangled => self.intern(unmangled),
        }
    }

    /// Interns `text` as a name.
    #[inline]
    pub(crate) fn intern(&'a self, text: &[u8]) -> Name<'a> {
        Name::new(self, self.atoms.intern(text))
    }

    #[inline]
    pub(crate) fn name_if_some(&'a self, atom: Atom) -> Option<Name<'a>> {
        atom.is_some().then(|| Name::new(self, atom))
    }

    /// The identifier `atom` at offset `start`.
    #[inline]
    pub(crate) fn ident(&'a self, atom: Atom, start: u32) -> Ident<'a> {
        Ident::new(self, atom, start)
    }

    #[inline]
    pub(crate) fn ident_if_some(&'a self, atom: Atom, start: u32) -> Option<Ident<'a>> {
        atom.is_some().then(|| Ident::new(self, atom, start))
    }

    /// True if `pos` is inside a JSDoc comment in a JavaScript file. A node there was synthesized from a tag for the
    /// type checker and isn't real syntax.
    #[inline]
    pub(crate) fn is_in_jsdoc(&self, pos: u32) -> bool {
        let comments = self.hir.jsdoc_comments;
        !comments.is_empty() && {
            let after = comments.partition_point(|c| c.0 <= pos);
            after > 0 && pos < comments[after - 1].1
        }
    }

    /// For `/** @type {T} */ (e)` or `/** @satisfies {T} */ (e)`: returns the `e` if `id` is the `e as T` that the HIR
    /// puts inside these parentheses. The source has no such node, and only [`Expr::with_jsdoc_cast`] returns a handle
    /// for it. The cast's span is exactly that of `e`, including `e`'s own parentheses.
    #[inline]
    pub(crate) fn jsdoc_cast_operand(&self, id: hir::ExprId) -> Option<hir::ExprId> {
        match self.hides_casts {
            true => self.operand_if_jsdoc_cast(id),
            false => None,
        }
    }

    fn operand_if_jsdoc_cast(&self, id: hir::ExprId) -> Option<hir::ExprId> {
        let cast = self.hir.exprs.get(id.idx())?;
        let operand = match cast.kind {
            hir::ExprKind::As { expr, .. }
            | hir::ExprKind::Satisfies { expr, .. }
            | hir::ExprKind::AsConst(expr) => expr,
            _ => return None,
        };
        let parens = self.hir.parens;
        let after = parens.partition_point(|p| p.0.0 <= operand.0);
        let operand_range = match after.checked_sub(1).map(|last| parens[last]) {
            Some((of, start, end)) if of == operand => (start, end),
            _ => self
                .hir
                .exprs
                .get(operand.idx())
                .map(|it| (it.pos, it.end))?,
        };
        (operand_range == (cast.pos, cast.end)).then_some(operand)
    }

    /// The cast synthesized from a JSDoc comment around the expression `id`, if any.
    #[inline]
    pub(crate) fn enclosing_jsdoc_cast(&self, id: hir::ExprId) -> Option<hir::ExprId> {
        if !self.hides_casts {
            return None;
        }
        match self.bound.parent_of_expr(id) {
            bind::Parent::Expr(parent) if self.jsdoc_cast_operand(parent) == Some(id) => {
                Some(parent)
            }
            _ => None,
        }
    }

    /// `id`, or the outermost JSDoc-synthesized cast around it.
    #[inline]
    pub(crate) fn with_jsdoc_casts(&self, mut id: hir::ExprId) -> hir::ExprId {
        while let Some(cast) = self.enclosing_jsdoc_cast(id) {
            id = cast;
        }
        id
    }

    /// True if `/** @type {T} */ (e)` has the type `T`, as it does for tsgolint. typescript-eslint gets the type of `e`
    /// instead, because its tree has no parentheses and TypeScript 6 attaches the cast to the parentheses.
    #[inline]
    pub(crate) fn types_follow_jsdoc_casts(&self) -> bool {
        self.hides_casts && (self.language.is_oxlint || self.language.has_no_foreign_config)
    }

    /// `id`, or its operand if it's a cast synthesized from a JSDoc comment.
    #[inline]
    pub(crate) fn unwrap_jsdoc_casts(&self, id: hir::ExprId) -> hir::ExprId {
        match self.hides_casts {
            true => self.without_jsdoc_casts(id),
            false => id,
        }
    }

    #[inline(never)]
    fn without_jsdoc_casts(&self, mut id: hir::ExprId) -> hir::ExprId {
        while let Some(operand) = self.operand_if_jsdoc_cast(id) {
            id = operand;
        }
        id
    }

    /// `flags` without the modifiers that come from JSDoc tags such as `@private`. Of those flags, it keeps only the
    /// ones in `source_modifiers`, the modifiers in the source.
    #[inline]
    pub(crate) fn source_flags(
        &'a self,
        flags: Flags,
        source_modifiers: List<'a, Modifier<'a>>,
    ) -> Flags {
        if !self.has_synthetic_nodes() {
            return flags;
        }
        let from_tags =
            Flags::PUBLIC | Flags::PROTECTED | Flags::PRIVATE | Flags::READONLY | Flags::OVERRIDE;
        let keywords = source_modifiers
            .iter()
            .fold(Flags::empty(), |all, it| all | it.flag());
        (flags - from_tags) | (keywords & from_tags)
    }

    /// True if `pos` is in a dotted JSX tag name like `<a.b.c>`.
    pub(crate) fn is_in_jsx_tag_with_dots(&self, pos: u32) -> bool {
        let tags = self.lazy.jsx_tags_with_dots.get_or_init(|| {
            let is_jsx = |e: hir::ExprId| matches!(self.hir.exprs.get(e.idx()), Some(hir::Expr { kind: hir::ExprKind::Jsx(_), .. }));
            let names = self.hir.jsx.iter().flat_map(|it| [it.tag, it.close_tag]);
            let mut tags: Vec<(u32, u32)> = names
                .filter(|it| matches!(self.bound.parent_of_expr(*it), bind::Parent::Expr(parent) if is_jsx(parent)))
                .filter_map(|it| self.hir.exprs.get(it.idx()))
                .filter(|it| matches!(it.kind, hir::ExprKind::Dot { .. }))
                .map(|it| (it.pos, it.end))
                .collect();
            tags.sort_unstable();
            tags.into_boxed_slice()
        });
        let after = tags.partition_point(|it| it.0 <= pos);
        after
            .checked_sub(1)
            .and_then(|it| tags.get(it))
            .is_some_and(|it| pos < it.1)
    }

    /// True if the file has nodes synthesized from JSDoc comments.
    #[inline]
    pub(crate) fn has_synthetic_nodes(&self) -> bool {
        !self.hir.jsdoc_comments.is_empty()
    }
}

/// A reference to a node of a [`File`].
pub trait Handle<'a>: Copy {
    #[doc(hidden)]
    fn from_raw(file: &'a File<'a>, id: u32) -> Self;

    /// The number of nodes of this kind in `file`.
    #[doc(hidden)]
    fn count_in(file: &File<'a>) -> u32;

    /// True if it's synthesized from a JSDoc comment, in which case lists skip it.
    #[doc(hidden)]
    #[inline]
    fn is_synthetic(self) -> bool {
        false
    }
}

/// Declares a handle: `$name` refers to the `$raw` at index `$id` of `Hir::$field`.
macro_rules! handle {
    ($(#[$doc:meta])* $name:ident, $id:ident, $field:ident, $raw:ident) => {
        $crate::ast::handle! {
            $(#[$doc])*
            $name, $id, $field, $raw, |_: &$crate::ast::File, id: ::bun_sema::hir::$id| id
        }
    };
    // `$to_source_id` maps the file and a HIR id to the id of the node that's actually in the source.
    ($(#[$doc:meta])* $name:ident, $id:ident, $field:ident, $raw:ident, $to_source_id:expr) => {
        $(#[$doc])*
        #[derive(Copy, Clone)]
        pub struct $name<'a> {
            pub(crate) file: &'a $crate::ast::File<'a>,
            pub(crate) id: ::bun_sema::hir::$id,
        }

        impl<'a> $name<'a> {
            #[inline]
            pub(crate) fn new(file: &'a $crate::ast::File<'a>, id: ::bun_sema::hir::$id) -> Self {
                $name { file, id: ($to_source_id)(file, id) }
            }

            /// The node's index in the HIR, which is what the type checker's API takes.
            #[inline]
            pub fn id(self) -> ::bun_sema::hir::$id {
                self.id
            }

            #[inline]
            pub fn file(self) -> &'a $crate::ast::File<'a> {
                self.file
            }

            /// The node's source text.
            #[inline]
            pub fn text(self) -> &'a [u8] {
                self.file.slice(self.span())
            }

            #[inline(never)]
            fn starts_in_jsdoc(self) -> bool {
                self.file.is_in_jsdoc(self.span().start)
            }
        }

        impl PartialEq for $name<'_> {
            #[inline]
            fn eq(&self, other: &Self) -> bool {
                self.id == other.id
            }
        }
        impl Eq for $name<'_> {}
        impl $crate::types::Indexed for $name<'_> {
            #[inline]
            fn index(self) -> u32 {
                self.id.0
            }
        }
        impl std::hash::Hash for $name<'_> {
            #[inline]
            fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
                self.id.hash(state);
            }
        }
        impl std::fmt::Debug for $name<'_> {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}({})", stringify!($name), self.id.0)
            }
        }
        impl<'a> crate::ast::Handle<'a> for $name<'a> {
            #[inline]
            fn from_raw(file: &'a $crate::ast::File<'a>, id: u32) -> Self {
                $name::new(file, ::bun_sema::hir::$id(id))
            }
            #[inline]
            fn count_in(file: &$crate::ast::File<'a>) -> u32 {
                file.hir.$field.len() as u32
            }
            #[inline]
            fn is_synthetic(self) -> bool {
                self.file.has_synthetic_nodes() && self.starts_in_jsdoc()
            }
        }
    };
}
pub(crate) use handle;

/// `$name::some(file, id)`: `None` if the HIR leaves `id` empty.
macro_rules! optional_handles {
    ($($name:ident $id:ident $field:ident,)*) => {
        $(impl<'a> $name<'a> {
            #[inline]
            pub(crate) fn some(file: &'a File<'a>, id: hir::$id) -> Option<Self> {
                (id.idx() < file.hir.$field.len()).then(|| $name::new(file, id))
            }
        })*
    };
}

optional_handles! {
    Case CaseId cases,
    EnumMember EnumMemberId enum_members,
    ExportSpec ExportSpecId export_specs,
    Expr ExprId exprs,
    Func FnId fns,
    ImportSpec ImportSpecId import_specs,
    Member MemberId members,
    Modifier ModifierId modifiers,
    Param ParamId params,
    Pat PatId pats,
    PatElem PatElemId pat_elems,
    PatProp PatPropId pat_props,
    Prop PropId props,
    Stmt StmtId stmts,
    TupleElem TupleElemId tuple_elems,
    TypeNode TypeNodeId types,
    TypeParam TypeParamId type_params,
    VarDecl VarDeclId var_decls,
}

/// `handle.try_raw()`: its HIR node, if it has one.
macro_rules! raw_handles {
    ($($name:ident $field:ident,)*) => {
        $(impl<'a> $name<'a> {
            #[inline]
            pub(crate) fn try_raw(self) -> Option<&'a hir::$name> {
                self.file.hir.$field.get(self.id.idx())
            }
        })*
    };
}

raw_handles! {
    Class classes,
    Expr exprs,
    Func fns,
    Member members,
    Modifier modifiers,
    Param params,
    Pat pats,
    Stmt stmts,
    TupleElem tuple_elems,
    TypeNode types,
    TypeParam type_params,
}
