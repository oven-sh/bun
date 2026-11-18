//! Checks that code is well formed: it decodes, and all that it names exists and is of the right kind.

mod instructions;
mod operands;
mod scopes;
mod tables;

use smallvec::SmallVec;

use crate::code::{Body, Code, CodeFlags};
use crate::graph::refill;
use crate::instruction::Opcode;
use crate::liveness::is_written_first;
use crate::positions::Positions;
use crate::scope::StaticScope;
use operands::is_source;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fault {
    TooLarge,
    Header,
    MetadataLayout,
    Positions,
    Handlers,
    Switches,
    SuspendPoints,
    SavedRegisters,
    ScopeRegisters,
    Constants,
    NameLists,
    NotAnInstruction,
    /// The instruction may not stand where it does.
    Order,
    FallsOffTheEnd,
    /// The instruction is not for code of this kind or with these flags.
    Flags,
    Metadata,
    /// The register is not known to hold a scope that has what the instruction wants.
    Scope,
    /// By its index.
    Operand(u8),
    /// The offset is that of the target.
    Target,
    /// A local may be read or saved before it is written.
    Unwritten,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct VerifyError {
    pub fault: Fault,
    /// Of the instruction, if it is about one.
    pub offset: Option<u32>,
}

impl From<Fault> for VerifyError {
    fn from(fault: Fault) -> VerifyError {
        VerifyError {
            fault,
            offset: None,
        }
    }
}

/// What is known of a byte of code.
mod mark {
    pub(super) const START: u8 = 1 << 0;
    /// Of an instruction that a jump may lead to.
    pub(super) const OPEN: u8 = 1 << 1;
    pub(super) const TARGET: u8 = 1 << 2;
}

const METADATA_SLOTS: usize = 64;
const NO_ENTRY: u32 = u32::MAX;

struct Verifier<'a> {
    code: &'a Code,
    body: &'a Body,
    instructions: &'a [u8],
    marks: &'a mut [u8],
    used_int_switches: &'a mut [bool],
    used_string_switches: &'a mut [bool],
    literal_name_lists: &'a mut [bool],
    /// For each kind, and for none.
    next_entries: [u32; METADATA_SLOTS],
    suspend_points: u32,
    previous: Option<Opcode>,
    names_an_index: bool,
    /// How many constants, from the first, any instruction may read.
    first_sources: u32,
    locals: u32,
    parameters: u32,
    checks_scopes: bool,
    scope_of_callee: Option<&'a StaticScope>,
    /// It and those around it, as far as they have been asked for.
    chain: SmallVec<[&'a StaticScope; 8]>,
    /// The locals that hold scopes, in ascending order.
    created_scopes: SmallVec<[(u32, &'a StaticScope); 8]>,
}

/// For code that is entered with an instance of `scope` as the scope of its callee. Does not look into the code of
/// inner functions.
pub fn verify(code: &Code, scope: Option<&StaticScope>) -> Result<(), VerifyError> {
    check(code, scope, true, true)?;
    check_locals(&code.body)
}

/// Positions are checked when one is asked for.
pub(crate) fn verify_stored(code: &Code, scope: Option<&StaticScope>) -> Result<(), VerifyError> {
    check(code, scope, true, false)?;
    // The collector takes what a suspension saves for values.
    if code.body.flags.contains(CodeFlags::SUSPENDS) || cfg!(debug_assertions) {
        check_locals(&code.body)?;
    }
    Ok(())
}

/// All that it takes to decode, analyze and compile the code.
#[cfg(test)]
pub(crate) fn verify_form(code: &Code) -> Result<(), VerifyError> {
    check(code, None, false, true)
}

fn check_locals(body: &Body) -> Result<(), VerifyError> {
    let is_written_first = is_written_first(body).map_err(|_| Fault::TooLarge)?;
    Ok(is_written_first.ok_or(Fault::Unwritten)?)
}

/// From `inline` if that is enough.
fn zeroed<'a, T: Copy + Default>(
    inline: &'a mut [T],
    spilled: &'a mut Vec<T>,
    len: usize,
) -> Result<&'a mut [T], Fault> {
    if let Some(inline) = inline.get_mut(..len) {
        return Ok(inline);
    }
    refill(spilled, len, T::default()).map_err(|_| Fault::TooLarge)?;
    Ok(spilled)
}

fn check(
    code: &Code,
    scope_of_callee: Option<&StaticScope>,
    checks_scopes: bool,
    checks_positions: bool,
) -> Result<(), VerifyError> {
    let body = &code.body;
    let layout = body.checked_metadata().ok_or(Fault::Header)?;
    let size = body.instructions_size;
    let is_valid = size <= Body::MAX_SIZE
        && (2..=Body::MAX_FRAME_WORDS).contains(&body.locals)
        && body.locals.is_multiple_of(2)
        && (1..=Body::MAX_FRAME_WORDS).contains(&body.parameters)
        && CodeFlags::all().contains(body.flags)
        && (body.parameters == 1 || !body.flags.contains(CodeFlags::SUSPENDS));
    is_valid.ok_or(Fault::Header)?;

    let (mut marks, mut used) = ([0; 256], [false; 16]);
    let mut spilled = (Vec::new(), Vec::new());
    let (ints, strings) = (body.int_switches().len(), body.string_switches().len());
    let used = zeroed(
        &mut used,
        &mut spilled.0,
        ints + strings + code.name_lists.len(),
    )?;
    let (used_int_switches, used) = used.split_at_mut(ints);
    let (used_string_switches, literal_name_lists) = used.split_at_mut(strings);
    let mut verifier = Verifier {
        code,
        body,
        instructions: body.instructions(),
        marks: zeroed(&mut marks, &mut spilled.1, size as usize)?,
        used_int_switches,
        used_string_switches,
        literal_name_lists,
        next_entries: [NO_ENTRY; METADATA_SLOTS],
        suspend_points: 0,
        previous: None,
        names_an_index: (code.identifiers.iter()).any(|it| it.name().as_index().is_some()),
        first_sources: (code.constants.iter())
            .take_while(|it| is_source(it))
            .count() as u32,
        locals: body.locals,
        parameters: body.parameters,
        checks_scopes,
        scope_of_callee,
        chain: scope_of_callee.into_iter().collect(),
        created_scopes: SmallVec::new(),
    };
    for (kind, range) in layout.ranges() {
        (range.start < range.end).ok_or(Fault::MetadataLayout)?;
        verifier.next_entries[kind as usize] = range.start;
    }
    verifier.check_tables()?;
    verifier.check_instructions()?;
    (layout.ranges())
        .all(|(kind, range)| verifier.next_entries[kind as usize] == range.end)
        .ok_or(Fault::MetadataLayout)?;
    verifier.check_targets()?;
    verifier.check_handlers()?;
    verifier.check_literal_names()?;
    if checks_positions {
        let positions = body.position_bytes().and_then(Positions::read);
        positions
            .is_some_and(|it| it.is_valid(|offset| verifier.is_start(offset)))
            .ok_or(Fault::Positions)?;
    }
    Ok(())
}

impl Verifier<'_> {
    #[inline]
    fn is_start(&self, offset: u32) -> bool {
        let mark = self.marks.get(offset as usize);
        mark.is_some_and(|mark| mark & mark::START != 0)
    }
}
