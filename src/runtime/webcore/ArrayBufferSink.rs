use crate::webcore::sink::{self, Sink, SinkHandler};
use crate::webcore::streams::{self, Signal};
use bun_collections::{ByteVecExt, VecExt};
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult};
use bun_sys as syscall;

pub type JSSink = sink::JSSink<ArrayBufferSink>;
// PORT NOTE: Zig passes the literal "ArrayBufferSink" as a 2nd comptime arg to
// `Sink.JSSink()`; in Rust the symbol-name concatenation lives in the
// `JsSinkAbi` impl in `Sink.rs` (see `array_buffer_sink_abi`).

pub struct ArrayBufferSink {
    pub bytes: Vec<u8>,
    // allocator field dropped — global mimalloc (non-AST crate, see PORTING.md §Allocators)
    pub done: bool,
    pub signal: Signal,
    // PORT NOTE: Zig `?Sink` stores a `*anyopaque` (raw, manually-managed
    // lifetime). The Rust `Sink<'a>` was ported with a borrow; using `'static`
    // here recovers the Zig semantics (caller is responsible for the pointee
    // outliving every dispatch). No call site sets `next` to non-`None` today.
    pub next: Option<Sink<'static>>,
    pub streaming: bool,
    pub as_uint8array: bool,
}

impl Default for ArrayBufferSink {
    fn default() -> Self {
        Self {
            bytes: Vec::<u8>::default(),
            done: false,
            signal: Signal::default(),
            next: None,
            streaming: false,
            as_uint8array: false,
        }
    }
}

impl ArrayBufferSink {
    pub fn connect(&mut self, signal: Signal) {
        // PORT NOTE: Zig asserts `this.reader == null` but there is no `reader`
        // field on this struct (dead Zig assert; lazy compilation never reaches it).
        self.signal = signal;
    }

    pub fn start(&mut self, stream_start: streams::Start) -> bun_sys::Result<()> {
        self.bytes.clear_retaining_capacity();

        if let streams::Start::ArrayBufferSink {
            chunk_size,
            as_uint8array,
            stream,
        } = stream_start
        {
            if chunk_size > 0 {
                self.bytes
                    .ensure_total_capacity_precise(chunk_size as usize);
            }

            self.as_uint8array = as_uint8array;
            self.streaming = stream;
        }

        self.done = false;

        self.signal.start();
        Ok(())
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        Ok(())
    }

    pub fn flush_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if self.streaming {
            // TODO: properly propagate exception upwards (matches Zig `catch .zero`).
            let value: JSValue = if self.as_uint8array {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, self.bytes.slice())
                    .unwrap_or(JSValue::ZERO)
            } else {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, self.bytes.slice())
                    .unwrap_or(JSValue::ZERO)
            };
            self.bytes.clear();
            if wait {}
            return Ok(value);
        }

        Ok(JSValue::js_number(0.0))
    }

    // PORT NOTE: NOT a `host_fn_finalize` target — JSSink uses its own
    // `${abi_name}__finalize` thunk (generated_jssink.rs), which calls
    // the trait `JsSinkType::finalize(&mut self)`; that forwards here. The
    // `Box<Self>` contract applies only to generate-classes.ts classes.
    pub fn finalize(this: *mut Self) {
        // SAFETY: called from JSC lazy sweep on the mutator thread; `this` is
        // the m_ctx payload allocated via heap::alloc in init/JSSink.
        unsafe { Self::destroy(this) };
    }

    pub fn init(
        next: Option<Sink<'static>>,
    ) -> Result<Box<ArrayBufferSink>, bun_alloc::AllocError> {
        Ok(Box::new(ArrayBufferSink {
            bytes: Vec::<u8>::default(),
            done: false,
            signal: Signal::default(),
            next,
            streaming: false,
            as_uint8array: false,
        }))
    }

    // PORT NOTE: in-place init (JSSink m_ctx slot) — codegen calls this on a
    // pre-allocated slot.
    pub fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        this.write(ArrayBufferSink {
            bytes: Vec::<u8>::default(),
            done: false,
            signal: Signal::default(),
            next: None,
            streaming: false,
            as_uint8array: false,
        });
    }

    pub fn write(&mut self, data: streams::Result) -> streams::result::Writable {
        if let Some(next) = &mut self.next {
            return next.write_bytes(data);
        }

        let len = match self.bytes.write(data.slice()) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.signal.ready(None, None);
        streams::result::Writable::Owned(len as u64)
    }

    #[inline]
    pub fn write_bytes(&mut self, data: streams::Result) -> streams::result::Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable {
        if let Some(next) = &mut self.next {
            return next.write_latin1(data);
        }
        let len = match self.bytes.write_latin1(data.slice()) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.signal.ready(None, None);
        streams::result::Writable::Owned(len as u64)
    }

    pub fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable {
        if let Some(next) = &mut self.next {
            return next.write_utf16(data);
        }
        let bytes = data.slice();
        // Mirrors Zig `@ptrCast(@alignCast(data.slice().ptr))` — caller
        // guarantees the byte slice is u16-aligned and has even length when the
        // stream encoding is UTF-16. bytemuck checks both at runtime.
        let utf16: &[u16] = bytemuck::cast_slice(bytes);
        let len = match self.bytes.write_utf16(utf16) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.signal.ready(None, None);
        streams::result::Writable::Owned(len as u64)
    }

    pub fn end(&mut self, err: Option<syscall::Error>) -> bun_sys::Result<()> {
        if let Some(next) = &mut self.next {
            return next.end(err);
        }
        self.signal.close(err);
        Ok(())
    }

    /// # Safety
    /// `this` must have been allocated via `heap::alloc` (i.e. by
    /// [`ArrayBufferSink::init`] or the JSSink codegen path) and not yet freed.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: reclaiming ownership drops `bytes` (Vec<u8> impls Drop) and
        // frees the box, matching Zig `this.bytes.deinit(...); bun.destroy(this)`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn to_js(
        &mut self,
        global_this: &JSGlobalObject,
        as_uint8array: bool,
    ) -> JsResult<JSValue> {
        if self.streaming {
            // PORT NOTE: Zig calls `ArrayBuffer.create()` here without `catch`
            // (dead path under Zig's lazy compilation). Propagate the JS
            // exception explicitly in Rust.
            let value: JSValue = if as_uint8array {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, self.bytes.slice())?
            } else {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, self.bytes.slice())?
            };
            self.bytes.clear();
            return Ok(value);
        }

        // `defer this.bytes = bun.Vec<u8>.empty` + `try toOwnedSlice` →
        // take ownership, leave empty in place.
        let mut bytes = core::mem::take(&mut self.bytes);
        // Ownership transfers to JSC — `to_js` installs
        // `MarkedArrayBuffer_deallocator` which `mi_free`s the buffer when the
        // JS object is collected. Bun's global allocator is mimalloc, so the
        // `mi_is_in_heap_region` check in `to_js` succeeds.
        let owned = bytes.to_owned_slice();
        ArrayBuffer::from_owned_bytes(
            owned,
            if as_uint8array {
                JSType::Uint8Array
            } else {
                JSType::ArrayBuffer
            },
        )
        .to_js(global_this)
    }

    pub fn end_from_js(&mut self, _global_this: &JSGlobalObject) -> bun_sys::Result<ArrayBuffer> {
        if self.done {
            return Ok(ArrayBuffer::from_bytes(&mut [], JSType::ArrayBuffer));
        }

        debug_assert!(self.next.is_none());
        self.done = true;
        self.signal.close(None);
        // `defer this.bytes = bun.Vec<u8>.empty` → take ownership, leave empty.
        let mut bytes = core::mem::take(&mut self.bytes);
        // Ownership transfers to JSC; the caller wraps the returned
        // `ArrayBuffer` in `.to_js()` which installs `MarkedArrayBuffer_deallocator`
        // (frees via `mi_free` on GC). See `to_js` above.
        let owned = bytes.to_owned_slice();
        Ok(ArrayBuffer::from_owned_bytes(
            owned,
            if self.as_uint8array {
                JSType::Uint8Array
            } else {
                JSType::ArrayBuffer
            },
        ))
    }

    pub fn sink(&mut self) -> Sink<'_> {
        Sink::init(self)
    }

    pub fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink)
        // which includes @sizeOf(ArrayBufferSink).
        self.bytes.capacity() as usize
    }
}

// `JsSinkType` impl: routes the codegen `ArrayBufferSink__*` thunks (via
// `JSSink::<Self>::js_*`) into the inherent streaming methods above. Mirrors
// `Sink.JSSink(@This(), "ArrayBufferSink")`.
impl crate::webcore::sink::JsSinkType for ArrayBufferSink {
    const NAME: &'static str = "ArrayBufferSink";
    const HAS_CONSTRUCT: bool = true;
    const HAS_SIGNAL: bool = true;
    const HAS_DONE: bool = true;
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<streams::StartTag> = Some(streams::StartTag::ArrayBufferSink);

    fn memory_cost(&self) -> usize {
        Self::memory_cost(self)
    }
    fn finalize(&mut self) {
        // Zig: ArrayBufferSink.finalize destroys the heap allocation; the
        // `JSSink::finalize` C export owns that path. The trait impl here is
        // the *inner* finalize.
        Self::finalize(std::ptr::from_mut::<Self>(self));
    }
    fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        Self::construct(this);
    }
    fn write_bytes(&mut self, data: streams::Result) -> streams::result::Writable {
        Self::write(self, data)
    }
    fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable {
        Self::write_utf16(self, data)
    }
    fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable {
        Self::write_latin1(self, data)
    }
    fn end(&mut self, err: Option<syscall::Error>) -> bun_sys::Result<()> {
        Self::end(self, err)
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        match Self::end_from_js(self, global) {
            bun_sys::Result::Ok(ab) => bun_sys::Result::Ok(match ab.to_js(global) {
                Ok(v) => v,
                Err(_) => JSValue::ZERO,
            }),
            bun_sys::Result::Err(e) => bun_sys::Result::Err(e),
        }
    }
    fn flush(&mut self) -> bun_sys::Result<()> {
        Self::flush(self)
    }
    fn flush_from_js(&mut self, global: &JSGlobalObject, wait: bool) -> bun_sys::Result<JSValue> {
        Self::flush_from_js(self, global, wait)
    }
    fn start(&mut self, config: streams::Start) -> bun_sys::Result<()> {
        Self::start(self, config)
    }
    fn signal(&mut self) -> Option<&mut Signal> {
        Some(&mut self.signal)
    }
    fn done(&self) -> bool {
        self.done
    }
}

crate::impl_sink_handler!(ArrayBufferSink);

// ported from: src/runtime/webcore/ArrayBufferSink.zig
