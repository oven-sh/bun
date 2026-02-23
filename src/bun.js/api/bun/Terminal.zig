//! Bun.Terminal - Creates a pseudo-terminal (PTY) for interactive terminal sessions.
//!
//! This module provides a Terminal class that creates a PTY master/slave pair,
//! allowing JavaScript code to interact with terminal-based programs.
//!
//! Lifecycle:
//! - Starts with weak JSRef (allows GC if user doesn't hold reference)
//! - Upgrades to strong when actively reading/writing
//! - Downgrades to weak on EOF from master_fd
//! - Callbacks are stored via `values` in classes.ts, accessed via js.gc

const Terminal = @This();

const log = bun.Output.scoped(.Terminal, .hidden);

// Generated bindings
pub const js = jsc.Codegen.JSTerminal;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

// Reference counting for Terminal
// Refs are held by:
// 1. JS side (released in finalize)
// 2. Reader (released in onReaderDone/onReaderError)
// 3. Writer (released in onWriterClose)
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,

/// The master side of the PTY (original fd, used for ioctl operations)
master_fd: bun.FileDescriptor,

/// Duplicated master fd for reading
read_fd: bun.FileDescriptor,

/// Duplicated master fd for writing
write_fd: bun.FileDescriptor,

/// The slave side of the PTY (used by child processes)
slave_fd: bun.FileDescriptor,

/// Current terminal size
cols: u16,
rows: u16,

/// Terminal name (e.g., "xterm-256color")
term_name: jsc.ZigString.Slice,

/// Event loop handle for callbacks
event_loop_handle: jsc.EventLoopHandle,

/// Global object reference
globalThis: *jsc.JSGlobalObject,

/// Writer for sending data to the terminal
writer: IOWriter = .{},

/// Reader for receiving data from the terminal
reader: IOReader = IOReader.init(@This()),

/// This value reference for GC tracking
/// - weak: allows GC when idle
/// - strong: prevents GC when actively connected
this_value: jsc.JSRef = jsc.JSRef.empty(),

/// State flags
flags: Flags = .{},

pub const Flags = packed struct(u8) {
    closed: bool = false,
    finalized: bool = false,
    raw_mode: bool = false,
    reader_started: bool = false,
    connected: bool = false,
    reader_done: bool = false,
    writer_done: bool = false,
    _: u1 = 0,
};

pub const IOWriter = bun.io.StreamingWriter(@This(), struct {
    pub const onClose = Terminal.onWriterClose;
    pub const onWritable = Terminal.onWriterReady;
    pub const onError = Terminal.onWriterError;
    pub const onWrite = Terminal.onWrite;
});

/// Poll type alias for FilePoll Owner registration
pub const Poll = IOWriter;

pub const IOReader = bun.io.BufferedReader;

/// Options for creating a Terminal
pub const Options = struct {
    cols: u16 = 80,
    rows: u16 = 24,
    term_name: jsc.ZigString.Slice = .{},
    data_callback: ?JSValue = null,
    exit_callback: ?JSValue = null,
    drain_callback: ?JSValue = null,

    /// Maximum length for terminal name (e.g., "xterm-256color")
    /// Longest known terminfo names are ~23 chars; 128 allows for custom terminals
    pub const max_term_name_len = 128;

    /// Parse terminal options from a JS object
    pub fn parseFromJS(globalObject: *jsc.JSGlobalObject, js_options: JSValue) bun.JSError!Options {
        var options = Options{};

        if (try js_options.getOptional(globalObject, "cols", i32)) |n| {
            if (n > 0 and n <= 65535) options.cols = @intCast(n);
        }

        if (try js_options.getOptional(globalObject, "rows", i32)) |n| {
            if (n > 0 and n <= 65535) options.rows = @intCast(n);
        }

        if (try js_options.getOptional(globalObject, "name", jsc.ZigString.Slice)) |slice| {
            if (slice.len > max_term_name_len) {
                slice.deinit();
                return globalObject.throw("Terminal name too long (max {d} characters)", .{max_term_name_len});
            }
            options.term_name = slice;
        }

        if (try js_options.getOptional(globalObject, "data", JSValue)) |v| {
            if (v.isCell() and v.isCallable()) {
                options.data_callback = v.withAsyncContextIfNeeded(globalObject);
            }
        }

        if (try js_options.getOptional(globalObject, "exit", JSValue)) |v| {
            if (v.isCell() and v.isCallable()) {
                options.exit_callback = v.withAsyncContextIfNeeded(globalObject);
            }
        }

        if (try js_options.getOptional(globalObject, "drain", JSValue)) |v| {
            if (v.isCell() and v.isCallable()) {
                options.drain_callback = v.withAsyncContextIfNeeded(globalObject);
            }
        }

        return options;
    }

    pub fn deinit(this: *Options) void {
        this.term_name.deinit();
        this.* = .{};
    }
};

/// Result from creating a Terminal
pub const CreateResult = struct {
    terminal: *Terminal,
    js_value: jsc.JSValue,
};

const InitError = CreatePtyError || error{ WriterStartFailed, ReaderStartFailed };

/// Internal initialization - shared by constructor and createFromSpawn
fn initTerminal(
    globalObject: *jsc.JSGlobalObject,
    options: Options,
    /// If provided, use this JSValue; otherwise create one via toJS
    existing_js_value: ?jsc.JSValue,
) InitError!CreateResult {
    // Create PTY
    const pty_result = try createPty(options.cols, options.rows);

    // Use default term name if empty
    const term_name = if (options.term_name.len > 0)
        options.term_name
    else
        jsc.ZigString.Slice.fromUTF8NeverFree("xterm-256color");

    const terminal = bun.new(Terminal, .{
        .ref_count = .init(),
        .master_fd = pty_result.master,
        .read_fd = pty_result.read_fd,
        .write_fd = pty_result.write_fd,
        .slave_fd = pty_result.slave,
        .cols = options.cols,
        .rows = options.rows,
        .term_name = term_name,
        .event_loop_handle = jsc.EventLoopHandle.init(globalObject.bunVM().eventLoop()),
        .globalThis = globalObject,
    });

    // Set reader parent
    terminal.reader.setParent(terminal);

    // Set writer parent
    terminal.writer.parent = terminal;

    // Start writer with the write fd - adds a ref
    switch (terminal.writer.start(pty_result.write_fd, true)) {
        .result => terminal.ref(),
        .err => return error.WriterStartFailed,
    }

    // Start reader with the read fd - adds a ref
    switch (terminal.reader.start(pty_result.read_fd, true)) {
        .err => {
            // Reader never started but writer was started
            // Close writer (will trigger onWriterDone -> deref for writer's ref)
            terminal.writer.close();
            return error.ReaderStartFailed;
        },
        .result => {
            terminal.ref();
            if (comptime Environment.isPosix) {
                if (terminal.reader.handle == .poll) {
                    const poll = terminal.reader.handle.poll;
                    // PTY behaves like a pipe, not a socket
                    terminal.reader.flags.nonblocking = true;
                    terminal.reader.flags.pollable = true;
                    poll.flags.insert(.nonblocking);
                }
            }
            terminal.flags.reader_started = true;
        },
    }

    // Start reading data
    terminal.reader.read();

    // Get or create the JS wrapper
    const this_value = existing_js_value orelse terminal.toJS(globalObject);

    // Store the this_value (JSValue wrapper) - start with strong ref since we're actively reading
    // This is the JS side ref (released in finalize)
    terminal.this_value = jsc.JSRef.initStrong(this_value, globalObject);
    terminal.ref();

    // Store callbacks via generated gc setters (prevents GC of callbacks while terminal is alive)
    // Note: callbacks were already validated in parseFromJS() and may be wrapped in AsyncContextFrame
    // by withAsyncContextIfNeeded(), so we don't re-check isCallable() here
    if (options.data_callback) |cb| {
        js.gc.set(.data, this_value, globalObject, cb);
    }
    if (options.exit_callback) |cb| {
        js.gc.set(.exit, this_value, globalObject, cb);
    }
    if (options.drain_callback) |cb| {
        js.gc.set(.drain, this_value, globalObject, cb);
    }

    return .{ .terminal = terminal, .js_value = this_value };
}

/// Constructor for Terminal - called from JavaScript
/// With constructNeedsThis: true, we receive the JSValue wrapper directly
pub fn constructor(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    this_value: jsc.JSValue,
) bun.JSError!*Terminal {
    const args = callframe.argumentsAsArray(1);
    const js_options = args[0];

    if (js_options.isUndefinedOrNull()) {
        return globalObject.throw("Terminal constructor requires an options object", .{});
    }

    var options = try Options.parseFromJS(globalObject, js_options);

    const result = initTerminal(globalObject, options, this_value) catch |err| {
        options.deinit();
        return switch (err) {
            error.OpenPtyFailed => globalObject.throw("Failed to open PTY", .{}),
            error.DupFailed => globalObject.throw("Failed to duplicate PTY file descriptor", .{}),
            error.NotSupported => globalObject.throw("PTY not supported on this platform", .{}),
            error.WriterStartFailed => globalObject.throw("Failed to start terminal writer", .{}),
            error.ReaderStartFailed => globalObject.throw("Failed to start terminal reader", .{}),
        };
    };

    return result.terminal;
}

/// Create a Terminal from Bun.spawn options (not from JS constructor)
/// Returns the Terminal and its JS wrapper value
/// The slave_fd should be used for the subprocess's stdin/stdout/stderr
pub fn createFromSpawn(
    globalObject: *jsc.JSGlobalObject,
    options: Options,
) InitError!CreateResult {
    return initTerminal(globalObject, options, null);
}

/// Get the slave fd for subprocess to use
pub fn getSlaveFd(this: *Terminal) bun.FileDescriptor {
    return this.slave_fd;
}

/// Close the parent's copy of slave_fd after fork
/// The child process has its own copy - closing the parent's ensures
/// EOF is received on the master side when the child exits
pub fn closeSlaveFd(this: *Terminal) void {
    if (this.slave_fd != bun.invalid_fd) {
        this.slave_fd.close();
        this.slave_fd = bun.invalid_fd;
    }
}

const PtyResult = struct {
    master: bun.FileDescriptor,
    read_fd: bun.FileDescriptor,
    write_fd: bun.FileDescriptor,
    slave: bun.FileDescriptor,
};

const CreatePtyError = error{ OpenPtyFailed, DupFailed, NotSupported };

fn createPty(cols: u16, rows: u16) CreatePtyError!PtyResult {
    if (comptime Environment.isPosix) {
        return createPtyPosix(cols, rows);
    } else {
        // Windows PTY support would go here
        return error.NotSupported;
    }
}

// OpenPtyTermios is required for the openpty() extern signature even though we pass null.
// Kept for type correctness of the C function declaration.
const OpenPtyTermios = extern struct {
    c_iflag: u32,
    c_oflag: u32,
    c_cflag: u32,
    c_lflag: u32,
    c_cc: [20]u8,
    c_ispeed: u32,
    c_ospeed: u32,
};

const Winsize = extern struct {
    ws_row: u16,
    ws_col: u16,
    ws_xpixel: u16,
    ws_ypixel: u16,
};

const OpenPtyFn = *const fn (
    amaster: *c_int,
    aslave: *c_int,
    name: ?[*]u8,
    termp: ?*const OpenPtyTermios,
    winp: ?*const Winsize,
) callconv(.c) c_int;

/// Dynamic loading of openpty on Linux (it's in libutil which may not be linked)
const LibUtil = struct {
    var handle: ?*anyopaque = null;
    var loaded: bool = false;

    pub fn getHandle() ?*anyopaque {
        if (loaded) return handle;
        loaded = true;

        // Try libutil.so first (most common), then libutil.so.1
        const lib_names = [_][:0]const u8{ "libutil.so", "libutil.so.1", "libc.so.6" };
        for (lib_names) |lib_name| {
            handle = bun.sys.dlopen(lib_name, .{ .LAZY = true });
            if (handle != null) return handle;
        }
        return null;
    }

    pub fn getOpenPty() ?OpenPtyFn {
        return bun.sys.dlsymWithHandle(OpenPtyFn, "openpty", getHandle);
    }
};

fn getOpenPtyFn() ?OpenPtyFn {
    // On macOS, openpty is in libc, so we can use it directly
    if (comptime Environment.isMac) {
        const c = struct {
            extern "c" fn openpty(
                amaster: *c_int,
                aslave: *c_int,
                name: ?[*]u8,
                termp: ?*const OpenPtyTermios,
                winp: ?*const Winsize,
            ) c_int;
        };
        return &c.openpty;
    }

    // On Linux, openpty is in libutil, which may not be linked
    // Load it dynamically via dlopen
    if (comptime Environment.isLinux) {
        return LibUtil.getOpenPty();
    }

    return null;
}

fn createPtyPosix(cols: u16, rows: u16) CreatePtyError!PtyResult {
    const openpty_fn = getOpenPtyFn() orelse {
        return error.NotSupported;
    };

    var master_fd: c_int = -1;
    var slave_fd: c_int = -1;

    const winsize = Winsize{
        .ws_row = rows,
        .ws_col = cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };

    const result = openpty_fn(&master_fd, &slave_fd, null, null, &winsize);
    if (result != 0) {
        return error.OpenPtyFailed;
    }

    const master_fd_desc = bun.FD.fromNative(master_fd);
    const slave_fd_desc = bun.FD.fromNative(slave_fd);

    // Configure sensible terminal defaults matching node-pty behavior.
    // These are "cooked mode" defaults that most terminal applications expect.
    if (std.posix.tcgetattr(slave_fd)) |termios| {
        var t = termios;

        // Input flags: standard terminal input processing
        t.iflag = .{
            .ICRNL = true, // Map CR to NL on input
            .IXON = true, // Enable XON/XOFF flow control on output
            .IXANY = true, // Any character restarts output
            .IMAXBEL = true, // Ring bell on input queue full
            .BRKINT = true, // Signal interrupt on break
            .IUTF8 = true, // Input is UTF-8
        };

        // Output flags: standard terminal output processing
        t.oflag = .{
            .OPOST = true, // Enable output processing
            .ONLCR = true, // Map NL to CR-NL on output
        };

        // Control flags: 8-bit chars, enable receiver
        t.cflag = .{
            .CREAD = true, // Enable receiver
            .CSIZE = .CS8, // 8-bit characters
            .HUPCL = true, // Hang up on last close
        };

        // Local flags: canonical mode with echo and signals
        t.lflag = .{
            .ICANON = true, // Canonical input (line editing)
            .ISIG = true, // Enable signals (INTR, QUIT, SUSP)
            .IEXTEN = true, // Enable extended input processing
            .ECHO = true, // Echo input characters
            .ECHOE = true, // Echo erase as backspace-space-backspace
            .ECHOK = true, // Echo NL after KILL
            .ECHOKE = true, // Visual erase for KILL
            .ECHOCTL = true, // Echo control chars as ^X
        };

        // Control characters - standard defaults
        t.cc[@intFromEnum(std.posix.V.EOF)] = 4; // Ctrl-D
        t.cc[@intFromEnum(std.posix.V.EOL)] = 0; // Disabled
        t.cc[@intFromEnum(std.posix.V.ERASE)] = 0x7f; // DEL (backspace)
        t.cc[@intFromEnum(std.posix.V.WERASE)] = 23; // Ctrl-W
        t.cc[@intFromEnum(std.posix.V.KILL)] = 21; // Ctrl-U
        t.cc[@intFromEnum(std.posix.V.REPRINT)] = 18; // Ctrl-R
        t.cc[@intFromEnum(std.posix.V.INTR)] = 3; // Ctrl-C
        t.cc[@intFromEnum(std.posix.V.QUIT)] = 0x1c; // Ctrl-backslash
        t.cc[@intFromEnum(std.posix.V.SUSP)] = 26; // Ctrl-Z
        t.cc[@intFromEnum(std.posix.V.START)] = 17; // Ctrl-Q (XON)
        t.cc[@intFromEnum(std.posix.V.STOP)] = 19; // Ctrl-S (XOFF)
        t.cc[@intFromEnum(std.posix.V.LNEXT)] = 22; // Ctrl-V
        t.cc[@intFromEnum(std.posix.V.DISCARD)] = 15; // Ctrl-O
        t.cc[@intFromEnum(std.posix.V.MIN)] = 1; // Min chars for non-canonical read
        t.cc[@intFromEnum(std.posix.V.TIME)] = 0; // Timeout for non-canonical read

        // Set baud rate to 38400 (standard for PTYs)
        t.ispeed = .B38400;
        t.ospeed = .B38400;

        std.posix.tcsetattr(slave_fd, .NOW, t) catch {};
    } else |err| {
        // tcgetattr failed, log in debug builds but continue without modifying termios
        if (comptime bun.Environment.allow_assert) {
            bun.sys.syslog("tcgetattr(slave_fd={d}) failed: {s}", .{ slave_fd, @errorName(err) });
        }
    }

    // Duplicate the master fd for reading and writing separately
    // This allows independent epoll registration and closing
    const read_fd = switch (bun.sys.dup(master_fd_desc)) {
        .result => |fd| fd,
        .err => {
            master_fd_desc.close();
            slave_fd_desc.close();
            return error.DupFailed;
        },
    };

    const write_fd = switch (bun.sys.dup(master_fd_desc)) {
        .result => |fd| fd,
        .err => {
            master_fd_desc.close();
            slave_fd_desc.close();
            read_fd.close();
            return error.DupFailed;
        },
    };

    // Set non-blocking on master side fds (for async I/O in the event loop)
    _ = bun.sys.updateNonblocking(master_fd_desc, true);
    _ = bun.sys.updateNonblocking(read_fd, true);
    _ = bun.sys.updateNonblocking(write_fd, true);
    // Note: slave_fd stays blocking - child processes expect blocking I/O

    // Set close-on-exec on master side fds only
    // slave_fd should NOT have close-on-exec since child needs to inherit it
    _ = bun.sys.setCloseOnExec(master_fd_desc);
    _ = bun.sys.setCloseOnExec(read_fd);
    _ = bun.sys.setCloseOnExec(write_fd);

    return PtyResult{
        .master = master_fd_desc,
        .read_fd = read_fd,
        .write_fd = write_fd,
        .slave = slave_fd_desc,
    };
}

/// Check if terminal is closed
pub fn getClosed(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.flags.closed);
}

fn getTermiosFlag(this: *Terminal, comptime field: enum { iflag, oflag, lflag, cflag }) JSValue {
    if (comptime !Environment.isPosix) return JSValue.jsNumber(0);
    if (this.flags.closed or this.master_fd == bun.invalid_fd) return JSValue.jsNumber(0);
    const termios_data = getTermios(this.master_fd) orelse return JSValue.jsNumber(0);
    const flag = @field(termios_data, @tagName(field));
    const Int = @typeInfo(@TypeOf(flag)).@"struct".backing_integer.?;
    return JSValue.jsNumber(@as(f64, @floatFromInt(@as(Int, @bitCast(flag)))));
}

fn setTermiosFlag(this: *Terminal, globalObject: *jsc.JSGlobalObject, comptime field: enum { iflag, oflag, lflag, cflag }, value: JSValue) bun.JSError!void {
    if (comptime !Environment.isPosix) return;
    if (this.flags.closed or this.master_fd == bun.invalid_fd) return;
    const num = try value.coerce(f64, globalObject);
    var termios_data = getTermios(this.master_fd) orelse return;
    const FlagType = @TypeOf(@field(termios_data, @tagName(field)));
    const Int = @typeInfo(FlagType).@"struct".backing_integer.?;
    const max_val: f64 = @floatFromInt(std.math.maxInt(Int));
    const clamped = @max(0, @min(num, max_val));
    @field(termios_data, @tagName(field)) = @bitCast(@as(Int, @intFromFloat(clamped)));
    _ = setTermios(this.master_fd, &termios_data);
}

pub fn getInputFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    return this.getTermiosFlag(.iflag);
}
pub fn setInputFlags(this: *Terminal, globalObject: *jsc.JSGlobalObject, value: JSValue) bun.JSError!void {
    try this.setTermiosFlag(globalObject, .iflag, value);
}
pub fn getOutputFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    return this.getTermiosFlag(.oflag);
}
pub fn setOutputFlags(this: *Terminal, globalObject: *jsc.JSGlobalObject, value: JSValue) bun.JSError!void {
    try this.setTermiosFlag(globalObject, .oflag, value);
}
pub fn getLocalFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    return this.getTermiosFlag(.lflag);
}
pub fn setLocalFlags(this: *Terminal, globalObject: *jsc.JSGlobalObject, value: JSValue) bun.JSError!void {
    try this.setTermiosFlag(globalObject, .lflag, value);
}
pub fn getControlFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    return this.getTermiosFlag(.cflag);
}
pub fn setControlFlags(this: *Terminal, globalObject: *jsc.JSGlobalObject, value: JSValue) bun.JSError!void {
    try this.setTermiosFlag(globalObject, .cflag, value);
}

/// Write data to the terminal
pub fn write(
    this: *Terminal,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    if (this.flags.closed) {
        return globalObject.throw("Terminal is closed", .{});
    }

    const args = callframe.argumentsAsArray(1);
    const data = args[0];

    if (data.isUndefinedOrNull()) {
        return globalObject.throw("write() requires data argument", .{});
    }

    // Get bytes to write using StringOrBuffer
    const string_or_buffer = try jsc.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, data) orelse {
        return globalObject.throw("write() argument must be a string or ArrayBuffer", .{});
    };
    defer string_or_buffer.deinit();

    const bytes = string_or_buffer.slice();

    if (bytes.len == 0) {
        return JSValue.jsNumber(0);
    }

    // Write using the streaming writer
    const write_result = this.writer.write(bytes);
    return switch (write_result) {
        .done => |amt| JSValue.jsNumber(@as(i32, @intCast(amt))),
        .wrote => |amt| JSValue.jsNumber(@as(i32, @intCast(amt))),
        .pending => |amt| JSValue.jsNumber(@as(i32, @intCast(amt))),
        .err => |err| globalObject.throwValue(try err.toJS(globalObject)),
    };
}

/// Resize the terminal
pub fn resize(
    this: *Terminal,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    if (this.flags.closed) {
        return globalObject.throw("Terminal is closed", .{});
    }

    const args = callframe.argumentsAsArray(2);

    const new_cols: u16 = blk: {
        if (args[0].isNumber()) {
            const n = args[0].toInt32();
            if (n > 0 and n <= 65535) break :blk @intCast(n);
        }
        return globalObject.throw("resize() requires valid cols argument", .{});
    };

    const new_rows: u16 = blk: {
        if (args[1].isNumber()) {
            const n = args[1].toInt32();
            if (n > 0 and n <= 65535) break :blk @intCast(n);
        }
        return globalObject.throw("resize() requires valid rows argument", .{});
    };

    if (comptime Environment.isPosix) {
        const ioctl_c = struct {
            const TIOCSWINSZ: c_ulong = if (Environment.isMac) 0x80087467 else 0x5414;

            const Winsize = extern struct {
                ws_row: u16,
                ws_col: u16,
                ws_xpixel: u16,
                ws_ypixel: u16,
            };

            extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
        };

        var winsize = ioctl_c.Winsize{
            .ws_row = new_rows,
            .ws_col = new_cols,
            .ws_xpixel = 0,
            .ws_ypixel = 0,
        };

        const ioctl_result = ioctl_c.ioctl(this.master_fd.cast(), ioctl_c.TIOCSWINSZ, &winsize);
        if (ioctl_result != 0) {
            return globalObject.throw("Failed to resize terminal", .{});
        }
    }

    this.cols = new_cols;
    this.rows = new_rows;

    return .js_undefined;
}

/// Set raw mode on the terminal
pub fn setRawMode(
    this: *Terminal,
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    if (this.flags.closed) {
        return globalObject.throw("Terminal is closed", .{});
    }

    const args = callframe.argumentsAsArray(1);
    const enabled = args[0].toBoolean();

    if (comptime Environment.isPosix) {
        // Use the existing TTY mode function
        const mode: c_int = if (enabled) 1 else 0;
        const tty_result = Bun__ttySetMode(this.master_fd.cast(), mode);
        if (tty_result != 0) {
            return globalObject.throw("Failed to set raw mode", .{});
        }
    }

    this.flags.raw_mode = enabled;
    return .js_undefined;
}

extern fn Bun__ttySetMode(fd: c_int, mode: c_int) c_int;

/// POSIX termios struct for terminal flags manipulation
const Termios = if (Environment.isPosix) std.posix.termios else void;

/// Get terminal attributes using tcgetattr
fn getTermios(fd: bun.FileDescriptor) ?Termios {
    if (comptime !Environment.isPosix) return null;
    return std.posix.tcgetattr(fd.cast()) catch null;
}

/// Set terminal attributes using tcsetattr (TCSANOW = immediate)
fn setTermios(fd: bun.FileDescriptor, termios_p: *const Termios) bool {
    if (comptime !Environment.isPosix) return false;
    std.posix.tcsetattr(fd.cast(), .NOW, termios_p.*) catch return false;
    return true;
}

/// Reference the terminal to keep the event loop alive
pub fn doRef(this: *Terminal, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.updateRef(true);
    return .js_undefined;
}

/// Unreference the terminal
pub fn doUnref(this: *Terminal, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.updateRef(false);
    return .js_undefined;
}

fn updateRef(this: *Terminal, add: bool) void {
    this.reader.updateRef(add);
    this.writer.updateRef(this.event_loop_handle, add);
}

/// Close the terminal
pub fn close(
    this: *Terminal,
    _: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    this.closeInternal();
    return .js_undefined;
}

/// Async dispose for "using" syntax
pub fn asyncDispose(
    this: *Terminal,
    globalObject: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    this.closeInternal();
    return jsc.JSPromise.resolvedPromiseValue(globalObject, .js_undefined);
}

pub fn closeInternal(this: *Terminal) void {
    if (this.flags.closed) return;
    this.flags.closed = true;

    // Close reader (closes read_fd)
    if (this.flags.reader_started) {
        this.reader.close();
    }
    this.read_fd = bun.invalid_fd;

    // Close writer (closes write_fd)
    this.writer.close();
    this.write_fd = bun.invalid_fd;

    // Close master fd
    if (this.master_fd != bun.invalid_fd) {
        this.master_fd.close();
        this.master_fd = bun.invalid_fd;
    }

    // Close slave fd
    if (this.slave_fd != bun.invalid_fd) {
        this.slave_fd.close();
        this.slave_fd = bun.invalid_fd;
    }
}

// IOWriter callbacks
fn onWriterClose(this: *Terminal) void {
    log("onWriterClose", .{});
    if (!this.flags.writer_done) {
        this.flags.writer_done = true;
        // Release writer's ref
        this.deref();
    }
}

fn onWriterReady(this: *Terminal) void {
    log("onWriterReady", .{});
    // Call drain callback
    const this_jsvalue = this.this_value.tryGet() orelse return;
    if (js.gc.get(.drain, this_jsvalue)) |callback| {
        const globalThis = this.globalThis;
        globalThis.bunVM().eventLoop().runCallback(
            callback,
            globalThis,
            this_jsvalue,
            &.{this_jsvalue},
        );
    }
}

fn onWriterError(this: *Terminal, err: bun.sys.Error) void {
    log("onWriterError: {any}", .{err});
    // On write error, close the terminal to prevent further operations
    // This handles cases like broken pipe when the child process exits
    if (!this.flags.closed) {
        this.closeInternal();
    }
}

fn onWrite(this: *Terminal, amount: usize, status: bun.io.WriteStatus) void {
    log("onWrite: {} bytes, status: {any}", .{ amount, status });
    _ = this;
}

// IOReader callbacks
pub fn onReaderDone(this: *Terminal) void {
    log("onReaderDone", .{});
    // EOF from master - downgrade to weak ref to allow GC
    // Skip JS interactions if already finalized (happens when close() is called during finalize)
    if (!this.flags.finalized) {
        this.flags.connected = false;
        this.this_value.downgrade();
        // exit_code 0 = clean EOF on PTY stream (not subprocess exit code)
        this.callExitCallback(0, null);
    }
    // Release reader's ref (only once)
    if (!this.flags.reader_done) {
        this.flags.reader_done = true;
        this.deref();
    }
}

pub fn onReaderError(this: *Terminal, err: bun.sys.Error) void {
    log("onReaderError: {any}", .{err});
    // Error - downgrade to weak ref to allow GC
    // Skip JS interactions if already finalized
    if (!this.flags.finalized) {
        this.flags.connected = false;
        this.this_value.downgrade();
        // exit_code 1 = I/O error on PTY stream (not subprocess exit code)
        this.callExitCallback(1, null);
    }
    // Release reader's ref (only once)
    if (!this.flags.reader_done) {
        this.flags.reader_done = true;
        this.deref();
    }
}

/// Invoke the exit callback with PTY lifecycle status.
/// Note: exit_code is PTY-level (0=EOF, 1=error), NOT the subprocess exit code.
/// The signal parameter is only populated if a signal caused the PTY close.
fn callExitCallback(this: *Terminal, exit_code: i32, signal: ?bun.SignalCode) void {
    const this_jsvalue = this.this_value.tryGet() orelse return;
    const callback = js.gc.get(.exit, this_jsvalue) orelse return;

    const globalThis = this.globalThis;
    const signal_value: JSValue = if (signal) |s|
        jsc.ZigString.init(s.name() orelse "unknown").toJS(globalThis)
    else
        JSValue.jsNull();

    globalThis.bunVM().eventLoop().runCallback(
        callback,
        globalThis,
        this_jsvalue,
        &.{ this_jsvalue, JSValue.jsNumber(exit_code), signal_value },
    );
}

// Called when data is available from the reader
// Returns true to continue reading, false to pause
pub fn onReadChunk(this: *Terminal, chunk: []const u8, has_more: bun.io.ReadState) bool {
    _ = has_more;
    log("onReadChunk: {} bytes", .{chunk.len});

    // First data received - upgrade to strong ref (connected)
    if (!this.flags.connected) {
        this.flags.connected = true;
        this.this_value.upgrade(this.globalThis);
    }

    const this_jsvalue = this.this_value.tryGet() orelse return true;
    const callback = js.gc.get(.data, this_jsvalue) orelse return true;

    const globalThis = this.globalThis;
    const duped = bun.default_allocator.dupe(u8, chunk) catch |err| {
        log("Terminal data allocation OOM: chunk_size={d}, error={any}", .{ chunk.len, err });
        return true;
    };
    const data = jsc.MarkedArrayBuffer.fromBytes(
        duped,
        bun.default_allocator,
        .Uint8Array,
    ).toNodeBuffer(globalThis);

    globalThis.bunVM().eventLoop().runCallback(
        callback,
        globalThis,
        this_jsvalue,
        &.{ this_jsvalue, data },
    );

    return true; // Continue reading
}

pub fn eventLoop(this: *Terminal) jsc.EventLoopHandle {
    return this.event_loop_handle;
}

pub fn loop(this: *Terminal) *bun.Async.Loop {
    if (comptime Environment.isWindows) {
        return this.event_loop_handle.loop().uv_loop;
    } else {
        return this.event_loop_handle.loop();
    }
}

fn deinit(this: *Terminal) void {
    log("deinit", .{});
    // Set reader/writer done flags to prevent extra deref calls in closeInternal
    this.flags.reader_done = true;
    this.flags.writer_done = true;
    // Close all FDs if not already closed (handles constructor error paths)
    // closeInternal() checks flags.closed and returns early on subsequent calls,
    // so this is safe even if finalize() already called it
    this.closeInternal();
    this.term_name.deinit();
    this.reader.deinit();
    this.writer.deinit();
    bun.destroy(this);
}

/// Finalize - called by GC when object is collected
pub fn finalize(this: *Terminal) callconv(.c) void {
    log("finalize", .{});
    jsc.markBinding(@src());
    this.this_value.finalize();
    this.flags.finalized = true;
    this.closeInternal();
    this.deref();
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
