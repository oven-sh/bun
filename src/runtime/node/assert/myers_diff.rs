//! ## IMPORTANT NOTE
//!
//! Do _NOT_ import from "bun" in this file! Do _NOT_ use the Bun object in this file!
//!
//! This file has tests defined in it which _cannot_ be run if `@import("bun")` is used!
//!
//! Run tests with `cargo test -p bun_runtime myers_diff`

use core::marker::PhantomData;

// Positions are stored as u32, which halves the memory of a level.
const MAXLEN: u64 = u32::MAX as u64;
// Bounds the work of a diff and the changes it prints. Node limits only the length of the inputs.
const MAX_LEVELS_TIMES_DIAGONALS: usize = 16 * 1024 * 1024;
// Type aliasing to make future refactors easier
#[allow(non_camel_case_types)]
type uint = u32;
#[allow(non_camel_case_types)]
type int = i64; // must be large enough to hold all valid values of `uint` w/o overflow.

/// `Differ` needs a per-`Line`-type equality function (char `==` for
/// `u8`/`u16`, string-line equality for slice types) and a way to detect
/// "is this a pointer/slice" inside `backtrack`. Both are expressed via this
/// trait — implement it for any new line type.
pub(crate) trait Line: Copy {
    /// Whether this line type is a pointer/slice type.
    const IS_POINTER: bool;
    /// Equality with optional trailing-comma tolerance.
    fn line_eq<const CHECK_COMMA_DISPARITY: bool>(a: Self, b: Self) -> bool;
    /// `self[self.len - 1] == ','` for slice types; always `false` for chars.
    fn ends_with_comma(self) -> bool;
}

impl Line for u8 {
    const IS_POINTER: bool = false;
    #[inline]
    fn line_eq<const CHECK_COMMA_DISPARITY: bool>(a: Self, b: Self) -> bool {
        a == b
    }
    #[inline]
    fn ends_with_comma(self) -> bool {
        false
    }
}

impl Line for u16 {
    const IS_POINTER: bool = false;
    #[inline]
    fn line_eq<const CHECK_COMMA_DISPARITY: bool>(a: Self, b: Self) -> bool {
        a == b
    }
    #[inline]
    fn ends_with_comma(self) -> bool {
        false
    }
}

impl<'a> Line for &'a [u8] {
    const IS_POINTER: bool = true;
    #[inline]
    fn line_eq<const CHECK_COMMA_DISPARITY: bool>(a: Self, b: Self) -> bool {
        are_str_lines_equal::<u8, CHECK_COMMA_DISPARITY>(a, b)
    }
    #[inline]
    fn ends_with_comma(self) -> bool {
        matches!(self.last(), Some(&b','))
    }
}

impl<'a> Line for &'a [u16] {
    const IS_POINTER: bool = true;
    #[inline]
    fn line_eq<const CHECK_COMMA_DISPARITY: bool>(a: Self, b: Self) -> bool {
        are_str_lines_equal::<u16, CHECK_COMMA_DISPARITY>(a, b)
    }
    #[inline]
    fn ends_with_comma(self) -> bool {
        matches!(self.last(), Some(&c) if c == u16::from(b','))
    }
}
// All borrowed byte/char-slice variants coerce to `&[u8]`/`&[u16]`, so the
// two slice impls above cover them.

/// diffs two sets of lines, returning the minimal number of edits needed to
/// make them equal.
///
/// Lines may be string slices or chars. Derived from node's implementation of
/// the Myers' diff algorithm.
///
/// ## Example
/// ```ignore
/// use myers_diff::Differ;
/// type StrDiffer = Differ<&[u8], false>;
/// let actual: &[&[u8]] = &[b"foo", b"bar", b"baz"];
/// let expected: &[&[u8]] = &[b"foo", b"barrr", b"baz"];
/// let diff = StrDiffer::diff(actual, expected)?;
/// ```
///
/// TODO: support non-ASCII UTF-8 characters.
///
/// ## References
/// - [Node- `myers_diff.js`](https://github.com/nodejs/node/blob/main/lib/internal/assert/myers_diff.js)
/// - [An O(ND) Difference Algorithm and Its Variations](http://www.xmailserver.org/diff2.pdf)
///
/// The `eql` dispatch is the `Line` trait. To supply a custom equality
/// function, implement `Line` for your type.
pub(crate) struct Differ<L, const CHECK_COMMA_DISPARITY: bool = false>(PhantomData<L>);

impl<L: Line, const CHECK_COMMA_DISPARITY: bool> Differ<L, CHECK_COMMA_DISPARITY> {
    #[inline]
    fn eql(a: L, b: L) -> bool {
        L::line_eq::<CHECK_COMMA_DISPARITY>(a, b)
    }

    /// Compute the shortest edit path (diff) between two sets of lines.
    ///
    /// Returned `Diff` objects borrow from the input slices. Both `actual`
    /// and `expected` must outlive them.
    ///
    /// ## References
    /// - [Node- `myers_diff.js`](https://github.com/nodejs/node/blob/main/lib/internal/assert/myers_diff.js)
    /// - [An O(ND) Difference Algorithm and Its Variations](http://www.xmailserver.org/diff2.pdf)
    pub(crate) fn diff(actual: &[L], expected: &[L]) -> Result<DiffList<L>, Error> {
        let max = actual.len() + expected.len();
        if max as u64 > MAXLEN {
            return Err(Error::InputsTooLarge);
        }
        let max_levels = MAX_LEVELS_TIMES_DIAGONALS / (2 * max + 1);

        // `trace[d]` is the state before edit level `d` is searched.
        let mut trace: Vec<Level> = vec![Level {
            low: 1,
            furthest: vec![0],
        }];
        let mut low: int = 0;
        let mut high: int = 0;

        while trace.len() <= max_levels {
            let width = us((high - low) / 2) + 1;
            let previous = &trace[trace.len() - 1];
            let first_above = previous.index_above(low);
            let mut furthest: Vec<uint> = Vec::with_capacity(width);
            let mut next_low = low - 1;
            let mut next_high = high + 1;

            for idx in 0..width {
                let diag_idx = low + 2 * i(idx);
                let above = first_above + idx;
                let mut x = if previous.comes_from_above(above) {
                    previous.furthest[above] as usize
                } else {
                    previous.furthest[above - 1] as usize + 1
                };
                let mut y = us(i(x) - diag_idx);

                while x < actual.len() && y < expected.len() && Self::eql(actual[x], expected[y]) {
                    x += 1;
                    y += 1;
                }
                furthest.push(u(x));

                // After a diagonal has used up an input, no shortest path continues along it or beyond it.
                if x == actual.len() {
                    if y == expected.len() {
                        return Ok(Self::backtrack(&trace, actual, expected));
                    }
                    next_high = diag_idx - 1;
                    break;
                }
                if y == expected.len() {
                    next_low = diag_idx + 1;
                }
            }

            trace.push(Level { low, furthest });
            low = next_low;
            high = next_high;
        }

        Err(Error::DiffTooLarge)
    }

    fn backtrack(trace: &[Level], actual: &[L], expected: &[L]) -> DiffList<L> {
        let mut x = i(actual.len());
        let mut y = i(expected.len());

        let mut result: DiffList<L> = Vec::new();

        for (diff_level, level) in trace.iter().enumerate().rev() {
            let above = level.index_above(x - y);
            let idx = if level.comes_from_above(above) {
                above
            } else {
                above - 1
            };

            let prev_x: int = i(level.furthest[idx]);
            let prev_y: int = prev_x - (level.low + 2 * i(idx));

            result.reserve(us((x - prev_x).max(y - prev_y)));
            while x > prev_x && y > prev_y {
                let line: L = 'blk: {
                    if L::IS_POINTER && CHECK_COMMA_DISPARITY {
                        let actual_el = actual[us(x) - 1];
                        // actual[x-1].endsWith(',')
                        break 'blk if actual_el.ends_with_comma() {
                            actual[us(x) - 1]
                        } else {
                            expected[us(y) - 1]
                        };
                    } else {
                        break 'blk actual[us(x) - 1];
                    }
                };

                result.push(Diff {
                    kind: DiffKind::Equal,
                    value: line,
                });
                x -= 1;
                y -= 1;
            }
            if diff_level > 0 {
                if x > prev_x {
                    result.push(Diff {
                        kind: DiffKind::Insert,
                        value: actual[us(x) - 1],
                    });
                    x -= 1;
                } else {
                    result.push(Diff {
                        kind: DiffKind::Delete,
                        value: expected[us(y) - 1],
                    });
                    y -= 1;
                }
            }
        }

        result
    }
}

/// The furthest `x` on each diagonal (`x - y`) at one edit level, without
/// diagonals that no shortest path can still use. Node keeps every diagonal.
struct Level {
    low: int,
    /// `furthest[n]` is the furthest `x` on diagonal `low + 2 * n`.
    furthest: Vec<uint>,
}

impl Level {
    /// Index in `furthest` of diagonal `diagonal + 1`, past the end if that one is not kept.
    /// Diagonal `diagonal - 1` is one before it.
    #[inline]
    fn index_above(&self, diagonal: int) -> usize {
        us((diagonal + 1 - self.low) / 2)
    }

    /// Whether the diagonal between those at `above - 1` and `above` is entered from the one at
    /// `above`: it is the only one of the two that is kept, or it reaches strictly further.
    #[inline]
    fn comes_from_above(&self, above: usize) -> bool {
        above == 0
            || (above < self.furthest.len() && self.furthest[above - 1] < self.furthest[above])
    }
}

// shorthands for int casting
#[inline]
fn u<N: TryInto<uint>>(n: N) -> uint
where
    N::Error: core::fmt::Debug,
{
    n.try_into().expect("infallible: size matches")
}
#[inline]
fn us<N: TryInto<usize>>(n: N) -> usize
where
    N::Error: core::fmt::Debug,
{
    n.try_into().expect("infallible: size matches")
}
#[inline]
fn i<N: TryInto<int>>(n: N) -> int
where
    N::Error: core::fmt::Debug,
{
    n.try_into().expect("infallible: size matches")
}

// =============================================================================
// ============================ EQUALITY FUNCTIONS ============================
// =============================================================================

#[cfg(test)]
#[inline]
fn are_lines_equal<L: Line, const CHECK_COMMA_DISPARITY: bool>(a: L, b: L) -> bool {
    L::line_eq::<CHECK_COMMA_DISPARITY>(a, b)
}

fn are_str_lines_equal<C, const CHECK_COMMA_DISPARITY: bool>(a: &[C], b: &[C]) -> bool
where
    C: PartialEq + Copy + From<u8>,
{
    // Hypothesis: unlikely to be the same, since assert.equal, etc. is rarely
    // used to compare the same object. May be true on shallow copies.
    // TODO: check Godbolt
    // if (a.ptr == b.ptr) return true;

    if !CHECK_COMMA_DISPARITY {
        return a == b;
    }

    let (largest, smallest) = if a.len() > b.len() { (a, b) } else { (b, a) };
    match largest.len() - smallest.len() {
        0 => a == b,
        1 => largest[largest.len() - 1] == C::from(b',') && largest[0..smallest.len()] == *smallest, // 'foo,' == 'foo'
        _ => false,
    }
}

// =============================================================================
// =================================== TYPES ===================================
// =============================================================================

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Error {
    #[error("DiffTooLarge")]
    DiffTooLarge,
    #[error("InputsTooLarge")]
    InputsTooLarge,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum DiffKind {
    Insert,
    Delete,
    Equal,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Diff<T> {
    pub(crate) kind: DiffKind,
    pub value: T,
}

pub(crate) type DiffList<T> = Vec<Diff<T>>;

// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_are_lines_equal() {
        // check_comma_disparity is never respected when comparing chars
        assert!(are_lines_equal::<u8, false>(b'a', b'a'));
        assert!(are_lines_equal::<u8, true>(b'a', b'a'));
        assert!(!are_lines_equal::<u8, false>(b',', b'a'));
        assert!(!are_lines_equal::<u8, true>(b',', b'a'));

        // strings w/o comma check
        assert!(are_lines_equal::<&[u8], false>(b"", b""));
        assert!(are_lines_equal::<&[u8], false>(b"a", b"a"));
        assert!(are_lines_equal::<&[u8], false>(b"Bun", b"Bun"));
        assert!(are_lines_equal::<&[u8], false>(
            "😤".as_bytes(),
            "😤".as_bytes()
        ));
        // not equal
        assert!(!are_lines_equal::<&[u8], false>(b"", b"a"));
        assert!(!are_lines_equal::<&[u8], false>(b"", b" "));
        assert!(!are_lines_equal::<&[u8], false>(b"\n", b"\t"));
        assert!(!are_lines_equal::<&[u8], false>(b"bun", b"Bun"));
        assert!(!are_lines_equal::<&[u8], false>(
            "😤".as_bytes(),
            "😩".as_bytes()
        ));

        // strings w/ comma check
        assert!(are_lines_equal::<&[u8], true>(b"", b""));
        assert!(are_lines_equal::<&[u8], true>(b"", b","));
        assert!(are_lines_equal::<&[u8], true>(b" ", b" ,"));
        assert!(are_lines_equal::<&[u8], true>(b"I am speed", b"I am speed"));
        assert!(are_lines_equal::<&[u8], true>(
            b"I am speed,",
            b"I am speed"
        ));
        assert!(are_lines_equal::<&[u8], true>(
            b"I am speed",
            b"I am speed,"
        ));
        assert!(are_lines_equal::<&[u8], false>(
            "😤".as_bytes(),
            "😤".as_bytes()
        ));
        // assert!(are_lines_equal::<&[u8], false>("😤".as_bytes(), "😤,".as_bytes()));
        // assert!(are_lines_equal::<&[u8], false>("😤,".as_bytes(), "😤".as_bytes()));
        // not equal
        assert!(!are_lines_equal::<&[u8], true>(b"", b"Bun"));
        assert!(!are_lines_equal::<&[u8], true>(b"bun", b"Bun"));
        assert!(!are_lines_equal::<&[u8], true>(b",Bun", b"Bun"));
        assert!(!are_lines_equal::<&[u8], true>(b"Bun", b",Bun"));
        assert!(!are_lines_equal::<&[u8], true>(b"", b" ,"));
        assert!(!are_lines_equal::<&[u8], true>(b" ", b" , "));
        assert!(!are_lines_equal::<&[u8], true>(
            b"I, am speed",
            b"I am speed"
        ));
        assert!(!are_lines_equal::<&[u8], true>(
            ",😤".as_bytes(),
            "😤".as_bytes()
        ));
    }

    type StrDiffer<'a> = Differ<&'a [u8], true>;

    #[test]
    fn test_str_differ() {
        let cases: &[(&str, &str)] = &[
            ("foo", "foo"),
            ("foo", "bar"),
            (
                // actual
                "[\n  1,\n  2,\n  3,\n  4,\n  5,\n  6,\n  7\n]",
                // expected
                "[\n  1,\n  2,\n  3,\n  4,\n  5,\n  9,\n  7\n]",
            ),
            // remove line
            (
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\nincididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis\nnostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\nfugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in\nculpa qui officia deserunt mollit anim id est laborum.",
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\nincididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\nfugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in\nculpa qui officia deserunt mollit anim id est laborum.",
            ),
            // add some line
            (
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\nincididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis\nnostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\nfugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in\nculpa qui officia deserunt mollit anim id est laborum.",
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\nincididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis\nLorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\nnostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\nfugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in\nculpa qui officia deserunt mollit anim id est laborum.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu",
            ),
            // modify lines
            ("foo\nbar\nbaz", "foo\nbarrr\nbaz"),
            ("foooo\nbar\nbaz", "foo\nbar\nbaz"),
            ("foo\nbar\nbaz", "foo\nbar\nbaz"),
            (
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor\nincididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis\nnostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\nfugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in\nculpa qui officia deserunt mollit anim id est laborum.",
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor modified\nincididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis\nnostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\nfugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in also modified\nculpa qui officia deserunt mollit anim id est laborum.",
            ),
        ];

        for thing in cases {
            let actual = split(thing.0.as_bytes());
            let expected = split(thing.1.as_bytes());
            let _d = StrDiffer::diff(&actual, &expected).unwrap();
        }
    }
}

pub(crate) fn split<T>(s: &[T]) -> Vec<&[T]>
where
    T: PartialEq + Copy + From<u8>,
{
    // The From<u8> bound restricts T to char-like types (need to compare
    // against '\n').
    let newline: T = T::from(b'\n');
    //
    // thing
    let mut lines: Vec<&[T]> = Vec::with_capacity(s.len() >> 4);
    for l in s.split(|c| *c == newline) {
        lines.push(l);
    }
    lines
}
