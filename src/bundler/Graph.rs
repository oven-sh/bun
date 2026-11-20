use crate::BundledAst as JSAst;
use bun_alloc::Arena as ThreadLocalArena;
use bun_alloc::{AstAlloc, AstVec};
use bun_ast::server_component_boundary;
use bun_collections::{ArrayHashMap, MultiArrayList};
use enum_map::EnumMap;

use crate::IndexStringMap::IndexStringMap;
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::options;
use crate::{AdditionalFile, BundleV2, ThreadPool};

use bun_ast::Index;
use bun_css::BundlerStyleSheet;

// `bun.ast.Index.Int` — the underlying integer repr of `Index`.
pub(crate) use crate::IndexInt;

pub struct Graph<'a> {
    /// Drops before `pool`, whose workers' arenas hold parts of each stylesheet.
    pub(crate) css_asts: CssAsts<'a>,
    /// Drops before the fields below, which tasks borrow. Boxed: its threads use it while the bundle thread changes the graph.
    pool: Box<ThreadPool>,
    pub(crate) heap: &'a ThreadLocalArena,

    /// Mapping user-specified entry points to their Source Index
    pub entry_points: Vec<Index>,
    /// Maps entry point source indices to their original specifiers (for virtual entries resolved by plugins)
    pub(crate) entry_point_original_names: IndexStringMap,
    /// Every source index has an associated InputFile
    pub input_files: MultiArrayList<InputFile<'a>>,
    /// Every source index has an associated Ast
    /// When a parse is in progress / queued, it is `Ast.empty`
    // `JSAst<'a>` borrows from the arena behind `self.heap`; `'a` ties the AST
    // entries to that arena's lifetime (sibling-field relationship).
    pub ast: MultiArrayList<JSAst<'a>>,

    /// During the scan + parse phase, this value keeps a count of the remaining
    /// tasks. Once it hits zero, the scan phase ends and linking begins. Note
    /// that if `deferred_pending > 0`, it means there are plugin callbacks
    /// to invoke before linking, which can initiate another scan phase.
    ///
    /// Increment and decrement this via `incrementScanCounter` and
    /// `decrementScanCounter`, as asynchronous bundles check for `0` in the
    /// decrement function, instead of at the top of the event loop.
    ///
    /// - Parsing a file (ParseTask and ServerComponentParseTask)
    /// - onResolve and onLoad functions
    /// - Resolving an onDefer promise
    pub(crate) pending_items: u32,
    /// When an `onLoad` plugin calls `.defer()`, the count from `pending_items`
    /// is "moved" into this counter (pending_items -= 1; deferred_pending += 1)
    ///
    /// When `pending_items` hits zero and there are deferred pending tasks, those
    /// tasks will be run, and the count is "moved" back to `pending_items`
    pub(crate) deferred_pending: u32,

    /// Which deferred batch is being collected: bumped each time `drain_deferred_tasks` moves the parked
    /// units back, so a `Load` can tell whether its own unit is still parked. Bundle thread only.
    pub(crate) defer_epoch: u32,
    /// The VM that owns the plugins is shutting down: `dispatch()` hands it nothing further (what it
    /// holds comes back answered as cancelled) and the pass fails at its next checkpoint.
    pub(crate) cancelled: bool,

    /// A map of build targets to their corresponding module graphs.
    pub build_graphs: EnumMap<options::Target, PathToSourceIndexMap>,

    /// When Server Components is enabled, this holds a list of all boundary
    /// files. This happens for all files with a "use <side>" directive.
    pub server_component_boundaries: server_component_boundary::List,

    /// Track HTML imports from server-side code
    /// Each entry is the source index of the generated module that stands for an imported HTML file
    ///
    /// OutputPiece.Kind.HTMLManifest corresponds to indices into the array.
    pub(crate) html_imports: Vec<IndexInt>,

    pub(crate) css_js_stubs: CssJsStubs,

    pub(crate) estimated_file_loader_count: u32,

    /// For Bake, a count of the CSS asts is used to make precise
    /// pre-allocations without re-iterating the file listing.
    pub(crate) css_file_count: u32,

    pub(crate) kit_referenced_server_data: bool,
    pub(crate) kit_referenced_client_data: bool,

    /// Do any input_files have a secondary_path.len > 0?
    ///
    /// Helps skip a loop.
    pub(crate) has_any_secondary_paths: bool,

    /// Do any input_files have a key_loader? Helps skip a loop.
    pub(crate) has_any_key_loaders: bool,
}

/// By source index. The `Vec` ends at the last CSS file; an index past it reads as `None`.
#[derive(Default)]
pub(crate) struct CssAsts<'a>(Vec<Option<Box<BundlerStyleSheet<'a>>>>);

impl<'a> CssAsts<'a> {
    pub(crate) fn put(&mut self, source_index: usize, sheet: Box<BundlerStyleSheet<'a>>) {
        if self.0.len() <= source_index {
            self.0.resize_with(source_index + 1, || None);
        }
        self.0[source_index] = Some(sheet);
    }

    pub(crate) fn iter(&self) -> core::slice::Iter<'_, Option<Box<BundlerStyleSheet<'a>>>> {
        self.0.iter()
    }
}

impl<'a> core::ops::Index<usize> for CssAsts<'a> {
    type Output = Option<Box<BundlerStyleSheet<'a>>>;
    fn index(&self, source_index: usize) -> &Self::Output {
        self.0.get(source_index).unwrap_or(&None)
    }
}

/// What a JS stub is for: its stylesheet, the target of its importers (the graphs of `bun build --app` can share one stylesheet row), and whether it is the target of a split `import()`. That stub is an entry point and prints every class name in its own chunk. The other stub of the stylesheet prints the class names that the files that import it read.
pub(crate) type CssJsStubKey = (IndexInt, options::Target, bool);

/// The JS modules that export the class names of stylesheets: the last rows of the graph (esbuild's "JavaScript stub").
#[derive(Default)]
pub(crate) struct CssJsStubs {
    /// The source index of the first stub. Stub `first + i` has the key `stubs.keys()[i]`.
    first: IndexInt,
    stubs: ArrayHashMap<CssJsStubKey, ()>,
}

impl CssJsStubs {
    pub(crate) fn new(first: IndexInt, stubs: ArrayHashMap<CssJsStubKey, ()>) -> Self {
        Self { first, stubs }
    }

    /// The stylesheet whose class names the stub at `source_index` exports.
    #[inline]
    pub(crate) fn stylesheet_of(&self, source_index: IndexInt) -> Option<IndexInt> {
        self.stubs
            .keys()
            .get(source_index.checked_sub(self.first)? as usize)
            .map(|&(stylesheet, ..)| stylesheet)
    }

    /// The stub that an `import` or a `require()` in JavaScript of `target` names for the value of `stylesheet`.
    #[inline]
    pub(crate) fn stub_of(
        &self,
        stylesheet: IndexInt,
        target: options::Target,
    ) -> Option<IndexInt> {
        self.stub_with_key((stylesheet, target, false))
    }

    #[inline]
    fn stub_with_key(&self, key: CssJsStubKey) -> Option<IndexInt> {
        if self.stubs.is_empty() {
            return None;
        }
        Some(self.first + self.stubs.get_index(&key)? as IndexInt)
    }

    /// The stubs of `stylesheet`: for each target whose JavaScript reads a value from it, and for a split `import()` of it.
    pub(crate) fn stubs_of(&self, stylesheet: IndexInt) -> impl Iterator<Item = IndexInt> + '_ {
        (0..<options::Target as enum_map::Enum>::LENGTH).flat_map(move |target| {
            let target = <options::Target as enum_map::Enum>::from_usize(target);
            [false, true]
                .into_iter()
                .filter_map(move |is_split| self.stub_with_key((stylesheet, target, is_split)))
        })
    }

    pub(crate) fn len(&self) -> usize {
        self.stubs.count()
    }
}

pub struct InputFile<'a> {
    pub(crate) source: bun_ast::Source<'a>,
    pub(crate) secondary_path: AstVec<u8>,
    pub(crate) loader: options::Loader,
    pub side_effects: SideEffects,
    // No `arena` field — the owned fields
    // (Box/Vec) carry their allocator.
    pub additional_files: AstVec<AdditionalFile>,
    pub unique_key_for_additional_file: Box<[u8], AstAlloc>,
    pub content_hash_for_additional_file: u64,
    pub flags: InputFileFlags,
    /// The loader part of this module's `PathToSourceIndexMap` key. See `ModuleMap`.
    pub key_loader: Option<options::Loader>,
}

impl Default for InputFile<'_> {
    fn default() -> Self {
        Self {
            source: bun_ast::Source::default(),
            secondary_path: AstAlloc::vec(),
            loader: options::Loader::default(),
            side_effects: SideEffects::default(),
            additional_files: AstAlloc::vec(),
            unique_key_for_additional_file: AstAlloc::vec().into_boxed_slice(),
            content_hash_for_additional_file: 0,
            flags: InputFileFlags::default(),
            key_loader: None,
        }
    }
}

// SoA column accessors on `MultiArrayList<InputFile>`.
// Field name + type are checked against `InputFile`'s reflected layout at
// compile time by the underlying `items::<"name", T>()`.
bun_collections::multi_array_columns! {
    pub trait InputFileColumns ['a] for InputFile<'a> {
        source: bun_ast::Source<'a>,
        secondary_path: AstVec<u8>,
        loader: options::Loader,
        side_effects: SideEffects,
        additional_files: AstVec<AdditionalFile>,
        unique_key_for_additional_file: Box<[u8], AstAlloc>,
        content_hash_for_additional_file: u64,
        flags: InputFileFlags,
        key_loader: Option<options::Loader>,
    }
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub struct InputFileFlags: u8 {
        /// Set when a barrel-eligible file has `export * from` this file.
        const IS_EXPORT_STAR_TARGET = 1 << 1;
        /// `source.contents` is what an `onLoad` plugin returned, not what is in the file.
        const IS_LOADED_BY_PLUGIN = 1 << 2;
    }
}

impl<'a> Graph<'a> {
    /// A stylesheet, or the JS stub of one. Each chunk that needs its class names prints a copy of its JS parts: it is a file of no one JS chunk, and no chunk imports its symbols from another.
    #[inline]
    pub(crate) fn holds_class_names(&self, source_index: IndexInt) -> bool {
        self.css_asts[source_index as usize].is_some()
            || self.css_js_stubs.stylesheet_of(source_index).is_some()
    }

    /// Every other file: its parts print in the one JS chunk that has its entry bits.
    #[inline]
    pub(crate) fn has_one_js_chunk(&self, source_index: IndexInt) -> bool {
        !self.holds_class_names(source_index)
    }

    pub(crate) fn new(heap: &'a ThreadLocalArena, pool: ThreadPool) -> Self {
        Self {
            css_asts: CssAsts::default(),
            pool: Box::new(pool),
            heap,
            entry_points: Vec::new(),
            entry_point_original_names: IndexStringMap::default(),
            input_files: MultiArrayList::default(),
            ast: MultiArrayList::default(),
            pending_items: 0,
            deferred_pending: 0,
            defer_epoch: 0,
            cancelled: false,
            build_graphs: EnumMap::default(),
            server_component_boundaries: server_component_boundary::List::default(),
            html_imports: Vec::new(),
            css_js_stubs: CssJsStubs::default(),
            estimated_file_loader_count: 0,
            css_file_count: 0,
            kit_referenced_server_data: false,
            kit_referenced_client_data: false,
            has_any_secondary_paths: false,
            has_any_key_loaders: false,
        }
    }
}

impl<'a> Graph<'a> {
    #[inline]
    pub(crate) fn pool(&self) -> &ThreadPool {
        &self.pool
    }

    #[inline]
    pub(crate) fn path_to_source_index_map(
        &mut self,
        target: options::Target,
    ) -> &mut PathToSourceIndexMap {
        &mut self.build_graphs[target]
    }
}

impl BundleV2<'_> {
    /// Schedule a task to be run on the JS thread which resolves the promise of
    /// each `.defer()` called in an onLoad plugin.
    ///
    /// Returns true if there were more tasks queued.
    pub(crate) fn drain_deferred_tasks(&mut self) -> bool {
        self.thread_lock.assert_locked();

        if self.graph.deferred_pending > 0 {
            // Their units are back in `pending_items` (a new epoch: those loads' own units are no longer
            // parked), plus one for the hop itself: the pass is not done until it is back (see
            // `DeferredBatchTask`).
            self.graph.pending_items += self.graph.deferred_pending + 1;
            self.graph.deferred_pending = 0;
            self.graph.defer_epoch += 1;
            self.drain_defer_task.schedule();

            return true;
        }

        false
    }
}

// The resolver
// crate re-exports the canonical enum from `bun_options_types`; re-export it
// here so `InputFile` and the derived `items_side_effects()` SoA accessor share
// the same type that `LinkerContext::mark_file_live_for_tree_shaking` expects.
use bun_ast::SideEffects;
