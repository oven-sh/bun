/// Parse a time string like "2d", "1.5h", "5m" to milliseconds
pub fn parse(input: []const u8) ?f64 {
    if (input.len == 0 or input.len > 100) return null;

    var i: usize = 0;

    next: switch (input[i]) {
        '-',
        '.',
        '0'...'9',
        => {
            i += 1;
            if (i < input.len) {
                continue :next input[i];
            }
            break :next;
        },
        ' ',
        'a'...'z',
        'A'...'Z',
        => {
            break :next;
        },
        else => {
            return null;
        },
    }

    const value = std.fmt.parseFloat(f64, input[0..i]) catch return null;

    const unit = strings.trimLeadingChar(input[i..], ' ');
    if (unit.len == 0) return value;

    if (MultiplierMap.getASCIIICaseInsensitive(unit)) |m| {
        return value * m;
    }

    return null;
}

// Years (365.25 days to account for leap years)
const ms_per_year = std.time.ms_per_day * 365.25;
const ms_per_month = std.time.ms_per_day * (365.25 / 12.0);

const MultiplierMap = bun.ComptimeStringMap(f64, .{
    // Years (365.25 days to account for leap years)
    .{ "y", ms_per_year },
    .{ "yr", ms_per_year },
    .{ "yrs", ms_per_year },
    .{ "year", ms_per_year },
    .{ "years", ms_per_year },

    // Months (30.4375 days average)
    .{ "mo", ms_per_month },
    .{ "month", ms_per_month },
    .{ "months", ms_per_month },

    // Weeks
    .{ "w", std.time.ms_per_week },
    .{ "week", std.time.ms_per_week },
    .{ "weeks", std.time.ms_per_week },

    // Days
    .{ "d", std.time.ms_per_day },
    .{ "day", std.time.ms_per_day },
    .{ "days", std.time.ms_per_day },

    // Hours
    .{ "h", std.time.ms_per_hour },
    .{ "hr", std.time.ms_per_hour },
    .{ "hrs", std.time.ms_per_hour },
    .{ "hour", std.time.ms_per_hour },
    .{ "hours", std.time.ms_per_hour },

    // Minutes
    .{ "m", std.time.ms_per_min },
    .{ "min", std.time.ms_per_min },
    .{ "mins", std.time.ms_per_min },
    .{ "minute", std.time.ms_per_min },
    .{ "minutes", std.time.ms_per_min },

    // Seconds
    .{ "s", std.time.ms_per_s },
    .{ "sec", std.time.ms_per_s },
    .{ "secs", std.time.ms_per_s },
    .{ "second", std.time.ms_per_s },
    .{ "seconds", std.time.ms_per_s },

    // Milliseconds
    .{ "ms", 1 },
    .{ "msec", 1 },
    .{ "msecs", 1 },
    .{ "millisecond", 1 },
    .{ "milliseconds", 1 },
});

// To keep the behavior consistent with JavaScript, we can't use @round
// Zig's @round uses "round half away from zero": ties round away from zero (2.5→3, -2.5→-3)
// JavaScript's Math.round uses "round half toward +∞": ties round toward positive infinity (2.5→3, -2.5→-2)
// This implementation: floor(x) + 1 if fractional part >= 0.5, else floor(x)
fn jsMathRound(x: f64) i64 {
    const i: f64 = @ceil(x);
    if ((i - 0.5) > x) return @intFromFloat(i - 1.0);
    return @intFromFloat(i);
}

/// Format milliseconds to a human-readable string
pub fn format(allocator: std.mem.Allocator, ms: f64, long: bool) ![]u8 {
    const abs_ms = @abs(ms);

    // Years
    if (abs_ms >= ms_per_year) {
        const years = jsMathRound(ms / ms_per_year);
        if (long) {
            const plural = abs_ms >= ms_per_year * 1.5;
            return std.fmt.allocPrint(allocator, "{d} year{s}", .{ years, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}y", .{years});
    }

    // Months
    if (abs_ms >= ms_per_month) {
        const months = jsMathRound(ms / ms_per_month);
        if (long) {
            const plural = abs_ms >= ms_per_month * 1.5;
            return std.fmt.allocPrint(allocator, "{d} month{s}", .{ months, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}mo", .{months});
    }

    // Weeks
    if (abs_ms >= std.time.ms_per_week) {
        const weeks = jsMathRound(ms / std.time.ms_per_week);
        if (long) {
            const plural = abs_ms >= std.time.ms_per_week * 1.5;
            return std.fmt.allocPrint(allocator, "{d} week{s}", .{ weeks, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}w", .{weeks});
    }

    // Days
    if (abs_ms >= std.time.ms_per_day) {
        const days = jsMathRound(ms / std.time.ms_per_day);
        if (long) {
            const plural = abs_ms >= std.time.ms_per_day * 1.5;
            return std.fmt.allocPrint(allocator, "{d} day{s}", .{ days, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}d", .{days});
    }

    // Hours
    if (abs_ms >= std.time.ms_per_hour) {
        const hours = jsMathRound(ms / std.time.ms_per_hour);
        if (long) {
            const plural = abs_ms >= std.time.ms_per_hour * 1.5;
            return std.fmt.allocPrint(allocator, "{d} hour{s}", .{ hours, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}h", .{hours});
    }

    // Minutes
    if (abs_ms >= std.time.ms_per_min) {
        const minutes = jsMathRound(ms / std.time.ms_per_min);
        if (long) {
            const plural = abs_ms >= std.time.ms_per_min * 1.5;
            return std.fmt.allocPrint(allocator, "{d} minute{s}", .{ minutes, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}m", .{minutes});
    }

    // Seconds
    if (abs_ms >= std.time.ms_per_s) {
        const seconds = jsMathRound(ms / std.time.ms_per_s);
        if (long) {
            const plural = abs_ms >= std.time.ms_per_s * 1.5;
            return std.fmt.allocPrint(allocator, "{d} second{s}", .{ seconds, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}s", .{seconds});
    }

    // Milliseconds
    const ms_int: i64 = @intFromFloat(ms);
    if (long) {
        return std.fmt.allocPrint(allocator, "{d} ms", .{ms_int});
    }
    return std.fmt.allocPrint(allocator, "{d}ms", .{ms_int});
}

/// JavaScript function: Bun.ms(value, options?)
pub fn jsFunction(
    globalThis: *JSGlobalObject,
    callframe: *jsc.CallFrame,
) JSError!jsc.JSValue {
    const input, const options = callframe.argumentsAsArray(2);

    // If input is a number, format it to a string
    if (input.isNumber()) {
        const ms_value = input.asNumber();

        if (std.math.isNan(ms_value) or std.math.isInf(ms_value)) {
            return globalThis.throwInvalidArguments("Value must be a finite number", .{});
        }

        var long = false;
        if (options.isObject()) {
            if (try options.get(globalThis, "long")) |long_value| {
                long = long_value.toBoolean();
            }
        }

        const result = try format(bun.default_allocator, ms_value, long);

        var str = String.createExternalGloballyAllocated(.latin1, result);
        return str.transferToJS(globalThis);
    }

    // If input is a string, parse it to milliseconds
    if (input.isString()) {
        const str = try input.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();

        const result = parse(str.slice()) orelse std.math.nan(f64);
        return JSValue.jsNumber(result);
    }

    return globalThis.throwInvalidArguments("Bun.ms() expects a string or number", .{});
}

// Bundler macro inlining for Bun.ms
pub fn astFunction(p: anytype, e_: *const E.Call, loc: logger.Loc) !?Expr {
    if (e_.args.len == 0) return null;
    const arg = e_.args.at(0).unwrapInlined();

    if (arg.asString(p.allocator)) |str| {
        const ms_value = parse(str) orelse std.math.nan(f64);
        return p.newExpr(E.Number{ .value = ms_value }, loc);
    }

    if (arg.asNumber()) |num| {
        if (std.math.isNan(num) or std.math.isInf(num)) return null;

        var long = false;
        if (e_.args.len >= 2) {
            const opts = e_.args.at(1).unwrapInlined();
            if (opts.getBoolean("long")) |b| {
                long = b;
            }
        }

        const formatted = try format(p.allocator, num, long);
        return p.newExpr(E.String.init(formatted), loc);
    }
    return null;
}

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const String = bun.String;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const logger = bun.logger;
const E = bun.ast.E;
const Expr = bun.ast.Expr;
