// This is Bun's JavaScript/TypeScript bundler
//
// A lot of the implementation is based on the Go implementation of esbuild. Thank you Evan Wallace.
//
// # Memory management
//
// Zig is not a managed language, so we have to be careful about memory management.
// Manually freeing memory is error-prone and tedious, but garbage collection
// is slow and reference counting incurs a performance penalty.
//
// Bun's bundler relies on mimalloc's threadlocal heaps as arena allocators.
//
// When a new thread is spawned for a bundling job, it is given a threadlocal
// heap and all allocations are done on that heap. When the job is done, the
// threadlocal heap is destroyed and all memory is freed.
//
// There are a few careful gotchas to keep in mind:
//
// - A threadlocal heap cannot allocate memory on a different thread than the one that
//   created it. You will get a segfault if you try to do that.
//
// - Since the heaps are destroyed at the end of bundling, any globally shared
//   references to data must NOT be allocated on a threadlocal heap.
//
//   For example, package.json and tsconfig.json read from the filesystem must be
//   use the global allocator (bun.default_allocator) because bun's directory
//   entry cache and module resolution cache are globally shared across all
//   threads.
//
//   Additionally, `LinkerContext`'s allocator is also threadlocal.
//
// - Globally allocated data must be in a cache & reused, or we will create an infinite
//   memory leak over time. To do that, we have a DirnameStore, FilenameStore, and the other
//   data structures related to `BSSMap`. This still leaks memory, but not very
//   much since it only allocates the first time around.
//
// In development, it is strongly recommended to use either a debug build of
// mimalloc or Valgrind to help catch memory issues
// To use a debug build of mimalloc:
//
//     make mimalloc-debug
//

use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_core::{self as bun, Environment, FeatureFlags, Output, Error};
use bun_core::Transpiler;
use bun_str::strings;
use bun_alloc::{Arena as ThreadLocalArena, AllocError};
use bun_collections::{BabyList, MultiArrayList, ArrayHashMap, StringHashMap, StringArrayHashMap, DynamicBitSet, DynamicBitSetUnmanaged};
use bun_logger as Logger;
use bun_js_parser::{self as js_ast, Ref, Index, Symbol, Stmt, Expr, E, S, G, B, Binding, Scope, Part, Dependency};
use bun_js_parser::ast::BundledAst as JSAst;
use bun_js_parser::ast::{UseDirective, ServerComponentBoundary};
use bun_options_types::{ImportRecord, ImportKind};
use bun_resolver::{self as _resolver, fs as Fs, Resolver, DataURL, is_package_path, NodeFallbackModules};
use bun_jsc::{self as jsc};
use bun_threading::ThreadPool as ThreadPoolLib;
use bun_bake as bake;
use bun_sourcemap as SourceMap;
use bun_paths as resolve_path;

use crate::options::{self, Loader, Target, PathTemplate};
use crate::graph::Graph;
use crate::linker_context::LinkerContext;
use crate::linker_graph::LinkerGraph;
use crate::parse_task::ParseTask;
use crate::thread_pool::ThreadPool;
use crate::deferred_batch_task::DeferredBatchTask;
use crate::server_component_parse_task::ServerComponentParseTask;
use crate::ast_builder::AstBuilder;
use crate::chunk::{Chunk, ChunkImport};
use crate::cache::CacheEntry;
use crate::path_to_source_index_map::PathToSourceIndexMap;
use crate::barrel_imports;

pub use crate::bundle_thread::BundleThread;

bun_output::declare_scope!(part_dep_tree, visible);
bun_output::declare_scope!(Bundle, visible);
bun_output::declare_scope!(scan_counter, visible);
bun_output::declare_scope!(ReachableFiles, visible);
bun_output::declare_scope!(TreeShake, hidden);
bun_output::declare_scope!(PartRanges, hidden);
bun_output::declare_scope!(ContentHasher, hidden);

pub type MangledProps = ArrayHashMap<Ref, Box<[u8]>>;

pub type Watcher = bun_jsc::hot_reloader::NewHotReloader<BundleV2, EventLoop, true>;

type IndexInt = u32; // Index.Int

/// This assigns a concise, predictable, and unique `.pretty` attribute to a Path.
/// DevServer relies on pretty paths for identifying modules, so they must be unique.
pub fn generic_path_with_pretty_initialized(
    path: Fs::Path,
    target: options::Target,
    top_level_dir: &[u8],
    bump: &bun_alloc::Arena,
) -> Result<Fs::Path, Error> {
    // TODO(port): narrow error set
    let buf = bun_paths::path_buffer_pool().get();

    let is_node = path.namespace == b"node";
    if is_node
        && (path.text.starts_with(NodeFallbackModules::IMPORT_PATH)
            || !bun_paths::is_absolute(&path.text))
    {
        return Ok(path);
    }

    // "file" namespace should use the relative file path for its display name.
    // the "node" namespace is also put through this code path so that the
    // "node:" prefix is not emitted.
    if path.is_file() || is_node {
        let buf2 = if target == Target::BakeServerComponentsSsr {
            bun_paths::path_buffer_pool().get()
        } else {
            // TODO(port): in Zig buf2 aliases buf when target != ssr; here we need a separate guard or branch
            bun_paths::path_buffer_pool().get()
        };
        let rel = bun_paths::relative_platform_buf(&mut *buf2, top_level_dir, &path.text, bun_paths::Platform::Loose, false);
        let mut path_clone = path;
        // stack-allocated temporary is not leaked because dupeAlloc on the path will
        // move .pretty into the heap. that function also fixes some slash issues.
        if target == Target::BakeServerComponentsSsr {
            // the SSR graph needs different pretty names or else HMR mode will
            // confuse the two modules.
            let mut cursor = &mut buf[..];
            path_clone.pretty = match write!(cursor, "ssr:{}", bstr::BStr::new(rel)) {
                Ok(()) => {
                    let written = buf.len() - cursor.len();
                    &buf[..written]
                }
                Err(_) => &buf[..],
            };
        } else {
            path_clone.pretty = rel;
        }
        path_clone.dupe_alloc_fix_pretty(bump)
    } else {
        // in non-file namespaces, standard filesystem rules do not apply.
        let mut path_clone = path;
        let mut cursor = &mut buf[..];
        path_clone.pretty = match write!(
            cursor,
            "{}{}:{}",
            if target == Target::BakeServerComponentsSsr { "ssr:" } else { "" },
            // make sure that a namespace including a colon wont collide with anything
            EscapedNamespace(&path.namespace),
            bstr::BStr::new(&path.text),
        ) {
            Ok(()) => {
                let written = buf.len() - cursor.len();
                &buf[..written]
            }
            Err(_) => &buf[..],
        };
        path_clone.dupe_alloc_fix_pretty(bump)
    }
}

struct EscapedNamespace<'a>(&'a [u8]);
impl core::fmt::Display for EscapedNamespace<'_> {
    fn fmt(&self, w: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let mut rest = self.0;
        while let Some(i) = strings::index_of_char(rest, b':') {
            write!(w, "{}", bstr::BStr::new(&rest[..i as usize]))?;
            w.write_str("::")?;
            rest = &rest[i as usize + 1..];
        }
        write!(w, "{}", bstr::BStr::new(rest))
    }
}

#[derive(Clone, Copy)]
pub struct PendingImport {
    pub to_source_index: Index,
    pub import_record_index: u32,
}

pub struct BundleV2<'a> {
    pub transpiler: &'a mut Transpiler,
    /// When Server Component is enabled, this is used for the client bundles
    /// and `transpiler` is used for the server bundles.
    pub client_transpiler: Option<&'a mut Transpiler>,
    /// See bake.Framework.ServerComponents.separate_ssr_graph
    pub ssr_transpiler: &'a mut Transpiler,
    /// When Bun Bake is used, the resolved framework is passed here
    pub framework: Option<bake::Framework>,
    pub graph: Graph,
    pub linker: LinkerContext,
    pub bun_watcher: Option<NonNull<bun_core::Watcher>>, // TODO(port): lifetime
    pub plugins: Option<&'a mut jsc::api::JSBundler::Plugin>,
    pub completion: Option<*mut JSBundleCompletionTask>,
    /// In-memory files that can be used as entrypoints or imported.
    /// This is a pointer to the FileMap in the completion config.
    pub file_map: Option<&'a jsc::api::JSBundler::FileMap>,
    pub source_code_length: usize,

    /// There is a race condition where an onResolve plugin may schedule a task on the bundle thread before its parsing task completes
    pub resolve_tasks_waiting_for_import_source_index: ArrayHashMap<IndexInt, BabyList<PendingImport>>,

    /// Allocations not tracked by a threadlocal heap
    pub free_list: Vec<Box<[u8]>>,

    /// See the comment in `Chunk.OutputPiece`
    pub unique_key: u64,
    pub dynamic_import_entry_points: ArrayHashMap<IndexInt, ()>,
    pub has_on_parse_plugins: bool,

    pub finalizers: Vec<CacheEntry::ExternalFreeFunction>,

    pub drain_defer_task: DeferredBatchTask,

    /// Set true by DevServer. Currently every usage of the transpiler (Bun.build
    /// and `bun build` cli) runs at the top of an event loop. When this is
    /// true, a callback is executed after all work is complete.
    ///
    /// You can find which callbacks are run by looking at the
    /// `finishFromBakeDevServer(...)` function here
    pub asynchronous: bool,
    pub thread_lock: bun_core::safety::ThreadLock,

    // if false we can skip TLA validation and propagation
    pub has_any_top_level_await_modules: bool,

    /// Barrel optimization: tracks which exports have been requested from each
    /// module encountered during barrel BFS. Keys are source_indices. Values
    /// track requested export names for deduplication and cycle detection.
    /// Persists across calls to scheduleBarrelDeferredImports so cross-file
    /// deduplication is free.
    pub requested_exports: ArrayHashMap<u32, barrel_imports::RequestedExports>,
}

pub struct BakeOptions<'a> {
    pub framework: bake::Framework,
    pub client_transpiler: &'a mut Transpiler,
    pub ssr_transpiler: &'a mut Transpiler,
    pub plugins: Option<&'a mut jsc::api::JSBundler::Plugin>,
}

impl<'a> BundleV2<'a> {
    #[inline]
    pub fn r#loop(&mut self) -> &mut EventLoop {
        &mut self.linker.r#loop
    }

    /// Returns the jsc.EventLoop where plugin callbacks can be queued up on
    pub fn js_loop_for_plugins(&mut self) -> &mut jsc::EventLoop {
        debug_assert!(self.plugins.is_some());
        if let Some(completion) = self.completion {
            // From Bun.build
            // SAFETY: completion is a valid backref while bundle is running
            unsafe { &mut *(*completion).jsc_event_loop }
        } else {
            match self.r#loop() {
                // From bake where the loop running the bundle is also the loop
                // running the plugins.
                EventLoop::Js(jsc_event_loop) => jsc_event_loop,
                // The CLI currently has no jsc event loop; for now, no plugin support
                EventLoop::Mini(_) => panic!("No JavaScript event loop for transpiler plugins to run on"),
            }
        }
    }

    fn ensure_client_transpiler(&mut self) {
        if self.client_transpiler.is_none() {
            let _ = self.initialize_client_transpiler().unwrap_or_else(|e| {
                panic!("Failed to initialize client transpiler: {}", e.name());
            });
        }
    }

    #[cold]
    fn initialize_client_transpiler(&mut self) -> Result<&mut Transpiler, Error> {
        let alloc = self.allocator();

        let this_transpiler = &mut *self.transpiler;
        // TODO(port): allocator.create(Transpiler) — using arena alloc here; lifetime is 'a
        let client_transpiler: &'a mut Transpiler = alloc.alloc(this_transpiler.clone());
        client_transpiler.options = this_transpiler.options.clone();

        client_transpiler.options.target = Target::Browser;
        client_transpiler.options.main_fields = options::Target::DEFAULT_MAIN_FIELDS.get(Target::Browser);
        client_transpiler.options.conditions = options::ESMConditions::init(
            alloc,
            Target::Browser.default_conditions(),
            false,
            &[],
        )?;

        // We need to make sure it has [hash] in the names so we don't get conflicts.
        if this_transpiler.options.compile {
            client_transpiler.options.asset_naming = options::PathTemplate::ASSET.data;
            client_transpiler.options.chunk_naming = options::PathTemplate::CHUNK.data;
            client_transpiler.options.entry_naming = b"./[name]-[hash].[ext]";

            // Use "/" so that asset URLs in HTML are absolute (e.g. "/chunk-abc.js"
            // instead of "./chunk-abc.js"). Relative paths break when the HTML is
            // served from a nested route like "/foo/".
            client_transpiler.options.public_path = b"/";
        }

        client_transpiler.set_log(this_transpiler.log);
        client_transpiler.set_allocator(alloc);
        client_transpiler.linker.resolver = &mut client_transpiler.resolver;
        client_transpiler.macro_context = js_ast::Macro::MacroContext::init(client_transpiler);
        client_transpiler.resolver.caches = crate::cache::Set::init(alloc);

        client_transpiler.configure_defines()?;
        client_transpiler.resolver.opts = client_transpiler.options.clone();
        client_transpiler.resolver.env_loader = client_transpiler.env;
        // TODO(port): storing arena-allocated &mut into self.client_transpiler — lifetime is tied to graph.heap
        self.client_transpiler = Some(client_transpiler);
        Ok(client_transpiler)
    }

    /// Most of the time, accessing .transpiler directly is OK. This is only
    /// needed when it is important to distinct between client and server
    ///
    /// Note that .log, .allocator, and other things are shared
    /// between the three transpiler configurations
    #[inline]
    pub fn transpiler_for_target(&mut self, target: options::Target) -> &mut Transpiler {
        if !self.transpiler.options.server_components && self.linker.dev_server.is_none() {
            if target == Target::Browser && self.transpiler.options.target.is_server_side() {
                if let Some(ct) = self.client_transpiler.as_deref_mut() {
                    return ct;
                }
                return self.initialize_client_transpiler().unwrap_or_else(|e| {
                    panic!("Failed to initialize client transpiler: {}", e.name());
                });
            }
            return self.transpiler;
        }

        match target {
            Target::Browser => self.client_transpiler.as_deref_mut().unwrap(),
            Target::BakeServerComponentsSsr => self.ssr_transpiler,
            _ => self.transpiler,
        }
    }

    /// By calling this function, it implies that the returned log *will* be
    /// written to. For DevServer, this allocates a per-file log for the sources
    /// it is called on. Function must be called on the bundle thread.
    pub fn log_for_resolution_failures(&mut self, abs_path: &[u8], bake_graph: bake::Graph) -> &mut Logger::Log {
        if let Some(dev) = self.transpiler.options.dev_server {
            return dev.get_log_for_resolution_failures(abs_path, bake_graph);
        }
        self.transpiler.log
    }

    #[inline]
    pub fn path_to_source_index_map(&mut self, target: options::Target) -> &mut PathToSourceIndexMap {
        self.graph.path_to_source_index_map(target)
    }
}

pub struct ReachableFileVisitor<'a> {
    pub reachable: Vec<Index>,
    pub visited: DynamicBitSet,
    pub all_import_records: &'a mut [ImportRecord::List],
    pub all_loaders: &'a [Loader],
    pub all_urls_for_css: &'a [&'a [u8]],
    pub redirects: &'a [u32],
    pub redirect_map: PathToSourceIndexMap,
    pub dynamic_import_entry_points: &'a mut ArrayHashMap<IndexInt, ()>,
    /// Files which are Server Component Boundaries
    pub scb_bitset: Option<DynamicBitSetUnmanaged>,
    pub scb_list: ServerComponentBoundary::ListSlice,

    /// Files which are imported by JS and inlined in CSS
    pub additional_files_imported_by_js_and_inlined_in_css: &'a mut DynamicBitSetUnmanaged,
    /// Files which are imported by CSS and inlined in CSS
    pub additional_files_imported_by_css_and_inlined: &'a mut DynamicBitSetUnmanaged,
}

impl<'a> ReachableFileVisitor<'a> {
    const MAX_REDIRECTS: usize = 64;

    // Find all files reachable from all entry points. This order should be
    // deterministic given that the entry point order is deterministic, since the
    // returned order is the postorder of the graph traversal and import record
    // order within a given file is deterministic.
    pub fn visit<const CHECK_DYNAMIC_IMPORTS: bool>(&mut self, source_index: Index, was_dynamic_import: bool) {
        if source_index.is_invalid() {
            return;
        }

        if self.visited.is_set(source_index.get()) {
            if CHECK_DYNAMIC_IMPORTS {
                if was_dynamic_import {
                    self.dynamic_import_entry_points.put(source_index.get(), ()).expect("unreachable");
                }
            }
            return;
        }
        self.visited.set(source_index.get());

        if let Some(scb_bitset) = &self.scb_bitset {
            if scb_bitset.is_set(source_index.get()) {
                let scb_index = self.scb_list.get_index(source_index.get()).expect("unreachable");
                self.visit::<CHECK_DYNAMIC_IMPORTS>(Index::init(self.scb_list.list.items_reference_source_index()[scb_index]), false);
                self.visit::<CHECK_DYNAMIC_IMPORTS>(Index::init(self.scb_list.list.items_ssr_source_index()[scb_index]), false);
            }
        }

        let is_js = self.all_loaders[source_index.get() as usize].is_javascript_like();
        let is_css = self.all_loaders[source_index.get() as usize].is_css();

        let import_record_list_id = source_index;
        // when there are no import records, v index will be invalid
        if (import_record_list_id.get() as usize) < self.all_import_records.len() {
            // PORT NOTE: reshaped for borrowck — split borrow of all_import_records
            let import_records_len = self.all_import_records[import_record_list_id.get() as usize].len();
            for ir_idx in 0..import_records_len {
                let import_record = &mut self.all_import_records[import_record_list_id.get() as usize].slice_mut()[ir_idx];
                let mut other_source = import_record.source_index;
                if other_source.is_valid() {
                    let mut redirect_count: usize = 0;
                    while let Some(redirect_id) = get_redirect_id(self.redirects[other_source.get() as usize]) {
                        let other_import_records = self.all_import_records[other_source.get() as usize].slice();
                        let other_import_record = &other_import_records[redirect_id as usize];
                        // PORT NOTE: reshaped for borrowck — re-borrow import_record
                        let import_record = &mut self.all_import_records[import_record_list_id.get() as usize].slice_mut()[ir_idx];
                        import_record.source_index = other_import_record.source_index;
                        import_record.path = other_import_record.path.clone();
                        other_source = other_import_record.source_index;
                        if redirect_count == Self::MAX_REDIRECTS {
                            import_record.path.is_disabled = true;
                            import_record.source_index = Index::INVALID;
                            break;
                        }

                        // Handle redirects to a builtin or external module
                        // https://github.com/oven-sh/bun/issues/3764
                        if !other_source.is_valid() {
                            break;
                        }
                        redirect_count += 1;
                    }

                    let import_record = &self.all_import_records[import_record_list_id.get() as usize].slice()[ir_idx];
                    // Mark if the file is imported by JS and its URL is inlined for CSS
                    let is_inlined = import_record.source_index.is_valid()
                        && !self.all_urls_for_css[import_record.source_index.get() as usize].is_empty();
                    if is_js && is_inlined {
                        self.additional_files_imported_by_js_and_inlined_in_css.set(import_record.source_index.get());
                    } else if is_css && is_inlined {
                        self.additional_files_imported_by_css_and_inlined.set(import_record.source_index.get());
                    }

                    let next_source = import_record.source_index;
                    let kind_is_dynamic = import_record.kind == ImportKind::Dynamic;
                    self.visit::<CHECK_DYNAMIC_IMPORTS>(next_source, CHECK_DYNAMIC_IMPORTS && kind_is_dynamic);
                }
            }

            // Redirects replace the source file with another file
            if let Some(redirect_id) = get_redirect_id(self.redirects[source_index.get() as usize]) {
                let redirect_source_index = self.all_import_records[source_index.get() as usize].slice()[redirect_id as usize].source_index.get();
                self.visit::<CHECK_DYNAMIC_IMPORTS>(Index::source(redirect_source_index), was_dynamic_import);
                return;
            }
        }

        // Each file must come after its dependencies
        self.reachable.push(source_index);
        if CHECK_DYNAMIC_IMPORTS {
            if was_dynamic_import {
                self.dynamic_import_entry_points.put(source_index.get(), ()).expect("unreachable");
            }
        }
    }
}

impl<'a> BundleV2<'a> {
    pub fn find_reachable_files(&mut self) -> Result<Box<[Index]>, Error> {
        let trace = bun_core::perf::trace("Bundler.findReachableFiles");
        drop(trace); // TODO(port): scope guard for trace.end()

        // Create a quick index for server-component boundaries.
        // We need to mark the generated files as reachable, or else many files will appear missing.
        // PERF(port): was stack-fallback
        let mut scb_bitset = if self.graph.server_component_boundaries.list.len() > 0 {
            Some(self.graph.server_component_boundaries.slice().bit_set(self.graph.input_files.len())?)
        } else {
            None
        };

        let mut additional_files_imported_by_js_and_inlined_in_css = DynamicBitSetUnmanaged::init_empty(self.graph.input_files.len())?;
        let mut additional_files_imported_by_css_and_inlined = DynamicBitSetUnmanaged::init_empty(self.graph.input_files.len())?;

        self.dynamic_import_entry_points = ArrayHashMap::new();

        let all_urls_for_css = self.graph.ast.items_url_for_css();

        let mut visitor = ReachableFileVisitor {
            reachable: Vec::with_capacity(self.graph.entry_points.len() + 1),
            visited: DynamicBitSet::init_empty(self.graph.input_files.len())?,
            redirects: self.graph.ast.items_redirect_import_record_index(),
            all_import_records: self.graph.ast.items_import_records_mut(),
            all_loaders: self.graph.input_files.items_loader(),
            all_urls_for_css,
            redirect_map: self.path_to_source_index_map(self.transpiler.options.target).clone(),
            dynamic_import_entry_points: &mut self.dynamic_import_entry_points,
            scb_bitset,
            scb_list: if scb_bitset.is_some() {
                self.graph.server_component_boundaries.slice()
            } else {
                // SAFETY: will never be read since the above bitset is `null`
                unsafe { core::mem::zeroed() }
            },
            additional_files_imported_by_js_and_inlined_in_css: &mut additional_files_imported_by_js_and_inlined_in_css,
            additional_files_imported_by_css_and_inlined: &mut additional_files_imported_by_css_and_inlined,
        };
        // PORT NOTE: reshaped for borrowck — many overlapping borrows of self.graph here; Phase B may need to restructure

        // If we don't include the runtime, __toESM or __toCommonJS will not get
        // imported and weird things will happen
        visitor.visit::<false>(Index::RUNTIME, false);

        if self.transpiler.options.code_splitting {
            for entry_point in self.graph.entry_points.iter().copied() {
                visitor.visit::<true>(entry_point, false);
            }
        } else {
            for entry_point in self.graph.entry_points.iter().copied() {
                visitor.visit::<false>(entry_point, false);
            }
        }

        if bun_output::scope_is_visible!(ReachableFiles) {
            bun_output::scoped_log!(ReachableFiles, "Reachable count: {} / {}", visitor.reachable.len(), self.graph.input_files.len());
            let sources = self.graph.input_files.items_source();
            let targets = self.graph.ast.items_target();
            for idx in visitor.reachable.iter() {
                let source = &sources[idx.get() as usize];
                bun_output::scoped_log!(
                    ReachableFiles,
                    "reachable file: #{} {} ({}) target=.{}",
                    source.index.get(),
                    bun_core::fmt::quote(&source.path.pretty),
                    bstr::BStr::new(&source.path.text),
                    <&'static str>::from(targets[idx.get() as usize]),
                );
            }
        }

        let additional_files = self.graph.input_files.items_additional_files_mut();
        let unique_keys = self.graph.input_files.items_unique_key_for_additional_file_mut();
        let content_hashes = self.graph.input_files.items_content_hash_for_additional_file_mut();
        for (index, url_for_css) in all_urls_for_css.iter().enumerate() {
            if !url_for_css.is_empty() {
                // We like to inline additional files in CSS if they fit a size threshold
                // If we do inline a file in CSS, and it is not imported by JS, then we don't need to copy the additional file into the output directory
                if additional_files_imported_by_css_and_inlined.is_set(index as u32)
                    && !additional_files_imported_by_js_and_inlined_in_css.is_set(index as u32)
                {
                    additional_files[index].clear();
                    unique_keys[index] = b"";
                    content_hashes[index] = 0;
                }
            }
        }

        Ok(visitor.reachable.into_boxed_slice())
    }

    fn is_done(&mut self) -> bool {
        self.thread_lock.assert_locked();

        if self.graph.pending_items == 0 {
            if self.graph.drain_deferred_tasks(self) {
                return false;
            }
            return true;
        }

        false
    }

    pub fn wait_for_parse(&mut self) {
        self.r#loop().tick(self, &Self::is_done);
        bun_output::scoped_log!(Bundle, "Parsed {} files, producing {} ASTs", self.graph.input_files.len(), self.graph.ast.len());
    }

    pub fn scan_for_secondary_paths(&mut self) {
        if !self.graph.has_any_secondary_paths {
            // Assert the boolean is accurate.
            #[cfg(feature = "ci_assert")]
            for secondary_path in self.graph.input_files.items_secondary_path() {
                if !secondary_path.is_empty() {
                    panic!("secondary_path is not empty");
                }
            }
            // No dual package hazard. Do nothing.
            return;
        }

        // Now that all files have been scanned, look for packages that are imported
        // both with "import" and "require". Rewrite any imports that reference the
        // "module" package.json field to the "main" package.json field instead.
        //
        // This attempts to automatically avoid the "dual package hazard" where a
        // package has both a CommonJS module version and an ECMAScript module
        // version and exports a non-object in CommonJS (often a function). If we
        // pick the "module" field and the package is imported with "require" then
        // code expecting a function will crash.
        let ast_import_records = self.graph.ast.items_import_records();
        let targets = self.graph.ast.items_target();
        let max_valid_source_index = Index::init(self.graph.input_files.len());
        let secondary_paths = self.graph.input_files.items_secondary_path();

        debug_assert_eq!(ast_import_records.len(), targets.len());
        for (ast_import_record_list, target) in ast_import_records.iter().zip(targets.iter()) {
            let import_records = ast_import_record_list.slice_mut();
            let path_to_source_index_map = self.path_to_source_index_map(*target);
            for import_record in import_records.iter_mut() {
                let source_index = import_record.source_index.get();
                if source_index >= max_valid_source_index.get() {
                    continue;
                }
                let secondary_path = secondary_paths[source_index as usize];
                if !secondary_path.is_empty() {
                    let Some(secondary_source_index) = path_to_source_index_map.get(secondary_path) else { continue };
                    import_record.source_index = Index::init(secondary_source_index);
                    // Keep path in sync for determinism, diagnostics, and dev tooling.
                    import_record.path = self.graph.input_files.items_source()[secondary_source_index as usize].path.clone();
                }
            }
        }
    }

    /// This runs on the Bundle Thread.
    pub fn run_resolver(
        &mut self,
        import_record: jsc::api::JSBundler::Resolve::MiniImportRecord,
        target: options::Target,
    ) {
        let transpiler = self.transpiler_for_target(target);
        let source_dir = Fs::PathName::init(import_record.source_file).dir_with_trailing_slash();

        // Check the FileMap first for in-memory files
        if let Some(file_map) = self.file_map {
            if let Some(_file_map_result) = file_map.resolve(import_record.source_file, import_record.specifier) {
                let mut file_map_result = _file_map_result;
                let mut path_primary = file_map_result.path_pair.primary.clone();
                let entry = self.path_to_source_index_map(target).get_or_put(path_primary.text.clone());
                if !entry.found_existing {
                    let loader: Loader = 'brk: {
                        let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                        if let Some(out_loader) = record.loader {
                            break 'brk out_loader;
                        }
                        break 'brk Fs::Path::init(path_primary.text.clone()).loader(&transpiler.options.loaders).unwrap_or(Loader::File);
                    };
                    // For virtual files, use the path text as-is (no relative path computation needed).
                    path_primary.pretty = self.allocator().alloc_slice_copy(&path_primary.text);
                    let idx = self.enqueue_parse_task(
                        &file_map_result,
                        &Logger::Source {
                            path: path_primary,
                            contents: b"",
                            ..Default::default()
                        },
                        loader,
                        import_record.original_target,
                    ).expect("oom");
                    *entry.value_ptr = idx;
                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                    record.source_index = Index::init(idx);
                } else {
                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                    record.source_index = Index::init(*entry.value_ptr);
                }
                return;
            }
        }

        let mut had_busted_dir_cache = false;
        let resolve_result: _resolver::Result = loop {
            match transpiler.resolver.resolve(source_dir, import_record.specifier, import_record.kind) {
                Ok(r) => break r,
                Err(err) => {
                    // Only perform directory busting when hot-reloading is enabled
                    if err == bun_core::err!("ModuleNotFound") {
                        if let Some(dev) = self.transpiler.options.dev_server {
                            if !had_busted_dir_cache {
                                // Only re-query if we previously had something cached.
                                if transpiler.resolver.bust_dir_cache_from_specifier(import_record.source_file, import_record.specifier) {
                                    had_busted_dir_cache = true;
                                    continue;
                                }
                            }

                            // Tell Bake's Dev Server to wait for the file to be imported.
                            dev.directory_watchers.track_resolution_failure(
                                import_record.source_file,
                                import_record.specifier,
                                target.bake_graph(),
                                self.graph.input_files.items_loader()[import_record.importer_source_index as usize],
                            ).expect("oom");

                            // Turn this into an invalid AST, so that incremental mode skips it when printing.
                            self.graph.ast.items_parts_mut()[import_record.importer_source_index as usize].len = 0;
                        }
                    }

                    let mut handles_import_errors = false;
                    let mut source: Option<&Logger::Source> = None;
                    let log = self.log_for_resolution_failures(import_record.source_file, target.bake_graph());

                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                    source = Some(&self.graph.input_files.items_source()[import_record.importer_source_index as usize]);
                    handles_import_errors = record.flags.handles_import_errors;

                    // Disable failing packages from being printed.
                    // This may cause broken code to write.
                    // However, doing this means we tell them all the resolve errors
                    // Rather than just the first one.
                    record.path.is_disabled = true;

                    if err == bun_core::err!("ModuleNotFound") {
                        let add_error = Logger::Log::add_resolve_error_with_text_dupe;
                        let path_to_use = import_record.specifier;

                        if !handles_import_errors && !self.transpiler.options.ignore_module_resolution_errors {
                            if is_package_path(import_record.specifier) {
                                if target == Target::Browser && options::ExternalModules::is_node_builtin(path_to_use) {
                                    add_error(
                                        log, source, import_record.range, self.allocator(),
                                        format_args!("Browser build cannot {} Node.js module: \"{}\". To use Node.js builtins, set target to 'node' or 'bun'",
                                            import_record.kind.error_label(), bstr::BStr::new(path_to_use)),
                                        import_record.kind,
                                    ).expect("unreachable");
                                } else {
                                    add_error(
                                        log, source, import_record.range, self.allocator(),
                                        format_args!("Could not resolve: \"{}\". Maybe you need to \"bun install\"?", bstr::BStr::new(path_to_use)),
                                        import_record.kind,
                                    ).expect("unreachable");
                                }
                            } else {
                                add_error(
                                    log, source, import_record.range, self.allocator(),
                                    format_args!("Could not resolve: \"{}\"", bstr::BStr::new(path_to_use)),
                                    import_record.kind,
                                ).expect("unreachable");
                            }
                        }
                    }
                    // assume other errors are already in the log
                    return;
                }
            }
        };
        let mut resolve_result = resolve_result;

        let mut out_source_index: Option<Index> = None;

        let path: &mut Fs::Path = match resolve_result.path() {
            Some(p) => p,
            None => {
                let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                // Disable failing packages from being printed.
                // This may cause broken code to write.
                // However, doing this means we tell them all the resolve errors
                // Rather than just the first one.
                record.path.is_disabled = true;
                return;
            }
        };

        if resolve_result.flags.is_external {
            return;
        }

        if path.pretty.as_ptr() == path.text.as_ptr() {
            // TODO: outbase
            let rel = bun_paths::relative_platform(&transpiler.fs.top_level_dir, &path.text, bun_paths::Platform::Loose, false);
            path.pretty = self.allocator().alloc_slice_copy(rel);
        }
        path.assert_pretty_is_valid();
        path.assert_file_path_is_absolute();

        let entry = self.path_to_source_index_map(target).get_or_put(path.text.clone());
        if !entry.found_existing {
            *path = self.path_with_pretty_initialized(path.clone(), target).expect("oom");
            *entry.key_ptr = path.text.clone();
            let loader: Loader = 'brk: {
                let record: &ImportRecord = &self.graph.ast.items_import_records()[import_record.importer_source_index as usize].slice()[import_record.import_record_index as usize];
                if let Some(out_loader) = record.loader {
                    break 'brk out_loader;
                }
                break 'brk path.loader(&transpiler.options.loaders).unwrap_or(Loader::File);
                // HTML is only allowed at the entry point.
            };
            let idx = self.enqueue_parse_task(
                &resolve_result,
                &Logger::Source {
                    path: path.clone(),
                    contents: b"",
                    ..Default::default()
                },
                loader,
                import_record.original_target,
            ).expect("oom");
            *entry.value_ptr = idx;
            out_source_index = Some(Index::init(idx));

            if let Some(secondary) = &resolve_result.path_pair.secondary {
                if !secondary.is_disabled
                    && !core::ptr::eq(secondary, path)
                    && !strings::eql_long(&secondary.text, &path.text, true)
                {
                    let secondary_path_to_copy = secondary.dupe_alloc(self.allocator()).expect("oom");
                    self.graph.input_files.items_secondary_path_mut()[idx as usize] = secondary_path_to_copy.text;
                    // Ensure the determinism pass runs.
                    self.graph.has_any_secondary_paths = true;
                }
            }

            // For non-javascript files, make all of these files share indices.
            // For example, it is silly to bundle index.css depended on by client+server twice.
            // It makes sense to separate these for JS because the target affects DCE
            if self.transpiler.options.server_components && !loader.is_javascript_like() {
                let (a, b) = match target {
                    Target::Browser => (self.path_to_source_index_map(self.transpiler.options.target), self.path_to_source_index_map(Target::BakeServerComponentsSsr)),
                    Target::BakeServerComponentsSsr => (self.path_to_source_index_map(self.transpiler.options.target), self.path_to_source_index_map(Target::Browser)),
                    _ => (self.path_to_source_index_map(Target::Browser), self.path_to_source_index_map(Target::BakeServerComponentsSsr)),
                };
                // PORT NOTE: reshaped for borrowck — cannot hold two &mut to self simultaneously
                // TODO(port): split-borrow path_to_source_index_map
                a.put(entry.key_ptr.clone(), *entry.value_ptr);
                if self.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph {
                    b.put(entry.key_ptr.clone(), *entry.value_ptr);
                }
            }
        } else {
            out_source_index = Some(Index::init(*entry.value_ptr));
        }

        if let Some(source_index) = out_source_index {
            let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
            record.source_index = source_index;
        }
    }

    pub fn enqueue_file_from_dev_server_incremental_graph_invalidation(
        &mut self,
        path_slice: &[u8],
        target: options::Target,
    ) -> Result<(), Error> {
        // TODO: plugins with non-file namespaces
        let entry = self.path_to_source_index_map(target).get_or_put(path_slice);
        if entry.found_existing {
            return Ok(());
        }
        let t = self.transpiler_for_target(target);
        let result = match t.resolve_entry_point(path_slice) {
            Ok(r) => r,
            Err(_) => return Ok(()),
        };
        let mut path = result.path_pair.primary.clone();
        self.increment_scan_counter();
        let source_index = Index::source(self.graph.input_files.len());
        let loader = path.loader(&self.transpiler.options.loaders).unwrap_or(Loader::File);

        path = self.path_with_pretty_initialized(path, target)?;
        path.assert_pretty_is_valid();
        *entry.key_ptr = path.text.clone();
        *entry.value_ptr = source_index.get();
        self.graph.ast.append(JSAst::EMPTY);

        self.graph.input_files.append(Graph::InputFile {
            source: Logger::Source {
                path,
                contents: b"",
                index: source_index,
                ..Default::default()
            },
            loader,
            side_effects: result.primary_side_effects_data,
            ..Default::default()
        })?;
        let task = self.allocator().alloc(ParseTask::init(&result, source_index, self));
        task.loader = Some(loader);
        task.task.node.next = None;
        task.tree_shaking = self.linker.options.tree_shaking;
        task.known_target = target;
        task.jsx.development = match t.options.force_node_env {
            options::ForceNodeEnv::Development => true,
            options::ForceNodeEnv::Production => false,
            options::ForceNodeEnv::Unspecified => t.options.jsx.development,
        };

        // Handle onLoad plugins as entry points
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(AdditionalFile::SourceIndex(task.source_index.get()));
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            self.graph.pool.schedule(task);
        }
        Ok(())
    }

    pub fn enqueue_entry_item(
        &mut self,
        resolve: _resolver::Result,
        is_entry_point: bool,
        target: options::Target,
    ) -> Result<Option<IndexInt>, Error> {
        let mut result = resolve;
        let Some(path) = result.path() else { return Ok(None) };

        path.assert_file_path_is_absolute();
        let entry = self.path_to_source_index_map(target).get_or_put(path.text.clone());
        if entry.found_existing {
            return Ok(None);
        }
        self.increment_scan_counter();
        let source_index = Index::source(self.graph.input_files.len());

        let loader = path.loader(&self.transpiler.options.loaders).unwrap_or(Loader::File);

        *path = self.path_with_pretty_initialized(path.clone(), target)?;
        path.assert_pretty_is_valid();
        *entry.key_ptr = path.text.clone();
        *entry.value_ptr = source_index.get();
        self.graph.ast.append(JSAst::EMPTY);

        self.graph.input_files.append(Graph::InputFile {
            source: Logger::Source {
                path: path.clone(),
                contents: b"",
                index: source_index,
                ..Default::default()
            },
            loader,
            side_effects: resolve.primary_side_effects_data,
            ..Default::default()
        })?;
        let task = self.allocator().alloc(ParseTask::init(&result, source_index, self));
        task.loader = Some(loader);
        task.task.node.next = None;
        task.tree_shaking = self.linker.options.tree_shaking;
        task.is_entry_point = is_entry_point;
        task.known_target = target;
        {
            let bundler = self.transpiler_for_target(target);
            task.jsx.development = match bundler.options.force_node_env {
                options::ForceNodeEnv::Development => true,
                options::ForceNodeEnv::Production => false,
                options::ForceNodeEnv::Unspecified => bundler.options.jsx.development,
            };
        }

        // Handle onLoad plugins as entry points
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(AdditionalFile::SourceIndex(task.source_index.get()));
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            self.graph.pool.schedule(task);
        }

        self.graph.entry_points.push(source_index);

        Ok(Some(source_index.get()))
    }

    /// `heap` is not freed when `deinit`ing the BundleV2
    pub fn init(
        transpiler: &'a mut Transpiler,
        bake_options: Option<BakeOptions<'a>>,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
        cli_watch_flag: bool,
        thread_pool: Option<&mut ThreadPoolLib>,
        heap: ThreadLocalArena,
    ) -> Result<Box<BundleV2<'a>>, Error> {
        // TODO(port): arena-allocate self via bump.alloc — Box::new is wrong allocator (Zig: allocator.create(@This()) on arena)
        transpiler.env.load_tracy();

        transpiler.options.mark_builtins_as_external = transpiler.options.target.is_bun() || transpiler.options.target == Target::Node;
        transpiler.resolver.opts.mark_builtins_as_external = transpiler.options.target.is_bun() || transpiler.options.target == Target::Node;

        let heap_alloc = heap.allocator();
        let mut this = Box::new(BundleV2 {
            transpiler,
            client_transpiler: None,
            ssr_transpiler: transpiler, // TODO(port): aliasing &mut — Phase B must restructure (Zig allows ptr alias)
            framework: None,
            graph: Graph {
                pool: core::ptr::null_mut(), // set below
                heap,
                kit_referenced_server_data: false,
                kit_referenced_client_data: false,
                build_graphs: enum_map::EnumMap::default(),
                ..Default::default()
            },
            linker: LinkerContext {
                r#loop: event_loop,
                graph: LinkerGraph {
                    allocator: heap_alloc,
                    ..Default::default()
                },
                ..Default::default()
            },
            bun_watcher: None,
            plugins: None,
            completion: None,
            file_map: None,
            source_code_length: 0,
            thread_lock: bun_core::safety::ThreadLock::init_locked(),
            resolve_tasks_waiting_for_import_source_index: ArrayHashMap::new(),
            free_list: Vec::new(),
            unique_key: 0,
            dynamic_import_entry_points: ArrayHashMap::new(),
            has_on_parse_plugins: false,
            finalizers: Vec::new(),
            drain_defer_task: DeferredBatchTask::default(),
            asynchronous: false,
            has_any_top_level_await_modules: false,
            requested_exports: ArrayHashMap::new(),
        });
        if let Some(bo) = bake_options {
            this.client_transpiler = Some(bo.client_transpiler);
            this.ssr_transpiler = bo.ssr_transpiler;
            this.framework = Some(bo.framework);
            this.linker.framework = this.framework.as_ref();
            this.plugins = bo.plugins;
            if this.transpiler.options.server_components {
                debug_assert!(this.client_transpiler.as_ref().unwrap().options.server_components);
                if bo.framework.server_components.as_ref().unwrap().separate_ssr_graph {
                    debug_assert!(this.ssr_transpiler.options.server_components);
                }
            }
        }
        this.transpiler.allocator = heap_alloc;
        this.transpiler.resolver.allocator = heap_alloc;
        this.transpiler.linker.allocator = heap_alloc;
        this.transpiler.log.msgs_allocator = heap_alloc; // TODO(port): msgs.allocator
        this.transpiler.log.clone_line_text = true;

        // We don't expose an option to disable this. Bake forbids tree-shaking
        // since every export must is always exist in case a future module
        // starts depending on it.
        if this.transpiler.options.output_format == options::OutputFormat::InternalBakeDev {
            this.transpiler.options.tree_shaking = false;
            this.transpiler.resolver.opts.tree_shaking = false;
        } else {
            this.transpiler.options.tree_shaking = true;
            this.transpiler.resolver.opts.tree_shaking = true;
        }

        this.linker.resolver = &mut this.transpiler.resolver;
        this.linker.graph.code_splitting = this.transpiler.options.code_splitting;

        this.linker.options.minify_syntax = this.transpiler.options.minify_syntax;
        this.linker.options.minify_identifiers = this.transpiler.options.minify_identifiers;
        this.linker.options.minify_whitespace = this.transpiler.options.minify_whitespace;
        this.linker.options.emit_dce_annotations = this.transpiler.options.emit_dce_annotations;
        this.linker.options.ignore_dce_annotations = this.transpiler.options.ignore_dce_annotations;
        this.linker.options.banner = this.transpiler.options.banner.clone();
        this.linker.options.footer = this.transpiler.options.footer.clone();
        this.linker.options.css_chunking = this.transpiler.options.css_chunking;
        this.linker.options.compile_to_standalone_html = this.transpiler.options.compile_to_standalone_html;
        this.linker.options.source_maps = this.transpiler.options.source_map;
        this.linker.options.tree_shaking = this.transpiler.options.tree_shaking;
        this.linker.options.public_path = this.transpiler.options.public_path.clone();
        this.linker.options.target = this.transpiler.options.target;
        this.linker.options.output_format = this.transpiler.options.output_format;
        this.linker.options.generate_bytecode_cache = this.transpiler.options.bytecode;
        this.linker.options.compile = this.transpiler.options.compile;
        this.linker.options.metafile = this.transpiler.options.metafile;
        this.linker.options.metafile_json_path = this.transpiler.options.metafile_json_path.clone();
        this.linker.options.metafile_markdown_path = this.transpiler.options.metafile_markdown_path.clone();

        this.linker.dev_server = this.transpiler.options.dev_server;

        let pool = this.allocator().alloc(ThreadPool::default()); // TODO(port): allocator.create
        if cli_watch_flag {
            Watcher::enable_hot_module_reloading(&mut *this, None);
        }
        // errdefer pool.destroy();
        // TODO(port): errdefer this.graph.heap.deinit() — Drop handles arena teardown

        *pool = ThreadPool::init(&mut *this, thread_pool)?;
        this.graph.pool = pool;
        pool.start();
        Ok(this)
    }

    pub fn allocator(&self) -> &bun_alloc::Arena {
        self.graph.heap.allocator()
    }

    pub fn increment_scan_counter(&mut self) {
        self.thread_lock.assert_locked();
        self.graph.pending_items += 1;
        bun_output::scoped_log!(scan_counter, ".pending_items + 1 = {}", self.graph.pending_items);
    }

    pub fn decrement_scan_counter(&mut self) {
        self.thread_lock.assert_locked();
        self.graph.pending_items -= 1;
        bun_output::scoped_log!(scan_counter, ".pending_items - 1 = {}", self.graph.pending_items);
        self.on_after_decrement_scan_counter();
    }

    pub fn on_after_decrement_scan_counter(&mut self) {
        if self.asynchronous && self.is_done() {
            let dev = self.transpiler.options.dev_server
                .unwrap_or_else(|| panic!("No dev server attached in asynchronous bundle job"));
            self.finish_from_bake_dev_server(dev).expect("oom");
        }
    }

    // PORT NOTE: split because data type varies by variant — cannot express `switch(variant)`-typed param with const-generic enum on stable
    // TODO(port): comptime variant enum param + dependent data type — split into three monomorphic fns
    pub fn enqueue_entry_points_normal(&mut self, data: &[&[u8]]) -> Result<(), Error> {
        self.enqueue_entry_points_common()?;
        // (variant != .dev_server)
        self.reserve_source_indexes_for_bake()?;

        // Setup entry points
        let num_entry_points = data.len();
        self.graph.entry_points.reserve(num_entry_points);
        self.graph.input_files.ensure_unused_capacity(num_entry_points)?;

        for entry_point in data {
            if self.enqueue_entry_point_on_resolve_plugin_if_needed(entry_point, self.transpiler.options.target) {
                continue;
            }

            // Check FileMap first for in-memory entry points
            if let Some(file_map) = self.file_map {
                if let Some(file_map_result) = file_map.resolve(b"", entry_point) {
                    let _ = self.enqueue_entry_item(file_map_result, true, self.transpiler.options.target)?;
                    continue;
                }
            }

            // no plugins were matched
            let resolved = match self.transpiler.resolve_entry_point(entry_point) {
                Ok(r) => r,
                Err(_) => continue,
            };

            let target = 'brk: {
                let main_target = self.transpiler.options.target;
                if main_target.is_server_side() {
                    if let Some(path) = resolved.path_const() {
                        if let Some(loader) = path.loader(&self.transpiler.options.loaders) {
                            if loader == Loader::Html {
                                self.ensure_client_transpiler();
                                break 'brk Target::Browser;
                            }
                        }
                    }
                }
                break 'brk main_target;
            };
            let _ = self.enqueue_entry_item(resolved, true, target)?;
        }
        Ok(())
    }

    pub fn enqueue_entry_points_dev_server(
        &mut self,
        files: bake::DevServer::EntryPointList,
        css_data: &mut ArrayHashMap<Index, CssEntryPointMeta>,
    ) -> Result<(), Error> {
        self.enqueue_entry_points_common()?;
        debug_assert!(self.transpiler.options.dev_server.is_some());

        let num_entry_points = files.set.count();
        self.graph.entry_points.reserve(num_entry_points);
        self.graph.input_files.ensure_unused_capacity(num_entry_points)?;

        debug_assert_eq!(files.set.keys().len(), files.set.values().len());
        for (abs_path, flags) in files.set.keys().iter().zip(files.set.values().iter()) {
            // Ensure we have the proper conditions set for client-side entrypoints.
            let transpiler = if flags.client && !flags.server && !flags.ssr {
                self.transpiler_for_target(Target::Browser)
            } else {
                &mut *self.transpiler
            };

            struct TargetCheck { should_dispatch: bool, target: options::Target }
            let targets_to_check = [
                TargetCheck { should_dispatch: flags.client, target: Target::Browser },
                TargetCheck { should_dispatch: flags.server, target: self.transpiler.options.target },
                TargetCheck { should_dispatch: flags.ssr, target: Target::BakeServerComponentsSsr },
            ];

            let mut any_plugin_matched = false;
            for target_info in &targets_to_check {
                if target_info.should_dispatch {
                    if self.enqueue_entry_point_on_resolve_plugin_if_needed(abs_path, target_info.target) {
                        any_plugin_matched = true;
                    }
                }
            }

            if any_plugin_matched {
                continue;
            }

            // Fall back to normal resolution if no plugins matched
            let resolved = match transpiler.resolve_entry_point(abs_path) {
                Ok(r) => r,
                Err(err) => {
                    let dev = self.transpiler.options.dev_server.expect("unreachable");
                    dev.handle_parse_task_failure(
                        err,
                        if flags.client { bake::Graph::Client } else { bake::Graph::Server },
                        abs_path,
                        transpiler.log,
                        self,
                    ).expect("oom");
                    transpiler.log.reset();
                    continue;
                }
            };

            if flags.client {
                'brk: {
                    let Some(source_index) = self.enqueue_entry_item(resolved.clone(), true, Target::Browser)? else { break 'brk };
                    if flags.css {
                        css_data.put_no_clobber(Index::init(source_index), CssEntryPointMeta { imported_on_server: false })?;
                    }
                }
            }
            if flags.server { let _ = self.enqueue_entry_item(resolved.clone(), true, self.transpiler.options.target)?; }
            if flags.ssr { let _ = self.enqueue_entry_item(resolved, true, Target::BakeServerComponentsSsr)?; }
        }
        Ok(())
    }

    pub fn enqueue_entry_points_bake_production(
        &mut self,
        data: bake::production::EntryPointMap,
    ) -> Result<(), Error> {
        self.enqueue_entry_points_common()?;
        self.reserve_source_indexes_for_bake()?;

        let num_entry_points = data.files.count();
        self.graph.entry_points.reserve(num_entry_points);
        self.graph.input_files.ensure_unused_capacity(num_entry_points)?;

        for key in data.files.keys() {
            let abs_path = key.abs_path();
            let target = match key.side {
                bake::Side::Client => Target::Browser,
                bake::Side::Server => self.transpiler.options.target,
            };

            if self.enqueue_entry_point_on_resolve_plugin_if_needed(abs_path, target) {
                continue;
            }

            // no plugins matched
            let resolved = match self.transpiler.resolve_entry_point(abs_path) {
                Ok(r) => r,
                Err(_) => continue,
            };

            // TODO: wrap client files so the exports arent preserved.
            let Some(_) = self.enqueue_entry_item(resolved, true, target)? else { continue };
        }
        Ok(())
    }

    /// Common prelude shared by all enqueue_entry_points_* variants: add the runtime task.
    fn enqueue_entry_points_common(&mut self) -> Result<(), Error> {
        // Add the runtime
        let rt = ParseTask::get_runtime_source(self.transpiler.options.target);
        self.graph.input_files.append(Graph::InputFile {
            source: rt.source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        })?;

        // try this.graph.entry_points.append(allocator, Index.runtime);
        self.graph.ast.append(JSAst::EMPTY);
        self.path_to_source_index_map(self.transpiler.options.target).put(b"bun:wrap".into(), Index::RUNTIME.get());
        let runtime_parse_task = self.allocator().alloc(rt.parse_task);
        runtime_parse_task.ctx = self;
        runtime_parse_task.tree_shaking = true;
        runtime_parse_task.loader = Some(Loader::Js);
        self.increment_scan_counter();
        self.graph.pool.schedule(runtime_parse_task);
        Ok(())
    }

    fn clone_ast(&mut self) -> Result<(), Error> {
        let _trace = bun_core::perf::trace("Bundler.cloneAST");
        // TODO(port): bun.safety.alloc.assertEq
        self.linker.graph.ast = self.graph.ast.clone()?;

        for module_scope in self.linker.graph.ast.items_module_scope_mut() {
            for child in module_scope.children.slice_mut() {
                child.parent = module_scope;
            }

            if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
                self.graph.heap.help_catch_memory_issues();
            }

            module_scope.generated = module_scope.generated.clone()?;
        }

        // Some parts of the AST are owned by worker allocators at this point.
        // Transfer ownership to the graph heap.
        self.linker.graph.take_ast_ownership();
        Ok(())
    }

    /// This generates the two asts for 'bun:bake/client' and 'bun:bake/server'. Both are generated
    /// at the same time in one pass over the SCB list.
    pub fn process_server_component_manifest_files(&mut self) -> Result<(), AllocError> {
        // If a server components is not configured, do nothing
        let Some(fw) = &self.framework else { return Ok(()) };
        let Some(sc) = &fw.server_components else { return Ok(()) };

        if !self.graph.kit_referenced_server_data && !self.graph.kit_referenced_client_data {
            return Ok(());
        }

        let alloc = self.allocator();

        let mut server = AstBuilder::init(self.allocator(), &bake::SERVER_VIRTUAL_SOURCE, self.transpiler.options.hot_module_reloading)?;
        let mut client = AstBuilder::init(self.allocator(), &bake::CLIENT_VIRTUAL_SOURCE, self.transpiler.options.hot_module_reloading)?;

        let mut server_manifest_props: Vec<G::Property> = Vec::new();
        let mut client_manifest_props: Vec<G::Property> = Vec::new();

        let scbs = self.graph.server_component_boundaries.list.slice();
        let named_exports_array = self.graph.ast.items_named_exports();

        let id_string = server.new_expr(E::String { data: b"id" });
        let name_string = server.new_expr(E::String { data: b"name" });
        let chunks_string = server.new_expr(E::String { data: b"chunks" });
        let specifier_string = server.new_expr(E::String { data: b"specifier" });
        let empty_array = server.new_expr(E::Array::default());

        for ((r#use, source_id), ssr_index) in scbs.items_use_directive().iter()
            .zip(scbs.items_source_index().iter())
            .zip(scbs.items_ssr_source_index().iter())
        {
            if *r#use == UseDirective::Client {
                // TODO(@paperclover/bake): this file is being generated far too
                // early. we don't know which exports are dead and which exports
                // are live. Tree-shaking figures that out. However,
                // tree-shaking happens after import binding, which would
                // require this ast.
                //
                // The plan: change this to generate a stub ast which only has
                // `export const serverManifest = undefined;`, and then
                // re-generate this file later with the properly decided
                // manifest. However, I will probably reconsider how this
                // manifest is being generated when I write the whole
                // "production build" part of Bake.

                let keys = named_exports_array[*source_id as usize].keys();
                let mut client_manifest_items = vec![G::Property::default(); keys.len()].into_boxed_slice();

                if !sc.separate_ssr_graph {
                    bun_core::todo_panic!("separate_ssr_graph=false");
                }

                let client_path = server.new_expr(E::String {
                    data: alloc.alloc_fmt(format_args!("{:x}S{:08}", self.unique_key, source_id)),
                });
                let ssr_path = server.new_expr(E::String {
                    data: alloc.alloc_fmt(format_args!("{:x}S{:08}", self.unique_key, ssr_index)),
                });

                debug_assert_eq!(keys.len(), client_manifest_items.len());
                for (export_name_string, client_item) in keys.iter().zip(client_manifest_items.iter_mut()) {
                    let server_key_string = alloc.alloc_fmt(format_args!(
                        "{:x}S{:08}#{}",
                        self.unique_key, source_id, bstr::BStr::new(export_name_string)
                    ));
                    let export_name = server.new_expr(E::String { data: export_name_string });

                    // write dependencies on the underlying module, not the proxy
                    server_manifest_props.push(G::Property {
                        key: Some(server.new_expr(E::String { data: server_key_string })),
                        value: Some(server.new_expr(E::Object {
                            properties: G::Property::List::from_slice(alloc, &[
                                G::Property { key: Some(id_string), value: Some(client_path), ..Default::default() },
                                G::Property { key: Some(name_string), value: Some(export_name), ..Default::default() },
                                G::Property { key: Some(chunks_string), value: Some(empty_array), ..Default::default() },
                            ])?,
                            ..Default::default()
                        })),
                        ..Default::default()
                    });
                    *client_item = G::Property {
                        key: Some(export_name),
                        value: Some(server.new_expr(E::Object {
                            properties: G::Property::List::from_slice(alloc, &[
                                G::Property { key: Some(name_string), value: Some(export_name), ..Default::default() },
                                G::Property { key: Some(specifier_string), value: Some(ssr_path), ..Default::default() },
                            ])?,
                            ..Default::default()
                        })),
                        ..Default::default()
                    };
                }

                client_manifest_props.push(G::Property {
                    key: Some(client_path),
                    value: Some(server.new_expr(E::Object {
                        properties: G::Property::List::from_owned_slice(client_manifest_items),
                        ..Default::default()
                    })),
                    ..Default::default()
                });
            } else {
                bun_core::todo_panic!("\"use server\"");
            }
        }

        server.append_stmt(S::Local {
            kind: S::LocalKind::Const,
            decls: G::Decl::List::from_slice(alloc, &[G::Decl {
                binding: Binding::alloc(alloc, B::Identifier {
                    r#ref: server.new_symbol(Symbol::Kind::Other, b"serverManifest")?,
                }, Logger::Loc::EMPTY),
                value: Some(server.new_expr(E::Object {
                    properties: G::Property::List::move_from_list(&mut server_manifest_props),
                    ..Default::default()
                })),
            }])?,
            is_export: true,
            ..Default::default()
        })?;
        server.append_stmt(S::Local {
            kind: S::LocalKind::Const,
            decls: G::Decl::List::from_slice(alloc, &[G::Decl {
                binding: Binding::alloc(alloc, B::Identifier {
                    r#ref: server.new_symbol(Symbol::Kind::Other, b"ssrManifest")?,
                }, Logger::Loc::EMPTY),
                value: Some(server.new_expr(E::Object {
                    properties: G::Property::List::move_from_list(&mut client_manifest_props),
                    ..Default::default()
                })),
            }])?,
            is_export: true,
            ..Default::default()
        })?;

        self.graph.ast.set(Index::BAKE_SERVER_DATA.get(), server.to_bundled_ast(Target::Bun)?);
        self.graph.ast.set(Index::BAKE_CLIENT_DATA.get(), client.to_bundled_ast(Target::Browser)?);
        Ok(())
    }

    pub fn enqueue_parse_task(
        &mut self,
        resolve_result: &_resolver::Result,
        source: &Logger::Source,
        loader: Loader,
        known_target: options::Target,
    ) -> Result<IndexInt, AllocError> {
        let source_index = Index::init(u32::try_from(self.graph.ast.len()).unwrap());
        self.graph.ast.append(JSAst::EMPTY);

        self.graph.input_files.append(Graph::InputFile {
            source: source.clone(),
            loader,
            side_effects: loader.side_effects(),
            ..Default::default()
        })?;
        let task = self.allocator().alloc(ParseTask::init(resolve_result, source_index, self));
        task.loader = Some(loader);
        task.jsx = self.transpiler_for_target(known_target).options.jsx.clone();
        task.task.node.next = None;
        task.io_task.node.next = None;
        task.tree_shaking = self.linker.options.tree_shaking;
        task.known_target = known_target;

        self.increment_scan_counter();

        // Handle onLoad plugins
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(AdditionalFile::SourceIndex(task.source_index.get()));
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            self.graph.pool.schedule(task);
        }

        Ok(source_index.get())
    }

    pub fn enqueue_parse_task2(
        &mut self,
        source: &Logger::Source,
        loader: Loader,
        known_target: options::Target,
    ) -> Result<IndexInt, AllocError> {
        let source_index = Index::init(u32::try_from(self.graph.ast.len()).unwrap());
        self.graph.ast.append(JSAst::EMPTY);

        self.graph.input_files.append(Graph::InputFile {
            source: source.clone(),
            loader,
            side_effects: loader.side_effects(),
            ..Default::default()
        })?;
        let task = self.allocator().alloc(ParseTask {
            ctx: self,
            path: source.path.clone(),
            contents_or_fd: ParseTask::ContentsOrFd::Contents(source.contents),
            side_effects: _resolver::SideEffects::HasSideEffects,
            jsx: if known_target == Target::BakeServerComponentsSsr
                && !self.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph
            {
                self.transpiler.options.jsx.clone()
            } else {
                self.transpiler_for_target(known_target).options.jsx.clone()
            },
            source_index,
            module_type: options::ModuleType::Unknown,
            emit_decorator_metadata: false, // TODO
            package_version: b"",
            loader: Some(loader),
            tree_shaking: self.linker.options.tree_shaking,
            known_target,
            ..Default::default()
        });
        task.task.node.next = None;
        task.io_task.node.next = None;

        self.increment_scan_counter();

        // Handle onLoad plugins
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(AdditionalFile::SourceIndex(task.source_index.get()));
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            self.graph.pool.schedule(task);
        }
        Ok(source_index.get())
    }

    /// Enqueue a ServerComponentParseTask.
    /// `source_without_index` is copied and assigned a new source index. That index is returned.
    pub fn enqueue_server_component_generated_file(
        &mut self,
        data: ServerComponentParseTask::Data,
        source_without_index: Logger::Source,
    ) -> Result<IndexInt, AllocError> {
        let mut new_source = source_without_index;
        let source_index = self.graph.input_files.len();
        new_source.index = Index::init(source_index);
        self.graph.input_files.append(Graph::InputFile {
            source: new_source.clone(),
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::HasSideEffects,
            ..Default::default()
        })?;
        self.graph.ast.append(JSAst::EMPTY);

        let task = Box::new(ServerComponentParseTask {
            data,
            ctx: self,
            source: new_source,
            ..Default::default()
        });

        self.increment_scan_counter();

        self.graph.pool.worker_pool.schedule(ThreadPoolLib::Batch::from(&task.task));

        Ok(u32::try_from(source_index).unwrap())
    }
}

pub struct DependenciesScanner {
    pub ctx: *mut (),
    pub entry_points: Box<[Box<[u8]>]>,
    pub on_fetch: fn(ctx: *mut (), result: &mut DependenciesScannerResult) -> Result<(), Error>,
}

pub struct DependenciesScannerResult<'a> {
    pub dependencies: bun_collections::StringSet,
    pub reachable_files: &'a [Index],
    pub bundle_v2: &'a mut BundleV2<'a>,
}

impl<'a> BundleV2<'a> {
    pub fn get_all_dependencies(&mut self, reachable_files: &[Index], fetcher: &DependenciesScanner) -> Result<(), Error> {
        // Find all external dependencies from reachable files
        let mut external_deps = bun_collections::StringSet::new();

        let import_records = self.graph.ast.items_import_records();

        for source_index in reachable_files {
            let records: &[ImportRecord] = import_records[source_index.get() as usize].slice();
            for record in records {
                if !record.source_index.is_valid() && record.tag == ImportRecord::Tag::None {
                    let path = &record.path.text;
                    // External dependency
                    if !path.is_empty()
                        // Check for either node or bun builtins
                        // We don't use the list from .bun because that includes third-party packages in some cases.
                        && !jsc::ModuleLoader::HardcodedModule::Alias::has(path, Target::Node, Default::default())
                        && !path.starts_with(b"bun:")
                        && path != b"bun"
                    {
                        if strings::is_npm_package_name_ignore_length(path) {
                            external_deps.insert(path)?;
                        }
                    }
                }
            }
        }
        let mut result = DependenciesScannerResult {
            dependencies: external_deps,
            bundle_v2: self,
            reachable_files,
        };
        (fetcher.on_fetch)(fetcher.ctx, &mut result)
    }

    pub fn generate_from_cli(
        transpiler: &'a mut Transpiler,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
        enable_reloading: bool,
        reachable_files_count: &mut usize,
        minify_duration: &mut u64,
        source_code_size: &mut u64,
        fetcher: Option<&DependenciesScanner>,
    ) -> Result<BuildResult, Error> {
        let mut this = BundleV2::init(
            transpiler,
            None,
            alloc,
            event_loop,
            enable_reloading,
            None,
            ThreadLocalArena::init(),
        )?;
        this.unique_key = generate_unique_key();

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.enqueue_entry_points_normal(&this.transpiler.options.entry_points)?;

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.wait_for_parse();

        *minify_duration = (((bun_core::time::nano_timestamp() as i64) - (bun_core::cli::START_TIME as i64)) / (bun_core::time::NS_PER_MS as i64)) as u64;
        *source_code_size = this.source_code_length as u64;

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.scan_for_secondary_paths();

        this.process_server_component_manifest_files()?;

        let reachable_files = this.find_reachable_files()?;
        *reachable_files_count = reachable_files.len().saturating_sub(1); // - 1 for the runtime

        this.process_files_to_copy(&reachable_files)?;

        this.add_server_component_boundaries_as_extra_entry_points()?;

        this.clone_ast()?;

        let chunks = this.linker.link(
            &mut *this,
            &this.graph.entry_points,
            &this.graph.server_component_boundaries,
            &reachable_files,
        )?;

        // Do this at the very end, after processing all the imports/exports so that we can follow exports as needed.
        if let Some(fetch) = fetcher {
            this.get_all_dependencies(&reachable_files, fetch)?;
            return Ok(BuildResult {
                output_files: Vec::new(),
                metafile: None,
                metafile_markdown: None,
            });
        }

        let output_files = this.linker.generate_chunks_in_parallel(chunks, false)?;

        // Generate metafile if requested (CLI writes files in build_command.zig)
        let metafile: Option<Box<[u8]>> = if this.linker.options.metafile {
            match LinkerContext::MetafileBuilder::generate(&mut this.linker, chunks) {
                Ok(m) => Some(m),
                Err(err) => {
                    Output::warn(format_args!("Failed to generate metafile: {}", err.name()));
                    None
                }
            }
        } else {
            None
        };

        // Markdown is generated later in build_command.zig for CLI
        Ok(BuildResult {
            output_files,
            metafile,
            metafile_markdown: None,
        })
    }

    /// Build only the parse graph for the given entry points and return the
    /// BundleV2 instance. No linking or code generation is performed; this is
    /// used by `bun test --changed` to walk import records and compute which
    /// test entry points transitively depend on a given set of source files.
    ///
    /// The returned BundleV2, its ThreadLocalArena, and its worker pool are
    /// intentionally left alive for the remainder of the process. Tearing
    /// the pool down via `deinitWithoutFreeingArena()` blocks on worker
    /// shutdown and contends with the runtime VM's own parse threads; the
    /// sole caller exec()s (watch mode) or exits shortly after, so the leak
    /// is bounded. Dupe anything you need out of the graph before returning
    /// to the caller.
    pub fn scan_module_graph_from_cli(
        transpiler: &'a mut Transpiler,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
        entry_points: &[&[u8]],
    ) -> Result<Box<BundleV2<'a>>, Error> {
        let mut this = BundleV2::init(
            transpiler,
            None,
            alloc,
            event_loop,
            false,
            None,
            ThreadLocalArena::init(),
        )?;
        this.unique_key = generate_unique_key();

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        // enqueueEntryPoints schedules the runtime task before any fallible
        // allocation. If a later allocation fails we must still drain the
        // pool so workers aren't left holding pointers into the caller's
        // stack-allocated Transpiler.
        if let Err(err) = this.enqueue_entry_points_normal(entry_points) {
            this.wait_for_parse();
            return Err(err);
        }

        // Even if entry point resolution produced errors we still wait for
        // all enqueued parse tasks to finish so the graph is consistent.
        this.wait_for_parse();

        Ok(this)
    }

    pub fn generate_from_bake_production_cli(
        entry_points: bake::production::EntryPointMap,
        server_transpiler: &'a mut Transpiler,
        bake_options: BakeOptions<'a>,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
    ) -> Result<Vec<options::OutputFile>, Error> {
        let mut this = BundleV2::init(
            server_transpiler,
            Some(bake_options),
            alloc,
            event_loop,
            false,
            None,
            ThreadLocalArena::init(),
        )?;
        this.unique_key = generate_unique_key();

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.enqueue_entry_points_bake_production(entry_points)?;

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.wait_for_parse();

        if this.transpiler.log.has_errors() {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.scan_for_secondary_paths();

        this.process_server_component_manifest_files()?;

        let reachable_files = this.find_reachable_files()?;

        this.process_files_to_copy(&reachable_files)?;

        this.add_server_component_boundaries_as_extra_entry_points()?;

        this.clone_ast()?;

        let chunks = this.linker.link(
            &mut *this,
            &this.graph.entry_points,
            &this.graph.server_component_boundaries,
            &reachable_files,
        )?;

        if chunks.is_empty() {
            return Ok(Vec::new());
        }

        this.linker.generate_chunks_in_parallel(chunks, false)
    }

    pub fn add_server_component_boundaries_as_extra_entry_points(&mut self) -> Result<(), Error> {
        // Prepare server component boundaries. Each boundary turns into two
        // entry points, a client entrypoint and a server entrypoint.
        //
        // TODO: This should be able to group components by the user specified
        // entry points. This way, using two component files in a route does not
        // create two separate chunks. (note: bake passes each route as an entrypoint)
        {
            let scbs = self.graph.server_component_boundaries.slice();
            self.graph.entry_points.reserve(scbs.list.len() * 2);
            debug_assert_eq!(scbs.list.items_source_index().len(), scbs.list.items_ssr_source_index().len());
            for (original_index, ssr_index) in scbs.list.items_source_index().iter().zip(scbs.list.items_ssr_source_index().iter()) {
                for idx in [*original_index, *ssr_index] {
                    self.graph.entry_points.push(Index::init(idx)); // PERF(port): was assume_capacity
                }
            }
        }
        Ok(())
    }

    pub fn process_files_to_copy(&mut self, reachable_files: &[Index]) -> Result<(), Error> {
        if self.graph.estimated_file_loader_count > 0 {
            let file_allocators = self.graph.input_files.items_allocator();
            let unique_key_for_additional_files = self.graph.input_files.items_unique_key_for_additional_file();
            let content_hashes_for_additional_files = self.graph.input_files.items_content_hash_for_additional_file();
            let sources = self.graph.input_files.items_source();
            let targets = self.graph.ast.items_target();
            let mut additional_output_files: Vec<options::OutputFile> = Vec::new();

            let additional_files = self.graph.input_files.items_additional_files_mut();
            let loaders = self.graph.input_files.items_loader();

            for reachable_source in reachable_files {
                let index = reachable_source.get() as usize;
                let key = unique_key_for_additional_files[index];
                if !key.is_empty() {
                    let mut template = if !self.graph.html_imports.server_source_indices.is_empty()
                        && self.transpiler.options.asset_naming.is_empty()
                    {
                        PathTemplate::ASSET_WITH_TARGET
                    } else {
                        PathTemplate::ASSET
                    };

                    let target = targets[index];
                    let asset_naming = self.transpiler_for_target(target).options.asset_naming;
                    if !asset_naming.is_empty() {
                        template.data = asset_naming;
                    }

                    let source = &sources[index];

                    let output_path = 'brk: {
                        let mut pathname = source.path.name.clone();

                        // TODO: outbase
                        pathname = Fs::PathName::init(bun_paths::relative_platform(
                            &self.transpiler.options.root_dir,
                            &source.path.text,
                            bun_paths::Platform::Loose,
                            false,
                        ));

                        template.placeholder.name = pathname.base;
                        template.placeholder.dir = pathname.dir;
                        template.placeholder.ext = pathname.ext;
                        if !template.placeholder.ext.is_empty() && template.placeholder.ext[0] == b'.' {
                            template.placeholder.ext = &template.placeholder.ext[1..];
                        }

                        if template.needs(PathTemplate::Field::Hash) {
                            template.placeholder.hash = Some(content_hashes_for_additional_files[index]);
                        }

                        if template.needs(PathTemplate::Field::Target) {
                            template.placeholder.target = <&'static str>::from(target).as_bytes();
                        }
                        break 'brk {
                            let mut v = Vec::new();
                            write!(&mut v, "{}", template).expect("oom");
                            v.into_boxed_slice()
                        };
                    };

                    let loader = loaders[index];

                    additional_output_files.push(options::OutputFile::init(options::OutputFileInit {
                        source_index: Some(Index::init(index as u32)),
                        data: options::OutputFileData::Buffer {
                            data: source.contents,
                            allocator: file_allocators[index],
                        },
                        size: source.contents.len(),
                        output_path,
                        input_path: Box::<[u8]>::from(source.path.text.as_ref()),
                        input_loader: Loader::File,
                        output_kind: jsc::api::BuildArtifact::OutputKind::Asset,
                        loader,
                        hash: Some(content_hashes_for_additional_files[index]),
                        side: Some(bake::Side::Client),
                        entry_point_index: None,
                        is_executable: false,
                        ..Default::default()
                    }));
                    additional_files[index].append(AdditionalFile::OutputFile((additional_output_files.len() - 1) as u32));
                }
            }

            self.graph.additional_output_files = additional_output_files;
        }
        Ok(())
    }

    pub fn on_load_async(&mut self, load: &mut jsc::api::JSBundler::Load) {
        match self.r#loop() {
            EventLoop::Js(jsc_event_loop) => {
                jsc_event_loop.enqueue_task_concurrent(jsc::ConcurrentTask::from_callback(load, on_load_from_js_loop));
            }
            EventLoop::Mini(mini) => {
                mini.enqueue_task_concurrent_with_extra_ctx::<jsc::api::JSBundler::Load, BundleV2>(
                    load,
                    Self::on_load,
                    // TODO(port): .task field selector
                );
            }
        }
    }

    pub fn on_resolve_async(&mut self, resolve: &mut jsc::api::JSBundler::Resolve) {
        match self.r#loop() {
            EventLoop::Js(jsc_event_loop) => {
                jsc_event_loop.enqueue_task_concurrent(jsc::ConcurrentTask::from_callback(resolve, on_resolve_from_js_loop));
            }
            EventLoop::Mini(mini) => {
                mini.enqueue_task_concurrent_with_extra_ctx::<jsc::api::JSBundler::Resolve, BundleV2>(
                    resolve,
                    Self::on_resolve,
                    // TODO(port): .task field selector
                );
            }
        }
    }
}

pub fn on_load_from_js_loop(load: &mut jsc::api::JSBundler::Load) {
    BundleV2::on_load(load, load.bv2);
}

impl<'a> BundleV2<'a> {
    pub fn on_load(load: &mut jsc::api::JSBundler::Load, this: &mut BundleV2) {
        bun_output::scoped_log!(Bundle, "onLoad: ({}, {})", load.source_index.get(), <&'static str>::from(&load.value));
        let _guard = scopeguard::guard((), |_| {
            if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
                this.graph.heap.help_catch_memory_issues();
            }
        });
        let log = this.transpiler.log;

        // TODO: watcher

        match load.value.consume() {
            jsc::api::JSBundler::LoadValue::NoMatch => {
                let source = &this.graph.input_files.items_source()[load.source_index.get() as usize];
                // If it's a file namespace, we should run it through the parser like normal.
                // The file could be on disk.
                if source.path.is_file() {
                    this.graph.pool.schedule(load.parse_task);
                    return;
                }

                // When it's not a file, this is a build error and we should report it.
                // we have no way of loading non-files.
                let _ = log.add_error_fmt(Some(source), Logger::Loc::EMPTY, format_args!(
                    "Module not found {} in namespace {}",
                    bun_core::fmt::quote(&source.path.pretty),
                    bun_core::fmt::quote(&source.path.namespace),
                ));

                // An error occurred, prevent spinning the event loop forever
                this.decrement_scan_counter();
            }
            jsc::api::JSBundler::LoadValue::Success(code) => {
                // When a plugin returns a file loader, we always need to populate additional_files
                let should_copy_for_bundling = code.loader.should_copy_for_bundling();
                if should_copy_for_bundling {
                    let source_index = load.source_index;
                    let additional_files: &mut BabyList<AdditionalFile> = &mut this.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                    additional_files.append(AdditionalFile::SourceIndex(source_index.get()));
                    this.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                    this.graph.estimated_file_loader_count += 1;
                }
                this.graph.input_files.items_loader_mut()[load.source_index.get() as usize] = code.loader;
                this.graph.input_files.items_source_mut()[load.source_index.get() as usize].contents = code.source_code;
                this.graph.input_files.items_flags_mut()[load.source_index.get() as usize].is_plugin_file = true;
                let parse_task = load.parse_task;
                parse_task.loader = Some(code.loader);
                if !should_copy_for_bundling {
                    this.free_list.push(code.source_code);
                }
                parse_task.contents_or_fd = ParseTask::ContentsOrFd::Contents(code.source_code);
                this.graph.pool.schedule(parse_task);

                if let Some(watcher) = this.bun_watcher {
                    'add_watchers: {
                        if !this.should_add_watcher_plugin(&load.namespace, &load.path) {
                            break 'add_watchers;
                        }

                        // TODO: support explicit watchFiles array. this is not done
                        // right now because DevServer requires a table to map
                        // watched files and dirs to their respective dependants.
                        let fd = if bun_core::Watcher::REQUIRES_FILE_DESCRIPTORS {
                            // TODO(port): toPosixPath — bun_paths nul-terminate helper
                            let Ok(posix_path) = bun_paths::to_posix_path(&load.path) else { break 'add_watchers };
                            match bun_sys::open(&posix_path, bun_core::Watcher::WATCH_OPEN_FLAGS, 0) {
                                bun_sys::Result::Ok(fd) => fd,
                                bun_sys::Result::Err(_) => break 'add_watchers,
                            }
                        } else {
                            bun_sys::Fd::INVALID
                        };

                        // SAFETY: bun_watcher NonNull is valid while bundle is running
                        let _ = unsafe { watcher.as_ref() }.add_file(
                            fd,
                            &load.path,
                            bun_core::Watcher::get_hash(&load.path),
                            code.loader,
                            bun_sys::Fd::INVALID,
                            None,
                            true,
                        );
                    }
                }
            }
            jsc::api::JSBundler::LoadValue::Err(msg) => {
                if let Some(dev) = this.transpiler.options.dev_server {
                    let source = &this.graph.input_files.items_source()[load.source_index.get() as usize];
                    // A stack-allocated Log object containing the singular message
                    let mut msg_mut = msg;
                    let temp_log = Logger::Log {
                        clone_line_text: false,
                        errors: (msg.kind == Logger::MsgKind::Err) as u32,
                        warnings: (msg.kind == Logger::MsgKind::Warn) as u32,
                        msgs: vec![msg_mut],
                        ..Default::default()
                    };
                    dev.handle_parse_task_failure(
                        bun_core::err!("Plugin"),
                        load.bake_graph(),
                        source.path.key_for_incremental_graph(),
                        &temp_log,
                        this,
                    ).expect("oom");
                } else {
                    log.msgs.push(msg);
                    log.errors += (msg.kind == Logger::MsgKind::Err) as u32;
                    log.warnings += (msg.kind == Logger::MsgKind::Warn) as u32;
                }

                // An error occurred, prevent spinning the event loop forever
                this.decrement_scan_counter();
            }
            jsc::api::JSBundler::LoadValue::Pending | jsc::api::JSBundler::LoadValue::Consumed => unreachable!(),
        }
        // load is dropped here (defer load.deinit())
    }
}

pub fn on_resolve_from_js_loop(resolve: &mut jsc::api::JSBundler::Resolve) {
    BundleV2::on_resolve(resolve, resolve.bv2);
}

impl<'a> BundleV2<'a> {
    pub fn on_resolve(resolve: &mut jsc::api::JSBundler::Resolve, this: &mut BundleV2) {
        let _dec_guard = scopeguard::guard((), |_| this.decrement_scan_counter());
        bun_output::scoped_log!(Bundle, "onResolve: ({}:{}, {})",
            bstr::BStr::new(&resolve.import_record.namespace),
            bstr::BStr::new(&resolve.import_record.specifier),
            <&'static str>::from(&resolve.value));

        let _mem_guard = scopeguard::guard((), |_| {
            if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
                this.graph.heap.help_catch_memory_issues();
            }
        });

        match resolve.value.consume() {
            jsc::api::JSBundler::ResolveValue::NoMatch => {
                // If it's a file namespace, we should run it through the resolver like normal.
                //
                // The file could be on disk.
                if resolve.import_record.namespace == b"file" {
                    if resolve.import_record.kind == ImportKind::EntryPointBuild {
                        let target = resolve.import_record.original_target;
                        let Ok(resolved) = this.transpiler_for_target(target).resolve_entry_point(&resolve.import_record.specifier) else {
                            return;
                        };
                        let Ok(source_index) = this.enqueue_entry_item(resolved, true, target) else {
                            return;
                        };

                        // Store the original entry point name for virtual entries that fall back to file resolution
                        if let Some(idx) = source_index {
                            this.graph.entry_point_original_names.put(idx, resolve.import_record.specifier.clone());
                        }
                        return;
                    }

                    this.run_resolver(resolve.import_record.clone(), resolve.import_record.original_target);
                    return;
                }

                let log = this.log_for_resolution_failures(&resolve.import_record.source_file, resolve.import_record.original_target.bake_graph());

                // When it's not a file, this is an error and we should report it.
                //
                // We have no way of loading non-files.
                if resolve.import_record.kind == ImportKind::EntryPointBuild {
                    let _ = log.add_error_fmt(None, Logger::Loc::EMPTY, format_args!(
                        "Module not found {} in namespace {}",
                        bun_core::fmt::quote(&resolve.import_record.specifier),
                        bun_core::fmt::quote(&resolve.import_record.namespace),
                    ));
                } else {
                    let source = &this.graph.input_files.items_source()[resolve.import_record.importer_source_index as usize];
                    let _ = log.add_range_error_fmt(
                        Some(source),
                        resolve.import_record.range,
                        format_args!(
                            "Module not found {} in namespace {}",
                            bun_core::fmt::quote(&resolve.import_record.specifier),
                            bun_core::fmt::quote(&resolve.import_record.namespace),
                        ),
                    );
                }
            }
            jsc::api::JSBundler::ResolveValue::Success(result) => {
                let mut out_source_index: Option<Index> = None;
                if !result.external {
                    let mut path = Fs::Path::init(result.path.clone());
                    if result.namespace.is_empty() || result.namespace == b"file" {
                        path.namespace = b"file";
                    } else {
                        path.namespace = result.namespace;
                    }

                    let existing = this.path_to_source_index_map(resolve.import_record.original_target)
                        .get_or_put_path(&path);
                    if !existing.found_existing {
                        let _ = this.free_list.extend_from_slice(&[result.namespace.clone(), result.path.clone()]);
                        path = this.path_with_pretty_initialized(path, resolve.import_record.original_target).expect("oom");
                        *existing.key_ptr = path.text.clone();

                        // We need to parse this
                        let source_index = Index::init(u32::try_from(this.graph.ast.len()).unwrap());
                        *existing.value_ptr = source_index.get();
                        out_source_index = Some(source_index);
                        this.graph.ast.append(JSAst::EMPTY);
                        let loader = path.loader(&this.transpiler.options.loaders).unwrap_or(Loader::File);

                        this.graph.input_files.append(Graph::InputFile {
                            source: Logger::Source {
                                path: path.clone(),
                                contents: b"",
                                index: source_index,
                                ..Default::default()
                            },
                            loader,
                            side_effects: _resolver::SideEffects::HasSideEffects,
                            ..Default::default()
                        }).expect("unreachable");
                        let task = Box::new(ParseTask {
                            ctx: this,
                            path,
                            // unknown at this point:
                            contents_or_fd: ParseTask::ContentsOrFd::Fd {
                                dir: bun_sys::Fd::INVALID,
                                file: bun_sys::Fd::INVALID,
                            },
                            side_effects: _resolver::SideEffects::HasSideEffects,
                            jsx: this.transpiler_for_target(resolve.import_record.original_target).options.jsx.clone(),
                            source_index,
                            module_type: options::ModuleType::Unknown,
                            loader: Some(loader),
                            tree_shaking: this.linker.options.tree_shaking,
                            known_target: resolve.import_record.original_target,
                            ..Default::default()
                        });
                        let task = Box::leak(task); // TODO(port): owned by pool; freed via destroy()
                        task.task.node.next = None;
                        task.io_task.node.next = None;
                        this.increment_scan_counter();

                        if !this.enqueue_on_load_plugin_if_needed(task) {
                            if loader.should_copy_for_bundling() {
                                let additional_files: &mut BabyList<AdditionalFile> = &mut this.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                                additional_files.append(AdditionalFile::SourceIndex(task.source_index.get()));
                                this.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                                this.graph.estimated_file_loader_count += 1;
                            }

                            this.graph.pool.schedule(task);
                        }
                    } else {
                        out_source_index = Some(Index::init(*existing.value_ptr));
                        drop(result.namespace);
                        drop(result.path);
                    }
                } else {
                    drop(result.namespace);
                    drop(result.path);
                }

                if let Some(source_index) = out_source_index {
                    if resolve.import_record.kind == ImportKind::EntryPointBuild {
                        this.graph.entry_points.push(source_index);

                        // Store the original entry point name for virtual entries
                        // This preserves the original name for output file naming
                        this.graph.entry_point_original_names.put(source_index.get(), resolve.import_record.specifier.clone());
                    } else {
                        let source_import_records = &mut this.graph.ast.items_import_records_mut()[resolve.import_record.importer_source_index as usize];
                        if (source_import_records.len() as u32) <= resolve.import_record.import_record_index {
                            let entry = this.resolve_tasks_waiting_for_import_source_index.get_or_put(
                                resolve.import_record.importer_source_index,
                            );
                            if !entry.found_existing {
                                *entry.value_ptr = BabyList::default();
                            }
                            entry.value_ptr.append(PendingImport {
                                to_source_index: source_index,
                                import_record_index: resolve.import_record.import_record_index,
                            });
                        } else {
                            let import_record: &mut ImportRecord = &mut source_import_records.slice_mut()[resolve.import_record.import_record_index as usize];
                            import_record.source_index = source_index;
                        }
                    }
                }
            }
            jsc::api::JSBundler::ResolveValue::Err(err) => {
                let log = this.log_for_resolution_failures(&resolve.import_record.source_file, resolve.import_record.original_target.bake_graph());
                log.msgs.push(err.clone());
                log.errors += (err.kind == Logger::MsgKind::Err) as u32;
                log.warnings += (err.kind == Logger::MsgKind::Warn) as u32;
            }
            jsc::api::JSBundler::ResolveValue::Pending | jsc::api::JSBundler::ResolveValue::Consumed => unreachable!(),
        }
        // resolve is dropped here (defer resolve.deinit())
    }

    pub fn deinit_without_freeing_arena(&mut self) {
        {
            // We do this first to make it harder for any dangling pointers to data to be used in there.
            let on_parse_finalizers = core::mem::take(&mut self.finalizers);
            for finalizer in &on_parse_finalizers {
                finalizer.call();
            }
            drop(on_parse_finalizers);
        }

        // TODO(port): defer block — graph.ast/input_files/entry_points/entry_point_original_names deinit
        // In Rust these are dropped automatically; arena-backed slices are bulk-freed.

        if self.graph.pool.workers_assignments.count() > 0 {
            {
                self.graph.pool.workers_assignments_lock.lock();
                let _unlock = scopeguard::guard((), |_| self.graph.pool.workers_assignments_lock.unlock());
                for worker in self.graph.pool.workers_assignments.values() {
                    worker.deinit_soon();
                }
                self.graph.pool.workers_assignments.clear();
            }

            self.graph.pool.worker_pool.wake_for_idle_events();
        }
        self.graph.pool.deinit();

        for free in self.free_list.drain(..) {
            drop(free);
        }
    }

    pub fn run_from_js_in_new_thread(
        &mut self,
        entry_points: &[&[u8]],
    ) -> Result<BuildResult, Error> {
        self.unique_key = generate_unique_key();

        if self.transpiler.log.errors > 0 {
            return Err(bun_core::err!("BuildFailed"));
        }

        self.graph.heap.help_catch_memory_issues();

        self.enqueue_entry_points_normal(entry_points)?;

        // We must wait for all the parse tasks to complete, even if there are errors.
        self.wait_for_parse();

        self.graph.heap.help_catch_memory_issues();

        if self.transpiler.log.errors > 0 {
            return Err(bun_core::err!("BuildFailed"));
        }

        self.scan_for_secondary_paths();

        self.process_server_component_manifest_files()?;

        self.graph.heap.help_catch_memory_issues();

        self.clone_ast()?;

        self.graph.heap.help_catch_memory_issues();

        let reachable_files = self.find_reachable_files()?;

        self.process_files_to_copy(&reachable_files)?;

        self.add_server_component_boundaries_as_extra_entry_points()?;

        let chunks = self.linker.link(
            self,
            &self.graph.entry_points,
            &self.graph.server_component_boundaries,
            &reachable_files,
        )?;

        if self.transpiler.log.errors > 0 {
            return Err(bun_core::err!("BuildFailed"));
        }

        let mut output_files = self.linker.generate_chunks_in_parallel(chunks, false)?;

        // Generate metafile if requested
        let metafile: Option<Box<[u8]>> = if self.linker.options.metafile {
            match LinkerContext::MetafileBuilder::generate(&mut self.linker, chunks) {
                Ok(m) => Some(m),
                Err(err) => {
                    Output::warn(format_args!("Failed to generate metafile: {}", err.name()));
                    None
                }
            }
        } else {
            None
        };

        // Generate markdown if metafile was generated and path specified
        let metafile_markdown: Option<Box<[u8]>> = if !self.linker.options.metafile_markdown_path.is_empty() && metafile.is_some() {
            match LinkerContext::MetafileBuilder::generate_markdown(metafile.as_ref().unwrap()) {
                Ok(m) => Some(m),
                Err(err) => {
                    Output::warn(format_args!("Failed to generate metafile markdown: {}", err.name()));
                    None
                }
            }
        } else {
            None
        };

        // Write metafile outputs to disk and add them as OutputFiles.
        // Metafile paths are relative to outdir, like all other output files.
        let outdir = &self.linker.resolver.opts.output_dir;
        if !self.linker.options.metafile_json_path.is_empty() {
            if let Some(mf) = &metafile {
                write_metafile_output(&mut output_files, outdir, &self.linker.options.metafile_json_path, mf, jsc::api::BuildArtifact::OutputKind::MetafileJson)?;
            }
        }
        if !self.linker.options.metafile_markdown_path.is_empty() {
            if let Some(md) = &metafile_markdown {
                write_metafile_output(&mut output_files, outdir, &self.linker.options.metafile_markdown_path, md, jsc::api::BuildArtifact::OutputKind::MetafileMarkdown)?;
            }
        }

        Ok(BuildResult {
            output_files,
            metafile,
            metafile_markdown,
        })
    }
}

/// Writes a metafile (JSON or markdown) to disk and appends it to the output_files list.
/// Metafile paths are relative to outdir, like all other output files.
fn write_metafile_output(
    output_files: &mut Vec<options::OutputFile>,
    outdir: &[u8],
    file_path: &[u8],
    content: &[u8],
    output_kind: jsc::api::BuildArtifact::OutputKind,
) -> Result<(), Error> {
    if !outdir.is_empty() {
        // Open the output directory
        let mut root_dir = match bun_sys::Fd::cwd().make_open_path(outdir) {
            Ok(d) => d,
            Err(err) => {
                Output::warn(format_args!("Failed to open output directory '{}': {}", bstr::BStr::new(outdir), err.name()));
                return Ok(());
            }
        };
        // root_dir closed on drop

        // Create parent directories if needed (relative to outdir)
        if let Some(parent) = bun_paths::dirname(file_path, bun_paths::Platform::Auto) {
            if !parent.is_empty() {
                let _ = root_dir.make_path(parent);
            }
        }

        // Write to disk relative to outdir
        let mut path_buf = bun_paths::PathBuffer::uninit();
        let _ = jsc::node::fs::NodeFS::write_file_with_path_buffer(&mut path_buf, jsc::node::fs::WriteFileArgs {
            data: jsc::node::fs::WriteFileData::Buffer {
                buffer: jsc::node::Buffer {
                    ptr: content.as_ptr() as *mut u8,
                    len: content.len() as u32,
                    byte_len: content.len() as u32,
                },
            },
            encoding: jsc::node::Encoding::Buffer,
            mode: 0o644,
            dirfd: bun_sys::Fd::from_std_dir(&root_dir),
            file: jsc::node::fs::FileArg::Path {
                string: bun_core::PathString::init(file_path),
            },
        }).unwrap_or_else(|err| {
            Output::warn(format_args!("Failed to write metafile to '{}': {}", bstr::BStr::new(file_path), err.name()));
        });
    }

    // Add as OutputFile so it appears in result.outputs
    let is_json = output_kind == jsc::api::BuildArtifact::OutputKind::MetafileJson;
    output_files.push(options::OutputFile::init(options::OutputFileInit {
        loader: if is_json { Loader::Json } else { Loader::File },
        input_loader: if is_json { Loader::Json } else { Loader::File },
        input_path: Box::<[u8]>::from(if is_json { b"metafile.json".as_slice() } else { b"metafile.md".as_slice() }),
        output_path: Box::<[u8]>::from(file_path),
        data: options::OutputFileData::Saved(content.len()),
        output_kind,
        is_executable: false,
        side: None,
        entry_point_index: None,
        ..Default::default()
    }));
    Ok(())
}

impl<'a> BundleV2<'a> {
    fn should_add_watcher_plugin(&self, namespace: &[u8], path: &[u8]) -> bool {
        namespace == b"file"
            && bun_paths::is_absolute(path)
            && self.should_add_watcher(path)
    }

    fn should_add_watcher(&self, path: &[u8]) -> bool {
        if self.transpiler.options.dev_server.is_some() {
            strings::index_of(path, b"/node_modules/").is_none()
                && (if cfg!(windows) { strings::index_of(path, b"\\node_modules\\").is_none() } else { true })
        } else {
            true // `bun build --watch` has always watched node_modules
        }
    }

    /// Dev Server uses this instead to run a subset of the transpiler, and to run it asynchronously.
    pub fn start_from_bake_dev_server(&mut self, bake_entry_points: bake::DevServer::EntryPointList) -> Result<DevServerInput, Error> {
        self.unique_key = generate_unique_key();

        self.graph.heap.help_catch_memory_issues();

        let mut ctx = DevServerInput {
            css_entry_points: ArrayHashMap::new(),
        };
        self.enqueue_entry_points_dev_server(bake_entry_points, &mut ctx.css_entry_points)?;

        self.graph.heap.help_catch_memory_issues();

        Ok(ctx)
    }

    pub fn finish_from_bake_dev_server(&mut self, dev_server: &mut bake::DevServer) -> Result<(), AllocError> {
        let start = &mut dev_server.current_bundle.as_mut().unwrap().start_data;

        self.graph.heap.help_catch_memory_issues();

        self.clone_ast()?;

        self.graph.heap.help_catch_memory_issues();

        self.dynamic_import_entry_points = ArrayHashMap::new();
        let mut html_files: ArrayHashMap<Index, ()> = ArrayHashMap::new();

        // Separate non-failing files into two lists: JS and CSS
        let js_reachable_files: &[Index] = 'reachable_files: {
            let mut css_total_files: Vec<Index> = Vec::with_capacity(self.graph.css_file_count);
            start.css_entry_points.reserve(self.graph.css_file_count);
            let mut js_files: Vec<Index> = Vec::with_capacity(self.graph.ast.len() - self.graph.css_file_count - 1);

            let asts = self.graph.ast.slice();
            let css_asts = asts.items_css();

            let input_files = self.graph.input_files.slice();
            let loaders = input_files.items_loader();
            let sources = input_files.items_source();
            // TODO(port): multi-zip iteration over MultiArrayList slices [1..]
            for index in 1..self.graph.ast.len() {
                let part_list = &asts.items_parts()[index];
                let import_records = &asts.items_import_records()[index];
                let maybe_css = &css_asts[index];
                let target = asts.items_target()[index];
                // Dev Server proceeds even with failed files.
                // These files are filtered out via the lack of any parts.
                //
                // Actual empty files will contain a part exporting an empty object.
                if part_list.len() != 0 {
                    if maybe_css.is_some() {
                        // CSS has restrictions on what files can be imported.
                        // This means the file can become an error after
                        // resolution, which is not usually the case.
                        css_total_files.push(Index::init(u32::try_from(index).unwrap())); // PERF(port): was assume_capacity
                        let mut log = Logger::Log::init();
                        if self.linker.scan_css_imports(
                            u32::try_from(index).unwrap(),
                            import_records.slice(),
                            css_asts,
                            sources,
                            loaders,
                            &mut log,
                        ) == LinkerContext::ScanCssResult::Errors {
                            // TODO: it could be possible for a plugin to change
                            // the type of loader from whatever it was into a
                            // css-compatible loader.
                            dev_server.handle_parse_task_failure(
                                bun_core::err!("InvalidCssImport"),
                                bake::Graph::Client,
                                &sources[index].path.text,
                                &log,
                                self,
                            )?;
                            // Since there is an error, do not treat it as a
                            // valid CSS chunk.
                            let _ = start.css_entry_points.swap_remove(&Index::init(u32::try_from(index).unwrap()));
                        }
                    } else {
                        // HTML files are special cased because they correspond
                        // to routes in DevServer. They have a JS chunk too,
                        // derived off of the import record list.
                        if loaders[index] == Loader::Html {
                            html_files.put(Index::init(u32::try_from(index).unwrap()), ())?;
                        } else {
                            js_files.push(Index::init(u32::try_from(index).unwrap())); // PERF(port): was assume_capacity

                            // Mark every part live.
                            for p in part_list.slice_mut() {
                                p.is_live = true;
                            }
                        }

                        // Discover all CSS roots.
                        for record in import_records.slice_mut() {
                            if !record.source_index.is_valid() { continue; }
                            if loaders[record.source_index.get() as usize] != Loader::Css { continue; }
                            if asts.items_parts()[record.source_index.get() as usize].len() == 0 {
                                record.source_index = Index::INVALID;
                                continue;
                            }

                            let gop = start.css_entry_points.get_or_put_assume_capacity(record.source_index);
                            if target != Target::Browser {
                                *gop.value_ptr = CssEntryPointMeta { imported_on_server: true };
                            } else if !gop.found_existing {
                                *gop.value_ptr = CssEntryPointMeta { imported_on_server: false };
                            }
                        }
                    }
                } else {
                    // Treat empty CSS files for removal.
                    let _ = start.css_entry_points.swap_remove(&Index::init(u32::try_from(index).unwrap()));
                }
            }

            // Find CSS entry points. Originally, this was computed up front, but
            // failed files do not remember their loader, and plugins can
            // asynchronously decide a file is CSS.
            let css = asts.items_css();
            for entry_point in &self.graph.entry_points {
                if css[entry_point.get() as usize].is_some() {
                    start.css_entry_points.put(
                        *entry_point,
                        CssEntryPointMeta { imported_on_server: false },
                    )?;
                }
            }

            // TODO(port): leak js_files into arena — Zig returned .items
            break 'reachable_files self.allocator().alloc_slice_copy(&js_files);
        };

        self.graph.heap.help_catch_memory_issues();

        // HMR skips most of the linker! All linking errors are converted into
        // runtime errors to avoid a more complicated dependency graph. For
        // example, if you remove an exported symbol, we only rebuild the
        // changed file, then detect the missing export at runtime.
        //
        // Additionally, notice that we run this code generation even if we have
        // files that failed. This allows having a large build graph (importing
        // a new npm dependency), where one file that fails doesnt prevent the
        // passing files to get cached in the incremental graph.

        // The linker still has to be initialized as code generation expects
        // much of its state to be valid memory, even if empty.
        self.linker.load(
            self,
            &self.graph.entry_points,
            &self.graph.server_component_boundaries,
            js_reachable_files,
        )?;

        self.graph.heap.help_catch_memory_issues();

        // Compute line offset tables and quoted contents, used in source maps.
        // Quoted contents will be default-allocated
        if cfg!(debug_assertions) {
            for idx in js_reachable_files {
                debug_assert!(self.graph.ast.items_parts()[idx.get() as usize].len() != 0); // will create a memory leak
            }
        }
        // SAFETY: Index is repr(transparent) over u32
        self.linker.compute_data_for_source_map(unsafe { core::mem::transmute::<&[Index], &[IndexInt]>(js_reachable_files) });
        // TODO(port): errdefer { bun.outOfMemory() } — caller cannot recover

        self.graph.heap.help_catch_memory_issues();

        // Generate chunks
        let js_part_ranges = self.allocator().alloc_slice_fill_default::<PartRange>(js_reachable_files.len());
        let parts = self.graph.ast.items_parts();
        debug_assert_eq!(js_reachable_files.len(), js_part_ranges.len());
        for (source_index, part_range) in js_reachable_files.iter().zip(js_part_ranges.iter_mut()) {
            *part_range = PartRange {
                source_index: *source_index,
                part_index_begin: 0,
                part_index_end: parts[source_index.get() as usize].len(),
            };
        }

        let chunks = self.allocator().alloc_slice_fill_default::<Chunk>(
            1 + start.css_entry_points.count() + html_files.count(),
        );

        // First is a chunk to contain all JavaScript modules.
        chunks[0] = Chunk {
            entry_point: Chunk::EntryPoint {
                entry_point_id: 0,
                source_index: 0,
                is_entry_point: true,
            },
            content: Chunk::Content::Javascript {
                // TODO(@paperclover): remove this ptrCast when Source Index is fixed
                // SAFETY: Index is repr(transparent) over u32
                files_in_chunk_order: unsafe { core::mem::transmute(js_reachable_files) },
                parts_in_chunk_in_order: js_part_ranges,
            },
            output_source_map: SourceMap::SourceMapPieces::init(self.allocator()),
            ..Default::default()
        };

        // Then all the distinct CSS bundles (these are JS->CSS, not CSS->CSS)
        for (chunk, entry_point) in chunks[1..][..start.css_entry_points.count()].iter_mut().zip(start.css_entry_points.keys()) {
            let order = self.linker.find_imported_files_in_css_order(self.allocator(), &[*entry_point]);
            *chunk = Chunk {
                entry_point: Chunk::EntryPoint {
                    entry_point_id: u32::try_from(entry_point.get()).unwrap(),
                    source_index: entry_point.get(),
                    is_entry_point: false,
                },
                content: Chunk::Content::Css {
                    imports_in_chunk_in_order: order,
                    asts: self.allocator().alloc_slice_fill_default::<bun_css::BundlerStyleSheet>(order.len()),
                },
                output_source_map: SourceMap::SourceMapPieces::init(self.allocator()),
                ..Default::default()
            };
        }

        // Then all HTML files
        for (source_index, chunk) in html_files.keys().iter().zip(chunks[1 + start.css_entry_points.count()..].iter_mut()) {
            *chunk = Chunk {
                entry_point: Chunk::EntryPoint {
                    entry_point_id: u32::try_from(source_index.get()).unwrap(),
                    source_index: source_index.get(),
                    is_entry_point: false,
                },
                content: Chunk::Content::Html,
                output_source_map: SourceMap::SourceMapPieces::init(self.allocator()),
                ..Default::default()
            };
        }

        self.graph.heap.help_catch_memory_issues();

        self.linker.generate_chunks_in_parallel(chunks, true)?;
        // TODO(port): errdefer { bun.outOfMemory() } — caller cannot recover

        self.graph.heap.help_catch_memory_issues();

        dev_server.finalize_bundle(self, &DevServerOutput {
            chunks,
            css_file_list: core::mem::take(&mut start.css_entry_points),
            html_files,
        })
    }

    pub fn enqueue_on_resolve_plugin_if_needed(
        &mut self,
        source_index: IndexInt,
        import_record: &ImportRecord,
        source_file: &[u8],
        import_record_index: u32,
        original_target: options::Target,
    ) -> bool {
        if let Some(plugins) = self.plugins.as_deref_mut() {
            if plugins.has_any_matches(&import_record.path, false) {
                // This is where onResolve plugins are enqueued
                let resolve = Box::new(jsc::api::JSBundler::Resolve::default());
                bun_output::scoped_log!(Bundle, "enqueue onResolve: {}:{}",
                    bstr::BStr::new(&import_record.path.namespace),
                    bstr::BStr::new(&import_record.path.text));
                self.increment_scan_counter();

                let resolve = Box::leak(resolve); // TODO(port): owned by dispatch chain
                *resolve = jsc::api::JSBundler::Resolve::init(self, jsc::api::JSBundler::Resolve::MiniImportRecord {
                    kind: import_record.kind,
                    source_file: source_file.into(),
                    namespace: import_record.path.namespace.clone(),
                    specifier: import_record.path.text.clone(),
                    importer_source_index: source_index,
                    import_record_index,
                    range: import_record.range,
                    original_target,
                });

                resolve.dispatch();
                return true;
            }
        }

        false
    }

    pub fn enqueue_entry_point_on_resolve_plugin_if_needed(
        &mut self,
        entry_point: &[u8],
        target: options::Target,
    ) -> bool {
        if let Some(plugins) = self.plugins.as_deref_mut() {
            let mut temp_path = Fs::Path::init(entry_point.into());
            temp_path.namespace = b"file";
            if plugins.has_any_matches(&temp_path, false) {
                bun_output::scoped_log!(Bundle, "Entry point '{}' plugin match", bstr::BStr::new(entry_point));

                let resolve = Box::leak(Box::new(jsc::api::JSBundler::Resolve::default()));
                self.increment_scan_counter();

                *resolve = jsc::api::JSBundler::Resolve::init(self, jsc::api::JSBundler::Resolve::MiniImportRecord {
                    kind: ImportKind::EntryPointBuild,
                    source_file: b"".into(), // No importer for entry points
                    namespace: b"file".into(),
                    specifier: entry_point.into(),
                    importer_source_index: u32::MAX, // Sentinel value for entry points
                    import_record_index: 0,
                    range: Logger::Range::NONE,
                    original_target: target,
                });

                resolve.dispatch();
                return true;
            }
        }
        false
    }

    pub fn enqueue_on_load_plugin_if_needed(&mut self, parse: &mut ParseTask) -> bool {
        let had_matches = self.enqueue_on_load_plugin_if_needed_impl(parse);
        if had_matches {
            return true;
        }

        if parse.path.namespace == b"dataurl" {
            let Ok(maybe_data_url) = DataURL::parse(&parse.path.text) else { return false };
            let Some(data_url) = maybe_data_url else { return false };
            let Ok(maybe_decoded) = data_url.decode_data() else { return false };
            self.free_list.push(maybe_decoded.clone());
            parse.contents_or_fd = ParseTask::ContentsOrFd::Contents(maybe_decoded);
            parse.loader = Some(match data_url.decode_mime_type().category {
                bun_http::MimeType::Category::Javascript => Loader::Js,
                bun_http::MimeType::Category::Css => Loader::Css,
                bun_http::MimeType::Category::Json => Loader::Json,
                _ => parse.loader.unwrap_or(Loader::File),
            });
        }

        false
    }

    pub fn enqueue_on_load_plugin_if_needed_impl(&mut self, parse: &mut ParseTask) -> bool {
        if let Some(plugins) = self.plugins.as_deref_mut() {
            if plugins.has_any_matches(&parse.path, true) {
                // This is where onLoad plugins are enqueued
                bun_output::scoped_log!(Bundle, "enqueue onLoad: {}:{}",
                    bstr::BStr::new(&parse.path.namespace),
                    bstr::BStr::new(&parse.path.text));
                let load = Box::leak(Box::new(jsc::api::JSBundler::Load::init(self, parse)));
                load.dispatch();
                return true;
            }
        }

        false
    }

    fn path_with_pretty_initialized(&self, path: Fs::Path, target: options::Target) -> Result<Fs::Path, Error> {
        generic_path_with_pretty_initialized(path, target, &self.transpiler.fs.top_level_dir, self.allocator())
    }

    fn reserve_source_indexes_for_bake(&mut self) -> Result<(), Error> {
        let Some(fw) = &self.framework else { return Ok(()) };
        if fw.server_components.is_none() {
            return Ok(());
        }

        // Call this after
        debug_assert!(self.graph.input_files.len() == 1);
        debug_assert!(self.graph.ast.len() == 1);

        self.graph.ast.ensure_unused_capacity(2)?;
        self.graph.input_files.ensure_unused_capacity(2)?;

        let server_source = bake::SERVER_VIRTUAL_SOURCE;
        let client_source = bake::CLIENT_VIRTUAL_SOURCE;

        self.graph.input_files.append(Graph::InputFile {
            source: server_source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        }); // PERF(port): was assume_capacity
        self.graph.input_files.append(Graph::InputFile {
            source: client_source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        }); // PERF(port): was assume_capacity

        debug_assert!(self.graph.input_files.items_source()[Index::BAKE_SERVER_DATA.get() as usize].index.get() == Index::BAKE_SERVER_DATA.get());
        debug_assert!(self.graph.input_files.items_source()[Index::BAKE_CLIENT_DATA.get() as usize].index.get() == Index::BAKE_CLIENT_DATA.get());

        self.graph.ast.append(JSAst::EMPTY); // PERF(port): was assume_capacity
        self.graph.ast.append(JSAst::EMPTY); // PERF(port): was assume_capacity
        Ok(())
    }

    /// See barrel_imports.rs for barrel optimization implementation.
    pub use barrel_imports::apply_barrel_optimization;
    pub use barrel_imports::schedule_barrel_deferred_imports;

    /// Returns true when barrel optimization is enabled. Barrel optimization
    /// can apply to any package with sideEffects: false or listed in
    /// optimize_imports, so it is always enabled during bundling.
    fn is_barrel_optimization_enabled(&self) -> bool {
        true
    }

    // TODO: remove ResolveQueue
    //
    // Moving this to the Bundle thread was a significant perf improvement on Linux for first builds
    //
    // The problem is that module resolution has many mutexes.
    // The downside is cached resolutions are faster to do in threads since they only lock very briefly.
    fn run_resolution_for_parse_task(parse_result: &mut ParseTask::Result, this: &mut BundleV2) -> ResolveQueue {
        let result = match &mut parse_result.value {
            ParseTask::ResultValue::Success(r) => r,
            _ => unreachable!(),
        };
        // Capture these before resolveImportRecords, since on error we overwrite
        // parse_result.value (invalidating the `result` pointer).
        let source_index = result.source.index;
        let target = result.ast.target;
        let mut resolve_result = this.resolve_import_records(ResolveImportRecordCtx {
            import_records: &mut result.ast.import_records,
            source: &result.source,
            loader: result.loader,
            target,
        });

        if let Some(err) = resolve_result.last_error {
            bun_output::scoped_log!(Bundle, "failed with error: {}", err.name());
            resolve_result.resolve_queue.clear();

            // Preserve the parsed import_records on the graph so any plugin
            // onResolve tasks already dispatched for *other* records in this
            // same file can still dereference
            // `graph.ast.items(.import_records)[importer_source_index]` when
            // they complete. Without this, the graph entry stays at
            // JSAst.empty and the deferred plugin callback index-out-of-
            // bounds crashes in BundleV2.onResolve / runResolver. The linker
            // never runs because `transpiler.log.errors > 0` aborts the
            // build before link time, so saving the AST is safe.
            this.graph.ast.items_import_records_mut()[source_index.get() as usize] = result.ast.import_records.clone();

            parse_result.value = ParseTask::ResultValue::Err(ParseTask::ResultError {
                err,
                step: ParseTask::Step::Resolve,
                log: Logger::Log::init(),
                source_index,
                target,
            });
        }

        resolve_result.resolve_queue
    }
}

pub struct ResolveImportRecordCtx<'a> {
    pub import_records: &'a mut ImportRecord::List,
    pub source: &'a Logger::Source,
    pub loader: Loader,
    pub target: options::Target,
}

pub struct ResolveImportRecordResult {
    pub resolve_queue: ResolveQueue,
    pub last_error: Option<Error>,
}

impl<'a> BundleV2<'a> {
    /// Resolve all unresolved import records for a module. Skips records that
    /// are already resolved (valid source_index), unused, or internal.
    /// Returns a resolve queue of new modules to schedule, plus any fatal error.
    /// Used by both initial parse resolution and barrel un-deferral.
    pub fn resolve_import_records(&mut self, ctx: ResolveImportRecordCtx) -> ResolveImportRecordResult {
        let source = ctx.source;
        let loader = ctx.loader;
        let source_dir = source.path.source_dir();
        let mut estimated_resolve_queue_count: usize = 0;
        for import_record in ctx.import_records.slice_mut() {
            if import_record.flags.is_internal {
                import_record.tag = ImportRecord::Tag::Runtime;
                import_record.source_index = Index::RUNTIME;
            }

            // For non-dev-server builds, barrel-deferred records need their
            // source_index cleared so they don't get linked. For dev server,
            // skip this — is_unused is also set by ConvertESMExportsForHmr
            // deduplication, and clearing those source_indices breaks module
            // identity (e.g., __esModule on ESM namespace objects).
            if import_record.flags.is_unused && self.transpiler.options.dev_server.is_none() {
                import_record.source_index = Index::INVALID;
            }

            estimated_resolve_queue_count += (!(import_record.flags.is_internal || import_record.flags.is_unused || import_record.source_index.is_valid())) as usize;
        }
        let mut resolve_queue = ResolveQueue::new();
        resolve_queue.reserve(estimated_resolve_queue_count);

        let mut last_error: Option<Error> = None;

        'outer: for (i, import_record) in ctx.import_records.slice_mut().iter_mut().enumerate() {
            // Preserve original import specifier before resolution modifies path
            if import_record.original_path.is_empty() {
                import_record.original_path = import_record.path.text.clone();
            }

            if
            // Don't resolve TypeScript types
            import_record.flags.is_unused
                // Don't resolve the runtime
                || import_record.flags.is_internal
                // Don't resolve pre-resolved imports
                || import_record.source_index.is_valid()
            {
                continue;
            }

            if let Some(fw) = &self.framework {
                if fw.server_components.is_some() {
                    // PERF(port): was comptime bool dispatch — profile in Phase B
                    let is_server = ctx.target.is_server_side();
                    let src = if is_server { &bake::SERVER_VIRTUAL_SOURCE } else { &bake::CLIENT_VIRTUAL_SOURCE };
                    if import_record.path.text == src.path.pretty {
                        if self.transpiler.options.dev_server.is_some() {
                            import_record.flags.is_external_without_side_effects = true;
                            import_record.source_index = Index::INVALID;
                        } else {
                            if is_server {
                                self.graph.kit_referenced_server_data = true;
                            } else {
                                self.graph.kit_referenced_client_data = true;
                            }
                            import_record.path.namespace = b"bun";
                            import_record.source_index = src.index;
                        }
                        continue;
                    }
                }
            }

            if import_record.path.text == b"bun:wrap" {
                import_record.path.namespace = b"bun";
                import_record.tag = ImportRecord::Tag::Runtime;
                import_record.path.text = b"wrap".into();
                import_record.source_index = Index::RUNTIME;
                continue;
            }

            if ctx.target.is_bun() {
                if let Some(replacement) = jsc::ModuleLoader::HardcodedModule::Alias::get(
                    &import_record.path.text,
                    Target::Bun,
                    jsc::ModuleLoader::HardcodedModule::AliasOptions { rewrite_jest_for_tests: self.transpiler.options.rewrite_jest_for_tests },
                ) {
                    // When bundling node builtins, remove the "node:" prefix.
                    // This supports special use cases where the bundle is put
                    // into a non-node module resolver that doesn't support
                    // node's prefix. https://github.com/oven-sh/bun/issues/18545
                    import_record.path.text = if replacement.node_builtin && !replacement.node_only_prefix {
                        replacement.path[5..].into()
                    } else {
                        replacement.path.into()
                    };
                    import_record.tag = replacement.tag;
                    import_record.source_index = Index::INVALID;
                    import_record.flags.is_external_without_side_effects = true;
                    continue;
                }

                if import_record.path.text.starts_with(b"bun:") {
                    import_record.path = Fs::Path::init(import_record.path.text[b"bun:".len()..].into());
                    import_record.path.namespace = b"bun";
                    import_record.source_index = Index::INVALID;
                    import_record.flags.is_external_without_side_effects = true;

                    // don't link bun
                    continue;
                }
            }

            // By default, we treat .sqlite files as external.
            if import_record.loader == Some(Loader::Sqlite) {
                import_record.flags.is_external_without_side_effects = true;
                continue;
            }

            if import_record.loader == Some(Loader::SqliteEmbedded) {
                import_record.flags.is_external_without_side_effects = true;
            }

            if self.enqueue_on_resolve_plugin_if_needed(source.index.get(), import_record, &source.path.text, i as u32, ctx.target) {
                continue;
            }

            let (transpiler, bake_graph, target): (&mut Transpiler, bake::Graph, options::Target) =
                if import_record.tag == ImportRecord::Tag::BakeResolveToSsrGraph {
                    if self.framework.is_none() {
                        self.log_for_resolution_failures(&source.path.text, bake::Graph::Ssr).add_error_fmt(
                            Some(source),
                            import_record.range.loc,
                            format_args!("The 'bunBakeGraph' import attribute cannot be used outside of a Bun Bake bundle"),
                        ).expect("unexpected log error");
                        continue;
                    }

                    let is_supported = self.framework.as_ref().unwrap().server_components.is_some()
                        && self.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph;
                    if !is_supported {
                        self.log_for_resolution_failures(&source.path.text, bake::Graph::Ssr).add_error_fmt(
                            Some(source),
                            import_record.range.loc,
                            format_args!("Framework does not have a separate SSR graph to put this import into"),
                        ).expect("unexpected log error");
                        continue;
                    }

                    (self.ssr_transpiler, bake::Graph::Ssr, Target::BakeServerComponentsSsr)
                } else {
                    (self.transpiler_for_target(ctx.target), ctx.target.bake_graph(), ctx.target)
                };

            // Check the FileMap first for in-memory files
            if let Some(file_map) = self.file_map {
                if let Some(_file_map_result) = file_map.resolve(&source.path.text, &import_record.path.text) {
                    let mut file_map_result = _file_map_result;
                    let mut path_primary = file_map_result.path_pair.primary.clone();
                    let import_record_loader = import_record.loader.unwrap_or_else(|| {
                        Fs::Path::init(path_primary.text.clone()).loader(&transpiler.options.loaders).unwrap_or(Loader::File)
                    });
                    import_record.loader = Some(import_record_loader);

                    if let Some(id) = self.path_to_source_index_map(target).get(&path_primary.text) {
                        import_record.source_index = Index::init(id);
                        continue;
                    }

                    let resolve_entry = resolve_queue.get_or_put(path_primary.text.clone());
                    if resolve_entry.found_existing {
                        import_record.path = (*resolve_entry.value_ptr).path.clone();
                        continue;
                    }

                    // For virtual files, use the path text as-is (no relative path computation needed).
                    path_primary.pretty = self.allocator().alloc_slice_copy(&path_primary.text);
                    import_record.path = path_primary.clone();
                    *resolve_entry.key_ptr = path_primary.text.clone();
                    bun_output::scoped_log!(Bundle, "created ParseTask from FileMap: {}", bstr::BStr::new(&path_primary.text));
                    let resolve_task = Box::leak(Box::new(ParseTask::default()));
                    file_map_result.path_pair.primary = path_primary;
                    *resolve_task = ParseTask::init(&file_map_result, Index::INVALID, self);
                    resolve_task.known_target = target;
                    // Use transpiler JSX options, applying force_node_env like the disk path does
                    resolve_task.jsx = transpiler.options.jsx.clone();
                    resolve_task.jsx.development = match transpiler.options.force_node_env {
                        options::ForceNodeEnv::Development => true,
                        options::ForceNodeEnv::Production => false,
                        options::ForceNodeEnv::Unspecified => transpiler.options.jsx.development,
                    };
                    resolve_task.loader = Some(import_record_loader);
                    resolve_task.tree_shaking = transpiler.options.tree_shaking;
                    resolve_task.side_effects = _resolver::SideEffects::HasSideEffects;
                    *resolve_entry.value_ptr = resolve_task;
                    continue;
                }
            }

            let mut had_busted_dir_cache = false;
            let resolve_result: _resolver::Result = 'inner: loop {
                match transpiler.resolver.resolve_with_framework(
                    source_dir,
                    &import_record.path.text,
                    import_record.kind,
                ) {
                    Ok(r) => break r,
                    Err(err) => {
                        let log = self.log_for_resolution_failures(&source.path.text, bake_graph);

                        // Only perform directory busting when hot-reloading is enabled
                        if err == bun_core::err!("ModuleNotFound") {
                            if self.bun_watcher.is_some() {
                                if !had_busted_dir_cache {
                                    bun_output::scoped_log!(watcher, "busting dir cache {} -> {}",
                                        bstr::BStr::new(&source.path.text), bstr::BStr::new(&import_record.path.text));
                                    // Only re-query if we previously had something cached.
                                    if transpiler.resolver.bust_dir_cache_from_specifier(
                                        &source.path.text,
                                        &import_record.path.text,
                                    ) {
                                        had_busted_dir_cache = true;
                                        continue 'inner;
                                    }
                                }
                                if let Some(dev) = self.transpiler.options.dev_server {
                                    // Tell DevServer about the resolution failure.
                                    dev.directory_watchers.track_resolution_failure(
                                        &source.path.text,
                                        &import_record.path.text,
                                        ctx.target.bake_graph(), // use the source file target not the altered one
                                        loader,
                                    ).expect("oom");
                                }
                            }
                        }

                        // Disable failing packages from being printed.
                        // This may cause broken code to write.
                        // However, doing this means we tell them all the resolve errors
                        // Rather than just the first one.
                        import_record.path.is_disabled = true;

                        if err == bun_core::err!("ModuleNotFound") {
                            let add_error = Logger::Log::add_resolve_error_with_text_dupe;

                            if !import_record.flags.handles_import_errors && !self.transpiler.options.ignore_module_resolution_errors {
                                last_error = Some(err);
                                if is_package_path(&import_record.path.text) {
                                    if ctx.target == Target::Browser && options::ExternalModules::is_node_builtin(&import_record.path.text) {
                                        add_error(
                                            log, Some(source), import_record.range, self.allocator(),
                                            format_args!("Browser build cannot {} Node.js builtin: \"{}\"{}",
                                                import_record.kind.error_label(),
                                                bstr::BStr::new(&import_record.path.text),
                                                if self.transpiler.options.dev_server.is_none() {
                                                    ". To use Node.js builtins, set target to 'node' or 'bun'"
                                                } else { "" },
                                            ),
                                            import_record.kind,
                                        ).expect("oom");
                                    } else if !ctx.target.is_bun() && import_record.path.text == b"bun" {
                                        add_error(
                                            log, Some(source), import_record.range, self.allocator(),
                                            format_args!("Browser build cannot {} Bun builtin: \"{}\"{}",
                                                import_record.kind.error_label(),
                                                bstr::BStr::new(&import_record.path.text),
                                                if self.transpiler.options.dev_server.is_none() {
                                                    ". When bundling for Bun, set target to 'bun'"
                                                } else { "" },
                                            ),
                                            import_record.kind,
                                        ).expect("oom");
                                    } else if !ctx.target.is_bun() && import_record.path.text.starts_with(b"bun:") {
                                        add_error(
                                            log, Some(source), import_record.range, self.allocator(),
                                            format_args!("Browser build cannot {} Bun builtin: \"{}\"{}",
                                                import_record.kind.error_label(),
                                                bstr::BStr::new(&import_record.path.text),
                                                if self.transpiler.options.dev_server.is_none() {
                                                    ". When bundling for Bun, set target to 'bun'"
                                                } else { "" },
                                            ),
                                            import_record.kind,
                                        ).expect("oom");
                                    } else {
                                        add_error(
                                            log, Some(source), import_record.range, self.allocator(),
                                            format_args!("Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                                                bstr::BStr::new(&import_record.path.text)),
                                            import_record.kind,
                                        ).expect("oom");
                                    }
                                } else {
                                    let buf = bun_paths::path_buffer_pool().get();
                                    let specifier_to_use = if loader == Loader::Html
                                        && import_record.path.text.starts_with(&Fs::FileSystem::instance().top_level_dir)
                                    {
                                        let specifier_to_use = &import_record.path.text[Fs::FileSystem::instance().top_level_dir.len()..];
                                        #[cfg(windows)]
                                        {
                                            bun_paths::path_to_posix_buf::<u8>(specifier_to_use, &mut *buf)
                                        }
                                        #[cfg(not(windows))]
                                        {
                                            specifier_to_use
                                        }
                                    } else {
                                        &import_record.path.text
                                    };
                                    add_error(
                                        log, Some(source), import_record.range, self.allocator(),
                                        format_args!("Could not resolve: \"{}\"", bstr::BStr::new(specifier_to_use)),
                                        import_record.kind,
                                    ).expect("oom");
                                }
                            }
                        } else {
                            // assume other errors are already in the log
                            last_error = Some(err);
                        }
                        continue 'outer;
                    }
                }
            };
            let mut resolve_result = resolve_result;
            // if there were errors, lets go ahead and collect them all
            if last_error.is_some() {
                continue;
            }

            let path: &mut Fs::Path = match resolve_result.path() {
                Some(p) => p,
                None => {
                    import_record.path.is_disabled = true;
                    import_record.source_index = Index::INVALID;
                    continue;
                }
            };

            if resolve_result.flags.is_external {
                if resolve_result.flags.is_external_and_rewrite_import_path
                    && !strings::eql_long(&resolve_result.path_pair.primary.text, &import_record.path.text, true)
                {
                    import_record.path = resolve_result.path_pair.primary.clone();
                }
                import_record.flags.is_external_without_side_effects = resolve_result.primary_side_effects_data != _resolver::SideEffects::HasSideEffects;
                continue;
            }

            if let Some(dev_server) = self.transpiler.options.dev_server {
                'brk: {
                    if path.loader(&self.transpiler.options.loaders) == Some(Loader::Html)
                        && (import_record.loader.is_none() || import_record.loader.unwrap() == Loader::Html)
                    {
                        // This use case is currently not supported. This error
                        // blocks an assertion failure because the DevServer
                        // reserves the HTML file's spot in IncrementalGraph for the
                        // route definition.
                        let log = self.log_for_resolution_failures(&source.path.text, bake_graph);
                        log.add_range_error_fmt(
                            Some(source),
                            import_record.range,
                            format_args!("Browser builds cannot import HTML files."),
                        ).expect("oom");
                        continue 'outer;
                    }

                    if loader == Loader::Css {
                        // Do not use cached files for CSS.
                        break 'brk;
                    }

                    import_record.source_index = Index::INVALID;

                    if let Some(entry) = dev_server.is_file_cached(&path.text, bake_graph) {
                        let rel = bun_paths::relative_platform(&self.transpiler.fs.top_level_dir, &path.text, bun_paths::Platform::Loose, false);
                        if loader == Loader::Html && entry.kind == bake::DevServer::CacheKind::Asset {
                            // Overload `path.text` to point to the final URL
                            // This information cannot be queried while printing because a lock wouldn't get held.
                            let hash = dev_server.assets.get_hash(&path.text).expect("cached asset not found");
                            import_record.path.text = path.text.clone();
                            import_record.path.namespace = b"file";
                            import_record.path.pretty = self.allocator().alloc_fmt(format_args!(
                                concat!(bake::DevServer::ASSET_PREFIX, "/{}{}"),
                                bun_core::fmt::hex_bytes_lower(bytemuck::bytes_of(&hash)),
                                bstr::BStr::new(bun_paths::extension(&path.text)),
                            ));
                            import_record.path.is_disabled = false;
                        } else {
                            import_record.path.text = path.text.clone();
                            import_record.path.pretty = rel.into();
                            import_record.path = self.path_with_pretty_initialized(path.clone(), target).expect("oom");
                            if loader == Loader::Html || entry.kind == bake::DevServer::CacheKind::Css {
                                import_record.path.is_disabled = true;
                            }
                        }
                        continue 'outer;
                    }
                }
            }

            let import_record_loader = 'brk: {
                let resolved_loader = import_record.loader.unwrap_or_else(|| path.loader(&transpiler.options.loaders).unwrap_or(Loader::File));
                // When an HTML file references a URL asset (e.g. <link rel="manifest" href="./manifest.json" />),
                // the file must be copied to the output directory as-is. If the resolved loader would
                // parse/transform the file (e.g. .json, .toml) rather than copy it, force the .file loader
                // so that `shouldCopyForBundling()` returns true and the asset is emitted.
                // Only do this for HTML sources — CSS url() imports should retain their original behavior.
                if loader == Loader::Html && import_record.kind == ImportKind::Url
                    && !resolved_loader.should_copy_for_bundling()
                    && !resolved_loader.is_javascript_like()
                    && !resolved_loader.is_css()
                    && resolved_loader != Loader::Html
                {
                    break 'brk Loader::File;
                }
                break 'brk resolved_loader;
            };
            import_record.loader = Some(import_record_loader);

            let is_html_entrypoint = import_record_loader == Loader::Html
                && target.is_server_side()
                && self.transpiler.options.dev_server.is_none();

            if let Some(id) = self.path_to_source_index_map(target).get(&path.text) {
                if self.transpiler.options.dev_server.is_some() && loader != Loader::Html {
                    import_record.path = self.graph.input_files.items_source()[id as usize].path.clone();
                } else {
                    import_record.source_index = Index::init(id);
                }
                continue;
            }

            if is_html_entrypoint {
                import_record.kind = ImportKind::HtmlManifest;
            }

            let resolve_entry = resolve_queue.get_or_put(path.text.clone());
            if resolve_entry.found_existing {
                import_record.path = (*resolve_entry.value_ptr).path.clone();
                continue;
            }

            *path = self.path_with_pretty_initialized(path.clone(), target).expect("oom");

            import_record.path = path.clone();
            *resolve_entry.key_ptr = path.text.clone();
            bun_output::scoped_log!(Bundle, "created ParseTask: {}", bstr::BStr::new(&path.text));
            let resolve_task = Box::leak(Box::new(ParseTask::init(&resolve_result, Index::INVALID, self)));

            resolve_task.known_target = if import_record.kind == ImportKind::HtmlManifest {
                Target::Browser
            } else {
                target
            };

            resolve_task.jsx = resolve_result.jsx.clone();
            resolve_task.jsx.development = match transpiler.options.force_node_env {
                options::ForceNodeEnv::Development => true,
                options::ForceNodeEnv::Production => false,
                options::ForceNodeEnv::Unspecified => transpiler.options.jsx.development,
            };

            resolve_task.loader = Some(import_record_loader);
            resolve_task.tree_shaking = transpiler.options.tree_shaking;
            *resolve_entry.value_ptr = resolve_task;
            if let Some(secondary) = &resolve_result.path_pair.secondary {
                if !secondary.is_disabled
                    && !core::ptr::eq(secondary, path)
                    && !strings::eql_long(&secondary.text, &path.text, true)
                {
                    resolve_task.secondary_path_for_commonjs_interop = Some(secondary.dupe_alloc(self.allocator()).expect("oom"));
                }
            }

            if is_html_entrypoint {
                self.generate_server_html_module(path, target, import_record, &path.text).expect("unreachable");
            }
        }

        ResolveImportRecordResult { resolve_queue, last_error }
    }

    /// Process a resolve queue: create input file slots and schedule parse tasks.
    /// Returns the number of newly scheduled tasks (for pending_items accounting).
    pub fn process_resolve_queue(&mut self, resolve_queue: ResolveQueue, target: options::Target, importer_source_index: IndexInt) -> i32 {
        let mut diff: i32 = 0;
        let graph = &mut self.graph;
        let path_to_source_index_map = self.path_to_source_index_map(target);
        // PORT NOTE: reshaped for borrowck — iterate by drain since we own resolve_queue
        for (key, value) in resolve_queue.iter() {
            let value: *mut ParseTask = *value;
            // SAFETY: ParseTask was Box::leak'd in resolve_import_records
            let value = unsafe { &mut *value };
            let loader = value.loader.unwrap_or_else(|| value.path.loader(&self.transpiler.options.loaders).unwrap_or(Loader::File));
            let is_html_entrypoint = loader == Loader::Html && target.is_server_side() && self.transpiler.options.dev_server.is_none();
            let map: &mut PathToSourceIndexMap = if is_html_entrypoint { self.path_to_source_index_map(Target::Browser) } else { path_to_source_index_map };
            let existing = map.get_or_put(key.clone());

            if !existing.found_existing {
                let new_task: &mut ParseTask = value;
                let mut new_input_file = Graph::InputFile {
                    source: Logger::Source::init_empty_file(&new_task.path.text),
                    side_effects: new_task.side_effects,
                    secondary_path: if let Some(secondary_path) = &new_task.secondary_path_for_commonjs_interop {
                        secondary_path.text.clone()
                    } else {
                        b"".into()
                    },
                    ..Default::default()
                };

                graph.has_any_secondary_paths = graph.has_any_secondary_paths || !new_input_file.secondary_path.is_empty();

                new_input_file.source.index = Index::source(graph.input_files.len());
                new_input_file.source.path = new_task.path.clone();
                new_input_file.loader = loader;
                new_task.source_index = new_input_file.source.index;
                new_task.ctx = self;
                *existing.value_ptr = new_task.source_index.get();

                diff += 1;

                graph.input_files.append(new_input_file).expect("unreachable");
                graph.ast.append(JSAst::EMPTY);

                if is_html_entrypoint {
                    self.ensure_client_transpiler();
                    self.graph.entry_points.push(new_input_file.source.index);
                }

                if self.enqueue_on_load_plugin_if_needed(new_task) {
                    continue;
                }

                if loader.should_copy_for_bundling() {
                    let additional_files: &mut BabyList<AdditionalFile> = &mut graph.input_files.items_additional_files_mut()[importer_source_index as usize];
                    additional_files.append(AdditionalFile::SourceIndex(new_task.source_index.get()));
                    graph.input_files.items_side_effects_mut()[new_task.source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                    graph.estimated_file_loader_count += 1;
                }

                graph.pool.schedule(new_task);
            } else {
                if loader.should_copy_for_bundling() {
                    let additional_files: &mut BabyList<AdditionalFile> = &mut graph.input_files.items_additional_files_mut()[importer_source_index as usize];
                    additional_files.append(AdditionalFile::SourceIndex(*existing.value_ptr));
                    graph.estimated_file_loader_count += 1;
                }

                // SAFETY: ParseTask was Box::leak'd; reconstitute and drop
                drop(unsafe { Box::from_raw(value) });
            }
        }
        diff
    }
}

#[derive(Clone, Copy)]
pub struct PatchImportRecordsCtx<'a> {
    pub source_index: Index,
    pub source_path: &'a [u8],
    pub loader: Loader,
    pub target: options::Target,
    pub redirect_import_record_index: u32,
    /// When true, always save source indices regardless of dev_server/loader.
    /// Used for barrel un-deferral where records must always be connected.
    pub force_save: bool,
}

impl Default for PatchImportRecordsCtx<'_> {
    fn default() -> Self {
        Self {
            source_index: Index::INVALID,
            source_path: b"",
            loader: Loader::File,
            target: Target::Browser,
            redirect_import_record_index: u32::MAX,
            force_save: false,
        }
    }
}

impl<'a> BundleV2<'a> {
    /// Patch source_index on import records from pathToSourceIndexMap and
    /// resolve_tasks_waiting_for_import_source_index. Called after
    /// processResolveQueue has registered new modules.
    pub fn patch_import_record_source_indices(&mut self, import_records: &mut ImportRecord::List, ctx: PatchImportRecordsCtx) {
        let graph = &self.graph;
        let input_file_loaders = graph.input_files.items_loader();
        let save_import_record_source_index = ctx.force_save
            || self.transpiler.options.dev_server.is_none()
            || ctx.loader == Loader::Html
            || ctx.loader.is_css();

        if let Some(pending_entry) = self.resolve_tasks_waiting_for_import_source_index.fetch_swap_remove(&ctx.source_index.get()) {
            let value = pending_entry.value;
            for to_assign in value.slice() {
                if save_import_record_source_index
                    || input_file_loaders[to_assign.to_source_index.get() as usize].is_css()
                {
                    import_records.slice_mut()[to_assign.import_record_index as usize].source_index = to_assign.to_source_index;
                }
            }
            drop(value);
        }

        let path_to_source_index_map = self.path_to_source_index_map(ctx.target);
        for (i, record) in import_records.slice_mut().iter_mut().enumerate() {
            if let Some(source_index) = path_to_source_index_map.get_path(&record.path) {
                if save_import_record_source_index || input_file_loaders[source_index as usize].is_css() {
                    record.source_index.value = source_index;
                }

                if let Some(compare) = get_redirect_id(ctx.redirect_import_record_index) {
                    if compare == i as u32 {
                        path_to_source_index_map.put(ctx.source_path.into(), source_index);
                    }
                }
            }
        }
    }

    fn generate_server_html_module(&mut self, path: &Fs::Path, target: options::Target, import_record: &mut ImportRecord, path_text: &[u8]) -> Result<(), Error> {
        // 1. Create the ast right here
        // 2. Create a separate "virutal" module that becomes the manifest later on.
        // 3. Add it to the graph
        let graph = &mut self.graph;
        let empty_html_file_source = Logger::Source {
            path: path.clone(),
            index: Index::source(graph.input_files.len()),
            contents: b"",
            ..Default::default()
        };
        let mut js_parser_options = bun_js_parser::Parser::Options::init(self.transpiler_for_target(target).options.jsx.clone(), Loader::Html);
        js_parser_options.bundle = true;

        let unique_key = self.allocator().alloc_fmt(format_args!(
            "{:x}H{:08}",
            self.unique_key,
            graph.html_imports.server_source_indices.len(),
        ));

        let transpiler = self.transpiler_for_target(target);

        let ast_for_html_entrypoint = JSAst::init(bun_js_parser::new_lazy_export_ast(
            self.allocator(),
            transpiler.options.define,
            js_parser_options,
            transpiler.log,
            Expr::init(E::String { data: unique_key }, Logger::Loc::EMPTY),
            &empty_html_file_source,
            // We replace this runtime API call's ref later via .link on the Symbol.
            b"__jsonParse",
        )?.unwrap());

        let fake_input_file = Graph::InputFile {
            source: empty_html_file_source,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        };

        graph.input_files.append(fake_input_file.clone())?;
        graph.ast.append(ast_for_html_entrypoint);

        import_record.source_index = fake_input_file.source.index;
        self.path_to_source_index_map(target).put(path_text.into(), fake_input_file.source.index.get());
        graph.html_imports.server_source_indices.append(fake_input_file.source.index.get());
        self.ensure_client_transpiler();
        Ok(())
    }
}

pub type ResolveQueue = StringHashMap<*mut ParseTask>;

impl<'a> BundleV2<'a> {
    pub fn on_notify_defer(&mut self) {
        self.thread_lock.assert_locked();
        self.graph.deferred_pending += 1;
        self.decrement_scan_counter();
    }

    pub fn on_notify_defer_mini(_: &mut jsc::api::JSBundler::Load, this: &mut BundleV2) {
        this.on_notify_defer();
    }

    pub fn on_parse_task_complete(parse_result: &mut ParseTask::Result, this: &mut BundleV2) {
        let _trace = bun_core::perf::trace("Bundler.onParseTaskComplete");
        let graph = &mut this.graph;
        if parse_result.external.function.is_some() {
            let source = match &parse_result.value {
                ParseTask::ResultValue::Empty(data) => data.source_index.get(),
                ParseTask::ResultValue::Err(data) => data.source_index.get(),
                ParseTask::ResultValue::Success(val) => val.source.index.get(),
            };
            let loader: Loader = graph.input_files.items_loader()[source as usize];
            if !loader.should_copy_for_bundling() {
                this.finalizers.push(parse_result.external);
            } else {
                graph.input_files.items_allocator_mut()[source as usize] =
                    ExternalFreeFunctionAllocator::create(parse_result.external.function.unwrap(), parse_result.external.ctx.unwrap());
            }
        }

        // defer bun.default_allocator.destroy(parse_result) — caller owns Box and drops at end
        // TODO(port): parse_result is heap-allocated by worker; reconstruct Box::from_raw at scope exit

        let mut diff: i32 = -1;
        let _diff_guard = scopeguard::guard((), |_| {
            bun_output::scoped_log!(scan_counter, "in parse task .pending_items += {} = {}\n",
                diff, i32::try_from(graph.pending_items).unwrap() + diff);
            graph.pending_items = u32::try_from(i32::try_from(graph.pending_items).unwrap() + diff).unwrap();
            if diff < 0 {
                this.on_after_decrement_scan_counter();
            }
        });

        let mut resolve_queue = ResolveQueue::new();
        let mut process_log = true;

        if matches!(parse_result.value, ParseTask::ResultValue::Success(_)) {
            barrel_imports::apply_barrel_optimization(this, parse_result);

            resolve_queue = Self::run_resolution_for_parse_task(parse_result, this);
            if matches!(parse_result.value, ParseTask::ResultValue::Err(_)) {
                process_log = false;
            }
        }

        // To minimize contention, watchers are appended on the bundle thread.
        if let Some(watcher) = this.bun_watcher {
            if parse_result.watcher_data.fd != bun_sys::Fd::INVALID {
                let source = match &parse_result.value {
                    ParseTask::ResultValue::Empty(data) => &graph.input_files.items_source()[data.source_index.get() as usize],
                    ParseTask::ResultValue::Err(data) => &graph.input_files.items_source()[data.source_index.get() as usize],
                    ParseTask::ResultValue::Success(val) => &val.source,
                };
                if this.should_add_watcher(&source.path.text) {
                    // SAFETY: bun_watcher NonNull is valid while bundle is running
                    let _ = unsafe { watcher.as_ref() }.add_file(
                        parse_result.watcher_data.fd,
                        &source.path.text,
                        bun_wyhash::hash32(&source.path.text),
                        graph.input_files.items_loader()[source.index.get() as usize],
                        parse_result.watcher_data.dir_fd,
                        None,
                        cfg!(windows),
                    );
                }
            }
        }

        match &mut parse_result.value {
            ParseTask::ResultValue::Empty(empty_result) => {
                let input_files = graph.input_files.slice_mut();
                let side_effects = input_files.items_side_effects_mut();
                side_effects[empty_result.source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsEmptyAst;
                if cfg!(debug_assertions) {
                    bun_output::scoped_log!(Bundle, "onParse({}, {}) = empty",
                        empty_result.source_index.get(),
                        bstr::BStr::new(&input_files.items_source()[empty_result.source_index.get() as usize].path.text));
                }
            }
            ParseTask::ResultValue::Success(result) => {
                result.log.clone_to_with_recycled(this.transpiler.log, true).expect("unreachable");

                this.has_any_top_level_await_modules = this.has_any_top_level_await_modules || !result.ast.top_level_await_keyword.is_empty();

                // Warning: `input_files` and `ast` arrays may resize in this function call
                // It is not safe to cache slices from them.
                graph.input_files.items_source_mut()[result.source.index.get() as usize] = result.source.clone();
                this.source_code_length += if !result.source.index.is_runtime() {
                    result.source.contents.len()
                } else {
                    0
                };

                graph.input_files.items_unique_key_for_additional_file_mut()[result.source.index.get() as usize] = result.unique_key_for_additional_file.clone();
                graph.input_files.items_content_hash_for_additional_file_mut()[result.source.index.get() as usize] = result.content_hash_for_additional_file;
                if !result.unique_key_for_additional_file.is_empty() && result.loader.should_copy_for_bundling() {
                    if let Some(dev) = this.transpiler.options.dev_server {
                        dev.put_or_overwrite_asset(
                            &result.source.path,
                            // SAFETY: when shouldCopyForBundling is true, the
                            // contents are allocated by bun.default_allocator
                            // TODO(port): from_owned_slice
                            &result.source.contents,
                            result.content_hash_for_additional_file,
                        ).expect("oom");
                    }
                }

                // Record which loader we used for this file
                graph.input_files.items_loader_mut()[result.source.index.get() as usize] = result.loader;

                bun_output::scoped_log!(Bundle, "onParse({}, {}) = {} imports, {} exports",
                    result.source.index.get(),
                    bstr::BStr::new(&result.source.path.text),
                    result.ast.import_records.len(),
                    result.ast.named_exports.count());

                if result.ast.css.is_some() {
                    graph.css_file_count += 1;
                }

                diff += this.process_resolve_queue(core::mem::replace(&mut resolve_queue, ResolveQueue::new()), result.ast.target, result.source.index.get());

                let mut import_records = result.ast.import_records.clone();
                this.patch_import_record_source_indices(&mut import_records, PatchImportRecordsCtx {
                    source_index: result.source.index,
                    source_path: &result.source.path.text,
                    loader: result.loader,
                    target: result.ast.target,
                    redirect_import_record_index: result.ast.redirect_import_record_index,
                    force_save: false,
                });
                result.ast.import_records = import_records;

                // Set is_export_star_target for barrel optimization.
                // In dev server mode, source_index is not saved on JS import
                // records, so fall back to resolving via the path map.
                let path_to_source_index_map = this.path_to_source_index_map(result.ast.target);
                for star_record_idx in result.ast.export_star_import_records.iter() {
                    if (*star_record_idx as usize) < import_records.len() {
                        let star_ir = &import_records.slice()[*star_record_idx as usize];
                        let resolved_index = if star_ir.source_index.is_valid() {
                            star_ir.source_index.get()
                        } else if let Some(idx) = path_to_source_index_map.get_path(&star_ir.path) {
                            idx
                        } else {
                            continue;
                        };
                        graph.input_files.items_flags_mut()[resolved_index as usize].is_export_star_target = true;
                    }
                }

                graph.ast.set(result.source.index.get(), result.ast.clone());

                // Barrel optimization: eagerly record import requests and
                // un-defer barrel records that are now needed.
                if this.is_barrel_optimization_enabled() {
                    diff += barrel_imports::schedule_barrel_deferred_imports(this, result).expect("oom");
                }

                // For files with use directives, index and prepare the other side.
                if result.use_directive != UseDirective::None
                    && if this.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph {
                        (result.use_directive == UseDirective::Client) == (result.ast.target == Target::Browser)
                    } else {
                        (result.use_directive == UseDirective::Client) != (result.ast.target == Target::Browser)
                    }
                {
                    if result.use_directive == UseDirective::Server {
                        bun_core::todo_panic!("\"use server\"");
                    }

                    let (reference_source_index, ssr_index) = if this.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph {
                        // Enqueue two files, one in server graph, one in ssr graph.
                        let reference_source_index = this.enqueue_server_component_generated_file(
                            ServerComponentParseTask::Data::ClientReferenceProxy {
                                other_source: result.source.clone(),
                                named_exports: result.ast.named_exports.clone(),
                            },
                            result.source.clone(),
                        ).expect("oom");

                        let ssr_source = &mut result.source;
                        ssr_source.path.pretty = ssr_source.path.text.clone();
                        ssr_source.path = this.path_with_pretty_initialized(ssr_source.path.clone(), Target::BakeServerComponentsSsr).expect("oom");
                        let ssr_index = this.enqueue_parse_task2(
                            ssr_source,
                            graph.input_files.items_loader()[result.source.index.get() as usize],
                            Target::BakeServerComponentsSsr,
                        ).expect("oom");

                        (reference_source_index, ssr_index)
                    } else {
                        // Enqueue only one file
                        let server_source = &mut result.source;
                        server_source.path.pretty = server_source.path.text.clone();
                        server_source.path = this.path_with_pretty_initialized(server_source.path.clone(), this.transpiler.options.target).expect("oom");
                        let server_index = this.enqueue_parse_task2(
                            server_source,
                            graph.input_files.items_loader()[result.source.index.get() as usize],
                            Target::Browser,
                        ).expect("oom");

                        (server_index, Index::INVALID.get())
                    };

                    graph.path_to_source_index_map(result.ast.target).put(
                        result.source.path.text.clone(),
                        reference_source_index,
                    );

                    graph.server_component_boundaries.put(
                        result.source.index.get(),
                        result.use_directive,
                        reference_source_index,
                        ssr_index,
                    ).expect("oom");
                }
            }
            ParseTask::ResultValue::Err(err) => {
                if cfg!(feature = "enable_logs") {
                    bun_output::scoped_log!(Bundle, "onParse() = err");
                }

                if process_log {
                    if let Some(dev_server) = this.transpiler.options.dev_server {
                        dev_server.handle_parse_task_failure(
                            err.err,
                            err.target.bake_graph(),
                            &graph.input_files.items_source()[err.source_index.get() as usize].path.text,
                            &err.log,
                            this,
                        ).expect("oom");
                    } else if !err.log.msgs.is_empty() {
                        err.log.clone_to_with_recycled(this.transpiler.log, true).expect("unreachable");
                    } else {
                        this.transpiler.log.add_error_fmt(
                            None,
                            Logger::Loc::EMPTY,
                            format_args!("{} while {}", err.err.name(), <&'static str>::from(err.step)),
                        ).expect("unreachable");
                    }
                }

                if cfg!(debug_assertions) && this.transpiler.options.dev_server.is_some() {
                    debug_assert!(graph.ast.items_parts()[err.source_index.get() as usize].len() == 0);
                }
            }
        }
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn get_loaders(&mut self) -> &mut options::Loader::HashTable {
        &mut self.transpiler.options.loaders
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        self.transpiler.resolver.bust_dir_cache(path)
    }
}

pub use js_ast::UseDirective;
pub use js_ast::ServerComponentBoundary;

type RefVoidMap = ArrayHashMap<Ref, ()>; // TODO(port): Ref.ArrayHashCtx
pub type RefImportData = ArrayHashMap<Ref, ImportData>;
pub type ResolvedExports = StringArrayHashMap<ExportData>;
pub use js_ast::Ast::TopLevelSymbolToParts;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum WrapKind {
    #[default]
    None,
    Cjs,
    Esm,
}

#[derive(Default)]
pub struct ImportData {
    // This is an array of intermediate statements that re-exported this symbol
    // in a chain before getting to the final symbol. This can be done either with
    // "export * from" or "export {} from". If this is done with "export * from"
    // then this may not be the result of a single chain but may instead form
    // a diamond shape if this same symbol was re-exported multiple times from
    // different files.
    pub re_exports: Dependency::List,

    pub data: ImportTracker,
}

#[derive(Default)]
pub struct ExportData {
    // Export star resolution happens first before import resolution. That means
    // it cannot yet determine if duplicate names from export star resolution are
    // ambiguous (point to different symbols) or not (point to the same symbol).
    // This issue can happen in the following scenario:
    //
    //   // entry.js
    //   export * from './a'
    //   export * from './b'
    //
    //   // a.js
    //   export * from './c'
    //
    //   // b.js
    //   export {x} from './c'
    //
    //   // c.js
    //   export let x = 1, y = 2
    //
    // In this case "entry.js" should have two exports "x" and "y", neither of
    // which are ambiguous. To handle this case, ambiguity resolution must be
    // deferred until import resolution time. That is done using this array.
    pub potentially_ambiguous_export_star_refs: BabyList<ImportData>,

    // This is the file that the named export above came from. This will be
    // different from the file that contains this object if this is a re-export.
    pub data: ImportTracker,
}

#[derive(Default)]
pub struct JSMeta {
    /// This is only for TypeScript files. If an import symbol is in this map, it
    /// means the import couldn't be found and doesn't actually exist. This is not
    /// an error in TypeScript because the import is probably just a type.
    ///
    /// Normally we remove all unused imports for TypeScript files during parsing,
    /// which automatically removes type-only imports. But there are certain re-
    /// export situations where it's impossible to tell if an import is a type or
    /// not:
    ///
    ///   import {typeOrNotTypeWhoKnows} from 'path';
    ///   export {typeOrNotTypeWhoKnows};
    ///
    /// Really people should be using the TypeScript "isolatedModules" flag with
    /// bundlers like this one that compile TypeScript files independently without
    /// type checking. That causes the TypeScript type checker to emit the error
    /// "Re-exporting a type when the '--isolatedModules' flag is provided requires
    /// using 'export type'." But we try to be robust to such code anyway.
    pub probably_typescript_type: RefVoidMap,

    /// Imports are matched with exports in a separate pass from when the matched
    /// exports are actually bound to the imports. Here "binding" means adding non-
    /// local dependencies on the parts in the exporting file that declare the
    /// exported symbol to all parts in the importing file that use the imported
    /// symbol.
    ///
    /// This must be a separate pass because of the "probably TypeScript type"
    /// check above. We can't generate the part for the export namespace until
    /// we've matched imports with exports because the generated code must omit
    /// type-only imports in the export namespace code. And we can't bind exports
    /// to imports until the part for the export namespace is generated since that
    /// part needs to participate in the binding.
    ///
    /// This array holds the deferred imports to bind so the pass can be split
    /// into two separate passes.
    pub imports_to_bind: RefImportData,

    /// This includes both named exports and re-exports.
    ///
    /// Named exports come from explicit export statements in the original file,
    /// and are copied from the "NamedExports" field in the AST.
    ///
    /// Re-exports come from other files and are the result of resolving export
    /// star statements (i.e. "export * from 'foo'").
    pub resolved_exports: ResolvedExports,
    pub resolved_export_star: ExportData,

    /// Never iterate over "resolvedExports" directly. Instead, iterate over this
    /// array. Some exports in that map aren't meant to end up in generated code.
    /// This array excludes these exports and is also sorted, which avoids non-
    /// determinism due to random map iteration order.
    pub sorted_and_filtered_export_aliases: Box<[Box<[u8]>]>,

    /// This is merged on top of the corresponding map from the parser in the AST.
    /// You should call "TopLevelSymbolToParts" to access this instead of accessing
    /// it directly.
    pub top_level_symbol_to_parts_overlay: TopLevelSymbolToParts,

    /// If this is an entry point, this array holds a reference to one free
    /// temporary symbol for each entry in "sortedAndFilteredExportAliases".
    /// These may be needed to store copies of CommonJS re-exports in ESM.
    pub cjs_export_copies: Box<[Ref]>,

    /// The index of the automatically-generated part used to represent the
    /// CommonJS or ESM wrapper. This part is empty and is only useful for tree
    /// shaking and code splitting. The wrapper can't be inserted into the part
    /// because the wrapper contains other parts, which can't be represented by
    /// the current part system. Only wrapped files have one of these.
    pub wrapper_part_index: Index,

    /// The index of the automatically-generated part used to handle entry point
    /// specific stuff. If a certain part is needed by the entry point, it's added
    /// as a dependency of this part. This is important for parts that are marked
    /// as removable when unused and that are not used by anything else. Only
    /// entry point files have one of these.
    pub entry_point_part_index: Index,

    pub flags: JSMetaFlags,
}

// packed struct(u8) — manual repr(transparent) over u8 with bit accessors
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct JSMetaFlags(u8);

impl JSMetaFlags {
    /// This is true if this file is affected by top-level await, either by having
    /// a top-level await inside this file or by having an import/export statement
    /// that transitively imports such a file. It is forbidden to call "require()"
    /// on these files since they are evaluated asynchronously.
    pub const fn is_async_or_has_async_dependency(self) -> bool { self.0 & (1 << 0) != 0 }
    pub fn set_is_async_or_has_async_dependency(&mut self, v: bool) { if v { self.0 |= 1 << 0 } else { self.0 &= !(1 << 0) } }

    /// If true, we need to insert "var exports = {};". This is the case for ESM
    /// files when the import namespace is captured via "import * as" and also
    /// when they are the target of a "require()" call.
    pub const fn needs_exports_variable(self) -> bool { self.0 & (1 << 1) != 0 }
    pub fn set_needs_exports_variable(&mut self, v: bool) { if v { self.0 |= 1 << 1 } else { self.0 &= !(1 << 1) } }

    /// If true, the "__export(exports, { ... })" call will be force-included even
    /// if there are no parts that reference "exports". Otherwise this call will
    /// be removed due to the tree shaking pass. This is used when for entry point
    /// files when code related to the current output format needs to reference
    /// the "exports" variable.
    pub const fn force_include_exports_for_entry_point(self) -> bool { self.0 & (1 << 2) != 0 }
    pub fn set_force_include_exports_for_entry_point(&mut self, v: bool) { if v { self.0 |= 1 << 2 } else { self.0 &= !(1 << 2) } }

    /// This is set when we need to pull in the "__export" symbol in to the part
    /// at "nsExportPartIndex". This can't be done in "createExportsForFile"
    /// because of concurrent map hazards. Instead, it must be done later.
    pub const fn needs_export_symbol_from_runtime(self) -> bool { self.0 & (1 << 3) != 0 }
    pub fn set_needs_export_symbol_from_runtime(&mut self, v: bool) { if v { self.0 |= 1 << 3 } else { self.0 &= !(1 << 3) } }

    /// Wrapped files must also ensure that their dependencies are wrapped. This
    /// flag is used during the traversal that enforces this invariant, and is used
    /// to detect when the fixed point has been reached.
    pub const fn did_wrap_dependencies(self) -> bool { self.0 & (1 << 4) != 0 }
    pub fn set_did_wrap_dependencies(&mut self, v: bool) { if v { self.0 |= 1 << 4 } else { self.0 &= !(1 << 4) } }

    /// When a converted CommonJS module is import() dynamically
    /// We need ensure that the "default" export is set to the equivalent of module.exports
    /// (unless a "default" export already exists)
    pub const fn needs_synthetic_default_export(self) -> bool { self.0 & (1 << 5) != 0 }
    pub fn set_needs_synthetic_default_export(&mut self, v: bool) { if v { self.0 |= 1 << 5 } else { self.0 &= !(1 << 5) } }

    pub const fn wrap(self) -> WrapKind {
        // SAFETY: bits 6-7 store a WrapKind discriminant in range [0, 2]
        unsafe { core::mem::transmute((self.0 >> 6) & 0b11) }
    }
    pub fn set_wrap(&mut self, v: WrapKind) { self.0 = (self.0 & 0b0011_1111) | ((v as u8) << 6); }
}

pub enum AdditionalFile {
    SourceIndex(IndexInt),
    OutputFile(IndexInt),
}

#[derive(Default)]
pub struct EntryPoint {
    /// This may be an absolute path or a relative path. If absolute, it will
    /// eventually be turned into a relative path by computing the path relative
    /// to the "outbase" directory. Then this relative path will be joined onto
    /// the "outdir" directory to form the final output path for this entry point.
    pub output_path: bun_core::PathString,

    /// This is the source index of the entry point. This file must have a valid
    /// entry point kind (i.e. not "none").
    pub source_index: IndexInt,

    /// Manually specified output paths are ignored when computing the default
    /// "outbase" directory, which is computed as the lowest common ancestor of
    /// all automatically generated output paths.
    pub output_path_was_auto_generated: bool,
}

pub type EntryPointList = MultiArrayList<EntryPoint>;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr)]
pub enum EntryPointKind {
    #[default]
    None,
    UserSpecified,
    DynamicImport,
    Html,
}

impl EntryPointKind {
    pub fn output_kind(self) -> jsc::api::BuildArtifact::OutputKind {
        match self {
            Self::UserSpecified => jsc::api::BuildArtifact::OutputKind::EntryPoint,
            _ => jsc::api::BuildArtifact::OutputKind::Chunk,
        }
    }

    #[inline]
    pub fn is_entry_point(self) -> bool {
        self != Self::None
    }

    #[inline]
    pub fn is_user_specified_entry_point(self) -> bool {
        self == Self::UserSpecified
    }

    // TODO: delete
    #[inline]
    pub fn is_server_entry_point(self) -> bool {
        self == Self::UserSpecified
    }
}

struct AstSourceIDMapping {
    id: IndexInt,
    source_index: IndexInt,
}

#[derive(Clone, Copy, Default)]
pub struct PartRange {
    pub source_index: Index,
    pub part_index_begin: u32,
    pub part_index_end: u32,
}

// packed struct(u96) — repr(C, packed) to match exact layout
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct StableRef {
    pub stable_source_index: IndexInt,
    pub r#ref: Ref,
}

impl StableRef {
    pub fn is_less_than(_: (), a: StableRef, b: StableRef) -> bool {
        a.stable_source_index < b.stable_source_index
            || (a.stable_source_index == b.stable_source_index && a.r#ref.inner_index() < b.r#ref.inner_index())
    }
}

#[derive(Clone, Copy, Default)]
pub struct ImportTracker {
    pub source_index: Index,
    pub name_loc: Logger::Loc,
    pub import_ref: Ref,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ImportTrackerStatus {
    /// The imported file has no matching export
    #[default]
    NoMatch,

    /// The imported file has a matching export
    Found,

    /// The imported file is CommonJS and has unknown exports
    Cjs,

    /// The import is missing but there is a dynamic fallback object
    DynamicFallback,

    /// The import is missing but there is a dynamic fallback object
    /// and the file was originally CommonJS.
    DynamicFallbackInteropDefault,

    /// The import was treated as a CommonJS import but the file is known to have no exports
    CjsWithoutExports,

    /// The imported file was disabled by mapping it to false in the "browser"
    /// field of package.json
    Disabled,

    /// The imported file is external and has unknown exports
    External,

    /// This is a missing re-export in a TypeScript file, so it's probably a type
    ProbablyTypescriptType,
}

#[derive(Default)]
pub struct ImportTrackerIterator {
    pub status: ImportTrackerStatus,
    pub value: ImportTracker,
    pub import_data: Box<[ImportData]>,
}

pub use options::PathTemplate;

#[derive(Default)]
pub struct CrossChunkImport {
    pub chunk_index: IndexInt,
    pub sorted_import_items: BabyList<CrossChunkImportItem>,
}

#[derive(Default, Clone)]
pub struct CrossChunkImportItem {
    pub export_alias: Box<[u8]>,
    pub r#ref: Ref,
}

pub type CrossChunkImportItemList = BabyList<CrossChunkImportItem>;

impl CrossChunkImportItem {
    pub fn less_than(_: (), a: &CrossChunkImportItem, b: &CrossChunkImportItem) -> bool {
        strings::order(&a.export_alias, &b.export_alias) == core::cmp::Ordering::Less
    }
}

impl CrossChunkImport {
    pub fn less_than(_: (), a: &CrossChunkImport, b: &CrossChunkImport) -> bool {
        a.chunk_index < b.chunk_index
    }

    pub fn sorted_cross_chunk_imports(
        list: &mut Vec<CrossChunkImport>,
        chunks: &mut [Chunk],
        imports_from_other_chunks: &mut Chunk::ImportsFromOtherChunks,
    ) -> Result<(), Error> {
        let mut result = core::mem::take(list);
        let _restore = scopeguard::guard((), |_| { *list = result; });
        // PORT NOTE: reshaped for borrowck — defer reassignment via guard

        result.clear();
        result.reserve(imports_from_other_chunks.count());

        let import_items_list = imports_from_other_chunks.values();
        let chunk_indices = imports_from_other_chunks.keys();
        debug_assert_eq!(chunk_indices.len(), import_items_list.len());
        for (chunk_index, import_items) in chunk_indices.iter().zip(import_items_list.iter()) {
            let chunk = &mut chunks[*chunk_index as usize];

            // Sort imports from a single chunk by alias for determinism
            let exports_to_other_chunks = &chunk.content.javascript().exports_to_other_chunks;
            // TODO: do we need to clone this array?
            for item in import_items.slice_mut() {
                item.export_alias = exports_to_other_chunks.get(&item.r#ref).unwrap().clone();
                debug_assert!(!item.export_alias.is_empty());
            }
            import_items.slice_mut().sort_by(|a, b| strings::order(&a.export_alias, &b.export_alias));

            result.push(CrossChunkImport {
                chunk_index: *chunk_index,
                sorted_import_items: import_items.clone(),
            });
        }

        result.sort_by(|a, b| a.chunk_index.cmp(&b.chunk_index));
        Ok(())
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DeclInfoKind { Declared, Lexical }

pub struct DeclInfo {
    pub name: Box<[u8]>,
    pub kind: DeclInfoKind,
}

pub enum CompileResult {
    Javascript {
        source_index: IndexInt,
        result: bun_js_printer::PrintResult,
        /// Top-level declarations collected from converted statements during
        /// parallel printing. Used by postProcessJSChunk to populate ModuleInfo
        /// without re-scanning the original (unconverted) AST.
        decls: Box<[DeclInfo]>,
    },
    Css {
        result: Result<Box<[u8]>, Error>,
        source_index: IndexInt,
        source_map: Option<SourceMap::Chunk>,
    },
    Html {
        source_index: IndexInt,
        code: Box<[u8]>,
        /// Offsets are used for DevServer to inject resources without re-bundling
        script_injection_offset: u32,
    },
}

impl CompileResult {
    pub const EMPTY: CompileResult = CompileResult::Javascript {
        source_index: 0,
        result: bun_js_printer::PrintResult::Result { code: b"", source_map: None },
        decls: Box::new([]), // TODO(port): const Box::new not stable; use lazy_static or fn
    };

    pub fn code(&self) -> &[u8] {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result { code, .. } => code,
                _ => b"",
            },
            CompileResult::Css { result, .. } => match result {
                Ok(v) => v,
                Err(_) => b"",
            },
            CompileResult::Html { code, .. } => code,
        }
    }

    pub fn source_map_chunk(&self) -> Option<&SourceMap::Chunk> {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result { source_map, .. } => source_map.as_ref(),
                _ => None,
            },
            CompileResult::Css { source_map, .. } => source_map.as_ref(),
            CompileResult::Html { .. } => None,
        }
    }

    pub fn source_index(&self) -> IndexInt {
        match self {
            CompileResult::Javascript { source_index, .. } => *source_index,
            CompileResult::Css { source_index, .. } => *source_index,
            CompileResult::Html { source_index, .. } => *source_index,
        }
    }
}

pub struct CompileResultForSourceMap {
    pub source_map_chunk: SourceMap::Chunk,
    pub generated_offset: SourceMap::LineColumnOffset,
    pub source_index: u32,
}

pub struct ContentHasher {
    // xxhash64 outperforms Wyhash if the file is > 1KB or so
    pub hasher: xxhash_rust::xxh64::Xxh64,
}

impl Default for ContentHasher {
    fn default() -> Self {
        Self { hasher: xxhash_rust::xxh64::Xxh64::new(0) }
    }
}

impl ContentHasher {
    pub fn write(&mut self, bytes: &[u8]) {
        bun_output::scoped_log!(ContentHasher, "HASH_UPDATE {}:\n{}\n----------\n", bytes.len(), bstr::BStr::new(bytes));
        self.hasher.update(&bytes.len().to_ne_bytes());
        self.hasher.update(bytes);
    }

    pub fn run(bytes: &[u8]) -> u64 {
        let mut hasher = ContentHasher::default();
        hasher.write(bytes);
        hasher.digest()
    }

    pub fn write_ints(&mut self, i: &[u32]) {
        bun_output::scoped_log!(ContentHasher, "HASH_UPDATE: {:?}\n", i);
        // SAFETY: [u32] is POD; reinterpret as bytes
        self.hasher.update(bytemuck::cast_slice(i));
    }

    pub fn digest(&self) -> u64 {
        self.hasher.digest()
    }
}

// non-allocating
// meant to be fast but not 100% thorough
// users can correctly put in a trailing slash if they want
// this is just being nice
pub fn cheap_prefix_normalizer<'s>(prefix: &'s [u8], suffix: &'s [u8]) -> [&'s [u8]; 2] {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if suffix_no_slash.starts_with(b"../") { b"" } else { b"./" },
            suffix_no_slash,
        ];
    }

    // There are a few cases here we want to handle:
    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"] => "/foo/bar.js"
    if strings::ends_with_char(prefix, b'/') || (cfg!(windows) && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/') || (cfg!(windows) && strings::starts_with_char(suffix, b'\\')) {
            return [
                &prefix[..prefix.len()],
                &suffix[1..suffix.len()],
            ];
        }

        // It gets really complicated if we try to deal with URLs more than this
        // These would be ideal:
        // - example.com + ./out.js => example.com/out.js
        // - example.com/foo + ./out.js => example.com/fooout.js
        // - example.com/bar/ + ./out.js => example.com/bar/out.js
        // But it's not worth the complexity to handle these cases right now.
    }

    [
        prefix,
        strings::remove_leading_dot_slash(suffix),
    ]
}

fn get_redirect_id(id: u32) -> Option<u32> {
    if id == u32::MAX {
        return None;
    }
    Some(id)
}

pub fn target_from_hashbang(buffer: &[u8]) -> Option<options::Target> {
    if buffer.len() > b"#!/usr/bin/env bun".len() {
        if buffer.starts_with(b"#!/usr/bin/env bun") {
            match buffer[b"#!/usr/bin/env bun".len()] {
                b'\n' | b' ' => return Some(Target::Bun),
                _ => {}
            }
        }
    }
    None
}

#[derive(Clone, Copy)]
pub struct CssEntryPointMeta {
    /// When this is true, a stub file is added to the Server's IncrementalGraph
    pub imported_on_server: bool,
}

/// The lifetime of this structure is tied to the bundler's arena
pub struct DevServerInput {
    pub css_entry_points: ArrayHashMap<Index, CssEntryPointMeta>,
}

/// The lifetime of this structure is tied to the bundler's arena
pub struct DevServerOutput<'a> {
    pub chunks: &'a mut [Chunk],
    pub css_file_list: ArrayHashMap<Index, CssEntryPointMeta>,
    pub html_files: ArrayHashMap<Index, ()>,
}

impl<'a> DevServerOutput<'a> {
    pub fn js_pseudo_chunk(&mut self) -> &mut Chunk {
        &mut self.chunks[0]
    }

    pub fn css_chunks(&mut self) -> &mut [Chunk] {
        &mut self.chunks[1..][..self.css_file_list.count()]
    }

    pub fn html_chunks(&mut self) -> &mut [Chunk] {
        &mut self.chunks[1 + self.css_file_list.count()..][..self.html_files.count()]
    }
}

pub fn generate_unique_key() -> u64 {
    let key = bun_core::rand::random_u64() & 0x0FFFFFFF_FFFFFFFF_u64;
    // without this check, putting unique_key in an object key would
    // sometimes get converted to an identifier. ensuring it starts
    // with a number forces that optimization off.
    if cfg!(debug_assertions) {
        let mut buf = [0u8; 16];
        let mut cursor = &mut buf[..];
        write!(cursor, "{:016x}", key).expect("unreachable");
        let hex = &buf[..16 - cursor.len()];
        match hex[0] {
            b'0'..=b'9' => {}
            _ => Output::panic(format_args!("unique key is a valid identifier: {}", bstr::BStr::new(hex))),
        }
    }
    key
}

struct ExternalFreeFunctionAllocator {
    free_callback: unsafe extern "C" fn(*mut c_void),
    context: *mut c_void,
}

impl ExternalFreeFunctionAllocator {
    // TODO(port): std.mem.Allocator vtable equivalent — Phase B will define bun_alloc::Allocator trait impl

    pub fn create(free_callback: unsafe extern "C" fn(*mut c_void), context: *mut c_void) -> bun_alloc::DynAllocator {
        bun_alloc::DynAllocator::from_boxed(Box::new(ExternalFreeFunctionAllocator {
            free_callback,
            context,
        }))
    }

    fn alloc(_: *mut c_void, _: usize, _: bun_alloc::Alignment, _: usize) -> Option<*mut u8> {
        None
    }

    fn free(ext_free_function: *mut c_void, _: &mut [u8], _: bun_alloc::Alignment, _: usize) {
        // SAFETY: ptr was created by ExternalFreeFunctionAllocator::create
        let info: &mut ExternalFreeFunctionAllocator = unsafe { &mut *(ext_free_function as *mut ExternalFreeFunctionAllocator) };
        // SAFETY: free_callback is a valid C fn provided by plugin
        unsafe { (info.free_callback)(info.context) };
        // SAFETY: info was Box::into_raw'd in create()
        drop(unsafe { Box::from_raw(info) });
    }
}

/// Returns true if `allocator` definitely has a valid `.ptr`.
/// May return false even if `.ptr` is valid.
///
/// This function should check whether `allocator` matches any internal allocator types known to
/// have valid pointers. Allocators defined outside of this file, like `std.heap.ArenaAllocator`,
/// don't need to be checked.
pub fn allocator_has_pointer(allocator: &bun_alloc::DynAllocator) -> bool {
    // TODO(port): vtable comparison — bun_alloc::DynAllocator should expose a type tag
    allocator.is::<ExternalFreeFunctionAllocator>()
}

pub struct BuildResult {
    pub output_files: Vec<options::OutputFile>,
    pub metafile: Option<Box<[u8]>>,
    pub metafile_markdown: Option<Box<[u8]>>,
}

pub enum BundleV2Result {
    Pending,
    Err(Error),
    Value(BuildResult),
}

// re-exports
pub use crate::html_scanner::HTMLScanner;
pub use crate::index_string_map::IndexStringMap;
pub type BitSet = DynamicBitSetUnmanaged;
pub use Logger::Loc;

// C++ binding for lazy metafile getter (defined in BundlerMetafile.cpp)
// Uses jsc.conv (SYSV_ABI on Windows x64) for proper calling convention
// Sets up metafile object with { json: <lazy parsed>, markdown?: string }

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/bundle_v2.zig (4509 lines)
//   confidence: low
//   todos:      30
//   notes:      Heavy borrowck reshaping needed (overlapping &mut self.graph/transpiler); enqueueEntryPoints split into 3 fns (see PORT NOTE); ParseTask ownership uses Box::leak/from_raw; ssr_transpiler aliases transpiler in init (illegal in Rust); init() should arena-allocate self
// ──────────────────────────────────────────────────────────────────────────


