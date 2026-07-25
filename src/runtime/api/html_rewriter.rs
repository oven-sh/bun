//! HTMLRewriter API — wraps lol-html for JS.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use std::rc::Rc;

use bun_jsc::{
    self as jsc, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, ProtectedJSValue,
    bun_string_jsc,
};
// Note: `bun_jsc::VirtualMachine` is a *module* re-export
// (`pub use self::virtual_machine as VirtualMachine;`). The struct lives at
// `bun_jsc::virtual_machine::VirtualMachine` — import that directly so the
// name resolves as a type at `&mut VirtualMachine` annotations and as the
// owner of the `on_quiet_unhandled_rejection_handler_capture_value` assoc fn.
use bun_jsc::virtual_machine::VirtualMachine;

use crate::webcore::ByteStream;
use crate::webcore::response::HeadersRef;
use crate::webcore::resumable_sink::{
    ResumableHTMLRewriterSink, ResumableSinkBackpressure, ResumableSinkContext,
};
use crate::webcore::{self, ReadableStream, Response, streams};
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
    pub selectors: Vec<lol_html::Selector>,
    // The `Box` is load-bearing: the lol-html handler closures produced by
    // `build_settings` capture raw pointers into the box interiors; unboxing
    // would dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    pub element_handlers: Vec<Box<ElementHandler>>,
    #[expect(clippy::vec_box)]
    pub document_handlers: Vec<Box<DocumentHandler>>,
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
    pub context: Rc<RefCell<LOLHTMLContext>>,
}

impl HTMLRewriter {
    // Note: no `#[bun_jsc::host_fn]` here — `#[bun_jsc::JsClass]` on the
    // struct already emits the C-ABI constructor shim that calls
    // `<HTMLRewriter>::constructor(__g, __f)`.
    pub fn constructor(
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

    pub fn on_(
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

    pub fn on_document_(
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

    pub fn begin_transform(
        &self,
        global: &JSGlobalObject,
        response: &mut Response,
    ) -> JsResult<JSValue> {
        let new_context = Rc::clone(&self.context);
        // SAFETY: `response` is a live `Response` whose JS wrapper is on
        // the caller's stack (see `transform_`).
        unsafe { BufferOutputSink::init(new_context, global, response) }
    }

    pub fn transform_(
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
            // on the stack via ensure_still_alive above).
            let mut blob = unsafe {
                (*out_response)
                    .get_body_value()
                    .use_as_any_blob_allow_non_utf8_string()
            };

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

    pub fn on(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let selector_name = eat_zig_string(&mut iter, global)?;
        let listener = eat_js_value(&mut iter, global)?;
        self.on_(global, selector_name, call_frame, listener)
    }

    pub fn on_document(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let listener = eat_js_value(&mut iter, global)?;
        self.on_document_(global, listener, call_frame)
    }

    pub fn transform(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let response_value = eat_js_value(&mut iter, global)?;
        self.transform_(global, response_value)
    }
}

// ───────────────────────── BufferOutputSink ──────────────────────────────

/// Drives one `HTMLRewriter.transform()` call: pulls input chunks from the
/// source body via `ResumableSink`, feeds them to lol-html, and delivers the
/// rewritten output to a `ByteStream` that backs the returned `Response` body.
///
/// The rewriter's `OutputSink` writes to that `ByteStream` (a separate
/// allocation), not back into this struct, so driving the rewriter never
/// re-enters its owner. lol-html itself is still borrowed exclusively during
/// `write()`/`end()`; `writing` + `pending_*` guard the one path
/// (`wait_for_promise` inside a handler on the `Source::Bytes` native pipe)
/// that can deliver the next input chunk while a `write()` is on the stack.
#[derive(bun_ptr::CellRefCounted)]
pub struct BufferOutputSink {
    ref_count: Cell<u32>,
    pub global: GlobalRef,
    rewriter: Cell<*mut lol_html::HtmlRewriter<'static, SinkRef>>,
    pub context: Rc<RefCell<LOLHTMLContext>>,
    /// GC root for the output `ByteStream`'s JS wrapper; `SinkRef` writes to
    /// its `context` payload via [`output_bytes`](Self::output_bytes).
    output: webcore::readable_stream::Strong,
    writing: Cell<bool>,
    pending_input: Cell<Vec<u8>>,
    pending_end: Cell<Option<Option<JSValue>>>,
}

impl ResumableSinkContext for BufferOutputSink {
    fn write_request_data(this: *mut Self, bytes: &[u8]) -> ResumableSinkBackpressure {
        // SAFETY: `this` is the live context registered in `ResumableSink::init`.
        unsafe { Self::feed(this, bytes) };
        ResumableSinkBackpressure::WantMore
    }

    fn write_end_request(this: *mut Self, err: Option<JSValue>) {
        // SAFETY: `this` is the live context registered in `ResumableSink::init`.
        if unsafe { (*this).writing.get() } {
            if let Some(err) = err {
                err.ensure_still_alive();
            }
            // SAFETY: see above.
            unsafe { (*this).pending_end.set(Some(err)) };
            return;
        }
        // SAFETY: `this` is live; the +1 taken for the in-flight reader in
        // `init()` is consumed here.
        unsafe { Self::finish(this, err) };
    }
}

impl BufferOutputSink {
    /// # Safety
    /// `original` must point to a live `Response` whose JS wrapper is kept
    /// alive for the duration of this call.
    unsafe fn init(
        context: Rc<RefCell<LOLHTMLContext>>,
        global: &JSGlobalObject,
        original: *mut Response,
    ) -> JsResult<JSValue> {
        // The output Response body is a ByteStream from the start so `SinkRef`
        // never reaches back into this struct and every consumer path
        // (`.text()`, `.body.getReader()`, `Bun.serve`) reads the same stream.
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

        // SAFETY: original is a live *Response passed from begin_transform; its
        // JS wrapper is on the caller's stack.
        let input_size = unsafe { (*original).get_body_len() };

        let sink = bun_core::heap::into_raw(Box::new(BufferOutputSink {
            ref_count: Cell::new(1),
            global: GlobalRef::from(global),
            rewriter: Cell::new(core::ptr::null_mut()),
            context,
            output: webcore::readable_stream::Strong::init(out_readable, global),
            writing: Cell::new(false),
            pending_input: Cell::new(Vec::new()),
            pending_end: Cell::new(None),
        }));
        // SAFETY: `sink` is the `heap::into_raw` allocation above; refcount == 1.
        let _sink_guard = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::adopt(sink) };

        // The handler closures point into `Box`es owned by `(*sink).context`,
        // which `sink` keeps alive for the rewriter's whole lifetime.
        // SAFETY: sink is a live heap allocation (refcount >= 1); the `RefMut`
        // of `(*sink).context` is released at the end of this statement.
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
        // SAFETY: sink is a live heap allocation (refcount >= 1).
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

        // SAFETY: result and original are both live *Response (result allocated
        // above, original kept alive by caller); no aliasing &mut exists.
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
        // SAFETY: `result` is a live heap allocation; `to_js` transfers
        // ownership to the JS wrapper.
        let response_js_value = unsafe { (*result).to_js(global) };
        response_js_value.ensure_still_alive();

        // `handler_callback` runs user JS via `wait_for_promise`; capture any
        // handler error while `feed`/`finish` drive the rewriter.
        // SAFETY: bun_vm() returns the live VM raw ptr; VM outlives this fn.
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let scope = vm.unhandled_rejection_scope();
        let prev_capture = vm.unhandled_pending_rejection_to_capture;
        let sink_error: Cell<JSValue> = Cell::new(JSValue::ZERO);
        vm.unhandled_pending_rejection_to_capture = Some(sink_error.as_ptr());
        vm.on_unhandled_rejection =
            VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        scopeguard::defer! {
            sink_error.get().ensure_still_alive();
            let vm = VirtualMachine::get().as_mut();
            vm.unhandled_pending_rejection_to_capture = prev_capture;
            scope.apply(vm);
        }

        // SAFETY: original is a live *Response kept alive by caller.
        let value = unsafe { (*original).get_body_value() };
        let owned_readable_stream =
            // SAFETY: original is a live *Response kept alive by caller.
            unsafe { (*original).get_body_readable_stream(global) };

        // SAFETY: sink is a live heap allocation (refcount >= 1). `new` bumps;
        // `forget` hands the +1 to whatever calls `finish` (consumed there by
        // `ScopedRef::adopt`).
        let in_flight = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::new(sink) };
        // SAFETY: sink is a live heap allocation.
        unsafe { Self::start_reading_input(sink, value, owned_readable_stream)? };
        in_flight.forget();

        let captured = sink_error.get();
        if !captured.is_empty() {
            captured.ensure_still_alive();
            captured.unprotect();
            return Err(global.throw_value(captured));
        }

        response_js_value.ensure_still_alive();
        Ok(response_js_value)
    }

    /// # Safety
    /// `sink` must be a live `BufferOutputSink` heap allocation with
    /// refcount > 0; `(*sink).rewriter` must be set. The +1 taken for the
    /// in-flight reader in `init()` is consumed by `finish` on every path.
    unsafe fn start_reading_input(
        sink: *mut Self,
        value: &mut webcore::body::Value,
        owned_readable_stream: Option<ReadableStream>,
    ) -> JsResult<()> {
        // SAFETY: sink is a live heap allocation (refcount > 0, caller invariant).
        let global = unsafe { (*sink).global };

        let readable_stream = if let Some(stream) = owned_readable_stream {
            stream
        } else {
            value.to_blob_if_possible();
            if let webcore::body::Value::WTFStringImpl(_)
            | webcore::body::Value::InternalBlob(_)
            | webcore::body::Value::Blob(_) = value
            {
                // Materialised bodies run the rewrite synchronously so that
                // `transform(String | ArrayBuffer)` (which reads the output
                // body back as a blob before returning) keeps its synchronous
                // contract.
                let mut input = value.use_as_any_blob_allow_non_utf8_string();
                if !input.needs_to_read_file() {
                    // SAFETY: see fn safety contract.
                    unsafe { Self::feed(sink, input.slice()) };
                    input.detach();
                    // SAFETY: see fn safety contract.
                    unsafe { Self::finish(sink, None) };
                    return Ok(());
                }
                *value = webcore::body::Value::Blob(match input {
                    webcore::AnyBlob::Blob(b) => b,
                    _ => unreachable!(),
                });
            }
            let js_stream = value.to_readable_stream(&global)?;
            if js_stream.is_null() {
                // SAFETY: see fn safety contract.
                unsafe { Self::finish(sink, None) };
                return Ok(());
            }
            match ReadableStream::from_js(js_stream, &global)? {
                Some(stream) => stream,
                None => {
                    // SAFETY: see fn safety contract.
                    unsafe { Self::finish(sink, None) };
                    return Ok(());
                }
            }
        };

        if !matches!(value, webcore::body::Value::Error(_)) {
            *value = webcore::body::Value::Used;
        }
        // The in-flight +1 on `BufferOutputSink` keeps `context` valid until
        // `write_end_request` fires; the sink's own lifecycle (pipe ref / JS
        // wrapper) governs its allocation.
        let _ = ResumableHTMLRewriterSink::init(&global, readable_stream, sink);
        Ok(())
    }

    /// Feed one input chunk to lol-html.
    ///
    /// A re-entrant call (handler `wait_for_promise` draining the next
    /// `Source::Bytes` pipe chunk) spills into `pending_input`; the outer call
    /// drains it after `write()` returns. The JS-pump path cannot re-enter
    /// (`JSResumableSinkPumpOperation::m_reading` guards the drain loop and the
    /// next `resumableIssueRead` is not issued until `sink.write()` returns).
    ///
    /// # Safety
    /// `sink` must be a live `BufferOutputSink` heap allocation (refcount > 0).
    unsafe fn feed(sink: *mut Self, bytes: &[u8]) {
        // SAFETY: sink is a live heap allocation (refcount > 0, caller invariant).
        let this = unsafe { &*sink };
        if this.writing.get() {
            let mut spill = this.pending_input.take();
            spill.extend_from_slice(bytes);
            this.pending_input.set(spill);
            return;
        }
        if this.rewriter.get().is_null() {
            return;
        }
        this.writing.set(true);
        if let Err(e) = Self::rewrite(this, bytes) {
            Self::fail(this, e);
        }
        loop {
            let spill = this.pending_input.take();
            if spill.is_empty() || this.rewriter.get().is_null() {
                break;
            }
            if let Err(e) = Self::rewrite(this, &spill) {
                Self::fail(this, e);
                break;
            }
        }
        this.writing.set(false);
        if let Some(end) = this.pending_end.take() {
            // SAFETY: see fn safety contract.
            unsafe { Self::finish(sink, end) };
        }
    }

    /// Drive one `HtmlRewriter::write()` under a handler-error capture scope so
    /// a thrown / rejected handler surfaces its original JS error instead of
    /// the generic "rewriter has been stopped" lol-html wrapper.
    fn rewrite(this: &Self, bytes: &[u8]) -> Result<(), JSValue> {
        let global = this.global;
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let prev_capture = vm.unhandled_pending_rejection_to_capture;
        let captured: Cell<JSValue> = Cell::new(JSValue::ZERO);
        vm.unhandled_pending_rejection_to_capture = Some(captured.as_ptr());
        let prev_handler = vm.on_unhandled_rejection;
        vm.on_unhandled_rejection =
            VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        scopeguard::defer! {
            let vm = VirtualMachine::get().as_mut();
            vm.unhandled_pending_rejection_to_capture = prev_capture;
            vm.on_unhandled_rejection = prev_handler;
        }

        let rewriter = this.rewriter.get();
        // SAFETY: rewriter heap-allocated by init(), non-null (checked by
        // caller), not yet freed.
        let result = unsafe { (*rewriter).write(bytes) };
        match result {
            Ok(()) => Ok(()),
            Err(e) => {
                let err = captured.get();
                if !err.is_empty() {
                    err.ensure_still_alive();
                    err.unprotect();
                    Err(err)
                } else {
                    Err(create_lolhtml_error(&global, &e))
                }
            }
        }
    }

    /// Close the transform: consume the rewriter with `end()` (emits the final
    /// empty chunk, which `SinkRef` forwards as `Done`), or push an upstream
    /// error to the output stream.
    ///
    /// # Safety
    /// `sink` must be a live `BufferOutputSink` heap allocation with
    /// refcount > 0 (the +1 taken in `init()` is consumed here).
    unsafe fn finish(sink: *mut Self, err: Option<JSValue>) {
        // SAFETY: `sink` was ref'd in `init()`; `adopt` consumes that +1 on Drop.
        let _g = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::adopt(sink) };
        // SAFETY: sink is a live heap allocation (refcount > 0).
        let this = unsafe { &*sink };

        if let Some(err) = err {
            Self::fail(this, err);
            return;
        }

        let rewriter = this.rewriter.replace(core::ptr::null_mut());
        if rewriter.is_null() {
            return;
        }
        // SAFETY: `rewriter` was heap-allocated by init(); sole owner now.
        if let Err(e) = unsafe { bun_core::heap::take(rewriter) }.end() {
            Self::fail(this, create_lolhtml_error(&this.global, &e));
        }
    }

    fn output_bytes(&self) -> Option<bun_ptr::BackRef<ByteStream>> {
        self.output.get(&self.global).and_then(|s| s.ptr.bytes())
    }

    fn fail(this: &Self, err: JSValue) {
        err.ensure_still_alive();
        let rewriter = this.rewriter.replace(core::ptr::null_mut());
        if !rewriter.is_null() {
            // SAFETY: rewriter heap-allocated by init() and not yet freed.
            unsafe { bun_core::heap::destroy(rewriter) };
        }
        if let Some(bytes) = this.output_bytes() {
            let ref_ = jsc::strong::Optional::create(err, &this.global);
            let _ = bytes.on_data(streams::Result::Err(streams::StreamError::JSValue(ref_)));
        }
    }
}

/// `lol_html::OutputSink` for the rewriter built in [`BufferOutputSink::init`].
/// Writes to the output `ByteStream` (rooted via `BufferOutputSink::output`),
/// not back into its owner, so driving the rewriter never re-enters
/// `BufferOutputSink`.
pub struct SinkRef(*mut ByteStream);

impl lol_html::OutputSink for SinkRef {
    fn handle_chunk(&mut self, chunk: &[u8]) {
        // SAFETY: `self.0` is the `NewSource<ByteStream>` payload rooted by
        // `BufferOutputSink::output` for as long as the rewriter lives.
        // `ByteStream::on_data` takes `&self` (interior-mutable).
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
        let rewriter = self.rewriter.get();
        if !rewriter.is_null() {
            // SAFETY: rewriter heap-allocated by init() and not yet freed
            // (`finish`/`fail` null the field before consuming it).
            unsafe { bun_core::heap::destroy(rewriter) };
        }
        self.output.deinit();
    }
}

// ──────────────────────── DocumentHandler ────────────────────────────────

pub struct DocumentHandler {
    // Callbacks are GC-rooted via `ProtectedJSValue` (RAII `JSValue::protect`/
    // `unprotect` pair). `Option::None` ⇒ no protect was taken; `Some` drops
    // its guard on field drop, so neither error-path cleanup at init nor a
    // manual `Drop` impl is needed.
    pub on_doc_type_callback: Option<ProtectedJSValue>,
    pub on_comment_callback: Option<ProtectedJSValue>,
    pub on_text_callback: Option<ProtectedJSValue>,
    pub on_end_callback: Option<ProtectedJSValue>,
    /// Protected only on the success path of `init()`; starts as
    /// `adopt(ZERO)` (drop = unprotect(ZERO) = C++ no-op for non-cells).
    pub this_object: ProtectedJSValue,
    pub global: GlobalRef, // JSC_BORROW
}

impl DocumentHandler {
    pub fn on_doc_type(
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
    pub fn on_comment(
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
    pub fn on_text(
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
    pub fn on_end(
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

    pub fn init(global: &JSGlobalObject, this_object: JSValue) -> JsResult<DocumentHandler> {
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
        let exc_value = JSValue::from_cell(exc.as_ptr());
        // Store the exception in the VM's unhandled rejection capture mechanism
        if let Some(err_ptr) = vm().unhandled_pending_rejection_to_capture {
            // SAFETY: VM-owned pointer set by BufferOutputSink::init.
            unsafe { *err_ptr = exc_value };
            exc_value.protect();
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
    pub on_element_callback: Option<ProtectedJSValue>,
    pub on_comment_callback: Option<ProtectedJSValue>,
    pub on_text_callback: Option<ProtectedJSValue>,
    pub this_object: ProtectedJSValue,
    pub global: GlobalRef, // JSC_BORROW
}

impl ElementHandler {
    pub fn init(global: &JSGlobalObject, this_object: JSValue) -> JsResult<ElementHandler> {
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

    pub fn on_element(
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

    pub fn on_comment(
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

    pub fn on_text(
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
    pub html: bool,
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
            // it's a promise rejection
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
    pub text_chunk: Cell<*mut RawTextChunk>,
}

impl TextChunk {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(text_chunk: *mut RawTextChunk) -> *mut TextChunk {
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
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(chunk) = cell_get(&self.text_chunk) else {
            return Ok(JSValue::UNDEFINED);
        };
        chunk.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_text(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(chunk) = cell_get(&self.text_chunk) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(chunk.as_str(), global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.text_chunk) {
            Some(chunk) => JSValue::from(chunk.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn last_in_text_node(&self, _global: &JSGlobalObject) -> JSValue {
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
    pub doctype: Cell<*mut RawDoctype>,
}

impl DocType {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    pub fn init(doctype: *mut RawDoctype) -> *mut DocType {
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
    pub fn system_id(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.system_id(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn public_id(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.public_id(), global_object)
    }

    #[bun_jsc::host_fn(method)]
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(dt) = cell_get(&self.doctype) else {
            return Ok(JSValue::UNDEFINED);
        };
        dt.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
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
    pub doc_end: Cell<*mut RawDocumentEnd>,
}

impl DocEnd {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(doc_end: *mut RawDocumentEnd) -> *mut DocEnd {
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
    pub comment: Cell<*mut RawComment>,
}

impl Comment {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(comment: *mut RawComment) -> *mut Comment {
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
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(comment) = cell_get(&self.comment) else {
            return Ok(JSValue::NULL);
        };
        comment.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_text(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(comment) = cell_get(&self.comment) else {
            return Ok(JSValue::NULL);
        };
        string_to_js(&comment.text(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `CommentPrototype__setText` via `host_setter_result` (which wants
    // `JsResult<()>`); the proc-macro shim would emit a second, conflicting
    // `JsResult<bool>` wrapper.
    pub fn set_text(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
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
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
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
    pub end_tag: Cell<*mut RawEndTag>,
}

pub struct EndTagHandler {
    // GC-rooted via `ProtectedJSValue` (RAII protect/unprotect), matching
    // `DocumentHandler`/`ElementHandler` — self-unprotects on drop.
    pub callback: Option<ProtectedJSValue>,
    pub global: GlobalRef, // JSC_BORROW
}

impl EndTagHandler {
    pub fn on_end_tag(this: *mut Self, value: *mut RawEndTag) -> bool {
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

    pub fn init(end_tag: *mut RawEndTag) -> *mut EndTag {
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
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(end_tag) = cell_get(&self.end_tag) else {
            return Ok(JSValue::UNDEFINED);
        };
        end_tag.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(end_tag) = cell_get(&self.end_tag) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&end_tag.name(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `EndTagPrototype__setName` via `host_setter_result`.
    pub fn set_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
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
    pub iterator: Cell<*mut RawAttributeIterator>,
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
    pub fn next(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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
    pub fn get_this(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
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
    pub element: Cell<*mut RawElement>,
    /// AttributeIterator instances created by `getAttributes()` that borrow
    /// from `element`. They must be detached in `invalidate()` when the
    /// handler returns so that JS cannot dereference the freed lol-html
    /// attribute buffer.
    /// R-2: `JsCell` (non-Copy `Vec`) — pushed/drained from `&self` host-fns
    /// (`get_attributes`, `set_attribute`, `remove_attribute`). The `with_mut`
    /// closures do not call into JS, so the short `&mut Vec` borrow cannot
    /// overlap a re-entrant access.
    pub attribute_iterators: JsCell<Vec<*mut AttributeIterator>>,
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

    pub fn init(element: *mut RawElement) -> *mut Element {
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
    pub fn invalidate(&self) {
        self.element.set(core::ptr::null_mut());
        self.detach_attribute_iterators();
        self.attribute_iterators.set(Vec::new());
    }

    pub fn on_end_tag_(
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
    pub fn get_attribute_(
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
    pub fn has_attribute_(&self, global: &JSGlobalObject, name: ZigString) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::FALSE);
        };
        let slice = name.to_slice();
        let name = utf8_or_throw(global, slice.slice())?;
        Ok(JSValue::from(el.has_attribute(name)))
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn set_attribute_(
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
    pub fn remove_attribute_(
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

    pub fn on_end_tag(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let function = eat_js_value(&mut iter, global)?;
        self.on_end_tag_(global, function, call_frame)
    }

    pub fn get_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        self.get_attribute_(global, name)
    }

    pub fn has_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        self.has_attribute_(global, name)
    }

    pub fn set_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_zig_string(&mut iter, global)?;
        let value = eat_zig_string(&mut iter, global)?;
        self.set_attribute_(call_frame, global, name, value)
    }

    pub fn remove_attribute(
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
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        el.remove();
        Ok(call_frame.this())
    }

    /// Removes the start tag and end tag of the element but keeps its inner content intact.
    #[bun_jsc::host_fn(method)]
    pub fn remove_and_keep_content(
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
    pub fn get_tag_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&el.tag_name(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `ElementPrototype__setTagName` via `host_setter_result`.
    pub fn set_tag_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
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
    pub fn get_removed(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.element) {
            Some(el) => JSValue::from(el.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_self_closing(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.element) {
            Some(el) => JSValue::from(el.is_self_closing()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_can_have_content(&self, _global: &JSGlobalObject) -> JSValue {
        match cell_get(&self.element) {
            Some(el) => JSValue::from(el.can_have_content()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_namespace_uri(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = cell_get(&self.element) else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(el.namespace_uri(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_attributes(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
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
