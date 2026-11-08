//! `lib/util/getTokenBeforeClosingBracket.js` of eslint-plugin-react.

use bun_lint::prelude::*;

/// `getTokenBeforeClosingBracket(node)` for `jsx`'s opening element: the last attribute, or else
/// the name. A fragment has neither, so its `<` is returned, but upstream never passes one.
pub(crate) fn get_token_before_closing_bracket(jsx: Jsx<'_>) -> Span {
    match (jsx.attrs().last(), jsx.tag()) {
        (Some(attribute), _) => attribute.span(),
        (None, Some(name)) => name.span(),
        (None, None) => {
            let opening = jsx.opening_span();
            Span::new(opening.start, opening.start + 1)
        }
    }
}
