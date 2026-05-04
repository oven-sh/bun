use core::ffi::{c_uint, c_void};
use core::ptr;

use bun_jsc::{self as jsc, JSGlobalObject, JSType, JSValue, JsResult, JsError};
use bun_jsc::c as jsc_c; // jsc.C.* (JSTypedArrayType, JSTypedArrayBytesDeallocator, JSObjectMakeTypedArrayWithArrayBuffer)
use bun_sys::{self, Fd};
use bun_str as strings;
use bun_core::Output;
use bun_alloc::mimalloc;

bun_output::declare_scope!(ArrayBuffer, visible);

// ──────────────────────────────────────────────────────────────────────────
// ArrayBuffer
// ──────────────────────────────────────────────────────────────────────────

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
unsafe extern "C" {
    fn JSBuffer__fromMmap(global: *mut JSGlobalObject, addr: *mut c_void, len: usize) -> JSValue;
    fn ArrayBuffer__fromSharedMemfd(
        fd: i64,
        global: *mut JSGlobalObject,
        byte_offset: usize,
        byte_length: usize,
        total_size: usize,
        ty: JSType,
    ) -> JSValue;
    fn Bun__allocUint8ArrayForCopy(global: *mut JSGlobalObject, len: usize, out: *mut *mut c_void) -> JSValue;
    fn Bun__allocArrayBufferForCopy(global: *mut JSGlobalObject, len: usize, out: *mut *mut c_void) -> JSValue;
    fn Bun__createUint8ArrayForCopy(global: *mut JSGlobalObject, ptr: *const c_void, len: usize, buffer: bool) -> JSValue;
    fn Bun__createArrayBufferForCopy(global: *mut JSGlobalObject, ptr: *const c_void, len: usize) -> JSValue;
    fn JSArrayBuffer__fromDefaultAllocator(global: *mut JSGlobalObject, ptr: *mut u8, len: usize) -> JSValue;
    fn Bun__makeArrayBufferWithBytesNoCopy(
        global: *mut JSGlobalObject,
        ptr: *mut c_void,
        len: usize,
        dealloc: jsc_c::JSTypedArrayBytesDeallocator,
        ctx: *mut c_void,
    ) -> JSValue;
    fn Bun__makeTypedArrayWithBytesNoCopy(
        global: *mut JSGlobalObject,
        ty: TypedArrayType,
        ptr: *mut c_void,
        len: usize,
        dealloc: jsc_c::JSTypedArrayBytesDeallocator,
        ctx: *mut c_void,
    ) -> JSValue;
    fn JSC__ArrayBuffer__asBunArrayBuffer(self_: *mut JSCArrayBuffer, out: *mut ArrayBuffer);
    fn JSC__ArrayBuffer__ref(self_: *mut JSCArrayBuffer);
    fn JSC__ArrayBuffer__deref(self_: *mut JSCArrayBuffer);
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

    /// Only use this when reading from the file descriptor is _very_ cheap. Like, for example, an in-memory file descriptor.
    /// Do not use this for pipes, however tempting it may seem.
    pub fn to_js_buffer_from_fd(fd: Fd, size: usize, global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI — global is a valid &JSGlobalObject; fn accepts null ptr with explicit size.
        let buffer_value = unsafe {
            Bun__createUint8ArrayForCopy(global as *const _ as *mut _, ptr::null(), size, true)
        };
        if buffer_value.is_empty() {
            return JSValue::ZERO;
        }

        let mut array_buffer = buffer_value.as_array_buffer(global).expect("Unexpected");
        let mut bytes = array_buffer.byte_slice();

        buffer_value.ensure_still_alive();

        let mut read: isize = 0;
        while !bytes.is_empty() {
            match bun_sys::pread(fd, bytes, read) {
                bun_sys::Result::Ok(amount) => {
                    bytes = &mut bytes[amount..];
                    read += isize::try_from(amount).unwrap();

                    if amount == 0 {
                        if !bytes.is_empty() {
                            bytes.fill(0);
                        }
                        break;
                    }
                }
                bun_sys::Result::Err(err) => {
                    let Ok(err_js) = err.to_js(global) else { return JSValue::ZERO };
                    return global.throw_value(err_js).unwrap_or(JSValue::ZERO);
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
        // SAFETY: FFI — global is a valid &JSGlobalObject; all integer args are passed by value.
        unsafe {
            ArrayBuffer__fromSharedMemfd(fd, global as *const _ as *mut _, byte_offset, byte_length, total_size, ty)
        }
    }

    pub fn to_js_buffer_from_memfd(fd: Fd, global: &JSGlobalObject) -> JsResult<JSValue> {
        let stat = match bun_sys::fstat(fd) {
            bun_sys::Result::Err(err) => {
                fd.close();
                return global.throw_value(err.to_js(global)?);
            }
            bun_sys::Result::Ok(fstat) => fstat,
        };

        let size = stat.size;

        if size == 0 {
            fd.close();
            return Self::create_buffer(global, b"");
        }

        // mmap() is kind of expensive to do
        // It creates a new memory mapping.
        // If there is a lot of repetitive memory allocations in a tight loop, it performs poorly.
        // So we clone it when it's small.
        if size < Self::MMAP_THRESHOLD as i64 {
            let result = Self::to_js_buffer_from_fd(fd, usize::try_from(size).unwrap(), global);
            fd.close();
            return Ok(result);
        }

        // TODO(port): bun_sys mmap flag types (PROT/MAP) — mirror Zig std.posix.PROT / .{ .TYPE = .SHARED }
        let result = bun_sys::mmap(
            ptr::null_mut(),
            usize::try_from(size.max(0)).unwrap(),
            bun_sys::PROT::READ | bun_sys::PROT::WRITE,
            bun_sys::MapFlags { type_: bun_sys::MapType::Shared },
            fd,
            0,
        );
        fd.close();

        match result {
            bun_sys::Result::Ok(buf) => {
                // SAFETY: FFI — global is valid; buf is a fresh mmap region whose ownership transfers to JSC.
                Ok(unsafe {
                    JSBuffer__fromMmap(global as *const _ as *mut _, buf.as_mut_ptr().cast(), buf.len())
                })
            }
            bun_sys::Result::Err(err) => {
                let Ok(err_js) = err.to_js(global) else { return Ok(JSValue::ZERO) };
                global.throw_value(err_js).or(Ok(JSValue::ZERO))
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

    // TODO(port): Zig `Stream = std.io.FixedBufferStream([]u8)`. std::io::Cursor<&mut [u8]>
    // is the closest in-memory equivalent (no fs/net access).
    pub type Stream<'a> = std::io::Cursor<&'a mut [u8]>;

    #[inline]
    pub fn stream(self) -> Stream<'static> {
        // TODO(port): lifetime — Zig returns a stream over self.slice() (raw ptr-backed).
        // SAFETY: ptr is FFI-backed; caller must keep backing JSValue alive.
        let slice: &'static mut [u8] = unsafe { core::slice::from_raw_parts_mut(self.ptr, self.byte_len) };
        std::io::Cursor::new(slice)
    }

    // TODO(port): JSType needs `#[derive(ConstParamTy)]` for this const-generic to type-check.
    pub fn create<const KIND: JSType>(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        jsc::mark_binding();
        match KIND {
            // SAFETY: FFI — global is valid; bytes ptr/len come from a live slice, copied by callee.
            JSType::Uint8Array => jsc::from_js_host_call(global, || unsafe {
                Bun__createUint8ArrayForCopy(global as *const _ as *mut _, bytes.as_ptr().cast(), bytes.len(), false)
            }),
            // SAFETY: FFI — global is valid; bytes ptr/len come from a live slice, copied by callee.
            JSType::ArrayBuffer => jsc::from_js_host_call(global, || unsafe {
                Bun__createArrayBufferForCopy(global as *const _ as *mut _, bytes.as_ptr().cast(), bytes.len())
            }),
            _ => unreachable!("Not implemented yet"), // Zig: @compileError
        }
    }

    pub fn create_empty<const KIND: JSType>(global: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::mark_binding();
        match KIND {
            // SAFETY: FFI — global is valid; null ptr with len 0 is the documented empty case.
            JSType::Uint8Array => jsc::from_js_host_call(global, || unsafe {
                Bun__createUint8ArrayForCopy(global as *const _ as *mut _, ptr::null(), 0, false)
            }),
            // SAFETY: FFI — global is valid; null ptr with len 0 is the documented empty case.
            JSType::ArrayBuffer => jsc::from_js_host_call(global, || unsafe {
                Bun__createArrayBufferForCopy(global as *const _ as *mut _, ptr::null(), 0)
            }),
            _ => unreachable!("Not implemented yet"), // Zig: @compileError
        }
    }

    pub fn create_buffer(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        jsc::mark_binding();
        // SAFETY: FFI — global is valid; bytes ptr/len come from a live slice, copied by callee.
        jsc::from_js_host_call(global, || unsafe {
            Bun__createUint8ArrayForCopy(global as *const _ as *mut _, bytes.as_ptr().cast(), bytes.len(), true)
        })
    }

    pub fn create_uint8_array(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        jsc::mark_binding();
        // SAFETY: FFI — global is valid; bytes ptr/len come from a live slice, copied by callee.
        jsc::from_js_host_call(global, || unsafe {
            Bun__createUint8ArrayForCopy(global as *const _ as *mut _, bytes.as_ptr().cast(), bytes.len(), false)
        })
    }

    pub fn alloc<const KIND: JSType>(global: &JSGlobalObject, len: u32) -> JsResult<(JSValue, &mut [u8])> {
        let mut ptr_out: *mut u8 = ptr::null_mut();
        let buf = match KIND {
            // SAFETY: FFI — global is valid; ptr_out is a valid out-param written by callee on success.
            JSType::Uint8Array => jsc::from_js_host_call(global, || unsafe {
                Bun__allocUint8ArrayForCopy(global as *const _ as *mut _, len as usize, (&mut ptr_out as *mut *mut u8).cast())
            })?,
            // SAFETY: FFI — global is valid; ptr_out is a valid out-param written by callee on success.
            JSType::ArrayBuffer => jsc::from_js_host_call(global, || unsafe {
                Bun__allocArrayBufferForCopy(global as *const _ as *mut _, len as usize, (&mut ptr_out as *mut *mut u8).cast())
            })?,
            _ => unreachable!("Not implemented yet"), // Zig: @compileError
        };
        // SAFETY: Bun__alloc*ForCopy writes a valid `len`-byte buffer pointer into ptr_out on success.
        let slice = unsafe { core::slice::from_raw_parts_mut(ptr_out, len as usize) };
        Ok((buf, slice))
    }

    pub fn from_typed_array(ctx: &JSGlobalObject, value: JSValue) -> ArrayBuffer {
        value.as_array_buffer(ctx).unwrap()
    }

    pub fn to_js_from_default_allocator(global: &JSGlobalObject, bytes: &mut [u8]) -> JSValue {
        // SAFETY: FFI — global is valid; bytes is a mimalloc-backed buffer whose ownership transfers to JSC.
        unsafe { JSArrayBuffer__fromDefaultAllocator(global as *const _ as *mut _, bytes.as_mut_ptr(), bytes.len()) }
    }

    pub fn from_default_allocator<const TYPED_ARRAY_TYPE: JSType>(global: &JSGlobalObject, bytes: &mut [u8]) -> JSValue {
        match TYPED_ARRAY_TYPE {
            // SAFETY: FFI — global is valid; bytes is a mimalloc-backed buffer whose ownership transfers to JSC.
            JSType::ArrayBuffer => unsafe {
                JSArrayBuffer__fromDefaultAllocator(global as *const _ as *mut _, bytes.as_mut_ptr(), bytes.len())
            },
            JSType::Uint8Array => jsc::JSUint8Array::from_bytes(global, bytes),
            _ => unreachable!("Not implemented yet"), // Zig: @compileError
        }
    }

    pub fn from_bytes(bytes: &mut [u8], typed_array_type: JSType) -> ArrayBuffer {
        ArrayBuffer {
            len: u32::try_from(bytes.len()).unwrap() as usize,
            byte_len: u32::try_from(bytes.len()).unwrap() as usize,
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
            return make_array_buffer_with_bytes_no_copy(
                ctx,
                self.ptr.cast(),
                self.byte_len,
                Some(MarkedArrayBuffer_deallocator),
                // TODO(port): Zig passes &bun.default_allocator as opaque ctx; in Rust the global
                // allocator is implicit. Pass a non-null sentinel that the deallocator ignores.
                bun_alloc::default_allocator_sentinel(),
            );
        }

        make_typed_array_with_bytes_no_copy(
            ctx,
            self.typed_array_type.to_typed_array_type(),
            self.ptr.cast(),
            self.byte_len,
            Some(MarkedArrayBuffer_deallocator),
            bun_alloc::default_allocator_sentinel(),
        )
    }

    pub fn to_js(self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        if !self.value.is_empty() {
            return Ok(self.value);
        }

        // If it's not a mimalloc heap buffer, we're not going to call a deallocator
        if self.len > 0 && !mimalloc::mi_is_in_heap_region(self.ptr.cast()) {
            bun_output::scoped_log!(ArrayBuffer, "toJS but will never free: {} bytes", self.len);

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
    #[inline]
    pub fn byte_slice(&self) -> &mut [u8] {
        if self.is_detached() {
            return &mut [];
        }
        // SAFETY: ptr is non-null (checked above) and backed by JSC ArrayBuffer of byte_len bytes.
        unsafe { core::slice::from_raw_parts_mut(self.ptr, self.byte_len) }
    }

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    #[inline]
    pub fn slice(&self) -> &mut [u8] {
        self.byte_slice()
    }

    #[inline]
    pub fn as_u16(&self) -> &mut [u16] {
        // TODO(port): Zig @alignCast — Rust slices require natural alignment. This will be UB
        // if ptr is not 2-byte aligned. Phase B: consider returning &[Unaligned<u16>] or asserting.
        self.as_u16_unaligned()
    }

    #[inline]
    pub fn as_u16_unaligned(&self) -> &mut [u16] {
        if self.is_detached() {
            return &mut [];
        }
        // TODO(port): Zig returns []align(1) u16; Rust has no unaligned slice type.
        // SAFETY: ptr non-null; len = floor(byte_len/2). Alignment NOT checked — see above.
        let len = self.byte_len / core::mem::size_of::<u16>();
        unsafe { core::slice::from_raw_parts_mut(self.ptr.cast::<u16>(), len) }
    }

    #[inline]
    pub fn as_u32(&self) -> &mut [u32] {
        // TODO(port): see as_u16 alignment note.
        self.as_u32_unaligned()
    }

    #[inline]
    pub fn as_u32_unaligned(&self) -> &mut [u32] {
        if self.is_detached() {
            return &mut [];
        }
        // TODO(port): Zig returns []align(1) u32; Rust has no unaligned slice type.
        // SAFETY: ptr non-null; len = floor(byte_len/4). Alignment NOT checked.
        let len = self.byte_len / core::mem::size_of::<u32>();
        unsafe { core::slice::from_raw_parts_mut(self.ptr.cast::<u32>(), len) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ArrayBuffer.Strong
// ──────────────────────────────────────────────────────────────────────────

pub struct ArrayBufferStrong {
    pub array_buffer: ArrayBuffer,
    pub held: bun_jsc::Strong, // jsc.Strong.Optional → bun_jsc::Strong (Optional variant)
}

impl Default for ArrayBufferStrong {
    fn default() -> Self {
        Self { array_buffer: ArrayBuffer::default(), held: bun_jsc::Strong::empty() }
    }
}

impl ArrayBufferStrong {
    pub fn clear(&mut self) {
        // TODO(port): Zig source references `this.ref` which is not a field on this struct
        // (only `array_buffer` and `held` exist). This appears to be dead/broken code upstream.
        // Porting as a no-op matching the orelse-return on a missing field.
        let _ = self;
    }

    pub fn slice(&self) -> &mut [u8] {
        self.array_buffer.slice()
    }
}

// Zig `deinit` only calls `this.held.deinit()`; `bun_jsc::Strong` already impls `Drop`,
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
            let str = input.to_bun_string(global)?;
            // `str` derefs on Drop.
            // TODO(port): phf custom hasher — Zig uses Map.getWithEql(str, bun.String.eqlComptime)
            // to compare a bun.String against ASCII keys without transcoding. For now, transcode.
            let utf8 = str.to_utf8();
            return Ok(BINARY_TYPE_MAP.get(utf8.as_bytes()).copied());
        }

        Ok(None)
    }

    /// This clones bytes
    pub fn to_js(self, bytes: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            BinaryType::Buffer => ArrayBuffer::create_buffer(global, bytes),
            BinaryType::ArrayBuffer => ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, bytes),
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
                Ok(JSValue::c(jsc_c::JSObjectMakeTypedArrayWithArrayBuffer(
                    global,
                    self.to_typed_array_type().to_c(),
                    buffer.as_object_ref(),
                    ptr::null_mut(),
                )))
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
    pub fn to_c(self) -> jsc_c::JSTypedArrayType {
        use jsc_c::JSTypedArrayType::*;
        match self {
            TypedArrayType::TypeNone => kJSTypedArrayTypeNone,
            TypedArrayType::TypeInt8 => kJSTypedArrayTypeInt8Array,
            TypedArrayType::TypeInt16 => kJSTypedArrayTypeInt16Array,
            TypedArrayType::TypeInt32 => kJSTypedArrayTypeInt32Array,
            TypedArrayType::TypeUint8 => kJSTypedArrayTypeUint8Array,
            TypedArrayType::TypeUint8Clamped => kJSTypedArrayTypeUint8ClampedArray,
            TypedArrayType::TypeUint16 => kJSTypedArrayTypeUint16Array,
            TypedArrayType::TypeUint32 => kJSTypedArrayTypeUint32Array,
            TypedArrayType::TypeFloat16 => kJSTypedArrayTypeNone,
            TypedArrayType::TypeFloat32 => kJSTypedArrayTypeFloat32Array,
            TypedArrayType::TypeFloat64 => kJSTypedArrayTypeFloat64Array,
            TypedArrayType::TypeBigInt64 => kJSTypedArrayTypeBigInt64Array,
            TypedArrayType::TypeBigUint64 => kJSTypedArrayTypeBigUint64Array,
            TypedArrayType::TypeDataView => kJSTypedArrayTypeNone,
        }
    }

    pub fn to_napi(self) -> Option<bun_runtime::api::napi::napi_typedarray_type> {
        use bun_runtime::api::napi::napi_typedarray_type::*;
        match self {
            TypedArrayType::TypeNone => None,
            TypedArrayType::TypeInt8 => Some(int8_array),
            TypedArrayType::TypeInt16 => Some(int16_array),
            TypedArrayType::TypeInt32 => Some(int32_array),
            TypedArrayType::TypeUint8 => Some(uint8_array),
            TypedArrayType::TypeUint8Clamped => Some(uint8_clamped_array),
            TypedArrayType::TypeUint16 => Some(uint16_array),
            TypedArrayType::TypeUint32 => Some(uint32_array),
            TypedArrayType::TypeFloat16 => None,
            TypedArrayType::TypeFloat32 => Some(float32_array),
            TypedArrayType::TypeFloat64 => Some(float64_array),
            TypedArrayType::TypeBigInt64 => Some(bigint64_array),
            TypedArrayType::TypeBigUint64 => Some(biguint64_array),
            TypedArrayType::TypeDataView => None,
        }
    }
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
        Self { buffer: ArrayBuffer::default(), owns_buffer: false }
    }
}

impl MarkedArrayBuffer {
    #[inline]
    pub fn stream(&mut self) -> ArrayBuffer::Stream<'_> {
        // TODO(port): see ArrayBuffer::stream lifetime note.
        std::io::Cursor::new(self.buffer.byte_slice())
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
        let ptr = Box::into_raw(buf) as *mut u8;
        // SAFETY: ptr/len from Box::into_raw; backed by global mimalloc.
        let bytes = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
        Ok(MarkedArrayBuffer::from_bytes(bytes, JSType::Uint8Array))
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> Option<MarkedArrayBuffer> {
        let array_buffer = value.as_array_buffer(global)?;
        Some(MarkedArrayBuffer { buffer: array_buffer, owns_buffer: false })
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
    pub fn slice(&self) -> &mut [u8] {
        self.buffer.byte_slice()
    }

    /// Releases the owned byte buffer if this `MarkedArrayBuffer` was created with an
    /// allocator (e.g. via `from_string`/`from_bytes`). Does not free the struct itself;
    /// `MarkedArrayBuffer` is passed and stored by value, so callers own its storage.
    pub fn destroy(&mut self) {
        if self.owns_buffer {
            self.owns_buffer = false;
            // SAFETY: buffer.ptr was allocated via global mimalloc (Box::into_raw / allocator.dupe).
            unsafe { mimalloc::mi_free(self.buffer.ptr.cast()) };
        }
    }

    pub fn to_node_buffer(&self, ctx: &JSGlobalObject) -> JSValue {
        JSValue::create_buffer(ctx, self.buffer.byte_slice())
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
// Deallocators (exported to C++)
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn MarkedArrayBuffer_deallocator(bytes: *mut c_void, _ctx: *mut c_void) {
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    // if cfg!(debug_assertions) {
    //     debug_assert!(mimalloc::mi_check_owned(bytes) ||
    //         mimalloc::mi_heap_check_owned(jsc::VirtualMachine::get().arena.heap.unwrap(), bytes));
    // }

    // SAFETY: bytes was allocated by mimalloc (default_allocator); mi_free is null-safe.
    unsafe { mimalloc::mi_free(bytes) };
}

#[unsafe(no_mangle)]
pub extern "C" fn BlobArrayBuffer_deallocator(_bytes: *mut c_void, blob: *mut c_void) {
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    // SAFETY: blob is a *Blob.Store passed by C++ as the deallocator context.
    let store = blob.cast::<bun_runtime::webcore::blob::Store>();
    unsafe { (*store).deref_() };
    // TODO(port): Blob.Store deref — verify crate path bun_runtime::webcore::blob::Store
}

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
    // SAFETY: FFI — global is valid; ptr/len/deallocator are forwarded as-is to JSC which adopts ownership.
    jsc::from_js_host_call(global, || unsafe {
        Bun__makeArrayBufferWithBytesNoCopy(global as *const _ as *mut _, ptr, len, deallocator, deallocator_context)
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
    // SAFETY: FFI — global is valid; ptr/len/deallocator are forwarded as-is to JSC which adopts ownership.
    jsc::from_js_host_call(global, || unsafe {
        Bun__makeTypedArrayWithBytesNoCopy(global as *const _ as *mut _, array_type, ptr, len, deallocator, deallocator_context)
    })
}

// ──────────────────────────────────────────────────────────────────────────
// JSCArrayBuffer (opaque, corresponds to JSC::ArrayBuffer)
// ──────────────────────────────────────────────────────────────────────────

/// Corresponds to `JSC::ArrayBuffer`.
#[repr(C)]
pub struct JSCArrayBuffer {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): bun.ptr.ExternalShared(Self) — externally-refcounted handle wrapper.
// Map to bun_ptr::ExternalShared<JSCArrayBuffer> driven by the descriptor below.
pub type JSCArrayBufferRef = bun_ptr::ExternalShared<JSCArrayBuffer>;

pub mod jsc_array_buffer_external_shared_descriptor {
    use super::*;
    pub const REF: unsafe extern "C" fn(*mut JSCArrayBuffer) = JSC__ArrayBuffer__ref;
    pub const DEREF: unsafe extern "C" fn(*mut JSCArrayBuffer) = JSC__ArrayBuffer__deref;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/array_buffer.zig (692 lines)
//   confidence: medium
//   todos:      16
//   notes:      const-generic JSType needs ConstParamTy; unaligned u16/u32 slices need a Rust strategy; ArrayBufferStrong.clear references nonexistent field upstream; MarkedArrayBuffer allocator field collapsed to owns_buffer bool
// ──────────────────────────────────────────────────────────────────────────
