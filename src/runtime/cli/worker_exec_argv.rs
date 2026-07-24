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
        // `create_exec_argv` emits NODE_SHORT_ALIASES tokens verbatim (`-pe`);
        // node's option parser recognizes them as whole-token aliases, so
        // accept them with the target's spec.
        for &(from, to) in crate::cli::arguments::NODE_SHORT_ALIASES {
            if let Some(&s) = map.get(to) {
                bun_core::handle_oom(map.put(from, s));
            }
        }
        map
    });
    &MAP
}

/// Re-parse the raw process argv into the canonical `process.execArgv` token
/// stream: skip argv[0] and a leading `run`, normalize bun_clap's
/// glued/chained short-flag forms (which node's CLI rejects) into the
/// separate-token shape the worker validator accepts, pair a trailing
/// value-taking short with the next argv token, and stop at the script name.
/// Shared by `process.execArgv` construction and the inherit-path honoring
/// scan so both see identical tokens.
pub fn collect_process_exec_argv_tokens() -> Vec<Vec<u8>> {
    fn short_takes_value(c: u8) -> Option<bun_clap::Values> {
        crate::cli::arguments::AUTO_PARAMS
            .iter()
            .find(|p| p.names.short == Some(c))
            .map(|p| p.takes_value)
    }
    /// Normalize a chained/glued short-flag token against `AUTO_PARAMS`.
    /// `None` → not a valid short chain (caller pushes verbatim);
    /// `Some(needs_next)` → normalized tokens pushed, and `needs_next` is
    /// true iff the trailing short's required value is the next argv token.
    fn push_normalized_short_token(arg: &[u8], out: &mut Vec<Vec<u8>>) -> Option<bool> {
        let mut flags: Vec<u8> = Vec::new();
        let mut value: Option<&[u8]> = None;
        let mut needs_next_value = false;
        let mut j = 1usize;
        while j < arg.len() {
            let takes = short_takes_value(arg[j])?;
            let next = j + 1;
            match takes {
                bun_clap::Values::None => {
                    if next < arg.len() && arg[next] == b'=' {
                        // bun_clap errors on `-b=x` at launch; unreachable in a
                        // running process, keep the token verbatim.
                        return None;
                    }
                    flags.push(arg[j]);
                    j = next;
                }
                // A glued remainder after an optional-value short is dropped
                // by bun_clap; the canonical form is the bare flag.
                bun_clap::Values::OneOptional => {
                    flags.push(arg[j]);
                    break;
                }
                bun_clap::Values::One | bun_clap::Values::Many => {
                    flags.push(arg[j]);
                    if next >= arg.len() {
                        needs_next_value = true;
                        break;
                    }
                    let v = if arg[next] == b'=' {
                        &arg[next + 1..]
                    } else {
                        &arg[next..]
                    };
                    value = Some(v);
                    break;
                }
            }
        }
        for &f in &flags {
            out.push(vec![b'-', f]);
        }
        if let Some(v) = value {
            out.push(v.to_vec());
        }
        Some(needs_next_value)
    }

    // `--long`/`-s` for every AUTO_PARAMS flag whose value bun_clap consumes
    // from the NEXT argv token (One/Many only — an OneOptional flag like
    // `--inspect` or `--config` takes a value solely via `=`, so the token
    // after it is a fresh flag or the script, never a value); used to decide
    // whether a non-flag token is a value or the script name.
    static TAKES_VALUE: LazyLock<bun_collections::StringSet> = LazyLock::new(|| {
        let mut set = bun_collections::StringSet::new();
        for param in crate::cli::arguments::AUTO_PARAMS.iter() {
            if matches!(
                param.takes_value,
                bun_clap::Values::One | bun_clap::Values::Many
            ) {
                if let Some(name) = param.names.long {
                    let mut k = Vec::with_capacity(2 + name.len());
                    k.extend_from_slice(b"--");
                    k.extend_from_slice(name);
                    bun_core::handle_oom(set.insert(&k));
                }
                if let Some(name) = param.names.short {
                    bun_core::handle_oom(set.insert(&[b'-', name]));
                }
            }
        }
        set
    });

    let argv = bun_core::argv();
    let mut out = Vec::with_capacity(argv.len().saturating_sub(1));
    let mut seen_run = false;
    let mut prev_takes_value = false;
    let mut iter = argv.iter();
    let _ = iter.next(); // argv[0]
    for arg in iter {
        let arg: &[u8] = arg;
        // bun_clap consumes the next token as a One/Many value unconditionally
        // (no leading-`-` check), so a `-`-prefixed value is still a value,
        // not a new flag to normalize.
        if prev_takes_value {
            out.push(arg.to_vec());
            prev_takes_value = false;
            continue;
        }
        if arg.len() >= 1 && arg[0] == b'-' {
            // Node's whole-token aliases (`-pe`) are substituted before clap
            // parsing on the bun/node entry points, so they are not short
            // chains; keep them verbatim and resolve takes-value via the
            // alias target. Normalization covers both the bun/node entry and
            // `bun run`: every short in RUN_PARAMS is also in AUTO_PARAMS.
            let node_alias_to = crate::cli::arguments::NODE_SHORT_ALIASES
                .iter()
                .find_map(|(from, to)| (*from == arg).then_some(*to));
            let normalized = if node_alias_to.is_none() && arg.len() > 2 && arg[1] != b'-' {
                push_normalized_short_token(arg, &mut out)
            } else {
                None
            };
            prev_takes_value = match normalized {
                Some(needs_next) => needs_next,
                None => {
                    out.push(arg.to_vec());
                    // The aliases only apply on the bun/node entry points
                    // (Arguments::parse scopes them the same way).
                    TAKES_VALUE.contains(arg)
                        || (!seen_run && node_alias_to.is_some_and(|to| TAKES_VALUE.contains(to)))
                }
            };
            continue;
        }
        if !seen_run && arg == b"run" {
            seen_run = true;
            continue;
        }
        // we hit the script name
        break;
    }
    out
}

/// Node normalizes `_` to `-` in long option names.
fn normalized(name: &[u8]) -> Vec<u8> {
    name.iter()
        .map(|&b| if b == b'_' { b'-' } else { b })
        .collect()
}

/// Split a token into (name, value): `--x=v` → (`--x`, `Some(v)`).
/// Short flags are never split: node rejects a glued short-flag value
/// (`-r./s.js`, `-r=./s.js`) in both worker execArgv and NODE_OPTIONS with
/// the whole token in the message (verified on node v26.3.0 — node's own CLI
/// rejects glued shorts too), so the whole token missing the map is exactly
/// the right outcome.
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
        // ── honored per-worker options ──
        match &key[..] {
            b"--no-addons" => saw_no_addons = true,
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
            tokens = collect_process_exec_argv_tokens();
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
