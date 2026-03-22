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

/// Called from WebView.closeAll() and dispatchOnExit. Chrome spawns its own
/// renderer/gpu/utility children (the "process model" zygote tree) — tracked
/// by Chrome's own ProcessSingleton, they exit when the browser process
/// dies. SIGKILL here takes the browser process, the zygote tree follows.
/// The C++ side doesn't touch JS state; EVFILT_PROC → Bun__Chrome__died →
/// rejectAllAndMarkDead handles promise rejection on the next loop tick.
pub export fn Bun__Chrome__kill() void {
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
pub export fn Bun__Chrome__ensure(
    global: *jsc.JSGlobalObject,
    userDataDir: ?[*:0]const u8,
    path: ?[*:0]const u8,
    extraArgv: ?[*]const [*:0]const u8,
    extraArgvLen: u32,
    stdoutInherit: bool,
    stderrInherit: bool,
) i32 {
    if (comptime bun.Environment.isWindows) return -1;
    if (instance != null) return -1; // C++ already holds the fd

    const extra: []const [*:0]const u8 = if (extraArgv) |a| a[0..extraArgvLen] else &.{};
    const fd = spawn(global.bunVM(), userDataDir, path, extra, stdoutInherit, stderrInherit) catch |err| {
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
fn findChrome(alloc: std.mem.Allocator, explicitPath: ?[*:0]const u8) !?[:0]const u8 {
    // Precedence: backend.path > BUN_CHROME_PATH > $PATH > hardcoded > playwright.
    // backend.path is per-Bun.WebView call (first wins — later views reuse
    // the already-spawned Chrome); env var is per-process.
    if (explicitPath) |p| {
        return try alloc.dupeZ(u8, std.mem.span(p));
    }
    if (std.process.getEnvVarOwned(alloc, "BUN_CHROME_PATH")) |p| {
        return try alloc.dupeZ(u8, p);
    } else |_| {}

    const buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(buf);

    // $PATH first — `brew install chromium`, distro packages, manual symlinks
    // all land here. Same precedence as `which` at a shell prompt.
    const path = bun.env_var.PATH.get() orelse "";
    const names = [_][]const u8{
        "google-chrome-stable",
        "google-chrome",
        "chromium-browser",
        "chromium",
        "microsoft-edge",
        "chrome", // brew cask symlink, some CI setups
    };
    for (names) |n| {
        if (bun.which(buf, path, "", n)) |found| {
            return try alloc.dupeZ(u8, found);
        }
    }

    // Hardcoded absolute paths — macOS app bundles aren't in $PATH, and
    // snap on Linux doesn't always export /snap/bin. Signed bundles before
    // Playwright: enterprise endpoint-protection (Gatekeeper, Santa)
    // allowlists notarized bundles but blocks unsigned binaries in cache
    // dirs; Playwright's chrome-headless-shell is unsigned and SIGKILLs at
    // exec on a locked-down dev machine while Chrome.app runs.
    if (comptime bun.Environment.isMac) {
        const bundles = [_][]const u8{
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "Chromium.app/Contents/MacOS/Chromium",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        };
        // /Applications then ~/Applications — per-user installs (non-admin
        // or drag-to-home-folder) land in the latter.
        const home = bun.env_var.HOME.get() orelse "";
        for (bundles) |b| {
            const sys_parts = [_][]const u8{ "/Applications", b };
            const sys = bun.path.joinStringBufZ(buf, &sys_parts, .auto);
            if (bun.sys.isExecutableFilePath(sys)) return try alloc.dupeZ(u8, sys);
            if (home.len > 0) {
                const user_parts = [_][]const u8{ home, "Applications", b };
                const user = bun.path.joinStringBufZ(buf, &user_parts, .auto);
                if (bun.sys.isExecutableFilePath(user)) return try alloc.dupeZ(u8, user);
            }
        }
    } else if (comptime bun.Environment.isLinux) {
        const absolute = [_][:0]const u8{
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/snap/bin/chromium",
            "/usr/bin/microsoft-edge",
        };
        for (absolute) |c| {
            if (bun.sys.isExecutableFilePath(c)) return try alloc.dupeZ(u8, c);
        }
    }

    // Playwright cache — readdir for the newest chromium_headless_shell-<rev>.
    // Last resort: smaller binary (~100MB), but unsigned. CI Linux runners
    // usually have this and nothing else.
    if (findPlaywrightShell(alloc)) |p| return p;

    return null;
}

/// Scan the Playwright cache dir for chromium_headless_shell-<rev> entries,
/// pick the highest rev, stat the binary inside. Returns null if no cache
/// dir, no matching entries, or binary missing.
fn findPlaywrightShell(alloc: std.mem.Allocator) ?[:0]const u8 {
    const home = bun.env_var.HOME.get() orelse return null;

    const dir_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(dir_buf);
    const cache_subpath = if (comptime bun.Environment.isMac)
        "Library/Caches/ms-playwright"
    else
        ".cache/ms-playwright";
    const parts = [_][]const u8{ home, cache_subpath };
    const cache_dir = bun.path.joinStringBufZ(dir_buf, &parts, .auto);

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

    const bin_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(bin_buf);
    const bin_parts = [_][]const u8{ cache_dir, best_name[0..best_len], subdir_cft };
    const bin = bun.path.joinStringBufZ(bin_buf, &bin_parts, .auto);
    if (bun.sys.isExecutableFilePath(bin)) return alloc.dupeZ(u8, bin) catch return null;

    // Fall back to the non-cft linux arm64 layout.
    if (comptime bun.Environment.isLinux and bun.Environment.isAarch64) {
        const bin_parts2 = [_][]const u8{ cache_dir, best_name[0..best_len], "chrome-linux/headless_shell" };
        const bin2 = bun.path.joinStringBufZ(bin_buf, &bin_parts2, .auto);
        if (bun.sys.isExecutableFilePath(bin2)) return alloc.dupeZ(u8, bin2) catch return null;
    }
    return null;
}

fn spawn(vm: *jsc.VirtualMachine, userDataDir: ?[*:0]const u8, explicitPath: ?[*:0]const u8, extraArgv: []const [*:0]const u8, stdoutInherit: bool, stderrInherit: bool) !bun.FileDescriptor {
    if (comptime bun.Environment.isWindows) return error.Unsupported;

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const chrome = try findChrome(alloc, explicitPath) orelse return error.ChromeNotFound;
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
    // User extras last so they can override built-in flags (Chrome's
    // CommandLine last-wins for duplicate switches). Memory is the caller's
    // CString Vector — lives until Bun__Chrome__ensure returns, after which
    // posix_spawn has copied argv into the child.
    for (extraArgv) |a| try argv.append(alloc, a);
    try argv.append(alloc, null);

    const env = try vm.transpiler.env.map.createNullDelimitedEnvMap(alloc);

    var opts: bun.spawn.SpawnOptions = .{
        .stdin = .ignore,
        .stdout = if (stdoutInherit) .inherit else .ignore,
        .stderr = if (stderrInherit) .inherit else .ignore,
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
            // dispatchOnExit also SIGKILLs via Bun__Chrome__kill.
            self.process.disableKeepingEventLoopAlive();
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

// --- /json/version discovery ------------------------------------------------
// When the user passes backend.url as a bare host:port (or http://) instead
// of the full ws://.../devtools/browser/<id>, we GET /json/version to read
// webSocketDebuggerUrl. Chrome's Remote Debugging panel shows "127.0.0.1:9222"
// — that's the HTTP endpoint, not the WS URL, so this discovery step makes
// `url: "127.0.0.1:9222"` Just Work.
//
// Async via AsyncHTTP on the HTTP thread — the endpoint might not be
// listening (wrong port, Chrome not running, firewalled). onHttpResult fires
// on the HTTP thread; we bounce to the JS thread via ConcurrentTask before
// calling back into C++ (which will WebSocket::create, which needs the JS
// thread's usockets context).

const DiscoverTask = struct {
    http: bun.http.AsyncHTTP,
    response: bun.MutableString,
    url_buf: []u8, // owned — http://<host:port>/json/version
    vm: *jsc.VirtualMachine,
    result_ok: bool = false,

    pub const new = bun.TrivialNew(@This());

    // HTTP thread — stash result, enqueue JS-thread continuation.
    // ConcurrentTask.fromCallback heap-allocates the task wrapper (auto-
    // deleted after the callback runs); we only stash what runOnJSThread
    // needs. The response body is in this.response — the MutableString
    // is heap-backed, safe to read from the JS thread.
    fn onHttpResult(this: *DiscoverTask, _: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
        this.result_ok = result.isSuccess() and
            if (result.metadata) |m| m.response.status_code == 200 else false;
        this.vm.eventLoop().enqueueTaskConcurrent(
            jsc.ConcurrentTask.fromCallback(this, DiscoverTask.runOnJSThread),
        );
    }

    // JS thread — parse webSocketDebuggerUrl, call C++, clean up.
    fn runOnJSThread(this: *DiscoverTask) void {
        defer this.deinit();
        if (!this.result_ok) {
            Bun__CDPTransport__onDiscoverFailed(this.vm.global);
            return;
        }
        // Response body: {"Browser":"...","Protocol-Version":"...",
        // "webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/<id>",
        // ...}. The URL has no escapes (it's ASCII host:port/path), so a
        // substring scan beats pulling in a JSON parser for one field.
        const body = this.response.list.items;
        const key = "\"webSocketDebuggerUrl\":\"";
        const start = bun.strings.indexOf(body, key) orelse {
            Bun__CDPTransport__onDiscoverFailed(this.vm.global);
            return;
        };
        const url_start = start + key.len;
        const url_end = bun.strings.indexOfChar(body[url_start..], '"') orelse {
            Bun__CDPTransport__onDiscoverFailed(this.vm.global);
            return;
        };
        const ws_url = body[url_start..][0..url_end];
        Bun__CDPTransport__onDiscovered(this.vm.global, ws_url.ptr, ws_url.len);
    }

    fn deinit(this: *DiscoverTask) void {
        this.response.deinit();
        this.http.clearData();
        this.http.client.deinit();
        bun.default_allocator.free(this.url_buf);
        bun.destroy(this);
    }
};

/// Read DevToolsActivePort from Chrome's default profile directory.
/// Chrome writes this when --remote-debugging-port is set OR when the
/// user flips the "Allow remote debugging" toggle in chrome://inspect.
/// Two lines: port, then path (/devtools/browser/<id>). Returns the
/// full ws:// URL in out_buf, or null if the file doesn't exist /
/// is malformed / the profile dir is non-standard.
///
/// This is the fast path — no network, instant answer. chrome-devtools-mcp
/// does the same. Falls back to HTTP GET /json/version (below) when the
/// file isn't there or the user passed an explicit host:port that might
/// be a different profile or a remote Chrome.
fn readDevToolsActivePort(out_buf: *std.ArrayListUnmanaged(u8)) ?void {
    // Default profile locations. Multiple Chrome channels (stable/beta/
    // canary) have distinct dirs; try each. Chromium and Edge also
    // respond to the same debugging protocol.
    // Windows roots under %LOCALAPPDATA%; POSIX under $HOME. The subdir
    // names come from each browser's installer — hardcoded, not
    // discoverable. Edge uses the same CDP + file format as Chrome.
    const root = if (comptime bun.Environment.isWindows)
        bun.getenvZ("LOCALAPPDATA") orelse return null
    else
        bun.getenvZ("HOME") orelse return null;
    const candidates: []const []const u8 = if (comptime bun.Environment.isMac) &.{
        "Library/Application Support/Google/Chrome/DevToolsActivePort",
        "Library/Application Support/Google/Chrome Canary/DevToolsActivePort",
        "Library/Application Support/Google/Chrome Beta/DevToolsActivePort",
        "Library/Application Support/Chromium/DevToolsActivePort",
        "Library/Application Support/Microsoft Edge/DevToolsActivePort",
    } else if (comptime bun.Environment.isLinux) &.{
        ".config/google-chrome/DevToolsActivePort",
        ".config/google-chrome-beta/DevToolsActivePort",
        ".config/google-chrome-unstable/DevToolsActivePort",
        ".config/chromium/DevToolsActivePort",
        ".config/microsoft-edge/DevToolsActivePort",
    } else if (comptime bun.Environment.isWindows) &.{
        // Windows installer layout: <vendor>\<channel>\User Data\
        "Google\\Chrome\\User Data\\DevToolsActivePort",
        "Google\\Chrome SxS\\User Data\\DevToolsActivePort", // Canary
        "Google\\Chrome Beta\\User Data\\DevToolsActivePort",
        "Chromium\\User Data\\DevToolsActivePort",
        "Microsoft\\Edge\\User Data\\DevToolsActivePort",
    } else &.{};

    var path_buf: bun.PathBuffer = undefined;
    for (candidates) |rel| {
        const path = bun.path.joinAbsStringBufZ(root, &path_buf, &.{rel}, .auto);
        const contents = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, bun.default_allocator)) {
            .err => continue, // ENOENT or EACCES — try next
            .result => |c| c,
        };
        defer bun.default_allocator.free(contents);

        // Parse: line 1 = port, line 2 = path.
        var lines = std.mem.splitScalar(u8, contents, '\n');
        const port_str = std.mem.trim(u8, lines.next() orelse continue, " \r\t");
        const ws_path = std.mem.trim(u8, lines.next() orelse continue, " \r\t");
        // Validate port (catch stale/corrupt files).
        const port = std.fmt.parseInt(u16, port_str, 10) catch continue;
        if (port == 0 or ws_path.len == 0 or ws_path[0] != '/') continue;

        out_buf.clearRetainingCapacity();
        out_buf.writer(bun.default_allocator).print("ws://127.0.0.1:{d}{s}", .{ port, ws_path }) catch return null;
        return;
    }
    return null;
}

/// Auto-discover a running Chrome's WebSocket debugger URL by reading
/// DevToolsActivePort (instant, no network). Writes the ws:// URL into
/// out_buf and returns its length, or 0 if no file found.
///
/// C++ calls this from the constructor when backend:"chrome" has no
/// explicit path or url — if we get a URL back, connect to the existing
/// Chrome; else spawn our own. Sync file read means the constructor
/// stays synchronous and the decision is made before any I/O kicks off.
///
/// The file can be stale (Chrome crashed without cleaning up, or was
/// restarted with a different browser-id). The subsequent WS connect
/// will fail with the dialog-dismissed/connection-refused close code;
/// onClose → rejectAllAndMarkDead surfaces that to the user's first
/// `await navigate()`. We don't pre-validate (that'd need a network
/// round-trip which defeats the point of the file).
pub export fn Bun__Chrome__autoDetect(out_buf: [*]u8, out_cap: usize) usize {
    var buf: std.ArrayListUnmanaged(u8) = .empty;
    defer buf.deinit(bun.default_allocator);
    if (readDevToolsActivePort(&buf)) |_| {
        if (buf.items.len > out_cap) return 0;
        @memcpy(out_buf[0..buf.items.len], buf.items);
        return buf.items.len;
    }
    return 0;
}

/// Discover the ws:// debugger URL for a bare host:port. Two paths:
///
/// 1. DevToolsActivePort file (sync, instant): Chrome's new
///    chrome://inspect/#remote-debugging toggle writes this file but does
///    NOT expose /json/version (404). If the file's port matches the
///    user's input and the host is localhost-ish, use the file's path
///    directly. This is the primary path for the new toggle.
///
/// 2. GET /json/version (async, HTTP thread): classic --remote-debugging-
///    port Chrome exposes this. Fallback for when the file doesn't match
///    (different profile, remote host, or classic launch).
///
/// `input` is bare host:port or http://host:port. Calls
/// Bun__CDPTransport__onDiscovered (JS thread) with the ws:// URL on
/// success, or __onDiscoverFailed on any error. C++ owns the input
/// string; we copy into url_buf.
pub export fn Bun__Chrome__discover(global: *jsc.JSGlobalObject, input: [*]const u8, input_len: usize) void {
    const alloc = bun.default_allocator;
    const in = input[0..input_len];

    // Normalize: strip http:// prefix if present.
    const host = if (bun.strings.hasPrefixComptime(in, "http://"))
        in["http://".len..]
    else
        in;

    // Fast path: DevToolsActivePort file. Only valid when the host is
    // localhost (the file is per-machine) and the port matches what
    // Chrome wrote. A user passing a remote host or non-default port
    // skips this and goes to HTTP GET.
    if (isLocalhost(host)) {
        var buf: std.ArrayListUnmanaged(u8) = .empty;
        defer buf.deinit(alloc);
        if (readDevToolsActivePort(&buf)) |_| {
            // buf is "ws://127.0.0.1:<port>/devtools/browser/<id>".
            // Check the port in buf matches what the user asked for.
            // Extract user's port (after the last ':').
            const colon = std.mem.lastIndexOfScalar(u8, host, ':') orelse 0;
            const user_port = host[colon + 1 ..];
            // Find ":<port>/" in the ws:// URL we built.
            var needle_buf: [8]u8 = undefined;
            const needle = std.fmt.bufPrint(&needle_buf, ":{s}/", .{user_port}) catch {
                // port string too long to be a valid port — skip to HTTP
                return discoverViaHttp(global, alloc, host);
            };
            if (bun.strings.contains(buf.items, needle)) {
                Bun__CDPTransport__onDiscovered(global, buf.items.ptr, buf.items.len);
                return;
            }
            // Port mismatch — the file is for a different Chrome. Fall
            // through to HTTP GET (the user's port might be a second
            // Chrome with classic --remote-debugging-port).
        }
    }

    discoverViaHttp(global, alloc, host);
}

fn isLocalhost(host: []const u8) bool {
    // host:port — strip the port for the check.
    const h = if (std.mem.lastIndexOfScalar(u8, host, ':')) |c| host[0..c] else host;
    return bun.strings.eqlComptime(h, "localhost") or
        bun.strings.eqlComptime(h, "127.0.0.1") or
        bun.strings.eqlComptime(h, "[::1]") or
        bun.strings.eqlComptime(h, "::1");
}

fn discoverViaHttp(global: *jsc.JSGlobalObject, alloc: std.mem.Allocator, host: []const u8) void {
    const url_buf = std.fmt.allocPrint(alloc, "http://{s}/json/version", .{host}) catch bun.outOfMemory();

    const vm = global.bunVM();
    var task = DiscoverTask.new(.{
        .http = undefined,
        .response = bun.MutableString.initEmpty(alloc),
        .url_buf = url_buf,
        .vm = vm,
    });

    const url = bun.URL.parse(url_buf);
    task.http = bun.http.AsyncHTTP.init(
        alloc,
        .GET,
        url,
        .{},
        "",
        &task.response,
        "",
        bun.http.HTTPClientResult.Callback.New(*DiscoverTask, DiscoverTask.onHttpResult).init(task),
        .manual,
        .{},
    );
    // Localhost GET is instant; a dead port fails fast with
    // ECONNREFUSED. The HTTP client's default 5-minute timeout only
    // matters if something accepts but never responds — unlikely for
    // /json/version but the user's `await navigate()` would hang
    // either way, so they'd notice.
    bun.http.HTTPThread.init(&.{});
    var batch = bun.ThreadPool.Batch{};
    task.http.schedule(alloc, &batch);
    bun.http.http_thread.schedule(batch);
}

// C++ side (ChromeBackend.cpp): onDiscovered does WebSocket::create with
// the ws:// URL; onDiscoverFailed calls rejectAllAndMarkDead. Both must
// run on the JS thread (DiscoverTask.runOnJSThread ensures that).
extern fn Bun__CDPTransport__onDiscovered(global: *jsc.JSGlobalObject, url: [*]const u8, len: usize) void;
extern fn Bun__CDPTransport__onDiscoverFailed(global: *jsc.JSGlobalObject) void;

const log = bun.Output.scoped(.Chrome, .hidden);

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
