use super::{define_plain_variable, intern_text_key, mark_fragments};
use crate::ir::generated::{Field, Layout, LayoutKind, StaticField};
use crate::ir::{
    DeclaredType, FunctionId, FunctionKey, Id, LayoutId, LayoutKey, PropertyKeyId, StringId, Type,
    TypeId, TypeTable,
};
use crate::link::definitions::empty_layout;
use crate::link::testing::{
    TestUnit, link_sources_without_bun_modules, test_class_key, test_function_key,
    test_object_type_key, test_variable_key, with_test_files,
};
use crate::lower::Fragment;
use bun_sema::check::aot::{FunctionRef, ObjectOrigin, TypeIdentity};
use bun_sema::hir::{FnId, TypeNodeId};
use bun_sema::program::FileId;

fn create_field(key: PropertyKeyId, ty: TypeId) -> Field {
    Field {
        key: Some(key),
        declared: DeclaredType::from_compiler(ty),
        ..Field::default()
    }
}

fn create_unit_with_tested_type(
    file: FileId,
    key: LayoutKey,
    create_type: fn(LayoutId) -> Type,
) -> TestUnit {
    let mut unit = TestUnit::new(file);
    let layout = unit.fragment.declare_layout(key);
    let tested_type = unit.fragment.types.intern(create_type(layout));
    unit.define_function(1, |builder| {
        let value = builder.undefined();
        builder.type_test(value, tested_type);
    });
    unit
}

fn create_unit_with_allocation(file: FileId, key: LayoutKey) -> TestUnit {
    let mut unit = TestUnit::new(file);
    let layout = unit.fragment.declare_layout(key);
    unit.define_function(1, |builder| {
        builder.new_object(layout, &[], None, &[]);
    });
    unit
}

fn call_first_functions(mut unit: TestUnit, files: &[FileId]) -> Fragment {
    let keys = files.iter().map(|file| test_function_key(file.0, 1));
    let callees: Vec<FunctionId> = keys
        .map(|key| unit.fragment.declare_function(key))
        .collect();
    unit.define_body(|builder| {
        for &callee in &callees {
            builder.call_direct(callee, &[]);
        }
    });
    unit.finish()
}

#[test]
fn retains_class_layout_members() {
    with_test_files(|projects, [main, ..]| {
        let [class_key, base_key, unnamed_key] = [0, 1, 2].map(|id| test_class_key(main.0, id));
        let [field_layout_key, supertype_key] = [1, 2].map(test_object_type_key);
        let mut unit = TestUnit::new(main);
        let [class, base, unnamed, field_layout, supertype] = [
            class_key,
            base_key,
            unnamed_key,
            field_layout_key,
            supertype_key,
        ]
        .map(|key| unit.fragment.declare_layout(key));
        let constructor = unit.define_function(1, |_| {});
        let (key, name) = intern_text_key(&mut unit.fragment, b"member");
        let field_type = unit.fragment.types.intern(Type::layout(field_layout));
        let static_variable = define_plain_variable(&mut unit, 0);
        let definition = Layout {
            base: Some(base),
            constructor: Some(constructor),
            fields: vec![create_field(key, field_type)],
            static_fields: vec![StaticField {
                key: Some(key),
                computed_key: None,
                variable: static_variable,
            }],
            ..empty_layout(&class_key)
        };
        unit.fragment.define_layout(class, definition);
        unit.fragment.define_layout(base, empty_layout(&base_key));
        unit.fragment
            .define_layout(unnamed, empty_layout(&unnamed_key));
        unit.fragment.add_supertype(class, supertype);
        unit.define_body(|builder| {
            builder.new_object(class, &[], None, &[]);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_layout(class_key));
        assert!(marked.has_layout(base_key));
        assert!(marked.has_source_function(main, 1));
        assert!(marked.has_layout(field_layout_key));
        assert!(marked.has_layout(supertype_key));
        assert!(marked.has_variable(test_variable_key(main.0, 0)));
        assert!(marked.unit_marks(main).property_keys[key.index()]);
        assert!(marked.unit_marks(main).strings[name.index()]);
        assert!(!marked.has_layout(unnamed_key));
    });
}

fn define_constructor_function(
    unit: &mut TestUnit,
    function: u32,
    field_name: &[u8],
) -> (FunctionId, LayoutKey, StringId) {
    let constructor = unit.define_function(function, |_| {});
    let layout_key = LayoutKey::ConstructorFunction(FunctionRef {
        file: unit.file,
        function: FnId(function),
    });
    let layout = unit.fragment.declare_layout(layout_key);
    let (key, name) = intern_text_key(&mut unit.fragment, field_name);
    let definition = Layout {
        constructor: Some(constructor),
        fields: vec![create_field(key, TypeTable::ANYTHING)],
        ..empty_layout(&layout_key)
    };
    unit.fragment.define_layout(layout, definition);
    (constructor, layout_key, name)
}

#[test]
fn retains_constructed_layout() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let (called, called_key, called_name) = define_constructor_function(&mut unit, 1, b"x");
        let (_, uncalled_key, uncalled_name) = define_constructor_function(&mut unit, 2, b"y");
        unit.define_body(|builder| {
            builder.call_direct(called, &[]);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let strings = &marked.unit_marks(main).strings;
        assert!(marked.has_layout(called_key));
        assert!(strings[called_name.index()]);
        assert!(!marked.has_layout(uncalled_key));
        assert!(!strings[uncalled_name.index()]);
    });
}

#[test]
fn links_constructor_function_layout() {
    let source = "export function Point(x) { this.x = x; }\nconsole.log(new Point(1).x);\n";
    let linked = link_sources_without_bun_modules(&[("main.js", source)]);
    let linked = linked.expect("the program links");
    let program = &linked.program;
    let mut functions = program.functions.iter();
    let constructor = functions.position(|function| {
        let name = function.name.map(|name| program.strings.get(name));
        name == Some(&b"Point"[..])
    });
    let constructor = FunctionId::new(constructor.expect("the called constructor is retained"));
    let mut layouts = program.layouts.iter();
    let point = layouts.find(|layout| layout.constructor == Some(constructor));
    let point = point.expect("a retained constructor retains its layout");
    assert_eq!(point.kind, LayoutKind::Instance);
    assert_eq!(point.fields.len(), 1);
}

fn define_with_field(unit: &mut TestUnit, layout_key: &LayoutKey) -> (StringId, Layout) {
    let (key, name) = intern_text_key(&mut unit.fragment, b"field");
    let definition = Layout {
        fields: vec![create_field(key, TypeTable::NUMBER)],
        ..empty_layout(layout_key)
    };
    (name, definition)
}

fn define_with_name(unit: &mut TestUnit, layout_key: &LayoutKey) -> (StringId, Layout) {
    let name = format!("Name{}", unit.file.0);
    let name = unit.fragment.strings.intern(name.as_bytes());
    let definition = Layout {
        name: Some(name),
        ..empty_layout(layout_key)
    };
    (name, definition)
}

// Two files define the layout. Whether the string that `define` answers is retained, in the order of the files.
fn is_string_retained(
    layout_key: fn(FileId) -> LayoutKey,
    define: fn(&mut TestUnit, &LayoutKey) -> (StringId, Layout),
) -> [bool; 2] {
    with_test_files(|projects, [main, first, second]| {
        let layout_key = layout_key(second);
        let mut names = Vec::new();
        let units = [main, first].map(|file| {
            let mut unit = create_unit_with_allocation(file, layout_key);
            let layout = unit.fragment.declare_layout(layout_key);
            let (name, definition) = define(&mut unit, &layout_key);
            names.push((file, name));
            unit.fragment.define_layout(layout, definition);
            unit
        });
        let [main_unit, first_unit] = units;
        let fragments = [
            call_first_functions(main_unit, &[main, first]),
            first_unit.finish(),
        ];

        let marked = mark_fragments(projects, fragments);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_layout(layout_key));
        names.sort_unstable_by_key(|&(file, _)| file);
        let names: [(FileId, StringId); 2] = names.try_into().expect("two units define the layout");
        names.map(|(file, name)| marked.unit_marks(file).strings[name.index()])
    })
}

#[test]
fn ignored_definition_retains_nothing() {
    let written_in_another_file = |file| LayoutKey::ObjectType {
        origin: ObjectOrigin::TypeLiteral {
            file,
            node: TypeNodeId(0),
        },
        instantiation: TypeIdentity([1, 0]),
    };
    assert_eq!(
        is_string_retained(written_in_another_file, define_with_field),
        [true, false]
    );
}

#[test]
fn every_definition_of_plain_layout_retains_what_it_names() {
    assert_eq!(
        is_string_retained(|_| test_object_type_key(1), define_with_field),
        [true, true]
    );
}

#[test]
fn only_first_definition_of_plain_layout_retains_its_name() {
    assert_eq!(
        is_string_retained(|_| test_object_type_key(1), define_with_name),
        [true, false]
    );
}

#[test]
fn ignored_definition_names_no_constructor() {
    with_test_files(|projects, [main, first, _]| {
        let layout_key = test_object_type_key(1);
        let ignored_file = main.max(first);
        let units = [main, first].map(|file| {
            let mut unit = TestUnit::new(file);
            let function = unit.define_function(1, |_| {});
            let layout = unit.fragment.declare_layout(layout_key);
            let definition = Layout {
                constructor: (file == ignored_file).then_some(function),
                ..empty_layout(&layout_key)
            };
            unit.fragment.define_layout(layout, definition);
            unit
        });
        let [main_unit, first_unit] = units;
        let fragments = [
            call_first_functions(main_unit, &[main, first]),
            first_unit.finish(),
        ];

        let marked = mark_fragments(projects, fragments);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_source_function(ignored_file, 1));
        assert!(!marked.has_layout(layout_key));
    });
}

#[test]
fn allows_undefined_object_type() {
    with_test_files(|projects, [main, ..]| {
        let key = test_object_type_key(1);
        for unit in [
            create_unit_with_tested_type(main, key, Type::layout),
            create_unit_with_allocation(main, key),
        ] {
            let marked = mark_fragments(projects, [call_first_functions(unit, &[main])]);
            assert!(marked.errors.is_empty(), "{:?}", marked.errors);
            assert!(marked.has_layout(key));
        }
    });
}

#[test]
fn allows_undefined_class_only_in_type() {
    with_test_files(|projects, [main, first, _]| {
        for key in [test_class_key(main.0, 0), test_class_key(first.0, 0)] {
            let unit = create_unit_with_tested_type(main, key, Type::layout);
            let marked = mark_fragments(projects, [call_first_functions(unit, &[main])]);
            assert!(marked.errors.is_empty(), "{:?}", marked.errors);
            assert!(marked.has_layout(key));

            let unit = create_unit_with_allocation(main, key);
            let marked = mark_fragments(projects, [call_first_functions(unit, &[main])]);
            assert_eq!(marked.undefined_layouts(), [(key, main)]);
        }
    });
}

#[test]
fn allows_undefined_class_in_supertype_edge() {
    with_test_files(|projects, [main, ..]| {
        let [class_key, supertype_key] = [0, 1].map(|id| test_class_key(main.0, id));
        let mut unit = create_unit_with_allocation(main, class_key);
        let class = unit.fragment.declare_layout(class_key);
        let supertype = unit.fragment.declare_layout(supertype_key);
        unit.fragment.define_layout(class, empty_layout(&class_key));
        unit.fragment.add_supertype(class, supertype);

        let marked = mark_fragments(projects, [call_first_functions(unit, &[main])]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_layout(supertype_key));
    });
}

#[test]
fn reports_undefined_layouts_in_key_order() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let keys = (0..16).map(|class| test_class_key(main.0, class));
        let descending_keys = keys.clone().rev();
        let layouts: Vec<LayoutId> = descending_keys
            .map(|key| unit.fragment.declare_layout(key))
            .collect();
        unit.define_body(|builder| {
            for &layout in &layouts {
                builder.new_object(layout, &[], None, &[]);
            }
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        let expected: Vec<(LayoutKey, FileId)> = keys.map(|key| (key, main)).collect();
        assert_eq!(marked.undefined_layouts(), expected);
    });
}

#[test]
fn reports_functions_of_supertypes_in_key_order() {
    with_test_files(|projects, [main, ..]| {
        let class_key = test_class_key(main.0, 16);
        let mut unit = TestUnit::new(main);
        let class = unit.fragment.declare_layout(class_key);
        unit.fragment.define_layout(class, empty_layout(&class_key));
        for id in 0..16 {
            let supertype_key = test_class_key(main.0, id);
            let supertype = unit.fragment.declare_layout(supertype_key);
            let undefined = test_function_key(main.0, id + 1);
            let definition = Layout {
                constructor: Some(unit.fragment.declare_function(undefined)),
                ..empty_layout(&supertype_key)
            };
            unit.fragment.define_layout(supertype, definition);
            unit.fragment.add_supertype(class, supertype);
        }
        unit.define_body(|builder| {
            builder.new_object(class, &[], None, &[]);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        let undefined_keys = (1..=16).map(|id| test_function_key(main.0, id));
        let expected: Vec<(FunctionKey, FileId)> = undefined_keys.map(|key| (key, main)).collect();
        assert_eq!(marked.undefined_functions(), expected);
    });
}

#[test]
fn reports_direct_use_file() {
    with_test_files(|projects, [main, first, _]| {
        let key = test_class_key(main.0, 0);
        let tester = create_unit_with_tested_type(main, key, Type::layout);
        let allocator = create_unit_with_allocation(first, key);
        let fragments = [
            call_first_functions(tester, &[main, first]),
            allocator.finish(),
        ];

        let marked = mark_fragments(projects, fragments);

        assert_eq!(marked.undefined_layouts(), [(key, first)]);
    });
}

#[test]
fn reports_undefined_environment() {
    with_test_files(|projects, [main, first, _]| {
        let key = LayoutKey::Environment {
            file: main,
            environment: 0,
        };
        let referrer = create_unit_with_tested_type(first, key, Type::environment);
        let fragments = [
            call_first_functions(TestUnit::new(main), &[first]),
            referrer.finish(),
        ];

        let marked = mark_fragments(projects, fragments);

        assert_eq!(marked.undefined_layouts(), [(key, first)]);
    });
}
