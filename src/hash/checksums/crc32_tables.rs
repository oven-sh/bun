//! The CRC-32 of short inputs, and of all on CPUs without an instruction for it.

pub(super) const fn after_zeros(mut state: u32, mut zeros: usize) -> u32 {
    const TABLE: &[u32; 256] = &{
        let (mut table, mut step) = ([0; 256], 0);
        while step < 256 * 8 {
            let state = if step % 8 == 0 {
                step as u32 / 8
            } else {
                table[step / 8]
            };
            table[step / 8] = (state >> 1) ^ if state & 1 == 1 { 0xEDB8_8320 } else { 0 };
            step += 1;
        }
        table
    };
    while zeros > 0 {
        state = TABLE[state as usize & 255] ^ (state >> 8);
        zeros -= 1;
    }
    state
}

/// `[n][byte]` is the state after `byte` and `zeros + n` zeros.
const fn crc32_tables(zeros: usize) -> [[u32; 256]; 4] {
    let mut tables = [[0; 256]; 4];
    let mut byte = 0;
    while byte < 256 {
        let (mut state, mut n) = (after_zeros(byte as u32, zeros), 0);
        while n < 4 {
            state = after_zeros(state, 1);
            tables[n][byte] = state;
            n += 1;
        }
        byte += 1;
    }
    tables
}

#[inline(always)]
fn look_up(tables: &[[u32; 256]; 4], word: u32) -> u32 {
    let [a, b, c, d] = word.to_le_bytes().map(usize::from);
    tables[3][a] ^ tables[2][b] ^ tables[1][c] ^ tables[0][d]
}

#[inline(always)]
pub(super) fn crc32_by_words(mut state: u32, bytes: &[u8]) -> u32 {
    static TABLES: [[u32; 256]; 4] = crc32_tables(0);
    let (words, bytes) = bytes.as_chunks();
    for &word in words {
        state = look_up(&TABLES, u32::from_le_bytes(word) ^ state);
    }
    for &byte in bytes {
        state = TABLES[0][usize::from(state as u8 ^ byte)] ^ (state >> 8);
    }
    state
}

/// Every fourth word goes into the same state, so that four do not wait for each other.
fn crc32_by_braids(state: u32, bytes: &[u8]) -> u32 {
    static TABLES: [[u32; 256]; 4] = crc32_tables(12);
    let (blocks, rest) = bytes.as_chunks::<16>();
    let Some((last, blocks)) = blocks.split_last() else {
        return crc32_by_words(state, rest);
    };
    let mut states = [state, 0, 0, 0];
    for block in blocks {
        for (state, &word) in states.iter_mut().zip(block.as_chunks().0) {
            *state = look_up(&TABLES, u32::from_le_bytes(word) ^ *state);
        }
    }
    let words = states.iter().zip(last.as_chunks::<4>().0);
    let state = words.fold(0, |state, (braid, word)| {
        crc32_by_words(state ^ braid, word)
    });
    crc32_by_words(state, rest)
}

/// For a CPU that has no instruction for it.
#[inline(never)]
pub(super) fn crc32_without_kernel(state: u32, bytes: &[u8]) -> u32 {
    /// The CRC stays the same if a byte is zeroed and XORed into the bytes at these distances after it.
    /// https://arxiv.org/abs/2412.16398
    const DISTANCES: [usize; 4] = [145, 183, 211, 300];
    const KEPT: usize = DISTANCES[3].next_multiple_of(16);
    let add_taken = |byte, window: &[u8], at: usize| {
        let taken = DISTANCES.map(|distance| window[at - distance]);
        taken.into_iter().fold(byte, |sum, byte| sum ^ byte)
    };

    let Some((taken, kept)) = bytes
        .split_last_chunk::<KEPT>()
        .filter(|(taken, _)| taken.len() >= KEPT)
    else {
        return crc32_by_braids(state, bytes);
    };
    // The first third is a ring buffer of the last bytes taken out. The second is a copy of it, so that reads don't
    // wrap around. The last stays zero.
    #[repr(align(16))]
    struct Window([u8; 3 * KEPT]);
    let Window(window) = &mut Window([0; _]);
    window[KEPT - DISTANCES[3]..][..4].copy_from_slice(&state.to_le_bytes());
    let mut end = KEPT;
    for lap in taken.chunks(KEPT) {
        for (at, &byte) in (KEPT..2 * KEPT).zip(lap) {
            let byte = add_taken(byte, window, at);
            (window[at - KEPT], window[at]) = (byte, byte);
        }
        end = KEPT + lap.len();
    }
    window[end..2 * KEPT].fill(0);
    let window = &window[end - KEPT..][..2 * KEPT];
    let kept: [u8; KEPT] = core::array::from_fn(|at| add_taken(kept[at], window, KEPT + at));
    crc32_by_braids(0, &kept)
}
