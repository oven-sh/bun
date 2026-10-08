use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

/// Disallow loops with a body that allows only one iteration.
pub struct NoUnreachableLoop {
    /// The kinds of loops that are not ignored.
    checked: NodeTags,
}

const INVALID: Message =
    Message::new("invalid", "Invalid loop. Its body allows only one iteration.");

#[derive(Default)]
pub struct Loops<'a> {
    /// The code paths around the current node.
    code_paths: Vec<CodePath<'a>>,
    /// By the id of the segment that the loop goes back to for its next iteration.
    by_target_segment: FxHashMap<u32, Stmt<'a>>,
    to_report: Vec<Stmt<'a>>,
}

/// ESLint's `isLoopingTarget`: the loop in which `node` is the first node of the next iteration.
fn loop_with_target(node: Node<'_>) -> Option<Stmt<'_>> {
    let node = match node {
        Node::Func(func) => func.owner(),
        _ => node,
    };
    let parent = node.parent().as_stmt()?;
    let is_target = match parent.kind() {
        StmtKind::While { test, .. } => node == Node::Expr(test),
        StmtKind::DoWhile { body, .. } => node == Node::Stmt(body),
        StmtKind::For { test, update, body, .. } => match update.or(test) {
            Some(first) => node == Node::Expr(first),
            None => node == Node::Stmt(body),
        },
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
            node == Node::Stmt(left) || matches!(left.kind(), StmtKind::Expr(e) if node == Node::Expr(e))
        }
        _ => false,
    };
    is_target.then_some(parent)
}

impl Rule for NoUnreachableLoop {
    const META: Meta = Meta::eslint("no-unreachable-loop", Kind::Problem);
    type State<'a> = Loops<'a>;

    fn new(options: &Options) -> Self {
        let ignored = options.object(0).strings("ignore");
        let kinds = [
            ("WhileStatement", StmtTag::While),
            ("DoWhileStatement", StmtTag::DoWhile),
            ("ForStatement", StmtTag::For),
            ("ForInStatement", StmtTag::ForIn),
            ("ForOfStatement", StmtTag::ForOf),
        ];
        let checked = kinds.into_iter().filter(|kind| !ignored.contains(&kind.0));
        NoUnreachableLoop {
            checked: checked.fold(NodeTags::EMPTY, |all, kind| all | kind.1.into()),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Loops<'a> {
        if self.checked == NodeTags::EMPTY {
            return Loops::default();
        }
        on.code_path_start(|_, path, _, cx| cx.state.code_paths.push(path));
        on.code_path_end(|_, _, _, cx| {
            cx.state.code_paths.pop();
        });
        on.segment_start(|_, segment, node, cx| {
            if let Some(it) = loop_with_target(node) {
                cx.state.by_target_segment.insert(segment.id(), it);
            }
        });
        on.segment_loop(|_, _, to, node, cx| {
            let Some(&it) = cx.state.by_target_segment.get(&to.id()) else {
                return;
            };
            // Not from the right side of a `for`-`in` or a `for`-`of`.
            let starts_next_iteration = match node {
                Node::Stmt(from) => from == it || from.tag() == StmtTag::Continue,
                _ => false,
            };
            if starts_next_iteration {
                cx.state.to_report.retain(|other| *other != it);
            }
        });
        on.enter(self.checked, |_, node, cx| {
            // The analysis does not tell enough about a loop that cannot be reached.
            if let Node::Stmt(it) = node
                && cx.state.code_paths.last().is_some_and(|path| path.is_current_reachable())
            {
                cx.state.to_report.push(it);
            }
        });
        on.finish(|_, cx| {
            for it in &cx.state.to_report {
                cx.report(it, INVALID);
            }
        });
        Loops::default()
    }
}
