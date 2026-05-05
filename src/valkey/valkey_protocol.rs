use core::fmt;

use bstr::BStr;

// TODO(b1): thiserror not in deps — derive removed; add manual Display/Error impl in B-2.
#[derive(strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedisError {
    AuthenticationFailed,
    ConnectionClosed,
    InvalidArgument,
    InvalidArray,
    InvalidAttribute,
    InvalidBigNumber,
    InvalidBlobError,
    InvalidBoolean,
    InvalidBulkString,
    InvalidCommand,
    InvalidDouble,
    InvalidErrorString,
    InvalidInteger,
    InvalidMap,
    InvalidNull,
    InvalidPush,
    InvalidResponse,
    InvalidResponseType,
    InvalidSet,
    InvalidSimpleString,
    InvalidVerbatimString,
    JSError,
    OutOfMemory,
    JSTerminated,
    UnsupportedProtocol,
    ConnectionTimeout,
    IdleTimeout,
    NestingDepthExceeded,
}

impl From<RedisError> for bun_core::Error {
    fn from(e: RedisError) -> Self {
        // TODO(port): wire IntoStaticStr → bun_core::err! interning
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// `valkeyErrorToJS` alias deleted — lives in bun_runtime::valkey_jsc::protocol_jsc (extension trait).

/// RESP protocol types
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RESPType {
    // RESP2 types
    SimpleString = b'+',
    Error = b'-',
    Integer = b':',
    BulkString = b'$',
    Array = b'*',

    // RESP3 types
    Null = b'_',
    Double = b',',
    Boolean = b'#',
    BlobError = b'!',
    VerbatimString = b'=',
    Map = b'%',
    Set = b'~',
    Attribute = b'|',
    Push = b'>',
    BigNumber = b'(',
}

impl RESPType {
    pub fn from_byte(byte: u8) -> Option<RESPType> {
        match byte {
            x if x == RESPType::SimpleString as u8 => Some(RESPType::SimpleString),
            x if x == RESPType::Error as u8 => Some(RESPType::Error),
            x if x == RESPType::Integer as u8 => Some(RESPType::Integer),
            x if x == RESPType::BulkString as u8 => Some(RESPType::BulkString),
            x if x == RESPType::Array as u8 => Some(RESPType::Array),
            x if x == RESPType::Null as u8 => Some(RESPType::Null),
            x if x == RESPType::Double as u8 => Some(RESPType::Double),
            x if x == RESPType::Boolean as u8 => Some(RESPType::Boolean),
            x if x == RESPType::BlobError as u8 => Some(RESPType::BlobError),
            x if x == RESPType::VerbatimString as u8 => Some(RESPType::VerbatimString),
            x if x == RESPType::Map as u8 => Some(RESPType::Map),
            x if x == RESPType::Set as u8 => Some(RESPType::Set),
            x if x == RESPType::Attribute as u8 => Some(RESPType::Attribute),
            x if x == RESPType::Push as u8 => Some(RESPType::Push),
            x if x == RESPType::BigNumber as u8 => Some(RESPType::BigNumber),
            _ => None,
        }
    }
}

pub enum RESPValue {
    // RESP2 types
    SimpleString(Box<[u8]>),
    Error(Box<[u8]>),
    Integer(i64),
    BulkString(Option<Box<[u8]>>),
    Array(Vec<RESPValue>),

    // RESP3 types
    Null,
    Double(f64),
    Boolean(bool),
    BlobError(Box<[u8]>),
    VerbatimString(VerbatimString),
    Map(Vec<MapEntry>),
    Set(Vec<RESPValue>),
    Attribute(Attribute),
    Push(Push),
    BigNumber(Box<[u8]>),
}

// `deinit` deleted — all payloads are Box/Vec; Drop is automatic.

impl fmt::Display for RESPValue {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RESPValue::SimpleString(str) => write!(writer, "{}", BStr::new(str)),
            RESPValue::Error(str) => write!(writer, "{}", BStr::new(str)),
            RESPValue::Integer(int) => write!(writer, "{}", int),
            RESPValue::BulkString(maybe_str) => {
                if let Some(str) = maybe_str {
                    write!(writer, "{}", BStr::new(str))
                } else {
                    writer.write_str("(nil)")
                }
            }
            RESPValue::Array(array) => {
                writer.write_str("[")?;
                for (i, value) in array.iter().enumerate() {
                    if i > 0 {
                        writer.write_str(", ")?;
                    }
                    fmt::Display::fmt(value, writer)?;
                }
                writer.write_str("]")
            }
            RESPValue::Null => writer.write_str("(nil)"),
            RESPValue::Double(d) => write!(writer, "{}", d),
            RESPValue::Boolean(b) => write!(writer, "{}", b),
            RESPValue::BlobError(str) => write!(writer, "Error: {}", BStr::new(str)),
            RESPValue::VerbatimString(verbatim) => {
                write!(writer, "{}:{}", BStr::new(&verbatim.format), BStr::new(&verbatim.content))
            }
            RESPValue::Map(entries) => {
                writer.write_str("{")?;
                for (i, entry) in entries.iter().enumerate() {
                    if i > 0 {
                        writer.write_str(", ")?;
                    }
                    fmt::Display::fmt(&entry.key, writer)?;
                    writer.write_str(": ")?;
                    fmt::Display::fmt(&entry.value, writer)?;
                }
                writer.write_str("}")
            }
            RESPValue::Set(set) => {
                writer.write_str("Set{")?;
                for (i, value) in set.iter().enumerate() {
                    if i > 0 {
                        writer.write_str(", ")?;
                    }
                    fmt::Display::fmt(value, writer)?;
                }
                writer.write_str("}")
            }
            RESPValue::Attribute(attribute) => {
                writer.write_str("(Attr: ")?;
                writer.write_str("{")?;
                for (i, entry) in attribute.attributes.iter().enumerate() {
                    if i > 0 {
                        writer.write_str(", ")?;
                    }
                    fmt::Display::fmt(&entry.key, writer)?;
                    writer.write_str(": ")?;
                    fmt::Display::fmt(&entry.value, writer)?;
                }
                writer.write_str("} => ")?;
                fmt::Display::fmt(&*attribute.value, writer)?;
                writer.write_str(")")
            }
            RESPValue::Push(push) => {
                write!(writer, "Push({}: [", BStr::new(&push.kind))?;
                for (i, value) in push.data.iter().enumerate() {
                    if i > 0 {
                        writer.write_str(", ")?;
                    }
                    fmt::Display::fmt(value, writer)?;
                }
                writer.write_str("])")
            }
            RESPValue::BigNumber(str) => write!(writer, "BigNumber({})", BStr::new(str)),
        }
    }
}

// `toJS` / `ToJSOptions` / `toJSWithOptions` aliases deleted — live in
// bun_runtime::valkey_jsc::protocol_jsc as extension-trait methods.

pub struct ValkeyReader<'a> {
    buffer: &'a [u8],
    pos: usize,
}

impl<'a> ValkeyReader<'a> {
    pub fn init(buffer: &'a [u8]) -> ValkeyReader<'a> {
        ValkeyReader { buffer, pos: 0 }
    }

    pub fn read_byte(&mut self) -> Result<u8, RedisError> {
        if self.pos >= self.buffer.len() {
            return Err(RedisError::InvalidResponse);
        }
        let byte = self.buffer[self.pos];
        self.pos += 1;
        Ok(byte)
    }

    pub fn read_until_crlf(&mut self) -> Result<&'a [u8], RedisError> {
        let buffer = &self.buffer[self.pos..];
        for (i, &byte) in buffer.iter().enumerate() {
            if byte == b'\r' && buffer.len() > i + 1 && buffer[i + 1] == b'\n' {
                let result = &buffer[0..i];
                self.pos += i + 2;
                return Ok(result);
            }
        }

        Err(RedisError::InvalidResponse)
    }

    pub fn read_integer(&mut self) -> Result<i64, RedisError> {
        let str = self.read_until_crlf()?;
        // TODO(port): RESP integers are ASCII; from_utf8 here only rejects already-invalid input.
        core::str::from_utf8(str)
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .ok_or(RedisError::InvalidInteger)
    }

    pub fn read_double(&mut self) -> Result<f64, RedisError> {
        let str = self.read_until_crlf()?;

        // Handle special values
        if str == b"inf" {
            return Ok(f64::INFINITY);
        }
        if str == b"-inf" {
            return Ok(f64::NEG_INFINITY);
        }
        if str == b"nan" {
            return Ok(f64::NAN);
        }

        // Parse normal double
        // TODO(port): RESP doubles are ASCII; from_utf8 here only rejects already-invalid input.
        core::str::from_utf8(str)
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or(RedisError::InvalidDouble)
    }

    pub fn read_boolean(&mut self) -> Result<bool, RedisError> {
        let str = self.read_until_crlf()?;
        if str.len() != 1 {
            return Err(RedisError::InvalidBoolean);
        }

        match str[0] {
            b't' => Ok(true),
            b'f' => Ok(false),
            _ => Err(RedisError::InvalidBoolean),
        }
    }

    pub fn read_verbatim_string(&mut self) -> Result<VerbatimString, RedisError> {
        let len = self.read_integer()?;
        if len < 0 {
            return Err(RedisError::InvalidVerbatimString);
        }
        let len = usize::try_from(len).unwrap();
        if self.pos + len > self.buffer.len() {
            return Err(RedisError::InvalidVerbatimString);
        }

        let content_with_format = &self.buffer[self.pos..self.pos + len];
        self.pos += len;

        // Expect CRLF after content
        let crlf = self.read_until_crlf()?;
        if !crlf.is_empty() {
            return Err(RedisError::InvalidVerbatimString);
        }

        // Format should be "xxx:" followed by content
        if content_with_format.len() < 4 || content_with_format[3] != b':' {
            return Err(RedisError::InvalidVerbatimString);
        }

        let format = Box::<[u8]>::from(&content_with_format[0..3]);
        let content = Box::<[u8]>::from(&content_with_format[4..]);

        Ok(VerbatimString { format, content })
    }

    /// Maximum allowed nesting depth for RESP aggregate types.
    /// This limits recursion to prevent excessive stack usage from
    /// deeply nested responses.
    const MAX_NESTING_DEPTH: usize = 128;

    pub fn read_value(&mut self) -> Result<RESPValue, RedisError> {
        self.read_value_with_depth(0)
    }

    fn read_value_with_depth(&mut self, depth: usize) -> Result<RESPValue, RedisError> {
        let type_byte = self.read_byte()?;

        match RESPType::from_byte(type_byte).ok_or(RedisError::InvalidResponseType)? {
            // RESP2 types
            RESPType::SimpleString => {
                let str = self.read_until_crlf()?;
                let owned = Box::<[u8]>::from(str);
                Ok(RESPValue::SimpleString(owned))
            }
            RESPType::Error => {
                let str = self.read_until_crlf()?;
                let owned = Box::<[u8]>::from(str);
                Ok(RESPValue::Error(owned))
            }
            RESPType::Integer => {
                let int = self.read_integer()?;
                Ok(RESPValue::Integer(int))
            }
            RESPType::BulkString => {
                let len = self.read_integer()?;
                if len < 0 {
                    return Ok(RESPValue::BulkString(None));
                }
                let len = usize::try_from(len).unwrap();
                if self.pos + len > self.buffer.len() {
                    return Err(RedisError::InvalidResponse);
                }
                let str = &self.buffer[self.pos..self.pos + len];
                self.pos += len;
                let crlf = self.read_until_crlf()?;
                if !crlf.is_empty() {
                    return Err(RedisError::InvalidBulkString);
                }
                let owned = Box::<[u8]>::from(str);
                Ok(RESPValue::BulkString(Some(owned)))
            }
            RESPType::Array => {
                if depth >= Self::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = self.read_integer()?;
                if len < 0 {
                    return Ok(RESPValue::Array(Vec::new()));
                }
                let len = usize::try_from(len).unwrap();
                let mut array = Vec::with_capacity(len);
                // errdefer cleanup handled by Vec Drop on `?`
                let mut i: usize = 0;
                while i < len {
                    array.push(self.read_value_with_depth(depth + 1)?);
                    i += 1;
                }
                Ok(RESPValue::Array(array))
            }

            // RESP3 types
            RESPType::Null => {
                let _ = self.read_until_crlf()?; // Read and discard CRLF
                Ok(RESPValue::Null)
            }
            RESPType::Double => {
                let d = self.read_double()?;
                Ok(RESPValue::Double(d))
            }
            RESPType::Boolean => {
                let b = self.read_boolean()?;
                Ok(RESPValue::Boolean(b))
            }
            RESPType::BlobError => {
                let len = self.read_integer()?;
                if len < 0 {
                    return Err(RedisError::InvalidBlobError);
                }
                let len = usize::try_from(len).unwrap();
                if self.pos + len > self.buffer.len() {
                    return Err(RedisError::InvalidBlobError);
                }
                let str = &self.buffer[self.pos..self.pos + len];
                self.pos += len;
                let crlf = self.read_until_crlf()?;
                if !crlf.is_empty() {
                    return Err(RedisError::InvalidBlobError);
                }
                let owned = Box::<[u8]>::from(str);
                Ok(RESPValue::BlobError(owned))
            }
            RESPType::VerbatimString => {
                Ok(RESPValue::VerbatimString(self.read_verbatim_string()?))
            }
            RESPType::Map => {
                if depth >= Self::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = self.read_integer()?;
                if len < 0 {
                    return Err(RedisError::InvalidMap);
                }
                let len = usize::try_from(len).unwrap();

                let mut entries = Vec::with_capacity(len);
                // errdefer cleanup handled by Vec Drop on `?`
                let mut i: usize = 0;
                while i < len {
                    let key = self.read_value_with_depth(depth + 1)?;
                    // errdefer key.deinit() — `key` drops automatically on `?` below
                    let value = self.read_value_with_depth(depth + 1)?;
                    entries.push(MapEntry { key, value });
                    i += 1;
                }
                Ok(RESPValue::Map(entries))
            }
            RESPType::Set => {
                if depth >= Self::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = self.read_integer()?;
                if len < 0 {
                    return Err(RedisError::InvalidSet);
                }
                let len = usize::try_from(len).unwrap();

                let mut set = Vec::with_capacity(len);
                // errdefer cleanup handled by Vec Drop on `?`
                let mut i: usize = 0;
                while i < len {
                    set.push(self.read_value_with_depth(depth + 1)?);
                    i += 1;
                }
                Ok(RESPValue::Set(set))
            }
            RESPType::Attribute => {
                if depth >= Self::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = self.read_integer()?;
                if len < 0 {
                    return Err(RedisError::InvalidAttribute);
                }
                let len = usize::try_from(len).unwrap();

                let mut attrs = Vec::with_capacity(len);
                // errdefer cleanup handled by Vec Drop on `?`
                let mut i: usize = 0;
                while i < len {
                    let key = self.read_value_with_depth(depth + 1)?;
                    // errdefer key.deinit() — `key` drops automatically on `?` below
                    let value = self.read_value_with_depth(depth + 1)?;
                    attrs.push(MapEntry { key, value });
                    i += 1;
                }

                // Read the actual value that follows the attributes
                let value = Box::new(self.read_value_with_depth(depth + 1)?);

                Ok(RESPValue::Attribute(Attribute {
                    attributes: attrs,
                    value,
                }))
            }
            RESPType::Push => {
                if depth >= Self::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = self.read_integer()?;
                if len < 0 || len == 0 {
                    return Err(RedisError::InvalidPush);
                }

                // First element is the push type
                let push_type = self.read_value_with_depth(depth + 1)?;
                // defer push_type.deinit() — drops at scope end
                let push_type_str: &[u8] = match &push_type {
                    RESPValue::SimpleString(str) => str,
                    RESPValue::BulkString(maybe_str) => {
                        if let Some(str) = maybe_str {
                            str
                        } else {
                            return Err(RedisError::InvalidPush);
                        }
                    }
                    _ => return Err(RedisError::InvalidPush),
                };

                // Copy the push type string since the original will be freed
                let push_type_dup = Box::<[u8]>::from(push_type_str);
                // errdefer free(push_type_dup) — drops automatically on `?`

                // Read the rest of the data
                let data_len = usize::try_from(len - 1).unwrap();
                let mut data = Vec::with_capacity(data_len);
                // errdefer cleanup handled by Vec Drop on `?`
                let mut i: usize = 0;
                while i < data_len {
                    data.push(self.read_value_with_depth(depth + 1)?);
                    i += 1;
                }

                Ok(RESPValue::Push(Push {
                    kind: push_type_dup,
                    data,
                }))
            }
            RESPType::BigNumber => {
                let str = self.read_until_crlf()?;
                let owned = Box::<[u8]>::from(str);
                Ok(RESPValue::BigNumber(owned))
            }
        }
    }
}

pub struct MapEntry {
    pub key: RESPValue,
    pub value: RESPValue,
}

// `MapEntry::deinit` deleted — fields drop automatically.

pub struct VerbatimString {
    pub format: Box<[u8]>, // e.g. "txt" or "mkd"
    pub content: Box<[u8]>,
}

// `VerbatimString::deinit` deleted — Box<[u8]> fields drop automatically.

pub struct Push {
    pub kind: Box<[u8]>,
    pub data: Vec<RESPValue>,
}

// `Push::deinit` deleted — Box/Vec fields drop automatically.

pub struct Attribute {
    pub attributes: Vec<MapEntry>,
    pub value: Box<RESPValue>,
}

// `Attribute::deinit` deleted — Vec/Box fields drop automatically.

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SubscriptionPushMessage {
    Message,
    Subscribe,
    Unsubscribe,
}

impl SubscriptionPushMessage {
    pub const MAP: phf::Map<&'static [u8], SubscriptionPushMessage> = phf::phf_map! {
        b"message" => SubscriptionPushMessage::Message,
        b"subscribe" => SubscriptionPushMessage::Subscribe,
        b"unsubscribe" => SubscriptionPushMessage::Unsubscribe,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/valkey/valkey_protocol.zig (564 lines)
//   confidence: medium
//   todos:      2
//   notes:      ValkeyReader carries <'a> (borrowed buffer); allocator params dropped; deinit→Drop auto; *_jsc aliases removed; Vec used for partial-fill arrays so errdefer→Drop
// ──────────────────────────────────────────────────────────────────────────
