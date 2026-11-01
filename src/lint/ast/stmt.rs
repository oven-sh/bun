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
    /// `var`, `let`, `const`, `using`, `await using`. Also the declaration in a `for` head.
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
    /// `init` is a `Var`, or an `Expr` that's a [wrapper](Stmt::is_wrapper).
    For {
        init: Option<Stmt<'a>>,
        test: Option<Expr<'a>>,
        update: Option<Expr<'a>>,
        body: Stmt<'a>,
    },
    /// `left` is a `Var` with one declaration, or an `Expr` that's a [wrapper](Stmt::is_wrapper). A destructuring
    /// target is an `Array` or an `Object`, as in an assignment.
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
    /// `export default e`. A function or class declaration after `export default` is a `Fn` or a `Class` with
    /// `Flags::EXPORT | Flags::DEFAULT`.
    ExportDefault(Expr<'a>),
    /// `export = e`
    ExportAssign(Expr<'a>),
    /// `export as namespace N`
    ExportAsNamespace(Name<'a>),
}

/// A kind of the HIR that is listed after the braces is shown as another.
macro_rules! tags {
    (
        $(#[$doc:meta])* $name:ident of $kind:ident { $($variant:ident $pattern:tt,)* }
        $($hidden:ident $hidden_pattern:tt => $shown:ident,)*
    ) => {
        $(#[$doc])*
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum $name { $($variant,)* }

        impl $name {
            pub const COUNT: usize = [$($name::$variant),*].len();
            pub const ALL: [$name; Self::COUNT] = [$($name::$variant),*];

            #[inline]
            pub(crate) fn of(kind: &hir::$kind) -> $name {
                match kind {
                    $(tags!(@pattern $kind $variant $pattern) => $name::$variant,)*
                    $(tags!(@pattern $kind $hidden $hidden_pattern) => $name::$shown,)*
                }
            }
        }
    };
    (@pattern $kind:ident $variant:ident unit) => { hir::$kind::$variant };
    (@pattern $kind:ident $variant:ident tuple) => { hir::$kind::$variant(..) };
    (@pattern $kind:ident $variant:ident fields) => { hir::$kind::$variant { .. } };
}
pub(crate) use tags;

tags! {
    /// The kind of a statement without its payload. Rules listen for tags.
    ///
    /// A `with` statement has the tag `Block`, a directive the tag `Expr`.
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
    With fields => Block,
    Directive fields => Expr,
}

impl<'a> Stmt<'a> {
    /// See [`Expr::kind`].
    #[inline(never)]
    pub fn kind(self) -> StmtKind<'a> {
        match self.file.plain_stmts.get(self.id.idx()) {
            Some(raw) => self.kind_of::<true>(raw),
            None => self.kind_slow(),
        }
    }

    #[inline(never)]
    fn kind_slow(self) -> StmtKind<'a> {
        match self.try_raw() {
            Some(raw) => self.kind_of::<false>(raw),
            None => StmtKind::Empty,
        }
    }

    /// See `Expr::kind_of`.
    #[inline(always)]
    fn kind_of<const PLAIN: bool>(self, raw: &hir::Stmt) -> StmtKind<'a> {
        let file = self.file;
        let e = |id| match PLAIN {
            true => Expr { file, id },
            false => Expr::new(file, id),
        };
        let some = |id: hir::ExprId| (id.idx() < file.hir.exprs.len()).then(|| e(id));
        let s = |id| Stmt::new(file, id);
        match raw.kind {
            hir::StmtKind::Empty => StmtKind::Empty,
            hir::StmtKind::Debugger => StmtKind::Debugger,
            hir::StmtKind::Expr(expr) | hir::StmtKind::Directive { expr, .. } => {
                StmtKind::Expr(e(expr))
            }
            hir::StmtKind::Var(decls) => StmtKind::Var(List::run(file, decls)),
            hir::StmtKind::Fn(f) => StmtKind::Fn(Func::new(file, f)),
            hir::StmtKind::Class(c) => StmtKind::Class(Class::new(file, c)),
            hir::StmtKind::Interface(i) => StmtKind::Interface(Interface::new(file, i)),
            hir::StmtKind::TypeAlias(a) => StmtKind::TypeAlias(Alias::new(file, a)),
            hir::StmtKind::Enum(en) => StmtKind::Enum(Enum::new(file, en)),
            hir::StmtKind::Module(m) => StmtKind::Module(Module::new(file, m)),
            hir::StmtKind::Return(value) => StmtKind::Return(some(value)),
            hir::StmtKind::If { test, yes, no } => StmtKind::If {
                test: e(test),
                yes: s(yes),
                no: Stmt::some(file, no),
            },
            hir::StmtKind::For { .. } | hir::StmtKind::Try { .. } => self.kind_of_four_parts(raw),
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
            hir::StmtKind::Block(list) => StmtKind::Block(List::ids(file, list)),
            hir::StmtKind::With { object, body } => StmtKind::With {
                object: e(object),
                body: s(body),
            },
            hir::StmtKind::Switch { expr, cases } => StmtKind::Switch {
                expr: e(expr),
                cases: List::run(file, cases),
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
            hir::StmtKind::ExportAsNamespace(name) => StmtKind::ExportAsNamespace(file.name(name)),
        }
    }

    /// Split out of `kind_of`, which doesn't have to save any registers without these two.
    #[inline(never)]
    fn kind_of_four_parts(self, raw: &hir::Stmt) -> StmtKind<'a> {
        let file = self.file;
        match raw.kind {
            hir::StmtKind::For {
                init,
                test,
                update,
                body,
            } => StmtKind::For {
                init: Stmt::some(file, init),
                test: Expr::some(file, test),
                update: Expr::some(file, update),
                body: Stmt::new(file, body),
            },
            hir::StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => StmtKind::Try {
                block: Stmt::new(file, block),
                param: VarDecl::some(file, param),
                handler: Stmt::some(file, handler),
                finalizer: Stmt::some(file, finalizer),
            },
            _ => StmtKind::Empty,
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
            // The HIR starts the block after `finally` at the keyword.
            Some(
                raw @ hir::Stmt {
                    kind: hir::StmtKind::Block(_),
                    ..
                },
            ) if self.file.hir.text.get(raw.start as usize) == Some(&b'f') => {
                Span::new(skip_trivia(self.file.hir.text, raw.loc.pos), raw.loc.end)
            }
            Some(raw) => Span::new(raw.start, raw.loc.end),
            None => Span::default(),
        }
    }

    /// `export`, `default`, `declare`, `async`, `abstract`, `const`, and decorators, in source order.
    #[inline]
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        match self.try_raw() {
            Some(_) => List::run(self.file, self.file.hir.stmt_modifiers(self.id)),
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

    /// True if it has the `export` modifier.
    #[inline]
    pub fn is_exported(self) -> bool {
        self.flags().contains(Flags::EXPORT)
    }

    /// The declaration without `export` or `export default`. That's the range of ESLint's declaration node, which it
    /// wraps in an `ExportNamedDeclaration` or `ExportDefaultDeclaration`.
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

    /// The range of ESLint's `ExportNamedDeclaration` or `ExportDefaultDeclaration` around a declaration, which starts
    /// at the `export`. It differs from [`Stmt::span`] when decorators come first: `@d export class C {}`.
    pub fn export_span(self) -> Option<Span> {
        let export = self
            .modifiers()
            .iter()
            .find(|it| it.flag() == Flags::EXPORT)?;
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

    /// For a `Try` with a `catch`: from the `catch` to the end of its block, which is the range of ESLint's
    /// `CatchClause`.
    pub fn catch_clause_span(self) -> Option<Span> {
        let StmtKind::Try { block, handler, .. } = self.kind() else {
            return None;
        };
        Some(Span::new(
            skip_trivia(self.file.text(), block.span().end),
            handler?.span().end,
        ))
    }

    /// The module specifier with its quotes: in an `Import`, after the `from` of an `ExportNamed` or `ExportStar`, or
    /// in the `require(..)` of an `ImportEquals`.
    pub fn module_specifier_span(self) -> Option<Span> {
        let text = self.file.text();
        let is_at = |at: u32, token: &[u8]| {
            text.get(at as usize..)
                .is_some_and(|it| it.starts_with(token))
        };
        // The position after `token` and any trivia, if `token` is at `at`.
        let past = |at: u32, token: &[u8]| {
            is_at(at, token).then(|| skip_trivia(text, at + token.len() as u32))
        };
        let start = match self.try_raw()?.kind {
            hir::StmtKind::Import(import) => {
                let import = self.file.hir.imports.get(import.idx())?;
                match is_at(import.clause_start, b"\"") || is_at(import.clause_start, b"'") {
                    true => import.clause_start,
                    false => past(skip_trivia(text, import.clause_end), b"from")?,
                }
            }
            hir::StmtKind::ExportStar {
                alias,
                star_pos,
                alias_pos,
                ..
            } => {
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
                        // Flow's `declare export {}`
                        let start = self.span().start;
                        let after = past(past(start, b"declare").unwrap_or(start), b"export")?;
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
        let (&quote, inside) = rest
            .split_first()
            .filter(|it| matches!(it.0, b'"' | b'\''))?;
        // Nearly every specifier is a path without escapes, on one line.
        let len = match bun_core::strings::index_of_any(inside, &[quote, b'\\', b'\n', b'\r']) {
            Some(at) if inside[at] == quote => at + 2,
            _ => crate::tokens::token_len(rest),
        };
        Some(Span::new(start, start + len as u32))
    }

    /// `with { type: "json" }` of an `Import`, an `ExportNamed` or an `ExportStar`.
    pub fn import_attributes(self) -> Option<ImportAttributes<'a>> {
        if self.file.hir.import_attributes.is_empty()
            || !matches!(
                self.tag(),
                StmtTag::Import | StmtTag::ExportNamed | StmtTag::ExportStar
            )
        {
            return None;
        }
        ImportAttributes::within(self.file, self.span())
    }

    /// The offset of the `*` of an `ExportStar`.
    pub fn export_star_offset(self) -> Option<u32> {
        match self.try_raw()?.kind {
            hir::StmtKind::ExportStar { star_pos, .. } => Some(star_pos),
            _ => None,
        }
    }

    /// The `N` of the `ExportAsNamespace` `export as namespace N`, with its position.
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

    /// True if it wraps the expression in a `for` head.
    #[inline]
    pub fn is_wrapper(self) -> bool {
        self.file.wrapped_in(self.id).is_some()
    }

    /// The `for` statement it's a wrapper in.
    #[inline]
    pub(crate) fn wrapped_in(self) -> Option<Stmt<'a>> {
        self.file
            .wrapped_in(self.id)
            .map(|parent| Stmt::new(self.file, parent))
    }

    /// The label of a `Labeled`, a `Break` or a `Continue`, with its position.
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

    /// The statements, if it's a block.
    #[inline]
    pub fn as_block(self) -> Option<List<'a, Stmt<'a>>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Block(list) => Some(List::ids(self.file, list)),
            _ => None,
        }
    }

    #[inline]
    pub fn is_with(self) -> bool {
        self.file.has_with_statements() && matches!(self.kind(), StmtKind::With { .. })
    }

    /// The expression of an `Expr`.
    #[inline]
    pub fn as_expr(self) -> Option<Expr<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Expr(e) | hir::StmtKind::Directive { expr: e, .. } => {
                Some(Expr::new(self.file, e))
            }
            _ => None,
        }
    }

    /// The declarations of a `Var`.
    #[inline]
    pub fn as_var(self) -> Option<List<'a, VarDecl<'a>>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Var(decls) => Some(List::run(self.file, decls)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_fn(self) -> Option<Func<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Fn(func) => Some(Func::new(self.file, func)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_class(self) -> Option<Class<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Class(class) => Some(Class::new(self.file, class)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_interface(self) -> Option<Interface<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Interface(interface) => Some(Interface::new(self.file, interface)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_module(self) -> Option<Module<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Module(module) => Some(Module::new(self.file, module)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_import(self) -> Option<Import<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Import(import) => Some(Import::new(self.file, import)),
            _ => None,
        }
    }

    #[inline]
    pub fn as_export_named(self) -> Option<Export<'a>> {
        match self.try_raw()?.kind {
            hir::StmtKind::ExportNamed(export) => Some(Export::new(self.file, export)),
            _ => None,
        }
    }

    /// The value of a `Return`. `Some(None)` for a bare `return`.
    #[inline]
    pub fn as_return(self) -> Option<Option<Expr<'a>>> {
        match self.try_raw()?.kind {
            hir::StmtKind::Return(value) => Some(Expr::some(self.file, value)),
            _ => None,
        }
    }

    /// The `test`, `yes` and `no` of an `If`.
    #[inline]
    pub fn as_if(self) -> Option<(Expr<'a>, Stmt<'a>, Option<Stmt<'a>>)> {
        match self.try_raw()?.kind {
            hir::StmtKind::If { test, yes, no } => Some((
                Expr::new(self.file, test),
                Stmt::new(self.file, yes),
                Stmt::some(self.file, no),
            )),
            _ => None,
        }
    }

    /// The `expr` and `cases` of a `Switch`.
    #[inline]
    pub fn as_switch(self) -> Option<(Expr<'a>, List<'a, Case<'a>>)> {
        match self.try_raw()?.kind {
            hir::StmtKind::Switch { expr, cases } => {
                Some((Expr::new(self.file, expr), List::run(self.file, cases)))
            }
            _ => None,
        }
    }

    /// The `label` and `body` of a `Labeled`.
    #[inline]
    pub fn as_labeled(self) -> Option<(Name<'a>, Stmt<'a>)> {
        match self.try_raw()?.kind {
            hir::StmtKind::Labeled { label, body } => {
                Some((self.file.name(label), Stmt::new(self.file, body)))
            }
            _ => None,
        }
    }

    /// The `left`, `expr`, `body` and `is_await` of a `ForOf`.
    #[inline]
    pub fn as_for_of(self) -> Option<(Stmt<'a>, Expr<'a>, Stmt<'a>, bool)> {
        match self.try_raw()?.kind {
            hir::StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => Some((
                Stmt::new(self.file, left),
                Expr::new(self.file, expr),
                Stmt::new(self.file, body),
                is_await,
            )),
            _ => None,
        }
    }

    /// The `init`, `test`, `update` and `body` of a `For`.
    #[inline]
    #[expect(clippy::type_complexity)]
    pub fn as_for(
        self,
    ) -> Option<(
        Option<Stmt<'a>>,
        Option<Expr<'a>>,
        Option<Expr<'a>>,
        Stmt<'a>,
    )> {
        match self.tag() {
            StmtTag::For => match self.kind() {
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                } => Some((init, test, update, body)),
                _ => None,
            },
            _ => None,
        }
    }

    /// The `block`, `param`, `handler` and `finalizer` of a `Try`.
    #[inline]
    #[expect(clippy::type_complexity)]
    pub fn as_try(
        self,
    ) -> Option<(
        Stmt<'a>,
        Option<VarDecl<'a>>,
        Option<Stmt<'a>>,
        Option<Stmt<'a>>,
    )> {
        match self.tag() {
            StmtTag::Try => match self.kind() {
                StmtKind::Try {
                    block,
                    param,
                    handler,
                    finalizer,
                } => Some((block, param, handler, finalizer)),
                _ => None,
            },
            _ => None,
        }
    }

    /// The `object` and `body` of a `With`.
    #[inline]
    pub fn as_with(self) -> Option<(Expr<'a>, Stmt<'a>)> {
        match self.file.has_with_statements() {
            true => match self.kind() {
                StmtKind::With { object, body } => Some((object, body)),
                _ => None,
            },
            false => None,
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

    /// `"use strict"` and the like. Returns the text between the quotes if this is an expression statement made of an
    /// unparenthesized string literal, among the first statements of a function, a namespace or the file.
    pub fn directive(self) -> Option<&'a [u8]> {
        let expr = self.as_expr()?;
        if expr.as_string().is_none() || expr.is_parenthesized() {
            return None;
        }
        let siblings = match self.parent() {
            Node::File(file) => file.body(),
            Node::Func(func) if func.kind() != super::FnKind::StaticBlock => {
                func.body_statements()?
            }
            Node::Stmt(parent) => parent.as_module()?.innermost().body(),
            _ => return None,
        };
        // Caches where the statement list starts and where its leading strings end. If there are many leading strings,
        // the next call is likely for the same list.
        let start = siblings.first()?.span().start;
        let end = match self.file.lazy.directives.get() {
            Some((known, end)) if known == start => end,
            _ => {
                let is_string = |it: &Stmt| {
                    (it.as_expr()).is_some_and(|e| e.as_string().is_some() && !e.is_parenthesized())
                };
                let end = siblings
                    .iter()
                    .take_while(is_string)
                    .last()
                    .map_or(start, |it| it.span().end);
                self.file.lazy.directives.set(Some((start, end)));
                end
            }
        };
        (self.span().start < end).then(|| self.file.slice(expr.span().shrink(1, 1)))
    }
}

impl super::File<'_> {
    /// True if the file has a `with` statement, which is a [`StmtKind::With`] with the tag `Block`.
    #[inline]
    pub fn has_with_statements(&self) -> bool {
        !self.hir.with_bodies.is_empty()
    }

    /// The `for` statement that the statement `id` is a wrapper in, if any.
    #[inline]
    pub(super) fn wrapped_in(&self, id: hir::StmtId) -> Option<hir::StmtId> {
        if !matches!(self.hir.stmts.get(id.idx())?.kind, hir::StmtKind::Expr(_)) {
            return None;
        }
        let bun_sema::bind::Parent::Stmt(parent) = self.bound.parent_of_stmt(id) else {
            return None;
        };
        let is_wrapper = match self.hir.stmts.get(parent.idx())?.kind {
            hir::StmtKind::For { init: head, .. }
            | hir::StmtKind::ForIn { left: head, .. }
            | hir::StmtKind::ForOf { left: head, .. } => head == id,
            _ => false,
        };
        is_wrapper.then_some(parent)
    }
}

handle! {
    /// `pat: ty = init` in a `var`, `let`, `const` or `using` statement. Also the `e` of `catch (e)`.
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
        TypeNode::in_source(self.file, self.raw().ty)
    }

    #[inline]
    pub fn init(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().init)
    }

    #[inline]
    pub fn var_kind(self) -> VarKind {
        self.raw().kind
    }

    /// `Flags::DEFINITE` for `x!: T`, plus the statement's flags.
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

    /// The pattern and its type annotation. That's the range of ESLint's `id`, because typescript-eslint includes the
    /// annotation in the `Identifier` or pattern.
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
        match self.file.bound.var_stmt.get(self.id.idx()) {
            Some(&statement) if statement.is_some() => Node::Stmt(Stmt::new(self.file, statement)),
            _ => Node::File(self.file),
        }
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
