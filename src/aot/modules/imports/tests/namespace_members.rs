use super::*;
use crate::modules::testing::member_named;

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
}

fn assert_no_member_is_bound(files: &[(&str, &str)]) {
    with_program(files, |program| {
        let (importer, _) = files[0];
        let bindings = program.member_bindings(importer);
        assert!(bindings.is_empty(), "{bindings:?}");
        assert!(program.graph.errors().is_empty());
        assert!(program.required_names(importer).is_empty());
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
    let main = "import * as ns from 'bun:main'; console.log(ns.x);";
    with_program(&[("main.js", main)], |program| {
        let Some(ImportBinding::Synthetic(id)) = program.member_binding("main.js", "x") else {
            panic!("a member of a host value is a synthetic export");
        };
        let module = program.external("main.js", "bun:main");
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
fn missing_member_is_unbound_and_no_error() {
    let main = "import * as ns from './es.js'; console.log(ns.missing);";
    assert_no_member_is_bound(&[("main.js", main), ES_MODULE]);
}

#[test]
fn deferred_namespace_is_not_bound() {
    let main = "import defer * as ns from './es.js'; console.log(ns.x);";
    assert_no_member_is_bound(&[("main.js", main), ES_MODULE]);
}

#[test]
fn store_to_member_is_not_bound() {
    let main = "
        import * as ns from './es.js';
        ns.x = 1;
        ns.x += 1;
        ns.x++;
        for (ns.x of []);
    ";
    assert_no_member_is_bound(&[("main.js", main), ES_MODULE]);
}

#[test]
fn store_through_type_assertion_is_not_bound() {
    let main = "import * as ns from './es.ts'; (ns.x as number) = 1; (ns as any).x = 2;";
    assert_no_member_is_bound(&[("main.ts", main), ("es.ts", "export const x = 1;")]);
}

#[test]
fn dead_reference_is_skipped() {
    let main = "import * as ns from './es.js'; if (false) console.log(ns.x);";
    assert_no_member_is_bound(&[("main.js", main), ES_MODULE]);
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
fn default_of_bun_module_is_the_own_default_of_its_object() {
    let main = "
        import * as sqlite from 'bun:sqlite';
        import Database from 'bun:sqlite';
        console.log(sqlite.default, Database);
    ";
    with_program(&[("main.js", main)], |program| {
        let own_default = ImportBinding::Builtin(BuiltinId::BunSqliteDefault);
        assert_eq!(
            program.member_binding("main.js", "default"),
            Some(own_default)
        );
        assert_eq!(program.binding("main.js", "Database"), own_default);
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
    with_program(&[("main.js", main)], |program| {
        let flags = table::module_data(RuntimeModule::NodeBuffer).flags;
        assert!(flags.contains(table::ModuleFlags::LISTS_ALL_EXPORTS));
        assert!(program.graph.errors().is_empty());
    });
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
fn shadowing_binding_and_alias_are_not_followed() {
    let main = "
        import * as ns from './es.js';
        export const read = (ns) => ns.x;
        const alias = ns;
        console.log(alias.x);
    ";
    assert_no_member_is_bound(&[("main.js", main), ES_MODULE]);
}
