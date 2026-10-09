use bun_lint::prelude::*;
use bun_lint::types::tsutils::union_constituents;
use bun_lint::types::utils::{get_constrained_type_at_location, is_type_flag_set};
use bun_lint::types::{SymbolFlags, Type, TypeFlags};
use bun_lint::utils::ts_utils::{
    WrappingFixerParams, get_wrapping_fixer_for_chain_element, get_wrapping_fixer_without_wrap,
};

/// Disallow conversion idioms when they do not change the type or value of the expression.
pub struct NoUnnecessaryTypeConversion;

const SUGGEST_REMOVE: Message = Message::new("suggestRemove", "Remove the type conversion.");
const SUGGEST_SATISFIES: Message = Message::new(
    "suggestSatisfies",
    "Instead, assert that the value satisfies the {{type}} type.",
);
const UNNECESSARY_TYPE_CONVERSION: Message = Message::new(
    "unnecessaryTypeConversion",
    "{{violation}} does not change the type or value of the {{type}}.",
);

fn is_enum_type(ty: Type) -> bool {
    ty.has_flags(TypeFlags::ENUM_LIKE)
}

fn is_enum_member_type(ty: Type) -> bool {
    ty.get_symbol().is_some_and(|symbol| symbol.has_flags(SymbolFlags::ENUM_MEMBER))
}

fn does_underlying_type_match_flag(ty: Type, type_flag: TypeFlags) -> bool {
    union_constituents(ty).iter().all(|t| is_type_flag_set(t, type_flag))
}

/// The type of an operand. tsgolint takes the constraint of a type parameter for it.
fn type_of_operand(e: Expr<'_>) -> Type<'_> {
    match e.file().language().is_oxlint {
        true => get_constrained_type_at_location(e),
        false => e.ty(),
    }
}

fn is_empty_string_literal(e: Expr) -> bool {
    e.as_string().is_some_and(|value| value.bytes().is_empty())
}

#[derive(Copy, Clone)]
struct Conversion<'a> {
    loc: Span,
    violation: &'static str,
    type_string: &'static str,
    /// What the suggestions replace.
    node: Expr<'a>,
    /// What they keep of it.
    inner_node: Expr<'a>,
}

type Context<'a> = Cx<'a, NoUnnecessaryTypeConversion>;

fn report<'a>(cx: &Context<'a>, conversion: &Conversion<'a>) {
    let Conversion {
        loc,
        violation,
        type_string,
        node,
        inner_node,
    } = *conversion;
    // Nothing is left of the statement `a += '';`.
    let statement = match (node.kind(), node.parent()) {
        (ExprKind::Assign { .. }, Node::Stmt(parent)) if matches!(parent.kind(), StmtKind::Expr(_)) => {
            Some(parent)
        }
        _ => None,
    };
    // oxlint points at what is converted.
    cx.report(if cx.language().is_oxlint { inner_node.outer_span() } else { loc }, UNNECESSARY_TYPE_CONVERSION)
        .comments_apply_at(loc)
        .data("type", type_string)
        .data("violation", violation)
        .suggest(SUGGEST_REMOVE, |fixer| match statement {
            Some(statement) => fixer.remove(statement),
            None => get_wrapping_fixer_without_wrap(fixer, node, &[inner_node]),
        })
        .suggest_with(SUGGEST_SATISFIES, &[("type", type_string.as_bytes())], |fixer| {
            get_wrapping_fixer_for_chain_element(
                fixer,
                WrappingFixerParams {
                    node,
                    inner_nodes: &[inner_node],
                    wrap: |code: &[&[u8]]| [code[0], b" satisfies ", type_string.as_bytes()].concat(),
                },
            )
        });
}

fn check_assignment<'a>(node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Assign {
        op: Some(BinOp::Add),
        target,
        value,
    } = node.kind()
    else {
        return;
    };
    // tsgolint looks at a name only.
    if cx.language().is_oxlint && (target.tag() != ExprTag::Ident || target.is_parenthesized()) {
        return;
    }
    if is_empty_string_literal(value) && does_underlying_type_match_flag(type_of_operand(target), TypeFlags::STRING_LIKE) {
        report(
            cx,
            &Conversion {
                loc: node.span(),
                violation: "Concatenating a string with ''",
                type_string: "string",
                node,
                inner_node: target,
            },
        );
    }
}

fn check_binary<'a>(node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Binary {
        op: BinOp::Add,
        left,
        right,
    } = node.kind()
    else {
        return;
    };
    if is_empty_string_literal(right) && does_underlying_type_match_flag(type_of_operand(left), TypeFlags::STRING_LIKE) {
        report(
            cx,
            &Conversion {
                loc: Span::new(left.span().end, node.span().end),
                violation: "Concatenating a string with ''",
                type_string: "string",
                node,
                inner_node: left,
            },
        );
    } else if is_empty_string_literal(left)
        && does_underlying_type_match_flag(type_of_operand(right), TypeFlags::STRING_LIKE)
    {
        report(
            cx,
            &Conversion {
                loc: Span::new(node.span().start, right.span().start),
                violation: "Concatenating '' with a string",
                type_string: "string",
                node,
                inner_node: right,
            },
        );
    }
}

fn check_call<'a>(node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Call(call) = node.kind() else {
        return;
    };
    let callee = call.callee();
    let (object, property) = match callee.kind() {
        ExprKind::Ident(name) => return check_built_in_call(node, call, name, cx),
        ExprKind::Dot { obj, name, .. } if name.bytes() == b"toString" => (obj, name.span()),
        ExprKind::Index { obj, index, .. } if index.is_ident("toString") => (obj, index.span()),
        _ => return,
    };
    // `(a?.toString)()` calls a `ChainExpression`. tsgolint leaves a call with arguments alone.
    if callee.is_chain_root() || cx.language().is_oxlint && !call.args().is_empty() {
        return;
    }
    let ty = get_constrained_type_at_location(object);
    if is_enum_type(ty) || is_enum_member_type(ty) {
        return;
    }
    if does_underlying_type_match_flag(ty, TypeFlags::STRING_LIKE) {
        report(
            cx,
            &Conversion {
                loc: Span::new(property.start, node.span().end),
                violation: "Calling a string's .toString() method",
                type_string: "string",
                node,
                inner_node: object,
            },
        );
    }
}

fn check_built_in_call<'a>(node: Expr<'a>, call: Call<'a>, name: Name<'a>, cx: &Context<'a>) {
    let (type_flag, type_string, violation) = match name.bytes() {
        b"BigInt" => (TypeFlags::BIG_INT_LIKE, "bigint", "Passing a bigint to BigInt()"),
        b"Boolean" => (TypeFlags::BOOLEAN_LIKE, "boolean", "Passing a boolean to Boolean()"),
        b"Number" => (TypeFlags::NUMBER_LIKE, "number", "Passing a number to Number()"),
        b"String" => (TypeFlags::STRING_LIKE, "string", "Passing a string to String()"),
        _ => return,
    };
    let callee = call.callee();
    let Some(argument) = call.args().first() else {
        return;
    };
    // tsgolint leaves a call with more arguments alone.
    if cx.language().is_oxlint && call.args().len() > 1 {
        return;
    }
    if callee.symbol().is_some()
        || !does_underlying_type_match_flag(get_constrained_type_at_location(argument), type_flag)
        || Node::Expr(node).scope().resolve_name(name).is_some()
    {
        return;
    }
    report(
        cx,
        &Conversion {
            loc: callee.span(),
            violation,
            type_string,
            node,
            inner_node: argument,
        },
    );
}

fn is_integer_literal_type(ty: Type) -> bool {
    is_type_flag_set(ty, TypeFlags::NUMBER_LITERAL)
        && ty.number_value().is_some_and(|value| value.is_finite() && value.fract() == 0.0)
}

fn check_unary<'a>(outer_node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Unary { op, operand } = outer_node.kind() else {
        return;
    };
    // `node` is the operator next to the argument: the second of `!!` and `~~`.
    let (node, argument) = match (op, operand.kind()) {
        (UnOp::Plus, _) => (outer_node, operand),
        (UnOp::Not | UnOp::BitNot, ExprKind::Unary { op: inner, operand: argument }) if inner == op => {
            (operand, argument)
        }
        _ => return,
    };
    let ty = type_of_operand(argument);
    let (is_unnecessary, type_string, violation) = match op {
        UnOp::Plus => (
            does_underlying_type_match_flag(ty, TypeFlags::NUMBER_LIKE),
            "number",
            "Using the unary + operator on a number",
        ),
        UnOp::Not => (
            does_underlying_type_match_flag(ty, TypeFlags::BOOLEAN_LIKE),
            "boolean",
            "Using !! on a boolean",
        ),
        _ => (
            union_constituents(ty).iter().all(is_integer_literal_type),
            "number",
            "Using ~~ on an integer",
        ),
    };
    if is_unnecessary {
        report(
            cx,
            &Conversion {
                loc: Span::new(outer_node.span().start, node.span().start + 1),
                violation,
                type_string,
                node: outer_node,
                inner_node: argument,
            },
        );
    }
}

impl Rule for NoUnnecessaryTypeConversion {
    const META: Meta = Meta::typescript("no-unnecessary-type-conversion", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryTypeConversion
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Assign], |_, node, cx| check_assignment(node, cx));
        on.exprs([ExprTag::Binary], |_, node, cx| check_binary(node, cx));
        on.exprs([ExprTag::Call], |_, node, cx| check_call(node, cx));
        on.exprs([ExprTag::Unary], |_, node, cx| check_unary(node, cx));
    }
}
