fn isOomOnlyError(comptime ErrorUnionOrSet: type) bool {
    @setEvalBranchQuota(10000);
    const ErrorSet = switch (@typeInfo(ErrorUnionOrSet)) {
        .error_union => |union_info| union_info.error_set,
        .error_set => ErrorUnionOrSet,
        else => @compileError("argument must be an error union or error set"),
    };
    for (@typeInfo(ErrorSet).error_set orelse return false) |err| {
        if (!std.mem.eql(u8, err.name, "OutOfMemory")) return false;
    }
    return true;
}

/// If `error_union_or_set` is `error.OutOfMemory`, calls `bun.outOfMemory`. Otherwise:
///
/// * If that was the only possible error, returns the non-error payload for error unions, or
///   `noreturn` for error sets.
/// * If other errors are possible, returns the same error union or set, but without
///   `error.OutOfMemory` in the error set.
///
/// Prefer this method over `catch bun.outOfMemory()`, since that could mistakenly catch
/// non-OOM-related errors.
///
/// There are two ways to use this function:
///
/// ```
/// // option 1:
/// const thing = bun.handleOom(allocateThing());
/// // option 2:
/// const thing = allocateThing() catch |err| bun.handleOom(err);
/// ```
pub fn handleOom(error_union_or_set: anytype) return_type: {
    const ArgType = @TypeOf(error_union_or_set);
    const arg_info = @typeInfo(ArgType);
    break :return_type if (isOomOnlyError(ArgType)) switch (arg_info) {
        .error_union => |union_info| union_info.payload,
        .error_set => noreturn,
        else => unreachable,
    } else @TypeOf(blk: {
        const err = switch (comptime arg_info) {
            .error_union => if (error_union_or_set) |success| break :blk success else |err| err,
            .error_set => error_union_or_set,
            else => unreachable,
        };
        break :blk switch (err) {
            error.OutOfMemory => unreachable,
            else => |other_error| other_error,
        };
    });
} {
    const ArgType = @TypeOf(error_union_or_set);
    const err = switch (comptime @typeInfo(ArgType)) {
        .error_union => if (error_union_or_set) |success| return success else |err| err,
        .error_set => error_union_or_set,
        else => unreachable,
    };
    return if (comptime isOomOnlyError(ArgType))
        bun.outOfMemory()
    else switch (err) {
        error.OutOfMemory => bun.outOfMemory(),
        else => |other_error| other_error,
    };
}

const bun = @import("bun");
const std = @import("std");
