//! Locals, globals and `select`.

use bun_engine_wasm_compiler::abi::GlobalPlace;
use bun_engine_wasm_format::{ConstExpr, GlobalIndex, ValKind, ValType, VisitVariable};

use super::emit::Register;
use super::operands::{Effect, Operand, Place, pair};
use super::{Done, Local, Translator};
use crate::run::{global, moves};

impl Translator<'_> {
    fn assign(&mut self, local: Local) -> Done<Operand> {
        let value = self.pop();
        self.settle_readers_of(local.slot)?;
        let is_there =
            value.place == Place::Own && self.redirect_result(value.slot, local.slot, local.kind);
        if !is_there {
            self.put(local.slot, value)?;
        }
        Ok(value)
    }

    fn place_of(&self, global: GlobalIndex) -> (bool, u32) {
        match self.module.layout().global(global) {
            GlobalPlace::Inline(offset) => (false, offset as u32),
            GlobalPlace::Indirect(offset) => (true, offset as u32),
        }
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitVariable for Translator<'_> {
    fn drop_(&mut self) -> Done {
        self.pop();
        Ok(())
    }

    fn select(&mut self, _: Option<ValType>) -> Done {
        let kind = self.operands[self.operands.len() - 2].kind;
        let [first, second, condition] = self.pop_in_slots()?;
        let rest = pair(second, condition);
        if kind == ValKind::V128 {
            return self.produce(kind, moves::select_vector, first, rest);
        }
        let handler = moves::for_select(self.is_last(Register::Int, condition));
        let result = (kind, Effect::Sets(Register::Int));
        self.produce_with(result, handler, first, rest, &[])
    }

    #[inline]
    fn local_get(&mut self, local: u32) -> Done {
        let Local { slot, kind } = self.locals[local as usize];
        self.push(kind, Place::Local(slot));
        Ok(())
    }

    fn local_set(&mut self, local: u32) -> Done {
        self.assign(self.locals[local as usize]).map(drop)
    }

    fn local_tee(&mut self, local: u32) -> Done {
        let local = self.locals[local as usize];
        let place = match self.assign(local)?.place {
            constant @ Place::Constant(_) => constant,
            _ => Place::Local(local.slot),
        };
        self.push(local.kind, place);
        Ok(())
    }

    fn global_get(&mut self, index: GlobalIndex) -> Done {
        let declared = self.module.global(index);
        let kind = declared.ty.kind();
        match declared.init.filter(|_| !declared.mutable) {
            Some(ConstExpr::I32(value)) => return self.push_constant(kind, (value as u32).into()),
            Some(ConstExpr::I64(value)) => return self.push_constant(kind, value as u64),
            Some(ConstExpr::F32(bits)) => return self.push_constant(kind, bits.into()),
            Some(ConstExpr::F64(bits)) => return self.push_constant(kind, bits),
            _ => {}
        }
        let ((is_indirect, offset), is_vector) = (self.place_of(index), kind == ValKind::V128);
        let effect = match is_vector {
            true => Effect::Keeps,
            false => Effect::Sets(Register::Int),
        };
        let handler = global::for_get(is_indirect, is_vector);
        self.produce_with((kind, effect), handler, 0, offset, &[])
    }

    fn global_set(&mut self, index: GlobalIndex) -> Done {
        let ((is_indirect, offset), (value, _)) = (self.place_of(index), self.pop_in_slot()?);
        match self.module.global(index).ty.kind() {
            ValKind::V128 => self.emit(global::for_set_vector(is_indirect), value, 0, offset),
            ValKind::Ref => {
                self.forget_last_results();
                match is_indirect {
                    true => self.emit(global::set_indirect_reference, value, 0, index.0),
                    false => self.emit(global::set_reference, value, 0, offset),
                }
            }
            _ => {
                let handler = global::for_set(is_indirect, self.is_last(Register::Int, value));
                self.emit(handler, value, 0, offset)
            }
        }
    }
}
