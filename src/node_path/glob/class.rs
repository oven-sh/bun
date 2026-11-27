//! `parseClass`, for a pattern without backslashes: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L320-L426>

use bun_core::strings;
use bun_paths::PathChar;

use super::append_ascii;
use super::ast::append_regexp_escaped;
use super::budget::{Abort, Budget, cost};
use crate::{BACKSLASH, CodeUnit, byte_at};

const POSIX_CLASSES: [(&[u8], &[u8]); 14] = [
    (b"[:alnum:]", br"\p{L}\p{Nl}\p{Nd}"),
    (b"[:alpha:]", br"\p{L}\p{Nl}"),
    (b"[:ascii:]", br"\x00-\x7f"),
    (b"[:blank:]", br"\p{Zs}\t"),
    (b"[:cntrl:]", br"\p{Cc}"),
    (b"[:digit:]", br"\p{Nd}"),
    (NEGATED_POSIX_CLASS, br"\p{Z}\p{C}"),
    (b"[:lower:]", br"\p{Ll}"),
    (b"[:print:]", br"\p{C}"),
    (b"[:punct:]", br"\p{P}"),
    (b"[:space:]", br"\p{Z}\t\r\n\v\f"),
    (b"[:upper:]", br"\p{Lu}"),
    (b"[:word:]", br"\p{L}\p{Nl}\p{Nd}\p{Pc}"),
    (b"[:xdigit:]", b"A-Fa-f0-9"),
];
const NEGATED_POSIX_CLASS: &[u8] = b"[:graph:]";

pub(super) struct ParsedClass {
    pub(super) consumed: usize,
    pub(super) has_magic: bool,
    pub(super) needs_unicode: bool,
}

fn append_brace_escaped(ranges: &mut Vec<u16>, unit: u16) {
    if matches!(unit.to_u8_saturating(), b'[' | b']' | b'-') {
        ranges.push(BACKSLASH.into());
    }
    ranges.push(unit);
}

fn append_class(source: &mut Vec<u16>, negate: bool, ranges: &[u16]) {
    append_ascii(source, if negate { b"[^" } else { b"[" });
    source.extend_from_slice(ranges);
    append_ascii(source, b"]");
}

/// If `glob` starts with a class, appends its RegExp source to `source`.
pub(super) fn parse_class(
    glob: &[u16],
    source: &mut Vec<u16>,
    budget: &mut Budget<'_>,
) -> Result<Option<ParsedClass>, Abort> {
    if byte_at(glob, 0) != b'[' {
        return Ok(None);
    }
    let matches_nothing = |source: &mut Vec<u16>| {
        append_ascii(source, b"$.");
        Ok(Some(ParsedClass {
            consumed: glob.len(),
            has_magic: true,
            needs_unicode: false,
        }))
    };
    let (mut ranges, mut negs) = (Vec::new(), Vec::new());
    let negate = matches!(byte_at(glob, 1), b'!' | b'^');
    let first = 1 + usize::from(negate);
    let (mut at, mut needs_unicode, mut range_start) = (first, false, None);
    loop {
        let Some(&unit) = glob.get(at) else {
            budget.spend(cost::STEP * glob.len())?;
            return Ok(None);
        };
        if unit.eq_ascii(b']') && at != first {
            break;
        }
        let is_next = |ascii| strings::has_prefix_comptime_utf16(&glob[at..], ascii);
        let find_posix_class = || POSIX_CLASSES.iter().find(|class| is_next(class.0));
        if let Some(&(name, class_source)) = is_next(b"[:").then(find_posix_class).flatten() {
            if range_start.is_some() {
                return matches_nothing(source);
            }
            let list = if name == NEGATED_POSIX_CLASS {
                &mut negs
            } else {
                &mut ranges
            };
            append_ascii(list, class_source);
            needs_unicode |= class_source.starts_with(br"\p");
            at += name.len();
        } else if let Some(start) = range_start.take() {
            if unit > start {
                append_brace_escaped(&mut ranges, start);
                append_ascii(&mut ranges, b"-");
            }
            if unit >= start {
                append_brace_escaped(&mut ranges, unit);
            }
            at += 1;
        } else if byte_at(glob, at + 1) != b'-' {
            append_brace_escaped(&mut ranges, unit);
            at += 1;
        } else if byte_at(glob, at + 2) == b']' {
            append_brace_escaped(&mut ranges, unit);
            append_brace_escaped(&mut ranges, b'-'.into());
            at += 2;
        } else {
            range_start = Some(unit);
            at += 2;
        }
    }
    // `/^\\?.$/`
    let single = match ranges[..] {
        [unit] if !strings::is_js_line_terminator(unit.into()) => Some(unit),
        [escape, unit] if escape.eq_ascii(BACKSLASH) => Some(unit),
        _ => None,
    };
    let mut has_magic = true;
    match (single, ranges.is_empty(), negs.is_empty()) {
        (_, true, true) => return matches_nothing(source),
        (Some(unit), _, true) if !negate => {
            append_regexp_escaped(source, unit);
            has_magic = false;
        }
        (_, false, true) => append_class(source, negate, &ranges),
        (_, true, false) => append_class(source, !negate, &negs),
        (_, false, false) => {
            append_ascii(source, b"(");
            append_class(source, negate, &ranges);
            append_ascii(source, b"|");
            append_class(source, !negate, &negs);
            append_ascii(source, b")");
        }
    }
    Ok(Some(ParsedClass {
        consumed: at + 1,
        has_magic,
        needs_unicode,
    }))
}
