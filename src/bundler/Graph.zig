const Graph = @This();

pool: *ThreadPool,
heap: ThreadlocalArena = .{},
/// This allocator is thread-local to the Bundler thread
/// .allocator == .heap.allocator()
allocator: std.mem.Allocator = undefined,

/// Mapping user-specified entry points to their Source Index
entry_points: std.ArrayListUnmanaged(Index) = .{},
/// Every source index has an associated InputFile
input_files: MultiArrayList(InputFile) = .{},
/// Every source index has an associated Ast
/// When a parse is in progress / queued, it is `Ast.empty`
ast: MultiArrayList(JSAst) = .{},

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
pending_items: u32 = 0,
/// When an `onLoad` plugin calls `.defer()`, the count from `pending_items`
/// is "moved" into this counter (pending_items -= 1; deferred_pending += 1)
///
/// When `pending_items` hits zero and there are deferred pending tasks, those
/// tasks will be run, and the count is "moved" back to `pending_items`
deferred_pending: u32 = 0,

/// A map of build targets to their corresponding module graphs.
build_graphs: std.EnumArray(options.Target, PathToSourceIndexMap) = .initFill(.{}),

/// When Server Components is enabled, this holds a list of all boundary
/// files. This happens for all files with a "use <side>" directive.
server_component_boundaries: ServerComponentBoundary.List = .{},

/// Track HTML imports from server-side code
/// Each entry represents a server file importing an HTML file that needs a client build
///
/// OutputPiece.Kind.HTMLManifest corresponds to indices into the array.
html_imports: struct {
    /// Source index of the server file doing the import
    server_source_indices: BabyList(Index.Int) = .{},
    /// Source index of the HTML file being imported
    html_source_indices: BabyList(Index.Int) = .{},
} = .{},

estimated_file_loader_count: usize = 0,

/// For Bake, a count of the CSS asts is used to make precise
/// pre-allocations without re-iterating the file listing.
css_file_count: usize = 0,

additional_output_files: std.ArrayListUnmanaged(options.OutputFile) = .{},

kit_referenced_server_data: bool,
kit_referenced_client_data: bool,

pub const InputFile = struct {
    source: Logger.Source,
    loader: options.Loader = options.Loader.file,
    side_effects: _resolver.SideEffects,
    allocator: std.mem.Allocator = bun.default_allocator,
    additional_files: BabyList(AdditionalFile) = .{},
    unique_key_for_additional_file: string = "",
    content_hash_for_additional_file: u64 = 0,
    is_plugin_file: bool = false,
};

pub inline fn pathToSourceIndexMap(this: *Graph, target: options.Target) *PathToSourceIndexMap {
    return this.build_graphs.getPtr(target);
}

/// Schedule a task to be run on the JS thread which resolves the promise of
/// each `.defer()` called in an onLoad plugin.
///
/// Returns true if there were more tasks queued.
pub fn drainDeferredTasks(this: *Graph, transpiler: *BundleV2) bool {
    transpiler.thread_lock.assertLocked();

    if (this.deferred_pending > 0) {
        this.pending_items += this.deferred_pending;
        this.deferred_pending = 0;

        transpiler.drain_defer_task.init();
        transpiler.drain_defer_task.schedule();

        return true;
    }

    return false;
}

const bun = @import("bun");
const string = bun.string;
const default_allocator = bun.default_allocator;

const std = @import("std");
const Logger = @import("../logger.zig");
const options = @import("../options.zig");
const js_ast = @import("../js_ast.zig");
pub const Ref = @import("../ast/base.zig").Ref;
const ThreadlocalArena = @import("../allocators/mimalloc_arena.zig").Arena;
const BabyList = @import("../baby_list.zig").BabyList;
const _resolver = @import("../resolver/resolver.zig");
const allocators = @import("../allocators.zig");

const JSAst = js_ast.BundledAst;
const Loader = options.Loader;
pub const Index = @import("../ast/base.zig").Index;
const MultiArrayList = bun.MultiArrayList;
const ThreadPool = bun.bundle_v2.ThreadPool;
const ParseTask = bun.bundle_v2.ParseTask;
const PathToSourceIndexMap = bun.bundle_v2.PathToSourceIndexMap;
const ServerComponentBoundary = js_ast.ServerComponentBoundary;
const BundleV2 = bun.bundle_v2.BundleV2;
const AdditionalFile = bun.bundle_v2.AdditionalFile;
