pub const Error = error{Fail};
const std = @import("std");
const bun = @import("root").bun;
pub const MemorySettings = extern struct {
    preallocated_parsing_buffer_size: usize,
    max_allowed_memory_usage: usize,
};

inline fn auto_disable() void {
    if (comptime bun.FeatureFlags.disable_lolhtml)
        unreachable;
}

/// rust panics if the pointer itself is zero, even if the passed length is zero
/// to work around that, we use a static null-terminated pointer
/// https://github.com/oven-sh/bun/issues/2323
fn ptrWithoutPanic(buf: []const u8) [*]const u8 {
    const null_terminated_ptr = struct {
        // we must use a static pointer so the lifetime of this pointer is long enough
        const null_terminated_ptr: []const u8 = &[_]u8{0};
    }.null_terminated_ptr;

    if (buf.len == 0)
        return null_terminated_ptr.ptr;

    return buf.ptr;
}

pub const HTMLRewriter = opaque {
    extern fn lol_html_rewriter_write(rewriter: *HTMLRewriter, chunk: [*]const u8, chunk_len: usize) c_int;
    extern fn lol_html_rewriter_end(rewriter: *HTMLRewriter) c_int;
    extern fn lol_html_rewriter_free(rewriter: *HTMLRewriter) void;

    pub fn write(rewriter: *HTMLRewriter, chunk: []const u8) Error!void {
        auto_disable();
        if (rewriter.lol_html_rewriter_write(ptrWithoutPanic(chunk), chunk.len) < 0)
            return error.Fail;
    }

    /// Completes rewriting and flushes the remaining output.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    ///
    /// WARNING: after calling this function, further attempts to use the rewriter
    /// (other than `lol_html_rewriter_free`) will cause a thread panic.
    pub fn end(rewriter: *HTMLRewriter) Error!void {
        auto_disable();

        if (rewriter.lol_html_rewriter_end() < 0)
            return error.Fail;
    }

    pub fn deinit(this: *HTMLRewriter) void {
        auto_disable();
        this.lol_html_rewriter_free();
    }

    pub const Builder = opaque {
        extern fn lol_html_rewriter_builder_new() *HTMLRewriter.Builder;
        extern fn lol_html_rewriter_builder_add_element_content_handlers(
            builder: *HTMLRewriter.Builder,
            selector: *const HTMLSelector,
            element_handler: ?lol_html_element_handler_t,
            element_handler_user_data: ?*anyopaque,
            comment_handler: ?lol_html_comment_handler_t,
            comment_handler_user_data: ?*anyopaque,
            text_handler: ?lol_html_text_handler_handler_t,
            text_handler_user_data: ?*anyopaque,
        ) c_int;
        extern fn lol_html_rewriter_builder_free(builder: *HTMLRewriter.Builder) void;
        extern fn lol_html_rewriter_build(
            builder: *HTMLRewriter.Builder,
            encoding: [*]const u8,
            encoding_len: usize,
            memory_settings: MemorySettings,
            output_sink: ?*const fn ([*]const u8, usize, *anyopaque) callconv(.C) void,
            output_sink_user_data: *anyopaque,
            strict: bool,
        ) ?*HTMLRewriter;
        extern fn unstable_lol_html_rewriter_build_with_esi_tags(
            builder: *HTMLRewriter.Builder,
            encoding: [*]const u8,
            encoding_len: usize,
            memory_settings: MemorySettings,
            output_sink: ?*const fn ([*]const u8, usize, *anyopaque) callconv(.C) void,
            output_sink_user_data: *anyopaque,
            strict: bool,
        ) ?*HTMLRewriter;

        pub fn deinit(this: *HTMLRewriter.Builder) void {
            auto_disable();
            this.lol_html_rewriter_builder_free();
        }

        extern fn lol_html_rewriter_builder_add_document_content_handlers(
            builder: *HTMLRewriter.Builder,
            doctype_handler: ?DirectiveFunctionType(DocType),
            doctype_handler_user_data: ?*anyopaque,
            comment_handler: ?lol_html_comment_handler_t,
            comment_handler_user_data: ?*anyopaque,
            text_handler: ?lol_html_text_handler_handler_t,
            text_handler_user_data: ?*anyopaque,
            doc_end_handler: ?lol_html_doc_end_handler_t,
            doc_end_user_data: ?*anyopaque,
        ) void;

        pub fn init() *HTMLRewriter.Builder {
            auto_disable();
            return lol_html_rewriter_builder_new();
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
        pub fn addDocumentContentHandlers(
            builder: *HTMLRewriter.Builder,
            comptime DocTypeHandler: type,
            comptime doctype_handler: ?DirectiveFunctionTypeForHandler(DocType, DocTypeHandler),
            doctype_handler_data: ?*DocTypeHandler,
            comptime CommentHandler: type,
            comptime comment_handler: ?DirectiveFunctionTypeForHandler(Comment, CommentHandler),
            comment_handler_data: ?*CommentHandler,
            comptime TextChunkHandler: type,
            comptime text_chunk_handler: ?DirectiveFunctionTypeForHandler(TextChunk, TextChunkHandler),
            text_chunk_handler_data: ?*TextChunkHandler,
            comptime DocEndHandler: type,
            comptime end_tag_handler: ?DirectiveFunctionTypeForHandler(DocEnd, DocEndHandler),
            end_tag_handler_data: ?*DocEndHandler,
        ) void {
            auto_disable();

            builder.lol_html_rewriter_builder_add_document_content_handlers(
                if (doctype_handler_data != null)
                    DirectiveHandler(DocType, DocTypeHandler, doctype_handler.?)
                else
                    null,
                doctype_handler_data,
                if (comment_handler_data != null)
                    DirectiveHandler(Comment, CommentHandler, comment_handler.?)
                else
                    null,
                comment_handler_data,
                if (text_chunk_handler_data != null)
                    DirectiveHandler(TextChunk, TextChunkHandler, text_chunk_handler.?)
                else
                    null,
                text_chunk_handler_data,
                if (end_tag_handler_data != null)
                    DirectiveHandler(DocEnd, DocEndHandler, end_tag_handler.?)
                else
                    null,
                end_tag_handler_data,
            );
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
        pub fn addElementContentHandlers(
            builder: *HTMLRewriter.Builder,
            selector: *HTMLSelector,
            comptime ElementHandler: type,
            comptime element_handler: ?DirectiveFunctionTypeForHandler(Element, ElementHandler),
            element_handler_data: ?*ElementHandler,
            comptime CommentHandler: type,
            comptime comment_handler: ?DirectiveFunctionTypeForHandler(Comment, CommentHandler),
            comment_handler_data: ?*CommentHandler,
            comptime TextChunkHandler: type,
            comptime text_chunk_handler: ?DirectiveFunctionTypeForHandler(TextChunk, TextChunkHandler),
            text_chunk_handler_data: ?*TextChunkHandler,
        ) Error!void {
            auto_disable();
            return switch (builder.lol_html_rewriter_builder_add_element_content_handlers(
                selector,
                if (element_handler_data != null)
                    DirectiveHandler(Element, ElementHandler, element_handler.?)
                else
                    null,
                element_handler_data,
                if (comment_handler_data != null)
                    DirectiveHandler(Comment, CommentHandler, comment_handler.?)
                else
                    null,
                comment_handler_data,
                if (text_chunk_handler_data != null)
                    DirectiveHandler(TextChunk, TextChunkHandler, text_chunk_handler.?)
                else
                    null,
                text_chunk_handler_data,
            )) {
                -1 => error.Fail,
                0 => {},
                else => unreachable,
            };
        }

        pub fn build(
            builder: *HTMLRewriter.Builder,
            encoding: Encoding,
            memory_settings: MemorySettings,
            strict: bool,
            comptime OutputSink: type,
            output_sink: *OutputSink,
            comptime Writer: (fn (*OutputSink, bytes: []const u8) void),
            comptime Done: (fn (*OutputSink) void),
        ) Error!*HTMLRewriter {
            auto_disable();

            const encoding_ = Encoding.label.getAssertContains(encoding);
            return builder.lol_html_rewriter_build(
                encoding_.ptr,
                encoding_.len,
                memory_settings,
                OutputSinkFunction(OutputSink, Writer, Done),
                output_sink,
                strict,
            ) orelse return error.Fail;
        }

        fn OutputSinkFunction(
            comptime OutputSinkType: type,
            comptime Writer: (fn (*OutputSinkType, bytes: []const u8) void),
            comptime Done: (fn (*OutputSinkType) void),
        ) (fn ([*]const u8, usize, *anyopaque) callconv(.C) void) {
            return struct {
                fn writeChunk(ptr: [*]const u8, len: usize, user_data: *anyopaque) callconv(.C) void {
                    auto_disable();

                    @setRuntimeSafety(false);
                    const this = @as(*OutputSinkType, @ptrCast(@alignCast(user_data)));
                    switch (len) {
                        0 => Done(this),
                        else => Writer(this, ptr[0..len]),
                    }
                }
            }.writeChunk;
        }
    };
};

pub const HTMLSelector = opaque {
    extern fn lol_html_selector_parse(selector: [*]const u8, selector_len: usize) ?*HTMLSelector;
    extern fn lol_html_selector_free(selector: *HTMLSelector) void;

    /// Frees the memory held by the parsed selector object.
    pub fn deinit(selector: *HTMLSelector) void {
        auto_disable();
        selector.lol_html_selector_free();
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
    pub fn parse(selector: []const u8) Error!*HTMLSelector {
        auto_disable();

        if (lol_html_selector_parse(ptrWithoutPanic(selector), selector.len)) |ptr|
            return ptr
        else
            return error.Fail;
    }
};
pub const TextChunk = opaque {
    extern fn lol_html_text_chunk_content_get(chunk: *const TextChunk) TextChunk.Content;
    extern fn lol_html_text_chunk_is_last_in_text_node(chunk: *const TextChunk) bool;
    extern fn lol_html_text_chunk_before(chunk: *TextChunk, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_text_chunk_after(chunk: *TextChunk, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_text_chunk_replace(chunk: *TextChunk, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_text_chunk_remove(chunk: *TextChunk) void;
    extern fn lol_html_text_chunk_is_removed(chunk: *const TextChunk) bool;
    extern fn lol_html_text_chunk_user_data_set(chunk: *const TextChunk, user_data: ?*anyopaque) void;
    extern fn lol_html_text_chunk_user_data_get(chunk: *const TextChunk) ?*anyopaque;

    pub const Content = extern struct {
        ptr: [*]const u8,
        len: usize,

        pub fn slice(this: Content) []const u8 {
            auto_disable();
            return this.ptr[0..this.len];
        }
    };

    pub fn getContent(this: *const TextChunk) TextChunk.Content {
        auto_disable();
        return this.lol_html_text_chunk_content_get();
    }
    pub fn isLastInTextNode(this: *const TextChunk) bool {
        auto_disable();
        return this.lol_html_text_chunk_is_last_in_text_node();
    }
    /// Inserts the content string before the text chunk either as raw text or as HTML.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn before(this: *TextChunk, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        if (this.lol_html_text_chunk_before(ptrWithoutPanic(content), content.len, is_html) < 0)
            return error.Fail;
    }
    /// Inserts the content string after the text chunk either as raw text or as HTML.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn after(this: *TextChunk, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        if (this.lol_html_text_chunk_after(ptrWithoutPanic(content), content.len, is_html) < 0)
            return error.Fail;
    }
    // Replace the text chunk with the content of the string which is interpreted
    // either as raw text or as HTML.
    //
    // Content should be a valid UTF8-string.
    //
    // Returns 0 in case of success and -1 otherwise. The actual error message
    // can be obtained using `lol_html_take_last_error` function.
    pub fn replace(this: *TextChunk, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        if (this.lol_html_text_chunk_replace(ptrWithoutPanic(content), content.len, is_html) < 0)
            return error.Fail;
    }
    /// Removes the text chunk.
    pub fn remove(this: *TextChunk) void {
        auto_disable();
        return this.lol_html_text_chunk_remove();
    }
    pub fn isRemoved(this: *const TextChunk) bool {
        auto_disable();
        return this.lol_html_text_chunk_is_removed();
    }
    pub fn setUserData(this: *const TextChunk, comptime Type: type, value: ?*Type) void {
        auto_disable();
        return this.lol_html_text_chunk_user_data_set(value);
    }
    pub fn getUserData(this: *const TextChunk, comptime Type: type) ?*Type {
        auto_disable();
        return @as(?*Type, @ptrCast(@alignCast(this.lol_html_text_chunk_user_data_get())));
    }
};
pub const Element = opaque {
    extern fn lol_html_element_get_attribute(element: *const Element, name: [*]const u8, name_len: usize) HTMLString;
    extern fn lol_html_element_has_attribute(element: *const Element, name: [*]const u8, name_len: usize) c_int;
    extern fn lol_html_element_set_attribute(element: *Element, name: [*]const u8, name_len: usize, value: [*]const u8, value_len: usize) c_int;
    extern fn lol_html_element_remove_attribute(element: *Element, name: [*]const u8, name_len: usize) c_int;
    extern fn lol_html_element_before(element: *Element, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_element_prepend(element: *Element, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_element_append(element: *Element, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_element_after(element: *Element, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_element_set_inner_content(element: *Element, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_element_replace(element: *Element, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_element_remove(element: *const Element) void;
    extern fn lol_html_element_remove_and_keep_content(element: *const Element) void;
    extern fn lol_html_element_is_removed(element: *const Element) bool;
    extern fn lol_html_element_is_self_closing(element: *const Element) bool;
    extern fn lol_html_element_can_have_content(element: *const Element) bool;
    extern fn lol_html_element_user_data_set(element: *const Element, user_data: ?*anyopaque) void;
    extern fn lol_html_element_user_data_get(element: *const Element) ?*anyopaque;
    extern fn lol_html_element_add_end_tag_handler(element: *Element, end_tag_handler: lol_html_end_tag_handler_t, user_data: ?*anyopaque) c_int;
    extern fn lol_html_element_clear_end_tag_handlers(element: *Element) void;

    pub fn getAttribute(element: *const Element, name: []const u8) HTMLString {
        auto_disable();
        return lol_html_element_get_attribute(element, ptrWithoutPanic(name), name.len);
    }
    pub fn hasAttribute(element: *const Element, name: []const u8) Error!bool {
        auto_disable();
        return switch (lol_html_element_has_attribute(element, ptrWithoutPanic(name), name.len)) {
            0 => false,
            1 => true,
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn setAttribute(element: *Element, name: []const u8, value: []const u8) Error!void {
        auto_disable();
        return switch (lol_html_element_set_attribute(element, ptrWithoutPanic(name), name.len, ptrWithoutPanic(value), value.len)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn removeAttribute(element: *Element, name: []const u8) Error!void {
        auto_disable();
        return switch (lol_html_element_remove_attribute(element, ptrWithoutPanic(name), name.len)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn before(element: *Element, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_element_before(element, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn prepend(element: *Element, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_element_prepend(element, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn append(element: *Element, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_element_append(element, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn after(element: *Element, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_element_after(element, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn setInnerContent(element: *Element, content: []const u8, is_html: bool) Error!void {
        auto_disable();

        return switch (lol_html_element_set_inner_content(element, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    /// Replaces the element with the provided text or HTML content.
    ///
    /// Content should be a valid UTF8-string.
    ///
    /// Returns 0 in case of success and -1 otherwise. The actual error message
    /// can be obtained using `lol_html_take_last_error` function.
    pub fn replace(element: *Element, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_element_replace(element, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn remove(element: *const Element) void {
        auto_disable();
        lol_html_element_remove(element);
    }
    // Removes the element, but leaves its inner content intact.
    pub fn removeAndKeepContent(element: *const Element) void {
        auto_disable();
        lol_html_element_remove_and_keep_content(element);
    }
    pub fn isRemoved(element: *const Element) bool {
        auto_disable();
        return lol_html_element_is_removed(element);
    }
    pub fn isSelfClosing(element: *const Element) bool {
        auto_disable();
        return lol_html_element_is_self_closing(element);
    }
    pub fn canHaveContent(element: *const Element) bool {
        auto_disable();
        return lol_html_element_can_have_content(element);
    }
    pub fn setUserData(element: *const Element, user_data: ?*anyopaque) void {
        auto_disable();
        lol_html_element_user_data_set(element, user_data);
    }
    pub fn getUserData(element: *const Element, comptime Type: type) ?*Type {
        auto_disable();
        return @as(?*Element, @ptrCast(@alignCast(lol_html_element_user_data_get(element))));
    }
    pub fn onEndTag(element: *Element, end_tag_handler: lol_html_end_tag_handler_t, user_data: ?*anyopaque) Error!void {
        auto_disable();

        lol_html_element_clear_end_tag_handlers(element);

        return switch (lol_html_element_add_end_tag_handler(element, end_tag_handler, user_data)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    extern fn lol_html_element_tag_name_get(element: *const Element) HTMLString;
    extern fn lol_html_element_tag_name_set(element: *Element, name: [*]const u8, name_len: usize) c_int;
    extern fn lol_html_element_namespace_uri_get(element: *const Element) [*:0]const u8;
    extern fn lol_html_attributes_iterator_get(element: *const Element) ?*Attribute.Iterator;

    pub fn tagName(element: *const Element) HTMLString {
        return lol_html_element_tag_name_get(element);
    }

    pub fn setTagName(element: *Element, name: []const u8) Error!void {
        return switch (lol_html_element_tag_name_set(element, ptrWithoutPanic(name), name.len)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    pub fn namespaceURI(element: *const Element) [*:0]const u8 {
        return lol_html_element_namespace_uri_get(element);
    }

    pub fn attributes(element: *const Element) ?*Attribute.Iterator {
        return lol_html_attributes_iterator_get(element);
    }
};

pub const HTMLString = extern struct {
    ptr: [*]const u8,
    len: usize,

    extern fn lol_html_str_free(str: HTMLString) void;
    pub fn deinit(this: HTMLString) void {
        auto_disable();
        // if (this.len > 0) {
        lol_html_str_free(this);
        // }
    }

    pub extern fn lol_html_take_last_error(...) HTMLString;

    pub fn lastError() HTMLString {
        auto_disable();
        return lol_html_take_last_error();
    }

    pub fn slice(this: HTMLString) []const u8 {
        auto_disable();
        @setRuntimeSafety(false);
        return this.ptr[0..this.len];
    }

    fn deinit_external(ctx: *anyopaque, ptr: *anyopaque, len: u32) callconv(.C) void {
        _ = ctx;
        auto_disable();
        lol_html_str_free(.{ .ptr = @as([*]const u8, @ptrCast(ptr)), .len = len });
    }

    pub fn toString(this: HTMLString) bun.String {
        const bytes = this.slice();
        if (bytes.len > 0 and bun.strings.isAllASCII(bytes)) {
            return bun.String.createExternal(bytes, true, @constCast(bytes.ptr), &deinit_external);
        }
        defer this.deinit();
        return bun.String.createUTF8(bytes);
    }

    pub fn toJS(this: HTMLString, globalThis: *bun.JSC.JSGlobalObject) bun.JSC.JSValue {
        var str = this.toString();
        defer str.deref();
        return str.toJS(globalThis);
    }
};

pub const EndTag = opaque {
    extern fn lol_html_end_tag_before(end_tag: *EndTag, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_end_tag_after(end_tag: *EndTag, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_end_tag_remove(end_tag: *EndTag) void;
    extern fn lol_html_end_tag_name_get(end_tag: *const EndTag) HTMLString;
    extern fn lol_html_end_tag_name_set(end_tag: *EndTag, name: [*]const u8, name_len: usize) c_int;

    pub fn before(end_tag: *EndTag, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_end_tag_before(end_tag, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    pub fn after(end_tag: *EndTag, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_end_tag_after(end_tag, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
    pub fn remove(end_tag: *EndTag) void {
        auto_disable();
        lol_html_end_tag_remove(end_tag);
    }

    pub fn getName(end_tag: *const EndTag) HTMLString {
        auto_disable();
        return lol_html_end_tag_name_get(end_tag);
    }

    pub fn setName(end_tag: *EndTag, name: []const u8) Error!void {
        auto_disable();
        return switch (lol_html_end_tag_name_set(end_tag, ptrWithoutPanic(name), name.len)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
};

pub const Attribute = opaque {
    extern fn lol_html_attribute_name_get(attribute: *const Attribute) HTMLString;
    extern fn lol_html_attribute_value_get(attribute: *const Attribute) HTMLString;
    pub fn name(this: *const Attribute) HTMLString {
        auto_disable();
        return this.lol_html_attribute_name_get();
    }
    pub fn value(this: *const Attribute) HTMLString {
        auto_disable();
        return this.lol_html_attribute_value_get();
    }

    pub const Iterator = opaque {
        extern fn lol_html_attributes_iterator_free(iterator: *Attribute.Iterator) void;
        extern fn lol_html_attributes_iterator_next(iterator: *Attribute.Iterator) ?*const Attribute;

        pub fn next(this: *Iterator) ?*const Attribute {
            auto_disable();
            return lol_html_attributes_iterator_next(this);
        }

        pub fn deinit(this: *Iterator) void {
            auto_disable();
            lol_html_attributes_iterator_free(this);
        }
    };
};

pub const Comment = opaque {
    extern fn lol_html_comment_text_get(comment: *const Comment) HTMLString;
    extern fn lol_html_comment_text_set(comment: *Comment, text: [*]const u8, text_len: usize) c_int;
    extern fn lol_html_comment_before(comment: *Comment, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_comment_after(comment: *Comment, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_comment_replace(comment: *Comment, content: [*]const u8, content_len: usize, is_html: bool) c_int;
    extern fn lol_html_comment_remove(comment: *Comment) void;
    extern fn lol_html_comment_is_removed(comment: *const Comment) bool;
    extern fn lol_html_comment_user_data_set(comment: *const Comment, user_data: ?*anyopaque) void;
    extern fn lol_html_comment_user_data_get(comment: *const Comment) ?*anyopaque;

    pub fn getText(comment: *const Comment) HTMLString {
        auto_disable();
        return lol_html_comment_text_get(comment);
    }

    pub fn setText(comment: *Comment, text: []const u8) Error!void {
        auto_disable();
        return switch (lol_html_comment_text_set(comment, ptrWithoutPanic(text), text.len)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    pub fn before(comment: *Comment, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_comment_before(comment, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    pub fn replace(comment: *Comment, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_comment_before(comment, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    pub fn after(comment: *Comment, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_comment_after(comment, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }

    pub const isRemoved = lol_html_comment_is_removed;
    pub const remove = lol_html_comment_remove;
};

pub const Directive = enum(c_uint) {
    stop = 0,
    @"continue" = 1,
};
pub const lol_html_comment_handler_t = *const fn (*Comment, ?*anyopaque) callconv(.C) Directive;
pub const lol_html_text_handler_handler_t = *const fn (*TextChunk, ?*anyopaque) callconv(.C) Directive;
pub const lol_html_element_handler_t = *const fn (*Element, ?*anyopaque) callconv(.C) Directive;
pub const lol_html_doc_end_handler_t = *const fn (*DocEnd, ?*anyopaque) callconv(.C) Directive;
pub const lol_html_end_tag_handler_t = *const fn (*EndTag, ?*anyopaque) callconv(.C) Directive;
pub const DocEnd = opaque {
    extern fn lol_html_doc_end_append(doc_end: ?*DocEnd, content: [*]const u8, content_len: usize, is_html: bool) c_int;

    pub fn append(this: *DocEnd, content: []const u8, is_html: bool) Error!void {
        auto_disable();
        return switch (lol_html_doc_end_append(this, ptrWithoutPanic(content), content.len, is_html)) {
            0 => {},
            -1 => error.Fail,
            else => unreachable,
        };
    }
};

fn DirectiveFunctionType(comptime Container: type) type {
    return *const fn (*Container, ?*anyopaque) callconv(.C) Directive;
}

fn DirectiveFunctionTypeForHandler(comptime Container: type, comptime UserDataType: type) type {
    return *const fn (*UserDataType, *Container) bool;
}

fn DocTypeHandlerCallback(comptime UserDataType: type) type {
    return *const fn (*DocType, *UserDataType) bool;
}

pub fn DirectiveHandler(comptime Container: type, comptime UserDataType: type, comptime Callback: (*const fn (this: *UserDataType, container: *Container) bool)) DirectiveFunctionType(Container) {
    return struct {
        pub fn callback(this: *Container, user_data: ?*anyopaque) callconv(.C) Directive {
            auto_disable();
            return @as(
                Directive,
                @enumFromInt(@as(
                    c_uint,
                    @intFromBool(
                        Callback(
                            @as(
                                *UserDataType,
                                @ptrCast(@alignCast(
                                    user_data.?,
                                )),
                            ),
                            this,
                        ),
                    ),
                )),
            );
        }
    }.callback;
}

pub const DocType = opaque {
    extern fn lol_html_doctype_name_get(doctype: *const DocType) HTMLString;
    extern fn lol_html_doctype_public_id_get(doctype: *const DocType) HTMLString;
    extern fn lol_html_doctype_system_id_get(doctype: *const DocType) HTMLString;
    extern fn lol_html_doctype_user_data_set(doctype: *const DocType, user_data: ?*anyopaque) void;
    extern fn lol_html_doctype_user_data_get(doctype: *const DocType) ?*anyopaque;

    pub const Callback = *const fn (*DocType, ?*anyopaque) callconv(.C) Directive;

    pub fn getName(this: *const DocType) HTMLString {
        auto_disable();
        return this.lol_html_doctype_name_get();
    }
    pub fn getPublicId(this: *const DocType) HTMLString {
        auto_disable();
        return this.lol_html_doctype_public_id_get();
    }
    pub fn getSystemId(this: *const DocType) HTMLString {
        auto_disable();
        return this.lol_html_doctype_system_id_get();
    }
};

pub const Encoding = enum {
    UTF8,
    UTF16,

    const Label = std.enums.EnumMap(Encoding, []const u8);
    pub const label: Label = brk: {
        var labels = Label{};
        labels.put(.UTF8, "UTF-8");
        labels.put(.UTF16, "UTF-16");

        break :brk labels;
    };
};
