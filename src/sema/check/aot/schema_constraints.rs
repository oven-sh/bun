use super::answers::{GaveUp, MemberName, SchemaConstraint, SchemaDefault, SchemaFormat};
use super::program_symbols::SchemaAlias;
use super::queries::Queries;
use super::type_shape::ShapeKind;
use crate::atom::Atom;
use crate::types::{EnumValue, Origin, TypeData, TypeId};

const SCHEMA_FORMATS: [(&[u8], SchemaFormat); 7] = [
    (b"email", SchemaFormat::Email),
    (b"uuid", SchemaFormat::Uuid),
    (b"ipv4", SchemaFormat::Ipv4),
    (b"ipv6", SchemaFormat::Ipv6),
    (b"date", SchemaFormat::Date),
    (b"date-time", SchemaFormat::DateTime),
    (b"url", SchemaFormat::Url),
];

/// The key of the one member that each alias of `Schema` declares.
const SCHEMA_KEYS: [&[u8]; 16] = [
    b"bun.above",
    b"bun.below",
    b"bun.default",
    b"bun.format",
    b"bun.int",
    b"bun.int32",
    b"bun.max",
    b"bun.maxItems",
    b"bun.maxLength",
    b"bun.message",
    b"bun.min",
    b"bun.minItems",
    b"bun.minLength",
    b"bun.multipleOf",
    b"bun.pattern",
    b"bun.strict",
];

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum SchemaPart {
    NotSchema,
    Constraint(SchemaConstraint),
    Invalid,
}

#[derive(Copy, Clone)]
enum SchemaLiteral {
    Number(f64),
    NumericEnumMember(f64),
    String(Atom),
    Boolean(bool),
    Null,
    NotLiteral,
}

impl SchemaLiteral {
    fn number(self) -> Option<f64> {
        match self {
            SchemaLiteral::Number(number) | SchemaLiteral::NumericEnumMember(number) => {
                Some(number)
            }
            _ => None,
        }
    }

    fn count(self) -> Option<u32> {
        let number = self.number()?;
        let is_count = number.fract() == 0.0 && 0.0 <= number && number <= u32::MAX as f64;
        is_count.then_some(number as u32)
    }

    fn string(self) -> Option<Atom> {
        match self {
            SchemaLiteral::String(text) => Some(text),
            _ => None,
        }
    }

    fn default_value(self) -> Option<SchemaDefault> {
        match self {
            SchemaLiteral::Number(number) => Some(SchemaDefault::Number(number)),
            SchemaLiteral::String(text) => Some(SchemaDefault::String(text)),
            SchemaLiteral::Boolean(value) => Some(SchemaDefault::Boolean(value)),
            SchemaLiteral::Null => Some(SchemaDefault::Null),
            SchemaLiteral::NumericEnumMember(_) | SchemaLiteral::NotLiteral => None,
        }
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    /// An alias of `Schema` is a rule only as it is written. Behind a mapped type, or spelled out by hand, its member is a
    /// member like any other, and the rule would go unnoticed.
    pub fn is_schema_key(&self, name: Atom) -> bool {
        SCHEMA_KEYS.contains(&self.atom_bytes(name))
    }

    pub(super) fn has_schema_key(&mut self, ty: TypeId) -> Result<bool, GaveUp> {
        if !matches!(self.type_shape(ty)?.kind, ShapeKind::Object) {
            return Ok(false);
        }
        let members = self.checked_members(ty)?;
        Ok(members.iter().any(|member| match member.name {
            MemberName::String(name) => self.is_schema_key(name),
            MemberName::Symbol(_) | MemberName::Private(_) => false,
        }))
    }

    pub(super) fn schema_part(&mut self, part: TypeId) -> SchemaPart {
        let TypeData::Anon {
            origin: Origin::TypeLiteral(file, node),
            mapper,
        } = *self.c.data(part)
        else {
            return SchemaPart::NotSchema;
        };
        let symbols = self.c.p.aot_symbols();
        if symbols.is_int32_tag(file, node) {
            return SchemaPart::Constraint(SchemaConstraint::Int32);
        }
        let Some((symbol, arguments)) = self.c.alias_of_node_under(file, node, mapper) else {
            return SchemaPart::NotSchema;
        };
        let Some(alias) = symbols.schema_alias(symbol) else {
            return SchemaPart::NotSchema;
        };
        let argument = self.schema_literal(arguments.first().copied());
        match self.schema_constraint(alias, argument) {
            Some(constraint) => SchemaPart::Constraint(constraint),
            None => SchemaPart::Invalid,
        }
    }

    fn schema_constraint(
        &self,
        alias: SchemaAlias,
        argument: SchemaLiteral,
    ) -> Option<SchemaConstraint> {
        match alias {
            SchemaAlias::Int => Some(SchemaConstraint::Int),
            SchemaAlias::Min => argument.number().map(SchemaConstraint::Min),
            SchemaAlias::Max => argument.number().map(SchemaConstraint::Max),
            SchemaAlias::Above => argument.number().map(SchemaConstraint::Above),
            SchemaAlias::Below => argument.number().map(SchemaConstraint::Below),
            SchemaAlias::MultipleOf => argument.number().map(SchemaConstraint::MultipleOf),
            SchemaAlias::MinLength => argument.count().map(SchemaConstraint::MinLength),
            SchemaAlias::MaxLength => argument.count().map(SchemaConstraint::MaxLength),
            SchemaAlias::MinItems => argument.count().map(SchemaConstraint::MinItems),
            SchemaAlias::MaxItems => argument.count().map(SchemaConstraint::MaxItems),
            SchemaAlias::Pattern => argument.string().map(SchemaConstraint::Pattern),
            SchemaAlias::Format => self.schema_format(argument).map(SchemaConstraint::Format),
            SchemaAlias::Message => argument.string().map(SchemaConstraint::Message),
            SchemaAlias::Default => argument.default_value().map(SchemaConstraint::Default),
            SchemaAlias::Strict => Some(SchemaConstraint::Strict),
            SchemaAlias::DeepStrict => Some(SchemaConstraint::DeepStrict),
        }
    }

    fn schema_format(&self, argument: SchemaLiteral) -> Option<SchemaFormat> {
        let bytes = self.atom_bytes(argument.string()?);
        SCHEMA_FORMATS
            .iter()
            .find(|(name, _)| *name == bytes)
            .map(|&(_, format)| format)
    }

    fn schema_literal(&self, argument: Option<TypeId>) -> SchemaLiteral {
        let Some(argument) = argument else {
            return SchemaLiteral::NotLiteral;
        };
        if argument.plain() == TypeId::NULL {
            return SchemaLiteral::Null;
        }
        match *self.c.data(argument) {
            TypeData::NumberLit { bits, .. } => SchemaLiteral::Number(f64::from_bits(bits)),
            TypeData::EnumLit { value, .. } => match value {
                EnumValue::Number(bits) => SchemaLiteral::NumericEnumMember(f64::from_bits(bits)),
                EnumValue::String(_) => SchemaLiteral::NotLiteral,
            },
            TypeData::StringLit { value, .. } => SchemaLiteral::String(value),
            TypeData::BoolLit { value, .. } => SchemaLiteral::Boolean(value),
            _ => SchemaLiteral::NotLiteral,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SchemaLiteral;

    #[test]
    fn enum_member_is_number_but_not_default() {
        let member = SchemaLiteral::NumericEnumMember(2.0);
        assert_eq!(member.number(), Some(2.0));
        assert_eq!(member.default_value(), None);
    }

    #[test]
    fn count_rejects_fractions_and_out_of_range() {
        assert_eq!(SchemaLiteral::Number(0.0).count(), Some(0));
        assert_eq!(
            SchemaLiteral::Number(u32::MAX as f64).count(),
            Some(u32::MAX)
        );
        for invalid in [-1.0, 1.5, u32::MAX as f64 + 1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(SchemaLiteral::Number(invalid).count(), None);
        }
    }
}
