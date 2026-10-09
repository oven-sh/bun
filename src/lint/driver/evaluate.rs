//! A configuration file that is a program (`eslint.config.js`, `oxlint.config.ts`) is run by the
//! running executable, in a process of its own, which prints what the file exports as JSON.
//!
//! That takes half a second if the file imports `typescript-eslint`, which loads TypeScript: more
//! than it takes to lint most projects. So the result is kept, in `node_modules/.cache/bun-lint`,
//! with what it depends on: the files that the program has loaded, read or asked about, by time
//! and size, a package by its `package.json`, and the environment variables that it has read, by a
//! hash. It
//! is used again as long as none of these has changed. A program that does what cannot be checked
//! again (starts a process, lists the environment) is run every time.

use crate::run::{Environment, Fatal, Script};
use crate::{fs, paths};
use bun_core::strings;
use bun_lint::linter::write_json;
use bun_lint::options::Json;

/// What precedes the JSON. The file itself can print, too.
const MARKER: &[u8] = b"\x1e--bun-lint-configuration--\x1e";

/// For `eslint.config.*` and `oxlint.config.ts`.
pub(crate) const ESLINT: &str = concat!(
    include_str!("evaluate-track.js"),
    include_str!("evaluate-describe.js"),
    include_str!("evaluate-eslint.js")
);
/// For the configuration files of Prettier.
pub(crate) const PRETTIER: &str = concat!(
    include_str!("evaluate-track.js"),
    include_str!("fmt/evaluate-prettier.js")
);

/// FNV-1a.
pub(crate) fn hash(parts: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in parts.iter().flat_map(|part| part.iter().chain(&[0])) {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Where the result for the file at `path` is kept: with the packages that it imports. `None` if
/// there are none, and then it is quick to run.
fn cache_file(path: &[u8]) -> Option<Vec<u8>> {
    let has_packages = |directory: &&[u8]| {
        fs::kind(&paths::join(directory, b"node_modules")) == Some(fs::Kind::Directory)
    };
    let directory = paths::ancestors(paths::dirname(path)).find(has_packages)?;
    let name = format!("node_modules/.cache/bun-lint/{:016x}.json", hash(&[path]));
    Some(paths::join(directory, name.as_bytes()))
}

/// What changes when the file at `path` does.
fn stamp(path: &[u8]) -> Json {
    Json::String(fs::stamp(path).map_or_else(|| b"none".to_vec(), |it| it.0))
}

/// What changes when the environment variable called `name` does. Not its value, which can be a
/// secret.
fn variable(name: &[u8]) -> Json {
    match bun_core::getenv_z(&bun_core::ZBox::from_bytes(name)) {
        Some(value) => Json::String(format!("{:016x}", hash(&[name, value])).into_bytes()),
        None => Json::Null,
    }
}

/// What has to be the same for a result to be of any use.
fn version(environment: &Environment, source: &str) -> Json {
    let version = format!("{:016x}", hash(&[environment.version, source.as_bytes()]));
    Json::String(version.into_bytes())
}

/// The configuration in `kept`, if what it depends on is as it was.
fn still_valid(version: &Json, kept: Json) -> Option<Json> {
    if kept.get(b"version") != Some(version) {
        return None;
    }
    let is_same_file = |(path, before): &(Vec<u8>, Json)| stamp(path) == *before;
    let is_same_variable = |(name, before): &(Vec<u8>, Json)| variable(name) == *before;
    if !kept.get(b"files")?.as_object()?.iter().all(is_same_file)
        || !kept
            .get(b"environment")?
            .as_object()?
            .iter()
            .all(is_same_variable)
    {
        return None;
    }
    let Json::Object(entries) = kept else {
        return None;
    };
    entries
        .into_iter()
        .find(|it| it.0 == b"config")
        .map(|it| it.1)
}

/// What the script `source` makes of the configuration file at `path`. `keeps`: whether the result
/// of an earlier run will do, and that of this one is kept.
pub(crate) fn evaluate(
    environment: &Environment,
    source: &'static str,
    path: &[u8],
    keeps: bool,
) -> Result<Json, Fatal> {
    let cache_file = if keeps { cache_file(path) } else { None };
    let kept = cache_file
        .as_ref()
        .and_then(|file| kept_at(environment, source, file));
    match kept {
        Some(config) => Ok(config),
        None => evaluate_at(environment, source, path, cache_file),
    }
}

/// What is kept at `cache_file` of a run of `source`, if what it depends on is as it was.
pub(crate) fn kept_at(
    environment: &Environment,
    source: &'static str,
    cache_file: &[u8],
) -> Option<Json> {
    let kept = bun_lint::json::parse(&fs::read(cache_file).ok()?)?;
    still_valid(&version(environment, source), kept)
}

/// Runs `source`, whatever is kept. `cache_file`: where the result is kept, if it is.
pub(crate) fn evaluate_at(
    environment: &Environment,
    source: &'static str,
    path: &[u8],
    cache_file: Option<Vec<u8>>,
) -> Result<Json, Fatal> {
    let version = version(environment, source);
    let script = Script {
        source,
        arguments: &[MARKER, path],
        cwd: paths::dirname(path),
    };
    let fail = |why: &[u8]| {
        Fatal(
            [
                b"Cannot load the configuration file ",
                path,
                b":\n",
                why.trim_ascii_end(),
            ]
            .concat(),
        )
    };
    let printed = (environment.run_script)(&script).map_err(|error| fail(&error))?;
    let json = strings::last_index_of(&printed, MARKER).map(|at| &printed[at + MARKER.len()..]);
    let Some(Json::Object(mut entries)) = json.and_then(bun_lint::json::parse) else {
        return Err(fail(b"It could not be evaluated."));
    };
    let mut take = |key: &[u8]| {
        let at = entries.iter().position(|it| it.0 == key)?;
        Some(entries.swap_remove(at).1)
    };
    let config = take(b"config").unwrap_or(Json::Null);
    if let Some(cache_file) = cache_file
        && take(b"uncacheable") == Some(Json::Bool(false))
        && let (Some(Json::Array(files)), Some(Json::Array(names))) =
            (take(b"files"), take(b"environment"))
    {
        // Some file systems tell the time in seconds: what has just been written can be written
        // again without a trace.
        let now = bun_core::time::timestamp();
        if files
            .iter()
            .filter_map(Json::as_str)
            .any(|file| fs::stamp(file).is_some_and(|it| it.1 + 2 > now))
        {
            return Ok(config);
        }
        let files = files
            .iter()
            .filter_map(Json::as_str)
            .map(|file| (file.to_vec(), stamp(file)));
        let environment = names
            .iter()
            .filter_map(Json::as_str)
            .map(|name| (name.to_vec(), variable(name)));
        let kept = Json::Object(vec![
            (b"version".to_vec(), version),
            (b"files".to_vec(), Json::Object(files.collect())),
            (b"environment".to_vec(), Json::Object(environment.collect())),
            (b"config".to_vec(), config.clone()),
        ]);
        let mut text = Vec::new();
        write_json(&mut text, &kept);
        // Nothing depends on it.
        let _ = fs::write_new_atomically(&cache_file, &text);
    }
    Ok(config)
}
