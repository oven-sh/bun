const std = @import("std");
const builtin = @import("builtin");
const bun = @import("bun");
const C = bun.C;
const string = bun.string;
const strings = bun.strings;
const JSC = @import("bun").JSC;
const Environment = bun.Environment;
const Global = bun.Global;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const heap_allocator = bun.default_allocator;
const constants = @import("./os/constants.zig");

pub const Os = struct {
    pub const name = "Bun__Os";
    pub const code = @embedFile("../os.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const module = JSC.JSValue.createEmptyObject(globalObject, 20);

        module.put(globalObject, JSC.ZigString.static("arch"), JSC.NewFunction(globalObject, JSC.ZigString.static("arch"), 0, arch, true));
        module.put(globalObject, JSC.ZigString.static("cpus"), JSC.NewFunction(globalObject, JSC.ZigString.static("cpus"), 0, cpus, true));
        module.put(globalObject, JSC.ZigString.static("endianness"), JSC.NewFunction(globalObject, JSC.ZigString.static("endianness"), 0, endianness, true));
        module.put(globalObject, JSC.ZigString.static("freemem"), JSC.NewFunction(globalObject, JSC.ZigString.static("freemem"), 0, freemem, true));
        module.put(globalObject, JSC.ZigString.static("getPriority"), JSC.NewFunction(globalObject, JSC.ZigString.static("getPriority"), 1, getPriority, true));
        module.put(globalObject, JSC.ZigString.static("homedir"), JSC.NewFunction(globalObject, JSC.ZigString.static("homedir"), 0, homedir, true));
        module.put(globalObject, JSC.ZigString.static("hostname"), JSC.NewFunction(globalObject, JSC.ZigString.static("hostname"), 0, hostname, true));
        module.put(globalObject, JSC.ZigString.static("loadavg"), JSC.NewFunction(globalObject, JSC.ZigString.static("loadavg"), 0, loadavg, true));
        module.put(globalObject, JSC.ZigString.static("machine"), JSC.NewFunction(globalObject, JSC.ZigString.static("machine"), 0, machine, true));
        module.put(globalObject, JSC.ZigString.static("networkInterfaces"), JSC.NewFunction(globalObject, JSC.ZigString.static("networkInterfaces"), 0, networkInterfaces, true));
        module.put(globalObject, JSC.ZigString.static("platform"), JSC.NewFunction(globalObject, JSC.ZigString.static("platform"), 0, platform, true));
        module.put(globalObject, JSC.ZigString.static("release"), JSC.NewFunction(globalObject, JSC.ZigString.static("release"), 0, release, true));
        module.put(globalObject, JSC.ZigString.static("setPriority"), JSC.NewFunction(globalObject, JSC.ZigString.static("setPriority"), 2, setPriority, true));
        module.put(globalObject, JSC.ZigString.static("tmpdir"), JSC.NewFunction(globalObject, JSC.ZigString.static("tmpdir"), 0, tmpdir, true));
        module.put(globalObject, JSC.ZigString.static("totalmem"), JSC.NewFunction(globalObject, JSC.ZigString.static("totalmem"), 0, totalmem, true));
        module.put(globalObject, JSC.ZigString.static("type"), JSC.NewFunction(globalObject, JSC.ZigString.static("type"), 0, Os.type, true));
        module.put(globalObject, JSC.ZigString.static("uptime"), JSC.NewFunction(globalObject, JSC.ZigString.static("uptime"), 0, uptime, true));
        module.put(globalObject, JSC.ZigString.static("userInfo"), JSC.NewFunction(globalObject, JSC.ZigString.static("userInfo"), 0, userInfo, true));
        module.put(globalObject, JSC.ZigString.static("version"), JSC.NewFunction(globalObject, JSC.ZigString.static("version"), 0, version, true));
        module.put(globalObject, JSC.ZigString.static("machine"), JSC.NewFunction(globalObject, JSC.ZigString.static("machine"), 0, machine, true));

        module.put(globalObject, JSC.ZigString.static("devNull"), JSC.ZigString.init(devNull).withEncoding().toValue(globalObject));
        module.put(globalObject, JSC.ZigString.static("EOL"), JSC.ZigString.init(EOL).withEncoding().toValue(globalObject));

        module.put(globalObject, JSC.ZigString.static("constants"), constants.create(globalObject));

        return module;
    }

    pub const EOL = if (Environment.isWindows) "\r\n" else "\n";
    pub const devNull = if (Environment.isWindows) "\\\\.\nul" else "/dev/null";

    pub fn arch(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.ZigString.init(Global.arch_name).withEncoding().toValue(globalThis);
    }

    const CPUTimes = struct {
        user: u64 = 0,
        nice: u64 = 0,
        sys: u64 = 0,
        idle: u64 = 0,
        irq: u64 = 0,

        pub fn toValue(self: CPUTimes, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            const fields = comptime std.meta.fieldNames(CPUTimes);
            const ret = JSC.JSValue.createEmptyObject(globalThis, fields.len);
            inline for (fields) |fieldName| {
                ret.put(globalThis, JSC.ZigString.static(fieldName),
                                     JSC.JSValue.jsNumberFromUint64(@field(self, fieldName)));
            }
            return ret;
        }
    };

    pub fn cpus(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return if (comptime Environment.isLinux)
                   cpusImplLinux(globalThis) catch {
                        const err = JSC.SystemError{
                            .message = JSC.ZigString.init("Failed to get cpu information"),
                            .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                        };

                        globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                        return JSC.JSValue.jsUndefined();
                   }
               else if (comptime Environment.isMac)
                   cpusImplDarwin(globalThis) catch {
                        const err = JSC.SystemError{
                            .message = JSC.ZigString.init("Failed to get cpu information"),
                            .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                        };

                        globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                        return JSC.JSValue.jsUndefined();
                   }
               else
                   JSC.JSValue.createEmptyArray(globalThis, 0);

    }

    fn cpusImplLinux(globalThis: *JSC.JSGlobalObject) !JSC.JSValue {
        // Create the return array
        const values = JSC.JSValue.createEmptyArray(globalThis, 0);
        var num_cpus: u32 = 0;

        // Use a large line buffer because the /proc/stat file can have a very long list of interrupts
        var line_buffer: [1024*8]u8 = undefined;
        // Read /proc/stat to get number of CPUs and times
        if (std.fs.openFileAbsolute("/proc/stat", .{})) |file| {
            defer file.close();
            var reader = file.reader();

            // Skip the first line (aggregate of all CPUs)
            try reader.skipUntilDelimiterOrEof('\n');

            // Read each CPU line
            while (try reader.readUntilDelimiterOrEof(&line_buffer, '\n')) |line| {

                // CPU lines are formatted as `cpu0 user nice sys idle iowait irq softirq`
                var toks = std.mem.tokenize(u8, line, " \t");
                const cpu_name = toks.next();
                if (cpu_name == null or !std.mem.startsWith(u8, cpu_name.?, "cpu")) break; // done with CPUs

                //NOTE: libuv assumes this is fixed on Linux, not sure that's actually the case
                const scale = 10;
                var times = CPUTimes{};
                times.user = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
                times.nice = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
                times.sys  = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
                times.idle = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
                _ = try (toks.next() orelse error.eol); // skip iowait
                times.irq  = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);

                // Actually create the JS object representing the CPU
                const cpu = JSC.JSValue.createEmptyObject(globalThis, 3);
                cpu.put(globalThis, JSC.ZigString.static("times"), times.toValue(globalThis));
                values.putIndex(globalThis, num_cpus, cpu);

                num_cpus += 1;
            }
        } else |_| {
            return error.no_proc_stat;
        }

        // Read /proc/cpuinfo to get model information (optional)
        if (std.fs.openFileAbsolute("/proc/cpuinfo", .{})) |file| {
            defer file.close();
            var reader = file.reader();
            const key_processor = "processor\t: ";
            const key_model_name = "model name\t: ";

            var cpu_index: u32 = 0;
            while (try reader.readUntilDelimiterOrEof(&line_buffer, '\n')) |line| {

                if (std.mem.startsWith(u8, line, key_processor)) {
                    // If this line starts a new processor, parse the index from the line
                    const digits = std.mem.trim(u8, line[key_processor.len..], " \t\n");
                    cpu_index = try std.fmt.parseInt(u32, digits, 10);
                    if (cpu_index >= num_cpus) return error.too_may_cpus;

                } else if (std.mem.startsWith(u8, line, key_model_name)) {
                    // If this is the model name, extract it and store on the current cpu
                    const model_name = line[key_model_name.len..];
                    const cpu = JSC.JSObject.getIndex(values, globalThis, cpu_index);
                    cpu.put(globalThis, JSC.ZigString.static("model"),
                                        JSC.ZigString.init(model_name).withEncoding().toValueGC(globalThis));
                }
                //TODO: special handling for ARM64 (no model name)?
            }
        } else |_| {
            // Initialize model name to "unknown"
            var it = values.arrayIterator(globalThis);
            while (it.next()) |cpu| {
                cpu.put(globalThis, JSC.ZigString.static("model"),
                                    JSC.ZigString.static("unknown").withEncoding().toValue(globalThis));
            }
        }

        // Read /sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq to get current frequency (optional)
        var cpu_index: u32 = 0;
        while (cpu_index < num_cpus) : (cpu_index += 1) {
            const cpu = JSC.JSObject.getIndex(values, globalThis, cpu_index);
            var path_buf: [128]u8 = undefined;
            const path = try std.fmt.bufPrint(&path_buf, "/sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq", .{cpu_index});
            if (std.fs.openFileAbsolute(path, .{})) |file| {
                defer file.close();

                const bytes_read = try file.readAll(&line_buffer);
                const digits = std.mem.trim(u8, line_buffer[0..bytes_read], " \n");
                const speed = (std.fmt.parseInt(u64, digits, 10) catch 0) / 1000;

                cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(speed));
            } else |_| {
                // Initialize CPU speed to 0
                cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(0));
            }
        }

        return values;
    }

    fn cpusImplDarwin(globalThis: *JSC.JSGlobalObject) !JSC.JSValue {
        const local_bindings = @import("../../darwin_c.zig");
        const c = std.c;

        // Fetch the CPU info structure
        var num_cpus: c.natural_t = 0;
        var info: [*]local_bindings.processor_cpu_load_info = undefined;
        var msg_type: std.c.mach_msg_type_number_t = 0;
        if (local_bindings.host_processor_info(
                std.c.mach_host_self(),
                local_bindings.PROCESSOR_CPU_LOAD_INFO,
                &num_cpus, @ptrCast(*local_bindings.processor_info_array_t, &info),
                &msg_type) != .SUCCESS) {
            return error.no_processor_info;
        }
        defer _ = std.c.vm_deallocate(std.c.mach_task_self(), @ptrToInt(info), msg_type);


        // Get CPU model name
        var model_name_buf: [512]u8 = undefined;
        var len: usize = model_name_buf.len;
        // Try brand_string first and if it fails try hw.model
        if (std.c.sysctlbyname("machdep.cpu.brand_string", &model_name_buf, &len, null, 0) != 0 and
            std.c.sysctlbyname("hw.model", &model_name_buf, &len, null, 0) != 0) {
            return error.no_processor_info;
        }
        //NOTE: sysctlbyname doesn't update len if it was large enough, so we
        // still have to find the null terminator.  All cpus can share the same
        // value.
        const model_name = JSC.ZigString.init(std.mem.span(&model_name_buf)).withEncoding().toValueGC(globalThis);


        // Get CPU speed
        var speed: u64 = 0;
        len = @sizeOf(@TypeOf(speed));
        _ = std.c.sysctlbyname("hw.cpufrequency", &speed, &len, null, 0);
        if (speed == 0) {
            // Suggested by Node implementation:
            // If sysctl hw.cputype == CPU_TYPE_ARM64, the correct value is unavailable
            // from Apple, but we can hard-code it here to a plausible value.
            speed = 2_400_000_000;
        }


        // Get the multiplier
        const unistd = @cImport({@cInclude("unistd.h");});
        const ticks: i64 = unistd.sysconf(unistd._SC_CLK_TCK);
        const multiplier = 1000 / @intCast(u64, ticks);

        // Set up each CPU value in the return
        const values = JSC.JSValue.createEmptyArray(globalThis, @intCast(u32, num_cpus));
        var cpu_index: u32 = 0;
        while (cpu_index < num_cpus) : (cpu_index += 1) {
            const times = CPUTimes{
                .user = @intCast(u64, info[cpu_index].cpu_ticks[0]) * multiplier,
                .nice = @intCast(u64, info[cpu_index].cpu_ticks[3]) * multiplier,
                .sys  = @intCast(u64, info[cpu_index].cpu_ticks[1]) * multiplier,
                .idle = @intCast(u64, info[cpu_index].cpu_ticks[2]) * multiplier,
                .irq  = 0,  // not available
            };

            const cpu = JSC.JSValue.createEmptyObject(globalThis, 3);
            cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(speed / 1_000_000));
            cpu.put(globalThis, JSC.ZigString.static("model"), model_name);
            cpu.put(globalThis, JSC.ZigString.static("times"), times.toValue(globalThis));

            values.putIndex(globalThis, cpu_index, cpu);
        }
        return values;
    }

    pub fn endianness(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        switch (comptime builtin.target.cpu.arch.endian()) {
            .Big => {
                return JSC.ZigString.init("BE").withEncoding().toValue(globalThis);
            },
            .Little => {
                return JSC.ZigString.init("LE").withEncoding().toValue(globalThis);
            },
        }
    }

    pub fn freemem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getFreeMemory());
    }

    pub fn getPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var args_ = callframe.arguments(1);
        const arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len > 0 and !arguments[0].isNumber()) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                "getPriority() expects a number",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const pid = if (arguments.len > 0) arguments[0].asInt32() else 0;

        const priority = C.getProcessPriority(pid);
        if (priority == -1) {
            //const info = JSC.JSValue.createEmptyObject(globalThis, 4);
            //info.put(globalThis, JSC.ZigString.static("errno"), JSC.JSValue.jsNumberFromInt32(-3));
            //info.put(globalThis, JSC.ZigString.static("code"), JSC.ZigString.init("ESRCH").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, JSC.ZigString.static("message"), JSC.ZigString.init("no such process").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, JSC.ZigString.static("syscall"), JSC.ZigString.init("uv_os_getpriority").withEncoding().toValueGC(globalThis));

            const err = JSC.SystemError{
                .message = JSC.ZigString.init("A system error occurred: uv_os_getpriority returned ESRCH (no such process)"),
                .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                //.info = info,
                .errno = -3,
                .syscall = JSC.ZigString.init("uv_os_getpriority"),
            };

            globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
            return JSC.JSValue.jsUndefined();
        }

        return JSC.JSValue.jsNumberFromInt32(priority);
    }

    pub fn homedir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var dir: string = "unknown";
        if (comptime Environment.isWindows)
            dir = bun.getenvZ("USERPROFILE") orelse "unknown"
        else
            dir = bun.getenvZ("HOME") orelse "unknown";

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn hostname(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;

        return JSC.ZigString.init(std.os.gethostname(&name_buffer) catch "unknown").withEncoding().toValueGC(globalThis);
    }

    pub fn loadavg(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const result = C.getSystemLoadavg();
        return JSC.JSArray.from(globalThis, &.{
            JSC.JSValue.jsDoubleNumber(result[0]),
            JSC.JSValue.jsDoubleNumber(result[1]),
            JSC.JSValue.jsDoubleNumber(result[2]),
        });
    }

    pub fn networkInterfaces(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        // TODO:
        return JSC.JSValue.createEmptyObject(globalThis, 0);
    }

    pub fn platform(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn release(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getRelease(&name_buffer)).withEncoding().toValueGC(globalThis);
    }

    pub fn setPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var args_ = callframe.arguments(2);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len == 0) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                "The \"priority\" argument must be of type number. Received undefined",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const pid = if (arguments.len == 2) arguments[0].coerce(i32, globalThis) else 0;
        const priority = if (arguments.len == 2) arguments[1].coerce(i32, globalThis) else arguments[0].coerce(i32, globalThis);

        if (priority < -20 or priority > 19) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_OUT_OF_RANGE,
                "The value of \"priority\" is out of range. It must be >= -20 && <= 19",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const errcode = C.setProcessPriority(pid, priority);
        switch (errcode) {
            .SRCH => {
                const err = JSC.SystemError{
                    .message = JSC.ZigString.init("A system error occurred: uv_os_setpriority returned ESRCH (no such process)"),
                    .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                    //.info = info,
                    .errno = -3,
                    .syscall = JSC.ZigString.init("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            .ACCES => {
                const err = JSC.SystemError{
                    .message = JSC.ZigString.init("A system error occurred: uv_os_setpriority returned EACCESS (permission denied)"),
                    .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                    //.info = info,
                    .errno = -13,
                    .syscall = JSC.ZigString.init("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            else => {},
        }

        return JSC.JSValue.jsUndefined();
    }

    pub fn tmpdir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var dir: string = "unknown";
        if (comptime Environment.isWindows) {
            if (bun.getenvZ("TEMP") orelse bun.getenvZ("TMP")) |tmpdir_| {
                dir = tmpdir_;
            }

            if (bun.getenvZ("SYSTEMROOT") orelse bun.getenvZ("WINDIR")) |systemdir_| {
                dir = systemdir_ + "\\temp";
            }

            dir = "unknown";
        } else {
            dir = bun.getenvZ("TMPDIR") orelse bun.getenvZ("TMP") orelse bun.getenvZ("TEMP") orelse "/tmp";
        }

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn totalmem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getTotalMemory());
    }

    pub fn @"type"(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        if (comptime Environment.isWindows)
            return JSC.ZigString.static("Windows_NT").toValue(globalThis)
        else if (comptime Environment.isMac)
            return JSC.ZigString.static("Darwin").toValue(globalThis)
        else if (comptime Environment.isLinux)
            return JSC.ZigString.static("Linux").toValue(globalThis);

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn uptime(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getSystemUptime());
    }

    pub fn userInfo(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const result = JSC.JSValue.createEmptyObject(globalThis, 5);

        result.put(globalThis, JSC.ZigString.static("homedir"), homedir(globalThis, callframe));

        if (comptime Environment.isWindows) {
            result.put(globalThis, JSC.ZigString.static("username"), JSC.ZigString.init(bun.getenvZ("USERNAME") orelse "unknown").withEncoding().toValueGC(globalThis));
            result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, JSC.ZigString.static("shell"), JSC.JSValue.jsNull());
        } else {
            const username = bun.getenvZ("USER") orelse "unknown";

            result.put(globalThis, JSC.ZigString.static("username"), JSC.ZigString.init(username).withEncoding().toValueGC(globalThis));
            result.put(globalThis, JSC.ZigString.static("shell"), JSC.ZigString.init(bun.getenvZ("SHELL") orelse "unknown").withEncoding().toValueGC(globalThis));

            if (comptime Environment.isLinux) {
                result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(std.os.linux.getuid()));
                result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(std.os.linux.getgid()));
            } else {
                result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(C.darwin.getuid()));
                result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(C.darwin.getgid()));
            }
        }

        return result;
    }

    pub fn version(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getVersion(&name_buffer)).withEncoding().toValueGC(globalThis);
    }

    inline fn getMachineName() []const u8 {
        return switch (@import("builtin").target.cpu.arch) {
            .arm => "arm",
            .aarch64 => "arm64",
            .mips => "mips",
            .mips64 => "mips64",
            .powerpc64 => "ppc64",
            .powerpc64le => "ppc64le",
            .s390x => "s390x",
            .x86 => "i386",
            .x86_64 => "x86_64",
            else => "unknown",
        };
    }

    pub fn machine(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        return JSC.ZigString.static(comptime getMachineName()).toValue(globalThis);
    }
};
