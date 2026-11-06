//! What stands in for `@types/bun` where it is not installed: every global and every module that the run time provides, of type `any`.

use std::sync::OnceLock;

use bun_core::strings::contains;
use bun_js_parser::Jest;
use bun_sema::util::SharedSort;

use crate::builtins::table::BuiltinKind;
use crate::builtins::{BuiltinId, BuiltinName, table};
use crate::load::runtime_modules::RuntimeModules;

pub(crate) const PATH: &[u8] = b"/$bun/types/runtime.d.ts";

const NAMES_OF_EVERY_MODULE: [&[u8]; 5] = [
    b"require",
    b"module",
    b"exports",
    b"__filename",
    b"__dirname",
];

// No file declares these two: TypeScript knows them by itself.
const NAMES_WITHOUT_DECLARATIONS: [&[u8]; 2] = [b"undefined", b"globalThis"];

// `bun test` answers these names with its own runner, whatever is installed.
const OTHER_NAMES_OF_TEST_RUNNER_MODULES: [&[u8]; 2] = [b"@jest/globals", b"vitest"];
pub(crate) const OTHER_NAMES_OF_TEST_RUNNER_PATH: &[u8] = b"/$bun/types/test-runner.d.ts";
pub(crate) const OTHER_NAMES_OF_TEST_RUNNER: &[u8] = b"declare module \"@jest/globals\" {
  export * from \"bun:test\";
}
declare module \"vitest\" {
  export * from \"bun:test\";
}
";

// Names that are types alone, which no table of the run time has. Programs write these for what timers and streams return.
const TYPES_WITHOUT_VALUES: &[u8] = b"type Timer = any;
declare namespace NodeJS {
  type Timeout = any;
  type Timer = any;
  type Immediate = any;
  type ErrnoException = any;
  type ProcessEnv = any;
  type ReadableStream = any;
  type WritableStream = any;
  type Platform = any;
  type Signals = any;
}
";

// The compiler's own declarations have the module, with a few members.
const MODULE_WITH_DECLARATIONS: &[u8] = b"bun";

// `any` says nothing of the control flow: behind `if (!x) process.exit(1);` x would still be `undefined`. So the functions that
// never return, and those that say what their argument is, are declared. They take any arguments.
//
// `process` itself stays `any`, which `any & { .. }` is. What stands behind the `&` lists such members, and only
// `Checker::explicit_type_of_symbol` reads it.
//
// A class of the run time is `any` too, so `value is Buffer` is written `value is any`. To TypeScript that is true of every value.
// `Checker::apply_predicate` takes the one of this file to say `any` where the answer is yes, and nothing where it is no.
const PROCESS: &[u8] = b"process";
const MEMBERS_OF_PROCESS_THAT_NARROW: &[u8] = b"{
  abort(...rest: any[]): never;
  assert(value?: unknown, ...rest: any[]): asserts value;
  execve(...rest: any[]): never;
  exit(...rest: any[]): never;
  reallyExit(...rest: any[]): never;
}";
const MEMBERS_OF_BUFFER_THAT_NARROW: &[u8] = b"{
  isBuffer(value?: unknown, ...rest: any[]): value is any;
  isEncoding(value?: unknown, ...rest: any[]): value is any;
}";
const MEMBERS_OF_BLOCK_LIST_THAT_NARROW: &[u8] = b"{
  isBlockList(value?: unknown, ...rest: any[]): value is any;
}";
const GLOBALS_THAT_NARROW: [(&[u8], &[u8]); 2] = [
    (b"Buffer", MEMBERS_OF_BUFFER_THAT_NARROW),
    (PROCESS, MEMBERS_OF_PROCESS_THAT_NARROW),
];

struct ModuleThatNarrows {
    specifier: &'static [u8],
    without_prefix: &'static [u8],
    namespace: &'static [u8],
    before_namespace: &'static [u8],
    members: &'static [&'static [u8]],
    names_from_outside: &'static [&'static [u8]],
}

const ASSERTIONS: &[u8] = b"    export function ok(value?: unknown, ...rest: any[]): asserts value;
    export function fail(...rest: any[]): never;
    export function ifError(value?: unknown, ...rest: any[]): asserts value is null | undefined;
    export function strictEqual<T>(actual: unknown, expected: T, ...rest: any[]): asserts actual is T;
    export function strictEqual(...rest: any[]): void;
    export function deepStrictEqual<T>(actual: unknown, expected: T, ...rest: any[]): asserts actual is T;
    export function deepStrictEqual(...rest: any[]): void;
";

// In this file `Date` is the `any` of this file, and `globalThis.Date` is what TypeScript's library declares. An older library
// lacks the newest classes: `0 extends 1 & T` is true of `any` alone, and `any` in a union would make all of it `any`.
const MODULES_THAT_NARROW: [ModuleThatNarrows; 6] = [
    ModuleThatNarrows {
        specifier: b"node:assert",
        without_prefix: b"assert",
        namespace: b"assert",
        before_namespace: b"  function assert(value?: unknown, ...rest: any[]): asserts value;\n",
        members: &[
            ASSERTIONS,
            b"    export const strict: typeof import(\"node:assert/strict\");\n",
        ],
        names_from_outside: &[],
    },
    ModuleThatNarrows {
        specifier: b"node:assert/strict",
        without_prefix: b"assert/strict",
        namespace: b"strict",
        before_namespace: b"  function strict(value?: unknown, ...rest: any[]): asserts value;\n",
        members: &[
            ASSERTIONS,
            b"    export function equal<T>(actual: unknown, expected: T, ...rest: any[]): asserts actual is T;
    export function equal(...rest: any[]): void;
    export function deepEqual<T>(actual: unknown, expected: T, ...rest: any[]): asserts actual is T;
    export function deepEqual(...rest: any[]): void;
",
        ],
        names_from_outside: &[b"strict"],
    },
    ModuleThatNarrows {
        specifier: b"node:buffer",
        without_prefix: b"buffer",
        namespace: b"buffer",
        before_namespace: b"",
        members: &[
            b"    export var Buffer: any & ",
            MEMBERS_OF_BUFFER_THAT_NARROW,
            b";\n    export type Buffer = any;\n",
        ],
        names_from_outside: &[],
    },
    ModuleThatNarrows {
        specifier: b"node:net",
        without_prefix: b"net",
        namespace: b"net",
        before_namespace: b"",
        members: &[
            b"    export var BlockList: any & ",
            MEMBERS_OF_BLOCK_LIST_THAT_NARROW,
            b";\n    export type BlockList = any;\n",
        ],
        names_from_outside: &[],
    },
    ModuleThatNarrows {
        specifier: b"node:util/types",
        without_prefix: b"util/types",
        namespace: b"types",
        before_namespace: b"  type TypedArray =
    | globalThis.Int8Array
    | globalThis.Uint8Array
    | globalThis.Uint8ClampedArray
    | globalThis.Int16Array
    | globalThis.Uint16Array
    | globalThis.Int32Array
    | globalThis.Uint32Array
    | (0 extends 1 & globalThis.Float16Array ? never : globalThis.Float16Array)
    | globalThis.Float32Array
    | globalThis.Float64Array
    | (0 extends 1 & globalThis.BigInt64Array ? never : globalThis.BigInt64Array)
    | (0 extends 1 & globalThis.BigUint64Array ? never : globalThis.BigUint64Array);
",
        members: &[
            b"    export function isAnyArrayBuffer(value?: unknown, ...rest: any[]): value is ArrayBufferLike;
    export function isArgumentsObject(value?: unknown, ...rest: any[]): value is IArguments;
    export function isArrayBuffer(value?: unknown, ...rest: any[]): value is globalThis.ArrayBuffer;
    export function isArrayBufferView(value?: unknown, ...rest: any[]): value is TypedArray | globalThis.DataView;
    export function isBigInt64Array(value?: unknown, ...rest: any[]): value is globalThis.BigInt64Array;
    export function isBigIntObject(value?: unknown, ...rest: any[]): value is globalThis.BigInt;
    export function isBigUint64Array(value?: unknown, ...rest: any[]): value is globalThis.BigUint64Array;
    export function isBooleanObject(value?: unknown, ...rest: any[]): value is globalThis.Boolean;
    export function isBoxedPrimitive(value?: unknown, ...rest: any[]): value is globalThis.String | globalThis.Number | globalThis.Boolean | globalThis.Symbol;
    export function isCryptoKey(value?: unknown, ...rest: any[]): value is any;
    export function isDataView(value?: unknown, ...rest: any[]): value is globalThis.DataView;
    export function isDate(value?: unknown, ...rest: any[]): value is globalThis.Date;
    export function isFloat16Array(value?: unknown, ...rest: any[]): value is globalThis.Float16Array;
    export function isFloat32Array(value?: unknown, ...rest: any[]): value is globalThis.Float32Array;
    export function isFloat64Array(value?: unknown, ...rest: any[]): value is globalThis.Float64Array;
    export function isGeneratorFunction(value?: unknown, ...rest: any[]): value is GeneratorFunction;
    export function isGeneratorObject(value?: unknown, ...rest: any[]): value is Generator;
    export function isInt8Array(value?: unknown, ...rest: any[]): value is globalThis.Int8Array;
    export function isInt16Array(value?: unknown, ...rest: any[]): value is globalThis.Int16Array;
    export function isInt32Array(value?: unknown, ...rest: any[]): value is globalThis.Int32Array;
    export function isKeyObject(value?: unknown, ...rest: any[]): value is any;
    export function isMap<T>(
      value?: T | {},
      ...rest: any[]
    ): value is T extends ReadonlyMap<any, any> ? (unknown extends T ? never : ReadonlyMap<any, any>) : globalThis.Map<unknown, unknown>;
    export function isNativeError(value?: unknown, ...rest: any[]): value is globalThis.Error;
    export function isNumberObject(value?: unknown, ...rest: any[]): value is globalThis.Number;
    export function isPromise(value?: unknown, ...rest: any[]): value is globalThis.Promise<unknown>;
    export function isRegExp(value?: unknown, ...rest: any[]): value is globalThis.RegExp;
    export function isSet<T>(
      value?: T | {},
      ...rest: any[]
    ): value is T extends ReadonlySet<any> ? (unknown extends T ? never : ReadonlySet<any>) : globalThis.Set<unknown>;
    export function isSharedArrayBuffer(value?: unknown, ...rest: any[]): value is globalThis.SharedArrayBuffer;
    export function isStringObject(value?: unknown, ...rest: any[]): value is globalThis.String;
    export function isSymbolObject(value?: unknown, ...rest: any[]): value is globalThis.Symbol;
    export function isTypedArray(value?: unknown, ...rest: any[]): value is TypedArray;
    export function isUint8Array(value?: unknown, ...rest: any[]): value is globalThis.Uint8Array;
    export function isUint8ClampedArray(value?: unknown, ...rest: any[]): value is globalThis.Uint8ClampedArray;
    export function isUint16Array(value?: unknown, ...rest: any[]): value is globalThis.Uint16Array;
    export function isUint32Array(value?: unknown, ...rest: any[]): value is globalThis.Uint32Array;
    export function isWeakMap(value?: unknown, ...rest: any[]): value is globalThis.WeakMap<object, unknown>;
    export function isWeakSet(value?: unknown, ...rest: any[]): value is globalThis.WeakSet<object>;
",
        ],
        names_from_outside: &[],
    },
    ModuleThatNarrows {
        specifier: b"node:util",
        without_prefix: b"util",
        namespace: b"util",
        before_namespace: b"  import types = require(\"node:util/types\");\n",
        members: &[
            b"    export function isArray(value?: unknown, ...rest: any[]): value is unknown[];\n",
        ],
        names_from_outside: &[b"types"],
    },
];

const PROCESS_MODULE: [&[u8]; 2] = [b"node:process", b"process"];
const FUNCTIONS_OF_PROCESS_MODULE: &[u8] = b"  export function abort(...rest: any[]): never;
  export function assert(value?: unknown, ...rest: any[]): asserts value;
  export function execve(...rest: any[]): never;
  export function exit(...rest: any[]): never;
  export function reallyExit(...rest: any[]): never;
";

pub(crate) fn text(runtime_modules: &RuntimeModules, runs_tests: bool) -> &'static [u8] {
    static FOR_PROGRAMS_AND_FOR_TESTS: [OnceLock<Vec<u8>>; 2] = [OnceLock::new(), OnceLock::new()];
    FOR_PROGRAMS_AND_FOR_TESTS[usize::from(runs_tests)]
        .get_or_init(|| write_declarations(runtime_modules, runs_tests))
}

fn is_identifier(name: &[u8]) -> bool {
    let is_start = |byte: u8| byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$');
    name.first().is_some_and(|&first| is_start(first))
        && name
            .iter()
            .all(|&byte| is_start(byte) || byte.is_ascii_digit())
}

fn collect_global_names(runs_tests: bool) -> Vec<&'static [u8]> {
    let names = (0..BuiltinName::COUNT).map(BuiltinName);
    let globals =
        names.filter(|&name| !table::is_symbol_name(name) && table::global(name).is_some());
    let mut names: Vec<&'static [u8]> = globals.map(table::text_of_name).collect();
    names.retain(|name| !NAMES_WITHOUT_DECLARATIONS.contains(name));
    names.extend(NAMES_OF_EVERY_MODULE);
    if runs_tests {
        names.extend(Jest::GLOBALS.iter().map(|name| name.as_bytes()));
    }
    names.retain(|name| is_identifier(name));
    names.shared_sort_unstable();
    names.dedup();
    names
}

fn is_class(name: &[u8]) -> bool {
    let global = table::find_name(name).and_then(table::global);
    global.is_some_and(|global| {
        table::entry(table::canonical_id(global)).kind == BuiltinKind::Constructor
    })
}

// Every other member that the table has is `any`, as in a module that is declared without a body. What the table does not have,
// such as a name that is a type alone, is `any` by `is_declared_in_place_of_bun_types` of the compile driver.
fn write_other_members(text: &mut Vec<u8>, holder: BuiltinId, indent: &[u8], declared: &[&[u8]]) {
    let is_declared = |name: &[u8]| {
        let begins = |end: &[u8]| [b"function ", name, end].concat();
        let is_written = |piece: &&[u8]| {
            *piece == name
                || contains(piece, &begins(b"("))
                || contains(piece, &begins(b"<"))
                || contains(piece, &[b"const ", name, b":"].concat())
                || contains(piece, &[b"var ", name, b":"].concat())
        };
        declared.iter().any(is_written)
    };
    for &member in table::members(table::canonical_id(holder)) {
        let entry = table::entry(member);
        let name = table::text_of_name(entry.name);
        if table::is_symbol_name(entry.name)
            || !is_identifier(name)
            || name == b"default"
            || is_declared(name)
        {
            continue;
        }
        text.extend_from_slice(&[indent, b"export var ", name, b": any;\n"].concat());
        text.extend_from_slice(&[indent, b"export type ", name, b" = any;\n"].concat());
    }
}

fn write_module_that_narrows(text: &mut Vec<u8>, module: &ModuleThatNarrows) {
    let (specifier, namespace) = (module.specifier, module.namespace);
    let opening: [&[u8]; 7] = [
        b"declare module \"",
        specifier,
        b"\" {\n",
        module.before_namespace,
        b"  namespace ",
        namespace,
        b" {\n",
    ];
    text.extend_from_slice(&opening.concat());
    text.extend_from_slice(&module.members.concat());
    if let Some(in_table) = table::module_by_specifier(specifier) {
        let declared = [module.members, module.names_from_outside].concat();
        write_other_members(text, table::namespace_of(in_table), b"    ", &declared);
    }
    for &name in module.names_from_outside {
        text.extend_from_slice(&[&b"    export { "[..], name, b" };\n"].concat());
    }
    let closing: [&[u8]; 13] = [
        b"    export { ",
        namespace,
        b" as default };\n  }\n  export = ",
        namespace,
        b";\n}\ndeclare module \"",
        module.without_prefix,
        b"\" {\n  import ",
        namespace,
        b" = require(\"",
        specifier,
        b"\");\n  export = ",
        namespace,
        b";\n}\n",
    ];
    text.extend_from_slice(&closing.concat());
}

fn write_process_module(text: &mut Vec<u8>) {
    let [specifier, without_prefix] = PROCESS_MODULE;
    text.extend_from_slice(&[b"declare module \"", specifier, b"\" {\n"].concat());
    text.extend_from_slice(FUNCTIONS_OF_PROCESS_MODULE);
    if let Some(process) = table::find_name(PROCESS).and_then(table::global) {
        write_other_members(text, process, b"  ", &[FUNCTIONS_OF_PROCESS_MODULE]);
    }
    let closing: [&[u8]; 7] = [
        b"  export default process;\n}\ndeclare module \"",
        without_prefix,
        b"\" {\n  export * from \"",
        specifier,
        b"\";\n  export { default } from \"",
        specifier,
        b"\";\n}\n",
    ];
    text.extend_from_slice(&closing.concat());
}

// Where a library of TypeScript, a package of types or the program declares a name, that declaration counts and the one here does not: `Options::declarations_of_last_resort`.
fn write_declarations(runtime_modules: &RuntimeModules, runs_tests: bool) -> Vec<u8> {
    let mut text = Vec::new();
    for name in collect_global_names(runs_tests) {
        text.extend_from_slice(&[b"declare var ", name, b": any"].concat());
        if let Some((_, members)) = GLOBALS_THAT_NARROW.iter().find(|it| it.0 == name) {
            text.extend_from_slice(&[b" & ", *members].concat());
        }
        text.extend_from_slice(b";\n");
        if is_class(name) {
            text.extend_from_slice(&[b"type ", name, b" = any;\n"].concat());
        }
    }
    text.extend_from_slice(TYPES_WITHOUT_VALUES);
    let mut specifiers = runtime_modules.specifiers();
    if runs_tests {
        specifiers.extend(OTHER_NAMES_OF_TEST_RUNNER_MODULES.map(<[u8]>::to_vec));
    }
    specifiers.shared_sort_unstable();
    specifiers.dedup();
    specifiers.retain(|it| it.as_slice() != MODULE_WITH_DECLARATIONS);
    let narrowing = MODULES_THAT_NARROW.iter();
    let mut written_out: Vec<&[u8]> = narrowing
        .flat_map(|it| [it.specifier, it.without_prefix])
        .collect();
    written_out.extend(PROCESS_MODULE);
    specifiers.retain(|it| !written_out.contains(&it.as_slice()));
    for specifier in &specifiers {
        text.extend_from_slice(&[b"declare module \"", specifier.as_slice(), b"\";\n"].concat());
    }
    for module in &MODULES_THAT_NARROW {
        write_module_that_narrows(&mut text, module);
    }
    write_process_module(&mut text);
    text
}

#[cfg(test)]
mod tests {
    use bun_builtin_sources::Archive;

    use super::*;

    #[test]
    fn declares_globals_and_modules() {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        let text = text(&runtime_modules, false);
        let lines: [&[u8]; 9] = [
            b"declare var console: any;\n",
            b"declare var process: any & {\n",
            b"declare var Buffer: any & {\n",
            b"  isEncoding(value?: unknown, ...rest: any[]): value is any;\n};\ntype Buffer = any;\n",
            b"declare var Response: any;\ntype Response = any;\n",
            b"declare var require: any;\n",
            b"declare module \"node:events\";\n",
            b"declare module \"fs\";\n",
            b"declare module \"bun:sqlite\";\n",
        ];
        for line in lines {
            assert!(contains(text, line), "{}", bstr::BStr::new(line));
        }
        assert!(!contains(text, b"declare module \"bun\";"));
        assert!(!contains(text, b"type console"));
        for namespace in ["WebAssembly", "Temporal", "Math", "NaN"] {
            let variable = format!("declare var {namespace}: any;\n");
            assert!(contains(text, variable.as_bytes()), "{namespace}");
            let alias = format!("type {namespace} = any;");
            assert!(!contains(text, alias.as_bytes()), "{namespace}");
        }
        assert!(!contains(text, b"declare var describe"));
        assert!(!contains(text, b"declare var document"));
    }

    #[test]
    fn a_module_that_narrows_has_every_other_member_as_any() {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        let text = text(&runtime_modules, false);
        let lines: [&[u8]; 13] = [
            b"declare var process: any & {\n  abort(...rest: any[]): never;\n",
            b"declare module \"node:buffer\" {\n  namespace buffer {\n    export var Buffer: any & {\n  isBuffer(",
            b"};\n    export type Buffer = any;\n",
            b"    export var BlockList: any & {\n  isBlockList(value?: unknown, ...rest: any[]): value is any;\n};\n    export type BlockList = any;\n",
            b"    export var Socket: any;\n    export type Socket = any;\n",
            b"declare module \"node:assert\" {\n  function assert(value?: unknown, ...rest: any[]): asserts value;\n",
            b"    export var AssertionError: any;\n    export type AssertionError = any;\n",
            b"declare module \"assert\" {\n  import assert = require(\"node:assert\");\n  export = assert;\n}\n",
            b"    export var inspect: any;\n",
            b"    export { types };\n    export { util as default };\n  }\n  export = util;\n}\n",
            b"  export function exit(...rest: any[]): never;\n",
            b"  export var argv: any;\n",
            b"  export default process;\n}\n",
        ];
        for line in lines {
            assert!(contains(text, line), "{}", bstr::BStr::new(line));
        }
        for declared_twice in [
            "var ok:",
            "var exit:",
            "var isArray:",
            "var isTypedArray:",
            "var types:",
            "var strict:",
            "var default:",
            "var Buffer: any;",
            "var BlockList: any;",
        ] {
            assert!(
                !contains(text, declared_twice.as_bytes()),
                "{declared_twice}"
            );
        }
        for module in [
            "assert",
            "node:assert/strict",
            "node:process",
            "process",
            "util",
            "node:util/types",
            "buffer",
            "node:buffer",
            "net",
            "node:net",
        ] {
            let without_body = format!("declare module \"{module}\";");
            assert!(!contains(text, without_body.as_bytes()), "{module}");
        }
    }

    // The name in front of the parameters that end at `end`.
    fn name_of_function(text: &[u8], end: usize) -> &[u8] {
        let matching = |mut at: usize, open: u8, close: u8| {
            let mut depth = 0;
            loop {
                let is_arrow = text[at] == b'>' && text[at - 1] == b'=';
                depth += i32::from(text[at] == close && !is_arrow) - i32::from(text[at] == open);
                if depth == 0 {
                    return at;
                }
                at -= 1;
            }
        };
        let mut at = matching(end, b'(', b')');
        if text[at - 1] == b'>' {
            at = matching(at - 1, b'<', b'>');
        }
        at -= usize::from(text[at - 1] == b'?');
        let is_part = |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
        let name = text[..at].iter().rev().take_while(|byte| is_part(byte));
        &text[at - name.count()..at]
    }

    fn narrows(return_type: &[u8]) -> bool {
        let mut words = return_type.split(|byte| byte.is_ascii_whitespace());
        match words.next() {
            Some(b"never;" | b"asserts") => true,
            Some(_) => words.next() == Some(b"is"),
            None => false,
        }
    }

    // Where this fails, Bun's types have a new function that narrows: declare it above.
    #[test]
    fn declares_every_function_of_bun_types_that_narrows() {
        // TypeScript's library has `Error.isError`. A type error in a test file stops no test run.
        const DECLARED_ELSEWHERE_OR_FOR_TESTS: [&[u8]; 4] =
            [b"isError", b"unreachable", b"isMockFunction", b"skip"];
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        let stand_in = text(&runtime_modules, false);
        let mut found = 0;
        for file in Archive::names_that_begin_with(b"types/") {
            // A program reaches nothing of undici but through `fetch` and its kin, which are `any`.
            if !file.ends_with(b".d.ts") || file.starts_with(b"types/undici-types/") {
                continue;
            }
            let declarations = Archive::read(file).expect("the archive lists it");
            let mut line_start = 0;
            for (at, window) in declarations.windows(3).enumerate() {
                if window[0] == b'\n' {
                    line_start = at + 1;
                }
                if window != b"): " || !narrows(&declarations[at + 3..]) {
                    continue;
                }
                let line = declarations[line_start..at].trim_ascii_start();
                if line.starts_with(b"//") || line.starts_with(b"*") {
                    continue;
                }
                let name = name_of_function(&declarations, at);
                found += 1;
                let is_declared = [&b"("[..], b"<"]
                    .into_iter()
                    .any(|open| contains(stand_in, &[&b" "[..], name, open].concat()));
                assert!(
                    is_declared || DECLARED_ELSEWHERE_OR_FOR_TESTS.contains(&name),
                    "{} of {}",
                    bstr::BStr::new(name),
                    bstr::BStr::new(file)
                );
            }
        }
        assert!(found > 50, "{found}");
    }

    #[test]
    fn declares_no_name_that_typescript_knows_by_itself() {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        let text = text(&runtime_modules, false);
        for name in ["undefined", "globalThis"] {
            for line in [
                format!("declare var {name}: any;"),
                format!("type {name} = any;"),
            ] {
                assert!(!contains(text, line.as_bytes()), "{line}");
            }
        }
    }

    #[test]
    fn test_files_have_names_of_test_runner() {
        let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
        assert!(contains(
            text(&runtime_modules, true),
            b"declare var describe: any;\n"
        ));
        for name in OTHER_NAMES_OF_TEST_RUNNER_MODULES {
            let module = [b"declare module \"", name, b"\";\n"].concat();
            assert!(contains(text(&runtime_modules, true), &module));
            assert!(!contains(text(&runtime_modules, false), &module));
            assert!(contains(
                OTHER_NAMES_OF_TEST_RUNNER,
                &module[..module.len() - 2]
            ));
        }
    }
}
