// internal/evaluator/evaluator.go: the value of a constant expression, for enum members and template literal types.
use crate::ast::{self, Ast, Kind, NodeId, OuterExpressionKinds};
use crate::checker::LiteralValue;
use crate::internal::FaultKind;
use crate::jsnum::{self, Number, PseudoBigInt};

// `Value` is upstream's `any`: a string, a number, a bool, a bigint, or nil, which is what a literal type holds.
#[derive(Clone, Default, PartialEq, Debug)]
pub struct Result<'a> {
    pub value: LiteralValue<'a>,
    pub is_syntactically_string: bool,
    pub resolved_other_files: bool,
    pub has_external_references: bool,
}

pub fn new_result<'a>(
    value: LiteralValue<'a>,
    is_syntactically_string: bool,
    resolved_other_files: bool,
    has_external_references: bool,
) -> Result<'a> {
    Result {
        value,
        is_syntactically_string,
        resolved_other_files,
        has_external_references,
    }
}

// Upstream's Evaluator is a closure over the entity evaluator of its checker. A stored closure cannot borrow the checker, so the entity evaluator is an argument of each call.
#[derive(Clone, Copy, Debug)]
pub struct Evaluator {
    outer_expressions_to_skip: OuterExpressionKinds,
}

pub fn new_evaluator(outer_expressions_to_skip: OuterExpressionKinds) -> Evaluator {
    Evaluator {
        outer_expressions_to_skip,
    }
}

fn number_of(value: &LiteralValue<'_>) -> Option<Number> {
    match value {
        LiteralValue::Number(value) => Some(Number(*value)),
        _ => None,
    }
}

fn string_of<'a>(value: &LiteralValue<'a>) -> Option<&'a [u8]> {
    match value {
        LiteralValue::String(value) => Some(*value),
        _ => None,
    }
}

impl Evaluator {
    pub fn evaluate<'a>(
        self,
        a: Ast<'a>,
        expr: NodeId,
        location: NodeId,
        evaluate_entity: &mut dyn FnMut(NodeId, NodeId) -> Result<'a>,
    ) -> Result<'a> {
        let mut is_syntactically_string = false;
        let mut resolved_other_files = false;
        let mut has_external_references = false;
        // Go stacks grow: an expression deeper than the stack allows has no value, and one internal diagnostic.
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            a.fault(FaultKind::StackLimit, "stack limit reached", 0, expr.0);
            return Result::default();
        }
        // It's unclear when/whether we should consider skipping other kinds of outer expressions. Type assertions intentionally break evaluation when evaluating literal types, such as `type T = `one ${"two" as any} three`; // string`. SatisfiesExpressions and non-null assertions also break Babel's evaluation (but not esbuild's), and the isolatedModules errors we give depend on our evaluation results, so we're currently being conservative so as to issue errors on code that might break Babel.
        let expr = ast::skip_outer_expressions(
            a,
            expr,
            self.outer_expressions_to_skip | OuterExpressionKinds::PARENTHESES,
        );
        match a.kind(expr) {
            Kind::PrefixUnaryExpression => {
                let unary = a.as_prefix_unary_expression(expr);
                let result = self.evaluate(a, unary.operand, location, evaluate_entity);
                resolved_other_files = result.resolved_other_files;
                has_external_references = result.has_external_references;
                if let Some(value) = number_of(&result.value) {
                    let evaluated = match unary.operator {
                        Kind::PlusToken => Some(value),
                        Kind::MinusToken => Some(-value),
                        Kind::TildeToken => Some(value.bitwise_not()),
                        _ => None,
                    };
                    if let Some(evaluated) = evaluated {
                        return Result {
                            value: LiteralValue::Number(evaluated.0),
                            is_syntactically_string,
                            resolved_other_files,
                            has_external_references,
                        };
                    }
                }
            }
            Kind::BinaryExpression => {
                let binary = a.as_binary_expression(expr);
                let left = self.evaluate(a, binary.left, location, evaluate_entity);
                let right = self.evaluate(a, binary.right, location, evaluate_entity);
                let operator = a.kind(binary.operator_token);
                is_syntactically_string = (left.is_syntactically_string
                    || right.is_syntactically_string)
                    && operator == Kind::PlusToken;
                resolved_other_files = left.resolved_other_files || right.resolved_other_files;
                has_external_references =
                    left.has_external_references || right.has_external_references;
                let left_num = number_of(&left.value);
                let right_num = number_of(&right.value);
                if let (Some(left_num), Some(right_num)) = (left_num, right_num) {
                    let evaluated = match operator {
                        Kind::BarToken => Some(left_num.bitwise_or(right_num)),
                        Kind::AmpersandToken => Some(left_num.bitwise_and(right_num)),
                        Kind::GreaterThanGreaterThanToken => {
                            Some(left_num.signed_right_shift(right_num))
                        }
                        Kind::GreaterThanGreaterThanGreaterThanToken => {
                            Some(left_num.unsigned_right_shift(right_num))
                        }
                        Kind::LessThanLessThanToken => Some(left_num.left_shift(right_num)),
                        Kind::CaretToken => Some(left_num.bitwise_xor(right_num)),
                        Kind::AsteriskToken => Some(left_num * right_num),
                        Kind::SlashToken => Some(left_num / right_num),
                        Kind::PlusToken => Some(left_num + right_num),
                        Kind::MinusToken => Some(left_num - right_num),
                        Kind::PercentToken => Some(left_num.remainder(right_num)),
                        Kind::AsteriskAsteriskToken => Some(left_num.exponentiate(right_num)),
                        _ => None,
                    };
                    if let Some(evaluated) = evaluated {
                        return Result {
                            value: LiteralValue::Number(evaluated.0),
                            is_syntactically_string,
                            resolved_other_files,
                            has_external_references,
                        };
                    }
                }
                let left_str = string_of(&left.value);
                let right_str = string_of(&right.value);
                if (left_str.is_some() || left_num.is_some())
                    && (right_str.is_some() || right_num.is_some())
                    && operator == Kind::PlusToken
                {
                    let mut text = Vec::new();
                    match left_num {
                        Some(left_num) => text.extend_from_slice(&left_num.string()),
                        None => text.extend_from_slice(left_str.unwrap_or(b"")),
                    }
                    match right_num {
                        Some(right_num) => text.extend_from_slice(&right_num.string()),
                        None => text.extend_from_slice(right_str.unwrap_or(b"")),
                    }
                    return Result {
                        value: LiteralValue::String(a.open().arena.alloc_slice_copy(&text)),
                        is_syntactically_string,
                        resolved_other_files,
                        has_external_references,
                    };
                }
            }
            Kind::StringLiteral | Kind::NoSubstitutionTemplateLiteral => {
                return Result {
                    value: LiteralValue::String(a.text(expr)),
                    is_syntactically_string: true,
                    resolved_other_files: false,
                    has_external_references: false,
                };
            }
            Kind::TemplateExpression => {
                return self.evaluate_template_expression(a, expr, location, evaluate_entity);
            }
            Kind::NumericLiteral => {
                return Result {
                    value: LiteralValue::Number(jsnum::from_string(a.text(expr)).0),
                    is_syntactically_string: false,
                    resolved_other_files: false,
                    has_external_references: false,
                };
            }
            Kind::Identifier => return evaluate_entity(expr, location),
            Kind::ElementAccessExpression | Kind::PropertyAccessExpression => {
                if ast::is_entity_name_expression(a, a.expression(expr)) {
                    return evaluate_entity(expr, location);
                }
            }
            _ => {}
        }
        Result {
            value: LiteralValue::default(),
            is_syntactically_string,
            resolved_other_files,
            has_external_references,
        }
    }

    fn evaluate_template_expression<'a>(
        self,
        a: Ast<'a>,
        expr: NodeId,
        location: NodeId,
        evaluate_entity: &mut dyn FnMut(NodeId, NodeId) -> Result<'a>,
    ) -> Result<'a> {
        let template = a.as_template_expression(expr);
        let mut sb = Vec::new();
        sb.extend_from_slice(a.text(template.head));
        let mut resolved_other_files = false;
        let mut has_external_references = false;
        for &span in a.nodes(template.template_spans).as_slice() {
            let span_result = self.evaluate(a, a.expression(span), location, evaluate_entity);
            if span_result.value == LiteralValue::default() {
                return Result {
                    value: LiteralValue::default(),
                    is_syntactically_string: true,
                    resolved_other_files: false,
                    has_external_references: false,
                };
            }
            sb.extend_from_slice(&any_to_string(&span_result.value));
            sb.extend_from_slice(a.text(a.as_template_span(span).literal));
            resolved_other_files = resolved_other_files || span_result.resolved_other_files;
            has_external_references =
                has_external_references || span_result.has_external_references;
        }
        Result {
            value: LiteralValue::String(a.open().arena.alloc_slice_copy(&sb)),
            is_syntactically_string: true,
            resolved_other_files,
            has_external_references,
        }
    }
}

// Upstream panics for a value that is none of the four kinds: nil has no text here.
pub fn any_to_string(v: &LiteralValue<'_>) -> Vec<u8> {
    match v {
        LiteralValue::String(v) => v.to_vec(),
        LiteralValue::Number(v) => Number(*v).string(),
        LiteralValue::Boolean(v) => {
            if *v {
                b"true".to_vec()
            } else {
                b"false".to_vec()
            }
        }
        LiteralValue::BigInt(v) => v.string(),
        _ => Vec::new(),
    }
}

// Upstream panics for a value that is none of the four kinds: nil is falsy here.
pub fn is_truthy(v: &LiteralValue<'_>) -> bool {
    match v {
        LiteralValue::String(v) => !v.is_empty(),
        LiteralValue::Number(v) => *v != 0.0 && !Number(*v).is_nan(),
        LiteralValue::Boolean(v) => *v,
        LiteralValue::BigInt(v) => *v != PseudoBigInt::default(),
        _ => false,
    }
}
