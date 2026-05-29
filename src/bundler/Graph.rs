use core::ptr::NonNull;

use crate::BundledAst as JSAst;
use bun_alloc::Arena as ThreadLocalArena;
use bun_alloc::{AstAlloc, AstVec};
use bun_ast::server_component_boundary;
use bun_collections::MultiArrayList;
use enum_map::EnumMap;

use crate::IndexStringMap::IndexStringMap;
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::options;
use crate::{AdditionalFile, BundleV2, ThreadPool};

use bun_ast::Index;

// `bun.ast.Index.Int` — the underlying integer repr of `Index`.
pub(crate) use crate::IndexInt;

pub struct Graph<'a> {
    pub pool: bun_ptr::BackRef<ThreadPool>,
    pub heap: &'a ThreadLocalArena,

    /// Mapping user-specified entry points to their Source Index
    // PERF(port): Zig fed this ArrayList from `self.heap` (self-referential arena).
    pub entry_points: Vec<Index>,
    /// Maps entry point source indices to their original specifiers (for virtual entries resolved by plugins)
    pub entry_point_original_names: IndexStringMap,
    /// Every source index has an associated InputFile
    pub input_files: MultiArrayList<InputFile>,
    pub ast: MultiArrayList<JSAst<'a>>,

    pub pending_items: u32,
    pub deferred_pending: u32,

    /// A map of build targets to their corresponding module graphs.
    pub build_graphs: EnumMap<options::Target, PathToSourceIndexMap>,

    /// When Server Components is enabled, this holds a list of all boundary
    /// files. This happens for all files with a "use <side>" directive.
    pub server_component_boundaries: server_component_boundary::List,

    pub html_imports: HtmlImports,

    pub estimated_file_loader_count: usize,

    /// For Bake, a count of the CSS asts is used to make precise
    /// pre-allocations without re-iterating the file listing.
    pub css_file_count: usize,

    // PERF(port): Zig fed this ArrayList from `self.heap` (self-referential arena).
    pub additional_output_files: Vec<options::OutputFile>,

    pub kit_referenced_server_data: bool,
    pub kit_referenced_client_data: bool,

    /// Do any input_files have a secondary_path.len > 0?
    ///
    /// Helps skip a loop.
    pub has_any_secondary_paths: bool,
}

#[derive(Default)]
pub struct HtmlImports {
    /// Source index of the server file doing the import
    pub server_source_indices: Vec<IndexInt>,
    /// Source index of the HTML file being imported
    pub html_source_indices: Vec<IndexInt>,
}

pub struct InputFile {
    pub source: bun_ast::Source,
    pub secondary_path: AstVec<u8>,
    pub loader: options::Loader,
    pub side_effects: SideEffects,
    // PORT NOTE: Zig stored `arena: std.mem.Allocator = bun.default_allocator`
    // here so deinit could free `source`/`secondary_path` with the right alloc.
    // In Rust the owned fields (Box/Vec) carry their arena; field dropped.
    pub additional_files: AstVec<AdditionalFile>,
    pub unique_key_for_additional_file: Box<[u8], AstAlloc>,
    pub content_hash_for_additional_file: u64,
    pub flags: InputFileFlags,
}

impl Default for InputFile {
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
        }
    }
}

// SoA column accessors on `MultiArrayList<InputFile>` and `Slice<InputFile>`.
// Field name + type are checked against `InputFile`'s reflected layout at
// compile time by the underlying `items::<"name", T>()`.
bun_collections::multi_array_columns! {
    pub trait InputFileColumns for InputFile {
        source: bun_ast::Source,
        secondary_path: AstVec<u8>,
        loader: options::Loader,
        side_effects: SideEffects,
        additional_files: AstVec<AdditionalFile>,
        unique_key_for_additional_file: Box<[u8], AstAlloc>,
        content_hash_for_additional_file: u64,
        flags: InputFileFlags,
    }
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub struct InputFileFlags: u8 {
        const IS_PLUGIN_FILE = 1 << 0;
        /// Set when a barrel-eligible file has `export * from` this file.
        const IS_EXPORT_STAR_TARGET = 1 << 1;
    }
}

impl<'a> Graph<'a> {
    pub fn new(heap: &'a ThreadLocalArena) -> Self {
        Self {
            // Self-referential arena pointer; real value wired in
            // `BundleV2::init` before any use (Graph.zig has `= undefined`).
            pool: bun_ptr::BackRef::from(NonNull::<ThreadPool>::dangling()),
            heap,
            entry_points: Vec::new(),
            entry_point_original_names: IndexStringMap::default(),
            input_files: MultiArrayList::default(),
            ast: MultiArrayList::default(),
            pending_items: 0,
            deferred_pending: 0,
            build_graphs: EnumMap::default(),
            server_component_boundaries: server_component_boundary::List::default(),
            html_imports: HtmlImports::default(),
            estimated_file_loader_count: 0,
            css_file_count: 0,
            additional_output_files: Vec::new(),
            kit_referenced_server_data: false,
            kit_referenced_client_data: false,
            has_any_secondary_paths: false,
        }
    }
}

impl<'a> Graph<'a> {
    #[inline]
    pub fn pool(&self) -> &ThreadPool {
        self.pool.get()
    }

    /// Exclusive borrow of the bundler `ThreadPool`. Only needed for
    /// `ThreadPool::deinit` during teardown; prefer [`Self::pool`] for
    /// scheduling.
    #[inline]
    pub fn pool_mut(&mut self) -> &mut ThreadPool {
        // SAFETY: see `pool()`. `&mut self` excludes other safe borrows of
        // `Graph`, so no aliasing `&ThreadPool` is live.
        unsafe { self.pool.get_mut() }
    }

    #[inline]
    pub fn path_to_source_index_map(
        &mut self,
        target: options::Target,
    ) -> &mut PathToSourceIndexMap {
        &mut self.build_graphs[target]
    }

    pub fn drain_deferred_tasks(&mut self, transpiler: &mut BundleV2) -> bool {
        transpiler.thread_lock.assert_locked();

        if self.deferred_pending > 0 {
            self.pending_items += self.deferred_pending;
            self.deferred_pending = 0;

            transpiler.drain_defer_task.init();
            transpiler.drain_defer_task.schedule();

            return true;
        }

        false
    }
}

use bun_ast::SideEffects;

// ported from: src/bundler/Graph.zig
