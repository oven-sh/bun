use std::fmt::Write;

use bun_sema::hir::EnumId;
use bun_sema_driver::{ThreadCaches, for_each_parallel_in_runs};

use super::*;
use crate::compile::testing::{default_settings, set_up_output, with_bind_input};
use crate::ir::run_serially;
use crate::modules::bind_modules;

fn mix(first: usize, second: usize) -> usize {
    let mut mixed = (first as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (second as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    mixed ^= mixed >> 29;
    mixed = mixed.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    (mixed ^ (mixed >> 32)) as usize
}

#[derive(Copy, Clone, PartialEq)]
enum Extra {
    None,
    LoadsByUnknownNames,
    WaysToModuleObjects,
}

fn generate_program(groups: usize, extra: Extra) -> Vec<(String, String)> {
    let mut files = vec![
        (
            "main.ts".to_owned(),
            "import { a0_0 } from './a0'; console.log(a0_0());".to_owned(),
        ),
        (
            "node_modules/quiet/package.json".to_owned(),
            r#"{ "name": "quiet", "version": "1.0.0", "type": "module", "sideEffects": false }"#
                .to_owned(),
        ),
    ];
    for group in 0..groups {
        let other = |salt: usize| (group + 1 + mix(group, salt) % (groups - 1)) % groups;
        let is_one_in = |count: usize, salt: usize| mix(group, salt) % count == 0;

        let mut a = String::new();
        let mut calls: [Vec<String>; 2] = [Vec::new(), Vec::new()];
        for (salt, child) in [2 * group + 1, 2 * group + 2].into_iter().enumerate() {
            if child < groups {
                writeln!(a, "import {{ a{child}_0, a{child}_1 }} from './a{child}';").unwrap();
                calls[0].push(format!("a{child}_{}()", mix(group, salt) % 2));
                calls[1].push(format!("a{child}_{}()", mix(group, salt + 2) % 2));
            }
        }
        let beside = other(4);
        writeln!(
            a,
            "import {{ b{group}_0, b{group}_1, b{group}_2, b{group}_3, b{group}_4, b{group}_5 }} from './b{group}';"
        )
        .unwrap();
        writeln!(a, "import {{ b{beside}_1 as beside }} from './b{beside}';").unwrap();
        calls[0].push(format!("b{group}_{}()", mix(group, 5) % 2));
        calls[1].push(format!("b{group}_{}()", 2 + mix(group, 6) % 3));
        calls[1].push("beside()".to_owned());
        if extra != Extra::None {
            calls[0].push(format!("b{group}_5('')"));
        }
        for (index, calls) in calls.iter().enumerate() {
            let calls = calls.join(", ");
            writeln!(
                a,
                "export function a{group}_{index}() {{ return [{calls}]; }}"
            )
            .unwrap();
        }
        files.push((format!("a{group}.ts"), a));

        let (enums, quiet, commonjs, namespace) = (other(7), other(8), other(9), other(10));
        let mut b = String::new();
        writeln!(b, "import {{ E{group}, M{group} }} from './e{group}';").unwrap();
        writeln!(
            b,
            "import {{ E{enums} as E, M{enums} as M }} from './e{enums}';"
        )
        .unwrap();
        writeln!(
            b,
            "import {{ q{group}_0, q{group}_1 }} from 'quiet/q{group}.js';"
        )
        .unwrap();
        writeln!(
            b,
            "import {{ q{quiet}_1 as q, q{quiet}_2 as r }} from 'quiet/q{quiet}.js';"
        )
        .unwrap();
        writeln!(
            b,
            "import {{ c{group}_0, c{group}_4 }} from './c{group}.cjs';"
        )
        .unwrap();
        writeln!(b, "import * as c from './c{commonjs}.cjs';").unwrap();
        writeln!(b, "import * as n from './b{namespace}';").unwrap();
        writeln!(
            b,
            "export function b{group}_0() {{ return [E{group}.B, M.D, q{group}_0()]; }}"
        )
        .unwrap();
        writeln!(
            b,
            "export function b{group}_1() {{ return [E.B, M{group}.D, q(), c{group}_0()]; }}"
        )
        .unwrap();
        let handed_on = if is_one_in(3, 11) { "E" } else { "M" };
        writeln!(
            b,
            "export function b{group}_2() {{ return [{handed_on}, r, q{group}_1]; }}"
        )
        .unwrap();
        writeln!(
            b,
            "export function b{group}_3() {{ return [n.b{namespace}_0(), c.c{commonjs}_2()]; }}"
        )
        .unwrap();
        let looked_at = if is_one_in(4, 12) { "n" } else { "c" };
        writeln!(
            b,
            "export function b{group}_4() {{ return [Object.keys({looked_at}), c.c{commonjs}_1]; }}"
        )
        .unwrap();
        writeln!(
            b,
            "export function b{group}_5(name: string) {{ return c{group}_4(name); }}"
        )
        .unwrap();
        files.push((format!("b{group}.ts"), b));

        let source = other(16);
        let mut q = String::new();
        writeln!(q, "import {{ q{source}_0 }} from './q{source}.js';").unwrap();
        if is_one_in(8, 17) {
            writeln!(q, "export * from './q{}.js';", other(18)).unwrap();
        }
        writeln!(q, "export function q{group}_0() {{ return 1; }}").unwrap();
        writeln!(
            q,
            "export function q{group}_1() {{ return q{source}_0(); }}"
        )
        .unwrap();
        writeln!(q, "export const q{group}_2 = 2;").unwrap();
        files.push((format!("node_modules/quiet/q{group}.js"), q));

        let required = other(19);
        let mut c = String::new();
        writeln!(c, "const other = require('./c{required}.cjs');").unwrap();
        writeln!(
            c,
            "exports.c{group}_0 = function () {{ return other.c{required}_1; }};"
        )
        .unwrap();
        writeln!(c, "exports.c{group}_1 = 1;").unwrap();
        writeln!(c, "exports.c{group}_2 = function () {{ return this; }};").unwrap();
        writeln!(
            c,
            "exports.c{group}_3 = function () {{ return Object.keys(other); }};"
        )
        .unwrap();
        let fourth = match extra {
            Extra::LoadsByUnknownNames if is_one_in(40, 13) => "require(name)".to_owned(),
            Extra::LoadsByUnknownNames if is_one_in(10, 14) => {
                format!("[require(name).c{required}_1, './b{namespace}', './c{commonjs}.cjs']")
            }
            Extra::WaysToModuleObjects if is_one_in(50, 15) => "module.children".to_owned(),
            _ => "name".to_owned(),
        };
        writeln!(
            c,
            "exports.c{group}_4 = function (name) {{ return {fourth}; }};"
        )
        .unwrap();
        if extra == Extra::WaysToModuleObjects {
            writeln!(
                c,
                "const {{ E{required}: taken }} = require('./e{required}');\nexports.c{group}_5 = taken.A;"
            )
            .unwrap();
        }
        files.push((format!("c{group}.cjs"), c));

        let mut e = String::new();
        let made_of = match group {
            0 => "1".to_owned(),
            _ => {
                let earlier = mix(group, 21) % group;
                let name = if is_one_in(2, 22) { "E" } else { "M" };
                let member = if name == "E" { "B" } else { "D" };
                writeln!(e, "import {{ {name}{earlier} }} from './e{earlier}';").unwrap();
                format!("{name}{earlier}.{member} + 1")
            }
        };
        writeln!(
            e,
            "export enum E{group} {{ A = 1, B = 'b'.length, C = B + 1 }}"
        )
        .unwrap();
        writeln!(e, "export enum M{group} {{ D = {made_of} }}").unwrap();
        files.push((format!("e{group}.ts"), e));
    }
    files
}

struct Outcome {
    left_out: LeftOutCode,
    reached: ReachedModules,
    functions: Vec<(usize, usize)>,
    export_uses: Vec<ExportUse>,
    kept_requests: Vec<bool>,
    hooks: Vec<(FileId, u32)>,
    fingerprint: u64,
}

impl Outcome {
    fn of(input: &ProgramReachInput<'_, '_>, in_parallel: InParallel<'_>) -> Outcome {
        let (left_out, reached) = find_left_out_code(input, in_parallel);
        let functions = left_out.functions.iter();
        let mut functions: Vec<(usize, usize)> = functions
            .map(|it| (it.file.idx(), it.function.idx()))
            .collect();
        functions.sort_unstable();
        let is_code = |&file: &FileId| input.sources.kind(file) == SourceKind::Program;
        let code_files = || input.files.compiled_files().iter().copied().filter(is_code);
        let (mut export_uses, mut kept_requests) = (Vec::new(), Vec::new());
        for file in code_files() {
            for export in input.graph.exports(file) {
                export_uses.push(left_out.find_export_use(file, export));
            }
            for request in input.graph.requests(file) {
                kept_requests.push(reached.keeps_request(ModuleRef::File(file), request));
            }
        }
        let hooks = reached.replaced_loader_hooks.iter();
        let hooks = hooks.map(|it| (it.file, it.assignment.0)).collect();
        let fingerprint = fingerprint(input, &left_out, &reached, in_parallel);
        Outcome {
            left_out,
            reached,
            functions,
            export_uses,
            kept_requests,
            hooks,
            fingerprint,
        }
    }

    fn assert_is(&self, expected: &Outcome, way: &str) {
        fn assert_same<T: PartialEq>(what: &str, way: &str, found: &[T], expected: &[T]) {
            let (found_count, expected_count) = (found.len(), expected.len());
            assert!(
                found == expected,
                "{way}: {what}: {found_count}, and on one thread {expected_count}"
            );
        }
        let (left_out, reached) = (&self.left_out, &self.reached);
        assert_eq!(self.fingerprint, expected.fingerprint, "{way}");
        assert_same(
            "functions left out",
            way,
            &self.functions,
            &expected.functions,
        );
        assert!(
            left_out.declarations == expected.left_out.declarations,
            "{way}: declarations left out"
        );
        assert_same(
            "files left out",
            way,
            &left_out.files,
            &expected.left_out.files,
        );
        assert_same(
            "files read by name",
            way,
            &left_out.files_read_by_name,
            &expected.left_out.files_read_by_name,
        );
        assert_eq!(
            left_out.holds_every_load_by_unknown_name,
            expected.left_out.holds_every_load_by_unknown_name,
            "{way}"
        );
        assert_same(
            "uses of exports",
            way,
            &self.export_uses,
            &expected.export_uses,
        );
        assert_same(
            "requests kept",
            way,
            &self.kept_requests,
            &expected.kept_requests,
        );
        assert_same("loader hooks", way, &self.hooks, &expected.hooks);
        for (what, found, expected) in [
            ("looked at", &reached.looked_at, &expected.reached.looked_at),
            (
                "with module objects",
                &reached.with_module_objects,
                &expected.reached.with_module_objects,
            ),
            (
                "naming ways",
                &reached.naming_ways,
                &expected.reached.naming_ways,
            ),
            (
                "found by name",
                &reached.found_by_name,
                &expected.reached.found_by_name,
            ),
            (
                "data found by name",
                &reached.data_found_by_name,
                &expected.reached.data_found_by_name,
            ),
            (
                "inner modules left out",
                &reached.left_out_inner_modules,
                &expected.reached.left_out_inner_modules,
            ),
        ] {
            assert_same(what, way, found, expected);
        }
    }
}

fn run_in_reverse(count: usize, work: &(dyn Fn(usize) + Sync)) {
    (0..count).rev().for_each(work);
}

fn run_out_of_order(count: usize, work: &(dyn Fn(usize) + Sync)) {
    let mut order: Vec<usize> = (0..count).collect();
    order.sort_unstable_by_key(|&index| mix(index, count));
    order.into_iter().for_each(work);
}

fn assert_same_on_any_number_of_threads(
    groups: usize,
    extra: Extra,
    look_at_one_thread: impl FnOnce(&ProgramReachInput<'_, '_>, &Outcome),
) {
    let files = generate_program(groups, extra);
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(name, text)| (name.as_str(), text.as_str()))
        .collect();
    with_bind_input(&files, &default_settings(), |bind_input| {
        let graph = bind_modules(bind_input).graph;
        assert!(graph.errors().is_empty(), "the program links");
        let input = ProgramReachInput {
            files: bind_input.files,
            sources: bind_input.sources,
            graph: &graph,
            known_helpers: bind_input.known_helpers,
            removable: RemovableOptions::default(),
            counts_executions: false,
            any_file_is_named_at_run_time: false,
            files_are_named_out_of_sight: false,
            admits_inspector: false,
            isolates_code_from_disk: false,
            mocks_any_module: false,
            files_started_by_runner: &[],
            files_with_kept_imports: &[],
            starts_of_workers: &[],
            beside: bind_input.beside,
        };
        let expected = Outcome::of(&input, &run_serially);
        look_at_one_thread(&input, &expected);
        Outcome::of(&input, &run_in_reverse).assert_is(&expected, "the tasks in reverse");
        Outcome::of(&input, &run_out_of_order).assert_is(&expected, "the tasks out of order");
        let caches = ThreadCaches::default();
        for threads in [1, 3, 8, 64, 64] {
            let on_threads = |count: usize, work: &(dyn Fn(usize) + Sync)| {
                for_each_parallel_in_runs(&caches, threads, count, 1, work);
            };
            Outcome::of(&input, &on_threads).assert_is(&expected, &format!("{threads} threads"));
        }
    });
}

fn count_enums(input: &ProgramReachInput<'_, '_>, outcome: &Outcome) -> (usize, usize) {
    let (mut made, mut not_made) = (0, 0);
    for &file in input.files.compiled_files() {
        if !(input.files.module(file).file_name()).starts_with(b"/project/e") {
            continue;
        }
        for declaration in [EnumId(0), EnumId(1)] {
            let statement = input.files.hir(file)[declaration].stmt;
            let declarations = &outcome.left_out.declarations;
            match declarations.is_statement_left_out(file, statement) {
                true => not_made += 1,
                false => made += 1,
            }
        }
    }
    (made, not_made)
}

#[test]
fn ten_thousand_files_are_reached_alike_on_any_number_of_threads() {
    assert_same_on_any_number_of_threads(2000, Extra::None, |input, outcome| {
        let file_count = input.files.compiled_files().len();
        assert!(file_count > 10_000, "{file_count} files are loaded");
        let (left_out, reached) = (&outcome.left_out, &outcome.reached);
        assert!(
            left_out.files.len() > 100,
            "files of the package that nothing uses"
        );
        assert!(
            left_out.files.len() < 1900,
            "files of the package that something uses"
        );
        assert!(outcome.functions.len() > 1000);
        assert!(left_out.files_read_by_name.len() > 1000);
        assert!(reached.looked_at.len() > 100);
        let (made, not_made) = count_enums(input, outcome);
        assert!(
            made > 100 && not_made > 100,
            "{made} enums are made, {not_made} are not"
        );
        assert!(outcome.export_uses.contains(&ExportUse::None));
        assert!(outcome.export_uses.contains(&ExportUse::Bound));
        assert!(reached.found_by_name.is_empty() && reached.naming_ways.is_empty());
    });
}

#[test]
fn files_that_loads_find_by_name_are_reached_alike_on_any_number_of_threads() {
    assert_same_on_any_number_of_threads(300, Extra::LoadsByUnknownNames, |_, outcome| {
        assert!(!outcome.left_out.holds_every_load_by_unknown_name);
        assert!(outcome.reached.found_by_name.len() > 10);
    });
}

#[test]
fn ways_to_module_objects_are_reached_alike_on_any_number_of_threads() {
    assert_same_on_any_number_of_threads(300, Extra::WaysToModuleObjects, |_, outcome| {
        assert!(!outcome.reached.naming_ways.is_empty());
        assert!(outcome.reached.with_module_objects.len() > 300);
    });
}

#[test]
fn one_caller_adds_a_key_to_a_shared_set() {
    set_up_output();
    let set: SharedSet<(u32, u32)> = SharedSet::default();
    let caches = ThreadCaches::default();
    let added = core::sync::atomic::AtomicUsize::new(0);
    for_each_parallel_in_runs(&caches, 8, 8000, 1, &|index| {
        if set.insert((index as u32 % 1000, 7)) {
            added.fetch_add(1, Ordering::Relaxed);
        }
    });
    assert_eq!(added.load(Ordering::Relaxed), 1000);
    assert!(set.contains(&(999, 7)) && !set.contains(&(1000, 7)));
}
