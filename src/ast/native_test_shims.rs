//! mimalloc symbols the `TapeAlloc::Arena` arm makes this crate's `cargo test`
//! binary reference; mimalloc is only linked into bun. Never compiled into the
//! real build.

use core::ffi::c_void;

use bun_alloc::mimalloc::Heap;

/// Nothing here references `mi_heap_new` or `mi_heap_main`, so no arena exists to get here.
fn no_mimalloc_in_test_binary(symbol: &str) -> ! {
    unreachable!("{symbol} called, but bun_ast's test binary does not link mimalloc")
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc(_heap: *mut Heap, _size: usize) -> *mut c_void {
    no_mimalloc_in_test_binary("mi_heap_malloc")
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc_aligned(
    _heap: *mut Heap,
    _size: usize,
    _alignment: usize,
) -> *mut c_void {
    no_mimalloc_in_test_binary("mi_heap_malloc_aligned")
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc_usable_size(_p: *const c_void) -> usize {
    no_mimalloc_in_test_binary("mi_malloc_usable_size")
}

#[unsafe(no_mangle)]
extern "C" fn mi_is_in_heap_region(_p: *const c_void) -> bool {
    no_mimalloc_in_test_binary("mi_is_in_heap_region")
}

#[unsafe(no_mangle)]
extern "C" fn mi_free(_p: *mut c_void) {
    no_mimalloc_in_test_binary("mi_free")
}

#[unsafe(no_mangle)]
extern "C" fn mi_free_size(_p: *mut c_void, _size: usize) {
    no_mimalloc_in_test_binary("mi_free_size")
}

#[unsafe(no_mangle)]
extern "C" fn mi_free_size_aligned(_p: *mut c_void, _size: usize, _alignment: usize) {
    no_mimalloc_in_test_binary("mi_free_size_aligned")
}
