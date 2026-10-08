use super::complexity::{Climber, Step};
use bun_lint::prelude::*;

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
            let is_else_if = matches!(stmt.parent(), Node::Stmt(parent)
                if matches!(parent.kind(), StmtKind::If { no: Some(no), .. } if no == stmt));
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

impl MaxDepth {
    fn check<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Some(keyword)) = (self.max, keyword_of(stmt)) else {
            return;
        };
        let (_, around) = cx.state.climb(Node::Stmt(stmt), (), |_, ancestor| match ancestor {
            Node::Func(_) => Step::Stop(()),
            Node::Stmt(outer) if keyword_of(outer).is_some() => Step::Count,
            _ => Step::Pass,
        });
        let depth = around as usize + 1;
        if depth > max {
            let start = stmt.span().start;
            cx.report(Span::new(start, start + keyword.len() as u32), TOO_DEEPLY)
                .data("depth", depth)
                .data("maxDepth", max);
        }
    }
}

impl Rule for MaxDepth {
    const META: Meta = Meta::eslint("max-depth", Kind::Suggestion);
    type State<'a> = Climber<'a, ()>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxDepth {
            max: match object.has("maximum") || object.has("max") {
                true => object.usize("maximum").filter(|max| *max != 0).or_else(|| object.usize("max")),
                false => Some(options.number(0).map_or(4, |max| max as usize)),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Climber<'a, ()> {
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
        Climber::default()
    }
}
