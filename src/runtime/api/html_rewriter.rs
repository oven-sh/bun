//! HTMLRewriter API — wraps lol-html for JS.
//!
//! Ported from src/runtime/api/html_rewriter.zig.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use std::io::Write as _;
use std::rc::Rc;

use bun_collections::linear_fifo::DynamicBuffer;
use bun_collections::{ByteVecExt, LinearFifo, VecExt};
use bun_core::MutableString;
use bun_jsc::{
    self as jsc, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, ProtectedJSValue,
    StringJsc as _, StrongOptional, SystemError, bun_string_jsc,
};
// PORT NOTE: `bun_jsc::VirtualMachine` is a *module* re-export
// (`pub use self::virtual_machine as VirtualMachine;`). The struct lives at
// `bun_jsc::virtual_machine::VirtualMachine` — import that directly so the
// name resolves as a type at `&mut VirtualMachine` annotations and as the
// owner of the `on_quiet_unhandled_rejection_handler_capture_value` assoc fn.
use bun_jsc::virtual_machine::VirtualMachine;
// `ZigString` re-exports `bun_core::ZigString`; JSC-side methods
// (`to_js`, `with_encoding`, …) come from the `ZigStringJsc` extension trait.
use bun_jsc::ZigStringJsc as _;
use bun_jsc::zig_string::ZigString;
// PORT NOTE: there is no `bun_lolhtml` safe-wrapper crate yet — the safe
// surface lives directly in `bun_lolhtml_sys::lol_html`. The Phase-A draft
// referenced both `lolhtml::Foo` (safe wrappers) and `lolhtml_sys::Foo` (raw
// opaque handles); they resolve to the same module, so alias both names.
use crate::webcore::response::HeadersRef;
use crate::webcore::streams::{self, Signal, StreamResult, Writable};
use crate::webcore::{self, Blob, Body, Response};
use bun_core::String as BunString;
use bun_jsc::call_frame::ArgumentsSlice;
use bun_lolhtml_sys::lol_html as lolhtml;
use bun_lolhtml_sys::lol_html as lolhtml_sys;
use bun_lolhtml_sys::lol_html::Opaque as _;
use bun_sys;

// ───────────────────── local helpers ─────────────────────────────────────

/// `HTMLString.toJS` — JSC bridge lives in the sibling `lolhtml_jsc` module
/// (keeps `bun_lolhtml_sys` free of JSC types).
use crate::api::lolhtml_jsc::html_string_to_js;

/// `HTMLString` → owned `bun.String` (clone + free original).
fn html_string_to_bun_string(s: lolhtml::HTMLString) -> BunString {
    let out = BunString::clone_utf8(s.slice());
    s.deinit();
    out
}

/// Construct a `SystemError` with code+message and remaining fields defaulted.
fn system_error(code: &'static str, message: &'static str) -> SystemError {
    SystemError {
        code: BunString::static_(code),
        message: BunString::static_(message),
        ..Default::default()
    }
}

type SelectorMap = Vec<*mut lolhtml::HTMLSelector>;

// ─────────────────── wrapInstanceMethod arg-decode helpers ───────────────
//
// PORT NOTE: Zig's `host_fn.wrapInstanceMethod` is a comptime
// type-directed argument decoder (see host_fn.zig:493-648). The
// `#[bun_jsc::host_fn(method)]` proc-macro that will eventually replace it
// hasn't landed, so the per-type decode arms used by HTMLRewriter
// (`ZigString`, `?ContentOptions`, `JSValue`) are open-coded here as small
// helpers. They mirror the Zig branches exactly: same error messages, same
// undefined/null handling, same eat order.

/// `wrapInstanceMethod` arm for `jsc.ZigString` — eat next arg, throw
/// "Missing argument" if absent, "Expected string" if undefined/null,
/// otherwise `getZigString`.
fn eat_zig_string(iter: &mut ArgumentsSlice<'_>, global: &JSGlobalObject) -> JsResult<ZigString> {
    let Some(value) = iter.next_eat() else {
        return Err(global.throw_invalid_arguments(format_args!("Missing argument")));
    };
    if value.is_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected string")));
    }
    Ok(ZigString::from(value.get_zig_string(global)?))
}

/// `wrapInstanceMethod` arm for `jsc.JSValue` (required) — eat next arg or
/// throw "Missing argument".
fn eat_js_value(iter: &mut ArgumentsSlice<'_>, global: &JSGlobalObject) -> JsResult<JSValue> {
    iter.next_eat()
        .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))
}

/// `wrapInstanceMethod` arm for `?ContentOptions` — peek next arg, read
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
    let args = call_frame.arguments_old::<2>();
    let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
    let content = eat_zig_string(&mut iter, global)?;
    let opts = eat_content_options(&mut iter, global)?;
    Ok((content, opts))
}

/// Emit the per-wrapper `content_handler` plus one `(${name}_, $name)` pair
/// per lol-html content op. Restores the Zig shape (`host_fn.wrapInstanceMethod`
/// invoked N×) that the Rust port hand-expanded for lack of comptime reflection,
/// and additionally collapses the 5× duplicated `content_handler` body that Zig
/// never deduped.
///
/// - `$Raw`      — bare ident under `lolhtml::` (also paths the raw op as
///                 `lolhtml::$Raw::$name`, which holds for all 16 ops).
/// - `$field`    — the `Cell<*mut lolhtml_sys::$Raw>` field on `self`.
/// - `$null_ret` — sentinel when the raw ptr is null. **Differs per wrapper**:
///                 `JSValue::UNDEFINED` for TextChunk/Element,
///                 `JSValue::NULL` for DocEnd/Comment/EndTag (matches Zig).
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
            callback: fn(&mut lolhtml::$Raw, &[u8], bool) -> Result<(), lolhtml::Error>,
            this_object: JSValue,
            global_object: &JSGlobalObject,
            content: ZigString,
            content_options: Option<ContentOptions>,
        ) -> JSValue {
            let Some(raw) = lolhtml::$Raw::from_ptr(self.$field.get()) else {
                return $null_ret;
            };
            let content_slice = content.to_slice();
            if callback(
                raw,
                content_slice.slice(),
                content_options.map_or(false, |o| o.html),
            )
            .is_err()
            {
                return create_lolhtml_error(global_object);
            }
            this_object
        }

        $(
            $(#[$attr])*
            pub fn $name_(
                &self,
                call_frame: &CallFrame,
                global_object: &JSGlobalObject,
                content: ZigString,
                content_options: Option<ContentOptions>,
            ) -> JSValue {
                self.content_handler(
                    lolhtml::$Raw::$name,
                    call_frame.this(),
                    global_object,
                    content,
                    content_options,
                )
            }

            // host_fn.wrapInstanceMethod hand-expansion: decode
            // `(content: ZigString, contentOptions: ?ContentOptions)` then
            // forward.
            $(#[$attr])*
            pub fn $name(
                &self,
                global: &JSGlobalObject,
                call_frame: &CallFrame,
            ) -> JsResult<JSValue> {
                let (content, opts) = eat_content_args(global, call_frame)?;
                Ok(self.$name_(call_frame, global, content, opts))
            }
        )*
    };
}

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
            unsafe { lolhtml::HTMLSelector::destroy(selector) };
        }
        // element_handlers / document_handlers: Box<_> drops via Drop impls below.
    }
}

// ───────────────────────────── HTMLRewriter ──────────────────────────────

#[bun_jsc::JsClass]
pub struct HTMLRewriter {
    pub builder: *mut lolhtml_sys::HTMLRewriterBuilder,
    pub context: Rc<RefCell<LOLHTMLContext>>,
}

impl HTMLRewriter {
    // PORT NOTE: no `#[bun_jsc::host_fn]` here — `#[bun_jsc::JsClass]` on the
    // struct already emits the C-ABI constructor shim that calls
    // `<HTMLRewriter>::constructor(__g, __f)`.
    pub fn constructor(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut HTMLRewriter> {
        let rewriter = bun_core::heap::into_raw(Box::new(HTMLRewriter {
            builder: lolhtml::HTMLRewriterBuilder::init(),
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
        let mut selector_slice: Vec<u8> = Vec::new();
        write!(&mut selector_slice, "{}", selector_name).ok();

        let selector = match lolhtml::HTMLSelector::parse(&selector_slice) {
            Ok(s) => s,
            Err(_) => return Err(global.throw_value(create_lolhtml_error(global))),
        };
        let mut selector_guard = scopeguard::guard(selector, |s| unsafe {
            // SAFETY: selector owned by us until appended to context.selectors below.
            lolhtml::HTMLSelector::destroy(s)
        });

        let handler_ = ElementHandler::init(global, listener)?;
        let mut handler = Box::new(handler_);
        // Take the address ONCE as a raw pointer; `NonNull` is `Copy`, so the
        // same allocation can be passed to multiple handler slots without ever
        // materializing aliased `&mut` (which would be UB under Stacked
        // Borrows even if only address-taken).
        let handler_ptr: NonNull<ElementHandler> = NonNull::from(&mut *handler);

        let has_element = handler.on_element_callback.is_some();
        let has_comment = handler.on_comment_callback.is_some();
        let has_text = handler.on_text_callback.is_some();

        // SAFETY: builder is a valid lol-html builder; `handler_ptr` stays
        // alive because the Box is pushed into `self.context.element_handlers`
        // below, outliving the rewriter.
        let res = unsafe {
            (*self.builder).add_element_content_handlers(
                &mut **selector_guard,
                has_element.then_some(handler_ptr),
                has_comment.then_some(handler_ptr),
                has_text.then_some(handler_ptr),
            )
        };
        if res.is_err() {
            // errdefer: drop handler (Box drop runs ElementHandler::drop) + selector_guard fires.
            return Err(global.throw_value(create_lolhtml_error(global)));
        }

        let selector = scopeguard::ScopeGuard::into_inner(selector_guard);
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
        let handler_ = DocumentHandler::init(global, listener)?;
        let mut handler = Box::new(handler_);
        // See `on_` — single raw `NonNull`, copied per-slot, no aliased `&mut`.
        let handler_ptr: NonNull<DocumentHandler> = NonNull::from(&mut *handler);

        let has_doc_type = handler.on_doc_type_callback.is_some();
        let has_comment = handler.on_comment_callback.is_some();
        let has_text = handler.on_text_callback.is_some();
        let has_end = handler.on_end_callback.is_some();

        // If this fails, subsequent calls to write or end should throw
        // SAFETY: builder is valid; `handler_ptr` lives in
        // `context.document_handlers`, outliving the rewriter.
        unsafe {
            (*self.builder).add_document_content_handlers(
                has_doc_type.then_some(handler_ptr),
                has_comment.then_some(handler_ptr),
                has_text.then_some(handler_ptr),
                has_end.then_some(handler_ptr),
            );
        }

        self.context.borrow_mut().document_handlers.push(handler);
        Ok(call_frame.this())
    }

    pub fn finalize(self: Box<Self>) {
        self.finalize_without_destroy();
    }

    pub fn finalize_without_destroy(&self) {
        // context: Rc drop happens via field drop; builder needs explicit FFI deinit.
        // SAFETY: builder was created by Builder::init() and not yet freed.
        unsafe { lolhtml::HTMLRewriterBuilder::destroy(self.builder) };
        // TODO(port): Zig calls context.deref() here explicitly; with Rc the
        // drop happens when HTMLRewriter is dropped. If finalize_without_destroy
        // is called without immediate drop, we'd want to swap context to a
        // fresh Rc. Phase B: verify call sites.
    }

    pub fn begin_transform(
        &self,
        global: &JSGlobalObject,
        response: *mut Response,
    ) -> JsResult<JSValue> {
        let new_context = Rc::clone(&self.context);
        BufferOutputSink::init(new_context, global, response, self.builder)
    }

    pub fn transform_(
        &self,
        global: &JSGlobalObject,
        response_value: JSValue,
    ) -> JsResult<JSValue> {
        // PORT NOTE: `Response` doesn't yet impl `JsClass`, so use the
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
            let out = self.begin_transform(global, response)?;
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
            // defer resp.finalize();
            let _resp_guard = scopeguard::guard(resp, |r| {
                // SAFETY: `r` is the `heap::into_raw` allocation from just
                // above; finalize takes ownership and frees it exactly once.
                Response::finalize(unsafe { Box::from_raw(r) })
            });

            let out_response_value = self.begin_transform(global, resp)?;
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
                // the native side ourselves (Zig: html_rewriter.zig:223-226).
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

    // ── host_fn.wrapInstanceMethod hand-expansions ───────────────────────
    // Zig: `pub const on = host_fn.wrapInstanceMethod(HTMLRewriter, "on_", false)`
    // etc. — see arg-decode helpers at top of file.

    pub fn on(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<2>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let selector_name = eat_zig_string(&mut iter, global)?;
        let listener = eat_js_value(&mut iter, global)?;
        self.on_(global, selector_name, call_frame, listener)
    }

    pub fn on_document(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<1>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let listener = eat_js_value(&mut iter, global)?;
        self.on_document_(global, listener, call_frame)
    }

    pub fn transform(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<1>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let response_value = eat_js_value(&mut iter, global)?;
        self.transform_(global, response_value)
    }
}

// ─────────────────────── HTMLRewriterLoader ──────────────────────────────

pub struct HTMLRewriterLoader {
    pub rewriter: *mut lolhtml_sys::HTMLRewriter,
    pub finalized: bool,
    pub context: Rc<RefCell<LOLHTMLContext>>,
    pub chunk_size: usize,
    pub failed: bool,
    // TODO(port): lifetime — Zig `Sink` stores `*anyopaque` (no borrow). Rust
    // `Sink<'a>` borrows its handler; the destination handler outlives this
    // loader (set in `setup()`), so use `'static` as the Phase-A erasure.
    pub output: webcore::Sink<'static>,
    pub signal: Signal,
    pub backpressure: LinearFifo<u8, DynamicBuffer<u8>>,
}

impl HTMLRewriterLoader {
    pub fn finalize(&mut self) {
        if self.finalized {
            return;
        }
        // SAFETY: rewriter created via builder.build(); not yet freed.
        unsafe { lolhtml::HTMLRewriter::destroy(self.rewriter) };
        self.backpressure = LinearFifo::<u8, DynamicBuffer<u8>>::init();
        self.finalized = true;
    }

    pub fn fail(&mut self, err: bun_sys::Error) {
        self.signal.close(Some(err.clone()));
        let _ = self.output.end(Some(err)); // error already surfaced via signal/fail path
        self.failed = true;
        self.finalize();
    }

    pub fn connect(&mut self, signal: Signal) {
        self.signal = signal;
    }

    pub fn write_to_destination(&mut self, bytes: &[u8]) {
        if self.backpressure.readable_length() > 0 {
            if self.backpressure.write(bytes).is_err() {
                self.fail(bun_sys::Error::oom());
                self.finalize();
            }
            return;
        }

        // `bytes` borrowed for the synchronous `output.write` call only;
        // the `Temporary` variant signals the sink it must copy before returning.
        let borrowed = bun_ptr::RawSlice::new(bytes);
        let write_result = self
            .output
            .write(webcore::sink::Data::Bytes(StreamResult::Temporary(
                borrowed,
            )));

        match write_result {
            Writable::Err(err) => {
                self.fail(err);
            }
            Writable::OwnedAndDone(_)
            | Writable::TemporaryAndDone(_)
            | Writable::IntoArrayAndDone(_) => {
                self.done();
            }
            Writable::Pending(pending) => {
                // PORT NOTE: Zig calls `pending.applyBackpressure(allocator,
                // &this.output, pending, bytes)` — that decl does not exist in
                // the Zig source (dead code; HTMLRewriterLoader.sink() is never
                // referenced so Zig never compiles this arm). Mirror the call
                // shape exactly; do NOT also push into `self.backpressure`
                // here — that would double-buffer relative to the spec.
                // SAFETY: `pending` points at a heap WritablePending owned by
                // the destination sink; valid for the duration of this call.
                unsafe { (*pending).apply_backpressure(&mut self.output, bytes) };
            }
            Writable::IntoArray(_) | Writable::Owned(_) | Writable::Temporary(_) => {
                self.signal.ready(
                    if self.chunk_size > 0 {
                        Some(self.chunk_size as u64)
                    } else {
                        None
                    },
                    None,
                );
            }
            Writable::Done => {
                // PORT NOTE: Zig switch omits `.done` (dead code never
                // compiled there); route it through `done()` like the other
                // *AndDone arms rather than silently swallowing it.
                self.done();
            }
        }
    }

    pub fn done(&mut self) {
        let _ = self.output.end(None); // error already surfaced via signal/fail path
        self.signal.close(None);
        self.finalize();
    }

    pub fn setup(
        &mut self,
        builder: *mut lolhtml_sys::HTMLRewriterBuilder,
        context: Rc<RefCell<LOLHTMLContext>>,
        size_hint: Option<usize>,
        mut output: webcore::Sink<'static>,
    ) -> Option<lolhtml::HTMLString> {
        let chunk_size = size_hint.unwrap_or(16384).max(1024);
        // SAFETY: builder valid; `self` outlives the rewriter (deinit'd in finalize()).
        let built = unsafe {
            (*builder).build(
                lolhtml::Encoding::UTF8,
                lolhtml::MemorySettings {
                    preallocated_parsing_buffer_size: chunk_size,
                    max_allowed_memory_usage: u32::MAX as usize,
                },
                false,
                self,
            )
        };
        self.rewriter = match built {
            Ok(r) => r,
            Err(_) => {
                let _ = output.end(None); // error already surfaced via signal/fail path
                // PORT NOTE: Zig returned a borrowed `[]const u8` into
                // lol-html's threadlocal last-error buffer. Rust can't return a
                // slice tied to a temporary, so return the owning `HTMLString`
                // (caller calls `.slice()` then `.deinit()`).
                return Some(lolhtml::HTMLString::last_error());
            }
        };

        self.chunk_size = chunk_size;
        // Share the context with the caller via Rc; the Zig version stored a
        // POD struct copy of an `ArrayListUnmanaged`, which in Rust would
        // double-own `Vec`/`Box` heap buffers. Clone the Rc instead.
        self.context = context;
        self.output = output;

        None
    }

    pub fn sink(&mut self) -> webcore::Sink<'_> {
        webcore::Sink::init(self)
    }

    // PORT NOTE: The Zig spec (html_rewriter.zig:346-356) does not deinit on
    // the error path at all — matched here exactly: only the Owned* arms free,
    // and only on success (caller wraps owned bytes in `ManuallyDrop` and
    // takes them back out on the success path).
    fn write_bytes(&mut self, bytes: &[u8]) -> Option<bun_sys::Error> {
        // SAFETY: rewriter valid (setup() succeeded, not yet finalized).
        if unsafe { lolhtml::HTMLRewriter::write(self.rewriter, bytes) }.is_err() {
            return Some(bun_sys::Error {
                errno: 1,
                // TODO: make this a union
                path: Box::<[u8]>::from(lolhtml::HTMLString::last_error().slice()),
                ..Default::default()
            });
        }
        None
    }

    pub fn write(&mut self, data: StreamResult) -> streams::Writable {
        match data {
            StreamResult::Owned(bytes) => {
                let len = bytes.len() as webcore::BlobSizeType;
                // Spec: do NOT free on the error path.
                let bytes = core::mem::ManuallyDrop::new(bytes);
                if let Some(err) = self.write_bytes(bytes.slice()) {
                    return Writable::Err(err);
                }
                drop(core::mem::ManuallyDrop::into_inner(bytes));
                Writable::Owned(len)
            }
            StreamResult::OwnedAndDone(bytes) => {
                let len = bytes.len() as webcore::BlobSizeType;
                // Spec: do NOT free on the error path.
                let bytes = core::mem::ManuallyDrop::new(bytes);
                if let Some(err) = self.write_bytes(bytes.slice()) {
                    return Writable::Err(err);
                }
                drop(core::mem::ManuallyDrop::into_inner(bytes));
                Writable::OwnedAndDone(len)
            }
            StreamResult::TemporaryAndDone(bytes) => {
                let len = bytes.len() as webcore::BlobSizeType;
                if let Some(err) = self.write_bytes(bytes.slice()) {
                    return Writable::Err(err);
                }
                Writable::TemporaryAndDone(len)
            }
            StreamResult::Temporary(bytes) => {
                let len = bytes.len() as webcore::BlobSizeType;
                if let Some(err) = self.write_bytes(bytes.slice()) {
                    return Writable::Err(err);
                }
                Writable::Temporary(len)
            }
            _ => unreachable!(),
        }
    }

    pub fn write_utf16(&mut self, data: StreamResult) -> streams::Writable {
        webcore::sink::UTF8Fallback::write_utf16(self, data, HTMLRewriterLoader::write)
    }

    pub fn write_latin1(&mut self, data: StreamResult) -> streams::Writable {
        webcore::sink::UTF8Fallback::write_latin1(self, data, HTMLRewriterLoader::write)
    }

    pub fn end(&mut self, err: Option<bun_sys::Error>) -> bun_sys::Result<()> {
        // PORT NOTE: Zig HTMLRewriterLoader has no `end` (sink() is dead code
        // there). On input-stream end, flush the rewriter (which calls
        // OutputSink::done → self.done()) or fail.
        if let Some(e) = err {
            self.fail(e);
        } else {
            if !self.finalized {
                // SAFETY: rewriter set by setup(); not yet finalized.
                let _ = unsafe { lolhtml::HTMLRewriter::end(self.rewriter) };
            }
            self.done();
        }
        Ok(())
    }
}

crate::impl_sink_handler!(HTMLRewriterLoader);

impl lolhtml::OutputSink for HTMLRewriterLoader {
    fn write(&mut self, bytes: &[u8]) {
        self.write_to_destination(bytes);
    }
    fn done(&mut self) {
        HTMLRewriterLoader::done(self);
    }
}

// ───────────────────────── BufferOutputSink ──────────────────────────────

#[derive(bun_ptr::CellRefCounted)]
pub struct BufferOutputSink {
    // Intrusive RefCount; *Self crosses FFI as lol-html userdata.
    ref_count: Cell<u32>,
    pub global: GlobalRef, // JSC_BORROW
    pub bytes: MutableString,
    pub rewriter: *mut lolhtml_sys::HTMLRewriter, // null when unset
    pub context: Rc<RefCell<LOLHTMLContext>>,
    pub response: *mut Response, // BORROW_FIELD: kept alive by response_value Strong
    pub response_value: StrongOptional,
    pub body_value_bufferer: Option<webcore::body::ValueBufferer<'static>>,
    pub tmp_sync_error: Option<NonNull<JSValue>>, // TODO(port): lifetime — points at a stack local in init()
}

impl BufferOutputSink {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    /// Single unsafe deref site for the set-once
    /// `tmp_sync_error: Option<NonNull<JSValue>>` field, so the two callers in
    /// `on_finished_buffering` stay safe. `tmp_sync_error` points at the
    /// `sink_error: Cell<JSValue>` stack local in [`init`]; it is only written
    /// through on the synchronous (`is_async == false`) path while `init` is
    /// still on the stack, so the pointee is live and the `Cell`-derived
    /// pointer carries `SharedReadWrite` provenance.
    #[inline]
    fn write_tmp_sync_error(sink: *mut Self, err: JSValue) {
        // SAFETY: `sink` is a live heap allocation (refcount > 0, caller
        // invariant); `tmp_sync_error` was set in `init()` and the synchronous
        // caller is reached only while `init()` is still on the stack.
        unsafe { *(*sink).tmp_sync_error.unwrap().as_ptr() = err };
    }

    pub fn init(
        context: Rc<RefCell<LOLHTMLContext>>,
        global: &JSGlobalObject,
        original: *mut Response,
        builder: *mut lolhtml_sys::HTMLRewriterBuilder,
    ) -> JsResult<JSValue> {
        let sink = bun_core::heap::into_raw(Box::new(BufferOutputSink {
            ref_count: Cell::new(1),
            global: GlobalRef::from(global),
            bytes: MutableString::init_empty(),
            rewriter: core::ptr::null_mut(),
            context,
            response: core::ptr::null_mut(),
            response_value: StrongOptional::empty(),
            body_value_bufferer: None,
            tmp_sync_error: None,
        }));
        // defer sink.deref();
        // SAFETY: `sink` is the `heap::into_raw` allocation above; refcount >= 1.
        let _sink_guard = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::adopt(sink) };
        // PORT NOTE: do not hold a long-lived `&mut *sink` here — the same
        // allocation is also written through the raw pointer by the lol-html
        // output-sink callback during `bufferer.run()` and by `deref(sink)`
        // below. Access fields via raw-pointer place expressions instead.

        let result = bun_core::heap::into_raw(Box::new(Response::init(
            webcore::response::Init {
                status_code: 200,
                ..Default::default()
            },
            webcore::Body::new({
                let mut pv = webcore::body::PendingValue::new(global);
                pv.task = Some(sink.cast::<core::ffi::c_void>());
                webcore::body::Value::Locked(pv)
            }),
            BunString::empty(),
            false,
        )));

        // SAFETY: sink was just allocated via heap::alloc above; refcount==1.
        unsafe { (*sink).response = result };
        // PORT NOTE (Stacked Borrows): `sink_error` is written via raw pointer
        // by the unhandled-rejection handler during `bufferer.run()` and via
        // `tmp_sync_error` from `on_finished_buffering`. Use a `Cell` so the
        // exported `*mut` (via `Cell::as_ptr`, i.e. `UnsafeCell::get`) carries
        // SharedReadWrite provenance — local `.get()` reads do NOT invalidate
        // the stored raw pointer the way a `&`/`&mut` reborrow of a plain
        // `mut` local would.
        let sink_error: core::cell::Cell<JSValue> = core::cell::Cell::new(JSValue::ZERO);
        let sink_error_ptr: *mut JSValue = sink_error.as_ptr();
        // SAFETY: original is a live *Response passed from begin_transform; its
        // JS wrapper is on the caller's stack.
        let input_size = unsafe { (*original).get_body_len() };
        // SAFETY: bun_vm() returns the live VM raw ptr; VM outlives this fn.
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();

        // Since we're still using vm.waitForPromise, we have to also override
        // the error rejection handler. That way, we can propagate errors to the
        // caller.
        let scope = vm.unhandled_rejection_scope();
        let prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
        vm.unhandled_pending_rejection_to_capture = Some(sink_error_ptr);
        // SAFETY: sink is a live heap allocation (refcount >= 1); sink_error_ptr
        // is non-null (addr of stack local).
        unsafe { (*sink).tmp_sync_error = Some(NonNull::new_unchecked(sink_error_ptr)) };
        vm.on_unhandled_rejection =
            VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        // Zig `defer sink_error.ensureStillAlive()` — read the *live* slot at
        // scope exit (Cell shares provenance with the raw-pointer writers).
        scopeguard::defer! {
            sink_error.get().ensure_still_alive();
            // SAFETY: VM outlives this guard (sync stack frame).
            let vm = VirtualMachine::get().as_mut();
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;
            scope.apply(vm);
        }

        // SAFETY: builder valid; sink outlives rewriter (deinit in Drop). Pass
        // the raw `sink` (heap::alloc root) directly so the userdata pointer
        // stored in the C rewriter shares provenance with every other
        // `(*sink).field` access in this module — see the PORT NOTE on
        // `HTMLRewriterBuilder::build`.
        let built = unsafe {
            (*builder).build(
                lolhtml::Encoding::UTF8,
                lolhtml::MemorySettings {
                    preallocated_parsing_buffer_size: if input_size as u64
                        == webcore::blob::MAX_SIZE
                    {
                        1024
                    } else {
                        input_size.max(1024) as usize
                    },
                    max_allowed_memory_usage: u32::MAX as usize,
                },
                false,
                sink,
            )
        };
        // SAFETY: sink is a live heap allocation (refcount >= 1).
        unsafe {
            (*sink).rewriter = match built {
                Ok(r) => r,
                Err(_) => {
                    // SAFETY: `result` was heap-allocated above and never handed
                    // to JS; reclaim ownership and finalize once.
                    Response::finalize(Box::from_raw(result));
                    return Ok(create_lolhtml_error(global));
                }
            };
        }

        // SAFETY: result and original are both live *Response (result allocated
        // above, original kept alive by caller); no aliasing &mut exists.
        unsafe {
            (*result).set_init(
                (*original).get_method(),
                (*original).get_init_status_code(),
                (*original).get_init_status_text().clone(),
            );

            // https://github.com/oven-sh/bun/issues/3334
            // PORT NOTE: `clone_this` takes `&mut self`, so use the `_mut`
            // accessor (original is `*mut Response`). `clone_this` only reads
            // `self` (FFI mutates a freshly-allocated clone, not the receiver).
            if let Some(headers) = (*original).get_init_headers_mut() {
                let cloned = headers.clone_this(global)?;
                (*result).set_init_headers(cloned.map(|p| HeadersRef::adopt(p)));
            }
        }

        // Hold off on cloning until we're actually done.
        // SAFETY: (*sink).response == result (set above), live heap allocation.
        let response_js_value = unsafe { (*(*sink).response).to_js(&(*sink).global) };
        // SAFETY: sink is a live heap allocation (refcount >= 1).
        unsafe { (*sink).response_value.set(global, response_js_value) };

        // SAFETY: result/original are live *Response (see SAFETY note above).
        // `url()` is +0 borrowed-bits; `set_url` takes +1 — `.clone()` to bump
        // (html_rewriter.zig:492 `original.getUrl().clone()`).
        unsafe { (*result).set_url((*original).url().clone()) };

        // SAFETY: original is a live *Response kept alive by caller.
        let value = unsafe { (*original).get_body_value() };
        // SAFETY: original is a live *Response kept alive by caller; sink live.
        let owned_readable_stream =
            unsafe { (*original).get_body_readable_stream(&(*sink).global) };
        // SAFETY: sink is a live heap allocation (refcount >= 1).
        unsafe {
            (*sink).ref_();
            (*sink).body_value_bufferer = Some(webcore::body::ValueBufferer::init(
                sink.cast::<core::ffi::c_void>(),
                // PORT NOTE: `ValueBuffererCallback` takes `*mut c_void` for ctx;
                // `on_finished_buffering` takes `*mut BufferOutputSink`. The
                // wrapper trampoline restores the concrete type.
                Self::on_finished_buffering_trampoline,
                &(*sink).global,
            ));
        }
        response_js_value.ensure_still_alive();

        // SAFETY: sink is a live heap allocation; body_value_bufferer was just
        // set to Some above. `run()` may synchronously invoke
        // `on_finished_buffering`, which (via lol-html FFI) re-enters
        // `<BufferOutputSink as OutputSink>::write/done` and forms a fresh
        // `&mut *sink`. Hoist the bufferer through a raw pointer so no `&mut`
        // derived from `*sink` is live across that callback.
        let buffering_result: Result<(), bun_core::Error> = unsafe {
            let bufferer: *mut webcore::body::ValueBufferer =
                (*sink).body_value_bufferer.as_mut().unwrap();
            (*bufferer).run(value, owned_readable_stream)
        };
        if let Err(buffering_error) = buffering_result {
            // SAFETY: `sink` is a live `heap::into_raw` allocation; release the
            // ref taken for the in-flight bufferer.
            unsafe { BufferOutputSink::deref(sink) };
            return Ok(match buffering_error {
                e if e == bun_core::err!("StreamAlreadyUsed") => {
                    let err = system_error(
                        "ERR_STREAM_ALREADY_FINISHED",
                        "Stream already used, please create a new one",
                    );
                    err.to_error_instance(global)
                }
                _ => {
                    let err = system_error("ERR_STREAM_CANNOT_PIPE", "Failed to pipe stream");
                    err.to_error_instance(global)
                }
            });
        }

        // sync error occurs — read via the Cell (shares SharedReadWrite
        // provenance with the raw-pointer writers; see PORT NOTE above).
        let captured = sink_error.get();
        if !captured.is_empty() {
            captured.ensure_still_alive();
            captured.unprotect();
            return Ok(captured);
        }

        response_js_value.ensure_still_alive();
        Ok(response_js_value)
    }

    fn on_finished_buffering_trampoline(
        ctx: *mut core::ffi::c_void,
        bytes: &[u8],
        js_err: Option<webcore::body::ValueError>,
        is_async: bool,
    ) {
        Self::on_finished_buffering(ctx.cast::<BufferOutputSink>(), bytes, js_err, is_async)
    }

    pub fn on_finished_buffering(
        sink: *mut BufferOutputSink,
        bytes: &[u8],
        js_err: Option<webcore::body::ValueError>,
        is_async: bool,
    ) {
        // SAFETY: `sink` was ref'd in `init()` before scheduling this callback;
        // refcount > 0 so the allocation is live. `adopt` consumes that +1 on Drop.
        let _g = unsafe { bun_ptr::ScopedRef::<BufferOutputSink>::adopt(sink) };
        // PORT NOTE: do not materialise `&mut *sink` here — the lol-html
        // write/end FFI calls below re-enter `<BufferOutputSink as
        // OutputSink>::write/done` through the userdata pointer, which forms
        // its own `&mut *sink`. Holding an outer `&mut` across that re-entry
        // is aliased-&mut UB. Access fields via raw-pointer place expressions
        // instead (mirroring `init()`).
        //
        // SAFETY: sink was ref'd in init() before scheduling this callback;
        // refcount > 0 so the allocation is live.
        let global = unsafe { (*sink).global };

        if let Some(err) = js_err {
            // SAFETY: (*sink).response is the heap Response allocated in init()
            // and kept alive by (*sink).response_value (Strong root).
            let sink_body_value = unsafe { (*(*sink).response).get_body_value() };
            let sink_ptr_usize = sink as usize;
            if matches!(sink_body_value, webcore::body::Value::Locked(l)
                if l.task.map_or(0, |p| p as usize) == sink_ptr_usize && l.promise.is_none())
            {
                if let webcore::body::Value::Locked(l) = sink_body_value {
                    l.readable.deinit();
                }
                *sink_body_value = webcore::body::Value::Empty;
                // is there a pending promise?
                // we will need to reject it
            } else if matches!(sink_body_value, webcore::body::Value::Locked(l)
                if l.task.map_or(0, |p| p as usize) == sink_ptr_usize && l.promise.is_some())
            {
                if let webcore::body::Value::Locked(l) = sink_body_value {
                    l.on_receive_value = None;
                    l.task = None;
                }
            }
            if is_async {
                let _ = sink_body_value.to_error_instance(err.dupe(&global), &global);
                // TODO: properly propagate exception upwards
            } else {
                let ret_err = create_lolhtml_error(&global);
                ret_err.ensure_still_alive();
                ret_err.protect();
                Self::write_tmp_sync_error(sink, ret_err);
            }
            // SAFETY: rewriter set by init(). Read into a local before the
            // call — `end()` re-enters `OutputSink::done(&mut *sink)`.
            let rewriter = unsafe { (*sink).rewriter };
            let _ = unsafe { lolhtml::HTMLRewriter::end(rewriter) };
            return;
        }

        if let Some(ret_err) = Self::run_output_sink(sink, bytes, is_async) {
            ret_err.ensure_still_alive();
            ret_err.protect();
            Self::write_tmp_sync_error(sink, ret_err);
        }
    }

    /// PORT NOTE: takes `*mut Self` (not `&mut self`) because
    /// `lolhtml::HTMLRewriter::write/end` re-enter
    /// `<BufferOutputSink as OutputSink>::write/done(&mut self)` through the
    /// userdata pointer registered at build time. A `&mut self` receiver here
    /// would alias that inner `&mut` (Stacked Borrows UB).
    pub fn run_output_sink(sink: *mut Self, bytes: &[u8], is_async: bool) -> Option<JSValue> {
        // SAFETY: sink is a live heap allocation (refcount > 0, caller
        // invariant). Read fields into locals before the FFI calls so no
        // borrow of `*sink` is live across the re-entrant callback.
        let _ = unsafe { (*sink).bytes.grow_by(bytes.len()) }; // OOM/capacity: Zig aborts; port keeps fire-and-forget
        let global = unsafe { (*sink).global };
        let response = unsafe { (*sink).response };
        let rewriter = unsafe { (*sink).rewriter };

        // SAFETY: rewriter set by init().
        if unsafe { lolhtml::HTMLRewriter::write(rewriter, bytes) }.is_err() {
            if is_async {
                // SAFETY: response kept alive by response_value Strong.
                let _ = unsafe { (*response).get_body_value() }.to_error_instance(
                    webcore::body::ValueError::Message(create_lolhtml_string_error()),
                    &global,
                );
                // TODO: properly propagate exception upwards
                return None;
            } else {
                return Some(create_lolhtml_error(&global));
            }
        }

        // SAFETY: rewriter set by init() and not yet freed.
        if unsafe { lolhtml::HTMLRewriter::end(rewriter) }.is_err() {
            if is_async {
                // SAFETY: response kept alive by response_value Strong.
                let _ = unsafe { (*response).get_body_value() }.to_error_instance(
                    webcore::body::ValueError::Message(create_lolhtml_string_error()),
                    &global,
                );
                // TODO: properly propagate exception upwards
                return None;
            } else {
                return Some(create_lolhtml_error(&global));
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
            webcore::body::Value::InternalBlob(webcore::InternalBlob {
                bytes: core::mem::replace(&mut self.bytes, MutableString::init_empty()).list,
                was_string: false,
            }),
        );

        let _ = webcore::body::Value::resolve(&mut prev_value, body_value, &self.global, None);
        // TODO: properly propagate exception upwards
    }

    pub fn write(&mut self, bytes: &[u8]) {
        let _ = self.bytes.append(bytes); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    }
}

impl lolhtml::OutputSink for BufferOutputSink {
    fn write(&mut self, bytes: &[u8]) {
        BufferOutputSink::write(self, bytes);
    }
    fn done(&mut self) {
        BufferOutputSink::done(self);
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
            unsafe { lolhtml::HTMLRewriter::destroy(self.rewriter) };
        }
    }
}

// ──────────────────────── DocumentHandler ────────────────────────────────

pub struct DocumentHandler {
    // Callbacks are GC-rooted via `ProtectedJSValue` (RAII `JSValue::protect`/
    // `unprotect` pair). `Option::None` ⇒ no protect was taken; `Some` drops
    // its guard on field drop, so neither the errdefer-on-init nor a manual
    // `Drop` impl is needed.
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
    pub fn on_doc_type(this: *mut Self, value: *mut lolhtml::DocType) -> bool {
        handler_callback::<Self, DocType, lolhtml::DocType>(
            this,
            value,
            |w| w.doctype.set(core::ptr::null_mut()),
            |h| h.on_doc_type_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
    pub fn on_comment(this: *mut Self, value: *mut lolhtml::Comment) -> bool {
        handler_callback::<Self, Comment, lolhtml::Comment>(
            this,
            value,
            |w| w.comment.set(core::ptr::null_mut()),
            |h| h.on_comment_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
    pub fn on_text(this: *mut Self, value: *mut lolhtml::TextChunk) -> bool {
        handler_callback::<Self, TextChunk, lolhtml::TextChunk>(
            this,
            value,
            |w| w.text_chunk.set(core::ptr::null_mut()),
            |h| h.on_text_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
    pub fn on_end(this: *mut Self, value: *mut lolhtml::DocEnd) -> bool {
        handler_callback::<Self, DocEnd, lolhtml::DocEnd>(
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
        // callbacks taken so far — no scopeguard errdefer needed.
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

impl lolhtml::DirectiveCallback<lolhtml::DocType> for DocumentHandler {
    fn call(&mut self, container: &mut lolhtml::DocType) -> bool {
        DocumentHandler::on_doc_type(self, container)
    }
}
impl lolhtml::DirectiveCallback<lolhtml::Comment> for DocumentHandler {
    fn call(&mut self, container: &mut lolhtml::Comment) -> bool {
        DocumentHandler::on_comment(self, container)
    }
}
impl lolhtml::DirectiveCallback<lolhtml::TextChunk> for DocumentHandler {
    fn call(&mut self, container: &mut lolhtml::TextChunk) -> bool {
        DocumentHandler::on_text(self, container)
    }
}
impl lolhtml::DirectiveCallback<lolhtml::DocEnd> for DocumentHandler {
    fn call(&mut self, container: &mut lolhtml::DocEnd) -> bool {
        DocumentHandler::on_end(self, container)
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
    fn deref(this: *mut Self);
    /// `jsc.Codegen.JS${T}.toJS` — wraps the *existing* heap allocation `this`
    /// in a JS wrapper (the codegen `${T}__create`). Takes `*mut Self` (not
    /// `&self`) because the C++ side stores the raw heap pointer in `m_ctx`;
    /// deriving it from a `&self` would launder shared-borrow provenance into
    /// the GC's exclusive-owner pointer.
    fn to_js(this: *mut Self, global: &JSGlobalObject) -> JSValue;
    /// Some wrapper types (Element) hand out sub-objects that borrow from the
    /// underlying lol-html value and must be detached along with the wrapper
    /// itself. Default: no-op (caller passes a `clear_field` closure instead).
    fn invalidate(&self) {}
    const HAS_INVALIDATE: bool = false;
}

/// Forwarding `WrapperLike` impl — every wrapper type's trait impl is a pure
/// pass-through to inherent / `CellRefCounted`-derived / `JsClass`-codegen
/// methods. Mirrors Zig's `HandlerCallback` comptime duck-typing (which needs
/// no impl block at all — html_rewriter.zig:890). The optional `, invalidate`
/// tail wires up types (Element) that hand out sub-objects which must be
/// detached alongside the lol-html value.
macro_rules! impl_wrapper_like {
    ($ty:ty, $raw:ty $(, $invalidate:ident)?) => {
        impl WrapperLike for $ty {
            type Raw = $raw;
            fn init(v: *mut Self::Raw) -> *mut Self { Self::init(v) }
            fn ref_(&self) { self.ref_() }
            fn deref(this: *mut Self) {
                // SAFETY: `WrapperLike::deref` contract — `this` is a live
                // `heap::alloc` allocation with refcount >= 1.
                unsafe { Self::deref(this) }
            }
            fn to_js(this: *mut Self, g: &JSGlobalObject) -> JSValue {
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
    // PORT NOTE: spec (html_rewriter.zig:938,954,969,972) re-derives
    // `this.global.bunVM()` at each use site rather than caching a `&mut`.
    // `cb.call(...)` and `wait_for_promise(...)` re-enter JS / the event loop,
    // which mutate the same VirtualMachine through `global.bun_vm()` (and a
    // nested handler_callback would form its own `&mut VirtualMachine`).
    // Holding a long-lived `&mut` across those calls is two-live-&mut UB under
    // Stacked Borrows, so re-acquire a short-lived borrow at each touch.
    // SAFETY: bun_vm() returns the live VM raw ptr; VM outlives this call.
    let vm = || -> &mut VirtualMachine { global.bun_vm().as_mut() };

    // Use a TopExceptionScope to properly handle exceptions from the JavaScript
    // callback (html_rewriter.zig:920-922). The Phase-A draft replaced this with
    // a post-hoc `try_take_exception()`, but that is *not* equivalent under
    // `BUN_JSC_validateExceptionChecks=1`: `JSGlobalObject__tryTakeException`
    // constructs a fresh `TopExceptionScope` whose ctor calls
    // `verifyExceptionCheckNeedIsSatisfied`, asserting if the preceding
    // `Bun__JSValue__call` ThrowScope's `simulateThrow()` was not yet observed
    // by an enclosing scope. Mirror the spec exactly: open the scope here, read
    // the pending exception through it, and clear it explicitly.
    bun_jsc::top_scope!(scope, global);

    let cb = get_callback(this).expect("callback must be set if handler registered");
    let result = match cb.call(
        global,
        this.this_object(),
        // `wrapper` is a live heap allocation (ref'd above; guard deref runs
        // after this call). `to_js` hands the raw pointer to the C++ wrapper.
        &[Z::to_js(wrapper, global)],
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
        // PORT NOTE: spec is `result.isError() or result.isAggregateError(global)`
        // (html_rewriter.zig:964) — NOT `isAnyError`, which has different
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

    pub fn on_element(this: *mut Self, value: *mut lolhtml::Element) -> bool {
        handler_callback::<Self, Element, lolhtml::Element>(
            this,
            value,
            |_| {}, // Element uses HAS_INVALIDATE
            |h| h.on_element_callback.as_ref().map(ProtectedJSValue::value),
        )
    }

    pub fn on_comment(this: *mut Self, value: *mut lolhtml::Comment) -> bool {
        handler_callback::<Self, Comment, lolhtml::Comment>(
            this,
            value,
            |w| w.comment.set(core::ptr::null_mut()),
            |h| h.on_comment_callback.as_ref().map(ProtectedJSValue::value),
        )
    }

    pub fn on_text(this: *mut Self, value: *mut lolhtml::TextChunk) -> bool {
        handler_callback::<Self, TextChunk, lolhtml::TextChunk>(
            this,
            value,
            |w| w.text_chunk.set(core::ptr::null_mut()),
            |h| h.on_text_callback.as_ref().map(ProtectedJSValue::value),
        )
    }
}

impl lolhtml::DirectiveCallback<lolhtml::Element> for ElementHandler {
    fn call(&mut self, container: &mut lolhtml::Element) -> bool {
        ElementHandler::on_element(self, container)
    }
}
impl lolhtml::DirectiveCallback<lolhtml::Comment> for ElementHandler {
    fn call(&mut self, container: &mut lolhtml::Comment) -> bool {
        ElementHandler::on_comment(self, container)
    }
}
impl lolhtml::DirectiveCallback<lolhtml::TextChunk> for ElementHandler {
    fn call(&mut self, container: &mut lolhtml::TextChunk) -> bool {
        ElementHandler::on_text(self, container)
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

    let err = create_lolhtml_string_error();
    let value = bun_string_jsc::to_error_instance(&err, global);
    value.put(
        global,
        b"name",
        ZigString::init(b"HTMLRewriterError").to_js(global),
    );
    value
}

fn create_lolhtml_string_error() -> BunString {
    // We must clone this string.
    let err = lolhtml::HTMLString::last_error();
    let s = BunString::clone_utf8(err.slice());
    err.deinit();
    s
}

fn html_string_value(
    input: lolhtml::HTMLString,
    global_object: &JSGlobalObject,
) -> JsResult<JSValue> {
    html_string_to_js(input, global_object)
}

// ─────────────────────────── TextChunk ───────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct TextChunk {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub text_chunk: Cell<*mut lolhtml_sys::TextChunk>,
}

impl TextChunk {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(text_chunk: *mut lolhtml::TextChunk) -> *mut TextChunk {
        bun_core::heap::into_raw(Box::new(TextChunk {
            ref_count: Cell::new(1),
            text_chunk: Cell::new(text_chunk),
        }))
    }

    lol_content_ops! { TextChunk, text_chunk, JSValue::UNDEFINED;
        before / before_,
        after / after_,
        replace / replace_,
    }

    #[bun_jsc::host_fn(method)]
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(chunk) = lolhtml::TextChunk::from_ptr(self.text_chunk.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        chunk.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_text(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(chunk) = lolhtml::TextChunk::from_ptr(self.text_chunk.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        bun_string_jsc::create_utf8_for_js(global, chunk.get_content().slice())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::TextChunk::from_ptr(self.text_chunk.get()) {
            Some(chunk) => JSValue::from(chunk.is_removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn last_in_text_node(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::TextChunk::from_ptr(self.text_chunk.get()) {
            Some(chunk) => JSValue::from(chunk.is_last_in_text_node()),
            None => JSValue::UNDEFINED,
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl_wrapper_like!(TextChunk, lolhtml::TextChunk);

// ──────────────────────────── DocType ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct DocType {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub doctype: Cell<*mut lolhtml_sys::DocType>,
}

impl DocType {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    pub fn init(doctype: *mut lolhtml::DocType) -> *mut DocType {
        bun_core::heap::into_raw(Box::new(DocType {
            ref_count: Cell::new(1),
            doctype: Cell::new(doctype),
        }))
    }

    /// The doctype name.
    #[bun_jsc::host_fn(getter)]
    pub fn name(&self, global_object: &JSGlobalObject) -> JSValue {
        let Some(dt) = lolhtml::DocType::from_ptr(self.doctype.get()) else {
            return JSValue::UNDEFINED;
        };
        let owned = dt.get_name();
        let str = owned.slice();
        if str.is_empty() {
            return JSValue::NULL;
        }
        ZigString::init(str).to_js(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn system_id(&self, global_object: &JSGlobalObject) -> JSValue {
        let Some(dt) = lolhtml::DocType::from_ptr(self.doctype.get()) else {
            return JSValue::UNDEFINED;
        };
        let owned = dt.get_system_id();
        let str = owned.slice();
        if str.is_empty() {
            return JSValue::NULL;
        }
        ZigString::init(str).to_js(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn public_id(&self, global_object: &JSGlobalObject) -> JSValue {
        let Some(dt) = lolhtml::DocType::from_ptr(self.doctype.get()) else {
            return JSValue::UNDEFINED;
        };
        let owned = dt.get_public_id();
        let str = owned.slice();
        if str.is_empty() {
            return JSValue::NULL;
        }
        ZigString::init(str).to_js(global_object)
    }

    #[bun_jsc::host_fn(method)]
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(dt) = lolhtml::DocType::from_ptr(self.doctype.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        dt.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::DocType::from_ptr(self.doctype.get()) {
            Some(dt) => JSValue::from(dt.is_removed()),
            None => JSValue::UNDEFINED,
        }
    }
}

impl_wrapper_like!(DocType, lolhtml::DocType);

// ──────────────────────────── DocEnd ─────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct DocEnd {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub doc_end: Cell<*mut lolhtml_sys::DocEnd>,
}

impl DocEnd {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(doc_end: *mut lolhtml::DocEnd) -> *mut DocEnd {
        bun_core::heap::into_raw(Box::new(DocEnd {
            ref_count: Cell::new(1),
            doc_end: Cell::new(doc_end),
        }))
    }

    lol_content_ops! { DocEnd, doc_end, JSValue::NULL;
        append / append_,
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl_wrapper_like!(DocEnd, lolhtml::DocEnd);

// ──────────────────────────── Comment ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct Comment {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub comment: Cell<*mut lolhtml_sys::Comment>,
}

impl Comment {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(comment: *mut lolhtml::Comment) -> *mut Comment {
        bun_core::heap::into_raw(Box::new(Comment {
            ref_count: Cell::new(1),
            comment: Cell::new(comment),
        }))
    }

    lol_content_ops! { Comment, comment, JSValue::NULL;
        before / before_,
        after / after_,
        replace / replace_,
    }

    #[bun_jsc::host_fn(method)]
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(comment) = lolhtml::Comment::from_ptr(self.comment.get()) else {
            return Ok(JSValue::NULL);
        };
        comment.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_text(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(comment) = lolhtml::Comment::from_ptr(self.comment.get()) else {
            return Ok(JSValue::NULL);
        };
        html_string_to_js(comment.get_text(), global_object)
    }

    // PORT NOTE: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `CommentPrototype__setText` via `host_setter_result` (which wants
    // `JsResult<()>`); the proc-macro shim would emit a second, conflicting
    // `JsResult<bool>` wrapper.
    pub fn set_text(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let Some(comment) = lolhtml::Comment::from_ptr(self.comment.get()) else {
            return Ok(());
        };
        let text = value.to_slice(global)?;
        if comment.set_text(text.slice()).is_err() {
            return Err(global.throw_value(create_lolhtml_error(global)));
        }
        Ok(())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::Comment::from_ptr(self.comment.get()) {
            Some(comment) => JSValue::from(comment.is_removed()),
            None => JSValue::UNDEFINED,
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl_wrapper_like!(Comment, lolhtml::Comment);

// ──────────────────────────── EndTag ─────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct EndTag {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub end_tag: Cell<*mut lolhtml_sys::EndTag>,
}

pub struct EndTagHandler {
    // TODO(port): bare JSValue heap field kept alive via JSC gcProtect —
    // evaluate bun_jsc::Strong in Phase B (see DocumentHandler note).
    pub callback: Option<JSValue>,
    pub global: GlobalRef, // JSC_BORROW
}

impl EndTagHandler {
    pub fn on_end_tag(this: *mut Self, value: *mut lolhtml::EndTag) -> bool {
        handler_callback::<Self, EndTag, lolhtml::EndTag>(
            this,
            value,
            |w| w.end_tag.set(core::ptr::null_mut()),
            |h| h.callback,
        )
    }

    /// C-ABI trampoline that lol-html invokes for end-tag handlers — routes
    /// through `directive_handler::<EndTag, Self>` which calls
    /// `<Self as DirectiveCallback<EndTag>>::call`.
    pub const ON_END_TAG_HANDLER: lolhtml::lol_html_end_tag_handler_t =
        lolhtml::directive_handler::<lolhtml::EndTag, EndTagHandler>;
}

impl lolhtml::DirectiveCallback<lolhtml::EndTag> for EndTagHandler {
    fn call(&mut self, container: &mut lolhtml::EndTag) -> bool {
        EndTagHandler::on_end_tag(self, container)
    }
}

impl EndTag {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub fn init(end_tag: *mut lolhtml::EndTag) -> *mut EndTag {
        bun_core::heap::into_raw(Box::new(EndTag {
            ref_count: Cell::new(1),
            end_tag: Cell::new(end_tag),
        }))
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    lol_content_ops! { EndTag, end_tag, JSValue::NULL;
        before / before_,
        after / after_,
        #[allow(dead_code)] replace / replace_,
    }

    #[bun_jsc::host_fn(method)]
    pub fn remove(&self, _global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(end_tag) = lolhtml::EndTag::from_ptr(self.end_tag.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        end_tag.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(end_tag) = lolhtml::EndTag::from_ptr(self.end_tag.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        html_string_to_js(end_tag.get_name(), global_object)
    }

    // PORT NOTE: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `EndTagPrototype__setName` via `host_setter_result`.
    pub fn set_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let Some(end_tag) = lolhtml::EndTag::from_ptr(self.end_tag.get()) else {
            return Ok(());
        };
        let text = value.to_slice(global)?;
        if end_tag.set_name(text.slice()).is_err() {
            return Err(global.throw_value(create_lolhtml_error(global)));
        }
        Ok(())
    }
}

impl_wrapper_like!(EndTag, lolhtml::EndTag);

// ───────────────────────── AttributeIterator ─────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = AttributeIterator::destroy_on_zero)]
pub struct AttributeIterator {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub iterator: Cell<*mut lolhtml_sys::AttributeIterator>,
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
        unsafe { (*this).detach() };
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn init(iterator: *mut lolhtml::AttributeIterator) -> *mut AttributeIterator {
        bun_core::heap::into_raw(Box::new(AttributeIterator {
            ref_count: Cell::new(1),
            iterator: Cell::new(iterator),
        }))
    }

    fn detach(&self) {
        if let Some(it) = lolhtml::AttributeIterator::from_ptr(self.iterator.get()) {
            it.destroy();
            self.iterator.set(core::ptr::null_mut());
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

        let Some(it) = lolhtml::AttributeIterator::from_ptr(self.iterator.get()) else {
            return JSValue::create_object2(
                global_object,
                &done_label,
                &value_label,
                JSValue::TRUE,
                JSValue::UNDEFINED,
            );
        };

        let Some(attribute) = it.next() else {
            it.destroy();
            self.iterator.set(core::ptr::null_mut());
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
                    html_string_to_bun_string(name),
                    html_string_to_bun_string(value),
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
    pub element: Cell<*mut lolhtml_sys::Element>,
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
        unsafe { (*this).invalidate() };
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn init(element: *mut lolhtml::Element) -> *mut Element {
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
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return Ok(JSValue::NULL);
        };
        if function.is_undefined_or_null() || !function.is_callable() {
            return Ok(ZigString::init_utf8(b"Expected a function").to_js(global_object));
        }

        let end_tag_handler = bun_core::heap::into_raw(Box::new(EndTagHandler {
            global: GlobalRef::from(global_object),
            callback: Some(function),
        }));

        if el
            .on_end_tag(
                EndTagHandler::ON_END_TAG_HANDLER,
                end_tag_handler.cast::<core::ffi::c_void>(),
            )
            .is_err()
        {
            // SAFETY: end_tag_handler allocated above and not yet handed to lol-html.
            unsafe { drop(bun_core::heap::take(end_tag_handler)) };
            let err = create_lolhtml_error(global_object);
            return Err(global_object.throw_value(err));
        }

        function.protect();
        Ok(call_frame.this())
    }

    /// Returns the value for a given attribute name on the element, or null if it is not found.
    pub fn get_attribute_(
        &self,
        global_object: &JSGlobalObject,
        name: ZigString,
    ) -> JsResult<JSValue> {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return Ok(JSValue::NULL);
        };
        let slice = name.to_slice();
        let attr = el.get_attribute(slice.slice());

        if attr.len == 0 {
            return Ok(JSValue::NULL);
        }

        html_string_to_js(attr, global_object)
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub fn has_attribute_(&self, global: &JSGlobalObject, name: ZigString) -> JSValue {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return JSValue::FALSE;
        };
        let slice = name.to_slice();
        match el.has_attribute(slice.slice()) {
            Ok(b) => JSValue::from(b),
            Err(_) => create_lolhtml_error(global),
        }
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn set_attribute_(
        &self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name_: ZigString,
        value_: ZigString,
    ) -> JSValue {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return JSValue::UNDEFINED;
        };

        // Mutating the attribute Vec (push → possible realloc) invalidates the
        // slice::Iter any live AttributeIterator borrows from.
        self.detach_attribute_iterators();

        let name_slice = name_.to_slice();
        let value_slice = value_.to_slice();
        if el
            .set_attribute(name_slice.slice(), value_slice.slice())
            .is_err()
        {
            return create_lolhtml_error(global_object);
        }
        call_frame.this()
    }

    /// Removes the attribute.
    pub fn remove_attribute_(
        &self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name: ZigString,
    ) -> JSValue {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return JSValue::UNDEFINED;
        };

        // Vec::remove shifts trailing elements and shrinks len, leaving any
        // live slice::Iter's end pointer past the new end.
        self.detach_attribute_iterators();

        let name_slice = name.to_slice();
        if el.remove_attribute(name_slice.slice()).is_err() {
            return create_lolhtml_error(global_object);
        }
        call_frame.this()
    }

    // ── host_fn.wrapInstanceMethod hand-expansions (attribute ops) ───────

    pub fn on_end_tag(&self, global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<1>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let function = eat_js_value(&mut iter, global)?;
        self.on_end_tag_(global, function, call_frame)
    }

    pub fn get_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<1>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let name = eat_zig_string(&mut iter, global)?;
        self.get_attribute_(global, name)
    }

    pub fn has_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<1>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let name = eat_zig_string(&mut iter, global)?;
        Ok(self.has_attribute_(global, name))
    }

    pub fn set_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<2>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let name = eat_zig_string(&mut iter, global)?;
        let value = eat_zig_string(&mut iter, global)?;
        Ok(self.set_attribute_(call_frame, global, name, value))
    }

    pub fn remove_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<1>();
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        let name = eat_zig_string(&mut iter, global)?;
        Ok(self.remove_attribute_(call_frame, global, name))
    }

    lol_content_ops! { Element, element, JSValue::UNDEFINED;
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
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
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
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        el.remove_and_keep_content();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_tag_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        html_string_value(el.tag_name(), global_object)
    }

    // PORT NOTE: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `ElementPrototype__setTagName` via `host_setter_result`.
    pub fn set_tag_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return Ok(());
        };
        let text = value.to_slice(global)?;
        if el.set_tag_name(text.slice()).is_err() {
            return Err(global.throw_value(create_lolhtml_error(global)));
        }
        Ok(())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_removed(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::Element::from_ptr(self.element.get()) {
            Some(el) => JSValue::from(el.is_removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_self_closing(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::Element::from_ptr(self.element.get()) {
            Some(el) => JSValue::from(el.is_self_closing()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_can_have_content(&self, _global: &JSGlobalObject) -> JSValue {
        match lolhtml::Element::from_ptr(self.element.get()) {
            Some(el) => JSValue::from(el.can_have_content()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_namespace_uri(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: namespaceURI returns a NUL-terminated C string owned by lol-html.
        let ns = unsafe { bun_core::ffi::cstr(el.namespace_uri()) };
        bun_string_jsc::create_utf8_for_js(global_object, ns.to_bytes())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_attributes(&self, global_object: &JSGlobalObject) -> JSValue {
        let Some(el) = lolhtml::Element::from_ptr(self.element.get()) else {
            return JSValue::UNDEFINED;
        };

        let Some(iter) = el.attributes() else {
            return create_lolhtml_error(global_object);
        };
        let attr_iter = bun_core::heap::into_raw(Box::new(AttributeIterator {
            ref_count: Cell::new(1),
            iterator: Cell::new(iter),
        }));
        // Track this iterator so we can detach it when the handler returns.
        // lol-html's attribute iterator borrows from the element's attribute
        // buffer which is freed after the callback; leaking the iterator to JS
        // without detaching it would be a use-after-free.
        // SAFETY: attr_iter is a fresh heap::alloc allocation (refcount==1).
        unsafe { (*attr_iter).ref_() };
        // R-2: `with_mut` — closure does not call into JS (push only).
        self.attribute_iterators.with_mut(|v| v.push(attr_iter));
        // SAFETY: attr_iter is live (refcount==2 now); ownership is shared with
        // the GC wrapper via the intrusive refcount (`finalize` → `deref`).
        unsafe { AttributeIterator::to_js_ptr(attr_iter, global_object) }
    }
}

impl_wrapper_like!(Element, lolhtml::Element, invalidate);

// ported from: src/runtime/api/html_rewriter.zig
