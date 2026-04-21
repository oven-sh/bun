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
/// On Windows this is always invalid_fd; ConPTY uses hpcon for control.
master_fd: bun.FD,

/// Duplicated master fd for reading (POSIX) / overlapped read pipe end (Windows)
read_fd: bun.FD,

/// Duplicated master fd for writing (POSIX) / overlapped write pipe end (Windows)
write_fd: bun.FD,

/// The slave side of the PTY (used by child processes). Unused on Windows.
slave_fd: bun.FD,

/// Windows ConPTY handle. Used for resize and passed to uv_spawn via
/// uv_process_options_t.pseudoconsole.
hpcon: if (Environment.isWindows) ?bun.windows.HPCON else void = if (Environment.isWindows) null else {},

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
        errdefer options.deinit();

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
    /// term_name ownership is transferred to the Terminal struct on success or
    /// any error after createPty; cleared in-place once moved.
    options: *Options,
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
    // Ownership moves to the struct below; clear so caller's options.deinit()
    // doesn't double-free on the WriterStartFailed/ReaderStartFailed paths.
    options.term_name = .{};

    const terminal = bun.new(Terminal, .{
        .ref_count = .init(),
        .master_fd = pty_result.master,
        .read_fd = pty_result.read_fd,
        .write_fd = pty_result.write_fd,
        .slave_fd = pty_result.slave,
        .hpcon = if (comptime Environment.isWindows) pty_result.hpcon else {},
        .cols = if (Environment.isWindows) @intCast(clampToCoord(options.cols)) else options.cols,
        .rows = if (Environment.isWindows) @intCast(clampToCoord(options.rows)) else options.rows,
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
        .err => {
            // POSIX: writer.start() may have allocated a poll holding write_fd
            // before registerWithFd failed; closeInternal → writer.close()
            // frees the poll and closes write_fd. Windows: writer.start()
            // failure leaves source==null so writer.close() is a no-op; close
            // write_fd directly. Pre-set writer_done so onWriterClose's deref
            // is skipped and the struct isn't freed mid-closeInternal.
            terminal.flags.writer_done = true;
            terminal.read_fd.close();
            terminal.read_fd = bun.invalid_fd;
            if (comptime Environment.isWindows) {
                terminal.write_fd.close();
                terminal.write_fd = bun.invalid_fd;
            }
            terminal.closeInternal();
            terminal.deref();
            return error.WriterStartFailed;
        },
    }

    // Start reader with the read fd - adds a ref
    switch (terminal.reader.start(pty_result.read_fd, true)) {
        .err => {
            // Reader never started: closeInternal skips reader.close() but
            // runs writer.close() → onWriterClose → deref (2→1). Then drop
            // the initial ref (1→0).
            terminal.read_fd.close();
            terminal.read_fd = bun.invalid_fd;
            terminal.closeInternal();
            terminal.deref();
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

    // Store the this_value (JSValue wrapper) - start with strong ref since we're actively reading.
    // The JS-side ref is the one taken by RefCount.init() above; released in finalize().
    terminal.this_value = jsc.JSRef.initStrong(this_value, globalObject);

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

    const result = initTerminal(globalObject, &options, this_value) catch |err| {
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
    options: *Options,
) InitError!CreateResult {
    return initTerminal(globalObject, options, null);
}

/// Get the slave fd for subprocess to use
pub fn getSlaveFd(this: *Terminal) bun.FD {
    return this.slave_fd;
}

/// Windows: get the ConPTY handle to pass to uv_spawn via
/// uv_process_options_t.pseudoconsole.
pub fn getPseudoconsole(this: *Terminal) ?bun.windows.HPCON {
    if (comptime !Environment.isWindows) return null;
    return this.hpcon;
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

/// Windows: close only the ConPTY handle so conhost releases its pipe ends and
/// our reader observes EOF. Leaves the Terminal itself open (closed=false),
/// matching POSIX semantics where child exit delivers EOF without closing the
/// master fd.
pub fn closePseudoconsole(this: *Terminal) void {
    if (comptime !Environment.isWindows) return;
    if (this.hpcon) |hpcon| {
        this.hpcon = null;
        this.closePseudoconsoleOffThread(hpcon);
    }
}

/// On Windows < 11 24H2, ClosePseudoConsole blocks until the output pipe is
/// drained. Our reader runs on the event-loop thread, so calling it there
/// deadlocks. Fire from a detached thread so the event loop keeps draining;
/// conhost completes its flush and our reader sees the final data then EOF.
/// hpcon is passed to the thread by value so the Terminal struct may be freed
/// before the thread completes.
fn closePseudoconsoleOffThread(this: *Terminal, hpcon: bun.windows.HPCON) void {
    if (comptime !Environment.isWindows) return;
    const Runner = struct {
        fn run(h: bun.windows.HPCON) void {
            bun.windows.ClosePseudoConsole(h);
        }
    };
    const t = std.Thread.spawn(.{ .stack_size = 64 * 1024 }, Runner.run, .{hpcon}) catch {
        // CreateThread failed — the process is in a bad state. Close the
        // reader so onReaderDone fires (releasing the reader ref and firing
        // the exit callback) instead of hanging on an EOF that will never
        // come. Then call ClosePseudoConsole sync; with our pipe end closed
        // conhost sees broken-pipe and returns without blocking.
        if (this.flags.reader_started and !this.flags.reader_done) this.reader.close();
        bun.windows.ClosePseudoConsole(hpcon);
        return;
    };
    t.detach();
}

const PtyResult = struct {
    master: bun.FD,
    read_fd: bun.FD,
    write_fd: bun.FD,
    slave: bun.FD,
    hpcon: if (Environment.isWindows) bun.windows.HPCON else void,
};

const CreatePtyError = error{ OpenPtyFailed, DupFailed, NotSupported };

fn createPty(cols: u16, rows: u16) CreatePtyError!PtyResult {
    if (comptime Environment.isPosix) {
        return createPtyPosix(cols, rows);
    }
    if (comptime Environment.isWindows) {
        return createPtyWindows(cols, rows);
    }
    return error.NotSupported;
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
        .hpcon = {},
    };
}

/// Create one end of a pipe pair as an overlapped named pipe (server) and the
/// other as a synchronous client. Returns both raw HANDLEs. Caller closes
/// both on error. The "server" end is suitable for libuv (uv_pipe_open) and
/// the "client" end is suitable for ConPTY (which uses synchronous I/O).
fn createOverlappedPipePair(
    /// PIPE_ACCESS_INBOUND: server reads, client writes.
    /// PIPE_ACCESS_OUTBOUND: server writes, client reads.
    server_access: u32,
) CreatePtyError!struct { server: bun.windows.HANDLE, client: bun.windows.HANDLE } {
    const w = bun.windows;
    const k32 = std.os.windows.kernel32;
    const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x00080000;

    const pid: u32 = std.os.windows.GetCurrentProcessId();
    const counter = pipe_serial.fetchAdd(1, .monotonic);
    var name_utf8_buf: [96]u8 = undefined;
    const name = std.fmt.bufPrint(
        &name_utf8_buf,
        "\\\\.\\pipe\\bun-conpty-{d}-{d}",
        .{ pid, counter },
    ) catch return error.OpenPtyFailed;
    var name_w_buf: [96:0]u16 = undefined;
    const name_w_len = bun.strings.convertUTF8toUTF16InBuffer(&name_w_buf, name).len;
    name_w_buf[name_w_len] = 0;
    const name_w = name_w_buf[0..name_w_len :0];

    const server = k32.CreateNamedPipeW(
        name_w,
        server_access | std.os.windows.FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        std.os.windows.PIPE_TYPE_BYTE | std.os.windows.PIPE_READMODE_BYTE | std.os.windows.PIPE_WAIT,
        1,
        65536,
        65536,
        0,
        null,
    );
    if (server == w.INVALID_HANDLE_VALUE) return error.OpenPtyFailed;
    errdefer _ = w.CloseHandle(server);

    const client_access: u32 = if (server_access == std.os.windows.PIPE_ACCESS_INBOUND)
        std.os.windows.GENERIC_WRITE
    else
        std.os.windows.GENERIC_READ;

    const client = k32.CreateFileW(
        name_w,
        client_access,
        0,
        null,
        std.os.windows.OPEN_EXISTING,
        0,
        null,
    );
    if (client == w.INVALID_HANDLE_VALUE) return error.OpenPtyFailed;

    return .{ .server = server, .client = client };
}

var pipe_serial = std.atomic.Value(u32).init(0);

fn createPtyWindows(cols: u16, rows: u16) CreatePtyError!PtyResult {
    const w = bun.windows;

    // Track ownership explicitly: handles are nulled out as they are closed or
    // transferred so the errdefer cleanup never double-closes.
    var out_server: ?w.HANDLE = null;
    var out_client: ?w.HANDLE = null;
    var in_server: ?w.HANDLE = null;
    var in_client: ?w.HANDLE = null;
    var hpcon: ?w.HPCON = null;
    errdefer {
        if (hpcon) |h| w.ClosePseudoConsole(h);
        if (out_server) |h| _ = w.CloseHandle(h);
        if (out_client) |h| _ = w.CloseHandle(h);
        if (in_server) |h| _ = w.CloseHandle(h);
        if (in_client) |h| _ = w.CloseHandle(h);
    }

    // Output pipe: ConPTY writes (client), we read (overlapped server).
    {
        const pair = try createOverlappedPipePair(std.os.windows.PIPE_ACCESS_INBOUND);
        out_server = pair.server;
        out_client = pair.client;
    }

    // Input pipe: we write (overlapped server), ConPTY reads (client).
    {
        const pair = try createOverlappedPipePair(std.os.windows.PIPE_ACCESS_OUTBOUND);
        in_server = pair.server;
        in_client = pair.client;
    }

    const size = w.COORD{ .X = clampToCoord(cols), .Y = clampToCoord(rows) };
    {
        var pc: w.HPCON = undefined;
        if (w.CreatePseudoConsole(size, in_client.?, out_client.?, 0, &pc) < 0)
            return error.OpenPtyFailed;
        hpcon = pc;
    }

    // ConPTY duplicated the client handles internally; close our copies.
    _ = w.CloseHandle(in_client.?);
    in_client = null;
    _ = w.CloseHandle(out_client.?);
    out_client = null;

    // Wrap server (overlapped) ends as libuv-owned FDs so they can be passed
    // to BufferedReader/StreamingWriter.start() which calls uv_pipe_open.
    const read_fd = bun.FD.fromNative(out_server.?).makeLibUVOwned() catch return error.DupFailed;
    out_server = null;
    errdefer read_fd.close();

    const write_fd = bun.FD.fromNative(in_server.?).makeLibUVOwned() catch return error.DupFailed;
    in_server = null;

    const result_hpcon = hpcon.?;
    hpcon = null;

    return PtyResult{
        .master = bun.invalid_fd,
        .read_fd = read_fd,
        .write_fd = write_fd,
        .slave = bun.invalid_fd,
        .hpcon = result_hpcon,
    };
}

/// COORD.X/Y are i16; clamp the u16 cols/rows to its range.
inline fn clampToCoord(v: u16) i16 {
    return @intCast(@min(v, std.math.maxInt(i16)));
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
        // On Windows the streaming writer buffers and returns .pending=0; the
        // bytes were accepted, so report bytes.len to match POSIX semantics.
        .pending => |amt| JSValue.jsNumber(@as(i32, @intCast(if (Environment.isWindows) bytes.len else amt))),
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

    if (comptime Environment.isWindows) {
        if (this.hpcon) |hpcon| {
            const size = bun.windows.COORD{ .X = clampToCoord(new_cols), .Y = clampToCoord(new_rows) };
            const hr = bun.windows.ResizePseudoConsole(hpcon, size);
            if (hr < 0) {
                return globalObject.throw("Failed to resize terminal", .{});
            }
        }
    }

    this.cols = if (Environment.isWindows) @intCast(clampToCoord(new_cols)) else new_cols;
    this.rows = if (Environment.isWindows) @intCast(clampToCoord(new_rows)) else new_rows;

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
        const tty_result = bun.tty.setMode(this.master_fd.cast(), if (enabled) .raw else .normal);
        if (tty_result != 0) {
            return globalObject.throw("Failed to set raw mode", .{});
        }
    }

    this.flags.raw_mode = enabled;
    return .js_undefined;
}
/// POSIX termios struct for terminal flags manipulation
const Termios = if (Environment.isPosix) std.posix.termios else void;

/// Get terminal attributes using tcgetattr
fn getTermios(fd: bun.FD) ?Termios {
    if (comptime !Environment.isPosix) return null;
    return std.posix.tcgetattr(fd.cast()) catch null;
}

/// Set terminal attributes using tcsetattr (TCSANOW = immediate)
fn setTermios(fd: bun.FD, termios_p: *const Termios) bool {
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
    // After dispose the caller must not see further data/exit callbacks.
    // closeInternal on Windows leaves the reader draining off-thread, so
    // suppress callbacks and downgrade the JSRef so the wrapper is
    // GC-eligible once the caller's reference is dropped.
    this.this_value.downgrade();
    this.flags.finalized = true;
    this.closeInternal();
    return jsc.JSPromise.resolvedPromiseValue(globalObject, .js_undefined);
}

pub fn closeInternal(this: *Terminal) void {
    if (this.flags.closed) return;
    this.flags.closed = true;

    // Close writer (closes write_fd)
    this.writer.close();
    this.write_fd = bun.invalid_fd;

    if (comptime Environment.isWindows) {
        // Dispatch ClosePseudoConsole off-thread (it blocks until the output
        // pipe is drained on Windows < 11 24H2) and leave the reader open so
        // the event loop can keep draining; conhost flushes the final frame,
        // closes its pipe end, and the reader observes EOF → onReaderDone.
        if (this.hpcon) |hpcon| {
            this.hpcon = null;
            this.closePseudoconsoleOffThread(hpcon);
        }
        // Reader stays open even if hpcon was already null (closePseudoconsole
        // may have dispatched it earlier); onReaderDone closes on EOF.
        if (this.flags.reader_started and !this.flags.reader_done) return;
    }

    // Close reader (closes read_fd)
    if (this.flags.reader_started) {
        this.reader.close();
    }
    this.read_fd = bun.invalid_fd;

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

    if (this.flags.finalized) return true;

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
