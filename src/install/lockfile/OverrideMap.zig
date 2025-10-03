const OverrideMap = @This();

const debug = Output.scoped(.OverrideMap, .visible);

/// Override value can be either global (applies to all instances of a package)
/// or nested (applies only when a specific parent package depends on it)
const OverrideValue = union(enum) {
    /// Global override - applies to all instances of this package
    global: Dependency,
    /// Nested overrides - contains both a global override (in ".") and parent-specific overrides
    nested: NestedOverrides,

    pub fn eql(this: *const OverrideValue, other: *const OverrideValue, this_buf: []const u8, other_buf: []const u8) bool {
        if (@intFromEnum(this.*) != @intFromEnum(other.*)) {
            return false;
        }

        return switch (this.*) {
            .global => |this_dep| {
                const other_dep = other.global;
                return this_dep.name.eql(other_dep.name, this_buf, other_buf) and
                    this_dep.name_hash == other_dep.name_hash and
                    this_dep.version.eql(&other_dep.version, this_buf, other_buf);
            },
            .nested => |this_nested| {
                const other_nested = other.nested;

                // Compare global overrides
                if (this_nested.global != null and other_nested.global != null) {
                    const this_global = this_nested.global.?;
                    const other_global = other_nested.global.?;
                    if (!this_global.name.eql(other_global.name, this_buf, other_buf) or
                        this_global.name_hash != other_global.name_hash or
                        !this_global.version.eql(&other_global.version, this_buf, other_buf))
                    {
                        return false;
                    }
                } else if ((this_nested.global != null) != (other_nested.global != null)) {
                    return false;
                }

                // Compare parent maps
                if (this_nested.parent_map.count() != other_nested.parent_map.count()) {
                    return false;
                }

                for (this_nested.parent_map.keys(), this_nested.parent_map.values()) |key, this_dep| {
                    const other_dep = other_nested.parent_map.get(key) orelse return false;
                    if (!this_dep.name.eql(other_dep.name, this_buf, other_buf) or
                        this_dep.name_hash != other_dep.name_hash or
                        !this_dep.version.eql(&other_dep.version, this_buf, other_buf))
                    {
                        return false;
                    }
                }

                return true;
            },
        };
    }

    /// Convert to external representation for binary lockfile.
    /// For nested overrides, only the global override is included (parent-specific overrides are lost in binary format)
    pub fn toExternal(this: *const OverrideValue) Dependency.External {
        const dep = switch (this.*) {
            .global => |d| d,
            .nested => |nested| blk: {
                if (nested.global) |g| {
                    break :blk g;
                }
                // If there's no global, use the first parent-specific override
                // This is a limitation of the binary format
                if (nested.parent_map.count() > 0) {
                    break :blk nested.parent_map.values()[0];
                } else {
                    // Shouldn't happen, but provide a safe default
                    break :blk Dependency{};
                }
            },
        };
        return dep.toExternal();
    }
};

const NestedOverrides = struct {
    /// Global override for this package (from the "." property in npm overrides)
    global: ?Dependency = null,
    /// Map from parent package name hash to the override dependency
    parent_map: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},

    pub fn deinit(this: *NestedOverrides, allocator: Allocator) void {
        this.parent_map.deinit(allocator);
    }
};

map: std.ArrayHashMapUnmanaged(PackageNameHash, OverrideValue, ArrayIdentityContext.U64, false) = .{},

/// Get the override for a package, optionally considering the parent package.
/// If parent_name_hash is provided and a nested override exists for that parent, it takes precedence.
/// Otherwise, falls back to the global override if one exists.
pub fn get(this: *const OverrideMap, name_hash: PackageNameHash, parent_name_hash: ?PackageNameHash) ?Dependency.Version {
    debug("looking up override for {x} (parent: {?x})", .{ name_hash, parent_name_hash });
    if (this.map.count() == 0) {
        return null;
    }

    const override_value = this.map.get(name_hash) orelse return null;

    return switch (override_value) {
        .global => |dep| dep.version,
        .nested => |nested| {
            // If parent is provided, check for parent-specific override first
            if (parent_name_hash) |parent_hash| {
                if (nested.parent_map.get(parent_hash)) |dep| {
                    debug("found nested override for parent {x}", .{parent_hash});
                    return dep.version;
                }
            }
            // Fall back to global override if present
            if (nested.global) |dep| {
                return dep.version;
            }
            return null;
        },
    };
}

pub fn sort(this: *OverrideMap, lockfile: *const Lockfile) void {
    const Ctx = struct {
        buf: string,
        override_values: [*]const OverrideValue,

        pub fn lessThan(sorter: *const @This(), l: usize, r: usize) bool {
            const values = sorter.override_values;
            const l_name = switch (values[l]) {
                .global => |dep| dep.name,
                .nested => |nested| if (nested.global) |dep| dep.name else return false,
            };
            const r_name = switch (values[r]) {
                .global => |dep| dep.name,
                .nested => |nested| if (nested.global) |dep| dep.name else return true,
            };

            const buf = sorter.buf;
            return l_name.order(&r_name, buf, buf) == .lt;
        }
    };

    const ctx: Ctx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .override_values = this.map.values().ptr,
    };

    this.map.sort(&ctx);
}

pub fn deinit(this: *OverrideMap, allocator: Allocator) void {
    for (this.map.values()) |*value| {
        switch (value.*) {
            .global => {},
            .nested => |*nested| nested.deinit(allocator),
        }
    }
    this.map.deinit(allocator);
}

pub fn count(this: *OverrideMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
    const buf = lockfile.buffers.string_bytes.items;
    for (this.map.values()) |value| {
        switch (value) {
            .global => |dep| dep.count(buf, @TypeOf(builder), builder),
            .nested => |nested| {
                if (nested.global) |dep| {
                    dep.count(buf, @TypeOf(builder), builder);
                }
                for (nested.parent_map.values()) |dep| {
                    dep.count(buf, @TypeOf(builder), builder);
                }
            },
        }
    }
}

pub fn clone(this: *OverrideMap, pm: *PackageManager, old_lockfile: *Lockfile, new_lockfile: *Lockfile, new_builder: *Lockfile.StringBuilder) !OverrideMap {
    var new = OverrideMap{};
    try new.map.ensureTotalCapacity(new_lockfile.allocator, this.map.entries.len);

    const old_buf = old_lockfile.buffers.string_bytes.items;

    for (this.map.keys(), this.map.values()) |k, v| {
        const new_value = switch (v) {
            .global => |dep| OverrideValue{
                .global = try dep.clone(pm, old_buf, @TypeOf(new_builder), new_builder),
            },
            .nested => |nested| blk: {
                var new_nested = NestedOverrides{};
                if (nested.global) |dep| {
                    new_nested.global = try dep.clone(pm, old_buf, @TypeOf(new_builder), new_builder);
                }
                try new_nested.parent_map.ensureTotalCapacity(new_lockfile.allocator, nested.parent_map.count());
                for (nested.parent_map.keys(), nested.parent_map.values()) |parent_hash, dep| {
                    new_nested.parent_map.putAssumeCapacity(
                        parent_hash,
                        try dep.clone(pm, old_buf, @TypeOf(new_builder), new_builder),
                    );
                }
                break :blk OverrideValue{ .nested = new_nested };
            },
        };
        new.map.putAssumeCapacity(k, new_value);
    }

    return new;
}

// the rest of this struct is expression parsing code:

pub fn parseCount(
    _: *OverrideMap,
    lockfile: *Lockfile,
    expr: Expr,
    builder: *Lockfile.StringBuilder,
) void {
    if (expr.asProperty("overrides")) |overrides| {
        if (overrides.expr.data != .e_object)
            return;

        for (overrides.expr.data.e_object.properties.slice()) |entry| {
            builder.count(entry.key.?.asString(lockfile.allocator).?);
            switch (entry.value.?.data) {
                .e_string => |s| {
                    builder.count(s.slice(lockfile.allocator));
                },
                .e_object => |obj| {
                    // Count all nested properties
                    for (obj.properties.slice()) |nested_prop| {
                        const nested_key = nested_prop.key.?.asString(lockfile.allocator).?;
                        builder.count(nested_key);
                        if (nested_prop.value.?.asString(lockfile.allocator)) |s| {
                            builder.count(s);
                        }
                    }
                },
                else => {},
            }
        }
    } else if (expr.asProperty("resolutions")) |resolutions| {
        if (resolutions.expr.data != .e_object)
            return;

        for (resolutions.expr.data.e_object.properties.slice()) |entry| {
            const key = entry.key.?.asString(lockfile.allocator).?;
            // Parse "parent/child" format - need to count both parent and child names
            var remaining = key;
            if (strings.hasPrefixComptime(remaining, "**/")) {
                remaining = remaining[3..];
            }

            // For scoped packages, handle @scope/pkg/child
            if (remaining.len > 0 and remaining[0] == '@') {
                if (strings.indexOfChar(remaining, '/')) |first_slash| {
                    if (strings.indexOfChar(remaining[first_slash + 1 ..], '/')) |second_slash| {
                        // Nested: @scope/parent/child
                        const parent = remaining[0 .. first_slash + 1 + second_slash];
                        const child = remaining[first_slash + 2 + second_slash ..];
                        builder.count(parent);
                        builder.count(child);
                    } else {
                        // Not nested: @scope/pkg
                        builder.count(remaining);
                    }
                } else {
                    builder.count(remaining);
                }
            } else if (strings.indexOfChar(remaining, '/')) |slash_idx| {
                // Nested: parent/child
                const parent = remaining[0..slash_idx];
                const child = remaining[slash_idx + 1 ..];
                builder.count(parent);
                builder.count(child);
            } else {
                // Not nested
                builder.count(remaining);
            }

            builder.count(entry.value.?.asString(lockfile.allocator) orelse continue);
        }
    }
}

/// Given a package json expression, detect and parse override configuration into the given override map.
/// It is assumed the input map is uninitialized (zero entries)
pub fn parseAppend(
    this: *OverrideMap,
    pm: *PackageManager,
    lockfile: *Lockfile,
    root_package: *Lockfile.Package,
    log: *logger.Log,
    json_source: *const logger.Source,
    expr: Expr,
    builder: *Lockfile.StringBuilder,
) !void {
    if (Environment.allow_assert) {
        assert(this.map.entries.len == 0); // only call parse once
    }
    if (expr.asProperty("overrides")) |overrides| {
        try this.parseFromOverrides(pm, lockfile, root_package, json_source, log, overrides.expr, builder);
    } else if (expr.asProperty("resolutions")) |resolutions| {
        try this.parseFromResolutions(pm, lockfile, root_package, json_source, log, resolutions.expr, builder);
    }
    debug("parsed {d} overrides", .{this.map.entries.len});
}

/// https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
pub fn parseFromOverrides(
    this: *OverrideMap,
    pm: *PackageManager,
    lockfile: *Lockfile,
    root_package: *Lockfile.Package,
    source: *const logger.Source,
    log: *logger.Log,
    expr: Expr,
    builder: *Lockfile.StringBuilder,
) !void {
    if (expr.data != .e_object) {
        try log.addWarningFmt(source, expr.loc, lockfile.allocator, "\"overrides\" must be an object", .{});
        return error.Invalid;
    }

    try this.map.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);

    for (expr.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        const package_name = key.asString(lockfile.allocator).?;
        if (package_name.len == 0) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Missing package name in overrides", .{});
            continue;
        }

        const value_expr = prop.value.?;

        // Handle simple string override: "pkg": "1.0.0" (global override)
        if (value_expr.data == .e_string) {
            const package_name_hash = String.Builder.stringHash(package_name);
            const version_str = value_expr.data.e_string.slice(lockfile.allocator);
            if (strings.hasPrefixComptime(version_str, "patch:")) {
                try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
                continue;
            }

            if (try parseOverrideValue(
                "override",
                lockfile,
                pm,
                root_package,
                source,
                value_expr.loc,
                log,
                package_name,
                version_str,
                builder,
            )) |dep| {
                this.map.putAssumeCapacity(package_name_hash, .{ .global = dep });
            }
            continue;
        }

        // Handle object: could be either "parent": { "child": "version" } or global package with "."
        if (value_expr.data == .e_object) {
            const parent_name = package_name;
            const parent_name_hash = String.Builder.stringHash(parent_name);
            const nested_props = value_expr.data.e_object.properties.slice();

            // Iterate through children of this parent
            for (nested_props) |child_prop| {
                const child_key = child_prop.key.?;
                const child_name = child_key.asString(lockfile.allocator).?;

                if (child_prop.value.?.data != .e_string) {
                    try log.addWarningFmt(source, child_prop.value.?.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{child_name});
                    continue;
                }

                const child_version_str = child_prop.value.?.data.e_string.slice(lockfile.allocator);
                if (strings.hasPrefixComptime(child_version_str, "patch:")) {
                    try log.addWarningFmt(source, child_key.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
                    continue;
                }

                const child_name_hash = String.Builder.stringHash(child_name);

                if (try parseOverrideValue(
                    "override",
                    lockfile,
                    pm,
                    root_package,
                    source,
                    child_prop.value.?.loc,
                    log,
                    child_name,
                    child_version_str,
                    builder,
                )) |dep| {
                    // Get or create the nested override entry for this child
                    const gop = try this.map.getOrPut(lockfile.allocator, child_name_hash);
                    if (!gop.found_existing) {
                        // Create new nested override
                        var nested = NestedOverrides{};
                        try nested.parent_map.ensureTotalCapacity(lockfile.allocator, 1);
                        nested.parent_map.putAssumeCapacity(parent_name_hash, dep);
                        gop.value_ptr.* = .{ .nested = nested };
                    } else {
                        // Update existing entry
                        switch (gop.value_ptr.*) {
                            .global => |global_dep| {
                                // Convert global to nested, keeping the global as fallback
                                var nested = NestedOverrides{};
                                nested.global = global_dep;
                                try nested.parent_map.ensureTotalCapacity(lockfile.allocator, 1);
                                nested.parent_map.putAssumeCapacity(parent_name_hash, dep);
                                gop.value_ptr.* = .{ .nested = nested };
                            },
                            .nested => |*nested| {
                                // Add this parent-specific override
                                try nested.parent_map.put(lockfile.allocator, parent_name_hash, dep);
                            },
                        }
                    }
                }
            }
            continue;
        }

        try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{package_name});
    }
}

/// yarn classic: https://classic.yarnpkg.com/lang/en/docs/selective-version-resolutions/
/// yarn berry: https://yarnpkg.com/configuration/manifest#resolutions
pub fn parseFromResolutions(
    this: *OverrideMap,
    pm: *PackageManager,
    lockfile: *Lockfile,
    root_package: *Lockfile.Package,
    source: *const logger.Source,
    log: *logger.Log,
    expr: Expr,
    builder: *Lockfile.StringBuilder,
) !void {
    if (expr.data != .e_object) {
        try log.addWarningFmt(source, expr.loc, lockfile.allocator, "\"resolutions\" must be an object with string values", .{});
        return;
    }
    try this.map.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);
    for (expr.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        var k = key.asString(lockfile.allocator).?;
        if (strings.hasPrefixComptime(k, "**/"))
            k = k[3..];
        if (k.len == 0) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Missing resolution package name", .{});
            continue;
        }
        const value = prop.value.?;
        if (value.data != .e_string) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Expected string value for resolution \"{s}\"", .{k});
            continue;
        }

        const version_str = value.data.e_string.data;
        if (strings.hasPrefixComptime(version_str, "patch:")) {
            // TODO(dylan-conway): apply .patch files to packages
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"resolutions\"", .{});
            continue;
        }

        // Parse nested resolution format: "parent/child" or "@scope/parent/child"
        var parent_name: ?[]const u8 = null;
        var child_name: []const u8 = k;

        // Handle scoped packages: @scope/parent/child
        if (k.len > 0 and k[0] == '@') {
            if (strings.indexOfChar(k, '/')) |first_slash| {
                if (strings.indexOfChar(k[first_slash + 1 ..], '/')) |second_slash| {
                    // Nested: @scope/parent/child
                    parent_name = k[0 .. first_slash + 1 + second_slash];
                    child_name = k[first_slash + 2 + second_slash ..];
                } else {
                    // Not nested: @scope/pkg (global override)
                    child_name = k;
                }
            } else {
                try log.addWarningFmt(source, key.loc, lockfile.allocator, "Invalid package name \"{s}\"", .{k});
                continue;
            }
        } else if (strings.indexOfChar(k, '/')) |slash_idx| {
            // Nested: parent/child (non-scoped)
            parent_name = k[0..slash_idx];
            child_name = k[slash_idx + 1 ..];
        }

        if (parent_name) |pname| {
            // This is a nested override - create or update NestedOverrides for child_name
            const child_name_hash = String.Builder.stringHash(child_name);
            const parent_name_hash = String.Builder.stringHash(pname);

            if (try parseOverrideValue(
                "resolution",
                lockfile,
                pm,
                root_package,
                source,
                value.loc,
                log,
                child_name,
                version_str,
                builder,
            )) |dep| {
                // Check if we already have an entry for this child
                const gop = try this.map.getOrPut(lockfile.allocator, child_name_hash);
                if (!gop.found_existing) {
                    // Create new nested override
                    var nested = NestedOverrides{};
                    try nested.parent_map.ensureTotalCapacity(lockfile.allocator, 1);
                    nested.parent_map.putAssumeCapacity(parent_name_hash, dep);
                    gop.value_ptr.* = .{ .nested = nested };
                } else {
                    // Update existing entry
                    switch (gop.value_ptr.*) {
                        .global => |global_dep| {
                            // Convert global to nested
                            var nested = NestedOverrides{};
                            nested.global = global_dep;
                            try nested.parent_map.ensureTotalCapacity(lockfile.allocator, 1);
                            nested.parent_map.putAssumeCapacity(parent_name_hash, dep);
                            gop.value_ptr.* = .{ .nested = nested };
                        },
                        .nested => |*nested| {
                            try nested.parent_map.put(lockfile.allocator, parent_name_hash, dep);
                        },
                    }
                }
            }
        } else {
            // Global override
            if (try parseOverrideValue(
                "resolution",
                lockfile,
                pm,
                root_package,
                source,
                value.loc,
                log,
                child_name,
                version_str,
                builder,
            )) |dep| {
                const child_name_hash = String.Builder.stringHash(child_name);
                const gop = try this.map.getOrPut(lockfile.allocator, child_name_hash);
                if (!gop.found_existing) {
                    gop.value_ptr.* = .{ .global = dep };
                } else {
                    // Update existing entry
                    switch (gop.value_ptr.*) {
                        .global => |*global_dep| {
                            global_dep.* = dep;
                        },
                        .nested => |*nested| {
                            // Set or update the global override
                            nested.global = dep;
                        },
                    }
                }
            }
        }
    }
}

pub fn parseOverrideValue(
    comptime field: []const u8,
    lockfile: *Lockfile,
    package_manager: *PackageManager,
    root_package: *Lockfile.Package,
    source: *const logger.Source,
    loc: logger.Loc,
    log: *logger.Log,
    key: []const u8,
    value: []const u8,
    builder: *Lockfile.StringBuilder,
) !?Dependency {
    if (value.len == 0) {
        try log.addWarningFmt(source, loc, lockfile.allocator, "Missing " ++ field ++ " value", .{});
        return null;
    }

    // "Overrides may also be defined as a reference to a spec for a direct dependency
    // by prefixing the name of the package you wish the version to match with a `$`"
    // https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    // This is why a `*Lockfile.Package` is needed here.
    if (value[0] == '$') {
        const ref_name = value[1..];
        // This is fine for this string to not share the string pool, because it's only used for .eql()
        const ref_name_str = String.init(ref_name, ref_name);
        const pkg_deps: []const Dependency = root_package.dependencies.get(lockfile.buffers.dependencies.items);
        for (pkg_deps) |dep| {
            if (dep.name.eql(ref_name_str, lockfile.buffers.string_bytes.items, ref_name)) {
                return dep;
            }
        }
        try log.addWarningFmt(source, loc, lockfile.allocator, "Could not resolve " ++ field ++ " \"{s}\" (you need \"{s}\" in your dependencies)", .{ value, ref_name });
        return null;
    }

    const literalString = builder.append(String, value);
    const literalSliced = literalString.sliced(lockfile.buffers.string_bytes.items);

    const name_hash = String.Builder.stringHash(key);
    const name = builder.appendWithHash(String, key, name_hash);

    return Dependency{
        .name = name,
        .name_hash = name_hash,
        .version = Dependency.parse(
            lockfile.allocator,
            name,
            name_hash,
            literalSliced.slice,
            &literalSliced,
            log,
            package_manager,
        ) orelse {
            try log.addWarningFmt(source, loc, lockfile.allocator, "Invalid " ++ field ++ " value \"{s}\"", .{value});
            return null;
        },
    };
}

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const ArrayIdentityContext = bun.ArrayIdentityContext;
const Environment = bun.Environment;
const Output = bun.Output;
const assert = bun.assert;
const logger = bun.logger;
const strings = bun.strings;
const Expr = bun.ast.Expr;
const String = bun.Semver.String;

const Dependency = bun.install.Dependency;
const Lockfile = bun.install.Lockfile;
const PackageManager = bun.install.PackageManager;
const PackageNameHash = bun.install.PackageNameHash;
