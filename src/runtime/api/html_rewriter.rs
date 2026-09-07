//! HTMLRewriter API — wraps lol-html for JS.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_jsc::{
    self as jsc, CallFrame, GlobalRef, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult,
    ProtectedJSValue, SystemError, bun_string_jsc,
};
// Note: `bun_jsc::VirtualMachine` is a *module* re-export
// (`pub use self::virtual_machine as VirtualMachine;`). The struct lives at
// `bun_jsc::virtual_machine::VirtualMachine` — import that directly so the
// name resolves as a type.
use bun_jsc::virtual_machine::VirtualMachine;

use bun_collections::ByteVecExt;
use bun_ptr::{BackRef, CellRefCounted, DetachablePtr, RawSlice, RefPtr};
use bun_sys::Error as SysError;

use crate::api::native_promise_context;
use crate::generated_classes::{js_HTMLRewriterTransform, js_Response};
use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{
    self, SourceHandle, Start, StartTag, StreamError, StreamResult, Writable, WritablePending,
};
use crate::webcore::{self, ByteStream, DrainResult, ReadableStream, Response, SinkHandle};
use bun_core::{EncodedSlice, String as BunString, Utf8Bytes};
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::call_frame::ArgumentsSlice;

// lol-html rewritable units, lifetime-erased to `'static` so a `*mut RawX`
// can be parked in a JsClass `DetachablePtr` for the duration of the
// synchronous handler call (the slot is nulled again before the handler
// returns). The `DetachablePtr` type invariant is discharged by
// `handler_callback`: it parks the `&mut X` lol-html lends the closure
// (`build_settings`, `EndTag::on_end_tag`), runs the JS callback, and its
// scopeguard `detach()`s the slot before the closure returns to lol-html — so
// a non-null load means the pointee is still inside lol-html's exclusive
// borrow, and a JS object retained past its handler reads `None`.
type RawElement = lol_html::html_content::Element<'static, 'static>;
type RawTextChunk = lol_html::html_content::TextChunk<'static>;
type RawComment = lol_html::html_content::Comment<'static>;
type RawDoctype = lol_html::html_content::Doctype<'static>;
type RawDocumentEnd = lol_html::html_content::DocumentEnd<'static>;
type RawEndTag = lol_html::html_content::EndTag<'static>;

// ───────────────────── local helpers ─────────────────────────────────────

/// Construct a `SystemError` with code+message and remaining fields defaulted.
fn system_error(code: &'static str, message: &'static str) -> SystemError {
    SystemError {
        code: BunString::static_(code),
        message: BunString::static_(message),
        ..Default::default()
    }
}

// ─────────────────── instance-method arg-decode helpers ──────────────────
//
// Note: a `#[bun_jsc::host_fn(method)]` proc-macro form of typed argument
// decoding hasn't landed, so the per-type decode arms used by HTMLRewriter
// (string, `?ContentOptions`, `JSValue`) are open-coded here as small
// helpers.

/// Decode arm for a string — eat next arg, throw "Missing argument" if
/// absent, "Expected string" if undefined/null, otherwise ToString it into a
/// slice that owns (or holds a ref on) its bytes. A borrowed view of the
/// temporary `JSString` would not survive the user JS (a later argument's
/// `toString`/getter) that runs before lol-html copies the bytes.
fn eat_string(
    iter: &mut ArgumentsSlice<'_>,
    global: &JSGlobalObject,
) -> JsResult<Utf8Bytes<'static>> {
    let Some(value) = iter.next_eat() else {
        return Err(global.throw_invalid_arguments(format_args!("Missing argument")));
    };
    if value.is_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected string")));
    }
    value.to_utf8(global)
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

/// Common `(content: string, contentOptions: ?ContentOptions)` pair —
/// every `before/after/replace/append/prepend/setInnerContent` wrapper
/// decodes exactly this shape.
fn eat_content_args(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<(Utf8Bytes<'static>, Option<ContentOptions>)> {
    let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
    let content = eat_string(&mut iter, global)?;
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
/// - `$field`    — the `DetachablePtr<$Raw>` field on `self`.
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
            content: &[u8],
            content_options: Option<ContentOptions>,
        ) -> JsResult<JSValue> {
            let Some(raw) = self.$field.get_mut() else {
                return Ok($null_ret);
            };
            // lol-html content ops are infallible, so the UTF-8 check is the only throw path.
            let content_str = utf8_or_throw(global_object, content)?;
            callback(raw, content_str, content_type(content_options));
            Ok(this_object)
        }

        $(
            $(#[$attr])*
            pub fn $name_(
                &self,
                call_frame: &CallFrame,
                global_object: &JSGlobalObject,
                content: &[u8],
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

            // Decode `(content: string, contentOptions: ?ContentOptions)`
            // then forward.
            $(#[$attr])*
            pub fn $name(
                &self,
                global: &JSGlobalObject,
                call_frame: &CallFrame,
            ) -> JsResult<JSValue> {
                let (content, opts) = eat_content_args(global, call_frame)?;
                self.$name_(call_frame, global, &content, opts)
            }
        )*
    };
}

// ───────────────────────────── LOLHTMLContext ─────────────────────────────

/// One `on(selector, handlers)` registration.
pub(crate) struct ElementHandlerEntry {
    pub(crate) selector: lol_html::Selector,
    // The `Box` is load-bearing (here and in `document_handlers`): the lol-html
    // handler closures produced by `build_settings` capture raw pointers into
    // the box interiors; unboxing would dangle them on `Vec` realloc.
    pub(crate) handler: Box<ElementHandler>,
}

/// Selector + handler registry shared between an [`HTMLRewriter`] and every
/// rewriter it spawns — `transform()` can run more than once, so
/// [`build_settings`] re-derives fresh handler closures from it each time.
#[derive(Default)]
pub struct LOLHTMLContext {
    pub(crate) element_handlers: Vec<ElementHandlerEntry>,
    #[expect(clippy::vec_box)]
    pub(crate) document_handlers: Vec<Box<DocumentHandler>>,
}

/// What a JS content handler decided.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HandlerOutcome {
    /// The handler completed; keep rewriting.
    Continue,
    /// The handler threw / rejected / returned an Error: abort the rewrite.
    Stop,
    /// The handler returned a promise that is still pending after one
    /// microtask drain: make lol-html park the current rewritable unit and
    /// return from `write()`/`end()`/`resume()` so the event loop can run.
    /// See [`RewriterPipe::begin_suspension`].
    Suspend,
}

/// Map the outcome onto lol-html's `HandlerResult`. The `Stop` message is
/// load-bearing: lol-html's C API produced exactly this string for a stopped
/// rewriter; it reaches JS as-is.
fn handler_result(outcome: HandlerOutcome) -> lol_html::HandlerResult {
    match outcome {
        HandlerOutcome::Continue => Ok(()),
        HandlerOutcome::Stop => Err("The rewriter has been stopped.".into()),
        HandlerOutcome::Suspend => Err(Box::new(lol_html::SuspensionRequest)),
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
    for ElementHandlerEntry { selector, handler } in &mut ctx.element_handlers {
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
                handler_result(ElementHandler::on_element(h, raw))
            });
        }
        if has_comment {
            handlers = handlers.comments(move |c: &mut lol_html::html_content::Comment| {
                let raw: *mut lol_html::html_content::Comment<'static> =
                    core::ptr::from_mut(c).cast();
                handler_result(ElementHandler::on_comment(h, raw))
            });
        }
        if has_text {
            handlers = handlers.text(move |t: &mut lol_html::html_content::TextChunk| {
                let raw: *mut lol_html::html_content::TextChunk<'static> =
                    core::ptr::from_mut(t).cast();
                handler_result(ElementHandler::on_text(h, raw))
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
                handler_result(DocumentHandler::on_doc_type(h, raw))
            });
        }
        if has_comment {
            handlers = handlers.comments(move |c: &mut lol_html::html_content::Comment| {
                let raw: *mut lol_html::html_content::Comment<'static> =
                    core::ptr::from_mut(c).cast();
                handler_result(DocumentHandler::on_comment(h, raw))
            });
        }
        if has_text {
            handlers = handlers.text(move |t: &mut lol_html::html_content::TextChunk| {
                let raw: *mut lol_html::html_content::TextChunk<'static> =
                    core::ptr::from_mut(t).cast();
                handler_result(DocumentHandler::on_text(h, raw))
            });
        }
        if has_end {
            handlers = handlers.end(move |e: &mut lol_html::html_content::DocumentEnd| {
                let raw: *mut lol_html::html_content::DocumentEnd<'static> =
                    core::ptr::from_mut(e).cast();
                handler_result(DocumentHandler::on_end(h, raw))
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
        selector_name: &[u8],
        call_frame: &CallFrame,
        listener: JSValue,
    ) -> JsResult<JSValue> {
        let selector_source = utf8_or_throw(global, selector_name)?;
        let selector = match selector_source.parse::<lol_html::Selector>() {
            Ok(s) => s,
            Err(e) => return Err(global.throw_value(create_lolhtml_error(global, &e))),
        };

        let handler = Box::new(ElementHandler::init(global, listener)?);
        self.context
            .borrow_mut()
            .element_handlers
            .push(ElementHandlerEntry { selector, handler });
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

    /// `sync_only_noun` is `Some("a string" | "an ArrayBuffer")` when the
    /// caller needs the rewrite to finish before `transform()` returns; a
    /// handler that would suspend then fails the rewrite instead.
    pub(crate) fn begin_transform(
        &self,
        global: &JSGlobalObject,
        response: &Response,
        sync_only_noun: Option<&'static str>,
    ) -> JsResult<JSValue> {
        let new_context = Rc::clone(&self.context);
        RewriterPipe::init(new_context, global, response, sync_only_noun)
    }

    pub(crate) fn transform_(
        &self,
        global: &JSGlobalObject,
        response_value: JSValue,
    ) -> JsResult<JSValue> {
        // `js_Response::from_js` returns the `m_ctx` as `NonNull<Response>`;
        // wrap it in a `BackRef` for a safe `&Response` — `response_value` is
        // on the stack (conservatively scanned), so the native payload outlives
        // this host-fn body.
        if let Some(response) = js_Response::from_js(response_value).map(BackRef::<Response>::from)
        {
            // An already-failed body surfaces its stored upstream error (abort
            // reason, connection error) instead of a generic "body already used"
            // — the error is the useful bit, and `wire_input` would otherwise
            // treat `Value::Error` as an empty blob and emit an empty document.
            let body_value = response.get_body_value();
            if let webcore::body::Value::Error(err) = body_value {
                return Err(global.throw_value(err.to_js(global)));
            }
            if matches!(*body_value, webcore::body::Value::Used) {
                return Err(
                    global.throw_invalid_arguments(format_args!("Response body already used"))
                );
            }
            let out = self.begin_transform(global, &response, None)?;
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
        } else if response_value.js_type().is_array_buffer_like() {
            ResponseKind::ArrayBuffer
        } else {
            ResponseKind::Other
        };

        if kind != ResponseKind::Other {
            let body_value = webcore::body::extract(global, response_value)?;
            let resp = RefPtr::new(Response::init(
                webcore::response::Init {
                    status_code: 200,
                    ..Default::default()
                },
                body_value,
                BunString::EMPTY,
                false,
            ));

            // Carries its own article: "an ArrayBuffer", not "a ArrayBuffer".
            let noun = if kind == ResponseKind::String {
                "a string"
            } else {
                "an ArrayBuffer"
            };
            let out_response_value = self.begin_transform(global, &resp, Some(noun))?;
            // Check if the returned value is an error and throw it properly
            if let Some(err) = out_response_value.to_error() {
                return Err(global.throw_value(err));
            }
            out_response_value.ensure_still_alive();
            let Some(out_response) =
                js_Response::from_js(out_response_value).map(BackRef::<Response>::from)
            else {
                return Ok(out_response_value);
            };

            // The body is never still `Locked` here: `sync_only_noun` makes a
            // handler that would suspend fail the rewrite instead, and `init`
            // rethrows that as the synchronous TypeError above.
            let mut blob = out_response
                .get_body_value()
                .use_as_any_blob_allow_non_utf8_string();

            // Null out the JS wrapper's `m_ctx` so its GC finalize is a no-op,
            // then release the wrapper's +1 ourselves. The pipe still holds its
            // own (`RewriterPipe.response`).
            js_Response::detach_ptr(out_response_value);
            // SAFETY: releases the wrapper's ref that `detach_ptr` orphaned.
            unsafe { Response::deref(out_response.as_const_ptr().cast_mut()) };

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
        let selector_name = eat_string(&mut iter, global)?;
        let listener = eat_js_value(&mut iter, global)?;
        self.on_(global, &selector_name, call_frame, listener)
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

// ─────────────────────────── RewriterPipe ────────────────────────────────

/// The concrete lol-html rewriter type backing one `transform()`.
pub(crate) type LolRewriter =
    lol_html::HtmlRewriter<'static, bun_bundler::HTMLScanner::OutputSink<'static>>;

/// Which lol-html call the pipe still has to run (or finish). Advanced by
/// [`RewriterPipe::feed`] / [`RewriterPipe::end_rewrite`] /
/// [`RewriterPipe::resume_rewrite`].
#[derive(Clone, Copy, PartialEq, Eq)]
enum RewritePhase {
    /// `write(input)` has not completed (not started, or a handler suspended it).
    WritePending,
    /// `write` completed; `end()` has not (not started, or suspended).
    EndPending,
    /// The rewrite ran to completion or failed; nothing left to drive.
    Done,
}

/// The JS wrapper a suspended handler is still using, plus the ref
/// `handler_callback` took on it; dropping it detaches the wrapper first.
enum SuspendedWrapper {
    Element(RefPtr<Element>),
    Comment(RefPtr<Comment>),
    TextChunk(RefPtr<TextChunk>),
    EndTag(RefPtr<EndTag>),
    DocType(RefPtr<DocType>),
    DocEnd(RefPtr<DocEnd>),
}

impl SuspendedWrapper {
    /// Point the wrapper at the heap copy lol-html parked on suspend.
    fn retarget(&self, rewriter: &mut LolRewriter) {
        match self {
            Self::Element(p) => p.retarget(Element::suspended_raw(rewriter)),
            Self::Comment(p) => p.retarget(Comment::suspended_raw(rewriter)),
            Self::TextChunk(p) => p.retarget(TextChunk::suspended_raw(rewriter)),
            Self::EndTag(p) => p.retarget(EndTag::suspended_raw(rewriter)),
            Self::DocType(p) => p.retarget(DocType::suspended_raw(rewriter)),
            Self::DocEnd(p) => p.retarget(DocEnd::suspended_raw(rewriter)),
        }
    }
}

impl Drop for SuspendedWrapper {
    fn drop(&mut self) {
        match self {
            Self::Element(p) => WrapperLike::detach(&**p),
            Self::Comment(p) => WrapperLike::detach(&**p),
            Self::TextChunk(p) => WrapperLike::detach(&**p),
            Self::EndTag(p) => WrapperLike::detach(&**p),
            Self::DocType(p) => WrapperLike::detach(&**p),
            Self::DocEnd(p) => WrapperLike::detach(&**p),
        }
    }
}

/// Installs `pipe` as the VM's active HTMLRewriter sink for the duration of
/// one lol-html `write()`/`end()`/`resume()` call, restoring the previous one
/// on drop. LIFO so a handler body that synchronously runs a nested
/// `transform()` nests correctly.
struct ActiveSinkGuard {
    prev: Option<NonNull<c_void>>,
}

impl ActiveSinkGuard {
    fn enter(pipe: &RewriterPipe) -> Self {
        let vm: &mut VirtualMachine = pipe.global.bun_vm().as_mut();
        Self {
            prev: core::mem::replace(
                &mut vm.html_rewriter_active_sink,
                NonNull::new(core::ptr::from_ref(pipe).cast_mut().cast()),
            ),
        }
    }
}

impl Drop for ActiveSinkGuard {
    fn drop(&mut self) {
        // SAFETY: the JS thread's VM outlives this synchronous frame.
        VirtualMachine::get().as_mut().html_rewriter_active_sink = self.prev;
    }
}

/// The `RewriterPipe` whose lol-html call is on this VM's native stack, if
/// any. Content handlers can only run inside such a call.
fn active_sink(global: &JSGlobalObject) -> Option<BackRef<RewriterPipe>> {
    global
        .bun_vm_ref()
        .html_rewriter_active_sink
        .map(|p| BackRef::from(p.cast::<RewriterPipe>()))
}

/// Codegen alias: the generated `JSHTMLRewriterTransform` cell's `m_ctx` is a
/// `*mut RewriterPipe`. The cell is created per `transform()` call, stashed in
/// the output Response's `m_transform` slot, and used as the `.then()` context
/// for a suspended handler's promise. Its six `values:` WriteBarrier slots
/// root the output Response, input/output ReadableStreams, the JS-pump
/// `WritablePending` promise, a captured handler error, and the suspension
/// promise.
pub type HTMLRewriterTransform = RewriterPipe;

/// Streaming pipe for one `HTMLRewriter::transform()`: receives input bytes
/// via [`SinkHandle::HTMLRewriter`], feeds them through lol-html (suspending
/// when a content handler returns a pending Promise), and emits output either
/// into a pre-stream buffer or — once JS reads `.body` — a [`ByteStream`]
/// whose `producer` is [`SourceHandle::HTMLRewriter`].
///
/// Flow control follows the output's reader. While something is positioned
/// to drain the output ([`Self::output_observed`]) the input is held whenever
/// that reader falls a high-water mark behind, and its drain signal resumes
/// it. While nothing is, the rewrite still runs to completion — its handlers
/// are side effects callers rely on — but one upstream chunk per event-loop
/// turn ([`Self::schedule_background_pull`]), so a synchronous source such as
/// a regular file is never read through inside a single call.
/// `align(16)`: `NativePromiseContext`'s deferred-deref task packs a 4-bit
/// type tag into the low bits of a pointer to this.
#[derive(bun_ptr::CellRefCounted)]
#[repr(align(16))]
pub struct RewriterPipe {
    pub(crate) global: GlobalRef,
    /// The owning `JSHTMLRewriterTransform` wrapper cell (whose `m_ctx` is this
    /// pipe). Its WriteBarrier slots root the response, input/output streams,
    /// pending promise, and handler error.
    cell: Cell<JSValue>,
    /// Boxed (never held by value): lol-html's `write/end/resume` re-enter
    /// the output sink which reads fields off `*self`. `JsCell`
    /// because those calls (and `suspended_*`) need `&mut LolRewriter` from
    /// `&self`.
    rewriter: JsCell<Option<Box<LolRewriter>>>,
    context: Rc<RefCell<LOLHTMLContext>>,

    // ── input side ───────────────────────────────────────────────────────
    /// Upstream to resume (`ready()`) once output drains, or `close()` once
    /// the output reader cancels.
    input_source: Cell<SourceHandle>,
    /// Input EOF arrived while a suspension or output backpressure kept us
    /// from calling `end_rewrite()`; run it once unblocked.
    input_ended: Cell<bool>,
    /// `true` while a JS-pump `.then()` reaction (attached in
    /// [`Self::wire_input`]) is still owed. The pump closes the sink before
    /// its promise settles, so `end_from_stream` defers terminal work to the
    /// reaction while this is set.
    js_pump_reaction_pending: Cell<bool>,
    /// Bytes accepted from the input while suspended or output-backpressured.
    pending_input: JsCell<Vec<u8>>,
    /// A [`Self::run_background_pull`] task is in the event-loop queue.
    background_pull_queued: Cell<bool>,
    /// That task should pull the input when it runs; cleared when a reader
    /// attaches and drives the input itself first.
    background_pull_armed: Cell<bool>,

    // ── output side ──────────────────────────────────────────────────────
    /// Set by [`Self::on_readable_stream_available`]; `None` until JS reads
    /// `.body` on the output Response. Kept alive by the cell's `outputStream`
    /// slot.
    output: Cell<Option<bun_ptr::BackRef<ByteStream>>>,
    /// lol-html output of the current `write`/`end`/`resume` call; flushed to
    /// `output` when the call returns, or kept here until the output stream
    /// exists (`on_start_streaming`) or the rewrite finishes.
    output_buffer: JsCell<Vec<u8>>,
    /// A consumer is waiting on the pending body as a whole (`.text()`,
    /// `Bun.write`, … via [`Self::on_start_buffering`]): the output is
    /// observed and never backpressured.
    buffered_consumer: Cell<bool>,
    /// The pipe's ref on the output Response, so the body stays reachable
    /// (`fail()`, the abandon-suspension path) after the Response JS wrapper
    /// has been swept alongside the Transform cell.
    response: JsCell<Option<RefPtr<Response>>>,

    // ── suspension (from #33243) ─────────────────────────────────────────
    phase: Cell<RewritePhase>,
    /// Set for `transform(string)` / `transform(ArrayBuffer)`. Holds the noun
    /// for the error message, article included. A handler that would suspend
    /// fails the whole rewrite instead.
    sync_only_noun: Cell<Option<&'static str>>,
    /// Handed from the suspending [`handler_callback`] to
    /// [`Self::begin_suspension`] across the lol-html unwind. The promise
    /// itself is rooted in the cell's `suspensionPromise` WriteBarrier slot.
    pending_suspension: JsCell<Option<SuspendedWrapper>>,
    suspended_wrapper: JsCell<Option<SuspendedWrapper>>,
    /// `true` while a lol-html `write`/`end_mut`/`resume` call on this pipe's
    /// `rewriter` is on the stack. The output sink may re-enter the pipe via
    /// `on_ready`/`write`/`end_from_stream` during that call; those entry
    /// points defer instead of re-driving the (still-running) rewriter.
    driving: Cell<bool>,

    // ── JS-pump path ─────────────────────────────────────────────────────
    /// Shared pending drain promise for the JS-pump `write()`/`flush(true)`.
    pending: JsCell<WritablePending>,
    done: Cell<bool>,

    // ── allocation lifetime ──────────────────────────────────────────────
    /// Owners that may still dispatch into this allocation: the Transform
    /// cell (releases in [`Self::finalize`]), the JS-pump controller's raw
    /// `m_sinkPtr` (releases via `__controllerDetached`), and a parked
    /// suspension's reaction/abandon task. GC sweeps cells in unspecified
    /// order within a cycle, so whichever owner releases last frees the Box.
    ref_count: Cell<u32>,
    /// `ref_count` includes a JS-pump controller entry; consumed exactly once
    /// by [`Self::release_pump_ref`].
    pump_controller_attached: Cell<bool>,
}

impl RewriterPipe {
    /// How far the output may run ahead of its reader before the input is
    /// held (or, unobserved, before the turn is yielded). The same distance
    /// `fetch()` lets a request-body stream run ahead of the socket.
    const HIGH_WATER_MARK: BlobSizeType = 16384;

    /// `JSHTMLRewriterTransform` finalizer. Runs during GC sweep: nothing
    /// here may touch other GC cells, and the other ref holders may still
    /// dispatch into the pipe after this cell is swept.
    pub fn finalize(&self) {
        self.cell.set(JSValue::ZERO);
    }

    /// Release one ref, deferring the release of the *last* ref to the event
    /// loop: the native caller on the stack keeps dispatching into the
    /// allocation in the same frame after the call that dropped it returns.
    fn deref_outside_caller(&self) {
        if self.ref_count.get() > 1 {
            Self::deref_nn(NonNull::from(self));
            return;
        }
        native_promise_context::DeferredDerefTask::schedule(
            core::ptr::from_ref(self).cast_mut().cast(),
            native_promise_context::Tag::HTMLRewriterPipeFree,
        );
    }

    /// The JS-pump controller detached and can never dispatch into the pipe
    /// again: release its ref. Deferred if last: the C++ caller keeps using
    /// the allocation in the same frame (the destructor's trailing
    /// `__finalize`, the close/end host fns' `__close`/`__endWithSink` on the
    /// saved pointer).
    fn release_pump_ref(&self) {
        if !self.pump_controller_attached.replace(false) {
            return;
        }
        self.deref_outside_caller();
    }

    /// Queued by the `NativePromiseContext` destructor (via
    /// `DeferredDerefTask`) when the handler's promise was collected without
    /// settling: it will never resume this pipe. Runs on the JS thread,
    /// outside GC sweep; the suspension's ref keeps `pipe` live until here.
    ///
    /// If the Transform cell is still alive (its `cell` backref is set) —
    /// a reader or the output Response keeps the rewrite reachable — fail
    /// the body normally, which errors the live output stream and clears the
    /// `owner`/`sinkOwner` edges so the cell becomes ordinary garbage. If the
    /// cell was swept with the promise (`cell` is zeroed), every source that
    /// could have held a backref died with the cell, so clear the handles
    /// raw and fail the body through the Response native `+1`.
    ///
    /// Once the VM has stopped (a worker torn down with the handler still
    /// parked; this may then be reached mid-sweep from `~VM`) nothing is
    /// failed: script is over and the streams die with the VM, so the handles
    /// are cleared raw and only the ref is released, so the pipe and its
    /// rewriter do not outlive the worker.
    pub(crate) fn abandon_suspension(pipe: bun_ptr::BackRef<Self>) {
        let this = &*pipe;
        this.end_suspension();
        let vm_stopped = !VirtualMachine::get().script_allowed();
        if vm_stopped || !this.cell.get().is_cell() {
            this.input_source.set(SourceHandle::None);
            this.output.set(None);
        }
        if vm_stopped {
            this.phase.set(RewritePhase::Done);
            this.done.set(true);
        } else {
            this.fail(webcore::body::ValueError::Message(BunString::static_(
                "HTMLRewriter content handler returned a Promise that will never settle",
            )));
        }
        Self::deref_nn(pipe.into());
    }

    /// Record a handler's exception for the enclosing lol-html call to pick
    /// up once it returns. Rooted by the cell's `handlerError` WriteBarrier
    /// slot until it is taken.
    pub(crate) fn set_handler_error(&self, err: JSValue) {
        js_HTMLRewriterTransform::handler_error_set_cached(self.cell.get(), &self.global, err);
    }

    /// Take (and clear) the handler error recorded during the lol-html call
    /// that just returned.
    fn take_handler_error(&self) -> Option<JSValue> {
        let cell = self.cell.get();
        let err = js_HTMLRewriterTransform::handler_error_get_cached(cell);
        match err {
            Some(v) if !v.is_empty_or_undefined_or_null() => {
                js_HTMLRewriterTransform::handler_error_set_cached(
                    cell,
                    &self.global,
                    JSValue::UNDEFINED,
                );
                Some(v)
            }
            _ => None,
        }
    }

    /// Sever the wired input source: null the upstream's raw `sink` backref
    /// so it can no longer dispatch into this pipe. With `cancel_upstream`,
    /// also close a native producer afterwards, so a failed or cancelled
    /// rewrite stops a fetch mid-download and closes a file fd instead of
    /// draining to upstream EOF; EOF paths pass `false`. Only called from
    /// terminal paths on the JS thread. Idempotent: the handle is `None`
    /// after the first call. Returns the severed handle for
    /// [`Self::release_input_roots`], which the caller runs after its
    /// terminal work.
    fn detach_input_source(&self, cancel_upstream: bool) -> SourceHandle {
        let mut src = self.input_source.replace(SourceHandle::None);
        let mut upstream = src;
        JSSink::<RewriterPipe>::detach(&mut src, &self.global);
        if cancel_upstream {
            match upstream {
                SourceHandle::ByteStream(_) | SourceHandle::FileReader(_) => {
                    upstream.close(None);
                }
                _ => {}
            }
        }
        upstream
    }

    /// Drop the GC edges between the Transform cell and its (severed) input:
    /// the source's `sinkOwner` slot, through which I/O rooted the cell, and
    /// the cell's `inputStream` slot, which rooted the source. Terminal paths
    /// run this last, after end handlers, body resolution and error
    /// construction, because those allocate while the source's own frames may
    /// still be on the stack below (a file's read loop delivering EOF, an
    /// upstream pipe delivering `Done`) and while this cell may be reachable
    /// only through that source.
    fn release_input_roots(&self, src: SourceHandle) {
        let cell = self.cell.get();
        if !cell.is_cell() {
            // Swept together with everything these edges pointed at.
            return;
        }
        match src {
            SourceHandle::ByteStream(bs) => bs.parent_const().set_sink_owner(JSValue::UNDEFINED),
            SourceHandle::FileReader(fr) => fr.parent_const().set_sink_owner(JSValue::UNDEFINED),
            _ => {}
        }
        js_HTMLRewriterTransform::input_stream_set_cached(cell, &self.global, JSValue::UNDEFINED);
    }

    /// Sever the output `ByteStream`'s `SourceHandle::HTMLRewriter` backref
    /// (installed via `PendingValue.producer` in [`Self::init`]) so a later
    /// `signal_drained()` can't reach a freed pipe, and clear its `owner`
    /// slot. Only called from terminal paths on the JS thread. Idempotent.
    fn detach_output(&self) {
        if let Some(out) = self.output.take() {
            out.parent_const().set_owner(JSValue::UNDEFINED);
            out.parent_const().producer.set(SourceHandle::None);
        }
    }

    #[inline]
    fn is_suspended(&self) -> bool {
        self.suspended_wrapper.get().is_some() || self.pending_suspension.get().is_some()
    }

    /// Output emitted but not yet taken by a reader.
    fn unread_output(&self) -> BlobSizeType {
        let staged = self.output_buffer.get().len();
        let queued = self.output.get().map_or(0, |out| out.buffer.get().len());
        (staged + queued) as BlobSizeType
    }

    /// Whether anything is positioned to drain the output: a native sink or a
    /// buffered collector on the output stream, a parked or possible
    /// (`locked`) JS read on it, or a consumer waiting on the pending body.
    /// The same test `fetch()` applies to its own body stream before letting
    /// it hold the connection.
    fn output_observed(&self) -> bool {
        let Some(out) = self.output.get() else {
            return self.buffered_consumer.get();
        };
        if out.sink.get().is_some()
            || out.buffer_action.get().is_some()
            || out.pending.get().state == streams::PendingState::Pending
        {
            return true;
        }
        let cell = self.cell.get();
        cell.is_cell()
            && js_HTMLRewriterTransform::output_stream_get_cached(cell).is_some_and(|stream| {
                webcore::readable_stream::is_locked_value(stream, &self.global)
            })
    }

    /// An observed reader has fallen behind: hold the input until its drain
    /// signal (`resume()`).
    fn output_backpressured(&self) -> bool {
        if let Some(out) = self.output.get() {
            if out.sink_paused.get() {
                return true;
            }
            // A body-mixin collector grows `buffer` deliberately until Done.
            if out.buffer_action.get().is_some() {
                return false;
            }
        } else if self.buffered_consumer.get() {
            return false;
        }
        self.output_observed() && self.unread_output() > Self::HIGH_WATER_MARK
    }

    /// Nobody is draining the output: keep going, but not within this turn.
    fn should_yield(&self) -> bool {
        !self.output_observed() && self.unread_output() > Self::HIGH_WATER_MARK
    }

    fn init(
        context: Rc<RefCell<LOLHTMLContext>>,
        global: &JSGlobalObject,
        original: &Response,
        sync_only_noun: Option<&'static str>,
    ) -> JsResult<JSValue> {
        let pipe = bun_core::heap::alloc_nn(RewriterPipe {
            global: GlobalRef::from(global),
            cell: Cell::new(JSValue::ZERO),
            rewriter: JsCell::new(None),
            context,
            input_source: Cell::new(SourceHandle::None),
            input_ended: Cell::new(false),
            js_pump_reaction_pending: Cell::new(false),
            pending_input: JsCell::new(Vec::new()),
            background_pull_queued: Cell::new(false),
            background_pull_armed: Cell::new(false),
            output: Cell::new(None),
            output_buffer: JsCell::new(Vec::new()),
            buffered_consumer: Cell::new(false),
            response: JsCell::new(None),
            phase: Cell::new(RewritePhase::WritePending),
            sync_only_noun: Cell::new(sync_only_noun),
            pending_suspension: JsCell::new(None),
            suspended_wrapper: JsCell::new(None),
            driving: Cell::new(false),
            pending: JsCell::new(WritablePending::default()),
            done: Cell::new(false),
            ref_count: Cell::new(1),
            pump_controller_attached: Cell::new(false),
        });
        // Every field is `Cell`/`JsCell`, so a shared `&RewriterPipe` via
        // `BackRef` is sound across the re-entrant lol-html calls below.
        let this = BackRef::from(pipe);

        // The handler closures point into `Box`es owned by `(*pipe).context`,
        // which `pipe` keeps alive for the rewriter's whole lifetime.
        let (element_content_handlers, document_content_handlers) =
            build_settings(&mut this.context.borrow_mut());
        this.rewriter.set(Some(Box::new(lol_html::HtmlRewriter::new(
            lol_html::Settings {
                element_content_handlers,
                document_content_handlers,
                encoding: lol_html::AsciiCompatibleEncoding::utf_8(),
                // Default parsing-buffer preallocation: it only ever holds the
                // unparsed tail of one write (a token split across chunks).
                memory_settings: lol_html::MemorySettings {
                    max_allowed_memory_usage: u32::MAX as usize,
                    ..lol_html::MemorySettings::new()
                },
                strict: false,
                enable_esi_tags: false,
                adjust_charset_on_meta_tag: false,
            },
            // The pipe owns the `Box<LolRewriter>` that owns this sink, so the
            // back-reference to `output_buffer` cannot outlive its pointee.
            bun_bundler::HTMLScanner::OutputSink::Buffer(bun_ptr::BackRef::new(
                &this.output_buffer,
            )),
        ))));

        // ── output Response: body starts Locked(PendingValue{...}) ──────────
        // A consumer reading `.body` creates the ByteStream lazily; until then
        // the sink buffers into `output_buffer`, and `on_start_streaming`
        // hands that over as `DrainResult::Owned`.
        let result = bun_core::heap::alloc_nn(Response::init(
            webcore::response::Init {
                status_code: 200,
                ..Default::default()
            },
            webcore::Body::new({
                let mut pv = webcore::body::PendingValue::new(global);
                pv.task = Some(pipe.cast::<c_void>());
                pv.on_start_buffering = Some(RewriterPipe::on_start_buffering);
                pv.on_start_streaming = Some(RewriterPipe::on_start_streaming);
                pv.on_readable_stream_available = Some(RewriterPipe::on_readable_stream_available);
                pv.producer = SourceHandle::HTMLRewriter(this);
                webcore::body::Value::Locked(pv)
            }),
            BunString::EMPTY,
            false,
        ));
        let result_ref = BackRef::from(result);
        // SAFETY: `result` is the live Response just allocated above.
        this.response
            .set(Some(unsafe { RefPtr::init_ref(result.as_ptr()) }));

        result_ref.set_init(
            original.get_method(),
            original.get_init_status_code(),
            original.get_init_status_text().clone(),
        );

        // https://github.com/oven-sh/bun/issues/3334
        result_ref.set_init_headers(original.clone_init_headers(global)?);

        let response_js_value = result_ref.to_js(&this.global);

        // Hand ownership of `pipe` to its `JSHTMLRewriterTransform` wrapper cell.
        // The cell's WriteBarrier slots root the Response and (later) the
        // input/output streams; the Response's `transform` slot roots the cell
        // so it survives as long as user code can reach the output.
        let cell = js_HTMLRewriterTransform::to_js(pipe.as_ptr(), global);
        if !cell.is_cell() {
            // No wrapper exists to own the initial ref, so drop it here.
            Self::deref_nn(pipe);
            return Err(global.throw_out_of_memory());
        }
        this.cell.set(cell);
        js_HTMLRewriterTransform::response_set_cached(cell, global, response_js_value);
        js_Response::transform_set_cached(response_js_value, global, cell);

        result_ref.set_url(original.url().clone());

        // ── wire input ──────────────────────────────────────────────────────
        let value = original.get_body_value();
        let owned_readable_stream = original.get_body_readable_stream();

        Self::wire_input(this, global, value, owned_readable_stream);

        // A handler that failed synchronously (the input was materialized, so
        // the whole rewrite ran inline above) surfaces as a synchronous throw
        // from `transform()`. Mark the pipe terminal so nothing tries to
        // drive it again; the cell and its slots are ordinary garbage now.
        if let Some(captured) = this.take_handler_error() {
            captured.ensure_still_alive();
            this.phase.set(RewritePhase::Done);
            this.done.set(true);
            this.detach_output();
            return Err(global.throw_value(captured));
        }

        response_js_value.ensure_still_alive();
        Ok(response_js_value)
    }

    fn wire_input(
        pipe: bun_ptr::BackRef<Self>,
        global: &JSGlobalObject,
        value: &mut webcore::body::Value,
        stream: Option<ReadableStream>,
    ) {
        // `pipe` is the `heap::alloc_nn` allocation from `init()`; every field
        // is `Cell`/`JsCell`, so the shared `BackRef` borrow is sound across
        // the re-entrant lol-html calls below.
        let this = pipe;

        // A Locked body with no realised stream (fresh `fetch()` Response), or
        // a file/S3-backed Blob, must be turned into a ReadableStream first so
        // the ByteStream/FileReader wiring below can drive it.
        let mut stream = stream;
        if stream.is_none() {
            let needs_stream = match value {
                webcore::body::Value::Locked(_) => true,
                webcore::body::Value::Blob(b) => b.needs_to_read_file() || b.is_s3(),
                _ => false,
            };
            if needs_stream {
                match value
                    .to_readable_stream(global)
                    .and_then(|v| ReadableStream::from_js(v, global))
                {
                    Ok(s) => stream = s,
                    Err(e) => {
                        let err = global.take_exception(e);
                        this.set_handler_error(err);
                        return;
                    }
                }
            }
        }

        // Materialized-body fast path: feed synchronously, end, return. No
        // stream wiring; this covers InternalBlob/WTFStringImpl/Empty/Used and
        // Blob-with-bytes (the `sync_only_noun` path always lands here).
        let Some(stream) = stream else {
            // lol-html consumes UTF-8; `use_as_any_blob()` encodes a non-ASCII
            // WTFStringImpl into an InternalBlob so `.slice()` is always UTF-8.
            let mut any_blob = value.use_as_any_blob();
            let bytes = any_blob.slice();
            // Mark EOF first so a handler that suspends mid-feed resumes into
            // `end_rewrite` once its promise settles.
            this.input_ended.set(true);
            if this.feed(bytes) {
                this.end_rewrite();
            }
            // `blob::Any` has no `Drop`; release the WTFStringImpl/Blob `+1`
            // transferred by `use_as_any_blob`. A suspended lol-html has
            // already copied the unconsumed tail into its arena.
            any_blob.detach();
            return;
        };

        if stream.is_locked(global) || stream.is_disturbed(global) {
            let err = system_error(
                "ERR_STREAM_ALREADY_FINISHED",
                "Stream already used, please create a new one",
            );
            this.set_handler_error(err.to_error_instance(global));
            return;
        }

        // Root the stream on the pipe and mark the input body consumed, so a
        // second `transform()` / `.text()` on the same input throws "Body
        // already used" instead of quietly yielding an empty document.
        js_HTMLRewriterTransform::input_stream_set_cached(this.cell.get(), global, stream.value);
        *value = webcore::body::Value::Used;

        let sink_handle = SinkHandle::HTMLRewriter(this);

        // Native ByteStream/FileReader fast-path: wire the SinkHandle directly,
        // skipping the JS pump.
        match stream.wire_native_sink(global, sink_handle, this.cell.get(), |src| {
            this.input_source.set(src)
        }) {
            webcore::readable_stream::NativeWireResult::Wired => return,
            webcore::readable_stream::NativeWireResult::EndedInline(err) => {
                this.end_from_stream(err);
                return;
            }
            webcore::readable_stream::NativeWireResult::NotNative => {}
        }

        // JS-pump fallback: `assign_to_stream` installs a JS sink wrapper that
        // forwards to `JsSinkType for RewriterPipe`. The controller cell it
        // creates holds `pipe` raw as `m_sinkPtr` and dispatches
        // `__controllerDetached` from wherever it detaches (including its
        // GC destructor), so it owns a ref until `release_pump_ref`.
        this.pump_controller_attached.set(true);
        this.ref_();
        let assignment_result =
            JSSink::<RewriterPipe>::assign_to_stream(global, stream.value, pipe.into());
        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            this.end_from_stream(Some(StreamError::JSValue(jsc::strong::Optional::create(
                err, global,
            ))));
            return;
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    jsc::js_promise::Status::Pending => {
                        this.js_pump_reaction_pending.set(true);
                        assignment_result.then_with_value(
                            global,
                            this.cell.get(),
                            on_resolve_input_stream_shim,
                            on_reject_input_stream_shim,
                        );
                        return;
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        this.end_from_stream(None);
                        return;
                    }
                    jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global.vm());
                        let result = promise.result(global.vm());
                        this.end_from_stream(Some(StreamError::JSValue(
                            jsc::strong::Optional::create(result, global),
                        )));
                        return;
                    }
                }
            }
        }

        // undefined/null: the stream drained synchronously inside
        // assignToStream.
        this.end_from_stream(None);
    }

    /// `PendingValue::on_start_buffering` — `.text()`/`.json()`/`Bun.write`
    /// want the whole output: pull the rest of the input now, unbounded.
    fn on_start_buffering(ctx: NonNull<c_void>) {
        // Same liveness argument as `on_start_streaming`.
        let this = bun_ptr::BackRef::from(ctx.cast::<RewriterPipe>());
        this.buffered_consumer.set(true);
        this.resume();
    }

    /// Hold a ref on the pipe across an externally-entered call whose work
    /// (user handlers, body resolution) can drop the last GC path to the
    /// Transform cell and sweep it, releasing the cell's ref mid-call. If the
    /// pin ends up holding the last ref, the free is deferred past the
    /// caller's frame: a source delivering a chunk follows a `Done` answer
    /// from `write` with `end`, on the same sink snapshot.
    fn pin(&self) -> PipePin {
        self.ref_();
        PipePin(BackRef::new(self))
    }

    /// Nothing is draining the output, so nothing will signal `resume()`:
    /// continue the rewrite from the event loop instead, one upstream chunk
    /// per turn. The queued task holds a pipe ref and protects the cell, which
    /// roots the Response, both streams and the handlers until it runs — an
    /// unobserved rewrite is otherwise reachable from nothing.
    fn schedule_background_pull(&self) {
        self.background_pull_armed.set(true);
        if self.background_pull_queued.replace(true) {
            return;
        }
        let vm = self.global.bun_vm();
        if vm.is_shutting_down() {
            self.background_pull_queued.set(false);
            return;
        }
        let cell = self.cell.get();
        if cell.is_cell() {
            cell.protect();
        }
        self.ref_();
        vm.as_mut()
            .enqueue_task(bun_jsc::ManagedTask::ManagedTask::new(
                core::ptr::from_ref(self).cast_mut(),
                Self::run_background_pull,
            ));
    }

    fn run_background_pull(pipe: *mut RewriterPipe) -> bun_event_loop::JsResult<()> {
        // SAFETY: the task's ref (taken in `schedule_background_pull`) keeps
        // the allocation live until the `deref_nn` below.
        let this = BackRef::from(unsafe { NonNull::new_unchecked(pipe) });
        let cell = this.cell.get();
        this.background_pull_queued.set(false);
        if this.background_pull_armed.replace(false)
            && !this.done.get()
            && this.phase.get() != RewritePhase::Done
            && !this.driving.get()
            && !this.is_suspended()
            && !this.output_backpressured()
        {
            this.drain_pending_input(PullPacing::AlreadyYielded);
        }
        // The cell cannot have been swept while protected, so this balances
        // the `protect()` exactly.
        if cell.is_cell() {
            cell.unprotect();
        }
        Self::deref_nn(this.into());
        Ok(())
    }

    /// `PendingValue::on_start_streaming` — the output Response's body is
    /// being realised as a ByteStream: hand over everything lol-html has
    /// already emitted.
    fn on_start_streaming(ctx: NonNull<c_void>) -> DrainResult {
        // `ctx` is the `pipe` heap allocation registered on the PendingValue
        // in `init()`; the owning `JSHTMLRewriterTransform` cell (rooted by
        // the output Response's `transform` slot) keeps it live.
        let this = bun_ptr::BackRef::from(ctx.cast::<RewriterPipe>());
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

    /// `PendingValue::on_readable_stream_available` — the output ByteStream
    /// now exists: stash its backref so the output sink pushes
    /// there instead of buffering.
    fn on_readable_stream_available(
        ctx: NonNull<c_void>,
        global_this: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        let this = bun_ptr::BackRef::from(ctx.cast::<RewriterPipe>());
        if let Some(bytes) = readable.ptr.bytes() {
            // A reader rooting the output stream now roots the Transform cell
            // too, so the `producer` backref cannot outlive the pipe. Cleared
            // in `detach_output`.
            bytes.parent_const().set_owner(this.cell.get());
            this.output.set(Some(bytes));
        }
        js_HTMLRewriterTransform::output_stream_set_cached(
            this.cell.get(),
            global_this,
            readable.value,
        );
        // If the rewrite already completed before a reader attached, deliver
        // the terminal `Done` now so the first `read()` resolves.
        if this.phase.get() == RewritePhase::Done
            && !this.done.get()
            && js_HTMLRewriterTransform::handler_error_get_cached(this.cell.get())
                .is_none_or(|v| v.is_empty_or_undefined_or_null())
        {
            if let Some(out) = this.output.get() {
                out.on_data(StreamResult::Done);
            }
            this.detach_output();
        }
    }

    /// `SinkHandle::write` entry — input bytes arrived.
    pub fn write(&self, data: &StreamResult) -> Writable {
        let _pin = self.pin();
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        // A chunk that carries EOF is never answered with `Backpressure`: there
        // is no further input to hold back, and the source follows any other
        // answer with `end()`, which is what lets a document that arrived in
        // one piece finish inside `transform()`.
        let held = |len| {
            if data.is_done() {
                Writable::Owned(len)
            } else {
                Writable::Backpressure(len)
            }
        };
        if self.done.get() || self.phase.get() == RewritePhase::Done {
            return Writable::Done;
        }
        if self.driving.get()
            || self.is_suspended()
            || self.output_backpressured()
            || self.background_pull_armed.get()
        {
            self.pending_input.with_mut(|v| v.extend_from_slice(bytes));
            return held(len);
        }
        let fed = self.feed(bytes);
        // `feed` ran user JS; a handler may have cancelled the output reader
        // (`cancel_from_output`). Return `Done` so the native caller detaches
        // its sink snapshot, even if the handler also suspended.
        if self.done.get() || self.phase.get() == RewritePhase::Done {
            return Writable::Done;
        }
        if !fed {
            // `feed` returns false for both a handler suspension and a fatal
            // error. Only the latter should detach the upstream sink.
            if self.is_suspended() {
                return held(len);
            }
            return Writable::Done;
        }
        if data.is_done() {
            return Writable::Owned(len);
        }
        if self.is_suspended() || self.output_backpressured() {
            return Writable::Backpressure(len);
        }
        if self.should_yield() {
            self.schedule_background_pull();
            return Writable::Backpressure(len);
        }
        Writable::Owned(len)
    }

    /// `SinkHandle::end` entry — input EOF or terminal upstream error.
    pub fn end_from_stream(&self, err: Option<StreamError>) {
        let _pin = self.pin();
        // Detach via `detach_input_source` (not a bare `.set(None)`) so a
        // `JSController`'s `m_sinkPtr` is nulled before any path can free the
        // pipe; otherwise the controller's destructor would later dispatch
        // `__controllerDetached`/`__finalize` on freed memory. The upstream
        // already ended, so there is nothing to cancel.
        let src = self.detach_input_source(false);

        if self.js_pump_reaction_pending.get() {
            // The pump closes the sink before its promise settles; the `.then()`
            // reaction is the terminal step on this path.
            return;
        }

        if self.done.get() || self.phase.get() == RewritePhase::Done {
        } else if let Some(err) = err {
            let value_error = match err {
                StreamError::JSValue(v) => webcore::body::ValueError::JSValue(v),
                StreamError::Error(e) => {
                    webcore::body::ValueError::SystemError(e.to_system_error().into())
                }
                StreamError::AbortReason(r) => webcore::body::ValueError::AbortReason(r),
            };
            self.fail(value_error);
        } else if self.driving.get() || self.is_suspended() || !self.pending_input.get().is_empty()
        {
            self.input_ended.set(true);
        } else {
            self.end_rewrite();
        }
        self.release_input_roots(src);
    }

    /// `SourceHandle::on_ready` entry — the output ByteStream drained.
    pub fn resume(&self) {
        if self.done.get()
            || self.phase.get() == RewritePhase::Done
            || self.driving.get()
            || self.is_suspended()
            || self.output_backpressured()
        {
            return;
        }
        let _pin = self.pin();
        self.drain_pending_input(PullPacing::YieldIfUnobserved);
    }

    /// `SourceHandle::on_close` entry — the output reader cancelled.
    pub fn cancel_from_output(&self, _err: Option<SysError>) {
        let _pin = self.pin();
        self.detach_output();
        let src = self.detach_input_source(true);
        self.phase.set(RewritePhase::Done);
        self.done.set(true);
        self.pending.with_mut(|p| {
            p.result = Writable::Done;
            p.run();
        });
        self.release_input_roots(src);
    }

    /// Run one lol-html `write`/`end_mut`/`resume` call under the
    /// [`ActiveSinkGuard`] and `driving` flag. Re-entrant `SinkHandle`/
    /// `SourceHandle` calls into this pipe check `driving` and defer, so the
    /// `with_mut` borrow on `rewriter` is never aliased. Returns `None` when
    /// the rewriter is unset.
    fn drive_rewriter<R>(&self, f: impl FnOnce(&mut LolRewriter) -> R) -> Option<R> {
        if self.rewriter.get().is_none() {
            return None;
        }
        let _active = ActiveSinkGuard::enter(self);
        self.driving.set(true);
        let res = self.rewriter.with_mut(|r| r.as_deref_mut().map(f));
        // Hand this call's output to the stream as one chunk: lol-html emits a
        // fragment per token piece, and each `on_data` may be a socket write
        // or a downstream rewriter's `write`. Still under `driving`, so the
        // stream's re-entrant drain signal defers as it did per fragment.
        self.flush_output();
        self.driving.set(false);
        res
    }

    fn flush_output(&self) {
        let Some(out) = self.output.get() else {
            return;
        };
        if self.output_buffer.get().is_empty() {
            return;
        }
        out.on_data(StreamResult::Owned(self.output_buffer.replace(Vec::new())));
    }

    /// Feed `bytes` through lol-html once. Returns `true` if the write
    /// completed (`Ok` — possibly buffering output), `false` if the rewrite
    /// failed or suspended.
    fn feed(&self, bytes: &[u8]) -> bool {
        match self.drive_rewriter(|r| r.write(bytes)) {
            None => false,
            Some(Ok(())) => true,
            Some(Err(e)) => {
                self.on_rewriting_error(&e);
                false
            }
        }
    }

    /// `write` completed (no more input owed): run `end()`. Installs its own
    /// [`ActiveSinkGuard`].
    fn end_rewrite(&self) {
        self.phase.set(RewritePhase::EndPending);
        // `end_mut` (unlike the consuming `end`) keeps the rewriter alive: a
        // document-end handler can suspend it, and `Drop` is what frees it.
        match self.drive_rewriter(|r| r.end_mut()) {
            None => self.phase.set(RewritePhase::Done),
            Some(Err(e)) => self.on_rewriting_error(&e),
            Some(Ok(())) => self.finish(),
        }
    }

    fn finish(&self) {
        self.phase.set(RewritePhase::Done);
        // The rewrite completed: free the boxed lol-html state machine now
        // instead of at cell collection, so a long-lived output Response does
        // not retain the parser arena. Safe here: every driver null-checks
        // `rewriter` or gates on `phase == Done` first, and no wrapper is
        // parked in the rewriter (a suspension is resolved before `finish`
        // is reachable). Error/cancel paths leave it for `Drop` — a wrapper
        // retargeted at a heap-parked unit may still be attached there.
        debug_assert!(!self.is_suspended());
        self.rewriter.set(None);
        if let Some(out) = self.output.get() {
            out.on_data(StreamResult::Done);
            self.detach_output();
            return;
        }
        // No stream attached yet: resolve the output body with the buffered
        // output so `.text()`/`Bun.serve` sees the final bytes.
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
        let _ = webcore::body::Value::resolve(&mut prev_value, body_value, &self.global, headers);
    }

    /// Feed the accumulated `pending_input` once unblocked, then maybe end,
    /// then signal the upstream source to resume.
    fn drain_pending_input(&self, pacing: PullPacing) {
        let pending = self.pending_input.replace(Vec::new());
        if !pending.is_empty() && !self.feed(&pending) {
            return;
        }
        // `feed` ran user JS; re-check the terminal state before `end_rewrite`
        // would overwrite `phase = Done` set by `cancel_from_output`/`fail`.
        if self.done.get() || self.phase.get() == RewritePhase::Done {
            return;
        }
        if self.is_suspended() {
            return;
        }
        // Output backpressure only gates pulling more input; once the input
        // is exhausted, finishing frees the parser and settles the body.
        if self.input_ended.get() {
            self.end_rewrite();
            return;
        }
        if self.output_backpressured() {
            return;
        }
        if pacing == PullPacing::YieldIfUnobserved && self.should_yield() {
            self.schedule_background_pull();
            return;
        }
        // Pulling now; a queued background pull has nothing left to do.
        self.background_pull_armed.set(false);
        // `ready()` may re-enter and write `input_source` (sink → feed →
        // fail/end_from_stream), so copy the handle out instead of holding a
        // `with_mut` borrow across the call.
        let mut src = self.input_source.get();
        src.ready(None, None);
        // Wake a JS pump's pending `write()`/`flush(true)` promise.
        self.pending.with_mut(|p| p.run());
    }

    /// A content handler's promise resolved: continue the rewrite from
    /// wherever lol-html parked it, then drain any `pending_input` that
    /// arrived while suspended.
    fn resume_rewrite(&self) {
        if self.phase.get() == RewritePhase::Done {
            // Output reader cancelled (or the rewrite failed) while suspended.
            return;
        }
        if let Some(Err(e)) = self.drive_rewriter(|r| r.resume()) {
            return self.on_rewriting_error(&e);
        }
        match self.phase.get() {
            RewritePhase::WritePending => self.drain_pending_input(PullPacing::YieldIfUnobserved),
            RewritePhase::EndPending => self.finish(),
            RewritePhase::Done => {}
        }
    }

    /// A lol-html call returned an error: either the (non-fatal) handler
    /// suspension escape, or a real failure to surface.
    fn on_rewriting_error(&self, e: &lol_html::errors::RewritingError) {
        if matches!(e, lol_html::errors::RewritingError::Suspended) {
            return self.begin_suspension();
        }
        let leftover = self.pending_suspension.take();
        debug_assert!(
            leftover.is_none(),
            "lol-html returned a non-suspension error with a suspension armed"
        );
        drop(leftover);

        self.phase.set(RewritePhase::Done);
        let captured = self.take_handler_error();

        if self.sync_only_noun.get().is_some() {
            // `init()` is still on the stack; make `transform()` throw.
            return self.set_handler_error(
                captured.unwrap_or_else(|| create_lolhtml_error(&self.global, e)),
            );
        }

        let value_error = match captured {
            Some(js_err) => {
                js_err.ensure_still_alive();
                webcore::body::ValueError::JSValue(jsc::strong::Optional::create(
                    js_err,
                    &self.global,
                ))
            }
            None => webcore::body::ValueError::Message(lol_err_string(e)),
        };
        self.fail(value_error);
    }

    fn begin_suspension(&self) {
        let wrapper = self
            .pending_suspension
            .take()
            .expect("lol-html suspended without a pending HTMLRewriter handler promise");

        self.rewriter.with_mut(|r| {
            if let Some(r) = r.as_deref_mut() {
                wrapper.retarget(r);
            }
        });
        self.suspended_wrapper.set(Some(wrapper));

        // The `.then()` context is a `NativePromiseContext` holding the
        // Transform cell: while the promise can settle, the reaction roots
        // the context, the context roots the cell, and the cell keeps `pipe`
        // alive. If the promise is collected without settling, the context's
        // destructor queues `abandon_suspension` — independent of whether
        // anything else still reaches the cell — so a rewrite parked on a
        // dead promise always fails its body instead of leaking.
        let cell = self.cell.get();
        let promise = js_HTMLRewriterTransform::suspension_promise_get_cached(cell)
            .expect("suspension promise slot empty");
        let pipe = core::ptr::from_ref(self).cast_mut();
        let context = native_promise_context::create(&self.global, pipe, cell);
        // The context destructor (promise GC'd unsettled) queues
        // `abandon_suspension` (`DeferredDerefTask::schedule` runs it inline
        // once the VM's task queue has closed); this ref keeps the pipe alive
        // until that or the settle reaction releases it.
        self.ref_();
        promise.then_with_value(
            &self.global,
            context,
            Bun__HTMLRewriter__onHandlerResolve,
            Bun__HTMLRewriter__onHandlerReject,
        );
        // The slot only roots the promise across the lol-html unwind; once the
        // reaction is wired the promise must be independently collectible so
        // the NativePromiseContext destructor can fire `abandon_suspension`.
        js_HTMLRewriterTransform::suspension_promise_set_cached(
            cell,
            &self.global,
            JSValue::UNDEFINED,
        );
    }

    /// The suspension begun by `begin_suspension` is over: the settle reaction or the abandonment
    /// (whichever holds the promise context) releases the parked wrapper and then owns the ref.
    fn end_suspension(&self) {
        self.suspended_wrapper.set(None);
    }

    /// Put `err` on the output `Response`'s body / ByteStream.
    fn fail(&self, err: webcore::body::ValueError) {
        let _pin = self.pin();
        self.phase.set(RewritePhase::Done);
        self.done.set(true);
        let src = self.detach_input_source(true);
        // Settle any `flush(true)`/`write()` promise a direct-stream `pull()`
        // is parked on so the pump promise can settle (mirrors
        // `cancel_from_output`).
        self.pending.with_mut(|p| {
            p.result = Writable::Done;
            p.run();
        });

        if let Some(out) = self.output.get() {
            // Output emitted before the failure still precedes the error.
            self.flush_output();
            let mut err = err;
            out.on_data(StreamResult::Err(err.to_stream_error(&self.global)));
            self.detach_output();
        } else if let Some(response) = self.response.get().as_deref() {
            let body_value = response.get_body_value();
            let has_readable = match body_value {
                webcore::body::Value::Locked(l) => l.readable.has(),
                _ => false,
            };
            if !has_readable
                && matches!(body_value, webcore::body::Value::Locked(l)
                    if l.promise.is_none() && l.on_receive_value.is_none())
            {
                *body_value = webcore::body::Value::Empty;
            }
            let _ = body_value.to_error_instance(err, &self.global);
        }
        self.release_input_roots(src);
    }
}

/// Guard returned by [`RewriterPipe::pin`].
#[must_use = "dropping immediately releases the ref"]
struct PipePin(BackRef<RewriterPipe>);

impl Drop for PipePin {
    fn drop(&mut self) {
        self.0.deref_outside_caller();
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PullPacing {
    /// Entered from a reader's drain signal or a settled handler: if nobody is
    /// reading and the output is already a high-water mark ahead, defer the
    /// pull to the event loop.
    YieldIfUnobserved,
    /// Entered from that deferred task: this is the next turn, pull now.
    AlreadyYielded,
}

impl Drop for RewriterPipe {
    fn drop(&mut self) {
        // A pipe cancelled or failed while suspended keeps its parked wrapper
        // until the handler promise settles; if that promise is collected
        // instead, this is the wrapper's last owner. Releasing it here (it
        // only nulls the wrapper's unit Cell and drops its Box, no GC access)
        // detaches any JS-retained Element/TextChunk before the rewriter it
        // points into is destroyed below.
        self.suspended_wrapper.set(None);
        self.response.set(None);
    }
}

// ───────────────── RewriterPipe: JsSinkType (JS-pump fallback) ───────────

crate::impl_js_sink_abi!(RewriterPipe, "HTMLRewriterSink");

impl crate::webcore::sink::JsSinkType for RewriterPipe {
    const NAME: &'static str = "HTMLRewriterSink";
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<StartTag> = Some(StartTag::HTMLRewriterSink);

    fn memory_cost(&self) -> usize {
        self.pending_input.get().capacity() + self.output_buffer.get().capacity()
    }
    // Unlike other sinks, the controller does not own the pipe: its ref is
    // released by `controller_detached` below, and the free happens wherever
    // the last ref drops.
    unsafe fn finalize(_this: *mut Self) {}
    fn controller_detached(&mut self) {
        RewriterPipe::release_pump_ref(self);
    }
    fn write_bytes(&mut self, data: &StreamResult) -> Writable {
        RewriterPipe::write(self, data)
    }
    fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        let mut buf = Vec::new();
        let _ = buf.write_utf16(data.slice16());
        RewriterPipe::write(self, &StreamResult::Temporary(RawSlice::new(&buf)))
    }
    fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        let bytes = data.slice();
        if bun_core::strings::is_all_ascii(bytes) {
            return RewriterPipe::write(self, data);
        }
        let mut buf = Vec::new();
        let _ = buf.write_latin1(bytes);
        RewriterPipe::write(self, &StreamResult::Temporary(RawSlice::new(&buf)))
    }
    fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        self.end_from_stream(err.map(StreamError::Error));
        bun_sys::Result::Ok(())
    }
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
    fn end_from_js(&mut self, _global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        self.end_from_stream(None);
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }
    fn flush(&mut self) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }
    fn flush_from_js(&mut self, global: &JSGlobalObject, wait: bool) -> bun_sys::Result<JSValue> {
        use streams::PendingState;
        if self.pending.get().state == PendingState::Pending {
            let prom = self.pending.with_mut(|p| p.promise(global));
            let prom_js = JSPromise::opaque_ref(prom).to_js();
            js_HTMLRewriterTransform::pending_promise_set_cached(self.cell.get(), global, prom_js);
            return bun_sys::Result::Ok(prom_js);
        }
        if self.done.get() || self.phase.get() == RewritePhase::Done {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global,
                JSValue::js_number(0.0),
            ));
        }
        if wait
            && (self.driving.get()
                || self.is_suspended()
                || self.output_backpressured()
                || self.background_pull_armed.get())
        {
            let prom = self.pending.with_mut(|p| {
                p.result = Writable::Owned(0);
                p.promise(global)
            });
            let prom_js = JSPromise::opaque_ref(prom).to_js();
            js_HTMLRewriterTransform::pending_promise_set_cached(self.cell.get(), global, prom_js);
            return bun_sys::Result::Ok(prom_js);
        }
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            global,
            JSValue::js_number(0.0),
        ))
    }
    fn start(&mut self, _config: Start) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }
    fn source(&mut self) -> Option<&mut SourceHandle> {
        Some(self.input_source.get_mut())
    }
}

// ───────── .then() reactions for a content handler's promise ─────────────

bun_jsc::jsc_promise_handler!(
    pub fn Bun__HTMLRewriter__onHandlerResolve => on_handler_resolve
);
bun_jsc::jsc_promise_handler!(
    pub fn Bun__HTMLRewriter__onHandlerReject => on_handler_reject
);

fn on_handler_resolve(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    // `take` nulls the context so its destructor is a no-op; `None` means the
    // suspension was already abandoned.
    let Some(pipe) = native_promise_context::take::<RewriterPipe>(args[args.len() - 1]) else {
        return Ok(JSValue::UNDEFINED);
    };
    let pipe = BackRef::from(pipe);
    pipe.end_suspension();
    // Runs the rest of the transform: more handlers (script), sink writes, stream delivery.
    pipe.resume_rewrite();
    // Balances the `ref_()` in `begin_suspension`.
    RewriterPipe::deref_nn(pipe.into());
    // Handler errors are captured into the stream by the pipe; what can still be pending here is
    // what cannot be captured — a termination — and this reaction reports it rather than a value.
    if global.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    Ok(JSValue::UNDEFINED)
}

fn on_handler_reject(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let reason = args[0];
    let Some(pipe) = native_promise_context::take::<RewriterPipe>(args[args.len() - 1]) else {
        return Ok(JSValue::UNDEFINED);
    };
    let pipe = BackRef::from(pipe);
    pipe.end_suspension();
    // Fails the output stream: delivers the error to its reader (script may run).
    pipe.fail(webcore::body::ValueError::JSValue(
        jsc::strong::Optional::create(reason, global),
    ));
    // Balances the `ref_()` in `begin_suspension`.
    RewriterPipe::deref_nn(pipe.into());
    if global.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    Ok(JSValue::UNDEFINED)
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
    pub(crate) fn on_doc_type(this: NonNull<Self>, value: *mut RawDoctype) -> HandlerOutcome {
        handler_callback::<Self, DocType, RawDoctype>(this, value, |h| {
            h.on_doc_type_callback.as_ref().map(ProtectedJSValue::value)
        })
    }
    pub(crate) fn on_comment(this: NonNull<Self>, value: *mut RawComment) -> HandlerOutcome {
        handler_callback::<Self, Comment, RawComment>(this, value, |h| {
            h.on_comment_callback.as_ref().map(ProtectedJSValue::value)
        })
    }
    pub(crate) fn on_text(this: NonNull<Self>, value: *mut RawTextChunk) -> HandlerOutcome {
        handler_callback::<Self, TextChunk, RawTextChunk>(this, value, |h| {
            h.on_text_callback.as_ref().map(ProtectedJSValue::value)
        })
    }
    pub(crate) fn on_end(this: NonNull<Self>, value: *mut RawDocumentEnd) -> HandlerOutcome {
        handler_callback::<Self, DocEnd, RawDocumentEnd>(this, value, |h| {
            h.on_end_callback.as_ref().map(ProtectedJSValue::value)
        })
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
trait HandlerLike {
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

/// Trait abstracting the wrapper-type bits [`handler_callback`] and the
/// suspension plumbing need.
trait WrapperLike: bun_ptr::AnyRefCounted + Sized {
    type Raw;
    fn init(value: *mut Self::Raw) -> NonNull<Self>;
    /// `jsc.Codegen.JS${T}.toJS` — wraps the *existing* heap allocation `this`
    /// in a JS wrapper (the codegen `${T}__create`). Takes `NonNull<Self>` (not
    /// `&self`) because the C++ side stores the raw heap pointer in `m_ctx`;
    /// deriving it from a `&self` would launder shared-borrow provenance into
    /// the GC's exclusive-owner pointer.
    fn to_js(this: NonNull<Self>, global: &JSGlobalObject) -> JSValue;
    /// Null out the wrapper's lol-html pointer and detach any sub-objects it
    /// handed to JS (Element's AttributeIterators). Every host-fn on the
    /// wrapper is a harmless no-op afterwards.
    fn detach(&self);
    /// Re-point the wrapper at a different lol-html unit: the heap copy
    /// lol-html parks when one of the unit's handlers suspends on it.
    fn retarget(&self, raw: *mut Self::Raw);
    /// The lol-html unit of this type the rewriter is suspended on, as the
    /// lifetime-erased raw pointer the wrapper stores. Null if the rewriter
    /// is not suspended on a `Self::Raw`.
    fn suspended_raw(rewriter: &mut LolRewriter) -> *mut Self::Raw;
    /// Wrap a ref as the matching [`SuspendedWrapper`] variant.
    fn into_suspended(wrapper: RefPtr<Self>) -> SuspendedWrapper;
}

/// Forwarding `WrapperLike` impl — every wrapper type's trait impl is a pure
/// pass-through to inherent / `JsClass`-codegen methods. `$field` is the
/// wrapper's `DetachablePtr<$raw>`; `$suspended` is the `lol_html::HtmlRewriter`
/// accessor for the parked unit of that type.
/// `Element` implements the trait by hand: its `detach` also has to
/// invalidate the `AttributeIterator`s it handed out.
macro_rules! impl_wrapper_like {
    ($ty:ident, $raw:ty, $field:ident, $suspended:ident) => {
        impl WrapperLike for $ty {
            type Raw = $raw;
            fn init(v: *mut Self::Raw) -> NonNull<Self> {
                Self::init(v)
            }
            fn to_js(this: NonNull<Self>, g: &JSGlobalObject) -> JSValue {
                Self::to_js_nonnull(this, g)
            }
            fn detach(&self) {
                self.$field.detach();
            }
            fn retarget(&self, raw: *mut Self::Raw) {
                self.$field.set(raw);
            }
            fn suspended_raw(rewriter: &mut LolRewriter) -> *mut Self::Raw {
                rewriter.$suspended().map_or(core::ptr::null_mut(), |unit| {
                    core::ptr::from_mut(unit).cast()
                })
            }
            fn into_suspended(wrapper: RefPtr<Self>) -> SuspendedWrapper {
                SuspendedWrapper::$ty(wrapper)
            }
        }
    };
}

/// The value an `Exception` cell wraps. Handing the cell itself to
/// `JSPromise::reject` asserts, and a `Locked` body can now reject with any
/// handler error, so unwrap at the point of capture. `to_error` falls back to
/// the cell for a non-`Exception` (it cannot happen here).
fn exception_value(exc: NonNull<jsc::Exception>) -> JSValue {
    let cell = JSValue::from_cell(exc.as_ptr());
    cell.to_error().unwrap_or(cell)
}

/// Record a content handler's exception / rejection on the sink whose lol-html
/// call is on the stack, so `transform()` (sync) or the output body (async)
/// surfaces it instead of lol-html's generic "stopped" message.
///
/// Takes the sink explicitly rather than re-deriving it from `global`: a caller
/// that has already established there is none would otherwise silently drop the
/// error.
fn record_handler_error(sink: &RewriterPipe, err: JSValue) {
    err.ensure_still_alive();
    sink.set_handler_error(err);
}

fn handler_callback<H, Z, L>(
    this: NonNull<H>,
    value: *mut L,
    get_callback: impl FnOnce(&H) -> Option<JSValue>,
) -> HandlerOutcome
where
    H: HandlerLike,
    Z: WrapperLike<Raw = L>,
{
    jsc::mark_binding();

    let wrapper: NonNull<Z> = Z::init(value);

    // Our ref across the handler call; the guard detaches then drops it. On
    // the SUSPEND path the guard is disarmed and `SuspendedWrapper`'s drop
    // does the same once the handler's promise settles instead.
    // SAFETY: `wrapper` is the live allocation `init` just made.
    let guard = scopeguard::guard(unsafe { RefPtr::init_ref(wrapper.as_ptr()) }, |w| {
        w.detach()
    });

    // `this` is the Box<ElementHandler>/Box<DocumentHandler> userdata pointer we
    // registered with lol-html; it lives in LOLHTMLContext for the duration of
    // the rewriter. `&` (not `&mut`) — `cb.call()` below re-enters JS, which
    // may re-enter another `handler_callback` on the same handler (R-2);
    // aliased `&H` is sound, aliased `&mut H` is not.
    let this = BackRef::from(this);
    let global = this.global();

    // Content handlers only ever run from inside a pipe's lol-html call, which
    // installs the guard. Read it once here so every error path below has a
    // sink to record onto.
    let Some(sink) = active_sink(global) else {
        debug_assert!(false, "HTMLRewriter handler ran outside a rewrite");
        return HandlerOutcome::Stop;
    };

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

    let cb = get_callback(&this).expect("callback must be set if handler registered");
    let result = match cb.call(global, this.this_object(), &[Z::to_js(wrapper, global)]) {
        Ok(v) => v,
        Err(_) => {
            // A termination (a worker's stop, an enclosing vm run's timeout) is not this handler's
            // error: it stays pending to unwind whatever drives the rewriter.
            if let Some(exc) = scope.exception()
                && !JSValue::from_cell(exc.as_ptr()).is_termination_exception()
            {
                record_handler_error(&sink, exception_value(exc));
            }
            scope.clear_exception_except_termination();
            return HandlerOutcome::Stop;
        }
    };

    if let Some(exc) = scope.exception() {
        if !JSValue::from_cell(exc.as_ptr()).is_termination_exception() {
            record_handler_error(&sink, exception_value(exc));
        }
        scope.clear_exception_except_termination();
        return HandlerOutcome::Stop;
    }

    if result.is_undefined_or_null() {
        return HandlerOutcome::Continue;
    }

    // Note: `is_error() || is_aggregate_error(global)` —
    // NOT `isAnyError`, which has different
    // coverage (Exception cells / `Symbol.error` vs cross-realm
    // AggregateError).
    if result.is_error() || result.is_aggregate_error(global) {
        record_handler_error(&sink, result);
        return HandlerOutcome::Stop;
    }

    let Some(promise) = result.as_any_promise() else {
        return HandlerOutcome::Continue;
    };

    // An `async` handler's promise settles through a microtask checkpoint even
    // when its body never truly awaits; run ONE checkpoint before deciding. A
    // promise still pending afterwards is waiting on I/O or a timer and must
    // suspend the rewrite instead of nesting the whole event loop inside
    // lol-html's `write()`.
    if promise.status() == jsc::js_promise::Status::Pending {
        if global.drain_microtasks_and_next_ticks().is_err()
            || !global.clear_exception_except_termination()
        {
            return HandlerOutcome::Stop;
        }
    }

    match promise.status() {
        jsc::js_promise::Status::Fulfilled => HandlerOutcome::Continue,
        jsc::js_promise::Status::Rejected => {
            promise.set_handled(global.vm());
            record_handler_error(&sink, promise.result(global.vm()));
            HandlerOutcome::Stop
        }
        jsc::js_promise::Status::Pending => {
            // `transform(string)` / `transform(ArrayBuffer)` must hand back the
            // result before `transform()` returns.
            if let Some(noun) = sink.sync_only_noun.get() {
                let err = global.create_type_error_instance(format_args!(
                    "HTMLRewriter.transform() cannot synchronously return {noun} because a \
                     content handler returned a Promise that did not resolve within a microtask. \
                     Pass a Response instead and await its body"
                ));
                record_handler_error(&sink, err);
                return HandlerOutcome::Stop;
            }

            // Hand the wrapper to the suspension: it has to stay valid across
            // the handler's `await`, so disarm the guard here.
            let wrapper = scopeguard::ScopeGuard::into_inner(guard);
            js_HTMLRewriterTransform::suspension_promise_set_cached(
                sink.cell.get(),
                global,
                result,
            );
            sink.pending_suspension
                .set(Some(Z::into_suspended(wrapper)));
            HandlerOutcome::Suspend
        }
    }
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

    pub(crate) fn on_element(this: NonNull<Self>, value: *mut RawElement) -> HandlerOutcome {
        handler_callback::<Self, Element, RawElement>(this, value, |h| {
            h.on_element_callback.as_ref().map(ProtectedJSValue::value)
        })
    }

    pub(crate) fn on_comment(this: NonNull<Self>, value: *mut RawComment) -> HandlerOutcome {
        handler_callback::<Self, Comment, RawComment>(this, value, |h| {
            h.on_comment_callback.as_ref().map(ProtectedJSValue::value)
        })
    }

    pub(crate) fn on_text(this: NonNull<Self>, value: *mut RawTextChunk) -> HandlerOutcome {
        handler_callback::<Self, TextChunk, RawTextChunk>(this, value, |h| {
            h.on_text_callback.as_ref().map(ProtectedJSValue::value)
        })
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
    // The handler's own exception / rejection, if any, is recorded on the
    // active `RewriterPipe` (`record_handler_error`) and `on_rewriting_error`
    // prefers it over the generic message, so only lol-html-internal
    // parse/encoding errors reach here.
    let value = global.create_error_instance(format_args!("{message}"));
    value.put(
        global,
        b"name",
        EncodedSlice::latin1(b"HTMLRewriterError").to_js(global),
    );
    value
}

/// lol-html error `Display` text → owned `bun.String`.
fn lol_err_string(e: impl core::fmt::Display) -> BunString {
    BunString::clone_utf8(e.to_string().as_bytes())
}

/// UTF-8-validate bytes headed for a lol-html `&str` API. On failure throws
/// an `HTMLRewriterError` carrying the `Utf8Error` `Display` text — the same
/// text lol-html's C API `to_str!` used to stash in its last-error slot.
fn utf8_or_throw<'a>(global: &JSGlobalObject, bytes: &'a [u8]) -> JsResult<&'a str> {
    core::str::from_utf8(bytes).map_err(|e| global.throw_value(create_lolhtml_error(global, &e)))
}

/// Decode a raw-`JSValue` setter argument to owned UTF-8. `to_utf8` runs
/// ToString (user `toString()`/`[Symbol.toPrimitive]`), so callers MUST do
/// this BEFORE `DetachablePtr::get_mut`: the re-entered JS would alias its
/// exclusive `&mut`.
fn setter_utf8_arg(global: &JSGlobalObject, value: JSValue) -> JsResult<String> {
    let slice = value.to_utf8(global)?;
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
    pub(crate) text_chunk: DetachablePtr<RawTextChunk>,
}

impl TextChunk {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(text_chunk: *mut RawTextChunk) -> NonNull<TextChunk> {
        bun_core::heap::alloc_nn(TextChunk {
            ref_count: Cell::new(1),
            text_chunk: DetachablePtr::new(text_chunk),
        })
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
        let Some(chunk) = self.text_chunk.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        chunk.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_text(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(chunk) = self.text_chunk.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(chunk.as_str(), global)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match self.text_chunk.get_mut() {
            Some(chunk) => JSValue::from(chunk.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn last_in_text_node(&self, _global: &JSGlobalObject) -> JSValue {
        match self.text_chunk.get_mut() {
            Some(chunk) => JSValue::from(chunk.last_in_text_node()),
            None => JSValue::UNDEFINED,
        }
    }
}

impl_wrapper_like!(TextChunk, RawTextChunk, text_chunk, suspended_text_chunk);

// ──────────────────────────── DocType ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct DocType {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) doctype: DetachablePtr<RawDoctype>,
}

impl DocType {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(doctype: *mut RawDoctype) -> NonNull<DocType> {
        bun_core::heap::alloc_nn(DocType {
            ref_count: Cell::new(1),
            doctype: DetachablePtr::new(doctype),
        })
    }

    /// The doctype name.
    #[bun_jsc::host_fn(getter)]
    pub fn name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = self.doctype.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.name(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn system_id(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = self.doctype.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        opt_string_to_js_or_null(dt.system_id(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn public_id(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(dt) = self.doctype.get_mut() else {
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
        let Some(dt) = self.doctype.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        dt.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match self.doctype.get_mut() {
            Some(dt) => JSValue::from(dt.removed()),
            None => JSValue::UNDEFINED,
        }
    }
}

impl_wrapper_like!(DocType, RawDoctype, doctype, suspended_doctype);

// ──────────────────────────── DocEnd ─────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct DocEnd {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) doc_end: DetachablePtr<RawDocumentEnd>,
}

impl DocEnd {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(doc_end: *mut RawDocumentEnd) -> NonNull<DocEnd> {
        bun_core::heap::alloc_nn(DocEnd {
            ref_count: Cell::new(1),
            doc_end: DetachablePtr::new(doc_end),
        })
    }

    lol_content_ops! { RawDocumentEnd, doc_end, JSValue::NULL;
        append / append_,
    }
}

impl_wrapper_like!(DocEnd, RawDocumentEnd, doc_end, suspended_document_end);

// ──────────────────────────── Comment ────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct Comment {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) comment: DetachablePtr<RawComment>,
}

impl Comment {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(comment: *mut RawComment) -> NonNull<Comment> {
        bun_core::heap::alloc_nn(Comment {
            ref_count: Cell::new(1),
            comment: DetachablePtr::new(comment),
        })
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
        let Some(comment) = self.comment.get_mut() else {
            return Ok(JSValue::NULL);
        };
        comment.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_text(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(comment) = self.comment.get_mut() else {
            return Ok(JSValue::NULL);
        };
        string_to_js(&comment.text(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `CommentPrototype__setText` via `host_setter_result` (which wants
    // `JsResult<()>`); the proc-macro shim would emit a second, conflicting
    // `JsResult<bool>` wrapper.
    pub(crate) fn set_text(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if self.comment.is_detached() {
            return Ok(());
        }
        let text = setter_utf8_arg(global, value)?;
        let Some(comment) = self.comment.get_mut() else {
            return Ok(());
        };
        if let Err(e) = comment.set_text(&text) {
            return Err(global.throw_value(create_lolhtml_error(global, &e)));
        }
        Ok(())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn removed(&self, _global: &JSGlobalObject) -> JSValue {
        match self.comment.get_mut() {
            Some(comment) => JSValue::from(comment.removed()),
            None => JSValue::UNDEFINED,
        }
    }
}

impl_wrapper_like!(Comment, RawComment, comment, suspended_comment);

// ──────────────────────────── EndTag ─────────────────────────────────────

#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct EndTag {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) end_tag: DetachablePtr<RawEndTag>,
}

struct EndTagHandler {
    // GC-rooted via `ProtectedJSValue` (RAII protect/unprotect), matching
    // `DocumentHandler`/`ElementHandler` — self-unprotects on drop.
    pub callback: Option<ProtectedJSValue>,
    pub global: GlobalRef, // JSC_BORROW
}

impl EndTagHandler {
    pub(crate) fn on_end_tag(this: NonNull<Self>, value: *mut RawEndTag) -> HandlerOutcome {
        handler_callback::<Self, EndTag, RawEndTag>(this, value, |h| {
            h.callback.as_ref().map(ProtectedJSValue::value)
        })
    }
}

impl EndTag {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(end_tag: *mut RawEndTag) -> NonNull<EndTag> {
        bun_core::heap::alloc_nn(EndTag {
            ref_count: Cell::new(1),
            end_tag: DetachablePtr::new(end_tag),
        })
    }

    lol_content_ops! { RawEndTag, end_tag, JSValue::NULL;
        before / before_,
        after / after_,
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn remove(
        &self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(end_tag) = self.end_tag.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        end_tag.remove();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(end_tag) = self.end_tag.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&end_tag.name(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `EndTagPrototype__setName` via `host_setter_result`.
    pub(crate) fn set_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if self.end_tag.is_detached() {
            return Ok(());
        }
        let name = setter_utf8_arg(global, value)?;
        let Some(end_tag) = self.end_tag.get_mut() else {
            return Ok(());
        };
        end_tag.set_name_str(name);
        Ok(())
    }
}

impl_wrapper_like!(EndTag, RawEndTag, end_tag, suspended_end_tag);

// ───────────────────────── AttributeIterator ─────────────────────────────

/// The JS `AttributeIterator` heap-boxes one of these over `Element::attributes`
#[bun_jsc::JsClass(no_construct, no_finalize, no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct AttributeIterator {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    /// Non-owning backref to the `Element` wrapper that handed this iterator
    /// out. Reading the attributes through it (rather than caching a
    /// `slice::Iter` into the attribute buffer) means a suspension, which
    /// re-points the element at lol-html's heap-parked copy, re-points this
    /// iterator too. The element keeps a `+1` on us and nulls this in
    /// `detach()`, so it never dangles. R-2: `Cell` so host-fns take `&self`.
    element: Cell<Option<BackRef<Element>>>,
    /// Index of the next attribute to yield.
    index: Cell<usize>,
}

impl AttributeIterator {
    /// Drop the backref. The element owns our `+1` and clears it here, so the
    /// raw pointer is never read after the element stops tracking us.
    fn detach(&self) {
        self.element.set(None);
    }

    pub fn finalize(&self) {
        self.detach();
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn next(
        &self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let done_label = bun_core::EncodedSlice::latin1(b"done");
        let value_label = bun_core::EncodedSlice::latin1(b"value");

        // Detached (the handler returned, or an attribute was mutated), the
        // element itself is gone, or we ran off the end of the buffer.
        let attribute = self
            .element
            .get()
            .and_then(|el| el.element.get_mut())
            .and_then(|raw| raw.attributes().get(self.index.get()));
        let Some(attribute) = attribute else {
            self.detach();
            return JSValue::create_object2(
                global_object,
                &done_label,
                &value_label,
                JSValue::TRUE,
                JSValue::UNDEFINED,
            );
        };
        self.index.set(self.index.get() + 1);

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
pub struct Element {
    // Intrusive RefCount; *Self is the JS wrapper m_ctx.
    ref_count: Cell<u32>,
    // R-2: `Cell` so host-fns take `&self` (re-entry-safe).
    pub(crate) element: DetachablePtr<RawElement>,
    /// AttributeIterator instances handed out by `getAttributes()`. Each holds
    /// a non-owning backref to this `Element` plus a `+1` we own; `invalidate()`
    /// nulls those backrefs when the handler returns, so none can outlive us.
    /// R-2: `JsCell` (non-Copy `Vec`) — pushed/drained from `&self` host-fns
    /// (`get_attributes`, `set_attribute`, `remove_attribute`). The `with_mut`
    /// closures do not call into JS, so the short `&mut Vec` borrow cannot
    /// overlap a re-entrant access.
    pub(crate) attribute_iterators: JsCell<Vec<RefPtr<AttributeIterator>>>,
}

impl Drop for Element {
    fn drop(&mut self) {
        self.invalidate();
    }
}

impl Element {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    pub(crate) fn init(element: *mut RawElement) -> NonNull<Element> {
        bun_core::heap::alloc_nn(Element {
            ref_count: Cell::new(1),
            element: DetachablePtr::new(element),
            attribute_iterators: JsCell::new(Vec::new()),
        })
    }

    /// End every `AttributeIterator` we handed to JS: null its backref to us
    /// and release our `+1`. Called when the handler is returning (we are about
    /// to stop being a valid target) or when `setAttribute` / `removeAttribute`
    /// is about to renumber the attributes their index refers into.
    fn detach_attribute_iterators(&self) {
        // R-2: take the Vec out of the cell, drain on the stack — no `&mut`
        // projection of `self` is held across `detach()`/`deref()` (which do
        // not re-enter JS, but defence-in-depth keeps the JsCell borrow zero-len).
        let iters = self.attribute_iterators.replace(Vec::new());
        for iter in iters {
            iter.detach();
        }
    }

    /// Called by `handler_callback` when the handler returns. The underlying
    /// `*LOLHTML.Element` is only valid during handler execution, so null it
    /// out here, and end the iterators that read through it.
    pub(crate) fn invalidate(&self) {
        self.element.detach();
        self.detach_attribute_iterators();
    }

    pub(crate) fn on_end_tag_(
        &self,
        global_object: &JSGlobalObject,
        function: JSValue,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
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
            // synchronous call; `handler_callback`'s guard detaches the
            // `EndTag` JsClass slot before this closure returns (or, on a
            // suspension, re-points it at the heap copy lol-html parks), so
            // JS can never reach a dangling pointer.
            let raw: *mut RawEndTag = core::ptr::from_mut(end_tag).cast();
            handler_result(EndTagHandler::on_end_tag(
                NonNull::from(&mut end_tag_handler),
                raw,
            ))
        }));

        Ok(call_frame.this())
    }

    /// Returns the value for a given attribute name on the element, or null if it is not found.
    pub(crate) fn get_attribute_(
        &self,
        global_object: &JSGlobalObject,
        name: &[u8],
    ) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::NULL);
        };
        // A non-UTF-8 name came back from the C API as a null-data `Str`,
        // which JS saw as `null` — not a throw. Keep that distinction.
        let Ok(name) = core::str::from_utf8(name) else {
            return Ok(JSValue::NULL);
        };
        opt_string_to_js_or_null(el.get_attribute(name), global_object)
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub(crate) fn has_attribute_(&self, global: &JSGlobalObject, name: &[u8]) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::FALSE);
        };
        let name = utf8_or_throw(global, name)?;
        Ok(JSValue::from(el.has_attribute(name)))
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub(crate) fn set_attribute_(
        &self,
        call_frame: &CallFrame,
        global_object: &JSGlobalObject,
        name: &[u8],
        value: &[u8],
    ) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };

        // A push shifts what the index any live AttributeIterator holds refers
        // to, so end their iteration rather than let them repeat or skip one.
        self.detach_attribute_iterators();

        let name = utf8_or_throw(global_object, name)?;
        let value = utf8_or_throw(global_object, value)?;
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
        name: &[u8],
    ) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };

        // `Vec::remove` shifts the trailing attributes down, so a live
        // AttributeIterator's index would skip the one that took this slot.
        self.detach_attribute_iterators();

        let name = utf8_or_throw(global_object, name)?;
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
        let name = eat_string(&mut iter, global)?;
        self.get_attribute_(global, &name)
    }

    pub(crate) fn has_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_string(&mut iter, global)?;
        self.has_attribute_(global, &name)
    }

    pub(crate) fn set_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_string(&mut iter, global)?;
        let value = eat_string(&mut iter, global)?;
        self.set_attribute_(call_frame, global, &name, &value)
    }

    pub(crate) fn remove_attribute(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = ArgumentsSlice::init(global.bun_vm_ref(), call_frame.arguments());
        let name = eat_string(&mut iter, global)?;
        self.remove_attribute_(call_frame, global, &name)
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
        let Some(el) = self.element.get_mut() else {
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
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        el.remove_and_keep_content();
        Ok(call_frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_tag_name(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(&el.tag_name(), global_object)
    }

    // Note: no `#[bun_jsc::host_fn(setter)]` — generated_classes.rs already
    // emits `ElementPrototype__setTagName` via `host_setter_result`.
    pub(crate) fn set_tag_name(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if self.element.is_detached() {
            return Ok(());
        }
        let name = setter_utf8_arg(global, value)?;
        let Some(el) = self.element.get_mut() else {
            return Ok(());
        };
        if let Err(e) = el.set_tag_name(&name) {
            return Err(global.throw_value(create_lolhtml_error(global, &e)));
        }
        Ok(())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_removed(&self, _global: &JSGlobalObject) -> JSValue {
        match self.element.get_mut() {
            Some(el) => JSValue::from(el.removed()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_self_closing(&self, _global: &JSGlobalObject) -> JSValue {
        match self.element.get_mut() {
            Some(el) => JSValue::from(el.is_self_closing()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_can_have_content(&self, _global: &JSGlobalObject) -> JSValue {
        match self.element.get_mut() {
            Some(el) => JSValue::from(el.can_have_content()),
            None => JSValue::UNDEFINED,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_namespace_uri(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(el) = self.element.get_mut() else {
            return Ok(JSValue::UNDEFINED);
        };
        string_to_js(el.namespace_uri(), global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_attributes(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if self.element.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        // The iterator reads attributes back through `self` on every `next()`,
        // so it follows a retarget (suspension) and never caches a borrow into
        // the attribute buffer.
        let attr_iter = RefPtr::new(AttributeIterator {
            ref_count: Cell::new(1),
            element: Cell::new(Some(BackRef::new(self))),
            index: Cell::new(0),
        });
        // Track this iterator so we can detach it when the handler returns or
        // an attribute mutation invalidates it.
        // R-2: `with_mut` — closure does not call into JS (push only).
        self.attribute_iterators
            .with_mut(|v| v.push(attr_iter.clone()));
        // The JS wrapper owns this ref.
        Ok(AttributeIterator::to_js_nonnull(
            attr_iter.into_non_null(),
            global_object,
        ))
    }
}

// `Element` is the one wrapper whose `detach` has to do more than null out the
// raw pointer: it also ends the `AttributeIterator`s it handed to JS, which
// hold a backref to it and read through it (see `invalidate`).
impl WrapperLike for Element {
    type Raw = RawElement;
    fn init(v: *mut Self::Raw) -> NonNull<Self> {
        Self::init(v)
    }
    fn to_js(this: NonNull<Self>, g: &JSGlobalObject) -> JSValue {
        Self::to_js_nonnull(this, g)
    }
    fn detach(&self) {
        self.invalidate();
    }
    fn retarget(&self, raw: *mut Self::Raw) {
        // The element's lol-html backing (including the attribute buffer) was
        // replaced by the owned copy `into_suspended` parked on the heap.
        // `AttributeIterator` reads through this same cell on every `next()`,
        // so iterators handed out before the handler's `await` keep working,
        // resuming at the same index into the copied buffer.
        self.element.set(raw);
    }
    fn suspended_raw(rewriter: &mut LolRewriter) -> *mut Self::Raw {
        rewriter
            .suspended_element()
            .map_or(core::ptr::null_mut(), |unit| {
                core::ptr::from_mut(unit).cast()
            })
    }
    fn into_suspended(wrapper: RefPtr<Self>) -> SuspendedWrapper {
        SuspendedWrapper::Element(wrapper)
    }
}

// ───────────────── input-stream JS-pump .then() reactions ────────────────
// `JSSink::<RewriterPipe>::assign_to_stream` returns a promise on the
// JS-readable fallback path (no native ByteStream/FileReader). These are its
// resolve/reject reactions, mirroring `Bun__FetchTasklet__on*RequestStream`
// (src/runtime/webcore/fetch/FetchTasklet.rs) and `Bun__FileSink__on*Stream`.
// The context is the `JSHTMLRewriterTransform` cell passed by
// `RewriterPipe::wire_input`'s `.then_with_value()`; the cell (and thus the
// pipe) stays alive as long as the pump promise's reaction is rooted.

fn on_resolve_input_stream(
    _global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let Some(this) = js_HTMLRewriterTransform::from_js(args[args.len() - 1]) else {
        return Ok(JSValue::UNDEFINED);
    };
    let this = BackRef::from(this);
    let this = &*this;
    this.js_pump_reaction_pending.set(false);
    this.end_from_stream(None);
    Ok(JSValue::UNDEFINED)
}

fn on_reject_input_stream(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let Some(this) = js_HTMLRewriterTransform::from_js(args[args.len() - 1]) else {
        return Ok(JSValue::UNDEFINED);
    };
    let err = args[0];
    let this = BackRef::from(this);
    let this = &*this;
    this.js_pump_reaction_pending.set(false);
    this.end_from_stream(Some(crate::webcore::streams::StreamError::JSValue(
        jsc::strong::Optional::create(err, global_this),
    )));
    Ok(JSValue::UNDEFINED)
}

// Exported as *function* symbols so `Zig::GlobalObject::promiseHandlerID`'s
// address comparison matches; a `static` fn-ptr export would export the data
// slot's address, not the code address (see `Bun__FileSink__onResolveStream`).
bun_jsc::jsc_promise_handler!(
    pub(crate) fn on_resolve_input_stream_shim = "Bun__HTMLRewriter__onResolveInputStream"
        => on_resolve_input_stream
);
bun_jsc::jsc_promise_handler!(
    pub(crate) fn on_reject_input_stream_shim = "Bun__HTMLRewriter__onRejectInputStream"
        => on_reject_input_stream
);
