//! Kernels for long runs of Latin-1 characters (`u8`) and UTF-16 code units (`u16`). A shorter run than
//! [`MINIMUM_LENGTH`] is gone through one unit at a time: callers have their own way with those.

use core::mem::MaybeUninit;

/// `kMinimumLength` in highway_text.cpp.
pub const MINIMUM_LENGTH: usize = 64;

mod kernels {
    pub trait Kernels: Sized {
        const FIND_UNIT: unsafe extern "C" fn(*const Self, usize, Self) -> usize;
        const FIND_LAST_UNIT: unsafe extern "C" fn(*const Self, usize, Self) -> usize;
        const FIND_PAIR: unsafe extern "C" fn(
            *const Self,
            *const Self,
            usize,
            Self,
            Self,
        ) -> usize;
        const FIND_LAST_PAIR: unsafe extern "C" fn(
            *const Self,
            *const Self,
            usize,
            Self,
            Self,
        ) -> usize;
        const FIND_ABOVE: unsafe extern "C" fn(*const Self, usize, Self) -> usize;
        const FIND_IN_TABLES: unsafe extern "C" fn(*const Self, usize, *const u8) -> usize;
        const FIND_JSON_SPECIAL: unsafe extern "C" fn(*const Self, usize) -> usize;
        const COUNT_UNIT: unsafe extern "C" fn(*const Self, usize, Self) -> usize;
        const ESCAPE_JSON_FROM_8: EscapeJson<u8, Self>;
        const ESCAPE_JSON_FROM_16: EscapeJson<u16, Self>;

        fn escape_json_to<Out: Kernels>() -> EscapeJson<Self, Out>;
    }

    pub(super) type EscapeJson<In, Out> =
        unsafe extern "C" fn(*const In, usize, *mut Out, usize, *mut usize) -> usize;

    macro_rules! kernels {
        (
            $unit:ty, $find_unit:ident, $find_last_unit:ident, $find_pair:ident, $find_last_pair:ident,
            $find_above:ident, $find_in_tables:ident, $find_json_special:ident, $from_8:ident, $from_16:ident, $count_unit:path, $from_self:ident
        ) => {
            unsafe extern "C" {
                fn $find_unit(units: *const $unit, len: usize, unit: $unit) -> usize;
                fn $find_last_unit(units: *const $unit, len: usize, unit: $unit) -> usize;
                fn $find_pair(
                    a: *const $unit,
                    b: *const $unit,
                    len: usize,
                    x: $unit,
                    y: $unit,
                ) -> usize;
                fn $find_last_pair(
                    a: *const $unit,
                    b: *const $unit,
                    len: usize,
                    x: $unit,
                    y: $unit,
                ) -> usize;
                fn $find_above(units: *const $unit, len: usize, limit: $unit) -> usize;
                fn $find_in_tables(units: *const $unit, len: usize, tables: *const u8) -> usize;
                fn $find_json_special(units: *const $unit, len: usize) -> usize;
                fn $from_8(
                    from: *const u8,
                    len: usize,
                    to: *mut $unit,
                    room: usize,
                    written: *mut usize,
                ) -> usize;
                fn $from_16(
                    from: *const u16,
                    len: usize,
                    to: *mut $unit,
                    room: usize,
                    written: *mut usize,
                ) -> usize;
            }

            impl Kernels for $unit {
                const FIND_UNIT: unsafe extern "C" fn(*const Self, usize, Self) -> usize =
                    $find_unit;
                const FIND_LAST_UNIT: unsafe extern "C" fn(*const Self, usize, Self) -> usize =
                    $find_last_unit;
                const FIND_PAIR: unsafe extern "C" fn(
                    *const Self,
                    *const Self,
                    usize,
                    Self,
                    Self,
                ) -> usize = $find_pair;
                const FIND_LAST_PAIR: unsafe extern "C" fn(
                    *const Self,
                    *const Self,
                    usize,
                    Self,
                    Self,
                ) -> usize = $find_last_pair;
                const FIND_ABOVE: unsafe extern "C" fn(*const Self, usize, Self) -> usize =
                    $find_above;
                const FIND_IN_TABLES: unsafe extern "C" fn(*const Self, usize, *const u8) -> usize =
                    $find_in_tables;
                const FIND_JSON_SPECIAL: unsafe extern "C" fn(*const Self, usize) -> usize =
                    $find_json_special;
                const COUNT_UNIT: unsafe extern "C" fn(*const Self, usize, Self) -> usize =
                    $count_unit;
                const ESCAPE_JSON_FROM_8: EscapeJson<u8, Self> = $from_8;
                const ESCAPE_JSON_FROM_16: EscapeJson<u16, Self> = $from_16;

                #[inline(always)]
                fn escape_json_to<Out: Kernels>() -> EscapeJson<Self, Out> {
                    Out::$from_self
                }
            }
        };
    }

    unsafe extern "C" {
        fn highway_text_count_unit16(units: *const u16, len: usize, unit: u16) -> usize;
    }

    kernels!(
        u8,
        highway_text_find_unit8,
        highway_text_find_last_unit8,
        highway_text_find_pair8,
        highway_text_find_last_pair8,
        highway_text_find_above8,
        highway_text_find_in_tables8,
        highway_text_find_json_special8,
        highway_text_escape_json8_to8,
        highway_text_escape_json16_to8,
        crate::highway_count_char,
        ESCAPE_JSON_FROM_8
    );
    kernels!(
        u16,
        highway_text_find_unit16,
        highway_text_find_last_unit16,
        highway_text_find_pair16,
        highway_text_find_last_pair16,
        highway_text_find_above16,
        highway_text_find_in_tables16,
        highway_text_find_json_special16,
        highway_text_escape_json8_to16,
        highway_text_escape_json16_to16,
        highway_text_count_unit16,
        ESCAPE_JSON_FROM_16
    );
}

unsafe extern "C" {
    fn highway_text_find_difference8(a: *const u8, b: *const u8, len: usize) -> usize;
    fn highway_text_find_difference16_and8(a: *const u16, b: *const u8, len: usize) -> usize;
    fn highway_text_widen(from: *const u8, len: usize, to: *mut u16);
    fn highway_text_narrow(from: *const u16, len: usize, to: *mut u8);
}

/// `u8` or `u16`.
pub trait Unit: kernels::Kernels + Copy + Ord + Into<u16> {}

impl Unit for u8 {}
impl Unit for u16 {}

#[inline(always)]
fn is_short(len: usize) -> bool {
    cfg!(miri) || len < MINIMUM_LENGTH
}

#[inline(always)]
fn found(result: usize, len: usize) -> Option<usize> {
    (result < len).then_some(result)
}

#[inline(always)]
pub fn find_unit<T: Unit>(units: &[T], unit: T) -> Option<usize> {
    if is_short(units.len()) {
        return units.iter().position(|&it| it == unit);
    }
    // SAFETY: the kernel reads `units`, which are as many as it needs.
    let result = unsafe { T::FIND_UNIT(units.as_ptr(), units.len(), unit) };
    found(result, units.len())
}

#[inline(always)]
pub fn find_last_unit<T: Unit>(units: &[T], unit: T) -> Option<usize> {
    if is_short(units.len()) {
        return units.iter().rposition(|&it| it == unit);
    }
    // SAFETY: the kernel reads `units`, which are as many as it needs.
    let result = unsafe { T::FIND_LAST_UNIT(units.as_ptr(), units.len(), unit) };
    found(result, units.len())
}

/// The first index at which `a` has `x` and `b` has `y`.
#[inline(always)]
pub fn find_pair<T: Unit>(a: &[T], b: &[T], x: T, y: T) -> Option<usize> {
    let len = a.len().min(b.len());
    if is_short(len) {
        return (0..len).find(|&at| a[at] == x && b[at] == y);
    }
    // SAFETY: the kernel reads `len` units of both, which are as many as it needs.
    let result = unsafe { T::FIND_PAIR(a.as_ptr(), b.as_ptr(), len, x, y) };
    found(result, len)
}

/// The last index at which `a` has `x` and `b` has `y`.
#[inline(always)]
pub fn find_last_pair<T: Unit>(a: &[T], b: &[T], x: T, y: T) -> Option<usize> {
    let len = a.len().min(b.len());
    if is_short(len) {
        return (0..len).rfind(|&at| a[at] == x && b[at] == y);
    }
    // SAFETY: the kernel reads `len` units of both, which are as many as it needs.
    let result = unsafe { T::FIND_LAST_PAIR(a.as_ptr(), b.as_ptr(), len, x, y) };
    found(result, len)
}

/// The first unit that is greater than `limit`.
#[inline(always)]
pub fn find_above<T: Unit>(units: &[T], limit: T) -> Option<usize> {
    if is_short(units.len()) {
        return units.iter().position(|&it| it > limit);
    }
    // SAFETY: the kernel reads `units`, which are as many as it needs.
    let result = unsafe { T::FIND_ABOVE(units.as_ptr(), units.len(), limit) };
    found(result, units.len())
}

/// A set of bytes, and possibly more.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct ByteTable {
    /// Byte `b` is in it if `rows[b >> 4] & columns[b & 15]` is not zero.
    rows: [u8; 16],
    columns: [u8; 16],
}

impl ByteTable {
    /// With a bit for each byte. It is exact unless the 16 rows of 16 bytes have more than 8 patterns of members.
    pub fn new(members: &[u64; 4]) -> ByteTable {
        let (mut rows, mut columns) = ([0; 16], [0; 16]);
        let (mut patterns, mut count) = ([0; 8], 0);
        for (index, row) in rows.iter_mut().enumerate() {
            let pattern = (members[index / 4] >> (index % 4 * 16)) as u16;
            if pattern == 0 {
                continue;
            }
            let known = patterns[..count].iter().position(|&it| it == pattern);
            let bit = known.unwrap_or_else(|| count.min(7));
            if known.is_none() {
                (patterns[bit], count) = (pattern, bit + 1);
                for (index, column) in columns.iter_mut().enumerate() {
                    *column |= ((pattern >> index & 1) as u8) << bit;
                }
            }
            *row = 1 << bit;
        }
        ByteTable { rows, columns }
    }

    #[inline(always)]
    fn contains(&self, byte: u8) -> bool {
        self.rows[usize::from(byte >> 4)] & self.columns[usize::from(byte & 15)] != 0
    }
}

/// The first unit up to U+00FF that is in the first table, or above it with its high byte in the second and its low byte
/// in the third.
#[inline(always)]
pub fn find_in_tables<T: Unit>(units: &[T], tables: &[ByteTable; 3]) -> Option<usize> {
    if is_short(units.len()) {
        return units.iter().position(|&it| match it.into().to_be_bytes() {
            [0, low] => tables[0].contains(low),
            [high, low] => tables[1].contains(high) && tables[2].contains(low),
        });
    }
    // SAFETY: the kernel reads `units`, which are as many as it needs, and the 96 bytes of the tables.
    let result = unsafe { T::FIND_IN_TABLES(units.as_ptr(), units.len(), tables.as_ptr().cast()) };
    found(result, units.len())
}

/// The first quotation mark, backslash or control character below U+0020.
#[inline(always)]
pub fn find_json_special<T: Unit>(units: &[T]) -> Option<usize> {
    if is_short(units.len()) {
        return (units.iter()).position(|&it| matches!(it.into(), 0..0x20 | 0x22 | 0x5c));
    }
    // SAFETY: the kernel reads `units`, which are as many as it needs.
    let result = unsafe { T::FIND_JSON_SPECIAL(units.as_ptr(), units.len()) };
    found(result, units.len())
}

#[inline(always)]
pub fn count_unit<T: Unit>(units: &[T], unit: T) -> usize {
    if is_short(units.len()) {
        return units.iter().filter(|&&it| it == unit).count();
    }
    // SAFETY: the kernel reads `units`, which are as many as it needs.
    unsafe { T::COUNT_UNIT(units.as_ptr(), units.len(), unit) }
}

/// The first index that both have and at which they differ.
#[inline(always)]
pub fn find_difference(a: &[u8], b: &[u8]) -> Option<usize> {
    let len = a.len().min(b.len());
    if is_short(len) {
        return (0..len).find(|&at| a[at] != b[at]);
    }
    // SAFETY: the kernel reads `len` units of both, which are as many as it needs.
    let result = unsafe { highway_text_find_difference8(a.as_ptr(), b.as_ptr(), len) };
    found(result, len)
}

/// [`find_difference`] across the widths.
#[inline(always)]
pub fn find_difference_from_latin1(a: &[u16], b: &[u8]) -> Option<usize> {
    let len = a.len().min(b.len());
    if is_short(len) {
        return (0..len).find(|&at| a[at] != u16::from(b[at]));
    }
    // SAFETY: the kernel reads `len` units of both, which are as many as it needs.
    let result = unsafe { highway_text_find_difference16_and8(a.as_ptr(), b.as_ptr(), len) };
    found(result, len)
}

/// Writes all of `target`. Panics unless it is as long as `source`.
#[inline(always)]
pub fn widen(source: &[u8], target: &mut [MaybeUninit<u16>]) {
    assert!(source.len() == target.len());
    if is_short(source.len()) {
        for (to, &from) in target.iter_mut().zip(source) {
            to.write(u16::from(from));
        }
        return;
    }
    // SAFETY: the kernel reads `source`, which is as long as it needs, and writes as many units.
    unsafe { highway_text_widen(source.as_ptr(), source.len(), target.as_mut_ptr().cast()) }
}

/// Writes all of `target`, the low byte of each unit. Panics unless it is as long as `source`.
#[inline(always)]
pub fn narrow(source: &[u16], target: &mut [MaybeUninit<u8>]) {
    assert!(source.len() == target.len());
    if is_short(source.len()) {
        for (to, &from) in target.iter_mut().zip(source) {
            to.write(from as u8);
        }
        return;
    }
    // SAFETY: the kernel reads `source`, which is as long as it needs, and writes as many units.
    unsafe { highway_text_narrow(source.as_ptr(), source.len(), target.as_mut_ptr().cast()) }
}

/// Copies units of any number with the two-character escapes of JSON. Returns how many it has read, and how many it
/// has initialized at the start of `target`; it may write more. It stops short if fewer than 32 units of room are
/// left, and within 16 units of one that takes a longer escape or does not fit in `Out`, never inside a surrogate
/// pair. It does not see that the first unit is a lone trail surrogate.
#[inline(always)]
pub fn escape_json<In: Unit, Out: Unit>(
    source: &[In],
    target: &mut [MaybeUninit<Out>],
) -> (usize, usize) {
    if cfg!(miri) {
        return (0, 0);
    }
    let mut written = 0;
    // SAFETY: the kernel reads `source` and writes inside `target`.
    let read = unsafe {
        In::escape_json_to::<Out>()(
            source.as_ptr(),
            source.len(),
            target.as_mut_ptr().cast(),
            target.len(),
            &raw mut written,
        )
    };
    (read, written)
}
