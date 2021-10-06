usingnamespace @import("../global.zig");

const sync = @import("../sync.zig");
const std = @import("std");
const HTTPClient = @import("../http_client.zig");
const URL = @import("../query_string_map.zig").URL;
const Fs = @import("../fs.zig");
const Analytics = @import("./analytics_schema.zig").analytics;
const Writer = @import("./analytics_schema.zig").Writer;
const Headers = @import("../javascript/jsc/webcore/response.zig").Headers;

pub const EventName = enum(u8) {
    bundle_success,
    bundle_fail,
    bundle_start,
    http_start,
    http_build,
};

var random: std.rand.DefaultPrng = undefined;
const DotEnv = @import("../env_loader.zig");

const platform_arch = if (Environment.isAarch64) Analytics.Architecture.arm else Analytics.Architecture.x64;

pub const Event = struct {
    timestamp: u64,
    data: Data,

    pub fn init(comptime name: EventName) Event {
        const millis = std.time.milliTimestamp();

        const timestamp = if (millis < 0) 0 else @intCast(u64, millis);

        return Event{ .timestamp = timestamp, .data = @unionInit(Data, @tagName(name), void{}) };
    }
};

pub const Data = union(EventName) {
    bundle_success: void,
    bundle_fail: void,
    bundle_start: void,
    http_start: void,
    http_build: void,

    pub fn toKind(this: Data) Analytics.EventKind {
        return switch (this) {
            .bundle_success => .bundle_success,
            .bundle_fail => .bundle_fail,
            .bundle_start => .bundle_start,
            .http_start => .http_start,
            .http_build => .http_build,
        };
    }
};

const EventQueue = sync.Channel(Event, .Dynamic);
var event_queue: EventQueue = undefined;

pub const GenerateHeader = struct {
    pub fn generate() Analytics.EventListHeader {
        if (Environment.isMac) {
            return Analytics.EventListHeader{
                .machine_id = GenerateMachineID.forMac() catch Analytics.Uint64{},
                .platform = GeneratePlatform.forMac(),
                .build_id = comptime @truncate(u32, Global.build_id),
                .session_id = random.random.int(u32),
            };
        }

        if (Environment.isLinux) {
            return Analytics.EventListHeader{
                .machine_id = GenerateMachineID.forLinux() catch Analytics.Uint64{},
                .platform = GeneratePlatform.forLinux(),
                .build_id = comptime @truncate(u32, Global.build_id),
                .session_id = random.random.int(u32),
            };
        }

        unreachable;
    }

    pub const GeneratePlatform = struct {
        var osversion_name: [32]u8 = undefined;
        pub fn forMac() Analytics.Platform {
            std.mem.set(u8, std.mem.span(&osversion_name), 0);

            var platform = Analytics.Platform{ .os = Analytics.OperatingSystem.macos, .version = &[_]u8{}, .arch = platform_arch };
            var osversion_name_buf: [2]c_int = undefined;
            var osversion_name_ptr = osversion_name.len - 1;
            var len = osversion_name.len - 1;
            if (std.c.sysctlbyname("kern.osrelease", &osversion_name, &len, null, 0) == -1) return platform;

            platform.version = std.mem.span(std.mem.sliceTo(std.mem.span(&osversion_name), @as(u8, 0)));
            return platform;
        }

        pub var linux_os_name: std.c.utsname = undefined;

        pub fn forLinux() Analytics.Platform {
            linux_os_name = std.mem.zeroes(linux_os_name);

            std.c.uname(&linux_os_name);

            const release = std.mem.span(linux_os_name.release);
            const version = std.mem.sliceTo(std.mem.span(linux_os_name.version).ptr, @as(u8, 0));
            // Linux DESKTOP-P4LCIEM 5.10.16.3-microsoft-standard-WSL2 #1 SMP Fri Apr 2 22:23:49 UTC 2021 x86_64 x86_64 x86_64 GNU/Linux
            if (std.mem.indexOf(u8, release, "microsoft") != null) {
                return Analytics.Platform{ .os = Analytics.OperatingSystem.wsl, .version = version, .arch = platform_arch };
            }

            return Analytics.Platform{ .os = Analytics.OperatingSystem.linux, .version = version, .arch = platform_arch };
        }
    };

    // https://github.com/denisbrodbeck/machineid
    pub const GenerateMachineID = struct {
        pub fn forMac() !Analytics.Uint64 {
            const cmds = [_]string{
                "/usr/sbin/ioreg",
                "-rd1",
                "-c",
                "IOPlatformExpertDevice",
            };

            const result = try std.ChildProcess.exec(.{
                .allocator = default_allocator,
                .cwd = Fs.FileSystem.instance.top_level_dir,
                .argv = std.mem.span(&cmds),
            });

            var out: []const u8 = result.stdout;
            var offset: usize = 0;
            offset = std.mem.lastIndexOf(u8, result.stdout, "\"IOPlatformUUID\"") orelse return Analytics.Uint64{};
            out = std.mem.trimLeft(u8, out[offset + "\"IOPlatformUUID\"".len ..], " \n\t=");
            if (out.len == 0 or out[0] != '"') return Analytics.Uint64{};
            out = out[1..];
            offset = std.mem.indexOfScalar(u8, out, '"') orelse return Analytics.Uint64{};
            out = out[0..offset];

            const hash = std.hash.Wyhash.hash(0, std.mem.trim(u8, out, "\n\r "));
            var hash_bytes = std.mem.asBytes(&hash);
            return Analytics.Uint64{
                .first = std.mem.readIntNative(u32, hash_bytes[0..4]),
                .second = std.mem.readIntNative(u32, hash_bytes[4..8]),
            };
        }

        pub var linux_machine_id: [256]u8 = undefined;

        pub fn forLinux() !Analytics.Uint64 {
            var file = std.fs.openFileAbsoluteZ("/var/lib/dbus/machine-id", .{ .read = true }) catch |err| brk: {
                break :brk try std.fs.openFileAbsoluteZ("/etc/machine-id", .{ .read = true });
            };
            defer file.close();
            var read_count = try file.read(&linux_machine_id);

            const hash = std.hash.Wyhash.hash(0, std.mem.trim(u8, linux_machine_id[0..read_count], "\n\r "));
            var hash_bytes = std.mem.asBytes(&hash);
            return Analytics.Uint64{
                .first = std.mem.readIntNative(u32, hash_bytes[0..4]),
                .second = std.mem.readIntNative(u32, hash_bytes[4..8]),
            };
        }
    };
};

pub var has_loaded = false;
pub var disabled = false;
pub fn enqueue(comptime name: EventName) void {
    if (disabled) return;

    if (!has_loaded) {
        if (!start()) return;
    }

    var items = [_]Event{Event.init(name)};
    _ = event_queue.write(&items) catch false;
    std.Thread.Futex.wake(&counter, 1);
}

pub var thread: std.Thread = undefined;
var counter: std.atomic.Atomic(u32) = undefined;

fn start() bool {
    @setCold(true);

    defer has_loaded = true;
    counter = std.atomic.Atomic(u32).init(0);

    event_queue = EventQueue.init(std.heap.c_allocator);
    spawn() catch |err| {
        if (comptime isDebug) {
            Output.prettyErrorln("[Analytics] error spawning thread {s}", .{@errorName(err)});
            Output.flush();
        }

        disabled = true;
        return false;
    };
    return true;
}

fn spawn() !void {
    @setCold(true);
    has_loaded = true;
    thread = try std.Thread.spawn(.{}, readloop, .{});
}

const headers_buf: string = "Content-Type binary/peechy";
const header_entry = Headers.Kv{
    .name = .{ .offset = 0, .length = @intCast(u32, "Content-Type".len) },
    .value = .{
        .offset = std.mem.indexOf(u8, headers_buf, "binary/peechy").?,
        .length = @intCast(u32, "binary/peechy".len),
    },
};

fn readloop() anyerror!void {
    defer disabled = true;
    Output.Source.configureThread();
    defer Output.flush();
    thread.setName("Analytics") catch {};

    var event_list = EventList.init();
    event_list.client.verbose = FeatureFlags.verbose_analytics;
    event_list.client.header_entries.append(default_allocator, header_entry) catch unreachable;
    event_list.client.header_buf = headers_buf;

    // everybody's random should be random
    while (true) {
        // Wait for the next event by blocking
        while (event_queue.tryReadItem() catch null) |item| {
            event_list.push(item);
        }

        if (event_list.events.items.len > 0) {
            event_list.flush();
        }

        std.Thread.Futex.wait(&counter, counter.load(.Acquire), null) catch unreachable;
    }
}

pub const EventList = struct {
    header: Analytics.EventListHeader,
    events: std.ArrayList(Event),
    client: HTTPClient,

    out_buffer: MutableString,
    in_buffer: std.ArrayList(u8),

    pub fn init() EventList {
        random = std.rand.DefaultPrng.init(@intCast(u64, std.time.milliTimestamp()));
        return EventList{
            .header = GenerateHeader.generate(),
            .events = std.ArrayList(Event).init(default_allocator),
            .in_buffer = std.ArrayList(u8).init(default_allocator),
            .client = HTTPClient.init(
                default_allocator,
                .POST,
                URL.parse(Environment.analytics_url),
                Headers.Entries{},
                "",
            ),
            .out_buffer = MutableString.init(default_allocator, 0) catch unreachable,
        };
    }

    pub fn push(this: *EventList, event: Event) void {
        this.events.append(event) catch unreachable;
    }

    pub fn flush(this: *EventList) void {
        this._flush() catch |err| {
            Output.prettyErrorln("[Analytics] Error: {s}", .{@errorName(err)});
            Output.flush();
        };
    }

    pub var is_stuck = false;
    var stuck_count: u8 = 0;
    fn _flush(this: *EventList) !void {
        this.in_buffer.clearRetainingCapacity();

        const AnalyticsWriter = Writer(*std.ArrayList(u8).Writer);

        var in_buffer = &this.in_buffer;
        var buffer_writer = in_buffer.writer();
        var analytics_writer = AnalyticsWriter.init(&buffer_writer);

        const start_time = @import("root").start_time;
        const now = std.time.nanoTimestamp();

        this.header.session_length = @truncate(u32, @intCast(u64, (now - start_time)) / std.time.ns_per_ms);

        var list = Analytics.EventList{
            .header = this.header,
            .event_count = @intCast(u32, this.events.items.len),
        };

        try list.encode(&analytics_writer);

        for (this.events.items) |_event| {
            const event: Event = _event;

            var time_bytes = std.mem.asBytes(&event.timestamp);

            const analytics_event = Analytics.EventHeader{
                .timestamp = Analytics.Uint64{
                    .first = std.mem.readIntNative(u32, time_bytes[0..4]),
                    .second = std.mem.readIntNative(u32, time_bytes[4..8]),
                },
                .kind = event.data.toKind(),
            };

            try analytics_event.encode(&analytics_writer);
        }

        const count = this.events.items.len;

        if (comptime FeatureFlags.verbose_analytics) {
            Output.prettyErrorln("[Analytics] Sending {d} events", .{count});
            Output.flush();
        }

        this.events.clearRetainingCapacity();

        var retry_remaining: usize = 10;
        retry: while (retry_remaining > 0) {
            const response = this.client.send(this.in_buffer.items, &this.out_buffer) catch |err| {
                if (FeatureFlags.verbose_analytics) {
                    Output.prettyErrorln("[Analytics] failed due to error {s} ({d} retries remain)", .{ @errorName(err), retry_remaining });
                }

                retry_remaining -= 1;
                @atomicStore(bool, &is_stuck, true, .Release);
                const min_delay = (11 - retry_remaining) * std.time.ns_per_s / 2;
                Output.flush();
                std.time.sleep(random.random.intRangeAtMost(u64, min_delay, min_delay * 2));
                continue :retry;
            };

            if (response.status_code >= 500 and response.status_code <= 599) {
                if (FeatureFlags.verbose_analytics) {
                    Output.prettyErrorln("[Analytics] failed due to status code {d} ({d} retries remain)", .{ response.status_code, retry_remaining });
                }

                retry_remaining -= 1;
                @atomicStore(bool, &is_stuck, true, .Release);
                const min_delay = (11 - retry_remaining) * std.time.ns_per_s / 2;
                Output.flush();
                std.time.sleep(random.random.intRangeAtMost(u64, min_delay, min_delay * 2));
                continue :retry;
            }

            break :retry;
        }

        @atomicStore(bool, &is_stuck, retry_remaining == 0, .Release);
        stuck_count += @intCast(u8, @boolToInt(retry_remaining == 0));
        stuck_count *= @intCast(u8, @boolToInt(retry_remaining == 0));
        disabled = disabled or stuck_count > 4;

        this.in_buffer.clearRetainingCapacity();
        this.out_buffer.reset();

        if (comptime FeatureFlags.verbose_analytics) {
            Output.prettyErrorln("[Analytics] Sent {d} events", .{count});
            Output.flush();
        }
    }
};

pub var is_ci = false;
