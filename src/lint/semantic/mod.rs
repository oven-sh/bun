//! Scopes, what is declared in them, and what refers to it.
//!
//! This is what the binder of the type checker has computed for the file (`bun_sema::bind`): the
//! scopes, the symbols, and for every identifier the symbol it resolves to. Nothing is analyzed a
//! second time. The one thing that is added, the first time a rule asks, is the list of the
//! references to each symbol, which is that resolution inverted.
//!
//! | ESLint | here |
//! | --- | --- |
//! | `Variable` | [`Symbol`] |
//! | `variable.defs`, `variable.identifiers` | [`Symbol::declarations`] |
//! | `variable.references` | [`Symbol::references`] |
//! | `variable.scope` | [`Symbol::scope`] |
//! | `Reference` | [`Reference`] |
//! | `reference.resolved` | [`Reference::symbol`], [`Expr::symbol`] |
//! | `reference.isRead()`, `isWrite()` | [`Reference::is_read`], [`Reference::is_write`] |
//! | `sourceCode.getScope(node)` | [`Node::scope`] |
//! | `sourceCode.getDeclaredVariables(node)` | [`Node::declared_symbols`] |
//! | `globalScope.through` | [`File::unresolved_references`] |
//! | `scope.variables`, `scope.set.get(name)` | [`Scope::symbols`], [`Scope::get`] |
//! | `scope.upper`, `scope.childScopes` | [`Scope::parent`], [`Scope::children`] |
//! | `findVariable(scope, name)` | [`Scope::resolve`] |
//!
//! Where TypeScript's model differs from ESLint's:
//! - A class declaration is one symbol. ESLint has a second variable for the name inside the
//!   class.
//! - Declarations that merge are one symbol with several declarations: an interface and a class, a
//!   function and a namespace, several `var`s.
//! - A symbol has meanings ([`SymFlags::VALUE`], [`SymFlags::TYPE`], [`SymFlags::NAMESPACE`]), and
//!   a reference asks for one.

use crate::ast::{
    Alias, Class, Enum, EnumMember, Expr, File, Func, Ident, Import, ImportEquals, ImportSpec,
    Interface, Module, Name, Node, Pat, TypeParam,
};
use crate::span::{Span, Spanned};
use bun_sema::atom::Atom;
use bun_sema::bind::{self, Decl, ScopeId, SymbolId, TableId};
use bun_sema::hir;

pub use bun_sema::bind::SymFlags;

mod index;
pub(crate) use index::ReferenceIndex;

/// The parts of a `bind::Bound` that are not plain slices, for those who cannot name the lifetime
/// of its session, in which it is invariant.
pub(crate) trait Binding {
    fn symbol_count(&self) -> usize;
    fn symbol(&self, id: SymbolId) -> Option<RawSymbol>;
    fn declarations(&self, id: SymbolId) -> &[Decl];
    fn table(&self, table: TableId) -> &[(Atom, SymbolId)];
    fn lookup(&self, table: TableId, name: Atom) -> Option<SymbolId>;
    fn scope_of_expr(&self, e: hir::ExprId) -> Option<ScopeId>;
    fn scope_of_declaration(&self, hir: &hir::File, decl: Decl) -> ScopeId;
}

/// A `bind::Symbol` without its declarations.
#[derive(Copy, Clone)]
pub(crate) struct RawSymbol {
    pub(crate) name: Atom,
    pub(crate) flags: SymFlags,
    pub(crate) parent: SymbolId,
    pub(crate) exports: TableId,
    pub(crate) export_symbol: SymbolId,
}

impl Binding for bind::Bound<'_> {
    fn symbol_count(&self) -> usize {
        self.symbols.len()
    }
    fn symbol(&self, id: SymbolId) -> Option<RawSymbol> {
        self.symbols.get(id.idx()).map(|symbol| RawSymbol {
            name: symbol.name,
            flags: symbol.flags,
            parent: symbol.parent,
            exports: symbol.exports,
            export_symbol: symbol.export_symbol,
        })
    }
    fn declarations(&self, id: SymbolId) -> &[Decl] {
        self.symbols.get(id.idx()).map_or(&[], |symbol| symbol.decls.as_slice())
    }
    fn table(&self, table: TableId) -> &[(Atom, SymbolId)] {
        match table.is_some() {
            true => bind::Bound::table(self, table),
            false => &[],
        }
    }
    fn lookup(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        table.is_some().then(|| bind::Bound::lookup(self, table, name)).flatten()
    }
    fn scope_of_expr(&self, e: hir::ExprId) -> Option<ScopeId> {
        self.expr_scope.get(&e).copied()
    }
    fn scope_of_declaration(&self, hir: &hir::File, decl: Decl) -> ScopeId {
        bind::Bound::scope_of_declaration(self, hir, decl)
    }
}

// ───────────────────────────── symbols ─────────────────────────────

/// Something that the file declares in a scope: a variable, a function, a class, a parameter, an
/// import, a type, a namespace, an enum.
#[derive(Copy, Clone)]
pub struct Symbol<'a> {
    file: &'a File<'a>,
    id: SymbolId,
}

impl PartialEq for Symbol<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Symbol<'_> {}
impl std::hash::Hash for Symbol<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
impl std::fmt::Debug for Symbol<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Symbol({}, {:?})", self.id.0, self.name())
    }
}

impl<'a> Symbol<'a> {
    #[inline]
    pub(crate) fn some(file: &'a File<'a>, id: SymbolId) -> Option<Self> {
        (id.idx() < file.binding.symbol_count()).then_some(Symbol { file, id })
    }

    /// The index of the symbol in the file, which with the file is what the type checker takes.
    #[inline]
    pub fn id(self) -> SymbolId {
        self.id
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    fn raw(self) -> RawSymbol {
        self.file.binding.symbol(self.id).unwrap_or(RawSymbol {
            name: Atom::NONE,
            flags: SymFlags::empty(),
            parent: SymbolId::NONE,
            exports: TableId::NONE,
            export_symbol: SymbolId::NONE,
        })
    }

    #[inline]
    pub fn name(self) -> Name<'a> {
        self.file.name(self.raw().name)
    }

    /// What kinds of things it is.
    #[inline]
    pub fn flags(self) -> SymFlags {
        self.raw().flags
    }

    /// It can be used as a value: a variable, a function, a class, an enum, a namespace with
    /// values in it.
    #[inline]
    pub fn is_value(self) -> bool {
        self.flags().intersects(SymFlags::VALUE)
    }

    /// It can be used as a type.
    #[inline]
    pub fn is_type(self) -> bool {
        self.flags().intersects(SymFlags::TYPE)
    }

    /// An import, which can be either.
    #[inline]
    pub fn is_import(self) -> bool {
        self.flags().contains(SymFlags::ALIAS)
    }

    /// In the order they are written.
    pub fn declarations(self) -> impl DoubleEndedIterator<Item = Declaration<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let declarations = file.binding.declarations(self.id).iter();
        declarations.map(move |&decl| Declaration::new(file, decl))
    }

    /// Everything in the file that refers to it, in source order. A declaration is not a
    /// reference, but the initializer of one makes a write reference of its name, as in ESLint.
    pub fn references(self) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let references = file.reference_index().of(self.id).iter();
        references.map(move |&raw| Reference { file, raw })
    }

    /// The scope it is declared in.
    pub fn scope(self) -> Scope<'a> {
        self.file.reference_index().scope_of_symbol(self.file, self.id)
    }

    /// It is exported from the file or from a namespace: by a modifier, by `export { it }` or by
    /// `export default it`.
    pub fn is_exported(self) -> bool {
        self.file.reference_index().is_exported(self.id)
    }
}

/// One of the places where a [`Symbol`] is declared.
#[derive(Copy, Clone, Debug)]
pub enum Declaration<'a> {
    /// An identifier bound by `var`, `let`, `const`, `using`, `catch`, or a loop.
    Var(Pat<'a>),
    /// An identifier bound by a parameter.
    Param(Pat<'a>),
    Fn(Func<'a>),
    Class(Class<'a>),
    Interface(Interface<'a>),
    TypeAlias(Alias<'a>),
    Enum(Enum<'a>),
    EnumMember(EnumMember<'a>),
    Module(Module<'a>),
    TypeParam(TypeParam<'a>),
    ImportDefault(Import<'a>),
    ImportNamespace(Import<'a>),
    ImportSpec(ImportSpec<'a>),
    ImportEquals(ImportEquals<'a>),
    /// What only the type checker is concerned with: a member, a property, an assignment that
    /// declares something in JavaScript.
    Other,
}

impl<'a> Declaration<'a> {
    fn new(file: &'a File<'a>, decl: Decl) -> Self {
        match decl {
            Decl::Var(pat) | Decl::Require(pat) => Declaration::Var(Pat::new(file, pat)),
            Decl::Param(pat) => Declaration::Param(Pat::new(file, pat)),
            Decl::Fn(f) => Declaration::Fn(Func::new(file, f)),
            Decl::Class(c) => Declaration::Class(Class::new(file, c)),
            Decl::Interface(i) => Declaration::Interface(Interface::new(file, i)),
            Decl::Alias(a) => Declaration::TypeAlias(Alias::new(file, a)),
            Decl::Enum(e) => Declaration::Enum(Enum::new(file, e)),
            Decl::EnumMember(m) => Declaration::EnumMember(EnumMember::new(file, m)),
            Decl::Module(m) => Declaration::Module(Module::new(file, m)),
            Decl::TypeParam(p) => Declaration::TypeParam(TypeParam::new(file, p)),
            Decl::ImportDefault(i) => Declaration::ImportDefault(Import::new(file, i)),
            Decl::ImportNamespace(i) => Declaration::ImportNamespace(Import::new(file, i)),
            Decl::ImportSpec(s) => Declaration::ImportSpec(ImportSpec::new(file, s)),
            Decl::ImportEquals(i) => Declaration::ImportEquals(ImportEquals::new(file, i)),
            _ => Declaration::Other,
        }
    }

    /// Where the name is written: ESLint's `def.name`.
    pub fn name_span(self) -> Option<Span> {
        Some(match self {
            Declaration::Var(pat) | Declaration::Param(pat) => pat.span(),
            Declaration::Fn(func) => func.name()?.span(),
            Declaration::Class(class) => class.name()?.span(),
            Declaration::Interface(it) => it.name().span(),
            Declaration::TypeAlias(it) => it.name().span(),
            Declaration::Enum(it) => it.name().span(),
            Declaration::EnumMember(it) => it.key()?.span(it.file()),
            Declaration::Module(it) => match it.name() {
                crate::ast::ModuleName::Ident(name) | crate::ast::ModuleName::String(name) => name.span(),
                crate::ast::ModuleName::Global => return None,
            },
            Declaration::TypeParam(it) => it.name().span(),
            Declaration::ImportDefault(it) => it.default()?.span(),
            Declaration::ImportNamespace(it) => it.namespace()?.span(),
            Declaration::ImportSpec(it) => it.local().span(),
            Declaration::ImportEquals(it) => it.name().span(),
            Declaration::Other => return None,
        })
    }

    /// The node that declares it: ESLint's `def.node`. For a `Var` the `VarDecl`, for a `Param`
    /// the `Func`.
    pub fn node(self) -> Option<Node<'a>> {
        Some(match self {
            Declaration::Var(pat) => {
                Node::Pat(pat).ancestors().find(|it| matches!(it, Node::VarDecl(_)))?
            }
            Declaration::Param(pat) => Node::Func(Node::Pat(pat).enclosing_function()?),
            Declaration::Fn(func) => Node::Func(func),
            Declaration::Class(class) => Node::Class(class),
            Declaration::Interface(it) => Node::Stmt(it.stmt()),
            Declaration::TypeAlias(it) => Node::Stmt(it.stmt()),
            Declaration::Enum(it) => Node::Stmt(it.stmt()),
            Declaration::EnumMember(it) => Node::EnumMember(it),
            Declaration::Module(it) => Node::Stmt(it.stmt()),
            Declaration::TypeParam(it) => Node::TypeParam(it),
            Declaration::ImportDefault(it) | Declaration::ImportNamespace(it) => Node::Stmt(it.stmt()),
            Declaration::ImportSpec(it) => Node::ImportSpec(it),
            Declaration::ImportEquals(it) => Node::Stmt(it.stmt()),
            Declaration::Other => return None,
        })
    }
}

// ───────────────────────────── references ─────────────────────────────

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct ReferenceFlags: u8 {
        const READ = 1 << 0;
        const WRITE = 1 << 1;
        /// It is in a type: `let x: T`, `typeof x` in a type, `implements T`.
        const TYPE = 1 << 2;
        /// The write is the initializer of the declaration: ESLint's `reference.init`.
        const INIT = 1 << 3;
    }
}

/// Where a reference is written.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReferenceSite {
    /// An identifier that is an expression.
    Expr(hir::ExprId),
    /// The name of a declaration with an initializer.
    Pat(hir::PatId),
    /// The first name of an entity name in a type.
    Name(hir::NameId),
    /// The `a` of `export { a }`.
    ExportSpec(hir::ExportSpecId),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct RawReference {
    pub(crate) site: ReferenceSite,
    pub(crate) symbol: SymbolId,
    pub(crate) flags: ReferenceFlags,
}

/// An occurrence of a name that refers to something.
#[derive(Copy, Clone)]
pub struct Reference<'a> {
    file: &'a File<'a>,
    raw: RawReference,
}

impl std::fmt::Debug for Reference<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Reference({:?}, {:?})", self.raw.site, self.raw.flags)
    }
}

impl<'a> Reference<'a> {
    /// What it refers to. `None`: nothing in the file declares it, so it is a global or an error.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::some(self.file, self.raw.symbol)
    }

    #[inline]
    pub fn flags(self) -> ReferenceFlags {
        self.raw.flags
    }

    #[inline]
    pub fn is_read(self) -> bool {
        self.raw.flags.contains(ReferenceFlags::READ)
    }

    #[inline]
    pub fn is_write(self) -> bool {
        self.raw.flags.contains(ReferenceFlags::WRITE)
    }

    #[inline]
    pub fn is_read_only(self) -> bool {
        self.is_read() && !self.is_write()
    }

    #[inline]
    pub fn is_write_only(self) -> bool {
        self.is_write() && !self.is_read()
    }

    /// `a += 1`, `a++`
    #[inline]
    pub fn is_read_write(self) -> bool {
        self.is_read() && self.is_write()
    }

    /// ESLint's `isTypeReference`.
    #[inline]
    pub fn is_type(self) -> bool {
        self.raw.flags.contains(ReferenceFlags::TYPE)
    }

    /// ESLint's `reference.init`.
    #[inline]
    pub fn is_init(self) -> bool {
        self.raw.flags.contains(ReferenceFlags::INIT)
    }

    /// The identifier, if it is an expression.
    pub fn expr(self) -> Option<Expr<'a>> {
        match self.raw.site {
            ReferenceSite::Expr(e) => Some(Expr::new(self.file, e)),
            _ => None,
        }
    }

    /// The node that the name is, or is the first part of.
    pub fn node(self) -> Node<'a> {
        self.file.reference_index().node_of(self.file, self.raw.site)
    }

    /// The name where it is written: ESLint's `reference.identifier`.
    pub fn ident(self) -> Ident<'a> {
        let file = self.file;
        match self.raw.site {
            ReferenceSite::Expr(e) => {
                let e = Expr::new(file, e);
                file.ident(e.as_ident().map_or(Atom::NONE, Name::atom), e.span().start)
            }
            ReferenceSite::Pat(p) => {
                let p = Pat::new(file, p);
                file.ident(p.as_ident().map_or(Atom::NONE, Name::atom), p.span().start)
            }
            ReferenceSite::Name(n) => match file.hir.names.get(n.idx()) {
                Some(name) => file.ident(name.text, name.pos()),
                None => file.ident(Atom::NONE, 0),
            },
            ReferenceSite::ExportSpec(s) => crate::ast::ExportSpec::new(file, s).local(),
        }
    }

    #[inline]
    pub fn name(self) -> Name<'a> {
        self.ident().name()
    }

    #[inline]
    pub fn span(self) -> Span {
        self.ident().span()
    }

    /// ESLint's `reference.writeExpr`: what is assigned, if that is an expression.
    pub fn write_expr(self) -> Option<Expr<'a>> {
        self.file.reference_index().write_expr(self.file, self.raw)
    }

    /// ESLint's `reference.from`: the scope it is in.
    pub fn scope(self) -> Scope<'a> {
        self.node().scope()
    }
}

impl Spanned for Reference<'_> {
    #[inline]
    fn span(&self) -> Span {
        Reference::span(*self)
    }
}

// ───────────────────────────── scopes ─────────────────────────────

/// ESLint's `scope.type`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ScopeKind {
    /// The top level of a script.
    Global,
    /// The top level of a module.
    Module,
    Function,
    /// A block, the head of a `for`, a `switch`, a `catch` clause.
    Block,
    Class,
    /// `namespace N { }`
    TsModule,
    TsEnum,
    /// The type parameters of an interface, a type alias, a function type, a mapped type or a
    /// conditional type.
    Type,
}

/// A region of the file in which names are declared.
#[derive(Copy, Clone)]
pub struct Scope<'a> {
    file: &'a File<'a>,
    id: ScopeId,
}

impl PartialEq for Scope<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Scope<'_> {}
impl std::fmt::Debug for Scope<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Scope({}, {:?})", self.id.0, self.kind())
    }
}

impl<'a> Scope<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: ScopeId) -> Self {
        Scope { file, id }
    }

    #[inline]
    pub fn id(self) -> ScopeId {
        self.id
    }

    pub fn kind(self) -> ScopeKind {
        index::kind_of_scope(self.file, self.id)
    }

    /// The scope around it. `None` for the scope of the file.
    pub fn parent(self) -> Option<Scope<'a>> {
        index::parent_of_scope(self.file, self.id).map(|id| Scope::new(self.file, id))
    }

    /// The scopes directly inside it.
    pub fn children(self) -> impl Iterator<Item = Scope<'a>> + 'a {
        let file = self.file;
        let children = file.reference_index().children_of_scope(self.id).iter();
        children.map(move |&id| Scope::new(file, id))
    }

    /// Itself, its parent, and so on.
    pub fn chain(self) -> impl Iterator<Item = Scope<'a>> + 'a {
        std::iter::successors(Some(self), |scope| scope.parent())
    }

    /// The node that creates it: ESLint's `scope.block`.
    pub fn node(self) -> Node<'a> {
        self.file.reference_index().node_of_scope(self.file, self.id)
    }

    /// What is declared in it, in the order it is declared.
    pub fn symbols(self) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let file = self.file;
        let symbols = file.reference_index().symbols_of_scope(self.id).iter();
        symbols.filter_map(move |&id| Symbol::some(file, id))
    }

    /// What is declared in it under `name`.
    pub fn get(self, name: &str) -> Option<Symbol<'a>> {
        self.symbols().find(|symbol| symbol.name().is(name))
    }

    /// What `name` means here: declared in this scope or in one around it.
    pub fn resolve(self, name: &str) -> Option<Symbol<'a>> {
        self.chain().find_map(|scope| scope.get(name))
    }

    /// The nearest function, module or global scope: where a `var` here ends up. ESLint's
    /// `scope.variableScope`.
    pub fn variable_scope(self) -> Scope<'a> {
        self.chain()
            .find(|scope| {
                matches!(
                    scope.kind(),
                    ScopeKind::Function | ScopeKind::Module | ScopeKind::Global | ScopeKind::TsModule
                )
            })
            .unwrap_or(self)
    }

    /// Strict mode applies: a module, a class, or under a `"use strict"` directive.
    pub fn is_strict(self) -> bool {
        index::is_strict_scope(self.file, self.id)
    }

    /// The references that are written directly in it, not in a scope inside it: ESLint's
    /// `scope.references`.
    pub fn references(self) -> impl Iterator<Item = Reference<'a>> + 'a {
        let file = self.file;
        let references = file.reference_index().references_in_scope(self.id).iter();
        references.map(move |&raw| Reference { file, raw })
    }
}

// ───────────────────────────── from the syntax ─────────────────────────────

impl<'a> File<'a> {
    pub(crate) fn reference_index(&self) -> &ReferenceIndex {
        self.lazy.references.get_or_init(|| ReferenceIndex::new(self))
    }

    /// The scope of the whole file: ESLint's `scopeManager.globalScope`, or the module scope in
    /// it.
    pub fn scope(&'a self) -> Scope<'a> {
        Scope::new(self, ScopeId(0))
    }

    /// Everything that the file declares in a scope.
    pub fn symbols(&'a self) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let symbols = self.reference_index().all_symbols().iter();
        symbols.filter_map(move |&id| Symbol::some(self, id))
    }

    /// The references to what the file does not declare: globals, and mistakes.
    pub fn unresolved_references(&'a self) -> impl Iterator<Item = Reference<'a>> + 'a {
        let references = self.reference_index().unresolved().iter();
        references.map(move |&raw| Reference { file: self, raw })
    }
}

impl<'a> Expr<'a> {
    /// What an identifier refers to. `None` if nothing in the file declares it, or if the
    /// expression is not an identifier.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::some(self.file(), *self.file().bound.expr_symbol.get(self.id().idx())?)
    }

    /// The identifier as a reference: whether it is read or written.
    pub fn reference(self) -> Option<Reference<'a>> {
        let file = self.file();
        let raw = file.reference_index().at_expr(file, self.id())?;
        Some(Reference { file, raw })
    }
}

impl<'a> Pat<'a> {
    /// What an identifier pattern declares.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::some(self.file(), *self.file().bound.pat_symbol.get(self.id().idx())?)
    }
}

impl<'a> Func<'a> {
    /// What a function declaration or a named function expression declares.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::some(self.file(), *self.file().bound.fn_symbol.get(self.id().idx())?)
    }

    /// The scope of its parameters and its body.
    pub fn scope(self) -> Option<Scope<'a>> {
        let scope = self.file().bound.fns.get(self.id().idx())?.scope;
        scope.is_some().then(|| Scope::new(self.file(), scope))
    }
}

impl<'a> Class<'a> {
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::some(self.file(), *self.file().bound.class_symbol.get(self.id().idx())?)
    }
}

impl<'a> Node<'a> {
    /// The innermost scope that contains it. For a node that creates a scope, that scope.
    pub fn scope(self) -> Scope<'a> {
        self.file().reference_index().scope_of_node(self)
    }

    /// ESLint's `getDeclaredVariables`.
    pub fn declared_symbols(self) -> Vec<Symbol<'a>> {
        index::declared_symbols(self)
    }
}
