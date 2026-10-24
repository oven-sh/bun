use super::*;

const KNOWN_LOADS: &[(Setup, &str)] = &[
    (PROGRAM, "console.log(1);"),
    (PROGRAM, "process.cwd();"),
    (SCRIPT, "require('node:fs');"),
    (SCRIPT, "require(name);"),
    (SCRIPT, "const load = require; load(name);"),
    (SCRIPT, "module.require(name);"),
    (SCRIPT, "require.resolve(name);"),
    (SCRIPT, "typeof require;"),
    (SCRIPT, "require.main === module;"),
    (SCRIPT, "module.exports = 1;"),
    (PROGRAM, "import.meta.require(name);"),
    (PROGRAM, "process.getBuiltinModule('node:fs');"),
    (PROGRAM, "typeof Worker;"),
    (PROGRAM, "x instanceof Worker;"),
    (PROGRAM, "typeof process.dlopen;"),
    (PROGRAM, "import fs from 'node:fs';"),
    (PROGRAM, "import process from 'node:process';"),
    (PROGRAM, "import { serve } from 'bun';"),
    (PROGRAM, "import vm from 'node:vm';"),
    (SCRIPT, "require('node:vm');"),
    (PROGRAM, "import('node:vm');"),
    (PROGRAM, "import 'node:module';"),
    (PROGRAM, "import { createRequire } from 'node:module';"),
    (
        PROGRAM,
        "import { isBuiltin } from 'node:module'; isBuiltin(name);",
    ),
    (PROGRAM, "import Module from 'node:module'; typeof Module;"),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; createRequire(import.meta.url)('./a.json');",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; createRequire(import.meta.url)(name);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('./a.json'); load.resolve(name); typeof load;",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url), same = load; same('./a.json');",
    ),
    (SCRIPT, "require('node:module');"),
    (
        SCRIPT,
        "const { createRequire } = require('node:module'); createRequire(__filename)('./a.json');",
    ),
];

const UNKNOWN_LOADS: &[(Setup, &str)] = &[
    (SCRIPT, "const load = require; f(load);"),
    (SCRIPT, "const load = require; load(name); f(load);"),
    (SCRIPT, "let load = require; load = f; load(name);"),
    (SCRIPT, "f(require);"),
    (SCRIPT, "require.bind(null)(name);"),
    (SCRIPT, "require.call(null, name);"),
    (SCRIPT, "require.apply(null, [name]);"),
    (PROGRAM, "import.meta.require.bind(null)(name);"),
    (PROGRAM, "process.getBuiltinModule.bind(process)(name);"),
    (PROGRAM, "process.getBuiltinModule.call(process, name);"),
    (PROGRAM, "process.getBuiltinModule.apply(process, [name]);"),
    (SCRIPT, "f(module.require);"),
    (SCRIPT, "f(module);"),
    (SCRIPT, "require.extensions[name];"),
    (PROGRAM, "f(process);"),
    (PROGRAM, "process[name];"),
    (PROGRAM, "Bun.plugin(plugin);"),
    (PROGRAM, "Bun.build(options);"),
    (PROGRAM, "f(Bun);"),
    (PROGRAM, "f(globalThis);"),
    (PROGRAM, "new ShadowRealm();"),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; f(createRequire(import.meta.url));",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; f(createRequire(import.meta.url) as any);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); f(load);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); x = { load };",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load.call(null, name);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; export const load = createRequire(import.meta.url);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; let load = createRequire(import.meta.url); load = f;",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; function g() { return createRequire(import.meta.url); }",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; createRequire('/other/file.js')(name);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; f(createRequire);",
    ),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; export { createRequire };",
    ),
    (PROGRAM, "export { createRequire } from 'node:module';"),
    (
        PROGRAM,
        "import { createRequire } from 'node:module'; const make = createRequire; make(import.meta.url)(name);",
    ),
    (
        PROGRAM,
        "import Module from 'node:module'; Module._load(name);",
    ),
    (
        PROGRAM,
        "import Module from 'node:module'; new Module(id).require(name);",
    ),
    (PROGRAM, "import Module from 'node:module'; f(Module);"),
    (PROGRAM, "import * as all from 'node:module'; f(all);"),
    (PROGRAM, "import('node:module');"),
    (PROGRAM, "export * from 'node:module';"),
    (SCRIPT, "f(require('node:module'));"),
];

// A Worker has a global of its own and starts with an entry point of the build, which begins a program of its own.
const WORKERS: &[(Setup, &str)] = &[
    (PROGRAM, "new Worker(name);"),
    (PROGRAM, "new Worker('./worker.ts');"),
    (PROGRAM, "f(Worker);"),
];

// Machine code is native code like Bun's own. It brings no module that the compiler has not seen.
const MACHINE_CODE_LOADS: &[(Setup, &str)] = &[
    (PROGRAM, "process.dlopen(target, name);"),
    (PROGRAM, "f(process.dlopen);"),
    (
        PROGRAM,
        "import { dlopen } from 'bun:ffi'; dlopen(name, symbols);",
    ),
    (PROGRAM, "import { cc } from 'bun:ffi'; cc(options);"),
    (
        PROGRAM,
        "import { linkSymbols } from 'bun:ffi'; linkSymbols(symbols);",
    ),
    (PROGRAM, "import * as ffi from 'bun:ffi'; f(ffi);"),
    (SCRIPT, "require('bun:ffi').dlopen(name, symbols);"),
    (PROGRAM, "Bun.FFI.dlopen(name, symbols);"),
    (PROGRAM, "f(Bun.FFI);"),
];

#[test]
fn import_sites_and_inspections_load_nothing_unknown() {
    for &(setup, source) in KNOWN_LOADS {
        with_case(setup, source, |case| {
            assert!(!case.resolved.loads_unknown_modules(), "{source}");
        });
    }
}

#[test]
fn calling_or_exposing_a_loader_loads_unknown_modules() {
    for &(setup, source) in UNKNOWN_LOADS {
        with_case(setup, source, |case| {
            assert!(case.resolved.loads_unknown_modules(), "{source}");
        });
    }
}

#[test]
fn starting_a_worker_loads_nothing_unknown() {
    for &(setup, source) in WORKERS {
        with_case(setup, source, |case| {
            assert!(!case.resolved.loads_unknown_modules(), "{source}");
        });
    }
}

#[test]
fn loading_machine_code_loads_nothing_unknown() {
    for &(setup, source) in MACHINE_CODE_LOADS {
        with_case(setup, source, |case| {
            assert!(!case.resolved.loads_unknown_modules(), "{source}");
        });
    }
}

#[test]
fn runtime_files_load_nothing_unknown() {
    for &(_, source) in UNKNOWN_LOADS {
        with_case(RUNTIME, source, |case| {
            assert!(!case.resolved.loads_unknown_modules(), "{source}");
        });
    }
}
