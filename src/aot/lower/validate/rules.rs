use bun_sema::atom::Atom;
use bun_sema::check::aot::{
    AnythingReason, SchemaConstraint, SchemaDefault, SchemaFormat, ShapeKind,
};

use super::nodes::{NodeBuilder, Source};
use super::{ValidatedFile, ValidationError};
use crate::ir::StringId;
use crate::ir::generated::{
    TextFormat, UndeclaredMembers, ValidatedPrimitive, ValidationNode, ValidationRule,
    ValidationShape,
};
use crate::lower::CheckerTypeId;

#[derive(Copy, Clone, PartialEq, Eq)]
enum RuleKind {
    Test,
    Message,
    Default,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ValueKind {
    Anything,
    Number,
    Text,
    List,
    Object,
    Dictionary,
    Other,
}

fn alias_of(constraint: SchemaConstraint<'_>) -> &'static str {
    match constraint {
        SchemaConstraint::Int32 => "int32",
        SchemaConstraint::Int => "Int",
        SchemaConstraint::Min(_) => "Min",
        SchemaConstraint::Max(_) => "Max",
        SchemaConstraint::Above(_) => "Above",
        SchemaConstraint::Below(_) => "Below",
        SchemaConstraint::MultipleOf(_) => "MultipleOf",
        SchemaConstraint::MinLength(_) => "MinLength",
        SchemaConstraint::MaxLength(_) => "MaxLength",
        SchemaConstraint::MinItems(_) => "MinItems",
        SchemaConstraint::MaxItems(_) => "MaxItems",
        SchemaConstraint::Pattern { .. } => "Pattern",
        SchemaConstraint::Format(_) => "Format",
        SchemaConstraint::Message(_) => "Message",
        SchemaConstraint::Default(_) => "Default",
        SchemaConstraint::Strict => "Strict",
        SchemaConstraint::DeepStrict => "DeepStrict",
        SchemaConstraint::UniqueItems => "UniqueItems",
        SchemaConstraint::Contains { .. } => "Contains",
        SchemaConstraint::Not { .. } => "Not",
        SchemaConstraint::If { .. } => "If",
        SchemaConstraint::OneOf { .. } => "OneOf",
        SchemaConstraint::AllOf { .. } => "AllOf",
        SchemaConstraint::PatternProperties { .. } => "PatternProperties",
        SchemaConstraint::PropertyNames { .. } => "PropertyNames",
        SchemaConstraint::MinProperties(_) => "MinProperties",
        SchemaConstraint::MaxProperties(_) => "MaxProperties",
        SchemaConstraint::DependentRequired(_) => "DependentRequired",
        SchemaConstraint::DependentSchemas(_) => "DependentSchemas",
        SchemaConstraint::Refused(_) => "Refused",
    }
}

/// Whether the rule means something beside a shape of the kind. Elsewhere it would be dropped, or its test would read a value of another kind.
fn can_stand_beside(constraint: SchemaConstraint<'_>, kind: ValueKind) -> bool {
    let kinds: &[ValueKind] = match constraint {
        // The test reads its value as a number, a string or an array without asking.
        SchemaConstraint::Int32
        | SchemaConstraint::Int
        | SchemaConstraint::Min(_)
        | SchemaConstraint::Max(_)
        | SchemaConstraint::Above(_)
        | SchemaConstraint::Below(_)
        | SchemaConstraint::MultipleOf(_) => &[ValueKind::Number],
        SchemaConstraint::MinLength(_)
        | SchemaConstraint::MaxLength(_)
        | SchemaConstraint::Pattern { .. }
        | SchemaConstraint::Format(_) => &[ValueKind::Text],
        SchemaConstraint::MinItems(_) | SchemaConstraint::MaxItems(_) => &[ValueKind::List],
        // Every key of a dictionary is declared.
        SchemaConstraint::Strict => &[ValueKind::Object, ValueKind::Dictionary],
        SchemaConstraint::DeepStrict => {
            &[ValueKind::Object, ValueKind::Dictionary, ValueKind::List]
        }
        SchemaConstraint::PatternProperties { .. } => &[ValueKind::Object],
        // `Schema.Not<T>`, `{} & Schema.Not<T>` and `unknown & Schema.Not<T>` are one type, which does not say what the rule stands beside.
        SchemaConstraint::Message(_)
        | SchemaConstraint::Default(_)
        | SchemaConstraint::UniqueItems
        | SchemaConstraint::Contains { .. }
        | SchemaConstraint::Not { .. }
        | SchemaConstraint::If { .. }
        | SchemaConstraint::OneOf { .. }
        | SchemaConstraint::AllOf { .. }
        | SchemaConstraint::PropertyNames { .. }
        | SchemaConstraint::MinProperties(_)
        | SchemaConstraint::MaxProperties(_)
        | SchemaConstraint::DependentRequired(_)
        | SchemaConstraint::DependentSchemas(_) => &[
            ValueKind::Number,
            ValueKind::Text,
            ValueKind::List,
            ValueKind::Object,
            ValueKind::Dictionary,
            ValueKind::Other,
        ],
        SchemaConstraint::Refused(_) => return true,
    };
    kinds.contains(&kind)
}

fn kind_accepted(shape: &ValidationShape) -> ValueKind {
    match shape {
        ValidationShape::Unknown => ValueKind::Anything,
        ValidationShape::Primitive {
            primitive: ValidatedPrimitive::Number,
        }
        | ValidationShape::NumberLiteral { .. } => ValueKind::Number,
        ValidationShape::Primitive {
            primitive: ValidatedPrimitive::String,
        }
        | ValidationShape::StringLiteral { .. } => ValueKind::Text,
        ValidationShape::Array { .. } | ValidationShape::Tuple { .. } => ValueKind::List,
        ValidationShape::Object { .. } => ValueKind::Object,
        ValidationShape::Dictionary { .. } => ValueKind::Dictionary,
        ValidationShape::Never
        | ValidationShape::Undefined
        | ValidationShape::Null
        | ValidationShape::AnyObject
        | ValidationShape::Primitive {
            primitive: ValidatedPrimitive::Boolean | ValidatedPrimitive::BigInt,
        }
        | ValidationShape::BooleanLiteral { .. }
        | ValidationShape::Union { .. } => ValueKind::Other,
    }
}

fn closes_object(constraint: &SchemaConstraint<'_>) -> bool {
    matches!(
        constraint,
        SchemaConstraint::Strict | SchemaConstraint::DeepStrict
    )
}

fn is_pattern_table(constraint: &SchemaConstraint<'_>) -> bool {
    matches!(constraint, SchemaConstraint::PatternProperties { .. })
}

/// What the type itself says cannot be checked. It is named in front of everything else that is wrong with the type.
pub(super) fn find_refused_rule(lists: &[&[SchemaConstraint<'_>]]) -> Option<Atom> {
    let mut constraints = lists.iter().rev().flat_map(|list| list.iter());
    constraints.find_map(|constraint| {
        if let SchemaConstraint::Refused(rule) = constraint {
            Some(*rule)
        } else {
            None
        }
    })
}

/// `lists` go from the outermost intersection to the innermost, which is applied first.
pub(super) fn apply_constraints<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>>(
    builder: &mut NodeBuilder<'_, 'c, F>,
    source: Source<'c>,
    lists: &[&'c [SchemaConstraint<'c>]],
) -> Result<(), ValidationError> {
    let constraints = || lists.iter().rev().flat_map(|list| list.iter().copied());
    // A key that matches is declared. Two tables are two schemas, and a key of one may be undeclared in the other.
    if constraints().filter(is_pattern_table).count() > 1 {
        return Err(builder.refuse(source, b"PatternProperties"));
    }
    // A table of patterns asks whether its object is closed.
    for constraint in constraints().filter(closes_object) {
        apply_constraint(builder, source, constraint)?;
    }
    for constraint in constraints().filter(|constraint| !closes_object(constraint)) {
        apply_constraint(builder, source, constraint)?;
    }
    Ok(())
}

/// Every constraint is named here, so that a new one does not compile until it has a rule or is refused.
fn apply_constraint<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>>(
    builder: &mut NodeBuilder<'_, 'c, F>,
    source: Source<'c>,
    constraint: SchemaConstraint<'c>,
) -> Result<(), ValidationError> {
    let alias = alias_of(constraint);
    let kind = kind_accepted(&builder.node_mut(source).shape);
    if !can_stand_beside(constraint, kind) {
        return Err(builder.refuse(source, alias.as_bytes()));
    }
    let rule = match constraint {
        SchemaConstraint::Int => ValidationRule::Integer,
        SchemaConstraint::Int32 => {
            builder.node_mut(source).rules.extend([
                ValidationRule::Integer,
                ValidationRule::Minimum {
                    bound: f64::from(i32::MIN),
                },
                ValidationRule::Maximum {
                    bound: f64::from(i32::MAX),
                },
            ]);
            return Ok(());
        }
        SchemaConstraint::Min(bound) => ValidationRule::Minimum { bound },
        SchemaConstraint::Max(bound) => ValidationRule::Maximum { bound },
        SchemaConstraint::Above(bound) => ValidationRule::ExclusiveMinimum { bound },
        SchemaConstraint::Below(bound) => ValidationRule::ExclusiveMaximum { bound },
        SchemaConstraint::MultipleOf(divisor) => ValidationRule::MultipleOf { divisor },
        SchemaConstraint::MinLength(length) | SchemaConstraint::MinItems(length) => {
            ValidationRule::MinimumLength { length }
        }
        SchemaConstraint::MaxLength(length) | SchemaConstraint::MaxItems(length) => {
            ValidationRule::MaximumLength { length }
        }
        SchemaConstraint::Pattern {
            source: pattern,
            is_unicode,
        } => ValidationRule::Pattern {
            source: builder.file.intern_atom(pattern),
            is_unicode,
        },
        SchemaConstraint::Format(format) => ValidationRule::Format {
            format: text_format(format),
        },
        SchemaConstraint::Message(text) => {
            let text = builder.file.intern_atom(text);
            replace_rule(builder.node_mut(source), ValidationRule::Message { text });
            return Ok(());
        }
        SchemaConstraint::Default(default) => {
            let rule = default_rule(builder.file, default);
            replace_rule(builder.node_mut(source), rule);
            return Ok(());
        }
        SchemaConstraint::Strict => {
            if kind == ValueKind::Object {
                reject_undeclared_members(builder.node_mut(source));
            }
            return Ok(());
        }
        // The builder has closed the object, and hands the rule on to what the value holds.
        SchemaConstraint::DeepStrict => return Ok(()),
        SchemaConstraint::UniqueItems => ValidationRule::UniqueItems,
        SchemaConstraint::Contains {
            ty,
            minimum,
            maximum,
        } => ValidationRule::Contains {
            node: builder.ensure_operand(source, ty, "Contains")?,
            minimum,
            maximum,
        },
        SchemaConstraint::Not { ty } => ValidationRule::Not {
            node: builder.ensure_operand(source, ty, "Not")?,
        },
        SchemaConstraint::If {
            condition,
            then,
            otherwise,
        } => ValidationRule::If {
            condition: builder.ensure_operand(source, condition, "If")?,
            then: builder.ensure_operand(source, then, "If")?,
            otherwise: builder.ensure_operand(source, otherwise, "If")?,
        },
        SchemaConstraint::OneOf { arms } => ValidationRule::ExactlyOne {
            nodes: ensure_operands(builder, source, arms, "OneOf")?,
        },
        SchemaConstraint::AllOf { parts } => ValidationRule::Every {
            nodes: ensure_operands(builder, source, parts, "AllOf")?,
        },
        SchemaConstraint::PatternProperties { table, others } => {
            // An index signature speaks of every key, also of one that matches a pattern and holds what the pattern says.
            let Some(is_closed) = is_closed_without_signature(&builder.node_mut(source).shape)
            else {
                return Err(builder.refuse(source, alias.as_bytes()));
            };
            let mut sources = Vec::with_capacity(table.len());
            let mut nodes = Vec::with_capacity(table.len());
            for &(pattern, ty) in table {
                sources.push(builder.file.intern_atom(pattern));
                nodes.push(builder.ensure_part(source, ty, alias)?);
            }
            if !is_closed {
                let kind = builder.shape_of(others)?.kind;
                let (undeclared, value) = if matches!(kind, ShapeKind::Never) {
                    (UndeclaredMembers::Rejected, None)
                } else if matches!(kind, ShapeKind::Anything(AnythingReason::Unknown)) {
                    (UndeclaredMembers::Allowed, None)
                } else {
                    let value = builder.ensure_part(source, others, alias)?;
                    (UndeclaredMembers::Validated, Some(value))
                };
                set_undeclared_members(builder.node_mut(source), undeclared, value);
            }
            if table.is_empty() {
                return Ok(());
            }
            ValidationRule::PatternMembers { sources, nodes }
        }
        SchemaConstraint::PropertyNames { ty } => ValidationRule::MemberNames {
            node: builder.ensure_operand(source, ty, "PropertyNames")?,
        },
        SchemaConstraint::MinProperties(count) => ValidationRule::MinimumMembers { count },
        SchemaConstraint::MaxProperties(count) => ValidationRule::MaximumMembers { count },
        SchemaConstraint::DependentRequired(entries) => {
            for &(key, names) in entries {
                let key = builder.file.intern_atom(key);
                let names = intern_atoms(builder.file, names);
                let rule = ValidationRule::DependentMembers { key, names };
                builder.node_mut(source).rules.push(rule);
            }
            return Ok(());
        }
        SchemaConstraint::DependentSchemas(entries) => {
            for &(key, ty) in entries {
                let key = builder.file.intern_atom(key);
                let node = builder.ensure_operand(source, ty, "DependentSchemas")?;
                let rule = ValidationRule::DependentNode { key, node };
                builder.node_mut(source).rules.push(rule);
            }
            return Ok(());
        }
        SchemaConstraint::Refused(rule) => return Err(builder.refuse_atom(source, rule)),
    };
    builder.node_mut(source).rules.push(rule);
    Ok(())
}

/// JSON Schema has no empty `oneOf` or `allOf`, and an empty `allOf` would accept everything.
fn ensure_operands<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>>(
    builder: &mut NodeBuilder<'_, 'c, F>,
    source: Source<'c>,
    types: &[CheckerTypeId],
    alias: &'static str,
) -> Result<Vec<u32>, ValidationError> {
    if types.is_empty() {
        return Err(builder.refuse(source, alias.as_bytes()));
    }
    let mut nodes = Vec::with_capacity(types.len());
    for &ty in types {
        nodes.push(builder.ensure_operand(source, ty, alias)?);
    }
    Ok(nodes)
}

fn intern_atoms<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    atoms: &[Atom],
) -> Vec<StringId> {
    atoms.iter().map(|&atom| file.intern_atom(atom)).collect()
}

fn text_format(format: SchemaFormat) -> TextFormat {
    match format {
        SchemaFormat::Email => TextFormat::Email,
        SchemaFormat::Uuid => TextFormat::Uuid,
        SchemaFormat::Ipv4 => TextFormat::Ipv4,
        SchemaFormat::Ipv6 => TextFormat::Ipv6,
        SchemaFormat::Date => TextFormat::Date,
        SchemaFormat::DateTime => TextFormat::DateTime,
        SchemaFormat::Url => TextFormat::Url,
        SchemaFormat::Time => TextFormat::Time,
        SchemaFormat::Duration => TextFormat::Duration,
        SchemaFormat::Hostname => TextFormat::Hostname,
        SchemaFormat::Uri => TextFormat::Uri,
        SchemaFormat::UriReference => TextFormat::UriReference,
        SchemaFormat::Regex => TextFormat::Regex,
        SchemaFormat::JsonPointer => TextFormat::JsonPointer,
        SchemaFormat::RelativeJsonPointer => TextFormat::RelativeJsonPointer,
    }
}

fn default_rule<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    default: SchemaDefault,
) -> ValidationRule {
    match default {
        SchemaDefault::Null => ValidationRule::DefaultNull,
        SchemaDefault::Boolean(value) => ValidationRule::DefaultBoolean { value },
        SchemaDefault::Number(value) => ValidationRule::DefaultNumber { value },
        SchemaDefault::String(text) => ValidationRule::DefaultString {
            value: file.intern_atom(text),
        },
    }
}

fn rule_kind(rule: &ValidationRule) -> RuleKind {
    match rule {
        ValidationRule::Message { .. } => RuleKind::Message,
        ValidationRule::DefaultNull
        | ValidationRule::DefaultBoolean { .. }
        | ValidationRule::DefaultNumber { .. }
        | ValidationRule::DefaultString { .. } => RuleKind::Default,
        _ => RuleKind::Test,
    }
}

pub(super) fn has_default(node: &ValidationNode) -> bool {
    node.rules
        .iter()
        .any(|rule| rule_kind(rule) == RuleKind::Default)
}

fn replace_rule(node: &mut ValidationNode, rule: ValidationRule) {
    let kind = rule_kind(&rule);
    debug_assert!(kind != RuleKind::Test, "every test of a node applies");
    node.rules.retain(|known| rule_kind(known) != kind);
    node.rules.push(rule);
}

fn reject_undeclared_members(node: &mut ValidationNode) {
    let ValidationShape::Object { undeclared, .. } = &mut node.shape else {
        unreachable!("only an object type is closed");
    };
    match *undeclared {
        UndeclaredMembers::Allowed => *undeclared = UndeclaredMembers::Rejected,
        UndeclaredMembers::Rejected | UndeclaredMembers::Validated => {}
    }
}

/// None for a shape that is no object type, and for an object type with an index signature.
fn is_closed_without_signature(shape: &ValidationShape) -> Option<bool> {
    let ValidationShape::Object { undeclared, .. } = shape else {
        return None;
    };
    match undeclared {
        UndeclaredMembers::Allowed => Some(false),
        UndeclaredMembers::Rejected => Some(true),
        UndeclaredMembers::Validated => None,
    }
}

fn set_undeclared_members(
    node: &mut ValidationNode,
    members: UndeclaredMembers,
    value: Option<u32>,
) {
    let ValidationShape::Object {
        undeclared,
        undeclared_value,
        ..
    } = &mut node.shape
    else {
        unreachable!("only an object type has a table of patterns");
    };
    *undeclared = members;
    *undeclared_value = value;
}

#[cfg(test)]
mod tests {
    use bun_sema::atom::known;

    use super::*;

    const KINDS: [ValueKind; 7] = [
        ValueKind::Anything,
        ValueKind::Number,
        ValueKind::Text,
        ValueKind::List,
        ValueKind::Object,
        ValueKind::Dictionary,
        ValueKind::Other,
    ];

    fn every_rule() -> [SchemaConstraint<'static>; 29] {
        let ty = CheckerTypeId::STRING;
        [
            SchemaConstraint::Int32,
            SchemaConstraint::Int,
            SchemaConstraint::Min(1.0),
            SchemaConstraint::Max(1.0),
            SchemaConstraint::Above(1.0),
            SchemaConstraint::Below(1.0),
            SchemaConstraint::MultipleOf(1.0),
            SchemaConstraint::MinLength(1),
            SchemaConstraint::MaxLength(1),
            SchemaConstraint::MinItems(1),
            SchemaConstraint::MaxItems(1),
            SchemaConstraint::Pattern {
                source: known::length,
                is_unicode: false,
            },
            SchemaConstraint::Format(SchemaFormat::Email),
            SchemaConstraint::Message(known::length),
            SchemaConstraint::Default(SchemaDefault::Null),
            SchemaConstraint::Strict,
            SchemaConstraint::DeepStrict,
            SchemaConstraint::UniqueItems,
            SchemaConstraint::Contains {
                ty,
                minimum: 1,
                maximum: None,
            },
            SchemaConstraint::Not { ty },
            SchemaConstraint::If {
                condition: ty,
                then: ty,
                otherwise: ty,
            },
            SchemaConstraint::OneOf { arms: &[] },
            SchemaConstraint::AllOf { parts: &[] },
            SchemaConstraint::PatternProperties {
                table: &[],
                others: ty,
            },
            SchemaConstraint::PropertyNames { ty },
            SchemaConstraint::MinProperties(1),
            SchemaConstraint::MaxProperties(1),
            SchemaConstraint::DependentRequired(&[]),
            SchemaConstraint::DependentSchemas(&[]),
        ]
    }

    fn kinds_beside(constraint: SchemaConstraint<'_>) -> Vec<ValueKind> {
        let kinds = KINDS.into_iter();
        kinds
            .filter(|&kind| can_stand_beside(constraint, kind))
            .collect()
    }

    #[test]
    fn no_rule_stands_beside_shape_that_accepts_everything() {
        let unknown = kind_accepted(&ValidationShape::Unknown);
        assert_eq!(unknown, ValueKind::Anything);
        for rule in every_rule() {
            assert!(!can_stand_beside(rule, ValueKind::Anything), "{rule:?}");
        }
    }

    #[test]
    fn every_rule_stands_beside_some_shape() {
        for rule in every_rule() {
            assert!(!kinds_beside(rule).is_empty(), "{rule:?}");
        }
    }

    #[test]
    fn rules_that_close_objects_need_something_to_close() {
        assert_eq!(
            kinds_beside(SchemaConstraint::Strict),
            [ValueKind::Object, ValueKind::Dictionary]
        );
        assert_eq!(
            kinds_beside(SchemaConstraint::DeepStrict),
            [ValueKind::List, ValueKind::Object, ValueKind::Dictionary]
        );
        assert_eq!(kind_accepted(&ValidationShape::AnyObject), ValueKind::Other);
    }

    #[test]
    fn refusal_is_reported_beside_every_shape() {
        let refusal = SchemaConstraint::Refused(known::length);
        assert_eq!(kinds_beside(refusal), KINDS);
    }

    #[test]
    fn refusal_is_found_in_every_list() {
        let refused = SchemaConstraint::Refused(known::length);
        let refusal = [SchemaConstraint::Int, refused];
        let rules = [SchemaConstraint::Strict];
        let (refusal, rules) = (&refusal[..], &rules[..]);
        assert_eq!(find_refused_rule(&[rules, refusal]), Some(known::length));
        assert_eq!(find_refused_rule(&[refusal, rules]), Some(known::length));
        assert_eq!(find_refused_rule(&[rules]), None);
        assert_eq!(find_refused_rule(&[]), None);
    }

    #[test]
    fn index_signature_leaves_no_room_for_patterns() {
        let is_closed = |undeclared: UndeclaredMembers, undeclared_value: Option<u32>| {
            is_closed_without_signature(&ValidationShape::Object {
                layout: None,
                members: Vec::new(),
                undeclared,
                undeclared_value,
            })
        };
        assert_eq!(is_closed(UndeclaredMembers::Allowed, None), Some(false));
        assert_eq!(is_closed(UndeclaredMembers::Rejected, None), Some(true));
        assert_eq!(is_closed(UndeclaredMembers::Validated, Some(1)), None);
        let dictionary = ValidationShape::Dictionary { value: 1 };
        assert_eq!(is_closed_without_signature(&dictionary), None);
        let any_object = ValidationShape::AnyObject;
        assert_eq!(is_closed_without_signature(&any_object), None);
    }
}
