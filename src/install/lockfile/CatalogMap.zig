const CatalogMap = @This();

const Map = std.ArrayHashMapUnmanaged(String, Dependency, String.ArrayHashContext, true);

default: Map = .{},
groups: std.ArrayHashMapUnmanaged(String, Map, String.ArrayHashContext, true) = .{},

pub fn hasAny(this: *const CatalogMap) bool {
    return this.default.count() > 0 or this.groups.count() > 0;
}

pub fn get(this: *CatalogMap, lockfile: *const Lockfile, catalog_name: String, dep_name: String) ?Dependency {
    if (catalog_name.isEmpty()) {
        if (this.default.count() == 0) {
            return null;
        }
        return this.default.getContext(dep_name, String.arrayHashContext(lockfile, null)) orelse {
            return null;
        };
    }

    const group = this.groups.getContext(catalog_name, String.arrayHashContext(lockfile, null)) orelse {
        return null;
    };

    if (group.count() == 0) {
        return null;
    }

    return group.getContext(dep_name, String.arrayHashContext(lockfile, null)) orelse {
        return null;
    };
}

pub fn getOrPutGroup(this: *CatalogMap, lockfile: *Lockfile, catalog_name: String) OOM!*Map {
    if (catalog_name.isEmpty()) {
        return &this.default;
    }

    const entry = try this.groups.getOrPutContext(
        lockfile.allocator,
        catalog_name,
        String.arrayHashContext(lockfile, null),
    );
    if (!entry.found_existing) {
        entry.value_ptr.* = .{};
    }

    return entry.value_ptr;
}

pub fn getGroup(this: *CatalogMap, map_buf: string, catalog_name: String, catalog_name_buf: string) ?*Map {
    if (catalog_name.isEmpty()) {
        return &this.default;
    }

    return this.groups.getPtrContext(catalog_name, String.ArrayHashContext{
        .arg_buf = catalog_name_buf,
        .existing_buf = map_buf,
    });
}

pub fn parseCount(_: *CatalogMap, lockfile: *Lockfile, expr: Expr, builder: *Lockfile.StringBuilder) void {
    if (expr.get("catalog")) |default_catalog| {
        switch (default_catalog.data) {
            .e_object => |obj| {
                for (obj.properties.slice()) |item| {
                    const dep_name = item.key.?.asString(lockfile.allocator).?;
                    builder.count(dep_name);
                    switch (item.value.?.data) {
                        .e_string => |version_str| {
                            builder.count(version_str.slice(lockfile.allocator));
                        },
                        else => {},
                    }
                }
            },
            else => {},
        }
    }

    if (expr.get("catalogs")) |catalogs| {
        switch (catalogs.data) {
            .e_object => |catalog_names| {
                for (catalog_names.properties.slice()) |catalog| {
                    const catalog_name = catalog.key.?.asString(lockfile.allocator).?;
                    builder.count(catalog_name);
                    switch (catalog.value.?.data) {
                        .e_object => |obj| {
                            for (obj.properties.slice()) |item| {
                                const dep_name = item.key.?.asString(lockfile.allocator).?;
                                builder.count(dep_name);
                                switch (item.value.?.data) {
                                    .e_string => |version_str| {
                                        builder.count(version_str.slice(lockfile.allocator));
                                    },
                                    else => {},
                                }
                            }
                        },
                        else => {},
                    }
                }
            },
            else => {},
        }
    }
}

pub fn parseAppend(
    this: *CatalogMap,
    pm: *PackageManager,
    lockfile: *Lockfile,
    log: *logger.Log,
    source: *const logger.Source,
    expr: Expr,
    builder: *Lockfile.StringBuilder,
) OOM!bool {
    var found_any = false;
    if (expr.get("catalog")) |default_catalog| {
        const group = try this.getOrPutGroup(lockfile, .empty);
        found_any = true;
        switch (default_catalog.data) {
            .e_object => |obj| {
                for (obj.properties.slice()) |item| {
                    const dep_name_str = item.key.?.asString(lockfile.allocator).?;

                    const dep_name_hash = String.Builder.stringHash(dep_name_str);
                    const dep_name = builder.appendWithHash(String, dep_name_str, dep_name_hash);

                    switch (item.value.?.data) {
                        .e_string => |version_str| {
                            const version_literal = builder.append(String, version_str.slice(lockfile.allocator));

                            const version_sliced = version_literal.sliced(lockfile.buffers.string_bytes.items);

                            const version = Dependency.parse(
                                lockfile.allocator,
                                dep_name,
                                dep_name_hash,
                                version_sliced.slice,
                                &version_sliced,
                                log,
                                pm,
                            ) orelse {
                                try log.addError(source, item.value.?.loc, "Invalid dependency version");
                                continue;
                            };

                            const entry = try group.getOrPutContext(
                                lockfile.allocator,
                                dep_name,
                                String.arrayHashContext(lockfile, null),
                            );

                            if (entry.found_existing) {
                                try log.addError(source, item.key.?.loc, "Duplicate catalog");
                                continue;
                            }

                            const dep: Dependency = .{
                                .name = dep_name,
                                .name_hash = dep_name_hash,
                                .version = version,
                            };

                            entry.value_ptr.* = dep;
                        },
                        else => {},
                    }
                }
            },
            else => {},
        }
    }

    if (expr.get("catalogs")) |catalogs| {
        found_any = true;
        switch (catalogs.data) {
            .e_object => |catalog_names| {
                for (catalog_names.properties.slice()) |catalog| {
                    const catalog_name_str = catalog.key.?.asString(lockfile.allocator).?;
                    const catalog_name = builder.append(String, catalog_name_str);

                    const group = try this.getOrPutGroup(lockfile, catalog_name);

                    switch (catalog.value.?.data) {
                        .e_object => |obj| {
                            for (obj.properties.slice()) |item| {
                                const dep_name_str = item.key.?.asString(lockfile.allocator).?;
                                const dep_name_hash = String.Builder.stringHash(dep_name_str);
                                const dep_name = builder.appendWithHash(String, dep_name_str, dep_name_hash);
                                switch (item.value.?.data) {
                                    .e_string => |version_str| {
                                        const version_literal = builder.append(String, version_str.slice(lockfile.allocator));
                                        const version_sliced = version_literal.sliced(lockfile.buffers.string_bytes.items);

                                        const version = Dependency.parse(
                                            lockfile.allocator,
                                            dep_name,
                                            dep_name_hash,
                                            version_sliced.slice,
                                            &version_sliced,
                                            log,
                                            pm,
                                        ) orelse {
                                            try log.addError(source, item.value.?.loc, "Invalid dependency version");
                                            continue;
                                        };

                                        const entry = try group.getOrPutContext(
                                            lockfile.allocator,
                                            dep_name,

                                            String.arrayHashContext(lockfile, null),
                                        );

                                        if (entry.found_existing) {
                                            try log.addError(source, item.key.?.loc, "Duplicate catalog");
                                            continue;
                                        }

                                        const dep: Dependency = .{
                                            .name = dep_name,
                                            .name_hash = dep_name_hash,
                                            .version = version,
                                        };

                                        entry.value_ptr.* = dep;
                                    },
                                    else => {},
                                }
                            }
                        },
                        else => {},
                    }
                }
            },
            else => {},
        }
    }

    return found_any;
}

const FromPnpmLockfileError = OOM || error{InvalidPnpmLockfile};

pub fn fromPnpmLockfile(
    lockfile: *Lockfile,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    catalogs_obj: *bun.ast.E.Object,
    string_buf: *String.Buf,
) FromPnpmLockfileError!void {
    for (catalogs_obj.properties.slice()) |prop| {
        const group_name_str = prop.key.?.asString(allocator) orelse {
            return error.InvalidPnpmLockfile;
        };

        if (!prop.value.?.isObject()) {
            continue;
        }

        const entries_obj = prop.value.?.data.e_object;

        if (strings.eqlComptime(group_name_str, "default")) {
            try putEntriesFromPnpmLockfile(lockfile, allocator, log, &lockfile.catalogs.default, entries_obj, string_buf);
        } else {
            const group_name = try string_buf.append(group_name_str);
            const group = try lockfile.catalogs.getOrPutGroup(lockfile, group_name);
            try putEntriesFromPnpmLockfile(lockfile, allocator, log, group, entries_obj, string_buf);
        }
    }
}

fn putEntriesFromPnpmLockfile(
    lockfile: *Lockfile,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    catalog_map: *Map,
    entries_obj: *bun.ast.E.Object,
    string_buf: *String.Buf,
) FromPnpmLockfileError!void {
    for (entries_obj.properties.slice()) |entry_prop| {
        const dep_name_str = entry_prop.key.?.asString(allocator) orelse {
            return error.InvalidPnpmLockfile;
        };
        const dep_name_hash = String.Builder.stringHash(dep_name_str);
        const dep_name = try string_buf.appendWithHash(dep_name_str, dep_name_hash);

        const version_str, _ = try entry_prop.value.?.getString(allocator, "specifier") orelse {
            return error.InvalidPnpmLockfile;
        };
        const version_hash = String.Builder.stringHash(version_str);
        const version = try string_buf.appendWithHash(version_str, version_hash);
        const version_sliced = version.sliced(string_buf.bytes.items);

        const dep: Dependency = .{
            .name = dep_name,
            .name_hash = dep_name_hash,
            .version = Dependency.parse(
                allocator,
                dep_name,
                dep_name_hash,
                version_sliced.slice,
                &version_sliced,
                log,
                null,
            ) orelse {
                return error.InvalidPnpmLockfile;
            },
        };

        const entry = try catalog_map.getOrPutContext(
            allocator,
            dep_name,
            String.arrayHashContext(lockfile, null),
        );

        if (entry.found_existing) {
            return error.InvalidPnpmLockfile;
        }

        entry.value_ptr.* = dep;
    }
}

pub fn sort(this: *CatalogMap, lockfile: *const Lockfile) void {
    const DepSortCtx = struct {
        buf: string,
        catalog_deps: [*]const Dependency,

        pub fn lessThan(sorter: *@This(), l: usize, r: usize) bool {
            const deps = sorter.catalog_deps;
            const l_dep = deps[l];
            const r_dep = deps[r];
            const buf = sorter.buf;

            return l_dep.name.order(&r_dep.name, buf, buf) == .lt;
        }
    };

    const NameSortCtx = struct {
        buf: string,
        catalog_names: [*]const String,

        pub fn lessThan(sorter: *@This(), l: usize, r: usize) bool {
            const buf = sorter.buf;
            const names = sorter.catalog_names;
            const l_name = names[l];
            const r_name = names[r];

            return l_name.order(&r_name, buf, buf) == .lt;
        }
    };

    var dep_sort_ctx: DepSortCtx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .catalog_deps = lockfile.catalogs.default.values().ptr,
    };

    this.default.sort(&dep_sort_ctx);

    var iter = this.groups.iterator();
    while (iter.next()) |catalog| {
        dep_sort_ctx.catalog_deps = catalog.value_ptr.values().ptr;
        catalog.value_ptr.sort(&dep_sort_ctx);
    }

    var name_sort_ctx: NameSortCtx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .catalog_names = this.groups.keys().ptr,
    };

    this.groups.sort(&name_sort_ctx);
}

pub fn deinit(this: *CatalogMap, allocator: std.mem.Allocator) void {
    this.default.deinit(allocator);
    for (this.groups.values()) |*group| {
        group.deinit(allocator);
    }
    this.groups.deinit(allocator);
}

pub fn count(this: *CatalogMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
    var deps_iter = this.default.iterator();
    while (deps_iter.next()) |entry| {
        const dep_name = entry.key_ptr;
        const dep = entry.value_ptr;
        builder.count(dep_name.slice(lockfile.buffers.string_bytes.items));
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }

    var groups_iter = this.groups.iterator();
    while (groups_iter.next()) |catalog| {
        const catalog_name = catalog.key_ptr;
        builder.count(catalog_name.slice(lockfile.buffers.string_bytes.items));

        deps_iter = catalog.value_ptr.iterator();
        while (deps_iter.next()) |entry| {
            const dep_name = entry.key_ptr;
            const dep = entry.value_ptr;
            builder.count(dep_name.slice(lockfile.buffers.string_bytes.items));
            dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
        }
    }
}

pub fn clone(this: *CatalogMap, pm: *PackageManager, old: *Lockfile, new: *Lockfile, builder: *Lockfile.StringBuilder) OOM!CatalogMap {
    var new_catalog: CatalogMap = .{};

    try new_catalog.default.ensureTotalCapacity(new.allocator, this.default.count());

    var deps_iter = this.default.iterator();
    while (deps_iter.next()) |entry| {
        const dep_name = entry.key_ptr;
        const dep = entry.value_ptr;
        new_catalog.default.putAssumeCapacityContext(
            builder.append(String, dep_name.slice(old.buffers.string_bytes.items)),
            try dep.clone(pm, old.buffers.string_bytes.items, @TypeOf(builder), builder),
            String.arrayHashContext(new, null),
        );
    }

    try new_catalog.groups.ensureTotalCapacity(new.allocator, this.groups.count());

    var groups_iter = this.groups.iterator();
    while (groups_iter.next()) |group| {
        const catalog_name = group.key_ptr;
        const deps = group.value_ptr;

        var new_group: Map = .{};
        try new_group.ensureTotalCapacity(new.allocator, deps.count());

        deps_iter = deps.iterator();
        while (deps_iter.next()) |entry| {
            const dep_name = entry.key_ptr;
            const dep = entry.value_ptr;
            new_group.putAssumeCapacityContext(
                builder.append(String, dep_name.slice(old.buffers.string_bytes.items)),
                try dep.clone(pm, old.buffers.string_bytes.items, @TypeOf(builder), builder),
                String.arrayHashContext(new, null),
            );
        }

        new_catalog.groups.putAssumeCapacityContext(
            builder.append(String, catalog_name.slice(old.buffers.string_bytes.items)),
            new_group,
            String.arrayHashContext(new, null),
        );
    }

    return new_catalog;
}

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const OOM = bun.OOM;
const logger = bun.logger;
const strings = bun.strings;
const Expr = bun.ast.Expr;
const String = bun.Semver.String;

const Dependency = bun.install.Dependency;
const Lockfile = bun.install.Lockfile;
const PackageManager = bun.install.PackageManager;
