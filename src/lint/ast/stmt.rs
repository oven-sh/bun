//! Statements, including declarations, imports and exports.

use super::{
    Alias, Class, Enum, Export, Expr, Flags, Func, Ident, Import, ImportAttributes, ImportEquals,
    Interface, List, Modifier, Module, Name, Node, Pat, TypeNode, VarKind, handle,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_sema::hir;

handle! {
    /// A statement.
    Stmt, StmtId, stmts, Stmt
}

#[derive(Copy, Clone, Debug)]
pub enum StmtKind<'a> {
    Empty,
    Debugger,
    Expr(Expr<'a>),
    /// `var`, `let`, `const`, `using`, `await using`. Also what the head of a `for` declares.
    Var(List<'a, VarDecl<'a>>),
    Fn(Func<'a>),
    Class(Class<'a>),
    Interface(Interface<'a>),
    TypeAlias(Alias<'a>),
    Enum(Enum<'a>),
    /// `namespace N {}`, `declare module "m" {}`, `declare global {}`
    Module(Module<'a>),
    Return(Option<Expr<'a>>),
    If {
        test: Expr<'a>,
        yes: Stmt<'a>,
        no: Option<Stmt<'a>>,
    },
    /// `init` is a `Var`, or an `Expr` that is a [wrapper](Stmt::is_wrapper).
    For {
        init: Option<Stmt<'a>>,
        test: Option<Expr<'a>>,
        update: Option<Expr<'a>>,
        body: Stmt<'a>,
    },
    /// `left` is a `Var` with one declaration, or an `Expr` that is a [wrapper](Stmt::is_wrapper).
    /// A destructuring target is an `Array` or an `Object`, as in an assignment.
    ForIn {
        left: Stmt<'a>,
        expr: Expr<'a>,
        body: Stmt<'a>,
    },
    ForOf {
        left: Stmt<'a>,
        expr: Expr<'a>,
        body: Stmt<'a>,
        is_await: bool,
    },
    While {
        test: Expr<'a>,
        body: Stmt<'a>,
    },
    DoWhile {
        body: Stmt<'a>,
        test: Expr<'a>,
    },
    Block(List<'a, Stmt<'a>>),
    With {
        object: Expr<'a>,
        body: Stmt<'a>,
    },
    Switch {
        expr: Expr<'a>,
        cases: List<'a, Case<'a>>,
    },
    /// `block`, `handler` and `finalizer` are `Block`s.
    Try {
        block: Stmt<'a>,
        /// The `e` of `catch (e)`.
        param: Option<VarDecl<'a>>,
        handler: Option<Stmt<'a>>,
        finalizer: Option<Stmt<'a>>,
    },
    Throw(Expr<'a>),
    Break(Option<Name<'a>>),
    Continue(Option<Name<'a>>),
    Labeled {
        label: Name<'a>,
        body: Stmt<'a>,
    },
    Import(Import<'a>),
    /// `import a = require("m")`, `import a = b.c`
    ImportEquals(ImportEquals<'a>),
    /// `export { a as b }`, with or without `from`.
    ExportNamed(Export<'a>),
    /// `export * from "m"`, `export * as alias from "m"`
    ExportStar {
        spec: Option<Name<'a>>,
        alias: Option<Ident<'a>>,
        type_only: bool,
    },
    /// `export default e`. A function or a class declaration after `export default` is a `Fn` or
    /// a `Class` with `Flags::EXPORT | Flags::DEFAULT`.
    ExportDefault(Expr<'a>),
    /// `export = e`
    ExportAssign(Expr<'a>),
    /// `export as namespace N`
    ExportAsNamespace(Name<'a>),
}

macro_rules! tags {
    ($(#[$doc:meta])* $name:ident of $kind:ident { $($variant:ident $pattern:tt,)* }) => {
        $(#[$doc])*
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum $name { $($variant,)* }

        impl $name {
            pub const COUNT: usize = [$($name::$variant),*].len();
            pub const ALL: [$name; Self::COUNT] = [$($name::$variant),*];

            #[inline]
            pub(crate) fn of(kind: &hir::$kind) -> $name {
                match kind { $(tags!(@pattern $kind $variant $pattern) => $name::$variant,)* }
            }
        }
    };
    (@pattern $kind:ident $variant:ident unit) => { hir::$kind::$variant };
    (@pattern $kind:ident $variant:ident tuple) => { hir::$kind::$variant(..) };
    (@pattern $kind:ident $variant:ident fields) => { hir::$kind::$variant { .. } };
}
pub(crate) use tags;

tags! {
    /// The kind of a statement without what it holds. This is what a rule listens for.
    ///
    /// A `with` statement has the tag `Block`.
    StmtTag of StmtKind {
        Empty unit,
        Debugger unit,
        Expr tuple,
        Var tuple,
        Fn tuple,
        Class tuple,
        Interface tuple,
        TypeAlias tuple,
        Enum tuple,
        Module tuple,
        Return tuple,
        If fields,
        For fields,
        ForIn fields,
        ForOf fields,
        While fields,
        DoWhile fields,
        Block tuple,
        Switch fields,
        Try fields,
        Throw tuple,
        Break tuple,
        Continue tuple,
        Labeled fields,
        Import tuple,
        ImportEquals tuple,
        ExportNamed tuple,
        ExportStar fields,
        ExportDefault tuple,
        ExportAssign tuple,
        ExportAsNamespace tuple,
    }
}

impl<'a> Stmt<'a> {
    pub fn kind(self) -> StmtKind<'a> {
        let file = self.file;
        let e = |id| Expr::new(file, id);
        let s = |id| Stmt::new(file, id);
        let Some(raw) = self.try_raw() else {
            return StmtKind::Empty;
        };
        match raw.kind {
            hir::StmtKind::Empty => StmtKind::Empty,
            hir::StmtKind::Debugger => StmtKind::Debugger,
            hir::StmtKind::Expr(expr) => StmtKind::Expr(e(expr)),
            hir::StmtKind::Var(decls) => StmtKind::Var(List::run(file, decls)),
            hir::StmtKind::Fn(f) => StmtKind::Fn(Func::new(file, f)),
            hir::StmtKind::Class(c) => StmtKind::Class(Class::new(file, c)),
            hir::StmtKind::Interface(i) => StmtKind::Interface(Interface::new(file, i)),
            hir::StmtKind::TypeAlias(a) => StmtKind::TypeAlias(Alias::new(file, a)),
            hir::StmtKind::Enum(en) => StmtKind::Enum(Enum::new(file, en)),
            hir::StmtKind::Module(m) => StmtKind::Module(Module::new(file, m)),
            hir::StmtKind::Return(value) => StmtKind::Return(Expr::some(file, value)),
            hir::StmtKind::If { test, yes, no } => StmtKind::If {
                test: e(test),
                yes: s(yes),
                no: Stmt::some(file, no),
            },
            hir::StmtKind::For {
                init,
                test,
                update,
                body,
            } => StmtKind::For {
                init: Stmt::some(file, init),
                test: Expr::some(file, test),
                update: Expr::some(file, update),
                body: s(body),
            },
            hir::StmtKind::ForIn { left, expr, body } => StmtKind::ForIn {
                left: s(left),
                expr: e(expr),
                body: s(body),
            },
            hir::StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => StmtKind::ForOf {
                left: s(left),
                expr: e(expr),
                body: s(body),
                is_await,
            },
            hir::StmtKind::While { test, body } => StmtKind::While {
                test: e(test),
                body: s(body),
            },
            hir::StmtKind::DoWhile { body, test } => StmtKind::DoWhile {
                body: s(body),
                test: e(test),
            },
            hir::StmtKind::Block(list) if file.is_with(raw) => {
                let list: List<'a, Stmt<'a>> = List::ids(file, list);
                match (list.get(0).map(Stmt::kind), list.get(1)) {
                    (Some(StmtKind::Expr(object)), Some(body)) => StmtKind::With { object, body },
                    _ => StmtKind::Block(list),
                }
            }
            hir::StmtKind::Block(list) => StmtKind::Block(List::ids(file, list)),
            hir::StmtKind::Switch { expr, cases } => StmtKind::Switch {
                expr: e(expr),
                cases: List::run(file, cases),
            },
            hir::StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => StmtKind::Try {
                block: s(block),
                param: VarDecl::some(file, param),
                handler: Stmt::some(file, handler),
                finalizer: Stmt::some(file, finalizer),
            },
            hir::StmtKind::Throw(value) => StmtKind::Throw(e(value)),
            hir::StmtKind::Break(label) => StmtKind::Break(file.name_if_some(label)),
            hir::StmtKind::Continue(label) => StmtKind::Continue(file.name_if_some(label)),
            hir::StmtKind::Labeled { label, body } => StmtKind::Labeled {
                label: file.name(label),
                body: s(body),
            },
            hir::StmtKind::Import(i) => StmtKind::Import(Import::new(file, i)),
            hir::StmtKind::ImportEquals(i) => StmtKind::ImportEquals(ImportEquals::new(file, i)),
            hir::StmtKind::ExportNamed(x) => StmtKind::ExportNamed(Export::new(file, x)),
            hir::StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                alias_pos,
                ..
            } => StmtKind::ExportStar {
                spec: file.name_if_some(spec),
                alias: file.ident_if_some(alias, alias_pos),
                type_only,
            },
            hir::StmtKind::ExportDefault(value) => StmtKind::ExportDefault(e(value)),
            hir::StmtKind::ExportAssign(value) => StmtKind::ExportAssign(e(value)),
            hir::StmtKind::ExportAsNamespace(name) => {
                StmtKind::ExportAsNamespace(file.name(name))
            }
        }
    }

    #[inline]
    pub fn tag(self) -> StmtTag {
        (self.try_raw()).map_or(StmtTag::Empty, |raw| StmtTag::of(&raw.kind))
    }

    /// From its first token, which can be a decorator or a modifier such as `export`, to the end
    /// of its last, which can be a `;`.
    #[inline]
    pub fn span(self) -> Span {
        match self.try_raw() {
            // The HIR positions the block after `finally` at the keyword.
            Some(raw @ hir::Stmt { kind: hir::StmtKind::Block(_), .. })
                if self.file.hir.text.get(raw.start as usize) == Some(&b'f') =>
            {
                Span::new(skip_trivia(self.file.hir.text, raw.loc.pos), raw.loc.end)
            }
            Some(raw) => Span::new(raw.start, raw.loc.end),
            None => Span::default(),
        }
    }

    /// `export`, `default`, `declare`, `async`, `abstract`, `const`, and decorators, in source
    /// order.
    #[inline]
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        match self.try_raw() {
            Some(raw) => List::run(self.file, raw.modifiers),
            None => List::empty(self.file),
        }
    }

    /// The modifiers as flags.
    pub fn flags(self) -> Flags {
        let mut flags = Flags::empty();
        for modifier in self.modifiers() {
            flags |= modifier.flag();
        }
        flags
    }

    /// It starts with `export`.
    #[inline]
    pub fn is_exported(self) -> bool {
        self.flags().contains(Flags::EXPORT)
    }

    /// The declaration without `export` and `export default`, which is what ESLint calls the
    /// declaration: those are an `ExportNamedDeclaration` or an `ExportDefaultDeclaration` around
    /// it.
    pub fn span_without_export(self) -> Span {
        let whole = self.span();
        let mut start = whole.start;
        for modifier in self.modifiers() {
            if modifier.flag().intersects(Flags::EXPORT | Flags::DEFAULT) {
                start = crate::tokens::skip_trivia(self.file.text(), modifier.span().end);
            }
        }
        Span::new(start, whole.end)
    }

    /// The range of ESLint's `ExportNamedDeclaration` or `ExportDefaultDeclaration` around a
    /// declaration: from the `export`. It differs from [`Stmt::span`] where decorators come first:
    /// `@d export class C {}`.
    pub fn export_span(self) -> Option<Span> {
        let export = self.modifiers().iter().find(|it| it.flag() == Flags::EXPORT)?;
        Some(Span::new(export.span().start, self.span().end))
    }

    /// `export default` before a function, a class or an interface.
    #[inline]
    pub fn is_default_export(self) -> bool {
        self.flags().contains(Flags::EXPORT | Flags::DEFAULT)
    }

    /// The `;` that ends it, if it has one.
    pub fn semicolon(self) -> Option<Span> {
        let end = self.span().end;
        let is_terminated = match self.tag() {
            StmtTag::Empty
            | StmtTag::Debugger
            | StmtTag::Expr
            | StmtTag::Var
            | StmtTag::Return
            | StmtTag::DoWhile
            | StmtTag::Throw
            | StmtTag::Break
            | StmtTag::Continue
            | StmtTag::TypeAlias
            | StmtTag::Import
            | StmtTag::ImportEquals
            | StmtTag::ExportNamed
            | StmtTag::ExportStar
            | StmtTag::ExportDefault
            | StmtTag::ExportAssign
            | StmtTag::ExportAsNamespace => true,
            // An overload or an ambient function, `declare module "m";`
            StmtTag::Fn | StmtTag::Module => true,
            _ => false,
        };
        (is_terminated && self.file.hir.text.get(end.wrapping_sub(1) as usize) == Some(&b';'))
            .then(|| Span::new(end - 1, end))
    }

    /// Of a `Try` with a `catch`: from the `catch` to the end of its block, the range of ESLint's
    /// `CatchClause`.
    pub fn catch_clause_span(self) -> Option<Span> {
        let StmtKind::Try { block, handler, .. } = self.kind() else {
            return None;
        };
        Some(Span::new(skip_trivia(self.file.text(), block.span().end), handler?.span().end))
    }

    /// The module specifier with its quotes: of an `Import`, of an `ExportNamed` or an
    /// `ExportStar` after `from`, of an `ImportEquals` in `require(..)`.
    pub fn module_specifier_span(self) -> Option<Span> {
        let text = self.file.text();
        let is_at = |at: u32, token: &[u8]| text.get(at as usize..).is_some_and(|it| it.starts_with(token));
        // Past `token`, if it is at `at`.
        let past = |at: u32, token: &[u8]| is_at(at, token).then(|| skip_trivia(text, at + token.len() as u32));
        let start = match self.try_raw()?.kind {
            hir::StmtKind::Import(import) => {
                let import = self.file.hir.imports.get(import.idx())?;
                match is_at(import.clause_start, b"\"") || is_at(import.clause_start, b"'") {
                    true => import.clause_start,
                    false => past(skip_trivia(text, import.clause_end), b"from")?,
                }
            }
            hir::StmtKind::ExportStar { alias, star_pos, alias_pos, .. } => {
                let before = match alias.is_some() {
                    true => self.file.ident(alias, alias_pos).span().end,
                    false => star_pos + 1,
                };
                past(skip_trivia(text, before), b"from")?
            }
            hir::StmtKind::ExportNamed(export) => {
                let export = Export::new(self.file, export);
                let close = match export.items().last() {
                    Some(last) => {
                        let after = skip_trivia(text, last.span().end);
                        past(after, b",").unwrap_or(after)
                    }
                    None => {
                        let after = past(self.span().start, b"export")?;
                        past(past(after, b"type").unwrap_or(after), b"{")?
                    }
                };
                past(past(close, b"}")?, b"from")?
            }
            hir::StmtKind::ImportEquals(import) => {
                let name = ImportEquals::new(self.file, import).name();
                let equals = skip_trivia(text, name.span().end);
                past(past(past(equals, b"=")?, b"require")?, b"(")?
            }
            _ => return None,
        };
        let rest = text.get(start as usize..)?;
        matches!(rest.first(), Some(b'"' | b'\'')).then(|| Span::new(start, start + crate::tokens::token_len(rest) as u32))
    }

    /// `with { type: "json" }` of an `Import`, an `ExportNamed` or an `ExportStar`.
    pub fn import_attributes(self) -> Option<ImportAttributes<'a>> {
        if self.file.hir.import_attributes.is_empty()
            || !matches!(self.tag(), StmtTag::Import | StmtTag::ExportNamed | StmtTag::ExportStar)
        {
            return None;
        }
        ImportAttributes::within(self.file, self.span())
    }

    /// The `N` of the `ExportAsNamespace` `export as namespace N`, where it is written.
    pub fn namespace_export_name(self) -> Option<Ident<'a>> {
        let hir::StmtKind::ExportAsNamespace(name) = self.try_raw()?.kind else {
            return None;
        };
        let text = self.file.text();
        let mut at = self.span().start;
        for keyword in ["export", "as", "namespace"] {
            at = skip_trivia(text, at + keyword.len() as u32);
        }
        Some(self.file.ident(name, at))
    }

    /// It wraps the expression in the head of a `for`, or the object of a `with`. The HIR has a
    /// statement there and the source has none: it is nobody's parent and no listener is called
    /// with it.
    #[inline]
    pub fn is_wrapper(self) -> bool {
        self.file.wrapped_in(self.id).is_some()
    }

    /// The `for` or `with` statement that it is a wrapper in.
    #[inline]
    pub(crate) fn wrapped_in(self) -> Option<Stmt<'a>> {
        self.file.wrapped_in(self.id).map(|parent| Stmt::new(self.file, parent))
    }

    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Stmt(self).parent()
    }

    /// The label of a `Labeled`, a `Break` or a `Continue`, where it is written.
    pub fn label(self) -> Option<Ident<'a>> {
        let (file, start) = (self.file, self.span().start);
        match self.try_raw()?.kind {
            hir::StmtKind::Labeled { label, .. } => Some(file.ident(label, start)),
            hir::StmtKind::Break(label) if label.is_some() => {
                let at = crate::tokens::skip_trivia(file.text(), start + "break".len() as u32);
                Some(file.ident(label, at))
            }
            hir::StmtKind::Continue(label) if label.is_some() => {
                let at = crate::tokens::skip_trivia(file.text(), start + "continue".len() as u32);
                Some(file.ident(label, at))
            }
            _ => None,
        }
    }

    /// The statements, if it is a block.
    #[inline]
    pub fn as_block(self) -> Option<List<'a, Stmt<'a>>> {
        match self.kind() {
            StmtKind::Block(statements) => Some(statements),
            _ => None,
        }
    }

    /// `for`, `for`-`in`, `for`-`of`, `while`, `do`-`while`
    #[inline]
    pub fn is_loop(self) -> bool {
        matches!(
            self.tag(),
            StmtTag::For | StmtTag::ForIn | StmtTag::ForOf | StmtTag::While | StmtTag::DoWhile
        )
    }

    /// `"use strict"` and the like: the text between the quotes, if this is an expression
    /// statement that consists of an unparenthesized string literal and is among the first
    /// statements of a function, of a namespace or of the file.
    pub fn directive(self) -> Option<&'a [u8]> {
        let StmtKind::Expr(expr) = self.kind() else {
            return None;
        };
        if expr.as_string().is_none() || expr.is_parenthesized() {
            return None;
        }
        let siblings = match self.parent() {
            Node::File(file) => file.body(),
            Node::Func(func) if func.kind() != super::FnKind::StaticBlock => func.body_statements()?,
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::Module(module) => module.innermost().body(),
                _ => return None,
            },
            _ => return None,
        };
        for sibling in siblings {
            if sibling == self {
                return Some(self.file.slice(expr.span().shrink(1, 1)));
            }
            match sibling.kind() {
                StmtKind::Expr(e) if e.as_string().is_some() && !e.is_parenthesized() => {}
                _ => return None,
            }
        }
        None
    }
}

impl super::File<'_> {
    /// The HIR stores `with (object) body` as a block of the two, positioned at the keyword.
    #[inline]
    fn is_with(&self, raw: &hir::Stmt) -> bool {
        !self.hir.with_bodies.is_empty()
            && matches!(raw.kind, hir::StmtKind::Block(list) if list.len() == 2)
            && self.hir.text.get(raw.start as usize..).is_some_and(|it| it.starts_with(b"with"))
    }

    /// The `for` or `with` statement that the statement `id` is a wrapper in.
    pub(super) fn wrapped_in(&self, id: hir::StmtId) -> Option<hir::StmtId> {
        if !matches!(self.hir.stmts.get(id.idx())?.kind, hir::StmtKind::Expr(_)) {
            return None;
        }
        let Some(&bun_sema::bind::Parent::Stmt(parent)) = self.bound.stmt_parent.get(id.idx()) else {
            return None;
        };
        let raw = self.hir.stmts.get(parent.idx())?;
        let is_wrapper = match raw.kind {
            hir::StmtKind::For { init: head, .. }
            | hir::StmtKind::ForIn { left: head, .. }
            | hir::StmtKind::ForOf { left: head, .. } => head == id,
            hir::StmtKind::Block(list) => {
                self.is_with(raw) && self.hir.ids.get(list.start as usize) == Some(&id.0)
            }
            _ => false,
        };
        is_wrapper.then_some(parent)
    }
}

handle! {
    /// `pat: ty = init` in a `var`, `let`, `const` or `using` statement. Also the `e` of
    /// `catch (e)`.
    VarDecl, VarDeclId, var_decls, VarDecl
}

impl<'a> VarDecl<'a> {
    #[inline]
    fn raw(self) -> &'a hir::VarDecl {
        &self.file.hir.var_decls[self.id.idx()]
    }

    #[inline]
    pub fn pat(self) -> Pat<'a> {
        Pat::new(self.file, self.raw().pat)
    }

    #[inline]
    pub fn ty(self) -> Option<TypeNode<'a>> {
        TypeNode::written(self.file, self.raw().ty)
    }

    #[inline]
    pub fn init(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().init)
    }

    #[inline]
    pub fn var_kind(self) -> VarKind {
        self.raw().kind
    }

    /// `Flags::DEFINITE` for `x!: T`, and the flags of the statement.
    #[inline]
    pub fn flags(self) -> Flags {
        self.raw().flags
    }

    /// From the pattern to the end of the initializer.
    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.pat().span().start, self.raw().loc.end)
    }

    /// `x!: T`
    #[inline]
    pub fn is_definite(self) -> bool {
        self.flags().contains(Flags::DEFINITE)
    }

    /// The pattern and its type annotation, which is the range of ESLint's `id`: typescript-eslint
    /// has the annotation as a part of the `Identifier` or the pattern.
    pub fn binding_span(self) -> Span {
        let pat = self.pat().span();
        match self.ty() {
            Some(ty) => Span::new(pat.start, ty.outer_span().end),
            None => pat,
        }
    }

    /// The `Var` statement, or the `Try` statement of a `catch` parameter.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::VarDecl(self).parent()
    }
}

handle! {
    /// `case test: body`, `default: body`
    Case, CaseId, cases, Case
}

impl<'a> Case<'a> {
    #[inline]
    fn raw(self) -> &'a hir::Case {
        &self.file.hir.cases[self.id.idx()]
    }

    /// `None` for `default`.
    #[inline]
    pub fn test(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().test)
    }

    #[inline]
    pub fn is_default(self) -> bool {
        self.raw().test.is_none()
    }

    #[inline]
    pub fn body(self) -> List<'a, Stmt<'a>> {
        List::ids(self.file, self.raw().body)
    }

    #[inline]
    pub fn span(self) -> Span {
        Span::new(self.raw().pos, self.raw().end)
    }

    /// The `Switch` statement.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        Node::Case(self).parent()
    }
}
