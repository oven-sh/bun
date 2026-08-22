use crate::webcore::streams::{self, SourceHandle};
use bun_collections::{ByteVecExt, VecExt};
use bun_jsc::HostReturn as _;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue};
use bun_sys as syscall;

// The "ArrayBufferSink" symbol-name concatenation lives in the `JsSinkAbi`
// impl in `Sink.rs` (see `array_buffer_sink_abi`).

#[derive(Default)]
pub struct ArrayBufferSink {
    pub(crate) bytes: Vec<u8>,
    // allocator field dropped — global mimalloc (non-AST crate, see PORTING.md §Allocators)
    pub(crate) done: bool,
    pub(crate) source: SourceHandle,
    pub(crate) streaming: bool,
    pub(crate) as_uint8array: bool,
}

impl ArrayBufferSink {
    pub(crate) fn start(&mut self, stream_start: &streams::Start) -> bun_sys::Result<()> {
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

        self.source.start();
        Ok(())
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        Ok(())
    }

    pub(crate) fn flush_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        _wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if self.streaming {
            let value = if self.as_uint8array {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, self.bytes.slice())
            } else {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, self.bytes.slice())
            };
            self.bytes.clear();
            // Host return: empty ⇒ the exception `create` left pending.
            return Ok(value.or_pending_exception());
        }

        Ok(JSValue::js_number(0.0))
    }

    // In-place init (JSSink m_ctx slot) — codegen calls this on a
    // pre-allocated slot.
    pub(crate) fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        this.write(ArrayBufferSink {
            bytes: Vec::<u8>::default(),
            done: false,
            source: SourceHandle::default(),
            streaming: false,
            as_uint8array: false,
        });
    }

    pub fn write(&mut self, data: &streams::Result) -> streams::result::Writable {
        let len = match self.bytes.write(data.slice()) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.source.ready(None, None);
        streams::result::Writable::Owned(len as u64)
    }

    pub(crate) fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable {
        let len = match self.bytes.write_latin1(data.slice()) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.source.ready(None, None);
        streams::result::Writable::Owned(len as u64)
    }

    pub(crate) fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable {
        let bytes = data.slice();
        // The caller guarantees the byte slice is u16-aligned and has even
        // length when the stream encoding is UTF-16. bytemuck checks both at
        // runtime.
        let utf16: &[u16] = bytemuck::cast_slice(bytes);
        let len = match self.bytes.write_utf16(utf16) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.source.ready(None, None);
        streams::result::Writable::Owned(len as u64)
    }

    pub(crate) fn end(&mut self, err: Option<syscall::Error>) -> bun_sys::Result<()> {
        self.source.close(err);
        Ok(())
    }

    /// # Safety
    /// `this` is the allocation `js_construct` leaked into the JS wrapper, whose
    /// `__finalize` (the sole caller) frees it exactly once, here.
    pub(crate) unsafe fn destroy(this: *mut Self) {
        // SAFETY: reclaiming ownership drops `bytes` (Vec<u8> impls Drop) and
        // frees the box.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub(crate) fn end_from_js(&mut self, global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        if self.done {
            // Host return: empty ⇒ the exception `create` left pending.
            return Ok(
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, b"")
                    .or_pending_exception(),
            );
        }

        self.done = true;
        self.source.close(None);
        // `defer this.bytes = bun.Vec<u8>.empty` → take ownership, leave empty;
        // ownership of the allocation transfers to JSC.
        let mut bytes = core::mem::take(&mut self.bytes);
        Ok(bun_jsc::array_buffer::js_from_owned_slice(
            global_this,
            if self.as_uint8array {
                JSType::Uint8Array
            } else {
                JSType::ArrayBuffer
            },
            bytes.to_owned_slice(),
        )
        .or_pending_exception())
    }

    pub(crate) fn memory_cost(&self) -> usize {
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
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<streams::StartTag> = Some(streams::StartTag::ArrayBufferSink);

    crate::impl_js_sink_forwarders!();

    unsafe fn finalize(this: *mut Self) {
        // SAFETY: trait contract — `this` is the wrapper's live sink, which
        // `js_construct` allocated for it alone; nothing uses it afterwards.
        unsafe { Self::destroy(this) };
    }
    fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        Self::construct(this);
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn source(&mut self) -> Option<&mut SourceHandle> {
        Some(&mut self.source)
    }
}
