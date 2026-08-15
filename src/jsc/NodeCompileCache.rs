//! Node-compatible on-disk compile cache (`NODE_COMPILE_CACHE`): entries in a
//! version-tagged subdir store the post-transpile source + JSC bytecode; the
//! stored source is byte-compared on load so stale caches recompile normally.
//!
//! A miss does not generate anything itself. [`fetch`] hands the module's
//! `SourceProvider` a [`Fetch::Collect`] ticket and JSC's `cacheBytecode` /
//! `updateCache` provider hooks (ZigSourceProvider.cpp) record the top-level
//! block plus every function the program actually compiles, as the main VM
//! compiles them. The provider attaches itself to the entry once the top-level
//! block exists; persisting then only flattens those bytes and writes the
//! file, so exit costs I/O proportional to the code that ran, like Node's
//! `v8::ScriptCompiler::CreateCodeCache`, instead of re-parsing and eagerly
//! compiling every loaded module.

use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};

use bstr::ByteSlice;
use bun_boringssl::c as boring;
use bun_collections::{HashMap, IdentityContext};
use bun_core::String as BunString;
use bun_core::{Mutex, ZStr, env_var};
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP};
use bun_sys::{self as sys, Fd, O};

use crate::ResolvedSource;

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
// `sys::Dir` fd is just an integer handle, and a `Pending::Provider` pointer is
// only compared or passed back to C++ (see `Pending`), never dereferenced here.
unsafe impl Send for CacheState {}

/// Process-unique id per `Entry` instance. A provider created for one version
/// of a file must not deliver its bytecode to the entry of a later version
/// fetched under the same key, so attach/detach carry the id they were
/// issued with ([`Fetch::Collect`]). 0 is reserved for "no collection".
static NEXT_ENTRY_ID: AtomicU64 = AtomicU64::new(1);

struct Entry {
    id: u64,
    /// `path.text` of the module (absolute file path).
    filename: Box<[u8]>,
    is_cjs: bool,
    code_hash: [u8; HASH_SIZE],
    code_size: u32,
    /// Post-transpile text, written into the entry file; `None` when the
    /// module never transpiled successfully (parse error) — mirrors Node's
    /// "not initialized" state — or once the entry is persisted.
    code: Option<Box<[u8]>>,
    /// Deserialized bytecode blob handed to JSC (the cache was accepted).
    /// Kept alive for the process — `ZigSourceProvider` wraps it, no copy.
    blob: Option<AlignedBlob>,
    /// Where a miss's bytecode comes from at persist time.
    pending: Pending,
    persisted: bool,
}

enum Pending {
    None,
    /// The `Zig::SourceProvider` collecting this entry's bytecode. Valid until
    /// the provider's destructor calls `Bun__NodeCompileCache__detach` (which
    /// needs `STATE`, so a persist pass holding the lock can still commit it)
    /// or a persist pass commits it, whichever comes first; both reset this to
    /// `None`.
    Provider(*const c_void),
    /// Already-flattened bytecode: delivered by a provider that went away
    /// (worker teardown), or kept back from a persist whose write failed.
    Blob(Box<[u8]>),
}

impl Entry {
    fn new(filename: &[u8], is_cjs: bool, code_hash: [u8; HASH_SIZE], code_size: u32) -> Self {
        Self {
            id: NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed),
            filename: filename.into(),
            is_cjs,
            code_hash,
            code_size,
            code: None,
            blob: None,
            pending: Pending::None,
            persisted: false,
        }
    }

    /// A miss that no provider is collecting for yet.
    fn wants_collection(&self) -> bool {
        self.blob.is_none() && !self.persisted && matches!(self.pending, Pending::None)
    }

    /// Takes the flattened bytecode for this miss, ending collection. Caller
    /// holds `STATE` (see [`Pending::Provider`]).
    fn take_bytecode(&mut self) -> Option<Box<[u8]>> {
        match core::mem::replace(&mut self.pending, Pending::None) {
            Pending::None => None,
            Pending::Blob(blob) => Some(blob),
            Pending::Provider(provider) => {
                let mut out: Option<Box<[u8]>> = None;
                // SAFETY: the provider is attached to this entry and the caller
                // holds `STATE`, so it cannot have been freed (its destructor
                // detaches under `STATE` first). `out` outlives the synchronous
                // call and is only written by `commit_sink`.
                unsafe {
                    ZigSourceProvider__commitNodeCompileCache(
                        provider,
                        (&raw mut out).cast(),
                        commit_sink,
                    );
                }
                out
            }
        }
    }
}

unsafe extern "C" {
    /// Flattens what the provider collected into a blob, invokes `sink` with it
    /// (at most once, synchronously, never empty), and stops collecting.
    fn ZigSourceProvider__commitNodeCompileCache(
        provider: *const c_void,
        context: *mut c_void,
        sink: unsafe extern "C" fn(context: *mut c_void, bytecode: *const u8, len: usize),
    );
}

unsafe extern "C" fn commit_sink(context: *mut c_void, bytecode: *const u8, len: usize) {
    // SAFETY: `context` is the `out` slot `take_bytecode` passed alongside this
    // function, and C++ hands `len` readable bytes that live for the duration
    // of the call.
    unsafe {
        *context.cast::<Option<Box<[u8]>>>() = Some(bun_core::ffi::slice(bytecode, len).into());
    }
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

/// Outcome of [`fetch`], applied to the module's `ResolvedSource` so the C++
/// `SourceProvider` either loads the cached bytecode or collects new bytecode.
pub enum Fetch {
    /// The on-disk entry matches `code`. The blob stays valid for the process
    /// (the entry map owns it).
    Accepted { ptr: *mut u8, len: usize },
    /// Nothing usable on disk: the provider records what JSC compiles and
    /// attaches it to this entry for the next persist.
    Collect { key: u64, entry_id: u64 },
}

impl Fetch {
    fn for_entry(key: u64, entry: &Entry) -> Option<Self> {
        if let Some(blob) = &entry.blob {
            return Some(Self::Accepted {
                ptr: blob.ptr.as_ptr(),
                len: blob.len,
            });
        }
        entry.wants_collection().then_some(Self::Collect {
            key,
            entry_id: entry.id,
        })
    }

    pub fn apply(self, source: &mut ResolvedSource) {
        match self {
            Self::Accepted { ptr, len } => {
                source.bytecode_cache = ptr;
                source.bytecode_cache_size = len;
            }
            Self::Collect { key, entry_id } => {
                source.node_compile_cache_key = key;
                source.node_compile_cache_entry_id = entry_id;
            }
        }
    }
}

/// Module-fetch hook: register/refresh the entry for `filename`, validating
/// the on-disk cache against `code` (post-transpile text).
pub fn fetch(filename: &[u8], is_cjs: bool, code: &[u8]) -> Option<Fetch> {
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
            // Same module, unchanged code (e.g. re-required): reuse. A miss
            // whose earlier provider never compiled is offered to this one.
            return Fetch::for_entry(key, entry);
        }
    }

    let mut entry = Entry::new(filename, is_cjs, code_hash, code_size);

    read_cache_file(state, key, &mut entry, Some(code));

    if entry.blob.is_some() {
        cclog!(
            "[compile cache] code cache for {} {} was accepted, keeping the in-memory entry\n",
            type_name(is_cjs),
            display_name(filename, is_cjs)
        );
    } else {
        cclog!(
            "[compile cache] code cache for {} {} was not initialized, initializing the in-memory entry\n",
            type_name(is_cjs),
            display_name(filename, is_cjs)
        );
        entry.code = Some(code.into());
    }
    let result = Fetch::for_entry(key, &entry);
    // A replaced entry's provider, if any, keeps collecting into nothing: its
    // detach carries the old entry id and is ignored.
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
    let mut entry = Entry::new(filename, is_cjs, [0u8; HASH_SIZE], 0);
    // The read is attempted (and logged) like Node; without current code the
    // stored entry can never validate, so this only populates the log.
    read_cache_file(state, key, &mut entry, None);
    entry.blob = None;
    state.entries.insert(key, entry);
}

// ──────────────────────────────────────────────────────────────────────────
// Provider attachment (ZigSourceProvider.cpp)
// ──────────────────────────────────────────────────────────────────────────

/// The provider holding a [`Fetch::Collect`] ticket has recorded the
/// top-level block. `false` when the ticket is stale (the file was re-fetched
/// with different content) or another provider got there first; the provider
/// then drops what it collected.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeCompileCache__attach(key: u64, entry_id: u64, provider: *const c_void) -> bool {
    let mut guard = STATE.lock();
    let Some(entry) = guard.as_mut().and_then(|state| state.entries.get_mut(&key)) else {
        return false;
    };
    if entry.id != entry_id || !entry.wants_collection() {
        return false;
    }
    entry.pending = Pending::Provider(provider);
    true
}

/// An attached provider is being destroyed: forget its pointer and keep its
/// bytecode (a copy; `bytecode` dies with the call) for the next persist.
/// Empty `bytecode` means a persist pass already committed it.
///
/// # Safety
/// `bytecode` points to `len` readable bytes (null only when `len == 0`).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__NodeCompileCache__detach(
    key: u64,
    entry_id: u64,
    provider: *const c_void,
    bytecode: *const u8,
    len: usize,
) {
    // SAFETY: per fn contract.
    let bytecode = unsafe { bun_core::ffi::slice(bytecode, len) };
    let mut guard = STATE.lock();
    let Some(entry) = guard.as_mut().and_then(|state| state.entries.get_mut(&key)) else {
        return;
    };
    if entry.id != entry_id {
        return;
    }
    if matches!(entry.pending, Pending::Provider(attached) if attached == provider) {
        entry.pending = Pending::None;
    }
    // Never displace a newer provider or a blob a failed write is retrying:
    // anything else attached to this entry id was built from the same code.
    if !bytecode.is_empty() && !entry.persisted && matches!(entry.pending, Pending::None) {
        entry.pending = Pending::Blob(bytecode.into());
    }
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
            let mut contents = vec![0u8; total];
            match file.pread_all(&mut contents, 0) {
                Ok(n) if n == total => {}
                _ => {
                    finish(line, &|| "reading header failed\n".into());
                    return;
                }
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

/// Writes one entry file (`header | code | hole to 128 | blob`) via
/// tmpfile + rename. `Err(())` on any I/O failure, already logged.
fn write_entry_file(
    dir: &[u8],
    dir_handle: &sys::Dir,
    key: u64,
    entry: &Entry,
    code: &[u8],
    blob: &[u8],
) -> Result<(), ()> {
    let logging = LOG_ENABLED.load(Ordering::Relaxed);
    let tname = type_name(entry.is_cjs);
    let name = if logging {
        display_name(&entry.filename, entry.is_cjs)
    } else {
        String::new()
    };

    let Ok(cache_size) = u32::try_from(blob.len()) else {
        return Err(());
    };
    let cache_hash = sha256(blob);

    let basename = cache_basename(key);
    let mut tmpname_buf = PathBuffer::uninit();
    let tmpname_zstr: &ZStr =
        match bun_resolver::fs::FileSystem::tmpname(&basename, &mut tmpname_buf[..], key) {
            Ok(z) => z,
            Err(_) => return Err(()),
        };

    cclog!("[compile cache] Creating temporary file for cache of {name} ({tname})...");

    // 0600 like Node: entries contain the module's post-transpile source.
    let mut tmpfile = match sys::Tmpfile::create_with_mode(dir_handle.fd(), tmpname_zstr, 0o600) {
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
            dir.as_bstr(),
            SEP as char,
            tmpname_zstr.as_bytes().as_bstr()
        )
    } else {
        String::new()
    };
    cclog!(" -> {tmp_display}\n");
    cclog!(
        "[compile cache] writing cache for {tname} {name} to temporary file {tmp_display} [{MAGIC} {} {cache_size} {} {}]...",
        entry.code_size,
        hex(&entry.code_hash),
        hex(&cache_hash)
    );

    let mut header_bytes = [0u8; HEADER_SIZE];
    header_bytes[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    header_bytes[4..8].copy_from_slice(&entry.code_size.to_le_bytes());
    header_bytes[8..12].copy_from_slice(&cache_size.to_le_bytes());
    header_bytes[12..12 + HASH_SIZE].copy_from_slice(&entry.code_hash);
    header_bytes[12 + HASH_SIZE..HEADER_SIZE].copy_from_slice(&cache_hash);
    // ManuallyDrop: the fd is owned by `_close` above.
    let file = core::mem::ManuallyDrop::new(sys::File::from_fd(tmpfile.fd));
    let write_all = || -> sys::Maybe<()> {
        file.pwrite_all(&header_bytes, 0)?;
        file.pwrite_all(code, HEADER_SIZE as i64)?;
        // The gap up to the 128-aligned blob offset is a hole (zeros).
        file.pwrite_all(blob, blob_file_offset(entry.code_size) as i64)?;
        Ok(())
    };
    if let Err(e) = write_all() {
        cclog!("failed: {}\n", errno_name(&e));
        let _ = sys::unlinkat(dir_handle.fd(), tmpname_zstr);
        return Err(());
    }
    cclog!("success\n");

    let mut dest_z = [0u8; 17];
    dest_z[..16].copy_from_slice(&basename);
    let dest_zstr = ZStr::from_buf(&dest_z, 16);
    let final_display = if logging {
        format!(
            "{}{}{}",
            dir.as_bstr(),
            SEP as char,
            core::str::from_utf8(&basename).expect("hex")
        )
    } else {
        String::new()
    };
    cclog!("[compile cache] Renaming {tmp_display} to {final_display}...");
    if let Err(e) = tmpfile.finish(dest_zstr) {
        cclog!("failed: {}\n", errno_name(&e));
        let _ = sys::unlinkat(dir_handle.fd(), tmpname_zstr);
        return Err(());
    }
    cclog!("success\n");
    Ok(())
}

/// Writes every miss whose provider has delivered (or can deliver) bytecode.
/// Runs under `STATE` throughout: committing a provider is a memcpy of bytes
/// it already encoded, so module loads on other threads stall only for the
/// file writes, and holding the lock is what keeps `Pending::Provider`
/// pointers alive across the commit.
fn persist_pass() {
    let mut guard = STATE.lock();
    let Some(state) = guard.as_mut() else { return };
    let dir: &[u8] = &state.dir;
    let dir_handle = &state.dir_handle;
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
        // No bytecode: the module was fetched but its top-level block has not
        // been compiled (yet). No code: it never transpiled.
        let bytecode = entry.take_bytecode();
        let (Some(bytecode), Some(code)) = (bytecode, entry.code.as_deref()) else {
            cclog!(
                "[compile cache] skip persisting {tname} {name} because the cache was not initialized\n"
            );
            continue;
        };
        match write_entry_file(dir, dir_handle, key, entry, code, &bytecode) {
            Ok(()) => entry.persisted = true,
            // Keep the bytecode so a later pass (flush, exit) retries the write.
            Err(()) => entry.pending = Pending::Blob(bytecode),
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
        unsafe { *out_directory = BunString::clone_utf8(&directory) };
    }
    if let Some(message) = result.message {
        // SAFETY: out-param is valid for write per fn contract.
        unsafe { *out_message = BunString::clone_utf8(message.as_bytes()) };
    }
    result.status
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeCompileCache__getDir() -> BunString {
    match get_dir() {
        Some(dir) => BunString::clone_utf8(&dir),
        None => BunString::empty(),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeCompileCache__flush() {
    flush();
}
