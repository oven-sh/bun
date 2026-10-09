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

    /// Checks `previous`, which `case` follows.
    fn check_case<'a>(&self, previous: Case<'a>, case: Case<'a>, cx: &Cx<'a, Self>) {
        let has_blank_lines_before_next_token = || {
            let end = previous.span().end;
            cx.line_of(skip_trivia(cx.text(), end)) > cx.line_of(end) + 1
        };
        let last = previous.body().last();
        // What follows a `break`, a `return` or a `throw` cannot be reached.
        let ends_with_jump = matches!(
            last.map(Stmt::tag),
            Some(StmtTag::Break | StmtTag::Return | StmtTag::Throw | StmtTag::Continue)
        );
        let may_fall_through =
            !ends_with_jump && (last.is_some() || !self.allow_empty_case && has_blank_lines_before_next_token());
        if !may_fall_through && !self.report_unused_fallthrough_comment {
            return;
        }
        let is_switch_exit_reachable = !ends_with_jump && previous.is_end_reachable();
        let is_fallthrough = is_switch_exit_reachable && may_fall_through;
        if !is_fallthrough && (is_switch_exit_reachable || !self.report_unused_fallthrough_comment) {
            return;
        }
        match self.get_fallthrough_comment(previous, case) {
            None if is_fallthrough => {
                cx.report(case, if case.is_default() { DEFAULT } else { CASE });
            }
            Some(comment) if !is_fallthrough => {
                let place = match cx.language().is_oxlint {
                    true => place_of_oxlint(previous, case, comment.span()),
                    false => comment.span(),
                };
                cx.report(place, UNUSED_FALLTHROUGH_COMMENT);
            }
            _ => {}
        }
    }
}

/// oxlint points at all that is between the last statement of `previous` and `case`, or the `}` of the block that the
/// comment is in.
fn place_of_oxlint<'a>(previous: Case<'a>, case: Case<'a>, comment: Span) -> Span {
    let (body, end_of_case) = (previous.body(), previous.span().end);
    let block = body.first().filter(|_| body.len() == 1).and_then(|it| Some((it.span(), it.as_block()?)));
    let start = match block {
        Some((block, statements)) => statements.last().map_or(block.start, |it| it.span().end),
        None => body.last().map_or(end_of_case, |it| it.span().end),
    };
    let end = match block {
        Some((block, _)) if comment.end <= block.end => block.end,
        _ => case.span().start,
    };
    Span::new(start, end)
}

impl Rule for NoFallthrough {
    const META: Meta = Meta::eslint("no-fallthrough", Kind::Problem).recommended();
    type State<'a> = ();

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Switch], |rule, stmt, cx| {
            let StmtKind::Switch { cases, .. } = stmt.kind() else {
                return;
            };
            let mut previous = None;
            for case in cases {
                if let Some(previous) = previous.replace(case) {
                    rule.check_case(previous, case, cx);
                }
            }
        });
    }
}
