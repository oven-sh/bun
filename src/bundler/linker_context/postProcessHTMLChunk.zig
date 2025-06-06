pub fn postProcessHTMLChunk(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk) !void {
    // This is where we split output into pieces
    const c = ctx.c;
    var j = StringJoiner{
        .allocator = worker.allocator,
        .watcher = .{
            .input = chunk.unique_key,
        },
    };

    const compile_results = chunk.compile_results_for_chunk;

    for (compile_results) |compile_result| {
        j.push(compile_result.code(), bun.default_allocator);
    }

    j.ensureNewlineAtEnd();

    chunk.intermediate_output = c.breakOutputIntoPieces(
        worker.allocator,
        &j,
        @as(u32, @truncate(ctx.chunks.len)),
    ) catch bun.outOfMemory();

    chunk.isolated_hash = c.generateIsolatedHash(chunk);
}

const bun = @import("bun");
const BabyList = bun.BabyList;
const strings = bun.strings;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Index = bun.bundle_v2.Index;
const ImportRecord = bun.ImportRecord;
const Part = bun.bundle_v2.Part;
const Loader = bun.Loader;
const std = @import("std");
const debug = LinkerContext.debug;
const EntryPoint = bun.bundle_v2.EntryPoint;

const JSMeta = bun.bundle_v2.JSMeta;
const JSAst = bun.bundle_v2.JSAst;
const js_ast = bun.bundle_v2.js_ast;
const Ref = bun.bundle_v2.js_ast.Ref;
const Environment = bun.Environment;
const ResolvedExports = bun.bundle_v2.ResolvedExports;
const ExportData = bun.bundle_v2.ExportData;
const FeatureFlags = bun.FeatureFlags;
const Logger = bun.logger;
const RefImportData = bun.bundle_v2.RefImportData;
const ImportData = bun.bundle_v2.ImportData;
const Dependency = js_ast.Dependency;
const options = bun.options;
const js_printer = bun.bundle_v2.js_printer;
const renamer = bun.bundle_v2.renamer;
const Chunk = bun.bundle_v2.Chunk;
const PartRange = bun.bundle_v2.PartRange;
const StmtList = LinkerContext.StmtList;

const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;

const Binding = js_ast.Binding;

const genericPathWithPrettyInitialized = bun.bundle_v2.genericPathWithPrettyInitialized;

const GenerateChunkCtx = bun.bundle_v2.LinkerContext.GenerateChunkCtx;
const ThreadPool = bun.bundle_v2.ThreadPool;

const Scope = js_ast.Scope;
const Fs = bun.bundle_v2.Fs;
const CompileResult = bun.bundle_v2.CompileResult;
const StringJoiner = bun.StringJoiner;

const CompileResultForSourceMap = bun.bundle_v2.CompileResultForSourceMap;

const MutableString = bun.MutableString;
