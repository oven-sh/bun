//! Qualities 2 to 9 of `bun_brotli`, from src/jsc/bindings/highway_brotli_quick.cpp.

use core::ops::Range;
use std::collections::TryReserveError;

unsafe extern "C" {
    fn highway_brotli_quick_index(
        settings: &Settings,
        memory: &Memory,
        input: &RawInput,
        at: usize,
        end: usize,
        state: *mut State,
        scratch: *mut Line,
    );

    fn highway_brotli_quick_parse(
        settings: &Settings,
        memory: &Memory,
        input: &RawInput,
        at: usize,
        end: usize,
        state: *mut State,
        scratch: *mut Line,
    ) -> usize;

    fn highway_brotli_quick_close(
        settings: &Settings,
        memory: &Memory,
        input: &RawInput,
        end: usize,
        state: *mut State,
        scratch: *mut Line,
    );

    fn highway_brotli_quick_write(
        settings: &Settings,
        memory: &Memory,
        state: *mut State,
        scratch: *mut Line,
        length: usize,
        out: *mut u8,
        position: usize,
    ) -> usize;

    fn highway_brotli_quick_looks_binary(bytes: *const u8, length: usize) -> bool;
}

/// How many bytes have to come before what is parsed.
pub const MIN_BEFORE: usize = 32;
/// With so many before it, the first byte is found as well as any other.
pub const PADDING_BEFORE: usize = 160;
/// How many bytes have to come after what is parsed.
pub const PADDING_AFTER: usize = 80;
/// Out of reach whatever a short code adds.
pub const UNKNOWN_DISTANCES: [u32; 4] = [0xFFFF_FFF0; 4];
pub const MAX_META_BLOCK_SIZE: usize = 1 << 24;

pub const WORD_ROW_BITS: u32 = 10;
const TRANSFORMS: u8 = 121;
pub const MAX_WORD_ADDRESS: usize = (TRANSFORMS as usize) << 11;
const WORD_COUNT: usize = 13504;
const DICTIONARY_SIZE: usize = 122_784;

#[repr(C, align(32))]
pub struct Words {
    /// With bit 5 set, by their hash. Each has a bucket.
    pub first_four: [[u32; 8]; 1 << WORD_ROW_BITS],
    /// From the low bits: 14 for the index of the first word, 5 for their number, 5 for how many are longer than eight bytes, and bit 5 of each.
    pub buckets: [[u32; 8]; 1 << WORD_ROW_BITS],
    /// Up to the end of the word. The longest of a bucket come first.
    pub next_four: [u32; WORD_COUNT + 16],
    /// By whether the first letter changes, and by the suffix: without and with it, and the same after a space.
    pub transforms: [[[u8; 4]; 256]; 2],
    /// The length in the low five bits, and above it the index.
    pub packed: [u16; WORD_COUNT + 16],
    pub omit_last: [u8; 16],
}

pub struct Format {
    words: &'static Words,
    dictionary: &'static [u8; DICTIONARY_SIZE + 40],
    contexts: [[[u8; 256]; 2]; 2],
}

impl Format {
    /// `contexts`, for text and for binary data: what the last byte and the one before add.
    pub const fn new(
        words: &'static Words,
        dictionary: &'static [u8; DICTIONARY_SIZE + 40],
        contexts: &[[[u8; 256]; 2]; 2],
    ) -> Self {
        let mut all = contexts.as_flattened().as_flattened();
        while let [first, rest @ ..] = all {
            assert!(*first < 64);
            all = rest;
        }
        let mut all = words.packed.as_slice();
        while let [first, rest @ ..] = all {
            assert!(matches!(*first % 32, 0 | 4..=24));
            all = rest;
        }
        let mut all = words.transforms.as_flattened().as_flattened();
        while let [first, rest @ ..] = all {
            assert!(*first < TRANSFORMS && words.omit_last[rest.len() % 16] < TRANSFORMS);
            all = rest;
        }
        Self {
            words,
            dictionary,
            contexts: *contexts,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Settings {
    pub table_bits: [u32; 3],
    /// How many bytes each table hashes.
    pub grams: [u32; 3],
    pub table_count: u32,
    /// Of the table for what is far back. Zero for none.
    pub landmark_bits: u32,
    /// Of the table of the places where matches have ended, or 0.
    pub seam_bits: u32,
    /// To look at one in so many positions. Zero for all.
    pub sparsity: u32,
    /// With less in 4 KiB, it looks at few positions until it finds more.
    pub few_matches: u32,
    /// How many tries of the last distances a success is worth.
    pub repeat_gain: u32,
    /// The search for words ends if it finds less than one for 16 of these in 4 KiB.
    pub word_toll: u32,
    /// The quarters of a bit that an attempt to join matches has to save.
    pub join_toll: u32,
    /// Of the largest distance that can be found.
    pub position_bits: u32,
    pub max_backward: u32,
    /// How far the first word is past the window.
    pub first_word: u32,
    /// For text, for binary data and for short meta-blocks.
    pub postfix_bits: [u32; 3],
    pub direct_codes: u32,
    pub distance_symbols: [u32; 3],
    pub distance_symbol_bits: [u32; 3],
    /// For literals.
    pub max_trees: u32,
    /// On average, for more than one tree.
    pub min_insert: u32,
    /// How many bits it is worth not to build a code.
    pub haste: u32,
    /// In hundredths of a bit for each byte, from which a meta-block is stored as is.
    pub max_size: u32,
}

impl Settings {
    fn table_sizes(&self) -> impl Iterator<Item = usize> {
        let used = self.table_bits.into_iter().take(self.table_count as usize);
        let all = [self.landmark_bits, self.seam_bits].into_iter().chain(used);
        all.map(|bits| (1 << bits) + 16)
    }

    fn reach_past_window(&self, by: usize) -> bool {
        let past = (self.max_backward - self.direct_codes) as usize + by - 1;
        let mut kinds = self.postfix_bits.into_iter().zip(self.distance_symbols);
        past < 0x7FFF_FF00
            && kinds.all(|(postfix_bits, symbols)| {
                let high = (past as u32 >> postfix_bits) + 4;
                let bits = high.ilog2() - 1;
                let groups = 2 * bits + (high >> bits) - 3;
                16 + self.direct_codes + (groups << postfix_bits) <= symbols
            })
    }

    fn are_valid(&self) -> bool {
        let [a, b, c] = self.grams;
        (1..=3).contains(&self.table_count)
            && self.table_bits.iter().all(|&bits| bits <= 24)
            && self.landmark_bits.max(self.seam_bits) <= 24
            && (3..=8).contains(&a)
            && ((a..=24).contains(&b) && (a..=24).contains(&c))
            && self.join_toll < 256
            && matches!(self.sparsity, 0 | 3..=5)
            && (12..=30).contains(&self.position_bits)
            && (1 << 9..1 << 30).contains(&self.max_backward)
            && (self.postfix_bits.iter().all(|&bits| bits <= 3) && self.direct_codes <= 120)
            && self.distance_symbols.iter().all(|&count| count <= 544)
            && self.distance_symbol_bits.iter().all(|&bits| bits <= 11)
            && self.reach_past_window(0)
            && (1..=8).contains(&self.max_trees)
            && self.min_insert <= 1 << 10
    }
}

/// Offsets refer to `bytes`.
#[derive(Clone, Copy)]
pub struct Input<'a> {
    pub bytes: &'a [u8],
    /// The first byte that may be copied.
    pub origin: usize,
    /// Zero unless a dictionary starts at the origin.
    pub dictionary_end: usize,
    /// What to add to an offset for the position in the stream.
    pub base: u64,
    pub stream_offset: u32,
}

#[repr(C)]
struct RawInput {
    bytes: *const u8,
    size: usize,
    origin: usize,
    dictionary_end: usize,
    base: u64,
    stream_offset: u32,
}

impl Input<'_> {
    fn raw(&self) -> RawInput {
        assert!(self.bytes.len() < 1 << 31 && self.stream_offset <= 1 << 30);
        RawInput {
            bytes: self.bytes.as_ptr(),
            size: self.bytes.len(),
            origin: self.origin,
            dictionary_end: self.dictionary_end,
            base: self.base,
            stream_offset: self.stream_offset,
        }
    }

    fn has_padding(&self, range: &Range<usize>) -> bool {
        MIN_BEFORE.max(self.origin) <= range.start
            && range.start <= range.end
            && range.end <= self.bytes.len().saturating_sub(PADDING_AFTER)
    }
}

#[repr(C)]
struct Memory {
    tables: [*mut u32; 5],
    commands: *mut u64,
    distances: *mut u64,
    literal_ends: *mut u16,
    literals: *mut u32,
    packed: *mut u8,
    words: *const Words,
    dictionary: *const u8,
    contexts: *const u8,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Mark {
    commands: u32,
    literals: u32,
    covered: u32,
}

/// The counts follow it.
#[repr(C, align(64))]
#[derive(Clone, Copy, Default)]
struct State {
    now: Mark,
    settled: Mark,
    held: [u32; 3],
    is_ready: u32,
    is_binary: u32,
    is_barren: u32,
    literal_cost: i32,
    settled_bits: i32,
    favorite: u32,
    trust: u32,
    word_credit: u32,
    stride: u32,
    indexed: u32,
    kind: u16,
    table_bits: u16,
    last: [u32; 4],
}

#[repr(C, align(64))]
struct Line([u8; 64]);

const STATE_LINES: usize = size_of::<State>() / size_of::<Line>();
const COUNTS_LINES: usize = 84;
const SCRATCH_LINES: usize = 3210;
/// `kMaxWeight`, what one step adds to it, and the bytes at both ends of the input that are not parsed.
const MAX_SYMBOLS: usize = 48000 + 8192;

/// A meta-block that is ready.
pub struct Ready {
    pub end: usize,
    pub is_compressible: bool,
}

/// Memory for the next [`Compressor`].
#[derive(Default)]
pub struct Spare {
    tables: Vec<u32>,
    work: Vec<Line>,
}

impl Spare {
    pub fn size(&self) -> usize {
        self.tables.capacity() * size_of::<u32>() + self.work.capacity() * size_of::<Line>()
    }
}

pub struct Compressor {
    format: &'static Format,
    settings: Settings,
    /// In the spare capacity. The kernels initialize what they use.
    tables: Vec<u32>,
    /// During a pause.
    state: State,
    /// The state, the counts, the scratch and the symbols, in the spare capacity.
    work: Vec<Line>,
    /// In literals, and in pairs of commands.
    room: usize,
    /// The offset up to which the room is enough.
    limit: usize,
    parsed: usize,
    block_start: usize,
    /// The origin and the end of the dictionary, which only change during a pause.
    layout: Option<[usize; 2]>,
}

impl Compressor {
    pub fn new(
        format: &'static Format,
        last_distances: [u32; 4],
        tries_words: bool,
        Spare { tables, work }: Spare,
    ) -> Self {
        Self {
            format,
            settings: Settings::default(),
            tables,
            state: State {
                last: last_distances,
                stride: 4,
                word_credit: if tries_words { 512 } else { 0 },
                ..State::default()
            },
            work,
            room: 0,
            limit: 0,
            parsed: 0,
            block_start: 0,
            layout: None,
        }
    }

    /// With empty tables. Not in the middle of a meta-block.
    pub fn configure(&mut self, settings: &Settings) -> Result<(), TryReserveError> {
        assert!(settings.are_valid() && self.is_paused());
        let last_word = settings.first_word as usize + MAX_WORD_ADDRESS - 1;
        assert!(self.state.word_credit == 0 || settings.reach_past_window(last_word));
        let size = settings.table_sizes().sum();
        self.settings.table_count = 0;
        if size > self.tables.capacity() {
            self.tables = Vec::new();
        }
        self.tables.try_reserve_exact(size)?;
        (self.state.indexed, self.state.table_bits) = (0, 0);
        self.settings = *settings;
        Ok(())
    }

    pub fn into_spare(self) -> Spare {
        let Self { tables, work, .. } = self;
        Spare { tables, work }
    }

    pub fn is_paused(&self) -> bool {
        self.room == 0
    }

    /// For meta-blocks that start at `start`, and end at `limit` or before.
    pub fn resume(&mut self, start: usize, limit: usize) -> Result<(), TryReserveError> {
        assert!(self.is_paused() && self.settings.table_count != 0 && start < 1 << 31);
        let room = (limit - start).min(MAX_SYMBOLS).next_multiple_of(64) + 128;
        let lines = STATE_LINES + 2 * COUNTS_LINES + SCRATCH_LINES + room / 64 * 15;
        if lines > self.work.capacity() {
            self.shrink();
        }
        self.work.try_reserve_exact(lines)?;
        self.state.now.covered = start as u32;
        self.state.settled.covered = start as u32;
        // SAFETY: the first lines of the capacity have the size and the alignment.
        unsafe { self.work.as_mut_ptr().cast::<State>().write(self.state) };
        (self.room, self.limit, self.parsed) = (room, limit, start);
        (self.block_start, self.layout) = (start, None);
        Ok(())
    }

    /// Between meta-blocks.
    pub fn pause(&mut self) {
        if !self.is_paused() {
            self.state = *self.state();
            assert!(self.state.now.commands == 0 && self.state.held[2] == 0);
            self.room = 0;
        }
    }

    /// Frees what is not needed during a pause.
    pub fn shrink(&mut self) {
        assert!(self.is_paused());
        self.work = Vec::new();
    }

    fn state(&mut self) -> &mut State {
        assert!(!self.is_paused());
        // SAFETY: `resume` wrote it.
        unsafe { &mut *self.work.as_mut_ptr().cast() }
    }

    fn memory(&mut self) -> (Memory, *mut State, *mut Line) {
        assert!(!self.is_paused());
        let mut tables = [self.tables.as_mut_ptr(); 5];
        let mut offset = 0;
        for (table, size) in tables.iter_mut().zip(self.settings.table_sizes()) {
            *table = table.wrapping_add(offset);
            offset += size;
        }
        let state = self.work.as_mut_ptr();
        let scratch = state.wrapping_add(STATE_LINES + 2 * COUNTS_LINES);
        let part = |start: usize| scratch.wrapping_add(SCRATCH_LINES + self.room / 64 * start);
        let memory = Memory {
            tables,
            commands: part(0).cast(),
            distances: part(4).cast(),
            literal_ends: part(8).cast(),
            literals: part(9).cast::<u32>().wrapping_add(8),
            packed: part(13).cast(),
            words: self.format.words,
            dictionary: self.format.dictionary.as_ptr(),
            contexts: self.format.contexts.as_ptr().cast(),
        };
        (memory, state.cast(), scratch)
    }

    /// Makes `range` available for copying.
    pub fn index(&mut self, input: &Input<'_>, range: Range<usize>) {
        assert!(input.has_padding(&range));
        let (memory, state, scratch) = self.memory();
        let Range { start, end } = range;
        // SAFETY: the kernel reads the range and its padding, and reduces hashes to the sizes of the tables.
        unsafe {
            highway_brotli_quick_index(
                &self.settings,
                &memory,
                &input.raw(),
                start,
                end,
                state,
                scratch,
            );
        }
    }

    /// The offsets that the state has are within what is parsed up to `end`.
    fn check(&mut self, input: &Input<'_>, end: usize) {
        let state = *self.state();
        let [_, held_end, held_distance] = state.held;
        assert!(state.is_ready == 0 && end <= self.limit);
        assert!(end <= self.block_start + MAX_META_BLOCK_SIZE);
        let layout = [input.origin, input.dictionary_end];
        assert!(*self.layout.get_or_insert(layout) == layout);
        let start = input.origin.max(input.dictionary_end);
        assert!((start..=end).contains(&(state.now.covered as usize)));
        assert!(input.dictionary_end == 0 || self.settings.reach_past_window(input.dictionary_end));
        assert!(held_distance == 0 || held_end as usize <= end);
        assert!(input.has_padding(&(self.parsed..self.parsed)));
    }

    /// Goes on up to `end`, unless a meta-block is ready before.
    pub fn parse(&mut self, input: &Input<'_>, end: usize) -> Option<Ready> {
        self.parsed = self.parsed.max(MIN_BEFORE);
        self.check(input, end);
        assert!(input.has_padding(&(self.parsed..end)));
        let (memory, state, scratch) = self.memory();
        let (raw, at) = (input.raw(), self.parsed);
        // SAFETY: the kernel limits distances to what is before, and lengths to `end`. It stops before it has `MAX_SYMBOLS`, and has no more than there are bytes.
        self.parsed = unsafe {
            highway_brotli_quick_parse(&self.settings, &memory, &raw, at, end, state, scratch)
        };
        (self.state().is_ready != 0).then(|| self.ready())
    }

    /// The next meta-block of those that go up to `end`, which may include the padding after what is parsed.
    pub fn close(&mut self, input: &Input<'_>, end: usize) -> Ready {
        self.check(input, end);
        assert!((self.parsed..=self.parsed + PADDING_AFTER).contains(&end));
        let (memory, state, scratch) = self.memory();
        // SAFETY: as in `parse`, for two commands. It takes care not to read past the input.
        unsafe {
            highway_brotli_quick_close(&self.settings, &memory, &input.raw(), end, state, scratch);
        }
        self.ready()
    }

    fn ready(&mut self) -> Ready {
        let state = self.state();
        let is_compressible = state.settled.commands != 0;
        state.is_ready = is_compressible.into();
        self.block_start = state.settled.covered as usize;
        Ready {
            end: self.block_start,
            is_compressible,
        }
    }

    /// For [`write`](Self::write), in bytes.
    pub fn max_written(&mut self) -> usize {
        let Mark {
            commands, literals, ..
        } = self.state().settled;
        14 * commands as usize + 2 * literals as usize + 4096
    }

    /// What follows the header of the meta-block that is ready, unless its `length` bytes hardly shrink. Positions are in bits.
    pub fn write(&mut self, length: usize, out: &mut Vec<u8>, position: usize) -> usize {
        assert!(self.state().is_ready != 0 && position / 8 < out.len());
        assert!(self.max_written() <= out.capacity() - position / 8);
        self.state().is_ready = 0;
        let (memory, state, scratch) = self.memory();
        let start = out.as_mut_ptr();
        // SAFETY: a write advances by seven bytes at most. There are two for each command, and a literal takes up to 12 bits.
        let end = unsafe {
            highway_brotli_quick_write(
                &self.settings,
                &memory,
                state,
                scratch,
                length,
                start,
                position,
            )
        };
        // SAFETY: the kernel wrote up to the byte that has the end.
        unsafe { out.set_len(out.len().max(end / 8 + 1)) };
        end
    }

    /// If what was written last is not used.
    pub fn forget_distances(&mut self) {
        self.state().last = UNKNOWN_DISTANCES;
    }
}

pub fn looks_binary(bytes: &[u8]) -> bool {
    // SAFETY: the kernel reads within the slice.
    unsafe { highway_brotli_quick_looks_binary(bytes.as_ptr(), bytes.len()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The kernels are only linked into the full binary.
    macro_rules! stubs {
        ($($kernel:ident($($parameter:ty),*) -> $result:ty;)*) => {$(
            #[unsafe(no_mangle)]
            extern "C" fn $kernel($(_: $parameter),*) -> $result {
                Default::default()
            }
        )*};
    }
    type In = *const u8;
    type Out = *mut u8;
    stubs! {
        highway_brotli_quick_index(In, In, In, usize, usize, Out, Out) -> ();
        highway_brotli_quick_parse(In, In, In, usize, usize, Out, Out) -> usize;
        highway_brotli_quick_close(In, In, In, usize, Out, Out) -> ();
        highway_brotli_quick_write(In, In, Out, Out, usize, Out, usize) -> usize;
    }

    static WORDS: Words = Words {
        first_four: [[0; _]; _],
        buckets: [[0; _]; _],
        next_four: [0; _],
        transforms: [[[0; _]; _]; _],
        packed: [0; _],
        omit_last: [0; _],
    };
    static FORMAT: Format = Format::new(&WORDS, &[0; _], &[[[0; _]; _]; _]);
    const SETTINGS: Settings = Settings {
        table_bits: [8; 3],
        grams: [5, 9, 16],
        table_count: 3,
        landmark_bits: 0,
        seam_bits: 10,
        sparsity: 0,
        few_matches: 0,
        repeat_gain: 0,
        word_toll: 0,
        join_toll: 4,
        position_bits: 24,
        max_backward: (1 << 24) - 16,
        first_word: 1,
        postfix_bits: [0; 3],
        direct_codes: 0,
        distance_symbols: [64; 3],
        distance_symbol_bits: [6; 3],
        max_trees: 8,
        min_insert: 0,
        haste: 0,
        max_size: 0,
    };
    /// With 64 symbols.
    const MAX_DISTANCE: u32 = (1 << 26) - 4;

    fn returns<T>(call: impl FnOnce() -> T) -> bool {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(call)).is_ok()
    }

    fn resumed(start: usize, limit: usize) -> Compressor {
        let mut compressor = Compressor::new(&FORMAT, [0; 4], false, Spare::default());
        compressor.configure(&SETTINGS).unwrap();
        compressor.resume(start, limit).unwrap();
        compressor
    }

    fn input(origin: usize, dictionary_end: usize) -> Input<'static> {
        Input {
            bytes: &[0; 1000 + PADDING_AFTER],
            origin,
            dictionary_end,
            base: 0,
            stream_offset: 0,
        }
    }

    #[test]
    fn configure() {
        let accepts = |change: fn(&mut Settings)| {
            let mut settings = SETTINGS;
            change(&mut settings);
            returns(|| {
                Compressor::new(&FORMAT, [0; 4], true, Spare::default()).configure(&settings)
            })
        };
        const ROOM: u32 = MAX_DISTANCE - SETTINGS.max_backward - MAX_WORD_ADDRESS as u32;
        assert!(accepts(|it| it.first_word = ROOM + 1));
        assert!(!accepts(|it| it.first_word = ROOM + 2));
        assert!(!accepts(|it| it.postfix_bits[2] = 1));
        assert!(!accepts(|it| it.table_count = 4));
        assert!(!accepts(|it| it.grams[0] = 2));
        assert!(!accepts(|it| it.grams[0] = 9));
        assert!(!accepts(|it| it.grams[2] = 25));
        assert!(!accepts(|it| it.sparsity = 1));
        assert!(!accepts(|it| it.position_bits = 11));
        assert!(!accepts(|it| it.max_trees = 9));
        assert!(!returns(|| resumed(50, 60).configure(&SETTINGS)));
    }

    #[test]
    fn ranges() {
        let index = |range| returns(|| resumed(0, 0).index(&input(0, 0), range));
        assert!(index(MIN_BEFORE..1000));
        assert!(!index(MIN_BEFORE - 1..1000));
        assert!(!index(MIN_BEFORE..1001));
        let parse = |input, limit, end| returns(|| resumed(50, limit).parse(&input, end));
        assert!(parse(input(50, 50), 1000, 1000));
        assert!(!parse(input(50, 0), 999, 1000));
        assert!(!parse(input(50, 0), 1001, 1001));
        assert!(!parse(input(50, 0), 1000, 49));
        assert!(!parse(input(51, 0), 1000, 1000));
        assert!(!parse(input(0, 51), 1000, 1000));
        let close = |start, end| returns(|| resumed(start, end).close(&input(0, 0), end));
        assert!(close(1000, 1000 + PADDING_AFTER));
        assert!(!close(999, 1000 + PADDING_AFTER));
        assert!(!close(1001, 1001));
    }

    #[test]
    fn write() {
        let fits = |is_ready, spare: usize, position| {
            let mut compressor = resumed(50, 60);
            compressor.state().is_ready = is_ready;
            let mut out = Vec::with_capacity(compressor.max_written() + spare);
            out.extend([0; 2]);
            returns(|| compressor.write(0, &mut out, position))
        };
        assert!(fits(1, 1, 15));
        assert!(!fits(0, 1, 15));
        assert!(!fits(1, 0, 15));
        assert!(!fits(1, 2, 16));
    }
}
