const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const C = bun.C;
const string = bun.string;
const strings = bun.strings;
const JSC = bun.JSC;
const Environment = bun.Environment;
const Global = bun.Global;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;

const libuv = bun.windows.libuv;
pub const OS = struct {
    pub fn create(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        const module = JSC.JSValue.createEmptyObject(globalObject, 16);

        module.put(globalObject, JSC.ZigString.static("cpus"), JSC.NewFunction(globalObject, JSC.ZigString.static("cpus"), 0, cpus, true));
        module.put(globalObject, JSC.ZigString.static("freemem"), JSC.NewFunction(globalObject, JSC.ZigString.static("freemem"), 0, freemem, true));
        module.put(globalObject, JSC.ZigString.static("getPriority"), JSC.NewFunction(globalObject, JSC.ZigString.static("getPriority"), 1, getPriority, true));
        module.put(globalObject, JSC.ZigString.static("homedir"), JSC.NewFunction(globalObject, JSC.ZigString.static("homedir"), 0, homedir, true));
        module.put(globalObject, JSC.ZigString.static("hostname"), JSC.NewFunction(globalObject, JSC.ZigString.static("hostname"), 0, hostname, true));
        module.put(globalObject, JSC.ZigString.static("loadavg"), JSC.NewFunction(globalObject, JSC.ZigString.static("loadavg"), 0, loadavg, true));
        module.put(globalObject, JSC.ZigString.static("machine"), JSC.NewFunction(globalObject, JSC.ZigString.static("machine"), 0, machine, true));
        module.put(globalObject, JSC.ZigString.static("networkInterfaces"), JSC.NewFunction(globalObject, JSC.ZigString.static("networkInterfaces"), 0, networkInterfaces, true));
        module.put(globalObject, JSC.ZigString.static("release"), JSC.NewFunction(globalObject, JSC.ZigString.static("release"), 0, release, true));
        module.put(globalObject, JSC.ZigString.static("setPriority"), JSC.NewFunction(globalObject, JSC.ZigString.static("setPriority"), 2, setPriority, true));
        module.put(globalObject, JSC.ZigString.static("totalmem"), JSC.NewFunction(globalObject, JSC.ZigString.static("totalmem"), 0, totalmem, true));
        module.put(globalObject, JSC.ZigString.static("type"), JSC.NewFunction(globalObject, JSC.ZigString.static("type"), 0, OS.type, true));
        module.put(globalObject, JSC.ZigString.static("uptime"), JSC.NewFunction(globalObject, JSC.ZigString.static("uptime"), 0, uptime, true));
        module.put(globalObject, JSC.ZigString.static("userInfo"), JSC.NewFunction(globalObject, JSC.ZigString.static("userInfo"), 0, userInfo, true));
        module.put(globalObject, JSC.ZigString.static("version"), JSC.NewFunction(globalObject, JSC.ZigString.static("version"), 0, version, true));
        module.put(globalObject, JSC.ZigString.static("machine"), JSC.NewFunction(globalObject, JSC.ZigString.static("machine"), 0, machine, true));

        return module;
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
                ret.put(globalThis, JSC.ZigString.static(fieldName), JSC.JSValue.jsNumberFromUint64(@field(self, fieldName)));
            }
            return ret;
        }
    };

    pub fn cpus(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        return switch (Environment.os) {
            .linux => cpusImplLinux(globalThis),
            .mac => cpusImplDarwin(globalThis),
            .windows => cpusImplWindows(globalThis),
            else => @compileError("unsupported OS"),
        } catch {
            const err = JSC.SystemError{
                .message = bun.String.static("Failed to get cpu information"),
                .code = bun.String.static(@tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR)),
            };

            globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
            return .undefined;
        };
    }

    fn cpusImplLinux(globalThis: *JSC.JSGlobalObject) !JSC.JSValue {
        // Create the return array
        const values = JSC.JSValue.createEmptyArray(globalThis, 0);
        var num_cpus: u32 = 0;

        var stack_fallback = std.heap.stackFallback(1024 * 8, bun.default_allocator);
        var file_buf = std.ArrayList(u8).init(stack_fallback.get());
        defer file_buf.deinit();

        // Read /proc/stat to get number of CPUs and times
        if (std.fs.openFileAbsolute("/proc/stat", .{})) |file| {
            defer file.close();

            const read = try bun.sys.File.from(file).readToEndWithArrayList(&file_buf).unwrap();
            defer file_buf.clearRetainingCapacity();
            const contents = file_buf.items[0..read];

            var line_iter = std.mem.tokenizeScalar(u8, contents, '\n');

            // Skip the first line (aggregate of all CPUs)
            _ = line_iter.next();

            // Read each CPU line
            while (line_iter.next()) |line| {
                // CPU lines are formatted as `cpu0 user nice sys idle iowait irq softirq`
                var toks = std.mem.tokenize(u8, line, " \t");
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

            const read = try bun.sys.File.from(file).readToEndWithArrayList(&file_buf).unwrap();
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
                        const cpu = JSC.JSObject.getIndex(values, globalThis, cpu_index);
                        cpu.put(globalThis, JSC.ZigString.static("model"), JSC.ZigString.static("unknown").withEncoding().toJS(globalThis));
                    }
                    // If this line starts a new processor, parse the index from the line
                    const digits = std.mem.trim(u8, line[key_processor.len..], " \t\n");
                    cpu_index = try std.fmt.parseInt(u32, digits, 10);
                    if (cpu_index >= num_cpus) return error.too_may_cpus;
                    has_model_name = false;
                } else if (strings.hasPrefixComptime(line, key_model_name)) {
                    // If this is the model name, extract it and store on the current cpu
                    const model_name = line[key_model_name.len..];
                    const cpu = JSC.JSObject.getIndex(values, globalThis, cpu_index);
                    cpu.put(globalThis, JSC.ZigString.static("model"), JSC.ZigString.init(model_name).withEncoding().toJS(globalThis));
                    has_model_name = true;
                }
            }
            if (!has_model_name) {
                const cpu = JSC.JSObject.getIndex(values, globalThis, cpu_index);
                cpu.put(globalThis, JSC.ZigString.static("model"), JSC.ZigString.static("unknown").withEncoding().toJS(globalThis));
            }
        } else |_| {
            // Initialize model name to "unknown"
            var it = values.arrayIterator(globalThis);
            while (it.next()) |cpu| {
                cpu.put(globalThis, JSC.ZigString.static("model"), JSC.ZigString.static("unknown").withEncoding().toJS(globalThis));
            }
        }

        // Read /sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq to get current frequency (optional)
        for (0..num_cpus) |cpu_index| {
            const cpu = JSC.JSObject.getIndex(values, globalThis, @truncate(cpu_index));

            var path_buf: [128]u8 = undefined;
            const path = try std.fmt.bufPrint(&path_buf, "/sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq", .{cpu_index});
            if (std.fs.openFileAbsolute(path, .{})) |file| {
                defer file.close();

                const read = try bun.sys.File.from(file).readToEndWithArrayList(&file_buf).unwrap();
                defer file_buf.clearRetainingCapacity();
                const contents = file_buf.items[0..read];

                const digits = std.mem.trim(u8, contents, " \n");
                const speed = (std.fmt.parseInt(u64, digits, 10) catch 0) / 1000;

                cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(speed));
            } else |_| {
                // Initialize CPU speed to 0
                cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(0));
            }
        }

        return values;
    }

    extern fn bun_sysconf__SC_CLK_TCK() isize;
    fn cpusImplDarwin(globalThis: *JSC.JSGlobalObject) !JSC.JSValue {
        const local_bindings = @import("../../darwin_c.zig");
        const c = std.c;

        // Fetch the CPU info structure
        var num_cpus: c.natural_t = 0;
        var info: [*]local_bindings.processor_cpu_load_info = undefined;
        var info_size: std.c.mach_msg_type_number_t = 0;
        if (local_bindings.host_processor_info(std.c.mach_host_self(), local_bindings.PROCESSOR_CPU_LOAD_INFO, &num_cpus, @as(*local_bindings.processor_info_array_t, @ptrCast(&info)), &info_size) != .SUCCESS) {
            return error.no_processor_info;
        }
        defer _ = std.c.vm_deallocate(std.c.mach_task_self(), @intFromPtr(info), info_size);

        // Ensure we got the amount of data we expected to guard against buffer overruns
        if (info_size != C.PROCESSOR_CPU_LOAD_INFO_COUNT * num_cpus) {
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
        //NOTE: sysctlbyname doesn't update len if it was large enough, so we
        // still have to find the null terminator.  All cpus can share the same
        // model name.
        const model_name = JSC.ZigString.init(std.mem.sliceTo(&model_name_buf, 0)).withEncoding().toJS(globalThis);

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
        const values = JSC.JSValue.createEmptyArray(globalThis, @as(u32, @intCast(num_cpus)));
        var cpu_index: u32 = 0;
        while (cpu_index < num_cpus) : (cpu_index += 1) {
            const times = CPUTimes{
                .user = info[cpu_index].cpu_ticks[0] * multiplier,
                .nice = info[cpu_index].cpu_ticks[3] * multiplier,
                .sys = info[cpu_index].cpu_ticks[1] * multiplier,
                .idle = info[cpu_index].cpu_ticks[2] * multiplier,
                .irq = 0, // not available
            };

            const cpu = JSC.JSValue.createEmptyObject(globalThis, 3);
            cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(speed / 1_000_000));
            cpu.put(globalThis, JSC.ZigString.static("model"), model_name);
            cpu.put(globalThis, JSC.ZigString.static("times"), times.toValue(globalThis));

            values.putIndex(globalThis, cpu_index, cpu);
        }
        return values;
    }

    pub fn cpusImplWindows(globalThis: *JSC.JSGlobalObject) !JSC.JSValue {
        var cpu_infos: [*]libuv.uv_cpu_info_t = undefined;
        var count: c_int = undefined;
        const err = libuv.uv_cpu_info(&cpu_infos, &count);
        if (err != 0) {
            return error.no_processor_info;
        }
        defer libuv.uv_free_cpu_info(cpu_infos, count);

        const values = JSC.JSValue.createEmptyArray(globalThis, 0);

        for (cpu_infos[0..@intCast(count)], 0..@intCast(count)) |cpu_info, i| {
            const times = CPUTimes{
                .user = cpu_info.cpu_times.user,
                .nice = cpu_info.cpu_times.nice,
                .sys = cpu_info.cpu_times.sys,
                .idle = cpu_info.cpu_times.idle,
                .irq = cpu_info.cpu_times.irq,
            };

            const cpu = JSC.JSValue.createEmptyObject(globalThis, 3);
            cpu.put(globalThis, JSC.ZigString.static("model"), JSC.ZigString.init(bun.span(cpu_info.model)).withEncoding().toJS(globalThis));
            cpu.put(globalThis, JSC.ZigString.static("speed"), JSC.JSValue.jsNumber(cpu_info.speed));
            cpu.put(globalThis, JSC.ZigString.static("times"), times.toValue(globalThis));

            values.putIndex(globalThis, @intCast(i), cpu);
        }

        return values;
    }

    pub fn endianness(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.ZigString.init("LE").withEncoding().toJS(globalThis);
    }

    pub fn freemem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getFreeMemory());
    }

    pub fn getPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        var args_ = callframe.arguments(1);
        const arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len > 0 and !arguments[0].isNumber()) {
            globalThis.ERR_INVALID_ARG_TYPE(
                "getPriority() expects a number",
                .{},
            ).throw();
            return .undefined;
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
                .message = bun.String.static("A system error occurred: uv_os_getpriority returned ESRCH (no such process)"),
                .code = bun.String.static("ERR_SYSTEM_ERROR"),
                //.info = info,
                .errno = -3,
                .syscall = bun.String.static("uv_os_getpriority"),
            };

            globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
            return .undefined;
        }

        return JSC.JSValue.jsNumberFromInt32(priority);
    }

    pub fn homedir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        const dir: []const u8 = brk: {
            if (comptime Environment.isWindows) {
                if (bun.getenvZ("USERPROFILE")) |env|
                    break :brk bun.asByteSlice(env);
            } else {
                if (bun.getenvZ("HOME")) |env|
                    break :brk bun.asByteSlice(env);
            }

            break :brk "unknown";
        };

        return JSC.ZigString.init(dir).withEncoding().toJS(globalThis);
    }

    pub fn hostname(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        if (comptime Environment.isWindows) {
            var name_buffer: [129:0]u16 = undefined;
            if (bun.windows.GetHostNameW(&name_buffer, name_buffer.len) == 0) {
                const str = bun.String.createUTF16(bun.sliceTo(&name_buffer, 0));
                defer str.deref();
                return str.toJS(globalThis);
            }

            var result: std.os.windows.ws2_32.WSADATA = undefined;
            if (std.os.windows.ws2_32.WSAStartup(0x202, &result) == 0) {
                if (bun.windows.GetHostNameW(&name_buffer, name_buffer.len) == 0) {
                    const str = bun.String.createUTF16(bun.sliceTo(&name_buffer, 0));
                    defer str.deref();
                    return str.toJS(globalThis);
                }
            }

            return JSC.ZigString.init("unknown").withEncoding().toJS(globalThis);
        }

        var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;

        return JSC.ZigString.init(std.posix.gethostname(&name_buffer) catch "unknown").withEncoding().toJS(globalThis);
    }

    pub fn loadavg(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        const result = C.getSystemLoadavg();
        return JSC.JSArray.create(globalThis, &.{
            JSC.JSValue.jsNumber(result[0]),
            JSC.JSValue.jsNumber(result[1]),
            JSC.JSValue.jsNumber(result[2]),
        });
    }

    pub fn networkInterfaces(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        return switch (Environment.os) {
            .windows => networkInterfacesWindows(globalThis),
            else => networkInterfacesPosix(globalThis),
        };
    }

    fn networkInterfacesPosix(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        // getifaddrs sets a pointer to a linked list
        var interface_start: ?*C.ifaddrs = null;
        const rc = C.getifaddrs(&interface_start);
        if (rc != 0) {
            const err = JSC.SystemError{
                .message = bun.String.static("A system error occurred: getifaddrs returned an error"),
                .code = bun.String.static("ERR_SYSTEM_ERROR"),
                .errno = @intFromEnum(std.posix.errno(rc)),
                .syscall = bun.String.static("getifaddrs"),
            };

            globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
            return .undefined;
        }
        defer C.freeifaddrs(interface_start);

        const helpers = struct {
            // We'll skip interfaces that aren't actually available
            pub fn skip(iface: *C.ifaddrs) bool {
                // Skip interfaces that aren't actually available
                if (iface.ifa_flags & C.IFF_RUNNING == 0) return true;
                if (iface.ifa_flags & C.IFF_UP == 0) return true;
                if (iface.ifa_addr == null) return true;

                return false;
            }

            // We won't actually return link-layer interfaces but we need them for
            //  extracting the MAC address
            pub fn isLinkLayer(iface: *C.ifaddrs) bool {
                if (iface.ifa_addr == null) return false;
                return if (comptime Environment.isLinux)
                    return iface.ifa_addr.*.sa_family == std.posix.AF.PACKET
                else if (comptime Environment.isMac)
                    return iface.ifa_addr.?.*.family == std.posix.AF.LINK
                else
                    unreachable;
            }

            pub fn isLoopback(iface: *C.ifaddrs) bool {
                return iface.ifa_flags & C.IFF_LOOPBACK == C.IFF_LOOPBACK;
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

        var ret = JSC.JSValue.createEmptyObject(globalThis, 8);

        // Second pass through, populate each interface object
        it = interface_start;
        while (it) |iface| : (it = iface.ifa_next) {
            if (helpers.skip(iface) or helpers.isLinkLayer(iface)) continue;

            const interface_name = std.mem.sliceTo(iface.ifa_name, 0);
            const addr = std.net.Address.initPosix(@alignCast(@as(*std.posix.sockaddr, @ptrCast(iface.ifa_addr))));
            const netmask = std.net.Address.initPosix(@alignCast(@as(*std.posix.sockaddr, @ptrCast(iface.ifa_netmask))));

            var interface = JSC.JSValue.createEmptyObject(globalThis, 7);

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
                var cidr = JSC.JSValue.null;
                if (maybe_suffix) |suffix| {
                    //NOTE addr_str might not start at buf[0] due to slicing in formatIp
                    const start = @intFromPtr(addr_str.ptr) - @intFromPtr(&buf[0]);
                    // Start writing the suffix immediately after the address
                    const suffix_str = std.fmt.bufPrint(buf[start + addr_str.len ..], "/{}", .{suffix}) catch unreachable;
                    // The full cidr value is the address + the suffix
                    const cidr_str = buf[start .. start + addr_str.len + suffix_str.len];
                    cidr = JSC.ZigString.init(cidr_str).withEncoding().toJS(globalThis);
                }

                interface.put(globalThis, JSC.ZigString.static("address"), JSC.ZigString.init(addr_str).withEncoding().toJS(globalThis));
                interface.put(globalThis, JSC.ZigString.static("cidr"), cidr);
            }

            // netmask <string> The IPv4 or IPv6 network mask
            {
                var buf: [64]u8 = undefined;
                const str = bun.fmt.formatIp(netmask, &buf) catch unreachable;
                interface.put(globalThis, JSC.ZigString.static("netmask"), JSC.ZigString.init(str).withEncoding().toJS(globalThis));
            }

            // family <string> Either IPv4 or IPv6
            interface.put(globalThis, JSC.ZigString.static("family"), (switch (addr.any.family) {
                std.posix.AF.INET => JSC.ZigString.static("IPv4"),
                std.posix.AF.INET6 => JSC.ZigString.static("IPv6"),
                else => JSC.ZigString.static("unknown"),
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
                        break @as(?*C.sockaddr_dl, @ptrCast(@alignCast(ll_iface.ifa_addr)));
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
                        interface.put(globalThis, JSC.ZigString.static("mac"), JSC.ZigString.init(mac).withEncoding().toJS(globalThis));
                    } else {
                        const mac = std.fmt.bufPrint(&mac_buf, "{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}", .{
                            addr_data[0], addr_data[1], addr_data[2],
                            addr_data[3], addr_data[4], addr_data[5],
                        }) catch unreachable;
                        interface.put(globalThis, JSC.ZigString.static("mac"), JSC.ZigString.init(mac).withEncoding().toJS(globalThis));
                    }
                } else {
                    const mac = "00:00:00:00:00:00";
                    interface.put(globalThis, JSC.ZigString.static("mac"), JSC.ZigString.init(mac).withEncoding().toJS(globalThis));
                }
            }

            // internal <boolean> true if the network interface is a loopback or similar interface that is not remotely accessible; otherwise false
            interface.put(globalThis, JSC.ZigString.static("internal"), JSC.JSValue.jsBoolean(helpers.isLoopback(iface)));

            // scopeid <number> The numeric IPv6 scope ID (only specified when family is IPv6)
            if (addr.any.family == std.posix.AF.INET6) {
                interface.put(globalThis, JSC.ZigString.static("scope_id"), JSC.JSValue.jsNumber(addr.in6.sa.scope_id));
            }

            // Does this entry already exist?
            if (ret.get(globalThis, interface_name)) |array| {
                // Add this interface entry to the existing array
                const next_index = @as(u32, @intCast(array.getLength(globalThis)));
                array.putIndex(globalThis, next_index, interface);
            } else {
                // Add it as an array with this interface as an element
                const member_name = JSC.ZigString.init(interface_name);
                var array = JSC.JSValue.createEmptyArray(globalThis, 1);
                array.putIndex(globalThis, 0, interface);
                ret.put(globalThis, &member_name, array);
            }
        }

        return ret;
    }

    fn networkInterfacesWindows(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var ifaces: [*]libuv.uv_interface_address_t = undefined;
        var count: c_int = undefined;
        const err = libuv.uv_interface_addresses(&ifaces, &count);
        if (err != 0) {
            const sys_err = JSC.SystemError{
                .message = bun.String.static("uv_interface_addresses failed"),
                .code = bun.String.static("ERR_SYSTEM_ERROR"),
                //.info = info,
                .errno = err,
                .syscall = bun.String.static("uv_interface_addresses"),
            };
            globalThis.vm().throwError(globalThis, sys_err.toErrorInstance(globalThis));
            return .zero;
        }
        defer libuv.uv_free_interface_addresses(ifaces, count);

        var ret = JSC.JSValue.createEmptyObject(globalThis, 8);

        // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
        var ip_buf: [65]u8 = undefined;
        var mac_buf: [17]u8 = undefined;

        for (ifaces[0..@intCast(count)]) |iface| {
            var interface = JSC.JSValue.createEmptyObject(globalThis, 7);

            // address <string> The assigned IPv4 or IPv6 address
            // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
            var cidr = JSC.JSValue.null;
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
                    cidr = JSC.ZigString.init(cidr_str).withEncoding().toJS(globalThis);
                }

                interface.put(globalThis, JSC.ZigString.static("address"), JSC.ZigString.init(addr_str).withEncoding().toJS(globalThis));
            }

            // netmask
            {
                const str = bun.fmt.formatIp(
                    // std.net.Address will do ptrCast depending on the family so this is ok
                    std.net.Address.initPosix(@ptrCast(&iface.netmask.netmask4)),
                    &ip_buf,
                ) catch unreachable;
                interface.put(globalThis, JSC.ZigString.static("netmask"), JSC.ZigString.init(str).withEncoding().toJS(globalThis));
            }
            // family
            interface.put(globalThis, JSC.ZigString.static("family"), (switch (iface.address.address4.family) {
                std.posix.AF.INET => JSC.ZigString.static("IPv4"),
                std.posix.AF.INET6 => JSC.ZigString.static("IPv6"),
                else => JSC.ZigString.static("unknown"),
            }).toJS(globalThis));

            // mac
            {
                const phys = iface.phys_addr;
                const mac = std.fmt.bufPrint(&mac_buf, "{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}:{x:0>2}", .{
                    phys[0], phys[1], phys[2], phys[3], phys[4], phys[5],
                }) catch unreachable;
                interface.put(globalThis, JSC.ZigString.static("mac"), JSC.ZigString.init(mac).withEncoding().toJS(globalThis));
            }

            // internal
            {
                interface.put(globalThis, JSC.ZigString.static("internal"), JSC.JSValue.jsBoolean(iface.is_internal != 0));
            }

            // cidr. this is here to keep ordering consistent with the node implementation
            interface.put(globalThis, JSC.ZigString.static("cidr"), cidr);

            // scopeid
            if (iface.address.address4.family == std.posix.AF.INET6) {
                interface.put(globalThis, JSC.ZigString.static("scopeid"), JSC.JSValue.jsNumber(iface.address.address6.scope_id));
            }

            // Does this entry already exist?
            const interface_name = bun.span(iface.name);
            if (ret.get(globalThis, interface_name)) |array| {
                // Add this interface entry to the existing array
                const next_index = @as(u32, @intCast(array.getLength(globalThis)));
                array.putIndex(globalThis, next_index, interface);
            } else {
                // Add it as an array with this interface as an element
                const member_name = JSC.ZigString.init(interface_name);
                var array = JSC.JSValue.createEmptyArray(globalThis, 1);
                array.putIndex(globalThis, 0, interface);
                ret.put(globalThis, &member_name, array);
            }
        }

        return ret;
    }

    pub fn platform(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.ZigString.init(Global.os_name).withEncoding().toJS(globalThis);
    }

    pub fn release(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());
        var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getRelease(&name_buffer)).withEncoding().toJS(globalThis);
    }

    pub fn setPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        var args_ = callframe.arguments(2);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len == 0) {
            const err = JSC.toTypeError(
                .ERR_INVALID_ARG_TYPE,
                "The \"priority\" argument must be of type number. Received undefined",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return .undefined;
        }

        const pid = if (arguments.len == 2) arguments[0].coerce(i32, globalThis) else 0;
        const priority = if (arguments.len == 2) arguments[1].coerce(i32, globalThis) else arguments[0].coerce(i32, globalThis);

        if (priority < -20 or priority > 19) {
            const err = JSC.toTypeError(
                .ERR_OUT_OF_RANGE,
                "The value of \"priority\" is out of range. It must be >= -20 && <= 19",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return .undefined;
        }

        const errcode = C.setProcessPriority(pid, priority);
        switch (errcode) {
            .SRCH => {
                const err = JSC.SystemError{
                    .message = bun.String.static("A system error occurred: uv_os_setpriority returned ESRCH (no such process)"),
                    .code = bun.String.static(@tagName(.ERR_SYSTEM_ERROR)),
                    //.info = info,
                    .errno = -3,
                    .syscall = bun.String.static("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return .undefined;
            },
            .ACCES => {
                const err = JSC.SystemError{
                    .message = bun.String.static("A system error occurred: uv_os_setpriority returned EACCESS (permission denied)"),
                    .code = bun.String.static(@tagName(.ERR_SYSTEM_ERROR)),
                    //.info = info,
                    .errno = -13,
                    .syscall = bun.String.static("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return .undefined;
            },
            else => {},
        }

        return .undefined;
    }

    pub fn totalmem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumberFromUint64(C.getTotalMemory());
    }

    pub fn @"type"(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        if (comptime Environment.isWindows)
            return JSC.ZigString.static("Windows_NT").toJS(globalThis)
        else if (comptime Environment.isMac)
            return JSC.ZigString.static("Darwin").toJS(globalThis)
        else if (comptime Environment.isLinux)
            return JSC.ZigString.static("Linux").toJS(globalThis);

        return JSC.ZigString.init(Global.os_name).withEncoding().toJS(globalThis);
    }

    pub fn uptime(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        if (Environment.isWindows) {
            var uptime_value: f64 = undefined;
            const err = libuv.uv_uptime(&uptime_value);
            if (err != 0) {
                const sys_err = JSC.SystemError{
                    .message = bun.String.static("failed to get system uptime"),
                    .code = bun.String.static("ERR_SYSTEM_ERROR"),
                    .errno = err,
                    .syscall = bun.String.static("uv_uptime"),
                };
                globalThis.vm().throwError(globalThis, sys_err.toErrorInstance(globalThis));
                return .zero;
            }
            return JSC.JSValue.jsNumber(uptime_value);
        }

        return JSC.JSValue.jsNumberFromUint64(C.getSystemUptime());
    }

    pub fn userInfo(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const result = JSC.JSValue.createEmptyObject(globalThis, 5);

        result.put(globalThis, JSC.ZigString.static("homedir"), homedir(globalThis, callframe));

        if (comptime Environment.isWindows) {
            result.put(globalThis, JSC.ZigString.static("username"), JSC.ZigString.init(bun.getenvZ("USERNAME") orelse "unknown").withEncoding().toJS(globalThis));
            result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, JSC.ZigString.static("shell"), JSC.JSValue.jsNull());
        } else {
            const username = bun.getenvZ("USER") orelse "unknown";

            result.put(globalThis, JSC.ZigString.static("username"), JSC.ZigString.init(username).withEncoding().toJS(globalThis));
            result.put(globalThis, JSC.ZigString.static("shell"), JSC.ZigString.init(bun.getenvZ("SHELL") orelse "unknown").withEncoding().toJS(globalThis));

            result.put(globalThis, JSC.ZigString.static("uid"), JSC.JSValue.jsNumber(C.getuid()));
            result.put(globalThis, JSC.ZigString.static("gid"), JSC.JSValue.jsNumber(C.getgid()));
        }

        return result;
    }

    pub fn version(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());
        var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;
        return JSC.ZigString.init(C.getVersion(&name_buffer)).withEncoding().toJS(globalThis);
    }

    inline fn getMachineName() [:0]const u8 {
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

    pub fn machine(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());
        return JSC.ZigString.static(comptime getMachineName()).toJS(globalThis);
    }
};

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
