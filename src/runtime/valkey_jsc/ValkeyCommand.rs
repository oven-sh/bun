use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
use bun_valkey::valkey_protocol as protocol;

use super::protocol_jsc::{ToJSOptions, resp_value_to_js_with_options};

type Slice = bun_core::ZigStringSlice;

// Note: callers in `js_valkey_functions.rs` construct
// `Vec<crate::node::types::BlobOrStringOrBuffer>` directly, so `Args::Args` must accept
// that exact type. The upstream `bun_jsc::Node::BlobOrStringOrBuffer` re-export is a
// stub; use the real in-crate definition (which already provides `slice()` /
// `byte_length()`).
type BlobOrStringOrBuffer = crate::node::types::BlobOrStringOrBuffer;

// Note: `Command` is a transient view struct; fields
// borrow caller-owned data for the duration of serialization.
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
    pub(crate) fn len(&self) -> usize {
        match self {
            Args::Slices(args) => args.len(),
            Args::Args(args) => args.len(),
            Args::Raw(args) => args.len(),
        }
    }
}

impl<'a> Command<'a> {
    pub fn write(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
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
        // DiscardingWriter is bun_io's byte-counting null sink.
        let mut counter = bun_io::DiscardingWriter::default();
        self.write(&mut counter).expect("unreachable");
        counter.count
    }

    pub fn serialize(&self) -> Result<Box<[u8]>, bun_core::Error> {
        let mut buf: Vec<u8> = Vec::with_capacity(self.byte_length());
        self.write(&mut buf)?;
        Ok(buf.into_boxed_slice())
    }

    /// Number of top-level replies this command produces.
    ///
    /// Almost every Redis command produces exactly one reply. The exception
    /// is `(P)SUBSCRIBE` / `(P)UNSUBSCRIBE`, which emit one confirmation push
    /// per channel argument (RESP spec and `redis/src/pubsub.c`).
    pub fn expected_reply_count(&self) -> u32 {
        if self.meta.intersects(Meta::SUBSCRIPTION_REQUEST) {
            u32::try_from(self.args.len()).unwrap_or(u32::MAX).max(1)
        } else {
            1
        }
    }
}

/// Command stored in offline queue when disconnected
pub struct Entry {
    pub serialized_data: Box<[u8]>, // Pre-serialized RESP protocol bytes
    pub meta: Meta,
    /// See [`PromisePair::remaining_replies`].
    pub remaining_replies: u32,
    pub promise: Promise,
}

// Inherent associated
// types are unstable on stable Rust, so expose as a sibling module alias instead.
pub mod entry {
    pub(crate) type Queue = super::LinearFifo<super::Entry, super::DynamicBuffer<super::Entry>>;
}

impl Entry {
    // Create an Offline by serializing the Valkey command directly
    pub fn create(command: &Command<'_>, promise: Promise) -> Result<Entry, bun_core::Error> {
        Ok(Entry {
            serialized_data: command.serialize()?,
            // We should be calling .check against command here but due
            // to a hack introduced to let SUBSCRIBE work, we are not doing that for now.
            meta: command.meta,
            remaining_replies: command.expected_reply_count(),
            promise,
        })
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Meta: u8 {
        const RETURN_AS_BOOL           = 1 << 0;
        const SUPPORTS_AUTO_PIPELINING = 1 << 1;
        const RETURN_AS_BUFFER         = 1 << 2;
        /// Set on `(P)SUBSCRIBE`: reply is one `(p)subscribe` push per arg.
        const SUBSCRIBE_REQUEST        = 1 << 3;
        /// Set on `(P)UNSUBSCRIBE`: reply is one `(p)unsubscribe` push per arg.
        const UNSUBSCRIBE_REQUEST      = 1 << 4;
        /// Either direction of a subscription-state command.
        const SUBSCRIPTION_REQUEST = Self::SUBSCRIBE_REQUEST.bits()
                                   | Self::UNSUBSCRIBE_REQUEST.bits();
        // bits 5..8 are padding
    }
}

impl Default for Meta {
    fn default() -> Self {
        // supports_auto_pipelining defaults to true, rest false.
        Meta::SUPPORTS_AUTO_PIPELINING
    }
}

bun_core::comptime_string_set! {
    /// Commands that must not be auto-pipelined.
    static AUTO_PIPELINE_DISALLOWED_COMMANDS = {
        b"AUTH",
        b"EXEC",
        b"INFO",
        b"QUIT",
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
        b"SSUBSCRIBE",
        b"UNSUBSCRIBE",
        b"PUNSUBSCRIBE",
        b"SUNSUBSCRIBE",
    };
}

impl Meta {
    pub fn check(self, command: &Command<'_>) -> Self {
        let mut new = self;
        new.set(
            Meta::SUPPORTS_AUTO_PIPELINING,
            !AUTO_PIPELINE_DISALLOWED_COMMANDS.contains(command.command),
        );
        // Derive subscription flags from the command name so the raw
        // `client.send("SUBSCRIBE", [...])` escape hatch still pairs its
        // confirmation pushes correctly.
        let name = command.command;
        if name.eq_ignore_ascii_case(b"SUBSCRIBE")
            || name.eq_ignore_ascii_case(b"PSUBSCRIBE")
            || name.eq_ignore_ascii_case(b"SSUBSCRIBE")
        {
            new |= Meta::SUBSCRIBE_REQUEST;
        } else if name.eq_ignore_ascii_case(b"UNSUBSCRIBE")
            || name.eq_ignore_ascii_case(b"PUNSUBSCRIBE")
            || name.eq_ignore_ascii_case(b"SUNSUBSCRIBE")
        {
            new |= Meta::UNSUBSCRIBE_REQUEST;
        }
        // Subscription commands are in `AUTO_PIPELINE_DISALLOWED_COMMANDS`,
        // but that lookup is case-sensitive; enforce the same for any
        // casing that matched above.
        if new.intersects(Meta::SUBSCRIPTION_REQUEST) {
            new.remove(Meta::SUPPORTS_AUTO_PIPELINING);
        }
        new
    }
}

/// Promise for a Valkey command
pub struct Promise {
    pub meta: Meta,
    pub promise: jsc::JSPromiseStrong,
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
        self.promise.reject(global_object, jsvalue)?;
        Ok(())
    }
}

// Command+Promise pair for tracking which command corresponds to which promise
pub struct PromisePair {
    pub meta: Meta,
    /// Number of further top-level replies the server will produce for
    /// this command before its promise may be settled. Always 1 except for
    /// `(P)SUBSCRIBE` / `(P)UNSUBSCRIBE`, which emit one push per channel.
    pub remaining_replies: u32,
    pub promise: Promise,
}

// See `entry` note above.
pub mod promise_pair {
    pub(crate) type Queue =
        super::LinearFifo<super::PromisePair, super::DynamicBuffer<super::PromisePair>>;
}

impl PromisePair {
    pub fn reject_command(
        &mut self,
        global_object: &JSGlobalObject,
        jsvalue: JSValue,
    ) -> Result<(), jsc::JsTerminated> {
        self.promise.reject(global_object, Ok(jsvalue))?;
        Ok(())
    }
}
