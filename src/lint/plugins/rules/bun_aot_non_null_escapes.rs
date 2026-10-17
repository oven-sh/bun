use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::{get_type_flags, is_symbol_from_default_library};
use bun_lint::types::{Type, TypeFlags};
use bun_lint_oxlint::ast_util::is_global_reference;

pub struct AotNonNullEscapes;

const ESCAPES: Message = Message::new(
    "escapes",
    "`{{operand}}` can be {{missing}}. Under `--aot` this `!` then throws a `TypeError`, where plain JavaScript goes on with {{missing}}. Use `??` with a fallback, or test the value first.",
);

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kept {
    Always,
    IfTruthy,
    IfFalsy,
}

enum Place<'a> {
    JavaScriptSemantics,
    Asserted,
    Operand(Expr<'a>),
    Fallback,
    Switch,
    Variable,
}

const INTEGER_ARRAYS: [&str; 7] = [
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
];

fn is_arithmetic(op: BinOp) -> bool {
    use BinOp::{Add, BitAnd, BitOr, BitXor, Div, Mul, Pow, Rem, Shl, Shr, Sub, UShr};
    matches!(
        op,
        Add | Sub | Mul | Div | Rem | Pow | Shl | Shr | UShr | BitAnd | BitOr | BitXor
    )
}

fn is_literal(e: Expr) -> bool {
    let e = e.skip_type_wrappers();
    match e.kind() {
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_) => true,
        ExprKind::Unary {
            op: UnOp::Minus | UnOp::Void,
            operand,
        } => {
            matches!(operand.tag(), ExprTag::Number | ExprTag::BigInt)
        }
        _ => e.is_ident("undefined"),
    }
}

fn is_boolean_of(call: Call) -> bool {
    call.callee().is_ident("Boolean")
        && call.args().len() == 1
        && !call.is_optional()
        && call.args().iter().all(|it| it.tag() != ExprTag::Spread)
        && is_global_reference(call.callee())
}

fn is_missing_as_written(operand: Expr) -> bool {
    let operand = operand.skip_type_wrappers();
    matches!(operand.tag(), ExprTag::Null)
        || operand.unary_op() == Some(UnOp::Void)
        || operand.is_ident("undefined")
}

fn destination_in_expression<'a>(top: Expr<'a>, parent: Expr<'a>, is_operand_itself: bool) -> Place<'a> {
    let looked_at = match is_operand_itself {
        true => Place::JavaScriptSemantics,
        false => Place::Asserted,
    };
    match parent.kind() {
        ExprKind::Dot { .. } | ExprKind::Spread(_) | ExprKind::Yield { star: true, .. } => {
            Place::JavaScriptSemantics
        }
        ExprKind::Index { obj, .. } if obj == top => Place::JavaScriptSemantics,
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)
            if call.callee() == top =>
        {
            Place::JavaScriptSemantics
        }
        ExprKind::Unary {
            op: UnOp::Minus | UnOp::Plus | UnOp::BitNot,
            ..
        } => Place::Operand(parent),
        ExprKind::Unary {
            op: UnOp::Typeof, ..
        } => looked_at,
        ExprKind::Unary {
            op: UnOp::Delete, ..
        } => Place::JavaScriptSemantics,
        ExprKind::Binary { op, left, right } => match op {
            BinOp::EqEqEq | BinOp::NotEqEq | BinOp::In | BinOp::Instanceof => looked_at,
            BinOp::EqEq | BinOp::NotEq if is_literal(if left == top { right } else { left }) => {
                looked_at
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Place::Operand(parent),
            _ if is_arithmetic(op) => Place::Operand(parent),
            _ => Place::Asserted,
        },
        ExprKind::Assign {
            op: None, target, ..
        } if target == top || matches!(target.tag(), ExprTag::Array | ExprTag::Object) => {
            Place::JavaScriptSemantics
        }
        ExprKind::Assign { target, .. } if target == top => Place::Asserted,
        ExprKind::Assign { op: Some(op), .. } if is_arithmetic(op) => Place::Operand(parent),
        _ => Place::Asserted,
    }
}

fn place(e: Expr) -> Place {
    let (mut top, mut retained) = (e, Kept::Always);
    let mut is_bare = true;
    let mut is_operand_itself = true;
    let parent = loop {
        let parent = top.parent();
        let Node::Expr(around) = parent else {
            break parent;
        };
        match around.kind() {
            ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::Instantiation { .. } => {}
            ExprKind::As { .. } | ExprKind::NonNull(_) => is_bare = false,
            ExprKind::Unary { op: UnOp::Not, .. } => return Place::JavaScriptSemantics,
            ExprKind::Call(call) if is_boolean_of(call) => return Place::JavaScriptSemantics,
            ExprKind::Cond { test, .. } if test == top => return Place::JavaScriptSemantics,
            ExprKind::Cond { .. } => is_operand_itself = false,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                right,
                ..
            } if right == top => {
                is_operand_itself = false;
            }
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                ..
            } => {
                let decides = if op == BinOp::And {
                    Kept::IfFalsy
                } else {
                    Kept::IfTruthy
                };
                if retained != Kept::Always && retained != decides {
                    return Place::JavaScriptSemantics;
                }
                (retained, is_operand_itself) = (decides, false);
            }
            _ => break parent,
        }
        top = around;
    };
    if let Node::Stmt(statement) = parent {
        let test = match statement.kind() {
            StmtKind::If { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::DoWhile { test, .. } => Some(test),
            StmtKind::For { test, .. } => test,
            _ => None,
        };
        if test == Some(top) {
            return Place::JavaScriptSemantics;
        }
    }
    match retained {
        Kept::IfTruthy if is_bare => return Place::Fallback,
        Kept::IfTruthy | Kept::IfFalsy => return Place::Asserted,
        Kept::Always => {}
    }
    let destructures = |pat: Pat| !matches!(pat.kind(), PatKind::Ident(_));
    match parent {
        Node::Expr(parent) => match destination_in_expression(top, parent, is_operand_itself) {
            Place::Operand(_) if top != e => Place::Asserted,
            place => place,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Switch { .. } if top == e => Place::Switch,
            StmtKind::Throw(_) | StmtKind::ForOf { .. } | StmtKind::With { .. } => {
                Place::JavaScriptSemantics
            }
            _ => Place::Asserted,
        },
        Node::VarDecl(declaration) if destructures(declaration.pat()) => Place::JavaScriptSemantics,
        Node::Param(param) if destructures(param.pat()) => Place::JavaScriptSemantics,
        Node::VarDecl(_) if top == e => Place::Variable,
        Node::Class(_) | Node::File(_) => Place::JavaScriptSemantics,
        _ => Place::Asserted,
    }
}

fn every_part(ty: Type, mut test: impl FnMut(Type) -> bool) -> bool {
    !ty.has_flags(TypeFlags::NEVER) && union_constituents(ty).iter().all(&mut test)
}

fn is_number_type(ty: Type) -> bool {
    every_part(ty, |part| part.has_flags(TypeFlags::NUMBER_LIKE))
}

fn is_array_of_integers(ty: Type) -> bool {
    intersection_constituents(ty).iter().any(|part| {
        let is_named = |symbol: bun_lint::types::TsSymbol| {
            INTEGER_ARRAYS
                .iter()
                .any(|name| symbol.name() == name.as_bytes())
        };
        part.symbol()
            .is_some_and(|symbol| is_named(symbol) && is_symbol_from_default_library(symbol))
    })
}

fn has_known_integer_range(read: Expr, obj: Expr, index: Expr) -> bool {
    let object = obj.ty().get_non_nullable_type();
    if is_number_type(index.ty()) && every_part(object, is_array_of_integers) {
        return true;
    }
    let is_enum_member = |part: Type| {
        part.has_flags(TypeFlags::ENUM_LITERAL) && part.has_flags(TypeFlags::NUMBER_LITERAL)
    };
    let element = read.ty();
    let is_next_to_enum = union_constituents(element).iter().any(is_enum_member);
    let widens_literals = every_part(object, |part| {
        part.symbol().is_some_and(|it| it.name() == b"Array")
    });
    every_part(element, |part| {
        let is_integer = |minimum: f64, maximum: f64| {
            part.number_value()
                .is_some_and(|it| it.fract() == 0.0 && it >= minimum && it <= maximum)
        };
        if part.has_flags(TypeFlags::NULLABLE) {
            true
        } else if is_enum_member(part) {
            is_integer(f64::from(i32::MIN), f64::from(i32::MAX))
        } else {
            !widens_literals
                && part.has_flags(TypeFlags::NUMBER_LITERAL)
                && is_integer(-9_007_199_254_740_991.0, 9_007_199_254_740_991.0)
                && (is_next_to_enum || part.number_value() != Some(0.0))
        }
    })
}

fn type_without_optional_chain(operand: Expr) -> Option<Type> {
    match operand.kind() {
        ExprKind::Dot { obj, name, .. } => obj
            .ty()
            .get_non_nullable_type()
            .get_type_of_property(name.name().bytes()),
        ExprKind::Call(_) => Some(operand.resolved_signature()?.get_return_type()),
        _ => None,
    }
}

impl Rule for AotNonNullEscapes {
    const META: Meta =
        Meta::plugin(Plugin::Bun, "aot-non-null-escapes", Kind::Problem).requires_types();
    const ON: On = On::new().exprs(&[ExprTag::NonNull]);
    type State<'a> = ();

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!file.active_rule_overlaps().contains(bun_lint::language::RuleOverlaps::NO_NON_NULL_ASSERTION)).then_some(())
    }

    fn new(_: &Options) -> Self {
        AotNonNullEscapes
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::NonNull(operand) = e.kind() else {
            return;
        };
        let place = place(e);
        if matches!(place, Place::JavaScriptSemantics) || is_missing_as_written(operand) {
            return;
        }
        let is_optional_chain_link = operand.is_in_optional_chain() && !operand.is_parenthesized();
        let held = match is_optional_chain_link {
            true => type_without_optional_chain(operand),
            false => Some(operand.ty()),
        };
        let Some(flags) = held.map(get_type_flags) else {
            return;
        };
        if flags.intersects(TypeFlags::ANY_OR_UNKNOWN) || !flags.intersects(TypeFlags::NULLABLE) {
            return;
        }
        if let ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } = operand.kind()
            && obj.tag() != ExprTag::Super
        {
            let is_left_alone = match place {
                Place::Fallback => true,
                Place::Operand(around) => {
                    let compares = matches!(
                        around.binary_op(),
                        Some(BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge)
                    );
                    (compares || is_number_type(e.ty()) && is_number_type(around.ty()))
                        && !has_known_integer_range(operand, obj, index)
                }
                Place::Switch => !has_known_integer_range(operand, obj, index),
                Place::Variable => {
                    !has_known_integer_range(operand, obj, index)
                        && e.is_used_only_undefined_safely()
                }
                Place::Asserted | Place::JavaScriptSemantics => false,
            };
            if is_left_alone {
                return;
            }
        }
        let missing = match (
            flags.intersects(TypeFlags::UNDEFINED),
            flags.intersects(TypeFlags::NULL),
        ) {
            (true, true) => "`null` or `undefined`",
            (false, true) => "`null`",
            _ => "`undefined`",
        };
        cx.report(e, ESCAPES)
            .data("operand", shown(operand.text()))
            .data("missing", missing);
    }
}

fn shown(text: &[u8]) -> Vec<u8> {
    let line = text
        .get(..strings::index_of_char_usize(text, b'\n').unwrap_or(text.len()))
        .unwrap_or_default();
    let mut end = line.len().min(40);
    while end > 0 && line.get(end).is_some_and(|byte| byte & 0xC0 == 0x80) {
        end -= 1;
    }
    let mut shown = line
        .get(..end)
        .unwrap_or_default()
        .trim_ascii_end()
        .to_vec();
    if end < text.len() {
        shown.extend_from_slice(b"..");
    }
    shown
}
