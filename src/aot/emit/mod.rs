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
use crate::link::LinkedFunctions;
use crate::statistics::{Stage, StepClock};

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

    /// `None`: the code of the functions lies in the bytes.
    pub fn external_bodies(&self) -> Option<&ExternalBodies> {
        self.external_bodies.as_ref()
    }

    /// The bytes and the code that lies beside them.
    pub fn size_with_external_bodies(&self) -> usize {
        let bodies = self.external_bodies.as_ref();
        self.size_in_bytes + bodies.map_or(0, ExternalBodies::size_in_bytes)
    }

    /// What lies beside the bytes stays.
    pub fn free_bytes(&mut self) {
        self.storage = Vec::new();
        self.size_in_bytes = 0;
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

/// The functions of a program as `emit_with_external_bodies` takes them: the records without their code, measured, and the code beside them.
pub struct FunctionsWithoutCode {
    count: usize,
    tasks: Vec<layout::Task<'static, 'static>>,
    bodies: ExternalBodies,
}

impl FunctionsWithoutCode {
    /// This asks nothing of the program, so it can run while the program is finished.
    pub fn new(
        mut functions: LinkedFunctions,
        in_parallel: InParallel<'_>,
    ) -> FunctionsWithoutCode {
        let mut steps = StepClock::new(Stage::LinkAndEmit);
        let count = functions.function_count();
        let mut lists = functions.take_lists();
        let bodies = ExternalBodies::take_from(&mut lists, functions, in_parallel);
        let mut tasks = functions::create_tasks_for_shared_functions(lists);
        layout::measure_tasks(&mut tasks, in_parallel);
        steps.end("emit: take the code out of the records, measure them");
        FunctionsWithoutCode {
            count,
            tasks,
            bodies,
        }
    }

    pub fn function_count(&self) -> usize {
        self.count
    }
}

/// The bytes hold the tables and the records of the functions, each record in the numbers of the tables it was written under.
/// The code stays where lowering wrote it and goes along with the bytes.
pub fn emit_with_external_bodies(
    program: &mut Program,
    functions: FunctionsWithoutCode,
    in_parallel: InParallel<'_>,
) -> Result<ProgramBytes, EmitError> {
    assert!(
        program.functions.is_empty(),
        "the functions come beside the program"
    );
    let FunctionsWithoutCode { tasks, bodies, .. } = functions;
    let mut bytes = layout::emit_program(program, tasks, in_parallel)?;
    bytes.external_bodies = Some(bodies);
    Ok(bytes)
}

/// For a program that leaves the process as a file: the code lies in the bytes, and nothing lies beside them.
/// `functions` hold the program's ids: `LinkedFunctions::of_program_functions`.
pub fn emit_with_bodies_in_bytes(
    program: &mut Program,
    mut functions: LinkedFunctions,
    in_parallel: InParallel<'_>,
) -> Result<ProgramBytes, EmitError> {
    assert!(
        program.functions.is_empty(),
        "the functions come beside the program"
    );
    assert!(
        functions.tables().is_empty(),
        "a file has no place for tables that lead to the program's ids"
    );
    let mut tasks = functions::create_tasks_for_shared_functions(functions.take_lists());
    layout::measure_tasks(&mut tasks, in_parallel);
    layout::emit_program(program, tasks, in_parallel)
}
