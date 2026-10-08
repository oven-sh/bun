//! Scopes, what is declared in them, and what refers to it.
//!
//! The symbols, their declarations and what each identifier resolves to are what the binder of the
//! type checker has computed for the file (`bun_sema::bind`). Nothing is analyzed a second time.
//! What is added, in three parts that are each computed the first time a rule needs them:
//! the scopes as ESLint cuts them ([`scopes`]), the symbols by scope ([`variables`]), and the
//! references, with the names in types resolved ([`references`]).
//!
//! The model is that of `eslint-scope` for JavaScript files and that of
//! `@typescript-eslint/scope-manager` for TypeScript files, which differ in little.
//!
//! | ESLint | here |
//! | --- | --- |
//! | `Variable` | [`Symbol`] |
//! | `variable.defs`, `variable.identifiers` | [`Symbol::declarations`] |
//! | `def.type`, `def.name`, `def.node`, `def.parent` | [`Declaration::kind`], [`Declaration::name_span`], [`Declaration::node`], [`Declaration::parent`] |
//! | `variable.references` | [`Symbol::references`] |
//! | `variable.scope` | [`Symbol::scope`] |
//! | `variable.isValueVariable`, `variable.isTypeVariable` | [`Symbol::is_value_variable`], [`Symbol::is_type_variable`] |
//! | `variable.eslintUsed`, `variable.eslintExported` | [`Symbol::is_marked_used`], [`Symbol::is_marked_exported`] |
//! | `sourceCode.markVariableAsUsed(name, node)` | [`Node::mark_variable_as_used`] |
//! | `Reference` | [`Reference`] |
//! | `reference.identifier` | [`Reference::ident`], [`Reference::expr`], [`Reference::node`] |
//! | `reference.resolved` | [`Reference::symbol`], [`Expr::symbol`] |
//! | `reference.from` | [`Reference::scope`] |
//! | `reference.isRead()`, `isWrite()`, .. | [`Reference::is_read`], [`Reference::is_write`], .. |
//! | `reference.isValueReference`, `isTypeReference` | [`Reference::is_value`], [`Reference::is_type`] |
//! | `reference.init`, `reference.writeExpr` | [`Reference::is_init`], [`Reference::write_expr`] |
//! | `sourceCode.getScope(node)` | [`Node::scope`] |
//! | `sourceCode.getDeclaredVariables(node)` | [`Node::declared_symbols`] |
//! | `scopeManager.globalScope`, `sourceCode.getScope(program)` | [`File::scope`] |
//! | `globalScope.childScopes[0]` of a module or of CommonJS | [`File::top_level_scope`] |
//! | `globalScope.through` | [`File::unresolved_references`] |
//! | `globalScope.set.get(name).references` of a global | [`File::unresolved_references_to`] |
//! | `globalScope.implicit.variables` | [`File::implicit_globals`] |
//! | `scope.type`, `scope.block`, `scope.isStrict` | [`Scope::kind`], [`Scope::node`], [`Scope::is_strict`] |
//! | `scope.variables`, `scope.set.get(name)` | [`Scope::symbols`], [`Scope::get`] |
//! | `scope.references`, `scope.through` | [`Scope::references`], [`Scope::through`] |
//! | `scope.upper`, `scope.childScopes`, `scope.variableScope` | [`Scope::parent`], [`Scope::children`], [`Scope::variable_scope`] |
//! | `findVariable(scope, name)`, `getVariableByName` | [`Scope::resolve`] |
//!
//! Where the model differs from ESLint's:
//! - **Globals that the file does not declare are not symbols**: what the configuration, the
//!   ECMAScript version, a `/* global */` comment or a TypeScript `lib` defines. A reference to one
//!   resolves to nothing and is among [`File::unresolved_references`]. In ESLint it resolves to a
//!   variable of the global scope without definitions.
//! - **A class declaration is one symbol**, in the scope around the class. ESLint has a second
//!   variable for the name in the scope of the class, which the references inside the class
//!   resolve to. The name of a class *expression* is a symbol of the scope of the class, as in
//!   ESLint.
//! - `x as const` has no reference to a type `const`.
//! - The tag `<this />` is not a reference.
//! - Where TypeScript merges declarations that are in different scopes, there is a [`Symbol`] in
//!   each scope, as in ESLint, and they have the same [`Symbol::id`]: the type parameters of
//!   `interface I<T> {} interface I<T> {}`, what the bodies of `namespace N {} namespace N {}`
//!   export under one name.

use crate::ast::{
    Alias, Class, Enum, EnumMember, Expr, ExprKind, File, Func, Ident, Import, ImportEquals, ImportSpec, Interface,
    Module, Name, Node, Pat, Stmt, StmtKind, TypeKind, TypeNode, TypeParam,
};
use crate::span::{Span, Spanned};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{self, Decl, ScopeId, SymbolId};
use bun_sema::hir;
use std::cell::{OnceCell, RefCell};

pub use bun_sema::bind::SymFlags;

mod references;
mod scopes;
mod variables;

use references::{RawReference, ReferenceSite, References};
use scopes::{Block, ScopeTree};
use variables::Variables;

/// The parts of a `bind::Bound` that are not plain slices, for those who cannot name the lifetime
/// of its session, in which it is invariant.
pub(crate) trait Binding {
    fn symbol_count(&self) -> usize;
    fn symbol(&self, id: SymbolId) -> Option<RawSymbol>;
    fn declarations(&self, id: SymbolId) -> &[Decl];
    /// The symbol that stands for `id` here: of the two symbols of an exported declaration, the
    /// one that is exported. `None` if there is no `id`.
    fn canonical(&self, id: SymbolId) -> Option<SymbolId>;
    /// Every declaration of something that a name can refer to, with its canonical symbol.
    fn declarations_in_scopes(&self, into: &mut Vec<(SymbolId, Decl)>);
    /// Some declaration conflicts with an earlier one of the same name, and has a symbol of its
    /// own.
    fn has_refused_declarations(&self) -> bool;
    fn refused_declarations(&self, into: &mut Vec<Decl>);
}

/// A `bind::Symbol` without its declarations.
#[derive(Copy, Clone)]
pub(crate) struct RawSymbol {
    pub(crate) name: Atom,
    pub(crate) flags: SymFlags,
}

impl Binding for bind::Bound<'_> {
    fn symbol_count(&self) -> usize {
        self.symbols.len()
    }
    fn symbol(&self, id: SymbolId) -> Option<RawSymbol> {
        self.symbols.get(id.idx()).map(|symbol| RawSymbol {
            name: symbol.name,
            flags: symbol.flags,
        })
    }
    fn declarations(&self, id: SymbolId) -> &[Decl] {
        self.symbols.get(id.idx()).map_or(&[], |symbol| symbol.decls.as_slice())
    }
    fn canonical(&self, id: SymbolId) -> Option<SymbolId> {
        let exported = self.symbols.get(id.idx())?.export_symbol;
        Some(if exported.is_some() { exported } else { id })
    }
    fn declarations_in_scopes(&self, into: &mut Vec<(SymbolId, Decl)>) {
        for (i, symbol) in self.symbols.iter().enumerate() {
            let id = match symbol.export_symbol.is_some() {
                true => symbol.export_symbol,
                false => SymbolId(i as u32),
            };
            for &decl in symbol.decls.as_slice() {
                if matches!(
                    decl,
                    Decl::Var(_)
                        | Decl::Param(_)
                        | Decl::Require(_)
                        | Decl::Fn(_)
                        | Decl::Class(_)
                        | Decl::Interface(_)
                        | Decl::Alias(_)
                        | Decl::Enum(_)
                        | Decl::EnumMember(_)
                        | Decl::Module(_)
                        | Decl::TypeParam(_)
                        | Decl::ImportDefault(_)
                        | Decl::ImportNamespace(_)
                        | Decl::ImportSpec(_)
                        | Decl::ImportEquals(_)
                ) {
                    into.push((id, decl));
                }
            }
        }
    }
    fn has_refused_declarations(&self) -> bool {
        !self.redeclarations.is_empty()
    }
    fn refused_declarations(&self, into: &mut Vec<Decl>) {
        into.extend(self.redeclarations.iter().map(|it| it.decl));
    }
}

/// What is derived from the binder's tables. Each part is computed the first time it is needed.
#[derive(Default)]
pub(crate) struct ReferenceIndex {
    scopes: OnceCell<ScopeTree>,
    variables: OnceCell<Variables>,
    references: OnceCell<References>,
    /// `MARKED_USED`, `MARKED_EXPORTED`, by index in `Variables::list`. Empty until something is
    /// marked.
    marks: RefCell<Vec<u8>>,
}

const MARKED_USED: u8 = 1 << 0;
const MARKED_EXPORTED: u8 = 1 << 1;

impl<'a> File<'a> {
    #[inline]
    fn semantic(&self) -> &ReferenceIndex {
        self.lazy.references.get_or_init(ReferenceIndex::default)
    }

    fn scope_tree(&'a self) -> &'a ScopeTree {
        self.semantic().scopes.get_or_init(|| ScopeTree::new(self))
    }

    fn variables(&'a self) -> &'a Variables {
        self.semantic().variables.get_or_init(|| Variables::new(self, self.scope_tree()))
    }

    fn reference_list(&'a self) -> &'a References {
        let compute = || References::new(self, self.scope_tree(), self.variables());
        self.semantic().references.get_or_init(compute)
    }
}

// ───────────────────────────── symbols ─────────────────────────────

/// Something that the file declares in a scope: a variable, a function, a class, a parameter, an
/// import, a type, a namespace, an enum. Also the `arguments` of a function, which nothing
/// declares.
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
    /// The symbol that the binder's `id` is, or is one declaration of.
    #[inline]
    pub(crate) fn some(file: &'a File<'a>, id: SymbolId) -> Option<Self> {
        let id = file.binding.canonical(id)?;
        if file.binding.has_refused_declarations()
            && let Some(index) = file.variables().of_symbol(file.scope_tree(), id)
        {
            return Some(Symbol::at(file, index));
        }
        Some(Symbol { file, id })
    }

    /// What the declaration of the binder's `id` whose name is at `pos` declares.
    fn declared(file: &'a File<'a>, id: SymbolId, pos: u32) -> Option<Self> {
        let symbol = Symbol::some(file, id)?;
        // Declarations in different scopes can have one symbol in the binder.
        if file.binding.declarations(symbol.id).len() > 1
            && let Some(index) = file.variables().of_declaration(file, file.scope_tree(), symbol.id, pos)
        {
            return Some(Symbol::at(file, index));
        }
        Some(symbol)
    }

    /// The variable at `index` of `Variables::list`.
    #[inline]
    fn at(file: &'a File<'a>, index: u32) -> Self {
        let id = file.variables().list.get(index as usize).map_or(SymbolId::NONE, |it| it.symbol);
        Symbol { file, id }
    }

    /// Its index in `Variables::list`. `None`: no name can refer to it.
    #[inline]
    fn index(self) -> Option<u32> {
        self.file.variables().of_symbol(self.file.scope_tree(), self.id)
    }

    #[inline]
    fn variable(self) -> Option<&'a variables::Variable> {
        self.file.variables().list.get(self.index()? as usize)
    }

    /// The symbol of the binder, which with the file is what the type checker takes. `NONE` for
    /// an [implicit `arguments`](Symbol::is_implicit_arguments). Different symbols can have the
    /// same: see the [differences from ESLint's model](self).
    #[inline]
    pub fn id(self) -> SymbolId {
        match self.id.idx() < self.file.binding.symbol_count() {
            true => self.id,
            false => self.variable().map_or(SymbolId::NONE, |it| it.binder),
        }
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    fn raw(self) -> RawSymbol {
        self.file.binding.symbol(self.id()).unwrap_or(RawSymbol {
            name: known::arguments,
            flags: SymFlags::FUNCTION_SCOPED_VARIABLE,
        })
    }

    pub fn name(self) -> Name<'a> {
        let name = self.raw().name;
        // What is exported as the default has that name in the binder.
        match name == known::default {
            true => self.file.name(self.variable().map_or(name, |it| it.name)),
            false => self.file.name(name),
        }
    }

    /// What kinds of things it is.
    #[inline]
    pub fn flags(self) -> SymFlags {
        self.raw().flags
    }

    /// It can be used as a value: a variable, a function, a class, an enum, a namespace with
    /// values in it. Not an import: see [`Symbol::is_value_variable`].
    #[inline]
    pub fn is_value(self) -> bool {
        self.flags().intersects(SymFlags::VALUE)
    }

    /// It can be used as a type. Not an import: see [`Symbol::is_type_variable`].
    #[inline]
    pub fn is_type(self) -> bool {
        self.flags().intersects(SymFlags::TYPE)
    }

    /// An import, which can be either.
    #[inline]
    pub fn is_import(self) -> bool {
        self.flags().contains(SymFlags::ALIAS)
    }

    /// typescript-eslint's `variable.isValueVariable`: everything but an interface, a type alias
    /// and a type parameter. Also an `import type` and a namespace that only has types in it.
    pub fn is_value_variable(self) -> bool {
        self.variable().is_some_and(|it| it.flags & variables::VALUE != 0)
    }

    /// typescript-eslint's `variable.isTypeVariable`: an interface, a type alias, a type
    /// parameter, a class, an enum and its members, a namespace, an import.
    pub fn is_type_variable(self) -> bool {
        self.variable().is_some_and(|it| it.flags & variables::TYPE != 0)
    }

    /// The `arguments` of a function that is not an arrow function, unless the function declares
    /// something of that name. It has no declarations. ESLint has it as the first variable of the
    /// scope of the function.
    #[inline]
    pub fn is_implicit_arguments(self) -> bool {
        self.id.idx() >= self.file.binding.symbol_count() && self.id().is_none()
    }

    /// In the order they are written. What ESLint takes for one variable is one symbol:
    /// `function f() {} var f;` has two declarations.
    pub fn declarations(self) -> impl DoubleEndedIterator<Item = Declaration<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        // The binder lists functions first, leaves out a declaration that it refuses, and has two
        // symbols for what is exported.
        let all = match self.variable() {
            Some(it) => file.variables().declarations_of(it),
            None => file.binding.declarations(self.id),
        };
        all.iter().map(move |&decl| Declaration::new(file, decl))
    }

    /// Everything in the file that refers to it, in source order. A declaration is not a
    /// reference, but one that gives its name a value makes a write reference of the name, as in
    /// ESLint: `let a = 1`, `function f(a = 1) {}`, `for (const a of b)`.
    pub fn references(self) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let references = self.index().map_or(&[][..], |it| file.reference_list().of_variable(it));
        references.iter().map(move |&index| Reference { file, index })
    }

    /// The scope it is declared in.
    pub fn scope(self) -> Scope<'a> {
        Scope::new(self.file, ScopeId(self.variable().map_or(0, |it| it.scope)))
    }

    /// It is exported from the file or from a namespace: by a modifier, by `export { it }`, by
    /// `export default it` or by `export = it`.
    pub fn is_exported(self) -> bool {
        self.declarations().any(Declaration::has_export_modifier)
            || self.references().any(|reference| match reference.raw().site {
                ReferenceSite::ExportSpec(_) => true,
                ReferenceSite::Expr(e) => matches!(
                    Expr::new(self.file, e).parent(),
                    Node::Stmt(s) if matches!(s.kind(), StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_))
                ),
                _ => false,
            })
    }

    fn mark(self, mark: u8) {
        let Some(index) = self.index() else {
            return;
        };
        let mut marks = self.file.semantic().marks.borrow_mut();
        if marks.is_empty() {
            marks.resize(self.file.variables().list.len(), 0);
        }
        if let Some(slot) = marks.get_mut(index as usize) {
            *slot |= mark;
        }
    }

    fn has_mark(self, mark: u8) -> bool {
        let marks = self.file.semantic().marks.borrow();
        !marks.is_empty() && self.index().and_then(|it| marks.get(it as usize).copied()).is_some_and(|it| it & mark != 0)
    }

    /// Sets ESLint's `variable.eslintUsed`, which `no-unused-vars` reads.
    #[inline]
    pub fn mark_used(self) {
        self.mark(MARKED_USED);
    }

    /// ESLint's `variable.eslintUsed`.
    #[inline]
    pub fn is_marked_used(self) -> bool {
        self.has_mark(MARKED_USED)
    }

    /// Sets ESLint's `variable.eslintExported` and `variable.eslintUsed`, as an `/* exported */`
    /// comment does.
    #[inline]
    pub fn mark_exported(self) {
        self.mark(MARKED_USED | MARKED_EXPORTED);
    }

    /// ESLint's `variable.eslintExported`.
    #[inline]
    pub fn is_marked_exported(self) -> bool {
        self.has_mark(MARKED_EXPORTED)
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

/// ESLint's `def.type`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum DeclarationKind {
    Variable,
    Parameter,
    FunctionName,
    ClassName,
    CatchClause,
    ImportBinding,
    TsEnumName,
    TsEnumMember,
    TsModuleName,
    /// An interface, a type alias, a type parameter.
    Type,
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

    /// ESLint's `def.type`. `None` for [`Declaration::Other`].
    pub fn kind(self) -> Option<DeclarationKind> {
        Some(match self {
            Declaration::Var(_) if self.is_catch_parameter() => DeclarationKind::CatchClause,
            Declaration::Var(_) => DeclarationKind::Variable,
            Declaration::Param(_) => DeclarationKind::Parameter,
            Declaration::Fn(_) => DeclarationKind::FunctionName,
            Declaration::Class(_) => DeclarationKind::ClassName,
            Declaration::Interface(_) | Declaration::TypeAlias(_) | Declaration::TypeParam(_) => DeclarationKind::Type,
            Declaration::Enum(_) => DeclarationKind::TsEnumName,
            Declaration::EnumMember(_) => DeclarationKind::TsEnumMember,
            Declaration::Module(_) => DeclarationKind::TsModuleName,
            Declaration::ImportDefault(_)
            | Declaration::ImportNamespace(_)
            | Declaration::ImportSpec(_)
            | Declaration::ImportEquals(_) => DeclarationKind::ImportBinding,
            Declaration::Other => return None,
        })
    }

    /// It is, or is part of, the `e` of `catch (e)`.
    pub fn is_catch_parameter(self) -> bool {
        match self {
            Declaration::Var(pat) => match variables::root_of_pattern(pat.file(), pat.id()) {
                bind::PatParent::Var(d) => variables::is_catch_parameter(pat.file(), d),
                _ => false,
            },
            _ => false,
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

    /// The node that declares it: ESLint's `def.node`. For a `Var` the `VarDecl`, also for the
    /// parameter of a `catch`, where ESLint has the `CatchClause`. For a `Param` the `Func`.
    pub fn node(self) -> Option<Node<'a>> {
        Some(match self {
            Declaration::Var(pat) => Node::Pat(pat).ancestors().find(|it| matches!(it, Node::VarDecl(_)))?,
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

    /// ESLint's `def.parent`: the `Stmt` of the `var`, `let`, `const` or `using`, or of the
    /// import. `None` for everything else.
    pub fn parent(self) -> Option<Node<'a>> {
        match self {
            Declaration::Var(_) if !self.is_catch_parameter() => Some(self.node()?.parent()),
            Declaration::ImportDefault(it) | Declaration::ImportNamespace(it) => Some(Node::Stmt(it.stmt())),
            Declaration::ImportSpec(it) => Some(Node::Stmt(it.import().stmt())),
            Declaration::ImportEquals(it) => Some(Node::Stmt(it.stmt())),
            _ => None,
        }
    }

    /// It starts with `export`.
    fn has_export_modifier(self) -> bool {
        use crate::ast::Flags;
        match self {
            Declaration::Var(_) => matches!(self.parent(), Some(Node::Stmt(s)) if s.is_exported()),
            Declaration::Fn(it) => it.flags().contains(Flags::EXPORT),
            Declaration::Class(it) => it.flags().contains(Flags::EXPORT),
            Declaration::Interface(it) => it.flags().contains(Flags::EXPORT),
            Declaration::TypeAlias(it) => it.flags().contains(Flags::EXPORT),
            Declaration::Enum(it) => it.flags().contains(Flags::EXPORT),
            Declaration::Module(it) => it.flags().contains(Flags::EXPORT),
            Declaration::ImportEquals(it) => it.flags().contains(Flags::EXPORT),
            _ => false,
        }
    }
}

// ───────────────────────────── references ─────────────────────────────

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct ReferenceFlags: u8 {
        const READ = 1 << 0;
        const WRITE = 1 << 1;
        /// typescript-eslint's `isTypeReference`: it can refer to a type. `let x: T`,
        /// `implements T`, `export { T }`. Not `typeof x` in a type and not the `x` of `x is T`,
        /// which refer to values.
        const TYPE = 1 << 2;
        /// The write is the initializer or a default of the declaration: ESLint's
        /// `reference.init`.
        const INIT = 1 << 3;
        /// typescript-eslint's `isValueReference`: it can refer to a value. `export { a }` and
        /// `export default a` can refer to either.
        const VALUE = 1 << 4;
    }
}

/// An occurrence of a name that refers to something.
///
/// A name that is given several values at once is as many references, as in ESLint:
/// `[a = 1] = b` writes `1` and then `b`.
#[derive(Copy, Clone)]
pub struct Reference<'a> {
    file: &'a File<'a>,
    /// In `References::all`.
    index: u32,
}

impl PartialEq for Reference<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index
    }
}
impl Eq for Reference<'_> {}
impl std::hash::Hash for Reference<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.index.hash(state);
    }
}
impl std::fmt::Debug for Reference<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Reference({:?}, {:?})", self.raw().site, self.raw().flags)
    }
}

impl<'a> Reference<'a> {
    #[inline]
    fn raw(self) -> &'a RawReference {
        &self.file.reference_list().all[self.index as usize]
    }

    /// What it refers to. `None`: nothing in the file declares it, so it is a global or an error.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let variable = self.raw().variable;
        (variable != scopes::NONE).then(|| Symbol::at(self.file, variable))
    }

    #[inline]
    pub fn flags(self) -> ReferenceFlags {
        self.raw().flags
    }

    #[inline]
    pub fn is_read(self) -> bool {
        self.flags().contains(ReferenceFlags::READ)
    }

    #[inline]
    pub fn is_write(self) -> bool {
        self.flags().contains(ReferenceFlags::WRITE)
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

    /// typescript-eslint's `isTypeReference`. See [`ReferenceFlags::TYPE`].
    #[inline]
    pub fn is_type(self) -> bool {
        self.flags().contains(ReferenceFlags::TYPE)
    }

    /// typescript-eslint's `isValueReference`. See [`ReferenceFlags::VALUE`].
    #[inline]
    pub fn is_value(self) -> bool {
        self.flags().contains(ReferenceFlags::VALUE)
    }

    /// ESLint's `reference.init`.
    #[inline]
    pub fn is_init(self) -> bool {
        self.flags().contains(ReferenceFlags::INIT)
    }

    /// The identifier, if it is an expression.
    pub fn expr(self) -> Option<Expr<'a>> {
        match self.raw().site {
            ReferenceSite::Expr(e) => Some(Expr::new(self.file, e)),
            _ => None,
        }
    }

    /// The node that the name is, or is the first part of:
    /// - an `Expr` that is an identifier
    /// - the `Pat` that is the name of a declaration with a value
    /// - the `Type` that is a `TypeKind::Ref` or a `TypeKind::Predicate`
    /// - the `Stmt` of `import x = a.b` or of `export as namespace a`
    /// - the `ExportSpec` of `export { a }`
    /// - the `Expr` that is the tag `<A-b>` or `<a:b>`, an `ExprKind::String`. The latter is two
    ///   references in TypeScript, to `a` and to `b`.
    pub fn node(self) -> Node<'a> {
        let file = self.file;
        match self.raw().site {
            ReferenceSite::Expr(e) => Node::Expr(Expr::new(file, e)),
            ReferenceSite::Pat(p) => Node::Pat(Pat::new(file, p)),
            ReferenceSite::TypeName(t) | ReferenceSite::Predicate(t) => Node::Type(TypeNode::new(file, t)),
            ReferenceSite::ImportEquals(i) => Node::Stmt(ImportEquals::new(file, i).stmt()),
            ReferenceSite::ExportAsNamespace(s) => Node::Stmt(Stmt::new(file, s)),
            ReferenceSite::JsxName(e) => Node::Expr(Expr::new(file, e)),
            ReferenceSite::ExportSpec(s) => Node::ExportSpec(crate::ast::ExportSpec::new(file, s)),
            ReferenceSite::Declaration(index) => {
                let first = Symbol::at(file, index).declarations().next();
                first.and_then(Declaration::node).unwrap_or(Node::File(file))
            }
        }
    }

    /// It is the use that JSX makes of `React`, or of what `jsxPragma` and `jsxFragmentName` say.
    /// typescript-eslint makes a reference of the name of the declaration itself.
    #[inline]
    pub fn is_jsx_pragma(self) -> bool {
        matches!(self.raw().site, ReferenceSite::Declaration(_))
    }

    /// The name where it is written: ESLint's `reference.identifier`.
    #[inline]
    pub fn ident(self) -> Ident<'a> {
        self.file.ident(self.raw().name, self.raw().pos)
    }

    #[inline]
    pub fn name(self) -> Name<'a> {
        self.file.name(self.raw().name)
    }

    #[inline]
    pub fn span(self) -> Span {
        self.ident().span()
    }

    /// ESLint's `reference.writeExpr`: what is assigned. The right side of the assignment, also
    /// for a part of a destructuring pattern. The initializer or the default of a declaration.
    /// What a `for`-`in` or a `for`-`of` iterates over. `None` for `a++`.
    #[inline]
    pub fn write_expr(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().write)
    }

    /// ESLint's `reference.from`: the scope it is in.
    #[inline]
    pub fn scope(self) -> Scope<'a> {
        Scope::new(self.file, ScopeId(self.raw().from))
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
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ScopeKind {
    /// The whole file. In a script, what is declared at the top level is declared here. In a
    /// module or in CommonJS it declares nothing.
    Global,
    /// The top level of a module. It is in the global scope.
    Module,
    /// The parameters and the body of a function. Also the top level of a CommonJS file.
    Function,
    /// Only the name of a named function expression. The scope of the function is in it.
    FunctionExpressionName,
    /// `{ }`, unless it is the body of a function.
    Block,
    /// From the `{` of a `switch`.
    Switch,
    /// A `catch` clause: it declares the parameter. The block is a scope in it.
    Catch,
    /// The body of a `with`.
    With,
    /// A `for`, `for`-`in` or `for`-`of` whose head declares something with `let`, `const` or
    /// `using`. Any other has no scope.
    For,
    Class,
    /// The initializer of a field of a class.
    ClassFieldInitializer,
    /// `static { }`
    ClassStaticBlock,
    /// `namespace N { }`, `declare module "m" { }`, `declare global { }`
    TsModule,
    TsEnum,
    /// An interface or a type alias that has type parameters. One without has no scope.
    Type,
    /// `A extends B ? C : D`, without `D`: it declares what `infer` declares.
    ConditionalType,
    /// A function type, a constructor type, a signature.
    FunctionType,
    /// `{ [K in T]: U }`
    MappedType,
}

/// A region of the file in which names are declared.
#[derive(Copy, Clone)]
pub struct Scope<'a> {
    file: &'a File<'a>,
    /// The index in `ScopeTree::scopes`.
    id: ScopeId,
}

impl PartialEq for Scope<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Scope<'_> {}
impl std::hash::Hash for Scope<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
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
    fn data(self) -> &'a scopes::ScopeData {
        let scopes = &self.file.scope_tree().scopes;
        scopes.get(self.id.idx()).unwrap_or(&scopes[0])
    }

    /// Its number among the scopes of the file, in the order they start. It is not the binder's.
    #[inline]
    pub fn id(self) -> ScopeId {
        self.id
    }

    #[inline]
    pub fn kind(self) -> ScopeKind {
        self.data().kind
    }

    /// The scope around it. `None` for the global scope.
    pub fn parent(self) -> Option<Scope<'a>> {
        let parent = self.data().parent;
        (parent != scopes::NONE).then(|| Scope::new(self.file, ScopeId(parent)))
    }

    /// The scopes directly inside it, in source order.
    pub fn children(self) -> impl Iterator<Item = Scope<'a>> + 'a {
        let (file, id) = (self.file, self.id.0);
        let scopes = &file.scope_tree().scopes;
        let (mut next, last) = (id + 1, self.data().last);
        std::iter::from_fn(move || {
            while next <= last {
                let child = next;
                let data = scopes.get(child as usize)?;
                next = data.last + 1;
                if data.parent == id {
                    return Some(Scope::new(file, ScopeId(child)));
                }
            }
            None
        })
    }

    /// Itself, its parent, and so on.
    pub fn chain(self) -> impl Iterator<Item = Scope<'a>> + 'a {
        std::iter::successors(Some(self), |scope| scope.parent())
    }

    /// Whether `other` is this scope or inside it.
    #[inline]
    pub fn contains(self, other: Scope<'a>) -> bool {
        self.file.scope_tree().contains(self.id.0, other.id.0)
    }

    /// The node that creates it: ESLint's `scope.block`.
    /// - `Global`, `Module`, and `Function` at the top level of CommonJS: the `File`
    /// - `Function`, `FunctionExpressionName`, `FunctionType`, `ClassStaticBlock`: the `Func`
    /// - `Class`: the `Class`
    /// - `ClassFieldInitializer`: the `Expr` that is the initializer
    /// - `ConditionalType`, `MappedType`: the `Type`
    /// - everything else: the `Stmt`. For `Catch` that of the `try`, as a `catch` clause is not a
    ///   node.
    pub fn node(self) -> Node<'a> {
        let file = self.file;
        match self.data().block {
            Block::File => Node::File(file),
            Block::Stmt(s) => Node::Stmt(Stmt::new(file, s)),
            Block::Fn(f) => Node::Func(Func::new(file, f)),
            Block::Class(c) => Node::Class(Class::new(file, c)),
            Block::Expr(e) => Node::Expr(Expr::new(file, e)),
            Block::Type(t) => Node::Type(TypeNode::new(file, t)),
        }
    }

    /// The range of ESLint's `scope.block`.
    pub fn span(self) -> Span {
        let file = self.file;
        match (self.kind(), self.node()) {
            (ScopeKind::Catch, Node::Stmt(s)) => match s.kind() {
                StmtKind::Try {
                    block,
                    handler: Some(handler),
                    ..
                } => Span::new(crate::tokens::skip_trivia(file.text(), block.span().end), handler.span().end),
                _ => s.span(),
            },
            // The HIR positions the block after `finally` at the keyword.
            (ScopeKind::Block, Node::Stmt(s)) => match file.hir.stmts.get(s.id().idx()) {
                Some(raw) if file.text().get(raw.start as usize) != Some(&b'{') => {
                    Span::new(crate::tokens::skip_trivia(file.text(), raw.loc.pos), raw.loc.end)
                }
                _ => s.span(),
            },
            (ScopeKind::ClassStaticBlock, Node::Func(f)) => f.owner().span(),
            (_, Node::Func(f)) => match f.owner() {
                Node::Stmt(s) => s.span_without_export(),
                Node::Expr(e) if matches!(f.kind(), hir::FnKind::Expr | hir::FnKind::Arrow) => e.span(),
                Node::Type(t) => t.span(),
                Node::Member(m) if self.kind() == ScopeKind::FunctionType => m.span(),
                _ => f.span_from_params(),
            },
            (_, Node::Class(c)) => match c.owner() {
                Node::Stmt(s) => s.span_without_export(),
                owner => owner.span(),
            },
            (ScopeKind::TsModule | ScopeKind::TsEnum | ScopeKind::Type, Node::Stmt(s)) => s.span_without_export(),
            (_, node) => node.span(),
        }
    }

    /// What is declared in it, in the order it is declared. The first of a function that is not
    /// an arrow function is its [`arguments`](Symbol::is_implicit_arguments).
    pub fn symbols(self) -> impl DoubleEndedIterator<Item = Symbol<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let variables = file.variables();
        let here = variables.list.get(variables.range_of_scope(self.id.0)).unwrap_or_default();
        here.iter().map(move |it| Symbol { file, id: it.symbol })
    }

    fn get_atom(self, name: Atom) -> Option<Symbol<'a>> {
        self.file.variables().get(self.id.0, name).map(|index| Symbol::at(self.file, index))
    }

    fn resolve_atom(self, name: Atom) -> Option<Symbol<'a>> {
        let (tree, wants) = (self.file.scope_tree(), variables::VALUE | variables::TYPE);
        let found = self.file.variables().resolve(tree, self.id.0, name, u32::MAX, wants);
        found.map(|index| Symbol::at(self.file, index))
    }

    /// What is declared in it under `name`: ESLint's `scope.set.get(name)`.
    #[inline]
    pub fn get(self, name: &str) -> Option<Symbol<'a>> {
        self.get_bytes(name.as_bytes())
    }

    #[inline]
    pub fn get_bytes(self, name: &[u8]) -> Option<Symbol<'a>> {
        self.get_atom(self.file.atoms.intern(name))
    }

    #[inline]
    pub fn get_name(self, name: Name<'a>) -> Option<Symbol<'a>> {
        self.get_atom(name.atom())
    }

    /// What `name` means here: declared in this scope or in one around it, as a value or as a
    /// type. ESLint's `getVariableByName`, eslint-utils' `findVariable`.
    #[inline]
    pub fn resolve(self, name: &str) -> Option<Symbol<'a>> {
        self.resolve_bytes(name.as_bytes())
    }

    #[inline]
    pub fn resolve_bytes(self, name: &[u8]) -> Option<Symbol<'a>> {
        self.resolve_atom(self.file.atoms.intern(name))
    }

    #[inline]
    pub fn resolve_name(self, name: Name<'a>) -> Option<Symbol<'a>> {
        self.resolve_atom(name.atom())
    }

    /// Where a `var` here ends up: the nearest `Function`, `Module`, `Global`, `TsModule`,
    /// `ClassFieldInitializer` or `ClassStaticBlock`. ESLint's `scope.variableScope`.
    #[inline]
    pub fn variable_scope(self) -> Scope<'a> {
        Scope::new(self.file, ScopeId(self.data().variable_scope))
    }

    /// Strict mode applies: a module, a class, or under a `"use strict"` directive.
    #[inline]
    pub fn is_strict(self) -> bool {
        self.data().is_strict
    }

    /// The references that are written directly in it, not in a scope inside it, in source order:
    /// ESLint's `scope.references`.
    pub fn references(self) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let references = file.reference_list().in_scopes(self.id.0, self.id.0);
        references.iter().map(move |&index| Reference { file, index })
    }

    /// The references in it, and in the scopes inside it, to what is declared outside it or
    /// nowhere: ESLint's `scope.through`. Scope by scope, not in source order.
    pub fn through(self) -> impl Iterator<Item = Reference<'a>> + 'a {
        let (file, id) = (self.file, self.id.0);
        let (tree, variables) = (file.scope_tree(), file.variables());
        let references = file.reference_list().in_scopes(id, self.data().last);
        let all = references.iter().map(move |&index| Reference { file, index });
        all.filter(move |it| match variables.list.get(it.raw().variable as usize) {
            Some(variable) => !tree.contains(id, variable.scope),
            None => true,
        })
    }
}

// ───────────────────────────── from the syntax ─────────────────────────────

impl<'a> File<'a> {
    /// The global scope: ESLint's `scopeManager.globalScope`, `sourceCode.getScope(program)`.
    /// What a module or a CommonJS file declares at the top level is in
    /// [`File::top_level_scope`], which is inside it.
    #[inline]
    pub fn scope(&'a self) -> Scope<'a> {
        Scope::new(self, ScopeId(0))
    }

    /// The scope of what is declared at the top level: the `Module` scope, the `Function` scope of
    /// CommonJS, or for a script the global scope.
    pub fn top_level_scope(&'a self) -> Scope<'a> {
        let scopes = self.scope_tree().scopes.iter();
        let count = scopes.take_while(|it| it.block == Block::File).count();
        Scope::new(self, ScopeId(count.saturating_sub(1) as u32))
    }

    /// Every scope, in the order they start: ESLint's `scopeManager.scopes`.
    pub fn scopes(&'a self) -> impl DoubleEndedIterator<Item = Scope<'a>> + ExactSizeIterator + 'a {
        (0..self.scope_tree().scopes.len() as u32).map(move |id| Scope::new(self, ScopeId(id)))
    }

    /// Everything that the file declares in a scope, scope by scope. Without the
    /// [implicit `arguments`](Symbol::is_implicit_arguments) of functions.
    pub fn symbols(&'a self) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let declared = self.variables().list.iter();
        let declared = declared.filter(|it| !Variables::is_implicit(it));
        declared.map(move |it| Symbol {
            file: self,
            id: it.symbol,
        })
    }

    /// Every reference, in source order.
    pub fn references(&'a self) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        (0..self.reference_list().all.len() as u32).map(move |index| Reference { file: self, index })
    }

    /// The references to what the file does not declare, in source order: globals, and mistakes.
    /// ESLint's `globalScope.through` before the globals of the configuration are added.
    pub fn unresolved_references(
        &'a self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let references = self.reference_list().unresolved().iter();
        references.map(move |&index| Reference { file: self, index })
    }

    /// The references to `name` among [`File::unresolved_references`], in source order: ESLint's
    /// `globalScope.set.get(name).references` for a global that the file does not declare.
    pub fn unresolved_references_to(
        &'a self,
        name: &[u8],
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let references = self.reference_list().unresolved_named(self.atoms.intern(name)).iter();
        references.map(move |&index| Reference { file: self, index })
    }

    /// The assignments outside strict mode to what nothing declares, each of which creates a
    /// global variable: the definitions of ESLint's `globalScope.implicit.variables`, before the
    /// globals of the configuration are taken out.
    pub fn implicit_globals(&'a self) -> impl Iterator<Item = Reference<'a>> + 'a {
        self.unresolved_references()
            .filter(|it| it.is_write_only() && !it.is_init() && !it.scope().is_strict())
    }
}

impl<'a> Expr<'a> {
    /// What an identifier refers to. `None` if nothing in the file declares it, or if the
    /// expression is not an identifier.
    ///
    /// This is the answer of the binder, and costs no more than reading it. In rare cases
    /// ESLint's answer is another, which [`Expr::reference`] gives: `arguments`; `module` and
    /// `exports` in a CommonJS file; a namespace without values that is used as a value; a name
    /// that is visible only because TypeScript merges namespaces or enums; `const a = require(..)`
    /// in a block of a JavaScript file.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let file = self.file();
        let symbol = Symbol::some(file, *file.bound.expr_symbol.get(self.id().idx())?)?;
        (!file.is_javascript() || !symbol.flags().contains(SymFlags::MODULE_EXPORTS)).then_some(symbol)
    }

    /// The identifier as a reference: whether it is read or written, and what it resolves to. The
    /// first, if it is [several](Reference).
    pub fn reference(self) -> Option<Reference<'a>> {
        let file = self.file();
        self.as_ident()?;
        let index = file.reference_list().at(self.span().start)?;
        let reference = Reference { file, index };
        (reference.raw().site == ReferenceSite::Expr(self.id())).then_some(reference)
    }
}

impl<'a> Pat<'a> {
    /// What an identifier pattern declares.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let id = *self.file().bound.pat_symbol.get(self.id().idx())?;
        Symbol::declared(self.file(), id, self.span().start)
    }
}

impl<'a> Func<'a> {
    /// What a function declaration or a named function expression declares.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let id = *self.file().bound.fn_symbol.get(self.id().idx())?;
        Symbol::declared(self.file(), id, self.name()?.start())
    }

    /// The scope of its parameters and its body. `None` for an index signature.
    pub fn scope(self) -> Option<Scope<'a>> {
        let scope = *self.file().scope_tree().of_fn.get(self.id().idx())?;
        (scope != scopes::NONE).then(|| Scope::new(self.file(), ScopeId(scope)))
    }
}

impl<'a> Class<'a> {
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let id = *self.file().bound.class_symbol.get(self.id().idx())?;
        Symbol::declared(self.file(), id, self.name()?.start())
    }

    /// The scope of its type parameters, its heritage and its members.
    pub fn scope(self) -> Option<Scope<'a>> {
        let scope = *self.file().scope_tree().of_class.get(self.id().idx())?;
        (scope != scopes::NONE).then(|| Scope::new(self.file(), ScopeId(scope)))
    }
}

impl<'a> TypeParam<'a> {
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let id = *self.file().bound.type_param_symbol.get(self.id().idx())?;
        Symbol::declared(self.file(), id, self.name().start())
    }
}

impl<'a> Node<'a> {
    /// ESLint's `sourceCode.getScope(node)`: the innermost scope whose node is this node or
    /// contains it. For a node that creates a scope, that scope. For the file, the global scope.
    pub fn scope(self) -> Scope<'a> {
        let file = self.file();
        let tree = file.scope_tree();
        let own = match self {
            Node::File(_) => Some(file.scope()),
            Node::Func(f) => f.scope(),
            Node::Class(c) => c.scope(),
            Node::Expr(e) => match e.kind() {
                ExprKind::Fn(f) => f.scope(),
                ExprKind::Class(c) => c.scope(),
                _ => None,
            },
            Node::Stmt(s) => match s.kind() {
                StmtKind::Fn(f) => f.scope(),
                StmtKind::Class(c) => c.scope(),
                _ => None,
            },
            Node::Type(t) => match t.kind() {
                TypeKind::Fn(f) => f.scope(),
                _ => None,
            },
            _ => None,
        };
        if let Some(own) = own {
            return own;
        }
        let span = self.span();
        let scope = tree.region_around(span.start, span.end).get;
        // As in ESLint, which never answers with the scope of the name of a function expression.
        match tree.scopes.get(scope as usize).map(|it| it.kind) {
            Some(ScopeKind::FunctionExpressionName) => Scope::new(file, ScopeId(scope + 1)),
            _ => Scope::new(file, ScopeId(scope)),
        }
    }

    /// ESLint's `sourceCode.markVariableAsUsed(name, node)`: marks what `name` means at this node
    /// as used, for `no-unused-vars`. Whether there is such a variable.
    pub fn mark_variable_as_used(self, name: &str) -> bool {
        let scope = match self {
            // "Special Node.js scope means we need to start one level deeper"
            Node::File(file) => file.top_level_scope(),
            _ => self.scope(),
        };
        let found = scope.resolve(name);
        found.inspect(|it| it.mark_used()).is_some()
    }

    /// ESLint's `sourceCode.getDeclaredVariables(node)`:
    /// - the `Stmt` of a `var`, `let`, `const`, `using`, or a `VarDecl`: what it declares
    /// - a `Func`, or the `Stmt`, `Expr` or `Type` that it is: its name and its parameters
    /// - a `Class`, or the `Stmt` or `Expr` that it is: its name
    /// - the `Stmt` of a `try`: the parameter of the `catch`
    /// - the `Stmt` of an import, or an `ImportSpec`: what it imports
    /// - the `Stmt` of an interface, a type alias, an enum or a namespace: its name
    /// - an `EnumMember`, a `TypeParam`, the `Type` of a mapped type: what it declares
    pub fn declared_symbols(self) -> Vec<Symbol<'a>> {
        let file = self.file();
        let mut found: Vec<Symbol<'a>> = Vec::new();
        let mut add = |symbol: Option<Symbol<'a>>| {
            if let Some(symbol) = symbol.filter(|it| it.index().is_some())
                && !found.contains(&symbol)
            {
                found.push(symbol);
            }
        };
        let of = |symbols: &[SymbolId], index: usize, name: Option<Span>| {
            Symbol::declared(file, *symbols.get(index)?, name?.start)
        };
        let function = |f: Func<'a>, add: &mut dyn FnMut(Option<Symbol<'a>>)| {
            add(f.symbol());
            for param in f.this_param().into_iter().chain(f.params()) {
                param.pat().for_each_binding(&mut |pat| add(pat.symbol()));
            }
        };
        match self {
            Node::Func(f) => function(f, &mut add),
            Node::Class(c) => add(c.symbol()),
            Node::VarDecl(d) => d.pat().for_each_binding(&mut |pat| add(pat.symbol())),
            Node::EnumMember(m) => add(of(file.bound.enum_member_symbol, m.id().idx(), Some(m.span()))),
            Node::TypeParam(p) => add(p.symbol()),
            Node::ImportSpec(s) => add(Node::ImportSpec(s).scope().get_name(s.local().name())),
            Node::Expr(e) => match e.kind() {
                ExprKind::Fn(f) => function(f, &mut add),
                ExprKind::Class(c) => add(c.symbol()),
                _ => {}
            },
            Node::Type(t) => match t.kind() {
                TypeKind::Fn(f) => function(f, &mut add),
                TypeKind::Mapped(mapped) => add(mapped.param().symbol()),
                _ => {}
            },
            Node::Stmt(s) => match s.kind() {
                StmtKind::Var(declarations) => {
                    for d in declarations {
                        d.pat().for_each_binding(&mut |pat| add(pat.symbol()));
                    }
                }
                StmtKind::Try { param: Some(d), .. } => d.pat().for_each_binding(&mut |pat| add(pat.symbol())),
                StmtKind::Fn(f) => function(f, &mut add),
                StmtKind::Class(c) => add(c.symbol()),
                StmtKind::Interface(it) => add(of(file.bound.interface_symbol, it.id().idx(), Some(it.name().span()))),
                StmtKind::TypeAlias(it) => add(of(file.bound.alias_symbol, it.id().idx(), Some(it.name().span()))),
                StmtKind::Enum(it) => add(of(file.bound.enum_symbol, it.id().idx(), Some(it.name().span()))),
                StmtKind::Module(it) => {
                    let name = variables::name_of_declaration(file, Decl::Module(it.id()));
                    add(of(file.bound.module_symbol, it.id().idx(), name.map(|it| Span::empty(it.1))));
                }
                StmtKind::ImportEquals(it) => add(self.scope().get_name(it.name().name())),
                StmtKind::Import(it) => {
                    let scope = self.scope();
                    let named = it.named().iter().map(|spec| spec.local());
                    for local in it.default().into_iter().chain(it.namespace()).chain(named) {
                        add(scope.get_name(local.name()));
                    }
                }
                _ => {}
            },
            _ => {}
        }
        found
    }
}
