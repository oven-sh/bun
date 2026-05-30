//! Single-source list of Node.js core module names.
//!
//! Zig spec `src/bundler/options.zig:180-364` hand-spells this list THREE
//! times (Raw, Compat, Map) and derives a fourth (Patterns) via comptime
//! `++`. The Rust port lost the comptime concat and hand-spelled it FOUR
//! times. This module is the one declarative source: each name appears
//! exactly once, tagged with whether it belongs in the Bun-compat subset.
//!
//! `NODE_BUILTINS_MAP` (the phf lookup set) is intentionally NOT emitted
//! here: its only would-be consumer, `options::is_node_builtin`, already
//! routes through `crate::Alias::has(.., Target::Node, ..)` which is the
//! authoritative builtin check. The phf set in `bundler/options.rs` was
//! dead. Revive via `Alias::has` rather than re-adding a parallel table.

/// One macro call below is the *only* place a module name is spelled.
///
/// Input is two disjoint groups so the COMPAT subset falls out without a
/// tt-muncher: `compat` names go in all three consts, `node_only` names are
/// the five Bun-compat exclusions (buffer/fs/path/process/test) and go only
/// in RAW/PATTERNS. Every current consumer inserts into a hash set, so the
/// "compat-first, exclusions-last" order vs. Zig's strict-alpha order is not
/// observable.
macro_rules! node_builtins_table {
    (
        compat:    [ $( $c:literal ),* $(,)? ],
        node_only: [ $( $n:literal ),* $(,)? ] $(,)?
    ) => {
        /// All Node.js core module bare names (Zig `NodeBuiltinPatternsRaw`).
        pub const NODE_BUILTIN_PATTERNS_RAW: &[&[u8]] = &[
            $( $c.as_bytes(), )*
            $( $n.as_bytes(), )*
        ];

        /// `RAW ++ RAW.map(|m| "node:" ++ m)` — Zig `NodeBuiltinPatterns`,
        /// which Zig builds via comptime `++`. `concat!` recovers that here.
        pub const NODE_BUILTIN_PATTERNS: &[&[u8]] = &[
            $( $c.as_bytes(), )*
            $( $n.as_bytes(), )*
            $( concat!("node:", $c).as_bytes(), )*
            $( concat!("node:", $n).as_bytes(), )*
        ];

        /// RAW minus the `node_only` exclusions — Zig
        /// `BunNodeBuiltinPatternsCompat`.
        pub const BUN_NODE_BUILTIN_PATTERNS_COMPAT: &[&[u8]] = &[
            $( $c.as_bytes(), )*
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
    // Bun-compat exclusions (commented-out / omitted in Zig's
    // `BunNodeBuiltinPatternsCompat`): these five stay resolvable under
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
        assert_eq!(NODE_BUILTIN_PATTERNS_RAW.len(), 57);
        assert_eq!(NODE_BUILTIN_PATTERNS.len(), 57 * 2);
        assert_eq!(BUN_NODE_BUILTIN_PATTERNS_COMPAT.len(), 52);
    }
}
