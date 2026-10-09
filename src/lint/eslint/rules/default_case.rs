use bun_core::strings;
use bun_lint::prelude::*;

/// Require `default` cases in `switch` statements.
pub struct DefaultCase {
    /// `None`: `/^no default$/iu`
    comment_pattern: Option<Regex>,
    /// The same for oxlint, which ignores the case.
    oxlint_comment_pattern: Option<Regex>,
}

const MISSING_DEFAULT_CASE: Message = Message::new("missingDefaultCase", "Expected a default case.");

impl DefaultCase {
    fn check<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { cases, .. } = stmt.kind() else {
            return;
        };
        let Some(last_case) = cases.last() else {
            return;
        };
        if cases.iter().any(Case::is_default) {
            return;
        }
        let is_excused = cx.file().comments_after(last_case).next_back().is_some_and(|comment| {
            let value = strings::trim_js_whitespace(comment.comment_value());
            let is_oxlint = cx.language().is_oxlint;
            match if is_oxlint { &self.oxlint_comment_pattern } else { &self.comment_pattern } {
                Some(pattern) => pattern.test(value),
                None => value.eq_ignore_ascii_case(b"no default"),
            }
        });
        if !is_excused {
            cx.report(stmt, MISSING_DEFAULT_CASE);
        }
    }
}

impl Rule for DefaultCase {
    const META: Meta = Meta::eslint("default-case", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let pattern = |flags: &str| match options.str("commentPattern") {
            None | Some("") => None,
            Some(_) => options.regex("commentPattern", flags),
        };
        DefaultCase {
            comment_pattern: pattern("u"),
            oxlint_comment_pattern: pattern("iu"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Switch], Self::check);
    }
}
