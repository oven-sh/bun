const std = @import("std");
const logger = bun.logger;
const importRecord = @import("../import_record.zig");
const js_ast = bun.ast;
const options = @import("../options.zig");
const fs = @import("../fs.zig");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const default_allocator = bun.default_allocator;
const JSC = bun.jsc;
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
    trim_whitespace: bool = false,
    dynamic_typing: bool = false,
    quote: []const u8 = "\"",

    comment_char: []const u8 = "#",
    comments: bool = false,
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
        var p = CSV.init(allocator, source_.*, log, .{
            .header = opts.header,
            .delimiter = opts.delimiter,
            .comments = opts.comments,
            .comment_char = opts.comment_char,
            .trim_whitespace = opts.trim_whitespace,
            .dynamic_typing = opts.dynamic_typing,
            .quote = opts.quote,
            .skip_empty_lines = opts.skip_empty_lines,
            .preview = opts.preview,
        });

        if (source_.contents.len != 0) {
            try p.runParser();
        }

        var return_value = Expr.init(E.Object, E.Object{}, .{ .start = 0 });

        const loc = logger.Loc{ .start = 0 };

        // Set data property in the result object
        try return_value.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "data" }, loc),
            .value = p.result.data_array,
        });

        // Set metadata fields according to CSVParserMetadata interface
        try return_value.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "rows" }, loc),
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.result.rows)) }, loc),
        });

        try return_value.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "columns" }, loc),
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.result.columns)) }, loc),
        });

        if (p.result.errors.data.e_array.items.len > 0) {
            try return_value.data.e_object.properties.append(p.allocator, .{
                .key = p.e(E.String{ .data = "errors" }, loc),
                .value = p.result.errors,
            });
        }

        if (p.result.comments.data.e_array.items.len > 0) {
            try return_value.data.e_object.properties.append(p.allocator, .{
                .key = p.e(E.String{ .data = "comments" }, loc),
                .value = p.result.comments,
            });
        }

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

        // Optimize for single character quotes
        if (quote.len == 1) {
            if (p.index < p.contents.len and p.contents[p.index] == quote[0]) {
                p.index += 1;
                return true;
            }
            return false;
        }

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

        // Optimize for single character quotes
        if (quote.len == 1) {
            return p.index < p.contents.len and p.contents[p.index] == quote[0];
        }

        // If we don't have enough characters left to match the quote, it can't match
        if (p.index + quote.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the quote, but don't consume
        return std.mem.eql(u8, p.contents[p.index .. p.index + quote.len], quote);
    }

    fn consumeDelimiter(p: *CSV) bool {
        const delimiter = p.options.delimiter;

        // Optimize for single character delimiters
        if (delimiter.len == 1) {
            if (p.index < p.contents.len and p.contents[p.index] == delimiter[0]) {
                p.index += 1;
                return true;
            }
            return false;
        }

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

        // Optimize for single character delimiters
        if (delimiter.len == 1) {
            return p.index < p.contents.len and p.contents[p.index] == delimiter[0];
        }

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

    // New internal function
    fn _parseField(p: *CSV) !struct { value: []const u8, was_quoted: bool } {
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
            // Non-quoted field - try to optimize with direct slicing when possible
            const field_start_index = p.index;

            // If no trimming needed, we can try to use direct slicing
            if (!p.options.trim_whitespace) {
                // Find the end of the field using slice operations for better performance
                var field_end_index = p.index;
                const delimiter = p.options.delimiter;

                // Use optimized search for single-character delimiters
                if (delimiter.len == 1) {
                    const delimiter_char = delimiter[0];

                    while (field_end_index < p.contents.len) {
                        const c = p.contents[field_end_index];

                        // Check for delimiter
                        if (c == delimiter_char) {
                            break;
                        }

                        // Check for line breaks - need to check codepoints for Unicode line breaks
                        // Save current position and check if we're at a line break
                        const saved_index = p.index;
                        p.index = field_end_index;
                        const at_line_break = p.isEndOfLine();
                        p.index = saved_index;

                        if (at_line_break) {
                            break;
                        }

                        // Check for comment character if enabled
                        if (p.options.comments and p.options.comment_char.len == 1 and c == p.options.comment_char[0]) {
                            break;
                        }

                        // Move to next codepoint (not just next byte) to properly handle UTF-8
                        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(p.contents.ptr[field_end_index]);
                        field_end_index += cp_len;
                    }

                    // Update parser position
                    p.index = field_end_index;

                    // Consume any whitespace between the end of the field and the delimiter
                    while (!p.checkDelimiter() and !p.isEndOfLine() and !p.isCommentLine()) {
                        _ = p.nextCodepoint();
                    }

                    // Return direct slice - no allocation needed!
                    return .{
                        .value = p.contents[field_start_index..field_end_index],
                        .was_quoted = false,
                    };
                } else {
                    // Multi-character delimiter - use indexOf for efficiency
                    const search_start = p.index;
                    while (search_start < p.contents.len) {
                        // Look for delimiter
                        if (std.mem.indexOf(u8, p.contents[search_start..], delimiter)) |delimiter_pos| {
                            field_end_index = search_start + delimiter_pos;
                        } else {
                            field_end_index = p.contents.len;
                        }

                        // Look for line breaks before the delimiter
                        var line_break_pos = search_start;
                        while (line_break_pos < field_end_index) {
                            // Check if we're at a line break using proper codepoint detection
                            const saved_index = p.index;
                            p.index = line_break_pos;
                            const at_line_break = p.isEndOfLine();
                            p.index = saved_index;

                            if (at_line_break) {
                                field_end_index = line_break_pos;
                                break;
                            }

                            // Move to next codepoint (not just next byte) to properly handle UTF-8
                            const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(p.contents.ptr[line_break_pos]);
                            line_break_pos += cp_len;
                        }

                        // Check for comment character if enabled
                        if (p.options.comments) {
                            if (std.mem.indexOf(u8, p.contents[search_start..field_end_index], p.options.comment_char)) |comment_pos| {
                                field_end_index = search_start + comment_pos;
                            }
                        }

                        break;
                    }

                    // Update parser position
                    p.index = field_end_index;

                    // Consume any whitespace between the end of the field and the delimiter
                    while (!p.checkDelimiter() and !p.isEndOfLine() and !p.isCommentLine()) {
                        _ = p.nextCodepoint();
                    }

                    // Return direct slice - no allocation needed!
                    return .{
                        .value = p.contents[field_start_index..field_end_index],
                        .was_quoted = false,
                    };
                }
            } else {
                // Trimming is enabled, so we need to process character by character
                var has_content = false;
                var last_non_whitespace_index = field.items.len;

                // Parse non-quoted field
                while (true) {
                    const c = p.peekCodepoint() orelse break;

                    if (p.isEndOfLine()) {
                        break;
                    }

                    // Check for delimiter
                    if (p.checkDelimiter()) {
                        break;
                    }

                    // Check for comment character (end of field)
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
        }

        // Consume any whitespace between the end of the field and the delimiter
        while (!p.checkDelimiter() and !p.isEndOfLine() and !p.isCommentLine()) {
            _ = p.nextCodepoint();
        }

        const field_value = try field.toOwnedSlice();

        // Apply trimming if enabled and field wasn't quoted
        const final_value = if (p.options.trim_whitespace and !is_quoted)
            strings.trim(field_value, " \t\n\r")
        else
            field_value;

        return .{
            .value = final_value,
            .was_quoted = is_quoted,
        };
    }
    pub fn parseField(p: *CSV, row_index: usize) !Expr {
        const field_result = try p._parseField();
        errdefer p.allocator.free(field_result.value); // _parseField allocates

        const loc = logger.Loc{ .start = @intCast(row_index) };

        if (p.options.dynamic_typing and !field_result.was_quoted) {
            return try p.parseValueWithDynamicTyping(field_result.value, loc);
        } else {
            return p.e(E.String{ .data = field_result.value }, loc);
        }
    }

    fn parseHeaderField(p: *CSV) ![]const u8 {
        const field_result = try p._parseField();
        return field_result.value;
    }

    fn parseRecord(p: *CSV, row_index: usize) !std.ArrayList(Expr) {
        var fields = std.ArrayList(Expr).init(p.allocator);
        errdefer fields.deinit();

        // Handle empty line case
        if (p.isEndOfLine()) {
            return fields;
        }

        // Check for comment at start of line (before first field)
        if (p.options.comments and p.isCommentLine()) {
            const comment_text = try p.parseCommentLine();
            errdefer p.allocator.free(comment_text);
            try p.addCommentToArray(comment_text);
            return fields; // Return empty record, comment will be processed
        }

        // Parse first field
        const first_field = try p.parseField(row_index);
        try fields.append(first_field);

        // Parse remaining fields
        while (p.consumeDelimiter()) {
            // Check for comment after delimiter (before next field)
            if (p.options.comments and p.isCommentLine()) {
                const comment_text = try p.parseCommentLine();
                errdefer p.allocator.free(comment_text);
                try p.addCommentToArray(comment_text);
                break; // Stop parsing fields, rest of line is comment
            }

            const field = try p.parseField(row_index);
            try fields.append(field);
        }

        // Check for comment at the end of the line (after all fields)
        if (p.options.comments and p.isCommentLine()) {
            const comment_text = try p.parseCommentLine();
            errdefer p.allocator.free(comment_text);
            try p.addCommentToArray(comment_text);
        }

        return fields;
    }

    fn parseHeaderRecord(p: *CSV) !std.ArrayList([]const u8) {
        var fields = std.ArrayList([]const u8).init(p.allocator);
        errdefer p.cleanupHeaderFields(&fields);

        // Handle empty header case
        if (p.isEndOfLine()) {
            return fields;
        }

        // Check for comment at start of line (before first field)
        if (p.options.comments and p.isCommentLine()) {
            const comment_text = try p.parseCommentLine();
            errdefer p.allocator.free(comment_text);
            try p.addCommentToArray(comment_text);
            return fields; // Return empty record, comment will be processed
        }

        // Parse first header field
        const first_field = try p.parseHeaderField();
        try fields.append(first_field);

        // Parse remaining header fields
        while (p.consumeDelimiter()) {
            // Check for comment after delimiter (before next field)
            if (p.options.comments and p.isCommentLine()) {
                const comment_text = try p.parseCommentLine();
                errdefer p.allocator.free(comment_text);
                try p.addCommentToArray(comment_text);
                break; // Stop parsing fields, rest of line is comment
            }

            const field = try p.parseHeaderField();
            try fields.append(field);
        }

        // Check for comment at the end of the line (after all fields)
        if (p.options.comments and p.isCommentLine()) {
            const comment_text = try p.parseCommentLine();
            errdefer p.allocator.free(comment_text);
            try p.addCommentToArray(comment_text);
        }

        return fields;
    }

    fn cleanupFields(_: *CSV, fields: *std.ArrayList(Expr)) void {
        fields.deinit();
    }

    fn cleanupHeaderFields(p: *CSV, fields: *std.ArrayList([]const u8)) void {
        for (fields.items) |field| {
            p.allocator.free(field);
        }
        fields.deinit();
    }

    fn processHeadersForDuplicates(p: *CSV, headers: []const []const u8) ![][]const u8 {
        var processed_headers = try p.allocator.alloc([]const u8, headers.len);
        var header_counts = std.HashMap([]const u8, usize, std.hash_map.StringContext, std.hash_map.default_max_load_percentage).init(p.allocator);
        defer header_counts.deinit();

        for (headers, 0..) |header, i| {
            const result = try header_counts.getOrPut(header);
            if (result.found_existing) {
                // This is a duplicate, increment count and create suffixed name
                result.value_ptr.* += 1;
                const suffixed_name = try std.fmt.allocPrint(p.allocator, "{s}_{d}", .{ header, result.value_ptr.* });
                processed_headers[i] = suffixed_name;
            } else {
                // First occurrence, set count to 0 and use original name
                result.value_ptr.* = 0;
                processed_headers[i] = try p.allocator.dupe(u8, header);
            }
        }

        return processed_headers;
    }

    fn isEmptyRecord(_: *CSV, record: std.ArrayList(Expr)) bool {
        if (record.items.len == 0) {
            return true;
        }

        for (record.items) |field| {
            // Check if this is a string field with content
            if (field.data == .e_string and field.data.e_string.data.len > 0) {
                return false;
            }
            // Non-string fields (numbers, booleans) are considered content
            if (field.data != .e_string) {
                return false;
            }
        }

        return true;
    }

    fn runParser(p: *CSV) anyerror!void {
        var all_records = std.ArrayList(std.ArrayList(Expr)).init(p.allocator);
        errdefer {
            for (all_records.items) |*record| {
                p.cleanupFields(record);
            }
            all_records.deinit();
        }

        var header_fields: ?std.ArrayList([]const u8) = null;
        errdefer if (header_fields) |*h| p.cleanupHeaderFields(h);

        // Parse Header (if applicable)
        if (p.options.header) {
            while (p.index < p.contents.len) {
                if (p.isCommentLine()) {
                    const comment_text = try p.parseCommentLine();
                    errdefer p.allocator.free(comment_text);
                    try p.addCommentToArray(comment_text);

                    _ = p.consumeEndOfLine();
                    continue;
                }
                if (p.isEndOfLine()) { // Skip empty lines before header
                    _ = p.consumeEndOfLine();
                    continue;
                }

                // Found the header line
                header_fields = try p.parseHeaderRecord();

                // we don't have to check if it's bigger, because it's the first line we encounter
                p.result.columns = header_fields.?.items.len;
                _ = p.consumeEndOfLine();
                break; // Exit header-finding loop
            }
        }

        // Parse all rows
        var records_processed: usize = 0;
        var expected_field_count: ?usize = if (header_fields) |h| h.items.len else null;

        while (p.index < p.contents.len) {
            // Check if this is a comment line first
            if (p.isCommentLine()) {
                const comment_text = try p.parseCommentLine();
                errdefer p.allocator.free(comment_text);

                try p.addCommentToArray(comment_text);

                // Skip CRLF after comment
                _ = p.consumeEndOfLine();
                continue;
            }

            var record = try p.parseRecord(records_processed);
            errdefer p.cleanupFields(&record);

            // Check for field count inconsistencies and add errors
            if (expected_field_count == null) {
                // First record sets the expected field count
                expected_field_count = record.items.len;
            } else if (record.items.len != expected_field_count.?) {
                // Field count mismatch - add error
                const error_msg = try std.fmt.allocPrint(p.allocator, "Field count mismatch: expected {d}, got {d}", .{ expected_field_count.?, record.items.len });
                errdefer p.allocator.free(error_msg);
                try p.addErrorToArray(error_msg);
            }

            // Skip CRLF between records
            if (!p.consumeEndOfLine()) {
                break;
            }

            if (p.options.skip_empty_lines and p.isEmptyRecord(record)) {
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

        // 3. Build Final AST
        if (header_fields) |h| {
            // Process headers to handle duplicates
            const processed_headers = try p.processHeadersForDuplicates(h.items);
            defer {
                for (processed_headers) |header| {
                    p.allocator.free(header);
                }
                p.allocator.free(processed_headers);
            }

            // Process as objects
            for (all_records.items, 0..) |record, idx| {
                var row_object = p.e(E.Object{}, .{ .start = 0 });
                for (0..processed_headers.len) |i| {
                    const key_data = try p.allocator.dupe(u8, processed_headers[i]);
                    const key_expr = p.e(E.String{ .data = key_data }, .{ .start = @intCast(idx) });

                    const value_expr = if (i < record.items.len)
                        record.items[i]
                    else
                        p.e(E.String{ .data = "" }, .{ .start = @intCast(idx) });

                    try row_object.data.e_object.properties.append(p.allocator, .{
                        .key = key_expr,
                        .value = value_expr,
                    });
                }
                try p.result.data_array.data.e_array.push(p.allocator, row_object);
            }
        } else {
            // Process as arrays
            for (all_records.items) |record| {
                var row_array = p.e(E.Array{}, .{ .start = 0 });
                for (record.items) |value_expr| {
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
        // currently lines are 0-indexed, check what other parsers do
        const loc = logger.Loc{ .start = @intCast(p.line_number) };

        var comment_obj = p.e(E.Object{}, loc);

        try comment_obj.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "line" }, loc),
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.line_number)) }, loc),
        });

        try comment_obj.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "text" }, loc),
            .value = p.e(E.String{ .data = strings.trim(comment_text, " \t\n\r") }, loc),
        });

        try p.result.comments.data.e_array.push(p.allocator, comment_obj);
    }

    fn addErrorToArray(p: *CSV, error_message: []const u8) !void {
        const loc = logger.Loc{ .start = @intCast(p.line_number) };

        var error_obj = p.e(E.Object{}, loc);

        try error_obj.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "line" }, loc),
            .value = p.e(E.Number{ .value = @as(f64, @floatFromInt(p.line_number)) }, loc),
        });

        try error_obj.data.e_object.properties.append(p.allocator, .{
            .key = p.e(E.String{ .data = "message" }, loc),
            .value = p.e(E.String{ .data = error_message }, loc),
        });

        try p.result.errors.data.e_array.push(p.allocator, error_obj);
    }

    /// Parse a string value with dynamic typing enabled
    /// Returns an Expr with the appropriate type: boolean, number, bigint, or string
    fn parseValueWithDynamicTyping(p: *CSV, value: []const u8, loc: logger.Loc) !Expr {
        // Apply trimming if enabled
        const trimmed_value = if (p.options.trim_whitespace)
            strings.trim(value, " \t\n\r")
        else
            value;

        // Empty string stays empty string
        if (trimmed_value.len == 0) {
            return p.e(E.String{ .data = trimmed_value }, loc);
        }

        // Try to parse as boolean first
        if (std.ascii.eqlIgnoreCase(trimmed_value, "true")) {
            return p.e(E.Boolean{ .value = true }, loc);
        } else if (std.ascii.eqlIgnoreCase(trimmed_value, "false")) {
            return p.e(E.Boolean{ .value = false }, loc);
        }

        // Check if the value is null
        if (std.ascii.eqlIgnoreCase(trimmed_value, "null")) {
            return p.e(E.Null{}, loc);
        }

        // Check for non-finite numeric values that should remain as strings
        if (std.ascii.eqlIgnoreCase(trimmed_value, "nan") or
            std.ascii.eqlIgnoreCase(trimmed_value, "infinity") or
            std.ascii.eqlIgnoreCase(trimmed_value, "-infinity"))
        {
            return p.e(E.String{ .data = trimmed_value }, loc);
        }

        // Try to parse as number
        if (std.fmt.parseFloat(f64, trimmed_value)) |parsed_number| {
            // Check if the parsed number is finite
            if (!std.math.isFinite(parsed_number)) {
                // Non-finite numbers (NaN, Infinity, -Infinity) should be strings
                return p.e(E.String{ .data = trimmed_value }, loc);
            }

            // Check if the number is within safe integer range
            if (@abs(parsed_number) <= @as(f64, @floatFromInt(JSC.MAX_SAFE_INTEGER)) and @trunc(parsed_number) == parsed_number) {
                // It's a safe integer, use as number
                return p.e(E.Number{ .value = parsed_number }, loc);
            } else if (@trunc(parsed_number) == parsed_number) {
                // We return BigInts as strings to align with other CSV JS parsers
                // TODO: add an option to parse when BigInt.toJS is implemented
                // return p.e(E.BigInt{ .value = trimmed_value }, loc);
                return p.e(E.String{ .data = trimmed_value }, loc);
            } else {
                // It's a floating point number
                return p.e(E.Number{ .value = parsed_number }, loc);
            }
        } else |_| {
            // Not a valid number, keep as string
            return p.e(E.String{ .data = trimmed_value }, loc);
        }
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
