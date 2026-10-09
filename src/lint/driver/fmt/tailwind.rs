//! oxfmt's `sortTailwindcss`: where the order of classes comes from.
//!
//! Only the Tailwind CSS of the project knows it, and that is JavaScript. The formatter asks for the order of each list of
//! classes that it comes across. A file with a list that is not known yet is put aside. When all files have had their
//! turn, one script answers for all those lists, and the files that were put aside are formatted again.

use super::files::Kind;
use crate::evaluate::evaluate;
use crate::run::{Environment, Fatal};
use crate::{fs, paths};
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::tailwind::{Orders, Rank, Tailwind};
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

/// Which Tailwind is asked: the one that is found from `directory`, with these options, which are paths.
#[derive(Clone, PartialEq, Eq, Hash)]
struct Which {
    directory: Vec<u8>,
    config: Option<Vec<u8>>,
    stylesheet: Option<Vec<u8>>,
}

impl Which {
    fn entries(&self) -> Vec<(Vec<u8>, Json)> {
        let path = |path: &Option<Vec<u8>>| path.clone().map_or(Json::Null, Json::String);
        vec![
            (b"directory".to_vec(), Json::String(self.directory.clone())),
            (b"config".to_vec(), path(&self.config)),
            (b"stylesheet".to_vec(), path(&self.stylesheet)),
        ]
    }

    fn is(&self, answer: &Json) -> bool {
        (self.entries().iter()).all(|(name, value)| answer.get(name) == Some(value))
    }
}

/// The lists of classes in files for which the same Tailwind is asked.
#[derive(Default)]
struct Group {
    known: FxHashMap<Vec<u8>, Vec<Rank>>,
    /// Asked for, and not known.
    missing: Vec<Vec<u8>>,
}

/// What a run knows about the order of classes.
#[derive(Default)]
pub(crate) struct Classes {
    groups: Guarded<FxHashMap<Which, Group>>,
}

/// [`Classes`], for the files for which `which` is asked.
struct OfGroup {
    classes: Arc<Classes>,
    which: Which,
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
        let mut groups = self.classes.groups.lock();
        if !groups.contains_key(&self.which) {
            groups.insert(self.which.clone(), Group::default());
        }
        let group = groups.get_mut(&self.which)?;
        let known = group.known.get(classes).cloned();
        if known.is_none() {
            group.missing.push(classes.to_vec());
        }
        known
    }
}

/// `value`: `sortTailwindcss` as JSON, which is not `false`. `base`: the directory that its paths are relative to. `path`: the
/// file that is formatted.
pub(crate) fn for_file(classes: &Arc<Classes>, value: &[u8], base: &[u8], path: &[u8]) -> Tailwind {
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
    Tailwind {
        functions: names(b"functions"),
        attributes: names(b"attributes"),
        preserves_whitespace: is_on(b"preserveWhitespace"),
        preserves_duplicates: is_on(b"preserveDuplicates"),
        orders: Box::new(OfGroup {
            classes: Arc::clone(classes),
            which: Which {
                directory: paths::dirname(path).to_vec(),
                config: path_at(b"config"),
                stylesheet: path_at(b"stylesheet"),
            },
        }),
        has_missed: AtomicBool::new(false),
    }
}

/// Takes `sortTailwindcss` from `options`, which are for `text`, if that is in a language in which classes are not sorted
/// yet. Returns whether it may have some.
pub(crate) fn only_where_supported(
    options: &mut FormatOptions,
    kind: Option<Kind>,
    text: &[u8],
) -> bool {
    if options.tailwind.is_none() || matches!(kind, None | Some(Kind::Script)) {
        return false;
    }
    options.tailwind = None;
    match kind {
        Some(Kind::Css(_)) => strings::contains(text, b"@apply"),
        Some(Kind::Html(_) | Kind::Handlebars | Kind::Markdown) => {
            strings::contains(text, b"class")
        }
        _ => false,
    }
}

impl Classes {
    /// Asks Tailwind about the lists that are not known. `Err`: for the user.
    pub(crate) fn ask(&self, environment: &Environment) -> Result<(), Vec<u8>> {
        let mut groups = self.groups.lock();
        let mut questions = Vec::new();
        for (which, group) in groups.iter_mut() {
            group.missing.sort_unstable();
            group.missing.dedup();
            if group.missing.is_empty() {
                continue;
            }
            let lists = std::mem::take(&mut group.missing);
            let mut entries = which.entries();
            entries.push((
                b"lists".to_vec(),
                Json::Array(lists.into_iter().map(Json::String).collect()),
            ));
            questions.push(Json::Object(entries));
        }
        let mut question = Vec::new();
        write_json(
            &mut question,
            &Json::Object(vec![(b"groups".to_vec(), Json::Array(questions))]),
        );
        // Next to the packages, of which Tailwind is one.
        let has_packages = |directory: &&[u8]| {
            fs::kind(&paths::join(directory, b"node_modules")) == Some(fs::Kind::Directory)
        };
        let fail = |why: &[u8]| [&b"sortTailwindcss: "[..], why].concat();
        let Some(root) = paths::ancestors(&environment.cwd).find(has_packages) else {
            return Err(fail(
                b"It needs the package tailwindcss, and there is no node_modules. Install it.",
            ));
        };
        let file = paths::join(root, b"node_modules/.cache/bun-format/tailwind.json");
        fs::write_new_atomically(&file, &question).map_err(|error| fail(&fs::describe(&error)))?;
        let answer = evaluate(environment, SCRIPT, &file, false).map_err(|Fatal(error)| error)?;
        for answer in (answer.get(b"groups").and_then(Json::as_array)).unwrap_or_default() {
            if let Some(error) = answer.get(b"error").and_then(Json::as_str) {
                return Err(fail(error));
            }
            let Some((_, group)) = groups.iter_mut().find(|(which, _)| which.is(answer)) else {
                continue;
            };
            for (list, ranks) in
                (answer.get(b"ranks").and_then(Json::as_object)).unwrap_or_default()
            {
                let rank = |it: &Json| match it {
                    Json::Number(rank) => Some(*rank as u32),
                    _ => None,
                };
                let ranks = ranks.as_array().unwrap_or_default();
                group
                    .known
                    .insert(list.clone(), ranks.iter().map(rank).collect());
            }
        }
        Ok(())
    }
}
