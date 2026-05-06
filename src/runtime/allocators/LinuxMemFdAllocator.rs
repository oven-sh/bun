//! When cloning large amounts of data potentially multiple times, we can
//! leverage copy-on-write memory to avoid actually copying the data. To do that
//! on Linux, we need to use a memfd, which is a Linux-specific feature.
//!
//! The steps are roughly:
//!
//! 1. Create a memfd
//! 2. Write the data to the memfd
//! 3. Map the memfd into memory
//!
//! Then, to clone the data later, we can just call `mmap` again.
//!
//! The big catch is that mmap(), memfd_create(), write() all have overhead. And
//! often we will re-use virtual memory within the process. This does not reuse
//! the virtual memory. So we should only really use this for large blobs of
//! data that we expect to be cloned multiple times. Such as Blob in FormData.

use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::{Alignment, AllocatorVTable, StdAllocator};
use bun_core::Fd;
// bun_sys (T1) — mmap/munmap/pwrite/ftruncate/memfd_create/Result/Error/E/Tag/can_use_memfd.
use bun_sys as sys;
use bun_sys::FdExt;

use crate::webcore::blob::store::Bytes as BlobStoreBytes;

/// Intrusive thread-safe ref-counted memfd allocator.
///
/// `ref_count` must stay at this field offset for `bun_ptr::IntrusiveArc<Self>`.
pub struct LinuxMemFdAllocator {
    ref_count: bun_ptr::RefCount<LinuxMemFdAllocator>,
    pub fd: Fd,
    pub size: usize,
}

// Zig: `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
// → intrusive atomic refcount; ref/deref provided by IntrusiveArc, drop runs `deinit`.
//
// PORT NOTE: Zig used `ThreadSafeRefCount` (atomic). `bun_ptr::RefPtr<T>`
// requires `T: AnyRefCounted`, but the upstream crate only provides a blanket
// impl for the single-threaded `RefCounted` flavor (the thread-safe blanket is
// blocked on overlapping-impl rules; see `bun_ptr::ref_count` TODO). Until that
// lands we implement `RefCounted` here so `IntrusiveArc<Self>` type-checks.
// TODO(port): switch to `ThreadSafeRefCount` once
// blocked_on: bun_ptr::ThreadSafeRefCounted → AnyRefCounted blanket impl.
impl bun_ptr::RefCounted for LinuxMemFdAllocator {
    type DestructorCtx = ();

    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }

    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // Zig `deinit`: close fd, then `bun.destroy(self)`.
        // SAFETY: refcount hit 0; `this` came from `Box::into_raw` in
        // `IntrusiveArc::new`. Closing fd before reclaiming the Box.
        unsafe { (*this).fd.close() };
        // SAFETY: sole owner; reconstruct the Box so the allocation is freed.
        drop(unsafe { Box::from_raw(this) });
    }
}

pub type Ref = bun_ptr::IntrusiveArc<LinuxMemFdAllocator>;

static MEMFD_COUNTER: AtomicUsize = AtomicUsize::new(0);

impl LinuxMemFdAllocator {
    /// Zig: `pub const new = bun.TrivialNew(@This());`
    pub fn new(fd: Fd, size: usize) -> bun_ptr::IntrusiveArc<Self> {
        bun_ptr::IntrusiveArc::new(Self {
            ref_count: bun_ptr::RefCount::init(),
            fd,
            size,
        })
    }

    /// Zig: `pub const ref = RefCount.ref;`
    pub fn ref_(&self) {
        // SAFETY: `self` is a live `Self`; `RefCount::ref_` only touches the
        // interior-mutable `ref_count` field.
        unsafe { bun_ptr::RefCount::<Self>::ref_(self as *const Self as *mut Self) };
    }

    /// Zig: `pub const deref = RefCount.deref;`
    ///
    /// # Safety
    /// `this` must point to a live, Box-allocated `Self` (as produced by
    /// [`Self::new`] / `IntrusiveArc::new`), and the caller must own one
    /// outstanding ref. After this call `this` may be dangling; the caller
    /// must not hold any live `&Self`/`&mut Self` derived from `this`.
    //
    // PORT NOTE: takes `*mut Self` (not `&self`) to mirror Zig's
    // `RefCount.deref(self: *Self)`. Taking `&self` and then freeing the
    // allocation via `Box::from_raw(self as *const _ as *mut _)` is UB:
    // it materializes `&mut Self` (via `Drop`) while a shared `&self`
    // borrow is still live.
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and Box-allocated; forwards
        // to the intrusive refcount which runs `destructor` on zero.
        unsafe { bun_ptr::RefCount::<Self>::deref(this) };
    }

    /// Zig: `.{ .ptr = self, .vtable = AllocatorInterface.VTable }`
    ///
    /// # Safety
    /// `this` must be the `*mut Self` originally produced by `Box::into_raw`
    /// (via [`Self::new`] / `IntrusiveArc::new`) — the returned allocator's
    /// `free` will call [`Self::deref`] on it, which on the final ref drops
    /// the `Box`. A `*mut Self` derived from `&self` (SharedReadOnly
    /// provenance) would make that `Box::from_raw` UB.
    pub unsafe fn allocator(this: *mut Self) -> StdAllocator {
        StdAllocator {
            ptr: this.cast::<c_void>(),
            vtable: allocator_interface::VTABLE,
        }
    }

    /// Zig: `if (allocator_.vtable == AllocatorInterface.VTable) @ptrCast(@alignCast(allocator_.ptr))`
    pub fn from(allocator: StdAllocator) -> Option<*mut Self> {
        if core::ptr::eq(allocator.vtable, allocator_interface::VTABLE) {
            Some(allocator.ptr.cast::<Self>())
        } else {
            None
        }
    }

    /// Zig: `fn alloc(self: *Self, len, offset, flags: std.posix.MAP) Maybe(Blob.Store.Bytes)`
    ///
    /// # Safety
    /// `this` must be a live Box-allocated `*mut Self` (see [`Self::allocator`]).
    /// On `Ok`, the returned `Bytes` borrows one ref on `*this` (via the
    /// embedded allocator); the caller must NOT consume that ref separately.
    pub unsafe fn alloc(
        this: *mut Self,
        len: usize,
        offset: usize,
        // Zig: `std.posix.MAP` bitset. `sys::mmap` takes raw `i32` flags; callers
        // pass `libc::MAP_*` directly. `.TYPE = .SHARED` is forced below.
        flags: i32,
    ) -> sys::Result<BlobStoreBytes> {
        let mut size = len;

        // size rounded up to nearest page
        let page = bun_alloc::page_size();
        size = (size + page - 1) & !(page - 1);

        // Zig: `flags_mut.TYPE = .SHARED;`
        let flags_mut = flags | libc::MAP_SHARED;

        // SAFETY: `this` is live per caller contract; we only read scalar fields.
        let self_size = unsafe { (*this).size };
        let self_fd = unsafe { (*this).fd };

        let map_len = size.min(self_size);
        match sys::mmap(
            core::ptr::null_mut(),
            map_len,
            libc::PROT_READ | libc::PROT_WRITE,
            flags_mut,
            self_fd,
            offset as i64,
        ) {
            Ok(slice_ptr) => {
                // Zig: `Blob.Store.Bytes{ .cap = @truncate(slice.len), .ptr = slice.ptr,
                //                          .len = @truncate(len), .allocator = self.allocator() }`
                // SAFETY: `slice_ptr[0..map_len]` is the mmap'd region; `Self::allocator(this)`
                // is the vtable whose `free` will `munmap` exactly that region and then
                // `deref` `this`. `len <= map_len` (cap) by construction.
                Ok(unsafe {
                    BlobStoreBytes::from_raw_parts(
                        slice_ptr,
                        len as crate::webcore::blob::SizeType,
                        map_len as crate::webcore::blob::SizeType,
                        Self::allocator(this),
                    )
                })
            }
            Err(errno) => Err(errno),
        }
    }

    pub fn should_use(bytes: &[u8]) -> bool {
        #[cfg(not(target_os = "linux"))]
        {
            let _ = bytes;
            return false;
        }

        #[cfg(target_os = "linux")]
        {
            if !sys::can_use_memfd() {
                return false;
            }

            // MOVE_DOWN: VirtualMachine::is_smol_mode → bun_alloc (process-global flag; move-in pending).
            if bun_alloc::stubs::is_smol_mode() {
                return bytes.len() >= 1024 * 1024 * 1;
            }

            // This is a net 2x - 4x slowdown to new Blob([huge])
            // so we must be careful
            bytes.len() >= 1024 * 1024 * 8
        }
    }

    pub fn create(bytes: &[u8]) -> sys::Result<BlobStoreBytes> {
        #[cfg(not(target_os = "linux"))]
        {
            let _ = bytes;
            unreachable!();
        }

        #[cfg(target_os = "linux")]
        {
            let mut label_buf = [0u8; 128];
            // Zig: `std.fmt.bufPrintZ(&label_buf, "memfd-num-{d}", .{n}) catch ""`
            let label: &core::ffi::CStr = {
                use std::io::Write as _;
                let n = MEMFD_COUNTER.fetch_add(1, Ordering::Relaxed);
                let cap = label_buf.len() - 1;
                let mut cursor = std::io::Cursor::new(&mut label_buf[..cap]);
                match write!(cursor, "memfd-num-{}", n) {
                    Ok(()) => {
                        let written = cursor.position() as usize;
                        label_buf[written] = 0;
                        // SAFETY: we wrote `written` ASCII bytes (no interior NUL) and a NUL
                        // at `label_buf[written]`.
                        unsafe {
                            core::ffi::CStr::from_bytes_with_nul_unchecked(&label_buf[..=written])
                        }
                    }
                    Err(_) => c"",
                }
            };

            // Using huge pages was slower.
            let fd = match sys::memfd_create(label, sys::MemfdFlags::NonExecutable) {
                Err(err) => {
                    return Err(sys::Error::from_code(err.get_errno(), sys::Tag::open));
                }
                Ok(fd) => fd,
            };

            if !bytes.is_empty() {
                // Hint at the size of the file
                let _ = sys::ftruncate(fd, i64::try_from(bytes.len()).unwrap());
            }

            // Dump all the bytes in there
            let mut written: i64 = 0;

            let mut remain = bytes;
            while !remain.is_empty() {
                match sys::pwrite(fd, remain, written) {
                    Err(err) => {
                        if err.get_errno() == sys::E::EAGAIN {
                            continue;
                        }

                        bun_core::debug_warn!("Failed to write to memfd: {}", err);
                        fd.close();
                        return Err(err);
                    }
                    Ok(result) => {
                        if result == 0 {
                            bun_core::debug_warn!("Failed to write to memfd: EOF");
                            fd.close();
                            return Err(sys::Error::from_code(sys::E::ENOMEM, sys::Tag::write));
                        }
                        written += i64::try_from(result).unwrap();
                        remain = &remain[result..];
                    }
                }
            }

            let linux_memfd_allocator = Self::new(fd, bytes.len());

            // SAFETY: `IntrusiveArc::as_ptr` yields the `Box::into_raw` pointer
            // (full provenance) — required by `Self::alloc`/`Self::allocator`.
            match unsafe {
                Self::alloc(
                    linux_memfd_allocator.as_ptr(),
                    bytes.len(),
                    0,
                    libc::MAP_SHARED, // Zig: `.{ .TYPE = .SHARED }`
                )
            } {
                Ok(res) => {
                    // PORT NOTE: Zig's `Self.new` returns a raw `*Self` (refcount=1) which
                    // is transferred into `res.allocator` on success. `IntrusiveArc<Self>`
                    // has a `Drop` that would decrement here and free the allocator whose
                    // pointer is now stored in `res` (UAF). `forget` hands the +1 to `res`.
                    core::mem::forget(linux_memfd_allocator);
                    Ok(res)
                }
                Err(err) => {
                    // PORT NOTE: Zig calls `.deref()` manually; in Rust, `IntrusiveArc`'s
                    // `Drop` performs that decrement at scope exit. An explicit `.deref()`
                    // here would double-decrement.
                    Err(err)
                }
            }
        }
    }

    /// Zig: `allocator_.vtable == AllocatorInterface.VTable`
    pub fn is_instance(allocator: StdAllocator) -> bool {
        core::ptr::eq(allocator.vtable, allocator_interface::VTABLE)
    }
}

// ─── AllocatorInterface ─────────────────────────────────────────────────────
// Zig defined a private `AllocatorInterface` struct holding alloc/free/VTable.
// `bun_alloc::AllocatorVTable` is the `std.mem.Allocator.VTable` shape; the
// vtable functions are kept as raw-ptr free functions matching Zig's
// `*anyopaque` signatures so that `free` retains the `Box::into_raw` *mut
// provenance it needs to drop `self`.

mod allocator_interface {
    use super::*;

    /// # Safety
    /// No preconditions; marked `unsafe` only to match the allocator-vtable
    /// fn-pointer signature.
    unsafe fn alloc(_ptr: *mut c_void, _len: usize, _alignment: Alignment, _ret_addr: usize) -> *mut u8 {
        // it should perform no allocations or resizes
        core::ptr::null_mut()
    }

    /// Zig: `fn free(ptr: *anyopaque, buf: []u8, _, _) void`
    ///
    /// # Safety
    /// `ptr` must be the `*mut LinuxMemFdAllocator` originally produced by
    /// `Box::into_raw` (via [`LinuxMemFdAllocator::new`] / `IntrusiveArc::new`)
    /// and the caller must own one outstanding ref on it. No `&Self`/`&mut Self`
    /// borrow of `*ptr` may be live across this call — when the refcount hits
    /// zero, `*ptr` is dropped and freed.
    ///
    /// `buf` must describe the exact `mmap` region previously returned for this
    /// allocator. The region is unmapped on return; the caller must not access
    /// it afterwards.
    unsafe fn free(ptr: *mut c_void, buf: &mut [u8], _alignment: Alignment, _ret_addr: usize) {
        // Zig: `var self: *Self = @ptrCast(@alignCast(ptr)); defer self.deref();`
        // — runs after munmap regardless of result.
        //
        // PORT NOTE: takes the raw vtable data pointer (Zig's `*anyopaque`)
        // directly rather than `&self`. `deref` may free the allocation, which
        // requires `*mut Self` with full `Box::into_raw` provenance; deriving
        // it from a `&self` (`as *const _ as *mut _`) would be SharedReadOnly
        // provenance and the `Box::from_raw` → `Drop` write would be UB under
        // Stacked Borrows.
        let this = ptr.cast::<LinuxMemFdAllocator>();
        match sys::munmap(buf.as_mut_ptr(), buf.len()) {
            Ok(()) => {}
            Err(err) => {
                bun_core::debug_warn!("Failed to munmap memfd: {}", err);
            }
        }
        // SAFETY: caller contract — `this` is the Box-allocated `*mut Self` and
        // we hold one ref. No live `&Self` exists (we never materialized one).
        unsafe { LinuxMemFdAllocator::deref(this) };
    }

    /// `std.mem.Allocator.VTable{ .alloc, .resize = noResize, .remap = noRemap, .free }`
    pub(super) static VTABLE: &AllocatorVTable = &AllocatorVTable {
        alloc,
        resize: AllocatorVTable::NO_RESIZE,
        remap: AllocatorVTable::NO_REMAP,
        free,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/LinuxMemFdAllocator.zig (195 lines)
//   confidence: high
//   todos:      1
//   notes:      Vtable identity via `bun_alloc::AllocatorVTable` (mirrors Zig `std.mem.Allocator`). `Bytes` reshaped upstream to ptr/len/cap/StdAllocator so mmap-backed buffers free via `munmap`+deref. `allocator()`/`alloc()` take `*mut Self` (Box provenance) — `&self` would be UB on final deref. `create()` forgets the IntrusiveArc on Ok to transfer the +1 into Bytes.allocator.
// ──────────────────────────────────────────────────────────────────────────
