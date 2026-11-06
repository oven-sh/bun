use crate::ir::generated::Function;
use crate::ir::{Id, InParallel, for_each_mut};
use crate::link::{BodyRemap, UnitIds};
use core::mem::take;
use std::sync::Arc;

const REMAPPED_ID_KIND_COUNT: usize = 12;

// These mirror aot/ir/AOTExternalFunctionBodies.h in JavaScriptCore.

#[repr(C)]
#[derive(Copy, Clone)]
struct IdRemapTable {
    entries: *const u32,
    size: usize,
}

#[repr(C)]
struct UnitIdRemap {
    tables: [IdRemapTable; REMAPPED_ID_KIND_COUNT],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct ExternalFunctionBody {
    code: *const u32,
    word_count: u32,
    unit_index: u32,
}

#[repr(C)]
pub struct ExternalFunctionBodies {
    bodies: *const ExternalFunctionBody,
    body_count: usize,
    units: *const UnitIdRemap,
    unit_count: usize,
}

const _: () = assert!(
    size_of::<IdRemapTable>() == 16
        && size_of::<UnitIdRemap>() == 16 * REMAPPED_ID_KIND_COUNT
        && size_of::<ExternalFunctionBody>() == 16
        && size_of::<ExternalFunctionBodies>() == 32
);

fn table_of<I: Id>(ids: &[Option<I>]) -> IdRemapTable {
    const { assert!(size_of::<Option<I>>() == 4) };
    IdRemapTable {
        entries: ids.as_ptr().cast::<u32>(),
        size: ids.len(),
    }
}

fn tables_of(ids: &UnitIds) -> UnitIdRemap {
    UnitIdRemap {
        tables: [
            table_of(&ids.strings),
            table_of(&ids.property_keys),
            table_of(&ids.types),
            table_of(&ids.type_sites),
            table_of(&ids.expected_results),
            table_of(&ids.layouts),
            table_of(&ids.variables),
            table_of(&ids.modules),
            table_of(&ids.module_failures),
            table_of(&ids.eval_scopes),
            table_of(&ids.functions),
            table_of(&ids.data),
        ],
    }
}

/// The code of every function, where lowering wrote it, and what the engine needs to map the unit-local ids of code and record.
pub struct ExternalBodies {
    code: Vec<Vec<u32>>,
    bodies: Vec<ExternalFunctionBody>,
    units: Vec<UnitIdRemap>,
    _remap: BodyRemap,
}

// SAFETY: the pointers point into `code` and `_remap`, which move with the value and are never written again.
unsafe impl Send for ExternalBodies {}

impl ExternalBodies {
    pub(super) fn take_from(
        functions_by_unit: &mut [Vec<Arc<Function>>],
        remap: BodyRemap,
        in_parallel: InParallel<'_>,
    ) -> ExternalBodies {
        let count = functions_by_unit.iter().map(Vec::len).sum();
        let mut code: Vec<Vec<u32>> = Vec::new();
        code.resize_with(count, Vec::new);
        let no_body = ExternalFunctionBody {
            code: core::ptr::null(),
            word_count: 0,
            unit_index: 0,
        };
        let mut bodies = vec![no_body; count];

        struct Task<'a> {
            unit: u32,
            functions: &'a mut [Arc<Function>],
            code: &'a mut [Vec<u32>],
            bodies: &'a mut [ExternalFunctionBody],
        }
        // SAFETY: a task writes the pointers and never reads through them.
        unsafe impl Send for Task<'_> {}

        let mut tasks = Vec::new();
        let (mut free_code, mut free_bodies) = (&mut *code, &mut *bodies);
        for (unit, functions) in (0..).zip(functions_by_unit) {
            if functions.is_empty() {
                continue;
            }
            let (unit_code, rest) = take(&mut free_code).split_at_mut(functions.len());
            free_code = rest;
            let (unit_bodies, rest) = take(&mut free_bodies).split_at_mut(functions.len());
            free_bodies = rest;
            tasks.push(Task {
                unit,
                functions,
                code: unit_code,
                bodies: unit_bodies,
            });
        }
        for_each_mut(&mut tasks, in_parallel, &|task| {
            let slots = task.code.iter_mut().zip(task.bodies.iter_mut());
            for (function, (code, body)) in task.functions.iter_mut().zip(slots) {
                let function =
                    Arc::get_mut(function).expect("the link leaves each record to one owner");
                *code = take(&mut function.body.code);
                *body = ExternalFunctionBody {
                    code: code.as_ptr(),
                    word_count: u32::try_from(code.len()).expect("a body fits 32 bits"),
                    unit_index: task.unit,
                };
            }
        });
        drop(tasks);
        ExternalBodies {
            code,
            bodies,
            units: remap.units().iter().map(tables_of).collect(),
            _remap: remap,
        }
    }

    pub fn size_in_bytes(&self) -> usize {
        let sizes = self.bodies.iter().map(|body| body.word_count as usize * 4);
        sizes.sum()
    }

    /// Valid while `self` is alive.
    pub fn as_engine_argument(&self) -> ExternalFunctionBodies {
        debug_assert_eq!(self.code.len(), self.bodies.len());
        ExternalFunctionBodies {
            bodies: self.bodies.as_ptr(),
            body_count: self.bodies.len(),
            units: self.units.as_ptr(),
            unit_count: self.units.len(),
        }
    }
}
