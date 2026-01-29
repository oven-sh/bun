const OverrideMap = @This();

const debug = Output.scoped(.OverrideMap, .visible);

map: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},

/// Tree of override nodes for nested/scoped overrides.
/// Node 0 is the virtual root (has no name/value, only children).
nodes: std.ArrayListUnmanaged(OverrideNode) = .{},

pub const NodeID = u16;
pub const invalid_node_id = std.math.maxInt(NodeID);

pub const OverrideNode = struct {
    name: String, // package name (empty for root)
    name_hash: PackageNameHash,
    key_spec: String, // version constraint from "@..." in key (empty = any version)
    value: ?Dependency, // override value (null = no override, just a context node)
    first_child: NodeID, // first child node, or invalid_node_id
    next_sibling: NodeID, // next sibling node, or invalid_node_id
    parent: NodeID, // parent node, or invalid_node_id for root

    /// Serializable external representation for binary lockfile.
    pub const External = extern struct {
        name_hash: PackageNameHash,
        name: String,
        key_spec: String,
        has_value: u8,
        value: Dependency.External,
        _padding: [1]u8 = .{0} ** 1,
        first_child: NodeID,
        next_sibling: NodeID,
    };

    pub fn toExternal(this: OverrideNode) External {
        return .{
            .name_hash = this.name_hash,
            .name = this.name,
            .key_spec = this.key_spec,
            .has_value = if (this.value != null) 1 else 0,
            .value = if (this.value) |v| v.toExternal() else std.mem.zeroes(Dependency.External),
            .first_child = this.first_child,
            .next_sibling = this.next_sibling,
        };
    }

    pub fn fromExternal(ext: External, context: Dependency.Context) OverrideNode {
        return .{
            .name = ext.name,
            .name_hash = ext.name_hash,
            .key_spec = ext.key_spec,
            .value = if (ext.has_value != 0) Dependency.toDependency(ext.value, context) else null,
            .first_child = ext.first_child,
            .next_sibling = ext.next_sibling,
            .parent = invalid_node_id, // rebuilt by rebuildParentPointers
        };
    }
};

/// Check whether the tree has any non-root nodes.
pub fn hasTree(this: *const OverrideMap) bool {
    if (this.nodes.items.len == 0) return false;
    return this.nodes.items[0].first_child != invalid_node_id;
}

/// Find a child of `parent_node_id` matching `name_hash`.
/// If `after` is not invalid_node_id, skip children up to and including `after` (for iterating multiple matches).
pub fn findChild(this: *const OverrideMap, parent_node_id: NodeID, name_hash: PackageNameHash) ?NodeID {
    return this.findChildAfter(parent_node_id, name_hash, invalid_node_id);
}

/// Find a child of `parent_node_id` matching `name_hash`, starting after `after_id`.
/// Pass `invalid_node_id` to start from the first child.
pub fn findChildAfter(this: *const OverrideMap, parent_node_id: NodeID, name_hash: PackageNameHash, after_id: NodeID) ?NodeID {
    if (parent_node_id >= this.nodes.items.len) return null;
    var child_id = if (after_id != invalid_node_id)
        this.nodes.items[after_id].next_sibling
    else
        this.nodes.items[parent_node_id].first_child;
    while (child_id != invalid_node_id) {
        if (child_id >= this.nodes.items.len) return null;
        const child = this.nodes.items[child_id];
        if (child.name_hash == name_hash) return child_id;
        child_id = child.next_sibling;
    }
    return null;
}

/// Walk up from `context_node_id` through ancestors, checking each level's children
/// for a match. Returns the most specific (deepest) matching child.
/// This implements npm's "ruleset" semantics where closer overrides shadow ancestor overrides.
pub fn findOverrideInContext(this: *const OverrideMap, context_node_id: NodeID, name_hash: PackageNameHash) ?NodeID {
    var ctx = context_node_id;
    while (true) {
        if (this.findChild(ctx, name_hash)) |child_id| return child_id;
        if (ctx == 0) return null;
        const parent = this.nodes.items[ctx].parent;
        if (parent == invalid_node_id) return null;
        ctx = parent;
    }
}

/// Get the flat global override for a name_hash (existing behavior).
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

    // Sort tree children at each level by name_hash for deterministic comparison
    for (this.nodes.items) |*node| {
        this.sortChildren(node);
    }
}

fn sortChildren(this: *OverrideMap, node: *OverrideNode) void {
    var stack_fallback = std.heap.stackFallback(257 * @sizeOf(NodeID), bun.default_allocator);
    const allocator = stack_fallback.get();

    var child_count: usize = 0;
    var child_id = node.first_child;
    while (child_id != invalid_node_id) {
        child_count += 1;
        if (child_id >= this.nodes.items.len) break;
        child_id = this.nodes.items[child_id].next_sibling;
    }
    if (child_count < 2) return;

    const children_slice = allocator.alloc(NodeID, child_count) catch return;
    defer allocator.free(children_slice);

    var idx: usize = 0;
    child_id = node.first_child;
    while (child_id != invalid_node_id and idx < child_count) {
        children_slice[idx] = child_id;
        idx += 1;
        if (child_id >= this.nodes.items.len) break;
        child_id = this.nodes.items[child_id].next_sibling;
    }

    const nodes_ptr = this.nodes.items.ptr;
    const SortCtx = struct {
        nodes: [*]const OverrideNode,
        pub fn lessThan(ctx: @This(), a: NodeID, b: NodeID) bool {
            return ctx.nodes[a].name_hash < ctx.nodes[b].name_hash;
        }
    };
    std.sort.pdq(NodeID, children_slice, SortCtx{ .nodes = nodes_ptr }, SortCtx.lessThan);

    // Relink
    node.first_child = children_slice[0];
    for (children_slice[0 .. child_count - 1], children_slice[1..child_count]) |curr, next| {
        this.nodes.items[curr].next_sibling = next;
    }
    this.nodes.items[children_slice[child_count - 1]].next_sibling = invalid_node_id;
}

pub fn deinit(this: *OverrideMap, allocator: Allocator) void {
    this.map.deinit(allocator);
    this.nodes.deinit(allocator);
}

/// Rebuild parent pointers from the first_child/next_sibling links.
/// Called after deserializing from binary lockfile where parent is not stored.
pub fn rebuildParentPointers(this: *OverrideMap) void {
    for (this.nodes.items) |*node| {
        node.parent = invalid_node_id;
    }
    for (this.nodes.items, 0..) |node, i| {
        var child_id = node.first_child;
        while (child_id != invalid_node_id) {
            if (child_id >= this.nodes.items.len) break;
            this.nodes.items[child_id].parent = @intCast(i);
            child_id = this.nodes.items[child_id].next_sibling;
        }
    }
}

pub fn count(this: *OverrideMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
    for (this.map.values()) |dep| {
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }
    // Count strings in tree nodes
    const buf = lockfile.buffers.string_bytes.items;
    for (this.nodes.items) |node| {
        if (!node.name.isEmpty()) {
            builder.count(node.name.slice(buf));
        }
        if (!node.key_spec.isEmpty()) {
            builder.count(node.key_spec.slice(buf));
        }
        if (node.value) |dep| {
            dep.count(buf, @TypeOf(builder), builder);
        }
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

    // Clone tree nodes
    if (this.nodes.items.len > 0) {
        try new.nodes.ensureTotalCapacity(new_lockfile.allocator, this.nodes.items.len);
        const old_buf = old_lockfile.buffers.string_bytes.items;
        for (this.nodes.items) |node| {
            const new_name = if (!node.name.isEmpty())
                new_builder.append(String, node.name.slice(old_buf))
            else
                String{};
            const new_key_spec = if (!node.key_spec.isEmpty())
                new_builder.append(String, node.key_spec.slice(old_buf))
            else
                String{};
            const new_value = if (node.value) |dep|
                try dep.clone(pm, old_buf, @TypeOf(new_builder), new_builder)
            else
                null;
            new.nodes.appendAssumeCapacity(.{
                .name = new_name,
                .name_hash = node.name_hash,
                .key_spec = new_key_spec,
                .value = new_value,
                .first_child = node.first_child,
                .next_sibling = node.next_sibling,
                .parent = node.parent,
            });
        }
    }

    return new;
}

/// Compare two override trees for semantic equality.
/// Trees are compared by walking children in sorted order (by name_hash),
/// so structural differences in node layout don't cause false mismatches.
pub fn treeEquals(this: *const OverrideMap, other: *const OverrideMap, this_buf: string, other_buf: string) bool {
    if (this.nodes.items.len != other.nodes.items.len) return false;
    if (this.nodes.items.len == 0) return true;
    // Both trees have a root at node 0; walk recursively
    return subtreeEquals(this, other, 0, 0, this_buf, other_buf);
}

fn subtreeEquals(this: *const OverrideMap, other: *const OverrideMap, this_id: NodeID, other_id: NodeID, this_buf: string, other_buf: string) bool {
    const a = this.nodes.items[this_id];
    const b = other.nodes.items[other_id];

    if (a.name_hash != b.name_hash) return false;

    // Compare key_spec
    const a_spec = if (!a.key_spec.isEmpty()) a.key_spec.slice(this_buf) else "";
    const b_spec = if (!b.key_spec.isEmpty()) b.key_spec.slice(other_buf) else "";
    if (!strings.eql(a_spec, b_spec)) return false;

    // Compare values
    if (a.value != null and b.value != null) {
        if (!a.value.?.eql(&b.value.?, this_buf, other_buf)) return false;
    } else if (a.value != null or b.value != null) {
        return false;
    }

    // Compare children by walking both linked lists (already sorted by name_hash after sort())
    var a_child = a.first_child;
    var b_child = b.first_child;
    while (a_child != invalid_node_id and b_child != invalid_node_id) {
        if (!subtreeEquals(this, other, a_child, b_child, this_buf, other_buf)) return false;
        a_child = this.nodes.items[a_child].next_sibling;
        b_child = other.nodes.items[b_child].next_sibling;
    }
    // Both should be exhausted
    return a_child == invalid_node_id and b_child == invalid_node_id;
}

/// Ensure root node exists.
pub fn ensureRootNode(this: *OverrideMap, allocator: Allocator) !void {
    if (this.nodes.items.len == 0) {
        try this.nodes.append(allocator, .{
            .name = String{},
            .name_hash = 0,
            .key_spec = String{},
            .value = null,
            .first_child = invalid_node_id,
            .next_sibling = invalid_node_id,
            .parent = invalid_node_id,
        });
    }
}

/// Add a child node under `parent_id`. If a child with the same `name_hash` and `key_spec` already exists, return it.
/// Different key_specs for the same name create separate nodes (e.g., "express@^3" and "express@^4").
/// `buf` is the string buffer used to compare key_spec values.
pub fn getOrAddChild(this: *OverrideMap, allocator: Allocator, parent_id: NodeID, node: OverrideNode, buf: string) !NodeID {
    // Check if child already exists with matching name_hash AND key_spec
    var child_id = this.nodes.items[parent_id].first_child;
    while (child_id != invalid_node_id) {
        if (child_id >= this.nodes.items.len) break;
        if (this.nodes.items[child_id].name_hash == node.name_hash) {
            const existing_spec = this.nodes.items[child_id].key_spec.slice(buf);
            const new_spec = node.key_spec.slice(buf);
            if (strings.eql(existing_spec, new_spec)) {
                // Existing node found - update value if the new one has a value and the existing doesn't
                if (node.value != null and this.nodes.items[child_id].value == null) {
                    this.nodes.items[child_id].value = node.value;
                }
                return child_id;
            }
        }
        child_id = this.nodes.items[child_id].next_sibling;
    }

    // Create new node
    const new_id: NodeID = @intCast(this.nodes.items.len);
    var new_node = node;
    new_node.parent = parent_id;
    try this.nodes.append(allocator, new_node);

    // Prepend as first child of parent
    this.nodes.items[new_id].next_sibling = this.nodes.items[parent_id].first_child;
    this.nodes.items[parent_id].first_child = new_id;

    return new_id;
}

/// Parse a key like "foo", "foo@^2.0.0", "@scope/foo@^2" into (name, key_spec).
/// Split at the last `@` that isn't at position 0.
pub fn parseKeyWithVersion(k: []const u8) struct { name: []const u8, spec: []const u8 } {
    if (k.len == 0) return .{ .name = k, .spec = "" };

    // Find the last '@' that isn't at position 0
    var i: usize = k.len;
    while (i > 1) {
        i -= 1;
        if (k[i] == '@') {
            return .{ .name = k[0..i], .spec = k[i + 1 ..] };
        }
    }
    return .{ .name = k, .spec = "" };
}

/// Split a pnpm-style key at `>`. For example:
/// "bar@1>foo" → ["bar@1", "foo"]
/// "@scope/bar>foo@2" → ["@scope/bar", "foo@2"]
fn splitPnpmDelimiter(k: []const u8) ?struct { parent: []const u8, child: []const u8 } {
    // pnpm splits at `>` preceded by a non-space, non-`|`, non-`@` char
    var i: usize = 1; // skip first char
    while (i < k.len) : (i += 1) {
        if (k[i] == '>') {
            if (k[i - 1] != ' ' and k[i - 1] != '|' and k[i - 1] != '@') {
                if (i + 1 < k.len) {
                    return .{ .parent = k[0..i], .child = k[i + 1 ..] };
                }
            }
        }
    }
    return null;
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

        countOverrideObject(lockfile, overrides.expr, builder);
    } else if (expr.asProperty("resolutions")) |resolutions| {
        if (resolutions.expr.data != .e_object)
            return;

        for (resolutions.expr.data.e_object.properties.slice()) |entry| {
            // Count all segments from the key path
            var k = entry.key.?.asString(lockfile.allocator).?;
            // Strip **/ prefixes
            while (strings.hasPrefixComptime(k, "**/")) k = k[3..];
            builder.count(k);
            // For path-based resolutions, also count individual segments
            countPathSegments(k, builder);
            builder.count(entry.value.?.asString(lockfile.allocator) orelse continue);
        }
    }

    // Also count pnpm.overrides
    if (expr.asProperty("pnpm")) |pnpm| {
        if (pnpm.expr.asProperty("overrides")) |pnpm_overrides| {
            if (pnpm_overrides.expr.data == .e_object) {
                countOverrideObject(lockfile, pnpm_overrides.expr, builder);
            }
        }
    }
}

fn countOverrideObject(lockfile: *Lockfile, expr: Expr, builder: *Lockfile.StringBuilder) void {
    if (expr.data != .e_object) return;
    for (expr.data.e_object.properties.slice()) |entry| {
        const k = entry.key.?.asString(lockfile.allocator).?;
        builder.count(k);
        // Also count the name part without version constraint
        const parsed = parseKeyWithVersion(k);
        if (parsed.spec.len > 0) {
            builder.count(parsed.name);
            builder.count(parsed.spec);
        }
        // Check for > delimiter
        if (splitPnpmDelimiter(k)) |parts| {
            builder.count(parts.parent);
            builder.count(parts.child);
            const parent_parsed = parseKeyWithVersion(parts.parent);
            if (parent_parsed.spec.len > 0) {
                builder.count(parent_parsed.name);
                builder.count(parent_parsed.spec);
            }
            const child_parsed = parseKeyWithVersion(parts.child);
            if (child_parsed.spec.len > 0) {
                builder.count(child_parsed.name);
                builder.count(child_parsed.spec);
            }
        }
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
                // Recursively count nested objects
                countOverrideObject(lockfile, entry.value.?, builder);
            },
            else => {},
        }
    }
}

fn countPathSegments(k: []const u8, builder: *Lockfile.StringBuilder) void {
    var remaining = k;
    while (true) {
        // Handle scoped packages
        if (remaining.len > 0 and remaining[0] == '@') {
            const first_slash = strings.indexOfChar(remaining, '/') orelse break;
            if (first_slash + 1 < remaining.len) {
                const after_scope = remaining[first_slash + 1 ..];
                const next_slash = strings.indexOfChar(after_scope, '/');
                if (next_slash) |ns| {
                    const segment = remaining[0 .. first_slash + 1 + ns];
                    builder.count(segment);
                    remaining = after_scope[ns + 1 ..];
                    // Strip **/
                    while (strings.hasPrefixComptime(remaining, "**/")) remaining = remaining[3..];
                    continue;
                } else {
                    // Last segment
                    builder.count(remaining);
                    break;
                }
            } else break;
        } else {
            const slash = strings.indexOfChar(remaining, '/');
            if (slash) |s| {
                builder.count(remaining[0..s]);
                remaining = remaining[s + 1 ..];
                while (strings.hasPrefixComptime(remaining, "**/")) remaining = remaining[3..];
            } else {
                builder.count(remaining);
                break;
            }
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

    // Also parse pnpm.overrides (additive)
    if (expr.asProperty("pnpm")) |pnpm| {
        if (pnpm.expr.asProperty("overrides")) |pnpm_overrides| {
            try this.parseFromPnpmOverrides(pm, lockfile, root_package, json_source, log, pnpm_overrides.expr, builder);
        }
    }

    debug("parsed {d} overrides ({d} tree nodes)", .{ this.map.entries.len, this.nodes.items.len });
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

    try this.parseOverrideObject(pm, lockfile, root_package, source, log, expr, builder, 0, true);
}

/// Recursively parse an override object, building the tree structure.
fn parseOverrideObject(
    this: *OverrideMap,
    pm: *PackageManager,
    lockfile: *Lockfile,
    root_package: *Lockfile.Package,
    source: *const logger.Source,
    log: *logger.Log,
    expr: Expr,
    builder: *Lockfile.StringBuilder,
    parent_node_id: NodeID,
    is_root_level: bool,
) !void {
    if (expr.data != .e_object) return;

    for (expr.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        const k = key.asString(lockfile.allocator).?;
        if (k.len == 0) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Missing overridden package name", .{});
            continue;
        }

        // Skip "." key (handled by parent)
        if (strings.eql(k, ".")) continue;

        // Check for pnpm-style > delimiter in key
        if (splitPnpmDelimiter(k)) |parts| {
            try this.parsePnpmChain(pm, lockfile, root_package, source, log, parts.parent, parts.child, prop.value.?, builder, parent_node_id);
            continue;
        }

        const parsed_key = parseKeyWithVersion(k);
        const pkg_name = parsed_key.name;
        const key_spec_str = parsed_key.spec;
        const name_hash = String.Builder.stringHash(pkg_name);

        const value_expr = prop.value.?;

        if (value_expr.data == .e_string) {
            // Leaf: string value
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
                pkg_name,
                version_str,
                builder,
            )) |version| {
                if (is_root_level and parent_node_id == 0) {
                    // Global override: add to flat map
                    this.map.putAssumeCapacity(name_hash, version);
                } else {
                    // Nested override: add to tree only
                    try this.ensureRootNode(lockfile.allocator);
                    const key_spec = if (key_spec_str.len > 0) builder.append(String, key_spec_str) else String{};
                    _ = try this.getOrAddChild(lockfile.allocator, parent_node_id, .{
                        .name = builder.appendWithHash(String, pkg_name, name_hash),
                        .name_hash = name_hash,
                        .key_spec = key_spec,
                        .value = version,
                        .first_child = invalid_node_id,
                        .next_sibling = invalid_node_id,
                        .parent = invalid_node_id,
                    }, lockfile.buffers.string_bytes.items);
                }
            }
        } else if (value_expr.data == .e_object) {
            // Object value: can have "." for self-override plus nested children
            var self_value: ?Dependency = null;

            if (value_expr.asProperty(".")) |dot| {
                if (dot.expr.data == .e_string) {
                    const version_str = dot.expr.data.e_string.slice(lockfile.allocator);
                    if (!strings.hasPrefixComptime(version_str, "patch:")) {
                        self_value = try parseOverrideValue(
                            "override",
                            lockfile,
                            pm,
                            root_package,
                            source,
                            dot.expr.loc,
                            log,
                            pkg_name,
                            version_str,
                            builder,
                        );
                    }
                }
            }

            // Check if there are non-"." properties (nested children)
            var has_children = false;
            for (value_expr.data.e_object.properties.slice()) |child_prop| {
                const child_key = child_prop.key.?.asString(lockfile.allocator).?;
                if (!strings.eql(child_key, ".")) {
                    has_children = true;
                    break;
                }
            }

            if (is_root_level and parent_node_id == 0 and self_value != null and !has_children) {
                // Simple case: only "." key at root level, treat as flat override
                this.map.putAssumeCapacity(name_hash, self_value.?);
            } else {
                // Add to tree
                try this.ensureRootNode(lockfile.allocator);
                const key_spec = if (key_spec_str.len > 0) builder.append(String, key_spec_str) else String{};

                if (is_root_level and self_value != null) {
                    // Also add to flat map for backward compat
                    this.map.putAssumeCapacity(name_hash, self_value.?);
                }

                const node_id = try this.getOrAddChild(lockfile.allocator, parent_node_id, .{
                    .name = builder.appendWithHash(String, pkg_name, name_hash),
                    .name_hash = name_hash,
                    .key_spec = key_spec,
                    .value = self_value,
                    .first_child = invalid_node_id,
                    .next_sibling = invalid_node_id,
                    .parent = invalid_node_id,
                }, lockfile.buffers.string_bytes.items);

                // Recurse into children
                try this.parseOverrideObject(pm, lockfile, root_package, source, log, value_expr, builder, node_id, false);
            }
        } else {
            try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
        }
    }
}

/// Parse a pnpm-style "parent>child" chain for overrides.
fn parsePnpmChain(
    this: *OverrideMap,
    pm: *PackageManager,
    lockfile: *Lockfile,
    root_package: *Lockfile.Package,
    source: *const logger.Source,
    log: *logger.Log,
    parent_str: []const u8,
    child_str: []const u8,
    value_expr: Expr,
    builder: *Lockfile.StringBuilder,
    base_parent_id: NodeID,
) !void {
    if (value_expr.data != .e_string) return;
    const version_str = value_expr.data.e_string.slice(lockfile.allocator);
    if (strings.hasPrefixComptime(version_str, "patch:")) return;

    try this.ensureRootNode(lockfile.allocator);

    // Parse parent
    const parent_parsed = parseKeyWithVersion(parent_str);
    const parent_name_hash = String.Builder.stringHash(parent_parsed.name);
    const parent_key_spec = if (parent_parsed.spec.len > 0) builder.append(String, parent_parsed.spec) else String{};
    const parent_node_id = try this.getOrAddChild(lockfile.allocator, base_parent_id, .{
        .name = builder.appendWithHash(String, parent_parsed.name, parent_name_hash),
        .name_hash = parent_name_hash,
        .key_spec = parent_key_spec,
        .value = null,
        .first_child = invalid_node_id,
        .next_sibling = invalid_node_id,
        .parent = invalid_node_id,
    }, lockfile.buffers.string_bytes.items);

    // Parse child - check for further > splits
    if (splitPnpmDelimiter(child_str)) |parts| {
        try this.parsePnpmChain(pm, lockfile, root_package, source, log, parts.parent, parts.child, value_expr, builder, parent_node_id);
        return;
    }

    const child_parsed = parseKeyWithVersion(child_str);
    const child_name = child_parsed.name;
    const child_name_hash = String.Builder.stringHash(child_name);
    const child_key_spec = if (child_parsed.spec.len > 0) builder.append(String, child_parsed.spec) else String{};

    if (try parseOverrideValue(
        "override",
        lockfile,
        pm,
        root_package,
        source,
        value_expr.loc,
        log,
        child_name,
        version_str,
        builder,
    )) |version| {
        _ = try this.getOrAddChild(lockfile.allocator, parent_node_id, .{
            .name = builder.appendWithHash(String, child_name, child_name_hash),
            .name_hash = child_name_hash,
            .key_spec = child_key_spec,
            .value = version,
            .first_child = invalid_node_id,
            .next_sibling = invalid_node_id,
            .parent = invalid_node_id,
        }, lockfile.buffers.string_bytes.items);
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
        // Strip all **/ prefixes
        while (strings.hasPrefixComptime(k, "**/"))
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

        // Check for > delimiter (pnpm style in resolutions)
        if (splitPnpmDelimiter(k)) |parts| {
            try this.parsePnpmChain(pm, lockfile, root_package, source, log, parts.parent, parts.child, value, builder, 0);
            continue;
        }

        // Parse path segments (e.g., "parent/child" or "@scope/parent/child")
        const segments = splitResolutionPath(k);
        if (segments.count == 1) {
            // Simple resolution (no nesting)
            if (try parseOverrideValue(
                "resolution",
                lockfile,
                pm,
                root_package,
                source,
                value.loc,
                log,
                segments.last,
                version_str,
                builder,
            )) |version| {
                const name_hash = String.Builder.stringHash(segments.last);
                this.map.putAssumeCapacity(name_hash, version);
            }
        } else {
            // Nested resolution path: build tree chain
            try this.ensureRootNode(lockfile.allocator);
            var current_parent: NodeID = 0;

            // Add intermediate nodes
            for (0..segments.count - 1) |seg_i| {
                const seg = segments.get(seg_i);
                const seg_hash = String.Builder.stringHash(seg);
                current_parent = try this.getOrAddChild(lockfile.allocator, current_parent, .{
                    .name = builder.appendWithHash(String, seg, seg_hash),
                    .name_hash = seg_hash,
                    .key_spec = String{},
                    .value = null,
                    .first_child = invalid_node_id,
                    .next_sibling = invalid_node_id,
                    .parent = invalid_node_id,
                }, lockfile.buffers.string_bytes.items);
            }

            // Add leaf node with the override value
            if (try parseOverrideValue(
                "resolution",
                lockfile,
                pm,
                root_package,
                source,
                value.loc,
                log,
                segments.last,
                version_str,
                builder,
            )) |version| {
                const leaf_hash = String.Builder.stringHash(segments.last);
                _ = try this.getOrAddChild(lockfile.allocator, current_parent, .{
                    .name = builder.appendWithHash(String, segments.last, leaf_hash),
                    .name_hash = leaf_hash,
                    .key_spec = String{},
                    .value = version,
                    .first_child = invalid_node_id,
                    .next_sibling = invalid_node_id,
                    .parent = invalid_node_id,
                }, lockfile.buffers.string_bytes.items);
            }
        }
    }
}

const ResolutionSegments = struct {
    segments: [8][]const u8 = undefined,
    count: usize = 0,
    last: []const u8 = "",

    fn get(this: *const ResolutionSegments, idx: usize) []const u8 {
        return this.segments[idx];
    }
};

/// Split a resolution path like "parent/child" or "@scope/parent/child" into segments.
/// Handles scoped packages correctly.
fn splitResolutionPath(k: []const u8) ResolutionSegments {
    var result = ResolutionSegments{};
    var remaining = k;

    while (remaining.len > 0 and result.count < 8) {
        // Strip **/ prefixes
        while (strings.hasPrefixComptime(remaining, "**/")) remaining = remaining[3..];
        if (remaining.len == 0) break;

        if (remaining[0] == '@') {
            // Scoped package: @scope/name
            const first_slash = strings.indexOfChar(remaining, '/') orelse {
                // Malformed, treat rest as one segment
                result.segments[result.count] = remaining;
                result.count += 1;
                result.last = remaining;
                break;
            };
            if (first_slash + 1 >= remaining.len) {
                result.segments[result.count] = remaining;
                result.count += 1;
                result.last = remaining;
                break;
            }
            const after_scope = remaining[first_slash + 1 ..];
            const next_slash = strings.indexOfChar(after_scope, '/');
            if (next_slash) |ns| {
                const segment = remaining[0 .. first_slash + 1 + ns];
                result.segments[result.count] = segment;
                result.count += 1;
                remaining = after_scope[ns + 1 ..];
            } else {
                // Last segment
                result.segments[result.count] = remaining;
                result.count += 1;
                result.last = remaining;
                break;
            }
        } else {
            const slash = strings.indexOfChar(remaining, '/');
            if (slash) |s| {
                result.segments[result.count] = remaining[0..s];
                result.count += 1;
                remaining = remaining[s + 1 ..];
            } else {
                result.segments[result.count] = remaining;
                result.count += 1;
                result.last = remaining;
                break;
            }
        }
    }

    if (result.count > 0 and result.last.len == 0) {
        result.last = result.segments[result.count - 1];
    }

    return result;
}

/// Parse pnpm.overrides field
fn parseFromPnpmOverrides(
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
        try log.addWarningFmt(source, expr.loc, lockfile.allocator, "\"pnpm.overrides\" must be an object", .{});
        return;
    }

    for (expr.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        const k = key.asString(lockfile.allocator).?;
        if (k.len == 0) continue;

        const value = prop.value.?;
        if (value.data != .e_string) continue;

        // Check for > delimiter
        if (splitPnpmDelimiter(k)) |parts| {
            try this.parsePnpmChain(pm, lockfile, root_package, source, log, parts.parent, parts.child, value, builder, 0);
        } else {
            // Simple flat override
            const version_str = value.data.e_string.slice(lockfile.allocator);
            if (strings.hasPrefixComptime(version_str, "patch:")) continue;

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
                const name_hash = String.Builder.stringHash(k);
                try this.map.put(lockfile.allocator, name_hash, version);
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

/// Collect all name_hashes from tree leaf nodes (nodes with values).
pub fn collectTreeLeafHashes(this: *const OverrideMap, allocator: Allocator) ![]PackageNameHash {
    if (this.nodes.items.len == 0) return &.{};
    var result = std.ArrayListUnmanaged(PackageNameHash){};
    for (this.nodes.items) |node| {
        if (node.value != null and node.name_hash != 0) {
            // Deduplicate
            if (std.mem.indexOfScalar(PackageNameHash, result.items, node.name_hash) == null) {
                try result.append(allocator, node.name_hash);
            }
        }
    }
    return result.toOwnedSlice(allocator);
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
