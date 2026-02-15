pub const JSXRenderer = struct {
    allocator: std.mem.Allocator,
    src_text: []const u8,
    out: std.ArrayListUnmanaged(u8),
    expression_slots: []const ExpressionSlot,
    component_names: bun.StringArrayHashMap(void),
    image_nesting_level: u32 = 0,
    saved_img_title: []const u8 = "",

    pub const ExpressionSlot = struct {
        original: []const u8,
        placeholder: []const u8,
    };

    pub fn init(
        allocator: std.mem.Allocator,
        src_text: []const u8,
        expression_slots: []const ExpressionSlot,
    ) JSXRenderer {
        return .{
            .allocator = allocator,
            .src_text = src_text,
            .out = .{},
            .expression_slots = expression_slots,
            .component_names = bun.StringArrayHashMap(void).init(allocator),
        };
    }

    pub fn deinit(self: *JSXRenderer) void {
        for (self.component_names.keys()) |key| {
            self.allocator.free(key);
        }
        self.out.deinit(self.allocator);
        self.component_names.deinit();
    }

    pub fn renderer(self: *JSXRenderer) Renderer {
        return .{ .ptr = self, .vtable = &vtable };
    }

    pub fn getOutput(self: *const JSXRenderer) []const u8 {
        return self.out.items;
    }

    pub const vtable: Renderer.VTable = .{
        .enterBlock = enterBlockImpl,
        .leaveBlock = leaveBlockImpl,
        .enterSpan = enterSpanImpl,
        .leaveSpan = leaveSpanImpl,
        .text = textImpl,
    };

    fn enterBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32, flags: u32) bun.JSError!void {
        const self: *JSXRenderer = @ptrCast(@alignCast(ptr));
        try self.enterBlock(block_type, data, flags);
    }

    fn leaveBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32) bun.JSError!void {
        const self: *JSXRenderer = @ptrCast(@alignCast(ptr));
        try self.leaveBlock(block_type, data);
    }

    fn enterSpanImpl(ptr: *anyopaque, span_type: SpanType, detail: SpanDetail) bun.JSError!void {
        const self: *JSXRenderer = @ptrCast(@alignCast(ptr));
        try self.enterSpan(span_type, detail);
    }

    fn leaveSpanImpl(ptr: *anyopaque, span_type: SpanType) bun.JSError!void {
        const self: *JSXRenderer = @ptrCast(@alignCast(ptr));
        try self.leaveSpan(span_type);
    }

    fn textImpl(ptr: *anyopaque, text_type: TextType, content: []const u8) bun.JSError!void {
        const self: *JSXRenderer = @ptrCast(@alignCast(ptr));
        try self.text(text_type, content);
    }

    fn trackComponent(self: *JSXRenderer, name: []const u8) !void {
        const result = try self.component_names.getOrPut(name);
        if (!result.found_existing) {
            result.key_ptr.* = try self.allocator.dupe(u8, name);
        }
    }

    fn write(self: *JSXRenderer, bytes: []const u8) !void {
        try self.out.appendSlice(self.allocator, bytes);
    }

    fn writeChar(self: *JSXRenderer, c: u8) !void {
        try self.out.append(self.allocator, c);
    }

    fn writeComponentTagOpen(self: *JSXRenderer, name: []const u8) !void {
        try self.trackComponent(name);
        try self.write("<_components.");
        try self.write(name);
        try self.write(">");
    }

    fn writeComponentTagClose(self: *JSXRenderer, name: []const u8) !void {
        try self.trackComponent(name);
        try self.write("</_components.");
        try self.write(name);
        try self.write(">");
    }

    fn writeComponentTagSelfClose(self: *JSXRenderer, name: []const u8) !void {
        try self.trackComponent(name);
        try self.write("<_components.");
        try self.write(name);
        try self.write(" />");
    }

    fn writeAttrEscaped(self: *JSXRenderer, value: []const u8) !void {
        for (value) |c| {
            switch (c) {
                '&' => try self.write("&amp;"),
                '<' => try self.write("&lt;"),
                '>' => try self.write("&gt;"),
                '"' => try self.write("&quot;"),
                '{' => try self.write("{'{'}"),
                '}' => try self.write("{'}'}"),
                else => try self.writeChar(c),
            }
        }
    }

    fn writeJSXEscaped(self: *JSXRenderer, value: []const u8) !void {
        for (value) |c| {
            switch (c) {
                '{' => try self.write("{'{'}"),
                '}' => try self.write("{'}'}"),
                '<' => try self.write("{'<'}"),
                '>' => try self.write("{'>'}"),
                else => try self.writeChar(c),
            }
        }
    }

    fn writeJSStringEscaped(self: *JSXRenderer, value: []const u8) !void {
        for (value) |c| {
            switch (c) {
                '\\' => try self.write("\\\\"),
                '"' => try self.write("\\\""),
                '\n' => try self.write("\\n"),
                '\r' => try self.write("\\r"),
                '\t' => try self.write("\\t"),
                else => try self.writeChar(c),
            }
        }
    }

    fn enterBlock(self: *JSXRenderer, block_type: BlockType, data: u32, flags: u32) !void {
        switch (block_type) {
            .doc => {},
            .quote => try self.writeComponentTagOpen("blockquote"),
            .ul => try self.writeComponentTagOpen("ul"),
            .ol => {
                try self.trackComponent("ol");
                try self.write("<_components.ol");
                if (data > 1) {
                    try self.write(" start={");
                    try self.out.writer(self.allocator).print("{d}", .{data});
                    try self.write("}");
                }
                try self.write(">");
            },
            .li => try self.writeComponentTagOpen("li"),
            .hr => try self.writeComponentTagSelfClose("hr"),
            .h => {
                const tag = switch (data) {
                    1 => "h1",
                    2 => "h2",
                    3 => "h3",
                    4 => "h4",
                    5 => "h5",
                    else => "h6",
                };
                try self.writeComponentTagOpen(tag);
            },
            .code => {
                try self.trackComponent("pre");
                try self.trackComponent("code");
                try self.write("<_components.pre><_components.code");
                if (flags & BLOCK_FENCED_CODE != 0 and data < self.src_text.len) {
                    const info_beg: usize = data;
                    var lang_end = info_beg;
                    while (lang_end < self.src_text.len and !helpers.isBlank(self.src_text[lang_end]) and
                        !helpers.isNewline(self.src_text[lang_end]))
                    {
                        lang_end += 1;
                    }
                    if (lang_end > info_beg) {
                        try self.write(" className=\"language-");
                        try self.writeAttrEscaped(self.src_text[info_beg..lang_end]);
                        try self.write("\"");
                    }
                }
                try self.write(">");
            },
            .html => {},
            .p => try self.writeComponentTagOpen("p"),
            .table => try self.writeComponentTagOpen("table"),
            .thead => try self.writeComponentTagOpen("thead"),
            .tbody => try self.writeComponentTagOpen("tbody"),
            .tr => try self.writeComponentTagOpen("tr"),
            .th => try self.writeComponentTagOpen("th"),
            .td => try self.writeComponentTagOpen("td"),
        }
    }

    fn leaveBlock(self: *JSXRenderer, block_type: BlockType, data: u32) !void {
        switch (block_type) {
            .doc => {},
            .quote => try self.writeComponentTagClose("blockquote"),
            .ul => try self.writeComponentTagClose("ul"),
            .ol => try self.writeComponentTagClose("ol"),
            .li => try self.writeComponentTagClose("li"),
            .hr => {},
            .h => {
                const tag = switch (data) {
                    1 => "h1",
                    2 => "h2",
                    3 => "h3",
                    4 => "h4",
                    5 => "h5",
                    else => "h6",
                };
                try self.writeComponentTagClose(tag);
            },
            .code => try self.write("</_components.code></_components.pre>"),
            .html => {},
            .p => try self.writeComponentTagClose("p"),
            .table => try self.writeComponentTagClose("table"),
            .thead => try self.writeComponentTagClose("thead"),
            .tbody => try self.writeComponentTagClose("tbody"),
            .tr => try self.writeComponentTagClose("tr"),
            .th => try self.writeComponentTagClose("th"),
            .td => try self.writeComponentTagClose("td"),
        }
    }

    fn enterSpan(self: *JSXRenderer, span_type: SpanType, detail: SpanDetail) !void {
        switch (span_type) {
            .em => try self.writeComponentTagOpen("em"),
            .strong => try self.writeComponentTagOpen("strong"),
            .u => try self.writeComponentTagOpen("u"),
            .code => try self.writeComponentTagOpen("code"),
            .del => try self.writeComponentTagOpen("del"),
            .latexmath, .latexmath_display => try self.writeComponentTagOpen("span"),
            .wikilink => try self.writeComponentTagOpen("a"),
            .a => {
                try self.trackComponent("a");
                try self.write("<_components.a href=\"");
                try self.writeAttrEscaped(detail.href);
                try self.write("\"");
                if (detail.title.len > 0) {
                    try self.write(" title=\"");
                    try self.writeAttrEscaped(detail.title);
                    try self.write("\"");
                }
                try self.write(">");
            },
            .img => {
                try self.trackComponent("img");
                self.saved_img_title = detail.title;
                self.image_nesting_level += 1;
                try self.write("<_components.img src=\"");
                try self.writeAttrEscaped(detail.href);
                try self.write("\" alt=\"");
            },
        }
    }

    fn leaveSpan(self: *JSXRenderer, span_type: SpanType) !void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) {
                self.image_nesting_level -= 1;
                if (self.image_nesting_level == 0) {
                    try self.write("\"");
                    if (self.saved_img_title.len > 0) {
                        try self.write(" title=\"");
                        try self.writeAttrEscaped(self.saved_img_title);
                        try self.write("\"");
                    }
                    try self.write(" />");
                }
            }
            return;
        }

        switch (span_type) {
            .em => try self.writeComponentTagClose("em"),
            .strong => try self.writeComponentTagClose("strong"),
            .u => try self.writeComponentTagClose("u"),
            .a => try self.writeComponentTagClose("a"),
            .code => try self.writeComponentTagClose("code"),
            .del => try self.writeComponentTagClose("del"),
            .latexmath, .latexmath_display => try self.writeComponentTagClose("span"),
            .wikilink => try self.writeComponentTagClose("a"),
            .img => {},
        }
    }

    fn text(self: *JSXRenderer, text_type: TextType, content: []const u8) !void {
        const in_image = self.image_nesting_level > 0;

        switch (text_type) {
            .normal => {
                var i: usize = 0;
                while (i < content.len) {
                    if (content[i] == 1) {
                        const sentinel_end = bun.strings.indexOfCharPos(content, 1, i + 1) orelse break;
                        const placeholder = content[i .. sentinel_end + 1];
                        var restored = false;
                        for (self.expression_slots) |slot| {
                            if (bun.strings.eql(slot.placeholder, placeholder)) {
                                try self.write("{");
                                try self.write(slot.original);
                                try self.write("}");
                                restored = true;
                                break;
                            }
                        }
                        if (!restored) {
                            try self.writeJSXEscaped(placeholder);
                        }
                        i = sentinel_end + 1;
                        continue;
                    }
                    if (in_image) {
                        try self.writeAttrEscaped(content[i .. i + 1]);
                    } else {
                        try self.writeJSXEscaped(content[i .. i + 1]);
                    }
                    i += 1;
                }
            },
            .null_char => if (in_image) {
                try self.writeAttrEscaped("\xEF\xBF\xBD");
            } else {
                try self.write("\u{FFFD}");
            },
            .br => if (in_image) {
                try self.write(" ");
            } else {
                try self.write("<br />");
            },
            .softbr => if (in_image) {
                try self.write(" ");
            } else {
                try self.write("\n");
            },
            .html => try self.write(content),
            .entity => try self.write(content),
            .code => {
                try self.write("{\"");
                try self.writeJSStringEscaped(content);
                try self.write("\"}");
            },
            .latexmath => try self.writeJSXEscaped(content),
        }
    }
};

const bun = @import("bun");
const std = @import("std");
const helpers = @import("./helpers.zig");
const types = @import("./types.zig");
const BLOCK_FENCED_CODE = types.BLOCK_FENCED_CODE;
const BlockType = types.BlockType;
const Renderer = types.Renderer;
const SpanDetail = types.SpanDetail;
const SpanType = types.SpanType;
const TextType = types.TextType;
