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
//
// Zig: `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
// → intrusive *atomic* refcount. Blob stores (and thus this allocator, smuggled
// through `StdAllocator.ptr`) cross threads, so the single-threaded `RefCount`
// flavor would data-race on ref/deref.
#[derive(bun_ptr::ThreadSafeRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct LinuxMemFdAllocator {
    ref_count: bun_ptr::ThreadSafeRefCount<LinuxMemFdAllocator>,
    pub fd: Fd,
    pub size: usize,
}

impl LinuxMemFdAllocator {
    /// Zig `deinit`: close fd, then `bun.destroy(self)`.
    ///
    /// # Safety
    /// Refcount hit 0; `this` came from `heap::alloc` in `IntrusiveArc::new`.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: sole owner — close fd before reclaiming the Box.
        unsafe { (*this).fd.close() };
        // SAFETY: sole owner; reconstruct the Box so the allocation is freed.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

pub type Ref = bun_ptr::IntrusiveArc<LinuxMemFdAllocator>;

static MEMFD_COUNTER: AtomicUsize = AtomicUsize::new(0);

impl LinuxMemFdAllocator {
    /// Zig: `pub const new = bun.TrivialNew(@This());`
    pub fn new(fd: Fd, size: usize) -> bun_ptr::IntrusiveArc<Self> {
        bun_ptr::IntrusiveArc::new(Self {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            fd,
            size,
        })
    }

    /// Zig: `pub const ref = RefCount.ref;`
    pub fn ref_(&self) {
        // SAFETY: `self` is a live `Self`; `ThreadSafeRefCount::ref_` only
        // touches the interior-mutable atomic `ref_count` field.
        unsafe {
            bun_ptr::ThreadSafeRefCount::<Self>::ref_(std::ptr::from_ref::<Self>(self).cast_mut())
        };
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
    // allocation via `heap::take(self as *const _ as *mut _)` is UB:
    // it materializes `&mut Self` (via `Drop`) while a shared `&self`
    // borrow is still live.
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and Box-allocated; forwards
        // to the intrusive refcount which runs `destructor` on zero.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    /// Zig: `.{ .ptr = self, .vtable = AllocatorInterface.VTable }`
    ///
    /// # Safety
    /// `this` must be the `*mut Self` originally produced by `heap::alloc`
    /// (via [`Self::new`] / `IntrusiveArc::new`) — the returned allocator's
    /// `free` will call [`Self::deref`] on it, which on the final ref drops
    /// the `Box`. A `*mut Self` derived from `&self` (SharedReadOnly
    /// provenance) would make that `heap::take` UB.
    pub unsafe fn allocator(this: *mut Self) -> StdAllocator {
        StdAllocator {
            ptr: this.cast::<c_void>(),
            vtable: allocator_interface::VTABLE,
        }
    }

    /// Zig: `if (allocator_.vtable == AllocatorInterface.VTable) @ptrCast(@alignCast(allocator_.ptr))`
    pub fn from(alloc: StdAllocator) -> Option<*mut Self> {
        if core::ptr::eq(alloc.vtable, allocator_interface::VTABLE) {
            Some(alloc.ptr.cast::<Self>())
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
        // memfd + mmap are POSIX-only; on Windows `should_use()` always
        // returns false so this path is unreachable. Guard the body so
        // `libc::MAP_*`/`PROT_*` (which don't exist on `*-windows-msvc`)
        // never participate in name resolution.
        #[cfg(windows)]
        {
            let _ = (this, len, offset, flags);
            return sys::Result::Err(sys::Error::from_code(sys::E::NOSYS, sys::Tag::mmap));
        }
        #[cfg(not(windows))]
        {
            let mut size = len;

            // size rounded up to nearest page
            let page = bun_alloc::page_size();
            size = (size + page - 1) & !(page - 1);

            // Zig: `flags_mut.TYPE = .SHARED;` — `TYPE` is the low-4-bit field of
            // `std.posix.MAP`, so this *replaces* it (not OR). Mask out the
            // existing TYPE bits first so e.g. an incoming `MAP_PRIVATE` (0x02)
            // becomes `MAP_SHARED` (0x01), not `MAP_SHARED_VALIDATE` (0x03).
            #[cfg(target_os = "linux")]
            const MAP_TYPE: i32 = libc::MAP_TYPE;
            #[cfg(not(target_os = "linux"))]
            const MAP_TYPE: i32 = 0x0f; // `std.posix.MAP.TYPE` is `u4` on every POSIX target
            let flags_mut = (flags & !MAP_TYPE) | libc::MAP_SHARED;

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
                    //                          .len = @truncate(len), .allocator = self.arena() }`
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
        } // #[cfg(not(windows))]
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

            if crate::jsc::VirtualMachine::is_smol_mode() {
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
                        // `written` ASCII bytes (no interior NUL) + NUL at `label_buf[written]`.
                        bun_core::ZStr::from_buf(&label_buf, written).as_cstr()
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
                let _ = sys::ftruncate(fd, i64::try_from(bytes.len()).expect("int cast"));
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
                        written += i64::try_from(result).expect("int cast");
                        remain = &remain[result..];
                    }
                }
            }

            // PORT NOTE: Zig's `Self.new` returns a raw `*Self` (refcount=1).
            // `into_raw()` extracts the `heap::alloc` pointer and transfers
            // the +1 to us (RefPtr has no `Drop`); on `Ok` that ref moves into
            // `res.allocator`, on `Err` we `deref` it explicitly — exactly the
            // Zig flow.
            let memfd: *mut Self = Self::new(fd, bytes.len()).into_raw();

            // SAFETY: `memfd` is the `heap::alloc` pointer
            // (full provenance) with one live ref — required by `Self::alloc`.
            match unsafe {
                Self::alloc(
                    memfd,
                    bytes.len(),
                    0,
                    libc::MAP_SHARED, // Zig: `.{ .TYPE = .SHARED }`
                )
            } {
                Ok(res) => Ok(res),
                Err(err) => {
                    // SAFETY: we still own the +1 from `into_raw()`; release it
                    // (closes the fd and frees the Box on hitting zero).
                    unsafe { Self::deref(memfd) };
                    Err(err)
                }
            }
        }
    }

    /// Zig: `allocator_.vtable == AllocatorInterface.VTable`
    pub fn is_instance(alloc: StdAllocator) -> bool {
        core::ptr::eq(alloc.vtable, allocator_interface::VTABLE)
    }
}

// ─── AllocatorInterface ─────────────────────────────────────────────────────
// Zig defined a private `AllocatorInterface` struct holding alloc/free/VTable.
// `bun_alloc::AllocatorVTable` is the `std.mem.Allocator.VTable` shape; the
// vtable functions are kept as raw-ptr free functions matching Zig's
// `*anyopaque` signatures so that `free` retains the `heap::alloc` *mut
// provenance it needs to drop `self`.

mod allocator_interface {
    use super::*;

    /// Zig: `fn free(ptr: *anyopaque, buf: []u8, _, _) void`
    ///
    /// # Safety
    /// `ptr` must be the `*mut LinuxMemFdAllocator` originally produced by
    /// `heap::alloc` (via [`LinuxMemFdAllocator::new`] / `IntrusiveArc::new`)
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
        // requires `*mut Self` with full `heap::alloc` provenance; deriving
        // it from a `&self` (`as *const _ as *mut _`) would be SharedReadOnly
        // provenance and the `heap::take` → `Drop` write would be UB under
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

    /// `std.mem.Allocator.VTable{ .alloc = noAlloc, .resize = noResize, .remap = noRemap, .free }`
    /// Own static — address is the identity tag for `is_instance`.
    pub(super) static VTABLE: &AllocatorVTable = &AllocatorVTable::free_only(free);
}

/// For `bun_safety::register_alloc_vtable` (see `super::register_safety_vtables`).
#[inline]
pub(super) fn std_vtable() -> &'static AllocatorVTable {
    allocator_interface::VTABLE
}

// ported from: src/bun_alloc/LinuxMemFdAllocator.zig
