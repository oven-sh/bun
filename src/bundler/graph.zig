const Transpiler = bun.Transpiler;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;

const std = @import("std");
const lex = @import("../js_lexer.zig");
const Logger = @import("../logger.zig");
const options = @import("../options.zig");
const js_parser = bun.js_parser;
const Part = js_ast.Part;
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const sourcemap = bun.sourcemap;
const StringJoiner = bun.StringJoiner;
const base64 = bun.base64;
pub const Ref = @import("../ast/base.zig").Ref;
const ThreadPoolLib = @import("../thread_pool.zig");
const ThreadlocalArena = @import("../allocators/mimalloc_arena.zig").Arena;
const BabyList = @import("../baby_list.zig").BabyList;
const Fs = @import("../fs.zig");
const schema = @import("../api/schema.zig");
const Api = schema.Api;
const _resolver = @import("../resolver/resolver.zig");
const sync = bun.ThreadPool;
const ImportRecord = bun.ImportRecord;
const ImportKind = bun.ImportKind;
const allocators = @import("../allocators.zig");
const resolve_path = @import("../resolver/resolve_path.zig");
const runtime = @import("../runtime.zig");
const Timer = @import("../system_timer.zig");
const OOM = bun.OOM;

const HTMLScanner = @import("../HTMLScanner.zig");
const isPackagePath = _resolver.isPackagePath;
const NodeFallbackModules = @import("../node_fallbacks.zig");
const CacheEntry = @import("../cache.zig").Fs.Entry;
const URL = @import("../url.zig").URL;
const Resolver = _resolver.Resolver;
const TOML = @import("../toml/toml_parser.zig").TOML;
const Dependency = js_ast.Dependency;
const JSAst = js_ast.BundledAst;
const Loader = options.Loader;
pub const Index = @import("../ast/base.zig").Index;
const Symbol = js_ast.Symbol;
const EventLoop = bun.JSC.AnyEventLoop;
const MultiArrayList = bun.MultiArrayList;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;
const Binding = js_ast.Binding;
const AutoBitSet = bun.bit_set.AutoBitSet;
const renamer = bun.renamer;
const StableSymbolCount = renamer.StableSymbolCount;
const MinifyRenamer = renamer.MinifyRenamer;
const Scope = js_ast.Scope;
const JSC = bun.JSC;
const debugTreeShake = Output.scoped(.TreeShake, true);
const debugPartRanges = Output.scoped(.PartRanges, true);
const BitSet = bun.bit_set.DynamicBitSetUnmanaged;
const Async = bun.Async;
const Loc = Logger.Loc;
const bake = bun.bake;
const lol = bun.LOLHTML;
const DataURL = @import("../resolver/resolver.zig").DataURL;
const DeferredBatchTask = @import("deferred_batch_task.zig").DeferredBatchTask;
const ThreadPool = @import("thread_pool.zig").ThreadPool;
const ParseTask = @import("parse_task.zig").ParseTask;
const PathToSourceIndexMap = @import("bundle_v2.zig").PathToSourceIndexMap;
const ServerComponentBoundary = js_ast.ServerComponentBoundary;
const BundleV2 = @import("bundle_v2.zig").BundleV2;
const AdditionalFile = @import("bundle_v2.zig").AdditionalFile;

pub const Graph = struct {
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
};
