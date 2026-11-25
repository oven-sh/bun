//! The loop over the commands of a Brotli stream, in assembly. No value of the types here makes it leave its buffers.

use core::hint::select_unpredictable;
use core::mem::{MaybeUninit, offset_of};
use std::io::BorrowedCursor;

/// What may be written past the limit.
pub const SLACK: usize = 64;
/// What may be spoilt past the position that it got to.
pub const SPOILT: usize = 512;
/// What a command may read without looking.
const MIN_INPUT: usize = 32;
const WORD: usize = size_of::<u64>();
/// It stops that close to the limit.
const MIN_ROOM: usize = 6;

/// Up to the capacity, with bytes that may be anything. Zeroing would wait for memory that is not in the cache.
#[inline(always)]
pub fn extend_unzeroed(bytes: &mut Vec<u8>, len: usize) {
    let len = len.clamp(bytes.len(), bytes.capacity());
    cfg_select! {
        miri => bytes.resize(len, 0),
        // SAFETY: within the capacity, which the assembly stands for writing to.
        _ => unsafe {
            core::arch::asm!("/* {} */", in(reg) bytes.as_mut_ptr(), options(nostack, preserves_flags));
            bytes.set_len(len);
        },
    }
}

/// Where a part of the window is going to be copied to, which had better be in the cache by then.
#[derive(Clone, Copy)]
pub struct Destination {
    of_position_zero: usize,
    end: usize,
}

impl Destination {
    #[inline(always)]
    pub fn new(output: &mut BorrowedCursor<'_, u8>, first_position: isize) -> Self {
        const FITS_CACHE: usize = 256 * 1024;
        // SAFETY: nothing is written.
        let room = unsafe { output.as_mut() };
        Self {
            of_position_zero: room.as_ptr().addr().wrapping_sub_signed(first_position),
            end: (room.len().min(FITS_CACHE)).saturating_add_signed(first_position),
        }
    }
}

/// Of the function that has the [`Machine`] among its variables. The frame pointer points to this while it runs.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Frame {
    pointer: usize,
    code: usize,
}

impl Frame {
    #[inline(always)]
    pub fn current() -> Self {
        let (pointer, code);
        cfg_select! {
            // SAFETY: only reads registers.
            all(target_arch = "x86_64", not(miri)) => unsafe {
                core::arch::asm!(
                    "mov {}, rbp", "lea {}, [rip]", out(reg) pointer, out(reg) code,
                    options(nomem, nostack, preserves_flags),
                );
            },
            _ => (pointer, code) = (0, 0),
        }
        Self { pointer, code }
    }
}

/// The mask for the bits that the first table of a tree is for. The compiler knows the range of these.
#[derive(Clone, Copy)]
#[repr(u32)]
pub enum Root {
    Bits8 = 0xFF,
    Bits9 = 0x1FF,
    Bits10 = 0x3FF,
}

impl Root {
    #[inline(always)]
    pub const fn bits(self) -> u32 {
        (self as u32).bit_width()
    }
}

/// What a byte adds to the index of the tree for the next literal, and for the one after it.
pub struct ContextParts {
    by_byte: [[u8; 256]; 2],
    literals: [Symbol; 256],
}

impl ContextParts {
    /// Above every sum.
    pub const END: usize = 128;

    pub const fn new(&last: &[u8; 256], &second_last: &[u8; 256]) -> Self {
        let (mut literals, mut i) = ([Symbol(0); _], 0);
        while i < 256 {
            assert!(last[i] <= 76 && second_last[i] <= 7);
            literals[i].0 = u32::from_le_bytes([0, i as u8, second_last[i], last[i]]);
            i += 1;
        }
        Self {
            by_byte: [last, second_last],
            literals,
        }
    }

    #[inline(always)]
    pub fn of(&self, byte: u8) -> [u8; 2] {
        self.by_byte.each_ref().map(|it| it[usize::from(byte)])
    }
}

/// A value, and below it the length of the code. Then, for a literal, its [`ContextParts`].
#[derive(Clone, Copy, Default)]
#[repr(transparent)]
pub struct Symbol(u32);

pub type SymbolTree = [Symbol; Symbol::REACH];

impl Symbol {
    /// What a shift of a `u64` looks at.
    const LENGTH_BITS: u32 = 6;
    const LINK: u32 = 16;
    const USUAL: u32 = 0x80;
    /// More than the tree for up to 272 symbols needs after its root.
    const AFTER_ROOT: usize = 512;
    pub const REACH: usize = Root::Bits10 as usize + 1 + Self::AFTER_ROOT;

    #[inline(always)]
    pub fn new(value: u32, length: u32) -> Self {
        Self(((value << Self::LENGTH_BITS) | length) & 0xFFFF)
    }

    #[inline(always)]
    pub fn for_literal(literal: u8, length: u32, is_usual: bool, parts: &ContextParts) -> Self {
        Self(
            parts.literals[usize::from(literal)].0
                | (length % 16)
                | (Self::USUAL * u32::from(is_usual)),
        )
    }

    /// To a table for `bits` more bits, which starts at `table` after the root.
    #[inline(always)]
    pub fn link(table: usize, bits: u32) -> Self {
        Self::new(table as u32, Self::LINK + bits)
    }

    #[inline(always)]
    pub fn is_link(self) -> bool {
        self.0 & Self::LINK != 0
    }

    /// See [`SymbolLists::usual_length`]. [`Machine`] guesses that the next literals have it, too.
    #[inline(always)]
    pub fn has_usual_length(self) -> bool {
        self.0 & (Self::USUAL | Self::LINK) == Self::USUAL
    }

    #[inline(always)]
    pub fn value(self) -> u32 {
        self.0 >> Self::LENGTH_BITS
    }

    #[inline(always)]
    pub fn length(self) -> u32 {
        self.0 % (1 << Self::LENGTH_BITS)
    }

    /// The value and the length in a tree of literals.
    #[inline(always)]
    pub fn literal(self) -> (u8, u32) {
        ((self.0 >> 8) as u8, self.length())
    }

    #[inline(always)]
    pub fn context_parts(self) -> [u32; 2] {
        [self.0 >> 24, (self.0 >> 16) & 0xFF]
    }

    #[inline(always)]
    pub fn in_root(tree: &SymbolTree, root: Root, bits: u64) -> Self {
        tree[(bits as u32 & root as u32) as usize]
    }

    /// Follows the link, if that is what `bits` led to in the root.
    #[inline(always)]
    pub fn resolve(self, tree: &SymbolTree, root: Root, bits: u64) -> Self {
        if !self.is_link() {
            return self;
        }
        core::hint::cold_path();
        let rest = (bits as u32 >> root.bits()) & ((1 << (self.0 % Self::LINK)) - 1);
        tree[root as usize + 1 + (self.value() + rest) as usize % Self::AFTER_ROOT]
    }
}

/// In place of the length of an entry with extra bits.
const LINK: u8 = 0x80;

/// An entry that waits for the length of its code.
#[derive(Clone, Copy)]
pub struct Uncoded<E>(E);

/// An insert length and a copy length.
#[derive(Clone, Copy, Default)]
#[repr(C, align(8))]
pub struct Command([u8; 8]);

#[allow(clippy::trivially_copy_pass_by_ref)] // Loading a field from the table is faster than extracting it.
impl Command {
    /// In place of a distance context.
    pub const LAST_DISTANCE: u32 = 4;
    const MIN_COPY: u16 = 2;

    /// The first six insert codes are the length.
    pub const fn new(
        insert_code: u8,
        [insert_bits, copy_bits]: [u8; 2],
        min_copy: u16,
        distance_context: u8,
    ) -> Uncoded<Self> {
        assert!(insert_code < 32 && insert_bits <= 24 && copy_bits <= 24 && distance_context <= 4);
        let handler = match insert_code as usize {
            few @ ..MIN_ROOM if copy_bits <= 5 => few + MIN_ROOM * (distance_context as usize / 4),
            _ => 2 * MIN_ROOM,
        };
        let [a, b] = (min_copy - Self::MIN_COPY).to_le_bytes();
        let [c, d] = HANDLERS[handler].to_le_bytes();
        let (total, context) = (insert_bits + copy_bits, 8 * distance_context);
        Uncoded(Self([total, insert_bits, insert_code, context, a, b, c, d]))
    }

    #[inline(always)]
    pub fn link(table: usize, bits: u32) -> Self {
        let [low, a, b, _] = (table as u32).to_le_bytes();
        let [c, d] = HANDLERS[2 * MIN_ROOM + 1].to_le_bytes();
        Self([LINK, bits as u8 % 16, low, 0, a, b, c, d])
    }

    /// With the extra bits, or too much for a link.
    #[inline(always)]
    pub fn total_length(&self) -> u32 {
        u32::from(self.0[0])
    }

    /// Where the extra bits of the insert length end, and those of the copy length start.
    #[inline(always)]
    pub fn insert_end(&self) -> u32 {
        u32::from(self.0[1])
    }

    #[inline(always)]
    pub fn insert_code(&self) -> u8 {
        self.0[2]
    }

    #[inline(always)]
    pub fn distance_context(&self) -> u32 {
        u32::from(self.0[3] / 8)
    }

    #[inline(always)]
    pub fn min_copy(&self) -> u32 {
        u32::from(u16::from_le_bytes([self.0[4], self.0[5]])) + u32::from(Self::MIN_COPY)
    }

    /// `self` is from the root that `tree` starts with.
    #[inline(always)]
    pub fn resolve<'a>(&'a self, tree: &'a [Self], root: Root, bits: u64) -> Option<&'a Self> {
        let [LINK, more_bits, low, _, a, b, ..] = self.0 else {
            return Some(self);
        };
        let rest = (bits >> root.bits()) as usize & ((1 << (more_bits % 16)) - 1);
        tree.get(root as usize + 1 + u32::from_le_bytes([low, a, b, 0]) as usize + rest)
    }
}

impl Uncoded<Command> {
    #[inline(always)]
    pub fn with_code_length(self, length: u32) -> Command {
        Command((u64::from_le_bytes(self.0.0) + u64::from(length % 16 * 0x0101)).to_le_bytes())
    }
}

/// A number to add to the extra bits, and maybe to one of the last distances. The root is [`Root::Bits8`].
#[derive(Clone, Copy, Default)]
#[repr(C, align(8))]
pub struct Distance([u8; 8]);

#[allow(clippy::trivially_copy_pass_by_ref)] // Loading a field from the table is faster than extracting it.
impl Distance {
    const REPEAT: u8 = 0x40;
    /// The place after the last four distances, which holds zero.
    const NO_BASE: u8 = 4;

    #[inline(always)]
    const fn from_fields(bytes: [u8; 4], addend: u32) -> Self {
        Self((((addend as u64) << 32) | u32::from_le_bytes(bytes) as u64).to_le_bytes())
    }

    #[inline(always)]
    pub const fn new(extra_bits: u32, lowest: u32) -> Uncoded<Self> {
        let bytes = [extra_bits as u8 % 32, Self::NO_BASE, 0, 0];
        Uncoded(Self::from_fields(bytes, lowest))
    }

    /// `age` is zero for the last distance.
    pub const fn from_recent(age: u8, delta: i8) -> Uncoded<Self> {
        let flag = Self::REPEAT * (age == 0 && delta == 0) as u8;
        let bytes = [flag, 3 - age % 4, 0, 0];
        Uncoded(Self::from_fields(bytes, delta as u32))
    }

    #[inline(always)]
    pub fn link(table: usize, bits: u32) -> Self {
        Self::from_fields([LINK, 0, bits as u8 % 16, 0], table as u32)
    }

    /// With the extra bits, or too much for a link.
    #[inline(always)]
    pub fn total_length(&self) -> u32 {
        u32::from(self.0[0] & !Self::REPEAT)
    }

    #[inline(always)]
    pub fn code_length(&self) -> u32 {
        u32::from(self.0[2])
    }

    #[inline(always)]
    pub fn is_repeat(&self) -> bool {
        self.0[0] & Self::REPEAT != 0
    }

    #[inline(always)]
    pub fn age(&self) -> Option<u8> {
        3u8.checked_sub(self.0[1])
    }

    #[inline(always)]
    pub fn addend(&self) -> u32 {
        let [.., a, b, c, d] = self.0;
        u32::from_le_bytes([a, b, c, d])
    }

    /// `self` is from the root that `tree` starts with.
    #[inline(always)]
    pub fn resolve<'a>(&'a self, tree: &'a [Self], bits: u64) -> Option<&'a Self> {
        let [LINK, _, more_bits, ..] = self.0 else {
            return Some(self);
        };
        let rest = (bits >> Root::Bits8.bits()) as usize & ((1 << (more_bits % 16)) - 1);
        tree.get(Root::Bits8 as usize + 1 + self.addend() as usize + rest)
    }
}

impl Uncoded<Distance> {
    #[inline(always)]
    pub fn with_code_length(self, length: u32) -> Distance {
        Distance((u64::from_le_bytes(self.0.0) + u64::from(length % 16 * 0x01_0001)).to_le_bytes())
    }
}

/// A symbol of the code for code lengths: a length, or else a repeat of the last one or of zero.
#[derive(Clone, Copy)]
#[repr(C, align(8))]
pub struct CodeLength {
    total_length: u8,
    extra_mask: u8,
    length: u8,
    min_more: u8,
    code_length: u8,
    extra_bits: u8,
}

impl CodeLength {
    pub const fn new(symbol: u8, code_length: u8) -> Self {
        assert!(symbol < 18 && code_length <= 5);
        let (length, extra_bits, min_more) = match symbol {
            ..16 => (symbol, 0, 0),
            _ => (0, symbol - 14, 2),
        };
        Self {
            total_length: code_length + extra_bits,
            extra_mask: (1 << extra_bits) - 1,
            length,
            min_more,
            code_length,
            extra_bits,
        }
    }
}

/// How far reading them got.
#[derive(Clone, Copy)]
struct Lengths {
    next: usize,
    /// From the top: `next` plus what the alphabet lacks to `FULL_ALPHABET`, the number of codes, and the space they take.
    sums: u64,
    last_length: u32,
    last_mask: u32,
    /// Two less than what the last repeats of the same kind add up to.
    run: u32,
}

impl Lengths {
    /// A length, and for how many symbols.
    #[inline(always)]
    #[allow(clippy::trivially_copy_pass_by_ref)] // Loading a field from the table is faster than extracting it.
    fn decode(&mut self, entry: &CodeLength, bits: u64) -> (usize, u32) {
        let (length, mask) = (u32::from(entry.length), u32::from(entry.extra_mask));
        let goes_on = core::mem::replace(&mut self.last_mask, mask) == mask;
        let more =
            select_unpredictable(goes_on, self.run.wrapping_mul(mask), entry.min_more.into());
        let count = more + ((bits >> entry.code_length) as u32 & mask) + 1;
        self.run = select_unpredictable(goes_on, self.run, FOR_LENGTHS.no_run as u32);
        self.run = self.run.wrapping_add(count);
        let length = select_unpredictable(mask == 3, self.last_length, length);
        self.last_length = select_unpredictable(length != 0, length, self.last_length);
        (length as usize % 16, count)
    }
}

/// The symbols of a prefix code, in one list for each length.
#[repr(C)]
pub struct SymbolLists {
    pub code_lengths: [CodeLength; 32],
    ends: [u16; 16],
    lengths: Lengths,
    /// Initialized from each of `STARTS` but the first to its end.
    symbols: [MaybeUninit<u16>; Self::STARTS[16] as usize],
}

#[repr(C)]
struct ForLengths {
    /// What a symbol adds to [`Lengths::sums`].
    addends: [u64; 16],
    long_run: u64,
    full: u64,
    no_run: i32,
    low_six_bits: u32,
    numbers: [u16; SymbolLists::MAX_SYMBOLS + SymbolLists::SHORT_RUN],
}

static FOR_LENGTHS: ForLengths = {
    let (mut addends, mut numbers, mut i) = ([1 << 48; _], [0; _], 1);
    while i < numbers.len() {
        numbers[i] = i as u16;
        if i < addends.len() {
            addends[i] |= (1 << 32) | (SymbolLists::SPACE as u64 >> i);
        }
        i += 1;
    }
    ForLengths {
        addends,
        long_run: (0x1_0000 - SymbolLists::SHORT_RUN as u64) << 32,
        full: (SymbolLists::FULL_ALPHABET.wrapping_neg() << 48) | !(SymbolLists::SPACE - 1) as u64,
        no_run: -2,
        low_six_bits: 63,
        numbers,
    }
};

impl SymbolLists {
    const MAX_SYMBOLS: usize = 704;
    const FULL_ALPHABET: u64 = 1024;
    const SPACE: u32 = 1 << 15;
    /// So many are written, however short a run is.
    const SHORT_RUN: usize = 16;
    const STARTS: [u16; 17] = {
        let (mut starts, mut length) = ([0; _], 0);
        while length < 16 {
            let room = match 1 << length {
                codes @ 2..Self::MAX_SYMBOLS => codes,
                _ => Self::MAX_SYMBOLS,
            };
            starts[length + 1] = starts[length] + (room + Self::SHORT_RUN) as u16;
            length += 1;
        }
        starts
    };

    pub fn new() -> Option<Box<Self>> {
        let mut lists = Box::<Self>::try_new_uninit().ok()?;
        // SAFETY: zero is valid for all fields before the last one, and makes empty lists that take nothing.
        unsafe {
            (lists.as_mut_ptr().cast::<u8>()).write_bytes(0, offset_of!(Self, symbols));
            let mut lists = lists.assume_init();
            lists.clear(0, 0);
            Some(lists)
        }
    }

    #[inline(always)]
    pub fn clear(&mut self, alphabet_size: u32, last_length: u8) {
        let [starts @ .., _] = Self::STARTS;
        let size = u64::from(alphabet_size).min(Self::MAX_SYMBOLS as u64);
        self.ends = starts;
        self.lengths = Lengths {
            next: 0,
            sums: (Self::FULL_ALPHABET - size) << 48,
            last_length: u32::from(last_length % 16),
            last_mask: 0,
            run: 0,
        };
    }

    #[inline(always)]
    pub fn of_length(&self, length: u32) -> impl ExactSizeIterator<Item = u32> {
        let length = (length as usize % 16).max(1);
        let range = usize::from(Self::STARTS[length])..usize::from(self.ends[length]);
        // SAFETY: see the field.
        let symbols = unsafe { self.symbols.get_unchecked(range).assume_init_ref() };
        symbols.iter().map(|&symbol| u32::from(symbol))
    }

    /// Of the space of all codes, for those that are too long for `root`.
    #[inline(always)]
    pub fn percent_beyond(&self, root: Root) -> u32 {
        let share = |length| (self.of_length(length).len() as u32) << (15 - length);
        (root.bits() + 1..16).map(share).sum::<u32>() / (Self::SPACE / 100)
    }

    /// That of nearly all symbols, up to eight, or else zero.
    #[inline(always)]
    pub fn usual_length(&self) -> u32 {
        let is_usual = |length| self.of_length(length).len() << (8 - length) >= 224;
        (1..=8).map(|it| it * u32::from(is_usual(it))).sum()
    }

    /// The code for it is incomplete with one bit, and needs none.
    #[inline(always)]
    pub fn only_symbol(&self) -> Option<u32> {
        (self.of_length(1).next()).filter(|_| self.lengths.sums as u32 == Self::SPACE / 2)
    }

    /// In place of reading lengths. The symbols of a length are in ascending order.
    #[inline(always)]
    pub fn set(&mut self, lengths: [u8; 4], symbols: [u32; 4]) {
        self.clear(0, 0);
        for (length, symbol) in lengths.into_iter().zip(symbols) {
            let length = usize::from(length % 4);
            self.symbols[usize::from(self.ends[length])].write(symbol as u16);
            self.ends[length] += 1;
            self.lengths.sums += FOR_LENGTHS.addends[length];
        }
    }

    /// With more than there is space for, the lists are of no use.
    #[inline(always)]
    fn push_run(&mut self, length: usize, count: u32) {
        let (length, first) = (length % 16, self.lengths.next);
        let added = u64::from(count).wrapping_mul(FOR_LENGTHS.addends[length]);
        self.lengths.sums = self.lengths.sums.wrapping_add(added);
        self.lengths.next = first.wrapping_add(count as usize);
        let codes = usize::from((added >> 32) as u16);
        let at = usize::from(self.ends[length]);
        let mut write = |count| {
            let numbers = FOR_LENGTHS.numbers.get(first..)?.get(..count)?;
            self.symbols
                .get_mut(at..at + count)?
                .write_copy_of_slice(numbers);
            self.ends[length] = (at + codes) as u16;
            Some(())
        };
        if codes < Self::SHORT_RUN {
            write(Self::SHORT_RUN);
        } else {
            core::hint::cold_path();
            write(codes);
        }
    }

    /// `None` if there are more lengths to read.
    #[inline(always)]
    fn is_complete(&self) -> Option<bool> {
        let (end, is_filled) = (
            self.lengths.sums >> 48,
            self.lengths.sums as u32 == Self::SPACE,
        );
        (is_filled || end >= Self::FULL_ALPHABET).then_some(is_filled && end <= Self::FULL_ALPHABET)
    }

    #[inline(always)]
    pub fn bits_for_length(&self, bits: u64) -> u32 {
        u32::from(self.code_lengths[bits as usize % 32].total_length)
    }

    /// Returns whether the code is complete, if that was the last length.
    #[inline(always)]
    pub fn push_length(&mut self, bits: u64) -> Option<bool> {
        if self.lengths.sums >> 48 >= Self::FULL_ALPHABET {
            return Some(false);
        }
        let (length, count) = (self.lengths).decode(&self.code_lengths[bits as usize % 32], bits);
        self.push_run(length, count);
        self.is_complete()
    }

    /// The same for as many as it can read quickly.
    #[inline(never)]
    pub fn read_lengths(&mut self, input: &mut Input<'_>) -> Option<bool> {
        while self.lengths.sums & FOR_LENGTHS.full == 0 && input.bytes.len() >= WORD {
            // SAFETY: just checked.
            if let (length, long_run @ 1..) = unsafe { self.read_short_runs(input) } {
                self.push_run(length, long_run);
            }
        }
        self.is_complete()
    }

    /// Returns the long run that it stopped at, if any.
    ///
    /// # Safety
    /// There is a word of input. No sum is full: until then, `next` is in the alphabet and each list has room for a short run.
    #[inline(always)]
    unsafe fn read_short_runs(&mut self, input: &mut Input<'_>) -> (usize, u32) {
        #[cfg(all(target_arch = "x86_64", not(miri)))]
        if Machine::is_available() {
            let last = input.bytes.len() - WORD;
            let start = input.bytes.as_ptr();
            let (next, length, long_run): (*const u8, usize, u32);
            // SAFETY: the CPU has the features, and it does the same as the loop below.
            unsafe {
                core::arch::asm!(
                    include_str!("brotli_lengths_x64.s"),
                    ends = const offset_of!(Self, ends),
                    symbols = const offset_of!(Self, symbols),
                    long_run = const offset_of!(ForLengths, long_run),
                    full = const offset_of!(ForLengths, full),
                    no_run = const offset_of!(ForLengths, no_run),
                    low_six_bits = const offset_of!(ForLengths, low_six_bits),
                    numbers = const offset_of!(ForLengths, numbers),
                    in("rdi") &raw mut *self,
                    in("rsi") &raw const FOR_LENGTHS,
                    inout("rax") start.addr() + last => length,
                    out("rcx") _,
                    out("rdx") long_run,
                    inout("r8") input.bits,
                    inout("r9") input.bit_count,
                    inout("r10") start => next,
                    inout("r11") self.lengths.next,
                    inout("r12") self.lengths.sums,
                    inout("r13") self.lengths.last_length,
                    inout("r14") self.lengths.last_mask,
                    inout("r15") self.lengths.run,
                    clobber_abi("C"),
                );
            }
            input.bytes = &input.bytes[next.addr() - start.addr()..];
            return (length, long_run);
        }
        let (mut rest, mut lengths, mut long_run) = (*input, self.lengths, (0, 0));
        'all: while let Some(word) = rest.bytes.first_chunk() {
            let count = rest.bit_count % u64::BITS;
            rest.bits |= u64::from_le_bytes(*word) << count;
            rest.bytes = &rest.bytes[(count as usize ^ 63) / 8..];
            rest.bit_count = count | 56;
            for _ in 0..7 {
                let entry = &self.code_lengths[rest.bits as usize % 32];
                let (length, count) = lengths.decode(entry, rest.bits);
                rest.bits >>= entry.total_length;
                rest.bit_count -= u32::from(entry.total_length);
                let added = u64::from(count) * FOR_LENGTHS.addends[length];
                if added & FOR_LENGTHS.long_run != 0 {
                    long_run = (length, count);
                    break 'all;
                }
                // SAFETY: see above.
                unsafe {
                    let numbers = FOR_LENGTHS.numbers.as_ptr().add(lengths.next);
                    let end = (self.symbols.as_mut_ptr()).add(usize::from(self.ends[length]));
                    numbers.copy_to_nonoverlapping(end.cast(), Self::SHORT_RUN);
                }
                self.ends[length] += count as u16;
                lengths.next += count as usize;
                lengths.sums += added;
                if lengths.sums & FOR_LENGTHS.full != 0 {
                    break 'all;
                }
            }
        }
        (*input, self.lengths) = (rest, lengths);
        long_run
    }
}

/// What a reference does to a word of the static dictionary.
#[derive(Clone, Copy)]
#[repr(C, align(32))]
pub struct Transform {
    pub prefix: [u8; 8],
    pub suffix: [u8; 8],
    pub prefix_length: u8,
    pub suffix_length: u8,
    pub skipped: u8,
    pub omitted: u8,
    /// Up to so many characters.
    pub uppercased: u8,
}

pub const TRANSFORMS: usize = 121;

/// The tables that are the same for all streams.
#[repr(C, align(64))]
pub struct Format {
    /// The number of extra bits, and below it the lowest length.
    inserts: [u32; 32],
    /// Where the words of a length start, and below it the number of bits for an index.
    word_lengths: [u32; 32],
    transforms: [Transform; TRANSFORMS],
    /// The remainders of a division by a short distance, and how far whole periods go.
    patterns: [[u8; 32]; 16],
    pattern_steps: [u8; 16],
    words: &'static [u8],
}

impl Format {
    pub const fn new(
        insert_codes: &[(u16, u8); 24],
        words: &'static [u8],
        index_bits_by_length: [u8; 32],
        &transforms: &[Transform; TRANSFORMS],
    ) -> Self {
        let mut format = Self {
            inserts: [0; _],
            word_lengths: [0; _],
            transforms,
            patterns: [[0; _]; _],
            pattern_steps: [0; _],
            words,
        };
        let mut i = 0;
        while i < insert_codes.len() {
            format.inserts[i] = ((insert_codes[i].1 as u32) << 16) | insert_codes[i].0 as u32;
            i += 1;
        }
        let (mut length, mut start) = (4, 0);
        while length <= 24 {
            let bits = index_bits_by_length[length] as u32;
            assert!(bits <= 11);
            format.word_lengths[length] = (start << 8) | bits;
            start += (length as u32) << bits;
            length += 1;
        }
        i = 0;
        while i < TRANSFORMS {
            let it = &transforms[i];
            assert!(it.prefix_length <= 8 && it.suffix_length <= 8);
            // 32 bytes, from within a word of four or more.
            assert!(start as usize - 4 + it.skipped as usize + 32 <= words.len());
            i += 1;
        }
        i = 32;
        while i < 16 * 32 {
            format.patterns[i / 32][i % 32] = (i % 32 % (i / 32)) as u8;
            format.pattern_steps[i / 32] = (32 - 32 % (i / 32)) as u8;
            i += 1;
        }
        format
    }

    /// The lowest length and the number of extra bits.
    #[inline(always)]
    pub fn insert(&self, code: u8) -> [u32; 2] {
        let both = self.inserts[usize::from(code) % 32];
        [both & 0xFFFF, both >> 16]
    }
}

/// What is the same for all blocks of a meta-block.
#[derive(Clone, Copy)]
pub struct MetaBlock<'a> {
    pub format: &'static Format,
    pub context_parts: &'static ContextParts,
    pub literal_root: Root,
    pub command_root: Root,
    pub commands: &'a [Command],
    pub distances: &'a [Distance],
    /// What the extra bits of a distance are multiplied by.
    pub distance_step: u32,
    pub max_backward_distance: usize,
    /// Empty, or with [`SLACK`] more bytes.
    pub padded_dictionary: &'a [u8],
    pub destination: Destination,
    pub owner: Frame,
}

#[derive(Clone, Copy)]
pub struct Input<'i> {
    pub bytes: &'i [u8],
    /// Above `bit_count`, which is below 64, is zero or the start of `bytes`.
    pub bits: u64,
    pub bit_count: u32,
}

/// What commands change.
pub struct Progress<'i> {
    pub input: Input<'i>,
    pub position: usize,
    /// Of the blocks of literals, commands and distances.
    pub remaining: [u32; 3],
    /// The last one last.
    pub recent: [u32; 4],
}

/// What is left of the last command.
pub enum Unfinished {
    Nothing,
    Literals {
        count: u32,
        distance_context: u32,
        copy_length: u32,
    },
    Copy {
        distance: u32,
        is_repeat: bool,
        length: u32,
    },
}

/// How many commands there is room for in [`Machine::history`].
const BATCH: usize = 1024;

/// What the assembly works with. All pointers come from references that outlive a run.
#[repr(C, align(64))]
pub struct Machine<'a> {
    // Within the reach of a one-byte offset from `frame`.
    last_input: *const u8,
    limit: *mut u8,
    near: *mut u8,
    history_end: *mut u32,
    handlers: usize,
    extra_bits: u64,
    command_mask: u32,
    literal_mask: u32,
    distance_step: u32,
    low_six_bits: u32,
    literals_left: u32,
    without_distance: u32,
    distance_trees: [*const Distance; 5],
    format: &'static Format,
    max_backward_distance: usize,
    frame: Frame,
    to_destination: usize,
    origin: *mut u8,
    dictionary_len: usize,
    transform_count: usize,
    words: *const u8,
    command: u64,
    /// More literals in a row are left to the caller.
    pub max_insert: u32,
    command_bits: u32,
    literal_bits: u32,
    variant: u32,
    /// What makes a literal special, and for how many more wrong guesses.
    special: u32,
    credit: i32,
    start: *mut u8,
    lap: usize,
    dictionary_end: *const u8,
    commands_end: *const Command,
    distances_end: *const Distance,
    command_tree: *const Command,

    bits: u64,
    bit_count: u64,
    input: *const u8,
    output: *mut u8,
    last_bytes: [u8; 2],
    last_distance: *mut u32,
    copy_length: u32,
    value: u32,
    /// Initialized if `parts_to_copy` is `None`, as are the trees after the first.
    context_parts: MaybeUninit<[[u8; 256]; 2]>,
    literal_trees: MaybeUninit<[&'a SymbolTree; ContextParts::END]>,
    parts_to_copy: Option<&'static ContextParts>,
    /// Runs that took some of the zeros after the input, and so did not count.
    overruns: u32,
    /// Up to which the input may well be enough for the meta-block.
    max_ratio: usize,
    commands: &'a [Command],
    distances: &'a [Distance],
    in_contexts: [bool; 2],
    destination: Destination,
    /// Distances are appended, each with a zero after it.
    history: MaybeUninit<[u32; BATCH + 5]>,
}

impl<'a> Machine<'a> {
    #[inline(always)]
    pub fn is_available() -> bool {
        cfg_select! {
            miri => false,
            target_arch = "x86_64" => {
                is_x86_feature_detected!("avx2")
                    && is_x86_feature_detected!("bmi1")
                    && is_x86_feature_detected!("bmi2")
            }
            _ => cfg!(target_arch = "aarch64"),
        }
    }

    #[inline(always)]
    pub fn begin(
        place: &mut Option<Self>,
        of: &MetaBlock<'a>,
        literals: &'a SymbolTree,
    ) -> Option<()> {
        const MAX_DISTANCE_BEFORE_WORDS: usize = 0x7F00_0000;
        let dictionary_len = of.padded_dictionary.len().saturating_sub(SLACK);
        let has_words = dictionary_len + of.max_backward_distance < MAX_DISTANCE_BEFORE_WORDS;
        of.commands.get(of.command_root as usize)?;
        of.distances.get(Root::Bits8 as usize)?;
        Self::is_available().then_some(())?;
        let machine = place.insert(Self {
            last_input: core::ptr::null(),
            limit: core::ptr::null_mut(),
            near: core::ptr::null_mut(),
            history_end: core::ptr::null_mut(),
            handlers: 0,
            extra_bits: 0,
            command_mask: of.command_root as u32,
            literal_mask: of.literal_root as u32,
            distance_step: of.distance_step,
            low_six_bits: 63,
            literals_left: 0,
            without_distance: 0,
            distance_trees: [of.distances.as_ptr(); _],
            format: of.format,
            max_backward_distance: of.max_backward_distance,
            frame: of.owner,
            to_destination: 0,
            origin: core::ptr::null_mut(),
            dictionary_len,
            transform_count: if has_words { TRANSFORMS } else { 0 },
            words: of.format.words.as_ptr(),
            command: 0,
            max_insert: 0,
            command_bits: of.command_root.bits(),
            literal_bits: of.literal_root.bits(),
            variant: 0,
            special: 0,
            credit: 0,
            start: core::ptr::null_mut(),
            lap: 0,
            dictionary_end: of.padded_dictionary.as_ptr().wrapping_add(dictionary_len),
            commands_end: of.commands.as_ptr_range().end,
            distances_end: of.distances.as_ptr_range().end,
            command_tree: of.commands.as_ptr(),
            bits: 0,
            bit_count: 0,
            input: core::ptr::null(),
            output: core::ptr::null_mut(),
            last_distance: core::ptr::null_mut(),
            last_bytes: [0; _],
            copy_length: 0,
            value: 0,
            context_parts: MaybeUninit::uninit(),
            literal_trees: MaybeUninit::uninit(),
            parts_to_copy: Some(of.context_parts),
            overruns: 0,
            max_ratio: 5,
            commands: of.commands,
            distances: of.distances,
            destination: of.destination,
            in_contexts: [false; 2],
            history: MaybeUninit::uninit(),
        });
        machine.set_literal_tree(literals);
        Some(())
    }

    #[inline(always)]
    pub fn set_literal_tree(&mut self, tree: &'a SymbolTree) {
        // SAFETY: the first element of the array.
        unsafe {
            self.literal_trees
                .as_mut_ptr()
                .cast::<&SymbolTree>()
                .write(tree)
        };
        self.in_contexts[0] = false;
        (self.special, self.credit) = (Symbol::LINK | Symbol::USUAL, 8);
    }

    /// To be filled in, for each sum of [`ContextParts`].
    #[inline(always)]
    pub fn set_literal_trees(
        &mut self,
        first: &'a SymbolTree,
    ) -> &mut [&'a SymbolTree; ContextParts::END] {
        self.set_literal_tree(first);
        if let Some(parts) = self.parts_to_copy.take() {
            self.context_parts.write(parts.by_byte);
            self.literal_trees.write([first; _]);
        }
        self.in_contexts[0] = true;
        // SAFETY: see the field.
        unsafe { self.literal_trees.assume_init_mut() }
    }

    #[inline(always)]
    pub fn literal_trees(&self) -> Option<&[&'a SymbolTree; ContextParts::END]> {
        // SAFETY: after `set_literal_trees`.
        self.in_contexts[0].then(|| unsafe { self.literal_trees.assume_init_ref() })
    }

    #[inline(always)]
    pub fn set_command_tree(&mut self, start: usize) -> Option<()> {
        let tree = self.commands.get(start..)?;
        tree.get(self.command_mask as usize)?;
        self.command_tree = tree.as_ptr();
        Some(())
    }

    /// The roots come first.
    #[inline(always)]
    pub fn set_distance_trees(&mut self, indexes: [u8; 4]) -> Option<()> {
        let roots = self.distances.as_chunks::<256>().0;
        for (slot, index) in self.distance_trees.iter_mut().zip(indexes) {
            roots.get(usize::from(index))?;
            *slot = self
                .distances
                .as_ptr()
                .wrapping_add(256 * usize::from(index));
        }
        let indexes = u32::from_le_bytes(indexes);
        self.in_contexts[1] = indexes != indexes.rotate_left(8);
        Some(())
    }

    /// Whether it is worth a try with so much input, and so much output until the end of the meta-block.
    #[inline(always)]
    pub fn can_run(&self, input_len: usize, until_end: usize) -> bool {
        input_len >= MIN_INPUT || self.last_in_padded(input_len, until_end).is_some()
    }

    /// Where the last command may begin, in an input with zeros after it.
    #[inline(always)]
    fn last_in_padded(&self, input_len: usize, until_end: usize) -> Option<usize> {
        match self.overruns {
            0 if until_end <= self.max_ratio * (input_len + WORD) => Some(input_len + WORD),
            0 | 1 => input_len.checked_sub(5),
            _ => None,
        }
    }

    /// Decodes what is clear of all ends, but a word may get past `limit`. What came before `window` ends at `lap`. `None` if a link is broken.
    #[inline(never)]
    pub fn run(
        &mut self,
        progress: &mut Progress<'_>,
        window: &mut [u8],
        [limit, lap, meta_block_end]: [usize; 3],
        only_literals: bool,
    ) -> Option<Unfinished> {
        /// With less, it is too hard to predict which distances need a closer look.
        const LARGE_WINDOW: usize = 1 << 17;
        window.get(limit.max(lap)..)?.get(..SLACK)?;
        let start = window.as_mut_ptr();
        let near = match limit.saturating_sub(self.max_backward_distance) {
            1.. if lap == 0 && self.max_backward_distance < LARGE_WINDOW => limit,
            near => near,
        };
        (self.start, self.lap, self.origin) = (start, lap, start.wrapping_sub(lap));
        self.near = start.wrapping_add(near);
        self.variant = u32::from(self.in_contexts[0]) + 2 * u32::from(self.in_contexts[1]);
        let history = self.history.as_mut_ptr().cast::<u32>();

        loop {
            let (position, [literals, commands, distances]) =
                (progress.position, progress.remaining);
            let (mut input, mut limit) = (progress.input.bytes, limit.saturating_sub(MIN_ROOM));
            let mut batch = commands.min(distances).min(BATCH as u32);
            (self.without_distance, self.value, self.to_destination) = (0, 0, 0);
            if let Some(room @ 64..) = self.destination.end.checked_sub(position) {
                self.to_destination =
                    (self.destination.of_position_zero).wrapping_sub(start.addr());
                batch = batch.min(room as u32 / 8);
            }
            let (len, until_end) = (input.len(), meta_block_end.saturating_sub(position));
            if len >= 4 * MIN_INPUT {
                self.max_ratio = 20;
            }
            let mut padded;
            if len < 2 * MIN_INPUT
                && let Some(last) = self.last_in_padded(len, until_end)
            {
                padded = [0; 3 * MIN_INPUT + WORD];
                padded[..len].copy_from_slice(input);
                input = &padded[..last + MIN_INPUT];
                limit = limit.min(position + SPOILT - SLACK - MIN_ROOM);
            }
            if only_literals {
                batch = (literals as usize).min(limit.saturating_sub(position + 1)) as u32;
                self.value = batch;
            }
            let has_context = position >= 2 || lap == 0;
            if batch == 0 || position >= limit || !has_context || input.len() < MIN_INPUT {
                return Some(Unfinished::Nothing);
            }
            (self.bits, self.bit_count) = (progress.input.bits, progress.input.bit_count.into());
            self.input = input.as_ptr();
            self.last_input = input[input.len() - MIN_INPUT..].as_ptr();
            (self.output, self.limit) = (start.wrapping_add(position), start.wrapping_add(limit));
            self.literals_left = literals;
            self.last_distance = history.wrapping_add(3);
            self.history_end = history.wrapping_add(3 + batch as usize);
            // SAFETY: `begin` checked the CPU. Each command begins with `input <= last_input` and reads `MIN_INPUT` bytes at most,
            // checks where its literals, its source and its target end, and appends one distance or lowers `history_end`.
            // Roots are within the tables, links are compared with their ends, and the entries hold what their constructors allow.
            let (exit, recent) = unsafe {
                let [a, b, c, d] = progress.recent;
                history.cast::<[u32; 5]>().write([a, b, c, d.max(1), 0]);
                self.last_bytes = [2, 1].map(|back| match position.checked_sub(back) {
                    Some(at) => start.add(at).read(),
                    None => 0,
                });
                let exit = enter(self);
                (exit, self.last_distance.sub(3).cast::<[u32; 4]>().read())
            };

            let taken = self.input.addr() - input.as_ptr().addr();
            let zeros = 8 * taken.saturating_sub(len) as u32;
            let bit_count = (self.bit_count as u32 % u64::BITS).checked_sub(zeros);
            let is_at_last = self.input > self.last_input;
            let Some(bit_count) = bit_count else {
                self.overruns += if input.len() > len + MIN_INPUT { 1 } else { 2 };
                continue;
            };
            progress.input = Input {
                bytes: &progress.input.bytes[taken.min(len)..],
                bits: self.bits,
                bit_count,
            };
            progress.position = self.output.addr() - start.addr();
            progress.remaining[0] = self.literals_left;
            if only_literals {
                continue;
            }
            let done = batch - ((self.history_end.addr() - self.last_distance.addr()) / 4) as u32;
            progress.remaining[1] -= done;
            progress.remaining[2] -= done - self.without_distance;
            progress.recent = recent;
            return Some(match exit {
                0 => continue,
                1 if is_at_last => continue,
                1 => Unfinished::Nothing,
                2 => Unfinished::Literals {
                    count: self.value,
                    distance_context: Command(self.command.to_le_bytes()).distance_context(),
                    copy_length: self.copy_length,
                },
                3 | 4 => Unfinished::Copy {
                    distance: self.value,
                    is_repeat: exit == 4,
                    length: self.copy_length,
                },
                _ => return None,
            });
        }
    }
}

/// Where the code for each kind of command starts: no to five literals, the same without a distance, the others, and links.
const HANDLERS: [u16; 14] = {
    let sizes = cfg_select! {
        target_arch = "x86_64" => [256, 128, 192, 288, 352, 448, 64, 96, 160, 256, 320, 416, 32],
        _ => [192, 96, 128, 192, 256, 288, 32, 32, 96, 160, 224, 256, 16],
    };
    let (mut starts, mut i) = ([0; _], 0);
    while i < sizes.len() {
        starts[i + 1] = starts[i] + sizes[i];
        i += 1;
    }
    starts
};

#[cfg(not(miri))]
macro_rules! enter {
    ($asm:ident, $file:literal, $own_macros:literal, $bias:expr, [$($field:ident)*], $($operands:tt)*) => {
        core::arch::$asm!(
            include_str!($file),
            cfg_select! {
                target_vendor = "apple" => "brotli_machine Lbrotli_",
                _ => "brotli_machine .Lbrotli_",
            },
            concat!(".irp name, refill, peek_command, peek_distance, select_tree, literal, literal_link, ", $own_macros),
            ".purgem \\name",
            ".endr",
            ".irp name, few_literals, few_literal_links, variant, brotli_machine",
            ".purgem \\name",
            ".endr",
            $($field = const offset_of!(Machine<'_>, $field) as isize - $bias,)*
            h1 = const HANDLERS[1], h2 = const HANDLERS[2], h3 = const HANDLERS[3],
            h4 = const HANDLERS[4], h5 = const HANDLERS[5], h6 = const HANDLERS[6],
            h7 = const HANDLERS[7], h8 = const HANDLERS[8], h9 = const HANDLERS[9],
            h10 = const HANDLERS[10], h11 = const HANDLERS[11], h12 = const HANDLERS[12],
            h13 = const HANDLERS[13],
            word_lengths = const offset_of!(Format, word_lengths),
            transforms = const offset_of!(Format, transforms),
            patterns = const offset_of!(Format, patterns),
            pattern_steps = const offset_of!(Format, pattern_steps),
            $($operands)*
        )
    };
}

/// Naked to tell Windows how to unwind without `rbp`. In this ABI, no vector register is kept.
#[cfg(all(target_arch = "x86_64", not(miri)))]
#[unsafe(naked)]
#[allow(improper_ctypes_definitions)]
#[rustc_align(64)]
unsafe extern "sysv64" fn enter(machine: &mut Machine<'_>) -> u32 {
    enter!(
        naked_asm,
        "brotli_decoder_x64.s",
        "J, begin_literals",
        offset_of!(Machine<'_>, frame) as isize,
        [
            last_input limit near history_end handlers extra_bits command_mask literal_mask distance_step
            low_six_bits literals_left without_distance distance_trees format max_backward_distance origin
            dictionary_len transform_count words command max_insert command_bits literal_bits variant special credit to_destination start
            lap dictionary_end commands_end distances_end command_tree bits bit_count input output
            last_distance last_bytes copy_length value context_parts literal_trees
        ],
        frame = const offset_of!(Machine<'_>, frame),
        windows = const cfg!(windows) as u8,
        enter = sym enter,
    );
}

/// Not inlined, and so its labels exist once.
#[cfg(all(target_arch = "aarch64", not(miri)))]
#[allow(named_asm_labels)]
#[inline(never)]
#[rustc_align(64)]
unsafe fn enter(machine: &mut Machine<'_>) -> u32 {
    const _: () = assert!(
        offset_of!(Machine<'_>, context_parts) + 512 == offset_of!(Machine<'_>, literal_trees)
    );
    let exit;
    // SAFETY: see the caller. It loads pairs of fields, in the order of their declaration.
    unsafe {
        enter!(
            asm,
            "brotli_decoder_arm64.s",
            "align, handler, peek_literal",
            0,
            [
                last_input near history_end command_mask distance_step literals_left without_distance
                distance_trees format origin transform_count words command max_insert command_bits literal_bits
                variant special credit to_destination start dictionary_end commands_end distances_end command_tree bits input last_distance
                last_bytes copy_length value context_parts literal_trees
            ],
            aligns = const !cfg!(windows) as u8,
            in("x0") &raw mut *machine,
            out("x15") exit,
            out("x1") _, out("x2") _, out("x3") _, out("x4") _, out("x5") _, out("x6") _, out("x7") _,
            out("x8") _, out("x9") _, out("x10") _, out("x11") _, out("x12") _, out("x13") _, out("x14") _,
            out("x16") _, out("x17") _, out("x20") _, out("x21") _, out("x22") _, out("x23") _, out("x24") _,
            out("x25") _, out("x26") _, out("x27") _, out("x28") _, out("x30") _,
            out("v0") _, out("v1") _, out("v2") _, out("v3") _,
            options(nostack),
        );
    }
    exit
}

#[cfg(miri)]
unsafe fn enter(_: &mut Machine<'_>) -> u32 {
    1
}
