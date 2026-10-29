use std::fmt::Write;

use bun_core::strings::index_of;

use crate::builtins::id::BuiltinClass;
use crate::compile::testing::lower_program_with_limits;
use crate::ir::generated::{DataNode, Function};
use crate::ir::{DeclaredType, Opcode, Primitives, TypeFlags, TypeId, TypeTable};
use crate::lower::{Fragment, LoweredFile};
use crate::statistics::{LimitId, LimitValues, Loss};

const EXPANDING_ALIAS: &str = "type G<T> = Map<G<T[]>, G<[T]>>;";
const LOWERED_LIMIT: Option<u64> = Some(64);

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

fn expand_types(fragment: &Fragment, types: &[TypeId]) -> Vec<TypeTree> {
    types.iter().map(|&ty| expand_type(fragment, ty)).collect()
}

fn expand_type(fragment: &Fragment, id: TypeId) -> TypeTree {
    let ty = fragment.types.get(id);
    let literals = ty.strings.iter();
    let mut strings: Vec<Vec<u8>> = literals
        .map(|&literal| fragment.strings.get(literal).to_vec())
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
            .map(|part| (part.builtin_class, expand_types(fragment, &part.contents)))
            .collect(),
    }
}

#[track_caller]
fn lower_file(path: &str, source: &str, max_type_nodes: Option<u64>) -> LoweredFile {
    let mut limits = LimitValues::for_host();
    if let Some(maximum) = max_type_nodes {
        limits.lower(LimitId::MaxTypeNodes, maximum);
    }
    let mut lowered = lower_program_with_limits(&[(path, source)], limits);
    assert_eq!(lowered.len(), 1);
    lowered.remove(0).1
}

#[track_caller]
fn lower(source: &str, max_type_nodes: Option<u64>) -> LoweredFile {
    lower_file("main.ts", source, max_type_nodes)
}

fn expand_position(fragment: &Fragment, declared: DeclaredType) -> PositionTree {
    PositionTree {
        ty: expand_type(fragment, declared.ty),
        is_expected: declared.is_expected(),
    }
}

#[track_caller]
fn expand_variable(lowered: &LoweredFile, name: &str) -> PositionTree {
    let fragment = &lowered.fragment;
    let mut variables = fragment.variables.iter().map(|(_, variable)| variable);
    let variable = variables.find(|variable| {
        let text = variable.name.map(|name| fragment.strings.get(name));
        text == Some(name.as_bytes())
    });
    let declared = variable
        .expect("the fragment defines the variable")
        .declared;
    expand_position(fragment, declared)
}

/// The declared types of the fields called `name`, in every definition of a layout of the file.
fn declared_types_of_fields(lowered: &LoweredFile, name: &str) -> Vec<DeclaredType> {
    let fragment = &lowered.fragment;
    let fields = fragment
        .layouts
        .iter()
        .flat_map(|(_, layout)| layout.fields.iter());
    let named = fields.filter(|field| {
        let text = field
            .key
            .and_then(|key| fragment.property_keys.get(key).text);
        text.map(|text| fragment.strings.get(text)) == Some(name.as_bytes())
    });
    named.map(|field| field.declared).collect()
}

#[track_caller]
fn find_function<'f>(lowered: &'f LoweredFile, name: &str) -> &'f Function {
    let fragment = &lowered.fragment;
    let mut functions = fragment.functions.iter().map(|(_, function)| function);
    let function = functions.find(|function| {
        let text = function.name.map(|name| fragment.strings.get(name));
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
    let constant = fragment.data.iter().filter_map(|data| match &data.root {
        DataNode::Array { contents, .. } => Some(*contents),
        _ => None,
    });
    created.chain(constant).collect()
}

fn find_type_node_loss(lowered: &LoweredFile) -> Option<Loss> {
    let mut losses = lowered.counters.losses().iter();
    let loss = losses.find(|loss| loss.limit == LimitId::MaxTypeNodes);
    loss.copied()
}

fn count_type_node_losses(lowered: &LoweredFile) -> u32 {
    find_type_node_loss(lowered).map_or(0, |loss| loss.count)
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
    assert_eq!(count_type_node_losses(&lowered), 0);
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
    let source = format!(
        "{}export let v: F0;\n",
        mutually_recursive_tuple_aliases(12)
    );
    let lowered = lower(&source, None);
    assert_eq!(count_type_node_losses(&lowered), 0);
    let ty = expand_variable(&lowered, "v").ty;
    let elements = contents_of(&ty, BuiltinClass::Array);
    assert_eq!(elements[0].primitives, Primitives::NULLISH);
    let cut_elements = contents_of(&elements[0], BuiltinClass::Array);
    assert!(cut_elements[0].is_anything(), "{ty:?}");
}

#[test]
fn expanding_alias_is_exhausted() {
    let source = format!("{EXPANDING_ALIAS}\nexport let v: G<number>;\n");
    let lowered = lower(&source, LOWERED_LIMIT);
    assert!(count_type_node_losses(&lowered) > 0);
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
    assert!(count_type_node_losses(&lowered) > 0);
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
    let source = format!("{}export let v: H;\n", map_aliases_sharing_union(40, 8));
    let lowered = lower(&source, LOWERED_LIMIT);
    assert_eq!(count_type_node_losses(&lowered), 0);
    let ty = expand_variable(&lowered, "v").ty;
    let elements = contents_of(&ty, BuiltinClass::Array);
    let contents = contents_of(&elements[0], BuiltinClass::Map);
    assert_eq!(contents[0].strings.len(), 40);
}

#[test]
fn limit_counts_distinct_types() {
    let source = "export let v: [1, 2, 3, 4];\n";
    assert!(count_type_node_losses(&lower(source, Some(4))) > 0);
    assert_eq!(count_type_node_losses(&lower(source, Some(5))), 0);
}

#[test]
fn hit_is_charged_to_annotation() {
    let source = format!("{EXPANDING_ALIAS}\nexport let v: G<number>;\n");
    let loss = find_type_node_loss(&lower(&source, LOWERED_LIMIT));
    let subject = loss.and_then(|loss| loss.subject);
    let variable = index_of(source.as_bytes(), b"v: G<number>");
    assert!(variable.is_some());
    assert_eq!(subject.map(|subject| subject.start as usize), variable);
}

#[test]
fn type_mapped_twice_is_charged_once() {
    let once = format!("{EXPANDING_ALIAS}\nexport let v: G<number>;\n");
    let twice = format!("{once}export let w: G<number>;\n");
    let expected = count_type_node_losses(&lower(&once, LOWERED_LIMIT));
    assert!(expected > 0);
    assert_eq!(
        count_type_node_losses(&lower(&twice, LOWERED_LIMIT)),
        expected
    );
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
fn inferred_type_is_checked_in_checked_file() {
    let source = "function g() { return 1; }\nexport let v = g();\n";
    let position = expand_variable(&lower(source, None), "v");
    assert!(!position.is_expected, "{position:?}");
    assert_eq!(position.ty.value_primitives(), Primitives::NUMBER);
    assert!(
        !position.ty.flags.contains(TypeFlags::ANY_OBJECT),
        "{position:?}"
    );
}

#[test]
fn unchecked_file_sends_expected_positions() {
    let source = "function g() { return 1; }\nexport let v = g();\n";
    let position = expand_variable(&lower_file("main.js", source, None), "v");
    assert!(position.is_expected, "{position:?}");
    assert_eq!(position.ty.value_primitives(), Primitives::NUMBER);
}

#[test]
fn argument_that_may_be_left_out_arrives_as_undefined() {
    let source = "export function probe(a: number, b?: number, c: number = 1) { return a; }\n";
    let lowered = lower(source, None);
    let parameters = &find_function(&lowered, "probe").parameters;
    let primitives: Vec<Primitives> = parameters
        .iter()
        .map(|&parameter| expand_position(&lowered.fragment, parameter).ty.primitives)
        .collect();
    let optional = Primitives::NUMBER | Primitives::UNDEFINED;
    assert_eq!(primitives, [Primitives::NUMBER, optional, optional]);
}

#[test]
fn receiver_of_method_is_tested_at_entry() {
    let lowered = lower("export class C { x = 1; m() { return this.x; } }\n", None);
    let this_type = find_function(&lowered, "m").this_type;
    assert!(this_type.site.is_some());
    let position = expand_position(&lowered.fragment, this_type);
    assert!(!position.is_expected, "{position:?}");
    assert_eq!(position.ty.layout_count, 1);
    assert!(position.ty.primitives.is_empty(), "{position:?}");
}

#[test]
fn array_literal_holds_the_declared_elements_or_else_the_checked_ones() {
    let numbers = [
        "(a: number) { const v: number[] = [a]; return v; }",
        "(a: number) { const v = [a]; return v; }",
        "() { const v: number[] = []; return v; }",
        "(a: number) { const v: [number, number] = [a, a]; return v; }",
    ];
    let anything = [
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
