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
term_name: []const u8,

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
    connected: bool = false, // True when actively connected (strong ref)
    reader_done: bool = false, // True when reader has released its ref
    writer_done: bool = false, // True when writer has released its ref
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

/// Constructor for Terminal - called from JavaScript
/// With constructNeedsThis: true, we receive the JSValue wrapper directly
pub fn constructor(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    this_value: jsc.JSValue,
) bun.JSError!*Terminal {
    const args = callframe.argumentsAsArray(1);
    const options = args[0];

    if (options.isUndefinedOrNull()) {
        return globalObject.throw("Terminal constructor requires an options object", .{});
    }

    // Parse options
    const cols: u16 = blk: {
        if (try options.getOptional(globalObject, "cols", JSValue)) |v| {
            if (v.isNumber()) {
                const n = v.toInt32();
                if (n > 0 and n <= 65535) break :blk @intCast(n);
            }
        }
        break :blk 80;
    };

    const rows: u16 = blk: {
        if (try options.getOptional(globalObject, "rows", JSValue)) |v| {
            if (v.isNumber()) {
                const n = v.toInt32();
                if (n > 0 and n <= 65535) break :blk @intCast(n);
            }
        }
        break :blk 24;
    };

    // Get terminal name
    const term_name: []const u8 = blk: {
        if (try options.getOptional(globalObject, "name", JSValue)) |v| {
            if (v.isString()) {
                const str = try v.getZigString(globalObject);
                if (str.len > 0) {
                    break :blk bun.default_allocator.dupe(u8, str.slice()) catch {
                        return globalObject.throw("Failed to allocate terminal name", .{});
                    };
                }
            }
        }
        break :blk bun.default_allocator.dupe(u8, "xterm-256color") catch {
            return globalObject.throw("Failed to allocate terminal name", .{});
        };
    };

    // Get callbacks from options (will be stored via js.gc after toJS)
    const data_callback = try options.getOptional(globalObject, "data", JSValue);
    const exit_callback = try options.getOptional(globalObject, "exit", JSValue);
    const drain_callback = try options.getOptional(globalObject, "drain", JSValue);

    // Create PTY
    const pty_result = createPty(cols, rows) catch |err| {
        bun.default_allocator.free(term_name);
        return switch (err) {
            error.OpenPtyFailed => globalObject.throw("Failed to open PTY", .{}),
            error.DupFailed => globalObject.throw("Failed to duplicate PTY file descriptor", .{}),
            error.NotSupported => globalObject.throw("PTY not supported on this platform", .{}),
        };
    };

    const terminal = bun.new(Terminal, .{
        // 3 refs: JS side, reader, writer
        .ref_count = .initExactRefs(3),
        .master_fd = pty_result.master,
        .read_fd = pty_result.read_fd,
        .write_fd = pty_result.write_fd,
        .slave_fd = pty_result.slave,
        .cols = cols,
        .rows = rows,
        .term_name = term_name,
        .event_loop_handle = jsc.EventLoopHandle.init(globalObject.bunVM().eventLoop()),
        .globalThis = globalObject,
    });

    // Set reader parent
    terminal.reader.setParent(terminal);

    // Set writer parent
    terminal.writer.parent = terminal;

    // Start writer with the write fd
    switch (terminal.writer.start(pty_result.write_fd, true)) {
        .result => {},
        .err => {
            // Writer never started - manually release all 3 refs (JS, reader, writer)
            // since no callbacks will fire
            terminal.deref(); // JS ref
            terminal.deref(); // reader ref
            terminal.deref(); // writer ref
            return globalObject.throw("Failed to start terminal writer", .{});
        },
    }

    // Start reader with the read fd
    switch (terminal.reader.start(pty_result.read_fd, true)) {
        .err => {
            // Reader never started but writer was started
            // Close writer (will trigger onWriterDone -> deref for writer's ref)
            terminal.writer.close();
            // Manually release JS and reader refs
            terminal.deref(); // JS ref
            terminal.deref(); // reader ref
            return globalObject.throw("Failed to start terminal reader", .{});
        },
        .result => {
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

    // Store the this_value (JSValue wrapper) - start with weak ref
    terminal.this_value = jsc.JSRef.initWeak(this_value);

    // Store callbacks via generated gc setters (prevents GC of callbacks while terminal is alive)
    if (data_callback) |cb| {
        if (cb.isCell() and cb.isCallable()) {
            js.gc.set(.data, this_value, globalObject, cb);
        }
    }
    if (exit_callback) |cb| {
        if (cb.isCell() and cb.isCallable()) {
            js.gc.set(.exit, this_value, globalObject, cb);
        }
    }
    if (drain_callback) |cb| {
        if (cb.isCell() and cb.isCallable()) {
            js.gc.set(.drain, this_value, globalObject, cb);
        }
    }

    return terminal;
}

/// Options for creating a Terminal from Bun.spawn
pub const SpawnTerminalOptions = struct {
    cols: u16 = 80,
    rows: u16 = 24,
    term_name: ?jsc.ZigString.Slice = null,
    data_callback: ?JSValue = null,
    exit_callback: ?JSValue = null,
    drain_callback: ?JSValue = null,
};

/// Result from creating a Terminal from spawn
pub const SpawnTerminalResult = struct {
    terminal: *Terminal,
    js_value: jsc.JSValue,
};

/// Create a Terminal from Bun.spawn options (not from JS constructor)
/// Returns the Terminal and its JS wrapper value
/// The slave_fd should be used for the subprocess's stdin/stdout/stderr
pub fn createFromSpawn(
    globalObject: *jsc.JSGlobalObject,
    options: SpawnTerminalOptions,
) !SpawnTerminalResult {
    // Get term_name from slice or use default
    const term_name_slice = if (options.term_name) |slice| slice.slice() else "xterm-256color";
    // Duplicate term_name since we need to own it
    const term_name = bun.default_allocator.dupe(u8, term_name_slice) catch {
        if (options.term_name) |slice| slice.deinit();
        return error.OutOfMemory;
    };
    // Free the slice now that we've duped it
    if (options.term_name) |slice| slice.deinit();

    // Create PTY - free term_name on failure since Terminal won't own it
    const pty_result = createPty(options.cols, options.rows) catch |err| {
        bun.default_allocator.free(term_name);
        return err;
    };

    // After this point, Terminal owns term_name and will free it in deinit()
    const terminal = bun.new(Terminal, .{
        // 3 refs: JS side, reader, writer
        .ref_count = .initExactRefs(3),
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

    // Start writer with the write fd
    switch (terminal.writer.start(pty_result.write_fd, true)) {
        .result => {},
        .err => {
            // Writer never started - manually release all 3 refs (JS, reader, writer)
            // since no callbacks will fire
            terminal.deref(); // JS ref
            terminal.deref(); // reader ref
            terminal.deref(); // writer ref
            return error.WriterStartFailed;
        },
    }

    // Start reader with the read fd
    switch (terminal.reader.start(pty_result.read_fd, true)) {
        .err => {
            // Reader never started but writer was started
            // Close writer (will trigger onWriterDone -> deref for writer's ref)
            terminal.writer.close();
            // Manually release JS and reader refs
            terminal.deref(); // JS ref
            terminal.deref(); // reader ref
            return error.ReaderStartFailed;
        },
        .result => {
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

    // Create the JS wrapper using toJS (this creates the JSTerminal)
    const this_value = terminal.toJS(globalObject);

    // Store the this_value (JSValue wrapper) - start with weak ref
    terminal.this_value = jsc.JSRef.initWeak(this_value);

    // Store callbacks via generated gc setters (prevents GC of callbacks while terminal is alive)
    if (options.data_callback) |cb| {
        if (cb.isCell() and cb.isCallable()) {
            js.gc.set(.data, this_value, globalObject, cb);
        }
    }
    if (options.exit_callback) |cb| {
        if (cb.isCell() and cb.isCallable()) {
            js.gc.set(.exit, this_value, globalObject, cb);
        }
    }
    if (options.drain_callback) |cb| {
        if (cb.isCell() and cb.isCallable()) {
            js.gc.set(.drain, this_value, globalObject, cb);
        }
    }

    return .{ .terminal = terminal, .js_value = this_value };
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

    // Disable ECHO on the slave fd by default.
    // This prevents input written to the master from being echoed back.
    // Programs that need echo (like interactive shells for user input) will enable it.
    if (std.posix.tcgetattr(slave_fd)) |termios| {
        var new_termios = termios;
        // Disable ECHO - prevents written input from being echoed back
        new_termios.lflag.ECHO = false;
        // Keep ICANON enabled for line-buffered input (programs can disable if needed)
        std.posix.tcsetattr(slave_fd, .NOW, new_termios) catch {};
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

/// Get the stdout file descriptor (master PTY fd)
pub fn getStdout(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    if (this.flags.closed) {
        return JSValue.jsNumber(-1);
    }
    return JSValue.jsNumber(this.master_fd.uv());
}

/// Get the stdin file descriptor (slave PTY fd - used by child processes)
/// Returns -1 if closed or if slave_fd was closed (e.g., after spawn integration)
pub fn getStdin(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    if (this.flags.closed or this.slave_fd == bun.invalid_fd) {
        return JSValue.jsNumber(-1);
    }
    return JSValue.jsNumber(this.slave_fd.uv());
}

/// Check if terminal is closed
pub fn getClosed(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.flags.closed);
}

/// Helper to convert termios flag to u32 (handles both 32-bit Linux and 64-bit macOS)
fn termiosFlagToU32(comptime T: type, flag: T) u32 {
    // On macOS, termios flags are c_ulong (64-bit), on Linux they are packed structs
    const Int = @typeInfo(T).@"struct".backing_integer orelse @compileError("expected packed struct");
    const int_value: Int = @bitCast(flag);
    return @truncate(int_value);
}

/// Helper to convert u32 to termios flag type, preserving upper bits from current value
/// On macOS, termios flags are 64-bit so we need to preserve upper bits when setting
fn u32ToTermiosFlag(comptime T: type, value: u32, current: T) T {
    const Int = @typeInfo(T).@"struct".backing_integer orelse @compileError("expected packed struct");
    const current_int: Int = @bitCast(current);
    // Mask off lower 32 bits and replace with new value, preserving upper bits
    const upper_bits = current_int & ~@as(Int, 0xFFFFFFFF);
    const new_value: Int = upper_bits | @as(Int, value);
    return @bitCast(new_value);
}

/// Get input flags (c_iflag) - returns 0 if closed or error
pub fn getInputFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    if (comptime !Environment.isPosix) return JSValue.jsNumber(0);
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return JSValue.jsNumber(0);
    }
    const termios_data = getTermios(this.master_fd) orelse return JSValue.jsNumber(0);
    return JSValue.jsNumber(termiosFlagToU32(@TypeOf(termios_data.iflag), termios_data.iflag));
}

/// Set input flags (c_iflag)
pub fn setInputFlags(this: *Terminal, _: *jsc.JSGlobalObject, value: JSValue) void {
    if (comptime !Environment.isPosix) return;
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return;
    }
    var termios_data = getTermios(this.master_fd) orelse return;
    termios_data.iflag = u32ToTermiosFlag(@TypeOf(termios_data.iflag), value.toU32(), termios_data.iflag);
    _ = setTermios(this.master_fd, &termios_data);
}

/// Get output flags (c_oflag) - returns 0 if closed or error
pub fn getOutputFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    if (comptime !Environment.isPosix) return JSValue.jsNumber(0);
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return JSValue.jsNumber(0);
    }
    const termios_data = getTermios(this.master_fd) orelse return JSValue.jsNumber(0);
    return JSValue.jsNumber(termiosFlagToU32(@TypeOf(termios_data.oflag), termios_data.oflag));
}

/// Set output flags (c_oflag)
pub fn setOutputFlags(this: *Terminal, _: *jsc.JSGlobalObject, value: JSValue) void {
    if (comptime !Environment.isPosix) return;
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return;
    }
    var termios_data = getTermios(this.master_fd) orelse return;
    termios_data.oflag = u32ToTermiosFlag(@TypeOf(termios_data.oflag), value.toU32(), termios_data.oflag);
    _ = setTermios(this.master_fd, &termios_data);
}

/// Get local flags (c_lflag) - returns 0 if closed or error
pub fn getLocalFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    if (comptime !Environment.isPosix) return JSValue.jsNumber(0);
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return JSValue.jsNumber(0);
    }
    const termios_data = getTermios(this.master_fd) orelse return JSValue.jsNumber(0);
    return JSValue.jsNumber(termiosFlagToU32(@TypeOf(termios_data.lflag), termios_data.lflag));
}

/// Set local flags (c_lflag)
pub fn setLocalFlags(this: *Terminal, _: *jsc.JSGlobalObject, value: JSValue) void {
    if (comptime !Environment.isPosix) return;
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return;
    }
    var termios_data = getTermios(this.master_fd) orelse return;
    termios_data.lflag = u32ToTermiosFlag(@TypeOf(termios_data.lflag), value.toU32(), termios_data.lflag);
    _ = setTermios(this.master_fd, &termios_data);
}

/// Get control flags (c_cflag) - returns 0 if closed or error
pub fn getControlFlags(this: *Terminal, _: *jsc.JSGlobalObject) JSValue {
    if (comptime !Environment.isPosix) return JSValue.jsNumber(0);
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return JSValue.jsNumber(0);
    }
    const termios_data = getTermios(this.master_fd) orelse return JSValue.jsNumber(0);
    return JSValue.jsNumber(termiosFlagToU32(@TypeOf(termios_data.cflag), termios_data.cflag));
}

/// Set control flags (c_cflag)
pub fn setControlFlags(this: *Terminal, _: *jsc.JSGlobalObject, value: JSValue) void {
    if (comptime !Environment.isPosix) return;
    if (this.flags.closed or this.master_fd == bun.invalid_fd) {
        return;
    }
    var termios_data = getTermios(this.master_fd) orelse return;
    termios_data.cflag = u32ToTermiosFlag(@TypeOf(termios_data.cflag), value.toU32(), termios_data.cflag);
    _ = setTermios(this.master_fd, &termios_data);
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
        .err => |err| globalObject.throwValue(err.toJS(globalObject)),
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
    bun.default_allocator.free(this.term_name);
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
