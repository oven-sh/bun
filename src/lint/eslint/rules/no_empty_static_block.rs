use bun_lint::prelude::*;
use bun_lint::utils::text;

/// Disallow empty static blocks.
pub struct NoEmptyStaticBlock;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected empty static block.");
const SUGGEST_COMMENT: Message =
    Message::new("suggestComment", "Add comment inside empty static block.");

impl Rule for NoEmptyStaticBlock {
    const META: Meta = Meta::eslint("no-empty-static-block", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoEmptyStaticBlock
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.members(|_, member, cx| {
            if member.kind() != MemberKind::StaticBlock {
                return;
            }
            let Some(func) = member.func() else {
                return;
            };
            if func.body_statements().is_none_or(|body| !body.is_empty()) {
                return;
            }
            let Some(braces) = func.body_span() else {
                return;
            };
            // Without statements, all that can be between the braces is whitespace and comments.
            let inside = braces.shrink(1, 1);
            // For oxlint a comment before the `{` fills it too.
            let is_filled = cx.language().is_oxlint && cx.file().comments_in(member.span()).next().is_some();
            if !is_filled && text::is_blank(cx.slice(inside)) {
                // oxlint points at the `static`.
                cx.report(if cx.language().is_oxlint { member.span() } else { braces }, UNEXPECTED)
                    .suggest(SUGGEST_COMMENT, |fixer| fixer.replace(inside, " /* empty */ "));
            }
        });
    }
}
