mod names;
mod strings;
mod types;

use super::definitions::{empty_layout, synthetic_export_variable};
use super::state::ExportWriter;
use super::testing::{
    TestUnit, application_file, create_runtime_function, find_file, finish_unit, forward,
    in_application, link_sources, link_sources_in, link_units, number_everything, path_source,
    reverse, test_class_key, test_function_key, test_variable_key, unit_in, with_lowered_units,
    with_test_files,
};
use super::*;
use crate::builtins::RuntimeModule;
use crate::ir::generated::{ModuleKind, TypeSite, TypeSiteKind};
use crate::ir::{FunctionId, Id, ModuleId, TypeSiteId, TypeTable, print_program};
use crate::lower::{Fragment, FragmentBuilder, ModuleFragment};
use crate::modules::ModuleRef;
use bun_sema::program::FileId;

const PROGRAM: [(&str, &str); 8] = [
    (
        "main.ts",
        r#"/// <reference path="./bun-declarations.d.ts" />
import { checkPoint } from "./checks.ts";
import { Circle, createUnitCircle } from "./circle.ts";
import { scale } from "./legacy.cjs";
import { createOrigin, type Point } from "./point.ts";
import settings from "./settings.json";
import { Shape } from "./shape.ts";

const shapes: Shape[] = [
  new Shape(createOrigin()),
  createUnitCircle(),
  new Circle(checkPoint({ x: 2, y: 3 }), settings.radius),
];
let total = 0;
for (const shape of shapes) {
  total += shape.area();
}
export const center: Point = read<Point>({ x: scale(total), y: 0 });
export const label: string = settings.label;
"#,
    ),
    (
        "bun-declarations.d.ts",
        "declare function read<T>(value: unknown): T;\n",
    ),
    (
        "checks.ts",
        r#"/// <reference path="./bun-declarations.d.ts" />
import type { Point } from "./point.ts";

export function checkPoint(value: unknown): Point {
  return read<Point>(value);
}
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

fn read_counter(linked: &Linked, statistic: StatisticId) -> u64 {
    let counts = linked.counters.counts().iter();
    let counts = counts.filter(|(id, _)| *id == statistic);
    counts.map(|&(_, count)| count).sum()
}

#[test]
fn units_are_ordered_by_project_and_file() {
    with_lowered_units(&PATH_IMPORTER, |mut units, projects| {
        units.reverse();
        let ordered = order_units(units, projects).expect("every compiled file has one unit");
        let files: Vec<ProgramFile> = ordered.iter().map(|unit| unit.file).collect();
        assert!(files.is_sorted_by(|first, second| first < second));
        let is_reached = |file: &ProgramFile| {
            !projects
                .get(file.project)
                .unreached_files
                .contains(&file.file)
        };
        let reached_files: Vec<ProgramFile> = compiled_files(projects)
            .into_iter()
            .filter(is_reached)
            .collect();
        assert_eq!(files, reached_files);
        for project in ProjectId::ALL {
            assert!(
                files.iter().any(|file| file.project == project),
                "{project:?}"
            );
        }
    });
}

#[test]
fn missing_unit_is_reported_with_its_project() {
    with_lowered_units(&PATH_IMPORTER, |mut units, projects| {
        let removed_files = [
            application_file(find_file(projects, "main.js")),
            path_source(projects),
        ];
        units.retain(|unit| !removed_files.contains(&unit.file));
        let errors = link_units(units, projects, &forward).err();
        let errors = errors.expect("a compiled file without a unit does not link");
        let missing_files: Vec<ProgramFile> = errors
            .iter()
            .map(|error| match error {
                LinkError::MissingUnit { file } => *file,
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(missing_files, removed_files);
    });
}

#[test]
fn repeated_and_uncompiled_units_are_reported() {
    let files = [
        ("main.js", "import './types.d.ts';\n"),
        ("types.d.ts", "export declare const x: number;\n"),
    ];
    with_lowered_units(&files, |mut units, projects| {
        let mut added_files = ["main.js", "types.d.ts"].map(|name| find_file(projects, name));
        units.extend(added_files.map(|file| finish_unit(projects, FragmentBuilder::new(file))));
        let errors = order_units(units, projects).err();
        let errors = errors.expect("each compiled file has exactly one unit");
        let conflicts: Vec<(ProgramKey, [ProgramFile; 2])> = errors
            .iter()
            .map(|error| match error {
                LinkError::ConflictingDefinitions { key, files } => (*key, *files),
                other => panic!("{other:?}"),
            })
            .collect();
        added_files.sort_unstable();
        let expected = added_files.map(|file| {
            let file = application_file(file);
            (ProgramKey::Module(ProgramModule::File(file)), [file, file])
        });
        assert_eq!(conflicts, expected);
    });
}

#[test]
fn unit_order_does_not_change_the_program() {
    let reorders: [fn(&mut Vec<LinkUnit>); 3] = [
        |_| {},
        |units| units.reverse(),
        |units| units.rotate_left(3),
    ];
    let texts = reorders.map(|reorder| {
        with_lowered_units(&PROGRAM, |mut units, projects| {
            reorder(&mut units);
            let linked = link_units(units, projects, &forward);
            print_program(&linked.expect("the program links").program)
        })
    });
    assert_eq!(texts[1], texts[0]);
    assert_eq!(texts[2], texts[0]);
}

#[test]
fn task_order_does_not_change_the_program() {
    let print = |in_parallel: InParallel<'_>| {
        let linked = link_sources_in(&PROGRAM, in_parallel);
        print_program(&linked.expect("the program links").program)
    };
    assert_eq!(print(&reverse), print(&forward));
}

#[test]
fn keys_and_names_follow_program_ids() {
    let Linked {
        program,
        names,
        keys,
        ..
    } = link_sources(&PROGRAM).expect("the program links");
    assert_eq!(keys.functions.len(), program.functions.len());
    assert_eq!(keys.layouts.len(), program.layouts.len());
    assert_eq!(keys.variables.len(), program.variables.len());
    assert_eq!(keys.modules.len(), program.modules.len());
    for (index, function) in program.functions.iter().enumerate() {
        let id = FunctionId::new(index);
        let name = function
            .name
            .map_or(&b""[..], |name| program.strings.get(name));
        assert_eq!(names.function_name(id), name);
        assert_eq!(names.function_module(id), Some(function.module));
    }
    for (index, module) in program.modules.iter().enumerate() {
        let path = program.strings.get(module.display_path);
        assert_eq!(names.module_path(ModuleId::new(index)), path);
    }
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
    assert_eq!(linked.names.module_origin(path), ModuleOrigin::Runtime);
    let ProgramModule::File(source) = linked.keys.modules[path.index()] else {
        panic!("{:?}", linked.keys.modules[path.index()]);
    };
    assert_eq!(source.project, ProjectId::Runtime);

    let entry = program.entries[0].module;
    assert_eq!(linked.names.module_origin(entry), ModuleOrigin::Program);
    let targets = program.modules[entry.index()].requests.iter();
    assert!(targets.map(|request| request.target).eq([path]));
}

const RETAINED_AND_DROPPED_SITE_POSITIONS: [u32; 2] = [4242, 4343];

fn create_fragment_with_dropped_definitions(file: FileId) -> Fragment {
    let mut unit = TestUnit::new(file);
    let module = unit.module;
    let name = unit.fragment.strings.intern(b"variable");
    let mut bodies = Vec::new();
    for (index, position) in (0..).zip(RETAINED_AND_DROPPED_SITE_POSITIONS) {
        let class_key = test_class_key(file.0, index);
        let layout = unit.fragment.declare_layout(class_key);
        unit.fragment
            .define_layout(layout, empty_layout(&class_key));
        let variable = unit
            .fragment
            .declare_variable(test_variable_key(file.0, index));
        let definition = synthetic_export_variable(name, module, ExportWriter::Loader);
        unit.fragment.define_variable(variable, definition);
        let site = unit.fragment.add_type_site(TypeSite {
            module,
            position,
            kind: TypeSiteKind::Assertion,
            text: None,
        });
        bodies.push(unit.define_function(index, |builder| {
            builder.new_object(layout, &[], None, &[]);
            let value = builder.get_module_variable(variable);
            builder.check(value, TypeTable::NUMBER, Some(site));
        }));
    }
    let called = bodies[0];
    unit.define_body(|builder| {
        builder.call_direct(called, &[]);
    });
    unit.finish()
}

#[test]
fn dropped_definitions_have_no_program_ids() {
    let (linked, file) = link_replaced_entry(create_fragment_with_dropped_definitions);
    let linked = linked.expect("the program links");
    let keys = &linked.keys;
    let has_definitions_of = |index| {
        let function = in_application(test_function_key(file.0, index));
        let layout = in_application(test_class_key(file.0, index));
        let variable = in_application(test_variable_key(file.0, index));
        let variable = ProgramVariableKey::Declared(variable);
        [
            keys.functions.contains(&function),
            keys.layouts.contains(&layout),
            keys.variables.contains(&variable),
        ]
    };
    assert_eq!(has_definitions_of(0), [true; 3]);
    assert_eq!(has_definitions_of(1), [false; 3]);

    let entry = linked.program.entries[0].module;
    let sites = linked.program.type_sites.iter();
    let positions: Vec<u32> = sites
        .filter(|site| site.module == entry)
        .map(|site| site.position)
        .collect();
    assert_eq!(positions, [RETAINED_AND_DROPPED_SITE_POSITIONS[0]]);
}

#[test]
fn dropped_functions_are_counted() {
    let link_with_unused_functions = |count: u32| {
        let (linked, _) = link_replaced_entry(|file| {
            let mut unit = TestUnit::new(file);
            for function in 0..count {
                unit.define_function(function, |_| {});
            }
            unit.define_body(|_| {});
            unit.finish()
        });
        let linked = linked.expect("the program links");
        read_counter(&linked, StatisticId::FunctionsDroppedByLink)
    };
    assert_eq!(
        link_with_unused_functions(2),
        link_with_unused_functions(0) + 2
    );
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
            std::sync::Arc::make_mut(function).enclosing_runtime_function = enclosing;
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

#[test]
fn conflicting_and_undefined_keys_are_reported_together() {
    let (linked, file) = link_replaced_entry(|file| {
        let mut unit = TestUnit::new(file);
        let undefined = unit.fragment.declare_function(test_function_key(file.0, 1));
        unit.define_body(|builder| {
            builder.call_direct(undefined, &[]);
        });
        unit.define_function(2, |_| {});
        let mut fragment = unit.finish();
        let repeated = fragment.functions.last().cloned();
        fragment.functions.extend(repeated);
        fragment
    });
    let errors = linked.err().expect("the program does not link");
    let [
        LinkError::ConflictingDefinitions {
            key: conflicting_key,
            files,
        },
        LinkError::UndefinedFunction {
            key: undefined_key,
            referenced_in,
        },
    ] = errors.as_slice()
    else {
        panic!("{errors:?}");
    };
    let file_in_program = application_file(file);
    let [undefined, repeated] =
        [1, 2].map(|function| in_application(test_function_key(file.0, function)));
    assert_eq!(*conflicting_key, ProgramKey::Function(repeated));
    assert_eq!(*files, [file_in_program; 2]);
    assert_eq!(*undefined_key, undefined);
    assert_eq!(*referenced_in, file_in_program);
}

#[test]
fn number_everything_gives_shared_keys_one_id() {
    with_test_files(|projects, [shared_file, first_file, second_file]| {
        let create_type_site = |module| TypeSite {
            module,
            ..TypeSite::default()
        };
        let shared_key = test_function_key(shared_file.0, 0);
        let shared_module = ModuleRef::File(shared_file);
        let mut first = FragmentBuilder::new(first_file);
        let first_function = first.declare_function(shared_key);
        let first_module = first.declare_module(shared_module);
        first.add_type_site(create_type_site(first_module));
        let mut second = FragmentBuilder::new(second_file);
        let own_function = second.declare_function(test_function_key(second_file.0, 0));
        let second_function = second.declare_function(shared_key);
        let own_module = second.declare_module(ModuleRef::File(second_file));
        let second_module = second.declare_module(shared_module);
        second.add_type_site(create_type_site(second_module));
        let units = [first, second].map(|fragment| {
            let fragment = fragment.finish(ModuleFragment::default());
            unit_in(projects, ProjectId::Application, fragment)
        });

        let unit_ids = number_everything(&units);

        let [first_ids, second_ids] = unit_ids.as_slice() else {
            panic!("{} units are numbered", unit_ids.len());
        };
        let shared_function = first_ids.functions[first_function.index()];
        assert!(shared_function.is_some());
        assert_eq!(
            second_ids.functions[second_function.index()],
            shared_function
        );
        assert_ne!(second_ids.functions[own_function.index()], shared_function);
        let [first_program_module, second_program_module] =
            [0, 1].map(|id| Some(ModuleId::new(id)));
        assert_eq!(
            first_ids.modules[first_module.index()],
            first_program_module
        );
        assert_eq!(
            second_ids.modules[second_module.index()],
            first_program_module
        );
        assert_eq!(
            second_ids.modules[own_module.index()],
            second_program_module
        );
        assert_eq!(first_ids.type_sites, [Some(TypeSiteId::new(0))]);
        assert_eq!(second_ids.type_sites, [Some(TypeSiteId::new(1))]);
    });
}
