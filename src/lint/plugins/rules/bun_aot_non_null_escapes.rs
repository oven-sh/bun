use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::{get_type_flags, is_symbol_from_default_library};
use bun_lint::types::{Type, TypeFlags};
use bun_lint_oxlint::ast_util::is_global_reference;

/// Disallow `x!` on a value that can be missing, where `--aot` throws and plain JavaScript goes on with `undefined`.
pub struct AotNonNullEscapes;

const ESCAPES: Message = Message::new(
    "escapes",
    "`{{operand}}` can be {{missing}}. Under `--aot` this `!` then throws a `TypeError`, where plain JavaScript goes on with {{missing}}. Use `??` with a fallback, or test the value first.",
);

/// When the value of an operand of `&&`, `||` and `?:` is the value of all of them.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kept {
    Always,
    IfTruthy,
    IfFalsy,
}

/// What `--aot` does with the `!`, by where it is written.
enum Place<'a> {
    /// It asserts nothing there, or JavaScript throws there too.
    AsInJavaScript,
    Asserted,
    /// These assert nothing if the operand is `a[i]`: an operand of a comparison or of arithmetic, which is the
    /// expression. The left side of `||`. What a `switch` is about. What a variable starts with.
    Operand(Expr<'a>),
    Fallback,
    Switch,
    Variable,
}

const ARRAYS_OF_INTEGERS: [&str; 7] = [
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

/// `undefined`, `null` or a literal: what the other operand of `==` is asked about.
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

/// `Boolean(x)`, which is a test like `!!x`.
fn is_boolean_of(call: Call) -> bool {
    call.callee().is_ident("Boolean")
        && call.args().len() == 1
        && !call.is_optional()
        && call.args().iter().all(|it| it.tag() != ExprTag::Spread)
        && is_global_reference(call.callee())
}

/// `null!`, `undefined!`, `void 0!`: a place that is set later. Nothing is asserted.
fn is_missing_as_written(operand: Expr) -> bool {
    let operand = operand.skip_type_wrappers();
    matches!(operand.tag(), ExprTag::Null)
        || operand.unary_op() == Some(UnOp::Void)
        || operand.is_ident("undefined")
}

fn place_in_expression<'a>(top: Expr<'a>, parent: Expr<'a>, is_operand_itself: bool) -> Place<'a> {
    // These only look at their operands. What `&&`, `||` or `?:` yields for one is a value like any other.
    let looked_at = match is_operand_itself {
        true => Place::AsInJavaScript,
        false => Place::Asserted,
    };
    match parent.kind() {
        ExprKind::Dot { .. } | ExprKind::Spread(_) | ExprKind::Yield { star: true, .. } => {
            Place::AsInJavaScript
        }
        ExprKind::Index { obj, .. } if obj == top => Place::AsInJavaScript,
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)
            if call.callee() == top =>
        {
            Place::AsInJavaScript
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
        } => Place::AsInJavaScript,
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
            Place::AsInJavaScript
        }
        ExprKind::Assign { target, .. } if target == top => Place::Asserted,
        ExprKind::Assign { op: Some(op), .. } if is_arithmetic(op) => Place::Operand(parent),
        _ => Place::Asserted,
    }
}

/// Where the value of `e`, which is `x!`, goes.
fn place(e: Expr) -> Place {
    let (mut top, mut kept) = (e, Kept::Always);
    // Nothing but `satisfies` is around it. `x! as T` is not `x!` to what looks for `a[i]!`.
    let mut is_bare = true;
    // Only syntax of types is around it.
    let mut is_operand_itself = true;
    let parent = loop {
        let parent = top.parent();
        let Node::Expr(around) = parent else {
            break parent;
        };
        match around.kind() {
            ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::Instantiation { .. } => {}
            ExprKind::As { .. } | ExprKind::NonNull(_) => is_bare = false,
            ExprKind::Unary { op: UnOp::Not, .. } => return Place::AsInJavaScript,
            ExprKind::Call(call) if is_boolean_of(call) => return Place::AsInJavaScript,
            ExprKind::Cond { test, .. } if test == top => return Place::AsInJavaScript,
            ExprKind::Cond { .. } => is_operand_itself = false,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                right,
                ..
            } if right == top => {
                is_operand_itself = false;
            }
            // Where the left side decides, it is what the whole yields. Where it does not, it has only been tested.
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                ..
            } => {
                let decides = if op == BinOp::And {
                    Kept::IfFalsy
                } else {
                    Kept::IfTruthy
                };
                if kept != Kept::Always && kept != decides {
                    return Place::AsInJavaScript;
                }
                (kept, is_operand_itself) = (decides, false);
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
            return Place::AsInJavaScript;
        }
    }
    match kept {
        Kept::IfTruthy if is_bare => return Place::Fallback,
        Kept::IfTruthy | Kept::IfFalsy => return Place::Asserted,
        Kept::Always => {}
    }
    let destructures = |pat: Pat| !matches!(pat.kind(), PatKind::Ident(_));
    match parent {
        Node::Expr(parent) => match place_in_expression(top, parent, is_operand_itself) {
            Place::Operand(_) if top != e => Place::Asserted,
            place => place,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Switch { .. } if top == e => Place::Switch,
            // These throw in JavaScript too.
            StmtKind::Throw(_) | StmtKind::ForOf { .. } | StmtKind::With { .. } => {
                Place::AsInJavaScript
            }
            _ => Place::Asserted,
        },
        // JavaScript throws for `const { a } = undefined`.
        Node::VarDecl(declaration) if destructures(declaration.pat()) => Place::AsInJavaScript,
        Node::Param(param) if destructures(param.pat()) => Place::AsInJavaScript,
        Node::VarDecl(_) if top == e => Place::Variable,
        Node::Class(_) | Node::File(_) => Place::AsInJavaScript,
        _ => Place::Asserted,
    }
}

fn every_part(ty: Type, mut test: impl FnMut(Type) -> bool) -> bool {
    !ty.has_flags(TypeFlags::NEVER) && union_constituents(ty).iter().all(&mut test)
}

fn is_type_of_numbers(ty: Type) -> bool {
    every_part(ty, |part| part.has_flags(TypeFlags::NUMBER_LIKE))
}

fn is_array_of_integers(ty: Type) -> bool {
    intersection_constituents(ty).iter().any(|part| {
        let is_named = |symbol: bun_lint::types::TsSymbol| {
            ARRAYS_OF_INTEGERS
                .iter()
                .any(|name| symbol.name() == name.as_bytes())
        };
        part.symbol()
            .is_some_and(|symbol| is_named(symbol) && is_symbol_from_default_library(symbol))
    })
}

/// Whether the compiler keeps the elements as integers: those of an `Int32Array` and the like, and the members of a numeric
/// enum. There `undefined` has no room, and the `!` stays.
fn are_integers_known_of(read: Expr, obj: Expr, index: Expr) -> bool {
    let object = obj.ty().get_non_nullable_type();
    if is_type_of_numbers(index.ty()) && every_part(object, is_array_of_integers) {
        return true;
    }
    let is_member_of_enum = |part: Type| {
        part.has_flags(TypeFlags::ENUM_LITERAL) && part.has_flags(TypeFlags::NUMBER_LITERAL)
    };
    let element = read.ty();
    let is_beside_enum = union_constituents(element).iter().any(is_member_of_enum);
    // Nothing holds what is stored in a `(1 | 2)[]` to the numbers.
    let forgets_literals = every_part(object, |part| {
        part.symbol().is_some_and(|it| it.name() == b"Array")
    });
    every_part(element, |part| {
        let is_integer = |least: f64, most: f64| {
            part.number_value()
                .is_some_and(|it| it.fract() == 0.0 && it >= least && it <= most)
        };
        if part.has_flags(TypeFlags::NULLABLE) {
            true
        } else if is_member_of_enum(part) {
            is_integer(f64::from(i32::MIN), f64::from(i32::MAX))
        } else {
            !forgets_literals
                && part.has_flags(TypeFlags::NUMBER_LITERAL)
                && is_integer(-9_007_199_254_740_991.0, 9_007_199_254_740_991.0)
                && (is_beside_enum || part.number_value() != Some(0.0))
        }
    })
}

/// What `a?.b` is where `a` is there: where it is not, the `!` of `a?.b!` is not reached.
fn type_without_the_chain(operand: Expr) -> Option<Type> {
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
        (!file.twins_on().contains(bun_lint::language::Twins::NO_NON_NULL_ASSERTION)).then_some(())
    }

    fn new(_: &Options) -> Self {
        AotNonNullEscapes
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::NonNull(operand) = e.kind() else {
            return;
        };
        let place = place(e);
        if matches!(place, Place::AsInJavaScript) || is_missing_as_written(operand) {
            return;
        }
        let is_link_of_chain = operand.is_in_optional_chain() && !operand.is_parenthesized();
        let held = match is_link_of_chain {
            true => type_without_the_chain(operand),
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
                    (compares || is_type_of_numbers(e.ty()) && is_type_of_numbers(around.ty()))
                        && !are_integers_known_of(operand, obj, index)
                }
                Place::Switch => !are_integers_known_of(operand, obj, index),
                Place::Variable => {
                    !are_integers_known_of(operand, obj, index)
                        && e.is_kept_only_where_undefined_has_an_answer()
                }
                Place::Asserted | Place::AsInJavaScript => false,
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

/// The first line of the text, if that is short.
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
