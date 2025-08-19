pub fn decode(context: anytype, comptime ContextType: type, reader: NewReader(ContextType), comptime forEach: fn (@TypeOf(context), index: u32, bytes: ?*Data) AnyPostgresError!bool) AnyPostgresError!void {
    var remaining_bytes = try reader.length();
    remaining_bytes -|= 4;

    const remaining_fields: usize = @intCast(@max(try reader.short(), 0));

    for (0..remaining_fields) |index| {
        const byte_length = try reader.int4();
        switch (byte_length) {
            0 => {
                var empty = Data.Empty;
                if (!try forEach(context, @intCast(index), &empty)) break;
            },
            null_int4 => {
                if (!try forEach(context, @intCast(index), null)) break;
            },
            else => {
                var bytes = try reader.bytes(@intCast(byte_length));
                if (!try forEach(context, @intCast(index), &bytes)) break;
            },
        }
    }
}

pub const null_int4 = 4294967295;

const Data = @import("../../shared/Data.zig").Data;

const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;

const NewReader = @import("./NewReader.zig").NewReader;
