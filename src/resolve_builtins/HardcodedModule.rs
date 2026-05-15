use bun_ast::Target;
use bun_ast::import_record;
use bun_core::ZStr;
use bun_core::zstr;

// Zig: `const string = []const u8;` — in Rust we use `&'static [u8]` directly for keys.

#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, strum::IntoStaticStr)]
pub enum HardcodedModule {
    #[strum(serialize = "bun")]
    Bun,
    #[strum(serialize = "abort-controller")]
    AbortController,
    #[strum(serialize = "bun:app")]
    BunApp,
    #[strum(serialize = "bun:ffi")]
    BunFfi,
    #[strum(serialize = "bun:jsc")]
    BunJsc,
    #[strum(serialize = "bun:main")]
    BunMain,
    #[strum(serialize = "bun:test")]
    BunTest,
    #[strum(serialize = "bun:wrap")]
    BunWrap,
    #[strum(serialize = "bun:sqlite")]
    BunSqlite,
    #[strum(serialize = "node:assert")]
    NodeAssert,
    #[strum(serialize = "node:assert/strict")]
    NodeAssertStrict,
    #[strum(serialize = "node:async_hooks")]
    NodeAsyncHooks,
    #[strum(serialize = "node:buffer")]
    NodeBuffer,
    #[strum(serialize = "node:child_process")]
    NodeChildProcess,
    #[strum(serialize = "node:console")]
    NodeConsole,
    #[strum(serialize = "node:constants")]
    NodeConstants,
    #[strum(serialize = "node:crypto")]
    NodeCrypto,
    #[strum(serialize = "node:dns")]
    NodeDns,
    #[strum(serialize = "node:dns/promises")]
    NodeDnsPromises,
    #[strum(serialize = "node:domain")]
    NodeDomain,
    #[strum(serialize = "node:events")]
    NodeEvents,
    #[strum(serialize = "node:fs")]
    NodeFs,
    #[strum(serialize = "node:fs/promises")]
    NodeFsPromises,
    #[strum(serialize = "node:http")]
    NodeHttp,
    #[strum(serialize = "node:https")]
    NodeHttps,
    #[strum(serialize = "node:module")]
    NodeModule,
    #[strum(serialize = "node:net")]
    NodeNet,
    #[strum(serialize = "node:os")]
    NodeOs,
    #[strum(serialize = "node:path")]
    NodePath,
    #[strum(serialize = "node:path/posix")]
    NodePathPosix,
    #[strum(serialize = "node:path/win32")]
    NodePathWin32,
    #[strum(serialize = "node:perf_hooks")]
    NodePerfHooks,
    #[strum(serialize = "node:process")]
    NodeProcess,
    #[strum(serialize = "node:querystring")]
    NodeQuerystring,
    #[strum(serialize = "node:readline")]
    NodeReadline,
    #[strum(serialize = "node:readline/promises")]
    NodeReadlinePromises,
    #[strum(serialize = "node:stream")]
    NodeStream,
    #[strum(serialize = "node:stream/consumers")]
    NodeStreamConsumers,
    #[strum(serialize = "node:stream/promises")]
    NodeStreamPromises,
    #[strum(serialize = "node:stream/web")]
    NodeStreamWeb,
    #[strum(serialize = "node:string_decoder")]
    NodeStringDecoder,
    #[strum(serialize = "node:test")]
    NodeTest,
    #[strum(serialize = "node:timers")]
    NodeTimers,
    #[strum(serialize = "node:timers/promises")]
    NodeTimersPromises,
    #[strum(serialize = "node:tls")]
    NodeTls,
    #[strum(serialize = "node:tty")]
    NodeTty,
    #[strum(serialize = "node:url")]
    NodeUrl,
    #[strum(serialize = "node:util")]
    NodeUtil,
    #[strum(serialize = "node:util/types")]
    NodeUtilTypes,
    #[strum(serialize = "node:vm")]
    NodeVm,
    #[strum(serialize = "node:wasi")]
    NodeWasi,
    #[strum(serialize = "node:zlib")]
    NodeZlib,
    #[strum(serialize = "node:worker_threads")]
    NodeWorkerThreads,
    #[strum(serialize = "node:punycode")]
    NodePunycode,
    #[strum(serialize = "undici")]
    Undici,
    #[strum(serialize = "ws")]
    Ws,
    #[strum(serialize = "isomorphic-fetch")]
    IsomorphicFetch,
    #[strum(serialize = "node-fetch")]
    NodeFetch,
    #[strum(serialize = "@vercel/fetch")]
    VercelFetch,
    #[strum(serialize = "utf-8-validate")]
    Utf8Validate,
    #[strum(serialize = "node:v8")]
    NodeV8,
    #[strum(serialize = "node:trace_events")]
    NodeTraceEvents,
    #[strum(serialize = "node:repl")]
    NodeRepl,
    #[strum(serialize = "node:inspector")]
    NodeInspector,
    #[strum(serialize = "node:inspector/promises")]
    NodeInspectorPromises,
    #[strum(serialize = "node:http2")]
    NodeHttp2,
    #[strum(serialize = "node:diagnostics_channel")]
    NodeDiagnosticsChannel,
    #[strum(serialize = "node:dgram")]
    NodeDgram,
    #[strum(serialize = "node:cluster")]
    NodeCluster,
    #[strum(serialize = "node:_stream_duplex")]
    NodeStreamDuplexInternal,
    #[strum(serialize = "node:_stream_passthrough")]
    NodeStreamPassthroughInternal,
    #[strum(serialize = "node:_stream_readable")]
    NodeStreamReadableInternal,
    #[strum(serialize = "node:_stream_transform")]
    NodeStreamTransformInternal,
    #[strum(serialize = "node:_stream_wrap")]
    NodeStreamWrapInternal,
    #[strum(serialize = "node:_stream_writable")]
    NodeStreamWritableInternal,
    #[strum(serialize = "node:_tls_common")]
    NodeTlsCommonInternal,
    #[strum(serialize = "node:_http_agent")]
    NodeHttpAgentInternal,
    #[strum(serialize = "node:_http_client")]
    NodeHttpClientInternal,
    #[strum(serialize = "node:_http_common")]
    NodeHttpCommonInternal,
    #[strum(serialize = "node:_http_incoming")]
    NodeHttpIncomingInternal,
    #[strum(serialize = "node:_http_outgoing")]
    NodeHttpOutgoingInternal,
    #[strum(serialize = "node:_http_server")]
    NodeHttpServerInternal,
    /// This is gated behind '--expose-internals'
    #[strum(serialize = "bun:internal-for-testing")]
    BunInternalForTesting,
}

impl HardcodedModule {
    /// The module loader first uses `Aliases` to get a single string during
    /// resolution, then maps that single string to the actual module.
    /// Do not include aliases here; Those go in `Aliases`.
    // Zig: `pub const map = bun.ComptimeStringMap(...)`. Associated `static` is
    // unstable (E0658); `phf::Map` is const-constructible so use an associated const.
    pub const MAP: phf::Map<&'static [u8], HardcodedModule> = phf::phf_map! {
        // Bun
        b"bun" => HardcodedModule::Bun,
        b"bun:app" => HardcodedModule::BunApp,
        b"bun:ffi" => HardcodedModule::BunFfi,
        b"bun:jsc" => HardcodedModule::BunJsc,
        b"bun:main" => HardcodedModule::BunMain,
        b"bun:test" => HardcodedModule::BunTest,
        b"bun:sqlite" => HardcodedModule::BunSqlite,
        b"bun:wrap" => HardcodedModule::BunWrap,
        b"bun:internal-for-testing" => HardcodedModule::BunInternalForTesting,
        // Node.js
        b"node:assert" => HardcodedModule::NodeAssert,
        b"node:assert/strict" => HardcodedModule::NodeAssertStrict,
        b"node:async_hooks" => HardcodedModule::NodeAsyncHooks,
        b"node:buffer" => HardcodedModule::NodeBuffer,
        b"node:child_process" => HardcodedModule::NodeChildProcess,
        b"node:cluster" => HardcodedModule::NodeCluster,
        b"node:console" => HardcodedModule::NodeConsole,
        b"node:constants" => HardcodedModule::NodeConstants,
        b"node:crypto" => HardcodedModule::NodeCrypto,
        b"node:dgram" => HardcodedModule::NodeDgram,
        b"node:diagnostics_channel" => HardcodedModule::NodeDiagnosticsChannel,
        b"node:dns" => HardcodedModule::NodeDns,
        b"node:dns/promises" => HardcodedModule::NodeDnsPromises,
        b"node:domain" => HardcodedModule::NodeDomain,
        b"node:events" => HardcodedModule::NodeEvents,
        b"node:fs" => HardcodedModule::NodeFs,
        b"node:fs/promises" => HardcodedModule::NodeFsPromises,
        b"node:http" => HardcodedModule::NodeHttp,
        b"node:http2" => HardcodedModule::NodeHttp2,
        b"node:https" => HardcodedModule::NodeHttps,
        b"node:inspector" => HardcodedModule::NodeInspector,
        b"node:inspector/promises" => HardcodedModule::NodeInspectorPromises,
        b"node:module" => HardcodedModule::NodeModule,
        b"node:net" => HardcodedModule::NodeNet,
        b"node:readline" => HardcodedModule::NodeReadline,
        b"node:test" => HardcodedModule::NodeTest,
        b"node:os" => HardcodedModule::NodeOs,
        b"node:path" => HardcodedModule::NodePath,
        b"node:path/posix" => HardcodedModule::NodePathPosix,
        b"node:path/win32" => HardcodedModule::NodePathWin32,
        b"node:perf_hooks" => HardcodedModule::NodePerfHooks,
        b"node:process" => HardcodedModule::NodeProcess,
        b"node:punycode" => HardcodedModule::NodePunycode,
        b"node:querystring" => HardcodedModule::NodeQuerystring,
        b"node:readline/promises" => HardcodedModule::NodeReadlinePromises,
        b"node:repl" => HardcodedModule::NodeRepl,
        b"node:stream" => HardcodedModule::NodeStream,
        b"node:stream/consumers" => HardcodedModule::NodeStreamConsumers,
        b"node:stream/promises" => HardcodedModule::NodeStreamPromises,
        b"node:stream/web" => HardcodedModule::NodeStreamWeb,
        b"node:string_decoder" => HardcodedModule::NodeStringDecoder,
        b"node:timers" => HardcodedModule::NodeTimers,
        b"node:timers/promises" => HardcodedModule::NodeTimersPromises,
        b"node:tls" => HardcodedModule::NodeTls,
        b"node:trace_events" => HardcodedModule::NodeTraceEvents,
        b"node:tty" => HardcodedModule::NodeTty,
        b"node:url" => HardcodedModule::NodeUrl,
        b"node:util" => HardcodedModule::NodeUtil,
        b"node:util/types" => HardcodedModule::NodeUtilTypes,
        b"node:v8" => HardcodedModule::NodeV8,
        b"node:vm" => HardcodedModule::NodeVm,
        b"node:wasi" => HardcodedModule::NodeWasi,
        b"node:worker_threads" => HardcodedModule::NodeWorkerThreads,
        b"node:zlib" => HardcodedModule::NodeZlib,
        b"node:_stream_duplex" => HardcodedModule::NodeStreamDuplexInternal,
        b"node:_stream_passthrough" => HardcodedModule::NodeStreamPassthroughInternal,
        b"node:_stream_readable" => HardcodedModule::NodeStreamReadableInternal,
        b"node:_stream_transform" => HardcodedModule::NodeStreamTransformInternal,
        b"node:_stream_wrap" => HardcodedModule::NodeStreamWrapInternal,
        b"node:_stream_writable" => HardcodedModule::NodeStreamWritableInternal,
        b"node:_tls_common" => HardcodedModule::NodeTlsCommonInternal,
        b"node:_http_agent" => HardcodedModule::NodeHttpAgentInternal,
        b"node:_http_client" => HardcodedModule::NodeHttpClientInternal,
        b"node:_http_common" => HardcodedModule::NodeHttpCommonInternal,
        b"node:_http_incoming" => HardcodedModule::NodeHttpIncomingInternal,
        b"node:_http_outgoing" => HardcodedModule::NodeHttpOutgoingInternal,
        b"node:_http_server" => HardcodedModule::NodeHttpServerInternal,

        b"node-fetch" => HardcodedModule::NodeFetch,
        b"isomorphic-fetch" => HardcodedModule::IsomorphicFetch,
        b"undici" => HardcodedModule::Undici,
        b"ws" => HardcodedModule::Ws,
        b"@vercel/fetch" => HardcodedModule::VercelFetch,
        b"utf-8-validate" => HardcodedModule::Utf8Validate,
        b"abort-controller" => HardcodedModule::AbortController,
    };
}

/// Contains the list of built-in modules from the perspective of the module
/// loader. This logic is duplicated for `isBuiltinModule` and the like.
// Note: `ZStr` is a bare DST without `PartialEq`/`Debug`, so `Alias` can't
// auto-derive them. The Zig struct doesn't define equality either.
#[derive(Copy, Clone)]
pub struct Alias {
    // Zig: `[:0]const u8` → `&'static ZStr` per PORTING.md type map
    // (length-carrying NUL-terminated; module specifiers are bytes, not &str).
    pub path: &'static ZStr,
    pub tag: import_record::Tag,
    pub node_builtin: bool,
    pub node_only_prefix: bool,
}

impl Default for Alias {
    fn default() -> Self {
        Self {
            path: zstr!(""),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        }
    }
}

/// Prepend `"node:"` to a literal at compile time iff it isn't already prefixed.
/// Mirrors Zig: `if (path.len > 5 and std.mem.eql(u8, path[0..5], "node:")) path else "node:" ++ path`.
macro_rules! ensure_node_prefix {
    ($path:literal) => {{
        const HAS_PREFIX: bool = {
            let b = $path.as_bytes();
            b.len() > 5
                && b[0] == b'n'
                && b[1] == b'o'
                && b[2] == b'd'
                && b[3] == b'e'
                && b[4] == b':'
        };
        // `zstr!` takes `:literal`, so it can't accept `concat!(..)`. Inline the
        // NUL-append here instead — both arms are const-folded, dead one DCE'd.
        const __B: &[u8] = if HAS_PREFIX {
            ::core::concat!($path, "\0").as_bytes()
        } else {
            ::core::concat!("node:", $path, "\0").as_bytes()
        };
        ZStr::from_static(__B)
    }};
}

macro_rules! node_entry {
    ($path:literal) => {
        (
            $path.as_bytes(),
            Alias {
                path: ensure_node_prefix!($path),
                tag: import_record::Tag::Builtin,
                node_builtin: true,
                node_only_prefix: false,
            },
        )
    };
}

macro_rules! node_entry_only_prefix {
    ($path:literal) => {
        (
            $path.as_bytes(),
            Alias {
                path: ensure_node_prefix!($path),
                tag: import_record::Tag::Builtin,
                node_builtin: true,
                node_only_prefix: true,
            },
        )
    };
}

macro_rules! entry {
    ($path:literal) => {
        (
            $path.as_bytes(),
            Alias {
                path: zstr!($path),
                tag: import_record::Tag::Builtin,
                node_builtin: false,
                node_only_prefix: false,
            },
        )
    };
}

// Zig builds three `ComptimeStringMap`s by concatenating these const arrays
// (`common ++ bun_extra ++ bun_test_extra`). `phf::phf_map!` only accepts
// inline literal entries, so it cannot consume const slices directly.
//
// TODO(port): Phase B — generate `NODE_ALIASES` / `BUN_ALIASES` /
// `BUN_TEST_ALIASES` as `phf::Map<&'static [u8], Alias>` via `phf_codegen` in
// `build.rs`, fed from these const slices. The `get()` lookups below are the
// only public surface, so swapping the backing store is mechanical.

type AliasKv = (&'static [u8], Alias);

// Applied to both --target=bun and --target=node
const COMMON_ALIAS_KVS: &[AliasKv] = &[
    node_entry!("node:assert"),
    node_entry!("node:assert/strict"),
    node_entry!("node:async_hooks"),
    node_entry!("node:buffer"),
    node_entry!("node:child_process"),
    node_entry!("node:cluster"),
    node_entry!("node:console"),
    node_entry!("node:constants"),
    node_entry!("node:crypto"),
    node_entry!("node:dgram"),
    node_entry!("node:diagnostics_channel"),
    node_entry!("node:dns"),
    node_entry!("node:dns/promises"),
    node_entry!("node:domain"),
    node_entry!("node:events"),
    node_entry!("node:fs"),
    node_entry!("node:fs/promises"),
    node_entry!("node:http"),
    node_entry!("node:http2"),
    node_entry!("node:https"),
    node_entry!("node:inspector"),
    node_entry!("node:inspector/promises"),
    node_entry!("node:module"),
    node_entry!("node:net"),
    node_entry!("node:os"),
    node_entry!("node:path"),
    node_entry!("node:path/posix"),
    node_entry!("node:path/win32"),
    node_entry!("node:perf_hooks"),
    node_entry!("node:process"),
    node_entry!("node:punycode"),
    node_entry!("node:querystring"),
    node_entry!("node:readline"),
    node_entry!("node:readline/promises"),
    node_entry!("node:repl"),
    node_entry!("node:stream"),
    node_entry!("node:stream/consumers"),
    node_entry!("node:stream/promises"),
    node_entry!("node:stream/web"),
    node_entry!("node:string_decoder"),
    node_entry!("node:timers"),
    node_entry!("node:timers/promises"),
    node_entry!("node:tls"),
    node_entry!("node:trace_events"),
    node_entry!("node:tty"),
    node_entry!("node:url"),
    node_entry!("node:util"),
    node_entry!("node:util/types"),
    node_entry!("node:v8"),
    node_entry!("node:vm"),
    node_entry!("node:wasi"),
    node_entry!("node:worker_threads"),
    node_entry!("node:zlib"),
    // New Node.js builtins only resolve from the prefixed one.
    node_entry_only_prefix!("node:test"),
    //
    node_entry!("assert"),
    node_entry!("assert/strict"),
    node_entry!("async_hooks"),
    node_entry!("buffer"),
    node_entry!("child_process"),
    node_entry!("cluster"),
    node_entry!("console"),
    node_entry!("constants"),
    node_entry!("crypto"),
    node_entry!("dgram"),
    node_entry!("diagnostics_channel"),
    node_entry!("dns"),
    node_entry!("dns/promises"),
    node_entry!("domain"),
    node_entry!("events"),
    node_entry!("fs"),
    node_entry!("fs/promises"),
    node_entry!("http"),
    node_entry!("http2"),
    node_entry!("https"),
    node_entry!("inspector"),
    node_entry!("inspector/promises"),
    node_entry!("module"),
    node_entry!("net"),
    node_entry!("os"),
    node_entry!("path"),
    node_entry!("path/posix"),
    node_entry!("path/win32"),
    node_entry!("perf_hooks"),
    node_entry!("process"),
    node_entry!("punycode"),
    node_entry!("querystring"),
    node_entry!("readline"),
    node_entry!("readline/promises"),
    node_entry!("repl"),
    node_entry!("stream"),
    node_entry!("stream/consumers"),
    node_entry!("stream/promises"),
    node_entry!("stream/web"),
    node_entry!("string_decoder"),
    node_entry!("timers"),
    node_entry!("timers/promises"),
    node_entry!("tls"),
    node_entry!("trace_events"),
    node_entry!("tty"),
    node_entry!("url"),
    node_entry!("util"),
    node_entry!("util/types"),
    node_entry!("v8"),
    node_entry!("vm"),
    node_entry!("wasi"),
    node_entry!("worker_threads"),
    node_entry!("zlib"),
    //
    node_entry!("node:_http_agent"),
    node_entry!("node:_http_client"),
    node_entry!("node:_http_common"),
    node_entry!("node:_http_incoming"),
    node_entry!("node:_http_outgoing"),
    node_entry!("node:_http_server"),
    //
    node_entry!("_http_agent"),
    node_entry!("_http_client"),
    node_entry!("_http_common"),
    node_entry!("_http_incoming"),
    node_entry!("_http_outgoing"),
    node_entry!("_http_server"),
    //
    // sys is a deprecated alias for util
    (
        b"sys",
        Alias {
            path: zstr!("node:util"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:sys",
        Alias {
            path: zstr!("node:util"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    //
    // These are returned in builtinModules, but probably not many
    // packages use them so we will just alias them.
    (
        b"node:_stream_duplex",
        Alias {
            path: zstr!("node:_stream_duplex"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_stream_passthrough",
        Alias {
            path: zstr!("node:_stream_passthrough"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_stream_readable",
        Alias {
            path: zstr!("node:_stream_readable"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_stream_transform",
        Alias {
            path: zstr!("node:_stream_transform"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_stream_wrap",
        Alias {
            path: zstr!("node:_stream_wrap"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_stream_writable",
        Alias {
            path: zstr!("node:_stream_writable"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_tls_wrap",
        Alias {
            path: zstr!("node:tls"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"node:_tls_common",
        Alias {
            path: zstr!("node:_tls_common"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_stream_duplex",
        Alias {
            path: zstr!("node:_stream_duplex"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_stream_passthrough",
        Alias {
            path: zstr!("node:_stream_passthrough"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_stream_readable",
        Alias {
            path: zstr!("node:_stream_readable"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_stream_transform",
        Alias {
            path: zstr!("node:_stream_transform"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_stream_wrap",
        Alias {
            path: zstr!("node:_stream_wrap"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_stream_writable",
        Alias {
            path: zstr!("node:_stream_writable"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_tls_wrap",
        Alias {
            path: zstr!("node:tls"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
    (
        b"_tls_common",
        Alias {
            path: zstr!("node:_tls_common"),
            tag: import_record::Tag::Builtin,
            node_builtin: true,
            node_only_prefix: false,
        },
    ),
];

const BUN_EXTRA_ALIAS_KVS: &[AliasKv] = &[
    (
        b"bun",
        Alias {
            path: zstr!("bun"),
            tag: import_record::Tag::Bun,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    entry!("bun:test"),
    entry!("bun:app"),
    entry!("bun:ffi"),
    entry!("bun:jsc"),
    entry!("bun:main"),
    entry!("bun:sqlite"),
    entry!("bun:wrap"),
    entry!("bun:internal-for-testing"),
    (
        b"ffi",
        Alias {
            path: zstr!("bun:ffi"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    //
    // Thirdparty packages we override
    entry!("@vercel/fetch"),
    entry!("isomorphic-fetch"),
    entry!("node-fetch"),
    entry!("undici"),
    entry!("utf-8-validate"),
    entry!("ws"),
    (
        b"ws/lib/websocket",
        Alias {
            path: zstr!("ws"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    //
    // Polyfills we force to native
    entry!("abort-controller"),
    (
        b"abort-controller/polyfill",
        Alias {
            path: zstr!("abort-controller"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    //
    // To force Next.js to not use bundled dependencies.
    (
        b"next/dist/compiled/ws",
        Alias {
            path: zstr!("ws"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    (
        b"next/dist/compiled/node-fetch",
        Alias {
            path: zstr!("node-fetch"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    (
        b"next/dist/compiled/undici",
        Alias {
            path: zstr!("undici"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
];

const BUN_TEST_EXTRA_ALIAS_KVS: &[AliasKv] = &[
    (
        b"@jest/globals",
        Alias {
            path: zstr!("bun:test"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
    (
        b"vitest",
        Alias {
            path: zstr!("bun:test"),
            tag: import_record::Tag::Builtin,
            node_builtin: false,
            node_only_prefix: false,
        },
    ),
];

// TODO(port): replace with `phf::Map<&'static [u8], Alias>` generated by
// `phf_codegen` in build.rs (Zig: `bun.ComptimeStringMap(Alias, common_alias_kvs)`).
// PERF(port): linear scan placeholder — Zig used a comptime perfect-hash map.
const NODE_ALIASES: &[&[AliasKv]] = &[COMMON_ALIAS_KVS];
pub const BUN_ALIASES: &[&[AliasKv]] = &[COMMON_ALIAS_KVS, BUN_EXTRA_ALIAS_KVS];
const BUN_TEST_ALIASES: &[&[AliasKv]] = &[
    COMMON_ALIAS_KVS,
    BUN_EXTRA_ALIAS_KVS,
    BUN_TEST_EXTRA_ALIAS_KVS,
];

#[inline]
fn lookup(tables: &[&[AliasKv]], name: &[u8]) -> Option<Alias> {
    // PERF(port): O(n) scan; Phase B replaces with phf perfect-hash lookup.
    for table in tables {
        for (k, v) in *table {
            if *k == name {
                return Some(*v);
            }
        }
    }
    None
}

#[derive(Copy, Clone, Default)]
pub struct Cfg {
    pub rewrite_jest_for_tests: bool,
}

impl Alias {
    pub fn has(name: &[u8], target: Target, cfg: Cfg) -> bool {
        Self::get(name, target, cfg).is_some()
    }

    pub fn get(name: &[u8], target: Target, cfg: Cfg) -> Option<Alias> {
        if target.is_bun() {
            if cfg.rewrite_jest_for_tests {
                return lookup(BUN_TEST_ALIASES, name);
            } else {
                return lookup(BUN_ALIASES, name);
            }
        } else if target.is_node() {
            return lookup(NODE_ALIASES, name);
        }
        None
    }
}

// ported from: src/resolve_builtins/HardcodedModule.zig
