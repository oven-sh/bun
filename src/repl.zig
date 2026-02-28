//! Bun REPL - A modern, feature-rich Read-Eval-Print Loop
//!
//! This is a native Zig implementation of Bun's REPL with advanced TUI features:
//! - Syntax highlighting using QuickAndDirtySyntaxHighlighter
//! - Full line editing with cursor movement (Emacs-style keybindings)
//! - Persistent history with file storage
//! - Tab completion for properties and commands
//! - Multi-line input support
//! - REPL commands (.help, .exit, .clear, .load, .save, .editor)
//! - Result formatting with util.inspect integration
//!
//! This replaces the TypeScript-based REPL for faster startup and better integration.

const Repl = @This();

// ============================================================================
// C++ Bindings
// ============================================================================

extern fn Bun__REPL__evaluate(
    globalObject: *jsc.JSGlobalObject,
    sourcePtr: [*]const u8,
    sourceLen: usize,
    filenamePtr: [*]const u8,
    filenameLen: usize,
    exception: *jsc.JSValue,
) jsc.JSValue;

extern fn Bun__REPL__getCompletions(
    globalObject: *jsc.JSGlobalObject,
    targetValue: jsc.JSValue,
    prefixPtr: [*]const u8,
    prefixLen: usize,
) jsc.JSValue;
// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_SIZE: usize = 1000;
const MAX_LINE_LENGTH: usize = 16384;
const HISTORY_FILENAME = ".bun_repl_history";
const TAB_WIDTH: usize = 2;

// ANSI escape codes
const ESC = "\x1b";
const CSI = ESC ++ "[";

// Colors
const Color = struct {
    const reset = CSI ++ "0m";
    const bold = CSI ++ "1m";
    const dim = CSI ++ "2m";
    const red = CSI ++ "31m";
    const green = CSI ++ "32m";
    const yellow = CSI ++ "33m";
    const blue = CSI ++ "34m";
    const magenta = CSI ++ "35m";
    const cyan = CSI ++ "36m";
    const white = CSI ++ "37m";
};

// Cursor control
const Cursor = struct {
    const hide = CSI ++ "?25l";
    const show = CSI ++ "?25h";
    const save = ESC ++ "7";
    const restore = ESC ++ "8";
    const home = CSI ++ "H";
    const clear_line = CSI ++ "2K";
    const clear_to_end = CSI ++ "0K";
    const clear_to_start = CSI ++ "1K";
    const clear_screen = CSI ++ "2J";
    const clear_scrollback = CSI ++ "3J";
};

// ============================================================================
// Key Codes
// ============================================================================

const Key = union(enum) {
    // Control keys
    ctrl_a,
    ctrl_b,
    ctrl_c,
    ctrl_d,
    ctrl_e,
    ctrl_f,
    ctrl_k,
    ctrl_l,
    ctrl_n,
    ctrl_p,
    ctrl_r,
    ctrl_t,
    ctrl_u,
    ctrl_w,
    backspace,
    tab,
    enter,
    escape,

    // Special keys
    delete,
    home,
    end,
    page_up,
    page_down,
    arrow_up,
    arrow_down,
    arrow_right,
    arrow_left,

    // Alt combinations
    alt_b,
    alt_d,
    alt_f,
    alt_backspace,
    alt_left,
    alt_right,

    // Regular printable character
    char: u8,

    // Unknown/unhandled
    unknown,

    pub fn fromByte(byte: u8) Key {
        return switch (byte) {
            1 => .ctrl_a,
            2 => .ctrl_b,
            3 => .ctrl_c,
            4 => .ctrl_d,
            5 => .ctrl_e,
            6 => .ctrl_f,
            11 => .ctrl_k,
            12 => .ctrl_l,
            14 => .ctrl_n,
            16 => .ctrl_p,
            18 => .ctrl_r,
            20 => .ctrl_t,
            21 => .ctrl_u,
            23 => .ctrl_w,
            8, 127 => .backspace,
            9 => .tab,
            10, 13 => .enter,
            27 => .escape,
            32...126 => .{ .char = byte },
            else => .unknown,
        };
    }
};

// ============================================================================
// History
// ============================================================================

const History = struct {
    entries: ArrayList([]const u8),
    position: usize = 0,
    temp_line: ?[]const u8 = null,
    file_path: ?[]const u8 = null,
    allocator: Allocator,
    modified: bool = false,

    pub fn init(allocator: Allocator) History {
        return .{
            .entries = ArrayList([]const u8).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *History) void {
        for (self.entries.items) |entry| {
            self.allocator.free(entry);
        }
        self.entries.deinit();
        if (self.temp_line) |line| {
            self.allocator.free(line);
        }
        if (self.file_path) |path| {
            self.allocator.free(path);
        }
    }

    pub fn load(self: *History) !void {
        const home_path = bun.env_var.HOME.get() orelse return;
        if (home_path.len == 0) return;

        var path_buf: bun.PathBuffer = undefined;
        const path = bun.path.joinZBuf(&path_buf, &[_][]const u8{ home_path, HISTORY_FILENAME }, .auto);
        self.file_path = try self.allocator.dupe(u8, path);

        const content = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, self.allocator)) {
            .result => |bytes| bytes,
            .err => return,
        };
        defer self.allocator.free(content);

        var lines = std.mem.splitScalar(u8, content, '\n');
        while (lines.next()) |line| {
            if (line.len > 0) {
                const entry = try self.allocator.dupe(u8, line);
                try self.entries.append(entry);
            }
        }

        // Trim to max size
        while (self.entries.items.len > MAX_HISTORY_SIZE) {
            const old = self.entries.orderedRemove(0);
            self.allocator.free(old);
        }

        self.position = self.entries.items.len;
    }

    pub fn save(self: *History) void {
        if (!self.modified) return;
        const path = self.file_path orelse return;

        // Build content
        const start = if (self.entries.items.len > MAX_HISTORY_SIZE)
            self.entries.items.len - MAX_HISTORY_SIZE
        else
            0;

        var content = ArrayList(u8).init(self.allocator);
        defer content.deinit();
        for (self.entries.items[start..]) |entry| {
            content.appendSlice(entry) catch return;
            content.append('\n') catch return;
        }

        const file = switch (bun.sys.openA(path, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
            .result => |fd| bun.sys.File{ .handle = fd },
            .err => return,
        };
        defer file.close();
        switch (file.writeAll(content.items)) {
            .result => {},
            .err => return,
        }

        self.modified = false;
    }

    pub fn add(self: *History, line: []const u8) !void {
        if (line.len == 0) return;

        // Don't add duplicates of the last entry
        if (self.entries.items.len > 0) {
            const last = self.entries.items[self.entries.items.len - 1];
            if (strings.eqlLong(last, line, true)) {
                self.position = self.entries.items.len;
                return;
            }
        }

        const entry = try self.allocator.dupe(u8, line);
        try self.entries.append(entry);
        self.position = self.entries.items.len;
        self.modified = true;

        // Trim if too large
        while (self.entries.items.len > MAX_HISTORY_SIZE) {
            const old = self.entries.orderedRemove(0);
            self.allocator.free(old);
            self.position -|= 1;
        }
    }

    pub fn prev(self: *History, current_line: []const u8) ?[]const u8 {
        if (self.entries.items.len == 0) return null;

        // Save current line if at the end
        if (self.position == self.entries.items.len) {
            if (self.temp_line) |old| {
                self.allocator.free(old);
            }
            self.temp_line = self.allocator.dupe(u8, current_line) catch null;
        }

        if (self.position > 0) {
            self.position -= 1;
            return self.entries.items[self.position];
        }

        return null;
    }

    pub fn next(self: *History) ?[]const u8 {
        if (self.position < self.entries.items.len) {
            self.position += 1;
        }

        if (self.position == self.entries.items.len) {
            // Keep ownership in History; resetPosition() frees temp_line.
            // Caller copies the data via set(), so borrowed reference is safe.
            return self.temp_line;
        }

        if (self.position < self.entries.items.len) {
            return self.entries.items[self.position];
        }

        return null;
    }

    pub fn resetPosition(self: *History) void {
        self.position = self.entries.items.len;
        if (self.temp_line) |line| {
            self.allocator.free(line);
            self.temp_line = null;
        }
    }
};

// ============================================================================
// Line Editor
// ============================================================================

const LineEditor = struct {
    buffer: ArrayList(u8),
    cursor: usize = 0,
    allocator: Allocator,

    pub fn init(allocator: Allocator) LineEditor {
        return .{
            .buffer = ArrayList(u8).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *LineEditor) void {
        self.buffer.deinit();
    }

    pub fn clear(self: *LineEditor) void {
        self.buffer.clearRetainingCapacity();
        self.cursor = 0;
    }

    pub fn set(self: *LineEditor, text: []const u8) !void {
        self.buffer.clearRetainingCapacity();
        try self.buffer.appendSlice(text);
        self.cursor = text.len;
    }

    pub fn insert(self: *LineEditor, char: u8) !void {
        if (self.cursor == self.buffer.items.len) {
            try self.buffer.append(char);
        } else {
            try self.buffer.insert(self.cursor, char);
        }
        self.cursor += 1;
    }

    pub fn insertSlice(self: *LineEditor, slice: []const u8) !void {
        if (self.cursor == self.buffer.items.len) {
            try self.buffer.appendSlice(slice);
        } else {
            try self.buffer.insertSlice(self.cursor, slice);
        }
        self.cursor += slice.len;
    }

    pub fn deleteChar(self: *LineEditor) void {
        if (self.cursor < self.buffer.items.len) {
            _ = self.buffer.orderedRemove(self.cursor);
        }
    }

    pub fn backspace(self: *LineEditor) void {
        if (self.cursor > 0) {
            self.cursor -= 1;
            _ = self.buffer.orderedRemove(self.cursor);
        }
    }

    pub fn deleteWord(self: *LineEditor) void {
        // Delete word forward
        while (self.cursor < self.buffer.items.len and
            std.ascii.isWhitespace(self.buffer.items[self.cursor]))
        {
            _ = self.buffer.orderedRemove(self.cursor);
        }
        while (self.cursor < self.buffer.items.len and
            !std.ascii.isWhitespace(self.buffer.items[self.cursor]))
        {
            _ = self.buffer.orderedRemove(self.cursor);
        }
    }

    pub fn backspaceWord(self: *LineEditor) void {
        // Delete word backward
        while (self.cursor > 0 and
            std.ascii.isWhitespace(self.buffer.items[self.cursor - 1]))
        {
            self.cursor -= 1;
            _ = self.buffer.orderedRemove(self.cursor);
        }
        while (self.cursor > 0 and
            !std.ascii.isWhitespace(self.buffer.items[self.cursor - 1]))
        {
            self.cursor -= 1;
            _ = self.buffer.orderedRemove(self.cursor);
        }
    }

    pub fn deleteToEnd(self: *LineEditor) void {
        self.buffer.shrinkRetainingCapacity(self.cursor);
    }

    pub fn deleteToStart(self: *LineEditor) void {
        if (self.cursor > 0) {
            std.mem.copyForwards(u8, self.buffer.items[0..], self.buffer.items[self.cursor..]);
            self.buffer.shrinkRetainingCapacity(self.buffer.items.len - self.cursor);
            self.cursor = 0;
        }
    }

    pub fn moveLeft(self: *LineEditor) void {
        if (self.cursor > 0) {
            self.cursor -= 1;
        }
    }

    pub fn moveRight(self: *LineEditor) void {
        if (self.cursor < self.buffer.items.len) {
            self.cursor += 1;
        }
    }

    pub fn moveWordLeft(self: *LineEditor) void {
        while (self.cursor > 0 and
            std.ascii.isWhitespace(self.buffer.items[self.cursor - 1]))
        {
            self.cursor -= 1;
        }
        while (self.cursor > 0 and
            !std.ascii.isWhitespace(self.buffer.items[self.cursor - 1]))
        {
            self.cursor -= 1;
        }
    }

    pub fn moveWordRight(self: *LineEditor) void {
        while (self.cursor < self.buffer.items.len and
            !std.ascii.isWhitespace(self.buffer.items[self.cursor]))
        {
            self.cursor += 1;
        }
        while (self.cursor < self.buffer.items.len and
            std.ascii.isWhitespace(self.buffer.items[self.cursor]))
        {
            self.cursor += 1;
        }
    }

    pub fn moveToStart(self: *LineEditor) void {
        self.cursor = 0;
    }

    pub fn moveToEnd(self: *LineEditor) void {
        self.cursor = self.buffer.items.len;
    }

    pub fn swap(self: *LineEditor) void {
        if (self.cursor > 0 and self.cursor < self.buffer.items.len) {
            const temp = self.buffer.items[self.cursor - 1];
            self.buffer.items[self.cursor - 1] = self.buffer.items[self.cursor];
            self.buffer.items[self.cursor] = temp;
            self.cursor += 1;
        } else if (self.cursor > 1 and self.cursor == self.buffer.items.len) {
            const temp = self.buffer.items[self.cursor - 2];
            self.buffer.items[self.cursor - 2] = self.buffer.items[self.cursor - 1];
            self.buffer.items[self.cursor - 1] = temp;
        }
    }

    pub fn getLine(self: *const LineEditor) []const u8 {
        return self.buffer.items;
    }
};

// ============================================================================
// REPL Commands
// ============================================================================

const ReplCommand = struct {
    name: []const u8,
    help: []const u8,
    handler: *const fn (*Repl, []const u8) ReplResult,

    pub const all = [_]ReplCommand{
        .{ .name = ".help", .help = "Print this help message", .handler = cmdHelp },
        .{ .name = ".exit", .help = "Exit the REPL", .handler = cmdExit },
        .{ .name = ".clear", .help = "Clear the screen", .handler = cmdClear },
        .{ .name = ".copy", .help = "Copy result to clipboard (.copy [expr])", .handler = cmdCopy },
        .{ .name = ".load", .help = "Load a file into the REPL session", .handler = cmdLoad },
        .{ .name = ".save", .help = "Save REPL history to a file", .handler = cmdSave },
        .{ .name = ".editor", .help = "Enter multi-line editor mode", .handler = cmdEditor },
        .{ .name = ".break", .help = "Cancel current input", .handler = cmdBreak },
        .{ .name = ".history", .help = "Show command history", .handler = cmdHistory },
    };

    pub fn find(name: []const u8) ?*const ReplCommand {
        for (&all) |*cmd| {
            if (strings.eqlLong(cmd.name, name, true) or
                (name.len > 1 and strings.startsWith(cmd.name, name)))
            {
                return cmd;
            }
        }
        return null;
    }
};

const ReplResult = enum {
    continue_repl,
    exit_repl,
    skip_eval,
};

fn cmdHelp(repl: *Repl, _: []const u8) ReplResult {
    repl.print("\n{s}REPL Commands:{s}\n", .{ Color.bold, Color.reset });
    for (ReplCommand.all) |cmd| {
        repl.print("  {s}{s:<12}{s} {s}\n", .{ Color.cyan, cmd.name, Color.reset, cmd.help });
    }
    repl.print("\n{s}Keybindings:{s}\n", .{ Color.bold, Color.reset });
    repl.print("  {s}Ctrl+A{s}       Move to start of line\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+E{s}       Move to end of line\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+B/F{s}     Move backward/forward one character\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Alt+B/F{s}      Move backward/forward one word\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+U{s}       Delete to start of line\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+K{s}       Delete to end of line\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+W{s}       Delete word backward\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+D{s}       Delete character / Exit if line empty\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+L{s}       Clear screen\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Ctrl+T{s}       Swap characters\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Up/Down{s}      Navigate history\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}Tab{s}          Auto-complete\n", .{ Color.cyan, Color.reset });
    repl.print("\n{s}Special Variables:{s}\n", .{ Color.bold, Color.reset });
    repl.print("  {s}_{s}            Last expression result\n", .{ Color.cyan, Color.reset });
    repl.print("  {s}_error{s}       Last error\n", .{ Color.cyan, Color.reset });
    repl.print("\n", .{});
    return .skip_eval;
}

fn cmdCopy(repl: *Repl, args: []const u8) ReplResult {
    const code = strings.trim(args, " \t");

    if (code.len == 0) {
        // .copy with no args - copy _ (last result) to clipboard
        repl.copyValueToClipboard(repl.last_result) catch |err| {
            if (repl.global) |global| {
                const exc = global.takeException(err);
                repl.setLastError(exc);
                repl.printJSError(exc);
            }
        };
        return .skip_eval;
    }

    // .copy <code> - evaluate and copy result to clipboard instead of printing
    repl.evaluateAndCopy(code);
    return .skip_eval;
}

fn cmdExit(_: *Repl, _: []const u8) ReplResult {
    return .exit_repl;
}

fn cmdClear(repl: *Repl, _: []const u8) ReplResult {
    // Clear screen
    repl.write(Cursor.clear_screen);
    repl.write(Cursor.clear_scrollback);
    repl.write(Cursor.home);
    return .skip_eval;
}

fn cmdLoad(repl: *Repl, args: []const u8) ReplResult {
    const filename = strings.trim(args, " \t");
    if (filename.len == 0) {
        repl.printError("Usage: .load <filename>\n", .{});
        return .skip_eval;
    }

    var path_buf: bun.PathBuffer = undefined;
    const pathZ = bun.path.z(filename, &path_buf);
    const content = switch (bun.sys.File.readFrom(bun.FD.cwd(), pathZ, repl.allocator)) {
        .result => |bytes| bytes,
        .err => |err| {
            repl.printError("{f}\n", .{err});
            return .skip_eval;
        },
    };
    defer repl.allocator.free(content);

    repl.print("{s}Loading {s}...{s}\n", .{ Color.dim, filename, Color.reset });
    repl.evaluateAndPrint(content);
    return .skip_eval;
}

fn cmdSave(repl: *Repl, args: []const u8) ReplResult {
    const filename = strings.trim(args, " \t");
    if (filename.len == 0) {
        repl.printError("Usage: .save <filename>\n", .{});
        return .skip_eval;
    }

    // Build content
    var content = ArrayList(u8).init(repl.allocator);
    defer content.deinit();
    for (repl.history.entries.items) |entry| {
        content.appendSlice(entry) catch return .skip_eval;
        content.append('\n') catch return .skip_eval;
    }

    const file = switch (bun.sys.openA(filename, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
        .result => |fd| bun.sys.File{ .handle = fd },
        .err => |err| {
            repl.printError("{f}\n", .{err});
            return .skip_eval;
        },
    };
    defer file.close();
    switch (file.writeAll(content.items)) {
        .result => {},
        .err => |err| {
            repl.printError("{f}\n", .{err});
            return .skip_eval;
        },
    }

    repl.print("{s}Session saved to {s}{s}\n", .{ Color.green, filename, Color.reset });
    return .skip_eval;
}

fn cmdEditor(repl: *Repl, _: []const u8) ReplResult {
    repl.print("{s}// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel){s}\n", .{ Color.dim, Color.reset });
    repl.editor_mode = true;
    repl.editor_buffer.clearRetainingCapacity();
    return .skip_eval;
}

fn cmdBreak(repl: *Repl, _: []const u8) ReplResult {
    repl.line_editor.clear();
    repl.multiline_buffer.clearRetainingCapacity();
    repl.in_multiline = false;
    return .skip_eval;
}

fn cmdHistory(repl: *Repl, _: []const u8) ReplResult {
    repl.print("\n{s}Command History:{s}\n", .{ Color.bold, Color.reset });
    const start = if (repl.history.entries.items.len > 20)
        repl.history.entries.items.len - 20
    else
        0;
    for (repl.history.entries.items[start..], start..) |entry, i| {
        repl.print("  {s}{d:>4}{s}  {s}\n", .{ Color.dim, i + 1, Color.reset, entry });
    }
    repl.print("\n", .{});
    return .skip_eval;
}

// ============================================================================
// Main REPL Struct
// ============================================================================

allocator: Allocator,
line_editor: LineEditor,
history: History,
multiline_buffer: ArrayList(u8),
editor_buffer: ArrayList(u8),

// State
in_multiline: bool = false,
editor_mode: bool = false,
running: bool = false,
is_tty: bool = false,
use_colors: bool = false,
terminal_width: u16 = 80,
terminal_height: u16 = 24,
ctrl_c_pressed: bool = false,

// Buffered stdin
stdin_buf: [256]u8 = .{0} ** 256,
stdin_buf_start: usize = 0,
stdin_buf_end: usize = 0,

// JavaScript VM
vm: ?*jsc.VirtualMachine = null,
global: ?*jsc.JSGlobalObject = null,

// Special REPL variables
last_result: jsc.JSValue = .js_undefined,
last_error: jsc.JSValue = .js_undefined,

// Windows: saved console mode for restoration
original_windows_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (Environment.isWindows) null else {},

pub fn init(allocator: Allocator) Repl {
    return .{
        .allocator = allocator,
        .line_editor = LineEditor.init(allocator),
        .history = History.init(allocator),
        .multiline_buffer = ArrayList(u8).init(allocator),
        .editor_buffer = ArrayList(u8).init(allocator),
    };
}

pub fn deinit(self: *Repl) void {
    self.restoreTerminal();
    self.history.save();
    self.line_editor.deinit();
    self.history.deinit();
    self.multiline_buffer.deinit();
    self.editor_buffer.deinit();
    if (!self.last_result.isUndefined()) self.last_result.unprotect();
    if (!self.last_error.isUndefined()) self.last_error.unprotect();
}

fn setLastResult(self: *Repl, value: jsc.JSValue) void {
    if (!self.last_result.isUndefined()) self.last_result.unprotect();
    self.last_result = value;
    if (!value.isUndefined()) value.protect();
}

fn setLastError(self: *Repl, value: jsc.JSValue) void {
    if (!self.last_error.isUndefined()) self.last_error.unprotect();
    self.last_error = value;
    if (!value.isUndefined()) value.protect();
}

// ============================================================================
// Terminal I/O
// ============================================================================

fn setupTerminal(self: *Repl) void {
    self.is_tty = Output.isStdoutTTY() and Output.isStdinTTY();

    if (!self.is_tty) {
        self.use_colors = false;
        return;
    }

    // Check for NO_COLOR
    self.use_colors = !bun.env_var.NO_COLOR.get();

    // Get terminal size
    if (Output.terminal_size.col > 0) {
        self.terminal_width = Output.terminal_size.col;
        self.terminal_height = Output.terminal_size.row;
    }

    // Enable raw mode
    if (Environment.isPosix) {
        _ = bun.tty.setMode(0, .raw);
    } else if (Environment.isWindows) {
        self.original_windows_mode = bun.windows.updateStdioModeFlags(.std_in, .{
            .set = bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT | bun.windows.ENABLE_PROCESSED_INPUT,
            .unset = bun.windows.ENABLE_LINE_INPUT | bun.windows.ENABLE_ECHO_INPUT,
        }) catch null;
    }
}

fn restoreTerminal(self: *Repl) void {
    if (Environment.isPosix) {
        _ = bun.tty.setMode(0, .normal);
    } else if (Environment.isWindows) {
        if (self.original_windows_mode) |mode| {
            _ = bun.c.SetConsoleMode(bun.FD.stdin().native(), mode);
            self.original_windows_mode = null;
        }
    }
}

/// Global pointer for signal handler to access the VM
var sigint_vm: ?*jsc.VM = null;

fn sigintHandler(_: c_int) callconv(.c) void {
    if (sigint_vm) |vm| {
        vm.setExecutionForbidden(true);
    }
}

/// Temporarily enable SIGINT delivery during blocking promise waits
fn enableSignalsDuringWait(self: *Repl) void {
    if (self.vm) |vm| {
        sigint_vm = vm.jsc_vm;
    }

    if (Environment.isPosix) {
        // Switch to normal terminal mode (has ISIG) so Ctrl+C generates SIGINT
        _ = bun.tty.setMode(0, .normal);

        // Install SIGINT handler
        const act = std.posix.Sigaction{
            .handler = .{ .handler = sigintHandler },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.INT, &act, null);
    }
    // On Windows, ENABLE_PROCESSED_INPUT is already set so Ctrl+C works
}

/// Restore raw terminal mode after promise wait
fn disableSignalsDuringWait(self: *Repl) void {
    _ = self;
    sigint_vm = null;

    if (Environment.isPosix) {
        // Back to raw mode
        _ = bun.tty.setMode(0, .raw);

        // Restore default SIGINT handling
        const act = std.posix.Sigaction{
            .handler = .{ .handler = std.posix.SIG.DFL },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.INT, &act, null);
    }
}

fn write(_: *Repl, data: []const u8) void {
    Output.writer().writeAll(data) catch {};
}

fn print(_: *Repl, comptime format: []const u8, args: anytype) void {
    Output.writer().print(format, args) catch {};
}

fn printError(self: *Repl, comptime format: []const u8, args: anytype) void {
    if (self.use_colors) {
        Output.writer().print(Color.red ++ format ++ Color.reset, args) catch {};
    } else {
        Output.writer().print(format, args) catch {};
    }
}

fn readByte(self: *Repl) ?u8 {
    if (self.stdin_buf_start < self.stdin_buf_end) {
        const b = self.stdin_buf[self.stdin_buf_start];
        self.stdin_buf_start += 1;
        return b;
    }
    // Refill buffer
    const stdin = bun.sys.File{ .handle = bun.FD.stdin() };
    const n = switch (stdin.read(&self.stdin_buf)) {
        .result => |n| n,
        .err => return null,
    };
    if (n == 0) return null;
    self.stdin_buf_start = 1;
    self.stdin_buf_end = n;
    return self.stdin_buf[0];
}

fn readKey(self: *Repl) ?Key {
    const byte = self.readByte() orelse return null;

    // Handle escape sequences
    if (byte == 27) { // ESC
        const second = self.readByte() orelse return .escape;

        if (second == '[') { // CSI
            const third = self.readByte() orelse return .escape;

            return switch (third) {
                'A' => .arrow_up,
                'B' => .arrow_down,
                'C' => .arrow_right,
                'D' => .arrow_left,
                'H' => .home,
                'F' => .end,
                '1'...'6' => blk: {
                    const fourth = self.readByte() orelse break :blk .unknown;
                    if (fourth == '~') {
                        break :blk switch (third) {
                            '1' => .home,
                            '2' => .unknown, // insert
                            '3' => .delete,
                            '4' => .end,
                            '5' => .page_up,
                            '6' => .page_down,
                            else => .unknown,
                        };
                    } else if (fourth == ';') {
                        const mod = self.readByte() orelse break :blk .unknown;
                        const dir = self.readByte() orelse break :blk .unknown;
                        if (mod == '5' or mod == '3') {
                            break :blk switch (dir) {
                                'C' => .alt_right,
                                'D' => .alt_left,
                                else => .unknown,
                            };
                        }
                        break :blk .unknown;
                    }
                    break :blk .unknown;
                },
                else => .unknown,
            };
        } else if (second == 'O') { // SS3
            const third = self.readByte() orelse return .escape;
            return switch (third) {
                'H' => .home,
                'F' => .end,
                else => .unknown,
            };
        } else if (second == 'b') {
            return .alt_b;
        } else if (second == 'd') {
            return .alt_d;
        } else if (second == 'f') {
            return .alt_f;
        } else if (second == 127) {
            return .alt_backspace;
        }

        return .escape;
    }

    return Key.fromByte(byte);
}

// ============================================================================
// Prompt and Display
// ============================================================================

fn getPrompt(self: *Repl) []const u8 {
    if (self.in_multiline or self.editor_mode) {
        if (self.use_colors) {
            return Color.dim ++ "... " ++ Color.reset;
        } else {
            return "... ";
        }
    }

    if (self.use_colors) {
        return Color.dim ++ "\xe2\x9d\xaf" ++ Color.reset ++ " ";
    } else {
        return "> ";
    }
}

fn getPromptLength(self: *Repl) usize {
    if (self.in_multiline or self.editor_mode) {
        return 4; // "... "
    }
    return 2; // "> " or "\u{276f} "
}

fn refreshLine(self: *Repl) void {
    // Flush any buffered output (e.g., from console.log in JS) before drawing prompt
    Output.flush();

    const prompt = self.getPrompt();
    const prompt_len = self.getPromptLength();
    const line = self.line_editor.getLine();

    // Move to beginning of line
    self.write("\r");
    self.write(Cursor.clear_line);

    // Write prompt
    self.write(prompt);

    // Write line with syntax highlighting
    if (self.use_colors and line.len > 0 and line.len <= 2048) {
        self.writeHighlighted(line);
    } else {
        self.write(line);
    }

    // Position cursor
    const cursor_pos = prompt_len + self.line_editor.cursor;
    if (cursor_pos < self.terminal_width) {
        self.write("\r");
        if (cursor_pos > 0) {
            var buf: [16]u8 = undefined;
            const seq = std.fmt.bufPrint(&buf, CSI ++ "{d}C", .{cursor_pos}) catch return;
            self.write(seq);
        }
    }

    Output.flush();
}

fn writeHighlighted(_: *Repl, text: []const u8) void {
    var writer = Output.writer();
    const highlighter = fmt.QuickAndDirtyJavaScriptSyntaxHighlighter{
        .text = text,
        .opts = .{
            .enable_colors = true,
            .check_for_unhighlighted_write = false,
        },
    };
    highlighter.format(writer) catch {
        writer.writeAll(text) catch {};
    };
}

// ============================================================================
// Code Completion
// ============================================================================

fn isIncompleteCode(code: []const u8) bool {
    var brace_count: i32 = 0;
    var bracket_count: i32 = 0;
    var paren_count: i32 = 0;
    var in_string: u8 = 0;
    var in_template = false;
    var escaped = false;

    for (code) |char| {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (char == '\\') {
            escaped = true;
            continue;
        }

        // Handle strings
        if (in_string == 0 and !in_template) {
            if (char == '"' or char == '\'') {
                in_string = char;
                continue;
            }
            if (char == '`') {
                in_template = true;
                continue;
            }
        } else if (in_string != 0 and char == in_string) {
            in_string = 0;
            continue;
        } else if (in_template and char == '`') {
            in_template = false;
            continue;
        }

        // Skip content inside strings
        if (in_string != 0 or in_template) continue;

        // Count brackets
        switch (char) {
            '{' => brace_count += 1,
            '}' => brace_count -= 1,
            '[' => bracket_count += 1,
            ']' => bracket_count -= 1,
            '(' => paren_count += 1,
            ')' => paren_count -= 1,
            else => {},
        }
    }

    // Incomplete if any unclosed delimiters or unclosed strings
    return in_string != 0 or in_template or brace_count > 0 or bracket_count > 0 or paren_count > 0;
}

// ============================================================================
// JavaScript Evaluation
// ============================================================================

fn evaluateAndPrint(self: *Repl, code: []const u8) void {
    const global = self.global orelse return;
    const vm = self.vm orelse return;

    // Transform the code using REPL mode (hoists declarations, wraps result in { value: expr })
    const transformed_code = self.transformForRepl(code) orelse {
        // Transform failed, try evaluating raw code (for syntax errors, etc.)
        self.evaluateRaw(code);
        return;
    };
    defer self.allocator.free(transformed_code);

    // Evaluate the transformed code
    var exception: jsc.JSValue = .js_undefined;
    const result = Bun__REPL__evaluate(
        global,
        transformed_code.ptr,
        transformed_code.len,
        "[repl]".ptr,
        "[repl]".len,
        &exception,
    );

    // Check for exception
    if (!exception.isUndefined() and !exception.isNull()) {
        self.setLastError(exception);
        self.printJSError(exception);
        return;
    }

    // Handle async IIFE results - wait for promise to resolve
    var resolved_result = result;
    if (result.asPromise()) |promise| {
        // Mark as handled BEFORE waiting to prevent unhandled rejection output
        promise.setHandled();

        // Temporarily re-enable signal delivery so Ctrl+C can interrupt
        // the blocking waitForPromise call
        self.enableSignalsDuringWait();
        defer self.disableSignalsDuringWait();

        // Wait for the promise to settle
        vm.waitForPromise(.{ .normal = promise });

        // If execution was forbidden by SIGINT, clear it and report
        if (vm.jsc_vm.executionForbidden()) {
            vm.jsc_vm.setExecutionForbidden(false);
            global.clearTerminationException();
            self.print("\n", .{});
            return;
        }

        // Check promise status after waiting
        switch (promise.status()) {
            .fulfilled => {
                resolved_result = promise.result(vm.jsc_vm);
            },
            .rejected => {
                const rejection = promise.result(vm.jsc_vm);
                self.setLastError(rejection);
                // Set _error on the global object
                const global_this = global.toJSValue();
                global_this.put(global, "_error", rejection);
                self.printJSError(rejection);
                return;
            },
            .pending => {
                // Interrupted by signal or timed out
                self.print("\n", .{});
                return;
            },
        }
    }

    // Extract the value from the result wrapper { value: expr }
    // The REPL transform wraps the last expression in { value: expr }
    var actual_result = resolved_result;
    if (resolved_result.isObject()) {
        // Wrapper is REPL-built { __proto__: null, value: ... } so getOwn shouldn't throw,
        // but if it does, propagate as a REPL error.
        const maybe_value = resolved_result.getOwn(global, "value") catch |err| {
            const exc = global.takeException(err);
            self.setLastError(exc);
            self.printJSError(exc);
            vm.tick();
            return;
        };
        if (maybe_value) |value| {
            actual_result = value;
        }
    }

    // Store and print result
    self.setLastResult(actual_result);

    // Set _ to the last result (only if not undefined)
    // Use the global object as JSValue and put the property on it
    if (!actual_result.isUndefined()) {
        const global_this = global.toJSValue();
        global_this.put(global, "_", actual_result);
    }

    if (actual_result.isUndefined()) {
        if (self.use_colors) {
            self.print("{s}undefined{s}\n", .{ Color.dim, Color.reset });
        } else {
            self.print("undefined\n", .{});
        }
    } else {
        self.printFormattedValue(actual_result);
    }

    // Tick the event loop to handle any pending work
    vm.tick();
}

/// Evaluate a script from `bun repl -e/--eval` or `-p/--print` non-interactively.
/// Uses the REPL transform pipeline (TypeScript/JSX, top-level await, object literal
/// wrapping, declaration hoisting), drains the event loop, and optionally prints the
/// result to stdout. Errors are written to stderr.
/// Returns true if an error occurred (the caller should set exit_code=1 and
/// skip onBeforeExit); false on success (caller preserves process.exitCode).
pub fn evalScript(self: *Repl, code: []const u8, print_result: bool) bool {
    const global = self.global orelse return true;
    const vm = self.vm orelse return true;

    const no_color = bun.env_var.NO_COLOR.get();
    self.use_colors = Output.enable_ansi_colors_stdout and !no_color;
    const stderr_colors = Output.enable_ansi_colors_stderr and !no_color;

    // Empty / whitespace-only script: nothing to do (matches `node -e ""`)
    if (strings.trim(code, " \t\n\r").len == 0) {
        if (print_result) {
            if (self.use_colors) {
                self.print("{s}undefined{s}\n", .{ Color.dim, Color.reset });
            } else {
                self.print("undefined\n", .{});
            }
        }
        return false;
    }

    const transformed_code = self.transformForRepl(code) orelse {
        // Transform failed — fall back to raw evaluation for the error message
        var exception: jsc.JSValue = .js_undefined;
        _ = Bun__REPL__evaluate(global, code.ptr, code.len, "[eval]".ptr, "[eval]".len, &exception);
        if (!exception.isUndefined() and !exception.isNull()) {
            self.printJSErrorTo(exception, Output.errorWriter(), stderr_colors);
        }
        return true;
    };
    defer self.allocator.free(transformed_code);

    var exception: jsc.JSValue = .js_undefined;
    const result = Bun__REPL__evaluate(
        global,
        transformed_code.ptr,
        transformed_code.len,
        "[eval]".ptr,
        "[eval]".len,
        &exception,
    );

    if (!exception.isUndefined() and !exception.isNull()) {
        self.printJSErrorTo(exception, Output.errorWriter(), stderr_colors);
        return true;
    }

    // If the transform wrapped in an async IIFE (top-level await), wait for it
    var resolved_result = result;
    if (result.asPromise()) |promise| {
        promise.setHandled();
        vm.waitForPromise(.{ .normal = promise });
        switch (promise.status()) {
            .fulfilled => resolved_result = promise.result(vm.jsc_vm),
            .rejected => {
                const rejection = promise.result(vm.jsc_vm);
                self.printJSErrorTo(rejection, Output.errorWriter(), stderr_colors);
                return true;
            },
            .pending => return true,
        }
    }

    // Unwrap the { value: expr } wrapper produced by transformForRepl
    var actual_result = resolved_result;
    if (resolved_result.isObject()) {
        const maybe_value = resolved_result.getOwn(global, "value") catch |err| {
            const exc = global.takeException(err);
            self.printJSErrorTo(exc, Output.errorWriter(), stderr_colors);
            return true;
        };
        if (maybe_value) |value| actual_result = value;
    }
    // Protect across tick() in case of GC
    if (!actual_result.isUndefined()) actual_result.protect();
    defer if (!actual_result.isUndefined()) actual_result.unprotect();

    // Drain the event loop (timers, I/O, etc.) before printing / exiting
    vm.tick();
    while (vm.isEventLoopAlive()) {
        vm.tick();
        vm.eventLoop().autoTickActive();
    }

    if (print_result) {
        if (actual_result.isUndefined()) {
            if (self.use_colors) {
                self.print("{s}undefined{s}\n", .{ Color.dim, Color.reset });
            } else {
                self.print("undefined\n", .{});
            }
        } else {
            self.printFormattedValue(actual_result);
        }
    }

    return false;
}

/// Evaluate code without REPL transforms (fallback for errors)
/// The C++ Bun__REPL__evaluate handles setting _ and _error
fn evaluateRaw(self: *Repl, code: []const u8) void {
    const global = self.global orelse return;

    var exception: jsc.JSValue = .js_undefined;
    const result = Bun__REPL__evaluate(
        global,
        code.ptr,
        code.len,
        "[repl]".ptr,
        "[repl]".len,
        &exception,
    );

    if (!exception.isUndefined() and !exception.isNull()) {
        self.setLastError(exception);
        self.printJSError(exception);
        return;
    }

    self.setLastResult(result);

    if (!result.isUndefined()) {
        self.printFormattedValue(result);
    } else {
        if (self.use_colors) {
            self.print("{s}undefined{s}\n", .{ Color.dim, Color.reset });
        } else {
            self.print("undefined\n", .{});
        }
    }

    if (self.vm) |vm| {
        vm.tick();
    }
}

/// Evaluate code and copy the result to clipboard instead of printing it
fn evaluateAndCopy(self: *Repl, code: []const u8) void {
    const global = self.global orelse return;
    const vm = self.vm orelse return;

    const transformed_code = self.transformForRepl(code) orelse {
        self.evaluateRaw(code);
        return;
    };
    defer self.allocator.free(transformed_code);

    var exception: jsc.JSValue = .js_undefined;
    const result = Bun__REPL__evaluate(
        global,
        transformed_code.ptr,
        transformed_code.len,
        "[repl]".ptr,
        "[repl]".len,
        &exception,
    );

    if (!exception.isUndefined() and !exception.isNull()) {
        self.setLastError(exception);
        self.printJSError(exception);
        return;
    }

    var resolved_result = result;
    if (result.asPromise()) |promise| {
        promise.setHandled();
        self.enableSignalsDuringWait();
        defer self.disableSignalsDuringWait();
        vm.waitForPromise(.{ .normal = promise });
        if (vm.jsc_vm.executionForbidden()) {
            vm.jsc_vm.setExecutionForbidden(false);
            global.clearTerminationException();
            self.print("\n", .{});
            return;
        }
        switch (promise.status()) {
            .fulfilled => resolved_result = promise.result(vm.jsc_vm),
            .rejected => {
                const rejection = promise.result(vm.jsc_vm);
                self.setLastError(rejection);
                self.printJSError(rejection);
                return;
            },
            .pending => return,
        }
    }

    var actual_result = resolved_result;
    if (resolved_result.isObject()) {
        const maybe_value = resolved_result.getOwn(global, "value") catch |err| {
            const exc = global.takeException(err);
            self.setLastError(exc);
            self.printJSError(exc);
            vm.tick();
            return;
        };
        if (maybe_value) |value| {
            actual_result = value;
        }
    }

    self.setLastResult(actual_result);
    if (!actual_result.isUndefined()) {
        const global_this = global.toJSValue();
        global_this.put(global, "_", actual_result);
    }

    self.copyValueToClipboard(actual_result) catch |err| {
        const exc = global.takeException(err);
        self.setLastError(exc);
        self.printJSError(exc);
    };
    vm.tick();
}

/// Format a JS value as a string suitable for clipboard.
/// Returns null on allocator OOM; propagates JS exceptions (e.g. throwing getters).
fn valueToClipboardString(self: *Repl, value: jsc.JSValue) bun.JSError!?[]const u8 {
    const global = self.global orelse return null;

    if (value.isUndefined()) return self.allocator.dupe(u8, "undefined") catch null;
    if (value.isNull()) return self.allocator.dupe(u8, "null") catch null;

    // For strings, copy the raw string value (not quoted/JSON-ified)
    if (value.isString()) {
        const slice = try value.toSlice(global, self.allocator);
        defer slice.deinit();
        return self.allocator.dupe(u8, slice.slice()) catch null;
    }

    // For everything else, use Bun.inspect without colors
    var array = std.Io.Writer.Allocating.init(self.allocator);
    defer array.deinit();
    try jsc.ConsoleObject.format2(.Log, global, @ptrCast(&value), 1, &array.writer, .{
        .enable_colors = false,
        .add_newline = false,
        .flush = false,
        .quote_strings = true,
        .ordered_properties = false,
        .max_depth = 4,
    });
    array.writer.flush() catch return null;
    return self.allocator.dupe(u8, array.written()) catch null;
}

/// Copy a JS value to the system clipboard via OSC 52.
/// Propagates JS exceptions from value formatting; swallows I/O errors.
fn copyValueToClipboard(self: *Repl, value: jsc.JSValue) bun.JSError!void {
    const text = (try self.valueToClipboardString(value)) orelse {
        self.printError("Failed to format value for clipboard\n", .{});
        return;
    };
    defer self.allocator.free(text);

    self.copyToClipboardOSC52(text) catch {
        self.printError("Failed to write to clipboard\n", .{});
        return;
    };
    if (self.use_colors) {
        self.print("{s}Copied {d} characters to clipboard{s}\n", .{ Color.dim, text.len, Color.reset });
    } else {
        self.print("Copied {d} characters to clipboard\n", .{text.len});
    }
}

/// Write text to clipboard using OSC 52 escape sequence.
fn copyToClipboardOSC52(self: *Repl, text: []const u8) !void {
    var it = strings.ANSIIterator.init(text);
    const first = it.next() orelse return;

    if (first.len == text.len) {
        // No ANSI sequences - encode the original directly
        var encoded = try bun.base64.encodeAlloc(self.allocator, text);
        defer encoded.deinit(self.allocator);
        self.write("\x1b]52;c;");
        self.write(encoded.slice());
        self.write("\x07");
    } else {
        // Has ANSI sequences - collect clean slices then encode
        var clean = ArrayList(u8).init(self.allocator);
        defer clean.deinit();
        try clean.ensureTotalCapacity(text.len);
        clean.appendSliceAssumeCapacity(first);
        while (it.next()) |slice| {
            clean.appendSliceAssumeCapacity(slice);
        }
        var encoded = try bun.base64.encodeAlloc(self.allocator, clean.items);
        defer encoded.deinit(self.allocator);
        self.write("\x1b]52;c;");
        self.write(encoded.slice());
        self.write("\x07");
    }
}

/// Transform code using the REPL parser (hoists declarations, wraps expressions)
fn transformForRepl(self: *Repl, code: []const u8) ?[]const u8 {
    const vm = self.vm orelse return null;

    // Skip empty code
    if (code.len == 0 or strings.trim(code, " \t\n\r").len == 0) {
        return null;
    }

    // Check if code looks like an object literal that would be misinterpreted as a block
    // If code starts with { (after whitespace) and doesn't end with ;
    const is_object_literal = isLikelyObjectLiteral(code);
    const processed_code = if (is_object_literal)
        std.fmt.allocPrint(self.allocator, "({s})", .{code}) catch return null
    else
        code;
    defer if (is_object_literal) self.allocator.free(processed_code);

    // Create arena for parsing
    var arena = MimallocArena.init();
    defer arena.deinit();
    const allocator = arena.allocator();

    // Set up parser options with repl_mode enabled
    var opts = js_parser.Parser.Options.init(vm.transpiler.options.jsx, .tsx);
    opts.repl_mode = true;
    opts.features.dead_code_elimination = false; // REPL needs all code
    opts.features.top_level_await = true; // Enable top-level await in REPL

    // Initialize macro context from transpiler (required for import processing)
    if (vm.transpiler.macro_context == null) {
        vm.transpiler.macro_context = bun.ast.Macro.MacroContext.init(&vm.transpiler);
    }
    opts.macro_context = &vm.transpiler.macro_context.?;

    // Create log for errors
    var log = logger.Log.init(arena.backingAllocator());
    defer log.deinit();

    // Create source
    const source = logger.Source.initPathString("[repl]", processed_code);

    // Parse with REPL transforms
    var parser = js_parser.Parser.init(
        opts,
        &log,
        &source,
        vm.transpiler.options.define,
        allocator,
    ) catch return null;

    const parse_result = parser.parse() catch return null;
    if (parse_result != .ast) return null;
    const ast = parse_result.ast;
    // Don't call ast.deinit() - the arena handles cleanup

    // Check for parse errors
    if (log.errors > 0) return null;
    // Print the transformed AST back to JavaScript
    const buffer_writer = js_printer.BufferWriter.init(self.allocator);
    var buffer_printer = js_printer.BufferPrinter.init(buffer_writer);
    defer buffer_printer.ctx.buffer.deinit();

    // Create symbol map from ast.symbols
    const symbols_nested = bun.ast.Symbol.NestedList.fromBorrowedSliceDangerous(&.{ast.symbols});
    const symbols_map = bun.ast.Symbol.Map.initList(symbols_nested);

    _ = js_printer.printAst(
        @TypeOf(&buffer_printer),
        &buffer_printer,
        ast,
        symbols_map,
        &source,
        true, // ascii_only
        .{ .mangled_props = null },
        false, // generate_source_map
    ) catch return null;

    // Get the written buffer
    const written = buffer_printer.ctx.getWritten();
    return self.allocator.dupe(u8, written) catch null;
}

/// Check if code looks like an object literal that would be misinterpreted as a block
fn isLikelyObjectLiteral(code: []const u8) bool {
    // Skip leading whitespace
    var start: usize = 0;
    while (start < code.len and (code[start] == ' ' or code[start] == '\t' or code[start] == '\n' or code[start] == '\r')) {
        start += 1;
    }

    // Check if starts with {
    if (start >= code.len or code[start] != '{') {
        return false;
    }

    // Skip trailing whitespace
    var end: usize = code.len;
    while (end > 0 and (code[end - 1] == ' ' or code[end - 1] == '\t' or code[end - 1] == '\n' or code[end - 1] == '\r')) {
        end -= 1;
    }

    // Check if ends with semicolon - if so, it's likely a block statement
    if (end > 0 and code[end - 1] == ';') {
        return false;
    }

    return true;
}

fn setReplVariables(self: *Repl) void {
    // For now, we rely on the C++ evaluation to handle this
    // The C++ code sets _ and _error after each evaluation
    _ = self;
}

fn printJSError(self: *Repl, error_value: jsc.JSValue) void {
    // Interactive REPL writes everything to stdout (single terminal stream).
    self.printJSErrorTo(error_value, Output.writer(), self.use_colors);
}

fn printJSErrorTo(self: *Repl, error_value: jsc.JSValue, writer: *std.Io.Writer, enable_colors: bool) void {
    const global = self.global orelse return;
    // Use .Error level for proper error formatting with Bun.inspect
    jsc.ConsoleObject.format2(.Error, global, @ptrCast(&error_value), 1, writer, .{
        .enable_colors = enable_colors,
        .add_newline = true,
        .flush = false,
        .quote_strings = true,
        .ordered_properties = false,
        .max_depth = 4,
    }) catch {
        // Formatting the error itself threw — clear it to avoid recursion and show a fallback.
        global.clearException();
        writer.writeAll("error: [failed to format error]\n") catch {};
    };
}

/// Format and print a JS value using Bun's console formatter (same as console.log)
fn printFormattedValue(self: *Repl, value: jsc.JSValue) void {
    const global = self.global orelse return;
    const writer = Output.writer();
    jsc.ConsoleObject.format2(.Log, global, @ptrCast(&value), 1, writer, .{
        .enable_colors = self.use_colors,
        .add_newline = true,
        .flush = false,
        .quote_strings = true,
        .ordered_properties = false,
        .max_depth = 4,
    }) catch |err| {
        // A getter on the value threw during inspection — show that error.
        const exc = global.takeException(err);
        self.setLastError(exc);
        self.printJSError(exc);
    };
}

// ============================================================================
// Main Loop
// ============================================================================

pub fn run(self: *Repl) !void {
    try self.runWithVM(null);
}

pub fn runWithVM(self: *Repl, vm: ?*jsc.VirtualMachine) !void {
    self.vm = vm;
    if (vm) |v| {
        self.global = v.global;
    }

    self.setupTerminal();
    defer self.restoreTerminal();

    try self.history.load();

    // Print welcome message
    self.print("Welcome to Bun v{s}\n", .{VERSION});
    self.print("Type {s}.copy [code]{s} to copy to clipboard. {s}.help{s} for more info.\n\n", .{ Color.cyan, Color.reset, Color.cyan, Color.reset });

    self.running = true;
    self.refreshLine();

    while (self.running) {
        const key = self.readKey() orelse {
            // EOF
            self.print("\n", .{});
            break;
        };

        // Reset double-Ctrl+C state on any other key
        if (key != .ctrl_c) self.ctrl_c_pressed = false;

        switch (key) {
            .enter => try self.handleEnter(),
            .ctrl_c => self.handleCtrlC(),
            .ctrl_d => {
                if (self.editor_mode) {
                    // Finish editor mode
                    self.print("\n", .{});
                    const code = self.editor_buffer.items;
                    if (code.len > 0) {
                        self.evaluateAndPrint(code);
                    }
                    self.editor_mode = false;
                    self.editor_buffer.clearRetainingCapacity();
                    self.refreshLine();
                } else if (self.line_editor.buffer.items.len == 0 and !self.in_multiline) {
                    self.print("\n", .{});
                    self.running = false;
                } else {
                    self.line_editor.deleteChar();
                    self.refreshLine();
                }
            },
            .ctrl_l => {
                self.write(Cursor.clear_screen);
                self.write(Cursor.home);
                self.refreshLine();
            },
            .ctrl_a => {
                self.line_editor.moveToStart();
                self.refreshLine();
            },
            .ctrl_e => {
                self.line_editor.moveToEnd();
                self.refreshLine();
            },
            .ctrl_b, .arrow_left => {
                self.line_editor.moveLeft();
                self.refreshLine();
            },
            .ctrl_f, .arrow_right => {
                self.line_editor.moveRight();
                self.refreshLine();
            },
            .alt_b, .alt_left => {
                self.line_editor.moveWordLeft();
                self.refreshLine();
            },
            .alt_f, .alt_right => {
                self.line_editor.moveWordRight();
                self.refreshLine();
            },
            .ctrl_u => {
                self.line_editor.deleteToStart();
                self.refreshLine();
            },
            .ctrl_k => {
                self.line_editor.deleteToEnd();
                self.refreshLine();
            },
            .ctrl_w, .alt_backspace => {
                self.line_editor.backspaceWord();
                self.refreshLine();
            },
            .alt_d => {
                self.line_editor.deleteWord();
                self.refreshLine();
            },
            .ctrl_t => {
                self.line_editor.swap();
                self.refreshLine();
            },
            .backspace => {
                self.line_editor.backspace();
                self.refreshLine();
            },
            .delete => {
                self.line_editor.deleteChar();
                self.refreshLine();
            },
            .arrow_up, .ctrl_p => {
                if (self.history.prev(self.line_editor.getLine())) |prev_line| {
                    self.line_editor.set(prev_line) catch {};
                    self.refreshLine();
                }
            },
            .arrow_down, .ctrl_n => {
                if (self.history.next()) |next_line| {
                    self.line_editor.set(next_line) catch {};
                } else {
                    self.line_editor.clear();
                }
                self.refreshLine();
            },
            .tab => self.handleTab(),
            .home => {
                self.line_editor.moveToStart();
                self.refreshLine();
            },
            .end => {
                self.line_editor.moveToEnd();
                self.refreshLine();
            },
            .char => |c| {
                self.line_editor.insert(c) catch {};
                self.refreshLine();
            },
            else => {},
        }
    }

    self.history.save();
}

fn handleEnter(self: *Repl) !void {
    self.print("\n", .{});

    const line = self.line_editor.getLine();

    if (self.editor_mode) {
        if (strings.trim(line, " \t").len == 0) {
            try self.editor_buffer.appendSlice("\n");
        } else {
            try self.editor_buffer.appendSlice(line);
            try self.editor_buffer.append('\n');
        }
        self.line_editor.clear();
        self.refreshLine();
        return;
    }

    // Check for REPL commands
    if (line.len > 0 and line[0] == '.') {
        const space_idx = strings.indexOfChar(line, ' ');
        const cmd_name = if (space_idx) |idx| line[0..idx] else line;
        const args = if (space_idx) |idx| line[idx + 1 ..] else "";

        if (ReplCommand.find(cmd_name)) |cmd| {
            const result = cmd.handler(self, args);
            switch (result) {
                .exit_repl => {
                    self.running = false;
                    return;
                },
                .skip_eval => {
                    self.line_editor.clear();
                    self.history.resetPosition();
                    self.refreshLine();
                    return;
                },
                .continue_repl => {},
            }
        } else {
            self.printError("Unknown command: {s}\n", .{cmd_name});
            self.print("Type {s}.help{s} for available commands\n", .{ Color.cyan, Color.reset });
            self.line_editor.clear();
            self.refreshLine();
            return;
        }
    }

    // Handle empty line
    if (line.len == 0 and !self.in_multiline) {
        self.refreshLine();
        return;
    }

    // Check for multi-line input
    const full_code = if (self.in_multiline) blk: {
        try self.multiline_buffer.appendSlice(line);
        try self.multiline_buffer.append('\n');
        break :blk self.multiline_buffer.items;
    } else line;

    if (isIncompleteCode(full_code)) {
        if (!self.in_multiline) {
            self.in_multiline = true;
            try self.multiline_buffer.appendSlice(line);
            try self.multiline_buffer.append('\n');
        }
        self.line_editor.clear();
        self.refreshLine();
        return;
    }

    // Complete code - evaluate it
    const code_to_eval = if (self.in_multiline)
        self.allocator.dupe(u8, self.multiline_buffer.items) catch unreachable
    else
        self.allocator.dupe(u8, line) catch unreachable;
    defer self.allocator.free(code_to_eval);

    try self.history.add(strings.trim(code_to_eval, "\n"));

    self.evaluateAndPrint(code_to_eval);

    // Reset state
    self.line_editor.clear();
    self.multiline_buffer.clearRetainingCapacity();
    self.in_multiline = false;
    self.history.resetPosition();
    self.refreshLine();
}

fn handleCtrlC(self: *Repl) void {
    if (self.editor_mode) {
        self.print("\n{s}// Editor mode cancelled{s}\n", .{ Color.dim, Color.reset });
        self.editor_mode = false;
        self.editor_buffer.clearRetainingCapacity();
    } else if (self.in_multiline) {
        self.print("\n", .{});
        self.in_multiline = false;
        self.multiline_buffer.clearRetainingCapacity();
    } else if (self.line_editor.buffer.items.len > 0) {
        self.print("^C\n", .{});
        self.line_editor.clear();
    } else if (self.ctrl_c_pressed) {
        // Second Ctrl+C on empty line - exit
        self.print("\n", .{});
        self.running = false;
        return;
    } else {
        self.ctrl_c_pressed = true;
        self.print("\n{s}(press Ctrl+C again to exit, or Ctrl+D){s}\n", .{ Color.dim, Color.reset });
    }
    self.history.resetPosition();
    self.refreshLine();
}

fn handleTab(self: *Repl) void {
    const line = self.line_editor.getLine();

    // Complete REPL commands
    if (line.len > 0 and line[0] == '.') {
        var matches = ArrayList([]const u8).init(self.allocator);
        defer matches.deinit();

        for (ReplCommand.all) |cmd| {
            if (strings.startsWith(cmd.name, line)) {
                matches.append(cmd.name) catch continue;
            }
        }

        if (matches.items.len == 1) {
            self.line_editor.set(matches.items[0]) catch {};
            self.line_editor.insert(' ') catch {};
            self.refreshLine();
        } else if (matches.items.len > 1) {
            self.print("\n", .{});
            for (matches.items) |match| {
                self.print("  {s}{s}{s}\n", .{ Color.cyan, match, Color.reset });
            }
            self.refreshLine();
        }
        return;
    }

    // Property completion using JSC
    const global = self.global orelse {
        // No VM, just insert spaces
        self.line_editor.insert(' ') catch {};
        self.line_editor.insert(' ') catch {};
        self.refreshLine();
        return;
    };

    // Find the word being completed
    var word_start: usize = line.len;
    while (word_start > 0) {
        const c = line[word_start - 1];
        if (!std.ascii.isAlphanumeric(c) and c != '_' and c != '$') break;
        word_start -= 1;
    }

    const prefix = line[word_start..];

    // Get completions from global object
    const completions = Bun__REPL__getCompletions(
        global,
        .js_undefined,
        prefix.ptr,
        prefix.len,
    );

    if (completions.isUndefined() or !completions.isArray()) {
        self.line_editor.insert(' ') catch {};
        self.line_editor.insert(' ') catch {};
        self.refreshLine();
        return;
    }

    // Get array length
    const len = completions.getLength(global) catch brk: {
        global.clearException();
        break :brk 0;
    };
    if (len == 0) {
        self.line_editor.insert(' ') catch {};
        self.line_editor.insert(' ') catch {};
        self.refreshLine();
        return;
    }

    if (len == 1) {
        // Single completion - insert it
        const item = completions.getIndex(global, 0) catch brk: {
            global.clearException();
            break :brk .js_undefined;
        };
        if (item.isString()) {
            const slice = item.toSlice(global, self.allocator) catch {
                global.clearException();
                return;
            };
            defer slice.deinit();
            const completion = slice.slice();
            // Replace the prefix with the completion
            while (self.line_editor.cursor > word_start) {
                self.line_editor.backspace();
            }
            self.line_editor.insertSlice(completion) catch {};
            self.refreshLine();
        }
    } else if (len <= 50) {
        // Multiple completions - show them
        self.print("\n", .{});
        var i: u32 = 0;
        while (i < @as(u32, @truncate(len))) : (i += 1) {
            const item = completions.getIndex(global, i) catch brk: {
                global.clearException();
                break :brk .js_undefined;
            };
            if (item.isString()) {
                const slice = item.toSlice(global, self.allocator) catch {
                    global.clearException();
                    continue;
                };
                defer slice.deinit();
                self.print("  {s}{s}{s}\n", .{ Color.cyan, slice.slice(), Color.reset });
            }
        }
        self.refreshLine();
    } else {
        self.print("\n{s}{d} completions{s}\n", .{ Color.dim, len, Color.reset });
        self.refreshLine();
    }
}

// ============================================================================
// Public Entry Point (for CLI integration)
// ============================================================================

pub fn exec(ctx: bun.cli.Command.Context) !void {
    var repl = Repl.init(ctx.allocator);
    defer repl.deinit();

    try repl.run();
}

const std = @import("std");
const Allocator = std.mem.Allocator;
const ArrayList = std.array_list.Managed;

const bun = @import("bun");
const Output = bun.Output;
const fmt = bun.fmt;
const js_parser = bun.js_parser;
const js_printer = bun.js_printer;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const MimallocArena = bun.allocators.MimallocArena;

const Environment = bun.Environment;
const VERSION = Environment.version_string;
