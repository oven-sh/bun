use bun_builtin_sources::Manifest;
use bun_core::strings;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::fold::{
    Constant, Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions,
};
use bun_sema::hir_from_data::DataValue;
use bun_sema::session::Arena;

use crate::builtins::Platforms;
use crate::diagnostics::LoadMessages;
use crate::load::data_modules::parse_json;
use crate::load::locked_builtin_defines::{locked_builtin_defines, runtime_identity_defines};
use crate::statistics::{LimitId, LimitValues};

// What the build tells Bun's own sources about the program. They are read after the program.
#[derive(Copy, Clone)]
pub(crate) struct ProgramFacts {
    pub can_load_code_at_run_time: bool,
    pub can_be_cluster_worker: bool,
}

fn max_string_bytes(limits: &LimitValues) -> usize {
    usize::try_from(limits.get(LimitId::MaxFoldedStringBytes)).unwrap_or(usize::MAX)
}

pub(crate) fn create_application_fold_inputs<'s>(
    provided: &FoldOptions<'s>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    limits: &LimitValues,
    platform: Platforms,
) -> FoldInputs<'s> {
    let options = FoldOptions {
        defines: after_constant_globals(provided.defines, platform, arena, atoms),
        max_string_bytes: max_string_bytes(limits),
        ..*provided
    };
    FoldInputs::new(options, arena)
}

pub(crate) fn create_runtime_fold_inputs<'s>(
    manifest: &Manifest,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    messages: &LoadMessages,
    limits: &LimitValues,
    platform: Platforms,
    facts: ProgramFacts,
) -> FoldInputs<'s> {
    let mut defines = runtime_defines(manifest, arena, atoms, messages);
    let define_fact = |name: &[u8], holds: bool| Define {
        path: define_path(name, arena, atoms),
        value: DefineValue::Constant(Constant::Boolean(holds)),
    };
    defines.extend([
        define_fact(
            b"CAN_LOAD_CODE_AT_RUN_TIME",
            facts.can_load_code_at_run_time,
        ),
        define_fact(b"CAN_BE_CLUSTER_WORKER", facts.can_be_cluster_worker),
        define_fact(b"IS_COMPILED_AHEAD_OF_TIME", true),
    ]);
    let options = FoldOptions {
        defines: after_constant_globals(&defines, platform, arena, atoms),
        max_string_bytes: max_string_bytes(limits),
        ..FoldOptions::default()
    };
    FoldInputs::new(options, arena)
}

/// `bun run` replaces these three names where nothing declares them.
fn after_constant_globals<'s>(
    defines: &[Define<'s>],
    platform: Platforms,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> &'s [Define<'s>] {
    let constant_globals = [
        (known::undefined, Constant::Undefined),
        (known::NaN, Constant::Number(f64::NAN)),
        (known::Infinity, Constant::Number(f64::INFINITY)),
    ];
    let constant_globals = constant_globals.map(|(name, value)| Define {
        path: DefinePath {
            root: DefineRoot::Global(name),
            members: &[],
        },
        value: DefineValue::Constant(value),
    });
    let mut held_in_every_run = locked_builtin_defines(platform, arena, atoms);
    held_in_every_run.extend(runtime_identity_defines(arena, atoms));
    // A define replaces what is written, so it says nothing about the object of the run, and neither does this list from there on.
    held_in_every_run.retain(|held| {
        defines
            .iter()
            .all(|define| !is_at_or_under(held.path, define.path) || is_same_constant(define, held))
    });
    let all: Vec<Define<'s>> = constant_globals
        .iter()
        .chain(defines)
        .chain(&held_in_every_run)
        .copied()
        .collect();
    arena.alloc_slice_copy(&all)
}

fn is_at_or_under(path: DefinePath<'_>, holder: DefinePath<'_>) -> bool {
    path.root == holder.root && path.members.starts_with(holder.members)
}

// `bun build --compile` defines `process.versions.bun` as the text that the run has there.
fn is_same_constant(define: &Define<'_>, held: &Define<'_>) -> bool {
    define.path == held.path
        && matches!(
            (define.value, held.value),
            (DefineValue::Constant(defined), DefineValue::RuntimeConstant(held)) if defined == held
        )
}

fn runtime_defines<'s>(
    manifest: &Manifest,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    messages: &LoadMessages,
) -> Vec<Define<'s>> {
    let mut defines = Vec::with_capacity(manifest.defines().len());
    for (name, json) in manifest.defines() {
        let Some(value) = parse_json(json, arena, atoms).and_then(define_value) else {
            let message = [&b"runtime define "[..], &name[..], b" is not valid JSON"];
            messages.report_internal_error(message.concat());
            continue;
        };
        let path = define_path(name, arena, atoms);
        defines.push(Define { path, value });
    }
    defines
}

fn define_path<'s>(name: &[u8], arena: &'s Arena, atoms: &Interner<'s>) -> DefinePath<'s> {
    let mut parts = strings::split(name, b".");
    let root = atoms.intern(parts.next().unwrap_or_default());
    let members: Vec<Atom> = parts.map(|part| atoms.intern(part)).collect();
    DefinePath {
        root: DefineRoot::Global(root),
        members: arena.alloc_slice_copy(&members),
    }
}

fn define_value<'s>(value: &'s DataValue<'s>) -> Option<DefineValue<'s>> {
    let constant = match *value {
        DataValue::Null => Constant::Null,
        DataValue::Boolean(boolean) => Constant::Boolean(boolean),
        DataValue::Number(number) => Constant::Number(number),
        DataValue::String(text) => Constant::String(text),
        DataValue::Array(_) | DataValue::Object(_) => return Some(DefineValue::Data(value)),
        DataValue::Undefined | DataValue::BigInt(_) => return None,
    };
    Some(DefineValue::Constant(constant))
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use bun_builtin_sources::Archive;
    use bun_sema::bind::{BindOptions, RuntimeBindOptions};
    use bun_sema::file_analysis::{FileAnalysis, FileInputs, analyze_file};
    use bun_sema::fold::{Decision, FoldErrorKind, RuntimeValueKind};
    use bun_sema::hir::{ExprId, ExprKind};
    use bun_sema::import_sites::JsxMode;
    use bun_sema::module_format::DeclaredModuleType;
    use bun_sema::program::{FileId, Files};
    use bun_sema::session::Session;
    use bun_sema_parser::{CompileParseOptions, parse_for_compile};

    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::compile::testing::{default_settings, with_loaded_build};
    use crate::diagnostics::Diagnostics;
    use crate::load::project::{PerProject, ProjectId};

    fn global_path<'s>(names: &[&[u8]], arena: &'s Arena, atoms: &Interner<'s>) -> DefinePath<'s> {
        let names: Vec<Atom> = names.iter().map(|name| atoms.intern(name)).collect();
        DefinePath {
            root: DefineRoot::Global(names[0]),
            members: arena.alloc_slice_copy(&names[1..]),
        }
    }

    fn has_internal_errors(messages: &LoadMessages) -> bool {
        let mut diagnostics = Diagnostics::new();
        diagnostics.add_load_messages(messages);
        diagnostics.has_internal_errors()
    }

    fn create_sessions() -> PerProject<Session> {
        PerProject {
            application: Session::new(),
            runtime: Session::new(),
        }
    }

    const NO_FACTS: ProgramFacts = ProgramFacts {
        can_load_code_at_run_time: false,
        can_be_cluster_worker: false,
    };

    fn fold_inputs_with_facts<'s>(
        sessions: &'s PerProject<Session>,
        atoms: &Interner<'s>,
        limits: &LimitValues,
        facts: ProgramFacts,
    ) -> PerProject<FoldInputs<'s>> {
        let messages = LoadMessages::default();
        let fold = PerProject {
            application: create_application_fold_inputs(
                &FoldOptions::default(),
                sessions.application.arena(),
                atoms,
                limits,
                Platforms::LINUX,
            ),
            runtime: create_runtime_fold_inputs(
                Archive::embedded().manifest(),
                sessions.runtime.arena(),
                atoms,
                &messages,
                limits,
                Platforms::LINUX,
                facts,
            ),
        };
        assert!(!has_internal_errors(&messages));
        fold
    }

    fn analyze<'s>(
        source: &'static str,
        fold: &FoldInputs<'s>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
    ) -> FileAnalysis<'s> {
        let parse_options = CompileParseOptions {
            path: b"/project/a.ts",
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            keeps_function_directives: false,
        };
        let mut hir = parse_for_compile(arena, &parse_options, source.as_bytes(), atoms);
        hir.text = Cow::Borrowed(source.as_bytes());
        let bind_options = BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        };
        let file = FileInputs {
            declared_module_type: DeclaredModuleType::Unknown,
            import_meta_main: None,
            is_library: false,
            host_values: &[],
            jsx: JsxMode::Classic,
        };
        analyze_file(&mut hir, bind_options, fold, file, atoms, arena).1
    }

    #[test]
    fn runtime_defines_are_parsed_as_json() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let manifest = Manifest::parse(
            b"bun-builtins-manifest\t4\n\
              define\tprocess.platform\t\"linux\"\n\
              define\tIS_BUN_DEVELOPMENT\ttrue\n\
              define\tNOTHING\tnull\n\
              define\tCOUNT\t-2\n\
              define\t$Labels\t[\"a\"]\n",
        )
        .unwrap();
        let messages = LoadMessages::default();
        let defines = runtime_defines(&manifest, arena, &atoms, &messages);
        assert!(!has_internal_errors(&messages));

        let constant = |names: &[&[u8]], constant| Define {
            path: global_path(names, arena, &atoms),
            value: DefineValue::Constant(constant),
        };
        let linux = Constant::String(atoms.intern(b"linux"));
        assert_eq!(defines.len(), 5);
        assert_eq!(defines[0], constant(&[b"process", b"platform"], linux));
        assert_eq!(defines[0].path.members, [atoms.intern(b"platform")]);
        assert_eq!(
            defines[1],
            constant(&[b"IS_BUN_DEVELOPMENT"], Constant::Boolean(true))
        );
        assert_eq!(defines[2], constant(&[b"NOTHING"], Constant::Null));
        assert_eq!(defines[3], constant(&[b"COUNT"], Constant::Number(-2.0)));
        let labels = [DataValue::String(atoms.intern(b"a"))];
        assert_eq!(defines[4].path, global_path(&[b"$Labels"], arena, &atoms));
        assert_eq!(
            defines[4].value,
            DefineValue::Data(&DataValue::Array(&labels))
        );
    }

    #[test]
    fn runtime_define_without_json_value_is_internal_error() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let manifest = Manifest::parse(
            b"bun-builtins-manifest\t4\n\
              define\tBROKEN\t__intrinsic__x\n\
              define\tVALID\tfalse\n",
        )
        .unwrap();
        let messages = LoadMessages::default();
        let defines = runtime_defines(&manifest, arena, &atoms, &messages);
        assert!(has_internal_errors(&messages));
        assert_eq!(defines.len(), 1);
        assert_eq!(defines[0].path, global_path(&[b"VALID"], arena, &atoms));
    }

    fn decisions_at_name<'s>(files: &Files<'s>, file: FileId, name: &[u8]) -> Vec<Decision<'s>> {
        let decisions = &files.analysis(file).decisions;
        let exprs = files.hir(file).exprs.iter().enumerate();
        exprs
            .filter(|(_, expr)| {
                matches!(expr.kind, ExprKind::Ident(atom) if files.atoms.bytes(atom) == name)
            })
            .map(|(index, _)| decisions.decision(ExprId(index as u32)))
            .collect()
    }

    #[test]
    fn runtime_defines_fold_in_runtime_sources_only() {
        const NAME: &[u8] = b"IS_BUN_DEVELOPMENT";
        let files = [
            (
                "a.ts",
                "import 'node:path'; export const isDevelopment = IS_BUN_DEVELOPMENT;",
            ),
            (
                "/$bun/js/node/path.ts",
                "export default IS_BUN_DEVELOPMENT;",
            ),
        ];
        with_loaded_build(&files, &default_settings(), |_, loaded| {
            let application = loaded.project(ProjectId::Application).loaded.files();
            let entry_point = application.entry_points()[0];
            let in_application = decisions_at_name(application, entry_point, NAME);
            assert_eq!(in_application, [Decision::Unknown]);

            let runtime = loaded.project(ProjectId::Runtime);
            let runtime_file = runtime.sources.runtime_module_file(RuntimeModule::NodePath);
            let in_runtime = decisions_at_name(runtime.loaded.files(), runtime_file.unwrap(), NAME);
            assert_eq!(in_runtime, [Decision::Constant(Constant::Boolean(false))]);
        });
    }

    fn assert_fact_decides_import(source: &'static str, facts_where: fn(bool) -> ProgramFacts) {
        for holds in [false, true] {
            let sessions = create_sessions();
            let atoms = Interner::new_in(&sessions.application);
            let limits = LimitValues::for_host();
            let fold = fold_inputs_with_facts(&sessions, &atoms, &limits, facts_where(holds));
            let count_import_sites = |project: ProjectId| {
                let arena = sessions.get(project).arena();
                analyze(source, fold.get(project), arena, &atoms)
                    .import_sites
                    .len()
            };
            assert_eq!(count_import_sites(ProjectId::Runtime), usize::from(holds));
            assert_eq!(count_import_sites(ProjectId::Application), 1);
        }
    }

    #[test]
    fn build_decides_whether_runtime_sources_load_code() {
        assert_fact_decides_import(
            "if (CAN_LOAD_CODE_AT_RUN_TIME) import('./addon');",
            |can_load_code_at_run_time| ProgramFacts {
                can_load_code_at_run_time,
                ..NO_FACTS
            },
        );
    }

    #[test]
    fn build_decides_whether_runtime_sources_hold_the_half_of_a_cluster_worker() {
        assert_fact_decides_import(
            "if (CAN_BE_CLUSTER_WORKER) import('./child');",
            |can_be_cluster_worker| ProgramFacts {
                can_be_cluster_worker,
                ..NO_FACTS
            },
        );
    }

    fn count_import_sites(source: &'static str) -> usize {
        let sessions = create_sessions();
        let atoms = Interner::new_in(&sessions.application);
        let fold = fold_inputs_with_facts(&sessions, &atoms, &LimitValues::for_host(), NO_FACTS);
        let arena = sessions.application.arena();
        analyze(source, &fold.application, arena, &atoms)
            .import_sites
            .len()
    }

    #[test]
    fn import_behind_failed_test_for_locked_builtin_is_not_followed() {
        for source in [
            "if (!Object.assign) import('./polyfill');",
            "if (typeof Symbol !== 'function') import('./polyfill');",
            "if (typeof Array.prototype.includes === 'undefined') import('./polyfill');",
            "if (typeof Symbol.iterator !== 'symbol') import('./polyfill');",
            "if (typeof Reflect !== 'object') import('./polyfill');",
            "if (!globalThis.Map) import('./polyfill');",
            "if (Object.setPrototypeOf == null) import('./polyfill');",
            "export const keys = Object.keys || import('./polyfill');",
            "export const from = typeof Array.from === 'function' ? Array.from : import('./polyfill');",
        ] {
            assert_eq!(count_import_sites(source), 0, "{source}");
        }
    }

    #[test]
    fn import_behind_test_for_other_global_is_followed() {
        for source in [
            "if (!Math.random) import('./polyfill');",
            "if (typeof Promise === 'undefined') import('./polyfill');",
            "if (!Object.mine) import('./polyfill');",
            "if (!Map.prototype.size) import('./polyfill');",
            "if (!console.log) import('./polyfill');",
            "function f(Object: any) { if (!Object.assign) import('./polyfill'); }",
            "if (Object.assign) import('./uses-assign');",
        ] {
            assert_eq!(count_import_sites(source), 1, "{source}");
        }
    }

    #[test]
    fn import_for_another_runtime_is_not_followed() {
        for test in [
            "typeof Bun === 'undefined'",
            "typeof Bun !== 'object'",
            "!globalThis.Bun",
            "globalThis.Bun === undefined",
            "!('Bun' in globalThis)",
            "!globalThis?.Bun",
            "globalThis.Bun == null",
            "!(typeof Bun !== 'undefined' && 'Bun' in globalThis)",
            "typeof process === 'undefined'",
            "typeof process !== 'object'",
            "!globalThis.process",
            "!process.isBun",
            "process.isBun !== true",
            "!process?.isBun",
            "typeof process.versions !== 'object'",
            "process.versions === null",
            "process.versions == null",
            "!process.versions.bun",
            "!process.versions?.bun",
            "!process?.versions?.bun",
            "!globalThis.process?.versions?.bun",
            "typeof process.versions.bun !== 'string'",
            "!('bun' in process.versions)",
            "!('node' in process.versions)",
            "typeof process.versions.node !== 'string'",
            "process.release.name !== 'node'",
            "process.release?.name === 'io.js'",
            "!(typeof process !== 'undefined' && typeof process.versions === 'object' && process.versions !== null && typeof process.versions.bun === 'string')",
            "!(typeof process !== 'undefined' && 'bun' in process.versions)",
        ] {
            for source in [
                format!("if ({test}) import('./other');"),
                format!("const isOther = {test}; if (isOther) import('./other');"),
                format!(
                    "const isOther = {test}; export function load() {{ if (isOther) return import('./other'); }}"
                ),
                format!("export const loaded = {test} ? import('./other') : null;"),
                format!("export const loaded = ({test}) && import('./other');"),
                format!("export const loaded = !({test}) || import('./other');"),
            ] {
                assert_eq!(count_import_sites(source.leak()), 0, "{test}");
            }
        }
    }

    #[test]
    fn default_import_of_the_process_module_is_the_global() {
        for test in [
            "!process",
            "!process.isBun",
            "!process.versions.bun",
            "!('bun' in process.versions)",
            "process.release.name !== 'node'",
        ] {
            let from = |module: &str| {
                format!("import process from '{module}'; if ({test}) import('./other');").leak()
            };
            assert_eq!(count_import_sites(from("node:process")), 1, "{test}");
            assert_eq!(count_import_sites(from("./mine")), 2, "{test}");
        }
    }

    #[test]
    fn import_behind_name_that_is_not_the_global_is_followed() {
        for source in [
            "function f(Bun: any) { if (typeof Bun === 'undefined') import('./other'); }",
            "function f(globalThis: any) { if (!globalThis.Bun) import('./other'); }",
            "const Bun = undefined; if (!Bun) import('./other');",
            "if (typeof Deno === 'undefined') import('./other');",
            "if (typeof Bun === 'object') import('./for-bun');",
            "if (!Bun.mine) import('./other');",
            "if (!('mine' in Bun)) import('./other');",
            "if (!global.Bun) import('./other');",
            "function f(process: any) { if (!process.isBun) import('./other'); }",
            "function f(process: any) { if (!('bun' in process.versions)) import('./other'); }",
            "const process = { versions: {} as any }; if (!process.versions.bun) import('./other');",
            "if (!process.versions.deno) import('./uses-no-deno');",
            "if (!('deno' in process.versions)) import('./uses-no-deno');",
            "if (!process.release.lts) import('./other');",
            "if (process.isBun) import('./for-bun');",
            "if (!global.process) import('./other');",
        ] {
            assert_eq!(count_import_sites(source), 1, "{source}");
        }
    }

    const READS_BEHIND_INITIALIZER: [&str; 8] = [
        "var isBun = typeof Bun === 'object'; if (!isBun) import('./other');",
        "var isBun = typeof Bun === 'object', other = isBun || import('./other'); export { other };",
        "let isBun = typeof Bun === 'object'; export function load() { if (!isBun) return import('./other'); }",
        "var isBun = typeof Bun === 'object'; function load() { if (!isBun) return import('./other'); } export { load };",
        "var isBun = typeof Bun === 'object'; export function load() { if (!isBun) return import('./other'); }",
        "var isBun = typeof Bun === 'object'; const load = () => isBun || import('./other'); load();",
        "var isBun = typeof Bun === 'object'; class Loader { load() { return isBun || import('./other'); } } new Loader().load();",
        "function outer() { return load(); } var isBun = typeof Bun === 'object'; function load() { if (!isBun) return import('./other'); } outer();",
    ];

    #[test]
    fn variable_initialized_once_is_its_value_behind_the_initializer() {
        for source in READS_BEHIND_INITIALIZER {
            assert_eq!(count_import_sites(source), 0, "{source}");
        }
    }

    #[test]
    fn variable_that_may_be_read_first_is_read() {
        for source in [
            "load(); var isBun = typeof Bun === 'object'; function load() { if (!isBun) import('./other'); }",
            "export const early = { load }; var isBun = typeof Bun === 'object'; function load() { if (!isBun) import('./other'); }",
            "function outer() { load(); } outer(); var isBun = typeof Bun === 'object'; function load() { if (!isBun) import('./other'); }",
            "export default load; var isBun = typeof Bun === 'object'; function load() { if (!isBun) import('./other'); }",
            "if (globalThis.early) { var isBun = typeof Bun === 'object'; } function load() { if (!isBun) import('./other'); } load();",
            "var isBun = typeof Bun === 'object'; isBun = false; function load() { if (!isBun) import('./other'); } load();",
            "var isBun = typeof Bun === 'object'; var isBun = false; function load() { if (!isBun) import('./other'); } load();",
            "var isBun = typeof Bun === 'object'; function load() { if (!isBun) import('./other'); } eval('load()');",
            "var isBun = typeof Bun === 'object', loaded = (function () { if (!isBun) return import('./other'); })(); export { loaded };",
            "function load() { if (!isBun) import('./other'); } var isBun = typeof Bun === 'object'; load();",
            "namespace early { export function load() { if (!isBun) import('./other'); } } early.load(); var isBun = typeof Bun === 'object'; namespace late { export function load() { if (!isBun) import('./other'); } }",
        ] {
            assert_eq!(count_import_sites(source), 1, "{source}");
        }
    }

    #[test]
    fn file_on_cycle_of_imports_reads_variables_in_its_functions() {
        let sessions = create_sessions();
        let atoms = Interner::new_in(&sessions.application);
        let fold = fold_inputs_with_facts(&sessions, &atoms, &LimitValues::for_host(), NO_FACTS);
        let arena = sessions.application.arena();
        let on_cycle = fold.application.for_file_called_before_it_runs();
        for (index, source) in (0..).zip(READS_BEHIND_INITIALIZER) {
            let is_variable_read_in_function = index >= 3;
            let alone = analyze(source, &fold.application, arena, &atoms);
            assert_eq!(
                alone.relies_on_running_before_calls, is_variable_read_in_function,
                "{source}"
            );
            let analysis = analyze(source, &on_cycle, arena, &atoms);
            assert!(!analysis.relies_on_running_before_calls, "{source}");
            assert_eq!(
                analysis.import_sites.len(),
                usize::from(is_variable_read_in_function),
                "{source}"
            );
        }
    }

    #[test]
    fn store_and_delete_are_left_as_written() {
        let sessions = create_sessions();
        let atoms = Interner::new_in(&sessions.application);
        let fold = fold_inputs_with_facts(&sessions, &atoms, &LimitValues::for_host(), NO_FACTS);
        let arena = sessions.application.arena();
        let source = "Bun = false; globalThis.Bun = false; delete globalThis.Bun; process.isBun = false; delete process.versions.bun; delete process.isBun;";
        let analysis = analyze(source, &fold.application, arena, &atoms);
        assert!(analysis.errors.is_empty());
        for index in 0..64 {
            let decision = analysis.decisions.decision(ExprId(index));
            assert_eq!(decision, Decision::Unknown, "{index}");
        }
    }

    fn last_value_at<'s>(
        names: &[&[u8]],
        provided: Define<'s>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
    ) -> Option<DefineValue<'s>> {
        let path = global_path(names, arena, atoms);
        after_constant_globals(&[provided], Platforms::LINUX, arena, atoms)
            .iter()
            .rfind(|define| define.path == path)
            .map(|define| define.value)
    }

    #[test]
    fn define_hides_what_every_run_has_from_there_on() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let object = Some(DefineValue::RuntimeValue(RuntimeValueKind::Object));
        let undefined = DefineValue::Constant(Constant::Undefined);
        let below = Define {
            path: global_path(&[b"Bun", b"version"], arena, &atoms),
            value: undefined,
        };
        let at = Define {
            path: global_path(&[b"Bun"], arena, &atoms),
            value: undefined,
        };
        let through_global: &[&[u8]] = &[b"globalThis", b"Bun"];
        assert_eq!(last_value_at(&[b"Bun"], below, arena, &atoms), object);
        assert_eq!(last_value_at(through_global, below, arena, &atoms), object);
        assert_eq!(last_value_at(&[b"Bun"], at, arena, &atoms), Some(undefined));
        assert_eq!(last_value_at(through_global, at, arena, &atoms), object);

        let text = |text: &[u8]| Constant::String(atoms.intern(text));
        let define = |names: &[&[u8]], value: Constant| Define {
            path: global_path(names, arena, &atoms),
            value: DefineValue::Constant(value),
        };
        let version = text(bun_core::Global::package_json_version.as_bytes());
        let (bun, node): (&[&[u8]], &[&[u8]]) = (
            &[b"process", b"versions", b"bun"],
            &[b"process", b"versions", b"node"],
        );
        let platform = define(&[b"process", b"platform"], text(b"linux"));
        assert_eq!(
            last_value_at(&[b"process"], platform, arena, &atoms),
            object
        );
        assert_eq!(
            last_value_at(bun, define(bun, version), arena, &atoms),
            Some(DefineValue::RuntimeConstant(version))
        );
        assert_eq!(
            last_value_at(node, define(node, text(b"0.0.0")), arena, &atoms),
            Some(DefineValue::Constant(text(b"0.0.0")))
        );
        let release = define(&[b"process", b"release"], Constant::Undefined);
        assert_eq!(
            last_value_at(&[b"process", b"release"], release, arena, &atoms),
            Some(undefined)
        );
        assert_eq!(
            last_value_at(&[b"process", b"release", b"name"], release, arena, &atoms),
            None
        );
    }

    #[test]
    fn define_of_global_hides_locked_paths_below_it() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let renamed = [Define {
            path: global_path(&[b"Object"], arena, &atoms),
            value: DefineValue::GlobalPath(arena.alloc_slice_copy(&[atoms.intern(b"Mine")])),
        }];
        let defines = after_constant_globals(&renamed, Platforms::LINUX, arena, &atoms);
        let below = |root: &[u8]| {
            let root = DefineRoot::Global(atoms.intern(root));
            defines
                .iter()
                .filter(|define| define.path.root == root)
                .count()
        };
        assert_eq!(below(b"Object"), 1);
        assert!(below(b"Array") > 1);
    }

    #[test]
    fn other_bundle_export_is_unknown() {
        let sessions = create_sessions();
        let atoms = Interner::new_in(&sessions.application);
        let fold = fold_inputs_with_facts(&sessions, &atoms, &LimitValues::for_host(), NO_FACTS);
        let source = "import { nope } from 'bun:bundle'; nope();";
        let analysis = analyze(
            source,
            &fold.application,
            sessions.application.arena(),
            &atoms,
        );
        let errors: Vec<FoldErrorKind> = analysis.errors.iter().map(|error| error.kind).collect();
        assert_eq!(
            errors,
            [FoldErrorKind::UnknownBundleExport(atoms.intern(b"nope"))]
        );
    }

    #[test]
    fn string_limit_reaches_both_projects() {
        let sessions = create_sessions();
        let atoms = Interner::new_in(&sessions.application);
        let mut limits = LimitValues::for_host();
        limits.lower(LimitId::MaxFoldedStringBytes, 4);
        let fold = fold_inputs_with_facts(&sessions, &atoms, &limits, NO_FACTS);
        for (project, inputs) in fold.iter() {
            let arena = sessions.get(project).arena();
            let count_over_limit = |source| {
                analyze(source, inputs, arena, &atoms)
                    .strings_over_limit
                    .len()
            };
            assert_eq!(
                count_over_limit("export const text = 'abc' + 'def';"),
                1,
                "{project:?}"
            );
            assert_eq!(
                count_over_limit("export const text = 'ab' + 'cd';"),
                0,
                "{project:?}"
            );
        }
    }
}
