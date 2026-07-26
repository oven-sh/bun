//! ## IMPORTANT NOTE
//!
//! Do _NOT_ import from "bun" in this file! Do _NOT_ use the Bun object in this file!
//!
//! This file has tests defined in it which _cannot_ be run if `@import("bun")` is used!
//!
//! Run tests with `cargo test -p bun_runtime myers_diff`

use core::fmt;
use core::marker::PhantomData;

// By limiting maximum string and buffer lengths, we can store u32s in the
// edit graph instead of usize's, halving our memory footprint. The
// downside is that `(2 * (actual.len + expected.len))` must be less than
// 4Gb. If this becomes a problem in real user scenarios, we can adjust this.
//
// Note that overflows are much more likely to occur in real user scenarios
// than in our own testing, so overflow checks _must_ be handled. Do _not_
// use `assert` unless you also use `@setRuntimeSafety(true)`.
const MAXLEN: u64 = u32::MAX as u64;
const MAX_TRACE_BYTES: usize = 64 * 1024 * 1024;
// Type aliasing to make future refactors easier
#[allow(non_camel_case_types)]
type uint = u32;
#[allow(non_camel_case_types)]
type int = i64; // must be large enough to hold all valid values of `uint` w/o overflow.

/// `Differ` needs a per-`Line`-type equality function (char `==` for
/// `u8`/`u16`, string-line equality for slice types) and a way to detect
/// "is this a pointer/slice" inside `backtrack`. Both are expressed via this
/// trait — implement it for any new line type.
pub trait Line: Copy {
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
pub struct Differ<L, const CHECK_COMMA_DISPARITY: bool = false>(PhantomData<L>);

impl<L: Line, const CHECK_COMMA_DISPARITY: bool> Differ<L, CHECK_COMMA_DISPARITY> {
    // `V = [-MAX, MAX]`.

    #[inline]
    pub(crate) fn eql(a: L, b: L) -> bool {
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
        // const MAX \in [0, M+N]
        // let V: int array = [-MAX..MAX]. V is a flattened representation of the edit graph.
        let (max, graph_size): (uint, uint) = 'blk: {
            // This is to preserve overflow protections even when runtime safety
            // checks are disabled. We don't know what kind of stuff users are
            // diffing in the wild.
            let _max: usize = actual.len() + expected.len();
            let _graph_size: usize = (2 * _max) + 1;

            if (_max as u64) > MAXLEN {
                return Err(Error::InputsTooLarge);
            }
            if (_graph_size as u64) > MAXLEN {
                return Err(Error::DiffTooLarge);
            }

            // const m:

            break 'blk (
                u32::try_from(_max).expect("int cast"),
                u32::try_from(_graph_size).expect("int cast"),
            );
        };

        let mut graph: Vec<uint> = vec![0; graph_size as usize];

        let mut trace: Vec<Box<[uint]>> = Vec::new();
        // reserve enough space for each frame to avoid realloc on ptr list. Lists may end up in the heap, but
        // this list is at the very from (and ∴ on stack).
        trace.reserve_exact((max as usize) + 1);

        // ================================================================
        // ==================== actual implementation =====================
        // ================================================================

        for _diff_level in 0..=(max as usize) {
            let diff_level: int = i64::try_from(_diff_level).expect("int cast"); // why is this always usize?
            let trace_bytes = (_diff_level + 1)
                .saturating_mul(graph_size as usize)
                .saturating_mul(core::mem::size_of::<uint>());
            if trace_bytes > MAX_TRACE_BYTES {
                return Err(Error::DiffTooLarge);
            }
            let new_trace: Box<[uint]> = graph.clone().into_boxed_slice();
            trace.push(new_trace);

            let diag_start: int = -diff_level;
            let diag_end: int = diff_level;

            // for k ← -D in steps of 2 do
            let mut diag_idx = diag_start;
            while diag_idx <= diag_end {
                // if k = -D or K ≠ D and V[k-1] < V[k+1] then
                //     x ← V[k+1]
                // else
                //     x ← V[k-1] + 1
                debug_assert!(diag_idx + i64::from(max) >= 0); // sanity check. Fine to be stripped in release.
                let k: uint = u(diag_idx + i64::from(max));

                let uk = k as usize;
                let mut x: uint = if diag_idx == diag_start
                    || (diag_idx != diag_end && graph[uk - 1] < graph[uk + 1])
                {
                    graph[uk + 1]
                } else {
                    graph[uk - 1] + 1
                };

                // y = x - diag_idx
                let mut y: usize = 'blk: {
                    let x2: int = i64::from(x);
                    let y: int = x2 - diag_idx;
                    debug_assert!(y >= 0 && (y as u64) <= MAXLEN); // sanity check. Fine to be stripped in release.
                    break 'blk usize::try_from(y).expect("int cast");
                };

                while (x as usize) < actual.len()
                    && y < expected.len()
                    && Self::eql(actual[x as usize], expected[y])
                {
                    x += 1;
                    y += 1;
                }
                graph[k as usize] = x;
                if (x as usize) >= actual.len() && y >= expected.len() {
                    // todo: arena
                    return Self::backtrack(&trace, actual, expected);
                }

                diag_idx += 2;
            }
        }

        unreachable!(
            "unreachable. Diffing should always reach the end of either `actual` or `expected` first."
        );
    }

    fn backtrack(
        trace: &[Box<[uint]>],
        actual: &[L],
        expected: &[L],
    ) -> Result<DiffList<L>, Error> {
        let max = i(actual.len() + expected.len());
        let mut x = i(actual.len());
        let mut y = i(expected.len());

        let mut result: DiffList<L> = Vec::new();
        if trace.is_empty() {
            return Ok(result);
        }

        // for (let diffLevel = trace.length - 1; diffLevel >= 0; diffLevel--) {
        let mut diff_level: usize = trace.len();
        while diff_level > 0 {
            diff_level -= 1;
            let graph = &trace[diff_level];
            let diagonal_index: int = x - y;

            let diag_offset = u(diagonal_index + max);
            let prev_diagonal_index: int = if diagonal_index == -i(diff_level)
                || (diagonal_index != i(diff_level)
                    && graph[us(diag_offset - 1)] < graph[us(diag_offset + 1)])
            {
                diagonal_index + 1
            } else {
                diagonal_index - 1
            };

            let prev_x: int = i(graph[us(prev_diagonal_index + max)]); // v[prevDiagonalIndex + max]
            let prev_y: int = prev_x - prev_diagonal_index;

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

        Ok(result)
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
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::oom_from_alloc!(Error);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DiffKind {
    Insert,
    Delete,
    Equal,
}

impl fmt::Display for DiffKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DiffKind::Insert => f.write_str("+"),
            DiffKind::Delete => f.write_str("-"),
            DiffKind::Equal => f.write_str(" "),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Diff<T> {
    pub kind: DiffKind,
    pub value: T,
}

impl<T: fmt::Display> fmt::Display for Diff<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // For `&[u8]` callers, wrap `value` in `bstr::BStr::new` at the call
        // site to get string (rather than byte-array) output.
        write!(f, "{} {}", self.kind, self.value)
    }
}

pub type DiffList<T> = Vec<Diff<T>>;

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

pub fn split<T>(s: &[T]) -> Vec<&[T]>
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
