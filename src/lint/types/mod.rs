//! Types: what the type checker knows about the file and the program it is part of.
//!
//! This is `ts.TypeChecker`, `ts.Program`, `ts.Type`, `ts.Symbol`, `ts.Signature` and `ts.Node` as
//! typescript-eslint's rules use them, answered by the checker of `bun check` right after it has
//! checked the file. The names are TypeScript's in snake_case, so that a rule is ported line by
//! line. Nothing is computed before a rule asks.
//!
//! ```ignore
//! fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
//!     on.exprs([ExprTag::Await], |_, expr, cx| {
//!         let ExprKind::Await(operand) = expr.kind() else { return };
//!         let ty = operand.ty();                       // services.getTypeAtLocation(node.argument)
//!         if is_type_any_type(ty) || is_type_unknown_type(ty) {
//!             return;
//!         }
//!         if !tsutils::is_thenable_type(operand, ty) {
//!             cx.report(expr, AWAIT).data("type", ty.to_text());
//!         }
//!     });
//! }
//! ```
//!
//! # The handles
//!
//! All are `Copy`, have the one lifetime of the [`File`], and compare by identity, as the objects
//! of TypeScript do with `===`.
//!
//! | TypeScript | here |
//! | --- | --- |
//! | `ts.TypeChecker`, `ts.Program`, `parserServices` | [`Types`], from [`File::types`] or [`File::type_checker`] |
//! | `ts.Type` | [`Type`] |
//! | `ts.Symbol` | [`TsSymbol`]. A [`Symbol`](crate::semantic::Symbol) is what one file declares in a scope, this is anything that anything in the program declares: also a property, a parameter of a signature, a module |
//! | `ts.Signature` | [`Signature`] |
//! | `ts.IndexInfo` | [`IndexInfo`] |
//! | `ts.TypePredicate` | [`TypePredicate`] |
//! | `ts.Node`, `ts.Declaration` | [`TsNode`]: a node of any file of the program, also of `lib.d.ts` |
//! | `ts.SourceFile` | [`SourceFile`] |
//! | `ts.SyntaxKind` | [`SyntaxKind`] |
//! | `ts.CompilerOptions` | [`CompilerOptions`], from [`Types::compiler_options`] |
//! | `ts.TypeFlags`, `ObjectFlags`, `SymbolFlags`, `ModifierFlags`, `NodeFlags`, `ElementFlags`, `TypeFormatFlags` | [`TypeFlags`], [`ObjectFlags`], [`SymbolFlags`], [`ModifierFlags`], [`NodeFlags`], [`ElementFlags`], [`TypeFormatFlags`] |
//!
//! # From the syntax to types
//!
//! | typescript-eslint | here |
//! | --- | --- |
//! | `services.getTypeAtLocation(node)` | `node.ty()` on [`Expr`], [`Pat`], [`TypeNode`] and [`Node`]. `node.type_at_location()` on every handle: on a [`Param`], a [`VarDecl`] or a [`Member`], `ty()` is the annotation that is written. [`Types::get_type_at_location`] |
//! | `services.getSymbolAtLocation(node)` | `node.ts_symbol()` on every handle, [`Types::get_symbol_at_location`] |
//! | `services.esTreeNodeToTSNodeMap.get(node)` | `node.ts_node()`, [`Types::ts_node`] |
//! | `services.tsNodeToESTreeNodeMap.get(tsNode)` | [`TsNode::to_ast`] |
//! | the same for `node.id`, `node.key`, `node.property`, which are not nodes here | [`NameOf`]`(owner)`: `NameOf(member).ty()`, or the [`Ident`](crate::ast::Ident) itself: `types.get_type_at_location(ident)` |
//! | `checker.getContextualType(tsNode)` | [`Expr::contextual_type`] |
//! | `checker.getResolvedSignature(tsNode)` | [`Expr::resolved_signature`] |
//! | `checker.getTypeFromTypeNode(tsNode)` | [`TypeNode::ty`] |
//! | `checker.getSignatureFromDeclaration(tsNode)` | [`Func::signature`] |
//! | `getConstrainedTypeAtLocation(services, node)` | [`utils::get_constrained_type_at_location`] |
//!
//! # Where the rest is
//!
//! - A method of `ts.TypeChecker` that takes a type, a symbol or a signature first is a method of
//!   that handle **and** of [`Types`]: `checker.getApparentType(type)` is
//!   `type.get_apparent_type()` or `types.get_apparent_type(type)`.
//! - [`tsutils`]: `ts-api-utils`.
//! - [`utils`]: `@typescript-eslint/type-utils`, and what in `eslint-plugin/src/util` needs types.
//!
//! # Without types
//!
//! The runner runs a rule with [`Meta::requires_types`](crate::rule::Meta::requires_types) only on
//! a file of a checked program. Nothing here panics on any other file: every type is the error
//! type (which [`Type::is_error`] tells and for which rules report nothing), every symbol and
//! signature is `None`, every list is empty. A rule that uses types only if there are any asks
//! [`File::types`], which is `None` then.
//!
//! # Where the checker gave up
//!
//! A type can be [`Type::is_unresolved`]: a circular query, or a limit. TypeScript has no such
//! type. It has [`TypeFlags::ANY`], as the error type has, but nothing should be reported for it:
//! `is_type_any_type`, `discriminate_any_type` and `is_unsafe_assignment` do not count it as `any`.
//! The error type they do, as upstream. A rule that reports what is *not* of some type
//! (`only-throw-error`) has to ask [`Type::is_unresolved`] itself.

mod flags;
mod locate;
mod node;
mod signature;
mod symbol;
mod ty;

pub mod tsutils;
pub mod utils;

pub use bun_sema::check::services::ReadLibrary;
pub use flags::*;
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

/// What a query answers when there are no types.
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
        min_argument_count: 0,
        has_rest_parameter: false,
    },
    FileInfo<'_> => FileInfo {
        file_name: b"",
        is_default_library: false,
        is_from_external_library: false,
        is_declaration_file: false,
        is_javascript: false,
        is_external_module: false,
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
        /// The queries that the type checker answers, for those who cannot name its lifetimes.
        ///
        /// What is returned by reference lives as long as the file is linted. Each method has a
        /// body, which is the answer when there are no types.
        ///
        /// Rules do not call this. It is what [`Type`], [`TsSymbol`] and the other handles are
        /// made of.
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
    fn source_file(file_name: &[u8]) -> Option<FileId>;
    /// The file that `specifier`, which is written in an import or an export of the file at hand,
    /// resolves to.
    fn resolve_module_name(specifier: &[u8]) -> Option<FileId>;
    fn ambient_module(name: &[u8]) -> Option<SymbolRef>;

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
    fn type_from_type_node(node: NodeRef) -> TypeId;
    fn contextual_type(node: NodeRef) -> Option<TypeId>;
    fn apparent_type_of_contextual_type(node: NodeRef) -> Option<TypeId>;
    fn contextual_type_for_argument_at_index(call: NodeRef, index: u32) -> Option<TypeId>;
    fn resolved_signature(call: NodeRef) -> Option<SigId>;
    fn signature_from_declaration(node: NodeRef) -> Option<SigId>;
    fn shorthand_assignment_value_symbol(node: NodeRef) -> Option<SymbolRef>;
    fn symbols_in_scope(node: NodeRef, meaning: SymbolFlags) -> &'a [SymbolRef];
    fn resolve_name(node: NodeRef, name: &[u8], meaning: SymbolFlags, exclude_globals: bool) -> Option<SymbolRef>;
    fn accessed_property_name(node: NodeRef) -> Option<&'a [u8]>;
    fn constant_value(node: NodeRef) -> Option<LiteralValue<'a>>;
    fn is_const_context(node: NodeRef) -> bool;
    fn flow_type_of_reference(node: NodeRef, declared: TypeId) -> TypeId;
    fn context_free_type_of_expression(node: NodeRef) -> TypeId;
    fn type_with_default(ty: TypeId, default: NodeRef) -> TypeId;
    fn symbol_of_local(symbol: bun_sema::bind::SymbolId) -> Option<SymbolRef>;

    // ── types ──
    fn type_flags(ty: TypeId) -> TypeFlags;
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
    fn has_type_facts(ty: TypeId, facts: TypeFacts) -> bool;
    fn is_related(relation: Relation, source: TypeId, target: TypeId) -> bool;
    fn base_types(ty: TypeId) -> &'a [TypeId];
    fn properties_of_type(ty: TypeId) -> &'a [SymbolRef];
    fn property_of_type(ty: TypeId, name: &[u8]) -> Option<SymbolRef>;
    fn type_of_property_of_type(ty: TypeId, name: &[u8]) -> Option<TypeId>;
    fn type_of_property_or_index_signature_of_type(ty: TypeId, name: &[u8]) -> Option<TypeId>;
    fn index_infos_of_type(ty: TypeId) -> &'a [IndexInfoData];
    fn applicable_index_info(ty: TypeId, key: TypeId) -> Option<IndexInfoData>;
    fn signatures_of_type(ty: TypeId, kind: SignatureKind) -> &'a [SigId];
    fn union_type(types: &[TypeId], reduction: UnionReduction) -> TypeId;
    fn intersection_type(types: &[TypeId]) -> TypeId;
    fn indexed_access_type(object: TypeId, index: TypeId, in_expression: bool) -> Option<TypeId>;
    fn assignment_reduced_type(declared: TypeId, assigned: TypeId) -> TypeId;
    fn global_type(name: &[u8], arity: u32) -> Option<TypeId>;
    fn string_literal_type(value: &[u8]) -> TypeId;
    fn number_literal_type(value: f64) -> TypeId;
    fn compare_types(a: TypeId, b: TypeId) -> Option<std::cmp::Ordering>;
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
    fn is_readonly_symbol(symbol: SymbolRef) -> bool;
    fn is_spreadable_property(symbol: SymbolRef) -> bool;
    fn declaration_modifier_flags_from_symbol(symbol: SymbolRef) -> ModifierFlags;
    fn deprecation_of_symbol(symbol: SymbolRef) -> Option<&'a [u8]>;
    fn symbol_to_string(symbol: SymbolRef) -> Vec<u8>;

    // ── signatures ──
    fn signature_info(signature: SigId) -> SignatureInfo<'a>;
    fn return_type_of_signature(signature: SigId) -> TypeId;
    fn type_predicate_of_signature(signature: SigId) -> Option<TypePredicateData<'a>>;
    fn type_at_position(signature: SigId, index: u32) -> Option<TypeId>;
    fn deprecation_of_signature(signature: SigId) -> Option<&'a [u8]>;
    fn signature_to_string(signature: SigId) -> Vec<u8>;
}

/// The answers for a file that is not part of a checked program.
struct NoTypes;
impl Queries<'_> for NoTypes {}

/// The type checker, right after it has checked the file. What [`File::new`] takes.
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
    /// The type checker, if the file is part of a program that has been checked.
    #[inline]
    pub fn types(&'a self) -> Option<Types<'a>> {
        self.types.is_some().then_some(Types { file: self })
    }

    /// The same for a rule that [requires types](crate::rule::Meta::requires_types). On a file
    /// without types it answers everything with the error type, `None` and empty lists.
    #[inline]
    pub fn type_checker(&'a self) -> Types<'a> {
        Types { file: self }
    }

    /// Asks the type checker.
    #[inline]
    pub(crate) fn query<R>(&self, ask: impl FnOnce(&mut dyn Queries<'a>) -> R) -> R {
        match self.types.as_ref().map(|checker| checker.queries.try_borrow_mut()) {
            Some(Ok(mut queries)) => ask(&mut **queries),
            _ => ask(&mut NoTypes),
        }
    }

    /// The number that the program gives the file.
    #[inline]
    pub(crate) fn id_in_program(&self) -> FileId {
        self.types.as_ref().map_or(FileId(u32::MAX), |checker| checker.file)
    }
}

/// `ts.TypeChecker` and `ts.Program`: what is not asked of a node, a type, a symbol or a signature.
///
/// Every method of `ts.TypeChecker` that rules use is here under its own name. Those that take a
/// handle first only forward to the method of that handle, which reads better.
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
    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    // ───────────────────────────── ts.Program ─────────────────────────────

    /// `program.getCompilerOptions()`
    #[inline]
    pub fn compiler_options(self) -> CompilerOptions {
        self.file.types.as_ref().map(|checker| checker.options).unwrap_or_default()
    }

    /// `program.getCurrentDirectory()`
    pub fn get_current_directory(self) -> &'a [u8] {
        self.file.query(|q| q.current_directory())
    }

    /// `program.getSourceFile(fileName)`
    pub fn get_source_file(self, file_name: &[u8]) -> Option<SourceFile<'a>> {
        let id = self.file.query(|q| q.source_file(file_name))?;
        Some(SourceFile::new(self.file, id))
    }

    /// The file that is linted, as a file of the program.
    pub fn source_file(self) -> SourceFile<'a> {
        SourceFile::new(self.file, self.file.id_in_program())
    }

    /// `ts.resolveModuleName(specifier, fileName, options, ts.sys).resolvedModule`, for a specifier
    /// that an import or an export of the file names.
    pub fn resolve_module_name(self, specifier: &[u8]) -> Option<SourceFile<'a>> {
        let id = self.file.query(|q| q.resolve_module_name(specifier))?;
        Some(SourceFile::new(self.file, id))
    }

    /// `checker.getAmbientModules().find(it => it.name === '"name"')`: what `declare module "name"`
    /// declares. `name` is without the quotes.
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
        node.locate(self.file).get_type_at_location()
    }

    /// `checker.getSymbolAtLocation(node)`
    pub fn get_symbol_at_location(self, node: impl Locate<'a>) -> Option<TsSymbol<'a>> {
        node.locate(self.file).get_symbol_at_location()
    }

    /// `checker.getTypeFromTypeNode(node)`
    pub fn get_type_from_type_node(self, node: impl Locate<'a>) -> Type<'a> {
        node.locate(self.file).get_type_from_type_node()
    }

    /// `checker.getContextualType(node)`
    pub fn get_contextual_type(self, node: impl Locate<'a>) -> Option<Type<'a>> {
        node.locate(self.file).get_contextual_type()
    }

    /// `checker.getContextualTypeForArgumentAtIndex(call, index)`
    pub fn get_contextual_type_for_argument_at_index(
        self,
        call: impl Locate<'a>,
        index: usize,
    ) -> Option<Type<'a>> {
        call.locate(self.file).get_contextual_type_for_argument_at_index(index)
    }

    /// `checker.getResolvedSignature(node)`, for a call, a `new`, a tagged template, a decorator or
    /// a JSX element.
    pub fn get_resolved_signature(self, node: impl Locate<'a>) -> Option<Signature<'a>> {
        node.locate(self.file).get_resolved_signature()
    }

    /// `checker.getSignatureFromDeclaration(node)`
    pub fn get_signature_from_declaration(self, node: impl Locate<'a>) -> Option<Signature<'a>> {
        node.locate(self.file).get_signature_from_declaration()
    }

    /// `checker.getShorthandAssignmentValueSymbol(node)`: what the `a` of `{ a }` refers to.
    pub fn get_shorthand_assignment_value_symbol(self, node: impl Locate<'a>) -> Option<TsSymbol<'a>> {
        node.locate(self.file).get_shorthand_assignment_value_symbol()
    }

    /// `checker.getSymbolsInScope(node, meaning)`. To find one name, [`Types::resolve_name`] is
    /// much cheaper.
    pub fn get_symbols_in_scope(
        self,
        node: impl Locate<'a>,
        meaning: SymbolFlags,
    ) -> impl ExactSizeIterator<Item = TsSymbol<'a>> + 'a {
        let (file, node) = (self.file, node.locate(self.file).raw());
        let symbols = file.query(|q| q.symbols_in_scope(node, meaning));
        symbols.iter().map(move |&id| TsSymbol::new(file, id))
    }

    /// `checker.resolveName(name, node, meaning, excludeGlobals)`
    pub fn resolve_name(
        self,
        name: &[u8],
        node: impl Locate<'a>,
        meaning: SymbolFlags,
        exclude_globals: bool,
    ) -> Option<TsSymbol<'a>> {
        let node = node.locate(self.file).raw();
        let id = self.file.query(|q| q.resolve_name(node, name, meaning, exclude_globals))?;
        Some(TsSymbol::new(self.file, id))
    }

    /// The symbol of the program that a symbol of the file is, or is merged into.
    pub fn symbol_of(self, symbol: crate::semantic::Symbol<'a>) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.symbol_of_local(symbol.id()))?;
        Some(TsSymbol::new(self.file, id))
    }

    // ───────────────────────────── types that always exist ─────────────────────────────

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

    /// The declared type of the global class, interface or type alias `name` that has `arity` type
    /// parameters: `globalRegExpType` is `get_global_type(b"RegExp", 0)`.
    pub fn get_global_type(self, name: &[u8], arity: usize) -> Option<Type<'a>> {
        let id = self.file.query(|q| q.global_type(name, arity as u32))?;
        Some(Type::new(self.file, id))
    }

    /// `checker.getStringLiteralType(value)`
    pub fn get_string_literal_type(self, value: &[u8]) -> Type<'a> {
        Type::new(self.file, self.file.query(|q| q.string_literal_type(value)))
    }

    /// `checker.getNumberLiteralType(value)`
    pub fn get_number_literal_type(self, value: f64) -> Type<'a> {
        Type::new(self.file, self.file.query(|q| q.number_literal_type(value)))
    }

    /// `checker.getUnionType(types, reduction)`
    pub fn get_union_type(self, types: &[Type<'a>], reduction: UnionReduction) -> Type<'a> {
        let ids: smallvec::SmallVec<[TypeId; 8]> = types.iter().map(|ty| ty.id()).collect();
        Type::new(self.file, self.file.query(|q| q.union_type(&ids, reduction)))
    }

    /// `checker.getIntersectionType(types)`
    pub fn get_intersection_type(self, types: &[Type<'a>]) -> Type<'a> {
        let ids: smallvec::SmallVec<[TypeId; 8]> = types.iter().map(|ty| ty.id()).collect();
        Type::new(self.file, self.file.query(|q| q.intersection_type(&ids)))
    }

    // ───────────────────────────── the methods of ts.TypeChecker that are methods of a handle ─────────────────────────────

    /// `checker.typeToString(type)`
    pub fn type_to_string(self, ty: Type<'a>) -> Vec<u8> {
        ty.to_text()
    }

    /// `checker.isTypeAssignableTo(source, target)`
    pub fn is_type_assignable_to(self, source: Type<'a>, target: Type<'a>) -> bool {
        source.is_assignable_to(target)
    }

    /// `checker.isArrayType(type)`
    pub fn is_array_type(self, ty: Type<'a>) -> bool {
        ty.is_array_type()
    }

    /// `checker.isTupleType(type)`
    pub fn is_tuple_type(self, ty: Type<'a>) -> bool {
        ty.is_tuple_type()
    }

    /// `checker.isArrayLikeType(type)`
    pub fn is_array_like_type(self, ty: Type<'a>) -> bool {
        ty.is_array_like_type()
    }

    /// `checker.getTypeArguments(type)`
    pub fn get_type_arguments(self, ty: Type<'a>) -> ty::TypeList<'a> {
        ty.get_type_arguments()
    }

    /// `checker.getApparentType(type)`
    pub fn get_apparent_type(self, ty: Type<'a>) -> Type<'a> {
        ty.get_apparent_type()
    }

    /// `checker.getBaseConstraintOfType(type)`
    pub fn get_base_constraint_of_type(self, ty: Type<'a>) -> Option<Type<'a>> {
        ty.get_base_constraint_of_type()
    }

    /// `checker.getAwaitedType(type)`
    pub fn get_awaited_type(self, ty: Type<'a>) -> Option<Type<'a>> {
        ty.get_awaited_type()
    }

    /// `checker.getWidenedType(type)`
    pub fn get_widened_type(self, ty: Type<'a>) -> Type<'a> {
        ty.get_widened_type()
    }

    /// `checker.getBaseTypeOfLiteralType(type)`
    pub fn get_base_type_of_literal_type(self, ty: Type<'a>) -> Type<'a> {
        ty.get_base_type_of_literal_type()
    }

    /// `checker.getNonNullableType(type)`
    pub fn get_non_nullable_type(self, ty: Type<'a>) -> Type<'a> {
        ty.get_non_nullable_type()
    }

    /// `checker.getBaseTypes(type)`
    pub fn get_base_types(self, ty: Type<'a>) -> ty::TypeList<'a> {
        ty.get_base_types()
    }

    /// `checker.getPropertiesOfType(type)`
    pub fn get_properties_of_type(self, ty: Type<'a>) -> symbol::SymbolList<'a> {
        ty.get_properties()
    }

    /// `checker.getPropertyOfType(type, name)`
    pub fn get_property_of_type(self, ty: Type<'a>, name: &[u8]) -> Option<TsSymbol<'a>> {
        ty.get_property(name)
    }

    /// `checker.getTypeOfPropertyOfType(type, name)`
    pub fn get_type_of_property_of_type(self, ty: Type<'a>, name: &[u8]) -> Option<Type<'a>> {
        ty.get_type_of_property(name)
    }

    /// `checker.getIndexInfosOfType(type)`
    pub fn get_index_infos_of_type(self, ty: Type<'a>) -> impl ExactSizeIterator<Item = IndexInfo<'a>> + 'a {
        ty.get_index_infos()
    }

    /// `checker.getIndexInfoOfType(type, kind)`
    pub fn get_index_info_of_type(self, ty: Type<'a>, kind: IndexKind) -> Option<IndexInfo<'a>> {
        ty.get_index_info(kind)
    }

    /// `checker.getIndexTypeOfType(type, kind)`
    pub fn get_index_type_of_type(self, ty: Type<'a>, kind: IndexKind) -> Option<Type<'a>> {
        ty.get_index_info(kind).map(|info| info.ty())
    }

    /// `checker.getSignaturesOfType(type, kind)`
    pub fn get_signatures_of_type(self, ty: Type<'a>, kind: SignatureKind) -> signature::SignatureList<'a> {
        ty.get_signatures(kind)
    }

    /// `checker.getReturnTypeOfSignature(signature)`
    pub fn get_return_type_of_signature(self, signature: Signature<'a>) -> Type<'a> {
        signature.get_return_type()
    }

    /// `checker.getTypePredicateOfSignature(signature)`
    pub fn get_type_predicate_of_signature(self, signature: Signature<'a>) -> Option<TypePredicate<'a>> {
        signature.get_type_predicate()
    }

    /// `checker.getTypeOfSymbol(symbol)`
    pub fn get_type_of_symbol(self, symbol: TsSymbol<'a>) -> Type<'a> {
        symbol.get_type()
    }

    /// `checker.getTypeOfSymbolAtLocation(symbol, node)`
    pub fn get_type_of_symbol_at_location(self, symbol: TsSymbol<'a>, node: impl Locate<'a>) -> Type<'a> {
        symbol.get_type_at_location(node)
    }

    /// `checker.getDeclaredTypeOfSymbol(symbol)`
    pub fn get_declared_type_of_symbol(self, symbol: TsSymbol<'a>) -> Type<'a> {
        symbol.get_declared_type()
    }

    /// `checker.getAliasedSymbol(symbol)`
    pub fn get_aliased_symbol(self, symbol: TsSymbol<'a>) -> TsSymbol<'a> {
        symbol.get_aliased_symbol()
    }

    /// `checker.getImmediateAliasedSymbol(symbol)`
    pub fn get_immediate_aliased_symbol(self, symbol: TsSymbol<'a>) -> Option<TsSymbol<'a>> {
        symbol.get_immediate_aliased_symbol()
    }

    /// `checker.getExportSymbolOfSymbol(symbol)`
    pub fn get_export_symbol_of_symbol(self, symbol: TsSymbol<'a>) -> TsSymbol<'a> {
        symbol.get_export_symbol()
    }

    /// `checker.getExportsOfModule(symbol)`
    pub fn get_exports_of_module(self, symbol: TsSymbol<'a>) -> symbol::SymbolList<'a> {
        symbol.get_exports_of_module()
    }

    /// `checker.isUnknownSymbol(symbol)`
    pub fn is_unknown_symbol(self, symbol: TsSymbol<'a>) -> bool {
        symbol.is_unknown()
    }
}

/// The names of a program as they are written. The checker respells a `#x` so that it tells the
/// class that declares it.
struct WrittenNames<'i>(&'i dyn bun_sema::atom::Intern);

impl bun_sema::atom::Intern for WrittenNames<'_> {
    fn intern(&self, text: &[u8]) -> bun_sema::atom::Atom {
        self.0.intern(text)
    }
    fn bytes(&self, atom: bun_sema::atom::Atom) -> &[u8] {
        bun_sema::atom::written_name(self.0.bytes(atom))
    }
    fn number(&self) -> u64 {
        self.0.number()
    }
}

/// Calls `then` with `file` of the program that `checker` checks, with its types.
///
/// To be called right after `checker` has checked the file (`Request::after_file` of
/// `bun_sema_driver`), on the thread that did. A task of the checker that turns out invalid is run
/// again, so this can happen more than once for a file: the last time counts.
///
/// `read_library`: see [`ReadLibrary`]. It is asked when a rule wants to know whether something
/// that TypeScript's library declares is `@deprecated`.
///
/// `None`, without a call: the file is not one that can be linted. It is part of TypeScript's
/// library, or its tree is incomplete because the parser or the binder ran out of stack.
pub fn with_file<R>(
    checker: &mut bun_sema::check::Checker<'_, '_>,
    file: FileId,
    language: &crate::language::LanguageOptions,
    read_library: Option<ReadLibrary<'_>>,
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> Option<R> {
    let module = checker.p.files.module(file);
    let (hir, bound) = (checker.hir(file), checker.bound(file));
    if module.is_lib || hir.ran_out_of_stack || bound.ran_out_of_stack {
        return None;
    }
    let (path, atoms) = (module.file_name(), &WrittenNames(&checker.p.files.atoms));
    Some(checker.with_services(file, read_library, |services| {
        let types = Checker::new(services);
        then(&File::new(path, hir, bound, atoms, language, Some(types)))
    }))
}
