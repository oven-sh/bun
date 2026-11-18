//! Between offsets in the bytecode and places in the machine code.

#![forbid(unsafe_code)]

use bun_engine_bytecode::Opcode;

/// Of an instruction.
#[derive(Clone, Copy)]
pub(crate) struct Start {
    /// In the bytecode.
    pub(crate) size: u8,
    pub(crate) is_entered_often: bool,
    pub(crate) code: u32,
    /// The offset of a register, or zero.
    pub(crate) carried: i32,
}

/// An instruction from which those that follow count.
struct Anchor {
    index: u32,
    offset: u32,
    code: u32,
    carried: i32,
}

/// The distance in the code from the one before above the size, and the register.
type Entry = [u8; 3];

const SIZE_BITS: u32 = 5;

const _: () = assert!(Opcode::MAX_SIZE < 1 << SIZE_BITS);

pub(crate) struct Starts {
    anchors: Box<[Anchor]>,
    entries: Box<[Entry]>,
}

impl Starts {
    /// One for each instruction, from the first on.
    pub(crate) fn new(starts: impl ExactSizeIterator<Item = Start>) -> Starts {
        const LONGEST_RUN: u32 = 16;
        let mut anchors = Vec::with_capacity(starts.len().div_ceil(LONGEST_RUN as usize));
        let mut entries = Vec::with_capacity(starts.len());
        let (mut offset, mut previous, mut run) = (0, 0, LONGEST_RUN);
        for start in starts {
            let (mut distance, carried) = (start.code - previous, start.carried as i8);
            if run == LONGEST_RUN
                || start.is_entered_often
                || distance >> (u16::BITS - SIZE_BITS) != 0
                || i32::from(carried) != start.carried
            {
                anchors.push(Anchor {
                    index: entries.len() as u32,
                    offset,
                    code: start.code,
                    carried: start.carried,
                });
                (distance, run) = (0, 0);
            }
            let [low, high] =
                ((distance << SIZE_BITS) as u16 | u16::from(start.size)).to_le_bytes();
            entries.push([low, high, carried as u8]);
            (offset, previous, run) = (offset + u32::from(start.size), start.code, run + 1);
        }
        Starts {
            anchors: anchors.into(),
            entries: entries.into(),
        }
    }

    /// From the last anchor that is `not_past` up to the next: the offset, the place in the code and the register.
    fn run(&self, not_past: impl Fn(&Anchor) -> bool) -> impl Iterator<Item = (u32, u32, i32)> {
        let next = self.anchors.partition_point(not_past).max(1);
        let anchor = &self.anchors[next - 1];
        let end = (self.anchors.get(next)).map_or(self.entries.len(), |it| it.index as usize);
        let (mut offset, mut code, mut first) = (anchor.offset, anchor.code, Some(anchor.carried));
        (self.entries[anchor.index as usize..end].iter()).map(move |&[low, high, carried]| {
            let at = offset;
            offset += u32::from(low & ((1 << SIZE_BITS) - 1));
            code += u32::from(u16::from_le_bytes([low, high]) >> SIZE_BITS);
            let carried = first.take().unwrap_or_else(|| (carried as i8).into());
            (at, code, carried)
        })
    }

    /// The place in the code and the register. Panics unless an instruction starts there.
    pub(crate) fn find(&self, offset: u32) -> (u32, i32) {
        let mut run = self.run(|anchor| anchor.offset <= offset);
        let found = run.find(|it| it.0 == offset);
        let (_, code, carried) = found.expect("the start of an instruction");
        (code, carried)
    }

    /// Of the last instruction that starts no later.
    pub(crate) fn offset_at(&self, code: u32) -> u32 {
        let run = self.run(|anchor| anchor.code <= code);
        (run.take_while(|it| it.1 <= code).last()).map_or(0, |it| it.0)
    }

    pub(crate) fn size(&self) -> usize {
        size_of_val(&*self.anchors) + size_of_val(&*self.entries)
    }
}

#[cfg(test)]
mod tests {
    use bun_engine_standalone as _;

    use super::*;

    #[test]
    fn what_is_put_in_is_found() {
        let (mut offset, mut code) = (0, 40);
        let starts: Vec<_> = (0..100)
            .map(|index| {
                let (at, size) = (offset, 1 + index % 30);
                offset += u32::from(size);
                code += [0, 9, 2047, 2048, 70_000][usize::from(index % 5)];
                let carried = [0, -3, 127, -128, -129, 1 << 20][usize::from(index % 6)];
                let start = Start {
                    size,
                    is_entered_often: index % 7 == 0,
                    code,
                    carried,
                };
                (at, start)
            })
            .collect();
        let table = Starts::new(starts.iter().map(|it| it.1));
        for &(offset, start) in &starts {
            assert_eq!(table.find(offset), (start.code, start.carried));
            let last = starts.iter().rfind(|it| it.1.code <= start.code + 1);
            assert_eq!(table.offset_at(start.code + 1), last.unwrap().0);
        }
        assert_eq!(table.offset_at(0), 0);
    }
}
