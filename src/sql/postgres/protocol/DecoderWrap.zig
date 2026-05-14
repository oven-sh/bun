pub fn DecoderWrap(comptime Container: type, comptime decodeFn: anytype) type {
    return struct {
        pub fn decode(this: *Container, context: anytype) AnyPostgresError!void {
            const Context = @TypeOf(context);
            try decodeFn(this, Context, NewReader(Context){ .wrapped = context });
        }
    };
}

const AnyPostgresError = @import("../AnyPostgresError.rust").AnyPostgresError;

const NewReader = @import("./NewReader.rust").NewReader;
