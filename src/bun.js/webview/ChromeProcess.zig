//! Spawns Chrome/Chromium with --remote-debugging-pipe. The child reads CDP
//! JSON from fd 3 and writes replies to fd 4 (NUL-delimited). No separate
//! host process — Chrome IS the IPC peer. One fewer hop than WKWebView.
//!
//! Parent death → Chrome's pipe read EOFs → Chrome exits. Same lifetime
//! coupling as HostProcess.zig's socket EOF path.
//!
//! fd layout (child):
//!   3 = Chrome reads CDP commands from us  (parent writes → child reads)
//!   4 = Chrome writes CDP replies to us    (child writes  → parent reads)
//!
//! One socketpair, the child end dup'd to BOTH fd 3 and fd 4. Chrome's
//! DevToolsPipeHandler does read(3) and write(4) — it doesn't care that
//! both fds point at the same socket. usockets' bsd_recv() calls recv()
//! which fails ENOTSOCK on a pipe fd (the earlier two-pipes layout broke
//! here: recv(readFd) returned -1 → loop treated as close → onClose fired
//! before any data); socketpair gives us a proper socket for the read path
//! and the write path can share it.

const ChromeProcess = @This();

process: *bun.spawn.Process,
/// Parent's socketpair end. Bidirectional — writes here go to Chrome's
/// fd 3 (read), reads here come from Chrome's fd 4 (write). Adopted into
/// usockets for onData; writes go through writeRaw with direct write().
fd: bun.FileDescriptor,

var instance: ?*ChromeProcess = null;

/// Bun__atexit-registered: SIGKILL Chrome if still alive at process exit.
/// Chrome spawns its own renderer/gpu/utility children (a Chrome "process
/// model" zygote tree); they're tracked by Chrome's own ProcessSingleton
/// and exit when the browser process dies. SIGKILL here takes the browser
/// process, the zygote tree follows.
fn killOnExit() callconv(.c) void {
    if (instance) |i| {
        _ = i.process.kill(9);
    }
}

/// Lazy: first `new Bun.WebView({ backend: "chrome" })` or first target
/// create calls this via C++. Returns {write_fd, read_fd} packed as i64
/// (high 32 write, low 32 read), or -1 on spawn failure. Idempotent.
///
/// Windows TODO — fd.cast() returns a HANDLE there, and pipe() / fcntl
/// nonblocking have no direct equivalents. The spawn would need to use
/// named pipes or libuv. For now -1 and C++ throws not-implemented.
pub export fn Bun__Chrome__ensure(global: *jsc.JSGlobalObject, userDataDir: ?[*:0]const u8) i32 {
    if (comptime bun.Environment.isWindows) return -1;
    if (instance) |i| return i.fd.cast();

    instance = spawn(global.bunVM(), userDataDir) catch |err| {
        log("spawn failed: {s}", .{@errorName(err)});
        return -1;
    };
    return instance.?.fd.cast();
}

pub fn onProcessExit(this: *ChromeProcess, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
    log("chrome exited: {f}", .{status});
    const signo: i32 = if (status.signalCode()) |sig| @intFromEnum(sig) else 0;
    Bun__Chrome__died(signo);
    this.process.deref();
    bun.destroy(this);
    instance = null;
}

/// Auto-detect the Chrome binary. chrome-headless-shell is the ~100MB
/// stripped variant (no GPU compositor, no extensions) — ships with
/// puppeteer/playwright installs. Falls through to the full app bundles.
fn findChrome(alloc: std.mem.Allocator) !?[:0]const u8 {
    // Env override first — lets tests pin a specific binary.
    if (std.process.getEnvVarOwned(alloc, "BUN_CHROME_PATH")) |p| {
        return try alloc.dupeZ(u8, p);
    } else |_| {}

    const candidates = if (comptime bun.Environment.isMac) [_][]const u8{
        // Playwright/puppeteer cache — most likely on a dev box.
        "~/.cache/ms-playwright/chromium_headless_shell-*/chrome-mac/headless_shell",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    } else if (comptime bun.Environment.isLinux) [_][]const u8{
        "~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
    } else [_][]const u8{};

    // Glob expansion for the playwright cache path is TODO — the version
    // suffix changes per install. App-bundle paths cover the common case.
    for (candidates) |c| {
        // Star in path → glob. Skip for now.
        if (bun.strings.indexOfChar(c, '*')) |_| continue;

        var expanded_buf: bun.PathBuffer = undefined;
        const expanded: [:0]const u8 = if (c[0] == '~') blk: {
            const home = std.process.getEnvVarOwned(alloc, "HOME") catch continue;
            defer alloc.free(home);
            const parts = [_][]const u8{ home, c[2..] };
            break :blk bun.path.joinStringBufZ(&expanded_buf, &parts, .auto);
        } else blk: {
            @memcpy(expanded_buf[0..c.len], c);
            expanded_buf[c.len] = 0;
            break :blk expanded_buf[0..c.len :0];
        };

        switch (bun.sys.stat(expanded)) {
            .result => return try alloc.dupeZ(u8, expanded),
            .err => continue,
        }
    }
    return null;
}

fn spawn(vm: *jsc.VirtualMachine, userDataDir: ?[*:0]const u8) !*ChromeProcess {
    if (comptime bun.Environment.isWindows) return error.Unsupported;

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const chrome = try findChrome(alloc) orelse return error.ChromeNotFound;
    log("using chrome: {s}", .{chrome});

    // One socketpair. Parent keeps fds[0], child gets fds[1] dup'd to BOTH
    // fd 3 and fd 4. Chrome read(3)'s commands and write(4)'s replies —
    // both hit the same socket. Parent end nonblocking so usockets recv
    // returns EAGAIN; child end BLOCKING for Chrome's dedicated-thread
    // read loop. O_NONBLOCK lives on the open file description (shared
    // across dup2), so set it on fds[0] only — fds[0] and fds[1] are two
    // different descriptions (peer sockets), the flag isn't shared across.
    const fds = try bun.sys.socketpair(
        std.posix.AF.UNIX,
        std.posix.SOCK.STREAM,
        0,
        .blocking,
    ).unwrap();
    errdefer {
        fds[0].close();
        fds[1].close();
    }
    try bun.sys.setNonblocking(fds[0]).unwrap();

    // Minimal flags. --remote-debugging-pipe is the one that matters;
    // --headless=new uses the real browser with no UI (not the legacy
    // headless_shell compositor). --no-first-run / --no-default-browser-check
    // skip modal prompts that would block startup on a fresh profile.
    //
    // --user-data-dir MUST precede --remote-debugging-pipe in argv. Chrome's
    // CommandLine::Init stops at the first -- after argv[0] on some builds;
    // order-insensitive on most, but --user-data-dir-first is the defensive
    // layout every headless harness uses. Without it, ProcessSingleton locks
    // the default profile (~/Library/Application Support/Google/Chrome) and
    // aborts if a real Chrome is already running.
    const dataDir = if (userDataDir) |d|
        try std.fmt.allocPrintSentinel(alloc, "--user-data-dir={s}", .{d}, 0)
    else blk: {
        // pid_t → u32 cast so {d} formats. Fresh dir per parent process;
        // multiple Bun.WebView instances in one process share the Chrome.
        const pid: u32 = @intCast(std.c.getpid());
        break :blk try std.fmt.allocPrintSentinel(alloc, "--user-data-dir=/tmp/bun-chrome-{d}", .{pid}, 0);
    };

    var argv: std.ArrayListUnmanaged(?[*:0]const u8) = .{};
    try argv.append(alloc, chrome.ptr);
    try argv.append(alloc, dataDir.ptr);
    try argv.append(alloc, "--remote-debugging-pipe");
    try argv.append(alloc, "--headless=new");
    try argv.append(alloc, "--no-first-run");
    try argv.append(alloc, "--no-default-browser-check");
    try argv.append(alloc, "--disable-gpu"); // headless CI has no GPU context
    // Enterprise policy can force-install extensions (webRequest spam on
    // stderr). --disable-extensions is best-effort; mandatory extensions
    // may still load. --disable-background-networking shuts up GCM/update.
    try argv.append(alloc, "--disable-extensions");
    try argv.append(alloc, "--disable-background-networking");
    try argv.append(alloc, "--disable-background-timer-throttling");
    try argv.append(alloc, null);

    const env = try vm.transpiler.env.map.createNullDelimitedEnvMap(alloc);

    var opts: bun.spawn.SpawnOptions = .{
        .stdin = .ignore,
        .stdout = .inherit,
        .stderr = .inherit,
        // fd 3 AND fd 4 both point at fds[1]. spawnProcess dup2's each
        // .pipe entry to 3+index; passing the same fd twice gives Chrome
        // the same socket at both positions.
        .extra_fds = &.{ .{ .pipe = fds[1] }, .{ .pipe = fds[1] } },
        .argv0 = chrome.ptr,
    };

    var spawned = try (try bun.spawn.spawnProcess(
        &opts,
        @ptrCast(argv.items.ptr),
        @ptrCast(env.ptr),
    )).unwrap();

    // Parent doesn't need the child's end. POSIX_SPAWN_CLOEXEC_DEFAULT
    // already closed our copy in the child (only fd 3/4 survive the exec);
    // close our reference so Chrome's death EOF's our end.
    fds[1].close();

    const self = bun.new(ChromeProcess, .{
        .process = spawned.toProcess(vm.eventLoop(), false),
        .fd = fds[0],
    });
    self.process.setExitHandler(self);
    switch (self.process.watch()) {
        .result => {
            // Same weak-handle reasoning as HostProcess: parent exit →
            // Chrome's fd 3 EOFs → DevToolsPipeHandler::Shutdown → exit.
            self.process.disableKeepingEventLoopAlive();
            // Belt-and-braces — SIGKILL on Bun exit if Chrome hasn't
            // already exited via pipe EOF.
            bun.Global.addExitCallback(killOnExit);
        },
        .err => |e| {
            log("watch failed: {f}", .{e});
            self.process.deref();
            bun.destroy(self);
            return error.WatchFailed;
        },
    }
    return self;
}

// Implemented in ChromeBackend.cpp. Rejects all pending CDP promises.
extern fn Bun__Chrome__died(signo: i32) void;

const log = bun.Output.scoped(.Chrome, .hidden);

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
