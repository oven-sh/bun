//! Test-only host fns for `bun.ini` (used by `internal-for-testing.ts`).
//! Kept out of `ini/` so that directory has no JSC references.

pub const IniTestingAPIs = struct {
    pub fn loadNpmrcFromJS(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arg = callframe.argument(0);
        const npmrc_contents = try arg.toBunString(globalThis);
        defer npmrc_contents.deref();
        const npmrc_utf8 = npmrc_contents.toUTF8(bun.default_allocator);
        defer npmrc_utf8.deinit();
        const source = &bun.logger.Source.initPathString("<js>", npmrc_utf8.slice());

        var log = bun.logger.Log.init(bun.default_allocator);
        defer log.deinit();

        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        const allocator = arena.allocator();
        defer arena.deinit();

        const envjs = callframe.argument(1);
        const env = if (envjs.isEmptyOrUndefinedOrNull()) globalThis.bunVM().transpiler.env else brk: {
            var envmap = bun.DotEnv.Map.HashTable.init(allocator);
            const envobj = envjs.getObject() orelse return globalThis.throwTypeError("env must be an object", .{});
            var object_iter = try jsc.JSPropertyIterator(.{
                .skip_empty_name = false,
                .include_value = true,
            }).init(globalThis, envobj);
            defer object_iter.deinit();

            try envmap.ensureTotalCapacity(object_iter.len);

            while (try object_iter.next()) |key| {
                const keyslice = try key.toOwnedSlice(allocator);
                var value = object_iter.value;
                if (value.isUndefined()) continue;

                const value_str = try value.getZigString(globalThis);
                const slice = try value_str.toOwnedSlice(allocator);

                envmap.put(keyslice, .{
                    .value = slice,
                    .conditional = false,
                }) catch return globalThis.throwOutOfMemoryValue();
            }

            const map = try allocator.create(bun.DotEnv.Map);
            map.* = .{
                .map = envmap,
            };

            const env = bun.DotEnv.Loader.init(map, allocator);
            const envstable = try allocator.create(bun.DotEnv.Loader);
            envstable.* = env;
            break :brk envstable;
        };

        const install = try allocator.create(bun.schema.api.BunInstall);
        install.* = std.mem.zeroes(bun.schema.api.BunInstall);
        var configs = std.array_list.Managed(ConfigIterator.Item).init(allocator);
        defer configs.deinit();
        loadNpmrc(allocator, install, env, ".npmrc", &log, source, &configs) catch {
            return log.toJS(globalThis, bun.default_allocator, "error");
        };

        const default_registry_url, const default_registry_token, const default_registry_username, const default_registry_password, const default_registry_email = brk: {
            const default_registry = install.default_registry orelse break :brk .{
                bun.String.static(Registry.default_url[0..]),
                bun.String.empty,
                bun.String.empty,
                bun.String.empty,
                bun.String.empty,
            };

            break :brk .{
                bun.String.fromBytes(default_registry.url),
                bun.String.fromBytes(default_registry.token),
                bun.String.fromBytes(default_registry.username),
                bun.String.fromBytes(default_registry.password),
                bun.String.fromBytes(default_registry.email),
            };
        };
        defer {
            default_registry_url.deref();
            default_registry_token.deref();
            default_registry_username.deref();
            default_registry_password.deref();
            default_registry_email.deref();
        }

        return (try jsc.JSObject.create(.{
            .default_registry_url = default_registry_url,
            .default_registry_token = default_registry_token,
            .default_registry_username = default_registry_username,
            .default_registry_password = default_registry_password,
            .default_registry_email = default_registry_email,
        }, globalThis)).toJS();
    }

    pub fn parse(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments_ = callframe.arguments_old(1);
        const arguments = arguments_.slice();

        const jsstr = arguments[0];
        const bunstr = try jsstr.toBunString(globalThis);
        defer bunstr.deref();
        const utf8str = bunstr.toUTF8(bun.default_allocator);
        defer utf8str.deinit();

        var parser = Parser.init(bun.default_allocator, "<src>", utf8str.slice(), globalThis.bunVM().transpiler.env);
        defer parser.deinit();

        try parser.parse(parser.arena.allocator());

        return parser.out.toJS(bun.default_allocator, globalThis) catch |e| {
            return globalThis.throwError(e, "failed to turn AST into JS");
        };
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const Registry = bun.install.Npm.Registry;

const ini = bun.ini;
const ConfigIterator = ini.ConfigIterator;
const Parser = ini.Parser;
const loadNpmrc = ini.loadNpmrc;
