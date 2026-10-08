use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow control flow statements in `finally` blocks.
pub struct NoUnsafeFinally;

const UNSAFE_USAGE: Message = Message::new("unsafeUsage", "Unsafe usage of {{nodeType}}.");

#[derive(Default)]
pub struct State<'a> {
    /// The `finally` block that a `return`, a `throw` or a jump to a label leaves first, from a node.
    left: AncestorMemo<'a, Option<Span>>,
    /// The same for a `break` without a label.
    left_by_break: AncestorMemo<'a, Option<Span>>,
    /// The same for a `continue` without a label.
    left_by_continue: AncestorMemo<'a, Option<Span>>,
    /// The jumps to a label in a `finally` block, with the label and the block.
    to_labels: Vec<(Stmt<'a>, Name<'a>, Span)>,
}

/// A step of ESLint's `isInFinallyBlock`, from `at` up to `parent`: the `finally` block that is left, or `None`
/// where the statement has its effect before it leaves one.
fn leaves<'a>(at: Node<'a>, parent: Node<'a>, stops_at_loops: bool, stops_at_switch: bool) -> Option<Option<Span>> {
    match parent {
        Node::File(_) | Node::Class(_) => Some(None),
        Node::Func(func) if func.kind() != FnKind::StaticBlock => Some(None),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Try {
                finalizer: Some(finalizer),
                ..
            } if Node::Stmt(finalizer) == at => Some(Some(finalizer.span())),
            StmtKind::Switch { .. } if stops_at_switch => Some(None),
            _ if stops_at_loops && parent.is_loop() => Some(None),
            _ => None,
        },
        _ => None,
    }
}

fn report<'a>(statement: Stmt<'a>, cx: &mut Cx<'a, NoUnsafeFinally>) {
    let node_type = match statement.tag() {
        StmtTag::Return => "ReturnStatement",
        StmtTag::Throw => "ThrowStatement",
        StmtTag::Break => "BreakStatement",
        _ => "ContinueStatement",
    };
    cx.report(statement, UNSAFE_USAGE).data("nodeType", node_type);
}

impl Rule for NoUnsafeFinally {
    const META: Meta = Meta::eslint("no-unsafe-finally", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeFinally
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if !file.has_stmts([StmtTag::Try]) {
            return State::default();
        }
        on.stmts(
            [StmtTag::Return, StmtTag::Throw, StmtTag::Break, StmtTag::Continue],
            |_, statement, cx| {
                let (label, stops_at_loops, stops_at_switch, left) = match statement.kind() {
                    StmtKind::Break(None) => (None, true, true, &mut cx.state.left_by_break),
                    StmtKind::Continue(None) => (None, true, false, &mut cx.state.left_by_continue),
                    StmtKind::Break(label) | StmtKind::Continue(label) => (label, false, false, &mut cx.state.left),
                    _ => (None, false, false, &mut cx.state.left),
                };
                let finalizer = left.find(Node::Stmt(statement), |at, parent| {
                    leaves(at, parent, stops_at_loops, stops_at_switch)
                });
                match (finalizer.flatten(), label) {
                    (None, _) => {}
                    (Some(_), None) => report(statement, cx),
                    (Some(finalizer), Some(label)) => cx.state.to_labels.push((statement, label, finalizer)),
                }
            },
        );
        // A jump to a label that is in the `finally` block too does not leave it.
        on.finish(|_, cx| {
            let mut jumps = std::mem::take(&mut cx.state.to_labels);
            if jumps.is_empty() {
                return;
            }
            jumps.sort_unstable_by_key(|it| it.0.span().start);
            let labeled = cx.file().stmts_of_kind(StmtTag::Labeled).filter_map(|it| match it.kind() {
                StmtKind::Labeled { label, .. } => Some((it.span(), label)),
                _ => None,
            });
            let mut labeled: Vec<(Span, Name<'a>)> = labeled.collect();
            labeled.sort_unstable_by_key(|it| it.0.start);
            // One pass through the labeled statements and the jumps, in the order of the source: the labeled statements
            // around the place, the outermost first, and where those of them with each label start.
            let mut around: Vec<(Span, Name<'a>)> = Vec::new();
            let mut with_label: FxHashMap<Name<'a>, Vec<u32>> = FxHashMap::default();
            let mut rest = labeled.into_iter().peekable();
            for (jump, name, finalizer) in jumps {
                let at = jump.span().start;
                loop {
                    let next = rest.next_if(|it| it.0.start <= at);
                    let place = next.map_or(at, |it| it.0.start);
                    while let Some(&(_, ended)) = around.last().filter(|it| it.0.end <= place) {
                        around.pop();
                        if let Some(same) = with_label.get_mut(&ended) {
                            same.pop();
                        }
                    }
                    let Some((span, label)) = next else {
                        break;
                    };
                    around.push((span, label));
                    with_label.entry(label).or_default().push(span.start);
                }
                let target = with_label.get(&name).and_then(|it| it.last());
                if target.is_none_or(|&start| start < finalizer.start) {
                    report(jump, cx);
                }
            }
        });
        State::default()
    }
}
