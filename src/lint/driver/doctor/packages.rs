//! Which packages of the tool that is replaced can go. A package is only said to be removable if its name has the form of
//! tooling for that tool, and if nothing that is looked at uses it: the configuration, the scripts and `lint-staged` of
//! `package.json`, and the packages that stay.

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

/// What can use a package and is not looked at.
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

/// Whether a package called `name` is there for ESLint or oxlint and for nothing else. `vite-plugin-eslint` is there for Vite.
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
    /// Rules of it run in JavaScript.
    Rules,
    /// It lints or formats files.
    Files,
    /// The configuration file, which is shown as this, cannot be read without it.
    Configuration(Vec<u8>),
    /// There is no configuration file: that the project depends on it says whose defaults apply.
    Defaults,
    /// The script of `package.json` that is called this runs it.
    Script(Vec<u8>),
    /// A command of `lint-staged` in `package.json` runs it.
    LintStaged,
    /// This package, which stays, depends on it.
    Dependent(Vec<u8>),
}

impl Need {
    fn key(&self) -> &'static [u8] {
        match self {
            Need::Rules => b"rules",
            Need::Files => b"files",
            Need::Configuration(_) => b"config",
            Need::Defaults => b"defaults",
            Need::Script(_) => b"script",
            Need::LintStaged => b"lint_staged",
            Need::Dependent(_) => b"dependent",
        }
    }

    /// The file, the script or the package that needs it.
    fn by(&self) -> Option<&[u8]> {
        match self {
            Need::Configuration(by) | Need::Script(by) | Need::Dependent(by) => Some(by),
            Need::Rules | Need::Files | Need::Defaults | Need::LintStaged => None,
        }
    }

    /// Behind the names of `count` packages.
    fn shown(&self, count: usize) -> String {
        let (it, its) = if count == 1 {
            ("it", "its")
        } else {
            ("them", "their")
        };
        match self {
            Need::Rules => format!("{its} rules run in JavaScript"),
            Need::Files => format!("some files go to {it}"),
            Need::Configuration(file) => format!("{} loads {it}", BStr::new(file)),
            Need::Defaults => format!("{its} defaults apply while package.json has {it}"),
            Need::Script(script) => format!("the \"{}\" script runs {it}", BStr::new(script)),
            Need::LintStaged => format!("lint-staged runs {it}"),
            Need::Dependent(package) => format!("{} needs {it}", BStr::new(package)),
        }
    }
}

/// The keys of the objects that `json` has as `sections`.
fn names_in(json: &Json, sections: &[&[u8]]) -> Vec<Vec<u8>> {
    let objects = sections.iter().filter_map(|it| json.get(it)?.as_object());
    sorted(objects.flatten().map(|it| it.0.clone()).collect())
}

/// Whether a word of `command`, a line for a shell, is `name`, or a path to it.
fn runs(command: &[u8], name: &[u8]) -> bool {
    strings::tokenize_any(command, b" \t\n;&|()\"'")
        .any(|word| word == name || paths::basename(word) == name)
}

/// What of `manifest`, a `package.json`, runs the command `name`.
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

/// What becomes of the packages that `package.json` depends on.
#[derive(Default)]
pub(crate) struct Packages {
    removable: Vec<Vec<u8>>,
    needed: Vec<(Vec<u8>, Need)>,
}

impl Packages {
    /// Of the `package.json` nearest to `cwd`. `is_of_a_tool`: whether a package is there for the tool that is replaced and for
    /// nothing else. `need`: why a run needs a package.
    pub(crate) fn new(
        cwd: &[u8],
        is_of_a_tool: impl Fn(&[u8]) -> bool,
        need: impl Fn(&[u8]) -> Option<Need>,
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
        // What stays keeps what it depends on, which keeps what that depends on.
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
