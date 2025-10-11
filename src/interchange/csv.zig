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

const OptionsError = error{
    EmptyDelimiter,
    EmptyQuote,
    EmptyCommentChar,
    InvalidPreview,
    QuoteEqualsDelimiter,
} || std.mem.Allocator.Error;

const ParserOptions = struct {
    header: bool,
    delimiter: []const u8,
    trim_whitespace: bool,
    dynamic_typing: bool,
    quote: []const u8,
    comment_char: []const u8,
    comments: bool,
    preview: ?usize,
    skip_empty_lines: bool,
};

pub const ParseDiagnostics = struct {
    rows: usize,
    columns: usize,
    comments: Expr,
    errors: Expr,
};

pub const ParseResult = struct {
    root: Expr,
    diagnostics: ParseDiagnostics,
};

fn normalizeOptions(opts: CSVParserOptions, source: *const logger.Source, log: *logger.Log) OptionsError!ParserOptions {
    if (opts.delimiter.len == 0) {
        try log.addError(source, locModuleScope, "CSV delimiter cannot be empty");
        return error.EmptyDelimiter;
    }

    if (opts.quote.len == 0) {
        try log.addError(source, locModuleScope, "CSV quote string cannot be empty");
        return error.EmptyQuote;
    }

    if (opts.comments and opts.comment_char.len == 0) {
        try log.addError(source, locModuleScope, "CSV comment character cannot be empty when comments are enabled");
        return error.EmptyCommentChar;
    }

    if (opts.preview) |limit| {
        if (limit == 0) {
            try log.addError(source, locModuleScope, "CSV preview value must be greater than 0");
            return error.InvalidPreview;
        }
    }

    if (std.mem.eql(u8, opts.quote, opts.delimiter)) {
        try log.addError(source, locModuleScope, "CSV quote string cannot be the same as delimiter");
        return error.QuoteEqualsDelimiter;
    }

    return ParserOptions{
        .header = opts.header,
        .delimiter = opts.delimiter,
        .trim_whitespace = opts.trim_whitespace,
        .dynamic_typing = opts.dynamic_typing,
        .quote = opts.quote,
        .comment_char = opts.comment_char,
        .comments = opts.comments,
        .preview = opts.preview,
        .skip_empty_lines = opts.skip_empty_lines,
    };
}

pub const CSV = struct {
    log: *logger.Log,
    allocator: std.mem.Allocator,
    source: logger.Source,
    contents: []const u8,
    index: usize,
    line_number: usize,
    options: ParserOptions,
    iterator: strings.CodepointIterator,
    cursor: strings.CodepointIterator.Cursor,

    result: ParseResult,

    pub fn init(allocator: std.mem.Allocator, source: logger.Source, log: *logger.Log, opts: ParserOptions) CSV {
        return CSV{
            .allocator = allocator,
            .log = log,
            .source = source,
            .contents = source.contents,
            .index = 0,
            .line_number = 1,
            .options = opts,
            .iterator = strings.CodepointIterator.init(source.contents),
            .cursor = .{},
            .result = ParseResult{
                .root = Expr.init(E.Array, E.Array{}, .{ .start = 0 }),
                .diagnostics = ParseDiagnostics{
                    .rows = 0,
                    .columns = 0,
                    .errors = Expr.init(E.Array, E.Array{}, .{ .start = 0 }),
                    .comments = Expr.init(E.Array, E.Array{}, .{ .start = 0 }),
                },
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

    pub fn parse(source_: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator, opts: CSVParserOptions) !Expr {
        bun.analytics.Features.csv_parse += 1;

        const result = try CSV.parseWithDiagnostics(source_, log, allocator, opts);

        const loc = logger.Loc{ .start = 0 };
        var object = Expr.init(E.Object, E.Object{}, loc);

        try object.data.e_object.properties.append(allocator, .{
            .key = Expr.init(E.String, E.String{ .data = "data" }, loc),
            .value = result.root,
        });

        try object.data.e_object.properties.append(allocator, .{
            .key = Expr.init(E.String, E.String{ .data = "rows" }, loc),
            .value = Expr.init(E.Number, E.Number{ .value = @as(f64, @floatFromInt(result.diagnostics.rows)) }, loc),
        });

        try object.data.e_object.properties.append(allocator, .{
            .key = Expr.init(E.String, E.String{ .data = "columns" }, loc),
            .value = Expr.init(E.Number, E.Number{ .value = @as(f64, @floatFromInt(result.diagnostics.columns)) }, loc),
        });

        if (result.diagnostics.errors.data.e_array.items.len > 0) {
            try object.data.e_object.properties.append(allocator, .{
                .key = Expr.init(E.String, E.String{ .data = "errors" }, loc),
                .value = result.diagnostics.errors,
            });
        }

        if (result.diagnostics.comments.data.e_array.items.len > 0) {
            try object.data.e_object.properties.append(allocator, .{
                .key = Expr.init(E.String, E.String{ .data = "comments" }, loc),
                .value = result.diagnostics.comments,
            });
        }

        return object;
    }

    pub fn parseWithDiagnostics(source_: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator, opts: CSVParserOptions) !ParseResult {
        const normalized = try normalizeOptions(opts, source_, log);
        var parser = CSV.init(allocator, source_.*, log, normalized);

        if (source_.contents.len != 0) {
            try parser.runParser();
        }

        return parser.result;
    }

    fn resetCursor(p: *CSV, index: usize) void {
        p.cursor = .{ .i = @intCast(index), .width = 0 };
        p.index = index;
    }

    fn advanceBytes(p: *CSV, count: usize) void {
        const remaining = p.contents.len - p.index;
        const advance = if (count > remaining) remaining else count;
        const new_index = p.index + advance;
        p.resetCursor(new_index);
    }

    inline fn cursorToCodePoint(cursor: strings.CodepointIterator.Cursor) u21 {
        const value: strings.CodePoint = cursor.c;
        return if (value < 0)
            strings.unicode_replacement
        else
            @as(u21, @intCast(value));
    }

    fn peekCodepoint(p: *CSV) ?u21 {
        var lookahead = p.cursor;
        if (!p.iterator.next(&lookahead)) {
            return null;
        }
        return cursorToCodePoint(lookahead);
    }

    fn nextCodepoint(p: *CSV) ?u21 {
        if (!p.iterator.next(&p.cursor)) {
            return null;
        }

        const start = @as(usize, @intCast(p.cursor.i));
        const width = @as(usize, @intCast(p.cursor.width));
        const new_index = start + width;
        p.index = if (new_index > p.contents.len) p.contents.len else new_index;

        return cursorToCodePoint(p.cursor);
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
            var lookahead = p.cursor;
            if (!p.iterator.next(&lookahead)) {
                return false;
            }
            if (cursorToCodePoint(lookahead) != quote[0]) {
                return false;
            }
            p.cursor = lookahead;
            const start = @as(usize, @intCast(lookahead.i));
            const width = @as(usize, @intCast(lookahead.width));
            const new_index = start + width;
            p.index = if (new_index > p.contents.len) p.contents.len else new_index;
            return true;
        }

        // If we don't have enough characters left to match the quote, it can't match
        if (p.index + quote.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the quote
        if (std.mem.eql(u8, p.contents[p.index .. p.index + quote.len], quote)) {
            p.advanceBytes(quote.len);
            return true;
        }

        return false;
    }

    fn checkQuote(p: *CSV) bool {
        const quote = p.options.quote;

        // Optimize for single character quotes
        if (quote.len == 1) {
            var lookahead = p.cursor;
            if (!p.iterator.next(&lookahead)) {
                return false;
            }
            return cursorToCodePoint(lookahead) == quote[0];
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
            var lookahead = p.cursor;
            if (!p.iterator.next(&lookahead)) {
                return false;
            }
            if (cursorToCodePoint(lookahead) != delimiter[0]) {
                return false;
            }
            p.cursor = lookahead;
            const start = @as(usize, @intCast(lookahead.i));
            const width = @as(usize, @intCast(lookahead.width));
            const new_index = start + width;
            p.index = if (new_index > p.contents.len) p.contents.len else new_index;
            return true;
        }

        // If we don't have enough characters left to match the delimiter, it can't match
        if (p.index + delimiter.len > p.contents.len) {
            return false;
        }

        // Check if the next characters match the delimiter
        if (std.mem.eql(u8, p.contents[p.index .. p.index + delimiter.len], delimiter)) {
            p.advanceBytes(delimiter.len);
            return true;
        }

        return false;
    }

    fn checkDelimiter(p: *CSV) bool {
        const delimiter = p.options.delimiter;

        // Optimize for single character delimiters
        if (delimiter.len == 1) {
            var lookahead = p.cursor;
            if (!p.iterator.next(&lookahead)) {
                return false;
            }
            return cursorToCodePoint(lookahead) == delimiter[0];
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

        const is_quoted = p.consumeQuote();

        if (is_quoted) {
            while (true) {
                if (p.checkQuote()) {
                    _ = p.consumeQuote();

                    if (p.checkQuote()) {
                        _ = p.consumeQuote();
                        try field.appendSlice(quote);
                    } else {
                        break;
                    }
                } else {
                    const c = p.nextCodepoint() orelse {
                        try p.log.addErrorFmt(&p.source, logger.Loc{ .start = @intCast(start_index) }, p.allocator, "Unexpected end of file inside quoted field", .{});
                        return error.UnexpectedEndOfFile;
                    };

                    var buf: [4]u8 = undefined;
                    const len = strings.encodeWTF8RuneT(&buf, u21, c);
                    try field.appendSlice(buf[0..len]);
                }
            }
        } else if (!p.options.trim_whitespace) {
            const field_start_index = p.index;

            while (true) {
                if (p.checkDelimiter() or p.isEndOfLine() or p.isCommentLine()) {
                    break;
                }

                if (p.nextCodepoint() == null) {
                    break;
                }
            }

            const field_end_index = p.index;

            while (!p.checkDelimiter() and !p.isEndOfLine() and !p.isCommentLine()) {
                if (p.nextCodepoint() == null) break;
            }

            return .{
                .value = p.contents[field_start_index..field_end_index],
                .was_quoted = false,
            };
        } else {
            var has_content = false;
            var last_non_whitespace_index = field.items.len;

            while (true) {
                const c = p.peekCodepoint() orelse break;

                if (p.isEndOfLine()) {
                    break;
                }

                if (p.checkDelimiter()) {
                    break;
                }

                if (p.options.comments and p.isCommentLine()) {
                    break;
                }

                _ = p.nextCodepoint();

                const should_append = !isUnicodeWhitespace(c) or has_content;

                if (isUnicodeWhitespace(c) and !has_content) {
                    continue;
                }

                if (!isUnicodeWhitespace(c)) {
                    has_content = true;
                    last_non_whitespace_index = field.items.len;
                }

                if (should_append) {
                    var buf: [4]u8 = undefined;
                    const len = strings.encodeWTF8RuneT(&buf, u21, c);
                    try field.appendSlice(buf[0..len]);

                    if (!isUnicodeWhitespace(c)) {
                        last_non_whitespace_index = field.items.len;
                    }
                }
            }

            if (field.items.len > 0) {
                field.shrinkRetainingCapacity(last_non_whitespace_index);
            }
        }

        while (!p.checkDelimiter() and !p.isEndOfLine() and !p.isCommentLine()) {
            if (p.nextCodepoint() == null) break;
        }

        const field_value = try field.toOwnedSlice();

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
        const loc = logger.Loc{ .start = @intCast(row_index) };
        if (p.options.dynamic_typing and !field_result.was_quoted) {
            const expr = try p.parseValueWithDynamicTyping(field_result.value, loc);
            if (expr.data != .e_string) {
                // value not used as a string; release buffer allocated by _parseField
                p.allocator.free(field_result.value);
            }
            return expr;
        } else {
            return p.e(E.String{ .data = field_result.value }, loc);
        }
    }

    fn parseHeaderField(p: *CSV) ![]const u8 {
        const field_result = try p._parseField();
        defer {
            // If _parseField allocated (quoted/trim path), free the temporary buffer after we dupe.
            // For direct slices, this is a no-op because we only dup the slice.
            // Heuristic: when quoted, _parseField always allocates; otherwise it may not.
            if (field_result.was_quoted or p.options.trim_whitespace) {
                p.allocator.free(field_result.value);
            }
        }
        // Return an owned copy so cleanupHeaderFields can always free safely.
        return try p.allocator.dupe(u8, field_result.value);
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
                p.result.diagnostics.columns = header_fields.?.items.len;
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
            if (record.items.len > p.result.diagnostics.columns) {
                p.result.diagnostics.columns = record.items.len;
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
                try p.result.root.data.e_array.push(p.allocator, row_object);
            }
        } else {
            // Process as arrays
            for (all_records.items) |record| {
                var row_array = p.e(E.Array{}, .{ .start = 0 });
                for (record.items) |value_expr| {
                    try row_array.data.e_array.push(p.allocator, value_expr);
                }
                try p.result.root.data.e_array.push(p.allocator, row_array);
            }
        }

        p.result.diagnostics.rows = all_records.items.len;
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
        p.advanceBytes(comment_char.len);

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

        try p.result.diagnostics.comments.data.e_array.push(p.allocator, comment_obj);
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

        try p.result.diagnostics.errors.data.e_array.push(p.allocator, error_obj);
    }

    /// Check if a string is a valid decimal literal (not hex/octal/binary)
    fn isDecimalLiteral(str: []const u8) bool {
        if (str.len == 0) return false;

        var i: usize = 0;

        // Skip optional sign
        if (str[i] == '+' or str[i] == '-') {
            i += 1;
            if (i >= str.len) return false;
        }

        // Check for hex (0x/0X), octal (0o/0O), or binary (0b/0B) prefix
        if (str[i] == '0' and i + 1 < str.len) {
            const next_char = str[i + 1];
            if (next_char == 'x' or next_char == 'X' or
                next_char == 'o' or next_char == 'O' or
                next_char == 'b' or next_char == 'B')
            {
                return false;
            }
        }

        // Must have at least one digit
        var has_digit = false;
        var has_dot = false;
        var has_exp = false;

        while (i < str.len) {
            const c = str[i];

            if (c >= '0' and c <= '9') {
                has_digit = true;
                i += 1;
            } else if (c == '.') {
                // Can't have two dots or dot after exponent
                if (has_dot or has_exp) return false;
                has_dot = true;
                i += 1;
            } else if (c == 'e' or c == 'E') {
                // Must have digit before exponent, can't have two exponents
                if (!has_digit or has_exp) return false;
                has_exp = true;
                i += 1;

                // Optional sign after exponent
                if (i < str.len and (str[i] == '+' or str[i] == '-')) {
                    i += 1;
                }

                // Must have at least one digit after exponent
                if (i >= str.len or str[i] < '0' or str[i] > '9') {
                    return false;
                }

                // Continue parsing digits after exponent
                while (i < str.len and str[i] >= '0' and str[i] <= '9') {
                    i += 1;
                }

                // No more characters allowed after exponent digits
                break;
            } else if (c == 'n') {
                // BigInt suffix - not a decimal literal
                return false;
            } else {
                // Invalid character
                return false;
            }
        }

        return has_digit;
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

        // Only try to parse as number if it's a valid decimal literal
        if (isDecimalLiteral(trimmed_value)) {
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
                // parseFloat failed despite being a decimal literal format
                // This shouldn't happen, but keep as string to be safe
                return p.e(E.String{ .data = trimmed_value }, loc);
            }
        }

        // Not a decimal literal, keep as string
        return p.e(E.String{ .data = trimmed_value }, loc);
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

const std = @import("std");

const bun = @import("bun");
const JSC = bun.jsc;

const logger = bun.logger;
const ast = bun.ast;
const strings = bun.strings;

const E = ast.E;
const Expr = ast.Expr;
const locModuleScope = logger.Loc.Empty;
