const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const logger = bun.logger;

const Install = @import("./install.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const Npm = @import("./npm.zig");
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;

const Semver = @import("./semver.zig");
const String = Semver.String;
const ExternalString = Semver.ExternalString;
const stringHash = String.Builder.stringHash;

const Lockfile = @import("./lockfile.zig");
const LoadFromDiskResult = Lockfile.LoadFromDiskResult;

const JSAst = bun.JSAst;
const Expr = JSAst.Expr;
const B = JSAst.B;
const E = JSAst.E;
const G = JSAst.G;
const S = JSAst.S;

const debug = Output.scoped(.migrate, false);

pub fn detectAndLoadOtherLockfile(this: *Lockfile, allocator: Allocator, log: *logger.Log, dirname: string) LoadFromDiskResult {
    // check for package-lock.json, yarn.lock, etc...
    // if it exists, do an in-memory migration
    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    @memcpy(buf[0..dirname.len], dirname);

    npm: {
        const npm_lockfile_name = "package-lock.json";
        @memcpy(buf[dirname.len .. dirname.len + npm_lockfile_name.len], npm_lockfile_name);
        buf[dirname.len + npm_lockfile_name.len] = 0;
        const lockfile_path = buf[0 .. dirname.len + npm_lockfile_name.len :0];
        var timer = std.time.Timer.start() catch null;
        const file = std.fs.cwd().openFileZ(lockfile_path, .{ .mode = .read_only }) catch break :npm;
        defer file.close();
        var data = file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .migrating, .value = err } };
        };
        const lockfile = migrateNPMLockfile(this, allocator, log, data, lockfile_path) catch |err| {
            if (Environment.allow_assert) {
                if (@errorReturnTrace()) |trace| {
                    std.debug.dumpStackTrace(trace.*);
                    Output.prettyErrorln("Invalid NPM package-lock.json\nIn release build, this would continue and do a fresh install.\nDebug bun will exit now.", .{});
                    Global.exit(1);
                }
            }
            return LoadFromDiskResult{ .err = .{ .step = .migrating, .value = err } };
        };

        if (lockfile == .ok) {
            if (timer) |*t| {
                Output.printElapsed(@as(f64, @floatFromInt(t.read())) / std.time.ns_per_ms);
                Output.prettyError(" ", .{});
            }
            Output.prettyErrorln("<d>migrated lockfile from <r><green>package-lock.json<r>", .{});
            Output.flush();
        }

        return lockfile;
    }

    return LoadFromDiskResult{ .not_found = {} };
}

const IdMap = std.StringHashMapUnmanaged(IdMapValue);
const IdMapValue = packed struct {
    // index into the old package-lock.json package entries.
    old_json_index: u32,
    // if this new_package_id is set to std.math.maxInt(u32), it means it's a link
    // and to get the actual package id, you need to lookup `.resolved` in the hashmap.
    new_package_id: u32,
};
comptime {
    _ = std.debug.assert(@sizeOf(IdMapValue) == 8);
}

const dependency_keys = .{
    .dependencies,
    .devDependencies,
    .peerDependencies,
    .optionalDependencies,
};

pub fn migrateNPMLockfile(this: *Lockfile, allocator: Allocator, log: *logger.Log, data: string, path: string) !LoadFromDiskResult {
    debug("begin lockfile migration", .{});

    try this.initEmpty(allocator);
    Install.initializeStore();

    const json_src = logger.Source.initPathString(path, data);
    const json = try bun.JSON.ParseJSON(&json_src, log, allocator);

    if (json.data != .e_object) {
        return error.InvalidNPMPackageLockfile;
    }
    if (json.get("lockfileVersion")) |version| {
        if (!(version.data == .e_number and version.data.e_number.value == 3)) {
            return error.InvalidNPMPackageLockfile;
        }
    } else {
        return error.InvalidNPMPackageLockfile;
    }

    // Count pass
    var builder_ = this.stringBuilder();
    var builder = &builder_;
    const name = (if (json.get("name")) |expr| expr.asString(allocator) else null) orelse "";
    builder.count(name);

    var packages_properties = brk: {
        const obj = json.get("packages") orelse return error.InvalidNPMPackageLockfile;
        if (obj.data != .e_object) return error.InvalidNPMPackageLockfile;
        if (obj.data.e_object.properties.len == 0) return error.InvalidNPMPackageLockfile;
        if (obj.data.e_object.properties.at(0).key) |k| {
            if (k.data != .e_string) return error.InvalidNPMPackageLockfile;
            // first key must be the "", self reference
            if (k.data.e_string.data.len != 0) return error.InvalidNPMPackageLockfile;
        } else return error.InvalidNPMPackageLockfile;
        break :brk obj.data.e_object.properties;
    };

    // Counting Phase
    var id_map = IdMap{};
    try id_map.ensureTotalCapacity(allocator, packages_properties.len);
    var num_deps: u32 = 0;
    var num_extern_strings: u32 = 0;
    var package_idx: u32 = 0;
    for (packages_properties.slice(), 0..) |entry, i| {
        const pkg_path = entry.key.?.asString(allocator).?;
        if (entry.value.?.data != .e_object)
            return error.InvalidNPMPackageLockfile;

        const pkg = entry.value.?.data.e_object;
        if (pkg.get("link")) |_| {
            try id_map.put(
                allocator,
                pkg_path,
                IdMapValue{
                    .old_json_index = @truncate(i),
                    .new_package_id = std.math.maxInt(u32),
                },
            );
        }

        try id_map.put(
            allocator,
            pkg_path,
            IdMapValue{
                .old_json_index = @truncate(i),
                .new_package_id = package_idx,
            },
        );
        package_idx += 1;

        const pkg_name = if (entry.value.?.get("name")) |set_name|
            (set_name.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile)
        else package_name: {
            const pkg_name_start = strings.lastIndexOf(pkg_path, "/node_modules/") orelse if (strings.hasPrefixComptime(pkg_path, "node_modules/"))
                @as(u32, "node_modules/".len)
            else
                // this happens when you use a folder symlink as a package
                // we simply will not store the package name (it's not needed for anything)
                break :package_name "";

            break :package_name pkg_path[pkg_name_start..];
        };

        inline for (dependency_keys) |dep_key| {
            if (pkg.get(@tagName(dep_key))) |deps| {
                if (deps.data != .e_object) {
                    return error.InvalidNPMPackageLockfile;
                }
                num_deps +|= @as(u32, deps.data.e_object.properties.len);

                for (deps.data.e_object.properties.slice()) |dep| {
                    const dep_name = dep.key.?.asString(allocator).?;
                    const version_string = dep.value.?.asString(allocator) orelse return error.InvalidNPMPackageLockfile;

                    builder.count(dep_name);
                    builder.count(version_string);

                    // If it's a folder or workspace, pessimistically assume we will need a maximum path
                    switch (Dependency.Version.Tag.infer(version_string)) {
                        .folder, .workspace => builder.cap += bun.MAX_PATH_BYTES,
                        else => {},
                    }
                }
            }
        }

        if (pkg.get("bin")) |bin| {
            if (bin.data != .e_object) return error.InvalidNPMPackageLockfile;
            switch (bin.data.e_object.properties.len) {
                0 => return error.InvalidNPMPackageLockfile,
                1 => {
                    const first_bin = bin.data.e_object.properties.at(0);
                    const key = first_bin.key.?.asString(allocator).?;
                    if (!strings.eql(key, pkg_name)) {
                        builder.count(key);
                    }
                    builder.count(first_bin.value.?.asString(allocator) orelse return error.InvalidNPMPackageLockfile);
                },
                else => {
                    for (bin.data.e_object.properties.slice()) |bin_entry| {
                        builder.count(bin_entry.key.?.asString(allocator).?);
                        builder.count(bin_entry.value.?.asString(allocator) orelse return error.InvalidNPMPackageLockfile);
                    }
                    num_extern_strings += 2;
                },
            }
        }

        if (pkg.get("resolved")) |resolved_expr| {
            const resolved = resolved_expr.asString(allocator) orelse return error.InvalidNPMPackageLockfile;
            if (strings.hasPrefixComptime(resolved, "file:")) {
                builder.count(resolved[5..]);
            } else if (strings.hasPrefixComptime(resolved, "git+")) {
                builder.count(resolved[4..]);
            } else {
                builder.count(resolved);

                // this is over-counting but whatever. it would be too hard to determine if the case here
                // is an `npm`/`dist_tag` version (the only times this is actually used)
                if (pkg.get("version")) |v| if (v.asString(allocator)) |s| {
                    builder.count(s);
                };
            }
        }
    }
    if (num_deps == std.math.maxInt(u32)) return error.TooManyDependencies; // lol

    debug("counted {d} dependencies", .{num_deps});
    debug("counted {d} extern strings", .{num_extern_strings});
    debug("counted {d} packages", .{package_idx});

    try this.buffers.dependencies.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.resolutions.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.extern_strings.ensureTotalCapacity(allocator, num_extern_strings);
    try this.packages.ensureTotalCapacity(allocator, package_idx);
    // The package index is overallocated, but we know the upper bound
    try this.package_index.ensureTotalCapacity(package_idx);
    try builder.allocate();

    var resolutions = this.packages.items(.resolution);
    resolutions.len = package_idx;
    var metas = this.packages.items(.meta);
    metas.len = package_idx;
    var dependencies_list = this.packages.items(.dependencies);
    dependencies_list.len = package_idx;
    var resolution_list = this.packages.items(.resolutions);
    resolution_list.len = package_idx;

    @memset(this.buffers.resolutions.items, Install.invalid_package_id);

    // Package Building Phase
    for (packages_properties.slice()) |entry| {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        const pkg = entry.value.?.data.e_object;
        if (pkg.get("link") != null) continue;

        const pkg_path = entry.key.?.asString(allocator).?;

        const pkg_name = if (pkg.get("name")) |set_name|
            (set_name.asString(this.allocator) orelse unreachable)
        else package_name: {
            const pkg_name_start = strings.lastIndexOf(pkg_path, "/node_modules/") orelse if (strings.hasPrefixComptime(pkg_path, "node_modules/"))
                @as(u32, "node_modules/".len)
            else
                break :package_name "";

            break :package_name pkg_path[pkg_name_start..];
        };

        const name_hash = stringHash(pkg_name);

        const package_id: Install.PackageID = @intCast(this.packages.len);
        if (Environment.allow_assert) {
            // If this is false, then it means we wrote wrong resolved ids
            // During counting phase we assign all the packages an id.
            std.debug.assert(package_id == id_map.get(pkg_path).?.new_package_id);
        }

        // Instead of calling this.appendPackage, manually append
        // the other function has some checks that will fail since we have not set resolution+dependencies yet.
        this.packages.appendAssumeCapacity(Lockfile.Package{
            .name = builder.appendWithHash(String, pkg_name, name_hash),
            .name_hash = name_hash,

            // these three will be set later
            .resolution = Resolution{},
            .dependencies = undefined,
            .resolutions = undefined,

            .meta = .{
                .id = package_id, // will be set by `appendPackage`

                .origin = undefined, // we will override this later

                .arch = if (pkg.get("cpu")) |cpu_array| arch: {
                    if (cpu_array.data != .e_array) return error.InvalidNPMPackageLockfile;
                    var arch: Npm.Architecture = .none;
                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data != .e_string) return error.InvalidNPMPackageLockfile;
                        arch = arch.apply(item.data.e_string.data);
                    }
                    break :arch arch;
                } else .all,

                .os = if (pkg.get("os")) |cpu_array| arch: {
                    if (cpu_array.data != .e_array) return error.InvalidNPMPackageLockfile;
                    var os: Npm.OperatingSystem = .none;
                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data != .e_string) return error.InvalidNPMPackageLockfile;
                        os = os.apply(item.data.e_string.data);
                    }
                    break :arch os;
                } else .all,

                .man_dir = String{},

                .integrity = if (pkg.get("integrity")) |integrity|
                    try Integrity.parse(
                        integrity.asString(this.allocator) orelse
                            return error.InvalidNPMPackageLockfile,
                    )
                else
                    Integrity{},
            },
            .bin = if (pkg.get("bin")) |bin| bin: {
                // we already check these conditions during counting
                std.debug.assert(bin.data == .e_object);
                std.debug.assert(bin.data.e_object.properties.len > 0);

                // in npm lockfile, the bin is always an object, even if it is only a single one
                // we need to detect if it's a single entry and lower it to a file.
                if (bin.data.e_object.properties.len == 1) {
                    const prop = bin.data.e_object.properties.at(0);
                    const key = prop.key.?.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;
                    const script_value = prop.value.?.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;

                    if (strings.eql(key, pkg_name)) {
                        break :bin .{
                            .tag = .file,
                            .value = Bin.Value.init(.{
                                .file = builder.append(String, script_value),
                            }),
                        };
                    }

                    break :bin .{
                        .tag = .named_file,
                        .value = Bin.Value.init(.{
                            .named_file = .{
                                builder.append(String, key),
                                builder.append(String, script_value),
                            },
                        }),
                    };
                }

                const view: Install.ExternalStringList = .{
                    .off = @truncate(this.buffers.extern_strings.items.len),
                    .len = @intCast(bin.data.e_object.properties.len * 2),
                };

                for (bin.data.e_object.properties.slice()) |bin_entry| {
                    const key = bin_entry.key.?.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;
                    const script_value = bin_entry.value.?.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;
                    this.buffers.extern_strings.appendAssumeCapacity(builder.append(ExternalString, key));
                    this.buffers.extern_strings.appendAssumeCapacity(builder.append(ExternalString, script_value));
                }

                if (Environment.allow_assert) {
                    std.debug.assert(this.buffers.extern_strings.items.len == view.off + view.len);
                    std.debug.assert(this.buffers.extern_strings.items.len <= this.buffers.extern_strings.capacity);
                }

                break :bin .{
                    .tag = .map,
                    .value = Bin.Value.init(.{
                        .map = view,
                    }),
                };
            } else Bin{},

            // TODO: can i use `hasInstallScript` here? do i even need to
            .scripts = .{},
        });
        try this.getOrPutID(package_id, name_hash);

        package_idx += 1;
    }

    if (Environment.allow_assert) {
        for (resolutions) |r| std.debug.assert(r.tag == .uninitialized);
    }

    // Dependency Linking Phase
    resolutions[0] = Resolution.init(.{ .root = {} });
    metas[0].origin = .local;

    package_idx = 0;
    for (packages_properties.slice()) |entry| {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        const pkg = entry.value.?.data.e_object;
        if (pkg.get("link") != null) continue;

        const pkg_path = entry.key.?.asString(allocator).?;

        // unreachable is used safely, because this *must* fail if it's not a link
        var pkg_dependencies: Lockfile.DependencySlice = .{ .len = 0 };
        var pkg_resolutions: Lockfile.PackageIDSlice = .{ .len = 0 };

        inline for (dependency_keys) |dep_key| {
            if (pkg.get(@tagName(dep_key))) |deps| {
                // fetch the peerDependenciesMeta if it exists
                // this is only done for peerDependencies, obviously
                const peer_dep_meta = if (dep_key == .peerDependencies)
                    if (pkg.get("peerDependenciesMeta")) |expr| peer_dep_meta: {
                        if (expr.data != .e_object) return error.InvalidNPMPackageLockfile;
                        break :peer_dep_meta expr.data.e_object;
                    } else null
                else
                    void{};

                if (deps.data == .e_object) {
                    // this buffer could probably be avoided, since we are only joining strings to then be hashed for a lookup
                    var name_checking_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

                    pkg_dependencies = .{
                        .off = @as(u32, @intCast(this.buffers.dependencies.items.len)),
                        .len = @as(u32, @intCast(deps.data.e_object.properties.len)),
                    };
                    pkg_resolutions = .{
                        .off = @as(u32, @intCast(this.buffers.dependencies.items.len)),
                        .len = @as(u32, @intCast(deps.data.e_object.properties.len)),
                    };
                    this.buffers.resolutions.items.len += pkg_dependencies.len;
                    this.buffers.dependencies.items.len += pkg_dependencies.len;
                    if (Environment.allow_assert) {
                        std.debug.assert(this.buffers.dependencies.items.len <= this.buffers.dependencies.capacity);
                        std.debug.assert(this.buffers.dependencies.items.len >= pkg_dependencies.off + pkg_dependencies.len);
                        std.debug.assert(this.buffers.resolutions.items.len <= this.buffers.resolutions.capacity);
                        std.debug.assert(this.buffers.resolutions.items.len >= pkg_resolutions.off + pkg_resolutions.len);
                    }

                    dep_loop: for (deps.data.e_object.properties.slice(), 0..) |prop, i| {
                        const name_bytes = prop.key.?.asString(this.allocator).?;
                        const version_bytes = prop.value.?.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;
                        const name_hash = stringHash(name_bytes);
                        const dep_name = builder.appendWithHash(String, name_bytes, name_hash);

                        const dep_version = builder.append(String, version_bytes);
                        const sliced = dep_version.sliced(this.buffers.string_bytes.items);

                        debug("parsing {s}, {s}\n", .{ name_bytes, version_bytes });
                        const version = Dependency.parse(
                            this.allocator,
                            String.init(name_bytes, name_bytes),
                            sliced.slice,
                            &sliced,
                            log,
                        ) orelse {
                            return error.InvalidNPMPackageLockfile;
                        };
                        if (Environment.allow_assert) {
                            std.debug.assert(version.tag != .uninitialized);
                        }

                        bun.copy(u8, name_checking_buf[0..pkg_path.len], pkg_path);
                        const str_node_modules = if (pkg_path.len == 0) "node_modules/" else "/node_modules/";
                        bun.copy(u8, name_checking_buf[pkg_path.len .. pkg_path.len + str_node_modules.len], str_node_modules);
                        const suffix_len = str_node_modules.len + name_bytes.len;
                        bun.copy(u8, name_checking_buf[pkg_path.len + str_node_modules.len .. pkg_path.len + suffix_len], name_bytes);
                        var buf_len: u32 = @as(u32, @intCast(pkg_path.len + suffix_len));
                        while (true) {
                            debug("checking {s}", .{name_checking_buf[0..buf_len]});
                            if (id_map.get(name_checking_buf[0..buf_len])) |found_| {
                                var is_workspace = false;
                                var found = found_;
                                if (found.new_package_id == std.math.maxInt(u32)) {
                                    // it is a workspace package, resolve from the "link": true entry to the real entry.
                                    const ref_pkg = packages_properties.at(found.old_json_index).value.?.data.e_object;
                                    const resolved_v = ref_pkg.get("resolved") orelse return error.LockfileWorkspaceMissingResolved;
                                    const resolved = resolved_v.asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;
                                    found = (id_map.get(resolved) orelse return error.InvalidNPMPackageLockfile);

                                    // TODO: is_workspace.
                                    // if the ref has a "name" set, then it's a workspace? todo try to find ways this isnt true.
                                    if (ref_pkg.get("name") != null) {
                                        is_workspace = true;
                                    }
                                }
                                const id = found.new_package_id;

                                this.buffers.dependencies.items[pkg_dependencies.off + i] = Dependency{
                                    .name = dep_name,
                                    .name_hash = name_hash,
                                    .version = version,
                                    .behavior = .{
                                        .normal = dep_key == .dependencies,
                                        .optional = dep_key == .optionalDependencies,
                                        .dev = dep_key == .devDependencies,
                                        .peer = dep_key == .peerDependencies,
                                        .workspace = is_workspace,
                                    },
                                };
                                this.buffers.resolutions.items[pkg_dependencies.off + i] = id;

                                // If the package resolution is not set, resolve the target package
                                // using the information we have from the dependency declaration.
                                if (resolutions[id].tag == .uninitialized) {
                                    const dep_pkg = packages_properties.at(found.old_json_index).value.?.data.e_object;
                                    const dep_actual_version = (dep_pkg.get("version") orelse return error.InvalidNPMPackageLockfile).asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;

                                    const dep_resolved = (dep_pkg.get("resolved") orelse return error.LockfileWorkspaceMissingResolved).asString(this.allocator) orelse return error.InvalidNPMPackageLockfile;

                                    const res = switch (version.tag) {
                                        .uninitialized => std.debug.panic("Version string {s} resolved to `.uninitialized`", .{version_bytes}),
                                        .npm, .dist_tag => res: {
                                            const dep_actual_version_str = builder.append(String, dep_actual_version);
                                            const dep_actual_version_sliced = dep_actual_version_str.sliced(this.buffers.string_bytes.items);
                                            break :res Resolution.init(.{
                                                .npm = .{
                                                    .url = builder.append(String, dep_resolved),
                                                    .version = Semver.Version.parse(dep_actual_version_sliced).version.fill(),
                                                },
                                            });
                                        },
                                        .tarball => if (strings.hasPrefixComptime(dep_resolved, "file:"))
                                            Resolution.init(.{ .local_tarball = builder.append(String, dep_resolved[5..]) })
                                        else
                                            Resolution.init(.{ .remote_tarball = builder.append(String, dep_resolved) }),
                                        .folder => Resolution.init(.{ .folder = builder.append(String, dep_resolved) }),
                                        // not sure if this is possible to hit
                                        .symlink => Resolution.init(.{ .folder = builder.append(String, dep_resolved) }),
                                        .workspace => @panic("TODO"),
                                        .git, .github => res: {
                                            const str = (if (strings.hasPrefixComptime(dep_resolved, "git+"))
                                                builder.append(String, dep_resolved[4..])
                                            else
                                                builder.append(String, dep_resolved))
                                                .sliced(this.buffers.string_bytes.items);

                                            const hash_index = strings.lastIndexOfChar(str.slice, '#') orelse return error.InvalidNPMPackageLockfile;

                                            // TODO: this removes owner from the git url, which is not correct for github urls.
                                            const commit = str.sub(str.slice[hash_index + 1 ..]).value();
                                            break :res Resolution.init(.{
                                                .git = .{
                                                    .owner = String.from(""),
                                                    .repo = str.sub(str.slice[0..hash_index]).value(),
                                                    .committish = commit,
                                                    .resolved = commit,
                                                },
                                            });
                                        },
                                    };
                                    resolutions[id] = res;
                                    metas[id].origin = switch (res.tag) {
                                        .npm => .npm,
                                        .root, .folder, .local_tarball, .symlink, .workspace => .local,
                                        .remote_tarball, .git, .github, .gitlab, .single_file_module => .tarball,

                                        else => if (Environment.allow_assert) unreachable else .local,
                                    };
                                }

                                continue :dep_loop;
                            }
                            // step
                            if (strings.lastIndexOf(name_checking_buf[0 .. buf_len - suffix_len], "node_modules/")) |idx| {
                                buf_len = @intCast(idx + "node_modules/".len + name_bytes.len);
                                bun.copy(u8, name_checking_buf[buf_len - name_bytes.len .. buf_len], name_bytes);
                            } else {
                                // optional peer dependencies can be ... optional
                                if (dep_key == .peerDependencies) {
                                    if (peer_dep_meta) |o| if (o.get(name_bytes)) |meta| {
                                        if (meta.data != .e_object) return error.InvalidNPMPackageLockfile;
                                        if (meta.data.e_object.get("optional")) |optional| {
                                            if (optional.data != .e_boolean) return error.InvalidNPMPackageLockfile;
                                            if (optional.data.e_boolean.value) {
                                                @panic("TODO: how do i put the resolution for this in");
                                                // continue :dep_loop;
                                            }
                                        }
                                    };
                                }
                                // the lockfile is supposed contain everything
                                // despite the name `optionalDependencies`, those also have to be resolved
                                return error.MissingLockfileDependency;
                            }
                        }
                    }
                }
            }
        }

        dependencies_list[package_idx] = pkg_dependencies;
        resolution_list[package_idx] = pkg_resolutions;

        package_idx += 1; // todo: find a way to not need this
    }

    if (Environment.allow_assert) {
        for (0..this.packages.len) |i| {
            debug("package {d}: {}", .{ i, this.packages.get(i) });
        }
    }

    if (Environment.allow_assert) {
        for (dependencies_list, 0..) |deps, i| {
            debug("dependencies_list {d}: off={d}, len={d}", .{ i, deps.off, deps.len });
        }
        for (resolution_list, 0..) |deps, i| {
            debug("resolution_list {d}: off={d}, len={d}", .{ i, deps.off, deps.len });
        }
    }

    if (Environment.allow_assert) {
        for (this.buffers.dependencies.items, 0..) |dep, i| {
            debug("dependencies {d}: {}", .{ i, dep });
        }
        for (resolution_list, 0..) |deps, i| {
            debug("resolution_list {d}: off={d}, len={d}", .{ i, deps.off, deps.len });
        }
    }

    for (resolutions, 0..) |r, i| {
        debug("resolution {d}, {}", .{ i, r.fmtForDebug(this.buffers.string_bytes.items) });
        if (r.tag == .uninitialized) {
            return error.NotAllPackagesGotResolved;
        }
    }

    for (this.buffers.resolutions.items, 0..) |r, i| {
        debug("resolution_list {d}, {d}", .{ i, r });
        if (r == Install.invalid_package_id) {
            return error.NotAllPackagesGotResolved;
        }
    }

    this.format = .migrated;

    return LoadFromDiskResult{ .ok = this };
}
