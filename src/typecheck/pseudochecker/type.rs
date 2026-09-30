// pseudochecker/type.go: the types that the pseudochecker makes. `*PseudoType` is a shared pointer; a cast to the wrong data gives an empty record where upstream panics.
use crate::ast::NodeId;
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PseudoTypeKind {
    Direct,
    Inferred,
    NoResult,
    MaybeConstLocation,
    Union,
    Undefined,
    Null,
    Any,
    String,
    Number,
    BigInt,
    Boolean,
    False,
    True,
    SingleCallSignature,
    Tuple,
    ObjectLiteral,
    StringLiteral,
    NumericLiteral,
    BigIntLiteral,
}

// A `*PseudoType` that can be nil.
pub type PseudoTypeRef = Option<Arc<PseudoType>>;

pub struct PseudoType {
    pub kind: PseudoTypeKind,
    data: PseudoTypeData,
}

enum PseudoTypeData {
    Base,
    Direct(PseudoTypeDirect),
    Inferred(PseudoTypeInferred),
    NoResult(PseudoTypeNoResult),
    MaybeConstLocation(PseudoTypeMaybeConstLocation),
    Union(PseudoTypeUnion),
    SingleCallSignature(PseudoTypeSingleCallSignature),
    Tuple(PseudoTypeTuple),
    ObjectLiteral(PseudoTypeObjectLiteral),
    Literal(PseudoTypeLiteral),
}

fn new_pseudo_type(kind: PseudoTypeKind, data: PseudoTypeData) -> Arc<PseudoType> {
    Arc::new(PseudoType { kind, data })
}

// Upstream keeps one value for each of these: only the kind of such a type is ever read.
pub fn pseudo_type_undefined() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::Undefined, PseudoTypeData::Base)
}
pub fn pseudo_type_null() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::Null, PseudoTypeData::Base)
}
pub fn pseudo_type_any() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::Any, PseudoTypeData::Base)
}
pub fn pseudo_type_string() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::String, PseudoTypeData::Base)
}
pub fn pseudo_type_number() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::Number, PseudoTypeData::Base)
}
pub fn pseudo_type_big_int() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::BigInt, PseudoTypeData::Base)
}
pub fn pseudo_type_boolean() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::Boolean, PseudoTypeData::Base)
}
pub fn pseudo_type_false() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::False, PseudoTypeData::Base)
}
pub fn pseudo_type_true() -> Arc<PseudoType> {
    new_pseudo_type(PseudoTypeKind::True, PseudoTypeData::Base)
}

// PseudoTypeDirect directly encodes the type referred to by a given TypeNode
pub struct PseudoTypeDirect {
    pub type_node: NodeId,
}

static NIL_DIRECT: PseudoTypeDirect = PseudoTypeDirect {
    type_node: NodeId::NIL,
};

pub fn new_pseudo_type_direct(type_node: NodeId) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::Direct,
        PseudoTypeData::Direct(PseudoTypeDirect { type_node }),
    )
}

// PseudoTypeInferred directly encodes the type referred to by a given Expression: these represent cases where the expression was too complex for the pseudochecker.
pub struct PseudoTypeInferred {
    pub expression: NodeId,
    pub error_nodes: Vec<NodeId>,
    pub is_signature_return: bool,
}

static NIL_INFERRED: PseudoTypeInferred = PseudoTypeInferred {
    expression: NodeId::NIL,
    error_nodes: Vec::new(),
    is_signature_return: false,
};

pub fn new_pseudo_type_inferred(expr: NodeId, is_signature_return: bool) -> Arc<PseudoType> {
    new_pseudo_type_inferred_with_errors(expr, is_signature_return, Vec::new())
}

pub fn new_pseudo_type_inferred_with_errors(
    expr: NodeId,
    is_signature_return: bool,
    error_nodes: Vec<NodeId>,
) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::Inferred,
        PseudoTypeData::Inferred(PseudoTypeInferred {
            expression: expr,
            error_nodes,
            is_signature_return,
        }),
    )
}

// PseudoTypeNoResult is anlogous to PseudoTypeInferred in that it references a case where the type was too complex for the pseudochecker: it refers to the declaration as a whole.
pub struct PseudoTypeNoResult {
    pub declaration: NodeId,
}

static NIL_NO_RESULT: PseudoTypeNoResult = PseudoTypeNoResult {
    declaration: NodeId::NIL,
};

pub fn new_pseudo_type_no_result(decl: NodeId) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::NoResult,
        PseudoTypeData::NoResult(PseudoTypeNoResult { declaration: decl }),
    )
}

// PseudoTypeMaybeConstLocation encodes the const/regular types of a location so the builder can later select the appropriate type depending on contextual typing.
pub struct PseudoTypeMaybeConstLocation {
    pub node: NodeId,
    pub const_type: PseudoTypeRef,
    pub regular_type: PseudoTypeRef,
}

static NIL_MAYBE_CONST_LOCATION: PseudoTypeMaybeConstLocation = PseudoTypeMaybeConstLocation {
    node: NodeId::NIL,
    const_type: None,
    regular_type: None,
};

pub fn new_pseudo_type_maybe_const_location(
    loc: NodeId,
    ct: PseudoTypeRef,
    reg: PseudoTypeRef,
) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::MaybeConstLocation,
        PseudoTypeData::MaybeConstLocation(PseudoTypeMaybeConstLocation {
            node: loc,
            const_type: ct,
            regular_type: reg,
        }),
    )
}

// PseudoTypeUnion is a collection of psuedotypes joined into a union
pub struct PseudoTypeUnion {
    pub types: Vec<PseudoTypeRef>,
}

static NIL_UNION: PseudoTypeUnion = PseudoTypeUnion { types: Vec::new() };

pub fn new_pseudo_type_union(types: Vec<PseudoTypeRef>) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::Union,
        PseudoTypeData::Union(PseudoTypeUnion { types }),
    )
}

pub struct PseudoParameter {
    pub rest: bool,
    pub name: NodeId,
    pub optional: bool,
    pub type_: PseudoTypeRef,
}

pub fn new_pseudo_parameter(
    is_rest: bool,
    name: NodeId,
    is_optional: bool,
    t: PseudoTypeRef,
) -> PseudoParameter {
    PseudoParameter {
        rest: is_rest,
        name,
        optional: is_optional,
        type_: t,
    }
}

// PseudoTypeSingleCallSignature represents an object type with a single call signature, like an arrow or function expression
pub struct PseudoTypeSingleCallSignature {
    pub signature: NodeId,
    pub parameters: Vec<PseudoParameter>,
    pub type_parameters: Vec<NodeId>,
    pub return_type: PseudoTypeRef,
}

static NIL_SINGLE_CALL_SIGNATURE: PseudoTypeSingleCallSignature = PseudoTypeSingleCallSignature {
    signature: NodeId::NIL,
    parameters: Vec::new(),
    type_parameters: Vec::new(),
    return_type: None,
};

pub fn new_pseudo_type_single_call_signature(
    signature: NodeId,
    parameters: Vec<PseudoParameter>,
    type_parameters: Vec<NodeId>,
    return_type: PseudoTypeRef,
) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::SingleCallSignature,
        PseudoTypeData::SingleCallSignature(PseudoTypeSingleCallSignature {
            signature,
            parameters,
            type_parameters,
            return_type,
        }),
    )
}

pub struct PseudoTypeTuple {
    pub elements: Vec<PseudoTypeRef>,
}

static NIL_TUPLE: PseudoTypeTuple = PseudoTypeTuple {
    elements: Vec::new(),
};

pub fn new_pseudo_type_tuple(elements: Vec<PseudoTypeRef>) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::Tuple,
        PseudoTypeData::Tuple(PseudoTypeTuple { elements }),
    )
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PseudoObjectElementKind {
    Method,
    PropertyAssignment,
    SetAccessor,
    GetAccessor,
}

pub struct PseudoObjectElement {
    pub name: NodeId,
    pub optional: bool,
    pub kind: PseudoObjectElementKind,
    data: PseudoObjectElementData,
}

enum PseudoObjectElementData {
    Method(PseudoObjectMethod),
    PropertyAssignment(PseudoPropertyAssignment),
    SetAccessor(PseudoSetAccessor),
    GetAccessor(PseudoGetAccessor),
}

impl PseudoObjectElement {
    pub fn signature(&self) -> NodeId {
        match &self.data {
            PseudoObjectElementData::Method(d) => d.signature,
            PseudoObjectElementData::SetAccessor(d) => d.signature,
            PseudoObjectElementData::GetAccessor(d) => d.signature,
            PseudoObjectElementData::PropertyAssignment(_) => NodeId::NIL,
        }
    }
}

pub struct PseudoObjectMethod {
    pub signature: NodeId,
    pub type_parameters: Vec<NodeId>,
    pub parameters: Vec<PseudoParameter>,
    pub return_type: PseudoTypeRef,
}

static NIL_OBJECT_METHOD: PseudoObjectMethod = PseudoObjectMethod {
    signature: NodeId::NIL,
    type_parameters: Vec::new(),
    parameters: Vec::new(),
    return_type: None,
};

pub fn new_pseudo_object_method(
    signature: NodeId,
    name: NodeId,
    optional: bool,
    type_parameters: Vec<NodeId>,
    parameters: Vec<PseudoParameter>,
    return_type: PseudoTypeRef,
) -> PseudoObjectElement {
    PseudoObjectElement {
        name,
        optional,
        kind: PseudoObjectElementKind::Method,
        data: PseudoObjectElementData::Method(PseudoObjectMethod {
            signature,
            type_parameters,
            parameters,
            return_type,
        }),
    }
}

pub struct PseudoPropertyAssignment {
    pub readonly: bool,
    pub type_: PseudoTypeRef,
}

static NIL_PROPERTY_ASSIGNMENT: PseudoPropertyAssignment = PseudoPropertyAssignment {
    readonly: false,
    type_: None,
};

pub fn new_pseudo_property_assignment(
    readonly: bool,
    name: NodeId,
    optional: bool,
    t: PseudoTypeRef,
) -> PseudoObjectElement {
    PseudoObjectElement {
        name,
        optional,
        kind: PseudoObjectElementKind::PropertyAssignment,
        data: PseudoObjectElementData::PropertyAssignment(PseudoPropertyAssignment {
            readonly,
            type_: t,
        }),
    }
}

pub struct PseudoSetAccessor {
    pub signature: NodeId,
    pub parameter: Option<PseudoParameter>,
}

static NIL_SET_ACCESSOR: PseudoSetAccessor = PseudoSetAccessor {
    signature: NodeId::NIL,
    parameter: None,
};

pub fn new_pseudo_set_accessor(
    signature: NodeId,
    name: NodeId,
    optional: bool,
    p: Option<PseudoParameter>,
) -> PseudoObjectElement {
    PseudoObjectElement {
        name,
        optional,
        kind: PseudoObjectElementKind::SetAccessor,
        data: PseudoObjectElementData::SetAccessor(PseudoSetAccessor {
            signature,
            parameter: p,
        }),
    }
}

pub struct PseudoGetAccessor {
    pub signature: NodeId,
    pub type_: PseudoTypeRef,
}

static NIL_GET_ACCESSOR: PseudoGetAccessor = PseudoGetAccessor {
    signature: NodeId::NIL,
    type_: None,
};

pub fn new_pseudo_get_accessor(
    signature: NodeId,
    name: NodeId,
    optional: bool,
    t: PseudoTypeRef,
) -> PseudoObjectElement {
    PseudoObjectElement {
        name,
        optional,
        kind: PseudoObjectElementKind::GetAccessor,
        data: PseudoObjectElementData::GetAccessor(PseudoGetAccessor {
            signature,
            type_: t,
        }),
    }
}

impl PseudoObjectElement {
    pub fn as_pseudo_object_method(&self) -> &PseudoObjectMethod {
        match &self.data {
            PseudoObjectElementData::Method(d) => d,
            _ => &NIL_OBJECT_METHOD,
        }
    }

    pub fn as_pseudo_property_assignment(&self) -> &PseudoPropertyAssignment {
        match &self.data {
            PseudoObjectElementData::PropertyAssignment(d) => d,
            _ => &NIL_PROPERTY_ASSIGNMENT,
        }
    }

    pub fn as_pseudo_set_accessor(&self) -> &PseudoSetAccessor {
        match &self.data {
            PseudoObjectElementData::SetAccessor(d) => d,
            _ => &NIL_SET_ACCESSOR,
        }
    }

    pub fn as_pseudo_get_accessor(&self) -> &PseudoGetAccessor {
        match &self.data {
            PseudoObjectElementData::GetAccessor(d) => d,
            _ => &NIL_GET_ACCESSOR,
        }
    }
}

pub struct PseudoTypeObjectLiteral {
    pub elements: Vec<PseudoObjectElement>,
}

static NIL_OBJECT_LITERAL: PseudoTypeObjectLiteral = PseudoTypeObjectLiteral {
    elements: Vec::new(),
};

pub fn new_pseudo_type_object_literal(elements: Vec<PseudoObjectElement>) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::ObjectLiteral,
        PseudoTypeData::ObjectLiteral(PseudoTypeObjectLiteral { elements }),
    )
}

pub struct PseudoTypeLiteral {
    pub node: NodeId,
}

static NIL_LITERAL: PseudoTypeLiteral = PseudoTypeLiteral { node: NodeId::NIL };

pub fn new_pseudo_type_string_literal(node: NodeId) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::StringLiteral,
        PseudoTypeData::Literal(PseudoTypeLiteral { node }),
    )
}

pub fn new_pseudo_type_numeric_literal(node: NodeId) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::NumericLiteral,
        PseudoTypeData::Literal(PseudoTypeLiteral { node }),
    )
}

pub fn new_pseudo_type_big_int_literal(node: NodeId) -> Arc<PseudoType> {
    new_pseudo_type(
        PseudoTypeKind::BigIntLiteral,
        PseudoTypeData::Literal(PseudoTypeLiteral { node }),
    )
}

impl PseudoType {
    pub fn as_pseudo_type_direct(&self) -> &PseudoTypeDirect {
        match &self.data {
            PseudoTypeData::Direct(d) => d,
            _ => &NIL_DIRECT,
        }
    }

    pub fn as_pseudo_type_inferred(&self) -> &PseudoTypeInferred {
        match &self.data {
            PseudoTypeData::Inferred(d) => d,
            _ => &NIL_INFERRED,
        }
    }

    pub fn as_pseudo_type_no_result(&self) -> &PseudoTypeNoResult {
        match &self.data {
            PseudoTypeData::NoResult(d) => d,
            _ => &NIL_NO_RESULT,
        }
    }

    pub fn as_pseudo_type_maybe_const_location(&self) -> &PseudoTypeMaybeConstLocation {
        match &self.data {
            PseudoTypeData::MaybeConstLocation(d) => d,
            _ => &NIL_MAYBE_CONST_LOCATION,
        }
    }

    pub fn as_pseudo_type_union(&self) -> &PseudoTypeUnion {
        match &self.data {
            PseudoTypeData::Union(d) => d,
            _ => &NIL_UNION,
        }
    }

    pub fn as_pseudo_type_single_call_signature(&self) -> &PseudoTypeSingleCallSignature {
        match &self.data {
            PseudoTypeData::SingleCallSignature(d) => d,
            _ => &NIL_SINGLE_CALL_SIGNATURE,
        }
    }

    pub fn as_pseudo_type_tuple(&self) -> &PseudoTypeTuple {
        match &self.data {
            PseudoTypeData::Tuple(d) => d,
            _ => &NIL_TUPLE,
        }
    }

    pub fn as_pseudo_type_object_literal(&self) -> &PseudoTypeObjectLiteral {
        match &self.data {
            PseudoTypeData::ObjectLiteral(d) => d,
            _ => &NIL_OBJECT_LITERAL,
        }
    }

    pub fn as_pseudo_type_literal(&self) -> &PseudoTypeLiteral {
        match &self.data {
            PseudoTypeData::Literal(d) => d,
            _ => &NIL_LITERAL,
        }
    }
}
