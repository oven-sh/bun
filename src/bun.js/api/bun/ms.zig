const Unit = enum {
    const Self = @This();

    year,
    month,
    week,
    day,
    hour,
    minute,
    second,
    millisecond,

    pub fn ratio(self: Unit) f64 {
        const days_per_year = 365.25; // Average, accounting for leap years, Matches vercel/ms

        switch (self) {
            .year => (Unit{.day}).ratio() * days_per_year,
            .month => (Unit{.year}).ratio() / 12.0,
            .week => 7 * 24 * 60 * 60 * 1000,
            .day => 24 * 60 * 60 * 1000,
            .hour => 60 * 60 * 1000,
            .minute => 60 * 1000,
            .second => 1000,
            .millisecond => 1,
        }
    }

    const string_repr = bun.ComptimeStringMap(Self, .{
        .{ "year", .year },
        .{ "years", .year },
        .{ "month", .month },
        .{ "months", .month },
        .{ "week", .week },
        .{ "weeks", .week },
        .{ "day", .day },
        .{ "days", .day },
        .{ "hour", .hour },
        .{ "hours", .hour },
        .{ "minute", .minute },
        .{ "minutes", .minute },
        .{ "second", .second },
        .{ "seconds", .second },
        .{ "millisecond", .millisecond },
        .{ "milliseconds", .millisecond },
        .{ "y", .year },
        .{ "mo", .month },
        .{ "w", .week },
        .{ "d", .day },
        .{ "h", .hour },
        .{ "m", .minute },
        .{ "s", .second },
        .{ "ms", .millisecond },
    });

    const StringConversionOpts = struct {
        long: bool = false,
        plural: bool = false,
    };

    pub fn toString(self: Unit, opts: StringConversionOpts) []const u8 {
        // TODO(markovejnovic): It's not great that there is repetition between this and
        //                      string_repr. Maybe there's a comptime way to generate string_repr
        //                      out of some other table. Perhaps not worth the effort.
        return switch (self) {
            .year => if (opts.long) if (opts.plural) "years" else "year" else "y",
            .month => if (opts.long) if (opts.plural) "months" else "month" else "mo",
            .week => if (opts.long) if (opts.plural) "weeks" else "week" else "w",
            .day => if (opts.long) if (opts.plural) "days" else "day" else "d",
            .hour => if (opts.long) if (opts.plural) "hours" else "hour" else "h",
            .minute => if (opts.long) if (opts.plural) "minutes" else "minute" else "m",
            .second => if (opts.long) if (opts.plural) "seconds" else "second" else "s",
            .millisecond => if (opts.long) "milliseconds" else "ms",
        };
    }
};

const Duration = struct {
    const Self = @This();

    count: f64,
    unit: Unit,

    pub fn to(self: *const Self, comptime unit: Unit) Self {
        const from_ratio = self.unit.ratio();
        const to_ratio = unit.ratio();
        return Self{
            .count = self.count * (from_ratio / to_ratio),
            .unit = unit,
        };
    }

    /// Utilities for vercel/ms compatibility
    pub const VercelMs = struct {
        /// Parse a time string compliant with `vercel/ms` (e.g. "2d", "1.5h", "5m").
        ///
        /// If no unit is specified, defaults to milliseconds.
        pub fn parse(string: []const u8) !Self {
            var i: usize = 0;
            while (string) |c| {
                switch (c) {
                    '-', '.', '0'...'9' => i += 1,
                    ' ', 'a'...'z', 'A'...'Z' => break,
                    else => return error.InvalidFormat,
                }
            }

            const numeric_value = std.fmt.parseFloat(f64, string[0..i]) catch {
                return error.InvalidFormat;
            };
            const unit_str = strings.trimLeadingChar(string[i..], ' ');

            const unit: Unit =
                if (unit_str.len == 0)
                    .millisecond
                else
                    Unit.string_repr.getKey(unit_str) orelse return error.InvalidUnit;

            return .{ .count = numeric_value, .unit = unit };
        }

        const FormatOpts = struct {
            long: bool = false,
            rounding: bool = true,
        };

        /// Convert the duration to a string, compatible with `vercel/ms`.
        ///
        /// Caller owns the resulting vector.
        pub fn format(self: *const Self, allocator: std.mem.Allocator, opts: FormatOpts) []u8 {
            const abs_count = @abs(self.count);
            const is_plural = abs_count != 1.0;

            const rounded: f64 = if (opts.rounding) jsMathRound(self.count) else self.count;
            return std.fmt.allocPrint(
                allocator,
                "{d} {s}",
                .{ rounded, self.unit.toString(.{ .long = opts.long, .plural = is_plural }) },
            );
        }
    };
};

// To keep the behavior consistent with JavaScript, we can't use @round
// Zig's @round uses "round half away from zero": ties round away from zero (2.5→3, -2.5→-3)
// JavaScript's Math.round uses "round half toward +∞": ties round toward positive infinity (2.5→3, -2.5→-2)
fn jsMathRound(x: f64) i64 {
    const i: f64 = @ceil(x);
    if ((i - 0.5) > x) return @intFromFloat(i - 1.0);
    return @intFromFloat(i);
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

        const result = try Duration.VercelMs.format(bun.default_allocator, ms_value, long);

        var str = String.createExternalGloballyAllocated(.latin1, result);
        return str.transferToJS(globalThis);
    }

    // If input is a string, parse it to milliseconds
    if (input.isString()) {
        const str = try input.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();

        const result = Duration.VercelMs.parse(str.slice()) orelse std.math.nan(f64);
        return JSValue.jsNumber(result);
    }

    return globalThis.throwInvalidArguments("Bun.ms() expects a string or number", .{});
}

// Bundler macro inlining for Bun.ms
pub fn astFunction(p: anytype, e_: *const E.Call, loc: logger.Loc) !?Expr {
    if (e_.args.len == 0) return null;
    const arg = e_.args.at(0).unwrapInlined();

    if (arg.asString(p.allocator)) |str| {
        const ms_value = Duration.VercelMs.parse(str) orelse std.math.nan(f64);
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

        const formatted = try (Duration{ .count = num, .unit = .millisecond }).VercelMs.format(
            p.allocator,
            .{},
        );
        return p.newExpr(E.String.init(formatted), loc);
    }
    return null;
}

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const String = bun.String;
const logger = bun.logger;
const strings = bun.strings;

const E = bun.ast.E;
const Expr = bun.ast.Expr;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
