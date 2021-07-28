usingnamespace @import("../../global.zig");
const std = @import("std");

const Fs = @import("../../fs.zig");
const resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").ServeBundler;
const js_printer = @import("../../js_printer.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");

usingnamespace @import("./node_env_buf_map.zig");

pub const DefaultSpeedyDefines = struct {
    pub const Keys = struct {
        const window = "window";
    };
    pub const Values = struct {
        const window = "undefined";
    };
};

pub fn configureTransformOptionsForSpeedy(allocator: *std.mem.Allocator, _args: Api.TransformOptions) !Api.TransformOptions {
    var args = _args;

    args.platform = Api.Platform.speedy;
    args.serve = false;
    args.write = false;
    args.resolve = Api.ResolveMode.lazy;
    args.generate_node_module_bundle = false;

    // We inline process.env.* at bundle time but process.env is a proxy object which will otherwise return undefined.

    var env_map = try getNodeEnvMap(allocator);
    var env_count = env_map.count();

    if (args.define) |def| {
        for (def.keys) |key| {
            env_count += @boolToInt((env_map.get(key) == null));
        }
    }
    var needs_node_env = env_map.get("NODE_ENV") == null;
    var needs_window_undefined = true;

    var needs_regenerate = args.define == null and env_count > 0;
    if (args.define) |def| {
        if (def.keys.len != env_count) {
            needs_regenerate = true;
        }
        for (def.keys) |key| {
            if (strings.eql(key, "process.env.NODE_ENV")) {
                needs_node_env = false;
            } else if (strings.eql(key, "window")) {
                needs_window_undefined = false;
            }
        }
    }

    var extras_count = @intCast(usize, @boolToInt(needs_node_env)) + @intCast(usize, @boolToInt(needs_window_undefined));

    if (needs_regenerate) {
        var new_list = try allocator.alloc([]const u8, env_count * 2 + extras_count * 2);
        var keys = new_list[0 .. new_list.len / 2];
        var values = new_list[keys.len..];
        var new_map = Api.StringMap{
            .keys = keys,
            .values = values,
        };
        var iter = env_map.iterator();

        var last: usize = 0;
        while (iter.next()) |entry| {
            keys[last] = entry.key_ptr.*;
            var value = entry.value_ptr.*;

            if (value.len == 0 or value[0] != '"' or value[value.len - 1] != '"') {
                value = try std.fmt.allocPrint(allocator, "\"{s}\"", .{value});
            }
            values[last] = value;
            last += 1;
        }

        if (args.define) |def| {
            var from_env = keys[0..last];

            for (def.keys) |pre, i| {
                if (env_map.get(pre) != null) {
                    for (from_env) |key, j| {
                        if (strings.eql(key, pre)) {
                            values[j] = def.values[i];
                        }
                    }
                } else {
                    keys[last] = pre;
                    values[last] = def.values[i];
                    last += 1;
                }
            }
        }

        if (needs_node_env) {
            keys[last] = options.DefaultUserDefines.NodeEnv.Key;
            values[last] = options.DefaultUserDefines.NodeEnv.Value;
            last += 1;
        }

        if (needs_window_undefined) {
            keys[last] = DefaultSpeedyDefines.Keys.window;
            values[last] = DefaultSpeedyDefines.Values.window;
            last += 1;
        }

        args.define = new_map;
    }

    return args;
}
