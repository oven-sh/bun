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

use bun_sys::{self as sys, Fd};
// TODO(port): exact module path for Blob.Store.Bytes — nested Zig decls; Phase B confirms.
use bun_runtime::webcore::blob::store::Bytes as BlobStoreBytes;

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
    pub fn deref(&self) {
        // TODO(port): IntrusiveArc::deref handles the fence + drop + dealloc; this
        // hand-rolled body is a placeholder so call sites translate 1:1. Phase B
        // should route through `bun_ptr::IntrusiveArc::<Self>::deref_raw(self)`.
        if self.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            // SAFETY: refcount hit zero; we are the unique owner. Reconstruct the
            // Box that `new` leaked so Drop runs and the allocation is freed.
            unsafe {
                drop(Box::from_raw(self as *const Self as *mut Self));
            }
        }
    }

    pub fn allocator(&self) -> &dyn crate::Allocator {
        // Zig returned `std.mem.Allocator{ .ptr = self, .vtable = AllocatorInterface.VTable }`.
        // The trait impl below is the vtable; `self` is the data pointer.
        self
    }

    pub fn from<'a>(allocator: &'a dyn crate::Allocator) -> Option<&'a Self> {
        // Zig compared vtable pointer identity. Rust `&dyn Trait` does not expose
        // vtable identity portably.
        // TODO(port): use `core::any::Any` downcast or a `crate::Allocator::type_id()`
        // method to recover `&Self`. Placeholder uses raw vtable-ptr compare.
        let (_data, vtable) = {
            // SAFETY: `&dyn Trait` is a (data, vtable) fat pointer; transmute to read vtable addr.
            let raw: [*const c_void; 2] =
                unsafe { core::mem::transmute::<&dyn crate::Allocator, _>(allocator) };
            (raw[0], raw[1])
        };
        let self_vtable: *const c_void = {
            let probe: &dyn crate::Allocator = &PROBE;
            // SAFETY: same as above.
            let raw: [*const c_void; 2] =
                unsafe { core::mem::transmute::<&dyn crate::Allocator, _>(probe) };
            raw[1]
        };
        if core::ptr::eq(vtable, self_vtable) {
            // SAFETY: vtable matched our impl, so the data pointer is `*const Self`.
            Some(unsafe { &*(_data as *const Self) })
        } else {
            None
        }
    }

    pub fn alloc(
        &self,
        len: usize,
        offset: usize,
        flags: sys::posix::MapFlags, // TODO(port): exact type for `std.posix.MAP`
    ) -> sys::Result<BlobStoreBytes> {
        let mut size = len;

        // size rounded up to nearest page
        // TODO(port): `std.heap.pageSize()` — use bun_sys::page_size() once available.
        let page = sys::page_size();
        size = (size + page - 1) & !(page - 1);

        let mut flags_mut = flags;
        flags_mut.set_type(sys::posix::MapType::Shared); // TODO(port): exact API for `.TYPE = .SHARED`

        match sys::mmap(
            core::ptr::null_mut(),
            size.min(self.size),
            sys::posix::PROT_READ | sys::posix::PROT_WRITE,
            flags_mut,
            self.fd,
            offset,
        ) {
            Ok(slice) => Ok(BlobStoreBytes {
                cap: slice.len() as u32,       // @truncate
                ptr: slice.as_mut_ptr(),
                len: len as u32,               // @truncate
                allocator: self.allocator(),   // TODO(port): Bytes.allocator field type
            }),
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

            // TODO(port): `bun.jsc.VirtualMachine.is_smol_mode` is a process-global flag.
            if bun_jsc::VirtualMachine::is_smol_mode() {
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
            let label: &bun_str::ZStr = {
                use core::fmt::Write as _;
                let n = MEMFD_COUNTER.fetch_add(1, Ordering::Relaxed);
                // Zig: `std.fmt.bufPrintZ(&label_buf, "memfd-num-{d}", .{n}) catch ""`
                let mut cursor = bun_str::BufWriter::new(&mut label_buf[..label_buf.len() - 1]);
                match write!(cursor, "memfd-num-{}", n) {
                    Ok(()) => {
                        let written = cursor.written();
                        label_buf[written] = 0;
                        // SAFETY: we wrote `written` bytes and a NUL at `label_buf[written]`.
                        unsafe { bun_str::ZStr::from_raw(label_buf.as_ptr(), written) }
                    }
                    Err(_) => bun_str::ZStr::EMPTY,
                }
            };

            // Using huge pages was slower.
            let fd = match sys::memfd_create(label, sys::MemfdFlags::NON_EXECUTABLE) {
                Err(err) => {
                    return Err(sys::Error::from_code(err.errno(), sys::Tag::Open));
                }
                Ok(fd) => fd,
            };

            if !bytes.is_empty() {
                // Hint at the size of the file
                let _ = sys::ftruncate(fd, i64::try_from(bytes.len()).unwrap());
            }

            // Dump all the bytes in there
            let mut written: isize = 0;

            let mut remain = bytes;
            while !remain.is_empty() {
                match sys::pwrite(fd, remain, written) {
                    Err(err) => {
                        if err.errno() == sys::Errno::AGAIN {
                            continue;
                        }

                        bun_core::output::debug_warn!("Failed to write to memfd: {}", err);
                        fd.close();
                        return Err(err);
                    }
                    Ok(result) => {
                        if result == 0 {
                            bun_core::output::debug_warn!("Failed to write to memfd: EOF");
                            fd.close();
                            return Err(sys::Error::from_code(sys::Errno::NOMEM, sys::Tag::Write));
                        }
                        written += isize::try_from(result).unwrap();
                        remain = &remain[result..];
                    }
                }
            }

            let linux_memfd_allocator = Self::new(fd, bytes.len());

            match linux_memfd_allocator.alloc(
                bytes.len(),
                0,
                sys::posix::MapFlags::shared(), // TODO(port): `.{ .TYPE = .SHARED }`
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

    pub fn is_instance(allocator: &dyn crate::Allocator) -> bool {
        Self::from(allocator).is_some()
    }
}

// ─── AllocatorInterface ─────────────────────────────────────────────────────
// Zig defined a private `AllocatorInterface` struct holding alloc/free/VTable.
// In Rust this is `impl crate::Allocator for LinuxMemFdAllocator`.

impl crate::Allocator for LinuxMemFdAllocator {
    fn alloc(&self, _len: usize, _alignment: usize, _ret_addr: usize) -> Option<*mut u8> {
        // it should perform no allocations or resizes
        None
    }

    fn free(&self, buf: &mut [u8], _alignment: usize, _ret_addr: usize) {
        // Zig: `defer self.deref();` — runs after munmap regardless of result.
        let guard = scopeguard::guard((), |_| self.deref());
        match sys::munmap(buf) {
            Ok(()) => {}
            Err(err) => {
                bun_core::output::debug_warn!("Failed to munmap memfd: {}", err);
            }
        }
        drop(guard);
    }

    // resize/remap: Zig used `std.mem.Allocator.noResize` / `noRemap`.
    // TODO(port): rely on `crate::Allocator` default no-op impls for resize/remap.
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
