//! Code as text, whether it is well formed or not.

use core::fmt::{Debug, Display, Formatter, Result};

use bun_engine_syntax::EvalContext;
use bun_engine_text::{Identifier, Text};

use crate::code::{Code, IntCases};
use crate::constant::{ArrayLiteral, Constant};
use crate::function::{FunctionInfo, FunctionName};
use crate::instruction::{RawInstruction, Shape};
use crate::operand::*;
use crate::positions::Position;
use crate::scope::StaticScope;

const MNEMONIC_COLUMNS: usize = 28;
const MAX_QUOTED: usize = 48;

#[derive(Clone, Copy)]
pub struct Dump<'a> {
    code: &'a Code,
    source: Text<'a>,
    shows_positions: bool,
}

fn list<T>(
    formatter: &mut Formatter<'_>,
    elements: impl IntoIterator<Item = T>,
    mut write: impl FnMut(&mut Formatter<'_>, T) -> Result,
) -> Result {
    for (index, element) in elements.into_iter().enumerate() {
        if index != 0 {
            formatter.write_str(", ")?;
        }
        write(formatter, element)?;
    }
    Ok(())
}

/// A heading and a line for each row, unless there is none.
fn table<T>(
    formatter: &mut Formatter<'_>,
    heading: &str,
    rows: &[T],
    mut write: impl FnMut(&mut Formatter<'_>, usize, &T) -> Result,
) -> Result {
    if !rows.is_empty() {
        writeln!(formatter, "{heading}")?;
    }
    for (index, row) in rows.iter().enumerate() {
        write!(formatter, "  {index}: ")?;
        write(formatter, index, row)?;
        writeln!(formatter)?;
    }
    Ok(())
}

/// On one line, and cut short.
fn quote(formatter: &mut Formatter<'_>, text: Text<'_>) -> Result {
    formatter.write_str("\"")?;
    for code_point in text.code_points().take(MAX_QUOTED) {
        match char::from_u32(code_point) {
            Some(character) => write!(formatter, "{}", character.escape_debug())?,
            None => write!(formatter, "\\u{{{code_point:x}}}")?,
        }
    }
    let is_cut = text.code_points().nth(MAX_QUOTED).is_some();
    formatter.write_str(if is_cut { "\".." } else { "\"" })
}

fn identifier(formatter: &mut Formatter<'_>, identifier: &Identifier) -> Result {
    if identifier.name().is_symbol() {
        formatter.write_str("@")?;
    }
    quote(formatter, identifier.name().text())
}

fn names(formatter: &mut Formatter<'_>, names: &[Identifier]) -> Result {
    formatter.write_str("[")?;
    list(formatter, names, identifier)?;
    formatter.write_str("]")
}

fn constant(formatter: &mut Formatter<'_>, value: &Constant) -> Result {
    match value {
        Constant::Empty => formatter.write_str("empty"),
        Constant::Undefined => formatter.write_str("undefined"),
        Constant::Null => formatter.write_str("null"),
        Constant::Boolean(value) => write!(formatter, "{value}"),
        Constant::Int32(value) => write!(formatter, "{value}"),
        Constant::Double(value) => write!(formatter, "{value:?}"),
        Constant::String(value) => quote(formatter, value.text()),
        Constant::LongString(value) => quote(formatter, value.text()),
        Constant::BigInt(literal) => {
            let sign = if literal.is_negative { "-" } else { "" };
            let (digits, radix) = (literal.digits.text(), literal.radix);
            write!(formatter, "{sign}{digits}n (radix {radix})")
        }
        Constant::RegExp(literal) => write!(formatter, "/{}/{}", literal.pattern, literal.flags),
        Constant::Template(site) => {
            formatter.write_str("template [")?;
            list(formatter, &site.raw, |formatter, raw| {
                quote(formatter, raw.text())
            })?;
            write!(formatter, "] ending at {}", site.end)
        }
        Constant::Array(literal) => {
            formatter.write_str("[")?;
            match &**literal {
                ArrayLiteral::Int32(values) => list(formatter, values, |f, v| write!(f, "{v}")),
                ArrayLiteral::Double(values) => list(formatter, values, |f, v| write!(f, "{v:?}")),
                ArrayLiteral::Strings(values) => list(formatter, values, |f, v| quote(f, v.text())),
                ArrayLiteral::Values(values) => list(formatter, values, constant),
            }?;
            formatter.write_str("]")
        }
        Constant::LinkTime(value) => write!(formatter, "link time {}", value.0),
    }
}

fn scope(formatter: &mut Formatter<'_>, scope: &StaticScope) -> Result {
    write!(
        formatter,
        "{:?}{}, {} slots, {} undefined, {} mapped",
        scope.kind(),
        if scope.eval_variables_slot().is_some() {
            ", extensible"
        } else {
            ""
        },
        scope.slot_count(),
        scope.undefined_slots(),
        scope.mapped_parameters(),
    )?;
    for slot in scope.slots() {
        let (index, name, kind) = (slot.index, scope.text_of(slot), slot.kind);
        write!(formatter, "\n     {index}: {name} {kind:?}")?;
        flags(formatter, slot.flags)?;
    }
    Ok(())
}

/// Each after a space.
fn flags<T: bitflags::Flags + Copy>(formatter: &mut Formatter<'_>, flags: T) -> Result {
    let mut names = flags.iter_names();
    names.try_for_each(|(name, _)| write!(formatter, " {name}"))
}

fn flag_operand<T: bitflags::Flags<Bits = u8> + Copy>(
    formatter: &mut Formatter<'_>,
    word: u32,
) -> Result {
    write!(formatter, "{word}")?;
    flags(formatter, T::from_bits_truncate(word as u8))
}

fn variant(formatter: &mut Formatter<'_>, word: u32, value: impl Field + Debug) -> Result {
    if value.word() == word {
        write!(formatter, "{value:?}")
    } else {
        write!(formatter, "{word}?")
    }
}

/// The index with what it selects.
fn element<T>(
    formatter: &mut Formatter<'_>,
    prefix: &str,
    elements: &[T],
    index: u32,
    write: impl FnOnce(&mut Formatter<'_>, &T) -> Result,
) -> Result {
    write!(formatter, "{prefix}{index}(")?;
    match elements.get(index as usize) {
        Some(element) => write(formatter, element)?,
        None => formatter.write_str("?")?,
    }
    formatter.write_str(")")
}

impl<'a> Dump<'a> {
    /// `source` has the names of the inner functions.
    pub fn new(code: &'a Code, source: Text<'a>) -> Dump<'a> {
        Dump {
            code,
            source,
            shows_positions: false,
        }
    }

    pub fn with_positions(self) -> Dump<'a> {
        Dump {
            shows_positions: true,
            ..self
        }
    }

    fn quote_source(&self, formatter: &mut Formatter<'_>, start: u32, end: u64) -> Result {
        if u64::from(start) <= end && end <= self.source.len() as u64 {
            quote(formatter, self.source.slice(start as usize..end as usize))
        } else {
            formatter.write_str("?")
        }
    }

    fn function_name(&self, formatter: &mut Formatter<'_>, function: &FunctionInfo) -> Result {
        match &function.name {
            &FunctionName::Source { start, length } => {
                self.quote_source(formatter, start, u64::from(start) + u64::from(length))
            }
            FunctionName::Known(_) | FunctionName::Cached(_) => {
                quote(formatter, function.name_text(self.source))
            }
            FunctionName::Owned(name) => identifier(formatter, name),
        }
    }

    fn function(&self, formatter: &mut Formatter<'_>, function: &FunctionInfo) -> Result {
        self.function_name(formatter, function)?;
        write!(formatter, " {:?}", function.kind)?;
        flags(formatter, function.flags)?;
        flags(formatter, function.origin)?;
        write!(
            formatter,
            ", {:?}, length {}, source {:?}, created at {}",
            function.visibility,
            function.length,
            function.range(),
            function.created_at,
        )
    }

    fn operand(
        &self,
        formatter: &mut Formatter<'_>,
        offset: u32,
        shape: Shape,
        word: u32,
    ) -> Result {
        let code = self.code;
        let register = Register::from_word(word);
        match shape {
            Shape::Dst | Shape::DstIfJumps | Shape::DstUnlessJumps | Shape::Reg | Shape::Mut => {
                write!(formatter, "{register:?}")
            }
            Shape::Src => match Operand::from_word(word).as_constant() {
                Some(index) => element(formatter, "k", &code.constants, index, constant),
                None => write!(formatter, "{register:?}"),
            },
            Shape::Dst2 | Shape::Reg2 => write!(formatter, "{register:?}-{:?}", register.nth(1)),
            Shape::Dst3 | Shape::Reg3 | Shape::Mut3 => {
                write!(formatter, "{register:?}-{:?}", register.nth(2))
            }
            Shape::First => write!(formatter, "{register:?}.."),
            Shape::Target => write!(formatter, "->{}", Jump(word as i32).from(offset)),
            Shape::Flag => variant(formatter, word, word != 0),
            Shape::Name => element(formatter, "id", &code.identifiers, word, identifier),
            Shape::Names => element(formatter, "names", &code.name_lists, word, |f, list| {
                names(f, list)
            }),
            Shape::Function => element(formatter, "f", &code.functions, word, |f, function| {
                self.function_name(f, function)
            }),
            Shape::Scope => element(formatter, "scope", &code.scopes, word, |f, scope| {
                write!(f, "{:?}", scope.kind())
            }),
            Shape::ArrayConstant | Shape::RegExpConstant => {
                element(formatter, "k", &code.constants, word, constant)
            }
            Shape::Count
            | Shape::ArgumentCount
            | Shape::Frame
            | Shape::Frame1
            | Shape::Frame2
            | Shape::Unsigned
            | Shape::Variables
            | Shape::Parameter
            | Shape::IntSwitch
            | Shape::StringSwitch
            | Shape::SpreadMask
            | Shape::SuspendPoint
            | Shape::CoverageBlock
            | Shape::CellType => write!(formatter, "{word}"),
            Shape::Unresolved => variant(formatter, word, Unresolved::from_word(word)),
            Shape::ErrorKind => variant(formatter, word, ErrorKind::from_word(word)),
            Shape::StaticError => variant(formatter, word, StaticError::from_word(word)),
            Shape::SuspendKind => variant(formatter, word, SuspendKind::from_word(word)),
            Shape::CloseMode => variant(formatter, word, CloseMode::from_word(word)),
            Shape::ImportPhase => variant(formatter, word, ImportPhase::from_word(word)),
            Shape::DebugHook => variant(formatter, word, DebugHook::from_word(word)),
            Shape::ArrayShape => variant(formatter, word, ArrayShape::from_word(word)),
            Shape::PutFlags => flag_operand::<PutFlags>(formatter, word),
            Shape::DefineFlags => flag_operand::<DefineFlags>(formatter, word),
            Shape::Context => flag_operand::<EvalContext>(formatter, word),
        }
    }

    fn instruction(
        &self,
        formatter: &mut Formatter<'_>,
        offset: u32,
        instruction: &RawInstruction,
    ) -> Result {
        let opcode = instruction.opcode;
        let width = match usize::from(instruction.size) {
            size if size == opcode.size::<Narrow>() => "",
            size if size == opcode.size::<Wide16>() => "*",
            _ => "**",
        };
        write!(formatter, "[{offset:>5}] {width}{}", opcode.mnemonic())?;
        if !opcode.shapes().is_empty() {
            let padding = MNEMONIC_COLUMNS.saturating_sub(width.len() + opcode.mnemonic().len());
            write!(formatter, " {:padding$}", "")?;
        }
        let operands = opcode.shapes().iter().zip(instruction.words());
        list(
            formatter,
            opcode.operand_names().iter().zip(operands),
            |formatter, (name, (&shape, &word))| {
                write!(formatter, "{name}: ")?;
                self.operand(formatter, offset, shape, word)
            },
        )?;
        match opcode.metadata() {
            Some(kind) => writeln!(formatter, "  {kind:?}@{}", instruction.metadata),
            None => writeln!(formatter),
        }
    }

    fn instructions(&self, formatter: &mut Formatter<'_>) -> Result {
        let body = &self.code.body;
        if body.layout_and_instructions().is_none() {
            return writeln!(formatter, "the bytes end early");
        }
        let code = body.instructions();
        let mut positions = body.positions().entries().peekable();
        let mut offset = 0;
        while let Some(instruction) = RawInstruction::read(code, offset) {
            while self.shows_positions
                && let Some((_, position)) = positions.next_if(|&(start, _)| start <= offset)
            {
                let Position { divot, start, end } = position;
                write!(formatter, "        // {divot} in {start}..{end} ")?;
                self.quote_source(formatter, start, u64::from(end))?;
                writeln!(formatter)?;
            }
            self.instruction(formatter, offset, &instruction)?;
            offset += u32::from(instruction.size);
        }
        match code.get(offset as usize) {
            Some(byte) => writeln!(formatter, "[{offset:>5}] no instruction: {byte:#04x}"),
            None => Ok(()),
        }
    }

    fn tables(&self, formatter: &mut Formatter<'_>) -> Result {
        let (code, body) = (self.code, &self.code.body);
        table(formatter, "handlers", body.handlers(), |f, _, handler| {
            let (range, target, kind) = (&handler.range, handler.target, handler.kind);
            write!(f, "{range:?} ->{target} {kind:?}")
        })?;
        table(
            formatter,
            "int switches",
            body.int_switches(),
            |f, _, switch| {
                let case = |f: &mut Formatter<'_>, key, target| write!(f, "{key} ->{target}, ");
                match &switch.cases {
                    IntCases::Dense { first, targets } => (i64::from(*first)..)
                        .zip(targets)
                        .filter(|&(_, &target)| target != switch.default)
                        .try_for_each(|(key, target)| case(f, key, target))?,
                    IntCases::Sparse(cases) => cases
                        .iter()
                        .try_for_each(|(key, target)| case(f, i64::from(*key), target))?,
                }
                write!(f, "default ->{}", switch.default)
            },
        )?;
        let string_switches = body.string_switches();
        table(
            formatter,
            "string switches",
            string_switches,
            |f, index, switch| {
                let keys = code.string_switches.get(index).map_or(&[][..], |keys| keys);
                for (key, target) in keys.iter().zip(&switch.targets) {
                    quote(f, key.text())?;
                    write!(f, " ->{target}, ")?;
                }
                write!(f, "default ->{}", switch.default)
            },
        )?;
        table(
            formatter,
            "spread masks",
            body.spread_masks(),
            |f, _, mask| {
                let bits = (0..mask.len() * 32).filter(|bit| mask[bit / 32] >> (bit % 32) & 1 != 0);
                f.debug_list().entries(bits).finish()
            },
        )?;
        let saved = body
            .tables
            .as_ref()
            .map_or(&[][..], |tables| &tables.saved_registers);
        table(
            formatter,
            "suspend points",
            body.suspend_points(),
            |f, _, point| {
                let saved = saved.get(point.registers.start as usize..point.registers.end as usize);
                let (kind, suspend, resume) = (point.kind, point.suspend, point.resume);
                write!(f, "{kind:?} at {suspend} ->{resume} saves ")?;
                match saved {
                    Some(saved) => (f.debug_list())
                        .entries(saved.iter().map(|it| it.register))
                        .finish(),
                    None => f.write_str("?"),
                }
            },
        )?;
        table(
            formatter,
            "coverage",
            body.coverage_blocks(),
            |f, _, block| write!(f, "{:?} {}..{}", block.kind, block.start, block.end),
        )?;
        let scope_registers = (body.tables.as_ref()).map_or(&[][..], |it| &it.scope_registers);
        table(formatter, "scope registers", scope_registers, |f, _, it| {
            write!(f, "{:?} from {}", it.1, it.0)
        })?;
        table(formatter, "constants", &code.constants, |f, _, value| {
            constant(f, value)
        })?;
        table(formatter, "identifiers", &code.identifiers, |f, _, name| {
            identifier(f, name)
        })?;
        table(formatter, "scopes", &code.scopes, |f, _, it| scope(f, it))?;
        table(formatter, "functions", &code.functions, |f, _, function| {
            self.function(f, function)
        })
    }
}

impl Display for Dump<'_> {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> Result {
        let body = &self.code.body;
        write!(formatter, "{:?}", body.kind)?;
        flags(formatter, body.flags)?;
        writeln!(
            formatter,
            ": {} bytes, {} locals, {} parameters, {} words of metadata",
            body.instructions_size,
            body.locals,
            body.parameters,
            body.checked_metadata().map_or(0, |layout| layout.words()),
        )?;
        self.instructions(formatter)?;
        self.tables(formatter)
    }
}
