//! The configuration files of the project: each "tsconfig.json" and "jsconfig.json" that the
//! resolver read for a directory, and each file that one of them extends.
//!
//! A module is built from these files as much as from its own source: they decide what its
//! imports resolve to and how it is transpiled. None of them is a module of the graph, so a
//! bundle does not give them to the watcher. The resolver names them
//! (`bun_resolver::config_inputs`), and the server watches them and tells the resolver when one
//! changed. When the resolver then fills its directories with something else, the server does
//! what a server that starts does: it bundles each route again when the route is next
//! requested, and makes the pages that are open request theirs.
//!
//! Only a server with no framework does this. The server runtime of a framework keeps the
//! modules that it loaded.

use bun_resolver::{ConfigCursor, Resolver};

use super::*;

/// `DevServer.config_files`
pub(crate) struct ConfigFiles {
    /// Where this server is in the files that the resolver names.
    cursor: ConfigCursor,
    /// `Resolver::config_generation` that the modules of the graphs were built for.
    generation: u32,
    /// Whether the files that were read before this server watched them were read again.
    started: bool,
    /// The named files that were removed. A watch item goes with its file.
    removed: Vec<Box<[u8]>>,
    /// A hash of what was last printed about a file that does not parse. Each event of one
    /// save reads the file again.
    reported: u64,
    /// No bundle ended since the last change, so no route is bundled: every page that a
    /// browser has was served before the change, and there is no page to patch.
    pub(crate) pages_outdated: bool,
}

impl Default for ConfigFiles {
    fn default() -> Self {
        ConfigFiles {
            cursor: ConfigCursor::default(),
            generation: Resolver::config_generation(),
            started: false,
            removed: Vec::new(),
            reported: 0,
            pages_outdated: false,
        }
    }
}

impl ConfigFiles {
    pub(crate) fn memory_cost(&self) -> usize {
        self.removed.iter().map(|path| path.len()).sum()
    }
}

impl DevServer {
    /// Watches the configuration files that the resolver read since the last call, and takes a
    /// change that no file event reported. It runs when the server starts, before the entry
    /// points of a route are chosen and where a bundle ends. It costs one lock and one
    /// comparison when the resolver filled no directory in between.
    pub(crate) fn sync_config_files(&mut self) {
        if !self.frontend_only {
            return;
        }
        let _lock = self.graph_safety_lock.guard();
        self.take_config_changes(&[], &[]);
    }

    /// Tells the resolver that the files at `paths` changed, in a batch of events that also
    /// has the directories `dirs`. If a configuration file now gives something else, every
    /// route is bundled again when it is next requested. The caller holds `graph_safety_lock`.
    pub(crate) fn take_config_changes(&mut self, paths: &[Box<[u8]>], dirs: &[Box<[u8]>]) {
        if !self.frontend_only {
            return;
        }
        // What is wrong with the files that do not parse.
        let mut said = String::new();
        let mut read_any = false;

        let mut named: Vec<Box<[u8]>> = Vec::new();
        // SAFETY: `init()` wrote the transpiler before this is called.
        unsafe { self.server_transpiler.assume_init_mut() }
            .resolver
            .config_files_since(&mut self.config_files.cursor, |path| {
                named.push(Box::from(path))
            });
        // The runtime read the files of the first call when it loaded the script of the
        // server. They can have changed since.
        let read_named = !core::mem::replace(&mut self.config_files.started, true);
        for path in &named {
            if self.watch_config_file(path) && read_named {
                self.read_config_file_again(path, &mut said);
                read_any = true;
            }
        }

        // A file that was removed has no event when it is there again. Its directory has one,
        // and a bundle that starts or ends asks.
        if !self.config_files.removed.is_empty() && (paths.is_empty() || !dirs.is_empty()) {
            for path in core::mem::take(&mut self.config_files.removed) {
                if bun_sys::exists(&path) && self.watch_config_file(&path) {
                    self.read_config_file_again(&path, &mut said);
                    read_any = true;
                } else {
                    self.config_files.removed.push(path);
                }
            }
        }

        for path in paths {
            if Resolver::is_config_file(path) {
                // The watcher drops its item when a save replaces or removes the file. The
                // item comes first: it reports what changes after the file is read here. An
                // item can also stay with a file whose directory was moved away.
                if !self.watch_config_file(path) || !bun_sys::exists(path) {
                    self.config_file_removed(path);
                }
                self.read_config_file_again(path, &mut said);
                read_any = true;
            }
        }

        if read_any {
            // Each event of one save reads the file again. What is wrong with it is said once.
            let hash = bun_wyhash::hash(said.as_bytes());
            if core::mem::replace(&mut self.config_files.reported, hash) != hash && !said.is_empty()
            {
                Output::print_error(&said);
                Output::flush();
            }
        }

        let generation = Resolver::config_generation();
        if generation != self.config_files.generation {
            self.config_files.generation = generation;
            self.rebuild_routes_for_config_change();
        }
    }

    fn read_config_file_again(&mut self, path: &[u8], said: &mut String) {
        // SAFETY: `init()` wrote the transpiler before this is called.
        let resolver = &mut unsafe { self.server_transpiler.assume_init_mut() }.resolver;
        let mut log = Log::init();
        let _ = resolver.config_file_changed(path, &mut log);
        if log.errors > 0 {
            // A save that is read half done does not parse either. What a second read says
            // is what is wrong with the file.
            log = Log::init();
            let _ = resolver.config_file_changed(path, &mut log);
        }
        let _ = log.print(said);
    }

    /// Adds a watch item for the configuration file `path`, if it has none. Returns whether
    /// the file has one now.
    fn watch_config_file(&mut self, path: &[u8]) -> bool {
        self.bun_watcher.add_file_by_path_without_directory(path)
    }

    /// Remembers a configuration file that lost its watch item, and watches its directory,
    /// which reports when the file is there again.
    fn config_file_removed(&mut self, path: &[u8]) {
        if self.config_files.removed.iter().any(|it| **it == *path) {
            return;
        }
        self.config_files.removed.push(Box::from(path));
        // On Windows an item is a path, so this is a file that the watcher cannot report.
        #[cfg(not(windows))]
        {
            let dir = paths::fs::PathName::init(path).dir_with_trailing_slash();
            let _ = self.bun_watcher.add_directory::<true>(
                bun_sys::Fd::INVALID,
                dir,
                bun_watcher::Watcher::get_hash(dir),
            );
        }
    }

    /// Puts the graph, the routes and the pages where they are when the server starts: every
    /// module is bundled again when a route that needs it is next requested, and every page
    /// that is open loads again. A page is not patched: a patch that holds every module of the
    /// page, the libraries too, leaves two copies of them in the page. The caller holds
    /// `graph_safety_lock`.
    fn rebuild_routes_for_config_change(&mut self) {
        // SAFETY: `init()` wrote the transpiler before any bundle and any file event.
        unsafe { self.client_transpiler.assume_init_mut() }.reload_root_tsconfig_jsx();

        self.client_graph.stale_files.set_all(true);
        // What each barrel file must export is found again from the importers.
        self.barrel_files_with_deferrals.clear_retaining_capacity();
        self.barrel_needed_exports.clear_retaining_capacity();

        for route_bundle in &mut self.route_bundles {
            if matches!(
                route_bundle.server_state,
                route_bundle::State::Loaded | route_bundle::State::PossibleBundlingFailures
            ) {
                route_bundle.server_state = route_bundle::State::Unqueued;
            }
            route_bundle.invalidate_client_bundle(&mut self.source_maps);
        }

        // A page loads again when it gets this frame a second time. A page that was served and
        // has no socket yet gets it when the socket opens.
        self.config_files.pages_outdated = true;
        let frame = self.version_frame();
        let mut behind = Vec::new();
        for socket in self.active_websocket_connections.keys() {
            // SAFETY: the map owns each socket until `on_close` removes it.
            if let Some(ws) = unsafe { &**socket }.underlying {
                if ws.send(&frame, bun_uws_sys::Opcode::Binary, false, true)
                    == bun_uws_sys::SendStatus::Dropped
                {
                    behind.push(ws);
                }
            }
        }
        // A socket with too much to send does not take the frame. Its page connects again
        // when the socket closes, and loads again for the frame of the new socket.
        for ws in behind {
            ws.close();
        }
    }

    /// The first frame of every socket. A page loads again when it gets the frame a second time.
    pub(crate) fn version_frame(&self) -> [u8; 1 + DevServer::CONFIGURATION_HASH_KEY_LEN] {
        let mut frame = [0u8; 1 + DevServer::CONFIGURATION_HASH_KEY_LEN];
        frame[0] = MessageId::Version.char();
        frame[1..].copy_from_slice(&self.configuration_hash_key);
        frame
    }
}
