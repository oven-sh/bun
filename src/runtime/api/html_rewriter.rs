//! HTMLRewriter API — wraps lol-html for JS.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use std::borrow::Cow;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CommonAbortReason, CommonAbortReasonExt as _, GlobalRef, JSGlobalObject,
    JSPromise, JSValue, JsCell, JsCellRefExt as _, JsRef, JsResult, SystemError, bun_string_jsc,
};

use bun_collections::ByteVecExt;
use bun_collections::smallvec::SmallVec;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope, JsWrapper};
use bun_ptr::{AsCtxPtr as _, BackRef, DetachablePtr, RefPtr};
use bun_sys::Error as SysError;

use crate::api::native_promise_context;
use crate::generated_bindgen::html_rewriter::{
    AttributeIteratorResult, ContentOptions, js_AttributeIterator, js_Comment, js_DocEnd,
    js_DocType, js_Element, js_EndTag, js_HTMLRewriter, js_HTMLRewriterTransform, js_TextChunk,
};
use crate::generated_bindgen::html_rewriter_internals::{
    Bun__HTMLRewriter__onHandlerReject, Bun__HTMLRewriter__onHandlerResolve,
    Bun__HTMLRewriter__onRejectInputStream, Bun__HTMLRewriter__onResolveInputStream,
};
use crate::generated_bindgen::response::js_Response;
use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::sink::{AnyControlledSink, ReadableSinkController};
use crate::webcore::streams::{
    self, SourceHandle, Start, StreamError, StreamResult, Writable, WritablePending,
};
use crate::webcore::{self, ByteStream, DrainResult, ReadableStream, Response, SinkHandle};
use bun_core::{EncodedSlice, String as BunString};
use bun_jsc::EncodedSliceJsc as _;
use lol_html::errors::RewritingError;
use lol_html::html_content::{self as lol, UserData as _};

// Lifetime-erased so a wrapper's `DetachablePtr` can hold the unit while a [`LentUnit`] lives.
type RawElement = lol::Element<'static, 'static>;
type RawTextChunk = lol::TextChunk<'static>;
type RawComment = lol::Comment<'static>;
type RawDoctype = lol::Doctype<'static>;
type RawDocumentEnd = lol::DocumentEnd<'static>;
type RawEndTag = lol::EndTag<'static>;

// ───────────────────── local helpers ─────────────────────────────────────

fn content_type(opts: &ContentOptions) -> lol::ContentType {
    if opts.html {
        lol::ContentType::Html
    } else {
        lol::ContentType::Text
    }
}

/// One method per lol-html op on `self.raw`. `None`: the handler has returned.
macro_rules! lol_ops {
    (content: $($content_op:ident),*; plain: $($plain_op:ident),*) => {
        $(
            pub(crate) fn $content_op<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
                content: &[u8],
                content_options: &ContentOptions,
            ) -> bindgen::Result<'a, Option<JsWrapper<'a, Self>>> {
                let Some(raw) = self.raw.get_mut() else {
                    return Ok(None);
                };
                raw.$content_op(utf8_or_error(heap, content)?, content_type(content_options));
                Ok(Some(this_value))
            }
        )*
        $(
            pub(crate) fn $plain_op<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
            ) -> Option<JsWrapper<'a, Self>> {
                self.raw.get_mut()?.$plain_op();
                Some(this_value)
            }
        )*
    };
}

// ───────────────────────────── handler lists ─────────────────────────────

/// Position of a callback or handler object in a [`HandlerList`].
#[derive(Clone, Copy)]
struct HandlerSlot(u32);

/// JS array of the `on()` / `onDocument()` callbacks and handler objects. Visited slots hold it.
#[derive(Clone, Copy)]
struct HandlerList(JSValue);

impl HandlerList {
    /// `rewriter`'s list, created on its first registration.
    fn of_rewriter(rewriter: JSValue, global: &JSGlobalObject) -> JsResult<Self> {
        if let Some(list) = Self::existing(js_HTMLRewriter::handlers_get_cached(rewriter)) {
            return Ok(list);
        }
        let list = JSValue::create_empty_array(global, 0)?;
        js_HTMLRewriter::handlers_set_cached(rewriter, global, list);
        Ok(Self(list))
    }

    fn existing(slot: Option<JSValue>) -> Option<Self> {
        slot.filter(|list| list.is_cell()).map(Self)
    }

    /// `put_index` defines an own property, so an `Array.prototype` setter never sees a handler.
    fn append(self, global: &JSGlobalObject, value: JSValue) -> JsResult<HandlerSlot> {
        let index = self.0.get_length(global)? as u32;
        self.0.put_index(global, index, value)?;
        Ok(HandlerSlot(index))
    }

    fn append_optional(
        self,
        global: &JSGlobalObject,
        value: Option<JSValue>,
    ) -> JsResult<Option<HandlerSlot>> {
        value.map(|value| self.append(global, value)).transpose()
    }

    /// `Err` while an exception (a termination) is pending.
    fn get(self, global: &JSGlobalObject, slot: HandlerSlot) -> JsResult<JSValue> {
        let value = self.0.get_direct_index(global, slot.0)?;
        debug_assert!(value.is_cell(), "HTMLRewriter handler list has a hole");
        Ok(value)
    }
}

/// Index of a pending `onEndTag()` callback in the JS array of the cell's `endTagHandlers` slot.
#[derive(Clone, Copy)]
struct EndTagSlot(u32);

// ───────────────────────────── HTMLRewriter ──────────────────────────────

/// Holds no JS values: the handlers name theirs by [`HandlerSlot`].
#[derive(Default)]
pub(crate) struct HTMLRewriter {
    element_handlers: JsCell<Vec<(lol_html::Selector, ElementHandler)>>,
    document_handlers: JsCell<Vec<DocumentHandler>>,
}

impl HTMLRewriter {
    pub(crate) fn constructor() -> Self {
        bun_core::analytics::Features::HTML_REWRITER
            .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        Self::default()
    }

    pub(crate) fn on<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        selector: JsLocal<'a>,
        handlers: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();
        if selector.to_js().is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!("Expected string")));
        }
        let selector_name = selector.to_js().to_utf8(global)?;
        let selector_source = utf8_or_throw(global, &selector_name)?;
        if selector_nesting(&selector_name) > MAX_SELECTOR_NESTING {
            return Err(global.throw_value(create_lolhtml_error(
                global,
                &"Selector is nested too deeply.",
            )));
        }
        let selector = match selector_source.parse::<lol_html::Selector>() {
            Ok(s) => s,
            Err(e) => return Err(global.throw_value(create_lolhtml_error(global, &e))),
        };

        let handler = ElementHandler::init(global, this_value.to_js(), handlers.to_js())?;
        self.element_handlers
            .with_mut(|handlers| handlers.push((selector, handler)));
        Ok(this_value)
    }

    pub(crate) fn on_document<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        handlers: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let handler = DocumentHandler::init(cx.global(), this_value.to_js(), handlers.to_js())?;
        self.document_handlers
            .with_mut(|handlers| handlers.push(handler));
        Ok(this_value)
    }

    /// The parser of one `transform()`. `pipe` is to own it, so it outlives what points back at it.
    fn lol_rewriter(&self, pipe: BackRef<RewriterPipe>) -> Box<LolRewriter> {
        let elements = self.element_handlers.get().iter();
        let documents = self.document_handlers.get().iter();
        Box::new(lol_html::HtmlRewriter::new(
            lol_html::Settings {
                element_content_handlers: elements
                    .map(|(selector, handler)| (Cow::Borrowed(selector), handler.bind(pipe)))
                    .collect(),
                document_content_handlers: documents.map(|handler| handler.bind(pipe)).collect(),
                encoding: lol_html::AsciiCompatibleEncoding::utf_8(),
                memory_settings: lol_html::MemorySettings {
                    max_allowed_memory_usage: u32::MAX as usize,
                    ..lol_html::MemorySettings::new()
                },
                strict: false,
                enable_esi_tags: false,
                adjust_charset_on_meta_tag: false,
            },
            bun_bundler::HTMLScanner::OutputSink::Buffer(BackRef::new(&pipe.output_buffer)),
        ))
    }

    pub(crate) fn transform(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        input: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let (this_value, input) = (this_value.to_js(), input.to_js());
        if let Some(response) = js_Response::from_js(&input) {
            // A failed body reports its own error, not "already used".
            let body_value = response.get_body_value();
            if let webcore::body::Value::Error(err) = body_value {
                return Err(cx.global().throw_value(err.to_js(cx.global())));
            }
            if matches!(*body_value, webcore::body::Value::Used) {
                return Err(cx
                    .global()
                    .throw_invalid_arguments(format_args!("Response body already used")));
            }
            return RewriterPipe::init(self, this_value, &cx, &response, None);
        }

        let is_string = input.is_string();
        if !is_string && !input.js_type().is_array_buffer_like() {
            return Err(cx
                .global()
                .throw_invalid_arguments(format_args!("Expected Response or Body")));
        }

        let response = RefPtr::new(Response::init(
            webcore::response::Init {
                status_code: 200,
                ..Default::default()
            },
            webcore::body::extract(cx.global(), input)?,
            BunString::EMPTY,
            false,
        ));
        let noun = if is_string {
            "a string"
        } else {
            "an ArrayBuffer"
        };
        let out = RewriterPipe::init(self, this_value, &cx, &response, Some(noun))?;
        let Some(out_response) = js_Response::from_js(&out) else {
            return Ok(out);
        };
        // Not `Locked`: with a noun the rewrite has either finished or thrown.
        let mut blob = out_response
            .get_body_value()
            .use_as_any_blob_allow_non_utf8_string();
        if is_string {
            blob.to_string(&cx, webcore::Lifetime::Transfer)
        } else {
            blob.to_array_buffer(&cx, webcore::Lifetime::Transfer)
        }
    }
}

// ─────────────────────────── RewriterPipe ────────────────────────────────

type LolRewriter = lol_html::HtmlRewriter<'static, bun_bundler::HTMLScanner::OutputSink<'static>>;

enum State {
    Idle(Box<LolRewriter>),
    /// A lol-html call, or the flush of its output, is on the stack. It has the rewriter.
    Running {
        then: Then,
        /// Set by the handler that is suspending the call.
        suspending: Option<LentUnit>,
    },
    /// A handler's promise is pending. `unit` points into `rewriter`, so it drops first.
    Suspended {
        then: Then,
        unit: LentUnit,
        rewriter: Box<LolRewriter>,
    },
    Done,
}

/// What follows the lol-html call that is running or suspended.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Then {
    Continue,
    Finish,
    /// The rewrite failed or was cancelled meanwhile.
    Stop,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InputEnd {
    Open,
    /// The JS pump closes the sink before its promise settles: the reaction ends the input.
    PumpReactionOwed,
    /// `end()` runs once the held input is through.
    Ended,
}

#[derive(Clone, Copy)]
enum Output {
    /// The response's body, which nothing waits for.
    Unread,
    /// The pending body, which `.text()`, `Bun.write` or the like wants whole.
    Buffering,
    /// Kept alive by the cell's `outputStream` slot.
    Stream(BackRef<ByteStream>),
    /// It has ended, failed or been cancelled. A handler can still settle.
    Over,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Demand {
    More,
    /// Hold the input until the reader's drain signal.
    ReaderBehind,
    /// Nothing will signal a drain: go on, but not within this turn.
    Unobserved,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PullPacing {
    YieldIfUnobserved,
    AlreadyYielded,
}

/// [`RewriterPipe::schedule_background_pull`]'s task.
pub(crate) struct RewriterPipeBackgroundPull;
impl bun_event_loop::RefTask for RewriterPipeBackgroundPull {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::HTMLRewriterBackgroundPull;
    type Ref = RefPtr<RewriterPipe>;
    fn release_unrun(pipe: Self::Ref) {
        pipe.background_pull_root.set(None);
    }
    /// See [`RewriterPipe::run_background_pull`].
    fn context(_: &Self::Ref) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

/// One `transform()`: the sink of its input and the producer of its output (`HTMLRewriterTransform` in JS).
#[derive(bun_ptr::CellRefCounted)]
#[repr(align(16))] // `DeferredDerefTask` packs a 4-bit tag into a pointer to this.
pub struct RewriterPipe {
    global: GlobalRef,
    /// Its slots root the response, both streams and the handlers. Weak: other owners of the pipe outlive it.
    cell: JsCell<JsRef>,
    /// The context of the script that called `transform()`.
    script_context: bun_jsc::ContextId,
    /// What `transform()` has to return synchronously ("a string"), so no handler may suspend.
    sync_only_noun: Option<&'static str>,
    state: JsCell<State>,

    input_source: Cell<SourceHandle>,
    input_end: Cell<InputEnd>,
    /// Bytes accepted from the input that lol-html has not been given yet.
    pending_input: JsCell<Vec<u8>>,
    /// The cell, while a [`Self::run_background_pull`] task is in the event-loop queue.
    background_pull_root: JsCell<Option<jsc::ProtectedJSValue>>,
    /// Cleared when a reader drives the input before that task runs.
    background_pull_armed: Cell<bool>,

    output: Cell<Output>,
    /// What lol-html has emitted and `output` has not been given yet.
    output_buffer: JsCell<Vec<u8>>,
    /// Reaches the output body after the `Response` wrapper is swept along with the cell.
    response: JsCell<Option<RefPtr<Response>>>,
    /// Slots whose callback has run. Reused, so the array grows with the open elements only.
    free_end_tag_slots: JsCell<Vec<EndTagSlot>>,
    /// The `flush(true)` promise of a JS source.
    pending_flush: JsCell<WritablePending>,

    ref_count: Cell<u32>,
    /// The JS-pump controller's ref, until it detaches.
    pump_ref: Cell<Option<PipePin>>,
}

impl RewriterPipe {
    /// How far the output may run ahead of its reader. The same as for the request body of a `fetch()`.
    const HIGH_WATER_MARK: BlobSizeType = 16384;

    /// Runs during the GC sweep. The other owners may still dispatch into the pipe afterwards.
    pub fn finalize(&self) {
        self.cell.with_mut(|r| r.finalize());
    }

    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    /// The handler's promise was collected without settling. Can run mid-sweep once the VM has stopped.
    pub(crate) fn abandon_suspension(&self) {
        self.state.set(State::Done);
        // Failed for the script that is waiting (nobody, if its `Bun.ModuleGraph` has been disposed since).
        let _context = VirtualMachine::get().enter_context(self.script_context);
        let vm_stopped = !VirtualMachine::get().script_allowed();
        // Held for `fail`, which allocates: nothing else on this stack reaches the cell.
        let cell = if vm_stopped {
            None
        } else {
            self.cell.try_get().map(jsc::EnsureStillAlive)
        };
        if cell.is_none() {
            // Both streams are gone, or go with the VM: they must not be touched.
            self.input_source.set(SourceHandle::None);
            if let Output::Stream(_) = self.output.get() {
                self.output.set(Output::Unread);
            }
        }
        if !vm_stopped {
            self.fail(webcore::body::ValueError::Message(BunString::static_(
                "HTMLRewriter content handler returned a Promise that will never settle",
            )));
        }
    }

    /// For [`Self::drive`] to pick up once lol-html has unwound.
    fn set_handler_error(&self, err: JSValue) {
        if let Some(cell) = self.cell.try_get() {
            js_HTMLRewriterTransform::handler_error_set_cached(cell, &self.global, err);
        }
    }

    fn take_handler_error(&self) -> Option<JSValue> {
        js_HTMLRewriterTransform::handler_error_take_cached(self.cell.try_get()?, &self.global)
            .filter(|err| !err.is_undefined_or_null())
    }

    /// With `cancel`, the source is told that its consumer is gone. That re-enters: call [`Self::stop`] first.
    fn detach_input_source(&self, cancel: Option<JSValue>) -> SourceHandle {
        let mut src = self.input_source.replace(SourceHandle::None);
        let mut upstream = src;
        if let (Some(reason), SourceHandle::JSController(_)) = (cancel, upstream) {
            upstream.cancel(reason);
        }
        src.detach(&self.global);
        if cancel.is_some() {
            match upstream {
                SourceHandle::ByteStream(_) | SourceHandle::FileReader(_) => {
                    upstream.close(None);
                }
                _ => {}
            }
        }
        upstream
    }

    /// Runs last: `src` may be delivering the end, and may be all that reaches the cell.
    fn release_input_roots(&self, src: SourceHandle) {
        let Some(cell) = self.cell.try_get() else {
            // Collected together with everything these edges pointed at.
            return;
        };
        match src {
            SourceHandle::ByteStream(bs) => bs.parent_const().set_sink_owner(JSValue::UNDEFINED),
            SourceHandle::FileReader(fr) => fr.parent_const().set_sink_owner(JSValue::UNDEFINED),
            _ => {}
        }
        js_HTMLRewriterTransform::input_stream_set_cached(cell, &self.global, JSValue::UNDEFINED);
    }

    fn detach_output(&self) {
        if let Output::Stream(out) = self.output.get() {
            self.output.set(Output::Over);
            out.parent_const().set_owner(JSValue::UNDEFINED);
            out.parent_const().producer.set(SourceHandle::None);
        }
    }

    fn is_idle(&self) -> bool {
        matches!(self.state.get(), State::Idle(_))
    }

    fn is_over(&self) -> bool {
        match self.state.get() {
            State::Idle(_) => false,
            State::Running { then, .. } | State::Suspended { then, .. } => *then == Then::Stop,
            State::Done => true,
        }
    }

    /// Input has to wait: whatever ends the wait goes on to [`Self::advance`].
    fn is_blocked(&self) -> bool {
        !self.is_idle() || self.background_pull_armed.get() || self.demand() == Demand::ReaderBehind
    }

    fn demand(&self) -> Demand {
        let staged = self.output_buffer.get().len() as BlobSizeType;
        let out = match self.output.get() {
            Output::Stream(out) => out,
            Output::Unread if staged > Self::HIGH_WATER_MARK => return Demand::Unobserved,
            Output::Unread | Output::Buffering | Output::Over => return Demand::More,
        };
        if out.sink_paused.get() {
            return Demand::ReaderBehind;
        }
        // A body-mixin collector grows `buffered` deliberately until Done.
        if staged + out.buffered.held_len() as BlobSizeType <= Self::HIGH_WATER_MARK
            || out.buffer_action.get().is_some()
        {
            return Demand::More;
        }
        if self.has_reader(&out) {
            Demand::ReaderBehind
        } else {
            Demand::Unobserved
        }
    }

    fn has_reader(&self, out: &ByteStream) -> bool {
        out.sink.get().is_some()
            || out.pending.is_pending()
            || (self.cell.try_get())
                .and_then(js_HTMLRewriterTransform::output_stream_get_cached)
                .is_some_and(|stream| {
                    webcore::readable_stream::is_locked_value(stream, &self.global)
                })
    }

    fn init(
        rewriter: &HTMLRewriter,
        rewriter_value: JSValue,
        cx: &bun_jsc::JsThread<'_>,
        original: &Response,
        sync_only_noun: Option<&'static str>,
    ) -> JsResult<JSValue> {
        // https://github.com/oven-sh/bun/issues/3334
        let headers = original.clone_init_headers(cx.global())?;

        let pipe = RefPtr::new(RewriterPipe {
            global: GlobalRef::from(cx.global()),
            cell: JsCell::new(JsRef::empty()),
            script_context: cx.context().id(),
            sync_only_noun,
            state: JsCell::new(State::Done),
            input_source: Cell::new(SourceHandle::None),
            input_end: Cell::new(InputEnd::Open),
            pending_input: JsCell::new(Vec::new()),
            background_pull_root: JsCell::new(None),
            background_pull_armed: Cell::new(false),
            output: Cell::new(Output::Unread),
            output_buffer: JsCell::new(Vec::new()),
            response: JsCell::new(None),
            free_end_tag_slots: JsCell::new(Vec::new()),
            pending_flush: JsCell::new(WritablePending::default()),
            ref_count: Cell::new(1),
            pump_ref: Cell::new(None),
        });
        let this = BackRef::from(pipe.as_non_null());
        this.state.set(State::Idle(rewriter.lol_rewriter(this)));

        // The output stream is created when something reads `.body`.
        let result = RefPtr::new(Response::init(
            webcore::response::Init {
                status_code: 200,
                ..Default::default()
            },
            webcore::Body::new({
                let mut pv = webcore::body::PendingValue::new(cx.global());
                pv.task = Some(pipe.as_non_null().cast::<c_void>());
                pv.on_start_buffering = Some(RewriterPipe::on_start_buffering);
                pv.on_start_streaming = Some(RewriterPipe::on_start_streaming);
                pv.on_readable_stream_available = Some(RewriterPipe::on_readable_stream_available);
                pv.producer = SourceHandle::HTMLRewriter(this);
                webcore::body::Value::Locked(pv)
            }),
            BunString::EMPTY,
            false,
        ));
        let result_ref = result.this_ptr();
        this.response.set(Some(result.clone()));

        result_ref.set_init(
            original.get_method(),
            original.get_init_status_code(),
            original.get_init_status_text().clone(),
        );

        result_ref.set_init_headers(headers);

        let response_js_value = Response::to_js(result, &this.global);

        let cell = js_HTMLRewriterTransform::to_js(pipe, cx.global());
        this.cell.set(JsRef::init_weak(cell));
        js_HTMLRewriterTransform::response_set_cached(cell, cx.global(), response_js_value);
        js_Response::transform_set_cached(response_js_value, cx.global(), cell);
        // This rewrite can outlive the rewriter's wrapper. Its handlers must not die with it.
        if let Some(handlers) = js_HTMLRewriter::handlers_get_cached(rewriter_value) {
            js_HTMLRewriterTransform::handlers_set_cached(cell, cx.global(), handlers);
        }

        result_ref.set_url(original.url().clone());

        let value = original.get_body_value();
        let owned_readable_stream = original.get_body_readable_stream();

        Self::wire_input(this, cell, cx, value, owned_readable_stream)?;

        // Only a `sync_only_noun` rewrite leaves its error here.
        if let Some(err) = this.take_handler_error() {
            return Err(cx.global().throw_value(err));
        }

        response_js_value.ensure_still_alive();
        Ok(response_js_value)
    }

    fn wire_input(
        this: BackRef<Self>,
        cell: JSValue,
        cx: &bun_jsc::JsThread<'_>,
        value: &mut webcore::body::Value,
        mut stream: Option<ReadableStream>,
    ) -> JsResult<()> {
        if stream.is_none() {
            let needs_stream = match value {
                webcore::body::Value::Locked(_) => true,
                webcore::body::Value::Blob(b) => b.needs_to_read_file() || b.is_s3(),
                _ => false,
            };
            if needs_stream {
                stream = ReadableStream::from_js(value.to_readable_stream(cx)?, cx.global())?;
            }
        }

        // The bytes are in memory. `sync_only_noun` always lands here.
        let Some(stream) = stream else {
            // Encodes a string body as UTF-8.
            let any_blob = value.use_as_any_blob();
            // Before the feed: a handler that suspends resumes into the end.
            this.input_end.set(InputEnd::Ended);
            // A suspended lol-html keeps a copy of the unparsed tail.
            if this.feed(any_blob.slice()) {
                this.end_rewrite();
            }
            return Ok(());
        };

        if stream.is_locked(cx.global()) || stream.is_disturbed(cx.global()) {
            let err = SystemError {
                code: BunString::static_("ERR_STREAM_ALREADY_FINISHED"),
                message: BunString::static_("Stream already used, please create a new one"),
                ..Default::default()
            };
            return Err(cx.global().throw_value(err.to_error_instance(cx.global())));
        }

        js_HTMLRewriterTransform::input_stream_set_cached(cell, cx.global(), stream.value);
        *value = webcore::body::Value::Used;

        let sink_handle = SinkHandle::HTMLRewriter(this);
        match stream.wire_native_sink(cx.global(), sink_handle, cell, |src| {
            this.input_source.set(src)
        }) {
            webcore::readable_stream::NativeWireResult::Wired => return Ok(()),
            webcore::readable_stream::NativeWireResult::EndedInline(err) => {
                this.end_from_stream(err);
                return Ok(());
            }
            webcore::readable_stream::NativeWireResult::NotNative => {}
        }

        this.pump_ref.set(Some(this.pin()));
        let pump = ReadableSinkController::assign_to_stream(cx.global(), stream.value, this.into());

        // Neither an error nor a promise: the stream drained inside `assign_to_stream`.
        let mut err = pump.to_error();
        if err.is_none()
            && let Some(promise) = pump.as_any_promise()
        {
            match promise.status() {
                jsc::js_promise::Status::Pending => {
                    this.input_end.set(InputEnd::PumpReactionOwed);
                    pump.then_with_value(
                        cx.global(),
                        cell,
                        Bun__HTMLRewriter__onResolveInputStream,
                        Bun__HTMLRewriter__onRejectInputStream,
                    );
                    return Ok(());
                }
                jsc::js_promise::Status::Fulfilled => {}
                jsc::js_promise::Status::Rejected => {
                    promise.set_handled(cx.global().vm());
                    err = Some(promise.result(cx.global().vm()));
                }
            }
        }
        this.end_from_pump(err);
        Ok(())
    }

    fn end_from_pump(&self, err: Option<JSValue>) {
        if self.input_end.get() == InputEnd::PumpReactionOwed {
            self.input_end.set(InputEnd::Open);
        }
        self.end_from_stream(
            err.map(|err| StreamError::JSValue(jsc::strong::Optional::create(err, &self.global))),
        );
    }

    fn on_start_buffering(ctx: NonNull<c_void>) {
        let this = BackRef::from(ctx.cast::<RewriterPipe>());
        this.output.set(Output::Buffering);
        this.resume();
    }

    /// For an entry point that runs JS, which can get the cell swept mid-call.
    fn pin(&self) -> PipePin {
        self.ref_();
        PipePin(BackRef::new(self))
    }

    /// Continues from the event loop, so an unread rewrite still runs its handlers, one chunk per turn.
    fn schedule_background_pull(&self) {
        self.background_pull_armed.set(true);
        self.queue_background_pull();
    }

    #[inline(never)]
    fn queue_background_pull(&self) {
        if self.background_pull_root.get().is_some() {
            return;
        }
        let vm = self.global.bun_vm();
        if vm.is_shutting_down() {
            return;
        }
        // Nothing else may reach the cell until then.
        self.background_pull_root
            .set(Some(self.cell.get_or_undefined().protected()));
        vm.enqueue_task(
            bun_event_loop::Task::from_ref::<RewriterPipeBackgroundPull>(self.ref_guard()),
        );
    }

    pub(crate) fn run_background_pull(&self) {
        let _root = self.background_pull_root.take();
        let armed = self.background_pull_armed.replace(false);
        let vm = self.global.bun_vm();
        if !self.is_blocked()
            && (armed || self.is_stalled())
            && vm.is_context_live(self.script_context)
        {
            let context = vm.enter_context(self.script_context);
            // Collected, not disposed: handlers of its own would have kept the graph alive.
            let _context = (!vm.calls_nobody()).then_some(context);
            self.advance(PullPacing::AlreadyYielded);
        }
    }

    fn on_start_streaming(ctx: NonNull<c_void>) -> DrainResult {
        let this = BackRef::from(ctx.cast::<RewriterPipe>());
        let list = this.output_buffer.replace(Vec::new());
        if list.is_empty() {
            return DrainResult::EstimatedSize(0);
        }
        let len = list.len();
        DrainResult::Owned {
            list,
            size_hint: len,
        }
    }

    fn on_readable_stream_available(
        ctx: NonNull<c_void>,
        global_this: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        let this = BackRef::from(ctx.cast::<RewriterPipe>());
        let Some(cell) = this.cell.try_get() else {
            return;
        };
        if let Some(bytes) = readable.ptr.bytes() {
            // The stream roots the cell, so its `producer` cannot outlive the pipe.
            bytes.parent_const().set_owner(cell);
            this.output.set(Output::Stream(bytes));
        }
        js_HTMLRewriterTransform::output_stream_set_cached(cell, global_this, readable.value);
    }

    pub fn write(&self, data: &StreamResult<'_>) -> Writable {
        let _pin = self.pin();
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        let held = || {
            if data.is_done() {
                // There is nothing to hold back, and `Backpressure` would delay `end`.
                Writable::Owned(len)
            } else {
                Writable::Backpressure(len)
            }
        };
        if self.is_over() {
            return Writable::Done;
        }
        if self.is_blocked() {
            self.pending_input.with_mut(|v| v.extend_from_slice(bytes));
            return held();
        }
        let fed = if self.pending_input.get().is_empty() {
            self.feed(bytes)
        } else {
            self.pending_input.with_mut(|v| v.extend_from_slice(bytes));
            self.feed_held()
        };
        if self.is_over() {
            // Makes a native source let go of the sink, even if a handler also suspended.
            return Writable::Done;
        }
        if !fed || (!data.is_done() && !self.may_continue(PullPacing::YieldIfUnobserved)) {
            return held();
        }
        if self.is_stalled() {
            self.queue_background_pull();
        }
        Writable::Owned(len)
    }

    /// For a chunk that script holds: a handler can shrink or transfer its buffer while lol-html reads it.
    #[inline(never)]
    pub(crate) fn write_copy(&self, bytes: &[u8]) -> Writable {
        let copy = SmallVec::<[u8; 1024]>::from_slice(bytes);
        self.write(&StreamResult::Temporary(&copy))
    }

    /// The input ended or failed.
    pub fn end_from_stream(&self, err: Option<StreamError>) {
        let _pin = self.pin();
        let src = self.detach_input_source(None);

        if self.input_end.get() == InputEnd::PumpReactionOwed {
            return;
        }

        if self.is_over() {
        } else if let Some(err) = err {
            let value_error = match err {
                StreamError::JSValue(v) => webcore::body::ValueError::JSValue(v),
                StreamError::Error(e) => {
                    webcore::body::ValueError::SystemError(e.to_system_error().into())
                }
                StreamError::AbortReason(r) => webcore::body::ValueError::AbortReason(r),
            };
            self.fail(value_error);
        } else if !self.is_idle() || !self.pending_input.get().is_empty() {
            self.input_end.set(InputEnd::Ended);
        } else {
            self.end_rewrite();
        }
        self.release_input_roots(src);
    }

    /// The output's reader wants more.
    pub fn resume(&self) {
        if self.is_idle() && self.demand() != Demand::ReaderBehind {
            let _pin = self.pin();
            self.advance(PullPacing::YieldIfUnobserved);
        }
    }

    pub fn cancel_from_output(&self, _err: Option<SysError>) {
        let _pin = self.pin();
        self.stop();
        // The reader's own reason does not travel through the output `ByteStream`.
        let src = self.detach_input_source(Some(CommonAbortReason::UserAbort.to_js(&self.global)));
        self.release_flush();
        // After the input's close: the reader that cancels may reach the cell only through `owner`.
        self.detach_output();
        self.release_input_roots(src);
    }

    /// Nothing more is delivered. A running call still gets its handlers, a parked unit stays usable.
    fn stop(&self) {
        self.state.with_mut(|state| match state {
            State::Running { then, .. } | State::Suspended { then, .. } => *then = Then::Stop,
            State::Idle(_) | State::Done => *state = State::Done,
        });
        self.release_when_over();
    }

    /// Something waits for [`Self::advance`], and the consumer has nothing to drain: it will not signal.
    fn is_stalled(&self) -> bool {
        (!self.pending_input.get().is_empty()
            || self.input_end.get() == InputEnd::Ended
            || self.flush_waits())
            && match self.output.get() {
                // A later consumer signals once it has drained the output.
                Output::Unread | Output::Over => false,
                Output::Buffering => true,
                Output::Stream(out) => {
                    out.buffer_action.get().is_some()
                        || (out.buffered.is_empty() && self.has_reader(&out))
                }
            }
    }

    fn flush_waits(&self) -> bool {
        self.pending_flush.get().state == streams::PendingState::Pending
    }

    /// Lets go of a direct stream's `pull()` that waits in `flush(true)`, so the pump promise can settle.
    fn release_flush(&self) {
        self.pending_flush.with_mut(|p| {
            p.result = Writable::Done;
            p.run();
        });
    }

    /// `true`: idle again, ready for input. Inline: one frame less per link in a chain of rewriters.
    #[inline(always)]
    fn feed(&self, bytes: &[u8]) -> bool {
        self.drive_idle(Then::Continue, |r| r.write(bytes)) == Some(Then::Continue)
    }

    /// Out of line: the frame of `write` repeats down a chain of rewriters.
    #[inline(never)]
    fn feed_held(&self) -> bool {
        self.feed(&self.pending_input.take())
    }

    fn end_rewrite(&self) {
        if self.feed_end() {
            self.finish();
        }
    }

    /// Out of line: its frame must not stay under `finish`, which recurses down a chain of rewriters.
    #[inline(never)]
    fn feed_end(&self) -> bool {
        // Not the consuming `end`: a document-end handler can suspend.
        self.drive_idle(Then::Finish, |r| r.end_mut()).is_some()
    }

    #[inline(always)]
    fn drive_idle(
        &self,
        then: Then,
        call: impl FnOnce(&mut LolRewriter) -> Result<(), RewritingError>,
    ) -> Option<Then> {
        match self.state.replace(State::Done) {
            State::Idle(rewriter) => self.drive(rewriter, then, call),
            state => {
                self.state.set(state);
                None
            }
        }
    }

    /// Runs one lol-html call. `None`: it suspended or failed.
    #[inline(always)]
    fn drive(
        &self,
        rewriter: Box<LolRewriter>,
        then: Then,
        call: impl FnOnce(&mut LolRewriter) -> Result<(), RewritingError>,
    ) -> Option<Then> {
        self.state.set(State::Running {
            then,
            suspending: None,
        });
        let cell = self.cell.try_get();
        // A handler can cut every other path to the cell while lol-html has handlers left to run.
        let _cell = jsc::EnsureStillAlive(cell.unwrap_or_default());
        // A handler can end the input, which unroots a source that is delivering this chunk.
        let input = cell.and_then(js_HTMLRewriterTransform::input_stream_get_cached);
        let _input = jsc::EnsureStillAlive(input.unwrap_or_default());
        let rewriter = self.run(rewriter, call)?;
        // One chunk per call: each `on_data` may be a socket write or a downstream rewriter's `write`.
        self.flush_output();
        self.leave_completed(rewriter)
    }

    /// Out of line: the frame of `drive` repeats down a chain of rewriters.
    #[inline(never)]
    fn leave_completed(&self, rewriter: Box<LolRewriter>) -> Option<Then> {
        let State::Running { then, .. } = self.state.replace(State::Done) else {
            return None;
        };
        match then {
            Then::Continue => self.state.set(State::Idle(rewriter)),
            Then::Finish => {}
            Then::Stop => self.release_when_over(),
        }
        Some(then)
    }

    /// As [`Self::leave_completed`].
    #[inline(never)]
    fn run(
        &self,
        mut rewriter: Box<LolRewriter>,
        call: impl FnOnce(&mut LolRewriter) -> Result<(), RewritingError>,
    ) -> Option<Box<LolRewriter>> {
        let Err(e) = call(&mut rewriter) else {
            return Some(rewriter);
        };
        self.leave_interrupted(rewriter, e);
        None
    }

    #[cold]
    fn leave_interrupted(&self, mut rewriter: Box<LolRewriter>, e: RewritingError) {
        // Before the flush, which runs JS that can use the unit.
        if let State::Running {
            suspending: Some(unit),
            ..
        } = self.state.get()
        {
            unit.point_at(Some(&mut rewriter));
        }
        self.flush_output();
        let State::Running { then, suspending } = self.state.replace(State::Done) else {
            return;
        };
        if then == Then::Stop {
            self.release_when_over();
        }
        match (e, suspending) {
            (RewritingError::Suspended, Some(unit)) => {
                self.state.set(State::Suspended {
                    then,
                    unit,
                    rewriter,
                });
                self.begin_suspension();
            }
            (e, _) => self.on_rewriting_error(&e),
        }
    }

    /// An output `Response` that outlives the rewrite stops retaining its handlers and input.
    fn release_when_over(&self) {
        if matches!(self.state.get(), State::Running { .. }) {
            // lol-html runs the handlers for the rest of this chunk. `drive` calls again.
            return;
        }
        self.pending_input.set(Vec::new());
        self.free_end_tag_slots.set(Vec::new());
        if let Some(cell) = self.cell.try_get() {
            js_HTMLRewriterTransform::handlers_set_cached(cell, &self.global, JSValue::UNDEFINED);
            js_HTMLRewriterTransform::end_tag_handlers_set_cached(
                cell,
                &self.global,
                JSValue::UNDEFINED,
            );
        }
    }

    /// Holds `callback` for the end-tag handler that names the slot. `None`: no end tag can come.
    fn hold_end_tag_callback(
        &self,
        global: &JSGlobalObject,
        replaced: Option<EndTagSlot>,
        callback: JSValue,
    ) -> JsResult<Option<EndTagSlot>> {
        // A parked element can call this after its rewrite is over, or (until the abandon) collected.
        if self.is_over() && !matches!(self.state.get(), State::Running { .. }) {
            return Ok(None);
        }
        let Some(cell) = self.cell.try_get() else {
            return Ok(None);
        };
        let list = match js_HTMLRewriterTransform::end_tag_handlers_get_cached(cell) {
            Some(list) if list.is_cell() => list,
            _ => {
                let list = JSValue::create_empty_array(global, 0)?;
                js_HTMLRewriterTransform::end_tag_handlers_set_cached(cell, global, list);
                list
            }
        };
        let slot = match replaced.or_else(|| self.free_end_tag_slots.with_mut(Vec::pop)) {
            Some(slot) => slot,
            None => EndTagSlot(list.get_length(global)? as u32),
        };
        // An own property, as in `HandlerList::append`.
        list.put_index(global, slot.0, callback)?;
        cell.ensure_still_alive();
        Ok(Some(slot))
    }

    /// For the one run of the handler that names `slot`.
    fn take_end_tag_callback(&self, slot: EndTagSlot) -> JsResult<Option<Callback>> {
        // `drive` keeps the cell alive, and the array stays until lol-html returns.
        let list = (self.cell.try_get())
            .and_then(js_HTMLRewriterTransform::end_tag_handlers_get_cached)
            .filter(|list| list.is_cell());
        debug_assert!(list.is_some(), "HTMLRewriter end-tag handler has no array");
        let Some(list) = list else {
            return Ok(None);
        };
        let function = list.get_direct_index(&self.global, slot.0)?;
        list.put_index(&self.global, slot.0, JSValue::UNDEFINED)?;
        self.free_end_tag_slots.with_mut(|free| free.push(slot));
        debug_assert!(function.is_cell(), "HTMLRewriter end-tag slot is empty");
        Ok(function.is_cell().then_some(Callback {
            function,
            this_object: JSValue::ZERO,
        }))
    }

    fn flush_output(&self) {
        if let Output::Stream(out) = self.output.get()
            && !self.output_buffer.get().is_empty()
        {
            out.on_data(StreamResult::Owned(self.output_buffer.take()));
        }
    }

    /// `None`: a late end or error must not bring a used body back.
    fn response_to_settle(&self) -> Option<&Response> {
        let late = matches!(self.output.replace(Output::Over), Output::Over);
        (self.response.get().as_deref()).filter(|response| {
            !late || !matches!(response.get_body_value(), webcore::body::Value::Used)
        })
    }

    fn finish(&self) {
        self.release_when_over();
        self.pending_flush.with_mut(|p| p.run());
        if let Output::Stream(out) = self.output.get() {
            out.on_data(StreamResult::Done);
            return self.detach_output();
        }
        let Some(response) = self.response_to_settle() else {
            return;
        };
        // For a waiting `.blob()`'s content type.
        let headers = response.get_fetch_headers().map(NonNull::from);
        let body_value = response.get_body_value();
        let bytes = self.output_buffer.replace(Vec::new());
        let mut prev_value = core::mem::replace(
            body_value,
            webcore::body::Value::InternalBlob(webcore::InternalBlob {
                bytes,
                was_string: false,
            }),
        );
        let context = self.global.bun_vm().context_of(self.script_context);
        let _ = webcore::body::Value::resolve(
            &mut prev_value,
            body_value,
            &self.global.js_thread(context),
            headers,
        );
    }

    /// `false`: the reader's drain signal or the background pull takes over.
    fn may_continue(&self, pacing: PullPacing) -> bool {
        match (self.demand(), pacing) {
            (Demand::More, _) | (Demand::Unobserved, PullPacing::AlreadyYielded) => true,
            (Demand::ReaderBehind, _) => false,
            (Demand::Unobserved, PullPacing::YieldIfUnobserved) => {
                self.schedule_background_pull();
                false
            }
        }
    }

    /// The rewriter is idle and nothing holds it back: feeds what is held, then ends or pulls.
    fn advance(&self, pacing: PullPacing) {
        let drain = || self.pending_input.get().is_empty() || self.feed_held();
        if !drain() {
            return;
        }
        // Backpressure only gates more input: finishing frees the parser and settles the body.
        if self.input_end.get() == InputEnd::Ended {
            // A handler or a reader may have written before it closed the input.
            if drain() {
                self.end_rewrite();
            }
            return;
        }
        if !self.may_continue(pacing) {
            return;
        }
        self.background_pull_armed.set(false);
        if !self.pending_input.get().is_empty() && self.is_stalled() {
            self.queue_background_pull();
        }
        self.input_source.get().ready(None, None);
        self.pending_flush.with_mut(|p| p.run());
    }

    #[cold]
    fn on_rewriting_error(&self, e: &RewritingError) {
        let captured = self.take_handler_error();
        // The call can hit the memory limit after a handler suspended. lol-html parks nothing then.
        self.take_suspension_promise();
        if self.sync_only_noun.is_some() {
            // `init()` is still on the stack; make `transform()` throw.
            return self.set_handler_error(
                captured.unwrap_or_else(|| create_lolhtml_error(&self.global, e)),
            );
        }

        self.fail(match captured {
            Some(err) => {
                webcore::body::ValueError::JSValue(jsc::strong::Optional::create(err, &self.global))
            }
            None => {
                webcore::body::ValueError::Message(BunString::clone_utf8(e.to_string().as_bytes()))
            }
        });
    }

    /// The slot only roots the promise until its reaction is attached: a dead one has to be collectible.
    fn take_suspension_promise(&self) -> Option<JSValue> {
        js_HTMLRewriterTransform::suspension_promise_take_cached(self.cell.try_get()?, &self.global)
    }

    #[inline(never)]
    fn begin_suspension(&self) {
        // The context roots the cell, and queues `abandon_suspension` if it is collected with the promise.
        let Some(promise) = self.take_suspension_promise() else {
            return self.abandon_suspension();
        };
        let cell = self.cell.get_or_undefined();
        let context = native_promise_context::create(&self.global, self.ref_guard(), cell);
        promise.then_with_value(
            &self.global,
            context,
            Bun__HTMLRewriter__onHandlerResolve,
            Bun__HTMLRewriter__onHandlerReject,
        );
    }

    /// The handler's promise resolved.
    fn resume_suspended(&self) {
        match self.state.replace(State::Done) {
            State::Suspended {
                then: Then::Stop, ..
            } => {}
            State::Suspended {
                then,
                unit,
                rewriter,
            } => {
                drop(unit);
                match self.drive(rewriter, then, |r| r.resume()) {
                    Some(Then::Continue) => self.advance(PullPacing::YieldIfUnobserved),
                    Some(Then::Finish) => self.finish(),
                    Some(Then::Stop) | None => {}
                }
            }
            state => self.state.set(state),
        }
    }

    fn fail(&self, mut err: webcore::body::ValueError) {
        let _pin = self.pin();
        self.stop();
        let src = self.detach_input_source(Some(err.to_js(&self.global)));
        self.release_flush();
        if let Output::Stream(out) = self.output.get() {
            // Output emitted before the failure still precedes the error.
            self.flush_output();
            out.on_data(StreamResult::Err(err.to_stream_error(&self.global)));
            self.detach_output();
        } else if let Some(response) = self.response_to_settle() {
            let _ = (response.get_body_value()).to_error_instance(err, &self.global);
        }
        self.release_input_roots(src);
    }
}

/// A ref that leaves the free to the event loop: whoever is on the stack may still dispatch into the pipe.
#[must_use = "dropping immediately releases the ref"]
struct PipePin(BackRef<RewriterPipe>);

impl Drop for PipePin {
    fn drop(&mut self) {
        let refs = self.0.ref_count.get();
        if refs > 1 {
            self.0.ref_count.set(refs - 1);
            return;
        }
        native_promise_context::DeferredDerefTask::schedule(
            self.0.as_const_ptr().cast_mut().cast(),
            native_promise_context::Tag::HTMLRewriterPipeFree,
        );
    }
}

// ───────────────── RewriterPipe: JsSinkType (JS-pump fallback) ───────────

impl crate::webcore::sink::JsSinkType for RewriterPipe {
    const NAME: &'static str = "HTMLRewriterSink";

    type Entered<'a> = &'a Self;
    unsafe fn enter<'a>(this: NonNull<Self>) -> &'a Self {
        // SAFETY: trait contract.
        unsafe { this.as_ref() }
    }

    fn memory_cost(&self) -> usize {
        self.pending_input.get().capacity() + self.output_buffer.get().capacity()
    }
    fn write_bytes(this: &mut Self::Entered<'_>, data: &StreamResult<'_>) -> Writable {
        this.write_copy(data.slice())
    }
    fn write_utf16(this: &mut Self::Entered<'_>, text: &[u16]) -> Writable {
        let mut buf = Vec::new();
        let _ = buf.write_utf16(text);
        RewriterPipe::write(this, &StreamResult::Temporary(&buf))
    }
    fn write_latin1(this: &mut Self::Entered<'_>, data: &StreamResult<'_>) -> Writable {
        let bytes = data.slice();
        if bun_core::strings::is_all_ascii(bytes) {
            return RewriterPipe::write(this, data);
        }
        let mut buf = Vec::new();
        let _ = buf.write_latin1(bytes);
        RewriterPipe::write(this, &StreamResult::Temporary(&buf))
    }
    fn end(this: &mut Self::Entered<'_>, err: Option<SysError>) -> bun_sys::Result<()> {
        this.end_from_stream(err.map(StreamError::Error));
        bun_sys::Result::Ok(())
    }
    fn end_from_js(
        this: &mut Self::Entered<'_>,
        _cx: &bun_jsc::JsThread<'_>,
    ) -> bun_sys::Result<JSValue> {
        this.end_from_stream(None);
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }
    fn flush_from_js(
        this: &mut Self::Entered<'_>,
        cx: &bun_jsc::JsThread<'_>,
        wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if this.flush_waits() {
            return bun_sys::Result::Ok(this.pending_flush.with_mut(|p| p.promise(cx)));
        }
        if wait && !this.is_over() && this.is_blocked() {
            return bun_sys::Result::Ok(this.pending_flush.with_mut(|p| {
                p.result = Writable::Owned(0);
                p.promise(cx)
            }));
        }
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            cx.global(),
            JSValue::js_number(0.0),
        ))
    }
    fn start(
        _this: &mut Self::Entered<'_>,
        _config: Start,
        _context: &bun_jsc::ScriptExecutionContext,
    ) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }
}

impl crate::webcore::sink::ControlledSink for RewriterPipe {
    fn to_any_sink(this: NonNull<Self>) -> AnyControlledSink {
        AnyControlledSink::RewriterPipe(this)
    }

    fn controller_detached(&self) {
        self.pump_ref.set(None);
    }

    /// `controller_detached` released the controller's ref: `_this` may already be freed.
    unsafe fn controller_finalize(_this: *mut Self) {}

    unsafe fn close_with_error(
        this: *mut Self,
        global: &JSGlobalObject,
        reason: JSValue,
    ) -> bun_sys::Result<()> {
        // SAFETY: caller contract; `end_from_stream` pins the pipe itself.
        unsafe { &*this }.end_from_stream(Some(StreamError::JSValue(
            jsc::strong::Optional::create(reason, global),
        )));
        bun_sys::Result::Ok(())
    }
    fn source<'a>(this: &'a mut Self::Entered<'_>) -> &'a Cell<SourceHandle> {
        &this.input_source
    }
}

// ───────── .then() reactions for a content handler's promise ─────────────

pub(crate) fn on_handler_resolve(
    cx: &mut JsScope<'_>,
    _: JsLocal<'_>,
    context: Option<RefPtr<RewriterPipe>>,
) -> JsResult<()> {
    // `None` means the suspension was already abandoned.
    let Some(pipe) = context else {
        return Ok(());
    };
    pipe.resume_suspended();
    // Handler errors went to the output. A termination is still pending.
    if cx.global().has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    Ok(())
}

pub(crate) fn on_handler_reject(
    cx: &mut JsScope<'_>,
    reason: JsLocal<'_>,
    context: Option<RefPtr<RewriterPipe>>,
) -> JsResult<()> {
    let global = cx.global();
    let Some(pipe) = context else {
        return Ok(());
    };
    pipe.state.set(State::Done);
    pipe.fail(webcore::body::ValueError::JSValue(
        jsc::strong::Optional::create(reason.to_js(), global),
    ));
    if global.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    Ok(())
}

// ─────────────────────────── content handlers ────────────────────────────

/// Positions in the rewriter's [`HandlerList`]. `None`: the handler object had no such callback.
struct DocumentHandler {
    on_doc_type_callback: Option<HandlerSlot>,
    on_comment_callback: Option<HandlerSlot>,
    on_text_callback: Option<HandlerSlot>,
    on_end_callback: Option<HandlerSlot>,
    this_object: HandlerSlot,
}

impl DocumentHandler {
    fn bind(&self, pipe: BackRef<RewriterPipe>) -> lol_html::DocumentContentHandlers<'static> {
        let bound = |callback| BoundHandler(pipe, callback, self.this_object);
        let mut handlers = lol_html::DocumentContentHandlers::default();
        if let Some(h) = self.on_doc_type_callback.map(bound) {
            handlers = handlers
                .doctype(move |d: &mut lol::Doctype| h.run(LentUnit::DocType(Unit::lend(d))));
        }
        if let Some(h) = self.on_comment_callback.map(bound) {
            handlers = handlers.comments(h.comments());
        }
        if let Some(h) = self.on_text_callback.map(bound) {
            handlers = handlers.text(h.text());
        }
        if let Some(h) = self.on_end_callback.map(bound) {
            handlers = handlers
                .end(move |e: &mut lol::DocumentEnd| h.run(LentUnit::DocEnd(Unit::lend(e))));
        }
        handlers
    }

    /// `rewriter`: the `HTMLRewriter` wrapper whose [`HandlerList`] takes the values.
    fn init(
        global: &JSGlobalObject,
        rewriter: JSValue,
        this_object: JSValue,
    ) -> JsResult<DocumentHandler> {
        if !this_object.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        let doctype = callback_property(global, this_object, "doctype")?;
        let comments = callback_property(global, this_object, "comments")?;
        let text = callback_property(global, this_object, "text")?;
        let end = callback_property(global, this_object, "end")?;

        let list = HandlerList::of_rewriter(rewriter, global)?;
        Ok(DocumentHandler {
            this_object: list.append(global, this_object)?,
            on_doc_type_callback: list.append_optional(global, doctype)?,
            on_comment_callback: list.append_optional(global, comments)?,
            on_text_callback: list.append_optional(global, text)?,
            on_end_callback: list.append_optional(global, end)?,
        })
    }
}

/// See [`DocumentHandler`].
struct ElementHandler {
    on_element_callback: Option<HandlerSlot>,
    on_comment_callback: Option<HandlerSlot>,
    on_text_callback: Option<HandlerSlot>,
    this_object: HandlerSlot,
}

impl ElementHandler {
    fn bind(&self, pipe: BackRef<RewriterPipe>) -> lol_html::ElementContentHandlers<'static> {
        let bound = |callback| BoundHandler(pipe, callback, self.this_object);
        let mut handlers = lol_html::ElementContentHandlers::default();
        if let Some(h) = self.on_element_callback.map(bound) {
            handlers = handlers.element(move |e: &mut lol::Element| {
                h.run(LentUnit::Element(Element::lend(e, h.0)))
            });
        }
        if let Some(h) = self.on_comment_callback.map(bound) {
            handlers = handlers.comments(h.comments());
        }
        if let Some(h) = self.on_text_callback.map(bound) {
            handlers = handlers.text(h.text());
        }
        handlers
    }

    /// `rewriter`: the `HTMLRewriter` wrapper whose [`HandlerList`] takes the values.
    fn init(
        global: &JSGlobalObject,
        rewriter: JSValue,
        this_object: JSValue,
    ) -> JsResult<ElementHandler> {
        if !this_object.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        let element = callback_property(global, this_object, "element")?;
        let comments = callback_property(global, this_object, "comments")?;
        let text = callback_property(global, this_object, "text")?;

        let list = HandlerList::of_rewriter(rewriter, global)?;
        Ok(ElementHandler {
            this_object: list.append(global, this_object)?,
            on_element_callback: list.append_optional(global, element)?,
            on_comment_callback: list.append_optional(global, comments)?,
            on_text_callback: list.append_optional(global, text)?,
        })
    }
}

/// `handler[name]`, which has to be a function when it is present.
fn callback_property(
    global: &JSGlobalObject,
    handler: JSValue,
    name: &'static str,
) -> JsResult<Option<JSValue>> {
    let Some(val) = handler.get(global, name)? else {
        return Ok(None);
    };
    if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
        return Err(global.throw_invalid_arguments(format_args!("{name} must be a function")));
    }
    Ok(Some(val))
}

struct Callback {
    function: JSValue,
    this_object: JSValue,
}

/// The pipe whose lol-html calls run it, the callback, and its handler object.
#[derive(Clone, Copy)]
struct BoundHandler(BackRef<RewriterPipe>, HandlerSlot, HandlerSlot);

impl BoundHandler {
    fn callback(self) -> JsResult<Option<Callback>> {
        let Self(pipe, function, this_object) = self;
        // `drive` keeps the cell alive, and the list stays until lol-html returns.
        let cell = pipe.cell.try_get();
        let list =
            HandlerList::existing(cell.and_then(js_HTMLRewriterTransform::handlers_get_cached));
        debug_assert!(list.is_some(), "HTMLRewriter handler ran without its list");
        let Some(list) = list else {
            return Ok(None);
        };
        Ok(Some(Callback {
            function: list.get(&pipe.global, function)?,
            this_object: list.get(&pipe.global, this_object)?,
        }))
    }

    #[inline(always)]
    fn run(self, unit: LentUnit) -> lol_html::HandlerResult {
        self.0.run_handler(self.callback(), unit)
    }

    fn comments(self) -> impl FnMut(&mut lol::Comment<'_>) -> lol_html::HandlerResult {
        move |c| self.run(LentUnit::Comment(Unit::lend(c)))
    }

    fn text(self) -> impl FnMut(&mut lol::TextChunk<'_>) -> lol_html::HandlerResult {
        move |t| self.run(LentUnit::TextChunk(Unit::lend(t)))
    }
}

/// The wrapper of a unit lol-html has lent to a handler. Dropping it detaches the wrapper.
enum LentUnit {
    Element(RefPtr<Element>),
    Comment(RefPtr<Comment>),
    TextChunk(RefPtr<TextChunk>),
    EndTag(RefPtr<EndTag>),
    DocType(RefPtr<DocType>),
    DocEnd(RefPtr<DocEnd>),
}

impl LentUnit {
    #[inline(always)]
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        match self {
            Self::Element(w) => js_Element::to_js(w.clone(), global),
            Self::Comment(w) => js_Comment::to_js(w.clone(), global),
            Self::TextChunk(w) => js_TextChunk::to_js(w.clone(), global),
            Self::EndTag(w) => js_EndTag::to_js(w.clone(), global),
            Self::DocType(w) => js_DocType::to_js(w.clone(), global),
            Self::DocEnd(w) => js_DocEnd::to_js(w.clone(), global),
        }
    }

    /// At the heap copy that a suspended rewriter parked, or at nothing.
    fn point_at(&self, parked: Option<&mut LolRewriter>) {
        fn raw<T>(unit: Option<&mut T>) -> *mut T {
            unit.map_or(core::ptr::null_mut(), core::ptr::from_mut)
        }
        match self {
            Self::Element(w) => w.raw.set(raw(parked.and_then(|r| r.suspended_element()))),
            Self::Comment(w) => w.raw.set(raw(parked.and_then(|r| r.suspended_comment()))),
            Self::TextChunk(w) => w
                .raw
                .set(raw(parked.and_then(|r| r.suspended_text_chunk()))),
            Self::EndTag(w) => w.raw.set(raw(parked.and_then(|r| r.suspended_end_tag()))),
            Self::DocType(w) => w.raw.set(raw(parked.and_then(|r| r.suspended_doctype()))),
            Self::DocEnd(w) => w
                .raw
                .set(raw(parked.and_then(|r| r.suspended_document_end()))),
        }
    }
}

impl Drop for LentUnit {
    fn drop(&mut self) {
        match self {
            Self::Element(element) => element.invalidate(),
            _ => self.point_at(None),
        }
    }
}

/// The message reaches JS when no error was recorded.
#[cold]
fn stopped() -> lol_html::HandlerResult {
    Err("The rewriter has been stopped.".into())
}

impl RewriterPipe {
    /// Inlined into each closure, where the kind of `unit` is known.
    #[inline(always)]
    fn run_handler(
        &self,
        callback: JsResult<Option<Callback>>,
        unit: LentUnit,
    ) -> lol_html::HandlerResult {
        jsc::mark_binding();
        let global = &*self.global;
        // A pending termination stays pending, as when it stops the callback itself.
        let Ok(Some(callback)) = callback else {
            return stopped();
        };

        // `call` returns `undefined` without calling, as if the handler had nothing to change.
        let caller_is_listening = self.sync_only_noun.is_some();
        if !caller_is_listening && callback.function.call_may_have_been_dropped(global) {
            return stopped();
        }

        // Not `try_take_exception()`: the exception checker wants the call's throw seen by an enclosing scope.
        bun_jsc::top_scope!(scope, global);
        let args = [unit.to_js(global)];
        let result =
            (callback.function).call_for_running_script(global, callback.this_object, &args);
        if let Some(exception) = scope.exception() {
            self.record_exception(JSValue::from_cell(exception.as_ptr()));
            scope.clear_exception_except_termination();
            return stopped();
        }
        match result {
            Ok(result) if result.is_undefined_or_null() => Ok(()),
            Ok(result) => self.handler_returned(result, unit),
            Err(_) => stopped(),
        }
    }

    #[cold]
    fn record_exception(&self, exception: JSValue) {
        // A termination is not this handler's error: it stays pending to unwind whatever drives the rewriter.
        if !exception.is_termination_exception() {
            self.set_handler_error(exception.to_error().unwrap_or(exception));
        }
    }

    #[inline(never)]
    fn handler_returned(&self, result: JSValue, unit: LentUnit) -> lol_html::HandlerResult {
        let global = &*self.global;
        let fail = |err| {
            self.set_handler_error(err);
            stopped()
        };
        // Not `is_any_error`, which covers `Exception` cells and misses a cross-realm AggregateError.
        if result.is_error() || result.is_aggregate_error(global) {
            return fail(result);
        }
        let Some(promise) = result.as_any_promise() else {
            return Ok(());
        };

        // One checkpoint settles an `async` handler that never truly waits. Any other suspends the rewrite.
        if promise.status() == jsc::js_promise::Status::Pending
            && (global.drain_microtasks_and_next_ticks().is_err()
                || !global.clear_exception_except_termination())
        {
            return stopped();
        }

        match promise.status() {
            jsc::js_promise::Status::Fulfilled => Ok(()),
            jsc::js_promise::Status::Rejected => {
                promise.set_handled(global.vm());
                fail(promise.result(global.vm()))
            }
            jsc::js_promise::Status::Pending => {
                if let Some(noun) = self.sync_only_noun {
                    return fail(global.create_type_error_instance(format_args!(
                        "HTMLRewriter.transform() cannot synchronously return {noun} because a \
                         content handler returned a Promise that did not resolve within a microtask. \
                         Pass a Response instead and await its body"
                    )));
                }
                // lol-html moves the unit as it returns. `drive` points the wrapper at the copy.
                unit.point_at(None);
                let Some(cell) = self.cell.try_get() else {
                    return stopped();
                };
                js_HTMLRewriterTransform::suspension_promise_set_cached(cell, global, result);
                self.state.with_mut(|state| match state {
                    State::Running { suspending, .. } => {
                        *suspending = Some(unit);
                        Err(lol_html::SuspensionRequest.into())
                    }
                    State::Idle(_) | State::Suspended { .. } | State::Done => stopped(),
                })
            }
        }
    }
}

// ────────────────────────── error helpers ────────────────────────────────

fn create_lolhtml_error(global: &JSGlobalObject, message: &dyn core::fmt::Display) -> JSValue {
    if let Some(err) = global.try_take_exception() {
        return err;
    }
    let value = global.create_error_instance(format_args!("{message}"));
    value.put(
        global,
        b"name",
        EncodedSlice::latin1(b"HTMLRewriterError").to_js(global),
    );
    value
}

/// [`create_lolhtml_error`] as a `bindgen::Error`.
#[cold]
fn lolhtml_error<'a>(heap: &JsHeap<'a>, message: &dyn core::fmt::Display) -> bindgen::Error<'a> {
    // SAFETY: it makes an `Error` and a string, and defines `name`.
    let global = unsafe { heap.global() };
    bindgen::Error::from_value(JsLocal::new(heap, create_lolhtml_error(global, message)))
}

fn utf8_or_throw<'a>(global: &JSGlobalObject, bytes: &'a [u8]) -> JsResult<&'a str> {
    core::str::from_utf8(bytes).map_err(|e| global.throw_value(create_lolhtml_error(global, &e)))
}

/// lol-html's selector parser recurses per nested `(`: about 1,500 levels overflow a Worker's stack.
const MAX_SELECTOR_NESTING: usize = 32;

/// The deepest nesting of `(`. A `)` in an escape, a string or a comment closes nothing.
fn selector_nesting(selector: &[u8]) -> usize {
    let mut depth: usize = 0;
    let mut deepest: usize = 0;
    let mut bytes = selector.iter().copied().peekable();
    while let Some(byte) = bytes.next() {
        match byte {
            b'\\' => {
                bytes.next();
            }
            b'"' | b'\'' => {
                while let Some(in_string) = bytes.next() {
                    if in_string == b'\\' {
                        bytes.next();
                    } else if in_string == byte {
                        break;
                    }
                }
            }
            b'/' if bytes.next_if_eq(&b'*').is_some() => {
                while let Some(in_comment) = bytes.next() {
                    if in_comment == b'*' && bytes.next_if_eq(&b'/').is_some() {
                        break;
                    }
                }
            }
            b'(' => {
                depth += 1;
                deepest = deepest.max(depth);
            }
            b')' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

/// [`utf8_or_throw`] with a `bindgen::Error`.
fn utf8_or_error<'a, 'b>(heap: &JsHeap<'a>, bytes: &'b [u8]) -> bindgen::Result<'a, &'b str> {
    core::str::from_utf8(bytes).map_err(|e| lolhtml_error(heap, &e))
}

/// The unit and the UTF-8 to set on it. ToString runs user code, so it comes before the `&mut`.
fn setter_target<'a, R>(
    raw: &DetachablePtr<R>,
    global: &JSGlobalObject,
    value: JsLocal<'_>,
) -> JsResult<Option<(&'a mut R, String)>> {
    if raw.is_detached() {
        return Ok(None);
    }
    let slice = value.to_js().to_utf8(global)?;
    let text = utf8_or_throw(global, slice.slice())?.to_owned();
    Ok(raw.get_mut().map(|unit| (unit, text)))
}

fn string_to_js(s: &str, global: &JSGlobalObject) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, s.as_bytes())
}

fn opt_string_to_js_or_null(s: Option<String>, global: &JSGlobalObject) -> JsResult<JSValue> {
    match s {
        None => Ok(JSValue::NULL),
        Some(s) => string_to_js(&s, global),
    }
}

// ──────────────────────────── units ──────────────────────────────────────

/// The classes of `html_rewriter.bind.ts` that hold nothing but the lent unit.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct Unit<R> {
    ref_count: Cell<u32>,
    raw: DetachablePtr<R>,
}

pub(crate) type TextChunk = Unit<RawTextChunk>;
pub(crate) type DocType = Unit<RawDoctype>;
pub(crate) type DocEnd = Unit<RawDocumentEnd>;
pub(crate) type Comment = Unit<RawComment>;
pub(crate) type EndTag = Unit<RawEndTag>;

impl<R> Unit<R> {
    /// `T` is `R` with lol-html's lifetimes. The ref goes into a [`LentUnit`].
    fn lend<T>(unit: &mut T) -> RefPtr<Self> {
        const { assert!(size_of::<T>() == size_of::<R>()) };
        RefPtr::new(Self {
            ref_count: Cell::new(1),
            raw: DetachablePtr::new(core::ptr::from_mut(unit).cast()),
        })
    }
}

impl TextChunk {
    lol_ops!(content: before, after, replace; plain: remove);

    pub(crate) fn get_text(&self) -> Option<&str> {
        Some(self.raw.get_mut()?.as_str())
    }

    pub(crate) fn get_removed(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.removed())
    }

    pub(crate) fn get_last_in_text_node(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.last_in_text_node())
    }
}

impl DocType {
    lol_ops!(content: ; plain: remove);

    pub(crate) fn get_name(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(dt) = self.raw.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.name(), cx.global())
    }

    pub(crate) fn get_system_id(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(dt) = self.raw.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.system_id(), cx.global())
    }

    pub(crate) fn get_public_id(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(dt) = self.raw.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.public_id(), cx.global())
    }

    pub(crate) fn get_removed(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.removed())
    }
}

impl DocEnd {
    lol_ops!(content: append; plain:);
}

impl Comment {
    lol_ops!(content: before, after, replace; plain: remove);

    pub(crate) fn get_text(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(comment) = self.raw.get_mut() else {
            return Ok(JSValue::NULL);
        };
        string_to_js(&comment.text(), cx.global())
    }

    pub(crate) fn set_text(&self, cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if let Some((comment, text)) = setter_target(&self.raw, global, value)?
            && let Err(e) = comment.set_text(&text)
        {
            return Err(global.throw_value(create_lolhtml_error(global, &e)));
        }
        Ok(())
    }

    pub(crate) fn get_removed(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.removed())
    }
}

impl EndTag {
    lol_ops!(content: before, after; plain: remove);

    pub(crate) fn get_name(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(end_tag) = self.raw.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&end_tag.name(), cx.global())
    }

    pub(crate) fn set_name(&self, cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<()> {
        if let Some((end_tag, name)) = setter_target(&self.raw, cx.global(), value)? {
            end_tag.set_name_str(name);
        }
        Ok(())
    }
}

// ───────────────────────── AttributeIterator ─────────────────────────────

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct AttributeIterator {
    ref_count: Cell<u32>,
    /// Read through on every `next()`, so it follows a suspension. The element clears it before it goes.
    element: Cell<Option<BackRef<Element>>>,
    index: Cell<usize>,
}

impl AttributeIterator {
    fn detach(&self) {
        self.element.set(None);
    }

    pub(crate) fn finalize(&self) {
        self.detach();
    }

    pub(crate) fn next<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, AttributeIteratorResult<'a>> {
        let attribute = self
            .element
            .get()
            .and_then(|el| el.raw.get_mut())
            .and_then(|raw| raw.attributes().get(self.index.get()));
        let Some(attribute) = attribute else {
            self.detach();
            return Ok(AttributeIteratorResult {
                value: JsLocal::UNDEFINED,
                done: true,
            });
        };
        self.index.set(self.index.get() + 1);

        let value = attribute.value();
        let name = attribute.name();

        Ok(AttributeIteratorResult {
            value: bindgen::to_js::array(heap, [name, value], bindgen::to_js::utf8)?,
            done: false,
        })
    }

    pub(crate) fn get_this<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        this_value
    }
}

// ──────────────────────────── Element ────────────────────────────────────

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct Element {
    ref_count: Cell<u32>,
    raw: DetachablePtr<RawElement>,
    /// The ones that still point back at this.
    attribute_iterators: JsCell<Vec<RefPtr<AttributeIterator>>>,
    /// Lends `raw`.
    pipe: Cell<Option<BackRef<RewriterPipe>>>,
}

impl Drop for Element {
    fn drop(&mut self) {
        self.invalidate();
    }
}

impl Element {
    fn lend(element: &mut lol::Element<'_, '_>, pipe: BackRef<RewriterPipe>) -> RefPtr<Self> {
        RefPtr::new(Element {
            ref_count: Cell::new(1),
            raw: DetachablePtr::new(core::ptr::from_mut(element).cast()),
            attribute_iterators: JsCell::new(Vec::new()),
            pipe: Cell::new(Some(pipe)),
        })
    }

    fn detach_attribute_iterators(&self) {
        for iter in self.attribute_iterators.take() {
            iter.detach();
        }
    }

    fn invalidate(&self) {
        self.raw.detach();
        self.pipe.set(None);
        self.detach_attribute_iterators();
    }

    pub(crate) fn on_end_tag<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        function: JsLocal<'a>,
    ) -> bindgen::Result<'a, Option<JsWrapper<'a, Self>>> {
        let global_object = cx.global();
        let function = function.to_js();
        let (Some(el), Some(pipe)) = (self.raw.get_mut(), self.pipe.get()) else {
            return Ok(None);
        };
        if function.is_undefined_or_null() || !function.is_callable() {
            return Err(global_object
                .throw_type_error(format_args!("Expected a function"))
                .into());
        }

        // Every matching `on()` handler gets this lol-html element: its user data keeps the slot.
        let replaced = el.user_data().downcast_ref::<EndTagSlot>().copied();

        let Some(handlers) = el.end_tag_handlers() else {
            let err = create_lolhtml_error(global_object, &"No end tag.");
            return Err(global_object.throw_value(err).into());
        };

        let slot = pipe.hold_end_tag_callback(global_object, replaced, function)?;
        let (Some(slot), None) = (slot, replaced) else {
            // No end tag can come, or the earlier call's handler now reads the new callback.
            return Ok(Some(this_value));
        };

        handlers.push(Box::new(move |end_tag| {
            let unit = LentUnit::EndTag(Unit::lend(end_tag));
            pipe.run_handler(pipe.take_end_tag_callback(slot), unit)
        }));
        el.set_user_data(slot);

        Ok(Some(this_value))
    }

    pub(crate) fn get_attribute(&self, name: &[u8]) -> Option<String> {
        let el = self.raw.get_mut()?;
        // A name that is not UTF-8 reads as `null`. It does not throw.
        let name = core::str::from_utf8(name).ok()?;
        el.get_attribute(name)
    }

    pub(crate) fn has_attribute<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: &[u8],
    ) -> bindgen::Result<'a, bool> {
        let Some(el) = self.raw.get_mut() else {
            return Ok(false);
        };
        let name = utf8_or_error(heap, name)?;
        Ok(el.has_attribute(name))
    }

    pub(crate) fn set_attribute<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        name: &[u8],
        value: &[u8],
    ) -> bindgen::Result<'a, Option<JsWrapper<'a, Self>>> {
        let Some(el) = self.raw.get_mut() else {
            return Ok(None);
        };

        // Their index would repeat or skip an attribute.
        self.detach_attribute_iterators();

        let name = utf8_or_error(heap, name)?;
        let value = utf8_or_error(heap, value)?;
        if let Err(e) = el.set_attribute(name, value) {
            return Err(lolhtml_error(heap, &e));
        }
        Ok(Some(this_value))
    }

    pub(crate) fn remove_attribute<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        name: &[u8],
    ) -> bindgen::Result<'a, Option<JsWrapper<'a, Self>>> {
        let Some(el) = self.raw.get_mut() else {
            return Ok(None);
        };

        // As in `set_attribute`.
        self.detach_attribute_iterators();

        let name = utf8_or_error(heap, name)?;
        el.remove_attribute(name);
        Ok(Some(this_value))
    }

    lol_ops! {
        content: before, after, prepend, append, replace, set_inner_content;
        plain: remove, remove_and_keep_content
    }

    pub(crate) fn get_tag_name(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(el) = self.raw.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&el.tag_name(), cx.global())
    }

    pub(crate) fn set_tag_name(&self, cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if let Some((el, name)) = setter_target(&self.raw, global, value)?
            && let Err(e) = el.set_tag_name(&name)
        {
            return Err(global.throw_value(create_lolhtml_error(global, &e)));
        }
        Ok(())
    }

    pub(crate) fn get_removed(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.removed())
    }

    pub(crate) fn get_self_closing(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.is_self_closing())
    }

    pub(crate) fn get_can_have_content(&self) -> Option<bool> {
        Some(self.raw.get_mut()?.can_have_content())
    }

    pub(crate) fn get_namespace_uri(&self) -> Option<&str> {
        Some(self.raw.get_mut()?.namespace_uri())
    }

    pub(crate) fn get_attributes(&self, cx: &mut JsScope<'_>) -> Option<JSValue> {
        let global_object = cx.global();
        if self.raw.is_detached() {
            return None;
        }

        let attr_iter = RefPtr::new(AttributeIterator {
            ref_count: Cell::new(1),
            element: Cell::new(Some(BackRef::new(self))),
            index: Cell::new(0),
        });
        self.attribute_iterators
            .with_mut(|v| v.push(attr_iter.clone()));
        Some(js_AttributeIterator::to_js(attr_iter, global_object))
    }
}

// ───────────────── input-stream JS-pump .then() reactions ────────────────

pub(crate) fn on_resolve_input_stream(_: &mut JsScope<'_>, _: JsLocal<'_>, context: &RewriterPipe) {
    context.end_from_pump(None);
}

pub(crate) fn on_reject_input_stream(
    _: &mut JsScope<'_>,
    reason: JsLocal<'_>,
    context: &RewriterPipe,
) {
    context.end_from_pump(Some(reason.to_js()));
}
