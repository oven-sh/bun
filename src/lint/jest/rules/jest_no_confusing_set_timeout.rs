use crate::jest::{self, OxlintOrder, Scopes, parent_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow confusing usages of `jest.setTimeout`.
pub struct NoConfusingSetTimeout;

const NON_GLOBAL_SET_TIMEOUT: Message = Message::new("", "`jest.setTimeout` should only be called in a global scope");
const NO_MULTIPLE_SET_TIMEOUTS: Message = Message::new("", "Do not call `jest.setTimeout` multiple times");
const NO_UNORDER_SET_TIMEOUT: Message = Message::new("", "`jest.setTimeout` should be placed before any other jest methods.");

impl Rule for NoConfusingSetTimeout {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-confusing-set-timeout", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConfusingSetTimeout
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions("setTimeout") {
            on.finish(|_, cx| run_once(cx));
        }
    }
}

/// `jest`, and `Jest` for `import { jest as Jest } from "@jest/globals"`.
fn is_jest_call(reference: Expr) -> bool {
    reference.as_ident().is_some_and(|name| name.bytes().eq_ignore_ascii_case(b"jest"))
}

fn run_once<'a>(cx: &Cx<'a, NoConfusingSetTimeout>) {
    let file = cx.file();
    // The `jest.setTimeout`s, those of a global `jest` first.
    let is_set_timeout = |it: &Expr| match it.kind() {
        ExprKind::Dot { obj, name, .. } => {
            name.bytes() == b"setTimeout" && is_jest_call(obj) && !obj.is_parenthesized() && !it.is_jsx_tag_name()
        }
        _ => false,
    };
    let mut jest_reference_list: Vec<(bool, Expr<'a>)> = (file.exprs_of_kind(ExprTag::Dot))
        .filter(is_set_timeout)
        .map(|it| (it.object().is_some_and(|it| it.symbol().is_some()), it))
        .collect();
    if jest_reference_list.is_empty() {
        return;
    }
    // In the order in which oxlint comes to them: by the name or the declaration, and then by the place.
    if jest_reference_list.len() > 1 {
        let order = OxlintOrder::new(file);
        utils::sort::sort_by_cached_key(&mut jest_reference_list, |it| {
            let group = it.1.object().and_then(|jest| match jest.symbol() {
                Some(symbol) => symbol.declarations().next()?.name_span().map(|it| it.start),
                None => jest.as_ident().map(|name| order.rank(name)),
            });
            (it.0, group, it.1.span().start)
        });
    }
    // Where the first identifier is that is called as, or passed to, a function of Jest.
    let mut tops = AncestorMemo::default();
    let first_jest_fn_call = (file.exprs_of_kind(ExprTag::Ident))
        .filter(|it| !is_jest_call(*it) && is_jest_fn_call(*it, file, &mut tops))
        .map(|it| it.span().start)
        .min();
    let mut scopes = Scopes::default();
    for (i, (_, expr)) in jest_reference_list.iter().enumerate() {
        if first_jest_fn_call.is_some_and(|first| first < expr.span().start) {
            cx.report(*expr, NO_UNORDER_SET_TIMEOUT);
        }
        if scopes.of(Node::Expr(*expr)).is_some() {
            cx.report(*expr, NON_GLOBAL_SET_TIMEOUT);
        }
        if i > 0 {
            cx.report(*expr, NO_MULTIPLE_SET_TIMEOUTS);
        }
    }
}

/// `tops`: the whole chain of calls, members and tagged templates that something is a link of.
fn is_jest_fn_call<'a>(reference: Expr<'a>, file: &'a File<'a>, tops: &mut AncestorMemo<'a, Expr<'a>>) -> bool {
    let Some(parent_node) = parent_expression(reference).filter(|it| it.tag() == ExprTag::Call) else {
        return false;
    };
    let top = tops.find(Node::Expr(parent_node), |child, parent| {
        let child = child.as_expr()?;
        let is_link = !child.is_parenthesized()
            && !child.is_chain_root()
            && parent.as_expr().is_some_and(|it| {
                matches!(it.tag(), ExprTag::Call | ExprTag::TaggedTemplate | ExprTag::Dot | ExprTag::Index) && !it.is_jsx_tag_name()
            });
        (!is_link).then_some(child)
    });
    (top.and_then(|it| jest::possible_jest_node_of(file, it)))
        .is_some_and(|possible_jest_node| jest::parse_jest_fn_call_in(file, parent_node, possible_jest_node).is_some())
}
