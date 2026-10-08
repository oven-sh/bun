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

mod compare;
mod test_only_rules;

pub use bun_format_conformance::{Bundle, read_file, write_line};
pub use compare::{Edit, Outcome, Problem, Reported, Suggested, expected_messages, problem_of, string_of};

use bstr::BStr;
use bun_core::strings;
use bun_format_conformance::output_line;
use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, Linter, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use std::fmt::Write as _;
use std::sync::OnceLock;

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
    fn linter(&self) -> &Linter;

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
}

impl<'a> Flags<'a> {
    pub fn parse(args: &[&'a [u8]]) -> Flags<'a> {
        let flag = |name: &[u8]| args.iter().find_map(|it| it.strip_prefix(b"--")?.strip_prefix(name)?.strip_prefix(b"="));
        let number = |name: &[u8]| flag(name).and_then(|it| std::str::from_utf8(it).ok()?.parse().ok());
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
        }
    }
}

/// The directories of the bundle that have those of `PLUGINS`, by name.
const SUITES: [(&str, &str); 4] = [
    ("upstream", ""),
    ("reviews", "more/reviews/"),
    ("oxlint-tsgolint", "more/oxlint-tsgolint/"),
    ("typescript-parser", "more/typescript-parser/"),
];

/// The directories of a suite that have the tests of rules.
const PLUGINS: [(&str, Plugin); 6] = [
    ("eslint", Plugin::Eslint),
    ("typescript-eslint", Plugin::TypeScript),
    ("react-hooks", Plugin::ReactHooks),
    ("import", Plugin::Import),
    ("n", Plugin::Node),
    ("oxc", Plugin::Oxc),
];

/// The directories of the bundle that are written to the disk.
const PROJECTS: [&[u8]; 4] = [b"import-project/", b"n-project/", b"typescript-eslint-project/", b"node_modules/"];

fn write_file(path: &[u8], contents: &[u8]) {
    if let Some(end) = strings::last_index_of_char(path, b'/').filter(|&end| end > 0) {
        let _ = bun_sys::mkdir_recursive(&path[..end]);
    }
    let _ = bun_sys::File::write_file(bun_core::Fd::cwd(), &bun_core::ZBox::from_bytes(path), contents);
}

/// The configuration that the `RuleTester` of the plugin lints a case with: only that rule, as an
/// error.
pub fn config_of(linter: &Linter, entry: &'static RuleEntry, case: &Json) -> ResolvedConfig {
    let mut rule = vec![Json::Number(2.0)];
    rule.extend_from_slice(case.get(b"options").and_then(Json::as_array).unwrap_or_default());
    let config = Json::Object(vec![
        (b"languageOptions".to_vec(), case.get(b"languageOptions").cloned().unwrap_or(Json::Null)),
        (b"settings".to_vec(), case.get(b"settings").cloned().unwrap_or(Json::Null)),
        (b"rules".to_vec(), Json::Object(vec![(RuleId::Known(entry.meta).to_vec(), Json::Array(rule))])),
    ]);
    let mut config = ResolvedConfig::from_json(linter.registry(), &config, &mut Vec::new());
    // The `RuleTester` of typescript-eslint sets it, that of ESLint does not.
    config.linter.report_unused_disable_directives = match entry.meta.plugin {
        Plugin::TypeScript => Severity::Warn,
        _ => Severity::Off,
    };
    config
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

fn kind_of(entry: &RuleEntry, case: &Json) -> Kind {
    let is_type_aware = case.get(b"typeAware").and_then(Json::as_bool) == Some(true);
    match string_of(case, b"skip") {
        Some(skip) if test_only_rules::is_known(skip) => Kind::WithTestOnlyRules,
        // `@typescript-eslint/parser` without its services.
        None | Some(b"parser: custom") if is_type_aware => Kind::Typed,
        None | Some(b"parser: custom") if entry.meta.needs_modules || entry.meta.plugin == Plugin::Node => Kind::InProject,
        None | Some(b"parser: custom") => Kind::Plain,
        Some(_) => Kind::Skipped,
    }
}

/// What is wrong with what is reported for `case`, a test of the rule `entry`. `Err`: it cannot be
/// run here.
fn run_case(host: &dyn Host, flags: &Flags, entry: &'static RuleEntry, case: &Json, kind: Kind) -> Result<Option<Problem>, ()> {
    let code = string_of(case, b"code").unwrap_or_default();
    let filename = string_of(case, b"filename").unwrap_or(b"file.js");
    let config = config_of(host.linter(), entry, case);
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
        Kind::Plain => lint(filename, Place::Nowhere, None).ok_or(())?,
        Kind::WithTestOnlyRules => {
            let rules = test_only_rules::Enabled::in_code(code);
            let messages = lint(filename, Place::Nowhere, Some(&|file| rules.prepare(file))).ok_or(())?;
            rules.finish(messages)
        }
        Kind::InProject => {
            let directory: &[u8] = if entry.meta.plugin == Plugin::Node { b"n-project" } else { b"import-project" };
            let project = [flags.projects.ok_or(())?, b"/", directory].concat();
            lint(&in_directory(directory).ok_or(())?, Place::Project(&project), None).ok_or(())?
        }
        Kind::Typed => {
            let tsconfig = string_of(case, b"tsconfig").unwrap_or(b"tsconfig.json");
            let tsconfig = [flags.projects.ok_or(())?, b"/typescript-eslint-project/", tsconfig].concat();
            let path = in_directory(b"typescript-eslint-project").ok_or(())?;
            return Ok(problem_of(lint(&path, Place::Program(&tsconfig), None).map(|it| Outcome::new(entry, code, &it)), case));
        }
    };
    Ok(problem_of(Some(Outcome::new(entry, code, &messages)), case))
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
    case.get(b"options").unwrap_or(&Json::Null).stringify(&mut options);
    let _ = writeln!(
        into,
        "──── case {index} ({}) {} {}\noptions: {}\ncode:\n{}\n{}\n{}\n",
        if expected_messages(case).is_empty() { "valid" } else { "invalid" },
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
    fixture.get(b"cases").and_then(Json::as_array).unwrap_or_default()
}

impl Fixture {
    fn cases(&self) -> &[Json] {
        cases_of(&self.json)
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
    path.strip_prefix(directory)?.strip_prefix(b"/")?.strip_suffix(b".json")
}

/// Runs the tests in `bundle` and prints the cases that fail, one per line, and the totals.
pub fn run(bundle: &Bundle<'_>, flags: &Flags<'_>, host: &dyn Host) {
    if let (true, Some(projects)) = (flags.extract, flags.projects) {
        for path in bundle.paths().filter(|path| PROJECTS.iter().any(|it| path.starts_with(it))) {
            write_file(&[projects, b"/", path].concat(), bundle.read(path).unwrap_or_default());
        }
    }
    let (mut fixtures, mut missing) = (Vec::new(), 0);
    let suites = SUITES.iter().filter(|(name, prefix)| match flags.suite {
        Some(b"more") => !prefix.is_empty(),
        Some(only) => only == name.as_bytes(),
        None => true,
    });
    for ((_, prefix), (directory, plugin)) in suites.flat_map(|suite| PLUGINS.iter().map(move |plugin| (suite, plugin))) {
        if flags.plugin.is_some_and(|only| only != directory.as_bytes()) {
            continue;
        }
        let directory = format!("{prefix}{directory}");
        let mut rules: Vec<(&[u8], &[u8])> = bundle.paths().filter_map(|path| Some((rule_at(path, directory.as_bytes())?, path))).collect();
        rules.sort_unstable();
        for (name, path) in rules {
            if flags.rule.is_some_and(|only| only != name) {
                continue;
            }
            let id = format!("{directory}/{}", BStr::new(name));
            let Some(entry) = host.linter().registry().get(*plugin, name) else {
                missing += 1;
                continue;
            };
            match bundle.read(path).and_then(bun_lint::json::parse) {
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
        let Fixture { entry, json, tally, .. } = it;
        for (index, case) in cases_of(json).iter().enumerate() {
            let kind = kind_of(entry, case);
            if kind == Kind::Skipped || (kind == Kind::Typed && !flags.types) {
                tally.skipped += 1;
                continue;
            }
            let (counter, every) = match kind {
                Kind::Typed => (&mut typed, flags.every_typed),
                _ => (&mut untyped, flags.every),
            };
            if *counter % every == flags.first % every {
                chosen.push(Chosen { fixture, index, kind });
            }
            *counter += 1;
        }
    }
    // Those with types take a hundred times as long: they are begun first.
    let mut order: Vec<usize> = (0..chosen.len()).collect();
    order.sort_by_key(|&at| chosen[at].kind != Kind::Typed);
    let results: Vec<OnceLock<Result<Option<Problem>, ()>>> = chosen.iter().map(|_| OnceLock::new()).collect();
    host.for_each(flags.threads, chosen.len(), &|at| {
        let at = order[at];
        let (it, fixture) = (chosen[at], &fixtures[chosen[at].fixture]);
        let _ = results[at].set(run_case(host, flags, fixture.entry, &fixture.cases()[it.index], it.kind));
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
            output_line!("{verdict} {id}: {} passed, {} failed, {} skipped", tally.passed, tally.failed, tally.skipped);
        }
        if flags.verbose && !at_length.is_empty() {
            output_line!("{}", at_length.trim_end_matches('\n'));
        }
        if let Some(report) = flags.report {
            write_file(&[report, b"/", id.as_bytes(), b".txt"].concat(), at_length.as_bytes());
        }
        total.passed += tally.passed;
        total.failed += tally.failed;
        total.skipped += tally.skipped;
    }
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
