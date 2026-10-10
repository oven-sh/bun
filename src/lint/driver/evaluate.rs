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
        cwd: paths::dirname(path),
    };
    let fail = |why: &[u8]| {
        // It has left without a word: `process.exit(1)`.
        let why: &[u8] = match why.trim_ascii_end() {
            b"" => b"It could not be evaluated.",
            why => why,
        };
        Fatal([b"Cannot load the configuration file ", path, b":\n", why].concat())
    };
    let printed = (environment.run_script)(&script).map_err(|error| fail(&error))?;
    let json = strings::last_index_of(&printed, MARKER).map(|at| &printed[at + MARKER.len()..]);
    let Some(Json::Object(entries)) = json.and_then(bun_lint::json::parse) else {
        return Err(fail(b"It could not be evaluated."));
    };
    let config = entries.into_iter().find(|it| it.0 == b"config");
    Ok(config.map_or(Json::Null, |it| it.1))
}
