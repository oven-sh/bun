//! Single-source list of Node.js core module names.
//!
//! This module is the one declarative source: each name appears
//! exactly once, tagged with whether it belongs in the Bun-compat subset.
//!
//! `NODE_BUILTINS_MAP` (the name-lookup set) is intentionally NOT emitted
//! here: its only would-be consumer, `options::is_node_builtin`, already
//! routes through `crate::Alias::has(.., Target::Node, ..)` which is the
//! authoritative builtin check. The lookup set in `bundler/options.rs` was
//! dead. Revive via `Alias::has` rather than re-adding a parallel table.

/// One macro call below is the *only* place a module name is spelled.
macro_rules! node_builtins_table {
    (
        compat:    [ $( $c:literal ),* $(,)? ],
        node_only: [ $( $n:literal ),* $(,)? ] $(,)?
    ) => {
        /// All Node.js core module bare names, each also with a `node:` prefix.
        pub const NODE_BUILTIN_PATTERNS: &[&[u8]] = &[
            $( $c.as_bytes(), )*
            $( $n.as_bytes(), )*
            $( concat!("node:", $c).as_bytes(), )*
            $( concat!("node:", $n).as_bytes(), )*
        ];
    };
}

node_builtins_table! {
    compat: [
        "_http_agent",
        "_http_client",
        "_http_common",
        "_http_incoming",
        "_http_outgoing",
        "_http_server",
        "_stream_duplex",
        "_stream_passthrough",
        "_stream_readable",
        "_stream_transform",
        "_stream_wrap",
        "_stream_writable",
        "_tls_common",
        "_tls_wrap",
        "assert",
        "async_hooks",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "domain",
        "events",
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        "perf_hooks",
        "punycode",
        "querystring",
        "readline",
        "repl",
        "stream",
        "string_decoder",
        "sys",
        "timers",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "v8",
        "vm",
        "wasi",
        "worker_threads",
        "zlib",
    ],
    // Bun-compat exclusions: these five stay resolvable under
    // `--target=bun` rather than being marked external.
    node_only: [
        "buffer",
        "fs",
        "path",
        "process",
        "test",
    ],
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cardinalities_match_zig_spec() {
        assert_eq!(NODE_BUILTIN_PATTERNS.len(), 57 * 2);
    }
}
