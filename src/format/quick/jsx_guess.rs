//! Prettier's isProbablyJsx(), /^[^"'`]*<\/|^[^/]{2}.*\/>/m, on the bytes of the source.
//! Both alternatives need a "/", so this goes from "/" to "/", and only at "</" and "/>" does it ask about the line, of which it reads each byte once.

use bun_core::strings;

fn at(text: &[u8], p: usize) -> u8 {
    text.get(p).copied().unwrap_or(0)
}

/// The length of the line terminator that ends right before p, or 0.
fn terminator_before(text: &[u8], p: usize) -> usize {
    match text.get(..p) {
        Some([.., b'\n' | b'\r']) => 1,
        Some([.., 0xe2, 0x80, 0xa8 | 0xa9]) => 3,
        _ => 0,
    }
}

fn is_line_start(text: &[u8], p: usize) -> bool {
    p == 0 || terminator_before(text, p) != 0
}

/// ^[^/]{2}.*\/> with the "/>" at q, in the line that starts at s
fn closes_tag_at(text: &[u8], q: usize, s: usize) -> bool {
    // both characters in the line of the "/>"
    if s < q && at(text, s) != b'/' {
        let second = s + match at(text, s) {
            0..0x80 => 1,
            0x80..0xe0 => 2,
            0xe0..0xf0 => 3,
            // two units of UTF-16
            0xf0.. => return true,
        };
        if second < q && at(text, second) != b'/' {
            return true;
        }
    }
    let length = terminator_before(text, s);
    if length == 0 {
        return false;
    }
    let p1 = s - length;
    // the end of an empty line and the first character of this one
    if is_line_start(text, p1) && s < q && at(text, s) != b'/' {
        return true;
    }
    // a line of one character, or another empty line, and the end of that line
    if p1 == 0 {
        return false;
    }
    let before = terminator_before(text, p1);
    if before != 0 {
        return is_line_start(text, p1 - before);
    }
    let mut p2 = p1 - 1;
    while p2 > 0 && p2 + 3 > p1 && (at(text, p2) & 0xc0) == 0x80 {
        p2 -= 1;
    }
    at(text, p2) != b'/' && at(text, p2) < 0xf0 && is_line_start(text, p2)
}

/// TypeScript in a text without a name that says so: is JSX tried first?
pub fn is_probably_jsx(text: &[u8]) -> bool {
    // What has been read ends at `read`, in the line that starts at `line`; is there a quote between the two?
    let mut read = 0;
    let mut line = 0;
    let mut has_quote = false;
    let mut from = 0;
    while let Some(found) = text
        .get(from..)
        .and_then(|rest| strings::index_of_char_usize(rest, b'/'))
    {
        let p = from + found;
        from = p + 1;
        let opens = p > 0 && at(text, p - 1) == b'<';
        let closes = at(text, p + 1) == b'>';
        if !opens && !closes {
            continue;
        }
        let mut is_open_at_start = false;
        while read < p {
            // ^[^"'`]*<\/ : no quote between the start of the line and the "<"
            is_open_at_start = !has_quote;
            let c = at(text, read);
            read += 1;
            if matches!(c, b'"' | b'\'' | b'`') {
                has_quote = true;
            } else if matches!(c, b'\n' | b'\r' | 0xa8 | 0xa9) && terminator_before(text, read) != 0
            {
                line = read;
                has_quote = false;
            }
        }
        if (opens && is_open_at_start) || (closes && closes_tag_at(text, p, line)) {
            return true;
        }
    }
    false
}
