mod output;
mod positions;
mod tasks;

use super::functions::{self, create_tasks_for_shared_functions};
use super::layout::{Source, Task};
use super::tables::{create_table_tasks, write_strings};
use super::{
    ExternalFunctionBodies, FunctionsWithoutCode, ProgramBytes, emit_with_bodies_in_bytes,
    emit_with_external_bodies, source_positions,
};
use crate::builtins::{BuiltinId, RuntimeFunction};
use crate::ir::generated::String as StringRecord;
use crate::ir::generated::{
    AmbiguousExport, Data, DataMember, DataNode, Entry, EvalBinding, EvalScope, ExpectedResult,
    Field, Function, FunctionFlags, FunctionVisibility, Header, HostRead, ImportPhase, Layout,
    LayoutKind, MAGIC, Module, ModuleExport, ModuleFailure, ModuleRequest, ModuleRequestKind,
    OpenedName, ProgramList, QuotedText, ReplaceableBuiltin, RequiredName, RuntimeFunctionEntry,
    SCHEMA_HASH, SourcePositions, SourceStamp, StaticField, SyntheticExport, TypeSite,
    TypeSiteKind, Variable, WebAssemblyModule,
};
use crate::ir::testing::{build_function, function_with_parameters};
use crate::ir::{
    BuilderScratch, DataId, DeclaredType, FunctionBuilder, FunctionId, Id, InParallel, LayoutId,
    ModuleId, PositionFlags, Program, PropertyKey, PropertyKeyId, SectionWriter, StringId, Type,
    TypeId, TypeTable, VariableId, WellKnownSymbol, run_serially,
};
use crate::link::testing::reverse;
use crate::link::{FunctionsOfUnit, LinkedFunctions, TableIds};
use core::mem::take;
use std::sync::Arc;

const LAYOUT: LayoutId = LayoutId::from_word(0);
const MODULE: ModuleId = ModuleId::from_word(0);
const FUNCTION: FunctionId = FunctionId::from_word(0);
const VARIABLE: VariableId = VariableId::from_word(0);
const HEADER_SIZE_IN_BYTES: usize = Header::WORDS * 4;
const REMAPPED_ID_KIND_COUNT: usize = 12;

struct Names {
    name: StringId,
    text: StringId,
    key: PropertyKeyId,
    object: TypeId,
}

fn add_names(program: &mut Program) -> Names {
    let name = program.strings.intern(b"name");
    let text = program.strings.intern("t\u{e9}xt \u{1F600}".as_bytes());
    program.strings.intern(b"");
    let key = program.property_keys.intern(PropertyKey::from_text(name));
    let other_keys = [
        PropertyKey::from_engine_private_name(name),
        PropertyKey::from_private_name(name, LAYOUT),
        PropertyKey::from_well_known_symbol(WellKnownSymbol::default()),
        PropertyKey::from_created_symbol(MODULE, 7, Some(text)),
    ];
    for other_key in other_keys {
        program.property_keys.intern(other_key);
    }
    program.types.intern(Type::string_literal(text));
    let object = program.types.intern(Type::layout(LAYOUT));
    program.types.intern(Type::builtin(BuiltinId::GlobalThis));
    Names {
        name,
        text,
        key,
        object,
    }
}

fn create_declared_type(names: &Names) -> DeclaredType {
    DeclaredType {
        ty: names.object,
        site: None,
        flags: PositionFlags::default(),
    }
}

fn create_expected_result(names: &Names) -> ExpectedResult {
    ExpectedResult {
        ty: names.object,
        layouts: vec![LAYOUT],
        ..ExpectedResult::default()
    }
}

fn create_layout(names: &Names) -> Layout {
    Layout {
        kind: LayoutKind::Instance,
        name: Some(names.name),
        module: Some(MODULE),
        position: 5,
        constructor: Some(FUNCTION),
        fields: vec![Field {
            key: Some(names.key),
            declared: create_declared_type(names),
            ..Field::default()
        }],
        static_fields: vec![StaticField {
            key: Some(names.key),
            computed_key: None,
            variable: VARIABLE,
        }],
        supertypes: vec![LAYOUT],
        ..Layout::default()
    }
}

fn create_module(names: &Names) -> Module {
    let source = "a\n\u{e9}b\n".as_bytes();
    Module {
        path: names.name,
        display_path: names.text,
        body: Some(FUNCTION),
        data: Some(DataId::from_word(0)),
        requests: vec![ModuleRequest {
            target: MODULE,
            phase: ImportPhase::Defer,
            is_dynamic_star_export: true,
            kind: ModuleRequestKind::Import,
            completes: true,
            is_hoisted: false,
        }],
        exports: vec![ModuleExport {
            name: names.name,
            variable: Some(VARIABLE),
            ..ModuleExport::default()
        }],
        synthetic_exports: vec![SyntheticExport {
            name: names.text,
            variable: None,
            is_known_member: true,
            is_replaceable: false,
        }],
        required_names: vec![RequiredName {
            module: MODULE,
            name: names.name,
            may_be_absent: false,
            export_name: Some(names.name),
            specifier: Some(names.text),
            drops_export_if_absent: false,
        }],
        positions: SourcePositions {
            quoted_texts: vec![QuotedText {
                position: 1,
                start: 0,
                end: 2,
            }],
            text_of_quotes: b"ab".to_vec(),
            ..source_positions(source, vec![0, 2])
        },
        function_text: source.to_vec(),
        ..Module::default()
    }
}

fn create_data(names: &Names) -> Data {
    let elements = vec![
        DataNode::Number { value: 1.5 },
        DataNode::Hole,
        DataNode::String { value: names.text },
    ];
    let array = DataNode::Array {
        contents: TypeTable::ANYTHING,
        elements,
    };
    Data {
        root: DataNode::Object {
            layout: LAYOUT,
            members: vec![DataMember {
                key: names.key,
                value: array,
            }],
        },
        module: Some(MODULE),
    }
}

fn create_function(names: &Names) -> Function {
    let header = Function {
        name: Some(names.name),
        module: MODULE,
        captures: vec![create_declared_type(names).into()],
        ..function_with_parameters(FunctionFlags::default(), &[TypeTable::NUMBER])
    };
    let mut builder = FunctionBuilder::new(header, BuilderScratch::default());
    let (parameter, capture) = (builder.parameter(0), builder.capture(0));
    let sum = builder.add(parameter, capture);
    builder.return_value(Some(sum));
    builder.finish().0
}

// Every table holds a record, also the two that a build leaves empty: `tasks.rs` counts a task for each.
fn create_full_program() -> Program {
    let mut program = Program::new();
    let names = add_names(&mut program);
    program.type_sites.push(TypeSite {
        module: MODULE,
        position: 3,
        kind: TypeSiteKind::Field,
        text: Some(names.text),
    });
    program
        .expected_results
        .push(create_expected_result(&names));
    program.layouts.push(create_layout(&names));
    program.variables.push(Variable {
        name: Some(names.name),
        module: MODULE,
        declared: create_declared_type(&names),
        function: Some(FUNCTION),
        owner: Some(LAYOUT),
        ..Variable::default()
    });
    program.modules.push(create_module(&names));
    program.module_failures.push(ModuleFailure {
        importer: MODULE,
        specifier: names.text,
        exporter: Some(MODULE),
        export_specifier: Some(names.text),
        ends_load_of: None,
    });
    program.ambiguous_exports.push(AmbiguousExport {
        module: MODULE,
        name: names.name,
    });
    program.source_stamps.push(SourceStamp {
        module: MODULE,
        low: 7,
        high: 9,
    });
    program.eval_scopes.push(EvalScope {
        bindings: vec![EvalBinding {
            name: Some(names.name),
            variable: Some(VARIABLE),
            ..EvalBinding::default()
        }],
        ..EvalScope::default()
    });
    program.functions.push(create_function(&names));
    program.data.push(create_data(&names));
    program.entries.push(Entry {
        module: MODULE,
        host_reads: vec![HostRead {
            export_name: names.name,
            builtin: Some(BuiltinId::GlobalThis),
            parameter: 0,
        }],
    });
    program.runtime_functions.push(RuntimeFunctionEntry {
        id: RuntimeFunction(1),
        function: FUNCTION,
        visibility: FunctionVisibility::Private,
    });
    program.web_assembly_modules.push(WebAssemblyModule {
        module: MODULE,
        bytes: vec![0, 0x61, 0x73, 0x6D, 1],
    });
    program.replaceable_builtins.push(ReplaceableBuiltin {
        member: BuiltinId::MathMin,
        stays_locked: false,
    });
    let name = program.strings.intern(b"added");
    program.opened_names.push(OpenedName {
        holder: BuiltinId::ObjectPrototype,
        name,
    });
    program
}

fn create_numbered_functions(count: u32) -> Vec<Function> {
    let create = |index: u32| {
        let function = build_function(&[TypeTable::NUMBER], |builder| {
            for _ in 0..index % 3 {
                builder.undefined();
            }
            let value = builder.integer(i64::from(index));
            builder.return_value(Some(value));
        });
        Function {
            position: index,
            ..function
        }
    };
    (0..count).map(create).collect()
}

fn create_program_with_functions(count: u32) -> Program {
    Program {
        functions: create_numbered_functions(count),
        ..Program::new()
    }
}

fn create_program_with_variables(count: usize) -> Program {
    let create = |index| Variable {
        module: ModuleId::new(index),
        ..Variable::default()
    };
    Program {
        variables: (0..count).map(create).collect(),
        ..Program::new()
    }
}

fn code_of(functions: &[Function]) -> Vec<Vec<u32>> {
    let bodies = functions.iter();
    bodies.map(|function| function.body.code.clone()).collect()
}

// The engine reads an entry as the program's number plus one, and zero as no record: the entry at `index` reads as `index`.
fn create_ids<I: Id>(count: usize) -> Vec<Option<I>> {
    (0..count)
        .map(|index| index.checked_sub(1).map(I::new))
        .collect()
}

fn create_table_ids(shortest: usize) -> TableIds {
    TableIds {
        strings: create_ids(shortest),
        property_keys: create_ids(shortest + 1),
        types: create_ids(shortest + 2),
        type_sites: create_ids(shortest + 3),
        expected_results: create_ids(shortest + 4),
        layouts: create_ids(shortest + 5),
        variables: create_ids(shortest + 6),
        modules: create_ids(shortest + 7),
        module_failures: create_ids(shortest + 8),
        eval_scopes: create_ids(shortest + 9),
        functions: create_ids(shortest + 10),
        data: create_ids(shortest + 11),
    }
}

fn entries_of_table_ids(shortest: u32) -> [Vec<u32>; REMAPPED_ID_KIND_COUNT] {
    core::array::from_fn(|kind| (0..shortest + kind as u32).collect())
}

/// A list for each pair: the tables it was written under, and how many of the numbered functions it takes.
fn link_numbered_functions(tables: Vec<TableIds>, lists: &[(u32, usize)]) -> LinkedFunctions {
    let count: usize = lists.iter().map(|&(_, count)| count).sum();
    let functions = create_numbered_functions(count as u32);
    let mut functions = functions.into_iter().map(Arc::new);
    let lists = lists.iter().map(|&(tables, count)| FunctionsOfUnit {
        tables,
        functions: functions.by_ref().take(count).collect(),
    });
    LinkedFunctions::new(tables, lists.collect())
}

fn emit(mut program: Program, in_parallel: InParallel<'_>) -> ProgramBytes {
    let functions = LinkedFunctions::of_program_functions(take(&mut program.functions));
    let functions = FunctionsWithoutCode::new(functions, in_parallel);
    emit_with_external_bodies(&mut program, functions, in_parallel)
        .expect("the program fits in 4 GiB")
}

fn emit_serially(program: Program) -> ProgramBytes {
    emit(program, &run_serially)
}

fn emit_for_file(mut program: Program, in_parallel: InParallel<'_>) -> ProgramBytes {
    let functions = LinkedFunctions::of_program_functions(take(&mut program.functions));
    emit_with_bodies_in_bytes(&mut program, functions, in_parallel)
        .expect("the program fits in 4 GiB")
}

fn emit_functions(functions: LinkedFunctions, in_parallel: InParallel<'_>) -> ProgramBytes {
    let functions = FunctionsWithoutCode::new(functions, in_parallel);
    emit_with_external_bodies(&mut Program::new(), functions, in_parallel)
        .expect("the program fits in 4 GiB")
}

fn run_on_four_threads(count: usize, work: &(dyn Fn(usize) + Sync)) {
    std::thread::scope(|scope| {
        for thread in 0..4 {
            scope.spawn(move || {
                for index in (thread..count).step_by(4) {
                    work(index);
                }
            });
        }
    });
}

fn to_words(bytes: &[u8]) -> Vec<u32> {
    assert_eq!(bytes.len() % 4, 0);
    let words = bytes.chunks_exact(4);
    words
        .map(|word| u32::from_le_bytes([word[0], word[1], word[2], word[3]]))
        .collect()
}

fn to_bytes(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

fn read_header(bytes: &[u8]) -> Header {
    let header = Header::from_words(&to_words(&bytes[..HEADER_SIZE_IN_BYTES]));
    header.expect("the program starts with a header")
}

fn count_of(header: &Header, list: ProgramList) -> usize {
    header.sections[list as usize].count as usize
}

fn section_bytes<'b>(bytes: &'b [u8], header: &Header, list: ProgramList) -> &'b [u8] {
    let start = header.sections[list as usize].offset_in_bytes as usize;
    &bytes[start..start + count_of(header, list) * list.element_size()]
}

// aot/ir/AOTExternalFunctionBodies.h in JavaScriptCore, written out apart from the mirror in external_bodies.rs: a field that
// moves there shows here.

#[repr(C)]
#[derive(Copy, Clone)]
struct EngineIdTable {
    entries: *const u32,
    size: usize,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct EngineUnit {
    tables: [EngineIdTable; REMAPPED_ID_KIND_COUNT],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct EngineBody {
    code: *const u32,
    word_count: u32,
    unit_index: u32,
}

#[repr(C)]
struct EngineBodies {
    bodies: *const EngineBody,
    body_count: usize,
    units: *const EngineUnit,
    unit_count: usize,
}

const _: () = assert!(
    size_of::<EngineIdTable>() == 16
        && size_of::<EngineUnit>() == 16 * REMAPPED_ID_KIND_COUNT
        && size_of::<EngineBody>() == 16
        && size_of::<EngineBodies>() == 32
        && size_of::<EngineBodies>() == size_of::<ExternalFunctionBodies>()
);

#[derive(PartialEq, Eq, Debug)]
struct EngineView {
    code: Vec<Vec<u32>>,
    unit_indices: Vec<u32>,
    /// By unit, then in the order of `RemappedIDKind`.
    tables: Vec<[Vec<u32>; REMAPPED_ID_KIND_COUNT]>,
}

/// # Safety
/// `first` points to `count` values, unless `count` is 0: the pointer of an empty list may be null.
unsafe fn copy_list<T: Copy>(first: *const T, count: usize) -> Vec<T> {
    if count == 0 {
        return Vec::new();
    }
    // SAFETY: the caller vouches for the list.
    unsafe { core::slice::from_raw_parts(first, count) }.to_vec()
}

fn read_as_engine(emitted: &ProgramBytes) -> EngineView {
    let bodies = emitted.external_bodies();
    let bodies = bodies.expect("the bodies come with the bytes");
    let argument = bodies.as_engine_argument();
    // SAFETY: the engine reads the argument as an `EngineBodies`, and each of its lists is valid while `emitted` is alive.
    unsafe {
        let argument = core::ptr::from_ref(&argument).cast::<EngineBodies>();
        let argument = argument.read();
        let bodies = copy_list(argument.bodies, argument.body_count);
        let units = copy_list(argument.units, argument.unit_count);
        let code = bodies
            .iter()
            .map(|body| copy_list(body.code, body.word_count as usize));
        let tables = units.iter().map(|unit| {
            unit.tables
                .map(|table| copy_list(table.entries, table.size))
        });
        EngineView {
            code: code.collect(),
            unit_indices: bodies.iter().map(|body| body.unit_index).collect(),
            tables: tables.collect(),
        }
    }
}

fn create_tasks_with_functions<'p, 'o>(
    program: &'p Program,
    functions: Vec<Function>,
) -> Vec<Task<'p, 'o>> {
    let lists = LinkedFunctions::of_program_functions(functions).take_lists();
    let mut tasks = create_table_tasks(program);
    tasks.extend(create_tasks_for_shared_functions(lists));
    tasks
}

// Emit takes the code out before it writes a record.
fn create_tasks<'p, 'o>(program: &'p mut Program) -> Vec<Task<'p, 'o>> {
    let mut functions = take(&mut program.functions);
    for function in &mut functions {
        function.body.code = Vec::new();
    }
    create_tasks_with_functions(program, functions)
}

fn create_tasks_for_file<'p, 'o>(program: &'p mut Program) -> Vec<Task<'p, 'o>> {
    let functions = take(&mut program.functions);
    create_tasks_with_functions(program, functions)
}

fn write_task<'a>(task: &'a Task<'_, '_>, sections: &mut SectionWriter<'a>) {
    match &task.source {
        Source::Strings(strings) => write_strings(strings, sections),
        Source::Table(table) => table.write(sections),
        Source::SharedFunctions(slice) => {
            functions::write(slice.iter().map(|function| &**function), sections);
        }
    }
}

fn assert_sections_follow_tasks(emitted: &ProgramBytes, tasks: &[Task<'_, '_>]) {
    let mut sections = SectionWriter::new([0; ProgramList::COUNT]);
    for task in tasks {
        write_task(task, &mut sections);
    }
    let bytes = emitted.as_slice();
    let header = read_header(bytes);
    for list in ProgramList::ALL {
        let expected_bytes = if list == ProgramList::Bytes {
            sections.blobs().concat()
        } else {
            to_bytes(sections.words_of(list))
        };
        let name = list.name();
        assert_eq!(
            count_of(&header, list) as u64,
            sections.count_of(list),
            "{name}"
        );
        assert_eq!(
            section_bytes(bytes, &header, list),
            expected_bytes,
            "{name}"
        );
    }
}

fn assert_sections_are_sequential(create_program: impl Fn() -> Program) {
    let mut program = create_program();
    assert_sections_follow_tasks(
        &emit_serially(create_program()),
        &create_tasks(&mut program),
    );
    let mut program = create_program();
    let file = emit_for_file(create_program(), &run_serially);
    assert_sections_follow_tasks(&file, &create_tasks_for_file(&mut program));
}

fn assert_sections_tile(bytes: &[u8]) {
    let header = read_header(bytes);
    assert_eq!(header.size_in_bytes as usize, bytes.len());
    assert_eq!(bytes.len() % 8, 0);
    let mut end = HEADER_SIZE_IN_BYTES;
    for list in ProgramList::ALL {
        let name = list.name();
        let start = header.sections[list as usize].offset_in_bytes as usize;
        assert_eq!(start % 4, 0, "{name}");
        assert!(end <= start && start - end <= 3, "{name}");
        assert!(bytes[end..start].iter().all(|&byte| byte == 0), "{name}");
        end = start + count_of(&header, list) * list.element_size();
    }
    assert!(end <= bytes.len() && bytes.len() - end <= 7);
    assert!(bytes[end..].iter().all(|&byte| byte == 0));
}

#[test]
fn header_of_empty_program() {
    let emitted = emit_serially(Program::new());
    let bytes = emitted.as_slice();
    let first_words = [
        MAGIC,
        SCHEMA_HASH as u32,
        (SCHEMA_HASH >> 32) as u32,
        bytes.len() as u32,
    ];
    assert_eq!(to_words(&bytes[..first_words.len() * 4]), first_words);

    let header = read_header(bytes);
    assert_eq!(header.schema_hash, SCHEMA_HASH);
    assert_eq!(header.sections.len(), ProgramList::COUNT);
    for list in ProgramList::ALL {
        let expected_count = if list == ProgramList::Types {
            TypeTable::WELL_KNOWN_COUNT
        } else if list == ProgramList::ClassParts || list == ProgramList::Words {
            1
        } else {
            0
        };
        assert_eq!(count_of(&header, list), expected_count, "{}", list.name());
    }
}

#[test]
fn storage_is_aligned_to_8_bytes() {
    let emitted = emit_serially(create_full_program());
    assert_eq!(emitted.as_slice().as_ptr().align_offset(8), 0);
}

#[test]
fn sections_tile_the_buffer() {
    let programs = [
        Program::new(),
        create_full_program(),
        create_program_with_functions(300),
    ];
    for program in programs {
        assert_sections_tile(emit_serially(program).as_slice());
    }
}

#[test]
fn counts_match_program() {
    let program = create_full_program();
    let expected_counts = [
        (ProgramList::Strings, program.strings.len()),
        (ProgramList::PropertyKeys, program.property_keys.len()),
        (ProgramList::Types, program.types.len()),
        (ProgramList::TypeSites, program.type_sites.len()),
        (ProgramList::ExpectedResults, program.expected_results.len()),
        (ProgramList::Layouts, program.layouts.len()),
        (ProgramList::Variables, program.variables.len()),
        (ProgramList::Modules, program.modules.len()),
        (ProgramList::ModuleFailures, program.module_failures.len()),
        (
            ProgramList::AmbiguousExports,
            program.ambiguous_exports.len(),
        ),
        (ProgramList::SourceStamps, program.source_stamps.len()),
        (ProgramList::EvalScopes, program.eval_scopes.len()),
        (ProgramList::Functions, program.functions.len()),
        (ProgramList::Data, program.data.len()),
        (ProgramList::Entries, program.entries.len()),
        (
            ProgramList::RuntimeFunctions,
            program.runtime_functions.len(),
        ),
        (
            ProgramList::WebAssemblyModules,
            program.web_assembly_modules.len(),
        ),
        (
            ProgramList::ReplaceableBuiltins,
            program.replaceable_builtins.len(),
        ),
        (ProgramList::OpenedNames, program.opened_names.len()),
        (
            ProgramList::Bytes,
            program.strings.byte_len()
                + program.modules[0].function_text.len()
                + program.modules[0].positions.text_of_quotes.len()
                + program.web_assembly_modules[0].bytes.len(),
        ),
    ];
    let emitted = emit_serially(program);
    let header = read_header(emitted.as_slice());
    for (list, count) in expected_counts {
        assert_eq!(count_of(&header, list), count, "{}", list.name());
    }
    for list in ProgramList::ALL {
        let is_empty = count_of(&header, list) == 0;
        assert_eq!(is_empty, list == ProgramList::Code, "{}", list.name());
    }
    let file = emit_for_file(create_full_program(), &run_serially);
    let header = read_header(file.as_slice());
    for list in ProgramList::ALL {
        assert_ne!(count_of(&header, list), 0, "{}", list.name());
    }
}

#[test]
fn sections_hold_records_in_task_order() {
    assert_sections_are_sequential(Program::new);
    assert_sections_are_sequential(create_full_program);
}

#[test]
fn bytes_do_not_depend_on_schedule() {
    let create_programs: [fn() -> Program; 3] = [
        create_full_program,
        || create_program_with_functions(1000),
        || create_program_with_variables(10_000),
    ];
    let schedules: [InParallel<'_>; 2] = [&reverse, &run_on_four_threads];
    for create_program in create_programs {
        let serial = emit_serially(create_program());
        let bodies = read_as_engine(&serial);
        let file = emit_for_file(create_program(), &run_serially);
        for in_parallel in schedules {
            let emitted = emit(create_program(), in_parallel);
            assert!(emitted.as_slice() == serial.as_slice());
            assert!(read_as_engine(&emitted) == bodies);
            assert!(emit_for_file(create_program(), in_parallel).as_slice() == file.as_slice());
        }
    }
}

#[test]
fn code_is_handed_over_outside_the_bytes() {
    let program = create_program_with_functions(5);
    let code = code_of(&program.functions);
    assert!(code.iter().all(|words| !words.is_empty()));
    let emitted = emit_serially(program);
    let header = read_header(emitted.as_slice());
    assert_eq!(count_of(&header, ProgramList::Functions), 5);
    assert_eq!(count_of(&header, ProgramList::Code), 0);
    let bodies = read_as_engine(&emitted);
    assert_eq!(bodies.code, code);
    assert_eq!(bodies.unit_indices, [0; 5]);
    assert!(bodies.tables.is_empty());
}

#[test]
fn code_of_a_file_lies_in_the_bytes() {
    let program = create_program_with_functions(1000);
    let code = code_of(&program.functions).concat();
    assert!(!code.is_empty());
    let file = emit_for_file(program, &run_serially);
    assert!(file.external_bodies().is_none());
    let bytes = file.as_slice();
    assert_sections_tile(bytes);
    let header = read_header(bytes);
    assert_eq!(count_of(&header, ProgramList::Functions), 1000);
    let section = section_bytes(bytes, &header, ProgramList::Code);
    assert_eq!(to_words(section), code);
}

#[test]
#[should_panic(expected = "a file has no place for tables that lead to the program's ids")]
fn file_takes_no_functions_under_tables() {
    let functions = link_numbered_functions(vec![create_table_ids(0)], &[(0, 1)]);
    emit_with_bodies_in_bytes(&mut Program::new(), functions, &run_serially)
        .expect("the program fits in 4 GiB");
}

#[test]
fn two_lists_under_two_tables() {
    let tables = vec![create_table_ids(0), create_table_ids(20)];
    let functions = link_numbered_functions(tables, &[(0, 2), (1, 3)]);
    let emitted = emit_functions(functions, &run_serially);
    let header = read_header(emitted.as_slice());
    assert_eq!(count_of(&header, ProgramList::Functions), 5);
    let bodies = read_as_engine(&emitted);
    assert_eq!(bodies.code, code_of(&create_numbered_functions(5)));
    assert_eq!(bodies.unit_indices, [0, 0, 1, 1, 1]);
    let expected_tables = [entries_of_table_ids(0), entries_of_table_ids(20)];
    assert_eq!(bodies.tables, expected_tables);
}

#[test]
fn unit_index_is_the_tables_of_a_list() {
    let link = || {
        let tables = vec![create_table_ids(3), create_table_ids(0)];
        link_numbered_functions(tables, &[(1, 2), (0, 0), (0, 1), (1, 1)])
    };
    let bodies = read_as_engine(&emit_functions(link(), &run_serially));
    assert_eq!(bodies.code, code_of(&create_numbered_functions(4)));
    assert_eq!(bodies.unit_indices, [1, 1, 0, 1]);
    let expected_tables = [entries_of_table_ids(3), entries_of_table_ids(0)];
    assert_eq!(bodies.tables, expected_tables);
    assert!(read_as_engine(&emit_functions(link(), &reverse)) == bodies);
    assert!(read_as_engine(&emit_functions(link(), &run_on_four_threads)) == bodies);
}

#[test]
fn strings_section_points_into_bytes() {
    let program = create_full_program();
    let strings = &program.strings;
    let expected_strings: Vec<(Vec<u8>, StringRecord)> = strings
        .ids()
        .map(|id| {
            let record = StringRecord {
                name_class: strings.name_class(id),
                builtin_name: strings.builtin_name(id),
                ..StringRecord::default()
            };
            (strings.get(id).to_vec(), record)
        })
        .collect();
    let emitted = emit_serially(program);
    let bytes = emitted.as_slice();
    let header = read_header(bytes);
    let texts = section_bytes(bytes, &header, ProgramList::Bytes);
    let words = to_words(section_bytes(bytes, &header, ProgramList::Strings));
    let records = words.chunks_exact(StringRecord::WORDS);
    assert_eq!(records.len(), expected_strings.len());
    for (words, (text, expected)) in records.zip(expected_strings) {
        let record = StringRecord::from_words(words).expect("the words are a string record");
        let start = record.offset as usize;
        assert_eq!(texts[start..start + record.length as usize], text);
        assert_eq!(record.name_class, expected.name_class);
        assert_eq!(record.builtin_name, expected.builtin_name);
    }
}

#[test]
fn many_functions_cross_slices() {
    let create_program = || create_program_with_functions(1000);
    assert_sections_are_sequential(create_program);
    let emitted = emit_serially(create_program());
    let header = read_header(emitted.as_slice());
    assert_eq!(count_of(&header, ProgramList::Functions), 1000);
}

#[test]
fn large_table_crosses_tasks() {
    let create_program = || create_program_with_variables(10_000);
    assert_sections_are_sequential(create_program);
    let emitted = emit_serially(create_program());
    let header = read_header(emitted.as_slice());
    assert_eq!(count_of(&header, ProgramList::Variables), 10_000);
}
