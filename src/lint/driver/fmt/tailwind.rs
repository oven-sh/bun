//! oxfmt's `sortTailwindcss`: where the class order comes from.
//!
//! Only the project's own Tailwind CSS knows the order, and that's JavaScript. The formatter looks up the order of each
//! class list it finds. A file with a class that isn't known yet is set aside. Once every file has been visited, one
//! script answers for all the unknown classes, and the files that were set aside are formatted again.

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

/// Identifies a Tailwind to ask: the package in the directory `root`, loaded with one of these files.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct TailwindId {
    root: Vec<u8>,
    config: Option<Vec<u8>>,
    stylesheet: Option<Vec<u8>>,
    /// `root` is `prettier-plugin-tailwindcss`, and the Tailwind bundled with it is asked.
    is_bundled: bool,
}

impl TailwindId {
    fn entries(&self) -> Vec<(Vec<u8>, Json)> {
        let path = |path: &Option<Vec<u8>>| path.clone().map_or(Json::Null, Json::String);
        vec![
            (b"root".to_vec(), Json::String(self.root.clone())),
            (b"config".to_vec(), path(&self.config)),
            (b"stylesheet".to_vec(), path(&self.stylesheet)),
            (b"isBundled".to_vec(), Json::Bool(self.is_bundled)),
        ]
    }

    /// True if JavaScript, where a path is a string, can represent these paths.
    fn is_utf8(&self) -> bool {
        let mut paths = (self.config.iter().chain(&self.stylesheet)).chain([&self.root]);
        paths.all(|it| strings::is_valid_utf8(it))
    }
}

/// The result of searching upwards from a directory.
#[derive(Clone)]
struct Found {
    /// The `tailwindcss` package's directory.
    root: Vec<u8>,
    is_version_4: bool,
    /// The nearest `tailwind.config.*`. Always `None` for version 4.
    config: Option<Vec<u8>>,
}

/// `package` is the name Tailwind CSS is installed under.
fn find(directory: &[u8], package: &[u8]) -> Option<Found> {
    // Maybe only another workspace package depends on it. pnpm and Bun's isolated linker still link every installed
    // package into one shared directory.
    let module_directories: [&[u8]; 3] = [
        b"node_modules/",
        b"node_modules/.pnpm/node_modules/",
        b"node_modules/.bun/node_modules/",
    ];
    let root = module_directories.iter().find_map(|module_directory| {
        paths::ancestors(directory)
            .map(|it| paths::join(it, &[module_directory, package].concat()))
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

/// Returns the version of the package `name` as resolved from `directory`.
pub(crate) fn version_of_package(name: &[u8], directory: &[u8]) -> Option<[u64; 3]> {
    let file = [b"node_modules/", name, b"/package.json"].concat();
    let package = paths::ancestors(directory).find_map(|it| fs::read(&paths::join(it, &file)).ok());
    version_in(&bun_lint::json::parse(&package?)?)
}

/// Parses `version` from a `package.json`.
pub(crate) fn version_in(package: &Json) -> Option<[u64; 3]> {
    let parsed = bun_semver::Version::parse_utf8(package.get(b"version")?.as_str()?);
    let version = parsed.version.min();
    parsed
        .valid
        .then_some([version.major, version.minor, version.patch])
}

/// The classes from all files that use the same Tailwind, each normalized by [`key_of`].
#[derive(Default)]
struct Group {
    /// Each rank is relative to all the classes in the group.
    known: FxHashMap<Vec<u8>, Rank>,
    /// Looked up but not known yet.
    missing: Vec<Vec<u8>>,
}

/// Returns `class` as the script sees it and echoes it in its answer. The request is JSON, where invalid UTF-8 becomes
/// U+FFFD.
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
    /// For a package not named `tailwindcss`, the key is the directory, a NUL, and the package name.
    by_directory: FxHashMap<Vec<u8>, Option<Found>>,
    groups: FxHashMap<TailwindId, Group>,
    /// The package that's missing for files with the option on. If there are several, the first in sort order.
    not_installed: Option<Vec<u8>>,
    /// Why the Tailwind for files with classes can't be asked. If there are several reasons, the first in sort order.
    version_mismatch: Option<Vec<u8>>,
}

/// Everything a run has learned about class order.
#[derive(Default)]
pub(crate) struct Classes {
    known: Guarded<Known>,
}

/// A view of [`Classes`] for the files in one directory.
struct GroupOrders {
    classes: Arc<Classes>,
    /// `Err` holds the reason it can't be asked.
    which: Result<TailwindId, Vec<u8>>,
}

impl std::fmt::Debug for GroupOrders {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GroupOrders")
    }
}

/// All mutable state is behind a lock.
impl std::panic::RefUnwindSafe for GroupOrders {}

impl Orders for GroupOrders {
    fn has_tailwind(&self) -> bool {
        self.which.is_ok()
    }

    fn ranks_of(&self, classes: &[u8]) -> Option<Vec<Rank>> {
        let mut known = self.classes.known.lock();
        let which = match &self.which {
            Ok(which) => which,
            Err(why) => {
                if known.version_mismatch.as_ref().is_none_or(|it| why < it) {
                    known.version_mismatch = Some(why.clone());
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
    /// Stores the script's answers, which are in the same order as `asked`. Returns the error for each Tailwind that
    /// failed to load and still has unknown classes.
    fn store_answers(&mut self, asked: Vec<TailwindId>, answer: &Json) -> Vec<Vec<u8>> {
        let mut failures = Vec::new();
        let answers = (answer.get(b"groups").and_then(Json::as_array)).unwrap_or_default();
        for (which, answer) in asked.into_iter().zip(answers) {
            if let Some(error) = answer.get(b"error").and_then(Json::as_str) {
                // Drop the group, so it isn't asked again unless another file needs it.
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
        // Sorted, so the output doesn't depend on the order of the answers.
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

/// The source that turned sorting on.
#[derive(Clone, Copy)]
pub(crate) enum SetBy<'a> {
    /// `[fmt]` or the flag. Only `[fmt]` can have paths, and they're relative to this directory, which contains
    /// bunfig.toml.
    Bun(&'a [u8]),
    /// An oxfmt config in this directory. Paths are relative to it.
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

/// Returns `value`, which is `sortTailwindcss` as JSON, with its paths made absolute. Needed before merging it into a
/// value from another source, whose paths have a different base.
pub(crate) fn with_absolute_paths(value: &[u8], set_by: SetBy) -> Vec<u8> {
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

/// `prettier-plugin-tailwindcss` options and their names in `sortTailwindcss`: four strings, two string lists, two
/// booleans. [`plugin_option`] relies on that order.
const PLUGIN_OPTIONS: [(&[u8], &[u8]); 8] = [
    (b"tailwindConfig", b"config"),
    (b"tailwindStylesheet", b"stylesheet"),
    (b"tailwindEntryPoint", b"entryPoint"),
    (b"tailwindPackageName", b"packageName"),
    (b"tailwindFunctions", b"functions"),
    (b"tailwindAttributes", b"attributes"),
    (b"tailwindPreserveWhitespace", b"preserveWhitespace"),
    (b"tailwindPreserveDuplicates", b"preserveDuplicates"),
];

/// Converts the Prettier config option `name`, set to the JSON `value`, to a `sortTailwindcss` entry. `None` if it
/// isn't one of the plugin's options. `Err` is Prettier's message for a value of the wrong type.
pub(crate) fn plugin_option(name: &[u8], value: &[u8]) -> Option<Result<(Vec<u8>, Json), Vec<u8>>> {
    let at = PLUGIN_OPTIONS.iter().position(|it| it.0 == name)?;
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
        return Some(Ok((PLUGIN_OPTIONS[at].1.to_vec(), value)));
    }
    let mut message = [b"Invalid ", name, b" value. Expected ", expected].concat();
    message.extend_from_slice(b", but received ");
    super::config::write_as_shown(&mut message, &value);
    message.push(b'.');
    Some(Err(message))
}

/// Returns the plugin's warning about its options, given as `sortTailwindcss` `entries`.
pub(crate) fn plugin_warning(entries: &[(Vec<u8>, Json)]) -> Option<Vec<u8>> {
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

/// Resolves `sortTailwindcss` for a file in `directory`. `value` is the option as JSON, and it isn't `false`. `None` if
/// the package isn't installed, so classes aren't sorted. That isn't an error, because a shared config can turn the
/// option on for projects without Tailwind.
pub(crate) fn for_file(
    classes: &Arc<Classes>,
    value: &[u8],
    (set_by, directory): (SetBy, &[u8]),
) -> Option<Tailwind> {
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
        // The plugin treats an empty path as unset.
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
    // The plugin bundles versions 3 and 4, for projects without the package and for options meant for the other
    // version.
    let version_mismatch: Option<&[u8]> = match &found {
        Some(found) if found.is_version_4 && config.is_some() && stylesheet.is_none() => {
            Some(b"tailwindConfig is for Tailwind CSS 3")
        }
        Some(found) if !found.is_version_4 && stylesheet.is_some() => {
            Some(b"tailwindStylesheet is for Tailwind CSS 4")
        }
        _ => None,
    };
    let bundled = match follows_plugin && (found.is_none() || version_mismatch.is_some()) {
        true => find(PLUGIN),
        false => None,
    };
    let is_bundled = bundled.is_some();
    let which = match (bundled.or(found), version_mismatch) {
        (Some(found), Some(option)) if follows_plugin && !is_bundled => Err([
            option,
            b", and another version is in ",
            &found.root,
            b"\n  Run bun add -d prettier-plugin-tailwindcss, which brings its own",
        ]
        .concat()),
        (Some(found), _) => Ok(TailwindId {
            root: found.root,
            config: config.or_else(|| found.config.filter(|_| stylesheet.is_none())),
            stylesheet,
            is_bundled,
        }),
        (None, _) => {
            let mut known = classes.known.lock();
            if known.not_installed.as_deref().is_none_or(|it| package < it) {
                known.not_installed = Some(package.to_vec());
            }
            return None;
        }
    };
    Some(Tailwind {
        functions: Names::new(match (set_by, get(b"functions")) {
            (SetBy::Bun(_), None) => FUNCTIONS.map(<[u8]>::to_vec).to_vec(),
            _ => names(b"functions"),
        }),
        attributes: Names::new(names(b"attributes")),
        preserves_whitespace: is_on(b"preserveWhitespace"),
        preserves_duplicates: is_on(b"preserveDuplicates"),
        follows_plugin,
        oxc: Oxc::Absent,
        orders: Box::new(GroupOrders {
            classes: Arc::clone(classes),
            which,
        }),
        has_missed: AtomicBool::new(false),
    })
}

impl Classes {
    /// True if some files use the Tailwind bundled with the plugin.
    pub(crate) fn uses_bundled_tailwind(&self) -> bool {
        let known = self.known.lock();
        let mut found = known.by_directory.iter().filter(|it| it.1.is_some());
        found.any(|it| it.0.ends_with(PLUGIN))
    }

    /// The `--doctor` note that some files' classes aren't sorted.
    pub(crate) fn note(&self) -> Option<Vec<u8>> {
        let known = self.known.lock();
        let package = known.not_installed.as_deref()?;
        let has_some = known.by_directory.values().any(Option::is_some);
        let (in_some_directories, there): (&[u8], &[u8]) = match has_some {
            true => (b" in some directories", b" there"),
            false => (b"", b""),
        };
        let start = b"Tailwind CSS classes are not sorted";
        let why = b" is not installed";
        Some([start, in_some_directories, b" (", package, why, there, b")"].concat())
    }

    /// Asks Tailwind about the unknown classes. `Err` is the message to print when Tailwind can't be asked for some
    /// files. The answers for the other files are still stored.
    pub(crate) fn ask(&self, environment: &Environment) -> Result<(), Vec<u8>> {
        let fail = |why: &[u8]| [b"sortTailwindcss: ", why].concat();
        let mut known = self.known.lock();
        let version_mismatch = known.version_mismatch.as_deref().map(fail);
        if !known.groups.values().any(|it| !it.missing.is_empty()) {
            return version_mismatch.map_or(Ok(()), Err);
        }
        // Ranks are relative to all the classes in one request, so the known classes are sent again. Sorted, so the
        // request is the same on every machine.
        let mut asked: Vec<TailwindId> = known.groups.keys().cloned().collect();
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
        let failures: Vec<Vec<u8>> = (version_mismatch.into_iter())
            .chain(
                known
                    .store_answers(asked, &answer)
                    .iter()
                    .map(|it| fail(it)),
            )
            .collect();
        match failures.is_empty() {
            true => Ok(()),
            false => Err(failures.join(&b"\n"[..])),
        }
    }
}

/// Removes `sortTailwindcss` from `options` if oxfmt doesn't sort classes in files of this `kind`. The Prettier plugin
/// also sorts in LWC and MDX.
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
