//! Stand-ins for the kernels behind strings and URLs: highway_text.cpp, highway_utf8.cpp, highway_byte_set.cpp and
//! some of simdutf. Weak, so the real ones win wherever they are linked.

use core::ffi::c_int;
use core::slice::from_raw_parts;

use bun_highway::url::PlainBytes;

macro_rules! stand_ins {
    ($(fn $name:ident($($argument:ident: $type:ty),*) $(-> $result:ty)? $body:block)*) => {$(
        #[unsafe(no_mangle)]
        #[linkage = "weak"]
        unsafe extern "C" fn $name($($argument: $type),*) $(-> $result)? {
            // SAFETY: the caller passes slices, each as a pointer and the length.
            unsafe { $body }
        }
    )*};
}

#[repr(C)]
struct Block {
    end: usize,
    stops: u64,
}

#[repr(C)]
struct SimdutfResult {
    status: c_int,
    count: usize,
}

fn first<T: Copy>(units: &[T], test: impl Fn(T) -> bool) -> usize {
    (units.iter().position(|&unit| test(unit))).unwrap_or(units.len())
}

stand_ins! {
    fn highway_text_find_above8(p: *const u8, len: usize, limit: u8) -> usize {
        first(from_raw_parts(p, len), |unit| unit > limit)
    }
    fn highway_text_find_above16(p: *const u16, len: usize, limit: u16) -> usize {
        first(from_raw_parts(p, len), |unit| unit > limit)
    }
    fn highway_text_find_difference8(a: *const u8, b: *const u8, len: usize) -> usize {
        (0..len).find(|&at| *a.add(at) != *b.add(at)).unwrap_or(len)
    }
    fn highway_text_find_difference16_and8(a: *const u16, b: *const u8, len: usize) -> usize {
        (0..len).find(|&at| *a.add(at) != u16::from(*b.add(at))).unwrap_or(len)
    }
    fn highway_text_widen(from: *const u8, len: usize, to: *mut u16) {
        (0..len).for_each(|at| to.add(at).write(u16::from(*from.add(at))));
    }
    fn highway_text_narrow(from: *const u16, len: usize, to: *mut u8) {
        (0..len).for_each(|at| to.add(at).write(*from.add(at) as u8));
    }
    fn highway_narrow_to_latin1(from: *const u16, len: usize, to: *mut u8) -> bool {
        highway_text_narrow(from, len, to);
        highway_text_find_above16(from, len, 0xff) == len
    }
    fn highway_copy_ascii_prefix(from: *const u8, len: usize, to: *mut u8) -> usize {
        let count = highway_text_find_above8(from, len, 0x7f);
        to.copy_from_nonoverlapping(from, count);
        count
    }
    fn highway_last_index_of_slash(p: *const u8, len: usize) -> usize {
        (0..len).rfind(|&at| *p.add(at) == b'/').unwrap_or(len)
    }
    fn highway_url_stops_32(p: *const u8, len: usize, at: usize, set: &PlainBytes) -> u64 {
        set.scalar_stops(from_raw_parts(p, len), at, 32)
    }
    fn highway_url_stops_64(p: *const u8, len: usize, at: usize, set: &PlainBytes) -> u64 {
        set.scalar_stops(from_raw_parts(p, len), at, 64)
    }
    fn highway_url_next_block(p: *const u8, len: usize, at: usize, set: &PlainBytes) -> Block {
        Block { end: at + 64, stops: highway_url_stops_64(p, len, at, set) }
    }
    fn simdutf__latin1_length_from_utf8(p: *const u8, len: usize) -> usize {
        from_raw_parts(p, len).iter().filter(|&&byte| byte & 0xc0 != 0x80).count()
    }
    fn simdutf__validate_utf16le_with_errors(p: *const u16, len: usize) -> SimdutfResult {
        let characters = char::decode_utf16(from_raw_parts(p, len).iter().copied());
        let count = characters.map_while(Result::ok).map(char::len_utf16).sum();
        // simdutf's SURROGATE
        SimdutfResult { status: if count == len { 0 } else { 6 }, count }
    }
}

/// Leaves everything to the caller.
#[derive(Default)]
#[repr(C)]
struct Utf8Progress {
    read: usize,
    written: usize,
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn highway_utf8_decode(_: usize, _: usize, _: usize, _: usize) -> Utf8Progress {
    Utf8Progress::default()
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn highway_url_stops_of_words(low: u64, high: u64, set: &PlainBytes) -> u64 {
    set.scalar_stops([low, high].map(u64::to_le_bytes).as_flattened(), 0, 16)
}

macro_rules! no_icu {
    ($($name:ident)*) => {$(
        #[unsafe(export_name = bun_icu::icu_symbol!($name))]
        #[linkage = "weak"]
        extern "C" fn $name() -> ! {
            panic!("{}: this program has no ICU", stringify!($name))
        }
    )*};
}

#[allow(non_snake_case)]
mod icu {
    no_icu! {
        u_charDirection
        u_charType
        u_getCombiningClass
        u_getIntPropertyValue
        ucol_close
        ucol_open
        ucol_setAttribute
        ucol_strcoll
        ucol_strcollUTF8
        uidna_nameToASCII
        uidna_openUTS46
        uloc_getDefault
        uloc_setDefault
        unorm2_getInstance
        unorm2_getNFDInstance
        unorm2_hasBoundaryBefore
        unorm2_isNormalized
        unorm2_normalize
    }
}
