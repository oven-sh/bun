//! Sorts the keys of a `package.json` the way `prettier-plugin-packagejson` does.
//!
//! The plugin runs the npm package [`sort-package-json`](https://github.com/keithamus/sort-package-json) (MIT license, Keith
//! Cirkel) on the text before Prettier formats it. This is a port of version 3.7.1 of that package, which is what version 3.0.2
//! of the plugin installs.
//!
//! The package parses the text with `JSON.parse` and writes it back with `JSON.stringify`, so this also does what that round
//! trip does to numbers, duplicate keys and numeric keys.
//!
//! It differs where the package drops a key or throws:
//! - `__proto__` is an ordinary key here. The package drops it.
//! - With `npm-run-all` in `devDependencies`, the package throws if a script isn't a string. It also throws for
//!   `"devDependencies": null`.
//! - In `pnpm.overrides`, it throws when it compares `a@b` with `a@c` and `b` or `c` isn't a valid version range. Here those keys
//!   come after the valid ones.

use crate::{fs, paths};
use bun_collections::index_sort::{apply_permutation, sort_vec_by};
use bun_core::{handle_oom, strings};
use bun_lint::linter::{json_parse_or_place, write_json};
use bun_lint::options::Json;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_semver::range::Op;
use bun_semver::{SlicedString, Version, query};
use std::cmp::Ordering;

type Entries = Vec<(Vec<u8>, Json)>;

/// The plugin's settings for a file.
#[derive(Default)]
pub(crate) struct Sort {
    /// `packageSortOrder`: these keys come before all others.
    pub(crate) first: Vec<Vec<u8>>,
    /// [`has_files_of_yarn_or_pnpm`]
    pub(crate) has_files_of_yarn_or_pnpm: bool,
}

/// `hasYarnOrPnpmFiles`
pub(crate) fn has_files_of_yarn_or_pnpm(cwd: &[u8]) -> bool {
    let kind = |name: &[u8]| fs::kind(&paths::join(cwd, name));
    let files: [&[u8]; 4] = [
        b"yarn.lock",
        b".yarnrc.yml",
        b"pnpm-lock.yaml",
        b"pnpm-workspace.yaml",
    ];
    files.iter().any(|it| kind(it).is_some()) || kind(b".yarn") == Some(fs::Kind::Directory)
}

/// What to do with the value of a key.
#[derive(Copy, Clone)]
enum Over {
    Nothing,
    /// `uniq`
    Unique,
    /// `uniqAndSortArray`
    UniqueSorted,
    /// `sortObjectBy(keys)`: these keys first, then the others by name. Then `overProperty` for each of the properties.
    Keys(&'static [&'static str], Properties),
    /// `overProperty` for each.
    In(Properties),
    /// `sortObjectBy(keys, true)`: nested objects too.
    Deep(&'static [&'static str]),
    /// `sortObjectBy(sortObjectByIdent, true)`
    DeepByPackage,
    /// `onArray((all) => all.map(over))`
    Each(&'static Over),
    /// Sort the keys by name, and do this with every value.
    Values(&'static Over),
    Dependencies,
    Scripts,
    Exports,
    EslintConfig,
    EslintRules,
    PrettierConfig,
    PnpmConfig,
    PnpmOverrides,
}

type Properties = &'static [(&'static str, Over)];

const KEPT: Over = Over::Nothing;
const SORTED: Over = Over::Keys(&[], &[]);
const URL: Over = Over::Keys(&["type", "url"], &[]);
const PERSON: Over = Over::Keys(&["name", "email", "url"], &[]);
const BINARY: Over = Over::Keys(
    &[
        "module_name",
        "module_path",
        "remote_path",
        "package_name",
        "host",
    ],
    &[],
);
const WORKSPACES: Over = Over::Keys(
    &["packages", "catalog"],
    &[
        ("packages", Over::UniqueSorted),
        ("catalog", Over::Dependencies),
    ],
);
const DEV_ENGINES: Over = Over::In(&[(
    "packageManager",
    Over::Keys(&["name", "version", "onFail"], &[]),
)]);
const WIREIT_SCRIPT: Over = Over::Keys(
    &["command", "dependencies", "files", "output"],
    &[
        (
            "dependencies",
            Over::Each(&Over::Keys(&["script", "cascade"], &[])),
        ),
        (
            "env",
            Over::Values(&Over::Keys(&["external", "default"], &[])),
        ),
        (
            "service",
            Over::Keys(&["readyWhen"], &[("readyWhen", SORTED)]),
        ),
    ],
);
/// The package `git-hooks-list` 4.2.1.
const GIT_HOOKS: Over = Over::Keys(
    &[
        "applypatch-msg",
        "pre-applypatch",
        "post-applypatch",
        "pre-commit",
        "pre-merge-commit",
        "prepare-commit-msg",
        "commit-msg",
        "post-commit",
        "pre-rebase",
        "post-checkout",
        "post-merge",
        "pre-push",
        "pre-receive",
        "update",
        "proc-receive",
        "post-receive",
        "post-update",
        "reference-transaction",
        "push-to-checkout",
        "pre-auto-gc",
        "post-rewrite",
        "sendemail-validate",
        "fsmonitor-watchman",
        "p4-changelist",
        "p4-prepare-changelist",
        "p4-post-changelist",
        "p4-pre-submit",
        "post-index-change",
    ],
    &[],
);
const ESLINT_KEYS: &[&str] = &[
    "files",
    "excludedFiles",
    "env",
    "parser",
    "parserOptions",
    "settings",
    "plugins",
    "extends",
    "rules",
    "overrides",
    "globals",
    "processor",
    "noInlineConfig",
    "reportUnusedDisableDirectives",
];
const ESLINT_PROPERTIES: Properties = &[
    ("env", SORTED),
    ("globals", SORTED),
    ("overrides", Over::Each(&Over::EslintConfig)),
    ("parserOptions", SORTED),
    ("rules", Over::EslintRules),
    ("settings", SORTED),
];
const OVERRIDES_OF_PRETTIER: Properties = &[(
    "overrides",
    Over::Each(&Over::Keys(&[], &[("options", SORTED)])),
)];
const PNPM_KEYS: &[&str] = &[
    "peerDependencyRules",
    "neverBuiltDependencies",
    "onlyBuiltDependencies",
    "onlyBuiltDependenciesFile",
    "allowedDeprecatedVersions",
    "allowNonAppliedPatches",
    "updateConfig",
    "auditConfig",
    "requiredScripts",
    "supportedArchitectures",
    "overrides",
    "patchedDependencies",
    "packageExtensions",
];

/// The known keys, in order.
const FIELDS: Properties = &[
    ("$schema", KEPT),
    ("name", KEPT),
    ("displayName", KEPT),
    ("version", KEPT),
    ("stableVersion", KEPT),
    ("private", KEPT),
    ("description", KEPT),
    ("categories", Over::Unique),
    ("keywords", Over::Unique),
    ("homepage", KEPT),
    ("bugs", Over::Keys(&["url", "email"], &[])),
    ("repository", URL),
    ("funding", URL),
    ("license", URL),
    ("qna", KEPT),
    ("author", PERSON),
    ("maintainers", Over::Each(&PERSON)),
    ("contributors", Over::Each(&PERSON)),
    ("publisher", KEPT),
    ("sideEffects", KEPT),
    ("type", KEPT),
    ("imports", KEPT),
    ("exports", Over::Exports),
    ("main", KEPT),
    ("svelte", KEPT),
    ("umd:main", KEPT),
    ("jsdelivr", KEPT),
    ("unpkg", KEPT),
    ("module", KEPT),
    ("source", KEPT),
    ("jsnext:main", KEPT),
    ("browser", KEPT),
    ("react-native", KEPT),
    ("types", KEPT),
    ("typesVersions", KEPT),
    ("typings", KEPT),
    ("style", KEPT),
    ("example", KEPT),
    ("examplestyle", KEPT),
    ("assets", KEPT),
    ("bin", SORTED),
    ("man", KEPT),
    (
        "directories",
        Over::Keys(&["lib", "bin", "man", "doc", "example", "test"], &[]),
    ),
    ("files", Over::Unique),
    ("workspaces", WORKSPACES),
    ("binary", BINARY),
    ("scripts", Over::Scripts),
    ("betterScripts", Over::Scripts),
    ("wireit", Over::Values(&WIREIT_SCRIPT)),
    ("l10n", KEPT),
    ("contributes", SORTED),
    ("activationEvents", Over::Unique),
    ("husky", Over::In(&[("hooks", GIT_HOOKS)])),
    ("simple-git-hooks", GIT_HOOKS),
    ("pre-commit", KEPT),
    ("commitlint", SORTED),
    ("lint-staged", KEPT),
    ("nano-staged", KEPT),
    ("config", SORTED),
    ("nodemonConfig", SORTED),
    ("browserify", SORTED),
    ("babel", SORTED),
    ("browserslist", KEPT),
    ("xo", SORTED),
    ("prettier", Over::PrettierConfig),
    ("eslintConfig", Over::EslintConfig),
    ("eslintIgnore", KEPT),
    ("npmpkgjsonlint", SORTED),
    ("npmPackageJsonLintConfig", SORTED),
    ("npmpackagejsonlint", SORTED),
    ("release", SORTED),
    ("remarkConfig", SORTED),
    ("stylelint", KEPT),
    ("ava", SORTED),
    ("jest", SORTED),
    ("jest-junit", SORTED),
    ("jest-stare", SORTED),
    ("mocha", SORTED),
    ("nyc", SORTED),
    ("c8", SORTED),
    ("tap", SORTED),
    ("oclif", Over::Deep(&[])),
    ("resolutions", SORTED),
    ("overrides", Over::Dependencies),
    ("dependencies", Over::Dependencies),
    ("devDependencies", Over::Dependencies),
    ("dependenciesMeta", Over::DeepByPackage),
    ("peerDependencies", Over::Dependencies),
    ("peerDependenciesMeta", Over::Deep(&[])),
    ("optionalDependencies", Over::Dependencies),
    ("bundledDependencies", Over::UniqueSorted),
    ("bundleDependencies", Over::UniqueSorted),
    ("extensionPack", Over::UniqueSorted),
    ("extensionDependencies", Over::UniqueSorted),
    ("flat", KEPT),
    ("packageManager", KEPT),
    ("engines", SORTED),
    ("engineStrict", SORTED),
    ("devEngines", DEV_ENGINES),
    ("volta", Over::Keys(&["node", "npm", "yarn"], &[])),
    ("languageName", KEPT),
    ("os", KEPT),
    ("cpu", KEPT),
    ("preferGlobal", SORTED),
    ("publishConfig", SORTED),
    ("icon", KEPT),
    (
        "badges",
        Over::Each(&Over::Keys(&["description", "url", "href"], &[])),
    ),
    ("galleryBanner", SORTED),
    ("preview", KEPT),
    ("markdown", KEPT),
    ("pnpm", Over::PnpmConfig),
];

/// `defaultNpmScripts`
const SCRIPTS_OF_NPM: [&[u8]; 11] = [
    b"install",
    b"pack",
    b"prepare",
    b"publish",
    b"restart",
    b"shrinkwrap",
    b"start",
    b"stop",
    b"test",
    b"uninstall",
    b"version",
];

// ───────────────────────────── JavaScript objects ─────────────────────────────

/// `key` as a number, if JavaScript treats it as an array index.
fn array_index(key: &[u8]) -> Option<u32> {
    let is_canonical = key.len() <= 10
        && matches!(key, [b'0'] | [b'1'..=b'9', ..])
        && key.iter().all(u8::is_ascii_digit);
    let index = is_canonical.then(|| bun_core::fmt::parse_decimal::<u32>(key))??;
    (index < u32::MAX).then_some(index)
}

/// A JavaScript object lists its array-index keys first, in numeric order, no matter when they were added.
fn put_indices_first(entries: &mut Entries) {
    if entries.iter().any(|it| array_index(&it.0).is_some()) {
        let rank = |key: &[u8]| array_index(key).map_or((true, 0), |index| (false, index));
        sort_vec_by(entries, |a, b| rank(&a.0).cmp(&rank(&b.0)));
    }
}

/// `sortObjectKeys(object, compare)`
fn sort_by(entries: &mut Entries, mut compare: impl FnMut(&[u8], &[u8]) -> Ordering) {
    sort_vec_by(entries, |a, b| compare(&a.0, &b.0));
    put_indices_first(entries);
}

/// `sortObjectKeys(object, first)`
fn sort_keys(entries: &mut Entries, first: &[&str]) {
    let rank = |key: &[u8]| first.iter().position(|it| it.as_bytes() == key);
    let rank = |key: &[u8]| rank(key).unwrap_or(first.len());
    sort_by(entries, |a, b| {
        rank(a)
            .cmp(&rank(b))
            .then_with(|| strings::order_utf16(a, b))
    });
}

/// `uniq`. Returns whether all `items` are strings. An array with anything else in it is left alone.
fn keep_first_of_each(items: &mut Vec<Json>) -> bool {
    if !items.iter().all(|it| it.as_str().is_some()) {
        return false;
    }
    let is_first: Vec<bool> = {
        let mut seen = FxHashSet::default();
        let strings = items.iter().map(|it| it.as_str().unwrap_or_default());
        strings.map(|it| seen.insert(it)).collect()
    };
    let mut is_first = is_first.into_iter();
    items.retain(|_| is_first.next().unwrap_or(true));
    true
}

// ───────────────────────────── dependencies ─────────────────────────────

/// `shouldSortDependenciesLikeNpm`: npm sorts names with `localeCompare`, Yarn and pnpm by code unit.
fn sorts_dependencies_like_npm(package: &Json, how: &Sort) -> bool {
    fn truthy(value: Option<&Json>) -> Option<&Json> {
        value.filter(|it| it.is_truthy())
    }
    if let Some(manager) = package.get(b"packageManager").and_then(Json::as_str) {
        return manager.starts_with(b"npm@");
    }
    let engine = package
        .get(b"devEngines")
        .and_then(|it| it.get(b"packageManager"));
    if let Some(name) = truthy(engine.and_then(|it| it.get(b"name"))) {
        return name.as_str() == Some(&b"npm"[..]);
    }
    if truthy(package.get(b"pnpm")).is_some() {
        return false;
    }
    truthy(package.get(b"engines").and_then(|it| it.get(b"npm"))).is_some()
        || !how.has_files_of_yarn_or_pnpm
}

/// `getPackageName`
fn package_name(ident: &[u8]) -> &[u8] {
    let from = usize::from(ident.starts_with(b"@"));
    match strings::index_of_char_usize(&ident[from..], b'@') {
        Some(at) => &ident[..from + at],
        None => ident,
    }
}

/// A version, and the text that its prerelease tag points into.
struct Lowest {
    text: Vec<u8>,
    version: Version,
}

impl Lowest {
    fn parse(text: Vec<u8>) -> Option<Lowest> {
        let parsed = Version::parse_utf8(&text);
        let version = parsed.version.min();
        parsed.valid.then_some(Lowest { text, version })
    }

    fn order(&self, other: &Lowest) -> Ordering {
        (self.version).order_without_build(other.version, &self.text, &other.text)
    }
}

/// `semver.minVersion(range)`. `None` where that throws or returns `null`.
fn min_version(range: &[u8]) -> Option<Lowest> {
    let words = strings::split_any(range, b" \t\n\r\x0B\x0C").filter(|it| !it.is_empty());
    let raw = words.collect::<Vec<_>>().join(&b" "[..]);
    let group = handle_oom(query::parse(&raw, SlicedString::init(&raw, &raw)));
    if group.has_skipped() {
        return None;
    }
    let satisfies = |it: &Lowest| group.satisfies(it.version, &raw, &it.text);
    let zero = [&b"0.0.0"[..], b"0.0.0-0"].into_iter();
    if let Some(zero) = zero
        .filter_map(|it| Lowest::parse(it.to_vec()))
        .find(satisfies)
    {
        return Some(zero);
    }
    let mut lowest: Option<Lowest> = None;
    let mut alternative = Some(&group.head);
    while let Some(all) = alternative {
        // A version that satisfies all comparators is at least the highest of their lower bounds.
        let mut highest: Option<Lowest> = None;
        let mut next = Some(&all.head);
        while let Some(it) = next {
            for comparator in [it.range.left, it.range.right] {
                if !matches!(comparator.op, Op::Eql | Op::Gte | Op::Gt) {
                    continue;
                }
                let (version, is_above) = (comparator.version, comparator.op == Op::Gt);
                let prerelease = version.tag.pre.slice(&raw);
                let patch = match is_above && prerelease.is_empty() {
                    true => version.patch.saturating_add(1),
                    false => version.patch,
                };
                let mut text = format!("{}.{}.{patch}", version.major, version.minor).into_bytes();
                if !prerelease.is_empty() {
                    text.push(b'-');
                    text.extend_from_slice(prerelease);
                    text.extend_from_slice(if is_above { &b".0"[..] } else { b"" });
                }
                let end = Lowest::parse(text)?;
                if highest.as_ref().is_none_or(|it| end.order(it).is_gt()) {
                    highest = Some(end);
                }
            }
            next = it.next.as_deref();
        }
        if let Some(highest) = highest
            && lowest.as_ref().is_none_or(|it| it.order(&highest).is_gt())
        {
            lowest = Some(highest);
        }
        alternative = all.next.as_deref();
    }
    lowest.filter(satisfies)
}

/// `sortObjectBySemver`, for `pnpm.overrides`: `a@1>b` comes before `a@2`.
///
/// The package ignores everything after the first `>`, so to it `a@>=1` has no range, like `a`. When it compares two such keys, it
/// always says that the first argument is smaller. V8's sort always passes the later element first, so they end up reversed.
fn sort_by_version(entries: &mut Entries) {
    /// `parseNameAndVersionRange`, with the lowest version of the range.
    struct Selector {
        name: Vec<u8>,
        /// 0: no range. 1: a valid range. 2: an invalid one.
        rank: u8,
        lowest: Option<Lowest>,
        /// Its index in `entries`.
        place: usize,
    }
    let selector = |place: usize, key: &[u8]| {
        let end = strings::index_of_char_usize(key, b'>').unwrap_or(key.len());
        let (name, range) = match strings::last_index_of_char(&key[..end], b'@') {
            None | Some(0) => (key, &b""[..]),
            Some(at) => (&key[..at], &key[at + 1..end]),
        };
        let lowest = (!range.is_empty()).then(|| min_version(range)).flatten();
        Selector {
            name: name.to_vec(),
            rank: match (range.is_empty(), &lowest) {
                (true, _) => 0,
                (false, Some(_)) => 1,
                (false, None) => 2,
            },
            lowest,
            place,
        }
    };
    let mut selected: Vec<(Selector, (Vec<u8>, Json))> = (entries.drain(..).enumerate())
        .map(|(place, entry)| (selector(place, &entry.0), entry))
        .collect();
    sort_vec_by(&mut selected, |(a, _), (b, _)| {
        let by_version = || match (&a.lowest, &b.lowest) {
            (Some(a), Some(b)) => a.order(b),
            _ if a.rank == 0 => b.place.cmp(&a.place),
            _ => Ordering::Equal,
        };
        strings::locale_compare(&a.name, &b.name)
            .then(a.rank.cmp(&b.rank))
            .then_with(by_version)
    });
    entries.extend(selected.into_iter().map(|it| it.1));
    put_indices_first(entries);
}

// ───────────────────────────── scripts ─────────────────────────────

/// `runSRegExp.test(line)`, for text without line breaks:
/// `/(?<=^|[\s&;<>|(])(?:run-s|npm-run-all2? .*(?:--sequential|--serial|-s))(?=$|[\s&;<>|)])/`
fn runs_in_sequence(line: &[u8]) -> bool {
    let starts_at = |at: &usize| {
        let before = &line[..*at];
        matches!(
            before.last(),
            None | Some(b'&' | b';' | b'<' | b'>' | b'|' | b'(')
        ) || strings::js_whitespace_len_back(before) > 0
    };
    let ends_at = |at: usize| {
        let after = &line[at..];
        matches!(
            after.first(),
            None | Some(b'&' | b';' | b'<' | b'>' | b'|' | b')')
        ) || strings::js_whitespace_len(after) > 0
    };
    // The offsets of `word` in `line`, starting at `from`.
    let places = |word: &'static [u8], mut from: usize| {
        std::iter::from_fn(move || {
            let at = from + strings::index_of(line.get(from..)?, word)?;
            from = at + 1;
            Some(at)
        })
    };
    if (places(b"run-s", 0).filter(starts_at)).any(|at| ends_at(at + b"run-s".len())) {
        return true;
    }
    // The first match has the most text after it.
    let arguments = places(b"npm-run-all", 0).filter(starts_at).find_map(|at| {
        let rest = &line[at + b"npm-run-all".len()..];
        let rest = rest.strip_prefix(b"2").unwrap_or(rest);
        rest.starts_with(b" ").then(|| line.len() - rest.len() + 1)
    });
    arguments.is_some_and(|from| {
        [&b"--sequential"[..], b"--serial", b"-s"]
            .into_iter()
            .any(|flag| places(flag, from).any(|at| ends_at(at + flag.len())))
    })
}

/// `hasSequentialScript`: some script runs others in the order they're written in, like `run-s build:*`.
fn has_sequential_script(package: &Json) -> bool {
    let dependencies = package.get(b"devDependencies");
    let depends_on = |name: &[u8]| dependencies.is_some_and(|it| it.get(name).is_some());
    if !depends_on(b"npm-run-all") && !depends_on(b"npm-run-all2") {
        return false;
    }
    let is_sequential = |command: &Json| {
        command.as_str().is_some_and(|it| {
            strings::contains_char(it, b'*') && strings::js_lines(it).any(runs_in_sequence)
        })
    };
    [&b"scripts"[..], b"betterScripts"]
        .into_iter()
        .any(|field| {
            let scripts = package.get(field);
            let in_object = scripts.and_then(Json::as_object).unwrap_or_default();
            let in_array = scripts.and_then(Json::as_array).unwrap_or_default();
            in_object.iter().any(|it| is_sequential(&it.1)) || in_array.iter().any(is_sequential)
        })
}

/// The order of `sortScriptNames`: `a:b` is in the group `a`, which comes before `a-b`.
fn order_of_script_names(a: &[u8], b: &[u8]) -> Ordering {
    // Where the group's name ends, and where the rest starts after the colon.
    let split = |name: &'_ [u8]| match strings::index_of_char_usize(name, b':') {
        None | Some(0) => (name.len(), None),
        Some(at) => (at, Some(at + 1)),
    };
    let (mut a, mut b) = (a, b);
    loop {
        let ((end_of_a, rest_of_a), (end_of_b, rest_of_b)) = (split(a), split(b));
        let order = strings::order_utf16(&a[..end_of_a], &b[..end_of_b]);
        match (order, rest_of_a, rest_of_b) {
            (Ordering::Equal, Some(rest_of_a), Some(rest_of_b)) => {
                (a, b) = (&a[rest_of_a..], &b[rest_of_b..]);
            }
            (Ordering::Equal, ..) => return rest_of_a.is_some().cmp(&rest_of_b.is_some()),
            _ => return order,
        }
    }
}

/// `sortScripts`: by name, with `prea` and `posta` around `a`. `keeps_order`: see [`has_sequential_script`].
fn sort_scripts(scripts: &mut Entries, keeps_order: bool) {
    let mut places: FxHashMap<&[u8], u32> = FxHashMap::default();
    for (at, (name, _)) in scripts.iter().enumerate() {
        places.insert(name, at as u32);
    }
    let mut prefixable: FxHashSet<&[u8]> = FxHashSet::default();
    let mut names: Vec<&[u8]> = (scripts.iter())
        .map(|(name, _)| {
            let omitted = name
                .strip_prefix(b"pre")
                .or_else(|| name.strip_prefix(b"post"));
            let omitted = omitted.unwrap_or(name);
            if SCRIPTS_OF_NPM.contains(&omitted) || places.contains_key(omitted) {
                prefixable.insert(omitted);
                return omitted;
            }
            &name[..]
        })
        .collect();
    if !keeps_order {
        sort_vec_by(&mut names, |a, b| order_of_script_names(a, b));
    }
    let mut order: Vec<u32> = Vec::with_capacity(scripts.len());
    let mut is_placed = vec![false; scripts.len()];
    let mut place = |name: &[u8]| {
        if let Some(&at) = places.get(name)
            && !std::mem::replace(&mut is_placed[at as usize], true)
        {
            order.push(at);
        }
    };
    for name in names {
        if prefixable.contains(name) {
            place(&[&b"pre"[..], name].concat());
            place(name);
            place(&[&b"post"[..], name].concat());
        } else {
            place(name);
        }
    }
    // Every script is `name`, `pre` + `name` or `post` + `name` of one of `names`.
    if order.len() == scripts.len() {
        apply_permutation(scripts, &order);
    }
    put_indices_first(scripts);
}

// ───────────────────────────── the rest ─────────────────────────────

/// One level of `sortExports`: paths first, then conditions, with `default` last.
fn sort_exports(entries: &mut Entries) {
    let rank = |key: &[u8]| match key {
        [b'.', ..] => 0,
        b"default" => 2,
        _ => 1,
    };
    sort_by(entries, |a, b| rank(a).cmp(&rank(b)));
}

/// Sorts the top-level keys: `first`, then the known keys, then the others by name, with those that start with `_` last.
fn sort_fields(entries: &mut Entries, first: &[Vec<u8>]) {
    let mut ranks: FxHashMap<&[u8], usize> = FxHashMap::default();
    let known = FIELDS.iter().map(|it| it.0.as_bytes());
    for (rank, name) in first.iter().map(|it| &it[..]).chain(known).enumerate() {
        ranks.entry(name).or_insert(rank);
    }
    let rank = |key: &[u8]| {
        let known = ranks.get(key).copied().unwrap_or(usize::MAX);
        (known, key.starts_with(b"_"))
    };
    sort_by(entries, |a, b| {
        rank(a)
            .cmp(&rank(b))
            .then_with(|| strings::order_utf16(a, b))
    });
}

/// What sorting a field needs to know about the rest of the document.
struct Facts {
    sorts_dependencies_like_npm: bool,
    has_sequential_script: bool,
}

/// Applies `over` to `value`. Nested values wait in a list, so deep nesting costs heap and not stack.
fn apply(value: &mut Json, over: Over, facts: &Facts) {
    let mut pending = vec![(value, over)];
    while let Some((value, over)) = pending.pop() {
        let entries = match value {
            Json::Array(items) => {
                match over {
                    Over::Unique => _ = keep_first_of_each(items),
                    Over::UniqueSorted if keep_first_of_each(items) => {
                        sort_vec_by(items, |a, b| {
                            let (a, b) = (
                                a.as_str().unwrap_or_default(),
                                b.as_str().unwrap_or_default(),
                            );
                            strings::order_utf16(a, b)
                        })
                    }
                    Over::Each(over) => pending.extend(items.iter_mut().map(|it| (it, *over))),
                    _ => {}
                }
                continue;
            }
            Json::Object(entries) => entries,
            _ => continue,
        };
        let mut properties: Properties = &[];
        // For the values of the other keys.
        let mut inner = Over::Nothing;
        match over {
            Over::Nothing | Over::Unique | Over::UniqueSorted | Over::Each(_) => {}
            Over::In(all) => properties = all,
            Over::Keys(first, all) => {
                sort_keys(entries, first);
                properties = all;
            }
            Over::EslintConfig => {
                sort_keys(entries, ESLINT_KEYS);
                properties = ESLINT_PROPERTIES;
            }
            Over::Deep(first) => {
                sort_keys(entries, first);
                inner = over;
            }
            Over::DeepByPackage => {
                sort_by(entries, |a, b| {
                    strings::order_utf16(package_name(a), package_name(b))
                });
                inner = over;
            }
            Over::Values(over) => {
                sort_keys(entries, &[]);
                inner = *over;
            }
            Over::Dependencies if entries.len() < 2 => {}
            Over::Dependencies if facts.sorts_dependencies_like_npm => {
                sort_by(entries, strings::locale_compare);
            }
            Over::Dependencies => sort_keys(entries, &[]),
            Over::Scripts => sort_scripts(entries, facts.has_sequential_script),
            Over::Exports => {
                sort_exports(entries);
                inner = over;
            }
            Over::EslintRules => sort_by(entries, |a, b| {
                let parts = |rule: &[u8]| strings::count_char(rule, b'/');
                (parts(a).cmp(&parts(b))).then_with(|| strings::locale_compare(a, b))
            }),
            Over::PrettierConfig => {
                sort_by(entries, |a, b| {
                    let is_last = |key: &[u8]| key == b"overrides";
                    (is_last(a).cmp(&is_last(b))).then_with(|| strings::order_utf16(a, b))
                });
                properties = OVERRIDES_OF_PRETTIER;
            }
            Over::PnpmConfig => {
                sort_keys(entries, PNPM_KEYS);
                properties = &[("overrides", Over::PnpmOverrides)];
                inner = Over::Deep(PNPM_KEYS);
            }
            Over::PnpmOverrides => {
                sort_keys(entries, PNPM_KEYS);
                sort_by_version(entries);
                inner = Over::Deep(PNPM_KEYS);
            }
        }
        for (key, value) in entries.iter_mut() {
            let of_key = properties.iter().find(|it| it.0.as_bytes() == &key[..]);
            match of_key.map_or(inner, |it| it.1) {
                Over::Nothing => {}
                over => pending.push((value, over)),
            }
        }
    }
}

/// `sortPackageJson(text, { sortOrder })`: the text that the plugin hands to Prettier, but on one line. `Err`: `JSON.parse` rejects
/// `text`. It has the error message and the byte offset of the error, not counting a byte order mark.
pub(crate) fn sorted(text: &[u8], how: &Sort) -> Result<Vec<u8>, (Vec<u8>, u32)> {
    let body = strings::without_utf8_bom(text);
    let mut package = json_parse_or_place(body).map_err(|(message, at)| (message, at as u32))?;
    let mut pending = vec![&mut package];
    while let Some(value) = pending.pop() {
        match value {
            Json::Array(items) => pending.extend(items.iter_mut()),
            Json::Object(entries) => {
                put_indices_first(entries);
                pending.extend(entries.iter_mut().map(|it| &mut it.1));
            }
            _ => {}
        }
    }
    let facts = Facts {
        sorts_dependencies_like_npm: sorts_dependencies_like_npm(&package, how),
        has_sequential_script: has_sequential_script(&package),
    };
    if let Json::Object(entries) = &mut package {
        sort_fields(entries, &how.first);
    }
    apply(&mut package, Over::In(FIELDS), &facts);
    let mut out = Vec::with_capacity(text.len());
    out.extend_from_slice(&text[..text.len() - body.len()]);
    write_json(&mut out, &package);
    // `endOfLine: "auto"` goes by the first line break in the text.
    out.extend_from_slice(match strings::index_of_char_usize(body, b'\r') {
        Some(at) if body.get(at + 1) == Some(&b'\n') => b"\r\n",
        Some(_) => b"\r",
        None => b"\n",
    });
    Ok(out)
}
