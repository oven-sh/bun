//! oxfmt's `sortTailwindcss`: where the order of classes comes from.
//!
//! Only the Tailwind CSS of the project knows it, and that is JavaScript. The formatter asks for the order of each list of
//! classes that it comes across. A file with a class that is not known yet is put aside. When all files have had their
//! turn, one script answers for all those classes, and the files that were put aside are formatted again.

use super::files::Kind;
use crate::evaluate::{TAILWIND, evaluate_input};
use crate::run::Environment;
use crate::{fs, paths};
use bun_core::printer::json_stringify_alloc;
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::tailwind::{Names, Orders, Oxc, Rank, Tailwind};
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

/// Which Tailwind is asked: the package in the directory `root`, loaded with one of these files.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Which {
    root: Vec<u8>,
    config: Option<Vec<u8>>,
    stylesheet: Option<Vec<u8>>,
    /// `root` is `prettier-plugin-tailwindcss`, and the Tailwind that it brings along is asked.
    is_bundled: bool,
}

impl Which {
    fn entries(&self) -> Vec<(Vec<u8>, Json)> {
        let path = |path: &Option<Vec<u8>>| path.clone().map_or(Json::Null, Json::String);
        vec![
            (b"root".to_vec(), Json::String(self.root.clone())),
            (b"config".to_vec(), path(&self.config)),
            (b"stylesheet".to_vec(), path(&self.stylesheet)),
            (b"isBundled".to_vec(), Json::Bool(self.is_bundled)),
        ]
    }

    /// Whether JavaScript, where a path is a string, can name the files.
    fn is_utf8(&self) -> bool {
        let mut paths = (self.config.iter().chain(&self.stylesheet)).chain([&self.root]);
        paths.all(|it| strings::is_valid_utf8(it))
    }
}

/// What is found from a directory upwards.
#[derive(Clone)]
struct Found {
    /// The directory of the package `tailwindcss`.
    root: Vec<u8>,
    is_version_4: bool,
    /// Unless it is version 4: the nearest `tailwind.config.*`.
    config: Option<Vec<u8>>,
}

/// `package`: what Tailwind CSS is called.
fn find(directory: &[u8], package: &[u8]) -> Option<Found> {
    // Only another package of the workspace may depend on it. pnpm and Bun's isolated linker still have one place for all
    // packages of an installation.
    let places: [&[u8]; 3] = [
        b"node_modules/",
        b"node_modules/.pnpm/node_modules/",
        b"node_modules/.bun/node_modules/",
    ];
    let root = places.iter().find_map(|place| {
        paths::ancestors(directory)
            .map(|it| paths::join(it, &[place, package].concat()))
            .find(|it| fs::is_file(&paths::join(it, b"package.json")))
    })?;
    let names: [&[u8]; 4] = [
        b"tailwind.config.js",
        b"tailwind.config.cjs",
        b"tailwind.config.mjs",
        b"tailwind.config.ts",
    ];
    let is_version_4 = fs::is_file(&paths::join(&root, b"theme.css"));
    let config = match is_version_4 {
        true => None,
        false => paths::ancestors(directory)
            .flat_map(|it| names.map(|name| paths::join(it, name)))
            .find(|it| fs::is_file(it)),
    };
    Some(Found {
        root,
        is_version_4,
        config,
    })
}

/// The version of the package `name` that is loaded from `directory`.
pub(crate) fn version_of_package(name: &[u8], directory: &[u8]) -> Option<[u64; 3]> {
    let file = [b"node_modules/", name, b"/package.json"].concat();
    let package = paths::ancestors(directory).find_map(|it| fs::read(&paths::join(it, &file)).ok());
    version_in(&bun_lint::json::parse(&package?)?)
}

/// `version` in a `package.json`.
pub(crate) fn version_in(package: &Json) -> Option<[u64; 3]> {
    let parsed = bun_semver::Version::parse_utf8(package.get(b"version")?.as_str()?);
    let version = parsed.version.min();
    parsed
        .valid
        .then_some([version.major, version.minor, version.patch])
}

/// The classes in files for which the same Tailwind is asked, each as [`key_of`] has it.
#[derive(Default)]
struct Group {
    /// The ranks are among all of them.
    known: FxHashMap<Vec<u8>, Rank>,
    /// Asked for, and not known.
    missing: Vec<Vec<u8>>,
}

/// `class` as the script reads it, and names it in its answer: the question is JSON, where what is not UTF-8 is U+FFFD.
fn key_of(class: &[u8]) -> Cow<'_, [u8]> {
    if strings::is_valid_utf8(class) {
        return Cow::Borrowed(class);
    }
    match bun_lint::json::parse(&json_stringify_alloc(class)).and_then(Json::into_string) {
        Some(key) => Cow::Owned(key),
        None => Cow::Borrowed(class),
    }
}

#[derive(Default)]
struct Known {
    /// For a package of another name than `tailwindcss`, that is behind the directory, and a NUL.
    by_directory: FxHashMap<Vec<u8>, Option<Found>>,
    groups: FxHashMap<Which, Group>,
    /// Why there is no Tailwind for files that have classes: the first in the order of the texts, which end with a directory.
    without_package: Option<Vec<u8>>,
}

/// What a run knows about the order of classes.
#[derive(Default)]
pub(crate) struct Classes {
    known: Guarded<Known>,
}

/// [`Classes`], for the files of a directory.
struct OfGroup {
    classes: Arc<Classes>,
    /// `Err`: why there is no Tailwind for it.
    which: Result<Which, Vec<u8>>,
}

impl std::fmt::Debug for OfGroup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OfGroup")
    }
}

/// A lock is around all that changes.
impl std::panic::RefUnwindSafe for OfGroup {}

impl Orders for OfGroup {
    fn has_tailwind(&self) -> bool {
        self.which.is_ok()
    }

    fn ranks_of(&self, classes: &[u8]) -> Option<Vec<Rank>> {
        let mut known = self.classes.known.lock();
        let which = match &self.which {
            Ok(which) => which,
            Err(why) => {
                if known.without_package.as_ref().is_none_or(|it| why < it) {
                    known.without_package = Some(why.clone());
                }
                return None;
            }
        };
        if !known.groups.contains_key(which) {
            known.groups.insert(which.clone(), Group::default());
        }
        let group = known.groups.get_mut(which)?;
        let (mut ranks, mut is_known) = (Vec::new(), true);
        for class in strings::split(classes, b" ") {
            let key = key_of(class);
            match group.known.get(&key[..]) {
                _ if class.is_empty() => ranks.push(None),
                Some(&rank) => ranks.push(rank),
                None => {
                    group.missing.push(key.into_owned());
                    is_known = false;
                }
            }
        }
        is_known.then_some(ranks)
    }
}

impl Known {
    /// Takes in what the script has answered about `asked`, in that order. Returns what it says about each Tailwind that
    /// cannot be asked, if there are classes that it has to be asked about.
    fn take_in(&mut self, asked: Vec<Which>, answer: &Json) -> Vec<Vec<u8>> {
        let mut failures = Vec::new();
        let answers = (answer.get(b"groups").and_then(Json::as_array)).unwrap_or_default();
        for (which, answer) in asked.into_iter().zip(answers) {
            if let Some(error) = answer.get(b"error").and_then(Json::as_str) {
                // It is not asked again, unless there are files for it.
                let group = self.groups.remove(&which);
                if group.is_some_and(|it| !it.missing.is_empty()) {
                    let error: &[u8] = match which.is_utf8() {
                        true => error,
                        false => b"cannot load Tailwind CSS from a path that is not UTF-8",
                    };
                    let loaded = which.config.or(which.stylesheet).unwrap_or(which.root);
                    failures.push([&loaded[..], b": ", error].concat());
                }
                continue;
            }
            let group = self.groups.entry(which).or_default();
            group.missing.clear();
            group.known.clear();
            for (class, rank) in
                (answer.get(b"ranks").and_then(Json::as_object)).unwrap_or_default()
            {
                let rank = match rank {
                    Json::Number(rank) => Some(*rank as u32),
                    _ => None,
                };
                group.known.insert(class.clone(), rank);
            }
        }
        // Whatever the order of the answers is.
        bun_collections::index_sort::sort_slice(&mut failures[..]);
        failures
    }
}

/// Default `functions` when `[fmt]` or the flag turns sorting on. These are the common class-name helpers. oxfmt and the
/// Prettier plugin default to an empty list.
const FUNCTIONS: [&[u8]; 9] = [
    b"clsx",
    b"cn",
    b"cva",
    b"cx",
    b"classNames",
    b"classnames",
    b"twMerge",
    b"twJoin",
    b"tv",
];

/// What turns the sorting on.
#[derive(Clone, Copy)]
pub(crate) enum SetBy<'a> {
    /// `[fmt]` or the flag. Paths, which only `[fmt]` has, are relative to this directory: where bunfig.toml is.
    Bun(&'a [u8]),
    /// An oxfmt config in this directory, which paths are relative to.
    Oxfmt(&'a [u8]),
    /// `prettier-plugin-tailwindcss` in a Prettier config. Paths are relative to this directory.
    Plugin(&'a [u8]),
}

impl<'a> SetBy<'a> {
    fn base(self) -> &'a [u8] {
        match self {
            SetBy::Bun(base) | SetBy::Oxfmt(base) | SetBy::Plugin(base) => base,
        }
    }
}

/// `value`, which is `sortTailwindcss` as JSON, with its paths from the root: it goes into one that something else sets.
pub(crate) fn with_whole_paths(value: &[u8], set_by: SetBy) -> Vec<u8> {
    let Some(mut entries) = bun_lint::json::parse(value).and_then(Json::into_object) else {
        return value.to_vec();
    };
    for (name, value) in &mut entries {
        if let Json::String(path) = value
            && matches!(&name[..], b"config" | b"stylesheet" | b"entryPoint")
            && !path.is_empty()
        {
            *path = paths::resolve(set_by.base(), &paths::from_native(path));
        }
    }
    let mut text = Vec::new();
    write_json(&mut text, &Json::Object(entries));
    text
}

const PLUGIN: &[u8] = b"prettier-plugin-tailwindcss";

/// The options of `prettier-plugin-tailwindcss` and what they are called in `sortTailwindcss`: four strings, two lists of
/// strings, two that are on or off.
const OPTIONS_OF_PLUGIN: [(&[u8], &[u8]); 8] = [
    (b"tailwindConfig", b"config"),
    (b"tailwindStylesheet", b"stylesheet"),
    (b"tailwindEntryPoint", b"entryPoint"),
    (b"tailwindPackageName", b"packageName"),
    (b"tailwindFunctions", b"functions"),
    (b"tailwindAttributes", b"attributes"),
    (b"tailwindPreserveWhitespace", b"preserveWhitespace"),
    (b"tailwindPreserveDuplicates", b"preserveDuplicates"),
];

/// `name`, which a Prettier config sets to `value`, which is JSON, as an entry of `sortTailwindcss`. `None`: it is no option
/// of the plugin. `Err`: what Prettier says about a value of the wrong type.
pub(crate) fn option_of_plugin(
    name: &[u8],
    value: &[u8],
) -> Option<Result<(Vec<u8>, Json), Vec<u8>>> {
    let at = OPTIONS_OF_PLUGIN.iter().position(|it| it.0 == name)?;
    let value = bun_lint::json::parse(value)?;
    let is_string = |it: &Json| matches!(it, Json::String(_));
    let (is_right, expected): (bool, &[u8]) = match at {
        0..4 => (is_string(&value), b"a string"),
        4..6 => (
            value.as_array().is_some_and(|it| it.iter().all(is_string)),
            b"an array of a string",
        ),
        _ => (matches!(value, Json::Bool(_)), b"true or false"),
    };
    if is_right {
        return Some(Ok((OPTIONS_OF_PLUGIN[at].1.to_vec(), value)));
    }
    let mut refusal = [b"Invalid ", name, b" value. Expected ", expected].concat();
    refusal.extend_from_slice(b", but received ");
    super::config::write_as_shown(&mut refusal, &value);
    refusal.push(b'.');
    Some(Err(refusal))
}

/// What the plugin says about its options, which are `entries` of `sortTailwindcss`.
pub(crate) fn warning_of_plugin(entries: &[(Vec<u8>, Json)]) -> Option<Vec<u8>> {
    let get = |key: &[u8]| {
        let path = entries.iter().find(|it| it.0 == key)?.1.as_str()?;
        (!path.is_empty()).then_some(path)
    };
    let is_sheet = |path: &&[u8]| path.ends_with(b".css");
    let old: &[u8] = match (get(b"stylesheet"), get(b"entryPoint"), get(b"config")) {
        (Some(_), _, Some(config)) | (_, Some(_), Some(config)) if !is_sheet(&config) => {
            return Some(b"You have specified a Tailwind CSS stylesheet and a Tailwind CSS config at the same time. Use stylesheetPath unless you are using v3. Preferring the stylesheet.".to_vec());
        }
        (None, Some(_), _) => b"tailwindEntryPoint",
        (None, None, Some(config)) if is_sheet(&config) => b"tailwindConfig",
        _ => return None,
    };
    let start = b"Deprecated: Use the `tailwindStylesheet` option for v4 projects instead of `";
    Some([&start[..], old, b"`."].concat())
}

/// Resolves `sortTailwindcss` for a file in `directory`. `value` is the option as JSON, and it isn't `false`.
pub(crate) fn for_file(
    classes: &Arc<Classes>,
    value: &[u8],
    (set_by, directory): (SetBy, &[u8]),
) -> Tailwind {
    let base = set_by.base();
    // `true` has no keys.
    let json = bun_lint::json::parse(value);
    let get = |key: &[u8]| json.as_ref()?.get(key);
    let names = |key: &[u8]| -> Vec<Vec<u8>> {
        (get(key).and_then(Json::as_array).unwrap_or_default().iter())
            .filter_map(|it| it.as_str().map(<[u8]>::to_vec))
            .collect()
    };
    let path_at = |key: &[u8]| {
        // The plugin takes an empty one for none.
        let path = get(key)?.as_str().filter(|it| !it.is_empty())?;
        Some(paths::resolve(base, &paths::from_native(path)))
    };
    let is_on = |key: &[u8]| get(key).and_then(Json::as_bool) == Some(true);
    let find = |package: &[u8]| {
        let key = match package {
            b"tailwindcss" => Cow::Borrowed(directory),
            _ => Cow::Owned([directory, b"\0", package].concat()),
        };
        let mut known = classes.known.lock();
        if !known.by_directory.contains_key(&key[..]) {
            known
                .by_directory
                .insert(key.to_vec(), find(directory, package));
        }
        known.by_directory.get(&key[..]).cloned().flatten()
    };
    let package = (get(b"packageName").and_then(Json::as_str)).unwrap_or(b"tailwindcss");
    let found = find(package);
    // The plugin's `getTailwindConfig`.
    let (sheets, config): (Vec<_>, Vec<_>) =
        (path_at(b"config").into_iter()).partition(|it| it.ends_with(b".css"));
    let stylesheet = path_at(b"stylesheet")
        .or_else(|| path_at(b"entryPoint"))
        .or_else(|| sheets.into_iter().next());
    let config = config.into_iter().next();
    let follows_plugin = matches!(set_by, SetBy::Plugin(_));
    // The plugin brings versions 3 and 4 along, for a project without the package and for an option of the other version.
    let of_other_version: Option<&[u8]> = match &found {
        Some(found) if found.is_version_4 && config.is_some() && stylesheet.is_none() => {
            Some(b"tailwindConfig is for Tailwind CSS 3")
        }
        Some(found) if !found.is_version_4 && stylesheet.is_some() => {
            Some(b"tailwindStylesheet is for Tailwind CSS 4")
        }
        _ => None,
    };
    let bundled = match follows_plugin && (found.is_none() || of_other_version.is_some()) {
        true => find(PLUGIN),
        false => None,
    };
    let is_bundled = bundled.is_some();
    let which = match (bundled.or(found), of_other_version) {
        (Some(found), Some(option)) if follows_plugin && !is_bundled => Err([
            option,
            b", and another version is in ",
            &found.root,
            b"\n  Run bun add -d prettier-plugin-tailwindcss, which brings its own",
        ]
        .concat()),
        (Some(found), _) => Ok(Which {
            root: found.root,
            config: config.or_else(|| found.config.filter(|_| stylesheet.is_none())),
            stylesheet,
            is_bundled,
        }),
        (None, _) => Err([
            b"the ",
            package,
            b" package was not found from ",
            directory,
            b"\n  Run bun add -d ",
            package,
        ]
        .concat()),
    };
    Tailwind {
        functions: Names::new(match (set_by, get(b"functions")) {
            (SetBy::Bun(_), None) => FUNCTIONS.map(<[u8]>::to_vec).to_vec(),
            _ => names(b"functions"),
        }),
        attributes: Names::new(names(b"attributes")),
        preserves_whitespace: is_on(b"preserveWhitespace"),
        preserves_duplicates: is_on(b"preserveDuplicates"),
        follows_plugin,
        oxc: Oxc::Absent,
        orders: Box::new(OfGroup {
            classes: Arc::clone(classes),
            which,
        }),
        has_missed: AtomicBool::new(false),
    }
}

impl Classes {
    /// Whether there are files for which the Tailwind that the plugin brings along is asked.
    pub(crate) fn asks_plugin(&self) -> bool {
        let known = self.known.lock();
        let mut found = known.by_directory.iter().filter(|it| it.1.is_some());
        found.any(|it| it.0.ends_with(PLUGIN))
    }

    /// Asks Tailwind about the classes that are not known. `Err`: for the user: there are files for which it cannot be
    /// asked. What it says about the others is known all the same.
    pub(crate) fn ask(&self, environment: &Environment) -> Result<(), Vec<u8>> {
        let fail = |why: &[u8]| [b"sortTailwindcss: ", why].concat();
        let mut known = self.known.lock();
        let without_package = known.without_package.as_deref().map(fail);
        if !known.groups.values().any(|it| !it.missing.is_empty()) {
            return without_package.map_or(Ok(()), Err);
        }
        // The ranks are among all classes that are asked about, so those that are known are asked about again.
        // In an order that is the same on every machine.
        let mut asked: Vec<Which> = known.groups.keys().cloned().collect();
        bun_collections::index_sort::sort_slice(&mut asked[..]);
        let groups = asked.iter().map(|which| {
            let group = known.groups.get(which);
            let mut classes: Vec<&[u8]> = (group.into_iter())
                .flat_map(|it| it.known.keys().chain(&it.missing))
                .map(|it| &it[..])
                .collect();
            bun_collections::index_sort::sort_slice(&mut classes[..]);
            classes.dedup();
            let classes = classes.into_iter().map(|it| Json::String(it.to_vec()));
            let mut entries = which.entries();
            entries.push((b"classes".to_vec(), Json::Array(classes.collect())));
            Json::Object(entries)
        });
        let mut text = Vec::new();
        write_json(
            &mut text,
            &Json::Object(vec![(b"groups".to_vec(), Json::Array(groups.collect()))]),
        );
        let answer = evaluate_input(environment, TAILWIND, &environment.cwd, &text)
            .map_err(|why| fail(&why))?;
        let failures: Vec<Vec<u8>> = (without_package.into_iter())
            .chain(known.take_in(asked, &answer).iter().map(|it| fail(it)))
            .collect();
        match failures.is_empty() {
            true => Ok(()),
            false => Err(failures.join(&b"\n"[..])),
        }
    }
}

/// Takes `sortTailwindcss` from `options`, which are for a file of this kind, if oxfmt does not sort in that language. The
/// plugin of Prettier sorts in LWC and in MDX too.
pub(crate) fn only_where_sorted(options: &mut FormatOptions, kind: Option<Kind>) {
    use bun_format::html::Parser;
    let is_sorted = match kind {
        None
        | Some(
            Kind::Script
            | Kind::Css(_)
            | Kind::Markdown
            | Kind::Handlebars
            | Kind::Svelte
            | Kind::Html(Parser::Html | Parser::Vue | Parser::Angular),
        ) => true,
        Some(Kind::Html(Parser::Lwc) | Kind::Mdx) => {
            (options.tailwind.as_deref()).is_some_and(|it| it.follows_plugin)
        }
        Some(_) => false,
    };
    if !is_sorted {
        options.tailwind = None;
    }
}
