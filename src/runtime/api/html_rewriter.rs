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
        // Not `Locked`: with a noun the rewrite has either finished or thrown.
        let mut blob = js_Response::from_js(&out)
            .expect("the output is a Response")
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

#[derive(Clone, Copy)]
enum Call<'a> {
    Write(&'a [u8]),
    End,
    Resume(Then),
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
    /// The response's pending body, which nothing waits for yet.
    Unread,
    /// The pending body, which `.text()`, `Bun.write` or the like wants whole.
    Buffering,
    /// Kept alive by the cell's `outputStream` slot.
    Stream(BackRef<ByteStream>),
    Closed,
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
    /// Enters no context.
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
        if self.end_suspension().is_none() {
            return;
        }
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
            self.output.set(Output::Unread);
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

    /// Runs last: the frames of `src` may be on the stack, and `src` may be all that reaches the cell.
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
        if let Output::Stream(out) = self.output.replace(Output::Closed) {
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
            Output::Unread | Output::Buffering | Output::Closed => return Demand::More,
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
        let observed = out.sink.get().is_some()
            || out.pending.is_pending()
            || (self.cell.try_get())
                .and_then(js_HTMLRewriterTransform::output_stream_get_cached)
                .is_some_and(|stream| {
                    webcore::readable_stream::is_locked_value(stream, &self.global)
                });
        if observed {
            Demand::ReaderBehind
        } else {
            Demand::Unobserved
        }
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
        if let Some(err) = js_HTMLRewriterTransform::handler_error_take_cached(cell, cx.global()) {
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
            // Before the feed: a handler that suspends resumes into `end_rewrite`.
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
        if self.background_pull_armed.replace(false) && !self.is_blocked() {
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

    /// Input from a native source, or bytes from a JS one.
    pub fn write(&self, data: &StreamResult<'_>) -> Writable {
        let from_js = matches!(self.input_source.get(), SourceHandle::JSController(_));
        self.accept(data.slice(), data.is_done(), from_js)
    }

    /// `in_js_buffer`: a handler can shrink, transfer or overwrite `bytes`, so lol-html gets a copy.
    fn accept(&self, bytes: &[u8], is_last: bool, in_js_buffer: bool) -> Writable {
        let _pin = self.pin();
        if self.is_over() {
            return Writable::Done;
        }
        let taken = Writable::Owned(bytes.len() as BlobSizeType);
        // After the last chunk there is nothing to hold back, and `Backpressure` would delay `end()`.
        let held = if is_last {
            Writable::Owned(bytes.len() as BlobSizeType)
        } else {
            Writable::Backpressure(bytes.len() as BlobSizeType)
        };
        let blocked = self.is_blocked();
        let fed = if blocked || in_js_buffer || !self.pending_input.get().is_empty() {
            self.pending_input.with_mut(|v| v.extend_from_slice(bytes));
            if blocked {
                return held;
            }
            self.feed(&self.pending_input.take())
        } else {
            self.feed(bytes)
        };
        if !fed {
            // `Done` makes a native source let go of the sink, even if a handler also suspended.
            return if self.is_over() { Writable::Done } else { held };
        }
        if is_last || !self.may_continue(PullPacing::YieldIfUnobserved) {
            return held;
        }
        // No signal is coming for what arrived while lol-html was running.
        if !self.pending_input.get().is_empty() || self.input_end.get() == InputEnd::Ended {
            let ready = self.feed_held(PullPacing::YieldIfUnobserved);
            if self.input_end.get() == InputEnd::Ended {
                return taken;
            }
            if !ready {
                return if self.is_over() { Writable::Done } else { held };
            }
            if let SourceHandle::ByteStream(_) | SourceHandle::FileReader(_) =
                self.input_source.get()
            {
                // The inner write paused it. `ready()` from inside its own write would recurse.
                self.schedule_background_pull();
                return held;
            }
        }
        self.pending_flush.with_mut(|p| p.run());
        taken
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
        let over = self.state.with_mut(|state| match state {
            State::Running { then, .. } | State::Suspended { then, .. } => {
                *then = Then::Stop;
                None
            }
            State::Idle(_) | State::Done => Some(core::mem::replace(state, State::Done)),
        });
        drop(over);
        self.release_handlers();
    }

    /// Lets go of a direct stream's `pull()` that waits in `flush(true)`, so the pump promise can settle.
    fn release_flush(&self) {
        self.pending_flush.with_mut(|p| {
            p.result = Writable::Done;
            p.run();
        });
    }

    /// Runs one lol-html call and whatever its result asks for. `true`: idle again, ready for input.
    fn drive(&self, mut rewriter: Box<LolRewriter>, call: Call<'_>) -> bool {
        // A handler can cut every other path to the cell while lol-html has handlers left to run.
        let _cell = jsc::EnsureStillAlive(self.cell.get_or_undefined());
        self.state.set(State::Running {
            then: match call {
                Call::Write(_) => Then::Continue,
                Call::End => Then::Finish,
                Call::Resume(then) => then,
            },
            suspending: None,
        });
        let result = match call {
            Call::Write(bytes) => rewriter.write(bytes),
            // Not the consuming `end`: a document-end handler can suspend.
            Call::End => rewriter.end_mut(),
            Call::Resume(_) => rewriter.resume(),
        };
        // Before the flush, which runs JS that can use the unit.
        if let State::Running {
            suspending: Some(unit),
            ..
        } = self.state.get()
        {
            unit.point_at(Some(&mut rewriter));
        }
        // One chunk per call: each `on_data` may be a socket write or a downstream rewriter's `write`.
        self.flush_output();
        let State::Running { then, suspending } = self.state.replace(State::Done) else {
            unreachable!("only `drive` leaves `Running`");
        };
        if then == Then::Stop {
            self.release_handlers();
        }
        match (result, then) {
            (Ok(()), Then::Continue) => {
                self.state.set(State::Idle(rewriter));
                return true;
            }
            (Ok(()), Then::Finish) => {
                drop(rewriter);
                self.finish();
            }
            (Ok(()), Then::Stop) => {}
            (Err(RewritingError::Suspended), _) => {
                let unit = suspending.expect("lol-html suspended without a pending handler");
                self.state.set(State::Suspended {
                    then,
                    unit,
                    rewriter,
                });
                self.begin_suspension();
            }
            (Err(e), _) => self.on_rewriting_error(&e, then),
        }
        false
    }

    fn drive_idle(&self, call: Call<'_>) -> bool {
        let State::Idle(rewriter) = self.state.replace(State::Done) else {
            unreachable!("input reaches lol-html only while it is idle");
        };
        self.drive(rewriter, call)
    }

    /// The rewrite is over: an output `Response` that outlives it stops retaining the handlers.
    fn release_handlers(&self) {
        if matches!(self.state.get(), State::Running { .. }) {
            // lol-html runs the handlers for the rest of this chunk. `drive` calls again.
            return;
        }
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

    /// The function to call and its `this`. `None`: a termination is pending, and stays so.
    fn take_callback(&self, callback: HandlerCallback) -> Option<(JSValue, JSValue)> {
        let global = &*self.global;
        // `drive` keeps the cell alive, and its arrays stay until lol-html returns.
        let cell = self.cell.try_get()?;
        match callback {
            HandlerCallback::Listed {
                callback,
                this_object,
            } => {
                let list =
                    HandlerList::existing(js_HTMLRewriterTransform::handlers_get_cached(cell))?;
                let callback = list.get(global, callback).ok()?;
                Some((callback, list.get(global, this_object).ok()?))
            }
            HandlerCallback::EndTag(slot) => {
                let list = js_HTMLRewriterTransform::end_tag_handlers_get_cached(cell)
                    .filter(|list| list.is_cell())?;
                let callback = list.get_direct_index(global, slot.0).ok()?;
                list.put_index(global, slot.0, JSValue::UNDEFINED).ok()?;
                self.free_end_tag_slots.with_mut(|free| free.push(slot));
                debug_assert!(callback.is_cell(), "HTMLRewriter end-tag slot is empty");
                callback.is_cell().then_some((callback, JSValue::ZERO))
            }
        }
    }

    fn flush_output(&self) {
        if let Output::Stream(out) = self.output.get()
            && !self.output_buffer.get().is_empty()
        {
            out.on_data(StreamResult::Owned(self.output_buffer.take()));
        }
    }

    /// `false`: a handler suspended, or the rewrite is over.
    fn feed(&self, bytes: &[u8]) -> bool {
        self.drive_idle(Call::Write(bytes))
    }

    fn end_rewrite(&self) {
        self.drive_idle(Call::End);
    }

    fn finish(&self) {
        self.release_handlers();
        self.pending_flush.with_mut(|p| p.run());
        if let Output::Stream(out) = self.output.get() {
            out.on_data(StreamResult::Done);
            self.detach_output();
            return;
        }
        let Some(response) = self.response.get().as_deref() else {
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

    /// Feeds the idle rewriter what is held, and ends it after the last of it. `true`: ready for more.
    fn feed_held(&self, mut pacing: PullPacing) -> bool {
        loop {
            let held = self.pending_input.take();
            if !held.is_empty() && !self.feed(&held) {
                return false;
            }
            // Handlers and readers may have written meanwhile.
            let drained = self.pending_input.get().is_empty();
            // Backpressure only gates more input: finishing frees the parser and settles the body.
            if drained && self.input_end.get() == InputEnd::Ended {
                self.end_rewrite();
                return false;
            }
            if !self.may_continue(pacing) {
                return false;
            }
            if drained {
                return true;
            }
            pacing = PullPacing::YieldIfUnobserved;
        }
    }

    /// The rewriter is idle and nothing holds it back.
    fn advance(&self, pacing: PullPacing) {
        if self.feed_held(pacing) {
            self.background_pull_armed.set(false);
            self.input_source.get().ready(None, None);
            self.pending_flush.with_mut(|p| p.run());
        }
    }

    #[cold]
    fn on_rewriting_error(&self, e: &RewritingError, then: Then) {
        let captured = self.take_handler_error();
        // The call can hit the memory limit after a handler suspended. lol-html parks nothing then.
        self.take_suspension_promise();
        if then == Then::Stop {
            return;
        }
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

    fn begin_suspension(&self) {
        // The context roots the cell, and queues `abandon_suspension` if it is collected with the promise.
        let promise = (self.take_suspension_promise()).expect("suspension promise slot empty");
        let cell = self.cell.get_or_undefined();
        let context = native_promise_context::create(&self.global, self.ref_guard(), cell);
        promise.then_with_value(
            &self.global,
            context,
            Bun__HTMLRewriter__onHandlerResolve,
            Bun__HTMLRewriter__onHandlerReject,
        );
    }

    /// For whoever holds the promise context. Detaches the unit. `None`: the rewrite is over.
    fn end_suspension(&self) -> Option<(Box<LolRewriter>, Then)> {
        let State::Suspended {
            then,
            unit,
            rewriter,
        } = self.state.replace(State::Done)
        else {
            unreachable!("one promise context per suspension");
        };
        drop(unit);
        (then != Then::Stop).then_some((rewriter, then))
    }

    /// Put `err` on the output `Response`'s body / ByteStream. Not for a rewrite that was over before.
    fn fail(&self, mut err: webcore::body::ValueError) {
        let _pin = self.pin();
        self.stop();
        let src = self.detach_input_source(Some(err.to_js(&self.global)));
        self.release_flush();
        // Output emitted before the failure still precedes the error.
        self.flush_output();
        match self.output.get() {
            Output::Stream(out) => {
                out.on_data(StreamResult::Err(err.to_stream_error(&self.global)));
            }
            Output::Unread | Output::Buffering => {
                if let Some(response) = self.response.get().as_deref() {
                    let _ = (response.get_body_value()).to_error_instance(err, &self.global);
                }
            }
            // The reader cancelled from inside the input's `cancel()` or the flush.
            Output::Closed => {}
        }
        self.detach_output();
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
        RewriterPipe::write(this, data)
    }
    fn write_utf16(this: &mut Self::Entered<'_>, text: &[u16]) -> Writable {
        let mut buf = Vec::new();
        let _ = buf.write_utf16(text);
        this.accept(&buf, false, false)
    }
    fn write_latin1(this: &mut Self::Entered<'_>, data: &StreamResult<'_>) -> Writable {
        let bytes = data.slice();
        if bun_core::strings::is_all_ascii(bytes) {
            return this.accept(bytes, false, false);
        }
        let mut buf = Vec::new();
        let _ = buf.write_latin1(bytes);
        this.accept(&buf, false, false)
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
        if this.pending_flush.get().state == streams::PendingState::Pending {
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
    if let Some((rewriter, then)) = pipe.end_suspension()
        && pipe.drive(rewriter, Call::Resume(then))
    {
        pipe.advance(PullPacing::YieldIfUnobserved);
    }
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
    if pipe.end_suspension().is_some() {
        pipe.fail(webcore::body::ValueError::JSValue(
            jsc::strong::Optional::create(reason.to_js(), global),
        ));
    }
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
            handlers = handlers
                .comments(move |c: &mut lol::Comment| h.run(LentUnit::Comment(Unit::lend(c))));
        }
        if let Some(h) = self.on_text_callback.map(bound) {
            handlers = handlers
                .text(move |t: &mut lol::TextChunk| h.run(LentUnit::TextChunk(Unit::lend(t))));
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
            handlers = handlers
                .comments(move |c: &mut lol::Comment| h.run(LentUnit::Comment(Unit::lend(c))));
        }
        if let Some(h) = self.on_text_callback.map(bound) {
            handlers = handlers
                .text(move |t: &mut lol::TextChunk| h.run(LentUnit::TextChunk(Unit::lend(t))));
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

/// Where a handler's callback lives.
#[derive(Clone, Copy)]
enum HandlerCallback {
    /// Given to `on()` / `onDocument()`: in the [`HandlerList`], called on its handler object.
    Listed {
        callback: HandlerSlot,
        this_object: HandlerSlot,
    },
    /// Given to `element.onEndTag()`: in the cell's `endTagHandlers` array until its one run.
    EndTag(EndTagSlot),
}

/// The pipe whose lol-html calls run it, the callback, and its handler object.
#[derive(Clone, Copy)]
struct BoundHandler(BackRef<RewriterPipe>, HandlerSlot, HandlerSlot);

impl BoundHandler {
    fn run(self, unit: LentUnit) -> lol_html::HandlerResult {
        let Self(pipe, callback, this_object) = self;
        let callback = HandlerCallback::Listed {
            callback,
            this_object,
        };
        pipe.run_handler(callback, unit)
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

impl RewriterPipe {
    fn run_handler(&self, callback: HandlerCallback, unit: LentUnit) -> lol_html::HandlerResult {
        jsc::mark_binding();
        let global = &*self.global;
        // Reaches JS as it is when no error was recorded.
        let stop = || Err("The rewriter has been stopped.".into());
        let fail = |err| {
            self.set_handler_error(err);
            stop()
        };

        let Some((callback, this_object)) = self.take_callback(callback) else {
            return stop();
        };

        // Not `try_take_exception()`: the exception checker wants the call's throw seen by an enclosing scope.
        bun_jsc::top_scope!(scope, global);
        let result = callback.call(global, this_object, &[unit.to_js(global)]);
        if let Some(exception) = scope.exception() {
            let exception = JSValue::from_cell(exception.as_ptr());
            // A termination is not this handler's error: it stays pending to unwind whatever drives the rewriter.
            if !exception.is_termination_exception() {
                self.set_handler_error(exception.to_error().unwrap_or(exception));
            }
            scope.clear_exception_except_termination();
            return stop();
        }
        let Ok(result) = result else {
            return stop();
        };

        if result.is_undefined_or_null() {
            return Ok(());
        }
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
            return stop();
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
                let cell = (self.cell.try_get())
                    .expect("HTMLRewriter handler ran without the Transform cell");
                js_HTMLRewriterTransform::suspension_promise_set_cached(cell, global, result);
                self.state.with_mut(|state| match state {
                    State::Running { suspending, .. } => *suspending = Some(unit),
                    _ => unreachable!("handlers run inside `drive`"),
                });
                Err(Box::new(lol_html::SuspensionRequest))
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
        let Some(el) = self.raw.get_mut() else {
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

        // Only `invalidate()` clears `pipe`, and it detaches `raw` in the same call.
        let pipe = self.pipe.get().expect("attached Element without its pipe");
        let slot = pipe.hold_end_tag_callback(global_object, replaced, function)?;
        let (Some(slot), None) = (slot, replaced) else {
            // No end tag can come, or the earlier call's handler now reads the new callback.
            return Ok(Some(this_value));
        };

        handlers.push(Box::new(move |end_tag| {
            let unit = LentUnit::EndTag(Unit::lend(end_tag));
            pipe.run_handler(HandlerCallback::EndTag(slot), unit)
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
