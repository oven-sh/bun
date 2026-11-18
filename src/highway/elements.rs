//! Searches in the elements of arrays, from src/jsc/bindings/highway_elements.cpp.

unsafe extern "C" {
    fn highway_index_of_u64(elements: *const u64, len: usize, needle: u64) -> usize;
    fn highway_last_index_of_u64(elements: *const u64, len: usize, needle: u64) -> usize;
    fn highway_index_of_f64(elements: *const f64, len: usize, needle: f64) -> usize;
    fn highway_last_index_of_f64(elements: *const f64, len: usize, needle: f64) -> usize;
    fn highway_index_of_nan(elements: *const f64, len: usize) -> usize;
    fn highway_index_of_either_u64(elements: *const u64, len: usize, a: u64, b: u64) -> usize;
    fn highway_last_index_of_either_u64(elements: *const u64, len: usize, a: u64, b: u64) -> usize;
}

/// Below this a call costs more than it saves. It is at least the number of lanes of the widest vector.
const SHORT: usize = 8;

macro_rules! searches {
    ($($(#[$doc:meta])* $name:ident($type:ty $(, $needle:ident)*) = $kernel:ident, $scalar:ident(|$element:ident| $test:expr);)*) => {$(
        $(#[$doc])*
        #[inline(always)]
        pub fn $name(elements: &[$type] $(, $needle: $type)*) -> Option<usize> {
            if cfg!(miri) || elements.len() < SHORT {
                return elements.iter().$scalar(|&$element| $test);
            }
            // SAFETY: a readable range that fills a vector.
            let found = unsafe { $kernel(elements.as_ptr(), elements.len() $(, $needle)*) };
            (found < elements.len()).then_some(found)
        }
    )*};
}

searches! {
    index_of_u64(u64, needle) = highway_index_of_u64, position(|it| it == needle);
    last_index_of_u64(u64, needle) = highway_last_index_of_u64, rposition(|it| it == needle);
    /// The zeros are equal, and NaN is equal to nothing.
    index_of_f64(f64, needle) = highway_index_of_f64, position(|it| it == needle);
    /// As `index_of_f64`.
    last_index_of_f64(f64, needle) = highway_last_index_of_f64, rposition(|it| it == needle);
    index_of_nan(f64) = highway_index_of_nan, position(|it| it.is_nan());
    index_of_either_u64(u64, a, b) = highway_index_of_either_u64, position(|it| it == a || it == b);
    last_index_of_either_u64(u64, a, b) = highway_last_index_of_either_u64, rposition(|it| it == a || it == b);
}

/// The size of the widest vector.
pub const VECTOR_BYTES: usize = 32;

/// Kernels over raw ranges of lanes, which need not be aligned.
///
/// # Safety
/// `len` lanes can be accessed at each pointer, and they are more than [`VECTOR_BYTES`].
pub trait Lane: Copy {
    /// The first lane whose bits under the mask are `needle`, or `len`.
    unsafe fn index_of_masked(lanes: *const Self, len: usize, mask: Self, needle: Self) -> usize;

    /// The last one, or `len`.
    unsafe fn last_index_of_masked(
        lanes: *const Self,
        len: usize,
        mask: Self,
        needle: Self,
    ) -> usize;

    /// The first lane that is above `limit` without its highest bit, or `len`.
    unsafe fn index_of_magnitude_above(lanes: *const Self, len: usize, limit: Self) -> usize;

    /// As signed integers, once the bits of `flip` are inverted.
    unsafe fn are_integers_ascending(lanes: *const Self, len: usize, flip: Self) -> bool;

    /// Negative zero is below zero, and a NaN is never in order.
    unsafe fn are_floats_ascending(lanes: *const Self, len: usize, infinity: Self) -> bool;

    /// Leaves all but so many lanes at each end to be reversed.
    unsafe fn reverse_ends(lanes: *mut Self, len: usize) -> usize;

    /// The two do not overlap.
    unsafe fn copy_reversed(source: *const Self, target: *mut Self, len: usize);
}

macro_rules! lanes {
    ($($lane:ty, $suffix:literal;)*) => {$(
        impl Lane for $lane {
            kernels! { $suffix:
                index_of_masked(lanes: *const $lane, len: usize, mask: $lane, needle: $lane) -> usize;
                last_index_of_masked(lanes: *const $lane, len: usize, mask: $lane, needle: $lane) -> usize;
                index_of_magnitude_above(lanes: *const $lane, len: usize, limit: $lane) -> usize;
                are_integers_ascending(lanes: *const $lane, len: usize, flip: $lane) -> bool;
                are_floats_ascending(lanes: *const $lane, len: usize, infinity: $lane) -> bool;
                reverse_ends(lanes: *mut $lane, len: usize) -> usize;
                copy_reversed(source: *const $lane, target: *mut $lane, len: usize) -> ();
            }
        }
    )*};
}

macro_rules! kernels {
    ($suffix:literal: $($name:ident($($parameter:ident: $type:ty),*) -> $result:ty;)*) => {$(
        #[inline(always)]
        unsafe fn $name($($parameter: $type),*) -> $result {
            unsafe extern "C" {
                #[link_name = concat!("highway_", stringify!($name), $suffix)]
                fn kernel($($parameter: $type),*) -> $result;
            }
            // SAFETY: the caller's.
            unsafe { kernel($($parameter),*) }
        }
    )*};
}

lanes! {
    u8, "_8";
    u16, "_16";
    u32, "_32";
    u64, "_64";
}
