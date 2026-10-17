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
    Some(match stmt.tag() {
        StmtTag::If => {
            // For oxlint neither that of `if (a) if (b) ..`.
            let is_oxlint = stmt.file().language().is_oxlint;
            let is_else_if = matches!(stmt.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::If
                && (is_oxlint || parent.as_if().is_some_and(|it| it.2 == Some(stmt))));
            if is_else_if {
                return None;
            }
            "if"
        }
        StmtTag::Switch => "switch",
        StmtTag::Try => "try",
        StmtTag::DoWhile => "do",
        StmtTag::While => "while",
        StmtTag::Block if stmt.is_with() => "with",
        StmtTag::For | StmtTag::ForIn | StmtTag::ForOf => "for",
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
enum Ancestor {
    /// Neither it nor what is above it counts.
    End,
    Counted,
    Passed,
}

impl<'a> AncestorCounter<'a> {
    const STRIDE: u32 = 32;

    /// How many of the ancestors of `start` count. `classify` depends on nothing but the ancestor.
    fn count(&mut self, start: Node<'a>, classify: impl Fn(Node<'a>) -> Ancestor) -> usize {
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

#[derive(Default)]
pub struct State<'a> {
    ancestors: AncestorCounter<'a>,
    /// ESLint before 10 counts while it walks: how deep it is in each of the functions around.
    depths: Vec<i64>,
}

/// Whether ESLint before 10 counts `node` where it ends.
fn ends_a_block_before_10(node: Node) -> bool {
    matches!(node, Node::Stmt(stmt) if stmt.as_block().is_none())
}

impl MaxDepth {
    /// An `if` that is directly in another one, as that of `else if`, is not counted where it begins, and is where it
    /// ends. So what follows it in the function is less deep by one.
    fn enter_before_10<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Node::Stmt(stmt), true) = (self.max, node, ends_a_block_before_10(node))
        else {
            return;
        };
        let is_if = |it: Stmt| it.tag() == StmtTag::If;
        if is_if(stmt) && matches!(stmt.parent(), Node::Stmt(parent) if is_if(parent)) {
            return;
        }
        let Some(depth) = cx.state.depths.last_mut() else {
            return;
        };
        *depth += 1;
        if let Ok(depth) = usize::try_from(*depth)
            && depth > max
        {
            cx.report(stmt, TOO_DEEPLY)
                .data("depth", depth)
                .data("maxDepth", max);
        }
    }
}

const STATEMENTS: &[StmtTag] = &[
    StmtTag::If,
    StmtTag::Switch,
    StmtTag::Try,
    StmtTag::DoWhile,
    StmtTag::While,
    StmtTag::For,
    StmtTag::ForIn,
    StmtTag::ForOf,
];
/// The tag of a `with` statement.
const WITH: &[StmtTag] = &[StmtTag::Block];
const WALKED: NodeTags = NodeTags::FILE
    .union(NodeTags::FUNC)
    .stmts(STATEMENTS)
    .stmts(WITH);

impl Rule for MaxDepth {
    const META: Meta = Meta::eslint("max-depth", Kind::Suggestion);
    const ON: On = On::new()
        .stmts(STATEMENTS)
        .stmts(WITH)
        .enter(WALKED)
        .exit(WALKED);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxDepth {
            max: match object.has("maximum") || object.has("max") {
                true => object
                    .usize("maximum")
                    .filter(|max| *max != 0)
                    .or_else(|| object.usize("max")),
                false => Some(options.number(0).map_or(4, |max| max as usize)),
            },
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match file.language().eslint_major < 10 {
            true => On::new().enter(WALKED).exit(WALKED),
            false if file.has_with_statements() => On::new().stmts(STATEMENTS).stmts(WITH),
            false => On::new().stmts(STATEMENTS),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Some(keyword)) = (self.max, keyword_of(stmt)) else {
            return;
        };
        let around = cx
            .state
            .ancestors
            .count(Node::Stmt(stmt), |ancestor| match ancestor {
                Node::Func(_) => Ancestor::End,
                Node::Stmt(outer) if keyword_of(outer).is_some() => Ancestor::Counted,
                _ => Ancestor::Passed,
            });
        let depth = around + 1;
        if depth > max {
            let whole = stmt.span();
            // oxlint points at the whole statement.
            let end = if cx.language().is_oxlint {
                whole.end
            } else {
                whole.start + keyword.len() as u32
            };
            cx.report(Span::new(whole.start, end), TOO_DEEPLY)
                .called_with(stmt)
                .data("depth", depth)
                .data("maxDepth", max);
        }
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        match node {
            Node::File(_) | Node::Func(_) => cx.state.depths.push(0),
            _ => self.enter_before_10(node, cx),
        }
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        match node {
            Node::File(_) | Node::Func(_) => {
                cx.state.depths.pop();
            }
            _ => {
                if ends_a_block_before_10(node)
                    && let Some(depth) = cx.state.depths.last_mut()
                {
                    *depth -= 1;
                }
            }
        }
    }
}
