/// Parse a time string like "2d", "1.5h", "5m" to milliseconds
pub fn parse(input: []const u8) ?f64 {
    if (input.len == 0 or input.len > 100) return null;

    var i: usize = 0;
    while (i < input.len) {
        const c = input[i];
        if (c == '-' or c == '.' or std.ascii.isDigit(c) or std.ascii.isWhitespace(c)) {
            i += 1;
        } else if (std.ascii.isAlphabetic(c)) {
            break;
        } else {
            return null;
        }
    }

    const number_str = strings.trim(input[0..i], " \t\n\r");
    const value = std.fmt.parseFloat(f64, number_str) catch return null;

    const unit = strings.trim(input[i..], " \t\n\r");
    if (unit.len == 0) return value;

    return if (getMultiplier(unit)) |m| value * m else null;
}

// Years (365.25 days to account for leap years)
const ms_per_year = std.time.ms_per_day * 365.25;
const ms_per_month = std.time.ms_per_day * (365.25 / 12.0);

fn getMultiplier(unit: []const u8) ?f64 {
    // Years (365.25 days to account for leap years)
    if (std.ascii.eqlIgnoreCase(unit, "years") or std.ascii.eqlIgnoreCase(unit, "year") or
        std.ascii.eqlIgnoreCase(unit, "yrs") or std.ascii.eqlIgnoreCase(unit, "yr") or
        std.ascii.eqlIgnoreCase(unit, "y"))
    {
        return ms_per_year;
    }

    // Months (30.4375 days average)
    if (std.ascii.eqlIgnoreCase(unit, "months") or std.ascii.eqlIgnoreCase(unit, "month") or
        std.ascii.eqlIgnoreCase(unit, "mo"))
    {
        return ms_per_month;
    }

    // Weeks
    if (std.ascii.eqlIgnoreCase(unit, "weeks") or std.ascii.eqlIgnoreCase(unit, "week") or
        std.ascii.eqlIgnoreCase(unit, "w"))
    {
        return std.time.ms_per_week;
    }

    // Days
    if (std.ascii.eqlIgnoreCase(unit, "days") or std.ascii.eqlIgnoreCase(unit, "day") or
        std.ascii.eqlIgnoreCase(unit, "d"))
    {
        return std.time.ms_per_day;
    }

    // Hours
    if (std.ascii.eqlIgnoreCase(unit, "hours") or std.ascii.eqlIgnoreCase(unit, "hour") or
        std.ascii.eqlIgnoreCase(unit, "hrs") or std.ascii.eqlIgnoreCase(unit, "hr") or
        std.ascii.eqlIgnoreCase(unit, "h"))
    {
        return std.time.ms_per_hour;
    }

    // Minutes
    if (std.ascii.eqlIgnoreCase(unit, "minutes") or std.ascii.eqlIgnoreCase(unit, "minute") or
        std.ascii.eqlIgnoreCase(unit, "mins") or std.ascii.eqlIgnoreCase(unit, "min") or
        std.ascii.eqlIgnoreCase(unit, "m"))
    {
        return std.time.ms_per_min;
    }

    // Seconds
    if (std.ascii.eqlIgnoreCase(unit, "seconds") or std.ascii.eqlIgnoreCase(unit, "second") or
        std.ascii.eqlIgnoreCase(unit, "secs") or std.ascii.eqlIgnoreCase(unit, "sec") or
        std.ascii.eqlIgnoreCase(unit, "s"))
    {
        return std.time.ms_per_s;
    }

    // Milliseconds
    if (std.ascii.eqlIgnoreCase(unit, "milliseconds") or std.ascii.eqlIgnoreCase(unit, "millisecond") or
        std.ascii.eqlIgnoreCase(unit, "msecs") or std.ascii.eqlIgnoreCase(unit, "msec") or
        std.ascii.eqlIgnoreCase(unit, "ms"))
    {
        return 1.0;
    }

    return null;
}

// To keep the behavior consistent with JavaScript, we can't use @round
// Zig's @round uses "round half away from zero": ties round away from zero (2.5→3, -2.5→-3)
// JavaScript's Math.round uses "round half toward +∞": ties round toward positive infinity (2.5→3, -2.5→-2)
// This implementation: floor(x) + 1 if fractional part >= 0.5, else floor(x)
fn jsMathRound(x: f64) i64 {
    const i = @floor(x);
    const rounded = if (x - i >= 0.5) i + 1 else i;
    return @intFromFloat(rounded);
}

/// Format milliseconds to a human-readable string
pub fn format(allocator: std.mem.Allocator, ms: f64, long: bool) ![]const u8 {
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
    const ms_int = @as(i64, @intFromFloat(ms));
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
    if (callframe.argumentsCount() == 0) {
        return globalThis.throwInvalidArguments("Bun.ms() expects a string or number", .{});
    }

    const input = callframe.argument(0);

    // If input is a number, format it to a string
    if (input.isNumber()) {
        const ms_value = input.asNumber();

        if (std.math.isNan(ms_value) or std.math.isInf(ms_value)) {
            return globalThis.throwInvalidArguments("Value must be a finite number", .{});
        }

        var long = false;
        const options = callframe.argument(1);
        if (options.isObject()) {
            if (try options.get(globalThis, "long")) |long_value| {
                long = long_value.toBoolean();
            }
        }

        const result = format(bun.default_allocator, ms_value, long) catch {
            return globalThis.throwOutOfMemory();
        };
        defer bun.default_allocator.free(result);

        return String.fromBytes(result).toJS(globalThis);
    }

    // If input is a string, parse it to milliseconds
    if (input.isString()) {
        const str = try input.getZigString(globalThis);
        const slice = str.toSlice(bun.default_allocator);
        defer slice.deinit();

        const result = parse(slice.slice()) orelse std.math.nan(f64);
        return JSValue.jsNumber(result);
    }

    return globalThis.throwInvalidArguments("Bun.ms() expects a string or number", .{});
}

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const String = bun.String;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
