//! The syntax of a file, as lint rules and the formatter see it.
//!
//! Nothing is converted or copied: this is the HIR that the parser produces for the type checker
//! (`bun_sema::hir`) and what the binder computes from it (`bun_sema::bind`), behind handles that
//! cannot be misused. A handle ([`Expr`], [`Stmt`], [`TypeNode`], [`Pat`], [`Func`], ..) is a
//! reference to the [`File`] and an index. It is `Copy`, two words, and compares by identity.
//! `kind()` returns an enum to `match` on, whose fields are handles again.
//!
//! - An id that the HIR leaves empty is an `Option`, never a sentinel.
//! - Parentheses are not nodes. `(a)` is `a`, [`Expr::is_parenthesized`] tells, and
//!   [`Expr::outer_span`] includes them.
//! - Every handle has a [`Span`], from its first token to the end of its last.
//! - [`Node`] is any handle, for what applies to all of them: `parent()`, `ancestors()`, reports.
//!
//! The HIR is made for the type checker. Where it has something that is not in the source, the
//! handles do not show it, or say so:
//! - What is synthesized from JSDoc comments in JavaScript is left out of every list and every
//!   accessor. The cast of `/** @type {T} */ (e)` is `e`, in parentheses.
//! - A template without substitutions is a [`ExprKind::Template`], though the HIR has a string.
//! - The statement around the expression in the head of a `for` and around the object of a `with`
//!   is a [wrapper](Stmt::is_wrapper), the `B` of `namespace A.B` is [nested](Module::nested), the
//!   object of `with { type: "json" }` is [`ImportAttributes`]: these are not nodes. No listener is
//!   called with them, a walk passes over them, and nothing has them as its parent.
//! - Placeholders are [`ExprKind::Missing`] and [`PatKind::Missing`]: a hole in an array, the empty
//!   `{}` of JSX. They are not nodes either.
//! - `x!!` is one [`ExprKind::NonNull`]: see [`Expr::inner_non_null_spans`].
//! - The default of the shorthand `{ a = 1 }` is an [`ExprKind::Assign`] that is the value of the
//!   property. A [`TupleElem`] is there for every element of a tuple type, also for a plain `T`.
//!
//! `bun-lint ast check` verifies that the ways up, down and through the vectors agree, and that
//! the positions of tokens are what the text has there. `bun-lint ast estree` writes a file as
//! ESTree, from these accessors only, which test/cli/lint/oracle/ast compares with what
//! typescript-estree and espree make of the same code.

mod decl;
mod entities;
mod expr;
mod flow;
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
pub use node::{Ancestors, Node};
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
            /// Wherever the lists are stored.
            fn new<S: hir::Storage>(source: &'a $module::$source<S>) -> Self {
                $name { $($field: &source.$field[..],)* }
            }
        }
    };
}

slices! {
    /// The vectors of a `hir::File`. That type is invariant in the lifetime of its session, these
    /// are not, which is what lets every handle have a single lifetime.
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
        jsx_expressions: (hir::ExprId, u32, u32),
        body_starts: (hir::FnId, u32),
        modifiers_of_params: hir::Span<hir::ModifierId>,
        modifiers_of_props: (hir::PropId, hir::Span<hir::ModifierId>),
        with_bodies: (u32, u32),
        import_attributes: (u32, hir::ExprId),
        deferred_import_calls: (hir::ExprId, u32),
        jsdoc_comments: (u32, u32),
        comments: (u32, u32),
        mentioned: u64,
        diagnostics: hir::Diagnostic,
    }
}

slices! {
    /// The same for the side tables of a `bind::Bound`.
    Bound of bind::BoundIn {
        ids: u32,
        expr_parent: bind::Parent,
        stmt_parent: bind::Parent,
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
    }
}

/// The first and the last of [`Lazy::unicode_escapes`]. Until these are known it is the whole text,
/// and if there are none it is empty.
struct UnicodeEscapeRange(Cell<(u32, u32)>);

impl Default for UnicodeEscapeRange {
    fn default() -> Self {
        UnicodeEscapeRange(Cell::new((0, u32::MAX)))
    }
}

/// What is computed from a file on demand, once.
#[derive(Default)]
pub(crate) struct Lazy {
    pub(crate) lines: OnceCell<crate::source::Lines>,
    pub(crate) tokens: OnceCell<crate::tokens::TokenStore>,
    pub(crate) parents: OnceCell<node::Parents>,
    has_types_that_are_errors: OnceCell<bool>,
    /// Where the text has a `\u`, in order.
    unicode_escapes: OnceCell<Box<[u32]>>,
    unicode_escape_range: UnicodeEscapeRange,
    /// A bit for each expression: it is in parentheses.
    parenthesized: OnceCell<Box<[u64]>>,
    /// [`Stmt::directive`]
    pub(crate) directives: Cell<Option<(u32, u32)>>,
    /// For each `a, b` that is the start of a long `a, b, c, ..`: all of that.
    pub(crate) sequence_roots: OnceCell<rustc_hash::FxHashMap<hir::ExprId, hir::ExprId>>,
    /// Where the `a.b` of each `<a.b>` and `</a.b>` starts and ends, in order.
    jsx_tags_with_dots: OnceCell<Box<[(u32, u32)]>>,
    pub(crate) references: OnceCell<crate::semantic::ReferenceIndex>,
    pub(crate) by_kind: OnceCell<crate::runner::ByKind>,
    pub(crate) code_paths: crate::code_path::Store,
    pub(crate) linter: crate::linter::PerFile,
    extensions: [OnceCell<Box<dyn std::any::Any>>; 4],
}

/// What a script of a `.vue` file knows of the file around it, which has two scripts at most. oxlint lints each as a program of its
/// own.
#[derive(Copy, Clone, Default, Debug)]
pub struct VueScript {
    /// There is a script before it in the file. Also in a file that is not of Vue.
    pub is_second: bool,
    /// `<script setup>`
    pub is_setup: bool,
    pub other_is_setup: bool,
    /// The other script has an `export default { props: .. }`.
    pub other_exports_props: bool,
    /// The other script has an `export default { emits: .. }`.
    pub other_exports_emits: bool,
}

/// The file that is linted or formatted.
pub struct File<'a> {
    pub(crate) hir: Hir<'a>,
    pub(crate) bound: Bound<'a>,
    pub(crate) atoms: &'a dyn Intern,
    pub(crate) lazy: Lazy,
    pub(crate) types: Option<crate::types::Checker<'a>>,
    pub(crate) sink: crate::context::Sink,
    pub(crate) modules: std::cell::Cell<Option<&'a dyn crate::modules::Modules>>,
    vue_script: std::cell::Cell<VueScript>,
    language: &'a LanguageOptions,
    body: hir::IdList<hir::StmtId>,
    path: &'a [u8],
    kind: FileKind,
    is_js: bool,
    is_flow: bool,
    /// Whether there can be casts that are synthesized from JSDoc comments.
    hides_casts: bool,
    has_parse_errors: bool,
}

impl<'a> File<'a> {
    /// `path`: as it is reported. `types`: the type checker, if the file is part of a program that
    /// has been checked.
    pub fn new<H: hir::Storage, B: hir::Storage>(
        path: &'a [u8],
        hir: &'a hir::FileIn<H>,
        bound: &'a bind::BoundIn<B>,
        atoms: &'a dyn Intern,
        language: &'a LanguageOptions,
        types: Option<crate::types::Checker<'a>>,
    ) -> File<'a> {
        File {
            language,
            body: hir.body,
            kind: hir.kind,
            is_js: hir.is_js,
            is_flow: hir.is_flow,
            hides_casts: hir.is_js && !hir.jsdoc_comments.is_empty(),
            has_parse_errors: hir.has_errors || hir.has_parse_diagnostics,
            hir: Hir::new(hir),
            bound: Bound::new(bound),
            atoms,
            lazy: Lazy::default(),
            types,
            sink: crate::context::Sink::default(),
            modules: std::cell::Cell::new(None),
            vue_script: std::cell::Cell::default(),
            path,
        }
    }

    /// Nothing is set unless it is a script of a `.vue` file.
    #[inline]
    pub fn vue_script(&self) -> VueScript {
        self.vue_script.get()
    }

    pub fn set_vue_script(&self, script: VueScript) {
        self.vue_script.set(script);
    }

    /// For a `hir` that does not hold its text.
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

    /// ESLint's `context.settings`.
    #[inline]
    pub fn settings(&self) -> &'a crate::options::Json {
        &self.language.settings
    }

    /// `languageOptions.sourceType` is `"module"`.
    #[inline]
    pub fn is_module(&self) -> bool {
        self.language.source_type == crate::language::SourceType::Module
    }

    /// ESLint's `Program.sourceType` is `"module"`. Both parsers repeat what the configuration says:
    /// whether the file has an `import` or an `export` does not matter.
    #[inline]
    pub fn is_module_program(&self) -> bool {
        self.language.scope_source_type() == crate::language::SourceType::Module
    }

    /// The parser reported an error. Whether ESLint would refuse the file is another question, which
    /// depends on its parser: `linter::parse_error`.
    #[inline]
    pub fn has_parse_errors(&self) -> bool {
        self.has_parse_errors
    }

    /// The statements at the top level.
    #[inline]
    pub fn body(&'a self) -> List<'a, Stmt<'a>> {
        List::ids(self, self.body)
    }

    #[inline]
    pub fn span(&self) -> Span {
        Span::new(0, self.hir.text.len() as u32)
    }

    /// What another crate computes from the file once and keeps as long as the file: one value of
    /// each type. `init` runs the first time. `None` if there are values of four other types.
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

    /// ESLint's `sourceCode.hasBOM`. The text starts with a byte order mark, which is part of
    /// [`File::text`] and takes three bytes there. ESLint leaves it out of its text.
    #[inline]
    pub fn has_bom(&self) -> bool {
        self.hir.text.starts_with(b"\xEF\xBB\xBF")
    }

    /// It is known that the text has no `\u` from `pos` to `end`: an identifier there ends where the
    /// HIR says. Most files have none at all, and most of the others have a few in strings.
    #[inline]
    pub(crate) fn has_no_unicode_escape_in(&self, pos: u32, end: u32) -> bool {
        let (first, last) = self.lazy.unicode_escape_range.0.get();
        end <= first || last < pos
    }

    /// Where the identifier at `pos` ends. The HIR says `end`, which for some identifiers that are
    /// written with an escape is `pos` and the length of the name. That is past the first escape.
    #[inline]
    pub(crate) fn end_of_identifier(&self, pos: u32, end: u32) -> u32 {
        match self.has_no_unicode_escape_in(pos, end) {
            true => end,
            false => self.end_of_identifier_that_may_have_escapes(pos, end),
        }
    }

    #[inline(never)]
    fn end_of_identifier_that_may_have_escapes(&self, pos: u32, end: u32) -> u32 {
        let text = self.hir.text;
        let escapes = self.lazy.unicode_escapes.get_or_init(|| {
            let (mut all, mut from) = (Vec::new(), 0);
            while let Some(at) = text
                .get(from..)
                .and_then(|rest| bun_core::strings::index_of(rest, b"\\u"))
            {
                all.push((from + at) as u32);
                from += at + 2;
            }
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

    /// The end of the token before the one that starts at `at`, over whitespace and comments. 0 if
    /// there is none.
    ///
    /// Unlike [`skip_trivia_back`](crate::tokens::skip_trivia_back) it is never fooled by what a
    /// comment or a string contains. Where there is only whitespace in between, it looks at nothing
    /// else. Where there may be a comment, it asks the tokens of the file.
    pub fn end_of_token_before(&'a self, at: u32) -> u32 {
        let text = self.hir.text;
        let mut end = (at as usize).min(text.len());
        loop {
            match text[..end].last() {
                None => return 0,
                Some(b' ' | b'\t') => end -= 1,
                Some(b'\n' | b'\r') => {
                    end -= 1;
                    // The line before can end in a comment only if it has a `//`.
                    let line = bun_core::strings::last_index_of_any(&text[..end], b"\n\r")
                        .map_or(0, |it| it + 1);
                    if bun_core::strings::contains(&text[line..end], b"//") {
                        break;
                    }
                }
                Some(b'/') if text[..end].ends_with(b"*/") => break,
                // Whitespace that is not ASCII, or a part of a name.
                Some(0x80..) => break,
                Some(_) => return end as u32,
            }
        }
        self.tokens_before(Span::empty(at))
            .next()
            .map_or(0, crate::tokens::Token::end)
    }

    /// Whether the expression `id` is in parentheses, its own or those after a JSDoc cast.
    #[inline]
    pub(crate) fn is_parenthesized(&self, id: hir::ExprId) -> bool {
        if self.hir.parens.is_empty() {
            return false;
        }
        let bits = self.lazy.parenthesized.get_or_init(|| {
            let mut bits = vec![0u64; self.hir.exprs.len() / 64 + 1].into_boxed_slice();
            for &(id, ..) in self.hir.parens {
                for id in [id, self.written_expr(id)] {
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

    /// Every expression that is in parentheses, once each, in no particular order.
    pub fn parenthesized(&'a self) -> impl Iterator<Item = Expr<'a>> + 'a {
        let parens = self.hir.parens;
        let has_parens =
            move |id: hir::ExprId| parens.binary_search_by_key(&id.0, |p| p.0.0).is_ok();
        parens.iter().enumerate().filter_map(move |(i, p)| {
            let is_repeated = i > 0 && parens[i - 1].0 == p.0;
            // The parentheses after a JSDoc cast belong to its operand, which may have its own.
            let is_listed_already = self.jsdoc_cast_operand(p.0).is_some_and(has_parens);
            let e = Expr::new(self, p.0);
            (!is_repeated && !is_listed_already && self.expr_in_tree(e.id().idx()).is_some())
                .then_some(e)
        })
    }

    /// The range of ESLint's `Program`: from the first token, after a `#!` line and comments, to
    /// the end of the text.
    pub fn program_span(&self) -> Span {
        Span::new(
            crate::tokens::skip_trivia(self.hir.text, 0),
            self.hir.text.len() as u32,
        )
    }

    /// The name that `atom` stands for.
    #[inline]
    pub(crate) fn name(&'a self, atom: Atom) -> Name<'a> {
        Name::new(self, atom)
    }

    /// The name `#x` that `atom` stands for. In a program that has been checked, the HIR has a
    /// spelling for it that tells the `#x` of one class from that of another.
    #[inline]
    pub(crate) fn private_name(&'a self, atom: Atom) -> Name<'a> {
        match self.spells_private_names_apart() && atom.is_some() {
            true => self.written_private_name(atom),
            false => self.name(atom),
        }
    }

    /// See [`File::private_name`].
    #[inline]
    pub(crate) fn spells_private_names_apart(&self) -> bool {
        self.types.is_some()
    }

    #[inline(never)]
    fn written_private_name(&'a self, atom: Atom) -> Name<'a> {
        let spelled = self.atoms.bytes(atom);
        match bun_sema::atom::written_name(spelled) {
            written if written.len() == spelled.len() => self.name(atom),
            written => self.intern(written),
        }
    }

    /// `text` as a name.
    #[inline]
    pub(crate) fn intern(&'a self, text: &[u8]) -> Name<'a> {
        Name::new(self, self.atoms.intern(text))
    }

    #[inline]
    pub(crate) fn name_if_some(&'a self, atom: Atom) -> Option<Name<'a>> {
        atom.is_some().then(|| Name::new(self, atom))
    }

    /// The identifier `atom` that is written at `start`.
    #[inline]
    pub(crate) fn ident(&'a self, atom: Atom, start: u32) -> Ident<'a> {
        Ident::new(self, atom, start)
    }

    #[inline]
    pub(crate) fn ident_if_some(&'a self, atom: Atom, start: u32) -> Option<Ident<'a>> {
        atom.is_some().then(|| Ident::new(self, atom, start))
    }

    /// Whether `pos` is inside a JSDoc comment of a JavaScript file: a node there is synthesized
    /// from a tag for the type checker, and is not syntax.
    #[inline]
    pub(crate) fn is_in_jsdoc(&self, pos: u32) -> bool {
        let comments = self.hir.jsdoc_comments;
        !comments.is_empty() && {
            let after = comments.partition_point(|c| c.0 <= pos);
            after > 0 && pos < comments[after - 1].1
        }
    }

    /// `/** @type {T} */ (e)`, `/** @satisfies {T} */ (e)`: if `id` is the `e as T` that the HIR has
    /// in these parentheses, the `e`. The source has no such node, and neither has a handle: it
    /// takes exactly the place of `e` and the parentheses that `e` has of its own.
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
        let place = match after.checked_sub(1).map(|last| parens[last]) {
            Some((of, start, end)) if of == operand => (start, end),
            _ => self
                .hir
                .exprs
                .get(operand.idx())
                .map(|it| (it.pos, it.end))?,
        };
        (place == (cast.pos, cast.end)).then_some(operand)
    }

    /// The cast that is synthesized from a JSDoc comment around the expression `id`.
    #[inline]
    pub(crate) fn jsdoc_cast_around(&self, id: hir::ExprId) -> Option<hir::ExprId> {
        if !self.hides_casts {
            return None;
        }
        match self.bound.expr_parent.get(id.idx()) {
            Some(&bind::Parent::Expr(parent)) if self.jsdoc_cast_operand(parent) == Some(id) => {
                Some(parent)
            }
            _ => None,
        }
    }

    /// `id`, or what is in it if it is a cast that is synthesized from a JSDoc comment.
    #[inline]
    pub(crate) fn written_expr(&self, id: hir::ExprId) -> hir::ExprId {
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

    /// `flags` without the modifiers that are from JSDoc tags such as `@private`: of these only
    /// what is among `written`.
    #[inline]
    pub(crate) fn written_flags(&'a self, flags: Flags, written: List<'a, Modifier<'a>>) -> Flags {
        if !self.has_synthetic_nodes() {
            return flags;
        }
        let from_tags =
            Flags::PUBLIC | Flags::PROTECTED | Flags::PRIVATE | Flags::READONLY | Flags::OVERRIDE;
        let keywords = written
            .iter()
            .fold(Flags::empty(), |all, it| all | it.flag());
        (flags - from_tags) | (keywords & from_tags)
    }

    /// Whether `pos` is in the name of a tag of a JSX element that is written with dots: `<a.b.c>`.
    pub(crate) fn is_in_jsx_tag_with_dots(&self, pos: u32) -> bool {
        let tags = self.lazy.jsx_tags_with_dots.get_or_init(|| {
            let is_jsx = |e: hir::ExprId| matches!(self.hir.exprs.get(e.idx()), Some(hir::Expr { kind: hir::ExprKind::Jsx(_), .. }));
            let names = self.hir.jsx.iter().flat_map(|it| [it.tag, it.close_tag]);
            let mut tags: Vec<(u32, u32)> = names
                .filter(|it| matches!(self.bound.expr_parent.get(it.idx()), Some(&bind::Parent::Expr(parent)) if is_jsx(parent)))
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

    /// Whether the file has nodes that are synthesized from JSDoc comments.
    #[inline]
    pub(crate) fn has_synthetic_nodes(&self) -> bool {
        !self.hir.jsdoc_comments.is_empty()
    }
}

/// A reference to a node of a [`File`].
pub trait Handle<'a>: Copy {
    #[doc(hidden)]
    fn from_raw(file: &'a File<'a>, id: u32) -> Self;

    /// It is synthesized from a JSDoc comment: lists leave it out.
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
    // `$written`: from the file and an id of the HIR to the id of the node that is written there.
    ($(#[$doc:meta])* $name:ident, $id:ident, $field:ident, $raw:ident, $written:expr) => {
        $(#[$doc])*
        #[derive(Copy, Clone)]
        pub struct $name<'a> {
            pub(crate) file: &'a $crate::ast::File<'a>,
            pub(crate) id: ::bun_sema::hir::$id,
        }

        impl<'a> $name<'a> {
            #[inline]
            pub(crate) fn new(file: &'a $crate::ast::File<'a>, id: ::bun_sema::hir::$id) -> Self {
                $name { file, id: ($written)(file, id) }
            }

            /// The index of the node in the HIR, which is what the type checker takes.
            #[inline]
            pub fn id(self) -> ::bun_sema::hir::$id {
                self.id
            }

            #[inline]
            pub fn file(self) -> &'a $crate::ast::File<'a> {
                self.file
            }

            /// The source text of the node.
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
            fn is_synthetic(self) -> bool {
                self.file.has_synthetic_nodes() && self.starts_in_jsdoc()
            }
        }
        impl crate::span::Spanned for $name<'_> {
            #[inline]
            fn span(&self) -> $crate::span::Span {
                $name::span(*self)
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

/// `handle.try_raw()`: what the HIR has for it, if it has anything.
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
