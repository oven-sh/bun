//! HTMLRewriter API — wraps lol-html for JS.
//!
//! Ported from src/runtime/api/html_rewriter.zig.

use core::cell::Cell;
use core::ptr::NonNull;
use std::io::Write as _;
use std::rc::Rc;

use bun_collections::{ByteList, LinearFifo};
use bun_core::MutableString;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, SystemError,
    TopExceptionScope, VirtualMachine, ZigString,
};
use bun_lolhtml as lolhtml;
use bun_runtime::webcore::{self, Blob, Body, Response, Signal, Sink, StreamResult};
use bun_str::String as BunString;
use bun_sys;

type SelectorMap = Vec<*mut lolhtml::HTMLSelector>;

// ───────────────────────────── LOLHTMLContext ─────────────────────────────

pub struct LOLHTMLContext {
    pub selectors: SelectorMap,
    pub element_handlers: Vec<Box<ElementHandler>>,
    pub document_handlers: Vec<Box<DocumentHandler>>,
}

impl Default for LOLHTMLContext {
    fn default() -> Self {
        Self {
            selectors: Vec::new(),
            element_handlers: Vec::new(),
            document_handlers: Vec::new(),
        }
    }
}

impl Drop for LOLHTMLContext {
    fn drop(&mut self) {
        for selector in self.selectors.drain(..) {
            // SAFETY: selector was allocated by LOLHTML.HTMLSelector.parse and is owned here.
            unsafe { lolhtml::HTMLSelector::deinit(selector) };
        }
        // element_handlers / document_handlers: Box<_> drops via Drop impls below.
    }
}

// ───────────────────────────── HTMLRewriter ──────────────────────────────

#[bun_jsc::JsClass]
pub struct HTMLRewriter {
    pub builder: *mut lolhtml_sys::HTMLRewriterBuilder,
    pub context: Rc<LOLHTMLContext>,
}

impl HTMLRewriter {
    #[bun_jsc::host_fn]
    pub fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut HTMLRewriter> {
        let rewriter = Box::into_raw(Box::new(HTMLRewriter {
            builder: lolhtml::HTMLRewriter::Builder::init(),
            context: Rc::new(LOLHTMLContext::default()),
        }));
        bun_core::analytics::Features::html_rewriter_inc();
        Ok(rewriter)
    }

    pub fn on_(
        &mut self,
        global: &JSGlobalObject,
        selector_name: ZigString,
        call_frame: &CallFrame,
        listener: JSValue,
    ) -> JsResult<JSValue> {
        let mut selector_slice: Vec<u8> = Vec::new();
        write!(&mut selector_slice, "{}", selector_name).ok();

        let selector = match lolhtml::HTMLSelector::parse(&selector_slice) {
            Ok(s) => s,
            Err(_) => return global.throw_value(create_lolhtml_error(global)),
        };
        let selector_guard = scopeguard::guard(selector, |s| unsafe {
            // SAFETY: selector owned by us until appended to context.selectors below.
            lolhtml::HTMLSelector::deinit(s)
        });

        let handler_ = ElementHandler::init(global, listener)?;
        let mut handler = Box::new(handler_);
        let handler_ptr: *mut ElementHandler = &mut *handler;

        // SAFETY: builder is a valid lol-html builder; handler_ptr stays alive
        // because we push it into self.context.element_handlers below.
        let res = unsafe {
            lolhtml::HTMLRewriter::Builder::add_element_content_handlers(
                self.builder,
                *selector_guard,
                ElementHandler::on_element,
                if handler.on_element_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
                ElementHandler::on_comment,
                if handler.on_comment_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
                ElementHandler::on_text,
                if handler.on_text_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
            )
        };
        if res.is_err() {
            // errdefer: drop handler (Box drop runs ElementHandler::drop) + selector_guard fires.
            return global.throw_value(create_lolhtml_error(global));
        }

        let selector = scopeguard::ScopeGuard::into_inner(selector_guard);
        // TODO(port): KNOWN-WRONG — Rc::get_mut returns None (→ panic) once
        // begin_transform() has cloned the Rc, but the Zig mutates through
        // *LOLHTMLContext unconditionally and HTMLRewriter is reusable after
        // transform(). Phase B: switch context to bun_ptr::IntrusiveRc<LOLHTMLContext>
        // (or Rc<RefCell<_>>) so push() works through a shared handle.
        let ctx = Rc::get_mut(&mut self.context)
            .expect("TODO(port): context shared after transform(); see note above");
        ctx.selectors.push(selector);
        ctx.element_handlers.push(handler);
        Ok(call_frame.this())
    }

    pub fn on_document_(
        &mut self,
        global: &JSGlobalObject,
        listener: JSValue,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let handler_ = DocumentHandler::init(global, listener)?;
        let mut handler = Box::new(handler_);
        let handler_ptr: *mut DocumentHandler = &mut *handler;

        // If this fails, subsequent calls to write or end should throw
        // SAFETY: builder is valid; handler_ptr lives in context.document_handlers.
        unsafe {
            lolhtml::HTMLRewriter::Builder::add_document_content_handlers(
                self.builder,
                DocumentHandler::on_doc_type,
                if handler.on_doc_type_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
                DocumentHandler::on_comment,
                if handler.on_comment_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
                DocumentHandler::on_text,
                if handler.on_text_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
                DocumentHandler::on_end,
                if handler.on_end_callback.is_some() { handler_ptr } else { core::ptr::null_mut() },
            );
        }

        // TODO(port): KNOWN-WRONG — see on_() above; Rc::get_mut panics once
        // begin_transform() has cloned the Rc. Phase B: IntrusiveRc / RefCell.
        let ctx = Rc::get_mut(&mut self.context)
            .expect("TODO(port): context shared after transform(); see note above");
        ctx.document_handlers.push(handler);
        Ok(call_frame.this())
    }

    pub fn finalize(this: *mut HTMLRewriter) {
        // SAFETY: called by JSC codegen finalize on the mutator thread; `this`
        // is the m_ctx payload allocated in `constructor`.
        unsafe {
            (*this).finalize_without_destroy();
            drop(Box::from_raw(this));
        }
    }

    pub fn finalize_without_destroy(&mut self) {
        // context: Rc drop happens via field drop; builder needs explicit FFI deinit.
        // SAFETY: builder was created by Builder::init() and not yet freed.
        unsafe { lolhtml::HTMLRewriter::Builder::deinit(self.builder) };
        // TODO(port): Zig calls context.deref() here explicitly; with Rc the
        // drop happens when HTMLRewriter is dropped. If finalize_without_destroy
        // is called without immediate drop, we'd want to swap context to a
        // fresh Rc. Phase B: verify call sites.
    }

    pub fn begin_transform(&mut self, global: &JSGlobalObject, response: *mut Response) -> JsResult<JSValue> {
        let new_context = Rc::clone(&self.context);
        BufferOutputSink::init(new_context, global, response, self.builder)
    }

    pub fn transform_(&mut self, global: &JSGlobalObject, response_value: JSValue) -> JsResult<JSValue> {
        if let Some(response) = response_value.as_::<Response>() {
            // SAFETY: response is the m_ctx of a live JS Response (response_value
            // is on the stack, conservatively scanned).
            let body_value = unsafe { (*response).get_body_value() };
            if matches!(*body_value, Body::Value::Used) {
                return global.throw_invalid_arguments("Response body already used");
            }
            let out = self.begin_transform(global, response)?;
            // Check if the returned value is an error and throw it properly
            if let Some(err) = out.to_error() {
                return global.throw_value(err);
            }
            return Ok(out);
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        enum ResponseKind {
            String,
            ArrayBuffer,
            Other,
        }
        let kind: ResponseKind = 'brk: {
            if response_value.is_string() {
                break 'brk ResponseKind::String;
            } else if response_value.js_type().is_typed_array_or_array_buffer() {
                break 'brk ResponseKind::ArrayBuffer;
            } else {
                break 'brk ResponseKind::Other;
            }
        };

        if kind != ResponseKind::Other {
            let body_value = webcore::Body::extract(global, response_value)?;
            let resp = Box::into_raw(Box::new(Response::init(
                webcore::ResponseInit { status_code: 200, ..Default::default() },
                body_value,
                BunString::empty(),
                false,
            )));
            // defer resp.finalize();
            let _resp_guard = scopeguard::guard(resp, |r| {
                // SAFETY: r is the Box::into_raw allocation from above; finalize
                // takes ownership and frees it exactly once.
                unsafe { Response::finalize(r) }
            });

            let out_response_value = self.begin_transform(global, resp)?;
            // Check if the returned value is an error and throw it properly
            if let Some(err) = out_response_value.to_error() {
                return global.throw_value(err);
            }
            out_response_value.ensure_still_alive();
            let Some(out_response) = out_response_value.as_::<Response>() else {
                return Ok(out_response_value);
            };
            // SAFETY: out_response is the m_ctx of out_response_value (kept alive
            // on the stack via ensure_still_alive above).
            let mut blob = unsafe { (*out_response).get_body_value().use_as_any_blob_allow_non_utf8_string() };

            let _out_guard = scopeguard::guard((out_response_value, out_response), |(v, r)| {
                // SAFETY: r is the m_ctx pointer detached from v here, then
                // finalized exactly once (Zig: dangerouslySetPtr + finalize).
                unsafe {
                    let _ = Response::js::dangerously_set_ptr(v, core::ptr::null_mut());
                    // Manually invoke the finalizer to ensure it does what we want
                    Response::finalize(r);
                }
            });

            return match kind {
                ResponseKind::String => blob.to_string(global, webcore::Lifetime::Transfer),
                ResponseKind::ArrayBuffer => blob.to_array_buffer(global, webcore::Lifetime::Transfer),
                ResponseKind::Other => unreachable!(),
            };
        }

        global.throw_invalid_arguments("Expected Response or Body")
    }

    // TODO(port): host_fn.wrapInstanceMethod codegen — `on`, `onDocument`,
    // `transform` are produced by `#[bun_jsc::host_fn(method)]` wrappers
    // around `on_`, `on_document_`, `transform_` (argument extraction is
    // handled by the macro).
}

// ─────────────────────── HTMLRewriterLoader ──────────────────────────────

pub struct HTMLRewriterLoader {
    pub rewriter: *mut lolhtml_sys::HTMLRewriter,
    pub finalized: bool,
    pub context: LOLHTMLContext,
    pub chunk_size: usize,
    pub failed: bool,
    pub output: webcore::Sink,
    pub signal: webcore::Signal,
    pub backpressure: LinearFifo<u8>,
}

impl HTMLRewriterLoader {
    pub fn finalize(&mut self) {
        if self.finalized {
            return;
        }
        // SAFETY: rewriter created via builder.build(); not yet freed.
        unsafe { lolhtml::HTMLRewriter::deinit(self.rewriter) };
        self.backpressure = LinearFifo::new();
        self.finalized = true;
    }

    pub fn fail(&mut self, err: bun_sys::Error) {
        self.signal.close(Some(err));
        self.output.end(Some(err));
        self.failed = true;
        self.finalize();
    }

    pub fn connect(&mut self, signal: webcore::Signal) {
        self.signal = signal;
    }

    pub fn write_to_destination(&mut self, bytes: &[u8]) {
        if self.backpressure.count() > 0 {
            if self.backpressure.write(bytes).is_err() {
                self.fail(bun_sys::Error::oom());
                self.finalize();
            }
            return;
        }

        let write_result = self
            .output
            .write(StreamResult::Temporary(ByteList::from_borrowed_slice_dangerous(bytes)));

        match write_result {
            StreamResult::Writable::Err(err) => {
                self.fail(err);
            }
            StreamResult::Writable::OwnedAndDone(_)
            | StreamResult::Writable::TemporaryAndDone(_)
            | StreamResult::Writable::IntoArrayAndDone(_) => {
                self.done();
            }
            StreamResult::Writable::Pending(pending) => {
                pending.apply_backpressure(&mut self.output, pending, bytes);
            }
            StreamResult::Writable::IntoArray(_)
            | StreamResult::Writable::Owned(_)
            | StreamResult::Writable::Temporary(_) => {
                self.signal.ready(
                    if self.chunk_size > 0 { Some(self.chunk_size) } else { None },
                    None,
                );
            }
        }
    }

    pub fn done(&mut self) {
        self.output.end(None);
        self.signal.close(None);
        self.finalize();
    }

    pub fn setup(
        &mut self,
        builder: *mut lolhtml_sys::HTMLRewriterBuilder,
        context: *mut LOLHTMLContext,
        size_hint: Option<usize>,
        output: webcore::Sink,
    ) -> Option<&'static [u8]> {
        let chunk_size = size_hint.unwrap_or(16384).max(1024);
        // SAFETY: builder valid; `self` outlives the rewriter (deinit'd in finalize()).
        let built = unsafe {
            lolhtml::HTMLRewriter::Builder::build(
                builder,
                lolhtml::Encoding::UTF8,
                lolhtml::MemorySettings {
                    preallocated_parsing_buffer_size: chunk_size,
                    max_allowed_memory_usage: u32::MAX as usize,
                },
                false,
                self as *mut Self,
                Self::write_to_destination,
                Self::done,
            )
        };
        self.rewriter = match built {
            Ok(r) => r,
            Err(_) => {
                output.end(None);
                // TODO(port): lifetime — Zig returns a borrowed slice from
                // lol-html's threadlocal last-error buffer. Treat as 'static
                // for now; caller must consume before next lol-html call.
                return Some(lolhtml::HTMLString::last_error().slice());
            }
        };

        self.chunk_size = chunk_size;
        // TODO(port): Zig copies `*context` by value into self.context. With Rc
        // semantics this would be a clone; here LOLHTMLContext is owned by
        // value. Phase B: confirm whether HTMLRewriterLoader is dead code (it
        // is not referenced by HTMLRewriter.transform).
        // SAFETY: context points at a fully-initialized LOLHTMLContext owned by
        // the caller; Zig does a struct copy (`self.context = context.*`).
        self.context = unsafe { core::ptr::read(context) };
        self.output = output;

        None
    }

    pub fn sink(&mut self) -> webcore::Sink {
        webcore::Sink::init(self)
    }

    fn write_bytes<const DEINIT: bool>(&mut self, bytes: ByteList) -> Option<bun_sys::Error> {
        // SAFETY: rewriter valid (setup() succeeded, not yet finalized).
        if unsafe { lolhtml::HTMLRewriter::write(self.rewriter, bytes.slice()) }.is_err() {
            return Some(bun_sys::Error {
                errno: 1,
                // TODO: make this a union
                path: Box::<[u8]>::from(lolhtml::HTMLString::last_error().slice()),
                ..Default::default()
            });
        }
        if DEINIT {
            // PERF(port): was comptime monomorphization — profile in Phase B
            bytes.deinit();
        }
        None
    }

    pub fn write(&mut self, data: webcore::StreamResult) -> webcore::StreamResult::Writable {
        match data {
            StreamResult::Owned(bytes) => {
                let len = bytes.len();
                if let Some(err) = self.write_bytes::<true>(bytes) {
                    return StreamResult::Writable::Err(err);
                }
                StreamResult::Writable::Owned(len)
            }
            StreamResult::OwnedAndDone(bytes) => {
                let len = bytes.len();
                if let Some(err) = self.write_bytes::<true>(bytes) {
                    return StreamResult::Writable::Err(err);
                }
                StreamResult::Writable::OwnedAndDone(len)
            }
            StreamResult::TemporaryAndDone(bytes) => {
                let len = bytes.len();
                if let Some(err) = self.write_bytes::<false>(bytes) {
                    return StreamResult::Writable::Err(err);
                }
                StreamResult::Writable::TemporaryAndDone(len)
            }
            StreamResult::Temporary(bytes) => {
                let len = bytes.len();
                if let Some(err) = self.write_bytes::<false>(bytes) {
                    return StreamResult::Writable::Err(err);
                }
                StreamResult::Writable::Temporary(len)
            }
            _ => unreachable!(),
        }
    }

    pub fn write_utf16(&mut self, data: webcore::StreamResult) -> webcore::StreamResult::Writable {
        webcore::Sink::UTF8Fallback::write_utf16(self, data, Self::write)
    }

    pub fn write_latin1(&mut self, data: webcore::StreamResult) -> webcore::StreamResult::Writable {
        webcore::Sink::UTF8Fallback::write_latin1(self, data, Self::write)
    }
}

// ───────────────────────── BufferOutputSink ──────────────────────────────

pub struct BufferOutputSink {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self crosses FFI as lol-html userdata).
    ref_count: Cell<u32>,
    pub global: &'static JSGlobalObject, // JSC_BORROW
    pub bytes: MutableString,
    pub rewriter: *mut lolhtml_sys::HTMLRewriter, // null when unset
    pub context: Rc<LOLHTMLContext>,
    pub response: *mut Response, // BORROW_FIELD: kept alive by response_value Strong
    pub response_value: Strong,
    pub body_value_bufferer: Option<webcore::Body::ValueBufferer>,
    pub tmp_sync_error: Option<NonNull<JSValue>>, // TODO(port): lifetime — points at a stack local in init()
}

impl BufferOutputSink {
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount; `this` is a valid heap allocation from Box::into_raw.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 {
                drop(Box::from_raw(this));
            }
        }
    }

    pub fn init(
        context: Rc<LOLHTMLContext>,
        global: &JSGlobalObject,
        original: *mut Response,
        builder: *mut lolhtml_sys::HTMLRewriterBuilder,
    ) -> JsResult<JSValue> {
        // TODO(port): JSC_BORROW lifetime — Zig stores *JSGlobalObject by raw
        // pointer; storing &'static here is a Phase-A approximation.
        // SAFETY: JSGlobalObject outlives the sink (VM-lifetime; sink is freed
        // before VM teardown).
        let global_static: &'static JSGlobalObject = unsafe { &*(global as *const _) };

        let sink = Box::into_raw(Box::new(BufferOutputSink {
            ref_count: Cell::new(1),
            global: global_static,
            bytes: MutableString::init_empty(),
            rewriter: core::ptr::null_mut(),
            context,
            response: core::ptr::null_mut(),
            response_value: Strong::empty(),
            body_value_bufferer: None,
            tmp_sync_error: None,
        }));
        // defer sink.deref();
        let _sink_guard = scopeguard::guard(sink, |s| BufferOutputSink::deref(s));
        // SAFETY: sink was just allocated via Box::into_raw above; refcount==1
        // and no other alias exists yet.
        let sink_ref = unsafe { &mut *sink };

        let result = Box::into_raw(Box::new(Response::init(
            webcore::ResponseInit { status_code: 200, ..Default::default() },
            webcore::Body {
                value: Body::Value::Locked(Body::PendingValue {
                    global: global_static,
                    task: sink as *mut core::ffi::c_void,
                    ..Default::default()
                }),
                ..Default::default()
            },
            BunString::empty(),
            false,
        )));

        sink_ref.response = result;
        let mut sink_error: JSValue = JSValue::ZERO;
        // SAFETY: original is a live *Response passed from begin_transform; its
        // JS wrapper is on the caller's stack.
        let input_size = unsafe { (*original).get_body_len() };
        let vm = global.bun_vm();

        // Since we're still using vm.waitForPromise, we have to also override
        // the error rejection handler. That way, we can propagate errors to the
        // caller.
        let scope = vm.unhandled_rejection_scope();
        let prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
        vm.unhandled_pending_rejection_to_capture = Some(NonNull::from(&mut sink_error));
        sink_ref.tmp_sync_error = Some(NonNull::from(&mut sink_error));
        vm.on_unhandled_rejection = VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        let _vm_guard = scopeguard::guard((), |_| {
            sink_error.ensure_still_alive();
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;
            scope.apply(vm);
        });

        // SAFETY: builder valid; sink outlives rewriter (deinit in Drop).
        let built = unsafe {
            lolhtml::HTMLRewriter::Builder::build(
                builder,
                lolhtml::Encoding::UTF8,
                lolhtml::MemorySettings {
                    preallocated_parsing_buffer_size: if input_size == Blob::MAX_SIZE {
                        1024
                    } else {
                        input_size.max(1024)
                    },
                    max_allowed_memory_usage: u32::MAX as usize,
                },
                false,
                sink,
                BufferOutputSink::write,
                BufferOutputSink::done,
            )
        };
        sink_ref.rewriter = match built {
            Ok(r) => r,
            Err(_) => {
                // SAFETY: result was Box::into_raw'd above and never handed to
                // JS; finalize takes ownership and frees it once.
                unsafe { Response::finalize(result) };
                return Ok(create_lolhtml_error(global));
            }
        };

        // SAFETY: result and original are both live *Response (result allocated
        // above, original kept alive by caller); no aliasing &mut exists.
        unsafe {
            (*result).set_init(
                (*original).get_method(),
                (*original).get_init_status_code(),
                (*original).get_init_status_text().clone(),
            );

            // https://github.com/oven-sh/bun/issues/3334
            if let Some(headers) = (*original).get_init_headers() {
                (*result).set_init_headers(headers.clone_this(global)?);
            }
        }

        // Hold off on cloning until we're actually done.
        // SAFETY: sink_ref.response == result (set above), live heap allocation.
        let response_js_value = unsafe { (*sink_ref.response).to_js(sink_ref.global) };
        sink_ref.response_value.set(global, response_js_value);

        // SAFETY: result/original are live *Response (see SAFETY note above).
        unsafe { (*result).set_url((*original).get_url().clone()) };

        // SAFETY: original is a live *Response kept alive by caller.
        let value = unsafe { (*original).get_body_value() };
        // SAFETY: original is a live *Response kept alive by caller.
        let owned_readable_stream = unsafe { (*original).get_body_readable_stream(sink_ref.global) };
        sink_ref.ref_();
        sink_ref.body_value_bufferer = Some(webcore::Body::ValueBufferer::init(
            sink as *mut core::ffi::c_void,
            Self::on_finished_buffering as *const _,
            sink_ref.global,
        ));
        response_js_value.ensure_still_alive();

        if let Err(buffering_error) = sink_ref
            .body_value_bufferer
            .as_mut()
            .unwrap()
            .run(value, owned_readable_stream)
        {
            BufferOutputSink::deref(sink);
            return Ok(match buffering_error {
                e if e == bun_core::err!("StreamAlreadyUsed") => {
                    let err = SystemError {
                        code: BunString::static_("ERR_STREAM_ALREADY_FINISHED"),
                        message: BunString::static_("Stream already used, please create a new one"),
                        ..Default::default()
                    };
                    err.to_error_instance(sink_ref.global)
                }
                _ => {
                    let err = SystemError {
                        code: BunString::static_("ERR_STREAM_CANNOT_PIPE"),
                        message: BunString::static_("Failed to pipe stream"),
                        ..Default::default()
                    };
                    err.to_error_instance(sink_ref.global)
                }
            });
        }

        // sync error occurs
        if !sink_error.is_empty() {
            sink_error.ensure_still_alive();
            sink_error.unprotect();
            return Ok(sink_error);
        }

        response_js_value.ensure_still_alive();
        Ok(response_js_value)
    }

    pub fn on_finished_buffering(
        sink: *mut BufferOutputSink,
        bytes: &[u8],
        js_err: Option<webcore::Body::Value::ValueError>,
        is_async: bool,
    ) {
        let _g = scopeguard::guard(sink, |s| BufferOutputSink::deref(s));
        // SAFETY: sink was ref'd in init() before scheduling this callback;
        // refcount > 0 so the allocation is live.
        let sink = unsafe { &mut *sink };

        if let Some(err) = js_err {
            // SAFETY: sink.response is the heap Response allocated in init() and
            // kept alive by sink.response_value (Strong root).
            let sink_body_value = unsafe { (*sink.response).get_body_value() };
            if matches!(sink_body_value, Body::Value::Locked(l)
                if l.task as usize == sink as *mut _ as usize && l.promise.is_none())
            {
                if let Body::Value::Locked(l) = sink_body_value {
                    l.readable.deinit();
                }
                *sink_body_value = Body::Value::Empty;
                // is there a pending promise?
                // we will need to reject it
            } else if matches!(sink_body_value, Body::Value::Locked(l)
                if l.task as usize == sink as *mut _ as usize && l.promise.is_some())
            {
                if let Body::Value::Locked(l) = sink_body_value {
                    l.on_receive_value = None;
                    l.task = core::ptr::null_mut();
                }
            }
            if is_async {
                let _ = sink_body_value.to_error_instance(err.dupe(sink.global), sink.global);
                // TODO: properly propagate exception upwards
            } else {
                let ret_err = create_lolhtml_error(sink.global);
                ret_err.ensure_still_alive();
                ret_err.protect();
                // SAFETY: tmp_sync_error points at sink_error stack local in init();
                // is_async == false ⇒ init() is still on the stack.
                unsafe { *sink.tmp_sync_error.unwrap().as_ptr() = ret_err };
            }
            // SAFETY: rewriter set by init().
            let _ = unsafe { lolhtml::HTMLRewriter::end(sink.rewriter) };
            return;
        }

        if let Some(ret_err) = sink.run_output_sink(bytes, is_async) {
            ret_err.ensure_still_alive();
            ret_err.protect();
            // SAFETY: see above.
            unsafe { *sink.tmp_sync_error.unwrap().as_ptr() = ret_err };
        }
    }

    pub fn run_output_sink(&mut self, bytes: &[u8], is_async: bool) -> Option<JSValue> {
        self.bytes.grow_by(bytes.len());
        let global = self.global;
        let response = self.response;

        // SAFETY: rewriter set by init().
        if unsafe { lolhtml::HTMLRewriter::write(self.rewriter, bytes) }.is_err() {
            if is_async {
                // SAFETY: response == self.response, kept alive by response_value Strong.
                let _ = unsafe { (*response).get_body_value() }
                    .to_error_instance(Body::Value::ValueError::Message(create_lolhtml_string_error()), global);
                // TODO: properly propagate exception upwards
                return None;
            } else {
                return Some(create_lolhtml_error(global));
            }
        }

        // SAFETY: rewriter set by init() and not yet freed.
        if unsafe { lolhtml::HTMLRewriter::end(self.rewriter) }.is_err() {
            if is_async {
                // SAFETY: response == self.response, kept alive by response_value Strong.
                let _ = unsafe { (*response).get_body_value() }
                    .to_error_instance(Body::Value::ValueError::Message(create_lolhtml_string_error()), global);
                // TODO: properly propagate exception upwards
                return None;
            } else {
                return Some(create_lolhtml_error(global));
            }
        }

        None
    }

    pub fn done(&mut self) {
        // SAFETY: self.response is kept alive by self.response_value (Strong
        // root) for the lifetime of this sink.
        let body_value = unsafe { (*self.response).get_body_value() };
        let mut prev_value = core::mem::replace(
            body_value,
            Body::Value::InternalBlob(webcore::InternalBlob {
                bytes: core::mem::replace(&mut self.bytes, MutableString::init_empty()).into_list(),
            }),
        );

        let _ = prev_value.resolve(body_value, self.global, None);
        // TODO: properly propagate exception upwards
    }

    pub fn write(&mut self, bytes: &[u8]) {
        self.bytes.append(bytes);
    }
}

#[derive(Clone, Copy)]
pub enum BufferOutputSinkSync {
    Suspended,
    Pending,
    Done,
}

impl Drop for BufferOutputSink {
    fn drop(&mut self) {
        // bytes, body_value_bufferer, context (Rc), response_value (Strong) drop automatically.
        if !self.rewriter.is_null() {
            // SAFETY: rewriter created via builder.build() and not yet freed.
            unsafe { lolhtml::HTMLRewriter::deinit(self.rewriter) };
        }
    }
}

// ──────────────────────── DocumentHandler ────────────────────────────────

pub struct DocumentHandler {
    // TODO(port): bare JSValue heap fields kept alive via JSC gcProtect — the
    // Zig calls .protect()/.unprotect() so this is sound in practice, but
    // PORTING.md flags bare JSValue on heap structs. Evaluate bun_jsc::Strong
    // in Phase B (would let us drop the manual protect/unprotect calls).
    pub on_doc_type_callback: Option<JSValue>,
    pub on_comment_callback: Option<JSValue>,
    pub on_text_callback: Option<JSValue>,
    pub on_end_callback: Option<JSValue>,
    pub this_object: JSValue,
    pub global: &'static JSGlobalObject, // JSC_BORROW
}

impl DocumentHandler {
    pub fn on_doc_type(this: *mut Self, value: *mut lolhtml::DocType) -> bool {
        handler_callback::<Self, DocType, lolhtml::DocType>(
            this,
            value,
            |w| w.doctype = core::ptr::null_mut(),
            |h| h.on_doc_type_callback,
        )
    }
    pub fn on_comment(this: *mut Self, value: *mut lolhtml::Comment) -> bool {
        handler_callback::<Self, Comment, lolhtml::Comment>(
            this,
            value,
            |w| w.comment = core::ptr::null_mut(),
            |h| h.on_comment_callback,
        )
    }
    pub fn on_text(this: *mut Self, value: *mut lolhtml::TextChunk) -> bool {
        handler_callback::<Self, TextChunk, lolhtml::TextChunk>(
            this,
            value,
            |w| w.text_chunk = core::ptr::null_mut(),
            |h| h.on_text_callback,
        )
    }
    pub fn on_end(this: *mut Self, value: *mut lolhtml::DocEnd) -> bool {
        handler_callback::<Self, DocEnd, lolhtml::DocEnd>(
            this,
            value,
            |w| w.doc_end = core::ptr::null_mut(),
            |h| h.on_end_callback,
        )
    }

    pub fn init(global: &JSGlobalObject, this_object: JSValue) -> JsResult<DocumentHandler> {
        // SAFETY: JSC_BORROW — JSGlobalObject outlives every handler (VM-lifetime).
        let global_static: &'static JSGlobalObject = unsafe { &*(global as *const _) };
        let handler = DocumentHandler {
            on_doc_type_callback: None,
            on_comment_callback: None,
            on_text_callback: None,
            on_end_callback: None,
            this_object,
            global: global_static,
        };

        if !this_object.is_object() {
            return global.throw_invalid_arguments("Expected object");
        }

        // errdefer: unprotect any callbacks we've protected so far on failure.
        // Guard the OWNED value (not &mut) so the success path returns it by
        // value via ScopeGuard::into_inner — no zeroed placeholder needed.
        let mut guard = scopeguard::guard(handler, |mut h| {
            if let Some(cb) = h.on_doc_type_callback.take() { cb.unprotect(); }
            if let Some(cb) = h.on_comment_callback.take() { cb.unprotect(); }
            if let Some(cb) = h.on_text_callback.take() { cb.unprotect(); }
            if let Some(cb) = h.on_end_callback.take() { cb.unprotect(); }
            // this_object was never protected on the error path; neutralize so
            // Drop's unprotect() is a no-op.
            h.this_object = JSValue::ZERO;
        });

        if let Some(val) = this_object.get(global, "doctype")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("doctype must be a function");
            }
            val.protect();
            guard.on_doc_type_callback = Some(val);
        }

        if let Some(val) = this_object.get(global, "comments")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("comments must be a function");
            }
            val.protect();
            guard.on_comment_callback = Some(val);
        }

        if let Some(val) = this_object.get(global, "text")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("text must be a function");
            }
            val.protect();
            guard.on_text_callback = Some(val);
        }

        if let Some(val) = this_object.get(global, "end")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("end must be a function");
            }
            val.protect();
            guard.on_end_callback = Some(val);
        }

        let handler = scopeguard::ScopeGuard::into_inner(guard);
        this_object.protect();
        Ok(handler)
    }
}

impl Drop for DocumentHandler {
    fn drop(&mut self) {
        if let Some(cb) = self.on_doc_type_callback.take() { cb.unprotect(); }
        if let Some(cb) = self.on_comment_callback.take() { cb.unprotect(); }
        if let Some(cb) = self.on_text_callback.take() { cb.unprotect(); }
        if let Some(cb) = self.on_end_callback.take() { cb.unprotect(); }
        self.this_object.unprotect();
    }
}

// ───────────────────────── HandlerCallback ───────────────────────────────

/// Trait abstracting the per-handler bits `HandlerCallback` needs:
/// `global` field and (optionally) `thisObject`.
pub trait HandlerLike {
    fn global(&self) -> &JSGlobalObject;
    fn this_object(&self) -> JSValue {
        JSValue::ZERO
    }
}

impl HandlerLike for DocumentHandler {
    fn global(&self) -> &JSGlobalObject { self.global }
    fn this_object(&self) -> JSValue { self.this_object }
}
impl HandlerLike for ElementHandler {
    fn global(&self) -> &JSGlobalObject { self.global }
    fn this_object(&self) -> JSValue { self.this_object }
}
impl HandlerLike for EndTagHandler {
    fn global(&self) -> &JSGlobalObject { self.global }
}

/// Trait abstracting the wrapper-type bits `HandlerCallback` needs.
pub trait WrapperLike {
    type Raw;
    fn init(value: *mut Self::Raw) -> *mut Self;
    fn ref_(&self);
    fn deref(this: *mut Self);
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    /// Some wrapper types (Element) hand out sub-objects that borrow from the
    /// underlying lol-html value and must be detached along with the wrapper
    /// itself. Default: no-op (caller passes a `clear_field` closure instead).
    fn invalidate(&mut self) {}
    const HAS_INVALIDATE: bool = false;
}

fn handler_callback<H, Z, L>(
    this: *mut H,
    value: *mut L,
    clear_field: impl FnOnce(&mut Z),
    get_callback: impl FnOnce(&H) -> Option<JSValue>,
) -> bool
where
    H: HandlerLike,
    Z: WrapperLike<Raw = L>,
{
    jsc::mark_binding();

    let wrapper = Z::init(value);
    // SAFETY: Z::init returns a fresh heap allocation.
    unsafe { (*wrapper).ref_() };

    // When using RefCount, we don't check the count value directly as it's an
    // opaque type now. The init values are handled by Box::new with Cell::new(1).

    // SAFETY: wrapper is a live heap allocation (ref'd above) for the entire
    // scope of this guard; deref runs at most once on this path.
    let _guard = scopeguard::guard(wrapper, |w| unsafe {
        if Z::HAS_INVALIDATE {
            // Some wrapper types (Element) hand out sub-objects that borrow
            // from the underlying lol-html value and must be detached along
            // with the wrapper itself.
            (*w).invalidate();
        } else {
            clear_field(&mut *w);
        }
        Z::deref(w);
    });

    // SAFETY: `this` is the Box<ElementHandler>/Box<DocumentHandler> userdata
    // pointer we registered with lol-html; it lives in LOLHTMLContext for the
    // duration of the rewriter.
    let this = unsafe { &mut *this };
    let global = this.global();

    // Use a TopExceptionScope to properly handle exceptions from the JavaScript callback
    let mut scope = TopExceptionScope::init(global);
    let _scope_guard = scopeguard::guard(&mut scope, |s| s.deinit());

    let cb = get_callback(this).expect("callback must be set if handler registered");
    let result = match cb.call(
        global,
        this.this_object(),
        // SAFETY: wrapper is a live heap allocation (ref'd above; guard deref
        // runs after this call).
        &[unsafe { (*wrapper).to_js(global) }],
    ) {
        Ok(v) => v,
        Err(_) => {
            // If there's an exception in the scope, capture it for later retrieval
            if let Some(exc) = scope.exception() {
                let exc_value = JSValue::from_cell(exc);
                // Store the exception in the VM's unhandled rejection capture
                // mechanism if it's available (this is the same mechanism used
                // by BufferOutputSink)
                if let Some(err_ptr) = global.bun_vm().unhandled_pending_rejection_to_capture {
                    // SAFETY: VM-owned pointer set by BufferOutputSink::init.
                    unsafe { *err_ptr.as_ptr() = exc_value };
                    exc_value.protect();
                }
            }
            // Clear the exception from the scope to prevent assertion failures
            scope.clear_exception();
            // Return true to indicate failure to LOLHTML, which will cause the
            // write operation to fail and the error handling logic to take over.
            return true;
        }
    };

    // Check if there's an exception that was thrown but not caught by the error union
    if let Some(exc) = scope.exception() {
        let exc_value = JSValue::from_cell(exc);
        // Store the exception in the VM's unhandled rejection capture mechanism
        if let Some(err_ptr) = global.bun_vm().unhandled_pending_rejection_to_capture {
            // SAFETY: VM-owned pointer set by BufferOutputSink::init.
            unsafe { *err_ptr.as_ptr() = exc_value };
            exc_value.protect();
        }
        // Clear the exception to prevent assertion failures
        scope.clear_exception();
        return true;
    }

    if !result.is_undefined_or_null() {
        if result.is_error() || result.is_aggregate_error(global) {
            return true;
        }

        if let Some(promise) = result.as_any_promise() {
            global.bun_vm().wait_for_promise(promise);
            let fail = promise.status() == jsc::PromiseStatus::Rejected;
            if fail {
                global
                    .bun_vm()
                    .unhandled_rejection(global, promise.result(global.vm()), promise.as_value());
            }
            return fail;
        }
    }
    false
}

// ───────────────────────── ElementHandler ────────────────────────────────

pub struct ElementHandler {
    // TODO(port): bare JSValue heap fields kept alive via JSC gcProtect —
    // evaluate bun_jsc::Strong in Phase B (see DocumentHandler note).
    pub on_element_callback: Option<JSValue>,
    pub on_comment_callback: Option<JSValue>,
    pub on_text_callback: Option<JSValue>,
    pub this_object: JSValue,
    pub global: &'static JSGlobalObject, // JSC_BORROW
}

impl ElementHandler {
    pub fn init(global: &JSGlobalObject, this_object: JSValue) -> JsResult<ElementHandler> {
        // SAFETY: JSC_BORROW — JSGlobalObject outlives every handler (VM-lifetime).
        let global_static: &'static JSGlobalObject = unsafe { &*(global as *const _) };
        let handler = ElementHandler {
            on_element_callback: None,
            on_comment_callback: None,
            on_text_callback: None,
            this_object,
            global: global_static,
        };

        // errdefer: guard the OWNED value so success returns it via into_inner.
        let mut guard = scopeguard::guard(handler, |mut h| {
            if let Some(cb) = h.on_comment_callback.take() { cb.unprotect(); }
            if let Some(cb) = h.on_element_callback.take() { cb.unprotect(); }
            if let Some(cb) = h.on_text_callback.take() { cb.unprotect(); }
            // this_object was never protected on the error path; neutralize so
            // Drop's unprotect() is a no-op.
            h.this_object = JSValue::ZERO;
        });

        if !this_object.is_object() {
            return global.throw_invalid_arguments("Expected object");
        }

        if let Some(val) = this_object.get(global, "element")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("element must be a function");
            }
            val.protect();
            guard.on_element_callback = Some(val);
        }

        if let Some(val) = this_object.get(global, "comments")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("comments must be a function");
            }
            val.protect();
            guard.on_comment_callback = Some(val);
        }

        if let Some(val) = this_object.get(global, "text")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return global.throw_invalid_arguments("text must be a function");
            }
            val.protect();
            guard.on_text_callback = Some(val);
        }

        let handler = scopeguard::ScopeGuard::into_inner(guard);
        this_object.protect();
        Ok(handler)
    }

    pub fn on_element(this: *mut Self, value: *mut lolhtml::Element) -> bool {
        handler_callback::<Self, Element, lolhtml::Element>(
            this,
            value,
            |_| {}, // Element uses HAS_INVALIDATE
            |h| h.on_element_callback,
        )
    }

    pub fn on_comment(this: *mut Self, value: *mut lolhtml::Comment) -> bool {
        handler_callback::<Self, Comment, lolhtml::Comment>(
            this,
            value,
            |w| w.comment = core::ptr::null_mut(),
            |h| h.on_comment_callback,
        )
    }

    pub fn on_text(this: *mut Self, value: *mut lolhtml::TextChunk) -> bool {
        handler_callback::<Self, TextChunk, lolhtml::TextChunk>(
            this,
            value,
            |w| w.text_chunk = core::ptr::null_mut(),
            |h| h.on_text_callback,
        )
    }
}

impl Drop for ElementHandler {
    fn drop(&mut self) {
        if let Some(cb) = self.on_element_callback.take() { cb.unprotect(); }
        if let Some(cb) = self.on_comment_callback.take() { cb.unprotect(); }
        if let Some(cb) = self.on_text_callback.take() { cb.unprotect(); }
        self.this_object.unprotect();
    }
}

// ───────────────────────── ContentOptions ────────────────────────────────

#[derive(Default, Clone, Copy)]
pub struct ContentOptions {
    pub html: bool,
}

// ────────────────────────── error helpers ────────────────────────────────

fn create_lolhtml_error(global: &JSGlobalObject) -> JSValue {
    // If there was already a pending exception, we want to use that instead.
    if let Some(err) = global.try_take_exception() {
        // it's a synchronous error
        return err;
    } else if let Some(err_ptr) = global.bun_vm().unhandled_pending_rejection_to_capture {
        // SAFETY: VM-owned pointer; valid while VM lives.
        let slot = unsafe { &mut *err_ptr.as_ptr() };
        if !slot.is_empty() {
            // it's a promise rejection
            let result = *slot;
            *slot = JSValue::ZERO;
            return result;
        }
    }

    let err = create_lolhtml_string_error();
    let value = err.to_error_instance(global);
    value.put(global, "name", ZigString::init(b"HTMLRewriterError").to_js(global));
    value
}

fn create_lolhtml_string_error() -> BunString {
    // We must clone this string.
    let err = lolhtml::HTMLString::last_error();
    let s = BunString::clone_utf8(err.slice());
    err.deinit();
    s
}

fn html_string_value(input: lolhtml::HTMLString, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    input.to_js(global_object)
}

// ─────────────────────────── TextChunk ───────────────────────────────────

#[bun_jsc::JsClass]
pub struct TextChunk {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub text_chunk: *mut lolhtml_sys::TextChunk,
}

impl TextChunk {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 { drop(Box::from_raw(this)); }
        }
    }

    pub fn init(text_chunk: *mut lolhtml::TextChunk) -> *mut TextChunk {
        Box::into_raw(Box::new(TextChunk {
            ref_count: Cell::new(1),
            text_chunk,
        }))
    }

    fn content_handler(
        &mut self,
        callback: fn(*mut lolhtml::TextChunk, &[u8], bool) -> Result<(), lolhtml::Error>,
        this_object: JSValue,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        if self.text_chunk.is_null() {
            return JSValue::UNDEFINED;
        }
        let content_slice = content.to_slice();

        if callback(
            self.text_chunk,
            content_slice.slice(),
            content_options.map_or(false, |o| o.html),
        )
        .is_err()
        {
            return create_lolhtml_error(global_object);
        }

        this_object
    }

    pub fn before_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::TextChunk::before, call_frame.this(), global_object, content, content_options)
    }

    pub fn after_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::TextChunk::after, call_frame.this(), global_object, content, content_options)
    }

    pub fn replace_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::TextChunk::replace, call_frame.this(), global_object, content, content_options)
    }

    // TODO(port): host_fn.wrapInstanceMethod — before/after/replace are emitted
    // by #[bun_jsc::host_fn(method)] wrappers around the `_` variants.

    #[bun_jsc::host_fn(method)]
    pub fn remove(&mut self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        if self.text_chunk.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.text_chunk is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::TextChunk::remove(self.text_chunk) };
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_text(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if self.text_chunk.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.text_chunk is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        BunString::create_utf8_for_js(global, unsafe { lolhtml::TextChunk::get_content(self.text_chunk) }.slice())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        if self.text_chunk.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.text_chunk is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::TextChunk::is_removed(self.text_chunk) })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn last_in_text_node(&self, _global: &JSGlobalObject) -> JSValue {
        if self.text_chunk.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.text_chunk is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::TextChunk::is_last_in_text_node(self.text_chunk) })
    }

    pub fn finalize(this: *mut TextChunk) {
        Self::deref(this);
    }
}

impl WrapperLike for TextChunk {
    type Raw = lolhtml::TextChunk;
    fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
    fn ref_(&self) { self.ref_() }
    fn deref(this: *mut Self) { Self::deref(this) }
    fn to_js(&self, g: &JSGlobalObject) -> JSValue { self.to_js(g) }
}

// ──────────────────────────── DocType ────────────────────────────────────

#[bun_jsc::JsClass]
pub struct DocType {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub doctype: *mut lolhtml_sys::DocType,
}

impl DocType {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 { drop(Box::from_raw(this)); }
        }
    }

    pub fn finalize(this: *mut DocType) {
        Self::deref(this);
    }

    pub fn init(doctype: *mut lolhtml::DocType) -> *mut DocType {
        Box::into_raw(Box::new(DocType {
            ref_count: Cell::new(1),
            doctype,
        }))
    }

    /// The doctype name.
    #[bun_jsc::host_fn(getter)]
    pub fn name(&self, global_object: &JSGlobalObject) -> JSValue {
        if self.doctype.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.doctype is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        let str = unsafe { lolhtml::DocType::get_name(self.doctype) }.slice();
        if str.is_empty() {
            return JSValue::NULL;
        }
        ZigString::init(str).to_js(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn system_id(&self, global_object: &JSGlobalObject) -> JSValue {
        if self.doctype.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.doctype is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        let str = unsafe { lolhtml::DocType::get_system_id(self.doctype) }.slice();
        if str.is_empty() {
            return JSValue::NULL;
        }
        ZigString::init(str).to_js(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn public_id(&self, global_object: &JSGlobalObject) -> JSValue {
        if self.doctype.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.doctype is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        let str = unsafe { lolhtml::DocType::get_public_id(self.doctype) }.slice();
        if str.is_empty() {
            return JSValue::NULL;
        }
        ZigString::init(str).to_js(global_object)
    }

    #[bun_jsc::host_fn(method)]
    pub fn remove(&mut self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        if self.doctype.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.doctype is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::DocType::remove(self.doctype) };
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        if self.doctype.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.doctype is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::DocType::is_removed(self.doctype) })
    }
}

impl WrapperLike for DocType {
    type Raw = lolhtml::DocType;
    fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
    fn ref_(&self) { self.ref_() }
    fn deref(this: *mut Self) { Self::deref(this) }
    fn to_js(&self, g: &JSGlobalObject) -> JSValue { self.to_js(g) }
}

// ──────────────────────────── DocEnd ─────────────────────────────────────

#[bun_jsc::JsClass]
pub struct DocEnd {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub doc_end: *mut lolhtml_sys::DocEnd,
}

impl DocEnd {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 { drop(Box::from_raw(this)); }
        }
    }

    pub fn init(doc_end: *mut lolhtml::DocEnd) -> *mut DocEnd {
        Box::into_raw(Box::new(DocEnd {
            ref_count: Cell::new(1),
            doc_end,
        }))
    }

    fn content_handler(
        &mut self,
        callback: fn(*mut lolhtml::DocEnd, &[u8], bool) -> Result<(), lolhtml::Error>,
        this_object: JSValue,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        if self.doc_end.is_null() {
            return JSValue::NULL;
        }
        let content_slice = content.to_slice();

        if callback(
            self.doc_end,
            content_slice.slice(),
            content_options.map_or(false, |o| o.html),
        )
        .is_err()
        {
            return create_lolhtml_error(global_object);
        }

        this_object
    }

    pub fn append_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::DocEnd::append, call_frame.this(), global_object, content, content_options)
    }

    // TODO(port): host_fn.wrapInstanceMethod — `append` wraps `append_`.

    pub fn finalize(this: *mut DocEnd) {
        Self::deref(this);
    }
}

impl WrapperLike for DocEnd {
    type Raw = lolhtml::DocEnd;
    fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
    fn ref_(&self) { self.ref_() }
    fn deref(this: *mut Self) { Self::deref(this) }
    fn to_js(&self, g: &JSGlobalObject) -> JSValue { self.to_js(g) }
}

// ──────────────────────────── Comment ────────────────────────────────────

#[bun_jsc::JsClass]
pub struct Comment {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub comment: *mut lolhtml_sys::Comment,
}

impl Comment {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 { drop(Box::from_raw(this)); }
        }
    }

    pub fn init(comment: *mut lolhtml::Comment) -> *mut Comment {
        Box::into_raw(Box::new(Comment {
            ref_count: Cell::new(1),
            comment,
        }))
    }

    fn content_handler(
        &mut self,
        callback: fn(*mut lolhtml::Comment, &[u8], bool) -> Result<(), lolhtml::Error>,
        this_object: JSValue,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        if self.comment.is_null() {
            return JSValue::NULL;
        }
        let content_slice = content.to_slice();

        if callback(
            self.comment,
            content_slice.slice(),
            content_options.map_or(false, |o| o.html),
        )
        .is_err()
        {
            return create_lolhtml_error(global_object);
        }

        this_object
    }

    pub fn before_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::Comment::before, call_frame.this(), global_object, content, content_options)
    }

    pub fn after_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::Comment::after, call_frame.this(), global_object, content, content_options)
    }

    pub fn replace_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::Comment::replace, call_frame.this(), global_object, content, content_options)
    }

    // TODO(port): host_fn.wrapInstanceMethod — before/after/replace wrap `_` variants.

    #[bun_jsc::host_fn(method)]
    pub fn remove(&mut self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        if self.comment.is_null() {
            return Ok(JSValue::NULL);
        }
        // SAFETY: self.comment is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::Comment::remove(self.comment) };
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_text(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if self.comment.is_null() {
            return Ok(JSValue::NULL);
        }
        // SAFETY: self.comment is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::Comment::get_text(self.comment) }.to_js(global_object)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_text(&mut self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if self.comment.is_null() {
            return Ok(true);
        }
        let text = value.to_slice(global)?;
        // SAFETY: self.comment is non-null (checked above) and valid for the
        // duration of the lol-html callback that owns it.
        if unsafe { lolhtml::Comment::set_text(self.comment, text.slice()) }.is_err() {
            return global.throw_value(create_lolhtml_error(global));
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        if self.comment.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.comment is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::Comment::is_removed(self.comment) })
    }

    pub fn finalize(this: *mut Comment) {
        Self::deref(this);
    }
}

impl WrapperLike for Comment {
    type Raw = lolhtml::Comment;
    fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
    fn ref_(&self) { self.ref_() }
    fn deref(this: *mut Self) { Self::deref(this) }
    fn to_js(&self, g: &JSGlobalObject) -> JSValue { self.to_js(g) }
}

// ──────────────────────────── EndTag ─────────────────────────────────────

#[bun_jsc::JsClass]
pub struct EndTag {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub end_tag: *mut lolhtml_sys::EndTag,
}

pub struct EndTagHandler {
    // TODO(port): bare JSValue heap field kept alive via JSC gcProtect —
    // evaluate bun_jsc::Strong in Phase B (see DocumentHandler note).
    pub callback: Option<JSValue>,
    pub global: &'static JSGlobalObject, // JSC_BORROW
}

impl EndTagHandler {
    pub fn on_end_tag(this: *mut Self, value: *mut lolhtml::EndTag) -> bool {
        handler_callback::<Self, EndTag, lolhtml::EndTag>(
            this,
            value,
            |w| w.end_tag = core::ptr::null_mut(),
            |h| h.callback,
        )
    }

    // TODO(port): LOLHTML.DirectiveHandler(LOLHTML.EndTag, Handler, onEndTag) —
    // C ABI shim that lol-html invokes. Phase B: emit via bun_lolhtml macro.
    pub const ON_END_TAG_HANDLER: lolhtml::DirectiveHandlerFn =
        lolhtml::directive_handler!(lolhtml::EndTag, EndTagHandler, EndTagHandler::on_end_tag);
}

impl EndTag {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 { drop(Box::from_raw(this)); }
        }
    }

    pub fn init(end_tag: *mut lolhtml::EndTag) -> *mut EndTag {
        Box::into_raw(Box::new(EndTag {
            ref_count: Cell::new(1),
            end_tag,
        }))
    }

    pub fn finalize(this: *mut EndTag) {
        Self::deref(this);
    }

    fn content_handler(
        &mut self,
        callback: fn(*mut lolhtml::EndTag, &[u8], bool) -> Result<(), lolhtml::Error>,
        this_object: JSValue,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        if self.end_tag.is_null() {
            return JSValue::NULL;
        }
        let content_slice = content.to_slice();

        if callback(
            self.end_tag,
            content_slice.slice(),
            content_options.map_or(false, |o| o.html),
        )
        .is_err()
        {
            return create_lolhtml_error(global_object);
        }

        this_object
    }

    pub fn before_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::EndTag::before, call_frame.this(), global_object, content, content_options)
    }

    pub fn after_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::EndTag::after, call_frame.this(), global_object, content, content_options)
    }

    pub fn replace_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        self.content_handler(lolhtml::EndTag::replace, call_frame.this(), global_object, content, content_options)
    }

    // TODO(port): host_fn.wrapInstanceMethod — before/after/replace wrap `_` variants.

    #[bun_jsc::host_fn(method)]
    pub fn remove(&mut self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        if self.end_tag.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.end_tag is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::EndTag::remove(self.end_tag) };
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if self.end_tag.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.end_tag is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::EndTag::get_name(self.end_tag) }.to_js(global_object)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_name(&mut self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if self.end_tag.is_null() {
            return Ok(true);
        }
        let text = value.to_slice(global)?;
        // SAFETY: self.end_tag is non-null (checked above) and valid for the
        // duration of the lol-html callback that owns it.
        if unsafe { lolhtml::EndTag::set_name(self.end_tag, text.slice()) }.is_err() {
            return global.throw_value(create_lolhtml_error(global));
        }
        Ok(true)
    }
}

impl WrapperLike for EndTag {
    type Raw = lolhtml::EndTag;
    fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
    fn ref_(&self) { self.ref_() }
    fn deref(this: *mut Self) { Self::deref(this) }
    fn to_js(&self, g: &JSGlobalObject) -> JSValue { self.to_js(g) }
}

// ───────────────────────── AttributeIterator ─────────────────────────────

#[bun_jsc::JsClass]
pub struct AttributeIterator {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub iterator: *mut lolhtml_sys::AttributeIterator,
}

impl AttributeIterator {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 {
                (*this).detach();
                drop(Box::from_raw(this));
            }
        }
    }

    pub fn init(iterator: *mut lolhtml::AttributeIterator) -> *mut AttributeIterator {
        Box::into_raw(Box::new(AttributeIterator {
            ref_count: Cell::new(1),
            iterator,
        }))
    }

    fn detach(&mut self) {
        if !self.iterator.is_null() {
            // SAFETY: iterator allocated by lol-html; freed exactly once here.
            unsafe { lolhtml::AttributeIterator::deinit(self.iterator) };
            self.iterator = core::ptr::null_mut();
        }
    }

    pub fn finalize(this: *mut AttributeIterator) {
        // SAFETY: called by JSC codegen finalize on the mutator thread; `this`
        // is the live m_ctx payload.
        unsafe { (*this).detach() };
        Self::deref(this);
    }

    #[bun_jsc::host_fn(method)]
    pub fn next(&mut self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let done_label = ZigString::static_("done");
        let value_label = ZigString::static_("value");

        if self.iterator.is_null() {
            return Ok(JSValue::create_object2(
                global_object,
                done_label,
                value_label,
                JSValue::TRUE,
                JSValue::UNDEFINED,
            ));
        }

        // SAFETY: self.iterator is non-null (checked above) and valid until
        // detached by Element::invalidate or exhausted below.
        let Some(attribute) = (unsafe { lolhtml::AttributeIterator::next(self.iterator) }) else {
            // SAFETY: iterator non-null (checked above); freed once here.
            unsafe { lolhtml::AttributeIterator::deinit(self.iterator) };
            self.iterator = core::ptr::null_mut();
            return Ok(JSValue::create_object2(
                global_object,
                done_label,
                value_label,
                JSValue::TRUE,
                JSValue::UNDEFINED,
            ));
        };

        let value = attribute.value();
        let name = attribute.name();

        Ok(JSValue::create_object2(
            global_object,
            done_label,
            value_label,
            JSValue::FALSE,
            BunString::to_js_array(global_object, &[name.to_string(), value.to_string()])?,
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_this(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Ok(call_frame.this())
    }
}

// ──────────────────────────── Element ────────────────────────────────────

#[bun_jsc::JsClass]
pub struct Element {
    // TODO(port): replace hand-rolled ref_/deref with bun_ptr::IntrusiveRc<Self>
    // per PORTING.md (intrusive RefCount; *Self is the JS wrapper m_ctx).
    ref_count: Cell<u32>,
    pub element: *mut lolhtml_sys::Element,
    /// AttributeIterator instances created by `getAttributes()` that borrow
    /// from `element`. They must be detached in `invalidate()` when the
    /// handler returns so that JS cannot dereference the freed lol-html
    /// attribute buffer.
    pub attribute_iterators: Vec<*mut AttributeIterator>,
}

impl Element {
    pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount — `this` is a live Box::into_raw allocation
        // with ref_count >= 1; freed exactly once when it reaches 0.
        unsafe {
            let rc = (*this).ref_count.get() - 1;
            (*this).ref_count.set(rc);
            if rc == 0 {
                (*this).invalidate();
                drop(Box::from_raw(this));
            }
        }
    }

    pub fn init(element: *mut lolhtml::Element) -> *mut Element {
        Box::into_raw(Box::new(Element {
            ref_count: Cell::new(1),
            element,
            attribute_iterators: Vec::new(),
        }))
    }

    pub fn finalize(this: *mut Element) {
        Self::deref(this);
    }

    /// Detach every `AttributeIterator` we handed to JS. Called when the
    /// underlying attribute buffer is about to become invalid — either because
    /// the handler is returning, or because `setAttribute` / `removeAttribute`
    /// is about to mutate the `Vec<Attribute>` the iterators borrow from.
    fn detach_attribute_iterators(&mut self) {
        for iter in self.attribute_iterators.drain(..) {
            // SAFETY: iter is a live AttributeIterator we ref'd in get_attributes();
            // ref_count >= 1 so the allocation is valid here.
            unsafe { (*iter).detach() };
            AttributeIterator::deref(iter);
        }
    }

    /// Called by `handler_callback` when the handler returns. The underlying
    /// `*LOLHTML.Element` (and the attribute buffer any `AttributeIterator`
    /// borrows from) is only valid during handler execution, so we must null
    /// it out here along with any iterators we handed to JS.
    pub fn invalidate(&mut self) {
        self.element = core::ptr::null_mut();
        self.detach_attribute_iterators();
        self.attribute_iterators = Vec::new();
    }

    pub fn on_end_tag_(
        &mut self,
        global_object: &JSGlobalObject,
        function: JSValue,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.element.is_null() {
            return Ok(JSValue::NULL);
        }
        if function.is_undefined_or_null() || !function.is_callable() {
            return Ok(ZigString::init(b"Expected a function").with_encoding().to_js(global_object));
        }

        // SAFETY: JSC_BORROW — JSGlobalObject outlives the EndTagHandler
        // (VM-lifetime; handler freed before VM teardown).
        let global_static: &'static JSGlobalObject = unsafe { &*(global_object as *const _) };
        let end_tag_handler = Box::into_raw(Box::new(EndTagHandler {
            global: global_static,
            callback: Some(function),
        }));

        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback; end_tag_handler is a fresh Box
        // whose ownership transfers to lol-html on success.
        if unsafe {
            lolhtml::Element::on_end_tag(
                self.element,
                EndTagHandler::ON_END_TAG_HANDLER,
                end_tag_handler as *mut core::ffi::c_void,
            )
        }
        .is_err()
        {
            // SAFETY: end_tag_handler allocated above and not yet handed to lol-html.
            unsafe { drop(Box::from_raw(end_tag_handler)) };
            let err = create_lolhtml_error(global_object);
            return global_object.throw_value(err);
        }

        function.protect();
        Ok(call_frame.this())
    }

    /// Returns the value for a given attribute name on the element, or null if it is not found.
    pub fn get_attribute_(&mut self, global_object: &JSGlobalObject, name: ZigString) -> JsResult<JSValue> {
        if self.element.is_null() {
            return Ok(JSValue::NULL);
        }
        let slice = name.to_slice();
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        let attr = unsafe { lolhtml::Element::get_attribute(self.element, slice.slice()) };

        if attr.len == 0 {
            return Ok(JSValue::NULL);
        }

        attr.to_js(global_object)
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub fn has_attribute_(&mut self, global: &JSGlobalObject, name: ZigString) -> JSValue {
        if self.element.is_null() {
            return JSValue::FALSE;
        }
        let slice = name.to_slice();
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        match unsafe { lolhtml::Element::has_attribute(self.element, slice.slice()) } {
            Ok(b) => JSValue::from(b),
            Err(_) => create_lolhtml_error(global),
        }
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn set_attribute_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name_: ZigString,
        value_: ZigString,
    ) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }

        // Mutating the attribute Vec (push → possible realloc) invalidates the
        // slice::Iter any live AttributeIterator borrows from.
        self.detach_attribute_iterators();

        let name_slice = name_.to_slice();
        let value_slice = value_.to_slice();
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        if unsafe { lolhtml::Element::set_attribute(self.element, name_slice.slice(), value_slice.slice()) }.is_err() {
            return create_lolhtml_error(global_object);
        }
        call_frame.this()
    }

    /// Removes the attribute.
    pub fn remove_attribute_(
        &mut self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name: ZigString,
    ) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }

        // Vec::remove shifts trailing elements and shrinks len, leaving any
        // live slice::Iter's end pointer past the new end.
        self.detach_attribute_iterators();

        let name_slice = name.to_slice();
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        if unsafe { lolhtml::Element::remove_attribute(self.element, name_slice.slice()) }.is_err() {
            return create_lolhtml_error(global_object);
        }
        call_frame.this()
    }

    // TODO(port): host_fn.wrapInstanceMethod — onEndTag/getAttribute/hasAttribute/
    // setAttribute/removeAttribute wrap the `_` variants above.

    fn content_handler(
        &mut self,
        callback: fn(*mut lolhtml::Element, &[u8], bool) -> Result<(), lolhtml::Error>,
        this_object: JSValue,
        global_object: &JSGlobalObject,
        content: ZigString,
        content_options: Option<ContentOptions>,
    ) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }
        let content_slice = content.to_slice();

        if callback(
            self.element,
            content_slice.slice(),
            content_options.map_or(false, |o| o.html),
        )
        .is_err()
        {
            return create_lolhtml_error(global_object);
        }

        this_object
    }

    /// Inserts content before the element.
    pub fn before_(&mut self, call_frame: &CallFrame, global_object: &JSGlobalObject, content: ZigString, content_options: Option<ContentOptions>) -> JSValue {
        self.content_handler(lolhtml::Element::before, call_frame.this(), global_object, content, content_options)
    }

    /// Inserts content right after the element.
    pub fn after_(&mut self, call_frame: &CallFrame, global_object: &JSGlobalObject, content: ZigString, content_options: Option<ContentOptions>) -> JSValue {
        self.content_handler(lolhtml::Element::after, call_frame.this(), global_object, content, content_options)
    }

    /// Inserts content right after the start tag of the element.
    pub fn prepend_(&mut self, call_frame: &CallFrame, global_object: &JSGlobalObject, content: ZigString, content_options: Option<ContentOptions>) -> JSValue {
        self.content_handler(lolhtml::Element::prepend, call_frame.this(), global_object, content, content_options)
    }

    /// Inserts content right before the end tag of the element.
    pub fn append_(&mut self, call_frame: &CallFrame, global_object: &JSGlobalObject, content: ZigString, content_options: Option<ContentOptions>) -> JSValue {
        self.content_handler(lolhtml::Element::append, call_frame.this(), global_object, content, content_options)
    }

    /// Removes the element and inserts content in place of it.
    pub fn replace_(&mut self, call_frame: &CallFrame, global_object: &JSGlobalObject, content: ZigString, content_options: Option<ContentOptions>) -> JSValue {
        self.content_handler(lolhtml::Element::replace, call_frame.this(), global_object, content, content_options)
    }

    /// Replaces content of the element.
    pub fn set_inner_content_(&mut self, call_frame: &CallFrame, global_object: &JSGlobalObject, content: ZigString, content_options: Option<ContentOptions>) -> JSValue {
        self.content_handler(lolhtml::Element::set_inner_content, call_frame.this(), global_object, content, content_options)
    }

    // TODO(port): host_fn.wrapInstanceMethod — before/after/prepend/append/
    // replace/setInnerContent wrap the `_` variants above.

    /// Removes the element with all its content.
    #[bun_jsc::host_fn(method)]
    pub fn remove(&mut self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        if self.element.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::Element::remove(self.element) };
        Ok(call_frame.this())
    }

    /// Removes the start tag and end tag of the element but keeps its inner content intact.
    #[bun_jsc::host_fn(method)]
    pub fn remove_and_keep_content(&mut self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        if self.element.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        unsafe { lolhtml::Element::remove_and_keep_content(self.element) };
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_tag_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if self.element.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        html_string_value(unsafe { lolhtml::Element::tag_name(self.element) }, global_object)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_tag_name(&mut self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if self.element.is_null() {
            return Ok(true);
        }
        let text = value.to_slice(global)?;
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback that owns it.
        if unsafe { lolhtml::Element::set_tag_name(self.element, text.slice()) }.is_err() {
            return global.throw_value(create_lolhtml_error(global));
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_removed(&self, _global: &JSGlobalObject) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::Element::is_removed(self.element) })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_self_closing(&self, _global: &JSGlobalObject) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::Element::is_self_closing(self.element) })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_can_have_content(&self, _global: &JSGlobalObject) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }
        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        JSValue::from(unsafe { lolhtml::Element::can_have_content(self.element) })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_namespace_uri(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if self.element.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: namespaceURI returns a NUL-terminated C string owned by lol-html.
        let ns = unsafe { core::ffi::CStr::from_ptr(lolhtml::Element::namespace_uri(self.element)) };
        BunString::create_utf8_for_js(global_object, ns.to_bytes())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_attributes(&mut self, global_object: &JSGlobalObject) -> JSValue {
        if self.element.is_null() {
            return JSValue::UNDEFINED;
        }

        // SAFETY: self.element is non-null (checked above) and valid for the
        // duration of the lol-html callback.
        let Some(iter) = (unsafe { lolhtml::Element::attributes(self.element) }) else {
            return create_lolhtml_error(global_object);
        };
        let attr_iter = Box::into_raw(Box::new(AttributeIterator {
            ref_count: Cell::new(1),
            iterator: iter,
        }));
        // Track this iterator so we can detach it when the handler returns.
        // lol-html's attribute iterator borrows from the element's attribute
        // buffer which is freed after the callback; leaking the iterator to JS
        // without detaching it would be a use-after-free.
        // SAFETY: attr_iter is a fresh Box::into_raw allocation (refcount==1).
        unsafe { (*attr_iter).ref_() };
        self.attribute_iterators.push(attr_iter);
        // SAFETY: attr_iter is live (refcount==2 now); to_js wraps it as the JS
        // wrapper's m_ctx.
        unsafe { (*attr_iter).to_js(global_object) }
    }
}

impl WrapperLike for Element {
    type Raw = lolhtml::Element;
    fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
    fn ref_(&self) { self.ref_() }
    fn deref(this: *mut Self) { Self::deref(this) }
    fn to_js(&self, g: &JSGlobalObject) -> JSValue { self.to_js(g) }
    fn invalidate(&mut self) { self.invalidate() }
    const HAS_INVALIDATE: bool = true;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/html_rewriter.zig (2031 lines)
//   confidence: medium
//   todos:      28
//   notes:      HandlerCallback comptime-reflection replaced with HandlerLike/WrapperLike traits + closures; Rc<LOLHTMLContext> get_mut() is KNOWN-WRONG after transform() — Phase B must switch to IntrusiveRc/RefCell; intrusive RefCount left as hand-rolled Cell<u32> + ref_/deref (Phase B: bun_ptr::IntrusiveRc); bare-JSValue heap fields kept alive via gcProtect (Phase B: evaluate Strong); host_fn.wrapInstanceMethod shims left to #[bun_jsc::host_fn(method)] codegen; tmp_sync_error stack-ptr pattern preserved with NonNull but fragile.
// ──────────────────────────────────────────────────────────────────────────
