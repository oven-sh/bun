const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;
const C = bun.C;

const sync = @import("../sync.zig");
const std = @import("std");
const HTTP = @import("root").bun.http;

const URL = @import("../url.zig").URL;
const Fs = @import("../fs.zig");
const Analytics = @import("./analytics_schema.zig").analytics;
const Writer = @import("./analytics_schema.zig").Writer;
const Headers = @import("root").bun.http.Headers;
const Futex = @import("../futex.zig");
const Semver = @import("../install/semver.zig");

fn NewUint64(val: u64) Analytics.Uint64 {
    const bytes = std.mem.asBytes(&val);
    return .{
        .first = std.mem.readInt(u32, bytes[0..4], .little),
        .second = std.mem.readInt(u32, bytes[4..], .little),
    };
}

// This answers, "What parts of bun are people actually using?"
pub const Features = struct {
    pub var tsconfig_paths: usize = 0;
    pub var fast_refresh: usize = 0;
    pub var hot_module_reloading: usize = 0;
    pub var jsx: usize = 0;
    pub var always_bundle: usize = 0;
    pub var tsconfig: usize = 0;
    pub var bun_bun: usize = 0;
    pub var filesystem_router: usize = 0;
    pub var framework: usize = 0;
    pub var bunjs: usize = 0;
    pub var macros: usize = 0;
    pub var dotenv: usize = 0;
    pub var define: usize = 0;
    pub var loaders: usize = 0;
    pub var origin: usize = 0;
    pub var external: usize = 0;
    pub var fetch: usize = 0;
    pub var bunfig: usize = 0;
    pub var spawn: usize = 0;
    pub var extracted_packages: usize = 0;
    pub var transpiler_cache: usize = 0;
    pub var shell: usize = 0;
    pub var standalone_shell: usize = 0;
    pub var lifecycle_scripts: usize = 0;
    pub var virtual_modules: usize = 0;
    pub var html_rewriter: usize = 0;
    pub var http_server: usize = 0;
    pub var https_server: usize = 0;
    pub var abort_signal: usize = 0;
    pub var lockfile_migration_from_package_lock: usize = 0;
    pub var git_dependencies: usize = 0;
    pub var WebSocket: usize = 0;
    pub var @"Bun.stdin": usize = 0;
    pub var @"Bun.stdout": usize = 0;
    pub var @"Bun.stderr": usize = 0;
    pub var builtin_modules = std.enums.EnumSet(bun.JSC.HardcodedModule).initEmpty();

    pub fn formatter() Formatter {
        return Formatter{};
    }
    pub const Formatter = struct {
        pub fn format(_: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const fields = comptime brk: {
                const info: std.builtin.Type = @typeInfo(Features);
                var buffer: [info.Struct.decls.len][]const u8 = .{""} ** info.Struct.decls.len;
                var count: usize = 0;
                for (info.Struct.decls) |decl| {
                    var f = &@field(Features, decl.name);
                    _ = &f;
                    const Field = @TypeOf(f);
                    const FieldT: std.builtin.Type = @typeInfo(Field);
                    if (FieldT.Pointer.child != usize) continue;
                    buffer[count] = decl.name;
                    count += 1;
                }

                break :brk buffer[0..count];
            };

            inline for (fields) |field| {
                const count = @field(Features, field);
                if (count > 0) {
                    try writer.writeAll(field);
                    if (count > 1) {
                        try writer.print("({d}) ", .{count});
                    } else {
                        try writer.writeAll(" ");
                    }
                }
            }

            var builtins = builtin_modules.iterator();
            if (builtins.next()) |first| {
                try writer.writeAll("\nBuiltins: \"");
                try writer.writeAll(@tagName(first));
                try writer.writeAll("\" ");

                while (builtins.next()) |key| {
                    try writer.writeAll("\"");
                    try writer.writeAll(@tagName(key));
                    try writer.writeAll("\" ");
                }

                try writer.writeAll("\n");
            } else {
                try writer.writeAll("\n");
            }
        }
    };
};

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
var project_id: Analytics.Uint64 = .{};

pub const Event = struct {
    timestamp: u64,
    data: Data,

    pub fn init(comptime name: EventName) Event {
        const millis = std.time.milliTimestamp();

        const timestamp = if (millis < 0) 0 else @as(u64, @intCast(millis));

        return Event{ .timestamp = timestamp, .data = @unionInit(Data, @tagName(name), {}) };
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
        if (comptime Environment.isDebug) {
            if (project_id.first == 0 and project_id.second == 0) {
                Output.prettyErrorln("warn: project_id is 0", .{});
            }
        }

        if (Environment.isMac) {
            return Analytics.EventListHeader{
                .machine_id = GenerateMachineID.forMac() catch Analytics.Uint64{},
                .platform = GeneratePlatform.forMac(),
                .build_id = comptime @as(u32, @truncate(Global.build_id)),
                .session_id = random.random().int(u32),
                .project_id = project_id,
            };
        }

        if (Environment.isLinux) {
            return Analytics.EventListHeader{
                .machine_id = GenerateMachineID.forLinux() catch Analytics.Uint64{},
                .platform = GeneratePlatform.forLinux(),
                .build_id = comptime @as(u32, @truncate(Global.build_id)),
                .session_id = random.random().int(u32),
                .project_id = project_id,
            };
        }

        unreachable;
    }

    pub const GeneratePlatform = struct {
        var osversion_name: [32]u8 = undefined;
        pub fn forMac() Analytics.Platform {
            @memset(&osversion_name, 0);

            var platform = Analytics.Platform{ .os = Analytics.OperatingSystem.macos, .version = &[_]u8{}, .arch = platform_arch };
            var len = osversion_name.len - 1;
            if (std.c.sysctlbyname("kern.osrelease", &osversion_name, &len, null, 0) == -1) return platform;

            platform.version = bun.sliceTo(&osversion_name, 0);
            return platform;
        }

        pub var linux_os_name: std.c.utsname = undefined;
        var platform_: ?Analytics.Platform = null;
        pub const Platform = Analytics.Platform;

        var linux_kernel_version: Semver.Version = undefined;

        pub fn forOS() Analytics.Platform {
            if (platform_ != null) return platform_.?;

            if (comptime Environment.isMac) {
                platform_ = forMac();
                return platform_.?;
            } else if (comptime Environment.isPosix) {
                platform_ = forLinux();

                const release = bun.sliceTo(&linux_os_name.release, 0);
                const sliced_string = Semver.SlicedString.init(release, release);
                const result = Semver.Version.parse(sliced_string);
                linux_kernel_version = result.version.min();
            } else {
                platform_ = Platform{
                    .os = Analytics.OperatingSystem.windows,
                    .version = &[_]u8{},
                    .arch = platform_arch,
                };
            }

            return platform_.?;
        }

        pub fn kernelVersion() Semver.Version {
            if (comptime !Environment.isLinux) {
                @compileError("This function is only implemented on Linux");
            }
            _ = forOS();

            // we only care about major, minor, patch so we don't care about the string
            return linux_kernel_version;
        }

        pub fn forLinux() Analytics.Platform {
            linux_os_name = std.mem.zeroes(@TypeOf(linux_os_name));

            _ = std.c.uname(&linux_os_name);

            const release = bun.sliceTo(&linux_os_name.release, 0);
            const version = std.mem.sliceTo(&linux_os_name.version, @as(u8, 0));
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

            const result = try std.ChildProcess.run(.{
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

            const hash = bun.hash(std.mem.trim(u8, out, "\n\r "));
            var hash_bytes = std.mem.asBytes(&hash);
            return Analytics.Uint64{
                .first = std.mem.readInt(u32, hash_bytes[0..4], .little),
                .second = std.mem.readInt(u32, hash_bytes[4..8], .little),
            };
        }

        pub var linux_machine_id: [256]u8 = undefined;

        pub fn forLinux() !Analytics.Uint64 {
            var file = std.fs.openFileAbsoluteZ("/var/lib/dbus/machine-id", .{ .mode = .read_only }) catch brk: {
                break :brk try std.fs.openFileAbsoluteZ("/etc/machine-id", .{ .mode = .read_only });
            };
            defer file.close();
            const read_count = try file.read(&linux_machine_id);

            const hash = bun.hash(std.mem.trim(u8, linux_machine_id[0..read_count], "\n\r "));
            var hash_bytes = std.mem.asBytes(&hash);
            return Analytics.Uint64{
                .first = std.mem.readInt(u32, hash_bytes[0..4], .little),
                .second = std.mem.readInt(u32, hash_bytes[4..8], .little),
            };
        }
    };
};

pub var has_loaded = false;
pub var disabled = false;
pub fn enqueue(comptime _: EventName) void {}

pub var thread: std.Thread = undefined;
var counter: std.atomic.Value(u32) = undefined;

fn start() bool {}

fn spawn() !void {}

const headers_buf: string = "Content-Type binary/peechy";
const header_entry = Headers.Kv{
    .name = .{ .offset = 0, .length = @as(u32, @intCast("Content-Type".len)) },
    .value = .{
        .offset = std.mem.indexOf(u8, headers_buf, "binary/peechy").?,
        .length = @as(u32, @intCast("binary/peechy".len)),
    },
};

var out_buffer: MutableString = undefined;
var event_list: EventList = undefined;
fn readloop() anyerror!void {
    defer disabled = true;
    Output.Source.configureNamedThread("Analytics");
    defer Output.flush();

    event_list = EventList.init();

    var headers_entries: Headers.Entries = Headers.Entries{};
    headers_entries.append(default_allocator, header_entry) catch unreachable;
    out_buffer = try MutableString.init(default_allocator, 64);
    event_list.async_http = HTTP.AsyncHTTP.init(
        default_allocator,
        .POST,
        URL.parse(Environment.analytics_url),
        headers_entries,
        headers_buf,
        &out_buffer,
        "",
        std.time.ns_per_ms * 10000,
    ) catch return;

    event_list.async_http.client.verbose = FeatureFlags.verbose_analytics;
    // everybody's random should be random
    while (true) {
        // Wait for the next event by blocking
        while (event_queue.tryReadItem() catch null) |item| {
            event_list.push(item);
        }

        if (event_list.events.items.len > 0) {
            event_list.flush();
        }

        Futex.wait(&counter, counter.load(.acquire), null) catch unreachable;
    }
}

pub const EventList = struct {
    header: Analytics.EventListHeader,
    events: std.ArrayList(Event),
    async_http: HTTP.AsyncHTTP,

    in_buffer: MutableString,

    pub fn init() EventList {
        random = std.rand.DefaultPrng.init(@as(u64, @intCast(std.time.milliTimestamp())));
        return EventList{
            .header = GenerateHeader.generate(),
            .events = std.ArrayList(Event).init(default_allocator),
            .in_buffer = MutableString.init(default_allocator, 1024) catch unreachable,
            .async_http = undefined,
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
        this.in_buffer.reset();

        const AnalyticsWriter = Writer(*MutableString.Writer);

        var in_buffer = &this.in_buffer;
        var buffer_writer = in_buffer.writer();
        var analytics_writer = AnalyticsWriter.init(&buffer_writer);
        const Root = @import("root").bun;
        const start_time: i128 = if (@hasDecl(Root, "start_time"))
            Root.start_time
        else
            0;
        const now = std.time.nanoTimestamp();

        this.header.session_length = @as(u32, @truncate(@as(u64, @intCast((now - start_time))) / std.time.ns_per_ms));
        this.header.feature_usage = Features.toInt();

        var list = Analytics.EventList{
            .header = this.header,
            .event_count = @as(u32, @intCast(this.events.items.len)),
        };

        try list.encode(&analytics_writer);

        for (this.events.items) |_event| {
            const event: Event = _event;

            var time_bytes = std.mem.asBytes(&event.timestamp);

            const analytics_event = Analytics.EventHeader{
                .timestamp = Analytics.Uint64{
                    .first = std.mem.readInt(u32, time_bytes[0..4], .little),
                    .second = std.mem.readInt(u32, time_bytes[4..8], .little),
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
        const rand = random.random();
        retry: while (retry_remaining > 0) {
            const response = this.async_http.sendSync(true) catch |err| {
                if (FeatureFlags.verbose_analytics) {
                    Output.prettyErrorln("[Analytics] failed due to error {s} ({d} retries remain)", .{ @errorName(err), retry_remaining });
                }

                retry_remaining -= 1;
                @atomicStore(bool, &is_stuck, true, .release);
                const min_delay = (11 - retry_remaining) * std.time.ns_per_s / 2;
                Output.flush();
                std.time.sleep(rand.intRangeAtMost(u64, min_delay, min_delay * 2));
                continue :retry;
            };

            if (response.status_code >= 500 and response.status_code <= 599) {
                if (FeatureFlags.verbose_analytics) {
                    Output.prettyErrorln("[Analytics] failed due to status code {d} ({d} retries remain)", .{ response.status_code, retry_remaining });
                }

                retry_remaining -= 1;
                @atomicStore(bool, &is_stuck, true, .release);
                const min_delay = (11 - retry_remaining) * std.time.ns_per_s / 2;
                Output.flush();
                std.time.sleep(rand.intRangeAtMost(u64, min_delay, min_delay * 2));
                continue :retry;
            }

            break :retry;
        }

        @atomicStore(bool, &is_stuck, retry_remaining == 0, .release);
        stuck_count += @as(u8, @intCast(@intFromBool(retry_remaining == 0)));
        stuck_count *= @as(u8, @intCast(@intFromBool(retry_remaining == 0)));
        disabled = disabled or stuck_count > 4;

        this.in_buffer.reset();
        out_buffer.reset();

        if (comptime FeatureFlags.verbose_analytics) {
            Output.prettyErrorln("[Analytics] Sent {d} events", .{count});
            Output.flush();
        }
    }
};

pub var is_ci = false;

pub var username_only_for_determining_project_id_and_never_sent: string = "";
pub fn setProjectID(folder_name_: string, package_name: string) void {
    if (disabled) return;

    var hasher = std.hash.Wyhash.init(10);

    var folder_name = folder_name_;

    // The idea here is
    // When you're working at a mid-large company
    // Basically everyone has standardized laptops
    // The hardware may differ, but the folder structure is typically identical
    // But the username or home folder may differ
    // So when we hash, we skip that if it exists
    if (username_only_for_determining_project_id_and_never_sent.len > 0) {
        if (std.mem.indexOf(u8, folder_name, username_only_for_determining_project_id_and_never_sent)) |i| {
            const offset = i + username_only_for_determining_project_id_and_never_sent.len + 1;
            if (folder_name.len > offset) {
                folder_name = folder_name[offset..];
            }
        }
    }
    hasher.update(folder_name);
    hasher.update("@");
    if (package_name.len > 0) hasher.update(package_name);
    if (package_name.len == 0) hasher.update("\"\"");
    project_id = NewUint64(hasher.final());
}
