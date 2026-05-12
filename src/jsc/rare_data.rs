use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::sync::Arc;

use crate::strong::Optional as Strong;
use crate::virtual_machine::VirtualMachine;
use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_boringssl::c as boring;
use bun_collections::StringArrayHashMap;
use bun_core::strings;
use bun_core::{Mutex, Output};
use bun_event_loop::MiniEventLoop::__bun_stdio_blob_store_new;
use bun_http::MimeType as mime_type;
use bun_io::{self as Async};
use bun_paths::MAX_PATH_BYTES;
use bun_sys::{self as syscall, Fd, FdExt as _, Mode};
use bun_uws::{self as uws, SocketGroup, SslCtx};

use bun_event_loop::SpawnSyncEventLoop::SpawnSyncEventLoop;

use super::uuid::UUID;

// ──────────────────────────────────────────────────────────────────────────
// Layering note (§Dispatch / cycle-break).
//
// `RareData` is a bag of lazy-init optional subsystems whose concrete types
// live in higher-tier crates (`bun_runtime`, `bun_http_jsc`, `bun_sql_jsc`).
// Per docs/PORTING.md §Dispatch the low tier stores **erased** pointers; the
// high tier owns the typed accessors:
//
//   - `mysql_context` / `postgresql_context` / `ssl_ctx_cache` / `editor_context`
//     → moved to `bun_runtime::jsc_hooks::RuntimeState` (already there).
//   - `cron_jobs` / `node_fs_stat_watcher_scheduler` / `global_dns_data` /
//     `websocket_deflate` → erased `*mut c_void` slots; high tier lazy-inits.
//   - `fs_watchers_for_isolation` / `stat_watchers_for_isolation` → per-entry
//     (ptr, close-fn) so `close_all_watchers_for_isolation` works without
//     naming the watcher types.
//   - `stdin/stdout/stderr_store` → erased `*mut blob::Store` constructed via
//     `__bun_stdio_blob_store_new` (link-time extern; same fn MiniEventLoop uses).
//   - `valkey_context` was a stateless ZST with empty `deinit`; dropped.
//   - `s3_default_client` / `default_client_ssl_ctx` / typed HotMap get/insert
//     → bodies live in `bun_runtime` (they call high-tier ctors); RareData
//     keeps only the storage slots.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// HotMap
//
// Low-tier storage: `(tag, ptr)` per docs/PORTING.md §Dispatch (hot path). The
// concrete payload list (HTTPServer, HTTPSServer, TCPSocket, …) and the typed
// `get<T>` / `insert<T>` accessors live in `bun_runtime::api::server` — naming
// those types here would invert the crate DAG. `bun_runtime` matches on `tag`
// and casts `ptr` itself.
// ──────────────────────────────────────────────────────────────────────────

pub struct HotMap {
    _map: StringArrayHashMap<HotMapEntry>,
}

/// Erased `(tag, ptr)` payload — concrete variant list lives in `bun_runtime`.
#[derive(Copy, Clone)]
pub struct HotMapEntry {
    pub tag: u8,
    pub ptr: *mut (),
}
impl Default for HotMapEntry {
    fn default() -> Self {
        Self {
            tag: 0,
            ptr: core::ptr::null_mut(),
        }
    }
}

impl HotMap {
    pub fn init() -> HotMap {
        HotMap {
            _map: StringArrayHashMap::new(),
        }
    }

    pub fn get_entry(&self, key: &[u8]) -> Option<HotMapEntry> {
        self._map.get(key).copied()
    }

    /// Untyped insert — typed `insert<T>` lives in `bun_runtime` where the
    /// `TaggedPointerUnion` payload list is named.
    pub fn insert_raw(&mut self, key: &[u8], entry: HotMapEntry) {
        let gop = bun_core::handle_oom(self._map.get_or_put(key));
        if gop.found_existing {
            panic!("HotMap already contains key");
        }
        // PORT NOTE: `get_or_put` already boxed the key; Zig wrote
        // `entry.key_ptr.* = dupe(key)` because its map didn't own keys.
        *gop.value_ptr = entry;
    }

    pub fn remove(&mut self, key: &[u8]) {
        // PORT NOTE: Zig captured the stored key ptr to free post-removal; here
        // the map owns the Box<[u8]> key and `swap_remove` drops it. Preserve
        // the aliasing assert (caller must not pass the map's own key storage).
        // Ordering doesn't matter for HotMap consumers — Zig's `orderedRemove`
        // was incidental, not load-bearing.
        let Some(i) = self._map.get_index(key) else {
            return;
        };
        let stored = &self._map.keys()[i];
        let is_same_slice = stored.as_ptr() == key.as_ptr() && stored.len() == key.len();
        debug_assert!(!is_same_slice);
        self._map.swap_remove(key);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// EntropyCache
// ──────────────────────────────────────────────────────────────────────────

pub struct EntropyCache {
    pub cache: [u8; Self::SIZE],
    pub index: usize,
}
impl Default for EntropyCache {
    fn default() -> Self {
        Self {
            cache: [0u8; Self::SIZE],
            index: 0,
        }
    }
}
impl EntropyCache {
    pub const BUFFERED_UUIDS_COUNT: usize = 16;
    pub const SIZE: usize = Self::BUFFERED_UUIDS_COUNT * 128;

    pub fn init(&mut self) {
        self.fill();
    }
    pub fn fill(&mut self) {
        bun_core::csprng(&mut self.cache);
        self.index = 0;
    }
    pub fn get(&mut self) -> [u8; 16] {
        if self.index + 16 > self.cache.len() {
            self.fill();
        }
        let mut r = [0u8; 16];
        r.copy_from_slice(&self.cache[self.index..self.index + 16]);
        self.index += 16;
        r
    }
    pub fn slice(&mut self, len: usize) -> &mut [u8] {
        if len > self.cache.len() {
            return &mut [];
        }
        if self.index + len > self.cache.len() {
            self.fill();
        }
        let s = self.index;
        self.index += len;
        &mut self.cache[s..s + len]
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CleanupHook
// ──────────────────────────────────────────────────────────────────────────

// Safe fn-pointer type: `ctx` is an opaque round-trip pointer the registrant
// supplied alongside `func`; the caller (`execute`) never dereferences it, only
// forwards it. Each implementor (e.g. N-API's `run_as_cleanup_hook`) owns the
// cast/deref locally, so invoking the pointer carries no caller-side precondition.
pub type CleanupHookFunction = extern "C" fn(*mut c_void);

#[derive(Clone, Copy)]
pub struct CleanupHook {
    pub ctx: *mut c_void,
    pub func: CleanupHookFunction,
    // PORT NOTE: LIFETIMES.tsv says &'a JSGlobalObject (JSC_BORROW); raw ptr
    // avoids threading a lifetime param through `RareData`.
    pub global_this: *const JSGlobalObject,
}

impl CleanupHook {
    pub fn eql(self, other: CleanupHook) -> bool {
        self.ctx == other.ctx
            && (self.func as usize) == (other.func as usize)
            && core::ptr::eq(self.global_this, other.global_this)
    }

    pub fn execute(self) {
        (self.func)(self.ctx);
    }

    pub fn from(
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) -> CleanupHook {
        CleanupHook {
            ctx,
            func,
            global_this: std::ptr::from_ref(global_this),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IsolationWatcher — per-entry vtable so `close_all_watchers_for_isolation`
// can fire `detach`/`close` without naming `bun_runtime::node::FSWatcher` /
// `StatWatcher` (cycle break, docs/PORTING.md §Dispatch cold path).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct IsolationWatcher {
    pub ptr: *mut c_void,
    /// `FSWatcher::detach` / `StatWatcher::close` — supplied by the registrant.
    pub close: unsafe fn(*mut c_void),
}

/// Erased high-tier slot with paired destructor (e.g. `WebSocketDeflate::RareData`).
pub struct ErasedBox {
    pub ptr: NonNull<c_void>,
    pub dtor: unsafe fn(*mut c_void),
}
impl Drop for ErasedBox {
    fn drop(&mut self) {
        // SAFETY: `dtor` was supplied by the same high-tier code that allocated `ptr`.
        unsafe { (self.dtor)(self.ptr.as_ptr()) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RareData
// ──────────────────────────────────────────────────────────────────────────

pub struct RareData {
    /// `bun_http_jsc::WebSocketDeflate::RareData` — erased; lazy-init in
    /// `bun_http_jsc::WebSocketDeflate::rare_data()`.
    pub websocket_deflate: Option<ErasedBox>,
    pub boring_ssl_engine: Option<*mut boring::ENGINE>,

    /// Erased `*mut webcore::blob::Store` (intrusive-refcounted on the runtime
    /// side). Constructed via `__bun_stdio_blob_store_new`; high tier casts back.
    /// `mode` is cached so [`Bun__Process__getStdinFdType`] doesn't have to
    /// re-stat (Zig read `store.data.file.mode`).
    pub stderr_store: Option<NonNull<c_void>>,
    pub stderr_mode: Mode,
    pub stdin_store: Option<NonNull<c_void>>,
    pub stdin_mode: Mode,
    pub stdout_store: Option<NonNull<c_void>>,
    pub stdout_mode: Mode,

    pub entropy_cache: Option<Box<EntropyCache>>,

    pub hot_map: Option<HotMap>,
    /// `Vec<*mut bun_runtime::api::cron::CronJob>` — only stored/iterated here.
    pub cron_jobs: Vec<*mut c_void>,

    // TODO: make this per JSGlobalObject instead of global
    // This does not handle ShadowRealm correctly!
    pub cleanup_hooks: Vec<CleanupHook>,

    pub file_polls_: Option<Box<FilePollStore>>,

    /// `bun_runtime::dns_jsc::GlobalData` — erased; lazy-init owned by
    /// `bun_runtime::dns_jsc::dns::global_resolver_mut`.
    pub global_dns_data: Option<NonNull<c_void>>,

    /// Embedded socket groups for kinds that aren't tied to a Listener / server.
    /// Lazily linked into the loop on first socket; never separately allocated.
    pub spawn_ipc_group: SocketGroup,
    /// `bun test --parallel` IPC channel (worker ↔ coordinator). Survives the
    /// per-file isolation swap so the worker keeps its link to the coordinator.
    pub test_parallel_ipc_group: SocketGroup,
    /// `Bun.connect` client sockets — one group per VM (not per connection).
    pub bun_connect_group_tcp: SocketGroup,
    pub bun_connect_group_tls: SocketGroup,
    /// SQL drivers — TCP and TLS share one group each per VM. STARTTLS adopts
    /// from the `_tcp` group into `_tls` without reallocating a context.
    pub postgres_group: SocketGroup,
    pub postgres_tls_group: SocketGroup,
    pub mysql_group_: SocketGroup,
    pub mysql_tls_group: SocketGroup,
    pub valkey_group_: SocketGroup,
    pub valkey_tls_group: SocketGroup,
    /// `new WebSocket(...)` client. Upgrade phase (HTTP handshake) and connected
    /// phase (frame I/O) live in separate kinds so the handshake handler doesn't
    /// have to runtime-branch on state.
    pub ws_upgrade_group_: SocketGroup,
    pub ws_upgrade_tls_group: SocketGroup,
    pub ws_client_group_: SocketGroup,
    pub ws_client_tls_group: SocketGroup,

    /// `ssl_ctx_cache.getOrCreate(&.{})` — i.e. the default-trust-store client
    /// CTX. Cached separately so the hot `tls:true` / `wss://` path skips even the
    /// SHA-256 + map lookup. Ref owned here. Lazy-init body lives in
    /// `bun_runtime` (it calls `SSLContextCache::get_or_create_opts`).
    pub default_client_ssl_ctx: Option<*mut SslCtx>,

    pub mime_types: Option<mime_type::Map>,

    /// `bun_runtime::node::StatWatcherScheduler` — erased `RefPtr` payload;
    /// lazy-init in `bun_runtime::node::node_fs_stat_watcher`.
    pub node_fs_stat_watcher_scheduler: Option<NonNull<c_void>>,

    /// Watch-mode restart needs to RST every listen socket so the new process
    /// can rebind without `EADDRINUSE`. Written on the JS thread; drained on
    /// the watcher thread — hence the mutex (PORTING.md §Concurrency: lock
    /// owns the data, no sidecar `Mutex<()>`).
    pub listening_sockets_for_watch_mode: Mutex<Vec<Fd>>,

    pub fs_watchers_for_isolation: Vec<IsolationWatcher>,
    pub stat_watchers_for_isolation: Vec<IsolationWatcher>,

    pub temp_pipe_read_buffer: Option<Box<PipeReadBuffer>>,

    // PORT NOTE: `aws_signature_cache` field dropped — storage moved DOWN to
    // `bun_s3_signing::credentials::AWS_SIGNATURE_CACHE` (process static). The
    // Zig code always reached it via `getMainThreadVM()`, so it was a
    // singleton in practice; hosting it in the consumer crate removes the
    // upward `s3_signing → jsc` hook.
    pub s3_default_client: Strong,
    pub default_csrf_secret: Box<[u8]>,

    /// Owned NUL-terminated buffer (`[:0]u8`). `len()` includes the trailing 0;
    /// [`Self::tls_default_ciphers`] strips it to match Zig `dupeZ` semantics.
    pub tls_default_ciphers: Option<Box<[u8]>>,

    // proxy_env_storage moved to VirtualMachine — see comment there on why
    // lazy RareData creation raced with worker spawn.
    spawn_sync_event_loop_: Option<Box<SpawnSyncEventLoop>>,

    pub path_buf: PathBuf,
}

// Type aliases matching Zig's local imports
pub type FilePollStore = Async::file_poll::Store;

impl Default for RareData {
    fn default() -> Self {
        Self {
            websocket_deflate: None,
            boring_ssl_engine: None,
            stderr_store: None,
            stderr_mode: 0,
            stdin_store: None,
            stdin_mode: 0,
            stdout_store: None,
            stdout_mode: 0,
            entropy_cache: None,
            hot_map: None,
            cron_jobs: Vec::new(),
            cleanup_hooks: Vec::new(),
            file_polls_: None,
            global_dns_data: None,
            spawn_ipc_group: SocketGroup::default(),
            test_parallel_ipc_group: SocketGroup::default(),
            bun_connect_group_tcp: SocketGroup::default(),
            bun_connect_group_tls: SocketGroup::default(),
            postgres_group: SocketGroup::default(),
            postgres_tls_group: SocketGroup::default(),
            mysql_group_: SocketGroup::default(),
            mysql_tls_group: SocketGroup::default(),
            valkey_group_: SocketGroup::default(),
            valkey_tls_group: SocketGroup::default(),
            ws_upgrade_group_: SocketGroup::default(),
            ws_upgrade_tls_group: SocketGroup::default(),
            ws_client_group_: SocketGroup::default(),
            ws_client_tls_group: SocketGroup::default(),
            default_client_ssl_ctx: None,
            mime_types: None,
            node_fs_stat_watcher_scheduler: None,
            listening_sockets_for_watch_mode: Mutex::new(Vec::new()),
            fs_watchers_for_isolation: Vec::new(),
            stat_watchers_for_isolation: Vec::new(),
            temp_pipe_read_buffer: None,
            s3_default_client: Strong::empty(),
            default_csrf_secret: Box::default(),
            tls_default_ciphers: None,
            spawn_sync_event_loop_: None,
            path_buf: PathBuf::default(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PathBuf
// ──────────────────────────────────────────────────────────────────────────

/// Reusable heap buffer for path.resolve, path.relative, and path.toNamespacedPath.
/// Three fixed-size tiers, lazily allocated on first use. Safe because JS is single-threaded.
/// The buffer is used via a FixedBufferAllocator as the backing for a stackFallback.
#[derive(Default)]
pub struct PathBuf {
    pub small: Option<Box<[u8; 2 * MAX_PATH_BYTES]>>,
    pub medium: Option<Box<[u8; 8 * MAX_PATH_BYTES]>>,
    pub large: Option<Box<[u8; 32 * MAX_PATH_BYTES]>>,
}

impl PathBuf {
    const S: usize = MAX_PATH_BYTES;

    /// Returns the smallest lazily-allocated tier buffer that fits `min_len`.
    // PERF(port): was stack-fallback (FixedBufferAllocator + fallback allocator) — Phase B
    // must revisit caller semantics for inputs exceeding the large tier.
    pub fn get(&mut self, min_len: usize) -> &mut [u8] {
        if min_len <= 2 * Self::S {
            &mut **self
                .small
                .get_or_insert_with(bun_core::boxed_zeroed::<[u8; 2 * MAX_PATH_BYTES]>)
        } else if min_len <= 8 * Self::S {
            &mut **self
                .medium
                .get_or_insert_with(bun_core::boxed_zeroed::<[u8; 8 * MAX_PATH_BYTES]>)
        } else {
            &mut **self
                .large
                .get_or_insert_with(bun_core::boxed_zeroed::<[u8; 32 * MAX_PATH_BYTES]>)
        }
    }
}

// Drop is automatic for Option<Box<...>> fields — no explicit deinit needed.

// ──────────────────────────────────────────────────────────────────────────
// PipeReadBuffer / constants
// ──────────────────────────────────────────────────────────────────────────

// Canonical definition lives in the lower-tier `bun_event_loop` crate (shared
// with `MiniEventLoop`'s scratch buffer). Re-export so `rare_data::PipeReadBuffer`
// remains a stable path for existing callers.
pub use bun_event_loop::PipeReadBuffer;

// ──────────────────────────────────────────────────────────────────────────
// ProxyEnvStorage
// ──────────────────────────────────────────────────────────────────────────

/// Serialises `Bun__setEnvValue`'s slot swap + `env.map.put` against a worker's
/// `clone_from` + `env.map.cloneWithAllocator`. Closes two races: (1) worker
/// reading a slot `Arc` concurrently with the parent dropping it to refcount 0;
/// (2) the env map being iterated during clone while the parent's `put()`
/// rehashes it. Callers hold the guard across the paired env-map op — the
/// mutex doubles as the env-map serialisation point even though it owns only
/// the slots.
///
/// PORTING.md §Concurrency: lock owns the data — no sidecar `Mutex<()>` field.
#[derive(Default)]
pub struct ProxyEnvStorage(Mutex<ProxyEnvSlots>);

impl ProxyEnvStorage {
    #[inline]
    pub fn lock(&self) -> bun_core::MutexGuard<'_, ProxyEnvSlots> {
        self.0.lock()
    }
}

#[derive(Default)]
pub struct ProxyEnvSlots {
    #[allow(non_snake_case)]
    pub HTTP_PROXY: Option<Arc<RefCountedEnvValue>>,
    pub http_proxy: Option<Arc<RefCountedEnvValue>>,
    #[allow(non_snake_case)]
    pub HTTPS_PROXY: Option<Arc<RefCountedEnvValue>>,
    pub https_proxy: Option<Arc<RefCountedEnvValue>>,
    #[allow(non_snake_case)]
    pub NO_PROXY: Option<Arc<RefCountedEnvValue>>,
    pub no_proxy: Option<Arc<RefCountedEnvValue>>,
}

pub struct Slot<'a> {
    /// Static-lifetime field name (e.g. "NO_PROXY") — safe to use as
    /// the env map key without duping.
    pub key: &'static [u8],
    pub ptr: &'a mut Option<Arc<RefCountedEnvValue>>,
}

/// Helper macro: expands `$body` once per proxy-env field, binding `$name`
/// (the static byte-string key) and `$field` (the field ident). Replaces
/// the Zig `inline for (@typeInfo(...).fields)` iteration.
macro_rules! for_each_proxy_field {
    ($self:expr, |$name:ident, $field:ident| $body:block) => {{
        // Uppercase fields are declared first. On Windows the case-insensitive
        // eql matches the uppercase field for either input case and returns
        // before reaching lowercase.
        {
            let $name: &'static [u8] = b"HTTP_PROXY";
            let $field = &mut $self.HTTP_PROXY;
            $body
        }
        {
            let $name: &'static [u8] = b"http_proxy";
            let $field = &mut $self.http_proxy;
            $body
        }
        {
            let $name: &'static [u8] = b"HTTPS_PROXY";
            let $field = &mut $self.HTTPS_PROXY;
            $body
        }
        {
            let $name: &'static [u8] = b"https_proxy";
            let $field = &mut $self.https_proxy;
            $body
        }
        {
            let $name: &'static [u8] = b"NO_PROXY";
            let $field = &mut $self.NO_PROXY;
            $body
        }
        {
            let $name: &'static [u8] = b"no_proxy";
            let $field = &mut $self.no_proxy;
            $body
        }
    }};
}

impl ProxyEnvSlots {
    pub fn slot(&mut self, name: &[u8]) -> Option<Slot<'_>> {
        // On Windows the env.map is case-insensitive (CaseInsensitiveASCII-
        // StringArrayHashMap) — map.put("HTTP_PROXY", ...) and
        // map.put("http_proxy", ...) write the same entry. If we tracked
        // refs in separate case-variant slots, one slot's value would leak
        // and syncInto would replay the stale one into the worker's map.
        // Canonicalize both cases to the uppercase slot on Windows; the
        // lowercase slots stay null. Posix keeps both — its map and its
        // getHttpProxy lookup are case-sensitive.
        let eql: fn(&[u8], &[u8]) -> bool = if cfg!(windows) {
            strings::eql_case_insensitive_ascii_check_length
        } else {
            strings::eql
        };
        for_each_proxy_field!(self, |fname, field| {
            if eql(name, fname) {
                return Some(Slot {
                    key: fname,
                    ptr: field,
                });
            }
        });
        None
    }

    /// Bump refcounts on all non-null values so a worker can share the
    /// parent's strings. Caller passes the parent's locked guard — the `Arc`
    /// load + clone is not atomic with respect to `Bun__setEnvValue`'s drop.
    pub fn clone_from(&mut self, parent: &ProxyEnvSlots) {
        // PORT NOTE: reshaped for borrowck — Zig iterated fields via @typeInfo;
        // here Arc::clone bumps the refcount.
        self.HTTP_PROXY = parent.HTTP_PROXY.clone();
        self.http_proxy = parent.http_proxy.clone();
        self.HTTPS_PROXY = parent.HTTPS_PROXY.clone();
        self.https_proxy = parent.https_proxy.clone();
        self.NO_PROXY = parent.NO_PROXY.clone();
        self.no_proxy = parent.no_proxy.clone();
    }

    /// Overwrite proxy-var entries in an env map with this storage's reffed
    /// bytes. Used after map.cloneWithAllocator in the worker so the cloned
    /// map and the reffed storage agree — defense-in-depth in case the map
    /// clone captured a snapshot the storage doesn't hold a ref on (e.g. an
    /// initial-environ value later overwritten by the setter).
    pub fn sync_into(&self, map: &mut bun_dotenv::Map) {
        macro_rules! sync_one {
            ($name:literal, $field:ident) => {
                if let Some(val) = &self.$field {
                    bun_core::handle_oom(map.put($name, &val.bytes));
                }
            };
        }
        sync_one!(b"HTTP_PROXY", HTTP_PROXY);
        sync_one!(b"http_proxy", http_proxy);
        sync_one!(b"HTTPS_PROXY", HTTPS_PROXY);
        sync_one!(b"https_proxy", https_proxy);
        sync_one!(b"NO_PROXY", NO_PROXY);
        sync_one!(b"no_proxy", no_proxy);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RefCountedEnvValue
// ──────────────────────────────────────────────────────────────────────────

/// A ref-counted heap-allocated byte slice. The env map stores borrowed
/// `.bytes` slices; as long as any VM holds a ref, the bytes stay valid.
///
/// PORT NOTE: Zig used intrusive `ThreadSafeRefCount`; LIFETIMES.tsv classifies
/// holders as `Arc<RefCountedEnvValue>`, so the refcount lives in the `Arc`
/// header and `ref`/`deref` become `Arc::clone`/`drop`.
pub struct RefCountedEnvValue {
    pub bytes: Box<[u8]>,
}

impl RefCountedEnvValue {
    pub fn create(value: &[u8]) -> Arc<RefCountedEnvValue> {
        Arc::new(RefCountedEnvValue {
            bytes: Box::<[u8]>::from(value),
        })
    }
}

// `AWSSignatureCache` moved DOWN to `bun_s3_signing::credentials` (process
// static). Re-exported for any out-of-tree callers that named the type via
// `bun_jsc::rare_data::AWSSignatureCache`.
pub use bun_s3_signing::credentials::AWSSignatureCache;

// ──────────────────────────────────────────────────────────────────────────
// RareData methods — simple accessors / lazy-init
// ──────────────────────────────────────────────────────────────────────────

/// Expand `$body` once per embedded `SocketGroup` field — the Rust analogue of
/// Zig's `inline for (socket_group_fields) |f| @field(this, f)`.
macro_rules! for_each_socket_group {
    ($self:ident, |$g:ident| $body:block) => {{
        {
            let $g = &mut $self.spawn_ipc_group;
            $body
        }
        {
            let $g = &mut $self.test_parallel_ipc_group;
            $body
        }
        {
            let $g = &mut $self.bun_connect_group_tcp;
            $body
        }
        {
            let $g = &mut $self.bun_connect_group_tls;
            $body
        }
        {
            let $g = &mut $self.postgres_group;
            $body
        }
        {
            let $g = &mut $self.postgres_tls_group;
            $body
        }
        {
            let $g = &mut $self.mysql_group_;
            $body
        }
        {
            let $g = &mut $self.mysql_tls_group;
            $body
        }
        {
            let $g = &mut $self.valkey_group_;
            $body
        }
        {
            let $g = &mut $self.valkey_tls_group;
            $body
        }
        {
            let $g = &mut $self.ws_upgrade_group_;
            $body
        }
        {
            let $g = &mut $self.ws_upgrade_tls_group;
            $body
        }
        {
            let $g = &mut $self.ws_client_group_;
            $body
        }
        {
            let $g = &mut $self.ws_client_tls_group;
            $body
        }
    }};
}

impl RareData {
    // ── trivial field accessors ────────────────────────────────────────────

    /// Raw slot for the per-VM global DNS data. The lazy init + `&mut Resolver`
    /// accessor lives in `bun_runtime::dns_jsc::dns::global_resolver_mut` (the
    /// `Resolver` type is higher-tier and cannot be named here without a cycle).
    #[inline]
    pub fn global_dns_data_slot(&mut self) -> &mut Option<NonNull<c_void>> {
        &mut self.global_dns_data
    }

    /// Raw slot — lazy-init body lives in `bun_runtime::node::node_fs_stat_watcher`
    /// (`StatWatcherScheduler::init` is higher-tier).
    #[inline]
    pub fn node_fs_stat_watcher_scheduler_slot(&mut self) -> &mut Option<NonNull<c_void>> {
        &mut self.node_fs_stat_watcher_scheduler
    }

    /// Raw slot — lazy-init body lives in `bun_http_jsc::WebSocketDeflate`.
    #[inline]
    pub fn websocket_deflate_slot(&mut self) -> &mut Option<ErasedBox> {
        &mut self.websocket_deflate
    }

    // ── lazy-init: hot_map ─────────────────────────────────────────────────
    pub fn hot_map(&mut self) -> &mut HotMap {
        self.hot_map.get_or_insert_with(HotMap::init)
    }

    // ── lazy-init: entropy ─────────────────────────────────────────────────
    fn entropy(&mut self) -> &mut EntropyCache {
        self.entropy_cache.get_or_insert_with(|| {
            let mut c = Box::new(EntropyCache::default());
            c.fill();
            c
        })
    }
    pub fn entropy_slice(&mut self, len: usize) -> &mut [u8] {
        self.entropy().slice(len)
    }
    pub fn next_uuid(&mut self) -> UUID {
        let bytes = self.entropy().get();
        UUID::init_with(&bytes)
    }

    // ── lazy-init: misc heap slots ────────────────────────────────────────
    pub fn pipe_read_buffer(&mut self) -> &mut PipeReadBuffer {
        self.temp_pipe_read_buffer
            .get_or_insert_with(bun_core::boxed_zeroed::<PipeReadBuffer>)
    }

    pub fn file_polls(&mut self, _vm: &mut VirtualMachine) -> &mut FilePollStore {
        self.file_polls_
            .get_or_insert_with(|| Box::new(FilePollStore::init()))
    }

    pub fn boring_engine(&mut self) -> *mut boring::ENGINE {
        // PORT NOTE: Zig spec is `ENGINE_new().?` (panic on null). We cache the
        // raw result; `EVP_DigestInit_ex` tolerates a NULL engine, so OOM here
        // degrades to "no engine" rather than crashing. Debug-assert to surface
        // the divergence without altering release behavior.
        let ptr = *self
            .boring_ssl_engine
            .get_or_insert_with(|| boring::ENGINE_new());
        debug_assert!(!ptr.is_null(), "ENGINE_new returned null");
        ptr
    }

    pub fn default_csrf_secret(&mut self) -> &[u8] {
        if self.default_csrf_secret.is_empty() {
            let mut secret = vec![0u8; 16].into_boxed_slice();
            bun_core::csprng(&mut secret);
            self.default_csrf_secret = secret;
        }
        &self.default_csrf_secret
    }

    pub fn tls_default_ciphers(&self) -> Option<&[u8]> {
        // PORT NOTE: Zig returns `[:0]const u8` whose `.len` excludes the NUL
        // sentinel. The stored buffer is NUL-terminated (set_tls_default_ciphers
        // appends 0), so strip the trailing NUL from the returned slice's length
        // to match `dupeZ` semantics. Callers needing a C string can still take
        // `.as_ptr()` — the NUL byte remains in storage one-past-the-end.
        self.tls_default_ciphers
            .as_deref()
            .map(|s| &s[..s.len() - 1])
    }

    pub fn set_tls_default_ciphers(&mut self, ciphers: &[u8]) {
        // Old value (if any) drops here via Box<[u8]> Drop.
        let mut owned = Vec::with_capacity(ciphers.len() + 1);
        owned.extend_from_slice(ciphers);
        owned.push(0);
        self.tls_default_ciphers = Some(owned.into_boxed_slice());
    }

    pub fn push_cleanup_hook(
        &mut self,
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) {
        self.cleanup_hooks
            .push(CleanupHook::from(global_this, ctx, func));
    }

    pub fn spawn_sync_event_loop(&mut self, vm: &mut VirtualMachine) -> &mut SpawnSyncEventLoop {
        if self.spawn_sync_event_loop_.is_none() {
            // PORT NOTE: in-place out-param init — Zig used Owned::new(undefined)
            // then ptr.init(vm). `event_loop` inside captures `self`-addr, so the
            // value must not move after init; allocate the Box first, init into it.
            let mut boxed = Box::<SpawnSyncEventLoop>::new_uninit();
            SpawnSyncEventLoop::init(
                &mut *boxed,
                core::ptr::from_mut::<VirtualMachine>(vm).cast::<()>(),
            );
            // SAFETY: `init` fully initialised the slot.
            self.spawn_sync_event_loop_ = Some(unsafe { boxed.assume_init() });
        }
        self.spawn_sync_event_loop_.as_mut().unwrap()
    }

    pub fn mime_type_from_string(&mut self, str_: &[u8]) -> Option<mime_type::MimeType> {
        let table = self
            .mime_types
            .get_or_insert_with(|| bun_core::handle_oom(mime_type::create_hash_table()));
        table
            .get(str_)
            .map(|entry| mime_type::Compact::from(*entry).to_mime_type())
    }

    // ── watch-mode listen sockets ─────────────────────────────────────────
    pub fn add_listening_socket_for_watch_mode(&self, socket: Fd) {
        self.listening_sockets_for_watch_mode.lock().push(socket);
    }

    pub fn remove_listening_socket_for_watch_mode(&self, socket: Fd) {
        let mut sockets = self.listening_sockets_for_watch_mode.lock();
        if let Some(i) = sockets.iter().position(|s| *s == socket) {
            sockets.swap_remove(i);
        }
    }

    pub fn close_all_listen_sockets_for_watch_mode(&self) {
        for socket in core::mem::take(&mut *self.listening_sockets_for_watch_mode.lock()) {
            // Prevent TIME_WAIT state so the relaunched process can rebind.
            syscall::disable_linger(socket);
            socket.close();
        }
    }

    // ── isolation watchers (FSWatcher / StatWatcher) ──────────────────────
    pub fn add_fs_watcher_for_isolation(
        &mut self,
        watcher: *mut c_void,
        detach: unsafe fn(*mut c_void),
    ) {
        self.fs_watchers_for_isolation.push(IsolationWatcher {
            ptr: watcher,
            close: detach,
        });
    }
    pub fn remove_fs_watcher_for_isolation(&mut self, watcher: *mut c_void) {
        if let Some(i) = self
            .fs_watchers_for_isolation
            .iter()
            .position(|w| w.ptr == watcher)
        {
            self.fs_watchers_for_isolation.swap_remove(i);
        }
    }
    pub fn add_stat_watcher_for_isolation(
        &mut self,
        watcher: *mut c_void,
        close: unsafe fn(*mut c_void),
    ) {
        self.stat_watchers_for_isolation.push(IsolationWatcher {
            ptr: watcher,
            close,
        });
    }
    pub fn remove_stat_watcher_for_isolation(&mut self, watcher: *mut c_void) {
        if let Some(i) = self
            .stat_watchers_for_isolation
            .iter()
            .position(|w| w.ptr == watcher)
        {
            self.stat_watchers_for_isolation.swap_remove(i);
        }
    }
    pub fn close_all_watchers_for_isolation(&mut self) {
        // R-2 noalias mitigation (PORT_NOTES_PLAN R-2; precedent
        // `b818e70e1c57` NodeHTTPResponse::cork): `(w.close)(w.ptr)` is an
        // opaque fn-pointer call that receives nothing derived from `self`. It
        // re-enters JS (FSWatcher.close → "close" event), which can call
        // `add_*_watcher_for_isolation` and push back onto these same Vecs.
        // With `noalias self`, LLVM may cache the Vec's `len`/`ptr` across the
        // call body and miss the push. ASM-verified PROVEN_CACHED. Launder
        // `self` so every `pop()` goes through an opaque pointer.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        loop {
            // SAFETY: `this` is the unique live `RareData` (boxed by VM);
            // momentary `&mut` only, ended before the re-entrant close.
            let Some(w) = (unsafe { &mut (*this).fs_watchers_for_isolation }).pop() else {
                break;
            };
            // SAFETY: registered via add_fs_watcher_for_isolation; still live.
            unsafe { (w.close)(w.ptr) };
            core::hint::black_box(this);
        }
        loop {
            // SAFETY: as above.
            let Some(w) = (unsafe { &mut (*this).stat_watchers_for_isolation }).pop() else {
                break;
            };
            // SAFETY: registered via add_stat_watcher_for_isolation; still live.
            unsafe { (w.close)(w.ptr) };
            core::hint::black_box(this);
        }
    }

    // ── socket groups: lazy init ──────────────────────────────────────────
    #[inline]
    fn lazy_group<'a>(g: &'a mut SocketGroup, vm: &VirtualMachine) -> &'a mut SocketGroup {
        // PORT NOTE: Zig took `comptime field: []const u8` + @field; Rust takes
        // the field reference directly since callers know the field statically.
        if g.loop_.is_null() {
            g.init(vm.uws_loop(), None, core::ptr::null_mut());
        }
        g
    }

    pub fn spawn_ipc_group(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(&mut self.spawn_ipc_group, vm)
    }
    pub fn test_parallel_ipc_group(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(&mut self.test_parallel_ipc_group, vm)
    }
    /// One shared group per (VM, ssl) for every `Bun.connect` / `tls.connect`
    /// client socket. Replaces the old per-connection `us_socket_context_t`
    /// allocation that was the root of the SSL_CTX-per-connect leak.
    pub fn bun_connect_group<const SSL: bool>(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL {
                &mut self.bun_connect_group_tls
            } else {
                &mut self.bun_connect_group_tcp
            },
            vm,
        )
    }
    pub fn postgres_group<const SSL: bool>(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL {
                &mut self.postgres_tls_group
            } else {
                &mut self.postgres_group
            },
            vm,
        )
    }
    pub fn mysql_group<const SSL: bool>(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL {
                &mut self.mysql_tls_group
            } else {
                &mut self.mysql_group_
            },
            vm,
        )
    }
    pub fn valkey_group<const SSL: bool>(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL {
                &mut self.valkey_tls_group
            } else {
                &mut self.valkey_group_
            },
            vm,
        )
    }
    pub fn ws_upgrade_group<const SSL: bool>(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL {
                &mut self.ws_upgrade_tls_group
            } else {
                &mut self.ws_upgrade_group_
            },
            vm,
        )
    }
    pub fn ws_client_group<const SSL: bool>(&mut self, vm: &VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL {
                &mut self.ws_client_tls_group
            } else {
                &mut self.ws_client_group_
            },
            vm,
        )
    }

    // ── close_all_socket_groups ───────────────────────────────────────────
    /// Drain every embedded socket group. Must run BEFORE JSC teardown — closeAll
    /// fires on_close → JS callbacks → needs a live VM. RareData.deinit() runs
    /// after `WebWorker__teardownJSCVM` (web_worker.zig), so doing the closeAll
    /// there would dispatch into freed JSC heap.
    pub fn close_all_socket_groups(&mut self, vm: &VirtualMachine) {
        // closeAll() dispatches on_close into JS while the VM is still alive, so a
        // handler can call Bun.connect/postgres/etc. and re-populate a group we
        // just drained. Loop until every group is observed empty in the same pass
        // (bounded — each retry only happens if a JS callback opened a *new*
        // socket, and the cap stops a deliberately-spinning on_close from wedging
        // teardown; the post-close force-drain in close_all handles whatever's
        // left after the cap).
        // Walk the loop's linked-group list rather than just our 14 embedded
        // fields: Listener/uWS-App groups own their own SocketGroup, and accepted
        // sockets land *there*, not in RareData. Iterating only the embedded
        // fields missed those, leaking one 88-byte us_socket_t per still-open
        // accepted connection at process.exit() (the LSAN cluster on #29932
        // build 49245).
        let _ = self;
        let mut rounds: u8 = 0;
        while rounds < 8 {
            // `uws_loop_mut()` is the centralised BACKREF accessor for the
            // per-VM uSockets loop (live for the VM lifetime).
            if !vm.uws_loop_mut().close_all_groups() {
                break;
            }
            rounds += 1;
        }
        // us_socket_close pushes to loop->data.closed_head; loop_post() normally
        // frees it on the next tick. We're past the last tick, so drain it now —
        // every us_socket_t is libc-allocated and otherwise becomes an LSAN leak
        // (the only pointer into it lives in mimalloc-backed RareData, which LSAN
        // can't trace once we unregister the root region).
        vm.uws_loop_mut().drain_closed_sockets();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// stderr / stdout / stdin
//
// Low tier owns the fstat + lazy-init flow; the actual `webcore::blob::Store`
// allocation goes through `__bun_stdio_blob_store_new` (link-time extern
// defined in `bun_runtime::webcore::blob`). Zig built `Blob.Store` inline.
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    #[inline]
    fn stdio_ctor(fd: Fd, is_atty: bool, mode: Mode) -> *mut c_void {
        // `__bun_stdio_blob_store_new` is declared `safe fn` in
        // `bun_event_loop::MiniEventLoop` (all args by-value; allocates a
        // fresh `Store` with no caller-side precondition).
        __bun_stdio_blob_store_new(fd, is_atty, mode).cast()
    }

    /// Returns an erased `*mut webcore::blob::Store`. High-tier callers cast back.
    pub fn stderr(&mut self) -> *mut c_void {
        bun_analytics::features::bun_stderr.fetch_add(1, Ordering::Relaxed);
        if self.stderr_store.is_none() {
            let fd = Fd::from_uv(2);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            let is_atty =
                Output::stderr_descriptor_type() == Output::OutputStreamDescriptor::Terminal;
            let store = Self::stdio_ctor(fd, is_atty, mode);
            self.stderr_store = NonNull::new(store);
            self.stderr_mode = mode;
        }
        self.stderr_store
            .map_or(core::ptr::null_mut(), NonNull::as_ptr)
    }

    /// Returns an erased `*mut webcore::blob::Store`. High-tier callers cast back.
    pub fn stdout(&mut self) -> *mut c_void {
        bun_analytics::features::bun_stdout.fetch_add(1, Ordering::Relaxed);
        if self.stdout_store.is_none() {
            let fd = Fd::from_uv(1);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            let is_atty =
                Output::stdout_descriptor_type() == Output::OutputStreamDescriptor::Terminal;
            let store = Self::stdio_ctor(fd, is_atty, mode);
            self.stdout_store = NonNull::new(store);
            self.stdout_mode = mode;
        }
        self.stdout_store
            .map_or(core::ptr::null_mut(), NonNull::as_ptr)
    }

    /// Returns an erased `*mut webcore::blob::Store`. High-tier callers cast back.
    pub fn stdin(&mut self) -> *mut c_void {
        bun_analytics::features::bun_stdin.fetch_add(1, Ordering::Relaxed);
        if self.stdin_store.is_none() {
            let fd = Fd::from_uv(0);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            // Zig: `if (fd.unwrapValid()) |valid| std.posix.isatty(valid.native()) else false`
            // — on Windows an invalid stdin handle must short-circuit to false.
            let is_atty = fd.unwrap_valid().map(syscall::isatty).unwrap_or(false);
            let store = Self::stdio_ctor(fd, is_atty, mode);
            self.stdin_store = NonNull::new(store);
            self.stdin_mode = mode;
        }
        self.stdin_store
            .map_or(core::ptr::null_mut(), NonNull::as_ptr)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StdinFdType / Bun__Process__getStdinFdType
// ──────────────────────────────────────────────────────────────────────────

#[repr(i32)]
pub enum StdinFdType {
    File = 0,
    Pipe = 1,
    Socket = 2,
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Process__getStdinFdType(vm: &VirtualMachine, fd: i32) -> StdinFdType {
    let rare = vm.as_mut().rare_data();
    // PORT NOTE: Zig read `store.data.file.mode`; the store is erased here, so
    // `stderr/stdout/stdin()` cache `mode` alongside the pointer.
    let mode = match fd {
        0 => {
            rare.stdin();
            rare.stdin_mode
        }
        1 => {
            rare.stdout();
            rare.stdout_mode
        }
        2 => {
            rare.stderr();
            rare.stderr_mode
        }
        _ => unreachable!(),
    };
    // Zig: `bun.S.ISFIFO(mode)` / `bun.S.ISSOCK(mode)` — platform-shimmed (works on
    // Windows where libc::S_IFSOCK is undefined and on macOS where the libc constants
    // are u16). `kind_from_mode` uses hard-coded u32 octal masks for the same effect.
    match bun_sys::kind_from_mode(mode) {
        bun_sys::FileKind::NamedPipe => StdinFdType::Pipe,
        bun_sys::FileKind::UnixDomainSocket => StdinFdType::Socket,
        _ => StdinFdType::File,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TLS default ciphers JS bindings
// ──────────────────────────────────────────────────────────────────────────

#[crate::host_fn(export = "Bun__setTLSDefaultCiphers")]
fn set_tls_default_ciphers_from_js(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let ciphers = if !args.is_empty() {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    if !ciphers.is_string() {
        return Err(global_this.throw_invalid_argument_type_value(b"ciphers", b"string", ciphers));
    }
    let sliced = ciphers.to_slice(global_this)?;
    // `bun_vm()` is the safe BACKREF accessor for the per-thread VM; `as_mut()`
    // is the audited single-JS-thread `&mut` escape hatch.
    global_this
        .bun_vm()
        .as_mut()
        .rare_data()
        .set_tls_default_ciphers(sliced.slice());
    Ok(JSValue::UNDEFINED)
}

#[crate::host_fn(export = "Bun__getTLSDefaultCiphers")]
fn get_tls_default_ciphers_from_js(
    global_this: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    // `bun_vm()` is the safe BACKREF accessor; see above.
    let rare = global_this.bun_vm().as_mut().rare_data();
    let bytes = match rare.tls_default_ciphers() {
        Some(c) => c,
        None => uws::get_default_ciphers().as_bytes(),
    };
    crate::bun_string_jsc::create_utf8_for_js(global_this, bytes)
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for RareData {
    fn drop(&mut self) {
        // temp_pipe_read_buffer / spawn_sync_event_loop_ / aws_signature_cache /
        // s3_default_client / default_csrf_secret / cleanup_hooks / cron_jobs /
        // path_buf / websocket_deflate / tls_default_ciphers:
        // all dropped automatically via field Drop.

        if let Some(engine) = self.boring_ssl_engine.take() {
            // SAFETY: engine was created by ENGINE_new.
            unsafe { boring::ENGINE_free(engine) };
        }
        debug_assert!(self.cron_jobs.is_empty());

        if let Some(s) = self.default_client_ssl_ctx.take() {
            // SAFETY: returned by ssl_ctx_cache.get_or_create_opts with +1 ref.
            unsafe { boring::SSL_CTX_free(s) };
        }
        // After the default-ctx free so the tombstone callback still finds a live
        // map; ssl_ctx_cache itself lives in `RuntimeState` and is dropped there.

        // closeAllSocketGroups() must have already run (before JSC teardown) so
        // these are empty; deinit() asserts that in debug.
        for_each_socket_group!(self, |g| {
            // Groups whose lazy accessor was never called are still
            // zero-initialised (`loop_ == null`, never `init`'d). The C
            // `us_socket_group_deinit` happens to no-op on those, but
            // `SocketGroup::destroy`'s safety contract requires a prior
            // `init`, so honour it explicitly.
            if !g.loop_.is_null() {
                // SAFETY: embedded by-value group, previously `init`'d; the
                // loop has already unlinked it (close_all_socket_groups ran),
                // so destroy reduces to the empty-list debug asserts.
                unsafe { SocketGroup::destroy(std::ptr::from_mut::<SocketGroup>(g)) };
            }
        });
    }
}

pub use bun_event_loop::SpawnSyncEventLoop::SpawnSyncEventLoop as SpawnSyncEventLoopReexport;

// ported from: src/jsc/rare_data.zig
