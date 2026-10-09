use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::static_string;
use rustc_hash::FxHashMap;

/// Prevents using object or array spreads on accumulators in `Array.prototype.reduce()` and in loops.
pub struct NoAccumulatingSpread;

const REDUCE_SPREAD: Message = Message::new("reduceSpread", "Do not spread accumulators in Array.prototype.reduce()");
const LOOP_SPREAD: Message = Message::new("loopSpread", "Do not spread accumulators in loops");

#[derive(Default)]
pub struct State<'a> {
    /// What is first assigned to, for each variable that was asked about.
    first_assignments: FxHashMap<Symbol<'a>, Option<Expr<'a>>>,
    /// Whether something is in a call of `reduce` or in a loop.
    in_reduce_or_loop: AncestorMemo<'a, ()>,
}

impl Rule for NoAccumulatingSpread {
    const META: Meta = Meta::plugin(Plugin::Oxc, "no-accumulating-spread", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoAccumulatingSpread
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        let loops = [StmtTag::For, StmtTag::ForIn, StmtTag::ForOf, StmtTag::While, StmtTag::DoWhile];
        if !file.mentions_any(&["reduce", "reduceRight"]) && !file.has_stmts(loops) {
            return State::default();
        }
        on.exprs([ExprTag::Spread], |_, spread, cx| {
            if let ExprKind::Spread(argument) = spread.kind()
                && spread.jsx_container_span().is_none()
            {
                check(Node::Expr(spread), argument, cx);
            }
        });
        // Objects are far fewer than properties.
        on.exprs([ExprTag::Object], |_, object, cx| {
            let ExprKind::Object(properties) = object.kind() else {
                return;
            };
            for prop in properties {
                if prop.kind() == PropKind::Spread
                    && let Some(argument) = prop.value()
                {
                    check(Node::Prop(prop), argument, cx);
                }
            }
        });
        State::default()
    }
}

fn check<'a>(spread: Node<'a>, argument: Expr<'a>, cx: &mut Cx<'a, NoAccumulatingSpread>) {
    if argument.tag() != ExprTag::Ident || argument.is_parenthesized() {
        return;
    }
    // Before anything is asked about variables.
    let is_reduce_or_loop = |it: Node<'a>| is_call_of_reduce(it) || matches!(it, Node::Stmt(stmt) if stmt.is_loop());
    if cx.state.in_reduce_or_loop.find(spread, |_, parent| is_reduce_or_loop(parent).then_some(())).is_none() {
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
        ExprKind::Index { index, .. } => static_string(index),
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

fn check_loop_usage<'a>(spread: Node<'a>, pat: Pat<'a>, symbol: Symbol<'a>, cx: &mut Cx<'a, NoAccumulatingSpread>) {
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
    let first_assignment = || symbol.references().find(|it| it.is_write() && !it.is_init()).and_then(Reference::expr);
    let Some(target) = *cx.state.first_assignments.entry(symbol).or_insert_with(first_assignment) else {
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
