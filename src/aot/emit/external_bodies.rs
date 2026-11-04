use crate::ir::generated::Function;
use crate::ir::ids::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId, ModuleFailureId, ModuleId,
    PropertyKeyId, StringId, TypeId, TypeSiteId, VariableId,
};
use crate::ir::{InParallel, for_each_mut};
use crate::link::{FunctionsOfUnit, LinkedFunctions, TableIds};
use core::mem::{MaybeUninit, take};
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
        && size_of::<UnitIdRemap>() == 192
        && size_of::<ExternalFunctionBody>() == 16
        && size_of::<ExternalFunctionBodies>() == 32
);

// The engine reads an entry as the program's number plus one, and 0 as no record. An id holds its number plus one in a `NonZeroU32`, so `None` is 0.
fn table_of<I: Id>(ids: &[Option<I>]) -> IdRemapTable {
    const { assert!(size_of::<Option<I>>() == 4 && align_of::<Option<I>>() == 4) };
    IdRemapTable {
        entries: ids.as_ptr().cast::<u32>(),
        size: ids.len(),
    }
}

// In the order of `RemappedIDKind`.
fn tables_of(ids: &TableIds) -> UnitIdRemap {
    UnitIdRemap {
        tables: [
            table_of::<StringId>(&ids.strings),
            table_of::<PropertyKeyId>(&ids.property_keys),
            table_of::<TypeId>(&ids.types),
            table_of::<TypeSiteId>(&ids.type_sites),
            table_of::<ExpectedResultId>(&ids.expected_results),
            table_of::<LayoutId>(&ids.layouts),
            table_of::<VariableId>(&ids.variables),
            table_of::<ModuleId>(&ids.modules),
            table_of::<ModuleFailureId>(&ids.module_failures),
            table_of::<EvalScopeId>(&ids.eval_scopes),
            table_of::<FunctionId>(&ids.functions),
            table_of::<DataId>(&ids.data),
        ],
    }
}

// Without tables, code and records hold the program's ids, and the engine wants 0 everywhere.
fn unit_index_of(list: &FunctionsOfUnit, unit_count: usize) -> u32 {
    if unit_count == 0 {
        return 0;
    }
    assert!(
        (list.tables as usize) < unit_count,
        "a list is written under tables that come with it"
    );
    list.tables
}

/// The code of every function and the tables that lead the engine from the numbers in code and records to the program's ids.
pub struct ExternalBodies {
    /// One body behind the other. Where lowering wrote them they lay among all that it has freed since, a few hundred thousand blocks
    /// that each kept the page around it.
    code: Vec<u32>,
    bodies: Vec<ExternalFunctionBody>,
    units: Vec<UnitIdRemap>,
    /// Owns the `TableIds`.
    _functions: LinkedFunctions,
}

// SAFETY: the pointers point into `code` and into the `TableIds` of `_functions`, which move with the value and are never written again.
unsafe impl Send for ExternalBodies {}

impl ExternalBodies {
    /// `lists` is what `functions.take_lists()` gave. The records stay in it, without their code.
    pub(super) fn take_from(
        lists: &mut [FunctionsOfUnit],
        functions: LinkedFunctions,
        in_parallel: InParallel<'_>,
    ) -> ExternalBodies {
        let unit_count = functions.tables().len();
        let count: usize = lists.iter().map(|list| list.functions.len()).sum();
        let words_of = |list: &FunctionsOfUnit| -> usize {
            list.functions.iter().map(|function| function.body.code.len()).sum()
        };
        let word_count: usize = lists.iter().map(words_of).sum();
        let mut code: Vec<u32> = Vec::with_capacity(word_count);
        let no_body = ExternalFunctionBody {
            code: core::ptr::null(),
            word_count: 0,
            unit_index: 0,
        };
        let mut bodies = vec![no_body; count];

        struct Task<'a> {
            unit_index: u32,
            functions: &'a mut [Arc<Function>],
            code: &'a mut [MaybeUninit<u32>],
            bodies: &'a mut [ExternalFunctionBody],
        }
        // SAFETY: a task writes the pointers and never reads through them.
        unsafe impl Send for Task<'_> {}

        let mut tasks = Vec::new();
        let (mut free_code, mut free_bodies) = (&mut code.spare_capacity_mut()[..word_count], &mut *bodies);
        for list in lists {
            if list.functions.is_empty() {
                continue;
            }
            let unit_index = unit_index_of(list, unit_count);
            let length = list.functions.len();
            let (list_code, rest) = take(&mut free_code).split_at_mut(words_of(list));
            free_code = rest;
            let (list_bodies, rest) = take(&mut free_bodies).split_at_mut(length);
            free_bodies = rest;
            tasks.push(Task {
                unit_index,
                functions: &mut list.functions,
                code: list_code,
                bodies: list_bodies,
            });
        }
        for_each_mut(&mut tasks, in_parallel, &|task| {
            let mut free = take(&mut task.code);
            for (function, body) in task.functions.iter_mut().zip(task.bodies.iter_mut()) {
                let function =
                    Arc::get_mut(function).expect("the link leaves each record to one owner");
                let written = take(&mut function.body.code);
                let (code, rest) = free.split_at_mut(written.len());
                free = rest;
                *body = ExternalFunctionBody {
                    code: code.write_copy_of_slice(&written).as_ptr(),
                    word_count: u32::try_from(written.len()).expect("a body fits 32 bits"),
                    unit_index: task.unit_index,
                };
            }
        });
        drop(tasks);
        // SAFETY: the tasks share out the first `word_count` words among the bodies, and each body has filled its own.
        unsafe { code.set_len(word_count) };
        ExternalBodies {
            code,
            bodies,
            units: functions.tables().iter().map(tables_of).collect(),
            _functions: functions,
        }
    }

    pub fn size_in_bytes(&self) -> usize {
        let sizes = self.bodies.iter().map(|body| body.word_count as usize * 4);
        sizes.sum()
    }

    /// Valid while `self` is alive, wherever it moves: every list lies on the heap, and nothing writes one again.
    pub fn as_engine_argument(&self) -> ExternalFunctionBodies {
        debug_assert_eq!(self.code.len() * 4, self.size_in_bytes());
        ExternalFunctionBodies {
            bodies: self.bodies.as_ptr(),
            body_count: self.bodies.len(),
            units: self.units.as_ptr(),
            unit_count: self.units.len(),
        }
    }
}
