use crate::oxlint::promise::is_promise;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use smallvec::SmallVec;

/// Disallow nested `then()` or `catch()` statements.
pub struct NoNesting;

const NO_NESTING: Message = Message::new("", "Avoid nesting promises.");

#[derive(Default)]
pub struct State<'a> {
    /// Whether something is in a function that is an argument of `then` or `catch`.
    callbacks: AncestorMemo<'a, ()>,
    /// The closest call of `then` or `catch` that something is in.
    calls: AncestorMemo<'a, Expr<'a>>,
    /// All of the file, in the order of the source. Listed when they are first looked at.
    references: Option<Vec<Reference<'a>>>,
}

impl Rule for NoNesting {
    const META: Meta = Meta::oxlint(Plugin::Promise, "no-nesting", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoNesting
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions_any(&["then", "catch"]).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = as_then_or_catch(e) else {
            return;
        };
        let node = Node::Expr(e);
        let is_inside_promise = |_, ancestor: Node<'a>| ancestor.as_expr().filter(|it| is_inside_promise(*it)).map(|_| ());
        if cx.state.callbacks.find(node, is_inside_promise).is_none() {
            return;
        }
        let closest = |_, ancestor: Node<'a>| ancestor.as_expr().filter(|it| as_then_or_catch(*it).is_some());
        let closest = cx.state.calls.find(node, closest).and_then(Expr::as_call);
        if closest.is_none_or(|closest| can_safely_unnest(call_expr, closest, &mut cx.state.references)) {
            cx.report(call_expr.callee().outer_span(), NO_NESTING);
        }
    }
}

fn as_then_or_catch(e: Expr<'_>) -> Option<Call<'_>> {
    e.as_call().filter(|it| is_promise(*it).is_some_and(|prop_name| prop_name.is_any(&["then", "catch"])))
}

/// It is a function that is an argument of `then` or `catch`.
fn is_inside_promise(e: Expr) -> bool {
    e.tag() == ExprTag::Fn
        && !e.is_parenthesized()
        && e.parent().as_expr().and_then(as_then_or_catch).is_some_and(|call_expr| call_expr.callee() != e)
}

/// Whether the first argument of `cb_call_expr` refers to nothing that a callback of `closest` declares.
fn can_safely_unnest<'a>(cb_call_expr: Call<'a>, closest: Call<'a>, references: &mut Option<Vec<Reference<'a>>>) -> bool {
    let Some(cb_span) = cb_call_expr.args().first().map(Expr::outer_span) else {
        return true;
    };
    let callbacks = closest.args().iter().filter(|it| !it.is_parenthesized()).filter_map(Expr::as_fn);
    let callbacks: SmallVec<[(Option<Scope<'a>>, Option<Symbol<'a>>); 2]> = callbacks.map(|it| (it.scope(), it.symbol())).collect();
    if callbacks.is_empty() {
        return true;
    }
    // The references are in the order of the source.
    let references = references.get_or_insert_with(|| closest.callee().file().references().collect());
    let first = references.partition_point(|it| it.span().start < cb_span.start);
    let end = references.partition_point(|it| it.span().start < cb_span.end);
    let in_argument = references.get(first..end).unwrap_or_default();
    let is_usage = |usage: Reference<'a>| cb_span.contains(usage.span()) && !matches!(usage.node(), Node::Pat(_));
    // For oxlint the name of a function expression is declared in the function.
    let declared = || {
        let symbols = callbacks.iter().flat_map(|it| it.0.into_iter().flat_map(Scope::symbols).chain(it.1));
        symbols.filter(|it| !it.is_implicit_arguments())
    };
    // Either the references in the argument are looked at or those to what the callbacks declare, whichever are fewer. The arguments of
    // calls that are in each other have the same references, and the calls in one callback are asked about the same variables.
    let mut fewer_than = in_argument.len();
    let is_less_declared = declared().all(|symbol| {
        let count = symbol.references().len() + 1;
        let is_less = count <= fewer_than;
        fewer_than = fewer_than.saturating_sub(count);
        is_less
    });
    if is_less_declared {
        return !declared().any(|symbol| symbol.references().any(is_usage));
    }
    !in_argument.iter().any(|usage| {
        let is_declared = |symbol: Symbol<'a>| {
            !symbol.is_implicit_arguments() && callbacks.iter().any(|it| it.0 == Some(symbol.scope()) || it.1 == Some(symbol))
        };
        is_usage(*usage) && usage.symbol().is_some_and(is_declared)
    })
}
