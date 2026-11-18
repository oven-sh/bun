//! Writes to the captures, and copies of words.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::program::{Op, Pairs};

use crate::frame::{ORIGIN, POSITION};
use crate::generator::Generator;

const PAIRS_UNROLLED: usize = 8;

impl Generator<'_> {
    pub(crate) fn capture_address(&self, entry: usize) -> Address {
        self.frame.captures.plus(entry as i32 * 4)
    }

    /// Returns the number of operations that are taken care of.
    pub(crate) fn capture(&mut self, offset: i16, entry: u32, follower: Option<Op>) -> usize {
        let index = self.frame.temporary(0);
        let position = self.plus(index, POSITION, offset.into());
        self.masm.sub32(index, position, ORIGIN);
        self.masm
            .store32(self.capture_address(entry as usize), index);
        let Some(Op::Capture {
            offset: next_offset,
            entry,
        }) = follower
        else {
            return 1;
        };
        let distance = i64::from(next_offset) - i64::from(offset);
        self.plus(index, index, distance);
        self.masm
            .store32(self.capture_address(entry as usize), index);
        2
    }

    pub(crate) fn clear(&mut self, pairs: Pairs) {
        let (start, count) = (
            self.capture_address(pairs.entries().start),
            pairs.entries().len() / 2,
        );
        if count == 1 {
            return self.masm.store64(start, -1);
        }
        let unset = self.frame.temporary(0);
        self.masm.move64(unset, -1);
        self.for_each_pair_of_words(count, [start], |masm, [at]| masm.store64(at, unset));
    }

    /// Overwrites the first two temporary registers.
    pub(crate) fn copy_words(&mut self, dst: Address, src: Address, count: usize) {
        let data = self.frame.temporary(0);
        self.for_each_pair_of_words(count / 2, [dst, src], |masm, [dst, src]| {
            masm.load64(data, src);
            masm.store64(dst, data);
        });
        if count % 2 != 0 {
            let last = (count as i32 - 1) * 4;
            self.masm.load32(data, src.plus(last));
            self.masm.store32(dst.plus(last), data);
        }
    }

    fn for_each_pair_of_words<const N: usize>(
        &mut self,
        count: usize,
        starts: [Address; N],
        write: impl Fn(&mut MacroAssembler, [Address; N]),
    ) {
        if count <= PAIRS_UNROLLED {
            for pair in 0..count as i32 {
                write(self.masm, starts.map(|it| it.plus(pair * 8)));
            }
            return;
        }
        let left = self.frame.temporary(1);
        self.masm.move32(left, count);
        let again = self.masm.here();
        let last = |it: Address| Address::indexed(it.base(), left, Scale::Eight, it.offset() - 8);
        write(self.masm, starts.map(last));
        (self.masm).branch_sub32(ResultCond::NonZero, left, left, 1, again);
    }
}
