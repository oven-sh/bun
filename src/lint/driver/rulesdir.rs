//! `--rulesdir` of ESLint 8: every `.js` file of a directory is a rule, which is called as the file, without a prefix. ESLint
//! makes a plugin without a name of them all (`createBaseConfigArray`, `loadRules`), and looks there before it looks among its
//! own rules.

use crate::run::{Environment, Fatal};
use crate::{evaluate, paths};
use bun_lint::linter::write_json;
use bun_lint::options::Json;

/// [`LegacyOptions::rules`](bun_lint::linter::LegacyOptions::rules) for `directories`, which are as the command line has them.
/// `evaluate-eslintrc.js` loads every file, as ESLint does: one that throws stops the run, whatever the configuration says about
/// its rule. `keeps`: [`evaluate::evaluate`].
pub(crate) fn load(
    environment: &Environment,
    directories: &[Vec<u8>],
    keeps: bool,
) -> Result<Json, Fatal> {
    let cwd = &environment.cwd[..];
    let absolute = |it: &Vec<u8>| Json::String(paths::resolve(cwd, &paths::from_native(it)));
    let entry = |key: &[u8], value: Json| (key.to_vec(), value);
    let argument = Json::Object(vec![
        entry(b"pluginsFrom", Json::String(cwd.to_vec())),
        // In place of a file: it names nothing.
        entry(b"content", Json::Object(Vec::new())),
        entry(
            b"rulesdir",
            Json::Array(directories.iter().map(absolute).collect()),
        ),
    ]);
    let mut text = Vec::new();
    write_json(&mut text, &argument);
    // There is no such file. The script runs in its directory, and the result is kept under its name.
    let path = paths::join(cwd, b"--rulesdir");
    let printed = evaluate::evaluate_with(environment, evaluate::ESLINTRC, &path, &text, keeps)?;
    let rules = printed.get(b"rules");
    if let Some(location) = rules.and_then(|it| it.get(b"location")) {
        return Ok(location.clone());
    }
    let why = rules.and_then(|it| it.get(b"$error")?.as_str());
    let why = why.unwrap_or(b"The rules were not loaded.");
    Err(Fatal([b"--rulesdir: ", why].concat()))
}
