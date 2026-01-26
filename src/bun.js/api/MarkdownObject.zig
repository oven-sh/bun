pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 2);
    object.put(
        globalThis,
        ZigString.static("html"),
        jsc.JSFunction.create(globalThis, "html", renderToHTML, 1, .{}),
    );
    object.put(
        globalThis,
        ZigString.static("render"),
        jsc.JSFunction.create(globalThis, "render", render, 2, .{}),
    );
    return object;
}

pub fn renderToHTML(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const input_value, const opts_value = callframe.argumentsAsArray(2);

    if (input_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    }

    const buffer = try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, input_value) orelse {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    };
    defer buffer.deinit();

    const input = buffer.slice();

    const options = try parseOptions(globalThis, opts_value);

    const result = md.renderToHtmlWithOptions(input, bun.default_allocator, options) catch {
        return globalThis.throwOutOfMemory();
    };
    defer bun.default_allocator.free(result);

    return bun.String.createUTF8ForJS(globalThis, result);
}

pub fn render(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const input_value, const opts_value = callframe.argumentsAsArray(2);

    if (input_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    }

    const buffer = try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, input_value) orelse {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    };
    defer buffer.deinit();

    const input = buffer.slice();

    // Get callbacks object (second argument)
    const opts = if (opts_value.isObject()) opts_value else .js_undefined;

    // Parse parser options (tables, strikethrough, etc.)
    const options = try parseOptions(globalThis, opts_value);

    // Create JS callback renderer
    var js_renderer = JsCallbackRenderer{
        .globalObject = globalThis,
        .allocator = bun.default_allocator,
        .src_text = input,
        .heading_ids = options.heading_ids,
    };
    js_renderer.stack.append(bun.default_allocator, .{}) catch {
        return globalThis.throwOutOfMemory();
    };
    defer js_renderer.deinit();

    try js_renderer.extractCallbacks(opts);

    // Run parser with the JS callback renderer
    md.renderWithRenderer(input, bun.default_allocator, options, js_renderer.renderer()) catch {
        return globalThis.throwOutOfMemory();
    };

    if (js_renderer.has_js_error) {
        return error.JSError;
    }

    // Return accumulated result
    const result = js_renderer.getResult();
    return bun.String.createUTF8ForJS(globalThis, result);
}

fn parseOptions(globalThis: *jsc.JSGlobalObject, opts_value: JSValue) bun.JSError!md.Options {
    var options: md.Options = .{};
    if (opts_value.isObject()) {
        inline for (@typeInfo(md.Options).@"struct".fields) |field| {
            if (field.type == bool) {
                if (try opts_value.getBooleanLoose(globalThis, comptime camelCaseOf(field.name))) |val| {
                    @field(options, field.name) = val;
                } else if (comptime !std.mem.eql(u8, camelCaseOf(field.name), field.name)) {
                    if (try opts_value.getBooleanLoose(globalThis, field.name)) |val| {
                        @field(options, field.name) = val;
                    }
                }
            }
        }
    }
    return options;
}

fn camelCaseOf(comptime snake: []const u8) []const u8 {
    return comptime brk: {
        var count: usize = 0;
        for (snake) |c| {
            if (c != '_') count += 1;
        }
        if (count == snake.len) break :brk snake; // no underscores

        var buf: [count]u8 = undefined;
        var i: usize = 0;
        var cap_next = false;
        for (snake) |c| {
            if (c == '_') {
                cap_next = true;
            } else {
                buf[i] = if (cap_next and c >= 'a' and c <= 'z') c - 32 else c;
                i += 1;
                cap_next = false;
            }
        }
        const final = buf;
        break :brk &final;
    };
}

/// Renderer that calls JavaScript callbacks for each markdown element.
/// Uses a content-stack pattern: each enter pushes a new buffer, text
/// appends to the top buffer, and each leave pops the buffer, calls
/// the JS callback with the accumulated children, and appends the
/// callback's return value to the parent buffer.
const JsCallbackRenderer = struct {
    globalObject: *jsc.JSGlobalObject,
    allocator: std.mem.Allocator,
    src_text: []const u8,
    stack: std.ArrayListUnmanaged(StackEntry) = .{},
    callbacks: Callbacks = .{},
    has_js_error: bool = false,
    heading_ids: bool = false,
    in_heading_block: bool = false,
    heading_text_buf: std.ArrayListUnmanaged(u8) = .{},
    slug_counts: bun.StringHashMapUnmanaged(u32) = .{},

    const Callbacks = struct {
        heading: JSValue = .zero,
        paragraph: JSValue = .zero,
        blockquote: JSValue = .zero,
        code: JSValue = .zero,
        list: JSValue = .zero,
        listItem: JSValue = .zero,
        hr: JSValue = .zero,
        table: JSValue = .zero,
        thead: JSValue = .zero,
        tbody: JSValue = .zero,
        tr: JSValue = .zero,
        th: JSValue = .zero,
        td: JSValue = .zero,
        html: JSValue = .zero,
        strong: JSValue = .zero,
        emphasis: JSValue = .zero,
        link: JSValue = .zero,
        image: JSValue = .zero,
        codespan: JSValue = .zero,
        strikethrough: JSValue = .zero,
        text: JSValue = .zero,
    };

    const StackEntry = struct {
        buffer: std.ArrayListUnmanaged(u8) = .{},
        data: u32 = 0,
        flags: u32 = 0,
        detail: md.SpanDetail = .{},
    };

    fn extractCallbacks(self: *JsCallbackRenderer, opts: JSValue) bun.JSError!void {
        if (opts.isUndefinedOrNull() or !opts.isObject()) return;
        inline for (@typeInfo(Callbacks).@"struct".fields) |field| {
            if (try opts.getTruthy(self.globalObject, field.name)) |val| {
                if (val.isCallable()) {
                    @field(self.callbacks, field.name) = val;
                }
            }
        }
    }

    fn deinit(self: *JsCallbackRenderer) void {
        for (self.stack.items) |*entry| {
            entry.buffer.deinit(self.allocator);
        }
        self.stack.deinit(self.allocator);
        self.heading_text_buf.deinit(self.allocator);
        var it = self.slug_counts.iterator();
        while (it.next()) |entry| {
            self.allocator.free(@constCast(entry.key_ptr.*));
        }
        self.slug_counts.deinit(self.allocator);
    }

    fn renderer(self: *JsCallbackRenderer) md.Renderer {
        return .{ .ptr = self, .vtable = &vtable };
    }

    const vtable: md.Renderer.VTable = .{
        .enterBlock = enterBlockImpl,
        .leaveBlock = leaveBlockImpl,
        .enterSpan = enterSpanImpl,
        .leaveSpan = leaveSpanImpl,
        .text = textImpl,
    };

    // ========================================
    // Content stack operations
    // ========================================

    fn appendToTop(self: *JsCallbackRenderer, data: []const u8) void {
        if (self.stack.items.len == 0) return;
        const top = &self.stack.items[self.stack.items.len - 1];
        top.buffer.appendSlice(self.allocator, data) catch {
            self.has_js_error = true;
        };
    }

    fn popAndCallback(self: *JsCallbackRenderer, callback: JSValue, meta: ?JSValue) void {
        if (self.stack.items.len <= 1) return; // don't pop root
        var entry = self.stack.pop() orelse return;
        defer entry.buffer.deinit(self.allocator);

        const children = entry.buffer.items;

        if (callback == .zero or self.has_js_error) {
            // No callback registered - pass children through to parent
            self.appendToTop(children);
            return;
        }

        // Convert children to JS string
        const children_js = bun.String.createUTF8ForJS(self.globalObject, children) catch {
            self.has_js_error = true;
            self.appendToTop(children);
            return;
        };

        // Call the JS callback
        const result = if (meta) |m|
            callback.call(self.globalObject, .js_undefined, &[_]JSValue{ children_js, m })
        else
            callback.call(self.globalObject, .js_undefined, &[_]JSValue{children_js});

        if (result) |res| {
            if (res.isUndefinedOrNull()) return; // callback returned null/undefined → omit element
            const slice = res.toSlice(self.globalObject, self.allocator) catch {
                self.has_js_error = true;
                return;
            };
            defer slice.deinit();
            self.appendToTop(slice.slice());
        } else |_| {
            self.has_js_error = true;
        }
    }

    fn getResult(self: *JsCallbackRenderer) []const u8 {
        if (self.stack.items.len == 0) return "";
        return self.stack.items[0].buffer.items;
    }

    // ========================================
    // VTable implementation
    // ========================================

    fn enterBlockImpl(ptr: *anyopaque, block_type: md.BlockType, data: u32, flags: u32) void {
        const self: *JsCallbackRenderer = @ptrCast(@alignCast(ptr));
        if (self.has_js_error) return;
        if (block_type == .doc) return;
        if (block_type == .h and self.heading_ids) {
            self.in_heading_block = true;
        }
        self.stack.append(self.allocator, .{ .data = data, .flags = flags }) catch {
            self.has_js_error = true;
        };
    }

    fn leaveBlockImpl(ptr: *anyopaque, block_type: md.BlockType, _: u32) void {
        const self: *JsCallbackRenderer = @ptrCast(@alignCast(ptr));
        if (self.has_js_error) return;
        if (block_type == .doc) return;

        if (block_type == .h) {
            self.in_heading_block = false;
        }

        const callback = self.getBlockCallback(block_type);
        const saved = if (self.stack.items.len > 1)
            self.stack.items[self.stack.items.len - 1]
        else
            StackEntry{};
        const meta = self.createBlockMeta(block_type, saved.data, saved.flags);
        self.popAndCallback(callback, meta);

        if (block_type == .h) {
            self.heading_text_buf.clearRetainingCapacity();
        }
    }

    fn enterSpanImpl(ptr: *anyopaque, _: md.SpanType, detail: md.SpanDetail) void {
        const self: *JsCallbackRenderer = @ptrCast(@alignCast(ptr));
        if (self.has_js_error) return;
        self.stack.append(self.allocator, .{ .detail = detail }) catch {
            self.has_js_error = true;
        };
    }

    fn leaveSpanImpl(ptr: *anyopaque, span_type: md.SpanType) void {
        const self: *JsCallbackRenderer = @ptrCast(@alignCast(ptr));
        if (self.has_js_error) return;

        const callback = self.getSpanCallback(span_type);
        const detail = if (self.stack.items.len > 1)
            self.stack.items[self.stack.items.len - 1].detail
        else
            md.SpanDetail{};
        const meta = self.createSpanMeta(span_type, detail);
        self.popAndCallback(callback, meta);
    }

    fn textImpl(ptr: *anyopaque, text_type: md.TextType, content: []const u8) void {
        const self: *JsCallbackRenderer = @ptrCast(@alignCast(ptr));
        if (self.has_js_error) return;

        // Track plain text for slug generation when inside a heading
        if (self.in_heading_block) {
            switch (text_type) {
                .null_char => self.appendHeadingText("\xEF\xBF\xBD"),
                .br, .softbr => self.appendHeadingText(" "),
                .html => {}, // skip HTML tags in slug
                .entity => self.appendEntityToHeadingText(content),
                else => self.appendHeadingText(content),
            }
        }

        switch (text_type) {
            .null_char => self.appendToTop("\xEF\xBF\xBD"),
            .br => self.appendToTop("\n"),
            .softbr => self.appendToTop("\n"),
            .entity => self.decodeAndAppendEntity(content),
            else => {
                if (self.callbacks.text != .zero) {
                    self.callTextCallback(content);
                } else {
                    self.appendToTop(content);
                }
            },
        }
    }

    // ========================================
    // Text helpers
    // ========================================

    fn callTextCallback(self: *JsCallbackRenderer, content: []const u8) void {
        const text_js = bun.String.createUTF8ForJS(self.globalObject, content) catch {
            self.has_js_error = true;
            return;
        };
        const result = self.callbacks.text.call(self.globalObject, .js_undefined, &[_]JSValue{text_js}) catch {
            self.has_js_error = true;
            return;
        };
        if (!result.isUndefinedOrNull()) {
            const slice = result.toSlice(self.globalObject, self.allocator) catch {
                self.has_js_error = true;
                return;
            };
            defer slice.deinit();
            self.appendToTop(slice.slice());
        }
    }

    fn decodeAndAppendEntity(self: *JsCallbackRenderer, entity_text: []const u8) void {
        var buf: [8]u8 = undefined;
        self.appendTextOrRaw(md.helpers.decodeEntityToUtf8(entity_text, &buf) orelse entity_text);
    }

    /// Append text through the text callback if one is set, otherwise raw append.
    fn appendTextOrRaw(self: *JsCallbackRenderer, content: []const u8) void {
        if (self.callbacks.text != .zero) {
            self.callTextCallback(content);
        } else {
            self.appendToTop(content);
        }
    }

    // ========================================
    // Heading ID / slug generation
    // ========================================

    fn appendHeadingText(self: *JsCallbackRenderer, content: []const u8) void {
        self.heading_text_buf.appendSlice(self.allocator, content) catch {
            self.has_js_error = true;
        };
    }

    fn appendEntityToHeadingText(self: *JsCallbackRenderer, entity_text: []const u8) void {
        var buf: [8]u8 = undefined;
        self.appendHeadingText(md.helpers.decodeEntityToUtf8(entity_text, &buf) orelse entity_text);
    }

    // ========================================
    // Callback lookup
    // ========================================

    fn getBlockCallback(self: *JsCallbackRenderer, block_type: md.BlockType) JSValue {
        return switch (block_type) {
            .h => self.callbacks.heading,
            .p => self.callbacks.paragraph,
            .quote => self.callbacks.blockquote,
            .code => self.callbacks.code,
            .ul, .ol => self.callbacks.list,
            .li => self.callbacks.listItem,
            .hr => self.callbacks.hr,
            .table => self.callbacks.table,
            .thead => self.callbacks.thead,
            .tbody => self.callbacks.tbody,
            .tr => self.callbacks.tr,
            .th => self.callbacks.th,
            .td => self.callbacks.td,
            .html => self.callbacks.html,
            .doc => .zero,
        };
    }

    fn getSpanCallback(self: *JsCallbackRenderer, span_type: md.SpanType) JSValue {
        return switch (span_type) {
            .em => self.callbacks.emphasis,
            .strong => self.callbacks.strong,
            .a => self.callbacks.link,
            .img => self.callbacks.image,
            .code => self.callbacks.codespan,
            .del => self.callbacks.strikethrough,
            else => .zero,
        };
    }

    // ========================================
    // Metadata object creation
    // ========================================

    fn createBlockMeta(self: *JsCallbackRenderer, block_type: md.BlockType, data: u32, flags: u32) ?JSValue {
        const g = self.globalObject;
        switch (block_type) {
            .h => {
                const field_count: usize = if (self.heading_ids) 2 else 1;
                const obj = JSValue.createEmptyObject(g, field_count);
                obj.put(g, ZigString.static("level"), JSValue.jsNumber(data));
                if (self.heading_ids) {
                    const slug = md.helpers.generateSlug(&self.heading_text_buf, &self.slug_counts, self.allocator);
                    obj.put(g, ZigString.static("id"), bun.String.createUTF8ForJS(g, slug) catch return null);
                }
                return obj;
            },
            .ol => {
                const obj = JSValue.createEmptyObject(g, 2);
                obj.put(g, ZigString.static("ordered"), .true);
                obj.put(g, ZigString.static("start"), JSValue.jsNumber(data));
                return obj;
            },
            .ul => {
                const obj = JSValue.createEmptyObject(g, 1);
                obj.put(g, ZigString.static("ordered"), .false);
                return obj;
            },
            .code => {
                if (flags & md.BLOCK_FENCED_CODE != 0) {
                    const lang = self.extractLanguage(data);
                    if (lang.len > 0) {
                        const obj = JSValue.createEmptyObject(g, 1);
                        obj.put(g, ZigString.static("language"), bun.String.createUTF8ForJS(g, lang) catch return null);
                        return obj;
                    }
                }
                return null;
            },
            .th, .td => {
                const alignment: md.Align = @enumFromInt(@as(u2, @truncate(data)));
                if (alignment != .default) {
                    const obj = JSValue.createEmptyObject(g, 1);
                    const align_str: []const u8 = switch (alignment) {
                        .left => "left",
                        .center => "center",
                        .right => "right",
                        .default => unreachable,
                    };
                    obj.put(g, ZigString.static("align"), bun.String.createUTF8ForJS(g, align_str) catch return null);
                    return obj;
                }
                return null;
            },
            .li => {
                const task_mark: u8 = @truncate(data);
                if (task_mark != 0) {
                    const obj = JSValue.createEmptyObject(g, 1);
                    obj.put(g, ZigString.static("checked"), JSValue.jsBoolean(task_mark != ' '));
                    return obj;
                }
                return null;
            },
            else => return null,
        }
    }

    fn createSpanMeta(self: *JsCallbackRenderer, span_type: md.SpanType, detail: md.SpanDetail) ?JSValue {
        const g = self.globalObject;
        switch (span_type) {
            .a => {
                const obj = JSValue.createEmptyObject(g, 2);
                obj.put(g, ZigString.static("href"), bun.String.createUTF8ForJS(g, detail.href) catch return null);
                if (detail.title.len > 0) {
                    obj.put(g, ZigString.static("title"), bun.String.createUTF8ForJS(g, detail.title) catch return null);
                }
                return obj;
            },
            .img => {
                const obj = JSValue.createEmptyObject(g, 2);
                obj.put(g, ZigString.static("src"), bun.String.createUTF8ForJS(g, detail.href) catch return null);
                if (detail.title.len > 0) {
                    obj.put(g, ZigString.static("title"), bun.String.createUTF8ForJS(g, detail.title) catch return null);
                }
                return obj;
            },
            else => return null,
        }
    }

    fn extractLanguage(self: *JsCallbackRenderer, info_beg: u32) []const u8 {
        var lang_end: u32 = info_beg;
        while (lang_end < self.src_text.len) {
            const c = self.src_text[lang_end];
            if (c == ' ' or c == '\t' or c == '\n' or c == '\r') break;
            lang_end += 1;
        }
        if (lang_end > info_beg) return self.src_text[info_beg..lang_end];
        return "";
    }
};

const std = @import("std");

const bun = @import("bun");
const md = bun.md;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
