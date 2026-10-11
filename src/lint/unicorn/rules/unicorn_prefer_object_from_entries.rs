use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, is_method_call};
use crate::unicorn::{call_expr_member_expr_property_span, does_expr_match_any_path};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Encourages using `Object.fromEntries` when converting an array of key-value pairs into an object.
pub struct PreferObjectFromEntries {
    /// `a.b` is `["a", "b"]`.
    functions: Vec<Vec<String>>,
}

const PREFER_OBJECT_FROM_ENTRIES: Message =
    Message::new("", "Prefer `Object.fromEntries` over manual object construction from entries.");

/// `{}`, `Object.create(null)`
fn is_empty_object(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Object(properties) => properties.is_empty(),
        ExprKind::Call(call) => {
            !e.is_chain_root()
                && is_method_call(call, Some(&["Object"]), Some(&["create"]), Some(1), Some(1))
                && call.args().first().is_some_and(|it| get_inner_expression(it).tag() == ExprTag::Null)
        }
        _ => false,
    }
}

/// `key: value`, `key`
fn is_plain_property(property: Prop) -> bool {
    matches!(property.kind(), PropKind::Init | PropKind::Shorthand)
}

impl Rule for PreferObjectFromEntries {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-object-from-entries", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// `reduce`, and the last names of the functions: those that the file mentions.
    type State<'a> = (Option<Name<'a>>, SmallVec<[Name<'a>; 2]>);

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let functions = match options.has("functions") {
            true => options.strings("functions"),
            false => vec!["_.fromPairs", "lodash.fromPairs"],
        };
        let part = |it: &[u8]| std::str::from_utf8(it).unwrap_or_default().to_owned();
        let split = |function: &str| strings::split(function.as_bytes(), b".").map(part).collect();
        PreferObjectFromEntries { functions: functions.into_iter().map(split).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let reduce = file.mentions("reduce").then(|| file.name_of("reduce"));
        let last_names = self.functions.iter().filter_map(|it| it.last()).filter(|it| file.mentions(it));
        let last_names: SmallVec<_> = last_names.map(|it| file.name_of(it)).collect();
        (reduce.is_some() || !last_names.is_empty()).then_some((reduce, last_names))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| matches!(it.args().len(), 1 | 2) && !it.is_optional()) else {
            return;
        };
        let (callee, args) = (call.callee(), call.args());
        let (Some(first), second) = (args.first(), args.get(1)) else {
            return;
        };
        let Some(second) = second else {
            let name = callee.member_name().map(Ident::name).or_else(|| callee.as_ident());
            if name.is_some_and(|it| cx.state.1.contains(&it))
                && first.tag() != ExprTag::Spread
                && !as_member_expression(callee).is_some_and(Expr::is_optional)
                && does_expr_match_any_path(callee, &self.functions)
            {
                cx.report(callee, PREFER_OBJECT_FROM_ENTRIES);
            }
            return;
        };
        if callee.member_name().is_some_and(|it| Some(it.name()) != cx.state.0)
            || !as_member_expression(callee).is_some_and(|it| !it.is_optional())
            || !is_method_call(call, None, Some(&["reduce"]), Some(2), Some(2))
            || !is_empty_object(get_inner_expression(second))
        {
            return;
        }
        let Some(reducer) = get_inner_expression(first).as_fn().filter(|it| it.is_arrow() && !it.is_async()) else {
            return;
        };
        let FnBody::Expr(body) = reducer.body() else {
            return;
        };
        let first_parameter = reducer.params().first().filter(|it| !it.is_rest() && it.pat().tag() == PatTag::Ident);
        let Some(accumulator) = first_parameter.and_then(|it| it.pat().symbol()) else {
            return;
        };
        let is_accumulator = |it: Expr<'a>| get_inner_expression(it).symbol() == Some(accumulator);
        let body = get_inner_expression(body);
        let span = match body.kind() {
            // `() => Object.assign(object, {key})`
            ExprKind::Call(assign) if !body.is_chain_root() => {
                let source = assign.args().get(1).map(get_inner_expression);
                let is_one_property = matches!(source.map(Expr::kind), Some(ExprKind::Object(properties))
                    if properties.len() == 1 && properties.first().is_some_and(is_plain_property));
                if !is_one_property
                    || !is_method_call(assign, Some(&["Object"]), Some(&["assign"]), Some(2), Some(2))
                    || !assign.args().first().is_some_and(is_accumulator)
                {
                    return;
                }
                call_expr_member_expr_property_span(body)
            }
            // `() => ({...object, key})`
            ExprKind::Object(properties) if properties.len() == 2 => {
                let is_spread = |it: Prop<'a>| it.kind() == PropKind::Spread && it.value().is_some_and(is_accumulator);
                if !properties.first().is_some_and(is_spread)
                    || !properties.get(1).is_some_and(is_plain_property)
                {
                    return;
                }
                call_expr_member_expr_property_span(e)
            }
            _ => return,
        };
        // Not what the default value of the parameter is written to.
        if accumulator.references().filter(|it| !matches!(it.node(), Node::Pat(_))).take(2).count() == 1 {
            cx.report(span, PREFER_OBJECT_FROM_ENTRIES);
        }
    }
}
