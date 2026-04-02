/// Cron expression parser and next-occurrence calculator.
///
/// Parses standard 5-field cron expressions (minute hour day month weekday)
/// into a bitset representation, and computes the next matching local time.
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

    pub fn errorMessage(e: Error) []const u8 {
        return switch (e) {
            error.TooFewFields => "Invalid cron expression: expected 5 space-separated fields (minute hour day month weekday)",
            error.TooManyFields => "Invalid cron expression: too many fields. Bun.cron uses 5 fields (minute hour day month weekday) — seconds are not supported",
            error.InvalidStep => "Invalid cron expression: step value must be a positive integer",
            error.InvalidRange => "Invalid cron expression: range must be ascending (use 'a,b' or 'a-max,0-b' for wrap-around)",
            error.InvalidNumber => "Invalid cron expression: value out of range for field",
            error.InvalidField => "Invalid cron expression: unrecognized field syntax",
        };
    }

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
            .weekdays = try parseField(u8, fields[4], 0, 7, .weekday),
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

    /// POSIX cron: if both DOM and DOW are restricted (not `*`), match either;
    /// otherwise match both (a `*` field matches all anyway).
    fn matchesDay(self: CronExpression, day: i32, weekday: i32) bool {
        const day_ok = bitSet(u32, self.days, @intCast(day));
        const weekday_ok = bitSet(u8, self.weekdays, @intCast(weekday));
        return if (!self.days_is_wildcard and !self.weekdays_is_wildcard)
            day_ok or weekday_ok
        else
            day_ok and weekday_ok;
    }

    /// Check if a real instant matches all five fields in local time.
    fn matchesInstant(self: CronExpression, globalObject: *jsc.JSGlobalObject, ms: f64) bool {
        const t = globalObject.msToGregorianDateTime(ms);
        return bitSet(u64, self.minutes, @intCast(t.minute)) and
            bitSet(u32, self.hours, @intCast(t.hour)) and
            bitSet(u16, self.months, @intCast(t.month)) and
            self.matchesDay(t.day, t.weekday);
    }

    /// Compute the next time (in ms since epoch) that matches this expression
    /// in the system's local time zone, starting from `from_ms`. Returns null
    /// if no match found within 8 years.
    pub fn next(self: CronExpression, globalObject: *jsc.JSGlobalObject, from_ms: f64) bun.JSError!?f64 {
        var dt = globalObject.msToGregorianDateTime(from_ms);
        const start_year = dt.year;
        // cronie: schedules with `*` minute or `*` hour run through a fall-back
        // repeated hour; fixed-time schedules fire once. We use the semantic
        // check (all bits set) so `*/1` counts as wild — matches the npm camp.
        const wild = self.minutes == all_minutes or self.hours == all_hours;

        dt.minute += 1;
        dt.second = 0;

        var date_dirty = true;
        while (true) {
            // Carry hour/minute overflow explicitly so the candidate hour:minute
            // is checked against the bitfields *before* DST shifts it (croner
            // semantics: gap times fire shifted forward, same day).
            if (dt.minute > 59) {
                dt.minute -= 60;
                dt.hour += 1;
            }
            if (dt.hour > 23) {
                dt.hour -= 24;
                dt.day += 1;
                date_dirty = true;
            }
            // Normalize the date (year/month/day overflow + weekday) via a
            // round-trip at noon. Any DST shift at midday stays within the same
            // calendar day, so the date and weekday are still correct. Skip
            // when only hour/minute moved.
            if (date_dirty) {
                const noon_ms = try globalObject.gregorianDateTimeToMS(dt.year, dt.month, dt.day, 12, 0, 0, 0);
                const n = globalObject.msToGregorianDateTime(noon_ms);
                dt.year = n.year;
                dt.month = n.month;
                dt.day = n.day;
                dt.weekday = n.weekday;
                date_dirty = false;
                // Impossible day/month combos (Feb 30, Apr 31) overflow to a
                // non-matching month and loop forever; bail after 8 years.
                if (dt.year - start_year > 8) return null;
            }

            // Check month
            if (!bitSet(u16, self.months, @intCast(dt.month))) {
                dt.month += 1;
                dt.day = 1;
                dt.hour = 0;
                dt.minute = 0;
                date_dirty = true;
                continue;
            }

            if (!self.matchesDay(dt.day, dt.weekday)) {
                dt.day += 1;
                dt.hour = 0;
                dt.minute = 0;
                date_dirty = true;
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
            const result = try globalObject.gregorianDateTimeToMS(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0);
            // During DST fall-back, gregorianDateTimeToMS picks the FORMER
            // occurrence of an ambiguous local time, and the wall-clock walk
            // above can step over the entire second occurrence. For wild
            // schedules, scan real-time minutes between from_ms and result
            // (capped at 2h, the largest real-world DST shift) for an earlier
            // match in the repeated window.
            if (wild and result > from_ms + minute_ms) {
                var probe = (@floor(from_ms / minute_ms) + 1) * minute_ms;
                const cap = @min(result, from_ms + (max_dst_shift_min + 1) * minute_ms);
                while (probe < cap) : (probe += minute_ms) {
                    if (self.matchesInstant(globalObject, probe)) return probe;
                }
            }
            if (result <= from_ms) {
                dt.minute += 1;
                continue;
            }
            return result;
        }
    }
};

// ============================================================================
// Name lookup tables
// ============================================================================

const minute_ms: f64 = 60_000;
const max_dst_shift_min: f64 = 120;

pub const all_minutes: u64 = (1 << 60) - 1;
pub const all_hours: u32 = (1 << 24) - 1;
pub const all_days: u32 = ((1 << 32) - 1) & ~@as(u32, 1);
pub const all_months: u16 = ((1 << 13) - 1) & ~@as(u16, 1);
pub const all_weekdays: u8 = (1 << 7) - 1;

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
    // Weekday: fold bit 7 (Sunday alias) into bit 0 *after* range expansion so
    // 5-7, 0-7, etc. work like Vixie/croner/cron-parser.
    if (kind == .weekday) result = (result | (result >> 7)) & 0x7F;
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
fn parseValue(str: []const u8, min: u7, max: u7, kind: NameKind) error{InvalidNumber}!u7 {
    // Try named value first via ComptimeStringMap case-insensitive lookup
    switch (kind) {
        .weekday => if (weekday_map.getASCIIICaseInsensitive(str)) |v| return v,
        .month => if (month_map.getASCIIICaseInsensitive(str)) |v| return v,
        .none => {},
    }

    const val = std.fmt.parseInt(u8, str, 10) catch return error.InvalidNumber;
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
    if (@popCount(bits) == @as(u32, max) - min + 1) {
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
