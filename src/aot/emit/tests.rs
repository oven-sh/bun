mod output;
mod positions;
mod tasks;

use super::functions::{self, create_function_tasks};
use super::layout::{Source, Task};
use super::tables::{create_table_tasks, write_strings};
use super::{EmitError, ProgramBytes, emit, source_positions};
use crate::builtins::{BuiltinId, RuntimeFunction};
use crate::compile::testing::TemporaryDirectory;
use crate::ir::generated::String as StringRecord;
use crate::ir::generated::{
    Data, DataMember, DataNode, Entry, EvalBinding, EvalScope, ExpectedResult, Field, Function,
    FunctionFlags, FunctionVisibility, Header, HostRead, ImportPhase, Layout, LayoutKind, LimitId,
    MAGIC, Module, ModuleExport, ModuleFailure, ModuleRequest, ModuleRequestKind, ProgramList,
    RequiredName, RuntimeFunctionEntry, SCHEMA_HASH, StaticField, SyntheticExport, TypeSite,
    TypeSiteKind, Variable, WebAssemblyModule,
};
use crate::ir::testing::{build_function, function_with_parameters};
use crate::ir::{
    BuilderScratch, DataId, DeclaredType, FunctionBuilder, FunctionId, Id, LayoutId, ModuleId,
    PositionFlags, Program, PropertyKey, PropertyKeyId, SectionWriter, StringId, Type, TypeId,
    TypeSiteId, TypeTable, VariableId, WellKnownSymbol, print_program, run_serially,
};
use crate::link::testing::{link_sources, reverse};
use bstr::BStr;

const LAYOUT: LayoutId = LayoutId::from_word(0);
const MODULE: ModuleId = ModuleId::from_word(0);
const FUNCTION: FunctionId = FunctionId::from_word(0);
const VARIABLE: VariableId = VariableId::from_word(0);
const SITE: TypeSiteId = TypeSiteId::from_word(0);
const HEADER_SIZE_IN_BYTES: usize = Header::WORDS * 4;

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
        site: Some(SITE),
        flags: PositionFlags::default(),
    }
}

fn create_expected_result(names: &Names) -> ExpectedResult {
    ExpectedResult {
        ty: names.object,
        layouts: vec![LAYOUT],
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
        }],
        required_names: vec![RequiredName {
            module: MODULE,
            name: names.name,
            may_be_absent: false,
        }],
        positions: source_positions(source, vec![0, 2]),
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
        captures: vec![create_declared_type(names)],
        ..function_with_parameters(FunctionFlags::default(), &[TypeTable::NUMBER])
    };
    let mut builder = FunctionBuilder::new(header, BuilderScratch::default());
    let (parameter, capture) = (builder.parameter(0), builder.capture(0));
    let sum = builder.add(parameter, capture);
    builder.return_value(Some(sum));
    builder.finish().0
}

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

fn emit_serially(program: Program) -> ProgramBytes {
    emit(program, &run_serially).expect("the program fits in 4 GiB")
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

fn create_tasks<'p, 'o>(program: &'p mut Program) -> Vec<Task<'p, 'o>> {
    let functions = std::mem::take(&mut program.functions);
    let mut tasks = create_table_tasks(program);
    tasks.extend(create_function_tasks(functions));
    tasks
}

fn write_task<'a>(task: &'a Task<'_, '_>, sections: &mut SectionWriter<'a>) {
    match &task.source {
        Source::Strings(strings) => write_strings(strings, sections),
        Source::Table(table) => table.write(sections),
        Source::Functions(slice) => functions::write(slice.iter(), sections),
        Source::SharedFunctions(slice) => {
            functions::write(slice.iter().map(|function| &**function), sections);
        }
    }
}

fn assert_sections_are_sequential(create_program: impl Fn() -> Program) {
    let mut program = create_program();
    let tasks = create_tasks(&mut program);
    let mut sections = SectionWriter::new([0; ProgramList::COUNT]);
    for task in &tasks {
        write_task(task, &mut sections);
    }
    let emitted = emit_serially(create_program());
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
            ProgramList::Bytes,
            program.strings.byte_len()
                + program.modules[0].function_text.len()
                + program.web_assembly_modules[0].bytes.len(),
        ),
    ];
    let emitted = emit_serially(program);
    let header = read_header(emitted.as_slice());
    for (list, count) in expected_counts {
        assert_eq!(count_of(&header, list), count, "{}", list.name());
    }
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
    for create_program in create_programs {
        let serial = emit_serially(create_program());
        let reversed = emit(create_program(), &reverse).expect("the program fits in 4 GiB");
        let threaded =
            emit(create_program(), &run_on_four_threads).expect("the program fits in 4 GiB");
        assert!(reversed.as_slice() == serial.as_slice());
        assert!(threaded.as_slice() == serial.as_slice());
    }
}

#[test]
fn code_words_are_copied_unchanged() {
    let program = create_program_with_functions(5);
    let bodies = program.functions.iter();
    let code: Vec<u32> = bodies
        .flat_map(|function| function.body.code.iter().copied())
        .collect();
    assert!(!code.is_empty());
    let emitted = emit_serially(program);
    let bytes = emitted.as_slice();
    let section = section_bytes(bytes, &read_header(bytes), ProgramList::Code);
    assert_eq!(to_words(section), code);
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
    let program = create_program();
    let bodies = program.functions.iter();
    let code_length: usize = bodies.map(|function| function.body.code.len()).sum();
    let emitted = emit_serially(program);
    let header = read_header(emitted.as_slice());
    assert_eq!(count_of(&header, ProgramList::Functions), 1000);
    assert_eq!(count_of(&header, ProgramList::Code), code_length);
}

#[test]
fn large_table_crosses_tasks() {
    let create_program = || create_program_with_variables(10_000);
    assert_sections_are_sequential(create_program);
    let emitted = emit_serially(create_program());
    let header = read_header(emitted.as_slice());
    assert_eq!(count_of(&header, ProgramList::Variables), 10_000);
}

#[test]
fn too_large_program_hits_the_program_id_limit() {
    let error = EmitError::ProgramTooLarge { bytes: 1 << 32 };
    assert_eq!(error.limit(), LimitId::MaxProgramIds);
}

#[test]
#[allow(clippy::disallowed_methods, clippy::disallowed_macros)]
fn engine_prints_same_text() {
    let Some(engine_tool) = std::env::var_os("TESTAOT") else {
        println!("SKIP: TESTAOT is not set");
        return;
    };
    let main = "
        import { join } from 'node:path';
        import { Point } from './point.ts';
        import settings from './settings.json';
        console.log(join('a', 'b'), new Point(settings.x).x);
    ";
    let point = "
        export class Point {
          x: number;
          constructor(x: number) {
            this.x = x;
          }
        }
    ";
    let files = [
        ("main.js", main),
        ("point.ts", point),
        ("settings.json", "{ \"x\": 1 }\n"),
    ];
    let program = link_sources(&files).expect("the program links").program;
    let text = print_program(&program);
    let emitted = emit_serially(program);

    let directory = TemporaryDirectory::new("emit_engine_prints_same_text");
    let directory_path = core::str::from_utf8(directory.path());
    let directory_path = directory_path.expect("the temporary directory has a UTF-8 path");
    let file = std::path::Path::new(directory_path).join("program.bin");
    std::fs::write(&file, emitted.as_slice()).expect("the program file is written");
    let output = std::process::Command::new(engine_tool)
        .args(["print", "--wire"])
        .arg(&file)
        .output()
        .expect("the engine's tool starts");

    assert!(output.status.success(), "{}", BStr::new(&output.stderr));
    let engine_lines = bun_core::strings::split(&output.stdout, b"\n");
    let lines = bun_core::strings::split(text.as_bytes(), b"\n");
    for (number, (engine_line, line)) in (1..).zip(engine_lines.zip(lines)) {
        assert_eq!(BStr::new(engine_line), BStr::new(line), "line {number}");
    }
    assert_eq!(output.stdout.len(), text.len());
}
