//! Operands, results, and what is known of them.

use bun_engine_asm::RegOrImm;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{Constant, MetadataKind, Opcode, Operand, RawInstruction, Register};
use bun_engine_vm::{Arithmetic, Value};

use super::{Compiler, metadata, slot};
use crate::emit::Emit;
use crate::profiles::Likely;
use crate::registers::*;

impl Compiler<'_> {
    pub(super) fn constant(&self, operand: Operand) -> Option<&Constant> {
        Some(&self.code.constants[operand.as_constant()? as usize])
    }

    pub(super) fn int32_constant(&self, operand: Operand) -> Option<i32> {
        match self.constant(operand) {
            Some(&Constant::Int32(value)) => Some(value),
            _ => None,
        }
    }

    /// The bits of a constant that is no cell.
    pub(super) fn immediate(&self, operand: Operand) -> Option<RegOrImm> {
        let trusted = |value: Value| RegOrImm::from(value.to_bits());
        Some(match *self.constant(operand)? {
            Constant::Empty => 0.into(),
            Constant::Undefined => trusted(Value::UNDEFINED),
            Constant::Null => trusted(Value::NULL),
            Constant::Boolean(value) => trusted(value.into()),
            Constant::Int32(value) => Untrusted(Value::int32(value).to_bits()).into(),
            Constant::Double(value) => Untrusted(Value::double(value).to_bits()).into(),
            _ => return None,
        })
    }

    pub(super) fn is_never_cell(&self, operand: Operand) -> bool {
        self.immediate(operand).is_some()
    }

    /// Word `index` of the constants, the functions and the scopes.
    pub(super) fn linked(&self, index: usize) -> Address {
        metadata(self.first_constant + index as u32, 0)
    }

    pub(super) fn load(&mut self, dst: Gpr, operand: impl Into<Operand>) {
        let operand = operand.into();
        match operand.as_register() {
            Some(register) if self.incoming == Some(register) => {
                self.uses_incoming = true;
                return self.m.move64(dst, T0);
            }
            Some(register) => self.m.load64(dst, slot(register)),
            None => match self.immediate(operand) {
                Some(bits) => self.m.move64(dst, bits),
                None => {
                    let index = operand.as_constant().unwrap_or_default();
                    self.m.load64(dst, self.linked(index as usize));
                }
            },
        }
        if dst == T0 {
            self.incoming = None;
        }
    }

    /// Into `T0` and `T1`.
    pub(super) fn load_both(&mut self, first: Operand, second: Operand) {
        self.load(T1, second);
        self.load(T0, first);
    }

    pub(super) fn store(&mut self, dst: Register, src: impl Into<RegOrImm>) {
        self.m.store64(slot(dst), src);
    }

    /// The last step of an instruction whose result is in `T0`.
    pub(super) fn store_result(&mut self, dst: Register) {
        self.store(dst, T0);
        self.carried = Some(dst);
    }

    /// The value in `T0`.
    pub(super) fn record_value(&mut self, word: u32) {
        if self.records {
            self.m.store64(metadata(word, 0), T0);
        }
    }

    pub(super) fn store_profiled_result(&mut self, dst: Register, word: u32) {
        self.record_value(word);
        self.store_result(dst);
    }

    /// `T0` is 0 or 1.
    pub(super) fn store_boolean_result(&mut self, dst: Register) {
        self.m.box_boolean(T0, T0);
        self.store_result(dst);
        self.carries_boolean = true;
    }

    /// The instruction has loaded the operand into `T0`, left it there, and written no register.
    pub(super) fn keep(&mut self, operand: impl Into<Operand>) {
        self.carried = operand.into().as_register();
    }

    /// The instruction has not touched `T0` on its usual way, nor the register whose value is there.
    pub(super) fn pass_on_incoming(&mut self) {
        self.carried = self.incoming;
        self.uses_incoming |= self.incoming.is_some();
    }

    pub(super) fn likely(&self, operand: Operand) -> Likely {
        let Some(register) = operand.as_register() else {
            return match self.constant(operand) {
                Some(Constant::Int32(_)) => Likely::Int32,
                Some(Constant::Double(_)) => Likely::Double,
                Some(Constant::Boolean(_)) => Likely::Boolean,
                _ if self.is_never_cell(operand) => Likely::Unknown,
                _ => Likely::Cell,
            };
        };
        match register.local_index() {
            Some(index) => self.likely_locals[index as usize],
            None => (register.offset() - Register::THIS.offset())
                .try_into()
                .map_or(Likely::Cell, |index| self.profiles.argument(index)),
        }
    }

    pub(super) fn note_results(&mut self, raw: &RawInstruction) {
        let likely = match (raw.opcode, raw.opcode.metadata()) {
            (Opcode::Move, _) => self.likely(Operand::from_word(raw.words()[1])),
            _ if self.carries_boolean => Likely::Boolean,
            (_, Some(MetadataKind::UnaryArithmetic | MetadataKind::BinaryArithmetic)) => {
                let seen = self.profiles.arithmetic(raw.metadata);
                if seen.contains(Arithmetic::RESULT_DOUBLE) {
                    Likely::Double
                } else if seen.intersects(Arithmetic::RESULT_STRING | Arithmetic::RESULT_BIGINT) {
                    Likely::Cell
                } else {
                    Likely::Int32
                }
            }
            (_, Some(MetadataKind::NewObject | MetadataKind::NewArray))
            | (Opcode::NewFunction | Opcode::Concatenate | Opcode::Typeof | Opcode::ToString, _) => {
                Likely::Cell
            }
            _ => self.profiles.result(raw),
        };
        let mut likely = Some(likely);
        raw.for_each_def(self.body, |run, _| {
            for index in run.registers().filter_map(Register::local_index) {
                self.likely_locals[index as usize] = likely.take().unwrap_or_default();
            }
        });
    }

    /// After a store into `T1`. Leaves `T0` alone.
    pub(super) fn barrier(&mut self) {
        let end = self.end();
        let remember = self.cold_alone(end, |c, cold| {
            c.m.call_address(c.thunks.write_barrier);
            c.m.jump(cold.resume);
        });
        self.m.branch_if_needs_barrier(T1, T2, remember);
    }

    /// The same, if `value`, which is in `reg`, is a cell.
    pub(super) fn barrier_for(&mut self, value: Operand, reg: Gpr) {
        if self.is_never_cell(value) {
            return;
        }
        if self.likely(value) != Likely::Cell {
            let end = self.end();
            self.m.branch_if_not_cell(reg, end);
        }
        self.barrier();
    }
}
