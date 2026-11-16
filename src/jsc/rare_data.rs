use core::cell::OnceCell;
use core::ffi::c_void;
use core::marker::PhantomData;
use core::sync::atomic::Ordering;
use std::sync::Arc;

use crate::bindgen::JsHeap;
use crate::node_path::PathOrFileDescriptor;
use crate::spawn_sync_event_loop::SpawnSyncEventLoop;
use crate::strong::Optional as Strong;
use crate::virtual_machine::VirtualMachine;
use crate::webcore_types::store::{Data, File, Store};
use crate::{JSGlobalObject, JsCell};
use bun_boringssl::c as boring;
use bun_collections::StringArrayHashMap;
use bun_core::strings;
use bun_core::{Mutex, Output};
use bun_libdeflate_sys::libdeflate;
use bun_paths::MAX_PATH_BYTES;
use bun_ptr::RefPtr;
use bun_sys::{self as syscall, Fd, Mode, Stdio};
use bun_uws::{self as uws, SocketGroup};

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
//   - the `bun test --isolate` watcher/server registries → each owner embeds
//     a `bun_jsc::AbortHandle` armed in its `ScriptExecutionContext`.
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
    _map: JsCell<StringArrayHashMap<HotMapEntry>>,
    _not_send: PhantomData<*mut ()>,
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
    pub(crate) fn init() -> HotMap {
        HotMap {
            _map: JsCell::new(StringArrayHashMap::new()),
            _not_send: PhantomData,
        }
    }

    pub fn get_entry(&self, key: &[u8]) -> Option<HotMapEntry> {
        self._map.get().get(key).copied()
    }

    /// Untyped insert — typed `insert<T>` lives in `bun_runtime` where the
    /// `TaggedPointerUnion` payload list is named.
    pub fn insert_raw(&self, key: &[u8], entry: HotMapEntry) {
        self._map.with_mut(|map| {
            let gop = bun_core::handle_oom(map.get_or_put(key));
            if gop.found_existing {
                panic!("HotMap already contains key");
            }
            // `get_or_put` already boxed the key; the map owns its keys.
            *gop.value_ptr = entry;
        });
    }

    pub fn remove(&self, key: &[u8]) {
        // The map owns the Box<[u8]> key and `swap_remove` drops it. The
        // aliasing assert below means the caller must not pass the map's own
        // key storage. Ordering doesn't matter for HotMap consumers.
        let Some(i) = self._map.get().get_index(key) else {
            return;
        };
        let stored = &self._map.get().keys()[i];
        let is_same_slice = stored.as_ptr() == key.as_ptr() && stored.len() == key.len();
        debug_assert!(!is_same_slice);
        self._map.with_mut(|map| map.swap_remove(key));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// EntropyCache
// ──────────────────────────────────────────────────────────────────────────

pub struct EntropyCache {
    pub(crate) cache: [u8; Self::SIZE],
    pub(crate) index: usize,
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
    pub(crate) const BUFFERED_UUIDS_COUNT: usize = 16;
    pub(crate) const SIZE: usize = Self::BUFFERED_UUIDS_COUNT * 128;

    pub(crate) fn fill(&mut self) {
        bun_boringssl::rand_bytes(&mut self.cache);
        self.index = 0;
    }
    fn get<const N: usize>(&mut self) -> [u8; N] {
        if self.index + N > self.cache.len() {
            self.fill();
        }
        let mut r = [0u8; N];
        r.copy_from_slice(&self.cache[self.index..self.index + N]);
        self.index += N;
        r
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CleanupHook
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type CleanupHookFunction = unsafe extern "C" fn(*mut c_void);

#[derive(Clone, Copy)]
pub struct CleanupHook {
    pub(crate) ctx: *mut c_void,
    pub(crate) func: CleanupHookFunction,
    // Conceptually a borrow of the JSGlobalObject (JSC_BORROW per
    // LIFETIMES.tsv); a raw ptr avoids threading a lifetime param through
    // `RareData`.
    pub global_this: *const JSGlobalObject,
}

impl CleanupHook {
    fn from(
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
// RareData
// ──────────────────────────────────────────────────────────────────────────

pub struct RareData {
    /// Indexed by `Stdio`.
    stdio: [OnceCell<StdioStore>; 3],

    entropy_cache: JsCell<Option<Box<EntropyCache>>>,

    hot_map: OnceCell<HotMap>,

    // TODO: make this per JSGlobalObject instead of global
    // This does not handle ShadowRealm correctly!
    pub(crate) cleanup_hooks: JsCell<Vec<CleanupHook>>,
    /// Joins `cleanup_hooks` once `VirtualMachine::teardown` has everything back from other threads.
    pub(crate) cleanup_hooks_after_teardown_wait: JsCell<Vec<CleanupHook>>,

    #[cfg(not(windows))]
    pub(crate) file_polls: OnceCell<Box<FilePollStore>>,

    /// Embedded socket groups for kinds that aren't tied to a Listener / server.
    /// Lazily linked into the loop on first socket; never separately allocated.
    pub(crate) spawn_ipc_group: SocketGroup,
    /// `bun test --parallel` IPC channel (worker ↔ coordinator). Survives the
    /// per-file isolation swap so the worker keeps its link to the coordinator.
    pub(crate) test_parallel_ipc_group: SocketGroup,
    /// The client sockets of the VM's own contexts.
    pub(crate) socket_groups: SocketGroups,

    /// `ssl_ctx_cache.getOrCreate(&.{})` — i.e. the default-trust-store client
    /// CTX. Cached separately so the hot `tls:true` / `wss://` path skips even the
    /// SHA-256 + map lookup. Ref owned here. Lazy-init body lives in
    /// `bun_runtime` (it calls `SSLContextCache::get_or_create_opts`).
    /// Held until `tls.DEFAULT_CIPHERS` is assigned so the weak-cache entry never tombstones.
    pub default_client_ssl_ctx: JsCell<Option<boring::OwnedSslCtx>>,

    /// Watch-mode restart needs to RST every listen socket so the new process
    /// can rebind without `EADDRINUSE`. Written on the JS thread; drained on
    /// the watcher thread — hence the mutex (PORTING.md §Concurrency: lock
    /// owns the data, no sidecar `Mutex<()>`).
    pub(crate) listening_sockets_for_watch_mode: Mutex<Vec<Fd>>,

    pub pipe_read_scratch: Box<bun_event_loop::PipeReadScratch>,

    /// `node:http2` PADDED DATA scratch; see [`Self::take_h2_padded_frame_buffer`].
    h2_padded_frame_buffer: JsCell<Option<Box<H2PaddedFrameBuffer>>>,
    /// Output scratch for one JS-thread `CompressionStream` step; see [`Self::take_compression_scratch`].
    compression_scratch: JsCell<Option<Vec<u8>>>,
    /// Inflated payload of one `new WebSocket()` client message; see [`Self::take_websocket_inflate_scratch`].
    websocket_inflate_scratch: JsCell<Option<Vec<u8>>>,
    /// One libdeflate handle for every JS-thread one-shot inflate; see [`Self::libdeflate_decompressor`].
    libdeflate_decompressor: OnceCell<libdeflate::OwnedDecompressor>,

    // There is intentionally no `aws_signature_cache` field — storage lives in
    // `bun_s3_signing::credentials::AWS_SIGNATURE_CACHE` (process static; it
    // was always reached via the main-thread VM, so it was a singleton in
    // practice). Hosting it in the consumer crate removes the upward
    // `s3_signing → jsc` hook.
    pub s3_default_client: JsCell<Strong>,
    /// Per-VM, like Node's quic `BindingData` (node/src/quic/bindingdata.h).
    pub node_quic_callbacks: JsCell<Strong>,
    default_csrf_secret: OnceCell<[u8; 16]>,

    /// Owned NUL-terminated buffer. `len()` includes the trailing 0;
    /// [`Self::tls_default_ciphers`] strips it.
    tls_default_ciphers: JsCell<Option<Box<[u8]>>>,

    // proxy_env_storage moved to VirtualMachine — see comment there on why
    // lazy RareData creation raced with worker spawn.
    spawn_sync_event_loop_: OnceCell<Box<SpawnSyncEventLoop>>,

    pub path_buf: JsCell<PathBuf>,
}

#[cfg(not(windows))]
pub(crate) type FilePollStore = bun_io::file_poll::Store;

impl Default for RareData {
    fn default() -> Self {
        Self {
            stdio: Default::default(),
            entropy_cache: JsCell::new(None),
            hot_map: OnceCell::new(),
            cleanup_hooks: JsCell::new(Vec::new()),
            cleanup_hooks_after_teardown_wait: JsCell::new(Vec::new()),
            #[cfg(not(windows))]
            file_polls: OnceCell::new(),
            spawn_ipc_group: SocketGroup::default(),
            test_parallel_ipc_group: SocketGroup::default(),
            socket_groups: SocketGroups::default(),
            default_client_ssl_ctx: JsCell::new(None),
            listening_sockets_for_watch_mode: Mutex::new(Vec::new()),
            pipe_read_scratch: Box::new(bun_event_loop::PipeReadScratch::new()),
            h2_padded_frame_buffer: JsCell::new(None),
            compression_scratch: JsCell::new(None),
            websocket_inflate_scratch: JsCell::new(None),
            libdeflate_decompressor: OnceCell::new(),
            s3_default_client: JsCell::new(Strong::empty()),
            node_quic_callbacks: JsCell::new(Strong::empty()),
            default_csrf_secret: OnceCell::new(),
            tls_default_ciphers: JsCell::new(None),
            spawn_sync_event_loop_: OnceCell::new(),
            path_buf: JsCell::default(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PathBuf
// ──────────────────────────────────────────────────────────────────────────

/// Reusable heap buffer for path.resolve, path.relative, and path.toNamespacedPath.
/// Three fixed-size tiers, lazily allocated on first use. Safe because JS is single-threaded.
#[derive(Default)]
pub struct PathBuf {
    pub(crate) small: Option<Box<[u8; 2 * MAX_PATH_BYTES]>>,
    pub(crate) medium: Option<Box<[u8; 8 * MAX_PATH_BYTES]>>,
    pub(crate) large: Option<Box<[u8; 32 * MAX_PATH_BYTES]>>,
}

impl PathBuf {
    const S: usize = MAX_PATH_BYTES;

    /// Returns the smallest lazily-allocated tier buffer that fits `min_len`.
    // Revisit caller semantics for inputs exceeding the large tier.
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

/// One max-size HTTP/2 PADDED DATA frame payload (pad-length byte + data + padding).
pub type H2PaddedFrameBuffer = [u8; 16384];

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

/// Uppercase first: on Windows the case-insensitive compare in `slot` matches
/// the uppercase entry for either input case.
const PROXY_ENV_KEYS: [&[u8]; 8] = [
    b"HTTP_PROXY",
    b"http_proxy",
    b"HTTPS_PROXY",
    b"https_proxy",
    b"ALL_PROXY",
    b"all_proxy",
    b"NO_PROXY",
    b"no_proxy",
];

/// One value per `PROXY_ENV_KEYS` entry.
#[derive(Default)]
pub struct ProxyEnvSlots([Option<Arc<RefCountedEnvValue>>; PROXY_ENV_KEYS.len()]);

pub struct Slot<'a> {
    /// Static-lifetime name (e.g. "NO_PROXY") — safe to use as
    /// the env map key without duping.
    pub key: &'static [u8],
    pub ptr: &'a mut Option<Arc<RefCountedEnvValue>>,
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
        let index = PROXY_ENV_KEYS.iter().position(|key| eql(name, key))?;
        Some(Slot {
            key: PROXY_ENV_KEYS[index],
            ptr: &mut self.0[index],
        })
    }

    /// Bump refcounts on all non-null values so a worker can share the
    /// parent's strings. Caller passes the parent's locked guard — the `Arc`
    /// load + clone is not atomic with respect to `Bun__setEnvValue`'s drop.
    pub(crate) fn clone_from(&mut self, parent: &ProxyEnvSlots) {
        self.0.clone_from(&parent.0);
    }

    /// Overwrite proxy-var entries in an env map with this storage's reffed
    /// bytes. Used after map.cloneWithAllocator in the worker so the cloned
    /// map and the reffed storage agree — defense-in-depth in case the map
    /// clone captured a snapshot the storage doesn't hold a ref on (e.g. an
    /// initial-environ value later overwritten by the setter).
    pub(crate) fn sync_into(&self, map: &mut bun_dotenv::Map) {
        for (key, value) in PROXY_ENV_KEYS.iter().zip(&self.0) {
            if let Some(value) = value {
                bun_core::handle_oom(map.put(key, &value.bytes));
            }
        }
    }

    /// Undo every `Bun__setEnvValue` since `snapshot` was captured: drop the
    /// slot refs and put the captured values back into `map`. Caller holds
    /// the `ProxyEnvStorage` lock, like the setter.
    pub(crate) fn restore(&mut self, map: &mut bun_dotenv::Map, snapshot: &ProxyEnvSnapshot) {
        self.0 = Default::default();
        for (key, value) in &snapshot.entries {
            match value {
                Some(value) => bun_core::handle_oom(map.put(key, value)),
                None => map.remove(key),
            }
        }
    }
}

/// The proxy keys as the env map held them when the test runner started.
/// `process.env` writes to these keys go through `Bun__setEnvValue` into the
/// per-VM env map, which seeds every later global's `process.env`, so
/// `--isolate` restores them from this between files.
pub struct ProxyEnvSnapshot {
    entries: [(&'static [u8], Option<Box<[u8]>>); PROXY_ENV_KEYS.len()],
}

impl ProxyEnvSnapshot {
    pub fn capture(map: &bun_dotenv::Map) -> Self {
        Self {
            entries: PROXY_ENV_KEYS.map(|key| (key, map.get(key).map(Box::from))),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RefCountedEnvValue
// ──────────────────────────────────────────────────────────────────────────

/// A ref-counted heap-allocated byte slice. The env map stores borrowed
/// `.bytes` slices; as long as any VM holds a ref, the bytes stay valid.
///
/// Holders are `Arc<RefCountedEnvValue>` (per LIFETIMES.tsv): the refcount
/// lives in the `Arc` header, so ref/deref are `Arc::clone`/`drop`.
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
// RareData methods — simple accessors / lazy-init
// ──────────────────────────────────────────────────────────────────────────

/// The socket groups, embedded and lazily linked into the loop on first
/// socket, for client sockets that aren't tied to a Listener / server: one set
/// per [`ScriptExecutionContext`](crate::ScriptExecutionContext) that owns
/// sockets (the VM's own contexts share `RareData`'s), so a context that stops
/// closes exactly what its script connected.
#[derive(Default)]
pub struct SocketGroups {
    /// `Bun.connect` client sockets — one group per context (not per connection).
    bun_connect_group_tcp: SocketGroup,
    bun_connect_group_tls: SocketGroup,
    /// SQL drivers — TCP and TLS share one group each. STARTTLS adopts
    /// from the `_tcp` group into `_tls` without reallocating a context.
    postgres_group: SocketGroup,
    postgres_tls_group: SocketGroup,
    mysql_group_: SocketGroup,
    mysql_tls_group: SocketGroup,
    valkey_group_: SocketGroup,
    valkey_tls_group: SocketGroup,
    /// `new WebSocket(...)` client. Upgrade phase (HTTP handshake) and connected
    /// phase (frame I/O) live in separate kinds so the handshake handler doesn't
    /// have to runtime-branch on state.
    ws_upgrade_group_: SocketGroup,
    ws_upgrade_tls_group: SocketGroup,
    ws_client_group_: SocketGroup,
    ws_client_tls_group: SocketGroup,
}

impl SocketGroups {
    /// How many groups a set has: the length of [`each`](Self::each)'s array, which does not
    /// compile with any other.
    const COUNT: usize = 12;

    fn each(&self) -> [&SocketGroup; Self::COUNT] {
        [
            &self.bun_connect_group_tcp,
            &self.bun_connect_group_tls,
            &self.postgres_group,
            &self.postgres_tls_group,
            &self.mysql_group_,
            &self.mysql_tls_group,
            &self.valkey_group_,
            &self.valkey_tls_group,
            &self.ws_upgrade_group_,
            &self.ws_upgrade_tls_group,
            &self.ws_client_group_,
            &self.ws_client_tls_group,
        ]
    }

    /// The set `group` is one of: where a socket in `group` moves to when it
    /// changes kind (STARTTLS, WebSocket upgrade → client), so it stays with
    /// the context that connected it.
    ///
    /// # Safety
    /// `group` is a linked group of some `SocketGroups`.
    pub unsafe fn of<'a>(group: &SocketGroup) -> &'a SocketGroups {
        // SAFETY: fn contract — `lazy` set the owner to the embedding set,
        // which is boxed (in `RareData` or on its own) and outlives its sockets.
        unsafe { &*group.owner::<SocketGroups>() }
    }

    #[inline]
    fn lazy(&self, group: fn(&Self) -> &SocketGroup, loop_: &'static uws::Loop) -> &SocketGroup {
        let owner = core::ptr::from_ref(self).cast_mut().cast::<c_void>();
        let g = group(self);
        if g.loop_.get().is_null() {
            g.init(loop_, None, owner);
        }
        g
    }

    /// One shared group per (context, ssl) for every `Bun.connect` / `tls.connect`
    /// client socket. Replaces the old per-connection `us_socket_context_t`
    /// allocation that was the root of the SSL_CTX-per-connect leak.
    pub fn bun_connect_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        if SSL {
            self.lazy(|s| &s.bun_connect_group_tls, loop_)
        } else {
            self.lazy(|s| &s.bun_connect_group_tcp, loop_)
        }
    }
    pub fn postgres_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        if SSL {
            self.lazy(|s| &s.postgres_tls_group, loop_)
        } else {
            self.lazy(|s| &s.postgres_group, loop_)
        }
    }
    pub fn mysql_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        if SSL {
            self.lazy(|s| &s.mysql_tls_group, loop_)
        } else {
            self.lazy(|s| &s.mysql_group_, loop_)
        }
    }
    pub fn valkey_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        if SSL {
            self.lazy(|s| &s.valkey_tls_group, loop_)
        } else {
            self.lazy(|s| &s.valkey_group_, loop_)
        }
    }
    pub fn ws_upgrade_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        if SSL {
            self.lazy(|s| &s.ws_upgrade_tls_group, loop_)
        } else {
            self.lazy(|s| &s.ws_upgrade_group_, loop_)
        }
    }
    pub fn ws_client_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        if SSL {
            self.lazy(|s| &s.ws_client_tls_group, loop_)
        } else {
            self.lazy(|s| &s.ws_client_group_, loop_)
        }
    }

    /// No socket is open, connecting or listening in any of these groups.
    pub(crate) fn is_empty(&self) -> bool {
        self.each().into_iter().all(Self::group_is_empty)
    }

    /// Close every socket in these groups (JS thread), for a context that has stopped: nothing
    /// connects for it any more, so one pass leaves them empty.
    pub(crate) fn close_all(&self) {
        for group in self.each() {
            if !group.loop_.get().is_null() {
                group.close_all();
            }
        }
    }

    fn group_is_empty(g: &SocketGroup) -> bool {
        g.head_sockets.get().is_null()
            && g.head_connecting_sockets.get().is_null()
            && g.head_listen_sockets.get().is_null()
            && g.low_prio_count.get() == 0
    }
}

impl RareData {
    pub(crate) fn release_js_handles(&self) {
        self.s3_default_client.set(Default::default());
        self.node_quic_callbacks.set(Default::default());
    }

    // ── lazy-init: hot_map ─────────────────────────────────────────────────
    pub(crate) fn hot_map(&self) -> &HotMap {
        self.hot_map.get_or_init(HotMap::init)
    }

    #[cfg(not(windows))]
    pub(crate) fn file_polls(&self) -> &FilePollStore {
        self.file_polls
            .get_or_init(|| Box::new(FilePollStore::init()))
    }

    // ── lazy-init: entropy ─────────────────────────────────────────────────
    pub fn entropy<const N: usize>(&self) -> [u8; N] {
        self.entropy_cache.with_mut(|cache| {
            let cache = cache.get_or_insert_with(|| {
                let mut c = Box::new(EntropyCache::default());
                c.fill();
                c
            });
            cache.get()
        })
    }
    pub fn next_uuid(&self) -> UUID {
        UUID::init_with(&self.entropy())
    }

    // ── lazy-init: misc heap slots ────────────────────────────────────────

    /// Take the padded-frame scratch out of its slot (lazily allocated). By value rather
    /// than borrowed: the socket write it feeds can re-enter JS and reach this path
    /// again, and that nested caller then finds the slot empty and allocates its own.
    pub fn take_h2_padded_frame_buffer(&self) -> Box<H2PaddedFrameBuffer> {
        self.h2_padded_frame_buffer
            .take()
            .unwrap_or_else(bun_core::boxed_zeroed::<H2PaddedFrameBuffer>)
    }

    /// Hand a taken buffer back; the slot keeps the first one returned.
    pub fn put_back_h2_padded_frame_buffer(&self, buffer: Box<H2PaddedFrameBuffer>) {
        self.h2_padded_frame_buffer.with_mut(|slot| {
            slot.get_or_insert(buffer);
        });
    }

    /// Empty `Vec` with whatever capacity the last step left behind.
    pub fn take_compression_scratch(&self) -> Vec<u8> {
        self.compression_scratch.take().unwrap_or_default()
    }

    /// Hand a taken buffer back; the slot keeps the first one returned and lets an oversized one go.
    pub fn put_back_compression_scratch(&self, mut buffer: Vec<u8>) {
        const KEEP: usize = 256 * 1024;
        if self.compression_scratch.get().is_none() && buffer.capacity() <= KEEP {
            buffer.clear();
            self.compression_scratch.set(Some(buffer));
        }
    }

    /// Empty `Vec` with whatever capacity the last WebSocket client inflate left behind. By value,
    /// like [`Self::take_h2_padded_frame_buffer`]: delivering the payload runs JS, which can reach
    /// this path again before the buffer comes back.
    pub fn take_websocket_inflate_scratch(&self) -> Vec<u8> {
        self.websocket_inflate_scratch.take().unwrap_or_default()
    }

    /// Hand a taken buffer back; the slot keeps the first one returned and lets an oversized one go.
    pub fn put_back_websocket_inflate_scratch(&self, mut buffer: Vec<u8>) {
        const KEEP: usize = 256 * 1024;
        if self.websocket_inflate_scratch.get().is_none() && buffer.capacity() <= KEEP {
            buffer.clear();
            self.websocket_inflate_scratch.set(Some(buffer));
        }
    }

    /// libdeflate keeps no state between calls, so one handle serves every one-shot inflate on
    /// this thread. `None` when libdeflate cannot allocate it; callers fall back to zlib.
    pub fn libdeflate_decompressor(&self) -> Option<&libdeflate::OwnedDecompressor> {
        let cell = &self.libdeflate_decompressor;
        if cell.get().is_none() {
            let _ = cell.set(libdeflate::OwnedDecompressor::new()?);
        }
        cell.get()
    }

    pub fn default_csrf_secret(&self) -> &[u8] {
        self.default_csrf_secret.get_or_init(|| {
            let mut secret = [0u8; 16];
            bun_boringssl::rand_bytes(&mut secret);
            secret
        })
    }

    pub(crate) fn tls_default_ciphers(&self) -> Option<&[u8]> {
        // The stored buffer is NUL-terminated (set_tls_default_ciphers
        // appends 0); the trailing NUL is stripped from the returned slice's
        // length. Callers needing a C string can still take `.as_ptr()` — the
        // NUL byte remains in storage one-past-the-end.
        self.tls_default_ciphers
            .get()
            .as_deref()
            .map(|s| &s[..s.len() - 1])
    }

    pub(crate) fn set_tls_default_ciphers(&self, ciphers: &[u8]) {
        // Old value (if any) drops here via Box<[u8]> Drop.
        let mut owned = Vec::with_capacity(ciphers.len() + 1);
        owned.extend_from_slice(ciphers);
        owned.push(0);
        self.tls_default_ciphers.set(Some(owned.into_boxed_slice()));
        // Built from the previous list. Open connections hold their own reference.
        self.default_client_ssl_ctx.set(None);
    }

    /// # Safety
    /// `func` takes `ctx`, once, when the VM exits.
    pub unsafe fn push_cleanup_hook(
        &self,
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) {
        self.cleanup_hooks
            .with_mut(|hooks| hooks.push(CleanupHook::from(global_this, ctx, func)));
    }

    /// # Safety
    /// As [`Self::push_cleanup_hook`].
    pub unsafe fn push_cleanup_hook_after_teardown_wait(
        &self,
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) {
        self.cleanup_hooks_after_teardown_wait
            .with_mut(|hooks| hooks.push(CleanupHook::from(global_this, ctx, func)));
    }

    /// `None` if the loop cannot be created; nothing is cached, so a later call retries.
    pub fn spawn_sync_event_loop(&self, vm: &VirtualMachine) -> Option<&SpawnSyncEventLoop> {
        if self.spawn_sync_event_loop_.get().is_none() {
            // SAFETY: `self` keeps it, and is dropped with the VM.
            let el = unsafe { SpawnSyncEventLoop::init(vm) }?;
            let _ = self.spawn_sync_event_loop_.set(el);
        }
        self.spawn_sync_event_loop_.get().map(|el| &**el)
    }

    // ── watch-mode listen sockets ─────────────────────────────────────────
    pub(crate) fn add_listening_socket_for_watch_mode(&self, socket: Fd) {
        self.listening_sockets_for_watch_mode.lock().push(socket);
    }

    pub(crate) fn remove_listening_socket_for_watch_mode(&self, socket: Fd) {
        let mut sockets = self.listening_sockets_for_watch_mode.lock();
        if let Some(i) = sockets.iter().position(|s| *s == socket) {
            sockets.swap_remove(i);
        }
    }

    // ── socket groups: lazy init ──────────────────────────────────────────
    #[inline]
    fn lazy_group<'a>(g: &'a SocketGroup, loop_: &'static uws::Loop) -> &'a SocketGroup {
        if g.loop_.get().is_null() {
            g.init(loop_, None, core::ptr::null_mut());
        }
        g
    }

    pub fn spawn_ipc_group(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        Self::lazy_group(&self.spawn_ipc_group, loop_)
    }
    pub fn test_parallel_ipc_group(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        Self::lazy_group(&self.test_parallel_ipc_group, loop_)
    }

    // ── close_all_socket_groups ───────────────────────────────────────────
    /// Drain every embedded socket group. Runs in teardown's stop phase (script
    /// already forbidden) and must run BEFORE JSC teardown: native close paths
    /// release Strong handles and touch heap-owned state. RareData.deinit() runs
    /// after `WebWorker__teardownJSCVM`, so doing the closeAll there would touch
    /// freed JSC heap.
    pub(crate) fn close_all_socket_groups(
        vm: &VirtualMachine,
    ) -> crate::virtual_machine::SweepResult {
        // A native close path can cascade (closing one socket completes or
        // fails another, whose own close lands in a group already drained), so
        // loop until every group is observed empty in the same pass — bounded.
        // Walk the loop's linked-group list rather than just our 14 embedded
        // fields: Listener/uWS-App groups own their own SocketGroup, and accepted
        // sockets land *there*, not in RareData. Iterating only the embedded
        // fields missed those, leaking one 88-byte us_socket_t per still-open
        // accepted connection at process.exit() (the LSAN cluster on #29932
        // build 49245).
        let mut rounds: u8 = 0;
        while rounds < 8 {
            if !vm.uws_loop().close_all_groups() {
                break;
            }
            rounds += 1;
        }
        let result = if rounds > 0 {
            crate::virtual_machine::SweepResult::Stopped
        } else {
            crate::virtual_machine::SweepResult::Idle
        };
        // us_socket_close pushes to loop->data.closed_head; loop_post() normally
        // frees it on the next tick. We're past the last tick, so drain it now —
        // every us_socket_t is libc-allocated and otherwise becomes an LSAN leak
        // (the only pointer into it lives in mimalloc-backed RareData, which LSAN
        // can't trace once we unregister the root region).
        vm.uws_loop().drain_closed_sockets();
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// stderr / stdout / stdin
// ──────────────────────────────────────────────────────────────────────────

struct StdioStore {
    store: RefPtr<Store>,
    /// `st_mode` when the store was created.
    mode: Mode,
}

impl RareData {
    fn stdio(&self, stdio: Stdio) -> &StdioStore {
        use bun_analytics::features;
        let feature = match stdio {
            Stdio::StdIn => &features::bun_stdin,
            Stdio::StdOut => &features::bun_stdout,
            Stdio::StdErr => &features::bun_stderr,
        };
        feature.fetch_add(1, Ordering::Relaxed);
        self.stdio[stdio as usize].get_or_init(|| {
            let fd = Fd::from_uv(stdio as i32);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            let terminal = Output::OutputStreamDescriptor::Terminal;
            let is_atty = match stdio {
                // On Windows an invalid stdin handle must short-circuit to false.
                Stdio::StdIn => fd.unwrap_valid().map(syscall::isatty).unwrap_or(false),
                Stdio::StdOut => Output::stdout_descriptor_type() == terminal,
                Stdio::StdErr => Output::stderr_descriptor_type() == terminal,
            };
            let store = RefPtr::new(Store::new(
                Data::File(File {
                    pathlike: PathOrFileDescriptor::Fd(fd),
                    is_atty: Some(is_atty),
                    mode,
                    ..Default::default()
                }),
                bun_http_types::MimeType::NONE,
            ));
            StdioStore { store, mode }
        })
    }

    pub fn stdio_store(&self, stdio: Stdio) -> &RefPtr<Store> {
        &self.stdio(stdio).store
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StdinFdType / Bun__Process__getStdinFdType
// ──────────────────────────────────────────────────────────────────────────

#[repr(i32)]
enum StdinFdType {
    File = 0,
    Pipe = 1,
    Socket = 2,
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Process__getStdinFdType(vm: &VirtualMachine, fd: i32) -> StdinFdType {
    let stdio = Stdio::from_int(fd).expect("a stdio fd");
    let mode = vm.rare_data().stdio(stdio).mode;
    // `kind_from_mode` uses hard-coded u32 octal masks so it works on
    // Windows where libc::S_IFSOCK is undefined and on macOS where the libc
    // constants are u16.
    match bun_sys::kind_from_mode(mode) {
        bun_sys::FileKind::NamedPipe => StdinFdType::Pipe,
        bun_sys::FileKind::UnixDomainSocket => StdinFdType::Socket,
        _ => StdinFdType::File,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TLS default ciphers JS bindings
// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn set_tls_default_ciphers(heap: &JsHeap<'_>, ciphers: &[u8]) {
    // SAFETY: only the VM is taken from it.
    let global_this = unsafe { heap.global() };
    global_this
        .bun_vm()
        .rare_data()
        .set_tls_default_ciphers(ciphers);
}

pub(crate) fn get_tls_default_ciphers<'a>(heap: &JsHeap<'a>) -> &'a [u8] {
    // SAFETY: only the VM is taken from it.
    let global_this = unsafe { heap.global() };
    let rare = global_this.bun_vm().rare_data();
    match rare.tls_default_ciphers() {
        Some(c) => c,
        None => uws::get_default_ciphers().as_bytes(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for RareData {
    fn drop(&mut self) {
        // Paired with `VirtualMachine::init_rare_data`.
        bun_core::asan::unregister_root_region(
            core::ptr::from_ref(self).cast(),
            core::mem::size_of::<Self>(),
        );
        self.default_client_ssl_ctx.set(None);
        // After the default-ctx free so the tombstone callback still finds a live
        // map; ssl_ctx_cache itself lives in `RuntimeState` and is dropped there.
    }
}

impl RareData {
    /// Detach every embedded socket group from the thread's uSockets loop
    /// (asserting each is empty). A thread teardown calls this before it frees
    /// that loop.
    pub(crate) fn detach_socket_groups_from_loop(&self) {
        let ipc = [&self.spawn_ipc_group, &self.test_parallel_ipc_group];
        for group in self.socket_groups.each().into_iter().chain(ipc) {
            // SAFETY: closeAllSocketGroups() ran before JSC teardown, and the loop no longer ticks.
            unsafe { group.detach_from_loop() };
        }
    }
}
