use crate::util_eslint::is_space_between_tokens;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce or disallow spaces around equal signs in JSX attributes
pub struct JsxEqualsSpacing {
    /// `"always"`, not `"never"`
    always: bool,
}

const NO_SPACE_BEFORE: Message = Message::new("noSpaceBefore", "There should be no space before '='");
const NO_SPACE_AFTER: Message = Message::new("noSpaceAfter", "There should be no space after '='");
const NEED_SPACE_BEFORE: Message = Message::new("needSpaceBefore", "A space is required before '='");
const NEED_SPACE_AFTER: Message = Message::new("needSpaceAfter", "A space is required after '='");

impl Rule for JsxEqualsSpacing {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-equals-spacing", Kind::None).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        JsxEqualsSpacing { always: options.str(0) == Some("always") }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let file = cx.file();
        for attr_node in jsx.attrs() {
            // `hasEqual`
            let Some(name) = attr_node.key().filter(|_| attr_node.value().is_some()) else {
                continue;
            };
            let name = name.span(file);
            let at = skip_trivia(file.text(), name.end);
            let equal_token = Span::new(at, at + 1);
            let value = skip_trivia(file.text(), equal_token.end);
            let spaced_before = is_spaced(file, name, at);
            let spaced_after = is_spaced(file, equal_token, value);
            if self.always {
                if !spaced_before {
                    cx.report_at(at, NEED_SPACE_BEFORE).fix(|fixer| fixer.insert_before(equal_token, " "));
                }
                if !spaced_after {
                    cx.report_at(at, NEED_SPACE_AFTER).fix(|fixer| fixer.insert_after(equal_token, " "));
                }
            } else {
                if spaced_before {
                    cx.report_at(at, NO_SPACE_BEFORE).fix(|fixer| fixer.remove(name.between(equal_token)));
                }
                if spaced_after {
                    cx.report_at(at, NO_SPACE_AFTER).fix(|fixer| fixer.remove(Span::after(equal_token, value)));
                }
            }
        }
    }
}

/// `isSpaceBetweenTokens` of `first` and the token that starts at `second`, the next one.
fn is_spaced<'a>(file: &'a File<'a>, first: Span, second: u32) -> bool {
    match file.slice(Span::after(first, second)).first() {
        None => false,
        Some(b'/') => file.token_at(second).is_some_and(|it| is_space_between_tokens(file, first, it.span())),
        Some(_) => true,
    }
}
