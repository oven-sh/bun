use super::summary::{StoredName, summarize_file};
use super::{
    AliasTarget, CommonJsExports, CommonJsInput, ModuleEntries, NameEntry, scan_commonjs_modules,
};
use crate::compile::testing::{default_settings, with_bind_input};
use crate::modules::module_set::collect_modules;
use crate::modules::order::compute_order;
use crate::modules::requests::{ScannedSite, scan_files};
use crate::modules::testing::{
    describe_module_ref, file_named, member_named, symbol_named, with_graph,
};
use crate::modules::{BindInput, Member, ModuleGraph, ModuleRef, Shape, bind_modules};
use bstr::BStr;
use bun_sema::atom::{Atom, known};
use bun_sema::program::FileId;

const READS_A: &str = "const m = require('./m.cjs'); console.log(m.a);";
const IMPORTS_A: &str = "import { a } from './m.cjs'; console.log(a);";
const K: (&str, &str) = ("k.cjs", "exports.b = 1;");
const MARKER: &str = "Object.defineProperty(exports, '__esModule', { value: true });";
const ONLY_TESTED: &str = "exports.a = 1; var b = exports && 1, c = !exports, d = exports ? 1 : 2, e = exports == null; if (module.exports) console.log(b);";

const BARREL: &str = "exports.a = void 0;
var k_1 = require('./k.cjs');
Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return k_1.b; } });
";

const EXPORT_STAR: &str = r#"var __createBinding = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
};
var __exportStar = function(m, o) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
};
"#;

const SWC_EXPORT: &str = "function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
";

const SWC_NAMES: &str = "_export(exports, {
    a: function() {
        return a;
    },
    b: function() {
        return b;
    }
});
const a = 1;
function b() { return a; }
";

const ESBUILD_HELPERS: &str = r#"var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
"#;

const MARKING_HELPERS: &str = r#"var __defProp = Object.defineProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __export = (target, all) => {
  __markAsModule(target);
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
"#;

const IMPORT_DEFAULT: &str = r#"var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };"#;

const STAR_OF_K: &str = "__exportStar(require('./k.cjs'), exports);";
const STAR_IN_LINE_OF_K: &str = r#"var _k = require('./k.cjs');
Object.keys(_k).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _k[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _k[key];
    }
  });
});"#;
const RE_EXPORT_OF_K: &str = "__reExport(exports, require('./k.cjs'));";
const ASSIGN_OF_K: &str = "Object.assign(exports, require('./k.cjs'));";
const BINDING_OF_B: &str = "__createBinding(exports, require('./k.cjs'), 'b', 'a');";
const EXPORT_OF_A: &str = "__export(exports, { a: () => a }); var a = 1;";
const ALL_OF_K: &str = "all of k.cjs, marker unknown";

fn define_a(descriptor: &str) -> String {
    format!("Object.defineProperty(exports, 'a', {{ {descriptor} }});")
}

fn getter_of_b(attributes: &str) -> String {
    let descriptor = format!("{attributes}get: function () {{ return k.b; }}");
    format!("var k = require('./k.cjs'); {}", define_a(&descriptor))
}

fn with_commonjs_input<R>(
    bind: &BindInput<'_, '_>,
    then: impl FnOnce(&CommonJsInput<'_, '_, '_>) -> R,
) -> R {
    let scans = scan_files(bind);
    let modules = collect_modules(bind, &scans);
    let (order, _) = compute_order(bind, &scans, &modules);
    let input = CommonJsInput {
        bind,
        scans: &scans,
        modules: &modules,
        half: &|module: ModuleRef| order.half(module),
        half_at_link: &|module: ModuleRef| order.half_at_link(module),
        is_prefix_root: &|file: FileId| order.is_prefix_root(file),
    };
    then(&input)
}

fn text_of(bind: &BindInput<'_, '_>, atom: Atom) -> String {
    BStr::new(bind.files.atoms.bytes(atom)).to_string()
}

fn describe_stored(input: &CommonJsInput<'_, '_, '_>, file: FileId, stored: StoredName) -> String {
    let bind = input.bind;
    let if_skippable = match stored.statement().is_none() {
        true => "?",
        false => "",
    };
    match stored {
        StoredName::Value { name, .. } => format!("{}{if_skippable}", text_of(bind, name)),
        StoredName::Getter {
            name,
            is_enumerable: true,
            ..
        } => format!("get {}{if_skippable}", text_of(bind, name)),
        StoredName::Getter { name, .. } => {
            format!("hidden get {}{if_skippable}", text_of(bind, name))
        }
        StoredName::AllOf { site, .. } => match &input.scans.of(file).sites[site as usize] {
            ScannedSite::Module(module) => {
                format!(
                    "all of {}{if_skippable}",
                    describe_module_ref(bind, *module)
                )
            }
            other => format!("all of {other:?}"),
        },
    }
}

fn describe_summary(input: &CommonJsInput<'_, '_, '_>, file: FileId) -> String {
    let summary = summarize_file(input, file);
    if summary.module_object_escapes {
        return "module escapes".to_owned();
    }
    if summary.replaced_by.is_some() {
        return "replaced".to_owned();
    }
    if summary.object_escapes {
        return "escapes".to_owned();
    }
    let mut lines: Vec<String> = Vec::new();
    let names = summary.names.iter().copied();
    for stored in names.filter(|stored| stored.name() != Some(known::__esModule)) {
        let line = describe_stored(input, file, stored);
        if !lines.contains(&line) {
            lines.push(line);
        }
    }
    match summary.marker {
        Some(true) => lines.push("marker true".to_owned()),
        Some(false) => {}
        None => lines.push("marker unknown".to_owned()),
    }
    lines.join(", ")
}

fn describe_entry(bind: &BindInput<'_, '_>, entry: &NameEntry) -> String {
    let if_skippable = match entry.created_at {
        u32::MAX => "?",
        _ => "",
    };
    let target = match entry.getter.map(|getter| getter.target) {
        None => String::new(),
        Some(AliasTarget::Member { module, name }) => {
            let module = describe_module_ref(bind, module);
            format!(" = {module} {}", text_of(bind, name))
        }
        Some(AliasTarget::Binding(symbol)) => {
            format!(" = #{}", text_of(bind, bind.files.symbol(symbol).name))
        }
    };
    let hidden = match entry.is_enumerable {
        true => "",
        false => " hidden",
    };
    format!(
        "{}{if_skippable}{target}{hidden}",
        text_of(bind, entry.name)
    )
}

fn with_entries<R>(
    bind: &BindInput<'_, '_>,
    module: &str,
    then: impl FnOnce(&ModuleEntries) -> R,
) -> R {
    let module = ModuleRef::File(file_named(bind, module));
    with_commonjs_input(bind, |input| {
        let entries = scan_commonjs_modules(input).entries();
        let entries = entries.iter().find(|entries| entries.module == module);
        then(entries.expect("no CommonJS module of the program"))
    })
}

fn describe_names(bind: &BindInput<'_, '_>, module: &str) -> Option<Vec<String>> {
    with_entries(bind, module, |entries| {
        let names = entries.names.iter();
        let names = names.filter(|entry| entry.name != known::__esModule);
        let names = names.map(|entry| describe_entry(bind, entry));
        entries.has_names.then(|| names.collect())
    })
}

fn describe_name(bind: &BindInput<'_, '_>, module: &str, name: &str) -> Option<String> {
    let name = bind.files.atoms.intern(name.as_bytes());
    with_entries(bind, module, |entries| {
        let mut named = entries.names.iter().filter(|entry| entry.name == name);
        let first = named.next().map(|entry| describe_entry(bind, entry));
        assert!(named.next().is_none(), "the tables list a name twice");
        let first = first.unwrap_or_else(|| "absent".to_owned());
        entries.has_names.then_some(first)
    })
}

fn stored_markers(bind: &BindInput<'_, '_>) -> Vec<ModuleRef> {
    with_commonjs_input(bind, |input| {
        scan_commonjs_modules(input).markers_stored_from_outside()
    })
}

fn with_module<R>(source: &str, then: impl FnOnce(&BindInput<'_, '_>) -> R) -> R {
    let files = [("main.cjs", "require('./m.cjs');"), ("m.cjs", source), K];
    with_bind_input(&files, &default_settings(), then)
}

fn summarize(source: &str) -> String {
    with_module(source, |bind| {
        let file = file_named(bind, "m.cjs");
        with_commonjs_input(bind, |input| describe_summary(input, file))
    })
}

struct Program<'a, 'i, 's> {
    graph: &'a ModuleGraph,
    input: &'a BindInput<'i, 's>,
}

fn with_program<R>(files: &[(&str, &str)], then: impl FnOnce(&Program<'_, '_, '_>) -> R) -> R {
    with_graph(files, |graph, input| then(&Program { graph, input }))
}

fn with_required<R>(module: &str, then: impl FnOnce(&Program<'_, '_, '_>) -> R) -> R {
    with_program(&[("main.cjs", READS_A), ("m.cjs", module), K], then)
}

fn with_imported<R>(module: &str, then: impl FnOnce(&Program<'_, '_, '_>) -> R) -> R {
    with_program(&[("main.mjs", IMPORTS_A), ("m.cjs", module), K], then)
}

impl Program<'_, '_, '_> {
    fn file(&self, name: &str) -> FileId {
        file_named(self.input, name)
    }

    fn module(&self, name: &str) -> ModuleRef {
        ModuleRef::File(self.file(name))
    }

    fn atom(&self, text: &str) -> Atom {
        self.input.files.atoms.intern(text.as_bytes())
    }

    fn exports(&self) -> &CommonJsExports {
        self.graph.commonjs()
    }

    fn keeps_names(&self, module: &str) -> bool {
        let module = self.module(module);
        let keeps_names = self.exports().has_names(module);
        assert_eq!(self.exports().shape(module) == Shape::Names, keeps_names);
        keeps_names
    }

    fn is_settled(&self, module: &str, name: &str) -> bool {
        let (module, name) = (self.module(module), self.atom(name));
        self.exports().settled(module, name)
    }

    fn marker(&self, module: &str) -> Option<bool> {
        self.graph.marker(self.module(module))
    }

    fn describe(&self, member: Option<Member>) -> String {
        let variable = |id| {
            let export = self.graph.synthetic_export(id);
            let module = describe_module_ref(self.input, export.module);
            format!("{module} {}", text_of(self.input, export.name))
        };
        match member {
            None => "nothing".to_owned(),
            Some(Member::Variable(id)) => variable(id),
            Some(Member::Copy(id)) => format!("copy of {}", variable(id)),
            Some(Member::Binding(symbol)) => {
                let module = describe_module_ref(self.input, ModuleRef::File(symbol.file));
                let name = self.input.files.symbol(symbol).name;
                format!("{module}#{}", text_of(self.input, name))
            }
            Some(Member::Undefined) => "undefined".to_owned(),
            Some(Member::Marker(flag)) => format!("marker {flag}"),
            Some(Member::OnObject) => "object".to_owned(),
        }
    }

    fn member(&self, module: &str, name: &str) -> String {
        let (module, name) = (self.module(module), self.atom(name));
        self.describe(self.exports().member_named(module, name))
    }

    fn imported(&self, module: &str, name: &str) -> &'static str {
        let (file, name) = (self.file(module), self.atom(name));
        let variable = self.graph.variable_of(ModuleRef::File(file), name);
        let variable = variable.expect("no binding asks for the name");
        let copies = self.exports().copies(file);
        match self.exports().imported_member(variable) {
            Member::Variable(bound_to) if bound_to == variable => "variable",
            Member::Copy(copy) if copy == variable && copies.contains(&copy) => "copy",
            member => panic!("{member:?}"),
        }
    }

    fn checked(&self, root: &str) -> Vec<String> {
        let copies = self.exports().checked_copies(self.file(root)).iter();
        let describe = |entry: &(_, _)| self.describe(Some(Member::Variable(entry.0)));
        copies.map(describe).collect()
    }
}

#[test]
fn a_store_under_a_constant_name_is_a_name() {
    for (source, said) in [
        ("exports.a = 1;", "a"),
        ("module.exports.a = 1;", "a"),
        ("exports['a'] = 1;", "a"),
        ("exports.b = 1; exports.a = 2; exports.b = 3;", "b, a"),
        ("exports.a = exports.b = void 0;", "b, a"),
        (
            "const b = 1; module.exports = { a: 1, b, 'c': 2 };",
            "a, b, c",
        ),
        ("const table = { a: 1 }; module.exports = table;", "a"),
        (
            "module.exports = { a: 1 }; module.exports.b = module.exports.a;",
            "a, b",
        ),
        ("exports.a = function () { return exports.a; };", "a"),
        ("if (Math.random()) exports.a = 1;", "a?"),
        ("exports.a = 1; if (Math.random()) exports.a = 2;", "a, a?"),
        (
            "function set() { exports.a = 1; } exports.set = set;",
            "set, a?",
        ),
        (ONLY_TESTED, "a"),
    ] {
        assert_eq!(summarize(source), said, "{source}");
    }
}

#[test]
fn a_name_or_this_that_belongs_to_a_function_is_not_the_object() {
    for source in [
        "function f(exports) { exports.z = 1; return exports; } exports.a = f;",
        "function f() { var exports = {}; exports.z = 1; return exports; } exports.a = f;",
        "function f(module) { module.exports = 1; return module; } exports.a = f;",
        "exports.a = function () { this.z = 1; return this; };",
    ] {
        assert_eq!(summarize(source), "a", "{source}");
    }
}

#[test]
fn dead_code_says_nothing() {
    for source in [
        "if (false) console.log(exports); exports.a = 1;",
        "0 && (module.exports = { z: null }); exports.a = 1;",
        "exports.a = 1; if (false) exports.z = 1;",
    ] {
        assert_eq!(summarize(source), "a", "{source}");
    }
}

#[test]
fn the_object_escapes_unless_it_is_only_accessed_by_constant_names() {
    for source in [
        "console.log(exports);",
        "console.log(module.exports);",
        "console.log(this);",
        "this.b = 1;",
        "exports.f = () => this;",
        "var b = exports || 1;",
        "var b = exports; b.c = 1;",
        "delete exports.a;",
        "exports.a++;",
        "exports[Math.random()] = 1;",
        "exports.__proto__ = null;",
        "exports.toString = 2;",
        "exports['0'] = 2;",
        "for (const key in exports) console.log(key);",
        "Object.keys(exports);",
        "console.log({ ...exports });",
    ] {
        let source = format!("exports.a = 1; {source}");
        assert_eq!(summarize(&source), "escapes", "{source}");
    }
    for source in [
        "console.log(module);",
        "Object.defineProperty(module, 'exports', { get() { return 1; } });",
    ] {
        assert_eq!(summarize(source), "module escapes", "{source}");
    }
}

#[test]
fn the_typescript_helper_preamble_does_not_let_this_escape() {
    assert_eq!(summarize(&format!("{IMPORT_DEFAULT} exports.a = 1;")), "a");
    assert_eq!(
        summarize(&format!("exports.a = 1; {IMPORT_DEFAULT}")),
        "escapes"
    );
}

#[test]
fn module_exports_is_replaced_by_another_value() {
    for source in [
        "module.exports = Math.random();",
        "module.exports = function () {};",
        "const table = { a: 1 }; module.exports = table; table.b = 2;",
        "const table = { a: 1 }; console.log(1); module.exports = table;",
        "const table = { a: 1 }, other = 2; module.exports = table;",
        "let table = { a: 1 }; module.exports = table; table = 2;",
        "const table = { a: 1, f() { return table; } }; module.exports = table;",
        "module.exports = { a: 1, ...Math };",
        "module.exports = { a: 2, toString() {} };",
        "exports.b = 1; module.exports = { a: 1 };",
        "module.exports = { a: 1 }; exports.b = 1;",
    ] {
        assert_eq!(summarize(source), "replaced", "{source}");
    }
}

#[test]
fn the_marker_is_true_when_the_body_stores_it_before_every_load() {
    for (source, said) in [
        (
            "exports.__esModule = true; exports.a = 1;",
            "a, marker true",
        ),
        (MARKER, "marker true"),
        (
            "Object.defineProperty(exports, '__esModule', { value: false });",
            "marker unknown",
        ),
        (
            "exports.__esModule = true; require('./k.cjs');",
            "marker true",
        ),
        (
            "require('./k.cjs'); exports.__esModule = true;",
            "marker unknown",
        ),
        ("exports.__esModule = Math.random() < 1;", "marker unknown"),
        (
            "if (Math.random()) exports.__esModule = true;",
            "marker unknown",
        ),
        (
            "exports.__esModule = true; exports.__esModule = false;",
            "marker unknown",
        ),
    ] {
        assert_eq!(summarize(source), said, "{source}");
    }
}

#[test]
fn a_call_that_defines_names() {
    let (listed, hidden) = (getter_of_b("enumerable: true, "), getter_of_b(""));
    let marked_star = format!("exports.__esModule = true; {STAR_OF_K}");
    for (helpers, source, said) in [
        ("", &listed[..], "get a"),
        ("", &hidden[..], "hidden get a"),
        ("", &getter_of_b("enumerable: false, ")[..], "hidden get a"),
        ("", BARREL, "get a"),
        (SWC_EXPORT, SWC_NAMES, "get a, get b"),
        (ESBUILD_HELPERS, EXPORT_OF_A, "get a"),
        (EXPORT_STAR, STAR_OF_K, ALL_OF_K),
        ("", STAR_IN_LINE_OF_K, ALL_OF_K),
        (EXPORT_STAR, &marked_star[..], "all of k.cjs, marker true"),
        (EXPORT_STAR, BINDING_OF_B, "get a"),
        (ESBUILD_HELPERS, RE_EXPORT_OF_K, ALL_OF_K),
        ("", ASSIGN_OF_K, ALL_OF_K),
        ("", "Object.assign(exports, { a: 1 });", "a"),
        ("", &define_a("value: 1")[..], "a"),
        (
            MARKING_HELPERS,
            "__markAsModule(exports); exports.a = 1;",
            "a, marker true",
        ),
        (MARKING_HELPERS, EXPORT_OF_A, "get a, marker true"),
    ] {
        assert_eq!(summarize(&format!("{helpers}{source}")), said, "{source}");
    }
}

#[test]
fn a_call_of_another_form_lets_the_object_escape() {
    let keeps_enumerable = BARREL.replace("enumerable: true, ", "");
    for source in [
        &keeps_enumerable[..],
        "Object.defineProperty(exports, Math.random(), { get() { return 1; } });",
        "const d = { get() { return 1; } }; Object.defineProperty(exports, 'a', d);",
        "var Object = { defineProperty() {} }; Object.defineProperty(exports, 'a', { get() { return 1; } });",
        "if (Math.random()) Object.defineProperty(exports, 'a', { get() { return 1; } });",
        "console.log(Object.defineProperty(exports, 'a', { get() { return 1; } }));",
        "function __reExport(o, m) { o.z = m; } __reExport(exports, require('./k.cjs'));",
        "__exportStar(Math, exports);",
        "const all = { a: function () { return 1; } }; _export(exports, all);",
        "_export = console.log; _export(exports, { a: function () { return 1; } });",
        "function later() { _export(exports, { a: function () { return 1; } }); } later();",
    ] {
        let said = summarize(&format!("{EXPORT_STAR}{SWC_EXPORT}{source}"));
        assert_eq!(said, "escapes", "{source}");
    }
}

#[test]
fn the_copy_esbuild_makes_gives_names_only_if_nothing_else_uses_the_copied_object() {
    let write = |names: &str| format!("{ESBUILD_HELPERS}var all = {names}\nconst a = 1;\n");
    let module = write("{};\n__export(all, { a: () => a });\nmodule.exports = __toCommonJS(all);");
    assert_eq!(summarize(&module), "get a, marker true");
    with_required(&module, |program| {
        assert!(program.keeps_names("m.cjs"));
        assert_eq!(program.marker("m.cjs"), Some(true));
        assert_eq!(program.member("m.cjs", "a"), "m.cjs#a");
    });
    for names in [
        "{};\n__export(all, { a: () => a });\nconsole.log(all);\nmodule.exports = __toCommonJS(all);",
        "{};\n__export(all, { a: () => a });\nall.c = 1;\nmodule.exports = __toCommonJS(all);",
        "{ c: 1 };\n__export(all, { a: () => a });\nmodule.exports = __toCommonJS(all);",
        "{};\nmodule.exports = __toCommonJS(all);\n__export(all, { a: () => a });",
        "{};\nif (Math.random()) __export(all, { a: () => a });\nmodule.exports = __toCommonJS(all);",
    ] {
        assert_eq!(summarize(&write(names)), "replaced", "{names}");
    }
}

#[test]
fn the_names_a_file_reads_from_its_own_exports() {
    let reads = |source: &str| {
        with_module(source, |bind| {
            let module = ModuleRef::File(file_named(bind, "m.cjs"));
            with_commonjs_input(bind, |input| {
                let texts = scan_commonjs_modules(input);
                let names = texts.names_read_by_own_text();
                let names = names.filter(|read| read.0 == module);
                let mut names: Vec<String> = names.map(|read| text_of(bind, read.1)).collect();
                names.sort_unstable();
                names.dedup();
                names
            })
        })
    };
    let source = "exports.a = 1; exports.b = exports.a; exports.c = () => module.exports.b;";
    assert_eq!(reads(source), ["a", "b"]);
    assert!(reads("exports.a = 1;").is_empty());
}

#[test]
fn the_tables_list_each_name_once_in_source_order() {
    let (listed, hidden) = (getter_of_b("enumerable: true, "), getter_of_b(""));
    let getter_of_x = define_a("enumerable: true, get: function () { return x; }");
    let getter_of_x = format!("{getter_of_x} const x = 1;");
    for (source, names) in [
        (
            "exports.b = 1; exports.a = 2; exports.b = 3;",
            &["b", "a"][..],
        ),
        ("exports.a = exports.b = void 0;", &["a", "b"][..]),
        ("exports.__esModule = true; exports.a = 1;", &["a"][..]),
        (
            "exports.a = 1; if (Math.random()) exports.a = 2;",
            &["a"][..],
        ),
        (&listed[..], &["a = k.cjs b"][..]),
        (&hidden[..], &["a = k.cjs b hidden"][..]),
        (BARREL, &["a = k.cjs b"][..]),
        (&getter_of_x[..], &["a = #x"][..]),
    ] {
        let found = with_module(source, |bind| describe_names(bind, "m.cjs"));
        assert_eq!(found.expect("the file keeps its object"), names, "{source}");
    }
    let source = "exports.a = 1; console.log(exports);";
    assert_eq!(
        with_module(source, |bind| describe_names(bind, "m.cjs")),
        None
    );
}

#[test]
fn no_store_is_lost() {
    for (helpers, source, name) in [
        ("", "const u = module.exports; u.a = 1;", "a"),
        ("", "module['exports'].a = 1;", "a"),
        ("", "[exports.a] = [1];", "a"),
        ("", "({ a: exports.a } = { a: 1 });", "a"),
        ("", "for (exports.a of [1]);", "a"),
        ("", "exports.a ||= 1;", "a"),
        ("", "(function () { exports.a = 1; })();", "a"),
        ("", "class C { static { exports.a = 1; } }", "a"),
        ("", "Object.assign(exports, { a: 1 });", "a"),
        ("", &define_a("value: 1")[..], "a"),
        (
            "",
            "Reflect.defineProperty(exports, 'a', { value: 1 });",
            "a",
        ),
        (EXPORT_STAR, BINDING_OF_B, "a"),
        (EXPORT_STAR, STAR_OF_K, "b"),
        (ESBUILD_HELPERS, RE_EXPORT_OF_K, "b"),
        ("", ASSIGN_OF_K, "b"),
    ] {
        let source = format!("{helpers}{source}");
        let found = with_module(&source, |bind| describe_name(bind, "m.cjs", name));
        assert_ne!(found.as_deref(), Some("absent"), "{source}");
    }
}

#[test]
fn a_name_the_body_may_not_store_is_checked_at_link_time() {
    let defined = getter_of_b("enumerable: true, ");
    let sometimes_defined = defined.replace("; Object", "; if (Math.random()) Object");
    for module in [
        "exports.b = 1;",
        "if (Math.random()) exports.a = 1;",
        "Math.random() && (exports.a = 1);",
        "Math.random() ? exports.a = 1 : 0;",
        "switch (Math.random()) { case 0: exports.a = 1; }",
        "for (const x of []) exports.a = 1;",
        "try { g(); exports.a = 1; } catch {}",
        "if (Math.random()) return; exports.a = 1;",
        "globalThis.nothing?.(exports.a = 1);",
        "exports.a &&= 1;",
        "exports.b || (exports.a = 1);",
        "let x; [x = (exports.a = 1)] = [5];",
        "function set() { exports.a = 1; } exports.set = set;",
        &sometimes_defined[..],
    ] {
        with_imported(module, |program| {
            let entry = describe_name(program.input, "m.cjs", "a");
            let is_sure = |entry: &str| entry != "a?" && entry != "absent";
            assert!(
                !entry.as_deref().is_some_and(is_sure),
                "{module}: {entry:?}"
            );
            assert!(!program.is_settled("m.cjs", "a"), "{module}");
            assert_eq!(program.imported("m.cjs", "a"), "copy", "{module}");
            assert_eq!(program.checked("main.mjs"), ["m.cjs a"], "{module}");
        });
    }
}

#[test]
fn an_import_of_a_settled_name_is_bound_to_the_variable() {
    for module in [
        "exports.a = 1;",
        "exports.a = void 0; exports.a = 1;",
        "{ exports.a = 1; }",
        "var b = (exports.a = 1, 2);",
        ONLY_TESTED,
        "exports.a = 1; if (Math.random()) exports.a = 2;",
        "exports.a || (exports.a = 1);",
        "module.exports = { a: 1 };",
        "exports.a = void 0; var a; (function (a) { a[a['x'] = 0] = 'x'; })(a || (exports.a = a = {}));",
        "var a; (function (a) { a[a['x'] = 0] = 'x'; })(a = exports.a || (exports.a = {}));",
    ] {
        with_imported(module, |program| {
            assert!(program.keeps_names("m.cjs"), "{module}");
            assert!(program.is_settled("m.cjs", "a"), "{module}");
            assert_eq!(program.imported("m.cjs", "a"), "variable", "{module}");
            assert_eq!(program.exports().facade(program.module("m.cjs")), None);
            assert!(program.checked("main.mjs").is_empty(), "{module}");
        });
    }
}

#[test]
fn an_import_holds_a_copy_of_a_name_stored_after_the_body_ends() {
    for module in [
        "exports.a = 1; exports.set = () => { exports.a = 2; };",
        "exports.a = 1; setTimeout(() => { exports.a = 2; });",
        "exports.a = 1; class C { static set() { exports.a = 2; } } exports.C = C;",
        "exports.a = 1; (async () => { await 0; exports.a = 2; })();",
    ] {
        with_imported(module, |program| {
            let file = program.file("m.cjs");
            assert!(!program.is_settled("m.cjs", "a"), "{module}");
            assert_eq!(program.imported("m.cjs", "a"), "copy", "{module}");
            let facade = program.exports().facade(ModuleRef::File(file));
            assert_eq!(facade, Some(ModuleRef::Facade(file)), "{module}");
            assert!(program.checked("main.mjs").is_empty(), "{module}");
        });
    }
    let main = ("main.cjs", "const m = require('./m.cjs'); m.a = 2;");
    let files = [main, ("m.cjs", "exports.a = 1;")];
    assert!(!with_program(&files, |program| program.is_settled("m.cjs", "a")));
}

#[test]
fn an_import_through_a_getter_holds_a_copy_of_its_own_unless_the_name_behind_it_is_settled() {
    let main = "import { a } from './m.cjs'; import { b } from './k.cjs'; import './other.cjs'; console.log(a, b);";
    let imported = |k: &str, other: &str| {
        let files = [
            ("main.mjs", main),
            ("m.cjs", BARREL),
            ("k.cjs", k),
            ("other.cjs", other),
        ];
        with_program(&files, |program| {
            let member = |module: &str, name: &str| {
                let variable = program
                    .graph
                    .variable_of(program.module(module), program.atom(name));
                let variable = variable.expect("no binding asks for the name");
                program.describe(Some(program.exports().imported_member(variable)))
            };
            assert!(
                program
                    .graph
                    .facade_dependencies(program.file("m.cjs"))
                    .is_empty(),
                "{k} {other}"
            );
            format!("{}, {}", member("m.cjs", "a"), member("k.cjs", "b"))
        })
    };
    assert_eq!(imported("exports.b = 1;", ""), "k.cjs b, k.cjs b");
    for (k, other) in [
        ("exports.b = 1; exports.set = () => { exports.b = 2; };", ""),
        ("exports.b = 1;", "require('./k.cjs').b = 2;"),
        (
            "exports.b = 1;",
            "exports.set = () => { require('./k.cjs').b = 2; };",
        ),
        ("exports.b = 1;", "console.log(require('./k.cjs'));"),
    ] {
        assert_eq!(
            imported(k, other),
            "copy of m.cjs a, copy of k.cjs b",
            "{k} {other}"
        );
    }
}

#[test]
fn names_that_may_be_absent_are_checked_in_link_order() {
    let main = "import './first.mjs'; import { late } from './m.cjs'; console.log(late);";
    let files = [
        ("main.mjs", main),
        (
            "first.mjs",
            "import { nope } from './m.cjs'; console.log(nope);",
        ),
        (
            "m.cjs",
            "exports.one = 1; if (Math.random()) exports.late = 2;",
        ),
    ];
    with_program(&files, |program| {
        assert_eq!(program.checked("main.mjs"), ["m.cjs nope", "m.cjs late"]);
        assert!(program.checked("first.mjs").is_empty());
    });
}

#[test]
fn the_file_keeps_its_object() {
    for module in [
        "exports.a = 1; console.log(exports);",
        "module.exports = Math.random();",
        "module.exports = { a: 2, z: 1 }; module.exports = { a: 3 };",
        "module.exports = { a: 2, [Math.random()]: 1 };",
        "module.exports = { get a() { return 2; } };",
        "module.exports = { a() { return super.toString(); } };",
        "if (Math.random()) module.exports = { a: 2 };",
        "console.log(module.exports = { a: 2 });",
        "exports = module.exports = { a: 2 };",
        "set(); module.exports = { a: 2 }; function set() { module.exports.b = 1; }",
        "require('./main.cjs'); module.exports = { a: 2 };",
        "exports.a = 1; exports = {};",
        "exports.a = 1; eval('exports');",
        "exports.a = 1; console.log(arguments);",
        "exports.a = function () { return this.b; }; exports.b = 1; exports.a();",
        "exports.a = 1; Object.defineProperty(exports, 'b', { value: 1 }); exports.b = 2;",
        "Object.defineProperty(exports, 'a', { get() { return Math.random(); } });",
        "const b = 1; Object.defineProperty(exports, 'a', { get() { return b; }, set(v) {} });",
        "Object.defineProperty(exports, 'a', { get() { return k.b; } }); exports.a; var k = require('./k.cjs');",
        "Object.defineProperty(exports, 'a', { get() { return k.b; } }); var k = require('./k.cjs'); exports.a;",
        "Object.defineProperty(exports, 'a', { get() { return k.b; } }); require('./main.cjs'); var k = require('./k.cjs');",
        "Object.defineProperty(exports, 'a', { get() { return require('./k.cjs').b; } });",
        "if (Math.random()) var k = require('./k.cjs'); Object.defineProperty(exports, 'a', { get() { return k.b; } });",
        "var k = require('./k.cjs'); k = {}; Object.defineProperty(exports, 'a', { get() { return k.b; } });",
        "var k = require('./k.cjs'); Object.defineProperty(exports, 'a', { get() { return k.b; } }); exports.a = 1;",
    ] {
        let keeps_names = with_required(module, |program| program.keeps_names("m.cjs"));
        assert!(!keeps_names, "{module}");
    }
}

#[test]
fn a_getter_written_in_front_of_the_load_is_that_name_where_nobody_asks_in_between() {
    let module = "Object.defineProperty(exports, 'a', { get() { return k.b; } }); var k = require('./k.cjs');";
    with_required(module, |program| {
        assert!(program.keeps_names("m.cjs"));
        assert_eq!(program.member("m.cjs", "a"), "k.cjs b");
    });
}

#[test]
fn a_getter_past_the_helper_is_a_name_of_a_file_that_says_a_fixed_marker() {
    const BABEL_HELPER: &str =
        "function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }";
    let written_by_typescript = format!(
        "{IMPORT_DEFAULT} {MARKER} var k_1 = require('./k.cjs'); Object.defineProperty(exports, 'a', {{ enumerable: true, get: function () {{ return __importDefault(k_1).default; }} }});"
    );
    let written_by_babel = format!(
        "{MARKER} Object.defineProperty(exports, 'a', {{ enumerable: true, get: function () {{ return _k.default; }} }}); var _k = _interopRequireDefault(require('./k.cjs')); {BABEL_HELPER}"
    );
    let marked = format!("{MARKER} exports.default = 1;");
    for module in [&written_by_typescript, &written_by_babel] {
        let files = [
            ("main.cjs", READS_A),
            ("m.cjs", &module[..]),
            ("k.cjs", &marked[..]),
        ];
        with_program(&files, |program| {
            assert!(program.keeps_names("m.cjs"), "{module}");
            assert!(program.keeps_names("k.cjs"), "{module}");
            assert_eq!(program.member("m.cjs", "a"), "k.cjs default", "{module}");
        });
        for leaf in [
            "exports.default = 1;",
            "exports.__esModule = true; exports.default = 1;",
            "module.exports = function () {};",
        ] {
            let files = [
                ("main.cjs", READS_A),
                ("m.cjs", &module[..]),
                ("k.cjs", leaf),
            ];
            let keeps_names = with_program(&files, |program| program.keeps_names("m.cjs"));
            assert!(!keeps_names, "{module} over {leaf}");
        }
    }
}

#[test]
fn the_holder_handed_to_the_helper_in_ordinary_code_is_needed_as_a_value() {
    let marked = format!("{MARKER} exports.default = 1;");
    for module in [
        "var k_1 = require('./k.cjs'); exports.a = __importDefault(k_1).default;",
        "exports.a = peek(); var k_1 = require('./k.cjs'); function peek() { return __importDefault(k_1).default; }",
        "var k_1 = require('./k.cjs'); Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return __importDefault(k_1).default; } }); exports.b = __importDefault(k_1).default;",
    ] {
        let module = format!("{IMPORT_DEFAULT} {MARKER} {module}");
        let files = [
            ("main.cjs", READS_A),
            ("m.cjs", &module[..]),
            ("k.cjs", &marked[..]),
        ];
        let keeps_names = with_program(&files, |program| program.keeps_names("k.cjs"));
        assert!(!keeps_names, "{module}");
    }
}

#[test]
fn a_star_written_in_line_is_the_names_of_the_required_file() {
    let main = "const m = require('./m.cjs'); console.log(m.b);";
    let module = format!("{MARKER} {STAR_IN_LINE_OF_K}");
    let marked = format!("{MARKER} exports.b = 1;");
    let leaf = ("k.cjs", &marked[..]);
    with_program(
        &[("main.cjs", main), ("m.cjs", &module[..]), leaf],
        |program| {
            assert!(program.keeps_names("m.cjs"));
            assert!(program.keeps_names("k.cjs"));
            assert_eq!(program.member("m.cjs", "b"), "k.cjs b");
        },
    );
    for changed in [
        module.replace("key === \"default\"", "key === \"b\""),
        module.replace("return _k[key];", "return _k.b;"),
        module.replace("forEach(function (key) {", "map(function (key) {"),
        module.replace("Object.keys(_k)", "Object.getOwnPropertyNames(_k)"),
        module.replace(
            "var _k = require('./k.cjs');",
            "var _k = require('./k.cjs'); _k = {};",
        ),
        module.replace(
            "var _k = require('./k.cjs');",
            "var _k; _k = require('./k.cjs');",
        ),
        module.replace(
            "var _k = require('./k.cjs');",
            "exports.b = 2; var _k = require('./k.cjs');",
        ),
        module.replace(
            "var _k = require('./k.cjs');",
            "var Object = globalThis.Object; var _k = require('./k.cjs');",
        ),
        format!("{module} exports.b;"),
        format!(
            "{module} {}",
            STAR_IN_LINE_OF_K.replace("var _k = require('./k.cjs');", "")
        ),
        STAR_IN_LINE_OF_K.to_string(),
    ] {
        let files = [("main.cjs", main), ("m.cjs", &changed[..]), leaf];
        let keeps_names = with_program(&files, |program| program.keeps_names("m.cjs"));
        assert!(!keeps_names, "{changed}");
    }
}

#[test]
fn export_equals_is_a_store_to_module_exports() {
    let name_a_of = |module: &str| {
        let main = "import m = require('./m'); console.log(m.a);";
        with_program(&[("main.ts", main), ("m.ts", module)], |program| {
            let name = describe_name(program.input, "m.ts", "a");
            name.filter(|_| program.keeps_names("m.ts"))
        })
    };
    for module in [
        "export = { a: 1, list: [1, 2] };",
        "export = { a: 1 } as { a: number };",
    ] {
        assert_eq!(name_a_of(module).as_deref(), Some("a"), "{module}");
    }
    for module in [
        "export = { a: 1, ...Math };",
        "export = { a: 1, f() { return this.a; } };",
        "const table = { a: 1 }; export = table;",
    ] {
        assert_eq!(name_a_of(module), None, "{module}");
    }
}

#[test]
fn text_as_typescript_emits_it() {
    let module = r#""use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Thing = exports.a = exports.b = void 0;
exports.add = add;
const k_1 = require("./k.cjs");
Object.defineProperty(exports, "b", { enumerable: true, get: function () { return k_1.b; } });
function add(x, y) { return x + y; }
exports.a = 1;
class Thing {}
exports.Thing = Thing;
"#;
    let main =
        "const m_1 = require('./m.cjs'); console.log((0, m_1.add)(m_1.a, m_1.b), new m_1.Thing());";
    with_program(&[("main.cjs", main), ("m.cjs", module), K], |program| {
        let m = program.module("m.cjs");
        assert!(program.keeps_names("m.cjs"));
        assert!(!program.keeps_names("main.cjs"));
        assert_eq!(program.marker("m.cjs"), Some(true));
        assert_eq!(program.member("m.cjs", "__esModule"), "marker true");
        assert_eq!(program.member("m.cjs", "b"), "k.cjs b");
        for name in ["add", "a", "Thing"] {
            assert_eq!(program.member("m.cjs", name), format!("m.cjs {name}"));
            assert!(program.is_settled("m.cjs", name), "{name}");
            assert!(
                program.exports().ignores_this(m, program.atom(name)),
                "{name}"
            );
        }
    });
}

#[test]
fn text_as_swc_emits_it() {
    let listed = "0 && (module.exports = {\n    a: null,\n    b: null\n});\n";
    let module = format!("\"use strict\";\n{MARKER}\n{listed}{SWC_EXPORT}{SWC_NAMES}");
    let main = "const _m = require('./m.cjs'); console.log((0, _m.b)(), _m.a);";
    with_program(&[("main.cjs", main), ("m.cjs", &module[..])], |program| {
        let file = program.file("m.cjs");
        let is_exported = |name: &str| {
            let symbol = symbol_named(program.input, file, name);
            program.exports().is_exported_binding(file, symbol)
        };
        assert!(program.keeps_names("m.cjs"));
        assert_eq!(program.marker("m.cjs"), Some(true));
        for name in ["a", "b"] {
            assert_eq!(program.member("m.cjs", name), format!("m.cjs#{name}"));
            assert!(is_exported(name), "{name}");
        }
        assert!(!is_exported("_export"));
    });
}

#[test]
fn a_getter_that_returns_a_name_of_another_module_is_that_name() {
    let files = [("main.cjs", READS_A), ("m.cjs", BARREL), K];
    with_bind_input(&files, &default_settings(), |input| {
        let mut graph = bind_modules(input).graph;
        let file = file_named(input, "m.cjs");
        let [m, k] = ["m.cjs", "k.cjs"].map(|name| ModuleRef::File(file_named(input, name)));
        let store = member_named(input, file, "a");
        let definition = with_commonjs_input(input, |commonjs| {
            let names = summarize_file(commonjs, file).names;
            let is_getter = |stored: &&StoredName| matches!(stored, StoredName::Getter { .. });
            names.iter().find(is_getter).map(StoredName::statement)
        });
        let definition = definition.expect("the summary lists the getter");

        let program = Program {
            graph: &graph,
            input,
        };
        let exports = program.exports();
        assert!(program.keeps_names("m.cjs") && program.keeps_names("k.cjs"));
        assert_eq!(program.member("m.cjs", "a"), "k.cjs b");
        let behind = exports.member_behind_getter(m, program.atom("a"));
        assert_eq!(program.describe(behind), "k.cjs b");
        assert_eq!(exports.member_behind_getter(k, program.atom("b")), None);
        assert_eq!(exports.name_sources(m), [k]);
        assert_eq!(
            program.describe(exports.own_member(file, store)),
            "undefined"
        );
        assert!(exports.erased(file, definition));

        graph.look_at(k);
        let program = Program {
            graph: &graph,
            input,
        };
        let exports = program.exports();
        assert!(!program.keeps_names("m.cjs") && !program.keeps_names("k.cjs"));
        assert_eq!(program.member("m.cjs", "a"), "object");
        assert_eq!(program.describe(exports.own_member(file, store)), "object");
        assert!(!exports.erased(file, definition));
    });
}

#[test]
fn a_getter_needs_the_variable_of_the_other_module() {
    for k in [
        "exports.b = 1; console.log(exports);",
        "module.exports = () => 1;",
    ] {
        let files = [("main.cjs", READS_A), ("m.cjs", BARREL), ("k.cjs", k)];
        assert!(
            !with_program(&files, |program| program.keeps_names("m.cjs")),
            "{k}"
        );
    }
}

#[test]
fn a_module_seen_half_evaluated_keeps_its_object_if_it_defines_getters() {
    let in_cycle = ("k.cjs", "exports.b = 1; require('./m.cjs');");
    let files = [("main.cjs", READS_A), ("m.cjs", BARREL), in_cycle];
    with_program(&files, |program| {
        assert!(!program.keeps_names("m.cjs"));
        assert!(program.keeps_names("k.cjs"));
        assert!(!program.is_settled("k.cjs", "b"));
    });
}

#[test]
fn the_namespace_object_lacks_a_getter_that_is_not_enumerable() {
    let member_of_namespace = |module: &str| {
        let main = "import * as ns from './m.cjs'; console.log(ns.a);";
        with_program(&[("main.mjs", main), ("m.cjs", module), K], |program| {
            let main = program.file("main.mjs");
            let access = member_named(program.input, main, "a");
            program.describe(program.graph.member(main, access))
        })
    };
    let listed = getter_of_b("enumerable: true, ");
    assert_eq!(member_of_namespace(&listed), "k.cjs b");
    assert_eq!(member_of_namespace(&getter_of_b("")), "nothing");
}

#[test]
fn a_call_through_the_object_passes_it_as_this() {
    let ignores_this = |module: &str| {
        with_required(module, |program| {
            let (m, a) = (program.module("m.cjs"), program.atom("a"));
            program.exports().ignores_this(m, a)
        })
    };
    for module in [
        "exports.a = () => 1;",
        "exports.a = function () { return 1; };",
        "function a() {} exports.a = a;",
        "exports.a = class {};",
        "exports.a = 1;",
    ] {
        assert!(ignores_this(module), "{module}");
    }
    for module in [
        "exports.a = function () { return this; };",
        "exports.a = function () { return () => this; };",
        "exports.a = function (o) { const { t = this.t } = o; return t; };",
        "exports.a = function () { return eval('this'); };",
        "exports.a = () => this;",
        "exports.a = Math.random;",
        "exports.a = () => 1; exports.a = Math.random;",
        "exports.a ??= function () { return this; };",
        "[exports.a = () => 1] = [function () { return this; }];",
        "Object.assign(exports, { a() { return this; } });",
        "exports.a = () => 1; console.log(exports);",
    ] {
        assert!(!ignores_this(module), "{module}");
    }
}

#[test]
fn a_call_through_the_namespace_passes_it_as_this() {
    let captures = |a: &str| {
        let main = "import * as ns from './m.cjs'; console.log(ns.a());";
        let module = format!("exports.a = {a}; exports.b = 1;");
        with_program(&[("main.mjs", main), ("m.cjs", &module[..])], |program| {
            program
                .exports()
                .has_capturing_facade(program.file("m.cjs"))
        })
    };
    assert!(captures("function () { return this.b; }"));
    assert!(captures("Math.random"));
    assert!(!captures("function () { return 1; }"));
}

#[test]
fn an_importer_that_sees_the_namespace_sees_the_object() {
    for main in [
        "import d from './m.cjs'; console.log(d);",
        "import * as ns from './m.cjs'; console.log(ns);",
        "import('./m.cjs').then(console.log);",
        "export * from './m.cjs';",
        "export * as ns from './m.cjs';",
    ] {
        let files = [("main.mjs", main), ("m.cjs", "exports.a = 1;")];
        assert!(
            !with_program(&files, |program| program.keeps_names("m.cjs")),
            "{main}"
        );
    }
}

#[test]
fn a_marker_that_the_text_does_not_settle_is_unknown() {
    for (module, marker) in [
        ("exports.a = 1;", Some(false)),
        ("exports.__esModule = true; exports.a = 1;", Some(true)),
        ("exports.mark = () => { exports.__esModule = true; };", None),
        ("require('./main.cjs'); exports.__esModule = true;", None),
        ("exports.a = 1; console.log(exports);", None),
        ("module.exports = Math.random();", None),
    ] {
        let found = with_required(module, |program| program.marker("m.cjs"));
        assert_eq!(found, marker, "{module}");
    }
}

#[test]
fn a_marker_that_another_file_stores_is_unknown() {
    let marked = ("m.cjs", "exports.__esModule = true; exports.a = 1;");
    let through_helper = format!(
        "{IMPORT_DEFAULT} const m = __importDefault(require('./m.cjs')); m.__esModule = false;"
    );
    for main in [
        ("main.cjs", "require('./m.cjs').__esModule = false;"),
        ("main.cjs", "delete require('./m.cjs').__esModule;"),
        (
            "main.cjs",
            "Object.defineProperty(require('./m.cjs'), '__esModule', { value: false });",
        ),
        (
            "main.cjs",
            "const m = require('./m.cjs'); m.__esModule = false;",
        ),
        (
            "main.ts",
            "import m = require('./m.cjs'); m.__esModule = false;",
        ),
        ("main.cjs", &through_helper[..]),
        (
            "main.cjs",
            "let m; m = require('./m.cjs'); m.__esModule = false;",
        ),
        (
            "main.cjs",
            "function mark(o) { o.__esModule = false; } mark(require('./m.cjs'));",
        ),
        (
            "main.cjs",
            "const m = Math.random() ? require('./m.cjs') : {}; m.__esModule = false;",
        ),
    ] {
        with_program(&[main, marked], |program| {
            let stored = stored_markers(program.input);
            assert_eq!(stored, [program.module("m.cjs")], "{}", main.1);
            assert_eq!(program.marker("m.cjs"), None, "{}", main.1);
        });
    }
    for main in [
        "require('./m.cjs').a = 2;",
        "const m = require('./m.cjs'); m.a = 2;",
        "require('./m.cjs'); const o = {}; o.__esModule = true;",
    ] {
        with_program(&[("main.cjs", main), marked], |program| {
            assert!(stored_markers(program.input).is_empty(), "{main}");
        });
    }
}

#[test]
fn whoever_has_the_object_may_change_the_marker() {
    let unmarked = "exports.default = 'inner'; exports.a = 1;";
    let marked = "exports.__esModule = true; exports.default = 'inner'; exports.a = 1;";
    let defined = format!("{MARKER} exports.default = 'inner'; exports.a = 1;");
    let texts = [unmarked, marked, defined.as_str()];
    let markers_with = |main: &str, uses: &[&str]| -> Vec<[Option<bool>; 3]> {
        let name_of = |use_number: usize, text: usize| format!("m{use_number}-{text}.cjs");
        let numbers = (0..uses.len()).flat_map(|number| (0..3).map(move |text| (number, text)));
        let written = numbers.clone().map(|(number, text)| {
            let path = format!("./{}", name_of(number, text));
            uses[number]
                .replace('K', &path)
                .replace('N', &format!("n{number}_{text}"))
        });
        let written: String = written.collect::<Vec<String>>().join("\n");
        let names: Vec<String> = numbers
            .clone()
            .map(|(number, text)| name_of(number, text))
            .collect();
        let mut files = vec![
            (main, written.as_str()),
            (
                "stamp.cjs",
                "exports.stamp = function (o) { o.__esModule = 1; };",
            ),
        ];
        files.extend(
            names
                .iter()
                .zip(numbers)
                .map(|(name, (_, text))| (name.as_str(), texts[text])),
        );
        with_program(&files, |program| {
            let marker = |number: usize, text: usize| program.marker(&name_of(number, text));
            (0..uses.len())
                .map(|number| [0, 1, 2].map(|text| marker(number, text)))
                .collect()
        })
    };
    let takes = [
        "{ const m = require('K'); require('./stamp.cjs').stamp(m); }",
        "{ const box = { m: require('K') }; box.m.__esModule = 1; }",
        "{ const m = require('K'); (0, m).__esModule = 1; }",
        "{ const m = require('K'); (m || {}).__esModule = 1; }",
        "{ const m = require('K'); const get = () => m; get().__esModule = 1; }",
        "{ const m = require('K'); const other = m; other.__esModule = 1; }",
        "{ const m = require('K'); Object.assign(m, { __esModule: 1 }); }",
        "{ const m = require('K'); Reflect.set(m, '__esModule', 1); }",
        "{ const m = require('K'); Object.defineProperties(m, { __esModule: { value: 1 } }); }",
        "{ const m = require('K'); Object.setPrototypeOf(m, { __esModule: 1 }); }",
        "{ const m = require('K'); m[process.argv[2]] = 1; }",
        "{ const m = require('K'); delete m[process.argv[2]]; }",
        "{ const m = require('K'); m.late = process.argv.pop; m.late(); }",
    ];
    for (markers, taken) in markers_with("main.cjs", &takes).iter().zip(takes) {
        assert_eq!(*markers, [None, None, Some(true)], "{taken}");
    }
    let way = ["require('K'); module.children[0].exports.__esModule = 1;"];
    assert_eq!(markers_with("main.cjs", &way), [[None, None, Some(true)]]);
    let defaults = [
        "import N from 'K'; globalThis.held = N;",
        "import { default as N } from 'K'; globalThis.held = N;",
        "import * as N from 'K'; globalThis.held = N.default;",
        "export { default as N } from 'K';",
    ];
    for (markers, taken) in markers_with("main.mjs", &defaults).iter().zip(defaults) {
        assert_eq!(*markers, [None, Some(true), Some(true)], "{taken}");
    }
    let known = [Some(false), Some(true), Some(true)];
    let off_answers = [
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const { default: oN } = N(require('K')); globalThis.held = oN;",
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const { ...oN } = N(require('K')); globalThis.held = oN;",
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const hN = N(require('K')); const { default: oN } = hN; globalThis.held = oN;",
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const hN = N(require('K')); const { [process.argv[2]]: oN } = hN; globalThis.held = oN;",
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const oN = (N(require('K')).default ||= 1); globalThis.held = oN;",
    ];
    for (markers, taken) in markers_with("main.cjs", &off_answers)
        .iter()
        .zip(off_answers)
    {
        assert_eq!(*markers, [None, Some(true), Some(true)], "{taken}");
    }
    let off_holders = [
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const mN = require('K'); const { default: oN } = N(mN); globalThis.held = oN;",
    ];
    for (markers, taken) in markers_with("main.cjs", &off_holders)
        .iter()
        .zip(off_holders)
    {
        assert_eq!(markers[0], None, "{taken}");
    }
    let off_namespaces =
        ["import * as N from 'K'; const { default: oN } = N; globalThis.held = oN;"];
    for (markers, taken) in markers_with("main.mjs", &off_namespaces)
        .iter()
        .zip(off_namespaces)
    {
        assert_eq!(*markers, [None, Some(true), Some(true)], "{taken}");
    }
    let reads = [
        "function N(e) { return e && e.__esModule ? e : { default: e }; } const { a: oN } = N(require('K')); globalThis.held = oN;",
    ];
    assert_eq!(markers_with("main.cjs", &reads), [known]);
    let leaves = [
        "require('K');",
        "{ const m = require('K'); if (m && typeof m.a === 'number') m.a = 2; }",
        "{ const { a, ...rest } = require('K'); globalThis.held = [a, rest]; }",
    ];
    for (markers, left) in markers_with("main.cjs", &leaves).iter().zip(leaves) {
        assert_eq!(*markers, known, "{left}");
    }
    let leaves = [
        "import N from 'K'; globalThis.held = N.a;",
        "import * as N from 'K'; globalThis.held = [N.a, N.default.a];",
    ];
    for (markers, left) in markers_with("main.mjs", &leaves).iter().zip(leaves) {
        assert_eq!(*markers, known, "{left}");
    }
    let files = [
        (
            "main.cjs",
            "require('./stores.cjs').f(); require('./returns.cjs').f(); require('./ignores.cjs').f(); globalThis.held = typeof require('./read.cjs').f;",
        ),
        (
            "stores.cjs",
            "'use strict'; exports.f = function () { this.__esModule = 1; };",
        ),
        (
            "returns.cjs",
            "'use strict'; exports.f = function () { return this; };",
        ),
        ("ignores.cjs", "exports.f = function () { return 1; };"),
        (
            "read.cjs",
            "'use strict'; exports.f = function () { return this; };",
        ),
    ];
    with_program(&files, |program| {
        assert_eq!(program.marker("stores.cjs"), None);
        assert_eq!(program.marker("returns.cjs"), None);
        assert_eq!(program.marker("ignores.cjs"), Some(false));
        assert_eq!(program.marker("read.cjs"), Some(false));
    });
}

#[test]
fn importers_ignore_the_marker_in_a_package_of_type_module() {
    let markers_in = |package: &str| {
        let marked = ("m.cjs", "exports.__esModule = true; exports.a = 1;");
        let files = [("main.mjs", IMPORTS_A), marked, ("package.json", package)];
        with_program(&files, |program| {
            let (m, exports) = (program.module("m.cjs"), program.exports());
            (exports.marker(m), exports.marker_for_imports(m))
        })
    };
    assert_eq!(markers_in("{}"), (Some(true), Some(true)));
    let markers = markers_in(r#"{ "type": "module" }"#);
    assert_eq!(markers, (Some(true), Some(false)));
}

#[test]
fn module_exports_may_be_an_accessor() {
    let uses_module_object = |module: &str| {
        with_required(module, |program| {
            let m = program.module("m.cjs");
            let uses_it = program.exports().uses_module_object(m);
            assert!(!uses_it || !program.keeps_names("m.cjs"), "{module}");
            uses_it
        })
    };
    for module in [
        "Object.defineProperty(module, 'exports', { get() { return { a: 1 }; } });",
        "exports.a = 1; console.log(module);",
    ] {
        assert!(uses_module_object(module), "{module}");
    }
    for module in [
        "module.exports.a = 1;",
        "module.exports = { a: 1 };",
        "exports.a = 1; console.log(exports);",
    ] {
        assert!(!uses_module_object(module), "{module}");
    }
}

#[test]
fn a_file_that_stores_to_a_wrapper_parameter_or_exposes_its_scope_needs_a_wrapped_body() {
    let needs_wrapped_body = |module: &str| {
        with_required(module, |program| {
            let m = program.module("m.cjs");
            program.exports().needs_wrapped_body(m)
        })
    };
    for module in [
        "exports.a = 1; module = {};",
        "exports.a = 1; require = null;",
        "exports.a = 1; __dirname = '';",
        "exports.a = 1; exports = {};",
        "exports.a = 1; eval('1');",
        "exports.a = 1; console.log(arguments.length);",
        "exports.a = typeof module; var module = 1;",
        "function read() { return module; } exports.a = read(); var module = 1;",
        "var module = module.exports; module.a = 1;",
        "if (exports.a) { var module = 1; } exports.b = typeof module;",
        "var require; exports.a = require;",
    ] {
        assert!(needs_wrapped_body(module), "{module}");
    }
    for module in [
        "exports.a = 1;",
        "var module = 1; exports.a = function () { return module; };",
        "for (var i = 0; i < 2; i++) { var module = i; exports.a = module; }",
        "var require = 1; exports.a = require;",
        "exports.a = 1; console.log(exports);",
        "function f() {} exports = module.exports = f; exports.a = 1;",
    ] {
        assert!(!needs_wrapped_body(module), "{module}");
    }
}

const COMMON_JS: &str = "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);\n";

fn shapes_of_inner_modules(body: &str) -> Vec<Shape> {
    let main = format!("{COMMON_JS}{body}");
    with_graph(&[("main.mjs", main.as_str())], |graph, input| {
        let file = file_named(input, "main.mjs");
        let callbacks = graph.inner_modules(file).iter();
        callbacks
            .map(|&callback| graph.shape(ModuleRef::Inner { file, callback }))
            .collect()
    })
}

#[test]
fn the_callback_of_a_bundle_is_read_as_the_body_of_a_module() {
    for (callback, shape) in [
        ("(exports) => { exports.x = 1; }", Shape::Names),
        (
            "(exports, module) => { module.exports.x = 1; }",
            Shape::Names,
        ),
        (
            "(exports, module) => { module.exports = { x: 1 }; }",
            Shape::Names,
        ),
        (
            "(exports, module) => { module.exports = Math.random(); }",
            Shape::Value,
        ),
        (
            "(exports) => { exports.x = 1; console.log(exports); }",
            Shape::Value,
        ),
        ("(exports) => { var e = exports; e.x = 1; }", Shape::Value),
        (
            "(exports) => { if (Math.random()) return; Object.defineProperty(exports, 'x', { value: 1 }); }",
            Shape::Value,
        ),
    ] {
        let body = format!("var require_a = __commonJS({callback});\nconsole.log(require_a().x);");
        assert_eq!(shapes_of_inner_modules(&body), [shape], "{callback}");
    }
}

#[test]
fn a_getter_in_a_callback_stands_for_a_name_of_another_callback() {
    let body = "var require_b = __commonJS((exports) => { exports.b = 1; });
var require_a = __commonJS((exports) => {
  var b_1 = require_b();
  Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return b_1.b; } });
});
console.log(require_a().a);";
    assert_eq!(shapes_of_inner_modules(body), [Shape::Names, Shape::Names]);
}

#[test]
fn a_marker_that_other_code_stores_on_an_inner_module_is_unknown() {
    let marker_of_first = |body: &str| {
        let main = format!("{COMMON_JS}{body}");
        with_graph(&[("main.mjs", main.as_str())], |graph, input| {
            let file = file_named(input, "main.mjs");
            let callback = graph.inner_modules(file)[0];
            graph.commonjs().marker(ModuleRef::Inner { file, callback })
        })
    };
    let own =
        "var require_a = __commonJS((exports) => { exports.__esModule = true; exports.x = 1; });\n";
    assert_eq!(
        marker_of_first(&format!("{own}console.log(require_a().x);")),
        Some(true)
    );
    assert_eq!(
        marker_of_first(&format!("{own}require_a().__esModule = false;")),
        None
    );
    assert_eq!(
        marker_of_first(&format!("{own}var a = require_a(); delete a.__esModule;")),
        None
    );
    let own = format!("var require_a = __commonJS((exports) => {{ {MARKER} exports.x = 1; }});\n");
    for body in [
        "require_a().__esModule = false;",
        "var a = require_a(); delete a.__esModule;",
    ] {
        assert_eq!(
            marker_of_first(&format!("{own}{body}")),
            Some(true),
            "{body}"
        );
    }
}
