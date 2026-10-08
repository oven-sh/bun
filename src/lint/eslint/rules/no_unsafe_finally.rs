use bun_lint::prelude::*;

/// Disallow control flow statements in `finally` blocks.
pub struct NoUnsafeFinally;

const UNSAFE_USAGE: Message = Message::new("unsafeUsage", "Unsafe usage of {{nodeType}}.");

/// ESLint's `isInFinallyBlock`: `statement` leaves a `finally` block.
fn is_in_finally_block(statement: Stmt) -> bool {
    let (label, stops_at_loops, stops_at_switch) = match statement.kind() {
        StmtKind::Break(label) => (label, label.is_none(), label.is_none()),
        StmtKind::Continue(label) => (label, label.is_none(), false),
        _ => (None, false, false),
    };
    let mut is_label_inside = false;
    let mut at = Node::Stmt(statement);
    for parent in at.ancestors() {
        match parent {
            Node::File(_) | Node::Class(_) => return false,
            Node::Func(func) if func.kind() != FnKind::StaticBlock => return false,
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::Labeled { label: it, .. } if Some(it) == label => is_label_inside = true,
                StmtKind::Try {
                    finalizer: Some(finalizer),
                    ..
                } if Node::Stmt(finalizer) == at => return !is_label_inside,
                StmtKind::Switch { .. } if stops_at_switch => return false,
                _ if stops_at_loops && parent.is_loop() => return false,
                _ => {}
            },
            _ => {}
        }
        at = parent;
    }
    false
}

impl Rule for NoUnsafeFinally {
    const META: Meta = Meta::eslint("no-unsafe-finally", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeFinally
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.has_stmts([StmtTag::Try]) {
            return;
        }
        on.stmts(
            [StmtTag::Return, StmtTag::Throw, StmtTag::Break, StmtTag::Continue],
            |_, statement, cx| {
                if is_in_finally_block(statement) {
                    let node_type = match statement.tag() {
                        StmtTag::Return => "ReturnStatement",
                        StmtTag::Throw => "ThrowStatement",
                        StmtTag::Break => "BreakStatement",
                        _ => "ContinueStatement",
                    };
                    cx.report(statement, UNSAFE_USAGE).data("nodeType", node_type);
                }
            },
        );
    }
}
