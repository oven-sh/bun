use super::state::UnitIds;
use crate::ir::generated::Function;
use crate::ir::{InParallel, for_each_mut};
use core::mem::take;
use std::sync::Arc;

/// The functions of the program where lowering made them, a list for each unit, and what maps the ids of each unit.
#[derive(Default)]
pub struct BodyRemap {
    units: Vec<UnitIds>,
    functions: Vec<Vec<Arc<Function>>>,
}

impl BodyRemap {
    pub(super) fn new(units: Vec<UnitIds>, functions: Vec<Vec<Arc<Function>>>) -> BodyRemap {
        assert_eq!(units.len(), functions.len());
        BodyRemap { units, functions }
    }

    pub fn units(&self) -> &[UnitIds] {
        &self.units
    }

    pub fn function_count(&self) -> usize {
        self.functions.iter().map(Vec::len).sum()
    }

    /// In the order of their program ids, each with the ids of its unit.
    pub fn functions(&self) -> impl Iterator<Item = (&UnitIds, &Function)> {
        let lists = self.units.iter().zip(&self.functions);
        lists.flat_map(|(ids, functions)| functions.iter().map(move |function| (ids, &**function)))
    }

    pub fn take_functions(&mut self) -> Vec<Vec<Arc<Function>>> {
        take(&mut self.functions)
    }

    pub fn into_program_functions(mut self, in_parallel: InParallel<'_>) -> Vec<Function> {
        let lists = self.take_functions();
        let mut tasks: Vec<(&UnitIds, Vec<Arc<Function>>, Vec<Function>)> = self
            .units
            .iter()
            .zip(lists)
            .map(|(ids, functions)| (ids, functions, Vec::new()))
            .collect();
        for_each_mut(&mut tasks, in_parallel, &|(ids, functions, remapped)| {
            let map = ids.as_map();
            *remapped = take(functions)
                .into_iter()
                .map(|function| {
                    let mut function = Arc::unwrap_or_clone(function);
                    let function_types = take(&mut function.function_types);
                    function.remap_ids(&map);
                    function.function_types = function_types;
                    function
                })
                .collect();
        });
        tasks
            .into_iter()
            .flat_map(|(_, _, remapped)| remapped)
            .collect()
    }
}
