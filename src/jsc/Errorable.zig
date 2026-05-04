pub fn Errorable(comptime Type: type) type {
    return extern struct {
        result: Result,
        success: bool,

        pub const Result = extern union {
            value: Type,
            err: ZigErrorType,
        };

        pub fn unwrap(errorable: @This()) !Type {
            if (errorable.success) {
                return errorable.result.value;
            } else {
                return errorable.result.err.code.toError();
            }
        }

        pub fn value(val: Type) @This() {
            return @This(){ .result = .{ .value = val }, .success = true };
        }

        pub fn ok(val: Type) @This() {
            return @This(){ .result = .{ .value = val }, .success = true };
        }

        pub fn err(code: anyerror, err_value: bun.jsc.JSValue) @This() {
            return @This(){
                .result = .{
                    .err = .{
                        .code = ErrorCode.from(code),
                        .value = err_value,
                    },
                },
                .success = false,
            };
        }
    };
}

const bun = @import("bun");
const ErrorCode = @import("./ErrorCode.zig").ErrorCode;
const ZigErrorType = @import("./ZigErrorType.zig").ZigErrorType;
