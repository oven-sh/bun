use super::Writer;
use crate::atom::{Atom, number_to_string, written_name};
use crate::check::aot::{
    BuiltinTypeClass, CheckedType, ClassMember, ClassMemberSource, EnumConstant, GaveUp,
    IndexSignature, MemberLookup, MemberName, ObjectMember, PositionTypes, PrimitiveKinds,
    ShapeKind, SignatureShape, Trust, TupleElement, TypeArgument, TypeIdentity, TypeParameterRef,
    TypeShape, WrittenType,
};
use crate::hir::start_of;
use crate::program::FileId;
use crate::types::{EnumValue, TypeId};

fn string_literal_text(text: &[u8]) -> Vec<u8> {
    [b"\"", text, b"\""].concat()
}

fn wrapped(name: &str, inner: &[u8]) -> Vec<u8> {
    [name.as_bytes(), b"(", inner, b")"].concat()
}

pub(super) fn gave_up_text(reason: GaveUp) -> Vec<u8> {
    format!("gave up: {reason:?}").into_bytes()
}

pub(super) fn bool_text(value: bool) -> Vec<u8> {
    value.to_string().into_bytes()
}

pub(super) fn identity_text(identity: TypeIdentity) -> Vec<u8> {
    let [high, low] = identity.0;
    format!("{high:016x}{low:016x}").into_bytes()
}

pub(super) fn primitives_text(kinds: PrimitiveKinds) -> Vec<u8> {
    let names: [(PrimitiveKinds, &[u8]); 5] = [
        (PrimitiveKinds::STRING, b"string"),
        (PrimitiveKinds::NUMBER, b"number"),
        (PrimitiveKinds::BOOLEAN, b"boolean"),
        (PrimitiveKinds::BIGINT, b"bigint"),
        (PrimitiveKinds::SYMBOL, b"symbol"),
    ];
    let set = names.iter().filter(|(kind, _)| kinds.contains(*kind));
    let set: Vec<&[u8]> = set.map(|(_, name)| *name).collect();
    match set.is_empty() {
        true => b"none".to_vec(),
        false => set.join(&b' '),
    }
}

impl Writer<'_, '_, '_, '_> {
    pub(super) fn optional_type_text(&mut self, ty: Option<TypeId>) -> Vec<u8> {
        match ty {
            Some(ty) => self.queries.type_text(ty),
            None => b"none".to_vec(),
        }
    }

    pub(super) fn written_text(&mut self, written: WrittenType) -> Vec<u8> {
        match written {
            WrittenType::Written(ty) => self.queries.type_text(ty),
            WrittenType::Unwritten => b"unwritten".to_vec(),
            WrittenType::GaveUp(reason) => gave_up_text(reason),
        }
    }

    pub(super) fn checked_text(&mut self, checked: CheckedType) -> Vec<u8> {
        match checked {
            Ok(ty) => self.queries.type_text(ty),
            Err(reason) => gave_up_text(reason),
        }
    }

    pub(super) fn position_text(&mut self, types: PositionTypes) -> Vec<u8> {
        let mut text = self.written_text(types.written);
        text.extend_from_slice(b" checked ");
        text.extend_from_slice(&self.checked_text(types.checked));
        text
    }

    fn member_name_text(&self, name: MemberName) -> Vec<u8> {
        match name {
            MemberName::String(name) => self.queries.atom_bytes(name).to_vec(),
            MemberName::Symbol(_) => b"[symbol]".to_vec(),
            MemberName::Private(name) => written_name(self.queries.atom_bytes(name)).to_vec(),
        }
    }

    pub(super) fn enum_value_text(&self, value: EnumValue) -> Vec<u8> {
        match value {
            EnumValue::String(text) => string_literal_text(self.queries.atom_bytes(text)),
            EnumValue::Number(bits) => number_to_string(f64::from_bits(bits)),
        }
    }

    pub(super) fn enum_constant_text(&self, constant: EnumConstant) -> Vec<u8> {
        let mut text = self.enum_value_text(constant.value);
        if constant.reads_other_file_or_variable {
            text.extend_from_slice(b" reads other file or variable");
        }
        if constant.rests_on_inexact_power {
            text.extend_from_slice(b" rests on inexact power");
        }
        text
    }

    pub(super) fn object_member_text(&mut self, member: &ObjectMember) -> Vec<u8> {
        let mut text = self.member_name_text(member.name);
        text.extend_from_slice(format!(" {:?} ", member.kind).as_bytes());
        text.extend_from_slice(&self.position_text(member.types));
        if member.is_optional {
            text.extend_from_slice(b" optional");
        }
        if member.is_readonly {
            text.extend_from_slice(b" readonly");
        }
        text
    }

    pub(super) fn index_signature_text(&mut self, signature: &IndexSignature) -> Vec<u8> {
        let key = format!("{:?} ", signature.key).into_bytes();
        [key, self.position_text(signature.types)].concat()
    }

    pub(super) fn signature_text(&mut self, signature: &SignatureShape<'_>) -> Vec<u8> {
        let mut parameters = Vec::with_capacity(signature.parameters.len());
        for parameter in signature.parameters {
            let mut text = Vec::new();
            if parameter.is_rest {
                text.extend_from_slice(b"...");
            }
            text.extend_from_slice(&self.position_text(parameter.types));
            if parameter.is_optional {
                text.push(b'?');
            }
            parameters.push(text);
        }
        let mut text = wrapped("", &parameters.join(&b", "[..]));
        text.extend_from_slice(b" this ");
        text.extend_from_slice(&self.position_text(signature.this_type));
        text.extend_from_slice(b" returns ");
        text.extend_from_slice(&self.position_text(signature.result));
        if signature.has_type_parameters {
            text.extend_from_slice(b" generic");
        }
        text
    }

    fn type_list_text(&mut self, types: &[TypeId], separator: &[u8]) -> Vec<u8> {
        let texts: Vec<Vec<u8>> = types.iter().map(|&ty| self.queries.type_text(ty)).collect();
        texts.join(separator)
    }

    fn template_literal_text(&mut self, texts: &[Atom], types: &[TypeId]) -> Vec<u8> {
        let mut parts = Vec::with_capacity(texts.len() + types.len());
        for (index, &text) in texts.iter().enumerate() {
            parts.push(string_literal_text(self.queries.atom_bytes(text)));
            if let Some(&ty) = types.get(index) {
                parts.push(self.queries.type_text(ty));
            }
        }
        parts.join(&b", "[..])
    }

    fn tuple_text(&mut self, elements: &[TupleElement], is_readonly: bool) -> Vec<u8> {
        let mut parts = Vec::with_capacity(elements.len());
        for element in elements {
            let kind = format!("{:?} ", element.kind).into_bytes();
            parts.push([kind, self.queries.type_text(element.ty)].concat());
        }
        let prefix: &[u8] = if is_readonly { b"readonly " } else { b"" };
        [prefix, &parts.join(&b", "[..])[..]].concat()
    }

    fn builtin_text(&mut self, class: BuiltinTypeClass, arguments: &[TypeId]) -> Vec<u8> {
        let (class_index, type_name) = (class.class.0, class.type_name);
        let name = format!("{class_index}.{type_name} {:?}", class.denotation);
        if arguments.is_empty() {
            return name.into_bytes();
        }
        [
            name.as_bytes(),
            b"; ",
            &self.type_list_text(arguments, b", ")[..],
        ]
        .concat()
    }

    fn type_parameter_text(&self, parameter: TypeParameterRef) -> Vec<u8> {
        if !self.is_under_root(parameter.file) {
            return b"outside".to_vec();
        }
        let index = format!(":{}", parameter.parameter.0);
        [self.relative_path(parameter.file), index.as_bytes()].concat()
    }

    fn type_variable_text(
        &mut self,
        constraint: Option<TypeId>,
        parameter: Option<TypeParameterRef>,
    ) -> Vec<u8> {
        let constraint = self.optional_type_text(constraint);
        match parameter {
            Some(parameter) => [
                &constraint[..],
                b"; ",
                &self.type_parameter_text(parameter)[..],
            ]
            .concat(),
            None => constraint,
        }
    }

    pub(super) fn type_argument_text(&mut self, pair: TypeArgument) -> Vec<u8> {
        let parameter = self.queries.type_text(pair.parameter);
        let argument = self.queries.type_text(pair.argument);
        [&parameter[..], b" = ", &argument[..]].concat()
    }

    pub(super) fn shape_text(&mut self, shape: TypeShape<'_>) -> Vec<u8> {
        let mut text = self.shape_kind_text(shape.kind);
        match shape.trust {
            Trust::Trusted => {}
            Trust::Untrusted => text.extend_from_slice(b" untrusted"),
        }
        text
    }

    fn shape_kind_text(&mut self, kind: ShapeKind<'_>) -> Vec<u8> {
        match kind {
            ShapeKind::Anything(reason) => format!("Anything({reason:?})").into_bytes(),
            ShapeKind::TypeVariable {
                constraint,
                parameter,
            } => wrapped(
                "TypeVariable",
                &self.type_variable_text(constraint, parameter),
            ),
            ShapeKind::Never => b"Never".to_vec(),
            ShapeKind::Undefined => b"Undefined".to_vec(),
            ShapeKind::Null => b"Null".to_vec(),
            ShapeKind::Boolean => b"Boolean".to_vec(),
            ShapeKind::BooleanLiteral(value) => wrapped("BooleanLiteral", &bool_text(value)),
            ShapeKind::Number => b"Number".to_vec(),
            ShapeKind::NumberLiteral(value) => wrapped("NumberLiteral", &number_to_string(value)),
            ShapeKind::NumericEnumMember(value) => {
                wrapped("NumericEnumMember", &number_to_string(value))
            }
            ShapeKind::BigInt => b"BigInt".to_vec(),
            ShapeKind::BigIntLiteral {
                digits,
                is_negative,
            } => {
                let sign: &[u8] = if is_negative { b"-" } else { b"" };
                wrapped(
                    "BigIntLiteral",
                    &[sign, self.queries.atom_bytes(digits)].concat(),
                )
            }
            ShapeKind::String => b"String".to_vec(),
            ShapeKind::StringLiteral(text) => wrapped(
                "StringLiteral",
                &string_literal_text(self.queries.atom_bytes(text)),
            ),
            ShapeKind::TemplateLiteral { texts, types } => {
                wrapped("TemplateLiteral", &self.template_literal_text(texts, types))
            }
            ShapeKind::Symbol => b"Symbol".to_vec(),
            ShapeKind::AnyObject => b"AnyObject".to_vec(),
            ShapeKind::Function(signatures) => {
                format!("Function({})", signatures.len()).into_bytes()
            }
            ShapeKind::ClassConstructor(class) => {
                wrapped("ClassConstructor", &self.class_location(class))
            }
            ShapeKind::Array {
                element,
                is_readonly,
            } => {
                let prefix: &[u8] = if is_readonly { b"readonly " } else { b"" };
                wrapped(
                    "Array",
                    &[prefix, &self.queries.type_text(element)[..]].concat(),
                )
            }
            ShapeKind::Tuple {
                elements,
                is_readonly,
            } => wrapped("Tuple", &self.tuple_text(elements, is_readonly)),
            ShapeKind::Builtin { class, arguments } => {
                wrapped("Builtin", &self.builtin_text(class, arguments))
            }
            ShapeKind::Class(class) => wrapped("Class", &self.class_location(class)),
            ShapeKind::Object => b"Object".to_vec(),
            ShapeKind::Union(types) => wrapped("Union", &self.type_list_text(types, b" | ")),
            ShapeKind::Int32 { base } => wrapped("Int32", &self.queries.type_text(base)),
        }
    }

    pub(super) fn member_lookup_text(&mut self, lookup: MemberLookup) -> Vec<u8> {
        match lookup {
            MemberLookup::Absent => b"absent".to_vec(),
            MemberLookup::Member(member) => {
                [b"member ".to_vec(), self.object_member_text(&member)].concat()
            }
            MemberLookup::Index(signature) => {
                [b"index ".to_vec(), self.index_signature_text(&signature)].concat()
            }
        }
    }

    pub(super) fn class_member_text(&mut self, file: FileId, member: &ClassMember) -> Vec<u8> {
        let hir = self.queries.files().hir(file);
        let (source, position) = match member.source {
            ClassMemberSource::Member(id) => ("Member", hir[id].start),
            ClassMemberSource::ParameterProperty(id) => ("ParameterProperty", hir[id].pos),
            ClassMemberSource::ThisStore(store) => ("ThisStore", start_of(hir, store)),
            ClassMemberSource::PrototypeStore(store) => ("PrototypeStore", start_of(hir, store)),
            ClassMemberSource::StaticStore(store) => ("StaticStore", start_of(hir, store)),
        };
        let line = self.line_of(file, position);
        let mut text = self.member_name_text(member.name);
        text.extend_from_slice(format!(" {:?} {source} {line} ", member.kind).as_bytes());
        text.extend_from_slice(&self.position_text(member.types));
        if member.is_static {
            text.extend_from_slice(b" static");
        }
        if member.is_optional {
            text.extend_from_slice(b" optional");
        }
        text
    }
}
