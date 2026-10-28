use super::*;
use crate::link::key_context;
use crate::link::testing::{
    Projects, SHARED_NAME_IMPORTERS, find_synthetic_export, in_application, key_in, path_source,
    test_class_key, test_function_key, test_variable_key, with_projects,
    with_projects_without_bun_modules,
};
use bun_sema::program::FileId;
use bun_sema::session::Session;

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
        };
        for context in contexts(projects) {
            let importer = ProgramFile {
                project: context.project,
                file: importer,
            };
            let module = ProgramModule::External {
                importer,
                specifier,
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
    };
    let (first, second) = (RuntimeModule::NodeBuffer, RuntimeModule::NodePath);
    let (application, runtime) = (ProjectId::Application, ProjectId::Runtime);
    let inner = |file, callback| ProgramModule::Inner {
        file,
        callback: FnId(callback),
    };
    let modules_in_order = [
        file(application, 0),
        inner(in_project(application, 0), 1),
        inner(in_project(application, 0), 5),
        ProgramModule::Face(in_project(application, 0)),
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
