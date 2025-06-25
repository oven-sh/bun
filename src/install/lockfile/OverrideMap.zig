const debug = Output.scoped(.OverrideMap, false);

map: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},

/// In the future, this `get` function should handle multi-level resolutions. This is difficult right
/// now because given a Dependency ID, there is no fast way to trace it to its package.
///
/// A potential approach is to add another buffer to the lockfile that maps Dependency ID to Package ID,
/// and from there `OverrideMap.map` can have a union as the value, where the union is between "override all"
/// and "here is a list of overrides depending on the package that imported" similar to PackageIndex above.
pub fn get(this: *const OverrideMap, name_hash: PackageNameHash) ?Dependency.Version {
    debug("looking up override for {x}", .{name_hash});
    if (this.map.count() == 0) {
        return null;
    }
    return if (this.map.get(name_hash)) |dep|
        dep.version
    else
        null;
}

pub fn sort(this: *OverrideMap, lockfile: *const Lockfile) void {
    const Ctx = struct {
        buf: string,
        override_deps: [*]const Dependency,

        pub fn lessThan(sorter: *const @This(), l: usize, r: usize) bool {
            const deps = sorter.override_deps;
            const l_dep = deps[l];
            const r_dep = deps[r];

            const buf = sorter.buf;
            return l_dep.name.order(&r_dep.name, buf, buf) == .lt;
        }
    };

    const ctx: Ctx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .override_deps = this.map.values().ptr,
    };

    this.map.sort(&ctx);
}

pub fn deinit(this: *OverrideMap, allocator: Allocator) void {
    this.map.deinit(allocator);
}

pub fn count(this: *OverrideMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
    for (this.map.values()) |dep| {
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }
}

pub fn clone(this: *OverrideMap, pm: *PackageManager, old_lockfile: *Lockfile, new_lockfile: *Lockfile, new_builder: *Lockfile.StringBuilder) !OverrideMap {
    var new = OverrideMap{};
    try new.map.ensureTotalCapacity(new_lockfile.allocator, this.map.entries.len);

    for (this.map.keys(), this.map.values()) |k, v| {
        new.map.putAssumeCapacity(
            k,
            try v.clone(pm, old_lockfile.buffers.string_bytes.items, @TypeOf(new_builder), new_builder),
        );
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
                .e_object => {
                    if (entry.value.?.asProperty(".")) |dot| {
                        if (dot.expr.asString(lockfile.allocator)) |s| {
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
            builder.count(entry.key.?.asString(lockfile.allocator).?);
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
        const k = key.asString(lockfile.allocator).?;
        if (k.len == 0) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Missing overridden package name", .{});
            continue;
        }

        const name_hash = String.Builder.stringHash(k);

        const value = value: {
            // for one level deep, we will only support a string and  { ".": value }
            const value_expr = prop.value.?;
            if (value_expr.data == .e_string) {
                break :value value_expr;
            } else if (value_expr.data == .e_object) {
                if (value_expr.asProperty(".")) |dot| {
                    if (dot.expr.data == .e_string) {
                        if (value_expr.data.e_object.properties.len > 1) {
                            try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Bun currently does not support nested \"overrides\"", .{});
                        }
                        break :value dot.expr;
                    } else {
                        try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
                        continue;
                    }
                } else {
                    try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Bun currently does not support nested \"overrides\"", .{});
                    continue;
                }
            }
            try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
            continue;
        };

        const version_str = value.data.e_string.slice(lockfile.allocator);
        if (strings.hasPrefixComptime(version_str, "patch:")) {
            // TODO(dylan-conway): apply .patch files to packages
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
            continue;
        }

        if (try parseOverrideValue(
            "override",
            lockfile,
            pm,
            root_package,
            source,
            value.loc,
            log,
            k,
            version_str,
            builder,
        )) |version| {
            this.map.putAssumeCapacity(name_hash, version);
        }
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
        // currently we only support one level deep, so we should error if there are more than one
        // - "foo/bar":
        // - "@namespace/hello/world"
        if (k[0] == '@') {
            const first_slash = strings.indexOfChar(k, '/') orelse {
                try log.addWarningFmt(source, key.loc, lockfile.allocator, "Invalid package name \"{s}\"", .{k});
                continue;
            };
            if (strings.indexOfChar(k[first_slash + 1 ..], '/') != null) {
                try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support nested \"resolutions\"", .{});
                continue;
            }
        } else if (strings.indexOfChar(k, '/') != null) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support nested \"resolutions\"", .{});
            continue;
        }

        const version_str = value.data.e_string.data;
        if (strings.hasPrefixComptime(version_str, "patch:")) {
            // TODO(dylan-conway): apply .patch files to packages
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"resolutions\"", .{});
            continue;
        }

        if (try parseOverrideValue(
            "resolution",
            lockfile,
            pm,
            root_package,
            source,
            value.loc,
            log,
            k,
            version_str,
            builder,
        )) |version| {
            const name_hash = String.Builder.stringHash(k);
            this.map.putAssumeCapacity(name_hash, version);
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

const OverrideMap = @This();
const std = @import("std");
const bun = @import("bun");
const Dependency = bun.install.Dependency;
const Lockfile = bun.install.Lockfile;
const PackageManager = bun.install.PackageManager;
const String = bun.Semver.String;
const Expr = bun.JSAst.Expr;
const logger = bun.logger;
const strings = bun.strings;
const Output = bun.Output;
const Environment = bun.Environment;
const PackageNameHash = bun.install.PackageNameHash;
const ArrayIdentityContext = bun.ArrayIdentityContext;
const Allocator = std.mem.Allocator;
const string = []const u8;
const assert = bun.assert;
