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

mod decl;
mod expr;
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
pub use list::List;
pub use name::{Ident, Name};
pub use node::{Ancestors, Node};
pub use pat::*;
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
use std::cell::OnceCell;

macro_rules! slices {
    ($(#[$doc:meta])* $name:ident of $source:ty { $($field:ident: $ty:ty,)* }) => {
        $(#[$doc])*
        pub(crate) struct $name<'a> {
            $(pub(crate) $field: &'a [$ty],)*
        }

        impl<'a> $name<'a> {
            fn new(source: &'a $source) -> Self {
                $name { $($field: &source.$field[..],)* }
            }
        }
    };
}

slices! {
    /// The vectors of a `hir::File`. That type is invariant in the lifetime of its session, these
    /// are not, which is what lets every handle have a single lifetime.
    Hir of hir::File<'_> {
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
        jsx_expressions: (hir::ExprId, u32, u32),
        body_starts: (hir::FnId, u32),
        modifiers_of_params: hir::Span<hir::ModifierId>,
        modifiers_of_props: (hir::PropId, hir::Span<hir::ModifierId>),
        with_bodies: (u32, u32),
        import_attributes: (u32, hir::ExprId),
        deferred_import_calls: (hir::ExprId, u32),
        import_call_type_args: (hir::ExprId, hir::IdList<hir::TypeNodeId>),
        specifier_expressions: hir::ExprId,
        exports_from_expressions: (hir::StmtId, hir::ExprId),
        specifier_uses: hir::SpecifierUse,
        jsdoc_comments: (u32, u32),
        diagnostics: hir::Diagnostic,
    }
}

slices! {
    /// The same for the side tables of a `bind::Bound`.
    Bound of bind::Bound<'_> {
        scopes: bind::Scope,
        ids: u32,
        expr_symbol: bind::SymbolId,
        expr_parent: bind::Parent,
        stmt_parent: bind::Parent,
        stmt_scope: bind::ScopeId,
        type_scope: bind::ScopeId,
        pat_parent: bind::PatParent,
        pat_symbol: bind::SymbolId,
        prop_owner: hir::ExprId,
        member_symbol: bind::SymbolId,
        member_owner: bind::MemberOwner,
        member_scope: bind::ScopeId,
        param_fn: hir::FnId,
        type_param_symbol: bind::SymbolId,
        type_param_scope: bind::ScopeId,
        fns: bind::FnInfo,
        fn_symbol: bind::SymbolId,
        class_symbol: bind::SymbolId,
        class_owner: bind::ClassOwner,
        class_scope: bind::ScopeId,
        interface_symbol: bind::SymbolId,
        interface_scope: bind::ScopeId,
        enum_scope: bind::ScopeId,
        module_scope: bind::ScopeId,
        alias_symbol: bind::SymbolId,
        alias_scope: bind::ScopeId,
        enum_symbol: bind::SymbolId,
        enum_member_symbol: bind::SymbolId,
        enum_member_owner: hir::EnumId,
        module_symbol: bind::SymbolId,
        var_stmt: hir::StmtId,
        case_stmt: hir::StmtId,
        import_scope: bind::ScopeId,
        export_scope: bind::ScopeId,
        free_idents: (hir::ExprId, bind::ScopeId),
        alias_idents: (hir::ExprId, bind::ScopeId),
        arguments_objects: hir::ExprId,
        unused_labels: hir::StmtId,
        hoisted_vars: (hir::PatId, bind::ScopeId),
        type_query_operands: hir::ExprId,
    }
}

/// What is computed from a file on demand, once.
#[derive(Default)]
pub(crate) struct Lazy {
    pub(crate) lines: OnceCell<crate::source::Lines>,
    pub(crate) tokens: OnceCell<crate::tokens::TokenStore>,
    pub(crate) parents: OnceCell<node::Parents>,
    pub(crate) references: OnceCell<crate::semantic::ReferenceIndex>,
    pub(crate) by_kind: OnceCell<crate::runner::ByKind>,
    pub(crate) code_paths: crate::code_path::Store,
}

/// The file that is linted or formatted.
pub struct File<'a> {
    pub(crate) hir: Hir<'a>,
    pub(crate) bound: Bound<'a>,
    pub(crate) binding: &'a dyn crate::semantic::Binding,
    pub(crate) atoms: &'a dyn Intern,
    pub(crate) lazy: Lazy,
    pub(crate) types: Option<crate::types::Checker<'a>>,
    pub(crate) sink: crate::context::Sink,
    language: &'a LanguageOptions,
    body: hir::IdList<hir::StmtId>,
    path: &'a [u8],
    kind: FileKind,
    is_js: bool,
    /// Whether there can be casts that are synthesized from JSDoc comments.
    hides_casts: bool,
    has_module_syntax: bool,
    has_parse_errors: bool,
}

impl<'a> File<'a> {
    /// `path`: as it is reported. `types`: the type checker, if the file is part of a program that
    /// has been checked.
    pub fn new(
        path: &'a [u8],
        hir: &'a hir::File<'_>,
        bound: &'a bind::Bound<'_>,
        atoms: &'a dyn Intern,
        language: &'a LanguageOptions,
        types: Option<crate::types::Checker<'a>>,
    ) -> File<'a> {
        File {
            language,
            body: hir.body,
            kind: hir.kind,
            is_js: hir.is_js,
            hides_casts: hir.is_js && !hir.jsdoc_comments.is_empty(),
            has_module_syntax: hir.has_module_syntax
                || hir.is_module_by_decree
                || path.ends_with(b".mjs")
                || path.ends_with(b".mts"),
            has_parse_errors: hir.has_errors || hir.has_parse_diagnostics,
            hir: Hir::new(hir),
            bound: Bound::new(bound),
            binding: bound,
            atoms,
            lazy: Lazy::default(),
            types,
            sink: crate::context::Sink::default(),
            path,
        }
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

    #[inline]
    pub fn kind(&self) -> FileKind {
        self.kind
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

    /// It has an `import` or an `export` at the top level, or its extension says that it is a
    /// module: `.mjs`, `.mts`.
    #[inline]
    pub fn has_module_syntax(&self) -> bool {
        self.has_module_syntax
    }

    /// The parser reported an error. No rule runs on such a file.
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

    /// The range of ESLint's `Program`: from the first token, after a `#!` line and comments, to
    /// the end of the text.
    pub fn program_span(&self) -> Span {
        Span::new(crate::tokens::skip_trivia(self.hir.text, 0), self.hir.text.len() as u32)
    }

    /// The name that `atom` stands for.
    #[inline]
    pub(crate) fn name(&'a self, atom: Atom) -> Name<'a> {
        Name::new(self, atom)
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
    pub(crate) fn is_in_jsdoc(&self, pos: u32) -> bool {
        let comments = self.hir.jsdoc_comments;
        if comments.is_empty() {
            return false;
        }
        let after = comments.partition_point(|c| c.0 <= pos);
        after > 0 && pos < comments[after - 1].1
    }

    /// `/** @type {T} */ (e)`, `/** @satisfies {T} */ (e)`: if `id` is the `e as T` that the HIR has
    /// in these parentheses, the `e`. The source has no such node, and neither has a handle: it
    /// takes exactly the place of `e` and the parentheses that `e` has of its own.
    pub(crate) fn jsdoc_cast_operand(&self, id: hir::ExprId) -> Option<hir::ExprId> {
        if !self.hides_casts {
            return None;
        }
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
            _ => self.hir.exprs.get(operand.idx()).map(|it| (it.pos, it.end))?,
        };
        (place == (cast.pos, cast.end)).then_some(operand)
    }

    /// The cast that is synthesized from a JSDoc comment around the expression `id`.
    pub(crate) fn jsdoc_cast_around(&self, id: hir::ExprId) -> Option<hir::ExprId> {
        if !self.hides_casts {
            return None;
        }
        match self.bound.expr_parent.get(id.idx()) {
            Some(&bind::Parent::Expr(parent)) if self.jsdoc_cast_operand(parent) == Some(id) => Some(parent),
            _ => None,
        }
    }

    /// `id`, or what is in it if it is a cast that is synthesized from a JSDoc comment.
    #[inline]
    pub(crate) fn written_expr(&self, mut id: hir::ExprId) -> hir::ExprId {
        if self.hides_casts {
            while let Some(operand) = self.jsdoc_cast_operand(id) {
                id = operand;
            }
        }
        id
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

            /// `None` if the HIR leaves `id` empty.
            #[inline]
            pub(crate) fn some(file: &'a $crate::ast::File<'a>, id: ::bun_sema::hir::$id) -> Option<Self> {
                (id.idx() < file.hir.$field.len()).then(|| $name::new(file, id))
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

            #[inline]
            pub(crate) fn try_raw(self) -> Option<&'a ::bun_sema::hir::$raw> {
                self.file.hir.$field.get(self.id.idx())
            }

            /// The source text of the node.
            #[inline]
            pub fn text(self) -> &'a [u8] {
                self.file.slice(self.span())
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
                self.file.has_synthetic_nodes() && self.file.is_in_jsdoc(self.span().start)
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
