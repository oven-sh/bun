//! Port of `src/jsc/generated_classes_list.zig`.
//!
//! This file is a thin namespace of type re-exports — the Zig `Classes` struct
//! holds no fields, only `pub const X = path.to.Y;` aliases. It is consumed by
//! the `.classes.ts` codegen to map class names to their Rust payload types.

use bun_runtime::api;
use bun_runtime::api::node;
use bun_runtime::webcore;

#[allow(non_snake_case)]
pub mod Classes {
    use super::*;

    pub use api::Archive;
    pub use webcore::Blob;
    pub use api::HTMLRewriter::HTMLRewriter;
    pub use api::HTMLRewriter::Element;
    pub use api::HTMLRewriter::Comment;
    pub use api::HTMLRewriter::TextChunk;
    pub use api::HTMLRewriter::DocType;
    pub use api::HTMLRewriter::DocEnd;
    pub use api::HTMLRewriter::EndTag;
    pub use api::HTMLRewriter::AttributeIterator;
    pub use api::Bun::Crypto::CryptoHasher;
    pub use bun_jsc::Expect::Expect;
    pub use bun_jsc::Expect::ExpectAny;
    pub use bun_jsc::Expect::ExpectAnything;
    pub use bun_jsc::Expect::ExpectCustomAsymmetricMatcher;
    pub use bun_jsc::Expect::ExpectMatcherContext;
    pub use bun_jsc::Expect::ExpectMatcherUtils;
    pub use bun_jsc::Expect::ExpectStatic;
    pub use bun_jsc::Expect::ExpectCloseTo;
    pub use bun_jsc::Expect::ExpectObjectContaining;
    pub use bun_jsc::Expect::ExpectStringContaining;
    pub use bun_jsc::Expect::ExpectStringMatching;
    pub use bun_jsc::Expect::ExpectArrayContaining;
    pub use bun_jsc::Expect::ExpectTypeOf;
    pub use bun_jsc::Jest::bun_test::ScopeFunctions;
    pub use bun_jsc::Jest::bun_test::DoneCallback;
    pub use api::FileSystemRouter;
    pub use api::Glob;
    pub use api::Image;
    pub use api::SecureContext;
    pub use api::Shell::Interpreter as ShellInterpreter;
    pub use api::Shell::ParsedShellScript;
    pub use api::JSBundler as Bundler;
    pub use Bundler as JSBundler;
    pub use api::JSTranspiler as Transpiler;
    pub use Transpiler as JSTranspiler;
    pub use api::Listener;
    pub use api::MatchedRoute;
    pub use node::fs::Binding as NodeJSFS;
    pub use webcore::Request;
    pub use webcore::Response;
    pub use api::Bun::Crypto::MD4;
    pub use api::Bun::Crypto::MD5;
    pub use api::Bun::Crypto::SHA1;
    pub use api::Bun::Crypto::SHA224;
    pub use api::Bun::Crypto::SHA256;
    pub use api::Bun::Crypto::SHA384;
    pub use api::Bun::Crypto::SHA512;
    pub use api::Bun::Crypto::SHA512_256;
    pub use api::ServerWebSocket;
    pub use api::Subprocess;
    pub use api::Subprocess::ResourceUsage;
    pub use api::cron::CronJob;
    pub use api::Terminal;
    pub use api::TCPSocket;
    pub use api::TLSSocket;
    pub use api::UDPSocket;
    pub use api::SocketAddress;
    pub use webcore::TextDecoder;
    pub use api::Timer::TimeoutObject as Timeout;
    pub use api::Timer::ImmediateObject as Immediate;
    pub use api::BuildArtifact;
    pub use api::BuildMessage;
    pub use api::ResolveMessage;
    pub use node::fs::Watcher as FSWatcher;
    pub use api::node::fs::StatWatcher;
    pub use api::HTTPServer;
    pub use api::HTTPSServer;
    pub use api::DebugHTTPServer;
    pub use api::DebugHTTPSServer;
    pub use webcore::Crypto;
    pub use api::FFI;
    pub use api::H2FrameParser;
    pub use webcore::FileReader::Source as FileInternalReadableStreamSource;
    pub use webcore::ByteBlobLoader::Source as BlobInternalReadableStreamSource;
    pub use webcore::ByteStream::Source as BytesInternalReadableStreamSource;
    pub use api::Postgres::PostgresSQLConnection;
    pub use api::MySQL::MySQLConnection;
    pub use api::Postgres::PostgresSQLQuery;
    pub use api::MySQL::MySQLQuery;
    pub use webcore::TextEncoderStreamEncoder;
    pub use api::NativeZlib;
    pub use api::NativeBrotli;
    pub use api::NodeHTTPResponse;
    pub use bun_bake::FrameworkRouter::JSFrameworkRouter as FrameworkFileSystemRouter;
    pub use api::dns::Resolver as DNSResolver;
    pub use webcore::S3Client;
    pub use webcore::S3Stat;
    pub use webcore::ResumableFetchSink;
    pub use webcore::ResumableS3UploadSink;
    pub use api::HTMLBundle;
    pub use api::Valkey as RedisClient;
    pub use api::BlockList;
    pub use api::NativeZstd;
    pub use bun_sourcemap::JSSourceMap as SourceMap;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/generated_classes_list.zig (104 lines)
//   confidence: medium
//   todos:      0
//   notes:      pure re-export namespace; module paths (bun_runtime::api, bun_jsc::Expect/Jest, bun_bake, bun_sourcemap) need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
