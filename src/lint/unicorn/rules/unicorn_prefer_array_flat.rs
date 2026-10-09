use bun_core::strings;
use bun_lint_oxlint::ast_util::{
    as_member_expression, get_inner_expression, get_member_expr, is_method_call, static_property_info,
};
use crate::unicorn::{
    get_first_parameter_name, get_return_identifier_name, is_empty_array_expression, is_prototype_property,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers `Array#flat()` over legacy techniques to flatten arrays.
pub struct PreferArrayFlat;

const PREFER_ARRAY_FLAT: Message = Message::new("", "Prefer Array#flat() over legacy techniques to flatten arrays.");

impl Rule for PreferArrayFlat {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-array-flat", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferArrayFlat
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["flatMap", "reduce", "concat"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call() else {
                return;
            };
            let Some((_, method)) = get_member_expr(call.callee()).and_then(static_property_info) else {
                return;
            };
            match method.bytes() {
                b"flatMap" if is_array_flat_map_case(call) => report_with_fix(e, call, cx),
                b"reduce" if is_array_reduce_case(call) => report_with_fix(e, call, cx),
                b"concat" if is_array_concat_case(call) => {
                    cx.report(e, PREFER_ARRAY_FLAT);
                }
                b"call" | b"apply" => check_array_prototype_concat_case(e, call, method.is("apply"), cx),
                _ => {}
            }
        });
    }
}

/// `array.method(..)` becomes `array.flat()`.
fn report_with_fix<'a>(e: Expr<'a>, call: Call<'a>, cx: &Cx<'a, PreferArrayFlat>) {
    cx.report(e, PREFER_ARRAY_FLAT).fix(|fixer| {
        let (name, _) = as_member_expression(call.callee()).and_then(static_property_info)?;
        Some(fixer.replace(Span::new(name.start, e.span().end), "flat()"))
    });
}

/// The arrow function that `e` is, if it is not `async` and has `count` parameters.
fn as_arrow_function(e: Expr<'_>, count: usize) -> Option<Func<'_>> {
    e.as_fn().filter(|it| it.is_arrow() && !e.is_parenthesized() && !it.is_async() && it.params().len() == count)
}

fn plain_identifier(e: Expr<'_>) -> Option<Name<'_>> {
    e.as_ident().filter(|_| !e.is_parenthesized())
}

/// The `a` of `...a`.
fn spread_argument(e: Expr<'_>) -> Option<Expr<'_>> {
    e.operand().filter(|_| e.tag() == ExprTag::Spread)
}

/// `array.flatMap(x => x)`
fn is_array_flat_map_case(call: Call) -> bool {
    let only_argument = call.args().first().filter(|_| call.args().len() == 1);
    let Some(mapper) = only_argument.and_then(|it| as_arrow_function(it, 1)) else {
        return false;
    };
    let returned = match mapper.body() {
        FnBody::Expr(body) => get_inner_expression(body).as_ident(),
        _ => get_return_identifier_name(mapper),
    };
    returned.is_some()
        && returned == get_first_parameter_name(mapper)
        && !as_member_expression(call.callee())
            .and_then(Expr::object)
            .is_some_and(is_obviously_non_array_flat_map_receiver)
}

fn is_obviously_non_array_flat_map_receiver(object: Expr) -> bool {
    let Some(name) = object.as_ident() else {
        return false;
    };
    is_const_variable_initialized_with_array(object).map_or_else(
        || strings::wtf8_first_codepoint(name.bytes()).and_then(char::from_u32).is_some_and(char::is_uppercase),
        |is_array| !is_array,
    )
}

/// `None`: it is no `const`, or it cannot be told.
fn is_const_variable_initialized_with_array(ident: Expr) -> Option<bool> {
    let declaration = ident.symbol()?.declarations().next().filter(|it| !it.is_catch_parameter())?;
    let Node::VarDecl(declarator) = declaration.node()? else {
        return None;
    };
    let init = get_inner_expression(declarator.init().filter(|_| declarator.var_kind() == VarKind::Const)?);
    match init.kind() {
        ExprKind::Array(_) => Some(true),
        ExprKind::New(new) => plain_identifier(new.callee()).map(|it| it.is("Array")),
        ExprKind::Object(_)
        | ExprKind::String(_)
        | ExprKind::Number(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Template(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_) => Some(false),
        _ => None,
    }
}

/// `array.reduce((a, b) => a.concat(b), [])`, `array.reduce((a, b) => [...a, ...b], [])`
fn is_array_reduce_case(call: Call) -> bool {
    let args = call.args();
    let Some(reducer) = args.first().and_then(|it| as_arrow_function(it, 2)) else {
        return false;
    };
    let (Some(initial_value), Some(second_parameter)) = (args.get(1), reducer.params().get(1)) else {
        return false;
    };
    let (Some(first_parameter), Some(second_parameter), false) =
        (get_first_parameter_name(reducer), second_parameter.pat().as_ident(), second_parameter.is_rest())
    else {
        return false;
    };
    let FnBody::Expr(body) = reducer.body() else {
        return false;
    };
    if args.len() != 2 || !is_empty_array_expression(initial_value) || body.is_parenthesized() || body.is_chain_root() {
        return false;
    }
    let (first, second) = match body.kind() {
        ExprKind::Call(concat) if is_method_call(concat, None, Some(&["concat"]), Some(1), Some(1)) => {
            (get_member_expr(concat.callee()).and_then(Expr::object), concat.args().first())
        }
        ExprKind::Array(elements) if elements.len() == 2 => {
            (elements.first().and_then(spread_argument), elements.get(1).and_then(spread_argument))
        }
        _ => return false,
    };
    first.and_then(plain_identifier) == Some(first_parameter)
        && second.and_then(plain_identifier) == Some(second_parameter)
}

/// `[].concat(...array)`
fn is_array_concat_case(call: Call) -> bool {
    call.args().len() == 1
        && call.args().first().is_some_and(|it| it.tag() == ExprTag::Spread)
        && !call.is_optional()
        && as_member_expression(call.callee())
            .is_some_and(|it| !it.is_optional() && it.object().is_some_and(is_empty_array_expression))
}

/// `[].concat.apply([], array)`, `Array.prototype.concat.apply([], array)`, `[].concat.call([], ...array)`
fn check_array_prototype_concat_case<'a>(e: Expr<'a>, call: Call<'a>, is_apply: bool, cx: &Cx<'a, PreferArrayFlat>) {
    let (Some(this_argument), Some(array)) = (call.args().first(), call.args().get(1)) else {
        return;
    };
    let Some(member) = get_member_expr(call.callee()).filter(|it| !it.is_optional()) else {
        return;
    };
    if call.args().len() != 2
        || call.is_optional()
        || !is_empty_array_expression(this_argument)
        || is_apply == (array.tag() == ExprTag::Spread)
    {
        return;
    }
    let concat = member.object().and_then(as_member_expression);
    if concat.is_some_and(|it| is_prototype_property(it, "concat", "Array")) {
        cx.report(e, PREFER_ARRAY_FLAT).fix_dangerously(|fixer| {
            plain_identifier(array).filter(|it| is_apply && !it.is("arguments"))?;
            Some(fixer.replace(e, [array.text(), b".flat()"].concat()))
        });
    }
}
