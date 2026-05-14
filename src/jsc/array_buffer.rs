use core::ffi::{c_uint, c_void};
use core::ptr;

use crate as jsc;
use crate::SysErrorJsc;
use crate::c as jsc_c; // jsc.C.* (JSTypedArrayType, JSTypedArrayBytesDeallocator, JSObjectMakeTypedArrayWithArrayBuffer)
use crate::{ComptimeStringMapExt as _, JSGlobalObject, JSType, JSValue, JsResult};
use bun_alloc::mimalloc;
use bun_sys::{self, Fd, FdExt};

bun_core::declare_scope!(ArrayBuffer, visible);

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

// TODO(port): move to <jsc>_sys
//
// PORT NOTE (aliasing): Zig declares these with `*jsc.JSGlobalObject` (mutable
// pointer), but `JSGlobalObject` is an opaque ZST handle on the Rust side — the
// `&JSGlobalObject` reference covers zero bytes, and all mutation happens inside
// C++ on memory Rust never observes. Declaring the FFI parameter as
// `*const JSGlobalObject` (ABI-identical) lets `&JSGlobalObject` coerce directly
// without a `&T as *const T as *mut T` provenance laundering cast. This matches
// the pattern used by `JSGlobalObject`'s own extern block in `JSGlobalObject.rs`.
unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `addr`/`len` are an opaque mmap region
    // C++ stores into the Buffer's `ArrayBufferContents` (adopted, freed via
    // munmap by JSC) — same round-trip-pointer contract as
    // `Bun__makeArrayBufferWithBytesNoCopy` below. The public wrapper that
    // produces `addr` already discharges the validity proof.
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
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `ptr`/`len`/`ctx` are opaque
    // round-trip pointers C++ stores into the new `ArrayBufferContents` and
    // forwards to `dealloc` on GC (never dereferenced as Rust data on this
    // path) — same contract as `Zig__GlobalObject__create`'s `console`/`worker_ptr`.
    // The public wrappers (`make_*_with_bytes_no_copy`) are already safe and
    // forward these raw pointers verbatim, so the validity obligation lives at
    // that layer.
    safe fn Bun__makeArrayBufferWithBytesNoCopy(
        global: &JSGlobalObject,
        ptr: *mut c_void,
        len: usize,
        dealloc: jsc_c::JSTypedArrayBytesDeallocator,
        ctx: *mut c_void,
    ) -> JSValue;
    safe fn Bun__makeTypedArrayWithBytesNoCopy(
        global: &JSGlobalObject,
        ty: TypedArrayType,
        ptr: *mut c_void,
        len: usize,
        dealloc: jsc_c::JSTypedArrayBytesDeallocator,
        ctx: *mut c_void,
    ) -> JSValue;
    fn JSC__ArrayBuffer__asBunArrayBuffer(self_: *mut JSCArrayBuffer, out: *mut ArrayBuffer);
    // safe: `JSCArrayBuffer` is an `opaque_ffi!` ZST handle (`!Freeze` via
    // `UnsafeCell`); `&` is ABI-identical to a non-null `*mut` and the C++
    // `RefCounted<ArrayBuffer>` count mutation is interior to the opaque cell.
    safe fn JSC__ArrayBuffer__ref(self_: &JSCArrayBuffer);
    safe fn JSC__ArrayBuffer__deref(self_: &JSCArrayBuffer);
}

impl ArrayBuffer {
    pub fn is_detached(&self) -> bool {
        self.ptr.is_null()
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

        // bun_sys::mmap takes raw i32 prot/flags (mirrors Zig std.posix.PROT / .{ .TYPE = .SHARED }).
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
        ptr: core::ptr::NonNull::<u8>::dangling().as_ptr(), // Zig: &.{} (non-null empty)
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
        // TODO(port): lifetime — Zig returns a stream over self.slice() (raw ptr-backed).
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

    // PORT NOTE: Zig took `comptime kind: JSType`. Restored via
    // `#![feature(adt_const_params)]` — `JSType` derives `ConstParamTy`, so
    // `KIND` is a true const-generic and the `match` const-folds (Zig's
    // `@compileError` arm becomes a post-mono `panic!` on the unreachable arm).
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
            _ => panic!("ArrayBuffer::create: KIND not implemented"), // Zig: @compileError
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
            _ => panic!("ArrayBuffer::create_empty: KIND not implemented"), // Zig: @compileError
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

    pub fn alloc<const KIND: JSType>(
        global: &JSGlobalObject,
        len: u32,
    ) -> JsResult<(JSValue, &mut [u8])> {
        let mut ptr_out: *mut u8 = ptr::null_mut();
        let buf = match KIND {
            JSType::Uint8Array => crate::host_fn::from_js_host_call(global, || {
                Bun__allocUint8ArrayForCopy(global, len as usize, &mut ptr_out)
            })?,
            JSType::ArrayBuffer => crate::host_fn::from_js_host_call(global, || {
                Bun__allocArrayBufferForCopy(global, len as usize, &mut ptr_out)
            })?,
            _ => panic!("ArrayBuffer::alloc: KIND not implemented"), // Zig: @compileError
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
            // PORT NOTE: `JSUint8Array::from_bytes` takes `Box<[u8]>`; reconstruct
            // ownership from the mimalloc-backed slice the caller hands us.
            JSType::Uint8Array => {
                // SAFETY: caller guarantees `bytes` is exactly a `Box<[u8]>`
                // allocation from the default (mimalloc) allocator; ownership
                // transfers to JSC. Coerce the borrowed slice directly to its
                // fat raw pointer — no need to round-trip through
                // `from_raw_parts_mut(as_mut_ptr(), len)`.
                let owned = unsafe { bun_core::heap::take(bytes as *mut [u8]) };
                jsc::JSUint8Array::from_bytes(global, owned)
            }
            _ => unreachable!("Not implemented yet"), // Zig: @compileError
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

    /// Take ownership of a mimalloc-backed `Box<[u8]>` and wrap it as an
    /// `ArrayBuffer` without copying. The buffer is released via
    /// [`MarkedArrayBuffer_deallocator`] when the resulting JS object is
    /// collected (see [`ArrayBuffer::to_js`] / [`ArrayBuffer::to_js_unchecked`]).
    ///
    /// Prefer this over `Box::leak` + [`ArrayBuffer::from_bytes`] at call sites
    /// so the ownership transfer is explicit.
    pub fn from_owned_bytes(bytes: Box<[u8]>, typed_array_type: JSType) -> ArrayBuffer {
        let len = bytes.len();
        // Ownership transfers to JSC; `to_js` installs a deallocator that
        // `mi_free`s the pointer on GC. `into_raw` (not `leak`) expresses that
        // this is an FFI hand-off, not a leak.
        let ptr = bun_core::heap::into_raw(bytes).cast::<u8>();
        ArrayBuffer {
            len: u32::try_from(len).expect("int cast") as usize,
            byte_len: u32::try_from(len).expect("int cast") as usize,
            typed_array_type,
            ptr,
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
            return make_array_buffer_with_bytes_no_copy(
                ctx,
                self.ptr.cast(),
                self.byte_len,
                Some(MarkedArrayBuffer_deallocator),
                // PORT NOTE: Zig passes `&bun.default_allocator` as opaque ctx; the
                // deallocator ignores it (mi_free needs no ctx). Any non-null
                // sentinel would do; pass the data ptr itself for symmetry with
                // `MarkedArrayBuffer::to_js`.
                self.ptr.cast(),
            );
        }

        make_typed_array_with_bytes_no_copy(
            ctx,
            self.typed_array_type.to_typed_array_type(),
            self.ptr.cast(),
            self.byte_len,
            Some(MarkedArrayBuffer_deallocator),
            self.ptr.cast(),
        )
    }

    pub fn to_js(self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        if !self.value.is_empty() {
            return Ok(self.value);
        }

        // If it's not a mimalloc heap buffer, we're not going to call a deallocator
        // SAFETY: `mi_is_in_heap_region` accepts any pointer value (incl. null/non-mimalloc).
        if self.len > 0 && !unsafe { mimalloc::mi_is_in_heap_region(self.ptr.cast()) } {
            bun_core::scoped_log!(ArrayBuffer, "toJS but will never free: {} bytes", self.len);

            if self.typed_array_type == JSType::ArrayBuffer {
                return make_array_buffer_with_bytes_no_copy(
                    ctx,
                    self.ptr.cast(),
                    self.byte_len,
                    None,
                    ptr::null_mut(),
                );
            }

            return make_typed_array_with_bytes_no_copy(
                ctx,
                self.typed_array_type.to_typed_array_type(),
                self.ptr.cast(),
                self.byte_len,
                None,
                ptr::null_mut(),
            );
        }

        self.to_js_unchecked(ctx)
    }

    pub fn to_js_with_context(
        self,
        ctx: &JSGlobalObject,
        deallocator: *mut c_void,
        callback: jsc_c::JSTypedArrayBytesDeallocator,
    ) -> JsResult<JSValue> {
        if !self.value.is_empty() {
            return Ok(self.value);
        }

        if self.typed_array_type == JSType::ArrayBuffer {
            return make_array_buffer_with_bytes_no_copy(
                ctx,
                self.ptr.cast(),
                self.byte_len,
                callback,
                deallocator,
            );
        }

        make_typed_array_with_bytes_no_copy(
            ctx,
            self.typed_array_type.to_typed_array_type(),
            self.ptr.cast(),
            self.byte_len,
            callback,
            deallocator,
        )
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
    // PORT NOTE: Zig `byteSlice(self: *const @This()) []u8` is sound under Zig's
    // aliasing model but cannot be transliterated to `&self -> &mut [_]` in Rust
    // (forbidden aliased-`&mut` per PORTING.md §Forbidden). Split into a shared
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

    /// Zig `asU16`: `@alignCast(asU16Unaligned())`. `@alignCast` is a checked
    /// cast in Zig safe builds, so we debug-assert the same precondition here
    /// before handing out a naturally-aligned `&mut [u16]`. Callers that cannot
    /// guarantee alignment must use [`as_u16_unaligned`] instead.
    #[inline]
    pub fn as_u16(&mut self) -> &mut [u16] {
        bun_core::Unaligned::slice_align_cast_mut(self.as_u16_unaligned())
    }

    /// Zig `asU16Unaligned() []align(1) u16`. Returns a slice of
    /// [`Unaligned<u16>`](bun_core::Unaligned) — Rust forbids forming
    /// `&[u16]` over a possibly-odd address, so the align(1) wrapper carries
    /// the "load via `read_unaligned`" obligation to the caller.
    #[inline]
    pub fn as_u16_unaligned(&mut self) -> &mut [bun_core::Unaligned<u16>] {
        if self.is_detached() {
            return &mut [];
        }
        // SAFETY: ptr non-null (checked above); `Unaligned<u16>` has size 2 and
        // align 1, so any `*mut u8` is a valid `*mut Unaligned<u16>`. `&mut self`
        // enforces exclusive access to this view for the borrow's lifetime.
        let len = self.byte_len / core::mem::size_of::<u16>();
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
        // SAFETY: ptr non-null; `Unaligned<u32>` has size 4 / align 1, so any
        // `*mut u8` is a valid `*mut Unaligned<u32>`. `&mut self` enforces
        // exclusive access to this view.
        let len = self.byte_len / core::mem::size_of::<u32>();
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
        // TODO(port): Zig source references `this.ref` which is not a field on this struct
        // (only `array_buffer` and `held` exist). This appears to be dead/broken code upstream.
        // Porting as a no-op matching the orelse-return on a missing field.
        let _ = self;
    }

    pub fn slice(&self) -> &[u8] {
        self.array_buffer.slice()
    }

    pub fn slice_mut(&mut self) -> &mut [u8] {
        self.array_buffer.slice_mut()
    }
}

// Zig `deinit` only calls `this.held.deinit()`; `crate::Strong` already impls `Drop`,
// so no explicit `impl Drop for ArrayBufferStrong` is needed.

// ──────────────────────────────────────────────────────────────────────────
// BinaryType
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)] // Zig: enum(u4) — Rust has no u4; u8 is the smallest backing.
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

pub static BINARY_TYPE_MAP: phf::Map<&'static [u8], BinaryType> = phf::phf_map! {
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
                let buffer = ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, bytes)?;
                // SAFETY: FFI — `global` is a live opaque ZST handle; `JSGlobalObject` is
                // a ZST on the Rust side so the `*const` → `*mut` cast launders no
                // provenance (see PORT NOTE on the extern block above). `buffer` is a
                // fresh ArrayBuffer JSValue (cell pointer), so `as_object_ref` yields a
                // valid `JSObjectRef`.
                let obj = unsafe {
                    jsc_c::JSObjectMakeTypedArrayWithArrayBuffer(
                        std::ptr::from_ref::<JSGlobalObject>(global).cast_mut(),
                        self.to_typed_array_type().to_c(),
                        buffer.as_object_ref(),
                        ptr::null_mut(),
                    )
                };
                Ok(JSValue::c(obj))
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
    /// Maps to JSC's C-API `JSTypedArrayType` enum (declared in
    /// `<JavaScriptCore/JSTypedArray.h>` and re-exported as
    /// [`jsc_c::JSTypedArrayType`]).
    pub fn to_c(self) -> jsc_c::JSTypedArrayType {
        use jsc_c::JSTypedArrayType as C;
        match self {
            TypedArrayType::TypeNone => C::kJSTypedArrayTypeNone,
            TypedArrayType::TypeInt8 => C::kJSTypedArrayTypeInt8Array,
            TypedArrayType::TypeInt16 => C::kJSTypedArrayTypeInt16Array,
            TypedArrayType::TypeInt32 => C::kJSTypedArrayTypeInt32Array,
            TypedArrayType::TypeUint8 => C::kJSTypedArrayTypeUint8Array,
            TypedArrayType::TypeUint8Clamped => C::kJSTypedArrayTypeUint8ClampedArray,
            TypedArrayType::TypeUint16 => C::kJSTypedArrayTypeUint16Array,
            TypedArrayType::TypeUint32 => C::kJSTypedArrayTypeUint32Array,
            TypedArrayType::TypeFloat16 => C::kJSTypedArrayTypeNone,
            TypedArrayType::TypeFloat32 => C::kJSTypedArrayTypeFloat32Array,
            TypedArrayType::TypeFloat64 => C::kJSTypedArrayTypeFloat64Array,
            TypedArrayType::TypeBigInt64 => C::kJSTypedArrayTypeBigInt64Array,
            TypedArrayType::TypeBigUint64 => C::kJSTypedArrayTypeBigUint64Array,
            TypedArrayType::TypeDataView => C::kJSTypedArrayTypeNone,
        }
    }

    // LAYERING: Zig's `toNapi` (array_buffer.zig:524) maps to
    // `napi_typedarray_type`, which is defined in `bun_runtime` (a higher-tier
    // crate that depends on `bun_jsc`). The conversion lives next to its target
    // type as `napi_typedarray_type::from_typed_array_type` in
    // `bun_runtime::napi` to avoid the dep cycle.
}

// ──────────────────────────────────────────────────────────────────────────
// MarkedArrayBuffer
// ──────────────────────────────────────────────────────────────────────────

pub struct MarkedArrayBuffer {
    pub buffer: ArrayBuffer,
    // TODO(port): Zig stores `?std.mem.Allocator` to track ownership of the byte buffer.
    // In Rust the global allocator is implicit; we keep a bool flag so `destroy` knows
    // whether to mi_free the backing storage.
    pub owns_buffer: bool,
}

impl Default for MarkedArrayBuffer {
    fn default() -> Self {
        Self {
            buffer: ArrayBuffer::default(),
            owns_buffer: false,
        }
    }
}

// TODO(port): Zig `ArrayBuffer.Stream = std.io.FixedBufferStream([]u8)`.
// `std::io::Cursor<&mut [u8]>` is the closest in-memory equivalent.
// Hoisted to module scope (inherent associated type aliases are unstable).
pub type ArrayBufferStream<'a> = std::io::Cursor<&'a mut [u8]>;

impl MarkedArrayBuffer {
    #[inline]
    pub fn stream(&mut self) -> ArrayBufferStream<'_> {
        // TODO(port): see ArrayBuffer::stream lifetime note.
        std::io::Cursor::new(self.buffer.byte_slice_mut())
    }

    pub fn from_typed_array(ctx: &JSGlobalObject, value: JSValue) -> MarkedArrayBuffer {
        MarkedArrayBuffer {
            owns_buffer: false,
            buffer: ArrayBuffer::from_typed_array(ctx, value),
        }
    }

    pub fn from_array_buffer(ctx: &JSGlobalObject, value: JSValue) -> MarkedArrayBuffer {
        MarkedArrayBuffer {
            owns_buffer: false,
            buffer: ArrayBuffer::from_array_buffer(ctx, value),
        }
    }

    pub fn from_string(str: &[u8]) -> Result<MarkedArrayBuffer, bun_alloc::AllocError> {
        // allocator.dupe(u8, str) → Box::<[u8]>::from(str), but we need a raw mimalloc ptr
        // because the buffer is later freed via mi_free (MarkedArrayBuffer_deallocator).
        let buf: Box<[u8]> = Box::from(str);
        let len = buf.len();
        let ptr = bun_core::heap::into_raw(buf).cast::<u8>();
        // SAFETY: ptr/len from heap::alloc; backed by global mimalloc.
        let bytes = unsafe { bun_core::ffi::slice_mut(ptr, len) };
        Ok(MarkedArrayBuffer::from_bytes(bytes, JSType::Uint8Array))
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> Option<MarkedArrayBuffer> {
        let array_buffer = value.as_array_buffer(global)?;
        Some(MarkedArrayBuffer {
            buffer: array_buffer,
            owns_buffer: false,
        })
    }

    pub fn from_bytes(bytes: &mut [u8], typed_array_type: JSType) -> MarkedArrayBuffer {
        MarkedArrayBuffer {
            buffer: ArrayBuffer::from_bytes(bytes, typed_array_type),
            owns_buffer: true,
        }
    }

    pub const EMPTY: MarkedArrayBuffer = MarkedArrayBuffer {
        owns_buffer: false,
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
            // SAFETY: buffer.ptr was allocated via global mimalloc (heap::alloc / allocator.dupe).
            unsafe { mimalloc::mi_free(self.buffer.ptr.cast()) };
        }
    }

    pub fn to_node_buffer(&self, global: &JSGlobalObject) -> JSValue {
        // `JSValue::create_buffer` takes `&mut [u8]` (ownership transfers to JSC
        // via the deallocator). `ArrayBuffer` is `Copy` over a raw pointer, so
        // copy the descriptor and project a mutable slice — matches Zig
        // `jsc.JSValue.createBuffer(ctx, this.buffer.byteSlice())`.
        let mut buf = self.buffer;
        JSValue::create_buffer(global, buf.byte_slice_mut())
    }

    pub fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if !self.buffer.value.is_empty_or_undefined_or_null() {
            return Ok(self.buffer.value);
        }
        if self.buffer.byte_len == 0 {
            return make_typed_array_with_bytes_no_copy(
                global,
                self.buffer.typed_array_type.to_typed_array_type(),
                ptr::null_mut(),
                0,
                None,
                ptr::null_mut(),
            );
        }
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

// ──────────────────────────────────────────────────────────────────────────
// Deallocators
// ──────────────────────────────────────────────────────────────────────────

// `no_mangle` dropped: 0 C++ refs (phase_c_exports.rs mention is a comment).
#[allow(non_upper_case_globals)]
pub use bun_alloc::c_thunks::mi_free_bytes as MarkedArrayBuffer_deallocator;

// LAYERING: `BlobArrayBuffer_deallocator` (array_buffer.zig:646) releases a
// `Blob::Store` ref. `Store` is a `bun_runtime` type, so the `#[no_mangle]`
// export lives next to it at `bun_runtime::webcore::blob::Store` — `bun_jsc`
// cannot own this symbol without a dep cycle. C++ links by name only.

// ──────────────────────────────────────────────────────────────────────────
// Free functions
// ──────────────────────────────────────────────────────────────────────────

pub fn make_array_buffer_with_bytes_no_copy(
    global: &JSGlobalObject,
    ptr: *mut c_void,
    len: usize,
    deallocator: jsc_c::JSTypedArrayBytesDeallocator,
    deallocator_context: *mut c_void,
) -> JsResult<JSValue> {
    // ptr/len/deallocator are forwarded as-is to JSC which adopts ownership.
    crate::host_fn::from_js_host_call(global, || {
        Bun__makeArrayBufferWithBytesNoCopy(global, ptr, len, deallocator, deallocator_context)
    })
}

pub fn make_typed_array_with_bytes_no_copy(
    global: &JSGlobalObject,
    array_type: TypedArrayType,
    ptr: *mut c_void,
    len: usize,
    deallocator: jsc_c::JSTypedArrayBytesDeallocator,
    deallocator_context: *mut c_void,
) -> JsResult<JSValue> {
    // ptr/len/deallocator are forwarded as-is to JSC which adopts ownership.
    crate::host_fn::from_js_host_call(global, || {
        Bun__makeTypedArrayWithBytesNoCopy(
            global,
            array_type,
            ptr,
            len,
            deallocator,
            deallocator_context,
        )
    })
}

// ──────────────────────────────────────────────────────────────────────────
// JSCArrayBuffer (opaque, corresponds to JSC::ArrayBuffer)
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// Corresponds to `JSC::ArrayBuffer`.
    pub struct JSCArrayBuffer;
}

// Zig: `pub const Ref = bun.ptr.ExternalShared(Self)` with
// `external_shared_descriptor = struct { ref, deref }` (array_buffer.zig:673).
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

// ported from: src/jsc/array_buffer.zig
