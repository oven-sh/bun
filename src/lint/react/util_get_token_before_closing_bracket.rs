#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/getTokenBeforeClosingBracket.js` of eslint-plugin-react.

use bun_lint::prelude::*;

/// `getTokenBeforeClosingBracket(node)` for the opening element of `jsx`: the last attribute, else
/// the name. A fragment, which upstream never asks about, has neither: its `<`.
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
