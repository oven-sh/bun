pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 3);
    object.put(
        globalThis,
        ZigString.static("html"),
        jsc.JSFunction.create(globalThis, "html", renderToHTML, 1, .{}),
    );
    object.put(
        globalThis,
        ZigString.static("render"),
        jsc.JSFunction.create(globalThis, "render", renderObjects, 2, .{}),
    );
    object.put(
        globalThis,
        ZigString.static("react"),
        jsc.JSFunction.create(globalThis, "react", renderReact, 2, .{}),
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

/// `Bun.markdown.render(text, options?)` — returns a plain object AST.
///
/// Each node is `{ type: "tagName", props: { ...attrs, children: [...] } }`.
/// Text content is represented as plain strings in children arrays.
pub const renderObjects = jsc.MarkedArgumentBuffer.wrap(renderObjectsImpl);

fn renderObjectsImpl(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    marked_args: *jsc.MarkedArgumentBuffer,
) bun.JSError!jsc.JSValue {
    return renderAST(globalThis, callframe, marked_args, null);
}

/// `Bun.markdown.react(text, options?)` — returns React element AST.
///
/// Each node is a valid React element:
/// `{ $$typeof: Symbol.for('react.element'), type: "tagName", key: null, ref: null, props: { ...attrs, children: [...] } }`
/// The react version can be set via `{ reactVersion: 18 }` (default) or `{ reactVersion: 19 }` in options.
pub const renderReact = jsc.MarkedArgumentBuffer.wrap(renderReactImpl);

fn renderReactImpl(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    marked_args: *jsc.MarkedArgumentBuffer,
) bun.JSError!jsc.JSValue {
    const args = callframe.argumentsAsArray(2);
    const opts_value = args[1];

    // Parse reactVersion from options (default: 18 → react_version 0)
    var react_version: u8 = 0;
    if (opts_value.isObject()) {
        if (try opts_value.get(globalThis, "reactVersion")) |rv| {
            if (rv.isNumber()) {
                const num = rv.toInt32();
                if (num >= 19) react_version = 1;
            }
        }
    }

    return renderAST(globalThis, callframe, marked_args, react_version);
}

fn renderAST(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    marked_args: *jsc.MarkedArgumentBuffer,
    react_version: ?u8,
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

    var renderer = ParseRenderer.init(globalThis, input, marked_args, options.heading_ids, react_version) catch {
        return globalThis.throwOutOfMemory();
    };
    defer renderer.deinit();

    // Extract component overrides from opts (functions keyed by HTML tag name)
    try renderer.extractComponents(if (opts_value.isObject()) opts_value else .js_undefined);

    try md.renderWithRenderer(input, bun.default_allocator, options, renderer.renderer());

    return renderer.getResult();
}

/// Renderer that builds an object AST from markdown.
///
/// In plain mode (`react_version == null`), each element becomes:
/// `{ type: "tagName", props: { ...metadata, children: [...] } }`
///
/// In React mode (`react_version != null`), each element becomes a valid React element
/// created via a cached JSC Structure with putDirectOffset:
/// `{ $$typeof: Symbol.for('react.element'), type: "tagName", key: null, ref: null, props: { ...metadata, children: [...] } }`
///
/// Uses HTML tag names (h1-h6, p, blockquote, a, em, strong, etc.).
/// Text content is plain JS strings in children arrays.
const ParseRenderer = struct {
    #globalObject: *jsc.JSGlobalObject,
    #marked_args: *jsc.MarkedArgumentBuffer,
    #stack: std.ArrayListUnmanaged(StackEntry) = .{},
    #stack_check: bun.StackCheck,
    #src_text: []const u8,
    #heading_ids: bool = false,
    #in_heading_block: bool = false,
    #heading_text_buf: std.ArrayListUnmanaged(u8) = .{},
    #slug_counts: bun.StringHashMapUnmanaged(u32) = .{},
    #components: Components = .{},
    #react_version: ?u8 = null,

    extern fn JSReactElement__create(
        globalObject: *jsc.JSGlobalObject,
        react_version: u8,
        element_type: JSValue,
        props: JSValue,
    ) JSValue;

    /// Component overrides keyed by HTML tag name.
    /// When set, the value replaces the string tag name in the `type` field.
    const Components = struct {
        h1: JSValue = .zero,
        h2: JSValue = .zero,
        h3: JSValue = .zero,
        h4: JSValue = .zero,
        h5: JSValue = .zero,
        h6: JSValue = .zero,
        p: JSValue = .zero,
        blockquote: JSValue = .zero,
        ul: JSValue = .zero,
        ol: JSValue = .zero,
        li: JSValue = .zero,
        pre: JSValue = .zero,
        hr: JSValue = .zero,
        html: JSValue = .zero,
        table: JSValue = .zero,
        thead: JSValue = .zero,
        tbody: JSValue = .zero,
        tr: JSValue = .zero,
        th: JSValue = .zero,
        td: JSValue = .zero,
        em: JSValue = .zero,
        strong: JSValue = .zero,
        a: JSValue = .zero,
        img: JSValue = .zero,
        code: JSValue = .zero,
        del: JSValue = .zero,
        math: JSValue = .zero,
        u: JSValue = .zero,
        br: JSValue = .zero,
    };

    const StackEntry = struct {
        children: JSValue,
        block_type: ?md.BlockType = null,
        span_type: ?md.SpanType = null,
        data: u32 = 0,
        flags: u32 = 0,
        detail: md.SpanDetail = .{},
    };

    fn init(
        globalObject: *jsc.JSGlobalObject,
        src_text: []const u8,
        marked_args: *jsc.MarkedArgumentBuffer,
        heading_ids: bool,
        react_version: ?u8,
    ) error{OutOfMemory}!ParseRenderer {
        var self = ParseRenderer{
            .#globalObject = globalObject,
            .#marked_args = marked_args,
            .#src_text = src_text,
            .#heading_ids = heading_ids,
            .#stack_check = bun.StackCheck.init(),
            .#react_version = react_version,
        };
        // Root entry — its children array becomes the return value
        const root_array = JSValue.createEmptyArray(globalObject, 0) catch return error.OutOfMemory;
        marked_args.append(root_array);
        try self.#stack.append(bun.default_allocator, .{ .children = root_array, .block_type = .doc });
        return self;
    }

    fn deinit(self: *ParseRenderer) void {
        self.#stack.deinit(bun.default_allocator);
        self.#heading_text_buf.deinit(bun.default_allocator);
        var it = self.#slug_counts.iterator();
        while (it.next()) |entry| {
            bun.default_allocator.free(@constCast(entry.key_ptr.*));
        }
        self.#slug_counts.deinit(bun.default_allocator);
    }

    /// Extract component overrides from options. Any non-boolean truthy value
    /// (function, class, string, etc.) keyed by an HTML tag name is stored
    /// and used as the `type` field instead of the default string tag name.
    fn extractComponents(self: *ParseRenderer, opts: JSValue) bun.JSError!void {
        if (opts.isUndefinedOrNull() or !opts.isObject()) return;
        inline for (@typeInfo(Components).@"struct".fields) |field| {
            if (try opts.getTruthy(self.#globalObject, field.name)) |val| {
                if (!val.isBoolean()) {
                    @field(self.#components, field.name) = val;
                    self.#marked_args.append(val);
                }
            }
        }
    }

    fn getBlockComponent(self: *ParseRenderer, block_type: md.BlockType, data: u32) JSValue {
        return switch (block_type) {
            .h => switch (data) {
                1 => self.#components.h1,
                2 => self.#components.h2,
                3 => self.#components.h3,
                4 => self.#components.h4,
                5 => self.#components.h5,
                else => self.#components.h6,
            },
            .p => self.#components.p,
            .quote => self.#components.blockquote,
            .ul => self.#components.ul,
            .ol => self.#components.ol,
            .li => self.#components.li,
            .code => self.#components.pre,
            .hr => self.#components.hr,
            .html => self.#components.html,
            .table => self.#components.table,
            .thead => self.#components.thead,
            .tbody => self.#components.tbody,
            .tr => self.#components.tr,
            .th => self.#components.th,
            .td => self.#components.td,
            .doc => .zero,
        };
    }

    fn getSpanComponent(self: *ParseRenderer, span_type: md.SpanType) JSValue {
        return switch (span_type) {
            .em => self.#components.em,
            .strong => self.#components.strong,
            .a => self.#components.a,
            .img => self.#components.img,
            .code => self.#components.code,
            .del => self.#components.del,
            .latexmath, .latexmath_display => self.#components.math,
            .wikilink => self.#components.a,
            .u => self.#components.u,
        };
    }

    fn renderer(self: *ParseRenderer) md.Renderer {
        return .{ .ptr = self, .vtable = &vtable };
    }

    fn getResult(self: *ParseRenderer) JSValue {
        if (self.#stack.items.len == 0) return .js_undefined;
        return self.#stack.items[0].children;
    }

    /// Creates an element node. In React mode, uses the C++ fast path with
    /// a cached Structure and putDirectOffset. In plain mode, creates a
    /// simple `{ type, props }` object.
    fn createElement(self: *ParseRenderer, type_val: JSValue, props: JSValue) JSValue {
        if (self.#react_version) |version| {
            const obj = JSReactElement__create(self.#globalObject, version, type_val, props);
            self.#marked_args.append(obj);
            return obj;
        } else {
            const obj = JSValue.createEmptyObject(self.#globalObject, 2);
            self.#marked_args.append(obj);
            obj.put(self.#globalObject, ZigString.static("type"), type_val);
            obj.put(self.#globalObject, ZigString.static("props"), props);
            return obj;
        }
    }

    const vtable: md.Renderer.VTable = .{
        .enterBlock = enterBlockImpl,
        .leaveBlock = leaveBlockImpl,
        .enterSpan = enterSpanImpl,
        .leaveSpan = leaveSpanImpl,
        .text = textImpl,
    };

    // ========================================
    // Block callbacks
    // ========================================

    fn enterBlockImpl(ptr: *anyopaque, block_type: md.BlockType, data: u32, flags: u32) bun.JSError!void {
        const self: *ParseRenderer = @ptrCast(@alignCast(ptr));
        if (!self.#stack_check.isSafeToRecurse()) return self.#globalObject.throwStackOverflow();
        if (block_type == .doc) return;

        if (block_type == .h and self.#heading_ids) {
            self.#in_heading_block = true;
        }

        const array = try JSValue.createEmptyArray(self.#globalObject, 0);
        self.#marked_args.append(array);
        try self.#stack.append(bun.default_allocator, .{
            .children = array,
            .block_type = block_type,
            .data = data,
            .flags = flags,
        });
    }

    fn leaveBlockImpl(ptr: *anyopaque, block_type: md.BlockType, _: u32) bun.JSError!void {
        const self: *ParseRenderer = @ptrCast(@alignCast(ptr));
        if (!self.#stack_check.isSafeToRecurse()) return self.#globalObject.throwStackOverflow();
        if (block_type == .doc) return;

        if (self.#stack.items.len <= 1) return;
        const entry = self.#stack.pop().?;
        const g = self.#globalObject;

        if (block_type == .h) {
            self.#in_heading_block = false;
        }

        // Determine HTML tag name
        const type_str: []const u8 = blockTypeName(block_type, entry.data);

        // Count props fields
        var props_count: usize = if (block_type == .hr) 0 else 1; // children
        switch (block_type) {
            .h => if (self.#heading_ids) {
                props_count += 1;
            },
            .ol => props_count += 1, // start
            .li => {
                const task_mark: u8 = @truncate(entry.data);
                if (task_mark != 0) props_count += 1;
            },
            .code => {
                if (entry.flags & md.BLOCK_FENCED_CODE != 0) {
                    const lang = extractLanguage(self.#src_text, entry.data);
                    if (lang.len > 0) props_count += 1;
                }
            },
            .th, .td => {
                const alignment: md.Align = @enumFromInt(@as(u2, @truncate(entry.data)));
                if (alignment != .default) props_count += 1;
            },
            else => {},
        }

        // Build React element — use component override as type if set
        const component = self.getBlockComponent(block_type, entry.data);
        const type_val: JSValue = if (component != .zero) component else try bun.String.createUTF8ForJS(g, type_str);

        const props = JSValue.createEmptyObject(g, props_count);
        self.#marked_args.append(props);

        // Set metadata props
        switch (block_type) {
            .h => {
                if (self.#heading_ids) {
                    const slug = md.helpers.generateSlug(&self.#heading_text_buf, &self.#slug_counts, bun.default_allocator);
                    props.put(g, ZigString.static("id"), try bun.String.createUTF8ForJS(g, slug));
                }
            },
            .ol => {
                props.put(g, ZigString.static("start"), JSValue.jsNumber(entry.data));
            },
            .li => {
                const task_mark: u8 = @truncate(entry.data);
                if (task_mark != 0) {
                    props.put(g, ZigString.static("checked"), JSValue.jsBoolean(task_mark != ' '));
                }
            },
            .code => {
                if (entry.flags & md.BLOCK_FENCED_CODE != 0) {
                    const lang = extractLanguage(self.#src_text, entry.data);
                    if (lang.len > 0) {
                        props.put(g, ZigString.static("language"), try bun.String.createUTF8ForJS(g, lang));
                    }
                }
            },
            .th, .td => {
                const alignment: md.Align = @enumFromInt(@as(u2, @truncate(entry.data)));
                if (alignment != .default) {
                    const align_str: []const u8 = switch (alignment) {
                        .left => "left",
                        .center => "center",
                        .right => "right",
                        .default => unreachable,
                    };
                    props.put(g, ZigString.static("align"), try bun.String.createUTF8ForJS(g, align_str));
                }
            },
            else => {},
        }

        // Set children (skip for void elements)
        if (block_type != .hr) {
            props.put(g, ZigString.static("children"), entry.children);
        }

        const obj = self.createElement(type_val, props);

        // Push to parent's children array
        if (self.#stack.items.len > 0) {
            try self.#stack.items[self.#stack.items.len - 1].children.push(g, obj);
        }

        if (block_type == .h) {
            self.#heading_text_buf.clearRetainingCapacity();
        }
    }

    // ========================================
    // Span callbacks
    // ========================================

    fn enterSpanImpl(ptr: *anyopaque, _: md.SpanType, detail: md.SpanDetail) bun.JSError!void {
        const self: *ParseRenderer = @ptrCast(@alignCast(ptr));
        if (!self.#stack_check.isSafeToRecurse()) return self.#globalObject.throwStackOverflow();

        const array = try JSValue.createEmptyArray(self.#globalObject, 0);
        self.#marked_args.append(array);
        try self.#stack.append(bun.default_allocator, .{ .children = array, .detail = detail });
    }

    fn leaveSpanImpl(ptr: *anyopaque, span_type: md.SpanType) bun.JSError!void {
        const self: *ParseRenderer = @ptrCast(@alignCast(ptr));
        if (!self.#stack_check.isSafeToRecurse()) return self.#globalObject.throwStackOverflow();

        if (self.#stack.items.len <= 1) return;
        const entry = self.#stack.pop().?;
        const g = self.#globalObject;

        const type_str: []const u8 = spanTypeName(span_type);

        // Count props fields: always children (or alt for img) + metadata
        var props_count: usize = 1; // children (or alt for img)
        switch (span_type) {
            .a => {
                props_count += 1; // href
                if (entry.detail.title.len > 0) props_count += 1;
            },
            .img => {
                props_count += 1; // src
                if (entry.detail.title.len > 0) props_count += 1;
            },
            .wikilink => props_count += 1, // target
            .latexmath_display => props_count += 1, // display
            else => {},
        }

        // Build React element: { $$typeof, type, key, ref, props }
        const component = self.getSpanComponent(span_type);
        const type_val: JSValue = if (component != .zero) component else try bun.String.createUTF8ForJS(g, type_str);

        const props = JSValue.createEmptyObject(g, props_count);
        self.#marked_args.append(props);

        // Set metadata props
        switch (span_type) {
            .a => {
                props.put(g, ZigString.static("href"), try bun.String.createUTF8ForJS(g, entry.detail.href));
                if (entry.detail.title.len > 0) {
                    props.put(g, ZigString.static("title"), try bun.String.createUTF8ForJS(g, entry.detail.title));
                }
            },
            .img => {
                props.put(g, ZigString.static("src"), try bun.String.createUTF8ForJS(g, entry.detail.href));
                if (entry.detail.title.len > 0) {
                    props.put(g, ZigString.static("title"), try bun.String.createUTF8ForJS(g, entry.detail.title));
                }
            },
            .wikilink => {
                props.put(g, ZigString.static("target"), try bun.String.createUTF8ForJS(g, entry.detail.href));
            },
            .latexmath_display => {
                props.put(g, ZigString.static("display"), .true);
            },
            else => {},
        }

        if (span_type == .img) {
            // img is a void element — convert children to alt prop
            const len: u32 = @truncate(try entry.children.getLength(g));
            if (len == 1) {
                const child = try entry.children.getIndex(g, 0);
                if (child.isString()) {
                    props.put(g, ZigString.static("alt"), child);
                }
            } else if (len > 1) {
                // Multiple children — concatenate string parts
                var alt_buf = std.ArrayListUnmanaged(u8){};
                defer alt_buf.deinit(bun.default_allocator);
                for (0..len) |i| {
                    const child = try entry.children.getIndex(g, @truncate(i));
                    if (child.isString()) {
                        const str = try child.toSlice(g, bun.default_allocator);
                        defer str.deinit();
                        alt_buf.appendSlice(bun.default_allocator, str.slice()) catch {};
                    }
                }
                if (alt_buf.items.len > 0) {
                    props.put(g, ZigString.static("alt"), try bun.String.createUTF8ForJS(g, alt_buf.items));
                }
            }
        } else {
            props.put(g, ZigString.static("children"), entry.children);
        }

        const obj = self.createElement(type_val, props);

        // Push to parent's children array
        if (self.#stack.items.len > 0) {
            try self.#stack.items[self.#stack.items.len - 1].children.push(g, obj);
        }
    }

    // ========================================
    // Text callback
    // ========================================

    fn textImpl(ptr: *anyopaque, text_type: md.TextType, content: []const u8) bun.JSError!void {
        const self: *ParseRenderer = @ptrCast(@alignCast(ptr));
        if (!self.#stack_check.isSafeToRecurse()) return self.#globalObject.throwStackOverflow();

        const g = self.#globalObject;

        // Track plain text for slug generation when inside a heading
        if (self.#in_heading_block) {
            switch (text_type) {
                .null_char => self.#heading_text_buf.appendSlice(bun.default_allocator, "\xEF\xBF\xBD") catch {},
                .br, .softbr => self.#heading_text_buf.appendSlice(bun.default_allocator, " ") catch {},
                .html => {},
                .entity => {
                    var buf: [8]u8 = undefined;
                    const decoded = md.helpers.decodeEntityToUtf8(content, &buf) orelse content;
                    self.#heading_text_buf.appendSlice(bun.default_allocator, decoded) catch {};
                },
                else => self.#heading_text_buf.appendSlice(bun.default_allocator, content) catch {},
            }
        }

        if (self.#stack.items.len == 0) return;
        const parent = &self.#stack.items[self.#stack.items.len - 1];

        switch (text_type) {
            .br => {
                const br_component = self.#components.br;
                const br_type: JSValue = if (br_component != .zero) br_component else try bun.String.createUTF8ForJS(g, "br");
                const empty_props = JSValue.createEmptyObject(g, 0);
                self.#marked_args.append(empty_props);
                const obj = self.createElement(br_type, empty_props);
                try parent.children.push(g, obj);
            },
            .softbr => {
                const str = try bun.String.createUTF8ForJS(g, "\n");
                self.#marked_args.append(str);
                try parent.children.push(g, str);
            },
            .null_char => {
                const str = try bun.String.createUTF8ForJS(g, "\xEF\xBF\xBD");
                self.#marked_args.append(str);
                try parent.children.push(g, str);
            },
            .entity => {
                var buf: [8]u8 = undefined;
                const decoded = md.helpers.decodeEntityToUtf8(content, &buf) orelse content;
                const str = try bun.String.createUTF8ForJS(g, decoded);
                self.#marked_args.append(str);
                try parent.children.push(g, str);
            },
            else => {
                const str = try bun.String.createUTF8ForJS(g, content);
                self.#marked_args.append(str);
                try parent.children.push(g, str);
            },
        }
    }

    // ========================================
    // Type name mappings
    // ========================================

    fn blockTypeName(block_type: md.BlockType, data: u32) []const u8 {
        return switch (block_type) {
            .h => switch (data) {
                1 => "h1",
                2 => "h2",
                3 => "h3",
                4 => "h4",
                5 => "h5",
                else => "h6",
            },
            .p => "p",
            .quote => "blockquote",
            .ul => "ul",
            .ol => "ol",
            .li => "li",
            .code => "pre",
            .hr => "hr",
            .html => "html",
            .table => "table",
            .thead => "thead",
            .tbody => "tbody",
            .tr => "tr",
            .th => "th",
            .td => "td",
            .doc => "div",
        };
    }

    fn spanTypeName(span_type: md.SpanType) []const u8 {
        return switch (span_type) {
            .em => "em",
            .strong => "strong",
            .a => "a",
            .img => "img",
            .code => "code",
            .del => "del",
            .latexmath => "math",
            .latexmath_display => "math",
            .wikilink => "a",
            .u => "u",
        };
    }
};

fn extractLanguage(src_text: []const u8, info_beg: u32) []const u8 {
    var lang_end: u32 = info_beg;
    while (lang_end < src_text.len) {
        const c = src_text[lang_end];
        if (c == ' ' or c == '\t' or c == '\n' or c == '\r') break;
        lang_end += 1;
    }
    if (lang_end > info_beg) return src_text[info_beg..lang_end];
    return "";
}

const std = @import("std");

const bun = @import("bun");
const md = bun.md;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
