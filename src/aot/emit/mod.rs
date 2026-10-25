mod external_bodies;
mod functions;
mod layout;
mod output;
mod positions;
mod tables;

#[cfg(test)]
mod tests;

pub use external_bodies::{ExternalBodies, ExternalFunctionBodies};
pub use positions::source_positions;

use crate::ir::generated::LimitId;
use crate::ir::{InParallel, Program};
use crate::link::BodyRemap;

pub struct ProgramBytes {
    storage: Vec<u64>,
    size_in_bytes: usize,
    external_bodies: Option<ExternalBodies>,
}

impl ProgramBytes {
    fn new(storage: Vec<u64>, size_in_bytes: usize) -> ProgramBytes {
        assert!(size_in_bytes <= size_of_val(&*storage));
        ProgramBytes {
            storage,
            size_in_bytes,
            external_bodies: None,
        }
    }

    pub fn external_bodies(&self) -> Option<&ExternalBodies> {
        self.external_bodies.as_ref()
    }

    pub fn size_with_external_bodies(&self) -> usize {
        let bodies = self.external_bodies.as_ref();
        self.size_in_bytes + bodies.map_or(0, ExternalBodies::size_in_bytes)
    }

    pub fn as_slice(&self) -> &[u8] {
        let first_byte = self.storage.as_ptr().cast::<u8>();
        // SAFETY: `storage` holds at least `size_in_bytes` bytes, every byte of a `u64` is
        // initialized, and a byte is aligned anywhere.
        unsafe { std::slice::from_raw_parts(first_byte, self.size_in_bytes) }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EmitError {
    ProgramTooLarge { bytes: u64 },
}

impl EmitError {
    pub fn limit(self) -> LimitId {
        match self {
            EmitError::ProgramTooLarge { .. } => LimitId::MaxProgramIds,
        }
    }
}

pub fn emit(mut program: Program, in_parallel: InParallel<'_>) -> Result<ProgramBytes, EmitError> {
    emit_from(&mut program, in_parallel)
}

/// Takes the functions out of the program and frees them as they are written. The tables stay, for the caller to free.
pub fn emit_from(
    program: &mut Program,
    in_parallel: InParallel<'_>,
) -> Result<ProgramBytes, EmitError> {
    let functions = core::mem::take(&mut program.functions);
    let tasks = functions::create_function_tasks_in_parallel(functions, in_parallel);
    layout::emit_program(program, tasks, in_parallel)
}

/// Like `emit_from`, for a program that lists no function: they are written as the link left them, with the ids of their units.
pub fn emit_with_external_bodies(
    program: &mut Program,
    mut remap: BodyRemap,
    in_parallel: InParallel<'_>,
) -> Result<ProgramBytes, EmitError> {
    assert!(
        program.functions.is_empty(),
        "the functions are with the ids of their units"
    );
    let mut functions = remap.take_functions();
    let bodies = ExternalBodies::take_from(&mut functions, remap, in_parallel);
    let tasks = functions::create_tasks_for_shared_functions(functions);
    let mut bytes = layout::emit_program(program, tasks, in_parallel)?;
    bytes.external_bodies = Some(bodies);
    Ok(bytes)
}
