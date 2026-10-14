use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::TypeFlags;
use bun_lint::utils::directives::match_directives_pattern;
use bun_lint::utils::text;

/// Disallow fallthrough of `case` statements.
pub struct NoFallthrough {
    comment_pattern: CommentPattern,
    /// `commentPattern` as oxlint reads it: in capitals or not.
    pattern_of_oxlint: Option<Regex>,
    allow_empty_case: bool,
    report_unused_fallthrough_comment: bool,
}

const UNUSED_FALLTHROUGH_COMMENT: Message = Message::new(
    "unusedFallthroughComment",
    "Found a comment that would permit fallthrough, but case cannot fall through.",
);
const CASE: Message = Message::new("case", "Expected a 'break' statement before 'case'.");
const DEFAULT: Message = Message::new("default", "Expected a 'break' statement before 'default'.");

/// Without `commentPattern`, a comment has to be one of these for oxlint, in capitals or not.
const COMMENTS_OF_OXLINT: [&[u8]; 4] = [b"falls through", b"fall through", b"fallsthrough", b"fallthrough"];

/// `commentPattern`
enum CommentPattern {
    /// Not set, so it's ESLint's `/falls?\s?through/iu`.
    OfEslint,
    /// [`PATTERN_OF_BUN`]
    OfBun,
    Other(Regex),
}

/// `commentPattern` in `bun lint`'s default config. It's matched by hand, so a run with no config never compiles a regular expression.
const PATTERN_OF_BUN: &str = r"(?i:falls?[\s-]?through|no\s?break)";

/// Looks for `first`, then at most one whitespace character or one of `separators`, then `second`. Ignores case.
fn has_words(value: &[u8], first: &[u8], separators: &[u8], second: &[u8]) -> bool {
    let Some(&start) = first.first() else {
        return false;
    };
    let mut rest = value;
    while let Some(at) = strings::index_of_any(rest, &[start, start.to_ascii_uppercase()]) {
        rest = rest.get(at..).unwrap_or_default();
        if let Some(after) = text::strip_prefix_ignoring_case(rest, first) {
            let separator = match after.first() {
                Some(&byte) if strings::contains_char(separators, byte) => 1,
                _ => strings::js_whitespace_len(after),
            };
            let after = after.get(separator..).unwrap_or_default();
            if text::strip_prefix_ignoring_case(after, second).is_some() {
                return true;
            }
        }
        rest = rest.get(1..).unwrap_or_default();
    }
    false
}

impl CommentPattern {
    fn test(&self, value: &[u8]) -> bool {
        let falls_through = |separators: &[u8]| {
            has_words(value, b"fall", separators, b"through") || has_words(value, b"falls", separators, b"through")
        };
        match self {
            CommentPattern::OfEslint => falls_through(b""),
            CommentPattern::OfBun => falls_through(b"-") || has_words(value, b"no", b"", b"break"),
            CommentPattern::Other(pattern) => pattern.test(value),
        }
    }
}

/// `process.exit()`, `process.abort()`, or, in a file that has been type checked, any call that returns `never`.
fn never_returns(e: Expr) -> bool {
    let Some(call) = e.as_call() else {
        return false;
    };
    let ends_the_process = match call.callee().kind() {
        ExprKind::Dot { obj, name, .. } => obj.is_ident("process") && name.name().is_any(&["exit", "abort"]),
        _ => false,
    };
    ends_the_process || e.file().types().is_some() && e.ty().has_flags(TypeFlags::NEVER)
}

/// Whether the code after `statement` can't run. ESLint's code paths only know `break`, `return`, `throw` and `continue`. This
/// also knows [calls that never return](never_returns).
fn never_completes(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::Break(..) | StmtKind::Return(..) | StmtKind::Throw(..) | StmtKind::Continue(..) => true,
        StmtKind::Expr(e) => never_returns(e),
        StmtKind::Block(body) => body.iter().any(never_completes),
        StmtKind::If { yes, no: Some(no), .. } => never_completes(yes) && never_completes(no),
        _ => false,
    }
}

impl NoFallthrough {
    /// The comment, if it is a fallthrough comment and not a directive of ESLint.
    fn fallthrough_comment<'a>(&self, comment: Option<Token<'a>>, is_oxlint: bool) -> Option<Token<'a>> {
        comment.filter(|comment| {
            let value = comment.comment_value();
            if is_oxlint {
                let value = strings::trim_js_whitespace(value);
                let is_directive = value.starts_with(b"oxlint-") || value.starts_with(b"eslint-");
                return match (&self.pattern_of_oxlint, &self.comment_pattern) {
                    (Some(pattern), _) => pattern.test(value) && !is_directive,
                    (None, of_bun @ CommentPattern::OfBun) => of_bun.test(value) && !is_directive,
                    (None, _) => COMMENTS_OF_OXLINT.iter().any(|it| value.eq_ignore_ascii_case(it)),
                };
            }
            self.comment_pattern.test(value) && match_directives_pattern(strings::trim_js_whitespace(value)).is_none()
        })
    }

    /// ESLint's `getFallthroughComment`
    fn get_fallthrough_comment<'a>(
        &self,
        case_which_falls_through: Case<'a>,
        subsequent_case: Case<'a>,
    ) -> Option<Token<'a>> {
        let file = subsequent_case.file();
        let is_oxlint = file.language().is_oxlint;
        let consequent = case_which_falls_through.body();
        if consequent.len() == 1
            && let Some(block) = consequent.first()
            && block.as_block().is_some()
        {
            let end = block.span().end;
            let trailing_close_brace = Span::new(end.saturating_sub(1), end);
            let in_block = file.comments_before(trailing_close_brace).next_back();
            if let Some(comment) = self.fallthrough_comment(in_block, is_oxlint) {
                return Some(comment);
            }
        }
        self.fallthrough_comment(file.comments_before(subsequent_case).next_back(), is_oxlint)
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
        // With an ESLint or oxlint config, only what they take for the end of a case counts.
        let exits = || cx.language().stands_alone && previous.body().iter().any(never_completes);
        let is_switch_exit_reachable = !ends_with_jump && previous.is_end_reachable() && !exits();
        let is_fallthrough = is_switch_exit_reachable && may_fall_through;
        if !is_fallthrough && (is_switch_exit_reachable || !self.report_unused_fallthrough_comment) {
            return;
        }
        match self.get_fallthrough_comment(previous, case) {
            None if is_fallthrough => {
                let report = cx.report(case, if case.is_default() { DEFAULT } else { CASE });
                if !matches!(self.comment_pattern, CommentPattern::Other(_)) {
                    report.hint("Add break, or the comment // falls through if this is meant.");
                }
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
    const META: Meta = Meta::eslint("no-fallthrough", Kind::Problem).recommended().hints();
    const ON: On = On::new().stmts(&[StmtTag::Switch]);
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let source = object.str("commentPattern").filter(|pattern| !pattern.is_empty());
        let compiled = source.filter(|pattern| *pattern != PATTERN_OF_BUN);
        NoFallthrough {
            pattern_of_oxlint: compiled.and_then(|pattern| Regex::new(pattern, "iu").ok()),
            comment_pattern: match compiled.and_then(|pattern| Regex::new(pattern, "u").ok()) {
                Some(pattern) => CommentPattern::Other(pattern),
                None if source == Some(PATTERN_OF_BUN) => CommentPattern::OfBun,
                None => CommentPattern::OfEslint,
            },
            allow_empty_case: object.bool_or("allowEmptyCase", false),
            report_unused_fallthrough_comment: object
                .bool_or("reportUnusedFallthroughComment", false),
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some((_, cases)) = stmt.as_switch() else {
            return;
        };
        let mut previous = None;
        for case in cases {
            if let Some(previous) = previous.replace(case) {
                self.check_case(previous, case, cx);
            }
        }
    }
}
