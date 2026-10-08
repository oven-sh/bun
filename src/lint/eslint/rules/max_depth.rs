use bun_lint::prelude::*;

/// Enforce a maximum depth that blocks can be nested.
pub struct MaxDepth {
    max: usize,
}

const TOO_DEEPLY: Message = Message::new(
    "tooDeeply",
    "Blocks are nested too deeply ({{depth}}). Maximum allowed is {{maxDepth}}.",
);

/// What starts counting from zero again.
fn functions() -> NodeTags {
    NodeTags::FILE | NodeTags::FUNC
}

fn blocks() -> NodeTags {
    NodeTags::LOOPS | [StmtTag::If, StmtTag::Switch, StmtTag::Try, StmtTag::Block].into()
}

/// Whether ESLint counts the statement: not a plain block, which only the `with` statement shares
/// its tag with, and not the `if` of an `else if`.
fn counts(node: Node) -> bool {
    let Node::Stmt(stmt) = node else {
        return false;
    };
    match stmt.kind() {
        StmtKind::Block(_) => false,
        StmtKind::If { .. } => !matches!(stmt.parent(), Node::Stmt(parent)
            if matches!(parent.kind(), StmtKind::If { no: Some(no), .. } if no == stmt)),
        _ => true,
    }
}

impl Rule for MaxDepth {
    const META: Meta = Meta::eslint("max-depth", Kind::Suggestion);
    /// The depth in each of the functions around the current node.
    type State<'a> = Vec<usize>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxDepth {
            max: (object.usize("maximum").or(object.usize("max")))
                .or(options.number(0).map(|n| n as usize))
                .unwrap_or(4),
        }
    }

    fn register<'a>(&'a self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<usize> {
        on.enter(functions(), |_, _, cx| cx.state.push(0));
        on.exit(functions(), |_, _, cx| {
            cx.state.pop();
        });
        on.enter(blocks(), |rule, node, cx| {
            if !counts(node) {
                return;
            }
            let Some(depth) = cx.state.last_mut() else {
                return;
            };
            *depth += 1;
            let depth = *depth;
            if depth > rule.max {
                cx.report(node, TOO_DEEPLY).data("depth", depth).data("maxDepth", rule.max);
            }
        });
        on.exit(blocks(), |_, node, cx| {
            if counts(node)
                && let Some(depth) = cx.state.last_mut()
            {
                *depth -= 1;
            }
        });
        Vec::new()
    }
}
