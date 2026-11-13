use super::*;
use crate::ir::{ClassSlot, PrivateStatePart};
use crate::link::key_context;
use crate::link::testing::{
    Projects, SHARED_NAME_IMPORTERS, application_file, find_synthetic_export, in_application,
    key_in, path_source, test_class_key, test_function_key, test_variable_key, with_projects,
    with_projects_without_bun_modules,
};
use crate::modules::SyntheticExportId;
use bun_sema::bind::{CommonJsVariable, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, ExprId, FnId, MemberId, TypeNodeId};
use bun_sema::program::{FileId, Sym};
use bun_sema::session::Session;
use core::fmt::Debug;
use core::iter::successors;

const EMPTY_PROGRAM: [(&str, &str); 1] = [("main.js", "export {};\n")];

fn contexts<'a>(projects: &Projects<'a, '_>) -> [KeyContext<'a>; ProjectId::COUNT] {
    ProjectId::ALL.map(|project| key_context(projects, project))
}

#[test]
fn equal_keys_of_two_projects_differ() {
    with_projects_without_bun_modules(&EMPTY_PROGRAM, |projects| {
        let [application, runtime] = contexts(projects);
        let function = test_function_key(3, 1);
        let layout = test_class_key(3, 1);
        let variable = test_variable_key(3, 1);
        let module = ModuleRef::File(FileId(3));

        assert_eq!(application.function_key(function), in_application(function));
        assert_eq!(application.layout_key(layout), in_application(layout));
        let declared = ProgramVariableKey::Declared(in_application(variable));
        assert_eq!(application.variable_key(variable), declared);

        assert_ne!(
            application.function_key(function),
            runtime.function_key(function)
        );
        assert_ne!(application.layout_key(layout), runtime.layout_key(layout));
        assert_ne!(
            application.variable_key(variable),
            runtime.variable_key(variable)
        );
        assert_ne!(application.module(module), runtime.module(module));
    });
}

#[test]
fn keys_order_by_project_first() {
    let application = in_application(test_function_key(9, 0));
    let runtime = key_in(ProjectId::Runtime, test_function_key(0, 0));
    assert!(application.key > runtime.key);
    assert!(application < runtime);
}

#[test]
fn bun_module_with_source_is_its_file() {
    with_projects(&[("main.js", "import 'node:path';\n")], |projects| {
        let file = path_source(projects);
        let source = ProgramModule::File(file);
        let [application, runtime] = contexts(projects);
        let named = ModuleRef::Runtime(RuntimeModule::NodePath);
        assert_eq!(application.module(named), source);
        assert_eq!(runtime.module(named), source);
        assert_eq!(runtime.module(ModuleRef::File(file.file)), source);
    });
}

#[test]
fn native_bun_module_stays_runtime() {
    with_projects(&[("main.js", "import 'node:buffer';\n")], |projects| {
        let named = ModuleRef::Runtime(RuntimeModule::NodeBuffer);
        for context in contexts(projects) {
            let module = ProgramModule::Runtime(RuntimeModule::NodeBuffer);
            assert_eq!(context.module(named), module);
        }
    });
}

#[test]
fn synthetic_export_is_named_by_module_and_name() {
    with_projects(&SHARED_NAME_IMPORTERS, |projects| {
        let key_of = |project, name: &[u8]| {
            let id = find_synthetic_export(projects, project, name);
            key_context(projects, project).variable_key(VariableKey::SyntheticExport(id))
        };
        let shared = key_of(ProjectId::Application, b"shared");
        assert_eq!(key_of(ProjectId::Runtime, b"shared"), shared);
        assert_ne!(key_of(ProjectId::Runtime, b"own"), shared);

        let ProgramVariableKey::SyntheticExport { module, name } = shared else {
            panic!("{shared:?}");
        };
        assert_eq!(module, ProgramModule::File(path_source(projects)));
        let atoms = &projects.application.loaded.files().atoms;
        assert_eq!(atoms.bytes(name), b"shared");
    });
}

#[test]
fn external_keeps_its_importers_project() {
    with_projects_without_bun_modules(&EMPTY_PROGRAM, |projects| {
        let specifier = projects.application.loaded.files().atoms.intern(b"package");
        let importer = FileId(4);
        let external = ModuleRef::External {
            importer,
            specifier,
            type_attribute: None,
        };
        for context in contexts(projects) {
            let importer = ProgramFile {
                project: context.project,
                file: importer,
            };
            let module = ProgramModule::External {
                importer,
                specifier,
                type_attribute: None,
            };
            assert_eq!(context.module(external), module);
        }
    });
}

#[test]
fn modules_order_by_variant_project_file() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let [specifier_b, specifier_a] = [&b"b"[..], b"a"].map(|text| atoms.intern(text));
    let in_project = |project, file| ProgramFile {
        project,
        file: FileId(file),
    };
    let file = |project, file| ProgramModule::File(in_project(project, file));
    let external = |importer, specifier| ProgramModule::External {
        importer,
        specifier,
        type_attribute: None,
    };
    let (first, second) = (RuntimeModule::NodeBuffer, RuntimeModule::NodePath);
    let (application, runtime) = (ProjectId::Application, ProjectId::Runtime);
    let inner = |callback| ProgramModule::Inner {
        file: in_project(application, 0),
        callback: FnId(callback),
    };
    let modules_in_order = [
        file(application, 0),
        inner(1),
        inner(4),
        ProgramModule::Facade(in_project(application, 0)),
        ProgramModule::Check(in_project(application, 0)),
        file(application, 9),
        file(runtime, 0),
        file(runtime, 1),
        ProgramModule::Runtime(first.min(second)),
        ProgramModule::Runtime(first.max(second)),
        external(in_project(application, 2), specifier_a),
        external(in_project(application, 2), specifier_b),
        external(in_project(application, 3), specifier_a),
        external(in_project(runtime, 0), specifier_a),
    ];
    for (left_index, &left) in modules_in_order.iter().enumerate() {
        for (right_index, &right) in modules_in_order.iter().enumerate() {
            let order = compare_program_modules(left, right, &atoms);
            assert_eq!(order, left_index.cmp(&right_index), "{left:?} {right:?}");
        }
    }
}

const FILE: FileId = FileId(1);
const SYMBOL: Sym = Sym {
    file: FILE,
    id: SymbolId(1),
};
const CLASS: ClassRef = ClassRef {
    file: FILE,
    class: ClassId(1),
};
const FUNCTION: FunctionRef = FunctionRef {
    file: FILE,
    function: FnId(1),
};

// Each of the next three functions leads from a key of one variant to a key of the variant declared after it. They
// name every variant, so a new variant does not compile until it is part of the chain.
fn next_function_key(key: FunctionKey) -> Option<FunctionKey> {
    let (file, member) = (FILE, MemberId(1));
    Some(match key {
        FunctionKey::ModuleBody(_) => FunctionKey::WrappedModuleBody(FILE),
        FunctionKey::WrappedModuleBody(_) => FunctionKey::FacadeBody(FILE),
        FunctionKey::FacadeBody(_) => FunctionKey::CheckBody(FILE),
        FunctionKey::CheckBody(_) => FunctionKey::Instantiation(FILE),
        FunctionKey::Instantiation(_) => FunctionKey::Source(FUNCTION),
        FunctionKey::Source(_) => FunctionKey::Signature(FUNCTION),
        FunctionKey::Signature(_) => FunctionKey::ClassSignature(CLASS),
        FunctionKey::ClassSignature(_) => FunctionKey::ImplicitConstructor(CLASS),
        FunctionKey::ImplicitConstructor(_) => FunctionKey::InstanceInitializer(CLASS),
        FunctionKey::InstanceInitializer(_) => FunctionKey::StaticInitializer(CLASS),
        FunctionKey::StaticInitializer(_) => FunctionKey::AccessorGetter { file, member },
        FunctionKey::AccessorGetter { .. } => FunctionKey::AccessorSetter { file, member },
        FunctionKey::AccessorSetter { .. } => FunctionKey::PrivateNameTest { file, member },
        FunctionKey::PrivateNameTest { .. } => {
            let call = ExprId(1);
            FunctionKey::ModuleRequest { file, call }
        }
        FunctionKey::ModuleRequest { .. } => {
            let (helper, getter) = (FnId(1), FnId(1));
            FunctionKey::CopiedGetter {
                file,
                helper,
                getter,
            }
        }
        FunctionKey::CopiedGetter { .. } => FunctionKey::PrototypeMaker(SYMBOL),
        FunctionKey::PrototypeMaker(_) => return None,
    })
}

fn next_layout_key(key: LayoutKey) -> Option<LayoutKey> {
    let (file, node) = (FILE, TypeNodeId(1));
    let object_type = |origin| LayoutKey::ObjectType {
        origin,
        instantiation: TypeIdentity([1, 1]),
    };
    Some(match key {
        LayoutKey::Class(_) => LayoutKey::ConstructorFunction(FUNCTION),
        LayoutKey::ConstructorFunction(_) => LayoutKey::Library(ClassDeclaration::Class(CLASS)),
        LayoutKey::Library(_) => object_type(ObjectOrigin::Symbol(SYMBOL)),
        LayoutKey::ObjectType { origin, .. } => match origin {
            ObjectOrigin::Symbol(_) => object_type(ObjectOrigin::TypeLiteral { file, node }),
            ObjectOrigin::TypeLiteral { .. } => {
                object_type(ObjectOrigin::MappedType { file, node })
            }
            ObjectOrigin::MappedType { .. } => object_type(ObjectOrigin::ObjectLiteral {
                file,
                expression: ExprId(1),
            }),
            ObjectOrigin::ObjectLiteral { .. } => object_type(ObjectOrigin::Computed),
            ObjectOrigin::Computed => LayoutKey::UntypedLiteral {
                file,
                members: TypeIdentity([1, 1]),
            },
        },
        LayoutKey::UntypedLiteral { .. } => LayoutKey::CreatedObject { file, call: 1 },
        LayoutKey::CreatedObject { .. } => LayoutKey::PrototypeMaker(SYMBOL),
        LayoutKey::PrototypeMaker(_) => LayoutKey::Container(SYMBOL),
        LayoutKey::Container(_) => LayoutKey::Environment {
            file,
            environment: 1,
        },
        LayoutKey::Environment { .. } => LayoutKey::ModuleInstance(FILE),
        LayoutKey::ModuleInstance(_) => return None,
    })
}

fn next_variable_key(key: VariableKey) -> Option<VariableKey> {
    Some(match key {
        VariableKey::Symbol(_) => VariableKey::SyntheticExport(SyntheticExportId(1)),
        VariableKey::SyntheticExport(_) => VariableKey::Copy(SyntheticExportId(1)),
        VariableKey::Copy(_) => VariableKey::ModuleExports(FILE),
        VariableKey::ModuleExports(_) => VariableKey::InnerModuleExports(FUNCTION),
        VariableKey::InnerModuleExports(_) => VariableKey::ClassSlot {
            class: CLASS,
            slot: ClassSlot::ClassObject,
        },
        VariableKey::ClassSlot { .. } => VariableKey::ModulePath {
            file: FILE,
            variable: CommonJsVariable::Module,
        },
        VariableKey::ModulePath { .. } => VariableKey::PrivateState {
            state: SYMBOL,
            part: PrivateStatePart::Collection,
        },
        VariableKey::PrivateState { .. } => VariableKey::RequiredAnswer(SYMBOL),
        VariableKey::RequiredAnswer(_) => VariableKey::MockOf(FILE),
        VariableKey::MockOf(_) => VariableKey::InstantiationState(FILE),
        VariableKey::InstantiationState(_) => VariableKey::EnvironmentMadeAhead(FILE),
        VariableKey::EnvironmentMadeAhead(_) => {
            VariableKey::MockOfRuntimeModule(RuntimeModule::NodePath)
        }
        VariableKey::MockOfRuntimeModule(_) => VariableKey::RequiresMadeForOwnFile(FILE),
        VariableKey::RequiresMadeForOwnFile(_) => VariableKey::RequiresMadeForOtherFolders(FILE),
        VariableKey::RequiresMadeForOtherFolders(_) => VariableKey::RequiresMadeForPaths(FILE),
        VariableKey::RequiresMadeForPaths(_) => VariableKey::InstanceOf(FILE),
        VariableKey::InstanceOf(_) => VariableKey::InstanceAllocator(FILE),
        VariableKey::InstanceAllocator(_) => VariableKey::HasSeveralInstances(FILE),
        VariableKey::HasSeveralInstances(_) => VariableKey::EvaluationMark(FILE),
        VariableKey::EvaluationMark(_) => VariableKey::AddedStatic(SYMBOL),
        VariableKey::AddedStatic(_) => VariableKey::PrototypeMaker(SYMBOL),
        VariableKey::PrototypeMaker(_) => return None,
    })
}

fn assert_ranks_follow_order<K: OrderedKey + Debug>(keys_in_order: &[K]) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    for (left_index, left) in keys_in_order.iter().enumerate() {
        for (right_index, right) in keys_in_order.iter().enumerate() {
            let order = left_index.cmp(&right_index);
            assert_eq!(left.compare(right, &atoms), order, "{left:?} {right:?}");
            assert_eq!(left.rank().cmp(&right.rank()), order, "{left:?} {right:?}");
        }
    }
}

#[test]
fn variant_ranks_follow_declarations() {
    let functions = successors(Some(FunctionKey::ModuleBody(FILE)), |&key| {
        next_function_key(key)
    });
    assert_ranks_follow_order(&functions.map(in_application).collect::<Vec<_>>());
    let layouts = successors(Some(LayoutKey::Class(CLASS)), |&key| next_layout_key(key));
    assert_ranks_follow_order(&layouts.map(in_application).collect::<Vec<_>>());
    let variables = successors(Some(VariableKey::Symbol(SYMBOL)), |&key| {
        next_variable_key(key)
    });
    let variables = variables.map(|key| ProgramVariableKey::Declared(in_application(key)));
    assert_ranks_follow_order(&variables.collect::<Vec<_>>());
}

#[test]
fn variable_keys_order_the_same_whichever_name_is_interned_first() {
    let interning_orders: [[&[u8]; 2]; 2] = [[b"apple", b"pear"], [b"pear", b"apple"]];
    for names in interning_orders {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let [earlier, later] = names.map(|name| atoms.intern(name));
        assert!(earlier.0 < later.0);
        let (apple, pear) = (atoms.intern(b"apple"), atoms.intern(b"pear"));

        let file = |file| ProgramModule::File(application_file(FileId(file)));
        let external = |specifier| ProgramModule::External {
            importer: application_file(FileId(0)),
            specifier,
            type_attribute: None,
        };
        let export = |module, name| ProgramVariableKey::SyntheticExport { module, name };
        let copy = |module, name| ProgramVariableKey::Copy { module, name };
        let (first, second) = (RuntimeModule::NodeBuffer, RuntimeModule::NodePath);
        let keys_in_order = [
            ProgramVariableKey::Declared(in_application(test_variable_key(1, 1))),
            ProgramVariableKey::Declared(in_application(test_variable_key(2, 2))),
            ProgramVariableKey::Declared(key_in(ProjectId::Runtime, test_variable_key(0, 0))),
            export(file(0), apple),
            export(file(0), pear),
            export(file(1), apple),
            export(external(apple), pear),
            export(external(pear), apple),
            copy(file(0), apple),
            copy(file(0), pear),
            copy(file(1), apple),
            ProgramVariableKey::MockOfRuntimeModule(first.min(second)),
            ProgramVariableKey::MockOfRuntimeModule(first.max(second)),
        ];
        for (left_index, left) in keys_in_order.iter().enumerate() {
            for (right_index, right) in keys_in_order.iter().enumerate() {
                let order = compare_program_variable_keys(*left, *right, &atoms);
                assert_eq!(order, left_index.cmp(&right_index), "{left:?} {right:?}");
                assert_eq!(left.compare(right, &atoms), order);
            }
        }
    }
}
