//! Works out which of the replaced tool's packages can be uninstalled. A package is only called removable if its name
//! follows that tool's naming scheme and nothing we check uses it. We check the config, the `scripts` and `lint-staged`
//! sections of `package.json`, and the packages that stay.

use super::{sorted, texts};
use crate::configs::installed_package;
use crate::print_config::{object, text};
use crate::{fs, paths};
use bstr::BStr;
use bun_core::strings;
use bun_lint::options::Json;
use std::io::Write;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// Places that can use a package but aren't checked.
const NOT_CHECKED: [&str; 3] = ["other tools' configs", "CI files", "Git hooks"];

/// Whether `name` is `family-..`, `@scope/family` or `@scope/family-..`.
fn is_of_family(name: &[u8], family: &[u8]) -> bool {
    let (is_scoped, own) = match (name.first(), strings::index_of_char_usize(name, b'/')) {
        (Some(b'@'), Some(slash)) => (true, &name[slash + 1..]),
        _ => (false, name),
    };
    match own.strip_prefix(family) {
        Some(b"") => is_scoped,
        Some(rest) => rest.starts_with(b"-"),
        None => false,
    }
}

/// Whether the package `name` only exists to serve ESLint or oxlint. `vite-plugin-eslint` doesn't, because it serves Vite.
pub(crate) fn is_for_linting(name: &[u8]) -> bool {
    let families: [&[u8]; 3] = [
        b"eslint-plugin",
        b"eslint-config",
        b"eslint-import-resolver",
    ];
    matches!(
        name,
        b"eslint" | b"oxlint" | b"oxlint-tsgolint" | b"typescript-eslint"
    ) || name.starts_with(b"@eslint/")
        || name.starts_with(b"@typescript-eslint/")
        || families.iter().any(|it| is_of_family(name, it))
}

/// The same for Prettier and oxfmt.
pub(crate) fn is_for_formatting(name: &[u8]) -> bool {
    let families: [&[u8]; 2] = [b"prettier-plugin", b"prettier-config"];
    matches!(name, b"prettier" | b"oxfmt")
        || name.starts_with(b"@prettier/plugin-")
        || families.iter().any(|it| is_of_family(name, it))
}

/// Why a package has to stay installed.
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum Need {
    /// Some of its rules run in JavaScript.
    Rules,
    /// It lints or formats files.
    Files,
    /// `bun fmt` skips files because of a plugin it doesn't have. Until that changes, only the old tool formats them.
    SkippedFiles,
    /// The config file can't be loaded without it. Holds the file's name as shown to the user.
    Configuration(Vec<u8>),
    /// There's no config file, so having this dependency is what picks whose defaults apply.
    Defaults,
    /// The `package.json` script with this name runs it.
    Script(Vec<u8>),
    /// A `lint-staged` command in `package.json` runs it.
    LintStaged,
    /// This package depends on it and is staying.
    Dependent(Vec<u8>),
}

impl Need {
    fn key(&self) -> &'static [u8] {
        match self {
            Need::Rules => b"rules",
            Need::Files => b"files",
            Need::SkippedFiles => b"skipped_files",
            Need::Configuration(_) => b"config",
            Need::Defaults => b"defaults",
            Need::Script(_) => b"script",
            Need::LintStaged => b"lint_staged",
            Need::Dependent(_) => b"dependent",
        }
    }

    /// The file, script or package that needs it.
    fn by(&self) -> Option<&[u8]> {
        match self {
            Need::Configuration(by) | Need::Script(by) | Need::Dependent(by) => Some(by),
            Need::Rules | Need::Files | Need::SkippedFiles | Need::Defaults | Need::LintStaged => {
                None
            }
        }
    }

    /// The reason printed after the names of `count` packages.
    fn shown(&self, count: usize) -> String {
        let (it, its) = if count == 1 {
            ("it", "its")
        } else {
            ("them", "their")
        };
        match self {
            Need::Rules => format!("{its} rules run in JavaScript"),
            Need::Files => format!("some files go to {it}"),
            Need::SkippedFiles => format!("the skipped files need {it}"),
            Need::Configuration(file) => format!("{} loads {it}", BStr::new(file)),
            Need::Defaults => format!("{its} defaults apply while package.json has {it}"),
            Need::Script(script) => format!("the \"{}\" script runs {it}", BStr::new(script)),
            Need::LintStaged => format!("lint-staged runs {it}"),
            Need::Dependent(package) => format!("{} needs {it}", BStr::new(package)),
        }
    }
}

/// Sorted keys of the objects at `json[section]`, for each of `sections`.
fn names_in(json: &Json, sections: &[&[u8]]) -> Vec<Vec<u8>> {
    let objects = sections.iter().filter_map(|it| json.get(it)?.as_object());
    sorted(objects.flatten().map(|it| it.0.clone()).collect())
}

/// Whether any word of the shell command `command` is `name` or a path ending in `name`.
fn runs(command: &[u8], name: &[u8]) -> bool {
    strings::tokenize_any(command, b" \t\n;&|()\"'")
        .any(|word| word == name || paths::basename(word) == name)
}

/// Finds the part of `manifest` (a parsed `package.json`) that runs the command `name`.
fn run_by(manifest: &Json, name: &[u8]) -> Option<Need> {
    let entries = |key: &[u8]| {
        manifest
            .get(key)
            .and_then(Json::as_object)
            .unwrap_or_default()
    };
    let is_run_by = |commands: &Json| match commands {
        Json::Array(all) => all.iter().filter_map(Json::as_str).any(|it| runs(it, name)),
        one => one.as_str().is_some_and(|it| runs(it, name)),
    };
    if let Some((script, _)) = entries(b"scripts").iter().find(|it| is_run_by(&it.1)) {
        return Some(Need::Script(script.clone()));
    }
    (entries(b"lint-staged").iter())
        .any(|it| is_run_by(&it.1))
        .then_some(Need::LintStaged)
}

/// The verdict on `package.json`'s dependencies: which can be removed, and which are still needed and why.
#[derive(Default)]
pub(crate) struct Packages {
    removable: Vec<Vec<u8>>,
    needed: Vec<(Vec<u8>, Need)>,
}

impl Packages {
    /// Reads the `package.json` closest to `cwd`. `is_of_a_tool` says whether a package only exists to serve the replaced
    /// tool. `need` says why a run still needs a package, if it does.
    #[optimize(size)]
    pub(crate) fn new(
        cwd: &[u8],
        is_of_a_tool: &dyn Fn(&[u8]) -> bool,
        need: &dyn Fn(&[u8]) -> Option<Need>,
    ) -> Packages {
        let mut packages = Packages::default();
        let read = |it: &[u8]| fs::read(&paths::join(it, b"package.json")).ok();
        let nearest = paths::ancestors(cwd).find_map(|it| Some((it, read(it)?)));
        let Some((directory, Some(manifest))) =
            nearest.map(|it| (it.0, bun_lint::json::parse(&it.1)))
        else {
            return packages;
        };
        let mut staying = Vec::new();
        for name in names_in(&manifest, &[b"dependencies", b"devDependencies"]) {
            let is_of_a_tool = is_of_a_tool(&name);
            let used = || run_by(&manifest, &name).filter(|_| is_of_a_tool);
            match need(&name).or_else(used) {
                Some(need) => packages.needed.push((name.clone(), need)),
                None if is_of_a_tool => {
                    packages.removable.push(name);
                    continue;
                }
                None => {}
            }
            staying.push(name);
        }
        // A package that stays keeps its own dependencies installed, and so on down the tree.
        while let Some(stays) = staying.pop().filter(|_| !packages.removable.is_empty()) {
            let Some(installed) = installed_package(directory, &stays) else {
                continue;
            };
            let uses = names_in(&installed, &[b"dependencies", b"peerDependencies"]);
            let (kept, removable) = std::mem::take(&mut packages.removable)
                .into_iter()
                .partition(|it| uses.contains(it));
            packages.removable = removable;
            let kept: Vec<Vec<u8>> = kept;
            for name in kept {
                let need = Need::Dependent(stays.clone());
                packages.needed.push((name.clone(), need));
                staying.push(name);
            }
        }
        bun_lint::utils::sort::sort_by(&mut packages.needed, |a, b| a.0.cmp(&b.0));
        packages
    }

    #[optimize(size)]
    pub(crate) fn json(&self) -> Json {
        let needed = self.needed.iter().map(|(name, need)| {
            object(vec![
                (b"name", text(name)),
                (b"reason", text(need.key())),
                (b"by", need.by().map_or(Json::Null, text)),
            ])
        });
        let not_checked = NOT_CHECKED.iter().map(|it| text(it.as_bytes()));
        object(vec![
            (b"removable", texts(&self.removable)),
            (b"needed", Json::Array(needed.collect())),
            (b"not_checked", Json::Array(not_checked.collect())),
        ])
    }

    #[optimize(size)]
    pub(crate) fn write(&self, out: &mut Vec<u8>, colors: bool) {
        if self.removable.is_empty() && self.needed.is_empty() {
            return;
        }
        out.push(b'\n');
        if !self.removable.is_empty() {
            let names = self.removable.join(&b", "[..]);
            pretty!(
                out,
                colors,
                "<green>You can remove:<r> {}\n",
                BStr::new(&names)
            );
        }
        let mut groups: Vec<(&Need, Vec<&[u8]>)> = Vec::new();
        for (name, need) in &self.needed {
            match groups.iter_mut().find(|it| it.0 == need) {
                Some(group) => group.1.push(name),
                None => groups.push((need, vec![name])),
            }
        }
        for (at, (need, names)) in groups.iter().enumerate() {
            let label = if at == 0 {
                "Still needed:  "
            } else {
                "               "
            };
            pretty!(
                out,
                colors,
                "{} {} <d>({})<r>\n",
                label,
                BStr::new(&names.join(&b", "[..])),
                need.shown(names.len())
            );
        }
        if !self.removable.is_empty() {
            pretty!(
                out,
                colors,
                "<d>Not checked:    {}<r>\n",
                NOT_CHECKED.join(", ")
            );
        }
    }
}
