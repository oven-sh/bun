//! Scopes, the symbols declared in them, and the references to those symbols.
//!
//! There are three parts. Each is computed the first time a rule needs it, by passes over the HIR's
//! vectors and over the binder's record of what each node belongs to (`bun_sema::bind`). Nothing
//! else is needed from a binder.
//! 1. `scopes.rs`: the scopes, divided the way ESLint divides them. Needed by [`Node::scope`] and
//!    all of [`Scope`].
//! 2. `variables.rs`: the symbols by scope and by name. Needed by all of [`Symbol`], [`Pat::symbol`],
//!    [`Scope::symbols`], [`Scope::get`], [`Scope::resolve`].
//! 3. `references.rs`: the references, and what they resolve to. Needed by all of [`Reference`] and
//!    by [`Expr::symbol`].
//!
//! The model is `@typescript-eslint/scope-manager`'s for a TypeScript file, and for any file if
//! that parser is configured. Otherwise it's `eslint-scope`'s. The two barely differ.
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
//! | `sourceCode.markVariableAsUsed(name, node)` | [`Scope::resolve`], [`Symbol::mark_used`] |
//! | `Reference` | [`Reference`] |
//! | `reference.identifier` | [`Reference::ident`], [`Reference::expr`], [`Reference::node`] |
//! | `reference.resolved` | [`Reference::symbol`], [`Expr::symbol`]. If it has no `defs`: [`Reference::global`] |
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
//! | `scope.type`, `scope.block`, `scope.isStrict` | [`Scope::kind`], [`Scope::node`], [`Scope::is_strict`] |
//! | `scope.variables`, `scope.set.get(name)` | [`Scope::symbols`], [`Scope::get`] |
//! | `scope.references`, `scope.through` | [`Scope::references`], [`Scope::through`] |
//! | `scope.upper`, `scope.childScopes`, `scope.variableScope` | [`Scope::parent`], [`Scope::children`], [`Scope::variable_scope`] |
//! | `findVariable(scope, name)`, `getVariableByName` | [`Scope::resolve`]. Including globals and a class's second variable: [`Scope::find_variable`] |
//!
//! Where the model differs from ESLint's:
//! - **Globals that the file doesn't declare aren't symbols.** That covers anything defined by the
//!   config, the ECMAScript version, a `/* global */` comment or a TypeScript `lib`. A reference to
//!   one resolves to nothing and is listed in [`File::unresolved_references`]. In ESLint it
//!   resolves to a variable of the global scope without definitions: [`Reference::global`],
//!   `File::global`.
//! - **A class declaration is one symbol**, in the scope that contains the class. ESLint has a
//!   second variable for the name in the class's own scope, which references inside the class
//!   resolve to. The name of a class *expression* is a symbol in the class's scope, as in ESLint.
//! - With an oxlint config, the top level of every file is a module scope. For typescript-eslint,
//!   whose scopes oxlint hands to a plugin, a script's top level is the global scope, and a `.cjs`
//!   or `.cts` file's is a function scope, which has an `arguments`.
//! - `x as const` has no reference to a type `const`.
//! - `(a.b as T)++` has one reference to `T`. typescript-eslint visits the type twice.
//! - In `[a as T] = b` the `T` is a type that's read. typescript-eslint treats every name in the
//!   type of an assertion in a destructuring pattern as a variable that's written.
//!
//! # ESLint's variables
//!
//! A rule ported from one that asks "what does this name resolve to" or "what is written to this
//! variable" can use [`Variable`], which matches ESLint's `Variable` one to one. It undoes the
//! first two differences above, and has the `arguments` from the third:
//!
//! | ESLint | here |
//! | --- | --- |
//! | `reference.resolved` | [`Reference::variable`] |
//! | `scope.set.get(name)` | [`Scope::variable`] |
//! | `findVariable(scope, name)` | [`Scope::find_variable`] |
//! | `variable.name`, `scope`, `defs`, `references` | [`Variable::name`], [`Variable::scope`], [`Variable::declarations`], [`Variable::references`] |
//!
//! It's a view over the symbols and costs nothing until it's used.
//!
//! # Two analyses
//!
//! oxlint analyzes a file twice. Its own rules see oxc's scopes. A JavaScript plugin's rule sees
//! those of typescript-eslint's scope manager, which differ: see
//! [`has_oxc_scopes`](crate::language::LanguageOptions::has_oxc_scopes). The same happens
//! here with an oxlint config. A rule that oxlint has sees oxc's scopes. A JavaScript plugin sees
//! typescript-eslint's, and so does a rule that's implemented here but missing from oxlint, which
//! oxlint could only run as part of such a plugin. The runner tells the file which kind of rule is
//! running, so rules don't notice any of this. Each analysis is computed on first use, so a file
//! only pays for both if rules of both kinds need them. Marks made by one kind of rule
//! ([`Symbol::mark_used`]) are invisible to the other, as in oxlint: `markVariableAsUsed` in a
//! plugin doesn't silence oxlint's `no-unused-vars`.
//!
//! A [`Symbol`], [`Scope`] or [`Reference`] belongs to the analysis it came from. A rule can keep
//! them however it likes. Data that's stored with the file for rules of both kinds must not contain
//! them.
//!
//! # What is not visited
//!
//! typescript-eslint's scope manager doesn't visit the type of a `catch` clause's parameter or the
//! options of an import type (`import("m", { with: { .. } })`). They contain no scopes, symbols or
//! references: [`Func::scope`] and [`Pat::symbol`] are `None` there, and [`Node::scope`] is the
//! enclosing scope. oxc visits both, so with
//! [`has_oxc_scopes`](crate::language::LanguageOptions::has_oxc_scopes) they're like any
//! other type and any other expression.
//!
//! # The order of references
//!
//! The scope manager creates references in the order it visits the nodes. [`Scope::references`] and
//! [`File::references_as_visited`] have that order, so the first reference to a name is the one
//! that an ESLint rule finds first. The order is computed the first time either is called. It's
//! source order, with these exceptions:
//! - the names in a destructuring pattern come before the contents of its defaults and computed
//!   keys, and the index of `a[b]` in a pattern, or in the head of a `for`-`in` or `for`-`of`,
//!   comes before `a`
//! - a variable's type comes after its initializer, a parameter's after its default, and a class
//!   property's after its value and decorators
//! - the type arguments of a call, `new` or tagged template come after the arguments
//! - a function's type parameters come after its parameters and return type, and a class's after
//!   what it extends. Signatures and function types are visited as written
//! - the type in `<T>e` comes after `e`, and the type in `e as T` comes before `e` where it's
//!   assigned to: `(e as T) = 1`, `(e as T)++`
//! - a member's decorators come after the member, and the decorators of a method's parameters come
//!   before all its parameters
//! - JSX's implicit use of `React` is at the first element
//!
//! [`Symbol::references`] only has the first half of the first exception. [`File::references`], and
//! anything else documented that way, is in source order.

use crate::ast::{
    Alias, Class, Enum, EnumMember, Expr, ExprKind, File, Func, Ident, Import, ImportEquals,
    ImportSpec, Interface, Module, Name, Node, Packed, Pat, Stmt, StmtKind, TypeKind, TypeNode,
    TypeParam,
};
use crate::linter::globals::GlobalVariable;
use crate::span::{Span, Spanned};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{self, Decl, ScopeId};
use bun_sema::hir;
use rustc_hash::FxHashSet;
use std::cell::{Cell, OnceCell, RefCell};

mod order;
mod references;
mod scopes;
mod table_of_oxc;
mod variable;
mod variables;

use references::{RawReference, ReferenceSite, References};
use scopes::{Block, ScopeTree};
pub use table_of_oxc::{hashbrown_table_order, oxc_table_order};
pub use variable::{Variable, VariableKind};
use variables::Variables;

/// Everything that's known about a file's scopes.
#[derive(Default)]
pub(crate) struct ReferenceIndex {
    /// The analysis that matches the config.
    analysis: Analysis,
    /// With an oxlint config: typescript-eslint's analysis, [alongside oxc's](self#two-analyses).
    /// Computed on first use.
    lazy_eslint_analysis: OnceCell<Box<Analysis>>,
    /// True if `lazy_eslint_analysis` is the active analysis.
    uses_eslint_scopes: Cell<bool>,
    /// A cache of recent `File::global` results, with each name in the slot given by its atom.
    /// Results that depend on the file's comments aren't cached. Empty until the first lookup.
    globals: RefCell<Vec<(Atom, Option<GlobalVariable<'static>>)>>,
}

impl ReferenceIndex {
    #[cold]
    #[inline(never)]
    fn eslint_analysis(&self) -> &Analysis {
        self.lazy_eslint_analysis.get_or_init(Box::default)
    }
}

/// Each part is computed the first time it's needed.
#[derive(Default)]
struct Analysis {
    scopes: OnceCell<ScopeTree>,
    variables: OnceCell<Variables>,
    references: OnceCell<References>,
    /// `MARKED_USED` and `MARKED_EXPORTED` bits, indexed like `Variables::list`. Empty until
    /// something is marked.
    marks: RefCell<Vec<u8>>,
    /// See [`File::mark_global_used`].
    marked_globals: RefCell<FxHashSet<Box<[u8]>>>,
}

/// While this guard is alive, scope queries on the file use typescript-eslint's analysis:
/// [`File::with_eslint_scopes`].
pub(crate) struct EslintScopesGuard<'f, 'a> {
    file: &'f File<'a>,
    previous: bool,
}

impl Drop for EslintScopesGuard<'_, '_> {
    fn drop(&mut self) {
        self.file.use_eslint_scopes(self.previous);
    }
}

const MARKED_USED: u8 = 1 << 0;
const MARKED_EXPORTED: u8 = 1 << 1;

impl<'a> File<'a> {
    #[inline(always)]
    fn semantic_index(&self) -> &ReferenceIndex {
        &self.lazy.references
    }

    #[inline]
    fn semantic(&self) -> &Analysis {
        let index = self.semantic_index();
        match index.uses_eslint_scopes.get() {
            false => &index.analysis,
            true => index.eslint_analysis(),
        }
    }

    /// True if the active scopes are oxc's, where those differ from typescript-eslint's:
    /// [`LanguageOptions::has_oxc_scopes`](crate::language::LanguageOptions::has_oxc_scopes).
    #[inline]
    pub(crate) fn has_oxc_scopes(&self) -> bool {
        self.language().has_oxc_scopes && !self.semantic_index().uses_eslint_scopes.get()
    }

    /// Switches scope queries to typescript-eslint's [analysis](self#two-analyses), or back to
    /// oxc's. The two only differ with an oxlint config. Returns the previous setting.
    #[inline]
    pub(crate) fn use_eslint_scopes(&self, enable: bool) -> bool {
        let enable = enable && self.language().has_oxc_scopes;
        self.semantic_index().uses_eslint_scopes.replace(enable)
    }

    /// [`File::use_eslint_scopes`] for the lifetime of the returned guard.
    pub(crate) fn with_eslint_scopes(&self) -> EslintScopesGuard<'_, 'a> {
        EslintScopesGuard {
            file: self,
            previous: self.use_eslint_scopes(true),
        }
    }

    // These three are inlined in more than a thousand places. So each has a single slow path, which
    // covers both "not computed yet" and typescript-eslint's analysis alongside oxc's.
    #[inline]
    fn scope_tree(&'a self) -> &'a ScopeTree {
        let index = self.semantic_index();
        match index.analysis.scopes.get() {
            Some(computed) if !index.uses_eslint_scopes.get() => computed,
            _ => self.compute_scope_tree(),
        }
    }

    #[cold]
    #[inline(never)]
    fn compute_scope_tree(&'a self) -> &'a ScopeTree {
        self.semantic().scopes.get_or_init(|| ScopeTree::new(self))
    }

    #[inline]
    fn variables(&'a self) -> &'a Variables {
        let index = self.semantic_index();
        match index.analysis.variables.get() {
            Some(computed) if !index.uses_eslint_scopes.get() => computed,
            _ => self.compute_variables(),
        }
    }

    #[cold]
    #[inline(never)]
    fn compute_variables(&'a self) -> &'a Variables {
        self.semantic()
            .variables
            .get_or_init(|| Variables::new(self, self.scope_tree()))
    }

    #[inline]
    fn reference_list(&'a self) -> &'a References {
        let index = self.semantic_index();
        match index.analysis.references.get() {
            Some(computed) if !index.uses_eslint_scopes.get() => computed,
            _ => self.compute_references(),
        }
    }

    #[cold]
    #[inline(never)]
    fn compute_references(&'a self) -> &'a References {
        let compute = || References::new(self, self.scope_tree(), self.variables());
        self.semantic().references.get_or_init(compute)
    }
}

// ───────────────────────────── symbols ─────────────────────────────

/// Something the file declares in a scope: a variable, function, class, parameter, import, type,
/// namespace or enum. Also a function's `arguments`, which nothing declares.
#[derive(Copy, Clone)]
pub struct Symbol<'a> {
    file: &'a File<'a>,
    /// Index into `Variables::list`.
    index: u32,
}

impl PartialEq for Symbol<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index
    }
}
impl Eq for Symbol<'_> {}
impl crate::types::Indexed for Symbol<'_> {
    #[inline]
    fn index(self) -> u32 {
        self.index
    }
}
impl std::hash::Hash for Symbol<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.index.hash(state);
    }
}
impl std::fmt::Debug for Symbol<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Symbol({}, {:?})", self.index, self.name())
    }
}

impl<'a> Symbol<'a> {
    /// The symbol that `decl` declares. `None` if it declares nothing that a name can refer to.
    fn declared_by(file: &'a File<'a>, decl: Decl) -> Option<Self> {
        let (_, pos) = variables::name_of_declaration(file, decl)?;
        Some(Symbol::at(file, file.variables().declared_at(pos)?))
    }

    /// The symbol at `index` in `Variables::list`.
    #[inline]
    fn at(file: &'a File<'a>, index: u32) -> Self {
        Symbol { file, index }
    }

    #[inline]
    fn variable(self) -> Option<&'a variables::Variable> {
        self.file.variables().list.get(self.index as usize)
    }

    /// A number unique among the file's symbols, for use as a set or map key. It's what `==`
    /// compares. The numbers are below [`File::symbol_key_limit`].
    #[inline]
    pub fn key(self) -> usize {
        self.index as usize
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    #[inline]
    pub fn name(self) -> Name<'a> {
        self.file
            .name(self.variable().map_or(known::arguments, |it| it.name))
    }

    /// typescript-eslint's `variable.isValueVariable`: everything except an interface, a type alias
    /// and a type parameter. It's also true for an `import type` and for a namespace that only
    /// contains types.
    pub fn is_value_variable(self) -> bool {
        self.variable()
            .is_some_and(|it| it.flags & variables::VALUE != 0)
    }

    /// typescript-eslint's `variable.isTypeVariable`: an interface, a type alias, a type
    /// parameter, a class, an enum and its members, a namespace, an import.
    pub fn is_type_variable(self) -> bool {
        self.variable()
            .is_some_and(|it| it.flags & variables::TYPE != 0)
    }

    /// The `arguments` of a non-arrow function, unless the function declares something with that
    /// name. It has no declarations. In ESLint it's the first variable in the function's scope.
    #[inline]
    pub fn is_implicit_arguments(self) -> bool {
        self.variable().is_some_and(Variables::is_implicit)
    }

    /// In source order, except that a function's parameters come before its type parameters, as in
    /// ESLint. Whatever ESLint treats as one variable is one symbol: `function f() {} var f;` has
    /// two declarations.
    #[inline]
    pub fn declarations(
        self,
    ) -> impl DoubleEndedIterator<Item = Declaration<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        let all = self
            .variable()
            .map_or(&[][..], |it| file.variables().declarations_of(it));
        all.iter().map(move |&decl| Declaration::new(file, decl))
    }

    /// Everything in the file that refers to it, in source order except for the names in
    /// destructuring patterns, which [come before the defaults](self#the-order-of-references). A
    /// declaration isn't a reference, but one that gives its name a value makes the name a write
    /// reference, as in ESLint: `let a = 1`, `function f(a = 1) {}`, `for (const a of b)`.
    #[inline]
    pub fn references(
        self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        Reference::all_at(
            self.file,
            self.file.reference_list().of_variable(self.index),
        )
    }

    #[inline]
    fn has_reference_mark(self, marks: u32) -> bool {
        self.file.reference_list().has_mark(self.index, marks)
    }

    /// True if one of its [`references`](Symbol::references) reads it. This is one load.
    #[inline]
    pub fn has_reads(self) -> bool {
        self.has_reference_mark(references::HAS_READ)
    }

    /// True if one of its references writes it, which can be its declaration. This is one load.
    #[inline]
    pub fn has_writes(self) -> bool {
        self.has_reference_mark(references::HAS_WRITE)
    }

    /// True if one of its references writes it and isn't [`is_init`](Reference::is_init), i.e.
    /// ESLint's `getModifyingReferences(variable.references)` isn't empty. This is one load.
    #[inline]
    pub fn has_modifying_references(self) -> bool {
        self.has_reference_mark(references::HAS_MODIFYING_WRITE)
    }

    /// The number of [`declarations`](Symbol::declarations). This is one load.
    #[inline]
    pub fn declaration_count(self) -> usize {
        self.variable().map_or(0, |it| it.count as usize)
    }

    /// The kinds of its declarations. This is one load.
    #[inline]
    pub fn declaration_kinds(self) -> DeclarationKinds {
        DeclarationKinds::from_bits_retain(self.variable().map_or(0, |it| it.kinds))
    }

    /// The scope it's declared in.
    #[inline]
    pub fn scope(self) -> Scope<'a> {
        Scope::new(self.file, ScopeId(self.variable().map_or(0, |it| it.scope)))
    }

    fn mark(self, mark: u8) {
        let mut marks = self.file.semantic().marks.borrow_mut();
        if marks.is_empty() {
            marks.resize(self.file.variables().list.len(), 0);
        }
        if let Some(slot) = marks.get_mut(self.index as usize) {
            *slot |= mark;
        }
    }

    fn has_mark(self, mark: u8) -> bool {
        let marks = self.file.semantic().marks.borrow();
        marks
            .get(self.index as usize)
            .is_some_and(|it| it & mark != 0)
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
    /// Nothing that a name can refer to.
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

bitflags::bitflags! {
    /// A set of [`DeclarationKind`]s.
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct DeclarationKinds: u16 {
        const VARIABLE = 1 << DeclarationKind::Variable as u16;
        const PARAMETER = 1 << DeclarationKind::Parameter as u16;
        const FUNCTION_NAME = 1 << DeclarationKind::FunctionName as u16;
        const CLASS_NAME = 1 << DeclarationKind::ClassName as u16;
        const CATCH_CLAUSE = 1 << DeclarationKind::CatchClause as u16;
        const IMPORT_BINDING = 1 << DeclarationKind::ImportBinding as u16;
        const TS_ENUM_NAME = 1 << DeclarationKind::TsEnumName as u16;
        const TS_ENUM_MEMBER = 1 << DeclarationKind::TsEnumMember as u16;
        const TS_MODULE_NAME = 1 << DeclarationKind::TsModuleName as u16;
        const TYPE = 1 << DeclarationKind::Type as u16;
    }
}

impl From<DeclarationKind> for DeclarationKinds {
    #[inline]
    fn from(kind: DeclarationKind) -> DeclarationKinds {
        DeclarationKinds::from_bits_retain(1 << kind as u16)
    }
}

impl<'a> Declaration<'a> {
    #[inline]
    fn new(file: &'a File<'a>, decl: Decl) -> Self {
        match decl {
            Decl::Var(pat) => Declaration::Var(Pat::new(file, pat)),
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
            Declaration::Interface(_) | Declaration::TypeAlias(_) | Declaration::TypeParam(_) => {
                DeclarationKind::Type
            }
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

    /// True if it is, or is part of, the `e` in `catch (e)`.
    pub fn is_catch_parameter(self) -> bool {
        match self {
            Declaration::Var(pat) => match variables::root_of_pattern(pat.file(), pat.id()) {
                bind::PatParent::Var(d) => variables::is_catch_parameter(pat.file(), d),
                _ => false,
            },
            _ => false,
        }
    }

    /// The span of the name: ESLint's `def.name` without a type annotation.
    pub fn name_span(self) -> Option<Span> {
        Some(match self {
            Declaration::Var(pat) | Declaration::Param(pat) => pat.span(),
            Declaration::Fn(func) => func.name()?.span(),
            Declaration::Class(class) => class.name()?.span(),
            Declaration::Interface(it) => it.name().span(),
            Declaration::TypeAlias(it) => it.name().span(),
            Declaration::Enum(it) => it.name().span(),
            Declaration::EnumMember(it) => it.key()?.inner_span(it.file()),
            Declaration::Module(it) => match it.name() {
                crate::ast::ModuleName::Ident(name) | crate::ast::ModuleName::String(name) => {
                    name.span()
                }
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

    /// The node that declares it: ESLint's `def.node`. For a `Var` it's the `VarDecl`, even for a
    /// `catch` parameter, where ESLint has the `CatchClause`. For a `Param` it's the `Func`.
    pub fn node(self) -> Option<Node<'a>> {
        Some(match self {
            Declaration::Var(pat) => match variables::root_of_pattern(pat.file(), pat.id()) {
                bind::PatParent::Var(d) => Node::VarDecl(crate::ast::VarDecl::new(pat.file(), d)),
                _ => return None,
            },
            Declaration::Param(pat) => match variables::root_of_pattern(pat.file(), pat.id()) {
                bind::PatParent::Param(p) => {
                    Node::Func(crate::ast::Param::new(pat.file(), p).func()?)
                }
                _ => return None,
            },
            Declaration::Fn(func) => Node::Func(func),
            Declaration::Class(class) => Node::Class(class),
            Declaration::Interface(it) => Node::Stmt(it.stmt()),
            Declaration::TypeAlias(it) => Node::Stmt(it.stmt()),
            Declaration::Enum(it) => Node::Stmt(it.stmt()),
            Declaration::EnumMember(it) => Node::EnumMember(it),
            Declaration::Module(it) => Node::Stmt(it.stmt()),
            Declaration::TypeParam(it) => Node::TypeParam(it),
            Declaration::ImportDefault(it) | Declaration::ImportNamespace(it) => {
                Node::Stmt(it.stmt())
            }
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
            Declaration::ImportDefault(it) | Declaration::ImportNamespace(it) => {
                Some(Node::Stmt(it.stmt()))
            }
            Declaration::ImportSpec(it) => Some(Node::Stmt(it.import().stmt())),
            Declaration::ImportEquals(it) => Some(Node::Stmt(it.stmt())),
            _ => None,
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
/// A name that's assigned several values at once counts as that many references, as in ESLint:
/// `[a = 1] = b` writes `1` and then `b`.
#[derive(Copy, Clone)]
pub struct Reference<'a> {
    file: &'a File<'a>,
    /// An element of `References::all`.
    raw: &'a RawReference,
}

impl PartialEq for Reference<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.raw, other.raw)
    }
}
impl Eq for Reference<'_> {}
impl std::hash::Hash for Reference<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        std::ptr::from_ref(self.raw).addr().hash(state);
    }
}
impl std::fmt::Debug for Reference<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Reference({:?}, {:?})",
            self.raw().site,
            self.raw().flags
        )
    }
}

impl<'a> Reference<'a> {
    #[inline]
    fn raw(self) -> &'a RawReference {
        self.raw
    }

    /// The references at `indices` in `References::all`.
    #[inline]
    fn all_at(
        file: &'a File<'a>,
        indices: &'a [u32],
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let all = &file.reference_list().all[..];
        indices.iter().map(move |&index| Reference {
            file,
            raw: &all[index as usize],
        })
    }

    /// The symbol it refers to. `None` if nothing in the file declares it, so it's a global or an error.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let variable = self.raw().variable;
        (variable != scopes::NONE).then(|| Symbol::at(self.file, variable))
    }

    /// The global variable that ESLint resolves it to: whatever the config, the ECMAScript version,
    /// a `/* global */` comment or a TypeScript library defines under its name. `None` if the file
    /// declares what it refers to, or if nothing defines it, in which case `no-undef` reports it.
    pub fn global(self) -> Option<GlobalVariable<'a>> {
        if self.raw().variable != scopes::NONE {
            return None;
        }
        let global = self.file.global_named(self.name())?;
        ((self.is_value() && global.accepts(false)) || (self.is_type() && global.accepts(true)))
            .then_some(global)
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

    /// The identifier, if it's an expression.
    #[inline]
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
    /// - the `Expr` that is the tag `<A-b>` or `<a:b>`, an `ExprKind::String`. In TypeScript
    ///   `<a:b>` is two references, to `a` and to `b`, and `<this>` is a reference too.
    pub fn node(self) -> Node<'a> {
        let file = self.file;
        match self.raw().site {
            ReferenceSite::Expr(e) => Node::Expr(Expr::new(file, e)),
            ReferenceSite::Pat(p) => Node::Pat(Pat::new(file, p)),
            ReferenceSite::TypeName(t) | ReferenceSite::Predicate(t) => {
                Node::Type(TypeNode::new(file, t))
            }
            ReferenceSite::ImportEquals(i) => Node::Stmt(ImportEquals::new(file, i).stmt()),
            ReferenceSite::ExportAsNamespace(s) => Node::Stmt(Stmt::new(file, s)),
            ReferenceSite::JsxName(e) => Node::Expr(Expr::new(file, e)),
            ReferenceSite::ExportSpec(s) => Node::ExportSpec(crate::ast::ExportSpec::new(file, s)),
            ReferenceSite::Declaration(index) => {
                let first = Symbol::at(file, index).declarations().next();
                first
                    .and_then(Declaration::node)
                    .unwrap_or(Node::File(file))
            }
        }
    }

    /// True if it's JSX's implicit use of `React`, or of the names set by `jsxPragma` and
    /// `jsxFragmentName`. typescript-eslint makes the declaration's own name the reference.
    #[inline]
    pub fn is_jsx_pragma(self) -> bool {
        matches!(self.raw().site, ReferenceSite::Declaration(_))
    }

    /// The name at its position in the source: ESLint's `reference.identifier`.
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

    /// ESLint's `reference.writeExpr`, i.e. the assigned value: the right side of the assignment
    /// (also for part of a destructuring pattern), a declaration's initializer or default, or what
    /// a `for`-`in` or `for`-`of` iterates over. `None` for `a++`.
    #[inline]
    pub fn write_expr(self) -> Option<Expr<'a>> {
        Expr::some(self.file, self.raw().write)
    }

    /// ESLint's `reference.from`: the scope it's in.
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

    /// `Some` if the name is a separate node.
    #[inline]
    fn packed_node(&self) -> Option<Packed> {
        match self.raw().site {
            ReferenceSite::Expr(_) | ReferenceSite::Pat(_) => Some(self.node().packed()),
            _ => None,
        }
    }
}

// ───────────────────────────── scopes ─────────────────────────────

/// ESLint's `scope.type`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ScopeKind {
    /// The whole file. In a script, top-level declarations belong to it. In a module or in CommonJS
    /// it declares nothing.
    Global,
    /// The top level of a module. Its parent is the global scope.
    Module,
    /// A function's parameters and body. Also the top level of a CommonJS file.
    Function,
    /// Only the name of a named function expression. The function's scope is inside it.
    FunctionExpressionName,
    /// `{ }`, unless it's a function's body.
    Block,
    /// Starts at the `{` of a `switch`.
    Switch,
    /// A `catch` clause. It declares the parameter, and the block is a scope inside it.
    Catch,
    /// The body of a `with`.
    With,
    /// A `for`, `for`-`in` or `for`-`of` whose head declares something with `let`, `const` or
    /// `using`. Other loops have no scope.
    For,
    Class,
    /// A class field's initializer.
    ClassFieldInitializer,
    /// `static { }`
    ClassStaticBlock,
    /// `namespace N { }`, `declare module "m" { }`, `declare global { }`
    TsModule,
    TsEnum,
    /// An interface or type alias with type parameters. Without them it has no scope.
    Type,
    /// `A extends B ? C : D`, without `D`. It declares whatever `infer` declares.
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
    /// Index into `ScopeTree::scopes`.
    id: ScopeId,
}

impl PartialEq for Scope<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Scope<'_> {}
impl crate::types::Indexed for Scope<'_> {
    #[inline]
    fn index(self) -> u32 {
        self.id.0
    }
}
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
        scopes.get(self.id.idx()).unwrap_or_else(|| &scopes[0])
    }

    /// Its index among the file's scopes, ordered by start. This isn't the binder's id.
    #[inline]
    pub fn id(self) -> ScopeId {
        self.id
    }

    #[inline]
    pub fn kind(self) -> ScopeKind {
        self.data().kind
    }

    /// The enclosing scope. `None` for the global scope.
    #[inline]
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

    /// True if `other` is this scope or inside it.
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
    /// - everything else: the `Stmt`. For `Catch` it's the `try` statement, because a `catch`
    ///   clause isn't a node.
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
                } => Span::new(
                    crate::tokens::skip_trivia(file.text(), block.span().end),
                    handler.span().end,
                ),
                _ => s.span(),
            },
            // The HIR positions the block after `finally` at the keyword.
            (ScopeKind::Block, Node::Stmt(s)) => match file.hir.stmts.get(s.id().idx()) {
                Some(raw) if file.text().get(raw.start as usize) != Some(&b'{') => Span::new(
                    crate::tokens::skip_trivia(file.text(), raw.loc.pos),
                    raw.loc.end,
                ),
                _ => s.span(),
            },
            (ScopeKind::ClassStaticBlock, Node::Func(f)) => f.owner().span(),
            (_, Node::Func(f)) => match f.owner() {
                Node::Stmt(s) => s.span_without_export(),
                Node::Expr(e) if matches!(f.kind(), hir::FnKind::Expr | hir::FnKind::Arrow) => {
                    e.span()
                }
                Node::Type(t) => t.span(),
                Node::Member(m) if self.kind() == ScopeKind::FunctionType => m.span(),
                _ => f.span_from_params(),
            },
            (_, Node::Class(c)) => match c.owner() {
                Node::Stmt(s) => s.span_without_export(),
                owner => owner.span(),
            },
            (ScopeKind::TsModule | ScopeKind::TsEnum | ScopeKind::Type, Node::Stmt(s)) => {
                s.span_without_export()
            }
            (_, node) => node.span(),
        }
    }

    /// The symbols declared in it, in declaration order. For a non-arrow function the first one is
    /// its [`arguments`](Symbol::is_implicit_arguments).
    pub fn symbols(self) -> impl DoubleEndedIterator<Item = Symbol<'a>> + ExactSizeIterator + 'a {
        let file = self.file;
        file.variables()
            .range_of_scope(self.id.0)
            .map(move |index| Symbol::at(file, index as u32))
    }

    fn get_atom(self, name: Atom) -> Option<Symbol<'a>> {
        self.file
            .variables()
            .get(self.id.0, name)
            .map(|index| Symbol::at(self.file, index))
    }

    fn resolve_atom(self, name: Atom) -> Option<Symbol<'a>> {
        let (tree, wanted_flags) = (self.file.scope_tree(), variables::VALUE | variables::TYPE);
        let found = self
            .file
            .variables()
            .resolve(tree, self.id.0, name, u32::MAX, wanted_flags);
        found.map(|index| Symbol::at(self.file, index))
    }

    /// The symbol declared in it as `name`: ESLint's `scope.set.get(name)`.
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

    /// Resolves `name` from here: it can be declared in this scope or an enclosing one, as a value
    /// or as a type. ESLint's `getVariableByName`, eslint-utils' `findVariable`.
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

    /// The scope that a `var` here is hoisted to: the nearest `Function`, `Module`, `Global`,
    /// `TsModule`, `ClassFieldInitializer` or `ClassStaticBlock`. ESLint's `scope.variableScope`.
    #[inline]
    pub fn variable_scope(self) -> Scope<'a> {
        Scope::new(self.file, ScopeId(self.data().variable_scope))
    }

    /// True if `scope.type === "module"`. Meant for rules that use this to check whether something is at the top level
    /// of the file. Without an ESLint or oxlint config, the function scope around a CommonJS file counts too. The user
    /// didn't choose `sourceType` then, and `import/no-commonjs` and `import/no-amd` are meant for exactly the files
    /// that have no `import`.
    pub fn is_top_level_of_module(self) -> bool {
        match self.kind() {
            ScopeKind::Module => true,
            ScopeKind::Function => {
                self.file.language().has_no_foreign_config && matches!(self.node(), Node::File(_))
            }
            _ => false,
        }
    }

    /// True if strict mode applies: in a module, in a class, or under a `"use strict"` directive.
    #[inline]
    pub fn is_strict(self) -> bool {
        self.data().is_strict
    }

    /// The references directly in it, not those in nested scopes: ESLint's `scope.references`, in
    /// [its order](self#the-order-of-references).
    pub fn references(
        self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        Reference::all_at(
            self.file,
            (self.file.reference_list()).in_scopes(self.file, self.id.0, self.id.0),
        )
    }

    /// The same references in nearly source order: a pattern's names come before its defaults. It's
    /// for callers that don't need ESLint's order, which costs a pass over all of the file's
    /// references the first time it's requested.
    pub fn references_with_names_of_patterns_first(
        self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let in_it = self.file.reference_list().in_scope_as_visited(self.id.0);
        Reference::all_at(self.file, in_it)
    }

    /// The references in it and in its nested scopes to symbols declared outside it, or nowhere:
    /// ESLint's `scope.through`. Scope by scope, not in source order.
    pub fn through(self) -> impl Iterator<Item = Reference<'a>> + 'a {
        let (file, id) = (self.file, self.id.0);
        let (tree, variables) = (file.scope_tree(), file.variables());
        let in_it = (file.reference_list()).in_scopes_in_some_order(id, self.data().last);
        let all = Reference::all_at(file, in_it);
        all.filter(
            move |it| match variables.list.get(it.raw().variable as usize) {
                Some(variable) => !tree.contains(id, variable.scope),
                None => true,
            },
        )
    }
}

// ───────────────────────────── from the syntax ─────────────────────────────

impl<'a> File<'a> {
    /// Sets ESLint's `variable.eslintUsed` on a variable that the file doesn't declare, which isn't
    /// a [`Symbol`]. `no-unused-vars` reads it for variables defined by a `/* global */` comment.
    pub fn mark_global_used(&self, name: &[u8]) {
        let mut marked = self.semantic().marked_globals.borrow_mut();
        if !marked.contains(name) {
            marked.insert(name.into());
        }
    }

    /// See [`File::mark_global_used`].
    pub fn is_global_marked_used(&self, name: &[u8]) -> bool {
        self.semantic().marked_globals.borrow().contains(name)
    }

    /// The global scope: ESLint's `scopeManager.globalScope`, `sourceCode.getScope(program)`. The
    /// top-level declarations of a module or CommonJS file are in [`File::top_level_scope`], which
    /// is inside it.
    #[inline]
    pub fn scope(&'a self) -> Scope<'a> {
        Scope::new(self, ScopeId(0))
    }

    /// The symbols whose [`Symbol::declaration_count`] is more than 1. It doesn't scan the others.
    pub(crate) fn symbols_declared_twice(&'a self) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let several = self.variables().several.iter();
        several.map(move |&index| Symbol::at(self, index))
    }

    /// True if some block contains a declaration whose symbol belongs to the enclosing function: a
    /// `var`, or for oxc a function declaration outside strict code.
    pub(crate) fn has_hoisted_block_declarations(&'a self) -> bool {
        self.variables().has_hoisted_block_declarations
    }

    /// The symbols in scopes that can't hold a `var`, each with its scope, limited to those that
    /// share their name with another symbol in the file. With `only_catch_params`, only `catch`
    /// parameters.
    pub(crate) fn block_scoped_symbols(
        &'a self,
        only_catch_params: bool,
    ) -> impl Iterator<Item = (Scope<'a>, Symbol<'a>)> {
        let (scopes, variables) = (&self.scope_tree().scopes, self.variables());
        let blocks = (scopes.iter().zip(0u32..)).filter(move |(it, id)| {
            it.variable_scope != *id && (!only_catch_params || it.kind == ScopeKind::Catch)
        });
        blocks.flat_map(move |(_, id)| {
            let scope = Scope::new(self, ScopeId(id));
            let shares_name = move |it: &usize| {
                (variables.list.get(*it)).is_some_and(|it| variables.shares_name(it))
            };
            let symbols = variables.range_of_scope(id).filter(shares_name);
            symbols.map(move |it| (scope, Symbol::at(self, it as u32)))
        })
    }

    /// The scope in which a name written at `pos` is declared.
    pub(crate) fn scope_at(&'a self, pos: u32) -> Scope<'a> {
        Scope::new(self, ScopeId(self.scope_tree().scope_at(pos)))
    }

    /// The scope of top-level declarations: the `Module` scope, CommonJS's `Function` scope, or the
    /// global scope for a script.
    pub fn top_level_scope(&'a self) -> Scope<'a> {
        let scopes = self.scope_tree().scopes.iter();
        let count = scopes.take_while(|it| it.block == Block::File).count();
        Scope::new(self, ScopeId(count.saturating_sub(1) as u32))
    }

    /// Every scope, ordered by start: ESLint's `scopeManager.scopes`.
    pub fn scopes(&'a self) -> impl DoubleEndedIterator<Item = Scope<'a>> + ExactSizeIterator + 'a {
        (0..self.scope_tree().scopes.len() as u32).map(move |id| Scope::new(self, ScopeId(id)))
    }

    /// Everything the file declares in a scope, scope by scope, except functions' [implicit
    /// `arguments`](Symbol::is_implicit_arguments).
    pub fn symbols(&'a self) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let declared = self.variables().list.iter().enumerate();
        let declared = declared.filter(|it| !Variables::is_implicit(it.1));
        declared.map(move |it| Symbol::at(self, it.0 as u32))
    }

    /// The subset of [`File::symbols`] named `name`, in the same order. It doesn't scan the others.
    pub fn symbols_named(&'a self, name: Name<'a>) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let variables = self.variables();
        let named = variables.named(name.atom()).iter();
        let declared = named.filter(|it| {
            (variables.list.get(**it as usize)).is_some_and(|it| !Variables::is_implicit(it))
        });
        declared.map(move |&index| Symbol::at(self, index))
    }

    /// The subset of [`File::symbols`] with a declaration of one of `kinds`. It checks one number
    /// per symbol in the file.
    pub fn symbols_declared_as(
        &'a self,
        kinds: DeclarationKinds,
    ) -> impl Iterator<Item = Symbol<'a>> + 'a {
        let declared = self.variables().list.iter().enumerate();
        let declared = declared.filter(move |it| it.1.kinds & kinds.bits() != 0);
        declared.map(move |it| Symbol::at(self, it.0 as u32))
    }

    /// [`File::global`] for a name in the file, with a small cache of recent results.
    pub fn global_named(&'a self, name: Name<'a>) -> Option<GlobalVariable<'a>> {
        const CACHE_SIZE: usize = 64;
        let atom = name.atom();
        let mut cache = self.semantic_index().globals.borrow_mut();
        if cache.is_empty() {
            cache.resize(CACHE_SIZE, (Atom::NONE, None));
        }
        let slot = &mut cache[atom.0 as usize % CACHE_SIZE];
        if slot.0 == atom {
            return slot.1;
        }
        let global = self.global(name.bytes());
        if global.is_none_or(|it| it.comments.is_empty()) {
            *slot = (
                atom,
                global.map(|it| GlobalVariable {
                    comments: &[],
                    ..it
                }),
            );
        }
        global
    }

    /// An exclusive upper bound for every [`Symbol::key`] in the file.
    pub fn symbol_key_limit(&'a self) -> usize {
        self.variables().list.len()
    }

    /// Every reference, in source order.
    pub fn references(
        &'a self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        self.reference_list()
            .all
            .iter()
            .map(move |raw| Reference { file: self, raw })
    }

    /// The subset of [`File::references`] whose name starts in `span`, in the same order. Found
    /// with two binary searches.
    pub fn references_within(
        &'a self,
        span: Span,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let all = &self.reference_list().all[..];
        let rest = &all[all.partition_point(|it| it.pos < span.start)..];
        let within = &rest[..rest.partition_point(|it| it.pos < span.end)];
        within.iter().map(move |raw| Reference { file: self, raw })
    }

    /// Every reference, in [the order ESLint creates them](self#the-order-of-references).
    pub fn references_as_visited(
        &'a self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        self.references_in(self.reference_list().in_creation_order(self))
    }

    /// Every reference, in source order except that a destructuring pattern's names come before
    /// everything else in the pattern.
    pub(crate) fn references_with_names_of_patterns_first(
        &'a self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        self.references_in(self.reference_list().visiting_order())
    }

    /// `order` has indices into `References::all`, or is empty to use that list's own order.
    fn references_in(
        &'a self,
        order: &'a [u32],
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        let all = &self.reference_list().all[..];
        (0..all.len()).map(move |i| Reference {
            file: self,
            raw: &all[order.get(i).map_or(i, |&it| it as usize)],
        })
    }

    /// The reference whose name starts at `offset`. The first one, if there are [several](Reference).
    pub fn reference_at(&'a self, offset: u32) -> Option<Reference<'a>> {
        let raw = self.reference_list().at(offset)?;
        Some(Reference { file: self, raw })
    }

    /// The references to names that the file doesn't declare, in source order: globals and
    /// mistakes. ESLint's `globalScope.through` before the config's globals are added.
    pub fn unresolved_references(
        &'a self,
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        Reference::all_at(self, self.reference_list().unresolved())
    }

    /// The references to `name` among [`File::unresolved_references`], in source order: ESLint's
    /// `globalScope.set.get(name).references` for a global that the file doesn't declare.
    pub fn unresolved_references_to(
        &'a self,
        name: &[u8],
    ) -> impl DoubleEndedIterator<Item = Reference<'a>> + ExactSizeIterator + 'a {
        Reference::all_at(
            self,
            self.reference_list()
                .unresolved_named(self.atoms.intern(name)),
        )
    }
}

impl<'a> Expr<'a> {
    /// The value that an identifier refers to: what ESLint would resolve a value read at the
    /// identifier's position to, whether or not ESLint creates a reference for it. `None` if
    /// nothing in the file declares it, which includes a function's
    /// [`arguments`](Symbol::is_implicit_arguments), or if the expression isn't an identifier.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        self.as_ident()?;
        let file = self.file();
        let symbol = Symbol::at(file, file.reference_list().variable_of_expr(self.id())?);
        (!symbol.is_implicit_arguments()).then_some(symbol)
    }

    /// The identifier as a reference, which tells whether it's read or written and what it resolves
    /// to. The first one, if there are [several](Reference).
    pub fn reference(self) -> Option<Reference<'a>> {
        let file = self.file();
        self.as_ident()?;
        let raw = file.reference_list().at(self.span().start)?;
        let reference = Reference { file, raw };
        (reference.raw().site == ReferenceSite::Expr(self.id())).then_some(reference)
    }
}

impl<'a> Pat<'a> {
    /// The symbol that an identifier pattern declares.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        let index = self.file().variables().variable_of_pat(self.id())?;
        Some(Symbol::at(self.file(), index))
    }
}

impl<'a> Func<'a> {
    /// The symbol that a function declaration or a named function expression declares.
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::declared_by(self.file(), Decl::Fn(self.id()))
    }

    /// The scope of its parameters and body. `None` for an index signature, and inside [what is not
    /// visited](self#what-is-not-visited).
    pub fn scope(self) -> Option<Scope<'a>> {
        let scope = *self.file().scope_tree().scope_of_fn.get(self.id().idx())?;
        (scope != scopes::NONE).then(|| Scope::new(self.file(), ScopeId(scope)))
    }
}

impl<'a> Class<'a> {
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::declared_by(self.file(), Decl::Class(self.id()))
    }

    /// The scope of its type parameters, heritage and members.
    pub fn scope(self) -> Option<Scope<'a>> {
        let scope = *self
            .file()
            .scope_tree()
            .scope_of_class
            .get(self.id().idx())?;
        (scope != scopes::NONE).then(|| Scope::new(self.file(), ScopeId(scope)))
    }
}

impl<'a> TypeParam<'a> {
    #[inline]
    pub fn symbol(self) -> Option<Symbol<'a>> {
        Symbol::declared_by(self.file(), Decl::TypeParam(self.id()))
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
            // A signature or a static block. A method is in the class's scope.
            Node::Member(m) => m
                .func()
                .and_then(Func::scope)
                .filter(|it| it.kind() != ScopeKind::Function),
            _ => None,
        };
        if let Some(own) = own {
            return own;
        }
        let block = match self {
            Node::Stmt(s) => Some(Block::Stmt(s.id())),
            Node::Type(t) => Some(Block::Type(t.id())),
            Node::Expr(e) => Some(Block::Expr(e.id())),
            _ => None,
        };
        let span = self.span();
        let scope = tree.scope_of_node(span.start, span.end, block);
        // Like ESLint, which never returns a function expression's name scope.
        match tree.scopes.get(scope as usize).map(|it| it.kind) {
            Some(ScopeKind::FunctionExpressionName) => Scope::new(file, ScopeId(scope + 1)),
            _ => Scope::new(file, ScopeId(scope)),
        }
    }

    /// ESLint's `sourceCode.getDeclaredVariables(node)`:
    /// - the `Stmt` of a `var`, `let`, `const`, `using`, or a `VarDecl`: what it declares
    /// - a `Func`, or its `Stmt`, `Expr` or `Type`: its name and its parameters
    /// - a `Class`, or its `Stmt` or `Expr`: its name
    /// - the `Stmt` of a `try`: the parameter of the `catch`
    /// - the `Stmt` of an import, or an `ImportSpec`: what it imports
    /// - the `Stmt` of an interface, a type alias, an enum or a namespace: its name
    /// - an `EnumMember`, a `TypeParam`, the `Type` of a mapped type: what it declares
    pub fn declared_symbols(self) -> Vec<Symbol<'a>> {
        let file = self.file();
        let mut found: Vec<Symbol<'a>> = Vec::new();
        let mut add = |symbol: Option<Symbol<'a>>| found.extend(symbol);
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
            Node::EnumMember(m) => add(Symbol::declared_by(file, Decl::EnumMember(m.id()))),
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
                StmtKind::Try { param: Some(d), .. } => {
                    d.pat().for_each_binding(&mut |pat| add(pat.symbol()))
                }
                StmtKind::Fn(f) => function(f, &mut add),
                StmtKind::Class(c) => add(c.symbol()),
                StmtKind::Interface(it) => add(Symbol::declared_by(file, Decl::Interface(it.id()))),
                StmtKind::TypeAlias(it) => add(Symbol::declared_by(file, Decl::Alias(it.id()))),
                StmtKind::Enum(it) => add(Symbol::declared_by(file, Decl::Enum(it.id()))),
                StmtKind::Module(it) => add(Symbol::declared_by(file, Decl::Module(it.id()))),
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
        // Keep each one once, at its first position: `var a, a`, `function f(a, a) {}`.
        let mut first: Vec<(u32, usize)> = found
            .iter()
            .enumerate()
            .map(|(i, it)| (it.index, i))
            .collect();
        crate::utils::sort::sort_unstable(&mut first);
        first.dedup_by_key(|it| it.0);
        if first.len() < found.len() {
            crate::utils::sort::sort_unstable_by_key(&mut first, |it| it.1);
            found = first.iter().map(|it| found[it.1]).collect();
        }
        found
    }
}
