const Manifest = @This();

pub const CURRENT_VERSION = bun.Semver.Version{
    .major = 0,
    .minor = 0,
    .patch = 1,
};

version: bun.Semver.Version = CURRENT_VERSION,
/// Routes which are encoded in the manifest.
///
/// The indices correspond to the `route_index` in the manifest.
///
/// Also: `manifest.routes[i] ≅ server.framework_router.routes[i]`
routes: []Route = &[_]Route{},
arena: std.heap.ArenaAllocator,

pub fn allocate(_self: Manifest) !*Manifest {
    var self = _self;
    const ptr = try self.arena.allocator().create(Manifest);
    ptr.* = self;
    return ptr;
}

pub fn deinit(self: *Manifest) void {
    self.arena.deinit();
}

pub fn fromFD(self: *Manifest, fd: bun.FileDescriptor, log: *logger.Log) !void {
    const source = fd.stdFile().readToEndAlloc(self.arena.allocator(), std.math.maxInt(usize)) catch |e| {
        try log.addErrorFmt(null, logger.Loc.Empty, log.msgs.allocator, "Failed to read manifest.json: {s}", .{@errorName(e)});
        return error.InvalidManifest;
    };
    const json_source = logger.Source.initPathString("dist/manifest.json", source);
    try self.initFromJSON(&json_source, log);
}

pub fn initFromJSON(self: *Manifest, source: *const logger.Source, log: *logger.Log) !void {
    const allocator = self.arena.allocator();

    var temp_arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer temp_arena.deinit();
    const temp_allocator = temp_arena.allocator();

    const json_source = logger.Source.initPathString(source.path.text, source.contents);
    const json_expr = bun.json.parseUTF8(&json_source, log, allocator) catch {
        try log.addError(&json_source, logger.Loc.Empty, "Failed to parse manifest.json");
        return error.InvalidManifest;
    };

    if (json_expr.data != .e_object) {
        try log.addError(&json_source, json_expr.loc, "manifest.json must be an object");
        return error.InvalidManifest;
    }

    const json_obj = json_expr.data.e_object;

    // Parse version
    const version_prop = json_obj.get("version") orelse {
        try log.addError(&json_source, json_expr.loc, "manifest.json must have a 'version' field");
        return error.InvalidManifest;
    };

    if (version_prop.data != .e_string) {
        try log.addError(&json_source, version_prop.loc, "manifest.json version must be a string");
        return error.InvalidManifest;
    }

    const version_str = version_prop.data.e_string.string(temp_allocator) catch {
        try log.addError(&json_source, version_prop.loc, "failed to parse version string");
        return error.InvalidManifest;
    };

    // Parse semantic version
    const parse_result = bun.Semver.Version.parseUTF8(version_str);
    if (!parse_result.valid) {
        try log.addErrorFmt(&json_source, json_expr.loc, log.msgs.allocator, "Invalid semantic version: '{s}'. Expected format: 'major.minor.patch' (e.g., '1.0.0')", .{version_str});
        return error.InvalidManifest;
    }

    const manifest_version = parse_result.version.min();

    // Check compatibility - major version must match
    const manifest_major = manifest_version.major;
    const manifest_minor = manifest_version.minor;
    const manifest_patch = manifest_version.patch;

    if (manifest_major != CURRENT_VERSION.major) {
        const current_version_str = try std.fmt.allocPrint(temp_allocator, "{d}.{d}.{d}", .{ CURRENT_VERSION.major, CURRENT_VERSION.minor, CURRENT_VERSION.patch });
        const manifest_version_str = try std.fmt.allocPrint(temp_allocator, "{d}.{d}.{d}", .{ manifest_major, manifest_minor, manifest_patch });

        if (manifest_major > CURRENT_VERSION.major) {
            try log.addErrorFmt(&json_source, json_expr.loc, log.msgs.allocator, "Manifest version {s} is not compatible with current version {s}. The manifest was created with a newer version of Bun. Please update Bun.", .{ manifest_version_str, current_version_str });
        } else {
            try log.addErrorFmt(&json_source, json_expr.loc, log.msgs.allocator, "Manifest version {s} is not compatible with current version {s}. The manifest needs to be regenerated with the current version of Bun.", .{ manifest_version_str, current_version_str });
        }
        return error.InvalidManifest;
    }

    // Minor and patch versions can be different - we're backwards compatible within the same major version
    self.version = manifest_version;

    // Parse entries array
    const entries_prop = json_obj.get("entries") orelse {
        try log.addError(&json_source, json_expr.loc, "manifest.json must have an 'entries' field");
        return error.InvalidManifest;
    };

    if (entries_prop.data != .e_array) {
        try log.addError(&json_source, entries_prop.loc, "manifest.json entries must be an array");
        return error.InvalidManifest;
    }

    const entries = entries_prop.data.e_array.items.slice();

    // Group entries by route_index
    var route_map = std.AutoHashMap(u32, std.ArrayList(RawManifestEntry)).init(temp_allocator);
    defer {
        var it = route_map.iterator();
        while (it.next()) |entry| {
            entry.value_ptr.deinit();
        }
        route_map.deinit();
    }

    var max_route_index: u32 = 0;

    // First pass: collect all entries grouped by route_index
    for (entries) |entry_expr| {
        if (entry_expr.data != .e_object) continue;

        const entry_obj = entry_expr.data.e_object;

        const route_index = blk: {
            const route_index_prop = entry_obj.get("route_index") orelse continue;
            if (route_index_prop.data != .e_number) continue;
            break :blk route_index_prop.data.e_number.toU32();
        };

        max_route_index = @max(max_route_index, route_index);

        const mode_prop = entry_obj.get("mode") orelse {
            try log.addError(&json_source, entry_expr.loc, "manifest entry missing required 'mode' field");
            return error.InvalidManifest;
        };
        if (mode_prop.data != .e_string) {
            try log.addError(&json_source, mode_prop.loc, "manifest entry 'mode' field must be a string");
            return error.InvalidManifest;
        }
        const mode: RawManifestEntry.Mode = if (mode_prop.data.e_string.eqlComptime("ssr"))
            .ssr
        else if (mode_prop.data.e_string.eqlComptime("ssg"))
            .ssg
        else {
            try log.addError(&json_source, mode_prop.loc, "manifest entry 'mode' must be 'ssr' or 'ssg'");
            return error.InvalidManifest;
        };

        const manifest_entry = RawManifestEntry{
            .json_obj = entry_obj,
            .mode = mode,
            .loc = entry_expr.loc,
        };

        const gop = try route_map.getOrPut(route_index);
        if (!gop.found_existing) {
            gop.value_ptr.* = std.ArrayList(RawManifestEntry).init(temp_allocator);
        }
        try gop.value_ptr.append(manifest_entry);
    }

    // Return early if no routes
    if (route_map.count() == 0) {
        self.routes = &[_]Route{};
        return;
    }

    // Allocate routes array
    var routes = try allocator.alloc(Route, max_route_index + 1);
    @memset(routes, Route{ .empty = {} });

    // Second pass: build Route structs
    var it = route_map.iterator();
    while (it.next()) |entry| {
        const route_index = entry.key_ptr.*;
        const route_entries = entry.value_ptr.items;

        if (route_entries.len == 0) continue;

        const first_mode = route_entries[0].mode;

        // Check if all entries have the same mode
        for (route_entries) |route_entry| {
            if (route_entry.mode == first_mode) {
                try log.addError(&json_source, route_entry.loc, "All entries for a route must have the same mode");
                return error.InvalidManifest;
            }
        }

        switch (first_mode) {
            .ssr => {
                // SSR route - should only have one entry
                if (route_entries.len != 1) {
                    try log.addErrorFmt(&json_source, Loc.Empty, log.msgs.allocator, "Found multiple entries for SSR route index {d}, this indicates a bug in the manifest.", .{route_index});
                    return error.InvalidManifest;
                }

                const entry_obj = route_entries[0].json_obj;

                // Parse client entrypoint
                const ep_prop = entry_obj.get("client_entrypoint") orelse {
                    try log.addError(&json_source, Loc.Empty, "SSR entry missing required 'client_entrypoint' field");
                    return error.InvalidManifest;
                };
                if (ep_prop.data != .e_string) {
                    try log.addError(&json_source, Loc.Empty, "SSR entry 'client_entrypoint' must be a string");
                    return error.InvalidManifest;
                }
                const entrypoint = try ep_prop.data.e_string.string(allocator);

                // Parse all modules
                var modules = bun.BabyList([]const u8){};
                const modules_prop = entry_obj.get("modules") orelse {
                    try log.addError(&json_source, Loc.Empty, "SSR entry missing required 'modules' field");
                    return error.InvalidManifest;
                };
                if (modules_prop.data != .e_array) {
                    try log.addError(&json_source, Loc.Empty, "SSR entry 'modules' must be an array");
                    return error.InvalidManifest;
                }
                const modules_array = modules_prop.data.e_array.items.slice();
                if (modules_array.len > 0) {
                    try modules.ensureUnusedCapacity(allocator, modules_array.len);
                    for (modules_array, 0..) |module_expr, i| {
                        if (module_expr.data != .e_string) {
                            try log.addErrorFmt(&json_source, Loc.Empty, log.msgs.allocator, "SSR entry modules[{}] must be a string", .{i});
                            return error.InvalidManifest;
                        }
                        const module_str = try module_expr.data.e_string.string(allocator);
                        try modules.append(allocator, module_str);
                    }
                } else {
                    try log.addError(&json_source, modules_prop.loc, "SSR entry 'modules' must be an array with a size of at least one element");
                    return error.InvalidManifest;
                }

                const styles = try parseStyles(allocator, entry_obj);

                routes[route_index] = .{
                    .ssr = .{
                        .entrypoint = entrypoint,
                        .modules = modules,
                        .styles = styles,
                    },
                };
            },
            .ssg => {
                if (route_entries.len == 1) {
                    // Single SSG entry (no params or single param combo)
                    const entry_obj = route_entries[0].json_obj;
                    const ep_prop = entry_obj.get("entrypoint") orelse {
                        try log.addError(&json_source, Loc.Empty, "SSG entry missing required 'entrypoint' field");
                        return error.InvalidManifest;
                    };
                    if (ep_prop.data != .e_string) {
                        try log.addError(&json_source, Loc.Empty, "SSG entry 'entrypoint' must be a string");
                        return error.InvalidManifest;
                    }
                    const entrypoint = try ep_prop.data.e_string.string(allocator);

                    const params = try parseParams(allocator, entry_obj);
                    const styles = try parseStyles(allocator, entry_obj);

                    routes[route_index] = .{
                        .ssg = .{
                            .entrypoint = entrypoint,
                            .params = params,
                            .styles = styles,
                        },
                    };
                } else {
                    // Multiple SSG entries for the same route (different params)
                    var ssg_map = Route.SSGMany{};

                    for (route_entries) |route_entry| {
                        const entry_obj = route_entry.json_obj;
                        const ep_prop = entry_obj.get("entrypoint") orelse {
                            try log.addError(&json_source, Loc.Empty, "SSG entry missing required 'entrypoint' field");
                            return error.InvalidManifest;
                        };
                        if (ep_prop.data != .e_string) {
                            try log.addError(&json_source, Loc.Empty, "SSG entry 'entrypoint' must be a string");
                            return error.InvalidManifest;
                        }
                        const entrypoint = try ep_prop.data.e_string.string(allocator);

                        const params = try parseParams(allocator, entry_obj);
                        const styles = try parseStyles(allocator, entry_obj);

                        const ssg = Route.SSG{
                            .entrypoint = entrypoint,
                            .params = params,
                            .styles = styles,
                        };

                        try ssg_map.put(allocator, ssg, {});
                    }

                    routes[route_index] = .{ .ssg_many = ssg_map };
                }
            },
        }
    }

    self.routes = routes;
}

fn parseParams(allocator: Allocator, entry_obj: *const E.Object) !bun.BabyList(ParamEntry) {
    var params = bun.BabyList(ParamEntry){};

    // Params is optional for SSG entries - it's only present for dynamic routes
    if (entry_obj.get("params")) |params_prop| {
        if (params_prop.data != .e_object) {
            // If params is present, it must be an object
            return error.InvalidManifest;
        }
        const params_obj = params_prop.data.e_object;

        for (params_obj.properties.slice()) |prop| {
            if (prop.value) |value_expr| {
                if (value_expr.data != .e_string) {
                    // All param values must be strings
                    return error.InvalidManifest;
                }
                const param_entry = ParamEntry{
                    .key = prop.key.?.asString(allocator) orelse "",
                    .value = try value_expr.data.e_string.string(allocator),
                };
                try params.append(allocator, param_entry);
            }
        }
    }

    return params;
}

fn parseStyles(allocator: Allocator, entry_obj: *const E.Object) !Styles {
    var styles = Styles{};

    // Styles field is required and must be an array (can be empty)
    const styles_prop = entry_obj.get("styles") orelse {
        return error.InvalidManifest;
    };

    if (styles_prop.data != .e_array) {
        return error.InvalidManifest;
    }

    const styles_array = styles_prop.data.e_array.items.slice();

    // Preallocate capacity based on array length
    if (styles_array.len > 0) {
        try styles.ensureUnusedCapacity(allocator, styles_array.len);
    }

    // Validate all elements are strings and add them
    for (styles_array) |style_expr| {
        if (style_expr.data != .e_string) {
            // All style array elements must be strings
            return error.InvalidManifest;
        }
        const style_str = try style_expr.data.e_string.string(allocator);
        try styles.append(allocator, style_str);
    }

    return styles;
}

const Route = union(enum) {
    empty,
    ssr: SSR,
    ssg: SSG,
    ssg_many: SSGMany,

    /// A route which has been server-side rendered
    const SSR = struct {
        entrypoint: []const u8,
        modules: bun.BabyList([]const u8),
        styles: Styles,
    };

    /// A route which has been statically generated
    const SSG = struct {
        entrypoint: []const u8,
        params: bun.BabyList(ParamEntry),
        styles: Styles,
    };

    /// A route which has been statically generated and has multiple pages
    /// associated with it.
    ///
    /// Example:
    /// - Pattern => "/blog/[slug].tsx"
    /// - Pages   => ["/blog/foo.tsx", "/blog/bar.tsx"]
    ///
    /// The routes are stored in hashmap and they are hashed by the params as
    /// those are unique for a given route
    ///
    /// We do this so we can quickly disambiguate based on the params
    const SSGMany = std.ArrayHashMapUnmanaged(
        SSG,
        void,
        struct {
            pub fn hash(_: @This(), key: SSG) u32 {
                var hasher = std.hash.Wyhash.init(0);
                for (key.params.slice()) |param| {
                    hasher.update(param.key);
                    hasher.update(param.value);
                }
                return @truncate(hasher.final());
            }

            pub fn eql(
                _: @This(),
                a: SSG,
                b: SSG,
                _: usize,
            ) bool {
                return a.params.eql(&b.params);
            }
        },
        false,
    );

    const Index = bun.GenericIndex(u32, Route);
    const Map = std.AutoHashMapUnmanaged(Route.Index, Route);
};

const RawManifestEntry = struct {
    json_obj: *const E.Object,
    loc: logger.Loc,
    mode: Mode,

    const Mode = enum { ssr, ssg };
};

const ParamEntriesHash = u32;

const ParamEntry = struct {
    key: []const u8,
    value: []const u8,

    pub fn eql(a: *const ParamEntry, b: *const ParamEntry) bool {
        return bun.strings.eql(a.key, b.key) and
            bun.strings.eql(a.value, b.value);
    }
};

const Styles = bun.BabyList([]const u8);

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const logger = bun.logger;
const Loc = logger.Loc;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const E = bun.ast.E;

const DirInfo = bun.resolver.DirInfo;
const Resolver = bun.resolver.Resolver;

const mem = std.mem;
const Allocator = mem.Allocator;
