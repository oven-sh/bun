//! mimalloc, as far as `bun_alloc` calls it, on top of the C allocator. Nothing is ever returned to a heap as a
//! whole: `mi_heap_destroy` leaks, which is fine for a probe that parses a few files and exits.
use core::ffi::c_void;
use core::ptr;

unsafe extern "C" {
    fn malloc(size: usize) -> *mut c_void;
    fn calloc(count: usize, size: usize) -> *mut c_void;
    fn realloc(p: *mut c_void, size: usize) -> *mut c_void;
    fn free(p: *mut c_void);
    fn posix_memalign(out: *mut *mut c_void, alignment: usize, size: usize) -> i32;
    fn malloc_usable_size(p: *mut c_void) -> usize;
}

fn aligned(size: usize, alignment: usize, zero: bool) -> *mut c_void {
    let mut p: *mut c_void = ptr::null_mut();
    let alignment = alignment.max(16).next_power_of_two();
    // SAFETY: `p` is a valid out pointer and the alignment is a power of two that is a multiple of the pointer size.
    if unsafe { posix_memalign(&mut p, alignment, size.max(1)) } != 0 {
        return ptr::null_mut();
    }
    if zero {
        // SAFETY: `p` points to at least `size` writable bytes.
        unsafe { ptr::write_bytes(p.cast::<u8>(), 0, size) };
    }
    p
}

fn realloc_aligned(p: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    if p.is_null() {
        return aligned(size, alignment, false);
    }
    let new = aligned(size, alignment, false);
    if !new.is_null() {
        // SAFETY: both blocks are live and at least `min(old usable size, size)` bytes long.
        unsafe {
            let old = malloc_usable_size(p);
            ptr::copy_nonoverlapping(p.cast::<u8>(), new.cast::<u8>(), old.min(size));
            free(p);
        }
    }
    new
}

#[unsafe(no_mangle)]
extern "C" fn mi_malloc(size: usize) -> *mut c_void {
    // SAFETY: plain C allocation.
    unsafe { malloc(size.max(1)) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_calloc(count: usize, size: usize) -> *mut c_void {
    // SAFETY: plain C allocation.
    unsafe { calloc(count.max(1), size.max(1)) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_zalloc(size: usize) -> *mut c_void {
    // SAFETY: plain C allocation.
    unsafe { calloc(1, size.max(1)) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_realloc(p: *mut c_void, size: usize) -> *mut c_void {
    // SAFETY: the caller passes a block of this allocator or null.
    unsafe { realloc(p, size.max(1)) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_expand(_p: *mut c_void, _size: usize) -> *mut c_void {
    ptr::null_mut()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free(p: *mut c_void) {
    // SAFETY: the caller passes a block of this allocator or null.
    unsafe { free(p) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size(p: *mut c_void, _size: usize) {
    // SAFETY: as `mi_free`.
    unsafe { free(p) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size_aligned(p: *mut c_void, _size: usize, _alignment: usize) {
    // SAFETY: as `mi_free`.
    unsafe { free(p) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_usable_size(p: *const c_void) -> usize {
    if p.is_null() {
        return 0;
    }
    // SAFETY: the caller passes a live block of this allocator.
    unsafe { malloc_usable_size(p.cast_mut()) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_malloc_usable_size(p: *const c_void) -> usize {
    // SAFETY: as `mi_usable_size`.
    unsafe { mi_usable_size(p) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_malloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    aligned(size, alignment, false)
}
#[unsafe(no_mangle)]
extern "C" fn mi_zalloc_aligned(size: usize, alignment: usize) -> *mut c_void {
    aligned(size, alignment, true)
}
#[unsafe(no_mangle)]
extern "C" fn mi_realloc_aligned(p: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    realloc_aligned(p, size, alignment)
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_new() -> *mut c_void {
    // SAFETY: plain C allocation: a heap is only a non-null handle here.
    unsafe { malloc(16) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_destroy(_heap: *mut c_void) {}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_main() -> *mut c_void {
    static MAIN: u64 = 0;
    ptr::from_ref(&MAIN).cast_mut().cast()
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc(_heap: *mut c_void, size: usize) -> *mut c_void {
    mi_malloc(size)
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_zalloc(_heap: *mut c_void, size: usize) -> *mut c_void {
    mi_zalloc(size)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_realloc(_heap: *mut c_void, p: *mut c_void, size: usize) -> *mut c_void {
    // SAFETY: as `mi_realloc`.
    unsafe { mi_realloc(p, size) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_malloc_aligned(_heap: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    aligned(size, alignment, false)
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_zalloc_aligned(_heap: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    aligned(size, alignment, true)
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_realloc_aligned(_heap: *mut c_void, p: *mut c_void, size: usize, alignment: usize) -> *mut c_void {
    realloc_aligned(p, size, alignment)
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_visit_blocks(_heap: *const c_void, _all: bool, _visitor: *const c_void, _arg: *mut c_void) -> bool {
    true
}
#[unsafe(no_mangle)]
extern "C" fn mi_is_in_heap_region(_p: *const c_void) -> bool {
    true
}
#[unsafe(no_mangle)]
extern "C" fn mi_collect(_force: bool) {}
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle() {}
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle_start() -> bool {
    false
}
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle_end() {}
#[unsafe(no_mangle)]
extern "C" fn mi_stats_print_out(_out: *const c_void, _arg: *mut c_void) {}
#[unsafe(no_mangle)]
extern "C" fn mi_option_set(_option: i32, _value: core::ffi::c_long) {}
