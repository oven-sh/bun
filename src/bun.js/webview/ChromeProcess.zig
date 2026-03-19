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
//! Two unidirectional pipes, not one socketpair. DevToolsPipeHandler
//! (content/browser/devtools/devtools_pipe_handler.cc) does plain read(3)
//! on a dedicated thread and write(4) from the IO thread — mixing them on
//! one fd works but isn't what Chrome expects.

const ChromeProcess = @This();

process: *bun.spawn.Process,
/// Parent writes here → Chrome fd 3 reads. usockets doesn't handle write-
/// only fds well; C++ writes directly with write() + EAGAIN queue.
write_fd: bun.FileDescriptor,
/// Parent reads here ← Chrome fd 4 writes. Adopted into usockets for the
/// onData callback — same pattern as HostClient's socket.
read_fd: bun.FileDescriptor,

var instance: ?*ChromeProcess = null;

/// Lazy: first `new Bun.WebView({ backend: "chrome" })` or first target
/// create calls this via C++. Returns {write_fd, read_fd} packed as i64
/// (high 32 write, low 32 read), or -1 on spawn failure. Idempotent.
pub export fn Bun__Chrome__ensure(global: *jsc.JSGlobalObject, userDataDir: ?[*:0]const u8) i64 {
    if (instance) |i| return pack(i.write_fd, i.read_fd);

    instance = spawn(global.bunVM(), userDataDir) catch |err| {
        log("spawn failed: {s}", .{@errorName(err)});
        return -1;
    };
    return pack(instance.?.write_fd, instance.?.read_fd);
}

fn pack(w: bun.FileDescriptor, r: bun.FileDescriptor) i64 {
    const wi: u32 = @bitCast(w.cast());
    const ri: u32 = @bitCast(r.cast());
    return @bitCast((@as(u64, wi) << 32) | ri);
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
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const chrome = try findChrome(alloc) orelse return error.ChromeNotFound;
    log("using chrome: {s}", .{chrome});

    // Two unidirectional pipes. pipe() gives [read, write]; we keep the
    // end Chrome doesn't, dup2 the other to the child fd.
    //   to_chrome:   parent keeps write (to_chrome[1]), child fd 3 = to_chrome[0]
    //   from_chrome: parent keeps read  (from_chrome[0]), child fd 4 = from_chrome[1]
    const to_chrome = try bun.sys.pipe().unwrap();
    errdefer {
        to_chrome[0].close();
        to_chrome[1].close();
    }
    const from_chrome = try bun.sys.pipe().unwrap();
    errdefer {
        from_chrome[0].close();
        from_chrome[1].close();
    }

    // Parent ends nonblocking — the write side queues on EAGAIN, the read
    // side goes into usockets. Child ends stay blocking; Chrome's pipe
    // handler does blocking read(3) on a dedicated thread.
    try bun.sys.setNonblocking(to_chrome[1]).unwrap();
    try bun.sys.setNonblocking(from_chrome[0]).unwrap();

    // Minimal flags. --remote-debugging-pipe is the one that matters;
    // --headless=new uses the real browser with no UI (not the legacy
    // headless_shell compositor). --no-first-run / --no-default-browser-check
    // skip modal prompts that would block startup on a fresh profile.
    var argv: std.ArrayListUnmanaged(?[*:0]const u8) = .{};
    try argv.append(alloc, chrome.ptr);
    try argv.append(alloc, "--remote-debugging-pipe");
    try argv.append(alloc, "--headless=new");
    try argv.append(alloc, "--no-first-run");
    try argv.append(alloc, "--no-default-browser-check");
    try argv.append(alloc, "--disable-gpu"); // headless CI has no GPU context
    // --user-data-dir is per-Chrome-process; all views share the dir. The
    // only impedance mismatch vs WKWebView (where dataStore is per-view).
    if (userDataDir) |dir| {
        const flag = try std.fmt.allocPrintSentinel(alloc, "--user-data-dir={s}", .{dir}, 0);
        try argv.append(alloc, flag.ptr);
    } else {
        // Fresh ephemeral profile in a throwaway dir. Chrome won't start
        // without SOME user-data-dir; an empty one keeps it ephemeral.
        const tmp = try std.fmt.allocPrintSentinel(alloc, "--user-data-dir=/tmp/bun-chrome-{d}", .{std.c.getpid()}, 0);
        try argv.append(alloc, tmp.ptr);
    }
    try argv.append(alloc, null);

    const env = try vm.transpiler.env.map.createNullDelimitedEnvMap(alloc);

    var opts: bun.spawn.SpawnOptions = .{
        .stdin = .ignore,
        .stdout = .inherit,
        .stderr = .inherit,
        // fd 3 = to_chrome[0] (Chrome reads), fd 4 = from_chrome[1] (Chrome writes)
        .extra_fds = &.{ .{ .pipe = to_chrome[0] }, .{ .pipe = from_chrome[1] } },
        .argv0 = chrome.ptr,
    };

    var spawned = try (try bun.spawn.spawnProcess(
        &opts,
        @ptrCast(argv.items.ptr),
        @ptrCast(env.ptr),
    )).unwrap();

    // Parent doesn't need the child's ends. spawnProcess dup2'd them into
    // the child; these copies are dead weight that keep the pipe open past
    // Chrome's death otherwise.
    to_chrome[0].close();
    from_chrome[1].close();

    const self = bun.new(ChromeProcess, .{
        .process = spawned.toProcess(vm.eventLoop(), false),
        .write_fd = to_chrome[1],
        .read_fd = from_chrome[0],
    });
    self.process.setExitHandler(self);
    switch (self.process.watch()) {
        .result => {
            // Same weak-handle reasoning as HostProcess: parent exit →
            // Chrome's fd 3 EOFs → DevToolsPipeHandler::Shutdown → exit.
            self.process.disableKeepingEventLoopAlive();
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
