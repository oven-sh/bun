//! The search for matches of zstd's higher levels, from src/jsc/bindings/highway_zstd_ladder.cpp.

use core::mem::MaybeUninit;
use core::ops::Range;
use std::collections::TryReserveError;

use bun_pod::AnyBitPattern;

const RUNGS_MAX: usize = 11;
const LOG_MAX: u32 = 26;
/// For less, there is nothing to do.
const LEN_MIN: usize = 9;

/// A hash table that tells where bytes were last.
#[derive(Clone, Copy, Default)]
#[repr(C)]
struct Rung {
    /// How many bytes are hashed.
    len: u32,
    /// From 0 to 4 for all positions, a third, a fifth, a ninth and a sixteenth of them. 4 is not for the optimal parsers. 5 is a last rung for when there is time.
    spacing: u32,
    /// Of the number of entries, and of how many there is room for.
    log: u32,
    room_log: u32,
    used: u32,
    is_open: i32,
}

#[derive(Clone, Copy, Default)]
#[repr(C)]
struct Layout {
    rungs: [Rung; RUNGS_MAX + 1],
    count: u32,
    /// Those above them are bits of the hash.
    index_bits: u32,
    /// How many entries large tables should have for 4 that are used.
    room: u32,
    /// The index from which on the tables are not up to date.
    next: u32,
    /// What the length of the first rung was at first.
    len_min: u32,
    /// What the kernel needs to know to change it, and how much time it has saved.
    review: [u32; 6],
}

impl Layout {
    fn rungs(&self) -> &[Rung] {
        &self.rungs[..self.count as usize]
    }

    /// The entries of each table.
    fn tables(&self) -> impl Iterator<Item = Range<usize>> {
        self.rungs().iter().scan(0, |next, rung| {
            let start = core::mem::replace(next, *next + (1 << rung.room_log));
            Some(start..start + (1 << rung.log))
        })
    }
}

/// Tables for ever longer runs of bytes.
#[derive(Default)]
pub struct Ladder {
    /// Empty, or as many as the layout has room for, of which those in the tables are initialized.
    entries: Vec<MaybeUninit<u32>>,
    layout: Layout,
}

impl Ladder {
    /// Keeps the memory only. `rungs` are lengths and spacings, and `next` is the index of the first byte.
    pub fn reset(&mut self, rungs: &[(u8, u8)], reach_log: u32, room: u32, next: u32) {
        assert!(matches!(rungs, [(3..=8, 0), ..]) && rungs.len() <= RUNGS_MAX);
        self.entries.clear();
        self.layout = Layout {
            count: rungs.len() as u32,
            index_bits: (reach_log + 1).clamp(20, 28),
            room: room.min(16),
            next,
            len_min: rungs[0].0.into(),
            ..Layout::default()
        };
        for (rung, &(len, spacing)) in self.layout.rungs.iter_mut().zip(rungs) {
            assert!(matches!((len, spacing), (3..=96, 0..=5)));
            (rung.len, rung.spacing) = (len.into(), spacing.into());
        }
    }

    pub fn copy_from(&mut self, other: &Self) -> Result<(), TryReserveError> {
        self.entries.clear();
        self.entries.try_reserve_exact(other.entries.len())?;
        self.entries.extend_from_slice(&other.entries);
        self.layout = other.layout;
        Ok(())
    }

    /// In entries of 4 bytes.
    pub fn capacity(&self) -> usize {
        self.entries.capacity()
    }

    /// Lets the tables grow up to `log_of` their number.
    pub fn make_room(&mut self, log_of: impl Fn(usize) -> u32) -> Result<(), TryReserveError> {
        /// Of the size that tables start with.
        const FIRST_LOGS: [u32; 2] = [
            if cfg!(any(feature = "test_support", miri)) {
                18
            } else {
                14
            },
            10,
        ];
        let (old, mut new, mut len) = (self.layout, self.layout, 0);
        for (number, rung) in new.rungs.iter_mut().enumerate().take(old.rungs().len()) {
            rung.room_log = log_of(number).clamp(rung.room_log.max(4), LOG_MAX);
            let is_for_some = number != 0 && rung.len != 3;
            rung.log = (rung.log.max(FIRST_LOGS[usize::from(is_for_some)])).min(rung.room_log);
            len += 1 << rung.room_log;
        }
        let old_len = self.entries.len();
        if len == old_len {
            return Ok(());
        }
        let mut larger = Vec::new();
        if old_len == 0 && len <= self.entries.capacity() {
            larger = core::mem::take(&mut self.entries);
        }
        larger.try_reserve_exact(len)?;
        // SAFETY: there is room, and they need no initialization.
        unsafe { larger.set_len(len) };
        for (from, to) in old.tables().zip(new.tables()) {
            let (from, len_to, to) = (self.entries.get(from), to.len(), &mut larger[to]);
            match from {
                None => to.fill(MaybeUninit::new(0)),
                Some(from) if from.len() == to.len() => to.copy_from_slice(from),
                // The highest bits of a hash tell the place.
                Some(from) => {
                    (to.chunks_mut(len_to / from.len()).zip(from)).for_each(|(to, &it)| to.fill(it))
                }
            }
        }
        (self.entries, self.layout) = (larger, new);
        Ok(())
    }
}

/// How often symbols are expected, relative to one another.
#[repr(C)]
pub struct Counts {
    pub literals: [u32; 256],
    pub literal_lens: [u32; 40],
    pub match_lens: [u32; 56],
    pub offsets: [u32; 32],
}

/// From the quickest on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Parser {
    /// Takes the first match. For a few bytes. Does not look at the counts.
    Brief,
    /// Chooses among a chain of matches that overlap.
    Linked,
    /// Also sees where these go on after a few literals.
    LinkedWithRepeats,
    /// Also has a price for each literal, and each number of them.
    LinkedExactly,
    /// Finds the cheapest way to each position, given so many matches from each.
    OptimalOfOne,
    OptimalOfTwo,
    OptimalOfThree,
}

pub struct Search<'a> {
    /// Ends with what is searched.
    pub prefix: &'a [u8],
    pub start: usize,
    /// Of the first byte of `prefix`.
    pub index: u32,
    /// What precedes `prefix`.
    pub older: &'a [u8],
    /// The tables for `older`, and what `index` is to them.
    pub attached: Option<(&'a Ladder, u32)>,
    /// The start, end and offset of matches that are known, in order. Only for the optimal parsers.
    pub hints: &'a [[u32; 3]],
    pub max_distance: u32,
    /// From which on the optimal parsers take a match right away.
    pub nice_len: u32,
    /// How far before the end of a match they consider changing to a longer one.
    pub caution: u32,
    /// After how many bytes without a match the search gets superficial.
    pub patience: u32,
    pub parser: Parser,
}

cfg_select! {
    any(feature = "test_support", miri) => {
        #[derive(Default)]
        pub struct Work(Vec<u8>);

        impl Work {
            pub fn make_room(&mut self) -> Result<(), TryReserveError> {
                self.0.try_reserve_exact(64)
            }
        }

        impl Ladder {
            /// How far back the 4 bytes may have been, and their entry.
            fn look_up(&self, bytes: &[u8], index: u32) -> (usize, usize) {
                let word = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                let place =
                    (word.wrapping_mul(0x9E37_79B1) >> (32 - self.layout.rungs[0].log)) as usize;
                // SAFETY: it is in the first table.
                (
                    index.wrapping_sub(unsafe { self.entries[place].assume_init() }) as usize,
                    place,
                )
            }

            pub fn fill(&mut self, bytes: &[u8], part: Range<usize>, index: u32, _: &mut Work) {
                for at in part.start..part.end.min(bytes.len().saturating_sub(LEN_MIN)) {
                    let place = self.look_up(&bytes[at..], 0).1;
                    self.entries[place].write(index.wrapping_add(at as u32));
                }
            }

            pub fn search<T: AnyBitPattern>(
                &mut self,
                search: &Search<'_>,
                _: &mut Work,
                _: &mut Counts,
                repeats: &mut [u32; 3],
                found: &mut Vec<T>,
            ) -> usize {
                let Search { prefix, older, .. } = *search;
                let (mut at, mut anchor) = (search.start, search.start);
                while at + LEN_MIN <= prefix.len() {
                    let index = search.index.wrapping_add(at as u32);
                    let (own, place) = self.look_up(&prefix[at..], index);
                    self.entries[place].write(index);
                    let attached = (search.attached.iter()).map(|(it, index)| {
                        it.look_up(&prefix[at..], index.wrapping_add(at as u32)).0
                    });
                    let hinted = (search.hints.iter().filter(|it| it[0] as usize == at))
                        .map(|it| it[2] as usize);
                    let reach = 1..=(at + older.len()).min(search.max_distance as usize);
                    let len_of = |distance: usize| {
                        let earlier = older.iter().chain(prefix).skip(older.len() + at - distance);
                        earlier
                            .zip(&prefix[at..])
                            .take_while(|(a, b)| a == b)
                            .count()
                    };
                    let all = attached
                        .chain(hinted)
                        .chain([own, repeats[0] as usize])
                        .filter(|it| reach.contains(it));
                    match all.map(|it| (len_of(it), it)).max() {
                        Some((len @ 4.., distance)) => {
                            found.extend_from_slice(bun_pod::cast_slice(&[
                                (at - anchor) as u32,
                                len as u32 - 3,
                                distance as u32 + 3,
                            ]));
                            *repeats = [distance as u32, repeats[0], repeats[1]];
                            (at, anchor) = (at + len, at + len);
                        }
                        _ => at += 1,
                    }
                }
                anchor
            }
        }
    }
    _ => {
        use core::ptr;

        #[repr(C)]
        struct Tables {
            entries: *mut u32,
            layout: Layout,
            index: u32,
        }

        #[repr(C)]
        struct Request {
            prefix: *const u8,
            end: usize,
            start: usize,
            older: *const u8,
            older_len: usize,
            ladder: *mut Tables,
            attached: *mut Tables,
            hints: *const [u32; 3],
            hint_count: usize,
            counts: *mut Counts,
            found: *mut [u32; 3],
            room: usize,
            repeats: [u32; 3],
            max_distance: u32,
            nice_len: u32,
            caution: u32,
            patience: u32,
            parser: Parser,
        }

        #[repr(C, align(64))]
        struct CacheLine([u8; 64]);

        unsafe extern "C" {
            safe static highway_zstd_ladder_work_len: usize;
            fn highway_zstd_ladder_search(request: &mut Request, work: *mut CacheLine) -> usize;
            fn highway_zstd_ladder_fill(request: &mut Request, work: *mut CacheLine, to: usize);
        }

        /// Memory that nothing stays in.
        #[derive(Default)]
        pub struct Work(Vec<CacheLine>);

        impl Work {
            pub fn make_room(&mut self) -> Result<(), TryReserveError> {
                self.0
                    .try_reserve_exact(highway_zstd_ladder_work_len / size_of::<CacheLine>())
            }
        }

        const LEN_MAX: usize = 1 << 17;
        /// Positions in both runs of bytes have to fit in 32 bits.
        const PREFIX_LEN_MAX: usize = 5 << 29;
        const OLDER_LEN_MAX: usize = 1 << 30;

        impl Ladder {
            fn is_ready(&self, bytes: &[u8], start: usize, work: &Work) -> bool {
                !self.entries.is_empty()
                    && work.0.capacity() != 0
                    && (start.saturating_add(LEN_MIN)..=PREFIX_LEN_MAX).contains(&bytes.len())
            }

            /// Notes the positions in `part` of `bytes`, whose first one has that `index`.
            pub fn fill(&mut self, bytes: &[u8], part: Range<usize>, index: u32, work: &mut Work) {
                if !self.is_ready(bytes, part.start, work) {
                    return;
                }
                let (entries, layout) = (self.entries.as_mut_ptr().cast(), self.layout);
                let mut tables = Tables {
                    entries,
                    layout,
                    index,
                };
                let mut request = Request {
                    prefix: bytes.as_ptr(),
                    end: bytes.len(),
                    start: part.start,
                    older: bytes.as_ptr(),
                    older_len: 0,
                    ladder: &raw mut tables,
                    attached: ptr::null_mut(),
                    hints: ptr::null(),
                    hint_count: 0,
                    counts: ptr::null_mut(),
                    found: ptr::null_mut(),
                    room: 0,
                    repeats: [0; _],
                    max_distance: i32::MAX as u32,
                    nice_len: 0,
                    caution: 0,
                    patience: 0,
                    parser: Parser::Linked,
                };
                // SAFETY: a slice, tables as large as their layout says, and as much memory as the kernel asks for.
                unsafe {
                    highway_zstd_ladder_fill(
                        &mut request,
                        work.0.as_mut_ptr(),
                        part.end.min(bytes.len()),
                    )
                };
                self.layout = tables.layout;
            }

            /// Adds sequences while there is room: the number of literals, the length of the match less 3 and the value of the offset.
            /// Returns where the last one ends.
            pub fn search<T: AnyBitPattern>(
                &mut self,
                search: &Search<'_>,
                work: &mut Work,
                counts: &mut Counts,
                repeats: &mut [u32; 3],
                found: &mut Vec<T>,
            ) -> usize {
                const { assert!(size_of::<T>() == 12 && align_of::<T>() == 4) };
                if !self.is_ready(search.prefix, search.start, work)
                    || search.prefix.len() - search.start > LEN_MAX
                {
                    return search.start;
                }
                let older = &search.older[search.older.len().saturating_sub(OLDER_LEN_MAX)..];
                // The kernel reads 4 bytes at once.
                let older = if older.len() < 8 { &[] } else { older };
                let (entries, layout) = (self.entries.as_mut_ptr().cast(), self.layout);
                let mut tables = Tables {
                    entries,
                    layout,
                    index: search.index,
                };
                let mut attached = (search.attached)
                    .filter(|(it, _)| !it.entries.is_empty() && !older.is_empty())
                    .map(|(it, index)| Tables {
                        entries: it.entries.as_ptr().cast_mut().cast(),
                        layout: it.layout,
                        index,
                    });
                let mut request = Request {
                    prefix: search.prefix.as_ptr(),
                    end: search.prefix.len(),
                    start: search.start,
                    older: older.as_ptr(),
                    older_len: older.len(),
                    ladder: &raw mut tables,
                    attached: attached.as_mut().map_or(ptr::null_mut(), ptr::from_mut),
                    hints: search.hints.as_ptr(),
                    hint_count: search.hints.len(),
                    counts,
                    found: found.spare_capacity_mut().as_mut_ptr().cast(),
                    room: found.capacity() - found.len(),
                    repeats: *repeats,
                    max_distance: search.max_distance.clamp(8, i32::MAX as u32),
                    nice_len: search.nice_len.clamp(19, 247),
                    caution: search.caution.clamp(3, 128),
                    patience: search.patience,
                    parser: search.parser,
                };
                // SAFETY: as above. The kernel does not write to the entries of what is attached.
                let end = unsafe { highway_zstd_ladder_search(&mut request, work.0.as_mut_ptr()) };
                // SAFETY: it has filled what it has taken of the room.
                unsafe { found.set_len(found.capacity() - request.room) };
                (self.layout, *repeats) = (tables.layout, request.repeats);
                end
            }
        }
    }
}
