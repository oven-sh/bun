//! The bytes that link and change code at a known address.

use super::assembler::{JUMP_OPCODE, JUMP_SIZE};

/// How far a jump or call reaches in either direction.
pub const REACH: usize = i32::MAX as usize;
pub const VENEER_SIZE: usize = 16;
pub const REPLACEMENT_JUMP_SIZE: usize = JUMP_SIZE as usize;
/// The word of a patchable jump or call starts this far before its end.
pub const TRANSFER_WORD_BEFORE_END: usize = 4;
pub const PATCHABLE_MOVE_SIZE: usize = 8;

/// The new word at `word_address` of a jump or call, if `target` is within reach.
pub fn transfer_word(_old: u32, word_address: usize, target: usize) -> Option<u32> {
    let distance = target.wrapping_sub(word_address + 4) as isize;
    i32::try_from(distance).ok().map(|distance| distance as u32)
}

pub fn transfer_target(word: u32, word_address: usize) -> usize {
    (word_address + 4).wrapping_add_signed(word as i32 as isize)
}

pub fn replacement_jump(address: usize, target: usize) -> Option<[u8; REPLACEMENT_JUMP_SIZE]> {
    let [a, b, c, d] = transfer_word(0, address + 1, target)?.to_le_bytes();
    Some([JUMP_OPCODE, a, b, c, d])
}

/// Goes to any address and changes no register.
pub fn veneer(target: usize) -> [u8; VENEER_SIZE] {
    let mut bytes = [0xff, 0x25, 2, 0, 0, 0, 0xcc, 0xcc, 0, 0, 0, 0, 0, 0, 0, 0];
    bytes[8..].copy_from_slice(&(target as u64).to_le_bytes());
    bytes
}

/// From the last bytes of a patchable move, those that move `value` instead.
pub fn move_bytes(_old: [u8; PATCHABLE_MOVE_SIZE], value: u64) -> [u8; PATCHABLE_MOVE_SIZE] {
    value.to_le_bytes()
}
