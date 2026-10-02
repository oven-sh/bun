//! For which errors the arguments of the message can be read off the source: the name or the string the error is reported on.
//!
//! A STAND-IN: a report says its arguments where it is made. What is left is who still reports these without. A row goes with its last
//! such report, and the file with its last row.
//! * P1, with 9 (`onFailedToResolveSymbol`) and 8 (`checkUnusedIdentifiers`): 2304 2311 2503 2585 2663 2693 2702 2708 2709 2749 2840 2863 2864 6133 6138 6196
//! * P1: modules and aliases: 1361 1362 2397 2437 2438 2661 2671 2686 5061
//! * S1: `declareSymbol`, `reportMergeSymbolError`: 2300 2451
//! * T12: `checkReferenceExpression` and what is written to; private names; `infer`: 2539 2540 2588 2628 2629 2630 2631 2632 2804 2838
//! * W1, with 23: binder.go: 1100 1210 1212 1213 1215 1262
//! * T09: what the parser and the JSDoc reader report on a token: 1042 2427 2457 8024 8029 18061

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Source {
    /// The name, keyword or number at the start of the error.
    Name,
    /// What is between the quotes of the string at the start of the error.
    StringContents,
}

use Source::{Name, StringContents};

/// Where each argument of the message of `code` comes from. Empty: not from the source.
pub(super) fn sources(code: u32) -> &'static [Source] {
    match TABLE.binary_search_by_key(&code, |row| row.0) {
        Ok(i) => TABLE[i].1,
        Err(_) => &[],
    }
}

#[rustfmt::skip]
static TABLE: &[(u32, &[Source])] = &[
    (1042, &[Name]),
    (1100, &[Name]),
    (1210, &[Name]),
    (1212, &[Name]),
    (1213, &[Name]),
    (1215, &[Name]),
    (1262, &[Name]),
    (1361, &[Name]),
    (1362, &[Name]),
    (2300, &[Name]),
    (2304, &[Name]),
    (2311, &[Name]),
    (2397, &[Name]),
    (2427, &[Name]),
    (2437, &[Name]),
    (2438, &[Name]),
    (2451, &[Name]),
    (2457, &[Name]),
    (2503, &[Name]),
    (2539, &[Name]),
    (2540, &[Name]),
    (2585, &[Name]),
    (2588, &[Name]),
    (2628, &[Name]),
    (2629, &[Name]),
    (2630, &[Name]),
    (2631, &[Name]),
    (2632, &[Name]),
    (2661, &[Name]),
    (2663, &[Name]),
    (2671, &[StringContents]),
    (2686, &[Name]),
    (2693, &[Name]),
    (2702, &[Name]),
    (2708, &[Name]),
    (2709, &[Name]),
    (2749, &[Name]),
    (2804, &[Name]),
    (2838, &[Name]),
    (2840, &[Name]),
    (2863, &[Name]),
    (2864, &[Name]),
    (5061, &[StringContents]),
    (6133, &[Name]),
    (6138, &[Name]),
    (6196, &[Name]),
    (8024, &[Name]),
    (8029, &[Name]),
    (18061, &[Name]),
];
