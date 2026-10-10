//! A configuration file that is a program (`eslint.config.js`, `oxlint.config.ts`) is run by the
//! running executable, in a process of its own, which prints what the file exports as JSON.

use crate::paths;
use crate::run::{Environment, Fatal, Script, Source};
use bun_core::strings;
use bun_lint::options::Json;

/// What precedes the JSON. The file itself can print, too.
const MARKER: &[u8] = b"\x1e--bun-lint-configuration--\x1e";

/// What every script begins with.
pub(crate) const START: &str = include_str!("evaluate-start.js");
const DESCRIBE: &str = include_str!("evaluate-describe.js");
const STAND_INS: &str = include_str!("evaluate-stand-ins.js");

/// For `eslint.config.*` and `oxlint.config.ts`.
pub(crate) const ESLINT: Source = &[
    START,
    DESCRIBE,
    STAND_INS,
    bun_lint::js_plugin::ESLINT_PATCH,
    include_str!("evaluate-eslint.js"),
];
/// For what the configuration files of ESLint 8 name.
pub(crate) const ESLINTRC: Source = &[START, DESCRIBE, include_str!("evaluate-eslintrc.js")];
/// For the configuration files of Prettier.
pub(crate) const PRETTIER: Source = &[START, include_str!("fmt/evaluate-prettier.js")];

/// What the script `source` makes of the configuration file at `path`.
pub(crate) fn evaluate(
    environment: &Environment,
    source: Source,
    path: &[u8],
) -> Result<Json, Fatal> {
    evaluate_with(environment, source, path, b"")
}

/// The same for a script that takes an `argument`: `process.argv.at(-3)`. Empty for a script that takes none.
pub(crate) fn evaluate_with(
    environment: &Environment,
    source: Source,
    path: &[u8],
    argument: &[u8],
) -> Result<Json, Fatal> {
    let arguments = [argument, MARKER, path];
    let script = Script {
        source,
        arguments: &arguments[usize::from(argument.is_empty())..],
        // As for the tools: `process.cwd()` is where the command runs, not where the file is.
        cwd: &environment.cwd,
        stdin: b"",
    };
    run(environment, &script).map_err(|why| {
        Fatal(
            [
                b"Cannot load the configuration file ",
                path,
                b":\n",
                &why[..],
            ]
            .concat(),
        )
    })
}

/// What the script `source` makes of `input`, which it reads from standard input. `directory`: what it takes for that of the
/// file that it is about. `Err`: why it failed.
pub(crate) fn evaluate_input(
    environment: &Environment,
    source: Source,
    directory: &[u8],
    input: &[u8],
) -> Result<Json, Vec<u8>> {
    // There is no such file.
    let path = paths::join(directory, b"-");
    let script = Script {
        source,
        arguments: &[MARKER, &path],
        cwd: &environment.cwd,
        stdin: input,
    };
    run(environment, &script)
}

/// What `script` hands to `finish`. `Err`: why it failed.
fn run(environment: &Environment, script: &Script) -> Result<Json, Vec<u8>> {
    const SILENT: &[u8] = b"It could not be evaluated.";
    let printed = (environment.run_script)(script).map_err(|why| match why.trim_ascii_end() {
        // It has left without a word: `process.exit(1)`.
        b"" => SILENT.to_vec(),
        why => why.to_vec(),
    })?;
    let json = strings::last_index_of(&printed, MARKER).map(|at| &printed[at + MARKER.len()..]);
    let Some(Json::Object(entries)) = json.and_then(bun_lint::json::parse) else {
        return Err(SILENT.to_vec());
    };
    let config = entries.into_iter().find(|it| it.0 == b"config");
    Ok(config.map_or(Json::Null, |it| it.1))
}
