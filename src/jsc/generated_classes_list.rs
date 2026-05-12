//! Port of `src/jsc/generated_classes_list.zig`.
//!
//! LAYERING: the Zig `Classes` struct is a flat namespace of
//! `pub const X = path.to.Y;` aliases mapping each `.classes.ts` class name to
//! its native backing type. Every target lives under `bun.api`, `bun.webcore`,
//! `bun.bake`, or `bun.SourceMap` — i.e. in the Rust crate graph, in
//! `bun_runtime` / `bun_sql_jsc` / `bun_sourcemap_jsc`, all of which **depend
//! on** `bun_jsc`. Re-exporting them from `bun_jsc` would create a hard cycle.
//!
//! Zig gets away with this because the whole tree is one lazy compilation unit
//! and `generated_classes_list.zig` is only consumed by the **Zig** codegen
//! output (`ZigGeneratedClasses.zig`, via `const Classes = jsc.GeneratedClassesList;`
//! at `generate-classes.ts:3296`). The **Rust** codegen output
//! (`generated_classes.rs`) does **not** consume this list — it resolves each
//! class to its Rust struct via `rustModuleResolver.resolveStruct`
//! (`generate-classes.ts:2602`/`:3450`) and is `include!`d into `bun_runtime`
//! where every backing type is already in scope.
//!
//! The single in-tree Zig consumer outside codegen
//! (`src/runtime/node/net/BlockList.zig:255` →
//! `bun.jsc.GeneratedClassesList.SocketAddress`) is ported as a direct
//! `crate::socket::SocketAddress` import in `BlockList.rs`.
//!
//! Resolution: this file is `#[path]`-mounted from **`bun_runtime/lib.rs`**
//! (not `bun_jsc/lib.rs`) so every alias resolves via `crate::`. The public
//! name is `bun_runtime::GeneratedClassesList`; `bun_jsc::GeneratedClassesList`
//! is intentionally absent.

#[allow(non_snake_case, unused_imports)]
pub mod Classes {
    pub use crate::api::archive as Archive;
    pub use crate::api::bun::secure_context as SecureContext;
    pub use crate::api::filesystem_router::FileSystemRouter;
    pub use crate::api::glob as Glob;
    pub use crate::api::html_rewriter::AttributeIterator;
    pub use crate::api::html_rewriter::Comment;
    pub use crate::api::html_rewriter::DocEnd;
    pub use crate::api::html_rewriter::DocType;
    pub use crate::api::html_rewriter::Element;
    pub use crate::api::html_rewriter::EndTag;
    pub use crate::api::html_rewriter::HTMLRewriter;
    pub use crate::api::html_rewriter::TextChunk;
    pub use crate::crypto::CryptoHasher;
    pub use crate::image as Image;
    pub use crate::shell::Interpreter as ShellInterpreter;
    pub use crate::test_runner::done_callback::DoneCallback;
    pub use crate::test_runner::expect::Expect;
    pub use crate::test_runner::expect::ExpectAny;
    pub use crate::test_runner::expect::ExpectAnything;
    pub use crate::test_runner::expect::ExpectArrayContaining;
    pub use crate::test_runner::expect::ExpectCloseTo;
    pub use crate::test_runner::expect::ExpectCustomAsymmetricMatcher;
    pub use crate::test_runner::expect::ExpectMatcherContext;
    pub use crate::test_runner::expect::ExpectMatcherUtils;
    pub use crate::test_runner::expect::ExpectObjectContaining;
    pub use crate::test_runner::expect::ExpectStatic;
    pub use crate::test_runner::expect::ExpectStringContaining;
    pub use crate::test_runner::expect::ExpectStringMatching;
    pub use crate::test_runner::expect::ExpectTypeOf;
    pub use crate::test_runner::scope_functions::ScopeFunctions;
    pub use crate::webcore::Blob;
    // `crate::shell::ParsedShellScript` is a `(())` placeholder left over from
    // the Phase-A scaffold; the real struct lives in the `parsed_shell_script`
    // submodule. Re-export the real one so codegen sees the correct payload.
    pub use crate::api::bun::h2_frame_parser::H2FrameParser;
    pub use crate::api::bun::subprocess as Subprocess;
    pub use crate::api::bun::subprocess::ResourceUsage;
    pub use crate::api::bun::terminal as Terminal;
    pub use crate::api::cron::CronJob;
    pub use crate::api::filesystem_router::MatchedRoute;
    pub use crate::api::js_bundler::BuildArtifact;
    pub use crate::api::js_bundler::JSBundler as Bundler;
    pub use crate::api::js_transpiler as Transpiler;
    pub use crate::bake::framework_router::JSFrameworkRouter as FrameworkFileSystemRouter;
    pub use crate::crypto::MD4;
    pub use crate::crypto::MD5;
    pub use crate::crypto::SHA1;
    pub use crate::crypto::SHA224;
    pub use crate::crypto::SHA256;
    pub use crate::crypto::SHA384;
    pub use crate::crypto::SHA512;
    pub use crate::crypto::SHA512_256;
    pub use crate::dns_jsc::Resolver as DNSResolver;
    pub use crate::ffi::FFI;
    pub use crate::node::net::block_list as BlockList;
    pub use crate::node::node_fs_binding::Binding as NodeJSFS;
    pub use crate::node::node_fs_stat_watcher::StatWatcher;
    pub use crate::node::node_fs_watcher::FSWatcher;
    pub use crate::node::zlib::native_brotli as NativeBrotli;
    pub use crate::node::zlib::native_zlib as NativeZlib;
    pub use crate::node::zlib::native_zstd as NativeZstd;
    pub use crate::server::DebugHTTPSServer;
    pub use crate::server::DebugHTTPServer;
    pub use crate::server::HTMLBundle;
    pub use crate::server::HTTPSServer;
    pub use crate::server::HTTPServer;
    pub use crate::server::NodeHTTPResponse;
    pub use crate::server::ServerWebSocket;
    pub use crate::shell::parsed_shell_script::ParsedShellScript;
    pub use crate::socket::Listener;
    pub use crate::socket::SocketAddress;
    pub use crate::socket::TCPSocket;
    pub use crate::socket::TLSSocket;
    pub use crate::socket::udp_socket::UDPSocket;
    pub use crate::timer::ImmediateObject as Immediate;
    pub use crate::timer::TimeoutObject as Timeout;
    pub use crate::valkey_jsc::js_valkey::JSValkeyClient as RedisClient;
    pub use crate::webcore::Request;
    pub use crate::webcore::Response;
    pub use crate::webcore::ResumableFetchSink;
    pub use crate::webcore::ResumableS3UploadSink;
    pub use crate::webcore::S3Client;
    pub use crate::webcore::S3Stat;
    pub use crate::webcore::TextDecoder;
    pub use crate::webcore::byte_blob_loader::Source as BlobInternalReadableStreamSource;
    pub use crate::webcore::byte_stream::Source as BytesInternalReadableStreamSource;
    pub use crate::webcore::crypto::Crypto;
    pub use crate::webcore::file_reader::Source as FileInternalReadableStreamSource;
    pub use crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder;
    pub use Bundler as JSBundler;
    pub use Transpiler as JSTranspiler;
    pub use bun_jsc::BuildMessage;
    pub use bun_jsc::ResolveMessage;
    pub use bun_sourcemap_jsc::JSSourceMap as SourceMap;
    pub use bun_sql_jsc::mysql::MySQLConnection;
    pub use bun_sql_jsc::mysql::MySQLQuery;
    pub use bun_sql_jsc::postgres::PostgresSQLConnection;
    pub use bun_sql_jsc::postgres::PostgresSQLQuery;
}

// ported from: src/jsc/generated_classes_list.zig
