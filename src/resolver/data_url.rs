use bun_core::strings;

// https://github.com/Vexu/zuri/blob/master/src/zuri.zig#L61-L127
pub struct PercentEncoding;

/// possible errors for decode and encode
#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeError {
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::named_error_set!(EncodeError);

impl PercentEncoding {
    /// returns true if str starts with a valid path character or a percent encoded octet
    pub fn is_pchar(str: &[u8]) -> bool {
        if cfg!(debug_assertions) {
            debug_assert!(!str.is_empty());
        }
        match str[0] {
            b'a'..=b'z'
            | b'A'..=b'Z'
            | b'0'..=b'9'
            | b'-'
            | b'.'
            | b'_'
            | b'~'
            | b'!'
            | b'$'
            | b'&'
            | b'\''
            | b'('
            | b')'
            | b'*'
            | b'+'
            | b','
            | b';'
            | b'='
            | b':'
            | b'@' => true,
            b'%' => str.len() >= 3 && str[1].is_ascii_hexdigit() && str[2].is_ascii_hexdigit(),
            _ => false,
        }
    }

    /// decode path if it is percent encoded, returns EncodeError if URL unsafe characters are present and not percent encoded
    pub fn decode(path: &[u8]) -> Result<Option<Vec<u8>>, EncodeError> {
        Self::_decode(path, true)
    }

    /// Replaces percent encoded entities within `path` without throwing an error if other URL unsafe characters are present
    pub fn decode_unstrict(path: &[u8]) -> Result<Option<Vec<u8>>, EncodeError> {
        Self::_decode(path, false)
    }

    fn _decode(path: &[u8], strict: bool) -> Result<Option<Vec<u8>>, EncodeError> {
        let mut ret: Option<Vec<u8>> = None;
        // errdefer: `ret` is a Vec — drops automatically on `?` error path
        let mut ret_index: usize = 0;
        let mut i: usize = 0;

        while i < path.len() {
            if path[i] == b'%'
                && path[i..].len() >= 3
                && path[i + 1].is_ascii_hexdigit()
                && path[i + 2].is_ascii_hexdigit()
            {
                if ret.is_none() {
                    let mut buf = vec![0u8; path.len()];
                    buf[..i].copy_from_slice(&path[0..i]);
                    ret = Some(buf);
                    ret_index = i;
                }

                // charToDigit can't fail because the chars are validated earlier
                ret.as_mut().unwrap()[ret_index] =
                    bun_core::fmt::hex_pair_value(path[i + 1], path[i + 2]).unwrap();
                ret_index += 1;
                i += 2;
            } else if path[i] != b'/' && !Self::is_pchar(&path[i..]) && strict {
                return Err(EncodeError::InvalidCharacter);
            } else if let Some(some) = ret.as_mut() {
                some[ret_index] = path[i];
                ret_index += 1;
            }

            i += 1;
        }

        if let Some(mut some) = ret {
            some.truncate(ret_index);
            return Ok(Some(some));
        }
        Ok(None)
    }
}

// PORT NOTE: `mime_type`/`data` are slices into the caller-provided `url` string.
// Classified as BORROW_PARAM — struct gets a lifetime parameter.
pub struct DataURL<'a> {
    pub url: bun_core::String,
    pub mime_type: &'a [u8],
    pub data: &'a [u8],
    pub is_base64: bool,
}

impl<'a> DataURL<'a> {
    pub fn parse(url: &'a [u8]) -> Result<Option<DataURL<'a>>, bun_core::Error> {
        // TODO(port): narrow error set
        if !url.starts_with(b"data:") {
            return Ok(None);
        }

        Ok(Some(Self::parse_without_check(url)?))
    }

    pub fn parse_without_check(url: &'a [u8]) -> Result<DataURL<'a>, bun_core::Error> {
        // TODO(port): narrow error set
        let comma =
            strings::index_of_char(url, b',').ok_or(bun_core::err!("InvalidDataURL"))? as usize;

        let mut parsed = DataURL {
            url: bun_core::String::empty(),
            mime_type: &url[b"data:".len()..comma],
            data: &url[comma + 1..url.len()],
            is_base64: false,
        };

        if parsed.mime_type.ends_with(b";base64") {
            parsed.mime_type = &parsed.mime_type[0..(parsed.mime_type.len() - b";base64".len())];
            parsed.is_base64 = true;
        }

        Ok(parsed)
    }

    pub fn decode_mime_type(&self) -> bun_http_types::MimeType::MimeType {
        bun_http_types::MimeType::MimeType::init(self.mime_type, false, None)
    }

    /// Decodes the data from the data URL. Always returns an owned slice.
    pub fn decode_data(&self) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let percent_decoded_owned: Option<Vec<u8>> = PercentEncoding::decode_unstrict(self.data)?;
        // defer: `percent_decoded_owned` drops at scope exit
        let percent_decoded: &[u8] = percent_decoded_owned.as_deref().unwrap_or(self.data);

        if self.is_base64 {
            let len = bun_base64::decode_len(percent_decoded);
            let mut buf = vec![0u8; len];
            // errdefer: `buf` drops automatically on error path
            let result = bun_base64::decode(&mut buf, percent_decoded);
            if !result.is_successful() || result.count != len {
                return Err(bun_core::err!("Base64DecodeError"));
            }
            return Ok(buf);
        }

        Ok(percent_decoded.to_vec())
    }

    /// Returns the shorter of either a base64-encoded or percent-escaped data URL
    pub fn encode_string_as_shortest_data_url(mime_type: &[u8], text: &[u8]) -> Vec<u8> {
        // Calculate base64 version
        let base64_encode_len = bun_base64::encode_len(text);
        let total_base64_encode_len =
            b"data:".len() + mime_type.len() + b";base64,".len() + base64_encode_len;

        'use_base64: {
            let mut counter = CountingBuf { len: 0 };
            let success =
                Self::encode_string_as_percent_escaped_data_url(&mut counter, mime_type, text);
            if !success {
                break 'use_base64;
            }

            if counter.len > total_base64_encode_len {
                break 'use_base64;
            }

            let mut buf: Vec<u8> = Vec::new();
            // errdefer: `buf` drops automatically
            let success2 =
                Self::encode_string_as_percent_escaped_data_url(&mut buf, mime_type, text);
            if !success2 {
                break 'use_base64;
            }
            return buf;
        }

        // TODO(port): Zig source's `bufPrint` writes `text` raw with `{s}` here, not the
        // base64-encoded form — ported faithfully; verify upstream intent in Phase B.
        let mut base64buf = Vec::with_capacity(total_base64_encode_len);
        base64buf.extend_from_slice(b"data:");
        base64buf.extend_from_slice(mime_type);
        base64buf.extend_from_slice(b";base64,");
        base64buf.extend_from_slice(text);
        base64buf
    }

    pub fn encode_string_as_percent_escaped_data_url(
        buf: &mut impl DataUrlBuf,
        mime_type: &[u8],
        text: &[u8],
    ) -> bool {
        buf.append_slice(b"data:");
        buf.append_slice(mime_type);
        buf.append(b',');

        // Scan for trailing characters that need to be escaped
        let mut trailing_start = text.len();
        while trailing_start > 0 {
            let c = text[trailing_start - 1];
            if c > 0x20 || c == b'\t' || c == b'\n' || c == b'\r' {
                break;
            }
            trailing_start -= 1;
        }

        if !strings::is_valid_utf8(text) {
            return false;
        }

        let mut i: usize = 0;
        let mut run_start: usize = 0;

        // TODO: vectorize this
        while i < text.len() {
            let first_byte = text[i];

            // Check if we need to escape this character
            let needs_escape = first_byte == b'\t'
                || first_byte == b'\n'
                || first_byte == b'\r'
                || first_byte == b'#'
                || i >= trailing_start
                || (first_byte == b'%'
                    && i + 2 < text.len()
                    && text[i + 1].is_ascii_hexdigit()
                    && text[i + 2].is_ascii_hexdigit());

            if needs_escape {
                if run_start < i {
                    buf.append_slice(&text[run_start..i]);
                }
                let [hi, lo] = bun_core::fmt::hex_byte_upper(first_byte);
                buf.append(b'%');
                buf.append(hi);
                buf.append(lo);
                run_start = i + 1;
            }

            i += strings::wtf8_byte_sequence_length(first_byte) as usize;
        }

        if run_start < text.len() {
            buf.append_slice(&text[run_start..]);
        }

        true
    }
}

/// Abstraction over `Vec<u8>` and `CountingBuf` for `encode_string_as_percent_escaped_data_url`
/// (Zig used `buf: anytype` calling `.appendSlice`/`.append`).
// PERF(port): Zig anytype was infallible OOM-abort via Vec; trait methods are infallible here.
pub trait DataUrlBuf {
    fn append_slice(&mut self, slice: &[u8]);
    fn append(&mut self, c: u8);
}

impl DataUrlBuf for Vec<u8> {
    #[inline]
    fn append_slice(&mut self, slice: &[u8]) {
        self.extend_from_slice(slice);
    }
    #[inline]
    fn append(&mut self, c: u8) {
        self.push(c);
    }
}

#[derive(Default)]
struct CountingBuf {
    len: usize,
}

impl DataUrlBuf for CountingBuf {
    #[inline]
    fn append_slice(&mut self, slice: &[u8]) {
        self.len += slice.len();
    }
    #[inline]
    fn append(&mut self, _: u8) {
        self.len += 1;
    }
}

// ported from: src/resolver/data_url.zig
