pub fn WriteWrap(comptime Container: type, comptime writeFn: anytype) type {
    return struct {
        pub fn write(this: *Container, context: anytype) AnyPostgresError!void {
            const Context = @TypeOf(context);
            try writeFn(this, Context, NewWriter(Context){ .wrapped = context });
        }
    };
}

const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;

const NewWriter = @import("./NewWriter.zig").NewWriter;
