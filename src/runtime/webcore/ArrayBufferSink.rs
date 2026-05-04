use crate::webcore::sink::{self, Sink};
use crate::webcore::streams::{self, Signal};
use bun_collections::ByteList;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSValue};
use bun_sys as syscall;

pub type JSSink = sink::JSSink<ArrayBufferSink>;
// TODO(port): Zig passes the literal "ArrayBufferSink" as a 2nd comptime arg to JSSink(); encode via associated const on the JSSink trait/impl.

pub struct ArrayBufferSink {
    pub bytes: ByteList,
    // allocator field dropped — global mimalloc (non-AST crate, see PORTING.md §Allocators)
    pub done: bool,
    pub signal: Signal,
    pub next: Option<Sink>,
    pub streaming: bool,
    pub as_uint8array: bool,
}

impl Default for ArrayBufferSink {
    fn default() -> Self {
        Self {
            bytes: ByteList::default(),
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
        // TODO(port): Zig asserts `this.reader == null` but there is no `reader` field on this struct — preserve intent once upstream clarifies.
        // debug_assert!(self.reader.is_none());
        self.signal = signal;
    }

    pub fn start(&mut self, stream_start: streams::Start) -> bun_sys::Result<()> {
        self.bytes.clear();

        match stream_start {
            streams::Start::ArrayBufferSink(config) => {
                if config.chunk_size > 0 {
                    if self
                        .bytes
                        .ensure_total_capacity_precise(config.chunk_size)
                        .is_err()
                    {
                        return Err(syscall::Error::oom());
                    }
                }

                self.as_uint8array = config.as_uint8array;
                self.streaming = config.stream;
            }
            _ => {}
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
            let value: JSValue = match self.as_uint8array {
                true => ArrayBuffer::create(global_this, self.bytes.slice(), ArrayBuffer::Kind::Uint8Array)
                    .unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
                false => ArrayBuffer::create(global_this, self.bytes.slice(), ArrayBuffer::Kind::ArrayBuffer)
                    .unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
            };
            self.bytes.len = 0;
            if wait {}
            return Ok(value);
        }

        Ok(JSValue::js_number(0))
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called from JSC lazy sweep on the mutator thread; `this` is the m_ctx payload allocated via Box::into_raw in init/JSSink.
        unsafe { Self::destroy(this) };
    }

    pub fn init(next: Option<Sink>) -> Result<Box<ArrayBufferSink>, bun_alloc::AllocError> {
        Ok(Box::new(ArrayBufferSink {
            bytes: ByteList::default(),
            done: false,
            signal: Signal::default(),
            next,
            streaming: false,
            as_uint8array: false,
        }))
    }

    // TODO(port): in-place init (JSSink m_ctx slot) — codegen calls this on a pre-allocated slot.
    pub fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        this.write(ArrayBufferSink {
            bytes: ByteList::default(),
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
        streams::result::Writable::Owned(len)
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
        streams::result::Writable::Owned(len)
    }

    pub fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable {
        if let Some(next) = &mut self.next {
            return next.write_utf16(data);
        }
        let bytes = data.slice();
        // SAFETY: mirrors Zig `@ptrCast(@alignCast(data.slice().ptr))` — caller guarantees the
        // byte slice is u16-aligned and has even length when the stream encoding is UTF-16.
        let utf16: &[u16] = unsafe {
            core::slice::from_raw_parts(bytes.as_ptr().cast::<u16>(), bytes.len() / 2)
        };
        let len = match self.bytes.write_utf16(utf16) {
            Ok(len) => len,
            Err(_) => return streams::result::Writable::Err(syscall::Error::oom()),
        };
        self.signal.ready(None, None);
        streams::result::Writable::Owned(len)
    }

    pub fn end(&mut self, err: Option<syscall::Error>) -> bun_sys::Result<()> {
        if let Some(next) = &mut self.next {
            return next.end(err);
        }
        self.signal.close(err);
        Ok(())
    }

    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` was allocated via Box::into_raw (bun.new → Box::new); reclaiming ownership
        // here drops `bytes` (ByteList impls Drop) and frees the box, matching `bun.destroy(this)`.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject, as_uint8array: bool) -> JSValue {
        if self.streaming {
            // TODO(port): Zig calls ArrayBuffer.create() here WITHOUT `catch`, unlike flush_from_js — verify whether this path is infallible upstream.
            let value: JSValue = match as_uint8array {
                true => ArrayBuffer::create(global_this, self.bytes.slice(), ArrayBuffer::Kind::Uint8Array)
                    .unwrap_or(JSValue::ZERO),
                false => ArrayBuffer::create(global_this, self.bytes.slice(), ArrayBuffer::Kind::ArrayBuffer)
                    .unwrap_or(JSValue::ZERO),
            };
            self.bytes.len = 0;
            return value;
        }

        // `defer this.bytes = bun.ByteList.empty` + `try toOwnedSlice` → take ownership, leave empty in place.
        let bytes = core::mem::take(&mut self.bytes);
        // TODO(port): Zig has `try` here but fn returns bare JSValue (no error union) — handleOom semantics assumed.
        let owned = bytes.to_owned_slice().expect("unreachable");
        ArrayBuffer::from_bytes(
            owned,
            if as_uint8array {
                ArrayBuffer::Kind::Uint8Array
            } else {
                ArrayBuffer::Kind::ArrayBuffer
            },
        )
        .to_js(global_this, None)
    }

    pub fn end_from_js(&mut self, _global_this: &JSGlobalObject) -> bun_sys::Result<ArrayBuffer> {
        if self.done {
            return Ok(ArrayBuffer::from_bytes(
                Box::<[u8]>::default(),
                ArrayBuffer::Kind::ArrayBuffer,
            ));
        }

        debug_assert!(self.next.is_none());
        self.done = true;
        self.signal.close(None);
        // `defer this.bytes = bun.ByteList.empty` → take ownership, leave empty in place.
        let bytes = core::mem::take(&mut self.bytes);
        Ok(ArrayBuffer::from_bytes(
            bytes.to_owned_slice().expect("unreachable"), // bun.handleOom
            if self.as_uint8array {
                ArrayBuffer::Kind::Uint8Array
            } else {
                ArrayBuffer::Kind::ArrayBuffer
            },
        ))
    }

    pub fn sink(&mut self) -> Sink {
        Sink::init(self)
    }

    pub fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        self.bytes.cap as usize
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ArrayBufferSink.zig (186 lines)
//   confidence: medium
//   todos:      5
//   notes:      JSSink<T> generic shape, ArrayBuffer::Kind enum path, and streams::result::Writable variant names are guesses; allocator field dropped (global mimalloc); construct() kept as in-place MaybeUninit init (JSSink m_ctx slot).
// ──────────────────────────────────────────────────────────────────────────
