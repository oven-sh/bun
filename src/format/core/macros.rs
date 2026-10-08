//! `write!`, `format_args!` and `best_fitting!`.

/// Several things to write, as one. The arguments are evaluated at once and borrowed.
///
/// ```ignore
/// group(&format_args!("(", soft_block_indent(&content), ")"))
/// ```
macro_rules! format_args {
    ($($value:expr),+ $(,)?) => {
        $crate::core::formatter::Arguments(($(&$value,)+))
    };
}
pub(crate) use format_args;

/// Writes the arguments to a [`Formatter`](crate::core::formatter::Formatter). All of them are
/// evaluated before the first is written.
///
/// ```ignore
/// write!(f, ["if", space(), "(", test, ")"]);
/// write!(f, test);
/// ```
macro_rules! write {
    ($dst:expr, [$($arg:expr),+ $(,)?]) => {
        $crate::core::formatter::Format::fmt(&$crate::core::macros::format_args!($($arg),+), $dst)
    };
    ($dst:expr, $arg:expr) => {
        $crate::core::formatter::Format::fmt(&$arg, $dst)
    };
}
pub(crate) use write;

/// Several ways to write the same thing, from the flattest to the most expanded. The printer takes
/// the first that fits on the line up to its first line break, or else the last.
///
/// Every variant is formatted, so what they have in common should be `memoized()`. Comments can
/// only be written once: see `src/format/CLAUDE.md`.
macro_rules! best_fitting {
    ($least_expanded:expr, $($tail:expr),+ $(,)?) => {
        $crate::core::builders::BestFitting::new(&[&$least_expanded, $(&$tail),+])
    };
}
pub(crate) use best_fitting;
