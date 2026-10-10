//! Runs the tests of ESLint, of typescript-eslint and of the plugins on `bun lint`. The tests are
//! in `test/cli/lint/conformance/bundle.zst`: for each rule a file `<plugin>/<rule>.json` with the
//! cases of upstream's tests and what the real ESLint reports for each, and in `more/` the same for
//! cases from elsewhere. See the README there.
//!
//! It is compiled into debug and canary builds of Bun (`bun lint --run-eslint-tests`, for
//! `test/cli/lint/conformance.test.ts`) and into `bun-lint`.
//!
//! A case passes if the messages are the same (rule, id, text, place, fix, and for each suggestion
//! id, text, fix and the code after it) and the code after one pass of fixes is.
//!
//! `oxlint/` has the tests of the rules that are ports of oxlint's, with what the executable of oxlint reports. It does not print
//! its fixes: there the code is compared after what `--fix` applies, then also `--fix-suggestions`, then also `--fix-dangerously`.

#![forbid(unsafe_code)]

mod compare;
mod test_only_rules;

pub use bun_format_conformance::{Bundle, read_file, write_line};
use compare::problem_of_oxlint;
pub use compare::{
    Counts, Edit, Outcome, Problem, Reported, Suggested, expected_messages, problem_of, string_of,
};

use bstr::BStr;
use bun_core::strings;
use bun_format_conformance::output_line;
use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::linter::{Config, FileConfig, LintMessage, Registry, ResolvedConfig};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use std::borrow::Cow;
use std::fmt::Write as _;
use std::sync::OnceLock;
use std::sync::atomic::Ordering;

/// Where the code of a case is linted.
#[derive(Copy, Clone)]
pub enum Place<'a> {
    /// By itself.
    Nowhere,
    /// As a file of the project in this directory, for a rule that looks at other files.
    Project(&'a [u8]),
    /// As a file of the program of this `tsconfig.json`, with types.
    Program(&'a [u8]),
}

/// What there is to lint.
pub struct Case<'a> {
    pub code: &'a [u8],
    /// Absolute unless the place is nowhere. The file need not exist, and if it does, `code`
    /// replaces its text.
    pub path: &'a [u8],
    /// It enables one rule.
    pub config: &'a ResolvedConfig,
    pub place: Place<'a>,
    /// To be called with the file before it is linted. Only where the place is nowhere.
    pub prepare: Option<&'a dyn for<'f> Fn(&'f File<'f>)>,
}

/// What lints.
pub trait Host: Sync {
    /// That of its linter.
    fn registry(&self) -> &Registry;

    /// The messages about a case. `None`: it cannot be linted that way.
    fn lint(&self, case: &Case<'_>) -> Option<Vec<LintMessage>>;

    /// Calls `work` with each number below `count`, on `threads` threads.
    fn for_each(&self, threads: usize, count: usize, work: &(dyn Fn(usize) + Sync));
}

/// What is on the command line after the path of the bundle.
#[derive(Default)]
pub struct Flags<'a> {
    /// `--suite=upstream`, `--suite=more`, `--suite=reviews`: only the tests of upstream, only the
    /// others, only those in this directory of `more`.
    pub suite: Option<&'a [u8]>,
    /// `--plugin=eslint`: only the rules in this directory.
    pub plugin: Option<&'a [u8]>,
    /// `--rule=no-undef`: only this rule.
    pub rule: Option<&'a [u8]>,
    /// `--report=directory`: the failures of each rule are written to `<plugin>/<rule>.txt` there.
    pub report: Option<&'a [u8]>,
    /// `--verbose`: the failures are printed at length.
    pub verbose: bool,
    /// `--table`: a line for each rule, and none for a case that fails.
    pub table: bool,
    /// `--types`: also the cases that need types.
    pub types: bool,
    /// `--every=n --first=i`: every n-th case that needs no types, from the i-th.
    pub every: usize,
    pub first: usize,
    /// `--every-typed=n`: every n-th case that needs types.
    pub every_typed: usize,
    /// `--threads=n`
    pub threads: usize,
    /// `--projects=directory`: where the projects are that some cases are files of. Absolute. With
    /// `--extract`, they are written there first.
    pub projects: Option<&'a [u8]>,
    pub extract: bool,
    /// `--in-order`: a case fails whose messages are the recorded ones in another order.
    pub in_order: bool,
    /// `--schemas`: a case fails whose options the schema of the rule refuses.
    pub schemas: bool,
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
            schemas: has(b"schemas"),
        }
    }
}

/// The directories of the bundle that have those of `PLUGINS`, by name.
const SUITES: [(&str, &str); 5] = [
    ("upstream", ""),
    ("oxlint", "oxlint/"),
    ("reviews", "more/reviews/"),
    ("oxlint-tsgolint", "more/oxlint-tsgolint/"),
    ("typescript-parser", "more/typescript-parser/"),
];

/// The directories of a suite that have the tests of rules.
const PLUGINS: [(&str, Plugin); 20] = [
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
    ("jsdoc", Plugin::Jsdoc),
    ("vue", Plugin::Vue),
    ("regexp", Plugin::Regexp),
    ("prettier", Plugin::Prettier),
];

/// The directories of the bundle that are written to the disk.
const PROJECTS: [&[u8]; 6] = [
    b"import-project/",
    b"oxlint-import-project/",
    b"n-project/",
    b"prettier-project/",
    b"typescript-eslint-project/",
    b"node_modules/",
];

/// In a fixture it stands for the directory of its project, which is below `--projects`: in the names of files, in options,
/// settings, messages and code.
const PROJECT: &[u8] = b"/__project__";

/// The directory of `PROJECTS` that the cases of a rule of `plugin` are files of.
fn project_of(plugin: Plugin, is_of_oxlint: bool) -> &'static [u8] {
    match plugin {
        _ if is_of_oxlint => b"oxlint-import-project",
        Plugin::Node => b"n-project",
        Plugin::Prettier => b"prettier-project",
        _ => b"import-project",
    }
}

/// `a/b.symlink` in the bundle is the symbolic link `a/b`, and what it has is where the link leads.
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

fn write_file(path: &[u8], contents: &[u8]) {
    make_parent(path);
    let _ = bun_sys::File::write_file(
        bun_core::Fd::cwd(),
        &bun_core::ZBox::from_bytes(path),
        contents,
    );
}

/// The configuration that the `RuleTester` of the plugin lints a case with: only that rule, as an
/// error.
pub fn config_of(registry: &Registry, entry: &'static RuleEntry, case: &Json) -> ResolvedConfig {
    let config = Json::Object(vec![
        (
            b"languageOptions".to_vec(),
            case.get(b"languageOptions").cloned().unwrap_or(Json::Null),
        ),
        (
            b"settings".to_vec(),
            case.get(b"settings").cloned().unwrap_or(Json::Null),
        ),
    ]);
    let mut config = ResolvedConfig::from_json(registry, &config, &mut Vec::new());
    // Not by its name: in a configuration that is the rule of the package, as long as the plugin is not whole here.
    let options = case.get(b"options").and_then(Json::as_array);
    // The first error is kept, and `null` in the recorded language options is one: what is to be seen is the refusal of the options.
    config.error = None;
    config.configure(entry, Severity::Error, options.unwrap_or_default());
    // The `RuleTester` of typescript-eslint sets it, that of ESLint does not.
    config.linter.report_unused_disable_directives = match entry.meta.plugin {
        Plugin::TypeScript => Severity::Warn,
        _ => Severity::Off,
    };
    config
}

/// The configuration that oxlint's `Tester` lints a case with: an `.oxlintrc.json` with only that rule, and with what the case
/// has in `oxlintrc`. `directory`: of the rule in the bundle, which is what oxlint calls its plugin.
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
    /// It depends on code of upstream's tests that is not reproduced.
    Skipped,
    Plain,
    WithTestOnlyRules,
    InProject,
    Typed,
}

fn kind_of(entry: &RuleEntry, case: &Json, is_of_oxlint: bool) -> Kind {
    let is_type_aware = case.get(b"typeAware").and_then(Json::as_bool) == Some(true);
    match string_of(case, b"skip") {
        Some(skip) if test_only_rules::is_known(skip) => Kind::WithTestOnlyRules,
        // `@typescript-eslint/parser` without its services.
        None | Some(b"parser: custom") if is_type_aware => Kind::Typed,
        None | Some(b"parser: custom")
            if entry.meta.needs_modules
                || entry.meta.plugin == Plugin::Prettier
                || (entry.meta.plugin == Plugin::Node && !entry.meta.follows_oxlint)
                // Some read the `package.json` files above the file.
                || (entry.meta.plugin == Plugin::Import && !is_of_oxlint) =>
        {
            Kind::InProject
        }
        None | Some(b"parser: custom") => Kind::Plain,
        Some(_) => Kind::Skipped,
    }
}

/// What JSON cannot say (`Infinity`, `undefined`, a function) is `null` in a recording.
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

/// What is wrong with what is reported for `case`, a test of the rule `entry`. `Err`: it cannot be
/// run here.
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
    let config = match fixture.plugin_of_oxlint() {
        Some(directory) => {
            oxlint_config_of(host.registry(), directory, entry, case, filename).ok_or(())?
        }
        None => config_of(host.registry(), entry, case),
    };
    // A configuration with these options would end the run.
    if flags.schemas
        && let Some(error) = &config.error
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
    let lint = |path: &[u8], place: Place, prepare: Option<&dyn for<'f> Fn(&'f File<'f>)>| {
        host.lint(&Case {
            code,
            path,
            config: &config,
            place,
            prepare,
        })
    };
    let messages = match kind {
        Kind::Skipped => return Err(()),
        // Some rules of oxlint go by the directories that the file is in.
        Kind::Plain if fixture.plugin_of_oxlint().is_some() => {
            let absolute = [b"/", filename.strip_prefix(b"/").unwrap_or(filename)].concat();
            lint(&absolute, Place::Nowhere, None).ok_or(())?
        }
        Kind::Plain => lint(filename, Place::Nowhere, None).ok_or(())?,
        Kind::WithTestOnlyRules => {
            let rules = test_only_rules::Enabled::in_code(code);
            let messages =
                lint(filename, Place::Nowhere, Some(&|file| rules.prepare(file))).ok_or(())?;
            rules.finish(messages)
        }
        Kind::InProject => {
            let directory = project_of(entry.meta.plugin, fixture.plugin_of_oxlint().is_some());
            // A fixture that is not in the bundle yet has the names of the files as they were recorded.
            let project = match fixture.json.get(b"root").and_then(Json::as_str) {
                Some(root) => root.to_vec(),
                None => [flags.projects.ok_or(())?, b"/", directory].concat(),
            };
            let path = match filename.first() {
                Some(b'<' | b'/') => filename.to_vec(),
                _ => [&project[..], b"/", filename].concat(),
            };
            lint(&path, Place::Project(&project), None).ok_or(())?
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
                lint(&path, Place::Program(&tsconfig), None)
                    .map(|it| Outcome::new(entry, code, &it)),
                case,
                counts,
            ));
        }
    };
    if fixture.plugin_of_oxlint().is_some() {
        return Ok(problem_of_oxlint(entry, code, &messages, case, counts));
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

/// A failure at length.
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

/// The tests of a rule.
struct Fixture {
    /// `<plugin>/<rule>`, after the directory of the suite.
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

    /// The directory of the plugin, if oxlint is the judge.
    fn plugin_of_oxlint(&self) -> Option<&str> {
        let rest = self.id.strip_prefix("oxlint/")?;
        rest.get(..rest.len().checked_sub(self.entry.meta.name.len() + 1)?)
    }
}

/// A case that is run.
#[derive(Copy, Clone)]
struct Chosen {
    fixture: usize,
    index: usize,
    kind: Kind,
}

/// The name of the rule whose tests are at `path` in the bundle, if it is a rule of the plugin in
/// `directory`.
fn rule_at<'p>(path: &'p [u8], directory: &[u8]) -> Option<&'p [u8]> {
    path.strip_prefix(directory)?
        .strip_prefix(b"/")?
        .strip_suffix(b".json")
}

/// Runs the tests in `bundle` and prints the cases that fail, one per line, and the totals.
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
        rules.sort_unstable();
        for (name, path) in rules {
            if flags.rule.is_some_and(|only| only != name) {
                continue;
            }
            let id = format!("{directory}/{}", BStr::new(name));
            // oxlint has `react-hooks/exhaustive-deps` as `react/exhaustive-deps`.
            let is_of_oxlint = directory.starts_with("oxlint/");
            let registry = host.registry();
            let Some(entry) = registry.get_preferring(*plugin, name, is_of_oxlint) else {
                missing += 1;
                continue;
            };
            let text = bundle.read(path).map(|text| match flags.projects {
                Some(projects) if strings::contains(text, PROJECT) => {
                    let project = [projects, b"/", project_of(*plugin, is_of_oxlint)].concat();
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

    // How many cases have been counted for `--every`, without and with types.
    let (mut untyped, mut typed) = (0, 0);
    let mut chosen = Vec::new();
    for (fixture, it) in fixtures.iter_mut().enumerate() {
        let is_of_oxlint = it.plugin_of_oxlint().is_some();
        let Fixture {
            entry, json, tally, ..
        } = it;
        for (index, case) in cases_of(json).iter().enumerate() {
            let kind = kind_of(entry, case, is_of_oxlint);
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
    // Those with types take a hundred times as long: they are begun first.
    let mut order: Vec<usize> = (0..chosen.len()).collect();
    order.sort_by_key(|&at| chosen[at].kind != Kind::Typed);
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
        let mut at_length = String::new();
        for (index, problem) in failures {
            if !flags.table {
                output_line!("FAIL {id}#{index} {}", problem.summary);
            }
            if flags.verbose || flags.report.is_some() {
                describe(*index, &fixture.cases()[*index], problem, &mut at_length);
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
        if flags.verbose && !at_length.is_empty() {
            output_line!("{}", at_length.trim_end_matches('\n'));
        }
        if let Some(report) = flags.report {
            write_file(
                &[report, b"/", id.as_bytes(), b".txt"].concat(),
                at_length.as_bytes(),
            );
        }
        total.passed += tally.passed;
        total.failed += tally.failed;
        total.skipped += tally.skipped;
    }
    if fixtures.iter().any(|it| it.plugin_of_oxlint().is_some()) {
        output_line!(
            "\n{} messages lack the help that oxlint has",
            counts.lacking_help.load(Ordering::Relaxed)
        );
    }
    output_line!(
        "\n{} cases have their messages in another order",
        counts.in_another_order.load(Ordering::Relaxed)
    );
    output_line!(
        "\n{} rules, {perfect} without failures, {missing} not implemented\n{} cases passed, {} failed, {} skipped",
        fixtures.len(),
        total.passed,
        total.failed,
        total.skipped
    );
}

/// `--run-eslint-tests <bundle> ..`: `args` is what follows. Returns whether the tests could be
/// run. The caller of the command compares what is printed.
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
