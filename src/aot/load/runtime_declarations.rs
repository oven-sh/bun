//! What stands in for `@types/bun` where it is not installed: every global and every module that the run time provides, of type `any`.

use std::sync::OnceLock;

use bun_sema::util::SharedSort;

use crate::builtins::table::BuiltinKind;
use crate::builtins::{BuiltinName, table};
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

pub(crate) const NAMES_OF_EVERY_TEST_FILE: [&[u8]; 14] = [
    b"test",
    b"it",
    b"describe",
    b"expect",
    b"expectTypeOf",
    b"beforeAll",
    b"beforeEach",
    b"afterEach",
    b"afterAll",
    b"jest",
    b"vi",
    b"xit",
    b"xtest",
    b"xdescribe",
];

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

pub(crate) fn text(runtime_modules: &RuntimeModules, runs_tests: bool) -> &'static [u8] {
    static FOR_PROGRAMS: OnceLock<Vec<u8>> = OnceLock::new();
    static FOR_TESTS: OnceLock<Vec<u8>> = OnceLock::new();
    let text = match runs_tests {
        true => &FOR_TESTS,
        false => &FOR_PROGRAMS,
    };
    text.get_or_init(|| write_declarations(runtime_modules, runs_tests))
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
        names.extend(NAMES_OF_EVERY_TEST_FILE);
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

// Where a library of TypeScript, a package of types or the program declares a name, that declaration counts and the one here does not: `Options::declarations_of_last_resort`.
fn write_declarations(runtime_modules: &RuntimeModules, runs_tests: bool) -> Vec<u8> {
    let mut text = Vec::new();
    for name in collect_global_names(runs_tests) {
        text.extend_from_slice(&[b"declare var ", name, b": any;\n"].concat());
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
    for specifier in specifiers
        .iter()
        .filter(|it| it.as_slice() != MODULE_WITH_DECLARATIONS)
    {
        text.extend_from_slice(&[b"declare module \"", specifier.as_slice(), b"\";\n"].concat());
    }
    text
}
