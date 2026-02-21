/// Cron expression parser and next-occurrence calculator.
///
/// Parses standard 5-field cron expressions (minute hour day month weekday)
/// into a bitset representation, and computes the next matching UTC time.
///
/// Supports:
///   - Wildcards: *
///   - Lists: 1,3,5
///   - Ranges: 1-5
///   - Steps: */15, 1-30/2
///   - Named days: SUN-SAT, Sun-Sat, Sunday-Saturday (case-insensitive)
///   - Named months: JAN-DEC, Jan-Dec, January-December (case-insensitive)
///   - Sunday as 7: weekday field accepts 7 as alias for 0
///   - Nicknames: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly
pub const CronExpression = struct {
    minutes: u64, // bits 0-59
    hours: u32, // bits 0-23
    days: u32, // bits 1-31
    months: u16, // bits 1-12
    weekdays: u8, // bits 0-6 (0=Sunday)
    days_is_wildcard: bool, // true if day-of-month field was *
    weekdays_is_wildcard: bool, // true if weekday field was *

    pub const Error = error{
        InvalidField,
        InvalidStep,
        InvalidRange,
        InvalidNumber,
        TooManyFields,
        TooFewFields,
    };

    /// Parse a 5-field cron expression or predefined nickname into a CronExpression.
    pub fn parse(input: []const u8) Error!CronExpression {
        const expr = bun.strings.trim(input, " \t");

        // Check for predefined nicknames
        if (expr.len > 0 and expr[0] == '@') {
            return parseNickname(expr) orelse error.InvalidField;
        }

        var count: usize = 0;
        var fields: [5][]const u8 = undefined;
        var iter = std.mem.tokenizeAny(u8, expr, " \t");
        while (iter.next()) |field| {
            if (count >= 5) return error.TooManyFields;
            fields[count] = field;
            count += 1;
        }
        if (count != 5) return error.TooFewFields;

        return .{
            .minutes = try parseField(u64, fields[0], 0, 59, .none),
            .hours = try parseField(u32, fields[1], 0, 23, .none),
            .days = try parseField(u32, fields[2], 1, 31, .none),
            .months = try parseField(u16, fields[3], 1, 12, .month),
            .weekdays = try parseField(u8, fields[4], 0, 6, .weekday),
            .days_is_wildcard = bun.strings.eql(fields[2], "*"),
            .weekdays_is_wildcard = bun.strings.eql(fields[4], "*"),
        };
    }

    /// Validate a cron expression string without allocating.
    pub fn validate(expr: []const u8) bool {
        _ = parse(expr) catch return false;
        return true;
    }

    /// Format the expression as a normalized numeric "M H D Mo W" string
    /// suitable for crontab. Returns the written slice of `buf`.
    pub fn formatNumeric(self: CronExpression, buf: *[512]u8) []const u8 {
        var stream = std.io.fixedBufferStream(buf);
        const w = stream.writer();
        formatBitfield(w, u64, self.minutes, 0, 59);
        w.writeByte(' ') catch unreachable;
        formatBitfield(w, u32, self.hours, 0, 23);
        w.writeByte(' ') catch unreachable;
        formatBitfield(w, u32, self.days, 1, 31);
        w.writeByte(' ') catch unreachable;
        formatBitfield(w, u16, self.months, 1, 12);
        w.writeByte(' ') catch unreachable;
        formatBitfield(w, u8, self.weekdays, 0, 6);
        return stream.getWritten();
    }

    /// Compute the next UTC time (in ms since epoch) that matches this expression,
    /// starting from `from_ms`. Returns null if no match found within ~4 years.
    pub fn next(self: CronExpression, globalObject: *jsc.JSGlobalObject, from_ms: f64) bun.JSError!?f64 {
        var dt = globalObject.msToGregorianDateTimeUTC(from_ms);

        // Advance by 1 minute, zero out seconds
        dt.minute += 1;
        if (dt.minute > 59) {
            dt.minute = 0;
            dt.hour += 1;
            if (dt.hour > 23) {
                dt.hour = 0;
                dt.day += 1;
            }
        }
        dt.second = 0;

        // Loop up to ~4 years to prevent infinite iteration
        var iterations: u32 = 0;
        const max_iterations: u32 = 1500 * 24 * 60;
        while (iterations < max_iterations) : (iterations += 1) {
            // Normalize via round-trip to handle overflows and compute weekday
            {
                const ms = try globalObject.gregorianDateTimeToMSUTC(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0);
                dt = globalObject.msToGregorianDateTimeUTC(ms);
            }

            // Check month
            if (!bitSet(u16, self.months, @intCast(dt.month))) {
                dt.month += 1;
                dt.day = 1;
                dt.hour = 0;
                dt.minute = 0;
                continue;
            }

            // POSIX cron day-of-month / day-of-week logic:
            //   - If both are restricted (neither was *): OR — either matching is enough
            //   - If only one is restricted: only that one matters (the * field matches all)
            const day_ok = bitSet(u32, self.days, @intCast(dt.day));
            const weekday_ok = bitSet(u8, self.weekdays, @intCast(dt.weekday));
            const both_restricted = !self.days_is_wildcard and !self.weekdays_is_wildcard;
            const day_match = if (both_restricted) (day_ok or weekday_ok) else (day_ok and weekday_ok);
            if (!day_match) {
                dt.day += 1;
                dt.hour = 0;
                dt.minute = 0;
                continue;
            }

            // Check hour
            if (!bitSet(u32, self.hours, @intCast(dt.hour))) {
                dt.hour += 1;
                dt.minute = 0;
                continue;
            }

            // Check minute
            if (!bitSet(u64, self.minutes, @intCast(dt.minute))) {
                dt.minute += 1;
                continue;
            }

            // All fields match
            return try globalObject.gregorianDateTimeToMSUTC(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0);
        }

        return null;
    }
};

// ============================================================================
// Name lookup tables
// ============================================================================

const all_hours: u32 = (1 << 24) - 1;
const all_days: u32 = ((1 << 32) - 1) & ~@as(u32, 1);
const all_months: u16 = ((1 << 13) - 1) & ~@as(u16, 1);
const all_weekdays: u8 = (1 << 7) - 1;

fn parseNickname(expr: []const u8) ?CronExpression {
    const eql = bun.strings.eqlCaseInsensitiveASCIIICheckLength;
    if (eql(expr, "@yearly") or eql(expr, "@annually"))
        return .{ .minutes = 1, .hours = 1, .days = 1 << 1, .months = 1 << 1, .weekdays = all_weekdays, .days_is_wildcard = false, .weekdays_is_wildcard = true };
    if (eql(expr, "@monthly"))
        return .{ .minutes = 1, .hours = 1, .days = 1 << 1, .months = all_months, .weekdays = all_weekdays, .days_is_wildcard = false, .weekdays_is_wildcard = true };
    if (eql(expr, "@weekly"))
        return .{ .minutes = 1, .hours = 1, .days = all_days, .months = all_months, .weekdays = 1, .days_is_wildcard = true, .weekdays_is_wildcard = false };
    if (eql(expr, "@daily") or eql(expr, "@midnight"))
        return .{ .minutes = 1, .hours = 1, .days = all_days, .months = all_months, .weekdays = all_weekdays, .days_is_wildcard = true, .weekdays_is_wildcard = true };
    if (eql(expr, "@hourly"))
        return .{ .minutes = 1, .hours = all_hours, .days = all_days, .months = all_months, .weekdays = all_weekdays, .days_is_wildcard = true, .weekdays_is_wildcard = true };
    return null;
}

const weekday_map = bun.ComptimeStringMap(u7, .{
    .{ "sun", 0 },     .{ "mon", 1 },       .{ "tue", 2 },
    .{ "wed", 3 },     .{ "thu", 4 },       .{ "fri", 5 },
    .{ "sat", 6 },     .{ "sunday", 0 },    .{ "monday", 1 },
    .{ "tuesday", 2 }, .{ "wednesday", 3 }, .{ "thursday", 4 },
    .{ "friday", 5 },  .{ "saturday", 6 },
});

const month_map = bun.ComptimeStringMap(u7, .{
    .{ "jan", 1 },      .{ "feb", 2 },       .{ "mar", 3 },
    .{ "apr", 4 },      .{ "may", 5 },       .{ "jun", 6 },
    .{ "jul", 7 },      .{ "aug", 8 },       .{ "sep", 9 },
    .{ "oct", 10 },     .{ "nov", 11 },      .{ "dec", 12 },
    .{ "january", 1 },  .{ "february", 2 },  .{ "march", 3 },
    .{ "april", 4 },    .{ "may", 5 },       .{ "june", 6 },
    .{ "july", 7 },     .{ "august", 8 },    .{ "september", 9 },
    .{ "october", 10 }, .{ "november", 11 }, .{ "december", 12 },
});

// ============================================================================
// Field parsing
// ============================================================================

const NameKind = enum { none, weekday, month };

/// Parse a single cron field (e.g. "1,5-10,*/3") into a bitset.
fn parseField(comptime T: type, field: []const u8, min: u7, max: u7, kind: NameKind) CronExpression.Error!T {
    if (field.len == 0) return error.InvalidField;
    var result: T = 0;
    var parts = std.mem.splitScalar(u8, field, ',');
    while (parts.next()) |part| {
        if (part.len == 0) return error.InvalidField;
        // Split by / for step
        var step_iter = std.mem.splitScalar(u8, part, '/');
        const base = step_iter.next() orelse return error.InvalidField;
        const step_str = step_iter.next();
        if (step_iter.next() != null) return error.InvalidStep;

        const step: u7 = if (step_str) |s| blk: {
            if (s.len == 0) return error.InvalidStep;
            break :blk std.fmt.parseInt(u7, s, 10) catch return error.InvalidStep;
        } else 1;
        if (step == 0) return error.InvalidStep;

        var range_min: u7 = undefined;
        var range_max: u7 = undefined;

        if (bun.strings.eql(base, "*")) {
            range_min = min;
            range_max = max;
        } else {
            if (splitRange(base)) |range_parts| {
                const lo = parseValue(range_parts[0], min, max, kind) catch return error.InvalidNumber;
                const hi = parseValue(range_parts[1], min, max, kind) catch return error.InvalidNumber;
                if (lo > hi) return error.InvalidRange;
                range_min = lo;
                range_max = hi;
            } else {
                const lo = parseValue(base, min, max, kind) catch return error.InvalidNumber;
                range_min = lo;
                range_max = if (step_str != null) max else lo;
            }
        }

        // Set bits
        var i: u7 = range_min;
        while (i <= range_max) : (i += step) {
            result |= @as(T, 1) << @intCast(i);
            if (@as(u8, i) + @as(u8, step) > range_max) break;
        }
    }
    return result;
}

/// Split a base expression on '-' for ranges, returning null if not a range.
fn splitRange(base: []const u8) ?[2][]const u8 {
    const idx = bun.strings.indexOfChar(base, '-') orelse return null;
    if (idx == 0 or idx == base.len - 1) return null;
    const rest = base[idx + 1 ..];
    if (bun.strings.indexOfChar(rest, '-') != null) return null;
    return .{ base[0..idx], rest };
}

/// Parse a single value (number or name), validating range.
/// For weekday fields, 7 is normalized to 0 (Sunday).
fn parseValue(str: []const u8, min: u7, max: u7, kind: NameKind) error{InvalidNumber}!u7 {
    // Try named value first via ComptimeStringMap case-insensitive lookup
    switch (kind) {
        .weekday => if (weekday_map.getASCIIICaseInsensitive(str)) |v| return v,
        .month => if (month_map.getASCIIICaseInsensitive(str)) |v| return v,
        .none => {},
    }

    const val = std.fmt.parseInt(u8, str, 10) catch return error.InvalidNumber;
    if (kind == .weekday and val == 7) return 0;
    if (val < min or val > max) return error.InvalidNumber;
    return @intCast(val);
}

// ============================================================================
// Helpers
// ============================================================================

inline fn bitSet(comptime T: type, set: T, pos: std.math.Log2Int(T)) bool {
    return (set >> pos) & 1 != 0;
}

/// Write a bitfield as a cron field string: "*" if all bits set, or comma-separated values.
fn formatBitfield(w: anytype, comptime T: type, bits: T, min: u8, max: u8) void {
    var all_set = true;
    for (min..max + 1) |i| {
        if ((bits >> @intCast(i)) & 1 == 0) {
            all_set = false;
            break;
        }
    }
    if (all_set) {
        w.writeByte('*') catch unreachable;
        return;
    }
    var first = true;
    for (min..max + 1) |i| {
        if ((bits >> @intCast(i)) & 1 != 0) {
            if (!first) w.writeByte(',') catch unreachable;
            std.fmt.format(w, "{d}", .{i}) catch unreachable;
            first = false;
        }
    }
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
