//! Web APIs implemented in Rust live here

use core::ptr::NonNull;

// NOTE(port): the Zig `comptime { _ = @import("./webcore/prompt.zig"); _ = @import("./webcore/TextEncoder.zig"); }`
// force-reference block is dropped — Rust links what's `pub`. (See PORTING.md §Don't translate.)

pub use bun_jsc::js_error_code::DOMExceptionCode;

// TODO: make this JSGlobalObject local for better security
// TODO(port): `bun.ObjectPool` / `bun.ByteList` are not in the crate map; assuming `bun_collections`.
pub type ByteListPool = bun_collections::ObjectPool<bun_collections::ByteList, 8>;

// ─── submodules under ./webcore/ ─────────────────────────────────────────────
pub mod crypto;
pub use bun_jsc::abort_signal::AbortSignal;
pub use bun_jsc::web_worker;
pub use bun_event_loop::auto_flusher;
pub mod encoding_label;
pub use encoding_label::EncodingLabel;
pub mod fetch;
pub mod response;
pub mod bake_response;
pub mod text_decoder;
pub mod text_encoder;
pub mod text_encoder_stream_encoder;
pub mod encoding;
pub mod readable_stream;
pub mod blob;
pub mod s3_stat;
pub use s3_stat::S3Stat;
pub mod resumable_sink;
pub use resumable_sink::ResumableFetchSink;
pub use resumable_sink::ResumableS3UploadSink;
pub use resumable_sink::ResumableSinkBackpressure;
pub mod s3_client;
pub use s3_client::S3Client;
pub mod request;
pub mod body;
pub mod cookie_map;
pub use cookie_map::CookieMap;
pub mod object_url_registry;
pub mod sink;
pub mod file_sink;
pub use bun_jsc::fetch_headers::FetchHeaders;
pub mod byte_blob_loader;
pub mod byte_stream;
pub mod file_reader;
pub mod script_execution_context;

pub mod streams;
pub use streams::NetworkSink;
pub use streams::HTTPResponseSink;
pub use streams::HTTPSResponseSink;
pub use streams::H3ResponseSink;
pub use streams::HTTPServerWritable;

// NOTE(port): the Zig `comptime { WebSocketClient.exportAll(); ... }` block forces export of
// `extern "C"` symbols from `src/http/websocket_http_client.zig`. In Rust, those become
// `#[unsafe(no_mangle)] pub extern "C" fn` in `bun_http::websocket_http_client` and need no
// force-reference here. Dropped per PORTING.md §Don't translate.

pub enum PathOrFileDescriptor {
    // TODO(port): `jsc.ZigString.Slice` mapped to `bun_str::zig_string::Slice` — verify path in Phase B.
    Path(bun_str::zig_string::Slice),
    Fd(bun_sys::Fd),
}

// NOTE(port): Zig `deinit` only called `this.path.deinit()` for the `.path` arm. In Rust the
// variant payload's `Drop` runs automatically, so no explicit `impl Drop` is needed.

#[derive(Default)]
pub struct Pipe {
    pub ctx: Option<NonNull<()>>,
    pub on_pipe: Option<Function>,
}

impl Pipe {
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ctx.is_none() && self.on_pipe.is_none()
    }
}

// TODO(port): `std.mem.Allocator` param kept to match LIFETIMES.tsv verbatim; per §Allocators
// (non-AST crate) it should likely be dropped in Phase B.
pub type Function = fn(ctx: NonNull<()>, stream: streams::Result, allocator: &dyn bun_alloc::Allocator);

// TODO(port): Zig `Wrap(comptime Type, comptime function)` takes a *comptime fn pointer* as a
// generic argument, which stable Rust cannot express. Reshaped: callers implement `PipeHandler`
// for their type instead of passing a free fn. Phase B should audit call sites
// (`Wrap(Foo, Foo.onPipe).init(self)` → `Wrap::<Foo>::init(self)`).
pub trait PipeHandler {
    fn on_pipe(&mut self, stream: streams::Result, allocator: &dyn bun_alloc::Allocator);
}

pub struct Wrap<T: PipeHandler>(core::marker::PhantomData<T>);

impl<T: PipeHandler> Wrap<T> {
    pub fn pipe(self_: NonNull<()>, stream: streams::Result, allocator: &dyn bun_alloc::Allocator) {
        // SAFETY: `self_` was produced from `NonNull::from(&mut T)` in `init` below; caller
        // guarantees the pointee outlives the Pipe and is exclusively borrowed here.
        let this = unsafe { self_.cast::<T>().as_mut() };
        this.on_pipe(stream, allocator);
    }

    pub fn init(self_: &mut T) -> Pipe {
        Pipe {
            ctx: Some(NonNull::from(self_).cast::<()>()),
            on_pipe: Some(Self::pipe),
        }
    }
}

pub enum DrainResult {
    Owned {
        list: Vec<u8>,
        size_hint: usize,
    },
    EstimatedSize(usize),
    Empty,
    Aborted,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Lifetime {
    Clone,
    Transfer,
    Share,
    /// When reading from a fifo like STDIN/STDERR
    Temporary,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore.zig (129 lines)
//   confidence: medium
//   todos:      4
//   notes:      Mostly thin re-exports → `pub mod`/`pub use`. `Pipe.Wrap` reshaped to a trait (no comptime-fn generics in Rust); ObjectPool/ByteList crate paths guessed.
// ──────────────────────────────────────────────────────────────────────────
