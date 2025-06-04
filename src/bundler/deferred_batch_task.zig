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

/// This task is run once all parse and resolve tasks have been complete
/// and we have deferred onLoad plugins that we need to resume
///
/// It enqueues a task to be run on the JS thread which resolves the promise
/// for every onLoad callback which called `.defer()`.
pub const DeferredBatchTask = struct {
    running: if (Environment.isDebug) bool else u0 = if (Environment.isDebug) false else 0,

    const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

    pub fn init(this: *DeferredBatchTask) void {
        if (comptime Environment.isDebug) bun.debugAssert(!this.running);
        this.* = .{
            .running = if (comptime Environment.isDebug) false else 0,
        };
    }

    pub fn getBundleV2(this: *DeferredBatchTask) *bun.BundleV2 {
        return @alignCast(@fieldParentPtr("drain_defer_task", this));
    }

    pub fn schedule(this: *DeferredBatchTask) void {
        if (comptime Environment.isDebug) {
            bun.assert(!this.running);
            this.running = false;
        }
        this.getBundleV2().jsLoopForPlugins().enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this)));
    }

    pub fn deinit(this: *DeferredBatchTask) void {
        if (comptime Environment.isDebug) {
            this.running = false;
        }
    }

    pub fn runOnJSThread(this: *DeferredBatchTask) void {
        defer this.deinit();
        var bv2 = this.getBundleV2();
        bv2.plugins.?.drainDeferred(
            if (bv2.completion) |completion|
                completion.result == .err
            else
                false,
        );
    }
};
