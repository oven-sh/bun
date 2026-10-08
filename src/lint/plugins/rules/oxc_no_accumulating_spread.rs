use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents using object or array spreads on accumulators in `Array.prototype.reduce()` and in loops.
pub struct NoAccumulatingSpread;

const REDUCE_SPREAD: Message = Message::new("reduceSpread", "Do not spread accumulators in Array.prototype.reduce()");
const LOOP_SPREAD: Message = Message::new("loopSpread", "Do not spread accumulators in loops");

impl Rule for NoAccumulatingSpread {
    const META: Meta = Meta::plugin(Plugin::Oxc, "no-accumulating-spread", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAccumulatingSpread
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Spread], |_, spread, cx| {
            if let ExprKind::Spread(argument) = spread.kind()
                && spread.jsx_container_span().is_none()
            {
                check(Node::Expr(spread), argument, cx);
            }
        });
        on.props(|_, prop, cx| {
            if prop.kind() == PropKind::Spread
                && !prop.is_jsx_attribute()
                && let Some(argument) = prop.value()
            {
                check(Node::Prop(prop), argument, cx);
            }
        });
    }
}

fn check<'a>(spread: Node<'a>, argument: Expr<'a>, cx: &Cx<'a, NoAccumulatingSpread>) {
    if argument.tag() != ExprTag::Ident || argument.is_parenthesized() {
        return;
    }
    let Some(symbol) = argument.symbol() else {
        return;
    };
    match symbol.declarations().next() {
        Some(Declaration::Param(pat)) => check_reduce_usage(spread, pat, cx),
        Some(Declaration::Var(pat)) => check_loop_usage(spread, pat, symbol, cx),
        _ => {}
    }
}

fn is_function(func: Func) -> bool {
    func.kind() != FnKind::StaticBlock
}

/// `a.reduce(..)`, `a["reduceRight"](..)`, with one or two arguments.
fn is_call_of_reduce(node: Node) -> bool {
    let Node::Expr(e) = node else {
        return false;
    };
    let ExprKind::Call(call) = e.kind() else {
        return false;
    };
    if !matches!(call.args().len(), 1 | 2) {
        return false;
    }
    let name = match call.callee().skip_type_wrappers().kind() {
        ExprKind::Dot { name, .. } => Some(name.name()),
        ExprKind::Index { index, .. } => match index.kind() {
            ExprKind::String(value) => Some(value),
            ExprKind::Template(template) => template.as_static(),
            _ => None,
        },
        _ => None,
    };
    name.is_some_and(|name| name.is_any(&["reduce", "reduceRight"]))
}

fn check_reduce_usage<'a>(spread: Node<'a>, pat: Pat<'a>, cx: &Cx<'a, NoAccumulatingSpread>) {
    let Some(callback) = Node::Pat(pat).enclosing_function() else {
        return;
    };
    let params = callback.params();
    if params.len() != 2 || params.first().is_none_or(|first| first.pat() != pat) {
        return;
    }
    let is_in_inner_function = spread
        .ancestors()
        .take_while(|it| *it != Node::Func(callback))
        .any(|it| matches!(it, Node::Func(func) if is_function(func)));
    if !is_in_inner_function && Node::Func(callback).ancestors().any(is_call_of_reduce) {
        cx.report(spread, REDUCE_SPREAD);
    }
}

fn check_loop_usage<'a>(spread: Node<'a>, pat: Pat<'a>, symbol: Symbol<'a>, cx: &Cx<'a, NoAccumulatingSpread>) {
    let Node::VarDecl(declarator) = pat.parent() else {
        return;
    };
    let Node::Stmt(declaration) = declarator.parent() else {
        return;
    };
    if declarator.var_kind() != VarKind::Let {
        return;
    }
    // Only the first assignment counts.
    let Some(target) = symbol.references().find(|it| it.is_write() && !it.is_init()).and_then(Reference::expr) else {
        return;
    };
    let Node::Expr(assignment) = target.parent() else {
        return;
    };
    let ExprKind::Assign { target: left, value, .. } = assignment.kind() else {
        return;
    };
    let value = value.skip_type_wrappers();
    if left != target
        || target.is_parenthesized()
        || !matches!(value.tag(), ExprTag::Array | ExprTag::Object)
        || !value.span().contains(spread.span())
    {
        return;
    }
    let declaration = declaration.span_without_export();
    let in_loop = spread.ancestors().find_map(|it| match it {
        Node::Stmt(stmt) if stmt.is_loop() && !stmt.span().contains(declaration) => Some(stmt),
        _ => None,
    });
    if let Some(stmt) = in_loop {
        let keyword = match stmt.tag() {
            StmtTag::While => 5,
            StmtTag::DoWhile => 2,
            _ => 3,
        };
        let start = stmt.span().start;
        // The labels of oxlint: the accumulator, the spread, and the loop, which is the primary one.
        cx.report(pat, LOOP_SPREAD).comments_apply_at(Span::new(start, start + keyword));
    }
}
