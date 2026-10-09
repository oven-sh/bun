use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr};
use bun_lint_oxlint::same_expression::{is_same_expression, is_same_inner_expression};
use bun_lint_oxlint::text::trim;
use crate::unicorn::{PRECEDENCE_MEMBER, get_precedence};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer the `Array#at()` and `String#at()` methods for index access.
pub struct PreferAt {
    check_all_index_access: bool,
    get_last_element_functions: Vec<Box<[u8]>>,
}

const PREFER_AT: Message = Message::new("", "Prefer `.at()` over `{{method}}`.");
const PREFER_AT_OVER_SUBSTRING: Message =
    Message::new("", "Prefer `String#at()` over `String#substring()` when getting one character.");
const USE_AT: Message = Message::new("", "Use `.at()` for index access.");

impl Rule for PreferAt {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-at", Kind::Suggestion).fixable(Fixable::Code).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let functions = options.strings("getLastElementFunctions").into_iter().map(|it| trim(it.as_bytes()));
        PreferAt {
            check_all_index_access: options.bool_or("checkAllIndexAccess", false),
            get_last_element_functions: functions.filter(|it| !it.is_empty()).map(Box::from).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.check_all_index_access || file.mentions_any(&["length", "slice"]) {
            on.exprs([ExprTag::Index], |rule, e, cx| {
                if !is_assignment_target(e) {
                    rule.handle_computed_member(e, cx);
                }
            });
        }
        if file.mentions_any(&["charAt", "substring", "slice", "last"]) {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                if let Some(call_expr) = e.as_call()
                    && let Some(static_member) = as_static_member(call_expr.callee())
                    && !is_assignment_target(e)
                {
                    rule.check_call_expression(e, call_expr, static_member, cx);
                }
            });
        }
    }
}

type Context<'a> = Cx<'a, PreferAt>;

/// `callee.get_member_expr()`, if it is `a.b`.
fn as_static_member(callee: Expr<'_>) -> Option<Expr<'_>> {
    get_member_expr(callee).filter(|it| it.tag() == ExprTag::Dot && !it.is_private_member())
}

fn has_name(static_member: Expr, name: &str) -> bool {
    matches!(static_member.kind(), ExprKind::Dot { name: property, .. } if property.name().is(name))
}

/// `object.at(argument)` in the place of `full_span`, unless `object` is `arguments`.
fn report<'a>(at: Expr<'a>, method: &'a [u8], object: Expr<'a>, full_span: Span, argument: &[u8], cx: &Context<'a>) {
    let report = cx.report(at, PREFER_AT).data("method", method);
    if !get_inner_expression(object).is_ident("arguments") {
        report.fix(|fixer| {
            fixer.replace(full_span, [fixer.file().slice(object.outer_span()), b".at(", argument, b")"].concat())
        });
    }
}

fn number(index: i64) -> Vec<u8> {
    index.to_string().into_bytes()
}

impl PreferAt {
    fn handle_computed_member<'a>(&self, e: Expr<'a>, cx: &Context<'a>) {
        let ExprKind::Index { obj, index, .. } = e.kind() else {
            return;
        };
        if is_number_0(index)
            && let Some(call_expr) =
                Some(get_inner_expression(obj)).filter(|it| !it.is_chain_root()).and_then(Expr::as_call)
            && as_static_member(call_expr.callee()).is_some_and(|it| has_name(it, "slice"))
            && check_slice_index_access(call_expr, e, cx)
        {
            return;
        }
        if let Some((object, negative_value)) = extract_length_minus_pattern(index) {
            if !object.is_parenthesized() && is_same_expression(get_inner_expression(obj), object) {
                report(e, b"[index]", obj, e.span(), &number(negative_value), cx);
            }
            return;
        }
        if !self.check_all_index_access {
            return;
        }
        if let Some(index) = get_positive_index(index)
            && !is_obviously_non_array_receiver(obj)
        {
            report(e, b"[index]", obj, e.span(), &number(index), cx);
            return;
        }
        // `a[b + 1]`
        if let ExprKind::Binary { op: BinOp::Add, left, right } = get_inner_expression(index).kind()
            && let count @ 1.. = [left, right].into_iter().filter_map(get_positive_index).count()
            && !is_obviously_non_array_receiver(obj)
        {
            match count {
                2 => report(e, b"[index]", obj, e.span(), cx.slice(index.outer_span()), cx),
                _ => drop(cx.report(e, PREFER_AT).data("method", "[index]")),
            }
        }
    }

    fn check_call_expression<'a>(&self, e: Expr<'a>, call_expr: Call<'a>, static_member: Expr<'a>, cx: &Context<'a>) {
        let ExprKind::Dot { obj, name, .. } = static_member.kind() else {
            return;
        };
        match name.bytes() {
            b"charAt" => self.check_char_at(e, call_expr, obj, cx),
            b"substring" => check_substring(e, call_expr, name, cx),
            b"pop" | b"shift" => check_slice_pop_shift(e, call_expr, static_member, cx),
            b"last" => self.check_lodash_last(e, call_expr, obj, cx),
            _ => {}
        }
        // `array.slice(-1)[0]`, once more.
        if let Node::Expr(computed) = e.parent()
            && !e.is_parenthesized()
            && !e.is_chain_root()
            && matches!(computed.kind(), ExprKind::Index { index, .. } if is_number_0(index))
        {
            check_slice_index_access(call_expr, computed, cx);
        }
    }

    fn check_char_at<'a>(&self, e: Expr<'a>, call_expr: Call<'a>, object_of_method: Expr<'a>, cx: &Context<'a>) {
        let Some(arg) = call_expr.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
            return;
        };
        if call_expr.is_optional() || call_expr.args().len() != 1 {
            return;
        }
        let index = match extract_length_minus_pattern(arg) {
            Some((object, negative_value))
                if !object.is_parenthesized() && is_same_expression(get_inner_expression(object_of_method), object) =>
            {
                Some(negative_value)
            }
            _ if self.check_all_index_access => get_positive_index(arg),
            _ => return,
        };
        match index {
            Some(index) => report(e, b"charAt()", object_of_method, e.span(), &number(index), cx),
            None => drop(cx.report(e, PREFER_AT).data("method", "charAt()")),
        }
    }

    /// `_.last(array)`
    fn check_lodash_last<'a>(&self, e: Expr<'a>, call_expr: Call<'a>, object_of_method: Expr<'a>, cx: &Context<'a>) {
        let Some(name) = get_inner_expression(object_of_method).as_ident() else {
            return;
        };
        let Some(arg) =
            call_expr.args().first().filter(|it| it.tag() != ExprTag::Spread && call_expr.args().len() == 1)
        else {
            return;
        };
        if !name.is_any(&["_", "lodash", "underscore"])
            && !self.get_last_element_functions.iter().any(|it| **it == *name.bytes())
        {
            return;
        }
        let report = cx.report(e, PREFER_AT).data("method", [name.bytes(), b".last()"].concat());
        if !get_inner_expression(arg).is_ident("arguments") {
            report.fix(|fixer| {
                let arg_text = fixer.file().slice(arg.outer_span());
                let (open, close): (&[u8], &[u8]) = match get_precedence(arg).is_some_and(|it| it < PRECEDENCE_MEMBER) {
                    true => (b"(", b").at(-1)"),
                    false => (b"", b".at(-1)"),
                };
                fixer.replace(e, [open, arg_text, close].concat())
            });
        }
    }
}

/// `string.substring(index, index + 1)`. `property`: the `substring`.
fn check_substring<'a>(e: Expr<'a>, call_expr: Call<'a>, property: Ident<'a>, cx: &Context<'a>) {
    let arguments = call_expr.args();
    let (2, Some(first), Some(second)) = (arguments.len(), arguments.first(), arguments.get(1)) else {
        return;
    };
    if first.tag() == ExprTag::Spread || second.tag() == ExprTag::Spread {
        return;
    }
    let Some(index) = substring_single_character_index(first, second) else {
        return;
    };
    let report = cx.report(e, PREFER_AT_OVER_SUBSTRING);
    let arguments_span = Span::new(first.outer_span().start, second.outer_span().end);
    if cx.file().comments_in(arguments_span).len() > 0 {
        return;
    }
    // `substring` takes a negative index for 0 and gives an empty string for what is out of bounds.
    report.suggest(USE_AT, |fixer| {
        let (start, end) = (property.span().end, arguments_span.start);
        let between = fixer.file().slice(Span::new(start, end));
        fixer.replace(
            Span::new(property.span().start, arguments_span.end),
            [b"at", between, fixer.file().slice(index.outer_span())].concat(),
        )
    });
}

/// The one of the two arguments of `substring` that is the index, if the other is one more.
fn substring_single_character_index<'a>(first: Expr<'a>, second: Expr<'a>) -> Option<Expr<'a>> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if let (Some(start), Some(end)) = (as_number(first), as_number(second))
        && [start, end].iter().all(|it| (0.0..=MAX_SAFE_INTEGER).contains(it) && it.fract() == 0.0)
        && (start - end).abs() == 1.0
    {
        return Some(if start < end { first } else { second });
    }
    let is_one = |it: Expr<'a>| as_number(it).is_some_and(|it| (it - 1.0).abs() < f64::EPSILON);
    let is_plus_one = |expression: Expr<'a>, index: Expr<'a>| {
        matches!(get_inner_expression(expression).kind(), ExprKind::Binary { op: BinOp::Add, left: a, right: b }
            if is_one(b) && is_same_inner_expression(a, index) || is_one(a) && is_same_inner_expression(b, index))
    };
    if is_plus_one(second, first) {
        return Some(first);
    }
    if is_plus_one(first, second) {
        return Some(second);
    }
    matches!(get_inner_expression(first).kind(), ExprKind::Binary { op: BinOp::Sub, left, right }
        if is_one(right) && is_same_inner_expression(left, second))
    .then_some(first)
}

/// `array.slice(-1).pop()`, `array.slice(-2, -1).shift()`
fn check_slice_pop_shift<'a>(e: Expr<'a>, call_expr: Call<'a>, static_member: Expr<'a>, cx: &Context<'a>) {
    if static_member.is_optional() || call_expr.is_optional() || !call_expr.args().is_empty() {
        return;
    }
    let Some(slice_call) =
        static_member.object().map(get_inner_expression).filter(|it| !it.is_chain_root()).and_then(Expr::as_call)
    else {
        return;
    };
    let Some((slice_static, object)) = as_static_member(slice_call.callee()).and_then(|it| Some((it, it.object()?)))
    else {
        return;
    };
    let arguments = slice_call.args();
    if slice_static.is_optional()
        || slice_call.is_optional()
        || !has_name(slice_static, "slice")
        || arguments.iter().any(|it| it.tag() == ExprTag::Spread)
    {
        return;
    }
    let index = match (arguments.len(), arguments.first(), arguments.get(1)) {
        (1, Some(first_arg), _) => get_negative_integer(first_arg, Some(5)).filter(|it| *it == -1),
        (2, Some(first_arg), Some(second_arg)) if !is_number_0(second_arg) => {
            // `pop()` takes the last, which is the first only of one.
            get_negative_integer(first_arg, None).filter(|first_negative| {
                has_name(static_member, "shift") || get_negative_integer(second_arg, None) == Some(first_negative + 1)
            })
        }
        _ => None,
    };
    if let Some(index) = index {
        let full_span = Span::new(object.outer_span().start, e.span().end);
        report(e, b"slice().pop/shift", object, full_span, &number(index), cx);
    }
}

/// `array.slice(-1)[0]`. `computed`: the whole, of which `call_expr` is the `array.slice(-1)`.
fn check_slice_index_access<'a>(call_expr: Call<'a>, computed: Expr<'a>, cx: &Context<'a>) -> bool {
    if computed.is_optional() {
        return false;
    }
    // It is assigned, assigned to or deleted.
    if let Node::Expr(parent) = computed.parent()
        && !computed.is_parenthesized()
        && !computed.is_chain_root()
        && match parent.kind() {
            ExprKind::Assign { .. } => !parent.is_assignment_target(),
            ExprKind::Unary { op, .. } => {
                matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete)
            }
            _ => false,
        }
    {
        return false;
    }
    let Some((static_member, object)) = as_static_member(call_expr.callee()).and_then(|it| Some((it, it.object()?)))
    else {
        return false;
    };
    let arguments = call_expr.args();
    if call_expr.is_optional()
        || !has_name(static_member, "slice")
        || arguments.iter().any(|it| it.tag() == ExprTag::Spread)
    {
        return false;
    }
    let negative_value = match (arguments.len(), arguments.first(), arguments.get(1)) {
        (1, Some(first_arg), _) => get_negative_integer(first_arg, Some(5)),
        // `slice(-1, 0)` is empty.
        (2, Some(first_arg), Some(second_arg)) if !as_number(second_arg).is_some_and(|it| it.abs() < f64::EPSILON) => {
            get_negative_integer(first_arg, None)
        }
        _ => None,
    };
    let Some(value) = negative_value else {
        return false;
    };
    report(
        computed,
        b"slice()[0]",
        object,
        Span::new(object.outer_span().start, computed.span().end),
        &number(value),
        cx,
    );
    true
}

/// By the parent alone.
fn is_assignment_target(e: Expr) -> bool {
    if e.is_parenthesized() || e.is_chain_root() {
        return false;
    }
    let Node::Expr(parent) = e.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::Unary { op, .. } => {
            matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete)
        }
        // `[a[0]] = b`, `[a[0] = 1] = b`
        ExprKind::Array(_) => parent.is_assignment_target(),
        ExprKind::Assign { target, .. } => {
            parent.is_assignment_target() || target == e && target.tag() == ExprTag::Index
        }
        _ => false,
    }
}

fn as_number(expr: Expr) -> Option<f64> {
    match get_inner_expression(expr).kind() {
        ExprKind::Number(value) => Some(value),
        _ => None,
    }
}

fn is_number_0(expr: Expr) -> bool {
    as_number(expr) == Some(0.0)
}

fn get_positive_index(expr: Expr) -> Option<i64> {
    as_number(expr).filter(|it| it.fract() == 0.0 && *it <= i64::MAX as f64).map(|it| it as i64)
}

/// It has no `at`: an object, a function, a class, a number, a boolean, `null`, a regular expression.
fn is_unsupported_at_receiver(expr: Expr) -> bool {
    matches!(
        expr.tag(),
        ExprTag::Object
            | ExprTag::Fn
            | ExprTag::Class
            | ExprTag::Number
            | ExprTag::BigInt
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Null
            | ExprTag::Regex
    )
}

/// Or a constant that is initialized with one.
fn is_obviously_non_array_receiver(expr: Expr) -> bool {
    let inner = get_inner_expression(expr);
    is_unsupported_at_receiver(inner)
        || matches!(inner.symbol().and_then(|it| it.declarations().next()).and_then(Declaration::node),
            Some(Node::VarDecl(declarator)) if declarator.var_kind() == VarKind::Const
                && declarator.init().is_some_and(|init| is_unsupported_at_receiver(get_inner_expression(init))))
}

/// `-1`
fn get_negative_integer(expr: Expr, max_abs_value: Option<i64>) -> Option<i64> {
    let ExprKind::Unary { op: UnOp::Minus, operand } = get_inner_expression(expr).kind() else {
        return None;
    };
    let value = as_number(operand).filter(|it| *it > 0.0 && it.fract() == 0.0 && *it <= i64::MAX as f64)? as i64;
    max_abs_value.is_none_or(|max| value <= max).then_some(-value)
}

/// The `a` and the -1 of `a.length - 1`.
fn extract_length_minus_pattern(expr: Expr<'_>) -> Option<(Expr<'_>, i64)> {
    let ExprKind::Binary { op: BinOp::Sub, left, right } = get_inner_expression(expr).kind() else {
        return None;
    };
    let length_member = get_inner_expression(left);
    let ExprKind::Dot { obj, name, .. } = length_member.kind() else {
        return None;
    };
    let value = as_number(right).filter(|it| *it > 0.0 && *it <= i64::MAX as f64)?;
    (name.name().is("length") && !length_member.is_chain_root()).then_some((obj, -(value as i64)))
}
