use bun_core::strings::index_of;
use bun_sema::program::FileId;

use super::SourceKind;
use crate::builtins::SourceDialect;
use crate::builtins::id::{BuiltinId, RuntimeModule};
use crate::compile::testing::{lower_program, lower_program_with_limits};
use crate::diagnostic_codes::Code;
use crate::diagnostics::Diagnostic;
use crate::ir::generated::{
    BlockRole, ECMAMode, EntryParameter, Function, FunctionFlags, FunctionRole, SourceRange,
    TerminatorKind, Variable, VariableFlags, VariableInitialization, visit_value_fields,
};
use crate::ir::{
    BlockId, BlockView, DeclaredType, EntryPosition, FieldWord, FunctionId, FunctionKey, Id,
    Mapped, Opcode, PositionFlags, Primitives, PropertyKeyId, TypeTable, ValueId, ValueView,
};
use crate::load::host_platform;
use crate::lower::{Fragment, LoweredFile, LoweringOptions};
use crate::statistics::{LimitId, LimitValues, Loss};

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

const KEYED_STATE: &str = "const kState = Symbol(\"kState\");
export function setState(holder: any, state: number): number {
  holder[kState] = state;
  return state;
}
";

fn lowering_options(embeds_function_text: bool) -> LoweringOptions {
    LoweringOptions {
        platform: host_platform(),
        embeds_function_text,
        reports_type_mismatches: false,
        removable: Default::default(),
        minifies_identifiers: false,
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

fn has_name(fragment: &Fragment, function: &Function, name: &str) -> bool {
    let text = function.name.map(|name| fragment.strings.get(name));
    text == Some(name.as_bytes())
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
    let variable = variables.find(|variable| {
        let text = variable.name.map(|name| fragment.strings.get(name));
        text == Some(name.as_bytes())
    });
    variable.expect("the fragment defines the variable")
}

fn key_of(fragment: &Fragment, function: FunctionId) -> FunctionKey {
    fragment.function_keys[function.index()]
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
        definition.opcode == Opcode::Builtin && definition.fields == [builtin.to_wire()]
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
        let text = fragment
            .property_keys
            .get(PropertyKeyId::from_word(key))
            .text?;
        let is_matching_store = fragment.strings.get(text) == property.as_bytes();
        is_matching_store
            .then(|| ECMAMode::from_wire(mode))
            .flatten()
    });
    let modes: Vec<ECMAMode> = modes.collect();
    assert_eq!(modes.len(), 1, "one store to {property}");
    modes[0]
}

fn nesting_limit() -> usize {
    LimitValues::for_host().get(LimitId::MaxNestingDepth) as usize
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

fn find_loss(lowered: &LoweredFile, limit: LimitId) -> Option<Loss> {
    let mut losses = lowered.counters.losses().iter();
    losses.find(|loss| loss.limit == limit).copied()
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
            assert!(position.site.is_some(), "{role:?}");
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
        let primitives = fragment.types.get(variable.declared.ty).primitives;
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

#[test]
fn library_module_with_type_error_has_expected_positions() {
    let source = [KEYED_STATE, "const mismatch: number = \"text\";\n"].concat();
    let fragment = lower_library_module(&source).fragment;
    let function = find_function(&fragment, "setState");
    assert_eq!(function.role, FunctionRole::Library);
    assert!(!function.flags.contains(FunctionFlags::IS_CHECKED));
    let number = Mapped::expected(TypeTable::NUMBER);
    let expected = DeclaredType::new(number, None, PositionFlags::default());
    assert_eq!(function.parameters, [DeclaredType::untyped(), expected]);
    assert_eq!(function.results, [expected]);
    assert!(find_variable(&fragment, "kState").declared.is_expected());
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
    let keys = fragment.function_keys.iter().enumerate();
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
        for &(variable, _) in &fragment.variables {
            let key = fragment.variable_keys[variable.index()];
            assert_eq!(key.home_file(), Some(*file), "{key:?}");
        }
        let mut homes = fragment.variable_keys.iter().map(|key| key.home_file());
        mentions_other_file |= homes.any(|home| home.is_some_and(|home| home != *file));
    }
    assert!(mentions_other_file);
}

#[test]
fn entry_block_ends_in_jump() {
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
        assert_eq!(first.terminator().kind, TerminatorKind::Jump, "{id}");
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
    assert!(without_text.module.function_text.is_empty());
    for (id, function) in &without_text.functions {
        assert_eq!(function.text, SourceRange::default(), "{id}");
    }

    let with_text = take_only_file(lower_program(&files, lowering_options(true))).fragment;
    let range = find_function(&with_text, "f").text;
    let text = &with_text.module.function_text[range.start as usize..range.end as usize];
    assert_eq!(text, b"function f() {}");
}

#[test]
fn nesting_limit_is_reported_once_per_function() {
    let maximum = nesting_limit();
    let lowered = lower_file("main.js", &nested_function("probe", maximum + 100));
    let reports = nesting_reports(&lowered);
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].arguments, [maximum.to_string().into_bytes()]);
    let loss = find_loss(&lowered, LimitId::MaxNestingDepth);
    let loss = loss.expect("the limit was hit");
    assert_eq!(loss.count, 1);
    assert_eq!(loss.subject, reports[0].span);
    find_function(&lowered.fragment, "probe");
}

#[test]
fn deep_code_in_two_functions_is_reported_twice() {
    let depth = nesting_limit() + 100;
    let source = [
        nested_function("first", depth),
        nested_function("second", depth),
    ]
    .concat();
    let lowered = lower_file("main.js", &source);
    assert_eq!(nesting_reports(&lowered).len(), 2);
    let loss = find_loss(&lowered, LimitId::MaxNestingDepth);
    assert_eq!(loss.map(|loss| loss.count), Some(2));
}

#[test]
fn code_below_limit_is_not_reported() {
    let lowered = lower_file("main.js", &nested_function("probe", nesting_limit() / 2));
    assert!(nesting_reports(&lowered).is_empty());
    assert_eq!(find_loss(&lowered, LimitId::MaxNestingDepth), None);
}

#[test]
fn lowered_limit_replaces_value() {
    let files = [("main.ts", "export let v: number[] = [];\n")];
    let mut lowered_limits = LimitValues::for_host();
    lowered_limits.lower(LimitId::MaxTypeNodes, 1);
    let limited = take_only_file(lower_program_with_limits(&files, lowered_limits));
    assert!(find_loss(&limited, LimitId::MaxTypeNodes).is_some());

    let unlimited = take_only_file(lower_program_with_limits(&files, LimitValues::for_host()));
    assert_eq!(find_loss(&unlimited, LimitId::MaxTypeNodes), None);
}

#[test]
fn lowering_twice_gives_equal_fragments() {
    let first = lower_file("main.ts", VARIED_PROGRAM).fragment;
    let second = lower_file("main.ts", VARIED_PROGRAM).fragment;
    assert_eq!(first.function_keys, second.function_keys);
    assert_eq!(first.layout_keys, second.layout_keys);
    assert_eq!(first.variable_keys, second.variable_keys);
    assert_eq!(first.functions, second.functions);
    assert_eq!(first.layouts, second.layouts);
    assert_eq!(first.variables, second.variables);
    assert_eq!(first.type_sites, second.type_sites);
    assert_eq!(first.expected_results, second.expected_results);
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
