use bun_string::MutableString;
use bun_zlib::{ZlibError, ZlibReaderArrayList};

// TODO(b2-blocked): bun_collections::ObjectPool — `MutableString` does not impl
// `ObjectPoolType` (foreign-trait/foreign-type), and the per-monomorphization
// static storage for `data()` is unimplemented. The Zig used
// `bun.ObjectPool(MutableString, initMutableString, false, 4)` and recovered the
// node via `@fieldParentPtr`. Re-gated until the lower-tier `object_pool!`
// declaration macro lands.
#[cfg(any())]
mod buffer_pool {
    use super::*;
    use core::mem::offset_of;
    use bun_collections::ObjectPool;

    fn init_mutable_string() -> Result<MutableString, bun_core::Error> {
        Ok(MutableString::init_empty())
    }

    type BufferPool = ObjectPool<MutableString, false, 4>;
    type BufferPoolNode = <BufferPool>::Node;

    pub fn get() -> *mut MutableString {
        // TODO(port): Zig returns `*MutableString` borrowed from a pool node; consider an RAII
        // guard in Phase B so callers don't hand-pair get/put.
        // SAFETY: pool node is leaked until `put()` is called with this pointer.
        unsafe { core::ptr::addr_of_mut!((*BufferPool::get(init_mutable_string)).data) }
    }

    pub fn put(mutable: *mut MutableString) {
        // SAFETY: `mutable` points to the `data` field of a `BufferPool::Node` previously
        // returned by `get()`; we recover the parent node via offset_of (mirrors @fieldParentPtr).
        unsafe {
            (*mutable).reset();
            let node: *mut BufferPoolNode = (mutable as *mut u8)
                .sub(offset_of!(BufferPoolNode, data))
                .cast::<BufferPoolNode>();
            (*node).release();
        }
    }
}
#[cfg(any())]
pub use buffer_pool::{get, put};

pub fn decompress(compressed_data: &[u8], output: &mut MutableString) -> Result<(), ZlibError> {
    let mut reader = ZlibReaderArrayList::init_with_options_and_list_allocator(
        compressed_data,
        &mut output.list,
        bun_zlib::Options {
            window_bits: 15 + 32,
            ..Default::default()
        },
    )?;
    reader.read_all(true)?;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/zlib.zig (34 lines)
//   confidence: medium
//   todos:      2
//   notes:      ObjectPool comptime fn-param + intrusive @fieldParentPtr pool node need Phase-B API design; allocator params dropped (non-AST crate).
// ──────────────────────────────────────────────────────────────────────────
