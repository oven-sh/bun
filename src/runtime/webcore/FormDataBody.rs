//! A `multipart/form-data` body with parts that are S3 objects.
//!
//! `Blob::from_dom_form_data` cannot wait for a download, so it leaves the bytes of an S3 entry
//! out and cuts the body there. The body is then a stream: each object is requested when the
//! stream reaches its part, as Fetch's "extract a body" reads a Blob part when the body is read.

use core::cell::Cell;
use core::ffi::c_void;

use bun_core::MutableString;
use bun_jsc::{GlobalRef, JsResult};
use bun_ptr::{BackRef, RawSlice, RefPtr};

use crate::webcore::blob::{self, Blob, BlobContentType, BodyFacts, Store};
use crate::webcore::byte_stream::{AfterDelivery, Source};
use crate::webcore::s3::client::{self as s3, S3DownloadFeed};
use crate::webcore::streams::{SourceHandle, StreamError, StreamResult};
use crate::webcore::{ByteStream, DrainResult, ReadableStream, readable_stream};

/// What `Blob::from_dom_form_data` makes of a `FormData`.
pub(crate) enum FormDataBody {
    /// The whole body: every entry was in memory, or a file that was read.
    Bytes(Blob),
    /// The body without the bytes of its S3 entries, and its `Content-Type`.
    Deferred(Deferred, BlobContentType),
}

pub(crate) struct Deferred {
    /// In body order. Never empty.
    pub(crate) parts: Vec<S3Part>,
    /// The bytes of the body after the last S3 object.
    pub(crate) tail: Vec<u8>,
}

/// An S3 object, or a window of one, and the bytes of the body that come before it: from the
/// start of the body, or from the S3 object before.
pub(crate) struct S3Part {
    before: Box<[u8]>,
    store: RefPtr<Store>,
    offset: usize,
    /// `None` reads to the end of the object.
    size: Option<usize>,
}

impl S3Part {
    /// The bytes `blob` is a view of. `store` is the S3 store of `blob`.
    pub(crate) fn new(before: Box<[u8]>, blob: &Blob, store: RefPtr<Store>) -> Self {
        debug_assert!(matches!(store.data, blob::store::Data::S3(_)));
        let size = blob.size.get();
        Self {
            before,
            store,
            offset: blob.offset.get() as usize,
            size: (size != blob::MAX_SIZE).then_some(size as usize),
        }
    }
}

impl Deferred {
    /// The stream the body is read through. It holds the bytes before the first S3 object, and
    /// requests nothing until a reader takes them.
    pub(crate) fn into_stream(mut self, cx: &bun_jsc::JsThread<'_>) -> JsResult<ReadableStream> {
        let reader = Source::new_mut(readable_stream::NewSource {
            context: ByteStream::default(),
            global_this: Cell::new(Some(BackRef::new(cx.global()))),
            ..Default::default()
        });
        // A `ByteStream` tells its producer when a reader empties its buffer, and says nothing
        // when a reader waits on an empty one. So the stream starts with the first part's headers.
        reader.context.apply_drain_result(DrainResult::Owned {
            list: core::mem::take(&mut self.parts[0].before).into_vec(),
            size_hint: 0,
        });
        let context: *mut ByteStream = &raw mut reader.context;
        let value = reader.to_readable_stream(cx)?;
        ReadableStream::set_body_facts(value, BodyFacts::empty());

        let producer = bun_core::heap::into_raw(Box::new(Producer {
            feed: S3DownloadFeed::default(),
            global: GlobalRef::from(cx.global()),
            context: cx.context().id(),
            parts: self.parts,
            tail: self.tail,
            part: Cell::new(0),
            downloading: Cell::new(false),
            entered: Cell::new(0),
        }));
        // SAFETY: `producer` is the live allocation made above, and `context` the ByteStream of
        // the source whose wrapper `value` is.
        unsafe { (*producer).feed.stream.hold(context) };
        reader.producer.set(SourceHandle::FormDataBody(
            // SAFETY: the source drops this handle before the producer frees itself: on cancel,
            // on collection, and when the producer gives up its hold.
            unsafe { BackRef::from_raw_mut(producer) },
        ));
        Ok(ReadableStream {
            ptr: readable_stream::Source::Bytes(context),
            value,
        })
    }
}

/// Feeds a [`Deferred`] body to its stream. The stream reaches it through
/// [`SourceHandle::FormDataBody`], a download through its callback context. It frees itself
/// when neither can reach it any more.
pub struct Producer {
    feed: S3DownloadFeed,
    global: GlobalRef,
    /// The script that made the body. Its downloads stop with it.
    context: bun_jsc::ContextId,
    parts: Vec<S3Part>,
    tail: Vec<u8>,
    /// The part that is downloading, or the one to request next.
    part: Cell<usize>,
    /// A download was requested and its last callback has not run.
    downloading: Cell<bool>,
    /// Calls into this producer that are on the stack. The outermost one frees it.
    entered: Cell<u32>,
}

impl Producer {
    /// Runs `f`, then frees the producer if that was its last use.
    ///
    /// # Safety
    /// `this` is the live allocation of [`Deferred::into_stream`].
    unsafe fn enter(this: *mut Self, f: impl FnOnce(&Self)) {
        // SAFETY: fn contract. A call from inside `f` does not free: `entered` is above 0 there.
        let last_use = unsafe {
            let producer = &*this;
            producer.entered.set(producer.entered.get() + 1);
            f(producer);
            producer.entered.set(producer.entered.get() - 1);
            producer.entered.get() == 0
                && !producer.feed.stream.is_held()
                && !producer.downloading.get()
        };
        if last_use {
            // SAFETY: the stream dropped its handle with the hold, no download will call back,
            // and no borrow of `*this` is live.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    /// The stream's buffer emptied, or a reader that wants the whole body arrived.
    pub(crate) fn on_stream_drained(this: *mut Self) {
        // SAFETY: the stream holds its handle only while `this` is live.
        unsafe {
            Self::enter(this, |producer| {
                producer.feed.on_stream_drained();
                if !producer.downloading.get() {
                    producer.request_part(this);
                }
            });
        }
    }

    pub(crate) fn on_consumer_attached(this: *mut Self) {
        // SAFETY: see `on_stream_drained`.
        unsafe { Self::enter(this, |producer| producer.feed.on_consumer_attached()) };
    }

    /// Nothing reads the rest: the reader cancelled, or the stream was collected. The second is
    /// inside a GC sweep, so this touches no JS cell.
    pub(crate) fn on_stream_cancelled(this: *mut Self) {
        // SAFETY: see `on_stream_drained`.
        unsafe { Self::enter(this, |producer| producer.feed.cancel()) };
    }

    fn request_part(&self, this: *mut Self) {
        let part = &self.parts[self.part.get()];
        let object = part.store.data.as_s3();
        self.downloading.set(true);
        let task = s3::download_stream(
            object.get_credentials(),
            self.global.bun_vm().context_of(self.context),
            object.path(),
            part.offset,
            part.size,
            object.request_payer,
            Self::on_chunk,
            this.cast::<c_void>(),
        );
        // A request that cannot start has already reported why, through `on_chunk`.
        if !task.is_null() {
            self.feed.task.set(task);
        }
    }

    fn on_chunk(
        chunk: &MutableString,
        has_more: bool,
        err: Option<s3::Error::S3Error>,
        this: *mut c_void,
    ) {
        let this = this.cast::<Self>();
        // SAFETY: `this` is the context `request_part` gave the download, live while `downloading`.
        unsafe {
            Self::enter(this, |producer| {
                if has_more {
                    producer.feed.deliver(chunk.list.as_slice());
                    return;
                }
                producer.feed.download_ended();
                producer.downloading.set(false);
                match err {
                    Some(err) => producer.fail(&err),
                    None => producer.finish_part(chunk.list.as_slice(), this),
                }
            });
        }
    }

    fn fail(&self, err: &s3::Error::S3Error) {
        let Some(bytes) = self.feed.stream.take() else {
            return;
        };
        let path = self.parts[self.part.get()].store.data.as_s3().path();
        bytes.on_data(StreamResult::Err(StreamError::JSValue(
            bun_jsc::strong::Optional::create(
                s3::s3_error_to_js(err, &self.global, Some(path)),
                &self.global,
            ),
        )));
    }

    /// The current object ended with `last_chunk`. The bytes that follow it go out next: up to
    /// the next S3 object, or to the end of the body.
    fn finish_part(&self, last_chunk: &[u8], this: *mut Self) {
        let next = self.part.get() + 1;
        // Before the deliveries: a reader inside one can ask for the next object.
        self.part.set(next);

        let Some(following) = self.parts.get(next) else {
            let Some(bytes) = self.feed.stream.take() else {
                return;
            };
            if !last_chunk.is_empty() {
                bytes.on_data(StreamResult::Temporary(RawSlice::new(last_chunk)));
            }
            bytes.on_data(StreamResult::TemporaryAndDone(RawSlice::new(&self.tail)));
            return;
        };

        let Some(bytes) = self.feed.stream.bytes() else {
            return;
        };
        if !last_chunk.is_empty() {
            bytes.on_data(StreamResult::Temporary(RawSlice::new(last_chunk)));
            // `on_data` can cancel us, and a request it asked for can fail at once.
            if !self.feed.stream.is_held() {
                return;
            }
        }
        bytes.on_data(StreamResult::Temporary(RawSlice::new(&following.before)));
        if !self.feed.stream.is_held() || self.downloading.get() {
            return;
        }
        // A reader that keeps up gets the next object now. Any other asks for it when it drains.
        if matches!(
            self.feed.stream.after_delivery(&bytes),
            AfterDelivery::Resume
        ) {
            self.request_part(this);
        }
    }
}
