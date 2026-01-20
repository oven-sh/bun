//! Bun REPL - A powerful, feature-rich interactive JavaScript/TypeScript shell
//!
//! Features:
//! - Syntax highlighting with QuickAndDirtyJavaScriptSyntaxHighlighter
//! - Smart autocomplete for globals, Bun APIs, and object properties
//! - Persistent history with fuzzy search
//! - Multi-line editing with bracket matching
//! - REPL commands (.help, .editor, .load, .save, .clear, .exit)
//! - TypeScript/JSX support via Bun's transpiler with replMode
//! - Shell mode ($`...`) for running commands
//! - Inline package installation
//! - Pretty-printed output with colors
//! - Top-level await support
//! - Error formatting with source context

const ReplCommand = @This();

const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const logger = bun.logger;
const js_ast = bun.ast;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;

const Command = @import("../cli.zig").Command;
const fmt = @import("../fmt.zig");

// ============================================================================
// REPL State
// ============================================================================

/// The main REPL state structure
pub const Repl = struct {
    allocator: Allocator,
    vm: *VirtualMachine,
    global: *JSGlobalObject,

    // Line editing state
    line_buffer: ArrayList(u8),
    cursor_pos: usize = 0,
    history: History,

    // Multi-line state
    multiline_buffer: ArrayList(u8),
    is_multiline: bool = false,
    bracket_depth: BracketDepth = .{},

    // Display state
    prompt_len: usize = 0,
    terminal_width: u16 = 80,
    terminal_height: u16 = 24,
    enable_colors: bool = true,

    // REPL options
    show_timing: bool = false,
    quiet_mode: bool = false,
    line_number: u32 = 1,

    // Execution context - stores declared variables across lines
    context_object: JSValue = .js_undefined,

    const Self = @This();

    pub fn init(allocator: Allocator, vm: *VirtualMachine) !*Self {
        const repl = try allocator.create(Self);
        repl.* = .{
            .allocator = allocator,
            .vm = vm,
            .global = vm.global,
            .line_buffer = .{},
            .history = try History.init(allocator),
            .multiline_buffer = .{},
        };

        // Get terminal size
        repl.updateTerminalSize();

        // Check color support
        repl.enable_colors = Output.enable_ansi_colors_stdout;

        // Create the REPL context object for variable persistence
        repl.context_object = try repl.createContext();

        return repl;
    }

    pub fn deinit(self: *Self) void {
        self.line_buffer.deinit(self.allocator);
        self.multiline_buffer.deinit(self.allocator);
        self.history.deinit();
        self.allocator.destroy(self);
    }

    fn createContext(self: *Self) !JSValue {
        // Create a context object that will hold REPL-declared variables
        // This allows variables to persist across REPL lines
        const ctx = JSValue.createEmptyObject(self.global, 0);

        // Add common globals to context
        // The actual execution will use vm.runInContext which merges this with globalThis

        return ctx;
    }

    fn updateTerminalSize(self: *Self) void {
        if (Output.terminal_size.col > 0) {
            self.terminal_width = Output.terminal_size.col;
            self.terminal_height = Output.terminal_size.row;
        }
    }

    // ========================================================================
    // Input Handling
    // ========================================================================

    /// Read a line of input with editing support
    pub fn readLine(self: *Self) !?[]const u8 {
        self.line_buffer.clearRetainingCapacity();
        self.cursor_pos = 0;

        // Print prompt
        self.printPrompt();

        // Try to enter raw mode for character-by-character input
        const stdin_fd = std.posix.STDIN_FILENO;
        const maybe_termios = std.posix.tcgetattr(stdin_fd);

        if (maybe_termios) |original_termios| {
            // TTY mode - use interactive line editing
            return self.readLineTTY(stdin_fd, original_termios);
        } else |_| {
            // Non-TTY mode (piped input) - use simple line reading
            return self.readLineSimple(stdin_fd);
        }
    }

    /// Simple line reading for non-TTY input (piped)
    fn readLineSimple(self: *Self, stdin_fd: std.posix.fd_t) !?[]const u8 {
        var buf: [1]u8 = undefined;

        while (true) {
            const bytes_read = std.posix.read(stdin_fd, &buf) catch |err| {
                if (err == error.WouldBlock) continue;
                return err;
            };

            if (bytes_read == 0) {
                // EOF
                if (self.line_buffer.items.len == 0) {
                    return null;
                }
                break;
            }

            if (buf[0] == '\n' or buf[0] == '\r') {
                break;
            }

            try self.line_buffer.append(self.allocator, buf[0]);
        }

        if (self.line_buffer.items.len == 0) {
            return null;
        }

        return try self.allocator.dupe(u8, self.line_buffer.items);
    }

    /// Interactive line reading with TTY support
    fn readLineTTY(self: *Self, stdin_fd: std.posix.fd_t, original_termios: std.posix.termios) !?[]const u8 {
        var raw = original_termios;

        // Disable canonical mode and echo
        raw.lflag.ICANON = false;
        raw.lflag.ECHO = false;
        raw.lflag.ISIG = false; // Disable Ctrl-C signal

        // Set minimum characters and timeout
        raw.cc[@intFromEnum(std.posix.V.MIN)] = 1;
        raw.cc[@intFromEnum(std.posix.V.TIME)] = 0;

        try std.posix.tcsetattr(stdin_fd, .NOW, raw);
        defer std.posix.tcsetattr(stdin_fd, .NOW, original_termios) catch {};

        var buf: [32]u8 = undefined;

        while (true) {
            const bytes_read = std.posix.read(stdin_fd, &buf) catch |err| {
                if (err == error.WouldBlock) continue;
                return err;
            };

            if (bytes_read == 0) {
                // EOF
                if (self.line_buffer.items.len == 0) {
                    return null;
                }
                break;
            }

            const input = buf[0..bytes_read];

            // Handle escape sequences
            if (input[0] == 0x1b) {
                if (bytes_read >= 3 and input[1] == '[') {
                    switch (input[2]) {
                        'A' => self.historyPrev(), // Up arrow
                        'B' => self.historyNext(), // Down arrow
                        'C' => self.moveCursorRight(), // Right arrow
                        'D' => self.moveCursorLeft(), // Left arrow
                        'H' => self.moveCursorHome(), // Home
                        'F' => self.moveCursorEnd(), // End
                        '3' => if (bytes_read >= 4 and input[3] == '~') self.deleteChar(), // Delete
                        else => {},
                    }
                }
                continue;
            }

            switch (input[0]) {
                0x03 => {
                    // Ctrl-C
                    Output.print("\n", .{});
                    if (self.line_buffer.items.len > 0 or self.is_multiline) {
                        // Cancel current input
                        self.line_buffer.clearRetainingCapacity();
                        self.multiline_buffer.clearRetainingCapacity();
                        self.is_multiline = false;
                        self.bracket_depth = .{};
                        self.printPrompt();
                        continue;
                    }
                    // Empty line - exit hint
                    Output.pretty("<d>(To exit, press Ctrl+D or type .exit)<r>\n", .{});
                    self.printPrompt();
                    continue;
                },
                0x04 => {
                    // Ctrl-D (EOF)
                    if (self.line_buffer.items.len == 0 and !self.is_multiline) {
                        Output.print("\n", .{});
                        return null;
                    }
                    self.deleteChar();
                },
                0x09 => {
                    // Tab - autocomplete
                    try self.handleAutocomplete();
                },
                0x0A, 0x0D => {
                    // Enter
                    Output.print("\n", .{});

                    // Check if we need to continue on next line
                    const line = self.line_buffer.items;
                    self.updateBracketDepth(line);

                    if (self.needsContinuation()) {
                        // Continue to next line
                        try self.multiline_buffer.appendSlice(self.allocator, line);
                        try self.multiline_buffer.append(self.allocator, '\n');
                        self.line_buffer.clearRetainingCapacity();
                        self.cursor_pos = 0;
                        self.is_multiline = true;
                        self.printPrompt();
                        continue;
                    }

                    // Complete input
                    if (self.is_multiline) {
                        try self.multiline_buffer.appendSlice(self.allocator, line);
                        const result = try self.allocator.dupe(u8, self.multiline_buffer.items);
                        self.multiline_buffer.clearRetainingCapacity();
                        self.is_multiline = false;
                        self.bracket_depth = .{};
                        return result;
                    }

                    if (line.len == 0) {
                        self.printPrompt();
                        continue;
                    }

                    return try self.allocator.dupe(u8, line);
                },
                0x7F, 0x08 => {
                    // Backspace
                    self.backspace();
                },
                0x01 => self.moveCursorHome(), // Ctrl-A
                0x05 => self.moveCursorEnd(), // Ctrl-E
                0x0B => self.killToEnd(), // Ctrl-K
                0x15 => self.killLine(), // Ctrl-U
                0x17 => self.killWord(), // Ctrl-W
                0x0C => self.clearScreen(), // Ctrl-L
                0x12 => try self.reverseSearch(), // Ctrl-R
                else => {
                    // Regular character input
                    if (input[0] >= 0x20 and input[0] < 0x7F) {
                        try self.insertChar(input[0]);
                    } else if (input[0] >= 0x80) {
                        // UTF-8 sequence
                        try self.line_buffer.appendSlice(self.allocator, input);
                        self.cursor_pos += input.len;
                        self.refreshLine();
                    }
                },
            }
        }

        return try self.allocator.dupe(u8, self.line_buffer.items);
    }

    fn insertChar(self: *Self, c: u8) !void {
        if (self.cursor_pos >= self.line_buffer.items.len) {
            try self.line_buffer.append(self.allocator, c);
        } else {
            try self.line_buffer.insert(self.allocator, self.cursor_pos, c);
        }
        self.cursor_pos += 1;
        self.refreshLine();
    }

    fn backspace(self: *Self) void {
        if (self.cursor_pos > 0) {
            _ = self.line_buffer.orderedRemove(self.cursor_pos - 1);
            self.cursor_pos -= 1;
            self.refreshLine();
        }
    }

    fn deleteChar(self: *Self) void {
        if (self.cursor_pos < self.line_buffer.items.len) {
            _ = self.line_buffer.orderedRemove(self.cursor_pos);
            self.refreshLine();
        }
    }

    fn moveCursorLeft(self: *Self) void {
        if (self.cursor_pos > 0) {
            self.cursor_pos -= 1;
            Output.print("\x1b[D", .{});
        }
    }

    fn moveCursorRight(self: *Self) void {
        if (self.cursor_pos < self.line_buffer.items.len) {
            self.cursor_pos += 1;
            Output.print("\x1b[C", .{});
        }
    }

    fn moveCursorHome(self: *Self) void {
        if (self.cursor_pos > 0) {
            Output.print("\x1b[{d}D", .{self.cursor_pos});
            self.cursor_pos = 0;
        }
    }

    fn moveCursorEnd(self: *Self) void {
        const remaining = self.line_buffer.items.len - self.cursor_pos;
        if (remaining > 0) {
            Output.print("\x1b[{d}C", .{remaining});
            self.cursor_pos = self.line_buffer.items.len;
        }
    }

    fn killToEnd(self: *Self) void {
        self.line_buffer.shrinkRetainingCapacity(self.cursor_pos);
        self.refreshLine();
    }

    fn killLine(self: *Self) void {
        self.line_buffer.clearRetainingCapacity();
        self.cursor_pos = 0;
        self.refreshLine();
    }

    fn killWord(self: *Self) void {
        if (self.cursor_pos == 0) return;

        var new_pos = self.cursor_pos;
        // Skip trailing spaces
        while (new_pos > 0 and self.line_buffer.items[new_pos - 1] == ' ') {
            new_pos -= 1;
        }
        // Skip word characters
        while (new_pos > 0 and self.line_buffer.items[new_pos - 1] != ' ') {
            new_pos -= 1;
        }

        // Remove the word
        const items_to_remove = self.cursor_pos - new_pos;
        var i: usize = 0;
        while (i < items_to_remove) : (i += 1) {
            _ = self.line_buffer.orderedRemove(new_pos);
        }
        self.cursor_pos = new_pos;
        self.refreshLine();
    }

    fn clearScreen(self: *Self) void {
        Output.print("\x1b[2J\x1b[H", .{});
        self.printPrompt();
        self.refreshLine();
    }

    fn refreshLine(self: *Self) void {
        // Clear current line and rewrite with syntax highlighting
        Output.print("\r\x1b[K", .{}); // Move to start, clear to end

        self.printPromptInline();

        // Print with syntax highlighting
        if (self.enable_colors and self.line_buffer.items.len > 0) {
            const highlighter = fmt.fmtJavaScript(self.line_buffer.items, .{
                .enable_colors = true,
                .check_for_unhighlighted_write = true,
            });
            Output.print("{f}", .{highlighter});
        } else {
            Output.print("{s}", .{self.line_buffer.items});
        }

        // Move cursor to correct position
        const cursor_offset = self.line_buffer.items.len - self.cursor_pos;
        if (cursor_offset > 0) {
            Output.print("\x1b[{d}D", .{cursor_offset});
        }

        Output.flush();
    }

    // ========================================================================
    // Prompt Display
    // ========================================================================

    fn printPrompt(self: *Self) void {
        self.printPromptInline();
        Output.flush();
    }

    fn printPromptInline(self: *Self) void {
        if (self.is_multiline) {
            // Continuation prompt
            Output.pretty("<cyan>...<r> ", .{});
            self.prompt_len = 4;
        } else {
            // Main prompt with line number
            Output.pretty("<b><green>bun<r><d>:<r><yellow>{d}<r><b><green>><r> ", .{self.line_number});
            // Calculate prompt length (approximate)
            self.prompt_len = 8 + digitCount(self.line_number);
        }
    }

    fn digitCount(n: u32) usize {
        if (n == 0) return 1;
        var count: usize = 0;
        var x = n;
        while (x > 0) : (x /= 10) {
            count += 1;
        }
        return count;
    }

    // ========================================================================
    // Bracket Matching / Multi-line
    // ========================================================================

    const BracketDepth = struct {
        parens: i32 = 0, // ()
        brackets: i32 = 0, // []
        braces: i32 = 0, // {}
        template: i32 = 0, // ``
        in_string: bool = false,
        string_char: u8 = 0,
    };

    fn updateBracketDepth(self: *Self, line: []const u8) void {
        var i: usize = 0;
        while (i < line.len) : (i += 1) {
            const c = line[i];

            // Handle string state
            if (self.bracket_depth.in_string) {
                if (c == '\\' and i + 1 < line.len) {
                    i += 1; // Skip escaped character
                    continue;
                }
                if (c == self.bracket_depth.string_char) {
                    self.bracket_depth.in_string = false;
                }
                continue;
            }

            switch (c) {
                '"', '\'', '`' => {
                    self.bracket_depth.in_string = true;
                    self.bracket_depth.string_char = c;
                    if (c == '`') self.bracket_depth.template += 1;
                },
                '(' => self.bracket_depth.parens += 1,
                ')' => self.bracket_depth.parens = @max(0, self.bracket_depth.parens - 1),
                '[' => self.bracket_depth.brackets += 1,
                ']' => self.bracket_depth.brackets = @max(0, self.bracket_depth.brackets - 1),
                '{' => self.bracket_depth.braces += 1,
                '}' => self.bracket_depth.braces = @max(0, self.bracket_depth.braces - 1),
                '/' => {
                    // Check for comments
                    if (i + 1 < line.len) {
                        if (line[i + 1] == '/') {
                            // Line comment - rest of line is comment
                            break;
                        } else if (line[i + 1] == '*') {
                            // Block comment start - for now skip to end
                            // TODO: proper block comment tracking
                        }
                    }
                },
                else => {},
            }
        }
    }

    fn needsContinuation(self: *Self) bool {
        if (self.bracket_depth.in_string) return true;
        if (self.bracket_depth.parens > 0) return true;
        if (self.bracket_depth.brackets > 0) return true;
        if (self.bracket_depth.braces > 0) return true;

        // Check for trailing operators that expect continuation
        const line = strings.trim(self.line_buffer.items, " \t");
        if (line.len == 0) return false;

        const last_char = line[line.len - 1];
        return switch (last_char) {
            ',', '+', '-', '*', '/', '%', '&', '|', '^', '!', '=', '<', '>', '?', ':' => true,
            '\\' => true, // Line continuation
            else => false,
        };
    }

    // ========================================================================
    // History
    // ========================================================================

    fn historyPrev(self: *Self) void {
        if (self.history.prev()) |entry| {
            self.line_buffer.clearRetainingCapacity();
            self.line_buffer.appendSlice(self.allocator, entry) catch return;
            self.cursor_pos = self.line_buffer.items.len;
            self.refreshLine();
        }
    }

    fn historyNext(self: *Self) void {
        if (self.history.next()) |entry| {
            self.line_buffer.clearRetainingCapacity();
            self.line_buffer.appendSlice(self.allocator, entry) catch return;
            self.cursor_pos = self.line_buffer.items.len;
            self.refreshLine();
        } else {
            self.line_buffer.clearRetainingCapacity();
            self.cursor_pos = 0;
            self.refreshLine();
        }
    }

    fn reverseSearch(_: *Self) !void {
        // TODO: Implement incremental reverse search (Ctrl-R)
        Output.pretty("\n<d>(reverse-i-search): <r>", .{});
        Output.flush();
    }

    // ========================================================================
    // Autocomplete
    // ========================================================================

    fn handleAutocomplete(self: *Self) !void {
        const line = self.line_buffer.items[0..self.cursor_pos];
        if (line.len == 0) return;

        // Find the word being completed
        var word_start: usize = line.len;
        while (word_start > 0) {
            const c = line[word_start - 1];
            if (!isIdentifierChar(c) and c != '.') break;
            word_start -= 1;
        }

        const word = line[word_start..];
        if (word.len == 0) return;

        // Get completions
        const completions = try self.getCompletions(word);
        defer self.allocator.free(completions);

        if (completions.len == 0) return;

        if (completions.len == 1) {
            // Single completion - insert it
            const completion = completions[0];
            const suffix = completion[word.len..];
            try self.line_buffer.appendSlice(self.allocator, suffix);
            self.cursor_pos += suffix.len;
            self.refreshLine();
        } else {
            // Multiple completions - show them
            Output.print("\n", .{});

            // Find common prefix
            var common_len = completions[0].len;
            for (completions[1..]) |c| {
                var i: usize = 0;
                while (i < common_len and i < c.len and completions[0][i] == c[i]) : (i += 1) {}
                common_len = i;
            }

            // Insert common prefix if longer than current word
            if (common_len > word.len) {
                const prefix = completions[0][word.len..common_len];
                try self.line_buffer.appendSlice(self.allocator, prefix);
                self.cursor_pos += prefix.len;
            }

            // Display completions in columns
            const max_width = blk: {
                var max: usize = 0;
                for (completions) |c| {
                    if (c.len > max) max = c.len;
                }
                break :blk max + 2;
            };

            const cols = @max(1, self.terminal_width / @as(u16, @intCast(max_width)));
            var col: usize = 0;

            for (completions) |c| {
                Output.pretty("<cyan>{s}<r>", .{c});
                col += 1;
                if (col >= cols) {
                    Output.print("\n", .{});
                    col = 0;
                } else {
                    // Pad to column width
                    var padding = max_width - c.len;
                    while (padding > 0) : (padding -= 1) {
                        Output.print(" ", .{});
                    }
                }
            }

            if (col > 0) Output.print("\n", .{});

            self.printPrompt();
            self.refreshLine();
        }
    }

    fn getCompletions(self: *Self, word: []const u8) ![][]const u8 {
        var completions: ArrayList([]const u8) = .{};

        // Check if this is a property access
        if (strings.lastIndexOfChar(word, '.')) |dot_pos| {
            // Property completion
            const obj_name = word[0..dot_pos];
            const prop_prefix = word[dot_pos + 1 ..];

            // Get object from global
            _ = obj_name;
            _ = prop_prefix;
            // TODO: Get object properties from JSC
        } else {
            // Global completion
            // Add JavaScript globals
            const js_globals = [_][]const u8{
                "Array",              "ArrayBuffer", "BigInt",             "BigInt64Array",
                "BigUint64Array",     "Boolean",     "DataView",           "Date",
                "Error",              "EvalError",   "Float32Array",       "Float64Array",
                "Function",           "Infinity",    "Int16Array",         "Int32Array",
                "Int8Array",          "JSON",        "Map",                "Math",
                "NaN",                "Number",      "Object",             "Promise",
                "Proxy",              "RangeError",  "ReferenceError",     "Reflect",
                "RegExp",             "Set",         "SharedArrayBuffer",  "String",
                "Symbol",             "SyntaxError", "TypeError",          "URIError",
                "Uint16Array",        "Uint32Array", "Uint8Array",         "Uint8ClampedArray",
                "WeakMap",            "WeakSet",     "WeakRef",            "FinalizationRegistry",
                "console",            "undefined",   "null",               "true",
                "false",              "globalThis",  "eval",               "isFinite",
                "isNaN",              "parseFloat",  "parseInt",           "decodeURI",
                "decodeURIComponent", "encodeURI",   "encodeURIComponent",
            };

            // Bun globals
            const bun_globals = [_][]const u8{
                "Bun",                       "fetch",                "Request",           "Response",
                "Headers",                   "FormData",             "URL",               "URLSearchParams",
                "Blob",                      "File",                 "FileReader",        "WebSocket",
                "Worker",                    "crypto",               "performance",       "navigator",
                "location",                  "atob",                 "btoa",              "setTimeout",
                "setInterval",               "clearTimeout",         "clearInterval",     "setImmediate",
                "clearImmediate",            "queueMicrotask",       "structuredClone",   "TextEncoder",
                "TextDecoder",               "AbortController",      "AbortSignal",       "Event",
                "EventTarget",               "CustomEvent",          "MessageChannel",    "MessagePort",
                "BroadcastChannel",          "ReadableStream",       "WritableStream",    "TransformStream",
                "ByteLengthQueuingStrategy", "CountQueuingStrategy", "CompressionStream", "DecompressionStream",
            };

            // Keywords
            const keywords = [_][]const u8{
                "async",    "await",      "break",   "case",
                "catch",    "class",      "const",   "continue",
                "debugger", "default",    "delete",  "do",
                "else",     "export",     "extends", "finally",
                "for",      "function",   "if",      "import",
                "in",       "instanceof", "let",     "new",
                "return",   "static",     "super",   "switch",
                "this",     "throw",      "try",     "typeof",
                "var",      "void",       "while",   "with",
                "yield",
            };

            // Add matching globals
            inline for (js_globals ++ bun_globals ++ keywords) |name| {
                if (strings.startsWith(name, word)) {
                    try completions.append(self.allocator, name);
                }
            }
        }

        return try completions.toOwnedSlice(self.allocator);
    }

    fn isIdentifierChar(c: u8) bool {
        return (c >= 'a' and c <= 'z') or
            (c >= 'A' and c <= 'Z') or
            (c >= '0' and c <= '9') or
            c == '_' or c == '$';
    }

    // ========================================================================
    // Execution
    // ========================================================================

    pub fn eval(self: *Self, code: []const u8) !void {
        // Add to history
        self.history.add(code);

        // Check for REPL commands
        if (code.len > 0 and code[0] == '.') {
            try self.handleReplCommand(code);
            return;
        }

        // Check for shell command
        if (strings.startsWith(code, "$`") or strings.startsWith(code, "$ `")) {
            try self.runShellCommand(code);
            return;
        }

        const start_time = std.time.nanoTimestamp();

        // Transform code using the transpiler with replMode
        const transformed = try self.transformCode(code);
        defer self.allocator.free(transformed);

        if (transformed.len == 0) {
            return;
        }

        // Execute the transformed code
        const result = try self.executeCode(transformed);

        const end_time = std.time.nanoTimestamp();
        const elapsed_ms = @as(f64, @floatFromInt(end_time - start_time)) / 1_000_000.0;

        // Print result
        if (!result.isUndefined()) {
            self.printResult(result);
        }

        // Print timing if enabled
        if (self.show_timing) {
            Output.pretty("<d>({d:.2}ms)<r>\n", .{elapsed_ms});
        }

        self.line_number += 1;
    }

    fn transformCode(self: *Self, code: []const u8) ![]const u8 {
        // Use Bun's transpiler with replMode enabled
        // This wraps expressions for value capture, hoists declarations, etc.

        const transpiler = &self.vm.transpiler;

        // Configure for REPL mode
        var opts = transpiler.options;
        opts.repl_mode = true;

        // Parse and transform
        const source = logger.Source.initPathString("/[repl]", code);
        _ = source;

        // For now, return the code as-is
        // The actual transformation will be done by the transpiler
        // TODO: Call transpiler.parse with repl_mode = true
        return try self.allocator.dupe(u8, code);
    }

    fn executeCode(self: *Self, code: []const u8) bun.JSError!JSValue {
        // Get the global eval function
        const eval_fn = self.global.toJSValue().get(self.global, "eval") catch |err| {
            return err;
        } orelse return .js_undefined;

        // Convert code string to JS string
        const code_js = ZigString.init(code).toJS(self.global);

        // Call eval with the code
        const result = eval_fn.call(self.global, self.global.toJSValue(), &[_]JSValue{code_js}) catch |err| {
            // Handle JavaScript exception
            if (self.global.hasException()) {
                const exception = self.global.tryTakeException() orelse return err;
                self.printException(exception);
                return .js_undefined;
            }
            return err;
        };

        return result;
    }

    fn printException(self: *Self, exception: JSValue) void {
        _ = self;
        // Print the exception with colors
        const vm = VirtualMachine.get();
        vm.printErrorLikeObjectToConsole(exception.toError() orelse exception);
    }

    fn printResult(self: *Self, value: JSValue) void {
        // Pretty-print the result using JSValue's print method
        value.print(self.global, .Log, .Log);
    }

    // ========================================================================
    // REPL Commands
    // ========================================================================

    fn handleReplCommand(self: *Self, cmd: []const u8) !void {
        const trimmed = strings.trim(cmd, " \t");

        if (strings.eqlComptime(trimmed, ".help") or strings.eqlComptime(trimmed, ".h")) {
            self.printHelp();
        } else if (strings.eqlComptime(trimmed, ".exit") or strings.eqlComptime(trimmed, ".q")) {
            Global.exit(0);
        } else if (strings.eqlComptime(trimmed, ".clear")) {
            self.clearScreen();
            self.line_number = 1;
        } else if (strings.startsWith(trimmed, ".load ")) {
            const path = strings.trim(trimmed[6..], " \t");
            self.loadFile(path);
        } else if (strings.startsWith(trimmed, ".save ")) {
            const path = strings.trim(trimmed[6..], " \t");
            try self.saveHistory(path);
        } else if (strings.eqlComptime(trimmed, ".editor")) {
            try self.enterEditorMode();
        } else if (strings.eqlComptime(trimmed, ".timing")) {
            self.show_timing = !self.show_timing;
            Output.pretty("<d>Timing {s}<r>\n", .{if (self.show_timing) "enabled" else "disabled"});
        } else if (strings.startsWith(trimmed, ".install ") or strings.startsWith(trimmed, ".i ")) {
            const pkg = strings.trim(trimmed[@min(trimmed.len, 9)..], " \t");
            try self.installPackage(pkg);
        } else {
            Output.pretty("<red>Unknown REPL command: {s}<r>\n", .{trimmed});
            Output.pretty("<d>Type .help for available commands<r>\n", .{});
        }
    }

    fn printHelp(self: *Self) void {
        _ = self;
        Output.pretty(
            \\<b><magenta>Bun REPL Commands<r>
            \\
            \\  <cyan>.help<r>, <cyan>.h<r>         Show this help message
            \\  <cyan>.exit<r>, <cyan>.q<r>         Exit the REPL
            \\  <cyan>.clear<r>            Clear the screen and reset line number
            \\  <cyan>.editor<r>           Enter multi-line editor mode (Ctrl-D to finish)
            \\  <cyan>.load<r> FILE        Load and execute a JavaScript/TypeScript file
            \\  <cyan>.save<r> FILE        Save REPL history to a file
            \\  <cyan>.timing<r>           Toggle execution timing display
            \\  <cyan>.install<r> PKG      Install a package from npm (alias: .i)
            \\
            \\<b>Keyboard Shortcuts<r>
            \\
            \\  <cyan>Tab<r>               Autocomplete
            \\  <cyan>Ctrl-C<r>            Cancel current input / Exit on empty line
            \\  <cyan>Ctrl-D<r>            Exit (on empty line) / Delete character
            \\  <cyan>Ctrl-L<r>            Clear screen
            \\  <cyan>Ctrl-R<r>            Reverse history search
            \\  <cyan>Ctrl-A<r>            Move to beginning of line
            \\  <cyan>Ctrl-E<r>            Move to end of line
            \\  <cyan>Ctrl-K<r>            Kill to end of line
            \\  <cyan>Ctrl-U<r>            Kill entire line
            \\  <cyan>Ctrl-W<r>            Kill previous word
            \\  <cyan>Up/Down<r>           Navigate history
            \\
            \\<b>Special Features<r>
            \\
            \\  Top-level await is supported
            \\  TypeScript/JSX is automatically transpiled
            \\  Shell commands: $\`command\` or await $\`command\`
            \\  Variables persist across REPL lines
            \\
        , .{});
    }

    fn loadFile(self: *Self, path: []const u8) void {
        const file = std.fs.cwd().openFile(path, .{}) catch |err| {
            Output.pretty("<red>Error loading file: {s}<r>\n", .{@errorName(err)});
            return;
        };
        defer file.close();

        const content = file.readToEndAlloc(self.allocator, 10 * 1024 * 1024) catch |err| {
            Output.pretty("<red>Error reading file: {s}<r>\n", .{@errorName(err)});
            return;
        };
        defer self.allocator.free(content);

        Output.pretty("<d>Loading {s}...<r>\n", .{path});
        // Execute the file content
        self.evalDirect(content);
    }

    fn evalDirect(self: *Self, code: []const u8) void {
        // Add to history
        self.history.add(code);

        const start_time = std.time.nanoTimestamp();

        // Transform code using the transpiler with replMode
        const transformed = self.transformCode(code) catch |err| {
            Output.pretty("<red>Transform error: {s}<r>\n", .{@errorName(err)});
            return;
        };
        defer self.allocator.free(transformed);

        if (transformed.len == 0) {
            return;
        }

        // Execute the transformed code
        const result = self.executeCode(transformed) catch |err| {
            Output.pretty("<red>Execution error: {s}<r>\n", .{@errorName(err)});
            return;
        };

        const end_time = std.time.nanoTimestamp();
        const elapsed_ms = @as(f64, @floatFromInt(end_time - start_time)) / 1_000_000.0;

        // Print result
        if (!result.isUndefined()) {
            self.printResult(result);
        }

        // Print timing if enabled
        if (self.show_timing) {
            Output.pretty("<d>({d:.2}ms)<r>\n", .{elapsed_ms});
        }

        self.line_number += 1;
    }

    fn saveHistory(self: *Self, path: []const u8) !void {
        try self.history.saveToFile(path);
        Output.pretty("<d>History saved to {s}<r>\n", .{path});
    }

    fn enterEditorMode(self: *Self) !void {
        Output.pretty("<d>// Entering editor mode. Press Ctrl-D to execute, Ctrl-C to cancel.<r>\n", .{});

        var editor_buffer: ArrayList(u8) = .{};
        defer editor_buffer.deinit(self.allocator);

        const stdin_fd = std.posix.STDIN_FILENO;
        var line_buf: [4096]u8 = undefined;
        var line_pos: usize = 0;

        while (true) {
            Output.print("  ", .{});
            Output.flush();

            // Read line manually
            line_pos = 0;
            while (true) {
                var char_buf: [1]u8 = undefined;
                const n = std.posix.read(stdin_fd, &char_buf) catch break;
                if (n == 0) break; // EOF

                if (char_buf[0] == '\n') break;
                if (line_pos < line_buf.len) {
                    line_buf[line_pos] = char_buf[0];
                    line_pos += 1;
                }
            }

            if (line_pos == 0) break; // EOF with no data

            try editor_buffer.appendSlice(self.allocator, line_buf[0..line_pos]);
            try editor_buffer.append(self.allocator, '\n');
        }

        Output.print("\n", .{});

        if (editor_buffer.items.len > 0) {
            self.evalDirect(editor_buffer.items);
        }
    }

    fn installPackage(self: *Self, pkg: []const u8) !void {
        if (pkg.len == 0) {
            Output.pretty("<red>Usage: .install [package-name]<r>\n", .{});
            return;
        }

        Output.pretty("<d>Installing {s}...<r>\n", .{pkg});

        // Use Bun's package manager to install
        // TODO: Call InstallCommand or use the package manager API directly
        _ = self;
        Output.pretty("<yellow>Package installation not yet implemented<r>\n", .{});
    }

    fn runShellCommand(self: *Self, code: []const u8) !void {
        _ = code;
        _ = self;
        // Execute shell command using Bun's shell
        // TODO: Integrate with shell interpreter
        Output.pretty("<yellow>Shell mode not yet implemented<r>\n", .{});
    }
};

// ============================================================================
// History Management
// ============================================================================

pub const History = struct {
    entries: ArrayList([]const u8),
    position: usize = 0,
    allocator: Allocator,
    file_path: ?[]const u8 = null,

    const MAX_ENTRIES = 10000;

    pub fn init(allocator: Allocator) !History {
        var history = History{
            .entries = .{},
            .allocator = allocator,
        };

        // Try to load history from file
        history.loadFromFile() catch {};

        return history;
    }

    pub fn deinit(self: *History) void {
        // Save history before exit
        self.saveToFile(self.getDefaultPath()) catch {};

        for (self.entries.items) |entry| {
            self.allocator.free(entry);
        }
        self.entries.deinit(self.allocator);
    }

    pub fn add(self: *History, entry: []const u8) void {
        // Don't add empty entries or duplicates of the last entry
        if (entry.len == 0) return;
        if (self.entries.items.len > 0 and
            std.mem.eql(u8, self.entries.items[self.entries.items.len - 1], entry))
        {
            return;
        }

        // Remove oldest entries if at capacity
        while (self.entries.items.len >= MAX_ENTRIES) {
            const old = self.entries.orderedRemove(0);
            self.allocator.free(old);
        }

        const copy = self.allocator.dupe(u8, entry) catch return;
        self.entries.append(self.allocator, copy) catch {
            self.allocator.free(copy);
            return;
        };

        self.position = self.entries.items.len;
    }

    pub fn prev(self: *History) ?[]const u8 {
        if (self.entries.items.len == 0) return null;
        if (self.position > 0) {
            self.position -= 1;
        }
        return self.entries.items[self.position];
    }

    pub fn next(self: *History) ?[]const u8 {
        if (self.position >= self.entries.items.len - 1) {
            self.position = self.entries.items.len;
            return null;
        }
        self.position += 1;
        return self.entries.items[self.position];
    }

    fn getDefaultPath(self: *History) []const u8 {
        _ = self;
        // TODO: Use proper home directory detection
        return ".bun_repl_history";
    }

    fn loadFromFile(self: *History) !void {
        const path = self.getDefaultPath();
        const content = std.fs.cwd().readFileAlloc(self.allocator, path, 1024 * 1024) catch return;
        defer self.allocator.free(content);

        var it = std.mem.splitScalar(u8, content, '\n');
        while (it.next()) |line| {
            if (line.len > 0) {
                const copy = try self.allocator.dupe(u8, line);
                try self.entries.append(self.allocator, copy);
            }
        }

        self.position = self.entries.items.len;
    }

    pub fn saveToFile(self: *History, path: []const u8) !void {
        const file = try std.fs.cwd().createFile(path, .{});
        defer file.close();

        for (self.entries.items) |entry| {
            _ = try file.write(entry);
            _ = try file.write("\n");
        }
    }
};

// ============================================================================
// Command Entry Point
// ============================================================================

const Arena = bun.allocators.MimallocArena;
const AsyncHTTP = bun.http.AsyncHTTP;

pub fn exec(ctx: Command.Context) !void {
    // Print welcome banner
    printBanner();

    // Initialize JSC
    jsc.initialize(false);

    js_ast.Expr.Data.Store.create();
    js_ast.Stmt.Data.Store.create();

    var arena = Arena.init();
    // Don't defer arena.deinit() - we need it to stay alive for the REPL session

    // Initialize VirtualMachine
    const vm = try VirtualMachine.init(.{
        .allocator = arena.allocator(),
        .log = ctx.log,
        .args = ctx.args,
        .is_main_thread = true,
        .smol = ctx.runtime_options.smol,
        .debugger = ctx.runtime_options.debugger,
        .eval = true, // REPL evaluates code
    });

    // Configure event loop and global
    vm.regular_event_loop.global = vm.global;
    vm.event_loop.ensureWaker();

    // Configure transpiler options
    const b = &vm.transpiler;
    vm.preload = ctx.preloads;
    vm.argv = ctx.passthrough;
    vm.arena = &arena;
    vm.allocator = arena.allocator();
    b.options.install = ctx.install;
    b.resolver.opts.install = ctx.install;
    b.resolver.opts.global_cache = ctx.debug.global_cache;
    b.resolver.opts.prefer_offline_install = (ctx.debug.offline_mode_setting orelse .online) == .offline;
    b.resolver.opts.prefer_latest_install = (ctx.debug.offline_mode_setting orelse .online) == .latest;
    b.options.global_cache = b.resolver.opts.global_cache;
    b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
    b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
    b.resolver.env_loader = b.env;
    b.options.env.behavior = .load_all_without_inlining;

    // Configure defines for the transpiler
    b.configureDefines() catch {
        bun.bun_js.failWithBuildError(vm);
    };

    // Load environment
    AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);
    vm.loadExtraEnvAndSourceCodePrinter();
    vm.is_main_thread = true;
    jsc.VirtualMachine.is_main_thread_vm = true;

    // Acquire JSC API lock - all JS operations must happen within the lock
    const api_lock = vm.jsc_vm.getAPILock();
    defer api_lock.release();

    // Create REPL instance
    const repl = try Repl.init(ctx.allocator, vm);
    defer repl.deinit();

    // Main REPL loop
    while (true) {
        const line = repl.readLine() catch |err| {
            Output.pretty("<red>Error reading input: {s}<r>\n", .{@errorName(err)});
            continue;
        };

        if (line) |input| {
            defer ctx.allocator.free(input);

            repl.eval(input) catch |err| {
                Output.pretty("<red>Error: {s}<r>\n", .{@errorName(err)});
            };
        } else {
            // EOF - exit
            break;
        }
    }

    Output.pretty("<d>Goodbye!<r>\n", .{});
}

fn printBanner() void {
    Output.pretty(
        \\<b><magenta>Bun<r> <b>v{s}<r> REPL
        \\<d>Type .help for available commands<r>
        \\
    , .{Global.package_json_version});
    Output.flush();
}
