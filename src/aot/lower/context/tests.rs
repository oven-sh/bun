use bun_core::strings::index_of;
use bun_sema::program::FileId;

use super::SourceKind;
use crate::builtins::SourceDialect;
use crate::builtins::id::{BuiltinId, RuntimeModule};
use crate::compile::testing::lower_program;
use crate::diagnostic_codes::Code;
use crate::diagnostics::Diagnostic;
use crate::ir::generated::{
    BlockRole, ECMAMode, EntryParameter, Function, FunctionFlags, FunctionRole, SourceRange,
    Variable, VariableFlags, VariableInitialization, visit_value_fields,
};
use crate::ir::{
    BlockId, BlockView, DeclaredType, EntryPosition, FieldWord, FunctionId, FunctionKey, Id,
    LayoutKey, Mapped, Opcode, PositionFlags, Primitives, PropertyKeyId, Reference, StringId,
    TypeTable, ValueId, ValueView, VariableId, VariableKey,
};
use crate::load::host_platform;
use crate::lower::{Fragment, LoweredFile, LoweringOptions, UnitTables};

const VARIED_PROGRAM: &str = "interface Shape { side: number }
export class Square implements Shape {
  side = 1;
  static count = 0;
  get area() { return this.side * this.side; }
  grow() { return () => this.side++; }
}
export function create(side: number): Shape {
  function measure(shape: Shape) { return shape.side; }
  const square = new Square();
  square.side = side;
  measure(square);
  return square;
}
export function repeat(count: number, action: () => void) {
  while (count) { try { action(); } catch { count = 0; } count--; }
}
";

const LIBRARY_MODULE_PATH: &str = "/$bun/js/node/os.ts";

const KEYED_STATE: &str = "const kState: symbol = Symbol(\"kState\");
export function setState(holder: any, state: number): number {
  holder[kState] = state;
  return state;
}
";

fn lowering_options(embeds_function_text: bool) -> LoweringOptions {
    LoweringOptions {
        platform: host_platform(),
        embeds_function_text,
        removable: Default::default(),
        minifies_identifiers: false,
        obfuscates: false,
        counts_executions: false,
        runs_tests: false,
    }
}

fn lower(files: &[(&str, &str)]) -> Vec<(FileId, LoweredFile)> {
    lower_program(files, lowering_options(false))
}

#[track_caller]
fn take_only_file(mut lowered: Vec<(FileId, LoweredFile)>) -> LoweredFile {
    assert_eq!(lowered.len(), 1);
    lowered.remove(0).1
}

#[track_caller]
fn lower_file(name: &str, source: &str) -> LoweredFile {
    take_only_file(lower(&[(name, source)]))
}

fn lower_in_both_projects(source: &str) -> Vec<(FileId, LoweredFile)> {
    lower(&[
        (
            "main.ts",
            "import \"node:os\";\nimport \"./application\";\n",
        ),
        ("application.ts", source),
        (LIBRARY_MODULE_PATH, source),
    ])
}

#[track_caller]
fn lower_library_module(source: &str) -> LoweredFile {
    let importer = ("main.ts", "import \"node:os\";\n");
    let mut lowered = lower(&[importer, (LIBRARY_MODULE_PATH, source)]);
    assert_eq!(
        lowered.len(),
        2,
        "the entry point and the module of the library"
    );
    lowered.remove(1).1
}

#[track_caller]
fn offset_of(source: &str, text: &str) -> u32 {
    let offset = index_of(source.as_bytes(), text.as_bytes());
    offset.expect("the source has the text") as u32
}

// The files that one task of the checker lowers share their tables, so whoever reads them gives them back.
fn with_tables<R>(fragment: &Fragment, read: impl FnOnce(&UnitTables) -> R) -> R {
    let tables = fragment.tables.take();
    let answer = read(&tables);
    fragment.tables.put_back(tables);
    answer
}

fn holds_text(fragment: &Fragment, string: Option<StringId>, text: &str) -> bool {
    with_tables(fragment, |tables| {
        string.map(|string| tables.strings.get(string)) == Some(text.as_bytes())
    })
}

fn has_name(fragment: &Fragment, function: &Function, name: &str) -> bool {
    holds_text(fragment, function.name, name)
}

#[track_caller]
fn find_function<'a>(fragment: &'a Fragment, name: &str) -> &'a Function {
    let mut functions = fragment.functions.iter().map(|(_, function)| function);
    let function = functions.find(|function| has_name(fragment, function, name));
    function.expect("the fragment defines the function")
}

// The application's definition comes first.
#[track_caller]
fn find_definitions<'a>(
    lowered: &'a [(FileId, LoweredFile)],
    name: &str,
) -> [(&'a Fragment, &'a Function); 2] {
    let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
    let definitions = fragments.flat_map(|fragment| {
        let functions = fragment.functions.iter().map(|(_, function)| &**function);
        let named = functions.filter(move |function| has_name(fragment, function, name));
        named.map(move |function| (fragment, function))
    });
    let definitions: Vec<(&Fragment, &Function)> = definitions.collect();
    let [application, library] = definitions[..] else {
        panic!("{} functions are named {name}", definitions.len());
    };
    assert_eq!(application.1.role, FunctionRole::Source);
    assert_eq!(library.1.role, FunctionRole::Library);
    [application, library]
}

#[track_caller]
fn find_module_body(fragment: &Fragment) -> &Function {
    let body = fragment.module.body.expect("the module has a body");
    let mut functions = fragment.functions.iter();
    let found = functions.find(|(function, _)| *function == body);
    &found
        .expect("the fragment defines the body of its module")
        .1
}

#[track_caller]
fn find_variable<'a>(fragment: &'a Fragment, name: &str) -> &'a Variable {
    let mut variables = fragment.variables.iter().map(|(_, variable)| variable);
    let variable = variables.find(|variable| holds_text(fragment, variable.name, name));
    variable.expect("the fragment defines the variable")
}

fn key_of(fragment: &Fragment, function: FunctionId) -> FunctionKey {
    with_tables(fragment, |tables| tables.function_keys[function.index()])
}

// What lies at or behind the lengths of a fragment was named by a later visit of the task.
fn function_keys(fragment: &Fragment) -> Vec<FunctionKey> {
    let count = fragment.lengths.functions as usize;
    with_tables(fragment, |tables| tables.function_keys[..count].to_vec())
}

fn layout_keys(fragment: &Fragment) -> Vec<LayoutKey> {
    let count = fragment.lengths.layouts as usize;
    with_tables(fragment, |tables| tables.layout_keys[..count].to_vec())
}

fn variable_keys(fragment: &Fragment) -> Vec<VariableKey> {
    let count = fragment.lengths.variables as usize;
    with_tables(fragment, |tables| tables.variable_keys[..count].to_vec())
}

// The tables also list what an earlier file of the task has named, so they do not say what this file names.
fn variables_named_by_code(fragment: &Fragment) -> Vec<VariableId> {
    let mut variables = Vec::new();
    for (_, function) in &fragment.functions {
        function.body.for_each_reference(&mut |reference| {
            if let Reference::Variable(variable) = reference {
                variables.push(variable);
            }
        });
    }
    variables
}

fn parameter(function: &Function, index: u32) -> ValueId {
    let position = EntryPosition::new(EntryParameter::Parameter, index);
    let index = function.entry_parameter_index(position);
    ValueId::new(index.expect("the function declares the parameter"))
}

fn operands(value: ValueView<'_>) -> Vec<ValueId> {
    let mut operands = Vec::new();
    visit_value_fields(
        value.opcode,
        value.fields,
        0,
        &mut |field, at| match field {
            FieldWord::Operand => operands.push(ValueId::from_word(value.fields[at])),
            FieldWord::Reference(_) => {}
        },
    );
    operands
}

fn values(function: &Function) -> impl Iterator<Item = ValueView<'_>> {
    function.body.blocks().flat_map(|block| block.values())
}

fn opcodes(function: &Function) -> Vec<Opcode> {
    values(function).map(|value| value.opcode).collect()
}

fn count_operations(function: &Function, opcode: Opcode) -> usize {
    values(function)
        .filter(|value| value.opcode == opcode)
        .count()
}

#[track_caller]
fn find_value(function: &Function, id: ValueId) -> ValueView<'_> {
    let found = values(function).find(|value| value.id == id);
    found.expect("the function defines the value")
}

fn names_builtin(function: &Function, value: ValueId, builtin: BuiltinId) -> bool {
    let definition = values(function).find(|candidate| candidate.id == value);
    definition.is_some_and(|definition| {
        definition.opcode == Opcode::Builtin && definition.fields[1..] == [builtin.to_wire()]
    })
}

#[track_caller]
fn find_block(function: &Function, block: BlockId) -> BlockView<'_> {
    let found = function
        .body
        .blocks()
        .find(|candidate| candidate.id == block);
    found.expect("the function has the block")
}

#[track_caller]
fn skip_conversions(function: &Function, value: ValueId) -> ValueId {
    let mut values = function.body.blocks().flat_map(|block| block.values());
    match values.find(|candidate| candidate.id == value && candidate.opcode == Opcode::Convert) {
        Some(conversion) => skip_conversions(function, ValueId::from_word(conversion.fields[0])),
        None => value,
    }
}

fn find_call_block<'a>(function: &'a Function, call_operands: &[ValueId]) -> BlockView<'a> {
    let is_matching_call = |value: ValueView<'_>| {
        let passed = operands(value).into_iter();
        let passed: Vec<ValueId> = passed
            .map(|operand| skip_conversions(function, operand))
            .collect();
        value.opcode == Opcode::Call && passed == call_operands
    };
    let found = function
        .body
        .blocks()
        .find(|block| block.values().any(is_matching_call));
    found.expect("the function has the call")
}

#[track_caller]
fn find_store_mode(fragment: &Fragment, function: &Function, property: &str) -> ECMAMode {
    let values = function.body.blocks().flat_map(|block| block.values());
    let modes = values.filter_map(|value| {
        let (Opcode::PropSet, &[_, _, key, mode, _]) = (value.opcode, value.fields) else {
            return None;
        };
        let key = PropertyKeyId::from_word(key);
        let text = with_tables(fragment, |tables| tables.property_keys.get(key).text);
        let is_matching_store = holds_text(fragment, text, property);
        is_matching_store
            .then(|| ECMAMode::from_wire(mode))
            .flatten()
    });
    let modes: Vec<ECMAMode> = modes.collect();
    assert_eq!(modes.len(), 1, "one store to {property}");
    modes[0]
}

fn nested_function(name: &str, depth: usize) -> String {
    let operators = "~".repeat(depth);
    format!("export function {name}(a) {{ return {operators}a; }}\n")
}

fn nesting_reports(lowered: &LoweredFile) -> Vec<&Diagnostic> {
    let reports = lowered.diagnostics.iter();
    reports
        .filter(|diagnostic| diagnostic.code == Code::NestedTooDeeply)
        .collect()
}

#[test]
fn source_kind_decides_dialect_and_role() {
    let kinds = [
        (
            SourceKind::Program,
            SourceDialect::Program,
            FunctionRole::Source,
        ),
        (
            SourceKind::RuntimeModule(RuntimeModule::default()),
            SourceDialect::Runtime,
            FunctionRole::Library,
        ),
        (
            SourceKind::RuntimeFunctions,
            SourceDialect::Runtime,
            FunctionRole::Library,
        ),
    ];
    for (kind, dialect, role) in kinds {
        assert_eq!(kind.dialect(), dialect, "{kind:?}");
        assert_eq!(kind.function_role(), role, "{kind:?}");
    }
}

// Bun's own sources are lowered with their types, as the program's are.
#[test]
fn library_module_checks_types_as_application_code_does() {
    let lowered = lower_in_both_projects(KEYED_STATE);
    for (_, function) in find_definitions(&lowered, "setState") {
        let role = function.role;
        assert!(
            function.flags.contains(FunctionFlags::IS_CHECKED),
            "{role:?}"
        );
        let [holder, state] = function.parameters[..] else {
            panic!("{role:?}: {} parameters", function.parameters.len());
        };
        assert_eq!(holder, DeclaredType::untyped(), "{role:?}");
        for position in [state, function.results[0]] {
            assert_eq!(position.ty, TypeTable::NUMBER, "{role:?}");
            assert!(!position.is_expected(), "{role:?}");
        }
    }
}

// A module of Bun's hoists its top-level variables, so none of them has a dead zone.
#[test]
fn library_module_has_operations_of_application_code_without_dead_zones() {
    let lowered = lower_in_both_projects(KEYED_STATE);
    let [(_, application), (_, library)] = find_definitions(&lowered, "setState");
    let mut expected = opcodes(application);
    assert!(expected.contains(&Opcode::CheckInitialized));
    expected.retain(|&opcode| opcode != Opcode::CheckInitialized);
    assert_eq!(opcodes(library), expected);
}

#[test]
fn constant_of_library_module_is_module_variable() {
    let lowered = lower_in_both_projects(KEYED_STATE);
    for (fragment, function) in find_definitions(&lowered, "setState") {
        let role = function.role;
        let variable = find_variable(fragment, "kState");
        assert_eq!(variable.module, function.module, "{role:?}");
        let has_dead_zone = role != FunctionRole::Library;
        let initialization = match has_dead_zone {
            true => VariableInitialization::Uninitialized,
            false => VariableInitialization::Undefined,
        };
        assert_eq!(variable.initialization, initialization, "{role:?}");
        assert_eq!(variable.flags, VariableFlags::IS_IMMUTABLE, "{role:?}");
        assert!(!variable.declared.is_expected(), "{role:?}");
        let declared = variable.declared.ty;
        let primitives = with_tables(fragment, |tables| tables.types.get(declared).primitives);
        assert_eq!(
            primitives.contains(Primitives::ABSENT),
            has_dead_zone,
            "{role:?}"
        );
        let values = primitives.without(Primitives::ABSENT | Primitives::NULLISH);
        assert_eq!(values, Primitives::SYMBOL, "{role:?}");
        assert_eq!(
            count_operations(function, Opcode::GetModuleVariable),
            1,
            "{role:?}"
        );
        assert_eq!(count_operations(function, Opcode::ElemSet), 1, "{role:?}");
    }
}

#[test]
fn symbol_of_library_module_is_created_by_call_of_builtin() {
    let lowered = lower_in_both_projects(KEYED_STATE);
    for (fragment, function) in find_definitions(&lowered, "setState") {
        let role = function.role;
        let body = find_module_body(fragment);
        let calls = values(body).filter(|value| value.opcode == Opcode::Call);
        let creations: Vec<ValueView<'_>> = calls
            .filter(|&call| names_builtin(body, operands(call)[0], BuiltinId::Symbol))
            .collect();
        let [creation] = creations[..] else {
            panic!("{role:?}: {} calls of Symbol", creations.len());
        };
        assert!(creation.position.is_some(), "{role:?}");
        let [_, description] = operands(creation)[..] else {
            panic!("{role:?}: the call passes the description and nothing else");
        };
        assert_eq!(
            find_value(body, description).opcode,
            Opcode::String,
            "{role:?}"
        );
    }
}

// No annotation of such a file counts as written. A parameter keeps what the checker makes of it, as a guess.
#[test]
fn library_module_with_unverified_types_has_expected_parameters_alone() {
    let source = ["// @ts-nocheck\n", KEYED_STATE].concat();
    let fragment = lower_library_module(&source).fragment;
    let function = find_function(&fragment, "setState");
    assert_eq!(function.role, FunctionRole::Library);
    assert!(!function.flags.contains(FunctionFlags::IS_CHECKED));
    let number = Mapped::expected(TypeTable::NUMBER);
    let expected = DeclaredType::new(number, None, PositionFlags::default());
    assert_eq!(function.parameters, [DeclaredType::untyped(), expected]);
    assert_eq!(function.results, [DeclaredType::untyped()]);
    assert_eq!(
        find_variable(&fragment, "kState").declared,
        DeclaredType::untyped()
    );
}

#[test]
fn functions_are_defined_in_declaration_order() {
    let source = "
function a() { function b() {} b(); }
function c() {}
a();
c();
export {};
";
    let fragment = lower_file("main.ts", source).fragment;
    let body = fragment.functions[0].0;
    assert_eq!(
        key_of(&fragment, body),
        FunctionKey::ModuleBody(fragment.file)
    );
    let functions = fragment.functions.iter();
    let positions: Vec<u32> = functions.map(|(_, function)| function.position).collect();
    let declared = ["function a", "function c", "function b"].map(|text| offset_of(source, text));
    assert_eq!(positions, [0, declared[0], declared[1], declared[2]]);
}

#[test]
fn function_mentioned_twice_is_defined_once() {
    let fragment = lower_file("main.ts", "export function f() {}\nf();\nf();\n").fragment;
    let functions = fragment.functions.iter();
    let definitions = functions.filter(|(_, function)| has_name(&fragment, function, "f"));
    assert_eq!(definitions.count(), 1);
}

#[test]
fn every_declared_function_of_file_is_defined() {
    let fragment = lower_file("main.ts", VARIED_PROGRAM).fragment;
    let declared = function_keys(&fragment);
    let keys = declared.iter().enumerate();
    let own_keys: Vec<(usize, &FunctionKey)> = keys
        .filter(|(_, key)| key.home_file() == fragment.file)
        .collect();
    assert!(own_keys.len() > 5);
    for (index, key) in own_keys {
        let definitions = fragment.functions.iter();
        let definitions = definitions.filter(|(function, _)| function.index() == index);
        assert_eq!(definitions.count(), 1, "{key:?}");
    }
}

#[test]
fn imported_function_is_not_defined() {
    let lowered = lower(&[
        ("main.ts", "import { f } from \"./other\";\nf();\n"),
        ("other.ts", "export function f() {}\n"),
    ]);
    assert_eq!(lowered.len(), 2);
    let mut mentions_other_file = false;
    for (file, lowered) in &lowered {
        let fragment = &lowered.fragment;
        assert_eq!(fragment.file, *file);
        for &(function, _) in &fragment.functions {
            assert_eq!(key_of(fragment, function).home_file(), *file);
        }
        let keys = variable_keys(fragment);
        for &(variable, _) in &fragment.variables {
            let key = keys[variable.index()];
            assert_eq!(key.home_file(), Some(*file), "{key:?}");
        }
        let named = variables_named_by_code(fragment).into_iter();
        let mut homes = named.map(|variable| keys[variable.index()].home_file());
        mentions_other_file |= homes.any(|home| home.is_some_and(|home| home != *file));
    }
    assert!(mentions_other_file);
}

#[test]
fn nothing_leads_to_entry_block() {
    let fragment = lower_file("main.ts", VARIED_PROGRAM).fragment;
    let entry = BlockId::new(0);
    let functions = fragment.functions.iter();
    for (id, function) in functions.filter(|(_, function)| function.role != FunctionRole::Signature)
    {
        let first = function
            .body
            .blocks()
            .next()
            .expect("a function has an entry block");
        assert_eq!(first.id, entry);
        for block in function.body.blocks() {
            let targets = block.terminator().targets().chain(block.handler());
            for target in targets {
                assert_ne!(target.block, entry, "{id} {}", block.id);
            }
        }
    }
}

#[test]
fn text_range_is_cleared_without_function_text() {
    let files = [("main.ts", "export function f() {}\n")];
    let without_text = take_only_file(lower_program(&files, lowering_options(false))).fragment;
    assert!(without_text.module.types_in_function_text.is_none());
    for (id, function) in &without_text.functions {
        assert_eq!(function.text, SourceRange::default(), "{id}");
    }

    let with_text = take_only_file(lower_program(&files, lowering_options(true))).fragment;
    let range = find_function(&with_text, "f").text;
    let types = with_text.module.types_in_function_text.unwrap();
    let source = files[0].1.as_bytes();
    let mut text = vec![0; types.kept_len(source.len())];
    types.remove_from(source, &mut text);
    let text = &text[range.start as usize..range.end as usize];
    assert_eq!(text, b"function f() {}");
}

#[test]
fn deep_code_is_not_reported() {
    let lowered = lower_file("main.js", &nested_function("probe", 1000));
    assert!(nesting_reports(&lowered).is_empty());
    find_function(&lowered.fragment, "probe");
}

#[test]
fn lowering_twice_gives_equal_fragments() {
    let first = lower_file("main.ts", VARIED_PROGRAM).fragment;
    let second = lower_file("main.ts", VARIED_PROGRAM).fragment;
    assert_eq!(function_keys(&first), function_keys(&second));
    assert_eq!(layout_keys(&first), layout_keys(&second));
    assert_eq!(variable_keys(&first), variable_keys(&second));
    assert_eq!(first.functions, second.functions);
    assert_eq!(first.layouts, second.layouts);
    assert_eq!(first.variables, second.variables);
    assert_eq!(first.supertype_edges, second.supertype_edges);
    assert_eq!(first.function_type_edges, second.function_type_edges);
    assert_eq!(first.builtin_members, second.builtin_members);
    let (first, second) = (first.family_facts, second.family_facts);
    assert_eq!(
        first.layouts_with_members_without_layout,
        second.layouts_with_members_without_layout
    );
    assert_eq!(first.conversions, second.conversions);
}

#[test]
fn block_created_under_handler_names_handler() {
    let source = "export function probe(g: any, h: any, k: any, m: any) {
  try { g(); h(); } catch (e) { k(e); }
  m();
}
";
    let fragment = lower_file("main.ts", source).fragment;
    let probe = find_function(&fragment, "probe");
    let [g, h, k, m] = [0, 1, 2, 3].map(|index| parameter(probe, index));

    let protected = find_call_block(probe, &[g]);
    let handler = protected
        .handler()
        .expect("a block of the try statement has a handler");
    let second = find_call_block(probe, &[h]).handler();
    assert_eq!(second.map(|it| it.block), Some(handler.block));
    let handler = find_block(probe, handler.block);
    assert_eq!(handler.role, BlockRole::CatchHandler);
    let caught = handler
        .values()
        .next()
        .expect("the handler block takes the thrown value");
    assert_eq!(caught.opcode, Opcode::CatchValue);

    assert!(find_call_block(probe, &[k, caught.id]).handler().is_none());
    assert!(find_call_block(probe, &[m]).handler().is_none());
}

#[test]
fn store_mode_is_strictness_of_innermost_scope() {
    let source = "module.exports = function probe(o) {
  o.outside = 1;
  class C { [(o.inside = 2)]() {} }
  return C;
};
";
    let fragment = lower_file("main.cjs", source).fragment;
    let probe = find_function(&fragment, "probe");
    assert_eq!(
        find_store_mode(&fragment, probe, "outside"),
        ECMAMode::Sloppy
    );
    assert_eq!(
        find_store_mode(&fragment, probe, "inside"),
        ECMAMode::Strict
    );
}

fn refers_to_string(fragment: &Fragment, function: &Function, text: &str) -> bool {
    let mut strings = Vec::new();
    function.body.for_each_reference(&mut |reference| {
        if let Reference::String(string) = reference {
            strings.push(string);
        }
    });
    let mut strings = strings.into_iter();
    strings.any(|string| holds_text(fragment, Some(string), text))
}

#[test]
fn class_with_class_decorators_shows_its_written_name_where_bindings_are_shortened() {
    let source = "declare function keep(...values: unknown[]): void;
function on(target: Function, context: ClassDecoratorContext): void {}
@on class Declared { constructor() {} }
@on class Implicit {}
const Stored = @on class {};
let Assigned; Assigned = @on class {};
const [Defaulted = @on class {}] = [];
const Asserted = (@on class {}) as Function;
const Plain = class {};
class Undecorated {}
function make() { const Returned = @on class {}; return Returned; }
keep(Declared, Implicit, Stored, Assigned, Defaulted, Asserted, Plain, Undecorated, make);
";
    let options = LoweringOptions {
        minifies_identifiers: true,
        ..lowering_options(false)
    };
    let fragment = take_only_file(lower_program(&[("main.ts", source)], options)).fragment;
    let is_implicit_constructor = |function: FunctionId| {
        matches!(
            key_of(&fragment, function),
            FunctionKey::ImplicitConstructor(_)
        )
    };
    let functions = fragment.functions.iter();
    let implicit_constructors = functions.filter(|entry| is_implicit_constructor(entry.0));
    assert_eq!(implicit_constructors.count(), 8);
    let is_function_named = |name: &str| {
        let mut functions = fragment.functions.iter();
        functions.any(|(_, function)| has_name(&fragment, function, name))
    };
    let body = find_module_body(&fragment);
    let written = [
        "Declared",
        "Implicit",
        "Stored",
        "Assigned",
        "Defaulted",
        "Asserted",
    ];
    for name in written {
        assert!(is_function_named(name), "{name}");
        assert!(refers_to_string(&fragment, body, name), "{name}");
    }
    assert!(is_function_named("Returned"));
    let mut functions = fragment.functions.iter();
    assert!(functions.any(|(_, function)| refers_to_string(&fragment, function, "Returned")));
    for name in ["Plain", "Undecorated"] {
        assert!(!is_function_named(name), "{name}");
    }
}
