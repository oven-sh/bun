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
const strings = bun.strings;
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
    has_header: bool = true,
    delimiter: u8 = ',',
};

pub const CSV = struct {
    log: *logger.Log,
    allocator: std.mem.Allocator,
    source: logger.Source,
    contents: []const u8,
    index: usize,
    line_number: usize,
    options: CSVParserOptions,

    pub fn init(allocator: std.mem.Allocator, source: logger.Source, log: *logger.Log, opts: CSVParserOptions) CSV {
        return CSV{
            .allocator = allocator,
            .log = log,
            .source = source,
            .contents = source.contents,
            .index = 0,
            .line_number = 1,
            .options = opts,
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

    fn peekChar(p: *CSV) ?u8 {
        if (p.index >= p.contents.len) {
            return null;
        }
        return p.contents[p.index];
    }

    fn nextChar(p: *CSV) ?u8 {
        const c = p.peekChar();
        if (c != null) {
            p.index += 1;
        }
        return c;
    }

    fn consumeChar(p: *CSV, expected: u8) bool {
        if (p.peekChar()) |c| {
            if (c == expected) {
                p.index += 1;
                return true;
            }
        }
        return false;
    }

    fn isEndOfLine(p: *CSV) bool {
        if (p.index >= p.contents.len) return true;

        const remaining = p.contents.len - p.index;

        // Check for CRLF
        if (remaining >= 2 and p.contents[p.index] == '\r' and p.contents[p.index + 1] == '\n') {
            return true;
        }

        // Check for just CR or LF (non-standard but sometimes encountered)
        if (p.contents[p.index] == '\r' or p.contents[p.index] == '\n') {
            return true;
        }

        return false;
    }

    fn consumeEndOfLine(p: *CSV) bool {
        if (p.index >= p.contents.len) return true;

        const remaining = p.contents.len - p.index;

        // Check for CRLF (standard)
        if (remaining >= 2 and p.contents[p.index] == '\r' and p.contents[p.index + 1] == '\n') {
            p.index += 2;
            p.line_number += 1;
            return true;
        }

        // Check for just LF (non-standard but common)
        if (p.contents[p.index] == '\n') {
            p.index += 1;
            p.line_number += 1;
            return true;
        }

        // Check for just CR (very old Mac format)
        if (p.contents[p.index] == '\r') {
            p.index += 1;
            p.line_number += 1;
            return true;
        }

        return false;
    }

    pub fn parseField(p: *CSV) ![]const u8 {
        const start_index = p.index;
        var field = std.ArrayList(u8).init(p.allocator);
        errdefer field.deinit();

        // Check if field is quoted
        const is_quoted = p.consumeChar('"');

        if (is_quoted) {
            // Parse quoted field
            while (true) {
                const c = p.nextChar() orelse {
                    // Unexpected end of file inside quoted field
                    try p.log.addErrorFmt(&p.source, logger.Loc{ .start = @intCast(start_index) }, p.allocator, "Unexpected end of file inside quoted field", .{});
                    return error.UnexpectedEndOfFile;
                };

                if (c == '"') {
                    // Check if it's an escaped quote (two double quotes in a row)
                    if (p.consumeChar('"')) {
                        try field.append('"');
                    } else {
                        // End of quoted field
                        break;
                    }
                } else {
                    // Directly append all characters in quoted fields
                    try field.append(c);
                }
            }
        } else {
            // Parse non-quoted field
            while (true) {
                const c = p.peekChar() orelse break;

                if (c == p.options.delimiter or c == '\r' or c == '\n') {
                    break;
                }

                // Accept any character in non-quoted fields except separators and line endings
                _ = p.nextChar();
                try field.append(c);
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
        while (p.consumeChar(p.options.delimiter)) {
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

        if (p.options.has_header) {
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
