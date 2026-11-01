mod support;
use support::*;

use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{FileId, Sym};

use ReferentCertainty::{Expected, Proven};

type Referent = StaticReferent<Atom, FileId>;
type Resolved = ResolvedReferent<Atom, FileId>;

const BUILTIN_NAMES: [&str; 3] = ["Error", "Map", "assign"];
const BUILTIN_MEMBERS: [(&str, &str); 1] = [("Map", "groupBy")];

struct Program<'s> {
    paths: Vec<&'static str>,
    files: Vec<Analyzed<'s>>,
    ignores_stores: bool,
    requires_default_exports: bool,
}

impl<'s> Program<'s> {
    fn new(workspace: &Workspace<'s>, sources: &[(&'static str, &'static str)]) -> Program<'s> {
        let analyze = |&(path, text): &(&'static str, &'static str)| {
            let source = Source {
                experimental_decorators: true,
                ..Source::new(path, text)
            };
            workspace.analyze(&source)
        };
        Program {
            paths: sources.iter().map(|source| source.0).collect(),
            files: sources.iter().map(analyze).collect(),
            ignores_stores: false,
            requires_default_exports: false,
        }
    }

    fn file(&self, file: FileId) -> &Analyzed<'s> {
        &self.files[file.0 as usize]
    }

    fn find_module(&self, importer: FileId, specifier: Atom) -> Option<FileId> {
        let specifier = self.file(importer).workspace.text(specifier);
        let path = specifier.strip_prefix("./")?;
        let index = self.paths.iter().position(|&candidate| candidate == path)?;
        Some(FileId(index as u32))
    }

    fn last_expression(&self) -> ExprId {
        let hir = &self.files[0].hir;
        let statements = find_stmts(hir, |kind| matches!(kind, StmtKind::Expr(_)));
        let StmtKind::Expr(e) = hir[*statements.last().unwrap()].kind else {
            unreachable!();
        };
        e
    }

    fn resolve(&self) -> Resolved {
        static_referent(self, FileId(0), self.last_expression())
    }

    fn resolve_default_export(&self, member: Option<&str>) -> Resolved {
        let member = member.map(|name| self.files[0].workspace.atom(name));
        export_referent(self, FileId(0), known::default, member)
    }

    fn class(&self, file: u32, name: &str) -> Referent {
        let file = FileId(file);
        let class = self.file(file).class(name);
        StaticReferent::Class(ClassRef { file, class })
    }

    fn function(&self, file: u32, name: &str) -> Referent {
        let file = FileId(file);
        let function = self.file(file).function(name);
        StaticReferent::Function(FunctionRef { file, function })
    }
}

impl<'s> ReferentContext<'s> for Program<'s> {
    type Builtin = Atom;
    type Module = FileId;

    fn hir(&self, file: FileId) -> &File<'s> {
        &self.file(file).hir
    }

    fn bound(&self, file: FileId) -> &Bound<'s> {
        &self.file(file).bound
    }

    fn builtin_of_expression(&self, file: FileId, expr: ExprId) -> Option<Atom> {
        let s = self.file(file);
        let ExprKind::Ident(name) = s.hir[expr].kind else {
            return None;
        };
        let is_builtin = BUILTIN_NAMES.contains(&s.workspace.text(name));
        (is_builtin && s.bound.binding(expr) == Binding::Free).then_some(name)
    }

    fn builtin_member(&self, holder: Atom, name: Atom) -> Option<Atom> {
        let workspace = self.files[0].workspace;
        let member = (workspace.text(holder), workspace.text(name));
        BUILTIN_MEMBERS.contains(&member).then_some(name)
    }

    fn linked_binding(&self, file: FileId, import: SymbolId) -> LinkedBinding<Atom, FileId> {
        let s = self.file(file);
        for (index, node) in s.hir.imports.iter().enumerate() {
            let id = ImportId(index as u32);
            let Some(module) = self.find_module(file, node.spec) else {
                continue;
            };
            if s.bound.declared_symbol(Decl::ImportNamespace(id)) == import {
                return LinkedBinding::Namespace(module);
            }
            if s.bound.declared_symbol(Decl::ImportDefault(id)) == import {
                return self.module_export(module, known::default);
            }
            for spec in node.named.iter() {
                if s.bound.declared_symbol(Decl::ImportSpec(spec)) == import {
                    return self.module_export(module, s.hir[spec].imported);
                }
            }
        }
        LinkedBinding::Unknown
    }

    fn module_export(&self, module: FileId, name: Atom) -> LinkedBinding<Atom, FileId> {
        let bound = &self.file(module).bound;
        let exports = bound.symbol(bound.file_symbol).exports;
        match bound.lookup(exports, name) {
            Some(id) if bound.binding_kind(id) != BindingKind::NoBinding => {
                LinkedBinding::Binding(Sym { file: module, id })
            }
            Some(_) | None => LinkedBinding::Unknown,
        }
    }

    fn loaded_value(&self, file: FileId, call: ExprId) -> Option<LoadedValue<FileId>> {
        let analysis = &self.file(file).analysis;
        let site = analysis.import_sites[analysis.import_site_of_call(call)?];
        let (ImportSiteKind::Require(_), ImportSpecifier::Constant(specifier)) =
            (site.kind, site.specifier)
        else {
            return None;
        };
        let module = self.find_module(file, specifier)?;
        Some(match self.file(module).analysis.module_format {
            ModuleFormat::CommonJs => LoadedValue::ModuleExports(module),
            ModuleFormat::Esm if self.requires_default_exports => {
                LoadedValue::DefaultExport(module)
            }
            ModuleFormat::Esm => LoadedValue::Namespace(module),
        })
    }

    fn is_dead_store(&self, _file: FileId, _target: ExprId) -> bool {
        self.ignores_stores
    }

    fn find_target_of_copied_properties(&self, builtin: Atom) -> Option<u32> {
        (self.files[0].workspace.text(builtin) == "assign").then_some(0)
    }
}

fn with_program(
    sources: &[(&'static str, &'static str)],
    test: impl for<'s> FnOnce(&mut Program<'s>) + Send,
) {
    with_workspace(|workspace| test(&mut Program::new(workspace, sources)));
}

fn assert_unknown(path: &'static str, text: &'static str, reason: UnknownReferent) {
    with_program(&[(path, text)], |program| {
        assert_eq!(
            program.resolve().referent,
            StaticReferent::Unknown(reason),
            "{text}"
        );
    });
}

fn assert_required_unknown(
    importer: &'static str,
    exporter: &'static str,
    reason: UnknownReferent,
) {
    with_program(&[("a.cjs", importer), ("b.cjs", exporter)], |program| {
        let found = program.resolve().referent;
        assert_eq!(
            found,
            StaticReferent::Unknown(reason),
            "{importer} {exporter}"
        );
    });
}

#[test]
fn classes_of_one_file() {
    const PROVEN: &[(&str, &str)] = &[
        ("a.mjs", "class A {} A;"),
        ("a.mjs", "A; class A {}"),
        ("a.mjs", "const B = class A {}; B;"),
        ("a.mjs", "class A {} const B = A; const C = B; C;"),
        ("a.mjs", "class A {} let B = A; B;"),
        ("a.mjs", "(class A {});"),
        ("a.ts", "class A {} (A as any);"),
        ("a.ts", "class A {} A!;"),
        ("a.ts", "class A {} (A satisfies unknown);"),
        ("a.mjs", "class A { m() { A; } }"),
        ("a.cjs", r#"const B = class A {}; eval(""); B;"#),
    ];
    for &(path, text) in PROVEN {
        with_program(&[(path, text)], |program| {
            let expected = Resolved {
                referent: program.class(0, "A"),
                certainty: Proven,
            };
            assert_eq!(program.resolve(), expected, "{text}");
        });
    }
}

#[test]
fn functions_of_one_file() {
    const PROVEN: &[&str] = &[
        "function f() {} f;",
        "f; function f() {}",
        "const g = function f() {}; g;",
        "function f() {} const g = f; g;",
        "(function f() { f; });",
    ];
    for &text in PROVEN {
        with_program(&[("a.mjs", text)], |program| {
            let expected = Resolved {
                referent: program.function(0, "f"),
                certainty: Proven,
            };
            assert_eq!(program.resolve(), expected, "{text}");
        });
    }
}

#[test]
fn value_of_function_called_where_it_is_written() {
    const FOUND: &[&str] = &[
        "const g = (function () { return function f() {}; })(); g;",
        "const g = (function () { function f() {} f.prototype.m = 1; return f; })(); g;",
        "const g = (function () { function f() {} return f; }()); g;",
        "const g = (() => { function f() {} return f; })(); g;",
        "function f() {} const g = (function (p) { return p; })(f); g;",
        "function f() {} const r = (function (p) { p; })(f);",
        "function f() {} const r = (function (a, p) { p; })(1, f);",
        "function f() {} const r = (function (p) { const s = (function (q) { q; })(p); })(f);",
    ];
    for &text in FOUND {
        with_program(&[("a.mjs", text)], |program| {
            assert_eq!(
                program.resolve().referent,
                program.function(0, "f"),
                "{text}"
            );
        });
    }
}

#[test]
fn value_of_function_that_may_return_otherwise() {
    const NOT_A_REFERENCE: &[&str] = &[
        "const g = (function () { function f() {} if (f.x) return f; })(); g;",
        "const g = (function () { function f() {} if (f.x) return 1; return f; })(); g;",
        "const g = (function () { function f() {} })(); g;",
        "const g = (function* () { function f() {} return f; })(); g;",
        "const g = (async function () { function f() {} return f; })(); g;",
        "function make() { function f() {} return f; } const g = make(); g;",
    ];
    for &text in NOT_A_REFERENCE {
        assert_unknown("a.mjs", text, UnknownReferent::NotAReference);
    }
}

#[test]
fn parameter_that_stands_for_more_than_one_argument() {
    const OPAQUE: &[&str] = &[
        "function f() {} function g(p) { p; } const r = g(f);",
        "function f() {} const r = (function again(p) { const s = again(1); p; })(f);",
        "function f() {} const r = (function (p = 1) { p; })(f);",
        "function f() {} const r = (function (...p) { p; })(f);",
        "function f() {} const r = (function ({ p }) { p; })(f);",
        "function f() {} const r = (function (a, p) { p; })(...[1, f]);",
        "function f() {} const r = (function (a, p) { p; })(f);",
        "function f() {} const g = function (p) { p; }; const r = g(f);",
    ];
    for &text in OPAQUE {
        with_program(&[("a.mjs", text)], |program| {
            let found = program.resolve().referent;
            assert!(matches!(found, StaticReferent::Unknown(_)), "{text}");
        });
    }
    assert_unknown(
        "a.mjs",
        "function f() {} const r = (function (p) { const s = (p = 1); p; })(f);",
        UnknownReferent::UnstableBinding(BindingStability::Stored),
    );
}

#[test]
fn hoisted_variable_is_expected() {
    with_program(&[("a.cjs", "var B = class A {}; B;")], |program| {
        let expected = Resolved {
            referent: program.class(0, "A"),
            certainty: Expected,
        };
        assert_eq!(program.resolve(), expected);
    });
    with_program(&[("a.cjs", "{ function f() {} } f;")], |program| {
        let expected = Resolved {
            referent: program.function(0, "f"),
            certainty: Expected,
        };
        assert_eq!(program.resolve(), expected);
    });
}

#[test]
fn assignment_has_the_assigned_value() {
    const PROVEN: &[&str] = &[
        "class A {} let b; (b = A);",
        "class A {} let b, c; (b = c = A);",
        "class A {} let b; const C = (b = A); C;",
        "class A {} let b; ({ b } = A);",
    ];
    for &text in PROVEN {
        with_program(&[("a.mjs", text)], |program| {
            let expected = Resolved {
                referent: program.class(0, "A"),
                certainty: Proven,
            };
            assert_eq!(program.resolve(), expected, "{text}");
        });
    }
}

#[test]
fn members_of_object_literals_are_expected() {
    const FOUND: &[&str] = &[
        "const o = { f: function f() {} }; o.f;",
        "const o = { f() {} }; o.f;",
        "function f() {} const o = { f }; o.f;",
        "function f() {} const o = { g: f }; o.g;",
        r#"const o = { "f": function f() {} }; o["f"];"#,
        "const o = { f: 1, f() {} }; o.f;",
        "const o = { get g() { return 1; }, g: function f() {} }; o.g;",
        "const o = { ...p, [k]: 1, f() {} }; o.f;",
        "const o = { __proto__: p, f() {} }; o.f;",
        "const o = { p: { f() {} } }; o.p.f;",
        "const { f: g } = { f() {} }; g;",
        "({ f() {} }).f;",
    ];
    for &text in FOUND {
        with_program(&[("a.mjs", text)], |program| {
            let expected = Resolved {
                referent: program.function(0, "f"),
                certainty: Expected,
            };
            assert_eq!(program.resolve(), expected, "{text}");
        });
    }
}

#[test]
fn members_that_object_literals_do_not_name() {
    use UnknownReferent::{MemberOfValue, MissingMember, NotAReference};
    assert_unknown("a.mjs", "const o = { f() {} }; o;", NotAReference);
    assert_unknown("a.mjs", "const o = { f() {} }; o.g;", MissingMember);
    assert_unknown(
        "a.mjs",
        "const o = { get f() { return 1; } }; o.f;",
        MissingMember,
    );
    assert_unknown(
        "a.mjs",
        "const o = { f() {}, set f(v) {} }; o.f;",
        MissingMember,
    );
    assert_unknown("a.mjs", "const o = { f() {}, ...p }; o.f;", MissingMember);
    assert_unknown("a.mjs", "const o = { f() {}, [k]: 1 }; o.f;", MissingMember);
    assert_unknown(
        "a.mjs",
        "const o = { __proto__: { f() {} } }; o.f;",
        MissingMember,
    );
    assert_unknown(
        "a.mjs",
        "const o = { __proto__: p }; o.__proto__;",
        MemberOfValue,
    );
    assert_unknown("a.mjs", "const o = { f: 1 }; o.f;", NotAReference);
}

#[test]
fn imports_are_followed() {
    const IMPORTERS: &[&str] = &[
        r#"import { A } from "./b.mjs"; A;"#,
        r#"import { A as B } from "./b.mjs"; B;"#,
        r#"import { A } from "./b.mjs"; const B = A; B;"#,
        r#"import B from "./b.mjs"; B;"#,
        r#"import * as ns from "./b.mjs"; ns.A;"#,
        r#"import * as ns from "./b.mjs"; ns["A"];"#,
        r#"import * as ns from "./b.mjs"; ns.default;"#,
        r#"import * as ns from "./b.mjs"; const { A } = ns; A;"#,
        r#"import * as ns from "./b.mjs"; const { A: B } = ns; B;"#,
        r#"import * as ns from "./b.mjs"; const other = ns; other.A;"#,
    ];
    for &text in IMPORTERS {
        let exporter = "export class A {} export default A;";
        with_program(&[("a.mjs", text), ("b.mjs", exporter)], |program| {
            let expected = Resolved {
                referent: program.class(1, "A"),
                certainty: Proven,
            };
            assert_eq!(program.resolve(), expected, "{text}");
        });
    }
}

#[test]
fn default_exports() {
    const EXPORTERS: &[&str] = &[
        "export default class A {}",
        "class A {} export default A;",
        "export default (class A {});",
    ];
    for &exporter in EXPORTERS {
        let importer = r#"import B from "./b.mjs"; B;"#;
        with_program(&[("a.mjs", importer), ("b.mjs", exporter)], |program| {
            assert_eq!(
                program.resolve().referent,
                program.class(1, "A"),
                "{exporter}"
            );
        });
    }
}

#[test]
fn module_namespace() {
    let importer = r#"import * as ns from "./b.mjs"; ns;"#;
    with_program(
        &[("a.mjs", importer), ("b.mjs", "export class A {}")],
        |program| {
            let namespace = NamespaceReferent::Module(FileId(1));
            assert_eq!(
                program.resolve().referent,
                StaticReferent::Namespace(namespace)
            );
        },
    );
}

#[test]
fn exporter_that_stores_is_unstable() {
    let importer = r#"import { A } from "./b.mjs"; A;"#;
    let exporter = "export let A = class {}; A = null;";
    with_program(&[("a.mjs", importer), ("b.mjs", exporter)], |program| {
        let reason = UnknownReferent::UnstableBinding(BindingStability::Stored);
        assert_eq!(program.resolve().referent, StaticReferent::Unknown(reason));
    });
}

#[test]
fn builtins_come_from_the_context() {
    for text in ["Error;", "const E = Error; E;", "(Error as any);"] {
        with_program(&[("a.ts", text)], |program| {
            let error = program.files[0].workspace.atom("Error");
            assert_eq!(
                program.resolve().referent,
                StaticReferent::Builtin(error),
                "{text}"
            );
        });
    }
    with_program(&[("a.mjs", "class Error {} Error;")], |program| {
        assert_eq!(program.resolve().referent, program.class(0, "Error"));
    });
}

#[test]
fn members_of_builtins_come_from_the_context() {
    const REFERENCES: &[&str] = &[
        "Map.groupBy;",
        r#"Map["groupBy"];"#,
        "const M = Map; M.groupBy;",
        "const { groupBy } = Map; groupBy;",
    ];
    for &text in REFERENCES {
        with_program(&[("a.mjs", text)], |program| {
            let expected = Resolved {
                referent: StaticReferent::Builtin(program.files[0].workspace.atom("groupBy")),
                certainty: Expected,
            };
            assert_eq!(program.resolve(), expected, "{text}");
        });
    }
    assert_unknown("a.mjs", "Map.missing;", UnknownReferent::MemberOfValue);
    assert_unknown("a.mjs", "Map.groupBy.call;", UnknownReferent::MemberOfValue);
    assert_unknown("a.mjs", "Error.groupBy;", UnknownReferent::MemberOfValue);
}

#[test]
fn whole_exports_of_required_commonjs_files() {
    const EXPORTERS: &[&str] = &[
        "module.exports = class A {};",
        "class A {} module.exports = A;",
        r#"module["exports"] = class A {};"#,
        "class A {} exports = module.exports = A;",
        "class A {} module.exports = exports = A;",
        "var B = module.exports = class A {};",
        "module.exports = 1; module.exports = class A {};",
        "if (x) module.exports = 1; module.exports = class A {};",
        "function set() { module.exports = 1; } module.exports = class A {};",
        "if (x) module.exports = class A {};",
        "function set() { module.exports = class A {}; } set();",
        "(module.exports = class A {}), (module.exports.extra = 1);",
        "try { module.exports = class A {}; } catch { module.exports = 1; }",
        "try { x(); } catch { module.exports = class A {}; }",
        "function f(module) { module.exports = 1; } module.exports = class A {}; f({});",
    ];
    for &exporter in EXPORTERS {
        let importer = r#"const B = require("./b.cjs"); B;"#;
        with_program(&[("a.cjs", importer), ("b.cjs", exporter)], |program| {
            let expected = Resolved {
                referent: program.class(1, "A"),
                certainty: Expected,
            };
            assert_eq!(program.resolve(), expected, "{exporter}");
        });
    }
}

#[test]
fn properties_of_exports_of_required_commonjs_files() {
    const IMPORTERS: &[&str] = &[
        r#"const b = require("./b.cjs"); b.A;"#,
        r#"const { A } = require("./b.cjs"); A;"#,
        r#"const { A: B } = require("./b.cjs"); B;"#,
        r#"const B = require("./b.cjs").A; B;"#,
        r#"require("./b.cjs").A;"#,
        r#"require("./b.cjs")["A"];"#,
    ];
    const EXPORTERS: &[&str] = &[
        "exports.A = class A {};",
        "module.exports.A = class A {};",
        r#"exports["A"] = class A {};"#,
        "class A {} exports.A = A;",
        "class A {} module.exports = { A };",
        "module.exports = { A: class A {} };",
        "exports.A = void 0; exports.A = class A {};",
        "exports.B = exports.A = class A {};",
        "function f() {} module.exports = f; module.exports.A = class A {};",
        "function f() {} exports = module.exports = f; exports.A = class A {};",
        "{ const exports = {}; exports.A = 1; } exports.A = class A {};",
    ];
    for &importer in IMPORTERS {
        for &exporter in EXPORTERS {
            with_program(&[("a.cjs", importer), ("b.cjs", exporter)], |program| {
                let expected = Resolved {
                    referent: program.class(1, "A"),
                    certainty: Expected,
                };
                assert_eq!(program.resolve(), expected, "{importer} {exporter}");
            });
        }
    }
}

#[test]
fn required_files_are_followed() {
    let sources = [
        ("a.cjs", r#"const f = require("./b.cjs"); f;"#),
        (
            "b.cjs",
            r#"try { var c = require("./c.cjs"); if (!c.f) throw ""; module.exports = c.f; }
               catch (e) { module.exports = require("./d.cjs"); }"#,
        ),
        ("c.cjs", "exports.f = function f() {};"),
        ("d.cjs", "module.exports = function g() {};"),
    ];
    with_program(&sources, |program| {
        let expected = Resolved {
            referent: program.function(2, "f"),
            certainty: Expected,
        };
        assert_eq!(program.resolve(), expected);
    });
}

#[test]
fn exports_that_commonjs_files_do_not_name() {
    use BindingStability::NotInitializedOnce;
    use UnknownReferent::*;
    let whole = r#"const B = require("./b.cjs"); B;"#;
    let property = r#"require("./b.cjs").A;"#;
    assert_required_unknown(whole, "exports.A = class A {};", NotAReference);
    assert_required_unknown(whole, "x();", NotAReference);
    assert_required_unknown(whole, "module.exports = 1;", NotAReference);
    assert_required_unknown(
        whole,
        "function f(module) { module.exports = class A {}; } f({});",
        MissingMember,
    );
    assert_required_unknown(
        whole,
        "if (x) module.exports = class A {}; else module.exports = class B {};",
        UnstableBinding(NotInitializedOnce),
    );
    assert_required_unknown(
        whole,
        "module.exports = class A {}; if (x) module.exports = class B {};",
        UnstableBinding(NotInitializedOnce),
    );
    assert_required_unknown(
        whole,
        "try { x(); } catch { module.exports = class A {}; module.exports = class B {}; }",
        UnstableBinding(NotInitializedOnce),
    );
    assert_required_unknown(property, "exports.B = class A {};", MissingMember);
    assert_required_unknown(
        property,
        "module.exports = { B: class A {} };",
        MissingMember,
    );
    assert_required_unknown(property, "module.exports = class B {};", MemberOfValue);
    assert_required_unknown(
        property,
        "{ const exports = {}; exports.A = class A {}; }",
        MissingMember,
    );
    assert_required_unknown(
        property,
        r#"Object.defineProperty(exports, "A", { value: class A {} });"#,
        OpaqueInitializer,
    );
    assert_required_unknown(
        r#"require("./b.cjs")["export="];"#,
        "module.exports = class A {};",
        MemberOfValue,
    );
    assert_required_unknown(r#"require("./missing.cjs");"#, "", NotAReference);
    assert_required_unknown(r#"require(name);"#, "", NotAReference);
    assert_required_unknown(r#"require.resolve("./b.cjs");"#, "", NotAReference);
    assert_required_unknown(
        r#"function f(require) { require("./b.cjs"); }"#,
        "module.exports = class A {};",
        NotAReference,
    );
}

#[test]
fn files_that_require_each_other_end_the_walk() {
    let sources = [
        ("a.cjs", r#"require("./b.cjs");"#),
        ("b.cjs", r#"module.exports = require("./c.cjs");"#),
        ("c.cjs", r#"module.exports = require("./b.cjs");"#),
    ];
    with_program(&sources, |program| {
        let reason = UnknownReferent::Cycle;
        assert_eq!(program.resolve().referent, StaticReferent::Unknown(reason));
    });
}

#[test]
fn required_es_modules() {
    let exporter = "export class A {} export default { A };";
    for importer in [
        r#"const b = require("./b.mjs"); b.A;"#,
        r#"const { A } = require("./b.mjs"); A;"#,
    ] {
        with_program(&[("a.cjs", importer), ("b.mjs", exporter)], |program| {
            let expected = Resolved {
                referent: program.class(1, "A"),
                certainty: Expected,
            };
            assert_eq!(program.resolve(), expected, "{importer}");
            program.requires_default_exports = true;
            assert_eq!(program.resolve(), expected, "{importer}");
        });
    }
    let importer = r#"const b = require("./b.mjs"); b;"#;
    with_program(
        &[("a.cjs", importer), ("b.mjs", "export default class A {}")],
        |program| {
            let namespace = NamespaceReferent::Module(FileId(1));
            assert_eq!(
                program.resolve().referent,
                StaticReferent::Namespace(namespace)
            );
            program.requires_default_exports = true;
            assert_eq!(program.resolve().referent, program.class(1, "A"));
        },
    );
    with_program(
        &[("a.cjs", importer), ("b.mjs", "export class A {}")],
        |program| {
            program.requires_default_exports = true;
            let reason = UnknownReferent::MissingMember;
            assert_eq!(program.resolve().referent, StaticReferent::Unknown(reason));
        },
    );
}

#[test]
fn members_stored_into_an_exported_function() {
    const STORED: &[&str] = &[
        "function f() {} function g() {} f.g = g; export default f;",
        "function f() {} f.g = function g() {}; export default f;",
        "function f() {} function g() {} const h = f; h.g = g; export default h;",
        "class f {} function g() {} f.g = g; export default f;",
        "function f() {} function g() {} assign(f, { g }); export default f;",
        "function f() {} function g() {} assign(f, { a: 1 }, { g: g }); export default f;",
        "function f() {} function g() {} const made = (f.g = g); export default f;",
        "function g() {} g.g = g; export default g;",
        "function g() {} assign(g, { g }); export default g;",
    ];
    for &text in STORED {
        with_program(&[("a.mjs", text)], |program| {
            let expected = Resolved {
                referent: program.function(0, "g"),
                certainty: Expected,
            };
            assert_eq!(
                program.resolve_default_export(Some("g")),
                expected,
                "{text}"
            );
        });
    }
    let typed = "function f() {} function g() {} (f as any).g = g as any; export default f as any;";
    with_program(&[("a.ts", typed)], |program| {
        assert_eq!(
            program.resolve_default_export(Some("g")).referent,
            program.function(0, "g")
        );
        assert_eq!(
            program.resolve_default_export(None).referent,
            program.function(0, "f")
        );
    });
}

#[test]
fn members_stored_by_the_files_on_the_way() {
    let sources = [
        (
            "a.mjs",
            r#"import all from "./b.mjs"; import g from "./d.mjs"; all.late = g; export default all;"#,
        ),
        (
            "b.mjs",
            r#"import { f } from "./c.mjs"; import g from "./d.mjs"; f.g = g; export default f;"#,
        ),
        (
            "c.mjs",
            "export function f() {} function own() {} f.own = own;",
        ),
        ("d.mjs", "export default function g() {}"),
    ];
    with_program(&sources, |program| {
        assert_eq!(
            program.resolve_default_export(None).referent,
            program.function(2, "f")
        );
        for name in ["g", "late"] {
            assert_eq!(
                program.resolve_default_export(Some(name)).referent,
                program.function(3, "g")
            );
        }
        assert_eq!(
            program.resolve_default_export(Some("own")).referent,
            program.function(2, "own")
        );
    });
}

#[test]
fn members_that_no_one_store_decides() {
    use BindingStability::NotInitializedOnce;
    use UnknownReferent::{MemberOfValue, MissingMember, UnstableBinding};
    const UNKNOWN: &[(&str, UnknownReferent)] = &[
        ("function f() {} export default f;", MissingMember),
        (
            "function f() {} function g() {} f.h = g; export default f;",
            MissingMember,
        ),
        (
            "function f() {} function g() {} function late() { f.g = g; } export default f;",
            MissingMember,
        ),
        (
            "function f() {} function g() {} if (f) f.g = g; export default f;",
            MissingMember,
        ),
        (
            "function f() {} function g() {} const o = {}; o.g = g; export default f;",
            MissingMember,
        ),
        (
            "function f() {} function g() {} assign({}, f, { g }); export default f;",
            MissingMember,
        ),
        (
            "function f() {} function g() {} f.g = g; f.g = f; export default f;",
            UnstableBinding(NotInitializedOnce),
        ),
        (
            "function f() {} function g() {} f.g = g; assign(f, { g }); export default f;",
            UnstableBinding(NotInitializedOnce),
        ),
    ];
    for &(text, reason) in UNKNOWN {
        with_program(&[("a.mjs", text)], |program| {
            let found = program.resolve_default_export(Some("g")).referent;
            assert_eq!(found, StaticReferent::Unknown(reason), "{text}");
        });
    }
    assert_unknown(
        "a.mjs",
        "function f() {} function g() {} f.g = g; f.g;",
        MemberOfValue,
    );
    with_program(
        &[(
            "a.mjs",
            "function f() {} function g() {} f.g = g; export default f;",
        )],
        |program| {
            program.ignores_stores = true;
            let found = program.resolve_default_export(Some("g")).referent;
            assert_eq!(found, StaticReferent::Unknown(MissingMember));
        },
    );
}

const NAMESPACE: &str = "namespace N { export class A {} export function f() {} \
                         export const v = 1; export namespace M { export class B {} } \
                         export enum E { X } class Hidden {} }";

fn resolve_beside_namespace(
    reference: &str,
    test: impl for<'s> FnOnce(&Program<'s>, Resolved) + Send,
) {
    let text: &'static str = format!("{NAMESPACE} {reference};").leak();
    with_program(&[("a.ts", text)], |program| {
        test(program, program.resolve())
    });
}

#[test]
fn members_of_declared_namespaces() {
    resolve_beside_namespace("N.A", |program, found| {
        assert_eq!(
            (found.referent, found.certainty),
            (program.class(0, "A"), Expected)
        );
    });
    resolve_beside_namespace("N.f", |program, found| {
        assert_eq!(
            (found.referent, found.certainty),
            (program.function(0, "f"), Expected)
        );
    });
    resolve_beside_namespace("N.M.B", |program, found| {
        assert_eq!(found.referent, program.class(0, "B"));
    });
    resolve_beside_namespace("N", |_, found| {
        let is_declared = matches!(
            found.referent,
            StaticReferent::Namespace(NamespaceReferent::Declared(_))
        );
        assert!(is_declared && found.certainty == Expected);
    });
}

#[test]
fn properties_of_declared_namespaces_are_unknown() {
    let container_member = UnknownReferent::UnstableBinding(BindingStability::ContainerMember);
    for property in ["N.v", "N.E.X"] {
        resolve_beside_namespace(property, |_, found| {
            assert_eq!(
                found.referent,
                StaticReferent::Unknown(container_member),
                "{property}"
            );
        });
    }
    for missing in ["N.Hidden", "N.missing", "N.M.missing"] {
        resolve_beside_namespace(missing, |_, found| {
            let reason = UnknownReferent::MissingMember;
            assert_eq!(found.referent, StaticReferent::Unknown(reason), "{missing}");
        });
    }
}

#[test]
fn entity_names() {
    let text = "namespace N { export namespace M { export class A {} } } import B = N.M.A; B;";
    with_program(&[("a.ts", text)], |program| {
        assert_eq!(program.resolve().referent, program.class(0, "A"));
    });
}

#[test]
fn dead_stores_are_the_contexts_answer() {
    with_program(
        &[("a.mjs", "class A {} let B = A; if (false) B = 1; B;")],
        |program| {
            let reason = UnknownReferent::UnstableBinding(BindingStability::Stored);
            assert_eq!(program.resolve().referent, StaticReferent::Unknown(reason));
            program.ignores_stores = true;
            assert_eq!(program.resolve().referent, program.class(0, "A"));
        },
    );
    let importer = r#"const B = require("./b.cjs"); B;"#;
    let exporter = "module.exports = class A {};";
    with_program(&[("a.cjs", importer), ("b.cjs", exporter)], |program| {
        assert_eq!(program.resolve().referent, program.class(1, "A"));
        program.ignores_stores = true;
        let reason = UnknownReferent::MissingMember;
        assert_eq!(program.resolve().referent, StaticReferent::Unknown(reason));
    });
}

#[test]
fn symbols_resolve_like_their_references() {
    with_program(&[("a.mjs", "class A {} const B = A; B;")], |program| {
        let id = program.files[0].variable("B", 0);
        let file = FileId(0);
        assert_eq!(
            symbol_referent(&*program, Sym { file, id }),
            program.resolve()
        );
    });
}

#[test]
fn unknown_referents() {
    use BindingStability::{MappedArgument, NotInitializedOnce, Stored, VisibleToEval};
    use UnknownReferent::*;
    assert_unknown("a.mjs", "missing;", FreeName);
    assert_unknown("a.mjs", "1;", NotAReference);
    assert_unknown("a.mjs", "f();", NotAReference);
    assert_unknown("a.mjs", "class A {} (0, A);", NotAReference);
    assert_unknown("a.mjs", "class A {} (x ? A : A);", NotAReference);
    assert_unknown("a.mjs", "class A {} let b = A; (b += A);", NotAReference);
    assert_unknown("a.mjs", "class A {} A?.b;", NotAReference);
    assert_unknown("a.mjs", "class A {} A[k];", NotAReference);
    assert_unknown(
        "a.mjs",
        "class A { static #p; static m() { A.#p; } }",
        NotAReference,
    );
    assert_unknown("a.cjs", "module;", NotAReference);
    assert_unknown("a.cjs", "function f() { arguments; }", NotAReference);
    assert_unknown("a.cjs", "class A {} with (o) { A; }", DynamicScope);
    assert_unknown(
        "a.cjs",
        r#"class A {} function f() { eval(""); A; }"#,
        DynamicScope,
    );
    assert_unknown(
        "a.mjs",
        "class A {} let B = A; B = 1; B;",
        UnstableBinding(Stored),
    );
    assert_unknown(
        "a.cjs",
        "var B = 1; var B = 2; B;",
        UnstableBinding(NotInitializedOnce),
    );
    assert_unknown(
        "a.cjs",
        r#"let B = 1; eval(""); B;"#,
        UnstableBinding(VisibleToEval),
    );
    assert_unknown(
        "a.cjs",
        "function f(p) { arguments; p; }",
        UnstableBinding(MappedArgument),
    );
    assert_unknown("a.mjs", "function f(p) { p; }", OpaqueInitializer);
    assert_unknown("a.mjs", "const [B] = o; B;", OpaqueInitializer);
    assert_unknown("a.mjs", "for (const B of o) { B; }", OpaqueInitializer);
    assert_unknown("a.ts", "@d class A {} A;", DecoratedClass);
    assert_unknown("a.ts", "const B = @d class A {}; B;", DecoratedClass);
    assert_unknown(
        "a.mjs",
        r#"import { A } from "./missing.mjs"; A;"#,
        UnlinkedImport,
    );
    assert_unknown("a.mjs", "class A {} A.prototype;", MemberOfValue);
    assert_unknown("a.mjs", "function f() {} f.call;", MemberOfValue);
    assert_unknown("a.mjs", "Error.prototype;", MemberOfValue);
    assert_unknown("a.mjs", "const a = b; const b = a; a;", Cycle);
    assert_unknown("a.mjs", "const { a } = a; a;", Cycle);
}

#[test]
fn file_bound_for_check_is_not_compiled() {
    with_program(&[("a.mjs", "class A {} A;")], |program| {
        let workspace = program.files[0].workspace;
        program.files[0].bound = workspace.bind_for_check(&program.files[0].hir);
        let reason = UnknownReferent::NotCompiled;
        assert_eq!(program.resolve().referent, StaticReferent::Unknown(reason));
    });
}

#[test]
fn long_alias_chain_ends() {
    let mut text = String::from("class A {} const a0 = A;");
    for index in 1..2_000 {
        text.push_str(&format!("const a{index} = a{};", index - 1));
    }
    text.push_str("a1999;");
    let text: &'static str = text.leak();
    with_program(&[("a.mjs", text)], |program| {
        assert_eq!(program.resolve().referent, program.class(0, "A"));
    });
}
