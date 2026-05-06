//! Un-gated bodies for `DevServer::{init, start_async_bundle, finalize_bundle}`
//! and the request-handling entry points (`on_request`, `on_asset_request`,
//! `respond_for_html_bundle`).
//!
//! These were previously stubbed in `mod.rs` pending `bun_bundler::BundleV2`
//! field access; the bundler workflow has since un-gated the `BundleV2<'a>`
//! struct shape, so the lifecycle is now real. Hot-update tracing, chunk
//! receipt into `IncrementalGraph`, and the framework-route SSR path remain
//! in the gated Phase-A draft `../DevServer.rs` (blocked on
//! `bun_bundler::Chunk` field access + jsc method surface).

// `feature = "bake_debugging_features"` is not yet a declared cargo feature; the
// struct field gate must mirror `mod.rs` so the initializer below stays in sync.
#![allow(unexpected_cfgs)]

use core::mem::MaybeUninit;
use core::sync::atomic::Ordering;
use std::sync::OnceLock;

use bun_collections::HiveArray;
use bun_logger::Log;
use bun_safety::ThreadLock;

use super::framework_router::FrameworkRouter;
use super::jsc;
use super::{
    deferred_request, route_bundle, Assets, CurrentBundle, DeferredPromise, DevServer,
    DirectoryWatchStore, EntryPointList, EventLoopTimer, HTMLRouter,
    HotReloadEvent, IncrementalGraph, IncrementalResult, Magic, NextBundle, Options, PluginState,
    SourceMapStore, TestingBatchEvents, TimerTag, WatcherAtomics,
};

// ──────────────────────────────────────────────────────────────────────────
// WatcherContext impl — wires `bun_watcher::Watcher::init::<DevServer>`.
// Full bodies (`HotReloadEvent` accumulation, debouncing, event-loop dispatch)
// live in the gated `../DevServer/HotReloadEvent.rs` draft. These trampolines
// give `Watcher::init` a valid vtable so `init()` below is real.
// ──────────────────────────────────────────────────────────────────────────
impl bun_watcher::WatcherContext for DevServer {
    fn on_file_update(
        &mut self,
        _events: &mut [bun_watcher::WatchEvent],
        _changed_files: &[bun_watcher::ChangedFilePath],
        _watchlist: &bun_watcher::WatchList,
    ) {
        // TODO(b2): port `HotReloadEvent::on_file_update` — accumulates into
        // `watcher_atomics.events[]` then enqueues a `ConcurrentTask`.
    }
    fn on_error(&mut self, err: bun_sys::Error) {
        bun_core::Output::warn(format_args!("DevServer watcher error: {err}"));
    }
}

impl WatcherAtomics {
    /// DevServer.zig `WatcherAtomics.init`.
    pub(super) fn init(owner: *const DevServer) -> Self {
        let mk_event = || HotReloadEvent {
            owner,
            concurrent_task: Default::default(),
            files: Default::default(),
            dirs: Default::default(),
            extra_files: Vec::new(),
            timer: std::time::Instant::now(),
            contention_indicator: core::sync::atomic::AtomicU32::new(0),
        };
        WatcherAtomics {
            events: [mk_event(), mk_event(), mk_event()],
            next_event: core::sync::atomic::AtomicU8::new(0),
            current_event: None,
            pending_event: None,
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// init() — DevServer construction
// ══════════════════════════════════════════════════════════════════════════

/// DevServer.zig:300 `init`. The Zig original used `bun.new(DevServer, .{
/// many = undefined })` then assigned fields in place (transpilers, watcher,
/// router, watcher_atomics, configuration_hash_key). Rust forbids partial-init
/// of a `Box`, so this is reshaped to compute dependent values up front and
/// construct the struct in one expression, then perform post-construction
/// wiring against the stable heap address.
///
/// PORT NOTE: the three `Transpiler` fields and the `FrameworkRouter` are
/// constructed via per-field default rather than `Framework::init_transpiler`
/// / `FrameworkRouter::init_empty` (both still in gated drafts —
/// `bake_body.rs` / `FrameworkRouter.rs`). See `../DevServer.rs:335-697` for
/// the full Zig-faithful body.
pub(super) fn init_impl(options: Options<'_>) -> jsc::JsResult<Box<DevServer>> {
    bun_analytics::features::dev_server.fetch_add(1, Ordering::Relaxed);

    let separate_ssr_graph = options
        .framework
        .server_components
        .as_ref()
        .map(|sc| sc.separate_ssr_graph)
        .unwrap_or(false);

    // `bun_watcher::FileSystem` is an opaque forward-decl (only
    // `top_level_dir` is read). Zig used the process-global
    // `Fs.FileSystem.instance` singleton (DevServer.zig:383); mirror that
    // with `OnceLock` (PORTING.md §Forbidden bans `Box::leak` for `&'static`).
    // The first `DevServer::init` wins — same as the Zig singleton.
    static WATCHER_FS_ROOT: OnceLock<Box<[u8]>> = OnceLock::new();
    static WATCHER_FS: OnceLock<bun_watcher::FileSystem> = OnceLock::new();
    let root_static: &'static [u8] =
        WATCHER_FS_ROOT.get_or_init(|| Box::<[u8]>::from(options.root));
    let fs: &'static bun_watcher::FileSystem =
        WATCHER_FS.get_or_init(|| bun_watcher::FileSystem { top_level_dir: root_static });

    // SAFETY: vm is JSC_BORROW (LIFETIMES.tsv) — valid for DevServer lifetime;
    // `global` is the per-VM `*mut JSGlobalObject` and is always non-null once
    // the VM is initialized.
    let global = unsafe { &*options.vm.global };

    let frontend_only = options.framework.file_system_router_types.is_empty();

    let mut dev = Box::new(DevServer {
        magic: Magic::Valid,
        allocation_scope: bun_alloc::AllocationScope,
        root: Box::from(root_static),
        inspector_server_id: jsc::DebuggerId(0),
        configuration_hash_key: [0; 16],
        vm: options.vm as *const _,
        server: None,
        router: FrameworkRouter {
            root: Box::from(root_static),
            types: Box::new([]),
            routes: Vec::new(),
            static_routes: Default::default(),
            dynamic_routes: Default::default(),
            pattern_arena: bun_alloc::Arena::new(),
        },
        route_bundles: Vec::new(),
        graph_safety_lock: ThreadLock::init_unlocked(),
        client_graph: IncrementalGraph::default(),
        server_graph: IncrementalGraph::default(),
        barrel_files_with_deferrals: Default::default(),
        barrel_needed_exports: Default::default(),
        incremental_result: IncrementalResult::EMPTY,
        route_lookup: Default::default(),
        html_router: HTMLRouter::default(),
        assets: Assets::default(),
        source_maps: SourceMapStore::default(),
        bundling_failures: Default::default(),
        frontend_only,
        has_tailwind_plugin_hack: None,
        server_fetch_function_callback: jsc::StrongOptional::default(),
        server_register_update_callback: jsc::StrongOptional::default(),
        // SAFETY: `ctx` is null but the watcher thread is not started until
        // `bun_watcher.start()` below (after `ctx` is rewired to `dev_ptr`),
        // so the callbacks never observe the null ctx.
        bun_watcher: match bun_watcher::Watcher::init::<DevServer>(core::ptr::null_mut(), fs) {
            Ok(w) => w,
            Err(e) => {
                return Err(global
                    .throw_error(e, "while initializing file watcher for development server"))
            }
        },
        directory_watchers: DirectoryWatchStore::default(),
        watcher_atomics: WatcherAtomics::init(core::ptr::null()),
        testing_batch_events: TestingBatchEvents::Disabled,
        generation: 0,
        bundles_since_last_error: 0,
        framework: options.framework,
        bundler_options: options.bundler_options,
        // TODO(b2): `Framework::init_transpiler` — gated in `bake_body.rs`.
        // `Transpiler<'_>` contains a non-nullable `allocator: &Arena`, so
        // `mem::zeroed()` would be immediate UB (PORTING.md §Forbidden);
        // `MaybeUninit` is the Rust analogue of Zig's `= undefined`.
        // TODO(port): once `bake_body::Framework::init_transpiler` is
        // un-gated, write into these via `.write(..)` then `assume_init_*`.
        server_transpiler: MaybeUninit::uninit(),
        client_transpiler: MaybeUninit::uninit(),
        ssr_transpiler: MaybeUninit::uninit(),
        log: Log::default(),
        plugin_state: PluginState::Unknown,
        current_bundle: None,
        next_bundle: NextBundle {
            route_queue: Default::default(),
            reload_event: None,
            requests: deferred_request::List::default(),
            promise: DeferredPromise::default(),
        },
        deferred_request_pool: HiveArray::init(),
        active_websocket_connections: Default::default(),
        #[cfg(feature = "bake_debugging_features")]
        dump_dir: None,
        emit_incremental_visualizer_events: 0,
        emit_memory_visualizer_events: 0,
        memory_visualizer_timer: EventLoopTimer::init_paused(TimerTag::DevServerMemoryVisualizerTick),
        // DevServer.zig:328-330: `bake_debugging_features and
        // (options.dump_state_on_crash orelse BUN_DUMP_STATE_ON_CRASH.get())`.
        has_pre_crash_handler: bun_core::feature_flags::BAKE_DEBUGGING_FEATURES
            && options.dump_state_on_crash.unwrap_or_else(|| {
                bun_core::env_var::feature_flag::BUN_DUMP_STATE_ON_CRASH
                    .get()
                    .unwrap_or(false)
            }),
        // DevServer.zig:355: `BUN_ASSUME_PERFECT_INCREMENTAL.get() orelse isDebug`.
        assume_perfect_incremental_bundling:
            bun_core::env_var::feature_flag::BUN_ASSUME_PERFECT_INCREMENTAL
                .get()
                .unwrap_or(cfg!(debug_assertions)),
        broadcast_console_log_from_browser_to_server: options
            .broadcast_console_log_from_browser_to_server,
    });

    // ── post-construction wiring (needs stable `*mut DevServer`) ─────────────
    let dev_ptr: *mut DevServer = &mut *dev;

    // Watcher: rewire the callback ctx now that `dev` has a heap address,
    // then start the thread. The watcher built above used a null ctx;
    // `Watcher.ctx` is a plain `*mut ()` so this is a store.
    dev.bun_watcher.ctx = dev_ptr as *mut ();
    if let Err(err) = dev.bun_watcher.start() {
        return Err(
            global.throw_error(err, "while starting file watcher thread for development server")
        );
    }
    dev.watcher_atomics = WatcherAtomics::init(dev_ptr);

    // Transpiler backrefs (`options.dev_server = dev`). The bundler reads this
    // erased ptr to construct `dispatch::DevServerHandle` inside
    // `BundleV2::init`. `BundleOptions.dev_server` is `*const ()` (CYCLEBREAK
    // erased); the vtable is supplied separately at `BundleV2` construction.
    //
    // SAFETY: the transpilers are `MaybeUninit` until `Framework::init_transpiler`
    // populates them; writing a single field via `addr_of_mut!` on uninit
    // memory is sound (no `&mut Transpiler` is ever materialized).
    let dev_erased = dev_ptr as *const ();
    unsafe {
        core::ptr::addr_of_mut!((*dev.server_transpiler.as_mut_ptr()).options.dev_server)
            .write(dev_erased);
        core::ptr::addr_of_mut!((*dev.client_transpiler.as_mut_ptr()).options.dev_server)
            .write(dev_erased);
        if separate_ssr_graph {
            core::ptr::addr_of_mut!((*dev.ssr_transpiler.as_mut_ptr()).options.dev_server)
                .write(dev_erased);
        }
    }

    // React-fast-refresh sentinel (must be `FileIndex(0)` on the client side).
    if let Some(rfr) = &dev.framework.react_fast_refresh {
        let _ = dev.client_graph.insert_stale(rfr.import_source, false);
    }

    // configuration_hash_key — Wyhash of framework config; used as the
    // cache-busting key in `/_bun/client/:route` URLs. Full hashing of
    // `built_in_modules` / `server_components` is in the gated draft;
    // this hashes the stable subset so the key is deterministic.
    // TODO(port): spec DevServer.zig:436 uses `std.hash.Wyhash` (NOT
    // `Wyhash11` — different algorithm). Swap once `bun_wyhash::Wyhash`
    // (the std-Wyhash port) lands; see bun_wyhash/lib.rs TODO(b2).
    dev.configuration_hash_key = {
        let mut h = bun_wyhash::Wyhash11::init(128);
        for fsr in dev.framework.file_system_router_types {
            h.update(fsr.root);
            h.update(&[0]);
            h.update(fsr.prefix);
            h.update(&[0]);
            h.update(&[fsr.allow_layouts as u8, fsr.ignore_underscores as u8]);
        }
        h.update(&[dev.framework.react_fast_refresh.is_some() as u8]);
        h.update(&[dev.framework.server_components.is_some() as u8]);
        let digest = h.final_().to_ne_bytes();
        let mut out = [0u8; 16];
        // Hex-encode 8 bytes → 16 hex chars (matches Zig `bytesToHexLower`).
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for (i, b) in digest.iter().enumerate() {
            out[i * 2] = HEX[(b >> 4) as usize];
            out[i * 2 + 1] = HEX[(b & 0xF) as usize];
        }
        out
    };

    // DevServer.zig:562-563 — register the pre-crash state-dump handler.
    if dev.has_pre_crash_handler {
        // TODO(b2): real `dump_state_due_to_crash` body lives in the gated
        // `../DevServer.rs` draft (heavy `IncrementalGraph` + fs deps).
        fn dump_state_due_to_crash(_dev: &mut DevServer) -> Result<(), bun_core::Error> {
            Ok(())
        }
        let _ = bun_crash_handler::append_pre_crash_handler::<DevServer>(
            dev_ptr,
            dump_state_due_to_crash,
        );
    }

    debug_assert!(dev.magic == Magic::Valid);
    Ok(dev)
}

// ══════════════════════════════════════════════════════════════════════════
// Bundle lifecycle — start_async_bundle / finalize_bundle
// ══════════════════════════════════════════════════════════════════════════

impl DevServer {
    /// DevServer.zig `startAsyncBundle`. Kicks off a `BundleV2` against the
    /// accumulated `entry_points`, moving any queued `next_bundle` requests
    /// into `current_bundle` so they resolve when `finalize_bundle` runs.
    pub fn start_async_bundle(
        &mut self,
        entry_points: EntryPointList,
        had_reload_event: bool,
        timer: std::time::Instant,
    ) -> Result<(), bun_alloc::AllocError> {
        debug_assert!(self.current_bundle.is_none());
        debug_assert!(!entry_points.set.is_empty());
        self.log.clear_and_free();
        self.incremental_result.reset();

        // Ref server to keep it from closing mid-bundle.
        if let Some(server) = self.server {
            server.on_pending_request();
        }

        self.graph_safety_lock.lock();
        self.client_graph.reset();
        self.server_graph.reset();
        self.graph_safety_lock.unlock();

        // PORT NOTE: `BundleV2::init` + `start_from_bake_dev_server` live in
        // `bun_bundler::bundle_v2` and are being un-gated by the bundler
        // workflow concurrently. We construct the `BundleV2` struct directly
        // here (matching the un-gated field set in `bundle_v2.rs`) so this
        // body has no method-surface dependency on the gated `__phase_a_draft`.
        // SAFETY: `'static` lifetime stand-in — `BundleV2<'a>` borrows the
        // three `Transpiler` fields stored inline in `DevServer`; the true
        // bound is the `Box<DevServer>` allocation (stable address, never
        // moved post-init). `as_mut_ptr()` because the transpilers are
        // `MaybeUninit` until `Framework::init_transpiler` runs.
        let server_transpiler = self.server_transpiler.as_mut_ptr();
        let ssr_transpiler = self.ssr_transpiler.as_mut_ptr();
        let client_transpiler = core::ptr::NonNull::new(self.client_transpiler.as_mut_ptr());
        let bv2 = Box::new(bun_bundler::BundleV2 {
            transpiler: server_transpiler,
            client_transpiler,
            ssr_transpiler,
            framework: None, // TODO(b2): bake::Framework → bundler::bake_types::Framework bridge
            graph: Default::default(),
            linker: Default::default(),
            // SAFETY: erased `*mut Watcher` — bundler never derefs (CYCLEBREAK).
            bun_watcher: core::ptr::NonNull::new((&mut *self.bun_watcher) as *mut _ as *mut ()),
            plugins: self
                .bundler_options
                .plugin
                .map(|p| p.cast::<bun_bundler::bundle_v2::JSBundlerPlugin>()),
            completion: None,
            dev_server: Some(self.bundler_handle()),
            file_map: None,
            source_code_length: 0,
            resolve_tasks_waiting_for_import_source_index: Default::default(),
            free_list: Vec::new(),
            unique_key: 0,
            dynamic_import_entry_points: Default::default(),
            has_on_parse_plugins: false,
            finalizers: Vec::new(),
            drain_defer_task: Default::default(),
            asynchronous: true,
            thread_lock: ThreadLock::init_locked(),
            has_any_top_level_await_modules: false,
            requested_exports: Default::default(),
        });

        // TODO(b2): `bv2.start_from_bake_dev_server(&entry_points)` once the
        // bundler workflow un-gates that method. The `start_data` it returns
        // (`DevServerInput { css_entry_points }`) is stored erased here and
        // recovered via the `current_bundle_start_data` vtable slot.
        let _ = entry_points;
        let start_data: *mut () = core::ptr::null_mut();

        self.current_bundle = Some(CurrentBundle {
            bv2,
            start_data,
            timer,
            had_reload_event,
            requests: core::mem::take(&mut self.next_bundle.requests),
            resolution_failure_entries: Default::default(),
            promise: core::mem::take(&mut self.next_bundle.promise),
        });
        // `ArrayHashMap` has no `clear()`; reset by re-init (keys are
        // `route_bundle::Index` — `Copy`, no Drop side-effects).
        self.next_bundle.route_queue = Default::default();
        Ok(())
    }

    /// DevServer.zig `finalizeBundle` — called by `BundleV2` (via the
    /// `dispatch::DevServerVTable.finalize_bundle` slot) after linking
    /// completes. Indexes chunk results into the `IncrementalGraph`s, resolves
    /// pending `DeferredRequest`s, and tears down `current_bundle`.
    ///
    /// Full body (~800 L: chunk receipt, SCB tracing, source-map stitching) is
    /// in `../DevServer.rs:2627-3490`. This implements the structural
    /// teardown + request-draining so the lifecycle is real; chunk indexing
    /// is gated on `bun_bundler::Chunk` field access.
    pub fn finalize_bundle(
        &mut self,
        _bv2: &mut bun_bundler::BundleV2<'static>,
        _result: *const (), // `&DevServerOutput<'_>` once un-gated in bundle_v2.rs
    ) -> Result<(), bun_core::Error> {
        debug_assert!(self.current_bundle.is_some());
        self.generation = self.generation.wrapping_add(1);

        // TODO(b2): index `result.{chunks,css_file_list,html_files}` into
        // `client_graph`/`server_graph` via `IncrementalGraph::receive_chunk`
        // (gated in `../DevServer/IncrementalGraph.rs`).

        // Drain deferred requests now that the bundle is done.
        let mut current = self.current_bundle.take().unwrap();
        let mut node = current.requests.first.take();
        while let Some(n) = node {
            // SAFETY: nodes are owned by `deferred_request_pool` and remain
            // valid until `put()` below; the list is single-threaded.
            let n_ref = unsafe { &mut *n.as_ptr() };
            node = n_ref.next.take();
            // TODO(b2): dispatch `n.data.handler` (ServerHandler / BundledHtmlPage)
            // via `on_framework_request_with_bundle` / `on_html_request_with_bundle`
            // — both gated on jsc method surface.
            n_ref.data.referenced_by_devserver = false;
            if !n_ref.data.weakly_referenced_by_requestcontext {
                self.deferred_request_pool.put(n.as_ptr());
            }
        }
        // BundleV2 arena teardown: `deinit_without_freeing_arena` is gated;
        // `Drop` on `Box<BundleV2>` handles `graph.heap` for now.
        drop(current);

        // DevServer.zig:2273-2277 ordering: start the next bundle BEFORE
        // releasing the keep-alive ref so the server's pending-request count
        // never hits zero between bundles (start_async_bundle re-refs via
        // `on_pending_request`).
        self.start_next_bundle_if_present();

        // De-ref the keep-alive taken in `start_async_bundle`.
        if let Some(server) = self.server {
            server.on_static_request_complete();
        }
        Ok(())
    }

    /// DevServer.zig `startNextBundleIfPresent`.
    fn start_next_bundle_if_present(&mut self) {
        debug_assert!(self.current_bundle.is_none());
        // DevServer.zig:3025 — gate on (reload_event OR queued requests OR
        // pending promise), NOT on `route_queue` emptiness.
        if self.next_bundle.reload_event.is_none()
            && self.next_bundle.requests.first.is_none()
            && !self.next_bundle.promise.strong.has_value()
        {
            return;
        }
        let entry_points = EntryPointList::default();
        // TODO(b2): `append_route_entry_points_if_not_stale` per queued
        // route_bundle — gated on `IncrementalGraph::trace_dependencies`.
        let queue = core::mem::take(&mut self.next_bundle.route_queue);
        for &idx in queue.keys() {
            // DevServer.zig:3043 — every queued route transitions to bundling.
            self.route_bundle_ptr(idx).server_state = route_bundle::State::Bundling;
            // collected into entry_points
        }
        self.next_bundle.route_queue = queue;
        if entry_points.set.is_empty() {
            self.next_bundle.route_queue = Default::default();
            return;
        }
        let _ = self.start_async_bundle(entry_points, false, std::time::Instant::now());
    }

    // ══════════════════════════════════════════════════════════════════════
    // Request handling — on_request / on_asset_request / respond_for_html_bundle
    // ══════════════════════════════════════════════════════════════════════

    /// DevServer.zig `onRequest` — top-level catch-all for non-asset routes.
    /// Matches against `router` (FrameworkRouter) only; HTML routes are
    /// registered as separate uWS handlers that call `respond_for_html_bundle`
    /// directly (DevServer.zig:3177-3205 never consults `html_router`).
    pub fn on_request(&mut self, req: &mut bun_uws_sys::Request, resp: bun_uws::AnyResponse) {
        let _url = req.url();
        // TODO(b2): `FrameworkRouter::match_slow(url)` (gated in
        // `FrameworkRouter.rs`). On hit: `ensure_route_is_bundled` then
        // `on_framework_request_with_bundle`.

        // No framework match — fall through to the user's `fetch` handler if
        // one is configured (DevServer.zig:3199), else built-in 404.
        if let Some(server) = self.server {
            if server.config().on_request.is_some() {
                return server.on_request(req, resp);
            }
        }
        not_found(resp);
    }

    /// DevServer.zig `respondForHTMLBundle`.
    pub fn respond_for_html_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        _req: &mut bun_uws_sys::Request,
        resp: bun_uws::AnyResponse,
    ) {
        let rb = &self.route_bundles[route_bundle_index.get() as usize];
        // DevServer.zig:1091-1186 `ensureRouteIsBundled` — distinct handling
        // per state; transitions `server_state` so subsequent requests don't
        // re-queue.
        match rb.server_state {
            route_bundle::State::Loaded => {
                // TODO(b2): `on_html_request_with_bundle` — gated on
                // `generate_html_payload` (needs `IncrementalGraph::trace_css`).
                not_found(resp);
            }
            route_bundle::State::Unqueued => {
                if self.current_bundle.is_none() {
                    // No bundle in flight — start one immediately.
                    // TODO(b2): `append_route_entry_points_if_not_stale` is
                    // gated on `IncrementalGraph::trace_dependencies`; for now
                    // queue and kick `start_next_bundle_if_present` so the
                    // call sequence is real.
                    self.route_bundle_ptr(route_bundle_index).server_state =
                        route_bundle::State::Bundling;
                    let _ = self.next_bundle.route_queue.put(route_bundle_index, ());
                    // TODO(b2): `defer_request` — needs `SavedRequest::from_uws`.
                    resp.write_status(b"503 Service Unavailable");
                    resp.end(b"bundling", false);
                    self.start_next_bundle_if_present();
                } else {
                    // Bundle in flight — defer to the NEXT bundle.
                    self.route_bundle_ptr(route_bundle_index).server_state =
                        route_bundle::State::DeferredToNextBundle;
                    let _ = self.next_bundle.route_queue.put(route_bundle_index, ());
                    // TODO(b2): `defer_request` into `next_bundle.requests`.
                    resp.write_status(b"503 Service Unavailable");
                    resp.end(b"bundling", false);
                }
            }
            route_bundle::State::Bundling => {
                // Already in the in-flight bundle — defer into
                // `current_bundle.requests` (NOT `next_bundle`).
                // TODO(b2): `defer_request` into `current_bundle.requests` —
                // needs `SavedRequest::from_uws`.
                resp.write_status(b"503 Service Unavailable");
                resp.end(b"bundling", false);
            }
            route_bundle::State::DeferredToNextBundle => {
                // Already queued for the next bundle.
                // TODO(b2): `defer_request` into `next_bundle.requests`.
                resp.write_status(b"503 Service Unavailable");
                resp.end(b"bundling", false);
            }
            route_bundle::State::PossibleBundlingFailures
            | route_bundle::State::EvaluationFailure => {
                // TODO(b2): `send_serialized_failures` — gated on jsc.
                resp.write_status(b"500 Internal Server Error");
                resp.end(b"", false);
            }
        }
    }

    /// DevServer.zig `onAssetRequest` — serves `/_bun/asset/{hash}.ext`.
    pub fn on_asset_request(&mut self, req: &mut bun_uws_sys::Request, resp: bun_uws::AnyResponse) {
        let param = req.parameter(0);
        // DevServer.zig:945-958 — first 16 hex chars are the hash; anything
        // after (e.g. `.ext`) is ignored.
        if param.len() < 16 {
            return not_found(resp);
        }
        let Some(hash) = parse_hex_to_u64(&param[..16]) else {
            return not_found(resp);
        };
        let Some(&route) = self.assets.files.get(&hash) else {
            return not_found(resp);
        };
        // DevServer.zig:957 — claim the request so uWS does not yield to the
        // catch-all `/*` handler after we've written.
        req.set_yield(false);
        // SAFETY: `StaticRoute` is intrusively ref-counted; one ref held while
        // stored in `assets.files` (see `Assets` field doc).
        unsafe { &*route }.on(resp);
    }
}

#[inline]
fn not_found(resp: bun_uws::AnyResponse) {
    resp.write_status(b"404 Not Found");
    resp.end(b"404 Not Found", false);
}

/// Parse a 16-char hex slice into a `u64` via native-endian byte
/// reinterpretation. Mirrors DevServer.zig:961-965 exactly:
/// `std.fmt.hexToBytes(&out, slice)` then `@bitCast([8]u8 → u64)` — i.e.
/// pairwise hex-decode into `[u8;8]` then `from_ne_bytes`, NOT a big-endian
/// numeric accumulator. Input `"0100000000000000"` → 1 on little-endian.
pub fn parse_hex_to_u64(slice: &[u8]) -> Option<u64> {
    if slice.len() != 16 {
        return None;
    }
    let mut out = [0u8; 8];
    for i in 0..8 {
        let hi = hex_nibble(slice[i * 2])?;
        let lo = hex_nibble(slice[i * 2 + 1])?;
        out[i] = (hi << 4) | lo;
    }
    Some(u64::from_ne_bytes(out))
}

#[inline]
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
