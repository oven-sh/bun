pub const Graph = @This();

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

/// Maps a hashed path string to a source index, if it exists in the compilation.
/// Instead of accessing this directly, consider using BundleV2.pathToSourceIndexMap
path_to_source_index_map: PathToSourceIndexMap = .{},
/// When using server components, a completely separate file listing is
/// required to avoid incorrect inlining of defines and dependencies on
/// other files. This is relevant for files shared between server and client
/// and have no "use <side>" directive, and must be duplicated.
///
/// To make linking easier, this second graph contains indices into the
/// same `.ast` and `.input_files` arrays.
client_path_to_source_index_map: PathToSourceIndexMap = .{},
/// When using server components with React, there is an additional module
/// graph which is used to contain SSR-versions of all client components;
/// the SSR graph. The difference between the SSR graph and the server
/// graph is that this one does not apply '--conditions react-server'
///
/// In Bun's React Framework, it includes SSR versions of 'react' and
/// 'react-dom' (an export condition is used to provide a different
/// implementation for RSC, which is potentially how they implement
/// server-only features such as async components).
ssr_path_to_source_index_map: PathToSourceIndexMap = .{},

/// When Server Components is enabled, this holds a list of all boundary
/// files. This happens for all files with a "use <side>" directive.
server_component_boundaries: ServerComponentBoundary.List = .{},

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

/// Schedule a task to be run on the JS thread which resolves the promise of
/// each `.defer()` called in an onLoad plugin.
///
/// Returns true if there were more tasks queued.
pub fn drainDeferredTasks(this: *@This(), transpiler: *BundleV2) bool {
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
