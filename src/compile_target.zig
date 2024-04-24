/// Used for `bun build --compile`
///
/// This downloads and extracts the bun binary for the target platform
/// It uses npm to download the bun binary from the npm registry
/// It stores the downloaded binary into the bun install cache.
///
const bun = @import("root").bun;
const std = @import("std");
const Environment = bun.Environment;
const strings = bun.strings;
const Output = bun.Output;
pub const CompileTarget = struct {
    os: Environment.OperatingSystem = Environment.os,
    arch: Environment.Archictecture = Environment.arch,
    baseline: bool = !Environment.enableSIMD,
    version: bun.Semver.Version = .{
        .major = @truncate(Environment.version.major),
        .minor = @truncate(Environment.version.minor),
        .patch = @truncate(Environment.version.patch),
    },
    libc: Libc = .default,

    const Libc = enum {
        /// The default libc for the target
        /// "glibc" for linux, unspecified for other OSes
        default,
        /// musl libc
        musl,

        pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
            if (self == .musl) {
                try writer.writeAll("-musl");
            }
        }
    };

    const BaselineFormatter = struct {
        baseline: bool = false,
        pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
            if (self.baseline) {
                try writer.writeAll("-baseline");
            }
        }
    };

    pub fn eql(this: *const CompileTarget, other: *const CompileTarget) bool {
        return this.os == other.os and this.arch == other.arch and this.baseline == other.baseline and this.version.eql(other.version) and this.libc == other.libc;
    }

    pub fn isDefault(this: *const CompileTarget) bool {
        return this.eql(&.{});
    }

    pub fn toNPMRegistryURL(this: *const CompileTarget, buf: []u8) ![]const u8 {
        if (bun.getenvZ("BUN_COMPILE_TARGET_TARBALL_URL")) |url| {
            if (strings.hasPrefixComptime(url, "http://") or strings.hasPrefixComptime(url, "https://"))
                return url;
        }

        return this.toNPMRegistryURLWithURL(buf, "https://registry.npmjs.org") catch unreachable;
    }

    pub fn toNPMRegistryURLWithURL(this: *const CompileTarget, buf: []u8, registry_url: []const u8) ![]const u8 {
        return switch (this.os) {
            inline else => |os| switch (this.arch) {
                inline else => |arch| switch (this.baseline) {
                    // https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-0.1.6.tgz
                    inline else => |is_baseline| try std.fmt.bufPrint(buf, comptime "{s}/@oven/bun-" ++
                        os.npmName() ++ "-" ++ arch.npmName() ++
                        (if (is_baseline) "-baseline" else "") ++
                        "/-/bun-" ++
                        os.npmName() ++ "-" ++ arch.npmName() ++
                        (if (is_baseline) "-baseline" else "") ++
                        "-" ++
                        "{d}.{d}.{d}.tgz", .{
                        registry_url,
                        this.version.major,
                        this.version.minor,
                        this.version.patch,
                    }),
                },
            },
        };
    }

    pub fn format(this: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        try std.fmt.format(
            writer,
            // bun-darwin-x64-baseline-v1.0.0
            // This doesn't match up 100% with npm, but that's okay.
            "bun-{s}-{s}{}{}-v{d}.{d}.{d}",
            .{
                this.os.npmName(),
                this.arch.npmName(),
                this.libc,
                BaselineFormatter{ .baseline = this.baseline },
                this.version.major,
                this.version.minor,
                this.version.patch,
            },
        );
    }

    pub fn displayName(this: *const CompileTarget, version_buf: []u8) [:0]const u8 {
        return std.fmt.bufPrintZ(version_buf, "{}", .{this.*}) catch unreachable;
    }

    pub fn exePath(this: *const CompileTarget, buf: *bun.PathBuffer, version_str: [:0]const u8, env: *bun.DotEnv.Loader, needs_download: *bool) [:0]const u8 {
        if (this.isDefault()) brk: {
            const self_exe_path = bun.selfExePath() catch break :brk;
            @memcpy(buf, self_exe_path);
            buf[self_exe_path.len] = 0;
            needs_download.* = false;
            return buf[0..self_exe_path.len :0];
        }

        if (bun.sys.existsAt(bun.toFD(std.fs.cwd()), version_str)) {
            needs_download.* = false;
            return version_str;
        }

        const dest = bun.path.joinAbsStringBufZ(
            bun.fs.FileSystem.instance.top_level_dir,
            buf,
            &.{
                bun.install.PackageManager.fetchCacheDirectoryPath(env).path,
                version_str,
            },
            .auto,
        );

        if (bun.sys.existsAt(bun.toFD(std.fs.cwd()), dest)) {
            needs_download.* = false;
        }

        return dest;
    }

    const HTTP = bun.http;
    const MutableString = bun.MutableString;
    const Global = bun.Global;
    pub fn downloadToPath(this: *const CompileTarget, env: *bun.DotEnv.Loader, allocator: std.mem.Allocator, dest_z: [:0]const u8) !void {
        try HTTP.HTTPThread.init();
        var refresher = std.Progress{};

        {
            refresher.refresh();

            // TODO: This is way too much code necessary to send a single HTTP request...
            var async_http = try allocator.create(HTTP.AsyncHTTP);
            var compressed_archive_bytes = try allocator.create(MutableString);
            compressed_archive_bytes.* = try MutableString.init(allocator, 24 * 1024 * 1024);
            var url_buffer: [2048]u8 = undefined;
            const url_str = try bun.default_allocator.dupe(u8, try this.toNPMRegistryURL(&url_buffer));
            const url = bun.URL.parse(url_str);
            {
                var progress = refresher.start("Downloading", 0);
                defer progress.end();
                const timeout = 30000;
                const http_proxy: ?bun.URL = env.getHttpProxy(url);

                async_http.* = HTTP.AsyncHTTP.initSync(
                    allocator,
                    .GET,
                    url,
                    .{},
                    "",
                    compressed_archive_bytes,
                    "",
                    timeout,
                    http_proxy,
                    null,
                    HTTP.FetchRedirect.follow,
                );
                async_http.client.timeout = timeout;
                async_http.client.progress_node = progress;
                async_http.client.reject_unauthorized = env.getTLSRejectUnauthorized();

                const response = try async_http.sendSync(true);

                switch (response.status_code) {
                    404 => {
                        Output.prettyErrorln(
                            \\<r><red>error:<r> 404 downloading {s} from {s}
                        , .{
                            this.displayName(&url_buffer),
                            url_str,
                        });
                        Global.exit(1);
                    },
                    403 => return error.HTTPForbidden,
                    429 => return error.HTTPTooManyRequests,
                    499...599 => return error.NpmIsDown,
                    200 => {},
                    else => return error.HTTPError,
                }
            }

            var tarball_bytes = std.ArrayListUnmanaged(u8){};
            {
                refresher.refresh();
                defer compressed_archive_bytes.list.deinit(allocator);

                if (compressed_archive_bytes.list.items.len == 0) {
                    Output.prettyErrorln(
                        \\<r><red>error:<r> Received empty content downloading {s} from {s}
                    , .{
                        this.displayName(&url_buffer),
                        url_str,
                    });
                    Global.exit(1);
                }

                {
                    var node = refresher.start("Decompressing", 0);
                    defer node.end();
                    var gunzip = try bun.zlib.ZlibReaderArrayList.init(compressed_archive_bytes.list.items, &tarball_bytes, allocator);
                    try gunzip.readAll();
                    gunzip.deinit();
                }
                refresher.refresh();

                {
                    var node = refresher.start("Extracting", 0);
                    defer node.end();

                    const libarchive = @import("./libarchive//libarchive.zig");
                    var tmpname_buf: [1024]u8 = undefined;
                    const tempdir_name = bun.span(try bun.fs.FileSystem.instance.tmpname("tmp", &tmpname_buf, bun.fastRandom()));
                    var tmpdir = try std.fs.cwd().makeOpenPath(tempdir_name, .{});
                    defer tmpdir.close();
                    defer std.fs.cwd().deleteTree(tempdir_name) catch {};
                    _ = try libarchive.Archive.extractToDir(
                        compressed_archive_bytes.list.items,
                        tmpdir,
                        null,
                        void,
                        {},
                        // "package/bin"
                        2,
                        true,
                        false,
                    );

                    var did_retry = false;
                    while (true) {
                        bun.C.moveFileZ(bun.toFD(tmpdir), if (this.os == .windows) "bun.exe" else "bun", bun.invalid_fd, dest_z) catch |err| {
                            if (!did_retry) {
                                did_retry = true;
                                const dirname = bun.path.dirname(dest_z, .loose);
                                if (dirname.len > 0) {
                                    std.fs.cwd().makePath(dirname) catch {};
                                }
                                continue;
                            }
                            return err;
                        };
                        break;
                    }
                }
                refresher.refresh();
            }
        }
    }

    pub fn isSupported(this: *const CompileTarget) bool {
        return switch (this.os) {
            .windows => this.arch == .x64,
            .mac => true,
            .linux => this.libc == .default,
            .wasm => false,
        };
    }

    pub fn from(input_: []const u8) CompileTarget {
        var this = CompileTarget{};

        const input = bun.strings.trim(input_, " \t\r");
        if (input.len == 0) {
            return this;
        }

        var found_os = false;
        var found_arch = false;
        var found_baseline = false;
        var found_version = false;
        var found_libc = false;

        // Parse each of the supported values.
        // The user shouldn't have to care about the order of the values. As long as it starts with "bun-".
        // Nobody wants to remember whether its "bun-linux-x64" or "bun-x64-linux".
        var splitter = bun.strings.split(input, "-");
        while ((!found_arch or !found_os or !found_baseline or !found_version or !found_libc) and input.len > 0) {
            const token = splitter.next() orelse break;
            if (token.len == 0) continue;

            if (!found_arch) {
                if (Environment.Archictecture.names.get(token)) |arch| {
                    this.arch = arch;
                    found_arch = true;
                    continue;
                }
            }

            if (!found_os) {
                if (Environment.OperatingSystem.names.get(token)) |os| {
                    this.os = os;
                    found_os = true;
                    continue;
                }
            }

            if (!found_baseline) {
                // i don't know what else to call this
                if (strings.eqlComptime(token, "modern")) {
                    this.baseline = false;
                    found_baseline = true;
                    continue;
                } else if (strings.eqlComptime(token, "baseline")) {
                    this.baseline = true;
                    found_baseline = true;
                    continue;
                }
            }

            if (!found_version) {
                if (strings.hasPrefixComptime(token, "v1.") or strings.hasPrefixComptime(token, "v0.")) {
                    const version = bun.Semver.Version.parse(bun.Semver.SlicedString.init(token[1..], token[1..]));
                    if (version.valid) {
                        this.version = .{
                            .major = version.version.major.?,
                            .minor = version.version.minor.?,
                            .patch = version.version.patch.?,
                        };
                        found_version = true;
                        continue;
                    }
                }
            }

            if (!found_libc) {
                if (strings.eqlComptime(token, "musl")) {
                    this.libc = .musl;
                    found_libc = true;
                    continue;
                }
            }
        }

        // default to x64 if no arch is specified but OS is specified
        // On macOS arm64, it's kind of surprising to choose Linux arm64 or Windows arm64
        if (!found_arch and found_os) {
            this.arch = .x64;
            found_arch = true;
        }

        // there is no baseline arm64.
        if (this.baseline and this.arch == .arm64) {
            this.baseline = false;
        }

        if (this.libc == .musl and this.os != .linux) {
            Output.errGeneric("invalid target, musl libc only exists on linux", .{});
            Global.exit(1);
        }

        if (this.arch == .wasm or this.os == .wasm) {
            Output.errGeneric("invalid target, WebAssembly is not supported. Sorry!", .{});
            Global.exit(1);
        }

        return this;
    }

    pub fn defineValues(this: *const CompileTarget) []const []const u8 {
        // Use inline else to avoid extra allocations.
        switch (this.os) {
            inline else => |os| switch (this.arch) {
                inline .arm64, .x64 => |arch| return struct {
                    pub const values = &.{
                        "\"" ++ os.nameString() ++ "\"",

                        switch (arch) {
                            .x64 => "\"x64\"",
                            .arm64 => "\"arm64\"",
                            else => @compileError("TODO"),
                        },
                    };
                }.values,
                else => @panic("TODO"),
            },
        }
    }
};
