// checker/types.go: the flag sets of the checker, the ids of its records and their stores, the links records, Type and its data, Signature, TypePredicate, IndexInfo and Ternary. A pointer of upstream is an id, an embedded struct is the first field of its record, and a method that follows a pointer is a method of the checker.
use crate::ast::{Id, NodeId, OPEN_BIT, SymbolFlags, SymbolId, SymbolTableId};
use crate::checker::{CacheHashKey, Checker, IntersectionState, is_tuple_type, value_to_string};
use crate::collections::OrderedSet;
use crate::core::{List, Map, ScriptTarget, Text, Tristate};
use crate::evaluator;
use crate::jsnum::PseudoBigInt;
use std::cell::Cell;
use std::marker::PhantomData;
use std::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, Deref, DerefMut, Index, IndexMut};

// A flag set or an iota kind of package checker with upstream's values. The values are ordered as numbers, which upstream compares with `<`.
macro_rules! checker_flags {
    ($name:ident : $repr:ty { $($body:tt)* }) => {
        $crate::ast::flags::define_flags!($name: $repr { $($body)* });

        impl ::std::cmp::PartialOrd for $name {
            #[inline]
            fn partial_cmp(&self, other: &Self) -> Option<::std::cmp::Ordering> {
                Some(self.cmp(other))
            }
        }

        impl ::std::cmp::Ord for $name {
            #[inline]
            fn cmp(&self, other: &Self) -> ::std::cmp::Ordering {
                self.0.cmp(&other.0)
            }
        }
    };
}
pub(crate) use checker_flags;

// ParseFlags

checker_flags!(ParseFlags: u32 {
    YIELD = 1 << 0,
    AWAIT = 1 << 1,
    TYPE = 1 << 2,
    IGNORE_MISSING_OPEN_BRACE = 1 << 4,
    JSDOC = 1 << 5,
});

checker_flags!(SignatureKind: i32 {
    CALL = 0,
    CONSTRUCT = 1,
});

checker_flags!(MemberOverrideStatus: i32 {
    NEEDS_OVERRIDE = 1,
    HAS_INVALID_OVERRIDE = 2,
});

checker_flags!(ContextFlags: u32 {
    SIGNATURE = 1 << 0, // Obtaining contextual signature
    NO_CONSTRAINTS = 1 << 1, // Don't obtain type variable constraints
    IGNORE_NODE_INFERENCES = 1 << 2, // Ignore inference to current node and parent nodes out to the containing call for, for example, completions
    SKIP_BINDING_PATTERNS = 1 << 3, // Ignore contextual types applied by binding patterns
});

checker_flags!(TypeFormatFlags: u32 {
    NO_TRUNCATION = 1 << 0, // Don't truncate typeToString result
    WRITE_ARRAY_AS_GENERIC_TYPE = 1 << 1, // Write Array<T> instead T[]
    GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS = 1 << 2, // When a type parameter T is shadowing another T, generate a name for it so it can still be referenced
    USE_STRUCTURAL_FALLBACK = 1 << 3, // When an alias cannot be named by its symbol, rather than report an error, fallback to a structural printout if possible
    // hole because there's a hole in node builder flags
    WRITE_TYPE_ARGUMENTS_OF_SIGNATURE = 1 << 5, // Write the type arguments instead of type parameters of the signature
    USE_FULLY_QUALIFIED_TYPE = 1 << 6, // Write out the fully qualified type name (eg. Module.Type, instead of Type)
    // hole because `UseOnlyExternalAliasing` is here in node builder flags, but functions which take old flags use `SymbolFormatFlags` instead
    SUPPRESS_ANY_RETURN_TYPE = 1 << 8, // If the return type is any-like, don't offer a return type.
    // hole because `WriteTypeParametersInQualifiedName` is here in node builder flags, but functions which take old flags use `SymbolFormatFlags` for this instead
    MULTILINE_OBJECT_LITERALS = 1 << 10, // Always print object literals across multiple lines (only used to map into node builder flags)
    WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL = 1 << 11, // Write a type literal instead of (Anonymous class)
    USE_TYPE_OF_FUNCTION = 1 << 12, // Write typeof instead of function type literal
    OMIT_PARAMETER_MODIFIERS = 1 << 13, // Omit modifiers on parameters
    USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE = 1 << 14, // For a `type T = ... ` defined in a different file, write `T` instead of its value, even though `T` can't be accessed in the current scope.
    USE_SINGLE_QUOTES_FOR_STRING_LITERAL_TYPE = 1 << 28, // Use single quotes for string literal type
    NO_TYPE_REDUCTION = 1 << 29, // Don't call getReducedType
    USE_INSTANTIATION_EXPRESSIONS = 1 << 30, // Use instantiation expressions for qualified instantiated names like Foo<string>.Bar
    OMIT_THIS_PARAMETER = 1 << 25,
    WRITE_CALL_STYLE_SIGNATURE = 1 << 27, // Write construct signatures as call style signatures
    // Error Handling
    ALLOW_UNIQUE_ES_SYMBOL_TYPE = 1 << 20, // This is bit 20 to align with the same bit in `NodeBuilderFlags`
    // TypeFormatFlags exclusive
    ADD_UNDEFINED = 1 << 17, // Add undefined to types of initialized, non-optional parameters
    WRITE_ARROW_STYLE_SIGNATURE = 1 << 18, // Write arrow style signature
    // State
    IN_ARRAY_TYPE = 1 << 19, // Writing an array element type
    IN_ELEMENT_TYPE = 1 << 21, // Writing an array or union element type
    IN_FIRST_TYPE_ARGUMENT = 1 << 22, // Writing first type argument of the instantiated type
    IN_TYPE_ALIAS = 1 << 23, // Writing type in type alias declaration
    NODE_BUILDER_FLAGS_MASK = Self::NO_TRUNCATION.0 | Self::WRITE_ARRAY_AS_GENERIC_TYPE.0 | Self::GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS.0 | Self::USE_STRUCTURAL_FALLBACK.0 | Self::WRITE_TYPE_ARGUMENTS_OF_SIGNATURE.0
        | Self::USE_FULLY_QUALIFIED_TYPE.0 | Self::SUPPRESS_ANY_RETURN_TYPE.0 | Self::MULTILINE_OBJECT_LITERALS.0 | Self::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL.0
        | Self::USE_TYPE_OF_FUNCTION.0 | Self::OMIT_PARAMETER_MODIFIERS.0 | Self::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE.0 | Self::ALLOW_UNIQUE_ES_SYMBOL_TYPE.0 | Self::IN_TYPE_ALIAS.0
        | Self::USE_INSTANTIATION_EXPRESSIONS.0
        | Self::USE_SINGLE_QUOTES_FOR_STRING_LITERAL_TYPE.0 | Self::NO_TYPE_REDUCTION.0 | Self::OMIT_THIS_PARAMETER.0,
});

checker_flags!(SymbolFormatFlags: u32 {
    // Write symbols's type argument if it is instantiated symbol eg. class C<T> { p: T }   <-- Show p as C<T>.p here var a: C<number>; var p = a.p; <--- Here p is property of C<number> so show it as C<number>.p instead of just C.p
    WRITE_TYPE_PARAMETERS_OR_ARGUMENTS = 1 << 0,
    // Use only external alias information to get the symbol name in the given context eg.  module m { export class c { } } import x = m.c; When this flag is specified m.c will be used to refer to the class instead of alias symbol x
    USE_ONLY_EXTERNAL_ALIASING = 1 << 1,
    // Build symbol name using any nodes needed, instead of just components of an entity name
    ALLOW_ANY_NODE_KIND = 1 << 2,
    // Prefer aliases which are not directly visible
    USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE = 1 << 3,
    // { [E.A]: 1 }
    WRITE_COMPUTED_PROPS = 1 << 4,
    // Skip building an accessible symbol chain
    DO_NOT_INCLUDE_SYMBOL_CHAIN = 1 << 5,
});

checker_flags!(ExternalEmitHelpers: u32 {
    REST = 1 << 0, // __rest (used by ESNext object rest transformation)
    DECORATE = 1 << 1, // __decorate (used by TypeScript decorators transformation)
    METADATA = 1 << 2, // __metadata (used by TypeScript decorators transformation)
    PARAM = 1 << 3, // __param (used by TypeScript decorators transformation)
    AWAITER = 1 << 4, // __awaiter (used by ES2017 async functions transformation)
    AWAIT = 1 << 5, // __await (used by ES2017 async generator transformation)
    ASYNC_GENERATOR = 1 << 6, // __asyncGenerator (used by ES2017 async generator transformation)
    ASYNC_DELEGATOR = 1 << 7, // __asyncDelegator (used by ES2017 async generator yield* transformation)
    ASYNC_VALUES = 1 << 8, // __asyncValues (used by ES2017 for..await..of transformation)
    EXPORT_STAR = 1 << 9, // __exportStar (used by CommonJS/AMD/UMD module transformation)
    IMPORT_STAR = 1 << 10, // __importStar (used by CommonJS/AMD/UMD module transformation)
    IMPORT_DEFAULT = 1 << 11, // __importDefault (used by CommonJS/AMD/UMD module transformation)
    MAKE_TEMPLATE_OBJECT = 1 << 12, // __makeTemplateObject (used for constructing template string array objects)
    CLASS_PRIVATE_FIELD_GET = 1 << 13, // __classPrivateFieldGet (used by the class private field transformation)
    CLASS_PRIVATE_FIELD_SET = 1 << 14, // __classPrivateFieldSet (used by the class private field transformation)
    CLASS_PRIVATE_FIELD_IN = 1 << 15, // __classPrivateFieldIn (used by the class private field transformation)
    SET_FUNCTION_NAME = 1 << 16, // __setFunctionName (used by class fields and ECMAScript decorators)
    PROP_KEY = 1 << 17, // __propKey (used by class fields and ECMAScript decorators)
    ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES = 1 << 18, // __addDisposableResource and __disposeResources (used by ESNext transformations)
    REWRITE_RELATIVE_IMPORT_EXTENSION = 1 << 19, // __rewriteRelativeImportExtension (used by --rewriteRelativeImportExtensions)
    ES_DECORATE_AND_RUN_INITIALIZERS = Self::DECORATE.0, // __esDecorate and __runInitializers (used by ECMAScript decorators transformation)
    FIRST_EMIT_HELPER = Self::REST.0,
    LAST_EMIT_HELPER = Self::REWRITE_RELATIVE_IMPORT_EXTENSION.0,
    // Helpers included by ES2017 for..await..of
    FOR_AWAIT_OF_INCLUDES = Self::ASYNC_VALUES.0,
    // Helpers included by ES2017 async generators
    ASYNC_GENERATOR_INCLUDES = Self::AWAIT.0 | Self::ASYNC_GENERATOR.0,
    // Helpers included by yield* in ES2017 async generators
    ASYNC_DELEGATOR_INCLUDES = Self::AWAIT.0 | Self::ASYNC_DELEGATOR.0 | Self::ASYNC_VALUES.0,
});

pub const EXTERNAL_HELPERS_MODULE_NAME_TEXT: &[u8] = b"tslib";

// Ids

// The id of a record that one checker makes: the index of the record in the store of that checker. 0 is nil.
macro_rules! define_checker_id {
    ($($name:ident),* $(,)?) => {$(
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
        pub struct $name(pub u32);

        impl $name {
            pub const NIL: Self = Self(0);

            #[inline]
            pub const fn is_nil(self) -> bool {
                self.0 == 0
            }
        }

        impl Id for $name {
            #[inline]
            fn from_u32(v: u32) -> Self {
                Self(v)
            }
            #[inline]
            fn to_u32(self) -> u32 {
                self.0
            }
        }
    )*};
}

define_checker_id!(TypeId, SignatureId);

// The records that upstream names by pointer only: each has a store in the checker, and the id is the pointer.
define_checker_id!(
    TypeMapperId,
    TypeAliasId,
    IndexInfoId,
    TypePredicateId,
    ConditionalRootId,
    CompositeSignatureId,
    WideningContextId,
    InferenceContextId,
    InferenceInfoId,
    InferenceStateId,
    RelaterId,
    ErrorChainId,
    FlowStateId,
);

// The records of one id space, owned by one checker. Slot 0 is the nil record: a read through nil or through an id that names nothing gives the zero record, a write lands in a scratch record, and both are counted, where upstream panics.
pub struct Records<I, T> {
    items: Vec<T>,
    sink: T,
    nil_reads: Cell<u32>,
    nil_writes: u32,
    marker: PhantomData<fn() -> I>,
}

impl<I: Id, T: Default> Default for Records<I, T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<I: Id, T: Default> Records<I, T> {
    pub fn new() -> Self {
        Self {
            items: vec![T::default()],
            sink: T::default(),
            nil_reads: Cell::new(0),
            nil_writes: 0,
            marker: PhantomData,
        }
    }

    // The number of records, the nil record not counted.
    pub fn count(&self) -> u32 {
        u32::try_from(self.items.len().saturating_sub(1)).unwrap_or(u32::MAX)
    }

    // The id of the new record: nil once the id space is used up.
    pub fn alloc(&mut self, value: T) -> I {
        match u32::try_from(self.items.len()) {
            Ok(index) if index < OPEN_BIT => {
                self.items.push(value);
                I::from_u32(index)
            }
            _ => I::from_u32(0),
        }
    }

    pub fn is_valid(&self, id: I) -> bool {
        let index = id.to_u32() as usize;
        index != 0 && index < self.items.len()
    }

    pub fn get(&self, id: I) -> &T {
        let index = id.to_u32() as usize;
        match self.items.get(index) {
            Some(value) if index != 0 => value,
            _ => {
                self.nil_reads.set(self.nil_reads.get().saturating_add(1));
                self.items.first().unwrap_or(&self.sink)
            }
        }
    }

    pub fn get_mut(&mut self, id: I) -> &mut T {
        let index = id.to_u32() as usize;
        match self.items.get_mut(index) {
            Some(value) if index != 0 => value,
            _ => {
                self.nil_writes = self.nil_writes.saturating_add(1);
                self.sink = T::default();
                &mut self.sink
            }
        }
    }

    // Forgets every record and keeps the storage.
    pub fn clear(&mut self) {
        self.items.truncate(1);
    }

    pub fn nil_reads(&self) -> u32 {
        self.nil_reads.get()
    }

    pub fn nil_writes(&self) -> u32 {
        self.nil_writes
    }

    // The reads and writes that upstream would have died of.
    pub fn nil_accesses(&self) -> u32 {
        self.nil_reads.get().saturating_add(self.nil_writes)
    }
}

impl<I: Id, T: Default> Index<I> for Records<I, T> {
    type Output = T;

    #[inline]
    fn index(&self, id: I) -> &T {
        self.get(id)
    }
}

impl<I: Id, T: Default> IndexMut<I> for Records<I, T> {
    #[inline]
    fn index_mut(&mut self, id: I) -> &mut T {
        self.get_mut(id)
    }
}

// `s[lo:hi]` of a list that a record keeps: the bounds are clamped where upstream panics, and the nil list stays nil.
fn sub_list<'a, T: Copy + Default>(list: List<'a, T>, lo: isize, hi: isize) -> List<'a, T> {
    if list.is_nil() {
        return List::NIL;
    }
    let items = list.as_slice();
    let hi = usize::try_from(hi).unwrap_or(0).min(items.len());
    let lo = usize::try_from(lo).unwrap_or(0).min(hi);
    List::from_slice(items.get(lo..hi).unwrap_or(&[]))
}

// Links for referenced symbols

#[derive(Default)]
pub struct SymbolReferenceLinks {
    pub reference_kinds: SymbolFlags, // Flags for the meanings of the symbol that were referenced
}

// Links for value symbols

#[derive(Default)]
pub struct ValueSymbolLinks {
    pub resolved_type: TypeId, // Type of value symbol
    pub write_type: TypeId,
    pub target: SymbolId,
    pub mapper: TypeMapperId,
    pub name_type: TypeId,
    pub containing_type: TypeId, // Mapped type for mapped type property, containing union or intersection type for synthetic property
    pub function_or_constructor_checked: bool,
}

// Additional links for mapped symbols

#[derive(Default)]
pub struct MappedSymbolLinks {
    pub key_type: TypeId,           // Key type for mapped type member
    pub synthetic_origin: SymbolId, // For a property on a mapped or spread type, points back to the original property
}

// Additional links for deferred type symbols

#[derive(Default)]
pub struct DeferredSymbolLinks<'a> {
    pub parent: TypeId,                 // Source union/intersection of a deferred type
    pub constituents: List<'a, TypeId>, // Calculated list of constituents for a deferred type
    pub write_constituents: List<'a, TypeId>, // Constituents of a deferred `writeType`
}

// Links for alias symbols

#[derive(Default)]
pub struct AliasSymbolLinks {
    pub immediate_target: SymbolId, // Immediate target of an alias. May be another alias. Do not access directly, use `checker.getImmediateAliasedSymbol` instead.
    pub alias_target: SymbolId,     // Resolved (non-alias) target of an alias
    pub referenced: bool, // True if alias symbol has been referenced as a value that can be emitted
    pub type_only_declaration: NodeId, // First resolved alias declaration that makes the symbol only usable in type constructs
}

// Links for module symbols

#[derive(Default)]
pub struct ModuleSymbolLinks<'a> {
    pub resolved_exports: SymbolTableId, // Resolved exports of module or combined early- and late-bound static members of a class.
    pub type_only_export_star_map: Map<Text<'a>, NodeId>, // Set on a module symbol when some of its exports were resolved through a 'export type * from "mod"' declaration
    pub exports_checked: bool,
}

#[derive(Default)]
pub struct ReverseMappedSymbolLinks {
    pub property_type: TypeId,
    pub mapped_type: TypeId,     // References a mapped type
    pub constraint_type: TypeId, // References an index type
}

// Links for late-bound symbols

#[derive(Default)]
pub struct LateBoundLinks {
    pub late_symbol: SymbolId,
}

// Links for export type symbols

#[derive(Default)]
pub struct ExportTypeLinks {
    pub target: SymbolId,           // Target symbol
    pub originating_import: NodeId, // Import declaration which produced the symbol, present if the symbol is marked as uncallable but had call signatures in `resolveESModuleSymbol`
}

// Links for type aliases

#[derive(Default)]
pub struct TypeAliasLinks<'a> {
    pub declared_type: TypeId,
    pub type_parameters: List<'a, TypeId>, // Type parameters of type alias (undefined if non-generic)
    pub instantiations: Map<CacheHashKey, TypeId>, // Instantiations of generic type alias (undefined if non-generic)
    pub is_constructor_declared_property: bool,
}

// Links for declared types (type parameters, class types, interface types, enums)

#[derive(Default)]
pub struct DeclaredTypeLinks {
    pub declared_type: TypeId,
    pub interface_checked: bool,
    pub index_signatures_checked: bool,
    pub type_parameters_checked: bool,
    pub enum_checked: bool,
}

// Links for switch clauses

checker_flags!(ExhaustiveState: u8 {
    UNKNOWN = 0, // Exhaustive state not computed
    COMPUTING = 1, // Exhaustive state computation in progress
    FALSE = 2, // Switch statement is not exhaustive
    TRUE = 3, // Switch statement is exhaustive
});

#[derive(Default)]
pub struct SwitchStatementLinks<'a> {
    pub exhaustive_state: ExhaustiveState, // Switch statement exhaustiveness
    pub switch_types_computed: bool,
    pub witnesses_computed: bool,
    pub switch_types: List<'a, TypeId>,
    pub witnesses: List<'a, Text<'a>>,
}

#[derive(Default)]
pub struct ArrayLiteralLinks {
    pub indices_computed: bool,
    pub first_spread_index: isize, // Index of first spread expression (or -1 if none)
    pub last_spread_index: isize,  // Index of last spread expression (or -1 if none)
}

// Links for late-binding containers

checker_flags!(MembersOrExportsResolutionKind: isize {
    RESOLVED_EXPORTS = 0,
    RESOLVED_MEMBERS = 1,
});

// Indexed by MembersOrExportsResolutionKind
#[derive(Default)]
pub struct MembersAndExportsLinks(pub [SymbolTableId; 2]);

// Links for synthetic spread properties

#[derive(Default)]
pub struct SpreadLinks {
    pub left_spread: SymbolId,  // Left source for synthetic spread property
    pub right_spread: SymbolId, // Right source for synthetic spread property
}

// Links for variances of type aliases and interface types

#[derive(Default)]
pub struct VarianceLinks<'a> {
    pub variances: List<'a, VarianceFlags>,
}

checker_flags!(VarianceFlags: u32 {
    INVARIANT = 0, // Neither covariant nor contravariant
    COVARIANT = 1 << 0, // Covariant
    CONTRAVARIANT = 1 << 1, // Contravariant
    BIVARIANT = Self::COVARIANT.0 | Self::CONTRAVARIANT.0, // Both covariant and contravariant
    INDEPENDENT = 1 << 2, // Unwitnessed type parameter
    VARIANCE_MASK = Self::INVARIANT.0 | Self::COVARIANT.0 | Self::CONTRAVARIANT.0 | Self::INDEPENDENT.0, // Mask containing all measured variances without the unmeasurable flag
    UNMEASURABLE = 1 << 3, // Variance result is unusable - relationship relies on structural comparisons which are not reflected in generic relationships
    UNRELIABLE = 1 << 4, // Variance result is unreliable - checking may produce false negatives, but not false positives
    ALLOWS_STRUCTURAL_FALLBACK = Self::UNMEASURABLE.0 | Self::UNRELIABLE.0,
});

#[derive(Default)]
pub struct MarkedAssignmentSymbolLinks {
    pub last_assignment_pos: i32,
    pub has_definite_assignment: bool, // Symbol is definitely assigned somewhere
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct AccessibleChainCacheKey {
    pub use_only_external_aliasing: bool,
    pub location: NodeId,
    pub meaning: SymbolFlags,
}

impl PartialOrd for AccessibleChainCacheKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AccessibleChainCacheKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        let key = |k: &Self| (k.use_only_external_aliasing, k.location, k.meaning.bits());
        key(self).cmp(&key(other))
    }
}

// `extended_containers` is `*[]*ast.Symbol` upstream: None is the list that is not computed yet, and a nil list is a result.
#[derive(Default)]
pub struct ContainingSymbolLinks<'a> {
    pub extended_containers_by_file: Map<NodeId, List<'a, SymbolId>>, // Symbols of nodes which which logically contain this one, cached by file the request is made within
    pub extended_containers: Option<List<'a, SymbolId>>, // Containers (other than the parent) which this symbol is aliased in
    pub accessible_chain_cache: Map<AccessibleChainCacheKey, List<'a, SymbolId>>,
}

checker_flags!(AccessFlags: u32 {
    INCLUDE_UNDEFINED = 1 << 0,
    NO_INDEX_SIGNATURES = 1 << 1,
    WRITING = 1 << 2,
    CACHE_SYMBOL = 1 << 3,
    ALLOW_MISSING = 1 << 4,
    EXPRESSION_POSITION = 1 << 5,
    REPORT_DEPRECATED = 1 << 6,
    SUPPRESS_NO_IMPLICIT_ANY_ERROR = 1 << 7,
    CONTEXTUAL = 1 << 8,
    PERSISTENT = Self::INCLUDE_UNDEFINED.0,
});

checker_flags!(NodeCheckFlags: u32 {
    TYPE_CHECKED = 1 << 0, // Node has been type checked
    CONTEXT_CHECKED = 1 << 6, // Contextual types have been assigned
    ENUM_VALUES_COMPUTED = 1 << 10, // Values for enum members have been computed, and any errors have been reported for them.
    ASSIGNMENTS_MARKED = 1 << 17, // Parameter assignments have been marked
    CONTAINS_CLASS_WITH_PRIVATE_IDENTIFIERS = 1 << 20, // Marked on all block-scoped containers containing a class with private identifiers.
    CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER = 1 << 21, // Marked on all block-scoped containers containing a static initializer with 'super.x' or 'super[x]'.
    IN_CHECK_IDENTIFIER = 1 << 22,
    INITIALIZER_IS_UNDEFINED = 1 << 24,
    INITIALIZER_IS_UNDEFINED_COMPUTED = 1 << 25,
});

// Common links

#[derive(Default)]
pub struct NodeLinks {
    pub flags: NodeCheckFlags, // Set of flags specific to Node
    pub declaration_requires_scope_change: Tristate, // Set by `useOuterVariableScopeInParameter` in checker when downlevel emit would change the name resolution scope inside of a parameter.
    pub has_reported_statement_in_ambient_context: bool, // Cache boolean if we report statements in ambient context
}

#[derive(Default)]
pub struct SymbolNodeLinks {
    pub resolved_symbol: SymbolId, // Resolved symbol associated with node
}

#[derive(Default)]
pub struct TypeNodeLinks<'a> {
    pub resolved_type: TypeId, // Resolved type associated with node
    pub outer_type_parameters: List<'a, TypeId>, // Outer type parameters of anonymous object type
}

// `has_name` is `*bool` upstream: None is the answer that is not computed yet.
#[derive(Default)]
pub struct ComputedNameNodeLinks<'a> {
    pub has_name: Option<bool>, // If the node has a computable name
    pub name: Text<'a>,         // Resolved name associated with the type of the node
}

// Links for enum members

#[derive(Default)]
pub struct EnumMemberLinks<'a> {
    pub value: evaluator::Result<'a>, // Constant value of enum member
}

// Links for assertion expressions

#[derive(Default)]
pub struct AssertionLinks {
    pub expr_type: TypeId, // Assertion expression type
}

// SourceFile links

#[derive(Default)]
pub struct SourceFileLinks<'a> {
    pub type_checked: bool,
    pub unused_checked: bool,
    pub external_helpers_module: SymbolId,
    pub requested_external_emit_helpers: ExternalEmitHelpers,
    pub deferred_nodes: OrderedSet<NodeId>,
    pub identifier_check_nodes: Vec<NodeId>,
    pub local_jsx_namespace: Text<'a>,
    pub local_jsx_fragment_namespace: Text<'a>,
    pub local_jsx_factory: NodeId,
    pub local_jsx_fragment_factory: NodeId,
    pub jsx_fragment_type: TypeId,
}

// Signature specific links

#[derive(Default)]
pub struct SignatureLinks {
    pub resolved_signature: SignatureId, // Cached signature of signature node or call expression
    pub effects_signature: SignatureId,  // Signature with possible control flow effects
    pub decorator_signature: SignatureId, // Signature for decorator as if invoked by the runtime
}

// Note that for types of different kinds, the numeric values of TypeFlags determine the order computed by the CompareTypes function and therefore the order of constituent types in union types. Since union type processing often bails out early when a result is known, it is important to order TypeFlags in increasing order of potential type complexity. In particular, indexed access and conditional types should sort last as those types are potentially recursive and possibly infinite.

checker_flags!(TypeFlags: u32 {
    ANY = 1 << 0,
    UNKNOWN = 1 << 1,
    UNDEFINED = 1 << 2,
    NULL = 1 << 3,
    VOID = 1 << 4,
    STRING = 1 << 5,
    NUMBER = 1 << 6,
    BIG_INT = 1 << 7,
    BOOLEAN = 1 << 8,
    ES_SYMBOL = 1 << 9, // Type of symbol primitive introduced in ES6
    STRING_LITERAL = 1 << 10,
    NUMBER_LITERAL = 1 << 11,
    BIG_INT_LITERAL = 1 << 12,
    BOOLEAN_LITERAL = 1 << 13,
    UNIQUE_ES_SYMBOL = 1 << 14, // unique symbol
    ENUM_LITERAL = 1 << 15, // Always combined with StringLiteral, NumberLiteral, or Union
    ENUM = 1 << 16, // Numeric computed enum member value (must be right after EnumLiteral, see getSortOrderFlags)
    NON_PRIMITIVE = 1 << 17, // intrinsic object type
    NEVER = 1 << 18, // Never type
    TYPE_PARAMETER = 1 << 19, // Type parameter
    OBJECT = 1 << 20, // Object type
    INDEX = 1 << 21, // keyof T
    TEMPLATE_LITERAL = 1 << 22, // Template literal type
    STRING_MAPPING = 1 << 23, // Uppercase/Lowercase type
    SUBSTITUTION = 1 << 24, // Type parameter substitution
    INDEXED_ACCESS = 1 << 25, // T[K]
    CONDITIONAL = 1 << 26, // T extends U ? X : Y
    UNION = 1 << 27, // Union (T | U)
    INTERSECTION = 1 << 28, // Intersection (T & U)
    RESERVED1 = 1 << 29, // Used by union/intersection type construction
    RESERVED2 = 1 << 30, // Used by union/intersection type construction
    RESERVED3 = 1 << 31,
    ANY_OR_UNKNOWN = Self::ANY.0 | Self::UNKNOWN.0,
    NULLABLE = Self::UNDEFINED.0 | Self::NULL.0,
    LITERAL = Self::STRING_LITERAL.0 | Self::NUMBER_LITERAL.0 | Self::BIG_INT_LITERAL.0 | Self::BOOLEAN_LITERAL.0,
    UNIT = Self::ENUM.0 | Self::LITERAL.0 | Self::UNIQUE_ES_SYMBOL.0 | Self::NULLABLE.0,
    FRESHABLE = Self::ENUM.0 | Self::LITERAL.0,
    STRING_OR_NUMBER_LITERAL = Self::STRING_LITERAL.0 | Self::NUMBER_LITERAL.0,
    STRING_OR_NUMBER_LITERAL_OR_UNIQUE = Self::STRING_LITERAL.0 | Self::NUMBER_LITERAL.0 | Self::UNIQUE_ES_SYMBOL.0,
    DEFINITELY_FALSY = Self::STRING_LITERAL.0 | Self::NUMBER_LITERAL.0 | Self::BIG_INT_LITERAL.0 | Self::BOOLEAN_LITERAL.0 | Self::VOID.0 | Self::UNDEFINED.0 | Self::NULL.0,
    POSSIBLY_FALSY = Self::DEFINITELY_FALSY.0 | Self::STRING.0 | Self::NUMBER.0 | Self::BIG_INT.0 | Self::BOOLEAN.0,
    INTRINSIC = Self::ANY.0 | Self::UNKNOWN.0 | Self::STRING.0 | Self::NUMBER.0 | Self::BIG_INT.0 | Self::ES_SYMBOL.0 | Self::VOID.0 | Self::UNDEFINED.0 | Self::NULL.0 | Self::NEVER.0 | Self::NON_PRIMITIVE.0,
    STRING_LIKE = Self::STRING.0 | Self::STRING_LITERAL.0 | Self::TEMPLATE_LITERAL.0 | Self::STRING_MAPPING.0,
    NUMBER_LIKE = Self::NUMBER.0 | Self::NUMBER_LITERAL.0 | Self::ENUM.0,
    BIG_INT_LIKE = Self::BIG_INT.0 | Self::BIG_INT_LITERAL.0,
    BOOLEAN_LIKE = Self::BOOLEAN.0 | Self::BOOLEAN_LITERAL.0,
    ENUM_LIKE = Self::ENUM.0 | Self::ENUM_LITERAL.0,
    ES_SYMBOL_LIKE = Self::ES_SYMBOL.0 | Self::UNIQUE_ES_SYMBOL.0,
    VOID_LIKE = Self::VOID.0 | Self::UNDEFINED.0,
    PRIMITIVE = Self::STRING_LIKE.0 | Self::NUMBER_LIKE.0 | Self::BIG_INT_LIKE.0 | Self::BOOLEAN_LIKE.0 | Self::ENUM_LIKE.0 | Self::ES_SYMBOL_LIKE.0 | Self::VOID_LIKE.0 | Self::NULL.0,
    DEFINITELY_NON_NULLABLE = Self::STRING_LIKE.0 | Self::NUMBER_LIKE.0 | Self::BIG_INT_LIKE.0 | Self::BOOLEAN_LIKE.0 | Self::ENUM_LIKE.0 | Self::ES_SYMBOL_LIKE.0 | Self::OBJECT.0 | Self::NON_PRIMITIVE.0,
    DISJOINT_DOMAINS = Self::NON_PRIMITIVE.0 | Self::STRING_LIKE.0 | Self::NUMBER_LIKE.0 | Self::BIG_INT_LIKE.0 | Self::BOOLEAN_LIKE.0 | Self::ES_SYMBOL_LIKE.0 | Self::VOID_LIKE.0 | Self::NULL.0,
    UNION_OR_INTERSECTION = Self::UNION.0 | Self::INTERSECTION.0,
    STRUCTURED_TYPE = Self::OBJECT.0 | Self::UNION.0 | Self::INTERSECTION.0,
    TYPE_VARIABLE = Self::TYPE_PARAMETER.0 | Self::INDEXED_ACCESS.0,
    INSTANTIABLE_NON_PRIMITIVE = Self::TYPE_VARIABLE.0 | Self::CONDITIONAL.0 | Self::SUBSTITUTION.0,
    INSTANTIABLE_PRIMITIVE = Self::INDEX.0 | Self::TEMPLATE_LITERAL.0 | Self::STRING_MAPPING.0,
    INSTANTIABLE = Self::INSTANTIABLE_NON_PRIMITIVE.0 | Self::INSTANTIABLE_PRIMITIVE.0,
    STRUCTURED_OR_INSTANTIABLE = Self::STRUCTURED_TYPE.0 | Self::INSTANTIABLE.0,
    OBJECT_FLAGS_TYPE = Self::ANY.0 | Self::NULLABLE.0 | Self::NEVER.0 | Self::OBJECT.0 | Self::UNION.0 | Self::INTERSECTION.0,
    SIMPLIFIABLE = Self::INDEXED_ACCESS.0 | Self::CONDITIONAL.0 | Self::INDEX.0,
    SINGLETON = Self::ANY.0 | Self::UNKNOWN.0 | Self::STRING.0 | Self::NUMBER.0 | Self::BOOLEAN.0 | Self::BIG_INT.0 | Self::ES_SYMBOL.0 | Self::VOID.0 | Self::UNDEFINED.0 | Self::NULL.0 | Self::NEVER.0 | Self::NON_PRIMITIVE.0,
    // 'TypeFlagsNarrowable' types are types where narrowing actually narrows. This *should* be every type other than null, undefined, void, and never
    NARROWABLE = Self::ANY.0 | Self::UNKNOWN.0 | Self::STRUCTURED_OR_INSTANTIABLE.0 | Self::STRING_LIKE.0 | Self::NUMBER_LIKE.0 | Self::BIG_INT_LIKE.0 | Self::BOOLEAN_LIKE.0 | Self::ES_SYMBOL.0 | Self::UNIQUE_ES_SYMBOL.0 | Self::NON_PRIMITIVE.0,
    // The following flags are aggregated during union and intersection type construction
    INCLUDES_MASK = Self::ANY.0 | Self::UNKNOWN.0 | Self::PRIMITIVE.0 | Self::NEVER.0 | Self::OBJECT.0 | Self::UNION.0 | Self::INTERSECTION.0 | Self::NON_PRIMITIVE.0 | Self::TEMPLATE_LITERAL.0 | Self::STRING_MAPPING.0,
    // The following flags are used for different purposes during union and intersection type construction
    INCLUDES_MISSING_TYPE = Self::TYPE_PARAMETER.0,
    INCLUDES_NON_WIDENING_TYPE = Self::INDEX.0,
    INCLUDES_WILDCARD = Self::INDEXED_ACCESS.0,
    INCLUDES_EMPTY_OBJECT = Self::CONDITIONAL.0,
    INCLUDES_INSTANTIABLE = Self::SUBSTITUTION.0,
    INCLUDES_CONSTRAINED_TYPE_VARIABLE = Self::RESERVED1.0,
    INCLUDES_ERROR = Self::RESERVED2.0,
    NOT_PRIMITIVE_UNION = Self::ANY.0 | Self::UNKNOWN.0 | Self::VOID.0 | Self::NEVER.0 | Self::OBJECT.0 | Self::INTERSECTION.0 | Self::INCLUDES_INSTANTIABLE.0,
});

const TYPE_FLAG_NAMES: [(TypeFlags, &[u8]); 29] = [
    (TypeFlags::ANY, b"Any"),
    (TypeFlags::UNKNOWN, b"Unknown"),
    (TypeFlags::UNDEFINED, b"Undefined"),
    (TypeFlags::NULL, b"Null"),
    (TypeFlags::VOID, b"Void"),
    (TypeFlags::STRING, b"String"),
    (TypeFlags::NUMBER, b"Number"),
    (TypeFlags::BIG_INT, b"BigInt"),
    (TypeFlags::BOOLEAN, b"Boolean"),
    (TypeFlags::ES_SYMBOL, b"ESSymbol"),
    (TypeFlags::STRING_LITERAL, b"StringLiteral"),
    (TypeFlags::NUMBER_LITERAL, b"NumberLiteral"),
    (TypeFlags::BIG_INT_LITERAL, b"BigIntLiteral"),
    (TypeFlags::BOOLEAN_LITERAL, b"BooleanLiteral"),
    (TypeFlags::UNIQUE_ES_SYMBOL, b"UniqueESSymbol"),
    (TypeFlags::ENUM_LITERAL, b"EnumLiteral"),
    (TypeFlags::ENUM, b"Enum"),
    (TypeFlags::NON_PRIMITIVE, b"NonPrimitive"),
    (TypeFlags::NEVER, b"Never"),
    (TypeFlags::TYPE_PARAMETER, b"TypeParameter"),
    (TypeFlags::OBJECT, b"Object"),
    (TypeFlags::INDEX, b"Index"),
    (TypeFlags::TEMPLATE_LITERAL, b"TemplateLiteral"),
    (TypeFlags::STRING_MAPPING, b"StringMapping"),
    (TypeFlags::SUBSTITUTION, b"Substitution"),
    (TypeFlags::INDEXED_ACCESS, b"IndexedAccess"),
    (TypeFlags::CONDITIONAL, b"Conditional"),
    (TypeFlags::UNION, b"Union"),
    (TypeFlags::INTERSECTION, b"Intersection"),
];

// FormatTypeFlags returns the individual flag names as a slice of strings.
pub fn format_type_flags(flags: TypeFlags) -> Vec<&'static [u8]> {
    let mut result: Vec<&'static [u8]> = Vec::with_capacity(flags.0.count_ones() as usize);
    for (flag, name) in TYPE_FLAG_NAMES {
        if flags.intersects(flag) {
            result.push(name);
        }
    }
    if result.is_empty() {
        result.push(b"None");
    }
    result
}

impl TypeFlags {
    // String returns a pipe-separated string of flag names.
    pub fn string(self) -> Vec<u8> {
        format_type_flags(self).join(b"|".as_slice())
    }
}

impl VarianceFlags {
    pub fn string(self) -> Vec<u8> {
        let variance = self & VarianceFlags::VARIANCE_MASK;
        let mut result: Vec<u8> = if variance == VarianceFlags::INVARIANT {
            b"in out".to_vec()
        } else if variance == VarianceFlags::BIVARIANT {
            b"[bivariant]".to_vec()
        } else if variance == VarianceFlags::CONTRAVARIANT {
            b"in".to_vec()
        } else if variance == VarianceFlags::COVARIANT {
            b"out".to_vec()
        } else if variance == VarianceFlags::INDEPENDENT {
            b"[independent]".to_vec()
        } else {
            Vec::new()
        };
        if self.intersects(VarianceFlags::UNMEASURABLE) {
            result.extend_from_slice(b" (unmeasurable)");
        } else if self.intersects(VarianceFlags::UNRELIABLE) {
            result.extend_from_slice(b" (unreliable)");
        }
        result
    }
}

// Types included in TypeFlags.ObjectFlagsType have an objectFlags property. Some ObjectFlags are specific to certain types and reuse the same bit position. Those ObjectFlags require a check for a certain TypeFlags value to determine their meaning.

checker_flags!(ObjectFlags: u32 {
    CLASS = 1 << 0, // Class
    INTERFACE = 1 << 1, // Interface
    REFERENCE = 1 << 2, // Generic type reference
    TUPLE = 1 << 3, // Synthesized generic tuple type
    ANONYMOUS = 1 << 4, // Anonymous
    MAPPED = 1 << 5, // Mapped
    INSTANTIATED = 1 << 6, // Instantiated anonymous or mapped type
    OBJECT_LITERAL = 1 << 7, // Originates in an object literal
    EVOLVING_ARRAY = 1 << 8, // Evolving array type
    OBJECT_LITERAL_PATTERN_WITH_COMPUTED_PROPERTIES = 1 << 9, // Object literal pattern with computed properties
    REVERSE_MAPPED = 1 << 10, // Object contains a property from a reverse-mapped type
    JSX_ATTRIBUTES = 1 << 11, // Jsx attributes type
    JS_LITERAL = 1 << 12, // Object type declared in JS - disables errors on read/write of nonexisting members
    FRESH_LITERAL = 1 << 13, // Fresh object literal
    ARRAY_LITERAL = 1 << 14, // Originates in an array literal
    PRIMITIVE_UNION = 1 << 15, // Union of only primitive types
    CONTAINS_WIDENING_TYPE = 1 << 16, // Type is or contains undefined or null widening type
    CONTAINS_OBJECT_OR_ARRAY_LITERAL = 1 << 17, // Type is or contains object literal type
    NON_INFERRABLE_TYPE = 1 << 18, // Type is or contains anyFunctionType or silentNeverType
    COULD_CONTAIN_TYPE_VARIABLES_COMPUTED = 1 << 19, // CouldContainTypeVariables flag has been computed
    COULD_CONTAIN_TYPE_VARIABLES = 1 << 20, // Type could contain a type variable
    MEMBERS_RESOLVED = 1 << 21, // Members have been resolved
    CLASS_OR_INTERFACE = Self::CLASS.0 | Self::INTERFACE.0,
    REQUIRES_WIDENING = Self::CONTAINS_WIDENING_TYPE.0 | Self::CONTAINS_OBJECT_OR_ARRAY_LITERAL.0,
    PROPAGATING_FLAGS = Self::CONTAINS_WIDENING_TYPE.0 | Self::CONTAINS_OBJECT_OR_ARRAY_LITERAL.0 | Self::NON_INFERRABLE_TYPE.0,
    INSTANTIATED_MAPPED = Self::MAPPED.0 | Self::INSTANTIATED.0,
    // Object flags that uniquely identify the kind of ObjectType
    OBJECT_TYPE_KIND_MASK = Self::CLASS_OR_INTERFACE.0 | Self::REFERENCE.0 | Self::TUPLE.0 | Self::ANONYMOUS.0 | Self::MAPPED.0 | Self::REVERSE_MAPPED.0 | Self::EVOLVING_ARRAY.0 | Self::INSTANTIATION_EXPRESSION_TYPE.0 | Self::SINGLE_SIGNATURE_TYPE.0,
    // Flags that require TypeFlags.Object
    CONTAINS_SPREAD = 1 << 22, // Object literal contains spread operation
    OBJECT_REST_TYPE = 1 << 23, // Originates in object rest declaration
    INSTANTIATION_EXPRESSION_TYPE = 1 << 24, // Originates in instantiation expression
    SINGLE_SIGNATURE_TYPE = 1 << 25, // A single signature type extracted from a potentially broader type
    IS_CLASS_INSTANCE_CLONE = 1 << 26, // Type is a clone of a class instance type
    // Flags that require TypeFlags.Object and ObjectFlags.Reference
    IDENTICAL_BASE_TYPE_CALCULATED = 1 << 27, // has had `getSingleBaseForNonAugmentingSubtype` invoked on it already
    IDENTICAL_BASE_TYPE_EXISTS = 1 << 28, // has a defined cachedEquivalentBaseType member
    UNRESOLVED_MEMBERS = 1 << 29, // Member resolution in process
    FROM_TYPE_NODE = 1 << 30, // Originates in resolution of AST type node
    // Flags that require TypeFlags.UnionOrIntersection or TypeFlags.Substitution
    IS_GENERIC_TYPE_COMPUTED = 1 << 22, // IsGenericObjectType flag has been computed
    IS_GENERIC_OBJECT_TYPE = 1 << 23, // Union or intersection contains generic object type
    IS_GENERIC_INDEX_TYPE = 1 << 24, // Union or intersection contains generic index type
    IS_GENERIC_TYPE = Self::IS_GENERIC_OBJECT_TYPE.0 | Self::IS_GENERIC_INDEX_TYPE.0,
    // Flags that require TypeFlags.Union
    CONTAINS_INTERSECTIONS = 1 << 25, // Union contains intersections
    IS_UNKNOWN_LIKE_UNION_COMPUTED = 1 << 26, // IsUnknownLikeUnion flag has been computed
    IS_UNKNOWN_LIKE_UNION = 1 << 27, // Union of null, undefined, and empty object type
    IS_UNIFORM_ENUM_COMPUTED = 1 << 28, // IsUniformEnum flag has been computed
    IS_UNIFORM_ENUM = 1 << 29, // Union contains uniform literal types
    // Flags that require TypeFlags.Intersection
    IS_NEVER_INTERSECTION_COMPUTED = 1 << 25, // IsNeverLike flag has been computed
    IS_NEVER_INTERSECTION = 1 << 26, // Intersection reduces to never
    IS_CONSTRAINED_TYPE_VARIABLE = 1 << 27, // T & C, where T's constraint and C are primitives, object, or {}
});

// TypeAlias

#[derive(Clone, Copy, Default)]
pub struct TypeAlias<'a> {
    pub symbol: SymbolId,
    pub type_arguments: List<'a, TypeId>,
}

impl<'a> Checker<'a> {
    // TypeAlias.Symbol: nil for the nil alias.
    pub fn alias_symbol(&self, alias: TypeAliasId) -> SymbolId {
        if alias.is_nil() {
            return SymbolId::NIL;
        }
        self.type_aliases[alias].symbol
    }

    // TypeAlias.TypeArguments: nil for the nil alias.
    pub fn alias_type_arguments(&self, alias: TypeAliasId) -> List<'a, TypeId> {
        if alias.is_nil() {
            return List::NIL;
        }
        self.type_aliases[alias].type_arguments
    }
}

// Type

// `id` of upstream is the id that names the record, and `checker` is the one checker that owns every type.
#[derive(Default)]
pub struct Type<'a> {
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub symbol: SymbolId,
    pub alias: TypeAliasId,
    pub data: TypeData<'a>, // Type specific data
}

impl Type<'_> {
    pub fn flags(&self) -> TypeFlags {
        self.flags
    }

    pub fn object_flags(&self) -> ObjectFlags {
        self.object_flags
    }
}

// What a cast of a type gives when the type has no such data: upstream returns nil there and panics on the next read.
#[derive(Default)]
pub struct NilSections<'a> {
    pub intrinsic: IntrinsicType<'a>,
    pub literal: LiteralType<'a>,
    pub unique_es_symbol: UniqueESSymbolType<'a>,
    pub constrained: ConstrainedType,
    pub structured: StructuredType<'a>,
    pub object: ObjectType<'a>,
    pub reference: TypeReference<'a>,
    pub interface: InterfaceType<'a>,
    pub tuple: TupleType<'a>,
    pub instantiation_expression: InstantiationExpressionType<'a>,
    pub mapped: MappedType<'a>,
    pub reverse_mapped: ReverseMappedType<'a>,
    pub evolving_array: EvolvingArrayType<'a>,
    pub union_or_intersection: UnionOrIntersectionType<'a>,
    pub union: UnionType<'a>,
    pub intersection: IntersectionType<'a>,
    pub type_parameter: TypeParameter,
    pub index: IndexType,
    pub indexed_access: IndexedAccessType,
    pub template_literal: TemplateLiteralType<'a>,
    pub string_mapping: StringMappingType,
    pub substitution: SubstitutionType,
    pub conditional: ConditionalType,
}

// Casts for concrete struct types

// `t.AsX()` is `c.as_x(t)` for a read and `c.as_x_mut(t)` for a write. A cast that fails is recorded: it reads the zero data and writes to a scratch copy.
macro_rules! concrete_casts {
    ($($read:ident, $write:ident, $variant:ident, $ty:ty, $nil:ident, $name:literal;)*) => {
        impl<'a> Checker<'a> {$(
            pub fn $read(&self, t: TypeId) -> &$ty {
                match &self.types[t].data {
                    TypeData::$variant(d) => d,
                    _ => {
                        self.bad_cast($name);
                        &self.nil_sections.$nil
                    }
                }
            }

            pub fn $write(&mut self, t: TypeId) -> &mut $ty {
                if !matches!(self.types[t].data, TypeData::$variant(_)) {
                    self.bad_cast($name);
                    self.sink_sections.$nil = Default::default();
                    return &mut self.sink_sections.$nil;
                }
                match &mut self.types[t].data {
                    TypeData::$variant(d) => d,
                    _ => &mut self.sink_sections.$nil,
                }
            }
        )*}
    };
}

concrete_casts!(
    as_intrinsic_type, as_intrinsic_type_mut, Intrinsic, IntrinsicType<'a>, intrinsic, "AsIntrinsicType";
    as_literal_type, as_literal_type_mut, Literal, LiteralType<'a>, literal, "AsLiteralType";
    as_unique_es_symbol_type, as_unique_es_symbol_type_mut, UniqueESSymbol, UniqueESSymbolType<'a>, unique_es_symbol, "AsUniqueESSymbolType";
    as_tuple_type, as_tuple_type_mut, Tuple, TupleType<'a>, tuple, "AsTupleType";
    as_instantiation_expression_type, as_instantiation_expression_type_mut, InstantiationExpression, InstantiationExpressionType<'a>, instantiation_expression, "AsInstantiationExpressionType";
    as_mapped_type, as_mapped_type_mut, Mapped, MappedType<'a>, mapped, "AsMappedType";
    as_reverse_mapped_type, as_reverse_mapped_type_mut, ReverseMapped, ReverseMappedType<'a>, reverse_mapped, "AsReverseMappedType";
    as_evolving_array_type, as_evolving_array_type_mut, EvolvingArray, EvolvingArrayType<'a>, evolving_array, "AsEvolvingArrayType";
    as_type_parameter, as_type_parameter_mut, TypeParameter, TypeParameter, type_parameter, "AsTypeParameter";
    as_union_type, as_union_type_mut, Union, UnionType<'a>, union, "AsUnionType";
    as_intersection_type, as_intersection_type_mut, Intersection, IntersectionType<'a>, intersection, "AsIntersectionType";
    as_index_type, as_index_type_mut, Index, IndexType, index, "AsIndexType";
    as_indexed_access_type, as_indexed_access_type_mut, IndexedAccess, IndexedAccessType, indexed_access, "AsIndexedAccessType";
    as_template_literal_type, as_template_literal_type_mut, TemplateLiteral, TemplateLiteralType<'a>, template_literal, "AsTemplateLiteralType";
    as_string_mapping_type, as_string_mapping_type_mut, StringMapping, StringMappingType, string_mapping, "AsStringMappingType";
    as_substitution_type, as_substitution_type_mut, Substitution, SubstitutionType, substitution, "AsSubstitutionType";
    as_conditional_type, as_conditional_type_mut, Conditional, ConditionalType, conditional, "AsConditionalType";
);

// Casts for embedded struct types

// `t.AsX()` of a struct that other data embed. `c.has_x(t)` is `t.AsX() != nil`.
macro_rules! embedded_casts {
    ($($read:ident, $write:ident, $has:ident, $ty:ty, $nil:ident, $name:literal, { $($variant:ident($d:ident) => $path:expr),* $(,)? };)*) => {
        impl<'a> Checker<'a> {$(
            pub fn $read(&self, t: TypeId) -> &$ty {
                match &self.types[t].data {
                    $(TypeData::$variant($d) => &$path,)*
                    _ => {
                        self.bad_cast($name);
                        &self.nil_sections.$nil
                    }
                }
            }

            pub fn $write(&mut self, t: TypeId) -> &mut $ty {
                if !self.$has(t) {
                    self.bad_cast($name);
                    self.sink_sections.$nil = Default::default();
                    return &mut self.sink_sections.$nil;
                }
                match &mut self.types[t].data {
                    $(TypeData::$variant($d) => &mut $path,)*
                    _ => &mut self.sink_sections.$nil,
                }
            }

            pub fn $has(&self, t: TypeId) -> bool {
                matches!(self.types[t].data, $(TypeData::$variant(_))|*)
            }
        )*}
    };
}

embedded_casts!(
    as_constrained_type, as_constrained_type_mut, has_constrained_type, ConstrainedType, constrained, "AsConstrainedType", {
        Object(d) => d.structured.constrained,
        TypeReference(d) => d.object.structured.constrained,
        Interface(d) => d.reference.object.structured.constrained,
        Tuple(d) => d.interface.reference.object.structured.constrained,
        InstantiationExpression(d) => d.object.structured.constrained,
        Mapped(d) => d.object.structured.constrained,
        ReverseMapped(d) => d.object.structured.constrained,
        EvolvingArray(d) => d.object.structured.constrained,
        Union(d) => d.base.structured.constrained,
        Intersection(d) => d.base.structured.constrained,
        TypeParameter(d) => d.constrained,
        Index(d) => d.constrained,
        IndexedAccess(d) => d.constrained,
        TemplateLiteral(d) => d.constrained,
        StringMapping(d) => d.constrained,
        Substitution(d) => d.constrained,
        Conditional(d) => d.constrained,
    };
    as_structured_type, as_structured_type_mut, has_structured_type, StructuredType<'a>, structured, "AsStructuredType", {
        Object(d) => d.structured,
        TypeReference(d) => d.object.structured,
        Interface(d) => d.reference.object.structured,
        Tuple(d) => d.interface.reference.object.structured,
        InstantiationExpression(d) => d.object.structured,
        Mapped(d) => d.object.structured,
        ReverseMapped(d) => d.object.structured,
        EvolvingArray(d) => d.object.structured,
        Union(d) => d.base.structured,
        Intersection(d) => d.base.structured,
    };
    as_object_type, as_object_type_mut, has_object_type, ObjectType<'a>, object, "AsObjectType", {
        Object(d) => **d,
        TypeReference(d) => d.object,
        Interface(d) => d.reference.object,
        Tuple(d) => d.interface.reference.object,
        InstantiationExpression(d) => d.object,
        Mapped(d) => d.object,
        ReverseMapped(d) => d.object,
        EvolvingArray(d) => d.object,
    };
    as_type_reference, as_type_reference_mut, has_type_reference, TypeReference<'a>, reference, "AsTypeReference", {
        TypeReference(d) => **d,
        Interface(d) => d.reference,
        Tuple(d) => d.interface.reference,
    };
    as_interface_type, as_interface_type_mut, has_interface_type, InterfaceType<'a>, interface, "AsInterfaceType", {
        Interface(d) => **d,
        Tuple(d) => d.interface,
    };
    as_union_or_intersection_type, as_union_or_intersection_type_mut, has_union_or_intersection_type, UnionOrIntersectionType<'a>, union_or_intersection, "AsUnionOrIntersectionType", {
        Union(d) => d.base,
        Intersection(d) => d.base,
    };
);

impl<'a> Checker<'a> {
    // Type.Distributed
    pub fn type_distributed(&self, t: TypeId) -> List<'a, TypeId> {
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.as_union_type(t).base.types;
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) {
            return List::NIL;
        }
        self.list_of(&[t])
    }

    // Common accessors

    // Type.Target
    pub fn type_target(&self, t: TypeId) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::OBJECT) {
            return self.as_object_type(t).target;
        }
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.as_type_parameter(t).target;
        }
        if flags.intersects(TypeFlags::INDEX) {
            return self.as_index_type(t).target;
        }
        if flags.intersects(TypeFlags::STRING_MAPPING) {
            return self.as_string_mapping_type(t).target;
        }
        if flags.intersects(TypeFlags::OBJECT)
            && self.types[t].object_flags.intersects(ObjectFlags::MAPPED)
        {
            return self.as_mapped_type(t).object.target;
        }
        self.fail("Unhandled case in Type.Target")
    }

    // Type.Mapper
    pub fn type_mapper(&self, t: TypeId) -> TypeMapperId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::OBJECT) {
            return self.as_object_type(t).mapper;
        }
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.as_type_parameter(t).mapper;
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            return self.as_conditional_type(t).mapper;
        }
        self.fail("Unhandled case in Type.Mapper")
    }

    // Type.Types
    pub fn type_types(&self, t: TypeId) -> List<'a, TypeId> {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            return self.as_union_or_intersection_type(t).types;
        }
        if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            return self.as_template_literal_type(t).types;
        }
        self.fail("Unhandled case in Type.Types")
    }

    // Type.TargetInterfaceType
    pub fn type_target_interface_type(&self, t: TypeId) -> &InterfaceType<'a> {
        self.as_interface_type(self.as_type_reference(t).object.target)
    }

    // Type.TargetTupleType
    pub fn type_target_tuple_type(&self, t: TypeId) -> &TupleType<'a> {
        self.as_tuple_type(self.as_type_reference(t).object.target)
    }

    // Type.IsTupleType
    pub fn type_is_tuple_type(&self, t: TypeId) -> bool {
        is_tuple_type(self, t)
    }
}

impl Type<'_> {
    pub fn symbol(&self) -> SymbolId {
        self.symbol
    }

    pub fn alias(&self) -> TypeAliasId {
        self.alias
    }

    pub fn is_union(&self) -> bool {
        self.flags.intersects(TypeFlags::UNION)
    }

    pub fn is_string(&self) -> bool {
        self.flags.intersects(TypeFlags::STRING)
    }

    pub fn is_intersection(&self) -> bool {
        self.flags.intersects(TypeFlags::INTERSECTION)
    }

    pub fn is_string_literal(&self) -> bool {
        self.flags.intersects(TypeFlags::STRING_LITERAL)
    }

    pub fn is_number_literal(&self) -> bool {
        self.flags.intersects(TypeFlags::NUMBER_LITERAL)
    }

    pub fn is_big_int_literal(&self) -> bool {
        self.flags.intersects(TypeFlags::BIG_INT_LITERAL)
    }

    pub fn is_enum_literal(&self) -> bool {
        self.flags.intersects(TypeFlags::ENUM_LITERAL)
    }

    pub fn is_boolean_like(&self) -> bool {
        self.flags.intersects(TypeFlags::BOOLEAN_LIKE)
    }

    pub fn is_string_like(&self) -> bool {
        self.flags.intersects(TypeFlags::STRING_LIKE)
    }

    pub fn is_class(&self) -> bool {
        self.object_flags.intersects(ObjectFlags::CLASS)
    }

    pub fn is_type_parameter(&self) -> bool {
        self.flags.intersects(TypeFlags::TYPE_PARAMETER)
    }

    pub fn is_index(&self) -> bool {
        self.flags.intersects(TypeFlags::INDEX)
    }
}

// TypeData

// The interface TypeData of upstream is this enum, and TypeBase is the record Type itself. newObjectType picks the variant of an object type in the order Interface, Tuple, TypeReference, Mapped, ReverseMapped, EvolvingArray, InstantiationExpression, Object.
#[derive(Default)]
pub enum TypeData<'a> {
    #[default]
    Nil,
    Intrinsic(IntrinsicType<'a>),
    Literal(LiteralType<'a>),
    UniqueESSymbol(UniqueESSymbolType<'a>),
    Object(Box<ObjectType<'a>>),
    TypeReference(Box<TypeReference<'a>>),
    Interface(Box<InterfaceType<'a>>),
    Tuple(Box<TupleType<'a>>),
    InstantiationExpression(Box<InstantiationExpressionType<'a>>),
    Mapped(Box<MappedType<'a>>),
    ReverseMapped(Box<ReverseMappedType<'a>>),
    EvolvingArray(Box<EvolvingArrayType<'a>>),
    Union(Box<UnionType<'a>>),
    Intersection(Box<IntersectionType<'a>>),
    TypeParameter(Box<TypeParameter>),
    Index(IndexType),
    IndexedAccess(IndexedAccessType),
    TemplateLiteral(Box<TemplateLiteralType<'a>>),
    StringMapping(StringMappingType),
    Substitution(SubstitutionType),
    Conditional(Box<ConditionalType>),
}

// An embedded struct of upstream is the first field of its record. The record dereferences to that field, so a promoted field reads as it does upstream.
macro_rules! embeds {
    ($(impl[$($generics:tt)*] $outer:ty, $field:ident: $inner:ty;)*) => {$(
        impl<$($generics)*> Deref for $outer {
            type Target = $inner;

            #[inline]
            fn deref(&self) -> &$inner {
                &self.$field
            }
        }

        impl<$($generics)*> DerefMut for $outer {
            #[inline]
            fn deref_mut(&mut self) -> &mut $inner {
                &mut self.$field
            }
        }
    )*};
}

embeds!(
    impl['a] StructuredType<'a>, constrained: ConstrainedType;
    impl['a] ObjectType<'a>, structured: StructuredType<'a>;
    impl['a] TypeReference<'a>, object: ObjectType<'a>;
    impl['a] InterfaceType<'a>, reference: TypeReference<'a>;
    impl['a] TupleType<'a>, interface: InterfaceType<'a>;
    impl['a] InstantiationExpressionType<'a>, object: ObjectType<'a>;
    impl['a] MappedType<'a>, object: ObjectType<'a>;
    impl['a] ReverseMappedType<'a>, object: ObjectType<'a>;
    impl['a] EvolvingArrayType<'a>, object: ObjectType<'a>;
    impl['a] UnionOrIntersectionType<'a>, structured: StructuredType<'a>;
    impl['a] UnionType<'a>, base: UnionOrIntersectionType<'a>;
    impl['a] IntersectionType<'a>, base: UnionOrIntersectionType<'a>;
    impl[] TypeParameter, constrained: ConstrainedType;
    impl[] IndexType, constrained: ConstrainedType;
    impl[] IndexedAccessType, constrained: ConstrainedType;
    impl['a] TemplateLiteralType<'a>, constrained: ConstrainedType;
    impl[] StringMappingType, constrained: ConstrainedType;
    impl[] SubstitutionType, constrained: ConstrainedType;
    impl[] ConditionalType, constrained: ConstrainedType;
);

// IntrinsicTypeData

#[derive(Default)]
pub struct IntrinsicType<'a> {
    pub intrinsic_name: Text<'a>,
}

impl<'a> IntrinsicType<'a> {
    pub fn intrinsic_name(&self) -> Text<'a> {
        self.intrinsic_name
    }
}

// LiteralTypeData

// `any` of LiteralType.value: string | jsnum.Number | bool | PseudoBigInt | nil (computed enum). `==` is the equality of two such values upstream: a NaN is not equal to itself.
#[derive(Clone, Default, PartialEq, Debug)]
pub enum LiteralValue<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(f64),
    Boolean(bool),
    BigInt(PseudoBigInt),
}

#[derive(Default)]
pub struct LiteralType<'a> {
    pub value: LiteralValue<'a>,
    pub fresh_type: TypeId,   // Fresh version of type
    pub regular_type: TypeId, // Regular version of type
}

impl<'a> LiteralType<'a> {
    pub fn value(&self) -> &LiteralValue<'a> {
        &self.value
    }

    pub fn fresh_type(&self) -> TypeId {
        self.fresh_type
    }

    pub fn regular_type(&self) -> TypeId {
        self.regular_type
    }

    pub fn string(&self) -> Vec<u8> {
        value_to_string(&self.value)
    }
}

// UniqueESSymbolTypeData

#[derive(Default)]
pub struct UniqueESSymbolType<'a> {
    pub name: Text<'a>,
}

// ConstrainedType (type with computed base constraint)

#[derive(Default)]
pub struct ConstrainedType {
    pub resolved_base_constraint: TypeId,
}

// StructuredType (base of all types with members)

#[derive(Default)]
pub struct StructuredType<'a> {
    pub constrained: ConstrainedType,
    pub members: SymbolTableId,
    pub properties: List<'a, SymbolId>,
    pub signatures: List<'a, SignatureId>, // Signatures (call + construct)
    pub call_signature_count: isize,       // Count of call signatures
    pub index_infos: List<'a, IndexInfoId>,
    pub object_type_without_abstract_construct_signatures: TypeId,
}

impl<'a> StructuredType<'a> {
    pub fn call_signatures(&self) -> List<'a, SignatureId> {
        sub_list(self.signatures, 0, self.call_signature_count)
    }

    pub fn construct_signatures(&self) -> List<'a, SignatureId> {
        sub_list(
            self.signatures,
            self.call_signature_count,
            self.signatures.len(),
        )
    }

    pub fn properties(&self) -> List<'a, SymbolId> {
        self.properties
    }
}

// Except for tuple type references and reverse mapped types, all object types have an associated symbol. Possible object type instances are listed in the following.

// InterfaceType: ObjectFlagsClass: Originating non-generic class type. ObjectFlagsClass|ObjectFlagsReference: Originating generic class type. ObjectFlagsInterface: Originating non-generic interface type. ObjectFlagsInterface|ObjectFlagsReference: Originating generic interface type.

// TupleType: ObjectFlagsReference|ObjectFlagsTuple: Originating generic tuple type (synthesized).

// TypeReference: ObjectFlagsReference: Instantiated generic class, interface, or tuple type.

// ObjectType: ObjectFlagsAnonymous: Originating anonymous object type. ObjectFlagsAnonymous|ObjectFlagsInstantiated: Instantiated anonymous object type.

// MappedType: ObjectFlagsMapped: Originating mapped type. ObjectFlagsMapped|ObjectFlagsInstantiated: Instantiated mapped type.

// InstantiationExpressionType: ObjectFlagsAnonymous|ObjectFlagsInstantiationExpression: Originating instantiation expression type. ObjectFlagsAnonymous|ObjectFlagsInstantiated|ObjectFlagsInstantiationExpression: Instantiated instantiation expression type.

// ReverseMappedType: ObjectFlagsAnonymous|ObjectFlagsReverseMapped: Reverse mapped type.

// EvolvingArrayType: ObjectFlagsEvolvingArray: Evolving array type.

#[derive(Default)]
pub struct ObjectType<'a> {
    pub structured: StructuredType<'a>,
    pub target: TypeId,                            // Target of instantiated type
    pub mapper: TypeMapperId,                      // Type mapper for instantiated type
    pub instantiations: Map<CacheHashKey, TypeId>, // Map of type instantiations
}

// TypeReference (instantiation of an InterfaceType)

#[derive(Default)]
pub struct TypeReference<'a> {
    pub object: ObjectType<'a>,
    pub node: NodeId, // TypeReferenceNode | ArrayTypeNode | TupleTypeNode when deferred, else nil
    pub resolved_type_arguments: List<'a, TypeId>,
}

// InterfaceType (when generic, serves as reference to instantiation of itself)

#[derive(Default)]
pub struct InterfaceType<'a> {
    pub reference: TypeReference<'a>,
    pub all_type_parameters: List<'a, TypeId>, // Type parameters (outer + local + thisType)
    pub outer_type_parameter_count: isize,     // Count of outer type parameters
    pub this_type: TypeId,                     // The "this" type (nil if none)
    pub base_types_resolved: bool,
    pub declared_members_resolved: bool,
    pub resolved_base_constructor_type: TypeId,
    pub resolved_base_types: List<'a, TypeId>,
    pub declared_members: SymbolTableId, // Declared members
    pub declared_call_signatures: List<'a, SignatureId>, // Declared call signatures
    pub declared_construct_signatures: List<'a, SignatureId>, // Declared construct signatures
    pub declared_index_infos: List<'a, IndexInfoId>, // Declared index signatures
}

impl<'a> InterfaceType<'a> {
    pub fn outer_type_parameters(&self) -> List<'a, TypeId> {
        if self.all_type_parameters.len() == 0 {
            return List::NIL;
        }
        sub_list(self.all_type_parameters, 0, self.outer_type_parameter_count)
    }

    pub fn local_type_parameters(&self) -> List<'a, TypeId> {
        if self.all_type_parameters.len() == 0 {
            return List::NIL;
        }
        sub_list(
            self.all_type_parameters,
            self.outer_type_parameter_count,
            self.all_type_parameters.len() - 1,
        )
    }

    pub fn type_parameters(&self) -> List<'a, TypeId> {
        if self.all_type_parameters.len() == 0 {
            return List::NIL;
        }
        sub_list(
            self.all_type_parameters,
            0,
            self.all_type_parameters.len() - 1,
        )
    }
}

// TupleType

checker_flags!(ElementFlags: u32 {
    REQUIRED = 1 << 0, // T
    OPTIONAL = 1 << 1, // T?
    REST = 1 << 2, // ...T[]
    VARIADIC = 1 << 3, // ...T
    FIXED = Self::REQUIRED.0 | Self::OPTIONAL.0,
    VARIABLE = Self::REST.0 | Self::VARIADIC.0,
    NON_REQUIRED = Self::OPTIONAL.0 | Self::REST.0 | Self::VARIADIC.0,
    NON_REST = Self::REQUIRED.0 | Self::OPTIONAL.0 | Self::VARIADIC.0,
});

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct TupleElementInfo {
    pub flags: ElementFlags,
    pub labeled_declaration: NodeId, // NamedTupleMember | ParameterDeclaration | nil
}

impl TupleElementInfo {
    pub fn tuple_element_flags(self) -> ElementFlags {
        self.flags
    }

    pub fn labeled_declaration(self) -> NodeId {
        self.labeled_declaration
    }
}

#[derive(Default)]
pub struct TupleType<'a> {
    pub interface: InterfaceType<'a>,
    pub element_infos: List<'a, TupleElementInfo>,
    pub min_length: isize,   // Number of required or variadic elements
    pub fixed_length: isize, // Number of initial required or optional elements
    pub combined_flags: ElementFlags,
    pub readonly: bool,
}

impl<'a> TupleType<'a> {
    pub fn fixed_length(&self) -> isize {
        self.fixed_length
    }

    pub fn is_readonly(&self) -> bool {
        self.readonly
    }

    pub fn element_flags(&self) -> Vec<ElementFlags> {
        self.element_infos
            .as_slice()
            .iter()
            .map(|info| info.flags)
            .collect()
    }

    pub fn element_infos(&self) -> List<'a, TupleElementInfo> {
        self.element_infos
    }
}

// InstantiationExpressionType

#[derive(Default)]
pub struct InstantiationExpressionType<'a> {
    pub object: ObjectType<'a>,
    pub node: NodeId,
}

// MappedType

#[derive(Default)]
pub struct MappedType<'a> {
    pub object: ObjectType<'a>,
    pub declaration: NodeId,
    pub type_parameter: TypeId,
    pub constraint_type: TypeId,
    pub name_type: TypeId,
    pub template_type: TypeId,
    pub modifiers_type: TypeId,
    pub resolved_apparent_type: TypeId,
    pub contains_error: bool,
}

// ReverseMappedType

#[derive(Default)]
pub struct ReverseMappedType<'a> {
    pub object: ObjectType<'a>,
    pub source: TypeId,
    pub mapped_type: TypeId,
    pub constraint_type: TypeId,
}

// EvolvingArrayType

#[derive(Default)]
pub struct EvolvingArrayType<'a> {
    pub object: ObjectType<'a>,
    pub element_type: TypeId,
    pub final_array_type: TypeId,
}

// UnionOrIntersectionTypeData

#[derive(Default)]
pub struct UnionOrIntersectionType<'a> {
    pub structured: StructuredType<'a>,
    pub types: List<'a, TypeId>,
    pub property_cache: SymbolTableId,
    pub property_cache_without_function_property_augment: SymbolTableId,
    pub resolved_properties: List<'a, SymbolId>,
}

impl<'a> UnionOrIntersectionType<'a> {
    pub fn types(&self) -> List<'a, TypeId> {
        self.types
    }
}

// UnionType

#[derive(Default)]
pub struct UnionType<'a> {
    pub base: UnionOrIntersectionType<'a>,
    pub resolved_reduced_type: TypeId,
    pub regular_type: TypeId,
    pub origin: TypeId, // Denormalized union, intersection, or index type in which union originates
    pub key_property_name: Text<'a>, // Property with unique unit type that exists in every object/intersection in union type
    pub constituent_map: Map<TypeId, TypeId>, // Constituents keyed by unit type discriminants
}

// IntersectionType

#[derive(Default)]
pub struct IntersectionType<'a> {
    pub base: UnionOrIntersectionType<'a>,
    pub resolved_apparent_type: TypeId,
    pub unique_literal_filled_instantiation: TypeId, // Instantiation with type parameters mapped to never type
}

// TypeParameter

#[derive(Default)]
pub struct TypeParameter {
    pub constrained: ConstrainedType,
    pub constraint: TypeId,
    pub target: TypeId,
    pub mapper: TypeMapperId,
    pub is_this_type: bool,
    pub resolved_default_type: TypeId,
}

impl TypeParameter {
    pub fn is_this_type(&self) -> bool {
        self.is_this_type
    }
}

// IndexFlags

checker_flags!(IndexFlags: u32 {
    STRINGS_ONLY = 1 << 0,
    NO_INDEX_SIGNATURES = 1 << 1,
    NO_REDUCIBLE_CHECK = 1 << 2,
});

// IndexType

#[derive(Default)]
pub struct IndexType {
    pub constrained: ConstrainedType,
    pub target: TypeId,
    pub index_flags: IndexFlags,
}

impl IndexType {
    pub fn target(&self) -> TypeId {
        self.target
    }
}

// IndexedAccessType

#[derive(Default)]
pub struct IndexedAccessType {
    pub constrained: ConstrainedType,
    pub object_type: TypeId,
    pub index_type: TypeId,
    pub access_flags: AccessFlags, // Only includes AccessFlags.Persistent
}

impl IndexedAccessType {
    pub fn object_type(&self) -> TypeId {
        self.object_type
    }

    pub fn index_type(&self) -> TypeId {
        self.index_type
    }
}

#[derive(Default)]
pub struct TemplateLiteralType<'a> {
    pub constrained: ConstrainedType,
    pub texts: List<'a, Text<'a>>, // Always one element longer than types
    pub types: List<'a, TypeId>,   // Always at least one element
}

impl<'a> TemplateLiteralType<'a> {
    pub fn texts(&self) -> List<'a, Text<'a>> {
        self.texts
    }

    pub fn types(&self) -> List<'a, TypeId> {
        self.types
    }
}

#[derive(Default)]
pub struct StringMappingType {
    pub constrained: ConstrainedType,
    pub target: TypeId,
}

impl StringMappingType {
    pub fn target(&self) -> TypeId {
        self.target
    }
}

#[derive(Default)]
pub struct SubstitutionType {
    pub constrained: ConstrainedType,
    pub base_type: TypeId,  // Target type
    pub constraint: TypeId, // Constraint that target type is known to satisfy
}

impl SubstitutionType {
    pub fn base_type(&self) -> TypeId {
        self.base_type
    }

    pub fn subst_constraint(&self) -> TypeId {
        self.constraint
    }
}

#[derive(Default)]
pub struct ConditionalRoot<'a> {
    pub node: NodeId,
    pub check_type: TypeId,
    pub extends_type: TypeId,
    pub is_distributive: bool,
    pub infer_type_parameters: List<'a, TypeId>,
    pub outer_type_parameters: List<'a, TypeId>,
    pub instantiations: Map<CacheHashKey, TypeId>,
    pub alias: TypeAliasId,
}

#[derive(Default)]
pub struct ConditionalType {
    pub constrained: ConstrainedType,
    pub root: ConditionalRootId,
    pub check_type: TypeId,
    pub extends_type: TypeId,
    pub resolved_true_type: TypeId,
    pub resolved_false_type: TypeId,
    pub resolved_inferred_true_type: TypeId, // The `trueType` instantiated with the `combinedMapper`, if present
    pub resolved_default_constraint: TypeId,
    pub resolved_constraint_of_distributive: TypeId,
    pub mapper: TypeMapperId,
    pub combined_mapper: TypeMapperId,
}

impl ConditionalType {
    pub fn check_type(&self) -> TypeId {
        self.check_type
    }

    pub fn extends_type(&self) -> TypeId {
        self.extends_type
    }
}

// SignatureFlags

checker_flags!(SignatureFlags: u32 {
    // Propagating flags
    HAS_REST_PARAMETER = 1 << 0, // Indicates last parameter is rest parameter
    HAS_LITERAL_TYPES = 1 << 1, // Indicates signature is specialized
    CONSTRUCT = 1 << 2, // Indicates signature is a construct signature
    ABSTRACT = 1 << 3, // Indicates signature comes from an abstract class, abstract construct signature, or abstract constructor type
    // Non-propagating flags
    IS_INNER_CALL_CHAIN = 1 << 4, // Indicates signature comes from a CallChain nested in an outer OptionalChain
    IS_OUTER_CALL_CHAIN = 1 << 5, // Indicates signature comes from a CallChain that is the outermost chain of an optional expression
    IS_UNTYPED_SIGNATURE_IN_JS_FILE = 1 << 6, // Indicates signature is from a js file and has no types
    IS_NON_INFERRABLE = 1 << 7, // Indicates signature comes from a non-inferrable type
    IS_SIGNATURE_CANDIDATE_FOR_OVERLOAD_FAILURE = 1 << 8,
    // We do not propagate `IsInnerCallChain` or `IsOuterCallChain` to instantiated signatures, as that would result in us attempting to add `| undefined` on each recursive call to `getReturnTypeOfSignature` when instantiating the return type.
    PROPAGATING_FLAGS = Self::HAS_REST_PARAMETER.0 | Self::HAS_LITERAL_TYPES.0 | Self::CONSTRUCT.0 | Self::ABSTRACT.0 | Self::IS_UNTYPED_SIGNATURE_IN_JS_FILE.0 | Self::IS_SIGNATURE_CANDIDATE_FOR_OVERLOAD_FAILURE.0,
    CALL_CHAIN_FLAGS = Self::IS_INNER_CALL_CHAIN.0 | Self::IS_OUTER_CALL_CHAIN.0,
});

// Signature

// `id` of upstream is the id that names the record. newSignature sets resolved_min_argument_count to -1.
#[derive(Default)]
pub struct Signature<'a> {
    pub flags: SignatureFlags,
    pub min_argument_count: i32,
    pub resolved_min_argument_count: i32,
    pub declaration: NodeId,
    pub type_parameters: List<'a, TypeId>,
    pub parameters: List<'a, SymbolId>,
    pub this_parameter: SymbolId,
    pub resolved_return_type: TypeId,
    pub resolved_type_predicate: TypePredicateId,
    pub target: SignatureId,
    pub mapper: TypeMapperId,
    pub isolated_signature_type: TypeId,
    pub composite: CompositeSignatureId,
}

impl<'a> Signature<'a> {
    pub fn flags(&self) -> SignatureFlags {
        self.flags
    }

    pub fn type_parameters(&self) -> List<'a, TypeId> {
        self.type_parameters
    }

    pub fn declaration(&self) -> NodeId {
        self.declaration
    }

    pub fn target(&self) -> SignatureId {
        self.target
    }

    pub fn this_parameter(&self) -> SymbolId {
        self.this_parameter
    }

    pub fn parameters(&self) -> List<'a, SymbolId> {
        self.parameters
    }

    pub fn has_rest_parameter(&self) -> bool {
        self.flags.intersects(SignatureFlags::HAS_REST_PARAMETER)
    }

    pub fn min_argument_count(&self) -> isize {
        self.min_argument_count as isize
    }
}

#[derive(Default)]
pub struct CompositeSignature<'a> {
    pub is_union: bool,                    // True for union, false for intersection
    pub signatures: List<'a, SignatureId>, // Individual signatures
}

checker_flags!(TypePredicateKind: i32 {
    THIS = 0,
    IDENTIFIER = 1,
    ASSERTS_THIS = 2,
    ASSERTS_IDENTIFIER = 3,
});

#[derive(Default)]
pub struct TypePredicate<'a> {
    pub kind: TypePredicateKind,
    pub parameter_index: i32,
    pub parameter_name: Text<'a>,
    pub t: TypeId,
}

impl<'a> TypePredicate<'a> {
    pub fn type_(&self) -> TypeId {
        self.t
    }

    pub fn kind(&self) -> TypePredicateKind {
        self.kind
    }

    pub fn parameter_index(&self) -> i32 {
        self.parameter_index
    }

    pub fn parameter_name(&self) -> Text<'a> {
        self.parameter_name
    }
}

// IndexInfo

#[derive(Default)]
pub struct IndexInfo<'a> {
    pub key_type: TypeId,
    pub value_type: TypeId,
    pub is_readonly: bool,
    pub declaration: NodeId,          // IndexSignatureDeclaration
    pub index_symbol: SymbolId,       // Synthetic property symbol for this index signature
    pub components: List<'a, NodeId>, // ElementWithComputedPropertyName
}

impl IndexInfo<'_> {
    pub fn key_type(&self) -> TypeId {
        self.key_type
    }

    pub fn value_type(&self) -> TypeId {
        self.value_type
    }

    pub fn is_readonly(&self) -> bool {
        self.is_readonly
    }

    pub fn declaration(&self) -> NodeId {
        self.declaration
    }
}

// Ternary values are defined such that x & y picks the lesser in the order False < Unknown < Maybe < True, and x | y picks the greater in the order False < Unknown < Maybe < True. Generally, Ternary.Maybe is used as the result of a relation that depends on itself, and Ternary.Unknown is used as the result of a variance check that depends on itself. We make a distinction because we don't want to cache circular variance check results.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct Ternary(pub i8);

impl Ternary {
    pub const FALSE: Self = Self(0);
    pub const UNKNOWN: Self = Self(1);
    pub const MAYBE: Self = Self(3);
    pub const TRUE: Self = Self(-1);
}

impl BitAnd for Ternary {
    type Output = Self;

    #[inline]
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl BitAndAssign for Ternary {
    #[inline]
    fn bitand_assign(&mut self, rhs: Self) {
        self.0 &= rhs.0;
    }
}

impl BitOr for Ternary {
    type Output = Self;

    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl BitOrAssign for Ternary {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

// `func(s *Type, t *Type, reportErrors bool) Ternary` upstream. A comparer is stored in an inference context, so it is a value here, and the checker calls what it names.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeComparer {
    #[default]
    Nil,
    // c.compareTypesAssignable, which NewChecker binds to compareTypesAssignableWorker
    Assignable,
    // r.isRelatedToWorker of a relater, and the closure of signatureRelatedTo over a relater and an intersection state
    Relater {
        r: RelaterId,
        intersection_state: IntersectionState,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct LanguageFeatureMinimumTargetMap {
    pub exponentiation: ScriptTarget,
    pub async_functions: ScriptTarget,
    pub for_await_of: ScriptTarget,
    pub async_generators: ScriptTarget,
    pub async_iteration: ScriptTarget,
    pub object_spread_rest: ScriptTarget,
    pub regular_expression_flags_dot_all: ScriptTarget,
    pub bindingless_catch: ScriptTarget,
    pub big_int: ScriptTarget,
    pub nullish_coalesce: ScriptTarget,
    pub optional_chaining: ScriptTarget,
    pub logical_assignment: ScriptTarget,
    pub top_level_await: ScriptTarget,
    pub class_fields: ScriptTarget,
    pub private_names_and_class_static_blocks: ScriptTarget,
    pub regular_expression_flags_has_indices: ScriptTarget,
    pub shebang_comments: ScriptTarget,
    pub using_and_await_using: ScriptTarget,
    pub class_and_class_element_decorators: ScriptTarget,
    pub regular_expression_flags_unicode_sets: ScriptTarget,
}

pub const LANGUAGE_FEATURE_MINIMUM_TARGET: LanguageFeatureMinimumTargetMap =
    LanguageFeatureMinimumTargetMap {
        exponentiation: ScriptTarget::ES2016,
        async_functions: ScriptTarget::ES2017,
        for_await_of: ScriptTarget::ES2018,
        async_generators: ScriptTarget::ES2018,
        async_iteration: ScriptTarget::ES2018,
        object_spread_rest: ScriptTarget::ES2018,
        regular_expression_flags_dot_all: ScriptTarget::ES2018,
        bindingless_catch: ScriptTarget::ES2019,
        big_int: ScriptTarget::ES2020,
        nullish_coalesce: ScriptTarget::ES2020,
        optional_chaining: ScriptTarget::ES2020,
        logical_assignment: ScriptTarget::ES2021,
        top_level_await: ScriptTarget::ES2022,
        class_fields: ScriptTarget::ES2022,
        private_names_and_class_static_blocks: ScriptTarget::ES2022,
        regular_expression_flags_has_indices: ScriptTarget::ES2022,
        shebang_comments: ScriptTarget::ES_NEXT,
        using_and_await_using: ScriptTarget::ES_NEXT,
        class_and_class_element_decorators: ScriptTarget::ES_NEXT,
        regular_expression_flags_unicode_sets: ScriptTarget::ES_NEXT,
    };

// Aliases for types
pub type StringLiteralType<'a> = Type<'a>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checker::SignatureId;

    // The numbers are what the constants of upstream evaluate to.
    #[test]
    fn flag_sets_keep_the_values_of_upstream() {
        assert_eq!(TypeFlags::NARROWABLE.0, 536575971);
        assert_eq!(TypeFlags::INCLUDES_MASK.0, 416808959);
        assert_eq!(TypeFlags::NOT_PRIMITIVE_UNION.0, 286523411);
        assert_eq!(TypeFlags::STRUCTURED_OR_INSTANTIABLE.0, 536346624);
        assert_eq!(TypeFlags::RESERVED3.0, 2147483648);
        assert_eq!(ObjectFlags::OBJECT_TYPE_KIND_MASK.0, 50332991);
        assert_eq!(ObjectFlags::PROPAGATING_FLAGS.0, 458752);
        assert_eq!(ObjectFlags::IS_CONSTRAINED_TYPE_VARIABLE.0, 134217728);
        assert_eq!(SignatureFlags::PROPAGATING_FLAGS.0, 335);
        assert_eq!(ExternalEmitHelpers::ASYNC_DELEGATOR_INCLUDES.0, 416);
        assert_eq!(ExternalEmitHelpers::LAST_EMIT_HELPER.0, 524288);
        assert_eq!(VarianceFlags::ALLOWS_STRUCTURAL_FALLBACK.0, 24);
        assert_eq!(ElementFlags::NON_REST.0, 11);
        assert_eq!(TypeFormatFlags::IN_TYPE_ALIAS.0, 8388608);
        assert_eq!(TypeFormatFlags::NODE_BUILDER_FLAGS_MASK.0, 1922071919);
        assert_eq!(AccessFlags::PERSISTENT.0, 1);
        assert_eq!(
            NodeCheckFlags::INITIALIZER_IS_UNDEFINED_COMPUTED.0,
            33554432
        );
        assert_eq!(TypePredicateKind::ASSERTS_IDENTIFIER.0, 3);
        assert_eq!(MembersOrExportsResolutionKind::RESOLVED_MEMBERS.0, 1);
        assert_eq!(ExhaustiveState::TRUE.0, 3);
        assert_eq!(EXTERNAL_HELPERS_MODULE_NAME_TEXT, b"tslib");
        assert!(
            TypeFlags::ENUM_LITERAL < TypeFlags::ENUM && TypeFlags::UNION < TypeFlags::INTERSECTION
        );
        assert_eq!(
            LANGUAGE_FEATURE_MINIMUM_TARGET.using_and_await_using,
            ScriptTarget::ES_NEXT
        );
        assert_eq!(
            LANGUAGE_FEATURE_MINIMUM_TARGET.exponentiation,
            ScriptTarget::ES2016
        );
    }

    #[test]
    fn flags_print_as_upstream_prints_them() {
        assert_eq!(TypeFlags::NONE.string(), b"None");
        assert_eq!(
            (TypeFlags::UNION | TypeFlags::ANY | TypeFlags::STRING).string(),
            b"Any|String|Union"
        );
        assert_eq!(
            format_type_flags(TypeFlags::RESERVED1),
            [b"None".as_slice()]
        );
        assert_eq!(
            format_type_flags(TypeFlags::NULLABLE),
            [b"Undefined".as_slice(), b"Null".as_slice()]
        );
        assert_eq!(VarianceFlags::INVARIANT.string(), b"in out");
        assert_eq!(VarianceFlags::CONTRAVARIANT.string(), b"in");
        assert_eq!(VarianceFlags::INDEPENDENT.string(), b"[independent]");
        assert_eq!(
            (VarianceFlags::COVARIANT | VarianceFlags::UNRELIABLE).string(),
            b"out (unreliable)"
        );
        assert_eq!(
            (VarianceFlags::BIVARIANT | VarianceFlags::UNMEASURABLE | VarianceFlags::UNRELIABLE)
                .string(),
            b"[bivariant] (unmeasurable)"
        );
        assert_eq!(
            (VarianceFlags::COVARIANT | VarianceFlags::INDEPENDENT).string(),
            b""
        );
        assert_eq!(SignatureKind::CALL.string(), b"SignatureKindCall");
        assert_eq!(SignatureKind::CONSTRUCT.string(), b"SignatureKindConstruct");
        assert_eq!(SignatureKind(7).string(), b"SignatureKind(7)");
        assert_eq!(SignatureKind(-1).string(), b"SignatureKind(-1)");
    }

    #[test]
    fn ternary_and_picks_the_lesser_and_or_the_greater() {
        assert_eq!(Ternary::TRUE & Ternary::MAYBE, Ternary::MAYBE);
        assert_eq!(Ternary::MAYBE & Ternary::UNKNOWN, Ternary::UNKNOWN);
        assert_eq!(Ternary::UNKNOWN & Ternary::FALSE, Ternary::FALSE);
        assert_eq!(Ternary::FALSE | Ternary::UNKNOWN, Ternary::UNKNOWN);
        assert_eq!(Ternary::UNKNOWN | Ternary::MAYBE, Ternary::MAYBE);
        assert_eq!(Ternary::MAYBE | Ternary::TRUE, Ternary::TRUE);
        let mut result = Ternary::TRUE;
        result &= Ternary::MAYBE;
        result |= Ternary::FALSE;
        assert_eq!(result, Ternary::MAYBE);
        assert_eq!(Ternary::default(), Ternary::FALSE);
    }

    #[test]
    fn a_record_is_named_by_its_id_and_nil_reads_as_the_zero_record() {
        let mut records: Records<SignatureId, u64> = Records::new();
        let first = records.alloc(7);
        let second = records.alloc(9);
        assert_eq!((first, second), (SignatureId(1), SignatureId(2)));
        assert_eq!((records[first], records[second]), (7, 9));
        assert_eq!(records.count(), 2);
        assert!(records.is_valid(second) && !records.is_valid(SignatureId::NIL));
        assert_eq!(records.nil_accesses(), 0);
        assert_eq!(records[SignatureId::NIL], 0);
        assert_eq!(records[SignatureId(40)], 0);
        assert_eq!(records.nil_reads(), 2);
        records[SignatureId::NIL] = 5;
        assert_eq!(records.nil_writes(), 1);
        assert_eq!(records[SignatureId::NIL], 0);
        records[first] += 1;
        assert_eq!(records[first], 8);
        records.clear();
        assert_eq!(records.count(), 0);
        assert_eq!(records.alloc(1), SignatureId(1));
    }

    #[test]
    fn the_parts_of_a_list_are_upstream_s_slices() {
        let ids = [TypeId(1), TypeId(2), TypeId(3), TypeId(4)];
        let interface = InterfaceType {
            all_type_parameters: List::from_slice(&ids),
            outer_type_parameter_count: 1,
            ..InterfaceType::default()
        };
        assert_eq!(interface.outer_type_parameters().as_slice(), [TypeId(1)]);
        assert_eq!(
            interface.local_type_parameters().as_slice(),
            [TypeId(2), TypeId(3)]
        );
        assert_eq!(
            interface.type_parameters().as_slice(),
            [TypeId(1), TypeId(2), TypeId(3)]
        );
        let none = InterfaceType::default();
        assert!(none.type_parameters().is_nil() && none.outer_type_parameters().is_nil());

        let signatures = [SignatureId(1), SignatureId(2), SignatureId(3)];
        let structured = StructuredType {
            signatures: List::from_slice(&signatures),
            call_signature_count: 1,
            ..StructuredType::default()
        };
        assert_eq!(structured.call_signatures().as_slice(), [SignatureId(1)]);
        assert_eq!(
            structured.construct_signatures().as_slice(),
            [SignatureId(2), SignatureId(3)]
        );
        let empty = StructuredType::default();
        assert!(empty.call_signatures().is_nil() && empty.construct_signatures().is_nil());

        let infos = [
            TupleElementInfo {
                flags: ElementFlags::REQUIRED,
                labeled_declaration: NodeId::NIL,
            },
            TupleElementInfo {
                flags: ElementFlags::REST,
                labeled_declaration: NodeId::NIL,
            },
        ];
        let tuple = TupleType {
            element_infos: List::from_slice(&infos),
            fixed_length: 1,
            ..TupleType::default()
        };
        assert_eq!(
            tuple.element_flags(),
            [ElementFlags::REQUIRED, ElementFlags::REST]
        );
        assert_eq!(tuple.fixed_length(), 1);
        assert!(tuple.type_parameters().is_nil());
    }
}
