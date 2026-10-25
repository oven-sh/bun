mod layouts;
mod modules;

use super::*;
use crate::ir::generated::{
    Data, DataMember, DataNode, EvalBinding, EvalBindingKind, EvalScope, ExpectedResult, TypeSite,
    TypeSiteKind, Variable, VariableInitialization,
};
use crate::ir::{
    DeclaredType, FunctionId, FunctionKey, ModuleId, PropertyKey, StringId, Type, VariableId,
    VariableKey,
};
use crate::link::definitions::empty_layout;
use crate::link::key_context;
use crate::link::program_keys::ProgramVariableKey;
use crate::link::testing::{
    COMMON_JS_IMPORTER, Prepared, Projects, TestUnit, application_file, create_runtime_function,
    find_file, find_synthetic_export, forward, in_application, mark_prepared, prepare, reverse,
    test_class_key, test_function_key, test_object_type_key, test_variable_key, unit_in,
    with_projects_without_bun_modules, with_test_files,
};
use crate::load::ProjectId;
use crate::lower::{Fragment, FragmentBuilder};
use bun_sema::program::FileId;

struct Marked {
    prepared: Prepared,
    retained: Retained,
    errors: Vec<LinkError>,
}

impl Marked {
    fn has_function(&self, key: FunctionKey) -> bool {
        let merged = self.prepared.functions.find(&in_application(key));
        self.retained.functions[merged.expect("no unit declares the function") as usize]
    }

    fn has_source_function(&self, file: FileId, function: u32) -> bool {
        self.has_function(test_function_key(file.0, function))
    }

    fn has_layout(&self, key: LayoutKey) -> bool {
        let merged = self.prepared.layouts.find(&in_application(key));
        self.retained.layouts[merged.expect("no unit declares the layout") as usize]
    }

    fn has_program_variable(&self, key: ProgramVariableKey) -> bool {
        let merged = self.prepared.variables.find(&key);
        self.retained.variables[merged.expect("nothing declares the variable") as usize]
    }

    fn has_variable(&self, key: VariableKey) -> bool {
        self.has_program_variable(ProgramVariableKey::Declared(in_application(key)))
    }

    fn unit_marks(&self, file: FileId) -> &UnitMarks {
        let mut units = self.prepared.units.iter();
        let unit = units.position(|unit| unit.file == application_file(file));
        &self.retained.units[unit.expect("the file has no unit")]
    }

    fn undefined_functions(&self) -> Vec<(FunctionKey, FileId)> {
        let errors = self.errors.iter().map(|error| match error {
            LinkError::UndefinedFunction { key, referenced_in } => (key.key, referenced_in.file),
            other => panic!("{other:?}"),
        });
        errors.collect()
    }

    fn undefined_layouts(&self) -> Vec<(LayoutKey, FileId)> {
        let errors = self.errors.iter().map(|error| match error {
            LinkError::UndefinedLayout { key, referenced_in } => (key.key, referenced_in.file),
            other => panic!("{other:?}"),
        });
        errors.collect()
    }

    fn undefined_variables(&self) -> Vec<(ProgramVariableKey, FileId)> {
        let errors = self.errors.iter().map(|error| match error {
            LinkError::UndefinedVariable { key, referenced_in } => (*key, referenced_in.file),
            other => panic!("{other:?}"),
        });
        errors.collect()
    }
}

fn mark_fragments<const COUNT: usize>(
    projects: &Projects<'_, '_>,
    fragments: [Fragment; COUNT],
) -> Marked {
    let units = fragments.map(|fragment| unit_in(projects, ProjectId::Application, fragment));
    let prepared = prepare(units.into(), projects);
    assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
    let mut errors = Vec::new();
    let retained = mark_prepared(&prepared, projects, &forward, &mut errors);
    Marked {
        prepared,
        retained,
        errors,
    }
}

fn declared_key(key: VariableKey) -> ProgramVariableKey {
    ProgramVariableKey::Declared(in_application(key))
}

fn create_type_site(module: ModuleId, text: StringId) -> TypeSite {
    TypeSite {
        module,
        position: 0,
        kind: TypeSiteKind::Assertion,
        text: Some(text),
    }
}

fn create_function_variable(module: ModuleId, ty: TypeId, function: FunctionId) -> Variable {
    Variable {
        module,
        declared: DeclaredType::from_compiler(ty),
        initialization: VariableInitialization::Function,
        function: Some(function),
        ..Variable::default()
    }
}

fn define_plain_variable(unit: &mut TestUnit, symbol: u32) -> VariableId {
    let id = unit
        .fragment
        .declare_variable(test_variable_key(unit.file.0, symbol));
    let variable = Variable {
        module: unit.module,
        declared: DeclaredType::untyped(),
        ..Variable::default()
    };
    unit.fragment.define_variable(id, variable);
    id
}

fn intern_text_key(fragment: &mut FragmentBuilder, text: &[u8]) -> (PropertyKeyId, StringId) {
    let text = fragment.strings.intern(text);
    (
        fragment.property_keys.intern(PropertyKey::from_text(text)),
        text,
    )
}

fn create_eval_scope(variable: VariableId) -> EvalScope {
    EvalScope {
        bindings: vec![EvalBinding {
            kind: EvalBindingKind::Variable,
            variable: Some(variable),
            ..EvalBinding::default()
        }],
        ..EvalScope::default()
    }
}

#[test]
fn drops_uncalled_function() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let module = unit.module;
        let [g_string, g_text, h_string, h_text] = ["g string", "g text", "h string", "h text"]
            .map(|text| unit.fragment.strings.intern(text.as_bytes()));
        let g_site = unit
            .fragment
            .add_type_site(create_type_site(module, g_text));
        let h_site = unit
            .fragment
            .add_type_site(create_type_site(module, h_text));
        let g = unit.define_function(2, |builder| {
            let value = builder.string(g_string);
            builder.check(value, TypeTable::NUMBER, Some(g_site));
        });
        let f = unit.define_function(1, |builder| {
            builder.call_direct(g, &[]);
        });
        unit.define_function(3, |builder| {
            let value = builder.string(h_string);
            builder.check(value, TypeTable::NUMBER, Some(h_site));
        });
        unit.define_body(|builder| {
            builder.call_direct(f, &[]);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_function(FunctionKey::ModuleBody(main)));
        assert!(marked.has_source_function(main, 1));
        assert!(marked.has_source_function(main, 2));
        assert!(!marked.has_source_function(main, 3));
        let marks = marked.unit_marks(main);
        assert!(marks.strings[g_string.index()]);
        assert!(marks.strings[g_text.index()]);
        assert!(marks.type_sites[g_site.index()]);
        assert!(!marks.strings[h_string.index()]);
        assert!(!marks.strings[h_text.index()]);
        assert!(!marks.type_sites[h_site.index()]);
    });
}

#[test]
fn retains_cross_unit_callee() {
    with_test_files(|projects, [main, first, _]| {
        let mut caller = TestUnit::new(main);
        let callee = caller.declare_function(first, 0);
        caller.define_body(|builder| {
            builder.call_direct(callee, &[]);
        });
        let mut home = TestUnit::new(first);
        let string = home.fragment.strings.intern(b"callee");
        home.define_function(0, |builder| {
            builder.string(string);
        });
        home.define_function(1, |_| {});

        let marked = mark_fragments(projects, [caller.finish(), home.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_source_function(first, 0));
        assert!(marked.unit_marks(first).strings[string.index()]);
        assert!(!marked.has_source_function(first, 1));
    });
}

#[test]
fn order_of_units_does_not_change_marks() {
    with_test_files(|projects, [main, first, second]| {
        let mut units = [main, first, second].map(TestUnit::new);
        let files = [main, first, second];
        let undefined_key = test_function_key(second.0, 9);
        for (position, unit) in units.iter_mut().enumerate() {
            let next = files[(position + 1) % files.len()];
            let callee = unit.fragment.declare_function(test_function_key(next.0, 1));
            let undefined = unit.fragment.declare_function(undefined_key);
            let string = unit.fragment.strings.intern(b"retained");
            unit.fragment.strings.intern(b"dropped");
            unit.define_function(1, |builder| {
                builder.string(string);
                builder.call_direct(undefined, &[]);
            });
            unit.define_function(2, |_| {});
            unit.define_body(|builder| {
                builder.call_direct(callee, &[]);
            });
        }
        let units = units.map(|unit| unit_in(projects, ProjectId::Application, unit.finish()));
        let prepared = prepare(units.into(), projects);
        let (mut errors, mut errors_in_reverse) = (Vec::new(), Vec::new());
        let retained = mark_prepared(&prepared, projects, &forward, &mut errors);
        let in_reverse = mark_prepared(&prepared, projects, &reverse, &mut errors_in_reverse);

        assert_eq!(retained.functions, in_reverse.functions);
        assert_eq!(retained.layouts, in_reverse.layouts);
        assert_eq!(retained.variables, in_reverse.variables);
        for (marks, marks_in_reverse) in retained.units.iter().zip(&in_reverse.units) {
            assert_eq!(marks.strings, marks_in_reverse.strings);
            assert_eq!(marks.types, marks_in_reverse.types);
        }
        assert_eq!(format!("{errors:?}"), format!("{errors_in_reverse:?}"));
        let [LinkError::UndefinedFunction { key, referenced_in }] = &errors[..] else {
            panic!("{errors:?}");
        };
        let first_referrer = files.into_iter().min().unwrap();
        assert_eq!(
            (key.key, referenced_in.file),
            (undefined_key, first_referrer)
        );
    });
}

#[test]
fn reports_undefined_function() {
    with_test_files(|projects, [main, first, _]| {
        let undefined_key = test_function_key(first.0, 9);
        let mut caller = TestUnit::new(main);
        let undefined = caller.fragment.declare_function(undefined_key);
        caller.define_body(|builder| {
            builder.call_direct(undefined, &[]);
        });

        let marked = mark_fragments(projects, [caller.finish(), TestUnit::new(first).finish()]);

        assert_eq!(marked.undefined_functions(), [(undefined_key, main)]);
    });
}

#[test]
fn retains_runtime_function() {
    with_test_files(|projects, [_, first, _]| {
        let mut library = TestUnit::new(first);
        let root = library.define_function(0, |_| {});
        library.define_function(1, |_| {});
        library
            .fragment
            .add_runtime_function(create_runtime_function(0, root));

        let marked = mark_fragments(projects, [library.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_source_function(first, 0));
        assert!(!marked.has_source_function(first, 1));
    });
}

#[test]
fn reports_undefined_runtime_function() {
    with_test_files(|projects, [main, first, _]| {
        let undefined_key = test_function_key(main.0, 9);
        let mut library = TestUnit::new(first);
        let undefined = library.fragment.declare_function(undefined_key);
        let entry = create_runtime_function(0, undefined);
        library.fragment.add_runtime_function(entry);

        let marked = mark_fragments(projects, [library.finish()]);

        assert_eq!(marked.undefined_functions(), [(undefined_key, first)]);
    });
}

#[test]
fn reports_undefined_variable() {
    with_test_files(|projects, [main, first, _]| {
        let undefined_key = test_variable_key(first.0, 9);
        let mut reader = TestUnit::new(main);
        let undefined = reader.fragment.declare_variable(undefined_key);
        reader.define_body(|builder| {
            builder.get_module_variable(undefined);
        });

        let marked = mark_fragments(projects, [reader.finish()]);

        let expected = [(declared_key(undefined_key), main)];
        assert_eq!(marked.undefined_variables(), expected);
    });
}

#[test]
fn variable_keeps_its_function_and_type() {
    with_test_files(|projects, [main, ..]| {
        let [read_key, unread_key] = [0, 1].map(|symbol| test_variable_key(main.0, symbol));
        let mut unit = TestUnit::new(main);
        let module = unit.module;
        let read_function = unit.define_function(1, |_| {});
        let unread_function = unit.define_function(2, |_| {});
        let literal = unit.fragment.strings.intern(b"literal");
        let declared = unit.fragment.types.intern(Type::string_literal(literal));
        let read = unit.fragment.declare_variable(read_key);
        let unread = unit.fragment.declare_variable(unread_key);
        let read_variable = create_function_variable(module, declared, read_function);
        unit.fragment.define_variable(read, read_variable);
        let unread_variable =
            create_function_variable(module, TypeTable::ANYTHING, unread_function);
        unit.fragment.define_variable(unread, unread_variable);
        unit.define_body(|builder| {
            builder.get_module_variable(read);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_variable(read_key));
        assert!(marked.has_source_function(main, 1));
        assert!(marked.unit_marks(main).types[declared.index()]);
        assert!(marked.unit_marks(main).strings[literal.index()]);
        assert!(!marked.has_variable(unread_key));
        assert!(!marked.has_source_function(main, 2));
    });
}

#[test]
fn retains_read_synthetic_export() {
    with_projects_without_bun_modules(&COMMON_JS_IMPORTER, |projects| {
        let application = ProjectId::Application;
        let keys = [&b"a"[..], b"b"].map(|name| {
            VariableKey::SyntheticExport(find_synthetic_export(projects, application, name))
        });
        let mut unit = TestUnit::new(find_file(projects, "main.js"));
        let [read, unread] = keys.map(|key| unit.fragment.declare_variable(key));
        unit.define_body(|builder| {
            builder.get_module_variable(read);
        });
        unit.define_function(1, |builder| {
            builder.get_module_variable(unread);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let context = key_context(projects, application);
        let [read_key, unread_key] = keys.map(|key| context.variable_key(key));
        assert!(marked.has_program_variable(read_key));
        assert!(!marked.has_program_variable(unread_key));
    });
}

#[test]
fn retains_eval_scope_bindings() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let [bound, unbound] = [0, 1].map(|symbol| define_plain_variable(&mut unit, symbol));
        let retained_scope = unit.fragment.add_eval_scope(create_eval_scope(bound));
        let dropped_scope = unit.fragment.add_eval_scope(create_eval_scope(unbound));
        unit.define_body(|builder| {
            let text = builder.undefined();
            builder.direct_eval(retained_scope, text, text, None, &[]);
        });
        unit.define_function(1, |builder| {
            let text = builder.undefined();
            builder.direct_eval(dropped_scope, text, text, None, &[]);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let marks = marked.unit_marks(main);
        assert!(marks.eval_scopes[retained_scope.index()]);
        assert!(marked.has_variable(test_variable_key(main.0, 0)));
        assert!(!marks.eval_scopes[dropped_scope.index()]);
        assert!(!marked.has_variable(test_variable_key(main.0, 1)));
    });
}

#[test]
fn property_key_keeps_its_owner_layout() {
    with_test_files(|projects, [main, ..]| {
        let class_keys = [0, 1].map(|class| test_class_key(main.0, class));
        let mut unit = TestUnit::new(main);
        let names = ["#read", "#unread"].map(|name| unit.fragment.strings.intern(name.as_bytes()));
        let mut private_names = Vec::new();
        for (class_key, name) in class_keys.into_iter().zip(names) {
            let owner = unit.fragment.declare_layout(class_key);
            unit.fragment.define_layout(owner, empty_layout(&class_key));
            let key = PropertyKey::from_private_name(name, owner);
            private_names.push(unit.fragment.property_keys.intern(key));
        }
        let (read, unread) = (private_names[0], private_names[1]);
        unit.define_body(|builder| {
            let object = builder.undefined();
            builder.prop_get(object, read, false, false);
        });
        unit.define_function(1, |builder| {
            let object = builder.undefined();
            builder.prop_get(object, unread, false, false);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let marks = marked.unit_marks(main);
        assert!(marks.property_keys[read.index()]);
        assert!(marks.strings[names[0].index()]);
        assert!(marked.has_layout(class_keys[0]));
        assert!(!marks.property_keys[unread.index()]);
        assert!(!marks.strings[names[1].index()]);
        assert!(!marked.has_layout(class_keys[1]));
    });
}

#[test]
fn data_record_keeps_its_layout() {
    with_test_files(|projects, [main, ..]| {
        let layout_keys = [1, 2].map(test_object_type_key);
        let mut unit = TestUnit::new(main);
        let module = unit.module;
        let (key, key_text) = intern_text_key(&mut unit.fragment, b"member");
        let value = unit.fragment.strings.intern(b"value");
        let records = layout_keys.map(|layout_key| {
            let layout = unit.fragment.declare_layout(layout_key);
            let member = DataMember {
                key,
                value: DataNode::String { value },
            };
            unit.fragment.add_data(Data {
                root: DataNode::Object {
                    layout,
                    members: vec![member],
                },
                module: Some(module),
            })
        });
        unit.define_body(|builder| {
            builder.data(records[0]);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let marks = marked.unit_marks(main);
        assert_eq!(marks.data, [true, false]);
        assert!(marks.property_keys[key.index()]);
        assert!(marks.strings[key_text.index()]);
        assert!(marks.strings[value.index()]);
        assert!(marked.has_layout(layout_keys[0]));
        assert!(!marked.has_layout(layout_keys[1]));
    });
}

#[test]
fn expected_result_keeps_its_layouts() {
    with_test_files(|projects, [main, ..]| {
        let layout_keys = [1, 2].map(test_object_type_key);
        let mut unit = TestUnit::new(main);
        let mut expected_results = Vec::new();
        for layout_key in layout_keys {
            let layout = unit.fragment.declare_layout(layout_key);
            let expected = ExpectedResult {
                ty: TypeTable::OBJECT,
                layouts: vec![layout],
            };
            expected_results.push(unit.fragment.add_expected_result(expected));
        }
        let (retained, dropped) = (expected_results[0], expected_results[1]);
        unit.define_body(|builder| {
            let callee = builder.undefined();
            builder.call(callee, None, &[], None, None, Some(retained), false, false);
        });
        unit.define_function(1, |builder| {
            let callee = builder.undefined();
            builder.call(callee, None, &[], None, None, Some(dropped), false, false);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let marks = marked.unit_marks(main);
        assert_eq!(marks.expected_results, [true, false]);
        assert!(marked.has_layout(layout_keys[0]));
        assert!(!marked.has_layout(layout_keys[1]));
    });
}

#[test]
fn marks_well_known_types() {
    with_test_files(|projects, [main, first, _]| {
        let fragments = [main, first].map(|file| {
            let mut unit = TestUnit::new(file);
            unit.define_body(|_| {});
            unit.finish()
        });

        let marked = mark_fragments(projects, fragments);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        let well_known = &marked.retained.units[0].types[..TypeTable::WELL_KNOWN_COUNT];
        assert!(well_known.iter().all(|&is_marked| is_marked));
        assert!(!marked.retained.units[1].types[TypeTable::BIGINT.index()]);
    });
}
