//! The bytes that link and change code at a known address.

const BRANCH: u32 = 0x1400_0000;
const DISTANCE_BITS: u32 = 26;
const DISTANCE_MASK: u32 = (1 << DISTANCE_BITS) - 1;

/// How far a jump or call reaches in either direction.
pub const REACH: usize = (128 << 20) - 4;
pub const VENEER_SIZE: usize = 16;
pub const REPLACEMENT_JUMP_SIZE: usize = 4;
/// The word of a patchable jump or call starts this far before its end.
pub const TRANSFER_WORD_BEFORE_END: usize = 4;
pub const PATCHABLE_MOVE_SIZE: usize = 16;

/// The new word at `word_address` of a jump or call, if `target` is within reach.
pub fn transfer_word(old: u32, word_address: usize, target: usize) -> Option<u32> {
    let distance = target.wrapping_sub(word_address) as isize;
    assert!(distance % 4 == 0);
    (distance.unsigned_abs() <= REACH)
        .then_some(old & !DISTANCE_MASK | (distance >> 2) as u32 & DISTANCE_MASK)
}

pub fn transfer_target(word: u32, word_address: usize) -> usize {
    let words = (word << (32 - DISTANCE_BITS)) as i32 >> (32 - DISTANCE_BITS);
    word_address.wrapping_add_signed(words as isize * 4)
}

pub fn replacement_jump(address: usize, target: usize) -> Option<[u8; REPLACEMENT_JUMP_SIZE]> {
    transfer_word(BRANCH, address, target).map(u32::to_le_bytes)
}

/// Goes to any address through x16.
pub fn veneer(target: usize) -> [u8; VENEER_SIZE] {
    const LDR_X16_FROM_8_AHEAD: u32 = 0x5800_0050;
    const BR_X16: u32 = 0xd61f_0200;
    let mut bytes = [0; VENEER_SIZE];
    bytes[..4].copy_from_slice(&LDR_X16_FROM_8_AHEAD.to_le_bytes());
    bytes[4..8].copy_from_slice(&BR_X16.to_le_bytes());
    bytes[8..].copy_from_slice(&(target as u64).to_le_bytes());
    bytes
}

/// From the last bytes of a patchable move, those that move `value` instead.
pub fn move_bytes(mut bytes: [u8; PATCHABLE_MOVE_SIZE], value: u64) -> [u8; PATCHABLE_MOVE_SIZE] {
    for (index, word) in bytes.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let part = u32::from((value >> (16 * index)) as u16);
        *word = (u32::from_le_bytes(*word) & !(0xffff << 5) | part << 5).to_le_bytes();
    }
    bytes
}
