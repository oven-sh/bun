//! `bun pm sbom` - generate a Software Bill of Materials (SBOM) from the lockfile.
//!
//! Supports two output formats:
//!   - CycloneDX 1.7 (default): https://cyclonedx.org/
//!   - SPDX 2.3: https://spdx.dev/

pub const PmSbomCommand = struct {
    pub const Format = enum {
        cyclonedx,
        spdx,

        pub fn fromString(str: []const u8) ?Format {
            if (strings.eqlComptime(str, "cyclonedx")) return .cyclonedx;
            if (strings.eqlComptime(str, "spdx")) return .spdx;
            return null;
        }
    };

    pub fn exec(ctx: Command.Context, pm: *PackageManager) !void {
        const format: Format = if (pm.options.sbom_format) |f|
            Format.fromString(f) orelse {
                Output.errGeneric("invalid --format value: '{s}'", .{f});
                Output.note("valid values are 'cyclonedx' or 'spdx'", .{});
                Global.exit(1);
            }
        else
            .cyclonedx;

        const outfile: ?[]const u8 = pm.options.sbom_outfile;

        if (pm.options.positionals.len > 1) {
            Output.errGeneric("unexpected argument: '{s}'", .{pm.options.positionals[1]});
            Output.flush();
            printHelp();
            Global.exit(1);
        }

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);
        const lockfile = load_lockfile.ok.lockfile;

        // Everything the Generator allocates (component refs, SPDXIDs,
        // purls, version strings, dedup maps) lives in this arena and is
        // freed in one shot. This avoids per-field ownership bookkeeping
        // for a one-shot CLI command that exits immediately after.
        var arena = std.heap.ArenaAllocator.init(ctx.allocator);
        defer arena.deinit();

        const generator = try Generator.init(arena.allocator(), lockfile, pm);

        var writer_allocating = std.Io.Writer.Allocating.init(ctx.allocator);
        defer writer_allocating.deinit();
        const writer = &writer_allocating.writer;

        switch (format) {
            .cyclonedx => try generator.writeCycloneDX(writer),
            .spdx => try generator.writeSPDX(writer),
        }

        const output = writer_allocating.written();

        if (outfile) |path| {
            var buf_z: bun.PathBuffer = undefined;
            const path_z = bun.path.z(path, &buf_z);
            var os_buf: bun.OSPathBuffer = undefined;
            const os_path: bun.OSPathSliceZ = if (comptime bun.Environment.isWindows)
                bun.strings.convertUTF8toUTF16InBufferZ(&os_buf, path_z)
            else blk: {
                _ = &os_buf;
                break :blk path_z;
            };
            switch (bun.sys.File.writeFile(bun.FD.cwd(), os_path, output)) {
                .err => |err| {
                    Output.err(err, "failed to write SBOM to '{s}'", .{path});
                    Global.exit(1);
                },
                .result => {},
            }
            if (pm.options.log_level != .silent) {
                Output.prettyErrorln("<green>Saved<r> {s} ({d} packages)", .{ path, generator.components.items.len });
            }
        } else {
            Output.writer().writeAll(output) catch {};
        }
        Output.flush();
    }

    pub fn printHelp() void {
        const help_text =
            \\<b>Usage<r>: <b><green>bun pm sbom<r> <cyan>[flags]<r>
            \\
            \\  Generate a Software Bill of Materials (SBOM) from the lockfile.
            \\
            \\<b>Flags:<r>
            \\  <cyan>    --format<r> <blue>\<format\><r>   Output format: <b>cyclonedx<r> (default) or <b>spdx<r>
            \\  <cyan>-o, --outfile<r> <blue>\<path\><r>    Write the SBOM to a file instead of stdout
            \\
            \\<b>Examples:<r>
            \\  <d>Write a CycloneDX 1.7 SBOM to stdout<r>
            \\  <b><green>bun pm sbom<r>
            \\
            \\  <d>Write an SPDX 2.3 SBOM to a file<r>
            \\  <b><green>bun pm sbom<r> <cyan>--format<r> spdx <cyan>-o<r> sbom.spdx.json
            \\
        ;
        Output.pretty(help_text, .{});
        Output.flush();
    }
};

/// Gathers package information from the lockfile and writes it in either
/// CycloneDX or SPDX format. Both formats share the same underlying data
/// collection so we collect once and then serialize.
///
/// All heap allocations made during construction (component refs, SPDXIDs,
/// purls, version strings, etc.) come from an arena allocator owned by the
/// caller, so cleanup is a single bulk free and partial-construction
/// failures can't leak individual strings.
const Generator = struct {
    lockfile: *Lockfile,

    root: Component,
    /// All packages in the lockfile other than the root package. Index into
    /// this list is unrelated to PackageID.
    components: std.array_list.Managed(Component),
    /// Maps PackageID to index in `components`, or `root_marker` for the root,
    /// or `invalid_index` for packages we skipped (uninitialized resolutions).
    id_to_component: []u32,

    /// ISO 8601 UTC timestamp for when this SBOM was generated.
    timestamp: [20]u8,
    serial_uuid: [36]u8,

    const invalid_index: u32 = std.math.maxInt(u32);
    const root_marker: u32 = std.math.maxInt(u32) - 1;

    /// All string fields borrow either from the caller's arena or from the
    /// lockfile's string buffer; Components are never individually freed.
    const Component = struct {
        package_id: PackageID,
        /// Unique reference used as `bom-ref` (CycloneDX). For npm packages
        /// this is `name@version`.
        ref: []const u8,
        /// SPDXID suffix (`SPDXRef-Package-<this>`). SPDXIDs allow only
        /// `[A-Za-z0-9.-]`, and two distinct refs (e.g. `foo_bar@1.0.0` and
        /// `foo-bar@1.0.0`) can sanitize to the same value, so this is
        /// deduplicated independently of `ref`.
        spdx_id: []const u8,
        /// Package name.
        name: []const u8,
        /// Version string. Empty if unavailable.
        version: []const u8,
        /// Package URL identifier (`pkg:npm/...`). Empty if not applicable.
        /// https://github.com/package-url/purl-spec
        purl: []const u8,
        /// Download URL (tarball for npm, repo for git, etc). Empty if unavailable.
        download_url: []const u8,
        /// Direct dependencies by PackageID.
        deps: std.ArrayListUnmanaged(PackageID) = .{},

        scope: Scope,
        integrity: Integrity,
    };

    /// Ordered from strongest to weakest. A path from the root inherits
    /// the weakest edge along it; a package's final scope is the strongest
    /// over all paths that reach it.
    const Scope = enum(u2) {
        required = 0,
        optional = 1,
        excluded = 2,

        fn toCycloneDX(this: Scope) []const u8 {
            return @tagName(this);
        }

        fn isStrongerThan(a: Scope, b: Scope) bool {
            return @intFromEnum(a) < @intFromEnum(b);
        }

        fn weakenBy(path: Scope, edge: Scope) Scope {
            return if (@intFromEnum(edge) > @intFromEnum(path)) edge else path;
        }
    };

    /// `allocator` must be an arena (or otherwise bulk-freed by the caller).
    /// The returned Generator borrows from it and has no `deinit()`.
    fn init(allocator: std.mem.Allocator, lockfile: *Lockfile, pm: *PackageManager) !Generator {
        var this: Generator = .{
            .lockfile = lockfile,
            .root = undefined,
            .components = std.array_list.Managed(Component).init(allocator),
            .id_to_component = try allocator.alloc(u32, lockfile.packages.len),
            .timestamp = undefined,
            .serial_uuid = undefined,
        };
        @memset(this.id_to_component, invalid_index);

        makeISOTimestamp(&this.timestamp);
        bun.UUID.init().print(&this.serial_uuid);

        const string_bytes = lockfile.buffers.string_bytes.items;
        const deps_buf = lockfile.buffers.dependencies.items;
        const resolutions_buf = lockfile.buffers.resolutions.items;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_name_hashes = packages.items(.name_hash);
        const pkg_resolutions = packages.items(.resolution);
        const pkg_metas = packages.items(.meta);
        const pkg_dependencies = packages.items(.dependencies);
        const pkg_dep_resolutions = packages.items(.resolutions);

        // Compute a scope for each package based on how it's reachable from
        // the root. A package's scope is the strongest (required > optional >
        // excluded) over all paths from the root, where a path's scope is the
        // weakest edge along it:
        //   - any dev edge on the path -> that path contributes `.excluded`
        //   - else any optional/optional-peer edge -> `.optional`
        //   - else -> `.required`
        // This matches what `bun install --production` would actually
        // install: transitive dependencies of a root devDependency are only
        // reachable via a dev edge, so they're all `.excluded` unless some
        // other prod path also reaches them.
        //
        // The SBOM always describes the whole lockfile, so the BFS seeds
        // from the lockfile root (PackageID 0) even when `bun pm sbom` is
        // invoked from inside a workspace member's directory. Using the
        // workspace-aware `pm.root_package_id` here would leave sibling
        // workspaces and their deps at `.excluded` despite emitting them
        // as components.
        const root_id: PackageID = 0;
        const pkg_scope = try allocator.alloc(Scope, lockfile.packages.len);
        @memset(pkg_scope, .excluded);
        if (root_id < pkg_scope.len) pkg_scope[root_id] = .required;
        {
            var queue: std.ArrayListUnmanaged(PackageID) = .{};
            if (root_id < pkg_scope.len) try queue.append(allocator, root_id);
            while (queue.pop()) |parent| {
                const parent_scope = pkg_scope[parent];
                const deps = pkg_dependencies[parent].get(deps_buf);
                const resolved = pkg_dep_resolutions[parent].get(resolutions_buf);
                for (deps, resolved) |dep, child| {
                    if (child == invalid_package_id or child >= pkg_scope.len or child == parent) continue;
                    // `isOptional()` excludes optional peer deps (it checks
                    // `optional and !peer`), so check `isOptionalPeer()` too.
                    const edge: Scope = if (dep.behavior.isDev())
                        .excluded
                    else if (dep.behavior.isOptional() or dep.behavior.isOptionalPeer())
                        .optional
                    else
                        .required;
                    const path_scope = parent_scope.weakenBy(edge);
                    if (path_scope.isStrongerThan(pkg_scope[child])) {
                        pkg_scope[child] = path_scope;
                        try queue.append(allocator, child);
                    }
                }
            }
        }

        // Build the root component from the root package in the lockfile.
        {
            var root_name: []const u8 = if (root_id < pkg_names.len and pkg_names[root_id].len() > 0)
                pkg_names[root_id].slice(string_bytes)
            else
                pm.root_package_json_name_at_time_of_init;
            // Root version isn't stored in the binary lockfile for the root
            // package itself; read it from package.json when available.
            var root_version: []const u8 = "";
            if (root_id < pkg_name_hashes.len) {
                if (lockfile.workspace_versions.get(pkg_name_hashes[root_id])) |ws_version| {
                    root_version = try std.fmt.allocPrint(allocator, "{f}", .{ws_version.fmt(string_bytes)});
                }
            }
            if (root_version.len == 0) root_package_json: {
                const contents = switch (bun.sys.File.readFrom(bun.FD.cwd(), "package.json", allocator)) {
                    .result => |bytes| bytes,
                    .err => break :root_package_json,
                };
                const source = &logger.Source.initPathString("package.json", contents);
                var log = logger.Log.init(allocator);
                defer log.deinit();
                const json = bun.json.parse(source, &log, allocator, false) catch break :root_package_json;
                if (json.getStringCloned(allocator, "version") catch null) |v| {
                    if (v.len > 0) root_version = v;
                }
                if (root_name.len == 0) {
                    if (json.getStringCloned(allocator, "name") catch null) |n| {
                        if (n.len > 0) root_name = n;
                    }
                }
            }
            if (root_name.len == 0) root_name = "root";
            const root_ref = if (root_version.len > 0)
                try std.fmt.allocPrint(allocator, "{s}@{s}", .{ root_name, root_version })
            else
                try allocator.dupe(u8, root_name);
            this.root = .{
                .package_id = root_id,
                .ref = root_ref,
                .spdx_id = try sanitizeSpdxId(allocator, root_ref),
                .name = root_name,
                .version = root_version,
                .purl = if (strings.isNPMPackageName(root_name) and root_version.len > 0)
                    try makePurl(allocator, root_name, root_version)
                else
                    "",
                .download_url = "",
                .scope = .required,
                .integrity = .{},
            };
            if (root_id < lockfile.packages.len) {
                this.id_to_component[root_id] = root_marker;
            }
        }

        // Build a component for every other package.
        var seen_refs = bun.StringHashMap(void).init(allocator);
        defer seen_refs.deinit();
        var seen_spdx_ids = bun.StringHashMap(void).init(allocator);
        defer seen_spdx_ids.deinit();
        try seen_refs.put(this.root.ref, {});
        try seen_spdx_ids.put(this.root.spdx_id, {});

        for (0..lockfile.packages.len) |idx| {
            const pkg_id: PackageID = @intCast(idx);
            if (pkg_id == root_id) continue;
            const res = pkg_resolutions[idx];
            if (res.tag == .uninitialized) continue;

            const name = pkg_names[idx].slice(string_bytes);

            var version: []const u8 = "";
            var purl: []const u8 = "";
            var download_url: []const u8 = "";
            var ref: []const u8 = undefined;

            switch (res.tag) {
                .root => {
                    ref = try allocator.dupe(u8, if (name.len > 0) name else "root");
                },
                .npm => {
                    version = try std.fmt.allocPrint(allocator, "{f}", .{res.value.npm.version.fmt(string_bytes)});
                    ref = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ name, version });
                    purl = try makePurl(allocator, name, version);
                    const url = res.value.npm.url.slice(string_bytes);
                    if (url.len > 0) {
                        download_url = try allocator.dupe(u8, url);
                    }
                },
                .workspace => {
                    const ws_path = res.value.workspace.slice(string_bytes);
                    ref = try std.fmt.allocPrint(allocator, "{s}@workspace:{s}", .{ name, ws_path });
                    if (lockfile.workspace_versions.get(pkg_name_hashes[idx])) |ws_version| {
                        version = try std.fmt.allocPrint(allocator, "{f}", .{ws_version.fmt(string_bytes)});
                        // Workspace names aren't validated against npm naming
                        // rules, so only emit a `pkg:npm/...` purl when the
                        // name would be valid as one.
                        if (strings.isNPMPackageName(name)) {
                            purl = try makePurl(allocator, name, version);
                        }
                    }
                },
                .folder, .symlink, .single_file_module, .local_tarball, .remote_tarball, .git, .github => {
                    version = try std.fmt.allocPrint(allocator, "{f}", .{res.fmt(string_bytes, .posix)});
                    ref = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ name, version });
                    if (res.tag == .remote_tarball) {
                        const url = res.value.remote_tarball.slice(string_bytes);
                        if (url.len > 0) download_url = try allocator.dupe(u8, url);
                    } else if (res.tag == .git or res.tag == .github) {
                        download_url = try std.fmt.allocPrint(allocator, "{f}", .{res.fmtURL(string_bytes)});
                    }
                },
                else => {
                    ref = try std.fmt.allocPrint(allocator, "{s}@{f}", .{ name, res.fmt(string_bytes, .posix) });
                },
            }

            // bom-refs must be unique within the document. Lockfiles can
            // contain duplicate name@version entries in edge cases (e.g. npm
            // aliases resolving to the same underlying package from different
            // dependency paths), so append the package index until unique.
            while (seen_refs.contains(ref)) {
                const unique = try std.fmt.allocPrint(allocator, "{s}~{d}", .{ ref, idx });
                allocator.free(ref);
                ref = unique;
            }
            try seen_refs.put(ref, {});

            // SPDXIDs must also be unique, but are derived from `ref` by
            // sanitizing non-alphanumeric characters to `-`, so two distinct
            // refs (e.g. `foo_bar@1.0.0` and `foo-bar@1.0.0`) can collide.
            // Deduplicate on the sanitized form separately.
            var spdx_id = try sanitizeSpdxId(allocator, ref);
            while (seen_spdx_ids.contains(spdx_id)) {
                const unique = try std.fmt.allocPrint(allocator, "{s}.{d}", .{ spdx_id, idx });
                allocator.free(spdx_id);
                spdx_id = unique;
            }
            try seen_spdx_ids.put(spdx_id, {});

            this.id_to_component[pkg_id] = @intCast(this.components.items.len);
            try this.components.append(.{
                .package_id = pkg_id,
                .ref = ref,
                .spdx_id = spdx_id,
                .name = name,
                .version = version,
                .purl = purl,
                .download_url = download_url,
                .scope = if (res.tag == .root) .required else pkg_scope[idx],
                .integrity = pkg_metas[idx].integrity,
            });
        }

        // Collect direct dependencies for each component (and the root) for
        // the dependency graph section.
        collectDeps(&this.root, pkg_dep_resolutions, resolutions_buf, allocator, lockfile.packages.len);
        for (this.components.items) |*comp| {
            collectDeps(comp, pkg_dep_resolutions, resolutions_buf, allocator, lockfile.packages.len);
        }

        return this;
    }

    fn collectDeps(
        comp: *Component,
        pkg_dep_resolutions: []const Lockfile.PackageIDSlice,
        resolutions_buf: []const PackageID,
        allocator: std.mem.Allocator,
        pkg_len: usize,
    ) void {
        if (comp.package_id >= pkg_len) return;
        const resolved = pkg_dep_resolutions[comp.package_id].get(resolutions_buf);
        for (resolved) |resolved_id| {
            if (resolved_id == invalid_package_id or resolved_id >= pkg_len) continue;
            // Deduplicate — a package can list the same dep under both
            // `dependencies` and `peerDependencies`, for example.
            for (comp.deps.items) |existing| {
                if (existing == resolved_id) break;
            } else {
                bun.handleOom(comp.deps.append(allocator, resolved_id));
            }
        }
    }

    fn componentFor(this: *const Generator, pkg_id: PackageID) ?*const Component {
        if (pkg_id >= this.id_to_component.len) return null;
        const idx = this.id_to_component[pkg_id];
        if (idx == invalid_index) return null;
        if (idx == root_marker) return &this.root;
        return &this.components.items[idx];
    }

    /// SPDXID values may only contain letters, numbers, `.`, and `-`. Build
    /// the `SPDXRef-Package-…` suffix by replacing anything else with `-`.
    fn sanitizeSpdxId(allocator: std.mem.Allocator, ref: []const u8) ![]u8 {
        const out = try allocator.alloc(u8, ref.len);
        for (ref, 0..) |c, i| {
            out[i] = switch (c) {
                'A'...'Z', 'a'...'z', '0'...'9', '.', '-' => c,
                else => '-',
            };
        }
        return out;
    }

    fn makePurl(allocator: std.mem.Allocator, name: []const u8, version: []const u8) ![]const u8 {
        // purl-spec: `pkg:npm/namespace/name@version`. For scoped packages
        // the `@` in the scope must be percent-encoded. The version must
        // also be percent-encoded (semver build metadata `+` -> `%2B`).
        if (name.len > 0 and name[0] == '@') {
            if (strings.indexOfChar(name, '/')) |slash| {
                return std.fmt.allocPrint(allocator, "pkg:npm/%40{s}/{s}@{f}", .{
                    name[1..slash],
                    name[slash + 1 ..],
                    PurlEncode{ .s = version },
                });
            }
        }
        return std.fmt.allocPrint(allocator, "pkg:npm/{s}@{f}", .{ name, PurlEncode{ .s = version } });
    }

    /// Percent-encodes bytes outside the RFC 3986 unreserved set
    /// (`A-Za-z0-9-._~`) for use in purl components. Matches what
    /// packageurl-js does via `encodeURIComponent()`.
    const PurlEncode = struct {
        s: []const u8,
        pub fn format(this: PurlEncode, w: *std.Io.Writer) !void {
            for (this.s) |c| switch (c) {
                'A'...'Z', 'a'...'z', '0'...'9', '-', '.', '_', '~' => try w.writeByte(c),
                else => try w.print("%{X:0>2}", .{c}),
            };
        }
    };

    fn makeISOTimestamp(out: *[20]u8) void {
        const secs: u64 = @intCast(@max(@divFloor(std.time.milliTimestamp(), 1000), 0));
        const utc_seconds = std.time.epoch.EpochSeconds{ .secs = secs };
        const utc_day = utc_seconds.getEpochDay();
        const year_and_day = utc_day.calculateYearDay();
        const month_and_day = year_and_day.calculateMonthDay();
        const time = utc_seconds.getDaySeconds();
        _ = std.fmt.bufPrint(out, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}Z", .{
            @as(u32, @intCast(year_and_day.year)),
            month_and_day.month.numeric(),
            @as(u32, month_and_day.day_index) + 1,
            time.getHoursIntoDay(),
            time.getMinutesIntoHour(),
            time.getSecondsIntoMinute(),
        }) catch unreachable;
    }

    // ==== CycloneDX 1.7 ======================================================

    fn writeCycloneDX(this: *const Generator, w: *std.Io.Writer) !void {
        try w.writeAll("{\n");
        try w.writeAll("  \"$schema\": \"https://cyclonedx.org/schema/bom-1.7.schema.json\",\n");
        try w.writeAll("  \"bomFormat\": \"CycloneDX\",\n");
        try w.writeAll("  \"specVersion\": \"1.7\",\n");
        try w.print("  \"serialNumber\": \"urn:uuid:{s}\",\n", .{this.serial_uuid});
        try w.writeAll("  \"version\": 1,\n");

        // metadata
        try w.writeAll("  \"metadata\": {\n");
        try w.print("    \"timestamp\": \"{s}\",\n", .{this.timestamp});
        try w.writeAll("    \"lifecycles\": [{ \"phase\": \"build\" }],\n");
        try w.writeAll("    \"tools\": {\n");
        try w.writeAll("      \"components\": [\n");
        try w.print("        {{ \"type\": \"application\", \"name\": \"bun\", \"version\": \"{s}\" }}\n", .{Global.package_json_version});
        try w.writeAll("      ]\n");
        try w.writeAll("    },\n");
        try w.writeAll("    \"component\": ");
        try this.writeCycloneDXComponent(w, &this.root, "application", 4);
        try w.writeAll("\n  },\n");

        // components
        try w.writeAll("  \"components\": [");
        for (this.components.items, 0..) |*comp, i| {
            if (i != 0) try w.writeByte(',');
            try w.writeAll("\n    ");
            try this.writeCycloneDXComponent(w, comp, "library", 4);
        }
        if (this.components.items.len > 0) try w.writeByte('\n');
        try w.writeAll("  ],\n");

        // dependencies
        try w.writeAll("  \"dependencies\": [\n");
        try this.writeCycloneDXDependency(w, &this.root);
        for (this.components.items) |*comp| {
            try w.writeAll(",\n");
            try this.writeCycloneDXDependency(w, comp);
        }
        try w.writeAll("\n  ]\n");

        try w.writeAll("}\n");
    }

    fn writeCycloneDXComponent(this: *const Generator, w: *std.Io.Writer, comp: *const Component, comptime kind: []const u8, base_indent: usize) !void {
        _ = this;
        const pad = Indent{ .n = base_indent };
        const pad1 = Indent{ .n = base_indent + 2 };
        try w.writeAll("{\n");
        try w.print("{f}\"type\": \"{s}\",\n", .{ pad1, kind });
        try w.print("{f}\"bom-ref\": {f},\n", .{ pad1, jsonStr(comp.ref) });
        try w.print("{f}\"name\": {f},\n", .{ pad1, jsonStr(comp.name) });
        if (comp.version.len > 0) {
            try w.print("{f}\"version\": {f},\n", .{ pad1, jsonStr(comp.version) });
        }
        try w.print("{f}\"scope\": \"{s}\"", .{ pad1, comp.scope.toCycloneDX() });
        if (comp.purl.len > 0) {
            try w.print(",\n{f}\"purl\": {f}", .{ pad1, jsonStr(comp.purl) });
        }
        if (comp.download_url.len > 0) {
            try w.print(",\n{f}\"externalReferences\": [{{ \"type\": \"distribution\", \"url\": {f} }}]", .{
                pad1,
                jsonStr(comp.download_url),
            });
        }
        if (cycloneDXHashAlg(comp.integrity.tag)) |alg| {
            var hex_buf: [Integrity.digest_buf_len * 2]u8 = undefined;
            const hex = hexDigest(&comp.integrity, &hex_buf);
            try w.print(",\n{f}\"hashes\": [{{ \"alg\": \"{s}\", \"content\": \"{s}\" }}]", .{ pad1, alg, hex });
        }
        try w.print("\n{f}}}", .{pad});
    }

    fn writeCycloneDXDependency(this: *const Generator, w: *std.Io.Writer, comp: *const Component) !void {
        try w.print("    {{ \"ref\": {f}, \"dependsOn\": [", .{jsonStr(comp.ref)});
        var first = true;
        for (comp.deps.items) |dep_id| {
            const dep = this.componentFor(dep_id) orelse continue;
            if (!first) try w.writeAll(", ");
            try w.print("{f}", .{jsonStr(dep.ref)});
            first = false;
        }
        try w.writeAll("] }");
    }

    fn cycloneDXHashAlg(tag: Integrity.Tag) ?[]const u8 {
        return switch (tag) {
            .sha1 => "SHA-1",
            .sha256 => "SHA-256",
            .sha384 => "SHA-384",
            .sha512 => "SHA-512",
            else => null,
        };
    }

    // ==== SPDX 2.3 ===========================================================

    fn writeSPDX(this: *const Generator, w: *std.Io.Writer) !void {
        try w.writeAll("{\n");
        try w.writeAll("  \"spdxVersion\": \"SPDX-2.3\",\n");
        try w.writeAll("  \"dataLicense\": \"CC0-1.0\",\n");
        try w.writeAll("  \"SPDXID\": \"SPDXRef-DOCUMENT\",\n");
        try w.print("  \"name\": {f},\n", .{jsonStr(this.root.ref)});
        try w.print("  \"documentNamespace\": \"https://spdx.org/spdxdocs/{s}-{s}\",\n", .{
            this.root.spdx_id,
            this.serial_uuid,
        });
        try w.writeAll("  \"creationInfo\": {\n");
        try w.print("    \"created\": \"{s}\",\n", .{this.timestamp});
        try w.print("    \"creators\": [\"Tool: bun-{s}\"]\n", .{Global.package_json_version});
        try w.writeAll("  },\n");
        try w.print("  \"documentDescribes\": [\"SPDXRef-Package-{s}\"],\n", .{this.root.spdx_id});

        // packages
        try w.writeAll("  \"packages\": [\n");
        try this.writeSPDXPackage(w, &this.root, true);
        for (this.components.items) |*comp| {
            try w.writeAll(",\n");
            try this.writeSPDXPackage(w, comp, false);
        }
        try w.writeAll("\n  ],\n");

        // relationships
        try w.writeAll("  \"relationships\": [\n");
        try w.print(
            "    {{ \"spdxElementId\": \"SPDXRef-DOCUMENT\", \"relatedSpdxElement\": \"SPDXRef-Package-{s}\", \"relationshipType\": \"DESCRIBES\" }}",
            .{this.root.spdx_id},
        );
        try this.writeSPDXRelationships(w, &this.root);
        for (this.components.items) |*comp| {
            try this.writeSPDXRelationships(w, comp);
        }
        try w.writeAll("\n  ]\n");

        try w.writeAll("}\n");
    }

    fn writeSPDXPackage(this: *const Generator, w: *std.Io.Writer, comp: *const Component, is_root: bool) !void {
        _ = this;
        try w.writeAll("    {\n");
        try w.print("      \"name\": {f},\n", .{jsonStr(comp.name)});
        try w.print("      \"SPDXID\": \"SPDXRef-Package-{s}\",\n", .{comp.spdx_id});
        if (comp.version.len > 0) {
            try w.print("      \"versionInfo\": {f},\n", .{jsonStr(comp.version)});
        }
        if (is_root) {
            try w.writeAll("      \"primaryPackagePurpose\": \"APPLICATION\",\n");
        }
        if (comp.download_url.len > 0) {
            try w.print("      \"downloadLocation\": {f},\n", .{jsonStr(comp.download_url)});
        } else {
            try w.writeAll("      \"downloadLocation\": \"NOASSERTION\",\n");
        }
        try w.writeAll("      \"filesAnalyzed\": false,\n");
        try w.writeAll("      \"licenseConcluded\": \"NOASSERTION\",\n");
        try w.writeAll("      \"licenseDeclared\": \"NOASSERTION\",\n");
        try w.writeAll("      \"copyrightText\": \"NOASSERTION\"");
        if (comp.purl.len > 0) {
            try w.print(
                ",\n      \"externalRefs\": [{{ \"referenceCategory\": \"PACKAGE-MANAGER\", \"referenceType\": \"purl\", \"referenceLocator\": {f} }}]",
                .{jsonStr(comp.purl)},
            );
        }
        if (spdxHashAlg(comp.integrity.tag)) |alg| {
            var hex_buf: [Integrity.digest_buf_len * 2]u8 = undefined;
            const hex = hexDigest(&comp.integrity, &hex_buf);
            try w.print(",\n      \"checksums\": [{{ \"algorithm\": \"{s}\", \"checksumValue\": \"{s}\" }}]", .{ alg, hex });
        }
        try w.writeAll("\n    }");
    }

    fn writeSPDXRelationships(this: *const Generator, w: *std.Io.Writer, comp: *const Component) !void {
        for (comp.deps.items) |dep_id| {
            const dep_comp = this.componentFor(dep_id) orelse continue;
            // A parent can list the same resolved package under more than
            // one dependency group (e.g. both `dependencies` and
            // `peerDependencies`). Scan every matching edge and pick the
            // strongest relationship (required > optional > dev), matching
            // the precedence used for CycloneDX scope.
            const rel_type: enum { depends_on, optional_of, dev_of } = relationshipType: {
                const pkg_dep_resolutions = this.lockfile.packages.items(.resolutions)[comp.package_id];
                const pkg_deps = this.lockfile.packages.items(.dependencies)[comp.package_id];
                const deps = pkg_deps.get(this.lockfile.buffers.dependencies.items);
                const resolved = pkg_dep_resolutions.get(this.lockfile.buffers.resolutions.items);
                var has_dev = false;
                var has_optional = false;
                for (deps, resolved) |dep, r| {
                    if (r != dep_id) continue;
                    if (dep.behavior.isDev()) {
                        has_dev = true;
                    } else if (dep.behavior.isOptional() or dep.behavior.isOptionalPeer()) {
                        has_optional = true;
                    } else {
                        break :relationshipType .depends_on;
                    }
                }
                if (has_optional) break :relationshipType .optional_of;
                if (has_dev) break :relationshipType .dev_of;
                break :relationshipType .depends_on;
            };
            switch (rel_type) {
                .depends_on => try w.print(
                    ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{s}\", \"relatedSpdxElement\": \"SPDXRef-Package-{s}\", \"relationshipType\": \"DEPENDS_ON\" }}",
                    .{ comp.spdx_id, dep_comp.spdx_id },
                ),
                // For `*_OF` relationships, the subject is the dependency and
                // the object is the dependent.
                .optional_of => try w.print(
                    ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{s}\", \"relatedSpdxElement\": \"SPDXRef-Package-{s}\", \"relationshipType\": \"OPTIONAL_DEPENDENCY_OF\" }}",
                    .{ dep_comp.spdx_id, comp.spdx_id },
                ),
                .dev_of => try w.print(
                    ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{s}\", \"relatedSpdxElement\": \"SPDXRef-Package-{s}\", \"relationshipType\": \"DEV_DEPENDENCY_OF\" }}",
                    .{ dep_comp.spdx_id, comp.spdx_id },
                ),
            }
        }
    }

    fn spdxHashAlg(tag: Integrity.Tag) ?[]const u8 {
        return switch (tag) {
            .sha1 => "SHA1",
            .sha256 => "SHA256",
            .sha384 => "SHA384",
            .sha512 => "SHA512",
            else => null,
        };
    }

    // ==== helpers ============================================================

    fn hexDigest(integrity: *const Integrity, out: []u8) []const u8 {
        const digest = integrity.slice();
        const hex_chars = "0123456789abcdef";
        for (digest, 0..) |b, i| {
            out[i * 2] = hex_chars[b >> 4];
            out[i * 2 + 1] = hex_chars[b & 0x0f];
        }
        return out[0 .. digest.len * 2];
    }

    const Indent = struct {
        n: usize,
        pub fn format(this: Indent, w: *std.Io.Writer) !void {
            try w.splatByteAll(' ', this.n);
        }
    };

    const JsonStr = @TypeOf(bun.fmt.formatJSONStringUTF8("", .{}));

    fn jsonStr(s: []const u8) JsonStr {
        return bun.fmt.formatJSONStringUTF8(s, .{});
    }
};

const string = []const u8;

const Lockfile = @import("../install/lockfile.zig");
const std = @import("std");
const Integrity = @import("../install/integrity.zig").Integrity;
const PackageManagerCommand = @import("./package_manager_command.zig").PackageManagerCommand;

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const logger = bun.logger;
const strings = bun.strings;
const Command = bun.cli.Command;

const install = bun.install;
const PackageID = install.PackageID;
const PackageManager = install.PackageManager;
const invalid_package_id = install.invalid_package_id;
