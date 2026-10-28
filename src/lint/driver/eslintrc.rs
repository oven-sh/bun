//! Finds and reads ESLint 8's configuration files: `.eslintrc.*`, `eslintConfig` in a `package.json`, `.eslintignore`.
//! It's `CascadingConfigArrayFactory` and `loadConfigFile` from `@eslint/eslintrc`.

use crate::run::{Environment, Fatal};
use crate::{evaluate, fs, paths};
use bun_core::strings;
use bun_lint::json::{self, Notation};
use bun_lint::linter::{LegacyFailure, LegacyFile, LegacyKind, json_parse, write_json};
use bun_lint::options::Json;

/// In priority order. If a directory has several, the first one wins.
pub(crate) const NAMES: [&[u8]; 7] = [
    b".eslintrc.js",
    b".eslintrc.cjs",
    b".eslintrc.yaml",
    b".eslintrc.yml",
    b".eslintrc.json",
    b".eslintrc",
    b"package.json",
];

/// `ESLINT_USE_FLAT_CONFIG`: `Some(false)` means only these files are read, `Some(true)` means none of them are.
pub(crate) fn uses_flat_config() -> Option<bool> {
    match bun_core::getenv_z(&bun_core::ZBox::from_bytes(b"ESLINT_USE_FLAT_CONFIG"))? {
        b"true" => Some(true),
        b"false" => Some(false),
        _ => None,
    }
}

fn cannot_read(path: &[u8], why: &[u8]) -> Vec<u8> {
    let text = [b"Cannot read config file: ", path, b"\nError: ", why].concat();
    match path.ends_with(b".json") {
        // `failed-to-read-json`
        true => [b"Failed to read JSON file at ", path, b":\n\n", &text].concat(),
        false => text,
    }
}

/// The error `loadPackageJSONConfigFile` throws for the `package.json` at `path`, which has no `eslintConfig`.
fn lacks_field(path: &[u8]) -> Vec<u8> {
    let why: &[u8] = b"\nError: package.json file doesn't have 'eslintConfig' field.";
    [b"Cannot read config file: ", path, why].concat()
}

/// A failure for something that exists but can't be used.
fn failed(message: Vec<u8>) -> LegacyFailure {
    LegacyFailure {
        message,
        is_missing: false,
    }
}

fn is_program(path: &[u8]) -> bool {
    path.ends_with(b".js") || path.ends_with(b".cjs")
}

fn answer(entries: Vec<(&[u8], Json)>) -> Json {
    let entries = entries.into_iter();
    Json::Object(entries.map(|(key, value)| (key.to_vec(), value)).collect())
}

/// Loads the things that take running JavaScript: config files that are programs, and packages. `evaluate-eslintrc.js`
/// does the loading, for a file and everything it refers to.
pub(crate) struct Modules<'m> {
    pub(crate) environment: &'m Environment<'m>,
    pub(crate) registry: &'m bun_lint::linter::Registry,
    /// `--resolve-plugins-relative-to`, absolute.
    pub(crate) plugins_from: Option<Vec<u8>>,
    /// The command line's config, which is treated as a file that can't be read from disk: its placeholder path and its
    /// content.
    pub(crate) command_line: (Vec<u8>, Json),
    /// The script's output, keyed by the file it was run for.
    pub(crate) printed: Vec<(Vec<u8>, Json)>,
    /// `--config` can point to a named pipe.
    pub(crate) pipes: &'m fs::NamedPipes,
}

impl Modules<'_> {
    /// `pluginBasePath`: the directory to resolve plugins from, for the plugins listed by `entry`, a file in the
    /// cascade, and by the configs it extends. It isn't the directory of the file that lists them.
    fn plugins_from<'p>(&'p self, entry: &'p [u8]) -> &'p [u8] {
        let given = self.plugins_from.as_deref();
        given.unwrap_or_else(|| paths::dirname(entry))
    }

    /// The value at the nested path `keys` in the output of the run for the file at `path`.
    fn printed_at(&self, path: &[u8], keys: &[&[u8]]) -> Option<&Json> {
        let printed = &self.printed.iter().find(|it| it.0 == path)?.1;
        keys.iter().try_fold(printed, |json, key| json.get(key))
    }

    /// Runs the script for the file at `path`, which is `entry` or a config it extends.
    fn run(&mut self, path: &[u8], entry: &[u8]) -> Result<(), Vec<u8>> {
        let plugins_from = Json::String(self.plugins_from(entry).to_vec());
        let mut argument = vec![
            (&b"pluginsFrom"[..], plugins_from),
            (b"cwd", Json::String(self.environment.cwd.clone())),
        ];
        if self.command_line.0 == path {
            argument.push((b"content", self.command_line.1.clone()));
        }
        if !self.registry.replaces_plugin(b"@typescript-eslint") {
            argument.push((b"loadsTypescriptEslint", Json::Bool(true)));
        }
        let mut text = Vec::new();
        write_json(&mut text, &answer(argument));
        let printed = evaluate::evaluate_with(self.environment, evaluate::ESLINTRC, path, &text);
        let printed = printed.map_err(|Fatal(why)| why)?;
        self.printed.push((path.to_vec(), printed));
        Ok(())
    }

    /// The value the script prints at `keys`. A single run for `entry`, a file in the cascade, covers everything it
    /// refers to, including the plugin configs it extends, so another file's run can't be reused. `from` is the file
    /// that refers to the thing being looked up. The script may know it under a different path than this program does,
    /// because of a symlink.
    fn find(&mut self, keys: &[&[u8]], from: &[u8], entry: &[u8]) -> Result<Option<Json>, Vec<u8>> {
        for path in [entry, from] {
            if !self.printed.iter().any(|it| it.0 == path) {
                self.run(path, entry)?;
            }
            if let Some(found) = self.printed_at(path, keys) {
                return Ok(Some(found.clone()));
            }
        }
        Ok(None)
    }

    /// The value the script loaded for `keys`, or the failure it reported.
    fn loaded(
        &mut self,
        keys: [&[u8]; 3],
        from: &[u8],
        entry: &[u8],
    ) -> Result<Json, LegacyFailure> {
        match self.find(&keys, from, entry) {
            Ok(Some(found)) => match error_of(&found) {
                Some(why) => Err(LegacyFailure {
                    message: why.to_vec(),
                    is_missing: found.get(b"$missing").is_some(),
                }),
                None => Ok(found),
            },
            Ok(None) => Err(failed(NOT_LOADED.to_vec())),
            Err(why) => Err(failed(why)),
        }
    }
}

/// The `$error` field in the script's output.
fn error_of(found: &Json) -> Option<&[u8]> {
    found.get(b"$error").and_then(Json::as_str)
}

/// Used when the script's output has nothing for the requested item.
const NOT_LOADED: &[u8] = b"The file could not be loaded.";

/// `loadConfigFile`: the config in the file at `path`. `None` for a `package.json` without `eslintConfig`, or a program
/// that exports nothing.
fn read(path: &[u8], modules: &mut Modules) -> Result<Option<Json>, Vec<u8>> {
    let name = paths::basename(path);
    if is_program(name) {
        return match modules.find(&[b"files", path], path, path)? {
            Some(Json::Null) => Ok(None),
            Some(found) => match error_of(&found) {
                // It's already the complete message.
                Some(why) => Err(why.to_vec()),
                None => Ok(Some(found)),
            },
            None => Err(cannot_read(path, NOT_LOADED)),
        };
    }
    let text = modules.pipes.read(path);
    let text = text.map_err(|error| cannot_read(path, &fs::describe(&error)))?;
    let json = || json::parse(&text).ok_or_else(|| cannot_read(path, b"Invalid JSON."));
    // js-yaml throws.
    let repeated = || crate::fmt::duplicated_mapping_key(&text).map(|why| cannot_read(path, &why));
    // `yaml.load(text) || {}`
    let yaml = || match json::parse_as(Notation::Yaml, &text) {
        _ if let Some(why) = repeated() => Err(why),
        Ok(Json::Null) => Ok(Json::Object(Vec::new())),
        Ok(value) => Ok(value),
        Err(why) => Err(cannot_read(path, &why)),
    };
    if name == b"package.json" {
        let has_no_config = |it: Json| it.get(b"eslintConfig").is_none();
        return match json::parse(&text) {
            Some(package) => Ok(package.get(b"eslintConfig").cloned()),
            // It's nested deeper than a config can be, which only matters if there is a config in it.
            None if json_parse(&text).is_ok_and(has_no_config) => Ok(None),
            None => Err(cannot_read(path, b"Invalid JSON.")),
        };
    }
    Ok(Some(if name.ends_with(b".json") {
        json()?
    } else if name.ends_with(b".yaml") || name.ends_with(b".yml") {
        yaml()?
    } else {
        // YAML, which is a superset of JSON, plus JavaScript comments.
        match json::parse(&text) {
            Some(_) if let Some(why) = repeated() => return Err(why),
            Some(value) => value,
            None => yaml()?,
        }
    }))
}

/// True if the file at `path`, passed with `--config`, is an ESLint 8 config, as far as can be told without running it.
pub(crate) fn is_eslintrc_file(path: &[u8], pipes: &fs::NamedPipes) -> bool {
    let name = paths::basename(path);
    if name.starts_with(b".eslintrc") || name.ends_with(b".yaml") || name.ends_with(b".yml") {
        return true;
    }
    if !name.ends_with(b".json") {
        return false;
    }
    let Some(json) = pipes.read(path).ok().and_then(|it| json::parse(&it)) else {
        return false;
    };
    // Keys that an `.oxlintrc.json` doesn't have.
    let eslintrc_only_keys: [&[u8]; 7] = [
        b"root",
        b"parser",
        b"parserOptions",
        b"noInlineConfig",
        b"reportUnusedDisableDirectives",
        b"processor",
        b"ecmaFeatures",
    ];
    let is_preset = |it: &Json| {
        (it.as_str()).is_some_and(|it| it.starts_with(b"eslint:") || it.starts_with(b"plugin:"))
    };
    eslintrc_only_keys.iter().any(|key| json.get(key).is_some())
        || match json.get(b"extends") {
            Some(Json::Array(all)) => all.iter().any(is_preset),
            Some(one) => is_preset(one),
            None => false,
        }
}

/// The name messages use for the file at `path`.
fn name_of(path: &[u8], cwd: &[u8]) -> Vec<u8> {
    paths::relative(cwd, path)
}

/// Loads the file at `path`, passed with `--config`. Its patterns are relative to `base_path`.
pub(crate) fn named(
    path: &[u8],
    base_path: &[u8],
    modules: &mut Modules,
) -> Result<LegacyFile, Fatal> {
    let json = match read(path, modules).map_err(Fatal)? {
        Some(json) => json,
        None if paths::basename(path) == b"package.json" => {
            return Err(Fatal(lacks_field(path)));
        }
        None => Json::Object(Vec::new()),
    };
    Ok(LegacyFile {
        path: path.to_vec(),
        name: b"--config".to_vec(),
        base_path: base_path.to_vec(),
        json,
    })
}

/// `loadInDirectory`
fn in_directory(
    directory: &[u8],
    cwd: &[u8],
    modules: &mut Modules,
) -> Result<Option<LegacyFile>, Fatal> {
    for name in NAMES {
        let path = paths::join(directory, name);
        if fs::is_file(&path)
            && let Some(json) = read(&path, modules).map_err(Fatal)?
        {
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

/// True if `directory` has an ESLint 8 configuration file.
pub(crate) fn has_eslintrc_file(directory: &[u8]) -> bool {
    let file_exists = |name: &&[u8]| fs::is_file(&paths::join(directory, name));
    NAMES.iter().any(|name| match *name {
        // One that can't be parsed counts as a config. The error is reported when it's loaded.
        b"package.json" => {
            file_exists(name)
                && fs::read(&paths::join(directory, name)).is_ok_and(|it| {
                    json::parse(&it).is_none_or(|it| it.get(b"eslintConfig").is_some())
                })
        }
        _ => file_exists(name),
    })
}

/// `os.homedir()`
fn home() -> Option<Vec<u8>> {
    let home = paths::from_native(bun_core::env_var::HOME::get().filter(|it| !it.is_empty())?);
    // `resolve` takes the style of its base: `C:/Users/a` below `/` would be `/C:/Users/a`.
    Some(match paths::Style::of(&home) {
        paths::Style::Windows => paths::resolve(&home, b""),
        paths::Style::Posix => paths::resolve(b"/", &home),
    })
}

/// `loadInDirectory(os.homedir(), { name: "PersonalConfig" })`
pub(crate) fn personal(cwd: &[u8], modules: &mut Modules) -> Result<Option<LegacyFile>, Fatal> {
    let Some(home) = home() else {
        return Ok(None);
    };
    let file = in_directory(&home, cwd, modules)?;
    Ok(file.map(|it| LegacyFile {
        name: b"PersonalConfig".to_vec(),
        ..it
    }))
}

/// `_loadConfigInAncestors`: the files that apply to `directory`, outermost first.
pub(crate) fn cascade(
    directory: &[u8],
    cwd: &[u8],
    modules: &mut Modules,
) -> Result<Vec<LegacyFile>, Fatal> {
    let (mut files, home) = (Vec::new(), home());
    for ancestor in paths::ancestors(directory) {
        // ESLint stops at the home directory, unless it's running there.
        if home.as_deref() == Some(ancestor) && cwd != ancestor {
            break;
        }
        if let Some(file) = in_directory(ancestor, cwd, modules)? {
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

/// `loadESLintIgnore(path)`, or `loadDefaultESLintIgnore()`: `.eslintignore` in the working directory, or else
/// `eslintIgnore` in its `package.json`.
pub(crate) fn ignore_file(
    path: Option<&[u8]>,
    cwd: &[u8],
    pipes: &fs::NamedPipes,
) -> Result<Option<LegacyFile>, Fatal> {
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
    let text = pipes.read(file).map_err(|error| {
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

/// The answer for something that's built in and doesn't need loading.
fn built_in(request: &[u8]) -> Json {
    answer(vec![(b"name", Json::String(request.to_vec()))])
}

/// [`bun_lint::linter::LoadLegacy`]. `short` is the plugin's name as used in rule ids.
pub(crate) fn load(
    kind: LegacyKind,
    request: &[u8],
    short: &[u8],
    from: &[u8],
    entry: &[u8],
    modules: &mut Modules,
) -> Result<Json, LegacyFailure> {
    match kind {
        LegacyKind::Config => {
            let is_path = request.starts_with(b".") || paths::is_absolute(request);
            let file = paths::resolve(paths::dirname(from), request);
            // It can be read without running JavaScript.
            if is_path && fs::is_file(&file) && !is_program(&file) {
                let Some(config) = read(&file, modules).map_err(failed)? else {
                    return Err(failed(lacks_field(&file)));
                };
                return Ok(answer(vec![
                    (b"path", Json::String(file)),
                    (b"config", config),
                ]));
            }
            modules.loaded([b"configs", from, request], from, entry)
        }
        LegacyKind::Plugin => {
            let directory = modules.plugins_from(entry).to_vec();
            let is_built_in = matches!(
                short,
                b"@typescript-eslint" | b"react-hooks" | b"import" | b"n"
            ) && modules.registry.replaces_plugin(short);
            match modules.loaded([b"plugins", &directory, request], from, entry) {
                // An installed package takes precedence over the built-in implementation, because it also has configs.
                Err(failure) if failure.is_missing && is_built_in => Ok(built_in(request)),
                loaded => loaded,
            }
        }
        LegacyKind::Parser => {
            // `evaluate-eslintrc.js` has the same list.
            if matches!(
                request,
                b"espree"
                    | b"@typescript-eslint/parser"
                    | b"@babel/eslint-parser"
                    | b"babel-eslint"
            ) {
                return Ok(built_in(request));
            }
            modules.loaded([b"parsers", from, request], from, entry)
        }
    }
}
