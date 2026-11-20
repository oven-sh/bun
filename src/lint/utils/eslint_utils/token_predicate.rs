//! `token-predicate.mjs`

use crate::tokens::Token;

macro_rules! punctuators {
    ($($is:ident $upstream:literal, $text:literal;)*) => {$(
        #[doc = concat!("eslint-utils' `", $upstream, "`: whether `token` is the punctuator `", $text, "`.")]
        #[inline]
        pub fn $is(token: &Token<'_>) -> bool {
            token.is_punctuator($text)
        }
    )*};
}

punctuators! {
    is_arrow_token "isArrowToken", "=>";
    is_comma_token "isCommaToken", ",";
    is_semicolon_token "isSemicolonToken", ";";
    is_colon_token "isColonToken", ":";
    is_opening_paren_token "isOpeningParenToken", "(";
    is_closing_paren_token "isClosingParenToken", ")";
    is_opening_bracket_token "isOpeningBracketToken", "[";
    is_opening_brace_token "isOpeningBraceToken", "{";
    is_closing_brace_token "isClosingBraceToken", "}";
}

/// eslint-utils' `isNotSemicolonToken`.
#[inline]
pub fn is_not_semicolon_token(token: &Token<'_>) -> bool {
    !is_semicolon_token(token)
}

/// eslint-utils' `isNotClosingParenToken`.
#[inline]
pub fn is_not_closing_paren_token(token: &Token<'_>) -> bool {
    !is_closing_paren_token(token)
}
