use crate::Span;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Syntax {
    Proto2,
    Proto3,
    Editions,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Presence {
    Explicit,
    Implicit,
    Required,
}

/// <https://protobuf.dev/editions/features/>. `None` is inherited from the enclosing declaration.
#[derive(Clone, Copy, Default)]
pub(crate) struct Features {
    pub(crate) presence: Option<Presence>,
    pub(crate) is_enum_closed: Option<bool>,
    pub(crate) is_packed: Option<bool>,
    pub(crate) verifies_utf8: Option<bool>,
    pub(crate) is_delimited: Option<bool>,
}

impl Features {
    pub(crate) fn defaults_of(syntax: Syntax) -> Features {
        let is_proto2 = syntax == Syntax::Proto2;
        Features {
            presence: Some(match syntax {
                Syntax::Proto3 => Presence::Implicit,
                Syntax::Proto2 | Syntax::Editions => Presence::Explicit,
            }),
            is_enum_closed: Some(is_proto2),
            is_packed: Some(!is_proto2),
            verifies_utf8: Some(!is_proto2),
            is_delimited: Some(false),
        }
    }

    pub(crate) fn inside(self, parent: Features) -> Features {
        Features {
            presence: self.presence.or(parent.presence),
            is_enum_closed: self.is_enum_closed.or(parent.is_enum_closed),
            is_packed: self.is_packed.or(parent.is_packed),
            verifies_utf8: self.verifies_utf8.or(parent.verifies_utf8),
            is_delimited: self.is_delimited.or(parent.is_delimited),
        }
    }
}

#[derive(Clone)]
pub(crate) struct Name {
    pub(crate) text: String,
    pub(crate) span: Span,
}

#[derive(Default)]
pub(crate) struct Doc {
    pub(crate) lines: Vec<String>,
    pub(crate) is_deprecated: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scalar {
    Double,
    Float,
    Int32,
    Int64,
    Uint32,
    Uint64,
    Sint32,
    Sint64,
    Fixed32,
    Fixed64,
    Sfixed32,
    Sfixed64,
    Bool,
    String,
    Bytes,
}

impl Scalar {
    pub(crate) fn from_name(name: &str) -> Option<Scalar> {
        Some(match name {
            "double" => Scalar::Double,
            "float" => Scalar::Float,
            "int32" => Scalar::Int32,
            "int64" => Scalar::Int64,
            "uint32" => Scalar::Uint32,
            "uint64" => Scalar::Uint64,
            "sint32" => Scalar::Sint32,
            "sint64" => Scalar::Sint64,
            "fixed32" => Scalar::Fixed32,
            "fixed64" => Scalar::Fixed64,
            "sfixed32" => Scalar::Sfixed32,
            "sfixed64" => Scalar::Sfixed64,
            "bool" => Scalar::Bool,
            "string" => Scalar::String,
            "bytes" => Scalar::Bytes,
            _ => return None,
        })
    }
}

pub(crate) enum FieldType {
    Scalar(Scalar),
    Named(Name),
}

pub(crate) enum ConstantValue {
    Identifier(String),
    Integer(u64),
    Float(f64),
    String(Vec<u8>),
    Aggregate,
}

pub(crate) struct Constant {
    pub(crate) is_negative: bool,
    pub(crate) value: ConstantValue,
    pub(crate) span: Span,
}

pub(crate) enum Cardinality {
    Single,
    Repeated,
    Map { key: Scalar },
}

pub(crate) struct Field {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) number: u32,
    pub(crate) number_span: Span,
    pub(crate) cardinality: Cardinality,
    pub(crate) r#type: FieldType,
    /// Index in [`Message::oneofs`].
    pub(crate) oneof: Option<usize>,
    pub(crate) default: Option<Constant>,
    /// Labels, `group` and `[packed = ..]` are the features that replace them in editions.
    pub(crate) features: Features,
}

pub(crate) struct Oneof {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) features: Features,
}

#[derive(Default)]
pub(crate) struct Types {
    pub(crate) messages: Vec<Message>,
    pub(crate) enums: Vec<Enum>,
}

pub(crate) struct Message {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) features: Features,
    pub(crate) fields: Vec<Field>,
    pub(crate) oneofs: Vec<Oneof>,
    pub(crate) nested: Types,
}

pub(crate) struct EnumValue {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) number: i32,
}

pub(crate) struct Enum {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) features: Features,
    /// Never empty.
    pub(crate) values: Vec<EnumValue>,
}

pub(crate) struct Method {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) request: Name,
    pub(crate) response: Name,
    pub(crate) streams_requests: bool,
    pub(crate) streams_responses: bool,
}

pub(crate) struct Service {
    pub(crate) name: Name,
    pub(crate) doc: Doc,
    pub(crate) methods: Vec<Method>,
}

pub(crate) struct Import {
    pub(crate) path: Name,
    pub(crate) is_public: bool,
}

pub(crate) struct File {
    pub(crate) package: String,
    pub(crate) imports: Vec<Import>,
    /// No feature is `None`.
    pub(crate) features: Features,
    pub(crate) types: Types,
    pub(crate) services: Vec<Service>,
}
