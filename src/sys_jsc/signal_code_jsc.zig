//! JSC bridge for `bun.SignalCode`. Keeps `src/sys/` free of JSC types.

pub fn fromJS(arg: jsc.JSValue, globalThis: *jsc.JSGlobalObject) !SignalCode {
    if (arg.getNumber()) |sig64| {
        // Node does this:
        if (std.math.isNan(sig64)) {
            return SignalCode.default;
        }

        // This matches node behavior, minus some details with the error messages: https://gist.github.com/Jarred-Sumner/23ba38682bf9d84dff2f67eb35c42ab6
        if (std.math.isInf(sig64) or @trunc(sig64) != sig64) {
            return globalThis.throwInvalidArguments("Unknown signal", .{});
        }

        if (sig64 < 0) {
            return globalThis.throwInvalidArguments("Invalid signal: must be >= 0", .{});
        }

        if (sig64 > 31) {
            return globalThis.throwInvalidArguments("Invalid signal: must be < 32", .{});
        }

        const code: SignalCode = @enumFromInt(@as(u8, @intFromFloat(sig64)));
        return code;
    } else if (arg.isString()) {
        if (arg.asString().length() == 0) {
            return SignalCode.default;
        }
        const signal_code = try arg.toEnum(globalThis, "signal", SignalCode);
        return signal_code;
    } else if (!arg.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Invalid signal: must be a string or an integer", .{});
    }

    return SignalCode.default;
}

const std = @import("std");

const bun = @import("bun");
const SignalCode = bun.SignalCode;
const jsc = bun.jsc;
