const Manifest = @This();

pub const CURRENT_VERSION = bun.Semver.Version{
    .major = 0,
    .minor = 0,
    .patch = 1,
};

version: bun.Semver.Version = CURRENT_VERSION,

/// All allocations except for the router are handled with this arena
arena: std.heap.ArenaAllocator,

/// Routes which are encoded in the manifest.
///
/// The indices correspond to the `route_index` in the manifest.
///
/// Also: `manifest.routes[i] ≅ server.framework_router.routes[i]`
routes: []Route = &[_]Route{},
/// Build output directory, defaults to "dist"
build_output_dir: []const u8 = "dist",
/// Router types with their server entrypoints
router_types: []RouterType = &[_]RouterType{},
/// Static assets
assets: [][]const u8 = &[_][]const u8{},

/// All memory allocated with bun.default_allocator here
router: bun.ptr.Owned(*FrameworkRouter),

pub const RouterType = struct {
    /// Path to the server entrypoint module for this router type
    server_entrypoint: []const u8,
};

pub fn allocate(_self: Manifest) !*Manifest {
    var self = _self;
    const ptr = try self.arena.allocator().create(Manifest);
    ptr.* = self;
    return ptr;
}

pub fn deinit(self: *Manifest) void {
    self.router.get().deinit(bun.default_allocator);
    self.router.deinitShallow();
    self.arena.deinit();
}

pub fn fromFD(self: *Manifest, fd: bun.FileDescriptor, log: *logger.Log) !void {
    const source = fd.stdFile().readToEndAlloc(self.arena.allocator(), std.math.maxInt(usize)) catch |e| {
        try log.addErrorFmt(null, logger.Loc.Empty, log.msgs.allocator, "Failed to read manifest.json: {s}", .{@errorName(e)});
        return error.InvalidManifest;
    };
    const json_source = logger.Source.initPathString("dist/manifest.json", source);
    try self.initFromJSON(&json_source, log);

    bun.assertf(self.routes.len == self.router.get().routes.items.len, "Routes length mismatch, self.routes.len: {d}, self.router.get().routes.items.len: {d}", .{ self.routes.len, self.router.get().routes.items.len });
}

fn initFromJSON(self: *Manifest, source: *const logger.Source, log: *logger.Log) !void {
    const router: *FrameworkRouter = self.router.get();
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

    // Parse build_output_dir (optional, defaults to "dist")
    if (json_obj.get("build_output_dir")) |build_output_dir_prop| {
        if (build_output_dir_prop.data == .e_string) {
            self.build_output_dir = try build_output_dir_prop.data.e_string.string(allocator);
        } else if (build_output_dir_prop.data != .e_null) {
            try log.addError(&json_source, build_output_dir_prop.loc, "manifest.json build_output_dir must be a string or null");
            return error.InvalidManifest;
        }
    }

    if (json_obj.get("assets")) |assets_prop| {
        if (assets_prop.data == .e_array) {
            const items = assets_prop.data.e_array.items.slice();
            self.assets = try allocator.alloc([]const u8, items.len);

            for (items, self.assets) |*in, *out| {
                if (in.data != .e_string) {
                    // All style array elements must be strings
                    try log.addError(&json_source, Loc.Empty, "\"assets\" must be an array of strings");
                    return error.InvalidManifest;
                }
                const style_str = try in.data.e_string.string(allocator);
                out.* = style_str;
            }
        }
    }

    // Parse router_types array (optional)
    if (json_obj.get("routerTypes")) |router_types_prop| {
        if (router_types_prop.data == .e_array) {
            const router_types_array = router_types_prop.data.e_array.items.slice();
            self.router_types = try allocator.alloc(RouterType, router_types_array.len);

            for (router_types_array, 0..) |router_type_expr, i| {
                if (router_type_expr.data != .e_object) {
                    try log.addError(&json_source, router_type_expr.loc, "manifest.json router_types array must contain objects");
                    return error.InvalidManifest;
                }

                const router_type_obj = router_type_expr.data.e_object;

                // Parse server_entrypoint
                const server_entrypoint_prop = router_type_obj.get("serverEntrypoint") orelse {
                    try log.addError(&json_source, router_type_expr.loc, "routerType entry missing required 'serverEntrypoint' field");
                    return error.InvalidManifest;
                };

                if (server_entrypoint_prop.data != .e_string) {
                    try log.addError(&json_source, server_entrypoint_prop.loc, "routerType 'serverEntrypoint' must be a string");
                    return error.InvalidManifest;
                }

                self.router_types[i] = .{
                    .server_entrypoint = try server_entrypoint_prop.data.e_string.string(allocator),
                };
            }
        } else if (router_types_prop.data != .e_null) {
            try log.addError(&json_source, router_types_prop.loc, "manifest.json router_types must be an array or null");
            return error.InvalidManifest;
        }
    }

    // Parse routes array
    const routes_prop = json_obj.get("routes") orelse {
        try log.addError(&json_source, json_expr.loc, "manifest.json must have an 'routes' field");
        return error.InvalidManifest;
    };

    if (routes_prop.data != .e_array) {
        try log.addError(&json_source, routes_prop.loc, "manifest.json routes must be an array");
        return error.InvalidManifest;
    }

    const entries = routes_prop.data.e_array.items.slice();

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

    // First pass: collect all entries and insert routes into router
    for (entries) |entry_expr| {
        if (entry_expr.data != .e_object) continue;

        const entry_obj = entry_expr.data.e_object;

        // Parse the new "route" field
        const route_prop = entry_obj.get("route") orelse {
            try log.addError(&json_source, entry_expr.loc, "manifest entry missing required 'route' field");
            return error.InvalidManifest;
        };
        if (route_prop.data != .e_string) {
            try log.addError(&json_source, route_prop.loc, "manifest entry 'route' field must be a string");
            return error.InvalidManifest;
        }
        const route_str = try route_prop.data.e_string.string(temp_allocator);

        // Parse the "routeType" field
        const route_type_prop = entry_obj.get("routeType") orelse {
            try log.addError(&json_source, entry_expr.loc, "manifest entry missing required 'routeType' field");
            return error.InvalidManifest;
        };
        if (route_type_prop.data != .e_number) {
            try log.addError(&json_source, route_type_prop.loc, "manifest entry 'routeType' field must be a number");
            return error.InvalidManifest;
        }
        const route_type_index = route_type_prop.data.e_number.toU32();

        // Get the type from the router
        if (route_type_index >= router.types.len) {
            try log.addErrorFmt(&json_source, route_type_prop.loc, log.msgs.allocator, "Invalid routeType index {d} (max: {d})", .{ route_type_index, router.types.len - 1 });
            return error.InvalidManifest;
        }
        const route_type = &router.types[route_type_index];

        const rel_path = route_str;

        // Use a temporary log for parsing
        var parse_log = FrameworkRouter.TinyLog.empty;
        const parsed = (route_type.style.parse(rel_path, null, &parse_log, route_type.allow_layouts, temp_allocator) catch {
            parse_log.cursor_at += @intCast(route_type.abs_root.len - router.root.len);
            try log.addErrorFmt(&json_source, route_prop.loc, log.msgs.allocator, "Failed to parse route pattern '{s}': {s}", .{ route_str, parse_log.msg.slice() });
            return error.InvalidManifest;
        }) orelse {
            // Route pattern not recognized by the style
            continue;
        };

        // Create encoded pattern for insertion
        const encoded_pattern = try FrameworkRouter.EncodedPattern.initFromParts(parsed.parts, router.pattern_string_arena.allocator());

        // Create a dummy insertion context for manifest loading
        // We don't need actual file operations since we're loading from manifest
        const DummyContext = struct {
            fn getFileIdForRouter(_: *anyopaque, _: []const u8, _: FrameworkRouter.Route.Index, _: FrameworkRouter.Route.FileKind) bun.OOM!FrameworkRouter.OpaqueFileId {
                // Return a dummy file ID
                return FrameworkRouter.OpaqueFileId.init(0);
            }
            fn onRouterSyntaxError(_: *anyopaque, _: []const u8, _: FrameworkRouter.TinyLog) bun.OOM!void {
                // Ignore syntax errors during manifest load
            }
            fn onRouterCollisionError(_: *anyopaque, _: []const u8, _: FrameworkRouter.OpaqueFileId, _: FrameworkRouter.Route.FileKind) bun.OOM!void {
                // Ignore collision errors during manifest load - they're expected for SSG
            }
        };

        var dummy_ctx: u8 = 0; // Just a dummy value to get a pointer
        const vtable = struct {
            const getFileId = DummyContext.getFileIdForRouter;
            const onSyntaxError = DummyContext.onRouterSyntaxError;
            const onCollisionError = DummyContext.onRouterCollisionError;
        };
        const insertion_ctx = FrameworkRouter.InsertionContext{
            .opaque_ctx = @ptrCast(&dummy_ctx),
            .vtable = &.{
                .getFileIdForRouter = vtable.getFileId,
                .onRouterSyntaxError = vtable.onSyntaxError,
                .onRouterCollisionError = vtable.onCollisionError,
            },
        };

        // Insert route into router to get route index
        var dummy_file_id: FrameworkRouter.OpaqueFileId = undefined;
        const route_index = blk: {
            const file_kind: FrameworkRouter.Route.FileKind = switch (parsed.kind) {
                .page => .page,
                .layout => .layout,
                else => .page,
            };

            // Handle static vs dynamic routes separately since insertion_kind must be comptime
            // Check if this is truly a static route (no dynamic parts)
            const is_static = isStaticCheck: {
                for (parsed.parts) |part| {
                    switch (part) {
                        .text, .group => {},
                        .param, .catch_all, .catch_all_optional => break :isStaticCheck false,
                    }
                }
                break :isStaticCheck true;
            };

            if (is_static) {
                // Static route - build the route path similarly to how scan() does it
                // Calculate total length needed for the static route path
                var static_total_len: usize = 0;
                for (parsed.parts) |part| {
                    switch (part) {
                        .text => |data| static_total_len += 1 + data.len, // "/" + text
                        .group => {},
                        .param, .catch_all, .catch_all_optional => unreachable,
                    }
                }

                // Allocate and build the static route path
                const allocation = try router.pattern_string_arena.allocator().alloc(u8, static_total_len);
                var s = std.io.fixedBufferStream(allocation);
                for (parsed.parts) |part| {
                    switch (part) {
                        .text => |data| {
                            _ = s.write("/") catch unreachable;
                            _ = s.write(data) catch unreachable;
                        },
                        .group => {},
                        .param, .catch_all, .catch_all_optional => unreachable,
                    }
                }
                bun.assert(s.getWritten().len == allocation.len);

                // Check if route already exists
                const lookup_path = if (allocation.len == 0) "/" else allocation;
                if (router.static_routes.get(lookup_path)) |existing_route_index| {
                    // Route already exists, use existing index
                    break :blk existing_route_index;
                }

                // Insert the static route properly
                break :blk router.insert(
                    bun.default_allocator,
                    FrameworkRouter.Type.Index.init(@intCast(route_type_index)),
                    .static,
                    .{ .route_path = lookup_path },
                    file_kind,
                    route_str,
                    insertion_ctx,
                    &dummy_file_id,
                ) catch |err| switch (err) {
                    error.RouteCollision => {
                        // For static routes that collide, try to find the existing route
                        if (router.static_routes.get(lookup_path)) |existing_route_index| {
                            break :blk existing_route_index;
                        }
                        // If we still can't find it, use root as fallback
                        break :blk FrameworkRouter.Type.rootRouteIndex(FrameworkRouter.Type.Index.init(@intCast(route_type_index)));
                    },
                    else => return err,
                };
            } else {
                // Dynamic route
                break :blk router.insert(
                    bun.default_allocator,
                    FrameworkRouter.Type.Index.init(@intCast(route_type_index)),
                    .dynamic,
                    encoded_pattern,
                    file_kind,
                    route_str,
                    insertion_ctx,
                    &dummy_file_id,
                ) catch |err| switch (err) {
                    error.RouteCollision => {
                        // For dynamic routes that collide, we need to find the existing route
                        // This is expected for SSG routes with multiple param combinations
                        // The collision means the route pattern already exists
                        // We'll search for it in the dynamic routes
                        for (router.dynamic_routes.keys()) |existing_pattern| {
                            if (existing_pattern.effectiveURLHash() == encoded_pattern.effectiveURLHash()) {
                                break :blk router.dynamic_routes.get(existing_pattern).?;
                            }
                        }
                        // If we couldn't find it, something is wrong
                        return err;
                    },
                    else => return err,
                };
            }
        };

        // Parse mode
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

        const route_index_u32 = route_index.get();
        max_route_index = @max(max_route_index, route_index_u32);

        const gop = try route_map.getOrPut(route_index_u32);
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

    // Second pass: build Route structs (continues from original code...)
    var it = route_map.iterator();
    while (it.next()) |entry| {
        const route_index = entry.key_ptr.*;
        const route_entries = entry.value_ptr.items;

        if (route_entries.len == 0) continue;

        const first_mode = route_entries[0].mode;

        // Check if all entries have the same mode
        for (route_entries) |route_entry| {
            if (route_entry.mode != first_mode) {
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
                const ep_prop = entry_obj.get("clientEntrypoint") orelse entry_obj.get("entrypoint") orelse {
                    try log.addError(&json_source, Loc.Empty, "SSR entry missing required 'clientEntrypoint' or 'entrypoint' field");
                    return error.InvalidManifest;
                };
                if (ep_prop.data != .e_string) {
                    try log.addError(&json_source, Loc.Empty, "SSR entry 'clientEntrypoint' must be a string");
                    return error.InvalidManifest;
                }
                const entrypoint = try ep_prop.data.e_string.string(allocator);

                // Parse all modules (optional for new format)
                var modules = bun.BabyList([]const u8){};
                if (entry_obj.get("modules")) |modules_prop| {
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
                    }
                }

                const styles = try parseStyles(allocator, log, &json_source, entry_obj);

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

                    const params = try parseParams(allocator, log, &json_source, entry_obj);
                    const styles = try parseStyles(allocator, log, &json_source, entry_obj);

                    routes[route_index] = .{
                        .ssg = Route.SSG{
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

                        const params = try parseParams(allocator, log, &json_source, entry_obj);
                        const styles = try parseStyles(allocator, log, &json_source, entry_obj);

                        const ssg = Route.SSG{
                            .entrypoint = entrypoint,
                            .params = params,
                            .styles = styles,
                        };

                        try ssg_map.put(allocator, ssg, {});
                    }

                    routes[route_index] = .{
                        .ssg_many = ssg_map,
                    };
                }
            },
        }
    }

    self.routes = routes;
}

fn parseParams(allocator: Allocator, log: *logger.Log, json_source: *const logger.Source, entry_obj: *const E.Object) !bun.BabyList(ParamEntry) {
    var params = bun.BabyList(ParamEntry){};

    // Params is optional for SSG entries - it's only present for dynamic routes
    if (entry_obj.get("params")) |params_prop| {
        if (params_prop.data != .e_object) {
            // If params is present, it must be an object
            try log.addError(json_source, params_prop.loc, "SSG entry 'params' must be an object");
            return error.InvalidManifest;
        }
        const params_obj = params_prop.data.e_object;

        for (params_obj.properties.slice()) |prop| {
            if (prop.value) |value_expr| {
                const key = prop.key.?.asString(allocator) orelse "";

                switch (value_expr.data) {
                    .e_string => {
                        // Single string value
                        const param_entry = ParamEntry{
                            .key = key,
                            .value = .{ .single = try value_expr.data.e_string.string(allocator) },
                        };
                        try params.append(allocator, param_entry);
                    },
                    .e_array => |arr| {
                        // Array of strings - for catch-all routes
                        const array_items = arr.items.slice();
                        if (array_items.len == 0) {
                            try log.addError(json_source, value_expr.loc, "SSG entry 'params' array cannot be empty");
                            return error.InvalidManifest;
                        }

                        // Validate all items are strings and collect them
                        var values = bun.BabyList([]const u8){};
                        for (array_items) |item| {
                            if (item.data != .e_string) {
                                try log.addError(json_source, item.loc, "SSG entry 'params' array must contain only strings");
                                return error.InvalidManifest;
                            }
                            try values.append(allocator, try item.data.e_string.string(allocator));
                        }

                        const param_entry = ParamEntry{
                            .key = key,
                            .value = .{ .multiple = values },
                        };
                        try params.append(allocator, param_entry);
                    },
                    else => {
                        try log.addError(json_source, value_expr.loc, "SSG entry 'params' values must be strings or arrays of strings");
                        return error.InvalidManifest;
                    },
                }
            }
        }
    }

    return params;
}

fn parseStyles(allocator: Allocator, log: *logger.Log, json_source: *const logger.Source, entry_obj: *const E.Object) !Styles {
    var styles = Styles{};

    // Styles field is required and must be an array (can be empty)
    const styles_prop = entry_obj.get("styles") orelse {
        try log.addError(json_source, Loc.Empty, "SSG entry missing required 'styles' field");
        return error.InvalidManifest;
    };

    if (styles_prop.data != .e_array) {
        try log.addError(json_source, styles_prop.loc, "SSG entry 'styles' must be an array");
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
            try log.addError(json_source, Loc.Empty, "SSG entry 'styles' must be an array");
            return error.InvalidManifest;
        }
        const style_str = try style_expr.data.e_string.string(allocator);
        try styles.append(allocator, style_str);
    }

    return styles;
}

pub const Route = union(enum) {
    empty,
    ssr: SSR,
    ssg: SSG,
    ssg_many: SSGMany,

    /// A route which has been server-side rendered
    pub const SSR = struct {
        entrypoint: []const u8,
        modules: bun.BabyList([]const u8),
        styles: Styles,
    };

    /// A route which has been statically generated
    pub const SSG = struct {
        entrypoint: []const u8,
        params: bun.BabyList(ParamEntry),
        styles: Styles,
        store: ?*jsc.WebCore.Blob.Store = null,

        pub fn fromMatchedParams(allocator: Allocator, params: *const bun.bake.FrameworkRouter.MatchedParams) !@This() {
            const matched_params = params.params.slice();
            if (matched_params.len == 0) {
                return .{
                    .entrypoint = "",
                    .params = bun.BabyList(ParamEntry){},
                    .styles = .{},
                    .store = null,
                };
            }

            // Count unique keys to pre-allocate the exact capacity
            var unique_keys: usize = 0;
            {
                var i: usize = 0;
                while (i < matched_params.len) {
                    const key = matched_params[i].key;
                    unique_keys += 1;

                    // Skip over any consecutive entries with the same key
                    i += 1;
                    while (i < matched_params.len and bun.strings.eql(matched_params[i].key, key)) {
                        i += 1;
                    }
                }
            }

            var params_list = try bun.BabyList(ParamEntry).initCapacity(allocator, unique_keys);

            var i: usize = 0;
            while (i < matched_params.len) {
                const entry = matched_params[i];
                const key = entry.key;

                // Check if the next entries have the same key (catch-all param case)
                var j = i + 1;
                while (j < matched_params.len and bun.strings.eql(matched_params[j].key, key)) {
                    j += 1;
                }

                if (j - i == 1) {
                    // Single value for this key
                    try params_list.append(allocator, .{
                        .key = key,
                        .value = .{ .single = entry.value },
                    });
                } else {
                    // Multiple values for the same key (catch-all param)
                    var multiple_values = try bun.BabyList([]const u8).initCapacity(allocator, j - i);
                    for (matched_params[i..j]) |param_entry| {
                        try multiple_values.append(allocator, param_entry.value);
                    }
                    try params_list.append(allocator, .{
                        .key = key,
                        .value = .{ .multiple = multiple_values },
                    });
                }

                i = j;
            }

            return .{
                .entrypoint = "",
                .params = params_list,
                .styles = .{},
                .store = null,
            };
        }
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
    pub const SSGMany = std.ArrayHashMapUnmanaged(
        SSG,
        void,
        struct {
            pub fn hash(_: @This(), key: SSG) u32 {
                var hasher = std.hash.Wyhash.init(0);
                for (key.params.slice()) |param| {
                    hasher.update(param.key);
                    switch (param.value) {
                        .single => |val| hasher.update(val),
                        .multiple => |vals| {
                            for (vals.slice()) |val| {
                                hasher.update(val);
                            }
                        },
                    }
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
};

const RawManifestEntry = struct {
    json_obj: *const E.Object,
    loc: logger.Loc,
    mode: Mode,

    const Mode = enum { ssr, ssg };
};

const ParamEntriesHash = u32;

pub const ParamEntry = struct {
    key: []const u8,
    value: Value,

    pub const Value = union(enum) {
        single: []const u8,
        multiple: bun.BabyList([]const u8),

        pub fn eql(a: *const Value, b: *const Value) bool {
            if (@as(std.meta.Tag(Value), a.*) != @as(std.meta.Tag(Value), b.*)) return false;
            return switch (a.*) {
                .single => |a_val| bun.strings.eql(a_val, b.single),
                .multiple => |a_list| blk: {
                    const b_list = b.multiple;
                    if (a_list.len != b_list.len) break :blk false;
                    for (a_list.slice(), b_list.slice()) |a_item, b_item| {
                        if (!bun.strings.eql(a_item, b_item)) break :blk false;
                    }
                    break :blk true;
                },
            };
        }
    };

    pub fn eql(a: *const ParamEntry, b: *const ParamEntry) bool {
        return bun.strings.eql(a.key, b.key) and a.value.eql(&b.value);
    }
};

pub const Styles = bun.BabyList([]const u8);

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

const FrameworkRouter = bun.bake.FrameworkRouter;
