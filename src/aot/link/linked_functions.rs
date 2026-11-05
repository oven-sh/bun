use super::numbering::TableIds;
use crate::ir::InParallel;
use crate::ir::generated::Function;
use crate::ir::parallel::map_each;
use crate::ir::references::IdMap;
use core::mem::take;
use std::sync::Arc;

/// What one unit defines, in its order.
pub struct FunctionsOfUnit {
    /// Index into `LinkedFunctions::tables`: records and code hold the numbers of these tables.
    pub tables: u32,
    pub functions: Vec<Arc<Function>>,
}

/// The functions of the program where lowering made them, with what leads from their numbers to the program's.
#[derive(Default)]
pub struct LinkedFunctions {
    tables: Vec<TableIds>,
    /// One list after the other, the functions stand in the order of their program ids.
    lists: Vec<FunctionsOfUnit>,
}

/// `None`: the records and the code of the list hold the program's ids already.
fn ids_of<'a>(tables: &'a [TableIds], list: &FunctionsOfUnit) -> Option<&'a TableIds> {
    tables.get(list.tables as usize)
}

// `move_records` has written `function_types` and `builtin_members` in the program's ids. All else holds the numbers of the tables.
fn remap_to_program_ids(function: &mut Function, map: &IdMap<'_>) {
    let function_types = take(&mut function.function_types);
    let builtin_members = take(&mut function.builtin_members);
    function.remap_ids(map);
    function.function_types = function_types;
    function.builtin_members = builtin_members;
}

impl LinkedFunctions {
    pub(crate) fn new(tables: Vec<TableIds>, lists: Vec<FunctionsOfUnit>) -> LinkedFunctions {
        // A list whose tables are missing would pass for one in the program's ids.
        assert!(
            lists.iter().all(|list| ids_of(&tables, list).is_some()),
            "the tables of every list have ids"
        );
        LinkedFunctions { tables, lists }
    }

    /// Records and code hold the program's ids already: no tables.
    pub fn of_program_functions(functions: Vec<Function>) -> LinkedFunctions {
        LinkedFunctions {
            tables: Vec::new(),
            lists: vec![FunctionsOfUnit {
                tables: 0,
                functions: functions.into_iter().map(Arc::new).collect(),
            }],
        }
    }

    pub fn function_count(&self) -> usize {
        self.lists.iter().map(|list| list.functions.len()).sum()
    }

    pub fn tables(&self) -> &[TableIds] {
        &self.tables
    }

    /// The ids of the tables stay, for whoever reads records and code where they are.
    pub(crate) fn take_lists(&mut self) -> Vec<FunctionsOfUnit> {
        take(&mut self.lists)
    }

    /// Records and code in the program's ids, in the order of their own.
    pub fn into_program_functions(self, in_parallel: InParallel<'_>) -> Vec<Function> {
        let mut functions = Vec::with_capacity(self.function_count());
        let LinkedFunctions { tables, lists } = self;
        let moved = map_each(lists, in_parallel, &|list: FunctionsOfUnit| {
            let map = ids_of(&tables, &list).map(TableIds::as_map);
            let records = list.functions.into_iter().map(Arc::unwrap_or_clone);
            let mut records: Vec<Function> = records.collect();
            if let Some(map) = &map {
                for function in &mut records {
                    remap_to_program_ids(function, map);
                }
            }
            records
        });
        functions.extend(moved.into_iter().flatten());
        functions
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{forward, reverse};
    use super::*;
    use crate::builtins::id::BuiltinId;
    use crate::ir::testing::build_function;
    use crate::ir::{FunctionId, Id, ModuleId, Reference, StringId, TypeId, TypeTable, VariableId};

    fn function_at(position: u32) -> Function {
        Function {
            position,
            ..Function::default()
        }
    }

    fn list_at(tables: u32, positions: &[u32]) -> FunctionsOfUnit {
        let functions = positions.iter().map(|&position| function_at(position));
        FunctionsOfUnit {
            tables,
            functions: functions.map(Arc::new).collect(),
        }
    }

    // Ids for what `Function::default()` names: type 0 and module 0.
    fn ids_with_module(module: usize) -> TableIds {
        TableIds {
            types: vec![Some(TypeId::new(0))],
            modules: vec![Some(ModuleId::new(module))],
            ..TableIds::default()
        }
    }

    fn link_four_functions() -> LinkedFunctions {
        let tables = vec![ids_with_module(4), ids_with_module(9)];
        let lists = vec![
            list_at(1, &[10, 11]),
            list_at(0, &[]),
            list_at(0, &[12]),
            list_at(1, &[13]),
        ];
        LinkedFunctions::new(tables, lists)
    }

    #[test]
    fn each_list_is_remapped_by_its_tables_whatever_the_order_of_the_tasks() {
        let move_functions = |in_parallel: InParallel<'_>| -> Vec<(ModuleId, u32)> {
            let moved = link_four_functions().into_program_functions(in_parallel);
            let places = moved.iter();
            places
                .map(|function| (function.module, function.position))
                .collect()
        };
        let [first, second] = [4, 9].map(ModuleId::new);
        let expected = [(second, 10), (second, 11), (first, 12), (second, 13)];
        assert_eq!(move_functions(&forward), expected);
        assert_eq!(move_functions(&reverse), expected);
    }

    #[test]
    fn record_and_code_get_program_ids_but_for_what_the_link_wrote() {
        let well_known_types = 0..=TypeTable::ANYTHING.index();
        let ids = TableIds {
            strings: vec![None, Some(StringId::new(7))],
            types: well_known_types.map(|ty| Some(TypeId::new(ty))).collect(),
            variables: vec![None, None, Some(VariableId::new(8))],
            modules: vec![Some(ModuleId::new(5))],
            ..TableIds::default()
        };
        let function_types = [2, 6].map(FunctionId::new);
        let function = Function {
            name: Some(StringId::new(1)),
            function_types: function_types.to_vec(),
            builtin_members: vec![BuiltinId::default()],
            ..build_function(&[], |builder| {
                let value = builder.get_module_variable(VariableId::new(2));
                builder.return_value(Some(value));
            })
        };
        let lists = vec![FunctionsOfUnit {
            tables: 0,
            functions: vec![Arc::new(function)],
        }];

        let moved = LinkedFunctions::new(vec![ids], lists).into_program_functions(&forward);

        let [function] = moved.as_slice() else {
            panic!("{moved:?}");
        };
        assert_eq!(function.name, Some(StringId::new(7)));
        assert_eq!(function.module, ModuleId::new(5));
        // The tables have no id for any function.
        assert_eq!(function.function_types, function_types);
        assert_eq!(function.builtin_members, [BuiltinId::default()]);
        let mut variables = Vec::new();
        function.body.for_each_reference(&mut |reference| {
            if let Reference::Variable(variable) = reference {
                variables.push(variable);
            }
        });
        assert_eq!(variables, [VariableId::new(8)]);
    }

    #[test]
    fn functions_in_program_ids_have_one_list_and_no_tables() {
        let functions = vec![
            Function {
                module: ModuleId::new(9),
                function_types: vec![FunctionId::new(1)],
                ..function_at(3)
            },
            function_at(4),
        ];
        let mut linked = LinkedFunctions::of_program_functions(functions);
        assert!(linked.tables().is_empty());
        assert_eq!(linked.function_count(), 2);

        let lists = linked.take_lists();
        assert_eq!(linked.function_count(), 0);
        let [list] = lists.as_slice() else {
            panic!("{} lists", lists.len());
        };
        assert_eq!((list.tables, list.functions.len()), (0, 2));
    }

    #[test]
    fn functions_in_program_ids_come_back_as_they_are() {
        let functions = vec![
            Function {
                module: ModuleId::new(9),
                ..function_at(3)
            },
            function_at(4),
        ];
        let linked = LinkedFunctions::of_program_functions(functions.clone());
        assert_eq!(linked.into_program_functions(&forward), functions);
        let none = LinkedFunctions::of_program_functions(Vec::new());
        assert!(none.into_program_functions(&forward).is_empty());
    }

    #[test]
    #[should_panic(expected = "the tables of every list have ids")]
    fn list_under_tables_without_ids_stops_the_link() {
        LinkedFunctions::new(vec![TableIds::default()], vec![list_at(1, &[])]);
    }
}
