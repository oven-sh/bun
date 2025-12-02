//! This is a snapshot of the Zig std.Progress API before it's rewrite in 0.13
//! We use this API for the progress in Bun install and some other places.
//!
//! TODO: It would be worth considering using our own progress indicator for
//! Bun install, as this bar only shows the most recent action.
//!
//! https://github.com/ziglang/zig/blob/0.12.0/lib/std/Progress.zig
//!
//! This API is non-allocating, non-fallible, and thread-safe.
//! The tradeoff is that users of this API must provide the storage
//! for each `Progress.Node`.
//!
//! Initialize the struct directly, overriding these fields as desired:
//! * `refresh_rate_ms`
//! * `initial_delay_ms`

const Progress = @This();

/// `null` if the current node (and its children) should
/// not print on update()
terminal: ?std.fs.File = undefined,

/// Is this a windows API terminal (note: this is not the same as being run on windows
/// because other terminals exist like MSYS/git-bash)
is_windows_terminal: bool = false,

/// Whether the terminal supports ANSI escape codes.
supports_ansi_escape_codes: bool = false,

/// If the terminal is "dumb", don't print output.
/// This can be useful if you don't want to print all
/// the stages of code generation if there are a lot.
/// You should not use it if the user should see output
/// for example showing the user what tests run.
dont_print_on_dumb: bool = false,

root: Node = undefined,

/// Keeps track of how much time has passed since the beginning.
/// Used to compare with `initial_delay_ms` and `refresh_rate_ms`.
timer: ?std.time.Timer = null,

/// When the previous refresh was written to the terminal.
/// Used to compare with `refresh_rate_ms`.
prev_refresh_timestamp: u64 = undefined,

/// This buffer represents the maximum number of bytes written to the terminal
/// with each refresh.
output_buffer: [100]u8 = undefined,

/// How many nanoseconds between writing updates to the terminal.
refresh_rate_ns: u64 = 50 * std.time.ns_per_ms,

/// How many nanoseconds to keep the output hidden
initial_delay_ns: u64 = 500 * std.time.ns_per_ms,

done: bool = true,

/// Protects the `refresh` function, as well as `node.recently_updated_child`.
/// Without this, callsites would call `Node.end` and then free `Node` memory
/// while it was still being accessed by the `refresh` function.
update_mutex: bun.Mutex = .{},

/// Keeps track of how many columns in the terminal have been output, so that
/// we can move the cursor back later.
columns_written: usize = undefined,

/// Represents one unit of progress. Each node can have children nodes, or
/// one can use integers with `update`.
pub const Node = struct {
    context: *Progress,
    parent: ?*Node,
    name: []const u8,
    unit: enum { none, files, bytes } = .none,
    /// Must be handled atomically to be thread-safe.
    recently_updated_child: ?*Node = null,
    /// Must be handled atomically to be thread-safe. 0 means null.
    unprotected_estimated_total_items: usize,
    /// Must be handled atomically to be thread-safe.
    unprotected_completed_items: usize,

    /// Create a new child progress node. Thread-safe.
    /// Call `Node.end` when done.
    /// TODO solve https://github.com/ziglang/zig/issues/2765 and then change this
    /// API to set `self.parent.recently_updated_child` with the return value.
    /// Until that is fixed you probably want to call `activate` on the return value.
    /// Passing 0 for `estimated_total_items` means unknown.
    pub fn start(self: *Node, name: []const u8, estimated_total_items: usize) Node {
        return Node{
            .context = self.context,
            .parent = self,
            .name = name,
            .unprotected_estimated_total_items = estimated_total_items,
            .unprotected_completed_items = 0,
        };
    }

    /// This is the same as calling `start` and then `end` on the returned `Node`. Thread-safe.
    pub fn completeOne(self: *Node) void {
        if (self.parent) |parent| {
            @atomicStore(?*Node, &parent.recently_updated_child, self, .release);
        }
        _ = @atomicRmw(usize, &self.unprotected_completed_items, .Add, 1, .monotonic);
        self.context.maybeRefresh();
    }

    /// Finish a started `Node`. Thread-safe.
    pub fn end(self: *Node) void {
        self.context.maybeRefresh();
        if (self.parent) |parent| {
            {
                self.context.update_mutex.lock();
                defer self.context.update_mutex.unlock();
                _ = @cmpxchgStrong(?*Node, &parent.recently_updated_child, self, null, .monotonic, .monotonic);
            }
            parent.completeOne();
        } else {
            self.context.update_mutex.lock();
            defer self.context.update_mutex.unlock();
            self.context.done = true;
            self.context.refreshWithHeldLock();
        }
    }

    /// Tell the parent node that this node is actively being worked on. Thread-safe.
    pub fn activate(self: *Node) void {
        if (self.parent) |parent| {
            @atomicStore(?*Node, &parent.recently_updated_child, self, .release);
            self.context.maybeRefresh();
        }
    }

    /// Thread-safe.
    pub fn setName(self: *Node, name: []const u8) void {
        const progress = self.context;
        progress.update_mutex.lock();
        defer progress.update_mutex.unlock();
        self.name = name;
        if (self.parent) |parent| {
            @atomicStore(?*Node, &parent.recently_updated_child, self, .release);
            if (parent.parent) |grand_parent| {
                @atomicStore(?*Node, &grand_parent.recently_updated_child, parent, .release);
            }
            if (progress.timer) |*timer| progress.maybeRefreshWithHeldLock(timer);
        }
    }

    /// Thread-safe.
    pub fn setUnit(self: *Node, unit: []const u8) void {
        const progress = self.context;
        progress.update_mutex.lock();
        defer progress.update_mutex.unlock();
        self.unit = unit;
        if (self.parent) |parent| {
            @atomicStore(?*Node, &parent.recently_updated_child, self, .release);
            if (parent.parent) |grand_parent| {
                @atomicStore(?*Node, &grand_parent.recently_updated_child, parent, .release);
            }
            if (progress.timer) |*timer| progress.maybeRefreshWithHeldLock(timer);
        }
    }

    /// Thread-safe. 0 means unknown.
    pub fn setEstimatedTotalItems(self: *Node, count: usize) void {
        @atomicStore(usize, &self.unprotected_estimated_total_items, count, .monotonic);
    }

    /// Thread-safe.
    pub fn setCompletedItems(self: *Node, completed_items: usize) void {
        @atomicStore(usize, &self.unprotected_completed_items, completed_items, .monotonic);
    }
};

/// Create a new progress node.
/// Call `Node.end` when done.
/// TODO solve https://github.com/ziglang/zig/issues/2765 and then change this
/// API to return Progress rather than accept it as a parameter.
/// `estimated_total_items` value of 0 means unknown.
pub fn start(self: *Progress, name: []const u8, estimated_total_items: usize) *Node {
    const stderr = std.fs.File.stderr();
    self.terminal = null;
    if (stderr.supportsAnsiEscapeCodes()) {
        self.terminal = stderr;
        self.supports_ansi_escape_codes = true;
    } else if (builtin.os.tag == .windows and stderr.isTty()) {
        self.is_windows_terminal = true;
        self.terminal = stderr;
    } else if (builtin.os.tag != .windows) {
        // we are in a "dumb" terminal like in acme or writing to a file
        self.terminal = stderr;
    }
    self.root = Node{
        .context = self,
        .parent = null,
        .name = name,
        .unprotected_estimated_total_items = estimated_total_items,
        .unprotected_completed_items = 0,
    };
    self.columns_written = 0;
    self.prev_refresh_timestamp = 0;
    self.timer = std.time.Timer.start() catch null;
    self.done = false;
    return &self.root;
}

/// Updates the terminal if enough time has passed since last update. Thread-safe.
pub fn maybeRefresh(self: *Progress) void {
    if (self.timer) |*timer| {
        if (!self.update_mutex.tryLock()) return;
        defer self.update_mutex.unlock();
        maybeRefreshWithHeldLock(self, timer);
    }
}

fn maybeRefreshWithHeldLock(self: *Progress, timer: *std.time.Timer) void {
    const now = timer.read();
    if (now < self.initial_delay_ns) return;
    // TODO I have observed this to happen sometimes. I think we need to follow Rust's
    // lead and guarantee monotonically increasing times in the std lib itself.
    if (now < self.prev_refresh_timestamp) return;
    if (now - self.prev_refresh_timestamp < self.refresh_rate_ns) return;
    return self.refreshWithHeldLock();
}

/// Updates the terminal and resets `self.next_refresh_timestamp`. Thread-safe.
pub fn refresh(self: *Progress) void {
    if (!self.update_mutex.tryLock()) return;
    defer self.update_mutex.unlock();

    return self.refreshWithHeldLock();
}

fn clearWithHeldLock(p: *Progress, end_ptr: *usize) void {
    const file = p.terminal orelse return;
    var end = end_ptr.*;
    if (p.columns_written > 0) {
        // restore the cursor position by moving the cursor
        // `columns_written` cells to the left, then clear the rest of the
        // line
        if (p.supports_ansi_escape_codes) {
            end += (std.fmt.bufPrint(p.output_buffer[end..], "\x1b[{d}D", .{p.columns_written}) catch unreachable).len;
            end += (std.fmt.bufPrint(p.output_buffer[end..], "\x1b[0K", .{}) catch unreachable).len;
        } else if (builtin.os.tag == .windows) winapi: {
            assert(p.is_windows_terminal);

            var info: windows.CONSOLE_SCREEN_BUFFER_INFO = undefined;
            if (windows.kernel32.GetConsoleScreenBufferInfo(file.handle, &info) != windows.TRUE) {
                // stop trying to write to this file
                p.terminal = null;
                break :winapi;
            }

            var cursor_pos = windows.COORD{
                .X = info.dwCursorPosition.X - @as(windows.SHORT, @intCast(p.columns_written)),
                .Y = info.dwCursorPosition.Y,
            };

            if (cursor_pos.X < 0)
                cursor_pos.X = 0;

            const fill_chars = @as(windows.DWORD, @intCast(info.dwSize.X - cursor_pos.X));

            var written: windows.DWORD = undefined;
            if (windows.kernel32.FillConsoleOutputAttribute(
                file.handle,
                info.wAttributes,
                fill_chars,
                cursor_pos,
                &written,
            ) != windows.TRUE) {
                // stop trying to write to this file
                p.terminal = null;
                break :winapi;
            }
            if (windows.kernel32.FillConsoleOutputCharacterW(
                file.handle,
                ' ',
                fill_chars,
                cursor_pos,
                &written,
            ) != windows.TRUE) {
                // stop trying to write to this file
                p.terminal = null;
                break :winapi;
            }
            if (windows.kernel32.SetConsoleCursorPosition(file.handle, cursor_pos) != windows.TRUE) {
                // stop trying to write to this file
                p.terminal = null;
                break :winapi;
            }
        } else {
            // we are in a "dumb" terminal like in acme or writing to a file
            p.output_buffer[end] = '\n';
            end += 1;
        }

        p.columns_written = 0;
    }
    end_ptr.* = end;
}

fn refreshWithHeldLock(self: *Progress) void {
    const is_dumb = !self.supports_ansi_escape_codes and !self.is_windows_terminal;
    if (is_dumb and self.dont_print_on_dumb) return;

    const file = self.terminal orelse return;

    var end: usize = 0;
    clearWithHeldLock(self, &end);

    if (!self.done) {
        var need_ellipse = false;
        var maybe_node: ?*Node = &self.root;
        while (maybe_node) |node| {
            if (need_ellipse) {
                self.bufWrite(&end, "... ", .{});
            }
            need_ellipse = false;
            const eti = @atomicLoad(usize, &node.unprotected_estimated_total_items, .monotonic);
            const completed_items = @atomicLoad(usize, &node.unprotected_completed_items, .monotonic);
            const current_item = completed_items + 1;
            if (node.name.len != 0 or eti > 0) {
                if (node.name.len != 0) {
                    self.bufWrite(&end, "{s}", .{node.name});
                    need_ellipse = true;
                }
                if (eti > 0) {
                    if (need_ellipse) self.bufWrite(&end, " ", .{});
                    switch (node.unit) {
                        .none => self.bufWrite(&end, "[{d}/{d}] ", .{ current_item, eti }),
                        .files => self.bufWrite(&end, "[{d}/{d} files] ", .{ current_item, eti }),
                        .bytes => self.bufWrite(&end, "[{Bi:.2}/{Bi:.2}] ", .{ current_item, eti }),
                    }
                    need_ellipse = false;
                } else if (completed_items != 0) {
                    if (need_ellipse) self.bufWrite(&end, " ", .{});
                    switch (node.unit) {
                        .none => self.bufWrite(&end, "[{d}] ", .{current_item}),
                        .files => self.bufWrite(&end, "[{d} files] ", .{current_item}),
                        .bytes => self.bufWrite(&end, "[{Bi:.2}] ", .{current_item}),
                    }
                    need_ellipse = false;
                }
            }
            maybe_node = @atomicLoad(?*Node, &node.recently_updated_child, .acquire);
        }
        if (need_ellipse) {
            self.bufWrite(&end, "... ", .{});
        }
    }

    _ = file.write(self.output_buffer[0..end]) catch {
        // stop trying to write to this file
        self.terminal = null;
    };
    if (self.timer) |*timer| {
        self.prev_refresh_timestamp = timer.read();
    }
}

pub fn log(self: *Progress, comptime format: []const u8, args: anytype) void {
    const file = self.terminal orelse {
        (std.debug).print(format, args);
        return;
    };
    var file_writer = file.writerStreaming(&.{});
    const writer = &file_writer.interface;
    self.refresh();
    writer.print(format, args) catch {
        self.terminal = null;
        return;
    };
    self.columns_written = 0;
}

/// Allows the caller to freely write to stderr until unlock_stderr() is called.
/// During the lock, the progress information is cleared from the terminal.
pub fn lock_stderr(p: *Progress) void {
    p.update_mutex.lock();
    if (p.terminal) |file| {
        var end: usize = 0;
        clearWithHeldLock(p, &end);
        _ = file.write(p.output_buffer[0..end]) catch {
            // stop trying to write to this file
            p.terminal = null;
        };
    }
    std.debug.getStderrMutex().lock();
}

pub fn unlock_stderr(p: *Progress) void {
    std.debug.getStderrMutex().unlock();
    p.update_mutex.unlock();
}

fn bufWrite(self: *Progress, end: *usize, comptime format: []const u8, args: anytype) void {
    if (std.fmt.bufPrint(self.output_buffer[end.*..], format, args)) |written| {
        const amt = written.len;
        end.* += amt;
        self.columns_written += amt;
    } else |err| switch (err) {
        error.NoSpaceLeft => {
            self.columns_written += self.output_buffer.len - end.*;
            end.* = self.output_buffer.len;
            const suffix = "... ";
            @memcpy(self.output_buffer[self.output_buffer.len - suffix.len ..], suffix);
        },
    }
}

test "basic functionality" {
    var disable = true;
    _ = &disable;
    if (disable) {
        // This test is disabled because it uses time.sleep() and is therefore slow. It also
        // prints bogus progress data to stderr.
        return error.SkipZigTest;
    }
    var progress = Progress{};
    const root_node = progress.start("", 100);
    defer root_node.end();

    const speed_factor = std.time.ns_per_ms;

    const sub_task_names = [_][]const u8{
        "reticulating splines",
        "adjusting shoes",
        "climbing towers",
        "pouring juice",
    };
    var next_sub_task: usize = 0;

    var i: usize = 0;
    while (i < 100) : (i += 1) {
        var node = root_node.start(sub_task_names[next_sub_task], 5);
        node.activate();
        next_sub_task = (next_sub_task + 1) % sub_task_names.len;

        node.completeOne();
        std.Thread.sleep(5 * speed_factor);
        node.completeOne();
        node.completeOne();
        std.Thread.sleep(5 * speed_factor);
        node.completeOne();
        node.completeOne();
        std.Thread.sleep(5 * speed_factor);

        node.end();

        std.Thread.sleep(5 * speed_factor);
    }
    {
        var node = root_node.start("this is a really long name designed to activate the truncation code. let's find out if it works", 0);
        node.activate();
        std.Thread.sleep(10 * speed_factor);
        progress.refresh();
        std.Thread.sleep(10 * speed_factor);
        node.end();
    }
}

const builtin = @import("builtin");
const std = @import("std");
const windows = std.os.windows;

const bun = @import("bun");
const assert = bun.assert;
