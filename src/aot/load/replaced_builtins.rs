//! A test run that is compiled in several builds has to know, before the first of them, which members of built-in objects its files replace.
//! This reads one file by itself: what it imports from other files names nothing, what it imports from Bun does.

use std::borrow::Cow;

use bun_core::strings;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{BindOptions, Binding, Decl, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{Constant, FoldInputs, FoldOptions, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, FileKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, JsxMode};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema::util::SharedSort;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::builtins::{
    BuiltinNames, ImportTargets, ReplacedMembersSought, ResolveInput, RuntimeModule, SourceDialect,
    resolve_file, table,
};
use crate::load::host_platform;
use crate::load::replaced_modules::find_replaced_modules;
use crate::options::OpenedName;

// A name of a member is short.
const MAX_FOLDED_STRING_BYTES: usize = 256;

#[derive(Default)]
pub struct FoundInFile {
    /// `LoadOptions::replaced_builtins` as far as the file spells them.
    pub members: Vec<u32>,
    /// `LoadOptions::opened_names` as far as the file spells them.
    pub names_added: Vec<OpenedName>,
    /// The files beside it that it names, as it writes them: `import "./helper"`, `require("../stubs.js")`, `new URL("./worker.ts", import.meta.url)`.
    pub files_named: Vec<Vec<u8>>,
    /// What else it imports, as it writes it: packages, and modules of Bun.
    pub other_modules_named: Vec<Vec<u8>>,
    /// `ReplacedByTests::modules`, `exports` and `any_module`, each module as the file writes it.
    pub modules: Vec<Vec<u8>>,
    pub exports: Vec<(Vec<u8>, Vec<u8>)>,
    pub any_module: bool,
    /// The modules whose objects it hands on, each as the file writes it, and whether it hands on one that it does not spell.
    /// They count as `modules` and `any_module` where a file of the run has `spies_on_unknown_objects`.
    pub handed_on: Vec<Vec<u8>>,
    pub hands_on_any: bool,
    pub spies_on_unknown_objects: bool,
    /// `ResolvedBuiltins::holders_named_from_outside`, by their numbers.
    pub holders_named_from_outside: Vec<u32>,
    /// The texts that it passes to what it imports from a file beside it: the file as it writes it, and the text. `plant("polluted")`.
    pub texts_passed: Vec<(Vec<u8>, Vec<u8>)>,
}

pub fn find_in_file(path: &[u8], text: &[u8]) -> Vec<u32> {
    look_at_file(path, text).members
}

fn is_relative(specifier: &[u8]) -> bool {
    specifier.starts_with(b"./") || specifier.starts_with(b"../")
}

/// Nothing for a file with a syntax error: its build says so. Nothing for a file that holds no code: `import data from "./data.json"`, `./types.d.ts`.
pub fn look_at_file(path: &[u8], text: &[u8]) -> FoundInFile {
    let mut found = FoundInFile::default();
    look_at_files(|look_at| found = look_at(path, text));
    found
}

/// `look_at_file` for several files, one after another. The table of the names of built-ins takes longer to make than a test file to read: it is made once for all of them.
pub fn look_at_files(look_at_each: impl FnOnce(&dyn Fn(&[u8], &[u8]) -> FoundInFile)) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let look = Look {
        session: &session,
        names: BuiltinNames::new(&atoms),
        atoms,
    };
    look_at_each(&|path, text| {
        let mut found = FoundInFile::default();
        look.look_at_text(path, text, &mut found);
        found
    });
}

struct Look<'s> {
    session: &'s Session,
    atoms: Interner<'s>,
    names: BuiltinNames,
}

// Without one of each no text writes a property.
fn may_hold_code(text: &[u8]) -> bool {
    let holds = |byte: u8| strings::contains_char(text, byte);
    (holds(b'.') || holds(b'['))
        && (holds(b'=') || holds(b'(') || strings::contains(text, b"delete "))
}

impl<'s> Look<'s> {
    /// Whether the text is a program.
    fn look_at_text(&self, path: &[u8], text: &[u8], found: &mut FoundInFile) -> bool {
        let (arena, atoms, names) = (self.session.arena(), &self.atoms, &self.names);
        let parse_options = CompileParseOptions {
            path,
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            keeps_function_directives: false,
        };
        let mut hir = parse_for_compile(arena, &parse_options, text, atoms);
        if hir.has_errors || matches!(hir.kind, FileKind::Json | FileKind::Declaration) {
            return false;
        }
        hir.text = Cow::Borrowed(text);
        let fold_options = FoldOptions {
            max_string_bytes: MAX_FOLDED_STRING_BYTES,
            ..FoldOptions::default()
        };
        let fold = FoldInputs::new(fold_options, arena);
        let bind_options = BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        };
        let file = FileInputs {
            declared_module_type: match path.ends_with(b".cjs") || path.ends_with(b".cts") {
                true => DeclaredModuleType::CommonJs,
                false => DeclaredModuleType::Unknown,
            },
            import_meta_main: None,
            is_library: false,
            host_values: &[],
            jsx: JsxMode::Classic,
        };
        let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, atoms, arena);
        let module_of = |specifier: ImportSpecifier| match specifier {
            ImportSpecifier::Constant(text) => match atoms.bytes(text) {
                b"@jest/globals" | b"vitest" => Some(RuntimeModule::BunTest),
                text => table::module_by_specifier(text),
            },
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => None,
        };
        let sites = analysis.import_sites.iter();
        let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
            .map(|site| (site.kind, module_of(site.specifier)))
            .collect();
        targets.shared_sort_unstable_by_key(|target| target.0);
        let resolved = resolve_file(&ResolveInput {
            hir: &hir,
            bound: &bound,
            decisions: &analysis.decisions,
            module_format: analysis.module_format,
            targets: &ImportTargets::new(&targets),
            names,
            platform: host_platform(),
            dialect: SourceDialect::Program,
            replaced: &[],
            replaced_members_sought: ReplacedMembersSought::WrittenOrNamed,
        });
        let imported = analysis
            .import_sites
            .iter()
            .filter_map(|site| match site.specifier {
                ImportSpecifier::Constant(text) => Some(text),
                _ => None,
            });
        let urls = (0..hir.exprs.len() as u32).map(ExprId).filter_map(|expr| {
            let ExprKind::New(call) = hir[expr].kind else {
                return None;
            };
            let call = hir[call];
            // `new URL("./worker.ts", import.meta.url)`, `new Worker("./worker.ts")`, of the realm or of node:worker_threads. A text that names no file costs a look at the disk.
            match hir[hir.ids(call.args).next()?].kind {
                ExprKind::String(text) => Some(text),
                _ => None,
            }
        });
        let files_named = imported.chain(urls).map(|text| atoms.bytes(text));
        let modules = find_replaced_modules(&hir, &bound, &analysis, &resolved, &module_of);
        let bytes_of = |text: Atom| atoms.bytes(text).to_vec();
        found
            .modules
            .extend(modules.whole.iter().map(|&it| bytes_of(it)));
        let exports = modules.exports.iter();
        (found.exports).extend(exports.map(|&(module, name)| (bytes_of(module), bytes_of(name))));
        found.any_module |= modules.any;
        (found.handed_on).extend(modules.handed_on.iter().map(|&it| bytes_of(it)));
        found.hands_on_any |= modules.hands_on_any;
        found.spies_on_unknown_objects |= modules.spies_on_unknown_objects;
        let members = resolved.replaced_members().iter();
        found.members.extend(members.map(|&member| member as u32));
        let names_added = resolved.names_added().iter();
        (found.names_added).extend(names_added.map(|&(holder, name)| OpenedName {
            holder: holder as u32,
            name: bytes_of(name),
        }));
        for text in files_named {
            match is_relative(text) {
                true => found.files_named.push(text.to_vec()),
                false => found.other_modules_named.push(text.to_vec()),
            }
        }
        let holders = resolved.holders_named_from_outside().iter();
        (found.holders_named_from_outside).extend(holders.map(|&holder| holder as u32));
        for call in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[call].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let name = hir.member_key(callee).map_or(callee, |(object, _)| object);
            let Binding::Symbol(symbol) = bound.binding(hir.skip_type_assertions(name)) else {
                continue;
            };
            let import = match *bound.symbol(symbol).decls {
                [Decl::ImportSpec(spec)] => hir[spec].import,
                [Decl::ImportDefault(import) | Decl::ImportNamespace(import)] => import,
                _ => continue,
            };
            // `import a from ;` in a text whose substitution stood for the name: the parser goes on without one.
            if hir[import].spec.is_none() {
                continue;
            }
            let file = atoms.bytes(hir[import].spec);
            if !is_relative(file) {
                continue;
            }
            for operand in hir.ids(hir[call].args) {
                let operand = hir.skip_type_assertions(operand);
                if let FoldedValue::Constant(Constant::String(text)) =
                    analysis.decisions.constant(&hir, operand)
                {
                    found.texts_passed.push((file.to_vec(), bytes_of(text)));
                }
            }
        }
        for expr in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[expr].kind {
                ExprKind::String(text) => self.look_at_code_in_texts(&[atoms.bytes(text)], found),
                ExprKind::Template { exprs } => {
                    let texts = hir.ids(hir.template_texts(exprs));
                    let texts: Vec<&[u8]> = texts.map(|text| atoms.bytes(text)).collect();
                    self.look_at_code_in_texts(&texts, found);
                }
                _ => {}
            }
        }
        true
    }

    /// A test hands code over as text, to a Worker, another realm or a file that it writes: `run("Set.prototype.add = () => {}")`. No build sees it run, and it writes
    /// in a realm that the image has locked. `texts`: a string, or what stands between the substitutions of a template.
    fn look_at_code_in_texts(&self, texts: &[&[u8]], found: &mut FoundInFile) {
        if !texts.iter().any(|text| may_hold_code(text)) {
            return;
        }
        // What a substitution stands for is not known: nothing, as where it adds statements, or a value.
        let fillers: &[&[u8]] = match texts.len() {
            1 => &[b""],
            _ => &[b"", b"0"],
        };
        for filler in fillers {
            let text = texts.join(*filler);
            // The body of a function, which may return.
            let body = [b"async function body() {\n", &text[..], b"\n}"].concat();
            let mut inner = FoundInFile::default();
            if self.look_at_text(b"/text.ts", &text, &mut inner)
                || self.look_at_text(b"/text.ts", &body, &mut inner)
            {
                found.members.extend(inner.members);
                found.names_added.extend(inner.names_added);
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::BuiltinId;

    fn find(text: &str) -> Vec<BuiltinId> {
        let numbers = find_in_file(b"/project/a.test.ts", text.as_bytes());
        numbers
            .into_iter()
            .map(|number| BuiltinId::from_wire(number).expect("it is in the table"))
            .collect()
    }

    fn find_modules(text: &str) -> (Vec<String>, Vec<(String, String)>, bool) {
        let found = look_at_file(b"/project/a.test.ts", text.as_bytes());
        let text_of = |bytes: &Vec<u8>| String::from_utf8(bytes.clone()).expect("it is text");
        let modules = found.modules.iter().chain(&found.handed_on);
        let mut modules: Vec<String> = modules.map(text_of).collect();
        modules.sort_unstable();
        modules.dedup();
        let exports = found.exports.iter();
        let mut exports: Vec<(String, String)> = exports
            .map(|(module, name)| (text_of(module), text_of(name)))
            .collect();
        exports.sort_unstable();
        (modules, exports, found.any_module || found.hands_on_any)
    }

    #[test]
    fn tells_what_is_mocked_from_what_is_handed_on() {
        let found = look_at_file(
            b"/project/a.test.ts",
            br#"
            import { mock, spyOn } from "bun:test";
            import * as passed from "./passed";
            import * as unnamed from "./unnamed";
            export * as again from "./again";
            mock.module("./mocked", () => ({}));
            use(passed, await import(name()));
            spyOn(unnamed, pick());
            "#,
        );
        assert_eq!(found.modules, [&b"./mocked"[..], b"./unnamed"]);
        assert_eq!(found.handed_on, [&b"./again"[..], b"./passed"]);
        assert!(found.hands_on_any && !found.any_module);
        assert!(found.spies_on_unknown_objects);
        let spelled = br#"import { spyOn } from "bun:test"; import * as a from "./a"; spyOn(a, "b"); spyOn(console, "log");"#;
        assert!(!look_at_file(b"/project/a.test.ts", spelled).spies_on_unknown_objects);
        let unknown = br#"import { spyOn } from "bun:test"; spyOn(holder.it, "b");"#;
        assert!(look_at_file(b"/project/a.test.ts", unknown).spies_on_unknown_objects);
    }

    #[test]
    fn finds_mocked_modules_and_exports_that_spies_name() {
        let (modules, exports, any) = find_modules(
            r#"
            import { mock, spyOn, jest, vi } from "bun:test";
            import * as a from "./a";
            import * as b from "./b";
            import * as read from "./read";
            import { named } from "./named";
            import whole from "./default";
            mock.module("./mocked", () => ({}));
            jest.mock("../jest-mocked", () => ({}));
            vi.mock("package", () => ({}));
            spyOn(a, "first");
            jest.spyOn(a as any, "second");
            vi.spyOn(b, "third");
            spyOn(named, "method");
            spyOn(whole, "method");
            read.value; read.call(); const { one, two: other } = read;
            "#,
        );
        assert_eq!(modules, ["../jest-mocked", "./mocked", "package"]);
        let expected = [("./a", "first"), ("./a", "second"), ("./b", "third")];
        assert_eq!(
            exports,
            expected.map(|(module, name)| (module.to_owned(), name.to_owned()))
        );
        assert!(!any);
    }

    #[test]
    fn a_module_object_that_goes_somewhere_is_replaced_whole() {
        let (modules, exports, any) = find_modules(
            r#"
            import { spyOn } from "bun:test";
            import * as passed from "./passed";
            import * as stored from "./stored";
            import * as exported from "./exported";
            import * as unnamed from "./unnamed";
            import * as spread from "./spread";
            export * as again from "./again";
            export * from "./star";
            use(passed);
            const list = [stored];
            export { exported };
            spyOn(unnamed, pick());
            const { ...rest } = spread;
            const promise = import("./promise");
            const awaited = await import("./awaited");
            use(awaited);
            const kept = await import("./kept");
            spyOn(kept, "name"); kept.other();
            const required = require("./required");
            required.written = () => 1;
            delete require("./deleted").gone;
            const { taken } = await import("./taken");
            (await import("./member")).read();
            import("./for-effect");
            export const shown = require("./shown");
            let again2 = require("./stored-twice"); again2 = 1;
            "#,
        );
        assert_eq!(
            modules,
            [
                "./again",
                "./awaited",
                "./exported",
                "./passed",
                "./promise",
                "./shown",
                "./spread",
                "./stored",
                "./stored-twice",
                "./unnamed"
            ]
        );
        let expected = [
            ("./deleted", "gone"),
            ("./kept", "name"),
            ("./required", "written"),
        ];
        assert_eq!(
            exports,
            expected.map(|(module, name)| (module.to_owned(), name.to_owned()))
        );
        assert!(!any);
    }

    #[test]
    fn a_module_that_the_file_does_not_spell_is_any_module() {
        let mocks = r#"import { mock } from "bun:test"; mock.module(name(), () => ({}));"#;
        assert!(find_modules(mocks).2);
        assert!(find_modules("use(await import(name()));").2);
        assert!(find_modules("use(require(name()));").2);
        assert!(!find_modules("(await import(name())).read();").2);
        assert!(!find_modules("const { a } = require(name());").2);
        let dead =
            r#"import { mock } from "bun:test"; if (false) mock.module(name(), () => ({}));"#;
        assert!(!find_modules(dead).2);
    }

    #[test]
    fn reads_code_that_a_file_holds_as_text() {
        let mut found = find(
            r#"
            run("Set.prototype.add = function () { return this }");
            run(`delete Map.prototype.get`, 'a sentence (with a dot.) = no code');
            run(`
              const before = ${JSON.stringify(1)};
              Array.from = () => before;
              return ${what}`);
            run(`String.prototype.at = 0${more}${andMore}`);
            run("run('Promise.race = 1')");
            "#,
        );
        found.sort_unstable();
        let mut expected = vec![
            BuiltinId::SetPrototypeAdd,
            BuiltinId::MapPrototypeGet,
            BuiltinId::ArrayFrom,
            BuiltinId::StringPrototypeAt,
            BuiltinId::PromiseRace,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
        let names = look_at_file(
            b"/project/a.test.ts",
            br#"run("Object.prototype.planted = () => 1");"#,
        );
        assert_eq!(
            names.names_added,
            [OpenedName {
                holder: BuiltinId::ObjectPrototype as u32,
                name: b"planted".to_vec()
            }]
        );
    }

    #[test]
    fn an_import_in_a_text_may_lack_the_name_of_its_file() {
        assert!(find("const text = `import a from ${p}; a.run(1.5);`;").is_empty());
        assert!(find("const text = `import * as a from ${p}\na.run(1.5);`;").is_empty());
        assert!(find(r#"const text = "import a, { b } from; b(1.5);";"#).is_empty());
    }

    #[test]
    fn a_key_that_is_a_symbol_of_the_language_names_one_member() {
        let only = [BuiltinId::MapPrototypeSymbolIterator];
        let spy = r#"import { spyOn } from "bun:test"; spyOn(Map.prototype, Symbol.iterator);"#;
        assert_eq!(find(spy), only);
        assert_eq!(find("Map.prototype[Symbol.iterator] = () => 0;"), only);
        let defined = "Object.defineProperty(Map.prototype, Symbol.iterator, { value: 0 });";
        assert_eq!(find(defined), only);
        let held = "const key = Symbol.iterator; delete Map.prototype[key];";
        assert_eq!(find(held), only);
        let of_host = r#"import { spyOn } from "bun:test"; spyOn(Headers.prototype, Symbol.iterator); URLSearchParams.prototype[Symbol.iterator] = 0; delete Set.prototype[Symbol.iterator];"#;
        assert_eq!(
            find(of_host),
            [
                BuiltinId::HeadersPrototypeSymbolIterator,
                BuiltinId::SetPrototypeSymbolIterator,
                BuiltinId::URLSearchParamsPrototypeSymbolIterator
            ]
        );
        // A key that nobody can read opens the whole object.
        assert!(find("Map.prototype[pick()] = () => 0;").len() > 1);
    }

    #[test]
    fn opens_keys_on_prototypes_that_a_file_reaches_without_their_names() {
        let found = look_at_file(
            b"/project/a.test.ts",
            br#"
            function plant(way: string, field: string) {
                const inherited: object = Reflect.get({}, way);
                Reflect.defineProperty(inherited, field, { value: 1, configurable: true });
            }
            plant("__proto__", "first");
            plant("__proto__", "second");
            "#,
        );
        let mut names: Vec<(u32, &[u8])> = (found.names_added.iter())
            .map(|added| (added.holder, &added.name[..]))
            .collect();
        names.sort_unstable();
        names.dedup();
        let (object, function) = (
            BuiltinId::ObjectPrototype as u32,
            BuiltinId::FunctionPrototype as u32,
        );
        let mut expected: Vec<(u32, &[u8])> = vec![
            (object, b"first"),
            (object, b"second"),
            (function, b"first"),
            (function, b"second"),
        ];
        expected.sort_unstable();
        assert_eq!(names, expected);
        let told =
            br#"const own: any = {}; Reflect.defineProperty(own, "name", {}); other[KEY] = 1;"#;
        assert!(
            look_at_file(b"/project/a.test.ts", told)
                .names_added
                .is_empty()
        );
    }

    #[test]
    fn finds_names_in_a_list_that_is_passed_beside_the_object() {
        let mut found = find(
            r#"
            function wrapAll(prototype: object, methods: string[], note: () => void) {
                for (const method of methods) {
                    const original = Reflect.get(prototype, method);
                    Object.defineProperty(prototype, method, { value() { note(); return original; } });
                }
            }
            function install() {
                const inserters = ["set", "getOrInsert"];
                wrapAll(Map.prototype, inserters, () => {});
                wrapAll(Set.prototype, ["add"], () => {});
                wrapAll(WeakMap.prototype, inserters, () => {});
            }
            install();
            "#,
        );
        found.sort_unstable();
        found.dedup();
        let mut expected = vec![
            BuiltinId::MapPrototypeSet,
            BuiltinId::MapPrototypeGetOrInsert,
            BuiltinId::SetPrototypeAdd,
            BuiltinId::WeakMapPrototypeSet,
            BuiltinId::WeakMapPrototypeGetOrInsert,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn follows_the_object_and_the_name_to_what_the_file_spells_for_them() {
        let mut found = find(
            r#"
            import { spyOn, test } from "bun:test";
            for (const name of ["ceil", "round"]) spyOn(Math, name);
            ((holder) => spyOn(holder, "sqrt"))(Math);
            ((name) => spyOn(Math, name))("cbrt");
            for (const holder of [Math, Number]) spyOn(holder, "hypot");
            for (const name of ["sin", "cos"] as const) { (Math as any)[name] = () => 0; }
            test.each(["exp", "pow"])("%s", name => { spyOn(Math, name); });
            test.each([[Date, "UTC"], [Object, "keys"]])("%s", (holder, name) => { spyOn(holder, name); });
            ["tan"].forEach(name => { delete (Math as any)[name]; });
            const check = (holder: any, name: string, ask: () => void) => { spyOn(holder, name); ask(); };
            check(Promise, "all", () => {});
            check(Array.prototype, "push", () => {});
            class Patch {
                install() {
                    const con = console;
                    for (const m of LIST) { con[m] = () => {}; }
                }
            }
            const LIST = ["log", "info"];
            const more = ["acos"];
            if (globalThis.wide) more.push("asin", "atan");
            for (const name of more) spyOn(Math, name);
            for (const name of ["setTimeout", "setInterval"] as const) {
                spyOn(globalThis as unknown as Record<string, () => void>, name);
            }
            "#,
        );
        found.sort_unstable();
        found.dedup();
        let mut expected = vec![
            BuiltinId::MathCeil,
            BuiltinId::MathRound,
            BuiltinId::MathSqrt,
            BuiltinId::MathCbrt,
            BuiltinId::MathHypot,
            BuiltinId::MathSin,
            BuiltinId::MathCos,
            BuiltinId::MathExp,
            BuiltinId::MathPow,
            BuiltinId::DateUTC,
            BuiltinId::ObjectKeys,
            BuiltinId::MathTan,
            BuiltinId::PromiseAll,
            BuiltinId::ArrayPrototypePush,
            BuiltinId::ConsoleLog,
            BuiltinId::ConsoleInfo,
            BuiltinId::MathAcos,
            BuiltinId::MathAsin,
            BuiltinId::MathAtan,
            BuiltinId::SetTimeout,
            BuiltinId::SetInterval,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn a_name_that_nobody_can_read_opens_every_member_of_the_object() {
        let found = find(
            r#"import { spyOn } from "bun:test"; for (const name of Object.keys(Atomics)) spyOn(Atomics, name);"#,
        );
        assert!(
            found.contains(&BuiltinId::AtomicsStore) && found.contains(&BuiltinId::AtomicsLoad)
        );
        assert!(!found.contains(&BuiltinId::MathMax));
        let globals = find("for (const name of names()) globalThis[name] = 1;");
        assert!(globals.contains(&BuiltinId::SetTimeout) && globals.contains(&BuiltinId::Fetch));
        assert!(!globals.contains(&BuiltinId::Map) && !globals.contains(&BuiltinId::Array));
    }

    #[test]
    fn a_store_that_happens_only_where_the_member_is_missing_writes_nothing() {
        let found = find(
            r#"
            (Symbol as any).dispose ??= Symbol("dispose");
            (Object as any).create ||= () => ({});
            (Array as any).from &&= () => [];
            "#,
        );
        assert_eq!(found, [BuiltinId::ArrayFrom]);
    }

    #[test]
    fn reads_a_text_whose_import_has_lost_its_name() {
        for text in [
            "const text = `import a from ${p}; a.run(1.5);`;",
            "const text = `import * as a from ${p}\\na.run(1.5)`;",
            r#"const text = "import a, { b } from; a.run(1.5); b('x');";"#,
        ] {
            assert!(find(text).is_empty());
        }
    }

    #[test]
    fn finds_spies_stores_definitions_and_deletions() {
        let found = find(
            r#"
            import { spyOn, jest } from "bun:test";
            import { vi } from "vitest";
            spyOn(String.prototype, "indexOf");
            jest.spyOn(Map.prototype, "get");
            vi.spyOn(Promise, "race");
            Array.from = () => [];
            Object.defineProperty(Array.prototype, "includes", { value() {} });
            Reflect.set(Buffer, "concat", () => {});
            delete (Atomics as any).store;
            "#,
        );
        let mut expected = vec![
            BuiltinId::StringPrototypeIndexOf,
            BuiltinId::MapPrototypeGet,
            BuiltinId::PromiseRace,
            BuiltinId::ArrayFrom,
            BuiltinId::ArrayPrototypeIncludes,
            BuiltinId::BufferConcat,
            BuiltinId::AtomicsStore,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn decides_by_binding() {
        let shadowed = r#"
            import { spyOn } from "bun:test";
            const String = { prototype: { indexOf() {} } };
            spyOn(String.prototype, "indexOf");
            String.prototype.indexOf = () => {};
            "#;
        assert_eq!(find(shadowed), []);
        let renamed = r#"
            import { spyOn as watch } from "bun:test";
            const texts = String.prototype;
            const name = "normalize";
            watch(texts, name);
            "#;
        assert_eq!(find(renamed), [BuiltinId::StringPrototypeNormalize]);
    }

    #[test]
    fn takes_an_object_beside_the_name_of_its_member() {
        let text = r#"
            import { stub } from "./my-stubs";
            stub(Array.prototype, "join");
            const rows = [[Map.prototype, "get"], ["keys", Object]];
            const row = { holder: Reflect, key: "has", other: "join" };
            stub(Array.prototype, "mine", "get");
            Object.getOwnPropertyDescriptor(String.prototype, "indexOf");
            console.log(Promise, "race");
            "#;
        let mut expected = vec![
            BuiltinId::ArrayPrototypeJoin,
            BuiltinId::MapPrototypeGet,
            // Every object of a table meets every name of it.
            BuiltinId::MapPrototypeKeys,
            BuiltinId::ObjectKeys,
            BuiltinId::ReflectHas,
        ];
        expected.sort_unstable();
        assert_eq!(find(text), expected);
    }

    #[test]
    fn lets_objects_that_are_handed_on_meet_keys_written_on_some_object() {
        let text = r#"
            const MARK = "__planted";
            const places = () => [["Object.prototype", Object.prototype], ["Array.prototype", Array.prototype], ["Function.prototype", Function.prototype]];
            for (const [, place] of places()) Reflect.set(place, MARK, "here");
            (Object.prototype as any).spelled = 1;
            "#;
        let mut found = look_at_file(b"/project/a.test.ts", text.as_bytes()).names_added;
        found.sort_unstable();
        let name = |holder: BuiltinId, name: &str| OpenedName {
            holder: holder as u32,
            name: name.as_bytes().to_vec(),
        };
        let mut expected = vec![
            name(BuiltinId::ObjectPrototype, "__planted"),
            name(BuiltinId::ObjectPrototype, "spelled"),
            name(BuiltinId::FunctionPrototype, "__planted"),
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn follows_a_key_to_what_the_calls_of_a_function_pass_for_it() {
        let text = r#"
            function plant(name: string, value: string) {
                Object.defineProperty(Object.prototype, name, { value, configurable: true });
                return () => Reflect.deleteProperty(Object.prototype, name);
            }
            function replace(name: string) { (String.prototype as any)[name] = () => 0; }
            plant("HTTPS_PROXY", "http://a.invalid")();
            replace("indexOf");
            replace("split");
            "#;
        let found = look_at_file(b"/project/a.test.ts", text.as_bytes());
        let mut expected = vec![
            BuiltinId::StringPrototypeIndexOf as u32,
            BuiltinId::StringPrototypeSplit as u32,
        ];
        expected.sort_unstable();
        assert_eq!(found.members, expected);
        let mut names = found.names_added;
        names.dedup();
        let planted = OpenedName {
            holder: BuiltinId::ObjectPrototype as u32,
            name: b"HTTPS_PROXY".to_vec(),
        };
        assert_eq!(names, [planted]);
    }

    #[test]
    fn finds_nothing_in_a_file_that_holds_no_code() {
        for (path, text) in [
            (&b"/project/data.json"[..], &br#"{ "a": "orig" }"#[..]),
            (b"/project/types.d.ts", b"export declare const a: number;"),
        ] {
            let found = look_at_file(path, text);
            assert!(found.members.is_empty() && found.files_named.is_empty());
        }
    }

    #[test]
    fn lists_the_files_beside_it_that_it_names() {
        let text = r#"
            import "./a";
            import { b } from "../b.js";
            import "bun:test";
            import "package";
            const c = require("./c.cjs")(b);
            const d = await import("./d.ts");
            new Worker(new URL("./worker.ts", import.meta.url));
            "#;
        let mut found = look_at_file(b"/project/a.test.ts", text.as_bytes()).files_named;
        found.sort_unstable();
        let expected: [&[u8]; 5] = [b"../b.js", b"./a", b"./c.cjs", b"./d.ts", b"./worker.ts"];
        assert_eq!(found, expected);
    }

    #[test]
    fn takes_members_that_are_constant_unless_written_and_passes_by_new_names() {
        let text = r#"
            import { spyOn } from "bun:test";
            Array.prototype.last = function () {};
            Date.now = () => 0;
            spyOn(console, "log");
            "#;
        let mut expected = vec![BuiltinId::DateNow, BuiltinId::ConsoleLog];
        expected.sort_unstable();
        assert_eq!(find(text), expected);
    }
}
