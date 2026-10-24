use bun_sema::check::aot::{SchemaConstraint, SchemaDefault, SchemaFormat};

use super::ValidatedFile;
use crate::ir::generated::{
    TextFormat, UndeclaredMembers, ValidationNode, ValidationRule, ValidationShape,
};

#[derive(Copy, Clone, PartialEq, Eq)]
enum RuleKind {
    Test,
    Message,
    Default,
}

pub(super) trait AppliesConstraints<'c, 'p: 'c, 's: 'p>: ValidatedFile<'c, 'p, 's> {
    fn apply_constraint(&mut self, node: &mut ValidationNode, constraint: SchemaConstraint) {
        match constraint {
            SchemaConstraint::Int => node.rules.push(ValidationRule::Integer),
            SchemaConstraint::Int32 => node.rules.extend([
                ValidationRule::Integer,
                ValidationRule::Minimum {
                    bound: f64::from(i32::MIN),
                },
                ValidationRule::Maximum {
                    bound: f64::from(i32::MAX),
                },
            ]),
            SchemaConstraint::Min(bound) => node.rules.push(ValidationRule::Minimum { bound }),
            SchemaConstraint::Max(bound) => node.rules.push(ValidationRule::Maximum { bound }),
            SchemaConstraint::Above(bound) => {
                node.rules.push(ValidationRule::ExclusiveMinimum { bound });
            }
            SchemaConstraint::Below(bound) => {
                node.rules.push(ValidationRule::ExclusiveMaximum { bound });
            }
            SchemaConstraint::MultipleOf(divisor) => {
                node.rules.push(ValidationRule::MultipleOf { divisor });
            }
            SchemaConstraint::MinLength(length) | SchemaConstraint::MinItems(length) => {
                node.rules.push(ValidationRule::MinimumLength { length });
            }
            SchemaConstraint::MaxLength(length) | SchemaConstraint::MaxItems(length) => {
                node.rules.push(ValidationRule::MaximumLength { length });
            }
            SchemaConstraint::Pattern(source) => {
                let source = self.intern_atom(source);
                node.rules.push(ValidationRule::Pattern { source });
            }
            SchemaConstraint::Format(format) => {
                let format = text_format(format);
                node.rules.push(ValidationRule::Format { format });
            }
            SchemaConstraint::Message(text) => {
                let text = self.intern_atom(text);
                replace_rule(node, ValidationRule::Message { text });
            }
            SchemaConstraint::Default(default) => {
                let rule = self.default_rule(default);
                replace_rule(node, rule);
            }
            SchemaConstraint::Strict => reject_undeclared_members(node),
            SchemaConstraint::DeepStrict => {}
        }
    }

    fn default_rule(&mut self, default: SchemaDefault) -> ValidationRule {
        match default {
            SchemaDefault::Null => ValidationRule::DefaultNull,
            SchemaDefault::Boolean(value) => ValidationRule::DefaultBoolean { value },
            SchemaDefault::Number(value) => ValidationRule::DefaultNumber { value },
            SchemaDefault::String(text) => ValidationRule::DefaultString {
                value: self.intern_atom(text),
            },
        }
    }
}

impl<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>> AppliesConstraints<'c, 'p, 's> for F {}

fn text_format(format: SchemaFormat) -> TextFormat {
    match format {
        SchemaFormat::Email => TextFormat::Email,
        SchemaFormat::Uuid => TextFormat::Uuid,
        SchemaFormat::Ipv4 => TextFormat::Ipv4,
        SchemaFormat::Ipv6 => TextFormat::Ipv6,
        SchemaFormat::Date => TextFormat::Date,
        SchemaFormat::DateTime => TextFormat::DateTime,
        SchemaFormat::Url => TextFormat::Url,
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

fn replace_rule(node: &mut ValidationNode, rule: ValidationRule) {
    let kind = rule_kind(&rule);
    debug_assert!(kind != RuleKind::Test, "every test of a node applies");
    node.rules.retain(|known| rule_kind(known) != kind);
    node.rules.push(rule);
}

fn reject_undeclared_members(node: &mut ValidationNode) {
    let ValidationShape::Object { undeclared, .. } = &mut node.shape else {
        return;
    };
    match *undeclared {
        UndeclaredMembers::Allowed => *undeclared = UndeclaredMembers::Rejected,
        UndeclaredMembers::Rejected | UndeclaredMembers::Validated => {}
    }
}
