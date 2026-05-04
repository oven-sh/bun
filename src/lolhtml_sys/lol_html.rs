use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};

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

// ─── HTMLRewriter ─────────────────────────────────────────────────────────

#[repr(C)]
pub struct HTMLRewriter {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_rewriter_write(rewriter: *mut HTMLRewriter, chunk: *const u8, chunk_len: usize) -> c_int;
    fn lol_html_rewriter_end(rewriter: *mut HTMLRewriter) -> c_int;
    fn lol_html_rewriter_free(rewriter: *mut HTMLRewriter);
}

impl HTMLRewriter {
    pub fn write(&mut self, chunk: &[u8]) -> Result<(), Error> {
        auto_disable();
        let ptr = ptr_without_panic(chunk);
        // SAFETY: self is a valid *mut HTMLRewriter from FFI; ptr/len describe a valid slice
        let rc = unsafe { lol_html_rewriter_write(self, ptr, chunk.len()) };
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
    pub fn end(&mut self) -> Result<(), Error> {
        auto_disable();

        // SAFETY: self is a valid *mut HTMLRewriter from FFI
        if unsafe { lol_html_rewriter_end(self) } < 0 {
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

#[repr(C)]
pub struct HTMLRewriterBuilder {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

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
    pub fn add_document_content_handlers<DT, CM, TX, DE>(
        &mut self,
        doctype_handler_data: Option<&mut DT>,
        comment_handler_data: Option<&mut CM>,
        text_chunk_handler_data: Option<&mut TX>,
        end_tag_handler_data: Option<&mut DE>,
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
                if doctype_handler_data.is_some() {
                    Some(directive_handler::<DocType, DT>)
                } else {
                    None
                },
                doctype_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut DT as *mut c_void),
                if comment_handler_data.is_some() {
                    Some(directive_handler::<Comment, CM>)
                } else {
                    None
                },
                comment_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut CM as *mut c_void),
                if text_chunk_handler_data.is_some() {
                    Some(directive_handler::<TextChunk, TX>)
                } else {
                    None
                },
                text_chunk_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut TX as *mut c_void),
                if end_tag_handler_data.is_some() {
                    Some(directive_handler::<DocEnd, DE>)
                } else {
                    None
                },
                end_tag_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut DE as *mut c_void),
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
    pub fn add_element_content_handlers<EL, CM, TX>(
        &mut self,
        selector: &mut HTMLSelector,
        element_handler_data: Option<&mut EL>,
        comment_handler_data: Option<&mut CM>,
        text_chunk_handler_data: Option<&mut TX>,
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
                if element_handler_data.is_some() {
                    Some(directive_handler::<Element, EL>)
                } else {
                    None
                },
                element_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut EL as *mut c_void),
                if comment_handler_data.is_some() {
                    Some(directive_handler::<Comment, CM>)
                } else {
                    None
                },
                comment_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut CM as *mut c_void),
                if text_chunk_handler_data.is_some() {
                    Some(directive_handler::<TextChunk, TX>)
                } else {
                    None
                },
                text_chunk_handler_data.map_or(core::ptr::null_mut(), |p| p as *mut TX as *mut c_void),
            )
        };
        match rc {
            -1 => Err(Error::Fail),
            0 => Ok(()),
            _ => unreachable!(),
        }
    }

    // TODO(port): Zig took comptime Writer/Done fn-values; modeled via OutputSink trait
    pub fn build<S: OutputSink>(
        &mut self,
        encoding: Encoding,
        memory_settings: MemorySettings,
        strict: bool,
        output_sink: &mut S,
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
                output_sink as *mut S as *mut c_void,
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

unsafe extern "C" fn output_sink_function<S: OutputSink>(ptr: *const u8, len: usize, user_data: *mut c_void) {
    auto_disable();

    // Zig: @setRuntimeSafety(false)
    // SAFETY: user_data was set to &mut S in build(); ptr[0..len] is valid for the duration of this call
    let this = unsafe { &mut *(user_data as *mut S) };
    match len {
        0 => this.done(),
        _ => this.write(unsafe { core::slice::from_raw_parts(ptr, len) }),
    }
}

// ─── HTMLSelector ─────────────────────────────────────────────────────────

#[repr(C)]
pub struct HTMLSelector {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

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

#[repr(C)]
pub struct TextChunk {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

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
        unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
    }
}

unsafe extern "C" {
    fn lol_html_text_chunk_content_get(chunk: *const TextChunk) -> TextChunkContent;
    fn lol_html_text_chunk_is_last_in_text_node(chunk: *const TextChunk) -> bool;
    fn lol_html_text_chunk_before(chunk: *mut TextChunk, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_text_chunk_after(chunk: *mut TextChunk, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_text_chunk_replace(chunk: *mut TextChunk, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_text_chunk_remove(chunk: *mut TextChunk);
    fn lol_html_text_chunk_is_removed(chunk: *const TextChunk) -> bool;
    fn lol_html_text_chunk_user_data_set(chunk: *const TextChunk, user_data: *mut c_void);
    fn lol_html_text_chunk_user_data_get(chunk: *const TextChunk) -> *mut c_void;
    fn lol_html_text_chunk_source_location_bytes(chunk: *const TextChunk) -> SourceLocationBytes;
}

impl TextChunk {
    pub fn get_content(&self) -> TextChunkContent {
        auto_disable();
        // SAFETY: self is a valid *const TextChunk passed to a handler
        unsafe { lol_html_text_chunk_content_get(self) }
    }
    pub fn is_last_in_text_node(&self) -> bool {
        auto_disable();
        // SAFETY: self is a valid *const TextChunk
        unsafe { lol_html_text_chunk_is_last_in_text_node(self) }
    }
    /// Inserts the content string before the text chunk either as raw text or as HTML.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self is valid; content ptr/len describe a valid slice
        if unsafe { lol_html_text_chunk_before(self, ptr_without_panic(content), content.len(), is_html) } < 0 {
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
        // SAFETY: self is valid; content ptr/len describe a valid slice
        if unsafe { lol_html_text_chunk_after(self, ptr_without_panic(content), content.len(), is_html) } < 0 {
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
        // SAFETY: self is valid; content ptr/len describe a valid slice
        if unsafe { lol_html_text_chunk_replace(self, ptr_without_panic(content), content.len(), is_html) } < 0 {
            return Err(Error::Fail);
        }
        Ok(())
    }
    /// Removes the text chunk.
    pub fn remove(&mut self) {
        auto_disable();
        // SAFETY: self is a valid *mut TextChunk
        unsafe { lol_html_text_chunk_remove(self) }
    }
    pub fn is_removed(&self) -> bool {
        auto_disable();
        // SAFETY: self is a valid *const TextChunk
        unsafe { lol_html_text_chunk_is_removed(self) }
    }
    pub fn set_user_data<T>(&self, value: Option<&mut T>) {
        auto_disable();
        // SAFETY: self is valid; value ptr or null
        unsafe { lol_html_text_chunk_user_data_set(self, value.map_or(core::ptr::null_mut(), |v| v as *mut T as *mut c_void)) }
    }
    pub fn get_user_data<T>(&self) -> Option<*mut T> {
        auto_disable();
        // SAFETY: self is valid
        let p = unsafe { lol_html_text_chunk_user_data_get(self) };
        if p.is_null() { None } else { Some(p as *mut T) }
    }
    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        // SAFETY: self is valid
        unsafe { lol_html_text_chunk_source_location_bytes(self) }
    }
}

// ─── Element ──────────────────────────────────────────────────────────────

#[repr(C)]
pub struct Element {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_element_get_attribute(element: *const Element, name: *const u8, name_len: usize) -> HTMLString;
    fn lol_html_element_has_attribute(element: *const Element, name: *const u8, name_len: usize) -> c_int;
    fn lol_html_element_set_attribute(element: *mut Element, name: *const u8, name_len: usize, value: *const u8, value_len: usize) -> c_int;
    fn lol_html_element_remove_attribute(element: *mut Element, name: *const u8, name_len: usize) -> c_int;
    fn lol_html_element_before(element: *mut Element, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_element_prepend(element: *mut Element, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_element_append(element: *mut Element, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_element_after(element: *mut Element, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_element_set_inner_content(element: *mut Element, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_element_replace(element: *mut Element, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_element_remove(element: *const Element);
    fn lol_html_element_remove_and_keep_content(element: *const Element);
    fn lol_html_element_is_removed(element: *const Element) -> bool;
    fn lol_html_element_is_self_closing(element: *const Element) -> bool;
    fn lol_html_element_can_have_content(element: *const Element) -> bool;
    fn lol_html_element_user_data_set(element: *const Element, user_data: *mut c_void);
    fn lol_html_element_user_data_get(element: *const Element) -> *mut c_void;
    fn lol_html_element_add_end_tag_handler(element: *mut Element, end_tag_handler: lol_html_end_tag_handler_t, user_data: *mut c_void) -> c_int;
    fn lol_html_element_clear_end_tag_handlers(element: *mut Element);
    fn lol_html_element_source_location_bytes(element: *const Element) -> SourceLocationBytes;

    fn lol_html_element_tag_name_get(element: *const Element) -> HTMLString;
    fn lol_html_element_tag_name_set(element: *mut Element, name: *const u8, name_len: usize) -> c_int;
    fn lol_html_element_namespace_uri_get(element: *const Element) -> *const c_char;
    fn lol_html_attributes_iterator_get(element: *const Element) -> *mut AttributeIterator;
}

impl Element {
    pub fn get_attribute(&self, name: &[u8]) -> HTMLString {
        auto_disable();
        // SAFETY: self valid; name ptr/len valid
        unsafe { lol_html_element_get_attribute(self, ptr_without_panic(name), name.len()) }
    }
    pub fn has_attribute(&self, name: &[u8]) -> Result<bool, Error> {
        auto_disable();
        // SAFETY: self valid; name ptr/len valid
        match unsafe { lol_html_element_has_attribute(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(false),
            1 => Ok(true),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn set_attribute(&mut self, name: &[u8], value: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; name/value ptr/len valid
        match unsafe { lol_html_element_set_attribute(self, ptr_without_panic(name), name.len(), ptr_without_panic(value), value.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn remove_attribute(&mut self, name: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; name ptr/len valid
        match unsafe { lol_html_element_remove_attribute(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_element_before(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn prepend(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_element_prepend(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn append(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_element_append(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_element_after(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn set_inner_content(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();

        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_element_set_inner_content(self, ptr_without_panic(content), content.len(), is_html) } {
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
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_element_replace(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn remove(&self) {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_remove(self) }
    }
    // Removes the element, but leaves its inner content intact.
    pub fn remove_and_keep_content(&self) {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_remove_and_keep_content(self) }
    }
    pub fn is_removed(&self) -> bool {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_is_removed(self) }
    }
    pub fn is_self_closing(&self) -> bool {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_is_self_closing(self) }
    }
    pub fn can_have_content(&self) -> bool {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_can_have_content(self) }
    }
    pub fn set_user_data(&self, user_data: *mut c_void) {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_user_data_set(self, user_data) }
    }
    pub fn get_user_data<T>(&self) -> Option<*mut T> {
        auto_disable();
        // SAFETY: self valid
        let p = unsafe { lol_html_element_user_data_get(self) };
        if p.is_null() { None } else { Some(p as *mut T) }
    }
    pub fn on_end_tag(&mut self, end_tag_handler: lol_html_end_tag_handler_t, user_data: *mut c_void) -> Result<(), Error> {
        auto_disable();

        // SAFETY: self valid
        unsafe { lol_html_element_clear_end_tag_handlers(self) };

        // SAFETY: self valid; handler is a valid extern "C" fn pointer
        match unsafe { lol_html_element_add_end_tag_handler(self, end_tag_handler, user_data) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn tag_name(&self) -> HTMLString {
        // SAFETY: self valid
        unsafe { lol_html_element_tag_name_get(self) }
    }

    pub fn set_tag_name(&mut self, name: &[u8]) -> Result<(), Error> {
        // SAFETY: self valid; name ptr/len valid
        match unsafe { lol_html_element_tag_name_set(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn namespace_uri(&self) -> &core::ffi::CStr {
        // SAFETY: self valid; lol-html returns a valid NUL-terminated static string
        unsafe { core::ffi::CStr::from_ptr(lol_html_element_namespace_uri_get(self)) }
    }

    pub fn attributes(&self) -> Option<*mut AttributeIterator> {
        // SAFETY: self valid
        let p = unsafe { lol_html_attributes_iterator_get(self) };
        if p.is_null() { None } else { Some(p) }
    }

    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_element_source_location_bytes(self) }
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
        // SAFETY: lol-html guarantees ptr[0..len] is valid until lol_html_str_free
        unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
    }

    extern "C" fn deinit_external(_: *mut u8, ptr: *mut c_void, len: u32) {
        auto_disable();
        // SAFETY: ptr/len were the original HTMLString fields passed to createExternal
        unsafe { lol_html_str_free(HTMLString { ptr: ptr as *const u8, len: len as usize }) };
    }

    pub fn to_string(self) -> bun_str::String {
        let bytes = self.slice();
        if !bytes.is_empty() && bun_str::strings::is_all_ascii(bytes) {
            // SAFETY: bytes.ptr is the lol-html-owned buffer; deinit_external frees it when WTFString drops
            return bun_str::String::create_external::<*mut u8>(
                bytes,
                true,
                bytes.as_ptr() as *mut u8,
                Self::deinit_external,
            );
        }
        let result = bun_str::String::clone_utf8(bytes);
        self.deinit();
        result
    }

    // `pub const toJS = @import("../runtime/api/lolhtml_jsc.zig").htmlStringToJS;`
    // — deleted per PORTING.md: *_jsc alias; to_js is an extension-trait method in bun_runtime.
}

// ─── EndTag ───────────────────────────────────────────────────────────────

#[repr(C)]
pub struct EndTag {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_end_tag_before(end_tag: *mut EndTag, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_end_tag_after(end_tag: *mut EndTag, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_end_tag_remove(end_tag: *mut EndTag);
    fn lol_html_end_tag_name_get(end_tag: *const EndTag) -> HTMLString;
    fn lol_html_end_tag_name_set(end_tag: *mut EndTag, name: *const u8, name_len: usize) -> c_int;
    fn lol_html_end_tag_source_location_bytes(end_tag: *const EndTag) -> SourceLocationBytes;
}

impl EndTag {
    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_end_tag_before(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_end_tag_after(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
    pub fn remove(&mut self) {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_end_tag_remove(self) }
    }

    pub fn get_name(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_end_tag_name_get(self) }
    }

    pub fn set_name(&mut self, name: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; name ptr/len valid
        match unsafe { lol_html_end_tag_name_set(self, ptr_without_panic(name), name.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_end_tag_source_location_bytes(self) }
    }
}

// ─── Attribute ────────────────────────────────────────────────────────────

#[repr(C)]
pub struct Attribute {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_attribute_name_get(attribute: *const Attribute) -> HTMLString;
    fn lol_html_attribute_value_get(attribute: *const Attribute) -> HTMLString;
}

impl Attribute {
    pub fn name(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_attribute_name_get(self) }
    }
    pub fn value(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_attribute_value_get(self) }
    }
}

#[repr(C)]
pub struct AttributeIterator {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_attributes_iterator_free(iterator: *mut AttributeIterator);
    fn lol_html_attributes_iterator_next(iterator: *mut AttributeIterator) -> *const Attribute;
}

impl AttributeIterator {
    pub fn next(&mut self) -> Option<&Attribute> {
        auto_disable();
        // SAFETY: self valid; returned ptr valid until next call or free
        let p = unsafe { lol_html_attributes_iterator_next(self) };
        if p.is_null() { None } else { Some(unsafe { &*p }) }
    }

    // TODO(port): opaque FFI handle — see HTMLRewriter::destroy note
    pub unsafe fn destroy(this: *mut AttributeIterator) {
        auto_disable();
        // SAFETY: caller guarantees `this` came from lol_html_attributes_iterator_get and not yet freed
        unsafe { lol_html_attributes_iterator_free(this) };
    }
}

// ─── Comment ──────────────────────────────────────────────────────────────

#[repr(C)]
pub struct Comment {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_comment_text_get(comment: *const Comment) -> HTMLString;
    fn lol_html_comment_text_set(comment: *mut Comment, text: *const u8, text_len: usize) -> c_int;
    fn lol_html_comment_before(comment: *mut Comment, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_comment_after(comment: *mut Comment, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_comment_replace(comment: *mut Comment, content: *const u8, content_len: usize, is_html: bool) -> c_int;
    fn lol_html_comment_remove(comment: *mut Comment);
    fn lol_html_comment_is_removed(comment: *const Comment) -> bool;
    fn lol_html_comment_user_data_set(comment: *const Comment, user_data: *mut c_void);
    fn lol_html_comment_user_data_get(comment: *const Comment) -> *mut c_void;
    fn lol_html_comment_source_location_bytes(comment: *const Comment) -> SourceLocationBytes;
}

impl Comment {
    pub fn get_text(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_comment_text_get(self) }
    }

    pub fn set_text(&mut self, text: &[u8]) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; text ptr/len valid
        match unsafe { lol_html_comment_text_set(self, ptr_without_panic(text), text.len()) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn before(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_comment_before(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn replace(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // PORT NOTE: Zig source calls lol_html_comment_before here (likely an upstream bug); ported faithfully
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_comment_before(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn after(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_comment_after(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }

    pub fn is_removed(&self) -> bool {
        // SAFETY: self valid
        unsafe { lol_html_comment_is_removed(self) }
    }
    pub fn remove(&mut self) {
        // SAFETY: self valid
        unsafe { lol_html_comment_remove(self) }
    }

    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_comment_source_location_bytes(self) }
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
pub type lol_html_text_handler_handler_t = unsafe extern "C" fn(*mut TextChunk, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_element_handler_t = unsafe extern "C" fn(*mut Element, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_doc_end_handler_t = unsafe extern "C" fn(*mut DocEnd, *mut c_void) -> Directive;
#[allow(non_camel_case_types)]
pub type lol_html_end_tag_handler_t = unsafe extern "C" fn(*mut EndTag, *mut c_void) -> Directive;

// ─── DocEnd ───────────────────────────────────────────────────────────────

#[repr(C)]
pub struct DocEnd {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_doc_end_append(doc_end: *mut DocEnd, content: *const u8, content_len: usize, is_html: bool) -> c_int;
}

impl DocEnd {
    pub fn append(&mut self, content: &[u8], is_html: bool) -> Result<(), Error> {
        auto_disable();
        // SAFETY: self valid; content ptr/len valid
        match unsafe { lol_html_doc_end_append(self, ptr_without_panic(content), content.len(), is_html) } {
            0 => Ok(()),
            -1 => Err(Error::Fail),
            _ => unreachable!(),
        }
    }
}

// ─── Directive handler trampolines ────────────────────────────────────────

pub type DirectiveFunctionType<Container> = unsafe extern "C" fn(*mut Container, *mut c_void) -> Directive;

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
    let result = unsafe { (&mut *(user_data as *mut U)).call(&mut *this) };
    // @enumFromInt(@intFromBool(result))
    // SAFETY: bool as c_uint is 0 or 1, both valid Directive discriminants
    unsafe { core::mem::transmute::<c_uint, Directive>(result as c_uint) }
}

// ─── DocType ──────────────────────────────────────────────────────────────

#[repr(C)]
pub struct DocType {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

unsafe extern "C" {
    fn lol_html_doctype_name_get(doctype: *const DocType) -> HTMLString;
    fn lol_html_doctype_public_id_get(doctype: *const DocType) -> HTMLString;
    fn lol_html_doctype_system_id_get(doctype: *const DocType) -> HTMLString;
    fn lol_html_doctype_user_data_set(doctype: *const DocType, user_data: *mut c_void);
    fn lol_html_doctype_user_data_get(doctype: *const DocType) -> *mut c_void;
    fn lol_html_doctype_remove(doctype: *mut DocType);
    fn lol_html_doctype_is_removed(doctype: *const DocType) -> bool;
    fn lol_html_doctype_source_location_bytes(doctype: *const DocType) -> SourceLocationBytes;
}

pub type DocTypeCallback = unsafe extern "C" fn(*mut DocType, *mut c_void) -> Directive;

impl DocType {
    pub fn get_name(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_doctype_name_get(self) }
    }
    pub fn get_public_id(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_doctype_public_id_get(self) }
    }
    pub fn get_system_id(&self) -> HTMLString {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_doctype_system_id_get(self) }
    }
    pub fn remove(&mut self) {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_doctype_remove(self) }
    }
    pub fn is_removed(&self) -> bool {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_doctype_is_removed(self) }
    }
    pub fn get_source_location_bytes(&self) -> SourceLocationBytes {
        auto_disable();
        // SAFETY: self valid
        unsafe { lol_html_doctype_source_location_bytes(self) }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/lolhtml_sys/lol_html.zig (867 lines)
//   confidence: medium
//   todos:      9
//   notes:      comptime fn-value handler/sink generics modeled as traits; opaque FFI frees kept as `unsafe fn destroy(*mut Self)` (Phase B: owning wrappers + Drop); Comment::replace faithfully mirrors upstream bug calling _before
// ──────────────────────────────────────────────────────────────────────────
