const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const string = bun.string;
const Environment = bun.Environment;
const strings = bun.strings;
const logger = bun.logger;
const Output = bun.Output;

const Install = @import("./install.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;
const Npm = @import("./npm.zig");
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;

const Semver = @import("../semver.zig");
const String = Semver.String;
const stringHash = String.Builder.stringHash;
// Use the default HashMap context for string keys

const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;
const Tree = Lockfile.Tree;

const JSON = @import("../json_parser.zig");
const js_ast = @import("../js_ast.zig");

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
        dependencies: ?bun.StringHashMap(string) = null,
        // Optional dependencies
        optionalDependencies: ?bun.StringHashMap(string) = null,
        // Peer dependencies
        peerDependencies: ?bun.StringHashMap(string) = null,
        // Dev dependencies
        devDependencies: ?bun.StringHashMap(string) = null,
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

            // Handle npm: aliased dependencies like "old@npm:abbrev@1.0.x"
            if (strings.indexOf(unquoted, "@npm:")) |npm_idx| {
                return unquoted[0..npm_idx];
            }

            // Handle remote tarball URLs like "remote@https://registry.npmjs.org/..."
            if (strings.indexOf(unquoted, "@https://")) |url_idx| {
                return unquoted[0..url_idx];
            }

            // Handle git URLs like "full-git-url@git+https://..."
            if (strings.indexOf(unquoted, "@git+")) |git_idx| {
                return unquoted[0..git_idx];
            }

            // Handle github shorthand like "ghshort@github:..."
            if (strings.indexOf(unquoted, "@github:")) |gh_idx| {
                return unquoted[0..gh_idx];
            }

            // Handle file dependencies like "symlink@file:..."
            if (strings.indexOf(unquoted, "@file:")) |file_idx| {
                return unquoted[0..file_idx];
            }

            if (strings.indexOf(unquoted, "@")) |idx| {
                if (idx == 0) {
                    if (strings.indexOf(unquoted[1..], "@")) |second_idx| {
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

            // Handle npm: aliased dependencies like "old@npm:abbrev@1.0.x"
            if (strings.indexOf(unquoted, "@npm:")) |npm_idx| {
                return unquoted[npm_idx + 1 ..];
            }

            // Handle remote tarball URLs like "remote@https://registry.npmjs.org/..."
            if (strings.indexOf(unquoted, "@https://")) |url_idx| {
                return unquoted[url_idx + 1 ..];
            }

            // Handle git URLs like "full-git-url@git+https://..."
            if (strings.indexOf(unquoted, "@git+")) |git_idx| {
                return unquoted[git_idx + 1 ..];
            }

            // Handle github shorthand like "ghshort@github:..."
            if (strings.indexOf(unquoted, "@github:")) |gh_idx| {
                return unquoted[gh_idx + 1 ..];
            }

            // Handle file dependencies like "symlink@file:..."
            if (strings.indexOf(unquoted, "@file:")) |file_idx| {
                return unquoted[file_idx + 1 ..];
            }

            if (strings.indexOf(unquoted, "@")) |idx| {
                if (idx == 0) {
                    // Handle scoped packages like @babel/core@^7.0.0
                    if (strings.indexOf(unquoted[1..], "@")) |second_idx| {
                        return unquoted[0 .. second_idx + 1];
                    }
                    return unquoted; // Just a scoped package name like @babel/core
                }
                // Return the package name part before the @
                return unquoted[0..idx];
            }
            return unquoted; // No @ found, return the whole string
        }

        pub fn isGitDependency(version: []const u8) bool {
            return strings.startsWith(version, "git+") or
                strings.startsWith(version, "git://") or
                strings.startsWith(version, "github:") or
                strings.startsWith(version, "https://github.com/");
        }

        pub fn isNpmAlias(version: []const u8) bool {
            return strings.startsWith(version, "npm:");
        }

        pub fn isRemoteTarball(version: []const u8) bool {
            return strings.startsWith(version, "https://") and strings.endsWith(version, ".tgz");
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

            if (strings.indexOf(url, "#")) |hash_idx| {
                commit = url[hash_idx + 1 ..];
                url = url[0..hash_idx];
            }

            return .{ .url = url, .commit = commit };
        }

        pub fn parseNpmAlias(version: []const u8) struct { package: []const u8, version: []const u8 } {
            // version is in format "npm:package@version"
            const npm_part = version[4..]; // Skip "npm:"
            if (strings.indexOf(npm_part, "@")) |at_idx| {
                return .{
                    .package = npm_part[0..at_idx],
                    .version = npm_part[at_idx + 1 ..],
                };
            }
            return .{ .package = npm_part, .version = "*" };
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
        var lines = strings.split(content, "\n");
        var current_entry: ?Entry = null;
        var current_specs = std.ArrayList([]const u8).init(self.allocator);
        defer current_specs.deinit();

        var current_deps: ?bun.StringHashMap(string) = null;
        var current_optional_deps: ?bun.StringHashMap(string) = null;
        var current_peer_deps: ?bun.StringHashMap(string) = null;
        var current_dev_deps: ?bun.StringHashMap(string) = null;
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

            const trimmed = strings.trim(line[indent..], " \r\t");
            if (trimmed.len == 0) continue;

            // New entry starts with no indentation and ends with a colon
            if (indent == 0 and strings.endsWithComptime(trimmed, ":")) {
                // Save previous entry if it exists
                if (current_entry) |*entry| {
                    entry.dependencies = current_deps;
                    entry.optionalDependencies = current_optional_deps;
                    entry.peerDependencies = current_peer_deps;
                    entry.devDependencies = current_dev_deps;
                    try self.consolidateAndAppendEntry(entry.*);
                }

                // Parse specs
                current_specs.clearRetainingCapacity();
                const specs_str = trimmed[0 .. trimmed.len - 1]; // Remove trailing colon
                var specs_it = strings.split(specs_str, ",");
                while (specs_it.next()) |spec| {
                    const spec_trimmed = strings.trim(spec, " \"");
                    try current_specs.append(try self.allocator.dupe(u8, spec_trimmed));
                }

                current_entry = Entry{
                    .specs = try self.allocator.dupe([]const u8, current_specs.items),
                    .version = undefined,
                };
                
                // Check if any spec contains a file: dependency and extract the path
                for (current_specs.items) |spec| {
                    if (strings.indexOf(spec, "@file:")) |at_index| {
                        const file_path = spec[at_index + 6..]; // Skip "@file:"
                        current_entry.?.file = try self.allocator.dupe(u8, file_path);
                        break;
                    }
                }

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
                if (strings.eqlComptime(trimmed, "dependencies:")) {
                    in_dependencies = true;
                    in_optional_dependencies = false;
                    in_peer_dependencies = false;
                    in_dev_dependencies = false;
                    current_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (strings.eqlComptime(trimmed, "optionalDependencies:")) {
                    in_optional_dependencies = true;
                    in_dependencies = false;
                    in_peer_dependencies = false;
                    in_dev_dependencies = false;
                    current_optional_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (strings.eqlComptime(trimmed, "peerDependencies:")) {
                    in_peer_dependencies = true;
                    in_dependencies = false;
                    in_optional_dependencies = false;
                    in_dev_dependencies = false;
                    current_peer_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (strings.eqlComptime(trimmed, "devDependencies:")) {
                    in_dev_dependencies = true;
                    in_dependencies = false;
                    in_optional_dependencies = false;
                    in_peer_dependencies = false;
                    current_dev_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                // Handle dependencies
                if (in_dependencies or in_optional_dependencies or in_peer_dependencies or in_dev_dependencies) {
                    if (strings.indexOf(trimmed, " ")) |space_idx| {
                        const key = strings.trim(trimmed[0..space_idx], " \"");
                        const value = strings.trim(trimmed[space_idx + 1 ..], " \"");
                        const map = if (in_dependencies) &current_deps.? else if (in_optional_dependencies) &current_optional_deps.? else if (in_peer_dependencies) &current_peer_deps.? else &current_dev_deps.?;
                        try map.put(key, value);
                    }
                    continue;
                }

                // Handle regular key-value pairs
                if (strings.indexOf(trimmed, " ")) |space_idx| {
                    const key = strings.trim(trimmed[0..space_idx], " ");
                    const value = strings.trim(trimmed[space_idx + 1 ..], " \"");

                    if (strings.eqlComptime(key, "version")) {
                        current_entry.?.version = value;
                        
                        // Check for special version types
                        if (Entry.isWorkspaceDependency(value)) {
                            current_entry.?.workspace = true;
                        } else if (Entry.isFileDependency(value)) {
                            current_entry.?.file = if (strings.startsWith(value, "file:")) value[5..] else value;
                        } else if (Entry.isGitDependency(value)) {
                            const git_info = try Entry.parseGitUrl(self, value);
                            current_entry.?.resolved = git_info.url;
                            current_entry.?.commit = git_info.commit;
                        } else if (Entry.isNpmAlias(value)) {
                            // For npm aliases, use the actual package name and version
                            const alias_info = Entry.parseNpmAlias(value);
                            current_entry.?.version = alias_info.version;
                        } else if (Entry.isRemoteTarball(value)) {
                            // For remote tarballs, use the URL as resolved
                            current_entry.?.resolved = value;
                        }
                    } else if (strings.eqlComptime(key, "resolved")) {
                        current_entry.?.resolved = value;
                    } else if (strings.eqlComptime(key, "integrity")) {
                        current_entry.?.integrity = value;
                    } else if (strings.eqlComptime(key, "os")) {
                        // Parse os array
                        var os_list = std.ArrayList([]const u8).init(self.allocator);
                        var os_it = strings.split(value[1 .. value.len - 1], ",");
                        while (os_it.next()) |os| {
                            const trimmed_os = strings.trim(os, " \"");
                            try os_list.append(trimmed_os);
                        }
                        current_entry.?.os = try os_list.toOwnedSlice();
                    } else if (strings.eqlComptime(key, "cpu")) {
                        // Parse cpu array
                        var cpu_list = std.ArrayList([]const u8).init(self.allocator);
                        var cpu_it = strings.split(value[1 .. value.len - 1], ",");
                        while (cpu_it.next()) |cpu| {
                            const trimmed_cpu = strings.trim(cpu, " \"");
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
            try self.consolidateAndAppendEntry(entry.*);
        }
    }

    fn findEntryBySpec(self: *YarnLock, spec: []const u8) ?*Entry {
        for (self.entries.items) |*entry| {
            for (entry.specs) |entry_spec| {
                if (strings.eql(entry_spec, spec)) {
                    return entry;
                }
            }
        }
        return null;
    }

    // Consolidate entries with the same package name and resolved version
    fn consolidateAndAppendEntry(self: *YarnLock, new_entry: Entry) !void {
        // Get the package name from the first spec
        if (new_entry.specs.len == 0) return;
        const package_name = Entry.getNameFromSpec(new_entry.specs[0]);
        
        // Look for an existing entry with the same package name and version
        for (self.entries.items) |*existing_entry| {
            if (existing_entry.specs.len == 0) continue;
            const existing_name = Entry.getNameFromSpec(existing_entry.specs[0]);
            
            // Check if this is the same package with the same resolved version
            if (strings.eql(package_name, existing_name) and 
                strings.eql(new_entry.version, existing_entry.version)) {
                
                // Merge the specs from the new entry into the existing entry
                const old_specs = existing_entry.specs;
                const combined_specs = try self.allocator.alloc([]const u8, old_specs.len + new_entry.specs.len);
                @memcpy(combined_specs[0..old_specs.len], old_specs);
                @memcpy(combined_specs[old_specs.len..], new_entry.specs);
                
                // Free old specs and update entry
                self.allocator.free(old_specs);
                existing_entry.specs = combined_specs;
                
                // Free the new entry's specs since we've merged them
                self.allocator.free(new_entry.specs);
                return;
            }
        }
        
        // No existing entry found, add this as a new entry
        try self.entries.append(new_entry);
    }
};

// Helper to process dependencies from a map
const processDeps = struct {
    fn process(
        deps: bun.StringHashMap(string),
        is_optional: bool,
        is_peer: bool,
        is_dev: bool,
        yarn_lock_: *YarnLock,
        string_buf_: *Semver.String.Buf,
        deps_buf: []Dependency,
        res_buf: []Install.PackageID,
        log: *logger.Log,
        manager: *Install.PackageManager,
        yarn_entry_to_package_id: []const Install.PackageID,
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

                // Parse the dependency version, handling special cases
                const parsed_version = if (YarnLock.Entry.isNpmAlias(dep_version)) blk: {
                    const alias_info = YarnLock.Entry.parseNpmAlias(dep_version);
                    break :blk alias_info.version;
                } else dep_version;

                // Create dependency
                deps_buf[count] = Dependency{
                    .name = dep_name_str,
                    .name_hash = dep_name_hash,
                    .version = Dependency.parse(
                        yarn_lock_.allocator,
                        dep_name_str,
                        dep_name_hash,
                        parsed_version,
                        &Semver.SlicedString.init(parsed_version, parsed_version),
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
                var found_package_id: ?Install.PackageID = null;
                outer: for (yarn_lock_.entries.items, 0..) |entry_, yarn_idx| {
                    for (entry_.specs) |entry_spec| {
                        if (strings.eql(entry_spec, dep_spec)) {
                            found_package_id = yarn_entry_to_package_id[yarn_idx];
                            break :outer;
                        }
                    }
                }
                
                if (found_package_id) |pkg_id| {
                    res_buf[count] = pkg_id;
                    count += 1;
                }
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
    // EXTENSIVE DEBUG LOGGING
    
    var yarn_lock = YarnLock.init(allocator);
    defer yarn_lock.deinit();

    try yarn_lock.parse(data);
    
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Parsed {} yarn.lock entries", .{yarn_lock.entries.items.len});
    }

    // Initialize empty lockfile
    this.initEmpty(allocator);
    Install.initializeStore();

    var string_buf = this.stringBuf();

    // Count dependencies for pre-allocation
    var num_deps: u32 = 0;
    
    // Parse package.json properly using JSON parser
    var root_dep_count: u32 = 0;
    var root_dep_count_from_package_json: u32 = 0;
    const package_json_path = std.fs.path.dirname(abs_path) orelse ".";
    const package_json_file_path = try std.fmt.allocPrint(allocator, "{s}/package.json", .{package_json_path});
    defer allocator.free(package_json_file_path);
    
    var root_dependencies = std.ArrayList(struct { name: []const u8, version: []const u8, is_dev: bool }).init(allocator);
    defer {
        for (root_dependencies.items) |dep| {
            allocator.free(dep.name);
            allocator.free(dep.version);
        }
        root_dependencies.deinit();
    }
    
    // Try to read package.json if it exists
    if (std.fs.cwd().readFileAlloc(allocator, package_json_file_path, 1024 * 1024)) |content| {
        defer allocator.free(content);
        
        const source = logger.Source.initPathString(package_json_file_path, content);
        if (JSON.parsePackageJSONUTF8(&source, log, allocator)) |json| {
            // Extract dependencies from parsed JSON
            const sections = [_]struct { key: []const u8, is_dev: bool }{
                .{ .key = "dependencies", .is_dev = false },
                .{ .key = "devDependencies", .is_dev = true },
                .{ .key = "optionalDependencies", .is_dev = false },
            };
            
            for (sections) |section| {
                if (json.asProperty(section.key)) |prop| {
                    if (prop.expr.data == .e_object) {
                        const obj = prop.expr.data.e_object;
                        for (obj.properties.slice()) |p| {
                            if (p.key) |key| {
                                if (key.data == .e_string) {
                                    const name_slice = key.data.e_string.string(allocator) catch continue;
                                    if (p.value) |value| {
                                        // Handle different value types
                                        var version_slice: []const u8 = "";
                                        switch (value.data) {
                                            .e_string => {
                                                version_slice = value.data.e_string.string(allocator) catch continue;
                                            },
                                            else => {
                                                // For non-string values (like complex file: references), skip
                                                continue;
                                            },
                                        }
                                        
                                        if (version_slice.len > 0) {
                                            // We need to dupe these strings since they point to the JSON buffer
                                            const name = try allocator.dupe(u8, name_slice);
                                            const version = try allocator.dupe(u8, version_slice);
                                            try root_dependencies.append(.{
                                                .name = name,
                                                .version = version,
                                                .is_dev = section.is_dev,
                                            });
                                            root_dep_count_from_package_json += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
        } else |_| {
            // Failed to parse JSON, continue without root dependencies
        }
    } else |_| {
        // No package.json found, continue without root dependencies
    }
    
    // Use the actual count from package.json or a reasonable default
    root_dep_count = @max(root_dep_count_from_package_json, 10);
    
    num_deps += root_dep_count;
    
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

    // Add root package first (dependencies will be set later)
    try this.packages.append(allocator, Lockfile.Package{
        .name = try string_buf.append(""),
        .name_hash = 0,
        .resolution = Resolution.init(.{ .root = {} }),
        .dependencies = .{}, // Will be set after processing all dependencies
        .resolutions = .{}, // Will be set after processing all dependencies
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
    // Map yarn entry index to package ID
    var yarn_entry_to_package_id = try allocator.alloc(Install.PackageID, yarn_lock.entries.items.len);
    defer allocator.free(yarn_entry_to_package_id);
    
    // Define struct types for version tracking
    const VersionInfo = struct {
        version: string,
        package_id: Install.PackageID,
        yarn_idx: usize,
    };
    
    // Track package versions to detect conflicts
    var package_versions = bun.StringHashMap(VersionInfo).init(allocator);
    defer package_versions.deinit();
    
    // Track which packages need scoped names due to version conflicts
    var scoped_packages = bun.StringHashMap(std.ArrayList(VersionInfo)).init(allocator);
    defer {
        var it = scoped_packages.iterator();
        while (it.next()) |entry| {
            entry.value_ptr.deinit();
        }
        scoped_packages.deinit();
    }
    
    var next_package_id: Install.PackageID = 1; // 0 is root
    
    // First, identify all unique package versions
    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const name = YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        const version = entry.version;
        
        if (strings.eql(name, "babylon")) {
            if (Environment.isDebug) {
                bun.Output.prettyErrorln("DEBUG: Processing babylon entry {}: {s} -> {s}", .{yarn_idx, entry.specs[0], version});
            }
        }
        
        if (package_versions.get(name)) |existing| {
            if (strings.eql(name, "babylon")) {
                if (Environment.isDebug) {
                    bun.Output.prettyErrorln("DEBUG: Babylon existing version: {s}, new version: {s}, equal: {}", .{existing.version, version, strings.eql(existing.version, version)});
                }
            }
            
            // Check if this is a different version
            if (!strings.eql(existing.version, version)) {
                // We have a version conflict
                var list = scoped_packages.get(name) orelse std.ArrayList(VersionInfo).init(allocator);
                
                // Add both the existing and new version to the scoped list if not already there
                var found_existing = false;
                var found_new = false;
                for (list.items) |item| {
                    if (strings.eql(item.version, existing.version)) found_existing = true;
                    if (strings.eql(item.version, version)) found_new = true;
                }
                
                if (!found_existing) {
                    try list.append(.{
                        .yarn_idx = existing.yarn_idx,
                        .version = existing.version,
                        .package_id = existing.package_id,
                    });
                }
                
                if (!found_new) {
                    const package_id = next_package_id;
                    next_package_id += 1;
                    try list.append(.{
                        .yarn_idx = yarn_idx,
                        .version = version,
                        .package_id = package_id,
                    });
                    yarn_entry_to_package_id[yarn_idx] = package_id;
                } else {
                    // Find the existing package ID for this version
                    for (list.items) |item| {
                        if (strings.eql(item.version, version)) {
                            yarn_entry_to_package_id[yarn_idx] = item.package_id;
                            break;
                        }
                    }
                }
                
                try scoped_packages.put(name, list);
            } else {
                // Same version, reuse the package ID
                yarn_entry_to_package_id[yarn_idx] = existing.package_id;
            }
        } else {
            // First time seeing this package
            const package_id = next_package_id;
            next_package_id += 1;
            yarn_entry_to_package_id[yarn_idx] = package_id;
            try package_versions.put(name, .{
                .version = version,
                .package_id = package_id,
                .yarn_idx = yarn_idx,
            });
        }
    }
    
    // Now create packages with appropriate names
    // We'll need to track which yarn entries map to which parent packages for scoped naming
    var package_id_to_yarn_idx = try allocator.alloc(usize, next_package_id);
    defer allocator.free(package_id_to_yarn_idx);
    @memset(package_id_to_yarn_idx, std.math.maxInt(usize));
    
    // Create a map of package names to track which ones have been created
    var created_packages = bun.StringHashMap(bool).init(allocator);
    defer created_packages.deinit();
    
    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const base_name = YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        const package_id = yarn_entry_to_package_id[yarn_idx];
        
        // Skip if we already created this package (same version referenced multiple times)
        if (package_id < package_id_to_yarn_idx.len and package_id_to_yarn_idx[package_id] != std.math.maxInt(usize)) {
            continue;
        }
        
        package_id_to_yarn_idx[package_id] = yarn_idx;
        
        // Always use the base name for the package itself
        // Scoping will be handled when adding to package index
        const name_to_use = base_name;
        
        
        const name_hash = stringHash(name_to_use);

        // Create package
        try this.packages.append(allocator, Lockfile.Package{
            .name = try string_buf.appendWithHash(name_to_use, name_hash),
            .name_hash = name_hash,
            .resolution = blk: {
                if (entry.workspace) {
                    break :blk Resolution.init(.{ .workspace = try string_buf.append(base_name) });
                } else if (entry.file) |file| {
                    break :blk Resolution.init(.{ .folder = try string_buf.append(file) });
                } else if (entry.commit) |commit| {
                    if (entry.resolved) |resolved| {
                        break :blk Resolution.init(.{
                            .git = .{
                                .owner = try string_buf.append(base_name),
                                .repo = try string_buf.append(resolved),
                                .committish = try string_buf.append(commit),
                                .resolved = try string_buf.append(commit),
                                .package_name = try string_buf.append(base_name),
                            },
                        });
                    }
                    break :blk Resolution{};
                } else if (entry.resolved) |resolved| {
                    // Handle remote tarball URLs
                    if (YarnLock.Entry.isRemoteTarball(resolved) or strings.endsWith(resolved, ".tgz")) {
                        break :blk Resolution.init(.{
                            .remote_tarball = try string_buf.append(resolved),
                        });
                    }

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

        // Don't add to package index yet - let the flattening algorithm handle all placement
    }

    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Created {} packages from {} yarn.lock entries", .{next_package_id - 1, yarn_lock.entries.items.len});
        bun.Output.prettyErrorln("DEBUG: Found {} packages with version conflicts", .{scoped_packages.count()});
    }

    // Second pass: Link dependencies
    var dependencies_list = this.packages.items(.dependencies);
    var resolution_list = this.packages.items(.resolutions);

    // Create root dependencies from package.json
    var actual_root_dep_count: u32 = 0;
    
    if (root_dependencies.items.len > 0) {
        // Process actual dependencies from package.json
        for (root_dependencies.items) |dep| {
            const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep.name, dep.version });
            defer allocator.free(dep_spec);
            
            
            // Find matching entry in yarn.lock
            var found_idx: ?usize = null;
            for (yarn_lock.entries.items, 0..) |entry, idx| {
                for (entry.specs) |spec| {
                    if (strings.eql(spec, dep_spec)) {
                        found_idx = idx;
                        break;
                    }
                }
                if (found_idx != null) break;
            }
            
            if (found_idx) |idx| {
                const name_hash = stringHash(dep.name);
                const dep_name_string = try string_buf.appendWithHash(dep.name, name_hash);
                
                dependencies_buf[actual_root_dep_count] = Dependency{
                    .name = dep_name_string,
                    .name_hash = name_hash,
                    .version = Dependency.parse(
                        allocator,
                        dep_name_string,
                        name_hash,
                        dep.version,
                        &Semver.SlicedString.init(dep.version, dep.version),
                        log,
                        manager,
                    ) orelse Dependency.Version{},
                    .behavior = .{ 
                        .prod = !dep.is_dev,
                        .dev = dep.is_dev,
                        .optional = false,
                        .peer = false,
                        .workspace = false,
                    },
                };
                
                // Point to the package using the deduplicated package ID
                resolutions_buf[actual_root_dep_count] = yarn_entry_to_package_id[idx];
                actual_root_dep_count += 1;
            } else {
            }
        }
    }
    
    // For yarn migration, we rely on the tree building logic to include all packages
    // We don't need to add them all as root dependencies
    
    // Set root package dependencies
    dependencies_list[0] = .{
        .off = 0,
        .len = actual_root_dep_count,
    };
    resolution_list[0] = .{
        .off = 0,
        .len = actual_root_dep_count,
    };
    
    // Move buffers forward
    dependencies_buf = dependencies_buf[actual_root_dep_count..];
    resolutions_buf = resolutions_buf[actual_root_dep_count..];

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
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
                yarn_entry_to_package_id,
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
                yarn_entry_to_package_id,
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
                yarn_entry_to_package_id,
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
                yarn_entry_to_package_id,
            );
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        // Set dependencies and resolutions for this package
        const deps_len = @intFromPtr(dependencies_buf.ptr) - @intFromPtr(dependencies_start);
        const deps_off = @intFromPtr(dependencies_start) - @intFromPtr(this.buffers.dependencies.items.ptr);
        dependencies_list[package_id] = .{
            .off = @intCast(deps_off / @sizeOf(Dependency)),
            .len = @intCast(deps_len / @sizeOf(Dependency)),
        };
        resolution_list[package_id] = .{
            .off = @intCast((@intFromPtr(resolutions_start) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID)),
            .len = @intCast((@intFromPtr(resolutions_buf.ptr) - @intFromPtr(resolutions_start)) / @sizeOf(Install.PackageID)),
        };
    }

    // Update buffer lengths
    this.buffers.dependencies.items.len = @intCast((@intFromPtr(dependencies_buf.ptr) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency));
    this.buffers.resolutions.items.len = this.buffers.dependencies.items.len;

    // Build the tree structure for yarn migration
    // Initialize with enough space for all dependencies, will be managed manually
    try this.buffers.hoisted_dependencies.ensureTotalCapacity(allocator, this.buffers.dependencies.items.len * 2);
    var hoisted_off: u32 = 0;
    
    // Add root node to tree (initially empty, will be updated later)
    try this.buffers.trees.append(allocator, Tree{
        .id = 0,
        .parent = Tree.invalid_id,
        .dependency_id = Tree.root_dep_id,
        .dependencies = .{
            .off = 0,
            .len = 0,
        },
    });
    
    
    // Now we need to update package names for version conflicts
    // We'll do this after processing dependencies to know parent relationships
    // Track package dependencies to determine parent packages for scoped names
    
    // Debug: Check if babylon is in scoped_packages
    if (Environment.isDebug) {
        if (scoped_packages.get("babylon")) |babylon_list| {
            bun.Output.prettyErrorln("DEBUG: babylon IS in scoped_packages with {} versions", .{babylon_list.items.len});
        } else {
            bun.Output.prettyErrorln("DEBUG: babylon is NOT in scoped_packages", .{});
        }
    }
    var package_dependents = try allocator.alloc(std.ArrayList(Install.PackageID), next_package_id);
    defer {
        for (package_dependents) |*list| {
            list.deinit();
        }
        allocator.free(package_dependents);
    }
    for (package_dependents) |*list| {
        list.* = std.ArrayList(Install.PackageID).init(allocator);
    }
    
    // Build dependency graph to find parent packages
    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const parent_package_id = yarn_entry_to_package_id[yarn_idx];
        
        // Process all dependency types
        const dep_maps = [_]?bun.StringHashMap(string){
            entry.dependencies,
            entry.optionalDependencies,
            entry.peerDependencies,
            entry.devDependencies,
        };
        
        for (dep_maps) |maybe_deps| {
            if (maybe_deps) |deps| {
                var deps_it = deps.iterator();
                while (deps_it.next()) |dep| {
                    const dep_name = dep.key_ptr.*;
                    const dep_version = dep.value_ptr.*;
                    const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, dep_version });
                    defer allocator.free(dep_spec);
                    
                    if (yarn_lock.findEntryBySpec(dep_spec)) |dep_entry| {
                        // Find the yarn index for this dependency
                        for (yarn_lock.entries.items, 0..) |*e, idx| {
                            // Compare by spec matching instead of pointer
                            var found = false;
                            for (e.specs) |spec| {
                                for (dep_entry.specs) |dep_spec_item| {
                                    if (strings.eql(spec, dep_spec_item)) {
                                        found = true;
                                        break;
                                    }
                                }
                                if (found) break;
                            }
                            
                            if (found) {
                                const dep_package_id = yarn_entry_to_package_id[idx];
                                try package_dependents[dep_package_id].append(parent_package_id);
                                if (Environment.isDebug and strings.eql(dep_name, "minimist")) {
                                    bun.Output.prettyErrorln("DEBUG: Added dependent {} to minimist (package_id {})", .{parent_package_id, dep_package_id});
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Also add root dependencies
    for (root_dependencies.items) |dep| {
        const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep.name, dep.version });
        defer allocator.free(dep_spec);
        
        for (yarn_lock.entries.items, 0..) |entry, idx| {
            for (entry.specs) |spec| {
                if (strings.eql(spec, dep_spec)) {
                    const dep_package_id = yarn_entry_to_package_id[idx];
                    try package_dependents[dep_package_id].append(0); // 0 is root package
                    break;
                }
            }
        }
    }
    
    // Now update package names for conflicting versions
    var packages_slice = this.packages.slice();
    
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Updating scoped names for {} conflicting packages", .{scoped_packages.count()});
    }
    
    var scoped_it = scoped_packages.iterator();
    while (scoped_it.next()) |entry| {
        const base_name = entry.key_ptr.*;
        const versions = entry.value_ptr.*;
        
        if (Environment.isDebug and strings.eql(base_name, "babylon")) {
            bun.Output.prettyErrorln("DEBUG: Processing babylon in scoped naming loop with {} versions", .{versions.items.len});
        }
        
        if (Environment.isDebug) {
            bun.Output.prettyErrorln("DEBUG: Package '{s}' has {} versions", .{base_name, versions.items.len});
        }
        
        // Sort versions by package ID to ensure the first one gets the unscoped name
        std.sort.pdq(VersionInfo, versions.items, {}, struct {
            fn lessThan(_: void, a: VersionInfo, b: VersionInfo) bool {
                return a.package_id < b.package_id;
            }
        }.lessThan);
        
        // For conflicting packages, FIRST remove ALL existing entries from package index
        // This prevents duplicates when we add scoped names
        const original_name_hash = stringHash(base_name);
        if (Environment.isDebug and strings.eql(base_name, "acorn")) {
            bun.Output.prettyErrorln("DEBUG: About to remove all acorn entries from package index", .{});
        }
        if (this.package_index.getPtr(original_name_hash)) |original_entry| {
            switch (original_entry.*) {
                .id => |existing_id| {
                    // Remove the entry entirely
                    if (Environment.isDebug and strings.eql(base_name, "acorn")) {
                        bun.Output.prettyErrorln("DEBUG: Removed single acorn entry (package_id {})", .{existing_id});
                    }
                    _ = this.package_index.remove(original_name_hash);
                },
                .ids => |*existing_ids| {
                    // Remove all packages from the list and delete entry
                    if (Environment.isDebug and strings.eql(base_name, "acorn")) {
                        bun.Output.prettyErrorln("DEBUG: Removed {} acorn entries from package index", .{existing_ids.items.len});
                    }
                    existing_ids.deinit(this.allocator);
                    _ = this.package_index.remove(original_name_hash);
                }
            }
        } else {
            if (Environment.isDebug and strings.eql(base_name, "acorn")) {
                bun.Output.prettyErrorln("DEBUG: No acorn entry found in package index to remove", .{});
            }
        }
        
        // For now, just remove the unscoped entry and let the dependency creation handle it
        // This avoids duplicate keys
        
        // Keep track of what we'll scope
        if (Environment.isDebug) {
            for (versions.items, 0..) |version_info, i| {
                bun.Output.prettyErrorln("DEBUG: Will handle '{s}' version {} (package_id {}) during dependency creation", .{base_name, i, version_info.package_id});
            }
        }
    }
    
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Reached final pass section", .{});
    }
    
    // Final pass: ensure all conflicting packages are in package index
    // Some packages might be missed by the iterator, so check explicitly
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Final pass - checking for missed conflicting packages", .{});
    }
    
    var final_check_it = scoped_packages.iterator();
    while (final_check_it.next()) |entry| {
        const base_name = entry.key_ptr.*;
        const versions = entry.value_ptr.*;
        
        for (versions.items) |version_info| {
            const package_id = version_info.package_id;
            
            // Check if this package is already in the package index
            var found_in_index = false;
            
            // Check if package index has this package
            var check_it = this.package_index.iterator();
            while (check_it.next()) |index_entry| {
                switch (index_entry.value_ptr.*) {
                    .id => |id| {
                        if (id == package_id) {
                            found_in_index = true;
                            break;
                        }
                    },
                    .ids => |ids| {
                        for (ids.items) |id| {
                            if (id == package_id) {
                                found_in_index = true;
                                break;
                            }
                        }
                        if (found_in_index) break;
                    },
                }
            }
            
            if (!found_in_index) {
                if (Environment.isDebug) {
                    bun.Output.prettyErrorln("DEBUG: Found missed package '{s}' (package_id {}), adding to index", .{base_name, package_id});
                }
                
                // Create a unique fallback scoped name for missed packages
                // Use package ID to ensure uniqueness since version@version might still collide
                const fallback_name = try std.fmt.allocPrint(allocator, "{s}#{}", .{base_name, package_id});
                defer allocator.free(fallback_name);
                
                const fallback_hash = stringHash(fallback_name);
                try this.getOrPutID(package_id, fallback_hash);
                
                if (Environment.isDebug) {
                    bun.Output.prettyErrorln("DEBUG: Added missed package with unique name '{s}'", .{fallback_name});
                }
            }
        }
    }
    
    
    // Create tree entries
    // For now, we'll hoist everything to root level (no nested packages)
    // This matches yarn's flat structure
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Creating tree entries for {} packages", .{this.packages.len});
    }
    
    // Don't create tree entries for other packages in flat yarn structure
    // Only root tree node is needed since all packages are hoisted
    
    // Create package names array for tracking during flattening
    var package_names = try allocator.alloc([]const u8, next_package_id);
    defer allocator.free(package_names);
    @memset(package_names, "");
    
    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
        if (package_names[package_id].len == 0) { // Only set once per package
            package_names[package_id] = YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        }
    }
    
    // Implement flattening algorithm:
    // 1. Place packages at root level when possible  
    // 2. Only scope when conflicts occur
    // 3. Use proper parent/child scoping based on dependency tree
    
    // Create a map of root-level packages (package_name -> package_id)
    var root_packages = bun.StringHashMap(PackageID).init(allocator);
    defer root_packages.deinit();
    
    // First pass: try to place all packages at root level
    // Start with packages that have the most dependents (common dependencies first)
    var usage_count = bun.StringHashMap(u32).init(allocator);
    defer usage_count.deinit();
    
    // Count how many packages depend on each base package name
    for (yarn_lock.entries.items, 0..) |_, entry_idx| {
        const package_id: PackageID = @intCast(entry_idx + 1);
        const base_name = package_names[package_id];
        
        // Count dependencies on this package
        for (yarn_lock.entries.items) |dep_entry| {
            if (dep_entry.dependencies) |deps| {
                var deps_iter = deps.iterator();
                while (deps_iter.next()) |dep| {
                    if (strings.eql(dep.key_ptr.*, base_name)) {
                        const count = usage_count.get(base_name) orelse 0;
                        try usage_count.put(base_name, count + 1);
                    }
                }
            }
        }
    }
    
    // Create list of packages sorted by usage (most used first)
    var package_by_usage = std.ArrayList(struct { name: []const u8, package_id: PackageID, usage: u32 }).init(allocator);
    defer package_by_usage.deinit();
    
    for (yarn_lock.entries.items, 0..) |_, entry_idx| {
        const package_id: PackageID = @intCast(entry_idx + 1);
        const base_name = package_names[package_id];
        const usage = usage_count.get(base_name) orelse 0;
        
        try package_by_usage.append(.{ .name = base_name, .package_id = package_id, .usage = usage });
    }
    
    // Sort by usage count descending
    std.sort.pdq(@TypeOf(package_by_usage.items[0]), package_by_usage.items, {}, struct {
        fn lessThan(_: void, a: @TypeOf(package_by_usage.items[0]), b: @TypeOf(package_by_usage.items[0])) bool {
            if (a.usage != b.usage) return a.usage > b.usage;
            return a.package_id < b.package_id; // tie-breaker for consistency
        }
    }.lessThan);
    
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Starting flattening algorithm with {} packages by usage", .{package_by_usage.items.len});
    }
    
    // Place packages at root level, giving priority to most-used versions
    for (package_by_usage.items) |pkg| {
        if (root_packages.get(pkg.name)) |_| {
            // Package name already taken at root level
            // This package will need to be scoped under its dependents
            if (Environment.isDebug) {
                bun.Output.prettyErrorln("DEBUG: Package '{s}' already at root, skipping package_id {}", .{pkg.name, pkg.package_id});
            }
            continue;
        } else {
            // Place this version at root level
            try root_packages.put(pkg.name, pkg.package_id);
            const name_hash = stringHash(pkg.name);
            try this.getOrPutID(pkg.package_id, name_hash);
            
            if (Environment.isDebug) {
                bun.Output.prettyErrorln("DEBUG: Placed '{s}' at root level (package_id {})", .{pkg.name, pkg.package_id});
            }
        }
    }
    
    // Create a mapping of package IDs to their scoped names (if any)
    var scoped_names = std.AutoHashMap(PackageID, []const u8).init(allocator);
    defer scoped_names.deinit();

    // Second pass: Create scoped entries for packages that couldn't be placed at root
    // Find which packages need each conflicting package and scope accordingly
    var scoped_count: u32 = 0;
    for (package_by_usage.items) |pkg| {
        if (root_packages.get(pkg.name)) |root_pkg_id| {
            if (root_pkg_id == pkg.package_id) {
                // This package is already at root level, skip
                continue;
            }
        } else {
            // This shouldn't happen since we processed all packages in first pass
            continue;
        }
        
        // Find the first package that depends on this specific version and use parent/child scoping
        var scoped_name: ?[]const u8 = null;
        
        // Look for a parent that depends on this specific version
        for (yarn_lock.entries.items, 0..) |dep_entry, dep_entry_idx| {
            const dep_package_id: PackageID = @intCast(dep_entry_idx + 1);
            
            if (dep_entry.dependencies) |deps| {
                var deps_iter = deps.iterator();
                while (deps_iter.next()) |dep| {
                    if (strings.eql(dep.key_ptr.*, pkg.name)) {
                        // Find a parent that's different from this package
                        if (dep_package_id != pkg.package_id) {
                            const parent_name = package_names[dep_package_id];
                            
                            // Create parent/child scoped name
                            const potential_name = try std.fmt.allocPrint(allocator, "{s}/{s}", .{parent_name, pkg.name});
                            
                            // Check if this scoped name is already used
                            var name_already_used = false;
                            for (package_by_usage.items) |other_pkg| {
                                if (scoped_names.get(other_pkg.package_id)) |existing_name| {
                                    if (strings.eql(existing_name, potential_name)) {
                                        name_already_used = true;
                                        break;
                                    }
                                }
                            }
                            
                            if (!name_already_used) {
                                scoped_name = potential_name;
                                break;
                            }
                        }
                    }
                }
                if (scoped_name != null) break;
            }
        }
        
        // If we couldn't find a unique parent/child name, use a version-based fallback
        if (scoped_name == null) {
            const version_str = switch (this.packages.get(pkg.package_id).resolution.tag) {
                .npm => brk: {
                    var version_buf: [64]u8 = undefined;
                    const formatted = std.fmt.bufPrint(&version_buf, "{}", .{this.packages.get(pkg.package_id).resolution.value.npm.version.fmt(this.buffers.string_bytes.items)}) catch "";
                    break :brk formatted;
                },
                else => "unknown",
            };
            scoped_name = try std.fmt.allocPrint(allocator, "{s}@{s}", .{pkg.name, version_str});
        }
        
        if (scoped_name) |final_scoped_name| {
            const name_hash = stringHash(final_scoped_name);
            try this.getOrPutID(pkg.package_id, name_hash);
            try scoped_names.put(pkg.package_id, final_scoped_name);
            scoped_count += 1;
            
            if (Environment.isDebug) {
                bun.Output.prettyErrorln("DEBUG: Scoped '{s}' as '{s}' (package_id {})", .{pkg.name, final_scoped_name, pkg.package_id});
            }
        }
    }
    
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: Created {} scoped packages", .{scoped_count});
        
    }
    
    // Create dependency objects for ALL packages in flat yarn structure
    var all_dep_list = std.ArrayList(DependencyID).init(allocator);
    defer all_dep_list.deinit();
    
    // Map package IDs to their dependency IDs for quick lookup
    var package_to_dep_id = std.AutoHashMapUnmanaged(Install.PackageID, DependencyID){};
    defer package_to_dep_id.deinit(allocator);
    
    // Create dependencies for all packages and ensure they're in the package index
    for (0..this.packages.len) |pkg_idx| {
        const pkg_id = @as(Install.PackageID, @intCast(pkg_idx));
        if (pkg_id == 0) continue; // Skip root package
        
        const pkg = this.packages.get(pkg_id);
        const pkg_name_str = pkg.name.slice(this.buffers.string_bytes.items);
        
        
        // Check if this package has a scoped name, otherwise use base name
        const dep_name: []const u8 = if (scoped_names.get(pkg_id)) |scoped_name| blk: {
            if (Environment.isDebug) {
                bun.Output.prettyErrorln("DEBUG: Using scoped name '{s}' for package '{s}' (id {})", .{scoped_name, pkg_name_str, pkg_id});
            }
            break :blk scoped_name;
        } else pkg_name_str;
        
        // Ensure this package is in the package index (if not already added by flattening algorithm)
        const dep_name_hash = stringHash(dep_name);
        try this.getOrPutID(pkg_id, dep_name_hash);
        
        const dep_id = @as(DependencyID, @intCast(this.buffers.dependencies.items.len));
        try package_to_dep_id.put(allocator, pkg_id, dep_id);
        
        // Create dependency object with appropriate name
        const dep_name_in_buf = if (strings.eql(dep_name, pkg_name_str))
            pkg.name // Reuse existing string if no scoping
        else
            try string_buf.appendWithHash(dep_name, dep_name_hash);
        
        // Get version string from resolution
        var version_buf: [512]u8 = undefined;
        const version_str = switch (pkg.resolution.tag) {
            .npm => brk: {
                // Format the npm version
                const formatted = std.fmt.bufPrint(&version_buf, "{}", .{pkg.resolution.value.npm.version.fmt(this.buffers.string_bytes.items)}) catch "";
                break :brk formatted;
            },
            .folder => pkg.resolution.value.folder.slice(this.buffers.string_bytes.items),
            .workspace => pkg.resolution.value.workspace.slice(this.buffers.string_bytes.items),
            else => "",
        };
        
        try this.buffers.dependencies.append(allocator, Dependency{
            .name_hash = dep_name_hash,
            .name = dep_name_in_buf,
            .version = Dependency.Version{
                .tag = .npm,
                .literal = try string_buf.append(version_str),
                .value = .{ .npm = .{
                    .name = dep_name_in_buf,
                    .version = Semver.Query.Group{
                        .allocator = allocator,
                        .input = version_str,
                    },
                    .is_alias = false,
                } },
            },
            .behavior = Dependency.Behavior{ .prod = true },
        });
        
        try all_dep_list.append(dep_id);
        
        
        // Add resolution
        try this.buffers.resolutions.append(allocator, pkg_id);
    }
    
    // Now handle root dependencies separately
    var root_dep_list = std.ArrayList(DependencyID).init(allocator);
    defer root_dep_list.deinit();
    
    for (root_dependencies.items) |root_dep| {
        // Find the package ID for this dependency
        var found_package_id: ?Install.PackageID = null;
        const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ root_dep.name, root_dep.version });
        defer allocator.free(dep_spec);
        
        for (yarn_lock.entries.items, 0..) |entry, idx| {
            for (entry.specs) |spec| {
                if (strings.eql(spec, dep_spec)) {
                    found_package_id = yarn_entry_to_package_id[idx];
                    break;
                }
            }
            if (found_package_id != null) break;
        }
        
        if (found_package_id) |pkg_id| {
            // Use the already-created dependency for this package
            if (package_to_dep_id.get(pkg_id)) |dep_id| {
                try root_dep_list.append(dep_id);
            }
        }
    }
    
    // Clear the root tree dependencies first (they were incorrectly set to all packages)
    this.buffers.trees.items[0].dependencies = .{ .off = 0, .len = 0 };
    
    // Update root tree to include ALL dependencies (flat structure)
    
    if (all_dep_list.items.len > 0) {
        const all_deps_off = @as(u32, @intCast(hoisted_off));
        for (all_dep_list.items) |dep_id| {
            try this.buffers.hoisted_dependencies.append(allocator, dep_id);
        }
        // Set root tree dependencies to all packages
        this.buffers.trees.items[0].dependencies = .{
            .off = all_deps_off,
            .len = @as(u32, @intCast(all_dep_list.items.len)),
        };
        
        hoisted_off += @as(u32, @intCast(all_dep_list.items.len));
    }
    
    // Update root package dependencies (only direct dependencies)
    if (root_dep_list.items.len > 0) {
        const root_deps_off = @as(u32, @intCast(this.buffers.dependencies.items.len));
        // Create separate dependency entries for root package
        for (root_dependencies.items) |root_dep| {
            _ = @as(DependencyID, @intCast(this.buffers.dependencies.items.len));
            
            // Create root dependency with original name (not scoped)
            const name_hash = stringHash(root_dep.name);
            const version_literal = try string_buf.append(root_dep.version);
            
            try this.buffers.dependencies.append(allocator, Dependency{
                .name_hash = name_hash,
                .name = try string_buf.appendWithHash(root_dep.name, name_hash),
                .version = Dependency.Version{
                    .tag = if (YarnLock.Entry.isFileDependency(root_dep.version))
                        .folder
                    else if (YarnLock.Entry.isWorkspaceDependency(root_dep.version))
                        .workspace
                    else
                        .npm,
                    .literal = version_literal,
                    .value = if (YarnLock.Entry.isFileDependency(root_dep.version))
                        .{ .folder = if (strings.startsWith(root_dep.version, "file:")) 
                            try string_buf.append(root_dep.version[5..])
                        else
                            try string_buf.append(root_dep.version) }
                    else if (YarnLock.Entry.isWorkspaceDependency(root_dep.version))
                        .{ .workspace = try string_buf.append(root_dep.version) }
                    else
                        .{ .npm = .{
                            .name = try string_buf.append(root_dep.name),
                            .version = Semver.Query.Group{
                                .allocator = allocator,
                                .input = root_dep.version,
                            },
                            .is_alias = false,
                        } },
                },
                .behavior = if (root_dep.is_dev)
                    Dependency.Behavior{ .dev = true }
                else
                    Dependency.Behavior{ .prod = true },
            });
            
            // Find and add resolution
            const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ root_dep.name, root_dep.version });
            defer allocator.free(dep_spec);
            
            var found_package_id: ?Install.PackageID = null;
            for (yarn_lock.entries.items, 0..) |entry, idx| {
                for (entry.specs) |spec| {
                    if (strings.eql(spec, dep_spec)) {
                        found_package_id = yarn_entry_to_package_id[idx];
                        break;
                    }
                }
                if (found_package_id != null) break;
            }
            
            if (found_package_id) |pkg_id| {
                try this.buffers.resolutions.append(allocator, pkg_id);
            } else {
                try this.buffers.resolutions.append(allocator, Install.invalid_package_id);
            }
        }
        
        packages_slice.items(.dependencies)[0] = .{
            .off = root_deps_off,
            .len = @as(u32, @intCast(root_dependencies.items.len)),
        };
    }
    
    // Update hoisted dependencies buffer length
    this.buffers.hoisted_dependencies.items.len = hoisted_off;
    
    // Parse overrides/resolutions from package.json if it exists
    if (std.fs.cwd().readFileAlloc(allocator, package_json_file_path, 1024 * 1024)) |content| {
        defer allocator.free(content);
        
        const source = logger.Source.initPathString(package_json_file_path, content);
        if (JSON.parsePackageJSONUTF8(&source, log, allocator)) |json| {
            // Use OverrideMap.parseAppend to handle resolutions properly
            var root_package = this.packages.get(0);
            var string_builder = this.stringBuilder();
            
            try this.overrides.parseAppend(
                manager,
                this,
                &root_package,
                log,
                &source,
                json,
                &string_builder
            );
            
            if (Environment.isDebug and this.overrides.map.count() > 0) {
                bun.Output.prettyErrorln("DEBUG: Parsed {} overrides from package.json", .{this.overrides.map.count()});
            }
        } else |_| {
            // Failed to parse JSON, continue without overrides
        }
    } else |_| {
        // No package.json found, continue without overrides
    }
    
    // Skip full dependency resolution for yarn migration to avoid DependencyLoop errors
    // The tree structure created above is sufficient for bun.lock export

    if (Environment.allow_assert) {
        try this.verifyData();
    }

    this.meta_hash = try this.generateMetaHash(false, this.packages.len);

    const result = LoadResult{ .ok = .{
        .lockfile = this,
        .was_migrated = true,
        .loaded_from_binary_lockfile = false,
        .serializer_result = .{},
        .format = .binary,
    } };
    
    if (Environment.isDebug) {
        bun.Output.prettyErrorln("DEBUG: yarn.lock migration complete with {} packages", .{this.packages.len});
        
        // Check if scoped names are still there
        var lockfile_scoped_count: u32 = 0;
        for (this.packages.items(.name), 0..) |name, i| {
            const name_str = name.slice(this.buffers.string_bytes.items);
            if (strings.indexOf(name_str, "/") != null and !strings.startsWith(name_str, "@")) {
                lockfile_scoped_count += 1;
                if (lockfile_scoped_count <= 5) {
                    bun.Output.prettyErrorln("DEBUG: Scoped package at index {}: {s}", .{i, name_str});
                }
            }
        }
        bun.Output.prettyErrorln("DEBUG: Total scoped packages in final lockfile: {}", .{lockfile_scoped_count});
    }
    
    return result;
}
