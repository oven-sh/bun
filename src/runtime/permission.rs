//! Node's permission model (`--permission`).
//!
//! Ported from `src/permission/` in nodejs/node v26.3.0:
//! <https://github.com/nodejs/node/blob/v26.3.0/src/permission/permission.cc>
//! <https://github.com/nodejs/node/blob/v26.3.0/src/permission/fs_permission.cc>
//!
//! The model is configured once from the CLI (`init_from_cli`) and afterwards
//! only ever narrowed by `process.permission.drop()`. Every enforcement site
//! goes through [`is_granted`] so the matching rules live in exactly one place.
//!
//! Node stores this state per `Environment`, so a `drop()` inside a worker only
//! affects that worker. Bun stores it per process: the CLI-supplied grants are
//! process-wide either way, but a `drop()` on a worker thread is visible to
//! every thread.

use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

use bun_core::ZigString;
use bun_jsc::{
    CallFrame, ErrorCode, JSFunction, JSGlobalObject, JSValue, JsError, JsResult, ZigStringJsc as _,
};

use crate::node::util::validators;

/// Fast path for every enforcement site: when `--permission` is absent this is
/// the only thing a check costs. Written once, before any JS runs.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// `--permission` was passed.
#[inline(always)]
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// The scopes Node's permission model knows about.
///
/// Mirrors `PERMISSIONS(V)` in
/// <https://github.com/nodejs/node/blob/v26.3.0/src/permission/permission_base.h>.
/// The name is what `process.permission.has()` accepts; the flag is what the
/// `ERR_ACCESS_DENIED` message tells the user to pass.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scope {
    FileSystem,
    FileSystemRead,
    FileSystemWrite,
    ChildProcess,
    Wasi,
    WorkerThreads,
    Inspector,
    Net,
    Addon,
}

impl Scope {
    /// The `PermissionScope` enum name Node puts on `err.permission`, e.g.
    /// `"FileSystemRead"` (`Permission::PermissionToString`).
    pub const fn permission_string(self) -> &'static str {
        match self {
            Scope::FileSystem => "FileSystem",
            Scope::FileSystemRead => "FileSystemRead",
            Scope::FileSystemWrite => "FileSystemWrite",
            Scope::ChildProcess => "ChildProcess",
            Scope::Wasi => "WASI",
            Scope::WorkerThreads => "WorkerThreads",
            Scope::Inspector => "Inspector",
            Scope::Net => "Net",
            Scope::Addon => "Addon",
        }
    }

    /// The CLI flag named in the `ERR_ACCESS_DENIED` message. `fs` has none
    /// (Node's table stores an empty string for it).
    pub const fn flag(self) -> &'static str {
        match self {
            Scope::FileSystem => "",
            Scope::FileSystemRead => "--allow-fs-read",
            Scope::FileSystemWrite => "--allow-fs-write",
            Scope::ChildProcess => "--allow-child-process",
            Scope::Wasi => "--allow-wasi",
            Scope::WorkerThreads => "--allow-worker",
            Scope::Inspector => "--allow-inspector",
            Scope::Net => "--allow-net",
            Scope::Addon => "--allow-addons",
        }
    }

    fn from_name(name: &[u8]) -> Option<Scope> {
        Some(match name {
            b"fs" => Scope::FileSystem,
            b"fs.read" => Scope::FileSystemRead,
            b"fs.write" => Scope::FileSystemWrite,
            b"child" => Scope::ChildProcess,
            b"wasi" => Scope::Wasi,
            b"worker" => Scope::WorkerThreads,
            b"inspector" => Scope::Inspector,
            b"net" => Scope::Net,
            b"addon" => Scope::Addon,
            _ => return None,
        })
    }
}

/// The grants for one filesystem direction (read or write).
///
/// Node keeps a radix tree plus the list of granted strings; the list is what
/// `RevokeAccess` matches against and the tree is rebuilt from it. The matching
/// rules the tree implements are reproduced by [`grant_covers`], so the list
/// alone is enough.
struct FsGrants {
    /// Resolved grants, each already passed through [`wildcard_if_dir`].
    granted: Vec<Vec<u8>>,
    /// No path is reachable, not even one in `granted` (which is then empty).
    deny_all: bool,
    /// `*` was granted.
    allow_all: bool,
}

impl FsGrants {
    const fn new() -> Self {
        Self {
            granted: Vec::new(),
            // Node starts both directions denied; a grant clears it.
            deny_all: true,
            allow_all: false,
        }
    }

    /// `FSPermission::GrantAccess`.
    fn grant(&mut self, resolved: Vec<u8>) {
        let path = wildcard_if_dir(resolved);
        if self.granted.iter().any(|g| *g == path) {
            return;
        }
        self.granted.push(path);
        self.deny_all = false;
    }

    /// `FSPermission::RevokeAccess`: only an *exact* match on the stored string
    /// is removed. Dropping a file that is merely covered by a granted
    /// directory is a no-op, matching Node.
    fn revoke(&mut self, resolved: Vec<u8>) {
        let path = wildcard_if_dir(resolved);
        let Some(idx) = self.granted.iter().position(|g| *g == path) else {
            return;
        };
        self.granted.remove(idx);
        // `FSPermission::RebuildTree`.
        if self.granted.is_empty() {
            self.deny_all = true;
        }
    }

    /// `FSPermission::Drop` with no reference.
    fn drop_all(&mut self) {
        self.granted.clear();
        self.deny_all = true;
        self.allow_all = false;
    }

    fn allow_everything(&mut self) {
        self.granted.clear();
        self.deny_all = false;
        self.allow_all = true;
    }

    /// `FSPermission::is_granted` for a non-empty reference.
    fn matches(&self, resolved: &[u8]) -> bool {
        if self.deny_all {
            return false;
        }
        if self.allow_all {
            return true;
        }
        self.granted.iter().any(|g| grant_covers(g, resolved))
    }
}

/// Whether the stored grant `grant` covers the resolved path `path`.
///
/// Reproduces `FSPermission::RadixTree::Lookup`: a `*` matches the whole
/// remainder of the path, and a grant stored as `dir/*` also covers the bare
/// `dir` (Lookup's `path_len >= parent_node_prefix_len - 2` case, where the 2
/// is the trailing separator and `*`).
fn grant_covers(grant: &[u8], path: &[u8]) -> bool {
    let Some(star) = grant.iter().position(|&c| c == b'*') else {
        return grant == path;
    };
    let base = &grant[..star];
    if path.starts_with(base) {
        return true;
    }
    // `dir/*` covers `dir`.
    match base.split_last() {
        Some((last, head)) if is_path_separator(*last) => head == path,
        _ => false,
    }
}

#[inline]
fn is_path_separator(c: u8) -> bool {
    c == b'/' || (cfg!(windows) && c == b'\\')
}

struct State {
    fs_read: FsGrants,
    fs_write: FsGrants,
    child: bool,
    worker: bool,
    inspector: bool,
    wasi: bool,
    net: bool,
    addon: bool,
    /// The `--allow-fs-*` flags that were passed exactly once with a value
    /// containing a comma, in the order Node checks them.
    comma_flags: Vec<&'static str>,
}

impl State {
    const fn new() -> Self {
        Self {
            fs_read: FsGrants::new(),
            fs_write: FsGrants::new(),
            child: false,
            worker: false,
            inspector: false,
            wasi: false,
            net: false,
            addon: false,
            comma_flags: Vec::new(),
        }
    }

    fn simple_scope_mut(&mut self, scope: Scope) -> Option<&mut bool> {
        Some(match scope {
            Scope::ChildProcess => &mut self.child,
            Scope::WorkerThreads => &mut self.worker,
            Scope::Inspector => &mut self.inspector,
            Scope::Wasi => &mut self.wasi,
            Scope::Net => &mut self.net,
            Scope::Addon => &mut self.addon,
            Scope::FileSystem | Scope::FileSystemRead | Scope::FileSystemWrite => return None,
        })
    }
}

static STATE: RwLock<State> = RwLock::new(State::new());

/// The CLI flags that configure the model. Collected by
/// `bun_runtime::cli::Arguments` so this module never parses argv itself.
pub struct CliGrants<'a> {
    pub fs_read: &'a [&'static [u8]],
    pub fs_write: &'a [&'static [u8]],
    pub child: bool,
    pub worker: bool,
    pub inspector: bool,
    pub wasi: bool,
    pub net: bool,
    pub addon: bool,
}

/// Turn on the permission model. Must run before any user JS.
pub fn init_from_cli(grants: &CliGrants<'_>) {
    let mut st = State::new();
    apply_fs(&mut st.fs_read, grants.fs_read);
    apply_fs(&mut st.fs_write, grants.fs_write);
    st.child = grants.child;
    st.worker = grants.worker;
    st.inspector = grants.inspector;
    st.wasi = grants.wasi;
    st.net = grants.net;
    st.addon = grants.addon;
    for (values, flag) in [
        (grants.fs_read, "--allow-fs-read"),
        (grants.fs_write, "--allow-fs-write"),
    ] {
        // Node only warns when the flag was given once and that single value
        // contains a comma — the shape of the pre-v20.16 comma-separated list.
        if values.len() == 1 && values[0].contains(&b',') {
            st.comma_flags.push(flag);
        }
    }

    match STATE.write() {
        Ok(mut guard) => *guard = st,
        // A poisoned lock this early means a panic already unwound through a
        // permission check; refuse to run rather than run unsandboxed.
        Err(_) => bun_core::Output::panic(format_args!("permission model state is unrecoverable")),
    }
    ENABLED.store(true, Ordering::Release);
}

/// `FSPermission::Apply`.
fn apply_fs(grants: &mut FsGrants, values: &[&'static [u8]]) {
    for value in values {
        if *value == b"*" {
            grants.allow_everything();
            return;
        }
        grants.grant(resolve_against_cwd(value));
    }
}

/// The predicate every enforcement site and `process.permission.has()` goes
/// through. `reference` is a path for the `fs.*` scopes and ignored otherwise.
pub fn is_granted(scope: Scope, reference: Option<&[u8]>) -> bool {
    if !is_enabled() {
        // Without `--permission` everything is permitted, which is also what
        // Node reports (`process.permission` does not even exist there).
        return true;
    }
    let Ok(st) = STATE.read() else {
        // Fail closed: a poisoned lock means we cannot prove the access is
        // allowed.
        return false;
    };
    match scope {
        // Node: `has('fs')` is true only when both directions are fully open.
        Scope::FileSystem => st.fs_read.allow_all && st.fs_write.allow_all,
        Scope::FileSystemRead => match reference {
            None => st.fs_read.allow_all,
            Some(reference) => st.fs_read.matches(&resolve_against_cwd(reference)),
        },
        Scope::FileSystemWrite => match reference {
            None => st.fs_write.allow_all,
            Some(reference) => st.fs_write.matches(&resolve_against_cwd(reference)),
        },
        Scope::ChildProcess => st.child,
        Scope::WorkerThreads => st.worker,
        Scope::Inspector => st.inspector,
        Scope::Wasi => st.wasi,
        Scope::Net => st.net,
        Scope::Addon => st.addon,
    }
}

/// `process.permission.drop()`.
fn drop_scope(scope: Scope, reference: Option<&[u8]>) {
    if !is_enabled() {
        return;
    }
    let Ok(mut st) = STATE.write() else {
        return;
    };
    let reference = reference.filter(|r| !r.is_empty());
    match (scope, reference) {
        (Scope::FileSystem, None) => {
            st.fs_read.drop_all();
            st.fs_write.drop_all();
        }
        (Scope::FileSystemRead, None) => st.fs_read.drop_all(),
        (Scope::FileSystemWrite, None) => st.fs_write.drop_all(),
        (Scope::FileSystem, Some(reference)) => {
            let resolved = resolve_against_cwd(reference);
            // Node skips the revoke when `*` was granted: with `*` you can only
            // drop `*`.
            if !st.fs_read.allow_all {
                st.fs_read.revoke(resolved.clone());
            }
            if !st.fs_write.allow_all {
                st.fs_write.revoke(resolved);
            }
        }
        (Scope::FileSystemRead, Some(reference)) => {
            if !st.fs_read.allow_all {
                let resolved = resolve_against_cwd(reference);
                st.fs_read.revoke(resolved);
            }
        }
        (Scope::FileSystemWrite, Some(reference)) => {
            if !st.fs_write.allow_all {
                let resolved = resolve_against_cwd(reference);
                st.fs_write.revoke(resolved);
            }
        }
        (scope, _) => {
            if let Some(slot) = st.simple_scope_mut(scope) {
                *slot = false;
            }
        }
    }
}

/// `path.resolve(reference)`. Grants and lookups are both stored resolved so
/// relative and absolute spellings of the same path compare equal.
fn resolve_against_cwd(input: &[u8]) -> Vec<u8> {
    // `resolve_*_t` needs a destination plus a scratch buffer, each large
    // enough for the cwd plus the input.
    let cap = bun_core::MAX_PATH_BYTES + input.len() + 2;
    let mut buf = vec![0u8; cap];
    let mut scratch = vec![0u8; cap];
    #[cfg(windows)]
    let resolved = crate::node::path::resolve_windows_t::<u8>(&[input], &mut buf, &mut scratch);
    #[cfg(not(windows))]
    let resolved = crate::node::path::resolve_posix_t::<u8>(&[input], &mut buf, &mut scratch);
    match resolved {
        Ok(slice) => slice.to_vec(),
        // A path we cannot resolve is stored/looked up verbatim; it then only
        // matches an identical spelling, which is the conservative outcome.
        Err(_) => input.to_vec(),
    }
}

/// `WildcardIfDir`: a grant naming an existing directory covers everything
/// beneath it, which Node encodes by appending `/*` to the stored string.
fn wildcard_if_dir(mut resolved: Vec<u8>) -> Vec<u8> {
    if !is_existing_directory(&resolved) {
        return resolved;
    }
    if !resolved.last().is_some_and(|c| is_path_separator(*c)) {
        resolved.push(bun_core::SEP);
    }
    resolved.push(b'*');
    resolved
}

fn is_existing_directory(path: &[u8]) -> bool {
    if path.contains(&0) {
        return false;
    }
    let mut owned = Vec::with_capacity(path.len() + 1);
    owned.extend_from_slice(path);
    owned.push(0);
    match bun_sys::stat(bun_core::ZStr::from_slice_with_nul(&owned)) {
        Ok(stat) => bun_sys::S::ISDIR(stat.st_mode as _),
        Err(_) => false,
    }
}

/// Build the `ERR_ACCESS_DENIED` Node raises for a denied access, including the
/// `permission` and `resource` own properties
/// (`permission::CreateAccessDeniedError`).
pub fn access_denied_error(global: &JSGlobalObject, scope: Scope, resource: &[u8]) -> JSValue {
    let flag = scope.flag();
    let error = if flag.is_empty() {
        ErrorCode::ERR_ACCESS_DENIED.fmt(
            global,
            format_args!("Access to this API has been restricted. "),
        )
    } else {
        ErrorCode::ERR_ACCESS_DENIED.fmt(
            global,
            format_args!(
                "Access to this API has been restricted. Use {flag} to manage permissions."
            ),
        )
    };
    error.put(
        global,
        b"permission",
        ZigString::from_utf8(scope.permission_string().as_bytes()).to_js(global),
    );
    error.put(
        global,
        b"resource",
        ZigString::from_utf8(resource).to_js(global),
    );
    error
}

/// [`access_denied_error`], thrown.
pub fn throw_access_denied(global: &JSGlobalObject, scope: Scope, resource: &[u8]) -> JsError {
    global.throw_value(access_denied_error(global, scope, resource))
}

// ── The warnings Node prints at startup ─────────────────────────────────────

/// `initializePermission` in `lib/internal/process/pre_execution.js`. Called
/// once, after the global object exists, before the entry point runs.
pub fn emit_startup_warnings(global: &JSGlobalObject) {
    if !is_enabled() {
        return;
    }
    let (bypass_flags, net_granted, comma_flags) = {
        let Ok(st) = STATE.read() else {
            return;
        };
        // Order matches Node's `warnFlags`. `--allow-ffi` is omitted: Bun does
        // not build with `node_use_ffi`, so Node would not warn for it either.
        (
            [
                (st.addon, "--allow-addons"),
                (st.child, "--allow-child-process"),
                (st.inspector, "--allow-inspector"),
                (st.wasi, "--allow-wasi"),
                (st.worker, "--allow-worker"),
            ],
            st.net,
            st.comma_flags.clone(),
        )
    };

    for (granted, flag) in &bypass_flags {
        if !*granted {
            continue;
        }
        warn(
            global,
            &format!(
                "The flag {flag} must be used with extreme caution. It could invalidate the permission model."
            ),
            "SecurityWarning",
        );
    }

    for flag in &comma_flags {
        warn(
            global,
            &format!(
                "The {flag} CLI flag has changed. Passing a comma-separated list of paths is no longer valid. Documentation can be found at https://nodejs.org/api/permissions.html#file-system-permissions"
            ),
            "Warning",
        );
    }

    if net_granted {
        warn(
            global,
            "The flag --allow-net is under experimental phase.",
            "ExperimentalWarning",
        );
    }
}

fn warn(global: &JSGlobalObject, message: &str, kind: &str) {
    let message = ZigString::from_utf8(message.as_bytes()).to_js(global);
    let kind = ZigString::from_utf8(kind.as_bytes()).to_js(global);
    let _ = global.emit_warning(message, kind, JSValue::UNDEFINED, JSValue::UNDEFINED);
}

// ── `process.permission` ────────────────────────────────────────────────────

/// Read the `(scope, reference)` pair both `has()` and `drop()` take, applying
/// the `validateString` checks from `internal/process/permission`.
fn scope_and_reference(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<(Option<Scope>, Option<bun_core::ZigStringSlice>)> {
    let [scope_arg, reference_arg] = frame.arguments_as_array::<2>();
    validators::validate_string(global, scope_arg, "scope")?;
    let scope_slice = scope_arg.to_slice(global)?;
    let scope = Scope::from_name(scope_slice.slice());

    if reference_arg.is_undefined_or_null() {
        return Ok((scope, None));
    }
    validators::validate_string(global, reference_arg, "reference")?;
    let reference = reference_arg.to_slice(global)?;
    Ok((scope, Some(reference)))
}

/// `process.permission` — only defined when `--permission` is on, matching
/// Node's `ObjectDefineProperty` in `initializePermission`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Permission__createObject(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn(export = "Bun__Permission__has")]
    fn has(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let (scope, reference) = scope_and_reference(global, frame)?;
        // An unknown scope is `kPermissionsRoot`, which Node reports as denied.
        let Some(scope) = scope else {
            return Ok(JSValue::FALSE);
        };
        Ok(match reference {
            // Node returns false for an empty reference string rather than
            // treating it as "no reference".
            Some(reference) if reference.slice().is_empty() => JSValue::FALSE,
            Some(reference) => JSValue::from(is_granted(scope, Some(reference.slice()))),
            None => JSValue::from(is_granted(scope, None)),
        })
    }

    #[bun_jsc::host_fn(export = "Bun__Permission__drop")]
    fn drop_fn(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let (scope, reference) = scope_and_reference(global, frame)?;
        if let Some(scope) = scope {
            drop_scope(scope, reference.as_ref().map(|r| r.slice()));
        }
        Ok(JSValue::UNDEFINED)
    }

    let object = JSValue::create_empty_object(global, 2);
    object.put(
        global,
        b"has",
        JSFunction::create(global, "has", __jsc_host_has, 2, Default::default()),
    );
    object.put(
        global,
        b"drop",
        JSFunction::create(global, "drop", __jsc_host_drop_fn, 2, Default::default()),
    );
    object
}

/// `$rust("permission.rs", "isPermissionModelEnabled")` — captured once when a
/// builtin module loads so the common path is a single boolean test.
pub(crate) fn is_permission_model_enabled(_global: &JSGlobalObject) -> JSValue {
    JSValue::from(is_enabled())
}

/// `$newRustFunction("permission.rs", "netAccessDeniedError", 1)` — the error
/// object for a denied outbound connection, or `undefined` when net is
/// granted.
///
/// Node's `ERR_ACCESS_DENIED_IF_INSUFFICIENT_PERMISSIONS` in `tcp_wrap.cc`
/// *returns* the error instead of throwing it, so `net.js` can wrap it in
/// `ExceptionWithHostPort`; this keeps that shape.
pub(crate) fn net_access_denied_error(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    if is_granted(Scope::Net, None) {
        return Ok(JSValue::UNDEFINED);
    }
    let [resource] = frame.arguments_as_array::<1>();
    let resource = if resource.is_undefined_or_null() {
        None
    } else {
        Some(resource.to_slice(global)?)
    };
    Ok(access_denied_error(
        global,
        Scope::Net,
        resource.as_ref().map_or(&[][..], |r| r.slice()),
    ))
}

/// Read by `BunProcess.cpp` to decide whether to define `process.permission`
/// and whether `process.binding()` is denied.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Permission__isEnabled() -> bool {
    is_enabled()
}

/// `process.binding()` is denied outright under `--permission`
/// (`initializePermission` replaces it with `new ERR_ACCESS_DENIED('process.binding')`,
/// whose message is the API name and whose extra properties are empty).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Permission__throwProcessBindingDenied(global: &JSGlobalObject) {
    let error = ErrorCode::ERR_ACCESS_DENIED.fmt(global, format_args!("process.binding"));
    let empty = ZigString::from_utf8(b"").to_js(global);
    error.put(global, b"permission", empty);
    error.put(global, b"resource", empty);
    let _ = global.throw_value(error);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_covers_matches_node_radix_tree() {
        // Exact grants match only themselves.
        assert!(grant_covers(b"/a/b.txt", b"/a/b.txt"));
        assert!(!grant_covers(b"/a/b.txt", b"/a/b.txt2"));
        assert!(!grant_covers(b"/a/b.txt", b"/a"));

        // A directory grant covers its contents and the directory itself.
        assert!(grant_covers(b"/a/*", b"/a/b.txt"));
        assert!(grant_covers(b"/a/*", b"/a/b/c.txt"));
        assert!(grant_covers(b"/a/*", b"/a"));
        assert!(!grant_covers(b"/a/*", b"/ab"));
        assert!(!grant_covers(b"/a/*", b"/b"));
    }

    #[test]
    fn dropping_a_file_inside_a_granted_directory_is_a_no_op() {
        let mut grants = FsGrants::new();
        // Stand in for `/granted` having been an existing directory at grant
        // time, which is what makes the stored grant end in `/*`.
        grants.granted.push(b"/granted/*".to_vec());
        grants.deny_all = false;

        grants.revoke(b"/granted/item1.txt".to_vec());
        assert!(grants.matches(b"/granted/item1.txt"));

        grants.revoke(b"/granted/*".to_vec());
        assert!(!grants.matches(b"/granted/item1.txt"));
        assert!(grants.deny_all);
    }
}
