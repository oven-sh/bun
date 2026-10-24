use super::*;

const KNOWN_LOADS: &[&str] = &[
    "console.log(1);",
    "process.cwd();",
    "import.meta.require(name);",
    "process.getBuiltinModule('node:fs');",
    "typeof Worker;",
    "x instanceof Worker;",
    "typeof process.dlopen;",
    "import fs from 'node:fs';",
    "import process from 'node:process';",
    "import { serve } from 'bun';",
    "import vm from 'node:vm';",
    "import('node:vm');",
    "import 'node:module';",
    "import { createRequire } from 'node:module';",
    "import { isBuiltin } from 'node:module'; isBuiltin(name);",
    "import Module from 'node:module'; typeof Module;",
    "import { createRequire } from 'node:module'; createRequire(import.meta.url)('./a.json');",
    "import { createRequire } from 'node:module'; createRequire(import.meta.url)(name);",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('./a.json'); load.resolve(name); typeof load;",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url), same = load; same('./a.json');",
];

const KNOWN_LOADS_OF_SCRIPTS: &[&str] = &[
    "require('node:fs');",
    "require(name);",
    "const load = require; load(name);",
    "module.require(name);",
    "require.resolve(name);",
    "typeof require;",
    "require.main === module;",
    "module.exports = 1;",
    "require('node:vm');",
    "require('node:module');",
    "const { createRequire } = require('node:module'); createRequire(__filename)('./a.json');",
];

const UNKNOWN_LOADS: &[&str] = &[
    "import.meta.require.bind(null)(name);",
    "process.getBuiltinModule.bind(process)(name);",
    "process.getBuiltinModule.call(process, name);",
    "process.getBuiltinModule.apply(process, [name]);",
    "f(process);",
    "process[name];",
    "Bun.plugin(plugin);",
    "Bun.build(options);",
    "f(Bun);",
    "f(globalThis);",
    "new ShadowRealm();",
    "import { createRequire } from 'node:module'; f(createRequire(import.meta.url));",
    "import { createRequire } from 'node:module'; f(createRequire(import.meta.url) as any);",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); f(load);",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); x = { load };",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load.call(null, name);",
    "import { createRequire } from 'node:module'; export const load = createRequire(import.meta.url);",
    "import { createRequire } from 'node:module'; let load = createRequire(import.meta.url); load = f;",
    "import { createRequire } from 'node:module'; function g() { return createRequire(import.meta.url); }",
    "import { createRequire } from 'node:module'; createRequire('/other/file.js')(name);",
    "import { createRequire } from 'node:module'; f(createRequire);",
    "import { createRequire } from 'node:module'; export { createRequire };",
    "export { createRequire } from 'node:module';",
    "import { createRequire } from 'node:module'; const make = createRequire; make(import.meta.url)(name);",
    "import Module from 'node:module'; Module._load(name);",
    "import Module from 'node:module'; new Module(id).require(name);",
    "import Module from 'node:module'; f(Module);",
    "import * as all from 'node:module'; f(all);",
    "import('node:module');",
    "export * from 'node:module';",
];

const UNKNOWN_LOADS_OF_SCRIPTS: &[&str] = &[
    "const load = require; f(load);",
    "const load = require; load(name); f(load);",
    "let load = require; load = f; load(name);",
    "f(require);",
    "require.bind(null)(name);",
    "require.call(null, name);",
    "require.apply(null, [name]);",
    "f(module.require);",
    "f(module);",
    "require.extensions[name];",
    "f(require('node:module'));",
];

// A Worker has a global of its own and starts with an entry point of the build, which begins a program of its own.
const WORKERS: &[&str] = &[
    "new Worker(name);",
    "new Worker('./worker.ts');",
    "f(Worker);",
];

// Machine code is native code like Bun's own. It brings no module that the compiler has not seen.
const MACHINE_CODE_LOADS: &[&str] = &[
    "process.dlopen(target, name);",
    "f(process.dlopen);",
    "import { dlopen } from 'bun:ffi'; dlopen(name, symbols);",
    "import { cc } from 'bun:ffi'; cc(options);",
    "import { linkSymbols } from 'bun:ffi'; linkSymbols(symbols);",
    "import * as ffi from 'bun:ffi'; f(ffi);",
    "Bun.FFI.dlopen(name, symbols);",
    "f(Bun.FFI);",
];

#[track_caller]
fn assert_loads_unknown_modules(setup: Setup, sources: &[&str], expected: bool) {
    for &source in sources {
        with_case(setup, source, |case| {
            assert_eq!(case.resolved.loads_unknown_modules(), expected, "{source}");
        });
    }
}

#[test]
fn import_sites_and_inspections_load_nothing_unknown() {
    assert_loads_unknown_modules(PROGRAM, KNOWN_LOADS, false);
    assert_loads_unknown_modules(SCRIPT, KNOWN_LOADS_OF_SCRIPTS, false);
}

#[test]
fn calling_or_exposing_a_loader_loads_unknown_modules() {
    assert_loads_unknown_modules(PROGRAM, UNKNOWN_LOADS, true);
    assert_loads_unknown_modules(SCRIPT, UNKNOWN_LOADS_OF_SCRIPTS, true);
}

#[test]
fn starting_a_worker_loads_nothing_unknown() {
    assert_loads_unknown_modules(PROGRAM, WORKERS, false);
}

#[test]
fn loading_machine_code_loads_nothing_unknown() {
    assert_loads_unknown_modules(PROGRAM, MACHINE_CODE_LOADS, false);
    let source = "require('bun:ffi').dlopen(name, symbols);";
    assert_loads_unknown_modules(SCRIPT, &[source], false);
}

#[test]
fn runtime_files_load_nothing_unknown() {
    assert_loads_unknown_modules(RUNTIME, UNKNOWN_LOADS, false);
    assert_loads_unknown_modules(RUNTIME, UNKNOWN_LOADS_OF_SCRIPTS, false);
}
