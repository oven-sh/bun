const string = []const u8;

/// Represents a JavaScript stack trace
pub const ZigStackTrace = extern struct {
    source_lines_ptr: [*]bun.String,
    source_lines_numbers: [*]i32,
    source_lines_len: u8,
    source_lines_to_collect: u8,

    frames_ptr: [*]ZigStackFrame,
    frames_len: u8,
    frames_cap: u8,

    /// Non-null if `source_lines_*` points into data owned by a JSC::SourceProvider.
    /// If so, then .deref must be called on it to release the memory.
    referenced_source_provider: ?*SourceProvider = null,

    pub fn fromFrames(frames_slice: []ZigStackFrame) ZigStackTrace {
        return .{
            .source_lines_ptr = &[0]bun.String{},
            .source_lines_numbers = &[0]i32{},
            .source_lines_len = 0,
            .source_lines_to_collect = 0,

            .frames_ptr = frames_slice.ptr,
            .frames_len = @min(frames_slice.len, std.math.maxInt(u8)),
            .frames_cap = @min(frames_slice.len, std.math.maxInt(u8)),

            .referenced_source_provider = null,
        };
    }

    pub fn toAPI(
        this: *const ZigStackTrace,
        allocator: std.mem.Allocator,
        root_path: string,
        origin: ?*const ZigURL,
    ) !api.StackTrace {
        var stack_trace: api.StackTrace = comptime std.mem.zeroes(api.StackTrace);
        {
            var source_lines_iter = this.sourceLineIterator();

            const source_line_len = source_lines_iter.getLength();

            if (source_line_len > 0) {
                var source_lines = try allocator.alloc(api.SourceLine, @as(usize, @intCast(@max(source_lines_iter.i + 1, 0))));
                var source_line_buf = try allocator.alloc(u8, source_line_len);
                source_lines_iter = this.sourceLineIterator();
                var remain_buf = source_line_buf[0..];
                var i: usize = 0;
                while (source_lines_iter.next()) |source| {
                    const text = source.text.slice();
                    defer source.text.deinit();
                    bun.copy(
                        u8,
                        remain_buf,
                        text,
                    );
                    const copied_line = remain_buf[0..text.len];
                    remain_buf = remain_buf[text.len..];
                    source_lines[i] = .{ .text = copied_line, .line = source.line };
                    i += 1;
                }
                stack_trace.source_lines = source_lines;
            }
        }
        {
            const _frames = this.frames();
            if (_frames.len > 0) {
                var stack_frames = try allocator.alloc(api.StackFrame, _frames.len);
                stack_trace.frames = stack_frames;

                for (_frames, 0..) |frame, i| {
                    stack_frames[i] = try frame.toAPI(
                        root_path,
                        origin,
                        allocator,
                    );
                }
            }
        }

        return stack_trace;
    }

    pub fn frames(this: *const ZigStackTrace) []const ZigStackFrame {
        return this.frames_ptr[0..this.frames_len];
    }

    pub fn framesMutable(this: *ZigStackTrace) []ZigStackFrame {
        return this.frames_ptr[0..this.frames_len];
    }

    pub const SourceLineIterator = struct {
        trace: *const ZigStackTrace,
        i: i32,

        pub const SourceLine = struct {
            line: i32,
            text: ZigString.Slice,
        };

        pub fn getLength(this: *SourceLineIterator) usize {
            var count: usize = 0;
            for (this.trace.source_lines_ptr[0..@as(usize, @intCast(this.i + 1))]) |*line| {
                count += line.length();
            }

            return count;
        }

        pub fn untilLast(this: *SourceLineIterator) ?SourceLine {
            if (this.i < 1) return null;
            return this.next();
        }

        pub fn next(this: *SourceLineIterator) ?SourceLine {
            if (this.i < 0) return null;

            const source_line = this.trace.source_lines_ptr[@as(usize, @intCast(this.i))];
            const result = SourceLine{
                .line = this.trace.source_lines_numbers[@as(usize, @intCast(this.i))],
                .text = source_line.toUTF8(bun.default_allocator),
            };
            this.i -= 1;
            return result;
        }
    };

    pub fn sourceLineIterator(this: *const ZigStackTrace) SourceLineIterator {
        var i: i32 = -1;
        for (this.source_lines_numbers[0..this.source_lines_len], 0..) |num, j| {
            if (num >= 0) {
                i = @max(@as(i32, @intCast(j)), i);
            }
        }
        return .{ .trace = this, .i = i };
    }
};

const std = @import("std");
const ZigURL = @import("../../url.zig").URL;

const bun = @import("bun");
const api = bun.schema.api;

const jsc = bun.jsc;
const SourceProvider = jsc.SourceProvider;
const ZigStackFrame = jsc.ZigStackFrame;
const ZigString = jsc.ZigString;
