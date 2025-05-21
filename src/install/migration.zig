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

const Semver = bun.Semver;
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

pub fn detectAndLoadOtherLockfile(
    this: *Lockfile,
    dir: bun.FD,
    manager: *Install.PackageManager,
    allocator: Allocator,
    log: *logger.Log,
) LoadResult {
    // check for package-lock.json, yarn.lock, etc...
    // if it exists, do an in-memory migration

    npm: {
        var timer = std.time.Timer.start() catch unreachable;
        const lockfile = File.openat(dir, "package-lock.json", bun.O.RDONLY, 0).unwrap() catch break :npm;
        defer lockfile.close();
        var lockfile_path_buf: bun.PathBuffer = undefined;
        const lockfile_path = bun.getFdPathZ(lockfile.handle, &lockfile_path_buf) catch break :npm;
        const data = lockfile.readToEnd(allocator).unwrap() catch break :npm;
        const migrate_result = migrateNPMLockfile(this, manager, allocator, log, data, lockfile_path) catch |err| {
            if (err == error.NPMLockfileVersionMismatch) {
                Output.prettyErrorln(
                    \\<red><b>error<r><d>:<r> Please upgrade package-lock.json to lockfileVersion 2 or 3
                    \\
                    \\Run 'npm i --lockfile-version 3 --frozen-lockfile' to upgrade your lockfile without changing dependencies.
                , .{});
                Global.exit(1);
            }
            if (Environment.isDebug) {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());

                Output.prettyErrorln("Error: {s}", .{@errorName(err)});
                log.print(Output.errorWriter()) catch {};
                Output.prettyErrorln("Invalid NPM package-lock.json\nIn a release build, this would ignore and do a fresh install.\nAborting", .{});
                Global.exit(1);
            }
            return LoadResult{ .err = .{
                .step = .migrating,
                .value = err,
                .lockfile_path = "package-lock.json",
                .format = .binary,
            } };
        };

        if (migrate_result == .ok) {
            Output.printElapsed(@as(f64, @floatFromInt(timer.read())) / std.time.ns_per_ms);
            Output.prettyError(" ", .{});
            Output.prettyErrorln("<d>migrated lockfile from <r><green>package-lock.json<r>", .{});
            Output.flush();
        }

        return migrate_result;
    }

    return LoadResult{ .not_found = {} };
}

const ResolvedURLsMap = bun.StringHashMapUnmanaged(string);

const IdMap = bun.StringHashMapUnmanaged(IdMapValue);
const IdMapValue = struct {
    /// index into the old package-lock.json package entries.
    old_json_index: u32,
    /// this is the new package id for the bun lockfile
    ///
    /// - if this new_package_id is set to `package_id_is_link`, it means it's a link
    /// and to get the actual package id, you need to lookup `.resolved` in the hashmap.
    /// - if it is `package_id_is_bundled`, it means it's a bundled dependency that was not
    /// marked by npm, which can happen to some transitive dependencies.
    new_package_id: u32,
};
const package_id_is_link = std.math.maxInt(u32);
const package_id_is_bundled = std.math.maxInt(u32) - 1;

const unset_package_id = Install.invalid_package_id - 1;

const dependency_keys = .{
    .dependencies,
    .devDependencies,
    .peerDependencies,
    .optionalDependencies,
};

pub fn migrateNPMLockfile(
    this: *Lockfile,
    manager: *Install.PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    data: string,
    abs_path: string,
) !LoadResult {
    debug("begin lockfile migration", .{});

    this.initEmpty(allocator);
    Install.initializeStore();

    const json_src = logger.Source.initPathString(abs_path, data);
    const json = bun.JSON.parseUTF8(&json_src, log, allocator) catch return error.InvalidNPMLockfile;

    if (json.data != .e_object) {
        return error.InvalidNPMLockfile;
    }
    if (json.get("lockfileVersion")) |version| {
        if (!(version.data == .e_number and
            version.data.e_number.value >= 2 and
            version.data.e_number.value <= 3))
        {
            return error.NPMLockfileVersionMismatch;
        }
    } else {
        return error.InvalidNPMLockfile;
    }

    bun.Analytics.Features.lockfile_migration_from_package_lock += 1;

    // Count pass

    var root_package: *E.Object = undefined;
    var packages_properties = brk: {
        const obj = json.get("packages") orelse return error.InvalidNPMLockfile;
        if (obj.data != .e_object) return error.InvalidNPMLockfile;
        if (obj.data.e_object.properties.len == 0) return error.InvalidNPMLockfile;
        const prop1 = obj.data.e_object.properties.at(0);
        if (prop1.key) |k| {
            if (k.data != .e_string) return error.InvalidNPMLockfile;
            // first key must be the "", self reference
            if (k.data.e_string.data.len != 0) return error.InvalidNPMLockfile;
            if (prop1.value.?.data != .e_object) return error.InvalidNPMLockfile;
            root_package = prop1.value.?.data.e_object;
        } else return error.InvalidNPMLockfile;
        break :brk obj.data.e_object.properties;
    };

    var num_deps: u32 = 0;

    const workspace_map: ?Lockfile.Package.WorkspaceMap = workspace_map: {
        if (root_package.get("workspaces")) |wksp| {
            var workspaces = Lockfile.Package.WorkspaceMap.init(allocator);

            const json_array = switch (wksp.data) {
                .e_array => |arr| arr,
                .e_object => |obj| if (obj.get("packages")) |packages| switch (packages.data) {
                    .e_array => |arr| arr,
                    else => return error.InvalidNPMLockfile,
                } else return error.InvalidNPMLockfile,
                else => return error.InvalidNPMLockfile,
            };

            // due to package paths and resolved properties for links and workspaces always having
            // forward slashes, we depend on `processWorkspaceNamesArray` to always return workspace
            // paths with forward slashes on windows
            const workspace_packages_count = try Lockfile.Package.processWorkspaceNamesArray(
                &workspaces,
                allocator,
                &manager.workspace_package_json_cache,
                log,
                json_array,
                &json_src,
                wksp.loc,
                null,
            );
            debug("found {d} workspace packages", .{workspace_packages_count});
            num_deps += workspace_packages_count;
            break :workspace_map workspaces;
        }
        break :workspace_map null;
    };

    // constructed "resolved" urls
    var resolved_urls = ResolvedURLsMap{};
    defer {
        var itr = resolved_urls.iterator();
        while (itr.next()) |entry| {
            allocator.free(entry.value_ptr.*);
        }
        resolved_urls.deinit(allocator);
    }

    // Counting Phase
    // This "IdMap" is used to make object key lookups faster for the `packages` object
    // it also lets us resolve linked and bundled packages.
    var id_map = IdMap{};
    try id_map.ensureTotalCapacity(allocator, packages_properties.len);
    var num_extern_strings: u32 = 0;
    var package_idx: u32 = 0;
    for (packages_properties.slice(), 0..) |entry, i| {
        const pkg_path = entry.key.?.asString(allocator).?;
        if (entry.value.?.data != .e_object)
            return error.InvalidNPMLockfile;

        const pkg = entry.value.?.data.e_object;

        if (pkg.get("link") != null) {
            id_map.putAssumeCapacity(
                pkg_path,
                IdMapValue{
                    .old_json_index = @truncate(i),
                    .new_package_id = package_id_is_link,
                },
            );
            continue;
        }
        if (pkg.get("inBundle")) |x| if (x.data == .e_boolean and x.data.e_boolean.value) {
            id_map.putAssumeCapacity(
                pkg_path,
                IdMapValue{
                    .old_json_index = @truncate(i),
                    .new_package_id = package_id_is_bundled,
                },
            );
            continue;
        };
        if (pkg.get("extraneous")) |x| if (x.data == .e_boolean and x.data.e_boolean.value) {
            continue;
        };

        id_map.putAssumeCapacity(
            pkg_path,
            IdMapValue{
                .old_json_index = @truncate(i),
                .new_package_id = package_idx,
            },
        );
        package_idx += 1;

        inline for (dependency_keys) |dep_key| {
            if (pkg.get(@tagName(dep_key))) |deps| {
                if (deps.data != .e_object) {
                    return error.InvalidNPMLockfile;
                }
                num_deps +|= @as(u32, deps.data.e_object.properties.len);
            }
        }

        if (pkg.get("bin")) |bin| {
            if (bin.data != .e_object) return error.InvalidNPMLockfile;
            switch (bin.data.e_object.properties.len) {
                0 => return error.InvalidNPMLockfile,
                1 => {},
                else => {
                    num_extern_strings += @truncate(bin.data.e_object.properties.len * 2);
                },
            }
        }

        if (pkg.get("resolved") == null) {
            const version_prop = pkg.get("version");
            const pkg_name = packageNameFromPath(pkg_path);
            if (version_prop != null and pkg_name.len > 0) {
                // construct registry url
                const registry = manager.scopeForPackageName(pkg_name);
                var count: usize = 0;
                count += registry.url.href.len + pkg_name.len + "/-/".len;
                if (pkg_name[0] == '@') {
                    // scoped
                    const slash_index = strings.indexOfChar(pkg_name, '/') orelse return error.InvalidNPMLockfile;
                    if (slash_index >= pkg_name.len - 1) return error.InvalidNPMLockfile;
                    count += pkg_name[slash_index + 1 ..].len;
                } else {
                    count += pkg_name.len;
                }
                const version_str = version_prop.?.asString(allocator) orelse return error.InvalidNPMLockfile;
                count += "-.tgz".len + version_str.len;

                const resolved_url = allocator.alloc(u8, count) catch unreachable;
                var remain = resolved_url;
                @memcpy(remain[0..registry.url.href.len], registry.url.href);
                remain = remain[registry.url.href.len..];
                @memcpy(remain[0..pkg_name.len], pkg_name);
                remain = remain[pkg_name.len..];
                remain[0.."/-/".len].* = "/-/".*;
                remain = remain["/-/".len..];
                if (pkg_name[0] == '@') {
                    const slash_index = strings.indexOfChar(pkg_name, '/') orelse unreachable;
                    @memcpy(remain[0..pkg_name[slash_index + 1 ..].len], pkg_name[slash_index + 1 ..]);
                    remain = remain[pkg_name[slash_index + 1 ..].len..];
                } else {
                    @memcpy(remain[0..pkg_name.len], pkg_name);
                    remain = remain[pkg_name.len..];
                }
                remain[0] = '-';
                remain = remain[1..];
                @memcpy(remain[0..version_str.len], version_str);
                remain = remain[version_str.len..];
                remain[0..".tgz".len].* = ".tgz".*;

                try resolved_urls.put(allocator, pkg_path, resolved_url);
            }
        }
    }
    if (num_deps == std.math.maxInt(u32)) return error.InvalidNPMLockfile; // lol

    debug("counted {d} dependencies", .{num_deps});
    debug("counted {d} extern strings", .{num_extern_strings});
    debug("counted {d} packages", .{package_idx});

    try this.buffers.dependencies.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.resolutions.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.extern_strings.ensureTotalCapacity(allocator, num_extern_strings);
    try this.packages.ensureTotalCapacity(allocator, package_idx);
    // The package index is overallocated, but we know the upper bound
    try this.package_index.ensureTotalCapacity(package_idx);

    // dependency on `resolved`, a dependencies version tag might change, requiring
    // new strings to be allocated.
    var string_buf = this.stringBuf();

    if (workspace_map) |wksp| {
        try this.workspace_paths.ensureTotalCapacity(allocator, wksp.map.unmanaged.entries.len);
        try this.workspace_versions.ensureTotalCapacity(allocator, wksp.map.unmanaged.entries.len);

        for (wksp.map.keys(), wksp.map.values()) |k, v| {
            const name_hash = stringHash(v.name);

            if (comptime Environment.allow_assert) {
                bun.assert(!strings.containsChar(k, '\\'));
            }

            this.workspace_paths.putAssumeCapacity(name_hash, try string_buf.append(k));

            if (v.version) |version_string| {
                const sliced_version = Semver.SlicedString.init(version_string, version_string);
                const result = Semver.Version.parse(sliced_version);
                if (result.valid and result.wildcard == .none) {
                    this.workspace_versions.putAssumeCapacity(name_hash, result.version.min());
                }
            }
        }
    }

    // Package Building Phase
    // This initializes every package and sets the resolution to uninitialized
    for (packages_properties.slice()) |entry| {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        const pkg = entry.value.?.data.e_object;

        const pkg_path = entry.key.?.asString(allocator).?;

        if (pkg.get("link")) |link| {
            if (workspace_map) |wksp| {
                if (link.data != .e_boolean) continue;
                if (link.data.e_boolean.value) {
                    if (pkg.get("resolved")) |resolved| {
                        if (resolved.data != .e_string) continue;
                        const resolved_str = resolved.asString(allocator).?;
                        if (wksp.map.get(resolved_str)) |wksp_entry| {
                            const pkg_name = packageNameFromPath(pkg_path);
                            if (!strings.eqlLong(wksp_entry.name, pkg_name, true)) {
                                const pkg_name_hash = stringHash(pkg_name);
                                const path_entry = this.workspace_paths.getOrPut(allocator, pkg_name_hash) catch bun.outOfMemory();
                                if (!path_entry.found_existing) {
                                    // Package resolve path is an entry in the workspace map, but
                                    // the package name is different. This package doesn't exist
                                    // in node_modules, but we still allow packages to resolve to it's
                                    // resolution.
                                    path_entry.value_ptr.* = try string_buf.append(resolved_str);

                                    if (wksp_entry.version) |version_string| {
                                        const sliced_version = Semver.SlicedString.init(version_string, version_string);
                                        const result = Semver.Version.parse(sliced_version);
                                        if (result.valid and result.wildcard == .none) {
                                            this.workspace_versions.put(allocator, pkg_name_hash, result.version.min()) catch bun.outOfMemory();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            continue;
        }

        if (if (pkg.get("inBundle") orelse pkg.get("extraneous")) |x| x.data == .e_boolean and x.data.e_boolean.value else false) continue;

        const workspace_entry = if (workspace_map) |map| map.map.get(pkg_path) else null;
        const is_workspace = workspace_entry != null;

        const pkg_name = if (is_workspace)
            workspace_entry.?.name
        else if (pkg.get("name")) |set_name|
            (set_name.asString(this.allocator) orelse unreachable)
        else
            packageNameFromPath(pkg_path);

        const name_hash = stringHash(pkg_name);

        const package_id: Install.PackageID = @intCast(this.packages.len);
        if (Environment.allow_assert) {
            // If this is false, then it means we wrote wrong resolved ids
            // During counting phase we assign all the packages an id.
            bun.assert(package_id == id_map.get(pkg_path).?.new_package_id);
        }

        // Instead of calling this.appendPackage, manually append
        // the other function has some checks that will fail since we have not set resolution+dependencies yet.
        this.packages.appendAssumeCapacity(Lockfile.Package{
            .name = try string_buf.appendWithHash(pkg_name, name_hash),
            .name_hash = name_hash,

            // For non workspace packages these are set to .uninitialized, then in the third phase
            // they are resolved. This is because the resolution uses the dependant's version
            // specifier as a "hint" to resolve the dependency.
            .resolution = if (is_workspace) Resolution.init(.{
                .workspace = try string_buf.append(pkg_path),
            }) else Resolution{},

            // we fill this data in later
            .dependencies = undefined,
            .resolutions = undefined,

            .meta = .{
                .id = package_id,

                .origin = if (package_id == 0) .local else .npm,

                .arch = if (pkg.get("cpu")) |cpu_array| arch: {
                    var arch = Npm.Architecture.none.negatable();
                    if (cpu_array.data != .e_array) return error.InvalidNPMLockfile;
                    if (cpu_array.data.e_array.items.len == 0) {
                        break :arch arch.combine();
                    }

                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data != .e_string) return error.InvalidNPMLockfile;
                        arch.apply(item.data.e_string.data);
                    }
                    break :arch arch.combine();
                } else .all,

                .os = if (pkg.get("os")) |cpu_array| arch: {
                    var os = Npm.OperatingSystem.none.negatable();
                    if (cpu_array.data != .e_array) return error.InvalidNPMLockfile;
                    if (cpu_array.data.e_array.items.len == 0) {
                        break :arch .all;
                    }

                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data != .e_string) return error.InvalidNPMLockfile;
                        os.apply(item.data.e_string.data);
                    }
                    break :arch os.combine();
                } else .all,

                .man_dir = String{},

                .has_install_script = if (pkg.get("hasInstallScript")) |has_install_script_expr| brk: {
                    if (has_install_script_expr.data != .e_boolean) return error.InvalidNPMLockfile;
                    break :brk if (has_install_script_expr.data.e_boolean.value)
                        .true
                    else
                        .false;
                } else .false,

                .integrity = if (pkg.get("integrity")) |integrity|
                    Integrity.parse(
                        integrity.asString(this.allocator) orelse
                            return error.InvalidNPMLockfile,
                    )
                else
                    Integrity{},
            },
            .bin = if (pkg.get("bin")) |bin| bin: {
                // we already check these conditions during counting
                bun.assert(bin.data == .e_object);
                bun.assert(bin.data.e_object.properties.len > 0);

                // in npm lockfile, the bin is always an object, even if it is only a single one
                // we need to detect if it's a single entry and lower it to a file.
                if (bin.data.e_object.properties.len == 1) {
                    const prop = bin.data.e_object.properties.at(0);
                    const key = prop.key.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    const script_value = prop.value.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;

                    if (strings.eql(key, pkg_name)) {
                        break :bin .{
                            .tag = .file,
                            .value = Bin.Value.init(.{
                                .file = try string_buf.append(script_value),
                            }),
                        };
                    }

                    break :bin .{
                        .tag = .named_file,
                        .value = Bin.Value.init(.{
                            .named_file = .{
                                try string_buf.append(key),
                                try string_buf.append(script_value),
                            },
                        }),
                    };
                }

                const view: Install.ExternalStringList = .{
                    .off = @truncate(this.buffers.extern_strings.items.len),
                    .len = @intCast(bin.data.e_object.properties.len * 2),
                };

                for (bin.data.e_object.properties.slice()) |bin_entry| {
                    const key = bin_entry.key.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    const script_value = bin_entry.value.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    this.buffers.extern_strings.appendAssumeCapacity(try string_buf.appendExternal(key));
                    this.buffers.extern_strings.appendAssumeCapacity(try string_buf.appendExternal(script_value));
                }

                if (Environment.allow_assert) {
                    bun.assert(this.buffers.extern_strings.items.len == view.off + view.len);
                    bun.assert(this.buffers.extern_strings.items.len <= this.buffers.extern_strings.capacity);
                }

                break :bin .{
                    .tag = .map,
                    .value = Bin.Value.init(.{
                        .map = view,
                    }),
                };
            } else Bin.init(),

            .scripts = .{},
        });

        if (is_workspace) {
            bun.assert(package_id != 0); // root package should not be in it's own workspace

            // we defer doing getOrPutID for non-workspace packages because it depends on the resolution being set.
            try this.getOrPutID(package_id, name_hash);
        }
    }

    if (Environment.allow_assert) {
        bun.assert(this.packages.len == package_idx);
    }

    // ignoring length check because we pre-allocated it. the length may shrink later
    // so it's faster if we ignore the underlying length buffer and just assign it at the very end.
    var dependencies_buf = this.buffers.dependencies.items.ptr[0..num_deps];
    var resolutions_buf = this.buffers.resolutions.items.ptr[0..num_deps];

    // pre-initialize the dependencies and resolutions to `unset_package_id`
    if (Environment.allow_assert) {
        @memset(dependencies_buf, Dependency{});
        @memset(resolutions_buf, unset_package_id);
    }

    var resolutions = this.packages.items(.resolution);
    var metas = this.packages.items(.meta);
    var dependencies_list = this.packages.items(.dependencies);
    var resolution_list = this.packages.items(.resolutions);

    if (Environment.allow_assert) {
        for (resolutions) |r| {
            bun.assert(r.tag == .uninitialized or r.tag == .workspace);
        }
    }

    // Root resolution isn't hit through dependency tracing.
    resolutions[0] = Resolution.init(.{ .root = {} });
    metas[0].origin = .local;
    try this.getOrPutID(0, this.packages.items(.name_hash)[0]);

    // made it longer than max path just in case something stupid happens
    var name_checking_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

    // Dependency Linking Phase
    package_idx = 0;
    var is_first = true;
    for (packages_properties.slice()) |entry| {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        const pkg = entry.value.?.data.e_object;

        if (pkg.get("link") != null or if (pkg.get("inBundle") orelse pkg.get("extraneous")) |x| x.data == .e_boolean and x.data.e_boolean.value else false) continue;

        const pkg_path = entry.key.?.asString(allocator).?;

        const dependencies_start = dependencies_buf.ptr;
        const resolutions_start = resolutions_buf.ptr;

        // this is in a defer because there are two places we end this loop iteration at.
        defer {
            if (dependencies_start == dependencies_buf.ptr) {
                dependencies_list[package_idx] = .{ .len = 0 };
                resolution_list[package_idx] = .{ .len = 0 };
            } else {
                // Calculate the offset + length by pointer arithmetic
                const len: u32 = @truncate((@intFromPtr(resolutions_buf.ptr) - @intFromPtr(resolutions_start)) / @sizeOf(Install.PackageID));
                if (Environment.allow_assert) {
                    bun.assert(len > 0);
                    bun.assert(len == ((@intFromPtr(dependencies_buf.ptr) - @intFromPtr(dependencies_start)) / @sizeOf(Dependency)));
                }
                dependencies_list[package_idx] = .{
                    .off = @truncate((@intFromPtr(dependencies_start) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency)),
                    .len = len,
                };
                resolution_list[package_idx] = .{
                    .off = @truncate((@intFromPtr(resolutions_start) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID)),
                    .len = len,
                };
            }

            package_idx += 1;
        }

        // a feature no one has heard about: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bundledependencies
        const bundled_dependencies = if (pkg.get("bundleDependencies") orelse pkg.get("bundledDependencies")) |expr| deps: {
            if (expr.data == .e_boolean) {
                if (expr.data.e_boolean.value) continue;
                break :deps null;
            }
            if (expr.data != .e_array) return error.InvalidNPMLockfile;
            const arr: *E.Array = expr.data.e_array;
            var map = bun.StringArrayHashMapUnmanaged(void){};
            try map.ensureTotalCapacity(allocator, arr.items.len);
            for (arr.items.slice()) |item| {
                map.putAssumeCapacity(item.asString(allocator) orelse return error.InvalidNPMLockfile, {});
            }
            break :deps map;
        } else null;

        if (is_first) {
            is_first = false;
            if (workspace_map) |wksp| {
                for (wksp.keys(), wksp.values()) |key, value| {
                    const entry1 = id_map.get(key) orelse return error.InvalidNPMLockfile;
                    const name_hash = stringHash(value.name);
                    const wksp_name = try string_buf.append(value.name);
                    const wksp_path = try string_buf.append(key);
                    dependencies_buf[0] = Dependency{
                        .name = wksp_name,
                        .name_hash = name_hash,
                        .version = .{
                            .tag = .workspace,
                            .literal = wksp_path,
                            .value = .{
                                .workspace = wksp_path,
                            },
                        },
                        .behavior = .{ .workspace = true },
                    };
                    resolutions_buf[0] = entry1.new_package_id;

                    dependencies_buf = dependencies_buf[1..];
                    resolutions_buf = resolutions_buf[1..];
                }
            }
        }

        inline for (dependency_keys) |dep_key| {
            if (pkg.get(@tagName(dep_key))) |deps| {
                // fetch the peerDependenciesMeta if it exists
                // this is only done for peerDependencies, obviously
                const peer_dep_meta = if (dep_key == .peerDependencies)
                    if (pkg.get("peerDependenciesMeta")) |expr| peer_dep_meta: {
                        if (expr.data != .e_object) return error.InvalidNPMLockfile;
                        break :peer_dep_meta expr.data.e_object;
                    } else null
                else
                    void{};

                if (deps.data != .e_object) return error.InvalidNPMLockfile;
                const properties = deps.data.e_object.properties;

                dep_loop: for (properties.slice()) |prop| {
                    const name_bytes = prop.key.?.asString(this.allocator).?;
                    if (bundled_dependencies != null and bundled_dependencies.?.getIndex(name_bytes) != null) continue :dep_loop;

                    const version_bytes = prop.value.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    const name_hash = stringHash(name_bytes);
                    const dep_name = try string_buf.appendWithHash(name_bytes, name_hash);

                    const dep_version = try string_buf.append(version_bytes);
                    const sliced = dep_version.sliced(string_buf.bytes.items);

                    debug("parsing {s}, {s}\n", .{ name_bytes, version_bytes });
                    const version = Dependency.parse(
                        this.allocator,
                        dep_name,
                        name_hash,
                        sliced.slice,
                        &sliced,
                        log,
                        manager,
                    ) orelse {
                        return error.InvalidNPMLockfile;
                    };
                    debug("-> {s}, {}\n", .{ @tagName(version.tag), version.value });

                    if (Environment.allow_assert) {
                        bun.assert(version.tag != .uninitialized);
                    }

                    const str_node_modules = if (pkg_path.len == 0) "node_modules/" else "/node_modules/";
                    const suffix_len = str_node_modules.len + name_bytes.len;

                    var buf_len: u32 = @as(u32, @intCast(pkg_path.len + suffix_len));
                    if (buf_len > name_checking_buf.len) {
                        return error.PathTooLong;
                    }

                    bun.copy(u8, name_checking_buf[0..pkg_path.len], pkg_path);
                    bun.copy(u8, name_checking_buf[pkg_path.len .. pkg_path.len + str_node_modules.len], str_node_modules);
                    bun.copy(u8, name_checking_buf[pkg_path.len + str_node_modules.len .. pkg_path.len + suffix_len], name_bytes);

                    while (true) {
                        debug("checking {s}", .{name_checking_buf[0..buf_len]});
                        if (id_map.get(name_checking_buf[0..buf_len])) |found_| {
                            var found = found_;
                            if (found.new_package_id == package_id_is_link) {
                                // it is a workspace package, resolve from the "link": true entry to the real entry.
                                const ref_pkg = packages_properties.at(found.old_json_index).value.?.data.e_object;
                                // the `else` here is technically possible to hit
                                const resolved_v = ref_pkg.get("resolved") orelse return error.LockfileWorkspaceMissingResolved;
                                const resolved = resolved_v.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                                found = (id_map.get(resolved) orelse return error.InvalidNPMLockfile);
                            } else if (found.new_package_id == package_id_is_bundled) {
                                debug("skipping bundled dependency {s}", .{name_bytes});
                                continue :dep_loop;
                            }

                            const id = found.new_package_id;

                            const is_workspace = resolutions[id].tag == .workspace;

                            dependencies_buf[0] = Dependency{
                                .name = dep_name,
                                .name_hash = name_hash,
                                .version = version,
                                .behavior = .{
                                    .prod = dep_key == .dependencies,
                                    .optional = dep_key == .optionalDependencies,
                                    .dev = dep_key == .devDependencies,
                                    .peer = dep_key == .peerDependencies,
                                    .workspace = is_workspace,
                                },
                            };
                            resolutions_buf[0] = id;

                            dependencies_buf = dependencies_buf[1..];
                            resolutions_buf = resolutions_buf[1..];

                            // If the package resolution is not set, resolve the target package
                            // using the information we have from the dependency declaration.
                            if (resolutions[id].tag == .uninitialized) {
                                debug("resolving '{s}'", .{name_bytes});

                                var res_version = version;

                                const res = resolved: {
                                    const dep_pkg = packages_properties.at(found.old_json_index).value.?.data.e_object;
                                    const dep_resolved: string = dep_resolved: {
                                        if (dep_pkg.get("resolved")) |resolved| {
                                            const dep_resolved = resolved.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                                            switch (Dependency.Version.Tag.infer(dep_resolved)) {
                                                .git, .github => |tag| {
                                                    const dep_resolved_str = try string_buf.append(dep_resolved);
                                                    const dep_resolved_sliced = dep_resolved_str.sliced(string_buf.bytes.items);
                                                    res_version = Dependency.parseWithTag(
                                                        this.allocator,
                                                        dep_name,
                                                        name_hash,
                                                        dep_resolved_sliced.slice,
                                                        tag,
                                                        &dep_resolved_sliced,
                                                        log,
                                                        manager,
                                                    ) orelse return error.InvalidNPMLockfile;

                                                    break :dep_resolved dep_resolved;
                                                },
                                                // TODO(dylan-conway): might need to handle more cases
                                                else => break :dep_resolved dep_resolved,
                                            }
                                        }

                                        if (version.tag == .npm) {
                                            if (resolved_urls.get(name_checking_buf[0..buf_len])) |resolved_url| {
                                                break :dep_resolved resolved_url;
                                            }
                                        }

                                        break :resolved Resolution.init(.{
                                            .folder = try string_buf.append(packages_properties.at(found.old_json_index).key.?.asString(allocator).?),
                                        });
                                    };

                                    break :resolved switch (res_version.tag) {
                                        .uninitialized => std.debug.panic("Version string {s} resolved to `.uninitialized`", .{version_bytes}),

                                        // npm does not support catalogs
                                        .catalog => return error.InvalidNPMLockfile,

                                        .npm, .dist_tag => res: {
                                            // It is theoretically possible to hit this in a case where the resolved dependency is NOT
                                            // an npm dependency, but that case is so convoluted that it is not worth handling.
                                            //
                                            // Deleting 'package-lock.json' would completely break the installation of the project.
                                            //
                                            // We assume that the given URL is to *some* npm registry, or the resolution is to a workspace package.
                                            // If it is a workspace package, then this branch will not be hit as the resolution was already set earlier.
                                            const dep_actual_version = (dep_pkg.get("version") orelse return error.InvalidNPMLockfile)
                                                .asString(this.allocator) orelse return error.InvalidNPMLockfile;

                                            const dep_actual_version_str = try string_buf.append(dep_actual_version);
                                            const dep_actual_version_sliced = dep_actual_version_str.sliced(string_buf.bytes.items);

                                            break :res Resolution.init(.{
                                                .npm = .{
                                                    .url = try string_buf.append(dep_resolved),
                                                    .version = Semver.Version.parse(dep_actual_version_sliced).version.min(),
                                                },
                                            });
                                        },
                                        .tarball => if (strings.hasPrefixComptime(dep_resolved, "file:"))
                                            Resolution.init(.{ .local_tarball = try string_buf.append(dep_resolved[5..]) })
                                        else
                                            Resolution.init(.{ .remote_tarball = try string_buf.append(dep_resolved) }),
                                        .folder => Resolution.init(.{ .folder = try string_buf.append(dep_resolved) }),
                                        // not sure if this is possible to hit
                                        .symlink => Resolution.init(.{ .folder = try string_buf.append(dep_resolved) }),
                                        .workspace => workspace: {
                                            var input = (try string_buf.append(dep_resolved)).sliced(string_buf.bytes.items);
                                            if (strings.hasPrefixComptime(input.slice, "workspace:")) {
                                                input = input.sub(input.slice["workspace:".len..]);
                                            }
                                            break :workspace Resolution.init(.{
                                                .workspace = input.value(),
                                            });
                                        },
                                        .git => res: {
                                            const str = (if (strings.hasPrefixComptime(dep_resolved, "git+"))
                                                try string_buf.append(dep_resolved[4..])
                                            else
                                                try string_buf.append(dep_resolved))
                                                .sliced(string_buf.bytes.items);

                                            const hash_index = strings.lastIndexOfChar(str.slice, '#') orelse return error.InvalidNPMLockfile;

                                            const commit = str.sub(str.slice[hash_index + 1 ..]).value();
                                            break :res Resolution.init(.{
                                                .git = .{
                                                    .owner = res_version.value.git.owner,
                                                    .repo = str.sub(str.slice[0..hash_index]).value(),
                                                    .committish = commit,
                                                    .resolved = commit,
                                                    .package_name = dep_name,
                                                },
                                            });
                                        },
                                        .github => res: {
                                            const str = (if (strings.hasPrefixComptime(dep_resolved, "git+"))
                                                try string_buf.append(dep_resolved[4..])
                                            else
                                                try string_buf.append(dep_resolved))
                                                .sliced(string_buf.bytes.items);

                                            const hash_index = strings.lastIndexOfChar(str.slice, '#') orelse return error.InvalidNPMLockfile;

                                            const commit = str.sub(str.slice[hash_index + 1 ..]).value();
                                            break :res Resolution.init(.{
                                                .git = .{
                                                    .owner = res_version.value.github.owner,
                                                    .repo = str.sub(str.slice[0..hash_index]).value(),
                                                    .committish = commit,
                                                    .resolved = commit,
                                                    .package_name = dep_name,
                                                },
                                            });
                                        },
                                    };
                                };
                                debug("-> {}", .{res.fmtForDebug(string_buf.bytes.items)});

                                resolutions[id] = res;
                                metas[id].origin = switch (res.tag) {
                                    // This works?
                                    .root => .local,
                                    else => .npm,
                                };

                                try this.getOrPutID(id, this.packages.items(.name_hash)[id]);
                            }

                            continue :dep_loop;
                        }

                        // step down each `node_modules/` of the source
                        if (strings.lastIndexOf(name_checking_buf[0..buf_len -| ("node_modules/".len + name_bytes.len)], "node_modules/")) |idx| {
                            debug("found 'node_modules/' at {d}", .{idx});
                            buf_len = @intCast(idx + "node_modules/".len + name_bytes.len);
                            bun.copy(u8, name_checking_buf[idx + "node_modules/".len .. idx + "node_modules/".len + name_bytes.len], name_bytes);
                        } else if (!strings.hasPrefixComptime(name_checking_buf[0..buf_len], "node_modules/")) {
                            // this is hit if you are at something like `packages/etc`, from `packages/etc/node_modules/xyz`
                            // we need to hit the root `node_modules/{name}`
                            buf_len = @intCast("node_modules/".len + name_bytes.len);
                            bun.copy(u8, name_checking_buf[0..buf_len], "node_modules/");
                            bun.copy(u8, name_checking_buf[buf_len - name_bytes.len .. buf_len], name_bytes);
                        } else {
                            // optional peer dependencies can be ... optional
                            if (dep_key == .peerDependencies) {
                                if (peer_dep_meta) |o| if (o.get(name_bytes)) |meta| {
                                    if (meta.data != .e_object) return error.InvalidNPMLockfile;
                                    if (meta.data.e_object.get("optional")) |optional| {
                                        if (optional.data != .e_boolean) return error.InvalidNPMLockfile;
                                        if (optional.data.e_boolean.value) {
                                            dependencies_buf[0] = Dependency{
                                                .name = dep_name,
                                                .name_hash = name_hash,
                                                .version = version,
                                                .behavior = .{
                                                    .prod = dep_key == .dependencies,
                                                    .optional = true,
                                                    .dev = dep_key == .devDependencies,
                                                    .peer = dep_key == .peerDependencies,
                                                    .workspace = false,
                                                },
                                            };
                                            resolutions_buf[0] = Install.invalid_package_id;
                                            dependencies_buf = dependencies_buf[1..];
                                            resolutions_buf = resolutions_buf[1..];
                                            continue :dep_loop;
                                        }
                                    }
                                };
                            }

                            // it is technically possible to get a package-lock.json without a dependency.
                            // it's very unlikely, but possible. when NPM sees this, it essentially doesnt install the package, and treats it like it doesn't exist.
                            // in test/cli/install/migrate-fixture, you can observe this for `iconv-lite`
                            debug("could not find package '{s}' in '{s}'", .{ name_bytes, pkg_path });
                            continue :dep_loop;
                        }
                    }
                }
            }
        }
    }

    this.buffers.resolutions.items.len = (@intFromPtr(resolutions_buf.ptr) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID);
    this.buffers.dependencies.items.len = this.buffers.resolutions.items.len;

    // In allow_assert, we prefill this buffer with uninitialized values that we can detect later
    // It is our fault if we hit an error here, making it safe to disable in release.
    if (Environment.allow_assert) {
        bun.assert(this.buffers.dependencies.items.len == (@intFromPtr(dependencies_buf.ptr) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency));
        bun.assert(this.buffers.dependencies.items.len <= num_deps);
        var crash = false;
        for (this.buffers.dependencies.items, 0..) |r, i| {
            // 'if behavior is uninitialized'
            if (r.behavior.eq(.{})) {
                debug("dependency index '{d}' was not set", .{i});
                crash = true;
            }
        }
        for (this.buffers.resolutions.items, 0..) |r, i| {
            if (r == unset_package_id) {
                debug("resolution index '{d}' was not set", .{i});
                crash = true;
            }
        }
        if (crash) {
            std.debug.panic("Assertion failure, see above", .{});
        }
    }

    // A package not having a resolution, however, is not our fault.
    // This can be triggered by a bad lockfile with extra packages. NPM should trim packages out automatically.
    var is_missing_resolutions = false;
    for (resolutions, 0..) |r, i| {
        if (r.tag == .uninitialized) {
            Output.warn("Could not resolve package '{s}' in lockfile during migration", .{this.packages.items(.name)[i].slice(this.buffers.string_bytes.items)});
            is_missing_resolutions = true;
        } else if (Environment.allow_assert) {
            // Assertion from appendPackage. If we do this too early it will always fail as we dont have the resolution written
            // but after we write all the data, there is no excuse for this to fail.
            //
            // If this is hit, it means getOrPutID was not called on this package id. Look for where 'resolution[i]' is set
            bun.assert(this.getPackageID(this.packages.items(.name_hash)[i], null, &r) != null);
        }
    }
    if (is_missing_resolutions) {
        return error.NotAllPackagesGotResolved;
    }

    try this.resolve(log);

    // if (Environment.isDebug) {
    //     const dump_file = try std.fs.cwd().createFileZ("after-clean.json", .{});
    //     defer dump_file.close();
    //     try std.json.stringify(this, .{ .whitespace = .indent_2 }, dump_file.writer());
    // }

    if (Environment.allow_assert) {
        try this.verifyData();
    }

    this.meta_hash = try this.generateMetaHash(false, this.packages.len);

    return LoadResult{
        .ok = .{
            .lockfile = this,
            .was_migrated = true,
            .loaded_from_binary_lockfile = false,
            .serializer_result = .{},
            .format = .binary,
        },
    };
}

fn packageNameFromPath(pkg_path: []const u8) []const u8 {
    if (pkg_path.len == 0) return "";

    const pkg_name_start: usize = if (strings.lastIndexOf(pkg_path, "/node_modules/")) |last_index|
        last_index + "/node_modules/".len
    else if (strings.hasPrefixComptime(pkg_path, "node_modules/"))
        "node_modules/".len
    else
        strings.lastIndexOf(pkg_path, "/") orelse 0;

    return pkg_path[pkg_name_start..];
}
