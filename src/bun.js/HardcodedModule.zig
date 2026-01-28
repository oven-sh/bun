const string = []const u8;

pub const HardcodedModule = enum {
    bun,
    @"abort-controller",
    @"bun:app",
    @"bun:ffi",
    @"bun:jsc",
    @"bun:main",
    @"bun:test",
    @"bun:wrap",
    @"bun:sqlite",
    @"node:assert",
    @"node:assert/strict",
    @"node:async_hooks",
    @"node:buffer",
    @"node:child_process",
    @"node:console",
    @"node:constants",
    @"node:crypto",
    @"node:dns",
    @"node:dns/promises",
    @"node:domain",
    @"node:events",
    @"node:fs",
    @"node:fs/promises",
    @"node:http",
    @"node:https",
    @"node:module",
    @"node:net",
    @"node:os",
    @"node:path",
    @"node:path/posix",
    @"node:path/win32",
    @"node:perf_hooks",
    @"node:process",
    @"node:querystring",
    @"node:readline",
    @"node:readline/promises",
    @"node:stream",
    @"node:stream/consumers",
    @"node:stream/promises",
    @"node:stream/web",
    @"node:string_decoder",
    @"node:test",
    @"node:timers",
    @"node:timers/promises",
    @"node:tls",
    @"node:tty",
    @"node:url",
    @"node:util",
    @"node:util/types",
    @"node:vm",
    @"node:wasi",
    @"node:zlib",
    @"node:worker_threads",
    @"node:punycode",
    undici,
    ws,
    @"isomorphic-fetch",
    @"node-fetch",
    vercel_fetch,
    @"utf-8-validate",
    @"node:v8",
    @"node:trace_events",
    @"node:repl",
    @"node:inspector",
    @"node:inspector/promises",
    @"node:http2",
    @"node:diagnostics_channel",
    @"node:dgram",
    @"node:cluster",
    @"node:_stream_duplex",
    @"node:_stream_passthrough",
    @"node:_stream_readable",
    @"node:_stream_transform",
    @"node:_stream_wrap",
    @"node:_stream_writable",
    @"node:_tls_common",
    @"node:_http_agent",
    @"node:_http_client",
    @"node:_http_common",
    @"node:_http_incoming",
    @"node:_http_outgoing",
    @"node:_http_server",
    /// This is gated behind '--expose-internals'
    @"bun:internal-for-testing",

    /// The module loader first uses `Aliases` to get a single string during
    /// resolution, then maps that single string to the actual module.
    /// Do not include aliases here; Those go in `Aliases`.
    pub const map = bun.ComptimeStringMap(HardcodedModule, [_]struct { []const u8, HardcodedModule }{
        // Bun
        .{ "bun", .bun },
        .{ "bun:app", .@"bun:app" },
        .{ "bun:ffi", .@"bun:ffi" },
        .{ "bun:jsc", .@"bun:jsc" },
        .{ "bun:main", .@"bun:main" },
        .{ "bun:test", .@"bun:test" },
        .{ "bun:sqlite", .@"bun:sqlite" },
        .{ "bun:wrap", .@"bun:wrap" },
        .{ "bun:internal-for-testing", .@"bun:internal-for-testing" },
        // Node.js
        .{ "node:assert", .@"node:assert" },
        .{ "node:assert/strict", .@"node:assert/strict" },
        .{ "node:async_hooks", .@"node:async_hooks" },
        .{ "node:buffer", .@"node:buffer" },
        .{ "node:child_process", .@"node:child_process" },
        .{ "node:cluster", .@"node:cluster" },
        .{ "node:console", .@"node:console" },
        .{ "node:constants", .@"node:constants" },
        .{ "node:crypto", .@"node:crypto" },
        .{ "node:dgram", .@"node:dgram" },
        .{ "node:diagnostics_channel", .@"node:diagnostics_channel" },
        .{ "node:dns", .@"node:dns" },
        .{ "node:dns/promises", .@"node:dns/promises" },
        .{ "node:domain", .@"node:domain" },
        .{ "node:events", .@"node:events" },
        .{ "node:fs", .@"node:fs" },
        .{ "node:fs/promises", .@"node:fs/promises" },
        .{ "node:http", .@"node:http" },
        .{ "node:http2", .@"node:http2" },
        .{ "node:https", .@"node:https" },
        .{ "node:inspector", .@"node:inspector" },
        .{ "node:inspector/promises", .@"node:inspector/promises" },
        .{ "node:module", .@"node:module" },
        .{ "node:net", .@"node:net" },
        .{ "node:readline", .@"node:readline" },
        .{ "node:test", .@"node:test" },
        .{ "node:os", .@"node:os" },
        .{ "node:path", .@"node:path" },
        .{ "node:path/posix", .@"node:path/posix" },
        .{ "node:path/win32", .@"node:path/win32" },
        .{ "node:perf_hooks", .@"node:perf_hooks" },
        .{ "node:process", .@"node:process" },
        .{ "node:punycode", .@"node:punycode" },
        .{ "node:querystring", .@"node:querystring" },
        .{ "node:readline/promises", .@"node:readline/promises" },
        .{ "node:repl", .@"node:repl" },
        .{ "node:stream", .@"node:stream" },
        .{ "node:stream/consumers", .@"node:stream/consumers" },
        .{ "node:stream/promises", .@"node:stream/promises" },
        .{ "node:stream/web", .@"node:stream/web" },
        .{ "node:string_decoder", .@"node:string_decoder" },
        .{ "node:timers", .@"node:timers" },
        .{ "node:timers/promises", .@"node:timers/promises" },
        .{ "node:tls", .@"node:tls" },
        .{ "node:trace_events", .@"node:trace_events" },
        .{ "node:tty", .@"node:tty" },
        .{ "node:url", .@"node:url" },
        .{ "node:util", .@"node:util" },
        .{ "node:util/types", .@"node:util/types" },
        .{ "node:v8", .@"node:v8" },
        .{ "node:vm", .@"node:vm" },
        .{ "node:wasi", .@"node:wasi" },
        .{ "node:worker_threads", .@"node:worker_threads" },
        .{ "node:zlib", .@"node:zlib" },
        .{ "node:_stream_duplex", .@"node:_stream_duplex" },
        .{ "node:_stream_passthrough", .@"node:_stream_passthrough" },
        .{ "node:_stream_readable", .@"node:_stream_readable" },
        .{ "node:_stream_transform", .@"node:_stream_transform" },
        .{ "node:_stream_wrap", .@"node:_stream_wrap" },
        .{ "node:_stream_writable", .@"node:_stream_writable" },
        .{ "node:_tls_common", .@"node:_tls_common" },
        .{ "node:_http_agent", .@"node:_http_agent" },
        .{ "node:_http_client", .@"node:_http_client" },
        .{ "node:_http_common", .@"node:_http_common" },
        .{ "node:_http_incoming", .@"node:_http_incoming" },
        .{ "node:_http_outgoing", .@"node:_http_outgoing" },
        .{ "node:_http_server", .@"node:_http_server" },

        .{ "node-fetch", HardcodedModule.@"node-fetch" },
        .{ "isomorphic-fetch", HardcodedModule.@"isomorphic-fetch" },
        .{ "undici", HardcodedModule.undici },
        .{ "ws", HardcodedModule.ws },
        .{ "@vercel/fetch", HardcodedModule.vercel_fetch },
        .{ "utf-8-validate", HardcodedModule.@"utf-8-validate" },
        .{ "abort-controller", HardcodedModule.@"abort-controller" },
    });

    /// Contains the list of built-in modules from the perspective of the module
    /// loader. This logic is duplicated for `isBuiltinModule` and the like.
    pub const Alias = struct {
        path: [:0]const u8,
        tag: ImportRecord.Tag = .builtin,
        node_builtin: bool = false,
        node_only_prefix: bool = false,

        fn nodeEntry(comptime path: [:0]const u8) struct { string, Alias } {
            return .{
                path,
                .{
                    .path = if (path.len > 5 and std.mem.eql(u8, path[0..5], "node:")) path else "node:" ++ path,
                    .node_builtin = true,
                },
            };
        }
        fn nodeEntryOnlyPrefix(comptime path: [:0]const u8) struct { string, Alias } {
            return .{
                path,
                .{
                    .path = if (path.len > 5 and std.mem.eql(u8, path[0..5], "node:")) path else "node:" ++ path,
                    .node_builtin = true,
                    .node_only_prefix = true,
                },
            };
        }
        fn entry(comptime path: [:0]const u8) struct { string, Alias } {
            return .{ path, .{ .path = path } };
        }

        // Applied to both --target=bun and --target=node
        const common_alias_kvs = [_]struct { string, Alias }{
            nodeEntry("node:assert"),
            nodeEntry("node:assert/strict"),
            nodeEntry("node:async_hooks"),
            nodeEntry("node:buffer"),
            nodeEntry("node:child_process"),
            nodeEntry("node:cluster"),
            nodeEntry("node:console"),
            nodeEntry("node:constants"),
            nodeEntry("node:crypto"),
            nodeEntry("node:dgram"),
            nodeEntry("node:diagnostics_channel"),
            nodeEntry("node:dns"),
            nodeEntry("node:dns/promises"),
            nodeEntry("node:domain"),
            nodeEntry("node:events"),
            nodeEntry("node:fs"),
            nodeEntry("node:fs/promises"),
            nodeEntry("node:http"),
            nodeEntry("node:http2"),
            nodeEntry("node:https"),
            nodeEntry("node:inspector"),
            nodeEntry("node:inspector/promises"),
            nodeEntry("node:module"),
            nodeEntry("node:net"),
            nodeEntry("node:os"),
            nodeEntry("node:path"),
            nodeEntry("node:path/posix"),
            nodeEntry("node:path/win32"),
            nodeEntry("node:perf_hooks"),
            nodeEntry("node:process"),
            nodeEntry("node:punycode"),
            nodeEntry("node:querystring"),
            nodeEntry("node:readline"),
            nodeEntry("node:readline/promises"),
            nodeEntry("node:repl"),
            nodeEntry("node:stream"),
            nodeEntry("node:stream/consumers"),
            nodeEntry("node:stream/promises"),
            nodeEntry("node:stream/web"),
            nodeEntry("node:string_decoder"),
            nodeEntry("node:timers"),
            nodeEntry("node:timers/promises"),
            nodeEntry("node:tls"),
            nodeEntry("node:trace_events"),
            nodeEntry("node:tty"),
            nodeEntry("node:url"),
            nodeEntry("node:util"),
            nodeEntry("node:util/types"),
            nodeEntry("node:v8"),
            nodeEntry("node:vm"),
            nodeEntry("node:wasi"),
            nodeEntry("node:worker_threads"),
            nodeEntry("node:zlib"),
            // New Node.js builtins only resolve from the prefixed one.
            nodeEntryOnlyPrefix("node:test"),

            nodeEntry("assert"),
            nodeEntry("assert/strict"),
            nodeEntry("async_hooks"),
            nodeEntry("buffer"),
            nodeEntry("child_process"),
            nodeEntry("cluster"),
            nodeEntry("console"),
            nodeEntry("constants"),
            nodeEntry("crypto"),
            nodeEntry("dgram"),
            nodeEntry("diagnostics_channel"),
            nodeEntry("dns"),
            nodeEntry("dns/promises"),
            nodeEntry("domain"),
            nodeEntry("events"),
            nodeEntry("fs"),
            nodeEntry("fs/promises"),
            nodeEntry("http"),
            nodeEntry("http2"),
            nodeEntry("https"),
            nodeEntry("inspector"),
            nodeEntry("inspector/promises"),
            nodeEntry("module"),
            nodeEntry("net"),
            nodeEntry("os"),
            nodeEntry("path"),
            nodeEntry("path/posix"),
            nodeEntry("path/win32"),
            nodeEntry("perf_hooks"),
            nodeEntry("process"),
            nodeEntry("punycode"),
            nodeEntry("querystring"),
            nodeEntry("readline"),
            nodeEntry("readline/promises"),
            nodeEntry("repl"),
            nodeEntry("stream"),
            nodeEntry("stream/consumers"),
            nodeEntry("stream/promises"),
            nodeEntry("stream/web"),
            nodeEntry("string_decoder"),
            nodeEntry("timers"),
            nodeEntry("timers/promises"),
            nodeEntry("tls"),
            nodeEntry("trace_events"),
            nodeEntry("tty"),
            nodeEntry("url"),
            nodeEntry("util"),
            nodeEntry("util/types"),
            nodeEntry("v8"),
            nodeEntry("vm"),
            nodeEntry("wasi"),
            nodeEntry("worker_threads"),
            nodeEntry("zlib"),

            nodeEntry("node:_http_agent"),
            nodeEntry("node:_http_client"),
            nodeEntry("node:_http_common"),
            nodeEntry("node:_http_incoming"),
            nodeEntry("node:_http_outgoing"),
            nodeEntry("node:_http_server"),

            nodeEntry("_http_agent"),
            nodeEntry("_http_client"),
            nodeEntry("_http_common"),
            nodeEntry("_http_incoming"),
            nodeEntry("_http_outgoing"),
            nodeEntry("_http_server"),

            // sys is a deprecated alias for util
            .{ "sys", .{ .path = "node:util", .node_builtin = true } },
            .{ "node:sys", .{ .path = "node:util", .node_builtin = true } },

            // These are returned in builtinModules, but probably not many
            // packages use them so we will just alias them.
            .{ "node:_stream_duplex", .{ .path = "node:_stream_duplex", .node_builtin = true } },
            .{ "node:_stream_passthrough", .{ .path = "node:_stream_passthrough", .node_builtin = true } },
            .{ "node:_stream_readable", .{ .path = "node:_stream_readable", .node_builtin = true } },
            .{ "node:_stream_transform", .{ .path = "node:_stream_transform", .node_builtin = true } },
            .{ "node:_stream_wrap", .{ .path = "node:_stream_wrap", .node_builtin = true } },
            .{ "node:_stream_writable", .{ .path = "node:_stream_writable", .node_builtin = true } },
            .{ "node:_tls_wrap", .{ .path = "node:tls", .node_builtin = true } },
            .{ "node:_tls_common", .{ .path = "node:_tls_common", .node_builtin = true } },
            .{ "_stream_duplex", .{ .path = "node:_stream_duplex", .node_builtin = true } },
            .{ "_stream_passthrough", .{ .path = "node:_stream_passthrough", .node_builtin = true } },
            .{ "_stream_readable", .{ .path = "node:_stream_readable", .node_builtin = true } },
            .{ "_stream_transform", .{ .path = "node:_stream_transform", .node_builtin = true } },
            .{ "_stream_wrap", .{ .path = "node:_stream_wrap", .node_builtin = true } },
            .{ "_stream_writable", .{ .path = "node:_stream_writable", .node_builtin = true } },
            .{ "_tls_wrap", .{ .path = "node:tls", .node_builtin = true } },
            .{ "_tls_common", .{ .path = "node:_tls_common", .node_builtin = true } },
        };

        const bun_extra_alias_kvs = [_]struct { string, Alias }{
            .{ "bun", .{ .path = "bun", .tag = .bun } },
            .{ "bun:test", .{ .path = "bun:test" } },
            .{ "bun:app", .{ .path = "bun:app" } },
            .{ "bun:ffi", .{ .path = "bun:ffi" } },
            .{ "bun:jsc", .{ .path = "bun:jsc" } },
            .{ "bun:sqlite", .{ .path = "bun:sqlite" } },
            .{ "bun:wrap", .{ .path = "bun:wrap" } },
            .{ "bun:internal-for-testing", .{ .path = "bun:internal-for-testing" } },
            .{ "ffi", .{ .path = "bun:ffi" } },

            // Thirdparty packages we override
            .{ "@vercel/fetch", .{ .path = "@vercel/fetch" } },
            .{ "isomorphic-fetch", .{ .path = "isomorphic-fetch" } },
            .{ "node-fetch", .{ .path = "node-fetch" } },
            .{ "undici", .{ .path = "undici" } },
            .{ "utf-8-validate", .{ .path = "utf-8-validate" } },
            .{ "ws", .{ .path = "ws" } },
            .{ "ws/lib/websocket", .{ .path = "ws" } },

            // Polyfills we force to native
            .{ "abort-controller", .{ .path = "abort-controller" } },
            .{ "abort-controller/polyfill", .{ .path = "abort-controller" } },

            // To force Next.js to not use bundled dependencies.
            .{ "next/dist/compiled/ws", .{ .path = "ws" } },
            .{ "next/dist/compiled/node-fetch", .{ .path = "node-fetch" } },
            .{ "next/dist/compiled/undici", .{ .path = "undici" } },
        };

        const bun_test_extra_alias_kvs = [_]struct { string, Alias }{
            .{ "@jest/globals", .{ .path = "bun:test" } },
            .{ "vitest", .{ .path = "bun:test" } },
        };

        const node_aliases = bun.ComptimeStringMap(Alias, common_alias_kvs);
        pub const bun_aliases = bun.ComptimeStringMap(Alias, common_alias_kvs ++ bun_extra_alias_kvs);
        const bun_test_aliases = bun.ComptimeStringMap(Alias, common_alias_kvs ++ bun_extra_alias_kvs ++ bun_test_extra_alias_kvs);

        const Cfg = struct { rewrite_jest_for_tests: bool = false };
        pub fn has(name: []const u8, target: options.Target, cfg: Cfg) bool {
            return get(name, target, cfg) != null;
        }

        pub fn get(name: []const u8, target: options.Target, cfg: Cfg) ?Alias {
            if (target.isBun()) {
                if (cfg.rewrite_jest_for_tests) {
                    return bun_test_aliases.get(name);
                } else {
                    return bun_aliases.get(name);
                }
            } else if (target.isNode()) {
                return node_aliases.get(name);
            }
            return null;
        }
    };
};

const bun = @import("bun");
const options = @import("../options.zig");
const std = @import("std");

const ast = @import("../import_record.zig");
const ImportRecord = ast.ImportRecord;
