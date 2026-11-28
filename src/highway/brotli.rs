//! The kernels of `bun_brotli`, from src/jsc/bindings/highway_brotli.cpp.

unsafe extern "C" {
    fn highway_brotli_find_switches(
        symbols: *const u16,
        steps: usize,
        stride: usize,
        costs: *const [u16; 16],
        alphabet_size: usize,
        groups: usize,
        switch_cost: u16,
        bits: *mut [u16; 2],
    );

    fn highway_brotli_sort_leaves(
        leaves: *const u64,
        count: usize,
        like_shell_sort: bool,
        sorted: *mut u64,
    ) -> bool;

    fn highway_brotli_short_codes(
        bytes: *const u8,
        last_start: u32,
        ring_mask: u32,
        position: u32,
        pair: u16,
        distances: &[i32; 4],
    ) -> u32;

    fn highway_brotli_find_matches(
        ring: *const u8,
        size: usize,
        chunk: &Chunk,
        rungs: *mut Rung,
        rung_count: usize,
        tables: *mut u64,
        scratch: &mut [u64; MATCH_SCRATCH],
        starts: &mut [Matches; MATCH_RING],
    );

    fn highway_brotli_differences(a: *const u8, b: *const u8) -> u32;

    /// A bit for each byte. Lowercase letters of `word` have the bits of `changes` flipped.
    #[link_name = "highway_brotli_differences_in_case"]
    pub safe fn differences_in_case(word: &[u8; 32], changes: &[u8; 32], bytes: &[u8; 32]) -> u32;

    /// A bit for each of `all` that has one of `tags` above its two low bits.
    #[link_name = "highway_brotli_tagged"]
    pub safe fn tagged(all: &[u16; 16], tags: &[u16; 5]) -> u32;

    /// Lowers `costs` to `base` plus `added` plus the last of `first`.
    #[link_name = "highway_brotli_lower"]
    pub safe fn lower(
        costs: &mut [i32; 16],
        added: &[i32; 16],
        // `i32::MAX` or 0.
        barred: &[i32; 16],
        first: &[i32; 4],
        base: i32,
        // With -1 instead of 0, the first three of `costs` have their own in `first`.
        is_first: i32,
    );

    #[link_name = "highway_brotli_all_above"]
    pub safe fn all_above(costs: &[i32; 8], limit: i32) -> bool;

    /// With its index in place of the three low bits. See [`lower`].
    #[link_name = "highway_brotli_least_sum"]
    pub safe fn least_sum(a: &[i32; 8], b: &[i32; 8], barred: &[i32; 8]) -> i32;

    /// Returns a bit for each position from `first` on where no match is long `enough`.
    #[link_name = "highway_brotli_spread_matches"]
    pub safe fn spread_matches(
        // Get cleared.
        starts: &mut [Matches; 64],
        // Get the largest so far, going on from their last.
        matches: &mut [Matches; 64],
        first: i32,
        enough: i32,
        // The longest length, above every other of 8 bits for a match that is longer than those before.
        summaries: &mut [u32; 64],
    ) -> u64;

    /// What becomes of counts with `added` more, or less where `signs` has all bits.
    #[link_name = "highway_brotli_tally"]
    pub safe fn tally(
        // The counts, and about `16 * count * log2(count)` if that is below 2^29.
        old: &[[u32; 8]; 2],
        added: u32,
        signs: &[u32; 8],
        // No count has other bits. `0x7FFF` saves time.
        mask: u32,
        products: &mut [u32; 8],
        // Of the products and of the counts that are not zero, and the largest count.
        sums: &mut [[u32; 8]; 3],
    );

    /// Returns two bits for each that stays the same.
    #[link_name = "highway_brotli_replace_matches"]
    pub safe fn replace_matches(known: &mut Matches, matches: &Matches) -> u32;

    /// The first one, or 32.
    #[link_name = "highway_brotli_short_code_for"]
    pub safe fn short_code_for(distance: i32, last_distances: &[i32; 4]) -> u32;

    /// Copies `values`, after `first` if it `is_new`.
    #[link_name = "highway_brotli_push_front"]
    pub safe fn push_front(values: &[i32; 4], first: i32, is_new: bool, to: &mut [i32; 4]);
}

/// Adds up what `symbols` cost in each histogram. After each `stride`, one can take over the sum of the cheapest for `switch_cost`.
#[inline(always)]
pub fn find_switches(
    symbols: &[u16],
    stride: usize,
    // For each symbol of the alphabet, and for each of the `groups` of histograms.
    costs: &[[u16; 16]],
    groups: usize,
    switch_cost: u16,
    // For each stride and group, the histograms that take over, and the cheapest ones.
    bits: &mut [[u16; 2]],
) {
    let steps = symbols.len() / stride;
    assert!((1..=4).contains(&groups) && groups <= costs.len() && steps <= bits.len() / groups);
    // SAFETY: the kernel limits the symbols to the alphabet, and writes `groups` pairs for each step (asserted above).
    unsafe {
        highway_brotli_find_switches(
            symbols.as_ptr(),
            steps,
            stride,
            costs.as_ptr(),
            costs.len() / groups,
            groups,
            switch_cost,
            bits.as_mut_ptr(),
        );
    }
}

/// `kMaxSymbols` in highway_brotli.cpp.
const MAX_SYMBOLS: usize = 704;

/// How many elements after the leaves the kernel may copy to the same index: `kLeafGroup` in highway_brotli.cpp.
pub const LEAF_SLACK: usize = 16;

/// Sorts the first `count` of `leaves` by their high halves, unless one is above 32766 or a slice is too short.
#[inline(always)]
pub fn sort_leaves(
    leaves: &[u64],
    count: usize,
    // With the gaps 132, 57, 23, 10, 4 and 1. Otherwise, ties keep their order.
    like_shell_sort: bool,
    sorted: &mut [u64],
) -> bool {
    count <= MAX_SYMBOLS
        && count + LEAF_SLACK <= leaves.len().min(sorted.len())
        // SAFETY: the kernel has room for `count` leaves, and limits its indices to `count + LEAF_SLACK - 1`.
        && unsafe {
            highway_brotli_sort_leaves(leaves.as_ptr(), count, like_shell_sort, sorted.as_mut_ptr())
        }
}

/// A bit for each of the 16 short distance codes that may lead from `position` to `pair`.
#[inline(always)]
pub fn short_codes(
    ring: &[u8],
    ring_mask: u32,
    position: u32,
    pair: [u8; 2],
    last_distances: &[i32; 4],
) -> u32 {
    let Some(last_start) = ring.len().checked_sub(8) else {
        return 0xFFFF;
    };
    // SAFETY: the kernel reads 8 bytes from `last_start` at most.
    unsafe {
        highway_brotli_short_codes(
            ring.as_ptr(),
            last_start as u32,
            ring_mask,
            position,
            u16::from_le_bytes(pair),
            last_distances,
        )
    }
}

/// A bit for each of the 32 bytes from `a` and from `b` on. All of them if there are not so many.
#[inline(always)]
pub fn differences(bytes: &[u8], a: u32, b: u32) -> u32 {
    if a.max(b) as usize + 32 > bytes.len() {
        core::hint::cold_path();
        return u32::MAX;
    }
    let at = |index: u32| bytes.as_ptr().wrapping_add(index as usize);
    // SAFETY: the kernel reads 32 bytes from both.
    unsafe { highway_brotli_differences(at(a), at(b)) }
}

/// `kRungs`, `kChunk`, `kRing` and the size of `Work` in highway_brotli.cpp.
pub const MAX_RUNGS: usize = 7;
pub const MATCH_CHUNK: usize = 512;
pub const MATCH_RING: usize = 1024;
pub const MATCH_SCRATCH: usize = 11270;

/// For each class of distances, `(end << 39) - (distance << 9) + length`.
pub type Matches = [i64; 4];

/// A table of the last two positions for each hash.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Rung {
    /// Of what is hashed.
    pub length: u32,
    /// From 0 to 4 for all positions, a third, a fifth, a ninth, and half of that.
    pub level: u32,
    /// Among the tables, the first number of which is for none.
    pub start: u32,
    pub size_bits: u32,
    /// The positions before it are in the table, or never will be.
    pub next: u32,
}

#[repr(C)]
pub struct Chunk {
    pub ring_mask: u32,
    pub from: u32,
    pub to: u32,
    /// Matches are between these two.
    pub floor: u32,
    pub end: u32,
    /// What the ends of [`Matches`] are counted from.
    pub origin: u32,
    /// With 0, the positions are only noted.
    pub max_distance: u32,
    /// What is left of 32 bits tells hashes apart.
    pub position_bits: u32,
    /// The largest distance of each but the last.
    pub classes: [i32; 3],
}

/// Raises `starts`, which are by position, to the matches that go through the chunk. They start up to 32 bytes before, and are cut after 352 more.
#[inline(always)]
pub fn find_matches(
    ring: &[u8],
    chunk: &Chunk,
    rungs: &mut [Rung],
    tables: &mut [u64],
    scratch: &mut [u64; MATCH_SCRATCH],
    starts: &mut [Matches; MATCH_RING],
) {
    assert!(ring.len() >= 64);
    assert!(chunk.to.wrapping_sub(chunk.from) as usize <= MATCH_CHUNK && chunk.position_bits < 32);
    assert!((1..=MAX_RUNGS).contains(&rungs.len()) && rungs.is_sorted_by_key(|rung| rung.length));
    assert!(rungs.iter().all(|rung| {
        (3..=128).contains(&rung.length)
            && rung.level <= 4
            && (1..32).contains(&rung.size_bits)
            && rung.start as usize + (1 << rung.size_bits) <= tables.len().min(1 << 32)
    }));
    // SAFETY: the kernel limits its indices into `ring` and `starts`. The others are within what is asserted above.
    unsafe {
        highway_brotli_find_matches(
            ring.as_ptr(),
            ring.len(),
            chunk,
            rungs.as_mut_ptr(),
            rungs.len(),
            tables.as_mut_ptr(),
            scratch,
            starts,
        );
    }
}
