// internal/core/nodemodules.go. A map of upstream whose values are all true is a list of its keys here, in upstream's order.
use std::collections::BTreeSet;
use std::sync::OnceLock;

// require('module').builtinModules.filter(x => !x.match(/^(?:_|node:)/))
pub const UNPREFIXED_NODE_CORE_MODULES: &[&[u8]] = &[
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

// require('module').builtinModules.filter(x => x.startsWith('node:'))
pub const EXCLUSIVELY_PREFIXED_NODE_CORE_MODULES: &[&[u8]] = &[
    b"node:quic",
    b"node:sea",
    b"node:sqlite",
    b"node:test",
    b"node:test/reporters",
];

// `sync.OnceValue` of upstream: the set is built at the first call.
pub fn node_core_modules() -> &'static BTreeSet<Vec<u8>> {
    static NODE_CORE_MODULES: OnceLock<BTreeSet<Vec<u8>>> = OnceLock::new();
    NODE_CORE_MODULES.get_or_init(|| {
        let mut node_core_modules = BTreeSet::new();
        for unprefixed in UNPREFIXED_NODE_CORE_MODULES {
            node_core_modules.insert(unprefixed.to_vec());
            node_core_modules.insert([b"node:".as_slice(), unprefixed].concat());
        }
        for prefixed in EXCLUSIVELY_PREFIXED_NODE_CORE_MODULES {
            node_core_modules.insert(prefixed.to_vec());
        }
        node_core_modules
    })
}

pub fn non_relative_module_name_for_typing_cache(module_name: &[u8]) -> &[u8] {
    if node_core_modules().contains(module_name) {
        return b"node";
    }
    module_name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_core_modules_hold_both_spellings() {
        let modules = node_core_modules();
        assert_eq!(
            modules.len(),
            UNPREFIXED_NODE_CORE_MODULES.len() * 2 + EXCLUSIVELY_PREFIXED_NODE_CORE_MODULES.len()
        );
        assert!(modules.contains(b"fs".as_slice()));
        assert!(modules.contains(b"node:fs".as_slice()));
        assert!(modules.contains(b"fs/promises".as_slice()));
        assert!(modules.contains(b"node:test".as_slice()));
        assert!(!modules.contains(b"test".as_slice()));
        assert!(!modules.contains(b"node:".as_slice()));
        assert!(!modules.contains(b"".as_slice()));
        assert_eq!(
            non_relative_module_name_for_typing_cache(b"node:path"),
            b"node"
        );
        assert_eq!(non_relative_module_name_for_typing_cache(b"path"), b"node");
        assert_eq!(
            non_relative_module_name_for_typing_cache(b"lodash"),
            b"lodash"
        );
    }
}
