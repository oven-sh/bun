//! Node's permission model (`--permission`) — ported from
//! <https://github.com/nodejs/node/blob/v26.3.0/src/permission/>. Node stores
//! state per-`Environment`; Bun stores it per-process, so `drop()` is global.

use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::ZigString;
use bun_jsc::{
    CallFrame, ErrorCode, JSFunction, JSGlobalObject, JSValue, JsError, JsResult, ZigStringJsc as _,
};
use bun_threading::RwLock;

use crate::node::util::validators;

/// Fast path for every enforcement site: when `--permission` is absent this is
/// the only thing a check costs. Written once, before any JS runs.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// `--permission` was passed.
#[inline(always)]
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Mirrors `PERMISSIONS(V)` in
/// <https://github.com/nodejs/node/blob/v26.3.0/src/permission/permission_base.h>.
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

/// Grants for one fs direction. Node keeps a radix tree + the grant list (for
/// `RevokeAccess`); [`grant_covers`] reproduces the tree's matching, so the
/// list alone suffices: <https://github.com/nodejs/node/blob/v26.3.0/src/permission/fs_permission.cc>.
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
        if self.granted.contains(&path) {
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

/// Reproduces `FSPermission::RadixTree::Lookup`: `*` matches the rest of the
/// path, and `dir/*` also covers bare `dir` (its `path_len >= prefix_len - 2`
/// case). <https://github.com/nodejs/node/blob/v26.3.0/src/permission/fs_permission.cc>
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

    *STATE.write() = st;
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
    let st = STATE.read();
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
    let mut st = STATE.write();
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

/// Deny `scope` for `resource` unless it is granted. `resource` is the path
/// being accessed; it is echoed back on the error the way Node does.
#[inline]
pub fn check(global: &JSGlobalObject, scope: Scope, resource: &[u8]) -> Result<(), JsError> {
    if is_granted(scope, Some(resource)) {
        return Ok(());
    }
    Err(throw_access_denied(global, scope, resource))
}

// ── The warnings Node prints at startup ─────────────────────────────────────

/// `initializePermission` in `lib/internal/process/pre_execution.js`. Called
/// once, after the global object exists, before the entry point runs.
pub fn emit_startup_warnings(global: &JSGlobalObject) {
    if !is_enabled() {
        return;
    }
    let (bypass_flags, net_granted, comma_flags) = {
        let st = STATE.read();
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

/// `netAccessDeniedError` — error for a denied connection, or `undefined` when
/// net is granted. Returned (not thrown) so `net.js` can wrap it in
/// `ExceptionWithHostPort`: <https://github.com/nodejs/node/blob/main/src/tcp_wrap.cc>.
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
