const PreparedStatement = @This();

pub const PrepareOK = struct {
    status: u8 = 0,
    statement_id: u32,
    num_columns: u16,
    num_params: u16,
    warning_count: u16,

    pub fn decodeInternal(this: *PrepareOK, comptime Context: type, reader: NewReader(Context)) !void {
        this.status = try reader.int(u8);
        if (this.status != 0) {
            return error.InvalidPrepareOKPacket;
        }

        this.statement_id = try reader.int(u32);
        this.num_columns = try reader.int(u16);
        this.num_params = try reader.int(u16);
        _ = try reader.int(u8); // reserved_1
        this.warning_count = try reader.int(u16);
    }

    pub const decode = decoderWrap(PrepareOK, decodeInternal).decode;
};

pub const Execute = struct {
    /// ID of the prepared statement to execute, returned from COM_STMT_PREPARE
    statement_id: u32,
    /// Execution flags. Currently only CURSOR_TYPE_READ_ONLY (0x01) is supported
    flags: u8 = 0,
    /// Number of times to execute the statement (usually 1)
    iteration_count: u32 = 1,
    /// Parameter values to bind to the prepared statement
    params: []Value = &[_]Value{},
    /// Types of each parameter in the prepared statement
    param_types: []const Param,
    /// Whether to send parameter types. Set to true for first execution, false for subsequent executions
    new_params_bind_flag: bool,

    pub fn deinit(this: *Execute) void {
        for (this.params) |*param| {
            param.deinit(bun.default_allocator);
        }
    }

    fn writeNullBitmap(this: *const Execute, comptime Context: type, writer: NewWriter(Context)) AnyMySQLError.Error!void {
        const MYSQL_MAX_PARAMS = (std.math.maxInt(u16) / 8) + 1;

        var null_bitmap_buf: [MYSQL_MAX_PARAMS]u8 = undefined;
        const bitmap_bytes = (this.params.len + 7) / 8;
        const null_bitmap = null_bitmap_buf[0..bitmap_bytes];
        @memset(null_bitmap, 0);

        for (this.params, 0..) |param, i| {
            if (param == .null) {
                null_bitmap[i >> 3] |= @as(u8, 1) << @as(u3, @truncate(i & 7));
            }
        }

        try writer.write(null_bitmap);
    }

    pub fn writeInternal(this: *const Execute, comptime Context: type, writer: NewWriter(Context)) AnyMySQLError.Error!void {
        try writer.int1(@intFromEnum(CommandType.COM_STMT_EXECUTE));
        try writer.int4(this.statement_id);
        try writer.int1(this.flags);
        try writer.int4(this.iteration_count);

        if (this.params.len > 0) {
            try this.writeNullBitmap(Context, writer);

            // Write new params bind flag
            try writer.int1(@intFromBool(this.new_params_bind_flag));

            if (this.new_params_bind_flag) {
                // Write parameter types
                for (this.param_types) |param_type| {
                    debug("New params bind flag {s} unsigned? {}", .{ @tagName(param_type.type), param_type.flags.UNSIGNED });
                    try writer.int1(@intFromEnum(param_type.type));
                    try writer.int1(if (param_type.flags.UNSIGNED) 0x80 else 0);
                }
            }

            // Write parameter values
            for (this.params, this.param_types) |*param, param_type| {
                if (param.* == .null or param_type.type == .MYSQL_TYPE_NULL) continue;

                var value = try param.toData(param_type.type);
                defer value.deinit();
                if (param_type.type.isBinaryFormatSupported()) {
                    try writer.write(value.slice());
                } else {
                    try writer.writeLengthEncodedString(value.slice());
                }
            }
        }
    }

    pub const write = writeWrap(Execute, writeInternal).write;
};

const debug = bun.Output.scoped(.PreparedStatement, .hidden);

const AnyMySQLError = @import("./AnyMySQLError.zig");
const bun = @import("bun");
const std = @import("std");
const CommandType = @import("./CommandType.zig").CommandType;
const Param = @import("../MySQLStatement.zig").Param;
const Value = @import("../MySQLTypes.zig").Value;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;

const NewWriter = @import("./NewWriter.zig").NewWriter;
const writeWrap = @import("./NewWriter.zig").writeWrap;
