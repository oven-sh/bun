use core::mem::offset_of;

use bun_alloc::ObjectPool;
use bun_str::MutableString;
use bun_zlib::{ZlibError, ZlibReaderArrayList};

fn init_mutable_string() -> Result<MutableString, bun_core::Error> {
    Ok(MutableString::init_empty())
}

// TODO(port): `bun.ObjectPool(T, init_fn, threadsafe, capacity)` is a comptime type-generator.
// Rust const generics cannot carry a fn item; Phase B should expose the init fn via a trait
// (or a const closure) on `bun_alloc::ObjectPool`. `false` = not threadsafe, `4` = capacity.
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
    drop(reader);
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/zlib.zig (34 lines)
//   confidence: medium
//   todos:      2
//   notes:      ObjectPool comptime fn-param + intrusive @fieldParentPtr pool node need Phase-B API design; allocator params dropped (non-AST crate).
// ──────────────────────────────────────────────────────────────────────────
