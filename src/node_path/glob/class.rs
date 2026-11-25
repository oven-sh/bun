//! `parseClass` of minimatch, for a pattern that has no backslash.

use super::ast::{append_ascii, append_escaped};
use super::{Stop, Work, is_line_terminator};
use crate::{BACKSLASH, Unit, byte_at};

/// The name, the source, and whether that needs the flag `u`.
const NAMED: [(&[u8], &[u8], bool); 14] = [
    (b"[:alnum:]", br"\p{L}\p{Nl}\p{Nd}", true),
    (b"[:alpha:]", br"\p{L}\p{Nl}", true),
    (b"[:ascii:]", br"\x00-\x7f", false),
    (b"[:blank:]", br"\p{Zs}\t", true),
    (b"[:cntrl:]", br"\p{Cc}", true),
    (b"[:digit:]", br"\p{Nd}", true),
    (GRAPH, br"\p{Z}\p{C}", true),
    (b"[:lower:]", br"\p{Ll}", true),
    (b"[:print:]", br"\p{C}", true),
    (b"[:punct:]", br"\p{P}", true),
    (b"[:space:]", br"\p{Z}\t\r\n\v\f", true),
    (b"[:upper:]", br"\p{Lu}", true),
    (b"[:word:]", br"\p{L}\p{Nl}\p{Nd}\p{Pc}", true),
    (b"[:xdigit:]", b"A-Fa-f0-9", false),
];
/// Its source is what it excludes.
const GRAPH: &[u8] = b"[:graph:]";

pub(super) struct Class {
    /// How much of the glob it takes.
    pub(super) length: usize,
    pub(super) has_magic: bool,
    pub(super) is_unicode: bool,
}

fn append_member(members: &mut Vec<u16>, unit: u16) {
    if matches!(unit.byte(), b'[' | b']' | b'-') {
        members.push(BACKSLASH.into());
    }
    members.push(unit);
}

fn append_class(source: &mut Vec<u16>, is_negated: bool, members: &[u16]) {
    append_ascii(source, if is_negated { b"[^" } else { b"[" });
    source.extend_from_slice(members);
    append_ascii(source, b"]");
}

/// Appends the class that `glob` starts with, if it does, to `source`.
pub(super) fn parse(
    glob: &[u16],
    source: &mut Vec<u16>,
    work: &mut Work<'_>,
) -> Result<Option<Class>, Stop> {
    if byte_at(glob, 0) != b'[' {
        return Ok(None);
    }
    let matches_nothing = |source: &mut Vec<u16>| {
        append_ascii(source, b"$.");
        Ok(Some(Class {
            length: glob.len(),
            has_magic: true,
            is_unicode: false,
        }))
    };
    let (mut members, mut excluded) = (Vec::new(), Vec::new());
    let is_negated = matches!(byte_at(glob, 1), b'!' | b'^');
    let first = 1 + usize::from(is_negated);
    let (mut at, mut is_unicode, mut range_start) = (first, false, None);
    loop {
        let Some(&unit) = glob.get(at) else {
            work.spend(4 * glob.len())?;
            return Ok(None);
        };
        if unit.is(b']') && at != first {
            break;
        }
        let is_here = |name: &[u8]| (0..name.len()).all(|it| byte_at(glob, at + it) == name[it]);
        let named = if is_here(b"[:") { &NAMED[..] } else { &[] };
        if let Some(&(name, of_name, needs_flag)) = named.iter().find(|it| is_here(it.0)) {
            if range_start.is_some() {
                return matches_nothing(source);
            }
            let into = if name == GRAPH {
                &mut excluded
            } else {
                &mut members
            };
            append_ascii(into, of_name);
            is_unicode |= needs_flag;
            at += name.len();
        } else if let Some(start) = range_start.take() {
            if unit > start {
                append_member(&mut members, start);
                append_ascii(&mut members, b"-");
            }
            if unit >= start {
                append_member(&mut members, unit);
            }
            at += 1;
        } else if byte_at(glob, at + 1) != b'-' {
            append_member(&mut members, unit);
            at += 1;
        } else if byte_at(glob, at + 2) == b']' {
            append_member(&mut members, unit);
            append_member(&mut members, b'-'.into());
            at += 2;
        } else {
            range_start = Some(unit);
            at += 2;
        }
    }
    let only_member = match members[..] {
        [unit] if !is_line_terminator(unit) => Some(unit),
        [escape, unit] if escape.is(BACKSLASH) => Some(unit),
        _ => None,
    };
    let mut has_magic = true;
    match (only_member, members.is_empty(), excluded.is_empty()) {
        (_, true, true) => return matches_nothing(source),
        (Some(unit), _, true) if !is_negated => {
            append_escaped(source, unit);
            has_magic = false;
        }
        (_, false, true) => append_class(source, is_negated, &members),
        (_, true, false) => append_class(source, !is_negated, &excluded),
        (_, false, false) => {
            append_ascii(source, b"(");
            append_class(source, is_negated, &members);
            append_ascii(source, b"|");
            append_class(source, !is_negated, &excluded);
            append_ascii(source, b")");
        }
    }
    Ok(Some(Class {
        length: at + 1,
        has_magic,
        is_unicode,
    }))
}
