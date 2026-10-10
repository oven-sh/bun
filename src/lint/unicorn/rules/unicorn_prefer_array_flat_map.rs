use crate::unicorn::expression_uses_optional_chain;
use bun_lint_oxlint::ast_util::{
    get_declaration_of_variable, get_inner_expression, get_inner_expression_unless_chain, get_member_expr,
    is_global_reference, is_method_call,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer a single `.flatMap()` over `.map().flat()` or `.filter().flatMap()`.
pub struct PreferArrayFlatMap;

const PREFER_ARRAY_FLAT_MAP: Message =
    Message::new("", "`Array.flatMap` performs `Array.map` and `Array.flat` in one step.");
const PREFER_SINGLE_FLAT_MAP: Message = Message::new("", "Prefer a single `.flatMap(…)` over `.filter(…).flatMap(…)`.");
const REPLACE_FILTER_FLAT_MAP: Message =
    Message::new("", "Replace `.filter(…).flatMap(…)` with a single `.flatMap(…)`.");

const INDEXED_COLLECTIONS: [&str; 13] = [
    "Array",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
];

/// `Children.map(..)`, `React.Children.map(..)`
fn is_ignored_call_expression(call: Call) -> bool {
    let object = get_member_expr(call.callee()).and_then(Expr::object).map(get_inner_expression);
    object.is_some_and(|object| match object.kind() {
        ExprKind::Ident(name) => name.is("Children"),
        ExprKind::Dot { name, .. } => name.name().is("Children") && !object.is_chain_root(),
        _ => false,
    })
}

/// The `a.name` that `e` is. It is not `a?.name`, `a[name]` or `a.#name`.
fn static_member<'a>(e: Expr<'a>, name: &str) -> Option<Expr<'a>> {
    get_inner_expression_unless_chain(e).filter(|it| {
        !it.is_optional() && !it.is_private_member() && it.member_name().is_some_and(|it| it.name().is(name))
    })
}

/// The `b` of `a(b)`. It is not `a?.(b)` or `a<T>(b)`.
fn only_argument(call: Call<'_>) -> Option<Expr<'_>> {
    call.args().first().filter(|_| call.args().len() == 1 && !call.is_optional() && call.type_args().is_empty())
}

/// The `x` and the `e` of `x => e`.
fn simple_callback(argument: Expr<'_>) -> Option<(Name<'_>, Expr<'_>)> {
    let callback = argument.as_fn().filter(|it| it.is_arrow() && !it.is_async())?;
    if callback.return_type().is_some() || !callback.type_params().is_empty() || callback.params().len() != 1 {
        return None;
    }
    let parameter = callback.params().first()?;
    if parameter.is_rest() || parameter.is_optional() || parameter.ty().is_some() || parameter.default().is_some() {
        return None;
    }
    match callback.body() {
        FnBody::Expr(body) => Some((parameter.pat().as_ident()?, body)),
        _ => None,
    }
}

/// The global `Array`, `Int8Array` ..
fn is_indexed_collection(callee: Expr) -> bool {
    callee.as_ident().is_some_and(|it| it.is_any(&INDEXED_COLLECTIONS)) && is_global_reference(callee)
}

/// It is, or is a constant that is declared with, what is neither an array nor a typed array.
fn is_known_non_indexed_receiver(receiver: Expr) -> bool {
    let receiver = get_inner_expression(receiver);
    let initializer = match get_declaration_of_variable(receiver) {
        Some(Declaration::Var(pat)) => match pat.parent() {
            Node::VarDecl(declarator) if declarator.var_kind() == VarKind::Const => declarator.init(),
            _ => None,
        },
        _ => None,
    };
    let value = initializer.map_or(receiver, get_inner_expression);
    match value.tag() {
        ExprTag::Object | ExprTag::Fn | ExprTag::Class | ExprTag::Template => true,
        ExprTag::New => !value.callee().map(get_inner_expression).is_some_and(is_indexed_collection),
        tag => matches!(
            tag,
            ExprTag::True
                | ExprTag::False
                | ExprTag::Null
                | ExprTag::Number
                | ExprTag::BigInt
                | ExprTag::Regex
                | ExprTag::String
        ),
    }
}

/// `a.filter(x => b).flatMap(x => [c, d])`
fn check_filter_flat_map<'a>(e: Expr<'a>, call: Call<'a>, cx: &Cx<'a, PreferArrayFlatMap>) {
    let Some((member, map_callback)) = static_member(call.callee(), "flatMap").zip(only_argument(call)) else {
        return;
    };
    let filter = member.object().and_then(get_inner_expression_unless_chain).and_then(Expr::as_call);
    let Some((filter, filter_callback)) = filter.and_then(|it| Some((it, only_argument(it)?))) else {
        return;
    };
    let (Some(flat_map), Some(receiver)) =
        (member.member_name(), static_member(filter.callee(), "filter").and_then(Expr::object))
    else {
        return;
    };
    if expression_uses_optional_chain(receiver) || cx.file().comments_in(e).next().is_some() {
        return;
    }
    let (Some((filter_name, predicate)), Some((map_name, mapped))) =
        (simple_callback(filter_callback), simple_callback(map_callback))
    else {
        return;
    };
    if filter_name != map_name
        || !matches!(mapped.kind(), ExprKind::Array(elements) if elements.len() > 1)
        || is_known_non_indexed_receiver(receiver)
    {
        return;
    }
    cx.report(flat_map, PREFER_SINGLE_FLAT_MAP).suggest(REPLACE_FILTER_FLAT_MAP, |fixer| {
        let file = fixer.file();
        // What cannot be the test of `a ? b : c` as it is.
        let needs_parentheses = !predicate.is_parenthesized()
            && (predicate.binary_op() == Some(BinOp::Comma)
                || matches!(
                    predicate.tag(),
                    ExprTag::Fn
                        | ExprTag::Assign
                        | ExprTag::Class
                        | ExprTag::Cond
                        | ExprTag::Object
                        | ExprTag::As
                        | ExprTag::AsConst
                        | ExprTag::NonNull
                        | ExprTag::Satisfies
                        | ExprTag::Yield
                ));
        let (open, close): (&[u8], &[u8]) = if needs_parentheses { (b"(", b")") } else { (b"", b"") };
        let text = [
            file.slice(receiver.outer_span()),
            b".flatMap(",
            filter_name.bytes(),
            b" => ",
            open,
            file.slice(predicate.outer_span()),
            close,
            b" ? ",
            file.slice(mapped.span()),
            b" : [])",
        ];
        fixer.replace(e, text.concat())
    });
}

impl Rule for PreferArrayFlatMap {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-array-flat-map", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferArrayFlatMap
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let has_map_and_flat = file.mentions("flat") && file.mentions("map");
        if !has_map_and_flat && !(file.mentions("filter") && file.mentions("flatMap")) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(flat_call) = e.as_call().filter(|it| it.args().len() <= 1 && !it.is_optional()) else {
            return;
        };
        check_filter_flat_map(e, flat_call, cx);
        let callee = flat_call.callee();
        if !is_method_call(flat_call, None, Some(&["flat"]), None, None)
            || callee.is_parenthesized()
            || callee.is_optional()
        {
            return;
        }
        let Some(object) = callee.object().filter(|it| !it.is_chain_root()) else {
            return;
        };
        let Some(map_call) = object.as_call().filter(|it| !it.is_optional()) else {
            return;
        };
        if !is_method_call(map_call, None, Some(&["map"]), None, None) || is_ignored_call_expression(map_call) {
            return;
        }
        // `.flat(1.5)` is `.flat(1)`.
        let is_one =
            |it: Expr| !it.is_parenthesized() && matches!(it.kind(), ExprKind::Number(depth) if depth.floor() == 1.0);
        if !flat_call.args().first().is_none_or(is_one) {
            return;
        }
        cx.report(e, PREFER_ARRAY_FLAT_MAP).fix(|fixer| {
            let end_of_map = map_call.callee().outer_span().end;
            [
                fixer.remove(Span::after(object.outer_span(), e.span().end)),
                fixer.replace(Span::new(end_of_map.saturating_sub(3), end_of_map), "flatMap"),
            ]
        });
    }
}
