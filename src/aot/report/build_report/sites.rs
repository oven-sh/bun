use bun_sema::util::SharedSort;

use super::write_position_members;
use crate::diagnostics::SourcePosition;
use crate::engine::{
    FunctionReportRecord, OperationCountRecord, Position, SourceLocation, position_of,
};
use crate::ir::generated::TypeTestFailure;
use crate::ir::ids::FunctionId;
use crate::link::{ModuleOrigin, ProgramNames};
use crate::report::ReportInput;
use crate::report::format::lower_camel_case;
use crate::report::json::JsonWriter;
use crate::report::levels::{CostCounts, LevelCounts, SiteTotals};
use crate::report::positions::{Positions, is_listed_site, resolve_ascending};
use crate::report::summary::{write_access_counts, write_level_counts};
use crate::report::wording::level_label;

pub(super) struct FunctionIndex {
    // Sorted by function, each with the index of the first record that has it as its source.
    by_source: Vec<(FunctionId, u32)>,
}

pub(super) fn index_functions(records: &[FunctionReportRecord]) -> FunctionIndex {
    let mut by_source: Vec<(FunctionId, u32)> = records
        .iter()
        .zip(0..)
        .filter_map(|(record, index)| Some((record.source_id()?, index)))
        .collect();
    by_source.shared_sort_unstable();
    by_source.dedup_by_key(|&mut (source, _)| source);
    FunctionIndex { by_source }
}

impl FunctionIndex {
    pub(super) fn get(&self, function: Option<FunctionId>) -> Option<u64> {
        let found = self
            .by_source
            .binary_search_by_key(&function?, |&(source, _)| source)
            .ok()?;
        Some(u64::from(self.by_source[found].1))
    }
}

pub(super) fn write_functions(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
) {
    let records = input.engine.functions();
    let wanted: Vec<Option<Position>> = records
        .iter()
        .flat_map(|record| function_bounds(input.names, record.source_id()))
        .collect();
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    json.begin_array("functions");
    for (record, bounds) in records.iter().zip(resolved.as_chunks::<2>().0) {
        let end_line = bounds[1].as_ref().map_or(0, |end| end.line);
        write_function(json, input, record, bounds[0].as_ref(), end_line);
    }
    json.end_array();
}

pub(super) fn write_access_sites(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    functions: &FunctionIndex,
) {
    json.begin_array("accessSites");
    for record in input.engine.accesses() {
        let Some(position) = resolve_listed_position(input.names, positions, record.location)
        else {
            continue;
        };
        json.begin_element();
        write_position_members(json, &position);
        json.string("kind", &lower_camel_case(record.kind.name()));
        json.string("level", level_label(record.level).as_bytes());
        json.string("cost", &lower_camel_case(record.cost.name()));
        json.optional_number("function", functions.get(record.function_id()));
        json.end_object();
    }
    json.end_array();
}

pub(super) fn write_type_test_sites(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    functions: &FunctionIndex,
) {
    json.begin_array("typeTestSites");
    for record in input.engine.type_tests() {
        let Some(position) = resolve_listed_position(input.names, positions, record.location)
        else {
            continue;
        };
        json.begin_element();
        write_position_members(json, &position);
        json.boolean("canThrow", record.failure == TypeTestFailure::Throws);
        json.optional_number("function", functions.get(record.function_id()));
        json.end_object();
    }
    json.end_array();
}

fn write_function(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    record: &FunctionReportRecord,
    start: Option<&SourcePosition>,
    end_line: u32,
) {
    let (engine, names) = (input.engine, input.names);
    let source = record.source_id();
    let unlocated = SourcePosition {
        path: Vec::new(),
        line: 0,
        column: 0,
    };
    json.begin_element();
    write_position_members(json, start.unwrap_or(&unlocated));
    json.number("endLine", u64::from(end_line));
    json.string(
        "name",
        source.map_or(&[][..], |source| names.function_name(source)),
    );
    json.string("role", engine.text(record.role));
    json.boolean("isInDependency", !is_program_function(names, source));
    json.number("codeBytes", u64::from(record.code_bytes));
    let values = source.map(|source| u64::from(names.function_values(source)));
    json.optional_number("valuesAsRead", values);
    let sites = SiteTotals {
        accesses: LevelCounts::from_words(record.accesses),
        access_costs: CostCounts::from_words(record.access_costs),
        calls: LevelCounts::from_words(record.calls),
        type_tests: 0,
    };
    write_access_counts(json, "accesses", &sites);
    write_level_counts(json, "calls", &sites.calls);
    json.begin_object("operations");
    for operation in operations_of(engine.operation_counts(), record) {
        let Ok(name) = core::str::from_utf8(engine.text(operation.name)) else {
            continue;
        };
        json.number(name, u64::from(operation.count));
    }
    json.end_object();
    json.end_object();
}

fn function_bounds(names: &ProgramNames, source: Option<FunctionId>) -> [Option<Position>; 2] {
    let range = source.and_then(|source| {
        Some((
            names.function_module(source)?,
            names.function_range(source)?,
        ))
    });
    let Some((module, (start, end))) = range else {
        return [None, None];
    };
    [start, end].map(|offset| Some(Position { module, offset }))
}

fn is_program_function(names: &ProgramNames, source: Option<FunctionId>) -> bool {
    let module = source.and_then(|source| names.function_module(source));
    match module.map(|module| names.module_origin(module)) {
        Some(ModuleOrigin::Program) => true,
        Some(ModuleOrigin::Dependency | ModuleOrigin::Runtime) | None => false,
    }
}

fn operations_of<'r>(
    counts: &'r [OperationCountRecord],
    record: &FunctionReportRecord,
) -> &'r [OperationCountRecord] {
    let first = record.first_operation as usize;
    counts
        .get(first..first + record.operation_count as usize)
        .unwrap_or(&[])
}

fn listed_position(names: &ProgramNames, location: SourceLocation) -> Option<Position> {
    position_of(location).filter(|_| is_listed_site(names, location, None))
}

fn resolve_listed_position(
    names: &ProgramNames,
    positions: &mut Positions<'_>,
    location: SourceLocation,
) -> Option<SourcePosition> {
    positions.resolve(listed_position(names, location)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::TextRange;
    use crate::ir::ids::ABSENT_WORD;

    fn record_with_source(source: u32) -> FunctionReportRecord {
        FunctionReportRecord {
            source,
            role: TextRange {
                offset: 0,
                length: 0,
            },
            code_bytes: 0,
            accesses: [0; 3],
            calls: [0; 3],
            first_operation: 0,
            operation_count: 0,
            access_costs: [0; 4],
        }
    }

    fn index_of(functions: &FunctionIndex, function: u32) -> Option<u64> {
        functions.get(Some(FunctionId::from_word(function)))
    }

    #[test]
    fn source_function_index_is_first_record() {
        let sources = [5, 2, 5, ABSENT_WORD, 2, 0];
        let functions = index_functions(&sources.map(record_with_source));
        assert_eq!(index_of(&functions, 5), Some(0));
        assert_eq!(index_of(&functions, 2), Some(1));
        assert_eq!(index_of(&functions, 0), Some(5));
    }

    #[test]
    fn absent_function_has_no_index() {
        let functions = index_functions(&[1, ABSENT_WORD].map(record_with_source));
        assert_eq!(functions.get(None), None);
        assert_eq!(index_of(&functions, 0), None);
        assert_eq!(index_of(&functions, 2), None);
        assert_eq!(index_of(&index_functions(&[]), 1), None);
    }
}
