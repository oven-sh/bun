use core::ffi::c_void;
use std::sync::Arc;
use std::sync::atomic::AtomicU32;

use bun_jsc::{self as jsc, JSGlobalObject, CallFrame, JSValue, JsResult, JsError, Strong, VirtualMachine};
use bun_uws::{self as uws, SocketGroup, SslCtx};
use bun_boringssl_sys as boring_sys;
use bun_boringssl as boring_ssl;
use bun_aio::{self as Async, FilePoll};
use bun_sys::{self as syscall, Fd};
use bun_core::{self as bun_core, Output, Mutex};
use bun_collections::{StringArrayHashMap, TaggedPtrUnion};
use bun_str::{self as strings, ZStr};
use bun_paths::MAX_PATH_BYTES;
use bun_http::MimeType;
use bun_ptr::RefPtr;

use bun_runtime::api::{self, dns, cron::CronJob, mysql::MySQLContext, postgres::PostgresSQLContext, SSLContextCache};
use bun_runtime::node::node_fs_watcher::FSWatcher;
use bun_runtime::node::node_fs_stat_watcher::{StatWatcher, StatWatcherScheduler};
use bun_runtime::valkey_jsc::ValkeyContext;
use bun_runtime::webcore::{Blob, blob::Store as BlobStore, S3Client};
use bun_http_jsc::websocket_client::websocket_deflate::{self as websocket_deflate_mod, RareData as WebSocketDeflateRareData};
use bun_cli::open::EditorContext;
use bun_event_loop::SpawnSyncEventLoop;

use super::uuid::UUID;

// ──────────────────────────────────────────────────────────────────────────
// RareData
// ──────────────────────────────────────────────────────────────────────────

pub struct RareData {
    pub websocket_deflate: Option<Box<WebSocketDeflateRareData>>,
    pub boring_ssl_engine: Option<*mut boring_sys::ENGINE>,
    pub editor_context: EditorContext,
    pub stderr_store: Option<Arc<BlobStore>>,
    pub stdin_store: Option<Arc<BlobStore>>,
    pub stdout_store: Option<Arc<BlobStore>>,

    pub mysql_context: MySQLContext,
    pub postgresql_context: PostgresSQLContext,

    pub entropy_cache: Option<Box<EntropyCache>>,

    pub hot_map: Option<HotMap>,
    pub cron_jobs: Vec<*mut CronJob>,

    // TODO: make this per JSGlobalObject instead of global
    // This does not handle ShadowRealm correctly!
    pub cleanup_hooks: Vec<CleanupHook>,

    pub file_polls_: Option<Box<FilePollStore>>,

    pub global_dns_data: Option<Box<DnsGlobalData>>,

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
    /// Weak digest→`SSL_CTX*` cache. Every JS-thread consumer that turns an
    /// `SSLConfig` into an `SSL_CTX*` goes through here so identical configs
    /// share one CTX (Postgres pool, Valkey, `Bun.connect`, `tls.connect`, …).
    pub ssl_ctx_cache: SSLContextCache,

    /// `ssl_ctx_cache.getOrCreate(&.{})` — i.e. the default-trust-store client
    /// CTX. Cached separately so the hot `tls:true` / `wss://` path skips even the
    /// SHA-256 + map lookup. Ref owned here.
    pub default_client_ssl_ctx: Option<*mut boring_sys::SSL_CTX>,

    pub mime_types: Option<bun_http::mime_type::Map>,

    pub node_fs_stat_watcher_scheduler: Option<RefPtr<StatWatcherScheduler>>,

    pub listening_sockets_for_watch_mode: Vec<Fd>,
    pub listening_sockets_for_watch_mode_lock: Mutex,

    pub fs_watchers_for_isolation: Vec<*mut FSWatcher>,
    pub stat_watchers_for_isolation: Vec<*mut StatWatcher>,

    pub temp_pipe_read_buffer: Option<Box<[u8; 262144]>>,

    pub aws_signature_cache: AWSSignatureCache,

    pub s3_default_client: Strong, // Strong.Optional → bun_jsc::Strong (nullable handle slot)
    pub default_csrf_secret: Box<[u8]>,

    pub valkey_context: ValkeyContext,

    pub tls_default_ciphers: Option<Box<ZStr>>, // TODO(port): owned NUL-terminated byte buffer; verify ZStr ownership shape

    // proxy_env_storage moved to VirtualMachine — see comment there on why
    // lazy RareData creation raced with worker spawn.

    spawn_sync_event_loop_: Option<Box<SpawnSyncEventLoop>>,

    pub path_buf: PathBuf,
}

// Type aliases matching Zig's local imports
pub type FilePollStore = Async::file_poll::Store;
pub type DnsGlobalData = dns::GlobalData;

impl Default for RareData {
    fn default() -> Self {
        Self {
            websocket_deflate: None,
            boring_ssl_engine: None,
            editor_context: EditorContext::default(),
            stderr_store: None,
            stdin_store: None,
            stdout_store: None,
            mysql_context: MySQLContext::default(),
            postgresql_context: PostgresSQLContext::default(),
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
            ssl_ctx_cache: SSLContextCache::default(),
            default_client_ssl_ctx: None,
            mime_types: None,
            node_fs_stat_watcher_scheduler: None,
            listening_sockets_for_watch_mode: Vec::new(),
            listening_sockets_for_watch_mode_lock: Mutex::default(),
            fs_watchers_for_isolation: Vec::new(),
            stat_watchers_for_isolation: Vec::new(),
            temp_pipe_read_buffer: None,
            aws_signature_cache: AWSSignatureCache::default(),
            s3_default_client: Strong::empty(),
            default_csrf_secret: Box::default(),
            valkey_context: ValkeyContext::default(),
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
            &mut **self.small.get_or_insert_with(|| {
                // SAFETY: zeroed [u8; N] is valid
                unsafe { Box::<[u8; 2 * MAX_PATH_BYTES]>::new_zeroed().assume_init() }
            })
        } else if min_len <= 8 * Self::S {
            &mut **self.medium.get_or_insert_with(|| {
                // SAFETY: zeroed [u8; N] is valid
                unsafe { Box::<[u8; 8 * MAX_PATH_BYTES]>::new_zeroed().assume_init() }
            })
        } else {
            &mut **self.large.get_or_insert_with(|| {
                // SAFETY: zeroed [u8; N] is valid
                unsafe { Box::<[u8; 32 * MAX_PATH_BYTES]>::new_zeroed().assume_init() }
            })
        }
    }
}

// Drop is automatic for Option<Box<...>> fields — no explicit deinit needed.

// ──────────────────────────────────────────────────────────────────────────
// PipeReadBuffer / constants
// ──────────────────────────────────────────────────────────────────────────

pub type PipeReadBuffer = [u8; 256 * 1024];
const DIGESTED_HMAC_256_LEN: usize = 32;

// ──────────────────────────────────────────────────────────────────────────
// ProxyEnvStorage
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct ProxyEnvStorage {
    #[allow(non_snake_case)]
    pub HTTP_PROXY: Option<Arc<RefCountedEnvValue>>,
    pub http_proxy: Option<Arc<RefCountedEnvValue>>,
    #[allow(non_snake_case)]
    pub HTTPS_PROXY: Option<Arc<RefCountedEnvValue>>,
    pub https_proxy: Option<Arc<RefCountedEnvValue>>,
    #[allow(non_snake_case)]
    pub NO_PROXY: Option<Arc<RefCountedEnvValue>>,
    pub no_proxy: Option<Arc<RefCountedEnvValue>>,

    /// Held by Bun__setEnvValue around the slot swap + env.map.put, and by
    /// the worker around cloneFrom + env.map.cloneWithAllocator. This closes
    /// two races: (1) worker's cloneFrom reading a slot pointer concurrently
    /// with the parent's deref → free on the same pointer; (2) the env.map's
    /// backing ArrayHashMap being iterated during clone while the parent's
    /// put() rehashes it.
    pub lock: Mutex,
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
        { let $name: &'static [u8] = b"HTTP_PROXY";  let $field = &mut $self.HTTP_PROXY;  $body }
        { let $name: &'static [u8] = b"http_proxy";  let $field = &mut $self.http_proxy;  $body }
        { let $name: &'static [u8] = b"HTTPS_PROXY"; let $field = &mut $self.HTTPS_PROXY; $body }
        { let $name: &'static [u8] = b"https_proxy"; let $field = &mut $self.https_proxy; $body }
        { let $name: &'static [u8] = b"NO_PROXY";    let $field = &mut $self.NO_PROXY;    $body }
        { let $name: &'static [u8] = b"no_proxy";    let $field = &mut $self.no_proxy;    $body }
    }};
}

impl ProxyEnvStorage {
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
            strings::strings::eql_case_insensitive_ascii_check_length
        } else {
            strings::strings::eql
        };
        for_each_proxy_field!(self, |fname, field| {
            if eql(name, fname) {
                return Some(Slot { key: fname, ptr: field });
            }
        });
        None
    }

    /// Bump refcounts on all non-null values so a worker can share the
    /// parent's strings. Caller must hold parent.lock — the pointer load
    /// and ref() are not atomic with respect to Bun__setEnvValue's deref().
    pub fn clone_from(&mut self, parent: &ProxyEnvStorage) {
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
                    map.put($name, &val.bytes);
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

// ──────────────────────────────────────────────────────────────────────────
// AWSSignatureCache
// ──────────────────────────────────────────────────────────────────────────

pub struct AWSSignatureCache {
    pub cache: StringArrayHashMap<[u8; DIGESTED_HMAC_256_LEN]>,
    pub date: u64,
    pub lock: Mutex,
}

impl Default for AWSSignatureCache {
    fn default() -> Self {
        Self {
            cache: StringArrayHashMap::new(),
            date: 0,
            lock: Mutex::default(),
        }
    }
}

impl AWSSignatureCache {
    pub fn clean(&mut self) {
        // PORT NOTE: Zig freed each key explicitly; StringArrayHashMap with
        // owned Box<[u8]> keys drops them on clear.
        // TODO(port): verify StringArrayHashMap key ownership semantics
        self.cache.clear();
    }

    pub fn get(&mut self, numeric_day: u64, key: &[u8]) -> Option<&[u8]> {
        self.lock.lock();
        let _g = scopeguard::guard((), |_| self.lock.unlock());
        // TODO(port): bun.Mutex API — likely RAII guard in Rust; reshape in Phase B
        if self.date == 0 {
            return None;
        }
        if self.date == numeric_day {
            if let Some(cached) = self.cache.get_key(key) {
                return Some(cached);
            }
        }
        None
    }

    pub fn set(&mut self, numeric_day: u64, key: &[u8], value: [u8; DIGESTED_HMAC_256_LEN]) {
        self.lock.lock();
        let _g = scopeguard::guard((), |_| self.lock.unlock());
        // TODO(port): bun.Mutex API — likely RAII guard in Rust; reshape in Phase B
        if self.date == 0 {
            self.cache = StringArrayHashMap::new();
        } else if self.date != numeric_day {
            // day changed so we clean the old cache
            self.clean();
        }
        self.date = numeric_day;
        self.cache.put(Box::<[u8]>::from(key), value);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RareData methods (part 1: simple accessors)
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    pub fn aws_cache(&mut self) -> &mut AWSSignatureCache {
        &mut self.aws_signature_cache
    }

    pub fn pipe_read_buffer(&mut self) -> &mut PipeReadBuffer {
        self.temp_pipe_read_buffer.get_or_insert_with(|| {
            // SAFETY: zeroed [u8; N] is valid
            unsafe { Box::<PipeReadBuffer>::new_zeroed().assume_init() }
        })
    }

    pub fn add_listening_socket_for_watch_mode(&mut self, socket: Fd) {
        self.listening_sockets_for_watch_mode_lock.lock();
        // TODO(port): bun.Mutex API — RAII guard
        self.listening_sockets_for_watch_mode.push(socket);
        self.listening_sockets_for_watch_mode_lock.unlock();
    }

    pub fn remove_listening_socket_for_watch_mode(&mut self, socket: Fd) {
        self.listening_sockets_for_watch_mode_lock.lock();
        if let Some(i) = self
            .listening_sockets_for_watch_mode
            .iter()
            .position(|s| *s == socket)
        {
            self.listening_sockets_for_watch_mode.swap_remove(i);
        }
        self.listening_sockets_for_watch_mode_lock.unlock();
    }

    pub fn close_all_listen_sockets_for_watch_mode(&mut self) {
        self.listening_sockets_for_watch_mode_lock.lock();
        for socket in self.listening_sockets_for_watch_mode.drain(..) {
            // Prevent TIME_WAIT state
            syscall::disable_linger(socket);
            socket.close();
        }
        self.listening_sockets_for_watch_mode = Vec::new();
        self.listening_sockets_for_watch_mode_lock.unlock();
    }

    pub fn add_fs_watcher_for_isolation(&mut self, watcher: *mut FSWatcher) {
        self.fs_watchers_for_isolation.push(watcher);
    }

    pub fn remove_fs_watcher_for_isolation(&mut self, watcher: *mut FSWatcher) {
        if let Some(i) = self
            .fs_watchers_for_isolation
            .iter()
            .position(|w| *w == watcher)
        {
            self.fs_watchers_for_isolation.swap_remove(i);
        }
    }

    pub fn add_stat_watcher_for_isolation(&mut self, watcher: *mut StatWatcher) {
        self.stat_watchers_for_isolation.push(watcher);
    }

    pub fn remove_stat_watcher_for_isolation(&mut self, watcher: *mut StatWatcher) {
        if let Some(i) = self
            .stat_watchers_for_isolation
            .iter()
            .position(|w| *w == watcher)
        {
            self.stat_watchers_for_isolation.swap_remove(i);
        }
    }

    pub fn close_all_watchers_for_isolation(&mut self) {
        while let Some(watcher) = self.fs_watchers_for_isolation.pop() {
            // SAFETY: watcher was registered via add_fs_watcher_for_isolation and is still live
            unsafe { (*watcher).detach() };
        }
        while let Some(watcher) = self.stat_watchers_for_isolation.pop() {
            // SAFETY: watcher was registered via add_stat_watcher_for_isolation and is still live
            unsafe { (*watcher).close() };
        }
    }

    pub fn hot_map(&mut self) -> &mut HotMap {
        if self.hot_map.is_none() {
            self.hot_map = Some(HotMap::init());
        }
        self.hot_map.as_mut().unwrap()
    }

    pub fn mime_type_from_string(&mut self, str_: &[u8]) -> Option<MimeType> {
        if self.mime_types.is_none() {
            self.mime_types = Some(MimeType::create_hash_table());
        }
        if let Some(entry) = self.mime_types.as_ref().unwrap().get(str_) {
            return Some(bun_http::mime_type::Compact::from(entry).to_mime_type());
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HotMap
// ──────────────────────────────────────────────────────────────────────────

pub struct HotMap {
    _map: StringArrayHashMap<HotMapEntry>,
}

type HTTPServer = api::HTTPServer;
type HTTPSServer = api::HTTPSServer;
type DebugHTTPServer = api::DebugHTTPServer;
type DebugHTTPSServer = api::DebugHTTPSServer;
type TCPSocket = api::TCPSocket;
type TLSSocket = api::TLSSocket;
type Listener = api::Listener;

pub type HotMapEntry = TaggedPtrUnion<(
    HTTPServer,
    HTTPSServer,
    DebugHTTPServer,
    DebugHTTPSServer,
    TCPSocket,
    TLSSocket,
    Listener,
)>;

impl HotMap {
    pub fn init() -> HotMap {
        HotMap {
            _map: StringArrayHashMap::new(),
        }
    }

    pub fn get<T>(&mut self, key: &[u8]) -> Option<*mut T>
    where
        HotMapEntry: bun_collections::TaggedPtrGet<T>,
    {
        let entry = self._map.get(key)?;
        entry.get::<T>()
    }

    pub fn get_entry(&mut self, key: &[u8]) -> Option<HotMapEntry> {
        self._map.get(key).copied()
    }

    pub fn insert<T>(&mut self, key: &[u8], ptr: *mut T)
    where
        HotMapEntry: bun_collections::TaggedPtrInit<T>,
    {
        let entry = self._map.get_or_put(key);
        if entry.found_existing {
            panic!("HotMap already contains key");
        }
        *entry.key_ptr = Box::<[u8]>::from(key);
        *entry.value_ptr = HotMapEntry::init(ptr);
    }

    pub fn remove(&mut self, key: &[u8]) {
        let Some(entry) = self._map.get_entry(key) else {
            return;
        };
        // Zig captured the stored key ptr to free post-removal; in Rust the map
        // owns the Box<[u8]> key and `ordered_remove` drops it. Preserve the
        // aliasing assert (caller must not pass the map's own key storage).
        let is_same_slice =
            entry.key_ptr.as_ptr() == key.as_ptr() && entry.key_ptr.len() == key.len();
        debug_assert!(!is_same_slice);
        self._map.ordered_remove(key);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RareData methods (part 2: lazy initializers)
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    pub fn file_polls(&mut self, _vm: &mut VirtualMachine) -> &mut FilePollStore {
        self.file_polls_
            .get_or_insert_with(|| Box::new(FilePollStore::init()))
    }

    pub fn next_uuid(&mut self) -> UUID {
        if self.entropy_cache.is_none() {
            let mut cache = Box::new(EntropyCache::default());
            cache.init();
            self.entropy_cache = Some(cache);
        }
        let bytes = self.entropy_cache.as_mut().unwrap().get();
        UUID::init_with(&bytes)
    }

    pub fn entropy_slice(&mut self, len: usize) -> &mut [u8] {
        if self.entropy_cache.is_none() {
            let mut cache = Box::new(EntropyCache::default());
            cache.init();
            self.entropy_cache = Some(cache);
        }
        self.entropy_cache.as_mut().unwrap().slice(len)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// EntropyCache
// ──────────────────────────────────────────────────────────────────────────

pub struct EntropyCache {
    pub cache: [u8; EntropyCache::SIZE],
    pub index: usize,
}

impl Default for EntropyCache {
    fn default() -> Self {
        Self {
            // SAFETY: zeroed [u8; N] is valid; matches Zig `= undefined` then fill()
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

    pub fn slice(&mut self, len: usize) -> &mut [u8] {
        if len > self.cache.len() {
            return &mut [];
        }
        if self.index + len > self.cache.len() {
            self.fill();
        }
        let start = self.index;
        self.index += len;
        &mut self.cache[start..start + len]
    }

    pub fn get(&mut self) -> [u8; 16] {
        if self.index + 16 > self.cache.len() {
            self.fill();
        }
        let mut result = [0u8; 16];
        result.copy_from_slice(&self.cache[self.index..self.index + 16]);
        self.index += 16;
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CleanupHook
// ──────────────────────────────────────────────────────────────────────────

pub type CleanupHookFunction = unsafe extern "C" fn(*mut c_void);

#[derive(Clone, Copy)]
pub struct CleanupHook {
    pub ctx: *mut c_void,
    pub func: CleanupHookFunction,
    // TODO(port): LIFETIMES.tsv says &'a JSGlobalObject (JSC_BORROW); using raw ptr to avoid lifetime param in Phase A
    pub global_this: *const JSGlobalObject,
}

impl CleanupHook {
    pub fn eql(self, other: CleanupHook) -> bool {
        self.ctx == other.ctx
            && (self.func as usize) == (other.func as usize)
            && core::ptr::eq(self.global_this, other.global_this)
    }

    pub fn execute(self) {
        // SAFETY: ctx/func were registered together by N-API caller
        unsafe { (self.func)(self.ctx) };
    }

    pub fn init(
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) -> CleanupHook {
        CleanupHook {
            ctx,
            func,
            global_this: global_this as *const _,
        }
    }
}

impl RareData {
    pub fn push_cleanup_hook(
        &mut self,
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) {
        self.cleanup_hooks
            .push(CleanupHook::init(global_this, ctx, func));
    }

    pub fn boring_engine(&mut self) -> *mut boring_sys::ENGINE {
        match self.boring_ssl_engine {
            Some(e) => e,
            None => {
                // SAFETY: ENGINE_new is safe to call; returns null on OOM
                let e = unsafe { boring_sys::ENGINE_new() };
                self.boring_ssl_engine = Some(e);
                e
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// stderr / stdout / stdin
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    pub fn stderr(&mut self) -> &Arc<BlobStore> {
        bun_core::analytics::Features::bun_stderr_inc();
        if self.stderr_store.is_none() {
            let mut mode: bun_sys::Mode = 0;
            let fd = Fd::from_uv(2);

            match syscall::fstat(fd) {
                bun_sys::Result::Ok(stat) => {
                    mode = bun_sys::Mode::try_from(stat.mode).unwrap();
                }
                bun_sys::Result::Err(_) => {}
            }

            // TODO(port): BlobStore construction — Zig uses intrusive refcount=2;
            // with Arc the second ref is taken by the caller via .clone()
            let store = Arc::new(BlobStore::new_file(
                Blob::FileStore {
                    pathlike: Blob::PathLike::Fd(fd),
                    is_atty: Output::stderr_descriptor_type() == Output::DescriptorType::Terminal,
                    mode,
                    ..Default::default()
                },
            ));

            self.stderr_store = Some(store);
        }
        self.stderr_store.as_ref().unwrap()
    }

    pub fn stdout(&mut self) -> &Arc<BlobStore> {
        bun_core::analytics::Features::bun_stdout_inc();
        if self.stdout_store.is_none() {
            let mut mode: bun_sys::Mode = 0;
            let fd = Fd::from_uv(1);

            match syscall::fstat(fd) {
                bun_sys::Result::Ok(stat) => {
                    mode = bun_sys::Mode::try_from(stat.mode).unwrap();
                }
                bun_sys::Result::Err(_) => {}
            }
            let store = Arc::new(BlobStore::new_file(
                Blob::FileStore {
                    pathlike: Blob::PathLike::Fd(fd),
                    is_atty: Output::stdout_descriptor_type() == Output::DescriptorType::Terminal,
                    mode,
                    ..Default::default()
                },
            ));
            self.stdout_store = Some(store);
        }
        self.stdout_store.as_ref().unwrap()
    }

    pub fn stdin(&mut self) -> &Arc<BlobStore> {
        bun_core::analytics::Features::bun_stdin_inc();
        if self.stdin_store.is_none() {
            let mut mode: bun_sys::Mode = 0;
            let fd = Fd::from_uv(0);

            match syscall::fstat(fd) {
                bun_sys::Result::Ok(stat) => {
                    mode = bun_sys::Mode::try_from(stat.mode).unwrap();
                }
                bun_sys::Result::Err(_) => {}
            }
            let is_atty = if let Some(valid) = fd.unwrap_valid() {
                bun_sys::isatty(valid.native())
            } else {
                false
            };
            let store = Arc::new(BlobStore::new_file(
                Blob::FileStore {
                    pathlike: Blob::PathLike::Fd(fd),
                    is_atty,
                    mode,
                    ..Default::default()
                },
            ));
            self.stdin_store = Some(store);
        }
        self.stdin_store.as_ref().unwrap()
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
pub extern "C" fn Bun__Process__getStdinFdType(vm: *mut VirtualMachine, fd: i32) -> StdinFdType {
    // SAFETY: vm is a valid VirtualMachine pointer passed from C++
    let vm = unsafe { &mut *vm };
    let mode = match fd {
        0 => vm.rare_data().stdin().data.file().mode,
        1 => vm.rare_data().stdout().data.file().mode,
        2 => vm.rare_data().stderr().data.file().mode,
        _ => unreachable!(),
    };
    if bun_sys::s::isfifo(mode) {
        StdinFdType::Pipe
    } else if bun_sys::s::issock(mode) {
        StdinFdType::Socket
    } else {
        StdinFdType::File
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TLS default ciphers JS bindings
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__setTLSDefaultCiphers")]
fn set_tls_default_ciphers_from_js(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global_this.bun_vm();
    let args = callframe.arguments();
    let ciphers = if args.len() > 0 { args[0] } else { JSValue::UNDEFINED };
    if !ciphers.is_string() {
        return global_this.throw_invalid_argument_type_value("ciphers", "string", ciphers);
    }
    let sliced = ciphers.to_slice(global_this)?;
    vm.rare_data().set_tls_default_ciphers(sliced.slice());
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__getTLSDefaultCiphers")]
fn get_tls_default_ciphers_from_js(
    global_this: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global_this.bun_vm();
    let ciphers = match vm.rare_data().tls_default_ciphers() {
        Some(c) => c.as_bytes(),
        None => return bun_str::String::create_utf8_for_js(global_this, uws::get_default_ciphers()),
    };
    bun_str::String::create_utf8_for_js(global_this, ciphers)
}

// ──────────────────────────────────────────────────────────────────────────
// Socket groups
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    pub fn spawn_ipc_group(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        if self.spawn_ipc_group.loop_.is_none() {
            self.spawn_ipc_group.init(vm.uws_loop(), None, None);
        }
        &mut self.spawn_ipc_group
    }

    pub fn test_parallel_ipc_group(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        if self.test_parallel_ipc_group.loop_.is_none() {
            self.test_parallel_ipc_group.init(vm.uws_loop(), None, None);
        }
        &mut self.test_parallel_ipc_group
    }

    /// One shared group per (VM, ssl) for every `Bun.connect` / `tls.connect`
    /// client socket. Replaces the old per-connection `us_socket_context_t`
    /// allocation that was the root of the SSL_CTX-per-connect leak.
    pub fn bun_connect_group<const SSL: bool>(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        let g = if SSL {
            &mut self.bun_connect_group_tls
        } else {
            &mut self.bun_connect_group_tcp
        };
        if g.loop_.is_none() {
            g.init(vm.uws_loop(), None, None);
        }
        g
    }

    #[inline]
    fn lazy_group<'a>(g: &'a mut SocketGroup, vm: &mut VirtualMachine) -> &'a mut SocketGroup {
        // PORT NOTE: Zig took `comptime field: []const u8` + @field; Rust takes
        // the field reference directly since callers know the field statically.
        if g.loop_.is_none() {
            g.init(vm.uws_loop(), None, None);
        }
        g
    }

    pub fn postgres_group<const SSL: bool>(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL { &mut self.postgres_tls_group } else { &mut self.postgres_group },
            vm,
        )
    }
    pub fn mysql_group<const SSL: bool>(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL { &mut self.mysql_tls_group } else { &mut self.mysql_group_ },
            vm,
        )
    }
    pub fn valkey_group<const SSL: bool>(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL { &mut self.valkey_tls_group } else { &mut self.valkey_group_ },
            vm,
        )
    }
    pub fn ws_upgrade_group<const SSL: bool>(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL { &mut self.ws_upgrade_tls_group } else { &mut self.ws_upgrade_group_ },
            vm,
        )
    }
    pub fn ws_client_group<const SSL: bool>(&mut self, vm: &mut VirtualMachine) -> &mut SocketGroup {
        Self::lazy_group(
            if SSL { &mut self.ws_client_tls_group } else { &mut self.ws_client_group_ },
            vm,
        )
    }

    pub fn ssl_ctx_cache(&mut self) -> &mut SSLContextCache {
        &mut self.ssl_ctx_cache
    }

    /// Shared `SSL_CTX*` for client connects that didn't supply a custom CA
    /// (`Valkey({tls: true})`, `new WebSocket("wss://…")`). The old code allocated
    /// a fresh `us_socket_context_t` per such case and cached the pointer; now
    /// the SSL_CTX is the only thing worth caching.
    pub fn default_client_ssl_ctx(&mut self) -> *mut boring_sys::SSL_CTX {
        if self.default_client_ssl_ctx.is_none() {
            let mut err = uws::CreateBunSocketError::None;
            // Mode-neutral CTX (VERIFY_NONE). `us_internal_ssl_attach` overrides
            // each client SSL to VERIFY_PEER + the shared bundled-root store, so
            // `new WebSocket("wss://…")` (which shares this CTX and defaults to
            // rejectUnauthorized:true) verifies real servers. Route through the
            // weak cache so a `tls.connect()` with default options later resolves
            // to the same CTX rather than building a second one with the same
            // digest. The +1 ref returned here is held for the VM's lifetime, so
            // the entry never tombstones.
            let ctx = self
                .ssl_ctx_cache
                .get_or_create_opts(Default::default(), &mut err)
                .unwrap_or_else(|| {
                    Output::panic(format_args!(
                        "default client SSL_CTX init failed: {}",
                        bstr::BStr::new(err.message().unwrap_or(b"unknown"))
                    ))
                });
            self.default_client_ssl_ctx = Some(ctx);
        }
        self.default_client_ssl_ctx.unwrap()
    }

    pub fn global_dns_resolver(&mut self, vm: &mut VirtualMachine) -> &mut dns::Resolver {
        if self.global_dns_data.is_none() {
            self.global_dns_data = Some(dns::GlobalData::init(vm));
            self.global_dns_data.as_mut().unwrap().resolver.ref_(); // live forever
        }
        &mut self.global_dns_data.as_mut().unwrap().resolver
    }

    pub fn node_fs_stat_watcher_scheduler(
        &mut self,
        vm: &mut VirtualMachine,
    ) -> RefPtr<StatWatcherScheduler> {
        self.node_fs_stat_watcher_scheduler
            .get_or_insert_with(|| StatWatcherScheduler::init(vm))
            .dupe_ref()
    }

    pub fn s3_default_client(&mut self, global_this: &JSGlobalObject) -> JSValue {
        if let Some(v) = self.s3_default_client.get() {
            return v;
        }
        let vm = global_this.bun_vm();
        let aws_options = match bun_runtime::s3::S3Credentials::get_credentials_with_options(
            vm.transpiler.env.get_s3_credentials(),
            Default::default(),
            None,
            None,
            None,
            false,
            global_this,
        ) {
            Ok(v) => v,
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            Err(err @ JsError::Thrown) | Err(err @ JsError::Terminated) => {
                global_this.report_active_exception_as_unhandled(err);
                return JSValue::UNDEFINED;
            }
        };
        // aws_options drops at scope end (impl Drop)
        let client = S3Client::new(S3Client {
            credentials: aws_options.credentials.dupe(),
            options: aws_options.options,
            acl: aws_options.acl,
            storage_class: aws_options.storage_class,
            ..Default::default()
        });
        let js_client = client.to_js(global_this);
        js_client.ensure_still_alive();
        self.s3_default_client = Strong::create(js_client, global_this);
        js_client
    }

    pub fn tls_default_ciphers(&self) -> Option<&ZStr> {
        self.tls_default_ciphers.as_deref()
    }

    pub fn set_tls_default_ciphers(&mut self, ciphers: &[u8]) {
        // Old value (if any) drops here via Box<ZStr> Drop
        self.tls_default_ciphers = Some(ZStr::from_bytes(ciphers));
    }

    pub fn default_csrf_secret(&mut self) -> &[u8] {
        if self.default_csrf_secret.is_empty() {
            let mut secret = vec![0u8; 16].into_boxed_slice();
            bun_core::csprng(&mut secret);
            self.default_csrf_secret = secret;
        }
        &self.default_csrf_secret
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for RareData {
    fn drop(&mut self) {
        // temp_pipe_read_buffer: Option<Box<...>> drops automatically
        // spawn_sync_event_loop_: Option<Box<...>> drops automatically
        // aws_signature_cache: StringArrayHashMap drops owned keys automatically
        // s3_default_client: Strong has Drop

        if let Some(engine) = self.boring_ssl_engine.take() {
            // SAFETY: engine was created by ENGINE_new
            unsafe { boring_sys::ENGINE_free(engine) };
        }
        // default_csrf_secret: Box<[u8]> drops automatically
        // cleanup_hooks: Vec drops automatically
        debug_assert!(self.cron_jobs.is_empty());
        // cron_jobs: Vec drops automatically
        // path_buf: has Drop (auto for Option<Box>)
        // websocket_deflate: Option<Box<...>> drops automatically
        // tls_default_ciphers: Option<Box<ZStr>> drops automatically
        // valkey_context: has Drop

        if let Some(s) = self.default_client_ssl_ctx.take() {
            // SAFETY: s was returned by ssl_ctx_cache.get_or_create_opts with +1 ref
            unsafe { boring_sys::SSL_CTX_free(s) };
        }
        // After the default-ctx free so the tombstone callback still finds a live
        // map; deinit then clears every remaining entry's ex_data so any later
        // SSL_CTX_free (from sockets that survive RareData) doesn't deref freed
        // Entries.
        // ssl_ctx_cache: has Drop — Rust drops fields in declaration order, and
        // ssl_ctx_cache is declared before default_client_ssl_ctx. We've already
        // freed default_client_ssl_ctx above so ordering matches Zig.
        // TODO(port): verify field-drop ordering wrt ssl_ctx_cache; may need ManuallyDrop

        // closeAllSocketGroups() must have already run (before JSC teardown) so
        // these are empty; SocketGroup::drop asserts that in debug.
        // (socket group fields drop automatically)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// closeAllSocketGroups / websocketDeflate / spawnSyncEventLoop
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    /// Drain every embedded socket group. Must run BEFORE JSC teardown — closeAll
    /// fires on_close → JS callbacks → needs a live VM. RareData.deinit() runs
    /// after `WebWorker__teardownJSCVM` (web_worker.zig), so doing the closeAll
    /// there would dispatch into freed JSC heap.
    pub fn close_all_socket_groups(&mut self, vm: &mut VirtualMachine) {
        // closeAll() dispatches on_close into JS while the VM is still alive, so a
        // handler can call Bun.connect/postgres/etc. and re-populate a group we
        // just drained. Loop until every group is observed empty in the same pass
        // (bounded — each retry only happens if a JS callback opened a *new*
        // socket, and the cap stops a deliberately-spinning on_close from wedging
        // teardown; the post-close force-drain in close_all handles whatever's
        // left after the cap).
        // Walk the loop's linked-group list rather than just our 14 embedded
        // fields: Listener/uWS-App groups own their own SocketGroup, and accepted
        // sockets land *there*, not in RareData. Iterating only `socket_group_fields`
        // missed those, leaking one 88-byte us_socket_t per still-open accepted
        // connection at process.exit() (the LSAN cluster on #29932 build 49245).
        let _ = self;
        let loop_ = vm.uws_loop();
        let mut rounds: u8 = 0;
        while rounds < 8 {
            if !loop_.close_all_groups() {
                break;
            }
            rounds += 1;
        }
        // us_socket_close pushes to loop->data.closed_head; loop_post() normally
        // frees it on the next tick. We're past the last tick, so drain it now —
        // every us_socket_t is libc-allocated and otherwise becomes an LSAN leak
        // (the only pointer into it lives in mimalloc-backed RareData, which LSAN
        // can't trace once we unregister the root region).
        vm.uws_loop().drain_closed_sockets();
    }

    pub fn websocket_deflate(&mut self) -> &mut WebSocketDeflateRareData {
        self.websocket_deflate
            .get_or_insert_with(|| Box::new(WebSocketDeflateRareData::default()))
    }

    pub fn spawn_sync_event_loop(&mut self, vm: &mut VirtualMachine) -> &mut SpawnSyncEventLoop {
        if self.spawn_sync_event_loop_.is_none() {
            // TODO(port): in-place init — Zig used Owned::new(undefined) then ptr.init(vm)
            self.spawn_sync_event_loop_ = Some(Box::new(SpawnSyncEventLoop::init(vm)));
        }
        self.spawn_sync_event_loop_.as_mut().unwrap()
    }
}

pub use bun_event_loop::SpawnSyncEventLoop as SpawnSyncEventLoopReexport;
// TODO(port): Zig had `pub const SpawnSyncEventLoop = @import(...)` — already imported above

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/rare_data.zig (955 lines)
//   confidence: medium
//   todos:      11
//   notes:      BlobStore intrusive-refcount → Arc reshape needs Phase B review; bun.Mutex API assumed lock()/unlock(); @field/@typeInfo loops unrolled via macro; several field names suffixed `_` to avoid method-name collision; ssl_ctx_cache drop ordering needs ManuallyDrop check; PathBuf::get dropped stack-fallback allocator (callers must handle overflow).
// ──────────────────────────────────────────────────────────────────────────
