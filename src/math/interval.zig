//! Mathematical intervals and operations on them.

/// Represents a mathematical interval with a start and an end of type `T`. The interval may be
/// `open (x, y)`, `closed [x, y]`, `left-closed [x, y)` or `right-closed (x, y]`.
fn Interval(
    comptime T: type,
    comptime closedness: enum { open, closed, left_closed, right_closed },
) type {
    return struct {
        const Self = @This();

        start: T,
        end: T,

        /// Initializes a new interval with the given start and end values.
        pub fn init(start: T, end: T) Self {
            return .{
                .start = start,
                .end = end,
            };
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

        /// Clamp a value to be within the interval.
        ///
        /// The interval bounds are ALWAYS INCLUSIVE.
        pub fn clamp(self: *const Self, value: T) T {
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

const std = @import("std");
