mod namespace_members;

use super::*;
use crate::builtins::BuiltinId;
use crate::modules::testing::{file_named, symbol_named, with_graph};
use crate::modules::{
    ExportBinding, ExportLookup, FailureEffect, ModuleFailure, ModuleGraph, SiteAnswer,
    SyntheticExport, SyntheticExportId,
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
        let Some(ExportBinding::Synthetic(id)) = held.map(|export| export.binding) else {
            panic!("`held` is exported as {held:?}");
        };
        let held = program.graph.synthetic_export(id);
        assert_eq!(held.module, ModuleRef::Runtime(open_module));
        assert_eq!(held.name, known::default);
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
    let files = [("main.js", "import d, { x } from 'bun:main';")];
    with_program(&files, |program| {
        let module = program.external("main.js", "bun:main");
        for (local_name, name) in [("d", known::default), ("x", program.atom("x"))] {
            let export = program.synthetic_export("main.js", local_name);
            assert_eq!(export.module, module, "{local_name}");
            assert_eq!(export.name, name, "{local_name}");
            assert!(!export.is_known_member, "{local_name}");
        }
        assert!(program.required_names("main.js").is_empty());
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
        let expected = [RequiredName::new(module, name)];
        for importer in ["main.js", "indirect.js"] {
            let required_names = program.required_names(importer);
            assert_eq!(required_names, expected, "{importer}");
        }
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
            ("indirect.js", vec![required_in("barrel.js")]),
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
fn name_re_exported_by_typescript_may_be_absent() {
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
        assert_eq!(program.required_names("untyped.js"), [required]);
        let may_be_absent = RequiredName {
            may_be_absent: true,
            ..required
        };
        assert_eq!(program.required_names("typed.ts"), [may_be_absent]);
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
        assert!(!required.may_be_absent);
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
        assert_eq!(program.required_names("a.js"), [existing_name]);
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
