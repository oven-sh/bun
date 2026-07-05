//! `new Worker(filename, { execArgv })` flag validation.
//!
//! Node parses a worker's `execArgv` with its per-isolate options parser and
//! throws `ERR_WORKER_INVALID_EXEC_ARGV` for every entry it cannot apply to a
//! single thread: unrecognised names, V8 options, and per-process options.
//! Bun reads only `--no-addons` out of `execArgv` and echoes the rest back
//! through the worker's `process.execArgv`, so without the same check a typo
//! (or a `--max-old-space-size` that can never take effect) passes silently.
//!
//! <https://github.com/nodejs/node/blob/v26.3.0/src/node_worker.cc#L181-L213>

use bstr::BStr;
use bun_clap::Values;
use bun_core::{WTFStringImpl, WTFStringImplExt as _};
use bun_jsc::{ErrorCode, JSGlobalObject};

use crate::cli::arguments::AUTO_PARAMS;

/// What one `execArgv` entry names.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Flag {
    /// Neither Bun's CLI nor Node knows this name.
    Unknown,
    /// `--no-<x>` where `<x>` is a known option that is not a boolean. Node
    /// reports these with a message of their own.
    InvalidNegation,
    /// May be set per worker.
    Supported(Values),
    /// Recognised, but configures the whole process or the JS engine, so it can
    /// never take effect on one worker thread. Node rejects its equivalents
    /// from `execArgv` as well.
    PerProcess,
}

/// Bun flags that configure the process or the JS engine. Node rejects each of
/// these from `execArgv` too: `--expose-gc` and `--stack-trace-limit` are V8
/// options there, the rest are per-process options.
const PER_PROCESS_LONG: &[&[u8]] = &[
    b"expose-gc",
    b"help",
    b"revision",
    b"stack-trace-limit",
    b"title",
    b"trace-event-categories",
    b"trace-event-file-pattern",
    b"trace-events-enabled",
    b"use-bundled-ca",
    b"use-openssl-ca",
    b"version",
    b"zero-fill-buffers",
];

/// `-h` / `-v`: the short spellings of [`PER_PROCESS_LONG`] entries.
const PER_PROCESS_SHORT: &[u8] = b"hv";

/// Node flags Bun's CLI does not implement but still accepts here, because Node
/// allows them in a worker's `execArgv` and rejecting them would be stricter
/// than Node. Bun ignores them, exactly as it does on the command line.
///
/// Taken from Node v26.3.0's `PerIsolateOptionsParser` (which folds in
/// `EnvironmentOptionsParser`); its V8 and per-process options are left out
/// because Node rejects those too.
/// <https://github.com/nodejs/node/blob/v26.3.0/src/node_options.cc>
///
/// Sorted — looked up with `binary_search`.
const NODE_ONLY_BOOLEAN: &[&[u8]] = &[
    b"allow-addons",
    b"allow-child-process",
    b"allow-ffi",
    b"allow-inspector",
    b"allow-net",
    b"allow-wasi",
    b"allow-worker",
    b"build-snapshot",
    b"check",
    b"disable-sigusr1",
    b"enable-network-family-autoselection",
    b"enable-source-maps",
    b"entry-url",
    b"experimental-addon-modules",
    b"experimental-eventsource",
    b"experimental-ffi",
    b"experimental-import-meta-resolve",
    b"experimental-inspector-network-resource",
    b"experimental-network-inspection",
    b"experimental-print-required-tla",
    b"experimental-storage-inspection",
    b"experimental-strip-types",
    b"experimental-test-coverage",
    b"experimental-test-module-mocks",
    b"experimental-vm-modules",
    b"experimental-worker-inspection",
    b"force-context-aware",
    b"force-node-api-uncaught-exceptions-policy",
    b"frozen-intrinsics",
    b"insecure-http-parser",
    b"interactive",
    b"no-async-context-frame",
    b"no-experimental-detect-module",
    b"no-experimental-global-navigator",
    b"no-experimental-repl-await",
    b"no-experimental-require-module",
    b"no-experimental-sqlite",
    b"no-experimental-websocket",
    b"no-experimental-webstorage",
    b"no-extra-info-on-fatal-exception",
    b"no-force-async-hooks-checks",
    b"no-global-search-paths",
    b"no-network-family-autoselection",
    b"no-require-module",
    b"no-strip-types",
    b"no-warnings",
    b"pending-deprecation",
    b"permission",
    b"permission-audit",
    b"prof-process",
    b"report-exclude-env",
    b"report-exclude-network",
    b"report-on-signal",
    b"report-uncaught-exception",
    b"require-module",
    b"test",
    b"test-force-exit",
    b"test-only",
    b"test-randomize",
    b"test-update-snapshots",
    b"tls-max-v1.2",
    b"tls-max-v1.3",
    b"tls-min-v1.0",
    b"tls-min-v1.1",
    b"tls-min-v1.2",
    b"tls-min-v1.3",
    b"trace-deprecation",
    b"trace-promises",
    b"trace-sync-io",
    b"trace-tls",
    b"trace-uncaught",
    b"trace-warnings",
    b"track-heap-objects",
    b"use-env-proxy",
    b"watch-preserve-output",
    b"webstorage",
];

/// Value-taking counterpart of [`NODE_ONLY_BOOLEAN`]. Sorted.
const NODE_ONLY_WITH_VALUE: &[&[u8]] = &[
    b"allow-fs-read",
    b"allow-fs-write",
    b"build-snapshot-config",
    b"debug-port",
    b"diagnostic-dir",
    b"disable-warning",
    b"env-file-if-exists",
    b"experimental-config-file",
    b"experimental-default-config-file",
    b"experimental-loader",
    b"experimental-test-isolation",
    b"experimental-test-tag-filter",
    b"heap-prof-interval",
    b"heapsnapshot-near-heap-limit",
    b"heapsnapshot-signal",
    b"input-type",
    b"inspect-port",
    b"inspect-publish-uid",
    b"localstorage-file",
    b"max-old-space-size-percentage",
    b"network-family-autoselection-attempt-timeout",
    b"redirect-warnings",
    b"report-signal",
    b"test-concurrency",
    b"test-coverage-branches",
    b"test-coverage-exclude",
    b"test-coverage-functions",
    b"test-coverage-include",
    b"test-coverage-lines",
    b"test-global-setup",
    b"test-isolation",
    b"test-name-pattern",
    b"test-random-seed",
    b"test-reporter",
    b"test-reporter-destination",
    b"test-rerun-failures",
    b"test-shard",
    b"test-skip-pattern",
    b"test-timeout",
    b"tls-keylog",
    b"trace-require-module",
    b"watch-kill-signal",
    b"watch-path",
];

/// `-C` is Node's short spelling of `--conditions`; Bun's CLI only has the long
/// one.
const NODE_ONLY_SHORT_WITH_VALUE: &[u8] = b"C";

/// Classify a long flag by the name between `--` and `=`.
fn lookup_long(name: &[u8]) -> Flag {
    // Node canonicalises `_` to `-` in a long option's name before looking it
    // up, so `--no_warnings` names the same option as `--no-warnings`.
    if name.contains(&b'_') {
        let canonical: Vec<u8> = name
            .iter()
            .map(|&byte| if byte == b'_' { b'-' } else { byte })
            .collect();
        return lookup_canonical_long(&canonical);
    }
    lookup_canonical_long(name)
}

/// Look `name` up in the tables verbatim. `None` when no table names it.
fn lookup_exact(name: &[u8]) -> Option<Flag> {
    if PER_PROCESS_LONG.binary_search(&name).is_ok() {
        return Some(Flag::PerProcess);
    }
    // The same table `process.execArgv`'s re-parser derives its value-consuming
    // set from, so the two agree on what `bun <entrypoint>` accepts.
    if let Some(param) = AUTO_PARAMS
        .iter()
        .find(|param| param.names.matches_long(name))
    {
        return Some(Flag::Supported(param.takes_value));
    }
    if NODE_ONLY_BOOLEAN.binary_search(&name).is_ok() {
        return Some(Flag::Supported(Values::None));
    }
    if NODE_ONLY_WITH_VALUE.binary_search(&name).is_ok() {
        return Some(Flag::Supported(Values::One));
    }
    None
}

/// [`lookup_long`] with `_` already canonicalised to `-`.
fn lookup_canonical_long(name: &[u8]) -> Flag {
    if let Some(flag) = lookup_exact(name) {
        return flag;
    }
    // Node registers one canonical name per boolean option and derives the
    // other spelling from it, so `--x` and `--no-x` both name a boolean `x`.
    // It strips `no-` exactly once, which leaves `--no-no-x` naming nothing.
    if let Some(base) = name.strip_prefix(b"no-".as_slice()) {
        if base.starts_with(b"no-") {
            return Flag::Unknown;
        }
        return match lookup_exact(base) {
            Some(Flag::Supported(Values::None)) => Flag::Supported(Values::None),
            Some(Flag::Supported(_)) => Flag::InvalidNegation,
            _ => Flag::Unknown,
        };
    }
    // The tables carry the documented spelling of each boolean, which for a
    // default-true option is the negative one (`--no-warnings`). Derive the
    // positive spelling Node also accepts.
    let mut negated = Vec::with_capacity("no-".len() + name.len());
    negated.extend_from_slice(b"no-");
    negated.extend_from_slice(name);
    if matches!(lookup_exact(&negated), Some(Flag::Supported(Values::None))) {
        return Flag::Supported(Values::None);
    }
    Flag::Unknown
}

/// Classify a short flag by the character after `-`.
fn lookup_short(name: u8) -> Flag {
    if PER_PROCESS_SHORT.contains(&name) {
        return Flag::PerProcess;
    }
    if let Some(param) = AUTO_PARAMS
        .iter()
        .find(|param| param.names.short == Some(name))
    {
        return Flag::Supported(param.takes_value);
    }
    if NODE_ONLY_SHORT_WITH_VALUE.contains(&name) {
        return Flag::Supported(Values::One);
    }
    Flag::Unknown
}

/// The entries Node would name in `ERR_WORKER_INVALID_EXEC_ARGV`, in order.
/// Empty when `exec_argv` is acceptable.
fn invalid_entries(exec_argv: &[&[u8]]) -> Vec<Vec<u8>> {
    // Node reports parse errors (a flag missing its value) in preference to
    // unrecognised flags, and reports all of whichever list it picks.
    let mut errors: Vec<Vec<u8>> = Vec::new();
    let mut invalid: Vec<Vec<u8>> = Vec::new();

    let mut index = 0;
    while index < exec_argv.len() {
        let entry = exec_argv[index];
        index += 1;

        // Parsing stops at the first entry that is not a flag: `--`, `-`, the
        // empty string and any other positional leave the rest unvalidated.
        if entry.len() < 2 || entry[0] != b'-' || entry == b"--" {
            break;
        }

        let is_long = entry.starts_with(b"--");
        let (flag, inline_value) = if is_long {
            match entry.iter().position(|&byte| byte == b'=') {
                Some(eq) => (lookup_long(&entry[2..eq]), Some(&entry[eq + 1..])),
                None => (lookup_long(&entry[2..]), None),
            }
        } else {
            // `-r value`, `-r=value` and `-rvalue` all reach the same flag.
            let attached = (entry.len() > 2).then(|| &entry[2..]);
            (lookup_short(entry[1]), attached)
        };

        let requires_value = match flag {
            Flag::Unknown | Flag::PerProcess => {
                // Node does not know what an unusable flag's value looks like,
                // so it never consumes the following entry for one.
                invalid.push(entry.to_vec());
                continue;
            }
            Flag::InvalidNegation => {
                errors.push(message(
                    entry,
                    b" is an invalid negation because it is not a boolean option",
                ));
                continue;
            }
            Flag::Supported(values) => matches!(values, Values::One | Values::Many),
        };
        if !requires_value {
            continue;
        }

        match inline_value {
            // `--flag=` names no value at all.
            Some(value) => {
                if is_long && value.is_empty() {
                    errors.push(message(entry, b" requires an argument"));
                }
            }
            // The value is the next entry, but only when that entry is not
            // itself a flag.
            None => match exec_argv.get(index) {
                Some(next) if !next.starts_with(b"-") => index += 1,
                _ => errors.push(message(entry, b" requires an argument")),
            },
        }
    }

    if errors.is_empty() { invalid } else { errors }
}

fn message(entry: &[u8], suffix: &[u8]) -> Vec<u8> {
    let mut message = Vec::with_capacity(entry.len() + suffix.len());
    message.extend_from_slice(entry);
    message.extend_from_slice(suffix);
    message
}

/// Throw `ERR_WORKER_INVALID_EXEC_ARGV` when `exec_argv` names a flag Bun
/// cannot apply to a worker thread. Called from the `Worker` constructor
/// (`JSWorker.cpp`) before the strings are moved into `WorkerOptions`.
///
/// # Safety
/// `exec_argv` points at `len` live `WTF::StringImpl*` (the `Vector<String>`
/// the caller still owns) and `global` is the live global the constructor is
/// running on.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Worker__validateExecArgv(
    global: &JSGlobalObject,
    exec_argv: *const WTFStringImpl,
    len: usize,
) {
    if len == 0 {
        return;
    }
    // SAFETY: per fn contract — `len` live `WTF::StringImpl*` at `exec_argv`.
    let raw = unsafe { std::slice::from_raw_parts(exec_argv, len) };
    // Flag names are ASCII, but an entry may be a UTF-16 string, and an invalid
    // one is echoed back verbatim, so transcode every entry up front.
    let owned: Vec<Vec<u8>> = raw
        .iter()
        .map(|&string_impl| {
            if string_impl.is_null() {
                return Vec::new();
            }
            // SAFETY: per fn contract — `string_impl` is a live `WTF::StringImpl`.
            unsafe { &*string_impl }
                .to_owned_slice_z()
                .as_bytes()
                .to_vec()
        })
        .collect();
    let entries: Vec<&[u8]> = owned.iter().map(Vec::as_slice).collect();

    let invalid = invalid_entries(&entries);
    if invalid.is_empty() {
        return;
    }

    let flags = invalid.join(&b", "[..]);
    let _ = global
        .err(
            ErrorCode::WORKER_INVALID_EXEC_ARGV,
            format_args!(
                "Initiated Worker with invalid execArgv flags: {}",
                BStr::new(&flags)
            ),
        )
        .throw();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `invalid_entries` yields bytes; spell the expectations as text.
    fn bytes(expected: &[&str]) -> Vec<Vec<u8>> {
        expected
            .iter()
            .map(|entry| entry.as_bytes().to_vec())
            .collect()
    }

    #[test]
    fn flag_tables_are_sorted() {
        assert!(PER_PROCESS_LONG.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(NODE_ONLY_BOOLEAN.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(
            NODE_ONLY_WITH_VALUE
                .windows(2)
                .all(|pair| pair[0] < pair[1])
        );
    }

    #[test]
    fn classifies_long_flags() {
        // Bun's own flags, from AUTO_PARAMS.
        assert_eq!(lookup_long(b"no-addons"), Flag::Supported(Values::None));
        assert_eq!(lookup_long(b"smol"), Flag::Supported(Values::None));
        assert_eq!(lookup_long(b"conditions"), Flag::Supported(Values::Many));
        // Node flags Bun tolerates.
        assert_eq!(
            lookup_long(b"experimental-vm-modules"),
            Flag::Supported(Values::None)
        );
        assert_eq!(lookup_long(b"input-type"), Flag::Supported(Values::One));
        // Node's `--no-` negation of a boolean option.
        assert_eq!(
            lookup_long(b"no-experimental-vm-modules"),
            Flag::Supported(Values::None)
        );
        assert_eq!(lookup_long(b"no-conditions"), Flag::InvalidNegation);
        // Both spellings of a boolean, even when only one is documented.
        assert_eq!(lookup_long(b"warnings"), Flag::Supported(Values::None));
        assert_eq!(lookup_long(b"addons"), Flag::Supported(Values::None));
        assert_eq!(lookup_long(b"strip-types"), Flag::Supported(Values::None));
        // `no-` is stripped exactly once.
        assert_eq!(lookup_long(b"no-no-addons"), Flag::Unknown);
        // `_` is canonicalised to `-`.
        assert_eq!(lookup_long(b"no_warnings"), Flag::Supported(Values::None));
        assert_eq!(
            lookup_long(b"experimental_vm_modules"),
            Flag::Supported(Values::None)
        );
        assert_eq!(lookup_long(b"definitely_not_a_flag"), Flag::Unknown);
        // Per-process and unknown.
        assert_eq!(lookup_long(b"title"), Flag::PerProcess);
        assert_eq!(lookup_long(b"expose-gc"), Flag::PerProcess);
        assert_eq!(lookup_long(b"definitely-not-a-flag"), Flag::Unknown);
    }

    #[test]
    fn a_repeated_negation_does_not_recurse() {
        // `lookup_long` must not recurse per `no-`: a pathological entry has to
        // come back as an ordinary unrecognised flag, not a stack overflow.
        let name = b"no-".repeat(200_000);
        assert_eq!(lookup_long(&name), Flag::Unknown);
    }

    #[test]
    fn accepts_worker_safe_flags() {
        assert!(invalid_entries(&[]).is_empty());
        assert!(invalid_entries(&[b"--no-addons"]).is_empty());
        assert!(
            invalid_entries(&[b"--no-warnings", b"--no-deprecation", b"--tls-min-v1.2"]).is_empty()
        );
        assert!(invalid_entries(&[b"--conditions", b"react-server"]).is_empty());
        assert!(invalid_entries(&[b"--conditions=react-server"]).is_empty());
        assert!(invalid_entries(&[b"--inspect"]).is_empty());
        assert!(invalid_entries(&[b"-r", b"./preload.js"]).is_empty());
    }

    #[test]
    fn rejects_unknown_and_per_process_flags() {
        assert_eq!(
            invalid_entries(&[b"--definitely-not-a-flag"]),
            bytes(&["--definitely-not-a-flag"])
        );
        assert_eq!(invalid_entries(&[b"--title=x"]), bytes(&["--title=x"]));
        assert_eq!(
            invalid_entries(&[b"--max-old-space-size=64"]),
            bytes(&["--max-old-space-size=64"])
        );
        assert_eq!(invalid_entries(&[b"-x"]), bytes(&["-x"]));
        assert_eq!(
            invalid_entries(&[b"--definitely-not-a-flag", b"--also-not-a-flag"]),
            bytes(&["--definitely-not-a-flag", "--also-not-a-flag"])
        );
    }

    #[test]
    fn stops_at_the_first_positional() {
        assert!(invalid_entries(&[b"foo.js", b"--definitely-not-a-flag"]).is_empty());
        assert!(invalid_entries(&[b"--", b"--definitely-not-a-flag"]).is_empty());
        assert!(invalid_entries(&[b"-"]).is_empty());
        assert!(invalid_entries(&[b""]).is_empty());
        // An unusable flag's operand is a positional, as in Node.
        assert_eq!(
            invalid_entries(&[b"--title", b"x", b"--definitely-not-a-flag"]),
            bytes(&["--title"])
        );
    }

    #[test]
    fn a_flags_value_is_never_validated() {
        assert!(invalid_entries(&[b"--conditions", b"not-a-flag"]).is_empty());
        assert_eq!(
            invalid_entries(&[b"--conditions", b"foo", b"--definitely-not-a-flag"]),
            bytes(&["--definitely-not-a-flag"])
        );
    }

    #[test]
    fn reports_a_missing_value() {
        assert_eq!(
            invalid_entries(&[b"--conditions"]),
            bytes(&["--conditions requires an argument"])
        );
        assert_eq!(
            invalid_entries(&[b"--conditions="]),
            bytes(&["--conditions= requires an argument"])
        );
        // A value may not itself look like a flag.
        assert_eq!(
            invalid_entries(&[b"--conditions", b"--no-addons"]),
            bytes(&["--conditions requires an argument"])
        );
        // Parse errors win over unrecognised flags, as in Node.
        assert_eq!(
            invalid_entries(&[b"--definitely-not-a-flag", b"--conditions"]),
            bytes(&["--conditions requires an argument"])
        );
    }

    #[test]
    fn reports_an_invalid_negation() {
        assert_eq!(
            invalid_entries(&[b"--no-conditions"]),
            bytes(&["--no-conditions is an invalid negation because it is not a boolean option"])
        );
    }
}
