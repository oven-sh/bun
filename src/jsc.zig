// Top-level so it can access all files
pub usingnamespace @import("./bun.js/base.zig");
pub usingnamespace @import("./bun.js/bindings/bindings.zig");
pub usingnamespace @import("./bun.js/bindings/exports.zig");
pub usingnamespace @import("./bun.js/event_loop.zig");
pub usingnamespace @import("./bun.js/javascript.zig");
pub usingnamespace @import("./bun.js/module_loader.zig");
pub const Debugger = @import("./bun.js/bindings/Debugger.zig").Debugger;
pub const napi = @import("./napi/napi.zig");
pub const RareData = @import("./bun.js/rare_data.zig");
pub const Shimmer = @import("./bun.js/bindings/shimmer.zig").Shimmer;
pub const C = @import("./bun.js/javascript_core_c_api.zig");
pub const WebCore = @import("./bun.js/webcore.zig");
pub const BuildMessage = @import("./bun.js/BuildMessage.zig").BuildMessage;
pub const ResolveMessage = @import("./bun.js/ResolveMessage.zig").ResolveMessage;
pub const Cloudflare = struct {
    pub const HTMLRewriter = @import("./bun.js/api/html_rewriter.zig").HTMLRewriter;
    pub const ContentOptions = @import("./bun.js/api/html_rewriter.zig").ContentOptions;
    pub const Element = @import("./bun.js/api/html_rewriter.zig").Element;
    pub const Comment = @import("./bun.js/api/html_rewriter.zig").Comment;
    pub const TextChunk = @import("./bun.js/api/html_rewriter.zig").TextChunk;
    pub const DocType = @import("./bun.js/api/html_rewriter.zig").DocType;
    pub const DocEnd = @import("./bun.js/api/html_rewriter.zig").DocEnd;
    pub const EndTag = @import("./bun.js/api/html_rewriter.zig").EndTag;
    pub const AttributeIterator = @import("./bun.js/api/html_rewriter.zig").AttributeIterator;
};
pub const Jest = @import("./bun.js/test/jest.zig");
pub const Expect = @import("./bun.js/test/expect.zig");
pub const Snapshot = @import("./bun.js/test/snapshot.zig");
pub const API = struct {
    pub const Glob = @import("./bun.js/api/glob.zig");
    pub const Shell = @import("./shell/shell.zig");
    pub const JSBundler = @import("./bun.js/api/JSBundler.zig").JSBundler;
    pub const BuildArtifact = @import("./bun.js/api/JSBundler.zig").BuildArtifact;
    pub const JSTranspiler = @import("./bun.js/api/JSTranspiler.zig");
    pub const HTTPServer = @import("./bun.js/api/server.zig").HTTPServer;
    pub const AnyServer = @import("./bun.js/api/server.zig").AnyServer;
    pub const SavedRequest = @import("./bun.js/api/server.zig").SavedRequest;
    pub const ServerConfig = @import("./bun.js/api/server.zig").ServerConfig;
    pub const ServerWebSocket = @import("./bun.js/api/server.zig").ServerWebSocket;
    pub const HTTPSServer = @import("./bun.js/api/server.zig").HTTPSServer;
    pub const DebugHTTPServer = @import("./bun.js/api/server.zig").DebugHTTPServer;
    pub const DebugHTTPSServer = @import("./bun.js/api/server.zig").DebugHTTPSServer;
    pub const AnyRequestContext = @import("./bun.js/api/server.zig").AnyRequestContext;
    pub const Bun = @import("./bun.js/api/BunObject.zig");
    pub const FileSystemRouter = @import("./bun.js/api/filesystem_router.zig").FileSystemRouter;
    pub const MatchedRoute = @import("./bun.js/api/filesystem_router.zig").MatchedRoute;
    pub const TCPSocket = @import("./bun.js/api/bun/socket.zig").TCPSocket;
    pub const TLSSocket = @import("./bun.js/api/bun/socket.zig").TLSSocket;
    pub const UDPSocket = @import("./bun.js/api/bun/udp_socket.zig").UDPSocket;
    pub const Listener = @import("./bun.js/api/bun/socket.zig").Listener;
    pub const H2FrameParser = @import("./bun.js/api/bun/h2_frame_parser.zig").H2FrameParser;
    pub const NativeZlib = @import("./bun.js/node/node_zlib_binding.zig").SNativeZlib;
    pub const NativeBrotli = @import("./bun.js/node/node_zlib_binding.zig").SNativeBrotli;
    pub const HTMLBundle = @import("./bun.js/api/server/HTMLBundle.zig");
};
pub const Postgres = @import("./sql/postgres.zig");
pub const DNS = @import("./bun.js/api/bun/dns_resolver.zig");
pub const FFI = @import("./bun.js/api/ffi.zig").FFI;
pub const Node = struct {
    pub usingnamespace @import("./bun.js/node/types.zig");
    pub usingnamespace @import("./bun.js/node/node_fs.zig");
    pub usingnamespace @import("./bun.js/node/node_fs_watcher.zig");
    pub usingnamespace @import("./bun.js/node/node_fs_stat_watcher.zig");
    pub usingnamespace @import("./bun.js/node/node_fs_binding.zig");
    pub usingnamespace @import("./bun.js/node/node_os.zig");
    pub const fs = @import("./bun.js/node/node_fs_constant.zig");
    pub const Util = struct {
        pub const parseArgs = @import("./bun.js/node/util/parse_args.zig").parseArgs;
    };
};

const std = @import("std");
const Syscall = @import("./sys.zig");
const Output = @import("./output.zig");

pub const Maybe = Syscall.Maybe;
pub const jsBoolean = @This().JSValue.jsBoolean;
pub const jsEmptyString = @This().JSValue.jsEmptyString;
pub const jsNumber = @This().JSValue.jsNumber;

const __jsc_log = Output.scoped(.JSC, true);
pub inline fn markBinding(src: std.builtin.SourceLocation) void {
    __jsc_log("{s} ({s}:{d})", .{ src.fn_name, src.file, src.line });
}
pub const Subprocess = API.Bun.Subprocess;
pub const ResourceUsage = API.Bun.ResourceUsage;

/// This file is generated by:
///  1. `bun src/bun.js/scripts/generate-classes.ts`
///  2. Scan for **/*.classes.ts files in src/bun.js/src
///  3. Generate a JS wrapper for each class in:
///        - Zig: generated_classes.zig
///        - C++: ZigGeneratedClasses.h, ZigGeneratedClasses.cpp
///  4. For the Zig code to successfully compile:
///        - Add it to generated_classes_list.zig
///        - pub usingnamespace JSC.Codegen.JSMyClassName;
///  5. make clean-bindings && make bindings -j10
///
pub const Codegen = struct {
    pub const GeneratedClasses = @import("ZigGeneratedClasses");
    pub usingnamespace GeneratedClasses;
    pub usingnamespace @import("./bun.js/bindings/codegen.zig");
};

pub const GeneratedClassesList = @import("./bun.js/bindings/generated_classes_list.zig").Classes;

pub const RuntimeTranspilerCache = @import("./bun.js/RuntimeTranspilerCache.zig").RuntimeTranspilerCache;

/// The calling convention used for JavaScript functions <> Native
const bun = @import("root").bun;
pub const conv = if (bun.Environment.isWindows and bun.Environment.isX64)
    std.builtin.CallingConvention.SysV
else
    std.builtin.CallingConvention.C;

pub const Error = @import("ErrorCode").Error;

pub const MAX_SAFE_INTEGER = 9007199254740991;

pub const MIN_SAFE_INTEGER = -9007199254740991;
