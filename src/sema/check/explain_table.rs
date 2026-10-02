//! For which errors the arguments of the message can be read off the source: the name or the string the error is reported on.
//!
//! A STAND-IN: a report says its arguments where it is made. What is left is who still reports these without. A row goes with its last
//! such report, and the file with its last row.
//! * S1: `declareSymbol`, `reportMergeSymbolError`: 2300 2451
//! * T12: `checkReferenceExpression` and what is written to; private names; `infer`: 2539 2540 2588 2628 2629 2630 2631 2632 2838
//! * W1, with 23: binder.go: 1100 1210 1212 1213 1215 1262

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Source {
    /// The name, keyword or number at the start of the error.
    Name,
}

use Source::Name;

/// Where each argument of the message of `code` comes from. Empty: not from the source.
pub(super) fn sources(code: u32) -> &'static [Source] {
    match TABLE.binary_search_by_key(&code, |row| row.0) {
        Ok(i) => TABLE[i].1,
        Err(_) => &[],
    }
}

#[rustfmt::skip]
static TABLE: &[(u32, &[Source])] = &[
    (2300, &[Name]),
    (2451, &[Name]),
    (2539, &[Name]),
    (2540, &[Name]),
    (2588, &[Name]),
    (2628, &[Name]),
    (2629, &[Name]),
    (2630, &[Name]),
    (2631, &[Name]),
    (2632, &[Name]),
    (2838, &[Name]),
];
