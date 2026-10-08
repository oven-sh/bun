//! `@eslint-community/eslint-utils`, which typescript-eslint re-exports as `ASTUtils` and from
//! `@typescript-eslint/utils/ast-utils`.
//!
//! | upstream | here |
//! | --- | --- |
//! | `findVariable(scope, "name")` | [`find_variable`] |
//! | `findVariable(scope, identifierNode)` | [`find_variable_of`] |
//! | `getInnermostScope` | [`get_innermost_scope`] |
//! | `getFunctionHeadLocation` | [`get_function_head_location`] |
//! | `getFunctionNameWithKind` | [`get_function_name_with_kind`] |
//! | `getPropertyName` | [`get_property_name`], for a [`Key`](crate::ast::Key) [`property_name_of_key`] |
//! | `getStaticValue` | [`get_static_value`], [`StaticValue`] |
//! | `getStringIfConstant` | [`get_string_if_constant`] |
//! | `hasSideEffect` | [`has_side_effect`], [`HasSideEffectOptions`] |
//! | `isParenthesized(node, sourceCode)` | [`is_parenthesized`] |
//! | `isParenthesized(times, node, sourceCode)` | [`is_parenthesized_times`] |
//! | `PatternMatcher` | [`PatternMatcher`] |
//! | `ReferenceTracker` | [`ReferenceTracker`], [`TraceMap`], [`TrackedReference`] |
//! | `READ`, `CALL`, `CONSTRUCT` as keys | [`TraceMap::read`], [`TraceMap::call`], [`TraceMap::construct`] |
//! | `READ`, `CALL`, `CONSTRUCT` as `type` | [`ReferenceKind`] |
//! | `ESM` | [`TraceMap::esm`] |
//! | `isArrowToken`, `isNotArrowToken` | [`is_arrow_token`], [`is_not_arrow_token`] |
//! | `isCommaToken`, `isNotCommaToken` | [`is_comma_token`], [`is_not_comma_token`] |
//! | `isSemicolonToken`, `isNotSemicolonToken` | [`is_semicolon_token`], [`is_not_semicolon_token`] |
//! | `isColonToken`, `isNotColonToken` | [`is_colon_token`], [`is_not_colon_token`] |
//! | `isOpeningParenToken`, `isNotOpeningParenToken` | [`is_opening_paren_token`], [`is_not_opening_paren_token`] |
//! | `isClosingParenToken`, `isNotClosingParenToken` | [`is_closing_paren_token`], [`is_not_closing_paren_token`] |
//! | `isOpeningBracketToken`, `isNotOpeningBracketToken` | [`is_opening_bracket_token`], [`is_not_opening_bracket_token`] |
//! | `isClosingBracketToken`, `isNotClosingBracketToken` | [`is_closing_bracket_token`], [`is_not_closing_bracket_token`] |
//! | `isOpeningBraceToken`, `isNotOpeningBraceToken` | [`is_opening_brace_token`], [`is_not_opening_brace_token`] |
//! | `isClosingBraceToken`, `isNotClosingBraceToken` | [`is_closing_brace_token`], [`is_not_closing_brace_token`] |
//! | `isCommentToken`, `isNotCommentToken` | [`is_comment_token`], [`is_not_comment_token`] |
//!
//! What `getStaticValue` needs of JavaScript's numbers is of use on its own: [`js_number`].
//!
//! No function takes a `sourceCode`: every handle knows its file.
//!
//! The token predicates take `&Token`, which is what `Iterator::find` and `Iterator::filter` pass:
//! `file.tokens_after(node).find(is_comma_token)`. For a token at hand it is `is_comma_token(&token)`.

mod builtins;
mod calls;
mod find_variable;
mod get_function_head_location;
mod get_function_name_with_kind;
mod get_property_name;
mod get_static_value;
mod get_string_if_constant;
mod has_side_effect;
mod is_parenthesized;
pub mod js_number;
mod js_string;
mod operators;
mod pattern_matcher;
mod reference_tracker;
mod static_value;
mod token_predicate;

pub use builtins::Builtin;
pub use find_variable::{find_variable, find_variable_of, get_innermost_scope};
pub use get_function_head_location::get_function_head_location;
pub use get_function_name_with_kind::get_function_name_with_kind;
pub use get_property_name::{get_property_name, property_name_of_key};
pub use get_static_value::get_static_value;
pub use get_string_if_constant::get_string_if_constant;
pub use has_side_effect::{HasSideEffectOptions, has_side_effect};
pub use is_parenthesized::{is_parenthesized, is_parenthesized_times};
pub use pattern_matcher::PatternMatcher;
pub use reference_tracker::{Mode, ReferenceKind, ReferenceTracker, TraceMap, TrackedReference};
pub use static_value::{IteratorKind, PropertyKey, StaticSymbol, StaticValue};
pub use token_predicate::*;
