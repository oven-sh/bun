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
    const META: Meta = Meta::plugin(Plugin::React, "jsx-equals-spacing", Kind::Layout).fixable(Fixable::Code);
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
            let (Some(name), Some(value)) = (attr_node.key(), attr_node.value()) else {
                continue;
            };
            let name = name.span(file);
            let value = value.jsx_container_span().unwrap_or_else(|| value.span());
            let at = skip_trivia(file.text(), name.end);
            let equal_token = Span::new(at, at + 1);
            let spaced_before = is_spaced(file, name, equal_token);
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
                    cx.report_at(at, NO_SPACE_AFTER).fix(|fixer| fixer.remove(equal_token.between(value)));
                }
            }
        }
    }
}

/// `isSpaceBetweenTokens` for two with nothing but blanks and comments between them.
fn is_spaced<'a>(file: &'a File<'a>, first: Span, second: Span) -> bool {
    match file.slice(first.between(second)).first() {
        None => false,
        Some(b'/') => is_space_between_tokens(file, first, second),
        Some(_) => true,
    }
}
