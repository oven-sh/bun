//! Finds and reads the configuration files of ESLint 8: `.eslintrc.*`, `eslintConfig` in a `package.json`, `.eslintignore`.
//! `CascadingConfigArrayFactory` and `loadConfigFile` of `@eslint/eslintrc`.

use crate::run::Fatal;
use crate::{fs, paths};
use bun_core::strings;
use bun_lint::json::{self, Notation};
use bun_lint::linter::{LegacyFile, LegacyKind};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;

/// By priority: of several in a directory the first counts.
pub(crate) const NAMES: [&[u8]; 7] = [
    b".eslintrc.js",
    b".eslintrc.cjs",
    b".eslintrc.yaml",
    b".eslintrc.yml",
    b".eslintrc.json",
    b".eslintrc",
    b"package.json",
];

/// `ESLINT_USE_FLAT_CONFIG`: `Some(false)` is for these files alone, `Some(true)` for none of them.
pub(crate) fn uses_flat_config() -> Option<bool> {
    match bun_core::getenv_z(&bun_core::ZBox::from_bytes(b"ESLINT_USE_FLAT_CONFIG"))? {
        b"true" => Some(true),
        b"false" => Some(false),
        _ => None,
    }
}

fn cannot_read(path: &[u8], why: &[u8]) -> Vec<u8> {
    [b"Cannot read config file: ", path, b"\nError: ", why].concat()
}

fn is_program(path: &[u8]) -> bool {
    path.ends_with(b".js") || path.ends_with(b".cjs")
}

/// `loadConfigFile`: what the file at `path` says. `None`: a `package.json` without `eslintConfig`.
fn read(path: &[u8]) -> Result<Option<Json>, Vec<u8>> {
    let name = paths::basename(path);
    if is_program(name) {
        return Err(cannot_read(
            path,
            b"A configuration of ESLint 8 that is a program is not supported yet.",
        ));
    }
    let text = fs::read(path).map_err(|error| cannot_read(path, &fs::describe(&error)))?;
    let json = || json::parse(&text).ok_or_else(|| cannot_read(path, b"It is not valid JSON."));
    // `yaml.load(text) || {}`
    let yaml = || match json::parse_as(Notation::Yaml, &text) {
        Ok(Json::Null) => Ok(Json::Object(Vec::new())),
        Ok(value) => Ok(value),
        Err(why) => Err(cannot_read(path, &why)),
    };
    if name == b"package.json" {
        return Ok(json()?.get(b"eslintConfig").cloned());
    }
    Ok(Some(if name.ends_with(b".json") {
        json()?
    } else if name.ends_with(b".yaml") || name.ends_with(b".yml") {
        yaml()?
    } else {
        // YAML, which JSON is a part of, with the comments of JavaScript.
        match json::parse(&text) {
            Some(value) => value,
            None => yaml()?,
        }
    }))
}

/// Whether the file at `path`, which `--config` names, is one of ESLint 8, as far as that can be told without running it.
pub(crate) fn is_one(path: &[u8]) -> bool {
    let name = paths::basename(path);
    if name.starts_with(b".eslintrc") || name.ends_with(b".yaml") || name.ends_with(b".yml") {
        return true;
    }
    if !name.ends_with(b".json") {
        return false;
    }
    let Some(json) = fs::read(path).ok().and_then(|it| json::parse(&it)) else {
        return false;
    };
    // What an `.oxlintrc.json` does not have.
    let only_here: [&[u8]; 7] = [
        b"root",
        b"parser",
        b"parserOptions",
        b"noInlineConfig",
        b"reportUnusedDisableDirectives",
        b"processor",
        b"ecmaFeatures",
    ];
    let names_preset = |it: &Json| {
        (it.as_str()).is_some_and(|it| it.starts_with(b"eslint:") || it.starts_with(b"plugin:"))
    };
    only_here.iter().any(|key| json.get(key).is_some())
        || match json.get(b"extends") {
            Some(Json::Array(all)) => all.iter().any(names_preset),
            Some(one) => names_preset(one),
            None => false,
        }
}

/// What a message calls the file at `path`.
fn name_of(path: &[u8], cwd: &[u8]) -> Vec<u8> {
    paths::relative(cwd, path)
}

/// The file at `path`, which `--config` names: its patterns are relative to the working directory.
pub(crate) fn named(path: &[u8], cwd: &[u8]) -> Result<LegacyFile, Fatal> {
    let json = read(path).map_err(Fatal)?;
    Ok(LegacyFile {
        path: path.to_vec(),
        name: b"--config".to_vec(),
        base_path: cwd.to_vec(),
        json: json.unwrap_or_else(|| Json::Object(Vec::new())),
    })
}

/// `loadInDirectory`. `names`: those of [`NAMES`] that `directory` has.
fn in_directory<'n>(
    directory: &[u8],
    names: impl Iterator<Item = &'n [u8]>,
    cwd: &[u8],
) -> Result<Option<LegacyFile>, Fatal> {
    for name in names {
        let path = paths::join(directory, name);
        if let Some(json) = read(&path).map_err(Fatal)? {
            return Ok(Some(LegacyFile {
                name: name_of(&path, cwd),
                path,
                base_path: directory.to_vec(),
                json,
            }));
        }
    }
    Ok(None)
}

/// Whether `directory` has a configuration file of ESLint 8.
pub(crate) fn has_one(directory: &[u8]) -> bool {
    let is_there = |name: &&[u8]| fs::is_file(&paths::join(directory, name));
    NAMES.iter().any(|name| match *name {
        b"package.json" => {
            is_there(name) && matches!(read(&paths::join(directory, name)), Ok(Some(_)) | Err(_))
        }
        _ => is_there(name),
    })
}

/// `_loadConfigInAncestors`: the files that count for what is in `directory`, the outermost first.
pub(crate) fn cascade(directory: &[u8], cwd: &[u8]) -> Result<Vec<LegacyFile>, Fatal> {
    let mut files = Vec::new();
    for ancestor in paths::ancestors(directory) {
        let names = NAMES.iter().copied();
        let names = names.filter(|name| fs::is_file(&paths::join(ancestor, name)));
        if let Some(file) = in_directory(ancestor, names, cwd)? {
            let is_root = file.json.get(b"root").and_then(Json::as_bool) == Some(true);
            files.push(file);
            if is_root {
                break;
            }
        }
    }
    files.reverse();
    Ok(files)
}

fn patterns(name: &[u8], path: &[u8], cwd: &[u8], patterns: Vec<Json>) -> LegacyFile {
    LegacyFile {
        path: path.to_vec(),
        name: name.to_vec(),
        base_path: cwd.to_vec(),
        json: Json::Object(vec![(b"ignorePatterns".to_vec(), Json::Array(patterns))]),
    }
}

/// `loadESLintIgnore(path)`, or `loadDefaultESLintIgnore()`: `.eslintignore` in the working directory, or else `eslintIgnore` in
/// its `package.json`.
pub(crate) fn ignore_file(path: Option<&[u8]>, cwd: &[u8]) -> Result<Option<LegacyFile>, Fatal> {
    let default = paths::join(cwd, b".eslintignore");
    let file = match path {
        Some(path) => path,
        None if fs::is_file(&default) => &default,
        None => {
            let package = paths::join(cwd, b"package.json");
            let Some(json) = fs::read(&package).ok().and_then(|it| json::parse(&it)) else {
                return Ok(None);
            };
            return match json.get(b"eslintIgnore") {
                None => Ok(None),
                Some(Json::Array(all)) => Ok(Some(patterns(
                    b"eslintIgnore in package.json",
                    &package,
                    cwd,
                    all.clone(),
                ))),
                Some(_) => Err(Fatal(
                    b"Package.json eslintIgnore property requires an array of paths".to_vec(),
                )),
            };
        }
    };
    let text = fs::read(file).map_err(|error| {
        Fatal(
            [
                b"Cannot read .eslintignore file: ",
                file,
                b"\nError: ",
                &fs::describe(&error),
            ]
            .concat(),
        )
    })?;
    let text = strings::without_utf8_bom(&text);
    let lines = strings::split(text, b"\n").map(|line| line.strip_suffix(b"\r").unwrap_or(line));
    let lines = lines.filter(|line| !line.trim_ascii().is_empty() && !line.starts_with(b"#"));
    let lines = lines.map(|line| Json::String(line.to_vec()));
    Ok(Some(patterns(b".eslintignore", file, cwd, lines.collect())))
}

/// The directory of the package `name`, as a module in `directory` finds it.
fn find_package(directory: &[u8], name: &[u8]) -> Option<Vec<u8>> {
    paths::ancestors(directory)
        .map(|it| paths::join(&paths::join(it, b"node_modules"), name))
        .find(|it| fs::kind(it) == Some(fs::Kind::Directory))
}

fn answer(entries: Vec<(&[u8], Json)>) -> Json {
    let entries = entries.into_iter();
    Json::Object(entries.map(|(key, value)| (key.to_vec(), value)).collect())
}

/// [`bun_lint::linter::LoadLegacy`]. `short`: the name of a plugin as the rules have it. `plugins_from`: where plugins are looked
/// for, which is not where the file is that names them.
pub(crate) fn load(
    kind: LegacyKind,
    request: &[u8],
    short: &[u8],
    from: &[u8],
    plugins_from: &[u8],
) -> Result<Json, Vec<u8>> {
    let directory = match kind {
        LegacyKind::Plugin => plugins_from,
        _ => paths::dirname(from),
    };
    match kind {
        LegacyKind::Config if request.starts_with(b".") || paths::is_absolute(request) => {
            let exact = paths::resolve(directory, request);
            let candidates = [&b""[..], b".js", b".json", b"/index.js", b"/index.json"];
            let mut candidates = candidates.iter().map(|it| [&exact[..], it].concat());
            let Some(file) = candidates.find(|it| fs::is_file(it)) else {
                return Err([b"Failed to load config \"", request, b"\" to extend from."].concat());
            };
            let config = read(&file)?.unwrap_or_else(|| Json::Object(Vec::new()));
            Ok(answer(vec![
                (b"path", Json::String(file)),
                (b"config", config),
            ]))
        }
        LegacyKind::Config => Err(match find_package(directory, request) {
            Some(_) => [
                b"It extends \"",
                request,
                b"\". A configuration that is a package is not supported yet.",
            ]
            .concat(),
            None => [
                b"ESLint couldn't find the config \"",
                request,
                b"\" to extend from. Please check that the name of the config is correct.",
            ]
            .concat(),
        }),
        LegacyKind::Plugin if Plugin::of_prefix(short).is_some() => {
            Ok(answer(vec![(b"name", Json::String(request.to_vec()))]))
        }
        LegacyKind::Plugin => Err(match find_package(directory, request) {
            Some(_) => [
                b"It uses the plugin \"",
                request,
                b"\". In a configuration of ESLint 8 a plugin that is not built in is not supported yet.",
            ]
            .concat(),
            None => [b"ESLint couldn't find the plugin \"", request, b"\"."].concat(),
        }),
        LegacyKind::Parser => {
            let is_known = matches!(
                request,
                b"espree" | b"@typescript-eslint/parser" | b"@babel/eslint-parser" | b"babel-eslint"
            );
            let is_file = (request.starts_with(b".") || paths::is_absolute(request))
                && fs::is_file(&paths::resolve(directory, request));
            if !is_known && !is_file && find_package(directory, request).is_none() {
                return Err([
                    b"Failed to load parser '",
                    request,
                    b"': Cannot find module '",
                    request,
                    b"'",
                ]
                .concat());
            }
            Ok(answer(vec![(b"name", Json::String(request.to_vec()))]))
        }
    }
}
