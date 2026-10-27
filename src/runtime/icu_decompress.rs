//! The zstd side of `bun_icu_decompress.cpp`.

use core::ffi::c_void;

use bun_zstd::{DCtx, DDict, FrameExtent};

pub(crate) struct IcuDecompressor {
    dctx: DCtx,
    ddict: Option<DDict<'static>>,
}

/// `dict` is the `dict_size` bytes of a dictionary that lives as long as the process, or null.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__IcuDecompressor__create(
    dict: *const u8,
    dict_size: usize,
) -> *mut IcuDecompressor {
    let ddict = if dict.is_null() || dict_size == 0 {
        None
    } else {
        // SAFETY: the caller's contract.
        DDict::by_reference(unsafe { core::slice::from_raw_parts(dict, dict_size) }).ok()
    };
    bun_core::heap::into_raw(Box::new(IcuDecompressor {
        dctx: DCtx::new(),
        ddict,
    }))
}

/// The sizes of the frame that starts at `src`, compressed and decompressed. False if it is not a frame that says its
/// size, or if it is more than `bound` bytes.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__IcuDecompressor__frameSizes(
    src: *const u8,
    bound: usize,
    compressed_size: &mut usize,
    content_size: &mut u64,
) -> bool {
    // `bound` can be past the end of the data, so this only looks at the bytes that the frame says it has.
    let mut known = 0;
    loop {
        // SAFETY: `src` starts a frame, which is at least `known` bytes.
        let frame = unsafe { core::slice::from_raw_parts(src, known) };
        match bun_zstd::frame_extent(frame) {
            Ok(FrameExtent::AtLeast(size)) if size > known && size <= bound => known = size,
            Ok(FrameExtent::Whole(size)) => {
                *compressed_size = size;
                *content_size = bun_zstd::get_frame_content_size(frame);
                return *content_size < bun_zstd::ZSTD_CONTENTSIZE_ERROR;
            }
            _ => return false,
        }
    }
}

/// Decompresses the frame `src` to `dst`, which is initialized and of the size that the frame says.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__IcuDecompressor__decompress(
    this: &mut IcuDecompressor,
    dst: *mut c_void,
    dst_size: usize,
    src: *const u8,
    src_size: usize,
) -> bool {
    // SAFETY: the caller's contract.
    let (dst, src) = unsafe {
        (
            core::slice::from_raw_parts_mut(dst.cast::<u8>(), dst_size),
            core::slice::from_raw_parts(src, src_size),
        )
    };
    match &this.ddict {
        Some(ddict) => this.dctx.decompress_using_ddict(dst, src, ddict),
        None => this.dctx.decompress(dst, src),
    }
    .is_ok()
}
