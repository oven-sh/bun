//! "api" in this context means "the Bun APIs", as in "the exposed JS APIs"

/// `globalThis.Bun`
pub const Bun = @import("api/BunObject.zig");
pub const Subprocess = Bun.Subprocess;

pub const AnyRequestContext = @import("api/server.zig").AnyRequestContext;
pub const AnyServer = @import("api/server.zig").AnyServer;
pub const BuildArtifact = @import("api/JSBundler.zig").BuildArtifact;
pub const BuildMessage = @import("api/BuildMessage.zig").BuildMessage;
pub const DNS = @import("api/bun/dns_resolver.zig");
pub const DebugHTTPSServer = @import("api/server.zig").DebugHTTPSServer;
pub const DebugHTTPServer = @import("api/server.zig").DebugHTTPServer;
pub const FFI = @import("api/ffi.zig").FFI;
pub const HTMLRewriter = @import("api/html_rewriter.zig");
pub const FileSystemRouter = @import("api/filesystem_router.zig").FileSystemRouter;
pub const Glob = @import("api/glob.zig");
pub const H2FrameParser = @import("api/bun/h2_frame_parser.zig").H2FrameParser;
pub const HTMLBundle = @import("api/server/HTMLBundle.zig");
pub const HTTPSServer = @import("api/server.zig").HTTPSServer;
pub const HTTPServer = @import("api/server.zig").HTTPServer;
pub const JSBundler = @import("api/JSBundler.zig").JSBundler;
pub const JSTranspiler = @import("api/JSTranspiler.zig");
pub const Listener = @import("api/bun/socket.zig").Listener;
pub const MatchedRoute = @import("api/filesystem_router.zig").MatchedRoute;
pub const NativeBrotli = @import("node/node_zlib_binding.zig").SNativeBrotli;
pub const NativeZlib = @import("node/node_zlib_binding.zig").SNativeZlib;
pub const NodeHTTPResponse = @import("api/server.zig").NodeHTTPResponse;
pub const Postgres = @import("../sql/postgres.zig");
pub const ResolveMessage = @import("api/ResolveMessage.zig").ResolveMessage;
pub const SavedRequest = @import("api/server.zig").SavedRequest;
pub const ServerConfig = @import("api/server.zig").ServerConfig;
pub const ServerWebSocket = @import("api/server.zig").ServerWebSocket;
pub const Shell = @import("shell/shell.zig");
pub const SocketAddress = @import("api/bun/socket.zig").SocketAddress;
pub const TCPSocket = @import("api/bun/socket.zig").TCPSocket;
pub const TLSSocket = @import("api/bun/socket.zig").TLSSocket;
pub const UDPSocket = @import("api/bun/udp_socket.zig").UDPSocket;
pub const Valkey = @import("../valkey/js_valkey.zig").JSValkeyClient;

pub const napi = @import("../napi/napi.zig");

pub const node = struct {
    pub const fs = @import("node/node_fs.zig");
    pub const crypto = @import("node/node_crypto_binding.zig");
    pub const os = @import("./bun.js/node/node_os.zig");
    // pub const fs = @import("./bun.js/node/node_fs_constant.zig");

    //     pub usingnamespace @import("./bun.js/node/types.zig");
    // pub usingnamespace @import("./bun.js/node/node_fs_watcher.zig");
    // pub usingnamespace @import("./bun.js/node/node_fs_stat_watcher.zig");
    // pub usingnamespace @import("./bun.js/node/node_fs_binding.zig");

    pub const process = @import("Process.zig").Process;
    comptime {
        _ = process.getTitle;
        _ = process.setTitle;
        _ = @import("node/util/parse_args.zig");
    }
};
