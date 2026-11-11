use super::generated::Body;
use core::mem::MaybeUninit;

const PACKED: u32 = u32::MAX;
const HEAD_WORDS: usize = 2;
const WORDS_PER_CONTROL: usize = 4;

const LENGTHS: [usize; 4] = [0, 1, 2, 4];
const MASKS: [u32; 4] = [0, 0xFF, 0xFFFF, u32::MAX];
const BYTES_OF_FULL_GROUP: usize = WORDS_PER_CONTROL * 4;

#[derive(Copy, Clone)]
struct Group {
    masks: [u32; WORDS_PER_CONTROL],
    second: u8,
    third: u8,
    fourth: u8,
    bytes: u8,
}

static GROUPS: [Group; 256] = {
    let mut groups = [Group {
        masks: [0; WORDS_PER_CONTROL],
        second: 0,
        third: 0,
        fourth: 0,
        bytes: 0,
    }; 256];
    let mut control = 0;
    while control < 256 {
        let group = &mut groups[control];
        let codes = [
            control & 3,
            control >> 2 & 3,
            control >> 4 & 3,
            control >> 6,
        ];
        let mut place = 0;
        while place < WORDS_PER_CONTROL {
            group.masks[place] = MASKS[codes[place]];
            group.bytes += LENGTHS[codes[place]] as u8;
            place += 1;
        }
        group.second = LENGTHS[codes[0]] as u8 * 8;
        group.third = (LENGTHS[codes[0]] + LENGTHS[codes[1]]) as u8;
        group.fourth = LENGTHS[codes[2]] as u8 * 8;
        control += 1;
    }
    groups
};

#[inline(always)]
fn eight_bytes(bytes: &[u8; BYTES_OF_FULL_GROUP], at: usize) -> u64 {
    let at = at.min(BYTES_OF_FULL_GROUP - 8);
    u64::from_le_bytes(bytes[at..at + 8].as_chunks().0[0])
}

#[inline(always)]
fn unpack_group(group: &Group, bytes: &[u8; BYTES_OF_FULL_GROUP]) -> [u32; WORDS_PER_CONTROL] {
    let first = eight_bytes(bytes, 0);
    let third = eight_bytes(bytes, usize::from(group.third));
    [
        unfold_sign(first as u32 & group.masks[0]),
        unfold_sign((first >> group.second) as u32 & group.masks[1]),
        unfold_sign(third as u32 & group.masks[2]),
        unfold_sign((third >> group.fourth) as u32 & group.masks[3]),
    ]
}

#[cold]
fn padded(last_bytes: &[u8]) -> [u8; BYTES_OF_FULL_GROUP] {
    let mut padded = [0; BYTES_OF_FULL_GROUP];
    let count = last_bytes.len().min(BYTES_OF_FULL_GROUP);
    padded[..count].copy_from_slice(&last_bytes[..count]);
    padded
}

#[inline(always)]
fn fold_sign(word: u32) -> u32 {
    (word << 1) ^ (word >> 31).wrapping_neg()
}

#[inline(always)]
fn unfold_sign(folded: u32) -> u32 {
    (folded >> 1) ^ (folded & 1).wrapping_neg()
}

#[inline(always)]
fn code_of(folded: u32) -> u8 {
    ((u32::BITS + 7 - folded.leading_zeros()) / 8).min(3) as u8
}

#[inline(always)]
fn pack_group(words: &[u32; WORDS_PER_CONTROL], bytes: &mut [u8], at: usize) -> (u8, usize) {
    let &[first, second, third, fourth] = words;
    let (first, second) = (fold_sign(first), fold_sign(second));
    let (third, fourth) = (fold_sign(third), fold_sign(fourth));
    let control =
        code_of(first) | code_of(second) << 2 | code_of(third) << 4 | code_of(fourth) << 6;
    let group = &GROUPS[usize::from(control)];
    let half = u64::from(first) | u64::from(second) << group.second;
    bytes[at..at + 8].as_chunks_mut().0[0] = half.to_le_bytes();
    let middle = at + usize::from(group.third);
    let half = u64::from(third) | u64::from(fourth) << group.fourth;
    bytes[middle..middle + 8].as_chunks_mut().0[0] = half.to_le_bytes();
    (control, at + usize::from(group.bytes))
}

fn pack_words(words: &[u32], scratch: &mut Vec<u8>) -> Vec<u32> {
    let control_bytes = words.len().div_ceil(WORDS_PER_CONTROL);
    let most = control_bytes * (1 + BYTES_OF_FULL_GROUP) + 8;
    if scratch.len() < most {
        scratch.resize(most, 0);
    }
    let scratch = &mut scratch[..];
    let mut at = control_bytes;
    let (full, rest) = words.as_chunks::<WORDS_PER_CONTROL>();
    for (number, group) in full.iter().enumerate() {
        (scratch[number], at) = pack_group(group, scratch, at);
    }
    if !rest.is_empty() {
        let mut last = [0; WORDS_PER_CONTROL];
        last[..rest.len()].copy_from_slice(rest);
        (scratch[full.len()], at) = pack_group(&last, scratch, at);
    }
    let end = at.next_multiple_of(4);
    scratch[at..end].fill(0);
    let mut packed = Vec::with_capacity(HEAD_WORDS + end / 4);
    packed.push(PACKED);
    packed.push(u32::try_from(words.len()).expect("a body fits 32 bits"));
    let fours = scratch[..end].as_chunks().0;
    packed.extend(fours.iter().map(|&four| u32::from_le_bytes(four)));
    packed
}

fn bytes_of(words: &[u32]) -> &[u8] {
    const { assert!(cfg!(target_endian = "little")) };
    // SAFETY: every byte of a `u32` is a byte, and the slice is that long.
    unsafe { core::slice::from_raw_parts(words.as_ptr().cast::<u8>(), words.len() * 4) }
}

impl Body {
    fn is_packed(&self) -> bool {
        self.code.first() == Some(&PACKED)
    }

    pub fn word_count(&self) -> usize {
        match self.is_packed() {
            true => self.code[1] as usize,
            false => self.code.len(),
        }
    }

    pub fn pack(&mut self, scratch: &mut Vec<u8>) {
        assert!(!self.is_packed(), "a body begins with the head of a block");
        let packed = pack_words(&self.code, scratch);
        if packed.len() < self.code.len() {
            self.code = packed;
        }
    }

    pub fn unpack(&mut self) {
        if !self.is_packed() {
            return;
        }
        let count = self.word_count();
        let mut words = Vec::with_capacity(count);
        self.unpack_into(&mut words.spare_capacity_mut()[..count]);
        // SAFETY: `unpack_into` has written each of them.
        unsafe { words.set_len(count) };
        self.code = words;
    }

    pub fn unpack_into<'a>(&self, to: &'a mut [MaybeUninit<u32>]) -> &'a [u32] {
        assert_eq!(to.len(), self.word_count());
        if !self.is_packed() {
            return to.write_copy_of_slice(&self.code);
        }
        let bytes = bytes_of(&self.code[HEAD_WORDS..]);
        let (controls, mut data) = bytes.split_at(to.len().div_ceil(WORDS_PER_CONTROL));
        let (full, rest) = to.as_chunks_mut::<WORDS_PER_CONTROL>();
        let (full_controls, rest_control) = controls.split_at(full.len());
        for (&control, words) in full_controls.iter().zip(full) {
            let group = &GROUPS[usize::from(control)];
            let unpacked = match data.first_chunk() {
                Some(bytes) => unpack_group(group, bytes),
                None => unpack_group(group, &padded(data)),
            };
            words[0].write(unpacked[0]);
            words[1].write(unpacked[1]);
            words[2].write(unpacked[2]);
            words[3].write(unpacked[3]);
            data = &data[usize::from(group.bytes)..];
        }
        if let &[control] = rest_control {
            let unpacked = unpack_group(&GROUPS[usize::from(control)], &padded(data));
            rest.write_copy_of_slice(&unpacked[..rest.len()]);
        }
        // SAFETY: the full groups and the rest are all of `to`, and each word of them was written.
        unsafe { to.assume_init_ref() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_of(code: Vec<u32>) -> Body {
        Body {
            code,
            block_count: 1,
            value_count: 2,
        }
    }

    #[test]
    fn packed_words_come_back() {
        let edges = [
            0,
            1,
            2,
            0x7E,
            0x7F,
            0x80,
            0xFF,
            0x100,
            0x7FFE,
            0x7FFF,
            0x8000,
            0xFFFF,
            0x1_0000,
            0xFF_FFFF,
            0x100_0000,
            0x7FFF_FFFF,
            0x8000_0000,
            u32::MAX - 0x8000,
            u32::MAX - 0x7F,
            u32::MAX - 1,
            u32::MAX,
        ];
        for length in 1..40 {
            for first in 0..edges.len() {
                let words = (0..length).map(|at| edges[(first + at * 7) % edges.len()]);
                let words: Vec<u32> = core::iter::once(5).chain(words).collect();
                let mut body = body_of(words.clone());
                body.pack(&mut Vec::new());
                assert_eq!(body.word_count(), words.len());
                assert_eq!((body.block_count, body.value_count), (1, 2));
                body.unpack();
                assert_eq!(body.code, words);
            }
        }
    }

    #[test]
    fn incompressible_words_are_kept() {
        let words = vec![5, 0x1234_5678];
        let mut body = body_of(words.clone());
        body.pack(&mut Vec::new());
        assert_eq!(body.code, words);
        let mut empty = Body::default();
        empty.pack(&mut Vec::new());
        assert_eq!((empty.word_count(), empty.code.len()), (0, 0));
    }

    #[test]
    fn small_words_shrink_to_a_third() {
        let words: Vec<u32> = (0..4000)
            .map(|at| if at % 10 == 9 { u32::MAX } else { at % 100 })
            .collect();
        let mut body = body_of(words.clone());
        body.pack(&mut Vec::new());
        assert!(
            body.code.len() * 3 <= words.len() + words.len() / 10,
            "{}",
            body.code.len()
        );
        body.unpack();
        assert_eq!(body.code, words);
    }
}
