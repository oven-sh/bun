//! Reads and writes `UCharsTrie` and `BytesTrie`, and reads `UTrie2`. ICU4C: ucharstriebuilder.cpp, stringtriebuilder.cpp, utrie2.h

use crate::resb::{u16_at, u32_at};
use bun_icu_format::collation::trie::{BLOCK_LENGTH, BLOCK_SHIFT, GRANULARITY};

pub(crate) type Entry = (Vec<u16>, u32);

const MAX_LINEAR_BRANCH: usize = 5;
const MIN_LINEAR_MATCH: usize = 0x30;
const MAX_LINEAR_MATCH: usize = 0x10;
const MIN_VALUE_LEAD: u16 = 0x40;
const IS_FINAL: u16 = 0x8000;
/// The lowest lead units of numbers of two and of three units.
const VALUE_LEADS: [u32; 2] = [0x4000, 0x7fff];
const NODE_VALUE_LEADS: [u32; 2] = [0x100, 0x1fe];
const DELTA_LEADS: [u32; 2] = [0xfc00, 0xffff];

struct Reader<'a> {
    bytes: &'a [u8],
    prefix: Vec<u16>,
    entries: Vec<Entry>,
}

impl Reader<'_> {
    fn take(&self, at: &mut usize) -> u16 {
        *at += 1;
        u16_at(self.bytes, 2 * (*at - 1))
    }

    fn number(&self, lead: u16, [two, three]: [u32; 2], at: &mut usize) -> u32 {
        match u32::from(lead) {
            lead if lead < two => lead,
            lead if lead < three => (lead - two) << 16 | u32::from(self.take(at)),
            _ => u32::from(self.take(at)) << 16 | u32::from(self.take(at)),
        }
    }

    fn branch(&mut self, mut at: usize, mut count: usize) {
        while count > MAX_LINEAR_BRANCH {
            at += 1;
            let delta = self.number(self.take(&mut at), DELTA_LEADS, &mut at);
            self.branch(at + delta as usize, count / 2);
            count -= count / 2;
        }
        for left in (0..count).rev() {
            self.prefix.push(self.take(&mut at));
            if left == 0 || u16_at(self.bytes, 2 * at) & IS_FINAL != 0 {
                self.node(at);
            }
            if left != 0 {
                let lead = self.take(&mut at);
                let delta = self.number(lead & !IS_FINAL, VALUE_LEADS, &mut at);
                if lead & IS_FINAL == 0 {
                    self.node(at + delta as usize);
                }
            }
            self.prefix.pop();
        }
    }

    fn node(&mut self, mut at: usize) {
        let mut lead = self.take(&mut at);
        if lead & IS_FINAL != 0 {
            let value = self.number(lead & !IS_FINAL, VALUE_LEADS, &mut at);
            return self.entries.push((self.prefix.clone(), value));
        } else if lead >= MIN_VALUE_LEAD {
            let value = self.number(lead / MIN_VALUE_LEAD - 1, NODE_VALUE_LEADS, &mut at);
            self.entries.push((self.prefix.clone(), value));
            lead %= MIN_VALUE_LEAD;
        }
        match usize::from(lead) {
            0 => {
                let count = self.take(&mut at);
                self.branch(at, usize::from(count) + 1);
            }
            count @ ..MIN_LINEAR_MATCH => self.branch(at, count + 1),
            linear => {
                let before = self.prefix.len();
                for _ in MIN_LINEAR_MATCH..=linear {
                    self.prefix.push(self.take(&mut at));
                }
                self.node(at);
                self.prefix.truncate(before);
            }
        }
    }
}

/// Returns the sorted entries of the trie at the start of `bytes`.
pub(crate) fn read_string_trie(bytes: &[u8]) -> Vec<Entry> {
    let mut reader = Reader {
        bytes,
        prefix: Vec::new(),
        entries: Vec::new(),
    };
    reader.node(0);
    reader.entries
}

/// The lowest lead bytes of numbers of one, two, three and four bytes.
const BYTE_VALUE_LEADS: [u8; 4] = [0x10, 0x51, 0x6c, 0x7e];
const BYTE_DELTA_LEADS: [u8; 4] = [0, 0xc0, 0xf0, 0xfe];
const MIN_LINEAR_BYTE_MATCH: usize = 0x10;

fn take_compact(mut bytes: &[u8], shift: u32, leads: [u8; 4]) -> (usize, &[u8]) {
    let lead = bytes.split_off_first().expect("a byte") >> shift;
    let more = leads.iter().rposition(|&it| lead >= it).expect("a number");
    assert!(lead <= leads[3]);
    let (more, rest) = ((lead - leads[more], &bytes[..more]), &bytes[more..]);
    (
        more.1
            .iter()
            .fold(more.0.into(), |number, &it| number << 8 | usize::from(it)),
        rest,
    )
}

/// `count` is the number of edges if `bytes` is in a branch.
fn read_bytes_node(mut bytes: &[u8], count: Option<usize>, prefix: &[u16], out: &mut Vec<Entry>) {
    let with = |more: &[u8]| -> Vec<_> {
        prefix
            .iter()
            .copied()
            .chain(more.iter().map(|&it| it.into()))
            .collect()
    };
    match (count, usize::from(bytes[0])) {
        (None, 0) => read_bytes_node(&bytes[2..], Some(usize::from(bytes[1]) + 1), prefix, out),
        (None, lead @ ..MIN_LINEAR_BYTE_MATCH) => {
            read_bytes_node(&bytes[1..], Some(lead + 1), prefix, out)
        }
        (None, lead @ ..0x20) => {
            let (text, rest) = bytes[1..].split_at(lead - 0xf);
            read_bytes_node(rest, None, &with(text), out);
        }
        (None, lead) => {
            let (value, rest) = take_compact(bytes, 1, BYTE_VALUE_LEADS);
            out.push((prefix.into(), value as u32));
            if lead % 2 == 0 {
                read_bytes_node(rest, None, prefix, out);
            }
        }
        (Some(count), _) if count > MAX_LINEAR_BRANCH => {
            let (delta, rest) = take_compact(&bytes[1..], 0, BYTE_DELTA_LEADS);
            read_bytes_node(&rest[delta..], Some(count / 2), prefix, out);
            read_bytes_node(rest, Some(count - count / 2), prefix, out);
        }
        (Some(count), _) => {
            for _ in 1..count {
                let (delta, rest) = take_compact(&bytes[1..], 1, BYTE_VALUE_LEADS);
                let node = if bytes[1] % 2 == 0 {
                    &rest[delta..]
                } else {
                    &bytes[1..]
                };
                read_bytes_node(node, None, &with(&bytes[..1]), out);
                bytes = rest;
            }
            read_bytes_node(&bytes[1..], None, &with(&bytes[..1]), out);
        }
    }
}

pub(crate) fn read_bytes_trie(bytes: &[u8]) -> Vec<Entry> {
    let mut entries = Vec::new();
    read_bytes_node(bytes, None, &[], &mut entries);
    entries
}

/// An offset is the number of units after a node has been written.
struct Writer {
    /// In reverse order.
    units: Vec<u16>,
    are_bytes: bool,
}

impl Writer {
    /// Returns the lead, which is not written.
    fn number(&mut self, number: u32, [two, three]: [u32; 2]) -> u16 {
        if number < two {
            return number as u16;
        }
        self.units.push(number as u16);
        if number >> 16 < three - two {
            return (two + (number >> 16)) as u16;
        }
        self.units.push((number >> 16) as u16);
        three as u16
    }

    /// Returns the lead, which is not written.
    fn compact(&mut self, number: u32, leads: [u8; 4]) -> u16 {
        let fits = |&more: &usize| number >> (8 * more) < (leads[more + 1] - leads[more]).into();
        let more = (0..3).find(fits).expect("three bytes");
        self.units
            .extend(number.to_le_bytes()[..more].iter().map(|&it| u16::from(it)));
        u16::from(leads[more]) + (number >> (8 * more)) as u16
    }

    fn push(&mut self, unit: u16) -> usize {
        self.units.push(unit);
        self.units.len()
    }

    fn value(&mut self, value: u32, is_final: bool) -> usize {
        let lead = if self.are_bytes {
            self.compact(value, BYTE_VALUE_LEADS) << 1 | u16::from(is_final)
        } else {
            self.number(value, VALUE_LEADS) | if is_final { IS_FINAL } else { 0 }
        };
        self.push(lead)
    }

    /// `entries` have the first `depth` units in common.
    fn node(&mut self, entries: &[Entry], depth: usize) -> usize {
        let (value, entries) = match entries {
            [only] if only.0.len() == depth => return self.value(only.1, true),
            [first, rest @ ..] if first.0.len() == depth => (Some(first.1), rest),
            _ => (None, entries),
        };
        let edges: Vec<_> = entries.chunk_by(|a, b| a.0[depth] == b.0[depth]).collect();
        let min_linear_match = if self.are_bytes {
            MIN_LINEAR_BYTE_MATCH
        } else {
            MIN_LINEAR_MATCH
        };
        let kind = if edges.len() == 1 {
            let (first, last) = (
                &entries[0].0[depth..],
                &entries[entries.len() - 1].0[depth..],
            );
            let common = first.iter().zip(last).take_while(|(a, b)| a == b).count();
            self.node(entries, depth + common);
            let mut kind = 0;
            for (i, units) in first[..common].rchunks(MAX_LINEAR_MATCH).enumerate() {
                self.units.extend((i > 0).then_some(kind));
                self.units.extend(units.iter().rev());
                kind = (min_linear_match + units.len() - 1) as u16;
            }
            kind
        } else {
            self.branch(&edges, depth);
            match edges.len() - 1 {
                count if count < min_linear_match => count as u16,
                count => {
                    self.push(count as u16);
                    0
                }
            }
        };
        if self.are_bytes {
            let offset = self.push(kind);
            return value.map_or(offset, |value| self.value(value, false));
        }
        let lead = value.map_or(0, |value| self.number(value, NODE_VALUE_LEADS) + 1);
        self.push((lead * MIN_VALUE_LEAD) | kind)
    }

    fn branch(&mut self, edges: &[&[Entry]], depth: usize) -> usize {
        let unit_of = |edge: &[Entry]| edge[0].0[depth];
        if edges.len() > MAX_LINEAR_BRANCH {
            let (less, rest) = edges.split_at(edges.len() / 2);
            let target = self.branch(less, depth);
            let delta = self.branch(rest, depth) - target;
            let lead = match self.are_bytes {
                true => self.compact(delta as u32, BYTE_DELTA_LEADS),
                false => self.number(delta as u32, DELTA_LEADS),
            };
            self.push(lead);
            return self.push(unit_of(rest[0]));
        }
        let (last, others) = edges.split_last().expect("an edge");
        let is_final = |edge: &[Entry]| matches!(edge, [only] if only.0.len() == depth + 1);
        let targets = others.iter().rev();
        let targets = targets.map(|it| (!is_final(it)).then(|| self.node(it, depth + 1)));
        let targets: Vec<_> = targets.collect();
        self.node(last, depth + 1);
        let mut offset = self.push(unit_of(last));
        for (edge, target) in others.iter().rev().zip(targets) {
            match target {
                Some(target) => self.value((offset - target) as u32, false),
                None => self.value(edge[0].1, true),
            };
            offset = self.push(unit_of(edge));
        }
        offset
    }
}

fn write(entries: &[Entry], are_bytes: bool) -> impl Iterator<Item = u16> {
    let units = Vec::new();
    let mut writer = Writer { units, are_bytes };
    writer.node(entries, 0);
    writer.units.into_iter().rev()
}

/// `entries` are sorted.
pub(crate) fn write_string_trie(entries: &[Entry]) -> Vec<u16> {
    write(entries, false).collect()
}

/// `entries` are sorted.
pub(crate) fn write_bytes_trie(entries: &[Entry]) -> Vec<u8> {
    write(entries, true).map(|it| it as u8).collect()
}

const HEADER_UNITS: usize = 8;
const LEAD_CODE_POINTS_INDEX: usize = 0x800;
const INDEX_1: usize = 0x840;

/// A `UTrie2` with 32-bit values.
pub(crate) struct Trie<'a>(pub(crate) &'a [u8]);

impl Trie<'_> {
    fn index(&self, i: usize) -> usize {
        u16_at(self.0, 2 * (HEADER_UNITS + i)).into()
    }

    fn value(&self, i: usize) -> u32 {
        let index_length = usize::from(u16_at(self.0, 6));
        u32_at(self.0, 2 * (HEADER_UNITS + index_length) + 4 * i)
    }

    /// `c` is a code unit or a supplementary code point.
    pub(crate) fn get(&self, c: u32) -> u32 {
        let c = c as usize;
        let block = if c < 0x10000 {
            c >> BLOCK_SHIFT
        } else if c < usize::from(u16_at(self.0, 14)) << 11 {
            self.index(INDEX_1 - 32 + (c >> 11)) + (c >> BLOCK_SHIFT) % 64
        } else {
            return self.value((usize::from(u16_at(self.0, 8)) - 1) * GRANULARITY);
        };
        self.value(self.index(block) * GRANULARITY + c % BLOCK_LENGTH)
    }

    pub(crate) fn of_lead_code_point(&self, c: u32) -> u32 {
        let block = LEAD_CODE_POINTS_INDEX + ((c as usize - 0xd800) >> BLOCK_SHIFT);
        self.value(self.index(block) * GRANULARITY + c as usize % BLOCK_LENGTH)
    }

    pub(crate) fn initial_value(&self) -> u32 {
        self.value(u16_at(self.0, 12).into())
    }
}
