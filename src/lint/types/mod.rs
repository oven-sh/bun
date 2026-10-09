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
//! | `services.getTypeAtLocation(node)` | `node.ty()` on [`Expr`](crate::ast::Expr), [`Pat`](crate::ast::Pat), [`TypeNode`](crate::ast::TypeNode) and [`Node`](crate::ast::Node). `node.type_at_location()` on every handle but `Node`: on a [`Param`](crate::ast::Param), a [`VarDecl`](crate::ast::VarDecl) or a [`Member`](crate::ast::Member), `ty()` is the annotation that is written. [`Types::get_type_at_location`] |
//! | `services.getSymbolAtLocation(node)` | `node.ts_symbol()` on every handle |
//! | `services.esTreeNodeToTSNodeMap.get(node)` | `node.ts_node()`, [`Types::ts_node`] |
//! | `services.tsNodeToESTreeNodeMap.get(tsNode)` | [`TsNode::to_ast`] |
//! | the same for `node.id`, `node.key`, `node.property`, which are not nodes here | [`NameOf`]`(owner)`: `NameOf(member).ty()`, or the [`Ident`](crate::ast::Ident) itself: `types.get_type_at_location(ident)` |
//! | `checker.getContextualType(tsNode)` | [`Expr::contextual_type`](crate::ast::Expr::contextual_type) |
//! | `checker.getResolvedSignature(tsNode)` | [`Expr::resolved_signature`](crate::ast::Expr::resolved_signature) |
//! | `checker.getTypeFromTypeNode(tsNode)` | [`TypeNode::ty`](crate::ast::TypeNode::ty) |
//! | `checker.getSignatureFromDeclaration(tsNode)` | [`Func::signature`](crate::ast::Func::signature) |
//! | `getConstrainedTypeAtLocation(services, node)` | [`utils::get_constrained_type_at_location`] |
//!
//! # Where the rest is
//!
//! - A method of `ts.TypeChecker` that takes a node, a type, a symbol or a signature first is a
//!   method of that handle, [`TsNode`], [`Type`], [`TsSymbol`] or [`Signature`]:
//!   `checker.getApparentType(type)` is `type.get_apparent_type()`, `checker.getTypeOfSymbol(symbol)`
//!   is `symbol.get_type()`.
//! - [`Types`] has what is asked of none of them: the compiler options, the types that always
//!   exist, the symbols in scope.
//! - `ts-api-utils` is [`tsutils`].
//! - `@typescript-eslint/type-utils`, and what in `eslint-plugin/src/util` needs types, is [`utils`].
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
//!
//! # Where the answers are not those of TypeScript 6
//!
//! The checker follows TypeScript 7 (typescript-go). typescript-eslint runs on TypeScript 6 today.
//! What the oracles in `test/cli/lint/oracle/types` find to differ, all of it known:
//!
//! - [`Type::to_text`]: the order of the constituents of a union, which is sorted and does not
//!   depend on what was checked before. Where a long type is cut off. `typeof f` for a function
//!   with expando members.
//! - [`Type::get_properties`] is in the order of the declarations, own before inherited.
//!   TypeScript 7 sorts, TypeScript 6 has the order of insertion. Nothing should depend on it.
//! - [`Signature::to_text`] has the `new` of a construct signature without being told.
//! - [`Expr::resolved_signature`](crate::ast::Expr::resolved_signature) is `None` for a call of what is `any`, where
//!   TypeScript has a signature without parameters that returns `any`. That of an optional call
//!   returns what the function returns, without the `undefined` of the chain.
//! - A union has one `undefined` where TypeScript 6 can have the missing type beside it.
//! - [`TsNode`]: tokens, `ParenthesizedType` and `EndOfFileToken` are not nodes.
//!   [`TsNode::span`] and [`TsNode::get_source_text`] are empty in the default library, whose text
//!   is not kept.
//! - [`SourceFile::package_name`] also answers for a file of a package that only a
//!   `/// <reference path>` leads to, for which TypeScript knows no package.
//! - JavaScript: a function with `this.x = ..` and `F.prototype.y = ..` is no class.
//! - Code with type errors: `F.prototype = {}` in a TypeScript file is an expando member. The
//!   parameters of a function in an argument of a call that no overload matches have their types
//!   from the last candidate. `const c = new C(() => c.x)` is no circularity.

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
    /// Whether references in the file have the error type because a function or module body is too
    /// large for control flow analysis (2563).
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
    fn type_from_type_node(node: NodeRef) -> TypeId;
    fn contextual_type(node: NodeRef) -> Option<TypeId>;
    fn apparent_type_of_contextual_type(node: NodeRef) -> Option<TypeId>;
    fn contextual_type_for_argument_at_index(call: NodeRef, index: u32) -> Option<TypeId>;
    fn resolved_signature(call: NodeRef) -> Option<SigId>;
    fn signature_from_declaration(node: NodeRef) -> Option<SigId>;
    fn shorthand_assignment_value_symbol(node: NodeRef) -> Option<SymbolRef>;
    fn symbols_in_scope(node: NodeRef, meaning: SymbolFlags) -> &'a [SymbolRef];
    fn symbol_in_scope(node: NodeRef, meaning: SymbolFlags, name: &[u8]) -> Option<SymbolRef>;
    fn resolve_name(node: NodeRef, name: &[u8], meaning: SymbolFlags, exclude_globals: bool) -> Option<SymbolRef>;
    fn accessed_property_name(node: NodeRef) -> Option<&'a [u8]>;
    fn constant_value(node: NodeRef) -> Option<LiteralValue<'a>>;
    fn is_const_context(node: NodeRef) -> bool;
    fn flow_type_of_reference(node: NodeRef, declared: TypeId) -> TypeId;
    fn context_free_type_of_expression(node: NodeRef) -> TypeId;
    fn context_free_type_of_call_resolved_afresh(node: NodeRef) -> TypeId;
    fn type_with_default(ty: TypeId, default: NodeRef) -> TypeId;
    fn symbol_of_local(symbol: bun_sema::bind::SymbolId) -> Option<SymbolRef>;

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
        match self
            .types
            .as_ref()
            .map(|checker| checker.queries.try_borrow_mut())
        {
            Some(Ok(mut queries)) => ask(&mut **queries),
            _ => ask(&mut NoTypes),
        }
    }

    /// Whether a function or module body of the file is too large for control flow analysis (2563), as far as
    /// the check of the file and the questions of the rules have come across it: to be asked when the rules
    /// have run. Every reference that would be narrowed has the error type from then on, so what the rules
    /// that need types say about the file can be wrong or incomplete.
    pub fn is_too_large_for_flow_analysis(&self) -> bool {
        self.query(|it| it.was_flow_analysis_ever_disabled())
    }

    /// The number that the program gives the file.
    #[inline]
    pub(crate) fn id_in_program(&self) -> FileId {
        self.types
            .as_ref()
            .map_or(FileId(u32::MAX), |checker| checker.file)
    }
}

/// `ts.TypeChecker` and `ts.Program`: what is not asked of a node, a type, a symbol or a signature.
/// What is, is a method of [`TsNode`], [`Type`], [`TsSymbol`] or [`Signature`].
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

    /// `checker.getSymbolsInScope(node, meaning).find(it => it.name === name)`, which does not make
    /// the list. It is not `checker.resolveName(..)`: an alias counts for what it is, not for what it
    /// is an alias of.
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

    /// `checker.getSymbolsInScope(node, meaning)`, with all the globals. To find one name:
    /// [`Types::get_symbol_in_scope`].
    pub fn get_symbols_in_scope(
        self,
        node: impl Locate<'a>,
        meaning: SymbolFlags,
    ) -> impl ExactSizeIterator<Item = TsSymbol<'a>> + 'a {
        let (file, node) = (self.file, node.locate(self.file).raw());
        let symbols = file.query(|q| q.symbols_in_scope(node, meaning));
        symbols.iter().map(move |&id| TsSymbol::new(file, id))
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
}

/// The names of a program as they are written. The checker respells a `#x` so that it tells the
/// class that declares it.
struct WrittenNames<'i>(&'i dyn bun_sema::atom::Intern);

impl bun_sema::atom::Intern for WrittenNames<'_> {
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
    fn of_this_thread(&self) -> &dyn bun_sema::atom::Intern {
        self
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
    with_file_and_modules(
        checker,
        file,
        None,
        language,
        read_library,
        None,
        None,
        then,
    )
}

/// The same, for a file that has [`File::modules`] and [`File::formatter`]. `path`: [`File::path`], the path that the file is
/// linted under. `None`: the name that the program has for it, which is in the checker's format (`/C:/a.ts`) and spelled as the
/// program found it.
pub fn with_file_and_modules<R>(
    checker: &mut bun_sema::check::Checker<'_, '_>,
    file: FileId,
    path: Option<&[u8]>,
    language: &crate::language::LanguageOptions,
    read_library: Option<ReadLibrary<'_>>,
    modules: Option<&dyn crate::modules::Modules>,
    formatter: Option<&dyn crate::formats::Formats>,
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> Option<R> {
    let module = checker.p.files.module(file);
    let (hir, bound) = (checker.hir(file), checker.bound(file));
    if module.is_lib || hir.ran_out_of_stack || bound.ran_out_of_stack {
        return None;
    }
    let path = path.unwrap_or_else(|| module.file_name());
    let atoms = &WrittenNames(&checker.p.files.atoms);
    Some(checker.with_services(file, read_library, |services| {
        let types = Checker::new(services);
        let file = File::new(path, hir, bound, atoms, language, Some(types));
        if let Some(modules) = modules {
            file.set_modules(modules);
        }
        if let Some(formatter) = formatter {
            file.set_formatter(formatter, None);
        }
        then(&file)
    }))
}
