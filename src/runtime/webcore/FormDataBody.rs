//! The body of a `FormData` that holds a `Bun.file()` or an S3 part.
//!
//! Body extraction keeps the parts ([`FormDataParts`]) and reads none of them.
//! The read starts when a consumer asks for the bytes: `.text()` and its
//! siblings, `.body`, or a native consumer such as `Bun.serve`. File parts are
//! read on the work pool and S3 parts are downloaded, in the order of the
//! wire, into one buffer. The consumer then gets the same in-memory Blob that
//! a `FormData` of strings gets at extraction.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::SysErrorJsc as _;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, JsThread};
use bun_ptr::RefPtr;

use crate::webcore::blob::{
    Blob, BlobContentType, BlobExt as _, MAX_SIZE, ReadBytesHandler, ReadBytesResult, SizeType,
    Store, store,
};
use crate::webcore::body::{Action, PendingValue, Value, ValueError};
use crate::webcore::byte_stream::ProducerHold;
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::streams::{self, SourceHandle};
use crate::webcore::{DrainResult, ReadableStream, readable_stream};

bun_core::declare_scope!(FormDataBody, hidden);

/// The body, in the order of the wire.
#[derive(Default)]
pub(crate) struct Segments {
    /// The boundaries, the part headers and the string values, one after the
    /// other.
    pub(crate) framing: Vec<u8>,
    /// The Blob parts. The bytes of each go in at its place in the framing.
    pub(crate) sources: Vec<Segment>,
}

/// A Blob part: its bytes come after `framing[..framing_end]`.
pub(crate) struct Segment {
    pub(crate) framing_end: usize,
    pub(crate) source: Source,
}

pub(crate) enum Source {
    /// The bytes of an in-memory Blob.
    Memory {
        store: RefPtr<Store>,
        offset: usize,
        len: usize,
    },
    /// A `Bun.file()`. `fd` is a duplicate of the descriptor of a
    /// `Bun.file(fd)`, so the part reads the same open file after the caller
    /// closes its own descriptor.
    File {
        store: RefPtr<Store>,
        fd: Option<bun_sys::File>,
        offset: SizeType,
        size: SizeType,
    },
    S3 {
        store: RefPtr<Store>,
        offset: SizeType,
        size: SizeType,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Unread,
    Reading,
    Done,
}

/// Who gets the bytes.
enum Consumer {
    /// Nobody yet, or the consumer went away.
    None,
    /// A pending body that holds the promise of `.text()` and its siblings,
    /// or the callback of a native consumer.
    Pending(Box<Value>),
    /// The stream behind `.body`.
    Stream(ProducerHold),
}

/// The parts of a `FormData`, kept from body extraction until the body is read.
#[derive(bun_ptr::CellRefCounted)]
pub struct FormDataParts {
    ref_count: Cell<u32>,
    /// Empty once a read has them.
    segments: JsCell<Segments>,
    /// `multipart/form-data; boundary=...`
    content_type: Box<[u8]>,
    /// False when a part is a file descriptor or a pipe: a second read of
    /// such a part gives other bytes.
    reads_repeatably: bool,
    state: Cell<State>,
    consumer: JsCell<Consumer>,
}

impl FormDataParts {
    pub(crate) fn new(
        segments: Segments,
        content_type: Box<[u8]>,
        reads_repeatably: bool,
    ) -> RefPtr<Self> {
        RefPtr::new(Self {
            ref_count: Cell::new(1),
            segments: JsCell::new(segments),
            content_type,
            reads_repeatably,
            state: Cell::new(State::Unread),
            consumer: JsCell::new(Consumer::None),
        })
    }

    pub(crate) fn content_type(&self) -> &[u8] {
        &self.content_type
    }

    pub(crate) fn is_unread(&self) -> bool {
        self.state.get() == State::Unread
    }

    /// The pending body of a `Response` or a `Request` over these parts.
    pub(crate) fn to_pending_value(this: RefPtr<Self>, global: &JSGlobalObject) -> PendingValue {
        let mut pending = PendingValue::new(global);
        pending.task = NonNull::new(this.as_ptr().cast::<c_void>());
        pending.on_start_streaming = Some(Self::on_start_streaming);
        pending.on_readable_stream_available = Some(Self::on_readable_stream_available);
        // SAFETY: `pending.form_data` keeps the parts alive for as long as the handle is there.
        pending.producer =
            SourceHandle::FormDataBody(unsafe { bun_ptr::BackRef::from_raw(this.as_ptr()) });
        pending.form_data = Some(this);
        pending
    }

    /// A second body over the same parts, for `clone()` of a body that nothing
    /// has read. `None` when a part does not read the same bytes twice.
    pub(crate) fn dupe(&self) -> Option<RefPtr<Self>> {
        if !self.is_unread() || !self.reads_repeatably {
            return None;
        }
        let segments = self.segments.get();
        let sources = segments
            .sources
            .iter()
            .map(|segment| Segment {
                framing_end: segment.framing_end,
                source: match &segment.source {
                    Source::Memory { store, offset, len } => Source::Memory {
                        store: store.clone(),
                        offset: *offset,
                        len: *len,
                    },
                    Source::File {
                        store,
                        offset,
                        size,
                        ..
                    } => Source::File {
                        store: store.clone(),
                        // A part with a descriptor does not read repeatably.
                        fd: None,
                        offset: *offset,
                        size: *size,
                    },
                    Source::S3 {
                        store,
                        offset,
                        size,
                    } => Source::S3 {
                        store: store.clone(),
                        offset: *offset,
                        size: *size,
                    },
                },
            })
            .collect();
        let segments = Segments {
            framing: segments.framing.clone(),
            sources,
        };
        Some(Self::new(segments, self.content_type.clone(), true))
    }

    // ── consumers ──────────────────────────────────────────────────────────

    /// `.text()`, `.json()`, `.bytes()`, `.arrayBuffer()`, `.blob()`, `.formData()`.
    pub(crate) fn read_into_promise(
        &self,
        global: &JSGlobalObject,
        action: Action,
    ) -> JsResult<JSValue> {
        let promise = JSPromise::create(global).to_js();
        promise.protect();
        let mut pending = PendingValue::new(global);
        pending.promise = Some(promise);
        pending.action = action;
        self.consumer
            .set(Consumer::Pending(Box::new(Value::Locked(pending))));
        self.start(&global.js_thread_of_caller_no_frame());
        Ok(promise)
    }

    /// A native consumer that takes the whole body. `on_receive_value` gets
    /// the bytes as a `Value::Blob`, or a `Value::Error`.
    pub(crate) fn read_into(
        &self,
        cx: &JsThread<'_>,
        on_receive_value: fn(ctx: NonNull<c_void>, value: &mut Value),
        ctx: NonNull<c_void>,
    ) {
        let mut pending = PendingValue::new(cx.global());
        pending.on_receive_value = Some(on_receive_value);
        pending.task = Some(ctx);
        self.consumer
            .set(Consumer::Pending(Box::new(Value::Locked(pending))));
        self.start(cx);
    }

    /// `PendingValue::on_start_streaming`: the body becomes a stream.
    fn on_start_streaming(_ctx: NonNull<c_void>) -> DrainResult {
        DrainResult::EstimatedSize(0)
    }

    /// `PendingValue::on_readable_stream_available`: the stream exists. It
    /// does not ask for bytes, so the read starts now.
    fn on_readable_stream_available(
        ctx: NonNull<c_void>,
        global: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        // SAFETY: `ctx` is the `task` of `to_pending_value`, and the pending
        // body that calls this hook holds a ref in `form_data`.
        let this = unsafe { ctx.cast::<Self>().as_ref() };
        let readable_stream::Source::Bytes(bytes) = readable.ptr else {
            return;
        };
        if !this.is_unread() {
            return;
        }
        let hold = ProducerHold::default();
        // SAFETY: the caller holds the stream, which owns the live ByteStream. JS thread.
        unsafe { hold.hold(bytes) };
        this.consumer.set(Consumer::Stream(hold));
        this.start(&global.js_thread_of_caller_no_frame());
    }

    /// `SourceHandle::close`: the reader of `.body` cancelled.
    pub(crate) fn on_stream_cancelled(&self) {
        bun_core::scoped_log!(FormDataBody, "stream cancelled");
        self.consumer.set(Consumer::None);
    }

    /// `SourceHandle::consumer_collected`: the stream of `.body` was swept.
    /// Inside a GC sweep: `ProducerHold` touches no JS cell.
    pub(crate) fn on_stream_collected(&self) {
        self.consumer.set(Consumer::None);
    }

    // ── the synchronous read ───────────────────────────────────────────────

    /// Reads every part on the calling thread. For the consumers that must
    /// have the bytes before they return. When it throws, the parts stay
    /// unread, so the body can still be read.
    pub(crate) fn read_now(&self, global: &JSGlobalObject) -> JsResult<Blob> {
        debug_assert!(self.is_unread());
        let has_s3_part = self
            .segments
            .get()
            .sources
            .iter()
            .any(|segment| matches!(segment.source, Source::S3 { .. }));
        if has_s3_part {
            return Err(global.throw_invalid_arguments(format_args!(
                "A FormData entry that is an S3 file cannot be read synchronously. Read it first: formData.append(name, new Blob([await s3file.bytes()]), filename)"
            )));
        }
        let mut read = PartsRead::new(self.segments.replace(Segments::default()));
        read.run();
        if let Some(err) = read.error.take() {
            self.segments.set(read.segments);
            return Err(global.throw_value(err.to_js(global)));
        }
        self.state.set(State::Done);
        Ok(self.to_blob(read.out, global))
    }

    // ── the read ───────────────────────────────────────────────────────────

    fn start(&self, cx: &JsThread<'_>) {
        debug_assert!(self.is_unread());
        self.state.set(State::Reading);
        let read = PartsRead::new(self.segments.replace(Segments::default()));
        self.schedule(cx, read);
    }

    fn schedule(&self, cx: &JsThread<'_>, read: PartsRead) {
        bun_core::scoped_log!(FormDataBody, "schedule job at part {}", read.next);
        self.ref_();
        // SAFETY: the ref taken above is the job's.
        let this = PartsRef(unsafe { RefPtr::from_raw(core::ptr::from_ref(self).cast_mut()) });
        jsc::Job::<PartsRead>::schedule(cx, read, this);
    }

    /// JS thread: the read went as far as it can with no download.
    fn on_read(&self, read: PartsRead, cx: &JsThread<'_>) -> JsResult<()> {
        let mut read = read;
        if let Some(err) = read.error.take() {
            return self.fail(ValueError::SystemError(err.to_system_error().into()), cx);
        }
        if matches!(*self.consumer.get(), Consumer::None) {
            // Nobody waits for the rest.
            self.state.set(State::Done);
            return Ok(());
        }
        let Some(Segment {
            source:
                Source::S3 {
                    store,
                    offset,
                    size,
                },
            ..
        }) = read.segments.sources.get(read.next)
        else {
            return self.finish(read.out, cx);
        };
        let blob = Blob::init_with_store(store.clone(), cx.global());
        blob.offset.set(*offset);
        blob.size.set(*size);
        let blob = scopeguard::guard(blob, |mut blob| blob.deinit());
        self.ref_();
        let download = bun_core::heap::into_raw(Box::new(S3PartRead {
            // SAFETY: the ref taken above is the download's.
            parts: unsafe { RefPtr::from_raw(core::ptr::from_ref(self).cast_mut()) },
            read,
            context: cx.context().id(),
        }));
        // SAFETY: `download` is a fresh allocation that this call gives to its
        // one `on_read_bytes`, also when it returns `Err`.
        unsafe { blob.read_bytes_to_handler(download, cx) }
    }

    fn finish(&self, bytes: Vec<u8>, cx: &JsThread<'_>) -> JsResult<()> {
        bun_core::scoped_log!(FormDataBody, "finish {} bytes", bytes.len());
        self.state.set(State::Done);
        match self.consumer.replace(Consumer::None) {
            Consumer::None => Ok(()),
            Consumer::Pending(mut pending) => {
                let mut body = Value::Blob(self.to_blob(bytes, cx.global()));
                pending.resolve(&mut body, cx, None)
            }
            Consumer::Stream(hold) => {
                if let Some(stream) = hold.take() {
                    stream.on_data(streams::Result::OwnedAndDone(bytes));
                }
                Ok(())
            }
        }
    }

    fn fail(&self, err: ValueError, cx: &JsThread<'_>) -> JsResult<()> {
        self.state.set(State::Done);
        let mut err = scopeguard::guard(err, |mut err| err.reset());
        match self.consumer.replace(Consumer::None) {
            Consumer::None => Ok(()),
            Consumer::Pending(mut pending) => {
                pending.to_error_instance(scopeguard::ScopeGuard::into_inner(err), cx.global())
            }
            Consumer::Stream(hold) => {
                if let Some(stream) = hold.take() {
                    stream.on_data(streams::Result::Err(err.to_stream_error(cx.global())));
                }
                Ok(())
            }
        }
    }

    fn to_blob(&self, bytes: Vec<u8>, global: &JSGlobalObject) -> Blob {
        let blob = Blob::init_with_store(Store::init(bytes), global);
        blob.content_type
            .set(BlobContentType::Owned(std::sync::Arc::from(
                &*self.content_type,
            )));
        blob.content_type_was_set.set(true);
        blob
    }
}

// ── the job ────────────────────────────────────────────────────────────────

/// The read of the parts: on the work pool, or inline for `read_now`.
struct PartsRead {
    segments: Segments,
    /// The Blob part to read next.
    next: usize,
    /// How much of the framing is in `out`.
    framing_at: usize,
    /// The bytes to come that need no read: the rest of the framing and the
    /// in-memory parts. `out` gets room for them with each part that it
    /// reads, so that it grows once for each.
    known_left: usize,
    out: Vec<u8>,
    error: Option<bun_sys::Error>,
}

impl PartsRead {
    fn new(segments: Segments) -> Self {
        let in_memory: usize = segments
            .sources
            .iter()
            .map(|segment| match segment.source {
                Source::Memory { len, .. } => len,
                Source::File { .. } | Source::S3 { .. } => 0,
            })
            .sum();
        Self {
            known_left: segments.framing.len().saturating_add(in_memory),
            segments,
            next: 0,
            framing_at: 0,
            out: Vec::new(),
            error: None,
        }
    }

    /// Appends the parts in order. Stops before an S3 part, which only the JS
    /// thread can start, and at the first error.
    fn run(&mut self) {
        if self.out.capacity() == 0 {
            self.out.reserve_exact(self.known_left);
        }
        while let Some(segment) = self.segments.sources.get(self.next) {
            let framing = &self.segments.framing[self.framing_at..segment.framing_end];
            self.out.extend_from_slice(framing);
            self.framing_at = segment.framing_end;
            self.known_left = self.known_left.saturating_sub(framing.len());
            match &segment.source {
                Source::Memory { store, offset, len } => {
                    let view = store.shared_view();
                    let start = (*offset).min(view.len());
                    let end = start.saturating_add(*len).min(view.len());
                    self.out.extend_from_slice(&view[start..end]);
                    self.known_left = self.known_left.saturating_sub(*len);
                }
                Source::File {
                    store,
                    fd,
                    offset,
                    size,
                } => {
                    let fd = fd.as_ref().map(bun_sys::File::handle);
                    if let Err(err) = read_file_part(
                        store.data.as_file(),
                        fd,
                        *offset,
                        *size,
                        &mut self.out,
                        self.known_left,
                    ) {
                        self.error = Some(err);
                        return;
                    }
                }
                Source::S3 { .. } => return,
            }
            self.next += 1;
        }
        self.out
            .extend_from_slice(&self.segments.framing[self.framing_at..]);
        self.framing_at = self.segments.framing.len();
        self.known_left = 0;
    }

    /// The bytes of the S3 part that `run` stopped at.
    fn append_download(&mut self, bytes: &[u8]) {
        self.out
            .reserve(bytes.len().saturating_add(self.known_left));
        self.out.extend_from_slice(bytes);
        self.next += 1;
    }

    /// The part to read next is a file or is in memory: a job for the work
    /// pool. Otherwise `run` only appends framing.
    fn next_is_job(&self) -> bool {
        matches!(
            self.segments.sources.get(self.next),
            Some(Segment {
                source: Source::File { .. } | Source::Memory { .. },
                ..
            })
        )
    }
}

/// The read that the serializer did in `FormDataContext::on_entry`, with the
/// same arguments, so a part has the bytes it had. The one change: a part
/// with no size reads to the end of the file.
fn read_file_part(
    file: &store::File,
    fd: Option<bun_sys::Fd>,
    offset: SizeType,
    size: SizeType,
    out: &mut Vec<u8>,
    reserve_after: usize,
) -> bun_sys::Result<()> {
    let mut node_fs = crate::node::fs::NodeFS::default();
    // `ReadFile` has `Drop`; can't use FRU `..Default::default()`.
    let mut args = crate::node::fs::args::ReadFile::default();
    args.encoding = crate::node::types::Encoding::Buffer;
    args.path = match fd {
        Some(fd) => PathOrFileDescriptor::Fd(fd),
        None => file.pathlike.clone(),
    };
    args.offset = offset;
    // `Some` stops `read_file` at the size that `fstat` gave, which is 0 for
    // a pipe and for procfs.
    args.max_size = (size != MAX_SIZE).then_some(size);
    let mut result = node_fs.read_file(&args, crate::node::fs::Flavor::Async)?;
    out.reserve(result.slice().len().saturating_add(reserve_after));
    out.extend_from_slice(result.slice());
    if let crate::node::types::StringOrBuffer::Buffer(buf) = &mut result {
        buf.destroy();
    }
    Ok(())
}

/// The job's ref on the parts.
struct PartsRef(RefPtr<FormDataParts>);
// SAFETY: used and dropped on the JS thread only, which is where the parts live.
unsafe impl jsc::job::JsAffine for PartsRef {}

impl jsc::JobContext for PartsRead {
    type OffThread = Self;
    type Js = PartsRef;

    fn run(this: &mut Self, done: jsc::Completion<Self>) -> Option<jsc::Completion<Self>> {
        this.run();
        Some(done)
    }

    fn then(this: Self, parts: PartsRef, cx: &JsThread<'_>) -> JsResult<()> {
        parts.0.on_read(this, cx)
    }
}

/// The download of one S3 part.
struct S3PartRead {
    parts: RefPtr<FormDataParts>,
    read: PartsRead,
    context: jsc::ContextId,
}

impl ReadBytesHandler for S3PartRead {
    unsafe fn on_read_bytes(this: *mut Self, result: ReadBytesResult) -> JsResult<()> {
        // SAFETY: `this` is the Box that `on_read` gave to `read_bytes_to_handler`,
        // which hands it back once.
        let S3PartRead {
            parts,
            mut read,
            context,
        } = *unsafe { bun_core::heap::take(this) };
        let vm = jsc::virtual_machine::VirtualMachine::get();
        let global = vm.global();
        let cx = global.js_thread(vm.context_of(context));
        match result {
            ReadBytesResult::Err(err) => parts.fail(ValueError::SystemError(*err), &cx),
            ReadBytesResult::Ok(bytes) => {
                read.append_download(&bytes);
                if read.next_is_job() {
                    parts.schedule(&cx, read);
                    return Ok(());
                }
                read.run();
                parts.on_read(read, &cx)
            }
        }
    }
}
