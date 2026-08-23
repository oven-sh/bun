// Shared byte → HTML/XML entity lookup.
//
// `Bun.escapeHTML` is implemented in C++ (src/jsc/bindings/escapeHTML.cpp).
// These helpers remain for the markdown renderer (`src/md/html_renderer.rs`),
// SSR attribute escaping (`src/bun_core/string/MutableString.rs`) and the
// `bun test` JUnit XML reporter (`src/runtime/cli/test_command.rs`), which
// escape byte-by-byte and only need the per-byte entity mapping.

/// HTML entity for one byte. `'` → `&#x27;` (numeric — `&apos;` is not in HTML4).
#[inline(always)]
pub const fn html_escape_entity(c: u8) -> Option<&'static [u8]> {
    match c {
        b'&' => Some(b"&amp;"),
        b'<' => Some(b"&lt;"),
        b'>' => Some(b"&gt;"),
        b'"' => Some(b"&quot;"),
        b'\'' => Some(b"&#x27;"),
        _ => None,
    }
}

/// XML entity for one byte. Differs from [`html_escape_entity`] only in `'` → `&apos;`.
#[inline(always)]
pub const fn xml_escape_entity(c: u8) -> Option<&'static [u8]> {
    match c {
        b'\'' => Some(b"&apos;"),
        _ => html_escape_entity(c),
    }
}

/// Write `input` XML-escaped, safe for element content and attribute values.
///
/// Tab/LF/CR are emitted as numeric character references so the literal byte
/// survives attribute-value normalisation (XML 1.0 §3.3.3). Any other C0
/// control character is not a valid XML 1.0 Char and cannot be represented
/// even as a numeric reference, so it is dropped.
pub fn write_xml_escaped(
    input: &[u8],
    writer: &mut impl crate::io::Write,
) -> crate::CrateResult<()> {
    let mut last: usize = 0;
    let mut i: usize = 0;
    let len = input.len();
    while i < len {
        let c = input[i];
        match c {
            b'&' | b'<' | b'>' | b'"' | b'\'' => {
                if i > last {
                    writer.write_all(&input[last..i])?;
                }
                writer.write_all(xml_escape_entity(c).unwrap())?;
                last = i + 1;
            }
            b'\t' | b'\n' | b'\r' => {
                if i > last {
                    writer.write_all(&input[last..i])?;
                }
                write!(writer, "&#{};", c)?;
                last = i + 1;
            }
            0..=0x1f => {
                if i > last {
                    writer.write_all(&input[last..i])?;
                }
                last = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    if len > last {
        writer.write_all(&input[last..])?;
    }
    Ok(())
}
