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
    pub(crate) command: &'a [u8],
    pub args: Args<'a>,
    pub(crate) meta: Meta,
}

#[derive(Copy, Clone)]
pub enum Args<'a> {
    Slices(&'a [Slice]),
    Args(&'a [BlobOrStringOrBuffer]),
    Raw(&'a [&'a [u8]]),
}

impl<'a> Args<'a> {
    fn len(&self) -> usize {
        match self {
            Args::Slices(args) => args.len(),
            Args::Args(args) => args.len(),
            Args::Raw(args) => args.len(),
        }
    }
}

impl<'a> Command<'a> {
    pub fn write(&self, writer: &mut impl bun_io::Write) -> Result<(), crate::Error> {
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

    pub(crate) fn byte_length(&self) -> usize {
        // DiscardingWriter is bun_io's byte-counting null sink.
        let mut counter = bun_io::DiscardingWriter::default();
        self.write(&mut counter).expect("unreachable");
        counter.count
    }

    pub(crate) fn serialize(&self) -> Result<Box<[u8]>, crate::Error> {
        let mut buf: Vec<u8> = Vec::with_capacity(self.byte_length());
        self.write(&mut buf)?;
        Ok(buf.into_boxed_slice())
    }
}

/// Command stored in offline queue when disconnected
pub struct Entry {
    pub(crate) serialized_data: Box<[u8]>, // Pre-serialized RESP protocol bytes
    pub(crate) meta: Meta,
    pub(crate) promise: Promise,
}

// Inherent associated
// types are unstable on stable Rust, so expose as a sibling module alias instead.
pub mod entry {
    pub(crate) type Queue = std::collections::VecDeque<super::Entry>;
}

impl Entry {
    // Create an Offline by serializing the Valkey command directly
    pub(crate) fn create(command: &Command<'_>, promise: Promise) -> Result<Entry, crate::Error> {
        Ok(Entry {
            serialized_data: command.serialize()?,
            // We should be calling .check against command here but due
            // to a hack introduced to let SUBSCRIBE work, we are not doing that for now.
            meta: command.meta,
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
        b"UNPSUBSCRIBE",
    };
}

impl Meta {
    pub(crate) fn check(self, command: &Command<'_>) -> Self {
        let mut new = self;
        new.set(
            Meta::SUPPORTS_AUTO_PIPELINING,
            !AUTO_PIPELINE_DISALLOWED_COMMANDS.contains(command.command),
        );
        if is_subscription_command(command.command) {
            new.insert(Meta::SUBSCRIPTION_REQUEST);
        }
        new
    }
}

fn is_subscription_command(name: &[u8]) -> bool {
    [
        &b"SUBSCRIBE"[..],
        b"PSUBSCRIBE",
        b"SSUBSCRIBE",
        b"UNSUBSCRIBE",
        b"PUNSUBSCRIBE",
        b"SUNSUBSCRIBE",
    ]
    .iter()
    .any(|c| bun_core::strings::eql_case_insensitive_ascii(name, c, true))
}

/// Promise for a Valkey command
pub struct Promise {
    pub(crate) meta: Meta,
    pub(crate) promise: jsc::JSPromiseStrong,
    /// Native OpenTelemetry client span for this command; `None` when off.
    pub(crate) otel: bun_telemetry::NativeSpan,
}

impl Promise {
    pub(crate) fn create(global_object: &JSGlobalObject, meta: Meta) -> Promise {
        let promise = jsc::JSPromiseStrong::init(global_object);
        Promise {
            meta,
            promise,
            otel: bun_telemetry::NativeSpan::NONE,
        }
    }

    /// Start the command's span. `db.query.text` is the command plus its
    /// first argument (the key, for most commands) — never values.
    pub(crate) fn otel_begin(
        &mut self,
        global_object: &JSGlobalObject,
        command: &Command<'_>,
        host: &[u8],
        port: u16,
        database: u32,
    ) {
        let mut dbbuf = bun_core::fmt::ItoaBuf::new();
        let ns: &[u8] = if database == 0 {
            b""
        } else {
            bun_core::fmt::itoa(&mut dbbuf, database)
        };
        let span = bun_telemetry::db::begin(
            global_object.as_ptr().cast(),
            bun_telemetry::db::System::Redis,
            &bun_telemetry::db::ConnectionInfo {
                host,
                port,
                namespace: ns,
            },
        );
        if !span.is_some() {
            return;
        }
        bun_telemetry::pool::with(span, |s| {
            if !s.is_recording() {
                return;
            }
            let mut name = [0u8; 24];
            let n = command.command.len().min(24);
            for (i, c) in command.command[..n].iter().enumerate() {
                name[i] = c.to_ascii_uppercase();
            }
            s.set_name(&name[..n]);
            let l = &bun_telemetry::DEFAULT_LIMITS;
            s.push_attribute(
                b"db.operation.name",
                &bun_telemetry::Value::Str(&name[..n]),
                l,
            );
            // Never record arguments of credential-bearing commands.
            let sensitive = matches!(&name[..n], b"AUTH" | b"HELLO" | b"MIGRATE" | b"ACL" | b"CONFIG");
            if bun_telemetry::rt::capture_db_statement() && !sensitive {
                let first: &[u8] = match &command.args {
                    Args::Slices(a) => a.first().map(|s| s.slice()).unwrap_or(b""),
                    Args::Args(a) => a.first().map(|s| s.slice()).unwrap_or(b""),
                    Args::Raw(a) => a.first().copied().unwrap_or(b""),
                };
                let first = &first[..first.len().min(256)];
                let mut text = Vec::with_capacity(n + 1 + first.len() + 4);
                text.extend_from_slice(&name[..n]);
                if !first.is_empty() {
                    text.push(b' ');
                    text.extend_from_slice(first);
                    if command.args.len() > 1 {
                        text.extend_from_slice(b" ...");
                    }
                }
                s.push_attribute(b"db.query.text", &bun_telemetry::Value::Str(&text), l);
            }
        });
        self.otel = span;
    }

    #[inline]
    fn otel_end(&mut self, error: Option<(&[u8], &[u8])>) {
        let span = core::mem::take(&mut self.otel);
        if span.is_some() {
            let name = bun_telemetry::pool::with_ref(span, |s| {
                let mut b = [0u8; 24];
                let l = s.name.len().min(24);
                b[..l].copy_from_slice(&s.name[..l]);
                (b, l)
            })
            .unwrap_or(([0u8; 24], 0));
            bun_telemetry::db::end(span, b"", Some(&name.0[..name.1]), error);
        }
    }

    pub(crate) fn resolve(
        &mut self,
        global_object: &JSGlobalObject,
        value: &mut protocol::RESPValue,
    ) -> JsResult<()> {
        let options = ToJSOptions {
            return_as_buffer: self.meta.contains(Meta::RETURN_AS_BUFFER),
        };

        if self.otel.is_some() {
            match value {
                protocol::RESPValue::Error(e) => {
                    let code_end =
                        bun_core::strings::index_of_char_usize(e, b' ').unwrap_or(e.len());
                    self.otel_end(Some((&e[..code_end], e)));
                }
                _ => self.otel_end(None),
            }
        }
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

    pub(crate) fn reject(
        &mut self,
        global_object: &JSGlobalObject,
        jsvalue: JsResult<JSValue>,
    ) -> JsResult<()> {
        if self.otel.is_some() {
            let mut code = None;
            if let Ok(v) = &jsvalue {
                if v.is_object() {
                    if let Some(c) = v.get(global_object, "code")? {
                        if c.is_string() {
                            code = Some(c.to_slice(global_object)?);
                        }
                    }
                }
            }
            self.otel_end(Some((
                code.as_ref().map(|c| c.slice()).unwrap_or(b"_OTHER"),
                b"",
            )));
        }
        self.promise.reject(global_object, jsvalue)?;
        Ok(())
    }
}

// Command+Promise pair for tracking which command corresponds to which promise
pub struct PromisePair {
    pub(crate) meta: Meta,
    pub(crate) promise: Promise,
}

// See `entry` note above.
pub mod promise_pair {
    pub(crate) type Queue = std::collections::VecDeque<super::PromisePair>;
}

impl PromisePair {
    pub(crate) fn reject_command(
        &mut self,
        global_object: &JSGlobalObject,
        jsvalue: JSValue,
    ) -> JsResult<()> {
        self.promise.reject(global_object, Ok(jsvalue))?;
        Ok(())
    }
}
