//! Finds and reads the configuration of the formatter: Prettier's `resolveConfig`.
//!
//! The configuration of a file is in the first directory, from that of the file upwards, that has
//! a file of one of [`NAMES`]. `.editorconfig` files count besides, and less.
//!
//! Where the working directory has a configuration file of oxfmt, things are as in oxfmt
//! ([`Flavor::Oxfmt`]): which files are configuration files, how patterns are read, which
//! `.editorconfig` counts, and which files are ignored (`files.rs`).

use super::cli::{Options, Precedence};
use super::editorconfig;
use crate::gitignore::{self, Chain};
use crate::run::{Environment, Fatal};
use crate::{evaluate, fs, paths};
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::sort_imports::{Settings as SortSettings, SortImports};
use bun_lint::linter::{Glob, write_json};
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::sync::Arc;

/// The names of configuration files, by priority: oxfmt's, then Prettier's `CONFIG_FILES`.
const NAMES: [&[u8]; 24] = [
    b".oxfmtrc.json",
    b".oxfmtrc.jsonc",
    b"oxfmt.config.ts",
    b"oxfmt.config.mts",
    b"package.json",
    b"package.yaml",
    b".prettierrc",
    b".prettierrc.json",
    b".prettierrc.yml",
    b".prettierrc.yaml",
    b".prettierrc.json5",
    b".prettierrc.js",
    b"prettier.config.js",
    b".prettierrc.ts",
    b"prettier.config.ts",
    b".prettierrc.mjs",
    b"prettier.config.mjs",
    b".prettierrc.mts",
    b"prettier.config.mts",
    b".prettierrc.cjs",
    b"prettier.config.cjs",
    b".prettierrc.cts",
    b"prettier.config.cts",
    b".prettierrc.toml",
];

/// How many of [`NAMES`] are oxfmt's.
const NAMES_OF_OXFMT: usize = 4;

/// Whose command line this one behaves like.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Flavor {
    Prettier,
    Oxfmt,
}

/// The options that the formatter has.
const OPTIONS: [&[u8]; 25] = [
    b"cursorOffset",
    b"parser",
    b"jsxBracketSameLine",
    b"rangeStart",
    b"rangeEnd",
    b"insertPragma",
    b"requirePragma",
    b"checkIgnorePragma",
    b"printWidth",
    b"tabWidth",
    b"useTabs",
    b"endOfLine",
    b"semi",
    b"singleQuote",
    b"jsxSingleQuote",
    b"quoteProps",
    b"trailingComma",
    b"bracketSpacing",
    b"bracketSameLine",
    b"arrowParens",
    b"objectWrap",
    b"singleAttributePerLine",
    b"experimentalOperatorPosition",
    b"experimentalTernaries",
    b"embeddedLanguageFormatting",
];

/// Options by name, with their values as they are written in JSON, a string without its quotes.
type Settings = Vec<(Vec<u8>, Vec<u8>)>;

struct Pattern {
    glob: Glob,
    /// As it is written.
    has_slash: bool,
}

/// An element of `overrides`.
struct Override {
    files: Vec<Pattern>,
    excluded: Vec<Pattern>,
    settings: Settings,
    is_oxfmt: bool,
}

/// A configuration file that has been read.
pub(crate) struct Config {
    pub(crate) path: Vec<u8>,
    settings: Settings,
    overrides: Vec<Override>,
    /// It is oxfmt's, whose lines are 100 wide unless it says otherwise.
    is_oxfmt: bool,
    /// `ignorePatterns` of oxfmt.
    pub(crate) ignores: Chain,
}

/// What counts for the files of a directory.
pub(crate) struct Scope {
    pub(crate) config: Option<Arc<Config>>,
    /// From the farthest to the nearest.
    editorconfigs: Vec<Arc<editorconfig::File>>,
}

/// oxc's `GlobSet::new`: a pattern without a slash is for a name in any directory.
pub(crate) fn glob_of_oxc(pattern: &[u8]) -> Glob {
    // `{a}` is `a` there.
    let mut without_single_braces = Vec::with_capacity(pattern.len());
    let mut rest = pattern;
    while let Some(open) = strings::index_of_char_usize(rest, b'{') {
        let close = strings::index_of_char_usize(&rest[open..], b'}').map(|it| open + it);
        match close.filter(|&close| strings::index_of_any(&rest[open + 1..close], b",{").is_none())
        {
            Some(close) => {
                without_single_braces.extend_from_slice(&rest[..open]);
                without_single_braces.extend_from_slice(&rest[open + 1..close]);
                rest = &rest[close + 1..];
            }
            None => {
                without_single_braces.extend_from_slice(&rest[..=open]);
                rest = &rest[open + 1..];
            }
        }
    }
    without_single_braces.extend_from_slice(rest);
    let pattern = &without_single_braces[..];
    match pattern.strip_prefix(b"./") {
        Some(rest) => Glob::new(rest),
        None if strings::contains_char(pattern, b'/') => Glob::new(pattern),
        None => Glob::new(&[b"**/", pattern].concat()),
    }
}

fn patterns(json: Option<&Json>, is_oxfmt: bool) -> Vec<Pattern> {
    let all: Vec<&[u8]> = match json {
        Some(Json::String(one)) => vec![one],
        Some(Json::Array(items)) => items.iter().filter_map(Json::as_str).collect(),
        _ => Vec::new(),
    };
    let pattern = |text: &&[u8]| Pattern {
        glob: if is_oxfmt {
            glob_of_oxc(text)
        } else {
            Glob::new(text)
        },
        has_slash: strings::contains_char(text, b'/'),
    };
    all.iter().map(pattern).collect()
}

/// The object `before` with the keys of the object `after`, both as JSON. `after` if one is no object.
fn merged_objects(before: &[u8], after: &[u8]) -> Vec<u8> {
    let (Some(Json::Object(mut entries)), Some(Json::Object(added))) =
        (bun_lint::json::parse(before), bun_lint::json::parse(after))
    else {
        return after.to_vec();
    };
    for (name, value) in added {
        entries.retain(|it| it.0 != name);
        entries.push((name, value));
    }
    let mut text = Vec::new();
    write_json(&mut text, &Json::Object(entries));
    text
}

fn settings(json: &Json) -> Settings {
    let mut settings = Vec::new();
    for (name, value) in json.as_object().unwrap_or_default() {
        let text = match value {
            Json::String(text) => text.clone(),
            Json::Bool(value) => if *value { &b"true"[..] } else { b"false" }.to_vec(),
            // `Infinity` is not JSON. A YAML file can have it.
            Json::Number(number) if *number >= 65535.0 => b"65535".to_vec(),
            Json::Number(number) => {
                bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *number).to_vec()
            }
            // What is about the order of imports, as JSON.
            Json::Array(_) | Json::Object(_)
                if name == b"plugins"
                    || name.starts_with(b"importOrder")
                    || name.ends_with(b"ortImports") =>
            {
                let mut text = Vec::new();
                write_json(&mut text, value);
                text
            }
            Json::Object(_)
                if name == b"sortPackageJson" || name == b"experimentalSortPackageJson" =>
            {
                let name = &b"sortPackageJson".to_vec();
                let sorts_scripts = value.get(b"sortScripts").and_then(Json::as_bool) == Some(true);
                settings.push((name.clone(), b"true".to_vec()));
                settings.push((
                    b"sortPackageJson.sortScripts".to_vec(),
                    if sorts_scripts {
                        b"true".to_vec()
                    } else {
                        b"false".to_vec()
                    },
                ));
                continue;
            }
            // On, and each of its properties by itself.
            Json::Object(properties) if name == b"jsdoc" => {
                settings.push((name.clone(), b"{}".to_vec()));
                for (property, value) in properties {
                    let value = match value {
                        Json::String(text) => text.clone(),
                        Json::Bool(value) => if *value { &b"true"[..] } else { b"false" }.to_vec(),
                        _ => continue,
                    };
                    settings.push(([b"jsdoc.", &property[..]].concat(), value));
                }
                continue;
            }
            // A feature of oxfmt that is configured, and so is on.
            Json::Object(_) => b"true".to_vec(),
            _ => continue,
        };
        settings.push((name.clone(), text));
    }
    settings
}

impl Override {
    /// Prettier's `pathMatchesGlobs`. `relative`: from the directory of the configuration file.
    fn matches(&self, relative: &[u8]) -> bool {
        if self.is_oxfmt {
            let matches = |it: &Pattern| it.glob.matches(relative);
            return self.files.iter().any(matches) && !self.excluded.iter().any(matches);
        }
        let name = paths::basename(relative);
        [false, true].into_iter().any(|with_slashes| {
            // With patterns without slashes, what is excluded is matched against the name too,
            // whatever it looks like: micromatch's `basename`.
            let matches =
                |it: &Pattern| it.glob.matches(if with_slashes { relative } else { name });
            self.files
                .iter()
                .filter(|it| it.has_slash == with_slashes)
                .any(matches)
                && !self.excluded.iter().any(matches)
        })
    }
}

/// oxfmt's limits.
fn check_print_width(value: &[u8]) -> Result<(), Fatal> {
    match bun_core::fmt::parse_decimal::<u32>(value) {
        Some(1..=320) => Ok(()),
        _ => Err(Fatal(
            b"Invalid printWidth: The line width should be between 1 and 320".to_vec(),
        )),
    }
}

fn is_name_of_oxfmt(name: &[u8]) -> bool {
    name.starts_with(b".oxfmtrc") || name.starts_with(b"oxfmt.")
}

impl Config {
    fn new(path: &[u8], json: &Json, is_oxfmt: bool) -> Config {
        let overrides = json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default();
        let ignored: Vec<&[u8]> = (json
            .get(b"ignorePatterns")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter())
        .filter_map(Json::as_str)
        .collect();
        Config {
            path: path.to_vec(),
            settings: settings(json),
            overrides: (overrides.iter())
                .map(|it| Override {
                    files: patterns(it.get(b"files"), is_oxfmt),
                    excluded: patterns(it.get(b"excludeFiles"), is_oxfmt),
                    settings: it.get(b"options").map(settings).unwrap_or_default(),
                    is_oxfmt,
                })
                .collect(),
            is_oxfmt,
            ignores: gitignore::with_text(None, paths::dirname(path), &ignored.join(&b'\n'), true),
        }
    }
}

/// How to format a file.
#[derive(Default)]
pub(crate) struct Resolved {
    pub(crate) options: FormatOptions,
    /// `insertFinalNewline: false` of oxfmt.
    pub(crate) omits_final_newline: bool,
}

/// Adds what the `tsconfig.json` at `path` says about JSX, after what the files that it extends say.
fn read_tsconfig(path: &[u8], settings: &mut Settings, depth: u32) {
    let Some(json) = fs::read(path)
        .ok()
        .and_then(|text| bun_lint::json::parse(&text))
    else {
        return;
    };
    let extended: Vec<&[u8]> = match json.get(b"extends") {
        Some(Json::String(one)) => vec![one],
        Some(Json::Array(all)) => all.iter().filter_map(Json::as_str).collect(),
        _ => Vec::new(),
    };
    let directory = paths::dirname(path);
    for name in extended.into_iter().filter(|_| depth < 16) {
        let candidates = |base: Vec<u8>| {
            [
                base.clone(),
                [&base[..], b".json"].concat(),
                paths::join(&base, b"tsconfig.json"),
            ]
        };
        let found = match name.starts_with(b".") || paths::is_absolute(name) {
            true => candidates(paths::resolve(directory, name))
                .into_iter()
                .find(|it| fs::is_file(it)),
            // A package.
            false => paths::ancestors(directory)
                .flat_map(|it| candidates(paths::join(&paths::join(it, b"node_modules"), name)))
                .find(|it| fs::is_file(it)),
        };
        if let Some(found) = found {
            read_tsconfig(&found, settings, depth + 1);
        }
    }
    for name in [
        &b"jsx"[..],
        b"jsxFactory",
        b"jsxFragmentFactory",
        b"reactNamespace",
    ] {
        if let Some(value) = json
            .get(b"compilerOptions")
            .and_then(|it| it.get(name))
            .and_then(Json::as_str)
        {
            let name = [b"tsconfig.", name].concat();
            settings.retain(|it| it.0 != name);
            settings.push((name, value.to_vec()));
        }
    }
}

pub(crate) type Found = Result<Arc<Scope>, Fatal>;

/// What is in a directory, of what matters for its [`Scope`].
#[derive(Default)]
struct Listed {
    /// The configuration files, as indices into [`NAMES`].
    candidates: Vec<usize>,
    has_editorconfig: bool,
    is_project_root: bool,
}

pub(crate) struct Configs<'c> {
    options: &'c Options,
    environment: &'c Environment<'c>,
    by_directory: Guarded<FxHashMap<Vec<u8>, Found>>,
    /// `--config`
    named: Option<Result<Arc<Config>, Fatal>>,
    pub(crate) flavor: Flavor,
    /// By directory: see [`Configs::tsconfig_of`].
    tsconfigs: Guarded<FxHashMap<Vec<u8>, Arc<Settings>>>,
    /// How to sort imports, by the options that say so: they are read once, not for every file.
    sort_imports: Guarded<Vec<(SortSettings, Option<Arc<SortImports>>)>>,
    /// With oxfmt, the one `.editorconfig` that counts: the nearest to the working directory.
    editorconfig_of_oxfmt: Option<Arc<editorconfig::File>>,
    /// For the user.
    pub(crate) warnings: Guarded<Vec<Vec<u8>>>,
}

impl<'c> Configs<'c> {
    pub(crate) fn new(options: &'c Options, environment: &'c Environment<'c>) -> Configs<'c> {
        let mut configs = Configs {
            options,
            environment,
            by_directory: Guarded::new(FxHashMap::default()),
            named: None,
            flavor: Flavor::Prettier,
            tsconfigs: Guarded::new(FxHashMap::default()),
            sort_imports: Guarded::new(Vec::new()),
            editorconfig_of_oxfmt: None,
            warnings: Guarded::new(Vec::new()),
        };
        let mut is_oxfmt = match configs.for_directory(&environment.cwd) {
            Ok(scope) => scope.config.as_ref().is_some_and(|it| it.is_oxfmt),
            // The name of the one that cannot be used tells.
            Err(_) => paths::ancestors(&environment.cwd)
                .find_map(|directory| {
                    NAMES
                        .iter()
                        .position(|name| fs::is_file(&paths::join(directory, name)))
                })
                .is_some_and(|at| at < NAMES_OF_OXFMT),
        };
        if let Some(path) = &options.config {
            let path = paths::resolve(&environment.cwd, &paths::from_native(path));
            // A name that does not tell is of the tool that the project uses.
            let name = paths::basename(&path);
            is_oxfmt = is_name_of_oxfmt(name)
                || (is_oxfmt && !strings::contains(name, b"prettier") && name != b"package.json");
            configs.named = Some(match configs.load(&path, is_oxfmt) {
                Ok(Some(config)) => Ok(config),
                Ok(None) => Ok(Arc::new(Config::new(&path, &Json::Null, is_oxfmt))),
                Err(error) => Err(error),
            });
        }
        if is_oxfmt {
            configs.flavor = Flavor::Oxfmt;
            // What was found on the way was found as Prettier finds it.
            configs.by_directory.get_mut().clear();
            if options.editorconfig {
                configs.editorconfig_of_oxfmt = paths::ancestors(&environment.cwd)
                    .find_map(editorconfig::File::read)
                    .map(Arc::new);
            }
        }
        configs
    }

    /// What is wrong with the configuration that the run starts with. oxfmt stops there.
    pub(crate) fn check(&self) -> Result<(), Fatal> {
        if let Some(Err(error)) = &self.named {
            return Err(Fatal(error.0.clone()));
        }
        if self.flavor == Flavor::Oxfmt {
            let scope = self.for_directory(&self.environment.cwd)?;
            let widths = self
                .config_of(&scope)?
                .into_iter()
                .flat_map(|it| &it.settings)
                .filter(|it| it.0 == b"printWidth");
            for (_, width) in widths {
                check_print_width(width)?;
            }
        }
        Ok(())
    }

    fn warn(&self, parts: &[&[u8]]) {
        let warning = parts.concat();
        let mut warnings = self.warnings.lock();
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }

    /// Prettier's `loadConfig`. `None`: the file has no configuration, like most `package.json`.
    fn load(&self, path: &[u8], is_oxfmt: bool) -> Result<Option<Arc<Config>>, Fatal> {
        let name = paths::basename(path);
        let read = || {
            fs::read(path).map_err(|error| {
                Fatal(
                    [
                        b"Cannot read the configuration file ",
                        path,
                        b": ",
                        &fs::describe(&error),
                    ]
                    .concat(),
                )
            })
        };
        let run = || {
            evaluate::evaluate(
                self.environment,
                evaluate::PRETTIER,
                path,
                self.options.config_cache,
            )
        };
        let json = if name == b"package.json" {
            let text = read()?;
            // Most have no such word in them.
            if !strings::contains(&text, b"\"prettier\"") {
                return Ok(None);
            }
            match bun_lint::json::parse(&text)
                .as_ref()
                .and_then(|it| it.get(b"prettier"))
            {
                None | Some(Json::Null | Json::Bool(false)) => return Ok(None),
                // The name of a package.
                Some(Json::String(_)) => run()?,
                Some(config) => config.clone(),
            }
        } else if name.ends_with(b".json") || name.ends_with(b".jsonc") {
            bun_lint::json::parse(&read()?)
                .ok_or_else(|| Fatal([b"JSON Error in \"", path, b"\""].concat()))?
        } else if name == b".prettierrc" {
            // YAML, which JSON is a part of.
            match bun_lint::json::parse(&read()?) {
                Some(json @ Json::Object(_)) => json,
                _ => run()?,
            }
        } else {
            run()?
        };
        if matches!(json, Json::Null) {
            return Ok(None);
        }
        // What the plugins that sort imports do is built in.
        let is_built_in = |it: &Json| {
            it.as_str().is_some_and(|name| {
                name.ends_with(b"/prettier-plugin-sort-imports")
                    || name == b"prettier-plugin-organize-imports"
            })
        };
        if json
            .get(b"plugins")
            .and_then(Json::as_array)
            .is_some_and(|it| !it.iter().all(is_built_in))
        {
            self.warn(&[
                b"Plugins are not supported: \"plugins\" in ",
                path,
                b" has no effect.",
            ]);
        }
        Ok(Some(Arc::new(Config::new(path, &json, is_oxfmt))))
    }

    /// What counts in `directory`, whose entries are `names`, and whose parent has `above`.
    fn scope<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
        above: Option<&Scope>,
    ) -> Found {
        let count = if self.flavor == Flavor::Oxfmt {
            NAMES_OF_OXFMT
        } else {
            NAMES.len()
        };
        let mut listed = Listed::default();
        for name in names.filter(|name| matches!(name.first(), Some(b'.' | b'p' | b'o'))) {
            match name {
                b".editorconfig" => listed.has_editorconfig = true,
                b".git" | b".hg" => listed.is_project_root = true,
                name => listed.candidates.extend(
                    NAMES
                        .iter()
                        .position(|it| *it == name)
                        .filter(|at| *at < count),
                ),
            }
        }
        self.scope_of(directory, listed, above)
    }

    /// What counts in `directory`, which has `listed`, and whose parent has `above`.
    fn scope_of(&self, directory: &[u8], listed: Listed, above: Option<&Scope>) -> Found {
        let Listed {
            mut candidates,
            has_editorconfig,
            is_project_root,
        } = listed;
        let mut config = above.and_then(|it| it.config.clone());
        if self.named.is_none() && self.options.config_lookup {
            // One after the other: a `package.json` need not have a configuration.
            candidates.sort_unstable();
            if let [first, second, ..] = candidates[..]
                && second < NAMES_OF_OXFMT
            {
                return Err(Fatal(
                    [
                        b"Both '",
                        NAMES[first],
                        b"' and '",
                        NAMES[second],
                        b"' found in ",
                        directory,
                        b".",
                    ]
                    .concat(),
                ));
            }
            for at in candidates {
                if let Some(found) =
                    self.load(&paths::join(directory, NAMES[at]), at < NAMES_OF_OXFMT)?
                {
                    config = Some(found);
                    break;
                }
            }
        }
        if self.flavor == Flavor::Oxfmt {
            let editorconfigs = self.editorconfig_of_oxfmt.iter().map(Arc::clone).collect();
            return Ok(Arc::new(Scope {
                config,
                editorconfigs,
            }));
        }
        let own = if has_editorconfig && self.options.editorconfig {
            editorconfig::File::read(directory)
        } else {
            None
        };
        let starts_over = is_project_root || own.as_ref().is_some_and(|it| it.is_root);
        let mut editorconfigs = match (starts_over, above) {
            (false, Some(above)) => above.editorconfigs.clone(),
            _ => Vec::new(),
        };
        editorconfigs.extend(own.map(Arc::new));
        Ok(Arc::new(Scope {
            config,
            editorconfigs,
        }))
    }

    /// What counts for the files in `directory`.
    pub(crate) fn for_directory(&self, directory: &[u8]) -> Found {
        let directory = if self.options.disable_nested_config {
            &self.environment.cwd[..]
        } else {
            directory
        };
        let mut missing: Vec<&[u8]> = Vec::new();
        let mut above: Option<Found> = None;
        for ancestor in paths::ancestors(directory) {
            match self.by_directory.lock().get(ancestor) {
                Some(known) => {
                    above = Some(known.clone());
                    break;
                }
                None => missing.push(ancestor),
            }
        }
        for directory in missing.into_iter().rev() {
            let entries = fs::list(directory).map_or_else(Vec::new, |it| it.entries);
            let names = entries.iter().map(|it| &it.name[..]);
            let found = match &above {
                Some(Ok(above)) => self.scope(directory, names, Some(above)),
                None => self.scope(directory, names, None),
                // A configuration file that cannot be used does not matter below a nearer one.
                Some(Err(error)) => {
                    self.scope(directory, names, None)
                        .and_then(|scope| match scope.config {
                            Some(_) => Ok(scope),
                            None => Err(error.clone()),
                        })
                }
            };
            self.by_directory
                .lock()
                .insert(directory.to_vec(), found.clone());
            above = Some(found);
        }
        above.unwrap_or_else(|| Err(Fatal(b"The path of a directory is empty.".to_vec())))
    }

    /// The same for a directory whose entries are `names`, and whose parent has `above`.
    pub(crate) fn for_listed_directory<'n>(
        &self,
        directory: &[u8],
        names: impl Iterator<Item = &'n [u8]>,
        above: &Arc<Scope>,
    ) -> Found {
        if self.options.disable_nested_config {
            return Ok(Arc::clone(above));
        }
        let found = self.scope(directory, names, Some(above));
        self.by_directory
            .lock()
            .insert(directory.to_vec(), found.clone());
        found
    }

    /// `ignorePatterns` of the configuration file for what has `scope`.
    pub(crate) fn ignores_of<'s>(&'s self, scope: &'s Scope) -> &'s Chain {
        self.config_of(scope)
            .ok()
            .flatten()
            .map_or(&None, |it| &it.ignores)
    }

    /// The configuration file for what has `scope`.
    pub(crate) fn config_of<'s>(
        &'s self,
        scope: &'s Scope,
    ) -> Result<Option<&'s Arc<Config>>, Fatal> {
        match &self.named {
            _ if !self.options.config_lookup => Ok(None),
            Some(named) => named.as_ref().map(Some).map_err(Fatal::clone),
            None => Ok(scope.config.as_ref()),
        }
    }

    /// Whether the option `parser` is set for the file at `path`, which has `scope`.
    pub(crate) fn names_parser_for(&self, scope: &Scope, path: &[u8]) -> bool {
        let is_about_parser = |it: &(Vec<u8>, Vec<u8>)| it.0 == b"parser";
        let may_be_set = self.options.format.iter().any(|it| it.0 == b"parser")
            || self.config_of(scope).ok().flatten().is_some_and(|config| {
                config.settings.iter().any(is_about_parser)
                    || config
                        .overrides
                        .iter()
                        .any(|it| it.settings.iter().any(is_about_parser))
            });
        may_be_set
            && self
                .options_for(scope, path)
                .is_ok_and(|it| it.options.parser.is_some())
    }

    /// Prettier's `getOptionsForFile`: how to format the file at `path`, which has `scope`.
    pub(crate) fn options_for(&self, scope: &Scope, path: &[u8]) -> Result<Resolved, Fatal> {
        let config = self.config_of(scope)?;
        let mut from_files: Vec<(&[u8], &[u8])> = Vec::new();
        let from_editorconfig = match self.options.config_lookup {
            true => editorconfig::options_for(scope.editorconfigs.iter().map(|it| &**it), path),
            false => Vec::new(),
        };
        // oxfmt does not know `max_line_length = off`.
        let counts = |it: &&(&[u8], Vec<u8>)| {
            self.flavor == Flavor::Prettier || (it.0, &it.1[..]) != (b"printWidth", b"65535")
        };
        from_files.extend(
            from_editorconfig
                .iter()
                .filter(counts)
                .map(|it| (it.0, &it.1[..])),
        );
        if let Some(config) = config {
            if config.is_oxfmt && !from_files.iter().any(|it| it.0 == b"printWidth") {
                from_files.push((b"printWidth", b"100"));
            }
            from_files.extend(config.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            let relative = paths::relative(paths::dirname(&config.path), path);
            for it in config.overrides.iter().filter(|it| it.matches(&relative)) {
                from_files.extend(it.settings.iter().map(|it| (&it.0[..], &it.1[..])));
            }
        }
        let has_files = config.is_some() || !from_editorconfig.is_empty();
        let from_flags = self.options.format.iter().map(|it| (it.0, &it.1[..]));
        let all: Vec<(&[u8], &[u8])> = match self.options.config_precedence {
            Precedence::CliOverride => from_files.into_iter().chain(from_flags).collect(),
            Precedence::FileOverride => from_flags.chain(from_files).collect(),
            Precedence::PreferFile if has_files => from_files,
            Precedence::PreferFile => from_flags.collect(),
        };
        let mut resolved = Resolved::default();
        let mut sort = SortSettings::default();
        let _ = resolved.options.set(b"filepath", path);
        resolved.options.format_javascript = Some(super::format_javascript);
        resolved.options.parse_javascript = Some(super::parse_javascript);
        if self.flavor == Flavor::Oxfmt {
            let _ = resolved.options.set(b"flavor", b"oxfmt");
            // It sorts the keys of a `package.json` unless it is told not to.
            let _ = resolved.options.set(b"sortPackageJson", b"true");
        }
        // `prettier-plugin-organize-imports` asks TypeScript, which asks the `tsconfig.json`.
        let mut organizes_imports = false;
        let mut sort_imports: Option<Vec<u8>> = None;
        for (name, value) in all {
            organizes_imports |= name.starts_with(b"organizeImports")
                || (name == b"plugins"
                    && strings::contains(value, b"prettier-plugin-organize-imports"));
            match name {
                // An override of oxfmt changes the keys that it has.
                name if self.flavor == Flavor::Oxfmt && name.ends_with(b"ortImports") => {
                    let merged = sort_imports
                        .as_deref()
                        .map_or_else(|| value.to_vec(), |before| merged_objects(before, value));
                    sort.set(name, &merged);
                    sort_imports = Some(merged);
                }
                name if sort.set(name, value) => {}
                b"insertFinalNewline" if self.flavor == Flavor::Oxfmt => {
                    resolved.omits_final_newline = value == b"false"
                }
                b"sortPackageJson" | b"sortPackageJson.sortScripts"
                    if self.flavor == Flavor::Oxfmt =>
                {
                    let _ = resolved.options.set(name, value);
                }
                b"experimentalSortPackageJson" if self.flavor == Flavor::Oxfmt => {
                    let _ = resolved.options.set(b"sortPackageJson", value);
                }
                b"printWidth"
                    if self.flavor == Flavor::Oxfmt && check_print_width(value).is_err() =>
                {
                    check_print_width(value)?;
                }
                name if name == b"jsdoc" || name.starts_with(b"jsdoc.") => {
                    if resolved.options.set(name, value).is_err() {
                        return Err(Fatal(
                            [b"Invalid ", name, b" value: ", value, b"."].concat(),
                        ));
                    }
                }
                b"sortTailwindcss" | b"experimentalTailwindcss" if value != b"false" => {
                    self.warn(&[name, b" is not supported yet, and has no effect."]);
                }
                name if OPTIONS.contains(&name) && resolved.options.set(name, value).is_err() => {
                    return Err(Fatal(
                        [b"Invalid ", name, b" value: ", value, b"."].concat(),
                    ));
                }
                _ => {}
            }
        }
        if organizes_imports {
            for (name, value) in self.tsconfig_of(paths::dirname(path)).iter() {
                sort.set(name, value);
            }
        }
        resolved.options.sort_imports = self.sort_imports(sort)?;
        Ok(resolved)
    }

    /// What the `tsconfig.json` nearest to `directory` says about JSX, as settings for the sorting
    /// of imports.
    fn tsconfig_of(&self, directory: &[u8]) -> Arc<Settings> {
        if let Some(known) = self.tsconfigs.lock().get(directory) {
            return Arc::clone(known);
        }
        let nearest = paths::ancestors(directory)
            .map(|it| paths::join(it, b"tsconfig.json"))
            .find(|it| fs::is_file(it));
        let mut settings = Settings::new();
        if let Some(path) = nearest {
            read_tsconfig(&path, &mut settings, 0);
        }
        let settings = Arc::new(settings);
        self.tsconfigs
            .lock()
            .insert(directory.to_vec(), Arc::clone(&settings));
        settings
    }

    fn sort_imports(&self, settings: SortSettings) -> Result<Option<Arc<SortImports>>, Fatal> {
        let mut known = self.sort_imports.lock();
        if let Some((_, how)) = known.iter().find(|it| it.0 == settings) {
            return Ok(how.clone());
        }
        let how = settings.compile().map_err(Fatal)?;
        known.push((settings, how.clone()));
        Ok(how)
    }
}
