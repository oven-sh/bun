//! oxlint's `utils/unicorn.rs`, on the handles. Each function has the name that it has there.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{
    as_member_expression, get_inner_expression, is_decorator_expression, is_method_call, plain,
    static_property_info, static_property_name,
};
use bun_lint_oxlint::same_expression::is_same_expression;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;

pub(crate) fn is_empty_stmt(stmt: Stmt) -> bool {
    let mut pending: SmallVec<[Stmt; 8]> = smallvec![stmt];
    while let Some(stmt) = pending.pop() {
        match stmt.kind() {
            StmtKind::Empty => {}
            StmtKind::Block(body) => pending.extend(body),
            _ => return false,
        }
    }
    true
}

/// `ast_util::could_be_asi_hazard`: whether text that starts with `[`, `(`, `/`, `+`, `-` or a backtick, in the place
/// of `node`, would continue the statement before.
pub(crate) fn could_be_asi_hazard(node: Expr) -> bool {
    let start = node.span().start;
    let mut statement = None;
    for ancestor in Node::Expr(node).ancestors() {
        match ancestor {
            Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr => {
                statement = Some(stmt);
                break;
            }
            // What can start with the node.
            Node::Expr(e) if e.outer_span().start == start => match e.tag() {
                ExprTag::Call
                | ExprTag::Index
                | ExprTag::Dot
                | ExprTag::TaggedTemplate
                | ExprTag::Binary
                | ExprTag::Assign
                | ExprTag::Cond
                | ExprTag::Await
                | ExprTag::As
                | ExprTag::AsConst
                | ExprTag::Satisfies
                | ExprTag::NonNull
                | ExprTag::Instantiation => {}
                _ => return false,
            },
            _ => return false,
        }
    }
    let Some(statement) = statement.filter(|it| it.span().start == start && start != 0) else {
        return false;
    };
    // The body of one of these follows a `)` or a keyword.
    let is_body = matches!(statement.parent(), Node::Stmt(parent) if matches!(
        parent.kind(),
        StmtKind::If { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::With { .. }
            | StmtKind::Labeled { .. }
    ));
    if is_body {
        return false;
    }
    let file = node.file();
    let before = file
        .text()
        .get(..file.end_of_token_before(start) as usize)
        .unwrap_or_default();
    let continuation_bytes = before
        .iter()
        .rev()
        .take(3)
        .take_while(|it| **it & 0xC0 == 0x80)
        .count();
    let last = before
        .get(before.len().saturating_sub(continuation_bytes + 1)..)
        .unwrap_or_default();
    std::str::from_utf8(last)
        .ok()
        .and_then(|it| it.chars().next())
        .is_some_and(|last| {
            matches!(
                last,
                ')' | ']' | '}' | '"' | '\'' | '`' | '+' | '-' | '/' | '.' | '_' | '$'
            ) || last.is_alphanumeric()
        })
}

/// `[...a]`, not in parentheses.
pub(crate) fn is_array_of_one_spread(e: Expr) -> bool {
    !e.is_parenthesized()
        && matches!(e.kind(), ExprKind::Array(elements)
            if elements.len() == 1 && elements.first().is_some_and(|it| it.tag() == ExprTag::Spread))
}

/// `e;`: the parent is an `ExpressionStatement`, or the `ChainExpression` that is all of one.
pub(crate) fn is_expression_statement(e: Expr) -> bool {
    !e.is_parenthesized()
        && matches!(e.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Expr)
}

/// What `get_inner_expression()` leads to `e` from, the outermost: `(e as T)!`. `None`: `e` is the whole of an optional
/// chain, which it does not look into.
pub(crate) fn outermost_wrapper(e: Expr<'_>) -> Option<Expr<'_>> {
    let mut at = e;
    loop {
        if at.is_chain_root() {
            return None;
        }
        match at.parent() {
            Node::Expr(parent)
                if matches!(
                    parent.tag(),
                    ExprTag::As
                        | ExprTag::AsConst
                        | ExprTag::Satisfies
                        | ExprTag::NonNull
                        | ExprTag::Instantiation
                ) =>
            {
                at = parent;
            }
            _ => return Some(at),
        }
    }
}

/// `Boolean(a)`
fn is_boolean_call(e: Expr) -> bool {
    e.as_call().is_some_and(|call| {
        call.args().len() == 1
            && call.callee().is_ident("Boolean")
            && !call.callee().is_parenthesized()
    })
}

/// Whether the parent of the parent of `node` is `Boolean(..)`, as oxlint counts parents: parentheses and the
/// `ChainExpression` around an optional chain are some. So not `Boolean(node)`, but `Boolean((node))`,
/// `Boolean(f(node))`, `Boolean(a?.node())`.
fn is_boolean_call_argument(node: Expr, parent: Node) -> bool {
    let wrappers = |e: Expr| {
        usize::from(e.is_chain_root())
            + if e.is_parenthesized() {
                e.parens().len()
            } else {
                0
            }
    };
    let Node::Expr(parent) = parent else {
        return false;
    };
    match wrappers(node) {
        0 => wrappers(parent) == 0 && parent.parent().as_expr().is_some_and(is_boolean_call),
        1 => is_boolean_call(parent),
        _ => false,
    }
}

/// Whether only the truthiness of `node` counts. `known`: of the rule, for the file: what has been found for the `&&`
/// and `||` that the questions have in common.
pub(crate) fn is_boolean_node<'a>(node: Expr<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    let answer = known.find(Node::Expr(node), |node, parent| {
        let Node::Expr(node) = node else {
            return Some(false);
        };
        if node.unary_op() == Some(UnOp::Not)
            || is_boolean_call(node)
            || is_boolean_call_argument(node, parent)
        {
            return Some(true);
        }
        // The parent is a `ChainExpression`, which oxlint does not look through.
        if node.is_chain_root() {
            return Some(false);
        }
        match parent {
            Node::Stmt(parent) => Some(matches!(
                parent.tag(),
                StmtTag::If | StmtTag::While | StmtTag::DoWhile | StmtTag::For
            )),
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Unary { op: UnOp::Not, .. } => Some(true),
                ExprKind::Cond { test, .. } => Some(test == node),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or,
                    ..
                } => None,
                _ => Some(false),
            },
            _ => Some(false),
        }
    });
    answer.unwrap_or(false)
}

/// `[]`, not in parentheses.
pub(crate) fn is_empty_array_expression(e: Expr) -> bool {
    !e.is_parenthesized() && matches!(e.kind(), ExprKind::Array(elements) if elements.is_empty())
}

/// `Array.prototype.property`, `[].property`: `object` is `"Array"`. `Object.prototype.property`, `{}.property`:
/// `"Object"`.
pub(crate) fn is_prototype_property(member: Expr, property: &str, object: &str) -> bool {
    let Some(of) = member.object() else {
        return false;
    };
    if member.is_optional() || !static_property_name(member).is_some_and(|it| it.is(property)) {
        return false;
    }
    let is_prototype = as_member_expression(of).is_some_and(|prototype| {
        !prototype.is_optional()
            && static_property_name(prototype).is_some_and(|it| it.is("prototype"))
            && prototype
                .object()
                .is_some_and(|it| it.is_ident(object) && !it.is_parenthesized())
    });
    is_prototype
        || match object {
            "Array" => is_empty_array_expression(of),
            "Object" => {
                !of.is_parenthesized()
                    && matches!(of.kind(), ExprKind::Object(properties) if properties.is_empty())
            }
            _ => false,
        }
}

/// The name of the first parameter, which is not `...rest`.
pub(crate) fn get_first_parameter_name(func: Func<'_>) -> Option<Name<'_>> {
    func.params()
        .first()
        .filter(|it| !it.is_rest())?
        .pat()
        .as_ident()
}

/// The `a` of a body that starts with `return a`, `{ return a }` or `a;`.
pub(crate) fn get_return_identifier_name(func: Func<'_>) -> Option<Name<'_>> {
    fn identifier(e: Expr<'_>) -> Option<Name<'_>> {
        e.as_ident().filter(|_| !e.is_parenthesized())
    }
    fn returned(stmt: Stmt<'_>) -> Option<Name<'_>> {
        match stmt.kind() {
            StmtKind::Return(argument) => argument.and_then(identifier),
            _ => None,
        }
    }
    let first = func
        .body_statements()?
        .iter()
        .find(|it| it.directive().is_none())?;
    match first.kind() {
        StmtKind::Block(statements) => returned(statements.first()?),
        StmtKind::Expr(e) => identifier(e),
        _ => returned(first),
    }
}

/// `Expression::is_number_value`. What is in parentheses is not a number there.
pub(crate) fn is_number_value(e: Expr, value: f64) -> bool {
    !e.is_parenthesized()
        && matches!(e.kind(), ExprKind::Number(n) if (n - value).abs() < f64::EPSILON)
}

/// `Expression::is_number_0`
pub(crate) fn is_number_0(e: Expr) -> bool {
    !e.is_parenthesized() && matches!(e.kind(), ExprKind::Number(n) if n == 0.0)
}

/// The statements that `statement` is one of.
pub(crate) fn statements_around(statement: Stmt<'_>) -> Option<List<'_, Stmt<'_>>> {
    match statement.parent() {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(block) => block.as_block(),
        Node::Case(case) => Some(case.body()),
        _ => None,
    }
}

/// The arguments of `array.method(first, second)`.
pub(crate) struct UnnecessaryArgument<'a> {
    pub(crate) first: Expr<'a>,
    pub(crate) second: Expr<'a>,
    /// How a message calls `second`.
    pub(crate) arg_str: Cow<'a, [u8]>,
}

/// `array.method(start, array.length)`, `array.method(start, Infinity)`, for one of `methods`. What
/// `no-unnecessary-slice-end` and `no-unnecessary-array-splice-count` have in common.
pub(crate) fn unnecessary_length_or_infinity_argument<'a>(
    call: Call<'a>,
    methods: &[&str],
) -> Option<UnnecessaryArgument<'a>> {
    let callee = call.callee();
    if call.is_optional()
        || !is_method_call(call, None, Some(methods), Some(2), Some(2))
        || callee.tag() != ExprTag::Dot
        || callee.is_parenthesized()
    {
        return None;
    }
    let (array, first, second) = (callee.object()?, call.args().first()?, call.args().get(1)?);
    if array.tag() == ExprTag::Call && !array.is_parenthesized()
        || first.tag() == ExprTag::Spread
        || second.tag() == ExprTag::Spread
    {
        return None;
    }
    let description = match second.kind() {
        ExprKind::Ident(name) if name.is("Infinity") => second.text(),
        ExprKind::Dot { .. } if second.is_private_member() => return None,
        ExprKind::Dot { .. } if second.text() == b"Number.POSITIVE_INFINITY" => second.text(),
        ExprKind::Dot { obj, name, .. } => {
            if !name.name().is("length")
                || array.is_parenthesized()
                || obj.is_parenthesized()
                || !is_same_expression(array, obj)
            {
                return None;
            }
            match (array.tag(), second.is_chain_root()) {
                (ExprTag::Ident, _) => second.text(),
                (_, true) => "…?.length".as_bytes(),
                (_, false) => "….length".as_bytes(),
            }
        }
        _ => return None,
    };
    Some(UnnecessaryArgument {
        first,
        second,
        arg_str: Cow::Borrowed(description),
    })
}

pub(crate) const GLOBAL_OBJECT_NAMES: [&str; 4] = ["global", "globalThis", "self", "window"];

/// `oxc_ecmascript`'s `ValueType`, as far as it is told from literals and operators.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ValueType {
    Undefined,
    Null,
    Number,
    BigInt,
    String,
    Boolean,
    /// An object, or what cannot be told.
    Other,
}

impl ValueType {
    /// What `ToNumeric` makes of it.
    fn to_numeric(self) -> ValueType {
        match self {
            ValueType::BigInt | ValueType::Other => self,
            _ => ValueType::Number,
        }
    }
}

/// `depth`: how many operators have been looked into. Nobody writes constants that are nested deeper.
fn value_type(e: Expr, depth: u32) -> ValueType {
    if depth > 8 {
        return ValueType::Other;
    }
    match e.kind() {
        ExprKind::Number(_) => ValueType::Number,
        ExprKind::BigInt(_) => ValueType::BigInt,
        ExprKind::String(_) | ExprKind::Template(_) => ValueType::String,
        ExprKind::True | ExprKind::False => ValueType::Boolean,
        ExprKind::Null => ValueType::Null,
        ExprKind::Ident(name) if e.symbol().is_none() => match name.bytes() {
            b"undefined" => ValueType::Undefined,
            b"NaN" | b"Infinity" => ValueType::Number,
            _ => ValueType::Other,
        },
        ExprKind::Unary { op, operand } => match op {
            UnOp::Not | UnOp::Delete => ValueType::Boolean,
            UnOp::Typeof => ValueType::String,
            UnOp::Void => ValueType::Undefined,
            UnOp::Plus => ValueType::Number,
            UnOp::Minus | UnOp::BitNot => value_type(operand, depth + 1).to_numeric(),
            _ => ValueType::Other,
        },
        ExprKind::Binary { op, left, right } => match op {
            BinOp::Add => match (value_type(left, depth + 1), value_type(right, depth + 1)) {
                (ValueType::String, _) | (_, ValueType::String) => ValueType::String,
                (left, right) if left.to_numeric() == right.to_numeric() => left.to_numeric(),
                _ => ValueType::Other,
            },
            BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor => {
                let left = value_type(left, depth + 1).to_numeric();
                if left == value_type(right, depth + 1).to_numeric() {
                    left
                } else {
                    ValueType::Other
                }
            }
            BinOp::UShr => ValueType::Number,
            BinOp::And | BinOp::Or | BinOp::Nullish => ValueType::Other,
            BinOp::Comma => value_type(right, depth + 1),
            _ => ValueType::Boolean,
        },
        ExprKind::As { .. }
        | ExprKind::AsConst(_)
        | ExprKind::Satisfies { .. }
        | ExprKind::NonNull(_) => e
            .operand()
            .map_or(ValueType::Other, |it| value_type(it, depth + 1)),
        _ => ValueType::Other,
    }
}

/// `oxc_ecmascript`'s `may_have_side_effects`, where reading a property can have some and reading a global has none.
///
/// Not all of it: what it knows about the globals (`Math.PI`, `Math.abs(1)`, `new Set()`), functions that are called
/// where they are written, the members of classes, `{ ...{ a } }`, `[a][0]` and `1 instanceof Array` is left out. All
/// these "may have side effects" here.
pub(crate) fn may_have_side_effects(e: Expr) -> bool {
    let is_primitive = |e: Expr| value_type(e, 0) != ValueType::Other;
    let mut pending: SmallVec<[Expr; 8]> = smallvec![e];
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Ident(_)
            | ExprKind::Number(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Null
            | ExprKind::Regex(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget
            | ExprKind::Fn(_)
            | ExprKind::Super
            | ExprKind::Missing => {}
            // A symbol cannot become a string.
            ExprKind::Template(template) => {
                if !template.exprs().iter().all(is_primitive) {
                    return true;
                }
                pending.extend(template.exprs());
            }
            ExprKind::Unary { op, operand } => {
                let throws = match op {
                    UnOp::Void | UnOp::Not | UnOp::Typeof => false,
                    UnOp::Plus => {
                        matches!(value_type(operand, 0), ValueType::Other | ValueType::BigInt)
                    }
                    UnOp::Minus | UnOp::BitNot => !is_primitive(operand),
                    _ => true,
                };
                if throws {
                    return true;
                }
                pending.push(operand);
            }
            ExprKind::Binary { op, left, right } => {
                let (left_type, right_type) = (value_type(left, 0), value_type(right, 0));
                let throws = match op {
                    BinOp::In | BinOp::Instanceof => true,
                    BinOp::Add if left_type == ValueType::String => right_type == ValueType::Other,
                    BinOp::Add if right_type == ValueType::String => left_type == ValueType::Other,
                    BinOp::Add
                    | BinOp::Sub
                    | BinOp::Mul
                    | BinOp::Div
                    | BinOp::Rem
                    | BinOp::Pow
                    | BinOp::Shl
                    | BinOp::Shr
                    | BinOp::UShr
                    | BinOp::BitAnd
                    | BinOp::BitOr
                    | BinOp::BitXor => match (left_type.to_numeric(), right_type.to_numeric()) {
                        (ValueType::Number, ValueType::Number) => false,
                        // `1n / 0n`, `1n ** -1n`, `1n >>> 1n`
                        (ValueType::BigInt, ValueType::BigInt) => match op {
                            BinOp::UShr => true,
                            BinOp::Div | BinOp::Rem => {
                                !matches!(right.kind(), ExprKind::BigInt(it) if !it.is("0"))
                            }
                            BinOp::Pow => {
                                right.tag() != ExprTag::BigInt || right.is_parenthesized()
                            }
                            _ => false,
                        },
                        _ => true,
                    },
                    _ => false,
                };
                if throws {
                    return true;
                }
                pending.extend([left, right]);
            }
            ExprKind::Cond { test, yes, no } => pending.extend([test, yes, no]),
            ExprKind::Array(elements) => {
                for element in elements {
                    match element.kind() {
                        ExprKind::Spread(argument) => match argument.tag() {
                            _ if argument.is_parenthesized() => return true,
                            ExprTag::Array | ExprTag::String | ExprTag::Template => {
                                pending.push(argument)
                            }
                            ExprTag::Ident if argument.is_ident("arguments") => {}
                            _ => return true,
                        },
                        _ => pending.push(element),
                    }
                }
            }
            ExprKind::Object(properties) => {
                for property in properties {
                    if let Some(KeyKind::Computed(key)) = property.key().map(Key::kind) {
                        pending.push(key);
                    }
                    match (property.kind(), property.value()) {
                        (PropKind::Spread, Some(argument)) => match argument.tag() {
                            _ if argument.is_parenthesized() => return true,
                            ExprTag::Array | ExprTag::String | ExprTag::Template => {
                                pending.push(argument)
                            }
                            _ => return true,
                        },
                        (PropKind::Init | PropKind::Shorthand, Some(value)) => pending.push(value),
                        _ => {}
                    }
                }
            }
            ExprKind::Class(class) => {
                if class.decorators().next().is_some() || !class.members().is_empty() {
                    return true;
                }
                match class.extends() {
                    Some(it) if it.as_fn().is_some_and(Func::is_arrow) => return true,
                    extends => pending.extend(extends),
                }
            }
            // `[].length`, `"a".length`
            ExprKind::Dot { obj, name, .. } if name.name().is("length") => {
                let is_array = obj.tag() == ExprTag::Array && !obj.is_parenthesized();
                if !is_array && value_type(obj, 0) != ValueType::String {
                    return true;
                }
                pending.push(obj);
            }
            ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => pending.extend(e.operand()),
            _ => return true,
        }
    }
    false
}

/// Where the name of the method is written in `a.method()`. The whole call if the callee is not plainly a member with a
/// name.
pub(crate) fn call_expr_member_expr_property_span(call_expr: Expr) -> Span {
    let property = call_expr
        .callee()
        .and_then(as_member_expression)
        .and_then(static_property_info);
    property.map_or_else(|| call_expr.span(), |it| it.0)
}

/// Whether `expr` is `a.b.c` for one of `paths`, each of which is `["a", "b", "c"]`.
pub(crate) fn does_expr_match_any_path<P: AsRef<[S]>, S: AsRef<str>>(
    expr: Expr,
    paths: &[P],
) -> bool {
    let is_last_of_path = |name: Name| {
        paths
            .iter()
            .any(|it| it.as_ref().last().is_some_and(|it| name.is(it.as_ref())))
    };
    let last = expr
        .member_name()
        .map(Ident::name)
        .or_else(|| expr.as_ident());
    if expr.is_parenthesized() || !last.is_some_and(is_last_of_path) {
        return false;
    }
    let longest = paths.iter().map(|it| it.as_ref().len()).max().unwrap_or(0);
    // From the last name to the first.
    let mut path: SmallVec<[Name; 4]> = SmallVec::new();
    let mut at = expr;
    while let ExprKind::Dot { obj, name, .. } = at.kind() {
        if at.is_chain_root() || at.is_private_member() || path.len() >= longest {
            return false;
        }
        path.push(name.name());
        at = get_inner_expression(obj);
    }
    let Some(first) = at.as_ident() else {
        return false;
    };
    path.push(first);
    let is_path = |expected: &P| {
        let expected = expected.as_ref();
        expected.len() == path.len()
            && expected
                .iter()
                .zip(path.iter().rev())
                .all(|(expected, name)| name.is(expected.as_ref()))
    };
    paths.iter().any(is_path)
}

/// The outermost of the `!` and `Boolean(..)` that `node` is directly in, and whether they negate it.
pub(crate) fn get_boolean_ancestor(node: Expr<'_>) -> (Expr<'_>, bool) {
    let (mut current, mut is_negative) = (node, false);
    while let Node::Expr(parent) = current.parent()
        && !current.is_chain_root()
    {
        if parent.unary_op() == Some(UnOp::Not) {
            is_negative = !is_negative;
        } else if !is_boolean_call(parent) {
            break;
        }
        current = parent;
    }
    (current, is_negative)
}

/// Pads `replacement` with spaces where it would otherwise join the names before and after `span`. The bytes next to `span` are
/// taken for characters, as in oxlint.
pub(crate) fn pad_fix_with_token_boundary(
    source_text: &[u8],
    span: Span,
    replacement: &mut Vec<u8>,
) {
    let (Some(first), Some(last)) = (text::first_code_point(replacement), replacement.last())
    else {
        return;
    };
    let before = (span.start as usize)
        .checked_sub(1)
        .and_then(|it| source_text.get(it));
    let needs_pad_start = before.is_some_and(|it| text::is_identifier_part(u32::from(*it)))
        && text::is_identifier_part(first);
    let after = source_text.get(span.end as usize);
    let needs_pad_end = after.is_some_and(|it| text::is_identifier_start(u32::from(*it)))
        && !last.is_ascii_whitespace();
    if needs_pad_start {
        replacement.insert(0, b' ');
    }
    if needs_pad_end {
        replacement.push(b' ');
    }
}

pub(crate) const BUILT_IN_ERRORS: [&str; 10] = [
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "InternalError",
    "AggregateError",
    "SuppressedError",
];

/// Whether there is a `?.` in the call or in what is called: in `a?.b.c()`, `a.b?.()`, `(a?.b).c()`.
pub(crate) fn call_uses_optional_chain(call_expr: Call) -> bool {
    call_expr.chain() != Chain::No || expression_uses_optional_chain(call_expr.callee())
}

pub(crate) fn expression_uses_optional_chain(expr: Expr) -> bool {
    let mut at = Some(expr);
    while let Some(e) = at {
        // What continues a chain has the `?.` further down.
        if e.is_in_optional_chain() {
            return true;
        }
        at = match e.tag() {
            ExprTag::As
            | ExprTag::AsConst
            | ExprTag::Satisfies
            | ExprTag::NonNull
            | ExprTag::Instantiation => e.operand(),
            ExprTag::Dot | ExprTag::Index => e.object(),
            ExprTag::Call => e.callee(),
            _ => None,
        };
    }
    false
}

/// `format!`, for bytes.
pub(crate) fn concat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

/// The parent is an `AstKind::Decorator`: it is the `e` of `@e`.
pub(crate) fn is_decorator(e: Expr) -> bool {
    !e.is_parenthesized() && is_decorator_expression(e)
}

/// `oxc_syntax::precedence::Precedence::Member`, as a number.
pub(crate) const PRECEDENCE_MEMBER: u8 = 22;

/// `get_precedence` of `utils/unicorn.rs`, with the numbers of `oxc_syntax::precedence::Precedence`. `None`: it never
/// needs parentheses. What is in parentheses and the whole of an optional chain are among these.
pub(crate) fn get_precedence(expr: Expr) -> Option<u8> {
    Some(match plain(expr)?.kind() {
        ExprKind::Binary { left, .. } if left.tag() == ExprTag::PrivateIdentifier => return None,
        ExprKind::Binary { op, .. } => match op {
            BinOp::Comma => 1,
            BinOp::Nullish => 6,
            BinOp::Or => 7,
            BinOp::And => 8,
            BinOp::BitOr => 9,
            BinOp::BitXor => 10,
            BinOp::BitAnd => 11,
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => 12,
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Instanceof | BinOp::In => 13,
            BinOp::Shl | BinOp::Shr | BinOp::UShr => 14,
            BinOp::Add | BinOp::Sub => 15,
            BinOp::Mul | BinOp::Div | BinOp::Rem => 16,
            BinOp::Pow => 17,
        },
        ExprKind::Yield { .. } => 3,
        ExprKind::Assign { .. } => 4,
        ExprKind::Cond { .. } => 5,
        ExprKind::Unary {
            op: UnOp::PostInc | UnOp::PostDec,
            ..
        } => 19,
        ExprKind::Unary { .. } | ExprKind::Await(_) => 18,
        ExprKind::New(_) | ExprKind::Call(_) => 21,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => PRECEDENCE_MEMBER,
        ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => 0,
        ExprKind::Fn(func) if func.is_arrow() => 0,
        _ => return None,
    })
}

/// Of `ast_util.rs`: what is before `start` on its line, if that is nothing but blanks. As `str::lines` has no empty
/// line after the last line break, at the start of a line it is the line before.
pub(crate) fn get_preceding_indent_str(source_text: &[u8], start: u32) -> Option<&[u8]> {
    let preceding_source_text = source_text
        .get(..start as usize)
        .filter(|it| !it.is_empty())?;
    let lines = match preceding_source_text.strip_suffix(b"\n") {
        Some(lines) => lines.strip_suffix(b"\r").unwrap_or(lines),
        None => preceding_source_text,
    };
    // Back to where the line starts, as long as it is blank: the whole file can be one line.
    let mut line_start = lines.len();
    while let Some(c) = text::last_code_point(lines.get(..line_start)?).and_then(char::from_u32)
        && c != '\n'
    {
        if !c.is_whitespace() {
            return None;
        }
        line_start -= c.len_utf8();
    }
    lines.get(line_start..)
}

/// Of `utils/static_value.rs`: the text of what is made of strings, templates and `+`.
pub(crate) fn static_string_value(expression: Expr) -> Option<Vec<u8>> {
    enum Part<'a> {
        Expression(Expr<'a>),
        Text(Name<'a>),
    }
    let mut value = Vec::new();
    let mut pending: SmallVec<[Part; 8]> = smallvec![Part::Expression(expression)];
    while let Some(part) = pending.pop() {
        let expression = match part {
            Part::Expression(expression) => get_inner_expression(expression),
            Part::Text(text) => {
                value.extend_from_slice(text.bytes());
                continue;
            }
        };
        match expression.kind() {
            ExprKind::String(literal) => value.extend_from_slice(literal.bytes()),
            ExprKind::Template(template) => {
                for index in (0..template.quasi_count()).rev() {
                    pending.extend(template.exprs().get(index).map(Part::Expression));
                    pending.push(Part::Text(template.cooked(index)?));
                }
            }
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => pending.extend([Part::Expression(right), Part::Expression(left)]),
            _ => return None,
        }
    }
    Some(value)
}
