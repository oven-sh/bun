use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::f64::consts;

/// Disallows the use of approximate constants, instead preferring the use of the constants in the `Math` object.
pub struct ApproxConstant;

const APPROX_CONSTANT: Message = Message::new("", "Approximate value of `{{method_name}}` found.");
const USE_MATH: Message = Message::new("", "Use `Math.{{method_name}}` instead.");

impl Rule for ApproxConstant {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "approx-constant", Kind::Problem).has_suggestions();
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(_: &Options) -> Self {
        ApproxConstant
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let Some(value) = value_of(literal) else {
            return;
        };
        // What is written has three decimals or more. Nothing is formatted for other numbers.
        if !KNOWN_CONSTS.iter().any(|it| (it.0 - value).abs() < 0.002) {
            return;
        }
        let number_lit_str = value.to_string();
        let Some((_, name, _)) = KNOWN_CONSTS.iter().find(|it| is_approx_const(it.0, &number_lit_str, it.2)) else {
            return;
        };
        cx.report(literal, APPROX_CONSTANT).data("method_name", *name).suggest_with(
            USE_MATH,
            &[("method_name", name.as_bytes())],
            |fixer| match literal.owner().scope().resolve("Math") {
                Some(_) => None,
                None => Some(fixer.replace(literal, format!("Math.{name}"))),
            },
        );
    }
}

fn value_of(literal: Literal) -> Option<f64> {
    let key = match literal.owner() {
        Node::Expr(e) => match e.kind() {
            ExprKind::Number(value) => return Some(value),
            _ => return None,
        },
        // The sign is not part of the literal.
        Node::Type(ty) => match ty.kind() {
            TypeKind::NumberLit(value) => return Some(value.abs()),
            _ => return None,
        },
        Node::Prop(it) => it.key(),
        Node::Member(it) => it.key(),
        Node::EnumMember(it) => it.key(),
        Node::PatProp(it) => it.key(),
        _ => None,
    };
    if literal.is_bigint() {
        return None;
    }
    Some(bun_core::fmt::js_string_to_number(key?.name()?.bytes()))
}

const KNOWN_CONSTS: [(f64, &str, usize); 8] = [
    (consts::E, "E", 4),
    (consts::LN_10, "LN10", 4),
    (consts::LN_2, "LN2", 4),
    (consts::LOG2_E, "LOG2E", 4),
    (consts::LOG10_E, "LOG10E", 4),
    (consts::PI, "PI", 4),
    (consts::FRAC_1_SQRT_2, "SQRT1_2", 4),
    (consts::SQRT_2, "SQRT2", 4),
];

fn is_approx_const(constant: f64, value: &str, min_digits: usize) -> bool {
    if value.len() <= min_digits {
        false
    } else if constant.to_string().starts_with(value) {
        // The value is a truncated constant.
        true
    } else {
        value == format!("{constant:.*}", value.len() - 2)
    }
}
