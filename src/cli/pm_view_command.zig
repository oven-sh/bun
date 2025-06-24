const URL = @import("../url.zig").URL;
const bun = @import("bun");
const std = @import("std");
const MutableString = bun.MutableString;
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const PackageManager = @import("../install/install.zig").PackageManager;
const logger = bun.logger;
const Output = bun.Output;
const Global = bun.Global;
const JSON = bun.JSON;
const http = bun.http;
const Semver = bun.Semver;
const PackageManifest = @import("../install/npm.zig").PackageManifest;

pub fn view(allocator: std.mem.Allocator, manager: *PackageManager, spec_: string, property_path: ?string, json_output: bool) !void {
    const name, var version = bun.install.Dependency.splitNameAndVersionOrLatest(brk: {
        // Extremely best effort.
        if (bun.strings.eqlComptime(spec_, ".") or bun.strings.eqlComptime(spec_, "")) {
            if (bun.strings.isNPMPackageName(manager.root_package_json_name_at_time_of_init)) {
                break :brk manager.root_package_json_name_at_time_of_init;
            }

            // Try our best to get the package.json name they meant
            if (manager.root_dir.hasComptimeQuery("package.json")) from_package_json: {
                if (manager.root_dir.fd.isValid()) {
                    switch (bun.sys.File.readFrom(manager.root_dir.fd, "package.json", allocator)) {
                        .err => {},
                        .result => |str| {
                            const source = &logger.Source.initPathString("package.json", str);
                            var log = logger.Log.init(allocator);
                            const json = JSON.parse(source, &log, allocator, false) catch break :from_package_json;
                            if (json.getStringCloned(allocator, "name") catch null) |name| {
                                if (name.len > 0) {
                                    break :brk name;
                                }
                            }
                        },
                    }
                }
            }

            break :brk std.fs.path.basename(bun.fs.FileSystem.instance.top_level_dir);
        }

        break :brk spec_;
    });

    const scope = manager.scopeForPackageName(name);

    var url_buf: bun.PathBuffer = undefined;
    const encoded_name = try std.fmt.bufPrint(&url_buf, "{s}", .{bun.fmt.dependencyUrl(name)});
    var path_buf: bun.PathBuffer = undefined;
    // Always fetch the full registry manifest, not a specific version
    const url = URL.parse(try std.fmt.bufPrint(&path_buf, "{s}/{s}", .{
        strings.withoutTrailingSlash(scope.url.href),
        encoded_name,
    }));

    var headers: http.HeaderBuilder = .{};
    headers.count("Accept", "application/json");
    if (scope.token.len > 0) {
        headers.count("Authorization", "");
        headers.content.cap += "Bearer ".len + scope.token.len;
    } else if (scope.auth.len > 0) {
        headers.count("Authorization", "");
        headers.content.cap += "Basic ".len + scope.auth.len;
    }
    try headers.allocate(allocator);
    headers.append("Accept", "application/json");
    if (scope.token.len > 0) {
        headers.appendFmt("Authorization", "Bearer {s}", .{scope.token});
    } else if (scope.auth.len > 0) {
        headers.appendFmt("Authorization", "Basic {s}", .{scope.auth});
    }

    var response_buf = try MutableString.init(allocator, 2048);
    var req = http.AsyncHTTP.initSync(
        allocator,
        .GET,
        url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        "",
        manager.httpProxy(url),
        null,
        .follow,
    );
    req.client.flags.reject_unauthorized = manager.tlsRejectUnauthorized();

    const res = req.sendSync() catch |err| {
        Output.err(err, "view request failed to send", .{});
        Global.crash();
    };

    if (res.status_code >= 400) {
        try @import("../install/npm.zig").responseError(allocator, &req, &res, .{ name, version }, &response_buf, false);
    }

    var log = logger.Log.init(allocator);
    const source = &logger.Source.initPathString("view.json", response_buf.list.items);
    var json = JSON.parseUTF8(source, &log, allocator) catch |err| {
        Output.err(err, "failed to parse response body as JSON", .{});
        Global.crash();
    };
    if (log.errors > 0) {
        try log.print(Output.errorWriter());
        Global.crash();
    }

    // Parse the existing JSON response into a PackageManifest using the now-public parse function
    const parsed_manifest = @import("../install/npm.zig").PackageManifest.parse(
        allocator,
        scope,
        &log,
        response_buf.list.items,
        name,
        "", // last_modified (not needed for view)
        "", // etag (not needed for view)
        0, // public_max_age (not needed for view)
    ) catch |err| {
        Output.err(err, "failed to parse package manifest", .{});
        Global.exit(1);
    } orelse {
        Output.errGeneric("failed to parse package manifest", .{});
        Global.crash();
    };

    // Now use the existing version resolution logic from outdated_command
    var manifest = json;

    var versions_len: usize = 1;

    version, manifest = brk: {
        if (json.getObject("versions")) |versions_obj| from_versions: {
            // Find the version string from JSON that matches the resolved version
            const versions = versions_obj.data.e_object.properties.slice();
            versions_len = versions.len;

            const wanted_version: Semver.Version = brk2: {
                // First try dist-tag lookup (like "latest", "beta", etc.)
                if (parsed_manifest.findByDistTag(version)) |result| {
                    break :brk2 result.version;
                } else {
                    // Parse as semver query and find best version - exactly like outdated_command.zig line 325
                    const sliced_literal = Semver.SlicedString.init(version, version);
                    const query = try Semver.Query.parse(allocator, version, sliced_literal);
                    defer query.deinit();
                    // Use the same pattern as outdated_command: findBestVersion(query.head, string_buf)
                    if (parsed_manifest.findBestVersion(query, parsed_manifest.string_buf)) |result| {
                        break :brk2 result.version;
                    }
                }

                break :from_versions;
            };

            for (versions) |*prop| {
                if (prop.key == null) continue;
                const version_str = prop.key.?.asString(allocator) orelse continue;
                const sliced_version = Semver.SlicedString.init(version_str, version_str);
                const parsed_version = Semver.Version.parse(sliced_version);
                if (parsed_version.valid and parsed_version.version.max().eql(wanted_version)) {
                    break :brk .{ version_str, prop.value.? };
                }
            }
        }

        if (json_output) {
            Output.print("{{ \"error\": \"No matching version found\", \"version\": {} }}\n", .{
                bun.fmt.formatJSONStringUTF8(spec_, .{
                    .quote = true,
                }),
            });
            Output.flush();
        } else {
            Output.errGeneric("No version of <b>{}<r> satisfying <b>{}<r> found", .{
                bun.fmt.quote(name),
                bun.fmt.quote(version),
            });

            const max_versions_to_display = 5;

            const start_index = parsed_manifest.versions.len -| max_versions_to_display;
            var versions_to_display = parsed_manifest.versions[start_index..];
            versions_to_display = versions_to_display[0..@min(versions_to_display.len, max_versions_to_display)];
            if (versions_to_display.len > 0) {
                Output.prettyErrorln("\nRecent versions:<r>", .{});
                for (versions_to_display) |*v| {
                    Output.prettyErrorln("<d>-<r> {}", .{v.fmt(parsed_manifest.string_buf)});
                }

                if (start_index > 0) {
                    Output.prettyErrorln("  <d>... and {d} more<r>", .{start_index});
                }
            }
        }
        Global.exit(1);
    };

    // Treat versions specially because npm does some normalization on there.
    if (json.getObject("versions")) |versions_object| {
        const keys = try allocator.alloc(bun.JSAst.Expr, versions_object.data.e_object.properties.len);
        for (versions_object.data.e_object.properties.slice(), keys) |*prop, *key| {
            key.* = prop.key.?;
        }
        const versions_array = bun.JSAst.Expr.init(
            bun.JSAst.E.Array,
            bun.JSAst.E.Array{
                .items = .init(keys),
            },
            .{ .start = -1 },
        );
        try manifest.set(allocator, "versions", versions_array);
    }

    // Handle property lookup if specified
    if (property_path) |prop_path| {

        // This is similar to what npm does.
        // `bun pm view react version ` => 1.2.3
        // `bun pm view react versions` => ['1.2.3', '1.2.4', '1.2.5']
        if (manifest.getPathMayBeIndex(prop_path) orelse json.getPathMayBeIndex(prop_path)) |value| {
            if (value.data == .e_string) {
                const slice = value.data.e_string.slice(allocator);
                if (json_output) {
                    Output.println("{s}", .{bun.fmt.formatJSONStringUTF8(slice, .{})});
                } else {
                    Output.println("{s}", .{slice});
                }
                Output.flush();
                return;
            }

            const JSPrinter = bun.js_printer;
            var buffer_writer = JSPrinter.BufferWriter.init(bun.default_allocator);
            buffer_writer.append_newline = true;
            var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);
            _ = try bun.js_printer.printJSON(
                @TypeOf(&package_json_writer),
                &package_json_writer,
                value,
                source,
                .{
                    .mangled_props = null,
                },
            );
            Output.print("{s}", .{package_json_writer.ctx.getWritten()});
            Output.flush();
            Global.exit(0);
        } else {
            if (json_output) {
                Output.print("{{ \"error\": \"Property not found\", \"version\": {}, \"property\": {} }}\n", .{
                    bun.fmt.formatJSONStringUTF8(spec_, .{
                        .quote = true,
                    }),
                    bun.fmt.formatJSONStringUTF8(prop_path, .{
                        .quote = true,
                    }),
                });
                Output.flush();
            } else {
                Output.errGeneric("Property <b>{s}<r> not found", .{prop_path});
            }
        }
        Global.exit(1);
    }

    if (json_output) {
        // Output formatted JSON using JSPrinter
        const JSPrinter = bun.js_printer;
        var buffer_writer = JSPrinter.BufferWriter.init(bun.default_allocator);
        buffer_writer.append_newline = true;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);
        _ = try bun.js_printer.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            manifest,
            source,
            .{
                .mangled_props = null,
                .indent = .{
                    .count = 2,
                },
            },
        );
        Output.print("{s}", .{package_json_writer.ctx.getWritten()});
        Output.flush();
        return;
    }

    const pkg_name = manifest.getStringCloned(allocator, "name") catch null orelse name;
    const pkg_version = manifest.getStringCloned(allocator, "version") catch null orelse version;
    const license = manifest.getStringCloned(allocator, "license") catch null orelse "";
    var dep_count: usize = 0;
    const dependencies_object = manifest.getObject("dependencies");
    if (dependencies_object) |*deps| {
        dep_count = deps.data.e_object.properties.len;
    }

    Output.prettyln("<b><blue><u>{s}<r><d>@<r><blue><b><u>{s}<r> <d>|<r> <cyan>{s}<r> <d>|<r> deps<d>:<r> {d} <d>|<r> versions<d>:<r> {d}", .{
        pkg_name,
        pkg_version,
        license,
        dep_count,
        versions_len,
    });

    // Get description and homepage from the top-level package manifest, not the version-specific one
    if (json.getStringCloned(allocator, "description") catch null) |desc| {
        Output.prettyln("{s}", .{desc});
    }
    if (json.getStringCloned(allocator, "homepage") catch null) |hp| {
        Output.prettyln("<blue>{s}<r>", .{hp});
    }

    if (json.getArray("keywords")) |arr| {
        var keywords = try MutableString.init(allocator, 64);
        var iter = arr;
        var first = true;
        while (iter.next()) |kw_expr| {
            if (kw_expr.asString(allocator)) |kw| {
                if (!first) try keywords.appendSlice(", ") else first = false;
                try keywords.appendSlice(kw);
            }
        }
        if (keywords.list.items.len > 0) {
            Output.prettyln("<d>keywords:<r> {s}", .{keywords.list.items});
        }
    }

    // Display dependencies if they exist
    if (dependencies_object) |*deps| {
        const dependencies = deps.data.e_object.properties.slice();
        if (dependencies.len > 0) {
            Output.prettyln("\n<b>dependencies<r><d> ({d}):<r>", .{dependencies.len});
        }

        for (dependencies) |prop| {
            if (prop.key == null or prop.value == null) continue;
            const dep_name = prop.key.?.asString(allocator) orelse continue;
            const dep_version = prop.value.?.asString(allocator) orelse continue;
            Output.prettyln("- <cyan>{s}<r><d>:<r> {s}", .{ dep_name, dep_version });
        }
    }

    if (manifest.getObject("dist")) |dist| {
        Output.prettyln("\n<d><r><b>dist<r>", .{});
        if (dist.getStringCloned(allocator, "tarball") catch null) |t| {
            Output.prettyln(" <d>.<r>tarball<d>:<r> {s}", .{t});
        }
        if (dist.getStringCloned(allocator, "shasum") catch null) |s| {
            Output.prettyln(" <d>.<r>shasum<r><d>:<r> <green>{s}<r>", .{s});
        }
        if (dist.getStringCloned(allocator, "integrity") catch null) |i| {
            Output.prettyln(" <d>.<r>integrity<r><d>:<r> <green>{s}<r>", .{i});
        }
        if (dist.getNumber("unpackedSize")) |u| {
            Output.prettyln(" <d>.<r>unpackedSize<r><d>:<r> <blue>{}<r>", .{bun.fmt.size(@as(u64, @intFromFloat(u[0])), .{})});
        }
    }

    if (json.getObject("dist-tags")) |tags_obj| {
        Output.prettyln("\n<b>dist-tags<r><d>:<r>", .{});
        for (tags_obj.data.e_object.properties.slice()) |prop| {
            if (prop.key == null or prop.value == null) continue;
            const tagname_expr = prop.key.?;
            const val_expr = prop.value.?;
            if (tagname_expr.asString(allocator)) |tag| {
                if (val_expr.asString(allocator)) |val| {
                    if (strings.eqlComptime(tag, "latest")) {
                        Output.prettyln("<cyan>{s}<r><d>:<r> {s}", .{ tag, val });
                    } else if (strings.eqlComptime(tag, "beta")) {
                        Output.prettyln("<blue>{s}<r><d>:<r> {s}", .{ tag, val });
                    } else {
                        Output.prettyln("<magenta>{s}<r><d>:<r> {s}", .{ tag, val });
                    }
                }
            }
        }
    }

    if (json.getArray("maintainers")) |maint_iter| {
        Output.prettyln("\nmaintainers<r><d>:<r>", .{});
        var iter = maint_iter;
        while (iter.next()) |m| {
            const nm = m.getStringCloned(allocator, "name") catch null orelse "";
            const em = m.getStringCloned(allocator, "email") catch null orelse "";
            if (em.len > 0) {
                Output.prettyln("<d>-<r> {s} <d>\\<{s}\\><r>", .{ nm, em });
            } else if (nm.len > 0) {
                Output.prettyln("<d>-<r> {s}", .{nm});
            }
        }
    }

    // Add published date information
    if (json.getObject("time")) |time_obj| {
        // TODO: use a relative time formatter
        if (time_obj.getStringCloned(allocator, pkg_version) catch null) |published_time| {
            Output.prettyln("\n<b>Published<r><d>:<r> {s}", .{published_time});
        } else if (time_obj.getStringCloned(allocator, "modified") catch null) |modified_time| {
            Output.prettyln("\n<b>Published<r><d>:<r> {s}", .{modified_time});
        }
    }
}
