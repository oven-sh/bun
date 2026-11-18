//! Instructions with the prefix 0xFE.

use bun_engine_asm::{AtomicOp, Size, Width};

use super::immediates::Access;
use super::{Decoder, Mode, Purpose};
use crate::error::Error;
use crate::visitor::Visitor;

const NOTIFY: u32 = 0x00;
const WAIT32: u32 = 0x01;
const WAIT64: u32 = 0x02;
const FENCE: u32 = 0x03;
const FIRST_ACCESS: u32 = 0x10;
const LAST_ACCESS: u32 = 0x4e;

/// Loads, stores, each of `UPDATES` and compare-exchange come in these forms.
const FORMS: [(Width, Size); 7] = [
    (Width::W32, Size::S32),
    (Width::W64, Size::S64),
    (Width::W32, Size::S8),
    (Width::W32, Size::S16),
    (Width::W64, Size::S8),
    (Width::W64, Size::S16),
    (Width::W64, Size::S32),
];
const UPDATES: [AtomicOp; 6] = [
    AtomicOp::Add,
    AtomicOp::Sub,
    AtomicOp::And,
    AtomicOp::Or,
    AtomicOp::Xor,
    AtomicOp::Exchange,
];

impl<M: Mode> Decoder<'_, '_, M> {
    #[inline(never)]
    pub(super) fn atomic<V: Visitor<Error = M::Error>>(
        &mut self,
        v: &mut V,
    ) -> Result<(), M::Error> {
        let op = read!(
            self,
            self.reader.u32(),
            "can't parse atomic extended opcode"
        );
        match op {
            NOTIFY => v.atomic_notify(self.mem_arg(Access::Atomic, 2)?),
            WAIT32 => v.atomic_wait(Width::W32, self.mem_arg(Access::Atomic, 2)?),
            WAIT64 => v.atomic_wait(Width::W64, self.mem_arg(Access::Atomic, 3)?),
            FENCE => {
                let flags = read!(self, self.reader.u8(), "can't get flags");
                ensure!(
                    self,
                    flags == 0,
                    parse,
                    "flags should be 0x0 but got {flags}"
                );
                v.atomic_fence()
            }
            FIRST_ACCESS..=LAST_ACCESS => {
                let number = (op - FIRST_ACCESS) as usize;
                let (family, (width, size)) = (number / FORMS.len(), FORMS[number % FORMS.len()]);
                let access = match family {
                    1 => Access::AtomicStore,
                    _ => Access::Atomic,
                };
                let arg = self.mem_arg(access, size.log2_bytes())?;
                match family {
                    0 => v.atomic_load(width, size, arg),
                    1 => v.atomic_store(width, size, arg),
                    2..=7 => v.atomic_update(UPDATES[family - 2], width, size, arg),
                    _ => v.atomic_compare_exchange(width, size, arg),
                }
            }
            _ => fail!(self, parse, "invalid extended atomic op {op}"),
        }
    }
}
