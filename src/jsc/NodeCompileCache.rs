//! Node-compatible on-disk compile cache (`NODE_COMPILE_CACHE`): entries in a
//! version-tagged subdir store the post-transpile source + JSC bytecode; the
//! stored source is byte-compared on load so stale caches recompile normally.

use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use bstr::ByteSlice;
use bun_boringssl::c as boring;
use bun_collections::{HashMap, IdentityContext};
use bun_core::String as BunString;
use bun_core::{Mutex, ZStr, env_var};
use bun_options_types::Format;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP};
use bun_sys::{self as sys, Fd, O};

pub const STATUS_FAILED: i32 = 0;
pub const STATUS_ENABLED: i32 = 1;
pub const STATUS_ALREADY_ENABLED: i32 = 2;
pub const STATUS_DISABLED: i32 = 3;

const MAGIC: u32 = 0xb0bcace2;
const HASH_SIZE: usize = 32;
/// `magic u32 | code_size u32 | cache_size u32 | code sha256 | blob sha256`.
const HEADER_SIZE: usize = 3 * 4 + 2 * HASH_SIZE;

// 0 = not initialized from env yet, 1 = off, 2 = on.
static ENABLED: AtomicU8 = AtomicU8::new(0);
static LOG_ENABLED: AtomicBool = AtomicBool::new(false);

static STATE: Mutex<Option<CacheState>> = Mutex::new(None);

struct CacheState {
    /// `<absolute base dir>/<version tag>` — what `getCompileCacheDir()`
    /// returns and where entries live.
    dir: Box<[u8]>,
    dir_handle: sys::Dir,
    /// Portable mode: keys use paths relative to `dir`, so the cache
    /// survives moving the tree (NODE_COMPILE_CACHE_PORTABLE / {portable}).
    portable: bool,
    entries: HashMap<u64, Entry, IdentityContext<u64>>,
}

// SAFETY: `CacheState` is only reached through the global `STATE` mutex; the
// `sys::Dir` fd is just an integer handle.
unsafe impl Send for CacheState {}

struct Entry {
    /// `path.text` of the module (absolute file path).
    filename: Box<[u8]>,
    is_cjs: bool,
    code_hash: [u8; HASH_SIZE],
    code_size: u32,
    /// Post-transpile text; `None` when the module never transpiled
    /// successfully (parse error) — mirrors Node's "not initialized" state.
    code: Option<Box<[u8]>>,
    /// Deserialized bytecode blob handed to JSC (the cache was accepted).
    /// Kept alive for the process — `ZigSourceProvider` wraps it, no copy.
    blob: Option<AlignedBlob>,
    persisted: bool,
}

/// 128-byte-aligned blob. JSC's bytecode decoder reads the blob in place and
/// requires the same alignment the standalone graph provides (see
/// StandaloneModuleGraph.rs "Bytecode alignment" note). Either a heap buffer
/// or a span inside a whole-file mapping.
struct AlignedBlob {
    ptr: core::ptr::NonNull<u8>,
    len: usize,
    backing: Backing,
}

enum Backing {
    Heap,
    /// `PROT_READ`/`MAP_PRIVATE` mapping of the whole cache file; `ptr` points
    /// at [`blob_file_offset`] inside it, 128-aligned because the mapping base
    /// is page-aligned. Safe against entry rewrites: writers go through
    /// tmpfile + rename, so a replaced file's old inode stays live under the
    /// mapping.
    Map {
        base: core::ptr::NonNull<u8>,
        map_len: usize,
    },
}

// SAFETY: the buffer is plain bytes; ownership is unique to the entry map.
unsafe impl Send for AlignedBlob {}

/// Blobs displaced by an entry refresh. JSC providers hold raw spans into accepted blobs past the
/// initial compile, so displaced blobs are retired (leaked), never freed — freeing is a UAF across
/// the FFI boundary. Bounding this needs a JSC-side provider release hook first, not a cap here.
static RETIRED_BLOBS: Mutex<Vec<AlignedBlob>> = Mutex::new(Vec::new());

const BLOB_ALIGN: usize = 128;

impl AlignedBlob {
    /// Uninitialized buffer; caller must fill all `len` bytes before reading.
    fn new_uninit(len: usize) -> Option<Self> {
        let layout = core::alloc::Layout::from_size_align(len.max(1), BLOB_ALIGN).ok()?;
        // SAFETY: layout has non-zero size.
        let raw = unsafe { std::alloc::alloc(layout) };
        let ptr = core::ptr::NonNull::new(raw)?;
        Some(Self {
            ptr,
            len,
            backing: Backing::Heap,
        })
    }

    fn as_slice(&self) -> &[u8] {
        // SAFETY: `ptr` is valid for `len` bytes for the lifetime of `self`.
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }

    fn as_mut_slice(&mut self) -> &mut [u8] {
        // SAFETY: `ptr` is valid for `len` bytes for the lifetime of `self`.
        unsafe { core::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len) }
    }
}

impl Drop for AlignedBlob {
    fn drop(&mut self) {
        match self.backing {
            Backing::Heap => {
                let layout = core::alloc::Layout::from_size_align(self.len.max(1), BLOB_ALIGN)
                    .expect("valid");
                // SAFETY: allocated in `new_uninit` with the identical layout.
                unsafe { std::alloc::dealloc(self.ptr.as_ptr(), layout) };
            }
            Backing::Map { base, map_len } => {
                let _ = sys::munmap(base.as_ptr(), map_len);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Logging (NODE_DEBUG_NATIVE=COMPILE_CACHE)
// ──────────────────────────────────────────────────────────────────────────

fn log_str(line: &str) {
    if !LOG_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let mut buf = line.as_bytes();
    while !buf.is_empty() {
        match sys::write(Fd::stderr(), buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf = &buf[n..],
        }
    }
}

macro_rules! cclog {
    ($($arg:tt)*) => {
        if LOG_ENABLED.load(Ordering::Relaxed) {
            log_str(&std::format!($($arg)*));
        }
    };
}

fn errno_name(e: &sys::Error) -> &'static str {
    <&'static str>::from(e.get_errno())
}

/// Read-log tail for an I/O error; ENOENT uses Node's exact wording.
fn errno_tail(e: &sys::Error) -> String {
    if e.get_errno() == sys::E::ENOENT {
        " no such file or directory\n".to_string()
    } else {
        format!(" {}\n", errno_name(e))
    }
}

/// Human-readable module name for logs: plain path for CommonJS, `file://`
/// URL for ESM — matching Node's output.
fn display_name(filename: &[u8], is_cjs: bool) -> String {
    if is_cjs {
        filename.as_bstr().to_string()
    } else if cfg!(windows) {
        let mut bytes = Vec::with_capacity(filename.len() + 8);
        bytes.extend_from_slice(b"file:///");
        // 0x5C never appears inside a multi-byte UTF-8 sequence, so a byte
        // swap matches the per-char replacement.
        bytes.extend(filename.iter().map(|&b| if b == b'\\' { b'/' } else { b }));
        bytes.as_bstr().to_string()
    } else {
        let mut bytes = Vec::with_capacity(filename.len() + 7);
        bytes.extend_from_slice(b"file://");
        bytes.extend_from_slice(filename);
        bytes.as_bstr().to_string()
    }
}

fn type_name(is_cjs: bool) -> &'static str {
    if is_cjs { "CommonJS" } else { "ESM" }
}

// ──────────────────────────────────────────────────────────────────────────
// Hashing / keys / version tag
// ──────────────────────────────────────────────────────────────────────────

fn sha256(bytes: &[u8]) -> [u8; HASH_SIZE] {
    let mut out = [0u8; HASH_SIZE];
    // SAFETY: `out` is exactly the 32 bytes SHA256 writes.
    unsafe { boring::SHA256(bytes.as_ptr(), bytes.len(), out.as_mut_ptr()) };
    out
}

/// First 8 digest bytes of `SHA256(type byte || filename)`: the in-memory map
/// key and the on-disk entry name (16 hex chars).
fn cache_key(filename: &[u8], is_cjs: bool) -> u64 {
    let type_byte: [u8; 1] = [is_cjs as u8];
    let mut ctx = core::mem::MaybeUninit::<boring::SHA256_CTX>::uninit();
    let mut out = [0u8; HASH_SIZE];
    // SAFETY: `SHA256_Init` fully initializes the context; updates/final only
    // read the given byte ranges and write the 32-byte digest.
    unsafe {
        boring::SHA256_Init(ctx.as_mut_ptr());
        boring::SHA256_Update(ctx.as_mut_ptr(), type_byte.as_ptr().cast(), 1);
        boring::SHA256_Update(ctx.as_mut_ptr(), filename.as_ptr().cast(), filename.len());
        boring::SHA256_Final(out.as_mut_ptr(), ctx.as_mut_ptr());
    }
    u64::from_le_bytes(out[..8].try_into().expect("8 bytes"))
}

/// Digest rendering for NODE_DEBUG_NATIVE=COMPILE_CACHE lines.
fn hex(digest: &[u8; HASH_SIZE]) -> String {
    bun_core::fmt::bytes_to_hex_lower_string(digest)
}

/// Portable mode keys on the path relative to the cache dir (Node parity).
/// Falls back to absolute keys when no relative form exists (e.g. different
/// Windows drives, where `relative` returns `to` unchanged — Node parity).
fn key_for(state: &CacheState, filename: &[u8], is_cjs: bool) -> u64 {
    if state.portable {
        // Thread-local scratch result: consumed before any other resolve call.
        let rel = bun_paths::resolve_path::relative(&state.dir, filename);
        if !rel.is_empty() && !bun_paths::is_absolute(rel) {
            cclog!(
                "[compile cache] using relative path {} from {}\n",
                rel.as_bstr(),
                state.dir.as_bstr()
            );
            return cache_key(rel, is_cjs);
        }
    }
    cache_key(filename, is_cjs)
}

/// `v<bun version>-<arch>-<revision>-<uid>`, mirroring Node's
/// `$VERSION-$ARCH-$CACHE_VERSION_TAG-$UID` shape. The revision changes with
/// every Bun build, so a stale JSC bytecode format can never be loaded.
fn version_tag() -> String {
    let sha = if bun_core::env::GIT_SHA_SHORT.is_empty() {
        "dev"
    } else {
        bun_core::env::GIT_SHA_SHORT
    };
    let arch = std::env::consts::ARCH;
    let version = bun_core::Global::package_json_version;
    #[cfg(not(windows))]
    {
        format!("v{}-{}-{}-{}", version, arch, sha, sys::c::getuid())
    }
    #[cfg(windows)]
    {
        format!("v{}-{}-{}", version, arch, sha)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Enable / init
// ──────────────────────────────────────────────────────────────────────────

pub struct EnableResult {
    pub status: i32,
    pub directory: Option<Vec<u8>>,
    pub message: Option<String>,
}

#[inline]
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed) == 2
}

/// `NODE_COMPILE_CACHE_PORTABLE=1` (exact match, like Node).
fn portable_from_env() -> bool {
    env_var::NODE_COMPILE_CACHE_PORTABLE::get() == Some(b"1")
}

/// One-time env-driven initialization; called from the module fetch path.
/// Cheap after the first call.
pub fn init_from_env_once() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        init_logging();
        if let Some(dir) = env_var::NODE_COMPILE_CACHE::get_not_empty() {
            if env_var::NODE_DISABLE_COMPILE_CACHE::get().is_some() {
                cclog!("[compile cache] Disabled by NODE_DISABLE_COMPILE_CACHE.\n");
                ENABLED.store(1, Ordering::Relaxed);
                return;
            }
            if crate::virtual_machine::standalone_module_graph().is_some() {
                cclog!("[compile cache] Disabled in standalone executables.\n");
                ENABLED.store(1, Ordering::Relaxed);
                return;
            }
            let _ = enable_with_dir(dir, portable_from_env());
        } else {
            ENABLED.store(1, Ordering::Relaxed);
        }
    });
}

fn init_logging() {
    if let Some(v) = env_var::NODE_DEBUG_NATIVE::get() {
        let enabled = bun_core::strings::split(v, b",").any(|item| {
            let item = item.trim_ascii();
            item.eq_ignore_ascii_case(b"COMPILE_CACHE") || item == b"*"
        });
        if enabled {
            LOG_ENABLED.store(true, Ordering::Relaxed);
        }
    }
}

fn init_logging_once() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(init_logging);
}

/// `module.enableCompileCache(dir | {directory, portable})`. `None` values
/// resolve like Node: dir from `NODE_COMPILE_CACHE` else the tmpdir default;
/// portable from `NODE_COMPILE_CACHE_PORTABLE=1`.
pub fn enable(explicit_dir: Option<&[u8]>, portable: Option<bool>) -> EnableResult {
    init_logging_once();
    if env_var::NODE_DISABLE_COMPILE_CACHE::get().is_some() {
        cclog!("[compile cache] Disabled by NODE_DISABLE_COMPILE_CACHE.\n");
        // A previously-uninitialized state stays off.
        let _ = ENABLED.compare_exchange(0, 1, Ordering::Relaxed, Ordering::Relaxed);
        return EnableResult {
            status: STATUS_DISABLED,
            directory: None,
            message: Some("Disabled by NODE_DISABLE_COMPILE_CACHE".to_string()),
        };
    }

    if is_enabled() {
        return EnableResult {
            status: STATUS_ALREADY_ENABLED,
            directory: get_dir(),
            message: None,
        };
    }

    let default_buf: Vec<u8>;
    let dir: &[u8] = match explicit_dir {
        // "" resolves to cwd, like Node's path.resolve("").
        Some(d) => d,
        None => match env_var::NODE_COMPILE_CACHE::get_not_empty() {
            Some(d) => d,
            None => {
                let tmp = platform_tmp_dir();
                let mut buf = Vec::with_capacity(tmp.len() + 20);
                buf.extend_from_slice(tmp);
                buf.push(SEP);
                buf.extend_from_slice(b"node-compile-cache");
                default_buf = buf;
                &default_buf
            }
        },
    };
    enable_with_dir(dir, portable.unwrap_or_else(portable_from_env))
}

/// Node's `os.tmpdir()` order: TEMP -> TMP on Windows, TMPDIR -> TMP ->
/// TEMP -> /tmp on POSIX; trailing separator stripped.
fn platform_tmp_dir() -> &'static [u8] {
    #[cfg(windows)]
    let candidate = env_var::TEMP::get_not_empty().or_else(env_var::TMP::get_not_empty);
    #[cfg(not(windows))]
    let candidate = env_var::TMPDIR::get_not_empty()
        .or_else(env_var::TMP::get_not_empty)
        .or_else(env_var::TEMP::get_not_empty);
    if let Some(dir) = candidate {
        if dir.len() > 1 && dir[dir.len() - 1] == SEP {
            return &dir[..dir.len() - 1];
        }
        return dir;
    }
    #[cfg(windows)]
    {
        b"C:\\Windows\\Temp"
    }
    #[cfg(not(windows))]
    {
        b"/tmp"
    }
}

fn enable_with_dir(dir: &[u8], portable: bool) -> EnableResult {
    let tag = version_tag();

    // Resolve `dir` to an absolute path against the process cwd.
    let mut abs_buf = PathBuffer::uninit();
    let mut cwd_buf = PathBuffer::uninit();
    let abs: &[u8] = if bun_paths::is_absolute(dir) {
        dir
    } else {
        let cwd_len = match sys::getcwd(&mut cwd_buf[..]) {
            Ok(n) => n,
            Err(e) => {
                return EnableResult {
                    status: STATUS_FAILED,
                    directory: None,
                    message: Some(format!(
                        "Cannot resolve cache directory: {}",
                        errno_name(&e)
                    )),
                };
            }
        };
        bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::resolve_path::platform::Auto>(
            &cwd_buf[..cwd_len],
            &mut abs_buf[..],
            &[dir],
        )
        .as_bytes()
    };
    if abs.len() + 1 + tag.len() + 2 > MAX_PATH_BYTES {
        return EnableResult {
            status: STATUS_FAILED,
            directory: None,
            message: Some("Cannot create cache directory: path too long".to_string()),
        };
    }

    let mut tagged: Vec<u8> = Vec::with_capacity(abs.len() + 1 + tag.len());
    tagged.extend_from_slice(abs);
    tagged.push(SEP);
    tagged.extend_from_slice(tag.as_bytes());

    cclog!(
        "[compile cache] resolved path {} + {} -> {}\n",
        dir.as_bstr(),
        tag,
        tagged.as_bstr()
    );

    let cwd = sys::Dir::cwd();
    let dir_flags = O::RDONLY | O::CLOEXEC | O::NOFOLLOW;
    let opened = match cwd.open_at_with(&tagged, dir_flags) {
        Err(e) if e.get_errno() == sys::E::ENOENT => cwd
            .make_path(&tagged)
            .and_then(|()| cwd.open_at_with(&tagged, dir_flags)),
        result => result,
    };
    let dir_handle = match opened {
        Ok(d) => d,
        Err(e) => {
            let errname = errno_name(&e);
            cclog!(
                "[compile cache] creating cache directory {}...{}\n",
                tagged.as_bstr(),
                errname
            );
            return EnableResult {
                status: STATUS_FAILED,
                directory: None,
                message: Some(format!("Cannot create cache directory: {errname}")),
            };
        }
    };
    #[cfg(unix)]
    {
        let owned_private = sys::fstat(dir_handle.fd()).is_ok_and(|st| {
            st.st_uid == sys::c::getuid() && (st.st_mode & (libc::S_IWGRP | libc::S_IWOTH)) == 0
        });
        if !owned_private {
            cclog!(
                "[compile cache] creating cache directory {}...not owned by the current user or writable by others\n",
                tagged.as_bstr()
            );
            return EnableResult {
                status: STATUS_FAILED,
                directory: None,
                message: Some(
                    "Cannot use cache directory: it must be owned by the current user and not be group- or world-writable"
                        .to_string(),
                ),
            };
        }
    }
    cclog!(
        "[compile cache] creating cache directory {}...success\n",
        tagged.as_bstr()
    );

    let directory = abs.to_vec();
    {
        let mut state = STATE.lock();
        if let Some(existing) = state.as_ref() {
            // Lost an enable race (env init on another thread vs the API):
            // keep the installed cache — replacing it would drop live blobs.
            return EnableResult {
                status: STATUS_ALREADY_ENABLED,
                directory: Some(existing.dir.to_vec()),
                message: None,
            };
        }
        let mut tagged = tagged;
        if portable {
            // Resolve symlinks (e.g. macOS /var -> /private/var) so relative
            // keys match Bun's realpath'd module paths.
            let mut z_buf = bun_core::PathBuffer::uninit();
            let mut real_buf = bun_core::PathBuffer::uninit();
            let tagged_z = bun_paths::resolve_path::z(&tagged, &mut z_buf);
            if let Ok(real) = sys::realpath(tagged_z, &mut real_buf) {
                tagged = real.to_vec();
            }
        }
        *state = Some(CacheState {
            dir: tagged.into_boxed_slice(),
            dir_handle,
            portable,
            entries: HashMap::new(),
        });
        ENABLED.store(2, Ordering::Relaxed);
    }

    EnableResult {
        status: STATUS_ENABLED,
        directory: Some(directory),
        message: None,
    }
}

/// The version-tagged cache directory (`module.getCompileCacheDir()`), or
/// `None` when the cache is not enabled.
pub fn get_dir() -> Option<Vec<u8>> {
    if !is_enabled() {
        return None;
    }
    let state = STATE.lock();
    state.as_ref().map(|s| s.dir.to_vec())
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch-time hook (read + validate)
// ──────────────────────────────────────────────────────────────────────────

/// Module-fetch hook: register/refresh the entry for `filename`; returns the
/// validated bytecode blob when the on-disk cache matches `code` (post-
/// transpile text). The pointer stays valid for the process (entry map owns it).
pub fn fetch(
    filename: &[u8],
    is_cjs: bool,
    code: &[u8],
) -> Option<crate::resolved_source::Bytecode> {
    if !is_enabled() || filename.is_empty() || !bun_paths::is_absolute(filename) {
        return None;
    }
    let Ok(code_size) = u32::try_from(code.len()) else {
        return None;
    };
    let code_hash = sha256(code);

    let mut guard = STATE.lock();
    let state = guard.as_mut()?;
    let key = key_for(state, filename, is_cjs);

    if let Some(entry) = state.entries.get(&key) {
        if entry.code_hash == code_hash && entry.code_size == code_size {
            // Same module, unchanged code (e.g. re-required): reuse.
            return entry
                .blob
                .as_ref()
                .map(|b| crate::resolved_source::Bytecode::persistent(b.as_slice()));
        }
    }

    let mut entry = Entry {
        filename: filename.into(),
        is_cjs,
        code_hash,
        code_size,
        code: None,
        blob: None,
        persisted: false,
    };

    read_cache_file(state, key, &mut entry, Some(code));

    let result = if entry.blob.is_some() {
        cclog!(
            "[compile cache] code cache for {} {} was accepted, keeping the in-memory entry\n",
            type_name(is_cjs),
            display_name(filename, is_cjs)
        );
        entry
            .blob
            .as_ref()
            .map(|b| crate::resolved_source::Bytecode::persistent(b.as_slice()))
    } else {
        cclog!(
            "[compile cache] code cache for {} {} was not initialized, initializing the in-memory entry\n",
            type_name(is_cjs),
            display_name(filename, is_cjs)
        );
        entry.code = Some(code.into());
        None
    };
    if let Some(old) = state.entries.insert(key, entry) {
        if let Some(blob) = old.blob {
            // Never freed; see RETIRED_BLOBS for the invariant.
            RETIRED_BLOBS.lock().push(blob);
        }
    }
    result
}

/// Parse-failure hook: mirrors Node registering an entry before compilation.
/// The entry stays "not initialized" so exit-time persist logs the skip line
/// (and the cache directory exists with zero entries — Node parity).
pub fn note_parse_failure(filename: &[u8], is_cjs: bool) {
    if !is_enabled() || filename.is_empty() || !bun_paths::is_absolute(filename) {
        return;
    }
    let mut guard = STATE.lock();
    let Some(state) = guard.as_mut() else { return };
    let key = key_for(state, filename, is_cjs);
    if state.entries.contains_key(&key) {
        return;
    }
    let mut entry = Entry {
        filename: filename.into(),
        is_cjs,
        code_hash: [0u8; HASH_SIZE],
        code_size: 0,
        code: None,
        blob: None,
        persisted: false,
    };
    // The read is attempted (and logged) like Node; without current code the
    // stored entry can never validate, so this only populates the log.
    read_cache_file(state, key, &mut entry, None);
    entry.blob = None;
    state.entries.insert(key, entry);
}

fn cache_basename(key: u64) -> [u8; 16] {
    let mut out = [0u8; 16];
    bun_core::fmt::bytes_to_hex_lower(&key.to_be_bytes(), &mut out);
    out
}

/// Blob's byte offset in the cache file: header + stored code, padded to the
/// decoder's 128-byte alignment so a page-aligned mapping keeps the blob
/// aligned in place.
fn blob_file_offset(code_size: u32) -> u64 {
    (HEADER_SIZE as u64 + u64::from(code_size)).next_multiple_of(BLOB_ALIGN as u64)
}

/// Unmaps on drop unless [`MapGuard::take`]n for a blob that keeps the
/// mapping alive.
struct MapGuard(Option<(core::ptr::NonNull<u8>, usize)>);

impl MapGuard {
    fn take(&mut self) -> Option<(core::ptr::NonNull<u8>, usize)> {
        self.0.take()
    }
}

impl Drop for MapGuard {
    fn drop(&mut self) {
        if let Some((base, map_len)) = self.0.take() {
            let _ = sys::munmap(base.as_ptr(), map_len);
        }
    }
}

fn read_cache_file(state: &CacheState, key: u64, entry: &mut Entry, code: Option<&[u8]>) {
    let basename = cache_basename(key);
    let mut line = String::new();
    if LOG_ENABLED.load(Ordering::Relaxed) {
        line = format!(
            "[compile cache] reading cache from {}{}{} for {} {}...",
            state.dir.as_bstr(),
            SEP as char,
            core::str::from_utf8(&basename).expect("hex"),
            type_name(entry.is_cjs),
            display_name(&entry.filename, entry.is_cjs)
        );
    }
    // Emits `line` + lazily-built `tail` once the outcome is known.
    let finish = |line: String, tail: &dyn Fn() -> String| {
        if LOG_ENABLED.load(Ordering::Relaxed) {
            log_str(&line);
            log_str(&tail());
        }
    };

    let file = match state
        .dir_handle
        .open_file(&basename, O::RDONLY | O::CLOEXEC | O::NOFOLLOW, 0)
    {
        Ok(f) => f,
        Err(e) => {
            finish(line, &|| errno_tail(&e));
            return;
        }
    };
    // `sys::File` closes its fd on drop.

    let total = match file.get_end_pos() {
        Ok(n) => n as usize,
        Err(e) => {
            finish(line, &|| errno_tail(&e));
            return;
        }
    };
    if total < HEADER_SIZE {
        finish(line, &|| "reading header failed\n".into());
        return;
    }

    // Map the file so an accepted blob is handed to JSC zero-copy; fall back
    // to a heap read when mmap is unavailable (Windows) or fails.
    #[cfg(unix)]
    let (prot, flags) = (libc::PROT_READ, libc::MAP_PRIVATE);
    #[cfg(not(unix))]
    let (prot, flags) = (0i32, 0i32);
    let mut map_guard = MapGuard(
        sys::mmap(core::ptr::null_mut(), total, prot, flags, file.fd(), 0)
            .ok()
            .and_then(core::ptr::NonNull::new)
            .map(|base| (base, total)),
    );
    let heap_contents;
    let bytes: &[u8] = match &map_guard.0 {
        // SAFETY: the mapping is `total` bytes and outlives this borrow.
        Some((base, _)) => unsafe { core::slice::from_raw_parts(base.as_ptr(), total) },
        None => {
            let mut contents: Vec<u8> = Vec::new();
            if contents.try_reserve_exact(total).is_err() {
                finish(line, &|| "allocation failed\n".into());
                return;
            }
            contents.resize(total, 0);
            if file.pread_all(&mut contents, 0).ok() != Some(total) {
                finish(line, &|| "reading header failed\n".into());
                return;
            }
            heap_contents = contents;
            &heap_contents
        }
    };

    let magic = u32::from_le_bytes(bytes[0..4].try_into().expect("4 bytes"));
    let code_size = u32::from_le_bytes(bytes[4..8].try_into().expect("4 bytes"));
    let cache_size = u32::from_le_bytes(bytes[8..12].try_into().expect("4 bytes"));
    let code_hash: &[u8; HASH_SIZE] = bytes[12..12 + HASH_SIZE].try_into().expect("32 bytes");
    let cache_hash: &[u8; HASH_SIZE] = bytes[12 + HASH_SIZE..HEADER_SIZE]
        .try_into()
        .expect("32 bytes");
    if LOG_ENABLED.load(Ordering::Relaxed) {
        line.push_str(&format!(
            "[{magic} {code_size} {cache_size} {} {}]...",
            hex(code_hash),
            hex(cache_hash)
        ));
    }

    if magic != MAGIC {
        finish(line, &|| {
            format!("magic number mismatch: expected {MAGIC}, actual {magic}\n")
        });
        return;
    }
    if code_size != entry.code_size {
        finish(line, &|| {
            format!(
                "code size mismatch: expected {}, actual {code_size}\n",
                entry.code_size
            )
        });
        return;
    }
    if code_hash != &entry.code_hash {
        finish(line, &|| {
            format!(
                "code hash mismatch: expected {}, actual {}\n",
                hex(&entry.code_hash),
                hex(code_hash)
            )
        });
        return;
    }
    let blob_off = blob_file_offset(code_size);
    let expected_total = blob_off + u64::from(cache_size);
    if total as u64 != expected_total {
        finish(line, &|| {
            format!(
                "cache size mismatch: expected {cache_size}, actual {}\n",
                (total as u64).saturating_sub(blob_off)
            )
        });
        return;
    }
    let Some(code) = code else {
        // Parse-failure probe: no current code to compare against.
        finish(line, &|| {
            format!(
                "code hash mismatch: expected 0, actual {}\n",
                hex(code_hash)
            )
        });
        return;
    };

    // Stored code: byte-compare against the current post-transpile text so
    // "accepted" is exact, not merely hash-equal.
    if &bytes[HEADER_SIZE..HEADER_SIZE + code_size as usize] != code {
        finish(line, &|| {
            format!(
                "code hash mismatch: expected {}, actual {}\n",
                hex(&entry.code_hash),
                hex(code_hash)
            )
        });
        return;
    }

    let blob_bytes = &bytes[blob_off as usize..][..cache_size as usize];
    let actual_cache_hash = sha256(blob_bytes);
    if &actual_cache_hash != cache_hash {
        finish(line, &|| {
            format!(
                "cache hash mismatch: expected {}, actual {}\n",
                hex(cache_hash),
                hex(&actual_cache_hash)
            )
        });
        return;
    }

    // The decoder requires the blob 128-aligned. The mapping base is
    // page-aligned (every supported page size is a multiple of 128) and
    // `blob_off` is a multiple of 128 by construction, but a miss here would
    // be a JSC assert or segfault, so verify instead of assuming.
    let map_is_aligned = map_guard.0.as_ref().is_some_and(|(base, _)| {
        (base.as_ptr() as usize + blob_off as usize).is_multiple_of(BLOB_ALIGN)
    });
    let blob = if map_is_aligned {
        let (base, map_len) = map_guard.take().expect("checked above");
        // SAFETY: `blob_off + cache_size == map_len` was just validated.
        let ptr =
            unsafe { core::ptr::NonNull::new_unchecked(base.as_ptr().add(blob_off as usize)) };
        AlignedBlob {
            ptr,
            len: cache_size as usize,
            backing: Backing::Map { base, map_len },
        }
    } else {
        // No mapping, or the blob would be misaligned in it: copy to an
        // aligned heap buffer instead (map_guard unmaps on return).
        let Some(mut blob) = AlignedBlob::new_uninit(cache_size as usize) else {
            finish(line, &|| "allocation failed\n".into());
            return;
        };
        blob.as_mut_slice().copy_from_slice(blob_bytes);
        blob
    };
    finish(line, &|| format!(" success, size={cache_size}\n"));
    entry.blob = Some(blob);
}

// ──────────────────────────────────────────────────────────────────────────
// Persist (exit + flush)
// ──────────────────────────────────────────────────────────────────────────

/// Bytecode generation runs on one long-lived worker thread with its own JSC
/// VM (`getVMForBytecodeCache`), mirroring `bun build --bytecode`'s bundler
/// threads, so only a single extra VM ever exists.
struct GenJob {
    format: Format,
    code: Box<[u8]>,
    url: Box<[u8]>,
    resp: std::sync::mpsc::SyncSender<Option<Box<[u8]>>>,
}

fn generate_bytecode(format: Format, code: &[u8], url: &[u8]) -> Option<Box<[u8]>> {
    use std::sync::mpsc;
    static WORKER: Mutex<Option<mpsc::Sender<GenJob>>> = Mutex::new(None);

    let (resp_tx, resp_rx) = mpsc::sync_channel(1);
    {
        let mut guard = WORKER.lock();
        if guard.is_none() {
            let (tx, rx) = mpsc::channel::<GenJob>();
            let spawned = std::thread::Builder::new()
                .name("BunCompileCache".to_string())
                // JSC parsing of large modules needs a deep stack.
                .stack_size(16 * 1024 * 1024)
                .spawn(move || {
                    for job in rx {
                        let url = BunString::clone_utf8(&job.url);
                        let result = crate::cached_bytecode::__bun_jsc_generate_cached_bytecode(
                            job.format,
                            &job.code,
                            &url,
                            u32::MAX,
                            None,
                        );
                        let _ = job.resp.send(result);
                    }
                });
            match spawned {
                Ok(_) => *guard = Some(tx),
                Err(_) => return None,
            }
        }
        let tx = guard.as_ref().expect("set above");
        if tx
            .send(GenJob {
                format,
                code: code.into(),
                url: url.into(),
                resp: resp_tx,
            })
            .is_err()
        {
            return None;
        }
    }
    resp_rx.recv().ok().flatten()
}

/// One unit of persist work, snapshotted out of `STATE` so bytecode generation runs with the lock
/// dropped. `code` is moved out (concurrent `fetch` sees `code: None` and skips). Keys hash
/// `(is_cjs, filename)` — not content — so Phase 3 re-checks `code_hash` before touching the entry.
struct PersistJob {
    key: u64,
    format: Format,
    code: Box<[u8]>,
    filename: Box<[u8]>,
    is_cjs: bool,
    code_size: u32,
    code_hash: [u8; HASH_SIZE],
}

/// Phase 1 (locked): decide what needs persisting and move the source code
/// out of the entries.
fn collect_persist_jobs(state: &mut CacheState) -> Vec<PersistJob> {
    let mut jobs = Vec::new();
    let logging = LOG_ENABLED.load(Ordering::Relaxed);
    for (&key, entry) in state.entries.iter_mut() {
        let tname = type_name(entry.is_cjs);
        let name = if logging {
            display_name(&entry.filename, entry.is_cjs)
        } else {
            String::new()
        };
        if entry.persisted {
            cclog!(
                "[compile cache] skip persisting {tname} {name} because cache was already persisted\n"
            );
            continue;
        }
        if entry.blob.is_some() {
            // The on-disk cache was accepted as-is.
            cclog!("[compile cache] skip persisting {tname} {name} because cache was the same\n");
            continue;
        }
        let Some(code) = entry.code.take() else {
            cclog!(
                "[compile cache] skip persisting {tname} {name} because the cache was not initialized\n"
            );
            continue;
        };
        jobs.push(PersistJob {
            key,
            format: if entry.is_cjs {
                Format::Cjs
            } else {
                Format::Esm
            },
            code,
            filename: entry.filename.clone(),
            is_cjs: entry.is_cjs,
            code_size: entry.code_size,
            code_hash: entry.code_hash,
        });
    }
    jobs
}

/// Phase 3 (locked): write one generated blob to disk. `Ok(())` on success;
/// on any I/O failure returns `Err(())` and the caller restores the taken
/// `entry.code` and leaves `persisted` false so a later pass may retry.
fn write_persist_job_locked(
    state: &mut CacheState,
    job: &PersistJob,
    blob: &[u8],
) -> Result<(), ()> {
    let logging = LOG_ENABLED.load(Ordering::Relaxed);
    let tname = type_name(job.is_cjs);
    let name = if logging {
        display_name(&job.filename, job.is_cjs)
    } else {
        String::new()
    };

    let cache_size = blob.len() as u32;
    let cache_hash = sha256(blob);

    let basename = cache_basename(job.key);
    let mut tmpname_buf = PathBuffer::uninit();
    let tmpname_zstr: &ZStr =
        match bun_resolver::fs::FileSystem::tmpname(&basename, &mut tmpname_buf[..], job.key) {
            Ok(z) => z,
            Err(_) => return Err(()),
        };

    cclog!("[compile cache] Creating temporary file for cache of {name} ({tname})...");

    // 0600 like Node: entries contain the module's post-transpile source.
    let mut tmpfile =
        match sys::Tmpfile::create_with_mode(state.dir_handle.fd(), tmpname_zstr, 0o600) {
            Ok(t) => t,
            Err(e) => {
                cclog!("failed. {}\n", errno_name(&e));
                return Err(());
            }
        };
    let _close = sys::CloseOnDrop::new(tmpfile.fd);

    let tmp_display = if logging {
        format!(
            "{}{}{}",
            state.dir.as_bstr(),
            SEP as char,
            tmpname_zstr.as_bytes().as_bstr()
        )
    } else {
        String::new()
    };
    cclog!(" -> {tmp_display}\n");
    cclog!(
        "[compile cache] writing cache for {tname} {name} to temporary file {tmp_display} [{MAGIC} {} {cache_size} {} {}]...",
        job.code_size,
        hex(&job.code_hash),
        hex(&cache_hash)
    );

    let mut header_bytes = [0u8; HEADER_SIZE];
    header_bytes[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    header_bytes[4..8].copy_from_slice(&job.code_size.to_le_bytes());
    header_bytes[8..12].copy_from_slice(&cache_size.to_le_bytes());
    header_bytes[12..12 + HASH_SIZE].copy_from_slice(&job.code_hash);
    header_bytes[12 + HASH_SIZE..HEADER_SIZE].copy_from_slice(&cache_hash);
    // ManuallyDrop: the fd is owned by `_close` above.
    let file = core::mem::ManuallyDrop::new(sys::File::from_fd(tmpfile.fd));
    let write_all = || -> sys::Maybe<()> {
        file.pwrite_all(&header_bytes, 0)?;
        file.pwrite_all(&job.code, HEADER_SIZE as i64)?;
        // The gap up to the 128-aligned blob offset is a hole (zeros).
        file.pwrite_all(blob, blob_file_offset(job.code_size) as i64)?;
        Ok(())
    };
    if let Err(e) = write_all() {
        cclog!("failed: {}\n", errno_name(&e));
        let _ = sys::unlinkat(state.dir_handle.fd(), tmpname_zstr);
        return Err(());
    }
    cclog!("success\n");

    let mut dest_z = [0u8; 17];
    dest_z[..16].copy_from_slice(&basename);
    let dest_zstr = ZStr::from_buf(&dest_z, 16);
    let final_display = if logging {
        format!(
            "{}{}{}",
            state.dir.as_bstr(),
            SEP as char,
            core::str::from_utf8(&basename).expect("hex")
        )
    } else {
        String::new()
    };
    cclog!("[compile cache] Renaming {tmp_display} to {final_display}...");
    if let Err(e) = tmpfile.finish(dest_zstr) {
        cclog!("failed: {}\n", errno_name(&e));
        let _ = sys::unlinkat(state.dir_handle.fd(), tmpname_zstr);
        return Err(());
    }
    cclog!("success\n");
    Ok(())
}

/// Full persist pass. `STATE` is held only for snapshot and file-write phases; bytecode
/// generation runs with the lock dropped so concurrent module loads are not stalled.
fn persist_pass() {
    // Phase 1: snapshot under the lock.
    let jobs = {
        let mut guard = STATE.lock();
        let Some(state) = guard.as_mut() else { return };
        collect_persist_jobs(state)
    };

    // Phase 2: generate bytecode, unlocked.
    let mut generated: Vec<(PersistJob, Option<Box<[u8]>>)> = Vec::with_capacity(jobs.len());
    for job in jobs {
        let blob = generate_bytecode(job.format, &job.code, &job.filename);
        if blob.is_none() {
            cclog!(
                "[compile cache] generating cache for {} {} failed, skipping\n",
                type_name(job.is_cjs),
                display_name(&job.filename, job.is_cjs)
            );
        }
        generated.push((job, blob));
    }

    // Phase 3: write files and update entries under the lock.
    let mut guard = STATE.lock();
    let Some(state) = guard.as_mut() else { return };
    for (job, blob) in generated {
        let Some(blob) = blob else {
            // Do not retry on the next persist pass. Skip if the entry now
            // holds different content (file changed and was re-fetched).
            if let Some(entry) = state.entries.get_mut(&job.key) {
                if entry.code_hash == job.code_hash && entry.code_size == job.code_size {
                    entry.persisted = true;
                }
            }
            continue;
        };
        let wrote = write_persist_job_locked(state, &job, &blob);
        let Some(entry) = state.entries.get_mut(&job.key) else {
            continue;
        };
        if entry.code_hash != job.code_hash || entry.code_size != job.code_size {
            // The entry was repopulated with different content mid-pass; the
            // write we just did is stale (the header check corrects it on
            // the next load) and the taken code must not overwrite the new.
            continue;
        }
        match wrote {
            Ok(()) => entry.persisted = true,
            // Keep the source so a later pass can retry, matching the old
            // in-place behavior for failed writes.
            Err(()) => {
                if entry.code.is_none() {
                    entry.code = Some(job.code);
                }
            }
        }
    }

    cclog!("[compile cache] Clear deserialized cache.\n");
    // Drop persisted code copies; blobs stay alive (JSC providers reference
    // them) and entries stay so unchanged re-fetches keep hitting in memory.
    for entry in state.entries.values_mut() {
        if entry.persisted {
            entry.code = None;
        }
    }
}

/// `module.flushCompileCache()`.
pub fn flush() {
    if !is_enabled() {
        return;
    }
    cclog!("[compile cache] module.flushCompileCache() requested.\n");
    persist_pass();
    cclog!("[compile cache] module.flushCompileCache() finished.\n");
}

/// Exit-time persist; runs once, from the main VM's `on_exit`.
pub fn persist_at_exit() {
    static DONE: AtomicBool = AtomicBool::new(false);
    if !is_enabled() || DONE.swap(true, Ordering::Relaxed) {
        return;
    }
    persist_now();
}

/// Non-latching sibling of [`persist_at_exit`] for paths where the process may survive (e.g. a
/// self-directed signal that proves non-fatal). Leaves the exit latch unset so a later real exit
/// still persists modules loaded after this point.
pub fn persist_now() {
    if !is_enabled() {
        return;
    }
    persist_pass();
}

// ──────────────────────────────────────────────────────────────────────────
// C++ API (NodeModuleModule.cpp)
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
/// # Safety
/// `dir` is null or a live `BunString`; both out-params are valid for write.
pub unsafe extern "C" fn Bun__NodeCompileCache__enable(
    dir: *const BunString,
    // -1 = not specified (fall back to NODE_COMPILE_CACHE_PORTABLE).
    portable: i32,
    out_directory: *mut BunString,
    out_message: *mut BunString,
) -> i32 {
    // SAFETY: C++ passes null or a live BunString plus valid out-params.
    let dir_utf8 = unsafe { dir.as_ref() }.map(|d| d.to_utf8());
    let dir_slice = dir_utf8.as_ref().map(|d| d.slice());
    let result = enable(
        dir_slice,
        if portable < 0 {
            None
        } else {
            Some(portable != 0)
        },
    );
    if let Some(directory) = result.directory {
        // SAFETY: out-param is valid for write per fn contract.
        unsafe { out_directory.write(BunString::clone_utf8(&directory)) };
    }
    if let Some(message) = result.message {
        // SAFETY: out-param is valid for write per fn contract.
        unsafe { out_message.write(BunString::clone_utf8(message.as_bytes())) };
    }
    result.status
}

/// The C++ caller `transferToJS()`s the result.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeCompileCache__getDir() -> BunString {
    match get_dir() {
        Some(dir) => BunString::clone_utf8(&dir),
        None => BunString::EMPTY,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeCompileCache__flush() {
    flush();
}
