//! Runs the ESLint, typescript-eslint and plugin test suites against `bun lint`. The tests are in
//! `test/cli/lint/conformance/bundle.zst`. Each rule has a file `<plugin>/<rule>.json` with upstream's test cases and
//! what the real ESLint reports for each one, and `more/` has the same for cases from other sources. See the README
//! there.
//!
//! It's compiled into debug and canary builds of Bun (`bun lint --run-eslint-tests`, for
//! `test/cli/lint/conformance.test.ts`).
//!
//! A case passes if the messages match (rule, id, text, position, fix, and for each suggestion its id, text, fix and
//! resulting code) and the code after one pass of fixes matches too.
//!
//! Here `--fix` never applies a fix that can change what a program does, even if upstream's `--fix` does. Those fixes
//! need `--fix-dangerously`. They're compared as regular fixes, and the cases that have one are counted.
//!
//! `oxlint/` has the tests for rules ported from oxlint, with what the oxlint executable reports. oxlint doesn't print
//! its fixes, so those cases compare the code after `--fix`, then with `--fix-suggestions` added, then with
//! `--fix-dangerously` added.

#![forbid(unsafe_code)]

mod compare;
mod test_only_rules;

use bun_format_conformance::write_file;
pub use bun_format_conformance::{Bundle, read_file, write_line};
use compare::oxlint_problem;
pub use compare::{
    Counts, Edit, Outcome, Problem, Reported, Suggested, expected_messages, problem_of, string_of,
};

use bstr::BStr;
use bun_core::strings;
use bun_format_conformance::output_line;
use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::languages::Dialect;
use bun_lint::linter::{Config, FileConfig, LintMessage, Registry, ResolvedConfig};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_lint::utils::sort;
use std::borrow::Cow;
use std::fmt::Write as _;
use std::sync::OnceLock;
use std::sync::atomic::Ordering;

/// The context a case's code is linted in.
#[derive(Copy, Clone)]
pub enum LintContext<'a> {
    /// On its own.
    Standalone,
    /// As a file in the project in this directory, for a rule that looks at other files.
    Project(&'a [u8]),
    /// As a file in this `tsconfig.json`'s program, with types.
    Program(&'a [u8]),
}

/// One lint request.
pub struct Case<'a> {
    pub code: &'a [u8],
    /// Absolute unless `lint_context` is `Standalone`. The file doesn't have to exist, and if it does, `code` overrides
    /// its text.
    pub path: &'a [u8],
    /// Enables exactly one rule.
    pub config: &'a ResolvedConfig,
    pub lint_context: LintContext<'a>,
    /// Called with the file before it's linted. Only used when `lint_context` is `Standalone`.
    pub prepare: Option<&'a dyn for<'f> Fn(&'f File<'f>)>,
}

/// The linter under test.
pub trait Host: Sync {
    /// Its linter's registry.
    fn registry(&self) -> &Registry;

    /// The messages for a case. `None` if it can't be linted that way.
    fn lint(&self, case: &Case<'_>) -> Option<Vec<LintMessage>>;

    /// Calls `work` with each number below `count`, on `threads` threads.
    fn for_each(&self, threads: usize, count: usize, work: &(dyn Fn(usize) + Sync));
}

/// The command-line flags after the bundle's path.
#[derive(Default)]
pub struct Flags<'a> {
    /// `--suite=upstream`, `--suite=more`, `--suite=reviews`: only upstream's tests, only the others, or only those in
    /// that directory of `more`.
    pub suite: Option<&'a [u8]>,
    /// `--plugin=eslint`: only the rules in this directory.
    pub plugin: Option<&'a [u8]>,
    /// `--rule=no-undef`: only this rule.
    pub rule: Option<&'a [u8]>,
    /// `--report=directory`: writes each rule's failures to `<plugin>/<rule>.txt` there.
    pub report: Option<&'a [u8]>,
    /// `--verbose`: prints the failures in full.
    pub verbose: bool,
    /// `--table`: prints one line per rule instead of one per failing case.
    pub table: bool,
    /// `--types`: also runs the cases that need types.
    pub types: bool,
    /// `--every=n --first=i`: runs every n-th case that doesn't need types, starting at the i-th.
    pub every: usize,
    pub first: usize,
    /// `--every-typed=n`: runs every n-th case that needs types.
    pub every_typed: usize,
    /// `--threads=n`
    pub threads: usize,
    /// `--projects=directory`: the absolute path of the directory with the projects that some cases' files belong to.
    /// With `--extract`, they're written there first.
    pub projects: Option<&'a [u8]>,
    pub extract: bool,
    /// `--in-order`: fails a case whose messages match the recorded ones but in a different order.
    pub in_order: bool,
}

impl<'a> Flags<'a> {
    pub fn parse(args: &[&'a [u8]]) -> Flags<'a> {
        let flag = |name: &[u8]| {
            args.iter().find_map(|it| {
                it.strip_prefix(b"--")?
                    .strip_prefix(name)?
                    .strip_prefix(b"=")
            })
        };
        let number =
            |name: &[u8]| flag(name).and_then(|it| std::str::from_utf8(it).ok()?.parse().ok());
        let has = |name: &[u8]| args.iter().any(|it| it.strip_prefix(b"--") == Some(name));
        Flags {
            suite: flag(b"suite"),
            plugin: flag(b"plugin"),
            rule: flag(b"rule"),
            report: flag(b"report"),
            verbose: has(b"verbose"),
            table: has(b"table"),
            types: has(b"types"),
            every: number(b"every").unwrap_or(1).max(1),
            first: number(b"first").unwrap_or(0),
            every_typed: number(b"every-typed").unwrap_or(1).max(1),
            threads: number(b"threads").unwrap_or(1).max(1),
            projects: flag(b"projects"),
            extract: has(b"extract"),
            in_order: has(b"in-order"),
        }
    }
}

/// The bundle directories that contain the `PLUGINS` directories, by suite name.
const SUITES: [(&str, &str); 5] = [
    ("upstream", ""),
    ("oxlint", "oxlint/"),
    ("reviews", "more/reviews/"),
    ("oxlint-tsgolint", "more/oxlint-tsgolint/"),
    ("typescript-parser", "more/typescript-parser/"),
];

/// The directories in a suite that contain rule tests.
const PLUGINS: [(&str, Plugin); 19] = [
    ("eslint", Plugin::Eslint),
    ("typescript-eslint", Plugin::TypeScript),
    ("react-hooks", Plugin::ReactHooks),
    ("import", Plugin::Import),
    ("n", Plugin::Node),
    ("oxc", Plugin::Oxc),
    ("node", Plugin::Node),
    ("typescript", Plugin::TypeScript),
    ("unicorn", Plugin::Unicorn),
    ("react", Plugin::React),
    ("react-perf", Plugin::ReactPerf),
    ("jsx-a11y", Plugin::JsxA11y),
    ("nextjs", Plugin::Nextjs),
    ("promise", Plugin::Promise),
    ("jest", Plugin::Jest),
    ("vitest", Plugin::Vitest),
    ("prettier", Plugin::Prettier),
    ("json", Plugin::Json),
    ("markdown", Plugin::Markdown),
];

/// The bundle directories that are written to disk.
const PROJECTS: [&[u8]; 6] = [
    b"import-project/",
    b"oxlint-import-project/",
    b"n-project/",
    b"prettier-project/",
    b"typescript-eslint-project/",
    b"node_modules/",
];

/// A placeholder in fixtures for the project's directory, which is under `--projects`. It appears in file names,
/// options, settings, messages and code.
const PROJECT: &[u8] = b"/__project__";

/// The `PROJECTS` directory that the cases for `plugin`'s rules belong to.
fn project_of(plugin: Plugin, is_oxlint_suite: bool) -> &'static [u8] {
    match plugin {
        _ if is_oxlint_suite => b"oxlint-import-project",
        Plugin::Node => b"n-project",
        Plugin::Prettier => b"prettier-project",
        _ => b"import-project",
    }
}

/// `a/b.symlink` in the bundle is the symbolic link `a/b`, and its contents are the link's target.
const LINK: &[u8] = b".symlink";

fn make_parent(path: &[u8]) {
    if let Some(end) = strings::last_index_of_char(path, b'/').filter(|&end| end > 0) {
        let _ = bun_sys::mkdir_recursive(&path[..end]);
    }
}

fn write_link(path: &[u8], target: &[u8]) {
    make_parent(path);
    let _ = bun_sys::symlink(
        &bun_core::ZBox::from_bytes(target),
        &bun_core::ZBox::from_bytes(path),
    );
}

/// The configuration the plugin's `RuleTester` lints a case with: only that rule, as an error.
pub fn config_of(registry: &Registry, entry: &'static RuleEntry, case: &Json) -> ResolvedConfig {
    let language_options = case.get(b"languageOptions").cloned().unwrap_or(Json::Null);
    // If the case is in one of the plugin's languages, `languageOptions` are that language's options.
    let language = string_of(case, b"language");
    let dialect = language.and_then(|language_id| {
        let name = &language_id[strings::last_index_of_char(language_id, b'/')? + 1..];
        let language = registry.language(entry.meta.plugin, name)?;
        let configured = language.configure(name, &language_options).ok()?;
        Some(Dialect {
            language,
            configured,
        })
    });
    let config = Json::Object(vec![
        (
            b"languageOptions".to_vec(),
            match language {
                Some(_) => Json::Null,
                None => language_options,
            },
        ),
        (
            b"settings".to_vec(),
            case.get(b"settings").cloned().unwrap_or(Json::Null),
        ),
    ]);
    let mut config = ResolvedConfig::from_json(registry, &config, &mut Vec::new());
    // The rule isn't enabled by name. In a configuration, the name means the npm package's rule as long as the plugin
    // isn't fully implemented here.
    let options = case.get(b"options").and_then(Json::as_array);
    // Only the first error is kept, and `null` in the recorded language options causes one. Clear it so that a
    // rejection of the rule's options shows up.
    config.error = None;
    config.language_name = language.map(Into::into);
    config.dialect = dialect;
    config.configure(entry, Severity::Error, options.unwrap_or_default());
    // typescript-eslint's `RuleTester` sets it, ESLint's doesn't.
    config.linter.report_unused_disable_directives = match entry.meta.plugin {
        Plugin::TypeScript => Severity::Warn,
        _ => Severity::Off,
    };
    config
}

/// The configuration oxlint's `Tester` lints a case with: an `.oxlintrc.json` with only that rule, plus whatever the
/// case has in `oxlintrc`. `directory` is the rule's directory in the bundle, which is oxlint's name for the plugin.
fn oxlint_config_of(
    registry: &Registry,
    directory: &str,
    entry: &'static RuleEntry,
    case: &Json,
    path: &[u8],
) -> Option<ResolvedConfig> {
    let text = |it: &str| Json::String(it.as_bytes().to_vec());
    let mut rule = vec![text("error")];
    rule.extend_from_slice(
        case.get(b"options")
            .and_then(Json::as_array)
            .unwrap_or_default(),
    );
    let mut plugins = vec![text(directory)];
    plugins.extend_from_slice(
        case.get(b"plugins")
            .and_then(Json::as_array)
            .unwrap_or_default(),
    );
    let mut file: Vec<(Vec<u8>, Json)> = (case.get(b"oxlintrc"))
        .and_then(Json::as_object)
        .unwrap_or_default()
        .to_vec();
    file.retain(|it| !matches!(&it.0[..], b"plugins" | b"categories" | b"rules"));
    if let Some(settings) = case.get(b"settings").filter(|it| it.as_object().is_some())
        && !file.iter().any(|it| it.0 == b"settings")
    {
        file.push((b"settings".to_vec(), settings.clone()));
    }
    file.extend([
        (b"plugins".to_vec(), Json::Array(plugins)),
        (
            b"categories".to_vec(),
            Json::Object(vec![(b"correctness".to_vec(), text("off"))]),
        ),
        (
            b"rules".to_vec(),
            Json::Object(vec![(
                format!("{directory}/{}", entry.meta.name).into_bytes(),
                Json::Array(rule),
            )]),
        ),
    ]);
    let config = Config::from_rc_json(registry, b"/", &Json::Object(file), &mut |_, _| None);
    let absolute = [b"/", path.strip_prefix(b"/").unwrap_or(path)].concat();
    match config.ok()?.get(registry, &absolute) {
        FileConfig::Matched(config) => Some((*config).clone()),
        _ => None,
    }
}

/// How a case is run.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    /// It depends on code in upstream's tests that isn't reproduced here.
    Skipped,
    Plain,
    WithTestOnlyRules,
    InProject,
    Typed,
}

fn kind_of(entry: &RuleEntry, case: &Json, is_oxlint_suite: bool) -> Kind {
    let is_type_aware = case.get(b"typeAware").and_then(Json::as_bool) == Some(true);
    match string_of(case, b"skip") {
        Some(skip) if test_only_rules::is_known(skip) => Kind::WithTestOnlyRules,
        // `@typescript-eslint/parser` without its services.
        None | Some(b"parser: custom") if is_type_aware => Kind::Typed,
        None | Some(b"parser: custom")
            if entry.meta.needs_modules
                || entry.meta.plugin == Plugin::Prettier
                || (entry.meta.plugin == Plugin::Node && !entry.meta.follows_oxlint)
                // Some rules read the `package.json` files in the file's parent directories.
                || (entry.meta.plugin == Plugin::Import && !is_oxlint_suite) =>
        {
            Kind::InProject
        }
        None | Some(b"parser: custom") => Kind::Plain,
        Some(_) => Kind::Skipped,
    }
}

/// Values JSON can't represent (`Infinity`, `undefined`, a function) are recorded as `null`.
fn has_null(options: Option<&Json>) -> bool {
    let mut left: Vec<&Json> = options.into_iter().collect();
    while let Some(it) = left.pop() {
        match it {
            Json::Null => return true,
            Json::Array(items) => left.extend(items),
            Json::Object(entries) => left.extend(entries.iter().map(|it| &it.1)),
            _ => {}
        }
    }
    false
}

/// Runs `case` and returns the problem with its output, if any. `Err` if it can't be run here.
fn run_case(
    host: &dyn Host,
    flags: &Flags,
    fixture: &Fixture,
    case: &Json,
    kind: Kind,
    counts: &Counts,
) -> Result<Option<Problem>, ()> {
    let entry = fixture.entry;
    let code = string_of(case, b"code").unwrap_or_default();
    let filename = string_of(case, b"filename").unwrap_or(b"file.js");
    let config = match fixture.oxlint_plugin_directory() {
        Some(directory) => {
            oxlint_config_of(host.registry(), directory, entry, case, filename).ok_or(())?
        }
        None => config_of(host.registry(), entry, case),
    };
    // A real configuration with these options would abort the run.
    if let Some(error) = &config.error
        && !has_null(case.get(b"options"))
    {
        return Ok(Some(Problem {
            summary: "the options are refused",
            details: format!("  {}", BStr::new(error)),
        }));
    }
    let in_directory = |directory: &[u8]| match filename.first() {
        Some(b'<' | b'/') => Some(filename.to_vec()),
        _ => Some([flags.projects?, b"/", directory, b"/", filename].concat()),
    };
    let lint =
        |path: &[u8], lint_context: LintContext, prepare: Option<&dyn for<'f> Fn(&'f File<'f>)>| {
            host.lint(&Case {
                code,
                path,
                config: &config,
                lint_context,
                prepare,
            })
        };
    let messages = match kind {
        Kind::Skipped => return Err(()),
        // Some oxlint rules depend on the file's parent directories.
        Kind::Plain if fixture.oxlint_plugin_directory().is_some() => {
            let absolute = [b"/", filename.strip_prefix(b"/").unwrap_or(filename)].concat();
            lint(&absolute, LintContext::Standalone, None).ok_or(())?
        }
        Kind::Plain => lint(filename, LintContext::Standalone, None).ok_or(())?,
        Kind::WithTestOnlyRules => {
            let rules = test_only_rules::Enabled::in_code(code);
            let messages = lint(
                filename,
                LintContext::Standalone,
                Some(&|file| rules.prepare(file)),
            )
            .ok_or(())?;
            rules.finish(messages)
        }
        Kind::InProject => {
            let directory = project_of(
                entry.meta.plugin,
                fixture.oxlint_plugin_directory().is_some(),
            );
            // A fixture that isn't in the bundle yet still has the file names as recorded.
            let project = match fixture.json.get(b"root").and_then(Json::as_str) {
                Some(root) => root.to_vec(),
                None => [flags.projects.ok_or(())?, b"/", directory].concat(),
            };
            let path = match filename.first() {
                Some(b'<' | b'/') => filename.to_vec(),
                _ => [&project[..], b"/", filename].concat(),
            };
            lint(&path, LintContext::Project(&project), None).ok_or(())?
        }
        Kind::Typed => {
            let tsconfig = string_of(case, b"tsconfig").unwrap_or(b"tsconfig.json");
            let tsconfig = [
                flags.projects.ok_or(())?,
                b"/typescript-eslint-project/",
                tsconfig,
            ]
            .concat();
            let path = in_directory(b"typescript-eslint-project").ok_or(())?;
            return Ok(problem_of(
                lint(&path, LintContext::Program(&tsconfig), None)
                    .map(|it| Outcome::new(entry, code, &it)),
                case,
                counts,
            ));
        }
    };
    if fixture.oxlint_plugin_directory().is_some() {
        return Ok(oxlint_problem(entry, code, &messages, case, counts));
    }
    Ok(problem_of(
        Some(Outcome::new(entry, code, &messages)),
        case,
        counts,
    ))
}

#[derive(Default, Clone, Copy)]
pub struct Tally {
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
}

/// Writes a failure's full description.
fn describe(index: usize, case: &Json, problem: &Problem, into: &mut String) {
    let mut options = Vec::new();
    case.get(b"options")
        .unwrap_or(&Json::Null)
        .stringify(&mut options);
    let _ = writeln!(
        into,
        "──── case {index} ({}) {} {}\noptions: {}\ncode:\n{}\n{}\n{}\n",
        if expected_messages(case).is_empty() {
            "valid"
        } else {
            "invalid"
        },
        BStr::new(string_of(case, b"filename").unwrap_or_default()),
        BStr::new(string_of(case, b"tsconfig").unwrap_or_default()),
        BStr::new(&options),
        BStr::new(string_of(case, b"code").unwrap_or_default()),
        problem.summary,
        problem.details,
    );
}

/// A rule's tests.
struct Fixture {
    /// `<plugin>/<rule>`, prefixed with the suite's directory.
    id: String,
    entry: &'static RuleEntry,
    json: Json,
    tally: Tally,
}

fn cases_of(fixture: &Json) -> &[Json] {
    fixture
        .get(b"cases")
        .and_then(Json::as_array)
        .unwrap_or_default()
}

impl Fixture {
    fn cases(&self) -> &[Json] {
        cases_of(&self.json)
    }

    /// The plugin's directory, if the fixture is compared against oxlint.
    fn oxlint_plugin_directory(&self) -> Option<&str> {
        let rest = self.id.strip_prefix("oxlint/")?;
        rest.get(..rest.len().checked_sub(self.entry.meta.name.len() + 1)?)
    }
}

/// A case selected to run.
#[derive(Copy, Clone)]
struct Chosen {
    fixture: usize,
    index: usize,
    kind: Kind,
}

/// The name of the rule whose tests are at `path` in the bundle, if it belongs to the plugin in `directory`.
fn rule_at<'p>(path: &'p [u8], directory: &[u8]) -> Option<&'p [u8]> {
    path.strip_prefix(directory)?
        .strip_prefix(b"/")?
        .strip_suffix(b".json")
}

/// Runs the tests in `bundle` and prints the failing cases, one per line, then the totals.
pub fn run(bundle: &Bundle<'_>, flags: &Flags<'_>, host: &dyn Host) {
    if let (true, Some(projects)) = (flags.extract, flags.projects) {
        for path in bundle
            .paths()
            .filter(|path| PROJECTS.iter().any(|it| path.starts_with(it)))
        {
            let (to, contents) = (
                [projects, b"/", path].concat(),
                bundle.read(path).unwrap_or_default(),
            );
            match to.strip_suffix(LINK) {
                Some(link) => write_link(link, contents),
                None => write_file(&to, contents),
            }
        }
    }
    let (mut fixtures, mut missing) = (Vec::new(), 0);
    let suites = SUITES.iter().filter(|(name, prefix)| match flags.suite {
        Some(b"more") => prefix.starts_with("more/"),
        Some(only) => only == name.as_bytes(),
        None => true,
    });
    for ((_, prefix), (directory, plugin)) in
        suites.flat_map(|suite| PLUGINS.iter().map(move |plugin| (suite, plugin)))
    {
        if flags
            .plugin
            .is_some_and(|only| only != directory.as_bytes())
        {
            continue;
        }
        let directory = format!("{prefix}{directory}");
        let mut rules: Vec<(&[u8], &[u8])> = bundle
            .paths()
            .filter_map(|path| Some((rule_at(path, directory.as_bytes())?, path)))
            .collect();
        sort::sort_unstable(&mut rules);
        for (name, path) in rules {
            if flags.rule.is_some_and(|only| only != name) {
                continue;
            }
            let id = format!("{directory}/{}", BStr::new(name));
            // oxlint calls `react-hooks/exhaustive-deps` `react/exhaustive-deps`.
            let is_oxlint_suite = directory.starts_with("oxlint/");
            let registry = host.registry();
            let Some(entry) = registry.get_preferring(*plugin, name, is_oxlint_suite) else {
                missing += 1;
                continue;
            };
            let text = bundle.read(path).map(|text| match flags.projects {
                Some(projects) if strings::contains(text, PROJECT) => {
                    let project = [projects, b"/", project_of(*plugin, is_oxlint_suite)].concat();
                    Cow::Owned(strings::replace_owned(text, PROJECT, &project))
                }
                _ => Cow::Borrowed(text),
            });
            match text.and_then(|it| bun_lint::json::parse(&it)) {
                Some(json) => fixtures.push(Fixture {
                    id,
                    entry,
                    json,
                    tally: Tally::default(),
                }),
                None => output_line!("{id}: the fixture cannot be read"),
            }
        }
    }

    // The number of cases counted so far for `--every`, without and with types.
    let (mut untyped, mut typed) = (0, 0);
    let mut chosen = Vec::new();
    for (fixture, it) in fixtures.iter_mut().enumerate() {
        let is_oxlint_suite = it.oxlint_plugin_directory().is_some();
        let Fixture {
            entry, json, tally, ..
        } = it;
        for (index, case) in cases_of(json).iter().enumerate() {
            let kind = kind_of(entry, case, is_oxlint_suite);
            if kind == Kind::Skipped || (kind == Kind::Typed && !flags.types) {
                tally.skipped += 1;
                continue;
            }
            let (counter, every) = match kind {
                Kind::Typed => (&mut typed, flags.every_typed),
                _ => (&mut untyped, flags.every),
            };
            if *counter % every == flags.first % every {
                chosen.push(Chosen {
                    fixture,
                    index,
                    kind,
                });
            }
            *counter += 1;
        }
    }
    // Cases with types take a hundred times as long, so they start first.
    let mut order: Vec<usize> = (0..chosen.len()).collect();
    sort::sort_by_key(&mut order, |&at| chosen[at].kind != Kind::Typed);
    let results: Vec<OnceLock<Result<Option<Problem>, ()>>> =
        chosen.iter().map(|_| OnceLock::new()).collect();
    let counts = Counts {
        fails_on_order: flags.in_order,
        ..Counts::default()
    };
    host.for_each(flags.threads, chosen.len(), &|at| {
        let at = order[at];
        let (it, fixture) = (chosen[at], &fixtures[chosen[at].fixture]);
        let _ = results[at].set(run_case(
            host,
            flags,
            fixture,
            &fixture.cases()[it.index],
            it.kind,
            &counts,
        ));
    });

    let mut failures: Vec<Vec<(usize, Problem)>> = fixtures.iter().map(|_| Vec::new()).collect();
    for (it, result) in chosen.iter().zip(results) {
        let tally = &mut fixtures[it.fixture].tally;
        match result.into_inner() {
            Some(Ok(None)) => tally.passed += 1,
            Some(Ok(Some(problem))) => {
                tally.failed += 1;
                failures[it.fixture].push((it.index, problem));
            }
            Some(Err(())) | None => tally.skipped += 1,
        }
    }
    let (mut total, mut perfect) = (Tally::default(), 0);
    for (fixture, failures) in fixtures.iter().zip(&failures) {
        let (id, tally) = (&fixture.id, fixture.tally);
        perfect += usize::from(tally.failed == 0);
        let mut full_descriptions = String::new();
        for (index, problem) in failures {
            if !flags.table {
                output_line!("FAIL {id}#{index} {}", problem.summary);
            }
            if flags.verbose || flags.report.is_some() {
                describe(
                    *index,
                    &fixture.cases()[*index],
                    problem,
                    &mut full_descriptions,
                );
            }
        }
        if flags.table {
            let verdict = if tally.failed == 0 { "ok  " } else { "FAIL" };
            output_line!(
                "{verdict} {id}: {} passed, {} failed, {} skipped",
                tally.passed,
                tally.failed,
                tally.skipped
            );
        }
        if flags.verbose && !full_descriptions.is_empty() {
            output_line!("{}", full_descriptions.trim_end_matches('\n'));
        }
        if let Some(report) = flags.report {
            write_file(
                &[report, b"/", id.as_bytes(), b".txt"].concat(),
                full_descriptions.as_bytes(),
            );
        }
        total.passed += tally.passed;
        total.failed += tally.failed;
        total.skipped += tally.skipped;
    }
    if fixtures
        .iter()
        .any(|it| it.oxlint_plugin_directory().is_some())
    {
        output_line!(
            "\n{} messages lack the help that oxlint has",
            counts.missing_help.load(Ordering::Relaxed)
        );
    }
    output_line!(
        "\n{} cases have their messages in another order",
        counts.reordered_cases.load(Ordering::Relaxed)
    );
    output_line!(
        "\n{} cases have a fix that --fix holds back",
        counts.cases_with_held_back_fix.load(Ordering::Relaxed)
    );
    output_line!(
        "\n{} rules, {perfect} without failures, {missing} not implemented\n{} cases passed, {} failed, {} skipped",
        fixtures.len(),
        total.passed,
        total.failed,
        total.skipped
    );
}

/// `--run-eslint-tests <bundle> ..`, where `args` is everything after the flag. Returns false if the tests couldn't be
/// run. The caller compares the printed output.
pub fn run_from_command_line(args: &[&[u8]], host: &dyn Host) -> bool {
    let Some(bytes) = args.first().and_then(|path| read_file(path)) else {
        output_line!("cannot read the bundle");
        return false;
    };
    let Some(bundle) = Bundle::parse(&bytes) else {
        output_line!("the bundle is malformed");
        return false;
    };
    run(&bundle, &Flags::parse(args), host);
    true
}
