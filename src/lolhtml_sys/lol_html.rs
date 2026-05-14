use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

#[derive(Debug, Copy, Clone, Eq, PartialEq, thiserror::Error, strum::IntoStaticStr)]
pub enum Error {
    #[error("Fail")]
    Fail,
}
// TODO(port): impl From<Error> for bun_core::Error

#[repr(C)]
#[derive(Copy, Clone)]
pub struct MemorySettings {
    pub preallocated_parsing_buffer_size: usize,
    pub max_allowed_memory_usage: usize,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SourceLocationBytes {
    pub start: usize,
    pub end: usize,
}

#[inline(always)]
fn auto_disable() {
    // TODO(port): bun_core::feature_flags::DISABLE_LOLHTML — comptime flag in Zig
    if bun_core::feature_flags::DISABLE_LOLHTML {
        unreachable!();
    }
}

/// rust panics if the pointer itself is zero, even if the passed length is zero
/// to work around that, we use a static null-terminated pointer
/// https://github.com/oven-sh/bun/issues/2323
fn ptr_without_panic(buf: &[u8]) -> *const u8 {
    // we must use a static pointer so the lifetime of this pointer is long enough
    static NULL_TERMINATED_PTR: [u8; 1] = [0];

    if buf.is_empty() {
        return NULL_TERMINATED_PTR.as_ptr();
    }

    buf.as_ptr()
}

// ─── Opaque-handle deref helper ───────────────────────────────────────────

/// Sealed marker for the opaque-ZST handle types in this crate. Every
/// implementor is `#[repr(C)] struct { UnsafeCell<[u8; 0]>, PhantomData<..> }`:
/// zero-sized, align-1, and `UnsafeCell` so `&mut T` carries no `noalias`.
///
/// Dereferencing a non-null `*mut T` to such a type reads zero bytes and
/// asserts nothing about uniqueness or `dereferenceable(N)`, so the *only*
/// validity requirement is non-null — which `<*mut T>::as_mut`/`as_ref`
/// already check. That lets callers store the lol-html-owned pointer as
/// `*mut T` (nullable after detach) and recover a usable `&mut T` without a
/// per-call `unsafe { }` at every method site.
mod sealed {
    pub trait Sealed {}
}
pub trait Opaque: sealed::Sealed {
    /// Null-checked deref. See trait doc for the soundness argument.
    #[inline(always)]
    fn from_ptr<'a>(p: *mut Self) -> Option<&'a mut Self>
    where
        Self: Sized,
    {
        // SAFETY: `Self` is a zero-sized `UnsafeCell<[u8; 0]>` opaque (sealed
        // impls only); a non-null pointer to a ZST is always dereferenceable
        // for 0 bytes and `&mut` over `UnsafeCell` carries no `noalias`.
        unsafe { p.as_mut() }
    }
}
macro_rules! lol_opaque {
    ($($t:ty),* $(,)?) => { $( impl sealed::Sealed for $t {} impl Opaque for $t {} )* };
}
lol_opaque!(
    HTMLRewriter,
    HTMLRewriterBuilder,
    HTMLSelector,
    TextChunk,
    Element,
    EndTag,
    Attribute,
    AttributeIterator,
    Comment,
    DocEnd,
    DocType
);

// ─── HTMLRewriter ─────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct HTMLRewriter; }

unsafe extern "C" {
    fn lol_html_rewriter_write(
        rewriter: *mut HTMLRewriter,
        chunk: *const u8,
        chunk_len: usize,
    ) -> c_int;
    fn lol_html_rewriter_end(rewriter: *mut HTMLRewriter) -> c_int;
    fn lol_html_rewriter_free(rewriter: *mut HTMLRewriter);
}

impl HTMLRewriter {
    /// # Safety
    /// `this` must be a valid `*mut HTMLRewriter` returned from FFI and not yet freed.
    pub unsafe fn write(this: *mut HTMLRewriter, chunk: &[u8]) -> Result<(), Error> {
        auto_disable();
        let ptr = ptr_without_panic(chunk);
        // SAFETY: caller guarantees `this` is valid; ptr/len describe a valid slice
        let rc = unsafe { lol_html_rewriter_write(this, ptr, chunk.len()) };
        if rc < 0 {
            return Err(Error::Fail);
        }
        Ok(())
    }

    /// Completes rewriting and flushes the remaining output.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    ///
    /// WARNING: after calling this function, further attempts to use the rewriter
    /// (other than `lol_html_rewriter_free`) will cause a thread panic.
    ///
    /// # Safety
    /// `this` must be a valid `*mut HTMLRewriter` returned from FFI and not yet freed.
    pub unsafe fn end(this: *mut HTMLRewriter) -> Result<(), Error> {
        auto_disable();

        // SAFETY: caller guarantees `this` is valid
        if unsafe { lol_html_rewriter_end(this) } < 0 {
            return Err(Error::Fail);
        }
        Ok(())
    }

    // TODO(port): opaque FFI handle freed via C — cannot impl Drop on zero-sized opaque marker.
    // Phase B: consider an owning newtype `OwnedRewriter(NonNull<HTMLRewriter>)` with Drop.
    pub unsafe fn destroy(this: *mut HTMLRewriter) {
        auto_disable();
        // SAFETY: caller guarantees `this` was returned by lol_html_rewriter_build and not yet freed
        unsafe { lol_html_rewriter_free(this) };
    }
}

// ─── HTMLRewriter::Builder ────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct HTMLRewriterBuilder; }

pub type OutputSinkFn = unsafe extern "C" fn(*const u8, usize, *mut c_void);

unsafe extern "C" {
    fn lol_html_rewriter_builder_new() -> *mut HTMLRewriterBuilder;
    fn lol_html_rewriter_builder_add_element_content_handlers(
        builder: *mut HTMLRewriterBuilder,
        selector: *const HTMLSelector,
        element_handler: Option<lol_html_element_handler_t>,
        element_handler_user_data: *mut c_void,
        comment_handler: Option<lol_html_comment_handler_t>,
        comment_handler_user_data: *mut c_void,
        text_handler: Option<lol_html_text_handler_handler_t>,
        text_handler_user_data: *mut c_void,
    ) -> c_int;
    fn lol_html_rewriter_builder_free(builder: *mut HTMLRewriterBuilder);
    fn lol_html_rewriter_build(
        builder: *mut HTMLRewriterBuilder,
        encoding: *const u8,
        encoding_len: usize,
        memory_settings: MemorySettings,
        output_sink: Option<OutputSinkFn>,
        output_sink_user_data: *mut c_void,
        strict: bool,
    ) -> *mut HTMLRewriter;
    fn unstable_lol_html_rewriter_build_with_esi_tags(
        builder: *mut HTMLRewriterBuilder,
        encoding: *const u8,
        encoding_len: usize,
        memory_settings: MemorySettings,
        output_sink: Option<OutputSinkFn>,
        output_sink_user_data: *mut c_void,
        strict: bool,
    ) -> *mut HTMLRewriter;
    fn lol_html_rewriter_builder_add_document_content_handlers(
        builder: *mut HTMLRewriterBuilder,
        doctype_handler: Option<DirectiveFunctionType<DocType>>,
        doctype_handler_user_data: *mut c_void,
        comment_handler: Option<lol_html_comment_handler_t>,
        comment_handler_user_data: *mut c_void,
        text_handler: Option<lol_html_text_handler_handler_t>,
        text_handler_user_data: *mut c_void,
        doc_end_handler: Option<lol_html_doc_end_handler_t>,
        doc_end_user_data: *mut c_void,
    );
}

impl HTMLRewriterBuilder {
    // TODO(port): opaque FFI handle — see HTMLRewriter::destroy note re: owning wrapper + Drop
    pub unsafe fn destroy(this: *mut HTMLRewriterBuilder) {
        auto_disable();
        // SAFETY: caller guarantees `this` came from lol_html_rewriter_builder_new and not yet freed
        unsafe { lol_html_rewriter_builder_free(this) };
    }

    pub fn init() -> *mut HTMLRewriterBuilder {
        auto_disable();
        // SAFETY: FFI constructor; returns a fresh builder
        unsafe { lol_html_rewriter_builder_new() }
    }

    /// Adds document-level content handlers to the builder.
    ///
    /// If a particular handler is not required then NULL can be passed
    /// instead. Don't use stub handlers in this case as this affects
    /// performance - rewriter skips parsing of the content that doesn't
    /// need to be processed.
    ///
    /// Each handler can optionally have associated user data which will be
    /// passed to the handler on each invocation along with the rewritable
    /// unit argument.
    ///
    /// If any of handlers return LOL_HTML_STOP directive then rewriting
    /// stops immediately and `write()` or `end()` of the rewriter methods
    /// return an error code.
    ///
    /// WARNING: Pointers passed to handlers are valid only during the
    /// handler execution. So they should never be leaked outside of handlers.
    // TODO(port): Zig used comptime fn-value params to monomorphize trampolines per callback.
    // Rust cannot take const fn pointers as const generics; modeled via DirectiveCallback trait.
    // PORT NOTE: handler-data params are `Option<NonNull<H>>`, not
    // `Option<&mut H>` — callers routinely pass the SAME allocation for
    // multiple slots (one `DocumentHandler` services doctype/comment/text/end),
    // and materializing several live `&mut` to one object is UB under Stacked
    // Borrows. The wrapper only ever erases the pointer to `*mut c_void`
    // userdata, so a raw `NonNull` is the honest type.
    pub fn add_document_content_handlers<DT, CM, TX, DE>(
        &mut self,
        doctype_handler_data: Option<NonNull<DT>>,
        comment_handler_data: Option<NonNull<CM>>,
        text_chunk_handler_data: Option<NonNull<TX>>,
        end_tag_handler_data: Option<NonNull<DE>>,
    ) where
        DT: DirectiveCallback<DocType>,
        CM: DirectiveCallback<Comment>,
        TX: DirectiveCallback<TextChunk>,
        DE: DirectiveCallback<DocEnd>,
    {
        auto_disable();

        // SAFETY: self is a valid builder; handler fn pointers are valid extern "C" trampolines;
        // user_data pointers are either null or point to live handler objects the caller keeps alive
        unsafe {
            lol_html_rewriter_builder_add_document_content_handlers(
                self,
                doctype_handler_data.map(|_| directive_handler::<DocType, DT> as _),
                doctype_handler_data.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
                comment_handler_data.map(|_| directive_handler::<Comment, CM> as _),
                comment_handler_data.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
                text_chunk_handler_data.map(|_| directive_handler::<TextChunk, TX> as _),
                text_chunk_handler_data
                    .map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
                end_tag_handler_data.map(|_| directive_handler::<DocEnd, DE> as _),
                end_tag_handler_data.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
            );
        }
    }

    /// Adds element content handlers to the builder for the
    /// given CSS selector.
    ///
    /// Selector should be a valid UTF8-string.
    ///
    /// If a particular handler is not required then NULL can be passed
    /// instead. Don't use stub handlers in this case as this affects
    /// performance - rewriter skips parsing of the content that doesn't
    /// need to be processed.
    ///
    /// Each handler can optionally have associated user data which will be
    /// passed to the handler on each invocation along with the rewritable
    /// unit argument.
    ///
    /// If any of handlers return LOL_HTML_STOP directive then rewriting
    /// stops immediately and `write()` or `end()` of the rewriter methods
    /// return an error code.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    ///
    /// WARNING: Pointers passed to handlers are valid only during the
    /// handler execution. So they should never be leaked outside of handlers.
    // TODO(port): comptime fn-value params → trait-based trampolines (see add_document_content_handlers)
    // PORT NOTE: Zig also checked `handler != null` (in addition to `handler_data != null`); the trait
    // model assumes the handler is always present when data is Some, so (handler=null, data=non-null)
    // is unrepresentable here.
    // PORT NOTE: see `add_document_content_handlers` — `Option<NonNull<H>>` to
    // permit the same handler allocation in multiple slots without aliased
    // `&mut`.
    pub fn add_element_content_handlers<EL, CM, TX>(
        &mut self,
        selector: &mut HTMLSelector,
        element_handler_data: Option<NonNull<EL>>,
        comment_handler_data: Option<NonNull<CM>>,
        text_chunk_handler_data: Option<NonNull<TX>>,
    ) -> Result<(), Error>
    where
        EL: DirectiveCallback<Element>,
        CM: DirectiveCallback<Comment>,
        TX: DirectiveCallback<TextChunk>,
    {
        auto_disable();
        // SAFETY: self/selector are valid FFI handles; trampolines are valid extern "C" fns;
        // user_data pointers are either null or point to live handler objects the caller keeps alive
        let rc = unsafe {
            lol_html_rewriter_builder_add_element_content_handlers(
                self,
                selector,
                element_handler_data.map(|_| directive_handler::<Element, EL> as _),
                element_handler_data.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
                comment_handler_data.map(|_| directive_handler::<Comment, CM> as _),
                comment_handler_data.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
                text_chunk_handler_data.map(|_| directive_handler::<TextChunk, TX> as _),
                text_chunk_handler_data
                    .map_or(core::ptr::null_mut(), |p| p.as_ptr().cast::<c_void>()),
            )
        };
        match rc {
            -1 => Err(Error::Fail),
            0 => Ok(()),
            _ => unreachable!(),
        }
    }

    // TODO(port): Zig took comptime Writer/Done fn-values; modeled via OutputSink trait
    //
    // PORT NOTE: takes `*mut S` (not `&mut S`) so the userdata pointer stored
    // in the C rewriter retains the caller's raw-pointer provenance (typically
    // a `heap::alloc` root). If we took `&mut S`, the userdata would carry a
    // tag derived from that short-lived Unique borrow, and any subsequent
    // access through the caller's original raw pointer would invalidate it
    // under Stacked Borrows — making the re-entrant `&mut *user_data` deref in
    // `output_sink_function` UB.
    pub fn build<S: OutputSink>(
        &mut self,
        encoding: Encoding,
        memory_settings: MemorySettings,
        strict: bool,
        output_sink: *mut S,
    ) -> Result<*mut HTMLRewriter, Error> {
        auto_disable();

        let encoding_ = encoding.label();
        // SAFETY: self is a valid builder; encoding_ is a valid static slice; output_sink_function::<S>
        // is a valid extern "C" trampoline; output_sink lives as long as the rewriter (caller invariant)
        let ptr = unsafe {
            lol_html_rewriter_build(
                self,
                encoding_.as_ptr(),
                encoding_.len(),
                memory_settings,
                Some(output_sink_function::<S>),
                output_sink.cast::<c_void>(),
                strict,
            )
        };
        if ptr.is_null() {
            return Err(Error::Fail);
        }
        Ok(ptr)
    }
}

/// Trait modeling Zig's `comptime Writer/Done` fn-value pair for `build`.
pub trait OutputSink {
    fn write(&mut self, bytes: &[u8]);
    fn done(&mut self);
}

unsafe extern "C" fn output_sink_function<S: OutputSink>(
    ptr: *const u8,
    len: usize,
    user_data: *mut c_void,
) {
    auto_disable();

    // Zig: @setRuntimeSafety(false)
    // SAFETY: user_data was set to &mut S in build(); ptr[0..len] is valid for the duration of this call
    let this = unsafe { bun_core::callback_ctx::<S>(user_data) };
    match len {
        0 => this.done(),
        _ => this.write(unsafe { bun_core::ffi::slice(ptr, len) }),
    }
}

// ─── HTMLSelector ─────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct HTMLSelector; }

unsafe extern "C" {
    fn lol_html_selector_parse(selector: *const u8, selector_len: usize) -> *mut HTMLSelector;
    fn lol_html_selector_free(selector: *mut HTMLSelector);
}

impl HTMLSelector {
    /// Frees the memory held by the parsed selector object.
    // TODO(port): opaque FFI handle — see HTMLRewriter::destroy note
    pub unsafe fn destroy(selector: *mut HTMLSelector) {
        auto_disable();
        // SAFETY: caller guarantees `selector` was returned by parse() and not yet freed
        unsafe { lol_html_selector_free(selector) };
    }

    /// Parses given CSS selector string.
    ///
    /// Returns NULL if parsing error occurs. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    ///
    /// WARNING: Selector SHOULD NOT be deallocated if there are any active rewriter
    /// builders that accepted it as an argument to `lol_html_rewriter_builder_add_element_content_handlers()`
    /// method. Deallocate all dependant rewriter builders first and then
    /// use `lol_html_selector_free` function to free the selector.
    pub fn parse(selector: &[u8]) -> Result<*mut HTMLSelector, Error> {
        auto_disable();

        // SAFETY: ptr_without_panic returns a valid non-null pointer; len matches selector
        let ptr = unsafe { lol_html_selector_parse(ptr_without_panic(selector), selector.len()) };
        if ptr.is_null() {
            Err(Error::Fail)
        } else {
            Ok(ptr)
        }
    }
}

// ─── TextChunk ────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct TextChunk; }

#[repr(C)]
#[derive(Copy, Clone)]
pub struct TextChunkContent {
    pub ptr: *const u8,
    pub len: usize,
}

impl TextChunkContent {
    pub fn slice(&self) -> &[u8] {
        auto_disable();
        // SAFETY: lol-html guarantees ptr[0..len] is valid for the lifetime of the handler call
        unsafe { bun_core::ffi::slice(self.ptr, self.len) }
    }
}

// `TextChunk` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — `&TextChunk` /
// `&mut TextChunk` are ABI-identical to a non-null pointer with no
// `readonly`/`noalias` attribute. Shims whose only pointer argument is the
// chunk itself (plus value-type returns) are declared `safe fn` so the
// validity proof lives in the type signature instead of per-call `unsafe { }`.
// Shims that take a separate (ptr,len) pair stay `unsafe`.
unsafe extern "C" {
    safe fn lol_html_text_chunk_content_get(chunk: &TextChunk) -> TextChunkContent;
    safe fn lol_html_text_chunk_is_last_in_text_node(chunk: &TextChunk) -> bool;
    fn lol_html_text_chunk_before(
        chunk: *mut TextChunk,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_text_chunk_after(
        chunk: *mut TextChunk,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_text_chunk_replace(
        chunk: *mut TextChunk,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    safe fn lol_html_text_chunk_remove(chunk: &mut TextChunk);
    safe fn lol_html_text_chunk_is_removed(chunk: &TextChunk) -> bool;
    safe fn lol_html_text_chunk_user_data_set(chunk: &TextChunk, user_data: *mut c_void);
    safe fn lol_html_text_chunk_user_data_get(chunk: &TextChunk) -> *mut c_void;
    safe fn lol_html_text_chunk_source_location_bytes(chunk: &TextChunk) -> SourceLocationBytes;
}

impl TextChunk {
    pub fn get_content(&self) -> TextChunkContent {
        auto_disable();
        lol_html_text_chunk_content_get(self)
    }
    pub fn is_last_in_text_node(&self) -> bool {
        auto_disable();
        lol_html_text_chunk_is_last_in_text_node(self)
    }
    /// Inserts the content string before the text chunk either as raw text or as HTML.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        if unsafe {
            lol_html_text_chunk_before(self, ptr_without_panic(content), content.len(), is_html)
        } < 0
        {
            return Err(Error::Fail);
        }
        Ok(())
    }
    /// Inserts the content string after the text chunk either as raw text or as HTML.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        if unsafe {
            lol_html_text_chunk_after(self, ptr_without_panic(content), content.len(), is_html)
        } < 0
        {
            return Err(Error::Fail);
        }
        Ok(())
    }
    // Replace the text chunk with the content of the string which is interpreted
    // either as raw text or as HTML.
    //
    // Content should be a valid UTF8-string.
    //
    // Returns 0 in case of success and -1 otherwise. The actual error message
    // can be obtained using `lol_html_take_last_error` function.
    pub fn replace(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        if unsafe {
            lol_html_text_chunk_replace(self, ptr_without_panic(content), content.len(), is_html)
        } < 0
        {
            return Err(Error::Fail);
        }
        Ok(())
    }
    /// Removes the text chunk.
    pub fn remove(&mut self) {
        auto_disable();
        lol_html_text_chunk_remove(self)
    }
    pub fn is_removed(&self) -> bool {
        auto_disable();
        lol_html_text_chunk_is_removed(self)
    }
    pub fn set_user_data<T>(&self, value: Option<&mut T>) {
        auto_disable();
        lol_html_text_chunk_user_data_set(
            self,
            value.map_or(core::ptr::null_mut(), |v| {
                std::ptr::from_mut::<T>(v).cast::<c_void>()
            }),
        )
    }
    pub fn get_user_data<T>(&self) -> Option<*mut T> {
        auto_disable();
        let p = lol_html_text_chunk_user_data_get(self);
        if p.is_null() {
            None
        } else {
            Some(p.cast::<T>())
        }
    }
    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        lol_html_text_chunk_source_location_bytes(self)
    }
}

// ─── Element ──────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Element; }

// `Element` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — see `TextChunk` extern
// block comment for the `safe fn` rationale. (ptr,len) shims stay `unsafe`.
unsafe extern "C" {
    fn lol_html_element_get_attribute(
        element: *const Element,
        name: *const u8,
        name_len: usize,
    ) -> HTMLString;
    fn lol_html_element_has_attribute(
        element: *const Element,
        name: *const u8,
        name_len: usize,
    ) -> c_int;
    fn lol_html_element_set_attribute(
        element: *mut Element,
        name: *const u8,
        name_len: usize,
        value: *const u8,
        value_len: usize,
    ) -> c_int;
    fn lol_html_element_remove_attribute(
        element: *mut Element,
        name: *const u8,
        name_len: usize,
    ) -> c_int;
    fn lol_html_element_before(
        element: *mut Element,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_element_prepend(
        element: *mut Element,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_element_append(
        element: *mut Element,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_element_after(
        element: *mut Element,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_element_set_inner_content(
        element: *mut Element,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_element_replace(
        element: *mut Element,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    safe fn lol_html_element_remove(element: &Element);
    safe fn lol_html_element_remove_and_keep_content(element: &Element);
    safe fn lol_html_element_is_removed(element: &Element) -> bool;
    safe fn lol_html_element_is_self_closing(element: &Element) -> bool;
    safe fn lol_html_element_can_have_content(element: &Element) -> bool;
    safe fn lol_html_element_user_data_set(element: &Element, user_data: *mut c_void);
    safe fn lol_html_element_user_data_get(element: &Element) -> *mut c_void;
    safe fn lol_html_element_add_end_tag_handler(
        element: &mut Element,
        end_tag_handler: lol_html_end_tag_handler_t,
        user_data: *mut c_void,
    ) -> c_int;
    safe fn lol_html_element_clear_end_tag_handlers(element: &mut Element);
    safe fn lol_html_element_source_location_bytes(element: &Element) -> SourceLocationBytes;

    safe fn lol_html_element_tag_name_get(element: &Element) -> HTMLString;
    fn lol_html_element_tag_name_set(
        element: *mut Element,
        name: *const u8,
        name_len: usize,
    ) -> c_int;
    safe fn lol_html_element_namespace_uri_get(element: &Element) -> *const c_char;
    safe fn lol_html_attributes_iterator_get(element: &Element) -> *mut AttributeIterator;
}

impl Element {
    pub fn get_attribute(&self, name: &[u8]) -> HTMLString {
        auto_disable();
        // SAFETY: name ptr/len describe a valid slice
        unsafe { lol_html_element_get_attribute(self, ptr_without_panic(name), name.len()) }
    }
    pub fn has_attribute(&self, name: &[u8]) -> Result<bool, Error> {
        auto_disable();
        // SAFETY: name ptr/len describe a valid slice
        match unsafe { lol_html_element_has_attribute(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(false),
            1 => Ok(true),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn set_attribute(&mut self, name: &[u8], value: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: name/value ptr/len describe valid slices
        match unsafe {
            lol_html_element_set_attribute(
                self,
                ptr_without_panic(name),
                name.len(),
                ptr_without_panic(value),
                value.len(),
            )
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn remove_attribute(&mut self, name: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: name ptr/len describe a valid slice
        match unsafe {
            lol_html_element_remove_attribute(self, ptr_without_panic(name), name.len())
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_element_before(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn prepend(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_element_prepend(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn append(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_element_append(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_element_after(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn set_inner_content(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_element_set_inner_content(
                self,
                ptr_without_panic(content),
                content.len(),
                is_html,
            )
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    /// Replaces the element with the provided text or HTML content.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn replace(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_element_replace(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn remove(&self) {
        auto_disable();
        lol_html_element_remove(self)
    }
    // Removes the element, but leaves its inner content intact.
    pub fn remove_and_keep_content(&self) {
        auto_disable();
        lol_html_element_remove_and_keep_content(self)
    }
    pub fn is_removed(&self) -> bool {
        auto_disable();
        lol_html_element_is_removed(self)
    }
    pub fn is_self_closing(&self) -> bool {
        auto_disable();
        lol_html_element_is_self_closing(self)
    }
    pub fn can_have_content(&self) -> bool {
        auto_disable();
        lol_html_element_can_have_content(self)
    }
    pub fn set_user_data(&self, user_data: *mut c_void) {
        auto_disable();
        lol_html_element_user_data_set(self, user_data)
    }
    pub fn get_user_data<T>(&self) -> Option<*mut T> {
        auto_disable();
        let p = lol_html_element_user_data_get(self);
        if p.is_null() {
            None
        } else {
            Some(p.cast::<T>())
        }
    }
    pub fn on_end_tag(
        &mut self,
        end_tag_handler: lol_html_end_tag_handler_t,
        user_data: *mut c_void,
    ) -> Result<(), Error> {
        auto_disable();
        lol_html_element_clear_end_tag_handlers(self);
        match lol_html_element_add_end_tag_handler(self, end_tag_handler, user_data) {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn tag_name(&self) -> HTMLString {
        lol_html_element_tag_name_get(self)
    }

    pub fn set_tag_name(&mut self, name: &[u8]) -> Result<(), Error> {
        // SAFETY: name ptr/len describe a valid slice
        match unsafe { lol_html_element_tag_name_set(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn namespace_uri(&self) -> *const c_char {
        lol_html_element_namespace_uri_get(self)
    }

    pub fn attributes(&self) -> Option<*mut AttributeIterator> {
        let p = lol_html_attributes_iterator_get(self);
        if p.is_null() { None } else { Some(p) }
    }

    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        lol_html_element_source_location_bytes(self)
    }
}

// ─── HTMLString ───────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone)]
pub struct HTMLString {
    pub ptr: *const u8,
    pub len: usize,
}

unsafe extern "C" {
    fn lol_html_str_free(str: HTMLString);
    pub fn lol_html_take_last_error(...) -> HTMLString;
}

impl HTMLString {
    // TODO(port): #[repr(C)] value crosses FFI by-value; explicit deinit kept instead of Drop
    pub fn deinit(self) {
        auto_disable();
        // if (this.len > 0) {
        // SAFETY: self was returned by an lol_html_* fn that allocates a string
        unsafe { lol_html_str_free(self) };
        // }
    }

    pub fn last_error() -> HTMLString {
        auto_disable();
        // SAFETY: FFI getter for thread-local last error
        unsafe { lol_html_take_last_error() }
    }

    pub fn slice(&self) -> &[u8] {
        auto_disable();
        // Zig: @setRuntimeSafety(false)
        // lol_html.h: several getters (lol_html_take_last_error, lol_html_element_get_attribute,
        // lol_html_doctype_*_get) return { data: NULL, len: 0 } to mean "absent". `ffi::slice`
        // tolerates the (null, 0) shape.
        // SAFETY: lol-html guarantees ptr[0..len] is valid until lol_html_str_free
        unsafe { bun_core::ffi::slice(self.ptr, self.len) }
    }

    /// Free callback for `bun.String.createExternal`. Exposed so the higher-level
    /// wrapper crate can build an external WTF string backed by this buffer.
    pub extern "C" fn deinit_external(_: *mut u8, ptr: *mut c_void, len: usize) {
        auto_disable();
        // SAFETY: ptr/len were the original HTMLString fields passed to createExternal
        unsafe {
            lol_html_str_free(HTMLString {
                ptr: ptr as *const u8,
                len,
            })
        };
    }

    // `to_string(self) -> bun.String` and `to_js` live in the higher-tier
    // wrapper at `bun_runtime::api::lolhtml_jsc::{html_string_to_string,
    // html_string_to_js}` — this *_sys crate has no `bun_string` / `bun_jsc`
    // dependency.
}

// ─── EndTag ───────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct EndTag; }

// `EndTag` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — see `TextChunk` extern
// block comment for the `safe fn` rationale.
unsafe extern "C" {
    fn lol_html_end_tag_before(
        end_tag: *mut EndTag,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_end_tag_after(
        end_tag: *mut EndTag,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_end_tag_replace(
        end_tag: *mut EndTag,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    safe fn lol_html_end_tag_remove(end_tag: &mut EndTag);
    safe fn lol_html_end_tag_name_get(end_tag: &EndTag) -> HTMLString;
    fn lol_html_end_tag_name_set(end_tag: *mut EndTag, name: *const u8, name_len: usize) -> c_int;
    safe fn lol_html_end_tag_source_location_bytes(end_tag: &EndTag) -> SourceLocationBytes;
}

impl EndTag {
    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_end_tag_before(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_end_tag_after(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn replace(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_end_tag_replace(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn remove(&mut self) {
        auto_disable();
        lol_html_end_tag_remove(self)
    }

    pub fn get_name(&self) -> HTMLString {
        auto_disable();
        lol_html_end_tag_name_get(self)
    }

    pub fn set_name(&mut self, name: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: name ptr/len describe a valid slice
        match unsafe { lol_html_end_tag_name_set(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        lol_html_end_tag_source_location_bytes(self)
    }
}

// ─── Attribute ────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Attribute; }

unsafe extern "C" {
    safe fn lol_html_attribute_name_get(attribute: &Attribute) -> HTMLString;
    safe fn lol_html_attribute_value_get(attribute: &Attribute) -> HTMLString;
}

impl Attribute {
    pub fn name(&self) -> HTMLString {
        auto_disable();
        lol_html_attribute_name_get(self)
    }
    pub fn value(&self) -> HTMLString {
        auto_disable();
        lol_html_attribute_value_get(self)
    }
}

bun_opaque::opaque_ffi! { pub struct AttributeIterator; }

// `AttributeIterator` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — see
// `TextChunk` extern block comment for the `safe fn` rationale.
unsafe extern "C" {
    safe fn lol_html_attributes_iterator_free(iterator: &mut AttributeIterator);
    safe fn lol_html_attributes_iterator_next(iterator: &mut AttributeIterator)
    -> *const Attribute;
}

impl AttributeIterator {
    /// The returned reference is valid until the next call to `next` or until
    /// the iterator is freed.
    pub fn next<'a>(&mut self) -> Option<&'a Attribute> {
        auto_disable();
        let p = lol_html_attributes_iterator_next(self);
        // SAFETY: lol-html guarantees the returned pointer (when non-null) is
        // valid until the next call to `next` or `free`; `Attribute` is an
        // opaque `UnsafeCell<[u8; 0]>` so `&Attribute` carries no `dereferenceable`.
        if p.is_null() {
            None
        } else {
            Some(unsafe { &*p })
        }
    }

    // TODO(port): opaque FFI handle — see HTMLRewriter::destroy note
    pub fn destroy(&mut self) {
        auto_disable();
        lol_html_attributes_iterator_free(self);
    }
}

// ─── Comment ──────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Comment; }

// `Comment` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — see `TextChunk` extern
// block comment for the `safe fn` rationale.
unsafe extern "C" {
    safe fn lol_html_comment_text_get(comment: &Comment) -> HTMLString;
    fn lol_html_comment_text_set(comment: *mut Comment, text: *const u8, text_len: usize) -> c_int;
    fn lol_html_comment_before(
        comment: *mut Comment,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_comment_after(
        comment: *mut Comment,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    fn lol_html_comment_replace(
        comment: *mut Comment,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
    safe fn lol_html_comment_remove(comment: &mut Comment);
    safe fn lol_html_comment_is_removed(comment: &Comment) -> bool;
    safe fn lol_html_comment_user_data_set(comment: &Comment, user_data: *mut c_void);
    safe fn lol_html_comment_user_data_get(comment: &Comment) -> *mut c_void;
    safe fn lol_html_comment_source_location_bytes(comment: &Comment) -> SourceLocationBytes;
}

impl Comment {
    pub fn get_text(&self) -> HTMLString {
        auto_disable();
        lol_html_comment_text_get(self)
    }

    pub fn set_text(&mut self, text: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: text ptr/len describe a valid slice
        match unsafe { lol_html_comment_text_set(self, ptr_without_panic(text), text.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_comment_before(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn replace(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // PORT NOTE: Zig source calls lol_html_comment_before here (likely an upstream bug); ported faithfully
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_comment_before(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_comment_after(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn is_removed(&self) -> bool {
        lol_html_comment_is_removed(self)
    }
    pub fn remove(&mut self) {
        lol_html_comment_remove(self)
    }

    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        lol_html_comment_source_location_bytes(self)
    }
}

// ─── Directive & handler fn types ─────────────────────────────────────────

#[repr(u32)] // c_uint
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Directive {
    Continue = 0,
    Stop = 1,
}

#[allow(non_camel_case_types)]
pub type lol_html_comment_handler_t = unsafe extern "C" fn(*mut Comment, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_text_handler_handler_t =
    unsafe extern "C" fn(*mut TextChunk, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_element_handler_t = unsafe extern "C" fn(*mut Element, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_doc_end_handler_t = unsafe extern "C" fn(*mut DocEnd, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_end_tag_handler_t = unsafe extern "C" fn(*mut EndTag, *mut c_void) -> Directive;

// ─── DocEnd ───────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct DocEnd; }

unsafe extern "C" {
    fn lol_html_doc_end_append(
        doc_end: *mut DocEnd,
        content: *const u8,
        content_len: usize,
        is_html: bool,
    ) -> c_int;
}

impl DocEnd {
    pub fn append(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: content ptr/len describe a valid slice
        match unsafe {
            lol_html_doc_end_append(self, ptr_without_panic(content), content.len(), is_html)
        } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
}

// ─── Directive handler trampolines ────────────────────────────────────────

pub type DirectiveFunctionType<Container> =
    unsafe extern "C" fn(*mut Container, *mut c_void) -> Directive;

// Zig: fn DirectiveFunctionTypeForHandler(comptime Container, comptime UserDataType) type
//      = *const fn (*UserDataType, *Container) bool;
// Rust models this as a trait the user-data type implements per container.
pub trait DirectiveCallback<Container> {
    fn call(&mut self, container: &mut Container) -> bool;
}

// Zig: fn DocTypeHandlerCallback(comptime UserDataType) type — unused alias, kept for parity
pub type DocTypeHandlerCallback<U> = fn(&mut DocType, &mut U) -> bool;

// Zig: pub fn DirectiveHandler(comptime Container, comptime UserDataType, comptime Callback) DirectiveFunctionType(Container)
// Rust: monomorphized extern "C" trampoline per <Container, UserDataType>.
// TODO(port): Zig took the callback as a comptime fn-value (multiple callbacks per type possible).
// Rust trait dispatch allows one callback per (UserDataType, Container) pair. If callers need
// multiple, Phase B can add a const-generic fn-pointer wrapper or distinct ZST marker types.
pub unsafe extern "C" fn directive_handler<Container, U: DirectiveCallback<Container>>(
    this: *mut Container,
    user_data: *mut c_void,
) -> Directive {
    auto_disable();
    // SAFETY: user_data was set to &mut U when registering; this is valid for the handler call
    let result = unsafe { (&mut *user_data.cast::<U>()).call(&mut *this) };
    // @enumFromInt(@intFromBool(result))
    if result {
        Directive::Stop
    } else {
        Directive::Continue
    }
}

// ─── DocType ──────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct DocType; }

// `DocType` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — see `TextChunk` extern
// block comment for the `safe fn` rationale.
unsafe extern "C" {
    safe fn lol_html_doctype_name_get(doctype: &DocType) -> HTMLString;
    safe fn lol_html_doctype_public_id_get(doctype: &DocType) -> HTMLString;
    safe fn lol_html_doctype_system_id_get(doctype: &DocType) -> HTMLString;
    safe fn lol_html_doctype_user_data_set(doctype: &DocType, user_data: *mut c_void);
    safe fn lol_html_doctype_user_data_get(doctype: &DocType) -> *mut c_void;
    safe fn lol_html_doctype_remove(doctype: &mut DocType);
    safe fn lol_html_doctype_is_removed(doctype: &DocType) -> bool;
    safe fn lol_html_doctype_source_location_bytes(doctype: &DocType) -> SourceLocationBytes;
}

pub type DocTypeCallback = unsafe extern "C" fn(*mut DocType, *mut c_void) -> Directive;

impl DocType {
    pub fn get_name(&self) -> HTMLString {
        auto_disable();
        lol_html_doctype_name_get(self)
    }
    pub fn get_public_id(&self) -> HTMLString {
        auto_disable();
        lol_html_doctype_public_id_get(self)
    }
    pub fn get_system_id(&self) -> HTMLString {
        auto_disable();
        lol_html_doctype_system_id_get(self)
    }
    pub fn remove(&mut self) {
        auto_disable();
        lol_html_doctype_remove(self)
    }
    pub fn is_removed(&self) -> bool {
        auto_disable();
        lol_html_doctype_is_removed(self)
    }
    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        lol_html_doctype_source_location_bytes(self)
    }
}

// ─── Encoding ─────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Encoding {
    UTF8,
    UTF16,
}

impl Encoding {
    // Zig: std.enums.EnumMap(Encoding, []const u8) populated at comptime.
    // For 2 entries a plain match is equivalent and avoids the EnumMap dependency.
    pub fn label(self) -> &'static [u8] {
        match self {
            Encoding::UTF8 => b"UTF-8",
            Encoding::UTF16 => b"UTF-16",
        }
    }
}

// ported from: src/lolhtml_sys/lol_html.zig
