//! What comes with the instructions.

use bun_engine_text::Identifier;

use super::{Fault, Verifier};
use crate::code::{CodeFlags, IntCases};
use crate::constant::{ArrayLiteral, Constant, LinkTimeConstant};
use crate::instruction::Opcode;

fn is_primitive(constant: &Constant) -> bool {
    matches!(
        constant,
        Constant::Undefined
            | Constant::Null
            | Constant::Boolean(_)
            | Constant::Int32(_)
            | Constant::Double(_)
            | Constant::String(_)
            | Constant::LongString(_)
            | Constant::BigInt(_)
    )
}

fn is_valid_constant(constant: &Constant, flags: CodeFlags) -> bool {
    match constant {
        Constant::BigInt(literal) => matches!(literal.radix, 2 | 8 | 10 | 16),
        Constant::Template(site) => site.cooked.len() == site.raw.len(),
        Constant::Array(literal) => match &**literal {
            ArrayLiteral::Values(values) => values
                .iter()
                .all(|value| is_primitive(value) && is_valid_constant(value, flags)),
            _ => true,
        },
        Constant::LinkTime(constant) => {
            constant.0 < LinkTimeConstant::FIRST_OF_HOST.0 || flags.contains(CodeFlags::BUILTIN)
        }
        _ => true,
    }
}

fn are_distinct_and_no_indices(names: &[Identifier], scratch: &mut Vec<usize>) -> bool {
    scratch.clear();
    if scratch.try_reserve(names.len()).is_err() {
        return false;
    }
    scratch.extend(names.iter().map(|name| name.name().address()));
    scratch.sort_unstable();
    scratch.is_sorted_by(|a, b| a < b) && names.iter().all(|name| name.name().as_index().is_none())
}

impl Verifier<'_> {
    pub(super) fn check_tables(&self) -> Result<(), Fault> {
        let (code, body) = (self.code, self.body);
        let mut constants = code.constants.iter();
        constants
            .all(|constant| is_valid_constant(constant, body.flags))
            .ok_or(Fault::Constants)?;

        let keys = code.string_switches.iter().map(|keys| keys.len());
        let targets = body.string_switches().iter();
        keys.eq(targets.map(|switch| switch.targets.len()))
            .ok_or(Fault::Switches)?;
        let mut int_switches = body.int_switches().iter();
        int_switches
            .all(|switch| match &switch.cases {
                IntCases::Dense { first, targets } => {
                    i64::from(*first) + targets.len() as i64 <= i64::from(i32::MAX) + 1
                }
                IntCases::Sparse(cases) => cases.is_sorted_by(|a, b| a.0 < b.0),
            })
            .ok_or(Fault::Switches)?;

        // A point saves nothing, what the last that saves anything does, or the next registers of the table.
        let saved = body
            .tables
            .as_ref()
            .map_or(&[][..], |tables| &tables.saved_registers);
        let mut last = 0..0;
        for point in body.suspend_points() {
            let range = &point.registers;
            if *range == (0..0) || *range == last {
                continue;
            }
            let registers = saved.get(range.start as usize..range.end as usize);
            let is_valid = range.start == last.end
                && registers.is_some_and(|registers| {
                    let mut registers = registers.iter().map(|it| it.register);
                    registers.clone().is_sorted_by(|a, b| a > b)
                        && registers.all(|it| it.is_local() && self.is_writable(it))
                });
            is_valid.ok_or(Fault::SavedRegisters)?;
            last = range.clone();
        }
        (last.end as usize == saved.len()).ok_or(Fault::SavedRegisters)?;

        let scopes = (body.tables.as_ref()).map_or(&[][..], |tables| &tables.scope_registers);
        (scopes.is_sorted_by_key(|it| it.0) && scopes.iter().all(|it| self.is_run(it.1, 1)))
            .ok_or(Fault::ScopeRegisters)
    }

    pub(super) fn check_handlers(&self) -> Result<(), Fault> {
        let is_catch = |offset| {
            let instruction = Opcode::read(self.instructions, offset);
            self.is_start(offset) && matches!(instruction, Some((Opcode::Catch, _)))
        };
        let mut handlers = self.body.handlers().iter();
        handlers
            .all(|handler| {
                let range = &handler.range;
                range.start < range.end
                    && self.is_start(range.start)
                    && (self.is_start(range.end) || range.end == self.body.instructions_size)
                    && is_catch(handler.target)
            })
            .ok_or(Fault::Handlers)
    }

    pub(super) fn check_literal_names(&self) -> Result<(), Fault> {
        let mut scratch = Vec::new();
        (self.code.name_lists.iter().zip(&*self.literal_name_lists))
            .all(|(names, &is_used)| !is_used || are_distinct_and_no_indices(names, &mut scratch))
            .ok_or(Fault::NameLists)
    }
}
