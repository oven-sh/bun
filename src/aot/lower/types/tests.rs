use std::fmt::Write;
use std::rc::Rc;
use std::sync::Arc;

use bun_sema::program::FileId;
use bun_sema_driver::{check_and_lower, decide_roles};

use crate::builtins::id::BuiltinClass;
use crate::compile::testing::{default_settings, lower_program_with_limits, with_loaded_build};
use crate::ir::generated::{DataNode, Function};
use crate::ir::{DeclaredType, LayoutId, Mapped, Opcode, Primitives, TypeFlags, TypeId, TypeTable};
use crate::load::ProjectId;
use crate::lower::scope::testing::symbol_named;
use crate::lower::tables::{put_back_task_state, take_task_state};
use crate::lower::{
    CheckerTypeId, FileLowering, Fragment, LoweredFile, ModuleFragment, SharedTables, UnitTables,
};
use crate::statistics::{LimitId, LimitValues};

const EXPANDING_ALIAS: &str = "type G<T> = Map<G<T[]>, G<[T]>>;";
const LOWERED_LIMIT: Option<u64> = Some(64);

const TYPES_OF_VARIABLES: [&str; 6] = [
    "number | string",
    "Shape",
    "Shape[]",
    "Json",
    "Map<string, number[]>",
    "Map<string, G<number>>",
];

/// A lowered file and the tables that its ids index.
struct Lowered {
    fragment: Fragment,
    tables: Rc<UnitTables>,
}

#[derive(PartialEq, Eq, Debug)]
struct TypeTree {
    primitives: Primitives,
    flags: TypeFlags,
    integers: Option<(i64, i64)>,
    strings: Vec<Vec<u8>>,
    layout_count: usize,
    classes: Vec<(BuiltinClass, Vec<TypeTree>)>,
}

#[derive(PartialEq, Eq, Debug)]
struct PositionTree {
    ty: TypeTree,
    is_expected: bool,
}

/// For the types of a file's first two variables: what the task's memo held before the file mapped them, and what the file mapped them to.
struct Probe {
    prefix: &'static str,
    visit: u32,
    types: [CheckerTypeId; 2],
    known: [Option<Mapped>; 2],
    mapped: [Mapped; 2],
}

impl TypeTree {
    fn is_anything(&self) -> bool {
        self.primitives.contains(Primitives::OBSERVABLE)
            && self.flags.contains(TypeFlags::ANY_OBJECT)
    }

    fn is_map(&self) -> bool {
        matches!(self.classes[..], [(BuiltinClass::Map, _)])
    }

    // A variable that has a dead zone also holds `absent`.
    fn value_primitives(&self) -> Primitives {
        self.primitives.without(Primitives::ABSENT)
    }
}

#[track_caller]
fn contents_of(ty: &TypeTree, class: BuiltinClass) -> &[TypeTree] {
    match &ty.classes[..] {
        [(only, contents)] if *only == class => contents,
        _ => panic!("the type names one {class:?}: {ty:?}"),
    }
}

fn expand_types(tables: &UnitTables, types: &[TypeId]) -> Vec<TypeTree> {
    types.iter().map(|&ty| expand_type(tables, ty)).collect()
}

fn expand_type(tables: &UnitTables, id: TypeId) -> TypeTree {
    let ty = tables.types.get(id);
    let literals = ty.strings.iter();
    let mut strings: Vec<Vec<u8>> = literals
        .map(|&literal| tables.strings.get(literal).to_vec())
        .collect();
    strings.sort_unstable();
    let classes = ty.classes.iter();
    TypeTree {
        primitives: ty.primitives,
        flags: ty.flags,
        integers: ty.integer_range(),
        strings,
        layout_count: ty.layouts.len(),
        classes: classes
            .map(|part| (part.builtin_class, expand_types(tables, &part.contents)))
            .collect(),
    }
}

// The files of one task share their tables, and shared tables can be taken only once.
fn take_tables(lowered: Vec<(FileId, LoweredFile)>) -> Vec<Lowered> {
    let mut taken: Vec<(Arc<SharedTables>, Rc<UnitTables>)> = Vec::new();
    let files = lowered.into_iter().map(|(_, file)| {
        let shared = &file.fragment.tables;
        let known = taken.iter().find(|(other, _)| Arc::ptr_eq(other, shared));
        let tables = match known {
            Some((_, tables)) => Rc::clone(tables),
            None => {
                let tables: Rc<UnitTables> = Rc::from(shared.take());
                taken.push((Arc::clone(shared), Rc::clone(&tables)));
                tables
            }
        };
        Lowered {
            fragment: file.fragment,
            tables,
        }
    });
    files.collect()
}

#[track_caller]
fn lower_files(files: &[(&str, &str)], max_type_nodes: Option<u64>) -> Vec<Lowered> {
    let mut limits = LimitValues::for_host();
    if let Some(maximum) = max_type_nodes {
        limits.lower(LimitId::MaxTypeNodes, maximum);
    }
    take_tables(lower_program_with_limits(files, limits))
}

#[track_caller]
fn lower_file(path: &str, source: &str, max_type_nodes: Option<u64>) -> Lowered {
    let mut lowered = lower_files(&[(path, source)], max_type_nodes);
    assert_eq!(lowered.len(), 1);
    lowered.remove(0)
}

#[track_caller]
fn lower(source: &str, max_type_nodes: Option<u64>) -> Lowered {
    lower_file("main.ts", source, max_type_nodes)
}

fn expand_position(tables: &UnitTables, declared: DeclaredType) -> PositionTree {
    PositionTree {
        ty: expand_type(tables, declared.ty),
        is_expected: declared.is_expected(),
    }
}

fn find_variable(lowered: &Lowered, name: &str) -> Option<DeclaredType> {
    let variables = lowered.fragment.variables.iter();
    let mut variables = variables.map(|(_, variable)| variable);
    let variable = variables.find(|variable| {
        let text = variable.name.map(|name| lowered.tables.strings.get(name));
        text == Some(name.as_bytes())
    });
    variable.map(|variable| variable.declared)
}

#[track_caller]
fn expand_variable(lowered: &Lowered, name: &str) -> PositionTree {
    let declared = find_variable(lowered, name).expect("the fragment defines the variable");
    expand_position(&lowered.tables, declared)
}

#[track_caller]
fn find_file<'l>(lowered: &'l [Lowered], variable: &str) -> &'l Lowered {
    let mut files = lowered.iter();
    let file = files.find(|file| find_variable(file, variable).is_some());
    file.expect("a file defines the variable")
}

/// The fields called `name`, in every definition of a layout of the file: the layout and the declared type of each.
fn fields_named(lowered: &Lowered, name: &str) -> Vec<(LayoutId, DeclaredType)> {
    let tables = &lowered.tables;
    let layouts = lowered.fragment.layouts.iter();
    let fields =
        layouts.flat_map(|(id, layout)| layout.fields.iter().map(move |field| (*id, field)));
    let named = fields.filter(|(_, field)| {
        let text = field.key.and_then(|key| tables.property_keys.get(key).text);
        text.map(|text| tables.strings.get(text)) == Some(name.as_bytes())
    });
    named.map(|(id, field)| (id, field.declared)).collect()
}

fn declared_types_of_fields(lowered: &Lowered, name: &str) -> Vec<DeclaredType> {
    let fields = fields_named(lowered, name).into_iter();
    fields.map(|(_, declared)| declared).collect()
}

#[track_caller]
fn find_function<'f>(lowered: &'f Lowered, name: &str) -> &'f Function {
    let functions = lowered.fragment.functions.iter();
    let mut functions = functions.map(|(_, function)| function);
    let function = functions.find(|function| {
        let text = function.name.map(|name| lowered.tables.strings.get(name));
        text == Some(name.as_bytes())
    });
    function.expect("the fragment defines the function")
}

fn collect_array_literal_contents(source: &str) -> Vec<TypeId> {
    let fragment = lower(source, None).fragment;
    let functions = fragment.functions.iter().map(|(_, function)| function);
    let values = functions.flat_map(|function| function.body.blocks());
    let values = values.flat_map(|block| block.values());
    let created = values
        .filter(|value| value.opcode == Opcode::NewArray)
        .map(|value| TypeId::from_word(value.fields[0]));
    // A literal of constants alone is data.
    let constant = fragment.data.iter().filter_map(|(_, data)| match &data.root {
        DataNode::Array { contents, .. } => Some(*contents),
        _ => None,
    });
    created.chain(constant).collect()
}

#[track_caller]
fn assert_order_independent(aliases: &str, types: [&str; 2], max_type_nodes: Option<u64>) {
    let declare = |first: &str, second: &str| {
        let source = format!("{aliases}\nexport let a: {first};\nexport let b: {second};\n");
        lower(&source, max_type_nodes)
    };
    let forward = declare(types[0], types[1]);
    let backward = declare(types[1], types[0]);
    assert_eq!(
        expand_variable(&forward, "a"),
        expand_variable(&backward, "b"),
        "{}",
        types[0]
    );
    assert_eq!(
        expand_variable(&forward, "b"),
        expand_variable(&backward, "a"),
        "{}",
        types[1]
    );
}

fn mutually_recursive_tuple_aliases(count: usize) -> String {
    let mut source = String::new();
    for alias in 0..count {
        let others = (0..count).filter(|&other| other != alias);
        let elements: Vec<String> = others.map(|other| format!("F{other}")).collect();
        let _ = writeln!(source, "type F{alias} = [{}];", elements.join(", "));
    }
    source
}

fn map_aliases_sharing_union(literal_count: usize, alias_count: usize) -> String {
    let literals: Vec<String> = (0..literal_count)
        .map(|index| format!("\"i{index}\""))
        .collect();
    let mut source = format!("type Icon = {};\n", literals.join(" | "));
    for alias in 0..alias_count {
        let _ = writeln!(source, "type F{alias} = Map<Icon, {alias}>;");
    }
    let elements: Vec<String> = (0..alias_count).map(|alias| format!("F{alias}")).collect();
    let _ = writeln!(source, "type H = [{}];", elements.join(", "));
    source
}

fn names_of_variables(prefix: &str) -> Vec<String> {
    let indexes = 0..TYPES_OF_VARIABLES.len();
    indexes.map(|index| format!("{prefix}{index}")).collect()
}

fn declare_variables(prefix: &str) -> String {
    let mut source = String::new();
    for (name, ty) in names_of_variables(prefix).iter().zip(TYPES_OF_VARIABLES) {
        let _ = writeln!(source, "export let {name}: {ty} = JSON.parse(\"null\");");
    }
    source
}

/// `first.ts` declares types and variables that have them, `second.ts` variables of the same types, and the entry point reads them all.
// A checker task ends once it has covered 1/128 of the program's identifiers and type nodes, so the two files share a task only when the entry point is long.
fn files_that_share_types(has_long_entry_point: bool) -> [(&'static str, String); 3] {
    let mut main = String::new();
    for prefix in ["first", "second"] {
        let names = names_of_variables(prefix);
        let _ = writeln!(main, "import {{ {} }} from \"./{prefix}\";", names.join(", "));
        for name in names {
            let _ = writeln!(main, "export const kept_{name} = {name};");
        }
    }
    if has_long_entry_point {
        let statements = "x;\n".repeat(1 << 15);
        let _ = writeln!(main, "export function filler(x: number) {{\n{statements}}}");
    }
    let types = format!(
        "export interface Shape {{ side: number }}\n\
         export type Json = string | Json[];\n\
         export {EXPANDING_ALIAS}\n"
    );
    let imports = "import type { G, Json, Shape } from \"./first\";\n";
    [
        ("main.ts", main),
        ("first.ts", types + &declare_variables("first")),
        ("second.ts", imports.to_owned() + &declare_variables("second")),
    ]
}

fn as_texts<'f>(files: &'f [(&'static str, String); 3]) -> [(&'f str, &'f str); 3] {
    files.each_ref().map(|(name, text)| (*name, &text[..]))
}

/// Runs `look` on each file of the application instead of lowering it, in the same checker tasks as a build.
fn look_at_files<R: Send>(
    files: &[(&str, &str)],
    look: &(dyn Fn(&mut FileLowering<'_, '_, '_, '_>) -> R + Sync),
) -> Vec<R> {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let bound = build.bind_modules(loaded).expect("the modules are bound");
        let project = loaded.project(ProjectId::Application);
        let compiled_files = project.loaded.files().compiled_files();
        let roles = decide_roles(project.loaded, project.host, project.request, compiled_files);
        build.with_lowering_inputs(loaded, &bound, ProjectId::Application, &roles, |inputs| {
            let checked = check_and_lower(
                project.loaded,
                project.host,
                project.request,
                &roles,
                compiled_files,
                &|checker, file| {
                    let mut task = take_task_state(checker);
                    let seen = checker.with_queries(file, &inputs.query_inputs(), |queries| {
                        let mut lowering = FileLowering::new(inputs, queries, file, &mut task);
                        let seen = look(&mut lowering);
                        drop(lowering.finish(ModuleFragment::default()));
                        seen
                    });
                    put_back_task_state(checker, task);
                    Some(seen)
                },
            );
            let seen = checked.lowered.into_iter();
            seen.map(|(_, seen)| seen).collect()
        })
    })
}

fn written_type_of(file: &mut FileLowering<'_, '_, '_, '_>, name: &str) -> CheckerTypeId {
    let symbol = symbol_named(file.hir, file.bound, name);
    let symbol = file.queries.canonical_symbol(file.file, symbol);
    let written = file.queries.written_variable_type(symbol).written();
    written.expect("the variable has an annotation")
}

// None for the entry point.
fn probe_memo(file: &mut FileLowering<'_, '_, '_, '_>) -> Option<Probe> {
    let path = file.queries.files().module(file.file).file_name();
    let mut prefixes = ["first", "second"].into_iter();
    let prefix = prefixes.find(|prefix| path.ends_with(format!("{prefix}.ts").as_bytes()))?;
    let types = [0, 1].map(|index| written_type_of(file, &format!("{prefix}{index}")));
    let known = types.map(|ty| file.find_mapped(ty).map(|entry| entry.mapped));
    let mapped = types.map(|ty| file.map_type_at(ty));
    Some(Probe {
        prefix,
        visit: file.task.visit,
        types,
        known,
        mapped,
    })
}

#[test]
fn recursive_and_oversized_types_are_order_independent() {
    assert_order_independent("type Json = string | Json[];", ["Json", "Json[]"], None);
    let aliases = "type A = string | [B];\ntype B = number | [A];";
    assert_order_independent(aliases, ["A", "B"], None);
    assert_order_independent(EXPANDING_ALIAS, ["G<number>", "G<number[]>"], LOWERED_LIMIT);
}

#[test]
fn recursive_alias_is_cut_to_shallow_form() {
    let lowered = lower("type Json = string | Json[];\nexport let v: Json;\n", None);
    let ty = expand_variable(&lowered, "v").ty;
    assert_eq!(
        ty.value_primitives(),
        Primitives::STRING | Primitives::NULLISH
    );
    let contents = contents_of(&ty, BuiltinClass::Array);
    assert_eq!(
        contents[0].primitives,
        Primitives::STRING | Primitives::NULLISH
    );
    let cut_contents = contents_of(&contents[0], BuiltinClass::Array);
    assert!(cut_contents[0].is_anything(), "{ty:?}");
}

#[test]
fn dense_cycle_is_one_component_and_below_limit() {
    // Whether a type is over the limit shows only where another type holds it.
    let source = format!(
        "{}export let v: F0[];\n",
        mutually_recursive_tuple_aliases(12)
    );
    let lowered = lower(&source, None);
    let ty = expand_variable(&lowered, "v").ty;
    let tuples = contents_of(&ty, BuiltinClass::Array);
    let elements = contents_of(&tuples[0], BuiltinClass::Array);
    assert_eq!(elements[0].primitives, Primitives::NULLISH);
    let cut_elements = contents_of(&elements[0], BuiltinClass::Array);
    assert!(cut_elements[0].is_anything(), "{ty:?}");
}

#[test]
fn expanding_alias_is_exhausted() {
    let source = format!("{EXPANDING_ALIAS}\nexport let v: G<number>;\n");
    let lowered = lower(&source, LOWERED_LIMIT);
    let ty = expand_variable(&lowered, "v").ty;
    assert!(!ty.is_anything(), "{ty:?}");
    let contents = contents_of(&ty, BuiltinClass::Map);
    assert_eq!(contents.len(), 2);
    for part in contents {
        assert!(
            part.primitives == Primitives::NULLISH && part.is_map(),
            "{part:?}"
        );
    }
}

#[test]
fn member_whose_type_has_no_end_is_lowered() {
    let source = "type Endless<T> = T extends unknown ? [Endless<[T]>] : never;
interface Holder { member: Endless<1>; other: Endless<2>[] }
export let v: Holder = JSON.parse(\"{}\");
";
    let lowered = lower(source, LOWERED_LIMIT);
    assert!(!expand_variable(&lowered, "v").ty.is_anything());
}

#[test]
fn type_that_grows_several_ways_has_untyped_fields() {
    let source = "interface Tree<T> { leaf: T; left?: Tree<[T]>; right?: Tree<{ of: T }>; up?: Tree<T[]>; down?: Tree<() => T> }
export let v: Tree<string> = { leaf: \"a\", left: { leaf: [\"b\"] } };
";
    let lowered = lower(source, None);
    let ty = expand_variable(&lowered, "v").ty;
    assert!(!ty.is_anything(), "{ty:?}");
    let leaves = declared_types_of_fields(&lowered, "leaf");
    assert!(!leaves.is_empty());
    assert!(
        leaves.iter().all(|&leaf| leaf == DeclaredType::untyped()),
        "{leaves:?}"
    );
}

#[test]
fn nested_types_within_the_limit_keep_their_typed_fields() {
    let written_out = "interface Box<T> { value: T }
export let v: Box<Box<Box<Box<number>>>> = { value: { value: { value: { value: 1 } } } };
";
    let of_one_height = "interface List<T> { first: T; count: number }
interface Holder<T> { list: List<T> }
interface A { next: Holder<B> }
interface B { next: Holder<C> }
interface C { next: Holder<D> }
interface D { last: number }
export let v: Holder<A> | undefined;
export let w: List<D> | undefined;
export function read(): number | undefined { return v?.list.first.next.list.first.next.list.first.next.list.count; }
";
    for (source, name) in [(written_out, "value"), (of_one_height, "count")] {
        let fields = declared_types_of_fields(&lower(source, None), name);
        assert!(!fields.is_empty(), "{name}");
        assert!(
            fields.iter().all(|&field| field != DeclaredType::untyped()),
            "{fields:?}"
        );
    }
}

#[test]
fn part_beside_oversized_part_stays() {
    let source = format!("{EXPANDING_ALIAS}\nexport let v: Map<string, G<number>>;\n");
    let lowered = lower(&source, LOWERED_LIMIT);
    let ty = expand_variable(&lowered, "v").ty;
    let contents = contents_of(&ty, BuiltinClass::Map);
    assert_eq!(contents.len(), 2);
    assert_eq!(
        contents[0].primitives,
        Primitives::STRING | Primitives::NULLISH
    );
    assert!(contents[0].classes.is_empty(), "{ty:?}");
    assert!(contents[1].is_map(), "{ty:?}");
}

#[test]
fn shared_union_is_counted_once() {
    // `H[]` reaches 59 types. With the union counted once for each alias, `H` would weigh 345.
    let source = format!("{}export let v: H[];\n", map_aliases_sharing_union(40, 8));
    let lowered = lower(&source, LOWERED_LIMIT);
    let ty = expand_variable(&lowered, "v").ty;
    let tuples = contents_of(&ty, BuiltinClass::Array);
    let elements = contents_of(&tuples[0], BuiltinClass::Array);
    let contents = contents_of(&elements[0], BuiltinClass::Map);
    assert_eq!(contents[0].strings.len(), 40);
}

#[test]
fn limit_counts_distinct_types() {
    // The tuple and its four elements are five types.
    for (max_type_nodes, integers) in [(4, None), (5, Some((1, 4)))] {
        let lowered = lower("export let v: [1, 2, 3, 4][];\n", Some(max_type_nodes));
        let ty = expand_variable(&lowered, "v").ty;
        let tuples = contents_of(&ty, BuiltinClass::Array);
        let elements = contents_of(&tuples[0], BuiltinClass::Array);
        assert_eq!(elements[0].integers, integers, "{max_type_nodes}: {ty:?}");
        assert_eq!(elements[0].is_anything(), integers.is_none(), "{ty:?}");
    }
}

#[test]
fn references_take_nullish_and_numbers_do_not() {
    let position = expand_variable(&lower("export let v: number[] = [];\n", None), "v");
    assert!(!position.is_expected, "{position:?}");
    assert_eq!(position.ty.value_primitives(), Primitives::NULLISH);
    let contents = contents_of(&position.ty, BuiltinClass::Array);
    assert_eq!(contents[0].primitives, Primitives::NUMBER);
}

#[test]
fn number_takes_the_nullish_that_its_type_lists() {
    let source = "export let a: number = 1;\nexport let b: number | undefined = 1;\n";
    let lowered = lower(source, None);
    assert_eq!(
        expand_variable(&lowered, "a").ty.value_primitives(),
        Primitives::NUMBER
    );
    let optional = Primitives::NUMBER | Primitives::UNDEFINED;
    assert_eq!(
        expand_variable(&lowered, "b").ty.value_primitives(),
        optional
    );
}

#[test]
fn variable_without_initializer_holds_undefined() {
    let source = "export let a: number;\nexport var b: boolean = true;\n";
    let lowered = lower(source, None);
    let number = Primitives::NUMBER | Primitives::UNDEFINED;
    assert_eq!(expand_variable(&lowered, "a").ty.value_primitives(), number);
    let boolean = Primitives::BOOLEAN | Primitives::UNDEFINED;
    assert_eq!(
        expand_variable(&lowered, "b").ty.value_primitives(),
        boolean
    );
}

#[test]
fn class_type_is_its_layout() {
    let position = expand_variable(&lower("class C { x = 1 }\nexport let v: C;\n", None), "v");
    assert!(!position.is_expected, "{position:?}");
    assert_eq!(position.ty.layout_count, 1);
    assert_eq!(position.ty.value_primitives(), Primitives::NULLISH);
    assert!(
        !position.ty.flags.contains(TypeFlags::ANY_OBJECT),
        "{position:?}"
    );
}

#[test]
fn literal_type_is_the_type() {
    let source = "export let s: \"a\" | \"b\" = \"a\";\nexport let n: 1 | 2 = 1;\n";
    let lowered = lower(source, None);
    let strings = expand_variable(&lowered, "s");
    assert!(!strings.is_expected, "{strings:?}");
    assert_eq!(strings.ty.strings, [b"a".to_vec(), b"b".to_vec()]);
    assert_eq!(strings.ty.value_primitives(), Primitives::NULLISH);
    let numbers = expand_variable(&lowered, "n");
    assert!(!numbers.is_expected, "{numbers:?}");
    assert_eq!(numbers.ty.integers, Some((1, 2)));
    assert!(numbers.ty.value_primitives().is_empty(), "{numbers:?}");
}

#[test]
fn one_enum_member_is_a_tag_and_several_take_every_int32() {
    let source = "enum Flags { A = 1, B = 2, C = 4 }\n\
                  export let all: Flags = Flags.A;\nexport let one: Flags.B = Flags.B;\n";
    let lowered = lower(source, None);
    let int32 = (i64::from(i32::MIN), i64::from(i32::MAX));
    assert_eq!(expand_variable(&lowered, "all").ty.integers, Some(int32));
    assert_eq!(expand_variable(&lowered, "one").ty.integers, Some((2, 2)));
}

#[test]
fn variable_without_an_annotation_is_untyped() {
    let source = "function g() { return 1; }\nexport let v = g();\n";
    for path in ["main.ts", "main.js"] {
        let position = expand_variable(&lower_file(path, source, None), "v");
        assert!(position.ty.is_anything(), "{path}: {position:?}");
        assert!(!position.is_expected, "{path}: {position:?}");
    }
}

#[test]
fn variable_that_is_stored_to_again_has_the_type_of_the_checker() {
    let source = "function g() { return 1; }\nexport let v = g();\nexport function next() { v = g(); }\n";
    let position = expand_variable(&lower_file("main.ts", source, None), "v");
    assert!(!position.ty.is_anything(), "{position:?}");
    let primitives = position.ty.primitives;
    assert!(primitives.contains(Primitives::NUMBER), "{position:?}");
    assert!(!primitives.contains(Primitives::STRING), "{position:?}");
}

#[test]
fn result_without_an_annotation_is_untyped() {
    let source = "export function make(first: boolean) { return first ? { a: 1 } : { b: \"x\" }; }
export async function wait() { return 1; }
export function* count() { yield 1; }
export function written(): number { return 1; }
";
    let lowered = lower(source, None);
    for name in ["make", "wait", "count"] {
        let results = &find_function(&lowered, name).results;
        assert_eq!(results[..], [DeclaredType::untyped()], "{name}");
    }
    assert_eq!(find_function(&lowered, "written").results[0].ty, TypeTable::NUMBER);
}

#[test]
fn receiver_that_nobody_wrote_is_untyped() {
    let source = "export function probe() { return this.size; }\n";
    let lowered = lower_file("main.js", source, None);
    assert_eq!(find_function(&lowered, "probe").this_type, DeclaredType::untyped());
}

#[test]
fn field_without_an_annotation_is_untyped() {
    let source = "export class C { box = { a: 1 }; count: number = 1; }\n";
    let lowered = lower(source, None);
    let untyped = DeclaredType::untyped();
    assert_eq!(declared_types_of_fields(&lowered, "box"), [untyped]);
    let counts = declared_types_of_fields(&lowered, "count");
    let counts: Vec<TypeId> = counts.iter().map(|count| count.ty).collect();
    assert_eq!(counts, [TypeTable::NUMBER]);
}

#[test]
fn empty_array_has_the_result_that_its_constructor_declares() {
    let source = "export function probe() { const v = new Array<number>(); return v; }\n";
    let lowered = lower(source, None);
    let blocks = find_function(&lowered, "probe").body.blocks();
    let claimed: Vec<DeclaredType> = blocks
        .flat_map(|block| block.values())
        .filter(|value| value.opcode == Opcode::Convert)
        .filter_map(|value| DeclaredType::from_words(&value.fields[1..]))
        .collect();
    let [claimed] = claimed[..] else {
        panic!("one conversion: {claimed:?}");
    };
    let ty = expand_type(&lowered.tables, claimed.ty);
    let contents = contents_of(&ty, BuiltinClass::Array);
    assert_eq!(contents[0].primitives, Primitives::NUMBER);
}

#[test]
fn inferred_type_of_a_parameter_is_checked_in_a_checked_file_and_expected_in_any_other() {
    let source = "export function probe(a = 1) { return a; }\n";
    for (path, is_expected) in [("main.ts", false), ("main.js", true)] {
        let lowered = lower_file(path, source, None);
        let parameter = find_function(&lowered, "probe").parameters[0];
        let position = expand_position(&lowered.tables, parameter);
        assert_eq!(position.is_expected, is_expected, "{path}: {position:?}");
        let primitives = position.ty.primitives;
        assert!(primitives.contains(Primitives::NUMBER), "{path}: {position:?}");
    }
}

#[test]
fn argument_that_may_be_left_out_arrives_as_undefined() {
    let source = "export function probe(a: number, b?: number, c: number = 1) { return a; }\n";
    let lowered = lower(source, None);
    let parameters = &find_function(&lowered, "probe").parameters;
    let primitives: Vec<Primitives> = parameters
        .iter()
        .map(|&parameter| expand_position(&lowered.tables, parameter).ty.primitives)
        .collect();
    let optional = Primitives::NUMBER | Primitives::UNDEFINED;
    assert_eq!(primitives, [Primitives::NUMBER, optional, optional]);
}

#[test]
fn receiver_of_method_is_tested_at_entry() {
    let lowered = lower("export class C { x = 1; m() { return this.x; } }\n", None);
    let this_type = find_function(&lowered, "m").this_type;
    let position = expand_position(&lowered.tables, this_type);
    assert!(!position.is_expected, "{position:?}");
    assert_eq!(position.ty.layout_count, 1);
    assert!(position.ty.primitives.is_empty(), "{position:?}");
}

#[test]
fn array_literal_holds_the_declared_elements_or_else_anything() {
    let numbers = [
        "(a: number) { const v: number[] = [a]; return v; }",
        "() { const v: number[] = []; return v; }",
        "(a: number) { const v: [number, number] = [a, a]; return v; }",
    ];
    let anything = [
        "(a: number) { const v = [a]; return v; }",
        "() { const v = []; v.push(1); return v; }",
        "<T extends unknown[]>(a: number, rest: T) { const v: [number, ...T] = [a, ...rest]; return v; }",
    ];
    let numbers = numbers.map(|function| (function, TypeTable::NUMBER));
    let anything = anything.map(|function| (function, TypeTable::ANYTHING));
    for (function, contents) in numbers.into_iter().chain(anything) {
        let source = format!("export function probe{function}\n");
        let found = collect_array_literal_contents(&source);
        assert_eq!(found, [contents], "{function}");
    }
}

#[test]
fn next_file_of_a_task_knows_a_plain_type_and_has_to_meet_an_interface() {
    let files = files_that_share_types(true);
    let probes = look_at_files(&as_texts(&files), &probe_memo);
    let mut probes: Vec<Probe> = probes.into_iter().flatten().collect();
    probes.sort_by_key(|probe| probe.visit);
    let [first, second] = &probes[..] else {
        panic!("two files declare the variables");
    };
    assert_eq!(second.visit, first.visit + 1, "one task visits both files");
    assert_eq!([first.prefix, second.prefix], ["first", "second"]);
    assert_eq!(first.types, second.types);
    assert_eq!(first.known, [None, None]);
    assert_eq!(second.known, [Some(first.mapped[0]), None]);
    assert_eq!(first.mapped, second.mapped);
}

#[test]
fn of_the_files_of_a_task_the_first_says_what_the_fields_of_an_interface_hold() {
    let files = files_that_share_types(true);
    let lowered = lower_files(&as_texts(&files), LOWERED_LIMIT);
    let [first, second] = ["first1", "second1"].map(|name| find_file(&lowered, name));
    assert!(Rc::ptr_eq(&first.tables, &second.tables), "one task lowers both files");
    assert_eq!(find_variable(first, "first1"), find_variable(second, "second1"));
    // The link takes what the file with the least number says of a type. The second imports the first, so it is lowered behind it.
    assert!(first.fragment.file < second.fragment.file);
    let [of_first, of_second] = [first, second].map(|file| fields_named(file, "side"));
    assert!(!of_first.is_empty() && of_second.is_empty());
}

#[test]
fn file_is_mapped_in_a_shared_task_as_in_a_task_of_its_own() {
    let [shared, own] = [true, false].map(|has_long_entry_point| {
        let files = files_that_share_types(has_long_entry_point);
        lower_files(&as_texts(&files), LOWERED_LIMIT)
    });
    let is_one_task = |lowered: &[Lowered]| {
        let [first, second] = ["first0", "second0"].map(|name| find_file(lowered, name));
        Rc::ptr_eq(&first.tables, &second.tables)
    };
    assert!(is_one_task(&shared), "one task lowers both files");
    assert!(!is_one_task(&own), "each file has a task of its own");
    for prefix in ["first", "second"] {
        for (name, ty) in names_of_variables(prefix).iter().zip(TYPES_OF_VARIABLES) {
            assert_eq!(
                expand_variable(find_file(&shared, name), name),
                expand_variable(find_file(&own, name), name),
                "{name}: {ty}"
            );
        }
    }
}
