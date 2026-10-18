//! Which functions a comment that switches a rule of React off is for: the condition of upstream's
//! `filter_suppressions_that_affect_function` (`react_compiler/entrypoint/suppression.rs`).
//!
//! The comments are found where the source is read: `js_parser/lexer.rs` for `bun build`, which then asks this in
//! `P::enter_react_compiler_candidate`, and `lint/react_compiler/suppression.rs` for `bun lint`.

/// Whether the suppression is within the function or wraps it.
///
/// `enable_end` is the end of the comment that ends the suppression. For `eslint-disable-next-line` that is the
/// comment itself. For `eslint-disable` there is none, because upstream's `find_program_suppressions` never lets an
/// `eslint-enable` end a range, and so it is for every function of the file, above the comment too.
pub fn suppression_affects_function(
    disable_start: u32,
    enable_end: Option<u32>,
    fn_start: u32,
    fn_end: u32,
) -> bool {
    (disable_start > fn_start && enable_end.is_none_or(|end| end < fn_end))
        || (disable_start < fn_start && enable_end.is_none_or(|end| end > fn_end))
}
