//! Worker `execArgv` policy — parity with <https://github.com/nodejs/node/blob/main/src/node_worker.cc>.

use std::sync::LazyLock;

use bun_core::{String as BunString, WTFStringImplExt as _};
use bun_jsc::virtual_machine::WorkerExecArgv;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ValueMode {
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
    pub env: bool,
}

const fn spec(value: ValueMode, policy: Policy, env: bool) -> FlagSpec {
    FlagSpec { value, policy, env }
}

const ALLOW: FlagSpec = spec(ValueMode::None, Policy::Allow, true);
const ALLOW_ARG: FlagSpec = spec(ValueMode::Required, Policy::Allow, true);
const ALLOW_NO_ENV: FlagSpec = spec(ValueMode::None, Policy::Allow, false);
const ALLOW_ARG_NO_ENV: FlagSpec = spec(ValueMode::Required, Policy::Allow, false);
const V8_REJECT: FlagSpec = spec(ValueMode::None, Policy::Reject, true);
const V8_REJECT_ARG: FlagSpec = spec(ValueMode::Required, Policy::Reject, true);

static NODE_FLAGS: &[(&[u8], FlagSpec)] = &[
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
    (b"--test", ALLOW_NO_ENV),
    (b"--check", ALLOW_NO_ENV),
    (b"--interactive", ALLOW_NO_ENV),
    (b"--env-file", ALLOW_ARG_NO_ENV),
    (b"--env-file-if-exists", ALLOW_ARG_NO_ENV),
    (b"--watch-path", ALLOW_ARG_NO_ENV),
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

static BUN_TABLE_REJECTS: &[&[u8]] = &[
    b"--title",
    b"--zero-fill-buffers",
    b"--use-openssl-ca",
    b"--use-bundled-ca",
];

static ENV_DISALLOWED: &[&[u8]] = &[b"--eval", b"-e", b"--print", b"-p"];

fn table_map() -> &'static bun_collections::StringArrayHashMap<FlagSpec> {
    static MAP: LazyLock<bun_collections::StringArrayHashMap<FlagSpec>> = LazyLock::new(|| {
        let mut map = bun_collections::StringArrayHashMap::<FlagSpec>::default();
        let mut put = |key: Vec<u8>, spec: FlagSpec| {
            bun_core::handle_oom(map.put(&key, spec));
        };
        for param in crate::cli::arguments::AUTO_PARAMS.iter() {
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
        for &(from, to) in crate::cli::arguments::NODE_SHORT_ALIASES {
            if let Some(&s) = map.get(to) {
                bun_core::handle_oom(map.put(from, s));
            }
        }
        map
    });
    &MAP
}

pub fn collect_process_exec_argv_tokens() -> Vec<Vec<u8>> {
    fn short_takes_value(c: u8) -> Option<bun_clap::Values> {
        crate::cli::arguments::AUTO_PARAMS
            .iter()
            .find(|p| p.names.short == Some(c))
            .map(|p| p.takes_value)
    }
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
                        return None;
                    }
                    flags.push(arg[j]);
                    j = next;
                }
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
    let _ = iter.next();
    for arg in iter {
        let arg: &[u8] = arg;
        if prev_takes_value {
            out.push(arg.to_vec());
            prev_takes_value = false;
            continue;
        }
        if arg.len() >= 1 && arg[0] == b'-' {
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
        break;
    }
    out
}

fn normalized(name: &[u8]) -> Vec<u8> {
    name.iter()
        .map(|&b| if b == b'_' { b'-' } else { b })
        .collect()
}

fn split_token(tok: &[u8]) -> (&[u8], Option<&[u8]>) {
    if tok.starts_with(b"--") {
        if let Some(pos) = bun_core::strings::index_of_char_usize(tok, b'=') {
            return (&tok[..pos], Some(&tok[pos + 1..]));
        }
    }
    (tok, None)
}

#[derive(Default)]
pub struct ScanOutcome {
    pub honored: WorkerExecArgv,
    /// `<flag> requires an argument` entries; take precedence over `invalid`
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

pub fn scan_exec_argv<T: AsRef<[u8]>>(tokens: &[T]) -> ScanOutcome {
    let map = table_map();
    let mut out = ScanOutcome::default();
    let mut saw_no_addons = false;
    let mut saw_no_ffi_cc = false;
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
        match &key[..] {
            b"--no-addons" => saw_no_addons = true,
            b"--no-ffi-cc" => saw_no_ffi_cc = true,
            b"--use-system-ca" => out.honored.use_system_ca = Some(true),
            b"--no-use-system-ca" => out.honored.use_system_ca = Some(false),
            b"--expose-gc" => out.honored.expose_gc = true,
            b"--cpu-prof" => out.honored.cpu_prof = true,
            b"--cpu-prof-md" => out.honored.cpu_prof_md = true,
            b"--cpu-prof-interval" => {
                out.honored.cpu_prof_interval = value
                    .as_deref()
                    .and_then(|v| std::str::from_utf8(v).ok())
                    .and_then(|s| s.parse().ok());
            }
            b"--cpu-prof-name" => {
                out.honored.cpu_prof_name = value
                    .as_deref()
                    .map(crate::cli::arguments::replace_pid_placeholder);
            }
            b"--cpu-prof-dir" => {
                out.honored.cpu_prof_dir = value.map(Vec::into_boxed_slice);
            }
            b"--require" | b"--preload" | b"-r" | b"--import" => {
                if let Some(v) = value {
                    out.honored.preloads.push(v.into_boxed_slice());
                }
            }
            _ => {}
        }
    }
    out.honored.allow_addons = Some(!saw_no_addons);
    out.honored.allow_ffi_cc = Some(!saw_no_ffi_cc);
    out
}

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
            // Same tokenizer as `create_exec_argv`, so this scan sees exactly the
            // tokens `process.execArgv` exposes.
            for token in bun_core::strings::tokenize_any(graph.compile_exec_argv(), b" \t\n\r") {
                tokens.push(token.to_vec());
            }
        } else {
            tokens = collect_process_exec_argv_tokens();
        }
        let mut outcome = scan_exec_argv(&tokens);
        outcome.honored.preloads.clear();
        outcome.honored.cpu_prof = false;
        outcome.honored.cpu_prof_md = false;
        outcome.honored.cpu_prof_interval = None;
        outcome.honored.cpu_prof_name = None;
        outcome.honored.cpu_prof_dir = None;
        outcome.honored
    });
    CACHED.clone()
}

/// `WTF::StringImpl*[]` → owned UTF-8 tokens (nulls skipped); shared by validation + honoring.
/// # Safety
/// Each non-null entry is a live `WTF::StringImpl*` owned by the caller.
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

/// Validate a worker's explicit `execArgv` (JSWorker.cpp); writes the ERR_WORKER_INVALID_EXEC_ARGV tail on reject.
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

/// Validate a worker env's `NODE_OPTIONS` — skipped when byte-equal to the parent's (node_worker.cc).
/// # Safety
/// `node_options` is a live `WTF::StringImpl*`/null; `out_message` valid; thread has a live VM.
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

    let vm = bun_jsc::virtual_machine::VirtualMachine::get();
    if let Some(parent) = vm.env_loader().map.get(b"NODE_OPTIONS") {
        if parent == value {
            return true;
        }
    }

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
    let mut i = 1usize;
    while i < tokens.len() {
        // `OptionsEnvArg for Box<ZStr>` keeps the trailing NUL in the slice
        // metadata (see util.rs) — strip it before classifying.
        let tok = tokens[i].as_bytes();
        let tok = tok.strip_suffix(b"\0").unwrap_or(tok);
        i += 1;
        if !tok.starts_with(b"-") || tok == b"-" || tok == b"--" {
            continue;
        }
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
            // Node pops the next token unconditionally (no leading-dash
            // check), matching scan_exec_argv above.
            if tokens.get(i).is_some() {
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
