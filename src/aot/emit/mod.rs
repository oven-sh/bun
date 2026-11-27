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

use crate::ir::{InParallel, Program};
use crate::link::LinkedFunctions;
use crate::statistics::{Stage, StepClock};

pub struct ProgramBytes {
    storage: Vec<u64>,
    external_bodies: Option<ExternalBodies>,
}

impl ProgramBytes {
    fn new(storage: Vec<u64>) -> ProgramBytes {
        ProgramBytes {
            storage,
            external_bodies: None,
        }
    }

    pub fn external_bodies(&self) -> Option<&ExternalBodies> {
        self.external_bodies.as_ref()
    }

    pub fn size_with_external_bodies(&self) -> usize {
        let bodies = self.external_bodies.as_ref();
        self.as_slice().len() + bodies.map_or(0, ExternalBodies::size_in_bytes)
    }

    pub fn free_bytes(&mut self) {
        self.storage = Vec::new();
    }

    pub fn as_slice(&self) -> &[u8] {
        bun_core::slice_as_bytes(&self.storage)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EmitError {
    ProgramTooLarge { bytes: u64 },
}

pub struct FunctionsWithoutCode {
    count: usize,
    tasks: Vec<layout::Task<'static, 'static>>,
    bodies: ExternalBodies,
}

impl FunctionsWithoutCode {
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
