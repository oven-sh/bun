use crate::webcore::sink::{self, Sink};
use crate::webcore::streams::{self, Signal};
use bun_collections::{ByteVecExt, VecExt};
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult};
use bun_sys as syscall;

pub type JSSink = sink::JSSink<ArrayBufferSink>;
// The "ArrayBufferSink" symbol-name concatenation lives in the `JsSinkAbi`
// impl in `Sink.rs` (see `array_buffer_sink_abi`).

#[derive(Default)]
pub struct ArrayBufferSink {
    pub bytes: Vec<u8>,
    // allocator field dropped — global mimalloc (non-AST crate, see PORTING.md §Allocators)
    pub done: bool,
    pub signal: Signal,
    // `Sink<'a>` carries a borrow; `'static` here means the caller is
    // responsible for the pointee outliving every dispatch. No call site sets
    // `next` to non-`None` today.
    pub next: Option<Sink<'static>>,
    pub streaming: bool,
    pub as_uint8array: bool,
}

impl ArrayBufferSink {
    pub fn connect(&mut self, signal: Signal) {
        self.signal = signal;
    }

    pub fn start(&mut self, stream_start: &streams::Start) -> bun_sys::Result<()> {
        self.bytes.clear_retaining_capacity();

        if let streams::Start::ArrayBufferSink {
            chunk_size,
            as_uint8array,
            stream,
        } = *stream_start
        {
            if chunk_size > 0 {
                if self.bytes.try_reserve_exact(chunk_size as usize).is_err() {
                    return Err(syscall::Error::oom());
                }
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
        _wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if self.streaming {
            // TODO: properly propagate exception upwards.
            let value: JSValue = if self.as_uint8array {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, self.bytes.slice())
                    .unwrap_or(JSValue::ZERO)
            } else {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, self.bytes.slice())
                    .unwrap_or(JSValue::ZERO)
            };
            self.bytes.clear();
            return Ok(value);
        }

        Ok(JSValue::js_number(0.0))
    }

    // NOT a `host_fn_finalize` target — JSSink uses its own
    // `${abi_name}__finalize` thunk (generated_jssink.rs), which calls
    // the trait `JsSinkType::finalize(&mut self)`; that forwards here. The
    // `Box<Self>` contract applies only to generate-classes.ts classes.
    /// # Safety
    /// `this` must be the m_ctx payload allocated via `heap::alloc` in
    /// init/JSSink, called from JSC lazy sweep on the mutator thread.
    // Forwards `this` to `destroy` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on this forwarding wrapper.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` is the heap-allocated m_ctx payload (see `# Safety`
        // above); it has not been freed yet, so `destroy` may reclaim it.
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

    // In-place init (JSSink m_ctx slot) — codegen calls this on a
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

    pub fn write(&mut self, data: &streams::Result) -> streams::result::Writable {
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
    pub fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable {
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

    pub fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable {
        if let Some(next) = &mut self.next {
            return next.write_utf16(data);
        }
        let bytes = data.slice();
        // The caller guarantees the byte slice is u16-aligned and has even
        // length when the stream encoding is UTF-16. bytemuck checks both at
        // runtime.
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
        // frees the box.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn to_js(
        &mut self,
        global_this: &JSGlobalObject,
        as_uint8array: bool,
    ) -> JsResult<JSValue> {
        if self.streaming {
            // Propagate the JS exception explicitly.
            let value: JSValue = if as_uint8array {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, self.bytes.slice())?
            } else {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, self.bytes.slice())?
            };
            self.bytes.clear();
            return Ok(value);
        }

        // Take ownership of the bytes, leaving an empty Vec in place.
        let mut bytes = core::mem::take(&mut self.bytes);
        // `to_js_unchecked`, not `to_js`: `to_js`'s `mi_is_in_heap_region`
        // probe skips the deallocator when the global allocator isn't mimalloc.
        let owned = bytes.to_owned_slice();
        ArrayBuffer::from_owned_bytes(
            owned,
            if as_uint8array {
                JSType::Uint8Array
            } else {
                JSType::ArrayBuffer
            },
        )
        .to_js_unchecked(global_this)
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
        // The `JSSink::finalize` C export owns destroying the heap
        // allocation; the trait impl here is the *inner* finalize.
        Self::finalize(std::ptr::from_mut::<Self>(self));
    }
    fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        Self::construct(this);
    }
    fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable {
        Self::write(self, data)
    }
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable {
        Self::write_utf16(self, data)
    }
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable {
        Self::write_latin1(self, data)
    }
    fn end(&mut self, err: Option<syscall::Error>) -> bun_sys::Result<()> {
        Self::end(self, err)
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        match Self::end_from_js(self, global) {
            bun_sys::Result::Ok(ab) => bun_sys::Result::Ok(match ab.to_js_unchecked(global) {
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
        Self::start(self, &config)
    }
    fn signal(&mut self) -> Option<&mut Signal> {
        Some(&mut self.signal)
    }
    fn done(&self) -> bool {
        self.done
    }
}

crate::impl_sink_handler!(ArrayBufferSink);
