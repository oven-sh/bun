use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use crate::webcore::jsc::SysErrorJsc as _;
use crate::webcore::jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
// `bun_jsc` not yet a dep; alias to local shim so `bun_jsc::Strong` etc. resolve.
use crate::webcore::jsc as bun_jsc;
use bun_collections::VecExt;
use bun_ptr::RefPtr;

use crate::webcore::streams;
use crate::webcore::{self, Blob, ByteBlobLoader, ByteStream, FileReader};

#[derive(Copy, Clone)]
pub struct ReadableStream {
    pub value: JSValue,
    pub ptr: Source,
}

/// Outcome of [`ReadableStream::wire_native_sink`].
pub enum NativeWireResult {
    /// The sink was installed on the native source; the source will call
    /// `SinkHandle::end` itself when it's done.
    Wired,
    /// Not a native source (no `Bytes`/`File` backing, or it already has a
    /// sink). Fall through to the JS-pump path.
    NotNative,
    /// The source was already done or errored. The sink was not left
    /// installed; the caller runs its own end-of-stream handling.
    EndedInline(Option<streams::StreamError>),
}

// ─── ReadableStream::Strong ──────────────────────────────────────────────────

/// A `ReadableStream` handle for [`crate::webcore::body::PendingValue`] and the
/// producers that feed it.
#[derive(Default)]
pub enum Strong {
    #[default]
    Empty,
    /// GC-roots the stream.
    Held(bun_jsc::Strong),
    /// After [`Self::downgrade`]: the owning wrapper's `m_stream` `WriteBarrier`
    /// roots the stream; observed through a real `JSC::Weak` so readers see
    /// `None` once the stream (and its `NewSource<_>`) is collected.
    Weak(bun_jsc::Weak<()>),
}

/// Re-export under the qualified name callers expect.
pub type ReadableStreamStrong = Strong;

impl Strong {
    fn value(&self) -> Option<JSValue> {
        match self {
            Self::Empty => None,
            Self::Held(s) => Some(s.get()),
            Self::Weak(w) => w.get(),
        }
    }

    pub(crate) fn has(&mut self) -> bool {
        self.value().is_some()
    }

    pub(crate) fn is_disturbed(&self, global: &JSGlobalObject) -> bool {
        if let Some(stream) = self.get() {
            return stream.is_disturbed(global);
        }
        false
    }

    pub(crate) fn init(this: ReadableStream, global: &JSGlobalObject) -> Strong {
        Self::Held(bun_jsc::Strong::create(this.value, global))
    }

    /// Release the GC root while keeping the stream readable via `Weak`. The
    /// owning wrapper's `m_stream` `WriteBarrier` keeps the stream alive from
    /// here.
    pub(crate) fn downgrade(&mut self, global: &JSGlobalObject) {
        if let Self::Held(s) = self {
            *self = Self::Weak(bun_jsc::Weak::create_passive(s.get(), global));
        }
    }

    pub(crate) fn deinit(&mut self) {
        *self = Self::Empty;
    }

    /// The held stream, re-tagged. Pure: no script, no exception, no trap poll (unlike
    /// [`ReadableStream::from_js`], which converts arbitrary values).
    pub(crate) fn get(&self) -> Option<ReadableStream> {
        self.value().and_then(ReadableStream::from_js_direct)
    }

    pub(crate) fn tee(&mut self, global: &JSGlobalObject) -> JsResult<Option<ReadableStream>> {
        if let Some(stream) = self.get() {
            let Some((first, second)) = stream.tee(global)? else {
                return Ok(None);
            };
            match self {
                Self::Held(s) => s.set(global, first.value),
                Self::Weak(_) | Self::Empty => {
                    *self = Self::Weak(bun_jsc::Weak::create_passive(first.value, global))
                }
            }
            return Ok(Some(second));
        }
        Ok(None)
    }
}

// ─── extern fns ──────────────────────────────────────────────────────────────

unsafe extern "C" {
    /// C++ writes the two teed-stream JSValues into the out-params; reference
    /// params encode the non-null/aligned precondition.
    safe fn ReadableStream__tee(
        stream: JSValue,
        global_this: &JSGlobalObject,
        out1: &mut JSValue,
        out2: &mut JSValue,
    ) -> bool;
    /// A held `JSReadableStream`'s tag and native source (`Invalid` if `value` is anything else). Pure.
    safe fn ReadableStreamTag__taggedStream(value: JSValue, ptr: &mut *mut c_void) -> Tag;
    /// `possible_readable_stream` is read+overwritten in place; `ptr` is a
    /// stack out-param. Reference params discharge the only preconditions.
    safe fn ReadableStreamTag__tagged(
        global_object: &JSGlobalObject,
        possible_readable_stream: &mut JSValue,
        ptr: &mut *mut c_void,
    ) -> Tag;
    safe fn ReadableStream__is(value: JSValue) -> bool;
    safe fn ReadableStream__isDisturbed(
        possible_readable_stream: JSValue,
        global_object: &JSGlobalObject,
    ) -> bool;
    safe fn ReadableStream__isLocked(
        possible_readable_stream: JSValue,
        global_object: &JSGlobalObject,
    ) -> bool;
    safe fn ReadableStream__empty(global: &JSGlobalObject) -> JSValue;
    safe fn ReadableStream__used(global: &JSGlobalObject) -> JSValue;
    safe fn ReadableStream__errored(global: &JSGlobalObject, reason: JSValue) -> JSValue;
    safe fn ReadableStream__fromDecodedText(global: &JSGlobalObject, string: JSValue) -> JSValue;
    safe fn ReadableStream__textDecodeFrom(global: &JSGlobalObject, source: JSValue) -> JSValue;
    safe fn ReadableStream__detach(stream: JSValue, global: &JSGlobalObject);
    safe fn ReadableStream__lockNative(stream: JSValue, global: &JSGlobalObject);
    safe fn ZigGlobalObject__createNativeReadableStream(
        global: &JSGlobalObject,
        native_ptr: JSValue,
    ) -> JSValue;
    safe fn ZigGlobalObject__createNativeTextReadableStream(
        global: &JSGlobalObject,
        native_ptr: JSValue,
    ) -> JSValue;
}

// ─── ReadableStream methods ──────────────────────────────────────────────────
impl ReadableStream {
    pub fn tee(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<(ReadableStream, ReadableStream)>> {
        let mut out1 = JSValue::ZERO;
        let mut out2 = JSValue::ZERO;
        let ok = bun_jsc::from_js_host_call_generic(global_this, || {
            ReadableStream__tee(self.value, global_this, &mut out1, &mut out2)
        })?;
        if !ok {
            return Ok(None);
        }
        let (Some(out_stream1), Some(out_stream2)) = (
            ReadableStream::from_js_direct(out1),
            ReadableStream::from_js_direct(out2),
        ) else {
            return Ok(None);
        };
        Ok(Some((out_stream1, out_stream2)))
    }

    /// Re-read this stream's tag (its native source may have changed hands). Pure, like `from_js_direct`.
    pub fn reload_tag(&mut self) {
        *self = ReadableStream::from_js_direct(self.value).unwrap_or(ReadableStream {
            ptr: Source::Invalid,
            value: JSValue::ZERO,
        });
    }

    pub fn to_any_blob(&mut self, global_this: &JSGlobalObject) -> Option<webcore::blob::Any> {
        if self.is_disturbed(global_this) {
            return None;
        }

        self.reload_tag();

        match self.ptr {
            Source::Blob(_) => {
                let blobby = self.ptr.blob().expect("matched Blob");
                if let Some(blob) = blobby.to_any_blob(global_this) {
                    self.done();
                    return Some(blob);
                }
            }
            Source::File(_) => {
                let blobby = self.ptr.file().expect("matched File");
                if let webcore::file_reader::Lazy::Blob(store) = blobby.lazy.get() {
                    let blob = Blob::init_with_store(store.clone(), global_this);
                    // it should be lazy, file shouldn't have opened yet.
                    debug_assert!(!blobby.started.get());
                    self.done();
                    return Some(webcore::blob::Any::Blob(blob));
                }
            }
            Source::Bytes(_) => {
                let bytes = self.ptr.bytes().expect("matched Bytes");
                // If we've received the complete body by the time this function is called
                // we can avoid streaming it and convert it to a Blob
                if let Some(blob) = bytes.to_any_blob() {
                    self.done();
                    return Some(blob);
                }
                return None;
            }
            _ => {}
        }

        None
    }

    pub fn done(&self) {
        // done is called when we are done consuming the stream
        // cancel actually mark the stream source as done
        // this will resolve any pending promises to done: true
        match self.ptr {
            Source::Blob(_) => self.ptr.blob().expect("matched Blob").parent().cancel(),
            Source::File(_) => self.ptr.file().expect("matched File").parent().cancel(),
            Source::Bytes(_) => self.ptr.bytes().expect("matched Bytes").parent().cancel(),
            _ => {}
        }
    }

    /// Cancel the stream (an `AbortError` reason) and mark its native source done. The source's own
    /// cancel failure is the cancel promise's (handled) rejection; `Err` is anything thrown synchronously.
    pub fn cancel(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        let result = bun_jsc::cpp::ReadableStream__cancel(self.value, global_this);
        self.done();
        result
    }

    /// Cancel the stream and forward `reason` verbatim to the underlying source's
    /// cancel algorithm (the spec's ReadableStreamCancel). Unlike `cancel()`,
    /// this does not synthesize a DOMException — fetch() uses it to surface
    /// `AbortSignal.reason` to the request body's cancel callback.
    pub fn cancel_with_reason(
        &self,
        global_this: &JSGlobalObject,
        reason: JSValue,
    ) -> JsResult<()> {
        let result =
            bun_jsc::cpp::ReadableStream__cancelWithReason(self.value, global_this, reason);
        self.done();
        result
    }

    pub fn abort(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        // for now we are just calling cancel should be fine
        self.cancel(global_this)
    }

    /// Like [`Self::cancel`] but pending reads reject with `reason` instead of resolving `{done: true}`.
    pub(crate) fn error(&self, global_this: &JSGlobalObject, reason: JSValue) -> JsResult<()> {
        let result = bun_jsc::cpp::ReadableStream__error(self.value, global_this, reason);
        self.done();
        result
    }

    pub(crate) fn force_detach(&self, global_object: &JSGlobalObject) {
        ReadableStream__detach(self.value, global_object);
    }

    /// Mark the stream disturbed + locked-without-reader. Called by native
    /// fast-paths after wiring a `SinkHandle` directly so `.locked`,
    /// `.getReader()`, and body-mixin disturbed checks behave as they would
    /// after `readStreamIntoSink` acquires a reader.
    pub fn lock_native(&self, global_object: &JSGlobalObject) {
        ReadableStream__lockNative(self.value, global_object);
    }

    /// Wire `sink` directly to this stream's native `ByteStream`/`FileReader`
    /// source, skipping the JS pump. `set_source` is called with the matching
    /// [`SourceHandle`](streams::SourceHandle) before the source is driven;
    /// the source's `sinkOwner` slot is pointed at `owner_cell` (`owner`
    /// belongs to the producer side). See [`NativeWireResult`] for caller
    /// obligations.
    pub fn wire_native_sink(
        &self,
        global: &JSGlobalObject,
        sink: webcore::SinkHandle,
        owner_cell: JSValue,
        set_source: impl FnOnce(streams::SourceHandle),
    ) -> NativeWireResult {
        use streams::{SourceHandle, Start, StreamError, StreamResult, Writable};
        use webcore::SinkHandle;

        if let Some(byte_stream) = self.ptr.bytes() {
            if byte_stream.sink.get().is_none() {
                set_source(SourceHandle::ByteStream(byte_stream));
                byte_stream.parent().set_sink_owner(owner_cell);
                byte_stream.sink.set(sink);
                byte_stream.sink_paused.set(false);
                self.lock_native(global);
                byte_stream.signal_consumer_attached();

                if let Some(err) = byte_stream.take_pending_error() {
                    byte_stream.sink.set(SinkHandle::None);
                    return NativeWireResult::EndedInline(Some(err));
                }

                let buffered = byte_stream.take_buffer();
                let had_last = byte_stream.has_received_last_chunk.get();
                if !buffered.is_empty() {
                    let chunk = if had_last {
                        StreamResult::OwnedAndDone(buffered)
                    } else {
                        StreamResult::Owned(buffered)
                    };
                    match sink.write(&chunk) {
                        Writable::Backpressure(_) => byte_stream.sink_paused.set(true),
                        Writable::Done | Writable::Err(_) => {
                            byte_stream.sink.set(SinkHandle::None);
                            return NativeWireResult::EndedInline(None);
                        }
                        _ => {}
                    }
                }
                if had_last {
                    byte_stream.sink.set(SinkHandle::None);
                    return NativeWireResult::EndedInline(None);
                }
                // Wake the producer after the older bytes are in the sink;
                // any synchronous output routes through `on_data`.
                if !byte_stream.sink_paused.get() {
                    byte_stream.signal_drained();
                }
                return NativeWireResult::Wired;
            }
        }

        if let Some(file_reader) = self.ptr.file() {
            if !file_reader.done.get() && file_reader.sink.get().is_none() {
                match file_reader.start_for_sink(global) {
                    Some(Start::Err(e)) => {
                        use bun_sys_jsc::SystemErrorJsc;
                        let err_js = e.to_system_error().to_error_instance(global);
                        err_js.ensure_still_alive();
                        return NativeWireResult::EndedInline(Some(StreamError::JSValue(
                            jsc::strong::Optional::create(err_js, global),
                        )));
                    }
                    Some(Start::OwnedAndDone(bytes)) => {
                        let _ = sink.write(&StreamResult::OwnedAndDone(bytes));
                        return NativeWireResult::EndedInline(None);
                    }
                    Some(_) | None => {}
                }
                set_source(SourceHandle::FileReader(file_reader));
                file_reader.parent().set_sink_owner(owner_cell);
                file_reader.sink.set(sink);
                file_reader.sink_paused.set(true);
                self.lock_native(global);
                FileReader::pull_into_sink(file_reader.this_ptr());
                return NativeWireResult::Wired;
            }
        }

        NativeWireResult::NotNative
    }

    pub fn is_disturbed(&self, global_object: &JSGlobalObject) -> bool {
        is_disturbed_value(self.value, global_object)
    }

    pub fn is_locked(&self, global_object: &JSGlobalObject) -> bool {
        ReadableStream__isLocked(self.value, global_object)
    }

    /// A pure `dynamicDowncast<JSReadableStream>` type test: no tagging, no conversion.
    pub fn is_readable_stream(value: JSValue) -> bool {
        ReadableStream__is(value)
    }

    /// As [`from_js`](Self::from_js), but only matches a value that already is a `ReadableStream`
    /// (no async-iterable conversion): pure — no script, no exception, no trap poll.
    pub fn from_js_direct(value: JSValue) -> Option<ReadableStream> {
        let mut ptr: *mut c_void = core::ptr::null_mut();
        let tag = ReadableStreamTag__taggedStream(value, &mut ptr);
        Self::from_tag(tag, value, ptr)
    }

    fn from_tag(tag: Tag, value: JSValue, ptr: *mut c_void) -> Option<ReadableStream> {
        match tag {
            Tag::JavaScript => Some(ReadableStream {
                value,
                ptr: Source::JavaScript,
            }),
            // tag == Blob ⇒ ptr is the non-null `NewSource<ByteBlobLoader>` `m_ctx` from C++.
            Tag::Blob => Some(ReadableStream {
                value,
                ptr: Source::Blob(ptr.cast::<ByteBlobLoader>()),
            }),
            // tag == File ⇒ ptr is the non-null `NewSource<FileReader>` `m_ctx` from C++.
            Tag::File => Some(ReadableStream {
                value,
                ptr: Source::File(ptr.cast::<FileReader>()),
            }),
            // tag == Bytes ⇒ ptr is the non-null `NewSource<ByteStream>` `m_ctx` from C++.
            Tag::Bytes => Some(ReadableStream {
                value,
                ptr: Source::Bytes(ptr.cast::<ByteStream>()),
            }),
            _ => None,
        }
    }

    pub fn from_js(
        value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<ReadableStream>> {
        value.ensure_still_alive();
        let mut out = value;
        let mut ptr: *mut c_void = core::ptr::null_mut();

        let tag = bun_jsc::from_js_host_call_generic(global_this, || {
            ReadableStreamTag__tagged(global_this, &mut out, &mut ptr)
        })?;
        Ok(Self::from_tag(tag, out, ptr))
    }

    pub fn from_native(global_this: &JSGlobalObject, native: JSValue) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || {
            ZigGlobalObject__createNativeReadableStream(global_this, native)
        })
    }

    /// Same as [`from_native`] but the native source adapter UTF-8-decodes each
    /// chunk to a string before enqueue (Body.textStream()).
    pub(crate) fn from_native_text(
        global_this: &JSGlobalObject,
        native: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || {
            ZigGlobalObject__createNativeTextReadableStream(global_this, native)
        })
    }

    /// A closed stream with `string` (a JS string) as its only chunk. An empty
    /// string produces an empty closed stream.
    pub(crate) fn from_decoded_text(
        global_this: &JSGlobalObject,
        string: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || {
            ReadableStream__fromDecodedText(global_this, string)
        })
    }

    /// Locks a default reader on `source` and returns a stream that
    /// UTF-8-decodes each chunk from it to a string.
    pub(crate) fn text_decode_from(
        global_this: &JSGlobalObject,
        source: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || {
            ReadableStream__textDecodeFrom(global_this, source)
        })
    }

    pub(crate) fn from_owned_slice(
        global_this: &JSGlobalObject,
        bytes: impl Into<Vec<u8>>,
        recommended_chunk_size: webcore::blob::SizeType,
    ) -> JsResult<JSValue> {
        let blob = Blob::init(bytes.into(), global_this);
        Self::from_blob_copy_ref(global_this, &blob, recommended_chunk_size)
    }

    pub fn from_blob_copy_ref(
        global_this: &JSGlobalObject,
        blob: &Blob,
        recommended_chunk_size: webcore::blob::SizeType,
    ) -> JsResult<JSValue> {
        let Some(store) = blob.store.get() else {
            return ReadableStream::empty(global_this);
        };
        match &store.data {
            webcore::blob::store::Data::Bytes(_) => {
                // The JS wrapper made by `to_readable_stream()` owns the source.
                let reader = NewSource::new(
                    ByteBlobLoader::new(blob, recommended_chunk_size),
                    global_this,
                );
                reader.to_readable_stream(global_this)
            }
            webcore::blob::store::Data::File(_) => {
                let reader = NewSource::new(
                    FileReader {
                        event_loop: core::cell::Cell::new(jsc::EventLoopHandle::init(
                            global_this.bun_vm().as_mut().event_loop().cast(),
                        )),
                        start_offset: Some(blob.offset.get() as usize),
                        max_size: if blob.size.get() != webcore::blob::MAX_SIZE {
                            Some(blob.size.get() as usize)
                        } else {
                            None
                        },
                        lazy: bun_jsc::JsCell::new(webcore::file_reader::Lazy::Blob(store.clone())),
                        ..Default::default()
                    },
                    global_this,
                );
                reader.to_readable_stream(global_this)
            }
            webcore::blob::store::Data::S3(s3) => {
                let credentials = s3.get_credentials();
                let path = s3.path();
                // `Transpiler::env_mut` is the safe accessor for the
                // process-singleton dotenv loader (set during init).
                let proxy = global_this
                    .bun_vm()
                    .as_mut()
                    .transpiler
                    .env_mut()
                    .get_http_proxy(true, None, None);
                let proxy_url = proxy.as_ref().map(|p| p.href);

                crate::webcore::s3::client::readable_stream(
                    credentials,
                    path,
                    blob.offset.get() as usize,
                    if blob.size.get() != webcore::blob::MAX_SIZE {
                        Some(blob.size.get() as usize)
                    } else {
                        None
                    },
                    proxy_url,
                    s3.request_payer,
                    global_this,
                )
            }
        }
    }

    pub fn from_pipe<P>(
        global_this: &JSGlobalObject,
        _parent: P,
        buffered_reader: &mut bun_io::BufferedReader,
    ) -> JsResult<JSValue> {
        // The JS wrapper made by `to_readable_stream()` owns the source.
        let source = NewSource::new(
            FileReader {
                event_loop: core::cell::Cell::new(jsc::EventLoopHandle::init(
                    global_this.bun_vm().as_mut().event_loop().cast(),
                )),
                ..Default::default()
            },
            global_this,
        );
        // The reader's parent is the source (see `FileReader`'s
        // `impl_buffered_reader_parent!`).
        let parent = source.this_ptr().as_ptr().cast::<c_void>();
        source
            .context
            .reader
            .with_mut(|r| r.from(buffered_reader, parent));

        let stream = source.to_readable_stream(global_this)?;

        // The transferred poll's owner now points into this source; hold a
        // reference (which roots the wrapper) until `on_reader_done` releases it.
        // `on_start` sees the held reference and does not take a second one.
        if !source.context.reader.get().is_done() {
            source.context.read_ref.set(Some(source.retain()));
        }

        Ok(stream)
    }

    pub fn empty(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || ReadableStream__empty(global_this))
    }

    pub fn used(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || ReadableStream__used(global_this))
    }

    /// A stream already in the `errored` state, so every read rejects with
    /// `reason` instead of closing cleanly.
    pub fn errored(global_this: &JSGlobalObject, reason: JSValue) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || ReadableStream__errored(global_this, reason))
    }
}

pub(crate) fn is_disturbed_value(value: JSValue, global_object: &JSGlobalObject) -> bool {
    ReadableStream__isDisturbed(value, global_object)
}

pub(crate) fn is_locked_value(value: JSValue, global_object: &JSGlobalObject) -> bool {
    ReadableStream__isLocked(value, global_object)
}

// ─── Tag / Source ────────────────────────────────────────────────────────────

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Tag {
    Invalid = -1,

    /// ReadableStreamDefaultController or ReadableByteStreamController
    JavaScript = 0,

    /// ReadableByteStreamController
    /// but with a BlobLoader
    /// we can skip the BlobLoader and just use the underlying Blob
    Blob = 1,

    /// ReadableByteStreamController
    /// but with a FileLoader
    /// we can skip the FileLoader and just use the underlying File
    File = 2,

    /// This is a direct readable stream
    /// That means we can turn it into whatever we want
    Direct = 3,

    Bytes = 4,
}

// `ReadableStreamTag__tagged` (C++ `webcore/ReadableStream.cpp:387`) returns
// raw `int32_t`; the extern decl above types it as `Tag`, so an out-of-range
// value would be immediate UB. Lock the discriminant width and every variant
// value so a C++-side addition that Rust hasn't mirrored fails the build here
// instead of materialising an invalid enum.
bun_core::assert_ffi_discr!(
    Tag, i32;
    Invalid = -1, JavaScript = 0, Blob = 1, File = 2, Direct = 3, Bytes = 4,
);

// Clone/Copy: bitwise OK — variant pointers are non-owning handles to
// JSC-managed loader objects (lifetime governed by the stream/JS heap). They
// are the JS wrapper's `m_ctx` (`*mut NewSource<C>`, whose `context` sits at
// offset 0).
#[derive(Copy, Clone)]
pub enum Source {
    Invalid,
    /// ReadableStreamDefaultController or ReadableByteStreamController
    JavaScript,
    /// ReadableByteStreamController
    /// but with a BlobLoader
    /// we can skip the BlobLoader and just use the underlying Blob
    Blob(*mut ByteBlobLoader),
    /// ReadableByteStreamController
    /// but with a FileLoader
    /// we can skip the FileLoader and just use the underlying File
    File(*mut FileReader),
    Bytes(*mut ByteStream),
}

impl Source {
    /// Shared borrow of the `Bytes` payload as a [`BackRef`](bun_ptr::BackRef).
    ///
    /// The pointer is the JS wrapper's `m_ctx` heap allocation returned by
    /// `ReadableStreamTag__tagged` and is non-null and live while the owning
    /// `ReadableStream` JSValue is rooted (caller's `Strong`/stack root) — the
    /// BACKREF outlives-holder invariant. R-2: every `ByteStream` field touched
    /// through this borrow is `Cell`/`JsCell`-backed, so re-entrant JS that
    /// re-derives a fresh `&ByteStream` from `m_ctx` aliases shared-only.
    #[inline]
    pub fn bytes(self) -> Option<bun_ptr::BackRef<ByteStream>> {
        match self {
            Source::Bytes(p) => Some(bun_ptr::BackRef::from(
                NonNull::new(p).expect("Source::Bytes payload is non-null"),
            )),
            _ => None,
        }
    }

    /// Shared borrow of the `File` payload; same invariant as [`bytes`](Self::bytes).
    #[inline]
    pub fn file(self) -> Option<bun_ptr::BackRef<FileReader>> {
        match self {
            Source::File(p) => Some(bun_ptr::BackRef::from(
                NonNull::new(p).expect("Source::File payload is non-null"),
            )),
            _ => None,
        }
    }

    /// Shared borrow of the `Blob` payload; same invariant as [`bytes`](Self::bytes).
    #[inline]
    pub fn blob(self) -> Option<bun_ptr::BackRef<ByteBlobLoader>> {
        match self {
            Source::Blob(p) => Some(bun_ptr::BackRef::from(
                NonNull::new(p).expect("Source::Blob payload is non-null"),
            )),
            _ => None,
        }
    }
}

// ─── NewSource ───────────────────────────────────────────────────────────────
//
// Each `Context` type implements the `SourceContext` trait; `NewSource<C>` is
// the generic struct over it.

/// Per-context configuration and callbacks for `NewSource<C>`.
///
/// R-2: every callback takes `&self`; contexts keep their mutable state in
/// `Cell`/`JsCell` so a re-entrant JS call that re-derives `&Self` from the
/// wrapper's `m_ctx` aliases shared-only.
pub trait SourceContext: Sized {
    /// `name_` — used to look up `jsc.Codegen.JS{NAME}InternalReadableStreamSource`.
    const NAME: &'static str;
    /// `setRefUnrefFn != null`
    const SUPPORTS_REF: bool = false;

    // ─── codegen accessors (`.classes.ts` → `generated_classes.rs`) ───────────
    // Each context binds its per-type codegen module via `source_context_codegen!`.
    /// `js_${NAME}InternalReadableStreamSource::to_js` — `ptr` is the
    /// type-erased `*mut NewSource<Self>` (cast inside the macro impl).
    fn js_create(ptr: *mut c_void, global: &JSGlobalObject) -> JSValue;
    /// `js_${NAME}InternalReadableStreamSource::pending_promise_set_cached`
    fn js_pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    /// `js_${NAME}InternalReadableStreamSource::on_drain_callback_set_cached`
    fn js_on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    /// `js_${NAME}InternalReadableStreamSource::on_drain_callback_get_cached`
    fn js_on_drain_callback_get_cached(this: JSValue) -> Option<JSValue>;
    /// `js_${NAME}InternalReadableStreamSource::on_close_callback_set_cached`
    fn js_on_close_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    /// `js_${NAME}InternalReadableStreamSource::on_close_callback_get_cached`
    fn js_on_close_callback_get_cached(this: JSValue) -> Option<JSValue>;
    /// `js_${NAME}InternalReadableStreamSource::owner_set_cached`
    fn js_owner_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    /// `js_${NAME}InternalReadableStreamSource::sink_owner_set_cached`
    fn js_sink_owner_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);

    fn on_start(&self) -> streams::Start;
    fn on_pull(&self, buf: &mut [u8], view: JSValue) -> streams::Result;
    fn on_cancel(&self);
    /// Per-context teardown side-effects (unref pollers, flush pending callbacks,
    /// release handles), run from `NewSource`'s `Drop` before the fields drop.
    fn deinit_fn(&self);

    /// The JS wrapper is being finalized: release any reference the context
    /// itself still holds on the source (an in-flight read's).
    fn finalize_detach(&self) {}

    /// The JS wrapper was collected while native refs remain. Runs inside a GC
    /// sweep: no JS. `ByteStream` tells a parked producer nobody can read it now.
    fn wrapper_finalized(&self) {}

    /// `setRefUnrefFn` — default no-op.
    fn set_ref_unref(&self, _enable: bool) {}

    /// `drainInternalBuffer` — default returns empty.
    fn drain_internal_buffer(&self) -> Vec<u8> {
        Vec::<u8>::default()
    }

    /// `memoryCostFn` — default returns 0; `NewSource::memory_cost` adds `size_of::<Self>()`.
    fn memory_cost_fn(&self) -> usize {
        0
    }

    /// `toBufferedValue` — `None` ⇒ "not implemented" (caller throws TODO).
    fn to_buffered_value(
        &self,
        _global_this: &JSGlobalObject,
        _action: streams::BufferActionTag,
    ) -> Option<JsResult<JSValue>> {
        None
    }

    /// Returns `None` if the context type does not support raw mode.
    /// The `None` default is only reachable if codegen wires `setRawMode` for
    /// a context that does not implement it (see `set_raw_mode_from_js`).
    fn set_raw_mode(&self, _flag: bool) -> Option<bun_sys::Result<()>> {
        None
    }

    /// Default no-op.
    fn set_flowing(&self, _flag: bool) {}
}

// Hand-wired JSC class (the `#[bun_jsc::JsClass]` derive cannot be used on a
// type generic over `C`): codegen name is "JS{C::NAME}InternalReadableStreamSource".
// The toJS/fromJS/fromJSDirect aliases are wired
// manually below; cached-property accessors (pendingPromiseSetCached,
// onDrainCallback{Get,Set}Cached) are emitted by the .classes.ts generator.
//
// `repr(C)` keeps `context` at offset 0: C++ `wrapped()` returns `*mut NewSource<C>` and
// [`ReadableStream::from_js`] casts that straight to `*mut C`.
// With Rust's default repr the field is reordered and the cast reads
// adjacent fields as the loader, returning empty bodies.
//
// Refcounted: the JS wrapper owns the initial reference (released in
// [`NewSource::finalize`]); producers and in-flight reads hold [`SourceRef`]s.
// When the count reaches zero the context's `deinit_fn` runs and the
// allocation is freed.
#[repr(C)]
#[derive(bun_ptr::CellRefCounted)]
pub struct NewSource<C: SourceContext> {
    pub context: C,
    self_root: bun_ptr::SelfRoot<Self>,
    pub cancelled: Cell<bool>,
    pub ref_count: Cell<u32>,
    /// `set_on_close_from_js` ran since the last `on_close`: the next close
    /// fires the JS `onclose` callback.
    js_close_armed: Cell<bool>,
    /// Upstream producer to notify on cancel/drain/consumer-attach. Replaces
    /// the per-signal fn-ptr + ctx-ptr pairs with one typed handle.
    pub producer: Cell<streams::SourceHandle>,
    // JSC_BORROW: process-lifetime VM global. Reassigned in `start()` from a
    // fresh `&JSGlobalObject`; `BackRef` gives a safe `Deref` projection
    // without propagating a lifetime parameter into FFI codegen.
    global_this: jsc::JsCell<bun_ptr::BackRef<JSGlobalObject>>,
    /// Back-reference to the owning `JS{Blob,Bytes,File}InternalReadableStreamSource`
    /// wrapper. Starts `Weak` (set in [`Self::to_readable_stream`]), is
    /// [`JsRef::upgrade`]d to `Strong` in [`Self::retain`] while a native
    /// reference is held (FileReader's in-flight read), and
    /// [`JsRef::downgrade`]d back to `Weak` when only the wrapper's own ref
    /// remains. [`Self::finalize`] flips it to `Finalized` so
    /// [`Self::on_js_close`] reads `None` instead of a dead-but-unswept cell.
    pub this_jsvalue: jsc::JsCell<jsc::JsRef>,
    /// The producer holding a native ref has parked ([`Self::unroot_wrapper`]):
    /// its ref keeps this allocation, not the wrapper, so an unread stream can
    /// be collected. Cleared by [`Self::root_wrapper`].
    pub wrapper_unrooted: Cell<bool>,
    /// R-2: written by context methods (`ByteStream::to_any_blob`,
    /// `ByteBlobLoader::to_any_blob`) through their parent accessor, so
    /// interior-mutable.
    pub is_closed: Cell<bool>,
}

/// A counted reference to a [`NewSource`]: keeps the allocation alive and,
/// unless the producer parked it ([`NewSource::unroot_wrapper`]), the JS
/// wrapper rooted. Released on drop.
pub struct SourceRef<C: SourceContext>(bun_ptr::BackRef<NewSource<C>, bun_ptr::Root>);

impl SourceRef<ByteStream> {
    /// A reference on the `ByteStream` source behind `stream`, if that is what it is.
    pub fn byte_stream(stream: &ReadableStream) -> Option<Self> {
        stream.ptr.bytes().map(|bytes| bytes.parent().retain())
    }
}

impl<C: SourceContext> Clone for SourceRef<C> {
    fn clone(&self) -> Self {
        self.0.retain()
    }
}

impl<C: SourceContext> core::ops::Deref for SourceRef<C> {
    type Target = NewSource<C>;
    #[inline]
    fn deref(&self) -> &NewSource<C> {
        self.0.get()
    }
}

impl<C: SourceContext> Drop for SourceRef<C> {
    fn drop(&mut self) {
        self.0.will_release_ref();
        <NewSource<C> as bun_ptr::CellRefCounted>::deref_nn(self.0.this_ptr().into());
    }
}

impl<C: SourceContext> Drop for NewSource<C> {
    fn drop(&mut self) {
        self.context.deinit_fn();
    }
}

// ─── per-type codegen accessors ──────────────────────────────────────────────
// Each `SourceContext` impl carries the per-type codegen
// extern symbols as associated consts (bound via `source_context_codegen!`).
// The `.classes.ts` → `.rs` generator (when re-run with Rust output) is expected
// to emit those `const JS_*` bindings directly.
pub(crate) trait NewSourceCodegen {
    fn pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn on_drain_callback_get_cached(this: JSValue) -> Option<JSValue>;
    fn on_close_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn on_close_callback_get_cached(this: JSValue) -> Option<JSValue>;
    fn owner_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn sink_owner_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
}

/// Binds the `SourceContext::js_*` accessors to the codegen'd
/// `crate::generated_classes::js_${Name}InternalReadableStreamSource` module
/// (one per `.classes.ts` entry: `Blob`, `File`, `Bytes`). The extern symbols
/// are declared exactly once inside that module — no local `extern "C"` block.
///
/// Invoke *inside* an `impl SourceContext for Foo { ... }` block.
#[macro_export]
macro_rules! source_context_codegen {
    ($gen:ident) => {
        #[inline]
        fn js_create(
            ptr: *mut ::core::ffi::c_void,
            global: &$crate::webcore::jsc::JSGlobalObject,
        ) -> $crate::webcore::jsc::JSValue {
            $crate::generated_classes::$gen::to_js(ptr.cast(), global)
        }
        #[inline]
        fn js_pending_promise_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::pending_promise_set_cached(this, global, value)
        }
        #[inline]
        fn js_on_drain_callback_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::on_drain_callback_set_cached(this, global, value)
        }
        #[inline]
        fn js_on_drain_callback_get_cached(
            this: $crate::webcore::jsc::JSValue,
        ) -> Option<$crate::webcore::jsc::JSValue> {
            $crate::generated_classes::$gen::on_drain_callback_get_cached(this)
        }
        #[inline]
        fn js_on_close_callback_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::on_close_callback_set_cached(this, global, value)
        }
        #[inline]
        fn js_on_close_callback_get_cached(
            this: $crate::webcore::jsc::JSValue,
        ) -> Option<$crate::webcore::jsc::JSValue> {
            $crate::generated_classes::$gen::on_close_callback_get_cached(this)
        }
        #[inline]
        fn js_owner_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::owner_set_cached(this, global, value)
        }
        #[inline]
        fn js_sink_owner_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::sink_owner_set_cached(this, global, value)
        }
    };
}

impl<C: SourceContext> NewSourceCodegen for NewSource<C> {
    fn pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_pending_promise_set_cached(this, global, value)
    }
    fn on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_on_drain_callback_set_cached(this, global, value)
    }
    fn on_drain_callback_get_cached(this: JSValue) -> Option<JSValue> {
        C::js_on_drain_callback_get_cached(this)
    }
    fn on_close_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_on_close_callback_set_cached(this, global, value)
    }
    fn on_close_callback_get_cached(this: JSValue) -> Option<JSValue> {
        C::js_on_close_callback_get_cached(this)
    }
    fn owner_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_owner_set_cached(this, global, value)
    }
    fn sink_owner_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_sink_owner_set_cached(this, global, value)
    }
}

// Enforce the layout invariant `from_js`/`Source` rely on.
const _: () = assert!(core::mem::offset_of!(NewSource<ByteBlobLoader>, context) == 0);
const _: () = assert!(core::mem::offset_of!(NewSource<ByteStream>, context) == 0);
const _: () = assert!(core::mem::offset_of!(NewSource<FileReader>, context) == 0);

impl<C: SourceContext> NewSource<C> {
    /// Heap-allocate a source around `context`. [`Self::to_readable_stream`]
    /// gives the JS wrapper a reference of its own (released in
    /// [`Self::finalize`]); the returned one is the caller's.
    pub fn new(context: C, global_this: &JSGlobalObject) -> RefPtr<Self> {
        RefPtr::new_cyclic(|self_root| NewSource {
            context,
            self_root,
            cancelled: Cell::new(false),
            ref_count: Cell::new(1),
            js_close_armed: Cell::new(false),
            producer: Cell::new(streams::SourceHandle::None),
            global_this: jsc::JsCell::new(bun_ptr::BackRef::new(global_this)),
            this_jsvalue: jsc::JsCell::new(jsc::JsRef::empty()),
            wrapper_unrooted: Cell::new(false),
            is_closed: Cell::new(false),
        })
    }

    /// This source as a dispatch handle (root provenance).
    #[inline]
    pub fn this_ptr(&self) -> bun_ptr::ThisPtr<Self> {
        self.self_root.this_ptr(self)
    }

    /// The `context` pointer C++ and [`Source`] identify this source by
    /// (`context` is at offset 0, so it is the allocation root).
    #[inline]
    pub fn as_context_ptr(&self) -> *mut C {
        self.this_ptr().as_ptr().cast::<C>()
    }

    /// Point the `owner` slot at the GC cell of the peer producing into this
    /// source (its `producer` backref), so rooting the source roots the
    /// producer. `JSValue::UNDEFINED` clears; no-op without a JS wrapper.
    pub fn set_owner(&self, value: JSValue) {
        if let Some(this) = self.this_jsvalue.get().try_get() {
            <Self as NewSourceCodegen>::owner_set_cached(this, self.global_this(), value);
        }
    }

    /// Same as [`Self::set_owner`] for the `sinkOwner` slot: roots the peer
    /// this source pipes into (its `sink` backref).
    pub fn set_sink_owner(&self, value: JSValue) {
        if let Some(this) = self.this_jsvalue.get().try_get() {
            <Self as NewSourceCodegen>::sink_owner_set_cached(this, self.global_this(), value);
        }
    }

    /// The JSC_BORROW `global_this` back-pointer (set at construction,
    /// reassigned in `start()`); the VM-owned global outlives every source.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get().get()
    }

    #[inline]
    pub fn set_global_this(&self, global: &JSGlobalObject) {
        self.global_this.set(bun_ptr::BackRef::new(global));
    }

    pub fn set_ref(&self, value: bool) {
        if C::SUPPORTS_REF {
            self.context.set_ref_unref(value);
        }
    }

    pub fn on_pull_from_js(&self, buf: &mut [u8], view: JSValue) -> streams::Result {
        self.context.on_pull(buf, view)
    }

    pub fn on_start_from_js(&self) -> streams::Start {
        self.context.on_start()
    }

    pub fn cancel(&self) {
        if self.cancelled.get() {
            return;
        }
        self.cancelled.set(true);
        self.context.on_cancel();
        let mut p = self.producer.replace(streams::SourceHandle::None);
        p.close(None);
    }

    pub fn on_close(&self) {
        if self.cancelled.get() {
            return;
        }
        if self.js_close_armed.replace(false) {
            self.on_js_close();
        }
    }

    /// `JSReadableStreamSource.onClose` — invoked from `on_close` when the JS
    /// side registered an `onclose` callback ([`Self::set_on_close_from_js`]).
    fn on_js_close(&self) {
        // Reached from `FileReader::on_reader_done` off the event loop. While
        // the across-read ref is held (`retain` upgraded to Strong), the
        // wrapper is rooted and `try_get()` is `Some`. If the wrapper was
        // already finalized, `try_get()` is `None` and there is no callback.
        let Some(this_jsvalue) = self.this_jsvalue.get().try_get() else {
            return;
        };
        let global_this = self.global_this();
        if let Some(cb) = <Self as NewSourceCodegen>::on_close_callback_get_cached(this_jsvalue) {
            if !cb.is_undefined() {
                global_this.queue_microtask(cb, &[]);
            }
        }
        <Self as NewSourceCodegen>::on_close_callback_set_cached(
            this_jsvalue,
            global_this,
            JSValue::UNDEFINED,
        );
    }

    /// Take a counted reference. A ref beyond the JS wrapper's own is now
    /// held (in practice a FileReader's in-flight read): root the wrapper so
    /// `on_js_close`, reached from `on_reader_done` off the event loop with no
    /// JS frame on the stack, never reads a dead-but-unswept cell.
    pub fn retain(&self) -> SourceRef<C> {
        self.ref_();
        if !self.wrapper_unrooted.get() {
            self.upgrade_wrapper();
        }
        SourceRef(self.self_root.backref(self))
    }

    fn upgrade_wrapper(&self) {
        let global = self.global_this();
        self.this_jsvalue.with_mut(|this_jsvalue| {
            if this_jsvalue.is_not_empty() {
                this_jsvalue.upgrade(global);
            }
        });
    }

    /// The producer keeps its native ref but stops rooting the wrapper: nothing
    /// is reading, so the stream should be collectable. [`SourceContext::wrapper_finalized`]
    /// tells the producer if that happens.
    pub fn unroot_wrapper(&self) {
        self.wrapper_unrooted.set(true);
        self.this_jsvalue.with_mut(jsc::JsRef::downgrade);
    }

    /// Undo [`Self::unroot_wrapper`]: a consumer is reading again.
    pub fn root_wrapper(&self) {
        self.wrapper_unrooted.set(false);
        if self.ref_count.get() > 1 {
            self.upgrade_wrapper();
        }
    }

    /// Bookkeeping ahead of releasing one reference: once only the JS wrapper's
    /// own ref will remain, drop the Strong root so the wrapper becomes
    /// collectable again.
    fn will_release_ref(&self) {
        let rc = self.ref_count.get();
        debug_assert!(rc > 0, "Attempted to decrement ref count below zero");
        if rc == 2 {
            self.this_jsvalue.with_mut(jsc::JsRef::downgrade);
        }
    }

    pub fn drain(&self) -> Vec<u8> {
        self.context.drain_internal_buffer()
    }

    fn to_readable_stream_with(
        &self,
        global_this: &JSGlobalObject,
        from_native: fn(&JSGlobalObject, JSValue) -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        let out_value = if let Some(v) = self.this_jsvalue.get().try_get() {
            v
        } else {
            // The wrapper's `m_ctx` holds a reference of its own; the GC
            // finalizer releases it through `finalize`.
            let wrapper_ref = RefPtr::from_this(self.this_ptr());
            C::js_create(RefPtr::into_raw(wrapper_ref).cast::<c_void>(), global_this)
        };
        out_value.ensure_still_alive();
        if self.this_jsvalue.get().is_empty() {
            self.this_jsvalue.set(jsc::JsRef::init_weak(out_value));
        }
        from_native(global_this, out_value)
    }

    pub(crate) fn to_readable_stream(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_readable_stream_with(global_this, ReadableStream::from_native)
    }

    pub(crate) fn to_text_readable_stream(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        self.to_readable_stream_with(global_this, ReadableStream::from_native_text)
    }

    pub fn set_raw_mode_from_js(
        this: &Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flag = call_frame.argument(0);
        debug_assert!(flag.is_boolean());
        match this.context.set_raw_mode(flag == JSValue::TRUE) {
            Some(Ok(())) => Ok(JSValue::UNDEFINED),
            Some(Err(e)) => Ok(e.to_js(global)),
            None => unreachable!("setRawMode is not implemented on {}", C::NAME),
        }
    }

    pub fn set_flowing_from_js(
        this: &Self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flag = call_frame.argument(0);
        debug_assert!(flag.is_boolean());
        this.context.set_flowing(flag == JSValue::TRUE);
        Ok(JSValue::UNDEFINED)
    }

    pub fn memory_cost(&self) -> usize {
        self.context.memory_cost_fn() + core::mem::size_of::<Self>()
    }
}

// ─── codegen-facing inherent methods ─────────────────────────────────────────
// The `.classes.ts` → `generated_classes.rs` thunks call these by exact name on
// `NewSource<C>` (aliased as `{Blob,Bytes,File}InternalReadableStreamSource`).
impl<C: SourceContext> NewSource<C> {
    pub fn pull_from_js(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_jsvalue = call_frame.this();
        let [view, flags] = call_frame.arguments_as_array::<2>();
        view.ensure_still_alive();
        let Some(mut buffer) = view.as_array_buffer(global_this) else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = self.on_pull_from_js(buffer.slice_mut(), view);
        Self::process_result(this_jsvalue, global_this, flags, result)
    }

    pub fn start_from_js(
        &self,
        global_this: &JSGlobalObject,
        _call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.set_global_this(global_this);
        match self.on_start_from_js() {
            streams::Start::Empty => Ok(JSValue::js_number(0.0)),
            streams::Start::Ready => Ok(JSValue::js_number(16384.0)),
            streams::Start::ChunkSize(size) => Ok(JSValue::js_number(size as f64)),
            streams::Start::Err(err) => Err(global_this.throw_value(err.to_js(global_this))),
            rc => rc.to_js(global_this),
        }
    }

    pub fn get_is_closed_from_js(&self, _global_object: &JSGlobalObject) -> JSValue {
        JSValue::from(self.is_closed.get())
    }

    fn process_result(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
        flags: JSValue,
        mut result: streams::Result,
    ) -> JsResult<JSValue> {
        match &result {
            streams::Result::Err(err) => {
                let js_err = err.to_js(global_this);
                js_err.ensure_still_alive();
                Err(global_this.throw_value(js_err))
            }
            streams::Result::Pending(_) => {
                let out = result.to_js(global_this)?;
                <Self as NewSourceCodegen>::pending_promise_set_cached(
                    this_jsvalue,
                    global_this,
                    out,
                );
                Ok(out)
            }
            streams::Result::TemporaryAndDone(_)
            | streams::Result::OwnedAndDone(_)
            | streams::Result::IntoArrayAndDone(_) => {
                flags.put_index(global_this, 0, JSValue::TRUE)?;
                result.to_js(global_this)
            }
            _ => result.to_js(global_this),
        }
    }

    pub fn cancel_from_js(
        &self,
        _global_object: &JSGlobalObject,
        _call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.cancel();
        Ok(JSValue::UNDEFINED)
    }

    pub fn set_on_close_from_js(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        self.js_close_armed.set(true);
        self.set_global_this(global_object);

        if value.is_undefined() {
            if let Some(this_jsvalue) = self.this_jsvalue.get().try_get() {
                <Self as NewSourceCodegen>::on_close_callback_set_cached(
                    this_jsvalue,
                    global_object,
                    JSValue::UNDEFINED,
                );
            }
            return Ok(());
        }

        if !value.is_callable() {
            return Err(global_object.throw_invalid_argument_type(
                "ReadableStreamSource",
                "onclose",
                "function",
            ));
        }
        let cb = value.with_async_context_if_needed(global_object);
        if let Some(this_jsvalue) = self.this_jsvalue.get().try_get() {
            <Self as NewSourceCodegen>::on_close_callback_set_cached(
                this_jsvalue,
                global_object,
                cb,
            );
        }
        Ok(())
    }

    pub fn set_on_drain_from_js(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        self.set_global_this(global_object);

        let Some(this_jsvalue) = self.this_jsvalue.get().try_get() else {
            return Ok(());
        };

        if value.is_undefined() {
            <Self as NewSourceCodegen>::on_drain_callback_set_cached(
                this_jsvalue,
                global_object,
                JSValue::UNDEFINED,
            );
            return Ok(());
        }

        if !value.is_callable() {
            return Err(global_object.throw_invalid_argument_type(
                "ReadableStreamSource",
                "onDrain",
                "function",
            ));
        }
        let cb = value.with_async_context_if_needed(global_object);
        <Self as NewSourceCodegen>::on_drain_callback_set_cached(this_jsvalue, global_object, cb);
        Ok(())
    }

    pub fn get_on_close_from_js(&self, _global_object: &JSGlobalObject) -> JSValue {
        if let Some(this_jsvalue) = self.this_jsvalue.get().try_get() {
            if let Some(val) =
                <Self as NewSourceCodegen>::on_close_callback_get_cached(this_jsvalue)
            {
                return val;
            }
        }
        JSValue::UNDEFINED
    }

    pub fn get_on_drain_from_js(&self, _global_object: &JSGlobalObject) -> JSValue {
        self.this_jsvalue
            .get()
            .try_get()
            .and_then(<Self as NewSourceCodegen>::on_drain_callback_get_cached)
            .unwrap_or(JSValue::UNDEFINED)
    }

    pub fn update_ref_from_js(
        &self,
        _global_object: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let ref_or_unref = call_frame.argument(0).to_boolean();
        self.set_ref(ref_or_unref);
        Ok(JSValue::UNDEFINED)
    }

    /// The JS wrapper's finalizer: release its reference. Producer / in-flight
    /// read references may keep the allocation past this call.
    pub fn finalize(self: Box<Self>) {
        let this: &Self = Box::leak(self);
        let wrapper_ref = SourceRef(this.self_root.backref(this));
        this.this_jsvalue.with_mut(jsc::JsRef::finalize);
        // The wrapper's reference (released last) keeps ref_count > 0 across
        // whatever ref the producer or context drops in response.
        if this.ref_count.get() > 1 {
            this.context.wrapper_finalized();
        }
        this.context.finalize_detach();
        drop(wrapper_ref);
    }

    pub fn drain_from_js(
        &self,
        global_this: &JSGlobalObject,
        _call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut list = self.drain();
        if list.len() > 0 {
            // Ownership of the buffer transfers to JSC: `to_js` installs
            // `MarkedArrayBuffer_deallocator` which `mi_free`s on GC. Suppress
            // `Vec::Drop` so the same allocation isn't freed twice (once
            // here on scope exit, once by the GC). Mirrors `streams::Start::to_js`.
            let ab = jsc::ArrayBuffer::from_bytes(list.slice_mut(), jsc::JSType::Uint8Array);
            let _ = core::mem::ManuallyDrop::new(list);
            return ab.to_js(global_this);
        }
        Ok(JSValue::UNDEFINED)
    }

    // text/arrayBuffer/blob/bytes/json all share the same body modulo
    // `BufferActionTag`. Collapsed into one helper to avoid 5× drift.
    fn to_buffered_value_from_js(
        &self,
        global_this: &JSGlobalObject,
        _call_frame: &CallFrame,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        if let Some(r) = self.context.to_buffered_value(global_this, action) {
            return r;
        }
        Err(global_this.throw_todo(b"This is not implemented yet"))
    }

    pub fn text_from_js(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Text)
    }

    pub fn array_buffer_from_js(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(
            global_this,
            call_frame,
            streams::BufferActionTag::ArrayBuffer,
        )
    }

    pub fn blob_from_js(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Blob)
    }

    pub fn bytes_from_js(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Bytes)
    }

    pub fn json_from_js(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Json)
    }
}
