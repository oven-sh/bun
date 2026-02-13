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

const OutputReader = bun.io.BufferedReader;
const Process = bun.spawn.Process;

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

    state: State = .reading_crontab,
    process: ?*Process = null,
    stdout_reader: OutputReader = OutputReader.init(CronRegisterJob),
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
                    this.setErr("Process exited with code {d}", .{exited.code});
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

        // Validate path has no single quotes (used for shell escaping in crontab)
        for (abs_path) |c| {
            if (c == '\'') {
                bun.default_allocator.free(abs_path);
                return globalObject.throwInvalidArguments("Path must not contain single quotes", .{});
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
        job.* = .{ .global = globalObject, .bun_exe = bun_exe, .abs_path = abs_path, .schedule = schedule_owned, .raw_schedule = raw_schedule_owned, .title = title_owned, .promise = jsc.JSPromise.Strong.init(globalObject) };

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
        // Use schtasks /create with /sc and /tr to register a task.
        // Task name: "bun-cron-<title>"
        this.state = .installing_crontab; // reuse state for "single spawn" flow

        const task_name = allocPrintZ(bun.default_allocator, "bun-cron-{s}", .{this.title}) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(task_name);

        // Build the command that schtasks will execute
        const tr_cmd = allocPrintZ(bun.default_allocator, "\"{s}\" run --cron-title={s} --cron-period=\"{s}\" \"{s}\"", .{
            this.bun_exe, this.title, this.schedule, this.abs_path,
        }) catch {
            this.setErr("Out of memory", .{});
            this.finish();
            return;
        };
        defer bun.default_allocator.free(tr_cmd);

        // Parse cron to schtasks params (use raw schedule, not normalized)
        const schtasks_params = cronToSchtasks(this.raw_schedule) catch {
            this.setErr("Cannot convert this cron expression to a Windows scheduled task. Only simple patterns are supported.", .{});
            this.finish();
            return;
        };

        var argv = [_:null]?[*:0]const u8{
            "schtasks",                  "/create",
            "/tn",                       task_name.ptr,
            "/tr",                       tr_cmd.ptr,
            "/sc",                       schtasks_params.sc,
            "/mo",                       schtasks_params.mo,
            if (schtasks_params.start_time != null) "/st" else null,
            schtasks_params.start_time,
            if (schtasks_params.day_spec != null) "/d" else null,
            schtasks_params.day_spec,
            "/f",
            null,
        };
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
                if (exited.code != 0 and !(this.state == .reading_crontab and exited.code == 1) and this.state != .booting_out) {
                    this.setErr("Process exited with code {d}", .{exited.code});
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
    cron_fn.put(globalThis, jsc.ZigString.static("remove"), remove_fn);
    cron_fn.put(globalThis, jsc.ZigString.static("parse"), parse_fn);
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

    const spawn_options = bun.spawn.SpawnOptions{
        .stdin = stdin_opt,
        .stdout = stdout_opt,
        .stderr = .ignore,
    };

    // Inherit parent environment: on POSIX pass libc environ, on Windows pass null (libuv inherits)
    var null_envp = [_:null]?[*:0]const u8{null};
    const envp: [*:null]?[*:0]const u8 = if (comptime bun.Environment.isPosix) @ptrCast(@constCast(std.c.environ)) else @ptrCast(&null_envp);
    var spawned = (bun.spawn.spawnProcess(&spawn_options, @ptrCast(argv), envp) catch {
        this.setErr("Failed to spawn process", .{});
        this.finish();
        return;
    }).unwrap() catch {
        this.setErr("Failed to spawn process", .{});
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
    const source_dir = std.fs.path.dirname(caller_utf8.slice()) orelse ".";
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

    // Generate one <dict> per combination of specified values.
    // For wildcard fields, omit the key entirely (launchd treats missing = all).
    var result = std.array_list.Managed(u8).init(bun.default_allocator);
    errdefer result.deinit();
    const plist_keys = [_][]const u8{ "Minute", "Hour", "Day", "Month", "Weekday" };
    const mins = field_values[0] orelse &.{};
    const hrs = field_values[1] orelse &.{};
    const days = field_values[2] orelse &.{};
    const mons = field_values[3] orelse &.{};
    const wdays = field_values[4] orelse &.{};

    // If no field has multiple values, emit a single dict
    const needs_product = for (field_values) |fv| {
        if (fv) |v| if (v.len > 1) break true;
    } else false;

    if (!needs_product) {
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
        // Cartesian product: emit one <dict> per combination
        const iter_mins: []const i32 = if (mins.len > 0) mins else &.{0};
        const iter_hrs: []const i32 = if (hrs.len > 0) hrs else &.{0};
        const iter_days: []const i32 = if (days.len > 0) days else &.{0};
        const iter_mons: []const i32 = if (mons.len > 0) mons else &.{0};
        const iter_wdays: []const i32 = if (wdays.len > 0) wdays else &.{0};
        for (iter_mins) |m| {
            for (iter_hrs) |h| {
                for (iter_days) |d| {
                    for (iter_mons) |mo| {
                        for (iter_wdays) |w| {
                            try result.appendSlice("    <dict>\n");
                            if (field_values[0] != null) try appendCalendarKey(&result, plist_keys[0], m);
                            if (field_values[1] != null) try appendCalendarKey(&result, plist_keys[1], h);
                            if (field_values[2] != null) try appendCalendarKey(&result, plist_keys[2], d);
                            if (field_values[3] != null) try appendCalendarKey(&result, plist_keys[3], mo);
                            if (field_values[4] != null) try appendCalendarKey(&result, plist_keys[4], w);
                            try result.appendSlice("    </dict>\n");
                        }
                    }
                }
            }
        }
        // Remove trailing newline
        if (result.items.len > 0 and result.items[result.items.len - 1] == '\n')
            _ = result.pop();
    }
    return result.toOwnedSlice();
}

fn appendCalendarKey(result: *std.array_list.Managed(u8), key: []const u8, val: i32) !void {
    const line = try std.fmt.allocPrint(bun.default_allocator, "        <key>{s}</key>\n        <integer>{d}</integer>\n", .{ key, val });
    defer bun.default_allocator.free(line);
    try result.appendSlice(line);
}

/// Convert a cron expression to schtasks /sc and /mo parameters.
/// Supports: */N * * * * (MINUTE), 0 */N * * * (HOURLY), 0 0 * * * (DAILY),
/// 0 0 * * N (WEEKLY). Returns error for complex expressions.
const SchtasksParams = struct {
    sc: [*:0]const u8,
    mo: [*:0]const u8,
    start_time: ?[*:0]const u8 = null, // /st HH:MM
    day_spec: ?[*:0]const u8 = null, // /d for WEEKLY
};

fn cronToSchtasks(schedule: []const u8) !SchtasksParams {
    var fields: [5][]const u8 = undefined;
    var count: usize = 0;
    var iter = std.mem.tokenizeScalar(u8, schedule, ' ');
    while (iter.next()) |field| {
        if (count >= 5) return error.UnsupportedSchedule;
        fields[count] = field;
        count += 1;
    }
    if (count != 5) return error.UnsupportedSchedule;

    const minute = fields[0];
    const hour = fields[1];
    const dom = fields[2];
    const month = fields[3];
    const dow = fields[4];

    // Every N minutes: */N * * * *
    if (bun.strings.hasPrefixComptime(minute, "*/") and
        bun.strings.eql(hour, "*") and bun.strings.eql(dom, "*") and
        bun.strings.eql(month, "*") and bun.strings.eql(dow, "*"))
    {
        const n = minute[2..];
        _ = std.fmt.parseInt(u32, n, 10) catch return error.UnsupportedSchedule;
        const static_min = struct {
            var buf: [16:0]u8 = undefined;
        };
        @memcpy(static_min.buf[0..n.len], n);
        static_min.buf[n.len] = 0;
        return .{ .sc = "MINUTE", .mo = &static_min.buf };
    }

    // Every minute: * * * * *
    if (bun.strings.eql(minute, "*") and bun.strings.eql(hour, "*") and
        bun.strings.eql(dom, "*") and bun.strings.eql(month, "*") and bun.strings.eql(dow, "*"))
        return .{ .sc = "MINUTE", .mo = "1" };

    // Hourly: 0 * * * * or N * * * *
    if (bun.strings.eql(hour, "*") and bun.strings.eql(dom, "*") and
        bun.strings.eql(month, "*") and bun.strings.eql(dow, "*"))
    {
        _ = std.fmt.parseInt(u32, minute, 10) catch return error.UnsupportedSchedule;
        return .{ .sc = "HOURLY", .mo = "1" };
    }

    // Daily: N N * * *
    if (bun.strings.eql(dom, "*") and bun.strings.eql(month, "*") and bun.strings.eql(dow, "*")) {
        const m = std.fmt.parseInt(u32, minute, 10) catch return error.UnsupportedSchedule;
        const h = std.fmt.parseInt(u32, hour, 10) catch return error.UnsupportedSchedule;
        const static_st = struct {
            var buf: [6:0]u8 = undefined;
        };
        _ = std.fmt.bufPrintZ(&static_st.buf, "{d:0>2}:{d:0>2}", .{ h, m }) catch return error.UnsupportedSchedule;
        return .{ .sc = "DAILY", .mo = "1", .start_time = &static_st.buf };
    }

    // Weekly: N N * * N
    if (bun.strings.eql(dom, "*") and bun.strings.eql(month, "*")) {
        const m = std.fmt.parseInt(u32, minute, 10) catch return error.UnsupportedSchedule;
        const h = std.fmt.parseInt(u32, hour, 10) catch return error.UnsupportedSchedule;
        const d = std.fmt.parseInt(u32, dow, 10) catch return error.UnsupportedSchedule;
        const static_st = struct {
            var buf: [6:0]u8 = undefined;
        };
        _ = std.fmt.bufPrintZ(&static_st.buf, "{d:0>2}:{d:0>2}", .{ h, m }) catch return error.UnsupportedSchedule;
        const day_names = [_][*:0]const u8{ "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" };
        if (d > 6) return error.UnsupportedSchedule;
        return .{ .sc = "WEEKLY", .mo = "1", .start_time = &static_st.buf, .day_spec = day_names[d] };
    }

    return error.UnsupportedSchedule;
}

fn allocPrintZ(allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) std.mem.Allocator.Error![:0]const u8 {
    const slice = try std.fmt.allocPrint(allocator, fmt, args);
    defer allocator.free(slice);
    return allocator.dupeZ(u8, slice);
}

/// Create a temp file path with a random suffix to avoid TOCTOU/symlink attacks.
fn makeTempPath(comptime prefix: []const u8, title: []const u8) ![:0]const u8 {
    const rand = bun.fastRandom();
    return allocPrintZ(bun.default_allocator, "/tmp/" ++ prefix ++ "{s}-{x}.tmp", .{ title, rand });
}

const CronExpression = @import("cron_parser.zig").CronExpression;

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Output = bun.Output;
