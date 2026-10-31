use bstr::ByteSlice;

use super::testing::{default_settings, with_loaded_build};
use crate::load::ProjectId;

// Whether `main.ts`, which loads `./loaded` behind a test, brings the file into the program.
fn loads(files: &[(&str, &str)]) -> bool {
    let mut all = files.to_vec();
    all.push(("loaded.ts", "console.log('loaded');"));
    with_loaded_build(&all, &default_settings(), |_, loaded| {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let mut paths = files
            .compiled_files()
            .iter()
            .map(|&file| files.module(file).file_name());
        paths.any(|path| path.as_bstr() == "/project/loaded.ts")
    })
}

const FLAGS: (&str, &str) = (
    "flags.ts",
    "export const debug = false; export const level = 1 + 2; export default 'quiet'; export let open = false; export var old = false; export const list = [];",
);

#[test]
fn constant_of_another_file_decides_what_is_loaded() {
    for main in [
        "import { debug } from './flags'; if (debug) import('./loaded');",
        "import { debug as renamed } from './flags'; if (renamed) import('./loaded');",
        "import { level } from './flags'; if (level !== 3) import('./loaded');",
        "import mode from './flags'; if (mode !== 'quiet') import('./loaded');",
        "import { default as mode } from './flags'; if (mode !== 'quiet') import('./loaded');",
        "import * as flags from './flags'; if (flags.debug) import('./loaded');",
        "import * as flags from './flags'; if (flags['debug']) import('./loaded');",
        "import * as flags from './flags'; if (flags?.debug) import('./loaded');",
        "import * as flags from './flags'; if (flags.default !== 'quiet') import('./loaded');",
        "import { debug } from './flags'; export function load() { return debug && import('./loaded'); }",
        "import { debug } from './flags'; export const loaded = debug ? import('./loaded') : null;",
        "import { debug } from './flags'; const on = debug; if (on) import('./loaded');",
    ] {
        assert!(!loads(&[("main.ts", main), FLAGS]), "{main}");
    }
}

#[test]
fn export_that_is_no_constant_decides_nothing() {
    for main in [
        "import { open } from './flags'; if (open) import('./loaded');",
        "import { old } from './flags'; if (old) import('./loaded');",
        "import { list } from './flags'; if (list.length) import('./loaded');",
        "import * as flags from './flags'; if (flags.open) import('./loaded');",
        "import * as flags from './flags'; if ((flags as any).absent) import('./loaded');",
        "import * as flags from './flags'; if ((flags as any).__esModule) import('./loaded');",
        "import * as flags from './flags'; if ((flags as any).then) import('./loaded');",
        "import * as flags from './flags'; const name: string = 'debug'; if ((flags as any)[name + '']) import('./loaded');",
        "import { debug } from './flags'; if (!debug) import('./loaded');",
        "import { debug } from './flags'; function f(debug: boolean) { if (debug) import('./loaded'); } f(debug);",
        "import defer * as flags from './flags'; if (flags.open) import('./loaded');",
    ] {
        assert!(loads(&[("main.ts", main), FLAGS]), "{main}");
    }
}

#[test]
fn constant_is_followed_through_files_that_export_it_again() {
    let main = (
        "main.ts",
        "import { debug } from './barrel'; if (debug) import('./loaded');",
    );
    for barrel in [
        "export { debug } from './flags';",
        "export * from './flags';",
        "export * from './empty'; export * from './flags';",
        "import { debug } from './flags'; export { debug };",
        "import { debug as inner } from './flags'; export { inner as debug };",
        "import { debug as inner } from './flags'; export const debug = inner;",
        "import { level } from './flags'; export const debug = level > 3;",
        "export * from './flags'; export * from './again';",
    ] {
        let files = [
            main,
            ("barrel.ts", barrel),
            ("empty.ts", "export {};"),
            ("again.ts", "export { debug } from './flags';"),
            FLAGS,
        ];
        assert!(!loads(&files), "{barrel}");
    }
}

#[test]
fn namespace_object_is_followed_through_files_that_export_it_again() {
    let main = (
        "main.ts",
        "import { flags } from './barrel'; if (flags.debug) import('./loaded');",
    );
    for barrel in [
        "export * as flags from './flags';",
        "import * as flags from './flags'; export { flags };",
    ] {
        assert!(!loads(&[main, ("barrel.ts", barrel), FLAGS]), "{barrel}");
    }
}

#[test]
fn name_that_the_build_does_not_follow_decides_nothing() {
    let main = (
        "main.ts",
        "import { debug } from './barrel'; if (debug) import('./loaded');",
    );
    for barrel in [
        "export * from './flags'; export * from './other';",
        "export * from './values.cjs'; export * from './flags';",
        "export let debug = false;",
        "export * from './barrel'; export * from './round';",
    ] {
        let files = [
            main,
            ("barrel.ts", barrel),
            ("other.ts", "export const debug = false;"),
            ("round.ts", "export * from './barrel';"),
            ("values.cjs", "exports.other = 1;"),
            FLAGS,
        ];
        assert!(loads(&files), "{barrel}");
    }
}

#[test]
fn branch_is_decided_on_a_cycle_too() {
    let files = [
        (
            "main.ts",
            "import { debug } from './flags'; export const own = 1; if (debug) import('./loaded');",
        ),
        (
            "flags.ts",
            "import { own } from './main'; export const debug = false; export function read() { return own; }",
        ),
    ];
    assert!(!loads(&files));
}

#[test]
fn file_that_only_a_removed_branch_names_gives_no_error() {
    let main = "import { debug } from './flags'; if (debug) import('./not-there');";
    assert!(!loads(&[("main.ts", main), FLAGS]));
}
