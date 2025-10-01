const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;

const MS_PER_SECOND = 1000.0;
const MS_PER_MINUTE = MS_PER_SECOND * 60.0;
const MS_PER_HOUR = MS_PER_MINUTE * 60.0;
const MS_PER_DAY = MS_PER_HOUR * 24.0;
const MS_PER_WEEK = MS_PER_DAY * 7.0;
const MS_PER_YEAR = MS_PER_DAY * 365.25;

/// Parse a time string like "2d", "1.5h", "5m" to milliseconds
pub fn parse(input: []const u8) ?f64 {
    if (input.len == 0 or input.len > 100) return null;

    var i: usize = 0;
    var negative = false;

    // Skip leading whitespace
    while (i < input.len and std.ascii.isWhitespace(input[i])) : (i += 1) {}
    if (i >= input.len) return null;

    // Check for negative sign
    if (input[i] == '-') {
        negative = true;
        i += 1;
    }

    // Parse number
    const start = i;
    var has_digits = false;
    var has_dot = false;

    while (i < input.len) {
        const c = input[i];
        if (std.ascii.isDigit(c)) {
            has_digits = true;
            i += 1;
        } else if (c == '.' and !has_dot) {
            has_dot = true;
            i += 1;
        } else if (std.ascii.isWhitespace(c) or std.ascii.isAlphabetic(c)) {
            break;
        } else {
            return null;
        }
    }

    if (!has_digits) return null;

    const number_str = input[start..i];
    var value = std.fmt.parseFloat(f64, number_str) catch return null;

    if (negative) value = -value;

    // Skip whitespace after number
    while (i < input.len and std.ascii.isWhitespace(input[i])) : (i += 1) {}

    // Get unit (rest of string, excluding trailing whitespace)
    var unit_end = input.len;
    while (unit_end > i and std.ascii.isWhitespace(input[unit_end - 1])) : (unit_end -= 1) {}
    const unit = input[i..unit_end];

    // Default to milliseconds if no unit
    if (unit.len == 0) return value;

    // Match unit (case-insensitive)
    return if (getMultiplier(unit)) |m| value * m else null;
}

fn getMultiplier(unit: []const u8) ?f64 {
    // Years
    if (std.ascii.eqlIgnoreCase(unit, "years") or std.ascii.eqlIgnoreCase(unit, "year") or
        std.ascii.eqlIgnoreCase(unit, "yrs") or std.ascii.eqlIgnoreCase(unit, "yr") or
        std.ascii.eqlIgnoreCase(unit, "y"))
    {
        return MS_PER_YEAR;
    }

    // Weeks
    if (std.ascii.eqlIgnoreCase(unit, "weeks") or std.ascii.eqlIgnoreCase(unit, "week") or
        std.ascii.eqlIgnoreCase(unit, "w"))
    {
        return MS_PER_WEEK;
    }

    // Days
    if (std.ascii.eqlIgnoreCase(unit, "days") or std.ascii.eqlIgnoreCase(unit, "day") or
        std.ascii.eqlIgnoreCase(unit, "d"))
    {
        return MS_PER_DAY;
    }

    // Hours
    if (std.ascii.eqlIgnoreCase(unit, "hours") or std.ascii.eqlIgnoreCase(unit, "hour") or
        std.ascii.eqlIgnoreCase(unit, "hrs") or std.ascii.eqlIgnoreCase(unit, "hr") or
        std.ascii.eqlIgnoreCase(unit, "h"))
    {
        return MS_PER_HOUR;
    }

    // Minutes
    if (std.ascii.eqlIgnoreCase(unit, "minutes") or std.ascii.eqlIgnoreCase(unit, "minute") or
        std.ascii.eqlIgnoreCase(unit, "mins") or std.ascii.eqlIgnoreCase(unit, "min") or
        std.ascii.eqlIgnoreCase(unit, "m"))
    {
        return MS_PER_MINUTE;
    }

    // Seconds
    if (std.ascii.eqlIgnoreCase(unit, "seconds") or std.ascii.eqlIgnoreCase(unit, "second") or
        std.ascii.eqlIgnoreCase(unit, "secs") or std.ascii.eqlIgnoreCase(unit, "sec") or
        std.ascii.eqlIgnoreCase(unit, "s"))
    {
        return MS_PER_SECOND;
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


/// Format milliseconds to a human-readable string
pub fn format(allocator: std.mem.Allocator, ms: f64, long: bool) ![]const u8 {
    const abs_ms = @abs(ms);

    if (abs_ms >= MS_PER_DAY) {
        const days = @round(ms / MS_PER_DAY);
        const days_int = @as(i64, @intFromFloat(days));
        if (long) {
            const plural = abs_ms >= MS_PER_DAY * 1.5;
            return std.fmt.allocPrint(allocator, "{d} day{s}", .{ days_int, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}d", .{days_int});
    }

    if (abs_ms >= MS_PER_HOUR) {
        const hours = @round(ms / MS_PER_HOUR);
        const hours_int = @as(i64, @intFromFloat(hours));
        if (long) {
            const plural = abs_ms >= MS_PER_HOUR * 1.5;
            return std.fmt.allocPrint(allocator, "{d} hour{s}", .{ hours_int, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}h", .{hours_int});
    }

    if (abs_ms >= MS_PER_MINUTE) {
        const minutes = @round(ms / MS_PER_MINUTE);
        const minutes_int = @as(i64, @intFromFloat(minutes));
        if (long) {
            const plural = abs_ms >= MS_PER_MINUTE * 1.5;
            return std.fmt.allocPrint(allocator, "{d} minute{s}", .{ minutes_int, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}m", .{minutes_int});
    }

    if (abs_ms >= MS_PER_SECOND) {
        const seconds = @round(ms / MS_PER_SECOND);
        const seconds_int = @as(i64, @intFromFloat(seconds));
        if (long) {
            const plural = abs_ms >= MS_PER_SECOND * 1.5;
            return std.fmt.allocPrint(allocator, "{d} second{s}", .{ seconds_int, if (plural) "s" else "" });
        }
        return std.fmt.allocPrint(allocator, "{d}s", .{seconds_int});
    }

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
) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(2);
    if (args.len == 0) return .js_undefined;

    const input = args.ptr[0];

    // If input is a number, format it to a string
    if (input.isNumber()) {
        const ms_value = input.asNumber();

        if (std.math.isNan(ms_value) or std.math.isInf(ms_value)) {
            return globalThis.throwInvalidArguments("Value must be a finite number", .{});
        }

        // Check for options argument
        var long = false;
        if (args.len > 1 and args.ptr[1].isObject()) {
            const options = args.ptr[1];
            if (try options.get(globalThis, "long")) |long_value| {
                long = long_value.toBoolean();
            }
        }

        const result = format(bun.default_allocator, ms_value, long) catch {
            return globalThis.throwOutOfMemory();
        };
        defer bun.default_allocator.free(result);

        return bun.String.fromBytes(result).toJS(globalThis);
    }

    // If input is a string, parse it to milliseconds
    if (input.isString()) {
        const str = try input.getZigString(globalThis);
        const slice = str.toSlice(bun.default_allocator);
        defer slice.deinit();

        const result = parse(slice.slice()) orelse return .js_undefined;
        return JSValue.jsNumber(result);
    }

    // Invalid input type
    return .js_undefined;
}
