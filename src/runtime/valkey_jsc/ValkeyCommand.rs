use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
use bun_valkey::valkey_protocol as protocol;

use super::protocol_jsc::{ToJSOptions, resp_value_to_js_with_options};

type Slice = bun_core::ZigStringSlice;

// PORT NOTE: callers in `js_valkey_functions.rs` construct
// `Vec<crate::node::types::BlobOrStringOrBuffer>` directly, so `Args::Args` must accept
// that exact type. The upstream `bun_jsc::Node::BlobOrStringOrBuffer` re-export is a
// stub; use the real in-crate definition (which already provides `slice()` /
// `byte_length()`).
type BlobOrStringOrBuffer = crate::node::types::BlobOrStringOrBuffer;

// PORT NOTE: `Command` is a transient view struct (Zig `deinit` is a no-op); fields
// borrow caller-owned data for the duration of serialization.
// TODO(port): borrow-view struct — `<'a>` on a struct is disallowed in Phase A (no
// LIFETIMES.tsv entry for ValkeyCommand.Command/Args); revisit in Phase B and either
// add a TSV row or retype as raw `*const [u8]` per the UNKNOWN class.
#[derive(Copy, Clone)]
pub struct Command<'a> {
    pub command: &'a [u8],
    pub args: Args<'a>,
    pub meta: Meta,
}

impl<'a> Default for Command<'a> {
    fn default() -> Self {
        Self {
            command: b"",
            args: Args::default(),
            meta: Meta::default(),
        }
    }
}

#[derive(Copy, Clone)]
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

// PERF(port): was `phf::Set<&[u8]>`. 16 entries spread across 9 distinct
// lengths (max 4 per bucket), so a length-gated match beats the phf hash:
// the outer `usize` compare rejects almost everything before any byte
// compare, and within a bucket the known-equal-length lets LLVM lower the
// `==` to a single wide load/compare. See clap::find_param (12577e958d71)
// for the reference pattern.
#[inline]
fn is_not_allowed_autopipeline_command(cmd: &[u8]) -> bool {
    match cmd.len() {
        4 => matches!(cmd, b"AUTH" | b"EXEC" | b"INFO" | b"QUIT"),
        5 => matches!(cmd, b"MULTI" | b"WATCH"),
        6 => matches!(cmd, b"SCRIPT" | b"SELECT"),
        7 => matches!(cmd, b"CLUSTER" | b"DISCARD" | b"UNWATCH"),
        8 => cmd == b"PIPELINE",
        9 => cmd == b"SUBSCRIBE",
        10 => cmd == b"PSUBSCRIBE",
        11 => cmd == b"UNSUBSCRIBE",
        12 => cmd == b"UNPSUBSCRIBE",
        _ => false,
    }
}

impl Meta {
    pub fn check(self, command: &Command<'_>) -> Self {
        let mut new = self;
        new.set(
            Meta::SUPPORTS_AUTO_PIPELINING,
            !is_not_allowed_autopipeline_command(command.command),
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
        let options = ToJSOptions {
            return_as_buffer: self.meta.contains(Meta::RETURN_AS_BUFFER),
        };

        let js_value = match resp_value_to_js_with_options(value, global_object, options) {
            Ok(v) => v,
            Err(err) => {
                self.reject(global_object, Ok(global_object.take_error(err)))?;
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
    pub type Queue =
        super::LinearFifo<super::PromisePair, super::DynamicBuffer<super::PromisePair>>;
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

// ported from: src/runtime/valkey_jsc/ValkeyCommand.zig
