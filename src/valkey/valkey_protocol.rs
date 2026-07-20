use core::fmt;

use bstr::BStr;

#[derive(strum::IntoStaticStr, strum::EnumString, Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedisError {
    AuthenticationFailed,
    ServerError,
    ConnectionClosed,
    InvalidArgument,
    InvalidAttribute,
    InvalidBlobError,
    InvalidBoolean,
    InvalidBulkString,
    InvalidCommand,
    InvalidDouble,
    InvalidInteger,
    InvalidMap,
    InvalidPush,
    InvalidResponse,
    InvalidResponseType,
    InvalidSet,
    InvalidVerbatimString,
    OutOfMemory,
    UnsupportedProtocol,
    ConnectionTimeout,
    IdleTimeout,
    NestingDepthExceeded,
    LineTooLong,
}

bun_core::impl_tag_error!(RedisError);

/// RESP protocol types
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum RESPType {
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
    pub(crate) fn from_byte(byte: u8) -> Option<RESPType> {
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

impl RESPValue {
    /// `Some(msg)` when the value is a server-side error reply (`-ERR…` or
    /// RESP3 `!…`), peeling through any `Attribute` wrapper. Used by the
    /// client to decide resolve-vs-reject for a command promise.
    pub fn as_server_error(&self) -> Option<&[u8]> {
        match self {
            RESPValue::Error(msg) | RESPValue::BlobError(msg) => Some(msg),
            RESPValue::Attribute(attr) => attr.value.as_server_error(),
            _ => None,
        }
    }
}

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
                write!(
                    writer,
                    "{}:{}",
                    BStr::new(&verbatim.format),
                    BStr::new(&verbatim.content)
                )
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

pub struct ValkeyReader<'a> {
    buffer: &'a [u8],
    pos: usize,
    /// Bytes of aggregate `Vec` preallocation still allowed for the current
    /// `read_value` call. See `take_prealloc_budget`.
    prealloc_budget: usize,
    crlf_skip: usize,
}

impl<'a> ValkeyReader<'a> {
    pub fn init(buffer: &'a [u8]) -> ValkeyReader<'a> {
        ValkeyReader {
            buffer,
            pos: 0,
            prealloc_budget: buffer.len(),
            crlf_skip: 0,
        }
    }

    /// Current read offset into the underlying buffer.
    ///
    /// Callers use this to compute how many bytes a `read_value` call consumed.
    #[inline]
    pub fn pos(&self) -> usize {
        self.pos
    }

    fn read_byte(&mut self) -> Result<u8, RedisError> {
        if self.pos >= self.buffer.len() {
            return Err(RedisError::InvalidResponse);
        }
        let byte = self.buffer[self.pos];
        self.pos += 1;
        Ok(byte)
    }

    fn read_until_crlf(&mut self) -> Result<&'a [u8], RedisError> {
        let buffer = &self.buffer[self.pos..];
        let limit = buffer.len().min(Self::MAX_LINE_LEN + 1);
        let start = self.crlf_skip.min(limit);
        self.crlf_skip = 0;
        for (i, &byte) in buffer.iter().enumerate().take(limit).skip(start) {
            if byte == b'\r' && buffer.len() > i + 1 && buffer[i + 1] == b'\n' {
                let result = &buffer[0..i];
                self.pos += i + 2;
                return Ok(result);
            }
        }
        if buffer.len() > Self::MAX_LINE_LEN + 1 {
            return Err(RedisError::LineTooLong);
        }
        Err(RedisError::InvalidResponse)
    }

    fn read_integer(&mut self) -> Result<i64, RedisError> {
        let str = self.read_until_crlf()?;
        bun_core::fmt::parse_int::<i64>(str, 10).map_err(|_| RedisError::InvalidInteger)
    }

    fn read_double(&mut self) -> Result<f64, RedisError> {
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
        bun_core::fmt::parse_f64(str).ok_or(RedisError::InvalidDouble)
    }

    fn read_boolean(&mut self) -> Result<bool, RedisError> {
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

    /// Consume a CRLF at the current position. Unlike `read_until_crlf` this
    /// inspects exactly two bytes, so a malformed trailer fails in O(1).
    fn expect_crlf(&mut self, invalid: RedisError) -> Result<(), RedisError> {
        match self.buffer.get(self.pos..self.pos + 2) {
            Some([b'\r', b'\n']) => {
                self.pos += 2;
                Ok(())
            }
            Some(_) => Err(invalid),
            None => Err(RedisError::InvalidResponse),
        }
    }

    /// Read a length-prefixed blob (`$`, `!`, `=`) and its trailing CRLF.
    /// Returns `Ok(None)` only when `allow_null` and the declared length is
    /// negative (RESP2 `$-1`). The bounds check subtracts instead of adding so
    /// `pos + len` can never wrap `usize`.
    fn read_blob(
        &mut self,
        allow_null: bool,
        invalid: RedisError,
    ) -> Result<Option<&'a [u8]>, RedisError> {
        let len = self.read_integer()?;
        if len < 0 {
            return if allow_null { Ok(None) } else { Err(invalid) };
        }
        if len > Self::MAX_BULK_LEN {
            return Err(invalid);
        }
        let len = usize::try_from(len).expect("int cast");
        if self.buffer.len() - self.pos < len {
            return Err(RedisError::InvalidResponse);
        }
        let start = self.pos;
        self.pos += len;
        self.expect_crlf(invalid)?;
        Ok(Some(&self.buffer[start..start + len]))
    }

    fn read_verbatim_string(&mut self) -> Result<VerbatimString, RedisError> {
        let content_with_format = self
            .read_blob(false, RedisError::InvalidVerbatimString)?
            .expect("!allow_null");

        // Format should be "xxx:" followed by content
        if content_with_format.len() < 4 || content_with_format[3] != b':' {
            return Err(RedisError::InvalidVerbatimString);
        }

        let format: [u8; 3] = content_with_format[0..3].try_into().expect("3-byte slice");
        let content = Box::<[u8]>::from(&content_with_format[4..]);

        Ok(VerbatimString { format, content })
    }

    /// Maximum allowed nesting depth for RESP aggregate types.
    /// This limits recursion to prevent excessive stack usage from
    /// deeply nested responses.
    const MAX_NESTING_DEPTH: usize = 128;

    /// Maximum accepted length for a single RESP blob (`$`, `=`, `!`).
    /// Matches the Redis/Valkey server default `proto-max-bulk-len` of 512 MB.
    /// Declared lengths above this fail the parse so the connection state
    /// machine stops buffering instead of growing the read buffer toward an
    /// attacker-chosen size.
    const MAX_BULK_LEN: i64 = 512 * 1024 * 1024;

    /// Maximum accepted length for a CRLF-terminated RESP line (`+ - : _ , # (`).
    /// Mirrors `MAX_BULK_LEN` so line-terminated replies get the same
    /// buffer-growth bound as length-prefixed blobs; the spec places no limit.
    const MAX_LINE_LEN: usize = Self::MAX_BULK_LEN as usize;

    /// Caps an aggregate's `Vec::with_capacity` so the total bytes reserved
    /// across the whole parse — every nesting level combined — never exceed
    /// the input buffer's size. Re-applying a per-level "remaining buffer"
    /// cap at each of up to `MAX_NESTING_DEPTH` levels would let a hostile
    /// server amplify a few KB of nested aggregate headers carrying huge
    /// declared lengths into gigabytes of reserved capacity.
    fn take_prealloc_budget(&mut self, len: usize, element_size: usize) -> usize {
        let cap = len.min(self.prealloc_budget / element_size.max(1));
        self.prealloc_budget -= cap * element_size;
        cap
    }

    /// Shared prelude for `* % ~ | >`: depth guard + signed length read.
    /// `Ok(None)` only when `allow_null` and the declared length is negative
    /// (RESP2 `*-1`).
    fn read_aggregate_header(
        &mut self,
        depth: usize,
        allow_null: bool,
        invalid: RedisError,
    ) -> Result<Option<usize>, RedisError> {
        if depth >= Self::MAX_NESTING_DEPTH {
            return Err(RedisError::NestingDepthExceeded);
        }
        let len = self.read_integer()?;
        if len < 0 {
            return if allow_null { Ok(None) } else { Err(invalid) };
        }
        Ok(Some(usize::try_from(len).expect("int cast")))
    }

    fn read_n_values(&mut self, depth: usize, len: usize) -> Result<Vec<RESPValue>, RedisError> {
        let mut out = Vec::with_capacity(self.take_prealloc_budget(len, size_of::<RESPValue>()));
        for _ in 0..len {
            out.push(self.read_value_with_depth(depth + 1)?);
        }
        Ok(out)
    }

    fn read_n_entries(&mut self, depth: usize, len: usize) -> Result<Vec<MapEntry>, RedisError> {
        let mut out = Vec::with_capacity(self.take_prealloc_budget(len, size_of::<MapEntry>()));
        for _ in 0..len {
            let key = self.read_value_with_depth(depth + 1)?;
            let value = self.read_value_with_depth(depth + 1)?;
            out.push(MapEntry { key, value });
        }
        Ok(out)
    }

    /// Parse one complete RESP value. Returns `Ok(None)` when the buffer ends
    /// mid-value (caller should append more bytes and retry); `Err` is always a
    /// real protocol error.
    pub fn read_value(&mut self) -> Result<Option<RESPValue>, RedisError> {
        self.prealloc_budget = self.buffer.len() - self.pos;
        let start = self.pos;
        match self.read_value_with_depth(0) {
            Ok(v) => Ok(Some(v)),
            Err(RedisError::InvalidResponse) => {
                self.pos = start;
                Ok(None)
            }
            Err(e) => Err(e),
        }
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
            RESPType::BulkString => Ok(RESPValue::BulkString(
                self.read_blob(true, RedisError::InvalidBulkString)?
                    .map(Box::<[u8]>::from),
            )),
            RESPType::Array => {
                match self.read_aggregate_header(depth, true, RedisError::InvalidResponse)? {
                    None => Ok(RESPValue::Null),
                    Some(n) => Ok(RESPValue::Array(self.read_n_values(depth, n)?)),
                }
            }

            // RESP3 types
            RESPType::Null => {
                self.expect_crlf(RedisError::InvalidResponseType)?;
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
                let bytes = self
                    .read_blob(false, RedisError::InvalidBlobError)?
                    .expect("!allow_null");
                Ok(RESPValue::BlobError(Box::<[u8]>::from(bytes)))
            }
            RESPType::VerbatimString => Ok(RESPValue::VerbatimString(self.read_verbatim_string()?)),
            RESPType::Map => {
                let n = self
                    .read_aggregate_header(depth, false, RedisError::InvalidMap)?
                    .expect("!allow_null");
                Ok(RESPValue::Map(self.read_n_entries(depth, n)?))
            }
            RESPType::Set => {
                let n = self
                    .read_aggregate_header(depth, false, RedisError::InvalidSet)?
                    .expect("!allow_null");
                Ok(RESPValue::Set(self.read_n_values(depth, n)?))
            }
            RESPType::Attribute => {
                let n = self
                    .read_aggregate_header(depth, false, RedisError::InvalidAttribute)?
                    .expect("!allow_null");
                let attributes = self.read_n_entries(depth, n)?;
                let value = Box::new(self.read_value_with_depth(depth + 1)?);
                Ok(RESPValue::Attribute(Attribute { attributes, value }))
            }
            RESPType::Push => {
                let n = self
                    .read_aggregate_header(depth, false, RedisError::InvalidPush)?
                    .expect("!allow_null");
                if n == 0 {
                    return Err(RedisError::InvalidPush);
                }
                // First element is the push type
                let kind: Box<[u8]> = match self.read_value_with_depth(depth + 1)? {
                    RESPValue::SimpleString(s) | RESPValue::BulkString(Some(s)) => s,
                    _ => return Err(RedisError::InvalidPush),
                };
                let data = self.read_n_values(depth, n - 1)?;
                Ok(RESPValue::Push(Push { kind, data }))
            }
            RESPType::BigNumber => {
                let str = self.read_until_crlf()?;
                let owned = Box::<[u8]>::from(str);
                Ok(RESPValue::BigNumber(owned))
            }
        }
    }
}

/// Outcome of an incremental [`ReplyScanner::scan`] pass.
pub enum ScanResult {
    /// A complete top-level reply is buffered and safe to hand to
    /// [`ValkeyReader::read_value`].
    Complete,
    /// The buffer does not yet contain a complete reply.
    NeedMoreData,
}

/// Incrementally locates the end of the next complete RESP reply without
/// materializing any values.
///
/// `on_data` re-runs the tree parser over the accumulated read buffer on every
/// socket callback. Without this scanner, an aggregate reply (`*N`, `%N`, `~N`,
/// `>N`, `|N`) whose elements arrive in separate TCP segments is re-parsed from
/// its header each time — O(N^2) element parses for an N-element reply, which a
/// hostile server can use to pin the JS thread. The scanner persists its byte
/// offset and the stack of in-progress aggregates across calls so each buffered
/// byte is examined a bounded number of times; the allocating parser only runs
/// once a full reply is known to be present.
#[derive(Default)]
pub struct ReplyScanner {
    /// Byte offset of the next unscanned element, relative to the start of the
    /// buffer passed to [`ReplyScanner::scan`].
    pos: usize,
    /// Remaining child-value count for each in-progress aggregate, outermost
    /// first.
    stack: Vec<u64>,
    crlf_skip: usize,
}

impl ReplyScanner {
    /// Discard all progress. Must be called whenever the underlying buffer is
    /// consumed or replaced.
    pub fn reset(&mut self) {
        self.pos = 0;
        self.stack.clear();
        self.crlf_skip = 0;
    }

    /// Resume scanning `buffer` (the connection's accumulated, unconsumed read
    /// buffer) for the end of the next complete reply. `buffer` must be the
    /// same byte stream as the previous call with zero or more bytes appended.
    pub fn scan(&mut self, buffer: &[u8]) -> Result<ScanResult, RedisError> {
        loop {
            let mut reader = ValkeyReader {
                buffer,
                pos: self.pos,
                prealloc_budget: 0,
                crlf_skip: self.crlf_skip,
            };
            let children = match Self::scan_one(&mut reader, self.stack.len()) {
                Ok(children) => children,
                // `InvalidResponse` is the parser's "ran out of bytes" sentinel.
                Err(RedisError::InvalidResponse) => {
                    self.crlf_skip = if reader.pos == self.pos + 1 {
                        (buffer.len() - reader.pos).saturating_sub(1)
                    } else {
                        0
                    };
                    return Ok(ScanResult::NeedMoreData);
                }
                Err(err) => return Err(err),
            };
            self.crlf_skip = 0;
            self.pos = reader.pos;
            if let Some(children) = children
                && children > 0
            {
                self.stack.push(children);
                continue;
            }
            // A scalar or empty aggregate finished; unwind every aggregate it
            // completes.
            while let Some(remaining) = self.stack.last_mut() {
                *remaining -= 1;
                if *remaining > 0 {
                    break;
                }
                self.stack.pop();
            }
            if self.stack.is_empty() {
                return Ok(ScanResult::Complete);
            }
        }
    }

    /// Skip a single element starting at `reader.pos`. Returns `Some(n)` for an
    /// aggregate expecting `n` further child values, or `None` for a
    /// fully-skipped scalar. `InvalidResponse` means the element is not yet
    /// fully buffered and is never surfaced past [`ReplyScanner::scan`].
    fn scan_one(reader: &mut ValkeyReader<'_>, depth: usize) -> Result<Option<u64>, RedisError> {
        let type_byte = reader.read_byte()?;
        let ty = RESPType::from_byte(type_byte).ok_or(RedisError::InvalidResponseType)?;
        match ty {
            RESPType::SimpleString
            | RESPType::Error
            | RESPType::Integer
            | RESPType::Null
            | RESPType::Double
            | RESPType::Boolean
            | RESPType::BigNumber => {
                let _ = reader.read_until_crlf()?;
                Ok(None)
            }
            RESPType::BulkString | RESPType::BlobError | RESPType::VerbatimString => {
                let invalid = match ty {
                    RESPType::BlobError => RedisError::InvalidBlobError,
                    RESPType::VerbatimString => RedisError::InvalidVerbatimString,
                    _ => RedisError::InvalidBulkString,
                };
                let len = reader.read_integer()?;
                if len < 0 {
                    // Only `$-1` (RESP2 null bulk string) is legal; the tree
                    // parser rejects negative `!`/`=` lengths.
                    return if ty == RESPType::BulkString {
                        Ok(None)
                    } else {
                        Err(invalid)
                    };
                }
                if len > ValkeyReader::MAX_BULK_LEN {
                    return Err(invalid);
                }
                let len = usize::try_from(len).expect("int cast");
                // The payload plus its trailing CRLF must be fully buffered.
                if reader.buffer.len() - reader.pos < len + 2 {
                    return Err(RedisError::InvalidResponse);
                }
                if reader.buffer[reader.pos + len] != b'\r'
                    || reader.buffer[reader.pos + len + 1] != b'\n'
                {
                    return Err(invalid);
                }
                reader.pos += len + 2;
                Ok(None)
            }
            RESPType::Array | RESPType::Set | RESPType::Push => {
                if depth >= ValkeyReader::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = reader.read_integer()?;
                // Mirror the tree parser: only `*-1` (RESP2 null array) is a
                // legal non-positive aggregate length here.
                match ty {
                    RESPType::Array if len < 0 => Ok(Some(0)),
                    RESPType::Set if len < 0 => Err(RedisError::InvalidSet),
                    RESPType::Push if len <= 0 => Err(RedisError::InvalidPush),
                    _ => Ok(Some(u64::try_from(len).expect("int cast"))),
                }
            }
            RESPType::Map => {
                if depth >= ValkeyReader::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = reader.read_integer()?;
                if len < 0 {
                    return Err(RedisError::InvalidMap);
                }
                Ok(Some(
                    u64::try_from(len).expect("int cast").saturating_mul(2),
                ))
            }
            RESPType::Attribute => {
                if depth >= ValkeyReader::MAX_NESTING_DEPTH {
                    return Err(RedisError::NestingDepthExceeded);
                }
                let len = reader.read_integer()?;
                if len < 0 {
                    return Err(RedisError::InvalidAttribute);
                }
                Ok(Some(
                    u64::try_from(len)
                        .expect("int cast")
                        .saturating_mul(2)
                        .saturating_add(1),
                ))
            }
        }
    }
}

pub struct MapEntry {
    pub key: RESPValue,
    pub value: RESPValue,
}

pub struct VerbatimString {
    pub format: [u8; 3], // e.g. "txt" or "mkd"
    pub content: Box<[u8]>,
}

pub struct Push {
    pub kind: Box<[u8]>,
    pub data: Vec<RESPValue>,
}

pub struct Attribute {
    pub attributes: Vec<MapEntry>,
    pub value: Box<RESPValue>,
}

/// The nine RESP3 pub/sub push kinds: plain, pattern (`p`-prefixed) and
/// sharded (`s`-prefixed) message delivery plus the matching subscribe /
/// unsubscribe acks.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SubscriptionPushMessage {
    Message,
    PMessage,
    SMessage,
    Subscribe,
    PSubscribe,
    SSubscribe,
    Unsubscribe,
    PUnsubscribe,
    SUnsubscribe,
}

bun_core::comptime_string_map! {
    static SUBSCRIPTION_PUSH_MESSAGES: SubscriptionPushMessage = {
        b"message" => SubscriptionPushMessage::Message,
        b"pmessage" => SubscriptionPushMessage::PMessage,
        b"smessage" => SubscriptionPushMessage::SMessage,
        b"subscribe" => SubscriptionPushMessage::Subscribe,
        b"psubscribe" => SubscriptionPushMessage::PSubscribe,
        b"ssubscribe" => SubscriptionPushMessage::SSubscribe,
        b"unsubscribe" => SubscriptionPushMessage::Unsubscribe,
        b"punsubscribe" => SubscriptionPushMessage::PUnsubscribe,
        b"sunsubscribe" => SubscriptionPushMessage::SUnsubscribe,
    };
}

impl SubscriptionPushMessage {
    #[inline]
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        SUBSCRIPTION_PUSH_MESSAGES.get(bytes).copied()
    }

    #[inline]
    pub fn is_message(self) -> bool {
        matches!(self, Self::Message | Self::PMessage | Self::SMessage)
    }

    #[inline]
    pub fn is_subscribe_ack(self) -> bool {
        matches!(self, Self::Subscribe | Self::PSubscribe | Self::SSubscribe)
    }

    #[inline]
    pub fn is_unsubscribe_ack(self) -> bool {
        matches!(
            self,
            Self::Unsubscribe | Self::PUnsubscribe | Self::SUnsubscribe
        )
    }
}
