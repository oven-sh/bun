//! `prettier-plugin-packagejson`'s order.
//!
//! The plugin runs the npm package [`sort-package-json`](https://github.com/keithamus/sort-package-json) (MIT license, Keith
//! Cirkel) on the text before Prettier formats it. This is a port of version 3.7.1 of that package, which is what version 3.0.2
//! of the plugin installs.
//!
//! The keys end up where the plugin puts them. Besides what the header of `sort_package_json.rs` lists, this differs where the
//! package drops a key or throws:
//! - `__proto__` is an ordinary key here. The package drops it.
//! - The package throws for text that isn't strict JSON, like a trailing comma.
//! - With `npm-run-all` in `devDependencies`, the package throws if a script isn't a string. It also throws for
//!   `"devDependencies": null`.
//! - In `pnpm.overrides`, it throws when it compares `a@b` with `a@c` and `b` or `c` isn't a valid version range. Here those keys
//!   come after the valid ones.
//! - With `rangeStart` or `rangeEnd`, Prettier looks for the offsets in the text that the package wrote. Here they're offsets in
//!   the file, and for this parser any range is the whole file.

use super::{
    AS_IS, Context, Document, Member, Over, Plugin, Properties, SORTED, sort_by, sort_keys,
};
use bun_collections::index_sort::{apply_permutation_in_place, identity};
use bun_core::{handle_oom, strings};
use bun_semver::range::Op;
use bun_semver::{SlicedString, Version, query};
use rustc_hash::{FxHashMap, FxHashSet};
use std::cmp::Ordering;

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
/// From the `git-hooks-list` package, version 4.2.1.
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
pub(super) const ESLINT_KEYS: &[&str] = &[
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
pub(super) const ESLINT_PROPERTIES: Properties = &[
    ("env", SORTED),
    ("globals", SORTED),
    ("overrides", Over::Each(&Over::EslintConfig)),
    ("parserOptions", SORTED),
    ("rules", Over::EslintRules),
    ("settings", SORTED),
];
pub(super) const PRETTIER_OVERRIDES: Properties = &[(
    "overrides",
    Over::Each(&Over::Keys(&[], &[("options", SORTED)])),
)];
pub(super) const PNPM_KEYS: &[&str] = &[
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
    ("$schema", AS_IS),
    ("name", AS_IS),
    ("displayName", AS_IS),
    ("version", AS_IS),
    ("stableVersion", AS_IS),
    ("private", AS_IS),
    ("description", AS_IS),
    ("categories", Over::Unique),
    ("keywords", Over::Unique),
    ("homepage", AS_IS),
    ("bugs", Over::Keys(&["url", "email"], &[])),
    ("repository", URL),
    ("funding", URL),
    ("license", URL),
    ("qna", AS_IS),
    ("author", PERSON),
    ("maintainers", Over::Each(&PERSON)),
    ("contributors", Over::Each(&PERSON)),
    ("publisher", AS_IS),
    ("sideEffects", AS_IS),
    ("type", AS_IS),
    ("imports", AS_IS),
    ("exports", Over::Exports),
    ("main", AS_IS),
    ("svelte", AS_IS),
    ("umd:main", AS_IS),
    ("jsdelivr", AS_IS),
    ("unpkg", AS_IS),
    ("module", AS_IS),
    ("source", AS_IS),
    ("jsnext:main", AS_IS),
    ("browser", AS_IS),
    ("react-native", AS_IS),
    ("types", AS_IS),
    ("typesVersions", AS_IS),
    ("typings", AS_IS),
    ("style", AS_IS),
    ("example", AS_IS),
    ("examplestyle", AS_IS),
    ("assets", AS_IS),
    ("bin", SORTED),
    ("man", AS_IS),
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
    ("l10n", AS_IS),
    ("contributes", SORTED),
    ("activationEvents", Over::Unique),
    ("husky", Over::In(&[("hooks", GIT_HOOKS)])),
    ("simple-git-hooks", GIT_HOOKS),
    ("pre-commit", AS_IS),
    ("commitlint", SORTED),
    ("lint-staged", AS_IS),
    ("nano-staged", AS_IS),
    ("config", SORTED),
    ("nodemonConfig", SORTED),
    ("browserify", SORTED),
    ("babel", SORTED),
    ("browserslist", AS_IS),
    ("xo", SORTED),
    ("prettier", Over::PrettierConfig),
    ("eslintConfig", Over::EslintConfig),
    ("eslintIgnore", AS_IS),
    ("npmpkgjsonlint", SORTED),
    ("npmPackageJsonLintConfig", SORTED),
    ("npmpackagejsonlint", SORTED),
    ("release", SORTED),
    ("remarkConfig", SORTED),
    ("stylelint", AS_IS),
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
    ("dependenciesMeta", Over::DependenciesMeta),
    ("peerDependencies", Over::Dependencies),
    ("peerDependenciesMeta", Over::Deep(&[])),
    ("optionalDependencies", Over::Dependencies),
    ("bundledDependencies", Over::UniqueSorted),
    ("bundleDependencies", Over::UniqueSorted),
    ("extensionPack", Over::UniqueSorted),
    ("extensionDependencies", Over::UniqueSorted),
    ("flat", AS_IS),
    ("packageManager", AS_IS),
    ("engines", SORTED),
    ("engineStrict", SORTED),
    ("devEngines", DEV_ENGINES),
    ("volta", Over::Keys(&["node", "npm", "yarn"], &[])),
    ("languageName", AS_IS),
    ("os", AS_IS),
    ("cpu", AS_IS),
    ("preferGlobal", SORTED),
    ("publishConfig", SORTED),
    ("icon", AS_IS),
    (
        "badges",
        Over::Each(&Over::Keys(&["description", "url", "href"], &[])),
    ),
    ("galleryBanner", SORTED),
    ("preview", AS_IS),
    ("markdown", AS_IS),
    ("pnpm", Over::PnpmConfig),
];

/// `defaultNpmScripts`
const NPM_SCRIPTS: [&[u8]; 11] = [
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

pub(super) fn context<'a>(document: Document<'a>, plugin: &'a Plugin) -> Context<'a> {
    Context {
        document,
        fields: FIELDS,
        first: &plugin.first,
        // How `Array.prototype.sort` compares strings.
        by_name: strings::order_utf16,
        sorts_scripts: false,
        sorts_dependencies_like_npm: sorts_dependencies_like_npm(document, plugin),
        has_sequential_script: has_sequential_script(document),
    }
}

// ───────────────────────────── dependencies ─────────────────────────────

/// `shouldSortDependenciesLikeNpm`: npm sorts names with `localeCompare`, Yarn and pnpm by code unit.
fn sorts_dependencies_like_npm(document: Document<'_>, plugin: &Plugin) -> bool {
    let truthy = |value: Option<u32>| value.filter(|&it| document.is_truthy(it));
    if let Some(manager) = document
        .get(0, b"packageManager")
        .and_then(|it| document.string(it))
    {
        return manager.starts_with(b"npm@");
    }
    let engine = document
        .get(0, b"devEngines")
        .and_then(|it| document.get(it, b"packageManager"));
    if let Some(name) = truthy(engine.and_then(|it| document.get(it, b"name"))) {
        return document.string(name).is_some_and(|it| *it == *b"npm");
    }
    if truthy(document.get(0, b"pnpm")).is_some() {
        return false;
    }
    truthy(
        document
            .get(0, b"engines")
            .and_then(|it| document.get(it, b"npm")),
    )
    .is_some()
        || !plugin.has_yarn_or_pnpm_files
}

/// `sortDependencies`
pub(super) fn sort_dependencies(members: &mut [Member<'_>], context: &Context<'_>) {
    match context.sorts_dependencies_like_npm {
        true => sort_by(members, strings::locale_compare),
        false => sort_keys(members, &[], context),
    }
}

/// `sortObjectByIdent`: `a@1` is the package `a`.
pub(super) fn sort_by_package_name(members: &mut [Member<'_>]) {
    fn package_name(ident: &[u8]) -> &[u8] {
        let from = usize::from(ident.starts_with(b"@"));
        match strings::index_of_char_usize(&ident[from..], b'@') {
            Some(at) => &ident[..from + at],
            None => ident,
        }
    }
    sort_by(members, |a, b| {
        strings::order_utf16(package_name(a), package_name(b))
    });
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

/// `sortObjectBySemver`, for `pnpm.overrides`: `a@1>b` comes before `a@2`. `members` are sorted by name.
///
/// The package ignores everything after the first `>`, so to it `a@>=1` has no range, like `a`. When it compares two
/// such keys, it always reports the first argument as smaller. V8's sort always passes the later element first, so they
/// end up reversed.
pub(super) fn sort_by_version(members: &mut [Member<'_>]) {
    /// `parseNameAndVersionRange`, with the lowest version of the range.
    struct Selector<'k> {
        name: &'k [u8],
        /// 0: no range. 1: a valid range. 2: an invalid one.
        rank: u8,
        lowest: Option<Lowest>,
        /// The index of the first member that has this key.
        first_index: usize,
    }
    let mut selectors: Vec<Selector<'_>> = Vec::with_capacity(members.len());
    for (index, member) in members.iter().enumerate() {
        let key = &member.key[..];
        let end = strings::index_of_char_usize(key, b'>').unwrap_or(key.len());
        let (name, range) = match strings::last_index_of_char(&key[..end], b'@') {
            None | Some(0) => (key, &b""[..]),
            Some(at) => (&key[..at], &key[at + 1..end]),
        };
        let lowest = (!range.is_empty()).then(|| min_version(range)).flatten();
        let rank = match (range.is_empty(), &lowest) {
            (true, _) => 0,
            (false, Some(_)) => 1,
            (false, None) => 2,
        };
        let previous = index.checked_sub(1).and_then(|it| members.get(it));
        let first_index = match (previous, selectors.last()) {
            (Some(previous), Some(selector)) if previous.key == member.key => selector.first_index,
            _ => index,
        };
        selectors.push(Selector {
            name,
            rank,
            lowest,
            first_index,
        });
    }
    let mut order = identity(members.len());
    crate::sort::sort_by(&mut order, |&a, &b| {
        let (Some(a), Some(b)) = (selectors.get(a as usize), selectors.get(b as usize)) else {
            return Ordering::Equal;
        };
        let by_version = || match (&a.lowest, &b.lowest) {
            (Some(a), Some(b)) => a.order(b),
            _ if a.rank == 0 => b.first_index.cmp(&a.first_index),
            _ => Ordering::Equal,
        };
        strings::locale_compare(a.name, b.name)
            .then(a.rank.cmp(&b.rank))
            .then_with(by_version)
    });
    drop(selectors);
    apply_permutation_in_place(members, &mut order);
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
    let occurrences = |word: &'static [u8], mut from: usize| {
        std::iter::from_fn(move || {
            let at = from + strings::index_of(line.get(from..)?, word)?;
            from = at + 1;
            Some(at)
        })
    };
    if (occurrences(b"run-s", 0).filter(starts_at)).any(|at| ends_at(at + b"run-s".len())) {
        return true;
    }
    // The first match has the most text after it.
    let arguments = occurrences(b"npm-run-all", 0)
        .filter(starts_at)
        .find_map(|at| {
            let rest = &line[at + b"npm-run-all".len()..];
            let rest = rest.strip_prefix(b"2").unwrap_or(rest);
            rest.starts_with(b" ").then(|| line.len() - rest.len() + 1)
        });
    arguments.is_some_and(|from| {
        [&b"--sequential"[..], b"--serial", b"-s"]
            .into_iter()
            .any(|flag| occurrences(flag, from).any(|at| ends_at(at + flag.len())))
    })
}

/// `hasSequentialScript`: some script runs others in source order, like `run-s build:*`.
fn has_sequential_script(document: Document<'_>) -> bool {
    let dependencies = document.get(0, b"devDependencies");
    let depends_on = |name: &[u8]| dependencies.is_some_and(|it| document.get(it, name).is_some());
    if !depends_on(b"npm-run-all") && !depends_on(b"npm-run-all2") {
        return false;
    }
    let is_sequential = |command: u32| {
        document.string(command).is_some_and(|it| {
            strings::contains_char(&it, b'*') && strings::js_lines(&it).any(runs_in_sequence)
        })
    };
    [&b"scripts"[..], b"betterScripts"]
        .into_iter()
        .filter_map(|field| document.get(0, field))
        .any(|scripts| document.values(scripts).any(is_sequential))
}

/// The order of `sortScriptNames`: `a:b` is in the group `a`, which comes before `a-b`.
fn compare_script_names(a: &[u8], b: &[u8]) -> Ordering {
    // Where the group's name ends, and where the rest starts after the colon.
    let split = |name: &[u8]| match strings::index_of_char_usize(name, b':') {
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

/// `sortScripts`: sorts by name, with `prea` and `posta` around `a`. For `keeps_order`, see [`has_sequential_script`].
pub(super) fn sort_scripts(scripts: &mut [Member<'_>], keeps_order: bool) {
    let all: FxHashSet<&[u8]> = scripts.iter().map(|it| &it.key[..]).collect();
    let mut prefixable: FxHashSet<&[u8]> = FxHashSet::default();
    let mut names: Vec<&[u8]> = (scripts.iter())
        .map(|script| {
            let name = &script.key[..];
            let omitted = name
                .strip_prefix(b"pre")
                .or_else(|| name.strip_prefix(b"post"));
            let omitted = omitted.unwrap_or(name);
            if NPM_SCRIPTS.contains(&omitted) || all.contains(omitted) {
                prefixable.insert(omitted);
                return omitted;
            }
            name
        })
        .collect();
    if !keeps_order {
        crate::sort::sort_by(&mut names, |a, b| compare_script_names(a, b));
    }
    // Each script's rank: the first position that mentions it.
    let mut ranks: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
    let mut assign_rank = |name: Vec<u8>| {
        let rank = ranks.len();
        ranks.entry(name).or_insert(rank);
    };
    for name in names {
        if prefixable.contains(name) {
            assign_rank([&b"pre"[..], name].concat());
            assign_rank(name.to_vec());
            assign_rank([&b"post"[..], name].concat());
        } else {
            assign_rank(name.to_vec());
        }
    }
    let rank = |name: &[u8]| ranks.get(name).copied().unwrap_or(usize::MAX);
    sort_by(scripts, |a, b| rank(a).cmp(&rank(b)));
}

// ───────────────────────────── the rest ─────────────────────────────

/// One level of `sortExports`: paths first, then conditions, with `default` last.
pub(super) fn sort_exports(members: &mut [Member<'_>]) {
    let rank = |key: &[u8]| match key {
        [b'.', ..] => 0,
        b"default" => 2,
        _ => 1,
    };
    sort_by(members, |a, b| rank(a).cmp(&rank(b)));
}

/// Rules without a plugin first, then `a/b`, then `a/b/c`.
pub(super) fn sort_eslint_rules(members: &mut [Member<'_>]) {
    sort_by(members, |a, b| {
        let parts = |rule: &[u8]| strings::count_char(rule, b'/');
        (parts(a).cmp(&parts(b))).then_with(|| strings::locale_compare(a, b))
    });
}

/// By name, with `overrides` last.
pub(super) fn sort_prettier_config(members: &mut [Member<'_>]) {
    sort_by(members, |a, b| {
        let is_last = |key: &[u8]| key == b"overrides";
        (is_last(a).cmp(&is_last(b))).then_with(|| strings::order_utf16(a, b))
    });
}
