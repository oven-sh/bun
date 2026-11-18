//! Recognizes functions of two arguments that do nothing but compare one part of them.

use core::cmp::Ordering;

use crate::code::Code;
use crate::constant::Constant;
use crate::instruction::Instruction;
use crate::operand::{IdentifierIndex, Operand, Register};

/// The part that is compared.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SortKey {
    Whole,
    Property(IdentifierIndex),
    Length,
    Element(u32),
}

/// What a function returns, if getting the keys has no effect and they are all strings or all numbers but NaN.
#[derive(Clone, Copy, Debug)]
pub struct Comparator {
    pub key: SortKey,
    /// Not known for strings.
    pub subtracts: bool,
    results: [Known; 3],
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Known {
    Boolean(bool),
    /// Of a difference, only whether it is below zero is right.
    Number(f64),
}

impl Comparator {
    /// When the key of the first argument is in that order to the key of the second.
    pub fn result(&self, order: Ordering) -> Known {
        self.results[(order as i8 + 1) as usize]
    }
}

#[derive(Clone, Copy)]
enum Abstract {
    Known(Known),
    Key { is_first: bool },
    Difference(Ordering),
}

const MAX_SIZE: usize = 128;
const MAX_LOCALS: usize = 8;

struct Run<'a> {
    code: &'a Code,
    key: Option<SortKey>,
    subtracts: bool,
    order: Ordering,
    locals: [Option<Abstract>; MAX_LOCALS],
}

fn is_first_argument(operand: Operand) -> Option<bool> {
    let register = operand.as_register()?;
    let is_first = register == Register::argument(0);
    (is_first || register == Register::argument(1)).then_some(is_first)
}

impl Run<'_> {
    fn key_of(&mut self, base: Operand, key: SortKey) -> Option<Abstract> {
        let is_first = is_first_argument(base)?;
        (*self.key.get_or_insert(key) == key).then_some(Abstract::Key { is_first })
    }

    fn get(&mut self, operand: Operand) -> Option<Abstract> {
        if let Some(index) = operand.as_constant() {
            return Some(Abstract::Known(match self.code.constants[index as usize] {
                Constant::Int32(number) => Known::Number(number.into()),
                Constant::Double(number) => Known::Number(number),
                Constant::Boolean(boolean) => Known::Boolean(boolean),
                _ => return None,
            }));
        }
        match operand.as_register()?.local_index() {
            Some(index) => *self.locals.get(index as usize)?,
            None => self.key_of(operand, SortKey::Whole),
        }
    }

    fn set(&mut self, register: Register, value: Abstract) -> Option<()> {
        *self.locals.get_mut(register.local_index()? as usize)? = Some(value);
        Some(())
    }

    fn order_of_keys(&mut self, lhs: Operand, rhs: Operand) -> Option<Ordering> {
        match (self.get(lhs)?, self.get(rhs)?) {
            (Abstract::Key { is_first: true }, Abstract::Key { is_first: false }) => {
                Some(self.order)
            }
            (Abstract::Key { is_first: false }, Abstract::Key { is_first: true }) => {
                Some(self.order.reverse())
            }
            _ => None,
        }
    }

    fn subtract(&mut self, lhs: Operand, rhs: Operand) -> Option<Abstract> {
        if let (Abstract::Known(Known::Number(a)), Abstract::Known(Known::Number(b))) =
            (self.get(lhs)?, self.get(rhs)?)
        {
            return Some(Abstract::Known(Known::Number(a - b)));
        }
        self.subtracts = true;
        self.order_of_keys(lhs, rhs).map(Abstract::Difference)
    }

    fn to_number(&mut self, value: Operand) -> Option<Abstract> {
        match self.get(value)? {
            Abstract::Known(Known::Boolean(it)) => {
                Some(Abstract::Known(Known::Number(u8::from(it).into())))
            }
            Abstract::Key { .. } => None,
            number => Some(number),
        }
    }

    fn boolean(&mut self, value: Operand) -> Option<bool> {
        match self.get(value)? {
            Abstract::Known(Known::Boolean(boolean)) => Some(boolean),
            _ => None,
        }
    }

    fn run(&mut self) -> Option<Known> {
        let mut offset = 0;
        loop {
            let (instruction, size) = Instruction::read(self.code.body.instructions(), offset);
            macro_rules! step {
                ($($Test:ident, $JumpIf:ident, $JumpUnless:ident, $holds:ident;)*) => {
                    match instruction {
                        $(
                            Instruction::$Test(op) => {
                                let holds = self.order_of_keys(op.lhs, op.rhs)?.$holds();
                                self.set(op.dst, Abstract::Known(Known::Boolean(holds)))?;
                                None
                            }
                            Instruction::$JumpIf(op) => {
                                self.order_of_keys(op.lhs, op.rhs)?.$holds().then_some(op.target)
                            }
                            Instruction::$JumpUnless(op) => {
                                (!self.order_of_keys(op.lhs, op.rhs)?.$holds()).then_some(op.target)
                            }
                        )*
                        Instruction::Goto(op) => Some(op.target),
                        Instruction::JumpIfTrue(op) => self.boolean(op.value)?.then_some(op.target),
                        Instruction::JumpIfFalse(op) => (!self.boolean(op.value)?).then_some(op.target),
                        Instruction::Return(op) => {
                            return match self.get(op.value)? {
                                Abstract::Known(known) => Some(known),
                                Abstract::Difference(sign) => Some(Known::Number((sign as i8).into())),
                                Abstract::Key { .. } => None,
                            };
                        }
                        Instruction::Enter(_) => None,
                        _ => {
                            self.compute(instruction)?;
                            None
                        }
                    }
                };
            }
            let jump = step! {
                Less, JumpIfLess, JumpIfNotLess, is_lt;
                LessEqual, JumpIfLessEqual, JumpIfNotLessEqual, is_le;
                Greater, JumpIfGreater, JumpIfNotGreater, is_gt;
                GreaterEqual, JumpIfGreaterEqual, JumpIfNotGreaterEqual, is_ge;
                Equal, JumpIfEqual, JumpIfNotEqual, is_eq;
                StrictEqual, JumpIfStrictEqual, JumpIfStrictNotEqual, is_eq;
            };
            offset += match jump {
                Some(jump) => u32::try_from(jump.0).ok().filter(|&it| it != 0)?,
                None => size,
            };
        }
    }

    fn compute(&mut self, instruction: Instruction) -> Option<()> {
        let (dst, value) = match instruction {
            Instruction::Move(op) => (op.dst, self.get(op.src)?),
            Instruction::GetById(op) => (op.dst, self.key_of(op.base, SortKey::Property(op.name))?),
            Instruction::GetLength(op) => (op.dst, self.key_of(op.base, SortKey::Length)?),
            Instruction::GetByVal(op) => {
                match self.code.constants[op.key.as_constant()? as usize] {
                    Constant::Int32(index @ 0..) => (
                        op.dst,
                        self.key_of(op.base, SortKey::Element(index as u32))?,
                    ),
                    _ => return None,
                }
            }
            Instruction::Subtract(op) => (op.dst, self.subtract(op.lhs, op.rhs)?),
            Instruction::ToNumber(op) => (op.dst, self.to_number(op.value)?),
            Instruction::Negate(op) => match self.to_number(op.value)? {
                Abstract::Known(Known::Number(it)) => (op.dst, Abstract::Known(Known::Number(-it))),
                Abstract::Difference(sign) => (op.dst, Abstract::Difference(sign.reverse())),
                _ => return None,
            },
            _ => return None,
        };
        self.set(dst, value)
    }
}

impl Code {
    /// Of the code for calls of a function.
    pub fn as_comparator(&self) -> Option<Comparator> {
        if self.body.instructions().len() > MAX_SIZE {
            return None;
        }
        let mut run = Run {
            code: self,
            key: None,
            subtracts: false,
            order: Ordering::Equal,
            locals: [None; MAX_LOCALS],
        };
        let mut result_for = |order| {
            (run.order, run.locals) = (order, [None; MAX_LOCALS]);
            run.run()
        };
        let results = [
            result_for(Ordering::Less)?,
            result_for(Ordering::Equal)?,
            result_for(Ordering::Greater)?,
        ];
        Some(Comparator {
            key: run.key?,
            subtracts: run.subtracts,
            results,
        })
    }
}
