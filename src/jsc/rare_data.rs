use core::cell::{Cell, OnceCell, UnsafeCell};
use core::ffi::c_void;
use core::pin::Pin;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::rc::Rc;
use std::sync::Arc;

use crate::JSGlobalObject;
use crate::bindgen::JsHeap;
use crate::strong::Optional as Strong;
use crate::virtual_machine::VirtualMachine;
use bun_boringssl::c as boring;
use bun_collections::StringArrayHashMap;
use bun_core::strings;
use bun_core::{Mutex, Output};
use bun_event_loop::MiniEventLoop::__bun_stdio_blob_store_new;
use bun_io::{self as Async};
use bun_libdeflate_sys::libdeflate;
use bun_paths::MAX_PATH_BYTES;
use bun_sys::{self as syscall, Fd, Mode};
use bun_uws::{self as uws, SocketGroup};

use crate::spawn_sync_event_loop::SpawnSyncEventLoop;

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
//   - `node_fs_stat_watcher_scheduler`
//     → erased `*mut c_void` slot; high tier lazy-inits.
//   - the `bun test --isolate` watcher/server registries → each owner embeds
//     a `bun_jsc::AbortHandle` armed in its `ScriptExecutionContext`.
//   - `stdin/stdout/stderr_store` → erased `*mut blob::Store` constructed via
//     `__bun_stdio_blob_store_new` (link-time extern).
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
    /// Borrowed only inside the methods below. Each makes one map call, which hashes bytes and
    /// moves `Copy` entries, so nothing it runs comes back here.
    map: UnsafeCell<StringArrayHashMap<HotMapEntry>>,
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
            map: UnsafeCell::new(StringArrayHashMap::new()),
        }
    }

    pub fn get_entry(&self, key: &[u8]) -> Option<HotMapEntry> {
        // SAFETY: see `map`.
        unsafe { &*self.map.get() }.get(key).copied()
    }

    pub fn insert_raw(&self, key: &[u8], entry: HotMapEntry) {
        // SAFETY: see `map`.
        let gop = bun_core::handle_oom(unsafe { &mut *self.map.get() }.get_or_put(key));
        if gop.found_existing {
            panic!("HotMap already contains key");
        }
        *gop.value_ptr = entry;
    }

    pub fn remove(&self, key: &[u8]) {
        // SAFETY: see `map`. No key is lent out, so `key` is not one of the map's own.
        unsafe { &mut *self.map.get() }.swap_remove(key);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// EntropyCache
// ──────────────────────────────────────────────────────────────────────────

pub struct EntropyCache {
    /// Borrowed only inside [`copy_to`](Self::copy_to).
    cache: UnsafeCell<[u8; Self::SIZE]>,
    index: Cell<usize>,
}
impl EntropyCache {
    const BUFFERED_UUIDS_COUNT: usize = 16;
    pub const SIZE: usize = Self::BUFFERED_UUIDS_COUNT * 128;

    /// Used up, so the first draw fills it.
    fn new() -> Box<Self> {
        Box::new(Self {
            cache: UnsafeCell::new([0u8; Self::SIZE]),
            index: Cell::new(Self::SIZE),
        })
    }

    #[inline]
    fn copy_to(&self, out: &mut [u8]) {
        let len = out.len();
        if len > Self::SIZE {
            return bun_boringssl::rand_bytes(out);
        }
        // SAFETY: the only borrow of `cache`; `rand_bytes` and the copy do not come back here.
        let cache = unsafe { &mut *self.cache.get() };
        let mut index = self.index.get();
        if index + len > Self::SIZE {
            bun_boringssl::rand_bytes(cache);
            index = 0;
        }
        out.copy_from_slice(&cache[index..index + len]);
        self.index.set(index + len);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CleanupHook
// ──────────────────────────────────────────────────────────────────────────

// Safe fn-pointer type: `ctx` is an opaque round-trip pointer the registrant
// supplied alongside `func`; the caller (`execute`) never dereferences it, only
// forwards it. Each implementor (e.g. N-API's `run_as_cleanup_hook`) owns the
// cast/deref locally, so invoking the pointer carries no caller-side precondition.
pub(crate) type CleanupHookFunction = extern "C" fn(*mut c_void);

#[derive(Clone, Copy)]
pub struct CleanupHook {
    pub ctx: *mut c_void,
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
    pub(crate) boring_ssl_engine: Cell<Option<*mut boring::ENGINE>>,

    /// Erased `*mut webcore::blob::Store` (intrusive-refcounted on the runtime
    /// side). Constructed via `__bun_stdio_blob_store_new`; high tier casts back.
    /// `mode` is cached so [`Bun__Process__getStdinFdType`] doesn't have to
    /// re-stat.
    stderr_store: Cell<Option<NonNull<c_void>>>,
    stderr_mode: Cell<Mode>,
    stdin_store: Cell<Option<NonNull<c_void>>>,
    stdin_mode: Cell<Mode>,
    stdout_store: Cell<Option<NonNull<c_void>>>,
    stdout_mode: Cell<Mode>,

    entropy_cache: OnceCell<Box<EntropyCache>>,

    pub(crate) hot_map: OnceCell<HotMap>,

    // TODO: make this per JSGlobalObject instead of global
    // This does not handle ShadowRealm correctly!
    pub(crate) cleanup_hooks: bun_collections::VecCell<CleanupHook>,
    /// Joins `cleanup_hooks` once `VirtualMachine::teardown` has everything back from other threads.
    pub(crate) cleanup_hooks_after_teardown_wait: bun_collections::VecCell<CleanupHook>,

    pub(crate) file_polls: OnceCell<Box<UnsafeCell<FilePollStore>>>,

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
    /// Null until built.
    default_client_ssl_ctx: Cell<*mut boring::SSL_CTX>,

    /// `bun_runtime::node::StatWatcherScheduler` — erased `RefPtr` payload;
    /// lazy-init in `bun_runtime::node::node_fs_stat_watcher`.
    node_fs_stat_watcher_scheduler: ErasedSlot,

    /// `bun_runtime::node::memory_pressure::MemoryPressureWatcher` — erased
    /// `Box`; lazy-init on the first `process.on("memoryPressure", ...)` listener.
    memory_pressure_watcher: ErasedSlot,

    pub pipe_read_scratch: Box<bun_event_loop::PipeReadScratch>,

    /// `node:http2` PADDED DATA scratch; see [`Self::take_h2_padded_frame_buffer`].
    h2_padded_frame_buffer: Cell<Option<Box<H2PaddedFrameBuffer>>>,
    /// Output scratch for one JS-thread `CompressionStream` step; see [`Self::take_compression_scratch`].
    compression_scratch: Cell<Option<Vec<u8>>>,
    /// Inflated payload of one `new WebSocket()` client message; see [`Self::take_websocket_inflate_scratch`].
    websocket_inflate_scratch: Cell<Option<Vec<u8>>>,
    /// One libdeflate handle for every JS-thread one-shot inflate; see [`Self::libdeflate_decompressor`].
    libdeflate_decompressor: OnceCell<libdeflate::OwnedDecompressor>,

    // There is intentionally no `aws_signature_cache` field — storage lives in
    // `bun_s3_signing::credentials::AWS_SIGNATURE_CACHE` (process static; it
    // was always reached via the main-thread VM, so it was a singleton in
    // practice). Hosting it in the consumer crate removes the upward
    // `s3_signing → jsc` hook.
    pub s3_default_client: Strong,
    /// Per-VM, like Node's quic `BindingData` (node/src/quic/bindingdata.h).
    pub node_quic_callbacks: Strong,
    pub(crate) default_csrf_secret: OnceCell<Box<[u8]>>,

    pub(crate) tls_default_ciphers: Cell<Option<Rc<[u8]>>>,

    // proxy_env_storage moved to VirtualMachine — see comment there on why
    // lazy RareData creation raced with worker spawn.
    spawn_sync_event_loop_: OnceCell<Pin<Box<SpawnSyncEventLoop>>>,

    pub path_buf: PathBuf,
}

pub(crate) type FilePollStore = Async::file_poll::Store;

/// Holds something only `bun_runtime` can name. Its readers there cast it back unchecked.
#[derive(Default)]
pub struct ErasedSlot(Cell<Option<NonNull<c_void>>>);

impl ErasedSlot {
    #[inline]
    pub fn get(&self) -> Option<NonNull<c_void>> {
        self.0.get()
    }

    #[inline]
    pub fn take(&self) -> Option<NonNull<c_void>> {
        self.0.take()
    }

    /// # Safety
    /// `value` is what the readers of this slot cast it back to, and stays so while it is here.
    #[inline]
    pub unsafe fn set(&self, value: NonNull<c_void>) {
        self.0.set(Some(value));
    }
}

impl Default for RareData {
    fn default() -> Self {
        Self {
            boring_ssl_engine: Cell::new(None),
            stderr_store: Cell::new(None),
            stderr_mode: Cell::new(0),
            stdin_store: Cell::new(None),
            stdin_mode: Cell::new(0),
            stdout_store: Cell::new(None),
            stdout_mode: Cell::new(0),
            entropy_cache: OnceCell::new(),
            hot_map: OnceCell::new(),
            cleanup_hooks: Default::default(),
            cleanup_hooks_after_teardown_wait: Default::default(),
            file_polls: OnceCell::new(),
            spawn_ipc_group: SocketGroup::default(),
            test_parallel_ipc_group: SocketGroup::default(),
            socket_groups: SocketGroups::default(),
            default_client_ssl_ctx: Cell::new(core::ptr::null_mut()),
            node_fs_stat_watcher_scheduler: ErasedSlot::default(),
            memory_pressure_watcher: ErasedSlot::default(),
            pipe_read_scratch: Box::new(bun_event_loop::PipeReadScratch::new()),
            h2_padded_frame_buffer: Cell::new(None),
            compression_scratch: Cell::new(None),
            websocket_inflate_scratch: Cell::new(None),
            libdeflate_decompressor: OnceCell::new(),
            s3_default_client: Strong::empty(),
            node_quic_callbacks: Strong::empty(),
            default_csrf_secret: OnceCell::new(),
            tls_default_ciphers: Cell::new(None),
            spawn_sync_event_loop_: OnceCell::new(),
            path_buf: PathBuf::default(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PathBuf
// ──────────────────────────────────────────────────────────────────────────

/// Reusable heap buffers for path.resolve, path.relative, and path.toNamespacedPath.
/// Three fixed-size tiers, lazily allocated on first use.
#[derive(Default)]
pub struct PathBuf {
    small: OnceCell<Box<PathBufTier<{ 2 * MAX_PATH_BYTES }>>>,
    medium: OnceCell<Box<PathBufTier<{ 8 * MAX_PATH_BYTES }>>>,
    large: OnceCell<Box<PathBufTier<{ 32 * MAX_PATH_BYTES }>>>,
}

#[repr(transparent)]
struct PathBufTier<const N: usize>(UnsafeCell<[u8; N]>);
// SAFETY: `repr(transparent)` down to bytes.
unsafe impl<const N: usize> bun_core::Zeroable for PathBufTier<N> {}

impl PathBuf {
    /// The smallest tier that fits `min_len`.
    ///
    /// # Safety
    /// No slice an earlier call returned is used after this call.
    // Revisit caller semantics for inputs exceeding the large tier.
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn get(&self, min_len: usize) -> &mut [u8] {
        fn tier<const N: usize>(slot: &OnceCell<Box<PathBufTier<N>>>) -> *mut [u8] {
            slot.get_or_init(bun_core::boxed_zeroed).0.get()
        }
        let tier = if min_len <= 2 * MAX_PATH_BYTES {
            tier(&self.small)
        } else if min_len <= 8 * MAX_PATH_BYTES {
            tier(&self.medium)
        } else {
            tier(&self.large)
        };
        // SAFETY: fn contract.
        unsafe { &mut *tier }
    }
}

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
    fn lazy<'a>(&'a self, g: &'a SocketGroup, loop_: &'static uws::Loop) -> &'a SocketGroup {
        if !g.is_initialized() {
            g.init(
                loop_,
                None,
                core::ptr::from_ref(self).cast_mut().cast::<c_void>(),
            );
        }
        g
    }

    /// One shared group per (context, ssl) for every `Bun.connect` / `tls.connect`
    /// client socket. Replaces the old per-connection `us_socket_context_t`
    /// allocation that was the root of the SSL_CTX-per-connect leak.
    pub fn bun_connect_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        self.lazy(
            if SSL {
                &self.bun_connect_group_tls
            } else {
                &self.bun_connect_group_tcp
            },
            loop_,
        )
    }
    pub fn postgres_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        self.lazy(
            if SSL {
                &self.postgres_tls_group
            } else {
                &self.postgres_group
            },
            loop_,
        )
    }
    pub fn mysql_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        self.lazy(
            if SSL {
                &self.mysql_tls_group
            } else {
                &self.mysql_group_
            },
            loop_,
        )
    }
    pub fn valkey_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        self.lazy(
            if SSL {
                &self.valkey_tls_group
            } else {
                &self.valkey_group_
            },
            loop_,
        )
    }
    pub fn ws_upgrade_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        self.lazy(
            if SSL {
                &self.ws_upgrade_tls_group
            } else {
                &self.ws_upgrade_group_
            },
            loop_,
        )
    }
    pub fn ws_client_group<const SSL: bool>(&self, loop_: &'static uws::Loop) -> &SocketGroup {
        self.lazy(
            if SSL {
                &self.ws_client_tls_group
            } else {
                &self.ws_client_group_
            },
            loop_,
        )
    }

    /// No socket is open, connecting or listening in any of these groups.
    pub(crate) fn is_empty(&self) -> bool {
        self.each().into_iter().all(SocketGroup::is_empty)
    }

    /// Close every socket in these groups (JS thread), for a context that has stopped: nothing
    /// connects for it any more, so one pass leaves them empty. Their close handlers run and
    /// reach this set again ([`of`](Self::of)).
    pub(crate) fn close_all(&self) {
        for group in self.each() {
            if group.is_initialized() {
                group.close_all();
            }
        }
    }

    /// Detach every group from the thread's uSockets loop (each is empty). Idempotent.
    fn detach_from_loop(&self) {
        for g in self.each() {
            detach_group_from_loop(g);
        }
    }
}

/// Detach an embedded, emptied group from its loop. Idempotent.
fn detach_group_from_loop(g: &SocketGroup) {
    // Groups whose lazy accessor was never called are still zero-initialised
    // (never `init`'d). The C `us_socket_group_deinit` happens to no-op on
    // those, but `SocketGroup::reset`'s safety contract requires a prior
    // `init`, so honour it explicitly.
    if g.is_initialized() {
        // SAFETY: embedded by-value group, previously `init`'d and emptied by
        // its owner, so this reduces to the empty-list debug asserts.
        unsafe { g.reset() };
    }
}

impl Drop for SocketGroups {
    fn drop(&mut self) {
        self.detach_from_loop();
    }
}

impl RareData {
    pub(crate) fn release_js_handles(&self) {
        self.s3_default_client.deinit();
        self.node_quic_callbacks.deinit();
    }

    // ── trivial field accessors ────────────────────────────────────────────

    /// Raw slot — lazy-init body lives in `bun_runtime::node::node_fs_stat_watcher`
    /// (`StatWatcherScheduler::init` is higher-tier).
    #[inline]
    pub fn node_fs_stat_watcher_scheduler_slot(&self) -> &ErasedSlot {
        &self.node_fs_stat_watcher_scheduler
    }

    /// Raw slot — lazy-init body lives in `bun_runtime::node::memory_pressure`.
    #[inline]
    pub fn memory_pressure_watcher_slot(&self) -> &ErasedSlot {
        &self.memory_pressure_watcher
    }

    // ── lazy-init: hot_map ─────────────────────────────────────────────────
    pub(crate) fn hot_map(&self) -> &HotMap {
        self.hot_map.get_or_init(HotMap::init)
    }

    /// `bun_io` changes the store through this pointer.
    pub fn file_polls(&self) -> *mut FilePollStore {
        self.file_polls
            .get_or_init(|| Box::new(UnsafeCell::new(FilePollStore::init())))
            .get()
    }

    // ── lazy-init: entropy ─────────────────────────────────────────────────

    /// Random bytes, out of the cache unless `out` is longer than [`EntropyCache::SIZE`].
    #[inline]
    pub fn fill_entropy(&self, out: &mut [u8]) {
        self.entropy_cache
            .get_or_init(EntropyCache::new)
            .copy_to(out);
    }
    #[inline]
    pub fn entropy<const N: usize>(&self) -> [u8; N] {
        let mut bytes = [0u8; N];
        self.fill_entropy(&mut bytes);
        bytes
    }
    pub fn next_uuid(&self) -> UUID {
        UUID::init_with(&self.entropy::<16>())
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
        let slot = &self.h2_padded_frame_buffer;
        slot.set(Some(slot.take().unwrap_or(buffer)));
    }

    /// The slot keeps the first buffer returned and lets an oversized one go.
    fn put_back_scratch(slot: &Cell<Option<Vec<u8>>>, mut buffer: Vec<u8>) {
        const KEEP: usize = 256 * 1024;
        match slot.take() {
            Some(first) => slot.set(Some(first)),
            None if buffer.capacity() <= KEEP => {
                buffer.clear();
                slot.set(Some(buffer));
            }
            None => {}
        }
    }

    /// Empty `Vec` with whatever capacity the last step left behind.
    pub fn take_compression_scratch(&self) -> Vec<u8> {
        self.compression_scratch.take().unwrap_or_default()
    }

    /// Hand a taken buffer back; the slot keeps the first one returned and lets an oversized one go.
    pub fn put_back_compression_scratch(&self, buffer: Vec<u8>) {
        Self::put_back_scratch(&self.compression_scratch, buffer);
    }

    /// Empty `Vec` with whatever capacity the last WebSocket client inflate left behind. By value,
    /// like [`Self::take_h2_padded_frame_buffer`]: delivering the payload runs JS, which can reach
    /// this path again before the buffer comes back.
    pub fn take_websocket_inflate_scratch(&self) -> Vec<u8> {
        self.websocket_inflate_scratch.take().unwrap_or_default()
    }

    /// Hand a taken buffer back; the slot keeps the first one returned and lets an oversized one go.
    pub fn put_back_websocket_inflate_scratch(&self, buffer: Vec<u8>) {
        Self::put_back_scratch(&self.websocket_inflate_scratch, buffer);
    }

    /// libdeflate keeps no state between calls, so one handle serves every one-shot inflate on
    /// this thread. `None` when libdeflate cannot allocate it; callers fall back to zlib.
    pub fn libdeflate_decompressor(&self) -> Option<&libdeflate::Decompressor> {
        if self.libdeflate_decompressor.get().is_none() {
            let _ = self
                .libdeflate_decompressor
                .set(libdeflate::OwnedDecompressor::new()?);
        }
        self.libdeflate_decompressor.get().map(|d| &**d)
    }

    pub fn boring_engine(&self) -> *mut boring::ENGINE {
        // The raw `ENGINE_new()` result is cached without a null check:
        // `EVP_DigestInit_ex` tolerates a NULL engine, so OOM here degrades to
        // "no engine" rather than crashing. Debug-assert to surface it without
        // altering release behavior.
        let ptr = self.boring_ssl_engine.get().unwrap_or_else(|| {
            let engine = boring::ENGINE_new();
            self.boring_ssl_engine.set(Some(engine));
            engine
        });
        debug_assert!(!ptr.is_null(), "ENGINE_new returned null");
        ptr
    }

    pub fn default_csrf_secret(&self) -> &[u8] {
        self.default_csrf_secret.get_or_init(|| {
            let mut secret = vec![0u8; 16].into_boxed_slice();
            bun_boringssl::rand_bytes(&mut secret);
            secret
        })
    }

    /// Null until [`set_default_client_ssl_ctx`](Self::set_default_client_ssl_ctx). The
    /// reference stays here.
    #[inline]
    pub fn default_client_ssl_ctx(&self) -> *mut boring::SSL_CTX {
        self.default_client_ssl_ctx.get()
    }

    pub fn set_default_client_ssl_ctx(&self, ctx: Option<boring::OwnedSslCtx>) {
        let previous = self
            .default_client_ssl_ctx
            .replace(ctx.map_or(core::ptr::null_mut(), boring::OwnedSslCtx::into_raw));
        // SAFETY: null, or the reference the `into_raw` of an earlier call left here.
        drop(unsafe { boring::OwnedSslCtx::from_raw(previous) });
    }

    #[inline]
    pub(crate) fn has_tls_default_ciphers(&self) -> bool {
        // SAFETY: the borrow ends with the read of the tag.
        unsafe { &*self.tls_default_ciphers.as_ptr() }.is_some()
    }

    pub(crate) fn tls_default_ciphers(&self) -> Option<Rc<[u8]>> {
        // SAFETY: the borrow ends with `Rc::clone`, which only counts.
        unsafe { &*self.tls_default_ciphers.as_ptr() }.clone()
    }

    pub(crate) fn set_tls_default_ciphers(&self, ciphers: &[u8]) {
        self.tls_default_ciphers.set(Some(Rc::from(ciphers)));
        // Built from the previous list. Open connections hold their own reference.
        self.set_default_client_ssl_ctx(None);
    }

    pub fn push_cleanup_hook(
        &self,
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) {
        self.cleanup_hooks
            .push(CleanupHook::from(global_this, ctx, func));
    }

    pub fn push_cleanup_hook_after_teardown_wait(
        &self,
        global_this: &JSGlobalObject,
        ctx: *mut c_void,
        func: CleanupHookFunction,
    ) {
        self.cleanup_hooks_after_teardown_wait
            .push(CleanupHook::from(global_this, ctx, func));
    }

    /// The loop a first `spawn_sync_event_loop` call made.
    pub fn existing_spawn_sync_event_loop(&self) -> Option<&SpawnSyncEventLoop> {
        self.spawn_sync_event_loop_.get().map(|l| &**l)
    }

    /// `None` if the loop cannot be created; nothing is cached, so a later call retries.
    pub fn spawn_sync_event_loop(&self) -> Option<&SpawnSyncEventLoop> {
        if self.spawn_sync_event_loop_.get().is_none() {
            let _ = self.spawn_sync_event_loop_.set(SpawnSyncEventLoop::new()?);
        }
        self.existing_spawn_sync_event_loop()
    }

    // ── socket groups: lazy init ──────────────────────────────────────────
    #[inline]
    fn lazy_group<'a>(g: &'a SocketGroup, loop_: &'static uws::Loop) -> &'a SocketGroup {
        if !g.is_initialized() {
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
        &self,
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
        let _ = self;
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
//
// Low tier owns the fstat + lazy-init flow; the actual `webcore::blob::Store`
// allocation goes through `__bun_stdio_blob_store_new` (link-time extern
// defined in `bun_runtime::webcore::blob`).
// ──────────────────────────────────────────────────────────────────────────

unsafe extern "Rust" {
    safe fn __bun_stdio_blob_store_deinit(ptr: *mut ());
}

impl RareData {
    #[inline]
    fn stdio_ctor(fd: Fd, is_atty: bool, mode: Mode) -> *mut c_void {
        // `__bun_stdio_blob_store_new` is declared `safe fn` in
        // `bun_event_loop::MiniEventLoop` (all args by-value; allocates a
        // fresh `Store` with no caller-side precondition).
        __bun_stdio_blob_store_new(fd, is_atty, mode).cast()
    }

    /// What [`stderr`](Self::stderr) made, if it was called.
    #[inline]
    pub fn stderr_store(&self) -> Option<NonNull<c_void>> {
        self.stderr_store.get()
    }

    /// What [`stdout`](Self::stdout) made, if it was called.
    #[inline]
    pub fn stdout_store(&self) -> Option<NonNull<c_void>> {
        self.stdout_store.get()
    }

    /// What [`stdin`](Self::stdin) made, if it was called.
    #[inline]
    pub fn stdin_store(&self) -> Option<NonNull<c_void>> {
        self.stdin_store.get()
    }

    /// Returns an erased `*mut webcore::blob::Store`. High-tier callers cast back.
    pub fn stderr(&self) -> *mut c_void {
        bun_analytics::features::bun_stderr.fetch_add(1, Ordering::Relaxed);
        if self.stderr_store.get().is_none() {
            let fd = Fd::from_uv(2);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            let is_atty =
                Output::stderr_descriptor_type() == Output::OutputStreamDescriptor::Terminal;
            let store = Self::stdio_ctor(fd, is_atty, mode);
            self.stderr_store.set(NonNull::new(store));
            self.stderr_mode.set(mode);
        }
        self.stderr_store
            .get()
            .map_or(core::ptr::null_mut(), NonNull::as_ptr)
    }

    /// Returns an erased `*mut webcore::blob::Store`. High-tier callers cast back.
    pub fn stdout(&self) -> *mut c_void {
        bun_analytics::features::bun_stdout.fetch_add(1, Ordering::Relaxed);
        if self.stdout_store.get().is_none() {
            let fd = Fd::from_uv(1);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            let is_atty =
                Output::stdout_descriptor_type() == Output::OutputStreamDescriptor::Terminal;
            let store = Self::stdio_ctor(fd, is_atty, mode);
            self.stdout_store.set(NonNull::new(store));
            self.stdout_mode.set(mode);
        }
        self.stdout_store
            .get()
            .map_or(core::ptr::null_mut(), NonNull::as_ptr)
    }

    /// Returns an erased `*mut webcore::blob::Store`. High-tier callers cast back.
    pub fn stdin(&self) -> *mut c_void {
        bun_analytics::features::bun_stdin.fetch_add(1, Ordering::Relaxed);
        if self.stdin_store.get().is_none() {
            let fd = Fd::from_uv(0);
            let mode: Mode = match syscall::fstat(fd) {
                Ok(stat) => stat.st_mode as Mode,
                Err(_) => 0,
            };
            // On Windows an invalid stdin handle must short-circuit to false.
            let is_atty = fd.unwrap_valid().map(syscall::isatty).unwrap_or(false);
            let store = Self::stdio_ctor(fd, is_atty, mode);
            self.stdin_store.set(NonNull::new(store));
            self.stdin_mode.set(mode);
        }
        self.stdin_store
            .get()
            .map_or(core::ptr::null_mut(), NonNull::as_ptr)
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
    let rare = vm.rare_data();
    // The store is type-erased here, so `stderr/stdout/stdin()` cache `mode`
    // alongside the pointer.
    let mode = match fd {
        0 => {
            rare.stdin();
            rare.stdin_mode.get()
        }
        1 => {
            rare.stdout();
            rare.stdout_mode.get()
        }
        2 => {
            rare.stderr();
            rare.stderr_mode.get()
        }
        _ => unreachable!(),
    };
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

pub(crate) fn get_tls_default_ciphers<'a>(
    heap: &JsHeap<'a>,
) -> crate::bindgen::Result<'a, crate::bindgen::JsLocal<'a, crate::JSString>> {
    // SAFETY: only the VM is taken from it.
    let global_this = unsafe { heap.global() };
    match global_this.bun_vm().rare_data().tls_default_ciphers() {
        Some(ciphers) => heap.create_utf8_string(&ciphers),
        None => heap.create_utf8_string(uws::get_default_ciphers().as_bytes()),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for RareData {
    fn drop(&mut self) {
        // pipe_read_scratch / h2_padded_frame_buffer / spawn_sync_event_loop_ /
        // s3_default_client / default_csrf_secret / cleanup_hooks / path_buf /
        // tls_default_ciphers:
        // all dropped automatically via field Drop.

        if let Some(engine) = self.boring_ssl_engine.take() {
            // SAFETY: engine was created by ENGINE_new.
            unsafe { boring::ENGINE_free(engine) };
        }

        self.set_default_client_ssl_ctx(None);
        // After the default-ctx free so the tombstone callback still finds a live
        // map; ssl_ctx_cache itself lives in `RuntimeState` and is dropped there.

        for store in [
            self.stderr_store.take(),
            self.stdout_store.take(),
            self.stdin_store.take(),
        ]
        .into_iter()
        .flatten()
        {
            __bun_stdio_blob_store_deinit(store.as_ptr().cast());
        }

        self.detach_socket_groups_from_loop();
    }
}

impl RareData {
    /// Detach every embedded socket group from the thread's uSockets loop
    /// (asserting each is empty). A thread teardown calls this before it frees
    /// that loop; `Drop` calls it for every other owner. Idempotent.
    pub(crate) fn detach_socket_groups_from_loop(&self) {
        // closeAllSocketGroups() must have already run (before JSC teardown) so
        // these are empty; deinit() asserts that in debug.
        self.socket_groups.detach_from_loop();
        detach_group_from_loop(&self.spawn_ipc_group);
        detach_group_from_loop(&self.test_parallel_ipc_group);
    }
}
