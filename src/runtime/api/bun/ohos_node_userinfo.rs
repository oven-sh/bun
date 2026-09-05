//! HarmonyOS-only. Gives a spawned `node` child (and its `#!/usr/bin/env
//! node` shebang siblings: npm/npx/corepack/yarn/pnpm/pnpx) a working
//! `os.userInfo()`.
//!
//! The vendored ohos-compat-shim linked into *this* executable
//! (`scripts/build/shims.ts`'s `needsOhosCompatShim`, workarounds.ts's
//! `ohos-compat-shim-embed`) interposes `getpwuid_r` for calls that resolve
//! through bun's own dynamic symbol table. That only covers code running
//! *inside this process* (and native modules it dlopens) — an exec'd `node`
//! child gets the real musl libc, and HarmonyOS app-sandbox uids (2002xxxx)
//! have no `/etc/passwd` entry, so `os.userInfo()` throws
//! `ERR_SYSTEM_ERROR: uv_os_get_passwd returned ENOENT`. Node reads no
//! environment variable on that path, so there is no way to fix this by
//! setting a variable node already understands.
//!
//! Fix: when a spawned child's resolved argv0 looks like node, materialize a
//! tiny CJS preload on disk once per process and append `--require <path>`
//! to the child's `NODE_OPTIONS`, passing this process's shim-resolved
//! username through `BUN_OHOS_USERNAME`. Deliberately NOT `bun`'s own value
//! — `bun`'s `os.userInfo()` (`node_os.rs`) only reads `$USER`, which is
//! empty on a `bun build --compile` output shipped to a fresh device with no
//! shell profile; `getpwuid_r` via the embedded shim is the only source that
//! survives that trip.
//!
//! Every failure mode here is fail-open: no writable directory, a failed
//! write, a failed username lookup — any of it means inject nothing, and the
//! child behaves exactly as it does today. The one thing this file must
//! never do is make `node` fail to start (a `--require` pointing at a
//! missing file is instant death for the child), so paths are content-hash
//! named (existence ⇒ correctness, no separate integrity check needed) and
//! every spawn re-checks with a plain `access()` rather than trusting a
//! cached "we already wrote it" flag.
//!
//! Registered in `scripts/build/workarounds.ts` as
//! `ohos-node-userinfo-preload` (separate entry from `ohos-compat-shim-embed`
//! — the cleanup actions don't overlap).

use core::ffi::{CStr, c_char};

use bun_core::{Once, ZBox, env_var};
use bun_sys as sys;

// ─────────────────────────────────────────────────────────────────────────
// The preload itself
// ─────────────────────────────────────────────────────────────────────────

/// Probe-then-fallback, matching ohos-compat-shim's own design: the real
/// `os.userInfo()` is tried first and the patch only installs when it
/// actually throws, so this file is an exact no-op anywhere the syscall
/// already works (a non-OHOS `NODE_OPTIONS` leak, a future OS fix, a
/// container where the sandbox uid happens to resolve).
const PRELOAD_JS: &str = r#""use strict";
// Injected by bun on HarmonyOS — see src/runtime/api/bun/ohos_node_userinfo.rs.
// Node's os.userInfo() goes straight to uv_os_get_passwd -> getpwuid_r(),
// which has no /etc/passwd entry for HarmonyOS app-sandbox uids and throws
// ENOENT. Node reads no environment variable on that path, so patching the
// function here is the only fix that needs zero changes on the tool's side.
(function () {
  try {
    var os = require("node:os");
    var real = os.userInfo;
    if (typeof real !== "function") return;
    try {
      real.call(os);
      return; // real getpwuid_r works here -- nothing to do.
    } catch (probeErr) {}

    var name =
      process.env.BUN_OHOS_USERNAME ||
      process.env.USER ||
      process.env.LOGNAME ||
      "unknown"; // last resort matches bun's own os.userInfo() fallback.

    os.userInfo = function userInfo(options) {
      try {
        return real.call(os, options);
      } catch (e) {}
      var enc = options && typeof options === "object" ? options.encoding : undefined;
      var encode = function (s) {
        if (enc === "buffer") return Buffer.from(s, "utf8");
        if (enc) return Buffer.from(s, "utf8").toString(enc);
        return s;
      };
      var home;
      try {
        home = os.homedir();
      } catch (e) {
        home = process.env.HOME || "/data/storage/el2/base";
      }
      return {
        uid: typeof process.getuid === "function" ? process.getuid() : -1,
        gid: typeof process.getgid === "function" ? process.getgid() : -1,
        username: encode(name),
        homedir: encode(home),
        shell: encode(process.env.SHELL || "/bin/sh"),
      };
    };
  } catch (e) {}
})();
"#;

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

// ─────────────────────────────────────────────────────────────────────────
// argv0 matching
// ─────────────────────────────────────────────────────────────────────────

fn basename(path: &[u8]) -> &[u8] {
    match path.iter().rposition(|&b| b == b'/') {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

/// `base` is already `basename(argv0)`. `node`/`nodejs`/`nodeNN` cover the
/// interpreter itself (nvm/fnm shims and distro packages commonly suffix a
/// version — `node22`, `node20.11`, `node-22`; note this must reject
/// `nodemon`, whose suffix after `node` isn't purely digits/dot/dash).
/// `npm`/`npx`/`corepack`/`yarn`/`pnpm`/`pnpx` are `#!/usr/bin/env node`
/// shebang scripts: their own process never calls `os.userInfo()`, but
/// giving them the preload costs nothing and lets a `node` they re-exec
/// inherit `NODE_OPTIONS` even if that re-exec doesn't go through this spawn
/// path a second time.
fn is_node_like(base: &[u8]) -> bool {
    if base == b"node" || base == b"nodejs" {
        return true;
    }
    if let Some(rest) = base.strip_prefix(b"node") {
        if !rest.is_empty() && rest.iter().all(|&b| b.is_ascii_digit() || b == b'.' || b == b'-')
        {
            return true;
        }
    }
    matches!(
        base,
        b"npm" | b"npx" | b"corepack" | b"yarn" | b"pnpm" | b"pnpx"
    )
}

// ─────────────────────────────────────────────────────────────────────────
// Escape hatch
// ─────────────────────────────────────────────────────────────────────────

/// Checked against **both** this bun process's own environment (a
/// `BUN_OHOS_NO_NODE_USERINFO=1 bun script.js` global kill switch, set
/// before bun ever ran) and `env_array`, the environment about to become
/// the *child's* (a caller doing `Bun.spawn(cmd, { env: {
/// BUN_OHOS_NO_NODE_USERINFO: "1" } })` for one specific spawn, which
/// `override_env` may mean never touched bun's own process env at all).
/// Checking only the former misses the latter; checking only the latter
/// misses a plain shell-set global toggle on a call that passed an explicit
/// non-inheriting `env:` for an unrelated reason. Either one disables it.
fn is_disabled(env_array: &[*const c_char]) -> bool {
    if find_env_value(env_array, b"BUN_OHOS_NO_NODE_USERINFO").is_some()
        || std::env::var_os("BUN_OHOS_NO_NODE_USERINFO").is_some()
    {
        return true;
    }
    // Honor the embedded shim's own toggle (ohos_compat_shim.c's
    // OHOS_COMPAT_SHIM_DISABLE) so a test/user that turns off the shim's
    // getpwuid_r interposer also turns this off -- otherwise "the shim is
    // disabled" and "node still gets a working username" would contradict
    // each other for anyone deliberately probing the raw ENOENT.
    let shim_disable = find_env_value(env_array, b"OHOS_COMPAT_SHIM_DISABLE")
        .or_else(|| std::env::var_os("OHOS_COMPAT_SHIM_DISABLE").map(|v| v.into_encoded_bytes()));
    if let Some(v) = shim_disable {
        if v.split(|&b| b == b',').any(|s| s == b"getpwuid_r") {
            return true;
        }
    }
    false
}

// ─────────────────────────────────────────────────────────────────────────
// Username / home-dir source of truth
// ─────────────────────────────────────────────────────────────────────────

struct ShimIdentity {
    /// `getpwuid_r(getuid())` username via the embedded shim's interposed
    /// symbol -- survives a device with no `$USER` set. `None` if the
    /// lookup failed or returned something that can't safely become an env
    /// value (contains `=` or NUL).
    username: Option<Box<[u8]>>,
    /// `pw_dir` from the same call, reused as a home-dir candidate for the
    /// preload directory search below so we don't pay for getpwuid_r twice.
    home: Option<Box<[u8]>>,
}

fn shim_identity() -> &'static ShimIdentity {
    static ONCE: Once<ShimIdentity> = Once::new();
    ONCE.get_or_init(|| {
        // SAFETY: zeroed POD, same as node_os.rs's homedir() implementation.
        let mut pw: libc::passwd = bun_core::ffi::zeroed();
        let mut result: *mut libc::passwd = core::ptr::null_mut();
        let mut stack_buf = [0u8; 4096];
        let mut heap_buf: Vec<u8>;
        let mut buf: &mut [u8] = &mut stack_buf;

        let ret: core::ffi::c_int = loop {
            // NOTE: must be `getuid()`, not `geteuid()` -- the embedded
            // shim's getpwuid_r interposer (ohos_compat_shim.c) only takes
            // the OS-account fast path when `uid == getuid()`. Passing
            // geteuid() here would silently fall through to the shim's own
            // env-var fallback, defeating the point of calling this instead
            // of just reading $USER ourselves.
            let ret = unsafe {
                libc::getpwuid_r(
                    sys::c::getuid(),
                    &raw mut pw,
                    buf.as_mut_ptr().cast::<c_char>(),
                    buf.len(),
                    &raw mut result,
                )
            };

            if ret == sys::E::EINTR as core::ffi::c_int {
                continue;
            }
            if ret == sys::E::ERANGE as core::ffi::c_int {
                heap_buf = vec![0u8; buf.len() * 2];
                buf = &mut heap_buf;
                continue;
            }
            break ret;
        };

        if ret != 0 || result.is_null() {
            return ShimIdentity {
                username: None,
                home: None,
            };
        }

        let username = if !pw.pw_name.is_null() {
            // SAFETY: getpwuid_r NUL-terminates pw_name into `buf` on success.
            let bytes = unsafe { CStr::from_ptr(pw.pw_name) }.to_bytes();
            (!bytes.is_empty() && !bytes.contains(&b'=') && !bytes.contains(&0))
                .then(|| Box::<[u8]>::from(bytes))
        } else {
            None
        };
        let home = if !pw.pw_dir.is_null() {
            // SAFETY: same as pw_name above.
            let bytes = unsafe { CStr::from_ptr(pw.pw_dir) }.to_bytes();
            (!bytes.is_empty()).then(|| Box::<[u8]>::from(bytes))
        } else {
            None
        };

        ShimIdentity { username, home }
    })
}

// ─────────────────────────────────────────────────────────────────────────
// Preload file materialization
// ─────────────────────────────────────────────────────────────────────────

/// Absolute path to the on-disk preload, materializing it on first use and
/// re-verifying on every later call. `None` means "give up" -- no writable
/// candidate, or the write failed -- callers must treat that as "inject
/// nothing".
fn preload_path() -> Option<&'static [u8]> {
    // Only the *choice of path* (which candidate directory won, and the
    // content-hashed filename) is cacheable for the process lifetime -- it
    // can't change without an env change this process would never see.
    // Whether the file is still *there* can change at any time (deleted out
    // from under a long-lived process), so that check must run on every
    // call, not just live inside the one-shot `resolve_and_materialize`
    // behind this `Once`. Bug found by `bun test`: the self-heal test
    // deletes the file mid-run and the *next* call in the same process
    // (same `bun test` invocation) got the stale cached path with no
    // re-check, because the whole materialize-and-cache step used to sit
    // inside `get_or_init`'s closure. Standalone `bun -e` invocations never
    // caught this since each one is a fresh process with an uninitialized
    // `Once`.
    static ONCE: Once<Option<ZBox>> = Once::new();
    let final_z = ONCE.get_or_init(resolve_and_materialize).as_ref()?;
    if sys::access(final_z, libc::F_OK).is_err() && !materialize(final_z) {
        return None;
    }
    Some(final_z.as_bytes())
}

fn resolve_and_materialize() -> Option<ZBox> {
    let ident = shim_identity();
    let filename = format!(
        "bun-ohos-userinfo-{:016x}.cjs",
        fnv1a64(PRELOAD_JS.as_bytes())
    );
    for dir in candidate_dirs(ident) {
        if let Some(path) = try_dir(&dir, &filename) {
            return Some(path);
        }
    }
    None
}

/// Candidate directories, most-intentional first. A NODE_OPTIONS `--require`
/// token can't safely carry a space/quote/backslash/tab even quoted (risk of
/// a malformed argument node then refuses to parse), so any candidate
/// containing one is skipped outright rather than escaped -- the hardcoded
/// EL2 fallback never contains any of these, so there's always one left.
fn candidate_dirs(ident: &ShimIdentity) -> Vec<Vec<u8>> {
    let mut out = Vec::with_capacity(3);
    if let Some(install) = env_var::BUN_INSTALL.get() {
        push_candidate(&mut out, install, b"/ohos");
    }
    let home = env_var::HOME.get().or(ident.home.as_deref());
    if let Some(home) = home {
        push_candidate(&mut out, home, b"/.bun/ohos");
    }
    // HarmonyOS per-HAP sandbox base -- always resolvable, no env
    // dependency, and the shim itself falls back to this same path for HOME
    // (ohos_compat_shim.c). Works identically on any device the compiled
    // binary ships to.
    out.push(b"/data/storage/el2/base/.bun-ohos".to_vec());
    out
}

fn push_candidate(out: &mut Vec<Vec<u8>>, base: &[u8], suffix: &[u8]) {
    if base.iter().any(|&b| matches!(b, b' ' | b'"' | b'\\' | b'\t')) {
        return;
    }
    let mut v = Vec::with_capacity(base.len() + suffix.len());
    v.extend_from_slice(base);
    v.extend_from_slice(suffix);
    out.push(v);
}

fn try_dir(dir_bytes: &[u8], filename: &str) -> Option<ZBox> {
    let dir_z = ZBox::from_vec(dir_bytes.to_vec());
    match sys::mkdir(&dir_z, 0o700) {
        Ok(()) => {
            // OHOS tmpfs forces setgid + group-write on new dirs (same quirk
            // documented at install/lib.rs's BUN_NODE_DIR handling) -- chmod
            // back to 0700 so the EEXIST branch's ownership check passes on
            // the next process that reuses this dir.
            let _ = sys::chmod(&dir_z, 0o700);
        }
        Err(e) if e.get_errno() == sys::E::EEXIST => match sys::lstat(&dir_z) {
            Ok(st)
                if sys::kind_from_mode(st.st_mode as sys::Mode) == sys::FileKind::Directory
                    && st.st_uid == sys::c::getuid() =>
            {
                let _ = sys::chmod(&dir_z, 0o700);
            }
            // Not a directory we own -- don't write into it.
            _ => return None,
        },
        Err(_) => return None,
    }

    let mut final_bytes = dir_bytes.to_vec();
    final_bytes.push(b'/');
    final_bytes.extend_from_slice(filename.as_bytes());
    let final_z = ZBox::from_vec(final_bytes);

    // Fast path: content-hashed name means existence implies correctness.
    // Every spawn re-checks here rather than trusting a cached bool -- if
    // something external deleted the file, the next spawn heals it instead
    // of handing node a `--require` for a path that's gone.
    if sys::access(&final_z, libc::F_OK).is_ok() {
        return Some(final_z);
    }

    if materialize(&final_z) {
        Some(final_z)
    } else {
        None
    }
}

/// Write-to-temp + `rename()`: the only way to guarantee a concurrent bun
/// process never sees a half-written file (`rename()` is atomic within a
/// directory). Content is identical by construction (content-hashed
/// filename), so whichever process's rename lands last is fine.
fn materialize(final_z: &ZBox) -> bool {
    let mut tmp_bytes = final_z.as_bytes().to_vec();
    tmp_bytes.push(b'.');
    tmp_bytes.extend_from_slice(std::process::id().to_string().as_bytes());
    tmp_bytes.extend_from_slice(b".tmp");
    let tmp_z = ZBox::from_vec(tmp_bytes);

    let fd = match sys::open(
        &tmp_z,
        libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_CLOEXEC,
        0o600,
    ) {
        Ok(fd) => fd,
        Err(_) => return false,
    };

    let ok = write_all(fd, PRELOAD_JS.as_bytes());
    let _ = sys::close(fd);
    if !ok {
        let _ = sys::unlink(&tmp_z);
        return false;
    }

    if sys::rename(&tmp_z, final_z).is_err() {
        let _ = sys::unlink(&tmp_z);
        return false;
    }
    true
}

fn write_all(fd: sys::Fd, mut buf: &[u8]) -> bool {
    while !buf.is_empty() {
        match sys::write(fd, buf) {
            Ok(0) => return false,
            Ok(n) => buf = &buf[n..],
            Err(e) if e.get_errno() == sys::E::EINTR => continue,
            Err(_) => return false,
        }
    }
    true
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

/// What a caller should add to a spawned child's environment. `node_options`
/// always replaces every existing `NODE_OPTIONS` entry (there may be more
/// than one stale copy in an inherited array); `username` is `None` when the
/// shim lookup failed, in which case the preload's own `$USER`/`$LOGNAME`
/// fallback still applies and nothing needs to be pushed for it.
pub struct Injection {
    /// `"NODE_OPTIONS=<merged value>"`, no trailing NUL.
    pub node_options: Vec<u8>,
    /// `"BUN_OHOS_USERNAME=<name>"`, no trailing NUL.
    pub username: Option<Vec<u8>>,
}

/// Call after argv0 is resolved and before the child's env array is
/// finalized. `argv0` must be the fully `$PATH`-resolved executable path
/// (not a caller-supplied `options.argv0` override — see call sites for why
/// that's already guaranteed). `env_array` is read-only here; the caller
/// removes [`is_managed_key`] entries and pushes the returned lines through
/// whatever storage mechanism it owns. The two call sites (`Bun.spawn`'s
/// `Vec<ZBox>` vs. the shell interpreter's bump arena) don't share a storage
/// type, so ownership has to stay on their side.
pub fn compute(argv0: &[u8], env_array: &[*const c_char]) -> Option<Injection> {
    if !is_node_like(basename(argv0)) {
        return None;
    }
    if is_disabled(env_array) {
        return None;
    }
    let preload = preload_path()?;

    let existing = find_env_value(env_array, b"NODE_OPTIONS").unwrap_or_default();
    let flag = build_require_flag(preload);
    if contains_subslice(&existing, &flag) {
        // Already present -- a bun -> bun -> node chain re-entering this
        // spawn point, or the parent already carries it via inherited
        // NODE_OPTIONS. Don't duplicate --require.
        return None;
    }

    let mut node_options =
        Vec::with_capacity(b"NODE_OPTIONS=".len() + existing.len() + 1 + flag.len());
    node_options.extend_from_slice(b"NODE_OPTIONS=");
    if !existing.is_empty() {
        node_options.extend_from_slice(&existing);
        node_options.push(b' ');
    }
    node_options.extend_from_slice(&flag);

    let username = shim_identity().username.as_ref().map(|name| {
        let mut line = Vec::with_capacity(b"BUN_OHOS_USERNAME=".len() + name.len());
        line.extend_from_slice(b"BUN_OHOS_USERNAME=");
        line.extend_from_slice(name);
        line
    });

    Some(Injection {
        node_options,
        username,
    })
}

/// Keys an [`Injection`] owns. Callers must `retain` these out of
/// `env_array` before pushing the new lines -- musl/glibc `getenv()` returns
/// the *first* match, so an appended-only entry would silently lose to a
/// stale one earlier in the array (same hazard the PWD block in
/// `js_bun_spawn_bindings.rs` documents at its `is_pwd_key` closure).
pub fn is_managed_key(ptr: *const c_char) -> bool {
    if ptr.is_null() {
        return false;
    }
    // SAFETY: caller contract -- every entry in a live `env_array` at this
    // point is NUL-terminated storage that outlives this call, same
    // invariant `is_pwd_key` and `find_env_value` rely on.
    let bytes = unsafe { CStr::from_ptr(ptr) }.to_bytes();
    let key_end = bytes.iter().position(|&b| b == b'=').unwrap_or(bytes.len());
    matches!(&bytes[..key_end], b"NODE_OPTIONS" | b"BUN_OHOS_USERNAME")
}

fn find_env_value(env_array: &[*const c_char], key: &[u8]) -> Option<Vec<u8>> {
    for &ptr in env_array {
        if ptr.is_null() {
            continue;
        }
        // SAFETY: see `is_managed_key`.
        let bytes = unsafe { CStr::from_ptr(ptr) }.to_bytes();
        let key_end = bytes.iter().position(|&b| b == b'=').unwrap_or(bytes.len());
        if &bytes[..key_end] == key {
            // musl/glibc getenv() returns the FIRST match -- mirror that so
            // "existing" reflects what the child would actually observe.
            return Some(bytes[key_end + 1..].to_vec());
        }
    }
    None
}

/// Node's `NODE_OPTIONS` lexer (`ParseNodeOptionsEnvVar`): only a space
/// separates tokens (tab is not a separator), only `"` quotes, and `\` only
/// escapes inside a quoted span. An unclosed quote makes node print `invalid
/// value for NODE_OPTIONS` and exit -- so this always quotes and always
/// escapes `"`/`\`, even when the path has neither (one code path, so it
/// can't be wrong on the rare input that needs it). In practice
/// `candidate_dirs`/`push_candidate` already reject any path containing a
/// space or quote, so the escaping loop is a zero-cost guarantee rather than
/// a path that's ever actually exercised.
fn build_require_flag(path: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b"--require ".len() + path.len() + 2);
    out.extend_from_slice(b"--require ");
    out.push(b'"');
    for &b in path {
        if b == b'"' || b == b'\\' {
            out.push(b'\\');
        }
        out.push(b);
    }
    out.push(b'"');
    out
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if needle.len() > haystack.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_like_matches() {
        assert!(is_node_like(b"node"));
        assert!(is_node_like(b"nodejs"));
        assert!(is_node_like(b"node22"));
        assert!(is_node_like(b"node20.11"));
        assert!(is_node_like(b"node-22"));
        assert!(is_node_like(b"npm"));
        assert!(is_node_like(b"npx"));
        assert!(is_node_like(b"corepack"));
        assert!(is_node_like(b"yarn"));
        assert!(is_node_like(b"pnpm"));
        assert!(is_node_like(b"pnpx"));
    }

    #[test]
    fn node_like_rejects() {
        assert!(!is_node_like(b"nodemon"));
        assert!(!is_node_like(b"bun"));
        assert!(!is_node_like(b"sh"));
        assert!(!is_node_like(b""));
        assert!(!is_node_like(b"node_modules"));
    }

    /// Regression test for the bug `bun test` caught: the escape hatch must
    /// be checked against `env_array` (the *child's* target env, which is
    /// where a caller doing `Bun.spawn(cmd, { env: { BUN_OHOS_NO_NODE_USERINFO:
    /// "1" } } })` puts it) and not only `std::env::var_os` (this process's
    /// own ambient env, which such a call never touches). Doesn't set real
    /// process env vars, since parallel `cargo test` runs would race on
    /// those -- only exercises the env_array half of `is_disabled`.
    #[test]
    fn is_disabled_reads_env_array_not_only_process_env() {
        use std::ffi::CString;
        let entries: Vec<CString> = vec![
            CString::new("PATH=/usr/bin").unwrap(),
            CString::new("BUN_OHOS_NO_NODE_USERINFO=1").unwrap(),
        ];
        let ptrs: Vec<*const c_char> = entries.iter().map(|e| e.as_ptr()).collect();
        assert!(is_disabled(&ptrs));

        let entries_without: Vec<CString> = vec![CString::new("PATH=/usr/bin").unwrap()];
        let ptrs_without: Vec<*const c_char> = entries_without.iter().map(|e| e.as_ptr()).collect();
        assert!(!is_disabled(&ptrs_without));
    }

    #[test]
    fn is_disabled_reads_shim_disable_getpwuid_r_from_env_array() {
        use std::ffi::CString;
        let entries: Vec<CString> = vec![CString::new("OHOS_COMPAT_SHIM_DISABLE=close_range,getpwuid_r").unwrap()];
        let ptrs: Vec<*const c_char> = entries.iter().map(|e| e.as_ptr()).collect();
        assert!(is_disabled(&ptrs));

        // Disabling an unrelated symbol must not disable this.
        let entries_other: Vec<CString> = vec![CString::new("OHOS_COMPAT_SHIM_DISABLE=close_range").unwrap()];
        let ptrs_other: Vec<*const c_char> = entries_other.iter().map(|e| e.as_ptr()).collect();
        assert!(!is_disabled(&ptrs_other));
    }

    #[test]
    fn basename_extracts_last_segment() {
        assert_eq!(basename(b"/usr/bin/node"), b"node");
        assert_eq!(basename(b"node"), b"node");
        assert_eq!(basename(b"/a/b/c/node22"), b"node22");
        assert_eq!(basename(b"/"), b"");
    }

    #[test]
    fn require_flag_quotes_and_escapes() {
        assert_eq!(build_require_flag(b"/tmp/x.cjs"), b"--require \"/tmp/x.cjs\"");
        assert_eq!(
            build_require_flag(br#"/tmp/a"b.cjs"#),
            br#"--require "/tmp/a\"b.cjs""#
        );
        assert_eq!(
            build_require_flag(br"/tmp/a\b.cjs"),
            br#"--require "/tmp/a\\b.cjs""#
        );
    }

    #[test]
    fn contains_subslice_matches() {
        assert!(contains_subslice(b"--foo --require \"/x\" --bar", b"--require \"/x\""));
        assert!(!contains_subslice(b"--foo --bar", b"--require \"/x\""));
        assert!(contains_subslice(b"anything", b""));
        assert!(!contains_subslice(b"", b"x"));
    }

    #[test]
    fn push_candidate_skips_unsafe_bytes() {
        let mut out = Vec::new();
        push_candidate(&mut out, b"/has space", b"/ohos");
        push_candidate(&mut out, b"/has\"quote", b"/ohos");
        push_candidate(&mut out, b"/has\\slash", b"/ohos");
        push_candidate(&mut out, b"/has\ttab", b"/ohos");
        assert!(out.is_empty());
        push_candidate(&mut out, b"/clean/path", b"/ohos");
        assert_eq!(out, vec![b"/clean/path/ohos".to_vec()]);
    }
}
