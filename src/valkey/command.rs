use bun_core::fmt::{ItoaBuf, digit_count, itoa};
use bun_core::strings::is_valid_utf8;

use crate::valkey_protocol::{self, RESPValue};

/// What a command's promise resolves with.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    Value,
    /// An integer reply, as `reply > 0`.
    Bool,
    /// Bulk and verbatim strings, as buffers.
    Binary,
    /// The same, but for the cursor that comes first.
    Page,
    /// Status replies and big numbers too.
    Buffer,
}

impl Reply {
    pub fn keeps_bytes(self) -> bool {
        match self {
            Reply::Value | Reply::Bool => false,
            Reply::Binary | Reply::Page | Reply::Buffer => true,
        }
    }

    /// The keys of an object are text.
    pub fn refuses(self, value: &RESPValue) -> bool {
        matches!(self, Reply::Binary | Reply::Page) && has_binary_key(value)
    }
}

fn has_binary_key(value: &RESPValue) -> bool {
    use RESPValue::*;
    match value {
        Map(entries) => (entries.iter()).any(|it| !is_text(&it.key) || has_binary_key(&it.value)),
        Array(items) | Set(items) | Push(valkey_protocol::Push { data: items, .. }) => {
            items.iter().any(has_binary_key)
        }
        SimpleString(_) | BulkString(_) | VerbatimString(_) | BigNumber(_) | Error(_) => false,
        Integer(_) | Double(_) | Boolean(_) | Null => false,
    }
}

fn is_text(key: &RESPValue) -> bool {
    use RESPValue::*;
    match key {
        SimpleString(bytes) | BulkString(Some(bytes)) | VerbatimString(bytes) => {
            is_valid_utf8(bytes)
        }
        BigNumber(bytes) | Error(bytes) => is_valid_utf8(bytes),
        Integer(_) | Double(_) | Boolean(_) | Null | BulkString(None) => true,
        Array(_) | Set(_) | Map(_) | Push(_) => false,
    }
}

/// For a reply that was refused: every map becomes an array of `[key, value]`.
pub fn maps_to_pairs(value: &mut RESPValue) {
    use RESPValue::*;
    if let Map(entries) = value {
        let pairs = entries.drain(..).map(|it| match it.key {
            SimpleString(bytes) | BigNumber(bytes) | Error(bytes) if !is_valid_utf8(&bytes) => {
                Array(vec![BulkString(Some(bytes)), it.value])
            }
            key => Array(vec![key, it.value]),
        });
        *value = Array(pairs.collect());
    }
    if let Array(items) | Set(items) | Push(valkey_protocol::Push { data: items, .. }) = value {
        items.iter_mut().for_each(maps_to_pairs);
    }
}

/// A subscription command, and the push of the same name that acknowledges it.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Ack {
    Subscribe,
    PSubscribe,
    SSubscribe,
    Unsubscribe,
    PUnsubscribe,
    SUnsubscribe,
}

bun_core::comptime_string_map! {
    pub(crate) static ACKS: Ack = {
        b"subscribe" => Ack::Subscribe,
        b"psubscribe" => Ack::PSubscribe,
        b"ssubscribe" => Ack::SSubscribe,
        b"unsubscribe" => Ack::Unsubscribe,
        b"punsubscribe" => Ack::PUnsubscribe,
        b"sunsubscribe" => Ack::SUnsubscribe,
    };
}

bun_core::comptime_string_set! {
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

pub(crate) fn can_pipeline(name: &[u8]) -> bool {
    !AUTO_PIPELINE_DISALLOWED_COMMANDS.contains(name)
}

/// Appends the command as a RESP array, growing `out` at most once.
pub(crate) fn encode<A: AsRef<[u8]>>(name: &[u8], args: &[A], out: &mut Vec<u8>) {
    let bulk_lens: usize = args.iter().map(|arg| bulk_len(arg.as_ref())).sum();
    out.reserve_exact(header_len(1 + args.len()) + bulk_len(name) + bulk_lens);
    header(b'*', 1 + args.len(), out);
    bulk(name, out);
    for arg in args {
        bulk(arg.as_ref(), out);
    }
}

fn header_len(count: usize) -> usize {
    1 + digit_count(count) + 2
}

fn bulk_len(bytes: &[u8]) -> usize {
    header_len(bytes.len()) + bytes.len() + 2
}

fn header(kind: u8, count: usize, out: &mut Vec<u8>) {
    out.push(kind);
    out.extend_from_slice(itoa(&mut ItoaBuf::new(), count));
    out.extend_from_slice(b"\r\n");
}

fn bulk(bytes: &[u8], out: &mut Vec<u8>) {
    header(b'$', bytes.len(), out);
    out.extend_from_slice(bytes);
    out.extend_from_slice(b"\r\n");
}
