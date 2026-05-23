const OverrideMap = @This();

const debug = Output.scoped(.OverrideMap, .visible);

pub const ScopedOverrideKey = extern struct {
    parent_name_hash: PackageNameHash,
    child_name_hash: PackageNameHash,
    parent_name: String = .{},
};

pub const ScopedOverrideContext = struct {
    pub fn hash(self: @This(), key: ScopedOverrideKey) u32 {
        _ = self;
        return @truncate(@as(u64, key.parent_name_hash) *% 33 +% @as(u64, key.child_name_hash));
    }

    pub fn eql(self: @This(), a: ScopedOverrideKey, b: ScopedOverrideKey, b_index: usize) bool {
        _ = self;
        _ = b_index;
        return a.parent_name_hash == b.parent_name_hash and a.child_name_hash == b.child_name_hash;
    }
};

global: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},
scoped: std.ArrayHashMapUnmanaged(ScopedOverrideKey, Dependency, ScopedOverrideContext, false) = .{},

/// Lookup an override for a dependency, checking scoped overrides first (if a parent is known),
/// then falling back to global overrides.
///
/// Lookup precedence:
/// 1. If `parent_package_id` is provided and a scoped override exists for
///    (parent_name_hash, name_hash), return the scoped override version.
/// 2. If a global override exists for `name_hash`, return the global override version.
/// 3. Otherwise, return null.
pub fn get(this: *const OverrideMap, lockfile: *const Lockfile, name_hash: PackageNameHash, parent_package_id: ?PackageID) ?Dependency.Version {
    if (this.global.count() == 0 and this.scoped.count() == 0) {
        return null;
    }

    if (parent_package_id) |pid| {
        if (pid < lockfile.packages.len) {
            const parent_name_hash = lockfile.packages.items(.name_hash)[pid];
            if (this.scoped.get(.{ .parent_name_hash = parent_name_hash, .child_name_hash = name_hash })) |dep| {
                debug("scoped override: {x} under parent {x} -> {s}", .{ name_hash, parent_name_hash, lockfile.str(&dep.version.literal) });
                return dep.version;
            }
        }
    }

    return if (this.global.get(name_hash)) |dep|
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
        .override_deps = this.global.values().ptr,
    };

    this.global.sort(&ctx);

    const ScopedCtx = struct {
        buf: string,
        scoped_keys: [*]const ScopedOverrideKey,
        override_deps: [*]const Dependency,

        pub fn lessThan(sorter: *const @This(), l: usize, r: usize) bool {
            const keys = sorter.scoped_keys;
            const l_key = keys[l];
            const r_key = keys[r];
            if (l_key.parent_name_hash != r_key.parent_name_hash) {
                return l_key.parent_name_hash < r_key.parent_name_hash;
            }
            const deps = sorter.override_deps;
            return deps[l].name.order(&deps[r].name, sorter.buf, sorter.buf) == .lt;
        }
    };

    const scoped_ctx: ScopedCtx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .scoped_keys = this.scoped.keys().ptr,
        .override_deps = this.scoped.values().ptr,
    };

    this.scoped.sort(&scoped_ctx);
}

pub fn deinit(this: *OverrideMap, allocator: Allocator) void {
    this.global.deinit(allocator);
    this.scoped.deinit(allocator);
}

pub fn count(this: *OverrideMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
    for (this.global.values()) |dep| {
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }
    for (this.scoped.values()) |dep| {
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }
    for (this.scoped.keys()) |key| {
        if (!key.parent_name.isEmpty()) {
            builder.count(key.parent_name.slice(lockfile.buffers.string_bytes.items));
        }
    }
}

pub fn clone(this: *OverrideMap, pm: *PackageManager, old_lockfile: *Lockfile, new_lockfile: *Lockfile, new_builder: *Lockfile.StringBuilder) !OverrideMap {
    var new = OverrideMap{};
    try new.global.ensureTotalCapacity(new_lockfile.allocator, this.global.entries.len);

    for (this.global.keys(), this.global.values()) |k, v| {
        new.global.putAssumeCapacity(
            k,
            try v.clone(pm, old_lockfile.buffers.string_bytes.items, @TypeOf(new_builder), new_builder),
        );
    }

    try new.scoped.ensureTotalCapacity(new_lockfile.allocator, this.scoped.entries.len);
    for (this.scoped.keys(), this.scoped.values()) |k, v| {
        const new_parent_name = if (k.parent_name.isEmpty()) String.empty else new_builder.append(String, k.parent_name.slice(old_lockfile.buffers.string_bytes.items));
        new.scoped.putAssumeCapacity(
            .{
                .parent_name_hash = k.parent_name_hash,
                .child_name_hash = k.child_name_hash,
                .parent_name = new_parent_name,
            },
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
                    for (entry.value.?.data.e_object.properties.slice()) |child_prop| {
                        const child_key = child_prop.key.?.asString(lockfile.allocator) orelse continue;
                        if (strings.eqlComptime(child_key, ".")) continue;
                        if (child_prop.value.?.data != .e_string) continue;
                        builder.count(child_key);
                        builder.count(child_prop.value.?.asString(lockfile.allocator).?);
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
        assert(this.global.entries.len == 0); // only call parse once
        assert(this.scoped.entries.len == 0);
    }
    if (expr.asProperty("overrides")) |overrides| {
        try this.parseFromOverrides(pm, lockfile, root_package, json_source, log, overrides.expr, builder);
    } else if (expr.asProperty("resolutions")) |resolutions| {
        try this.parseFromResolutions(pm, lockfile, root_package, json_source, log, resolutions.expr, builder);
    }
    debug("parsed {d} global + {d} scoped overrides", .{ this.global.entries.len, this.scoped.entries.len });
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

    // Count total child entries to size the scoped map safely
    var total_child_entries: usize = 0;
    for (expr.data.e_object.properties.slice()) |prop| {
        const val = prop.value.?;
        if (val.data == .e_object) {
            total_child_entries += val.data.e_object.properties.len;
        } else {
            total_child_entries += 1; // each entry gets at least one slot
        }
    }

    try this.global.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);
    try this.scoped.ensureUnusedCapacity(lockfile.allocator, total_child_entries);

    for (expr.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        const k = key.asString(lockfile.allocator).?;
        if (k.len == 0) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Missing overridden package name", .{});
            continue;
        }

        const name_hash = String.Builder.stringHash(k);

        // Handle global override: string value or { ".": "version" } inside nested object
        const global_override = global_override: {
            const value_expr = prop.value.?;
            if (value_expr.data == .e_string) {
                break :global_override value_expr;
            } else if (value_expr.data == .e_object) {
                if (value_expr.asProperty(".")) |dot| {
                    if (dot.expr.data == .e_string) {
                        break :global_override dot.expr;
                    }
                    try log.addWarningFmt(source, dot.expr.loc, lockfile.allocator, "Invalid \".\" override value for \"{s}\" — expected a string", .{k});
                }
            }
            break :global_override null;
        };

        if (global_override) |value| {
            const version_str = value.data.e_string.slice(lockfile.allocator);
            if (strings.hasPrefixComptime(version_str, "patch:")) {
                try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
            } else if (try parseOverrideValue(
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
                this.global.putAssumeCapacity(name_hash, version);
            }
        }

        // Handle scoped override children in the object
        if (prop.value.?.data == .e_object) {
            for (prop.value.?.data.e_object.properties.slice()) |child_prop| {
                const child_key_str = child_prop.key.?.asString(lockfile.allocator) orelse continue;
                if (strings.eqlComptime(child_key_str, ".")) continue;
                if (child_prop.value.?.data != .e_string) {
                    try log.addWarningFmt(source, child_prop.value.?.loc, lockfile.allocator, "Only one level of nested overrides is supported; non-string override values are not allowed", .{});
                    continue;
                }
                const child_version_str = child_prop.value.?.data.e_string.slice(lockfile.allocator);
                if (strings.hasPrefixComptime(child_version_str, "patch:")) {
                    try log.addWarningFmt(source, child_prop.key.?.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
                    continue;
                }
                if (try parseOverrideValue(
                    "override",
                    lockfile,
                    pm,
                    root_package,
                    source,
                    child_prop.value.?.loc,
                    log,
                    child_key_str,
                    child_version_str,
                    builder,
                )) |child_dep| {
                    const child_name_hash = String.Builder.stringHash(child_key_str);
                    // Strip version qualifier from parent key so the hash matches
                    // what get() looks up from the installed package's name_hash.
                    // e.g. "foo@1.0.0" -> hash("foo"), not hash("foo@1.0.0")
                    const stripped_parent = stripVersionSuffix(k);
                    const scoped_parent_hash = String.Builder.stringHash(stripped_parent);
                    this.scoped.putAssumeCapacity(.{
                        .parent_name_hash = scoped_parent_hash,
                        .child_name_hash = child_name_hash,
                        .parent_name = builder.append(String, k),
                    }, child_dep);
                }
            }
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
    try this.global.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);
    try this.scoped.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);
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
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"resolutions\"", .{});
            continue;
        }

        // Parse parent/child from resolution key for scoped override
        const parent_child = parseParentChild: {
            // Detect the last '/' that separates parent from child
            // For scoped packages like @scope/parent/child, the first '/' belongs to the scope
            var last_slash: ?usize = null;
            if (k.len > 0 and k[0] == '@') {
                // @scope/parent/child — first '/' belongs to the scope, take the NEXT '/' after it
                const first_slash = strings.indexOfChar(k, '/') orelse {
                    break :parseParentChild null;
                };
                if (first_slash < k.len - 1) {
                    if (strings.indexOfChar(k[first_slash + 1 ..], '/')) |rel| {
                        last_slash = first_slash + 1 + rel;
                    }
                }
            } else {
                last_slash = if (strings.indexOfChar(k, '/')) |idx| @as(usize, idx) else null;
            }

            break :parseParentChild if (last_slash) |sep| struct {
                parent: []const u8,
                child: []const u8,
            }{
                .parent = k[0..sep],
                .child = k[sep + 1 ..],
            } else null;
        };

        if (try parseOverrideValue(
            "resolution",
            lockfile,
            pm,
            root_package,
            source,
            value.loc,
            log,
            if (parent_child) |pc| pc.child else k,
            version_str,
            builder,
        )) |dep| {
            if (parent_child) |pc| {
                // Scoped resolution: parent/child
                if ((!strings.hasPrefixComptime(pc.parent, "@") and strings.containsChar(pc.parent, '/')) or
                    (!strings.hasPrefixComptime(pc.child, "@") and strings.containsChar(pc.child, '/')))
                {
                    try log.addWarningFmt(source, key.loc, lockfile.allocator, "Deeply nested resolution \"{s}\" is not supported", .{k});
                    continue;
                }
                const stripped_parent = stripVersionSuffix(pc.parent);
                const parent_name_hash = String.Builder.stringHash(stripped_parent);
                this.scoped.putAssumeCapacity(.{
                    .parent_name_hash = parent_name_hash,
                    .child_name_hash = dep.name_hash,
                    .parent_name = builder.append(String, pc.parent),
                }, dep);
            } else {
                // Global resolution
                const name_hash = String.Builder.stringHash(k);
                this.global.putAssumeCapacity(name_hash, dep);
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

/// Strip a version qualifier from a package name so the hash matches what
/// get() looks up from the installed package's name_hash. For example:
/// "foo@1.0.0" -> "foo", "@scope/pkg" -> "@scope/pkg" (no version).
/// Also handles scoped + versioned: "@scope/pkg@1.0.0" -> "@scope/pkg".
/// Assumes `@` only appears as a version qualifier after the package name,
/// never in the scope. npm registry scopes never contain `@`.
/// This allows version-qualified parent keys in npm overrides and Yarn
/// resolutions to match the installed parent package by name alone.
fn stripVersionSuffix(name: []const u8) []const u8 {
    // For scoped packages: @scope/pkg -> no version to strip
    if (name.len > 0 and name[0] == '@') {
        const first_slash = strings.indexOfChar(name, '/') orelse return name;
        // Look for @ after the scope slash: @scope/pkg@1.0.0
        if (strings.indexOfChar(name[first_slash + 1 ..], '@')) |at_idx| {
            return name[0 .. first_slash + 1 + at_idx];
        }
        return name;
    }
    // For unscoped packages: look for the first @ that introduces a version
    if (strings.indexOfChar(name, '@')) |at_idx| {
        return name[0..at_idx];
    }
    return name;
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
const PackageID = bun.install.PackageID;
const PackageNameHash = bun.install.PackageNameHash;
