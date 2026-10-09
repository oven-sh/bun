//! oxfmt's `sortTailwindcss` and `prettier-plugin-tailwindcss`: where the order of classes comes from.
//!
//! Only the Tailwind CSS of the project knows it, and that is JavaScript. The formatter asks for the order of each list of
//! classes that it comes across. A file with a class that is not known yet is put aside. When all files have had their
//! turn, one script answers for all those classes, and the files that were put aside are formatted again.
//!
//! What has been found out is kept next to the packages, for as long as Tailwind and what it has loaded stay the same. So
//! most runs start no script.

use super::files::Kind;
use crate::evaluate::{evaluate_at, kept_at};
use crate::run::{Environment, Fatal};
use crate::{fs, paths};
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::tailwind::{Names, Orders, Rank, Tailwind};
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

const SCRIPT: &str = concat!(
    include_str!("../evaluate-track.js"),
    include_str!("tailwind.js")
);

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

    fn of(answer: &Json) -> Option<Which> {
        let path = |key: &[u8]| answer.get(key).and_then(Json::as_str).map(<[u8]>::to_vec);
        Some(Which {
            root: path(b"root")?,
            config: path(b"config"),
            stylesheet: path(b"stylesheet"),
        })
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
    let root = paths::ancestors(directory)
        .map(|it| paths::join(it, b"node_modules/tailwindcss"))
        .find(|it| fs::is_file(&paths::join(it, b"package.json")))?;
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

/// The classes in files for which the same Tailwind is asked.
#[derive(Default)]
struct Group {
    /// The ranks are among all of them.
    known: FxHashMap<Vec<u8>, Rank>,
    /// Asked for, and not known.
    missing: Vec<Vec<u8>>,
    /// Known to an earlier run, before something that Tailwind has loaded changed.
    stale: Vec<Vec<u8>>,
}

#[derive(Default)]
struct Known {
    is_loaded: bool,
    by_directory: FxHashMap<Vec<u8>, Option<Found>>,
    groups: FxHashMap<Which, Group>,
    /// A directory with files that have classes, from which there is no Tailwind to be found.
    without_package: Option<Vec<u8>>,
    /// It is the plugin of Prettier that sorts.
    follows_plugin: bool,
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
                known.without_package = Some(directory.clone());
                return None;
            }
        };
        if !known.groups.contains_key(which) {
            known.groups.insert(which.clone(), Group::default());
        }
        let group = known.groups.get_mut(which)?;
        let (mut ranks, mut is_known) = (Vec::new(), true);
        for class in strings::split(classes, b" ") {
            match group.known.get(class) {
                _ if class.is_empty() => ranks.push(None),
                Some(&rank) => ranks.push(rank),
                None => {
                    group.missing.push(class.to_vec());
                    is_known = false;
                }
            }
        }
        is_known.then_some(ranks)
    }
}

/// Where what is asked and what is answered is kept: next to the packages, of which Tailwind is one.
fn files(environment: &Environment) -> Option<[Vec<u8>; 2]> {
    let has_packages = |directory: &&[u8]| {
        fs::kind(&paths::join(directory, b"node_modules")) == Some(fs::Kind::Directory)
    };
    let root = paths::ancestors(&environment.cwd).find(has_packages)?;
    let file =
        |name: &[u8]| paths::join(&paths::join(root, b"node_modules/.cache/bun-format"), name);
    Some([file(b"tailwind-classes.json"), file(b"tailwind-order.json")])
}

impl Known {
    /// Takes in what the script has answered. Returns what it says about a Tailwind that cannot be asked, if there are
    /// classes that it has to be asked about.
    fn take_in(&mut self, answer: &Json) -> Option<Vec<u8>> {
        let mut failure = None;
        for answer in (answer.get(b"groups").and_then(Json::as_array)).unwrap_or_default() {
            let Some(which) = Which::of(answer) else {
                continue;
            };
            if let Some(error) = answer.get(b"error").and_then(Json::as_str) {
                // It is not asked again, unless there are files for it.
                let group = self.groups.remove(&which);
                if group.is_some_and(|it| !it.missing.is_empty()) {
                    failure = Some(error.to_vec());
                }
                continue;
            }
            let group = self.groups.entry(which).or_default();
            group.missing.clear();
            group.stale.clear();
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
        failure
    }

    /// Takes in what an earlier run has asked, the answer to which is of no use any more. It is asked again together with
    /// the next class that is not known.
    fn take_in_question(&mut self, question: &Json) {
        for group in (question.get(b"groups").and_then(Json::as_array)).unwrap_or_default() {
            if let Some(which) = Which::of(group) {
                let classes = (group.get(b"classes").and_then(Json::as_array)).unwrap_or_default();
                self.groups.entry(which).or_default().stale = (classes.iter())
                    .filter_map(|it| it.as_str().map(<[u8]>::to_vec))
                    .collect();
            }
        }
    }
}

/// `sortTailwindcss` for the file at `path`. `value`: the option as JSON, which is not `false`. `base`: the directory that its
/// paths are relative to.
pub(crate) fn for_file(
    classes: &Arc<Classes>,
    environment: &Environment,
    value: &[u8],
    (base, path): (&[u8], &[u8]),
) -> Tailwind {
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
    let directory = paths::dirname(path);
    let mut known = classes.known.lock();
    // What earlier runs have found out.
    if !std::mem::replace(&mut known.is_loaded, true)
        && let Some([question, kept]) = files(environment)
    {
        if let Some(answer) = kept_at(environment, SCRIPT, &kept) {
            known.take_in(&answer);
        } else if let Some(question) =
            (fs::read(&question).ok()).and_then(|text| bun_lint::json::parse(&text))
        {
            known.take_in_question(&question);
        }
    }
    if !known.by_directory.contains_key(directory) {
        known
            .by_directory
            .insert(directory.to_vec(), find(directory));
    }
    let found = known.by_directory.get(directory).cloned().flatten();
    known.follows_plugin = is_on(b"followsPlugin");
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
        follows_plugin: is_on(b"followsPlugin"),
        orders: Box::new(OfGroup {
            classes: Arc::clone(classes),
            which: which.ok_or_else(|| directory.to_vec()),
        }),
        has_missed: AtomicBool::new(false),
    }
}

/// The options of `prettier-plugin-tailwindcss`, as JSON in the shape of `sortTailwindcss`.
pub(crate) fn options_of_plugin(settings: &[(&[u8], &[u8])]) -> Result<Vec<u8>, Fatal> {
    let mut entries = vec![(b"followsPlugin".to_vec(), Json::Bool(true))];
    for &(name, value) in settings {
        let text = || Json::String(value.to_vec());
        let list = || bun_lint::json::parse(value).unwrap_or(Json::Null);
        let (key, value): (&[u8], Json) = match name {
            b"tailwindConfig" => (b"config", text()),
            b"tailwindStylesheet" => (b"stylesheet", text()),
            b"tailwindEntryPoint" => (b"entryPoint", text()),
            b"tailwindFunctions" => (b"functions", list()),
            b"tailwindAttributes" => (b"attributes", list()),
            b"tailwindPreserveWhitespace" => (b"preserveWhitespace", Json::Bool(value == b"true")),
            b"tailwindPreserveDuplicates" => (b"preserveDuplicates", Json::Bool(value == b"true")),
            b"tailwindPackageName" if value != b"tailwindcss" => {
                let text = b"prettier-plugin-tailwindcss: tailwindPackageName is not supported.";
                return Err(Fatal(text.to_vec()));
            }
            _ => continue,
        };
        entries.retain(|it| it.0 != key);
        entries.push((key.to_vec(), value));
    }
    let mut text = Vec::new();
    write_json(&mut text, &Json::Object(entries));
    Ok(text)
}

impl Classes {
    /// What sorts, for a message.
    pub(crate) fn name(&self) -> &'static str {
        match self.known.lock().follows_plugin {
            true => "prettier-plugin-tailwindcss",
            false => "sortTailwindcss",
        }
    }

    /// Asks Tailwind about the classes that are not known. `Err`: for the user.
    pub(crate) fn ask(&self, environment: &Environment) -> Result<(), Vec<u8>> {
        let name = self.name().as_bytes();
        let fail = |why: &[u8]| [name, b": ", why].concat();
        let mut known = self.known.lock();
        let (None, Some([question, kept])) = (&known.without_package, files(environment)) else {
            let directory = known.without_package.as_deref();
            return Err(fail(
                &[
                    &b"It needs the package tailwindcss, which cannot be found from "[..],
                    directory.unwrap_or(&environment.cwd),
                    b". Install it.",
                ]
                .concat(),
            ));
        };
        // The ranks are among all classes that are asked about, so those that are known are asked about again.
        let groups = known.groups.iter().map(|(which, group)| {
            let mut classes: Vec<&[u8]> = (group.known.keys())
                .chain(&group.missing)
                .chain(&group.stale)
                .map(|it| &it[..])
                .collect();
            classes.sort_unstable();
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
        fs::write_new_atomically(&question, &text).map_err(|error| fail(&fs::describe(&error)))?;
        let answer = evaluate_at(environment, SCRIPT, &question, Some(kept))
            .map_err(|Fatal(error)| error)?;
        match known.take_in(&answer) {
            Some(error) => Err(fail(&error)),
            None => Ok(()),
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
