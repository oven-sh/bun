const bun = @import("root").bun;
const std = @import("std");
const ZigErrorType = @import("ZigErrorType.zig").ZigErrorType;
const ErrorCode = @import("ErrorCode.zig").ErrorCode;
const typeBaseName = @import("../../meta.zig").typeBaseName;

pub fn Errorable(comptime Type: type) type {
    return extern struct {
        result: Result,
        success: bool,
        pub const name = "Errorable" ++ typeBaseName(@typeName(Type));

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

        threadlocal var err_buf: [4096]u8 = undefined;
        pub fn err(code: anyerror, ptr: *anyopaque) @This() {
            return @This(){
                .result = .{
                    .err = .{
                        .code = ErrorCode.from(code),
                        .ptr = ptr,
                    },
                },
                .success = false,
            };
        }
    };
}
