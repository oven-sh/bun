pub const MdxOptions = struct {
    jsx_import_source: []const u8 = "react",
    md_options: md.Options = .{
        .tables = true,
        .strikethrough = true,
        .tasklists = true,
        .no_indented_code_blocks = true,
    },
};

pub const FrontmatterResult = struct {
    yaml_content: []const u8,
    content_start: u32,
};

pub const TopLevelStatement = struct {
    text: []const u8,
    kind: enum { import_stmt, export_stmt },
};

pub const ExpressionSlot = jsx_renderer.JSXRenderer.ExpressionSlot;

pub fn extractFrontmatter(source: []const u8) ?FrontmatterResult {
    if (!bun.strings.hasPrefixComptime(source, "---")) {
        return null;
    }

    const first_nl = bun.strings.indexOfChar(source[3..], '\n') orelse return null;
    const body_start = 3 + first_nl + 1;

    var i: usize = body_start;
    while (i < source.len) : (i += 1) {
        if (source[i] == '\n' or i == body_start) {
            const line_start = if (source[i] == '\n') i + 1 else i;
            if (line_start + 3 <= source.len and bun.strings.eqlComptime(source[line_start..][0..3], "---")) {
                const after_dashes = line_start + 3;
                if (after_dashes >= source.len or source[after_dashes] == '\n') {
                    return .{
                        .yaml_content = source[body_start..line_start],
                        .content_start = @intCast(@min(after_dashes + 1, source.len)),
                    };
                }
            }
        }
    }

    return null;
}

pub fn extractTopLevelStatements(
    source: []const u8,
    allocator: std.mem.Allocator,
) !struct { stmts: []TopLevelStatement, remaining: []const u8 } {
    var stmts: std.ArrayListUnmanaged(TopLevelStatement) = .{};
    var remaining: std.ArrayListUnmanaged(u8) = .{};
    errdefer stmts.deinit(allocator);
    errdefer remaining.deinit(allocator);

    var lines = std.mem.splitScalar(u8, source, '\n');
    var seen_content = false;
    var in_code_fence = false;
    while (lines.next()) |line| {
        const trimmed = bun.strings.trimSpaces(line);

        if (bun.strings.hasPrefixComptime(trimmed, "```")) {
            in_code_fence = !in_code_fence;
        }

        const maybe_stmt = !in_code_fence and !seen_content and trimmed.len > 0 and (bun.strings.hasPrefixComptime(trimmed, "import ") or
            bun.strings.hasPrefixComptime(trimmed, "import{") or
            (bun.strings.hasPrefixComptime(trimmed, "export ") and !bun.strings.hasPrefixComptime(trimmed, "export default")));

        if (maybe_stmt) {
            try stmts.append(allocator, .{
                .text = try allocator.dupe(u8, line),
                .kind = if (bun.strings.hasPrefixComptime(trimmed, "import")) .import_stmt else .export_stmt,
            });
            continue;
        }

        if (trimmed.len > 0) seen_content = true;
        try remaining.appendSlice(allocator, line);
        try remaining.append(allocator, '\n');
    }

    return .{
        .stmts = try stmts.toOwnedSlice(allocator),
        .remaining = try remaining.toOwnedSlice(allocator),
    };
}

pub fn replaceExpressions(
    source: []const u8,
    allocator: std.mem.Allocator,
) !struct { text: []u8, slots: []ExpressionSlot } {
    var slots: std.ArrayListUnmanaged(ExpressionSlot) = .{};
    var output: std.ArrayListUnmanaged(u8) = .{};
    errdefer slots.deinit(allocator);
    errdefer output.deinit(allocator);

    var i: usize = 0;
    var depth: usize = 0;
    var expr_start: ?usize = null;
    var in_code_fence = false;
    var in_inline_code = false;

    while (i < source.len) : (i += 1) {
        const c = source[i];

        if (c == '`' and i + 2 < source.len and source[i + 1] == '`' and source[i + 2] == '`') {
            in_code_fence = !in_code_fence;
            try output.appendSlice(allocator, source[i .. i + 3]);
            i += 2;
            continue;
        }
        if (in_code_fence) {
            try output.append(allocator, c);
            continue;
        }

        if (c == '`') {
            in_inline_code = !in_inline_code;
            try output.append(allocator, c);
            continue;
        }
        if (in_inline_code) {
            try output.append(allocator, c);
            continue;
        }

        if (c == '{' and expr_start == null) {
            expr_start = i;
            depth = 1;
            continue;
        }

        if (expr_start != null) {
            if (c == '{') depth += 1;
            if (c == '}') {
                depth -= 1;
                if (depth == 0) {
                    const expr_text = source[expr_start.? + 1 .. i];
                    const slot_id = slots.items.len;
                    const placeholder = try std.fmt.allocPrint(allocator, "\x01MDXE{d}\x01", .{slot_id});
                    try slots.append(allocator, .{
                        .original = try allocator.dupe(u8, expr_text),
                        .placeholder = placeholder,
                    });
                    try output.appendSlice(allocator, placeholder);
                    expr_start = null;
                    continue;
                }
            }
            continue;
        }

        try output.append(allocator, c);
    }

    if (expr_start != null) {
        return error.UnclosedExpression;
    }

    return .{
        .text = try output.toOwnedSlice(allocator),
        .slots = try slots.toOwnedSlice(allocator),
    };
}

pub fn compile(src: []const u8, allocator: std.mem.Allocator, options: MdxOptions) ![]u8 {
    const source = bun.strings.trimSpaces(src);
    const fm = extractFrontmatter(source);
    const content_start: usize = if (fm) |f| f.content_start else 0;

    const extracted = try extractTopLevelStatements(source[content_start..], allocator);
    defer {
        allocator.free(extracted.remaining);
        for (extracted.stmts) |stmt| {
            allocator.free(stmt.text);
        }
        allocator.free(extracted.stmts);
    }

    const preprocessed = try replaceExpressions(extracted.remaining, allocator);
    defer {
        allocator.free(preprocessed.text);
        for (preprocessed.slots) |slot| {
            allocator.free(slot.original);
            allocator.free(slot.placeholder);
        }
        allocator.free(preprocessed.slots);
    }

    var renderer = jsx_renderer.JSXRenderer.init(allocator, preprocessed.text, preprocessed.slots);
    defer renderer.deinit();

    try md.renderWithRenderer(preprocessed.text, allocator, options.md_options, renderer.renderer());

    var out: std.ArrayListUnmanaged(u8) = .{};
    errdefer out.deinit(allocator);

    if (options.jsx_import_source.len > 0 and !bun.strings.eql(options.jsx_import_source, "react")) {
        try out.writer(allocator).print("/** @jsxImportSource {s} */\n", .{options.jsx_import_source});
    }

    for (extracted.stmts) |stmt| {
        if (stmt.kind == .import_stmt) {
            try out.appendSlice(allocator, stmt.text);
            try out.append(allocator, '\n');
        }
    }
    try out.append(allocator, '\n');

    for (extracted.stmts) |stmt| {
        if (stmt.kind == .export_stmt) {
            try out.appendSlice(allocator, stmt.text);
            try out.append(allocator, '\n');
        }
    }

    if (fm) |f| {
        try out.appendSlice(allocator, "export const frontmatter = ");
        try emitFrontmatterAsJson(&out, allocator, f.yaml_content);
        try out.appendSlice(allocator, ";\n");
    }

    try out.appendSlice(allocator, "\nexport default function MDXContent(props) {\n");
    try out.appendSlice(allocator, "  const _components = Object.assign({");
    var first = true;
    for (renderer.component_names.keys()) |name| {
        if (!first) try out.appendSlice(allocator, ", ");
        try out.append(allocator, '"');
        try out.appendSlice(allocator, name);
        try out.appendSlice(allocator, "\": \"");
        try out.appendSlice(allocator, name);
        try out.append(allocator, '"');
        first = false;
    }
    try out.appendSlice(allocator, "}, props.components);\n");
    try out.appendSlice(allocator, "  return <>");
    try out.appendSlice(allocator, renderer.getOutput());
    try out.appendSlice(allocator, "</>;\n}\n");

    return out.toOwnedSlice(allocator);
}

fn emitFrontmatterAsJson(out: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, yaml_content: []const u8) !void {
    var first = true;
    try out.append(allocator, '{');
    var lines = std.mem.splitScalar(u8, yaml_content, '\n');
    while (lines.next()) |line| {
        const trimmed = bun.strings.trimSpaces(line);
        if (trimmed.len == 0 or trimmed[0] == '#') continue;
        const colon_index = bun.strings.indexOfChar(trimmed, ':') orelse continue;
        const key = bun.strings.trimSpaces(trimmed[0..colon_index]);
        const value = bun.strings.trimSpaces(trimmed[colon_index + 1 ..]);
        if (key.len == 0) continue;

        if (!first) try out.appendSlice(allocator, ", ");
        try out.append(allocator, '"');
        try appendJsonStringEscaped(out, allocator, key);
        try out.appendSlice(allocator, "\": ");
        try out.append(allocator, '"');
        try appendJsonStringEscaped(out, allocator, value);
        try out.append(allocator, '"');
        first = false;
    }
    try out.append(allocator, '}');
}

fn appendJsonStringEscaped(out: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, bytes: []const u8) !void {
    for (bytes) |c| {
        switch (c) {
            '\\' => try out.appendSlice(allocator, "\\\\"),
            '"' => try out.appendSlice(allocator, "\\\""),
            '\n' => try out.appendSlice(allocator, "\\n"),
            '\r' => try out.appendSlice(allocator, "\\r"),
            '\t' => try out.appendSlice(allocator, "\\t"),
            else => try out.append(allocator, c),
        }
    }
}

const bun = @import("bun");
const std = @import("std");
const md = @import("./root.zig");
const jsx_renderer = @import("./jsx_renderer.zig");
