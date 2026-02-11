pub fn createNodeOsBinding(global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return (try jsc.JSObject.create(.{
        .cpus = gen.createCpusCallback(global),
        .freemem = gen.createFreememCallback(global),
        .getPriority = gen.createGetPriorityCallback(global),
        .homedir = gen.createHomedirCallback(global),
        .hostname = gen.createHostnameCallback(global),
        .loadavg = gen.createLoadavgCallback(global),
        .networkInterfaces = gen.createNetworkInterfacesCallback(global),
        .release = gen.createReleaseCallback(global),
        .totalmem = gen.createTotalmemCallback(global),
        .uptime = gen.createUptimeCallback(global),
        .userInfo = gen.createUserInfoCallback(global),
        .version = gen.createVersionCallback(global),
        .setPriority = gen.createSetPriorityCallback(global),
    }, global)).toJS();
}

const CPUTimes = struct {
    user: u64 = 0,
    nice: u64 = 0,
    sys: u64 = 0,
    idle: u64 = 0,
    irq: u64 = 0,

    pub fn toValue(self: CPUTimes, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        const fields = comptime std.meta.fieldNames(CPUTimes);
        const ret = jsc.JSValue.createEmptyObject(globalThis, fields.len);
        inline for (fields) |fieldName| {
            ret.put(globalThis, jsc.ZigString.static(fieldName), jsc.JSValue.jsNumberFromUint64(@field(self, fieldName)));
        }
        return ret;
    }
};

pub fn cpus(global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const cpusImpl = switch (Environment.os) {
        .linux => cpusImplLinux,
        .mac => cpusImplDarwin,
        .windows => cpusImplWindows,
        .wasm => @compileError("Unsupported OS"),
    };

    return cpusImpl(global) catch {
        const err = jsc.SystemError{
            .message = bun.String.static("Failed to get CPU information"),
            .code = bun.String.static(@tagName(jsc.Node.ErrorCode.ERR_SYSTEM_ERROR)),
        };
        return global.throwValue(err.toErrorInstance(global));
    };
}

fn cpusImplLinux(globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
    // Create the return array
    const values = try jsc.JSValue.createEmptyArray(globalThis, 0);
    var num_cpus: u32 = 0;

    var stack_fallback = std.heap.stackFallback(1024 * 8, bun.default_allocator);
    var file_buf = std.array_list.Managed(u8).init(stack_fallback.get());
    defer file_buf.deinit();

    // Read /proc/stat to get number of CPUs and times
    {
        const file = try std.fs.cwd().openFile("/proc/stat", .{});
        defer file.close();

        const read = try bun.sys.File.from(file).readToEndWithArrayList(&file_buf, .probably_small).unwrap();
        defer file_buf.clearRetainingCapacity();
        const contents = file_buf.items[0..read];

        var line_iter = std.mem.tokenizeScalar(u8, contents, '\n');

        // Skip the first line (aggregate of all CPUs)
        _ = line_iter.next();

        // Read each CPU line
        while (line_iter.next()) |line| {
            // CPU lines are formatted as `cpu0 user nice sys idle iowait irq softirq`
            var toks = std.mem.tokenizeAny(u8, line, " \t");
            const cpu_name = toks.next();
            if (cpu_name == null or !std.mem.startsWith(u8, cpu_name.?, "cpu")) break; // done with CPUs

            //NOTE: libuv assumes this is fixed on Linux, not sure that's actually the case
            const scale = 10;

            var times = CPUTimes{};
            times.user = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
            times.nice = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
            times.sys = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
            times.idle = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);
            _ = try (toks.next() orelse error.eol); // skip iowait
            times.irq = scale * try std.fmt.parseInt(u64, toks.next() orelse return error.eol, 10);

            // Actually create the JS object representing the CPU
            const cpu = jsc.JSValue.createEmptyObject(globalThis, 1);
            cpu.put(globalThis, jsc.ZigString.static("times"), times.toValue(globalThis));
            try values.putIndex(globalThis, num_cpus, cpu);

            num_cpus += 1;
        }
    }

    // Read /proc/cpuinfo to get model information (optional)
    if (std.fs.cwd().openFile("/proc/cpuinfo", .{})) |file| {
        defer file.close();

        const read = try bun.sys.File.from(file).readToEndWithArrayList(&file_buf, .probably_small).unwrap();
        defer file_buf.clearRetainingCapacity();
        const contents = file_buf.items[0..read];

        var line_iter = std.mem.tokenizeScalar(u8, contents, '\n');

        const key_processor = "processor\t: ";
        const key_model_name = "model name\t: ";

        var cpu_index: u32 = 0;
        var has_model_name = true;
        while (line_iter.next()) |line| {
            if (strings.hasPrefixComptime(line, key_processor)) {
                if (!has_model_name) {
                    const cpu = try values.getIndex(globalThis, cpu_index);
                    cpu.put(globalThis, jsc.ZigString.static("model"), jsc.ZigString.static("unknown").withEncoding().toJS(globalThis));
                }
                // If this line starts a new processor, parse the index from the line
                const digits = std.mem.trim(u8, line[key_processor.len..], " \t\n");
                cpu_index = try std.fmt.parseInt(u32, digits, 10);
                if (cpu_index >= num_cpus) return error.too_may_cpus;
                has_model_name = false;
            } else if (strings.hasPrefixComptime(line, key_model_name)) {
                // If this is the model name, extract it and store on the current cpu
                const model_name = line[key_model_name.len..];
                const cpu = try values.getIndex(globalThis, cpu_index);
                cpu.put(globalThis, jsc.ZigString.static("model"), jsc.ZigString.init(model_name).withEncoding().toJS(globalThis));
                has_model_name = true;
            }
        }
        if (!has_model_name) {
            const cpu = try values.getIndex(globalThis, cpu_index);
            cpu.put(globalThis, jsc.ZigString.static("model"), jsc.ZigString.static("unknown").withEncoding().toJS(globalThis));
        }
    } else |_| {
        // Initialize model name to "unknown"
        var it = try values.arrayIterator(globalThis);
        while (try it.next()) |cpu| {
            cpu.put(globalThis, jsc.ZigString.static("model"), jsc.ZigString.static("unknown").withEncoding().toJS(globalThis));
        }
    }

    // Read /sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq to get current frequency (optional)
    for (0..num_cpus) |cpu_index| {
        const cpu = try values.getIndex(globalThis, @truncate(cpu_index));

        var path_buf: [128]u8 = undefined;
        const path = try std.fmt.bufPrint(&path_buf, "/sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq", .{cpu_index});
        if (std.fs.cwd().openFile(path, .{})) |file| {
            defer file.close();

            const read = try bun.sys.File.from(file).readToEndWithArrayList(&file_buf, .probably_small).unwrap();
            defer file_buf.clearRetainingCapacity();
            const contents = file_buf.items[0..read];

            const digits = std.mem.trim(u8, contents, " \n");
            const speed = (std.fmt.parseInt(u64, digits, 10) catch 0) / 1000;

            cpu.put(globalThis, jsc.ZigString.static("speed"), jsc.JSValue.jsNumber(speed));
        } else |_| {
            // Initialize CPU speed to 0
            cpu.put(globalThis, jsc.ZigString.static("speed"), jsc.JSValue.jsNumber(0));
        }
    }

    return values;
}

extern fn bun_sysconf__SC_CLK_TCK() isize;
fn cpusImplDarwin(globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
    // Fetch the CPU info structure
    var num_cpus: c.natural_t = 0;
    var info: [*]bun.c.processor_cpu_load_info = undefined;
    var info_size: std.c.mach_msg_type_number_t = 0;
    if (bun.c.host_processor_info(
        std.c.mach_host_self(),
        bun.c.PROCESSOR_CPU_LOAD_INFO,
        &num_cpus,
        @as(*bun.c.processor_info_array_t, @ptrCast(&info)),
        &info_size,
    ) != 0) {
        return error.no_processor_info;
    }
    defer _ = std.c.vm_deallocate(std.c.mach_task_self(), @intFromPtr(info), info_size);

    // Ensure we got the amount of data we expected to guard against buffer overruns
    if (info_size != bun.c.PROCESSOR_CPU_LOAD_INFO_COUNT * num_cpus) {
        return error.broken_process_info;
    }

    // Get CPU model name
    var model_name_buf: [512]u8 = undefined;
    var len: usize = model_name_buf.len;
    // Try brand_string first and if it fails try hw.model
    if (!(std.c.sysctlbyname("machdep.cpu.brand_string", &model_name_buf, &len, null, 0) == 0 or
        std.c.sysctlbyname("hw.model", &model_name_buf, &len, null, 0) == 0))
    {
        return error.no_processor_info;
    }
    // NOTE: sysctlbyname doesn't update len if it was large enough, so we
    // still have to find the null terminator.  All cpus can share the same
    // model name.
    const model_name = jsc.ZigString.init(std.mem.sliceTo(&model_name_buf, 0)).withEncoding().toJS(globalThis);

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

    // Get the multiplier; this is the number of ms/tick
    const ticks: i64 = bun_sysconf__SC_CLK_TCK();
    const multiplier = 1000 / @as(u64, @intCast(ticks));

    // Set up each CPU value in the return
    const values = try jsc.JSValue.createEmptyArray(globalThis, @as(u32, @intCast(num_cpus)));
    var cpu_index: u32 = 0;
    while (cpu_index < num_cpus) : (cpu_index += 1) {
        const times = CPUTimes{
            .user = info[cpu_index].cpu_ticks[0] * multiplier,
            .nice = info[cpu_index].cpu_ticks[3] * multiplier,
            .sys = info[cpu_index].cpu_ticks[1] * multiplier,
            .idle = info[cpu_index].cpu_ticks[2] * multiplier,
            .irq = 0, // not available
        };

        const cpu = jsc.JSValue.createEmptyObject(globalThis, 3);
        cpu.put(globalThis, jsc.ZigString.static("speed"), jsc.JSValue.jsNumber(speed / 1_000_000));
        cpu.put(globalThis, jsc.ZigString.static("model"), model_name);
        cpu.put(globalThis, jsc.ZigString.static("times"), times.toValue(globalThis));

        try values.putIndex(globalThis, cpu_index, cpu);
    }
    return values;
}

pub fn cpusImplWindows(globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
    var cpu_infos: [*]libuv.uv_cpu_info_t = undefined;
    var count: c_int = undefined;
    const err = libuv.uv_cpu_info(&cpu_infos, &count);
    if (err != 0) {
        return error.NoProcessorInfo;
    }
    defer libuv.uv_free_cpu_info(cpu_infos, count);

    const values = try jsc.JSValue.createEmptyArray(globalThis, @intCast(count));

    for (cpu_infos[0..@intCast(count)], 0..@intCast(count)) |cpu_info, i| {
        const times = CPUTimes{
            .user = cpu_info.cpu_times.user,
            .nice = cpu_info.cpu_times.nice,
            .sys = cpu_info.cpu_times.sys,
            .idle = cpu_info.cpu_times.idle,
            .irq = cpu_info.cpu_times.irq,
        };

        const cpu = jsc.JSValue.createEmptyObject(globalThis, 3);
        cpu.put(globalThis, jsc.ZigString.static("model"), jsc.ZigString.init(bun.span(cpu_info.model)).withEncoding().toJS(globalThis));
        cpu.put(globalThis, jsc.ZigString.static("speed"), jsc.JSValue.jsNumber(cpu_info.speed));
        cpu.put(globalThis, jsc.ZigString.static("times"), times.toValue(globalThis));

        try values.putIndex(globalThis, @intCast(i), cpu);
    }

    return values;
}

pub fn freemem() u64 {
    // OsBinding.cpp
    return @extern(*const fn () callconv(.c) u64, .{
        .name = "Bun__Os__getFreeMemory",
    })();
}

extern fn get_process_priority(pid: i32) i32;
pub fn getPriority(global: *jsc.JSGlobalObject, pid: i32) bun.JSError!i32 {
    const result = get_process_priority(pid);
    if (result == std.math.maxInt(i32)) {
        const err = jsc.SystemError{
            .message = bun.String.static("no such process"),
            .code = bun.String.static("ESRCH"),
            .errno = comptime switch (bun.Environment.os) {
                else => -@as(c_int, @intFromEnum(std.posix.E.SRCH)),
                .windows => libuv.UV_ESRCH,
            },
            .syscall = bun.String.static("uv_os_getpriority"),
        };
        return global.throwValue(err.toErrorInstanceWithInfoObject(global));
    }
    return result;
}

pub fn homedir(global: *jsc.JSGlobalObject) !bun.String {
    // In Node.js, this is a wrapper around uv_os_homedir.
    if (Environment.isWindows) {
        var out: bun.PathBuffer = undefined;
        var size: usize = out.len;
        if (libuv.uv_os_homedir(&out, &size).toError(.uv_os_homedir)) |err| {
            return global.throwValue(try err.toJS(global));
        }
        return bun.String.cloneUTF8(out[0..size]);
    } else {

        // The posix implementation of uv_os_homedir first checks the HOME
        // environment variable, then falls back to reading the passwd entry.
        if (bun.env_var.HOME.get()) |home| {
            if (home.len > 0)
                return bun.String.init(home);
        }

        // From libuv:
        // > Calling sysconf(_SC_GETPW_R_SIZE_MAX) would get the suggested size, but it
        // > is frequently 1024 or 4096, so we can just use that directly. The pwent
        // > will not usually be large.
        // Instead of always using an allocation, first try a stack allocation
        // of 4096, then fallback to heap.
        var stack_string_bytes: [4096]u8 = undefined;
        var string_bytes: []u8 = &stack_string_bytes;
        defer if (string_bytes.ptr != &stack_string_bytes)
            bun.default_allocator.free(string_bytes);

        var pw: bun.c.passwd = undefined;
        var result: ?*bun.c.passwd = null;

        const ret = while (true) {
            const ret = bun.c.getpwuid_r(
                bun.c.geteuid(),
                &pw,
                string_bytes.ptr,
                string_bytes.len,
                &result,
            );

            if (ret == @intFromEnum(bun.sys.E.INTR))
                continue;

            // If the system call wants more memory, double it.
            if (ret == @intFromEnum(bun.sys.E.RANGE)) {
                const len = string_bytes.len;
                bun.default_allocator.free(string_bytes);
                string_bytes = "";
                string_bytes = try bun.default_allocator.alloc(u8, len * 2);
                continue;
            }

            break ret;
        };

        if (ret != 0) {
            return global.throwValue(try bun.sys.Error.fromCode(
                @enumFromInt(ret),
                .uv_os_homedir,
            ).toJS(global));
        }

        if (result == null) {
            // in uv__getpwuid_r, null result throws UV_ENOENT.
            return global.throwValue(try bun.sys.Error.fromCode(
                .NOENT,
                .uv_os_homedir,
            ).toJS(global));
        }

        return if (pw.pw_dir) |dir|
            bun.String.cloneUTF8(bun.span(dir))
        else
            bun.String.empty;
    }
}

pub fn hostname(global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    if (Environment.isWindows) {
        var name_buffer: [129:0]u16 = undefined;
        if (bun.windows.GetHostNameW(&name_buffer, name_buffer.len) == 0) {
            const str = bun.String.cloneUTF16(bun.sliceTo(&name_buffer, 0));
            defer str.deref();
            return str.toJS(global);
        }

        var result: std.os.windows.ws2_32.WSADATA = undefined;
        if (std.os.windows.ws2_32.WSAStartup(0x202, &result) == 0) {
            if (bun.windows.GetHostNameW(&name_buffer, name_buffer.len) == 0) {
                var y = bun.String.cloneUTF16(bun.sliceTo(&name_buffer, 0));
                defer y.deref();
                return y.toJS(global);
            }
        }

        return jsc.ZigString.init("unknown").withEncoding().toJS(global);
    } else {
        var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;
        return jsc.ZigString.init(std.posix.gethostname(&name_buffer) catch "unknown").withEncoding().toJS(global);
    }
}

pub fn loadavg(global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const result = switch (bun.Environment.os) {
        .mac => loadavg: {
            var avg: c.struct_loadavg = undefined;
            var size: usize = @sizeOf(@TypeOf(avg));

            std.posix.sysctlbynameZ(
                "vm.loadavg",
                &avg,
                &size,
                null,
                0,
            ) catch |err| switch (err) {
                else => break :loadavg [3]f64{ 0, 0, 0 },
            };

            const scale: f64 = @floatFromInt(avg.fscale);
            break :loadavg .{
                if (scale == 0.0) 0 else @as(f64, @floatFromInt(avg.ldavg[0])) / scale,
                if (scale == 0.0) 0 else @as(f64, @floatFromInt(avg.ldavg[1])) / scale,
                if (scale == 0.0) 0 else @as(f64, @floatFromInt(avg.ldavg[2])) / scale,
            };
        },
        .linux => loadavg: {
            var info: c.struct_sysinfo = undefined;
            if (c.sysinfo(&info) == @as(c_int, 0)) {
                break :loadavg [3]f64{
                    std.math.ceil((@as(f64, @floatFromInt(info.loads[0])) / 65536.0) * 100.0) / 100.0,
                    std.math.ceil((@as(f64, @floatFromInt(info.loads[1])) / 65536.0) * 100.0) / 100.0,
                    std.math.ceil((@as(f64, @floatFromInt(info.loads[2])) / 65536.0) * 100.0) / 100.0,
                };
            }
            break :loadavg [3]f64{ 0, 0, 0 };
        },
        .windows => .{ 0, 0, 0 },
        .wasm => @compileError("TODO"),
    };

    return jsc.JSArray.create(global, &.{
        jsc.JSValue.jsNumber(result[0]),
        jsc.JSValue.jsNumber(result[1]),
        jsc.JSValue.jsNumber(result[2]),
    });
}

pub const networkInterfaces = switch (Environment.os) {
    .linux, .mac => networkInterfacesPosix,
    .windows => networkInterfacesWindows,
    .wasm => @compileError("Unsupported OS"),
};

fn networkInterfacesPosix(globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    // getifaddrs sets a pointer to a linked list
    var interface_start: ?*c.ifaddrs = null;
    const rc = c.getifaddrs(&interface_start);
    if (rc != 0) {
        const err = jsc.SystemError{
            .message = bun.String.static("A system error occurred: getifaddrs returned an error"),
            .code = bun.String.static("ERR_SYSTEM_ERROR"),
            .errno = @intFromEnum(std.posix.errno(rc)),
            .syscall = bun.String.static("getifaddrs"),
        };

        return globalThis.throwValue(err.toErrorInstance(globalThis));
    }
    defer c.freeifaddrs(interface_start);

    const helpers = struct {
        // We'll skip interfaces that aren't actually available
        pub fn skip(iface: *c.ifaddrs) bool {
            // Skip interfaces that aren't actually available
            if (iface.ifa_flags & c.IFF_RUNNING == 0) return true;
            if (iface.ifa_flags & c.IFF_UP == 0) return true;
            if (iface.ifa_addr == null) return true;

            return false;
        }

        // We won't actually return link-layer interfaces but we need them for
        //  extracting the MAC address
        pub fn isLinkLayer(iface: *c.ifaddrs) bool {
            if (iface.ifa_addr == null) return false;
            return if (comptime Environment.isLinux)
                return iface.ifa_addr.*.sa_family == std.posix.AF.PACKET
            else if (comptime Environment.isMac)
                return iface.ifa_addr.?.*.sa_family == std.posix.AF.LINK
            else
                @compileError("unreachable");
        }

        pub fn isLoopback(iface: *c.ifaddrs) bool {
            return iface.ifa_flags & c.IFF_LOOPBACK == c.IFF_LOOPBACK;
        }
    };

    // The list currently contains entries for link-layer interfaces
    //  and the IPv4, IPv6 interfaces.  We only want to return the latter two
    //  but need the link-layer entries to determine MAC address.
    // So, on our first pass through the linked list we'll count the number of
    //  INET interfaces only.
    var num_inet_interfaces: usize = 0;
    var it = interface_start;
    while (it) |iface| : (it = iface.ifa_next) {
        if (helpers.skip(iface) or helpers.isLinkLayer(iface)) continue;
        num_inet_interfaces += 1;
    }

    var ret = jsc.JSValue.createEmptyObject(globalThis, 0);

    // Second pass through, populate each interface object
    it = interface_start;
    while (it) |iface| : (it = iface.ifa_next) {
        if (helpers.skip(iface) or helpers.isLinkLayer(iface)) continue;

        const interface_name = std.mem.sliceTo(iface.ifa_name, 0);
        const addr = std.net.Address.initPosix(@alignCast(@as(*std.posix.sockaddr, @ptrCast(iface.ifa_addr))));
        const netmask = std.net.Address.initPosix(@alignCast(@as(*std.posix.sockaddr, @ptrCast(iface.ifa_netmask))));

        var interface = jsc.JSValue.createEmptyObject(globalThis, 0);

        // address <string> The assigned IPv4 or IPv6 address
        // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
        {
            // Compute the CIDR suffix; returns null if the netmask cannot
            //  be converted to a CIDR suffix
            const maybe_suffix: ?u8 = switch (addr.any.family) {
                std.posix.AF.INET => netmaskToCIDRSuffix(netmask.in.sa.addr),
                std.posix.AF.INET6 => netmaskToCIDRSuffix(@as(u128, @bitCast(netmask.in6.sa.addr))),
                else => null,
            };

            // Format the address and then, if valid, the CIDR suffix; both
            //  the address and cidr values can be slices into this same buffer
            // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
            var buf: [64]u8 = undefined;
            const addr_str = bun.fmt.formatIp(addr, &buf) catch unreachable;
            var cidr = jsc.JSValue.null;
            if (maybe_suffix) |suffix| {
                //NOTE addr_str might not start at buf[0] due to slicing in formatIp
                const start = @intFromPtr(addr_str.ptr) - @intFromPtr(&buf[0]);
                // Start writing the suffix immediately after the address
                const suffix_str = std.fmt.bufPrint(buf[start + addr_str.len ..], "/{}", .{suffix}) catch unreachable;
                // The full cidr value is the address + the suffix
                const cidr_str = buf[start .. start + addr_str.len + suffix_str.len];
                cidr = jsc.ZigString.init(cidr_str).withEncoding().toJS(globalThis);
            }

            interface.put(globalThis, jsc.ZigString.static("address"), jsc.ZigString.init(addr_str).withEncoding().toJS(globalThis));
            interface.put(globalThis, jsc.ZigString.static("cidr"), cidr);
        }

        // netmask <string> The IPv4 or IPv6 network mask
        {
            var buf: [64]u8 = undefined;
            const str = bun.fmt.formatIp(netmask, &buf) catch unreachable;
            interface.put(globalThis, jsc.ZigString.static("netmask"), jsc.ZigString.init(str).withEncoding().toJS(globalThis));
        }

        // family <string> Either IPv4 or IPv6
        interface.put(globalThis, jsc.ZigString.static("family"), (switch (addr.any.family) {
            std.posix.AF.INET => jsc.ZigString.static("IPv4"),
            std.posix.AF.INET6 => jsc.ZigString.static("IPv6"),
            else => jsc.ZigString.static("unknown"),
        }).toJS(globalThis));

        // mac <string> The MAC address of the network interface
        {
            // We need to search for the link-layer interface whose name matches this one
            var ll_it = interface_start;
            const maybe_ll_addr = while (ll_it) |ll_iface| : (ll_it = ll_iface.ifa_next) {
                if (helpers.skip(ll_iface) or !helpers.isLinkLayer(ll_iface)) continue;

                const ll_name = bun.sliceTo(ll_iface.ifa_name, 0);
                if (!strings.hasPrefix(ll_name, interface_name)) continue;
                if (ll_name.len > interface_name.len and ll_name[interface_name.len] != ':') continue;

                // This is the correct link-layer interface entry for the current interface,
                //  cast to a link-layer socket address
                if (comptime Environment.isLinux) {
                    break @as(?*std.posix.sockaddr.ll, @ptrCast(@alignCast(ll_iface.ifa_addr)));
                } else if (comptime Environment.isMac) {
                    break @as(?*c.sockaddr_dl, @ptrCast(@alignCast(ll_iface.ifa_addr)));
                } else {
                    @compileError("unreachable");
                }
            } else null;

            if (maybe_ll_addr) |ll_addr| {
                // Encode its link-layer address.  We need 2*6 bytes for the
                //  hex characters and 5 for the colon separators
                var mac_buf: [17]u8 = undefined;
                const addr_data = if (comptime Environment.isLinux) ll_addr.addr else if (comptime Environment.isMac) ll_addr.sdl_data[ll_addr.sdl_nlen..] else @compileError("unreachable");
                if (addr_data.len < 6) {
                    const mac = "00:00:00:00:00:00";
                    interface.put(globalThis, jsc.ZigString.static("mac"), jsc.ZigString.init(mac).withEncoding().toJS(globalThis));
                } else {
                    const mac = std.fmt.bufPrint(&mac_buf, "{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}", .{
                        addr_data[0], addr_data[1], addr_data[2],
                        addr_data[3], addr_data[4], addr_data[5],
                    }) catch unreachable;
                    interface.put(globalThis, jsc.ZigString.static("mac"), jsc.ZigString.init(mac).withEncoding().toJS(globalThis));
                }
            } else {
                const mac = "00:00:00:00:00:00";
                interface.put(globalThis, jsc.ZigString.static("mac"), jsc.ZigString.init(mac).withEncoding().toJS(globalThis));
            }
        }

        // internal <boolean> true if the network interface is a loopback or similar interface that is not remotely accessible; otherwise false
        interface.put(globalThis, jsc.ZigString.static("internal"), jsc.JSValue.jsBoolean(helpers.isLoopback(iface)));

        // scopeid <number> The numeric IPv6 scope ID (only specified when family is IPv6)
        if (addr.any.family == std.posix.AF.INET6) {
            interface.put(globalThis, jsc.ZigString.static("scopeid"), jsc.JSValue.jsNumber(addr.in6.sa.scope_id));
        }

        // Does this entry already exist?
        if (try ret.get(globalThis, interface_name)) |array| {
            // Add this interface entry to the existing array
            const next_index: u32 = @intCast(try array.getLength(globalThis));
            try array.putIndex(globalThis, next_index, interface);
        } else {
            // Add it as an array with this interface as an element
            const member_name = jsc.ZigString.init(interface_name);
            var array = try jsc.JSValue.createEmptyArray(globalThis, 1);
            try array.putIndex(globalThis, 0, interface);
            ret.put(globalThis, &member_name, array);
        }
    }

    return ret;
}

fn networkInterfacesWindows(globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    var ifaces: [*]libuv.uv_interface_address_t = undefined;
    var count: c_int = undefined;
    const err = libuv.uv_interface_addresses(&ifaces, &count);
    if (err != 0) {
        const sys_err = jsc.SystemError{
            .message = bun.String.static("uv_interface_addresses failed"),
            .code = bun.String.static("ERR_SYSTEM_ERROR"),
            //.info = info,
            .errno = err,
            .syscall = bun.String.static("uv_interface_addresses"),
        };
        return globalThis.throwValue(sys_err.toErrorInstance(globalThis));
    }
    defer libuv.uv_free_interface_addresses(ifaces, count);

    var ret = jsc.JSValue.createEmptyObject(globalThis, 8);

    // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
    var ip_buf: [65]u8 = undefined;
    var mac_buf: [17]u8 = undefined;

    for (ifaces[0..@intCast(count)]) |iface| {
        var interface = jsc.JSValue.createEmptyObject(globalThis, 7);

        // address <string> The assigned IPv4 or IPv6 address
        // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
        var cidr = jsc.JSValue.null;
        {
            // Compute the CIDR suffix; returns null if the netmask cannot
            //  be converted to a CIDR suffix
            const maybe_suffix: ?u8 = switch (iface.address.address4.family) {
                std.posix.AF.INET => netmaskToCIDRSuffix(iface.netmask.netmask4.addr),
                std.posix.AF.INET6 => netmaskToCIDRSuffix(@as(u128, @bitCast(iface.netmask.netmask6.addr))),
                else => null,
            };

            // Format the address and then, if valid, the CIDR suffix; both
            //  the address and cidr values can be slices into this same buffer
            // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
            const addr_str = bun.fmt.formatIp(
                // std.net.Address will do ptrCast depending on the family so this is ok
                std.net.Address.initPosix(@ptrCast(&iface.address.address4)),
                &ip_buf,
            ) catch unreachable;
            if (maybe_suffix) |suffix| {
                //NOTE addr_str might not start at buf[0] due to slicing in formatIp
                const start = @intFromPtr(addr_str.ptr) - @intFromPtr(&ip_buf[0]);
                // Start writing the suffix immediately after the address
                const suffix_str = std.fmt.bufPrint(ip_buf[start + addr_str.len ..], "/{}", .{suffix}) catch unreachable;
                // The full cidr value is the address + the suffix
                const cidr_str = ip_buf[start .. start + addr_str.len + suffix_str.len];
                cidr = jsc.ZigString.init(cidr_str).withEncoding().toJS(globalThis);
            }

            interface.put(globalThis, jsc.ZigString.static("address"), jsc.ZigString.init(addr_str).withEncoding().toJS(globalThis));
        }

        // netmask
        {
            const str = bun.fmt.formatIp(
                // std.net.Address will do ptrCast depending on the family so this is ok
                std.net.Address.initPosix(@ptrCast(&iface.netmask.netmask4)),
                &ip_buf,
            ) catch unreachable;
            interface.put(globalThis, jsc.ZigString.static("netmask"), jsc.ZigString.init(str).withEncoding().toJS(globalThis));
        }
        // family
        interface.put(globalThis, jsc.ZigString.static("family"), (switch (iface.address.address4.family) {
            std.posix.AF.INET => jsc.ZigString.static("IPv4"),
            std.posix.AF.INET6 => jsc.ZigString.static("IPv6"),
            else => jsc.ZigString.static("unknown"),
        }).toJS(globalThis));

        // mac
        {
            const phys = iface.phys_addr;
            const mac = std.fmt.bufPrint(&mac_buf, "{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}", .{
                phys[0], phys[1], phys[2], phys[3], phys[4], phys[5],
            }) catch unreachable;
            interface.put(globalThis, jsc.ZigString.static("mac"), jsc.ZigString.init(mac).withEncoding().toJS(globalThis));
        }

        // internal
        {
            interface.put(globalThis, jsc.ZigString.static("internal"), jsc.JSValue.jsBoolean(iface.is_internal != 0));
        }

        // cidr. this is here to keep ordering consistent with the node implementation
        interface.put(globalThis, jsc.ZigString.static("cidr"), cidr);

        // scopeid
        if (iface.address.address4.family == std.posix.AF.INET6) {
            interface.put(globalThis, jsc.ZigString.static("scopeid"), jsc.JSValue.jsNumber(iface.address.address6.scope_id));
        }

        // Does this entry already exist?
        const interface_name = bun.span(iface.name);
        if (try ret.get(globalThis, interface_name)) |array| {
            // Add this interface entry to the existing array
            const next_index: u32 = @intCast(try array.getLength(globalThis));
            try array.putIndex(globalThis, next_index, interface);
        } else {
            // Add it as an array with this interface as an element
            const member_name = jsc.ZigString.init(interface_name);
            var array = try jsc.JSValue.createEmptyArray(globalThis, 1);
            try array.putIndex(globalThis, 0, interface);
            ret.put(globalThis, &member_name, array);
        }
    }

    return ret;
}

pub fn release() bun.String {
    var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;

    const value = switch (Environment.os) {
        .linux => slice: {
            const uts = std.posix.uname();
            const result = bun.sliceTo(&uts.release, 0);
            bun.copy(u8, &name_buffer, result);

            break :slice name_buffer[0..result.len];
        },
        .mac => slice: {
            @memset(&name_buffer, 0);

            var size: usize = name_buffer.len;

            if (std.c.sysctlbyname(
                "kern.osrelease",
                &name_buffer,
                &size,
                null,
                0,
            ) == -1) break :slice "unknown";

            break :slice bun.sliceTo(&name_buffer, 0);
        },
        .windows => slice: {
            var info: bun.windows.libuv.uv_utsname_s = undefined;
            const err = bun.windows.libuv.uv_os_uname(&info);
            if (err != 0) {
                break :slice "unknown";
            }
            const value = bun.sliceTo(&info.release, 0);
            @memcpy(name_buffer[0..value.len], value);
            break :slice name_buffer[0..value.len];
        },
        .wasm => @compileError("unsupported os"),
    };

    return bun.String.cloneUTF8(value);
}

pub extern fn set_process_priority(pid: i32, priority: i32) i32;
pub fn setProcessPriorityImpl(pid: i32, priority: i32) std.c.E {
    if (pid < 0) return .SRCH;

    const code: i32 = set_process_priority(pid, priority);

    if (code == -2) return .SRCH;
    if (code == 0) return .SUCCESS;

    const errcode = bun.sys.getErrno(code);
    return @enumFromInt(@intFromEnum(errcode));
}

pub fn setPriority1(global: *jsc.JSGlobalObject, pid: i32, priority: i32) !void {
    const errcode = setProcessPriorityImpl(pid, priority);
    switch (errcode) {
        .SRCH => {
            const err = jsc.SystemError{
                .message = bun.String.static("no such process"),
                .code = bun.String.static("ESRCH"),
                .errno = comptime switch (bun.Environment.os) {
                    else => -@as(c_int, @intFromEnum(std.posix.E.SRCH)),
                    .windows => libuv.UV_ESRCH,
                },
                .syscall = bun.String.static("uv_os_getpriority"),
            };
            return global.throwValue(err.toErrorInstanceWithInfoObject(global));
        },
        .ACCES => {
            const err = jsc.SystemError{
                .message = bun.String.static("permission denied"),
                .code = bun.String.static("EACCES"),
                .errno = comptime switch (bun.Environment.os) {
                    else => -@as(c_int, @intFromEnum(std.posix.E.ACCES)),
                    .windows => libuv.UV_EACCES,
                },
                .syscall = bun.String.static("uv_os_getpriority"),
            };
            return global.throwValue(err.toErrorInstanceWithInfoObject(global));
        },
        .PERM => {
            const err = jsc.SystemError{
                .message = bun.String.static("operation not permitted"),
                .code = bun.String.static("EPERM"),
                .errno = comptime switch (bun.Environment.os) {
                    else => -@as(c_int, @intFromEnum(std.posix.E.SRCH)),
                    .windows => libuv.UV_ESRCH,
                },
                .syscall = bun.String.static("uv_os_getpriority"),
            };
            return global.throwValue(err.toErrorInstanceWithInfoObject(global));
        },
        else => {
            // no other error codes can be emitted
        },
    }
}

pub fn setPriority2(global: *jsc.JSGlobalObject, priority: i32) !void {
    return setPriority1(global, 0, priority);
}

pub fn totalmem() u64 {
    switch (bun.Environment.os) {
        .mac => {
            var memory_: [32]c_ulonglong = undefined;
            var size: usize = memory_.len;

            std.posix.sysctlbynameZ(
                "hw.memsize",
                &memory_,
                &size,
                null,
                0,
            ) catch |err| switch (err) {
                else => return 0,
            };

            return memory_[0];
        },
        .linux => {
            var info: c.struct_sysinfo = undefined;
            if (c.sysinfo(&info) == @as(c_int, 0)) return @as(u64, @bitCast(info.totalram)) *% @as(c_ulong, @bitCast(@as(c_ulong, info.mem_unit)));
            return 0;
        },
        .windows => {
            return libuv.uv_get_total_memory();
        },
        .wasm => @compileError("unsupported os"),
    }
}

pub fn uptime(global: *jsc.JSGlobalObject) bun.JSError!f64 {
    switch (Environment.os) {
        .windows => {
            var uptime_value: f64 = undefined;
            const err = libuv.uv_uptime(&uptime_value);
            if (err != 0) {
                const sys_err = jsc.SystemError{
                    .message = bun.String.static("failed to get system uptime"),
                    .code = bun.String.static("ERR_SYSTEM_ERROR"),
                    .errno = err,
                    .syscall = bun.String.static("uv_uptime"),
                };
                return global.throwValue(sys_err.toErrorInstance(global));
            }
            return uptime_value;
        },
        .mac => {
            var boot_time: std.posix.timeval = undefined;
            var size: usize = @sizeOf(@TypeOf(boot_time));

            std.posix.sysctlbynameZ(
                "kern.boottime",
                &boot_time,
                &size,
                null,
                0,
            ) catch |err| switch (err) {
                else => return 0,
            };

            return @floatFromInt(std.time.timestamp() - boot_time.sec);
        },
        .linux => {
            var info: c.struct_sysinfo = undefined;
            if (c.sysinfo(&info) == 0)
                return @floatFromInt(info.uptime);
            return 0;
        },
        .wasm => @compileError("unsupported os"),
    }
}

pub fn userInfo(globalThis: *jsc.JSGlobalObject, options: gen.UserInfoOptions) bun.JSError!jsc.JSValue {
    _ = options; // TODO:

    const result = jsc.JSValue.createEmptyObject(globalThis, 5);

    const home = try homedir(globalThis);
    defer home.deref();

    result.put(globalThis, jsc.ZigString.static("homedir"), try home.toJS(globalThis));

    if (comptime Environment.isWindows) {
        result.put(globalThis, jsc.ZigString.static("username"), jsc.ZigString.init(bun.env_var.USER.get() orelse "unknown").withEncoding().toJS(globalThis));
        result.put(globalThis, jsc.ZigString.static("uid"), jsc.JSValue.jsNumber(-1));
        result.put(globalThis, jsc.ZigString.static("gid"), jsc.JSValue.jsNumber(-1));
        result.put(globalThis, jsc.ZigString.static("shell"), jsc.JSValue.jsNull());
    } else {
        const username = bun.env_var.USER.get() orelse "unknown";

        result.put(globalThis, jsc.ZigString.static("username"), jsc.ZigString.init(username).withEncoding().toJS(globalThis));
        result.put(globalThis, jsc.ZigString.static("shell"), jsc.ZigString.init(bun.env_var.SHELL.get() orelse "unknown").withEncoding().toJS(globalThis));
        result.put(globalThis, jsc.ZigString.static("uid"), jsc.JSValue.jsNumber(c.getuid()));
        result.put(globalThis, jsc.ZigString.static("gid"), jsc.JSValue.jsNumber(c.getgid()));
    }

    return result;
}

pub fn version() bun.JSError!bun.String {
    var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;

    const slice: []const u8 = switch (Environment.os) {
        .mac => slice: {
            @memset(&name_buffer, 0);

            var size: usize = name_buffer.len;

            if (std.c.sysctlbyname(
                "kern.version",
                &name_buffer,
                &size,
                null,
                0,
            ) == -1) break :slice "unknown";

            break :slice bun.sliceTo(&name_buffer, 0);
        },
        .linux => slice: {
            const uts = std.posix.uname();
            const result = bun.sliceTo(&uts.version, 0);
            bun.copy(u8, &name_buffer, result);

            break :slice name_buffer[0..result.len];
        },
        .windows => slice: {
            var info: bun.windows.libuv.uv_utsname_s = undefined;
            const err = bun.windows.libuv.uv_os_uname(&info);
            if (err != 0) {
                break :slice "unknown";
            }
            const slice = bun.sliceTo(&info.version, 0);
            @memcpy(name_buffer[0..slice.len], slice);
            break :slice name_buffer[0..slice.len];
        },
        .wasm => @compileError("unsupported os"),
    };

    return bun.String.cloneUTF8(slice);
}

/// Given a netmask returns a CIDR suffix.  Returns null if the mask is not valid.
/// `@TypeOf(mask)` must be one of u32 (IPv4) or u128 (IPv6)
fn netmaskToCIDRSuffix(mask: anytype) ?u8 {
    const T = @TypeOf(mask);
    comptime bun.assert(T == u32 or T == u128);

    const mask_bits = @byteSwap(mask);

    // Validity check: set bits should be left-contiguous
    const first_zero = @clz(~mask_bits);
    const last_one = @bitSizeOf(T) - @ctz(mask_bits);
    if (first_zero < @bitSizeOf(T) and first_zero < last_one) return null;
    return first_zero;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const c = bun.c;
const jsc = bun.jsc;
const strings = bun.strings;
const sys = bun.sys;
const gen = bun.gen.node_os;
const libuv = bun.windows.libuv;
