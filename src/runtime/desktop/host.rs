use core::ffi::c_void;
use core::slice::from_raw_parts;

use super::host_abi::{self, Host, Sink};
use crate::image::codecs;

unsafe extern "C" {
    safe fn Bun__DesktopHost__inflateBegin() -> *mut c_void;
    fn Bun__DesktopHost__inflate(
        state: *mut c_void,
        input: *const u8,
        input_len: *mut usize,
        output: *mut u8,
        output_len: *mut usize,
    ) -> i32;
    fn Bun__DesktopHost__inflateEnd(state: *mut c_void);
    fn Bun__DesktopHost__decodeBrotli(
        input: *const u8,
        input_len: usize,
        output: *mut u8,
        output_len: usize,
    ) -> usize;
    safe fn Bun__DesktopHost__characterProperty(character: u32, property: u32) -> i32;
    safe fn Bun__DesktopHost__scriptOf(character: u32) -> u32;
    safe fn Bun__DesktopHost__mirror(character: u32) -> u32;
    safe fn Bun__DesktopHost__decompose(character: u32) -> u64;
    safe fn Bun__DesktopHost__compose(first: u32, second: u32) -> u32;
    fn Bun__DesktopHost__findBreaks(
        kind: u8,
        text: *const u8,
        len: usize,
        offsets: *mut u32,
    ) -> usize;
    fn Bun__DesktopHost__resolveBidi(
        text: *const u8,
        len: usize,
        direction: u8,
        levels: *mut u8,
    ) -> u8;
}

pub(super) static HOST: Host = Host {
    inflate_begin: Bun__DesktopHost__inflateBegin,
    inflate: Bun__DesktopHost__inflate,
    inflate_end: Bun__DesktopHost__inflateEnd,
    decode_brotli: Bun__DesktopHost__decodeBrotli,
    crc32,
    image_size,
    decode_image,
    encode_image,
    resize_image,
    character_property: Bun__DesktopHost__characterProperty,
    script_of: Bun__DesktopHost__scriptOf,
    find_breaks: Bun__DesktopHost__findBreaks,
    resolve_bidi: Bun__DesktopHost__resolveBidi,
    mirror: Bun__DesktopHost__mirror,
    decompose: Bun__DesktopHost__decompose,
    compose: Bun__DesktopHost__compose,
};

#[cfg(not(bun_asan))]
pub(super) static ALLOCATOR: host_abi::Allocator = {
    use bun_alloc::mimalloc::*;
    host_abi::Allocator {
        allocate: mi_malloc_aligned,
        allocate_zeroed: mi_zalloc_aligned,
        reallocate: mi_realloc_aligned,
        free: mi_free,
        release: mi_on_thread_idle,
    }
};

/// The library does not see the interceptors.
#[cfg(all(unix, bun_asan))]
pub(super) static ALLOCATOR: host_abi::Allocator = {
    extern "C" fn allocate(size: usize, alignment: usize) -> *mut c_void {
        let mut start = core::ptr::null_mut();
        // SAFETY: the alignment is a power of two and a multiple of the size of a pointer.
        unsafe { libc::posix_memalign(&raw mut start, alignment.max(size_of::<usize>()), size) };
        start
    }
    extern "C" fn allocate_zeroed(size: usize, alignment: usize) -> *mut c_void {
        let start = allocate(size, alignment);
        if !start.is_null() {
            // SAFETY: it has `size` bytes.
            unsafe { start.write_bytes(0, size) };
        }
        start
    }
    unsafe extern "C" fn reallocate(
        old: *mut c_void,
        size: usize,
        alignment: usize,
    ) -> *mut c_void {
        unsafe extern "C" {
            fn __sanitizer_get_allocated_size(start: *const c_void) -> usize;
        }
        let start = allocate(size, alignment);
        if !start.is_null() {
            // SAFETY: `old` came from `allocate`.
            unsafe {
                start.copy_from_nonoverlapping(old, size.min(__sanitizer_get_allocated_size(old)));
                libc::free(old);
            }
        }
        start
    }
    extern "C" fn release() {}
    host_abi::Allocator {
        allocate,
        allocate_zeroed,
        reallocate,
        free: libc::free,
        release,
    }
};

/// # Safety
/// `rgba` has 4 bytes for each pixel.
unsafe fn pixels<'a>(rgba: *const u8, [width, height]: [u32; 2]) -> &'a [u8] {
    // SAFETY: the caller's contract.
    unsafe { from_raw_parts(rgba, width as usize * height as usize * 4) }
}

unsafe extern "C" fn crc32(bytes: *const u8, len: usize) -> u32 {
    // SAFETY: the library passes the parts of a slice.
    bun_zlib::crc32_bytes(0, unsafe { from_raw_parts(bytes, len) })
}

unsafe extern "C" fn image_size(bytes: *const u8, len: usize, size: &mut [u32; 2]) -> bool {
    // SAFETY: the library passes the parts of a slice.
    let probe = codecs::probe(unsafe { from_raw_parts(bytes, len) }, u64::MAX);
    probe.map(|it| *size = [it.width, it.height]).is_ok()
}

unsafe extern "C" fn decode_image(
    bytes: *const u8,
    len: usize,
    max_pixels: u64,
    size: &mut [u32; 2],
    sink: Sink,
    context: *mut c_void,
) -> bool {
    let [target_w, target_h] = *size;
    let hint = codecs::DecodeHint { target_w, target_h };
    // SAFETY: the library passes the parts of a slice.
    let Ok(image) = codecs::decode(unsafe { from_raw_parts(bytes, len) }, max_pixels, hint) else {
        return false;
    };
    *size = [image.width, image.height];
    // SAFETY: a live slice, and the context that came with the sink.
    unsafe { sink(context, image.rgba.as_ptr(), image.rgba.len()) };
    true
}

unsafe extern "C" fn encode_image(
    rgba: *const u8,
    size: &[u32; 2],
    format: u8,
    effort: u8,
    sink: Sink,
    context: *mut c_void,
) -> bool {
    let options = codecs::EncodeOptions {
        format: match format {
            host_abi::FORMAT_JPEG => codecs::Format::Jpeg,
            host_abi::FORMAT_WEBP => codecs::Format::Webp,
            _ => codecs::Format::Png,
        },
        quality: effort.clamp(1, 100),
        lossless: true,
        compression_level: effort.min(9) as i8,
        ..Default::default()
    };
    // SAFETY: the contract of `Host`.
    let rgba = unsafe { pixels(rgba, *size) };
    let Ok(encoded) = codecs::encode(rgba, size[0], size[1], options, None) else {
        return false;
    };
    // SAFETY: a live slice, and the context that came with the sink.
    unsafe { sink(context, encoded.as_ptr(), encoded.len()) };
    true
}

unsafe extern "C" fn resize_image(
    rgba: *const u8,
    size: &[u32; 2],
    to: &[u32; 2],
    sink: Sink,
    context: *mut c_void,
) -> bool {
    if size.iter().chain(to).any(|it| !(1..=0xFFFF).contains(it)) {
        return false;
    }
    // SAFETY: the contract of `Host`.
    let rgba = unsafe { pixels(rgba, *size) };
    let filter = codecs::Filter::Lanczos3;
    let Ok(resized) = codecs::resize(rgba, size[0], size[1], to[0], to[1], filter) else {
        return false;
    };
    // SAFETY: a live slice, and the context that came with the sink.
    unsafe { sink(context, resized.as_ptr(), resized.len()) };
    true
}
