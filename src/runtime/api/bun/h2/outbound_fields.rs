//! The one walk over the headers JS hands to `node:http2`: validates them and stages them for the HPACK encoder.

use std::borrow::Cow;

use bstr::BStr;
use bun_core::strings;
use bun_http::lshpack::HeaderBlock;
use bun_http_types::is_token_char;
use bun_jsc::{ErrorCode, JSGlobalObject, JSValue, JsResult};

/// Which pseudo-headers a block may have.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BlockRole {
    /// A request, or the promised request of a PUSH_PROMISE.
    Request,
    Response,
    Trailers,
}

impl BlockRole {
    fn allows_pseudo_header(self, name: &[u8]) -> bool {
        match self {
            BlockRole::Request => matches!(
                name,
                b":path" | b":method" | b":scheme" | b":protocol" | b":authority"
            ),
            BlockRole::Response => name == b":status",
            BlockRole::Trailers => false,
        }
    }
}

const SINGLE_VALUE_HEADERS_LEN: usize = 40;

bun_core::comptime_string_map! {
    /// Each header that takes one value, with its slot in `Walk::seen_single_value`.
    static SINGLE_VALUE_HEADERS: usize = {
        b"tk" => 36,
        b"age" => 9,
        b"dnt" => 19,
        b"date" => 18,
        b"etag" => 20,
        b"from" => 22,
        b"host" => 23,
        b":path" => 4,
        b"range" => 33,
        b":status" => 0,
        b":method" => 1,
        b":scheme" => 3,
        b"expires" => 21,
        b"referer" => 34,
        b"if-match" => 24,
        b"if-range" => 27,
        b"location" => 30,
        b":protocol" => 5,
        b":authority" => 2,
        b"user-agent" => 38,
        b"content-md5" => 15,
        b"retry-after" => 35,
        b"content-type" => 17,
        b"max-forwards" => 31,
        b"authorization" => 10,
        b"content-range" => 16,
        b"if-none-match" => 26,
        b"last-modified" => 29,
        b"content-length" => 13,
        b"content-encoding" => 11,
        b"content-language" => 12,
        b"content-location" => 14,
        b"if-modified-since" => 25,
        b"if-unmodified-since" => 28,
        b"proxy-authorization" => 32,
        b"access-control-max-age" => 7,
        b"x-content-type-options" => 39,
        b"upgrade-insecure-requests" => 37,
        b"access-control-request-method" => 8,
        b"access-control-allow-credentials" => 6,
    };
}

/// lshpack's limit on a header name.
const MAX_NAME_LEN: usize = 4096;

/// The wire bytes of a header value, an ALTSVC field or an origin: one byte per code unit like Node, or UTF-8 if a unit is above 0xFF.
pub(crate) fn header_value_bytes<'a>(value: &'a bun_jsc::JSStringView<'_>) -> Cow<'a, [u8]> {
    if !value.is_utf16() {
        return Cow::Borrowed(value.latin1());
    }
    let units = value.utf16();
    if units.iter().any(|&unit| unit > 0xFF) {
        return Cow::Owned(value.to_owned_slice());
    }
    let mut bytes = vec![0u8; units.len()];
    strings::copy_u16_into_u8(&mut bytes, units);
    Cow::Owned(bytes)
}

/// The lowercase form of `name`, or `None` unless it's a token, after the ":" of a pseudo-header.
fn lowercase_name<'a>(name: &'a [u8], buffer: &'a mut [u8; MAX_NAME_LEN]) -> Option<&'a [u8]> {
    let token = name.strip_prefix(b":").unwrap_or(name);
    if name.len() > MAX_NAME_LEN || !token.iter().all(|&c| is_token_char(c)) {
        return None;
    }
    if !name.iter().any(u8::is_ascii_uppercase) {
        return Some(name);
    }
    let lowered = &mut buffer[..name.len()];
    lowered.copy_from_slice(name);
    lowered.make_ascii_lowercase();
    Some(lowered)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pass {
    Pseudo,
    Regular,
    /// Trailers have no pseudo-headers to put first.
    All,
}

struct Walk<'a> {
    global: &'a JSGlobalObject,
    /// An object whose keys are the lowercase names that are never indexed.
    sensitive: JSValue,
    role: BlockRole,
    strict_single_value: bool,
    seen_single_value: [bool; SINGLE_VALUE_HEADERS_LEN],
    name_buffer: [u8; MAX_NAME_LEN],
    block: Option<&'a mut HeaderBlock>,
}

impl Walk<'_> {
    fn field(&mut self, pass: Pass, name: &[u8], js_value: JSValue) -> JsResult<()> {
        let global = self.global;
        let lowered = lowercase_name(name, &mut self.name_buffer);
        let is_pseudo = name.first() == Some(&b':');
        if is_pseudo && !lowered.is_some_and(|n| self.role.allows_pseudo_header(n)) {
            return Err(global
                .err(
                    ErrorCode::HTTP2_INVALID_PSEUDOHEADER,
                    format_args!(
                        "\"{}\" is an invalid pseudoheader or is used incorrectly",
                        BStr::new(name)
                    ),
                )
                .throw());
        }
        let Some(lowered) = lowered else {
            return Err(global
                .err(
                    ErrorCode::INVALID_HTTP_TOKEN,
                    format_args!(
                        "Header name must be a valid HTTP token [\"{}\"]",
                        BStr::new(name)
                    ),
                )
                .throw());
        };
        if (pass == Pass::Pseudo && !is_pseudo) || (pass == Pass::Regular && is_pseudo) {
            return Ok(());
        }

        // An array is one field per element. Like Node, an empty one is no field at all.
        let mut elements = if js_value.js_type().is_array() {
            Some(js_value.array_iterator(global)?)
        } else {
            None
        };
        let field_count = elements.as_ref().map_or(1, |iter| iter.len);
        if field_count == 0 {
            return Ok(());
        }
        if self.strict_single_value
            && let Some(&slot) = SINGLE_VALUE_HEADERS.get(lowered)
        {
            if field_count > 1 || self.seen_single_value[slot] {
                return Err(global
                    .err(
                        ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                        format_args!(
                            "Header field \"{}\" must only have a single value",
                            BStr::new(lowered)
                        ),
                    )
                    .throw());
            }
            self.seen_single_value[slot] = true;
        }
        // Validation stops here, before a value's toString() runs.
        let Some(block) = self.block.as_deref_mut() else {
            return Ok(());
        };

        // A property lookup by an index-like name asserts, and such a name is never sensitive.
        let never_index = !lowered.iter().all(u8::is_ascii_digit)
            && self.sensitive.get_truthy(global, lowered)?.is_some();
        let mut push = |item: JSValue| -> JsResult<()> {
            let view = item.to_js_string_view(global)?;
            let value = header_value_bytes(&view);
            if strings::contains_any(&value, b"\0\n\r") {
                return Err(global
                    .err(
                        ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                        format_args!("Invalid value for header \"{}\"", BStr::new(lowered)),
                    )
                    .throw());
            }
            block
                .push(lowered, &value, never_index)
                .map_err(|_| global.throw(format_args!("Failed to allocate header buffer")))
        };
        match elements.as_mut() {
            Some(iter) => {
                while let Some(item) = iter.next()? {
                    push(item)?;
                }
                Ok(())
            }
            None => push(js_value),
        }
    }
}

/// Stages the fields of `headers`, an object or a flat `[name, value, ...]` array, pseudo-headers first. Without a `block` it only checks the names.
pub(crate) fn collect_fields(
    global: &JSGlobalObject,
    headers: JSValue,
    sensitive: JSValue,
    role: BlockRole,
    strict_single_value: bool,
    block: Option<&mut HeaderBlock>,
) -> JsResult<()> {
    let mut walk = Walk {
        global,
        sensitive,
        role,
        strict_single_value,
        seen_single_value: [false; SINGLE_VALUE_HEADERS_LEN],
        name_buffer: [0; MAX_NAME_LEN],
        block,
    };
    let passes: &[Pass] = if role == BlockRole::Trailers {
        &[Pass::All]
    } else {
        &[Pass::Pseudo, Pass::Regular]
    };
    let Some(object) = headers.get_object() else {
        return Ok(());
    };
    for &pass in passes {
        if headers.js_type().is_array() {
            let mut pairs = headers.array_iterator(global)?;
            while let Some(name_js) = pairs.next()? {
                let Some(value_js) = pairs.next()? else { break };
                if name_js.is_empty_or_undefined_or_null() || value_js.is_undefined() {
                    continue;
                }
                let name_view = name_js.to_js_string_view(global)?;
                let name = name_view.to_utf8();
                if !name.slice().is_empty() {
                    walk.field(pass, name.slice(), value_js)?;
                }
            }
            continue;
        }
        let iter = bun_jsc::JSPropertyIterator::init(
            global,
            object,
            bun_jsc::JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;
        while let Some((name, value_js)) = iter.next()? {
            if name.length() == 0 || value_js.is_undefined() {
                continue;
            }
            walk.field(pass, name.to_utf8().slice(), value_js)?;
        }
    }
    Ok(())
}
