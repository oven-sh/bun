use core::ffi::{c_uint, c_void};
use core::ptr;

use crate as jsc;
use crate::SysErrorJsc;
use crate::{ComptimeStringMapExt as _, JSGlobalObject, JSType, JSValue, JsResult};
use bun_alloc::mimalloc;
use bun_sys::{self, Fd, FdExt};

bun_core::declare_scope!(ArrayBuffer, visible);

/// `void (*)(void* bytes, void* deallocatorContext)` called when a
/// zero-copy ArrayBuffer/typed array backing store is collected. Not
/// necessarily on the creating thread: a transferred buffer's contents are
/// destroyed on the receiving Worker's thread (or wherever an undelivered
/// message is dropped), so the callback must be thread-safe.
pub type JSTypedArrayBytesDeallocator = Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;

// ──────────────────────────────────────────────────────────────────────────
// ArrayBuffer
// ──────────────────────────────────────────────────────────────────────────

// Clone/Copy: bitwise OK — `ptr` borrows the backing store of the JS
// ArrayBuffer kept alive by `value`; this struct is a non-owning view.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ArrayBuffer {
    pub ptr: *mut u8,
    pub len: usize,
    pub byte_len: usize,
    pub value: JSValue,
    pub typed_array_type: JSType,
    pub shared: bool,
    /// True for resizable ArrayBuffer or growable SharedArrayBuffer — borrowing
    /// a slice from one is unsafe (it can shrink/reallocate underneath you).
    pub resizable: bool,
}

impl Default for ArrayBuffer {
    fn default() -> Self {
        Self {
            ptr: ptr::null_mut(),
            len: 0,
            byte_len: 0,
            value: JSValue::ZERO,
            typed_array_type: JSType::Cell,
            shared: false,
            resizable: false,
        }
    }
}

// Aliasing: `JSGlobalObject` is an opaque ZST handle on the Rust side — the
// `&JSGlobalObject` reference covers zero bytes, and all mutation happens inside
// C++ on memory Rust never observes. Declaring the FFI parameter as
// `*const JSGlobalObject` (ABI-identical) lets `&JSGlobalObject` coerce directly
// without a `&T as *const T as *mut T` provenance laundering cast. This matches
// the pattern used by `JSGlobalObject`'s own extern block in `JSGlobalObject.rs`.
unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `addr`/`len` are an opaque mmap region
    // C++ stores into the Buffer's `ArrayBufferContents` (adopted, freed via
    // munmap by JSC). Unlike `Bun__makeArrayBufferWithBytesNoCopy` below this
    // is not reachable with caller-chosen pointers: the only caller
    // (`to_js_buffer_from_memfd`) maps `addr` itself via `bun_sys::mmap`, so
    // the validity proof is discharged at that single call site.
    safe fn JSBuffer__fromMmap(global: &JSGlobalObject, addr: *mut c_void, len: usize) -> JSValue;
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); remaining args are by-value scalars.
    safe fn ArrayBuffer__fromSharedMemfd(
        fd: i64,
        global: &JSGlobalObject,
        byte_offset: usize,
        byte_length: usize,
        total_size: usize,
        ty: JSType,
    ) -> JSValue;
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle;
    // `&mut *mut u8` is ABI-identical to a non-null `void**` out-param the
    // callee fills on success.
    safe fn Bun__allocUint8ArrayForCopy(
        global: &JSGlobalObject,
        len: usize,
        out: &mut *mut u8,
    ) -> JSValue;
    safe fn Bun__allocArrayBufferForCopy(
        global: &JSGlobalObject,
        len: usize,
        out: &mut *mut u8,
    ) -> JSValue;
    fn Bun__createUint8ArrayForCopy(
        global: *const JSGlobalObject,
        ptr: *const c_void,
        len: usize,
        buffer: bool,
    ) -> JSValue;
    fn Bun__createArrayBufferForCopy(
        global: *const JSGlobalObject,
        ptr: *const c_void,
        len: usize,
    ) -> JSValue;
    fn JSArrayBuffer__fromDefaultAllocator(
        global: *const JSGlobalObject,
        ptr: *mut u8,
        len: usize,
    ) -> JSValue;
    // NOT `safe`: C++ adopts `ptr..ptr+len` as the backing store of a
    // JS-visible ArrayBuffer (every JS read/write dereferences it) and calls
    // `dealloc(ptr, ctx)` on GC, so these are unsafe to call with arbitrary
    // values. The validity obligation is the documented `# Safety` contract
    // of the `unsafe` public wrappers (`make_*_with_bytes_no_copy`) below.
    fn Bun__makeArrayBufferWithBytesNoCopy(
        global: &JSGlobalObject,
        ptr: *mut c_void,
        len: usize,
        dealloc: JSTypedArrayBytesDeallocator,
        ctx: *mut c_void,
    ) -> JSValue;
    fn Bun__makeTypedArrayWithBytesNoCopy(
        global: &JSGlobalObject,
        ty: TypedArrayType,
        ptr: *mut c_void,
        len: usize,
        dealloc: JSTypedArrayBytesDeallocator,
        ctx: *mut c_void,
    ) -> JSValue;
    fn Bun__createTypedArrayForCopy(
        global: *const JSGlobalObject,
        ty: TypedArrayType,
        ptr: *const c_void,
        len: usize,
    ) -> JSValue;
    fn JSC__ArrayBuffer__asBunArrayBuffer(self_: *mut JSCArrayBuffer, out: *mut ArrayBuffer);
    // safe: `JSCArrayBuffer` is an `opaque_ffi!` ZST handle (`!Freeze` via
    // `UnsafeCell`); `&` is ABI-identical to a non-null `*mut` and the C++
    // `RefCounted<ArrayBuffer>` count mutation is interior to the opaque cell.
    safe fn JSC__ArrayBuffer__ref(self_: &JSCArrayBuffer);
    safe fn JSC__ArrayBuffer__deref(self_: &JSCArrayBuffer);
    // safe: by-value `JSValue`; no-op for non-buffer values.
    safe fn JSC__JSValue__unpinArrayBuffer(v: JSValue);
}

impl JSValue {
    /// Releases a pin taken on this value's backing `JSC::ArrayBuffer` by
    /// [`JSValue::as_pinned_arraybuffer`] or a pinning collector.
    pub fn unpin_array_buffer(self) {
        JSC__JSValue__unpinArrayBuffer(self);
    }
}

impl ArrayBuffer {
    pub fn is_detached(&self) -> bool {
        self.ptr.is_null()
    }

    /// Releases the pin taken by [`JSValue::as_pinned_arraybuffer`].
    pub fn unpin(&self) {
        self.value.unpin_array_buffer();
    }

    // require('buffer').kMaxLength.
    // keep in sync with Bun::Buffer::kMaxLength
    pub const MAX_SIZE: c_uint = c_uint::MAX;

    // 4 MB or so is pretty good for mmap()
    const MMAP_THRESHOLD: usize = 1024 * 1024 * 4;

    pub fn bytes_per_element(&self) -> Option<u8> {
        match self.typed_array_type {
            JSType::ArrayBuffer | JSType::DataView => None,
            JSType::Uint8Array | JSType::Uint8ClampedArray | JSType::Int8Array => Some(1),
            JSType::Uint16Array | JSType::Int16Array | JSType::Float16Array => Some(2),
            JSType::Uint32Array | JSType::Int32Array | JSType::Float32Array => Some(4),
            JSType::BigUint64Array | JSType::BigInt64Array | JSType::Float64Array => Some(8),
            _ => None,
        }
    }
}

impl ArrayBuffer {
    /// Only use this when reading from the file descriptor is _very_ cheap. Like, for example, an in-memory file descriptor.
    /// Do not use this for pipes, however tempting it may seem.
    pub fn to_js_buffer_from_fd(fd: Fd, size: usize, global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI — `global` is a live &JSGlobalObject (opaque ZST handle, coerces to
        // *const); fn accepts null ptr with explicit size.
        // Wrapped in `from_js_host_call` so the C++ throw scope opened by
        // `Bun__createUint8ArrayForCopy` is checked before `as_array_buffer` below
        // declares `ASSERT_NO_PENDING_EXCEPTION` (validateExceptionChecks).
        let buffer_value = match crate::host_fn::from_js_host_call(global, || unsafe {
            Bun__createUint8ArrayForCopy(global, ptr::null(), size, true)
        }) {
            Ok(v) => v,
            Err(_) => return JSValue::ZERO,
        };

        let mut array_buffer = buffer_value.as_array_buffer(global).expect("Unexpected");
        let mut bytes = array_buffer.byte_slice_mut();

        buffer_value.ensure_still_alive();

        let mut read: isize = 0;
        while !bytes.is_empty() {
            match bun_sys::pread(fd, bytes, read as i64) {
                bun_sys::Result::Ok(amount) => {
                    bytes = &mut bytes[amount..];
                    read += isize::try_from(amount).expect("int cast");

                    if amount == 0 {
                        if !bytes.is_empty() {
                            bytes.fill(0);
                        }
                        break;
                    }
                }
                bun_sys::Result::Err(err) => {
                    let err_js = err.to_js(global);
                    let _ = global.throw_value(err_js);
                    return JSValue::ZERO;
                }
            }
        }

        buffer_value.ensure_still_alive();

        buffer_value
    }

    #[inline]
    pub fn to_array_buffer_from_shared_memfd(
        fd: i64,
        global: &JSGlobalObject,
        byte_offset: usize,
        byte_length: usize,
        total_size: usize,
        ty: JSType,
    ) -> JSValue {
        ArrayBuffer__fromSharedMemfd(fd, global, byte_offset, byte_length, total_size, ty)
    }

    pub fn to_js_buffer_from_memfd(fd: Fd, global: &JSGlobalObject) -> JsResult<JSValue> {
        let stat = match bun_sys::fstat(fd) {
            bun_sys::Result::Err(err) => {
                fd.close();
                return Err(global.throw_value(err.to_js(global)));
            }
            bun_sys::Result::Ok(fstat) => fstat,
        };

        let size = stat.st_size;

        if size == 0 {
            fd.close();
            return Self::create_buffer(global, b"");
        }

        // mmap() is kind of expensive to do
        // It creates a new memory mapping.
        // If there is a lot of repetitive memory allocations in a tight loop, it performs poorly.
        // So we clone it when it's small.
        // `stat.st_size` is `i64` on POSIX, `u64` on the libuv stat struct.
        if (size as i64) < Self::MMAP_THRESHOLD as i64 {
            let result =
                Self::to_js_buffer_from_fd(fd, usize::try_from(size).expect("int cast"), global);
            fd.close();
            return Ok(result);
        }

        // bun_sys::mmap takes raw i32 prot/flags.
        // Windows impl ignores these and returns ENOTSUP.
        #[cfg(unix)]
        let (prot, map_flags) = (libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED);
        #[cfg(not(unix))]
        let (prot, map_flags) = (0i32, 0i32);
        let map_len = usize::try_from(size.max(0)).expect("int cast");
        let result = bun_sys::mmap(ptr::null_mut(), map_len, prot, map_flags, fd, 0);
        fd.close();

        match result {
            bun_sys::Result::Ok(buf) => {
                // `buf` is a fresh mmap region whose ownership transfers to JSC.
                Ok(JSBuffer__fromMmap(global, buf.cast(), map_len))
            }
            bun_sys::Result::Err(err) => {
                let err_js = err.to_js(global);
                let _ = global.throw_value(err_js);
                Ok(JSValue::ZERO)
            }
        }
    }

    pub const EMPTY: ArrayBuffer = ArrayBuffer {
        ptr: core::ptr::NonNull::<u8>::dangling().as_ptr(), // non-null empty
        len: 0,
        byte_len: 0,
        value: JSValue::ZERO,
        typed_array_type: JSType::Uint8Array,
        shared: false,
        resizable: false,
    };

    pub const NAME: &'static str = "Bun__ArrayBuffer";

    #[inline]
    pub fn stream(self) -> ArrayBufferStream<'static> {
        // Lifetime: the stream is over self.slice() (raw ptr-backed); the
        // caller must keep the backing JSValue alive for the stream's lifetime.
        // Spec routes through `slice()` which yields `&.{}` for detached buffers; mirror
        // that here to avoid passing a null ptr to `from_raw_parts_mut` (UB even at len 0).
        if self.is_detached() {
            return std::io::Cursor::new(&mut [][..]);
        }
        // SAFETY: ptr is non-null (checked above), FFI-backed; caller must keep backing JSValue alive.
        let slice =
            unsafe { core::slice::from_raw_parts_mut::<'static, u8>(self.ptr, self.byte_len) };
        std::io::Cursor::new(slice)
    }

    // Via `#![feature(adt_const_params)]`: `JSType` derives `ConstParamTy`, so
    // `KIND` is a true const-generic and the `match` const-folds (the
    // unreachable arm becomes a post-mono `panic!`).
    pub fn create<const KIND: JSType>(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        crate::mark_binding!();
        match KIND {
            // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); bytes
            // ptr/len come from a live slice, copied by callee.
            JSType::Uint8Array => crate::host_fn::from_js_host_call(global, || unsafe {
                Bun__createUint8ArrayForCopy(global, bytes.as_ptr().cast(), bytes.len(), false)
            }),
            // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); bytes
            // ptr/len come from a live slice, copied by callee.
            JSType::ArrayBuffer => crate::host_fn::from_js_host_call(global, || unsafe {
                Bun__createArrayBufferForCopy(global, bytes.as_ptr().cast(), bytes.len())
            }),
            _ => panic!("ArrayBuffer::create: KIND not implemented"),
        }
    }

    pub fn create_empty<const KIND: JSType>(global: &JSGlobalObject) -> JsResult<JSValue> {
        crate::mark_binding!();
        match KIND {
            // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); null ptr
            // with len 0 is the documented empty case.
            JSType::Uint8Array => crate::host_fn::from_js_host_call(global, || unsafe {
                Bun__createUint8ArrayForCopy(global, ptr::null(), 0, false)
            }),
            // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); null ptr
            // with len 0 is the documented empty case.
            JSType::ArrayBuffer => crate::host_fn::from_js_host_call(global, || unsafe {
                Bun__createArrayBufferForCopy(global, ptr::null(), 0)
            }),
            _ => panic!("ArrayBuffer::create_empty: KIND not implemented"),
        }
    }

    pub fn create_buffer(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        crate::mark_binding!();
        // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); bytes ptr/len
        // come from a live slice, copied by callee.
        crate::host_fn::from_js_host_call(global, || unsafe {
            Bun__createUint8ArrayForCopy(global, bytes.as_ptr().cast(), bytes.len(), true)
        })
    }

    pub fn create_uint8_array(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        crate::mark_binding!();
        // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); bytes ptr/len
        // come from a live slice, copied by callee.
        crate::host_fn::from_js_host_call(global, || unsafe {
            Bun__createUint8ArrayForCopy(global, bytes.as_ptr().cast(), bytes.len(), false)
        })
    }

    pub fn alloc<'a, const KIND: JSType>(
        global: &JSGlobalObject,
        len: u32,
    ) -> JsResult<(JSValue, &'a mut [u8])> {
        let mut ptr_out: *mut u8 = ptr::null_mut();
        let buf = match KIND {
            JSType::Uint8Array => crate::host_fn::from_js_host_call(global, || {
                Bun__allocUint8ArrayForCopy(global, len as usize, &mut ptr_out)
            })?,
            JSType::ArrayBuffer => crate::host_fn::from_js_host_call(global, || {
                Bun__allocArrayBufferForCopy(global, len as usize, &mut ptr_out)
            })?,
            _ => panic!("ArrayBuffer::alloc: KIND not implemented"),
        };
        // SAFETY: Bun__alloc*ForCopy writes a valid `len`-byte buffer pointer into ptr_out on success.
        let slice = unsafe { bun_core::ffi::slice_mut(ptr_out, len as usize) };
        Ok((buf, slice))
    }

    pub fn from_typed_array(ctx: &JSGlobalObject, value: JSValue) -> ArrayBuffer {
        value.as_array_buffer(ctx).unwrap()
    }

    pub fn to_js_from_default_allocator(global: &JSGlobalObject, bytes: &mut [u8]) -> JSValue {
        // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); `bytes` is a
        // mimalloc-backed buffer whose ownership transfers to JSC.
        unsafe { JSArrayBuffer__fromDefaultAllocator(global, bytes.as_mut_ptr(), bytes.len()) }
    }

    pub fn from_default_allocator(
        global: &JSGlobalObject,
        typed_array_type: JSType,
        bytes: &mut [u8],
    ) -> JSValue {
        match typed_array_type {
            // SAFETY: FFI — `global` is a live opaque ZST handle (coerces to *const); `bytes` is
            // a mimalloc-backed buffer whose ownership transfers to JSC.
            JSType::ArrayBuffer => unsafe {
                JSArrayBuffer__fromDefaultAllocator(global, bytes.as_mut_ptr(), bytes.len())
            },
            // `JSUint8Array::from_bytes` takes `Box<[u8]>`; reconstruct
            // ownership from the mimalloc-backed slice the caller hands us.
            JSType::Uint8Array => {
                // SAFETY: caller guarantees `bytes` is exactly a `Box<[u8]>`
                // allocation from the default (mimalloc) allocator; ownership
                // transfers to JSC. Coerce the borrowed slice directly to its
                // fat raw pointer — no need to round-trip through
                // `from_raw_parts_mut(as_mut_ptr(), len)`.
                let owned = unsafe { bun_core::heap::take(ptr::from_mut(bytes)) };
                jsc::JSUint8Array::from_bytes(global, owned)
            }
            _ => unreachable!("Not implemented yet"),
        }
    }

    pub fn from_bytes(bytes: &mut [u8], typed_array_type: JSType) -> ArrayBuffer {
        ArrayBuffer {
            len: u32::try_from(bytes.len()).expect("int cast") as usize,
            byte_len: u32::try_from(bytes.len()).expect("int cast") as usize,
            typed_array_type,
            ptr: bytes.as_mut_ptr(),
            ..Default::default()
        }
    }

    pub fn to_js_unchecked(self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        // The reason for this is
        // JSC C API returns a detached arraybuffer
        // if you pass it a zero-length TypedArray
        // we don't ever want to send the user a detached arraybuffer
        // that's just silly.
        if self.byte_len == 0 {
            if self.typed_array_type == JSType::ArrayBuffer {
                return Self::create::<{ JSType::ArrayBuffer }>(ctx, b"");
            }

            if self.typed_array_type == JSType::Uint8Array {
                return Self::create::<{ JSType::Uint8Array }>(ctx, b"");
            }

            // TODO: others
        }

        if self.typed_array_type == JSType::ArrayBuffer {
            // SAFETY: this method's contract: the descriptor's `ptr` is the
            // live backing allocation of `byte_len` bytes, mimalloc-owned
            // and transferable; ownership moves to JSC,
            // which frees it exactly once via `MarkedArrayBuffer_deallocator`
            // (`mi_free`; tolerates null).
            return unsafe {
                make_array_buffer_with_bytes_no_copy(
                    ctx,
                    self.ptr.cast(),
                    self.byte_len,
                    Some(MarkedArrayBuffer_deallocator),
                    // The deallocator ignores its ctx (mi_free needs no ctx). Any non-null
                    // sentinel would do; pass the data ptr itself for symmetry with
                    // `MarkedArrayBuffer::to_js`.
                    self.ptr.cast(),
                )
            };
        }

        // SAFETY: same as the ArrayBuffer arm above.
        unsafe {
            make_typed_array_with_bytes_no_copy(
                ctx,
                self.typed_array_type.to_typed_array_type(),
                self.ptr.cast(),
                self.byte_len,
                Some(MarkedArrayBuffer_deallocator),
                self.ptr.cast(),
            )
        }
    }

    pub fn to_js(self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        if !self.value.is_empty() {
            return Ok(self.value);
        }

        // If it's not a mimalloc heap buffer, we're not going to call a deallocator.
        // Only meaningful when mimalloc is the global allocator; otherwise the
        // probe always returns false and we'd drop the deallocator for buffers we own.
        if self.len > 0
            && bun_alloc::USE_MIMALLOC
            // SAFETY: `mi_is_in_heap_region` accepts any pointer value (incl. null/non-mimalloc).
            && !unsafe { mimalloc::mi_is_in_heap_region(self.ptr.cast()) }
        {
            bun_core::scoped_log!(ArrayBuffer, "toJS but will never free: {} bytes", self.len);

            if self.typed_array_type == JSType::ArrayBuffer {
                // SAFETY: the descriptor's `ptr` is the live backing
                // allocation of `byte_len` bytes. It is not mimalloc-owned
                // (probe above), so no deallocator is installed: JSC never
                // frees it and the bytes stay live for the object's lifetime
                // (static/extern-owned data, per the log line above).
                return unsafe {
                    make_array_buffer_with_bytes_no_copy(
                        ctx,
                        self.ptr.cast(),
                        self.byte_len,
                        None,
                        ptr::null_mut(),
                    )
                };
            }

            // SAFETY: same as the ArrayBuffer arm above.
            return unsafe {
                make_typed_array_with_bytes_no_copy(
                    ctx,
                    self.typed_array_type.to_typed_array_type(),
                    self.ptr.cast(),
                    self.byte_len,
                    None,
                    ptr::null_mut(),
                )
            };
        }

        self.to_js_unchecked(ctx)
    }

    /// Hand this descriptor's bytes to JSC with a caller-supplied finalizer:
    /// `callback(self.ptr, deallocator)` runs on the JS thread when the
    /// returned object is collected (never, if `callback` is `None`).
    ///
    /// # Safety
    ///
    /// `self.ptr` must be the live backing allocation of `self.byte_len`
    /// bytes and stay valid (including for writes) for the returned object's
    /// entire lifetime: until `callback` runs, or indefinitely when
    /// `callback` is `None`. `callback`, if `Some`, must be sound to invoke
    /// exactly once with `(self.ptr, deallocator)` at GC time, and
    /// `deallocator` must remain valid until then.
    pub unsafe fn to_js_with_context(
        self,
        ctx: &JSGlobalObject,
        deallocator: *mut c_void,
        callback: JSTypedArrayBytesDeallocator,
    ) -> JsResult<JSValue> {
        if !self.value.is_empty() {
            return Ok(self.value);
        }

        if self.typed_array_type == JSType::ArrayBuffer {
            // SAFETY: forwarded verbatim; the caller upholds this method's
            // contract, which matches the callee's.
            return unsafe {
                make_array_buffer_with_bytes_no_copy(
                    ctx,
                    self.ptr.cast(),
                    self.byte_len,
                    callback,
                    deallocator,
                )
            };
        }

        // SAFETY: same as the ArrayBuffer arm above.
        unsafe {
            make_typed_array_with_bytes_no_copy(
                ctx,
                self.typed_array_type.to_typed_array_type(),
                self.ptr.cast(),
                self.byte_len,
                callback,
                deallocator,
            )
        }
    }

    #[inline]
    pub fn from_array_buffer(ctx: &JSGlobalObject, value: JSValue) -> ArrayBuffer {
        Self::from_typed_array(ctx, value)
    }

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    // An aliased `&self -> &mut [_]` accessor is forbidden in Rust. Split into a shared
    // accessor (`&self -> &[u8]`) and an exclusive one (`&mut self -> &mut [u8]`).
    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        if self.is_detached() {
            return &[];
        }
        // SAFETY: ptr is non-null (checked above) and backed by JSC ArrayBuffer of byte_len bytes.
        // Hot path — bare `from_raw_parts` to avoid the helper's redundant null-branch.
        unsafe { core::slice::from_raw_parts(self.ptr, self.byte_len) }
    }

    #[inline]
    pub fn byte_slice_mut(&mut self) -> &mut [u8] {
        if self.is_detached() {
            return &mut [];
        }
        // SAFETY: ptr is non-null (checked above) and backed by JSC ArrayBuffer of byte_len bytes.
        // `&mut self` enforces exclusive access to this view.
        unsafe { core::slice::from_raw_parts_mut(self.ptr, self.byte_len) }
    }

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    #[inline]
    pub fn slice(&self) -> &[u8] {
        self.byte_slice()
    }

    #[inline]
    pub fn slice_mut(&mut self) -> &mut [u8] {
        self.byte_slice_mut()
    }

    /// Debug-asserts 2-byte alignment
    /// before handing out a naturally-aligned `&mut [u16]`. Callers that cannot
    /// guarantee alignment must use [`as_u16_unaligned`] instead.
    #[inline]
    pub fn as_u16(&mut self) -> &mut [u16] {
        bun_core::Unaligned::slice_align_cast_mut(self.as_u16_unaligned())
    }

    /// Returns a slice of
    /// [`Unaligned<u16>`](bun_core::Unaligned) — Rust forbids forming
    /// `&[u16]` over a possibly-odd address, so the align(1) wrapper carries
    /// the "load via `read_unaligned`" obligation to the caller.
    #[inline]
    pub fn as_u16_unaligned(&mut self) -> &mut [bun_core::Unaligned<u16>] {
        if self.is_detached() {
            return &mut [];
        }
        let len = self.byte_len / core::mem::size_of::<u16>();
        // SAFETY: ptr non-null (checked above); `Unaligned<u16>` has size 2 and
        // align 1, so any `*mut u8` is a valid `*mut Unaligned<u16>`. `&mut self`
        // enforces exclusive access to this view for the borrow's lifetime.
        unsafe { core::slice::from_raw_parts_mut(self.ptr.cast::<bun_core::Unaligned<u16>>(), len) }
    }

    /// See [`as_u16`]; 4-byte variant.
    #[inline]
    pub fn as_u32(&mut self) -> &mut [u32] {
        bun_core::Unaligned::slice_align_cast_mut(self.as_u32_unaligned())
    }

    /// See [`as_u16_unaligned`]; 4-byte variant.
    #[inline]
    pub fn as_u32_unaligned(&mut self) -> &mut [bun_core::Unaligned<u32>] {
        if self.is_detached() {
            return &mut [];
        }
        let len = self.byte_len / core::mem::size_of::<u32>();
        // SAFETY: ptr non-null; `Unaligned<u32>` has size 4 / align 1, so any
        // `*mut u8` is a valid `*mut Unaligned<u32>`. `&mut self` enforces
        // exclusive access to this view.
        unsafe { core::slice::from_raw_parts_mut(self.ptr.cast::<bun_core::Unaligned<u32>>(), len) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ArrayBuffer.Strong
// ──────────────────────────────────────────────────────────────────────────

pub struct ArrayBufferStrong {
    pub array_buffer: ArrayBuffer,
    pub held: crate::StrongOptional, // jsc.Strong.Optional
}

impl Default for ArrayBufferStrong {
    fn default() -> Self {
        Self {
            array_buffer: ArrayBuffer::default(),
            held: crate::StrongOptional::empty(),
        }
    }
}

impl ArrayBufferStrong {
    pub fn clear(&mut self) {
        // Intentionally a no-op.
        let _ = self;
    }

    pub fn slice(&self) -> &[u8] {
        self.array_buffer.slice()
    }

    pub fn slice_mut(&mut self) -> &mut [u8] {
        self.array_buffer.slice_mut()
    }
}

// `crate::Strong` already impls `Drop`, so no explicit
// `impl Drop for ArrayBufferStrong` is needed.

// ──────────────────────────────────────────────────────────────────────────
// BinaryType
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum BinaryType {
    Buffer,
    ArrayBuffer,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float16Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    // DataView,
}

bun_core::comptime_string_map! {
    pub(crate) static BINARY_TYPE_MAP: BinaryType = {
        b"ArrayBuffer" => BinaryType::ArrayBuffer,
        b"Buffer" => BinaryType::Buffer,
        // b"DataView" => BinaryType::DataView,
        b"Float32Array" => BinaryType::Float32Array,
        b"Float16Array" => BinaryType::Float16Array,
        b"Float64Array" => BinaryType::Float64Array,
        b"Int16Array" => BinaryType::Int16Array,
        b"Int32Array" => BinaryType::Int32Array,
        b"Int8Array" => BinaryType::Int8Array,
        b"Uint16Array" => BinaryType::Uint16Array,
        b"Uint32Array" => BinaryType::Uint32Array,
        b"Uint8Array" => BinaryType::Uint8Array,
        b"arraybuffer" => BinaryType::ArrayBuffer,
        b"buffer" => BinaryType::Buffer,
        // b"dataview" => BinaryType::DataView,
        b"float16array" => BinaryType::Float16Array,
        b"float32array" => BinaryType::Float32Array,
        b"float64array" => BinaryType::Float64Array,
        b"int16array" => BinaryType::Int16Array,
        b"int32array" => BinaryType::Int32Array,
        b"int8array" => BinaryType::Int8Array,
        b"nodebuffer" => BinaryType::Buffer,
        b"uint16array" => BinaryType::Uint16Array,
        b"uint32array" => BinaryType::Uint32Array,
        b"uint8array" => BinaryType::Uint8Array,
    };
}

impl BinaryType {
    pub fn to_js_type(self) -> JSType {
        match self {
            BinaryType::ArrayBuffer => JSType::ArrayBuffer,
            BinaryType::Buffer => JSType::Uint8Array,
            // BinaryType::DataView => JSType::DataView,
            BinaryType::Float32Array => JSType::Float32Array,
            BinaryType::Float16Array => JSType::Float16Array,
            BinaryType::Float64Array => JSType::Float64Array,
            BinaryType::Int16Array => JSType::Int16Array,
            BinaryType::Int32Array => JSType::Int32Array,
            BinaryType::Int8Array => JSType::Int8Array,
            BinaryType::Uint16Array => JSType::Uint16Array,
            BinaryType::Uint32Array => JSType::Uint32Array,
            BinaryType::Uint8Array => JSType::Uint8Array,
            BinaryType::Uint8ClampedArray => JSType::Uint8ClampedArray,
            BinaryType::BigInt64Array => JSType::BigInt64Array,
            BinaryType::BigUint64Array => JSType::BigUint64Array,
        }
    }

    pub fn to_typed_array_type(self) -> TypedArrayType {
        match self {
            BinaryType::Buffer => TypedArrayType::TypeNone,
            BinaryType::ArrayBuffer => TypedArrayType::TypeNone,
            BinaryType::Int8Array => TypedArrayType::TypeInt8,
            BinaryType::Int16Array => TypedArrayType::TypeInt16,
            BinaryType::Int32Array => TypedArrayType::TypeInt32,
            BinaryType::Uint8Array => TypedArrayType::TypeUint8,
            BinaryType::Uint8ClampedArray => TypedArrayType::TypeUint8Clamped,
            BinaryType::Uint16Array => TypedArrayType::TypeUint16,
            BinaryType::Uint32Array => TypedArrayType::TypeUint32,
            BinaryType::Float16Array => TypedArrayType::TypeFloat16,
            BinaryType::Float32Array => TypedArrayType::TypeFloat32,
            BinaryType::Float64Array => TypedArrayType::TypeFloat64,
            BinaryType::BigInt64Array => TypedArrayType::TypeBigInt64,
            BinaryType::BigUint64Array => TypedArrayType::TypeBigUint64,
        }
    }

    pub fn from_string(input: &[u8]) -> Option<BinaryType> {
        BINARY_TYPE_MAP.get(input).copied()
    }

    pub fn from_js_value(global: &JSGlobalObject, input: JSValue) -> JsResult<Option<BinaryType>> {
        if input.is_string() {
            return BINARY_TYPE_MAP.from_js(global, input);
        }

        Ok(None)
    }

    /// This clones bytes
    pub fn to_js(self, bytes: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            BinaryType::Buffer => ArrayBuffer::create_buffer(global, bytes),
            BinaryType::ArrayBuffer => {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, bytes)
            }
            BinaryType::Uint8Array => ArrayBuffer::create::<{ JSType::Uint8Array }>(global, bytes),

            // These aren't documented, but they are supported
            BinaryType::Uint8ClampedArray
            | BinaryType::Uint16Array
            | BinaryType::Uint32Array
            | BinaryType::Int8Array
            | BinaryType::Int16Array
            | BinaryType::Int32Array
            | BinaryType::Float16Array
            | BinaryType::Float32Array
            | BinaryType::Float64Array
            | BinaryType::BigInt64Array
            | BinaryType::BigUint64Array => {
                crate::host_fn::from_js_host_call(global, || {
                    // SAFETY: `global` is a live opaque ZST handle; `bytes` is a
                    // valid slice whose pointer/len are only read (copied) by C++.
                    unsafe {
                        Bun__createTypedArrayForCopy(
                            global,
                            self.to_typed_array_type(),
                            bytes.as_ptr().cast(),
                            bytes.len(),
                        )
                    }
                })
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TypedArrayType
// ──────────────────────────────────────────────────────────────────────────

// Note: keep in sync wih <JavaScriptCore/TypedArrayType.h>
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum TypedArrayType {
    TypeNone,
    TypeInt8,
    TypeUint8,
    TypeUint8Clamped,
    TypeInt16,
    TypeUint16,
    TypeInt32,
    TypeUint32,
    TypeFloat16,
    TypeFloat32,
    TypeFloat64,
    TypeBigInt64,
    TypeBigUint64,
    TypeDataView,
}

impl TypedArrayType {
    // LAYERING: `napi_typedarray_type` is defined in `bun_runtime` (a higher-tier
    // crate that depends on `bun_jsc`). The conversion lives next to its target
    // type as `napi_typedarray_type::from_typed_array_type` in
    // `bun_runtime::napi` to avoid the dep cycle.
}

// ──────────────────────────────────────────────────────────────────────────
// MarkedArrayBuffer
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct MarkedArrayBuffer {
    pub buffer: ArrayBuffer,
    pub owns_buffer: bool,
    pub pinned: bool,
}

// Hoisted to module scope (inherent associated type aliases are unstable).
pub(crate) type ArrayBufferStream<'a> = std::io::Cursor<&'a mut [u8]>;

impl MarkedArrayBuffer {
    #[inline]
    pub fn stream(&mut self) -> ArrayBufferStream<'_> {
        // See the ArrayBuffer::stream lifetime note: caller must keep the
        // backing JSValue alive for the stream's lifetime.
        std::io::Cursor::new(self.buffer.byte_slice_mut())
    }

    pub fn from_typed_array(ctx: &JSGlobalObject, value: JSValue) -> MarkedArrayBuffer {
        MarkedArrayBuffer {
            owns_buffer: false,
            pinned: false,
            buffer: ArrayBuffer::from_typed_array(ctx, value),
        }
    }

    pub fn from_array_buffer(ctx: &JSGlobalObject, value: JSValue) -> MarkedArrayBuffer {
        MarkedArrayBuffer {
            owns_buffer: false,
            pinned: false,
            buffer: ArrayBuffer::from_array_buffer(ctx, value),
        }
    }

    pub fn from_string(str: &[u8]) -> Result<MarkedArrayBuffer, bun_alloc::AllocError> {
        // allocator.dupe(u8, str) → Box::<[u8]>::from(str), but we need a raw
        // pointer because the buffer is later freed via the default allocator
        // (`MarkedArrayBuffer_deallocator` → `default_alloc::free`).
        let buf: Box<[u8]> = Box::from(str);
        let len = buf.len();
        let ptr = bun_core::heap::into_raw(buf).cast::<u8>();
        // SAFETY: ptr/len from heap::alloc; backed by the global allocator.
        let bytes = unsafe { bun_core::ffi::slice_mut(ptr, len) };
        Ok(MarkedArrayBuffer::from_bytes(bytes, JSType::Uint8Array))
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> Option<MarkedArrayBuffer> {
        let array_buffer = value.as_array_buffer(global)?;
        Some(MarkedArrayBuffer {
            buffer: array_buffer,
            owns_buffer: false,
            pinned: false,
        })
    }

    pub fn from_js_pinned(global: &JSGlobalObject, value: JSValue) -> Option<MarkedArrayBuffer> {
        let buffer = value.as_pinned_arraybuffer(global)?;
        Some(MarkedArrayBuffer {
            buffer,
            owns_buffer: false,
            pinned: true,
        })
    }

    pub fn from_bytes(bytes: &mut [u8], typed_array_type: JSType) -> MarkedArrayBuffer {
        MarkedArrayBuffer {
            buffer: ArrayBuffer::from_bytes(bytes, typed_array_type),
            owns_buffer: true,
            pinned: false,
        }
    }

    pub const EMPTY: MarkedArrayBuffer = MarkedArrayBuffer {
        owns_buffer: false,
        pinned: false,
        buffer: ArrayBuffer::EMPTY,
    };

    #[inline]
    pub fn slice(&self) -> &[u8] {
        self.buffer.byte_slice()
    }

    #[inline]
    pub fn slice_mut(&mut self) -> &mut [u8] {
        self.buffer.byte_slice_mut()
    }

    /// Releases the owned byte buffer if this `MarkedArrayBuffer` was created with an
    /// allocator (e.g. via `from_string`/`from_bytes`). Does not free the struct itself;
    /// `MarkedArrayBuffer` is passed and stored by value, so callers own its storage.
    pub fn destroy(&mut self) {
        if self.owns_buffer {
            self.owns_buffer = false;
            // SAFETY: buffer.ptr was allocated by the global allocator (heap::alloc / allocator.dupe).
            unsafe { bun_alloc::default_alloc::free(self.buffer.ptr.cast()) };
        }
    }

    pub fn to_node_buffer(&self, global: &JSGlobalObject) -> JSValue {
        // `JSValue::create_buffer` takes `&mut [u8]` (ownership transfers to JSC
        // via the deallocator). `ArrayBuffer` is `Copy` over a raw pointer, so
        // copy the descriptor and project a mutable slice.
        let mut buf = self.buffer;
        JSValue::create_buffer(global, buf.byte_slice_mut())
    }

    pub fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if !self.buffer.value.is_empty_or_undefined_or_null() {
            return Ok(self.buffer.value);
        }
        if self.buffer.byte_len == 0 {
            // SAFETY: null `ptr` with `len == 0` and no deallocator — every
            // obligation of the callee's contract holds trivially.
            return unsafe {
                make_typed_array_with_bytes_no_copy(
                    global,
                    self.buffer.typed_array_type.to_typed_array_type(),
                    ptr::null_mut(),
                    0,
                    None,
                    ptr::null_mut(),
                )
            };
        }
        // SAFETY: this type's contract: `buffer.ptr` is the live backing
        // allocation of `byte_len` bytes, mimalloc-owned (`from_string`/
        // `from_bytes`); ownership moves to JSC, which frees it exactly once
        // via `MarkedArrayBuffer_deallocator` (`mi_free`, ctx ignored).
        unsafe {
            make_typed_array_with_bytes_no_copy(
                global,
                self.buffer.typed_array_type.to_typed_array_type(),
                self.buffer.ptr.cast(),
                self.buffer.byte_len,
                Some(MarkedArrayBuffer_deallocator),
                self.buffer.ptr.cast(),
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Deallocators
// ──────────────────────────────────────────────────────────────────────────

// `no_mangle` dropped: 0 C++ refs (phase_c_exports.rs mention is a comment).
pub use bun_alloc::c_thunks::mi_free_bytes as MarkedArrayBuffer_deallocator;

// LAYERING: `BlobArrayBuffer_deallocator` releases a
// `Blob::Store` ref. `Store` is a `bun_runtime` type, so the `#[no_mangle]`
// export lives next to it at `bun_runtime::webcore::blob::Store` — `bun_jsc`
// cannot own this symbol without a dep cycle. C++ links by name only.

// ──────────────────────────────────────────────────────────────────────────
// Free functions
// ──────────────────────────────────────────────────────────────────────────

/// Wrap caller-provided bytes in a JS `ArrayBuffer` without copying. JSC
/// adopts `ptr..ptr+len` as the backing store of the returned object and
/// calls `deallocator(ptr, deallocator_context)` on the JS thread when it is
/// collected (never, if `deallocator` is `None`).
///
/// # Safety
///
/// - `ptr` must be valid for reads and writes of `len` bytes (JS code can do
///   both through the returned object) for the returned object's entire
///   lifetime: until the deallocator runs, or indefinitely when `deallocator`
///   is `None`. `ptr` may be null only when `len == 0`.
/// - `deallocator`, if `Some`, must be sound to call exactly once with
///   `(ptr, deallocator_context)` at GC time — possibly on another thread, and
///   `deallocator_context` must remain valid until then.
pub unsafe fn make_array_buffer_with_bytes_no_copy(
    global: &JSGlobalObject,
    ptr: *mut c_void,
    len: usize,
    deallocator: JSTypedArrayBytesDeallocator,
    deallocator_context: *mut c_void,
) -> JsResult<JSValue> {
    crate::host_fn::from_js_host_call(global, || {
        // SAFETY: forwarded verbatim; the caller upholds this function's
        // contract (`ptr` valid for `len` bytes until `deallocator` runs).
        unsafe {
            Bun__makeArrayBufferWithBytesNoCopy(global, ptr, len, deallocator, deallocator_context)
        }
    })
}

/// Wrap caller-provided bytes in a JS typed array of `array_type` without
/// copying. JSC adopts `ptr..ptr+len` as the backing store of the returned
/// object and calls `deallocator(ptr, deallocator_context)` on the JS thread
/// when it is collected (never, if `deallocator` is `None`).
///
/// # Safety
///
/// Same contract as [`make_array_buffer_with_bytes_no_copy`].
pub unsafe fn make_typed_array_with_bytes_no_copy(
    global: &JSGlobalObject,
    array_type: TypedArrayType,
    ptr: *mut c_void,
    len: usize,
    deallocator: JSTypedArrayBytesDeallocator,
    deallocator_context: *mut c_void,
) -> JsResult<JSValue> {
    crate::host_fn::from_js_host_call(global, || {
        // SAFETY: forwarded verbatim; the caller upholds this function's
        // contract (`ptr` valid for `len` bytes until `deallocator` runs).
        unsafe {
            Bun__makeTypedArrayWithBytesNoCopy(
                global,
                array_type,
                ptr,
                len,
                deallocator,
                deallocator_context,
            )
        }
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Safe no-copy constructors: the "pointer stays valid until the deallocator
// runs" contract of the `make_*_with_bytes_no_copy` functions above,
// expressed as ownership transfer. The owner is dropped exactly once when
// the JS object is collected — possibly on another thread (a transferred
// ArrayBuffer's contents are destroyed wherever the receiving Worker or an
// undelivered message dies), hence the `Send` bounds.
// ──────────────────────────────────────────────────────────────────────────

/// Fresh empty typed array for the zero-length paths below: the no-copy
/// constructor yields a *detached* view for `len == 0`, which JS code can
/// observe (`.byteLength` throws). `DataView`/`TypeNone` have no copy
/// factory (both C++ constructors assert on them) — no caller reaches here
/// with those types; the arm mirrors the legacy fallthrough unchanged.
fn empty_typed_array(global: &JSGlobalObject, ty: TypedArrayType) -> JsResult<JSValue> {
    if ty == TypedArrayType::TypeDataView || ty == TypedArrayType::TypeNone {
        // SAFETY: null ptr + len 0 + no deallocator — trivially valid.
        return unsafe {
            make_typed_array_with_bytes_no_copy(
                global,
                ty,
                ptr::null_mut(),
                0,
                None,
                ptr::null_mut(),
            )
        };
    }
    crate::host_fn::from_js_host_call(global, || {
        // SAFETY: `global` is a live opaque ZST handle; null ptr is allowed
        // for `byteLength == 0` (nothing is copied).
        unsafe { Bun__createTypedArrayForCopy(global, ty, ptr::null(), 0) }
    })
}

/// `deallocator` shim for [`typed_array_from_owned_slice`]: `ctx` carries
/// the length, so the `Box<[u8]>` is rebuilt and freed by the allocator
/// that created it — no extra allocation for the hand-off.
unsafe extern "C" fn drop_boxed_slice(bytes: *mut c_void, len_ctx: *mut c_void) {
    // SAFETY: `bytes`/`len_ctx` are the `Box::into_raw` pointer and length
    // stored by `*_from_owned_slice`; this runs exactly once.
    unsafe {
        drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
            bytes.cast::<u8>(),
            len_ctx as usize,
        )));
    }
}

/// `deallocator` shim for [`typed_array_from_owner`]: `ctx` is the boxed
/// owner; dropping it releases whatever the bytes borrowed from it.
unsafe extern "C" fn drop_boxed_owner<O: Send + 'static>(_bytes: *mut c_void, owner: *mut c_void) {
    // SAFETY: `owner` is the `Box::<O>::into_raw` pointer stored by
    // `*_from_owner`; this runs exactly once.
    unsafe { drop(Box::from_raw(owner.cast::<O>())) }
}

/// A `Uint8Array`-style typed array over `bytes` without copying; the
/// allocation is freed when the JS object (or a transferred copy of it) is
/// collected. Zero-length boxes take the empty-object path so JS never sees
/// a detached buffer.
pub fn typed_array_from_owned_slice(
    global: &JSGlobalObject,
    ty: TypedArrayType,
    bytes: Box<[u8]>,
) -> JsResult<JSValue> {
    let len = bytes.len();
    if len == 0 {
        return empty_typed_array(global, ty);
    }
    // `Box::into_raw` (not `as_mut_ptr` + `forget`): moving the box after
    // deriving the pointer would invalidate its provenance.
    let ptr = Box::into_raw(bytes).cast::<u8>();
    // SAFETY: `ptr..ptr+len` is the just-forgotten `Box<[u8]>` allocation;
    // `drop_boxed_slice` rebuilds and frees it exactly once with `len`
    // recovered from the ctx pointer.
    unsafe {
        make_typed_array_with_bytes_no_copy(
            global,
            ty,
            ptr.cast::<c_void>(),
            len,
            Some(drop_boxed_slice),
            len as *mut c_void,
        )
    }
}

/// [`typed_array_from_owned_slice`], but producing a plain `ArrayBuffer`.
pub fn array_buffer_from_owned_slice(
    global: &JSGlobalObject,
    bytes: Box<[u8]>,
) -> JsResult<JSValue> {
    let len = bytes.len();
    if len == 0 {
        return ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, b"");
    }
    // `Box::into_raw` (not `as_mut_ptr` + `forget`): moving the box after
    // deriving the pointer would invalidate its provenance.
    let ptr = Box::into_raw(bytes).cast::<u8>();
    // SAFETY: same as `typed_array_from_owned_slice`.
    unsafe {
        make_array_buffer_with_bytes_no_copy(
            global,
            ptr.cast::<c_void>(),
            len,
            Some(drop_boxed_slice),
            len as *mut c_void,
        )
    }
}

/// Owned bytes → JS object of `typed_array_type` (`JSType::ArrayBuffer` or
/// a typed-array `JSType`), no copy. Replaces the removed `from_owned_bytes`
/// + `to_js_unchecked` pairing, whose ownership contract was an unwritten
/// convention between two individually-"safe" functions.
pub fn js_from_owned_slice(
    global: &JSGlobalObject,
    typed_array_type: JSType,
    bytes: Box<[u8]>,
) -> JsResult<JSValue> {
    if typed_array_type == JSType::ArrayBuffer {
        array_buffer_from_owned_slice(global, bytes)
    } else {
        typed_array_from_owned_slice(global, typed_array_type.to_typed_array_type(), bytes)
    }
}

/// A typed array viewing bytes owned by an arbitrary `owner`, without
/// copying. The owner is boxed (one small allocation) and dropped when the
/// JS object is collected. `view` picks the exposed byte window out of the
/// boxed owner (it runs once, up front — only the drop shim outlives this
/// call); the returned borrow guarantees the window points into the
/// owner's own heap-stable storage.
pub fn typed_array_from_owner<O: Send + 'static>(
    global: &JSGlobalObject,
    ty: TypedArrayType,
    owner: O,
    view: impl for<'a> FnOnce(&'a mut O) -> &'a mut [u8],
) -> JsResult<JSValue> {
    // Raw the box before deriving the window so the pointer's provenance
    // survives; a later by-value Box move would invalidate it.
    let ctx = Box::into_raw(Box::new(owner));
    // SAFETY: `ctx` is the live boxed owner; exclusive until handed to JSC.
    let window = view(unsafe { &mut *ctx });
    let (ptr, len) = (window.as_mut_ptr(), window.len());
    if len == 0 {
        // SAFETY: reclaim and drop the never-handed-off owner.
        drop(unsafe { Box::from_raw(ctx) });
        return empty_typed_array(global, ty);
    }
    // SAFETY: `ptr..ptr+len` borrows from the boxed owner, which stays at a
    // stable address until `drop_boxed_owner::<O>` rebuilds and drops the
    // Box exactly once.
    unsafe {
        make_typed_array_with_bytes_no_copy(
            global,
            ty,
            ptr.cast::<c_void>(),
            len,
            Some(drop_boxed_owner::<O>),
            ctx.cast::<c_void>(),
        )
    }
}

/// [`typed_array_from_owner`], but producing a plain `ArrayBuffer`.
pub fn array_buffer_from_owner<O: Send + 'static>(
    global: &JSGlobalObject,
    owner: O,
    view: impl for<'a> FnOnce(&'a mut O) -> &'a mut [u8],
) -> JsResult<JSValue> {
    // See `typed_array_from_owner` for the provenance ordering.
    let ctx = Box::into_raw(Box::new(owner));
    // SAFETY: `ctx` is the live boxed owner; exclusive until handed to JSC.
    let window = view(unsafe { &mut *ctx });
    let (ptr, len) = (window.as_mut_ptr(), window.len());
    if len == 0 {
        // SAFETY: reclaim and drop the never-handed-off owner.
        drop(unsafe { Box::from_raw(ctx) });
        return ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, b"");
    }
    // SAFETY: same as `typed_array_from_owner`.
    unsafe {
        make_array_buffer_with_bytes_no_copy(
            global,
            ptr.cast::<c_void>(),
            len,
            Some(drop_boxed_owner::<O>),
            ctx.cast::<c_void>(),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSCArrayBuffer (opaque, corresponds to JSC::ArrayBuffer)
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// Corresponds to `JSC::ArrayBuffer`.
    pub struct JSCArrayBuffer;
}

pub type JSCArrayBufferRef = bun_ptr::ExternalShared<JSCArrayBuffer>;

// SAFETY: `JSC__ArrayBuffer__ref`/`deref` operate on JSC's internal
// `RefCounted<ArrayBuffer>` count; the pointee remains alive while count > 0.
unsafe impl bun_ptr::ExternalSharedDescriptor for JSCArrayBuffer {
    unsafe fn ext_ref(this: *mut Self) {
        // `opaque_ref` is the centralised ZST-handle non-null deref proof;
        // trait contract guarantees `this` is a valid `JSC::ArrayBuffer*`.
        JSC__ArrayBuffer__ref(JSCArrayBuffer::opaque_ref(this))
    }
    unsafe fn ext_deref(this: *mut Self) {
        JSC__ArrayBuffer__deref(JSCArrayBuffer::opaque_ref(this))
    }
}

impl JSCArrayBuffer {
    pub fn as_array_buffer(&mut self) -> ArrayBuffer {
        let mut out = core::mem::MaybeUninit::<ArrayBuffer>::uninit();
        // SAFETY: C++ fully initializes `out`.
        unsafe {
            JSC__ArrayBuffer__asBunArrayBuffer(self, out.as_mut_ptr());
            out.assume_init()
        }
    }
}
