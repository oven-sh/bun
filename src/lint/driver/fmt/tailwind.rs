//! oxfmt's `sortTailwindcss`: where the order of classes comes from.
//!
//! Only the Tailwind CSS of the project knows it, and that is JavaScript. The formatter asks for the order of each list of
//! classes that it comes across. A file with a class that is not known yet is put aside. When all files have had their
//! turn, one script answers for all those classes, and the files that were put aside are formatted again.

use super::files::Kind;
use crate::evaluate::evaluate_input;
use crate::run::Environment;
use crate::{fs, paths};
use bun_core::printer::json_stringify_alloc;
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::tailwind::{Names, Orders, Rank, Tailwind};
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

const SCRIPT: crate::run::Source = &[crate::evaluate::START, include_str!("tailwind.js")];

/// Which Tailwind is asked: the package in the directory `root`, loaded with one of these files.
#[derive(Clone, PartialEq, Eq, Hash)]
struct Which {
    root: Vec<u8>,
    config: Option<Vec<u8>>,
    stylesheet: Option<Vec<u8>>,
}

impl Which {
    fn entries(&self) -> Vec<(Vec<u8>, Json)> {
        let path = |path: &Option<Vec<u8>>| path.clone().map_or(Json::Null, Json::String);
        vec![
            (b"root".to_vec(), Json::String(self.root.clone())),
            (b"config".to_vec(), path(&self.config)),
            (b"stylesheet".to_vec(), path(&self.stylesheet)),
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
    /// For Tailwind CSS 3: the nearest `tailwind.config.*`.
    config: Option<Vec<u8>>,
}

fn find(directory: &[u8]) -> Option<Found> {
    // Only another package of the workspace may depend on it. pnpm and Bun's isolated linker still have one place for all
    // packages of an installation.
    let places: [&[u8]; 3] = [
        b"node_modules/tailwindcss",
        b"node_modules/.pnpm/node_modules/tailwindcss",
        b"node_modules/.bun/node_modules/tailwindcss",
    ];
    let root = places.iter().find_map(|place| {
        paths::ancestors(directory)
            .map(|it| paths::join(it, place))
            .find(|it| fs::is_file(&paths::join(it, b"package.json")))
    })?;
    let names: [&[u8]; 4] = [
        b"tailwind.config.js",
        b"tailwind.config.cjs",
        b"tailwind.config.mjs",
        b"tailwind.config.ts",
    ];
    let config = match fs::is_file(&paths::join(&root, b"theme.css")) {
        true => None,
        false => paths::ancestors(directory)
            .flat_map(|it| names.map(|name| paths::join(it, name)))
            .find(|it| fs::is_file(it)),
    };
    Some(Found { root, config })
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
    match bun_lint::json::parse(&json_stringify_alloc(class)) {
        Some(Json::String(key)) => Cow::Owned(key),
        _ => Cow::Borrowed(class),
    }
}

#[derive(Default)]
struct Known {
    by_directory: FxHashMap<Vec<u8>, Option<Found>>,
    groups: FxHashMap<Which, Group>,
    /// The first, in the order of their names, of the directories with files that have classes from which there is no
    /// Tailwind to be found.
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
    /// `Err`: the directory. There is no Tailwind for it.
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
    fn ranks_of(&self, classes: &[u8]) -> Option<Vec<Rank>> {
        let mut known = self.classes.known.lock();
        let which = match &self.which {
            Ok(which) => which,
            Err(directory) => {
                if known
                    .without_package
                    .as_ref()
                    .is_none_or(|it| directory < it)
                {
                    known.without_package = Some(directory.clone());
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

/// `sortTailwindcss` for the file at `path`. `value`: the option as JSON, which is not `false`. `of_config`: the directory of
/// the configuration file, if there is one.
pub(crate) fn for_file(
    classes: &Arc<Classes>,
    environment: &Environment,
    value: &[u8],
    (of_config, path): (Option<&[u8]>, &[u8]),
) -> Tailwind {
    let base = of_config.unwrap_or(&environment.cwd);
    // `true` has no keys.
    let json = bun_lint::json::parse(value);
    let get = |key: &[u8]| json.as_ref()?.get(key);
    let names = |key: &[u8]| -> Vec<Vec<u8>> {
        (get(key).and_then(Json::as_array).unwrap_or_default().iter())
            .filter_map(|it| it.as_str().map(<[u8]>::to_vec))
            .collect()
    };
    let path_at = |key: &[u8]| {
        let path = get(key)?.as_str()?;
        Some(paths::resolve(base, &paths::from_native(path)))
    };
    let is_on = |key: &[u8]| get(key).and_then(Json::as_bool) == Some(true);
    let mut known = classes.known.lock();
    let directory = paths::dirname(path);
    if !known.by_directory.contains_key(directory) {
        known
            .by_directory
            .insert(directory.to_vec(), find(directory));
    }
    let found = known.by_directory.get(directory).cloned().flatten();
    drop(known);
    // The plugin's `getTailwindConfig`.
    let (sheets, config): (Vec<_>, Vec<_>) =
        (path_at(b"config").into_iter()).partition(|it| it.ends_with(b".css"));
    let stylesheet = path_at(b"stylesheet")
        .or_else(|| path_at(b"entryPoint"))
        .or_else(|| sheets.into_iter().next());
    let config = config.into_iter().next();
    let which = found.map(|found| Which {
        root: found.root,
        config: config.or_else(|| found.config.filter(|_| stylesheet.is_none())),
        stylesheet,
    });
    Tailwind {
        functions: Names::new(names(b"functions")),
        attributes: Names::new(names(b"attributes")),
        preserves_whitespace: is_on(b"preserveWhitespace"),
        preserves_duplicates: is_on(b"preserveDuplicates"),
        orders: Box::new(OfGroup {
            classes: Arc::clone(classes),
            which: which.ok_or_else(|| directory.to_vec()),
        }),
        has_missed: AtomicBool::new(false),
    }
}

impl Classes {
    /// Whether the package has been looked for from the directory of `path`, in vain.
    pub(crate) fn has_no_package_for(&self, path: &[u8]) -> bool {
        let known = self.known.lock();
        matches!(known.by_directory.get(paths::dirname(path)), Some(None))
    }

    /// Asks Tailwind about the classes that are not known. `Err`: for the user: there are files for which it cannot be
    /// asked. What it says about the others is known all the same.
    pub(crate) fn ask(&self, environment: &Environment) -> Result<(), Vec<u8>> {
        let fail = |why: &[u8]| [b"sortTailwindcss: ", why].concat();
        let needs_package = |directory: &[u8]| {
            fail(
                &[
                    &b"the tailwindcss package was not found from "[..],
                    directory,
                    b"\n  Run bun add -d tailwindcss",
                ]
                .concat(),
            )
        };
        let mut known = self.known.lock();
        let without_package = known.without_package.as_deref().map(needs_package);
        if !known.groups.values().any(|it| !it.missing.is_empty()) {
            return without_package.map_or(Ok(()), Err);
        }
        // The ranks are among all classes that are asked about, so those that are known are asked about again.
        let asked: Vec<Which> = known.groups.keys().cloned().collect();
        let groups = known.groups.iter().map(|(which, group)| {
            let mut classes: Vec<&[u8]> = (group.known.keys())
                .chain(&group.missing)
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
        let answer = evaluate_input(environment, SCRIPT, &environment.cwd, &text)
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

/// Takes `sortTailwindcss` from `options`, which are for a file of this kind, if oxfmt does not sort in that language.
pub(crate) fn only_where_sorted(options: &mut FormatOptions, kind: Option<Kind>) {
    use bun_format::html::Parser;
    let is_sorted = matches!(
        kind,
        None | Some(
            Kind::Script
                | Kind::Css(_)
                | Kind::Markdown
                | Kind::Handlebars
                | Kind::Html(Parser::Html | Parser::Vue | Parser::Angular)
        )
    );
    if !is_sorted {
        options.tailwind = None;
    }
}
