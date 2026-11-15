use core::cell::Cell;

use crate::webcore::streams;
use bun_jsc::HostReturn as _;
use bun_jsc::{ArrayBuffer, JSType, JSValue};
use bun_ptr::{CellExt as _, VecCellExt as _};
use bun_sys as syscall;

#[derive(Default)]
pub(crate) struct ArrayBufferSink {
    bytes: Cell<Vec<u8>>,
    // allocator field dropped — global mimalloc (non-AST crate, see PORTING.md §Allocators)
    done: Cell<bool>,
    streaming: Cell<bool>,
    as_uint8array: Cell<bool>,
}

impl ArrayBufferSink {
    pub(crate) fn start(&self, stream_start: &streams::Start) -> bun_sys::Result<()> {
        self.bytes.clear();

        if let streams::Start::ArrayBufferSink {
            chunk_size,
            as_uint8array,
            stream,
        } = *stream_start
        {
            if chunk_size > 0 {
                let reserved = self
                    .bytes
                    .with_taken(|bytes| bytes.try_reserve_exact(chunk_size as usize));
                if reserved.is_err() {
                    return Err(syscall::Error::oom());
                }
            }

            self.as_uint8array.set(as_uint8array);
            self.streaming.set(stream);
        }

        self.done.set(false);
        Ok(())
    }

    pub(crate) fn flush_from_js(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        _wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if self.streaming.get() {
            let value = self.bytes.with_taken(|bytes| {
                let value = if self.as_uint8array.get() {
                    ArrayBuffer::create::<{ JSType::Uint8Array }>(cx.global(), bytes)
                } else {
                    ArrayBuffer::create::<{ JSType::ArrayBuffer }>(cx.global(), bytes)
                };
                bytes.clear();
                value
            });
            // Host return: empty ⇒ the exception `create` left pending.
            return Ok(value.or_pending_exception());
        }

        Ok(JSValue::js_number(0.0))
    }

    pub(crate) fn write(&self, data: &streams::Result<'_>) -> streams::result::Writable<'_> {
        let bytes = data.slice();
        self.bytes.extend_from_slice(bytes);
        streams::result::Writable::Owned(bytes.len() as u64)
    }

    pub(crate) fn write_latin1(&self, data: &streams::Result<'_>) -> streams::result::Writable<'_> {
        let len = streams::append_latin1(&self.bytes, data.slice());
        streams::result::Writable::Owned(len as u64)
    }

    pub(crate) fn write_utf16(&self, text: &[u16]) -> streams::result::Writable<'_> {
        let len = streams::append_utf16(&self.bytes, text);
        streams::result::Writable::Owned(len as u64)
    }

    pub(crate) fn end(&self, _: Option<syscall::Error>) -> bun_sys::Result<()> {
        Ok(())
    }

    pub(crate) fn end_from_js(&self, _cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<ArrayBuffer> {
        if self.done.get() {
            return Ok(ArrayBuffer::from_bytes(&mut [], JSType::ArrayBuffer));
        }

        self.done.set(true);
        // `defer this.bytes = bun.Vec<u8>.empty` → take ownership, leave empty.
        let bytes = self.bytes.take();
        // Ownership transfers to JSC: the trait impl below converts the returned
        // `ArrayBuffer` with `to_js_unchecked`, which installs
        // `MarkedArrayBuffer_deallocator` (frees via `mi_free` on GC).
        let owned = bytes.into_boxed_slice();
        Ok(ArrayBuffer::from_owned_bytes(
            owned,
            if self.as_uint8array.get() {
                JSType::Uint8Array
            } else {
                JSType::ArrayBuffer
            },
        ))
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink)
        // which includes @sizeOf(ArrayBufferSink).
        self.bytes.capacity()
    }
}

impl crate::webcore::sink::WrappedSink for ArrayBufferSink {
    type Wrapped = Self;
    fn wrapper_closed(&self) {
        self.bytes.take();
    }
}

impl crate::webcore::sink::JsSinkType for ArrayBufferSink {
    const NAME: &'static str = "ArrayBufferSink";

    crate::impl_js_sink_forwarders!();

    fn end_from_js(&self, cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        match Self::end_from_js(self, cx) {
            // Not `to_js`: its `mi_is_in_heap_region` probe would skip the
            // deallocator when the global allocator isn't mimalloc.
            bun_sys::Result::Ok(ab) => bun_sys::Result::Ok(match ab.to_js_unchecked(cx.global()) {
                Ok(v) => v,
                Err(_) => JSValue::ZERO,
            }),
            bun_sys::Result::Err(e) => bun_sys::Result::Err(e),
        }
    }
}
