//! This type is a `GenericAllocator`; see `src/allocators.zig`.

use core::cell::RefCell;
use core::ffi::{c_char, c_void};
use core::ptr::{self, NonNull};

use crate::mimalloc;
// TODO(port): `std.mem.Allocator` is the Zig `{ ptr, vtable }` pair. This file
// constructs it explicitly (it IS the bun_alloc crate). Phase B decides whether
// this stays a `#[repr(C)] struct ZigAllocator { ptr, vtable }` or becomes a
// `&dyn Allocator` trait object. For now, reference the explicit pair type.
use crate::{Alignment, AllocatorVTable, ZigAllocator};

bun_output::declare_scope!(mimalloc, hidden);

// `safety_checks = bun.Environment.ci_assert` — a comptime build flag.
// TODO(port): confirm the exact cfg name for ci_assert in Phase B.
#[cfg(feature = "ci_assert")]
macro_rules! safety_checks { () => { true }; }
#[cfg(not(feature = "ci_assert"))]
macro_rules! safety_checks { () => { false }; }

pub struct MimallocArena {
    #[cfg(feature = "ci_assert")]
    heap: Box<DebugHeap>,
    #[cfg(not(feature = "ci_assert"))]
    heap: NonNull<mimalloc::Heap>, // mi_heap_t — owned C handle (mi_heap_new/mi_heap_destroy)
}

/// Uses the default thread-local heap. This type is zero-sized.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
#[derive(Clone, Copy)]
pub struct Default;

impl Default {
    pub fn allocator(self) -> ZigAllocator {
        ZigAllocator { ptr: ptr::null_mut(), vtable: &GLOBAL_MIMALLOC_VTABLE }
    }
}

/// Borrowed version of `MimallocArena`, returned by `MimallocArena::borrow`.
/// Using this type makes it clear who actually owns the `MimallocArena`, and prevents
/// `deinit` from being called twice.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
#[derive(Clone, Copy)]
pub struct Borrowed<'a> {
    #[cfg(feature = "ci_assert")]
    heap: &'a DebugHeap,
    #[cfg(not(feature = "ci_assert"))]
    heap: &'a mimalloc::Heap,
}

impl<'a> Borrowed<'a> {
    pub fn allocator(self) -> ZigAllocator {
        ZigAllocator {
            ptr: self.heap as *const _ as *mut c_void,
            vtable: &HEAP_ALLOCATOR_VTABLE,
        }
    }

    /// Prefer `Default::allocator()` / `get_thread_local_default()` for a thread-safe
    /// global allocator. This returns the process-wide main heap so that
    /// `gc()` / `owns_ptr()` on the result remain meaningful.
    pub fn get_default() -> Borrowed<'static> {
        // SAFETY: FFI — mi_heap_main() takes no args and returns the process-wide main heap.
        let heap = unsafe { mimalloc::mi_heap_main() };
        #[cfg(not(feature = "ci_assert"))]
        {
            // SAFETY: mi_heap_main() returns a non-null pointer to the process-wide main heap
            // with 'static lifetime.
            return Borrowed { heap: unsafe { &*heap } };
        }
        #[cfg(feature = "ci_assert")]
        {
            thread_local! {
                static DBG: RefCell<Option<DebugHeap>> = const { RefCell::new(None) };
            }
            // TODO(port): returning a borrow into a thread_local requires raw-pointer
            // escape; safe because DebugHeap is never dropped for the thread's lifetime.
            DBG.with(|slot| {
                let mut s = slot.borrow_mut();
                if s.is_none() {
                    *s = Some(DebugHeap {
                        // SAFETY: mi_heap_main() never returns null.
                        inner: unsafe { NonNull::new_unchecked(heap) },
                        thread_lock: bun_safety::ThreadLock::init_locked(),
                    });
                }
                let p: *const DebugHeap = s.as_ref().unwrap();
                // SAFETY: the Option is never reset to None, so the pointer is valid
                // for the remainder of the thread's lifetime.
                Borrowed { heap: unsafe { &*p } }
            })
        }
    }

    pub fn gc(self) {
        // SAFETY: FFI — heap is a live mi_heap_t* (from mi_heap_new/mi_heap_main).
        unsafe { mimalloc::mi_heap_collect(self.get_mimalloc_heap(), false) };
    }

    pub fn help_catch_memory_issues(self) {
        if bun_core::feature_flags::HELP_CATCH_MEMORY_ISSUES {
            self.gc();
            // SAFETY: FFI — mi_collect(false) has no pointer args.
            unsafe { mimalloc::mi_collect(false) };
        }
    }

    pub fn owns_ptr(self, ptr: *const c_void) -> bool {
        // SAFETY: FFI — heap is a live mi_heap_t*; mi_heap_contains accepts any pointer value.
        unsafe { mimalloc::mi_heap_contains(self.get_mimalloc_heap(), ptr) }
    }

    fn from_opaque(ptr: *mut c_void) -> Self {
        // SAFETY: ptr was produced by `Borrowed::allocator()` above as
        // `self.heap as *const _ as *mut c_void`; cast back to the same type.
        #[cfg(feature = "ci_assert")]
        { Borrowed { heap: unsafe { &*(ptr as *const DebugHeap) } } }
        #[cfg(not(feature = "ci_assert"))]
        { Borrowed { heap: unsafe { &*(ptr as *const mimalloc::Heap) } } }
    }

    fn get_mimalloc_heap(self) -> *mut mimalloc::Heap {
        #[cfg(feature = "ci_assert")]
        { self.heap.inner.as_ptr() }
        #[cfg(not(feature = "ci_assert"))]
        { self.heap as *const mimalloc::Heap as *mut mimalloc::Heap }
    }

    fn assert_thread_lock(self) {
        #[cfg(feature = "ci_assert")]
        self.heap.thread_lock.assert_locked();
    }

    fn aligned_alloc(self, len: usize, alignment: Alignment) -> Option<NonNull<u8>> {
        bun_output::scoped_log!(mimalloc, "Malloc: {}\n", len);

        let heap = self.get_mimalloc_heap();
        // SAFETY: FFI — heap is a live mi_heap_t* (from mi_heap_new/mi_heap_main); len/alignment
        // are passed by value and mimalloc returns null on failure.
        let ptr: *mut c_void = if mimalloc::must_use_aligned_alloc(alignment) {
            unsafe { mimalloc::mi_heap_malloc_aligned(heap, len, alignment.to_byte_units()) }
        } else {
            unsafe { mimalloc::mi_heap_malloc(heap, len) }
        };

        if cfg!(debug_assertions) {
            // SAFETY: FFI — ptr was just returned by mi_heap_malloc[_aligned]; mi_malloc_usable_size
            // accepts null.
            let usable = unsafe { mimalloc::mi_malloc_usable_size(ptr) };
            if usable < len {
                panic!("mimalloc: allocated size is too small: {} < {}", usable, len);
            }
        }

        NonNull::new(ptr.cast::<u8>())
    }

    pub fn downcast(std_alloc: ZigAllocator) -> Self {
        debug_assert!(
            ptr::eq(std_alloc.vtable, &HEAP_ALLOCATOR_VTABLE),
            "not an owned MimallocArena heap (vtable is {:p})",
            std_alloc.vtable,
        );
        Self::from_opaque(std_alloc.ptr)
    }
}

#[cfg(feature = "ci_assert")]
type BorrowedHeap<'a> = &'a DebugHeap;
#[cfg(not(feature = "ci_assert"))]
type BorrowedHeap<'a> = &'a mimalloc::Heap;

struct DebugHeap {
    inner: NonNull<mimalloc::Heap>,
    thread_lock: bun_safety::ThreadLock,
}
// Zig: `pub const deinit = void;` — sentinel meaning "no deinit"; no Drop impl.

impl MimallocArena {
    pub fn allocator(&self) -> ZigAllocator {
        self.borrow().allocator()
    }

    pub fn borrow(&self) -> Borrowed<'_> {
        #[cfg(feature = "ci_assert")]
        { Borrowed { heap: &*self.heap } }
        #[cfg(not(feature = "ci_assert"))]
        // SAFETY: heap is a valid mi_heap_t* for the lifetime of self (owned, destroyed in Drop).
        { Borrowed { heap: unsafe { self.heap.as_ref() } } }
    }

    /// In v3, `mi_malloc`/`mi_free` are already thread-local-fast — there is no
    /// per-thread default heap to cache. Route through the global vtable.
    pub fn get_thread_local_default() -> ZigAllocator {
        #[cfg(feature = "asan")]
        { return crate::default_allocator(); }
        ZigAllocator { ptr: ptr::null_mut(), vtable: &GLOBAL_MIMALLOC_VTABLE }
    }

    pub fn backing_allocator(&self) -> ZigAllocator {
        Self::get_thread_local_default()
    }

    pub fn dump_thread_stats(&self) {
        extern "C" fn dump(text_z: *const c_char, _: *mut c_void) {
            // SAFETY: mimalloc passes a valid NUL-terminated string.
            let text = unsafe { core::ffi::CStr::from_ptr(text_z) }.to_bytes();
            let _ = bun_core::Output::error_writer().write_all(text);
        }
        // SAFETY: FFI — `dump` is a valid extern "C" callback; arg pointer is null (unused).
        unsafe { mimalloc::mi_thread_stats_print_out(Some(dump), ptr::null_mut()) };
        bun_core::Output::flush();
    }

    pub fn dump_stats(&self) {
        extern "C" fn dump(text_z: *const c_char, _: *mut c_void) {
            // SAFETY: mimalloc passes a valid NUL-terminated string.
            let text = unsafe { core::ffi::CStr::from_ptr(text_z) }.to_bytes();
            let _ = bun_core::Output::error_writer().write_all(text);
        }
        // SAFETY: FFI — `dump` is a valid extern "C" callback; arg pointer is null (unused).
        unsafe { mimalloc::mi_stats_print_out(Some(dump), ptr::null_mut()) };
        bun_core::Output::flush();
    }

    pub fn init() -> Self {
        // SAFETY: FFI — mi_heap_new() takes no args; returns null on OOM (handled below).
        let mimalloc_heap = NonNull::new(unsafe { mimalloc::mi_heap_new() })
            .unwrap_or_else(|| bun_core::out_of_memory());
        #[cfg(not(feature = "ci_assert"))]
        { return MimallocArena { heap: mimalloc_heap }; }
        #[cfg(feature = "ci_assert")]
        {
            let heap = Box::new(DebugHeap {
                inner: mimalloc_heap,
                thread_lock: bun_safety::ThreadLock::init_locked(),
            });
            MimallocArena { heap }
        }
    }

    pub fn gc(&self) {
        self.borrow().gc();
    }

    pub fn help_catch_memory_issues(&self) {
        self.borrow().help_catch_memory_issues();
    }

    pub fn owns_ptr(&self, ptr: *const c_void) -> bool {
        self.borrow().owns_ptr(ptr)
    }
}

impl Drop for MimallocArena {
    fn drop(&mut self) {
        let mimalloc_heap = self.borrow().get_mimalloc_heap();
        // In safety_checks mode, `self.heap: Box<DebugHeap>` is dropped automatically
        // after this body (Zig called `self.#heap.deinit()` explicitly).
        // SAFETY: FFI — mimalloc_heap is the live mi_heap_t* owned by this arena (from mi_heap_new).
        unsafe { mimalloc::mi_heap_destroy(mimalloc_heap) };
    }
}

fn aligned_alloc_size(ptr: *mut u8) -> usize {
    // SAFETY: FFI — caller passes a pointer previously returned by a mi_* alloc; mi_malloc_usable_size
    // also accepts null.
    unsafe { mimalloc::mi_malloc_usable_size(ptr.cast()) }
}

fn vtable_alloc(ptr: *mut c_void, len: usize, alignment: Alignment, _: usize) -> Option<NonNull<u8>> {
    let this = Borrowed::from_opaque(ptr);
    this.assert_thread_lock();
    this.aligned_alloc(len, alignment)
}

fn vtable_resize(ptr: *mut c_void, buf: &mut [u8], _: Alignment, new_len: usize, _: usize) -> bool {
    let this = Borrowed::from_opaque(ptr);
    this.assert_thread_lock();
    // SAFETY: FFI — buf.ptr was returned by a prior mi_* alloc on this heap (vtable invariant).
    !unsafe { mimalloc::mi_expand(buf.as_mut_ptr().cast(), new_len) }.is_null()
}

fn vtable_free(_: *mut c_void, buf: &mut [u8], alignment: Alignment, _: usize) {
    // mi_free_size internally just asserts the size
    // so it's faster if we don't pass that value through
    // but its good to have that assertion
    // SAFETY: FFI — buf.ptr was returned by a prior mi_* alloc with the same len/alignment
    // (Allocator vtable invariant); mi_is_in_heap_region accepts any pointer value.
    #[cfg(debug_assertions)]
    {
        debug_assert!(unsafe { mimalloc::mi_is_in_heap_region(buf.as_ptr().cast()) });
        if mimalloc::must_use_aligned_alloc(alignment) {
            unsafe { mimalloc::mi_free_size_aligned(buf.as_mut_ptr().cast(), buf.len(), alignment.to_byte_units()) };
        } else {
            unsafe { mimalloc::mi_free_size(buf.as_mut_ptr().cast(), buf.len()) };
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = alignment;
        unsafe { mimalloc::mi_free(buf.as_mut_ptr().cast()) };
    }
}

/// Attempt to expand or shrink memory, allowing relocation.
///
/// `memory.len` must equal the length requested from the most recent
/// successful call to `alloc`, `resize`, or `remap`. `alignment` must
/// equal the same value that was passed as the `alignment` parameter to
/// the original `alloc` call.
///
/// A non-`null` return value indicates the resize was successful. The
/// allocation may have same address, or may have been relocated. In either
/// case, the allocation now has size of `new_len`. A `null` return value
/// indicates that the resize would be equivalent to allocating new memory,
/// copying the bytes from the old memory, and then freeing the old memory.
/// In such case, it is more efficient for the caller to perform the copy.
///
/// `new_len` must be greater than zero.
///
/// `ret_addr` is optionally provided as the first return address of the
/// allocation call stack. If the value is `0` it means no return address
/// has been provided.
fn vtable_remap(ptr: *mut c_void, buf: &mut [u8], alignment: Alignment, new_len: usize, _: usize) -> Option<NonNull<u8>> {
    let this = Borrowed::from_opaque(ptr);
    this.assert_thread_lock();
    let heap = this.get_mimalloc_heap();
    let aligned_size = alignment.to_byte_units();
    // SAFETY: FFI — heap is a live mi_heap_t*; buf.ptr was returned by a prior mi_* alloc on this
    // heap (vtable invariant).
    let value = unsafe { mimalloc::mi_heap_realloc_aligned(heap, buf.as_mut_ptr().cast(), new_len, aligned_size) };
    NonNull::new(value.cast::<u8>())
}

fn global_vtable_alloc(_: *mut c_void, len: usize, alignment: Alignment, _: usize) -> Option<NonNull<u8>> {
    bun_output::scoped_log!(mimalloc, "Malloc: {}\n", len);
    // SAFETY: FFI — len/alignment are passed by value; mimalloc returns null on failure.
    let ptr: *mut c_void = if mimalloc::must_use_aligned_alloc(alignment) {
        unsafe { mimalloc::mi_malloc_aligned(len, alignment.to_byte_units()) }
    } else {
        unsafe { mimalloc::mi_malloc(len) }
    };
    NonNull::new(ptr.cast::<u8>())
}

fn global_vtable_resize(_: *mut c_void, buf: &mut [u8], _: Alignment, new_len: usize, _: usize) -> bool {
    // SAFETY: FFI — buf.ptr was returned by a prior mi_* alloc (vtable invariant).
    !unsafe { mimalloc::mi_expand(buf.as_mut_ptr().cast(), new_len) }.is_null()
}

fn global_vtable_remap(_: *mut c_void, buf: &mut [u8], alignment: Alignment, new_len: usize, _: usize) -> Option<NonNull<u8>> {
    // SAFETY: FFI — buf.ptr was returned by a prior mi_* alloc (vtable invariant).
    NonNull::new(unsafe { mimalloc::mi_realloc_aligned(buf.as_mut_ptr().cast(), new_len, alignment.to_byte_units()) }.cast::<u8>())
}

pub fn is_instance(alloc: ZigAllocator) -> bool {
    ptr::eq(alloc.vtable, &HEAP_ALLOCATOR_VTABLE) || ptr::eq(alloc.vtable, &GLOBAL_MIMALLOC_VTABLE)
}

/// VTable for owned heaps created with `mi_heap_new`.
static HEAP_ALLOCATOR_VTABLE: AllocatorVTable = AllocatorVTable {
    alloc: vtable_alloc,
    resize: vtable_resize,
    remap: vtable_remap,
    free: vtable_free,
};

/// VTable for the process-wide default allocator (`mi_malloc`/`mi_free`).
static GLOBAL_MIMALLOC_VTABLE: AllocatorVTable = AllocatorVTable {
    alloc: global_vtable_alloc,
    resize: global_vtable_resize,
    remap: global_vtable_remap,
    free: vtable_free,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/MimallocArena.zig (291 lines)
//   confidence: medium
//   todos:      3
//   notes:      ZigAllocator/AllocatorVTable/Alignment are crate-local types Phase B must define; cfg(feature="ci_assert"/"asan") names need confirming; get_default() thread_local borrow escape is unsafe-but-sound.
// ──────────────────────────────────────────────────────────────────────────
