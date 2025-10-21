//! Mathematical intervals and operations on them.

/// Represents a mathematical interval with a start and an end of type `T`. The interval may be
/// `open (x, y)`, `closed [x, y]`, `left-closed [x, y)` or `right-closed (x, y]`.
fn Interval(
    comptime T: type,
    comptime closed_trait: enum { open, closed, left_closed, right_closed },
) type {
    switch (@typeInfo(T)) {
        .int, .float, .comptime_int, .comptime_float => {},
        else => {
            @compileError("Interval type T must be an integer or floating-point type.");
        },
    }

    return struct {
        const Self = @This();
        pub const closedness = closed_trait;

        /// Check if the left side of the interval is closed.
        pub const left_closed = switch (closedness) {
            .open => false,
            .closed => true,
            .left_closed => true,
            .right_closed => false,
        };

        /// Check if the right side of the interval is closed.
        pub const right_closed = switch (closedness) {
            .open => false,
            .closed => true,
            .left_closed => false,
            .right_closed => true,
        };

        start: T,
        end: T,

        /// Errors thrown in .init
        pub const InitError = error{InvalidInterval};

        /// Initializes a new interval with the given start and end values.
        ///
        /// Note that this function may return either Self or !Self, depending on whether it is
        /// used in a comptime or non-comptime context. In a comptime context (ie. both arguments
        /// are comptime), it will return Self and emit a compile error if the interval is invalid.
        /// In a non-comptime context, it will return !Self and return an error if the interval is
        /// invalid.
        pub fn init(start: anytype, end: anytype) Self.comptimeInitType(start, end) {
            if (start > end) {
                if (comptime Self.isInitComptime(start, end)) {
                    @compileError(std.fmt.comptimePrint(
                        "Invalid interval with start ({}) greater than end ({})",
                        .{ start, end },
                    ));
                } else {
                    return error.InvalidInterval;
                }
            }

            return .{
                .start = start,
                .end = end,
            };
        }

        /// Check if two intervals are equal.
        pub fn eql(self: *const Self, other: anytype) bool {
            return self.start == other.start and self.end == other.end and
                closedness == other.closedness;
        }

        /// Test whether the given value is contained within the interval.
        pub fn contains(self: *const Self, value: T) bool {
            switch (closedness) {
                .open => return (value > self.start) and (value < self.end),
                .closed => return (value >= self.start) and (value <= self.end),
                .left_closed => return (value >= self.start) and (value < self.end),
                .right_closed => return (value > self.start) and (value <= self.end),
            }
        }

        /// An interval is empty if it could not mathematically contain any values.
        pub fn isEmpty(self: *const Self) bool {
            return self.start == self.end and closedness != .closed;
        }

        /// Test whether this interval intersects with another interval.
        pub fn intersects(self: *const Self, other: anytype) bool {
            if (self.isEmpty() or other.isEmpty()) {
                return false;
            }

            if (self.end < other.start or self.start > other.end) {
                return false;
            }

            if (self.end == other.start) {
                return self.right_closed and other.left_closed;
            }

            if (self.start == other.end) {
                return self.left_closed and other.right_closed;
            }

            return true;
        }

        /// Clamp a value to be within the interval.
        pub fn clamp(self: *const Self, value: T) T {
            if (closedness != .closed) {
                // The reason we do this is to avoid ambiguity. Should open intervals clamp to the
                // very edge or to the epsilon? Hard to answer, so we just disallow it for now.
                @compileError("Clamping values within an interval is only supported for closed " ++
                    "intervals.");
            }

            if (value < self.start) {
                return self.start;
            }

            if (value > self.end) {
                return self.end;
            }

            return value;
        }

        /// Format the interval using the given format string and options.
        ///
        /// The format specifier is given to the start and end values in that order.
        pub fn format(
            self: *const Self,
            comptime fmt: []const u8,
            options: std.fmt.FormatOptions,
            writer: anytype,
        ) !void {
            _ = options;

            const lp, const rp = switch (closedness) {
                .open => .{ "(", ")" },
                .closed => .{ "[", "]" },
                .left_closed => .{ "[", ")" },
                .right_closed => .{ "(", "]" },
            };

            const f = std.fmt.comptimePrint("{s}{{{s}}},{{{s}}}{s}", .{ lp, fmt, fmt, rp });

            try writer.print(f, .{ self.start, self.end });
        }

        fn isInitComptime(start: anytype, end: anytype) bool {
            const start_is_comptime = switch (@typeInfo(@TypeOf(start))) {
                .comptime_int, .comptime_float => true,
                else => false,
            };
            const end_is_comptime = switch (@typeInfo(@TypeOf(end))) {
                .comptime_int, .comptime_float => true,
                else => false,
            };

            return start_is_comptime and end_is_comptime;
        }

        fn comptimeInitType(start: anytype, end: anytype) type {
            return if (Self.isInitComptime(start, end)) Self else InitError!Self;
        }
    };
}

/// Closed interval [a, b]
pub fn Closed(comptime T: type) type {
    return Interval(T, .closed);
}

/// Open interval (a, b)
pub fn Open(comptime T: type) type {
    return Interval(T, .open);
}

/// Left-closed interval [a, b)
pub fn LeftClosed(comptime T: type) type {
    return Interval(T, .left_closed);
}

/// Right-closed interval (a, b]
pub fn RightClosed(comptime T: type) type {
    return Interval(T, .right_closed);
}

/// Create an interval which spans the possible range of values for the given type `T`.
pub fn Int(comptime T: type) Closed(T) {
    return Closed(T).init(@as(T, std.math.minInt(T)), @as(T, std.math.maxInt(T)));
}

const std = @import("std");
