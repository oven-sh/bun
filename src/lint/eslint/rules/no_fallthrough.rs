use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::directives::match_directives_pattern;
use bun_lint::utils::text;

/// Disallow fallthrough of `case` statements.
pub struct NoFallthrough {
    fallthrough_comment_pattern: Regex,
    allow_empty_case: bool,
    report_unused_fallthrough_comment: bool,
}

const UNUSED_FALLTHROUGH_COMMENT: Message = Message::new(
    "unusedFallthroughComment",
    "Found a comment that would permit fallthrough, but case cannot fall through.",
);
const CASE: Message = Message::new("case", "Expected a 'break' statement before 'case'.");
const DEFAULT: Message = Message::new("default", "Expected a 'break' statement before 'default'.");

#[derive(Default)]
pub struct State<'a> {
    /// The code paths around the current node, the innermost last.
    code_paths: Vec<CodePath<'a>>,
    /// The `case` that has been left last, unless another has been entered since.
    previous_case: Option<PreviousCase<'a>>,
}

struct PreviousCase<'a> {
    node: Case<'a>,
    is_switch_exit_reachable: bool,
    is_fallthrough: bool,
}

impl NoFallthrough {
    /// The comment, if it is a fallthrough comment and not a directive of ESLint.
    fn fallthrough_comment<'a>(&self, comment: Option<Token<'a>>) -> Option<Token<'a>> {
        comment.filter(|comment| {
            let value = comment.comment_value();
            self.fallthrough_comment_pattern.test(value)
                && match_directives_pattern(text::trim(value)).is_none()
        })
    }

    /// ESLint's `getFallthroughComment`
    fn get_fallthrough_comment<'a>(
        &self,
        case_which_falls_through: Case<'a>,
        subsequent_case: Case<'a>,
    ) -> Option<Token<'a>> {
        let file = subsequent_case.file();
        let consequent = case_which_falls_through.body();
        if consequent.len() == 1
            && let Some(block) = consequent.first()
            && block.as_block().is_some()
        {
            let end = block.span().end;
            let trailing_close_brace = Span::new(end.saturating_sub(1), end);
            let in_block = file.comments_before(trailing_close_brace).next_back();
            if let Some(comment) = self.fallthrough_comment(in_block) {
                return Some(comment);
            }
        }
        self.fallthrough_comment(file.comments_before(subsequent_case).next_back())
    }

    fn enter_case<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Node::Case(case), Some(previous)) = (node, cx.state.previous_case.take()) else {
            return;
        };
        let may_be_unused =
            self.report_unused_fallthrough_comment && !previous.is_switch_exit_reachable;
        if !(previous.is_fallthrough || may_be_unused) || previous.node.parent() != case.parent() {
            return;
        }
        match self.get_fallthrough_comment(previous.node, case) {
            None if previous.is_fallthrough => {
                cx.report(case, if case.is_default() { DEFAULT } else { CASE });
            }
            Some(comment) if !previous.is_fallthrough => {
                cx.report(comment, UNUSED_FALLTHROUGH_COMMENT);
            }
            _ => {}
        }
    }

    fn exit_case<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Case(case) = node else {
            return;
        };
        // What follows a `break`, a `return` or a `throw` cannot be reached.
        let is_switch_exit_reachable =
            cx.state.code_paths.last().is_some_and(|path| path.is_current_reachable());
        let is_last = || match case.parent() {
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::Switch { cases, .. } => cases.last() == Some(case),
                _ => true,
            },
            _ => true,
        };
        let has_blank_lines_before_next_token = || {
            let end = case.span().end;
            cx.line_of(skip_trivia(cx.text(), end)) > cx.line_of(end) + 1
        };
        let is_fallthrough = is_switch_exit_reachable
            && !is_last()
            && (!case.body().is_empty()
                || !self.allow_empty_case && has_blank_lines_before_next_token());
        cx.state.previous_case = Some(PreviousCase {
            node: case,
            is_switch_exit_reachable,
            is_fallthrough,
        });
    }
}

impl Rule for NoFallthrough {
    const META: Meta = Meta::eslint("no-fallthrough", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoFallthrough {
            fallthrough_comment_pattern: (object.str("commentPattern"))
                .filter(|pattern| !pattern.is_empty())
                .and_then(|pattern| Regex::new(pattern, "u").ok())
                .unwrap_or_else(|| Regex::literal(r"/falls?\s?through/iu")),
            allow_empty_case: object.bool_or("allowEmptyCase", false),
            report_unused_fallthrough_comment: object
                .bool_or("reportUnusedFallthroughComment", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        // TODO(api): replace by integrator::File::has_nodes(StmtTag::Switch)
        if !strings::contains(file.text(), b"switch") {
            return State::default();
        }
        on.code_path_start(|_, path, _, cx| cx.state.code_paths.push(path));
        on.code_path_end(|_, _, _, cx| {
            cx.state.code_paths.pop();
        });
        on.enter(NodeTags::CASE, Self::enter_case);
        on.exit(NodeTags::CASE, Self::exit_case);
        State::default()
    }
}
