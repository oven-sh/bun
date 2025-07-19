const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const logger = bun.logger;
const File = bun.sys.File;

const Install = @import("./install.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const Npm = @import("./npm.zig");
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;

const Semver = @import("../semver.zig");
const String = Semver.String;
const ExternalString = Semver.ExternalString;
const stringHash = String.Builder.stringHash;

const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;

const JSAst = bun.JSAst;
const Expr = JSAst.Expr;
const B = JSAst.B;
const E = JSAst.E;
const G = JSAst.G;
const S = JSAst.S;

const debug = Output.scoped(.migrate, false);

pub const YarnLock = struct {
    // Represents a single entry in the yarn.lock file
    const Entry = struct {
        // The package specs that resolve to this entry (e.g. ["foo@^1.0.0", "foo@^1.2.3"])
        specs: []const []const u8,
        // The resolved version
        version: string,
        // The resolved URL
        resolved: ?string = null,
        // The integrity hash
        integrity: ?string = null,
        // Dependencies of this package
        dependencies: ?std.StringHashMap(string) = null,
        // Optional dependencies
        optionalDependencies: ?std.StringHashMap(string) = null,
        // Peer dependencies
        peerDependencies: ?std.StringHashMap(string) = null,
        // Dev dependencies
        devDependencies: ?std.StringHashMap(string) = null,
        // For git dependencies
        commit: ?string = null,
        // For workspace dependencies
        workspace: bool = false,
        // For file dependencies
        file: ?string = null,
        // Platform-specific fields
        os: ?[]const []const u8 = null,
        cpu: ?[]const []const u8 = null,

        pub fn deinit(self: *Entry, allocator: Allocator) void {
            allocator.free(self.specs);
            if (self.dependencies) |*deps| {
                deps.deinit();
            }
            if (self.optionalDependencies) |*deps| {
                deps.deinit();
            }
            if (self.peerDependencies) |*deps| {
                deps.deinit();
            }
            if (self.devDependencies) |*deps| {
                deps.deinit();
            }
            if (self.os) |os_list| {
                allocator.free(os_list);
            }
            if (self.cpu) |cpu_list| {
                allocator.free(cpu_list);
            }
        }

        pub fn getNameFromSpec(spec: []const u8) []const u8 {
            // First unquote if needed
            const unquoted = if (spec[0] == '"' and spec[spec.len - 1] == '"')
                spec[1 .. spec.len - 1]
            else
                spec;

            if (std.mem.indexOf(u8, unquoted, "@")) |idx| {
                if (idx == 0) {
                    if (std.mem.indexOf(u8, unquoted[1..], "@")) |second_idx| {
                        // Handle scoped packages, e.g. "@scope/pkg@1.0.0"
                        return unquoted[0 .. second_idx + 1];
                    }
                }
                return unquoted[0..idx];
            }
            return unquoted;
        }

        pub fn getVersionFromSpec(spec: []const u8) ?[]const u8 {
            // First unquote if needed
            const unquoted = if (spec[0] == '"' and spec[spec.len - 1] == '"')
                spec[1 .. spec.len - 1]
            else
                spec;

            if (std.mem.indexOf(u8, unquoted, "@")) |idx| {
                if (idx == 0) {
                    // Handle scoped packages
                    if (std.mem.indexOf(u8, unquoted[1..], "@")) |second_idx| {
                        return unquoted[second_idx + 2 ..];
                    }
                    return null;
                }
                if (idx + 1 < unquoted.len) {
                    return unquoted[idx + 1 ..];
                }
            }
            return null;
        }

        pub fn isGitDependency(version: []const u8) bool {
            return strings.startsWith(version, "git+") or
                strings.startsWith(version, "git://") or
                strings.startsWith(version, "github:") or
                strings.startsWith(version, "https://github.com/");
        }

        pub fn isWorkspaceDependency(version: []const u8) bool {
            return strings.startsWith(version, "workspace:") or
                strings.eql(version, "*");
        }

        pub fn isFileDependency(version: []const u8) bool {
            return strings.startsWith(version, "file:") or
                strings.startsWith(version, "./") or
                strings.startsWith(version, "../");
        }

        pub fn parseGitUrl(self: *const YarnLock, version: []const u8) !struct { url: []const u8, commit: ?[]const u8 } {
            var url = version;
            var commit: ?[]const u8 = null;

            if (strings.startsWith(url, "git+")) {
                url = url[4..];
            }

            if (strings.startsWith(url, "github:")) {
                // Convert github:user/repo to full URL
                url = try std.fmt.allocPrint(
                    self.allocator,
                    "https://github.com/{s}",
                    .{url[7..]},
                );
            }

            if (std.mem.indexOf(u8, url, "#")) |hash_idx| {
                commit = url[hash_idx + 1 ..];
                url = url[0..hash_idx];
            }

            return .{ .url = url, .commit = commit };
        }
    };

    entries: std.ArrayList(Entry),
    allocator: Allocator,

    pub fn init(allocator: Allocator) YarnLock {
        return .{
            .entries = std.ArrayList(Entry).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *YarnLock) void {
        for (self.entries.items) |*entry| {
            entry.deinit(self.allocator);
        }
        self.entries.deinit();
    }

    // Parse a yarn.lock file content
    pub fn parse(self: *YarnLock, content: []const u8) !void {
        var lines = std.mem.splitSequence(u8, content, "\n");
        var current_entry: ?Entry = null;
        var current_specs = std.ArrayList([]const u8).init(self.allocator);
        defer current_specs.deinit();

        var current_deps: ?std.StringHashMap(string) = null;
        var current_optional_deps: ?std.StringHashMap(string) = null;
        var current_peer_deps: ?std.StringHashMap(string) = null;
        var current_dev_deps: ?std.StringHashMap(string) = null;
        var in_dependencies = false;
        var in_optional_dependencies = false;
        var in_peer_dependencies = false;
        var in_dev_dependencies = false;

        while (lines.next()) |line_| {
            const line = std.mem.trimRight(u8, line_, " \r\t");
            if (line.len == 0 or line[0] == '#') continue;

            // Count leading spaces for indentation level
            var indent: usize = 0;
            while (indent < line.len and line[indent] == ' ') indent += 1;

            const trimmed = std.mem.trim(u8, line[indent..], " \r\t");
            if (trimmed.len == 0) continue;

            // New entry starts with no indentation and ends with a colon
            if (indent == 0 and std.mem.endsWith(u8, trimmed, ":")) {
                // Save previous entry if it exists
                if (current_entry) |*entry| {
                    entry.dependencies = current_deps;
                    entry.optionalDependencies = current_optional_deps;
                    entry.peerDependencies = current_peer_deps;
                    entry.devDependencies = current_dev_deps;
                    try self.entries.append(entry.*);
                }

                // Parse specs
                current_specs.clearRetainingCapacity();
                const specs_str = trimmed[0 .. trimmed.len - 1]; // Remove trailing colon
                var specs_it = std.mem.splitSequence(u8, specs_str, ",");
                while (specs_it.next()) |spec| {
                    const spec_trimmed = std.mem.trim(u8, spec, " \"");
                    try current_specs.append(try self.allocator.dupe(u8, spec_trimmed));
                }

                current_entry = Entry{
                    .specs = try self.allocator.dupe([]const u8, current_specs.items),
                    .version = undefined,
                };

                current_deps = null;
                current_optional_deps = null;
                current_peer_deps = null;
                current_dev_deps = null;
                in_dependencies = false;
                in_optional_dependencies = false;
                in_peer_dependencies = false;
                in_dev_dependencies = false;
                continue;
            }

            // If we're not in an entry, skip
            if (current_entry == null) continue;

            // Handle indented lines (key-value pairs or dependency sections)
            if (indent > 0) {
                // Check for dependency sections first
                if (std.mem.eql(u8, trimmed, "dependencies")) {
                    in_dependencies = true;
                    in_optional_dependencies = false;
                    in_peer_dependencies = false;
                    in_dev_dependencies = false;
                    current_deps = std.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (std.mem.eql(u8, trimmed, "optionalDependencies")) {
                    in_optional_dependencies = true;
                    in_dependencies = false;
                    in_peer_dependencies = false;
                    in_dev_dependencies = false;
                    current_optional_deps = std.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (std.mem.eql(u8, trimmed, "peerDependencies")) {
                    in_peer_dependencies = true;
                    in_dependencies = false;
                    in_optional_dependencies = false;
                    in_dev_dependencies = false;
                    current_peer_deps = std.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (std.mem.eql(u8, trimmed, "devDependencies")) {
                    in_dev_dependencies = true;
                    in_dependencies = false;
                    in_optional_dependencies = false;
                    in_peer_dependencies = false;
                    current_dev_deps = std.StringHashMap(string).init(self.allocator);
                    continue;
                }

                // Handle dependencies
                if (in_dependencies or in_optional_dependencies or in_peer_dependencies or in_dev_dependencies) {
                    if (std.mem.indexOf(u8, trimmed, " ")) |space_idx| {
                        const key = std.mem.trim(u8, trimmed[0..space_idx], " \"");
                        const value = std.mem.trim(u8, trimmed[space_idx + 1 ..], " \"");
                        const map = if (in_dependencies) &current_deps.? else if (in_optional_dependencies) &current_optional_deps.? else if (in_peer_dependencies) &current_peer_deps.? else &current_dev_deps.?;
                        try map.put(key, value);
                    }
                    continue;
                }

                // Handle regular key-value pairs
                if (std.mem.indexOf(u8, trimmed, " ")) |space_idx| {
                    const key = std.mem.trim(u8, trimmed[0..space_idx], " ");
                    const value = std.mem.trim(u8, trimmed[space_idx + 1 ..], " \"");

                    if (std.mem.eql(u8, key, "version")) {
                        current_entry.?.version = value;
                        // Check for special version types
                        if (Entry.isWorkspaceDependency(value)) {
                            current_entry.?.workspace = true;
                        } else if (Entry.isFileDependency(value)) {
                            current_entry.?.file = value[5..];
                        } else if (Entry.isGitDependency(value)) {
                            const git_info = try Entry.parseGitUrl(self, value);
                            current_entry.?.resolved = git_info.url;
                            current_entry.?.commit = git_info.commit;
                        }
                    } else if (std.mem.eql(u8, key, "resolved")) {
                        current_entry.?.resolved = value;
                    } else if (std.mem.eql(u8, key, "integrity")) {
                        current_entry.?.integrity = value;
                    } else if (std.mem.eql(u8, key, "os")) {
                        // Parse os array
                        var os_list = std.ArrayList([]const u8).init(self.allocator);
                        var os_it = std.mem.splitSequence(u8, value[1 .. value.len - 1], ",");
                        while (os_it.next()) |os| {
                            const trimmed_os = std.mem.trim(u8, os, " \"");
                            try os_list.append(trimmed_os);
                        }
                        current_entry.?.os = try os_list.toOwnedSlice();
                    } else if (std.mem.eql(u8, key, "cpu")) {
                        // Parse cpu array
                        var cpu_list = std.ArrayList([]const u8).init(self.allocator);
                        var cpu_it = std.mem.splitSequence(u8, value[1 .. value.len - 1], ",");
                        while (cpu_it.next()) |cpu| {
                            const trimmed_cpu = std.mem.trim(u8, cpu, " \"");
                            try cpu_list.append(trimmed_cpu);
                        }
                        current_entry.?.cpu = try cpu_list.toOwnedSlice();
                    }
                }
            }
        }

        // Don't forget the last entry
        if (current_entry) |*entry| {
            entry.dependencies = current_deps;
            entry.optionalDependencies = current_optional_deps;
            entry.peerDependencies = current_peer_deps;
            entry.devDependencies = current_dev_deps;
            try self.entries.append(entry.*);
        }
    }

    fn findEntryBySpec(self: *YarnLock, spec: []const u8) ?*Entry {
        for (self.entries.items) |*entry| {
            for (entry.specs) |entry_spec| {
                if (std.mem.eql(u8, entry_spec, spec)) {
                    return entry;
                }
            }
        }
        return null;
    }
};

// Helper to process dependencies from a map
const processDeps = struct {
    fn process(
        deps: std.StringHashMap(string),
        is_optional: bool,
        is_peer: bool,
        is_dev: bool,
        yarn_lock_: *YarnLock,
        string_buf_: *Semver.String.Buf,
        deps_buf: []Dependency,
        res_buf: []Install.PackageID,
        log: *logger.Log,
        manager: *Install.PackageManager,
    ) ![]Install.PackageID {
        var deps_it = deps.iterator();
        var count: usize = 0;
        var dep_spec_name_stack = std.heap.stackFallback(1024, bun.default_allocator);
        const temp_allocator = dep_spec_name_stack.get();

        while (deps_it.next()) |dep| {
            const dep_name = dep.key_ptr.*;
            const dep_version = dep.value_ptr.*;
            const dep_spec = try std.fmt.allocPrint(
                temp_allocator,
                "{s}@{s}",
                .{ dep_name, dep_version },
            );
            defer temp_allocator.free(dep_spec);

            if (yarn_lock_.findEntryBySpec(dep_spec)) |dep_entry| {
                const dep_name_hash = stringHash(dep_name);
                const dep_name_str = try string_buf_.appendWithHash(dep_name, dep_name_hash);

                // Create dependency
                deps_buf[count] = Dependency{
                    .name = dep_name_str,
                    .name_hash = dep_name_hash,
                    .version = Dependency.parse(
                        yarn_lock_.allocator,
                        dep_name_str,
                        dep_name_hash,
                        dep_version,
                        &Semver.SlicedString.init(dep_version, dep_version),
                        log, // log
                        manager, // manager
                    ) orelse Dependency.Version{},
                    .behavior = .{
                        .prod = !is_dev,
                        .optional = is_optional,
                        .dev = is_dev,
                        .peer = is_peer,
                        .workspace = dep_entry.workspace,
                    },
                };

                // Find package ID for this dependency
                for (yarn_lock_.entries.items, 0..) |entry_, i| {
                    if (std.mem.eql(u8, entry_.specs[0], dep_spec)) {
                        res_buf[count] = @intCast(i + 1); // +1 because root package is at index 0
                        break;
                    }
                }
                count += 1;
            }
        }
        return res_buf[0..count];
    }
}.process;

pub fn migrateYarnLockfile(
    this: *Lockfile,
    manager: *Install.PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    data: string,
    abs_path: string,
) !LoadResult {
    _ = abs_path; // autofix
    var yarn_lock = YarnLock.init(allocator);
    defer yarn_lock.deinit();

    try yarn_lock.parse(data);

    // Initialize empty lockfile
    this.initEmpty(allocator);
    Install.initializeStore();

    var string_buf = this.stringBuf();

    // Count dependencies for pre-allocation
    var num_deps: u32 = 0;
    for (yarn_lock.entries.items) |entry| {
        if (entry.dependencies) |deps| {
            num_deps += @intCast(deps.count());
        }
        if (entry.optionalDependencies) |deps| {
            num_deps += @intCast(deps.count());
        }
        if (entry.peerDependencies) |deps| {
            num_deps += @intCast(deps.count());
        }
        if (entry.devDependencies) |deps| {
            num_deps += @intCast(deps.count());
        }
    }

    const num_packages = @as(u32, @intCast(yarn_lock.entries.items.len + 1));

    // Pre-allocate buffers
    try this.buffers.dependencies.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.resolutions.ensureTotalCapacity(allocator, num_deps);
    try this.packages.ensureTotalCapacity(allocator, num_packages);
    try this.package_index.ensureTotalCapacity(num_packages);

    var dependencies_buf = this.buffers.dependencies.items.ptr[0..num_deps];
    var resolutions_buf = this.buffers.resolutions.items.ptr[0..num_deps];

    // Add root package first
    try this.packages.append(allocator, Lockfile.Package{
        .name = try string_buf.append(""),
        .name_hash = 0,
        .resolution = Resolution.init(.{ .root = {} }),
        .dependencies = .{},
        .resolutions = .{},
        .meta = .{
            .id = 0,
            .origin = .local,
            .arch = .all,
            .os = .all,
            .man_dir = String{},
            .has_install_script = .false,
            .integrity = Integrity{},
        },
        .bin = Bin.init(),
        .scripts = .{},
    });

    // First pass: Create packages
    for (yarn_lock.entries.items, 0..) |entry, i| {
        const package_id: Install.PackageID = @intCast(i + 1);
        const name = YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        const name_hash = stringHash(name);

        // Create package
        try this.packages.append(allocator, Lockfile.Package{
            .name = try string_buf.appendWithHash(name, name_hash),
            .name_hash = name_hash,
            .resolution = blk: {
                if (entry.workspace) {
                    break :blk Resolution.init(.{ .workspace = try string_buf.append(name) });
                } else if (entry.file) |file| {
                    break :blk Resolution.init(.{ .folder = try string_buf.append(file) });
                } else if (entry.commit) |commit| {
                    if (entry.resolved) |resolved| {
                        break :blk Resolution.init(.{
                            .git = .{
                                .owner = try string_buf.append(name),
                                .repo = try string_buf.append(resolved),
                                .committish = try string_buf.append(commit),
                                .resolved = try string_buf.append(commit),
                                .package_name = try string_buf.append(name),
                            },
                        });
                    }
                    break :blk Resolution{};
                } else if (entry.resolved) |resolved| {
                    const version = entry.version;
                    const sliced_version = Semver.SlicedString.init(version, version);
                    const result = Semver.Version.parse(sliced_version);
                    if (!result.valid) {
                        break :blk Resolution{};
                    }

                    break :blk Resolution.init(.{
                        .npm = .{
                            .url = try string_buf.append(resolved),
                            .version = result.version.min(),
                        },
                    });
                } else {
                    break :blk Resolution{};
                }
            },
            .dependencies = .{},
            .resolutions = .{},
            .meta = .{
                .id = package_id,
                .origin = .npm,
                .arch = if (entry.cpu) |cpu_list| arch: {
                    var arch = Npm.Architecture.none.negatable();
                    for (cpu_list) |cpu| {
                        arch.apply(cpu);
                    }
                    break :arch arch.combine();
                } else .all,
                .os = if (entry.os) |os_list| os: {
                    var os = Npm.OperatingSystem.none.negatable();
                    for (os_list) |os_str| {
                        os.apply(os_str);
                    }
                    break :os os.combine();
                } else .all,
                .man_dir = String{},
                .has_install_script = .false,
                .integrity = if (entry.integrity) |integrity|
                    Integrity.parse(integrity)
                else
                    Integrity{},
            },
            .bin = Bin.init(),
            .scripts = .{},
        });

        try this.getOrPutID(package_id, name_hash);
    }

    // Second pass: Link dependencies
    var dependencies_list = this.packages.items(.dependencies);
    var resolution_list = this.packages.items(.resolutions);

    for (yarn_lock.entries.items, 0..) |entry, package_idx| {
        const dependencies_start = dependencies_buf.ptr;
        const resolutions_start = resolutions_buf.ptr;

        // Process regular dependencies
        if (entry.dependencies) |deps| {
            const processed = try processDeps(
                deps,
                false,
                false,
                false,
                &yarn_lock,
                &string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
            );
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        // Process optional dependencies
        if (entry.optionalDependencies) |deps| {
            const processed = try processDeps(
                deps,
                true,
                false,
                false,
                &yarn_lock,
                &string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
            );
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        // Process peer dependencies
        if (entry.peerDependencies) |deps| {
            const processed = try processDeps(
                deps,
                false,
                true,
                false,
                &yarn_lock,
                &string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
            );
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        // Process dev dependencies
        if (entry.devDependencies) |deps| {
            const processed = try processDeps(
                deps,
                false,
                false,
                true,
                &yarn_lock,
                &string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
            );
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        // Set dependencies and resolutions for this package
        const deps_len = @intFromPtr(dependencies_buf.ptr) - @intFromPtr(dependencies_start);
        const deps_off = @intFromPtr(dependencies_start) - @intFromPtr(this.buffers.dependencies.items.ptr);
        dependencies_list[package_idx + 1] = .{ // +1 because root package is at index 0
            .off = @intCast(deps_off / @sizeOf(Dependency)),
            .len = @intCast(deps_len / @sizeOf(Dependency)),
        };
        resolution_list[package_idx + 1] = .{ // +1 because root package is at index 0
            .off = @intCast((@intFromPtr(resolutions_start) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID)),
            .len = @intCast(deps_len / @sizeOf(Install.PackageID)),
        };
    }

    // Update buffer lengths
    this.buffers.dependencies.items.len = @intCast((@intFromPtr(dependencies_buf.ptr) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency));
    this.buffers.resolutions.items.len = this.buffers.dependencies.items.len;

    try this.resolve(log);

    if (Environment.allow_assert) {
        try this.verifyData();
    }

    this.meta_hash = try this.generateMetaHash(false, this.packages.len);

    return LoadResult{ .ok = .{
        .lockfile = this,
        .was_migrated = true,
        .loaded_from_binary_lockfile = false,
        .serializer_result = .{},
        .format = .binary,
    } };
}
