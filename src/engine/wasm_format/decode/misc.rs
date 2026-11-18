//! Instructions with the prefix 0xFC.

use bun_engine_asm::{FloatWidth, Sign, Width};

use super::{Decoder, Mode, Purpose, SIGNS};
use crate::error::Error;
use crate::visitor::Visitor;

impl<M: Mode> Decoder<'_, '_, M> {
    #[inline(never)]
    pub(super) fn misc<V: Visitor<Error = M::Error>>(&mut self, v: &mut V) -> Result<(), M::Error> {
        let kind = if self.is_dead() {
            "extended 0xfc"
        } else {
            "0xfc extended"
        };
        let op = read!(self, self.reader.u32(), "can't parse {kind} opcode");
        match op {
            0..=7 => {
                let op = op as usize;
                let from = [FloatWidth::F32, FloatWidth::F64][op >> 1 & 1];
                let to = [Width::W32, Width::W64][op >> 2];
                v.truncate_float_saturating(from, SIGNS[op & 1], to)
            }
            8 => {
                let data = self.data()?;
                v.memory_init(self.memory()?, data)
            }
            9 => v.data_drop(self.data()?),
            10 => {
                let dst = self.memory()?;
                v.memory_copy(dst, self.memory()?)
            }
            11 => {
                ensure!(
                    self,
                    !self.cx.header.memories.is_empty() || self.is_dead(),
                    validation,
                    "memory must be present"
                );
                v.memory_fill(self.memory()?)
            }
            12 => {
                let elem = self.elem()?;
                v.table_init(self.table()?, elem)
            }
            13 => v.elem_drop(self.elem()?),
            14 => {
                let dst = self.table_as("destination ")?;
                v.table_copy(dst, self.table_as("source ")?)
            }
            15 => v.table_grow(self.table()?),
            16 => v.table_size(self.table()?),
            17 => v.table_fill(self.table()?),
            19 => v.i64_add128(),
            20 => v.i64_sub128(),
            21 => v.i64_mul_wide(Sign::Signed),
            22 => v.i64_mul_wide(Sign::Unsigned),
            _ => fail!(self, parse, "invalid {kind} op {op}"),
        }
    }
}
