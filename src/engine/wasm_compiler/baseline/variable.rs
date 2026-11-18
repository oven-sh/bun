//! Locals and globals.

use bun_engine_asm::Bank;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{ConstExpr, GlobalIndex, ValType, VisitVariable};

use super::calls::Parameter;
use super::operand::{Operand, Place, bank};
use super::{Compiled, Function};
use crate::abi::{GlobalPlace, INSTANCE, NULL, Operation};

impl Function<'_> {
    /// The offset of what follows an instruction with one index, or of something that nothing looks for.
    #[inline(always)]
    fn after_index(&self) -> usize {
        match self.bytes[self.offset + 1] {
            0..0x80 => self.offset + 2,
            _ => self.offset,
        }
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitVariable for Function<'_> {
    #[inline]
    fn drop_(&mut self) -> Compiled {
        self.pop();
        Ok(())
    }

    #[inline(never)]
    fn select(&mut self, ty: Option<ValType>) -> Compiled {
        self.select_value(ty, self.offset + usize::from(ty.is_none()));
        Ok(())
    }

    #[inline(always)]
    fn local_get(&mut self, local: u32) -> Compiled {
        self.push_lazy(Operand::of_local(self.locals[local as usize].ty, local));
        Ok(())
    }

    #[inline(always)]
    fn local_set(&mut self, local: u32) -> Compiled {
        self.set_local(local);
        Ok(())
    }

    #[inline(always)]
    fn local_tee(&mut self, local: u32) -> Compiled {
        let value = self.top();
        self.set_local(local);
        self.push_lazy(match value.place() {
            Place::Constant(_) => value,
            _ => Operand::of_local(value.ty(), local),
        });
        Ok(())
    }

    #[inline(never)]
    fn global_get(&mut self, index: GlobalIndex) -> Compiled {
        let global = self.module.global(index);
        let bits = match global.init.filter(|_| !global.mutable) {
            Some(ConstExpr::I32(value)) => Some(u64::from(value as u32)),
            Some(ConstExpr::I64(value)) => Some(value as u64),
            Some(ConstExpr::F32(bits)) => Some(bits.into()),
            Some(ConstExpr::F64(bits)) => Some(bits),
            Some(ConstExpr::RefNull) => Some(NULL as u64),
            _ => None,
        };
        if let Some(bits) = bits {
            self.push_lazy(Operand::of_bits(global.ty, bits));
            return Ok(());
        }
        let address = self.global_address(index);
        let dst = self.result(self.after_index(), bank(global.ty.kind()));
        self.load(global.ty.kind(), dst, address);
        self.push_register(global.ty, dst);
        Ok(())
    }

    #[inline(never)]
    fn global_set(&mut self, index: GlobalIndex) -> Compiled {
        let value = self.pop();
        let is_ref = value.ty().is_ref();
        if is_ref && let GlobalPlace::Indirect(_) = self.env.layout.global(index) {
            let parameters = [
                Parameter::Immediate(index.0.into()),
                Parameter::Value(value),
            ];
            self.call_operation(Operation::GlobalSetReference, &parameters);
            return Ok(());
        }
        self.lock(value);
        let address = self.global_address(index);
        self.store_operand(address, value);
        if self.may_be_cell(value) {
            self.write_barrier(INSTANCE);
        }
        Ok(())
    }
}

impl Function<'_> {
    fn global_address(&mut self, index: GlobalIndex) -> Address {
        match self.env.layout.global(index) {
            GlobalPlace::Inline(offset) => Address::new(INSTANCE, offset),
            GlobalPlace::Indirect(offset) => {
                let value = self.take(Bank::Gpr).gpr();
                self.masm.load64(value, Address::new(INSTANCE, offset));
                Address::new(value, 0)
            }
        }
    }
}
