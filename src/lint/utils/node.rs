//! The modules that are built into Node.js.

/// `require("node:module").builtinModules` of Node.js 26, and what Node.js 24 has besides. Sorted.
static WITH_OR_WITHOUT_PREFIX: [&[u8]; 68] = [
    b"_http_agent",
    b"_http_client",
    b"_http_common",
    b"_http_incoming",
    b"_http_outgoing",
    b"_http_server",
    b"_stream_duplex",
    b"_stream_passthrough",
    b"_stream_readable",
    b"_stream_transform",
    b"_stream_wrap",
    b"_stream_writable",
    b"_tls_common",
    b"_tls_wrap",
    b"assert",
    b"assert/strict",
    b"async_hooks",
    b"buffer",
    b"child_process",
    b"cluster",
    b"console",
    b"constants",
    b"crypto",
    b"dgram",
    b"diagnostics_channel",
    b"dns",
    b"dns/promises",
    b"domain",
    b"events",
    b"fs",
    b"fs/promises",
    b"http",
    b"http2",
    b"https",
    b"inspector",
    b"inspector/promises",
    b"module",
    b"net",
    b"os",
    b"path",
    b"path/posix",
    b"path/win32",
    b"perf_hooks",
    b"process",
    b"punycode",
    b"querystring",
    b"readline",
    b"readline/promises",
    b"repl",
    b"stream",
    b"stream/consumers",
    b"stream/promises",
    b"stream/web",
    b"string_decoder",
    b"sys",
    b"timers",
    b"timers/promises",
    b"tls",
    b"trace_events",
    b"tty",
    b"url",
    b"util",
    b"util/types",
    b"v8",
    b"vm",
    b"wasi",
    b"worker_threads",
    b"zlib",
];

/// Those that only exist with `node:` before them. Sorted.
static WITH_PREFIX: [&[u8]; 4] = [b"sea", b"sqlite", b"test", b"test/reporters"];

/// Whether `specifier` is a module of Node.js, with or without `node:`.
pub fn is_builtin_module(specifier: &[u8]) -> bool {
    match specifier.strip_prefix(b"node:") {
        Some(name) => {
            WITH_OR_WITHOUT_PREFIX.binary_search(&name).is_ok()
                || WITH_PREFIX.binary_search(&name).is_ok()
        }
        None => WITH_OR_WITHOUT_PREFIX.binary_search(&specifier).is_ok(),
    }
}
