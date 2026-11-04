use super::definitions::empty_layout;
use super::testing::{
    TaskState, TestUnit, application_file, create_runtime_function, find_file, forward,
    in_application, link_sources, link_sources_in, link_units, reverse, test_class_key,
    test_function_key, test_object_type_key, test_variable_key, unit_in, units_in_tasks,
    with_lowered_units, with_lowered_units_without_bun_modules, with_test_files,
};
use super::*;
use crate::builtins::{BuiltinClass, RuntimeFunction, RuntimeModule};
use crate::ir::generated::{
    Data, DataMember, DataNode, EvalBinding, EvalScope, Field, FieldFlags, Layout, ModuleKind,
    Variable,
};
use crate::ir::{
    DeclaredType, FunctionId, FunctionKey, Id, Mapped, ModuleId, PositionFlags, PropertyKey, Type,
    print_program,
};
use crate::lower::Fragment;
use crate::modules::ModuleRef;
use bun_sema::program::FileId;
use std::sync::Arc;

const PROGRAM: [(&str, &str); 6] = [
    (
        "main.ts",
        r#"import { Circle, createUnitCircle } from "./circle.ts";
import { scale } from "./legacy.cjs";
import { createOrigin, type Point } from "./point.ts";
import settings from "./settings.json";
import { Shape } from "./shape.ts";

const shapes: Shape[] = [
  new Shape(createOrigin()),
  createUnitCircle(),
  new Circle({ x: 2, y: 3 }, settings.radius),
];
let total = 0;
for (const shape of shapes) {
  total += shape.area();
}
export const center: Point = { x: scale(total), y: 0 };
export const label: string = settings.label;
"#,
    ),
    (
        "circle.ts",
        r#"import type { Point } from "./point.ts";
import { Shape } from "./shape.ts";

export class Circle extends Shape {
  radius: number;

  constructor(center: Point, radius: number) {
    super(center);
    this.radius = radius;
  }

  area(): number {
    return 3 * this.radius * this.radius;
  }
}

export function createUnitCircle(): Circle {
  return new Circle({ x: 1, y: 1 }, 1);
}
"#,
    ),
    (
        "legacy.cjs",
        "exports.scale = function (value) {\n  return value * 2;\n};\n",
    ),
    (
        "point.ts",
        r#"export interface Point {
  x: number;
  y: number;
}

export function createOrigin(): Point {
  return { x: 0, y: 0 };
}
"#,
    ),
    ("settings.json", "{ \"radius\": 2, \"label\": \"unit\" }\n"),
    (
        "shape.ts",
        r#"import type { Point } from "./point.ts";

export class Shape {
  center: Point;

  constructor(center: Point) {
    this.center = center;
  }

  area(): number {
    return 0;
  }
}
"#,
    ),
];

const PATH_IMPORTER: [(&str, &str); 1] = [(
    "main.js",
    "import { join } from 'node:path';\nconsole.log(join('a', 'b'));\n",
)];

const UNUSED_RUNTIME_FUNCTION: u32 = 1 << 30;

/// One for each of the test files, and one that belongs to none of them.
const TEXTS: [&[u8]; 4] = [b"of main", b"of first", b"of second", b"shared"];

const TEXT_UNIQUE_TO_VISIT: &[u8] = b"thrown away";

fn link_replaced_entry(
    create_fragment: impl FnOnce(FileId) -> Fragment,
) -> (Result<Linked, Vec<LinkError>>, FileId) {
    with_lowered_units(&[("main.ts", "export {};\n")], |mut units, projects| {
        let file = find_file(projects, "main.ts");
        let mut lowered_units = units.iter_mut();
        let entry = lowered_units.find(|unit| unit.file == application_file(file));
        let entry = entry.expect("the entry point has no unit");
        *entry = unit_in(projects, ProjectId::Application, create_fragment(file));
        (link_units(units, projects, &forward), file)
    })
}

fn find_program_id<K: PartialEq, I: Id>(keys: &[K], key: K) -> Option<I> {
    keys.iter().position(|other| *other == key).map(I::new)
}

/// What two links of the same sources agree on. The text spells out strings, property keys and types where something names them, so their order stands beside it.
#[derive(PartialEq, Debug)]
struct Outcome {
    text: String,
    functions: Vec<ProgramFunctionKey>,
    strings: Vec<Vec<u8>>,
    property_keys: Vec<PropertyKey>,
    types: Vec<Type>,
}

fn outcome_of(linked: Result<Linked, Vec<LinkError>>) -> Outcome {
    let Linked { program, keys, .. } = linked.expect("the program links");
    assert_eq!(program.functions.len(), keys.functions.len());
    let strings = &program.strings;
    Outcome {
        text: print_program(&program),
        functions: keys.functions,
        strings: strings.ids().map(|id| strings.get(id).to_vec()).collect(),
        property_keys: program.property_keys.as_slice().to_vec(),
        types: program.types.types().to_vec(),
    }
}

fn count_sets_of_tables(units: &[LinkUnit]) -> usize {
    let sets = units.iter().map(|unit| Arc::as_ptr(&unit.shared));
    let mut sets: Vec<_> = sets.collect();
    sets.sort_unstable();
    sets.dedup();
    sets.len()
}

/// Calls `make` for the item at `first`, for those behind it, and then for those in front of it. The results stand in the order of the items.
fn map_beginning_at<T: Copy, I: Id, const COUNT: usize>(
    items: [T; COUNT],
    first: usize,
    mut make: impl FnMut(T) -> I,
) -> [I; COUNT] {
    let mut made = [I::default(); COUNT];
    for index in (first..COUNT).chain(0..first) {
        made[index] = make(items[index]);
    }
    made
}

/// Every file names the same records and begins with its own, so a number stands for another record under each set of tables.
/// The text, the key and the layout at 3 belong to no file: each file defines that layout. Nothing defines the layout at 4.
fn name_records_of_every_file(unit: &mut TestUnit, files: [FileId; 3]) {
    let own = files.iter().position(|&file| file == unit.file);
    let own = own.expect("the unit is of one of the files");
    let (next, module) = ((own + 1) % files.len(), unit.module);
    let [main, first, second] = files.map(|file| test_class_key(file.0, 0));
    let layout_keys = [
        main,
        first,
        second,
        test_object_type_key(1),
        test_object_type_key(2),
    ];

    let fragment = &mut unit.fragment;
    let texts = map_beginning_at(TEXTS, own, |text| fragment.strings.intern(text));
    let keys = map_beginning_at(texts, own, |text| {
        fragment.property_keys.intern(PropertyKey::from_text(text))
    });
    let layouts = map_beginning_at(layout_keys, own, |key| fragment.declare_layout(key));
    let types = map_beginning_at(layouts, own, |layout| {
        fragment.types.intern(Type::layout(layout))
    });
    let functions = map_beginning_at(files, own, |file| {
        fragment.declare_function(test_function_key(file.0, 0))
    });
    let variables = map_beginning_at(files, own, |file| {
        fragment.declare_variable(test_variable_key(file.0, 0))
    });
    let modules = map_beginning_at(files, own, |file| {
        fragment.declare_module(ModuleRef::File(file))
    });
    let list = Type::class(BuiltinClass::Array, &[types[own]]);
    let list = fragment.types.intern(list);
    let literal = fragment.types.intern(Type::string_literal(texts[own]));
    let private_key = PropertyKey::from_private_name(texts[3], layouts[next]);
    let private_key = fragment.property_keys.intern(private_key);

    let holds = |ty| DeclaredType::new(Mapped::checked(ty), None, PositionFlags::default());
    let field = |key, ty| Field {
        key: Some(key),
        declared: holds(ty),
        flags: FieldFlags::IS_REQUIRED,
        ..Field::default()
    };
    let class = Layout {
        name: Some(texts[own]),
        module: Some(module),
        base: layouts[..files.len()].get(own + 1).copied(),
        fields: vec![field(keys[own], list)],
        ..empty_layout(&layout_keys[own])
    };
    fragment.define_layout(layouts[own], class);
    let shared = Layout {
        fields: vec![field(keys[3], types[own])],
        ..empty_layout(&layout_keys[3])
    };
    fragment.define_object_type(layouts[3], shared, None);
    fragment.add_supertype(layouts[3], layouts[4]);
    fragment
        .family_facts
        .record_conversion(types[own], types[3]);
    let variable = Variable {
        name: Some(texts[own]),
        module,
        declared: holds(literal),
        ..Variable::default()
    };
    fragment.define_variable(variables[own], variable);

    let value = DataNode::String { value: texts[own] };
    // One file alone makes an object with the shared layout and writes the shared key.
    let root = match own {
        1 => {
            let (layout, key) = (layouts[3], keys[3]);
            let members = vec![DataMember { key, value }];
            DataNode::Object { layout, members }
        }
        _ => value,
    };
    let data = fragment.add_data(Data {
        root,
        module: Some(module),
    });
    let binding = EvalBinding {
        name: Some(texts[next]),
        layout: Some(layouts[next]),
        variable: Some(variables[next]),
        ..EvalBinding::default()
    };
    let scope = fragment.add_eval_scope(EvalScope {
        bindings: vec![binding],
        ..EvalScope::default()
    });

    unit.define_function(0, |builder| {
        let text = builder.string(texts[own]);
        let read = builder.get_module_variable(variables[next]);
        builder.type_test(read, list);
        builder.prop_get(read, private_key, false, false);
        builder.new_object(layouts[next], &[], None, &[]);
        builder.data(data);
        builder.record_require(modules[next], modules[own]);
        builder.direct_eval(scope, text, read, None, &[]);
    });
    unit.define_body(|builder| {
        for function in functions {
            builder.call_direct(function, &[]);
        }
    });
}

fn add_records_unique_to_visit(unit: &mut TestUnit) {
    let file = unit.file.0;
    let fragment = &mut unit.fragment;
    let text = fragment.strings.intern(TEXT_UNIQUE_TO_VISIT);
    fragment.property_keys.intern(PropertyKey::from_text(text));
    fragment.types.intern(Type::string_literal(text));
    fragment.declare_layout(test_class_key(file, 1));
    fragment.declare_variable(test_variable_key(file, 1));
    fragment.add_data(Data::default());
    fragment.add_eval_scope(EvalScope::default());
    unit.define_function(1, |_| {});
}

#[test]
fn units_are_ordered_by_project_and_file() {
    with_lowered_units(&PATH_IMPORTER, |mut units, _| {
        units.reverse();
        let ordered = order_units(units);
        let files: Vec<ProgramFile> = ordered.iter().map(|unit| unit.file).collect();
        assert!(files.is_sorted_by(|first, second| first < second));
        for project in ProjectId::ALL {
            assert!(
                files.iter().any(|file| file.project == project),
                "{project:?}"
            );
        }
    });
}

#[test]
fn unit_order_does_not_change_the_program() {
    let reorders: [fn(&mut Vec<LinkUnit>); 3] = [
        |_| {},
        |units| units.reverse(),
        |units| units.rotate_left(3),
    ];
    let outcomes = reorders.map(|reorder| {
        with_lowered_units(&PROGRAM, |mut units, projects| {
            reorder(&mut units);
            outcome_of(link_units(units, projects, &forward))
        })
    });
    assert_eq!(outcomes[1], outcomes[0]);
    assert_eq!(outcomes[2], outcomes[0]);
}

#[test]
fn task_order_does_not_change_the_program() {
    let link_in = |in_parallel: InParallel<'_>| outcome_of(link_sources_in(&PROGRAM, in_parallel));
    assert_eq!(link_in(&reverse), link_in(&forward));
}

#[test]
fn sharing_of_tables_does_not_change_the_program() {
    with_test_files(|projects, files| {
        let [main, first, second] = files;
        let link_in_tasks = |tasks: &[&[FileId]], in_parallel: InParallel<'_>| {
            let units = units_in_tasks(projects, tasks, |unit| {
                name_records_of_every_file(unit, files)
            });
            assert_eq!(count_sets_of_tables(&units), tasks.len());
            outcome_of(link_units(units, projects, in_parallel))
        };
        let under_one_set = link_in_tasks(&[&[main, first, second]], &forward);
        let mut files_in_order = files;
        files_in_order.sort_unstable();
        let functions_in_order = files_in_order.map(|file| {
            let keys = [test_function_key(file.0, 0), FunctionKey::ModuleBody(file)];
            keys.map(in_application)
        });
        assert_eq!(under_one_set.functions, functions_in_order.concat());
        let other_groupings: [&[&[FileId]]; 4] = [
            &[&[main], &[first], &[second]],
            &[&[main, second], &[first]],
            &[&[second, first, main]],
            &[&[second], &[first, main]],
        ];
        for tasks in other_groupings {
            assert_eq!(link_in_tasks(tasks, &forward), under_one_set, "{tasks:?}");
            assert_eq!(link_in_tasks(tasks, &reverse), under_one_set, "{tasks:?}");
        }
    });
}

#[test]
fn visit_that_is_thrown_away_leaves_nothing_in_the_program() {
    with_test_files(|projects, files| {
        let [main, first, second] = files;
        let fill = |unit: &mut TestUnit| name_records_of_every_file(unit, files);
        let units = units_in_tasks(projects, &[&[main, first], &[second]], fill);
        let expected = outcome_of(link_units(units, projects, &forward));

        let mut task = TaskState::new();
        let mut visit = |file: FileId, is_committed: bool| {
            let mut unit = TestUnit::new_in(file, &mut task);
            fill(&mut unit);
            if !is_committed {
                add_records_unique_to_visit(&mut unit);
            }
            unit.finish_in(&mut task)
        };
        let committed = [main, first].map(|file| visit(file, true));
        // A visit that is not committed ends its task: another task lowers the file.
        let thrown_away = visit(second, false);
        let tables = thrown_away.tables.take();
        assert!(tables.strings.find(TEXT_UNIQUE_TO_VISIT).is_some());
        thrown_away.tables.put_back(tables);
        drop((thrown_away, task));

        let to_unit = |fragment| unit_in(projects, ProjectId::Application, fragment);
        let mut units = Vec::from(committed.map(to_unit));
        units.extend(units_in_tasks(projects, &[&[second]], fill));
        assert_eq!(count_sets_of_tables(&units), 2);
        assert_eq!(outcome_of(link_units(units, projects, &forward)), expected);
    });
}

#[test]
fn units_of_both_projects_link() {
    let linked = link_sources(&PATH_IMPORTER).expect("the program links");
    let program = &linked.program;
    for project in ProjectId::ALL {
        let mut functions = linked.keys.functions.iter();
        assert!(functions.any(|key| key.project == project), "{project:?}");
    }

    let mut records = program.modules.iter();
    let path = records.position(|record| record.runtime_module == Some(RuntimeModule::NodePath));
    let path = ModuleId::new(path.expect("node:path has no record"));
    let record = &program.modules[path.index()];
    assert_eq!(record.kind, ModuleKind::RuntimeSource);
    assert!(record.body.is_some());
    let ProgramModule::File(source) = linked.modules[path.index()] else {
        panic!("{:?}", linked.modules[path.index()]);
    };
    assert_eq!(source.project, ProjectId::Runtime);

    let entry = program.entries[0].module;
    let targets = program.modules[entry.index()].requests.iter();
    assert!(targets.map(|request| request.target).eq([path]));
}

#[test]
fn link_keeps_enclosing_runtime_function_ids() {
    let first = RuntimeFunction(UNUSED_RUNTIME_FUNCTION);
    let second = RuntimeFunction(UNUSED_RUNTIME_FUNCTION + 4);
    let (linked, file) = link_replaced_entry(|file| {
        let mut unit = TestUnit::new(file);
        unit.define_body(|_| {});
        let nested = unit.define_function(2, |_| {});
        let first_function = unit.define_function(0, |_| {});
        let second_function = unit.define_function(1, |builder| {
            builder.call_direct(nested, &[]);
        });
        for (function, id) in [(first_function, first), (second_function, second)] {
            let entry = create_runtime_function(id.0, function);
            unit.fragment.add_runtime_function(entry);
        }
        let mut fragment = unit.finish();
        let enclosing_functions = [None, Some(second), Some(first), Some(second)];
        let definitions = fragment.functions.iter_mut();
        for ((_, function), enclosing) in definitions.zip(enclosing_functions) {
            Arc::make_mut(function).enclosing_runtime_function = enclosing;
        }
        fragment
    });
    let linked = linked.expect("the program links");
    let program = &linked.program;
    let [first_function, second_function, nested] = [0, 1, 2].map(|function| -> FunctionId {
        let key = in_application(test_function_key(file.0, function));
        find_program_id(&linked.keys.functions, key).expect("the function is retained")
    });
    let enclosing_of =
        |function: FunctionId| program.functions[function.index()].enclosing_runtime_function;
    assert_eq!(enclosing_of(first_function), Some(first));
    assert_eq!(enclosing_of(second_function), Some(second));
    assert_eq!(enclosing_of(nested), Some(second));
    let [.., first_entry, second_entry] = program.runtime_functions.as_slice() else {
        panic!("{:?}", program.runtime_functions);
    };
    assert_eq!(
        (first_entry.id, first_entry.function),
        (first, first_function)
    );
    assert_eq!(
        (second_entry.id, second_entry.function),
        (second, second_function)
    );
}

// Nodes of a syntax tree: told apart by a literal, with tokens whose instantiations are alike, so that a file defines several layouts, and one of them several times.
const SYNTAX_TREE: [(&str, &str); 3] = [
    (
        "main.ts",
        r#"import { Kind, type Name, type Pair, type Punctuation, type Token } from "./types.ts";
import { count, start, width } from "./reads.ts";
const name: Name = { kind: Kind.Name, pos: 0, end: 1, text: "a" };
const dot: Punctuation<Kind.Dot> = { kind: Kind.Dot, pos: 1, end: 2 };
const comma: Token<Kind.Comma> = { kind: Kind.Comma, pos: 2, end: 3 };
const pair: Pair = { kind: Kind.Pair, pos: 0, end: 3, left: name, dot, right: name };
export const total: number =
  width(dot, dot, comma, { kind: Kind.Comma, pos: 4, end: 5 }) + count({ kind: Kind.List, pos: 0, end: 9, items: [name] }, pair, name) + start(pair);
"#,
    ),
    (
        "types.ts",
        r#"export const enum Kind { Dot, Comma, Name, List, Pair }
export interface Node { readonly kind: Kind; pos: number; end: number }
export interface Token<K extends Kind> extends Node { readonly kind: K }
export interface Punctuation<K extends Kind> extends Token<K> {}
export interface Name extends Node { readonly kind: Kind.Name; text: string }
export interface List extends Node { readonly kind: Kind.List; items: Name[]; comma?: Punctuation<Kind.Comma> }
export interface Pair extends Node { readonly kind: Kind.Pair; left: Name; dot: Token<Kind.Dot>; right: Name | Pair }
export type AnyNode = Name | List | Pair | Token<Kind.Dot> | Punctuation<Kind.Dot> | Token<Kind.Comma> | Punctuation<Kind.Comma>;
"#,
    ),
    (
        "reads.ts",
        r#"import { Kind, type AnyNode, type List, type Name, type Pair, type Punctuation, type Token } from "./types.ts";
export function width(dot: Punctuation<Kind.Dot>, same: Token<Kind.Dot>, comma: Token<Kind.Comma>, other: Punctuation<Kind.Comma>): number {
  return dot.end - same.pos + comma.end - other.pos;
}
export function count(list: List, pair: Pair, name: Name): number {
  return list.items.length + pair.left.text.length + pair.dot.pos + name.end + (list.comma ? list.comma.pos : 0);
}
export function start(node: AnyNode): number {
  return node.kind === Kind.Pair ? node.left.pos : node.pos;
}
"#,
    ),
];

#[test]
fn in_which_order_a_file_has_defined_its_layouts_changes_nothing() {
    let print_linked = |reverses_definitions: bool| {
        with_lowered_units_without_bun_modules(&SYNTAX_TREE, |mut units, projects| {
            let mut has_layout_with_two_definitions = false;
            for unit in units.iter_mut().filter(|_| reverses_definitions) {
                let definitions = &mut unit.layout_definitions;
                has_layout_with_two_definitions |=
                    definitions.windows(2).any(|pair| pair[0].0 == pair[1].0);
                let last = definitions.len() as u32;
                definitions.reverse();
                unit.object_types.reverse();
                for (of_definition, _) in &mut unit.object_types {
                    *of_definition = last - 1 - *of_definition;
                }
            }
            assert_eq!(has_layout_with_two_definitions, reverses_definitions);
            let linked = link_units(units, projects, &forward);
            print_program(&linked.expect("the program links").program)
        })
    };
    assert_eq!(print_linked(false), print_linked(true));
}
