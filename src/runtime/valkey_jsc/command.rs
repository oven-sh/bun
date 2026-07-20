use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue};
use bun_valkey::valkey_protocol as protocol;
use bun_valkey::valkey_protocol::RedisError;

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
    pub fn write(&self, writer: &mut impl bun_io::Write) -> Result<(), RedisError> {
        // Serialize as RESP array format directly; `bun_io::Write` can only
        // fail with an allocator error, so collapse to `OutOfMemory`.
        (|| -> bun_io::Result<()> {
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
        })()
        .map_err(|_| RedisError::OutOfMemory)
    }

    pub fn byte_length(&self) -> usize {
        // DiscardingWriter is bun_io's byte-counting null sink.
        let mut counter = bun_io::DiscardingWriter::default();
        self.write(&mut counter).expect("unreachable");
        counter.count
    }

    pub fn serialize(&self) -> Result<Box<[u8]>, RedisError> {
        let mut buf: Vec<u8> = Vec::with_capacity(self.byte_length());
        self.write(&mut buf)?;
        Ok(buf.into_boxed_slice())
    }
}

/// Command stored in offline queue when disconnected
pub struct Entry {
    pub serialized_data: Box<[u8]>, // Pre-serialized RESP protocol bytes
    pub promise: Promise,
}

pub(crate) type EntryQueue = LinearFifo<Entry, DynamicBuffer<Entry>>;

impl Entry {
    // Create an Offline by serializing the Valkey command directly
    pub fn create(command: &Command<'_>, promise: Promise) -> Result<Entry, RedisError> {
        Ok(Entry {
            serialized_data: command.serialize()?,
            promise,
        })
    }
}

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
        b"UNSUBSCRIBE",
        b"PUNSUBSCRIBE",
    };
}

impl Meta {
    pub fn check(self, command_name: &[u8]) -> Self {
        let mut new = self;
        // Case-insensitive probe: all disallowed entries are ≤12 bytes, so any
        // name longer than our 32-byte scratch cannot match and can skip the copy.
        let mut upper = [0u8; 32];
        let n = command_name.len().min(32);
        for i in 0..n {
            upper[i] = command_name[i].to_ascii_uppercase();
        }
        let probe: &[u8] = if command_name.len() <= 32 {
            &upper[..n]
        } else {
            command_name
        };
        new.set(
            Meta::SUPPORTS_AUTO_PIPELINING,
            !AUTO_PIPELINE_DISALLOWED_COMMANDS.contains(probe),
        );
        new
    }
}

/// Promise for a Valkey command
pub struct Promise {
    pub meta: Meta,
    pub promise: jsc::JSPromiseStrong,
}

pub(crate) type PromiseQueue = LinearFifo<Promise, DynamicBuffer<Promise>>;

impl Promise {
    pub fn create(global_object: &JSGlobalObject, meta: Meta) -> Promise {
        let promise = jsc::JSPromiseStrong::init(global_object);
        Promise { meta, promise }
    }

    pub fn resolve(
        &mut self,
        global_object: &JSGlobalObject,
        value: protocol::RESPValue,
    ) -> Result<(), jsc::JsTerminated> {
        let options = ToJSOptions {
            return_as_buffer: self.meta.contains(Meta::RETURN_AS_BUFFER),
        };

        let js_value = match resp_value_to_js_with_options(value, global_object, options) {
            Ok(v) => v,
            Err(err) => {
                self.promise.reject(global_object, Err(err))?;
                return Ok(());
            }
        };
        self.promise.resolve(global_object, js_value)?;
        Ok(())
    }

    pub fn reject(
        &mut self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), jsc::JsTerminated> {
        self.promise.reject(global_object, Ok(value))?;
        Ok(())
    }
}
