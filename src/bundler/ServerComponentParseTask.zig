/// Files for Server Components are generated using `AstBuilder`, instead of
/// running through the js_parser. It emits a ParseTask.Result and joins
/// with the same logic that it runs though.
pub const ServerComponentParseTask = @This();

task: ThreadPoolLib.Task = .{ .callback = &taskCallbackWrap },
data: Data,
ctx: *BundleV2,
source: Logger.Source,

pub const Data = union(enum) {
    /// Generate server-side code for a "use client" module. Given the
    /// client ast, a "reference proxy" is created with identical exports.
    client_reference_proxy: ReferenceProxy,

    client_entry_wrapper: ClientEntryWrapper,

    pub const ReferenceProxy = struct {
        other_source: Logger.Source,
        named_exports: JSAst.NamedExports,
    };

    pub const ClientEntryWrapper = struct {
        path: []const u8,
    };
};

fn taskCallbackWrap(thread_pool_task: *ThreadPoolLib.Task) void {
    const task: *ServerComponentParseTask = @fieldParentPtr("task", thread_pool_task);
    var worker = ThreadPool.Worker.get(task.ctx);
    defer worker.unget();
    var log = Logger.Log.init(worker.allocator);

    const result = bun.handleOom(bun.default_allocator.create(ParseTask.Result));
    result.* = .{
        .ctx = task.ctx,
        .task = undefined,

        .value = if (taskCallback(
            task,
            &log,
            worker.allocator,
        )) |success|
            .{ .success = success }
        else |err| switch (err) {
            error.OutOfMemory => bun.outOfMemory(),
        },

        .watcher_data = .none,
    };

    switch (worker.ctx.loop().*) {
        .js => |jsc_event_loop| {
            jsc_event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(result, ParseTask.onComplete));
        },
        .mini => |*mini| {
            mini.enqueueTaskConcurrentWithExtraCtx(
                ParseTask.Result,
                BundleV2,
                result,
                BundleV2.onParseTaskComplete,
                .task,
            );
        },
    }
}

fn taskCallback(
    task: *ServerComponentParseTask,
    log: *Logger.Log,
    allocator: std.mem.Allocator,
) bun.OOM!ParseTask.Result.Success {
    var ab = try AstBuilder.init(allocator, &task.source, task.ctx.transpiler.options.hot_module_reloading);

    switch (task.data) {
        .client_reference_proxy => |data| try task.generateClientReferenceProxy(data, &ab),
        .client_entry_wrapper => |data| try task.generateClientEntryWrapper(data, &ab),
    }

    var bundled_ast = try ab.toBundledAst(switch (task.data) {
        // Server-side
        .client_reference_proxy => task.ctx.transpiler.options.target,
        // Client-side,
        .client_entry_wrapper => .browser,
    });

    // `wrapper_ref` is used to hold the HMR api ref (see comment in
    // `src/ast/Ast.zig`)
    bundled_ast.wrapper_ref = ab.hmr_api_ref;

    return .{
        .ast = bundled_ast,
        .source = task.source,
        .loader = .js,
        .log = log.*,
        .use_directive = .none,
        .side_effects = .no_side_effects__pure_data,
    };
}

fn generateClientEntryWrapper(_: *ServerComponentParseTask, data: Data.ClientEntryWrapper, b: *AstBuilder) !void {
    const record = try b.addImportRecord(data.path, .stmt);
    const namespace_ref = try b.newSymbol(.other, "main");
    try b.appendStmt(S.Import{
        .namespace_ref = namespace_ref,
        .import_record_index = record,
        .items = &.{},
        .is_single_line = true,
    });
    b.import_records.items[record].flags.was_originally_bare_import = true;
}

fn generateClientReferenceProxy(task: *ServerComponentParseTask, data: Data.ReferenceProxy, b: *AstBuilder) !void {
    const server_components = task.ctx.framework.?.server_components orelse
        unreachable; // config must be non-null to enter this function

    const client_named_exports = data.named_exports;

    const register_client_reference = (try b.addImportStmt(
        server_components.server_runtime_import,
        &.{server_components.server_register_client_reference},
    ))[0];

    const module_path = b.newExpr(E.String{
        // In development, the path loaded is the source file: Easy!
        //
        // In production, the path here must be the final chunk path, but
        // that information is not yet available since chunks are not
        // computed. The unique_key replacement system is used here.
        .data = if (task.ctx.transpiler.options.dev_server != null)
            data.other_source.path.pretty
        else
            try std.fmt.allocPrint(b.allocator, "{f}S{d:0>8}", .{
                bun.fmt.hexIntLower(task.ctx.unique_key),
                data.other_source.index.get(),
            }),
    });

    for (client_named_exports.keys()) |key| {
        const is_default = bun.strings.eqlComptime(key, "default");

        // This error message is taken from
        // https://github.com/facebook/react/blob/c5b9375767e2c4102d7e5559d383523736f1c902/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js#L323-L354
        const err_msg_string = try if (is_default)
            std.fmt.allocPrint(
                b.allocator,
                "Attempted to call the default export of {[module_path]s} from " ++
                    "the server, but it's on the client. It's not possible to invoke a " ++
                    "client function from the server, it can only be rendered as a " ++
                    "Component or passed to props of a Client Component.",
                .{ .module_path = data.other_source.path.pretty },
            )
        else
            std.fmt.allocPrint(
                b.allocator,
                "Attempted to call {[key]s}() from the server but {[key]s} " ++
                    "is on the client. It's not possible to invoke a client function from " ++
                    "the server, it can only be rendered as a Component or passed to " ++
                    "props of a Client Component.",
                .{ .key = key },
            );

        // throw new Error(...)
        const err_msg = b.newExpr(E.New{
            .target = b.newExpr(E.Identifier{
                .ref = try b.newExternalSymbol("Error"),
            }),
            .args = try BabyList(Expr).fromSlice(b.allocator, &.{
                b.newExpr(E.String{ .data = err_msg_string }),
            }),
            .close_parens_loc = Logger.Loc.Empty,
        });

        // registerClientReference(
        //   () => { throw new Error(...) },
        //   "src/filepath.tsx",
        //   "Comp"
        // );
        const value = b.newExpr(E.Call{
            .target = register_client_reference,
            .args = try js_ast.ExprNodeList.fromSlice(b.allocator, &.{
                b.newExpr(E.Arrow{ .body = .{
                    .stmts = try b.allocator.dupe(Stmt, &.{
                        b.newStmt(S.Throw{ .value = err_msg }),
                    }),
                    .loc = Logger.Loc.Empty,
                } }),
                module_path,
                b.newExpr(E.String{ .data = key }),
            }),
        });

        if (is_default) {
            const ref = try b.newSymbol(.other, "default");
            // export default registerClientReference(...);
            try b.appendStmt(S.ExportDefault{ .value = .{ .expr = value }, .default_name = .{ .ref = ref } });
        } else {
            // export const Component = registerClientReference(...);
            const export_ref = try b.newSymbol(.other, key);
            try b.appendStmt(S.Local{
                .decls = try G.Decl.List.fromSlice(b.allocator, &.{.{
                    .binding = Binding.alloc(b.allocator, B.Identifier{ .ref = export_ref }, Logger.Loc.Empty),
                    .value = value,
                }}),
                .is_export = true,
                .kind = .k_const,
            });
        }
    }
}

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const options = @import("../options.zig");
const std = @import("std");

const Logger = @import("../logger.zig");
const Loc = Logger.Loc;

const bun = @import("bun");
const OOM = bun.OOM;
const ThreadPoolLib = bun.ThreadPool;
const default_allocator = bun.default_allocator;
const js_parser = bun.js_parser;
const jsc = bun.jsc;
const strings = bun.strings;
const BabyList = bun.collections.BabyList;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const JSAst = js_ast.BundledAst;
const S = js_ast.S;
const Stmt = js_ast.Stmt;

const bundler = bun.bundle_v2;
const AstBuilder = bundler.AstBuilder;
const BundleV2 = bundler.BundleV2;
