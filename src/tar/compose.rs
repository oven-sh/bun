//! What Windows does to a UTF-8 name. Not NFC: nothing is decomposed, and the data is Unicode 6.0.

mod tables;

use crate::error::Result;
use tables::{COMBINING_CLASSES, COMPOSING_BLOCKS, COMPOSITIONS};

/// More combining marks than this on one character make the name count as unconvertible.
// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_string.c#L2903
const MAX_MARKS: usize = 10;

mod hangul {
    pub(super) const S_BASE: u32 = 0xAC00;
    pub(super) const L_BASE: u32 = 0x1100;
    pub(super) const V_BASE: u32 = 0x1161;
    pub(super) const T_BASE: u32 = 0x11A7;
    pub(super) const L_COUNT: u32 = 19;
    pub(super) const V_COUNT: u32 = 21;
    pub(super) const T_COUNT: u32 = 28;
    pub(super) const S_COUNT: u32 = L_COUNT * V_COUNT * T_COUNT;
}

fn compose_pair(first: u32, second: u32) -> Option<u32> {
    let index = COMPOSITIONS
        .binary_search_by_key(&(first, second), |&(a, b, _)| (a, b))
        .ok()?;
    COMPOSITIONS.get(index).map(|&(_, _, composed)| composed)
}

fn in_ranges<T>(ranges: &[T], value: u32, bounds: impl Fn(&T) -> (u32, u32)) -> Option<&T> {
    let index = ranges.partition_point(|range| bounds(range).1 < value);
    ranges.get(index).filter(|range| bounds(range).0 <= value)
}

fn combining_class(c: u32) -> u8 {
    in_ranges(&COMBINING_CLASSES, c, |&(first, last, _)| (first, last))
        .map_or(0, |&(_, _, class)| class)
}

fn may_compose(c: u32) -> bool {
    in_ranges(&COMPOSING_BLOCKS, c >> 8, |&range| range).is_some()
}

/// UTF-8, or CESU-8 for a surrogate pair. `None` for anything else.
fn decode(bytes: &[u8]) -> Result<Option<Vec<u32>>> {
    let mut out = Vec::new();
    out.try_reserve(bytes.len())?;
    let mut rest = bytes;
    let continuation = |b: u8| (b & 0xc0 == 0x80).then_some(u32::from(b & 0x3f));
    let three = |a: u8, b: u8, c: u8| {
        let value = (u32::from(a & 0x0f) << 12) | (continuation(b)? << 6) | continuation(c)?;
        (value >= 0x800).then_some(value)
    };
    while let Some((&first, tail)) = rest.split_first() {
        let (value, tail) = match (first, tail) {
            (0..=0x7f, tail) => (u32::from(first), tail),
            (0xc2..=0xdf, &[b, ref tail @ ..]) => {
                let Some(b) = continuation(b) else {
                    return Ok(None);
                };
                ((u32::from(first & 0x1f) << 6) | b, tail)
            }
            (0xe0..=0xef, &[b, c, ref tail @ ..]) => match three(first, b, c) {
                Some(high @ 0xd800..=0xdbff) => {
                    let &[d @ 0xe0..=0xef, e, f, ref tail @ ..] = tail else {
                        return Ok(None);
                    };
                    let Some(low @ 0xdc00..=0xdfff) = three(d, e, f) else {
                        return Ok(None);
                    };
                    (0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00), tail)
                }
                Some(0xdc00..=0xdfff) | None => return Ok(None),
                Some(value) => (value, tail),
            },
            (0xf0..=0xf4, &[b, c, d, ref tail @ ..]) => {
                let (Some(b), Some(c), Some(d)) =
                    (continuation(b), continuation(c), continuation(d))
                else {
                    return Ok(None);
                };
                let value = (u32::from(first & 0x07) << 18) | (b << 12) | (c << 6) | d;
                if !(0x10000..=0x10ffff).contains(&value) {
                    return Ok(None);
                }
                (value, tail)
            }
            _ => return Ok(None),
        };
        out.push(value);
        rest = tail;
    }
    Ok(Some(out))
}

/// A run of combining marks behind one character, each of a higher class than the one before.
struct Marks {
    marks: [u32; MAX_MARKS],
    count: usize,
    last_class: u8,
    /// The class of the character that ended the run, unless the input did.
    stopper: Option<u8>,
}

impl Marks {
    /// Takes marks from `chars[*read..]` while their classes keep rising. `None` past [`MAX_MARKS`].
    fn collect(&mut self, chars: &[u32], read: &mut usize) -> Option<()> {
        loop {
            let slot = self.marks.get_mut(self.count)?;
            let Some(&c) = chars.get(*read) else {
                self.stopper = None;
                return Some(());
            };
            let class = combining_class(c);
            if self.last_class >= class && self.last_class != 228 && class != 228 {
                self.stopper = Some(class);
                return Some(());
            }
            *slot = c;
            *read = read.saturating_add(1);
            self.last_class = class;
            self.count = self.count.saturating_add(1);
        }
    }

    fn remove(&mut self, index: usize) {
        self.marks
            .copy_within(index.saturating_add(1)..self.count, index);
        self.count = self.count.saturating_sub(1);
    }

    fn as_slice(&self) -> &[u32] {
        self.marks.get(..self.count).unwrap_or_default()
    }
}

/// `None` past [`MAX_MARKS`]. `out` has room for all of `chars`.
fn compose_chars(chars: &[u32], out: &mut Vec<u32>) -> Option<()> {
    let mut read = 0usize;
    'starter: while let Some(&first) = chars.get(read) {
        let mut current = first;
        read = read.saturating_add(1);
        loop {
            let Some(&next) = chars.get(read) else {
                out.push(current);
                break 'starter;
            };
            read = read.saturating_add(1);

            if !may_compose(next) {
                out.push(current);
                current = next;
                continue;
            }
            let l_index = current.wrapping_sub(hangul::L_BASE);
            let s_index = current.wrapping_sub(hangul::S_BASE);
            if l_index < hangul::L_COUNT {
                let v_index = next.wrapping_sub(hangul::V_BASE);
                if v_index < hangul::V_COUNT {
                    current =
                        hangul::S_BASE + (l_index * hangul::V_COUNT + v_index) * hangul::T_COUNT;
                } else {
                    out.push(current);
                    current = next;
                }
                continue;
            }
            if s_index < hangul::S_COUNT && s_index % hangul::T_COUNT == 0 {
                let t_index = next.wrapping_sub(hangul::T_BASE);
                if 0 < t_index && t_index < hangul::T_COUNT {
                    current += t_index;
                } else {
                    out.push(current);
                    current = next;
                }
                continue;
            }
            if let Some(composed) = compose_pair(current, next) {
                current = composed;
                continue;
            }
            let class = combining_class(next);
            if class == 0 {
                out.push(current);
                current = next;
                continue;
            }

            // A mark behind `next` may still combine, unless one in between has its class or a higher one.
            let mut marks = Marks {
                marks: [next; MAX_MARKS],
                count: 1,
                last_class: class,
                stopper: None,
            };
            marks.collect(chars, &mut read)?;
            let mut i = 1usize;
            while let Some(&mark) = marks.as_slice().get(i) {
                let Some(composed) = compose_pair(current, mark) else {
                    i = i.saturating_add(1);
                    continue;
                };
                current = composed;
                marks.remove(i);
                // The mark that is gone may have been what kept the next one out.
                if marks.count > 0 && i == marks.count && marks.stopper == Some(marks.last_class) {
                    marks.last_class = marks
                        .as_slice()
                        .last()
                        .map_or(0, |&mark| combining_class(mark));
                    marks.collect(chars, &mut read)?;
                }
                i = 0;
            }

            out.push(current);
            out.extend_from_slice(marks.as_slice());
            if marks.stopper == Some(marks.last_class) {
                let mut last_class = marks.last_class;
                while let Some(&c) = chars.get(read) {
                    let class = combining_class(c);
                    if last_class > class {
                        break;
                    }
                    read = read.saturating_add(1);
                    last_class = class;
                    out.push(c);
                }
            }
            continue 'starter;
        }
    }
    Some(())
}

/// `None` if `name` does not convert: Windows then takes each byte for one UTF-16 unit.
pub fn compose(name: &[u8]) -> Result<Option<Vec<u32>>> {
    let Some(chars) = decode(name)? else {
        return Ok(None);
    };
    let mut out = Vec::new();
    out.try_reserve(chars.len())?;
    Ok(compose_chars(&chars, &mut out).map(|()| out))
}

/// Whether [`compose`] would return something.
pub fn converts(name: &[u8]) -> bool {
    name.is_ascii() || matches!(compose(name), Ok(Some(_)))
}

fn push_utf8(out: &mut Vec<u8>, c: u32) {
    let c = char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER);
    out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
}

/// The name an entry gets when it is written on Windows, or `None` if `name` does not convert.
pub(crate) fn windows_name(name: &[u8]) -> Result<Option<Vec<u8>>> {
    let mut out = Vec::new();
    out.try_reserve(name.len())?;
    if name.is_ascii() {
        out.extend_from_slice(name);
    } else {
        let Some(chars) = compose(name)? else {
            return Ok(None);
        };
        for c in chars {
            push_utf8(&mut out, c);
        }
    }
    for b in &mut out {
        if *b == b'\\' {
            *b = b'/';
        }
    }
    Ok(Some(out))
}

/// Appends `name` as Windows sees it. `is_utf8` is [`crate::Entry::path_is_utf8`].
pub fn to_utf16(name: &[u8], is_utf8: bool, out: &mut Vec<u16>) -> Result<()> {
    out.try_reserve(name.len())?;
    if is_utf8 && !name.is_ascii() {
        if let Some(chars) = compose(name)? {
            for c in chars {
                let c = char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER);
                out.extend_from_slice(c.encode_utf16(&mut [0; 2]));
            }
            return Ok(());
        }
    }
    out.extend(name.iter().map(|&b| u16::from(b)));
    Ok(())
}
