// Second half of the data model: signatures, index infos, mappers, links (types.go 169-424, 1289-1423, mapper.go, links.go).
// Append to types.rs. In the crate it is checker/types.rs and checker/mapper.rs.
use crate::golang::{List, Map, Text};
use crate::ids::*;
use crate::keys::CacheHashKey;

// Every signature comes from newSignature, so the arena index is `id`. resolved_min_argument_count starts at -1.
#[derive(Default)]
pub struct Signature<'a> {
    pub id: SignatureId,
    pub flags: u32,
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

#[derive(Default)]
pub struct CompositeSignature<'a> {
    pub is_union: bool,
    pub signatures: List<'a, SignatureId>,
}

// TypePredicateKind: This 0, Identifier 1, AssertsThis 2, AssertsIdentifier 3. noTypePredicate is the first one allocated.
#[derive(Default)]
pub struct TypePredicate<'a> {
    pub kind: i32,
    pub parameter_index: i32,
    pub parameter_name: Text<'a>,
    pub t: TypeId,
}

// enumNumberIndexInfo and anyBaseTypeIndexInfo live in the same arena: upstream compares them by pointer.
#[derive(Default)]
pub struct IndexInfo<'a> {
    pub key_type: TypeId,
    pub value_type: TypeId,
    pub is_readonly: bool,
    pub declaration: NodeId,
    pub index_symbol: SymbolId,
    pub components: List<'a, NodeId>,
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeMapperKind {
    #[default]
    Unknown,
    Simple,
    Array,
    Merged,
}

// The five method values that NewChecker wraps with newFunctionTypeMapper, in upstream's order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FunctionMapper {
    UniqueLiteral,
    ReportUnreliable,
    ReportUnmeasurable,
    Restrictive,
    Permissive,
}

// Kind() is Unknown for ArrayToSingle, Deferred, Function, Composite and Inference, as TypeMapperBase answers.
#[derive(Default)]
pub enum TypeMapper<'a> {
    #[default]
    Nil,
    Simple {
        source: TypeId,
        target: TypeId,
    },
    Array {
        sources: List<'a, TypeId>,
        targets: List<'a, TypeId>,
    },
    ArrayToSingle {
        sources: List<'a, TypeId>,
        target: TypeId,
    },
    // The only maker is getInferredTypeParameterConstraint: target i is getEffectiveTypeArgumentAtIndex(parent, type_parameters, i).
    Deferred {
        sources: List<'a, TypeId>,
        parent: NodeId,
        type_parameters: List<'a, TypeId>,
    },
    Function(FunctionMapper),
    Merged {
        m1: TypeMapperId,
        m2: TypeMapperId,
    },
    Composite {
        m1: TypeMapperId,
        m2: TypeMapperId,
    },
    Inference {
        n: InferenceContextId,
        fixing: bool,
    },
}

#[derive(Default)]
pub struct SymbolReferenceLinks {
    pub reference_kinds: u32,
}

#[derive(Default)]
pub struct ValueSymbolLinks {
    pub resolved_type: TypeId,
    pub write_type: TypeId,
    pub target: SymbolId,
    pub mapper: TypeMapperId,
    pub name_type: TypeId,
    pub containing_type: TypeId,
    pub function_or_constructor_checked: bool,
}

#[derive(Default)]
pub struct AliasSymbolLinks {
    pub immediate_target: SymbolId,
    pub alias_target: SymbolId,
    pub referenced: bool,
    pub type_only_declaration: NodeId,
}

// resolved_exports NIL means not computed: getExportsOfModuleWorker never returns a nil table.
#[derive(Default)]
pub struct ModuleSymbolLinks<'a> {
    pub resolved_exports: SymbolTableId,
    pub type_only_export_star_map: Map<Text<'a>, NodeId>,
    pub exports_checked: bool,
}

#[derive(Default)]
pub struct LateBoundLinks {
    pub late_symbol: SymbolId,
}

#[derive(Default)]
pub struct ExportTypeLinks {
    pub target: SymbolId,
    pub originating_import: NodeId,
}

// Indexed by MembersOrExportsResolutionKind: 0 resolved exports, 1 resolved members. NIL is recomputed on every call.
#[derive(Default)]
pub struct MembersAndExportsLinks(pub [SymbolTableId; 2]);

#[derive(Default)]
pub struct TypeAliasLinks<'a> {
    pub declared_type: TypeId,
    pub type_parameters: List<'a, TypeId>,
    pub instantiations: Map<CacheHashKey, TypeId>,
    pub is_constructor_declared_property: bool,
}

#[derive(Default)]
pub struct DeclaredTypeLinks {
    pub declared_type: TypeId,
    pub interface_checked: bool,
    pub index_signatures_checked: bool,
    pub type_parameters_checked: bool,
    pub enum_checked: bool,
}

// declaration_requires_scope_change is core.Tristate: 0 unknown, 1 false, 2 true.
#[derive(Default)]
pub struct NodeLinks {
    pub flags: u32,
    pub declaration_requires_scope_change: u8,
    pub has_reported_statement_in_ambient_context: bool,
}

#[derive(Default)]
pub struct SymbolNodeLinks {
    pub resolved_symbol: SymbolId,
}

#[derive(Default)]
pub struct TypeNodeLinks<'a> {
    pub resolved_type: TypeId,
    pub outer_type_parameters: List<'a, TypeId>,
}

// Links of later layers keep upstream's fields one to one: MappedSymbolLinks, DeferredSymbolLinks, ReverseMappedSymbolLinks,
// SpreadLinks, VarianceLinks, MarkedAssignmentSymbolLinks, ContainingSymbolLinks, SwitchStatementLinks, ArrayLiteralLinks,
// ComputedNameNodeLinks (has_name is Option<bool>), EnumMemberLinks, AssertionLinks, SourceFileLinks, SignatureLinks.
