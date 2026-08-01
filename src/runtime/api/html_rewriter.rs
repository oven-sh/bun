//! HTMLRewriter API — wraps lol-html for JS.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use std::rc::Rc;

use bun_jsc::{
    self as jsc, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, ProtectedJSValue,
    SystemError, bun_string_jsc,
};
// Note: `bun_jsc::VirtualMachine` is a *module* re-export
// (`pub use self::virtual_machine as VirtualMachine;`). The struct lives at
// `bun_jsc::virtual_machine::VirtualMachine` — import that directly so the
// name resolves as a type at `&mut VirtualMachine` annotations and as the
// owner of the `on_quiet_unhandled_rejection_handler_capture_value` assoc fn.
use bun_jsc::virtual_machine::VirtualMachine;

use crate::webcore::response::HeadersRef;
use crate::webcore::{self, ByteStream, ReadableStream, Response, streams};
use bun_core::String as BunString;
// `ZigString` re-exports `bun_core::ZigString`; JSC-side methods
// (`to_js`, `with_encoding`, …) come from the `ZigStringJsc` extension trait.
use bun_jsc::ZigStringJsc as _;
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::zig_string::ZigString;

// lol-html rewritable units, lifetime-erased to `'static` so a `*mut RawX`
// can be parked in a JsClass `Cell` for the duration of the synchronous
// handler call (the Cell is nulled again before the handler returns).
type RawElement = lol_html::html_content::Element<'static, 'static>;
type RawTextChunk = lol_html::html_content::TextChunk<'static>;
type RawComment = lol_html::html_content::Comment<'static>;
type RawDoctype = lol_html::html_content::Doctype<'static>;
type RawDocumentEnd = lol_html::html_content::DocumentEnd<'static>;
type RawEndTag = lol_html::html_content::EndTag<'static>;

// ───────────────────── local helpers ─────────────────────────────────────

/// Load the lol-html unit out of a wrapper's `Cell<*mut RawX>` field for the
/// body of one host-fn. This is the ONE sanctioned lifetime-erasure `unsafe`
/// in this module. Returns `None` once the wrapper has been detached (the
/// Cell nulled), so a JS object retained past its handler can never reach a
/// dangling pointer.
fn cell_get<'a, T>(cell: &Cell<*mut T>) -> Option<&'a mut T> {
    // SAFETY: every non-null pointer in these Cells was erased with
    // `ptr::from_mut(x).cast()` from the `&mut X` lol-html lends a handler
    // closure for the duration of that synchronous call (`build_settings`,
    // `EndTag::on_end_tag`). `handler_callback` parks it in the wrapper only
    // while it runs the JS callback, and its scopeguard (`clear_field` /
    // `invalidate`) nulls the Cell before that closure returns to lol-html —
    // so a non-null load means the pointee is still inside lol-html's
    // exclusive `&mut` borrow: live, aligned, and lent to nobody else. The
    // unbounded `'a` is the caller's obligation: consume the returned `&mut`
    // within the current host-fn body and never hold it across a re-entry
    // into JS, which could reach this fn again on the same wrapper.
    unsafe { cell.get().as_mut() }
}

/// Construct a `SystemError` with code+message and remaining fields defaulted.
fn system_error(code: &'static str, message: &'static str) -> SystemError {
    SystemError {
        code: BunString::static_(code).into(),
        message: BunString::static_(message).into(),
        ..Default::default()
    }
}

// ─────────────────── instance-method arg-decode helpers ──────────────────
//
// Note: a `#[bun_jsc::host_fn(method)]` proc-macro form of typed argument
// decoding hasn't landed, so the per-type decode arms used by HTMLRewriter
// (`ZigString`, `?ContentOptions`, `JSValue`) are open-coded here as small
// helpers.

/// Decode arm for `ZigString` — eat next arg, throw
/// "Missing argument" if absent, "Expected string" if undefined/null,
/// otherwise `get_zig_string`.
fn eat_zig_string(iter: &mut ArgumentsSlice<'_>, global: &JSGlobalObject) -> JsResult<ZigString> {
    let Some(value) = iter.next_eat() else {
        return Err(global.throw_invalid_arguments(format_args!("Missing argument")));
    };
    if value.is_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected string")));
    }
    value.get_zig_string(global)
}

/// Decode arm for `JSValue` (required) — eat next arg or
/// throw "Missing argument".
fn eat_js_value(iter: &mut ArgumentsSlice<'_>, global: &JSGlobalObject) -> JsResult<JSValue> {
    iter.next_eat()
        .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))
}

/// Decode arm for optional `ContentOptions` — peek next arg, read
/// `.html` and coerce to bool. `None` if no arg or no `.html` property.
fn eat_content_options(
    iter: &mut ArgumentsSlice<'_>,
    global: &JSGlobalObject,
) -> JsResult<Option<ContentOptions>> {
    let Some(arg) = iter.next_eat() else {
        return Ok(None);
    };
    match arg.get(global, "html")? {
        Some(html_val) => Ok(Some(ContentOptions {
            html: html_val.to_boolean(),
        })),
        None => Ok(None),
    }
}

/// Common `(content: ZigString, contentOptions: ?ContentOptions)` pair —
/// every `before/after/replace/append/prepend/setInnerContent` wrapper
/// decodes exactly this shape.
fn eat_content_args(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<(ZigString, Option<ContentOptions>)> {
    let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
    let content = eat_zig_string(&mut iter, global)?;
    let opts = eat_content_options(&mut iter, global)?;
    Ok((content, opts))
}

/// Map the optional JS `{ html }` content options onto lol-html's
/// `ContentType`: `Html` iff `html` was given and truthy, `Text` otherwise.
fn content_type(opts: Option<ContentOptions>) -> lol_html::html_content::ContentType {
    if opts.is_some_and(|o| o.html) {
        lol_html::html_content::ContentType::Html
    } else {
        lol_html::html_content::ContentType::Text
    }
}

/// Emit the per-wrapper `content_handler` plus one `(${name}_, $name)` pair
/// per lol-html content op, sharing one `content_handler` body across all
/// wrappers.
///
/// - `$Raw`      — the `Raw*` type alias of the backing lol-html unit, e.g.
///                 `RawElement` (also paths the raw op as `$Raw::$name`,
///                 which holds for all 16 ops).
/// - `$field`    — the `Cell<*mut $Raw>` field on `self`.
/// - `$null_ret` — sentinel when the raw ptr is null. **Differs per wrapper**:
///                 `JSValue::UNDEFINED` for TextChunk/Element,
///                 `JSValue::NULL` for DocEnd/Comment/EndTag.
/// - Each op arm accepts leading attrs (doc comments, `#[allow(dead_code)]`).
///
/// Expands inside an `impl $Wrapper { ... }` block to associated items.
macro_rules! lol_content_ops {
    (
        $Raw:ident, $field:ident, $null_ret:expr;
        $( $(#[$attr:meta])* $name:ident / $name_:ident ),* $(,)?
    ) => {
        fn content_handler(
            &self,
            callback: fn(&mut $Raw, &str, lol_html::html_content::ContentType),
            this_object: JSValue,
            global_object: &JSGlobalObject,
            content: ZigString,
            content_options: Option<ContentOptions>,
        ) -> JsResult<JSValue> {
            let Some(raw) = cell_get(&self.$field) else {
                return Ok($null_ret);
            };
            let content_slice = content.to_slice();
            // lol-html content ops are infallible, so the UTF-8 check is the only throw path.
            let content_str = utf8_or_throw(global_object, content_slice.slice())?;
            callback(raw, content_str, content_type(content_options));
            Ok(this_object)
        }

        $(
            $(#[$attr])*
            pub fn $name_(
                &self,
                call_frame: &CallFrame,
                global_object: &JSGlobalObject,
                content: ZigString,
                content_options: Option<ContentOptions>,
            ) -> JsResult<JSValue> {
                self.content_handler(
                    $Raw::$name,
                    call_frame.this(),
                    global_object,
                    content,
                    content_options,
                )
            }

            // Decode `(content: ZigString, contentOptions: ?ContentOptions)`
            // then forward.
            $(#[$attr])*
            pub fn $name(
                &self,
                global: &JSGlobalObject,
                call_frame: &CallFrame,
            ) -> JsResult<JSValue> {
                let (content, opts) = eat_content_args(global, call_frame)?;
                self.$name_(call_frame, global, content, opts)
            }
        )*
    };
}

// ───────────────────────────── LOLHTMLContext ─────────────────────────────

/// Selector + handler registry shared between an [`HTMLRewriter`] and every
/// rewriter it spawns — `transform()` can run more than once, so
/// [`build_settings`] re-derives fresh handler closures from it each time.
#[derive(Default)]
pub struct LOLHTMLContext {
    /// Paired with `element_handlers` by index: each `on()` pushes one entry
    /// into both.
    pub(crate) selectors: Vec<lol_html::Selector>,
    // The `Box` is load-bearing: the lol-html handler closures produced by
    // `build_settings` capture raw pointers into the box interiors; unboxing
    // would dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    pub(crate) element_handlers: Vec<Box<ElementHandler>>,
    #[expect(clippy::vec_box)]
    pub(crate) document_handlers: Vec<Box<DocumentHandler>>,
}

/// `true` = the STOP directive from an `ElementHandler`/`DocumentHandler`/
/// `EndTagHandler` callback. The message is load-bearing: lol-html's C API
/// produced exactly this string for a stopped rewriter; it reaches JS as-is.
fn directive_result(stop: bool) -> lol_html::HandlerResult {
    if stop {
        Err("The rewriter has been stopped.".into())
    } else {
        Ok(())
    }
}

/// Build the [`lol_html::Settings`] handler vectors from `ctx`. The lifetime
/// erasures below are sound because the consuming sink's `Rc` keeps `ctx` alive
/// and `handler_callback` detaches each JS wrapper before its handler returns.
fn build_settings(
    ctx: &mut LOLHTMLContext,
) -> (
    Vec<(
        std::borrow::Cow<'static, lol_html::Selector>,
        lol_html::ElementContentHandlers<'static>,
    )>,
    Vec<lol_html::DocumentContentHandlers<'static>>,
) {
    let mut element_content_handlers = Vec::with_capacity(ctx.element_handlers.len());
    for (selector, handler) in ctx.selectors.iter().zip(ctx.element_handlers.iter_mut()) {
        let has_element = handler.on_element_callback.is_some();
        let has_comment = handler.on_comment_callback.is_some();
        let has_text = handler.on_text_callback.is_some();
        // Take the address ONCE, as the LAST access through `handler`;
        // `NonNull` is `Copy`, so the closures below share it without ever
        // materializing aliased `&mut` (UB under Stacked Borrows).
        let h: NonNull<ElementHandler> = NonNull::from(&mut **handler);

        let mut handlers: lol_html::ElementContentHandlers<'static> =
            lol_html::ElementContentHandlers::default();
        if has_element {
            handlers = handlers.element(move |el: &mut lol_html::html_content::Element| {
                let raw: *mut lol_html::html_content::Element<'static, 'static> =
                    core::ptr::from_mut(el).cast();
                directive_result(ElementHandler::on_element(h.as_ptr(), raw))
            });
        }
        if has_comment {
            handlers = handlers.comments(move |c: &mut lol_html::html_content::Comment| {
                let raw: *mut lol_html::html_content::Comment<'static> =
                    core::ptr::from_mut(c).cast();
                directive_result(ElementHandler::on_comment(h.as_ptr(), raw))
            });
        }
        if has_text {
            handlers = handlers.text(move |t: &mut lol_html::html_content::TextChunk| {
                let raw: *mut lol_html::html_content::TextChunk<'static> =
                    core::ptr::from_mut(t).cast();
                directive_result(ElementHandler::on_text(h.as_ptr(), raw))
            });
        }
        element_content_handlers.push((std::borrow::Cow::Owned(selector.clone()), handlers));
    }

    let mut document_content_handlers = Vec::with_capacity(ctx.document_handlers.len());
    for handler in &mut ctx.document_handlers {
        let has_doc_type = handler.on_doc_type_callback.is_some();
        let has_comment = handler.on_comment_callback.is_some();
        let has_text = handler.on_text_callback.is_some();
        let has_end = handler.on_end_callback.is_some();
        // See the `NonNull::from` note in the element loop above.
        let h: NonNull<DocumentHandler> = NonNull::from(&mut **handler);

        let mut handlers: lol_html::DocumentContentHandlers<'static> =
            lol_html::DocumentContentHandlers::default();
        if has_doc_type {
            handlers = handlers.doctype(move |d: &mut lol_html::html_content::Doctype| {
                let raw: *mut lol_html::html_content::Doctype<'static> =
                    core::ptr::from_mut(d).cast();
                directive_result(DocumentHandler::on_doc_type(h.as_ptr(), raw))
            });
        }
        if has_comment {
            handlers = handlers.comments(move |c: &mut lol_html::html_content::Comment| {
                let raw: *mut lol_html::html_content::Comment<'static> =
                    core::ptr::from_mut(c).cast();
                directive_result(DocumentHandler::on_comment(h.as_ptr(), raw))
            });
        }
        if has_text {
            handlers = handlers.text(move |t: &mut lol_html::html_content::TextChunk| {
                let raw: *mut lol_html::html_content::TextChunk<'static> =
                    core::ptr::from_mut(t).cast();
                directive_result(DocumentHandler::on_text(h.as_ptr(), raw))
            });
        }
        if has_end {
            handlers = handlers.end(move |e: &mut lol_html::html_content::DocumentEnd| {
                let raw: *mut lol_html::html_content::DocumentEnd<'static> =
                    core::ptr::from_mut(e).cast();
                directive_result(DocumentHandler::on_end(h.as_ptr(), raw))
            });
        }
        document_content_handlers.push(handlers);
    }

    (element_content_handlers, document_content_handlers)
}

// ───────────────────────────── HTMLRewriter ──────────────────────────────

#[bun_jsc::JsClass]
pub struct HTMLRewriter {
    pub(crate) context: Rc<RefCell<LOLHTMLContext>>,
}

impl HTMLRewriter {
    // Note: no `#[bun_jsc::host_fn]` here — `#[bun_jsc::JsClass]` on the
    // struct already emits the C-ABI constructor shim that calls
    // `<HTMLRewriter>::constructor(__g, __f)`.
    pub(crate) fn constructor(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut HTMLRewriter> {
        let rewriter = bun_core::heap::into_raw(Box::new(HTMLRewriter {
            context: Rc::new(RefCell::new(LOLHTMLContext::default())),
        }));
        bun_core::analytics::Features::HTML_REWRITER
            .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        Ok(rewriter)
    }

    pub(crate) fn on_(
        &self,
        global: &JSGlobalObject,
        selector_name: ZigString,
        call_frame: &CallFrame,
        listener: JSValue,
    ) -> JsResult<JSValue> {
        let selector_source = selector_name.to_string();
        let selector = match selector_source.parse::<lol_html::Selector>() {
            Ok(s) => s,
            Err(e) => return Err(global.throw_value(create_lolhtml_error(global, &e))),
        };

        let handler = Box::new(ElementHandler::init(global, listener)?);

        // Invariant: `selectors[i]` pairs with `element_handlers[i]`; the two
        // parallel vecs are zipped into lol-html `Settings` at transform time.
        let mut ctx = self.context.borrow_mut();
        ctx.selectors.push(selector);
        ctx.element_handlers.push(handler);
        Ok(call_frame.this())
    }

    pub(crate) fn on_document_(
        &self,
        global: &JSGlobalObject,
        listener: JSValue,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let handler = Box::new(DocumentHandler::init(global, listener)?);
        self.context.borrow_mut().document_handlers.push(handler);
        Ok(call_frame.this())
    }

    // `Box<Self>` is the JsClass finalizer thunk contract — generated codegen
    // calls `Box::from_raw` and dispatches to this signature; the Box drop
    // releases `context` (an `Rc`), so there is nothing left to do here.
    #[expect(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {}

    pub(crate) fn begin_transform(
        &self,
        global: &JSGlobalObject,
        response: &mut Response,
    ) -> JsResult<JSValue> {
        let new_context = Rc::clone(&self.context);
        // SAFETY: `response` is a live `Response` whose JS wrapper is on
        // the caller's stack (see `transform_`).
        unsafe { BufferOutputSink::init(new_context, global, response) }
    }

    pub(crate) fn transform_(
        &self,
        global: &JSGlobalObject,
        response_value: JSValue,
    ) -> JsResult<JSValue> {
        // Note: `Response` doesn't yet impl `JsClass`, so use the
        // codegen `from_js` directly instead of `JSValue::as_::<Response>()`.
        if let Some(response) =
            webcore::response::js::from_js(response_value).map(|p| p.cast::<Response>())
        {
            // SAFETY: response is the m_ctx of a live JS Response (response_value
            // is on the stack, conservatively scanned).
            let body_value = unsafe { (*response).get_body_value() };
            if matches!(*body_value, webcore::body::Value::Used) {
                return Err(
                    global.throw_invalid_arguments(format_args!("Response body already used"))
                );
            }
            // SAFETY: `response` is the live m_ctx of `response_value` (kept
            // alive on the caller's stack), never null.
            let out = self.begin_transform(global, unsafe { &mut *response })?;
            // Check if the returned value is an error and throw it properly
            if let Some(err) = out.to_error() {
                return Err(global.throw_value(err));
            }
            return Ok(out);
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        enum ResponseKind {
            String,
            ArrayBuffer,
            Other,
        }
        let kind = if response_value.is_string() {
            ResponseKind::String
        } else if response_value.js_type().is_typed_array_or_array_buffer() {
            ResponseKind::ArrayBuffer
        } else {
            ResponseKind::Other
        };

        if kind != ResponseKind::Other {
            let body_value = webcore::body::extract(global, response_value)?;
            let resp = bun_core::heap::into_raw(Box::new(Response::init(
                webcore::response::Init {
                    status_code: 200,
                    ..Default::default()
                },
                body_value,
                BunString::empty(),
                false,
            )));
            let _resp_guard = scopeguard::guard(resp, |r| {
                // SAFETY: `r` is the `heap::into_raw` allocation from just
                // above; finalize takes ownership and frees it exactly once.
                Response::finalize(unsafe { Box::from_raw(r) })
            });

            // SAFETY: `resp` is a live `heap::into_raw` allocation, never null.
            let out_response_value = self.begin_transform(global, unsafe { &mut *resp })?;
            // Check if the returned value is an error and throw it properly
            if let Some(err) = out_response_value.to_error() {
                return Err(global.throw_value(err));
            }
            out_response_value.ensure_still_alive();
            let Some(out_response) =
                webcore::response::js::from_js(out_response_value).map(|p| p.cast::<Response>())
            else {
                return Ok(out_response_value);
            };
            // SAFETY: out_response is the m_ctx of out_response_value (kept alive
            // on the stack via ensure_still_alive above). String/ArrayBuffer
            // input took the synchronous `feed` path, so the output ByteStream
            // is complete and `to_any_blob` drains it.
            let mut blob = unsafe { (*out_response).get_body_readable_stream(global) }
                .and_then(|mut s| s.to_any_blob(global))
                .unwrap_or(webcore::AnyBlob::Blob(Default::default()));
            // SAFETY: out_response is live (see above).
            unsafe { *(*out_response).get_body_value() = webcore::body::Value::Used };

            let _out_guard = scopeguard::guard((out_response_value, out_response), |(v, r)| {
                // `Response.js.dangerouslySetPtr(v, null)` — null out the JS
                // wrapper's `m_ctx` so its GC finalize is a no-op, then finalize
                // the native side ourselves.
                // SAFETY: `v` is the live JS wrapper (kept on stack via
                // ensure_still_alive); `r` is its `m_ctx` pointer, detached here
                // and finalized exactly once.
                unsafe {
                    let _ = bun_jsc::generated::JSResponse::dangerously_set_ptr(
                        v,
                        core::ptr::null_mut(),
                    );
                    // Manually invoke the finalizer to ensure it does what we want.
                    // SAFETY: `r` is the detached `m_ctx` pointer, sole owner here.
                    Response::finalize(Box::from_raw(r));
                }
            });

            return match kind {
                ResponseKind::String => blob.to_string(global, webcore::Lifetime::Transfer),
                ResponseKind::ArrayBuffer => {
                    blob.to_array_buffer(global, webcore::Lifetime::Transfer)
                }
                ResponseKind::Other => unreachable!(),
            };
        }

        Err(global.throw_invalid_arguments(format_args!("Expected Response or Body")))
    }

    // ── instance-method arg-decode wrappers ──────────────────────────────
    // See arg-decode helpers at top of file.

    pub(crate) fn on(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let selector_name = eat_zig_string(&mut iter, global)?;
        let listener = eat_js_value(&mut iter, global)?;
        self.on_(global, selector_name, call_frame, listener)
    }

    pub(crate) fn on_document(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let listener = eat_js_value(&mut iter, global)?;
        self.on_document_(global, listener, call_frame)
    }

    pub(crate) fn transform(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let response_value = eat_js_value(&mut iter, global)?;
        self.transform_(global, response_value)
    }
}

// ───────────────────────── HandlerErrorScope ─────────────────────────────

/// RAII guard installing `vm.unhandled_pending_rejection_to_capture` so
/// `handler_callback` / `create_lolhtml_error` can recover the original JS
/// error a handler threw (sync or via a rejected promise awaited by
/// `wait_for_promise`). Restores the previous capture slot and rejection
/// handler on drop.
struct HandlerErrorScope {
    prev_capture: Option<*mut JSValue>,
    rejection_scope: bun_jsc::virtual_machine::UnhandledRejectionScope,
}

impl HandlerErrorScope {
    fn enter(global: &JSGlobalObject, captured: &Cell<JSValue>) -> Self {
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let scope = Self {
            prev_capture: vm.unhandled_pending_rejection_to_capture,
            rejection_scope: vm.unhandled_rejection_scope(),
        };
        vm.unhandled_pending_rejection_to_capture = Some(captured.as_ptr());
        vm.on_unhandled_rejection =
            VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        scope
    }
}

impl Drop for HandlerErrorScope {
    fn drop(&mut self) {
        let vm = VirtualMachine::get().as_mut();
        vm.unhandled_pending_rejection_to_capture = self.prev_capture;
        self.rejection_scope.apply(vm);
    }
}

// ───────────────────────── BufferOutputSink ──────────────────────────────

#[derive(bun_ptr::CellRefCounted)]
pub struct BufferOutputSink {
    ref_count: Cell<u32>,
    pub global: GlobalRef, // JSC_BORROW
    /// Heap-boxed rewriter; `Cell` so `feed`/`fail`/`finish` can take `&self`.
    /// The rewriter's output sink is `SinkRef(*mut ByteStream)` (a separate
    /// allocation), so driving it never re-enters `BufferOutputSink`.
    rewriter: Cell<*mut lol_html::HtmlRewriter<'static, SinkRef>>,
    pub(crate) context: Rc<RefCell<LOLHTMLContext>>,
    /// GC root for the output `ByteStream`'s JS wrapper. `SinkRef` writes into
    /// the `ByteStream` pointed at by this stream's `Source::Bytes` payload.
    output: webcore::readable_stream::Strong,
    /// First error latched by [`Self::fail`]; read back non-destructively by
    /// `init()` (sync throw) and `get_pending_error()` (pump abort).
    failed: JsCell<jsc::strong::Optional>,
    /// Owned Box from `start_reading_input`; freed by [`Self::clear_input_sink`]
    /// (the `FetchTasklet::clear_sink` pattern).
    input_sink: Cell<*mut HTMLRewriterInputSink>,
}

impl BufferOutputSink {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    /// # Safety
    /// `original` must point to a live `Response` whose JS wrapper is kept
    /// alive for the duration of this call.
    unsafe fn init(
        context: Rc<RefCell<LOLHTMLContext>>,
        global: &JSGlobalObject,
        original: *mut Response,
    ) -> JsResult<JSValue> {
        // Output: a `ByteStream`-backed native ReadableStream. `SinkRef` writes
        // rewritten chunks here; the returned Response's body wraps it.
        let source = webcore::readable_stream::NewSource::<ByteStream>::new_mut(
            webcore::readable_stream::NewSource {
                context: ByteStream::default(),
                global_this: Some(bun_ptr::BackRef::new(global)),
                ..Default::default()
            },
        );
        source.context.setup();
        let out_bytes: *mut ByteStream = &raw mut source.context;
        let out_stream_js = source.to_readable_stream(global)?;
        let out_readable = ReadableStream {
            ptr: webcore::readable_stream::Source::Bytes(out_bytes),
            value: out_stream_js,
        };

        let sink = bun_core::heap::into_raw(Box::new(BufferOutputSink {
            ref_count: Cell::new(1),
            global: GlobalRef::from(global),
            rewriter: Cell::new(core::ptr::null_mut()),
            context,
            output: webcore::readable_stream::Strong::init(out_readable, global),
            failed: JsCell::new(jsc::strong::Optional::empty()),
            input_sink: Cell::new(core::ptr::null_mut()),
        }));
        // SAFETY: `sink` is the fresh `heap::into_raw` allocation above.
        let _sink_guard = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::adopt(sink) };

        // SAFETY: original is a live *Response passed from begin_transform.
        let input_size = unsafe { (*original).get_body_len() };

        // SAFETY: `sink` is live (refcount >= 1); the `RefMut` of
        // `(*sink).context` is released at end of statement.
        let (element_content_handlers, document_content_handlers) =
            unsafe { build_settings(&mut (*sink).context.borrow_mut()) };
        let rewriter = bun_core::heap::into_raw(Box::new(lol_html::HtmlRewriter::new(
            lol_html::Settings {
                element_content_handlers,
                document_content_handlers,
                encoding: lol_html::AsciiCompatibleEncoding::utf_8(),
                memory_settings: lol_html::MemorySettings {
                    preallocated_parsing_buffer_size: if input_size as u64
                        == webcore::blob::MAX_SIZE
                    {
                        1024
                    } else {
                        input_size.max(1024) as usize
                    },
                    max_allowed_memory_usage: u32::MAX as usize,
                },
                strict: false,
                enable_esi_tags: false,
                adjust_charset_on_meta_tag: false,
            },
            SinkRef(out_bytes),
        )));
        // SAFETY: `sink` is live (refcount >= 1).
        unsafe { (*sink).rewriter.set(rewriter) };

        let result = bun_core::heap::into_raw(Box::new(Response::init(
            webcore::response::Init {
                status_code: 200,
                ..Default::default()
            },
            webcore::Body::new(
                webcore::body::Value::from_readable_stream_without_lock_check(out_readable, global),
            ),
            BunString::empty(),
            false,
        )));
        // `result` is freed below only if `to_js` failed to wrap it.
        let result_guard = scopeguard::guard(result, |r| {
            // SAFETY: `r` is the `heap::into_raw` allocation above, not yet
            // handed to a JS wrapper (the guard is disarmed once it is).
            Response::finalize(unsafe { Box::from_raw(r) });
        });

        // SAFETY: result and original are both live *Response.
        unsafe {
            (*result).set_init(
                (*original).get_method(),
                (*original).get_init_status_code(),
                (*original).get_init_status_text().clone(),
            );
            // https://github.com/oven-sh/bun/issues/3334
            if let Some(headers) = (*original).get_init_headers_mut() {
                let cloned = headers.clone_this(global)?;
                (*result).set_init_headers(cloned.map(|p| HeadersRef::adopt(p)));
            }
            (*result).set_url((*original).url().clone());
        }

        // SAFETY: result is a live heap Response.
        let response_js_value = unsafe { (*result).to_js(global) };
        scopeguard::ScopeGuard::into_inner(result_guard);
        response_js_value.ensure_still_alive();

        // SAFETY: original is a live *Response kept alive by caller.
        let value = unsafe { (*original).get_body_value() };
        // SAFETY: original is a live *Response kept alive by caller.
        let owned_readable_stream = unsafe { (*original).get_body_readable_stream(global) };

        {
            let captured = Cell::new(JSValue::ZERO);
            let _scope = HandlerErrorScope::enter(global, &captured);
            // +1 for the in-flight input reader; balanced by `on_input_end`
            // (on either the sync path inside `start_reading_input` or via the
            // `assign_to_stream` result handler / `HTMLRewriterInputSink::finalize`).
            // SAFETY: `sink` is live (refcount >= 1).
            let in_flight = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::new(sink) };
            // SAFETY: `sink` is live (refcount >= 2 including `in_flight`).
            unsafe { (*sink).start_reading_input(value, owned_readable_stream)? };
            in_flight.forget();
        }

        // SAFETY: `sink` is live (refcount >= 1, `_sink_guard` above).
        // Non-destructive read: `get_pending_error()` reads the same slot to
        // abort the pump, so clearing it here would let a still-Pending pump
        // keep reading after `transform()` already threw.
        if let Some(err) = unsafe { (*sink).failed.get().get() } {
            err.ensure_still_alive();
            return Err(global.throw_value(err));
        }

        response_js_value.ensure_still_alive();
        Ok(response_js_value)
    }

    /// Route the input body to the rewriter. Materialised bodies
    /// (String/ArrayBuffer/InternalBlob, and Blobs that do not need a file
    /// read) feed the rewriter synchronously; everything else becomes a
    /// `ReadableStream` pumped through `HTMLRewriterInputSink` via the
    /// standard `assign_to_stream` JS pump, which accepts every stream source
    /// kind (including `JavaScript`/`Direct`).
    ///
    /// # Safety
    /// Called with an in-flight +1 on `self`; that ref is consumed by
    /// `on_input_end` on every return-`Ok(())` path. On `Err` the caller's
    /// `ScopedRef` releases it instead.
    unsafe fn start_reading_input(
        &self,
        value: &mut webcore::body::Value,
        owned_readable_stream: Option<ReadableStream>,
    ) -> JsResult<()> {
        let global = &self.global;

        let readable_stream = if let Some(stream) = owned_readable_stream {
            stream
        } else {
            value.to_blob_if_possible();
            if let webcore::body::Value::Error(err) = value {
                let js_err = err.to_js(global);
                self.on_input_end(Some(js_err));
                return Ok(());
            }
            if matches!(
                value,
                webcore::body::Value::WTFStringImpl(_)
                    | webcore::body::Value::InternalBlob(_)
                    | webcore::body::Value::Blob(_)
            ) {
                let mut input = value.use_as_any_blob_allow_non_utf8_string();
                if !input.needs_to_read_file() {
                    self.feed(input.slice());
                    input.detach();
                    self.on_input_end(None);
                    return Ok(());
                }
                *value = webcore::body::Value::Blob(match input {
                    webcore::AnyBlob::Blob(b) => b,
                    _ => unreachable!(),
                });
            }
            let js_stream = value.to_readable_stream(global)?;
            match ReadableStream::from_js(js_stream, global)? {
                Some(stream) => stream,
                None => {
                    self.on_input_end(None);
                    return Ok(());
                }
            }
        };

        if readable_stream.is_locked(global) || readable_stream.is_disturbed(global) {
            let err = system_error(
                "ERR_STREAM_ALREADY_FINISHED",
                "Stream already used, please create a new one",
            )
            .to_error_instance(global);
            self.on_input_end(Some(err));
            return Ok(());
        }

        if !matches!(value, webcore::body::Value::Error(_)) {
            *value = webcore::body::Value::Used;
        }

        // Deliberately no native `SinkHandle` fast path: `feed` drives
        // `HtmlRewriter::write`, which runs async handlers via
        // `wait_for_promise` (nested event loop). A ByteStream/FileReader
        // push-pipe could deliver the next chunk while `write()` is still on
        // the stack; the `readStreamIntoSink` JS pump is call-return
        // sequenced so it cannot.
        let input_sink: &mut HTMLRewriterInputSink =
            Box::leak(Box::new(HTMLRewriterInputSink::new(self)));
        self.input_sink.set(core::ptr::from_mut(input_sink));
        let assignment_result =
            crate::webcore::sink::JSSink::<HTMLRewriterInputSink>::assign_to_stream(
                global,
                readable_stream.value,
                input_sink,
            );
        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            self.on_input_end(Some(err));
            return Ok(());
        }
        if let Some(promise) = assignment_result.as_any_promise() {
            match promise.status() {
                jsc::js_promise::Status::Pending => {
                    assignment_result.then(
                        global,
                        core::ptr::from_mut(input_sink),
                        on_resolve_rewriter_input_shim,
                        on_reject_rewriter_input_shim,
                    );
                }
                jsc::js_promise::Status::Fulfilled => {
                    self.on_input_end(None);
                }
                jsc::js_promise::Status::Rejected => {
                    promise.set_handled(global.vm());
                    let result = promise.result(global.vm());
                    self.on_input_end(Some(result));
                }
            }
            return Ok(());
        }
        // undefined/null: drained synchronously inside assignToStream.
        self.on_input_end(None);
        Ok(())
    }

    /// Reclaim the `Box<HTMLRewriterInputSink>` leaked in
    /// `start_reading_input`: null the controller's `m_sinkPtr` via
    /// [`JSSink::detach`] so `__finalize` cannot later touch the freed
    /// allocation, then drop the Box. Idempotent.
    fn clear_input_sink(&self) {
        let ptr = self.input_sink.replace(core::ptr::null_mut());
        if ptr.is_null() {
            return;
        }
        // SAFETY: `ptr` is the `Box::leak` from `start_reading_input`; this
        // field is its sole owner and was just nulled.
        let mut sink = unsafe { bun_core::heap::take(ptr) };
        sink.owner = None;
        crate::webcore::sink::JSSink::<HTMLRewriterInputSink>::detach(
            &mut sink.source,
            &self.global,
        );
    }

    fn output_bytes(&self) -> Option<bun_ptr::BackRef<ByteStream>> {
        self.output.get(&self.global).and_then(|s| s.ptr.bytes())
    }

    /// Feed one chunk to the rewriter. Copies first: lol-html tokenizes the
    /// first chunk in place, and a handler that mutates or transfers the
    /// source buffer would corrupt tokens past the cursor.
    fn feed(&self, bytes: &[u8]) {
        let rewriter = self.rewriter.get();
        if rewriter.is_null() {
            return;
        }
        let owned: Vec<u8> = bytes.to_vec();
        // SAFETY: non-null; boxed by `init()` and nulled before it is freed.
        if let Err(e) = unsafe { (*rewriter).write(&owned) } {
            self.fail(create_lolhtml_error(&self.global, &e));
        }
    }

    /// Terminal: `end()` the rewriter on success (flushes the final chunk to
    /// the output ByteStream via `SinkRef`), or propagate `err` via `fail`.
    fn finish(&self, err: Option<JSValue>) {
        if self.failed.get().has() {
            return;
        }
        if let Some(err) = err {
            self.fail(err);
            return;
        }
        let rewriter = self.rewriter.replace(core::ptr::null_mut());
        if rewriter.is_null() {
            if let Some(bytes) = self.output_bytes() {
                let _ = bytes.on_data(streams::Result::Done);
            }
            return;
        }
        // SAFETY: non-null and freshly nulled; sole owner.
        if let Err(e) = unsafe { bun_core::heap::take(rewriter) }.end() {
            self.fail(create_lolhtml_error(&self.global, &e));
        }
    }

    /// Latch the first error: destroy the rewriter, store `err` in `failed`
    /// (for `init()` to throw synchronously), and push it into the output
    /// ByteStream so `.text()`/`.body` reject. Idempotent.
    fn fail(&self, err: JSValue) {
        err.ensure_still_alive();
        let rewriter = self.rewriter.replace(core::ptr::null_mut());
        if !rewriter.is_null() {
            // SAFETY: non-null and freshly nulled; sole owner.
            unsafe { bun_core::heap::destroy(rewriter) };
        }
        if self.failed.get().has() {
            return;
        }
        self.failed
            .with_mut(|f| *f = jsc::strong::Optional::create(err, &self.global));
        if let Some(bytes) = self.output_bytes() {
            let ref_ = jsc::strong::Optional::create(err, &self.global);
            let _ = bytes.on_data(streams::Result::Err(streams::StreamError::JSValue(ref_)));
        }
    }

    /// End-of-input: run `finish` under a `HandlerErrorScope` (so an `end()`
    /// handler that throws is captured), free the input sink, then release
    /// the in-flight +1 taken in `init()`. `self` must not be touched after.
    fn on_input_end(&self, err: Option<JSValue>) {
        let captured = Cell::new(JSValue::ZERO);
        {
            let _scope = HandlerErrorScope::enter(&self.global, &captured);
            self.finish(err);
        }
        self.clear_input_sink();
        // SAFETY: releases the in-flight +1 taken in `init()`.
        unsafe { Self::deref(core::ptr::from_ref(self).cast_mut()) };
    }
}

/// `lol_html::OutputSink` for the rewriter built in [`BufferOutputSink::init`].
/// Writes chunks to the output `ByteStream` (a separate allocation), so the
/// rewriter never re-enters `BufferOutputSink` and `feed`/`finish`/`fail` can
/// take `&self`.
pub struct SinkRef(*mut ByteStream);

impl lol_html::OutputSink for SinkRef {
    fn handle_chunk(&mut self, chunk: &[u8]) {
        // SAFETY: `self.0` points into the `NewSource<ByteStream>` owned by
        // the JS wrapper rooted via `BufferOutputSink::output`; live for the
        // rewriter's whole lifetime.
        let bytes = unsafe { &*self.0 };
        let _ = if chunk.is_empty() {
            bytes.on_data(streams::Result::Done)
        } else {
            bytes.on_data(streams::Result::Temporary(bun_ptr::RawSlice::new(chunk)))
        };
    }
}

impl Drop for BufferOutputSink {
    fn drop(&mut self) {
        let rewriter = self.rewriter.replace(core::ptr::null_mut());
        if !rewriter.is_null() {
            // SAFETY: rewriter heap-allocated by init() and not yet freed
            // (`finish`/`fail` null the field before freeing).
            unsafe { bun_core::heap::destroy(rewriter) };
        }
        self.clear_input_sink();
        self.output.deinit();
        self.failed.with_mut(|f| f.deinit());
    }
}

// ────────────────── HTMLRewriterInputSink (JSSink) ───────────────────────

/// JSSink driving a `ReadableStream` body into `BufferOutputSink::feed` per
/// chunk via the standard `assign_to_stream` pump. Not user-constructible.
pub struct HTMLRewriterInputSink {
    /// Non-owning; the owning `BufferOutputSink` carries a +1 intrusive ref
    /// (taken in `init()`) while this is `Some`. Cleared by the
    /// assign_to_stream-result path before it releases that ref via
    /// `on_input_end`; `finalize` releases it as a fallback.
    owner: Option<bun_ptr::BackRef<BufferOutputSink>>,
    source: streams::SourceHandle,
    ended: bool,
}

impl HTMLRewriterInputSink {
    fn new(owner: &BufferOutputSink) -> Self {
        Self {
            owner: Some(bun_ptr::BackRef::new(owner)),
            source: streams::SourceHandle::default(),
            ended: false,
        }
    }

    fn write_utf8(&mut self, bytes: &[u8]) -> streams::Writable {
        if self.ended {
            return streams::Writable::Done;
        }
        let Some(owner) = self.owner.as_deref() else {
            return streams::Writable::Done;
        };
        let captured = Cell::new(JSValue::ZERO);
        let _scope = HandlerErrorScope::enter(&owner.global, &captured);
        owner.feed(bytes);
        if owner.rewriter.get().is_null() {
            // `fail()` destroyed the rewriter; the latched error surfaces on
            // the pump's next `write`/`end`/`flush` via `get_pending_error`,
            // which throws it so `rsisAbrupt` cancels the source.
            self.ended = true;
        }
        streams::Writable::Owned(bytes.len() as webcore::blob::SizeType)
    }
}

crate::impl_js_sink_abi!(HTMLRewriterInputSink, "HTMLRewriterInputSink");

impl crate::webcore::sink::JsSinkType for HTMLRewriterInputSink {
    const NAME: &'static str = "HTMLRewriterInputSink";

    fn memory_cost(&self) -> usize {
        0
    }

    fn get_pending_error(&mut self) -> Option<JSValue> {
        self.owner.as_deref()?.failed.get().get()
    }

    fn finalize(&mut self) {
        // Reached only when the controller is collected with `m_sinkPtr` still
        // set, i.e. `clear_input_sink` never ran. Null the owner's slot so its
        // `Drop` cannot double-free, release the in-flight +1, then self-free
        // (the `ArrayBufferSink::finalize` pattern).
        if let Some(owner) = self.owner.take() {
            owner.input_sink.set(core::ptr::null_mut());
            // SAFETY: +1 was taken in `BufferOutputSink::init`; `owner` live.
            unsafe { BufferOutputSink::deref(owner.as_ptr()) };
        }
        // SAFETY: `self` is the `Box::leak` from `start_reading_input`; every
        // reaching path left it owned here (`clear_input_sink` nulls
        // `m_sinkPtr` via `detach` before freeing, so cannot precede us).
        unsafe { bun_core::heap::destroy(core::ptr::from_mut(self)) };
    }

    fn write_bytes(&mut self, data: &streams::Result) -> streams::Writable {
        self.write_utf8(data.slice())
    }

    fn write_latin1(&mut self, data: &streams::Result) -> streams::Writable {
        let bytes = data.slice();
        if bun_core::strings::is_all_ascii(bytes) {
            return self.write_utf8(bytes);
        }
        let mut buf = Vec::with_capacity(bytes.len() * 2);
        let _ = bun_collections::ByteVecExt::write_latin1(&mut buf, bytes);
        self.write_utf8(&buf)
    }

    fn write_utf16(&mut self, data: &streams::Result) -> streams::Writable {
        let utf16: &[u16] = bytemuck::cast_slice(data.slice());
        let mut buf = Vec::with_capacity(utf16.len() * 3);
        let _ = bun_collections::ByteVecExt::write_utf16(&mut buf, utf16);
        self.write_utf8(&buf)
    }

    fn end(&mut self, err: Option<bun_sys::Error>) -> bun_sys::Result<()> {
        if core::mem::replace(&mut self.ended, true) {
            return bun_sys::Result::Ok(());
        }
        let sys_err = err;
        self.source.close(sys_err);
        bun_sys::Result::Ok(())
    }

    fn end_from_js(&mut self, _global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    fn flush(&mut self) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }

    fn start(&mut self, _config: streams::Start) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }

    fn source(&mut self) -> Option<&mut streams::SourceHandle> {
        Some(&mut self.source)
    }

    fn done(&self) -> bool {
        self.ended
    }
}

fn on_resolve_rewriter_input(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let this: *mut HTMLRewriterInputSink =
        args[args.len() - 1].as_promise_ptr::<HTMLRewriterInputSink>();
    // SAFETY: `as_promise_ptr` recovers the `input_sink` stashed by `.then()`
    // in `start_reading_input`; `BufferOutputSink.input_sink` owns the Box
    // and `on_input_end` → `clear_input_sink` frees it as the last step.
    if let Some(owner) = unsafe { (*this).owner.take() } {
        owner.on_input_end(None);
    }
    Ok(JSValue::UNDEFINED)
}

fn on_reject_rewriter_input(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let err = args[0];
    let this: *mut HTMLRewriterInputSink =
        args[args.len() - 1].as_promise_ptr::<HTMLRewriterInputSink>();
    // SAFETY: see `on_resolve_rewriter_input`.
    if let Some(owner) = unsafe { (*this).owner.take() } {
        // Pass the rejection through unconditionally: `controller.error()`
        // with no argument rejects with `undefined`, which must still fail
        // the transform rather than close the output as a truncated success.
        owner.on_input_end(Some(err));
    }
    Ok(JSValue::UNDEFINED)
}

bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__HTMLRewriterInput__onResolveStream")]
    unsafe fn on_resolve_rewriter_input_shim(
        g: *mut JSGlobalObject,
        cf: *mut bun_jsc::CallFrame,
    ) -> JSValue {
        match on_resolve_rewriter_input(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__HTMLRewriterInput__onRejectStream")]
    unsafe fn on_reject_rewriter_input_shim(
        g: *mut JSGlobalObject,
        cf: *mut bun_jsc::CallFrame,
    ) -> JSValue {
        match on_reject_rewriter_input(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}

// ──────────────────────── DocumentHandler ────────────────────────────────

pub struct DocumentHandler {
    // Callbacks are GC-rooted via `ProtectedJSValue` (RAII `JSValue::protect`/
    // `unprotect` pair). `Option::None` ⇒ no protect was taken; `Some` drops
    // its guard on field drop, so neither error-path cleanup at init nor a
    // manual `Drop` impl is needed.
    pub(crate) on_doc_type_callback: Option<ProtectedJSValue>,
    pub(crate) on_comment_callback: Option<ProtectedJSValue>,
    pub(crate) on_text_callback: Option<ProtectedJSValue>,
    pub(crate) on_end_callback: Option<ProtectedJSValue>,
    /// Protected only on the success path of `init()`; starts as
    /// `adopt(ZERO)` (drop = unprotect(ZERO) = C++ no-op for non-cells).
    pub(crate) this_object: ProtectedJSValue,
    pub global: GlobalRef, // JSC_BORROW
}

impl DocumentHandler {
    pub(crate) fn on_doc_type(
        this: *mut Self,
        value: *mut lol_html::html_content::Doctype<'static>,
    ) -> bool {
        handler_callback::<Self, DocType, lol_html::html_content::Doctype<'static>>(
            this,
            value,
            |w| w.doctype.set(core::ptr::null_mut()),
            |h| h.on_doc_type_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
    pub(crate) fn on_comment(
        this: *mut Self,
        value: *mut lol_html::html_content::Comment<'static>,
    ) -> bool {
        handler_callback::<Self, Comment, lol_html::html_content::Comment<'static>>(
            this,
            value,
            |w| w.comment.set(core::ptr::null_mut()),
            |h| h.on_comment_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
    pub(crate) fn on_text(
        this: *mut Self,
        value: *mut lol_html::html_content::TextChunk<'static>,
    ) -> bool {
        handler_callback::<Self, TextChunk, lol_html::html_content::TextChunk<'static>>(
            this,
            value,
            |w| w.text_chunk.set(core::ptr::null_mut()),
            |h| h.on_text_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
    pub(crate) fn on_end(
        this: *mut Self,
        value: *mut lol_html::html_content::DocumentEnd<'static>,
    ) -> bool {
        handler_callback::<Self, DocEnd, lol_html::html_content::DocumentEnd<'static>>(
            this,
            value,
            |w| w.doc_end.set(core::ptr::null_mut()),
            |h| h.on_end_callback.as_ref().map(ProtectedJSValue::value),
        )
    }

    pub(crate) fn init(global: &JSGlobalObject, this_object: JSValue) -> JsResult<DocumentHandler> {
        if !this_object.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        // Each `Some(val.protected())` below pairs the gcProtect with the
        // field's own drop, so an early `?` return unprotects exactly the
        // callbacks taken so far — no error-path scopeguard needed.
        let mut handler = DocumentHandler {
            on_doc_type_callback: None,
            on_comment_callback: None,
            on_text_callback: None,
            on_end_callback: None,
            this_object: ProtectedJSValue::adopt(JSValue::ZERO),
            global: GlobalRef::from(global),
        };

        if let Some(val) = this_object.get(global, "doctype")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(
                    global.throw_invalid_arguments(format_args!("doctype must be a function"))
                );
            }
            handler.on_doc_type_callback = Some(val.protected());
        }

        if let Some(val) = this_object.get(global, "comments")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(
                    global.throw_invalid_arguments(format_args!("comments must be a function"))
                );
            }
            handler.on_comment_callback = Some(val.protected());
        }

        if let Some(val) = this_object.get(global, "text")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(global.throw_invalid_arguments(format_args!("text must be a function")));
            }
            handler.on_text_callback = Some(val.protected());
        }

        if let Some(val) = this_object.get(global, "end")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(global.throw_invalid_arguments(format_args!("end must be a function")));
            }
            handler.on_end_callback = Some(val.protected());
        }

        handler.this_object = this_object.protected();
        Ok(handler)
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
    fn global(&self) -> &JSGlobalObject {
        &self.global
    }
    fn this_object(&self) -> JSValue {
        self.this_object.value()
    }
}
impl HandlerLike for ElementHandler {
    fn global(&self) -> &JSGlobalObject {
        &self.global
    }
    fn this_object(&self) -> JSValue {
        self.this_object.value()
    }
}
impl HandlerLike for EndTagHandler {
    fn global(&self) -> &JSGlobalObject {
        &self.global
    }
}

/// Trait abstracting the wrapper-type bits `HandlerCallback` needs.
pub trait WrapperLike {
    type Raw;
    fn init(value: *mut Self::Raw) -> *mut Self;
    fn ref_(&self);
    /// # Safety
    /// `this` must be a live `heap::alloc` allocation with refcount >= 1.
    unsafe fn deref(this: *mut Self);
    /// `jsc.Codegen.JS${T}.toJS` — wraps the *existing* heap allocation `this`
    /// in a JS wrapper (the codegen `${T}__create`). Takes `*mut Self` (not
    /// `&self`) because the C++ side stores the raw heap pointer in `m_ctx`;
    /// deriving it from a `&self` would launder shared-borrow provenance into
    /// the GC's exclusive-owner pointer.
    ///
    /// # Safety
    /// `this` must be a live `heap::alloc` allocation with refcount >= 1.
    unsafe fn to_js(this: *mut Self, global: &JSGlobalObject) -> JSValue;
    /// Some wrapper types (Element) hand out sub-objects that borrow from the
    /// underlying lol-html value and must be detached along with the wrapper
    /// itself. Default: no-op (caller passes a `clear_field` closure instead).
    fn invalidate(&self) {}
    const HAS_INVALIDATE: bool = false;
}

/// Forwarding `WrapperLike` impl — every wrapper type's trait impl is a pure
/// pass-through to inherent / `CellRefCounted`-derived / `JsClass`-codegen
/// methods. The optional `, invalidate`
/// tail wires up types (Element) that hand out sub-objects which must be
/// detached alongside the lol-html value.
macro_rules! impl_wrapper_like {
    ($ty:ty, $raw:ty $(, $invalidate:ident)?) => {
        impl WrapperLike for $ty {
            type Raw = $raw;
            fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
            fn ref_(&self) { self.ref_() }
            unsafe fn deref(this: *mut Self) {
                // SAFETY: `WrapperLike::deref` contract — `this` is a live
                // `heap::alloc` allocation with refcount >= 1.
                unsafe { Self::deref(this) }
            }
            unsafe fn to_js(this: *mut Self, g: &JSGlobalObject) -> JSValue {
                // SAFETY: `this` is a live `heap::alloc` allocation
                // (refcount >= 1); ownership is shared with the GC wrapper via
                // the intrusive refcount (`${T}Class__finalize` →
                // `Self::finalize` → `deref`).
                unsafe { Self::to_js_ptr(this, g) }
            }
            $(
                fn invalidate(&self) { Self::$invalidate(self) }
                const HAS_INVALIDATE: bool = true;
            )?
        }
    };
}

fn handler_callback<H, Z, L>(
    this: *mut H,
    value: *mut L,
    clear_field: impl FnOnce(&Z),
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
            clear_field(&*w);
        }
        Z::deref(w);
    });

    // SAFETY: `this` is the Box<ElementHandler>/Box<DocumentHandler> userdata
    // pointer we registered with lol-html; it lives in LOLHTMLContext for the
    // duration of the rewriter. `&` (not `&mut`) — `cb.call()` below re-enters
    // JS, which may re-enter another `handler_callback` on the same handler
    // (R-2); aliased `&H` is sound, aliased `&mut H` is not.
    let this = unsafe { &*this };
    let global = this.global();
    // Note: re-derive the VM at each use site rather than caching a `&mut`.
    // `cb.call(...)` and `wait_for_promise(...)` re-enter JS / the event loop,
    // which mutate the same VirtualMachine through `global.bun_vm()` (and a
    // nested handler_callback would form its own `&mut VirtualMachine`).
    // Holding a long-lived `&mut` across those calls is two-live-&mut UB under
    // Stacked Borrows, so re-acquire a short-lived borrow at each touch.
    // SAFETY: bun_vm() returns the live VM raw ptr; VM outlives this call.
    let vm = || -> &mut VirtualMachine { global.bun_vm().as_mut() };

    // Use a TopExceptionScope to properly handle exceptions from the JavaScript
    // callback. A post-hoc `try_take_exception()`
    // is *not* equivalent under
    // `BUN_JSC_validateExceptionChecks=1`: `JSGlobalObject__tryTakeException`
    // constructs a fresh `TopExceptionScope` whose ctor calls
    // `verifyExceptionCheckNeedIsSatisfied`, asserting if the preceding
    // `Bun__JSValue__call` ThrowScope's `simulateThrow()` was not yet observed
    // by an enclosing scope. Open the scope here, read
    // the pending exception through it, and clear it explicitly.
    bun_jsc::top_scope!(scope, global);

    let cb = get_callback(this).expect("callback must be set if handler registered");
    let result = match cb.call(
        global,
        this.this_object(),
        // SAFETY: `wrapper` is a live heap allocation (ref'd above; guard deref
        // runs after this call). `to_js` hands the raw pointer to the C++
        // wrapper.
        &[unsafe { Z::to_js(wrapper, global) }],
    ) {
        Ok(v) => v,
        Err(_) => {
            // If there's an exception in the scope, capture it for later retrieval
            if let Some(exc) = scope.exception() {
                let exc_value = JSValue::from_cell(exc.as_ptr());
                // Store the exception in the VM's unhandled rejection capture
                // mechanism if it's available (this is the same mechanism used
                // by BufferOutputSink)
                if let Some(err_ptr) = vm().unhandled_pending_rejection_to_capture {
                    // SAFETY: VM-owned pointer set by BufferOutputSink::init.
                    unsafe { *err_ptr = exc_value };
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
        let exc_value = JSValue::from_cell(exc.as_ptr());
        // Store the exception in the VM's unhandled rejection capture mechanism
        if let Some(err_ptr) = vm().unhandled_pending_rejection_to_capture {
            // SAFETY: VM-owned pointer set by BufferOutputSink::init.
            unsafe { *err_ptr = exc_value };
        }
        // Clear the exception to prevent assertion failures
        scope.clear_exception();
        return true;
    }

    if !result.is_undefined_or_null() {
        // Note: `is_error() || is_aggregate_error(global)` —
        // NOT `isAnyError`, which has different
        // coverage (Exception cells / `Symbol.error` vs cross-realm
        // AggregateError).
        if result.is_error() || result.is_aggregate_error(global) {
            return true;
        }

        if let Some(promise) = result.as_any_promise() {
            vm().wait_for_promise(promise);
            let fail = promise.status() == jsc::js_promise::Status::Rejected;
            if fail {
                vm().unhandled_rejection(global, promise.result(global.vm()), promise.as_value());
            }
            return fail;
        }
    }
    false
}

// ───────────────────────── ElementHandler ────────────────────────────────

pub struct ElementHandler {
    // See `DocumentHandler` — `ProtectedJSValue` fields self-unprotect on drop.
    pub(crate) on_element_callback: Option<ProtectedJSValue>,
    pub(crate) on_comment_callback: Option<ProtectedJSValue>,
    pub(crate) on_text_callback: Option<ProtectedJSValue>,
    pub(crate) this_object: ProtectedJSValue,
    pub global: GlobalRef, // JSC_BORROW
}

impl ElementHandler {
    pub(crate) fn init(global: &JSGlobalObject, this_object: JSValue) -> JsResult<ElementHandler> {
        let mut handler = ElementHandler {
            on_element_callback: None,
            on_comment_callback: None,
            on_text_callback: None,
            this_object: ProtectedJSValue::adopt(JSValue::ZERO),
            global: GlobalRef::from(global),
        };

        if !this_object.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        if let Some(val) = this_object.get(global, "element")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(
                    global.throw_invalid_arguments(format_args!("element must be a function"))
                );
            }
            handler.on_element_callback = Some(val.protected());
        }

        if let Some(val) = this_object.get(global, "comments")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(
                    global.throw_invalid_arguments(format_args!("comments must be a function"))
                );
            }
            handler.on_comment_callback = Some(val.protected());
        }

        if let Some(val) = this_object.get(global, "text")? {
            if val.is_undefined_or_null() || !val.is_cell() || !val.is_callable() {
                return Err(global.throw_invalid_arguments(format_args!("text must be a function")));
            }
            handler.on_text_callback = Some(val.protected());
        }

        handler.this_object = this_object.protected();
        Ok(handler)
    }

    pub(crate) fn on_element(
        this: *mut Self,
        value: *mut lol_html::html_content::Element<'static, 'static>,
    ) -> bool {
        handler_callback::<Self, Element, lol_html::html_content::Element<'static, 'static>>(
            this,
            value,
            |_| {}, // Element uses HAS_INVALIDATE
            |h| h.on_element_callback.as_ref().map(ProtectedJSValue::value),
        )
    }

    pub(crate) fn on_comment(
        this: *mut Self,
        value: *mut lol_html::html_content::Comment<'static>,
    ) -> bool {
        handler_callback::<Self, Comment, lol_html::html_content::Comment<'static>>(
            this,
            value,
            |w| w.comment.set(core::ptr::null_mut()),
            |h| h.on_comment_callback.as_ref().map(ProtectedJSValue::value),
        )
    }

    pub(crate) fn on_text(
        this: *mut Self,
        value: *mut lol_html::html_content::TextChunk<'static>,
    ) -> bool {
        handler_callback::<Self, TextChunk, lol_html::html_content::TextChunk<'static>>(
            this,
            value,
            |w| w.text_chunk.set(core::ptr::null_mut()),
            |h| h.on_text_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
}

// ───────────────────────── ContentOptions ────────────────────────────────

#[derive(Default, Clone, Copy)]
pub struct ContentOptions {
    pub(crate) html: bool,
}

// ────────────────────────── error helpers ────────────────────────────────

fn create_lolhtml_error(global: &JSGlobalObject, message: &dyn core::fmt::Display) -> JSValue {
    // If there was already a pending exception, we want to use that instead.
    if let Some(err) = global.try_take_exception() {
        // it's a synchronous error
        return err;
    }
    // SAFETY: bun_vm() returns the live VM raw ptr; VM outlives this call.
    let vm: &VirtualMachine = global.bun_vm();
    if let Some(err_ptr) = vm.unhandled_pending_rejection_to_capture {
        // SAFETY: VM-owned pointer; valid while VM lives.
        let slot = unsafe { &mut *err_ptr };
        if !slot.is_empty() {
            let result = *slot;
            *slot = JSValue::ZERO;
            return result;
        }
    }

    let err = lol_err_string(message);
    let value = bun_string_jsc::to_error_instance(&err, global);
    value.put(
        global,
        b"name",
        ZigString::init(b"HTMLRewriterError").to_js(global),
    );
    value
}

/// lol-html error `Display` text → owned `bun.String` (a `+1` ref, consumed
/// by `to_error_instance` / `ValueError::Message`).
fn lol_err_string(e: impl core::fmt::Display) -> BunString {
    BunString::clone_utf8(e.to_string().as_bytes())
}

/// UTF-8-validate bytes headed for a lol-html `&str` API. On failure throws
/// an `HTMLRewriterError` carrying the `Utf8Error` `Display` text — the same
/// text lol-html's C API `to_str!` used to stash in its last-error slot.
fn utf8_or_throw<'a>(global: &JSGlobalObject, bytes: &'a [u8]) -> JsResult<&'a str> {
    core::str::from_utf8(bytes).map_err(|e| global.throw_value(create_lolhtml_error(global, &e)))
}

/// Decode a raw-`JSValue` setter argument to owned UTF-8. `to_slice` runs
/// ToString (user `toString()`/`[Symbol.toPrimitive]`), so callers MUST do
/// this BEFORE `cell_get`: the re-entered JS would alias its exclusive `&mut`.
fn setter_utf8_arg(global: &JSGlobalObject, value: JSValue) -> JsResult<String> {
    let slice = value.to_slice(global)?;
    Ok(utf8_or_throw(global, slice.slice())?.to_owned())
}

fn string_to_js(s: &str, global: &JSGlobalObject) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, s.as_bytes())
}

/// lol-html's optional getters (`get_attribute`, `Doctype` name/ids) return
/// `None` for "absent" and `Some("")` for present-but-empty. Map only the
/// former to `null` so `<div a="">` reads as `""`, not `null`.
fn opt_string_to_js_or_null(s: Option<String>, global: &JSGlobalObject) -> JsResult<JSValue> {
    match s {
        None => Ok(JSValue::NULL),
        Some(s) => string_to_js(&s, global),
    }
}

// ─────────────────────────── TextChunk ───────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct TextChunk {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) text_chunk: Cell<*mut RawTextChunk>,
}

impl TextChunk {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(text_chunk: *mut RawTextChunk) -> *mut TextChunk {
        bun_core::heap::into_raw(Box::new(TextChunk {
            ref_count: Cell::new(1),
            text_chunk: Cell::new(text_chunk),
        }))
    }

    lol_content_ops! { RawTextChunk, text_chunk, JSValue::UNDEFINED;
        before / before_,
        after / after_,
        replace / replace_,
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(chunk) = cell_get(&self.text_chunk) else {
            return Ok(JSValue::UNDEFINED);
        };
        chunk.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_text(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(chunk) = cell_get(&self.text_chunk) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(chunk.as_str(), global)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.text_chunk) {
            Some(chunk) => JSValue::from(chunk.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn last_in_text_node(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.text_chunk) {
            Some(chunk) => JSValue::from(chunk.last_in_text_node()),
            None => JSValue::UNDEFINED,
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl_wrapper_like!(TextChunk, RawTextChunk);

// ──────────────────────────── DocType ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct DocType {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) doctype: Cell<*mut RawDoctype>,
}

impl DocType {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    pub(crate) fn init(doctype: *mut RawDoctype) -> *mut DocType {
        bun_core::heap::into_raw(Box::new(DocType {
            ref_count: Cell::new(1),
            doctype: Cell::new(doctype),
        }))
    }

    /// The doctype name.
    #[bun_jsc::host_fn(getter)]
    pub fn name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.name(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn system_id(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.system_id(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn public_id(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.public_id(), global_object)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        dt.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.doctype) {
            Some(dt) => JSValue::from(dt.removed()),
            None => JSValue::UNDEFINED,
        }
    }
}

impl_wrapper_like!(DocType, RawDoctype);

// ──────────────────────────── DocEnd ─────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct DocEnd {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) doc_end: Cell<*mut RawDocumentEnd>,
}

impl DocEnd {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(doc_end: *mut RawDocumentEnd) -> *mut DocEnd {
        bun_core::heap::into_raw(Box::new(DocEnd {
            ref_count: Cell::new(1),
            doc_end: Cell::new(doc_end),
        }))
    }

    lol_content_ops! { RawDocumentEnd, doc_end, JSValue::NULL;
        append / append_,
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl_wrapper_like!(DocEnd, RawDocumentEnd);

// ──────────────────────────── Comment ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct Comment {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) comment: Cell<*mut RawComment>,
}

impl Comment {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(comment: *mut RawComment) -> *mut Comment {
        bun_core::heap::into_raw(Box::new(Comment {
            ref_count: Cell::new(1),
            comment: Cell::new(comment),
        }))
    }

    lol_content_ops! { RawComment, comment, JSValue::NULL;
        before / before_,
        after / after_,
        replace / replace_,
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(comment) = cell_get(&self.comment) else {
            return Ok(JSValue::NULL);
        };
        comment.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_text(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(comment) = cell_get(&self.comment) else {
            return Ok(JSValue::NULL);
        };
        string_to_js(&comment.text(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `CommentPrototype__setText` via `host_setter_result` (which wants
    // `JsResult<()>`); the proc-macro shim would emit a second, conflicting
    // `JsResult<bool>` wrapper.
    pub(crate) fn set_text(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if self.comment.get().is_null() {
            return Ok(());
        }
        let text = setter_utf8_arg(global, value)?;
        let Some(comment) = cell_get(&self.comment) else {
            return Ok(());
        };
        if let Err(e) = comment.set_text(&text) {
            return Err(global.throw_value(create_lolhtml_error(global, &e)));
        }
        Ok(())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.comment) {
            Some(comment) => JSValue::from(comment.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl_wrapper_like!(Comment, RawComment);

// ──────────────────────────── EndTag ─────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct EndTag {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) end_tag: Cell<*mut RawEndTag>,
}

pub struct EndTagHandler {
    // GC-rooted via `ProtectedJSValue` (RAII protect/unprotect), matching
    // `DocumentHandler`/`ElementHandler` — self-unprotects on drop.
    pub callback: Option<ProtectedJSValue>,
    pub global: GlobalRef, // JSC_BORROW
}

impl EndTagHandler {
    pub(crate) fn on_end_tag(this: *mut Self, value: *mut RawEndTag) -> bool {
        handler_callback::<Self, EndTag, RawEndTag>(
            this,
            value,
            |w| w.end_tag.set(core::ptr::null_mut()),
            |h| h.callback.as_ref().map(ProtectedJSValue::value),
        )
    }
}

impl EndTag {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(end_tag: *mut RawEndTag) -> *mut EndTag {
        bun_core::heap::into_raw(Box::new(EndTag {
            ref_count: Cell::new(1),
            end_tag: Cell::new(end_tag),
        }))
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    lol_content_ops! { RawEndTag, end_tag, JSValue::NULL;
        before / before_,
        after / after_,
        replace / replace_,
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(end_tag) = cell_get(&self.end_tag) else {
            return Ok(JSValue::UNDEFINED);
        };
        end_tag.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(end_tag) = cell_get(&self.end_tag) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&end_tag.name(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `EndTagPrototype__setName` via `host_setter_result`.
    pub(crate) fn set_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if self.end_tag.get().is_null() {
            return Ok(());
        }
        let name = setter_utf8_arg(global, value)?;
        let Some(end_tag) = cell_get(&self.end_tag) else {
            return Ok(());
        };
        end_tag.set_name_str(name);
        Ok(())
    }
}

impl_wrapper_like!(EndTag, RawEndTag);

// ───────────────────────── AttributeIterator ─────────────────────────────

/// The JS `AttributeIterator` heap-boxes one of these over `Element::attributes`
/// (the Rust crate exposes a slice, not a boxed iterator like the C API did).
/// Lifetimes are erased; `Element` detaches every iterator before invalidation.
type RawAttributeIterator = core::slice::Iter<'static, lol_html::html_content::Attribute<'static>>;

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = AttributeIterator::destroy_on_zero)]
pub struct AttributeIterator {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) iterator: Cell<*mut RawAttributeIterator>,
}

impl AttributeIterator {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    /// `CellRefCounted::destroy` target — detach the lol-html iterator before
    /// freeing the Box.
    ///
    /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    /// whose generated trait `destroy` upholds the sole-owner contract.
    fn destroy_on_zero(this: *mut Self) {
        // SAFETY: refcount hit zero; sole owner of a `heap::alloc`'d `Self`.
        unsafe {
            (*this).detach();
            drop(bun_core::heap::take(this));
        }
    }

    fn detach(&self) {
        let iterator = self.iterator.replace(core::ptr::null_mut());
        if !iterator.is_null() {
            // SAFETY: `iterator` was `heap::into_raw`'d in
            // `Element::get_attributes`; the Cell is its sole owner and was
            // nulled above, so this runs at most once.
            unsafe { bun_core::heap::destroy(iterator) };
        }
    }

    pub fn finalize(self: Box<Self>) {
        // Refcounted: release the JS wrapper's +1. Hand ownership back to the
        // raw refcount FIRST so a panic in detach() leaks instead of UAF-ing
        // siblings.
        let this = bun_core::heap::release(self);
        this.detach();
        // SAFETY: `this` is the Box-allocated m_ctx payload; the JS wrapper
        // held one ref, which this call releases.
        unsafe { Self::deref(this) };
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn next(
        &self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let done_label = bun_core::ZigString::init(b"done");
        let value_label = bun_core::ZigString::init(b"value");

        let Some(attribute) = cell_get(&self.iterator).and_then(|it| it.next()) else {
            // Exhausted or already detached: free the boxed iterator eagerly
            // (a no-op once the Cell is null), matching the c-api path.
            self.detach();
            return JSValue::create_object2(
                global_object,
                &done_label,
                &value_label,
                JSValue::TRUE,
                JSValue::UNDEFINED,
            );
        };

        let value = attribute.value();
        let name = attribute.name();

        JSValue::create_object2(
            global_object,
            &done_label,
            &value_label,
            JSValue::FALSE,
            bun_string_jsc::to_js_array(
                global_object,
                &[
                    BunString::clone_utf8(name.as_bytes()),
                    BunString::clone_utf8(value.as_bytes()),
                ],
            )?,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_this(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(call_frame.this())
    }
}

// ──────────────────────────── Element ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Element::destroy_on_zero)]
pub struct Element {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) element: Cell<*mut RawElement>,
    /// AttributeIterator instances created by `getAttributes()` that borrow
    /// from `element`. They must be detached in `invalidate()` when the
    /// handler returns so that JS cannot dereference the freed lol-html
    /// attribute buffer.
    /// R-2: `JsCell` (non-Copy `Vec`) — pushed/drained from `&self` host-fns
    /// (`get_attributes`, `set_attribute`, `remove_attribute`). The `with_mut`
    /// closures do not call into JS, so the short `&mut Vec` borrow cannot
    /// overlap a re-entrant access.
    pub(crate) attribute_iterators: JsCell<Vec<*mut AttributeIterator>>,
}

impl Element {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    /// `CellRefCounted::destroy` target — invalidate borrowed sub-objects
    /// before freeing the Box.
    ///
    /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    /// whose generated trait `destroy` upholds the sole-owner contract.
    fn destroy_on_zero(this: *mut Self) {
        // SAFETY: refcount hit zero; sole owner of a `heap::alloc`'d `Self`.
        unsafe {
            (*this).invalidate();
            drop(bun_core::heap::take(this));
        }
    }

    pub(crate) fn init(element: *mut RawElement) -> *mut Element {
        bun_core::heap::into_raw(Box::new(Element {
            ref_count: Cell::new(1),
            element: Cell::new(element),
            attribute_iterators: JsCell::new(Vec::new()),
        }))
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    /// Detach every `AttributeIterator` we handed to JS. Called when the
    /// underlying attribute buffer is about to become invalid — either because
    /// the handler is returning, or because `setAttribute` / `removeAttribute`
    /// is about to mutate the `Vec<Attribute>` the iterators borrow from.
    fn detach_attribute_iterators(&self) {
        // R-2: take the Vec out of the cell, drain on the stack — no `&mut`
        // projection of `self` is held across `detach()`/`deref()` (which do
        // not re-enter JS, but defence-in-depth keeps the JsCell borrow zero-len).
        let iters = self.attribute_iterators.replace(Vec::new());
        for iter in iters {
            // SAFETY: iter is a live AttributeIterator we ref'd in get_attributes();
            // ref_count >= 1 so the allocation is valid here.
            unsafe { (*iter).detach() };
            // SAFETY: `iter` is a live AttributeIterator we ref'd in
            // `get_attributes()`; release that ref.
            unsafe { AttributeIterator::deref(iter) };
        }
    }

    /// Called by `handler_callback` when the handler returns. The underlying
    /// `*LOLHTML.Element` (and the attribute buffer any `AttributeIterator`
    /// borrows from) is only valid during handler execution, so we must null
    /// it out here along with any iterators we handed to JS.
    pub(crate) fn invalidate(&self) {
        self.element.set(core::ptr::null_mut());
        self.detach_attribute_iterators();
        self.attribute_iterators.set(Vec::new());
    }

    pub(crate) fn on_end_tag_(
        &self,
        global_object: &JSGlobalObject,
        function: JSValue,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::NULL);
        };
        if function.is_undefined_or_null() || !function.is_callable() {
            return Err(global_object.throw_type_error(format_args!("Expected a function")));
        }

        // `None` iff the element is void (`!can_have_content`) — the exact
        // condition lol-html's C API mapped to the "No end tag." error.
        let Some(handlers) = el.end_tag_handlers() else {
            let err = create_lolhtml_error(global_object, &"No end tag.");
            return Err(global_object.throw_value(err));
        };

        // `onEndTag()` replaces any previously registered handler
        // (clear-then-add, as the C API did).
        handlers.clear();

        // The `FnOnce` box owns the handler; dropping it (whether or not
        // lol-html ever invokes it) unprotects `callback` via `ProtectedJSValue`.
        let mut end_tag_handler = EndTagHandler {
            global: GlobalRef::from(global_object),
            callback: Some(function.protected()),
        };
        handlers.push(Box::new(move |end_tag| {
            // SAFETY: lifetime erasure. `end_tag` only lives for this
            // synchronous call; `handler_callback`'s `clear_field` nulls the
            // `EndTag` JsClass `Cell` before this closure returns, so JS can
            // never reach the erased pointer afterwards.
            let raw: *mut RawEndTag = core::ptr::from_mut(end_tag).cast();
            directive_result(EndTagHandler::on_end_tag(
                core::ptr::from_mut(&mut end_tag_handler),
                raw,
            ))
        }));

        Ok(call_frame.this())
    }

    /// Returns the value for a given attribute name on the element, or null if it is not found.
    pub(crate) fn get_attribute_(
        &self,
        global_object: &JSGlobalObject,
        name: ZigString,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::NULL);
        };
        let slice = name.to_slice();
        // A non-UTF-8 name came back from the C API as a null-data `Str`,
        // which JS saw as `null` — not a throw. Keep that distinction.
        let Ok(name) = core::str::from_utf8(slice.slice()) else {
            return Ok(JSValue::NULL);
        };
        opt_string_to_js_or_null(el.get_attribute(name), global_object)
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub(crate) fn has_attribute_(
        &self,
        global: &JSGlobalObject,
        name: ZigString,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::FALSE);
        };
        let slice = name.to_slice();
        let name = utf8_or_throw(global, slice.slice())?;
        Ok(JSValue::from(el.has_attribute(name)))
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub(crate) fn set_attribute_(
        &self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name_: ZigString,
        value_: ZigString,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };

        // Mutating the attribute Vec (push → possible realloc) invalidates the
        // slice::Iter any live AttributeIterator borrows from.
        self.detach_attribute_iterators();

        let name_slice = name_.to_slice();
        let value_slice = value_.to_slice();
        let name = utf8_or_throw(global_object, name_slice.slice())?;
        let value = utf8_or_throw(global_object, value_slice.slice())?;
        if let Err(e) = el.set_attribute(name, value) {
            let err = create_lolhtml_error(global_object, &e);
            return Err(global_object.throw_value(err));
        }
        Ok(call_frame.this())
    }

    /// Removes the attribute.
    pub(crate) fn remove_attribute_(
        &self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name: ZigString,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };

        // Vec::remove shifts trailing elements and shrinks len, leaving any
        // live slice::Iter's end pointer past the new end.
        self.detach_attribute_iterators();

        let name_slice = name.to_slice();
        let name = utf8_or_throw(global_object, name_slice.slice())?;
        el.remove_attribute(name);
        Ok(call_frame.this())
    }

    // ── instance-method arg-decode wrappers (attribute ops) ──────────────

    pub(crate) fn on_end_tag(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let function = eat_js_value(&mut iter, global)?;
        self.on_end_tag_(global, function, call_frame)
    }

    pub(crate) fn get_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        self.get_attribute_(global, name)
    }

    pub(crate) fn has_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        self.has_attribute_(global, name)
    }

    pub(crate) fn set_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        let value = eat_zig_string(&mut iter, global)?;
        self.set_attribute_(call_frame, global, name, value)
    }

    pub(crate) fn remove_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        self.remove_attribute_(call_frame, global, name)
    }

    lol_content_ops! { RawElement, element, JSValue::UNDEFINED;
        /// Inserts content before the element.
        before / before_,
        /// Inserts content right after the element.
        after / after_,
        /// Inserts content right after the start tag of the element.
        prepend / prepend_,
        /// Inserts content right before the end tag of the element.
        append / append_,
        /// Removes the element and inserts content in place of it.
        replace / replace_,
        /// Replaces content of the element.
        set_inner_content / set_inner_content_,
    }

    /// Removes the element with all its content.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        el.remove();
        Ok(call_frame.this())
    }

    /// Removes the start tag and end tag of the element but keeps its inner content intact.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove_and_keep_content(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        el.remove_and_keep_content();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_tag_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&el.tag_name(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `ElementPrototype__setTagName` via `host_setter_result`.
    pub(crate) fn set_tag_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if self.element.get().is_null() {
            return Ok(());
        }
        let name = setter_utf8_arg(global, value)?;
        let Some(el) = cell_get(&self.element) else {
            return Ok(());
        };
        if let Err(e) = el.set_tag_name(&name) {
            return Err(global.throw_value(create_lolhtml_error(global, &e)));
        }
        Ok(())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_removed(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.element) {
            Some(el) => JSValue::from(el.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_self_closing(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.element) {
            Some(el) => JSValue::from(el.is_self_closing()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_can_have_content(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.element) {
            Some(el) => JSValue::from(el.can_have_content()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_namespace_uri(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(el.namespace_uri(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_attributes(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };

        // `cell_get`'s erased `'static` carries through `attributes()`. The
        // boxed iterator never outlives the real attribute buffer: it is
        // tracked below and detached in `invalidate()` (when the handler
        // returns) and before any attribute mutation.
        let attrs: &'static [lol_html::html_content::Attribute<'static>] = el.attributes();
        let iter = bun_core::heap::into_raw(Box::new(attrs.iter()));
        let attr_iter = bun_core::heap::into_raw(Box::new(AttributeIterator {
            ref_count: Cell::new(1),
            iterator: Cell::new(iter),
        }));
        // Track this iterator so we can detach it when the handler returns.
        // lol-html's attribute slice borrows from the element's token buffer
        // which is freed after the callback; leaking the iterator to JS
        // without detaching it would be a use-after-free.
        // SAFETY: attr_iter is a fresh heap::alloc allocation (refcount==1).
        unsafe { (*attr_iter).ref_() };
        // R-2: `with_mut` — closure does not call into JS (push only).
        self.attribute_iterators.with_mut(|v| v.push(attr_iter));
        // SAFETY: attr_iter is live (refcount==2 now); ownership is shared with
        // the GC wrapper via the intrusive refcount (`finalize` → `deref`).
        Ok(unsafe { AttributeIterator::to_js_ptr(attr_iter, global_object) })
    }
}

impl_wrapper_like!(Element, RawElement, invalidate);
