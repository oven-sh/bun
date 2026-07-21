//! NODE_OPTIONS environment variable parsing (Node.js compatibility).
//!
//! Node.js reads a space-separated list of CLI flags from `NODE_OPTIONS`,
//! tokenizes it (double-quote aware, `\` escape inside quotes), validates each
//! flag against a fixed allowlist, and applies it before the real command-line
//! arguments. This module mirrors that behaviour for the subset of flags Bun
//! understands and warns on anything outside the allowlist so a misconfigured
//! `NODE_OPTIONS` is surfaced instead of silently ignored.

use bstr::BStr;
use bun_core::{Global, Output, strings};

#[derive(Debug, PartialEq, Eq)]
pub enum TokenizeError {
    UnterminatedString,
    InvalidEscape,
}

/// Tokenize a `NODE_OPTIONS` string using Node.js's rules (see
/// `ParseNodeOptionsEnvVar` in node/src/node_options.cc): space separates
/// arguments, `"` toggles a quoted region, and inside a quoted region `\c`
/// yields `c`. Single quotes and backslashes outside quotes are literal.
pub fn tokenize(input: &[u8]) -> Result<Vec<Box<[u8]>>, TokenizeError> {
    let mut tokens: Vec<Box<[u8]>> = Vec::new();
    let mut is_in_string = false;
    let mut will_start_new_arg = true;
    let mut current: Vec<u8> = Vec::new();
    let mut i = 0usize;
    while i < input.len() {
        let mut c = input[i];
        if c == b'\\' && is_in_string {
            if i + 1 == input.len() {
                return Err(TokenizeError::InvalidEscape);
            }
            i += 1;
            c = input[i];
        } else if c == b' ' && !is_in_string {
            will_start_new_arg = true;
            i += 1;
            continue;
        } else if c == b'"' {
            is_in_string = !is_in_string;
            i += 1;
            continue;
        }

        if will_start_new_arg {
            if !current.is_empty() {
                tokens.push(core::mem::take(&mut current).into_boxed_slice());
            }
            will_start_new_arg = false;
        }
        current.push(c);
        i += 1;
    }
    if is_in_string {
        return Err(TokenizeError::UnterminatedString);
    }
    if !current.is_empty() {
        tokens.push(current.into_boxed_slice());
    }
    Ok(tokens)
}

/// Result of parsing NODE_OPTIONS. `--require` / `-r` and `--import` are kept
/// separate so the caller can preserve Node's ordering (all requires before
/// all imports) and Bun's own CLI ordering.
#[derive(Default)]
pub struct Parsed {
    pub requires: Vec<Box<[u8]>>,
    pub imports: Vec<Box<[u8]>>,
}

/// Split `--name=value` into `(name, Some(value))`; `--name` into
/// `(name, None)`. Short options (`-x`) are returned whole with no value: Node
/// only accepts `-r path` / `-C cond` (space-separated), not `-r=path` or
/// `-rpath`.
fn split_name_value(tok: &[u8]) -> (&[u8], Option<&[u8]>) {
    if tok.len() >= 2 && tok[0] == b'-' && tok[1] == b'-' {
        if let Some(eq) = strings::index_of_char_usize(tok, b'=') {
            return (&tok[..eq], Some(&tok[eq + 1..]));
        }
    }
    (tok, None)
}

/// Node.js accepts `_` in place of `-` after the leading `--` (V8 convention).
fn normalize(flag: &[u8]) -> Box<[u8]> {
    let mut out = Vec::with_capacity(flag.len());
    for (i, &b) in flag.iter().enumerate() {
        out.push(if i >= 2 && b == b'_' { b'-' } else { b });
    }
    out.into_boxed_slice()
}

/// Flags Node.js permits in NODE_OPTIONS (the `kAllowedInEnvvar` set). Sorted
/// for binary search. Regenerate from a Node.js build with:
///   node -e '[...process.allowedNodeEnvironmentFlags].sort().forEach(f => console.log(f))'
static ALLOWED: &[&[u8]] = &[
    b"--abort-on-uncaught-exception",
    b"--addons",
    b"--allow-addons",
    b"--allow-child-process",
    b"--allow-ffi",
    b"--allow-fs-read",
    b"--allow-fs-write",
    b"--allow-inspector",
    b"--allow-net",
    b"--allow-wasi",
    b"--allow-worker",
    b"--async-context-frame",
    b"--conditions",
    b"--cpu-prof",
    b"--cpu-prof-dir",
    b"--cpu-prof-interval",
    b"--cpu-prof-name",
    b"--debug-arraybuffer-allocations",
    b"--debug-port",
    b"--deprecation",
    b"--diagnostic-dir",
    b"--disable-proto",
    b"--disable-sigusr1",
    b"--disable-warning",
    b"--disable-wasm-trap-handler",
    b"--disallow-code-generation-from-strings",
    b"--dns-result-order",
    b"--enable-etw-stack-walking",
    b"--enable-fips",
    b"--enable-network-family-autoselection",
    b"--enable-source-maps",
    b"--entry-url",
    b"--es-module-specifier-resolution",
    b"--experimental-abortcontroller",
    b"--experimental-addon-modules",
    b"--experimental-async-context-frame",
    b"--experimental-detect-module",
    b"--experimental-eventsource",
    b"--experimental-fetch",
    b"--experimental-ffi",
    b"--experimental-global-customevent",
    b"--experimental-global-navigator",
    b"--experimental-global-webcrypto",
    b"--experimental-import-meta-resolve",
    b"--experimental-json-modules",
    b"--experimental-loader",
    b"--experimental-modules",
    b"--experimental-network-imports",
    b"--experimental-permission",
    b"--experimental-policy",
    b"--experimental-print-required-tla",
    b"--experimental-quic",
    b"--experimental-repl-await",
    b"--experimental-report",
    b"--experimental-require-module",
    b"--experimental-shadow-realm",
    b"--experimental-specifier-resolution",
    b"--experimental-sqlite",
    b"--experimental-stream-iter",
    b"--experimental-strip-types",
    b"--experimental-test-coverage",
    b"--experimental-test-isolation",
    b"--experimental-top-level-await",
    b"--experimental-transform-types",
    b"--experimental-vm-modules",
    b"--experimental-wasi-unstable-preview1",
    b"--experimental-wasm-modules",
    b"--experimental-websocket",
    b"--experimental-webstorage",
    b"--experimental-worker",
    b"--expose-gc",
    b"--expose-internals",
    b"--extra-info-on-fatal-exception",
    b"--force-async-hooks-checks",
    b"--force-context-aware",
    b"--force-fips",
    b"--force-node-api-uncaught-exceptions-policy",
    b"--frozen-intrinsics",
    b"--global-search-paths",
    b"--heap-prof",
    b"--heap-prof-dir",
    b"--heap-prof-interval",
    b"--heap-prof-name",
    b"--heapsnapshot-near-heap-limit",
    b"--heapsnapshot-signal",
    b"--http-parser",
    b"--icu-data-dir",
    b"--import",
    b"--input-type",
    b"--insecure-http-parser",
    b"--inspect",
    b"--inspect-brk",
    b"--inspect-port",
    b"--inspect-publish-uid",
    b"--inspect-wait",
    b"--interpreted-frames-native-stack",
    b"--jitless",
    b"--loader",
    b"--localstorage-file",
    b"--max-heap-size",
    b"--max-http-header-size",
    b"--max-old-space-size",
    b"--max-old-space-size-percentage",
    b"--max-semi-space-size",
    b"--napi-modules",
    b"--network-family-autoselection",
    b"--network-family-autoselection-attempt-timeout",
    b"--no-addons",
    b"--no-allow-addons",
    b"--no-allow-child-process",
    b"--no-allow-ffi",
    b"--no-allow-inspector",
    b"--no-allow-net",
    b"--no-allow-wasi",
    b"--no-allow-worker",
    b"--no-async-context-frame",
    b"--no-cpu-prof",
    b"--no-debug-arraybuffer-allocations",
    b"--no-deprecation",
    b"--no-disable-sigusr1",
    b"--no-disable-wasm-trap-handler",
    b"--no-enable-fips",
    b"--no-enable-source-maps",
    b"--no-entry-url",
    b"--no-experimental-addon-modules",
    b"--no-experimental-async-context-frame",
    b"--no-experimental-detect-module",
    b"--no-experimental-eventsource",
    b"--no-experimental-fetch",
    b"--no-experimental-ffi",
    b"--no-experimental-global-customevent",
    b"--no-experimental-global-navigator",
    b"--no-experimental-global-webcrypto",
    b"--no-experimental-import-meta-resolve",
    b"--no-experimental-print-required-tla",
    b"--no-experimental-repl-await",
    b"--no-experimental-require-module",
    b"--no-experimental-shadow-realm",
    b"--no-experimental-sqlite",
    b"--no-experimental-stream-iter",
    b"--no-experimental-strip-types",
    b"--no-experimental-transform-types",
    b"--no-experimental-vm-modules",
    b"--no-experimental-websocket",
    b"--no-experimental-webstorage",
    b"--no-extra-info-on-fatal-exception",
    b"--no-force-async-hooks-checks",
    b"--no-force-context-aware",
    b"--no-force-fips",
    b"--no-force-node-api-uncaught-exceptions-policy",
    b"--no-frozen-intrinsics",
    b"--no-global-search-paths",
    b"--no-heap-prof",
    b"--no-insecure-http-parser",
    b"--no-inspect",
    b"--no-inspect-brk",
    b"--no-inspect-wait",
    b"--no-network-family-autoselection",
    b"--no-node-snapshot",
    b"--no-openssl-legacy-provider",
    b"--no-openssl-shared-config",
    b"--no-pending-deprecation",
    b"--no-permission",
    b"--no-permission-audit",
    b"--no-preserve-symlinks",
    b"--no-preserve-symlinks-main",
    b"--no-report-compact",
    b"--no-report-exclude-env",
    b"--no-report-exclude-network",
    b"--no-report-on-fatalerror",
    b"--no-report-on-signal",
    b"--no-report-uncaught-exception",
    b"--no-require-module",
    b"--no-strip-types",
    b"--no-test-only",
    b"--no-test-randomize",
    b"--no-throw-deprecation",
    b"--no-tls-max-v1.2",
    b"--no-tls-max-v1.3",
    b"--no-tls-min-v1.0",
    b"--no-tls-min-v1.1",
    b"--no-tls-min-v1.2",
    b"--no-tls-min-v1.3",
    b"--no-trace-deprecation",
    b"--no-trace-env",
    b"--no-trace-env-js-stack",
    b"--no-trace-env-native-stack",
    b"--no-trace-exit",
    b"--no-trace-promises",
    b"--no-trace-sigint",
    b"--no-trace-sync-io",
    b"--no-trace-tls",
    b"--no-trace-uncaught",
    b"--no-trace-warnings",
    b"--no-track-heap-objects",
    b"--no-use-bundled-ca",
    b"--no-use-env-proxy",
    b"--no-use-openssl-ca",
    b"--no-use-system-ca",
    b"--no-verify-base-objects",
    b"--no-warnings",
    b"--no-watch",
    b"--no-watch-preserve-output",
    b"--no-zero-fill-buffers",
    b"--node-memory-debug",
    b"--node-snapshot",
    b"--openssl-config",
    b"--openssl-legacy-provider",
    b"--openssl-shared-config",
    b"--pending-deprecation",
    b"--perf-basic-prof",
    b"--perf-basic-prof-only-functions",
    b"--perf-prof",
    b"--perf-prof-unwinding-info",
    b"--permission",
    b"--permission-audit",
    b"--policy-integrity",
    b"--preserve-symlinks",
    b"--preserve-symlinks-main",
    b"--prof-process",
    b"--redirect-warnings",
    b"--report-compact",
    b"--report-dir",
    b"--report-directory",
    b"--report-exclude-env",
    b"--report-exclude-network",
    b"--report-filename",
    b"--report-on-fatalerror",
    b"--report-on-signal",
    b"--report-signal",
    b"--report-uncaught-exception",
    b"--require",
    b"--require-module",
    b"--secure-heap",
    b"--secure-heap-min",
    b"--snapshot-blob",
    b"--stack-trace-limit",
    b"--strip-types",
    b"--test-coverage-branches",
    b"--test-coverage-exclude",
    b"--test-coverage-functions",
    b"--test-coverage-include",
    b"--test-coverage-lines",
    b"--test-global-setup",
    b"--test-isolation",
    b"--test-name-pattern",
    b"--test-only",
    b"--test-random-seed",
    b"--test-randomize",
    b"--test-reporter",
    b"--test-reporter-destination",
    b"--test-rerun-failures",
    b"--test-shard",
    b"--test-skip-pattern",
    b"--throw-deprecation",
    b"--title",
    b"--tls-cipher-list",
    b"--tls-keylog",
    b"--tls-max-v1.2",
    b"--tls-max-v1.3",
    b"--tls-min-v1.0",
    b"--tls-min-v1.1",
    b"--tls-min-v1.2",
    b"--tls-min-v1.3",
    b"--trace-deprecation",
    b"--trace-env",
    b"--trace-env-js-stack",
    b"--trace-env-native-stack",
    b"--trace-event-categories",
    b"--trace-event-file-pattern",
    b"--trace-events-enabled",
    b"--trace-exit",
    b"--trace-promises",
    b"--trace-require-module",
    b"--trace-sigint",
    b"--trace-sync-io",
    b"--trace-tls",
    b"--trace-uncaught",
    b"--trace-warnings",
    b"--track-heap-objects",
    b"--unhandled-rejections",
    b"--use-bundled-ca",
    b"--use-env-proxy",
    b"--use-largepages",
    b"--use-openssl-ca",
    b"--use-system-ca",
    b"--v8-pool-size",
    b"--verify-base-objects",
    b"--warnings",
    b"--watch",
    b"--watch-kill-signal",
    b"--watch-path",
    b"--watch-preserve-output",
    b"--webstorage",
    b"--zero-fill-buffers",
    b"-C",
    b"-r",
];

#[inline]
fn is_allowed(flag: &[u8]) -> bool {
    #[cfg(debug_assertions)]
    {
        static CHECKED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
        if !CHECKED.swap(true, core::sync::atomic::Ordering::Relaxed) {
            for pair in ALLOWED.windows(2) {
                debug_assert!(pair[0] < pair[1], "ALLOWED must be sorted");
            }
        }
    }
    ALLOWED.binary_search(&flag).is_ok()
}

/// Bun-specific flags that commonly reach NODE_OPTIONS via tooling that
/// forwards `process.execArgv` to worker processes (Next.js, jest-worker).
/// Accepted silently so that `bun --bun next build` keeps working.
fn is_bun_flag(flag: &[u8]) -> bool {
    matches!(flag, b"--bun" | b"-b" | b"--smol" | b"--hot")
}

#[cold]
#[inline(never)]
fn warn_not_allowed(flag: &[u8]) {
    bun_core::warn!(
        "{} is not allowed in NODE_OPTIONS (ignored)",
        BStr::new(flag),
    );
}

#[cold]
#[inline(never)]
fn fail_requires_argument(flag: &[u8]) -> ! {
    Output::err_generic(
        "{} requires an argument",
        format_args!("{}", BStr::new(flag)),
    );
    Global::exit(9);
}

#[cold]
#[inline(never)]
fn fail_tokenize(detail: &str) -> ! {
    Output::err_generic(
        "invalid value for NODE_OPTIONS ({})",
        format_args!("{}", detail),
    );
    Global::exit(9);
}

/// Tokenize and validate a `NODE_OPTIONS` value. `--require` / `-r` and
/// `--import` are collected into `Parsed.requires` / `Parsed.imports`
/// respectively; other allowed flags are currently accepted without effect. Flags
/// outside Node's allowlist produce a warning (not a hard error: tooling such
/// as Next.js forwards `process.execArgv` into worker NODE_OPTIONS and may
/// carry Bun-specific flags). Tokenizer errors and missing preload values
/// remain fatal with status 9.
///
/// `#[cold]`: only reached when the env var is set; the caller checks
/// `env_var::NODE_OPTIONS.get()` on the hot path so the common unset case
/// never faults this page.
#[cold]
#[inline(never)]
pub fn parse(raw: &[u8]) -> Parsed {
    let tokens = match tokenize(raw) {
        Ok(t) => t,
        Err(TokenizeError::UnterminatedString) => fail_tokenize("unterminated string"),
        Err(TokenizeError::InvalidEscape) => fail_tokenize("invalid escape"),
    };

    let mut parsed = Parsed::default();
    let mut warned = false;
    let mut i = 0usize;
    while i < tokens.len() {
        let tok: &[u8] = &tokens[i];
        i += 1;
        // Node.js stops option processing at the first non-option token (or a
        // bare `-`). Without per-flag arity for every allowed option we cannot
        // distinguish a genuine positional from the value of a preceding
        // value-taking flag, so skip rather than break.
        if tok.is_empty() || tok[0] != b'-' || tok == b"-" {
            continue;
        }
        let (name, inline_value) = split_name_value(tok);
        let normalized = normalize(name);
        if !is_allowed(&normalized) {
            if !is_bun_flag(&normalized) && !warned {
                warned = true;
                warn_not_allowed(name);
            }
            continue;
        }

        let dest = match &*normalized {
            b"--require" | b"-r" => Some(&mut parsed.requires),
            b"--import" => Some(&mut parsed.imports),
            _ => None,
        };
        if let Some(dest) = dest {
            let value: &[u8] = match inline_value {
                Some(v) if !v.is_empty() => v,
                Some(_) => fail_requires_argument(tok),
                None => match tokens.get(i) {
                    Some(next) if !next.is_empty() && next[0] != b'-' => {
                        i += 1;
                        &**next
                    }
                    _ => fail_requires_argument(name),
                },
            };
            dest.push(Box::<[u8]>::from(value));
        }
    }
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_is_sorted() {
        for pair in ALLOWED.windows(2) {
            assert!(pair[0] < pair[1], "{:?} >= {:?}", pair[0], pair[1]);
        }
    }

    #[test]
    fn tokenize_basic() {
        assert_eq!(
            tokenize(b"--require ./a.js --import ./b.mjs").unwrap(),
            vec![
                Box::<[u8]>::from(b"--require" as &[u8]),
                Box::<[u8]>::from(b"./a.js" as &[u8]),
                Box::<[u8]>::from(b"--import" as &[u8]),
                Box::<[u8]>::from(b"./b.mjs" as &[u8]),
            ],
        );
    }

    #[test]
    fn tokenize_quotes() {
        assert_eq!(
            tokenize(br#"--import "./with space.mjs""#).unwrap(),
            vec![
                Box::<[u8]>::from(b"--import" as &[u8]),
                Box::<[u8]>::from(b"./with space.mjs" as &[u8]),
            ],
        );
        assert_eq!(
            tokenize(br#""a\"b""#).unwrap(),
            vec![Box::<[u8]>::from(br#"a"b"# as &[u8])],
        );
        assert_eq!(
            tokenize(br#"--import "ab"#),
            Err(TokenizeError::UnterminatedString),
        );
    }

    #[test]
    fn tokenize_empty() {
        assert!(tokenize(b"").unwrap().is_empty());
        assert!(tokenize(b"   ").unwrap().is_empty());
    }

    #[test]
    fn allowlist_lookup() {
        assert!(is_allowed(b"--import"));
        assert!(is_allowed(b"--require"));
        assert!(is_allowed(b"-r"));
        assert!(is_allowed(b"-C"));
        assert!(is_allowed(b"--max-old-space-size"));
        assert!(!is_allowed(b"--definitely-not-a-real-flag"));
        assert!(!is_allowed(b"--eval"));
        assert!(!is_allowed(b"-e"));
    }

    #[test]
    fn underscore_normalization() {
        assert_eq!(
            &*normalize(b"--max_old_space_size"),
            b"--max-old-space-size"
        );
        assert_eq!(&*normalize(b"-r"), b"-r");
    }
}
