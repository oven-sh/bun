//! Which part of the source an instruction stands for.

use crate::bytes::{Reader, fold_sign, unfold_sign};

/// An error is reported at `divot` and quotes the text from `start` to `end`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(C)]
pub struct Position {
    pub divot: u32,
    pub start: u32,
    pub end: u32,
}

const ENTRIES_PER_CHAPTER: usize = 64;
const CHAPTER_BYTES: usize = 12;
const MAX_NUMBER_BYTES: usize = 5;
const MAX_ENTRY_BYTES: usize = 4 * MAX_NUMBER_BYTES;

/// Where decoding can start.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Chapter {
    /// Of its first entry.
    offset: u32,
    /// Of the entry before that.
    divot: u32,
    at: u32,
}

impl Chapter {
    fn read(bytes: &[u8; CHAPTER_BYTES]) -> Chapter {
        let word = |index: usize| u32::from_le_bytes(bytes.as_chunks().0[index]);
        Chapter {
            offset: word(0),
            divot: word(1),
            at: word(2),
        }
    }

    fn to_bytes(self) -> [u8; CHAPTER_BYTES] {
        let words = [self.offset, self.divot, self.at].map(u32::to_le_bytes);
        core::array::from_fn(|index| words[index / 4][index % 4])
    }
}

/// Each entry is four numbers of seven bits a byte: how far on its instruction and its divot are from those of the
/// entry before, and how far the range extends to either side.
#[derive(Clone, Copy, Default)]
pub struct Positions<'a> {
    chapters: &'a [[u8; CHAPTER_BYTES]],
    entries: &'a [u8],
}

#[inline(always)]
fn write(bytes: &mut [u8], mut at: usize, mut value: u32) -> usize {
    while value >= 0x80 {
        bytes[at] = value as u8 | 0x80;
        value >>= 7;
        at += 1;
    }
    bytes[at] = value as u8;
    at + 1
}

#[inline(always)]
fn write_entry(bytes: &mut [u8; MAX_ENTRY_BYTES], numbers: [u32; 4]) -> usize {
    let [distance, step, before, after] = numbers;
    if (distance | before | after | step >> 7) >= 0x80 {
        return write_long_entry(bytes, numbers);
    }
    let is_long = step >= 0x80;
    let extent = before | after << 8;
    let rest = if is_long {
        step >> 7 | extent << 8
    } else {
        extent
    };
    bytes[0] = distance as u8;
    bytes[1] = step as u8 & 0x7f | u8::from(is_long) << 7;
    bytes[2..6].copy_from_slice(&rest.to_le_bytes());
    4 + usize::from(is_long)
}

#[cold]
fn write_long_entry(bytes: &mut [u8; MAX_ENTRY_BYTES], numbers: [u32; 4]) -> usize {
    (numbers.into_iter()).fold(0, |at, number| write(bytes, at, number))
}

struct Entries<'a> {
    bytes: &'a [u8],
    offset: u32,
    divot: u32,
}

#[inline(always)]
fn read_entry(bytes: &mut &[u8]) -> Option<[u32; 4]> {
    if let Some(&[distance, step, third, fourth, fifth]) = bytes.first_chunk() {
        let is_long = step >= 0x80;
        let [step_high, before, after] = if is_long {
            [third, fourth, fifth]
        } else {
            [0, third, fourth]
        };
        if (distance | step_high | before | after) < 0x80 {
            *bytes = &bytes[4 + usize::from(is_long)..];
            let step = u32::from(step & 0x7f) | u32::from(step_high) << 7;
            return Some([distance.into(), step, before.into(), after.into()]);
        }
    }
    read_long_entry(bytes)
}

#[inline(never)]
fn read_long_entry(bytes: &mut &[u8]) -> Option<[u32; 4]> {
    let mut reader = Reader::new(bytes);
    let mut next = || reader.number();
    let numbers = [next()?, next()?, next()?, next()?];
    *bytes = reader.rest();
    Some(numbers)
}

impl Iterator for Entries<'_> {
    type Item = (u32, Position);

    #[inline(always)]
    fn next(&mut self) -> Option<(u32, Position)> {
        let [distance, step, before, after] = read_entry(&mut self.bytes)?;
        self.offset = self.offset.wrapping_add(distance);
        self.divot = (self.divot).wrapping_add_signed(unfold_sign(step));
        let position = Position {
            divot: self.divot,
            start: self.divot.wrapping_sub(before),
            end: self.divot.wrapping_add(after),
        };
        Some((self.offset, position))
    }
}

impl<'a> Positions<'a> {
    /// The most bytes that so many entries take.
    pub(crate) fn max_size(entries: usize) -> usize {
        MAX_NUMBER_BYTES + entries * MAX_ENTRY_BYTES + entries / ENTRIES_PER_CHAPTER * CHAPTER_BYTES
    }

    /// Returns how much of `bytes` it took: the number of chapters, the chapters, the entries. The offsets ascend.
    pub(crate) fn encode(entries: &[(u32, Position)], bytes: &mut [u8]) -> usize {
        let Some(last) = entries.len().checked_sub(1) else {
            return 0;
        };
        let count = last / ENTRIES_PER_CHAPTER;
        let chapters_start = write(bytes, 0, count as u32);
        let first = chapters_start + count * CHAPTER_BYTES;
        let (chapters, mut rest) = bytes[chapters_start..].split_at_mut(count * CHAPTER_BYTES);
        let (mut chapters, room) = (chapters.as_chunks_mut().0.iter_mut(), rest.len());
        let (mut last_offset, mut last_divot) = (0, 0u32);
        for (index, entries) in entries.chunks(ENTRIES_PER_CHAPTER).enumerate() {
            if index != 0 {
                let chapter = Chapter {
                    offset: entries[0].0,
                    divot: last_divot,
                    at: (room - rest.len()) as u32,
                };
                *chapters.next().expect("counted") = chapter.to_bytes();
            }
            for &(offset, position) in entries {
                let numbers = [
                    offset - last_offset,
                    fold_sign(position.divot.wrapping_sub(last_divot) as i32),
                    position.divot.wrapping_sub(position.start),
                    position.end.wrapping_sub(position.divot),
                ];
                let size = write_entry(rest.first_chunk_mut().expect("reserved"), numbers);
                rest = &mut rest[size..];
                (last_offset, last_divot) = (offset, position.divot);
            }
        }
        first + room - rest.len()
    }

    pub(crate) fn read(bytes: &'a [u8]) -> Option<Positions<'a>> {
        if bytes.is_empty() {
            return Some(Positions::default());
        }
        let mut reader = Reader::new(bytes);
        let size = (reader.number()? as usize).checked_mul(CHAPTER_BYTES)?;
        let (chapters, entries) = reader.rest().split_at_checked(size)?;
        Some(Positions {
            chapters: chapters.as_chunks().0,
            entries,
        })
    }

    pub fn is_empty(self) -> bool {
        self.entries.is_empty()
    }

    fn all(self) -> Entries<'a> {
        Entries {
            bytes: self.entries,
            offset: 0,
            divot: 0,
        }
    }

    fn entries_from(self, chapter: Chapter) -> Entries<'a> {
        let bytes = self.entries.get(chapter.at as usize..).unwrap_or_default();
        let step = Reader::new(bytes).number().unwrap_or(0);
        Entries {
            bytes,
            offset: chapter.offset.wrapping_sub(step),
            divot: chapter.divot,
        }
    }

    /// Each holds from its offset up to that of the next.
    pub fn entries(self) -> impl Iterator<Item = (u32, Position)> + 'a {
        self.all()
    }

    /// The first entry holds for what is before it too. If there is none, the start of the code has to do.
    pub fn find(self, offset: u32) -> Option<Position> {
        let chapters_begun = self
            .chapters
            .partition_point(|chapter| Chapter::read(chapter).offset <= offset);
        let entries = match self.chapters[..chapters_begun].last() {
            Some(chapter) => self.entries_from(Chapter::read(chapter)),
            None => self.all(),
        };
        let entries = entries.take_while(|&(start, _)| start <= offset);
        let found = entries.last().or_else(|| self.all().next());
        found.map(|(_, position)| position)
    }

    /// Whether all bytes decode, the offsets ascend and are accepted, and the chapters agree with the entries.
    pub(crate) fn is_valid(self, accepts: impl Fn(u32) -> bool) -> bool {
        let mut entries = self.all();
        let mut chapters = self.chapters.iter();
        for index in 0usize.. {
            let (last_offset, divot) = (entries.offset, entries.divot);
            let at = (self.entries.len() - entries.bytes.len()) as u32;
            let Some((offset, _)) = entries.next() else {
                break;
            };
            if !accepts(offset) || (index != 0 && offset <= last_offset) {
                return false;
            }
            if index != 0
                && index % ENTRIES_PER_CHAPTER == 0
                && chapters.next().map(Chapter::read) != Some(Chapter { offset, divot, at })
            {
                return false;
            }
        }
        entries.bytes.is_empty() && chapters.next().is_none()
    }
}
