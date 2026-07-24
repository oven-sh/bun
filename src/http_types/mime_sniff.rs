//! WHATWG MIME type parsing and serialization.
//!
//! Implements "parse a MIME type" / "serialize a MIME type" from the MIME
//! Sniffing standard (<https://mimesniff.spec.whatwg.org/#parsing-a-mime-type>)
//! and "extract a MIME type" from the Fetch standard
//! (<https://fetch.spec.whatwg.org/#concept-header-extract-mime-type>),
//! including the "get, decode, and split" step over a comma-combined header
//! value. Body consumers (`Response.prototype.blob()` and friends) use this:
//! the returned Blob's `type` is the serialized extraction result, not the raw
//! header bytes.
//!
//! Everything operates on bytes. Non-ASCII UTF-8 bytes (all >= 0x80) are never
//! HTTP token code points and are always HTTP quoted-string token code points,
//! exactly like the non-ASCII code points they encode, so byte-wise iteration
//! is equivalent to the spec's code-point iteration.

/// <https://fetch.spec.whatwg.org/#http-whitespace>
#[inline]
fn is_http_whitespace(b: u8) -> bool {
    matches!(b, b'\t' | b'\n' | b'\r' | b' ')
}

/// <https://fetch.spec.whatwg.org/#http-tab-or-space>
#[inline]
fn is_http_tab_or_space(b: u8) -> bool {
    matches!(b, b'\t' | b' ')
}

/// <https://mimesniff.spec.whatwg.org/#http-token-code-point>
#[inline]
fn is_http_token(b: u8) -> bool {
    b.is_ascii_alphanumeric()
        || matches!(
            b,
            b'!' | b'#'
                | b'$'
                | b'%'
                | b'&'
                | b'\''
                | b'*'
                | b'+'
                | b'-'
                | b'.'
                | b'^'
                | b'_'
                | b'`'
                | b'|'
                | b'~'
        )
}

/// <https://mimesniff.spec.whatwg.org/#http-quoted-string-token-code-point>
/// HTAB, U+0020..=U+007E, or U+0080..=U+00FF. Note `"` and `\` are allowed;
/// the serializer re-escapes them.
#[inline]
fn is_http_quoted_string_token(b: u8) -> bool {
    matches!(b, b'\t' | 0x20..=0x7E | 0x80..=0xFF)
}

fn trim_start(mut s: &[u8], pred: fn(u8) -> bool) -> &[u8] {
    while let [first, rest @ ..] = s {
        if pred(*first) {
            s = rest;
        } else {
            break;
        }
    }
    s
}

fn trim_end(mut s: &[u8], pred: fn(u8) -> bool) -> &[u8] {
    while let [rest @ .., last] = s {
        if pred(*last) {
            s = rest;
        } else {
            break;
        }
    }
    s
}

fn trim(s: &[u8], pred: fn(u8) -> bool) -> &[u8] {
    trim_end(trim_start(s, pred), pred)
}

/// <https://mimesniff.spec.whatwg.org/#mime-type> — the parsed record.
struct MimeRecord {
    /// `type "/" subtype`, ASCII-lowercased.
    essence: Vec<u8>,
    /// Parameters in first-seen order; names ASCII-lowercased and unique.
    parameters: Vec<(Vec<u8>, Vec<u8>)>,
}

impl MimeRecord {
    fn has_parameter(&self, name: &[u8]) -> bool {
        self.parameters.iter().any(|(n, _)| n == name)
    }

    fn parameter(&self, name: &[u8]) -> Option<&[u8]> {
        self.parameters
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| &v[..])
    }

    /// <https://mimesniff.spec.whatwg.org/#serialize-a-mime-type>
    fn serialize(&self) -> Vec<u8> {
        let mut out = self.essence.clone();
        for (name, value) in &self.parameters {
            out.push(b';');
            out.extend_from_slice(name);
            out.push(b'=');
            if value.is_empty() || !value.iter().copied().all(is_http_token) {
                out.push(b'"');
                for &b in value {
                    if b == b'"' || b == b'\\' {
                        out.push(b'\\');
                    }
                    out.push(b);
                }
                out.push(b'"');
            } else {
                out.extend_from_slice(value);
            }
        }
        out
    }
}

/// <https://fetch.spec.whatwg.org/#collect-an-http-quoted-string>
///
/// `input[*pos]` must be `"`. Advances `*pos` past the quoted string. With
/// `extract_value` the unescaped contents are returned; without it, the raw
/// source span including the quotes.
fn collect_http_quoted_string(input: &[u8], pos: &mut usize, extract_value: bool) -> Vec<u8> {
    let start = *pos;
    let mut value = Vec::new();
    debug_assert_eq!(input[*pos], b'"');
    *pos += 1;
    loop {
        let chunk_start = *pos;
        while *pos < input.len() && input[*pos] != b'"' && input[*pos] != b'\\' {
            *pos += 1;
        }
        value.extend_from_slice(&input[chunk_start..*pos]);
        if *pos >= input.len() {
            break;
        }
        let quote_or_backslash = input[*pos];
        *pos += 1;
        if quote_or_backslash == b'\\' {
            if *pos >= input.len() {
                value.push(b'\\');
                break;
            }
            value.push(input[*pos]);
            *pos += 1;
        } else {
            break;
        }
    }
    if extract_value {
        value
    } else {
        input[start..*pos].to_vec()
    }
}

/// <https://fetch.spec.whatwg.org/#header-value-get-decode-and-split>
///
/// Splits a comma-combined header value into its individual values, leaving
/// commas inside quoted strings alone and trimming HTTP tab-or-space from each.
fn get_decode_split(input: &[u8]) -> Vec<&[u8]> {
    let mut values = Vec::new();
    let mut pos = 0usize;
    let mut start = 0usize;
    while pos < input.len() {
        while pos < input.len() && input[pos] != b'"' && input[pos] != b',' {
            pos += 1;
        }
        if pos < input.len() {
            if input[pos] == b'"' {
                collect_http_quoted_string(input, &mut pos, false);
                if pos < input.len() {
                    continue;
                }
            } else {
                values.push(trim(&input[start..pos], is_http_tab_or_space));
                pos += 1;
                start = pos;
                continue;
            }
        }
        values.push(trim(&input[start..pos], is_http_tab_or_space));
        start = pos;
    }
    values
}

/// <https://mimesniff.spec.whatwg.org/#parse-a-mime-type>
fn parse_mime_type(input: &[u8]) -> Option<MimeRecord> {
    // Step 1: remove leading and trailing HTTP whitespace.
    let input = trim(input, is_http_whitespace);

    // Steps 3-6: `type` is everything before the first `/`, which must exist
    // (step 5), be non-empty, and solely contain HTTP token code points.
    let slash = input.iter().position(|&b| b == b'/')?;
    let type_ = &input[..slash];
    if type_.is_empty() || !type_.iter().copied().all(is_http_token) {
        return None;
    }
    let mut pos = slash + 1;

    // Steps 7-9: `subtype` runs to the first `;`, with trailing HTTP
    // whitespace removed.
    let subtype_end = input[pos..]
        .iter()
        .position(|&b| b == b';')
        .map_or(input.len(), |i| pos + i);
    let subtype = trim_end(&input[pos..subtype_end], is_http_whitespace);
    if subtype.is_empty() || !subtype.iter().copied().all(is_http_token) {
        return None;
    }
    pos = subtype_end;

    // Step 10.
    let mut essence = Vec::with_capacity(type_.len() + 1 + subtype.len());
    essence.extend_from_slice(type_);
    essence.push(b'/');
    essence.extend_from_slice(subtype);
    essence.make_ascii_lowercase();
    let mut record = MimeRecord {
        essence,
        parameters: Vec::new(),
    };

    // Step 11: parameters.
    while pos < input.len() {
        // 11.1: advance past `;`. 11.2: skip HTTP whitespace.
        pos += 1;
        while pos < input.len() && is_http_whitespace(input[pos]) {
            pos += 1;
        }
        // 11.3-11.4: parameter name runs to `;` or `=`, ASCII-lowercased.
        let name_start = pos;
        while pos < input.len() && input[pos] != b';' && input[pos] != b'=' {
            pos += 1;
        }
        let mut name = input[name_start..pos].to_vec();
        name.make_ascii_lowercase();
        // 11.5
        if pos < input.len() {
            if input[pos] == b';' {
                continue;
            }
            pos += 1;
        }
        // 11.6
        if pos >= input.len() {
            break;
        }
        // 11.7-11.9
        let value: Vec<u8> = if input[pos] == b'"' {
            let v = collect_http_quoted_string(input, &mut pos, true);
            while pos < input.len() && input[pos] != b';' {
                pos += 1;
            }
            v
        } else {
            let value_start = pos;
            while pos < input.len() && input[pos] != b';' {
                pos += 1;
            }
            let v = trim_end(&input[value_start..pos], is_http_whitespace);
            if v.is_empty() {
                continue;
            }
            v.to_vec()
        };
        // 11.10: first occurrence of a valid name/value pair wins.
        if !name.is_empty()
            && name.iter().copied().all(is_http_token)
            && value.iter().copied().all(is_http_quoted_string_token)
            && !record.has_parameter(&name)
        {
            record.parameters.push((name, value));
        }
    }

    Some(record)
}

/// Fetch's "extract a MIME type" applied to the comma-combined `Content-Type`
/// header value, serialized per "serialize a MIME type".
///
/// `None` means extraction failed (no valid MIME type among the values), which
/// callers surface as an empty `type`.
/// <https://fetch.spec.whatwg.org/#concept-header-extract-mime-type>
pub fn extract_mime_type(combined_value: &[u8]) -> Option<Vec<u8>> {
    let mut charset: Option<Vec<u8>> = None;
    let mut essence: Option<Vec<u8>> = None;
    let mut mime: Option<MimeRecord> = None;

    for value in get_decode_split(combined_value) {
        // 6.1-6.2
        let Some(mut parsed) = parse_mime_type(value) else {
            continue;
        };
        if parsed.essence == b"*/*" {
            continue;
        }
        if essence.as_deref() != Some(&parsed.essence[..]) {
            // 6.4: a new essence resets the carried charset.
            charset = parsed.parameter(b"charset").map(<[u8]>::to_vec);
            essence = Some(parsed.essence.clone());
        } else if !parsed.has_parameter(b"charset") {
            // 6.5: same essence without a charset inherits the carried one.
            if let Some(charset) = &charset {
                parsed
                    .parameters
                    .push((b"charset".to_vec(), charset.clone()));
            }
        }
        mime = Some(parsed);
    }

    Some(mime?.serialize())
}
