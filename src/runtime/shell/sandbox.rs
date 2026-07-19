//! Sandbox policy for `Bun.$` (`$.sandbox({...})`).
//!
//! A `SandboxPolicy` is parsed from the JS options object once per
//! invocation (`ParsedShellScript.setSandbox`) and moved onto the
//! [`Interpreter`](crate::shell::Interpreter), where every state node can
//! reach it. Enforcement happens inside the interpreter, before any effect:
//!
//! - **Commands**: only shell builtins may run (external binaries never
//!   spawn), filtered further by `commands.allow` / `commands.deny`
//!   (checked in `Cmd::transition_to_exec`). The available builtin set is
//!   the same as for an unsandboxed shell (`Kind::from_argv0`, including its
//!   POSIX gating of cat/cp); allow/deny entries are validated against the
//!   full name table so policies stay portable across platforms.
//! - **Filesystem**: every path a builtin, redirect, glob walk, or `[[ -f x ]]`
//!   test touches is resolved against the shell's cwd, symlink-resolved via
//!   `realpath` of its deepest existing ancestor, and prefix-matched against
//!   `fs.read` / `fs.write`. A `fs.write` prefix implies read access.
//! - **Limits**: `limits.timeout` arms an `EventLoopTimer` and a wall-clock
//!   deadline checked at interpreter step boundaries; `limits.maxOutputBytes`
//!   is counted at the two output choke points (`Builtin::write_no_io` and
//!   `IOWriter::enqueue`).
//!
//! Path checks run on the JS thread at the point where a path argument is
//! consumed (builtin start / redirect open / glob-walk creation), not inside
//! worker-pool traversal. Traversal stays underneath a checked root because
//! neither `ls -R` (dirent kind) nor `rm -r` (`O_NOFOLLOW`) nor the glob
//! walker (`follow_symlinks = false`) follows symlinks, and `cp` flags that
//! would follow source symlinks during traversal (`-L`/`-H`) are rejected in
//! sandboxed shells.

use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::shell::builtin::Kind;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SandboxAccess {
    Read,
    Write,
}

impl SandboxAccess {
    pub fn verb(self) -> &'static str {
        match self {
            SandboxAccess::Read => "read",
            SandboxAccess::Write => "write",
        }
    }
}

/// Reason a sandboxed run was aborted before normal completion.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SandboxFault {
    Timeout,
    OutputLimit,
}

pub struct SandboxPolicy {
    /// Bit `Kind as u8` set ⇒ that builtin may run.
    allowed_builtins: u32,
    /// Canonicalized absolute prefixes (no trailing separator except a bare
    /// filesystem root).
    read_prefixes: Vec<Box<[u8]>>,
    write_prefixes: Vec<Box<[u8]>>,
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<u64>,
}

const ALL_BUILTINS_MASK: u32 = {
    assert!(Kind::ALL_NAMES.len() <= 32);
    (1u32 << Kind::ALL_NAMES.len()) - 1
};

impl SandboxPolicy {
    #[inline]
    pub fn builtin_allowed(&self, kind: Kind) -> bool {
        self.allowed_builtins & (1u32 << (kind as u8)) != 0
    }

    /// `true` when `path` (absolute, or relative to `cwd`) is within the
    /// policy's prefixes for `access`. Write prefixes also grant read.
    pub fn check_path(&self, cwd: &[u8], path: &[u8], access: SandboxAccess) -> bool {
        let canonical = canonicalize_path(cwd, path);
        let write_ok = self
            .write_prefixes
            .iter()
            .any(|p| prefix_matches(p, &canonical));
        match access {
            SandboxAccess::Write => write_ok,
            SandboxAccess::Read => {
                write_ok
                    || self
                        .read_prefixes
                        .iter()
                        .any(|p| prefix_matches(p, &canonical))
            }
        }
    }

    /// Parse the normalized options object produced by `$.sandbox()` in
    /// `shell.ts`. Throws a TypeError on anything malformed so a bad policy
    /// never half-applies.
    pub fn from_js(global: &JSGlobalObject, options: JSValue) -> JsResult<Box<SandboxPolicy>> {
        if !options.is_object() {
            return Err(
                global.throw_invalid_arguments(format_args!("sandbox: expected an options object"))
            );
        }

        let mut policy = Box::new(SandboxPolicy {
            allowed_builtins: ALL_BUILTINS_MASK,
            read_prefixes: Vec::new(),
            write_prefixes: Vec::new(),
            timeout_ms: None,
            max_output_bytes: None,
        });

        if let Some(commands) = options.get(global, "commands")? {
            if !commands.is_object() {
                return Err(global
                    .throw_invalid_arguments(format_args!("sandbox: commands must be an object")));
            }
            if let Some(allow) = commands.get(global, "allow")? {
                policy.allowed_builtins = parse_command_mask(global, allow, "commands.allow")?;
            }
            if let Some(deny) = commands.get(global, "deny")? {
                policy.allowed_builtins &= !parse_command_mask(global, deny, "commands.deny")?;
            }
        }

        if let Some(fs) = options.get(global, "fs")? {
            if !fs.is_object() {
                return Err(
                    global.throw_invalid_arguments(format_args!("sandbox: fs must be an object"))
                );
            }
            if let Some(read) = fs.get(global, "read")? {
                policy.read_prefixes = parse_path_prefixes(global, read, "fs.read")?;
            }
            if let Some(write) = fs.get(global, "write")? {
                policy.write_prefixes = parse_path_prefixes(global, write, "fs.write")?;
            }
        }

        if let Some(network) = options.get(global, "network")? {
            if !network.is_boolean() {
                return Err(global
                    .throw_invalid_arguments(format_args!("sandbox: network must be a boolean")));
            }
            if network.to_boolean() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "sandbox: network access cannot be enabled yet; sandboxed shells run only builtin commands, none of which perform network I/O. The only supported value is false."
                )));
            }
        }

        if let Some(limits) = options.get(global, "limits")? {
            if !limits.is_object() {
                return Err(global
                    .throw_invalid_arguments(format_args!("sandbox: limits must be an object")));
            }
            if let Some(timeout) = limits.get(global, "timeout")? {
                policy.timeout_ms = Some(parse_positive_int(global, timeout, "limits.timeout")?);
            }
            if let Some(max_output) = limits.get(global, "maxOutputBytes")? {
                policy.max_output_bytes = Some(parse_positive_int(
                    global,
                    max_output,
                    "limits.maxOutputBytes",
                )?);
            }
        }

        Ok(policy)
    }

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<SandboxPolicy>()
            + self
                .read_prefixes
                .iter()
                .chain(self.write_prefixes.iter())
                .map(|p| p.len())
                .sum::<usize>()
    }
}

fn parse_command_mask(global: &JSGlobalObject, list: JSValue, what: &str) -> JsResult<u32> {
    let mut iter = list.array_iterator(global).map_err(|_| {
        global.throw_invalid_arguments(format_args!("sandbox: {what} must be an array of strings"))
    })?;
    let mut mask = 0u32;
    while let Some(item) = iter.next()? {
        if !item.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "sandbox: {what} must be an array of strings"
            )));
        }
        let name = item.get_zig_string(global)?.to_owned_slice();
        match Kind::from_argv0_raw(&name) {
            Some(kind) => mask |= 1u32 << (kind as u8),
            None => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "sandbox: unknown command {:?} in {what}. Sandboxed shells can only run builtin commands: {}",
                    bstr::BStr::new(&name),
                    Kind::ALL_NAMES.join(", "),
                )));
            }
        }
    }
    Ok(mask)
}

fn parse_path_prefixes(
    global: &JSGlobalObject,
    list: JSValue,
    what: &str,
) -> JsResult<Vec<Box<[u8]>>> {
    let mut iter = list.array_iterator(global).map_err(|_| {
        global.throw_invalid_arguments(format_args!("sandbox: {what} must be an array of strings"))
    })?;
    let mut prefixes: Vec<Box<[u8]>> = Vec::with_capacity(iter.len as usize);
    while let Some(item) = iter.next()? {
        if !item.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "sandbox: {what} must be an array of strings"
            )));
        }
        let path = item.get_zig_string(global)?.to_owned_slice();
        if path.is_empty() || !bun_paths::is_absolute(&path) {
            return Err(global.throw_invalid_arguments(format_args!(
                "sandbox: {what} paths must be absolute, got {:?}",
                bstr::BStr::new(&path),
            )));
        }
        if path.contains(&0) {
            return Err(global.throw_invalid_arguments(format_args!(
                "sandbox: {what} paths must not contain NUL bytes"
            )));
        }
        // Canonicalize now so symlinked prefixes compare equal to the
        // canonical paths produced by `check_path` at enforcement time.
        prefixes.push(canonicalize_path(b"/", &path).into_boxed_slice());
    }
    Ok(prefixes)
}

fn parse_positive_int(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<u64> {
    if !value.is_number() {
        return Err(
            global.throw_invalid_arguments(format_args!("sandbox: {what} must be a number"))
        );
    }
    let n = value.as_number();
    if !n.is_finite() || n <= 0.0 || n.fract() != 0.0 || n > u64::MAX as f64 {
        return Err(global
            .throw_invalid_arguments(format_args!("sandbox: {what} must be a positive integer")));
    }
    Ok(n as u64)
}

/// Resolve `path` against `cwd` (`path.resolve` semantics: `.`/`..`
/// collapsed, absolute `path` wins), then resolve symlinks by `realpath`-ing
/// the deepest existing ancestor and re-appending the non-existing suffix.
/// Returns an absolute path with no trailing separator (except a bare root).
///
/// Symlink resolution is what defeats `ln -s /etc escape; cat escape/passwd`
/// style escapes: the comparison always happens on the physical path.
pub fn canonicalize_path(cwd: &[u8], path: &[u8]) -> Vec<u8> {
    use bun_paths::resolve_path as rp;

    let resolved: Vec<u8> = rp::join_abs_string_z::<rp::platform::Auto>(cwd, &[path])
        .as_bytes()
        .to_vec();
    let resolved = strip_trailing_sep(resolved);

    let mut zbuf = bun_paths::path_buffer_pool::get();
    let mut realbuf = bun_paths::path_buffer_pool::get();

    let root_len = filesystem_root_len(&resolved);
    let mut end = resolved.len();
    loop {
        let z = rp::z(&resolved[..end], &mut zbuf);
        match bun_sys::realpath(z, &mut realbuf) {
            Ok(real) => {
                let mut out = real.to_vec();
                if end < resolved.len() {
                    // `resolved[end]` is the separator we cut at.
                    if out.last().is_some_and(|&c| is_sep(c)) {
                        out.pop();
                    }
                    out.extend_from_slice(&resolved[end..]);
                }
                return strip_trailing_sep(out);
            }
            Err(_) => {
                // Strip the last component and retry on the parent.
                let parent_end = match resolved[..end].iter().rposition(|&c| is_sep(c)) {
                    Some(i) if i >= root_len => i,
                    _ => return resolved,
                };
                if parent_end < root_len.max(1) {
                    return resolved;
                }
                end = parent_end;
            }
        }
    }
}

fn filesystem_root_len(path: &[u8]) -> usize {
    if cfg!(windows) {
        bun_paths::resolve_path::windows_filesystem_root(path).len()
    } else {
        1
    }
}

#[inline]
fn is_sep(c: u8) -> bool {
    if cfg!(windows) {
        c == b'/' || c == b'\\'
    } else {
        c == b'/'
    }
}

fn strip_trailing_sep(mut path: Vec<u8>) -> Vec<u8> {
    let root_len = filesystem_root_len(&path).max(1);
    while path.len() > root_len && path.last().is_some_and(|&c| is_sep(c)) {
        path.pop();
    }
    path
}

/// Case sensitivity follows the platform default filesystem, matching
/// `bun_paths::resolve_path::is_parent_or_equal`.
#[inline]
fn path_bytes_eq(a: &[u8], b: &[u8]) -> bool {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        strings::eql(a, b)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        strings::eql_case_insensitive_ascii_check_length(a, b)
    }
}

fn prefix_matches(prefix: &[u8], canonical: &[u8]) -> bool {
    if prefix.is_empty() || canonical.len() < prefix.len() {
        return false;
    }
    if !path_bytes_eq(&canonical[..prefix.len()], prefix) {
        return false;
    }
    canonical.len() == prefix.len()
        // A prefix that still ends in a separator is a bare filesystem root.
        || is_sep(prefix[prefix.len() - 1])
        || is_sep(canonical[prefix.len()])
}
