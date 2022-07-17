const logger = @import("logger");
const JSAst = @import("js_ast");
const Output = @import("global").Output;
const Global = @import("global").Global;
const string = @import("../string_types.zig").string;
const Dependency = @import("./dependency.zig");
const strings = @import("../string_immutable.zig");
const Semver = @import("./semver.zig");
const SlicedString = Semver.SlicedString;
const String = Semver.String;

pub const PackageNameHash = u64;

pub const UpdateRequest = struct {
    name: string = "",
    name_hash: PackageNameHash = 0,
    resolved_version_buf: string = "",
    version: Dependency.Version = Dependency.Version{},
    version_buf: []const u8 = "",
    missing_version: bool = false,
    failed: bool = false,
    // This must be cloned to handle when the AST store resets
    e_string: ?*JSAst.E.String = null,

    pub const Array = std.BoundedArray(UpdateRequest, 64);

    pub fn parse(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        positionals: []const string,
        update_requests: *Array,
        op: [:0]const u8,
    ) []UpdateRequest {
        // first one is always either:
        // add
        // remove
        for (positionals) |positional| {
            var request = UpdateRequest{
                .name = positional,
            };
            var unscoped_name = positional;
            request.name = unscoped_name;

            // request.name = "@package..." => unscoped_name = "package..."
            if (unscoped_name.len > 0 and unscoped_name[0] == '@') {
                unscoped_name = unscoped_name[1..];
            }

            // if there is a semver in package name...
            if (std.mem.indexOfScalar(u8, unscoped_name, '@')) |i| {
                // unscoped_name = "package@1.0.0" => request.name = "package"
                request.name = unscoped_name[0..i];

                // if package was scoped, put "@" back in request.name
                if (unscoped_name.ptr != positional.ptr) {
                    request.name = positional[0 .. i + 1];
                }

                // unscoped_name = "package@1.0.0" => request.version_buf = "1.0.0"
                if (unscoped_name.len > i + 1) request.version_buf = unscoped_name[i + 1 ..];
            }

            if (strings.hasPrefix("http://", request.name) or
                strings.hasPrefix("https://", request.name))
            {
                if (Output.isEmojiEnabled()) {
                    Output.prettyErrorln("<r>😢 <red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        op,
                    });
                } else {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        op,
                    });
                }

                Global.exit(1);
            }

            request.name = std.mem.trim(u8, request.name, "\n\r\t");
            if (request.name.len == 0) continue;

            request.version_buf = std.mem.trim(u8, request.version_buf, "\n\r\t");

            // https://github.com/npm/npm-package-arg/blob/fbaf2fd0b72a0f38e7c24260fd4504f4724c9466/npa.js#L330
            if (strings.hasPrefix("https://", request.version_buf) or
                strings.hasPrefix("http://", request.version_buf))
            {
                if (Output.isEmojiEnabled()) {
                    Output.prettyErrorln("<r>😢 <red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        op,
                    });
                } else {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        op,
                    });
                }

                Global.exit(1);
            }

            if (request.version_buf.len == 0) {
                request.missing_version = true;
            } else {
                const sliced = SlicedString.init(request.version_buf, request.version_buf);
                request.version = Dependency.parse(allocator, request.version_buf, &sliced, log) orelse Dependency.Version{};
            }
            request.name_hash = String.Builder.stringHash(request.name);
            update_requests.append(request) catch break;
        }

        return update_requests.slice();
    }
};

const std = @import("std");
const default_allocator = @import("../global_allocators.zig").default_allocator;

test "UpdateRequests.parse" {
    var log = logger.Log.init(default_allocator);
    var array = UpdateRequest.Array.init(0) catch unreachable;

    const updates: []const []const u8 = &.{ "@bacon/name", "foo", "bar", "baz", "boo@1.0.0", "bing@latest", "@bakon/name@1.0.0" };
    var reqs = UpdateRequest.parse(default_allocator, &log, updates, &array, "add");

    try std.testing.expectEqualStrings(reqs[0].name, "@bacon/name");
    try std.testing.expectEqualStrings(reqs[1].name, "foo");
    try std.testing.expectEqualStrings(reqs[2].name, "bar");
    try std.testing.expectEqualStrings(reqs[3].name, "baz");
    try std.testing.expectEqualStrings(reqs[4].name, "boo");
    try std.testing.expectEqual(reqs[4].version.tag, Dependency.Version.Tag.npm);
    try std.testing.expectEqualStrings(reqs[4].version.literal.slice("boo@1.0.0"), "1.0.0");
    try std.testing.expectEqual(reqs[5].version.tag, Dependency.Version.Tag.dist_tag);
    try std.testing.expectEqualStrings(reqs[5].version.literal.slice("bing@1.0.0"), "latest");
    try std.testing.expectEqualStrings(reqs[6].name, "@bakon/name");
    try std.testing.expectEqual(reqs[6].version.tag, Dependency.Version.Tag.npm);
    try std.testing.expectEqualStrings(reqs[6].version.literal.slice("@bakon/name@1.0.0"), "1.0.0");
    try std.testing.expectEqual(updates.len, 7);
}
