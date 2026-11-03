//! ESLint 8's `--rulesdir`: every `.js` file in a directory is a rule, named after the file, without a prefix. ESLint
//! puts them all in a plugin without a name (`createBaseConfigArray`, `loadRules`) and looks there before its own
//! rules.

use crate::run::{Environment, Fatal};
use crate::{evaluate, paths};
use bun_lint::linter::write_json;
use bun_lint::options::Json;

/// Returns [`LegacyOptions::rules`](bun_lint::linter::LegacyOptions::rules) for `directories`, which are as typed on
/// the command line. `evaluate-eslintrc.js` loads every file, like ESLint does, so a file that throws stops the run
/// even if the config never uses its rule.
pub(crate) fn load(environment: &Environment, directories: &[Vec<u8>]) -> Result<Json, Fatal> {
    let cwd = &environment.cwd[..];
    let absolute = |it: &Vec<u8>| Json::String(paths::resolve(cwd, &paths::from_native(it)));
    let entry = |key: &[u8], value: Json| (key.to_vec(), value);
    let argument = Json::Object(vec![
        entry(b"pluginsFrom", Json::String(cwd.to_vec())),
        // An empty config instead of a file.
        entry(b"content", Json::Object(Vec::new())),
        entry(
            b"rulesdir",
            Json::Array(directories.iter().map(absolute).collect()),
        ),
    ]);
    let mut text = Vec::new();
    write_json(&mut text, &argument);
    // This file doesn't exist. The script runs in its directory.
    let path = paths::join(cwd, b"--rulesdir");
    let printed = evaluate::evaluate_with(environment, evaluate::ESLINTRC, &path, &text)?;
    let rules = printed.get(b"rules");
    if let Some(location) = rules.and_then(|it| it.get(b"location")) {
        return Ok(location.clone());
    }
    let why = rules.and_then(|it| it.get(b"$error")?.as_str());
    let why = why.unwrap_or(b"the rules could not be loaded");
    Err(Fatal([b"--rulesdir: ", why].concat()))
}
