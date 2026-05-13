pub const jsc = @import("./jsc/jsc.zig");
pub const webcore = @import("./runtime/webcore.zig");
pub const api = @import("./runtime/api.zig");
pub const bindgen = @import("./jsc/bindgen.zig");

pub fn applyStandaloneRuntimeFlags(b: *bun.Transpiler, graph: *const bun.StandaloneModuleGraph) void {
    b.options.env.disable_default_env_files = graph.flags.disable_default_env_files;
    b.options.env.behavior = if (graph.flags.disable_default_env_files)
        .disable
    else
        .load_all_without_inlining;

    b.resolver.opts.load_tsconfig_json = !graph.flags.disable_autoload_tsconfig;
    b.resolver.opts.load_package_json = !graph.flags.disable_autoload_package_json;
}

/// Read a small file at an absolute path into `buf`, returning the bytes read
/// (or `null` on any error). Uses `bun.sys.File`/`bun.FD.cwd()` rather than
/// `std.fs.cwd()` per the codebase convention; absolute paths ignore the dir fd.
fn readSmallFileAbs(path: [:0]const u8, buf: []u8) ?[]const u8 {
    const file = switch (bun.sys.File.openat(bun.FD.cwd(), path, bun.O.RDONLY, 0)) {
        .result => |f| f,
        .err => return null,
    };
    defer file.close();
    return switch (file.readAll(buf)) {
        .result => |n| buf[0..n],
        .err => null,
    };
}

/// Pin JSC/ICU's default timezone before anything constructs a `Date` or touches
/// `Intl`. Honors `$TZ` from the process environment; with `$TZ` unset, resolves
/// the host IANA/POSIX-TZ id cheaply (without walking `/usr/share/zoneinfo/**`):
///
///   1a. `/etc/localtime` symlink target containing `.../zoneinfo/<id>`
///   1b. `/etc/localtime` regular file — the POSIX-TZ string in the TZif v2+
///       footer (the newline-framed last line of the file)
///   2.  `/etc/timezone` (Debian/Ubuntu) — file content is the IANA id
///   3.  `ZONE="..."` in `/etc/sysconfig/clock` (older RHEL/CentOS)
///
/// Goes through `WTF::setTimeZoneOverride` (`ucal_setDefaultTimeZone`), a
/// process-global ICU setting, so it can run before `VirtualMachine.init` and
/// needs no `JSGlobalObject`. If none resolve, do nothing and let ICU
/// auto-detect lazily. Otherwise ICU runs that auto-detection the first time a
/// `Date` is constructed, and on systems where `/etc/localtime` is a regular
/// file (not a symlink into `/usr/share/zoneinfo`) it content-matches every zone
/// file under `/usr/share/zoneinfo/**` — thousands of openat/read/close syscalls.
/// A `$TZ` that only appears in a `.env` file is applied separately, after the
/// env loader runs (see `Run.boot`).
fn seedHostTimeZone() void {
    if (comptime !bun.Environment.isPosix) return;

    if (std.posix.getenv("TZ")) |tz| {
        if (tz.len > 0) _ = jsc.wtf.setTimeZoneOverride(tz);
        return;
    }

    const zoneinfo_marker = "zoneinfo/";
    var buf: [std.fs.max_path_bytes]u8 = undefined;

    // 1) /etc/localtime
    if (std.fs.readLinkAbsolute("/etc/localtime", &buf)) |target| {
        // 1a) symlink -> .../zoneinfo/<id> (the usual layout)
        if (std.mem.lastIndexOf(u8, target, zoneinfo_marker)) |idx| {
            if (applyHostTimeZone(target[idx + zoneinfo_marker.len ..])) return;
        }
    } else |err| switch (err) {
        // 1b) regular file (readlink -> EINVAL): a TZif file. v2+ files carry a
        // newline-framed POSIX-TZ string as their last line (e.g. `\nUTC0\n`,
        // `\nEST5EDT,M3.2.0,M11.1.0\n`); prefer it to the directory content-match
        // scan ICU would otherwise perform.
        error.NotLink => switch (bun.sys.File.readFrom(bun.FD.cwd(), "/etc/localtime", bun.default_allocator)) {
            .result => |data| {
                defer if (data.len > 0) bun.default_allocator.free(data);
                if (tzifV2Footer(data)) |footer| {
                    if (applyHostTimeZone(normalizePosixTzZone(footer))) return;
                }
            },
            .err => {},
        },
        else => {},
    }

    // 2) /etc/timezone (Debian/Ubuntu) — file content is the IANA id
    if (readSmallFileAbs("/etc/timezone", &buf)) |contents| {
        if (applyHostTimeZone(contents)) return;
    }

    // 3) ZONE="..." in /etc/sysconfig/clock (older RHEL/CentOS)
    if (readSmallFileAbs("/etc/sysconfig/clock", &buf)) |contents| {
        var lines = std.mem.tokenizeAny(u8, contents, "\r\n");
        while (lines.next()) |line| {
            const trimmed = std.mem.trim(u8, line, " \t");
            if (!std.mem.startsWith(u8, trimmed, "ZONE")) continue;
            var rest = std.mem.trim(u8, trimmed["ZONE".len..], " \t");
            if (rest.len == 0 or rest[0] != '=') continue;
            rest = std.mem.trim(u8, rest[1..], " \t");
            rest = std.mem.trim(u8, rest, "\"'");
            if (applyHostTimeZone(rest)) return;
        }
    }
}

/// Trim surrounding whitespace and hand the id to `WTF::setTimeZoneOverride`
/// (`ucal_setDefaultTimeZone`). Returns whether ICU accepted it — a rejected id
/// (e.g. a POSIX-TZ string ICU cannot canonicalize) yields `false` so the caller
/// falls through to the next source.
fn applyHostTimeZone(id_raw: []const u8) bool {
    const id = std.mem.trim(u8, id_raw, " \t\r\n");
    if (id.len == 0) return false;
    return jsc.wtf.setTimeZoneOverride(id);
}

/// Returns the newline-framed footer (the last line) of a TZif v2/v3/v4 file —
/// a POSIX-TZ string such as `UTC0` or `EST5EDT,M3.2.0,M11.1.0`. `null` for v1
/// files (no footer), non-TZif input, or a missing/empty/non-printable footer.
fn tzifV2Footer(data: []const u8) ?[]const u8 {
    if (data.len < 5 or !strings.hasPrefixComptime(data, "TZif")) return null;
    switch (data[4]) {
        '2', '3', '4' => {},
        else => return null,
    }
    // The footer is `...\n<POSIX-TZ>\n` at EOF.
    if (data[data.len - 1] != '\n') return null;
    const body = data[0 .. data.len - 1];
    const nl = std.mem.lastIndexOfScalar(u8, body, '\n') orelse return null;
    const footer = body[nl + 1 ..];
    if (footer.len == 0) return null;
    // A well-formed footer is printable ASCII with no spaces.
    for (footer) |c| {
        if (c < '!' or c > '~') return null;
    }
    return footer;
}

/// Maps the zero-offset, no-DST UTC aliases ICU does not canonicalize from a
/// bare POSIX-TZ footer (`UTC0`, `UCT0`, `UT0`, …) onto `UTC`, which it does.
/// Everything else passes through unchanged: `GMT0` → `Etc/GMT` and
/// `GMT+05:00` → a custom zone are handled by ICU, an actual IANA id needs no
/// help, and a DST-bearing footer ICU rejects so the caller falls through.
fn normalizePosixTzZone(footer: []const u8) []const u8 {
    // A POSIX-TZ string with a DST rule has a comma; never a plain UTC alias.
    // Quoted `<...>` abbreviations are left for ICU to interpret.
    if (std.mem.indexOfScalar(u8, footer, ',') != null) return footer;
    if (footer.len > 0 and footer[0] == '<') return footer;
    var split: usize = 0;
    while (split < footer.len and std.ascii.isAlphabetic(footer[split])) : (split += 1) {}
    if (split == 0) return footer;
    const abbr = footer[0..split];
    const offset = footer[split..];
    const is_utc_abbr = std.ascii.eqlIgnoreCase(abbr, "UT") or
        std.ascii.eqlIgnoreCase(abbr, "UTC") or
        std.ascii.eqlIgnoreCase(abbr, "UCT");
    if (!is_utc_abbr) return footer;
    for (offset) |c| switch (c) {
        '0', '+', '-', ':' => {},
        else => return footer,
    };
    return "UTC";
}

pub const Run = struct {
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,
    arena: Arena,
    any_unhandled: bool = false,
    is_html_entrypoint: bool = false,

    var run: Run = undefined;

    pub fn bootStandalone(ctx: Command.Context, entry_path: string, graph_ptr: *bun.StandaloneModuleGraph) !void {
        jsc.markBinding(@src());
        bun.jsc.initialize(false);
        // Pin the timezone before anything can construct a `Date` or touch
        // `Intl` so ICU never falls back to its expensive lazy host-zone
        // auto-detection. See `seedHostTimeZone`.
        seedHostTimeZone();
        bun.analytics.Features.standalone_executable += 1;

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();
        const arena = Arena.init();

        // Load bunfig.toml unless disabled by compile flags
        // Note: config loading with execArgv is handled earlier in cli.zig via loadConfig
        if (!ctx.debug.loaded_bunfig and !graph_ptr.flags.disable_autoload_bunfig) {
            try bun.cli.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand);
        }

        run = .{
            .vm = try VirtualMachine.initWithModuleGraph(.{
                .allocator = arena.allocator(),
                .log = ctx.log,
                .args = ctx.args,
                .graph = graph_ptr,
                .is_main_thread = true,
                .smol = ctx.runtime_options.smol,
                .debugger = ctx.runtime_options.debugger,
                .dns_result_order = DNSResolver.Order.fromStringOrDie(ctx.runtime_options.dns_result_order),
            }),
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        var vm = run.vm;
        var b = &vm.transpiler;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        vm.arena = &run.arena;
        vm.allocator = vm.arena.allocator();

        b.options.install = ctx.install;
        b.resolver.opts.install = ctx.install;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install = (ctx.debug.offline_mode_setting orelse .online) == .offline;
        b.resolver.opts.prefer_latest_install = (ctx.debug.offline_mode_setting orelse .online) == .latest;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
        b.resolver.env_loader = b.env;

        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        b.resolver.opts.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.resolver.opts.minify_whitespace = ctx.bundler_options.minify_whitespace;

        b.options.serve_plugins = ctx.args.serve_plugins;
        b.options.bunfig_path = ctx.args.bunfig_path;

        // b.options.minify_syntax = ctx.bundler_options.minify_syntax;

        switch (ctx.debug.macros) {
            .disable => {
                b.options.no_macros = true;
            },
            .map => |macros| {
                b.options.macro_remap = macros;
            },
            .unspecified => {},
        }

        applyStandaloneRuntimeFlags(b, graph_ptr);

        b.configureDefines() catch {
            failWithBuildError(vm);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = true;
        jsc.VirtualMachine.is_main_thread_vm = true;

        // Honor an explicit $TZ (e.g. from a bundled `.env`); the host fallback
        // was already seeded early.
        if (vm.transpiler.env.get("TZ")) |tz| {
            if (tz.len > 0) {
                _ = vm.global.setTimeZone(&jsc.ZigString.init(tz));
            }
        }

        bun.http.experimental_http2_client_from_cli = ctx.runtime_options.experimental_http2_fetch;
        bun.http.experimental_http3_client_from_cli = ctx.runtime_options.experimental_http3_fetch;
        doPreconnect(ctx.runtime_options.preconnect);

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn doPreconnect(preconnect: []const string) void {
        if (preconnect.len == 0) return;
        bun.HTTPThread.init(&.{});

        for (preconnect) |url_str| {
            const url = bun.URL.parse(url_str);

            if (!url.isHTTP() and !url.isHTTPS()) {
                Output.errGeneric("preconnect URL must be HTTP or HTTPS: {f}", .{bun.fmt.quote(url_str)});
                Global.exit(1);
            }

            if (url.hostname.len == 0) {
                Output.errGeneric("preconnect URL must have a hostname: {f}", .{bun.fmt.quote(url_str)});
                Global.exit(1);
            }

            if (!url.hasValidPort()) {
                Output.errGeneric("preconnect URL must have a valid port: {f}", .{bun.fmt.quote(url_str)});
                Global.exit(1);
            }

            AsyncHTTP.preconnect(url, false);
        }
    }

    fn bootBunShell(ctx: Command.Context, entry_path: []const u8) !bun.shell.ExitCode {
        @branchHint(.cold);

        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        var bundle = try bun.Transpiler.init(
            ctx.allocator,
            ctx.log,
            try @import("./jsc/config.zig").configureTransformOptionsForBunVM(ctx.allocator, ctx.args),
            null,
        );
        try bundle.runEnvLoader(bundle.options.env.disable_default_env_files);
        const mini = jsc.MiniEventLoop.initGlobal(bundle.env, null);
        mini.top_level_dir = ctx.args.absolute_working_dir orelse "";
        return bun.shell.Interpreter.initAndRunFromFile(ctx, mini, entry_path);
    }

    pub fn boot(ctx: Command.Context, entry_path: string, loader: ?bun.options.Loader) !void {
        jsc.markBinding(@src());

        if (!ctx.debug.loaded_bunfig) {
            try bun.cli.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand);
        }

        // The shell does not need to initialize JSC.
        // JSC initialization costs 1-3ms. We skip this if we know it's a shell script.
        if (strings.endsWithComptime(entry_path, ".sh")) {
            const exit_code = try bootBunShell(ctx, entry_path);
            Global.exit(exit_code);
            return;
        }

        bun.jsc.initialize(ctx.runtime_options.eval.eval_and_print);

        // Pin the timezone before VirtualMachine.init — and therefore before
        // anything can construct a `Date` or touch `Intl` — so ICU never falls
        // back to its expensive lazy host-zone auto-detection. Reads `$TZ`
        // straight from the process environment (vm.transpiler.env isn't built
        // yet); a `$TZ` that only appears in a `.env` file is honored below,
        // after the env loader runs.
        seedHostTimeZone();

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();
        const arena = Arena.init();

        run = .{
            .vm = try VirtualMachine.init(
                .{
                    .allocator = arena.allocator(),
                    .log = ctx.log,
                    .args = ctx.args,
                    .store_fd = ctx.debug.hot_reload != .none,
                    .smol = ctx.runtime_options.smol,
                    .eval = ctx.runtime_options.eval.eval_and_print,
                    .debugger = ctx.runtime_options.debugger,
                    .dns_result_order = DNSResolver.Order.fromStringOrDie(ctx.runtime_options.dns_result_order),
                    .is_main_thread = true,
                },
            ),
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        var vm = run.vm;
        var b = &vm.transpiler;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        vm.arena = &run.arena;
        vm.allocator = vm.arena.allocator();

        if (ctx.runtime_options.eval.script.len > 0) {
            const script_source = try bun.default_allocator.create(logger.Source);
            script_source.* = logger.Source.initPathString(entry_path, ctx.runtime_options.eval.script);
            vm.module_loader.eval_source = script_source;

            if (ctx.runtime_options.eval.eval_and_print) {
                b.options.dead_code_elimination = false;
            }
        } else if (ctx.runtime_options.cron_title.len > 0 and ctx.runtime_options.cron_period.len > 0) {
            // Cron execution mode: wrap the entry point in a script that imports the
            // module and calls default.scheduled(controller)
            // Escape path for embedding in JS string literal (handle backslashes on Windows)
            const escaped_path = try escapeForJSString(bun.default_allocator, entry_path);
            defer bun.default_allocator.free(escaped_path);
            const escaped_period = try escapeForJSString(bun.default_allocator, ctx.runtime_options.cron_period);
            defer bun.default_allocator.free(escaped_period);
            const cron_script = try std.fmt.allocPrint(bun.default_allocator,
                \\const mod = await import("{s}");
                \\const scheduled = (mod.default || mod).scheduled;
                \\if (typeof scheduled !== "function") throw new Error("Module does not export default.scheduled()");
                \\const controller = {{ cron: "{s}", type: "scheduled", scheduledTime: Date.now() }};
                \\await scheduled(controller);
            , .{ escaped_path, escaped_period });
            // entry_path must end with /[eval] for the transpiler to use eval_source
            const trigger = bun.pathLiteral("/[eval]");
            var cwd_buf: bun.PathBuffer = undefined;
            const cwd_slice = switch (bun.sys.getcwd(&cwd_buf)) {
                .result => |cwd| cwd,
                .err => return error.SystemResources,
            };
            var eval_path_buf: [bun.MAX_PATH_BYTES + trigger.len]u8 = undefined;
            @memcpy(eval_path_buf[0..cwd_slice.len], cwd_slice);
            @memcpy(eval_path_buf[cwd_slice.len..][0..trigger.len], trigger);
            const eval_entry_path = eval_path_buf[0 .. cwd_slice.len + trigger.len];
            // Heap-allocate the path so it outlives this stack frame
            const heap_entry_path = try bun.default_allocator.dupe(u8, eval_entry_path);
            const script_source = try bun.default_allocator.create(logger.Source);
            script_source.* = logger.Source.initPathString(heap_entry_path, cron_script);
            vm.module_loader.eval_source = script_source;
            run.entry_path = heap_entry_path;
        }

        b.options.install = ctx.install;
        b.resolver.opts.install = ctx.install;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install = (ctx.debug.offline_mode_setting orelse .online) == .offline;
        b.resolver.opts.prefer_latest_install = (ctx.debug.offline_mode_setting orelse .online) == .latest;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
        b.resolver.env_loader = b.env;

        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        b.resolver.opts.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.resolver.opts.minify_whitespace = ctx.bundler_options.minify_whitespace;

        b.options.env.behavior = .load_all_without_inlining;
        // b.options.minify_syntax = ctx.bundler_options.minify_syntax;

        switch (ctx.debug.macros) {
            .disable => {
                b.options.no_macros = true;
            },
            .map => |macros| {
                b.options.macro_remap = macros;
            },
            .unspecified => {},
        }

        b.configureDefines() catch {
            failWithBuildError(vm);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = true;
        jsc.VirtualMachine.is_main_thread_vm = true;

        // Honor an explicit $TZ — including one loaded from a `.env` file above,
        // which the early `seedHostTimeZone()` (process environment only) could
        // not see. Going through `vm.global.setTimeZone` also resets the date
        // cache; the bare `WTF::setTimeZoneOverride` used by the early seed does
        // not, but nothing has constructed a `Date` that early so it doesn't
        // matter. With $TZ unset, the host fallback was already applied early.
        if (vm.transpiler.env.get("TZ")) |tz| {
            if (tz.len > 0) {
                _ = vm.global.setTimeZone(&jsc.ZigString.init(tz));
            }
        }

        vm.transpiler.env.loadTracy();

        bun.http.experimental_http2_client_from_cli = ctx.runtime_options.experimental_http2_fetch;
        bun.http.experimental_http3_client_from_cli = ctx.runtime_options.experimental_http3_fetch;
        doPreconnect(ctx.runtime_options.preconnect);

        vm.main_is_html_entrypoint = (loader orelse vm.transpiler.options.loader(std.fs.path.extension(entry_path))) == .html;

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn onUnhandledRejectionBeforeClose(this: *jsc.VirtualMachine, _: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        this.runErrorHandler(value, this.onUnhandledRejectionExceptionList);
        run.any_unhandled = true;
    }

    pub fn start(this: *Run) void {
        var vm = this.vm;
        vm.hot_reload = this.ctx.debug.hot_reload;
        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;

        // Start CPU profiler if enabled
        if (this.ctx.runtime_options.cpu_prof.enabled) {
            const cpu_prof_opts = this.ctx.runtime_options.cpu_prof;

            vm.cpu_profiler_config = CPUProfiler.CPUProfilerConfig{
                .name = cpu_prof_opts.name,
                .dir = cpu_prof_opts.dir,
                .md_format = cpu_prof_opts.md_format,
                .json_format = cpu_prof_opts.json_format,
                .interval = cpu_prof_opts.interval,
            };
            CPUProfiler.setSamplingInterval(cpu_prof_opts.interval);
            CPUProfiler.startCPUProfiler(vm.jsc_vm);
            bun.analytics.Features.cpu_profile += 1;
        }

        // Set up heap profiler config if enabled (actual profiling happens on exit)
        if (this.ctx.runtime_options.heap_prof.enabled) {
            const heap_prof_opts = this.ctx.runtime_options.heap_prof;

            vm.heap_profiler_config = HeapProfiler.HeapProfilerConfig{
                .name = heap_prof_opts.name,
                .dir = heap_prof_opts.dir,
                .text_format = heap_prof_opts.text_format,
            };
            bun.analytics.Features.heap_snapshot += 1;
        }

        this.addConditionalGlobals();
        do_redis_preconnect: {
            // This must happen within the API lock, which is why it's not in the "doPreconnect" function
            if (this.ctx.runtime_options.redis_preconnect) {
                // Go through the global object's getter because Bun.redis is a
                // PropertyCallback which means we don't have a WriteBarrier we can access
                const global = vm.global;
                const bun_object = vm.global.toJSValue().get(global, "Bun") catch |err| {
                    vm.global.reportActiveExceptionAsUnhandled(err);
                    break :do_redis_preconnect;
                } orelse break :do_redis_preconnect;
                const redis = bun_object.get(global, "redis") catch |err| {
                    vm.global.reportActiveExceptionAsUnhandled(err);
                    break :do_redis_preconnect;
                } orelse break :do_redis_preconnect;
                const client = redis.as(bun.valkey.JSValkeyClient) orelse break :do_redis_preconnect;
                // If connection fails, this will become an unhandled promise rejection, which is fine.
                _ = client.doConnect(vm.global, redis) catch |err| {
                    vm.global.reportActiveExceptionAsUnhandled(err);
                    break :do_redis_preconnect;
                };
            }
        }

        do_postgres_preconnect: {
            if (this.ctx.runtime_options.sql_preconnect) {
                const global = vm.global;
                const bun_object = vm.global.toJSValue().get(global, "Bun") catch |err| {
                    global.reportActiveExceptionAsUnhandled(err);
                    break :do_postgres_preconnect;
                } orelse break :do_postgres_preconnect;
                const sql_object = bun_object.get(global, "sql") catch |err| {
                    global.reportActiveExceptionAsUnhandled(err);
                    break :do_postgres_preconnect;
                } orelse break :do_postgres_preconnect;
                const connect_fn = sql_object.get(global, "connect") catch |err| {
                    global.reportActiveExceptionAsUnhandled(err);
                    break :do_postgres_preconnect;
                } orelse break :do_postgres_preconnect;
                _ = connect_fn.call(global, sql_object, &.{}) catch |err| {
                    global.reportActiveExceptionAsUnhandled(err);
                    break :do_postgres_preconnect;
                };
            }
        }

        switch (this.ctx.debug.hot_reload) {
            .hot => jsc.hot_reloader.HotReloader.enableHotModuleReloading(vm, this.entry_path),
            .watch => jsc.hot_reloader.WatchReloader.enableHotModuleReloading(vm, this.entry_path),
            else => {},
        }

        if (strings.eqlComptime(this.entry_path, ".") and vm.transpiler.fs.top_level_dir.len > 0) {
            this.entry_path = vm.transpiler.fs.top_level_dir;
        }

        var printed_sourcemap_warning_and_version = false;

        if (vm.loadEntryPoint(this.entry_path)) |promise| {
            if (promise.status() == .rejected) {
                const handled = vm.uncaughtException(vm.global, promise.result(vm.global.vm()), true);
                promise.setHandled();
                vm.pending_internal_promise_reported_at = vm.hot_reload_counter;

                if (vm.hot_reload != .none or handled) {
                    vm.addMainToWatcherIfNeeded();
                    vm.eventLoop().tick();
                    vm.eventLoop().tickPossiblyForever();
                } else {
                    vm.exit_handler.exit_code = 1;
                    vm.onExit();

                    if (run.any_unhandled) {
                        printed_sourcemap_warning_and_version = true;
                        bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.print();

                        Output.prettyErrorln(
                            "<r>\n<d>{s}<r>",
                            .{Global.unhandled_error_bun_version_string},
                        );
                    }
                    vm.globalExit();
                }
            }

            _ = promise.result(vm.global.vm());

            if (vm.log.msgs.items.len > 0) {
                dumpBuildError(vm);
                vm.log.msgs.items.len = 0;
            }
        } else |err| {
            if (vm.log.msgs.items.len > 0) {
                dumpBuildError(vm);
                vm.log.msgs.items.len = 0;
            } else {
                Output.prettyErrorln("Error occurred loading entry point: {s}", .{@errorName(err)});
                Output.flush();
            }
            // TODO: Do a event loop tick when we figure out how to watch the file that wasn't found
            //   under hot reload mode
            vm.exit_handler.exit_code = 1;
            vm.onExit();
            if (run.any_unhandled) {
                printed_sourcemap_warning_and_version = true;
                bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.print();

                Output.prettyErrorln(
                    "<r>\n<d>{s}<r>",
                    .{Global.unhandled_error_bun_version_string},
                );
            }
            vm.globalExit();
        }

        // don't run the GC if we don't actually need to
        if (vm.isEventLoopAlive() or
            vm.eventLoop().tickConcurrentWithCount() > 0)
        {
            vm.global.vm().releaseWeakRefs();
            _ = vm.arena.gc();
            _ = vm.global.vm().runGC(false);
            vm.tick();
        }

        // Initial synchronous evaluation of the entrypoint is done (TLA may
        // still be pending and will resolve in the loop below); the embedded
        // source pages are off the hot path now. No-op unless this is a
        // compiled standalone binary, and skip under --watch/--hot since those
        // re-read source on every reload.
        if (!this.vm.isWatcherEnabled()) {
            bun.StandaloneModuleGraph.hintSourcePagesDontNeed();
        }

        {
            if (this.vm.isWatcherEnabled()) {
                vm.reportExceptionInHotReloadedModuleIfNeeded();

                while (true) {
                    while (vm.isEventLoopAlive()) {
                        vm.tick();

                        // Report exceptions in hot-reloaded modules
                        vm.reportExceptionInHotReloadedModuleIfNeeded();

                        vm.eventLoop().autoTickActive();
                    }

                    vm.onBeforeExit();

                    vm.reportExceptionInHotReloadedModuleIfNeeded();

                    vm.eventLoop().tickPossiblyForever();
                }
            } else {
                while (vm.isEventLoopAlive()) {
                    vm.tick();
                    vm.eventLoop().autoTickActive();
                }

                if (this.ctx.runtime_options.eval.eval_and_print) {
                    const to_print = brk: {
                        const result: jsc.JSValue = vm.entry_point_result.value.get() orelse .js_undefined;
                        if (result.asAnyPromise()) |promise| {
                            switch (promise.status()) {
                                .pending => {
                                    result.then2(vm.global, .js_undefined, Bun__onResolveEntryPointResult, Bun__onRejectEntryPointResult) catch {}; // TODO: properly propagate exception upwards

                                    vm.tick();
                                    vm.eventLoop().autoTickActive();

                                    while (vm.isEventLoopAlive()) {
                                        vm.tick();
                                        vm.eventLoop().autoTickActive();
                                    }

                                    break :brk result;
                                },
                                else => break :brk promise.result(vm.jsc_vm),
                            }
                        }

                        break :brk result;
                    };

                    to_print.print(vm.global, .Log, .Log);
                }

                vm.onBeforeExit();
            }

            if (vm.log.msgs.items.len > 0) {
                dumpBuildError(vm);
                Output.flush();
            }
        }

        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;
        vm.global.handleRejectedPromises();
        vm.onExit();

        if (this.any_unhandled and !printed_sourcemap_warning_and_version) {
            this.vm.exit_handler.exit_code = 1;

            bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.print();

            Output.prettyErrorln(
                "<r>\n<d>{s}<r>",
                .{Global.unhandled_error_bun_version_string},
            );
        }

        bun.api.napi.fixDeadCodeElimination();
        bun.webcore.BakeResponse.fixDeadCodeElimination();
        bun.crash_handler.fixDeadCodeElimination();
        @import("./jsc/JSSecrets.zig").fixDeadCodeElimination();
        vm.globalExit();
    }

    fn addConditionalGlobals(this: *Run) void {
        const vm = this.vm;
        const runtime_options: *const Command.RuntimeOptions = &this.ctx.runtime_options;

        if (runtime_options.eval.script.len > 0) {
            bun.cpp.Bun__ExposeNodeModuleGlobals(vm.global);
        }
        if (runtime_options.expose_gc) {
            bun.cpp.JSC__JSGlobalObject__addGc(vm.global);
        }
    }
};

pub export fn Bun__onResolveEntryPointResult(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) noreturn {
    const arguments = callframe.arguments_old(1).slice();
    const result = arguments[0];
    result.print(global, .Log, .Log);
    Global.exit(global.bunVM().exit_handler.exit_code);
    return .js_undefined;
}

pub export fn Bun__onRejectEntryPointResult(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) noreturn {
    const arguments = callframe.arguments_old(1).slice();
    const result = arguments[0];
    result.print(global, .Log, .Log);
    Global.exit(global.bunVM().exit_handler.exit_code);
    return .js_undefined;
}

noinline fn dumpBuildError(vm: *jsc.VirtualMachine) void {
    @branchHint(.cold);

    Output.flush();

    const writer = Output.errorWriterBuffered();
    defer Output.flush();

    vm.log.print(writer) catch {};
}

pub noinline fn failWithBuildError(vm: *jsc.VirtualMachine) noreturn {
    @branchHint(.cold);
    dumpBuildError(vm);
    Global.exit(1);
}

const OpaqueWrap = jsc.OpaqueWrap;
const VirtualMachine = jsc.VirtualMachine;

const string = []const u8;

/// Escape a string for safe embedding in a JS double-quoted string literal.
/// Escapes backslashes, double quotes, newlines, etc.
fn escapeForJSString(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    var needs_escape = false;
    for (input) |c| {
        if (c == '\\' or c == '"' or c == '\n' or c == '\r' or c == '\t') {
            needs_escape = true;
            break;
        }
    }
    if (!needs_escape) return allocator.dupe(u8, input);

    var result = try std.array_list.Managed(u8).initCapacity(allocator, input.len + 16);
    for (input) |c| {
        switch (c) {
            '\\' => try result.appendSlice("\\\\"),
            '"' => try result.appendSlice("\\\""),
            '\n' => try result.appendSlice("\\n"),
            '\r' => try result.appendSlice("\\r"),
            '\t' => try result.appendSlice("\\t"),
            else => try result.append(c),
        }
    }
    return result.toOwnedSlice();
}

const CPUProfiler = @import("./jsc/BunCPUProfiler.zig");
const HeapProfiler = @import("./jsc/BunHeapProfiler.zig");
const options = @import("./bundler/options.zig");
const std = @import("std");
const Command = @import("./runtime/cli/cli.zig").Command;
const which = @import("./which/which.zig").which;

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const js_ast = bun.ast;
const logger = bun.logger;
const strings = bun.strings;
const transpiler = bun.transpiler;
const Arena = bun.allocators.MimallocArena;
const AsyncHTTP = bun.http.AsyncHTTP;
const DNSResolver = bun.api.dns.Resolver;
