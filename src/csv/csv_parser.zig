const std = @import("std");
const logger = bun.logger;
const importRecord = @import("../import_record.zig");
const js_ast = bun.JSAst;
const options = @import("../options.zig");
const fs = @import("../fs.zig");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = @import("../string_immutable.zig");
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const expect = std.testing.expect;
const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const assert = bun.assert;

const LocRef = js_ast.LocRef;
const S = js_ast.S;
const B = js_ast.B;
const G = js_ast.G;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const Symbol = js_ast.Symbol;
const Level = js_ast.Op.Level;
const Op = js_ast.Op;
const Scope = js_ast.Scope;
const locModuleScope = logger.Loc.Empty;

pub const Error = error{
    UnexpectedEndOfFile,
    InvalidCharacter,
    MalformedLine,
};

pub const CSVParserOptions = struct {
    header: bool = true,
    delimiter: []const u8 = ",",
    comments: bool = true,
    comment_char: []const u8 = "#",
    trim_whitespace: bool = false,
    dynamic_typing: bool = false,
    quote: []const u8 = "\"",
    preview: ?usize = null,
    skip_empty_lines: bool = false,
};

const CSVParseResult = struct {
    data_array: Expr,
    rows: usize,
    columns: usize,
    comments: Expr,
    errors: Expr,
};

pub const CSV = struct {
    log: *logger.Log,
    allocator: std.mem.Allocator,
    source: logger.Source,
    contents: []const u8,
    index: usize,
    line_number: usize,
    options: CSVParserOptions,
    iterator: strings.CodepointIterator,

    result: CSVParseResult,

    pub fn init(allocator: std.mem.Allocator, source: logger.Source, log: *logger.Log, opts: CSVParserOptions) CSV {
        return CSV{
            .allocator = allocator,
            .log = log,
            .source = source,
            .contents = source.contents,
            .index = 0,
            .line_number = 1,
            .options = opts,
            .iterator = strings.CodepointIterator.init(source.contents),
            .result = CSVParseResult{
                .data_array = Expr.init(E.Array, E.Array{}, .{ .start = 0 }),
                .rows = 0,
                .columns = 0,
                .errors = Expr.init(E.Array, E.Array{}, .{ .start = 0 }),
                .comments = Expr.init(E.Array, E.Array{}, .{ .start = 0 }),
            },
        };
    }

    pub fn e(_: *CSV, t: anytype, loc: logger.Loc) Expr {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .pointer) {
            return Expr.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Expr.init(Type, t, loc);
        }
    }

    pub fn parse(source_: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator, _: bool, opts: CSVParserOptions) !Expr {
        // we don't consider header a record if it's a header
        var _preview = opts.preview;
        if (_preview != null and opts.header) {
            _preview.? += 1;
        }

        var p = CSV.init(allocator, source_.*, log, .{
            .header = opts.header,
            .delimiter = opts.delimiter,
            .comments = opts.comments,
            .comment_char = opts.comment_char,
            .trim_whitespace = opts.trim_whitespace,
            .dynamic_typing = opts.dynamic_typing,
            .quote = opts.quote,
            .skip_empty_lines = opts.skip_empty_lines,
            // overrides:
            .preview = _preview,
        });

        if (source_.contents.len != 0) {
            try p.runParser();
        }

        var return_value = Expr.init(E.Object, E.Object{}, .{ .start = 0 });

        const loc = logger.Loc{ .start = 0 };

        // Set data property in the result object
        try return_value.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "data" }, loc),
            .value = p.result.data_array,
        });

        // Set metadata fields according to CSVParserMetadata interface
        try return_value.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "rows" }, loc),
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.result.rows)) }, loc),
        });

        try return_value.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "columns" }, loc),
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.result.columns)) }, loc),
        });

        try return_value.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "errors" }, loc),
            .value = p.result.errors,
        });

        // Add comments array
        try return_value.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "comments" }, loc),
            .value = p.result.comments,
        });

        return return_value;
    }

    fn peekCodepoint(p: *CSV) ?u21 {
        if (p.index >= p.contents.len) {
            return null;
        }
        const slice = p.nextCodepointSlice();
        const code_point = switch (slice.len) {
            0 => null,
            1 => @as(u21, slice[0]),
            else => strings.decodeWTF8RuneTMultibyte(slice.ptr[0..4], @as(u3, @intCast(slice.len)), u21, strings.unicode_replacement),
        };
        return code_point;
    }

    fn nextCodepointSlice(p: *CSV) []const u8 {
        if (p.index >= p.contents.len) {
            return "";
        }
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(p.contents.ptr[p.index]);
        return if (!(cp_len + p.index > p.contents.len)) p.contents[p.index .. cp_len + p.index] else "";
    }

    fn nextCodepoint(p: *CSV) ?u21 {
        if (p.index >= p.contents.len) {
            return null;
        }
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(p.contents.ptr[p.index]);
        const slice = if (!(cp_len + p.index > p.contents.len)) p.contents[p.index .. cp_len + p.index] else "";

        const code_point = switch (slice.len) {
            0 => null,
            1 => @as(u21, slice[0]),
            else => strings.decodeWTF8RuneTMultibyte(slice.ptr[0..4], @as(u3, @intCast(slice.len)), u21, strings.unicode_replacement),
        };

        p.index += if (code_point != strings.unicode_replacement and code_point != null)
            cp_len
        else if (slice.len > 0)
            1
        else
            0;

        return code_point;
    }

    fn consumeCodepoint(p: *CSV, expected: u21) bool {
        if (p.peekCodepoint()) |c| {
            if (c == expected) {
                _ = p.nextCodepoint();
                return true;
            }
        }
        return false;
    }

    fn consumeQuote(p: *CSV) bool {
        const quote = p.options.quote;

        // If we don't have enough characters left to match the quote, it can't match
        if (p.index + quote.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the quote
        if (std.mem.eql(u8, p.contents[p.index .. p.index + quote.len], quote)) {
            p.index += quote.len;
            return true;
        }

        return false;
    }

    fn checkQuote(p: *CSV) bool {
        const quote = p.options.quote;

        // If we don't have enough characters left to match the quote, it can't match
        if (p.index + quote.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the quote, but don't consume
        return std.mem.eql(u8, p.contents[p.index .. p.index + quote.len], quote);
    }

    fn consumeDelimiter(p: *CSV) bool {
        const delimiter = p.options.delimiter;

        // If we don't have enough characters left to match the delimiter, it can't match
        if (p.index + delimiter.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the delimiter
        if (std.mem.eql(u8, p.contents[p.index .. p.index + delimiter.len], delimiter)) {
            p.index += delimiter.len;
            return true;
        }

        return false;
    }

    fn checkDelimiter(p: *CSV) bool {
        const delimiter = p.options.delimiter;

        // If we don't have enough characters left to match the delimiter, it can't match
        if (p.index + delimiter.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the delimiter
        return std.mem.eql(u8, p.contents[p.index .. p.index + delimiter.len], delimiter);
    }

    fn isLineBreakChar(c: u21) bool {
        return c == '\n' or // LF (Line Feed, U+000A)
            c == '\r' or // CR (Carriage Return, U+000D)
            c == 0x0085 or // NEL (Next Line)
            c == 0x2028 or // LS (Line Separator)
            c == 0x2029; // PS (Paragraph Separator)
    }

    fn checkLineBreak(p: *CSV, consume: bool) bool {
        if (p.index >= p.contents.len) return true;

        if (p.peekCodepoint()) |c| {
            // Check for CRLF (Windows line endings)
            if (c == '\r') {
                if (consume) {
                    _ = p.nextCodepoint(); // consume '\r'

                    // Check if it's followed by '\n'
                    if (p.peekCodepoint()) |next_c| {
                        if (next_c == '\n') {
                            _ = p.nextCodepoint(); // consume '\n'
                            p.line_number += 1;
                        } else {
                            // Just a CR - still a valid line break
                            p.line_number += 1;
                        }
                    } else {
                        // Just a CR at the end of the file
                        p.line_number += 1;
                    }
                }
                return true;
            }

            // Check for other line breaks
            if (isLineBreakChar(c)) {
                if (consume) {
                    _ = p.nextCodepoint(); // consume the line break
                    p.line_number += 1;
                }
                return true;
            }
        }

        return false;
    }

    fn isEndOfLine(p: *CSV) bool {
        return checkLineBreak(p, false);
    }

    fn consumeEndOfLine(p: *CSV) bool {
        return checkLineBreak(p, true);
    }

    pub fn parseField(p: *CSV) ![]const u8 {
        const start_index = p.index;
        var field = std.ArrayList(u8).init(p.allocator);
        errdefer field.deinit();

        const quote = p.options.quote;

        // Check if field is quoted
        const is_quoted = p.consumeQuote();

        if (is_quoted) {
            // Parse quoted field
            while (true) {
                // Check for quote character sequence
                if (p.checkQuote()) {
                    // Consume the quote first
                    _ = p.consumeQuote();

                    // Check if it's an escaped quote (two quote sequences in a row)
                    if (p.checkQuote()) {
                        _ = p.consumeQuote(); // Consume the second quote
                        try field.appendSlice(quote);
                    } else {
                        // End of quoted field
                        break;
                    }
                } else {
                    // Get the next character
                    const c = p.nextCodepoint() orelse {
                        // Unexpected end of file inside quoted field
                        try p.log.addErrorFmt(&p.source, logger.Loc{ .start = @intCast(start_index) }, p.allocator, "Unexpected end of file inside quoted field", .{});
                        return error.UnexpectedEndOfFile;
                    };

                    // In quoted fields, we can have linebreaks according to the grammar
                    // Encode the Unicode codepoint to UTF-8 and append it
                    var buf: [4]u8 = undefined;
                    const len = strings.encodeWTF8RuneT(&buf, u21, c);
                    try field.appendSlice(buf[0..len]);
                }
            }
        } else {
            // For non-quoted fields, track if we've seen non-whitespace content
            var has_content = false;

            // Keep track of trailing whitespace for trimming if needed
            var last_non_whitespace_index = field.items.len;

            // Parse non-quoted field
            while (true) {
                const c = p.peekCodepoint() orelse break;

                if (p.isEndOfLine()) {
                    break;
                }

                // Check for delimiter
                if (p.index + p.options.delimiter.len <= p.contents.len) {
                    if (std.mem.eql(u8, p.contents[p.index .. p.index + p.options.delimiter.len], p.options.delimiter)) {
                        break;
                    }
                }

                // Check for comment character (comments can appear anywhere in the line)
                if (p.options.comments and p.isCommentLine()) {
                    break;
                }

                // Accept any character in non-escaped fields except separators and line endings
                _ = p.nextCodepoint();

                // Determine if we should append the character or skip it for trimming
                const should_append = !p.options.trim_whitespace or !isUnicodeWhitespace(c) or has_content;

                // If this is leading whitespace and we're trimming, skip it
                if (p.options.trim_whitespace and isUnicodeWhitespace(c) and !has_content) {
                    continue;
                }

                // Mark that we've seen non-whitespace content
                if (!isUnicodeWhitespace(c)) {
                    has_content = true;
                    last_non_whitespace_index = field.items.len;
                }

                // Encode the Unicode codepoint to UTF-8 and append it
                if (should_append) {
                    var buf: [4]u8 = undefined;
                    const len = strings.encodeWTF8RuneT(&buf, u21, c);
                    try field.appendSlice(buf[0..len]);

                    // Update last non-whitespace position if this isn't whitespace
                    if (!isUnicodeWhitespace(c)) {
                        last_non_whitespace_index = field.items.len;
                    }
                }
            }

            // Trim trailing whitespace if option is enabled
            if (p.options.trim_whitespace and field.items.len > 0) {
                field.shrinkRetainingCapacity(last_non_whitespace_index);
            }
        }

        // Consume any whitespace between the end of the field and the delimiter
        while (!p.checkDelimiter() and !p.isEndOfLine() and !p.isCommentLine()) {
            _ = p.nextCodepoint();
        }

        return field.toOwnedSlice();
    }

    fn parseRecord(p: *CSV) !std.ArrayList([]const u8) {
        var fields = std.ArrayList([]const u8).init(p.allocator);
        errdefer {
            for (fields.items) |item| {
                p.allocator.free(item);
            }
            fields.deinit();
        }

        // Handle empty line case
        if (p.isEndOfLine()) {
            return fields;
        }

        // Parse first field
        const first_field = try p.parseField();
        try fields.append(first_field);

        // Parse remaining fields
        while (p.consumeDelimiter()) {
            const field = try p.parseField();
            try fields.append(field);
        }

        return fields;
    }

    fn cleanupFields(p: *CSV, fields: *std.ArrayList([]const u8)) void {
        for (fields.items) |item| {
            p.allocator.free(item);
        }
        fields.deinit();
    }

    fn isEmptyRecord(record: std.ArrayList([]const u8)) bool {
        if (record.items.len == 0) {
            return true;
        }

        for (record.items) |field| {
            if (field.len > 0) {
                return false;
            }
        }

        return true;
    }

    fn runParser(p: *CSV) anyerror!void {
        var all_records = std.ArrayList(std.ArrayList([]const u8)).init(p.allocator);
        errdefer {
            for (all_records.items) |*record| {
                p.cleanupFields(record);
            }
            all_records.deinit();
        }

        // First read all rows
        var records_processed: usize = 0;
        while (p.index < p.contents.len) {
            var record = try p.parseRecord();
            errdefer p.cleanupFields(&record);

            // Check if this is a comment line
            if (p.isCommentLine()) {
                const comment_text = try p.parseCommentLine();
                errdefer p.allocator.free(comment_text);

                try p.addCommentToArray(comment_text);

                // Skip CRLF after comment
                _ = p.consumeEndOfLine();
                continue;
            }

            // Skip CRLF between records
            if (!p.consumeEndOfLine()) {
                break;
            }

            if (p.options.skip_empty_lines and isEmptyRecord(record)) {
                continue;
            }

            // Update columns count if this record has more columns
            if (record.items.len > p.result.columns) {
                p.result.columns = record.items.len;
            }

            try all_records.append(record);
            records_processed += 1;

            if (p.options.preview != null and records_processed >= p.options.preview.?) {
                break;
            }
        }

        // Prepare the output format depending on the header option
        if (all_records.items.len > 0 and p.options.header) {
            // First row is the header
            var header = all_records.orderedRemove(0);
            errdefer p.cleanupFields(&header);

            // Process remaining rows as objects with the header keys
            for (all_records.items, 0..) |record, idx| {
                const record_loc = logger.Loc{ .start = 0 };

                // Create an object for this row
                var row_object = p.e(E.Object{}, record_loc);

                // Add each field to the object, using empty string as fallback if record is shorter than header
                for (0..header.items.len) |i| {
                    const key = header.items[i];
                    const key_expr = p.e(E.String{ .data = key }, .{ .start = @intCast(idx) });

                    var value_expr: Expr = undefined;
                    if (i < record.items.len) {
                        // We have a value for this header
                        value_expr = p.e(E.String{ .data = record.items[i] }, .{ .start = @intCast(idx) });
                    } else {
                        // No value, use empty string as fallback
                        value_expr = p.e(E.String{ .data = "" }, .{ .start = @intCast(idx) });
                    }

                    try row_object.data.e_object.properties.push(p.allocator, .{
                        .key = key_expr,
                        .value = value_expr,
                    });
                }

                try p.result.data_array.data.e_array.push(p.allocator, row_object);
            }
        } else {
            // Process all rows as arrays (no header conversion)
            for (all_records.items, 0..) |record, idx| {
                const record_loc = logger.Loc{ .start = 0 };

                // Create an array for this row
                var row_array = p.e(E.Array{}, record_loc);

                for (record.items) |value| {
                    var value_expr: Expr = undefined;

                    if (p.options.trim_whitespace) {
                        value_expr = p.e(E.String{ .data = strings.trim(value, " \t\n\r") }, .{ .start = @intCast(idx) });
                    } else {
                        value_expr = p.e(E.String{ .data = value }, .{ .start = @intCast(idx) });
                    }
                    try row_array.data.e_array.push(p.allocator, value_expr);
                }

                try p.result.data_array.data.e_array.push(p.allocator, row_array);
            }
        }

        p.result.rows = all_records.items.len;
    }

    fn isCommentLine(p: *CSV) bool {
        // If comments are disabled, never consider any line a comment
        if (!p.options.comments) {
            return false;
        }

        const comment_char = p.options.comment_char;

        // If we don't have enough characters left to match the comment char, it can't match
        if (p.index + comment_char.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the comment char
        return std.mem.eql(u8, p.contents[p.index .. p.index + comment_char.len], comment_char);
    }

    fn parseCommentLine(p: *CSV) ![]const u8 {
        const comment_char = p.options.comment_char;
        var comment = std.ArrayList(u8).init(p.allocator);
        errdefer comment.deinit();

        // Skip the comment character
        p.index += comment_char.len;

        // Read until end of line
        while (true) {
            const c = p.peekCodepoint() orelse break;

            if (p.isEndOfLine()) {
                break;
            }

            // Accept any character in comment except line endings
            _ = p.nextCodepoint();

            // Encode the Unicode codepoint to UTF-8 and append it
            var buf: [4]u8 = undefined;
            const len = strings.encodeWTF8RuneT(&buf, u21, c);
            try comment.appendSlice(buf[0..len]);
        }

        return comment.toOwnedSlice();
    }

    fn addCommentToArray(p: *CSV, comment_text: []const u8) !void {
        const loc = logger.Loc{ .start = @intCast(p.line_number) };

        var comment_obj = p.e(E.Object{}, loc);

        try comment_obj.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "line" }, loc),
            // TODO: figure out why the line number is off by one
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.line_number - 1)) }, loc),
        });

        try comment_obj.data.e_object.properties.push(p.allocator, .{
            .key = p.e(E.String{ .data = "text" }, loc),
            .value = p.e(E.String{ .data = strings.trim(comment_text, " \t\n\r") }, loc),
        });

        try p.result.comments.data.e_array.push(p.allocator, comment_obj);
    }
};

fn isUnicodeWhitespace(cp: u21) bool {
    // List includes ASCII and common Unicode whitespace code points
    return cp == 0x0009 // Tab
    or cp == 0x000A // Line Feed
    or cp == 0x000B // Vertical Tab
    or cp == 0x000C // Form Feed
    or cp == 0x000D // Carriage Return
    or cp == 0x0020 // Space
    or cp == 0x0085 // Next Line
    or cp == 0x00A0 // No-Break Space
    or cp == 0x1680 // Ogham Space Mark
    or (cp >= 0x2000 and cp <= 0x200A) // En Quad to Hair Space
    or cp == 0x2028 // Line Separator
    or cp == 0x2029 // Paragraph Separator
    or cp == 0x202F // Narrow No-Break Space
    or cp == 0x205F // Medium Mathematical Space
    or cp == 0x3000; // Ideographic Space
}
