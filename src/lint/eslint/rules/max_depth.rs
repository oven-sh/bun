use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

/// Enforce a maximum depth that blocks can be nested.
pub struct MaxDepth {
    /// `None`: `{ "maximum": 0 }` without `max`, with which upstream compares to `undefined`.
    max: Option<usize>,
}

const TOO_DEEPLY: Message = Message::new(
    "tooDeeply",
    "Blocks are nested too deeply ({{depth}}). Maximum allowed is {{maxDepth}}.",
);

/// The keyword that `stmt` starts with, if it is a statement that counts: not the `if` of an
/// `else if`.
fn keyword_of(stmt: Stmt) -> Option<&'static str> {
    Some(match stmt.kind() {
        StmtKind::If { .. } => {
            // For oxlint neither that of `if (a) if (b) ..`.
            let is_oxlint = stmt.file().language().is_oxlint;
            let is_else_if = matches!(stmt.parent(), Node::Stmt(parent)
                if matches!(parent.kind(), StmtKind::If { no, .. } if no == Some(stmt) || is_oxlint));
            if is_else_if {
                return None;
            }
            "if"
        }
        StmtKind::Switch { .. } => "switch",
        StmtKind::Try { .. } => "try",
        StmtKind::DoWhile { .. } => "do",
        StmtKind::While { .. } => "while",
        StmtKind::With { .. } => "with",
        StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } => "for",
        _ => return None,
    })
}

/// Counts ancestors, for a rule that asks that of many nodes.
///
/// A long walk towards the root leaves its count at every [`AncestorCounter::STRIDE`]th node on its
/// way, and a walk that comes to such a node ends there. So all the walks in a file together take
/// O(nodes + walks) steps, however deep the nodes are in each other.
#[derive(Default)]
pub struct AncestorCounter<'a> {
    /// How many ancestors of a node count.
    known: FxHashMap<Node<'a>, u32>,
}

/// What an ancestor is to an [`AncestorCounter`].
pub(crate) enum Ancestor {
    /// Neither it nor what is above it counts.
    End,
    Counted,
    Passed,
}

impl<'a> AncestorCounter<'a> {
    const STRIDE: u32 = 32;

    /// How many of the ancestors of `start` count. `classify` depends on nothing but the ancestor.
    pub(crate) fn count(&mut self, start: Node<'a>, classify: impl Fn(Node<'a>) -> Ancestor) -> usize {
        let (mut at, mut steps, mut count) = (start, 0u32, 0u32);
        loop {
            if !self.known.is_empty()
                && let Some(&above) = self.known.get(&at)
            {
                count += above;
                break;
            }
            if matches!(at, Node::File(_)) {
                break;
            }
            at = at.parent();
            match classify(at) {
                Ancestor::End => break,
                Ancestor::Counted => count += 1,
                Ancestor::Passed => {}
            }
            steps += 1;
        }
        if steps >= Self::STRIDE {
            let (mut at, mut above) = (start, count);
            for i in 0..steps {
                if i % Self::STRIDE == 0 {
                    self.known.insert(at, above);
                }
                at = at.parent();
                if matches!(classify(at), Ancestor::Counted) {
                    above = above.saturating_sub(1);
                }
            }
        }
        count as usize
    }
}

impl MaxDepth {
    fn check<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Some(keyword)) = (self.max, keyword_of(stmt)) else {
            return;
        };
        let around = cx.state.count(Node::Stmt(stmt), |ancestor| match ancestor {
            Node::Func(_) => Ancestor::End,
            Node::Stmt(outer) if keyword_of(outer).is_some() => Ancestor::Counted,
            _ => Ancestor::Passed,
        });
        let depth = around + 1;
        if depth > max {
            let whole = stmt.span();
            // oxlint points at the whole statement.
            let end = if cx.language().is_oxlint { whole.end } else { whole.start + keyword.len() as u32 };
            cx.report(Span::new(whole.start, end), TOO_DEEPLY)
                .data("depth", depth)
                .data("maxDepth", max);
        }
    }
}

impl Rule for MaxDepth {
    const META: Meta = Meta::eslint("max-depth", Kind::Suggestion);
    type State<'a> = AncestorCounter<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxDepth {
            max: match object.has("maximum") || object.has("max") {
                true => object.usize("maximum").filter(|max| *max != 0).or_else(|| object.usize("max")),
                false => Some(options.number(0).map_or(4, |max| max as usize)),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> AncestorCounter<'a> {
        on.stmts(
            [
                StmtTag::If,
                StmtTag::Switch,
                StmtTag::Try,
                StmtTag::DoWhile,
                StmtTag::While,
                StmtTag::For,
                StmtTag::ForIn,
                StmtTag::ForOf,
                // `with`
                StmtTag::Block,
            ],
            Self::check,
        );
        AncestorCounter::default()
    }
}
