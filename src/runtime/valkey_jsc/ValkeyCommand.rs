use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
use bun_valkey::valkey_protocol as protocol;

use super::protocol_jsc::{resp_value_to_js_with_options, ToJSOptions};

type Slice = bun_str::ZigStringSlice;

// PORT NOTE: `bun_jsc::Node::BlobOrStringOrBuffer` is currently an upstream stub type;
// callers in `js_valkey_functions.rs` construct `Vec<bun_jsc::Node::BlobOrStringOrBuffer>`
// directly, so `Args::Args` must accept that exact type. The real implementation lives
// at `crate::node::types::BlobOrStringOrBuffer` — once the upstream re-export lands,
// switch this alias and drop the shim trait below.
type BlobOrStringOrBuffer = bun_jsc::Node::BlobOrStringOrBuffer;

/// Local shim providing `slice()` / `byte_length()` over the upstream stub so
/// `Command::write` type-checks. Real bodies live on
/// `crate::node::types::BlobOrStringOrBuffer`.
trait BlobOrStringOrBufferExt {
    fn slice(&self) -> &[u8];
    fn byte_length(&self) -> usize;
}
impl BlobOrStringOrBufferExt for BlobOrStringOrBuffer {
    fn slice(&self) -> &[u8] {
        todo!("blocked_on: bun_jsc::Node::BlobOrStringOrBuffer::slice")
    }
    fn byte_length(&self) -> usize {
        todo!("blocked_on: bun_jsc::Node::BlobOrStringOrBuffer::byte_length")
    }
}

// PORT NOTE: `Command` is a transient view struct (Zig `deinit` is a no-op); fields
// borrow caller-owned data for the duration of serialization.
// TODO(port): borrow-view struct — `<'a>` on a struct is disallowed in Phase A (no
// LIFETIMES.tsv entry for ValkeyCommand.Command/Args); revisit in Phase B and either
// add a TSV row or retype as raw `*const [u8]` per the UNKNOWN class.
pub struct Command<'a> {
    pub command: &'a [u8],
    pub args: Args<'a>,
    pub meta: Meta,
}

pub enum Args<'a> {
    Slices(&'a [Slice]),
    Args(&'a [BlobOrStringOrBuffer]),
    Raw(&'a [&'a [u8]]),
}

impl<'a> Default for Args<'a> {
    fn default() -> Self {
        Args::Raw(&[])
    }
}

impl<'a> Default for Command<'a> {
    fn default() -> Self {
        Command {
            command: b"",
            args: Args::default(),
            meta: Meta::default(),
        }
    }
}

impl<'a> Args<'a> {
    pub fn len(&self) -> usize {
        match self {
            Args::Slices(args) => args.len(),
            Args::Args(args) => args.len(),
            Args::Raw(args) => args.len(),
        }
    }
}

impl<'a> Command<'a> {
    pub fn write(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Serialize as RESP array format directly
        write!(writer, "*{}\r\n", 1 + self.args.len())?;
        write!(writer, "${}\r\n", self.command.len())?;
        writer.write_all(self.command)?;
        writer.write_all(b"\r\n")?;

        match &self.args {
            Args::Slices(args) => {
                for arg in args.iter() {
                    let bytes = arg.slice();
                    write!(writer, "${}\r\n", bytes.len())?;
                    writer.write_all(bytes)?;
                    writer.write_all(b"\r\n")?;
                }
            }
            Args::Args(args) => {
                for arg in args.iter() {
                    write!(writer, "${}\r\n", arg.byte_length())?;
                    writer.write_all(arg.slice())?;
                    writer.write_all(b"\r\n")?;
                }
            }
            Args::Raw(args) => {
                for arg in args.iter() {
                    write!(writer, "${}\r\n", arg.len())?;
                    writer.write_all(arg)?;
                    writer.write_all(b"\r\n")?;
                }
            }
        }
        Ok(())
    }

    pub fn byte_length(&self) -> usize {
        // Zig: std.fmt.count — DiscardingWriter is bun_io's byte-counting null sink.
        let mut counter = bun_io::DiscardingWriter::default();
        self.write(&mut counter).expect("unreachable");
        counter.count
    }

    pub fn serialize(&self) -> Result<Box<[u8]>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut buf: Vec<u8> = Vec::with_capacity(self.byte_length());
        self.write(&mut buf)?;
        Ok(buf.into_boxed_slice())
    }
}

impl<'a> core::fmt::Display for Command<'a> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // TODO(port): RESP bytes may not be valid UTF-8; Zig used the byte-writer protocol.
        // Phase B should route Display through a byte-writing adapter or drop Display entirely.
        let mut buf: Vec<u8> = Vec::new();
        self.write(&mut buf).map_err(|_| core::fmt::Error)?;
        write!(f, "{}", bstr::BStr::new(&buf))
    }
}

/// Command stored in offline queue when disconnected
pub struct Entry {
    pub serialized_data: Box<[u8]>, // Pre-serialized RESP protocol bytes
    pub meta: Meta,
    pub promise: Promise,
}

// Zig: `pub const Queue = bun.LinearFifo(Entry, .Dynamic);` — inherent associated
// types are unstable on stable Rust, so expose as a sibling module alias instead.
pub mod entry {
    pub type Queue = super::LinearFifo<super::Entry, super::DynamicBuffer<super::Entry>>;
}

impl Entry {
    // Create an Offline by serializing the Valkey command directly
    pub fn create(command: &Command<'_>, promise: Promise) -> Result<Entry, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Entry {
            serialized_data: command.serialize()?,
            // TODO(markovejnovic): We should be calling .check against command here but due
            // to a hack introduced to let SUBSCRIBE work, we are not doing that for now.
            meta: command.meta,
            promise,
        })
    }
}

// Zig `Entry.deinit` only freed `serialized_data`; `Box<[u8]>` drops automatically.

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Meta: u8 {
        const RETURN_AS_BOOL          = 1 << 0;
        const SUPPORTS_AUTO_PIPELINING = 1 << 1;
        const RETURN_AS_BUFFER        = 1 << 2;
        const SUBSCRIPTION_REQUEST    = 1 << 3;
        // bits 4..8 are padding
    }
}

impl Default for Meta {
    fn default() -> Self {
        // Zig field defaults: supports_auto_pipelining = true, rest false.
        Meta::SUPPORTS_AUTO_PIPELINING
    }
}

static NOT_ALLOWED_AUTOPIPELINE_COMMANDS: phf::Set<&'static [u8]> = phf::phf_set! {
    b"AUTH",
    b"INFO",
    b"QUIT",
    b"EXEC",
    b"MULTI",
    b"WATCH",
    b"SCRIPT",
    b"SELECT",
    b"CLUSTER",
    b"DISCARD",
    b"UNWATCH",
    b"PIPELINE",
    b"SUBSCRIBE",
    b"PSUBSCRIBE",
    b"UNSUBSCRIBE",
    b"UNPSUBSCRIBE",
};

impl Meta {
    pub fn check(self, command: &Command<'_>) -> Self {
        let mut new = self;
        new.set(
            Meta::SUPPORTS_AUTO_PIPELINING,
            !NOT_ALLOWED_AUTOPIPELINE_COMMANDS.contains(command.command),
        );
        new
    }
}

/// Promise for a Valkey command
pub struct Promise {
    pub meta: Meta,
    pub promise: jsc::JSPromiseStrong, // TODO(port): exact path for jsc.JSPromise.Strong
}

impl Promise {
    pub fn create(global_object: &JSGlobalObject, meta: Meta) -> Promise {
        let promise = jsc::JSPromiseStrong::init(global_object);
        Promise { meta, promise }
    }

    pub fn resolve(
        &mut self,
        global_object: &JSGlobalObject,
        value: &mut protocol::RESPValue,
    ) -> Result<(), jsc::JsTerminated> {
        // TODO(port): bun.JSTerminated! mapping
        let options = protocol::RESPValue::ToJSOptions {
            return_as_buffer: self.meta.contains(Meta::RETURN_AS_BUFFER),
        };

        let js_value = match value.to_js_with_options(global_object, options) {
            Ok(v) => v,
            Err(err) => {
                self.reject(global_object, global_object.take_error(err))?;
                return Ok(());
            }
        };
        self.promise.resolve(global_object, js_value)?;
        Ok(())
    }

    pub fn reject(
        &mut self,
        global_object: &JSGlobalObject,
        jsvalue: JsResult<JSValue>,
    ) -> Result<(), jsc::JsTerminated> {
        // TODO(port): bun.JSTerminated! mapping
        self.promise.reject(global_object, jsvalue)?;
        Ok(())
    }
}

// Zig `Promise.deinit` only called `self.promise.deinit()`; JSPromiseStrong's Drop handles it.

// Command+Promise pair for tracking which command corresponds to which promise
pub struct PromisePair {
    pub meta: Meta,
    pub promise: Promise,
}

// Zig: `pub const Queue = bun.LinearFifo(PromisePair, .Dynamic);` — see `entry` note above.
pub mod promise_pair {
    pub type Queue = super::LinearFifo<super::PromisePair, super::DynamicBuffer<super::PromisePair>>;
}

impl PromisePair {
    pub fn reject_command(
        &mut self,
        global_object: &JSGlobalObject,
        jsvalue: JSValue,
    ) -> Result<(), jsc::JsTerminated> {
        // TODO(port): bun.JSTerminated! mapping
        self.promise.reject(global_object, Ok(jsvalue))?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/ValkeyCommand.zig (170 lines)
//   confidence: medium
//   todos:      13
//   notes:      Command<'a> is a borrow view (Zig deinit no-op) — no LIFETIMES.tsv entry, revisit; bun_io::Write/CountingWriter, LinearFifo, JSPromiseStrong, JsTerminated need Phase-B path fixes; inherent assoc type aliases (Entry::Queue) are unstable — may need free-standing type aliases.
// ──────────────────────────────────────────────────────────────────────────
