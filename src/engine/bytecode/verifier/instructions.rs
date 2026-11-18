//! One instruction after the other.

use super::scopes::names_a_scope;
use super::{Fault, NO_ENTRY, Verifier, VerifyError, mark};
use crate::code::{CodeFlags, CodeKind};
use crate::constant::Constant;
use crate::graph::refill;
use crate::instruction::{Flow, Opcode, RawInstruction, Shape};
use crate::operand::*;

const fn required_flags(opcode: Opcode) -> CodeFlags {
    match opcode {
        Opcode::ResumeDispatch
        | Opcode::CreateGenerator
        | Opcode::CreateAsyncGenerator
        | Opcode::Suspend
        | Opcode::Await
        | Opcode::Resume
        | Opcode::ResumeAfterYield
        | Opcode::ResumeAfterAwait
        | Opcode::ResumeAfterDelegate
        | Opcode::GeneratorReturn
        | Opcode::GeneratorThrow
        | Opcode::AsyncIteratorNext => CodeFlags::SUSPENDS,
        Opcode::GetInternalField
        | Opcode::PutInternalField
        | Opcode::GetByIdDirect
        | Opcode::ResumeGenerator
        | Opcode::HasShapeWithFlags
        | Opcode::NewPromise
        | Opcode::CreatePromise
        | Opcode::NewArrayWithSpecies
        | Opcode::ToObject => CodeFlags::BUILTIN,
        Opcode::TailCall | Opcode::TailCallVarargs | Opcode::TailCallWithSpread => {
            CodeFlags::HAS_TAIL_CALLS
        }
        Opcode::Debug | Opcode::JumpIfFrameIsKept => CodeFlags::HAS_DEBUG_HOOKS,
        Opcode::DebugAwait => CodeFlags::HAS_DEBUG_HOOKS.union(CodeFlags::SUSPENDS),
        Opcode::Cover => CodeFlags::HAS_COVERAGE,
        _ => CodeFlags::empty(),
    }
}

/// Whether more has to hold than that each operand is valid.
const fn has_rules_of_its_own(opcode: Opcode) -> bool {
    use Opcode::*;
    !required_flags(opcode).is_empty()
        || matches!(
            opcode,
            Wide16Prefix
                | Wide32Prefix
                | Enter
                | CreateThis
                | Catch
                | PostIncrement
                | PostDecrement
                | ThrowError
        )
}

/// For each opcode, the first that is checked in the same way.
static FIRST_ALIKE: [Opcode; Opcode::COUNT] = {
    const fn are_alike(a: Opcode, b: Opcode) -> bool {
        let (mut left, mut right) = (a.shapes(), b.shapes());
        while let ([x, xs @ ..], [y, ys @ ..]) = (left, right)
            && *x as u8 == *y as u8
        {
            (left, right) = (xs, ys);
        }
        left.is_empty()
            && right.is_empty()
            && has_rules_of_its_own(a) == has_rules_of_its_own(b)
            && !names_a_scope(a)
            && !names_a_scope(b)
    }
    let (mut first, mut index) = (Opcode::ALL, 0);
    while index < Opcode::COUNT {
        let mut earlier = 0;
        while earlier < index && !are_alike(Opcode::ALL[earlier], Opcode::ALL[index]) {
            earlier += 1;
        }
        first[index] = Opcode::ALL[earlier];
        index += 1;
    }
    first
};

/// An instruction whose operands, and what comes after them, are as they are stored.
struct Stored {
    opcode: Opcode,
    size: u32,
    units: [u32; Opcode::MAX_OPERANDS],
    /// If it has any.
    metadata: u32,
    sign: u32,
    first_constant: i32,
}

const WINDOW: usize = 32;

impl Stored {
    #[inline(always)]
    fn read(window: &[u8; WINDOW]) -> Option<Stored> {
        const WIDE16: u8 = Opcode::Wide16Prefix as u8;
        const WIDE32: u8 = Opcode::Wide32Prefix as u8;
        match window[0] {
            WIDE16 => Self::read_as::<Wide16>(window),
            WIDE32 => Self::read_as::<Wide32>(window),
            _ => Self::read_as::<Narrow>(window),
        }
    }

    #[inline(always)]
    fn read_as<W: Width>(window: &[u8; WINDOW]) -> Option<Stored> {
        let bytes = &window[W::PREFIX_BYTES..];
        let opcode = Opcode::from_byte(bytes[0])?;
        let (operands, size) = opcode.operands_and_size::<W>();
        Some(Stored {
            opcode,
            size: size as u32,
            units: core::array::from_fn(|index| W::unsigned(bytes, index)),
            metadata: W::metadata(bytes, operands.min(Opcode::MAX_OPERANDS)),
            sign: 1 << (8 * W::OPERAND_BYTES - 1),
            first_constant: W::FIRST_CONSTANT,
        })
    }

    /// As `Wide32` stores it.
    #[inline(always)]
    fn word<const SHAPE: u8>(&self, index: usize) -> u32 {
        let signed = (self.units[index] ^ self.sign).wrapping_sub(self.sign) as i32;
        if const { !Shape::ALL[SHAPE as usize].is_signed() } {
            self.units[index]
        } else if const { SHAPE == Shape::Src as u8 } && signed >= self.first_constant {
            (signed - self.first_constant + Wide32::FIRST_CONSTANT) as u32
        } else {
            signed as u32
        }
    }
}

macro_rules! define_checks {
    ($(
        $(#[$doc:meta])*
        $name:ident $mnemonic:ident $flow:ident { $($field:ident: $shape:ident),* } $(=> $metadata:ident)?;
    )*) => {
        impl Verifier<'_> {
            /// With code of its own for each list of shapes.
            #[inline(always)]
            #[allow(unused_assignments, unused_mut, unused_variables, clippy::large_unopt_stack_frames)]
            fn check_operands(&mut self, offset: u32, stored: &Stored) -> Result<(), Fault> {
                let opcode = stored.opcode;
                match FIRST_ALIKE[opcode as usize] {
                    $(Opcode::$name if const { FIRST_ALIKE[Opcode::$name as usize] as u8 == Opcode::$name as u8 } => {
                        let mut index = 0;
                        let words = [$({
                            index += 1;
                            stored.word::<{ Shape::$shape as u8 }>(index - 1)
                        }),*];
                        if const { has_rules_of_its_own(Opcode::$name) } {
                            self.check_rules(opcode, offset + stored.size, &words)?;
                        }
                        index = 0;
                        $(
                            self.check_operand::<{ Shape::$shape as u8 }>(opcode, offset, &words, index)?;
                            index += 1;
                        )*
                        if const { names_a_scope(Opcode::$name) } {
                            self.check_scopes(Opcode::$name, &words)?;
                        }
                        Ok(())
                    })*
                    _ => unreachable!(),
                }
            }
        }
    };
}

crate::instruction_table!(define_checks);

impl Verifier<'_> {
    pub(super) fn check_instructions(&mut self) -> Result<(), VerifyError> {
        let (mut code, mut copy) = (self.body.padded_instructions(), Vec::new());
        let (mut offset, size) = (0, self.instructions.len());
        if code.len() < size + WINDOW {
            refill(&mut copy, size + WINDOW, 0).map_err(|_| Fault::TooLarge)?;
            copy[..size].copy_from_slice(self.instructions);
            code = &copy;
        }
        while (offset as usize) < size {
            let window = code[offset as usize..].first_chunk().expect("padded");
            let checked = self.check_instruction(offset, window);
            offset += checked.map_err(|fault| VerifyError {
                fault,
                offset: Some(offset),
            })?;
        }
        self.previous
            .is_some_and(|last| matches!(last.flow(), Flow::Jumps | Flow::Ends))
            .ok_or(Fault::FallsOffTheEnd)?;
        (self.suspend_points as usize == self.body.suspend_points().len())
            .ok_or(Fault::SuspendPoints)?;
        Ok(())
    }

    /// Returns the size.
    #[inline(always)]
    fn check_instruction(&mut self, offset: u32, window: &[u8; WINDOW]) -> Result<u32, Fault> {
        let stored = Stored::read(window)
            .filter(|it| (offset + it.size) as usize <= self.instructions.len())
            .ok_or(Fault::NotAnInstruction)?;
        let (opcode, metadata) = (stored.opcode, stored.metadata);
        if let None | Some(Opcode::Enter) = self.previous {
            self.may_follow(opcode).ok_or(Fault::Order)?;
        }
        self.check_operands(offset, &stored)?;
        if let Some(kind) = opcode.metadata() {
            let next = &mut self.next_entries[kind as usize];
            (metadata == *next && metadata != NO_ENTRY).ok_or(Fault::Metadata)?;
            *next = metadata.wrapping_add(kind.words());
        }
        self.previous = Some(opcode);
        self.marks[offset as usize] |= match opcode {
            Opcode::Enter | Opcode::ResumeDispatch | Opcode::Catch | Opcode::Resume => mark::START,
            _ => mark::START | mark::OPEN,
        };
        Ok(stored.size)
    }

    #[inline(never)]
    fn check_rules(&self, opcode: Opcode, end: u32, words: &[u32]) -> Result<(), Fault> {
        let flags = self.body.flags;
        flags.contains(required_flags(opcode)).ok_or(Fault::Flags)?;
        (opcode as u8 > Opcode::Wide32Prefix as u8).ok_or(Fault::NotAnInstruction)?;
        self.may_follow(opcode).ok_or(Fault::Order)?;
        let next = || RawInstruction::read(self.instructions, end);
        match opcode {
            Opcode::Suspend | Opcode::Await => next()
                .is_some_and(|it| it.opcode == Opcode::Resume)
                .ok_or(Fault::Order),
            Opcode::TailCall | Opcode::TailCallVarargs | Opcode::TailCallWithSpread => next()
                .is_some_and(|it| it.opcode == Opcode::Return && it.words()[0] == words[0])
                .ok_or(Fault::Order),
            Opcode::CreateThis => (self.body.kind == CodeKind::Construct).ok_or(Fault::Flags),
            Opcode::PostIncrement | Opcode::PostDecrement => {
                (words[0] != words[1]).ok_or(Fault::Operand(1))
            }
            Opcode::ThrowError => (Operand::from_word(words[1]).as_constant())
                .and_then(|constant| self.code.constants.get(constant as usize))
                .is_none_or(|it| matches!(it, Constant::String(_) | Constant::LongString(_)))
                .ok_or(Fault::Operand(1)),
            _ => Ok(()),
        }
    }

    fn may_follow(&self, opcode: Opcode) -> bool {
        let Some(previous) = self.previous else {
            return opcode == Opcode::Enter;
        };
        let suspends = self.body.flags.contains(CodeFlags::SUSPENDS);
        match opcode {
            _ if previous == Opcode::Enter && suspends => opcode == Opcode::ResumeDispatch,
            Opcode::Enter | Opcode::ResumeDispatch => false,
            Opcode::Resume => matches!(previous, Opcode::Suspend | Opcode::Await),
            Opcode::Catch => !previous.flow().falls_through(),
            _ => true,
        }
    }

    pub(super) fn check_targets(&self) -> Result<(), VerifyError> {
        let is_bad = |&mark: &u8| mark & (mark::TARGET | mark::OPEN) == mark::TARGET;
        if !self.marks.iter().fold(false, |any, it| any | is_bad(it)) {
            return Ok(());
        }
        Err(VerifyError {
            fault: Fault::Target,
            offset: self.marks.iter().position(is_bad).map(|it| it as u32),
        })
    }
}
