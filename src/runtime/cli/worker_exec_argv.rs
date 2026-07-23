//! Worker `execArgv` policy: node_worker.cc parity for `new Worker(url, { execArgv })`.
//!
//! Node accepts env/isolate options in a worker's execArgv and rejects
//! per-process options, V8 flags, unknown flags, and missing required values
//! with `ERR_WORKER_INVALID_EXEC_ARGV` (behavior verified on node v26.3.0).
//! Bun's accept set = its own runtime flag tables (`RUNTIME_PARAMS_` +
//! `TRANSPILER_PARAMS_` + `AUTO_ONLY_PARAMS` + `BASE_PARAMS_` — everything
//! `create_exec_argv`'s `AUTO_PARAMS` can put into `process.execArgv`, minus
//! process-global flags node also rejects) plus
//! the node options in `NODE_FLAGS`. Deliberate supersets of node: Bun-only
//! runtime flags, and `--expose-gc`/`--stack-trace-limit` (both honored
//! per-worker here, so rejecting them to mimic node would be a regression).
//! One scanner backs both validation and honoring, so every honored flag was
//! accepted; accepted-but-unhonored flags parse as no-ops, as in node.

use std::sync::LazyLock;

use bun_core::{String as BunString, WTFStringImplExt as _};
use bun_jsc::virtual_machine::WorkerExecArgv;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ValueMode {
    /// Boolean flag; a `--flag=value` form is tolerated (node accepts
    /// `--no-warnings=x`).
    None,
    /// Value only via `--flag=value`; a following token is not consumed.
    Optional,
    /// Value via `--flag=value` or the next token; missing value is an error.
    Required,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Policy {
    /// Accepted in worker execArgv.
    Allow,
    /// Rejected in worker execArgv (listed in ERR_WORKER_INVALID_EXEC_ARGV).
    Reject,
}

#[derive(Clone, Copy, Debug)]
pub struct FlagSpec {
    pub value: ValueMode,
    pub policy: Policy,
    /// Accepted inside a worker's explicit `env: { NODE_OPTIONS }` check.
    /// Mirrors node: per-isolate kAllowedInEnvvar options and the V8 options
    /// node registers as allowed-in-NODE_OPTIONS.
    pub env: bool,
}

const fn spec(value: ValueMode, policy: Policy, env: bool) -> FlagSpec {
    FlagSpec { value, policy, env }
}

const ALLOW: FlagSpec = spec(ValueMode::None, Policy::Allow, true);
const ALLOW_ARG: FlagSpec = spec(ValueMode::Required, Policy::Allow, true);
const ALLOW_NO_ENV: FlagSpec = spec(ValueMode::None, Policy::Allow, false);
const ALLOW_ARG_NO_ENV: FlagSpec = spec(ValueMode::Required, Policy::Allow, false);
/// V8 flags: rejected in worker execArgv, silently tolerated in NODE_OPTIONS.
const V8_REJECT: FlagSpec = spec(ValueMode::None, Policy::Reject, true);
const V8_REJECT_ARG: FlagSpec = spec(ValueMode::Required, Policy::Reject, true);

/// Node options that are not in Bun's runtime param tables (or that need a
/// different worker policy than the table default). Attributes follow
/// node v26.3.0 `node_options.cc` (verified empirically; see module doc).
static NODE_FLAGS: &[(&[u8], FlagSpec)] = &[
    // ── env/isolate options node workers accept; no-op in Bun unless noted ──
    (b"--no-warnings", ALLOW),
    (b"--trace-warnings", ALLOW),
    (b"--pending-deprecation", ALLOW),
    (b"--trace-deprecation", ALLOW),
    (b"--trace-uncaught", ALLOW),
    (b"--redirect-warnings", ALLOW_ARG),
    (b"--disable-warning", ALLOW_ARG),
    (b"--input-type", ALLOW_ARG),
    (b"--experimental-vm-modules", ALLOW),
    (b"--frozen-intrinsics", ALLOW),
    (b"--enable-source-maps", ALLOW),
    (b"--experimental-detect-module", ALLOW),
    (b"--no-experimental-detect-module", ALLOW),
    (b"--experimental-strip-types", ALLOW),
    (b"--no-experimental-strip-types", ALLOW),
    (b"--experimental-loader", ALLOW_ARG),
    (b"--experimental-require-module", ALLOW),
    (b"--no-experimental-require-module", ALLOW),
    (b"--experimental-import-meta-resolve", ALLOW),
    (b"--experimental-websocket", ALLOW),
    (b"--no-experimental-websocket", ALLOW),
    (b"--experimental-sqlite", ALLOW),
    (b"--no-experimental-sqlite", ALLOW),
    (b"--experimental-eventsource", ALLOW),
    (b"--no-experimental-eventsource", ALLOW),
    (b"--experimental-webstorage", ALLOW),
    (b"--experimental-wasm-modules", ALLOW),
    (b"--no-experimental-fetch", ALLOW),
    (b"--no-experimental-global-webcrypto", ALLOW),
    (b"--no-experimental-global-customevent", ALLOW),
    (b"--experimental-async-context-frame", ALLOW),
    (b"--no-experimental-async-context-frame", ALLOW),
    (b"--experimental-network-inspection", ALLOW),
    (b"--experimental-worker-inspection", ALLOW),
    (b"--experimental-test-coverage", ALLOW),
    (b"--test-only", ALLOW),
    (b"--test-name-pattern", ALLOW_ARG),
    (b"--test-skip-pattern", ALLOW_ARG),
    (b"--test-reporter", ALLOW_ARG),
    (b"--test-reporter-destination", ALLOW_ARG),
    (b"--insecure-http-parser", ALLOW),
    (b"--no-global-search-paths", ALLOW),
    (b"--no-addons", ALLOW),
    (b"--disable-proto", ALLOW_ARG),
    (b"--no-force-async-hooks-checks", ALLOW),
    (b"--force-async-hooks-checks", ALLOW),
    (b"--force-node-api-uncaught-exceptions-policy", ALLOW),
    (b"--force-context-aware", ALLOW),
    (b"--napi-modules", ALLOW),
    (b"--trace-sync-io", ALLOW),
    (b"--track-heap-objects", ALLOW),
    (b"--verify-base-objects", ALLOW),
    (b"--report-uncaught-exception", ALLOW),
    (b"--report-on-signal", ALLOW),
    (b"--report-on-fatalerror", ALLOW),
    (b"--report-signal", ALLOW_ARG),
    (b"--experimental-report", ALLOW),
    (b"--heapsnapshot-signal", ALLOW_ARG),
    (b"--heapsnapshot-near-heap-limit", ALLOW_ARG),
    (b"--diagnostic-dir", ALLOW_ARG),
    (b"--tls-min-v1.0", ALLOW),
    (b"--tls-min-v1.1", ALLOW),
    (b"--tls-min-v1.2", ALLOW),
    (b"--tls-min-v1.3", ALLOW),
    (b"--tls-max-v1.2", ALLOW),
    (b"--tls-max-v1.3", ALLOW),
    (b"--permission", ALLOW),
    (b"--experimental-permission", ALLOW),
    (b"--allow-fs-read", ALLOW_ARG),
    (b"--allow-fs-write", ALLOW_ARG),
    (b"--allow-child-process", ALLOW),
    (b"--allow-worker", ALLOW),
    (b"--allow-wasi", ALLOW),
    (b"--allow-addons", ALLOW),
    (b"--inspect-port", ALLOW_ARG),
    (b"--debug-port", ALLOW_ARG),
    (b"--inspect-publish-uid", ALLOW_ARG),
    (b"--prof-process", ALLOW),
    (b"--heap-prof-interval", ALLOW_ARG),
    (b"--tls-keylog", ALLOW_ARG),
    (b"-C", ALLOW_ARG),
    // ── node workers accept these, but they are not NODE_OPTIONS material ──
    (b"--test", ALLOW_NO_ENV),
    (b"--check", ALLOW_NO_ENV),
    (b"--interactive", ALLOW_NO_ENV),
    (b"--env-file", ALLOW_ARG_NO_ENV),
    (b"--env-file-if-exists", ALLOW_ARG_NO_ENV),
    (b"--watch-path", ALLOW_ARG_NO_ENV),
    // ── V8 flags ──
    (b"--max-old-space-size", V8_REJECT_ARG),
    (b"--max-semi-space-size", V8_REJECT_ARG),
    (b"--stack-size", V8_REJECT_ARG),
    (b"--jitless", V8_REJECT),
    (b"--disallow-code-generation-from-strings", V8_REJECT),
    (b"--perf-basic-prof", V8_REJECT),
    (b"--perf-basic-prof-only-functions", V8_REJECT),
    (b"--perf-prof", V8_REJECT),
    (b"--perf-prof-unwinding-info", V8_REJECT),
    (b"--interpreted-frames-native-stack", V8_REJECT),
    (b"--abort-on-uncaught-exception", V8_REJECT),
    (b"--huge-max-old-generation-size", V8_REJECT),
];

/// Bun runtime-table flags that are process-global in Bun AND rejected by
/// node workers — the table-derived Allow default would be a lie for these.
static BUN_TABLE_REJECTS: &[&[u8]] = &[
    b"--title",
    b"--zero-fill-buffers",
    b"--use-openssl-ca",
    b"--use-bundled-ca",
];

/// env-policy overrides for table-derived entries: node reports these as
/// "not allowed in NODE_OPTIONS" in the worker env check.
static ENV_DISALLOWED: &[&[u8]] = &[b"--eval", b"-e", b"--print", b"-p"];

fn table_map() -> &'static bun_collections::StringArrayHashMap<FlagSpec> {
    static MAP: LazyLock<bun_collections::StringArrayHashMap<FlagSpec>> = LazyLock::new(|| {
        let mut map = bun_collections::StringArrayHashMap::<FlagSpec>::default();
        let mut put = |key: Vec<u8>, spec: FlagSpec| {
            bun_core::handle_oom(map.put(&key, spec));
        };
        // Bun's runtime flag surface first, then NODE_FLAGS overrides.
        // The chained set must cover everything `create_exec_argv` can emit
        // into `process.execArgv` (its source is `AUTO_PARAMS` =
        // AUTO_ONLY_PARAMS + RUNTIME_PARAMS_ + TRANSPILER_PARAMS_ +
        // BASE_PARAMS_; AUTO_ONLY_PARAMS already contains AUTO_OR_RUN_PARAMS,
        // whose run-surface flags tooling forwards into worker
        // execArgv/NODE_OPTIONS — Next.js propagates `--bun` from
        // process.execArgv into its build workers' NODE_OPTIONS). A narrower
        // set rejects flags Bun itself reports in `process.execArgv` and
        // breaks value-consumption in `scan_process_exec_argv`.
        for param in crate::cli::arguments::RUNTIME_PARAMS_
            .iter()
            .chain(crate::cli::arguments::TRANSPILER_PARAMS_)
            .chain(crate::cli::arguments::AUTO_ONLY_PARAMS)
            .chain(crate::cli::arguments::BASE_PARAMS_)
        {
            let value = match param.takes_value {
                bun_clap::Values::None => ValueMode::None,
                bun_clap::Values::OneOptional => ValueMode::Optional,
                bun_clap::Values::One | bun_clap::Values::Many => ValueMode::Required,
            };
            let mut names: [Option<Vec<u8>>; 2] = [None, None];
            if let Some(long) = param.names.long {
                let mut k = Vec::with_capacity(2 + long.len());
                k.extend_from_slice(b"--");
                k.extend_from_slice(long);
                names[0] = Some(k);
            }
            if let Some(short) = param.names.short {
                names[1] = Some(vec![b'-', short]);
            }
            for key in names.into_iter().flatten() {
                let policy = if BUN_TABLE_REJECTS.contains(&&key[..]) {
                    Policy::Reject
                } else {
                    Policy::Allow
                };
                let env = policy == Policy::Allow && !ENV_DISALLOWED.contains(&&key[..]);
                put(key, FlagSpec { value, policy, env });
            }
        }
        for &(name, spec) in NODE_FLAGS {
            put(name.to_vec(), spec);
        }
        map
    });
    &MAP
}

/// Node normalizes `_` to `-` in long option names.
fn normalized(name: &[u8]) -> Vec<u8> {
    name.iter()
        .map(|&b| if b == b'_' { b'-' } else { b })
        .collect()
}

/// Split a long token into (name, value): `--x=v` → (`--x`, `Some(v)`).
/// Short tokens are parsed by the chaining loop in `scan_exec_argv`.
fn split_token(tok: &[u8]) -> (&[u8], Option<&[u8]>) {
    if tok.starts_with(b"--") {
        if let Some(pos) = tok.iter().position(|&b| b == b'=') {
            return (&tok[..pos], Some(&tok[pos + 1..]));
        }
    }
    (tok, None)
}

#[derive(Default)]
pub struct ScanOutcome {
    pub honored: WorkerExecArgv,
    /// `<flag> requires an argument` entries; take precedence over `invalid`
    /// in the ERR_WORKER_INVALID_EXEC_ARGV message (node_worker.cc).
    pub errors: Vec<Vec<u8>>,
    /// Raw rejected tokens.
    pub invalid: Vec<Vec<u8>>,
}

impl ScanOutcome {
    pub fn message(&self) -> Option<Vec<u8>> {
        let list = if !self.errors.is_empty() {
            &self.errors
        } else if !self.invalid.is_empty() {
            &self.invalid
        } else {
            return None;
        };
        Some(list.join(&b", "[..]))
    }
}

/// Record one accepted flag's honored per-worker effect (if any).
fn record_honored(out: &mut ScanOutcome, saw_no_addons: &mut bool, key: &[u8], value: Option<Vec<u8>>) {
    match key {
        b"--no-addons" => *saw_no_addons = true,
        b"--use-system-ca" => out.honored.use_system_ca = Some(true),
        b"--no-use-system-ca" => out.honored.use_system_ca = Some(false),
        b"--expose-gc" => out.honored.expose_gc = true,
        b"--cpu-prof" => out.honored.cpu_prof = true,
        b"--cpu-prof-interval" => {
            out.honored.cpu_prof_interval = value
                .as_deref()
                .and_then(|v| std::str::from_utf8(v).ok())
                .and_then(|s| s.parse().ok());
        }
        b"--require" | b"--preload" | b"-r" | b"--import" => {
            if let Some(v) = value {
                out.honored.preloads.push(v.into_boxed_slice());
            }
        }
        _ => {}
    }
}

/// Scan an execArgv token list with node's worker rules: stop at `--`/`-`/the
/// first positional; classify each flag; collect the honored per-worker
/// options along the way.
pub fn scan_exec_argv<T: AsRef<[u8]>>(tokens: &[T]) -> ScanOutcome {
    let map = table_map();
    let mut out = ScanOutcome::default();
    let mut saw_no_addons = false;
    let mut i = 0usize;
    while i < tokens.len() {
        let tok = tokens[i].as_ref();
        i += 1;
        if tok == b"--" || tok == b"-" || !tok.starts_with(b"-") {
            break;
        }
        if tok[1] != b'-' {
            // Short-flag token: mirror `bun_clap::streaming::chainging` —
            // each char is a short flag; `Values::None` chains to the next
            // char; a value-taking short consumes the glued remainder (with
            // or without `=`) or the next token; an optional-value short
            // drops any glued remainder; an unknown char or a `=` on a
            // non-value short invalidates the whole token.
            let mut j = 1usize;
            while j < tok.len() {
                let short = [b'-', tok[j]];
                let Some(spec) = map.get(&short[..]) else {
                    out.invalid.push(tok.to_vec());
                    break;
                };
                let next = j + 1;
                let next_is_eql = next < tok.len() && tok[next] == b'=';
                if next_is_eql && spec.value == ValueMode::None {
                    out.invalid.push(tok.to_vec());
                    break;
                }
                if spec.policy == Policy::Reject {
                    out.invalid.push(short.to_vec());
                    match spec.value {
                        ValueMode::None => {
                            j = next;
                            continue;
                        }
                        // The rejected flag still owns its value (glued, or
                        // the next token by arity).
                        ValueMode::Required if next >= tok.len() && i < tokens.len() => i += 1,
                        _ => {}
                    }
                    break;
                }
                let value: Option<Vec<u8>> = match spec.value {
                    ValueMode::None | ValueMode::Optional => None,
                    ValueMode::Required => {
                        if next >= tok.len() {
                            if i < tokens.len() {
                                let v = tokens[i].as_ref().to_vec();
                                i += 1;
                                Some(v)
                            } else {
                                let mut err = short.to_vec();
                                err.extend_from_slice(b" requires an argument");
                                out.errors.push(err);
                                break;
                            }
                        } else if next_is_eql {
                            Some(tok[next + 1..].to_vec())
                        } else {
                            Some(tok[next..].to_vec())
                        }
                    }
                };
                record_honored(&mut out, &mut saw_no_addons, &short, value);
                if spec.value != ValueMode::None {
                    break;
                }
                j = next;
            }
            continue;
        }
        let (name, eq_value) = split_token(tok);
        let key = normalized(name);
        let Some(spec) = map.get(&key[..]) else {
            out.invalid.push(tok.to_vec());
            continue;
        };
        if spec.policy == Policy::Reject {
            out.invalid.push(tok.to_vec());
            // A rejected flag still owns its value token (node consumes it by
            // arity); skip it so scanning continues at the next flag and the
            // error lists every invalid flag.
            if spec.value == ValueMode::Required && eq_value.is_none() && i < tokens.len() {
                i += 1;
            }
            continue;
        }
        let value: Option<Vec<u8>> = match spec.value {
            ValueMode::Required => match eq_value {
                Some(v) => Some(v.to_vec()),
                None => {
                    if i < tokens.len() {
                        let v = tokens[i].as_ref().to_vec();
                        i += 1;
                        Some(v)
                    } else {
                        let mut err = key.clone();
                        err.extend_from_slice(b" requires an argument");
                        out.errors.push(err);
                        continue;
                    }
                }
            },
            _ => eq_value.map(<[u8]>::to_vec),
        };
        record_honored(&mut out, &mut saw_no_addons, &key, value);
    }
    // An explicit execArgv resets to fresh defaults (node_worker.cc), so
    // allow_addons is always set: `--no-addons` wins, else the default true.
    out.honored.allow_addons = Some(!saw_no_addons);
    out
}

/// Honored options for a worker that inherits execArgv from the main thread.
/// Mirrors the `process.execArgv` derivation (`node_process.rs`
/// `create_exec_argv`): standalone executables use `compile_exec_argv` +
/// `BUN_OPTIONS`; otherwise the process argv is scanned, skipping argv[0] and
/// a leading `run`. Cached — both sources are process-constant. Preloads and
/// the CPU profiler are excluded: the parent VM already carries both
/// (`WebWorker.preloads`, `parent_cpu_profiler_config`).
pub fn scan_process_exec_argv() -> WorkerExecArgv {
    static CACHED: LazyLock<WorkerExecArgv> = LazyLock::new(|| {
        let mut tokens: Vec<Vec<u8>> = Vec::new();
        let vm = bun_jsc::virtual_machine::VirtualMachine::get();
        if let Some(graph) = vm.standalone_module_graph {
            if let Some(opts) = bun_core::env_var::BUN_OPTIONS.get() {
                let mut parsed: Vec<Box<bun_core::ZStr>> =
                    vec![<Box<bun_core::ZStr> as bun_core::OptionsEnvArg>::from_slice(b"")];
                bun_core::append_options_env(opts, &mut parsed);
                for t in &parsed[1..] {
                    let t = t.as_bytes();
                    tokens.push(t.strip_suffix(b"\0").unwrap_or(t).to_vec());
                }
            }
            for token in graph
                .compile_exec_argv()
                .split(|b: &u8| b.is_ascii_whitespace())
                .filter(|s: &&[u8]| !s.is_empty())
            {
                tokens.push(token.to_vec());
            }
        } else {
            let mut seen_run = false;
            let mut iter = bun_core::argv().iter();
            let _ = iter.next(); // argv[0]
            for arg in iter {
                let arg: &[u8] = arg;
                if !seen_run && arg == b"run" {
                    seen_run = true;
                    continue;
                }
                // Collect everything; `scan_exec_argv` consumes flag values
                // itself and stops at the first true positional (the script).
                tokens.push(arg.to_vec());
            }
        }
        let mut outcome = scan_exec_argv(&tokens);
        outcome.honored.preloads.clear();
        outcome.honored.cpu_prof = false;
        outcome.honored.cpu_prof_interval = None;
        outcome.honored
    });
    CACHED.clone()
}

// ═══════════════════════════ C++ entry points ═══════════════════════════

/// Convert a `WTF::StringImpl*` array to owned UTF-8 tokens, skipping null
/// entries — the single conversion used by both the validation entry point
/// and the honoring hook, so the two always classify the same token list.
///
/// # Safety
/// Each non-null entry of `argv` is a live `WTF::StringImpl*` owned by the
/// caller for the duration of the call.
pub(crate) unsafe fn owned_tokens(exec_argv: &[bun_core::WTFStringImpl]) -> Vec<Vec<u8>> {
    let mut tokens = Vec::with_capacity(exec_argv.len());
    for &s in exec_argv {
        if s.is_null() {
            continue;
        }
        // SAFETY: per fn contract — `s` is a live `WTFStringImpl*`.
        tokens.push(unsafe { &*s }.to_owned_slice_z().as_bytes().to_vec());
    }
    tokens
}

/// Validate a worker's explicit `execArgv` (JSWorker.cpp). Returns `true`
/// when valid; otherwise writes the joined flag list for
/// `ERR_WORKER_INVALID_EXEC_ARGV` into `out_message`.
///
/// # Safety
/// `argv`/`len` as in [`owned_tokens`]; `out_message` is a valid out-param.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Worker__validateExecArgv(
    argv: *const bun_core::WTFStringImpl,
    len: usize,
    out_message: *mut BunString,
) -> bool {
    // SAFETY: per fn contract.
    let tokens = unsafe { owned_tokens(bun_core::ffi::slice(argv, len)) };
    match scan_exec_argv(&tokens).message() {
        None => true,
        Some(msg) => {
            // SAFETY: per fn contract — valid out-param.
            unsafe { *out_message = BunString::clone_utf8(&msg) };
            false
        }
    }
}

/// Validate the `NODE_OPTIONS` value from a worker's explicit `env` object
/// (JSWorker.cpp). Mirrors node_worker.cc: skipped when the value is
/// character-for-character equal to the parent's `NODE_OPTIONS` (the worker
/// is passing the parent config through); otherwise every token must be a
/// known worker/env option with its required value present.
///
/// # Safety
/// `node_options` is a live `WTF::StringImpl*` (or null); `out_message` is a
/// valid out-param. Must be called on a thread with a live VM (the parent
/// thread constructing the Worker).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Worker__validateWorkerNodeOptions(
    node_options: bun_core::WTFStringImpl,
    out_message: *mut BunString,
) -> bool {
    if node_options.is_null() {
        return true;
    }
    // SAFETY: per fn contract.
    let value = unsafe { &*node_options }.to_owned_slice_z();
    let value = value.as_bytes();

    // Skip when equal to the process's OS-startup NODE_OPTIONS
    // (`env_loader().map` is a per-VM clone of that snapshot; runtime
    // `process.env` writes do not reach it, so a miss just re-validates
    // against the full table).
    let vm = bun_jsc::virtual_machine::VirtualMachine::get();
    if let Some(parent) = vm.env_loader().map.get(b"NODE_OPTIONS") {
        if parent == value {
            return true;
        }
    }

    // Quote-aware tokenization, same routine BUN_OPTIONS uses.
    let mut tokens: Vec<Box<bun_core::ZStr>> =
        vec![<Box<bun_core::ZStr> as bun_core::OptionsEnvArg>::from_slice(b"")];
    bun_core::append_options_env(value, &mut tokens);

    let fail = |msg: Vec<u8>| {
        // SAFETY: per fn contract — valid out-param.
        unsafe { *out_message = BunString::clone_utf8(&msg) };
        false
    };
    let not_allowed = |name: &[u8], had_eq: bool| {
        let mut msg = name.to_vec();
        if had_eq {
            msg.push(b'=');
        }
        msg.extend_from_slice(b" is not allowed in NODE_OPTIONS");
        msg
    };

    let map = table_map();
    let mut i = 1usize; // [0] is the placeholder
    while i < tokens.len() {
        // `OptionsEnvArg for Box<ZStr>` keeps the trailing NUL in the slice
        // metadata (see util.rs) — strip it before classifying.
        let tok = tokens[i].as_bytes();
        let tok = tok.strip_suffix(b"\0").unwrap_or(tok);
        i += 1;
        // node's env branch only surfaces option errors; bare positionals in
        // NODE_OPTIONS pass through the worker check untouched.
        if !tok.starts_with(b"-") || tok == b"-" || tok == b"--" {
            continue;
        }
        // A quoted value can be glued to its flag in one token
        // (`--flag "a b"`); split it off so the name lookup still works.
        let (tok, glued_value) = match tok.iter().position(u8::is_ascii_whitespace) {
            Some(pos) if tok.starts_with(b"--") => (&tok[..pos], true),
            _ => (tok, false),
        };
        let (name, eq_value) = split_token(tok);
        let key = normalized(name);
        let spec = match map.get(&key[..]) {
            Some(s) if s.env => s,
            _ => return fail(not_allowed(name, eq_value.is_some())),
        };
        if spec.value == ValueMode::Required && !glued_value && eq_value.is_none() {
            // node takes the value from `=`/quoting or a following non-flag
            // token; a following flag is NOT consumed (verified on v26.3.0).
            let next_is_value = tokens.get(i).is_some_and(|t| {
                let t = t.as_bytes();
                let t = t.strip_suffix(b"\0").unwrap_or(t);
                !t.starts_with(b"-")
            });
            if next_is_value {
                i += 1;
            } else {
                let mut msg = key;
                msg.extend_from_slice(b" requires an argument");
                return fail(msg);
            }
        }
    }
    true
}
