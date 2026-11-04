use super::*;
use crate::builtins::BuiltinId;
use crate::modules::testing::{
    file_named, member_named, symbol_named, with_graph, with_test_run_graph,
};
use crate::modules::{
    ExportBinding, ExportLookup, FailureEffect, Member, ModuleFailure, ModuleGraph, Shape,
    SiteAnswer, SyntheticExport, SyntheticExportId, View,
};

const ELEMENT: &str = "export const element = <div />;";
const UNCOMPILED_MODULE: &str = "https://example.com/z.js";

struct BoundProgram<'a, 'i, 's> {
    graph: &'a ModuleGraph,
    input: &'a BindInput<'i, 's>,
}

fn with_program(files: &[(&str, &str)], check: impl FnOnce(&BoundProgram<'_, '_, '_>)) {
    with_graph(files, |graph, input| check(&BoundProgram { graph, input }));
}

/// The first file is the test file that the runner starts.
fn with_test_run(files: &[(&str, &str)], check: impl FnOnce(&BoundProgram<'_, '_, '_>)) {
    with_test_run_graph(files, |graph, input| check(&BoundProgram { graph, input }));
}

impl BoundProgram<'_, '_, '_> {
    fn file(&self, name: &str) -> FileId {
        file_named(self.input, name)
    }

    fn module(&self, name: &str) -> ModuleRef {
        ModuleRef::File(self.file(name))
    }

    fn external(&self, importer: &str, specifier: &str) -> ModuleRef {
        ModuleRef::External {
            importer: self.file(importer),
            specifier: self.atom(specifier),
            type_attribute: None,
        }
    }

    fn atom(&self, text: &str) -> Atom {
        self.input.files.atoms.intern(text.as_bytes())
    }

    fn namespace(&self, name: &str, phase: ImportPhase) -> ImportBinding {
        let module = self.module(name);
        ImportBinding::Namespace { module, phase }
    }

    fn find_export(&self, file: &str, name: &str) -> ExportLookup {
        let atoms = &self.input.files.atoms;
        self.graph
            .find_export(self.module(file), self.atom(name), atoms)
    }

    fn binding(&self, file: &str, local_name: &str) -> ImportBinding {
        let file = self.file(file);
        let symbol = symbol_named(self.input, file, local_name);
        self.graph.import_binding(file, symbol)
    }

    fn exported_symbol(&self, file: &str, name: &str) -> Sym {
        let file = self.file(file);
        let bound = self.input.files.bound(file);
        let exports = bound.symbol(bound.file_symbol).exports;
        let id = bound.lookup(exports, self.atom(name));
        let id = id.expect("the file does not export the name");
        Sym { file, id }
    }

    fn exported_variable(&self, file: &str, name: &str) -> ImportBinding {
        ImportBinding::Variable(self.exported_symbol(file, name))
    }

    fn synthetic_id(&self, file: &str, local_name: &str) -> SyntheticExportId {
        match self.binding(file, local_name) {
            ImportBinding::Synthetic(id) => id,
            binding => panic!("{local_name} is bound to {binding:?}"),
        }
    }

    fn synthetic_export(&self, file: &str, local_name: &str) -> &SyntheticExport {
        self.graph
            .synthetic_export(self.synthetic_id(file, local_name))
    }

    fn required_names(&self, file: &str) -> &[RequiredName] {
        self.graph.required_names(self.file(file))
    }

    /// `export { name as export_name } from "specifier"` asks for the name.
    fn exported(&self, name: RequiredName, export_name: &str, specifier: &str) -> RequiredName {
        RequiredName {
            asked_by: Some(ExportStatement {
                export_name: self.atom(export_name),
                specifier: self.atom(specifier),
            }),
            ..name
        }
    }

    fn errors_of(&self, importer: &str) -> Vec<&ModuleFailure> {
        let importer = self.file(importer);
        let errors = self.graph.errors().iter();
        errors.filter(|error| error.importer == importer).collect()
    }

    fn runtime_module(&self, file: &str, statement: u32) -> RuntimeModule {
        let site = ImportSiteKind::Import(ImportId(statement));
        match self.graph.site_answer(self.file(file), site) {
            SiteAnswer::Module(ModuleRef::Runtime(module)) => module,
            answer => panic!("statement {statement} imports {answer:?}"),
        }
    }

    fn listed_export(&self, module: RuntimeModule, name: &str) -> BuiltinId {
        let namespace = table::canonical_id(table::namespace_of(module));
        let name = self.input.builtin_names.get(self.atom(name));
        let name = name.expect("the table of built-ins has no such name");
        let member = table::own_member(namespace, name);
        member.expect("the table does not list the export")
    }

    fn captured_export(&self, module: RuntimeModule, name: &str) -> ImportBinding {
        let member = self.listed_export(module, name);
        let (module, name) = (ModuleRef::Runtime(module), self.atom(name));
        let mut exports = self.graph.synthetic_exports().iter();
        let index = exports.position(|export| export.module == module && export.name == name);
        let index = index.expect("the export is not captured");
        let export = SyntheticExportId(u32::try_from(index).expect("too many synthetic exports"));
        ImportBinding::CapturedBuiltin { member, export }
    }

    fn count_synthetic_exports(&self, module: ModuleRef) -> usize {
        let exports = self.graph.synthetic_exports().iter();
        exports.filter(|export| export.module == module).count()
    }
}

#[test]
fn named_import_binds_exporting_declaration() {
    let main = "
        import { a } from './es.js';
        import { a as indirect } from './indirect.js';
        import { a as star } from './star.js';
        import { a as local } from './local.js';
        import * as ns from './es.js';
    ";
    let files = [
        ("main.js", main),
        ("es.js", "export const a = 1;"),
        ("indirect.js", "export { a } from './es.js';"),
        ("star.js", "export * from './es.js';"),
        ("local.js", "import { a } from './es.js'; export { a };"),
    ];
    with_program(&files, |program| {
        let variable = program.exported_variable("es.js", "a");
        for local_name in ["a", "indirect", "star", "local"] {
            let binding = program.binding("main.js", local_name);
            assert_eq!(binding, variable, "{local_name}");
        }
        let namespace = program.namespace("es.js", ImportPhase::Evaluation);
        assert_eq!(program.binding("main.js", "ns"), namespace);
        assert!(program.required_names("main.js").is_empty());
    });
}

#[test]
fn commonjs_names_are_synthetic_exports() {
    let main = "
        import d, { x, Z } from './c.cjs';
        import { x as other } from './other.cjs';
        import './second.js';
    ";
    let files = [
        ("main.js", main),
        ("second.js", "import { x } from './c.cjs';"),
        ("c.cjs", "module.exports = { x: 1, Z: 2 };"),
        ("other.cjs", "module.exports = { x: 3 };"),
    ];
    with_program(&files, |program| {
        let [x, upper_case, other] =
            ["x", "Z", "other"].map(|name| program.synthetic_id("main.js", name));
        assert!(upper_case < x);
        assert_eq!(program.synthetic_id("second.js", "x"), x);
        assert_ne!(other, x);

        // The module has no `__esModule`, so its default export is what it exports as a whole, which needs no name.
        let module = program.module("c.cjs");
        assert_eq!(
            program.binding("main.js", "d"),
            ImportBinding::Exports { module }
        );
        assert_eq!(program.count_synthetic_exports(module), 2);
        let export = program.graph.synthetic_export(x);
        assert_eq!(export.module, module);
        assert!(!export.is_known_member);
    });
}

#[test]
fn native_module_names_are_captured_and_its_object_is_a_builtin() {
    let main = "
        import { Buffer } from 'node:buffer';
        import * as ns from 'node:buffer';
        import { Buffer as Reexported } from './reexport.js';
        import bun, { nope } from 'bun';
        import { buffer } from './namespace.js';
        import closed from 'node:buffer';
        import * as open from 'bun';
        import { held, bunNamespace } from './namespace.js';
    ";
    let namespace_exports = "
        export * as buffer from 'node:buffer';
        export * as bunNamespace from 'bun';
        import * as held from 'bun';
        export { held };
    ";
    let files = [
        ("main.js", main),
        ("reexport.js", "export { Buffer } from 'node:buffer';"),
        ("namespace.js", namespace_exports),
    ];
    with_program(&files, |program| {
        let module = program.runtime_module("main.js", 0);
        assert_eq!(module, RuntimeModule::NodeBuffer);
        let member = program.captured_export(module, "Buffer");
        assert_eq!(program.binding("main.js", "Buffer"), member);
        assert_eq!(program.binding("main.js", "Reexported"), member);
        let namespace = ImportBinding::Namespace {
            module: ModuleRef::Runtime(module),
            phase: ImportPhase::Evaluation,
        };
        assert_eq!(program.binding("main.js", "ns"), namespace);
        assert_eq!(program.binding("main.js", "buffer"), namespace);
        let default_export = ImportBinding::Builtin(table::namespace_of(module));
        assert_eq!(program.binding("main.js", "closed"), default_export);

        let [export] = program.graph.exports(program.file("reexport.js")) else {
            panic!("reexport.js has one export");
        };
        let ExportBinding::Synthetic(id) = export.binding else {
            panic!("Buffer is exported as {:?}", export.binding);
        };
        let synthetic = program.graph.synthetic_export(id);
        assert_eq!(synthetic.module, ModuleRef::Runtime(module));
        assert!(synthetic.is_known_member);
        assert_eq!(program.count_synthetic_exports(synthetic.module), 1);

        let open_module = program.runtime_module("main.js", 3);
        let flags = table::module_data(open_module).flags;
        assert!(flags.contains(table::ModuleFlags::HAS_OPEN_NAMESPACE));
        let open_namespace = table::namespace_of(open_module);
        let open_member = ImportBinding::BuiltinMember {
            holder: table::canonical_id(open_namespace),
            name: program.atom("nope"),
        };
        assert_eq!(program.binding("main.js", "nope"), open_member);
        let default = ImportBinding::Builtin(open_namespace);
        assert_eq!(program.binding("main.js", "bun"), default);
        assert_eq!(program.binding("main.js", "open"), default);
        assert_eq!(program.binding("main.js", "held"), default);
        let exports = program.graph.exports(program.file("namespace.js"));
        let mut exports = exports.iter();
        let held = exports.find(|export| export.name == program.atom("held"));
        let Some(ExportBinding::Variable(variable)) = held.map(|export| export.binding) else {
            panic!("`held` is exported as {held:?}");
        };
        assert_eq!(variable.file, program.file("namespace.js"));
        let exported_namespace = ImportBinding::Namespace {
            module: ModuleRef::Runtime(open_module),
            phase: ImportPhase::Evaluation,
        };
        assert_eq!(
            program.binding("main.js", "bunNamespace"),
            exported_namespace
        );
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn names_of_module_with_source_are_builtins_captured_at_load() {
    let main = "
        import { readFileSync } from 'node:fs';
        import path, { join } from 'node:path';
    ";
    with_program(&[("main.js", main)], |program| {
        let expected = [
            (0, RuntimeModule::NodeFs, "readFileSync"),
            (1, RuntimeModule::NodePath, "join"),
        ];
        for (statement, module, name) in expected {
            assert_eq!(program.runtime_module("main.js", statement), module);
            let flags = table::module_data(module).flags;
            assert!(flags.contains(table::ModuleFlags::HAS_SOURCE), "{module:?}");
            let member = program.captured_export(module, name);
            assert_eq!(program.binding("main.js", name), member, "{name}");
        }
        let namespace = table::namespace_of(RuntimeModule::NodePath);
        assert_eq!(
            program.binding("main.js", "path"),
            ImportBinding::Builtin(namespace)
        );
        assert_eq!(program.graph.synthetic_exports().len(), expected.len());
    });
}

#[test]
fn absent_export_of_bun_module_stops_the_build() {
    let files = [("main.js", "import { nope } from 'node:buffer';")];
    with_program(&files, |program| {
        let module = program.runtime_module("main.js", 0);
        let flags = table::module_data(module).flags;
        assert!(flags.contains(table::ModuleFlags::LISTS_ALL_EXPORTS));
        assert_eq!(program.binding("main.js", "nope"), ImportBinding::Unbound);
        let [error] = program.graph.errors() else {
            panic!("the errors are {:?}", program.graph.errors());
        };
        assert_eq!(error.effect(), FailureEffect::StopsBuild);
        let ModuleFailureKind::ExportNotFound { exporter, name } = error.kind else {
            panic!("the error is {:?}", error.kind);
        };
        assert_eq!(exporter, ModuleRef::Runtime(module));
        assert_eq!(name, program.atom("nope"));
        assert!(program.graph.synthetic_exports().is_empty());
    });
}

#[test]
fn unlisted_export_of_bun_module_is_synthetic() {
    let main = "
        import { O_RDONLY, nope } from 'node:constants';
        import { nope as absent } from 'node:path';
    ";
    with_program(&[("main.js", main)], |program| {
        let partly_listed = program.runtime_module("main.js", 0);
        let listed = program.captured_export(partly_listed, "O_RDONLY");
        assert_eq!(program.binding("main.js", "O_RDONLY"), listed);
        for (statement, local_name) in [(0, "nope"), (1, "absent")] {
            let module = program.runtime_module("main.js", statement);
            let flags = table::module_data(module).flags;
            let decides_absence =
                table::ModuleFlags::LISTS_ALL_EXPORTS | table::ModuleFlags::HAS_OPEN_NAMESPACE;
            assert!(!flags.intersects(decides_absence), "{module:?}");
            let unlisted = program.synthetic_export("main.js", local_name);
            assert_eq!(unlisted.module, ModuleRef::Runtime(module));
            assert_eq!(unlisted.name, program.atom("nope"));
            assert!(!unlisted.is_known_member);
        }
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn name_of_external_package_is_read_through_the_namespace() {
    let main = format!(
        "import d, {{ z }} from '{UNCOMPILED_MODULE}';\n\
         import * as ns from '{UNCOMPILED_MODULE}';\n"
    );
    with_program(&[("main.js", main.as_str())], |program| {
        let module = program.external("main.js", UNCOMPILED_MODULE);
        let names = [("d", known::default), ("z", program.atom("z"))];
        for (local_name, name) in names {
            let live_read = ImportBinding::NamespaceRead { module, name };
            assert_eq!(
                program.binding("main.js", local_name),
                live_read,
                "{local_name}"
            );
        }
        let namespace = ImportBinding::Namespace {
            module,
            phase: ImportPhase::Evaluation,
        };
        assert_eq!(program.binding("main.js", "ns"), namespace);
        let expected = names.map(|(_, name)| RequiredName::new(module, name));
        assert_eq!(program.required_names("main.js"), expected);
        assert!(program.graph.synthetic_exports().is_empty());
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn host_value_name_is_synthetic() {
    let files = [(
        "main.js",
        "import d, { x } from 'bun:only-the-host-has-it';",
    )];
    with_program(&files, |program| {
        let module = program.external("main.js", "bun:only-the-host-has-it");
        for (local_name, name) in [("d", known::default), ("x", program.atom("x"))] {
            let export = program.synthetic_export("main.js", local_name);
            assert_eq!(export.module, module, "{local_name}");
            assert_eq!(export.name, name, "{local_name}");
            assert!(!export.is_known_member, "{local_name}");
        }
        let required =
            [known::default, program.atom("x")].map(|name| RequiredName::new(module, name));
        assert_eq!(program.required_names("main.js"), required);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn imports_without_value_use_are_unused() {
    let main = "
        import type { T } from './types.ts';
        import { type U, value } from './types.ts';
        import { V } from './types.ts';
        import { W } from './types.ts';
        import { unused } from './types.ts';
        import './script.js';
        export { W };
        export const v: V = value;
    ";
    let types = "
        export type T = 1;
        export type U = 2;
        export interface V {}
        export interface W {}
        export const value = {};
        export const unused = 1;
    ";
    let files = [
        ("main.ts", main),
        ("types.ts", types),
        ("script.js", "import { unused } from './types.ts';"),
    ];
    with_program(&files, |program| {
        for local_name in ["T", "U", "V", "W", "unused"] {
            let binding = program.binding("main.ts", local_name);
            assert_eq!(binding, ImportBinding::Unused, "{local_name}");
        }
        let value = program.exported_variable("types.ts", "value");
        assert_eq!(program.binding("main.ts", "value"), value);
        let unused = program.exported_variable("types.ts", "unused");
        assert_eq!(program.binding("script.js", "unused"), unused);
    });
}

#[test]
fn import_used_in_dead_code_is_unused_and_requested() {
    let files = [
        ("main.ts", "import { a } from './es.ts'; if (false) a;"),
        ("es.ts", "export const a = 1;"),
    ];
    with_program(&files, |program| {
        assert_eq!(program.binding("main.ts", "a"), ImportBinding::Unused);
        let es = program.module("es.ts");
        let requests = program.graph.requests(program.file("main.ts"));
        assert!(requests.iter().any(|request| request.target == es));
    });
}

#[test]
fn import_equals_binds_locally() {
    let main = "
        import legacy = require('./c.cjs');
        export const x = legacy.x;
    ";
    let files = [("main.ts", main), ("c.cjs", "exports.x = 1;")];
    with_program(&files, |program| {
        assert_eq!(program.binding("main.ts", "legacy"), ImportBinding::Local);
    });
}

#[test]
fn redeclared_import_keeps_first_binding() {
    let main = "
        import { a } from './first.js';
        import { a } from './second.js';
    ";
    let files = [
        ("main.js", main),
        ("first.js", "export const a = 1;"),
        ("second.js", "export const a = 2;"),
    ];
    with_program(&files, |program| {
        let first = program.exported_variable("first.js", "a");
        assert_eq!(program.binding("main.js", "a"), first);
    });
}

#[test]
fn missing_names_fail_in_statement_order() {
    let before = "import d, { a, ";
    let specifier = "other as renamed";
    let main = format!("{before}{specifier}, missing }} from './es.js';");
    let files = [("main.js", main.as_str()), ("es.js", "export const a = 1;")];
    with_program(&files, |program| {
        for local_name in ["d", "renamed", "missing"] {
            let binding = program.binding("main.js", local_name);
            assert_eq!(binding, ImportBinding::Unbound, "{local_name}");
        }
        let variable = program.exported_variable("es.js", "a");
        assert_eq!(program.binding("main.js", "a"), variable);

        let errors = program.errors_of("main.js");
        let missing_names: Vec<Atom> = errors
            .iter()
            .map(|error| match error.kind {
                ModuleFailureKind::ExportNotFound { exporter, name } => {
                    assert_eq!(exporter, program.module("es.js"));
                    name
                }
                kind => panic!("the error is {kind:?}"),
            })
            .collect();
        let expected = [
            known::default,
            program.atom("other"),
            program.atom("missing"),
        ];
        assert_eq!(missing_names, expected);
        assert!(program.graph.failures().is_empty());

        let (default, renamed) = (errors[0], errors[1]);
        assert_eq!((default.start, default.end), (7, 8));
        let start = before.len() as u32;
        let end = start + specifier.len() as u32;
        assert_eq!((renamed.start, renamed.end), (start, end));
        assert_eq!(renamed.site, ImportSiteKind::Import(ImportId(0)));
    });
}

#[test]
fn names_of_unresolved_module_are_unbound() {
    let main = "
        import { x, y } from './nope.js';
        import { z } from './middle.js';
    ";
    let files = [
        ("main.js", main),
        ("middle.js", "export { z } from './gone.js';"),
    ];
    with_program(&files, |program| {
        for local_name in ["x", "y", "z"] {
            let binding = program.binding("main.js", local_name);
            assert_eq!(binding, ImportBinding::Unbound, "{local_name}");
        }
        let statement = ImportSiteKind::Import(ImportId(0));
        let importer = program.file("main.js");
        let answer = program.graph.site_answer(importer, statement);
        assert_eq!(answer, SiteAnswer::Erased);
        let unresolved_specifiers = [("main.js", "./nope.js"), ("middle.js", "./gone.js")];
        for (importer, expected_specifier) in unresolved_specifiers {
            let errors = program.errors_of(importer);
            let [error] = errors[..] else {
                panic!("the errors of {importer} are {errors:?}");
            };
            let ModuleFailureKind::Unresolved { specifier, .. } = error.kind else {
                panic!("the error is {:?}", error.kind);
            };
            assert_eq!(specifier, program.atom(expected_specifier));
        }
        assert_eq!(program.graph.errors().len(), 2);
    });
}

#[test]
fn name_of_two_star_exports_is_ambiguous() {
    let files = [
        ("main.js", "import { x } from './barrel.js';"),
        (
            "barrel.js",
            "export * from './one.js'; export * from './two.js';",
        ),
        ("one.js", "export const x = 1;"),
        ("two.js", "export const x = 2;"),
    ];
    with_program(&files, |program| {
        assert_eq!(program.binding("main.js", "x"), ImportBinding::Unbound);
        let [error] = program.graph.errors() else {
            panic!("the errors are {:?}", program.graph.errors());
        };
        assert_eq!(error.effect(), FailureEffect::StopsBuild);
        let ModuleFailureKind::ExportAmbiguous { exporter, name } = error.kind else {
            panic!("the error is {:?}", error.kind);
        };
        assert_eq!(exporter, program.module("barrel.js"));
        assert_eq!(name, program.atom("x"));
    });
}

#[test]
fn name_of_two_commonjs_stars_is_required_once() {
    let main = "
        import { x } from './barrel.js';
        import { x as again } from './barrel.js';
        import './indirect.js';
    ";
    let files = [
        ("main.js", main),
        (
            "barrel.js",
            "export * from './one.cjs'; export * from './two.cjs';",
        ),
        ("indirect.js", "export { x as y } from './barrel.js';"),
        ("one.cjs", "exports.x = 1;"),
        ("two.cjs", "exports.y = 2;"),
    ];
    with_program(&files, |program| {
        let module = program.module("barrel.js");
        let name = program.atom("x");
        let read = ImportBinding::NamespaceRead { module, name };
        assert_eq!(program.binding("main.js", "x"), read);
        assert_eq!(program.binding("main.js", "again"), read);
        let imported = RequiredName::new(module, name);
        assert_eq!(program.required_names("main.js"), [imported]);
        let exported = program.exported(imported, "y", "./barrel.js");
        assert_eq!(program.required_names("indirect.js"), [exported]);
    });
}

#[test]
fn name_of_static_and_commonjs_stars_is_required() {
    let main = "
        import { x } from './barrel.js';
        import { y } from './indirect.js';
        import { x as outer } from './outer.js';
        import { only } from './barrel.js';
    ";
    let files = [
        ("main.js", main),
        (
            "barrel.js",
            "export * from './es.js'; export * from './c.cjs';",
        ),
        ("indirect.js", "export { x as y } from './barrel.js';"),
        ("outer.js", "export * from './barrel.js';"),
        ("es.js", "export const x = 1;"),
        ("c.cjs", "exports.x = 2;"),
    ];
    with_program(&files, |program| {
        let symbol = program.exported_symbol("es.js", "x");
        for local_name in ["x", "y", "outer"] {
            let binding = program.binding("main.js", local_name);
            assert_eq!(binding, ImportBinding::Variable(symbol), "{local_name}");
        }
        let only = program.synthetic_export("main.js", "only");
        assert_eq!(only.module, program.module("c.cjs"));
        let required_in =
            |module: &str| RequiredName::new(program.module(module), program.atom("x"));
        let expected_names = [
            (
                "main.js",
                vec![required_in("barrel.js"), required_in("outer.js")],
            ),
            (
                "indirect.js",
                vec![program.exported(required_in("barrel.js"), "y", "./barrel.js")],
            ),
        ];
        for (importer, expected) in expected_names {
            let required_names = program.required_names(importer);
            assert_eq!(required_names, expected, "{importer}");
        }
        for exporter in ["barrel.js", "outer.js"] {
            assert!(program.required_names(exporter).is_empty());
            assert_eq!(program.find_export(exporter, "x"), ExportLookup::Unknown);
        }
        let own_entry = ExportLookup::Found(ExportBinding::Variable(symbol));
        assert_eq!(program.find_export("indirect.js", "y"), own_entry);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn name_re_exported_by_typescript_is_required() {
    let re_export = "export { x } from './barrel.js';";
    let files = [
        ("main.js", "import './untyped.js'; import './typed.ts';"),
        ("untyped.js", re_export),
        ("typed.ts", re_export),
        (
            "barrel.js",
            "export * from './one.cjs'; export * from './two.cjs';",
        ),
        ("one.cjs", "exports.x = 1;"),
        ("two.cjs", "exports.y = 2;"),
    ];
    with_program(&files, |program| {
        let required = RequiredName::new(program.module("barrel.js"), program.atom("x"));
        let required = program.exported(required, "x", "./barrel.js");
        assert_eq!(program.required_names("untyped.js"), [required]);
        assert_eq!(program.required_names("typed.ts"), [required]);
    });
}

#[test]
fn name_imported_by_typescript_is_required() {
    let files = [
        (
            "main.ts",
            "import { x } from './barrel.js'; console.log(x);",
        ),
        (
            "barrel.js",
            "export * from './one.cjs'; export * from './two.cjs';",
        ),
        ("one.cjs", "exports.x = 1;"),
        ("two.cjs", "exports.y = 2;"),
    ];
    with_program(&files, |program| {
        let required = RequiredName::new(program.module("barrel.js"), program.atom("x"));
        assert_eq!(program.required_names("main.ts"), [required]);
    });
}

#[test]
fn own_name_hides_inner_commonjs_star() {
    let files = [
        ("main.js", "import { x } from './outer.js';"),
        ("outer.js", "export * from './inner.js';"),
        ("inner.js", "export * from './c.cjs'; export const x = 1;"),
        ("c.cjs", "exports.x = 2;"),
    ];
    with_program(&files, |program| {
        let symbol = program.exported_symbol("inner.js", "x");
        assert_eq!(
            program.binding("main.js", "x"),
            ImportBinding::Variable(symbol)
        );
        assert!(program.required_names("main.js").is_empty());
        let star_entry = ExportLookup::Found(ExportBinding::Variable(symbol));
        assert_eq!(program.find_export("outer.js", "x"), star_entry);
    });
}

#[test]
fn name_of_one_external_module_in_two_files_is_required() {
    let re_export = format!("export {{ z }} from '{UNCOMPILED_MODULE}';");
    let files = [
        (
            "main.js",
            "import { z } from './index.js'; import { z as direct } from './a.js';",
        ),
        (
            "index.js",
            "export * from './a.js'; export * from './b.js';",
        ),
        ("a.js", re_export.as_str()),
        ("b.js", re_export.as_str()),
    ];
    with_program(&files, |program| {
        let name = program.atom("z");
        let module = program.external("a.js", UNCOMPILED_MODULE);
        let live_read = ImportBinding::NamespaceRead { module, name };
        assert_eq!(program.binding("main.js", "direct"), live_read);
        assert_eq!(program.binding("main.js", "z"), live_read);
        let compared_name = RequiredName::new(program.module("index.js"), name);
        let existing_name = RequiredName::new(module, name);
        assert_eq!(
            program.required_names("main.js"),
            [compared_name, existing_name]
        );
        let exported_name = program.exported(existing_name, "z", UNCOMPILED_MODULE);
        assert_eq!(program.required_names("a.js"), [exported_name]);
        assert_eq!(program.find_export("index.js", "z"), ExportLookup::Unknown);
        let own_entry = ExportLookup::Found(ExportBinding::Indirect { module, name });
        assert_eq!(program.find_export("a.js", "z"), own_entry);
        assert!(program.graph.synthetic_exports().is_empty());
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn namespace_binding_has_phase_of_import() {
    let main = "
        import defer * as deferred from './es.js';
        import * as eager from './es.js';
        import { handedOn } from './helper.js';
        import * as helper from './helper.js';
    ";
    let helper = "import defer * as a from './es.js'; export { a as handedOn };";
    let files = [
        ("main.js", main),
        ("helper.js", helper),
        ("es.js", "export const x = 1;"),
    ];
    with_program(&files, |program| {
        let deferred = program.namespace("es.js", ImportPhase::Defer);
        assert_eq!(program.binding("main.js", "deferred"), deferred);
        assert_eq!(program.binding("main.js", "handedOn"), deferred);
        let eager = program.namespace("es.js", ImportPhase::Evaluation);
        assert_eq!(program.binding("main.js", "eager"), eager);
        let entry = ExportBinding::Namespace {
            module: program.module("es.js"),
            phase: ImportPhase::Defer,
        };
        assert_eq!(
            program.find_export("helper.js", "handedOn"),
            ExportLookup::Found(entry)
        );
    });
}

#[test]
fn jsx_import_of_commonjs_runtime_is_synthetic() {
    let runtime = "node_modules/react/jsx-dev-runtime.js";
    let files = [
        ("main.jsx", ELEMENT),
        ("node_modules/react/package.json", r#"{ "name": "react" }"#),
        (runtime, "exports.jsxDEV = () => null;"),
    ];
    with_program(&files, |program| {
        let main = program.file("main.jsx");
        let binding = program.graph.jsx_binding(main, JsxImport::JsxDev);
        let ImportBinding::Synthetic(id) = binding else {
            panic!("jsxDEV is bound to {binding:?}");
        };
        let export = program.graph.synthetic_export(id);
        assert_eq!(export.module, program.module(runtime));
        assert_eq!(export.name, program.atom("jsxDEV"));
    });
}

#[test]
fn jsx_import_of_es_module_runtime_is_variable() {
    let runtime = "node_modules/react/jsx-dev-runtime.js";
    let files = [
        ("main.jsx", ELEMENT),
        ("node_modules/react/package.json", r#"{ "name": "react" }"#),
        (runtime, "export const jsxDEV = () => null;"),
    ];
    with_program(&files, |program| {
        let importer = program.file("main.jsx");
        let binding = program.graph.jsx_binding(importer, JsxImport::JsxDev);
        assert_eq!(binding, program.exported_variable(runtime, "jsxDEV"));
    });
}

#[test]
fn jsx_names_absent_from_runtime_fail_separately() {
    let files = [
        ("main.jsx", "export const element = <><div /></>;"),
        ("node_modules/react/package.json", r#"{ "name": "react" }"#),
        ("node_modules/react/jsx-dev-runtime.js", "export {};"),
    ];
    with_program(&files, |program| {
        let main = program.file("main.jsx");
        for import in [JsxImport::JsxDev, JsxImport::Fragment] {
            let binding = program.graph.jsx_binding(main, import);
            assert_eq!(binding, ImportBinding::Unbound, "{import:?}");
        }
        let errors = program.errors_of("main.jsx");
        let missing_names: Vec<Atom> = errors
            .iter()
            .map(|error| match error.kind {
                ModuleFailureKind::ExportNotFound { name, .. } => name,
                kind => panic!("the error is {kind:?}"),
            })
            .collect();
        assert_eq!(
            missing_names,
            [program.atom("jsxDEV"), program.atom("Fragment")]
        );
        for error in errors {
            assert_eq!(error.site, ImportSiteKind::JsxRuntime);
            assert_eq!((error.start, error.end), (0, 0));
        }
    });
}

#[test]
fn jsx_import_failure_is_an_import_failure() {
    with_program(&[("main.jsx", ELEMENT)], |program| {
        let main = program.file("main.jsx");
        let binding = program.graph.jsx_binding(main, JsxImport::JsxDev);
        assert_eq!(binding, ImportBinding::Unbound);
        let [error] = program.graph.errors() else {
            panic!("the errors are {:?}", program.graph.errors());
        };
        assert_eq!(error.importer, main);
        assert_eq!(error.site, ImportSiteKind::JsxRuntime);
        assert_eq!(error.effect(), FailureEffect::StopsBuild);
        let ModuleFailureKind::Unresolved { specifier, .. } = error.kind else {
            panic!("the error is {:?}", error.kind);
        };
        assert_eq!(specifier, program.atom("react/jsx-dev-runtime"));
        assert!(program.graph.failures().is_empty());
    });
}

const ES_MODULE: (&str, &str) = ("es.js", "export const x = 1;");

impl BoundProgram<'_, '_, '_> {
    fn member_bindings(&self, file: &str) -> Vec<ImportBinding> {
        let file = self.file(file);
        let exprs = (0..self.input.files.hir(file).exprs.len() as u32).map(ExprId);
        exprs
            .filter_map(|expr| self.graph.member_binding(file, expr))
            .collect()
    }

    fn member_binding(&self, file: &str, name: &str) -> Option<ImportBinding> {
        let file = self.file(file);
        let member = member_named(self.input, file, name);
        self.graph.member_binding(file, member)
    }

    fn member(&self, file: &str, name: &str) -> Option<Member> {
        let file = self.file(file);
        self.graph
            .member(file, member_named(self.input, file, name))
    }

    fn holder(&self, file: &str, name: &str) -> Option<View> {
        let file = self.file(file);
        self.graph
            .holder(file, symbol_named(self.input, file, name))
    }

    fn variable(&self, module: &str, name: &str) -> SyntheticExportId {
        let variable = self.graph.variable_of(self.module(module), self.atom(name));
        variable.expect("no binding asks for the name")
    }

    /// The one call of `require` in the file.
    fn call_of_require(&self, file: &str) -> ExprId {
        let sites = self.input.files.analysis(self.file(file)).import_sites.iter();
        let calls = sites.filter_map(|site| match site.kind {
            ImportSiteKind::Require(call) => Some(call),
            _ => None,
        });
        let calls: Vec<ExprId> = calls.collect();
        let [call] = calls[..] else {
            panic!("the file calls `require` at {calls:?}");
        };
        call
    }

    fn is_variable_replaceable(&self, file: &str, name: &str) -> bool {
        self.graph.is_replaceable(self.exported_symbol(file, name))
    }

    fn is_synthetic_export_replaceable(&self, module: &str, name: &str) -> bool {
        let variable = self.variable(module, name);
        self.graph.synthetic_export(variable).is_replaceable
    }
}

fn assert_no_member_is_bound(files: &[(&str, &str)]) {
    with_program(files, |program| {
        let (importer, source) = files[0];
        let bindings = program.member_bindings(importer);
        assert!(bindings.is_empty(), "{source}: {bindings:?}");
        assert!(program.graph.errors().is_empty(), "{source}");
        assert!(program.required_names(importer).is_empty(), "{source}");
    });
}

#[test]
fn member_is_the_exporters_variable() {
    let main = "
        import * as ns from './es.js';
        import { x } from './es.js';
        console.log(ns.x, x);
    ";
    with_program(&[("main.js", main), ES_MODULE], |program| {
        let variable = program.exported_variable("es.js", "x");
        assert_eq!(program.member_bindings("main.js"), [variable]);
        assert_eq!(program.member_binding("main.js", "x"), Some(variable));
        assert_eq!(program.binding("main.js", "x"), variable);
    });
}

#[test]
fn member_through_re_exports_is_exporters_variable() {
    let main = "import * as ns from './barrel.js'; console.log(ns.x, ns.renamed);";
    let barrel = "export * from './es.js'; export { x as renamed } from './es.js';";
    let files = [("main.js", main), ("barrel.js", barrel), ES_MODULE];
    with_program(&files, |program| {
        let variable = program.exported_variable("es.js", "x");
        assert_eq!(program.member_bindings("main.js"), [variable, variable]);
    });
}

#[test]
fn bracket_string_is_a_member() {
    let main = "
        import * as ns from './es.js';
        export const read = (key) => [ns['x'], ns[`x`], ns[key]];
    ";
    with_program(&[("main.js", main), ES_MODULE], |program| {
        let variable = program.exported_variable("es.js", "x");
        assert_eq!(program.member_bindings("main.js"), [variable, variable]);
    });
}

#[test]
fn asserted_namespace_is_followed() {
    let main = "
        import * as ns from './es.ts';
        console.log((ns as any).x, ns!.x, (ns satisfies object).x);
    ";
    let files = [("main.ts", main), ("es.ts", "export const x = 1;")];
    with_program(&files, |program| {
        let variable = program.exported_variable("es.ts", "x");
        assert_eq!(program.member_bindings("main.ts"), [variable; 3]);
    });
}

#[test]
fn nested_namespace_is_followed() {
    let main = "import * as ns from './outer.js'; console.log(ns.inner.x);";
    let files = [
        ("main.js", main),
        ("outer.js", "export * as inner from './es.js';"),
        ES_MODULE,
    ];
    with_program(&files, |program| {
        let inner = program.namespace("es.js", ImportPhase::Evaluation);
        assert_eq!(program.member_binding("main.js", "inner"), Some(inner));
        let variable = program.exported_variable("es.js", "x");
        assert_eq!(program.member_binding("main.js", "x"), Some(variable));
        assert_eq!(program.member_bindings("main.js").len(), 2);
    });
}

#[test]
fn nested_deferred_namespace_ends_path() {
    let main = "import * as ns from './outer.js'; console.log(ns.inner.x);";
    let outer = "import defer * as inner from './es.js'; export { inner };";
    let files = [("main.js", main), ("outer.js", outer), ES_MODULE];
    with_program(&files, |program| {
        let inner = program.namespace("es.js", ImportPhase::Defer);
        assert_eq!(program.member_bindings("main.js"), [inner]);
        assert_eq!(program.member_binding("main.js", "x"), None);
    });
}

#[test]
fn commonjs_member_gets_a_synthetic_export() {
    let main = "import * as ns from './c.cjs'; console.log(ns.x);";
    let files = [("main.js", main), ("c.cjs", "exports.x = 1;")];
    with_program(&files, |program| {
        let Some(ImportBinding::Synthetic(id)) = program.member_binding("main.js", "x") else {
            panic!("a member of a CommonJS namespace is a synthetic export");
        };
        let expected = SyntheticExport {
            module: program.module("c.cjs"),
            name: program.atom("x"),
            is_known_member: true,
            is_replaceable: false,
        };
        assert_eq!(program.graph.synthetic_exports(), [expected]);
        assert_eq!(id, SyntheticExportId(0));
    });
}

#[test]
fn imported_name_of_commonjs_module_must_exist() {
    let main = "
        import * as ns from './c.cjs';
        import { x } from './c.cjs';
        console.log(ns.x, x);
    ";
    let files = [("main.js", main), ("c.cjs", "exports.x = 1;")];
    with_program(&files, |program| {
        let id = program.synthetic_id("main.js", "x");
        let member = program.member_binding("main.js", "x");
        assert_eq!(member, Some(ImportBinding::Synthetic(id)));
        assert!(!program.graph.synthetic_export(id).is_known_member);
    });
}

#[test]
fn host_value_member_gets_a_synthetic_export() {
    let main = "import * as ns from 'bun:only-the-host-has-it'; console.log(ns.x);";
    with_program(&[("main.js", main)], |program| {
        let Some(ImportBinding::Synthetic(id)) = program.member_binding("main.js", "x") else {
            panic!("a member of a host value is a synthetic export");
        };
        let module = program.external("main.js", "bun:only-the-host-has-it");
        assert_eq!(program.graph.synthetic_export(id).module, module);
    });
}

#[test]
fn data_module_member_is_variable() {
    let main = "import * as data from './data.json'; console.log(data.x, data.missing);";
    let files = [("main.js", main), ("data.json", r#"{ "x": 1 }"#)];
    with_program(&files, |program| {
        let entry = program.find_export("data.json", "x");
        let ExportLookup::Found(ExportBinding::Variable(symbol)) = entry else {
            panic!("x is exported as {entry:?}");
        };
        assert_eq!(
            program.member_bindings("main.js"),
            [ImportBinding::Variable(symbol)]
        );
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn any_other_access_is_left_to_the_namespace_object() {
    let sources = [
        "import * as ns from './es.js'; console.log(ns.missing);",
        "import defer * as ns from './es.js'; console.log(ns.x);",
        "import * as ns from './es.js'; ns.x = 1; ns.x += 1; ns.x++; for (ns.x of []);",
        "import * as ns from './es.js'; delete ns.x;",
        "import * as ns from './es.js'; if (false) console.log(ns.x);",
        "import * as ns from './es.js'; export const read = (ns) => ns.x;",
        "import * as ns from './es.js'; const alias = ns; console.log(alias.x);",
    ];
    for source in sources {
        assert_no_member_is_bound(&[("main.js", source), ES_MODULE]);
    }
}

#[test]
fn store_through_type_assertion_is_not_bound() {
    let main = "import * as ns from './es.ts'; (ns.x as number) = 1; (ns as any).x = 2;";
    assert_no_member_is_bound(&[("main.ts", main), ("es.ts", "export const x = 1;")]);
}

#[test]
fn ambiguous_star_name_is_not_bound() {
    let main = "
        import * as compared from './compared.js';
        import * as ambiguous from './ambiguous.js';
        console.log(compared.x, ambiguous.x);
    ";
    let files = [
        ("main.js", main),
        (
            "compared.js",
            "export * from './es.js'; export * from './c.cjs';",
        ),
        (
            "ambiguous.js",
            "export * from './es.js'; export * from './other.js';",
        ),
        ES_MODULE,
        ("other.js", "export const x = 2;"),
        ("c.cjs", "exports.x = 3;"),
    ];
    assert_no_member_is_bound(&files);
}

#[test]
fn es_module_marker_is_not_bound() {
    let main = "import * as ns from './marked.js'; console.log(ns.__esModule);";
    let files = [
        ("main.js", main),
        ("marked.js", "export const __esModule = true;"),
    ];
    assert_no_member_is_bound(&files);
}

#[test]
fn member_of_uncompiled_code_is_not_bound() {
    let main = format!("import * as ns from '{UNCOMPILED_MODULE}'; console.log(ns.z);");
    assert_no_member_is_bound(&[("main.js", main.as_str())]);
}

// No loop over the object sees such a name, so the namespace object, which is made by such a loop, lacks it.
#[test]
fn getter_that_is_not_enumerable_is_hidden_from_the_namespace() {
    let main = "import * as ns from './outer.cjs'; console.log(ns.x);";
    let hidden = "var inner_1 = require('./inner.cjs');\n\
        Object.defineProperty(exports, 'x', { get: function () { return inner_1.x; } });";
    let listed = hidden.replace("{ get:", "{ enumerable: true, get:");
    for (outer, is_listed) in [(hidden, false), (listed.as_str(), true)] {
        let files = [
            ("main.mjs", main),
            ("outer.cjs", outer),
            ("inner.cjs", "exports.x = 1;"),
        ];
        with_program(&files, |program| {
            let member = program.member_binding("main.mjs", "x");
            assert_eq!(member.is_some(), is_listed, "{outer}");
            assert!(program.graph.errors().is_empty(), "{outer}");
        });
    }
}

#[test]
fn member_of_bun_module_is_the_named_import() {
    let main = "
        import * as fs from 'node:fs';
        import defaultExport, { readFileSync } from 'node:fs';
        console.log(fs.readFileSync, fs.default, readFileSync, defaultExport);
    ";
    with_program(&[("main.js", main)], |program| {
        let namespace = ImportBinding::Namespace {
            module: ModuleRef::Runtime(RuntimeModule::NodeFs),
            phase: ImportPhase::Evaluation,
        };
        assert_eq!(program.binding("main.js", "fs"), namespace);
        let member = program.member_binding("main.js", "readFileSync");
        assert_eq!(member, Some(program.binding("main.js", "readFileSync")));
        let default_export = ImportBinding::Builtin(table::namespace_of(RuntimeModule::NodeFs));
        assert_eq!(
            program.member_binding("main.js", "default"),
            Some(default_export)
        );
        assert_eq!(program.binding("main.js", "defaultExport"), default_export);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn default_of_bun_module_is_the_own_default_that_its_object_had_at_the_load() {
    let main = "
        import * as sqlite from 'bun:sqlite';
        import Database from 'bun:sqlite';
        console.log(sqlite.default, Database);
    ";
    with_program(&[("main.js", main)], |program| {
        let own_default = program.captured_export(RuntimeModule::BunSqlite, "default");
        assert_eq!(
            program.member_binding("main.js", "default"),
            Some(own_default)
        );
        assert_eq!(program.binding("main.js", "Database"), own_default);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn default_of_bun_module_is_its_object_where_the_object_has_a_default_too() {
    let main = "
        import * as namespace from 'abort-controller';
        import Controller from 'abort-controller';
        console.log(namespace.default, Controller);
    ";
    with_program(&[("main.js", main)], |program| {
        let module_object = table::namespace_of(RuntimeModule::AbortController);
        let default_export = ImportBinding::Builtin(module_object);
        assert_eq!(
            program.member_binding("main.js", "default"),
            Some(default_export)
        );
        assert_eq!(program.binding("main.js", "Controller"), default_export);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn default_that_only_the_namespace_holds_is_captured() {
    let main = "
        import * as namespace from 'utf-8-validate';
        import validate from 'utf-8-validate';
        console.log(namespace.default, validate);
    ";
    with_program(&[("main.js", main)], |program| {
        let ImportBinding::Synthetic(export) = program.binding("main.js", "validate") else {
            panic!("the run time captures the export when it links the module");
        };
        let captured = ImportBinding::Synthetic(export);
        assert_eq!(program.member_binding("main.js", "default"), Some(captured));
        let module = ModuleRef::Runtime(RuntimeModule::Utf8Validate);
        assert_eq!(program.graph.synthetic_export(export).module, module);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn missing_member_of_bun_module_is_unbound_and_no_error() {
    let main = "import * as buffer from 'node:buffer'; console.log(buffer.nope);";
    let flags = table::module_data(RuntimeModule::NodeBuffer).flags;
    assert!(flags.contains(table::ModuleFlags::LISTS_ALL_EXPORTS));
    assert_no_member_is_bound(&[("main.js", main)]);
}

#[test]
fn deferred_namespace_of_bun_module_is_not_bound() {
    let main = "import defer * as fs from 'node:fs'; console.log(fs.readFileSync);";
    with_program(&[("main.js", main)], |program| {
        let namespace = ImportBinding::Namespace {
            module: ModuleRef::Runtime(RuntimeModule::NodeFs),
            phase: ImportPhase::Defer,
        };
        assert_eq!(program.binding("main.js", "fs"), namespace);
    });
    assert_no_member_is_bound(&[("main.js", main)]);
}

#[test]
fn members_of_a_holder_are_names_of_the_module_that_it_requires() {
    let main = "const held = require('./c.cjs'); console.log(held.x, held['y']);";
    let files = [
        ("main.cjs", main),
        ("c.cjs", "exports.x = 1; exports.y = 2;"),
    ];
    with_program(&files, |program| {
        let exports = View::Exports(program.module("c.cjs"));
        assert_eq!(program.holder("main.cjs", "held"), Some(exports));
        let call = program.call_of_require("main.cjs");
        let file = program.file("main.cjs");
        assert!(!program.graph.is_site_read_as_value(file, call));
        for name in ["x", "y"] {
            let variable = Member::Variable(program.variable("c.cjs", name));
            assert_eq!(program.member("main.cjs", name), Some(variable), "{name}");
        }
        // A holder reads what the module has now. Only `import * as` shows what it had when it was linked.
        assert!(program.member_bindings("main.cjs").is_empty());
    });
}

#[test]
fn holder_used_as_a_value_holds_the_exports_object() {
    let main = "const held = require('./c.cjs'); console.log(held.x, held);";
    let files = [("main.cjs", main), ("c.cjs", "exports.x = 1;")];
    with_program(&files, |program| {
        let file = program.file("main.cjs");
        let [holder] = program.graph.holders(file) else {
            panic!("the holders are {:?}", program.graph.holders(file));
        };
        assert!(holder.is_needed_as_value);
        assert_eq!(holder.call, program.call_of_require("main.cjs"));
        assert_eq!(program.holder("main.cjs", "held"), None);
        assert!(program.graph.is_site_read_as_value(file, holder.call));
        assert_eq!(program.graph.shape(program.module("c.cjs")), Shape::Value);
        assert_eq!(program.member("main.cjs", "x"), Some(Member::OnObject));
    });
}

const TYPESCRIPT_IMPORT_HELPERS: &str = r#"var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
"#;

#[test]
fn import_helper_of_typescript_leaves_a_holder_only_where_the_module_has_the_marker() {
    let reads = "const held = __importStar(require('./c.cjs')); console.log(held.x);";
    let main = format!("{TYPESCRIPT_IMPORT_HELPERS}{reads}");
    // The helper answers what it is handed.
    let marked = "Object.defineProperty(exports, '__esModule', { value: true }); exports.x = 1;";
    with_program(&[("main.cjs", main.as_str()), ("c.cjs", marked)], |program| {
        let file = program.file("main.cjs");
        let exports = View::Exports(program.module("c.cjs"));
        assert_eq!(program.holder("main.cjs", "held"), Some(exports));
        let call = program.call_of_require("main.cjs");
        let held = symbol_named(program.input, file, "held");
        assert_eq!(program.graph.call_of_holder(file, held), Some(call));
        assert!(!program.graph.is_site_read_as_value(file, call));
        let x = Member::Variable(program.variable("c.cjs", "x"));
        assert_eq!(program.member("main.cjs", "x"), Some(x));
    });
    // The helper makes another object of the one that it is handed, so the initializer runs as it is written.
    let unmarked = "exports.x = 1;";
    with_program(&[("main.cjs", main.as_str()), ("c.cjs", unmarked)], |program| {
        let file = program.file("main.cjs");
        assert_eq!(program.holder("main.cjs", "held"), None);
        assert_eq!(program.member("main.cjs", "x"), None);
        let call = program.call_of_require("main.cjs");
        assert!(program.graph.is_site_read_as_value(file, call));
        assert_eq!(program.graph.shape(program.module("c.cjs")), Shape::Value);
    });
}

const TWO_FUNCTIONS: &str = "export function x() {} export function y() {}";

#[test]
fn spy_on_a_name_of_a_module_replaces_that_export_alone() {
    let sources = [
        "import * as ns from './es.js'; spyOn(ns, 'x');",
        "const held = require('./es.js'); spyOn(held, 'x');",
    ];
    for source in sources {
        let main = format!("import {{ spyOn }} from 'bun:test'; {source}");
        let files = [("main.test.js", main.as_str()), ("es.js", TWO_FUNCTIONS)];
        with_test_run(&files, |program| {
            assert!(program.is_variable_replaceable("es.js", "x"), "{source}");
            assert!(!program.is_variable_replaceable("es.js", "y"), "{source}");
        });
    }
    let main = "import * as ns from './es.js'; function spyOn() {} spyOn(ns, 'x');";
    let files = [("main.test.js", main), ("es.js", TWO_FUNCTIONS)];
    with_test_run(&files, |program| {
        assert!(!program.is_variable_replaceable("es.js", "x"));
    });
}

#[test]
fn spy_on_a_name_that_the_loader_fills_replaces_that_name_alone() {
    let main = "
        import { spyOn } from 'bun:test';
        import * as ns from './c.cjs';
        spyOn(ns, 'x');
        console.log(ns.y);
    ";
    let files = [
        ("main.test.js", main),
        ("c.cjs", "exports.x = () => 1; exports.y = () => 2;"),
    ];
    with_test_run(&files, |program| {
        assert!(program.is_synthetic_export_replaceable("c.cjs", "x"));
        assert!(!program.is_synthetic_export_replaceable("c.cjs", "y"));
    });
}

#[test]
fn spy_under_an_unknown_name_replaces_every_export_of_the_module() {
    let main = "
        import { spyOn } from 'bun:test';
        import * as ns from './es.js';
        import * as commonjs from './c.cjs';
        import * as other from './other.js';
        spyOn(ns, String(Math.random()));
        spyOn(commonjs, String(Math.random()));
        console.log(commonjs.x, other.z);
    ";
    let files = [
        ("main.test.js", main),
        ("es.js", TWO_FUNCTIONS),
        ("c.cjs", "exports.x = () => 1;"),
        ("other.js", "export function z() {}"),
    ];
    with_test_run(&files, |program| {
        for name in ["x", "y"] {
            assert!(program.is_variable_replaceable("es.js", name), "{name}");
        }
        assert!(program.is_synthetic_export_replaceable("c.cjs", "x"));
        assert!(!program.is_variable_replaceable("other.js", "z"));
    });
}

#[test]
fn spy_on_an_unknown_object_reaches_a_namespace_used_as_a_value() {
    let helper = "
        import { spyOn } from 'bun:test';
        export function watch(object) { spyOn(object, 'x'); }
    ";
    let uses = [
        ("watch(ns);", true),
        ("const alias = ns; watch(alias);", true),
        ("watch({ x() {} }); ns.x();", false),
    ];
    for (source, is_used_as_value) in uses {
        let imports = "import * as ns from './es.js'; import { watch } from './helper.js';";
        let main = format!("{imports} {source}");
        let files = [
            ("main.test.js", main.as_str()),
            ("helper.js", helper),
            ("es.js", TWO_FUNCTIONS),
        ];
        with_test_run(&files, |program| {
            let is_replaceable = program.is_variable_replaceable("es.js", "x");
            assert_eq!(is_replaceable, is_used_as_value, "{source}");
            assert!(!program.is_variable_replaceable("es.js", "y"), "{source}");
        });
    }
}
