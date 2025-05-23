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

pub fn view(allocator: std.mem.Allocator, manager: *PackageManager, spec: string, property_path: ?string, json_output: bool) !void {
    var name = spec;
    var version: ?string = null;
    if (strings.lastIndexOfChar(spec, '@')) |idx| {
        if (idx != 0) {
            if (spec[0] != '@' or if (strings.indexOfChar(spec, '/')) |slash| idx > slash else true) {
                name = spec[0..idx];
                version = spec[idx + 1 ..];
            }
        }
    }

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
        try @import("../install/npm.zig").responseError(allocator, &req, &res, if (version) |v| .{ name, v } else null, &response_buf, false);
    }

    var log = logger.Log.init(allocator);
    const source = logger.Source.initPathString("view.json", response_buf.list.items);
    var json = JSON.parseUTF8(&source, &log, allocator) catch |err| {
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
        if (json.getObject("versions")) |versions_obj| {
            versions_len = versions_obj.data.e_object.properties.len;

            if (version) |version_spec| {
                // Use the exact same logic as outdated_command.zig
                var wanted_version: ?Semver.Version = null;

                // First try dist-tag lookup (like "latest", "beta", etc.)
                if (parsed_manifest.findByDistTag(version_spec)) |result| {
                    wanted_version = result.version;
                } else {
                    // Parse as semver query and find best version - exactly like outdated_command.zig line 325
                    const sliced_literal = Semver.SlicedString.init(version_spec, version_spec);
                    if (Semver.Query.parse(allocator, version_spec, sliced_literal)) |query| {
                        defer query.deinit();
                        // Use the same pattern as outdated_command: findBestVersion(query.head, string_buf)
                        if (parsed_manifest.findBestVersion(query, parsed_manifest.string_buf)) |result| {
                            wanted_version = result.version;
                        }
                    } else |_| {
                        // Fallback to latest if parsing fails
                        if (parsed_manifest.findByDistTag("latest")) |result| {
                            wanted_version = result.version;
                        }
                    }
                }

                // Find the version string from JSON that matches the resolved version
                if (wanted_version) |wv| {
                    const versions = versions_obj.data.e_object.properties.slice();
                    for (versions) |prop| {
                        if (prop.key == null) continue;
                        const version_str = prop.key.?.asString(allocator) orelse continue;
                        const sliced_version = Semver.SlicedString.init(version_str, version_str);
                        const parsed_version = Semver.Version.parse(sliced_version);
                        if (parsed_version.valid and parsed_version.version.max().eql(wv)) {
                            break :brk .{ version_str, prop.value.? };
                        }
                    }
                }
            } else {
                // No version specified - use latest
                if (parsed_manifest.findByDistTag("latest")) |result| {
                    const versions = versions_obj.data.e_object.properties.slice();
                    for (versions) |prop| {
                        if (prop.key == null) continue;
                        const version_str = prop.key.?.asString(allocator) orelse continue;
                        const sliced_version = Semver.SlicedString.init(version_str, version_str);
                        const parsed_version = Semver.Version.parse(sliced_version);
                        if (parsed_version.valid and parsed_version.version.max().eql(result.version)) {
                            break :brk .{ version_str, prop.value.? };
                        }
                    }
                }
            }
        }

        if (json_output) {
            Output.print("{{ \"error\": \"No matching version found\", \"version\": {} }}\n", .{
                bun.fmt.formatJSONStringUTF8(spec, .{
                    .quote = true,
                }),
            });
            Output.flush();
        } else {
            Output.errGeneric("No version of <b>{}<r> satisfying <b>{}<r> found", .{
                bun.fmt.quote(name),
                bun.fmt.quote(version orelse "latest"),
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

    // Handle property lookup if specified
    if (property_path) |prop_path| {
        if (manifest.getPathMayBeIndex(prop_path)) |*value| {
            if (value.data == .e_string) {
                const slice = value.data.e_string.slice(allocator);
                Output.println("{s}", .{slice});
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
                value.*,
                &source,
                .{
                    .mangled_props = null,
                    .indent = .{ .count = 2 },
                },
            );
            Output.print("{s}", .{package_json_writer.ctx.getWritten()});
            Output.flush();
        } else {
            if (json_output) {
                Output.print("{{ \"error\": \"Property not found\", \"version\": {}, \"property\": {} }}\n", .{
                    bun.fmt.formatJSONStringUTF8(spec, .{
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
        return;
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
            &source,
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
    const pkg_version = manifest.getStringCloned(allocator, "version") catch null orelse version orelse "";
    const license = manifest.getStringCloned(allocator, "license") catch null orelse "";
    var dep_count: usize = 0;
    if (manifest.getObject("dependencies")) |deps| {
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
        var keywords = MutableString.init(allocator, 64) catch unreachable;
        var iter = arr;
        var first = true;
        while (iter.next()) |kw_expr| {
            if (kw_expr.asString(allocator)) |kw| {
                if (!first) keywords.appendSlice(", ") catch unreachable else first = false;
                keywords.appendSlice(kw) catch unreachable;
            }
        }
        if (keywords.list.items.len > 0) {
            Output.prettyln("<d>keywords:<r> {s}", .{keywords.list.items});
        }
    }

    // Display dependencies if they exist
    if (manifest.getObject("dependencies")) |deps| {
        const dependencies = deps.data.e_object.properties.slice();
        if (dependencies.len > 0) {
            Output.prettyln("\n<d>.<r><b>dependencies<r><d> ({d}):<r>", .{dependencies.len});
        }

        for (dependencies) |prop| {
            if (prop.key == null or prop.value == null) continue;
            const dep_name = prop.key.?.asString(allocator) orelse continue;
            const dep_version = prop.value.?.asString(allocator) orelse continue;
            Output.prettyln("- <cyan>{s}<r><d>:<r> {s}", .{ dep_name, dep_version });
        }
    }

    if (manifest.getObject("dist")) |dist| {
        Output.prettyln("\n<d>.<r><b>dist<r>", .{});
        if (dist.getStringCloned(allocator, "tarball") catch null) |t| {
            Output.prettyln(" <d>tarball<d>:<r> {s}", .{t});
        }
        if (dist.getStringCloned(allocator, "shasum") catch null) |s| {
            Output.prettyln(" <d>shasum<d>:<r> <g>{s}<r>", .{s});
        }
        if (dist.getStringCloned(allocator, "integrity") catch null) |i| {
            Output.prettyln(" <d>integrity<d>:<r> <g>{s}<r>", .{i});
        }
        if (dist.getNumber("unpackedSize")) |u| {
            Output.prettyln(" <d>unpackedSize<d>:<r> <blue>{}<r>", .{bun.fmt.size(@as(u64, @intFromFloat(u[0])), .{})});
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
        if (time_obj.getStringCloned(allocator, pkg_version) catch null) |published_time| {
            Output.prettyln("\n<b>Published<r><d>:<r> {s}", .{published_time});
        } else if (time_obj.getStringCloned(allocator, "modified") catch null) |modified_time| {
            Output.prettyln("\n<b>Published<r><d>:<r> {s}", .{modified_time});
        }
    }
}
