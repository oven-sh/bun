//! Statements, including declarations, imports and exports.

use super::{
    Alias, Class, Enum, Export, Expr, Flags, Func, Ident, Import, ImportEquals, Interface, List,
    Modifier, Module, Name, Node, Pat, TypeNode, VarKind, handle,
};
use crate::span::Span;
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
    /// `init` is a `Var` or an `Expr`.
    For {
        init: Option<Stmt<'a>>,
        test: Option<Expr<'a>>,
        update: Option<Expr<'a>>,
        body: Stmt<'a>,
    },
    /// `left` is a `Var` with one declaration, or an `Expr`.
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
            // The HIR stores `with (object) body` as a block of the two, positioned at the keyword.
            hir::StmtKind::Block(list)
                if list.len() == 2 && file.slice(self.span()).starts_with(b"with") =>
            {
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
        (self.try_raw()).map_or(Span::default(), |raw| Span::new(raw.start, raw.loc.end))
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
    /// statements of a function or of the file.
    pub fn directive(self) -> Option<&'a [u8]> {
        let StmtKind::Expr(expr) = self.kind() else {
            return None;
        };
        if expr.as_string().is_none() || expr.is_parenthesized() {
            return None;
        }
        let siblings = match self.parent() {
            Node::File(file) => file.body(),
            Node::Func(func) => func.body_statements()?,
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
