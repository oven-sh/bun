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
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use bun_alloc::Allocator;
use bun_core::Fd;
// bun_sys (T1) — mmap/munmap/pwrite/ftruncate/memfd_create/Result/Error/E/Tag/can_use_memfd.
use bun_sys as sys;
// TODO(b0-genuine): crate::webcore::blob::store::Bytes — return-value struct constructed
// inline (cap/ptr/len/allocator). Not dispatch; not a hook. Candidate fix: define a local
// `MemFdBytes { cap: u32, ptr: *mut u8, len: u32, allocator: ... }` here and have runtime convert,
// or hoist `alloc()`/`create()` into bun_runtime via the move-in pass.
use crate::webcore::blob::store::Bytes as BlobStoreBytes;

/// Intrusive thread-safe ref-counted memfd allocator.
///
/// `ref_count` must stay at this field offset for `bun_ptr::IntrusiveArc<Self>`.
pub struct LinuxMemFdAllocator {
    ref_count: AtomicU32,
    pub fd: Fd,
    pub size: usize,
}

// Zig: `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
// → intrusive atomic refcount; ref/deref provided by IntrusiveArc, drop runs `deinit`.
pub type Ref = bun_ptr::IntrusiveArc<LinuxMemFdAllocator>;

static MEMFD_COUNTER: AtomicUsize = AtomicUsize::new(0);

impl Drop for LinuxMemFdAllocator {
    // Zig `deinit`: close fd; `bun.destroy(self)` is handled by IntrusiveArc's dealloc.
    fn drop(&mut self) {
        self.fd.close();
    }
}

impl LinuxMemFdAllocator {
    /// Zig: `pub const new = bun.TrivialNew(@This());`
    pub fn new(fd: Fd, size: usize) -> bun_ptr::IntrusiveArc<Self> {
        bun_ptr::IntrusiveArc::new(Self {
            ref_count: AtomicU32::new(1),
            fd,
            size,
        })
    }

    /// Zig: `pub const ref = RefCount.ref;`
    pub fn ref_(&self) {
        // Provided by IntrusiveArc; explicit here to mirror the Zig pub re-export.
        self.ref_count.fetch_add(1, Ordering::Relaxed);
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
    // TODO(port): route through `bun_ptr::ThreadSafeRefCount::<Self>::deref`
    // once `Self: ThreadSafeRefCounted` is wired up.
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: `ref_count` is `AtomicU32` (interior-mut); raw-ptr read is
        // sound while `this` is live per caller contract.
        if unsafe { (*this).ref_count.fetch_sub(1, Ordering::AcqRel) } == 1 {
            // SAFETY: refcount hit zero; we are the unique owner. Reconstruct
            // the Box that `new` leaked so `Drop` runs and the allocation is
            // freed. `this` has `*mut` provenance from `Box::into_raw`.
            drop(unsafe { Box::from_raw(this) });
        }
    }

    pub fn allocator(&self) -> &dyn Allocator {
        // Zig returned `std.mem.Allocator{ .ptr = self, .vtable = AllocatorInterface.VTable }`.
        // The trait impl below is the vtable; `self` is the data pointer.
        self
    }

    pub fn from<'a>(allocator: &'a dyn Allocator) -> Option<&'a Self> {
        // Zig compared vtable pointer identity. `bun_alloc::Allocator` exposes
        // `type_id()` for exactly this — concrete-type identity on the trait object.
        if Allocator::type_id(allocator) == core::any::TypeId::of::<Self>() {
            // SAFETY: type_id matched our impl, so the data pointer is `*const Self`.
            Some(unsafe { &*(allocator as *const dyn Allocator as *const Self) })
        } else {
            None
        }
    }

    pub fn alloc(
        &self,
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

        let map_len = size.min(self.size);
        match sys::mmap(
            core::ptr::null_mut(),
            map_len,
            libc::PROT_READ | libc::PROT_WRITE,
            flags_mut,
            self.fd,
            offset as i64,
        ) {
            Ok(ptr) => {
                // Zig: `Blob.Store.Bytes{ .cap = @truncate(slice.len), .ptr = slice.ptr,
                //                          .len = @truncate(len), .allocator = self.allocator() }`
                // PORT NOTE: `webcore::blob::store::Bytes` was reshaped to wrap a
                // `Vec<u8>` (private `data` field) and no longer exposes raw
                // ptr/len/cap/allocator construction. mmap'd memory cannot be
                // placed into a `Vec<u8>` (its `Drop` would `free()` the mapping).
                // This requires a `Bytes::from_raw_parts(ptr, len, cap, allocator)`
                // constructor on the upstream type before this path is usable.
                let _ = (ptr, map_len, len);
                todo!("blocked_on: webcore::blob::store::Bytes raw ptr/len/cap/allocator constructor")
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

            match linux_memfd_allocator.alloc(
                bytes.len(),
                0,
                libc::MAP_SHARED, // Zig: `.{ .TYPE = .SHARED }`
            ) {
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

    pub fn is_instance(allocator: &dyn Allocator) -> bool {
        Self::from(allocator).is_some()
    }
}

// ─── AllocatorInterface ─────────────────────────────────────────────────────
// Zig defined a private `AllocatorInterface` struct holding alloc/free/VTable.
// `bun_alloc::Allocator` is a marker trait (type_id-only); the vtable functions
// are kept as raw-ptr free functions matching Zig's `*anyopaque` signatures so
// that `free` retains the `Box::into_raw` *mut provenance it needs to drop `self`.

impl Allocator for LinuxMemFdAllocator {
    // resize/remap: Zig used `std.mem.Allocator.noResize` / `noRemap`.
    // `bun_alloc::Allocator` is a marker trait — only `type_id()` is provided.
}

mod allocator_interface {
    use super::*;

    /// # Safety
    /// No preconditions; marked `unsafe` only to match the allocator-vtable
    /// fn-pointer signature.
    pub(super) unsafe fn alloc(
        _ptr: *mut c_void,
        _len: usize,
        _alignment: usize,
        _ret_addr: usize,
    ) -> Option<*mut u8> {
        // it should perform no allocations or resizes
        None
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
    /// `buf_ptr`/`buf_len` must describe the exact `mmap` region previously
    /// returned for this allocator. The region is unmapped on return; the
    /// caller must not access it afterwards.
    pub(super) unsafe fn free(
        ptr: *mut c_void,
        // Zig `buf: []u8` — raw ptr+len pair. Kept as raw pointers (NOT
        // `&mut [u8]`) because (a) this is `MAP_SHARED` memfd memory that may
        // be concurrently mapped elsewhere, so a `&mut` uniqueness assertion
        // is unsound, and (b) once `munmap` returns the pages are gone and any
        // still-live reference would dangle (UB). Raw pointers carry no
        // validity/aliasing invariants, matching the Zig slice semantics.
        buf_ptr: *mut u8,
        buf_len: usize,
        _alignment: usize,
        _ret_addr: usize,
    ) {
        // Zig: `var self: *Self = @ptrCast(@alignCast(ptr)); defer self.deref();`
        // — runs after munmap regardless of result.
        //
        // PORT NOTE: takes the raw vtable data pointer (Zig's `*anyopaque`)
        // directly rather than `&self`. `deref` may free the allocation, which
        // requires `*mut Self` with full `Box::into_raw` provenance; deriving
        // it from a `&self` (`as *const _ as *mut _`) would be SharedReadOnly
        // provenance and the `Box::from_raw` → `Drop` write would be UB under
        // Stacked Borrows.
        let this = ptr as *mut LinuxMemFdAllocator;
        match sys::munmap(buf_ptr, buf_len) {
            Ok(()) => {}
            Err(err) => {
                bun_core::debug_warn!("Failed to munmap memfd: {}", err);
            }
        }
        // SAFETY: caller contract — `this` is the Box-allocated `*mut Self` and
        // we hold one ref. No live `&Self` exists (we never materialized one).
        unsafe { LinuxMemFdAllocator::deref(this) };
    }

    // TODO(port): expose a `std.mem.Allocator.VTable`-shaped static once the
    // crate-level dynamic-allocator vtable type lands, wiring `alloc`/`free`
    // above plus `noResize`/`noRemap`.
}

// Probe instance used only for vtable-identity comparison in `from()`.
// TODO(port): remove once `crate::Allocator` exposes a proper downcast/type_id hook.
static PROBE: LinuxMemFdAllocator = LinuxMemFdAllocator {
    ref_count: AtomicU32::new(0),
    fd: Fd::INVALID,
    size: 0,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/LinuxMemFdAllocator.zig (195 lines)
//   confidence: medium
//   todos:      9
//   notes:      vtable-identity downcast (from/is_instance) needs crate::Allocator type_id; std.posix.MAP/PROT, page_size, BlobStoreBytes path, VirtualMachine::is_smol_mode are guessed symbol names; IntrusiveArc owns dealloc so Drop only closes fd; create() forgets the IntrusiveArc on Ok to transfer the +1 into Bytes.allocator.
// ──────────────────────────────────────────────────────────────────────────
