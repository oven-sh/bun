//! `token-predicate.mjs`

use crate::tokens::Token;

macro_rules! punctuators {
    ($($is:ident $upstream:literal, $is_not:ident $upstream_not:literal, $text:literal;)*) => {$(
        #[doc = concat!("eslint-utils' `", $upstream, "`: whether `token` is the punctuator `", $text, "`.")]
        #[inline]
        pub fn $is(token: &Token<'_>) -> bool {
            token.is_punctuator($text)
        }

        #[doc = concat!("eslint-utils' `", $upstream_not, "`.")]
        #[inline]
        pub fn $is_not(token: &Token<'_>) -> bool {
            !$is(token)
        }
    )*};
}

punctuators! {
    is_arrow_token "isArrowToken", is_not_arrow_token "isNotArrowToken", "=>";
    is_comma_token "isCommaToken", is_not_comma_token "isNotCommaToken", ",";
    is_semicolon_token "isSemicolonToken", is_not_semicolon_token "isNotSemicolonToken", ";";
    is_colon_token "isColonToken", is_not_colon_token "isNotColonToken", ":";
    is_opening_paren_token "isOpeningParenToken", is_not_opening_paren_token "isNotOpeningParenToken", "(";
    is_closing_paren_token "isClosingParenToken", is_not_closing_paren_token "isNotClosingParenToken", ")";
    is_opening_bracket_token "isOpeningBracketToken", is_not_opening_bracket_token "isNotOpeningBracketToken", "[";
    is_closing_bracket_token "isClosingBracketToken", is_not_closing_bracket_token "isNotClosingBracketToken", "]";
    is_opening_brace_token "isOpeningBraceToken", is_not_opening_brace_token "isNotOpeningBraceToken", "{";
    is_closing_brace_token "isClosingBraceToken", is_not_closing_brace_token "isNotClosingBraceToken", "}";
}

/// eslint-utils' `isCommentToken`: a line comment, a block comment or the shebang.
#[inline]
pub fn is_comment_token(token: &Token<'_>) -> bool {
    token.is_comment()
}

/// eslint-utils' `isNotCommentToken`.
#[inline]
pub fn is_not_comment_token(token: &Token<'_>) -> bool {
    !token.is_comment()
}
