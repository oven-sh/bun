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
    delimiter: u8 = ',',
    comments: bool = true,
    trim_whitespace: bool = false,
    dynamic_typing: bool = false,
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
        // Return empty array for empty files
        if (source_.contents.len == 0) {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = Expr.init(E.Array, E.Array{}, logger.Loc.Empty).data };
        }

        var parser = CSV.init(allocator, source_.*, log, opts);
        return try parser.runParser();
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

        // Check if field is quoted
        const is_quoted = p.consumeCodepoint('"');

        if (is_quoted) {
            // Parse quoted field
            while (true) {
                const c = p.nextCodepoint() orelse {
                    // Unexpected end of file inside quoted field
                    try p.log.addErrorFmt(&p.source, logger.Loc{ .start = @intCast(start_index) }, p.allocator, "Unexpected end of file inside quoted field", .{});
                    return error.UnexpectedEndOfFile;
                };

                if (c == '"') {
                    // Check if it's an escaped quote (two double quotes in a row)
                    if (p.consumeCodepoint('"')) {
                        // For quote character, just append the ASCII value
                        try field.append('"');
                    } else {
                        // End of quoted field
                        break;
                    }
                } else {
                    // Encode the Unicode codepoint to UTF-8 and append it
                    var buf: [4]u8 = undefined;
                    const len = strings.encodeWTF8RuneT(&buf, u21, c);
                    try field.appendSlice(buf[0..len]);
                }
            }
        } else {
            // Parse non-quoted field
            while (true) {
                const c = p.peekCodepoint() orelse break;

                if (c == p.options.delimiter or c == '\r' or c == '\n') {
                    break;
                }

                // Accept any character in non-quoted fields except separators and line endings
                _ = p.nextCodepoint();

                // Encode the Unicode codepoint to UTF-8 and append it
                var buf: [4]u8 = undefined;
                const len = strings.encodeWTF8RuneT(&buf, u21, c);
                try field.appendSlice(buf[0..len]);
            }
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
        while (p.consumeCodepoint(p.options.delimiter)) {
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

    fn runParser(p: *CSV) anyerror!Expr {
        const loc = logger.Loc{ .start = 0 };

        // Return empty array for empty files
        if (p.contents.len == 0) {
            return p.e(E.Array{}, loc);
        }

        // Create array for the results
        var result_array = p.e(E.Array{}, loc);

        if (p.options.header) {
            // Parse header
            const header_loc = logger.Loc{ .start = @intCast(p.index) };
            var header = try p.parseRecord();
            errdefer p.cleanupFields(&header);

            // Check if we have a valid header
            if (header.items.len == 0) {
                try p.log.addErrorFmt(&p.source, header_loc, p.allocator, "Empty header line", .{});
                return error.MalformedLine;
            }

            // Skip CRLF after header
            _ = p.consumeEndOfLine();

            // Process data records
            while (p.index < p.contents.len) {
                const record_loc = logger.Loc{ .start = @intCast(p.index) };
                var record = try p.parseRecord();
                errdefer p.cleanupFields(&record);

                // Skip empty lines
                if (record.items.len == 0) {
                    _ = p.consumeEndOfLine();
                    continue;
                }

                // Check for record size consistency
                if (record.items.len != header.items.len) {
                    try p.log.addErrorFmt(&p.source, record_loc, p.allocator, "Record on line {d} has {d} fields, but header has {d} fields", .{ p.line_number, record.items.len, header.items.len });
                    return error.MalformedLine;
                }

                // Create an object for this row
                var row_object = p.e(E.Object{}, record_loc);

                // Add each field to the object
                for (header.items, record.items) |key, value| {
                    const key_expr = p.e(E.String{ .data = key }, loc);
                    const value_expr = p.e(E.String{ .data = value }, loc);

                    try row_object.data.e_object.properties.push(p.allocator, .{
                        .key = key_expr,
                        .value = value_expr,
                    });
                }

                // Add the row object to the results array
                try result_array.data.e_array.push(p.allocator, row_object);

                // Skip CRLF between records
                if (!p.consumeEndOfLine()) {
                    break; // Last record may not have CRLF
                }
            }
        } else {
            // No header: treat all rows as arrays
            while (p.index < p.contents.len) {
                const record_loc = logger.Loc{ .start = @intCast(p.index) };
                var record = try p.parseRecord();
                errdefer p.cleanupFields(&record);

                // Skip empty lines
                if (record.items.len == 0) {
                    _ = p.consumeEndOfLine();
                    continue;
                }

                // Create an array for this row
                var row_array = p.e(E.Array{}, record_loc);

                for (record.items) |value| {
                    const value_expr = p.e(E.String{ .data = value }, loc);
                    try row_array.data.e_array.push(p.allocator, value_expr);
                }

                try result_array.data.e_array.push(p.allocator, row_array);

                // Skip CRLF between records
                if (!p.consumeEndOfLine()) {
                    break;
                }
            }
        }

        return result_array;
    }
};
