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

/// Lazy: first `new Bun.WebView({ backend: "chrome" })` calls this via
/// C++. Returns the parent's socketpair fd (C++ adopts into usockets and
/// owns it from then on), or -1 on spawn failure / already-running.
/// C++'s Transport::ensureSpawned checks its own m_readSock before calling
/// here, so instance-already-exists → -1 means "you already have the fd,
/// this is a bug" not "spawn failed". We deliberately don't store the fd —
/// usockets owns it; re-returning a fd usockets may have already closed
/// would be a use-after-close.
///
/// Windows TODO — fd.cast() returns a HANDLE there, and pipe() / fcntl
/// nonblocking have no direct equivalents. The spawn would need to use
/// named pipes or libuv. For now -1 and C++ throws not-implemented.
pub export fn Bun__Chrome__ensure(global: *jsc.JSGlobalObject, userDataDir: ?[*:0]const u8) i32 {
    if (comptime bun.Environment.isWindows) return -1;
    if (instance != null) return -1; // C++ already holds the fd

    const fd = spawn(global.bunVM(), userDataDir) catch |err| {
        log("spawn failed: {s}", .{@errorName(err)});
        return -1;
    };
    return fd.cast();
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
/// playwright installs. Falls through to the full app bundles.
///
/// Playwright registry layout (packages/playwright-core/src/server/registry):
///   mac:   ~/Library/Caches/ms-playwright/chromium_headless_shell-<rev>/
///            chrome-headless-shell-mac-<arch>/chrome-headless-shell
///   linux: ~/.cache/ms-playwright/chromium_headless_shell-<rev>/
///            chrome-headless-shell-linux64/chrome-headless-shell
///            (arm64 non-cft builds use chrome-linux/headless_shell instead)
fn findChrome(alloc: std.mem.Allocator) !?[:0]const u8 {
    // Env override first — lets tests pin a specific binary.
    if (std.process.getEnvVarOwned(alloc, "BUN_CHROME_PATH")) |p| {
        return try alloc.dupeZ(u8, p);
    } else |_| {}

    // Playwright cache — readdir for the newest chromium_headless_shell-<rev>.
    // <rev> is numeric and monotonic per Playwright's browsers.json.
    if (findPlaywrightShell(alloc)) |p| return p;

    const candidates = if (comptime bun.Environment.isMac) [_][]const u8{
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    } else if (comptime bun.Environment.isLinux) [_][]const u8{
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
    } else [_][]const u8{};

    for (candidates) |c| {
        var buf: bun.PathBuffer = undefined;
        const z = bun.path.z(c, &buf);
        switch (bun.sys.stat(z)) {
            .result => return try alloc.dupeZ(u8, c),
            .err => continue,
        }
    }
    return null;
}

/// Scan the Playwright cache dir for chromium_headless_shell-<rev> entries,
/// pick the highest rev, stat the binary inside. Returns null if no cache
/// dir, no matching entries, or binary missing.
fn findPlaywrightShell(alloc: std.mem.Allocator) ?[:0]const u8 {
    const home = std.process.getEnvVarOwned(alloc, "HOME") catch return null;
    defer alloc.free(home);

    var dir_buf: bun.PathBuffer = undefined;
    const cache_subpath = if (comptime bun.Environment.isMac)
        "Library/Caches/ms-playwright"
    else
        ".cache/ms-playwright";
    const parts = [_][]const u8{ home, cache_subpath };
    const cache_dir = bun.path.joinStringBufZ(&dir_buf, &parts, .auto);

    const fd = switch (bun.sys.open(cache_dir, bun.O.RDONLY | bun.O.DIRECTORY, 0)) {
        .result => |f| f,
        .err => return null,
    };
    defer fd.close();

    // Scan for chromium_headless_shell-<rev> and track max rev.
    var best_rev: u32 = 0;
    var best_name: [64]u8 = undefined;
    var best_len: usize = 0;
    const prefix = "chromium_headless_shell-";

    var iter = bun.DirIterator.iterate(fd, .u8);
    while (iter.next().unwrap() catch return null) |entry| {
        if (entry.kind != .directory) continue;
        const name = entry.name.slice();
        if (!bun.strings.hasPrefixComptime(name, prefix)) continue;
        const rev_str = name[prefix.len..];
        const rev = std.fmt.parseInt(u32, rev_str, 10) catch continue;
        if (rev > best_rev) {
            best_rev = rev;
            best_len = @min(name.len, best_name.len);
            @memcpy(best_name[0..best_len], name[0..best_len]);
        }
    }
    if (best_rev == 0) return null;

    // Build the binary path. Two possible subdir layouts:
    //   cft:     chrome-headless-shell-<plat>-<arch>/chrome-headless-shell
    //   non-cft: chrome-linux/headless_shell   (linux arm64 only)
    const arch = if (comptime bun.Environment.isAarch64) "arm64" else "x64";
    const plat = if (comptime bun.Environment.isMac) "mac" else "linux";
    const subdir_cft = std.fmt.allocPrint(alloc, "chrome-headless-shell-{s}-{s}/chrome-headless-shell", .{ plat, arch }) catch return null;
    defer alloc.free(subdir_cft);

    var bin_buf: bun.PathBuffer = undefined;
    const bin_parts = [_][]const u8{ cache_dir, best_name[0..best_len], subdir_cft };
    const bin = bun.path.joinStringBufZ(&bin_buf, &bin_parts, .auto);
    switch (bun.sys.stat(bin)) {
        .result => return alloc.dupeZ(u8, bin) catch return null,
        .err => {},
    }

    // Fall back to the non-cft linux arm64 layout.
    if (comptime bun.Environment.isLinux and bun.Environment.isAarch64) {
        const bin_parts2 = [_][]const u8{ cache_dir, best_name[0..best_len], "chrome-linux/headless_shell" };
        const bin2 = bun.path.joinStringBufZ(&bin_buf, &bin_parts2, .auto);
        switch (bun.sys.stat(bin2)) {
            .result => return alloc.dupeZ(u8, bin2) catch return null,
            .err => {},
        }
    }
    return null;
}

fn spawn(vm: *jsc.VirtualMachine, userDataDir: ?[*:0]const u8) !bun.FileDescriptor {
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
    // --headless works on both full Chrome (switches to headless mode) and
    // chrome-headless-shell (no-op, it's already headless). --headless=new
    // breaks chrome-headless-shell (it IS the new headless mode; =new is a
    // full-Chrome-only switch). Playwright passes plain --headless
    // (chromium.js:293).
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
    try argv.append(alloc, "--headless");
    try argv.append(alloc, "--no-first-run");
    try argv.append(alloc, "--no-default-browser-check");
    try argv.append(alloc, "--disable-gpu"); // headless CI has no GPU context
    // Enterprise policy can force-install extensions (webRequest spam on
    // stderr). --disable-extensions is best-effort; mandatory extensions
    // may still load. --disable-background-networking shuts up GCM/update.
    try argv.append(alloc, "--disable-extensions");
    try argv.append(alloc, "--disable-background-networking");
    // Throttling suite (playwright's chromiumSwitches.ts subset). These
    // gate rAF/setTimeout firing when the tab thinks it's backgrounded.
    // A headless target is "occluded" by definition; without these Chrome
    // throttles timers to 1 Hz and pauses rAF entirely.
    try argv.append(alloc, "--disable-background-timer-throttling");
    try argv.append(alloc, "--disable-backgrounding-occluded-windows");
    try argv.append(alloc, "--disable-renderer-backgrounding");
    // CDP message rate limiter — a burst of evaluates/clicks in a test
    // loop hits it otherwise. Playwright and puppeteer both ship this.
    try argv.append(alloc, "--disable-ipc-flooding-protection");
    // No startup window — targets are Target.createTarget'd, not the
    // default about:blank. Saves one tab and the visual-complete wait.
    try argv.append(alloc, "--no-startup-window");
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
            fds[0].close();
            return error.WatchFailed;
        },
    }
    instance = self;
    // fd returned to C++ which adopts it into usockets. Not stored here —
    // usockets owns it; we only own the process lifetime.
    return fds[0];
}

// Implemented in ChromeBackend.cpp. Rejects all pending CDP promises.
extern fn Bun__Chrome__died(signo: i32) void;

const log = bun.Output.scoped(.Chrome, .hidden);

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
