//! Port of `src/jsc/generated_classes_list.zig`.
//!
//! This file is a thin namespace of type re-exports — the Zig `Classes` struct
//! holds no fields, only `pub const X = path.to.Y;` aliases. It is consumed by
//! the `.classes.ts` codegen to map class names to their Rust payload types.
//!
//! LAYERING: although the `.zig` lives under `src/jsc/`, every aliased type
//! is defined in `bun_runtime` (api / webcore / test_runner / bake) or one of
//! its same-tier deps (`bun_sql_jsc`, `bun_sourcemap_jsc`). Mounting it in
//! `bun_jsc` would create a `bun_jsc → bun_runtime` cycle, so the module is
//! `#[path]`-mounted from `bun_runtime/lib.rs` instead and resolves all paths
//! via `crate::`. `bun_jsc::GeneratedClassesList` is intentionally NOT
//! provided — the only Zig consumer outside codegen is BlockList.zig, which
//! the Rust port reaches `SocketAddress` through `crate::socket` directly.

#[allow(non_snake_case, unused_imports)]
pub mod Classes {
    pub use crate::api::archive as Archive;
    pub use crate::webcore::Blob;
    pub use crate::api::html_rewriter::HTMLRewriter;
    pub use crate::api::html_rewriter::Element;
    pub use crate::api::html_rewriter::Comment;
    pub use crate::api::html_rewriter::TextChunk;
    pub use crate::api::html_rewriter::DocType;
    pub use crate::api::html_rewriter::DocEnd;
    pub use crate::api::html_rewriter::EndTag;
    pub use crate::api::html_rewriter::AttributeIterator;
    pub use crate::crypto::CryptoHasher;
    pub use crate::test_runner::expect::Expect;
    pub use crate::test_runner::expect::ExpectAny;
    pub use crate::test_runner::expect::ExpectAnything;
    pub use crate::test_runner::expect::ExpectCustomAsymmetricMatcher;
    pub use crate::test_runner::expect::ExpectMatcherContext;
    pub use crate::test_runner::expect::ExpectMatcherUtils;
    pub use crate::test_runner::expect::ExpectStatic;
    pub use crate::test_runner::expect::ExpectCloseTo;
    pub use crate::test_runner::expect::ExpectObjectContaining;
    pub use crate::test_runner::expect::ExpectStringContaining;
    pub use crate::test_runner::expect::ExpectStringMatching;
    pub use crate::test_runner::expect::ExpectArrayContaining;
    pub use crate::test_runner::expect::ExpectTypeOf;
    pub use crate::test_runner::scope_functions::ScopeFunctions;
    pub use crate::test_runner::done_callback::DoneCallback;
    pub use crate::api::filesystem_router::FileSystemRouter;
    pub use crate::api::glob as Glob;
    pub use crate::image as Image;
    pub use crate::api::bun::secure_context as SecureContext;
    pub use crate::shell::Interpreter as ShellInterpreter;
    pub use crate::shell::ParsedShellScript;
    pub use crate::api::js_bundler::JSBundler as Bundler;
    pub use Bundler as JSBundler;
    pub use crate::api::js_transpiler as Transpiler;
    pub use Transpiler as JSTranspiler;
    pub use crate::socket::Listener;
    pub use crate::api::filesystem_router::MatchedRoute;
    pub use crate::node::node_fs_binding::Binding as NodeJSFS;
    pub use crate::webcore::Request;
    pub use crate::webcore::Response;
    pub use crate::crypto::MD4;
    pub use crate::crypto::MD5;
    pub use crate::crypto::SHA1;
    pub use crate::crypto::SHA224;
    pub use crate::crypto::SHA256;
    pub use crate::crypto::SHA384;
    pub use crate::crypto::SHA512;
    pub use crate::crypto::SHA512_256;
    pub use crate::server::ServerWebSocket;
    pub use crate::api::bun::subprocess as Subprocess;
    pub use crate::api::bun::subprocess::ResourceUsage;
    pub use crate::api::cron::CronJob;
    pub use crate::api::bun::terminal as Terminal;
    pub use crate::socket::TCPSocket;
    pub use crate::socket::TLSSocket;
    pub use crate::socket::udp_socket::UDPSocket;
    pub use crate::socket::SocketAddress;
    pub use crate::webcore::TextDecoder;
    pub use crate::timer::TimeoutObject as Timeout;
    pub use crate::timer::ImmediateObject as Immediate;
    pub use crate::api::js_bundler::BuildArtifact;
    pub use bun_jsc::BuildMessage;
    pub use bun_jsc::ResolveMessage;
    pub use crate::node::node_fs_watcher::FSWatcher;
    pub use crate::node::node_fs_stat_watcher::StatWatcher;
    pub use crate::server::HTTPServer;
    pub use crate::server::HTTPSServer;
    pub use crate::server::DebugHTTPServer;
    pub use crate::server::DebugHTTPSServer;
    pub use crate::webcore::crypto::Crypto;
    pub use crate::ffi::FFI;
    pub use crate::api::bun::h2_frame_parser::H2FrameParser;
    pub use crate::webcore::file_reader::Source as FileInternalReadableStreamSource;
    pub use crate::webcore::byte_blob_loader::Source as BlobInternalReadableStreamSource;
    pub use crate::webcore::byte_stream::Source as BytesInternalReadableStreamSource;
    pub use bun_sql_jsc::postgres::PostgresSQLConnection;
    pub use bun_sql_jsc::mysql::MySQLConnection;
    pub use bun_sql_jsc::postgres::PostgresSQLQuery;
    pub use bun_sql_jsc::mysql::MySQLQuery;
    pub use crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder;
    pub use crate::node::zlib::native_zlib as NativeZlib;
    pub use crate::node::zlib::native_brotli as NativeBrotli;
    pub use crate::server::NodeHTTPResponse;
    pub use crate::bake::framework_router::JSFrameworkRouter as FrameworkFileSystemRouter;
    pub use crate::dns_jsc::Resolver as DNSResolver;
    pub use crate::webcore::S3Client;
    pub use crate::webcore::S3Stat;
    pub use crate::webcore::ResumableFetchSink;
    pub use crate::webcore::ResumableS3UploadSink;
    pub use crate::server::HTMLBundle;
    pub use crate::valkey_jsc::js_valkey::JSValkeyClient as RedisClient;
    pub use crate::node::net::block_list as BlockList;
    pub use crate::node::zlib::native_zstd as NativeZstd;
    pub use bun_sourcemap_jsc::JSSourceMap as SourceMap;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/generated_classes_list.zig (104 lines)
//   confidence: high
//   todos:      0
//   notes:      pure re-export namespace; mounted in bun_runtime (not bun_jsc) to break dep cycle
// ──────────────────────────────────────────────────────────────────────────
