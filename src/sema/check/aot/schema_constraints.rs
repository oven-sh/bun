use super::answers::{
    GaveUp, MemberName, ObjectMemberKind, SchemaConstraint, SchemaDefault, SchemaFormat,
};
use super::program_symbols::SchemaAlias;
use super::queries::Queries;
use super::type_shape::{AnythingReason, ShapeKind, TupleElementKind};
use crate::atom::Atom;
use crate::types::{EnumValue, Origin, TypeData, TypeId};
use smallvec::SmallVec;

const SCHEMA_FORMATS: [(&[u8], SchemaFormat); 15] = [
    (b"email", SchemaFormat::Email),
    (b"uuid", SchemaFormat::Uuid),
    (b"ipv4", SchemaFormat::Ipv4),
    (b"ipv6", SchemaFormat::Ipv6),
    (b"date", SchemaFormat::Date),
    (b"date-time", SchemaFormat::DateTime),
    (b"url", SchemaFormat::Url),
    (b"time", SchemaFormat::Time),
    (b"duration", SchemaFormat::Duration),
    (b"hostname", SchemaFormat::Hostname),
    (b"uri", SchemaFormat::Uri),
    (b"uri-reference", SchemaFormat::UriReference),
    (b"regex", SchemaFormat::Regex),
    (b"json-pointer", SchemaFormat::JsonPointer),
    (b"relative-json-pointer", SchemaFormat::RelativeJsonPointer),
];

fn find_schema_format(name: &[u8]) -> Option<SchemaFormat> {
    SCHEMA_FORMATS
        .iter()
        .find(|(known, _)| *known == name)
        .map(|&(_, format)| format)
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum SchemaPart<'c> {
    NotSchema,
    Int32Tag,
    Alias(SchemaAlias, SchemaConstraint<'c>),
}

type Entries = SmallVec<[(Atom, TypeId); 4]>;

// The checker goes on with the error type, to which everything is related, also where it reports nothing.
fn without_error_type<T>(answer: Result<Option<T>, GaveUp>) -> Result<Option<T>, GaveUp> {
    match answer {
        Err(GaveUp::ErrorType) => Ok(None),
        Ok(_) | Err(GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled | GaveUp::UnreachedNode) => {
            answer
        }
    }
}

fn find_pattern_mode(flags: &[u8]) -> Option<bool> {
    match flags {
        b"" => Some(false),
        b"u" => Some(true),
        _ => None,
    }
}

pub(super) fn closes_object(constraint: &SchemaConstraint<'_>) -> bool {
    matches!(
        constraint,
        SchemaConstraint::Strict | SchemaConstraint::DeepStrict
    )
}

pub(super) fn find_refusal<'c>(
    constraints: &[SchemaConstraint<'c>],
) -> Option<SchemaConstraint<'c>> {
    let mut constraints = constraints.iter().copied();
    constraints.find(|constraint| matches!(constraint, SchemaConstraint::Refused(_)))
}

#[derive(Copy, Clone)]
enum SchemaLiteral {
    Number(f64),
    NumericEnumMember(f64),
    String(Atom),
    Boolean(bool),
    Null,
    Never,
    NotLiteral,
}

impl SchemaLiteral {
    fn number(self) -> Option<f64> {
        match self {
            SchemaLiteral::Number(number) | SchemaLiteral::NumericEnumMember(number) => {
                (!number.is_nan()).then_some(number)
            }
            _ => None,
        }
    }

    fn divisor(self) -> Option<f64> {
        self.number()
            .filter(|divisor| divisor.is_finite() && *divisor > 0.0)
    }

    fn count(self) -> Option<u32> {
        let number = self.number()?;
        let is_count = number.fract() == 0.0 && 0.0 <= number && number <= u32::MAX as f64;
        is_count.then_some(number as u32)
    }

    // `never` says that there is none. `number` is what a count that the program has widened looks like.
    fn greatest_count(self) -> Option<Option<u32>> {
        match self {
            SchemaLiteral::Never => Some(None),
            SchemaLiteral::Number(_)
            | SchemaLiteral::NumericEnumMember(_)
            | SchemaLiteral::String(_)
            | SchemaLiteral::Boolean(_)
            | SchemaLiteral::Null
            | SchemaLiteral::NotLiteral => self.count().map(Some),
        }
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
            SchemaLiteral::NumericEnumMember(_)
            | SchemaLiteral::Never
            | SchemaLiteral::NotLiteral => None,
        }
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    // An alias of `Schema` always gives a constraint. Where its arguments say no rule, hold the error type or were cut short at a limit of the checker, that is `Refused`, so that no validator is built without the rule.
    pub(super) fn schema_part(&mut self, part: TypeId) -> Result<SchemaPart<'c>, GaveUp> {
        let TypeData::Anon {
            origin: Origin::TypeLiteral(file, node),
            mapper,
        } = *self.c.data(part)
        else {
            return Ok(SchemaPart::NotSchema);
        };
        let symbols = self.c.p.aot_symbols();
        if symbols.is_int32_tag(file, node) {
            return Ok(SchemaPart::Int32Tag);
        }
        let Some((symbol, arguments)) = self.c.alias_of_node_under(file, node, mapper) else {
            return Ok(SchemaPart::NotSchema);
        };
        let Some(alias) = symbols.schema_alias(symbol) else {
            return Ok(SchemaPart::NotSchema);
        };
        let limits_hit = self.c.count_limits_hit();
        let constraint = self.schema_constraint_without_errors(alias, &arguments);
        let constraint = match self.c.count_limits_hit() == limits_hit {
            true => without_error_type(constraint)?,
            false => None,
        };
        let constraint = match constraint {
            Some(constraint) => constraint,
            None => self.refuse_arguments(alias)?,
        };
        Ok(SchemaPart::Alias(alias, constraint))
    }

    fn refuse_arguments(&mut self, alias: SchemaAlias) -> Result<SchemaConstraint<'c>, GaveUp> {
        self.note_invalid_schema_argument();
        self.refuse_alias(alias)
    }

    pub(super) fn refuse_alias(&self, alias: SchemaAlias) -> Result<SchemaConstraint<'c>, GaveUp> {
        let name = self.files().atoms.lookup(alias.name());
        name.map(SchemaConstraint::Refused)
            .ok_or(GaveUp::Unresolved)
    }

    fn schema_constraint_without_errors(
        &mut self,
        alias: SchemaAlias,
        arguments: &[TypeId],
    ) -> Result<Option<SchemaConstraint<'c>>, GaveUp> {
        for &argument in arguments {
            self.resolved(argument)?;
        }
        let constraint = self.schema_constraint(alias, arguments)?;
        if let Some(constraint) = constraint {
            constraint.for_each_type(|ty| self.resolved(ty).map(drop))?;
        }
        Ok(constraint)
    }

    fn schema_constraint(
        &mut self,
        alias: SchemaAlias,
        arguments: &[TypeId],
    ) -> Result<Option<SchemaConstraint<'c>>, GaveUp> {
        let first = arguments.first().copied();
        let argument = self.schema_literal(first);
        Ok(match alias {
            SchemaAlias::Int => Some(SchemaConstraint::Int),
            SchemaAlias::Min => argument.number().map(SchemaConstraint::Min),
            SchemaAlias::Max => argument.number().map(SchemaConstraint::Max),
            SchemaAlias::Above => argument.number().map(SchemaConstraint::Above),
            SchemaAlias::Below => argument.number().map(SchemaConstraint::Below),
            SchemaAlias::MultipleOf => argument.divisor().map(SchemaConstraint::MultipleOf),
            SchemaAlias::MinLength => argument.count().map(SchemaConstraint::MinLength),
            SchemaAlias::MaxLength => argument.count().map(SchemaConstraint::MaxLength),
            SchemaAlias::MinItems => argument.count().map(SchemaConstraint::MinItems),
            SchemaAlias::MaxItems => argument.count().map(SchemaConstraint::MaxItems),
            SchemaAlias::Pattern => self.pattern_constraint(arguments),
            SchemaAlias::Format => self.schema_format(argument).map(SchemaConstraint::Format),
            SchemaAlias::Message => argument.string().map(SchemaConstraint::Message),
            SchemaAlias::Default => argument.default_value().map(SchemaConstraint::Default),
            SchemaAlias::Strict => Some(SchemaConstraint::Strict),
            SchemaAlias::DeepStrict => Some(SchemaConstraint::DeepStrict),
            SchemaAlias::UniqueItems => Some(SchemaConstraint::UniqueItems),
            SchemaAlias::Contains => self.contains_constraint(arguments),
            SchemaAlias::Not => first.map(|ty| SchemaConstraint::Not { ty }),
            SchemaAlias::If => match *arguments {
                [condition, then, otherwise] => Some(SchemaConstraint::If {
                    condition,
                    then,
                    otherwise,
                }),
                _ => None,
            },
            SchemaAlias::OneOf => {
                let arms = self.schema_list(first)?;
                arms.map(|arms| SchemaConstraint::OneOf { arms })
            }
            SchemaAlias::AllOf => {
                let parts = self.schema_list(first)?;
                parts.map(|parts| SchemaConstraint::AllOf { parts })
            }
            SchemaAlias::PatternProperties => match *arguments {
                [table, others] => {
                    let table = self.schema_entries(Some(table))?;
                    table.map(|table| SchemaConstraint::PatternProperties {
                        table: self.list(&table),
                        others,
                    })
                }
                _ => None,
            },
            SchemaAlias::PropertyNames => first.map(|ty| SchemaConstraint::PropertyNames { ty }),
            SchemaAlias::MinProperties => argument.count().map(SchemaConstraint::MinProperties),
            SchemaAlias::MaxProperties => argument.count().map(SchemaConstraint::MaxProperties),
            SchemaAlias::DependentRequired => self.dependent_required_constraint(first)?,
            SchemaAlias::DependentSchemas => {
                let entries = self.schema_entries(first)?;
                entries.map(|entries| SchemaConstraint::DependentSchemas(self.list(&entries)))
            }
            SchemaAlias::Refused => self.refused_keyword(first).map(SchemaConstraint::Refused),
        })
    }

    fn schema_format(&self, argument: SchemaLiteral) -> Option<SchemaFormat> {
        find_schema_format(self.atom_bytes(argument.string()?))
    }

    fn pattern_constraint(&self, arguments: &[TypeId]) -> Option<SchemaConstraint<'c>> {
        let &[source, flags] = arguments else {
            return None;
        };
        let source = self.schema_literal(Some(source)).string()?;
        let flags = self.schema_literal(Some(flags)).string()?;
        let is_unicode = find_pattern_mode(self.atom_bytes(flags))?;
        Some(SchemaConstraint::Pattern { source, is_unicode })
    }

    fn contains_constraint(&self, arguments: &[TypeId]) -> Option<SchemaConstraint<'c>> {
        let &[ty, minimum, maximum] = arguments else {
            return None;
        };
        let minimum = self.schema_literal(Some(minimum)).count()?;
        let maximum = self.schema_literal(Some(maximum)).greatest_count()?;
        Some(SchemaConstraint::Contains {
            ty,
            minimum,
            maximum,
        })
    }

    // Of the keywords of a union the first by its bytes, so that every build names the same one.
    fn refused_keyword(&self, argument: Option<TypeId>) -> Option<Atom> {
        let argument = argument?;
        if let Some(keyword) = self.schema_literal(Some(argument)).string() {
            return Some(keyword);
        }
        let TypeData::Union(members) = self.c.data(argument) else {
            return None;
        };
        members
            .iter()
            .filter_map(|&member| self.schema_literal(Some(member)).string())
            .min_by_key(|&keyword| self.atom_bytes(keyword))
    }

    fn fixed_tuple_elements(
        &mut self,
        argument: Option<TypeId>,
    ) -> Result<Option<SmallVec<[TypeId; 8]>>, GaveUp> {
        let Some(argument) = argument else {
            return Ok(None);
        };
        let ShapeKind::Tuple { elements, .. } = self.type_shape(argument)?.kind else {
            return Ok(None);
        };
        let is_fixed = elements
            .iter()
            .all(|element| element.kind == TupleElementKind::Required);
        Ok(is_fixed.then(|| elements.iter().map(|element| element.ty).collect()))
    }

    // JSON Schema has no empty `oneOf` or `allOf`, and every value would pass an empty `allOf`.
    fn schema_list(&mut self, argument: Option<TypeId>) -> Result<Option<&'c [TypeId]>, GaveUp> {
        let elements = self.fixed_tuple_elements(argument)?;
        let elements = elements.filter(|elements| !elements.is_empty());
        Ok(elements.map(|elements| self.list(&elements)))
    }

    // None where a key is not known or may be absent. The empty object type has a shape of its own, so an object type that lists no member is one whose members are not known.
    fn schema_entries(&mut self, argument: Option<TypeId>) -> Result<Option<Entries>, GaveUp> {
        let Some(argument) = argument else {
            return Ok(None);
        };
        match self.type_shape(argument)?.kind {
            ShapeKind::Anything(AnythingReason::EmptyObjectType) => {
                return Ok(Some(Entries::new()));
            }
            ShapeKind::Object => {}
            _ => return Ok(None),
        }
        if !self.index_signatures(argument)?.is_empty() {
            return Ok(None);
        }
        let members = self.checked_members(argument)?;
        if members.is_empty() {
            return Ok(None);
        }
        let mut entries = Entries::new();
        for member in members {
            let MemberName::String(key) = member.name else {
                return Ok(None);
            };
            if member.kind != ObjectMemberKind::Field || member.is_optional {
                return Ok(None);
            }
            entries.push((key, member.checked?));
        }
        Ok(Some(entries))
    }

    fn dependent_required_constraint(
        &mut self,
        argument: Option<TypeId>,
    ) -> Result<Option<SchemaConstraint<'c>>, GaveUp> {
        let Some(entries) = self.schema_entries(argument)? else {
            return Ok(None);
        };
        let mut dependencies: SmallVec<[(Atom, &'c [Atom]); 4]> = SmallVec::new();
        for (key, names) in entries {
            let Some(names) = self.fixed_tuple_elements(Some(names))? else {
                return Ok(None);
            };
            let names: Option<SmallVec<[Atom; 4]>> = names
                .iter()
                .map(|&name| self.schema_literal(Some(name)).string())
                .collect();
            let Some(names) = names else {
                return Ok(None);
            };
            dependencies.push((key, self.list(&names)));
        }
        let dependencies = self.list(&dependencies);
        Ok(Some(SchemaConstraint::DependentRequired(dependencies)))
    }

    fn schema_literal(&self, argument: Option<TypeId>) -> SchemaLiteral {
        let Some(argument) = argument else {
            return SchemaLiteral::NotLiteral;
        };
        if argument.plain() == TypeId::NULL {
            return SchemaLiteral::Null;
        }
        if argument == TypeId::NEVER {
            return SchemaLiteral::Never;
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
    use super::{
        SCHEMA_FORMATS, SchemaLiteral, closes_object, find_pattern_mode, find_refusal,
        find_schema_format, without_error_type,
    };
    use crate::atom::known;
    use crate::check::aot::answers::{GaveUp, SchemaConstraint, SchemaFormat};
    use crate::types::TypeId;

    #[test]
    fn enum_member_is_number_but_not_default() {
        let member = SchemaLiteral::NumericEnumMember(2.0);
        assert_eq!(member.number(), Some(2.0));
        assert_eq!(member.default_value(), None);
    }

    #[test]
    fn nan_is_no_bound() {
        assert_eq!(SchemaLiteral::Number(f64::NAN).number(), None);
        assert_eq!(SchemaLiteral::NumericEnumMember(f64::NAN).number(), None);
        assert_eq!(
            SchemaLiteral::Number(f64::INFINITY).number(),
            Some(f64::INFINITY)
        );
        assert_eq!(SchemaLiteral::Number(-0.0).number(), Some(0.0));
    }

    #[test]
    fn an_error_type_says_no_rule() {
        assert_eq!(without_error_type::<u32>(Err(GaveUp::ErrorType)), Ok(None));
        assert_eq!(without_error_type(Ok(Some(1))), Ok(Some(1)));
        assert_eq!(without_error_type::<u32>(Ok(None)), Ok(None));
        for reason in GaveUp::ALL {
            if reason != GaveUp::ErrorType {
                assert_eq!(without_error_type::<u32>(Err(reason)), Err(reason));
            }
        }
    }

    #[test]
    fn a_pattern_has_no_flag_or_the_unicode_flag() {
        assert_eq!(find_pattern_mode(b""), Some(false));
        assert_eq!(find_pattern_mode(b"u"), Some(true));
        for other in [&b"v"[..], b"i", b"uu", b"ui", b"U", b" "] {
            assert_eq!(find_pattern_mode(other), None);
        }
    }

    #[test]
    fn only_never_says_that_there_is_no_greatest_count() {
        assert_eq!(SchemaLiteral::Never.greatest_count(), Some(None));
        assert_eq!(SchemaLiteral::NotLiteral.greatest_count(), None);
        assert_eq!(SchemaLiteral::Null.greatest_count(), None);
        assert_eq!(SchemaLiteral::Never.count(), None);
        assert_eq!(SchemaLiteral::Never.number(), None);
        let count = |number| SchemaLiteral::Number(number).greatest_count();
        assert_eq!(count(2.0), Some(Some(2)));
        assert_eq!(count(0.0), Some(Some(0)));
        assert_eq!(count(-1.0), None);
        assert_eq!(count(f64::NAN), None);
    }

    #[test]
    fn only_the_strict_aliases_close_an_object() {
        assert!(closes_object(&SchemaConstraint::Strict));
        assert!(closes_object(&SchemaConstraint::DeepStrict));
        let open = [
            SchemaConstraint::MinProperties(1),
            SchemaConstraint::MaxProperties(0),
            SchemaConstraint::Not { ty: TypeId::STRING },
            SchemaConstraint::PatternProperties {
                table: &[],
                others: TypeId::NEVER,
            },
            SchemaConstraint::Refused(known::length),
        ];
        assert!(!open.iter().any(closes_object));
    }

    #[test]
    fn the_first_refusal_is_found() {
        let (first, second) = (
            SchemaConstraint::Refused(known::length),
            SchemaConstraint::Refused(known::call),
        );
        let constraints = [SchemaConstraint::Int, first, second];
        assert_eq!(find_refusal(&constraints), Some(first));
        assert_eq!(find_refusal(&constraints[..1]), None);
        assert_eq!(find_refusal(&[]), None);
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

    #[test]
    fn divisor_is_finite_and_above_zero() {
        assert_eq!(SchemaLiteral::Number(0.01).divisor(), Some(0.01));
        assert_eq!(SchemaLiteral::Number(3.0).divisor(), Some(3.0));
        for invalid in [
            0.0,
            -0.0,
            -1.0,
            -0.01,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ] {
            assert_eq!(SchemaLiteral::Number(invalid).divisor(), None);
        }
        assert_eq!(SchemaLiteral::NotLiteral.divisor(), None);
    }

    #[test]
    fn formats_are_listed_in_the_order_of_their_numbers() {
        for (index, &(name, format)) in SCHEMA_FORMATS.iter().enumerate() {
            assert_eq!(format as usize, index);
            assert_eq!(find_schema_format(name), Some(format));
        }
    }

    #[test]
    fn a_format_is_known_by_its_whole_name() {
        assert_eq!(find_schema_format(b"uri"), Some(SchemaFormat::Uri));
        assert_eq!(
            find_schema_format(b"uri-reference"),
            Some(SchemaFormat::UriReference)
        );
        for unknown in [&b"URI"[..], b"uri-template", b"iri", b"idn-email", b""] {
            assert_eq!(find_schema_format(unknown), None);
        }
    }
}
