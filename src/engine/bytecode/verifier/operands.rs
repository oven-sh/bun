//! Each operand by its shape.

use bun_engine_syntax::EvalContext;

use super::{Fault, Verifier, mark};
use crate::code::Body;
use crate::constant::Constant;
use crate::instruction::{Opcode, RawInstruction, Shape};
use crate::operand::*;
use crate::scope::ScopeKind;

/// The highest value, if that is all there is to it.
const fn highest(shape: Shape) -> Option<u32> {
    Some(match shape {
        Shape::Count => u32::MAX,
        Shape::Flag => 1,
        Shape::Unresolved => Unresolved::COUNT - 1,
        Shape::ErrorKind => ErrorKind::COUNT - 1,
        Shape::StaticError => StaticError::COUNT - 1,
        Shape::SuspendKind => SuspendKind::COUNT - 1,
        Shape::CloseMode => CloseMode::COUNT - 1,
        Shape::ImportPhase => ImportPhase::COUNT - 1,
        Shape::DebugHook => DebugHook::COUNT - 1,
        Shape::ArrayShape => ArrayShape::COUNT - 1,
        Shape::PutFlags => low_bits(PutFlags::all().bits()),
        Shape::DefineFlags => low_bits(DefineFlags::all().bits()),
        Shape::Context => low_bits(EvalContext::all().bits()),
        Shape::CellType => u8::MAX as u32,
        _ => return None,
    })
}

const fn low_bits(all: u8) -> u32 {
    assert!((all as u32 + 1).is_power_of_two());
    all as u32
}

pub(super) fn is_source(constant: &Constant) -> bool {
    !matches!(constant, Constant::Array(_) | Constant::RegExp(_))
}

fn use_once(used: &mut [bool], index: u32) -> bool {
    let is_used = used.get_mut(index as usize);
    is_used.is_some_and(|is_used| !core::mem::replace(is_used, true))
}

impl Verifier<'_> {
    #[inline(always)]
    fn note_target(&mut self, target: u32) -> Result<(), Fault> {
        *self.marks.get_mut(target as usize).ok_or(Fault::Target)? |= mark::TARGET;
        Ok(())
    }

    fn note_targets(&mut self, offset: u32) -> Result<(), Fault> {
        let (instruction, mut result) = (RawInstruction::read(self.instructions, offset), Ok(()));
        (instruction.expect("read before")).for_each_target(self.body, offset, |target| {
            result = result.and_then(|()| self.note_target(target));
        });
        result
    }

    /// The common shapes are dealt with on the spot.
    #[inline(always)]
    pub(super) fn check_operand<const SHAPE: u8>(
        &mut self,
        opcode: Opcode,
        offset: u32,
        words: &[u32],
        index: usize,
    ) -> Result<(), Fault> {
        const fn is(shape: u8, among: &[Shape]) -> bool {
            matches!(among, [first, rest @ ..] if *first as u8 == shape || is(shape, rest))
        }
        let (word, shape) = (words[index], const { Shape::ALL[SHAPE as usize] });
        let register = Register::from_word(word);
        let is_valid = if const { highest(Shape::ALL[SHAPE as usize]).is_some() } {
            highest(shape).is_some_and(|highest| word <= highest)
        } else if const { is(SHAPE, &[Shape::Target]) } {
            return self.note_target(Jump(word as i32).from(offset));
        } else if const { is(SHAPE, &[Shape::Dst, Shape::Mut]) } {
            self.is_writable(register) || self.keeps_scope(opcode, words)
        } else if const { is(SHAPE, &[Shape::Reg]) } {
            self.is_readable(register)
        } else if const { is(SHAPE, &[Shape::Src]) } {
            let constant = word.wrapping_sub(Operand::constant(0).word());
            (self.is_readable(register) | (constant < self.first_sources))
                || self.is_source(constant)
        } else if const { is(SHAPE, &[Shape::Name]) } {
            (word as usize) < self.code.identifiers.len()
                && (!self.names_an_index || self.may_name(opcode, word))
        } else if const { is(SHAPE, &[Shape::Unsigned]) } {
            word <= Body::MAX_FRAME_WORDS || opcode == Opcode::HasShapeWithFlags
        } else if const { is(SHAPE, &[Shape::ArgumentCount]) } {
            word != 0
        } else if const { is(SHAPE, &[Shape::Frame]) } {
            self.is_frame(word, words[index - 1])
        } else if const { is(SHAPE, &[Shape::Frame1, Shape::Frame2]) } {
            self.is_frame(word, u32::from(2 + SHAPE - Shape::Frame1 as u8))
        } else {
            return self.check_other_operand(opcode, offset, words, index, shape);
        };
        is_valid.ok_or(Fault::Operand(index as u8))
    }

    /// For a debugger.
    #[cold]
    fn keeps_scope(&self, opcode: Opcode, words: &[u32]) -> bool {
        opcode == Opcode::Move && words == [Register::SCOPE.word(); 2]
    }

    #[inline(never)]
    fn is_source(&self, constant: u32) -> bool {
        (self.code.constants.get(constant as usize)).is_some_and(is_source)
    }

    #[cold]
    fn may_name(&self, opcode: Opcode, identifier: u32) -> bool {
        matches!(opcode, Opcode::ThrowStatic | Opcode::ThrowIfNullish)
            || (self.code.identifiers[identifier as usize].name().as_index()).is_none()
    }

    #[inline(always)]
    fn is_parameter(&self, register: Register) -> bool {
        register.word().wrapping_sub(Register::THIS.word()) < self.parameters
    }

    /// The scope of the callee stays, which is why no suspend point saves it.
    #[inline(always)]
    pub(super) fn is_writable(&self, register: Register) -> bool {
        (register.word().wrapping_add(self.locals) < self.locals - 1) | self.is_parameter(register)
    }

    #[inline(always)]
    fn is_readable(&self, register: Register) -> bool {
        (register.word().wrapping_add(self.locals) < self.locals)
            | self.is_parameter(register)
            | (register == Register::CALLEE)
    }

    #[inline]
    pub(super) fn is_run(&self, first: Register, count: u32) -> bool {
        first
            .local_index()
            .is_some_and(|local| u64::from(local) + u64::from(count) <= u64::from(self.body.locals))
    }

    /// `arguments` counts `this`. The callee has an even number of words, and local 0 is not among them.
    #[inline]
    fn is_frame(&self, frame: u32, arguments: u32) -> bool {
        let words = u64::from(Register::HEADER_WORDS) + u64::from(arguments);
        frame.is_multiple_of(2)
            && frame <= self.body.locals
            && words.next_multiple_of(2) < u64::from(frame)
    }

    #[inline(never)]
    fn check_other_operand(
        &mut self,
        opcode: Opcode,
        offset: u32,
        words: &[u32],
        index: usize,
        shape: Shape,
    ) -> Result<(), Fault> {
        let (code, body) = (self.code, self.body);
        let word = words[index];
        let register = Register::from_word(word);
        let is_index = |len: usize| (word as usize) < len;
        let is_valid = match shape {
            Shape::DstIfJumps | Shape::DstUnlessJumps => self.is_writable(register),
            Shape::Dst2 => self.is_writable(register) && self.is_run(register, 2),
            Shape::Dst3 | Shape::Mut3 => self.is_writable(register) && self.is_run(register, 3),
            Shape::Reg2 => self.is_run(register, 2),
            Shape::Reg3 => self.is_run(register, 3),
            Shape::First => match words[index + 1] {
                0 => !matches!(opcode, Opcode::CallWithSpread | Opcode::TailCallWithSpread),
                count => self.is_run(register, count),
            },
            Shape::Variables => word < body.locals,
            Shape::Parameter => word < body.parameters - 1,
            Shape::Names => code.name_lists.get(word as usize).is_some_and(|names| {
                if opcode != Opcode::NewObjectLiteral {
                    return true;
                }
                self.literal_name_lists[word as usize] = true;
                names.len() == words[index + 2] as usize
            }),
            Shape::Function => code.functions.get(word as usize).is_some_and(|function| {
                function.kind().is_class_constructor() == (opcode == Opcode::NewClass)
            }),
            Shape::Scope => code.scopes.get(word as usize).is_some_and(|scope| {
                (scope.kind() == ScopeKind::With) == (opcode == Opcode::CreateWithScope)
            }),
            Shape::ArrayConstant => {
                matches!(code.constants.get(word as usize), Some(Constant::Array(_)))
            }
            Shape::RegExpConstant => {
                matches!(code.constants.get(word as usize), Some(Constant::RegExp(_)))
            }
            Shape::IntSwitch => use_once(self.used_int_switches, word),
            Shape::StringSwitch => use_once(self.used_string_switches, word),
            Shape::SpreadMask => is_index(body.spread_masks().len()),
            Shape::SuspendPoint => self.is_next_suspend_point(opcode, offset, words, word),
            Shape::CoverageBlock => is_index(body.coverage_blocks().len()),
            _ => unreachable!(),
        };
        is_valid.ok_or(Fault::Operand(index as u8))?;
        match shape {
            Shape::IntSwitch | Shape::StringSwitch => self.note_targets(offset),
            _ => Ok(()),
        }
    }

    /// The points are in the order of the code.
    fn is_next_suspend_point(
        &mut self,
        opcode: Opcode,
        offset: u32,
        words: &[u32],
        index: u32,
    ) -> bool {
        let Some(point) = self.body.suspend_points().get(index as usize) else {
            return false;
        };
        if index != self.suspend_points {
            return false;
        }
        match opcode {
            Opcode::Resume => {
                self.suspend_points += 1;
                point.resume == offset
            }
            Opcode::Await => point.suspend == offset && point.kind == SuspendKind::Await,
            _ => point.suspend == offset && point.kind.word() == words[2],
        }
    }
}
