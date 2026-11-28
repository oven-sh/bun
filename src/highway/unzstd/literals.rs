//! Huffman-coded literals. More lanes start at a guess, fall in step with the codes, and count from where they are met.

use core::array::from_fn;
use core::hint::{Locality, black_box, cold_path, prefetch_write, select_unpredictable};
use core::mem::MaybeUninit;

use super::Tape;

const LOG_MAX: u32 = 12;
/// Longer codes are rare.
const QUICK_LOG: u32 = 11;
/// How many bits a load has at least.
const LOADED: isize = 57;
/// How many rows are written at once.
const FILL: usize = 16;
type Fill = [[u8; 2]; FILL];

/// How many symbols a lane decodes at a time...
const BATCH_MAX: usize = 1000;
/// ...and then in steps of so many, to meet the second lane...
const CHASE_STEP: usize = 30;
/// ...until it gives up.
const CHASE_MAX: usize = 8 * CHASE_STEP;
/// With a different set of the cache for each lane.
const STAGE_LEN: usize = 21 * 64;
const _: () = assert!(BATCH_MAX + CHASE_MAX + 2 * CHASE_STEP <= STAGE_LEN);
/// For fewer symbols in a stream, a second lane does not pay.
const SPLIT_MIN: usize = 300;
/// The same for a single stream.
const QUARTERS_MIN: usize = 96;

type Stages = [[MaybeUninit<u8>; STAGE_LEN]; 8];

/// By the next `log` bits: the length of the code that they start with, and its symbol.
#[repr(C, align(64))]
pub struct HuffmanTable {
    /// The first `1 << log` are set, with lengths from 1 to `log`.
    rows: [MaybeUninit<[u8; 2]>; (1 << LOG_MAX) + FILL],
    /// The same for `pair_log` bits, with two symbols in the upper half. If only one fits, the filler follows.
    pairs: [MaybeUninit<u32>; 1 << QUICK_LOG],
    lengths_by_symbol: [u8; 256],
    /// It has no code.
    fillers: [u8; 16],
    pair_log: u32,
    /// How many of 256 bytes in the stages are likely to count.
    pair_yield: usize,
    /// All lengths are a multiple of it.
    step: u32,
    /// 0 as long as there are none.
    log: u32,
}

const _: () = assert!(core::mem::offset_of!(HuffmanTable, fillers) % 16 == 0);

#[cfg(not(miri))]
#[repr(C, align(64))]
struct Kept([[u8; 16]; 256 + 1]);

/// By which pairs have a filler: where the other bytes are. At last, what each pair adds to the index and the count.
#[cfg(not(miri))]
static KEPT: Kept = {
    let (mut kept, mut mask) = ([[0; _]; _], 0);
    while mask < 256 {
        let (mut from, mut to) = (0, 0);
        while from < 16 {
            kept[mask][to] = from as u8;
            to += 1 - (mask >> (from / 2) & from & 1);
            from += 1;
        }
        mask += 1;
    }
    kept[256] = [1, 1, 2, 1, 4, 1, 8, 1, 16, 1, 32, 1, 64, 1, 128, 1];
    Kept(kept)
};

/// `LOADED` bits from `lowest` on at the top, with a mark that tells how many were shifted out. SAFETY: they are not beyond the end of `src`, which starts with `head`.
#[inline(always)]
unsafe fn load(src: &[u8], head: u64, lowest: isize) -> u64 {
    if lowest < 0 {
        cold_path();
        return head.unbounded_shl((7 - lowest).min(64) as u32) | 1;
    }
    // SAFETY: the last of these bytes has the highest of the bits.
    u64::from_le_bytes(unsafe { *src.as_ptr().offset(lowest >> 3).cast() }) << (!lowest & 7) | 1
}

#[cfg(all(target_arch = "x86_64", not(miri)))]
fn has_bmi2() -> bool {
    is_x86_feature_detected!("bmi1") && is_x86_feature_detected!("bmi2")
}

/// Whether lookups are so cheap that more lanes pay.
fn can_split() -> bool {
    cfg_select! {
        all(target_arch = "x86_64", not(miri)) => has_bmi2(),
        _ => true,
    }
}

#[cfg(all(target_arch = "x86_64", not(miri)))]
macro_rules! lookup {
    ($index:literal) => {
        lines!(
            "shrx rax, r\\lane, rbx",
            ".if {width} == 1",
            "movzx eax, word ptr [rsi + 2 * rax]",
            "shlx r\\lane, r\\lane, rax",
            concat!("mov [rcx + {stride} * (\\lane - 8) + ", $index, "], ah"),
            ".else",
            "movzx edx, word ptr [rsi + 4 * rax + 2]",
            "movzx eax, byte ptr [rsi + 4 * rax]",
            "shlx r\\lane, r\\lane, rax",
            concat!("mov [rcx + {stride} * (\\lane - 8) + 2 * ", $index, "], dx"),
            ".endif",
        )
    };
}

impl HuffmanTable {
    pub fn allocate() -> Option<Box<Self>> {
        let mut table = Box::<Self>::try_new_uninit().ok()?;
        // SAFETY: no field has to be dropped, and the rows may be anything.
        unsafe {
            (*table.as_mut_ptr()).lengths_by_symbol = [0; _];
            (*table.as_mut_ptr()).fillers = [0; _];
            (*table.as_mut_ptr()).pair_log = 0;
            (*table.as_mut_ptr()).pair_yield = 0;
            (*table.as_mut_ptr()).step = 1;
            (*table.as_mut_ptr()).log = 0;
            Some(table.assume_init())
        }
    }

    /// By weight, there are `counts` of `symbols` from `starts` on. Returns whether they make a table.
    #[inline(always)]
    pub fn fill(
        &mut self,
        log: u32,
        (symbols, starts, counts): (&[u8; 2048], &[u16; 16], &[u32; 16]),
        weights: &[u8; 256],
    ) -> bool {
        /// SAFETY: there are `count` symbols with `FILL / N` rows each, and `FILL` more of both.
        #[inline(always)]
        unsafe fn repeat<const N: usize>(from: *const u8, count: usize, length: u8, to: *mut Fill) {
            for index in 0..count / N + 1 {
                // SAFETY: as the caller promises.
                unsafe {
                    let symbols = from.add(index * N).cast::<[u8; FILL]>().read();
                    let codes = symbols.map(|it| u16::from_ne_bytes([length, it]));
                    let rows: [_; FILL] = from_fn(|row| codes[row * N / FILL]);
                    to.add(index).cast::<[u16; FILL]>().write_unaligned(rows);
                }
                black_box(());
            }
        }

        (self.log, self.pair_log, self.pair_yield) = (0, 0, 256);
        let counts = &counts[1..=log.min(LOG_MAX) as usize];
        let rows = counts
            .iter()
            .zip(0..)
            .map(|(&count, log)| u64::from(count) << log);
        if rows.sum::<u64>() != 1 << counts.len() || log == 0 {
            return false;
        }
        let log = counts.len() as u8;
        for (length, weight) in self.lengths_by_symbol.iter_mut().zip(weights) {
            *length = (log + 1).wrapping_sub(*weight);
        }
        let mut to = self.rows.as_mut_ptr();
        for ((&count, &start), shorter_by) in counts.iter().zip(&starts[1..]).zip(0..) {
            let (count, length) = (count as usize, log - shorter_by);
            let from = symbols[start.into()..][..count + FILL].as_ptr();
            // SAFETY: the rows add up.
            unsafe {
                match shorter_by {
                    0 => repeat::<16>(from, count, length, to.cast()),
                    1 => repeat::<8>(from, count, length, to.cast()),
                    2 => repeat::<4>(from, count, length, to.cast()),
                    3 => repeat::<2>(from, count, length, to.cast()),
                    _ => {
                        for index in 0..count << (shorter_by - 4) {
                            let symbol = *from.add(index >> (shorter_by - 4));
                            (to.cast::<Fill>().add(index)).write([[length, symbol]; FILL]);
                        }
                    }
                }
                to = to.add(count << shorter_by);
            }
        }
        self.log = log.into();
        self.step = if counts[0] == 1 << log { self.log } else { 1 };
        true
    }

    /// If it pays for `count` symbols in `len` bytes.
    #[inline]
    pub fn add_pairs(&mut self, count: usize, len: usize) {
        let log = (2 * self.log).min(QUICK_LOG);
        let (per_byte, per_row) = if can_split() { (25, 11) } else { (22, 2) };
        if (1..=log).contains(&self.log)
            && count.saturating_sub(len * per_byte / 16) > 300 + (per_row << log) / 4
        {
            crate::with_avx2(
                #[inline(always)]
                || self.fill_pairs(log),
            );
        }
    }

    #[inline(always)]
    fn fill_pairs(&mut self, log: u32) {
        let is_unused = |&length| u32::from(length) > self.log;
        let Some(filler) = self.lengths_by_symbol.iter().position(is_unused) else {
            return;
        };
        let (shift, size, alone) = (64 - self.log, 1 << log, (filler as u32) << 24);
        let (mut start, mut last) = (0, 0u32);
        while start < size {
            // SAFETY: the table is set.
            let (length, symbol) = unsafe { self.row((start as u64) << (64 - log), shift) };
            let (left, first) = (log - length % 64, (length % 64) | u32::from(symbol) << 16);
            if last % 64 == length % 64 {
                let (set, rest) = self.pairs.split_at_mut(start);
                for (to, from) in rest.iter_mut().zip(&set[start - (1 << left)..]) {
                    // SAFETY: those in front are set.
                    to.write(unsafe { from.assume_init() } - last + first);
                }
            } else {
                for index in 0..1 << left {
                    // SAFETY: the table is set.
                    let (more, next) =
                        unsafe { self.row((index as u64) << (63 - left) << 1, shift) };
                    let second = (more % 64) | u32::from(next) << 24;
                    let second = select_unpredictable(more % 64 <= left, second, alone);
                    self.pairs[start + index].write(first + second);
                }
            }
            (start, last) = (start + (1 << left), first);
        }
        // SAFETY: just now.
        let pairs = unsafe { self.pairs[..size].assume_init_ref() }.iter();
        let useful = size
            + pairs
                .map(|it| u32::from(it >> 24 != alone >> 24))
                .sum::<u32>() as usize;
        self.lengths_by_symbol[filler] = 0;
        (self.fillers, self.pair_log, self.pair_yield) =
            ([filler as u8; _], log, (useful * 128) >> log);
    }

    /// Eight pairs without the fillers. Returns how many bytes that is. SAFETY: there is room for all.
    #[inline(always)]
    unsafe fn compact(&self, pairs: &[u8; 16], to: *mut u8) -> usize {
        cfg_select! {
            miri => {
                pairs.as_chunks().0.iter().fold(0, |len, &[first, second]| {
                    // SAFETY: as the caller promises.
                    unsafe { to.add(len).cast::<[u8; 2]>().write([first, second]) };
                    len + 1 + usize::from(second != self.fillers[0])
                })
            }
            _ => {
                let dropped: usize;
                // SAFETY: the index has 8 bits, and the fillers are aligned.
                unsafe {
                    #[cfg(target_arch = "x86_64")]
                    core::arch::asm!(
                        "movdqu {a}, [{pairs}]",
                        "movdqa {b}, [{fillers}]",
                        "pcmpeqb {b}, {a}",
                        "packsswb {b}, {b}",
                        "pmovmskb {index:e}, {b}",
                        "movzx {dropped:e}, {index:l}",
                        "lea {index:e}, [{dropped} + {dropped}]",
                        "popcnt {dropped:e}, {dropped:e}",
                        "pshufb {a}, [{kept} + 8 * {index}]",
                        "movdqu [{to}], {a}",
                        a = out(xmm_reg) _, b = out(xmm_reg) _,
                        index = out(reg) _, dropped = out(reg) dropped,
                        pairs = in(reg) pairs, to = in(reg) to,
                        fillers = in(reg) &raw const self.fillers, kept = in(reg) &raw const KEPT,
                        options(nostack),
                    );
                    #[cfg(target_arch = "aarch64")]
                    core::arch::asm!(
                        "ldr {a:q}, [{pairs}]",
                        "ldr {b:q}, [{fillers}]",
                        "ldr {c:q}, [{kept}, #4096]",
                        "cmeq {b}.16b, {b}.16b, {a}.16b",
                        "sshr {b}.8h, {b}.8h, #15",
                        "and {b}.16b, {b}.16b, {c}.16b",
                        "addv {b:h}, {b}.8h",
                        "fmov {dropped:w}, {b:s}",
                        "and {index}, {dropped}, #255",
                        "lsr {dropped}, {dropped}, #8",
                        "ldr {b:q}, [{kept}, {index}, lsl #4]",
                        "tbl {a}.16b, {{{a}.16b}}, {b}.16b",
                        "str {a:q}, [{to}]",
                        a = out(vreg) _, b = out(vreg) _, c = out(vreg) _,
                        index = out(reg) _, dropped = out(reg) dropped,
                        pairs = in(reg) pairs, to = in(reg) to,
                        fillers = in(reg) &raw const self.fillers, kept = in(reg) &raw const KEPT,
                        options(nostack),
                    );
                }
                16 - dropped
            }
        }
    }

    #[inline(always)]
    fn bits_of(&self, symbols: &[u8]) -> isize {
        let lengths = symbols
            .iter()
            .map(|&it| self.lengths_by_symbol[usize::from(it)]);
        lengths.map(isize::from).sum()
    }

    /// From `symbols[index]`, which starts at `position`, to the first that does not start before `target`.
    #[inline(always)]
    fn skip(
        &self,
        symbols: &[u8],
        (mut position, mut index): (isize, usize),
        target: isize,
    ) -> (isize, usize) {
        while let Some(symbols) = symbols[index..].first_chunk::<8>()
            && let further = position - self.bits_of(symbols)
            && further >= target
        {
            (position, index) = (further, index + 8);
        }
        while position > target
            && let Some(&symbol) = symbols.get(index)
        {
            position -= self.bits_of(&[symbol]);
            index += 1;
        }
        (position, index)
    }

    /// The length of the next code, modulo 64, and its symbol. SAFETY: `shift` is `64 - log`, which is not 64.
    #[inline(always)]
    unsafe fn row(&self, bits: u64, shift: u32) -> (u32, u8) {
        // SAFETY: the index has `log` bits.
        unsafe {
            let row = self.rows.as_ptr().add(bits.wrapping_shr(shift) as usize);
            if cfg!(target_arch = "x86_64") {
                let [length, symbol] = (*row).assume_init();
                return (length.into(), symbol);
            }
            let row = u16::from_le(row.cast::<u16>().read_unaligned());
            (row.into(), (row >> 8) as u8)
        }
    }

    /// The table for so many symbols at a time, and how far to shift for an index.
    #[inline(always)]
    fn rows_and_shift(&self, width: usize) -> (*const u32, u32) {
        match width {
            1 => (self.rows.as_ptr().cast(), 64 - self.log),
            _ => (self.pairs.as_ptr().cast(), 64 - self.pair_log),
        }
    }

    /// `WIDTH * LOOKUPS * rounds` bytes in each lane, from `out` on in each stage. Prefetches what is `wanted`. SAFETY: there is room. The table is set, for codes of which a load has `LOOKUPS + EARLY`. `src` has `positions` bits.
    #[inline(always)]
    unsafe fn decode<
        const LANES: usize,
        const LOOKUPS: usize,
        const EARLY: usize,
        const WIDTH: usize,
    >(
        &self,
        src: &[u8],
        positions: &mut [isize; LANES],
        mut out: *mut u8,
        rounds: usize,
        wanted: &[*mut u8; 4],
    ) {
        let ((pairs, shift), head) = (self.rows_and_shift(WIDTH), super::load(src, 0));
        // SAFETY: as the caller promises.
        let put = |bits: u64, to: *mut u8| unsafe {
            if WIDTH == 1 {
                let (length, symbol) = self.row(bits, shift);
                *to = symbol;
                return length;
            }
            let row = *pairs.add(bits.wrapping_shr(shift) as usize);
            to.cast::<[u8; 2]>()
                .write(((row >> 16) as u16).to_le_bytes());
            row
        };
        let (mut lowest, mut bits) = (*positions, [0; LANES]);
        // SAFETY: as the caller promises. Positions only go down.
        unsafe {
            for lane in 0..LANES {
                lowest[lane] -= LOADED;
                bits[lane] = load(src, head, lowest[lane]);
            }
            for round in 0..rounds {
                let done = round * LOOKUPS * WIDTH * LANES / 4;
                prefetch_write(wanted[round % 4].wrapping_add(done), Locality::L1);
                for lane in 0..LANES {
                    lowest[lane] -= bits[lane].trailing_zeros() as isize;
                    let mut loaded = load(src, head, lowest[lane]);
                    // They do not have to wait for the load.
                    for lookup in 0..EARLY {
                        let length = put(bits[lane], out.add(lane * STAGE_LEN + lookup * WIDTH));
                        bits[lane] = bits[lane].wrapping_shl(length);
                        loaded = loaded.wrapping_shl(length);
                    }
                    bits[lane] = loaded;
                }
                for lookup in EARLY..LOOKUPS {
                    for lane in 0..LANES {
                        let length = put(bits[lane], out.add(lane * STAGE_LEN + lookup * WIDTH));
                        bits[lane] = bits[lane].wrapping_shl(length);
                    }
                }
                out = out.add(LOOKUPS * WIDTH);
            }
        }
        for lane in 0..LANES {
            positions[lane] = lowest[lane] + LOADED - bits[lane].trailing_zeros() as isize;
        }
    }

    /// At least `count` bytes in each lane, from `start` of the stages on. Returns where they end. SAFETY: the table is set, and `src` has `positions` bits.
    #[inline(never)]
    unsafe fn decode_some<const LANES: usize>(
        &self,
        src: &[u8],
        positions: &mut [isize; LANES],
        (stages, start): (&mut Stages, usize),
        count: usize,
        wanted: &[*mut u8; 4],
    ) -> usize {
        assert!(LANES <= stages.len() && start + count + 9 <= STAGE_LEN);
        // SAFETY: see above.
        unsafe {
            let out = stages.as_mut_ptr().cast::<u8>().add(start);
            if self.log > QUICK_LOG {
                self.decode::<LANES, 2, 1, 1>(src, positions, out, count.div_ceil(2), wanted);
                return start + count.next_multiple_of(2);
            }
            if LANES != 1 && self.pair_log != 0 {
                crate::with_bmi2(
                    #[inline(always)]
                    || {
                        self.decode::<LANES, 5, 0, 2>(
                            src,
                            positions,
                            out,
                            count.div_ceil(10),
                            wanted,
                        )
                    },
                );
                return start + count.next_multiple_of(10);
            }
            #[cfg(all(target_arch = "x86_64", not(miri)))]
            if let Some(positions) = positions.as_mut_array()
                && has_bmi2()
            {
                self.decode_4(src, positions, out, count, wanted);
                return start + count.next_multiple_of(3);
            }
            if LANES != 1 && cfg!(target_arch = "x86_64") {
                self.decode::<LANES, 5, 0, 1>(src, positions, out, count.div_ceil(5), wanted);
                return start + count.next_multiple_of(5);
            } else if LANES != 1 {
                self.decode::<LANES, 4, 1, 1>(src, positions, out, count.div_ceil(4), wanted);
                return start + count.next_multiple_of(4);
            }
            crate::with_bmi2(
                #[inline(always)]
                || self.decode::<LANES, 3, 2, 1>(src, positions, out, count.div_ceil(3), wanted),
            );
        }
        start + count.next_multiple_of(3)
    }

    /// SAFETY: as for `decode::<4, 3, 2, 1>()`, with BMI1 and BMI2.
    #[cfg(all(target_arch = "x86_64", not(miri)))]
    #[inline(always)]
    unsafe fn decode_4(
        &self,
        src: &[u8],
        positions: &mut [isize; 4],
        out: *mut u8,
        count: usize,
        wanted: &[*mut u8; 4],
    ) {
        macro_rules! reload {
            ($lane:literal, $bits:literal, $lowest:literal) => {
                lines!(
                    concat!("tzcnt rdx, ", $bits),
                    concat!("shrx rax, ", $bits, ", rbx"),
                    "movzx eax, word ptr [rsi + 2 * rax]",
                    concat!("shlx ", $bits, ", ", $bits, ", rax"),
                    concat!("mov [rcx + {stride} * ", $lane, "], ah"),
                    concat!("shrx ", $bits, ", ", $bits, ", rbx"),
                    ".p2align 5, , 9",
                    concat!("sub ", $lowest, ", rdx"),
                    concat!("jl 3", $lane, "f"),
                    concat!("mov rdx, ", $lowest),
                    "shr rdx, 3",
                    "add rdx, [rsp + 48]",
                    concat!("andn rdi, ", $lowest, ", [rsp + 8]"),
                    "shlx rdx, [rdx], rdi",
                    concat!("4", $lane, ":"),
                    "or rdx, 1",
                    "shlx rdx, rdx, rax",
                    concat!("movzx eax, word ptr [rsi + 2 * ", $bits, "]"),
                    concat!("shlx ", $bits, ", rdx, rax"),
                    concat!("mov [rcx + {stride} * ", $lane, " + 1], ah"),
                )
            };
        }

        let head = super::load(src, 0);
        let [a, b, c, d] = wanted.map(|it| it.addr().wrapping_sub(out.addr()));
        let frame = [
            out.addr() + count,
            7,
            a,
            b,
            c,
            d,
            src.as_ptr().expose_provenance(),
        ];
        let mut lowest = positions.map(|it| it - LOADED);
        // SAFETY: it does what that does.
        unsafe {
            let mut bits = lowest.map(|it| load(src, head, it));
            core::arch::asm!(
                "push rbx",
                ".irp at, 48, 40, 32, 24, 16, 8, 0",
                "push qword ptr [rdx + \\at]",
                ".endr",
                "mov rbx, rax",
                ".p2align 5",
                "2:",
                reload!(0, "r8", "r12"), reload!(1, "r9", "r13"),
                reload!(2, "r10", "r14"), reload!(3, "r11", "r15"),
                ".irp lane, 8, 9, 10, 11",
                lookup!(2),
                ".endr",
                "mov eax, ecx",
                "and eax, 3",
                "mov rax, [rsp + 16 + 8 * rax]",
                "prefetcht0 [rax + rcx]",
                "add rcx, 3",
                ".p2align 5, , 10",
                "cmp rcx, [rsp]",
                "jb 2b",
                "jmp 5f",
                ".irp lane, 0, 1, 2, 3",
                "3\\lane:",
                "xor edx, edx",
                "jmp 4\\lane\\()b",
                ".endr",
                "5:",
                "add rsp, 56",
                "pop rbx",
                width = const 1,
                stride = const STAGE_LEN,
                inout("rax") 64 - self.log as usize => _,
                inout("rcx") out => _,
                inout("rdx") &raw const frame => _,
                in("rsi") self.rows.as_ptr(),
                out("rdi") _,
                inout("r8") bits[0], inout("r9") bits[1],
                inout("r10") bits[2], inout("r11") bits[3],
                inout("r12") lowest[0], inout("r13") lowest[1],
                inout("r14") lowest[2], inout("r15") lowest[3],
            );
            for lane in 0..4 {
                positions[lane] = lowest[lane] + LOADED - bits[lane].trailing_zeros() as isize;
            }
        }
    }

    /// The same for all stages, from their start, if the codes are not long.
    #[cfg(not(all(target_arch = "x86_64", not(miri))))]
    #[inline(always)]
    unsafe fn decode_8<const WIDTH: usize>(
        &self,
        src: &[u8],
        positions: &mut [isize; 8],
        stages: &mut Stages,
        count: usize,
        wanted: &[*mut u8; 4],
    ) -> usize {
        let (out, rounds) = (stages.as_mut_ptr().cast(), count.div_ceil(5 * WIDTH));
        assert!(5 * WIDTH * rounds <= STAGE_LEN);
        // SAFETY: see above.
        unsafe { self.decode::<8, 5, 0, WIDTH>(src, positions, out, rounds, wanted) };
        5 * WIDTH * rounds
    }

    /// With BMI1 and BMI2. What it decodes in the first 8 bytes of `src` means nothing.
    #[cfg(all(target_arch = "x86_64", not(miri)))]
    #[inline(never)]
    unsafe fn decode_8<const WIDTH: usize>(
        &self,
        src: &[u8],
        positions: &mut [isize; 8],
        stages: &mut Stages,
        count: usize,
        wanted: &[*mut u8; 4],
    ) -> usize {
        macro_rules! for_lanes {
            ($($line:expr),* $(,)?) => {
                concat!(".irp lane, 8, 9, 10, 11, 12, 13, 14, 15\n", $($line, "\n",)* ".endr")
            };
        }

        let (count, (rows, shift)) = (
            count.next_multiple_of(5 * WIDTH),
            self.rows_and_shift(WIDTH),
        );
        assert!(0 < count && count <= STAGE_LEN);
        let out = stages.as_mut_ptr().cast::<u8>();
        let [a, b, c, d] = wanted.map(|it| it.addr().wrapping_sub(2 * out.addr()));
        let frame = [out.addr() + count, 7, a, b, c, d];
        let [a, b, c, d, e, f, g, h] = positions;
        // SAFETY: it does what `decode()` does, but waits for the loads, which have five codes.
        unsafe {
            core::arch::asm!(
                "push rbx",
                ".irp at, 40, 32, 24, 16, 8, 0",
                "push qword ptr [rdx + \\at]",
                ".endr",
                "mov rbx, rax",
                for_lanes!("sub r\\lane, {loaded}", "push r\\lane", "mov r\\lane, 1"),
                ".p2align 5",
                "2:",
                for_lanes!(
                    "tzcnt rdx, r\\lane",
                    "mov rax, [rsp + 8 * (15 - \\lane)]",
                    ".p2align 5, , 9",
                    "sub rax, rdx",
                    "jl 3\\lane\\()f",
                    "mov [rsp + 8 * (15 - \\lane)], rax",
                    "andn edx, eax, [rsp + 72]",
                    "shr rax, 3",
                    "mov rax, [rdi + rax]",
                    "shlx r\\lane, rax, rdx",
                    "or r\\lane, 1",
                    "4\\lane:",
                ),
                for_lanes!(lookup!(0)), for_lanes!(lookup!(1)), for_lanes!(lookup!(2)),
                for_lanes!(lookup!(3)), for_lanes!(lookup!(4)),
                "mov eax, ecx",
                "and eax, 3 * {width}",
                "mov rax, [rsp + 80 + {scale} * rax]",
                "prefetcht0 [rax + 2 * rcx]",
                ".if {width} == 2",
                "prefetcht0 [rax + 2 * rcx + 40]",
                ".endif",
                "add rcx, 5 * {width}",
                ".p2align 5, , 11",
                "cmp rcx, [rsp + 64]",
                "jb 2b",
                "jmp 5f",
                for_lanes!(
                    "3\\lane:",
                    "mov [rsp + 8 * (15 - \\lane)], rax",
                    "mov r\\lane, 1",
                    "jmp 4\\lane\\()b",
                ),
                "5:",
                for_lanes!(
                    "tzcnt rdx, r\\lane",
                    "mov r\\lane, [rsp + 8 * (15 - \\lane)]",
                    "sub r\\lane, rdx",
                    "add r\\lane, {loaded}",
                ),
                "add rsp, 112",
                "pop rbx",
                stride = const STAGE_LEN,
                loaded = const LOADED,
                width = const WIDTH,
                scale = const 8 / WIDTH,
                inout("rax") shift as usize => _,
                inout("rcx") out => _,
                inout("rdx") &raw const frame => _,
                in("rsi") rows,
                in("rdi") src.as_ptr(),
                inout("r8") *a, inout("r9") *b, inout("r10") *c, inout("r11") *d,
                inout("r12") *e, inout("r13") *f, inout("r14") *g, inout("r15") *h,
            );
        }
        count
    }

    /// Returns whether `len` symbols use up the bits from `starts` to `ends`. Four streams have 8 bytes in front.
    pub fn decode_streams<const N: usize>(
        &self,
        src: &[u8],
        [starts, ends]: [[usize; N]; 2],
        (tape, position): (Tape<'_>, usize),
        len: usize,
        lead: usize,
    ) -> bool {
        let share = len.div_ceil(N);
        if self.log == 0
            || (starts.iter().zip(&ends)).any(|(start, end)| start > end || *end > 8 * src.len())
            || position > tape.initialized
            || len > tape.capacity - position
            || (N - 1) * share > len
            || (N != 1 && starts[0] < 64)
        {
            return false;
        }
        let mut streams = Streams {
            table: self,
            src,
            starts: starts.map(|it| it as isize),
            positions: ends.map(|it| it as isize),
            outs: from_fn(|index| tape.start.wrapping_add(position + index * share)),
            lens: from_fn(|index| share.min(len - index * share)),
            lead,
        };
        let is_valid = streams.decode();
        if is_valid {
            // SAFETY: each has written its share.
            unsafe { tape.extend_to(position + len) };
        }
        is_valid
    }
}

struct Streams<'a, const N: usize> {
    /// It is set.
    table: &'a HuffmanTable,
    src: &'a [u8],
    starts: [isize; N],
    /// Not beyond the end of `src`.
    positions: [isize; N],
    /// With room for `lens`.
    outs: [*mut u8; N],
    lens: [usize; N],
    lead: usize,
}

impl<const N: usize> Streams<'_, N> {
    #[inline(always)]
    fn decode(&mut self) -> bool {
        let mut stages = [[MaybeUninit::uninit(); _]; _];
        let mut splits = self.starts[0] >= 64 && self.table.log <= QUICK_LOG && can_split();
        loop {
            let most = self.lens.into_iter().fold(0, usize::max);
            if most == 0 {
                return self.positions == self.starts;
            }
            let wanted = &from_fn(|it| self.outs[it % N].wrapping_add(self.lead));
            if splits && N == 1 && (QUARTERS_MIN..=BATCH_MAX).contains(&most) {
                splits = false;
                self.decode_quarters(most, &mut stages, wanted);
                continue;
            } else if splits && N == 4 && most >= SPLIT_MIN {
                splits = match self.table.pair_log {
                    0 => self.decode_split::<1>(most, &mut stages, wanted),
                    _ => self.decode_split::<2>(most, &mut stages, wanted),
                };
                continue;
            }
            let (mut ends, count) = (self.positions, most.min(BATCH_MAX));
            // SAFETY: see the fields. So many have been written then.
            unsafe {
                let count =
                    (self.table).decode_some(self.src, &mut ends, (&mut stages, 0), count, wanted);
                for stream in 0..N {
                    self.accept(
                        stream,
                        (stages[stream][..count].assume_init_ref(), 0),
                        ends[stream],
                    );
                }
            }
        }
    }

    /// With four lanes for the only stream, as far as each meets the next.
    #[inline(always)]
    fn decode_quarters(&mut self, len: usize, stages: &mut Stages, wanted: &[*mut u8; 4]) {
        let count = len / 4 + len / 64 + 8;
        let bits = (self.positions[0] - self.starts[0]).clamp(0, 1 << 16) as u32;
        let skipped = bits * (len + 4 - count) as u32 / (3 * len as u32);
        let guesses: [_; 4] = from_fn(|it| self.positions[0] - it as isize * skipped as isize);
        let mut ends = guesses;
        // SAFETY: see the fields. So many have been written then.
        unsafe {
            let count = (self.table).decode_some(self.src, &mut ends, (stages, 0), count, wanted);
            for lane in 0..4 {
                let symbols = stages[lane][..count].assume_init_ref();
                let (start, index) =
                    self.table
                        .skip(symbols, (guesses[lane], 0), self.positions[0]);
                if start != self.positions[0] {
                    return;
                }
                self.accept(0, (symbols, index), ends[lane]);
            }
        }
    }

    /// With two lanes for each of four streams. Returns whether it is worth another try.
    #[inline(always)]
    fn decode_split<const WIDTH: usize>(
        &mut self,
        most: usize,
        stages: &mut Stages,
        wanted: &[*mut u8; 4],
    ) -> bool {
        let useful = self.table.pair_yield;
        let count = ((most / 2 + most / 128 + 8) * 256 / useful).min(BATCH_MAX);
        let ahead = (count * useful / 256 - count / 64 - 14) as u64;
        let mut lanes = [[0; 4]; 2];
        for stream in 0..4 {
            let bits = (self.positions[stream] - self.starts[stream]).max(0) as u64;
            let skipped = (bits * ahead) as u32 / (self.lens[stream] as u32).max(1);
            lanes[0][stream] = self.positions[stream];
            lanes[1][stream] =
                self.positions[stream] - (skipped - skipped % self.table.step) as isize;
        }
        let (mut guesses, mut passed, mut have_met) = (lanes[1], [0; 4], [false; 4]);
        // SAFETY: see the fields, and `decode()`. The first four stages have `first_count`, and the others `count`.
        unsafe {
            let all = lanes.as_flattened_mut().as_mut_array().unwrap_unchecked();
            let count = self
                .table
                .decode_8::<WIDTH>(self.src, all, stages, count, wanted);
            let mut first_count = count;
            loop {
                let is_last_try = first_count >= count + CHASE_MAX;
                let mut wasted = 0;
                for stream in 0..4 {
                    if have_met[stream] {
                        continue;
                    }
                    let seconds = stages[4 + stream][..count].assume_init_ref();
                    let from = (guesses[stream], passed[stream]);
                    let (guess, index) = self.table.skip(seconds, from, lanes[0][stream]);
                    (guesses[stream], passed[stream]) = (guess, index);
                    let meets = guess == lanes[0][stream];
                    if meets || is_last_try || first_count >= self.lens[stream] {
                        let firsts = stages[stream][..first_count].assume_init_ref();
                        self.accept(stream, (firsts, 0), lanes[0][stream]);
                        have_met[stream] = true;
                        wasted += usize::from(!meets);
                    }
                    if meets {
                        self.accept(stream, (seconds, index), lanes[1][stream]);
                    }
                }
                if have_met == [true; 4] {
                    return wasted < 2;
                }
                let rest = (&mut *stages, first_count);
                first_count =
                    (self.table).decode_some(self.src, &mut lanes[0], rest, CHASE_STEP, wanted);
            }
        }
    }

    /// `symbols[start..]` are next in `stream`, as far as it goes. They end at `position`.
    #[inline(never)]
    fn accept(&mut self, stream: usize, (symbols, start): (&[u8], usize), position: isize) {
        if self.lens[stream] == 0 {
            return;
        }
        let (mut out, mut left, mut index) = (self.outs[stream], self.lens[stream], start);
        let table = self.table;
        // SAFETY: there is room.
        unsafe {
            if table.pair_yield == 256 {
                let len = symbols[start..].len().min(left);
                out.copy_from_nonoverlapping(symbols[start..].as_ptr(), len);
                (out, left, index) = (out.add(len), left - len, start + len);
            }
            while left != 0
                && let Some(&symbol) = symbols.get(index)
            {
                *out = symbol;
                let len = usize::from(index % 2 == 0 || symbol != self.table.fillers[0]);
                (out, left, index) = (out.add(len), left - len, index + 1);
                if index % 2 == 0 {
                    let (all, from) = (symbols[index..].as_chunks().0, out.addr());
                    let some = &all[..all.len().min(left / 16)];
                    for pairs in some {
                        out = out.add(table.compact(pairs, out));
                    }
                    (left, index) = (left - (out.addr() - from), index + 16 * some.len());
                }
            }
        }
        (self.outs[stream], self.lens[stream]) = (out, left);
        let excess = &symbols[index..];
        self.positions[stream] = self.positions[stream].min(position + self.table.bits_of(excess));
    }
}
