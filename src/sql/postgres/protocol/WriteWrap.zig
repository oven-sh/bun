pub fn WriteWrap(comptime Container: type, comptime writeFn: anytype) type {
    return struct {
        pub fn write(this: *Container, context: anytype) AnyPostgresError!void {
            const Context = @TypeOf(context);
            try writeFn(this, Context, NewWriter(Context){ .wrapped = context });
        }
    };
}

const AnyPostgresError = @import("../AnyPostgresError.rust").AnyPostgresError;

const NewWriter = @import("./NewWriter.rust").NewWriter;
