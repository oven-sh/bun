//! The kernels for the lower levels of `bun_zstd_encoder`, from src/jsc/bindings/highway_zstd_stages.cpp.

use bun_pod::{AnyBitPattern, NoUninit};

/// An entry of a table has an index in these, and bits of the hash above.
pub const INDEX_BITS: u32 = 24;
/// Entries that are so far before the first byte have no effect.
pub const INDEX_GAP: usize = 8192;
/// In elements.
pub const SCRATCH_LEN: usize = 21_700;
/// How many more sequences and literals there has to be room for than there can be.
pub const SLACK: usize = 32;
/// With fewer, [`write_sequences`] does not pay.
pub const SEQUENCES_MIN: usize = 384;
const MATCH_MIN: usize = 4;

/// Shares are in 256ths.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Effort {
    /// Does without the round for long matches, and tries a third of the positions for short ones.
    pub is_single: bool,
    /// The first round tries one in 3 positions instead of one in 7.
    pub is_narrow: bool,
    /// 4 to 6.
    pub short_len: u8,
    /// How many positions before a match are not worth trying.
    pub cut: u8,
    /// How much has to be open between short sequences for the first round to get narrow.
    pub narrow_from: u16,
    /// If so much is open, all of it is tried for short matches, not a half.
    pub all_from: u16,
    /// How many 16ths of a byte have to be open per match for a second round.
    pub second_from: u16,
    /// How many sequences have to repeat an offset for it to be worth looking for more.
    pub repeats_from: u16,
    /// With so many, there is a second round in any case.
    pub records_from: u16,
}

/// What the last chunks were like.
#[repr(C)]
pub struct Trend {
    repeating: u32,
    /// How many in a row had no matches to speak of.
    idle: u32,
    /// How many 256ths of a literal a bit stands for.
    per_bit: u16,
    is_covered: bool,
    is_poor: bool,
    is_dense: bool,
    is_text: bool,
    is_rich: bool,
    walks: bool,
}

impl Trend {
    pub const UNKNOWN: Self = Self {
        repeating: u32::MAX,
        idle: 0,
        per_bit: 48,
        is_covered: false,
        is_poor: false,
        is_dense: false,
        is_text: false,
        is_rich: false,
        walks: false,
    };
}

pub struct Searcher<'a> {
    pub bytes: &'a [u8],
    /// Of the first byte. That of the last one has to fit in [`INDEX_BITS`].
    pub index: u32,
    pub max_distance: u32,
    /// The second one is for text.
    pub efforts: &'a [Effort; 2],
    /// For long and for short matches. Their lengths are powers of 2.
    pub tables: [&'a mut [u32]; 2],
    /// Only its capacity counts.
    pub scratch: &'a mut Vec<u32>,
}

/// What a search adds to. A sequence has its extra bits in 8 bytes, the symbols for literals, offset and match, and the number of bits.
pub struct Found<'a, T> {
    pub sequences: &'a mut Vec<T>,
    pub literals: &'a mut Vec<u8>,
    /// They add up, and tell which symbols occur. The rest is an estimate.
    pub counts: &'a mut [u32; 256],
    pub repeats: &'a mut [u32; 3],
    pub trend: &'a mut Trend,
}

#[repr(C)]
struct Table {
    entries: *mut u32,
    log: usize,
}

#[repr(C)]
struct Request<'a> {
    bytes: *const u8,
    len: usize,
    tables: [Table; 2],
    scratch: *mut u32,
    efforts: &'a [Effort; 2],
    index: u32,
    max_distance: u32,
}

#[repr(C)]
struct Sink<'a> {
    sequences: *mut u8,
    sequence_count: usize,
    literals: *mut u8,
    anchor: usize,
    counts: &'a mut [u32; 256],
    trend: &'a mut Trend,
    repeats: [u32; 3],
}

impl Searcher<'_> {
    fn request(&mut self) -> Option<Request<'_>> {
        let is_valid = (self.tables.iter()).all(|it| it.len() >= 4)
            && self.scratch.capacity() >= SCRATCH_LEN
            && self.index as usize + self.bytes.len() <= 1 << INDEX_BITS
            && self.max_distance <= 1 << (INDEX_BITS - 1);
        is_valid.then(|| Request {
            bytes: self.bytes.as_ptr(),
            len: self.bytes.len(),
            tables: self.tables.each_mut().map(|it| Table {
                entries: it.as_mut_ptr(),
                log: it.len().ilog2() as usize,
            }),
            scratch: self.scratch.as_mut_ptr(),
            efforts: self.efforts,
            index: self.index,
            max_distance: self.max_distance,
        })
    }

    /// Makes long matches with what is from `start` on possible.
    pub fn index(mut self, start: usize) -> Option<()> {
        let start = start.min(self.bytes.len());
        // SAFETY: the pointers of a request have the room it tells.
        unsafe { highway_zstd_stages_index(&self.request()?, start) };
        Some(())
    }

    /// In what is from `start` on, up to 128 KB. Returns where the last match ends.
    pub fn search<T: AnyBitPattern>(
        mut self,
        start: usize,
        found: &mut Found<'_, T>,
    ) -> Option<usize> {
        const { assert!(size_of::<T>() == 12) };
        let len = self.bytes.len().checked_sub(start)?;
        let sequences = found.sequences.spare_capacity_mut();
        let literals = found.literals.spare_capacity_mut();
        if len > 1 << 17
            || sequences.len() < len / MATCH_MIN + SLACK
            || literals.len() < len + SLACK
        {
            return None;
        }
        let mut sink = Sink {
            sequences: sequences.as_mut_ptr().cast(),
            sequence_count: 0,
            literals: literals.as_mut_ptr().cast(),
            anchor: start,
            counts: found.counts,
            trend: found.trend,
            repeats: (found.repeats).map(|it| if it > self.max_distance { 0 } else { it }),
        };
        // SAFETY: there is room for as much as it can write, and it tells how much it has.
        unsafe {
            highway_zstd_stages_search(&self.request()?, &mut sink);
            let literals_len = sink.literals.offset_from_unsigned(found.literals.as_ptr());
            found.literals.set_len(literals_len);
            (found.sequences).set_len(found.sequences.len() + sink.sequence_count);
        }
        if sink.sequence_count != 0 {
            *found.repeats = sink.repeats;
        }
        Some(sink.anchor)
    }
}

/// For literal lengths, offsets and match lengths.
#[repr(C)]
pub struct Tables<'a> {
    pub next_states: &'a [u16; 2048],
    /// Where the next states of each code start, and how many there are.
    pub ranges: &'a [[[u16; 2]; 64]; 3],
    pub logs: [u32; 3],
}

#[repr(C)]
pub struct Progress {
    pub position: usize,
    pub bits: u64,
    /// Up to 7.
    pub bit_count: u32,
    pub states: [u32; 3],
}

/// From the last one on. Returns how many are left. They are like those of [`Found`].
pub fn write_sequences<T: NoUninit>(
    tables: &Tables<'_>,
    sequences: &[T],
    out: &mut [u8],
    progress: &mut Progress,
) -> usize {
    const { assert!(size_of::<T>() == 12) };
    let (start, count) = (sequences.as_ptr().cast(), sequences.len());
    // SAFETY: two slices, each as a pointer and a length.
    unsafe {
        highway_zstd_write_sequences(tables, start, count, out.as_mut_ptr(), out.len(), progress)
    }
}

/// About how often each byte of up to 128 KB occurs, but exactly for never and always. Returns the last byte that occurs, and the largest count.
pub fn estimate_counts(bytes: &[u8], sample_log: u32, counts: &mut [u32; 256]) -> Option<[u32; 2]> {
    let weight = (bytes.len() >> sample_log.clamp(6, 14)).clamp(1, 6);
    // SAFETY: a slice, as a pointer and a length.
    let highest =
        unsafe { highway_zstd_estimate_counts(bytes.as_ptr(), bytes.len(), weight, counts) };
    (highest != 0).then_some([highest % 256, highest / 256])
}

/// In four streams behind a jump table. It needs room to spare, and leaves the work to the caller on some CPUs.
pub fn write_literals(
    symbols: &[u8],
    // By symbol: up to 11 of the highest bits, and their number in the lowest 4.
    codes: &[u64; 256],
    out: &mut [u8],
) -> Option<usize> {
    let (start, len) = (symbols.as_ptr(), symbols.len());
    // SAFETY: two slices, each as a pointer and a length.
    let len =
        unsafe { highway_zstd_write_literals(start, len, codes, out.as_mut_ptr(), out.len()) };
    (len != 0).then_some(len)
}

/// A complete prefix code that is close to the best, for counts that are 0 from `used` on. Returns the largest length.
pub fn assign_codes(
    counts: &[u32; 256],
    used: usize,
    limit: u32,
    codes: &mut [u64; 256],
    lens: &mut [u8; 256],
    per_len: &mut [u16; 16],
) -> Option<u32> {
    Some(highway_zstd_assign_codes(
        counts, used, limit, codes, lens, per_len,
    ))
    .filter(|&it| it != 0)
}

/// About how many bits up to 1000 symbols take with a table of their own, and its description.
pub fn estimate_cost(counts: &[u32; 64]) -> Option<usize> {
    Some(highway_zstd_estimate_cost(counts) as usize).filter(|&it| it != 0)
}

/// For Finite State Entropy. Returns the length of the description. It gives up on very uneven counts.
pub fn build_table<T: AnyBitPattern, const N: usize>(
    counts: &[u32; N],
    log: u32,
    first_state: usize,
    next_states: &mut [u16],
    // What to add to a state for the index of the next one, and for the number of bits in the highest 4.
    transforms: &mut [T; N],
    out: &mut [u8; 96],
) -> Option<usize> {
    const { assert!(size_of::<T>() == 8 && (N == 16 || N == 64)) };
    let states = next_states
        .get_mut(first_state..)?
        .get_mut(..1 << log.min(16))?;
    let (states, transforms) = (states.as_mut_ptr(), transforms.as_mut_ptr().cast());
    // SAFETY: there are so many counts, transforms and states.
    let len = unsafe {
        highway_zstd_build_table(
            counts.as_ptr(),
            N,
            log,
            first_state,
            states,
            transforms,
            out,
        )
    };
    (len != 0).then_some(len)
}

cfg_select! {
    any(feature = "test_support", miri) => {
        /// How far back the 4 bytes may have been.
        unsafe fn exchange(request: &Request<'_>, at: usize) -> usize {
            let Table { entries, log } = request.tables[1];
            // SAFETY: the bytes are up to the caller.
            unsafe {
                let word = request.bytes.add(at).cast::<[u8; 4]>().read();
                let hash = u64::from(u32::from_le_bytes(word)).wrapping_mul(0xCF1B_BCDC_B7A5_6463);
                let entry = (hash as u32 >> INDEX_BITS << INDEX_BITS) + request.index + at as u32;
                entry.wrapping_sub(entries.add((hash >> (64 - log)) as usize).replace(entry))
                    as usize
            }
        }

        unsafe fn highway_zstd_stages_index(request: &Request<'_>, from: usize) {
            for at in from..request.len.saturating_sub(MATCH_MIN) {
                // SAFETY: 4 bytes follow.
                unsafe { exchange(request, at) };
            }
        }

        unsafe fn highway_zstd_stages_search(request: &Request<'_>, sink: &mut Sink<'_>) {
            // SAFETY: up to the caller.
            let bytes = unsafe { core::slice::from_raw_parts(request.bytes, request.len) };
            for at in sink.anchor..bytes.len().saturating_sub(MATCH_MIN) {
                // SAFETY: 4 bytes follow.
                let offset = unsafe { exchange(request, at) };
                if at < sink.anchor
                    || !(1..=at.min(request.max_distance as usize)).contains(&offset)
                {
                    continue;
                }
                let pairs = bytes[at..].iter().zip(&bytes[at - offset..]);
                let (len, literal_len) =
                    (pairs.take_while(|(a, b)| a == b).count(), at - sink.anchor);
                let (code, bits) = match literal_len {
                    _ if len < MATCH_MIN => continue,
                    ..16 => (literal_len as u32, 0),
                    16..64 => continue,
                    _ => (literal_len.ilog2() + 19, literal_len.ilog2()),
                };
                let (len, match_code, match_bits) = match len - 3 {
                    base @ ..128 => (len.min(34), base.min(31) as u32, 0),
                    base => (len, base.ilog2() + 36, base.ilog2()),
                };
                let log = (offset + 3).ilog2();
                let extra =
                    ((len - 3) % (1 << match_bits)) | (((offset + 3) % (1 << log)) << match_bits);
                let extra = (literal_len % (1 << bits)) | (extra << bits);
                let symbols =
                    [code, 64 + log, 128 + match_code, bits + match_bits + log].map(|it| it as u8);
                symbols[..3]
                    .iter()
                    .for_each(|&it| sink.counts[usize::from(it)] += 1);
                // SAFETY: there is room for a sequence per 4 bytes, and a literal per byte.
                unsafe {
                    let to = sink.sequences.add(12 * sink.sequence_count);
                    to.cast::<[u8; 8]>().write((extra as u64).to_le_bytes());
                    to.add(8).cast::<[u8; 4]>().write(symbols);
                    sink.literals
                        .copy_from(bytes[sink.anchor..].as_ptr(), literal_len);
                    sink.literals = sink.literals.add(literal_len);
                }
                sink.repeats = [offset as u32, sink.repeats[0], sink.repeats[1]];
                (sink.anchor, sink.sequence_count) = (at + len, sink.sequence_count + 1);
            }
        }

        /// Leaves some.
        unsafe fn highway_zstd_write_sequences(
            tables: &Tables<'_>,
            sequences: *const [u8; 12],
            mut count: usize,
            out: *mut u8,
            room: usize,
            progress: &mut Progress,
        ) -> usize {
            // SAFETY: up to the caller.
            let (sequences, out) = unsafe {
                (
                    core::slice::from_raw_parts(sequences, count),
                    core::slice::from_raw_parts_mut(out, room),
                )
            };
            while count > 5 && progress.position + 16 <= room {
                count -= 1;
                let (mut bits, mut bit_count) = (u128::from(progress.bits), progress.bit_count);
                let [extra @ .., literal, offset, matched, extra_count] = sequences[count];
                for (kind, symbol) in [(1, offset), (2, matched), (0, literal)] {
                    let [first, states] =
                        tables.ranges[kind][usize::from(symbol % 64)].map(u32::from);
                    let state = &mut progress.states[kind];
                    while states != 0 && *state >= 2 * states {
                        bits |= u128::from(*state % 2) << bit_count;
                        (*state, bit_count) = (*state / 2, bit_count + 1);
                    }
                    if states != 0 {
                        *state = tables.next_states[(first + *state - states) as usize].into();
                    }
                }
                bits |= u128::from(u64::from_le_bytes(extra)) << bit_count;
                bit_count += u32::from(extra_count);
                out[progress.position..][..16].copy_from_slice(&bits.to_le_bytes());
                progress.position += bit_count as usize / 8;
                (progress.bits, progress.bit_count) =
                    ((bits >> (bit_count / 8 * 8)) as u64, bit_count % 8);
            }
            count
        }

        unsafe fn highway_zstd_estimate_counts(
            _: *const u8,
            _: usize,
            _: usize,
            _: &mut [u32; 256],
        ) -> u32 {
            0
        }

        unsafe fn highway_zstd_write_literals(
            _: *const u8,
            _: usize,
            _: &[u64; 256],
            out: *mut u8,
            room: usize,
        ) -> usize {
            // SAFETY: up to the caller.
            unsafe { out.write_bytes(0xAA, room) };
            0
        }

        fn highway_zstd_assign_codes(
            _: &[u32; 256],
            _: usize,
            _: u32,
            _: &mut [u64; 256],
            _: &mut [u8; 256],
            _: &mut [u16; 16],
        ) -> u32 {
            0
        }

        fn highway_zstd_estimate_cost(_: &[u32; 64]) -> u32 {
            0
        }

        unsafe fn highway_zstd_build_table(
            _: *const u32,
            _: usize,
            _: u32,
            _: usize,
            _: *mut u16,
            _: *mut u8,
            _: &mut [u8; 96],
        ) -> usize {
            0
        }
    }
    _ => {
        unsafe extern "C" {
            fn highway_zstd_stages_index(request: &Request<'_>, from: usize);

            fn highway_zstd_stages_search(request: &Request<'_>, sink: &mut Sink<'_>);

            fn highway_zstd_write_sequences(
                tables: &Tables<'_>,
                sequences: *const [u8; 12],
                count: usize,
                out: *mut u8,
                room: usize,
                progress: &mut Progress,
            ) -> usize;

            fn highway_zstd_estimate_counts(
                bytes: *const u8,
                len: usize,
                weight: usize,
                counts: &mut [u32; 256],
            ) -> u32;

            fn highway_zstd_write_literals(
                symbols: *const u8,
                len: usize,
                codes: &[u64; 256],
                out: *mut u8,
                room: usize,
            ) -> usize;

            safe fn highway_zstd_assign_codes(
                counts: &[u32; 256],
                used: usize,
                limit: u32,
                codes: &mut [u64; 256],
                lens: &mut [u8; 256],
                per_len: &mut [u16; 16],
            ) -> u32;

            safe fn highway_zstd_estimate_cost(counts: &[u32; 64]) -> u32;

            fn highway_zstd_build_table(
                counts: *const u32,
                symbol_count: usize,
                log: u32,
                first_state: usize,
                next_states: *mut u16,
                transforms: *mut u8,
                out: &mut [u8; 96],
            ) -> usize;
        }
    }
}
