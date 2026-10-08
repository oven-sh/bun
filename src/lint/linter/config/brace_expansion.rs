//! The `brace-expansion` package, which `minimatch` expands `a{b,c}d` and `{1..3}` with.

use bun_core::strings;

const MAX: usize = 100_000;
const MAX_LENGTH: usize = 4_000_000;
const MAX_DEPTH: usize = 1_000;
const MAX_REWRITES: usize = 1_000;

// What an escaped character is replaced by while braces are expanded. None of these bytes occurs
// in UTF-8.
const ESC_SLASH: u8 = 0xF8;
const ESC_OPEN: u8 = 0xF9;
const ESC_CLOSE: u8 = 0xFA;
const ESC_COMMA: u8 = 0xFB;
const ESC_PERIOD: u8 = 0xFC;

fn escape_braces(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let escaped = match text[at..] {
            [b'\\', b'\\', ..] => Some(ESC_SLASH),
            [b'\\', b'{', ..] => Some(ESC_OPEN),
            [b'\\', b'}', ..] => Some(ESC_CLOSE),
            [b'\\', b',', ..] => Some(ESC_COMMA),
            [b'\\', b'.', ..] => Some(ESC_PERIOD),
            _ => None,
        };
        out.push(escaped.unwrap_or(text[at]));
        at += if escaped.is_some() { 2 } else { 1 };
    }
    out
}

fn unescape_braces(mut text: Vec<u8>) -> Vec<u8> {
    for byte in &mut text {
        *byte = match *byte {
            ESC_SLASH => b'\\',
            ESC_OPEN => b'{',
            ESC_CLOSE => b'}',
            ESC_COMMA => b',',
            ESC_PERIOD => b'.',
            byte => byte,
        };
    }
    text
}

struct Balanced<'t> {
    pre: &'t [u8],
    body: &'t [u8],
    post: &'t [u8],
}

/// `balanced("{", "}", text)` of the `balanced-match` package: the first pair of braces that
/// match each other.
fn balanced(text: &[u8]) -> Option<Balanced<'_>> {
    let find = |byte: u8, from: usize| text.get(from..).and_then(|rest| strings::index_of_char_usize(rest, byte)).map(|i| from + i);
    let mut open = Some(find(b'{', 0)?);
    let mut close = find(b'}', open? + 1);
    close?;
    let mut at = open;
    let mut opened: Vec<usize> = Vec::new();
    let (mut left, mut right) = (text.len(), None);
    let mut result = None;
    while let Some(i) = at
        && result.is_none()
    {
        if Some(i) == open {
            opened.push(i);
            open = find(b'{', i + 1);
        } else if opened.len() == 1 {
            result = opened.pop().zip(close);
        } else {
            if let Some(start) = opened.pop()
                && start < left
            {
                left = start;
                right = close;
            }
            close = find(b'}', i + 1);
        }
        at = match (open, close) {
            (Some(open), Some(close)) if open < close => Some(open),
            _ => close,
        };
    }
    if !opened.is_empty()
        && let Some(right) = right
    {
        result = Some((left, right));
    }
    let (start, end) = result?;
    Some(Balanced {
        pre: &text[..start],
        body: &text[start + 1..end],
        post: &text[end + 1..],
    })
}

/// `text.split(",")`, but a braced section is not split.
fn parse_comma_parts(mut text: &[u8]) -> Vec<Vec<u8>> {
    let mut parts: Vec<Vec<u8>> = Vec::new();
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let found = balanced(text);
        let mut split: Vec<Vec<u8>> = strings::split(found.as_ref().map_or(text, |m| m.pre), b",").map(<[u8]>::to_vec).collect();
        if let Some(first) = split.first_mut() {
            first.splice(0..0, std::mem::take(&mut carry));
        }
        let Some(m) = found else {
            parts.append(&mut split);
            return parts;
        };
        if let Some(last) = split.last_mut() {
            last.push(b'{');
            last.extend_from_slice(m.body);
            last.push(b'}');
        }
        if m.post.is_empty() {
            parts.append(&mut split);
            return parts;
        }
        carry = split.pop().unwrap_or_default();
        parts.append(&mut split);
        text = m.post;
    }
}

/// `-?\d+`
fn integer_len(text: &[u8]) -> Option<usize> {
    let sign = usize::from(text.first() == Some(&b'-'));
    let digits = text[sign..].iter().take_while(|b| b.is_ascii_digit()).count();
    (digits > 0).then_some(sign + digits)
}

/// The two or three parts of `a..b` or `a..b..c`, if the first two are what `first` accepts and
/// the third is an integer.
fn sequence_parts(body: &[u8], first: fn(&[u8]) -> Option<usize>) -> Option<Vec<&[u8]>> {
    let mut parts = Vec::with_capacity(3);
    let mut rest = body;
    for i in 0..3 {
        let len = if i < 2 { first(rest)? } else { integer_len(rest)? };
        parts.push(&rest[..len]);
        rest = &rest[len..];
        if rest.is_empty() && i >= 1 {
            return Some(parts);
        }
        rest = rest.strip_prefix(b"..")?;
    }
    None
}

fn parse_integer(text: &[u8]) -> i64 {
    let (is_negative, digits) = match text {
        [b'-', digits @ ..] => (true, digits),
        digits => (false, digits),
    };
    let value = digits.iter().fold(0i64, |n, b| n.saturating_mul(10).saturating_add(i64::from(b - b'0')));
    if is_negative { -value } else { value }
}

fn expand_sequence(parts: &[&[u8]], is_alpha: bool) -> Vec<Vec<u8>> {
    let numeric = |text: &[u8]| if is_alpha && !text[0].is_ascii_digit() && text[0] != b'-' { i64::from(text[0]) } else { parse_integer(text) };
    let (x, y) = (numeric(parts[0]), numeric(parts[1]));
    let width = parts[0].len().max(parts[1].len());
    let mut step = parts.get(2).map_or(1, |it| parse_integer(it).saturating_abs().max(1));
    let is_reversed = y < x;
    if is_reversed {
        step = -step;
    }
    // `^-?0\d`
    let is_padded = |it: &&[u8]| matches!(it.strip_prefix(b"-").unwrap_or(*it), [b'0', b'0'..=b'9', ..]);
    let pad = parts.iter().any(|it| is_padded(it));
    let (mut out, mut length, mut i) = (Vec::new(), 0, x);
    while (if is_reversed { i >= y } else { i <= y }) && out.len() < MAX {
        let item = if is_alpha {
            match u8::try_from(i) {
                Ok(b'\\') | Err(_) => Vec::new(),
                Ok(byte) => vec![byte],
            }
        } else {
            let mut written = i.to_string().into_bytes();
            if pad && width > written.len() {
                let at = usize::from(i < 0);
                written.splice(at..at, std::iter::repeat_n(b'0', width - written.len()));
            }
            written
        };
        if length + item.len() > MAX_LENGTH {
            break;
        }
        length += item.len();
        out.push(item);
        let Some(next) = i.checked_add(step) else {
            break;
        };
        i = next;
    }
    out
}

/// Every `acc[a] + pre + values[v]`.
fn combine(acc: &[Vec<u8>], pre: &[u8], values: &[Vec<u8>], drop_empties: bool) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut length = 0;
    for a in acc {
        for value in values {
            if out.len() >= MAX {
                return out;
            }
            let expansion = [&a[..], pre, &value[..]].concat();
            if drop_empties && expansion.is_empty() {
                continue;
            }
            if length + expansion.len() > MAX_LENGTH {
                return out;
            }
            length += expansion.len();
            out.push(expansion);
        }
    }
    out
}

fn is_line_terminator(text: &[u8]) -> bool {
    matches!(text, [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..])
}

/// `/,(?!,).*\}/.test(text)`
fn has_comma_before_close(text: &[u8]) -> bool {
    let mut from = 0;
    while let Some(comma) = strings::index_of_char_usize(&text[from..], b',').map(|i| from + i) {
        from = comma + 1;
        if text.get(from) == Some(&b',') {
            continue;
        }
        let mut at = from;
        while at < text.len() && !is_line_terminator(&text[at..]) {
            if text[at] == b'}' {
                return true;
            }
            at += 1;
        }
    }
    false
}

fn expand_inner(text: &[u8], depth: usize, mut is_top: bool) -> Vec<Vec<u8>> {
    if depth > MAX_DEPTH {
        return vec![text.to_vec()];
    }
    let none = [Vec::new()];
    let mut owned: Vec<u8>;
    let mut text = text;
    let mut acc = vec![Vec::new()];
    let (mut rewrites, mut drop_empties, mut is_first_group) = (0, false, true);
    loop {
        let Some(m) = balanced(text) else {
            return combine(&acc, text, &none, drop_empties);
        };
        let braced = |body: &[u8]| [m.pre, b"{", body, b"}"].concat();
        if m.pre.ends_with(b"$") {
            acc = combine(&acc, &braced(m.body), &none, drop_empties && m.post.is_empty());
            is_first_group = false;
            if m.post.is_empty() {
                break;
            }
            text = m.post;
            continue;
        }
        let numbers = sequence_parts(m.body, integer_len);
        let letters = sequence_parts(m.body, |it| it.first().is_some_and(u8::is_ascii_alphabetic).then_some(1));
        let is_sequence = numbers.is_some() || letters.is_some();
        if !is_sequence && !strings::contains_char(m.body, b',') {
            // `{a},b}`
            if rewrites < MAX_REWRITES && has_comma_before_close(m.post) {
                rewrites += 1;
                owned = [m.pre, b"{", m.body, &[ESC_CLOSE], m.post].concat();
                text = &owned;
                is_top = true;
                continue;
            }
            return combine(&acc, &[&braced(m.body)[..], m.post].concat(), &none, drop_empties);
        }
        if is_first_group {
            drop_empties = is_top && !is_sequence;
            is_first_group = false;
        }
        let values = if let Some(parts) = numbers.as_ref().or(letters.as_ref()) {
            expand_sequence(parts, numbers.is_none())
        } else {
            let mut parts = parse_comma_parts(m.body);
            if let [only] = &parts[..] {
                // `x{{a,b}}y` is `x{a}y x{b}y`.
                parts = expand_inner(only, depth + 1, false);
                for part in &mut parts {
                    part.insert(0, b'{');
                    part.push(b'}');
                }
                if let [only] = &parts[..] {
                    acc = combine(&acc, &[m.pre, &only[..]].concat(), &none, drop_empties && m.post.is_empty());
                    if m.post.is_empty() {
                        break;
                    }
                    text = m.post;
                    continue;
                }
            }
            let drops_empties = drop_empties && m.post.is_empty() && m.pre.is_empty() && acc.iter().all(Vec::is_empty);
            let (mut values, mut length) = (Vec::new(), 0);
            'parts: for part in &parts {
                for value in expand_inner(part, depth + 1, false) {
                    if drops_empties && value.is_empty() {
                        continue;
                    }
                    if values.len() >= MAX || length + value.len() > MAX_LENGTH {
                        break 'parts;
                    }
                    length += value.len();
                    values.push(value);
                }
            }
            values
        };
        acc = combine(&acc, m.pre, &values, drop_empties && m.post.is_empty());
        if m.post.is_empty() {
            break;
        }
        text = m.post;
    }
    acc
}

/// `expand(text)`
pub(super) fn expand(text: &[u8]) -> Vec<Vec<u8>> {
    if text.is_empty() {
        return Vec::new();
    }
    let escaped = match text.strip_prefix(b"{}") {
        Some(rest) => escape_braces(&[b"\\{\\}", rest].concat()),
        None => escape_braces(text),
    };
    expand_inner(&escaped, 0, true).into_iter().map(unescape_braces).collect()
}
