//! What the UI library borrows from the libraries that are linked into Bun. Any thread may call these.
#![allow(dead_code, unreachable_pub)] // Each side uses its half.

use core::ffi::c_void;

/// Gets bytes that are only valid during the call.
pub type Sink = unsafe extern "C" fn(context: *mut c_void, bytes: *const u8, len: usize);

pub const FORMAT_PNG: u8 = 0;
pub const FORMAT_JPEG: u8 = 1;
/// Lossless.
pub const FORMAT_WEBP: u8 = 2;

pub const BREAK_GRAPHEMES: u8 = 0;
pub const BREAK_LINES: u8 = 1;
pub const BREAK_LINES_LOOSE: u8 = 2;
pub const BREAK_LINES_STRICT: u8 = 3;
/// Added to `BREAK_LINES*`, for the rules of Chinese and Japanese.
pub const BREAK_CJ: u8 = 3;

#[repr(C)]
pub struct Host {
    /// For data in the zlib format, whose checksum is ignored. Null if there is no memory.
    pub inflate_begin: extern "C" fn() -> *mut c_void,
    /// The lengths become those that were read and written. 1 at the end of the data, and -1 if it is broken.
    pub inflate: unsafe extern "C" fn(
        *mut c_void,
        input: *const u8,
        *mut usize,
        output: *mut u8,
        *mut usize,
    ) -> i32,
    pub inflate_end: unsafe extern "C" fn(*mut c_void),
    /// How much was written.
    pub decode_brotli:
        unsafe extern "C" fn(input: *const u8, usize, output: *mut u8, usize) -> usize,
    pub crc32: unsafe extern "C" fn(*const u8, usize) -> u32,
    pub image_size: unsafe extern "C" fn(*const u8, usize, size: &mut [u32; 2]) -> bool,
    /// To RGBA that is not premultiplied. `size` is the least that is needed, or zeros, and then what `sink` got.
    pub decode_image: unsafe extern "C" fn(
        *const u8,
        usize,
        max_pixels: u64,
        size: &mut [u32; 2],
        Sink,
        *mut c_void,
    ) -> bool,
    /// `effort` is the quality of a JPEG, or the compression level of a PNG.
    pub encode_image: unsafe extern "C" fn(
        rgba: *const u8,
        size: &[u32; 2],
        format: u8,
        effort: u8,
        Sink,
        *mut c_void,
    ) -> bool,
    /// With Lanczos3.
    pub resize_image: unsafe extern "C" fn(
        rgba: *const u8,
        size: &[u32; 2],
        to: &[u32; 2],
        Sink,
        *mut c_void,
    ) -> bool,
    /// `u_getIntPropertyValue`
    pub character_property: extern "C" fn(character: u32, property: u32) -> i32,
    /// An ISO 15924 tag.
    pub script_of: extern "C" fn(character: u32) -> u32,
    /// Writes the offsets after 0 in valid UTF-8, for which there is room for one per byte, and returns how many.
    pub find_breaks:
        unsafe extern "C" fn(kind: u8, text: *const u8, usize, offsets: *mut u32) -> usize,
    /// Writes the level of each byte of valid UTF-8, and returns that of the paragraph. `direction` is an `abi::DIRECTION_*`.
    pub resolve_bidi:
        unsafe extern "C" fn(text: *const u8, usize, direction: u8, levels: *mut u8) -> u8,
    /// `u_charMirror`
    pub mirror: extern "C" fn(character: u32) -> u32,
    /// One step of the canonical decomposition, with the second character in the high half, or 0.
    pub decompose: extern "C" fn(character: u32) -> u64,
    /// 0 if there is no such character.
    pub compose: extern "C" fn(first: u32, second: u32) -> u32,
}

/// The last argument of the first three is the alignment.
#[repr(C)]
pub struct Allocator {
    pub allocate: extern "C" fn(usize, usize) -> *mut c_void,
    pub allocate_zeroed: extern "C" fn(usize, usize) -> *mut c_void,
    pub reallocate: unsafe extern "C" fn(*mut c_void, usize, usize) -> *mut c_void,
    pub free: unsafe extern "C" fn(*mut c_void),
    /// Gives the system what the calling thread does not use.
    pub release: extern "C" fn(),
}
