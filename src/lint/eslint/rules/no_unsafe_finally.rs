use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow control flow statements in `finally` blocks.
pub struct NoUnsafeFinally;

const UNSAFE_USAGE: Message = Message::new("unsafeUsage", "Unsafe usage of {{nodeType}}.");

#[derive(Default)]
pub struct State<'a> {
    /// For a node: the first `finally` block that a `return`, a `throw` or a labeled jump at that node exits.
    exited: AncestorMemo<'a, Option<Span>>,
    /// The same for a `break` without a label.
    exited_by_break: AncestorMemo<'a, Option<Span>>,
    /// The same for a `continue` without a label.
    exited_by_continue: AncestorMemo<'a, Option<Span>>,
    /// The labeled jumps in a `finally` block, each with its label and the block.
    to_labels: Vec<(Stmt<'a>, Name<'a>, Span)>,
}

/// One step of ESLint's `isInFinallyBlock`, from `at` up to `parent`. Returns the `finally` block being exited, or
/// `Some(None)` where the jump ends before it exits one.
fn exited_finalizer<'a>(at: Node<'a>, parent: Node<'a>, stops_at_loops: bool, stops_at_switch: bool) -> Option<Option<Span>> {
    match parent {
        Node::File(_) | Node::Class(_) => Some(None),
        Node::Func(func) if func.kind() != FnKind::StaticBlock => Some(None),
        Node::Stmt(parent) => match parent.tag() {
            StmtTag::Try => match parent.as_try() {
                Some((.., Some(finalizer))) if Node::Stmt(finalizer) == at => Some(Some(finalizer.span())),
                _ => None,
            },
            StmtTag::Switch if stops_at_switch => Some(None),
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
    cx.report(statement, UNSAFE_USAGE)
        .data("nodeType", node_type)
        .hint("It replaces whatever try and catch return or throw.");
}

impl Rule for NoUnsafeFinally {
    const META: Meta = Meta::eslint("no-unsafe-finally", Kind::Problem).recommended().hints();
    const ON: On =
        On::new().stmts(&[StmtTag::Return, StmtTag::Throw, StmtTag::Break, StmtTag::Continue]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeFinally
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let has_finalizer = |it: Stmt| matches!(it.as_try(), Some((.., Some(_))));
        file.stmts_of_kind(StmtTag::Try).any(has_finalizer).then(State::default)
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let (label, stops_at_loops, stops_at_switch, exited) = match statement.kind() {
            StmtKind::Break(None) => (None, true, true, &mut cx.state.exited_by_break),
            // For oxlint a `continue` stops at the nearest loop, whatever its label is.
            StmtKind::Continue(label) if is_oxlint => (label, true, false, &mut cx.state.exited_by_continue),
            StmtKind::Continue(None) => (None, true, false, &mut cx.state.exited_by_continue),
            StmtKind::Break(label) | StmtKind::Continue(label) => (label, false, false, &mut cx.state.exited),
            _ => (None, false, false, &mut cx.state.exited),
        };
        let finalizer = exited.find(Node::Stmt(statement), |at, parent| {
            exited_finalizer(at, parent, stops_at_loops, stops_at_switch)
        });
        match (finalizer.flatten(), label) {
            (None, _) => {}
            (Some(_), None) => report(statement, cx),
            (Some(finalizer), Some(label)) => cx.state.to_labels.push((statement, label, finalizer)),
        }
    }

    // A jump to a label inside the same `finally` block doesn't exit the block.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut jumps = std::mem::take(&mut cx.state.to_labels);
        if jumps.is_empty() {
            return;
        }
        utils::sort::sort_unstable_by_key(&mut jumps, |it| it.0.span().start);
        let labeled = cx.file().stmts_of_kind(StmtTag::Labeled).filter_map(|it| Some((it.span(), it.as_labeled()?.0)));
        let mut labeled: Vec<(Span, Name<'a>)> = labeled.collect();
        utils::sort::sort_unstable_by_key(&mut labeled, |it| it.0.start);
        // One pass over the labeled statements and the jumps, in source order. `enclosing` has the labeled statements
        // enclosing the current position, outermost first. `with_label` has their start offsets, by label.
        let mut enclosing: Vec<(Span, Name<'a>)> = Vec::new();
        let mut with_label: FxHashMap<Name<'a>, Vec<u32>> = FxHashMap::default();
        let mut rest = labeled.into_iter().peekable();
        for (jump, name, finalizer) in jumps {
            let at = jump.span().start;
            loop {
                let next = rest.next_if(|it| it.0.start <= at);
                let position = next.map_or(at, |it| it.0.start);
                while let Some(&(_, ended)) = enclosing.last().filter(|it| it.0.end <= position) {
                    enclosing.pop();
                    if let Some(same) = with_label.get_mut(&ended) {
                        same.pop();
                    }
                }
                let Some((span, label)) = next else {
                    break;
                };
                enclosing.push((span, label));
                with_label.entry(label).or_default().push(span.start);
            }
            let target = with_label.get(&name).and_then(|it| it.last());
            if target.is_none_or(|&start| start < finalizer.start) {
                report(jump, cx);
            }
        }
    }
}
