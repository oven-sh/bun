use core::cmp::Ordering;

use bun_highway::text as kernels;
use bun_pod::slice_as_bytes;

use crate::block::{self, Pairs, Positions, block, quarters, singles, unordered_quarters};
use crate::{CodeUnit, Text, with_text};

const _: () = assert!(cfg!(target_endian = "little"));

/// How many units are compared before a kernel takes over.
const SHORT: usize = kernels::MINIMUM_LENGTH;

#[inline(always)]
fn word32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(*block(bytes, at))
}

#[inline(always)]
fn two_words32(bytes: &[u8], low: usize, high: usize) -> u64 {
    u64::from(word32(bytes, low)) | u64::from(word32(bytes, high)) << u32::BITS
}

#[inline(always)]
fn word64(bytes: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(*block(bytes, at))
}

#[inline(always)]
fn equal_bytes(a: &[u8], b: &[u8]) -> bool {
    let length = a.len();
    if length != b.len() {
        return false;
    }
    if length == 0 || a[0] != b[0] {
        return length == 0;
    }
    if length < 4 {
        (a[length / 2] == b[length / 2]) & (a[length - 1] == b[length - 1])
    } else if length <= 16 {
        let [p, q, r, s] = unordered_quarters(length);
        (two_words32(a, p, q) ^ two_words32(b, p, q))
            | (two_words32(a, r, s) ^ two_words32(b, r, s))
            == 0
    } else if length <= 32 {
        !Pairs::new(a, b, |a, b| a != b).any_in([0, length - 16])
    } else {
        equal_long_bytes(a, b)
    }
}

/// More than 32 bytes, as many in both.
#[inline(never)]
fn equal_long_bytes(a: &[u8], b: &[u8]) -> bool {
    let differing = Pairs::new(a, b, |a, b| a != b);
    let length = differing.len();
    if length <= 64 {
        !differing.any_in([0, 16, length - 32, length - 16])
    } else if length <= 3 * SHORT {
        !block::any_of_many(differing)
    } else {
        !differing.any_in([0]) && kernels::find_difference(a, b).is_none()
    }
}

#[inline(always)]
fn first_difference<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> Option<usize> {
    let differ = |a: A, b: B| a.to_u16() != b.to_u16();
    block::first_or_else(Pairs::new(a, b, differ), SHORT, |at| {
        let at = at.min(a.len().min(b.len()) - SHORT);
        let found = match (A::text(&a[at..]), B::text(&b[at..])) {
            (Text::Latin1(a), Text::Latin1(b)) => kernels::find_difference(a, b),
            (Text::Utf16(a), Text::Utf16(b)) => {
                kernels::find_difference(slice_as_bytes(a), slice_as_bytes(b)).map(|byte| byte / 2)
            }
            (Text::Latin1(a), Text::Utf16(b)) | (Text::Utf16(b), Text::Latin1(a)) => {
                kernels::find_difference_from_latin1(b, a)
            }
        };
        found.map(|index| at + index)
    })
}

/// Whether the units have the same values.
#[inline(always)]
pub fn equal_units<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> bool {
    if A::IS_LATIN1 == B::IS_LATIN1 {
        equal_bytes(slice_as_bytes(a), slice_as_bytes(b))
    } else {
        a.len() == b.len()
            && a.first().map(|it| it.to_u16()) == b.first().map(|it| it.to_u16())
            && (a.len() <= 1 || equal_across_widths(a, b))
    }
}

#[inline(never)]
fn equal_across_widths<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> bool {
    first_difference(a, b).is_none()
}

/// How many units both start with.
#[inline]
pub fn common_prefix_len<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> usize {
    first_difference(a, b).unwrap_or_else(|| a.len().min(b.len()))
}

/// Numbers in the order of two words of units, whose lowest unit comes first.
#[inline(always)]
fn sort_keys<T: CodeUnit>(a: u64, b: u64) -> (u64, u64) {
    if T::IS_LATIN1 {
        return (a.swap_bytes(), b.swap_bytes());
    }
    let shift = (a ^ b).trailing_zeros() & 48;
    (a >> shift & 0xffff, b >> shift & 0xffff)
}

/// Numbers in the order of as many units of the same width, of which the first are equal, unless they take more
/// than 16 bytes and the first 8 are equal.
#[inline(always)]
fn short_sort_keys<T: CodeUnit>(a: &[u8], b: &[u8]) -> Option<(u64, u64)> {
    let length = a.len();
    if length < 4 {
        let [_, p, q] = singles(length);
        let (x, y) = if a[p] == b[p] {
            (a[q], b[q])
        } else {
            (a[p], b[p])
        };
        return Some((u64::from(x), u64::from(y)));
    }
    if length > 16 {
        let (a, b) = (word64(a, 0), word64(b, 0));
        return (a != b).then(|| sort_keys::<T>(a, b));
    }
    let [p, q, r, s] = quarters(length);
    let (mut x, mut y) = (two_words32(a, p, q), two_words32(b, p, q));
    if x == y {
        (x, y) = (two_words32(a, r, s), two_words32(b, r, s));
    }
    Some(sort_keys::<T>(x, y))
}

#[inline(never)]
fn compare_long<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> Ordering {
    let difference = if A::IS_LATIN1 == B::IS_LATIN1 {
        first_difference(slice_as_bytes(a), slice_as_bytes(b)).map(|byte| byte / size_of::<A>())
    } else {
        first_difference(a, b)
    };
    match difference {
        Some(at) => a[at].to_u16().cmp(&b[at].to_u16()),
        None => a.len().cmp(&b.len()),
    }
}

#[inline(always)]
fn compare_units<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> Ordering {
    let length = a.len().min(b.len());
    if length == 0 {
        return a.len().cmp(&b.len());
    }
    if a[0].to_u16() != b[0].to_u16() {
        return a[0].to_u16().cmp(&b[0].to_u16());
    }
    if A::IS_LATIN1 == B::IS_LATIN1
        && let Some((x, y)) =
            short_sort_keys::<A>(slice_as_bytes(&a[..length]), slice_as_bytes(&b[..length]))
    {
        return if x == y {
            a.len().cmp(&b.len())
        } else {
            x.cmp(&y)
        };
    }
    if A::IS_LATIN1 == B::IS_LATIN1 || length > 1 {
        return compare_long(a, b);
    }
    a.len().cmp(&b.len())
}

#[inline(always)]
fn differ_ignoring_ascii_case<A: CodeUnit, B: CodeUnit>(a: A, b: B) -> bool {
    a.to_ascii_lower().to_u16() != b.to_ascii_lower().to_u16()
}

#[inline]
pub(crate) fn equal_units_ignoring_ascii_case<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> bool {
    a.len() == b.len() && !block::any(Pairs::new(a, b, differ_ignoring_ascii_case))
}

impl Text<'_> {
    #[inline(always)]
    pub fn eq_ascii(self, ascii: &str) -> bool {
        debug_assert!(ascii.is_ascii());
        with_text!(self, |units| equal_units(units, ascii.as_bytes()))
    }

    #[inline(always)]
    pub fn eq_ignore_ascii_case(self, other: Text<'_>) -> bool {
        with_text!(self, |a| with_text!(other, |b| {
            equal_units_ignoring_ascii_case(a, b)
        }))
    }

    #[inline(always)]
    pub fn starts_with(self, prefix: Text<'_>) -> bool {
        self.len() >= prefix.len() && self.slice(0..prefix.len()) == prefix
    }

    #[inline(always)]
    pub fn ends_with(self, suffix: Text<'_>) -> bool {
        self.len() >= suffix.len() && self.slice_from(self.len() - suffix.len()) == suffix
    }

    #[inline(always)]
    pub fn starts_with_ignore_ascii_case(self, prefix: Text<'_>) -> bool {
        self.len() >= prefix.len() && self.slice(0..prefix.len()).eq_ignore_ascii_case(prefix)
    }

    /// How many units both start with.
    #[inline(always)]
    pub fn common_prefix_len(self, other: Text<'_>) -> usize {
        with_text!(self, |a| with_text!(other, |b| common_prefix_len(a, b)))
    }
}

impl PartialEq<Text<'_>> for Text<'_> {
    #[inline(always)]
    fn eq(&self, other: &Text<'_>) -> bool {
        let (a, b) = match (*self, *other) {
            (Text::Latin1(a), Text::Latin1(b)) => (a, b),
            (Text::Utf16(a), Text::Utf16(b)) => (slice_as_bytes(a), slice_as_bytes(b)),
            (Text::Latin1(a), Text::Utf16(b)) | (Text::Utf16(b), Text::Latin1(a)) => {
                return equal_units(a, b);
            }
        };
        equal_bytes(a, b)
    }
}

impl Eq for Text<'_> {}

impl PartialOrd for Text<'_> {
    #[inline(always)]
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// By code unit, as IsLessThan of ECMA-262 compares strings.
impl Ord for Text<'_> {
    #[inline(always)]
    fn cmp(&self, other: &Self) -> Ordering {
        with_text!(*self, |a| with_text!(*other, |b| compare_units(a, b)))
    }
}
