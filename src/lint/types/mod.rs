//! Types: what the type checker knows about the file and its program.
//!
//! This is `ts.TypeChecker`, `ts.Program`, `ts.Type`, `ts.Symbol`, `ts.Signature` and `ts.Node` as typescript-eslint's
//! rules use them, backed by `bun check`'s checker right after it has checked the file. The names are TypeScript's in
//! snake_case, so a rule can be ported line by line. Nothing is computed until a rule asks for it.
//!
//! ```ignore
//! const ON: On = On::new().exprs(&[ExprTag::Await]);
//!
//! fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
//!     let ExprKind::Await(operand) = expr.kind() else { return };
//!     let ty = operand.ty();                           // services.getTypeAtLocation(node.argument)
//!     if is_type_any_type(ty) || is_type_unknown_type(ty) {
//!         return;
//!     }
//!     if !tsutils::is_thenable_type(operand, ty) {
//!         cx.report(expr, AWAIT).data("type", ty.to_text());
//!     }
//! }
//! ```
//!
//! # The handles
//!
//! All are `Copy`, share the [`File`]'s lifetime, and compare by identity, like TypeScript's objects with `===`.
//!
//! | TypeScript | here |
//! | --- | --- |
//! | `ts.TypeChecker`, `ts.Program`, `parserServices` | [`Types`], from [`File::types`] or [`File::type_checker`] |
//! | `ts.Type` | [`Type`] |
//! | `ts.Symbol` | [`TsSymbol`]. A [`Symbol`](crate::semantic::Symbol) is something one file declares in a scope. A `TsSymbol` is anything declared anywhere in the program, including a property, a signature's parameter or a module |
//! | `ts.Signature` | [`Signature`] |
//! | `ts.IndexInfo` | [`IndexInfo`] |
//! | `ts.TypePredicate` | [`TypePredicate`] |
//! | `ts.Node`, `ts.Declaration` | [`TsNode`]: a node in any file of the program, including `lib.d.ts` |
//! | `ts.SourceFile` | [`SourceFile`] |
//! | `ts.SyntaxKind` | [`SyntaxKind`] |
//! | `ts.CompilerOptions` | [`CompilerOptions`], from [`Types::compiler_options`] |
//! | `ts.TypeFlags`, `ObjectFlags`, `SymbolFlags`, `ModifierFlags`, `NodeFlags`, `ElementFlags`, `TypeFormatFlags` | [`TypeFlags`], [`ObjectFlags`], [`SymbolFlags`], [`ModifierFlags`], [`NodeFlags`], [`ElementFlags`], [`TypeFormatFlags`] |
//!
//! # From syntax to types
//!
//! | typescript-eslint | here |
//! | --- | --- |
//! | `services.getTypeAtLocation(node)` | `node.ty()` on [`Expr`](crate::ast::Expr), [`Pat`](crate::ast::Pat), [`TypeNode`](crate::ast::TypeNode) and [`Node`](crate::ast::Node). `node.type_at_location()` on every handle but `Node`, because on a [`Param`](crate::ast::Param), a [`VarDecl`](crate::ast::VarDecl) or a [`Member`](crate::ast::Member), `ty()` is the written annotation. [`Types::get_type_at_location`] |
//! | `services.getSymbolAtLocation(node)` | `node.ts_symbol()` on every handle |
//! | `services.esTreeNodeToTSNodeMap.get(node)` | `node.ts_node()`, [`Types::ts_node`] |
//! | `services.tsNodeToESTreeNodeMap.get(tsNode)` | [`TsNode::to_ast`] |
//! | the same for `node.id`, `node.key`, `node.property`, which aren't nodes here | [`NameOf`]`(owner)`: `NameOf(member).ty()`, or the [`Ident`](crate::ast::Ident) itself: `types.get_type_at_location(ident)` |
//! | `checker.getContextualType(tsNode)` | [`Expr::contextual_type`](crate::ast::Expr::contextual_type) |
//! | `checker.getResolvedSignature(tsNode)` | [`Expr::resolved_signature`](crate::ast::Expr::resolved_signature) |
//! | `checker.getTypeFromTypeNode(tsNode)` | [`TypeNode::ty`](crate::ast::TypeNode::ty) |
//! | `checker.getSignatureFromDeclaration(tsNode)` | [`Func::signature`](crate::ast::Func::signature) |
//! | `getConstrainedTypeAtLocation(services, node)` | [`utils::get_constrained_type_at_location`] |
//!
//! # Where to find the rest
//!
//! - A `ts.TypeChecker` method whose first argument is a node, a type, a symbol or a signature is a method of that
//!   handle ([`TsNode`], [`Type`], [`TsSymbol`] or [`Signature`]): `checker.getApparentType(type)` is
//!   `type.get_apparent_type()`, `checker.getTypeOfSymbol(symbol)` is `symbol.get_type()`.
//! - [`Types`] has everything else: the compiler options, the intrinsic types, the symbols in scope.
//! - `ts-api-utils` is [`tsutils`].
//! - `@typescript-eslint/type-utils`, plus the parts of `eslint-plugin/src/util` that need types, is [`utils`].
//!
//! # Without types
//!
//! The runner only runs a rule with [`Meta::requires_types`](crate::rule::Meta::requires_types) on a file of a checked
//! program. Nothing here panics on any other file: every type is the error type (see [`Type::is_error`]; rules report
//! nothing for it), every symbol and signature is `None`, and every list is empty. A rule that uses types only when
//! they're available calls [`File::types`], which returns `None` otherwise.
//!
//! # Where the checker gave up
//!
//! A type can be [`Type::is_unresolved`], after a circular query or a limit. TypeScript has no such type. It has
//! [`TypeFlags::ANY`], like the error type, but nothing should be reported for it, so `is_type_any_type`,
//! `discriminate_any_type` and `is_unsafe_assignment` don't count it as `any`. They do count the error type, as
//! upstream does. A rule that reports whatever is *not* of some type (`only-throw-error`) has to check
//! [`Type::is_unresolved`] itself.
//!
//! # Differences from TypeScript 6
//!
//! The checker follows TypeScript 7 (typescript-go). typescript-eslint runs on TypeScript 6 today. Known differences:
//!
//! - [`Type::to_text`]: the order of a union's constituents, which is sorted and doesn't depend on what was checked
//!   before. Where a long type is truncated. `typeof f` for a function with expando members.
//! - [`Type::get_properties`] is in declaration order, own before inherited. TypeScript 7 sorts, TypeScript 6 uses
//!   insertion order. Nothing should depend on it.
//! - [`Signature::to_text`] prints a construct signature's `new` without being asked to.
//! - [`Expr::resolved_signature`](crate::ast::Expr::resolved_signature) is `None` for a call of an `any` value, where
//!   TypeScript has a signature without parameters that returns `any`. For an optional call, the signature returns what
//!   the function returns, without the chain's `undefined`.
//! - A union has one `undefined` where TypeScript 6 can also have the missing type.
//! - [`TsNode`]: tokens, `ParenthesizedType` and `EndOfFileToken` aren't nodes. [`TsNode::span`] and
//!   [`TsNode::get_source_text`] are empty in the default library, whose text isn't retained.
//! - [`SourceFile::package_name`] also works for a package file that's only reachable through a `/// <reference path>`,
//!   where TypeScript doesn't know the package.
//! - JavaScript: a function with `this.x = ..` and `F.prototype.y = ..` isn't a class.
//! - Code with type errors: `F.prototype = {}` in a TypeScript file is an expando member. When no overload matches a
//!   call, the parameters of a function passed as an argument get their types from the last candidate.
//!   `const c = new C(() => c.x)` isn't a circularity.

mod flags;
mod id_set;
mod locate;
mod node;
mod signature;
mod symbol;
mod ty;

pub mod tsutils;
pub mod utils;

pub use bun_sema::check::services::ReadLibrary;
pub use flags::*;
pub use id_set::{IdMap, IdSet, Indexed};
pub use locate::{Locate, NameOf};
pub use node::{SourceFile, SyntaxKind, TsNode};
pub use signature::{IndexInfo, Signature, SignatureIter, SignatureList, TypePredicate};
pub use symbol::{SymbolIter, SymbolList, TsSymbol};
pub use ty::{Literal, TupleTarget, Type, TypeIter, TypeList, TypeStructure};

use crate::ast::File;
use bun_sema::check::services::{
    Child, FileInfo, IndexInfoData, LiteralValue, Location, NodeRef, Relation, SignatureInfo,
    Structure, SymbolInfo, SymbolOp, SymbolRef, SymbolTable, TupleInfo, TypeOp, TypePredicateData,
    TypeTest,
};
use bun_sema::node::{Kind, Node as RawNode, NodeData};
use bun_sema::program::FileId;
use bun_sema::types::{SigId, TypeId};
use std::cell::RefCell;

/// A query's result when there are no types.
trait Absent {
    fn absent() -> Self;
}

macro_rules! absent {
    ($($ty:ty => $value:expr,)*) => {
        $(impl Absent for $ty {
            #[inline]
            fn absent() -> Self {
                $value
            }
        })*
    };
}

absent! {
    TypeId => TypeId::ERROR,
    bool => false,
    u32 => 0,
    (u32, u32) => (0, 0),
    TypeFlags => TypeFlags::ANY,
    ObjectFlags => ObjectFlags::empty(),
    ModifierFlags => ModifierFlags::empty(),
    NodeFlags => NodeFlags::empty(),
    crate::ast::Flags => crate::ast::Flags::empty(),
    RawNode => RawNode::NONE,
    Kind => Kind::Unknown,
    NodeData => NodeData::None,
    FileId => FileId(u32::MAX),
    Vec<u8> => Vec::new(),
    CompilerOptions => CompilerOptions::default(),
    Structure<'_> => Structure::Other,
    SymbolInfo<'_> => SymbolInfo {
        name: b"",
        flags: SymbolFlags::empty(),
        check_flags: CheckFlags::empty(),
        local: None,
    },
    SignatureInfo<'_> => SignatureInfo {
        parameters: &[],
        type_parameters: &[],
        this_parameter: None,
        declaration: None,
    },
    FileInfo<'_> => FileInfo {
        file_name: b"",
        is_default_library: false,
        is_from_external_library: false,
        is_declaration_file: false,
        is_javascript: false,
        package_name: None,
    },
}

impl<T> Absent for Option<T> {
    #[inline]
    fn absent() -> Self {
        None
    }
}

impl<T> Absent for &[T] {
    #[inline]
    fn absent() -> Self {
        &[]
    }
}

macro_rules! queries {
    ($($(#[$doc:meta])* fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty;)*) => {
        /// The queries the type checker answers, behind a trait so that callers don't have to name its lifetimes.
        ///
        /// Anything returned by reference lives as long as the file is being linted. Each method has a default body,
        /// which is the result when there are no types.
        ///
        /// Rules don't call this. [`Type`], [`TsSymbol`] and the other handles are built on it.
        pub trait Queries<'a> {
            $($(#[$doc])* fn $name(&mut self, $($arg: $ty),*) -> $ret {
                $(let _ = $arg;)*
                Absent::absent()
            })*
        }

        impl<'a, 'c: 'a, 'p: 'a, 's> Queries<'a> for bun_sema::check::services::Services<'c, 'p, 's> {
            $(#[inline]
            fn $name(&mut self, $($arg: $ty),*) -> $ret {
                bun_sema::check::services::Services::$name(self, $($arg),*)
            })*
        }
    };
}

queries! {
    // ── the program ──
    fn compiler_options() -> CompilerOptions;
    fn current_directory() -> &'a [u8];
    fn current_file() -> FileId;
    fn file_info(file: FileId) -> FileInfo<'a>;
    /// Returns the file that `specifier` resolves to. `specifier` must appear in an import or export of the current
    /// file.
    fn resolve_module_name(specifier: &[u8]) -> Option<FileId>;
    fn ambient_module(name: &[u8]) -> Option<SymbolRef>;
    /// True if references in the file have the error type because a function or module body is too large for control
    /// flow analysis (2563).
    fn was_flow_analysis_ever_disabled() -> bool;

    // ── nodes ──
    fn node(location: Location) -> RawNode;
    fn node_kind(node: NodeRef) -> Kind;
    fn node_data(node: NodeRef) -> NodeData;
    fn node_parent(node: NodeRef) -> RawNode;
    fn node_child(node: NodeRef, child: Child) -> RawNode;
    fn node_children(node: NodeRef) -> &'a [RawNode];
    fn node_span(node: NodeRef) -> (u32, u32);
    fn node_text(node: NodeRef) -> &'a [u8];
    fn node_source_text(node: NodeRef) -> &'a [u8];
    fn node_hir_flags(node: NodeRef) -> crate::ast::Flags;
    fn is_type_only(node: NodeRef, with_parents: bool) -> bool;
    fn node_modifier_flags(node: NodeRef) -> ModifierFlags;
    fn node_flags(node: NodeRef) -> NodeFlags;
    fn deprecation_of_node(node: NodeRef) -> Option<&'a [u8]>;

    // ── from a node ──
    fn type_at_location(node: NodeRef) -> TypeId;
    fn symbol_at_location(node: NodeRef) -> Option<SymbolRef>;
    /// `checker.getAccessedPropertyName(node)`: a property access's name as written, or for an element access whatever
    /// `tryGetElementAccessExpressionName` finds for its key.
    fn accessed_property_name(node: NodeRef) -> Option<&'a [u8]>;
    fn type_from_type_node(node: NodeRef) -> TypeId;
    fn contextual_type(node: NodeRef) -> Option<TypeId>;
    fn apparent_type_of_contextual_type(node: NodeRef) -> Option<TypeId>;
    fn contextual_type_for_argument_at_index(call: NodeRef, index: u32) -> Option<TypeId>;
    fn resolved_signature(call: NodeRef) -> Option<SigId>;
    fn signature_from_declaration(node: NodeRef) -> Option<SigId>;
    fn shorthand_assignment_value_symbol(node: NodeRef) -> Option<SymbolRef>;
    fn symbol_in_scope(node: NodeRef, meaning: SymbolFlags, name: &[u8]) -> Option<SymbolRef>;
    fn resolve_name(node: NodeRef, name: &[u8], meaning: SymbolFlags, exclude_globals: bool) -> Option<SymbolRef>;
    fn context_free_type_of_freshly_resolved_call(node: NodeRef) -> TypeId;

    // ── types ──
    fn type_flags(ty: TypeId) -> TypeFlags;
    fn flags_of_constituents(ty: TypeId) -> TypeFlags;
    fn object_flags(ty: TypeId) -> ObjectFlags;
    fn constituents(ty: TypeId) -> &'a [TypeId];
    fn type_arguments(ty: TypeId) -> &'a [TypeId];
    fn symbol_of_type(ty: TypeId) -> Option<SymbolRef>;
    fn alias_symbol(ty: TypeId) -> Option<SymbolRef>;
    fn alias_type_arguments(ty: TypeId) -> &'a [TypeId];
    fn literal_value(ty: TypeId) -> Option<LiteralValue<'a>>;
    fn intrinsic_name(ty: TypeId) -> Option<&'static str>;
    fn tuple_info(ty: TypeId) -> Option<TupleInfo<'a>>;
    fn structure(ty: TypeId) -> Structure<'a>;
    fn type_op(op: TypeOp, ty: TypeId) -> Option<TypeId>;
    fn type_test(test: TypeTest, ty: TypeId) -> bool;
    fn is_related(relation: Relation, source: TypeId, target: TypeId) -> bool;
    fn base_types(ty: TypeId) -> &'a [TypeId];
    fn properties_of_type(ty: TypeId) -> &'a [SymbolRef];
    fn property_of_type(ty: TypeId, name: &[u8]) -> Option<SymbolRef>;
    fn type_of_property_of_type(ty: TypeId, name: &[u8]) -> Option<TypeId>;
    fn index_infos_of_type(ty: TypeId) -> &'a [IndexInfoData];
    fn signatures_of_type(ty: TypeId, kind: SignatureKind) -> &'a [SigId];
    fn type_to_string(ty: TypeId, enclosing: Option<NodeRef>, flags: TypeFormatFlags) -> Vec<u8>;

    // ── symbols ──
    fn symbol_info(symbol: SymbolRef) -> SymbolInfo<'a>;
    fn declarations(symbol: SymbolRef) -> &'a [NodeRef];
    fn value_declaration(symbol: SymbolRef) -> Option<NodeRef>;
    fn type_of_symbol(symbol: SymbolRef) -> TypeId;
    fn declared_type_of_symbol(symbol: SymbolRef) -> TypeId;
    fn type_of_symbol_at_location(symbol: SymbolRef, node: NodeRef) -> TypeId;
    fn symbol_op(op: SymbolOp, symbol: SymbolRef) -> Option<SymbolRef>;
    fn symbol_table(table: SymbolTable, symbol: SymbolRef) -> &'a [SymbolRef];
    fn is_unknown_symbol(symbol: SymbolRef) -> bool;
    fn deprecation_of_symbol(symbol: SymbolRef) -> Option<&'a [u8]>;

    // ── signatures ──
    fn signature_info(signature: SigId) -> SignatureInfo<'a>;
    fn return_type_of_signature(signature: SigId) -> TypeId;
    fn type_predicate_of_signature(signature: SigId) -> Option<TypePredicateData<'a>>;
    fn deprecation_of_signature(signature: SigId) -> Option<&'a [u8]>;
    fn signature_to_string(signature: SigId) -> Vec<u8>;
}

/// The results for a file that isn't part of a checked program.
struct NoTypes;
impl Queries<'_> for NoTypes {}

/// The type checker, right after it has checked the file. Passed to [`File::new`].
pub struct Checker<'a> {
    queries: RefCell<&'a mut dyn Queries<'a>>,
    options: CompilerOptions,
    file: FileId,
}

impl<'a> Checker<'a> {
    pub fn new(queries: &'a mut dyn Queries<'a>) -> Self {
        Checker {
            options: queries.compiler_options(),
            file: queries.current_file(),
            queries: RefCell::new(queries),
        }
    }
}

impl<'a> File<'a> {
    /// Returns the type checker if the file is part of a checked program.
    #[inline]
    pub fn types(&'a self) -> Option<Types<'a>> {
        self.types.is_some().then_some(Types { file: self })
    }

    /// The same for a rule that [requires types](crate::rule::Meta::requires_types). On a file without types, every
    /// query returns the error type, `None` or an empty list.
    #[inline]
    pub fn type_checker(&'a self) -> Types<'a> {
        Types { file: self }
    }

    /// Runs a query against the type checker.
    #[inline]
    pub(crate) fn query<R>(&self, ask: impl FnOnce(&mut dyn Queries<'a>) -> R) -> R {
        match self
            .types
            .as_ref()
            .map(|checker| checker.queries.try_borrow_mut())
        {
            Some(Ok(mut queries)) => ask(&mut **queries),
            _ => ask(&mut NoTypes),
        }
    }

    /// True if a function or module body in the file is too large for control flow analysis (2563), as far as checking
    /// the file and the rules' queries have run into it. So call it after the rules have run. From that point every
    /// reference that would be narrowed has the error type, so type-aware rules' results for the file can be wrong or
    /// incomplete.
    pub fn is_too_large_for_flow_analysis(&self) -> bool {
        self.query(|it| it.was_flow_analysis_ever_disabled())
    }

    /// The file's id in the program.
    #[inline]
    pub(crate) fn id_in_program(&self) -> FileId {
        self.types
            .as_ref()
            .map_or(FileId(u32::MAX), |checker| checker.file)
    }
}

/// `ts.TypeChecker` and `ts.Program`, minus everything that takes a node, a type, a symbol or a signature. Those are
/// methods of [`TsNode`], [`Type`], [`TsSymbol`] and [`Signature`].
#[derive(Copy, Clone)]
pub struct Types<'a> {
    pub(crate) file: &'a File<'a>,
}

macro_rules! intrinsic_types {
    ($($(#[$doc:meta])* $name:ident $id:ident;)*) => {
        $($(#[$doc])*
        #[inline]
        pub fn $name(self) -> Type<'a> {
            Type::new(self.file, TypeId::$id)
        })*
    };
}

impl<'a> Types<'a> {
    // ───────────────────────────── ts.Program ─────────────────────────────

    /// `program.getCompilerOptions()`
    #[inline]
    pub fn compiler_options(self) -> CompilerOptions {
        self.file
            .types
            .as_ref()
            .map(|checker| checker.options)
            .unwrap_or_default()
    }

    /// `program.getCurrentDirectory()`
    pub fn get_current_directory(self) -> &'a [u8] {
        self.file.query(|q| q.current_directory())
    }

    /// `ts.resolveModuleName(specifier, fileName, options, ts.sys).resolvedModule`, for a specifier that appears in an
    /// import or export of the file.
    pub fn resolve_module_name(self, specifier: &[u8]) -> Option<SourceFile<'a>> {
        let id = self.file.query(|q| q.resolve_module_name(specifier))?;
        Some(SourceFile::new(self.file, id))
    }

    /// `checker.getAmbientModules().find(it => it.name === '"name"')`: what `declare module "name"` declares. Pass
    /// `name` without the quotes.
    pub fn get_ambient_module(self, name: &[u8]) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.ambient_module(name))?;
        Some(TsSymbol::new(self.file, id))
    }

    // ───────────────────────────── from a node ─────────────────────────────

    /// `services.esTreeNodeToTSNodeMap.get(node)`
    pub fn ts_node(self, node: impl Locate<'a>) -> TsNode<'a> {
        node.locate(self.file)
    }

    /// `checker.getTypeAtLocation(node)`
    pub fn get_type_at_location(self, node: impl Locate<'a>) -> Type<'a> {
        node.locate_for_type(self.file).get_type_at_location()
    }

    /// `checker.getAccessedPropertyName(node)` for a property or element access: the written name, or the name given by
    /// a key that's a literal, a constant or an enum member. tsgolint uses this where typescript-eslint evaluates the
    /// key.
    pub fn get_accessed_property_name(self, node: impl Locate<'a>) -> Option<&'a [u8]> {
        let (file, node) = (self.file, node.locate(self.file).raw());
        file.query(|q| q.accessed_property_name(node))
    }

    /// `checker.getSymbolsInScope(node, meaning).find(it => it.name === name)`, without building the list. It isn't
    /// `checker.resolveName(..)`: an alias counts as an alias, not as its target.
    pub fn get_symbol_in_scope(
        self,
        node: impl Locate<'a>,
        meaning: SymbolFlags,
        name: &[u8],
    ) -> Option<TsSymbol<'a>> {
        let (file, node) = (self.file, node.locate(self.file).raw());
        let symbol = file.query(|q| q.symbol_in_scope(node, meaning, name))?;
        Some(TsSymbol::new(file, symbol))
    }

    // ───────────────────────────── intrinsic types ─────────────────────────────

    intrinsic_types! {
        /// `checker.getAnyType()`
        get_any_type ANY;
        /// `checker.getUnknownType()`
        get_unknown_type UNKNOWN;
        /// `checker.getStringType()`
        get_string_type STRING;
        /// `checker.getNumberType()`
        get_number_type NUMBER;
        /// `checker.getBigIntType()`
        get_big_int_type BIGINT;
        /// `checker.getBooleanType()`
        get_boolean_type BOOLEAN;
        /// `checker.getTrueType()`
        get_true_type TRUE;
        /// `checker.getFalseType()`
        get_false_type FALSE;
        /// `checker.getVoidType()`
        get_void_type VOID;
        /// `checker.getUndefinedType()`
        get_undefined_type UNDEFINED;
        /// `checker.getNullType()`
        get_null_type NULL;
        /// `checker.getNeverType()`
        get_never_type NEVER;
        /// `checker.getESSymbolType()`
        get_es_symbol_type SYMBOL;
        /// `checker.getNonPrimitiveType()`: `object`
        get_non_primitive_type OBJECT;
        /// `errorType`
        get_error_type ERROR;
    }
}

/// A program's names as written in the source. The checker mangles a `#x` so that the name identifies the declaring
/// class.
struct SourceNames<'i>(&'i dyn bun_sema::atom::Intern);

impl bun_sema::atom::Intern for SourceNames<'_> {
    fn intern(&self, text: &[u8]) -> bun_sema::atom::Atom {
        self.0.intern(text)
    }
    fn find(&self, text: &[u8]) -> Option<bun_sema::atom::Atom> {
        self.0.find(text)
    }
    fn bytes(&self, atom: bun_sema::atom::Atom) -> &[u8] {
        bun_sema::atom::written_name(self.0.bytes(atom))
    }
    fn number(&self) -> u64 {
        self.0.number()
    }
    fn for_current_thread(&self) -> &dyn bun_sema::atom::Intern {
        self
    }
}

/// Calls `then` with the [`File`] for `file`, a file of a checked program, with [`File::modules`], [`File::formatter`]
/// and [`File::inferred_globals`] set. `path` is [`File::path`], the path the file is linted under. If it's `None`, the
/// program's name for the file is used, which is in the checker's format (`/C:/a.ts`) and spelled the way the program
/// found it.
pub fn with_file_and_modules<R>(
    checker: &mut bun_sema::check::Checker<'_, '_>,
    file: FileId,
    path: Option<&[u8]>,
    language: &crate::language::LanguageOptions,
    read_library: Option<ReadLibrary<'_>>,
    modules: Option<&dyn crate::modules::Modules>,
    formatter: Option<&dyn crate::formats::Formats>,
    inferred: Option<&dyn crate::linter::globals::InferredGlobals>,
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> Option<R> {
    let module = checker.p.files.module(file);
    let (hir, bound) = (checker.hir(file), checker.bound(file));
    if module.is_lib || hir.ran_out_of_stack || bound.ran_out_of_stack {
        return None;
    }
    let path = path.unwrap_or_else(|| module.file_name());
    let atoms = &SourceNames(&checker.p.files.atoms);
    Some(checker.with_services(file, read_library, |services| {
        let types = Checker::new(services);
        let file = File::new(path, hir, bound, atoms, language, Some(types));
        if let Some(modules) = modules {
            file.set_modules(modules);
        }
        if let Some(formatter) = formatter {
            file.set_formatter(formatter, None);
        }
        if let Some(inferred) = inferred {
            file.set_inferred_globals(inferred);
        }
        then(&file)
    }))
}
