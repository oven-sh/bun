/// Bun.cron - Register and remove OS-level cron jobs.
///
/// Bun.cron(path, schedule, title) - register a cron job (returns Promise)
/// Bun.cron.remove(title) - remove a cron job (returns Promise)
///
/// On Linux, uses crontab. On macOS, uses launchctl + launchd plist.
/// Async, event-loop-integrated implementation using bun.spawn.
/// Shared base for CronRegisterJob and CronRemoveJob.
fn CronJobBase(comptime Self: type) type {
    return struct {
        pub fn loop(_: *const Self) *bun.Async.Loop {
            if (comptime bun.Environment.isWindows)
                return jsc.VirtualMachine.get().uvLoop()
            else
                return bun.uws.Loop.get();
        }

        pub fn eventLoop(_: *const Self) *jsc.EventLoop {
            return jsc.VirtualMachine.get().eventLoop();
        }

        pub fn onReaderDone(this: *Self) void {
            bun.assert(this.remaining_fds > 0);
            this.remaining_fds -= 1;
            this.maybeFinished();
        }

        pub fn onReaderError(this: *Self, err: bun.sys.Error) void {
            bun.assert(this.remaining_fds > 0);
            this.remaining_fds -= 1;
            if (this.err_msg == null)
                this.err_msg = std.fmt.allocPrint(bun.default_allocator, "Failed to read process output: {s}", .{@tagName(err.getErrno())}) catch null;
            this.maybeFinished();
        }

        pub fn onProcessExit(this: *Self, _: *Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
            this.has_called_process_exit = true;
            this.exit_status = status;
            this.maybeFinished();
        }
    };
}

// ============================================================================
// CronRegisterJob
// ============================================================================

pub const CronRegisterJob = struct {
    promise: jsc.JSPromise.Strong = .empty,
    global: *jsc.JSGlobalObject,
    poll: bun.Async.KeepAlive = .{},

    bun_exe: [:0]const u8,
    abs_path: [:0]const u8,
    schedule: [:0]const u8, // normalized numeric form for crontab/launchd
    raw_schedule: [:0]const u8, // original form for --cron-period and schtasks parsing
    title: [:0]const u8,
    parsed_cron: CronExpression,

    state: State = .reading_crontab,
    process: ?*Process = null,
    stdout_reader: OutputReader = OutputReader.init(CronRegisterJob),
    stderr_reader: OutputReader = OutputReader.init(CronRegisterJob),
    remaining_fds: i8 = 0,
    has_called_process_exit: bool = false,
    exit_status: ?bun.spawn.Status = null,
    err_msg: ?[]const u8 = null,
    tmp_path: ?[:0]const u8 = null,

    const State = enum { reading_crontab, installing_crontab, writing_plist, booting_out, bootstrapping, done, failed };

    pub const loop = CronJobBase(CronRegisterJob).loop;
    pub const eventLoop = CronJobBase(CronRegisterJob).eventLoop;
    pub const onReaderDone = CronJobBase(CronRegisterJob).onReaderDone;
    pub const onReaderError = CronJobBase(CronRegisterJob).onReaderError;
    pub const onProcessExit = CronJobBase(CronRegisterJob).onProcessExit;

    fn setErr(this: *CronRegisterJob, comptime fmt: []const u8, args: anytype) void {
        if (this.err_msg == null)
            this.err_msg = std.fmt.allocPrint(bun.default_allocator, fmt, args) catch null;
    }

    fn maybeFinished(this: *CronRegisterJob) void {
        if (!this.has_called_process_exit or this.remaining_fds != 0) return;
        if (this.process) |proc| {
            this.process = null;
            proc.detach();
            proc.deref();
        }
        if (this.err_msg != null) {
            this.finish();
            return;
        }
        const status = this.exit_status orelse return;
        switch (status) {
            .exited => |exited| {
                if (exited.code != 0 and !(this.state == .reading_crontab and exited.code == 1) and this.state != .booting_out) {
                    const stderr_output = if (comptime bun.Environment.isWindows)
                        std.mem.trim(u8, this.stderr_reader.finalBuffer().items, &std.ascii.whitespace)
                    else
                        "";
                    // On Windows, detect the SID resolution error and provide
                    // a clear message instead of the raw schtasks output.
                    if (comptime bun.Environment.isWindows) {
                        if (this.state == .installing_crontab and
                            std.mem.indexOf(u8, stderr_output, "No mapping between account names") != null)
                        {
                            this.setErr(
                                "Failed to register cron job: your Windows account's Security Identifier (SID) could not be resolved. " ++
                                    "This typically happens on headless servers or CI where the process runs under a service account. " ++
                                    "To fix this, either run Bun as a regular user account, or create the scheduled task manually with: " ++
                                    "schtasks /create /xml <file> /tn <name> /ru SYSTEM /f",
                                .{},
                            );
                            this.finish();
                            return;
                        }
                    }
                    if (stderr_output.len > 0) {
                        this.setErr("{s}", .{stderr_output});
                    } else {
                        this.setErr("Process exited with code {d}", .{exited.code});
                    }
                    this.finish();
                    return;
                }
            },
            .signaled => |sig| if (this.state != .booting_out) {
                this.setErr("Process killed by signal {d}", .{@intFromEnum(sig)});
                this.finish();
                return;
            },
            .err => |err| {
                this.setErr("Process error: {s}", .{@tagName(err.getErrno())});
                this.finish();
                return;
            },
            .running => return,
        }
        this.advanceState();
    }

    fn advanceState(this: *CronRegisterJob) void {
        if (comptime bun.Environment.isMac) {
            switch (this.state) {
                .writing_plist => this.spawnBootout(),
                .booting_out => this.spawnBootstrap(),
                .bootstrapping => this.finish(),
                else => {
                    this.setErr("Unexpected state", .{});
                    this.finish();
                },
            }
        } else {
            switch (this.state) {
                .reading_crontab => this.processCrontabAndInstall(),
                .installing_crontab => this.finish(),
                else => {
                    this.setErr("Unexpected state", .{});
                    this.finish();
                },
            }
        }
    }

    fn finish(this: *CronRegisterJob) void {
        this.state = if (this.err_msg != null) .failed else .done;
        this.poll.unref(jsc.VirtualMachine.get());
        const ev = jsc.VirtualMachine.get().eventLoop();
        ev.enter();
        defer ev.exit();
        if (this.err_msg) |msg|
            this.promise.reject(this.global, this.global.createErrorInstance("{s}", .{msg})) catch {}
        else
            this.promise.resolve(this.global, .js_undefined) catch {};
        this.deinit();
    }

    fn deinit(this: *CronRegisterJob) void {
        this.stdout_reader.deinit();
        if (this.process) |proc| {
            proc.detach();
            proc.deref();
        }
        if (this.tmp_path) |p| {
            _ = bun.sys.unlink(p);
            bun.default_allocator.free(p);
        }
        if (this.err_msg) |msg| bun.default_allocator.free(msg);
        bun.default_allocator.free(this.abs_path);
        bun.default_allocator.free(this.schedule);
        bun.default_allocator.free(this.raw_schedule);
        bun.default_allocator.free(this.title);
        bun.default_allocator.destroy(this);
    }

    fn spawnCmd(this: *CronRegisterJob, argv: anytype, stdin_opt: bun.spawn.SpawnOptions.Stdio, stdout_opt: bun.spawn.SpawnOptions.Stdio) void {
        spawnCmdGeneric(CronRegisterJob, this, argv, stdin_opt, stdout_opt);
    }

    // -- Linux --

    fn startLinux(this: *CronRegisterJob) void {
        this.state = .reading_crontab;
        this.stdout_reader = OutputReader.init(CronRegisterJob);
        this.stdout_reader.setParent(this);
        const crontab_path = findCrontab() orelse {
            this.setErr("crontab not found in PATH", .{});
            this.finish();
            return;
        };
        var argv = [_:null]?[*:0]const u8{ crontab_path, "-l", null };
        this.spawnCmd(&argv, .ignore, .buffer);
    }

    fn processCrontabAndInstall(this: *CronRegisterJob) void {
        const existing_content = this.stdout_reader.finalBuffer().items;
        var result = std.array_list.Managed(u8).init(bun.default_allocator);
        defer result.deinit();

        filterCrontab(existing_content, this.title, &result) catch {
            this.setErr("Out of memory building crontab", .{});
            this.finish();
            return;
        };

        // Build new entry with single-quoted paths to prevent shell injection
        const new_entry = std.fmt.allocPrint(bun.default_allocator, "# bun-cron: {s}\n{s} '{s}' run --cron-title={s} --cron-period='{s}' '{s}'\n", .{
            this.title, this.schedule, this.bun_exe, this.title, this.schedule, this.abs_path,
        }) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(new_entry);
        result.appendSlice(new_entry) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };

        const tmp_path = makeTempPath("bun-cron-", this.title) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        this.tmp_path = tmp_path;

        const file = bun.sys.File.openat(bun.FD.cwd(), tmp_path, bun.O.WRONLY | bun.O.CREAT | bun.O.EXCL, 0o600).unwrap() catch {
            this.setErr("Failed to create temp file", .{});
            this.finish();
            return;
        };
        defer file.close();
        _ = file.writeAll(result.items).unwrap() catch {
            this.setErr("Failed to write temp file", .{});
            this.finish();
            return;
        };

        this.state = .installing_crontab;
        this.stdout_reader.deinit();
        this.stdout_reader = OutputReader.init(CronRegisterJob);
        const crontab_path = findCrontab() orelse {
            this.setErr("crontab not found in PATH", .{});
            this.finish();
            return;
        };
        var argv = [_:null]?[*:0]const u8{ crontab_path, tmp_path.ptr, null };
        this.spawnCmd(&argv, .ignore, .ignore);
    }

    // -- macOS --

    fn startMac(this: *CronRegisterJob) void {
        this.state = .writing_plist;

        const calendar_xml = cronToCalendarInterval(this.schedule) catch {
            this.setErr("Invalid cron expression", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(calendar_xml);

        const home = bun.env_var.HOME.get() orelse {
            this.setErr("HOME environment variable not set", .{});
            this.finish();
            return;
        };

        const launch_agents_dir = std.fmt.allocPrint(bun.default_allocator, "{s}/Library/LaunchAgents", .{home}) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(launch_agents_dir);
        bun.FD.cwd().makePath(u8, launch_agents_dir) catch {
            this.setErr("Failed to create ~/Library/LaunchAgents directory", .{});
            this.finish();
            return;
        };

        const plist_path = allocPrintZ(bun.default_allocator, "{s}/Library/LaunchAgents/bun.cron.{s}.plist", .{ home, this.title }) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        this.tmp_path = plist_path;

        // XML-escape all dynamic values
        const xml_title = xmlEscape(this.title) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(xml_title);
        const xml_bun = xmlEscape(this.bun_exe) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(xml_bun);
        const xml_path = xmlEscape(this.abs_path) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(xml_path);
        const xml_sched = xmlEscape(this.schedule) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(xml_sched);

        const plist = std.fmt.allocPrint(bun.default_allocator,
            \\<?xml version="1.0" encoding="UTF-8"?>
            \\<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            \\<plist version="1.0">
            \\<dict>
            \\    <key>Label</key>
            \\    <string>bun.cron.{s}</string>
            \\    <key>ProgramArguments</key>
            \\    <array>
            \\        <string>{s}</string>
            \\        <string>run</string>
            \\        <string>--cron-title={s}</string>
            \\        <string>--cron-period={s}</string>
            \\        <string>{s}</string>
            \\    </array>
            \\    <key>StartCalendarInterval</key>
            \\{s}
            \\    <key>StandardOutPath</key>
            \\    <string>/tmp/bun.cron.{s}.stdout.log</string>
            \\    <key>StandardErrorPath</key>
            \\    <string>/tmp/bun.cron.{s}.stderr.log</string>
            \\</dict>
            \\</plist>
            \\
        , .{ xml_title, xml_bun, xml_title, xml_sched, xml_path, calendar_xml, xml_title, xml_title }) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(plist);

        const file = bun.sys.File.openat(bun.FD.cwd(), plist_path, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644).unwrap() catch {
            this.setErr("Failed to create plist file", .{});
            this.finish();
            return;
        };
        defer file.close();
        _ = file.writeAll(plist).unwrap() catch {
            this.setErr("Failed to write plist", .{});
            this.finish();
            return;
        };

        this.spawnBootout();
    }

    fn spawnBootout(this: *CronRegisterJob) void {
        this.state = .booting_out;
        const uid_str = allocPrintZ(bun.default_allocator, "gui/{d}/bun.cron.{s}", .{ getUid(), this.title }) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(uid_str);
        var argv = [_:null]?[*:0]const u8{ "/bin/launchctl", "bootout", uid_str.ptr, null };
        this.spawnCmd(&argv, .ignore, .ignore);
    }

    fn spawnBootstrap(this: *CronRegisterJob) void {
        this.state = .bootstrapping;
        const plist_path = this.tmp_path orelse {
            this.setErr("No plist path", .{});
            this.finish();
            return;
        };
        const uid_str = allocPrintZ(bun.default_allocator, "gui/{d}", .{getUid()}) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(uid_str);
        var argv = [_:null]?[*:0]const u8{ "/bin/launchctl", "bootstrap", uid_str.ptr, plist_path.ptr, null };
        this.tmp_path = null; // don't delete the installed plist
        this.spawnCmd(&argv, .ignore, .ignore);
    }

    // -- JS entry point --

    pub fn cronRegister(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.argumentsAsArray(3);

        if (!args[0].isString()) return globalObject.throwInvalidArguments("Bun.cron() expects a string path as the first argument", .{});
        if (!args[1].isString()) return globalObject.throwInvalidArguments("Bun.cron() expects a string schedule as the second argument", .{});
        if (!args[2].isString()) return globalObject.throwInvalidArguments("Bun.cron() expects a string title as the third argument", .{});

        const path_str = try args[0].toBunString(globalObject);
        defer path_str.deref();
        const schedule_str = try args[1].toBunString(globalObject);
        defer schedule_str.deref();
        const title_str = try args[2].toBunString(globalObject);
        defer title_str.deref();

        const path_slice = path_str.toUTF8(bun.default_allocator);
        defer path_slice.deinit();
        const schedule_slice = schedule_str.toUTF8(bun.default_allocator);
        defer schedule_slice.deinit();
        const title_slice = title_str.toUTF8(bun.default_allocator);
        defer title_slice.deinit();

        // Validate title: only [a-zA-Z0-9_-]
        if (!validateTitle(title_slice.slice()))
            return globalObject.throwInvalidArguments("Cron title must contain only alphanumeric characters, hyphens, and underscores", .{});

        // Parse and normalize cron schedule to numeric form for crontab/launchd/schtasks
        const parsed = CronExpression.parse(schedule_slice.slice()) catch
            return globalObject.throwInvalidArguments("Invalid cron expression. Expected 5 space-separated fields (minute hour day month weekday), each being *, a number, or a range/step pattern", .{});
        var fmt_buf: [512]u8 = undefined;
        const normalized_schedule = parsed.formatNumeric(&fmt_buf);

        const abs_path = resolvePath(globalObject, callframe, path_slice.slice()) catch {
            return globalObject.throwInvalidArguments("Failed to resolve path", .{});
        };

        // Validate path has no single quotes (shell escaping in crontab) or
        // percent signs (cron interprets % as newline before the shell sees it)
        for (abs_path) |c| {
            if (c == '\'') {
                bun.default_allocator.free(abs_path);
                return globalObject.throwInvalidArguments("Path must not contain single quotes", .{});
            }
            if (c == '%') {
                bun.default_allocator.free(abs_path);
                return globalObject.throwInvalidArguments("Path must not contain percent signs (cron interprets % as newline)", .{});
            }
        }

        const bun_exe = bun.selfExePath() catch {
            bun.default_allocator.free(abs_path);
            return globalObject.throw("Failed to get bun executable path", .{});
        };
        const schedule_owned = bun.default_allocator.dupeZ(u8, normalized_schedule) catch {
            bun.default_allocator.free(abs_path);
            return globalObject.throw("Out of memory", .{});
        };
        const raw_schedule_owned = bun.default_allocator.dupeZ(u8, schedule_slice.slice()) catch {
            bun.default_allocator.free(abs_path);
            bun.default_allocator.free(schedule_owned);
            return globalObject.throw("Out of memory", .{});
        };
        const title_owned = bun.default_allocator.dupeZ(u8, title_slice.slice()) catch {
            bun.default_allocator.free(abs_path);
            bun.default_allocator.free(schedule_owned);
            bun.default_allocator.free(raw_schedule_owned);
            return globalObject.throw("Out of memory", .{});
        };

        const job = bun.default_allocator.create(CronRegisterJob) catch {
            bun.default_allocator.free(abs_path);
            bun.default_allocator.free(schedule_owned);
            bun.default_allocator.free(raw_schedule_owned);
            bun.default_allocator.free(title_owned);
            return globalObject.throw("Out of memory", .{});
        };
        job.* = .{ .global = globalObject, .bun_exe = bun_exe, .abs_path = abs_path, .schedule = schedule_owned, .raw_schedule = raw_schedule_owned, .title = title_owned, .parsed_cron = parsed, .promise = jsc.JSPromise.Strong.init(globalObject) };

        const promise_value = job.promise.value();
        job.poll.ref(jsc.VirtualMachine.get());

        if (comptime bun.Environment.isMac)
            job.startMac()
        else if (comptime bun.Environment.isWindows)
            job.startWindows()
        else
            job.startLinux();

        return promise_value;
    }

    // -- Windows --

    fn startWindows(this: *CronRegisterJob) void {
        this.state = .installing_crontab;

        const task_name = allocPrintZ(bun.default_allocator, "bun-cron-{s}", .{this.title}) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(task_name);

        const xml = cronToTaskXml(this.parsed_cron, this.bun_exe, this.title, this.schedule, this.abs_path) catch |err| {
            if (err == error.TooManyTriggers) {
                this.setErr("This cron expression requires too many triggers for Windows Task Scheduler (max 48). Simplify the expression or use fewer restricted fields.", .{});
            } else {
                this.setErr("Failed to build task XML", .{});
            }
            this.finish();
            return;
        };
        defer bun.default_allocator.free(xml);

        const xml_path = makeTempPath("bun-cron-xml-", this.title) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        this.tmp_path = xml_path;

        const file = bun.sys.File.openat(bun.FD.cwd(), xml_path, bun.O.WRONLY | bun.O.CREAT | bun.O.EXCL, 0o600).unwrap() catch {
            this.setErr("Failed to create temp XML file", .{});
            this.finish();
            return;
        };
        defer file.close();
        _ = file.writeAll(xml).unwrap() catch {
            this.setErr("Failed to write temp XML file", .{});
            this.finish();
            return;
        };

        var argv = [_:null]?[*:0]const u8{ "schtasks", "/create", "/xml", xml_path.ptr, "/tn", task_name.ptr, "/np", "/f", null };
        this.spawnCmd(&argv, .ignore, .ignore);
    }
};

// ============================================================================
// CronRemoveJob
// ============================================================================

pub const CronRemoveJob = struct {
    promise: jsc.JSPromise.Strong = .empty,
    global: *jsc.JSGlobalObject,
    poll: bun.Async.KeepAlive = .{},
    title: [:0]const u8,

    state: State = .reading_crontab,
    process: ?*Process = null,
    stdout_reader: OutputReader = OutputReader.init(CronRemoveJob),
    stderr_reader: OutputReader = OutputReader.init(CronRemoveJob),
    remaining_fds: i8 = 0,
    has_called_process_exit: bool = false,
    exit_status: ?bun.spawn.Status = null,
    err_msg: ?[]const u8 = null,
    tmp_path: ?[:0]const u8 = null,

    const State = enum { reading_crontab, installing_crontab, booting_out, done, failed };

    pub const loop = CronJobBase(CronRemoveJob).loop;
    pub const eventLoop = CronJobBase(CronRemoveJob).eventLoop;
    pub const onReaderDone = CronJobBase(CronRemoveJob).onReaderDone;
    pub const onReaderError = CronJobBase(CronRemoveJob).onReaderError;
    pub const onProcessExit = CronJobBase(CronRemoveJob).onProcessExit;

    fn setErr(this: *CronRemoveJob, comptime fmt: []const u8, args: anytype) void {
        if (this.err_msg == null)
            this.err_msg = std.fmt.allocPrint(bun.default_allocator, fmt, args) catch null;
    }

    fn maybeFinished(this: *CronRemoveJob) void {
        if (!this.has_called_process_exit or this.remaining_fds != 0) return;
        if (this.process) |proc| {
            this.process = null;
            proc.detach();
            proc.deref();
        }
        if (this.err_msg != null) {
            this.finish();
            return;
        }
        const status = this.exit_status orelse return;
        switch (status) {
            .exited => |exited| {
                const is_acceptable_nonzero = (this.state == .reading_crontab and exited.code == 1) or
                    this.state == .booting_out or
                    // On Windows, schtasks /delete exits non-zero when the task doesn't exist;
                    // removal of a non-existent job should resolve without error.
                    (if (comptime bun.Environment.isWindows) this.state == .installing_crontab else false);
                if (exited.code != 0 and !is_acceptable_nonzero) {
                    const stderr_output = if (comptime bun.Environment.isWindows)
                        std.mem.trim(u8, this.stderr_reader.finalBuffer().items, &std.ascii.whitespace)
                    else
                        "";
                    if (stderr_output.len > 0) {
                        this.setErr("{s}", .{stderr_output});
                    } else {
                        this.setErr("Process exited with code {d}", .{exited.code});
                    }
                    this.finish();
                    return;
                }
            },
            .signaled => |sig| if (this.state != .booting_out) {
                this.setErr("Process killed by signal {d}", .{@intFromEnum(sig)});
                this.finish();
                return;
            },
            .err => |err| {
                this.setErr("Process error: {s}", .{@tagName(err.getErrno())});
                this.finish();
                return;
            },
            .running => return,
        }
        this.advanceState();
    }

    fn advanceState(this: *CronRemoveJob) void {
        if (comptime bun.Environment.isMac) {
            switch (this.state) {
                .booting_out => {
                    const home = bun.env_var.HOME.get() orelse {
                        this.setErr("HOME not set", .{});
                        this.finish();
                        return;
                    };
                    const plist_path = allocPrintZ(bun.default_allocator, "{s}/Library/LaunchAgents/bun.cron.{s}.plist", .{ home, this.title }) catch {
                        this.setErr("Out of memory", .{});
                        this.finish();
                        return;
                    };
                    _ = bun.sys.unlink(plist_path);
                    bun.default_allocator.free(plist_path);
                    this.finish();
                },
                else => {
                    this.setErr("Unexpected state", .{});
                    this.finish();
                },
            }
        } else {
            switch (this.state) {
                .reading_crontab => this.removeCrontabEntry(),
                .installing_crontab => this.finish(),
                else => {
                    this.setErr("Unexpected state", .{});
                    this.finish();
                },
            }
        }
    }

    fn finish(this: *CronRemoveJob) void {
        this.state = if (this.err_msg != null) .failed else .done;
        this.poll.unref(jsc.VirtualMachine.get());
        const ev = jsc.VirtualMachine.get().eventLoop();
        ev.enter();
        defer ev.exit();
        if (this.err_msg) |msg|
            this.promise.reject(this.global, this.global.createErrorInstance("{s}", .{msg})) catch {}
        else
            this.promise.resolve(this.global, .js_undefined) catch {};
        this.deinit();
    }

    fn deinit(this: *CronRemoveJob) void {
        this.stdout_reader.deinit();
        if (this.process) |proc| {
            proc.detach();
            proc.deref();
        }
        if (this.tmp_path) |p| {
            _ = bun.sys.unlink(p);
            bun.default_allocator.free(p);
        }
        if (this.err_msg) |msg| bun.default_allocator.free(msg);
        bun.default_allocator.free(this.title);
        bun.default_allocator.destroy(this);
    }

    fn spawnCmd(this: *CronRemoveJob, argv: anytype, stdin_opt: bun.spawn.SpawnOptions.Stdio, stdout_opt: bun.spawn.SpawnOptions.Stdio) void {
        spawnCmdGeneric(CronRemoveJob, this, argv, stdin_opt, stdout_opt);
    }

    fn startLinux(this: *CronRemoveJob) void {
        this.state = .reading_crontab;
        this.stdout_reader = OutputReader.init(CronRemoveJob);
        this.stdout_reader.setParent(this);
        const crontab_path = findCrontab() orelse {
            this.setErr("crontab not found in PATH", .{});
            this.finish();
            return;
        };
        var argv = [_:null]?[*:0]const u8{ crontab_path, "-l", null };
        this.spawnCmd(&argv, .ignore, .buffer);
    }

    fn removeCrontabEntry(this: *CronRemoveJob) void {
        const existing_content = this.stdout_reader.finalBuffer().items;
        var result = std.array_list.Managed(u8).init(bun.default_allocator);
        defer result.deinit();

        filterCrontab(existing_content, this.title, &result) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };

        const tmp_path = makeTempPath("bun-cron-rm-", this.title) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        this.tmp_path = tmp_path;

        const file = bun.sys.File.openat(bun.FD.cwd(), tmp_path, bun.O.WRONLY | bun.O.CREAT | bun.O.EXCL, 0o600).unwrap() catch {
            this.setErr("Failed to create temp file", .{});
            this.finish();
            return;
        };
        defer file.close();
        _ = file.writeAll(result.items).unwrap() catch {
            this.setErr("Failed to write temp file", .{});
            this.finish();
            return;
        };

        this.state = .installing_crontab;
        this.stdout_reader.deinit();
        this.stdout_reader = OutputReader.init(CronRemoveJob);
        const crontab_path = findCrontab() orelse {
            this.setErr("crontab not found in PATH", .{});
            this.finish();
            return;
        };
        var argv = [_:null]?[*:0]const u8{ crontab_path, tmp_path.ptr, null };
        this.spawnCmd(&argv, .ignore, .ignore);
    }

    fn startMac(this: *CronRemoveJob) void {
        this.state = .booting_out;
        const uid_str = allocPrintZ(bun.default_allocator, "gui/{d}/bun.cron.{s}", .{ getUid(), this.title }) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(uid_str);
        var argv = [_:null]?[*:0]const u8{ "/bin/launchctl", "bootout", uid_str.ptr, null };
        this.spawnCmd(&argv, .ignore, .ignore);
    }

    pub fn cronRemove(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.argumentsAsArray(1);
        if (!args[0].isString()) return globalObject.throwInvalidArguments("Bun.cron.remove() expects a string title", .{});

        const title_str = try args[0].toBunString(globalObject);
        defer title_str.deref();
        const title_slice = title_str.toUTF8(bun.default_allocator);
        defer title_slice.deinit();

        if (!validateTitle(title_slice.slice()))
            return globalObject.throwInvalidArguments("Cron title must contain only alphanumeric characters, hyphens, and underscores", .{});

        const title_owned = bun.default_allocator.dupeZ(u8, title_slice.slice()) catch return globalObject.throw("Out of memory", .{});
        const job = bun.default_allocator.create(CronRemoveJob) catch {
            bun.default_allocator.free(title_owned);
            return globalObject.throw("Out of memory", .{});
        };
        job.* = .{ .global = globalObject, .title = title_owned, .promise = jsc.JSPromise.Strong.init(globalObject) };

        const promise_value = job.promise.value();
        job.poll.ref(jsc.VirtualMachine.get());
        if (comptime bun.Environment.isMac)
            job.startMac()
        else if (comptime bun.Environment.isWindows)
            job.startWindows()
        else
            job.startLinux();
        return promise_value;
    }

    fn startWindows(this: *CronRemoveJob) void {
        this.state = .installing_crontab;
        const task_name = allocPrintZ(bun.default_allocator, "bun-cron-{s}", .{this.title}) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(task_name);
        var argv = [_:null]?[*:0]const u8{ "schtasks", "/delete", "/tn", task_name.ptr, "/f", null };
        this.spawnCmd(&argv, .ignore, .ignore);
    }
};

// ============================================================================
// Bun.cron object builder
// ============================================================================

pub fn getCronObject(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    const cron_fn = jsc.JSFunction.create(globalThis, "cron", CronRegisterJob.cronRegister, 3, .{});
    const remove_fn = jsc.JSFunction.create(globalThis, "remove", CronRemoveJob.cronRemove, 1, .{});
    const parse_fn = jsc.JSFunction.create(globalThis, "parse", cronParse, 1, .{});
    cron_fn.put(globalThis, bun.String.static("remove"), remove_fn);
    cron_fn.put(globalThis, bun.String.static("parse"), parse_fn);
    return cron_fn;
}

pub fn cronParse(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.argumentsAsArray(2);

    if (!args[0].isString())
        return globalObject.throwInvalidArguments("Bun.cron.parse() expects a string cron expression as the first argument", .{});

    const expr_str = try args[0].toBunString(globalObject);
    defer expr_str.deref();
    const expr_slice = expr_str.toUTF8(bun.default_allocator);
    defer expr_slice.deinit();

    const parsed = CronExpression.parse(expr_slice.slice()) catch
        return globalObject.throwInvalidArguments("Invalid cron expression. Expected 5 space-separated fields (minute hour day month weekday), each being *, a number, or a range/step pattern", .{});

    const from_ms: f64 = if (args[1] != .zero and !args[1].isUndefined() and args[1] != .null) blk: {
        if (args[1].isNumber()) {
            break :blk try args[1].toNumber(globalObject);
        } else if (args[1].jsType() == .JSDate) {
            break :blk try args[1].toNumber(globalObject);
        } else {
            return globalObject.throwInvalidArguments("Bun.cron.parse() expects the second argument to be a Date or number (ms since epoch)", .{});
        }
    } else @as(f64, @floatFromInt(std.time.milliTimestamp()));

    if (std.math.isNan(from_ms) or std.math.isInf(from_ms))
        return globalObject.throwInvalidArguments("Invalid date value", .{});

    const next_ms = (try parsed.next(globalObject, from_ms)) orelse return .null;
    return jsc.JSValue.fromDateNumber(globalObject, next_ms);
}

// ============================================================================
// Shared helpers
// ============================================================================

/// Generic spawn used by both CronRegisterJob and CronRemoveJob.
fn spawnCmdGeneric(comptime Self: type, this: *Self, argv: anytype, stdin_opt: bun.spawn.SpawnOptions.Stdio, stdout_opt: bun.spawn.SpawnOptions.Stdio) void {
    this.has_called_process_exit = false;
    this.exit_status = null;
    this.remaining_fds = 0;

    var resolved_argv0: ?[*:0]const u8 = null;
    if (comptime bun.Environment.isWindows) {
        // Resolve the executable via bun.which, matching Bun.spawn's behavior.
        var path_buf: bun.PathBuffer = undefined;
        const PATH = jsc.VirtualMachine.get().transpiler.env.map.get("PATH") orelse "";
        resolved_argv0 = bun.which(&path_buf, PATH, "", bun.sliceTo(argv[0].?, 0)) orelse {
            this.setErr("Could not find '{s}' in PATH", .{bun.sliceTo(argv[0].?, 0)});
            this.finish();
            return;
        };
    }
    if (comptime bun.Environment.isWindows) {
        this.stderr_reader.source = .{ .pipe = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) };
    }
    const cwd = jsc.VirtualMachine.get().transpiler.fs.top_level_dir;
    const spawn_options = bun.spawn.SpawnOptions{
        .stdin = stdin_opt,
        .stdout = stdout_opt,
        .stderr = if (comptime bun.Environment.isWindows) .{ .buffer = this.stderr_reader.source.?.pipe } else .ignore,
        .cwd = cwd,
        .argv0 = resolved_argv0,
        .windows = if (comptime bun.Environment.isWindows) .{
            .loop = jsc.EventLoopHandle.init(jsc.VirtualMachine.get().eventLoop()),
        },
    };

    const envp: [*:null]?[*:0]const u8 = if (comptime bun.Environment.isPosix)
        @ptrCast(@constCast(std.c.environ))
    else
        @ptrCast((jsc.VirtualMachine.get().transpiler.env.map.createNullDelimitedEnvMap(bun.default_allocator) catch {
            this.setErr("Failed to create environment block", .{});
            this.finish();
            return;
        }).ptr);
    var spawned = (bun.spawn.spawnProcess(&spawn_options, @ptrCast(argv), envp) catch |e| {
        this.setErr("Failed to spawn process: {s}", .{@errorName(e)});
        this.finish();
        return;
    }).unwrap() catch |err| {
        this.setErr("Failed to spawn process: {s}", .{@errorName(err)});
        this.finish();
        return;
    };

    if (comptime bun.Environment.isPosix) {
        if (spawned.stdout) |stdout| {
            if (!spawned.memfds[1]) {
                this.stdout_reader.setParent(this);
                _ = bun.sys.setNonblocking(stdout);
                this.remaining_fds += 1;
                this.stdout_reader.flags.nonblocking = true;
                this.stdout_reader.flags.socket = true;
                this.stdout_reader.flags.memfd = false;
                this.stdout_reader.flags.received_eof = false;
                this.stdout_reader.flags.closed_without_reporting = false;
                this.stdout_reader.start(stdout, true).unwrap() catch {
                    this.setErr("Failed to start reading stdout", .{});
                    this.finish();
                    return;
                };
                if (this.stdout_reader.handle.getPoll()) |p| p.flags.insert(.socket);
            } else {
                this.stdout_reader.setParent(this);
                this.stdout_reader.startMemfd(stdout);
            }
        }
    }
    if (comptime bun.Environment.isWindows) {
        if (spawned.stderr == .buffer) {
            this.stderr_reader.parent = this;
            this.remaining_fds += 1;
            this.stderr_reader.startWithCurrentPipe().unwrap() catch {
                this.setErr("Failed to start reading stderr", .{});
                this.finish();
                return;
            };
        }
    }

    var process = spawned.toProcess(jsc.VirtualMachine.get().eventLoop(), false);
    this.process = process;
    process.setExitHandler(this);
    switch (process.watchOrReap()) {
        .err => |err| {
            if (!process.hasExited()) process.onExit(.{ .err = err }, &std.mem.zeroes(bun.spawn.Rusage));
        },
        .result => {},
    }
}

/// Find crontab binary using bun.which (searches PATH).
fn findCrontab() ?[*:0]const u8 {
    if (comptime bun.Environment.isWindows) return null;
    const static = struct {
        var buf: bun.PathBuffer = undefined;
    };
    const path_env = bun.env_var.PATH.get() orelse "/usr/bin:/bin";
    return (bun.which(&static.buf, path_env, "", "crontab") orelse return null).ptr;
}

/// Get the current user ID portably.
fn getUid() u32 {
    return if (comptime bun.Environment.isPosix) bun.c.getuid() else 0;
}

/// Validate title: only [a-zA-Z0-9_-], non-empty.
fn validateTitle(title: []const u8) bool {
    if (title.len == 0) return false;
    for (title) |c| {
        if (!std.ascii.isAlphanumeric(c) and c != '-' and c != '_') return false;
    }
    return true;
}

/// Filter crontab content, removing any entry with matching title marker.
fn filterCrontab(content: []const u8, title: [:0]const u8, result: *std.array_list.Managed(u8)) !void {
    const marker = try std.fmt.allocPrint(bun.default_allocator, "# bun-cron: {s}", .{title});
    defer bun.default_allocator.free(marker);
    var skip_next = false;
    var lines = std.mem.splitScalar(u8, content, '\n');
    while (lines.next()) |line| {
        if (skip_next) {
            skip_next = false;
            continue;
        }
        if (bun.strings.eql(bun.strings.trim(line, " \t"), marker)) {
            skip_next = true;
            continue;
        }
        if (line.len > 0) {
            try result.appendSlice(line);
            try result.append('\n');
        }
    }
}

fn resolvePath(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, path: []const u8) ![:0]const u8 {
    const vm = globalObject.bunVM();
    const srcloc = callframe.getCallerSrcLoc(globalObject);
    defer srcloc.str.deref();
    const caller_utf8 = srcloc.str.toUTF8(bun.default_allocator);
    defer caller_utf8.deinit();
    const raw_dir = bun.path.dirname(caller_utf8.slice(), .auto);
    const source_dir = if (raw_dir.len == 0) "." else raw_dir;
    var resolved = vm.transpiler.resolver.resolve(source_dir, path, .entry_point_run) catch return error.ModuleNotFound;
    const entry_path = resolved.path() orelse return error.ModuleNotFound;
    return bun.default_allocator.dupeZ(u8, entry_path.text);
}

/// XML-escape a string for safe embedding in plist XML.
fn xmlEscape(input: []const u8) ![]const u8 {
    var needs_escape = false;
    for (input) |c| {
        if (c == '&' or c == '<' or c == '>' or c == '"' or c == '\'') {
            needs_escape = true;
            break;
        }
    }
    if (!needs_escape) return bun.default_allocator.dupe(u8, input);

    var result = std.array_list.Managed(u8).init(bun.default_allocator);
    errdefer result.deinit();
    for (input) |c| {
        switch (c) {
            '&' => try result.appendSlice("&amp;"),
            '<' => try result.appendSlice("&lt;"),
            '>' => try result.appendSlice("&gt;"),
            '"' => try result.appendSlice("&quot;"),
            '\'' => try result.appendSlice("&apos;"),
            else => try result.append(c),
        }
    }
    return result.toOwnedSlice();
}

fn cronToCalendarInterval(schedule: []const u8) ![]const u8 {
    var fields: [5][]const u8 = undefined;
    var count: usize = 0;
    var iter = std.mem.tokenizeScalar(u8, schedule, ' ');
    while (iter.next()) |field| {
        if (count >= 5) return error.InvalidCron;
        fields[count] = field;
        count += 1;
    }
    if (count != 5) return error.InvalidCron;

    // Parse each field into a list of integer values (or null for "*")
    var field_values: [5]?[]const i32 = .{ null, null, null, null, null };
    defer for (&field_values) |*fv| {
        if (fv.*) |v| bun.default_allocator.free(v);
    };
    for (fields[0..5], &field_values) |field, *fv| {
        if (bun.strings.eql(field, "*")) continue;
        var vals = std.array_list.Managed(i32).init(bun.default_allocator);
        errdefer vals.deinit();
        var parts = std.mem.splitScalar(u8, field, ',');
        while (parts.next()) |part| {
            const val = std.fmt.parseInt(i32, part, 10) catch return error.InvalidCron;
            try vals.append(val);
        }
        fv.* = try vals.toOwnedSlice();
    }

    // Generate StartCalendarInterval dicts.
    // For wildcard fields, omit the key entirely (launchd treats missing = all).
    //
    // POSIX cron OR semantics: when BOTH day-of-month and day-of-week are non-wildcard,
    // the job fires when EITHER matches. launchd ANDs keys within a single dict, so we
    // emit two separate sets of dicts: one with Day (no Weekday) and one with Weekday
    // (no Day). launchd fires when ANY dict matches, achieving OR behavior.
    var result = std.array_list.Managed(u8).init(bun.default_allocator);
    errdefer result.deinit();

    const has_dom = field_values[2] != null;
    const has_dow = field_values[4] != null;
    const needs_or_split = has_dom and has_dow;

    // Determine if we need an <array> wrapper (multiple dicts or OR split)
    const needs_product = for (field_values) |fv| {
        if (fv) |v| if (v.len > 1) break true;
    } else false;
    const needs_array = needs_product or needs_or_split;

    if (!needs_array) {
        // Single dict, no product needed
        const plist_keys = [_][]const u8{ "Minute", "Hour", "Day", "Month", "Weekday" };
        try result.appendSlice("    <dict>\n");
        for (field_values, plist_keys) |fv, key| {
            if (fv) |vals| {
                if (vals.len == 1) {
                    try appendCalendarKey(&result, key, vals[0]);
                }
            }
        }
        try result.appendSlice("    </dict>");
    } else {
        try result.appendSlice("    <array>\n");

        if (needs_or_split) {
            // OR split: emit day-of-month dicts (no Weekday), then day-of-week dicts (no Day)
            // Pass 1: Day + time fields (minute, hour, day, month — no weekday)
            try emitCalendarDicts(&result, field_values, .exclude_weekday);
            // Pass 2: Weekday + time fields (minute, hour, weekday, month — no day)
            try emitCalendarDicts(&result, field_values, .exclude_day);
        } else {
            // Normal Cartesian product: all fields together
            try emitCalendarDicts(&result, field_values, .include_all);
        }

        try result.appendSlice("    </array>");
    }
    return result.toOwnedSlice();
}

fn appendCalendarKey(result: *std.array_list.Managed(u8), key: []const u8, val: i32) !void {
    const line = try std.fmt.allocPrint(bun.default_allocator, "        <key>{s}</key>\n        <integer>{d}</integer>\n", .{ key, val });
    defer bun.default_allocator.free(line);
    try result.appendSlice(line);
}

const EmitMode = enum { include_all, exclude_weekday, exclude_day };

/// Emit Cartesian-product <dict> entries for the given field values.
/// In exclude_weekday mode, day-of-week (index 4) is treated as wildcard.
/// In exclude_day mode, day-of-month (index 2) is treated as wildcard.
fn emitCalendarDicts(result: *std.array_list.Managed(u8), field_values: [5]?[]const i32, mode: EmitMode) !void {
    const plist_keys = [_][]const u8{ "Minute", "Hour", "Day", "Month", "Weekday" };

    // Build effective field values based on mode
    var effective: [5]?[]const i32 = field_values;
    switch (mode) {
        .exclude_weekday => effective[4] = null,
        .exclude_day => effective[2] = null,
        .include_all => {},
    }

    const iter_mins: []const i32 = if (effective[0]) |v| v else &.{0};
    const iter_hrs: []const i32 = if (effective[1]) |v| v else &.{0};
    const iter_days: []const i32 = if (effective[2]) |v| v else &.{0};
    const iter_mons: []const i32 = if (effective[3]) |v| v else &.{0};
    const iter_wdays: []const i32 = if (effective[4]) |v| v else &.{0};

    for (iter_mins) |m| {
        for (iter_hrs) |h| {
            for (iter_days) |d| {
                for (iter_mons) |mo| {
                    for (iter_wdays) |w| {
                        try result.appendSlice("    <dict>\n");
                        if (effective[0] != null) try appendCalendarKey(result, plist_keys[0], m);
                        if (effective[1] != null) try appendCalendarKey(result, plist_keys[1], h);
                        if (effective[2] != null) try appendCalendarKey(result, plist_keys[2], d);
                        if (effective[3] != null) try appendCalendarKey(result, plist_keys[3], mo);
                        if (effective[4] != null) try appendCalendarKey(result, plist_keys[4], w);
                        try result.appendSlice("    </dict>\n");
                    }
                }
            }
        }
    }
}

/// Build a Windows Task Scheduler XML definition from a parsed cron expression.
/// Uses TimeTrigger+Repetition for simple intervals, CalendarTrigger for complex schedules.
fn cronToTaskXml(
    cron: CronExpression,
    bun_exe: []const u8,
    title: []const u8,
    schedule: []const u8,
    abs_path: []const u8,
) ![]const u8 {
    const allocator = bun.default_allocator;
    var xml = std.array_list.Managed(u8).init(allocator);
    errdefer xml.deinit();

    try xml.appendSlice(
        \\<?xml version="1.0"?>
        \\<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
        \\  <Triggers>
        \\
    );

    // Use semantic checks (bitfield values) not syntax flags for wildcard detection.
    // e.g. "*/1" sets all bits just like "*" but has _is_wildcard=false.
    const all_days: u32 = ((1 << 32) - 1) & ~@as(u32, 1); // bits 1-31
    const all_months: u16 = ((1 << 13) - 1) & ~@as(u16, 1); // bits 1-12
    const all_weekdays: u8 = (1 << 7) - 1; // bits 0-6

    const days_is_wild = cron.days == all_days;
    const weekdays_is_wild = cron.weekdays == all_weekdays;
    const months_is_wild = cron.months == all_months;

    // Try to use a single trigger with Repetition for simple repeating patterns.
    // This avoids the 48-trigger limit for high-frequency expressions.
    // Only valid when: (a) all days/weekdays/months are wild, AND
    // (b) the pattern is expressible as a single PT interval that doesn't drift.
    const minute_interval = computeStepInterval(u64, cron.minutes, 0, 59);
    const hour_interval = computeStepInterval(u32, cron.hours, 0, 23);
    const minutes_count: u32 = @popCount(cron.minutes);
    const hours_count: u32 = @popCount(cron.hours);

    // Case 1: All hours active, evenly-spaced minutes that divide 60
    //   e.g. "* * * * *" → PT1M, "*/5 * * * *" → PT5M, "*/15 * * * *" → PT15M
    // Case 2: Single minute, evenly-spaced hours that divide 24
    //   e.g. "0 * * * *" → PT1H, "0 */2 * * *" → PT2H, "30 */6 * * *" → PT6H
    const can_use_repetition = days_is_wild and weekdays_is_wild and months_is_wild and blk: {
        if (hours_count == 24 and minute_interval != null and minute_interval.? <= 60 and 60 % minute_interval.? == 0 and minutes_count == 60 / minute_interval.?) {
            break :blk true; // Case 1
        }
        if (minutes_count == 1 and hour_interval != null and hour_interval.? <= 24 and 24 % hour_interval.? == 0 and hours_count == 24 / hour_interval.?) {
            break :blk true; // Case 2
        }
        break :blk false;
    };

    if (can_use_repetition) {
        const first_min: u32 = @ctz(cron.minutes);
        const first_hour: u32 = @ctz(cron.hours);

        var sb_buf: [32]u8 = undefined;
        const sb = std.fmt.bufPrint(&sb_buf, "2000-01-01T{d:0>2}:{d:0>2}:00", .{ first_hour, first_min }) catch return error.InvalidCron;

        try xml.appendSlice("    <CalendarTrigger>\n");
        var line_buf: [128]u8 = undefined;
        const sb_line = std.fmt.bufPrint(&line_buf, "      <StartBoundary>{s}</StartBoundary>\n", .{sb}) catch return error.InvalidCron;
        try xml.appendSlice(sb_line);

        if (hours_count == 24) {
            // Case 1: minute-based repetition
            const m = minute_interval.?;
            if (m == 1) {
                try xml.appendSlice("      <Repetition><Interval>PT1M</Interval></Repetition>\n");
            } else {
                const rep = std.fmt.bufPrint(&line_buf, "      <Repetition><Interval>PT{d}M</Interval></Repetition>\n", .{m}) catch return error.InvalidCron;
                try xml.appendSlice(rep);
            }
        } else {
            // Case 2: hour-based repetition
            const h = hour_interval.?;
            if (h > 1) {
                const rep = std.fmt.bufPrint(&line_buf, "      <Repetition><Interval>PT{d}H</Interval></Repetition>\n", .{h}) catch return error.InvalidCron;
                try xml.appendSlice(rep);
            }
        }

        try xml.appendSlice("      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n");
        try xml.appendSlice("    </CalendarTrigger>\n");
    } else {
        // Complex pattern: emit CalendarTriggers for each hour×minute pair.
        // Cap at 48 triggers (Task Scheduler limit).
        const needs_or_split = !days_is_wild and !weekdays_is_wild;
        const triggers_per_time: u32 = if (needs_or_split) 2 else 1;
        const total_triggers = minutes_count * hours_count * triggers_per_time;
        if (total_triggers > 48) return error.TooManyTriggers;

        var hours_bits = cron.hours;
        while (hours_bits != 0) {
            const h: u32 = @ctz(hours_bits);
            hours_bits &= hours_bits - 1;
            var mins_bits = cron.minutes;
            while (mins_bits != 0) {
                const m: u32 = @ctz(mins_bits);
                mins_bits &= mins_bits - 1;
                var sb_buf: [32]u8 = undefined;
                const sb = std.fmt.bufPrint(&sb_buf, "2000-01-01T{d:0>2}:{d:0>2}:00", .{
                    @as(u32, @intCast(h)), @as(u32, @intCast(m)),
                }) catch return error.InvalidCron;

                // Emit day-of-month trigger if needed
                if (!days_is_wild) {
                    try appendCalendarTriggerWithSchedule(&xml, allocator, sb, .{ .by_month = .{ .cron = cron, .months_is_wild = months_is_wild } });
                }

                // Emit day-of-week trigger if needed
                if (!weekdays_is_wild) {
                    if (months_is_wild) {
                        try appendCalendarTriggerWithSchedule(&xml, allocator, sb, .{ .by_week = cron.weekdays });
                    } else {
                        // Use ScheduleByMonthDayOfWeek to include month restrictions
                        try appendCalendarTriggerWithSchedule(&xml, allocator, sb, .{ .by_month_dow = .{ .cron = cron, .months_is_wild = months_is_wild } });
                    }
                }

                // Both wildcard: every day (with optional month restriction)
                if (days_is_wild and weekdays_is_wild) {
                    if (months_is_wild) {
                        try appendCalendarTriggerWithSchedule(&xml, allocator, sb, .{ .by_day = {} });
                    } else {
                        // Daily but restricted months → use ScheduleByMonth with all days
                        try appendCalendarTriggerWithSchedule(&xml, allocator, sb, .{ .by_month_all_days = cron.months });
                    }
                }
            }
        }
    }

    // Close triggers, add action
    const xml_bun = try xmlEscape(bun_exe);
    defer allocator.free(xml_bun);
    const xml_title = try xmlEscape(title);
    defer allocator.free(xml_title);
    const xml_sched = try xmlEscape(schedule);
    defer allocator.free(xml_sched);
    const xml_path = try xmlEscape(abs_path);
    defer allocator.free(xml_path);

    const action_xml = try std.fmt.allocPrint(allocator,
        \\  </Triggers>
        \\  <Principals>
        \\    <Principal>
        \\      <LogonType>S4U</LogonType>
        \\      <RunLevel>LeastPrivilege</RunLevel>
        \\    </Principal>
        \\  </Principals>
        \\  <Settings>
        \\    <Enabled>true</Enabled>
        \\    <AllowStartOnDemand>true</AllowStartOnDemand>
        \\    <AllowHardTerminate>true</AllowHardTerminate>
        \\    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
        \\    <StartWhenAvailable>true</StartWhenAvailable>
        \\  </Settings>
        \\  <Actions>
        \\    <Exec>
        \\      <Command>{s}</Command>
        \\      <Arguments>run --cron-title={s} --cron-period="{s}" "{s}"</Arguments>
        \\    </Exec>
        \\  </Actions>
        \\</Task>
        \\
    , .{ xml_bun, xml_title, xml_sched, xml_path });
    defer allocator.free(action_xml);
    try xml.appendSlice(action_xml);

    return xml.toOwnedSlice();
}

fn appendDaysOfMonthXml(xml: *std.array_list.Managed(u8), days: u32) !void {
    try xml.appendSlice("        <DaysOfMonth>\n");
    var buf: [32]u8 = undefined;
    for (1..32) |day| {
        if (days & (@as(u32, 1) << @intCast(day)) != 0) {
            const line = std.fmt.bufPrint(&buf, "          <Day>{d}</Day>\n", .{day}) catch return error.InvalidCron;
            try xml.appendSlice(line);
        }
    }
    try xml.appendSlice("        </DaysOfMonth>\n");
}
fn appendMonthsXml(xml: *std.array_list.Managed(u8), months: u16) !void {
    const month_names = [_][]const u8{ "", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" };
    try xml.appendSlice("        <Months>\n");
    var buf: [32]u8 = undefined;
    for (1..13) |mo| {
        if (months & (@as(u16, 1) << @intCast(mo)) != 0) {
            const line = std.fmt.bufPrint(&buf, "          <{s}/>\n", .{month_names[mo]}) catch return error.InvalidCron;
            try xml.appendSlice(line);
        }
    }
    try xml.appendSlice("        </Months>\n");
}

fn appendDaysOfWeekXml(xml: *std.array_list.Managed(u8), weekdays: u8) !void {
    const day_names = [_][]const u8{ "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };
    try xml.appendSlice("        <DaysOfWeek>\n");
    var buf: [32]u8 = undefined;
    for (0..7) |d| {
        if (weekdays & (@as(u8, 1) << @intCast(d)) != 0) {
            const line = std.fmt.bufPrint(&buf, "          <{s}/>\n", .{day_names[d]}) catch return error.InvalidCron;
            try xml.appendSlice(line);
        }
    }
    try xml.appendSlice("        </DaysOfWeek>\n");
}

const ScheduleType = union(enum) {
    by_day: void,
    by_week: u8, // weekdays bitmask
    by_month: struct { cron: CronExpression, months_is_wild: bool },
    by_month_dow: struct { cron: CronExpression, months_is_wild: bool },
    by_month_all_days: u16, // months bitmask (daily with month restriction)
};

fn appendCalendarTriggerWithSchedule(xml: *std.array_list.Managed(u8), _: std.mem.Allocator, start_boundary: []const u8, sched: ScheduleType) !void {
    try xml.appendSlice("    <CalendarTrigger>\n");
    var sb_buf: [80]u8 = undefined;
    const sb_line = std.fmt.bufPrint(&sb_buf, "      <StartBoundary>{s}</StartBoundary>\n", .{start_boundary}) catch return error.OutOfMemory;
    try xml.appendSlice(sb_line);

    switch (sched) {
        .by_day => {
            try xml.appendSlice("      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n");
        },
        .by_week => |weekdays| {
            try xml.appendSlice("      <ScheduleByWeek>\n");
            try xml.appendSlice("        <WeeksInterval>1</WeeksInterval>\n");
            try appendDaysOfWeekXml(xml, weekdays);
            try xml.appendSlice("      </ScheduleByWeek>\n");
        },
        .by_month => |info| {
            try xml.appendSlice("      <ScheduleByMonth>\n");
            try appendDaysOfMonthXml(xml, info.cron.days);
            try appendMonthsXml(xml, info.cron.months);
            try xml.appendSlice("      </ScheduleByMonth>\n");
        },
        .by_month_dow => |info| {
            // ScheduleByMonthDayOfWeek: weekday + month restriction
            try xml.appendSlice("      <ScheduleByMonthDayOfWeek>\n");
            try xml.appendSlice("        <Weeks><Week>1</Week><Week>2</Week><Week>3</Week><Week>4</Week><Week>Last</Week></Weeks>\n");
            try appendDaysOfWeekXml(xml, info.cron.weekdays);
            try appendMonthsXml(xml, info.cron.months);
            try xml.appendSlice("      </ScheduleByMonthDayOfWeek>\n");
        },
        .by_month_all_days => |months| {
            try xml.appendSlice("      <ScheduleByMonth>\n");
            try appendDaysOfMonthXml(xml, 0xFFFFFFFE);
            try appendMonthsXml(xml, months);
            try xml.appendSlice("      </ScheduleByMonth>\n");
        },
    }

    try xml.appendSlice("    </CalendarTrigger>\n");
}

/// If all set bits are evenly spaced, return the step size. Otherwise null.
fn computeStepInterval(comptime T: type, bits: T, _: u7, max: u7) ?u32 {
    if (bits == 0) return null;
    const count = @popCount(bits);
    if (count == 1) return @as(u32, max) + 1;
    // Find first two set bits to determine step
    var remaining = bits;
    const first: u32 = @ctz(remaining);
    remaining &= remaining - 1;
    const second: u32 = @ctz(remaining);
    const step = second - first;
    // Verify all bits are evenly spaced
    remaining &= remaining - 1;
    var prev = second;
    while (remaining != 0) {
        const next: u32 = @ctz(remaining);
        if (next - prev != step) return null;
        prev = next;
        remaining &= remaining - 1;
    }
    return step;
}

fn allocPrintZ(allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) std.mem.Allocator.Error![:0]const u8 {
    const slice = try std.fmt.allocPrint(allocator, fmt, args);
    defer allocator.free(slice);
    return allocator.dupeZ(u8, slice);
}

/// Create a temp file path with a random suffix to avoid TOCTOU/symlink attacks.
fn makeTempPath(comptime prefix: []const u8, title: []const u8) ![:0]const u8 {
    _ = title;
    var name_buf: bun.PathBuffer = undefined;
    const name = bun.fs.FileSystem.tmpname(prefix ++ "tmp", &name_buf, bun.fastRandom()) catch return error.OutOfMemory;
    return bun.default_allocator.dupeZ(u8, bun.path.joinAbsString(bun.fs.FileSystem.RealFS.platformTempDir(), &.{name}, .auto));
}

const std = @import("std");
const CronExpression = @import("./cron_parser.zig").CronExpression;

const bun = @import("bun");
const jsc = bun.jsc;
const OutputReader = bun.io.BufferedReader;
const Process = bun.spawn.Process;
