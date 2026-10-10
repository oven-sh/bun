use crate::util_eslint::is_space_between_tokens;
use crate::util_get_token_before_closing_bracket::get_token_before_closing_bracket;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce spacing before closing bracket in JSX
pub struct JsxSpaceBeforeClosing {
    /// `"never"`, not `"always"`
    never: bool,
}

const NO_SPACE_BEFORE_CLOSE: Message =
    Message::new("noSpaceBeforeClose", "A space is forbidden before closing bracket");
const NEED_SPACE_BEFORE_CLOSE: Message =
    Message::new("needSpaceBeforeClose", "A space is required before closing bracket");

impl Rule for JsxSpaceBeforeClosing {
    const META: Meta =
        Meta::plugin(Plugin::React, "jsx-space-before-closing", Kind::Layout).fixable(Fixable::Code).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        JsxSpaceBeforeClosing { never: options.str(0) == Some("never") }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        if !jsx.is_self_closing() {
            return;
        }
        let file = cx.file();
        let left_token = get_token_before_closing_bracket(jsx);
        // The token after it, as upstream has it: after a name with type arguments and no attribute that is their `<`.
        let closing_slash = skip_trivia(file.text(), left_token.end);
        let between = Span::after(left_token, closing_slash);
        if !ast_utils::is_on_one_line(file, between) {
            return;
        }
        let is_spaced = match file.slice(between).first() {
            None => false,
            Some(b'/') => {
                file.token_at(closing_slash).is_some_and(|it| is_space_between_tokens(file, left_token, it.span()))
            }
            Some(_) => true,
        };
        if is_spaced && self.never {
            cx.report_at(closing_slash, NO_SPACE_BEFORE_CLOSE).fix(|fixer| fixer.remove(between));
        } else if !is_spaced && !self.never {
            cx.report_at(closing_slash, NEED_SPACE_BEFORE_CLOSE)
                .fix(|fixer| fixer.insert_before(Span::empty(closing_slash), " "));
        }
    }
}
