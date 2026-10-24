use super::TestFailure;
use super::check_lines::{BLANKS, CheckKind, CheckLine, parse_check_pattern, validate_check_lines};
use bun_aot::ir::generated::{InternalErrorKind, StatisticId, UserDiagnosticKind};
use std::str::FromStr;

const COMMENT_MARK: &str = "//";
const DEFAULT_PREFIX: &str = "CHECK";
const RESERVED_NAMES: [&str; 6] = ["RUN", "FORM", "OPTIONS", "DIAGNOSTIC", "STATISTIC", "CHECK"];
const TEST_FILE_EXTENSIONS: [&str; 8] =
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const DECLARATION_FILE_EXTENSIONS: [&str; 3] = [".d.ts", ".d.mts", ".d.cts"];
const MAX_CHECK_COUNT: u32 = 1000;
const MAX_TYPESCRIPT_CODE_DIGITS: usize = 9;
const DIAGNOSTIC_SYNTAX: &str = "DIAGNOSTIC is written <name> [ <count> ]";
const STATISTIC_SYNTAX: &str = "STATISTIC is written <name> = | >= | <= <n>";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DiagnosticName {
    User(UserDiagnosticKind),
    Internal(InternalErrorKind),
    FrontEnd(u32),
    Build,
    Resolve,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StatisticComparison {
    Equal,
    AtLeast,
    AtMost,
}

pub struct RunDirective {
    pub prefix: String,
    pub command: String,
    pub arguments: Vec<String>,
    pub line: u32,
}

pub struct OptionWord {
    pub word: String,
    pub line: u32,
}

pub struct ExpectedDiagnostic {
    pub name: DiagnosticName,
    pub count: Option<u32>,
    pub line: u32,
}

pub struct ExpectedStatistic {
    pub name: StatisticId,
    pub comparison: StatisticComparison,
    pub value: u64,
    pub line: u32,
}

pub struct CheckGroup {
    pub prefix: String,
    pub lines: Vec<CheckLine>,
}

#[derive(Default)]
pub struct TestFile {
    pub runs: Vec<RunDirective>,
    pub option_words: Vec<OptionWord>,
    pub check_groups: Vec<CheckGroup>,
    pub diagnostics: Vec<ExpectedDiagnostic>,
    pub statistics: Vec<ExpectedStatistic>,
    pub errors: Vec<TestFailure>,
}

pub fn is_test_file_name(name: &str) -> bool {
    let ends_with_any = |extensions: &[&str]| extensions.iter().any(|&end| name.ends_with(end));
    ends_with_any(&TEST_FILE_EXTENSIONS) && !ends_with_any(&DECLARATION_FILE_EXTENSIONS)
}

pub fn parse_test_file(text: &str) -> TestFile {
    let mut file = TestFile::default();
    let (runs, others): (Vec<_>, Vec<_>) = text
        .lines()
        .zip(1..)
        .filter_map(|(line, number)| split_directive(line, number))
        .partition(|directive| directive.name == "RUN");
    if runs.is_empty() {
        let message = "the file has no RUN line";
        file.errors.push(TestFailure::new(1, message));
    }
    for directive in runs.iter().chain(&others) {
        if let Err(message) = file.parse_directive(directive) {
            file.errors.push(TestFailure::new(directive.line, message));
        }
    }
    for group in &file.check_groups {
        if let Err(error) = validate_check_lines(&group.lines) {
            file.errors.push(error);
        }
        if group.lines.is_empty()
            && group.prefix != DEFAULT_PREFIX
            && let Some(run) = file.runs.iter().find(|run| run.prefix == group.prefix)
        {
            let message = format!("no line has the prefix {}", group.prefix);
            file.errors.push(TestFailure::new(run.line, message));
        }
    }
    file.errors.sort_by_key(|error| error.line);
    file
}

pub fn holds(comparison: StatisticComparison, actual: u64, expected: u64) -> bool {
    match comparison {
        StatisticComparison::Equal => actual == expected,
        StatisticComparison::AtLeast => actual >= expected,
        StatisticComparison::AtMost => actual <= expected,
    }
}

struct DirectiveLine<'a> {
    name: &'a str,
    parenthesized: Option<&'a str>,
    value: &'a str,
    line: u32,
}

fn split_directive(line: &str, number: u32) -> Option<DirectiveLine<'_>> {
    let comment = line
        .trim_start_matches(BLANKS)
        .strip_prefix(COMMENT_MARK)?
        .trim_start_matches(BLANKS);
    let rest = comment.trim_start_matches(is_name_char);
    let name = &comment[..comment.len() - rest.len()];
    if !is_name(name) {
        return None;
    }
    let (parenthesized, rest) = match rest.strip_prefix('(') {
        Some(rest) => {
            let (text, rest) = rest.split_once(')')?;
            (Some(text), rest)
        }
        None => (None, rest),
    };
    Some(DirectiveLine {
        name,
        parenthesized,
        value: rest.strip_prefix(':')?.trim_matches(BLANKS),
        line: number,
    })
}

fn is_name_char(character: char) -> bool {
    character.is_ascii_uppercase() || character.is_ascii_digit() || character == '-'
}

fn is_name(text: &str) -> bool {
    text.starts_with(|first: char| first.is_ascii_uppercase()) && text.chars().all(is_name_char)
}

fn is_valid_prefix(text: &str) -> bool {
    is_name(text) && !text.contains('-') && !RESERVED_NAMES.contains(&text)
}

fn split_words(value: &str) -> impl Iterator<Item = &str> {
    value.split(BLANKS).filter(|word| !word.is_empty())
}

pub(super) fn parse_decimal<T: FromStr>(word: &str) -> Option<T> {
    let is_decimal = word.bytes().all(|byte| byte.is_ascii_digit());
    if is_decimal { word.parse().ok() } else { None }
}

pub(super) fn parse_engine_diagnostic_name(word: &str) -> Option<DiagnosticName> {
    let user_kind = UserDiagnosticKind::from_name(word);
    if let Some(kind) = user_kind.filter(|&kind| kind != UserDiagnosticKind::Unknown) {
        return Some(DiagnosticName::User(kind));
    }
    let internal_kind = InternalErrorKind::from_name(word);
    internal_kind
        .filter(|&kind| kind != InternalErrorKind::Unknown)
        .map(DiagnosticName::Internal)
}

fn parse_diagnostic_name(word: &str) -> Option<DiagnosticName> {
    if let Some(name) = parse_engine_diagnostic_name(word) {
        return Some(name);
    }
    match word {
        "Build" => return Some(DiagnosticName::Build),
        "Resolve" => return Some(DiagnosticName::Resolve),
        _ => {}
    }
    let digits = word.strip_prefix("TS")?;
    if digits.len() > MAX_TYPESCRIPT_CODE_DIGITS {
        return None;
    }
    parse_decimal::<u32>(digits)
        .filter(|&code| code != 0)
        .map(DiagnosticName::FrontEnd)
}

fn find_group(groups: &[CheckGroup], prefix: &str) -> Option<usize> {
    groups.iter().position(|group| group.prefix == prefix)
}

impl TestFile {
    pub fn check_lines_for(&self, prefix: &str) -> &[CheckLine] {
        let group = find_group(&self.check_groups, prefix).expect("every RUN has a check group");
        &self.check_groups[group].lines
    }

    fn parse_directive(&mut self, directive: &DirectiveLine<'_>) -> Result<(), String> {
        match (directive.name, directive.parenthesized) {
            ("RUN", _) => self.parse_run(directive),
            (name, Some(_)) => Err(format!("unknown directive {name}(..)")),
            ("FORM", None) => Err("FORM is for the engine's tests".to_owned()),
            ("OPTIONS", None) if directive.value.is_empty() => {
                Err("OPTIONS needs a word".to_owned())
            }
            ("OPTIONS", None) => {
                let line = directive.line;
                let words = split_words(directive.value).map(str::to_owned);
                self.option_words
                    .extend(words.map(|word| OptionWord { word, line }));
                Ok(())
            }
            ("DIAGNOSTIC", None) => self.parse_diagnostic(directive),
            ("STATISTIC", None) => self.parse_statistic(directive),
            (_, None) => self.parse_check_line(directive),
        }
    }

    fn parse_run(&mut self, directive: &DirectiveLine<'_>) -> Result<(), String> {
        let prefix = match directive.parenthesized {
            Some(prefix) if is_valid_prefix(prefix) => prefix,
            Some(text) => return Err(format!("{text} cannot be a prefix")),
            None => DEFAULT_PREFIX,
        };
        if find_group(&self.check_groups, prefix).is_none() {
            self.check_groups.push(CheckGroup {
                prefix: prefix.to_owned(),
                lines: Vec::new(),
            });
        }
        let mut words = split_words(directive.value);
        let command = words.next().ok_or("RUN needs a command")?;
        self.runs.push(RunDirective {
            prefix: prefix.to_owned(),
            command: command.to_owned(),
            arguments: words.map(str::to_owned).collect(),
            line: directive.line,
        });
        Ok(())
    }

    fn parse_check_line(&mut self, directive: &DirectiveLine<'_>) -> Result<(), String> {
        let unknown_directive = || format!("unknown directive {}", directive.name);
        let (prefix, suffix) = match directive.name.split_once('-') {
            Some((prefix, suffix)) => (prefix, Some(suffix)),
            None => (directive.name, None),
        };
        let group = find_group(&self.check_groups, prefix).ok_or_else(unknown_directive)?;
        let (kind, count) = match suffix {
            None => (CheckKind::Plain, 1),
            Some("NEXT") => (CheckKind::Next, 1),
            Some("NOT") => (CheckKind::Not, 1),
            Some("LABEL") => (CheckKind::Label, 1),
            Some(suffix) => {
                let digits = suffix
                    .strip_prefix("COUNT-")
                    .ok_or_else(unknown_directive)?;
                match parse_decimal::<u32>(digits) {
                    Some(count @ 1..=MAX_CHECK_COUNT) => (CheckKind::Count, count),
                    _ => return Err(format!("the count must be 1 to {MAX_CHECK_COUNT}")),
                }
            }
        };
        let elements = parse_check_pattern(directive.value)?;
        self.check_groups[group].lines.push(CheckLine {
            kind,
            count,
            line: directive.line,
            pattern: directive.value.to_owned(),
            elements,
        });
        Ok(())
    }

    fn parse_diagnostic(&mut self, directive: &DirectiveLine<'_>) -> Result<(), String> {
        let words: Vec<&str> = split_words(directive.value).collect();
        let (word, count) = match words[..] {
            [word] => (word, None),
            [word, count] => (word, Some(count)),
            _ => return Err(DIAGNOSTIC_SYNTAX.to_owned()),
        };
        let Some(name) = parse_diagnostic_name(word) else {
            return Err(format!("unknown diagnostic {word}"));
        };
        let count = match count.map(parse_decimal::<u32>) {
            None => None,
            Some(Some(count)) if count > 0 => Some(count),
            Some(_) => return Err("the count must be above 0".to_owned()),
        };
        if self.diagnostics.iter().any(|listed| listed.name == name) {
            return Err(format!("{word} is listed twice"));
        }
        self.diagnostics.push(ExpectedDiagnostic {
            name,
            count,
            line: directive.line,
        });
        Ok(())
    }

    fn parse_statistic(&mut self, directive: &DirectiveLine<'_>) -> Result<(), String> {
        let words: Vec<&str> = split_words(directive.value).collect();
        let [word, comparison, value] = words[..] else {
            return Err(STATISTIC_SYNTAX.to_owned());
        };
        let Some(name) = StatisticId::from_name(word).filter(|&id| id != StatisticId::None) else {
            return Err(format!("unknown statistic {word}"));
        };
        let comparison = match comparison {
            "=" => StatisticComparison::Equal,
            ">=" => StatisticComparison::AtLeast,
            "<=" => StatisticComparison::AtMost,
            _ => return Err(STATISTIC_SYNTAX.to_owned()),
        };
        self.statistics.push(ExpectedStatistic {
            name,
            comparison,
            value: parse_decimal(value).ok_or(STATISTIC_SYNTAX)?,
            line: directive.line,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::CheckKind::{Count, Label, Next, Not, Plain};
    use super::StatisticComparison::{AtLeast, AtMost, Equal};
    use super::*;

    #[track_caller]
    fn parse_without_errors(text: &str) -> TestFile {
        let file = parse_test_file(text);
        assert!(file.errors.is_empty(), "{:?}", file.errors);
        file
    }

    #[track_caller]
    fn expect_error(text: &str, line: u32, message: &str) {
        let expected = TestFailure::new(line, message);
        assert_eq!(parse_test_file(text).errors, [expected], "{text}");
    }

    #[track_caller]
    fn expect_error_after_run(directive: &str, message: &str) {
        expect_error(&format!("// RUN: lower\n{directive}\n"), 2, message);
    }

    #[track_caller]
    fn check_kinds_of(text: &str, prefix: &str) -> Vec<(CheckKind, u32)> {
        let file = parse_without_errors(text);
        let checks = file.check_lines_for(prefix).iter();
        checks.map(|check| (check.kind, check.count)).collect()
    }

    /// What `parse_check_line` reads off the part of a directive's name that follows the prefix.
    fn parse_check_kind(suffix: Option<&str>) -> Result<(CheckKind, u32), String> {
        let mut file = parse_without_errors("// RUN: lower\n");
        let name = match suffix {
            Some(suffix) => format!("CHECK-{suffix}"),
            None => "CHECK".to_owned(),
        };
        file.parse_check_line(&DirectiveLine {
            name: &name,
            parenthesized: None,
            value: "x",
            line: 2,
        })?;
        let [check] = file.check_lines_for("CHECK") else {
            panic!("CHECK has one line");
        };
        Ok((check.kind, check.count))
    }

    #[test]
    fn test_file_names() {
        for name in [
            "add.ts", "add.tsx", "add.mts", "add.cts", "add.js", "add.jsx", "add.mjs", "add.cjs",
        ] {
            assert!(is_test_file_name(name), "{name}");
        }
        for name in [
            "add.d.ts",
            "add.d.mts",
            "add.d.cts",
            "add.ir",
            "add.json",
            "tsconfig.json",
            "package.json",
            "add.ts.txt",
            "ts",
        ] {
            assert!(!is_test_file_name(name), "{name}");
        }
    }

    #[test]
    fn runs_and_check_groups() {
        let text = [
            "// CHECK: Add",
            "//RUN: lower a \t b",
            "// RUN(SECOND): link",
            " \t// SECOND-NOT: x",
            "// CHECK-COUNT-3:   x  y ",
            "// RUN: link",
            "",
        ]
        .join("\r\n");
        let file = parse_without_errors(&text);

        let runs = file.runs.iter();
        let runs: Vec<_> = runs
            .map(|run| (&*run.prefix, &*run.command, run.line))
            .collect();
        let expected = [
            ("CHECK", "lower", 2),
            ("SECOND", "link", 3),
            ("CHECK", "link", 6),
        ];
        assert_eq!(runs, expected);
        assert_eq!(file.runs[0].arguments, ["a", "b"]);
        assert!(file.runs[1].arguments.is_empty());

        let groups = file.check_groups.iter();
        let prefixes: Vec<_> = groups.map(|group| group.prefix.as_str()).collect();
        assert_eq!(prefixes, ["CHECK", "SECOND"]);
        let [add, counted] = file.check_lines_for("CHECK") else {
            panic!("CHECK has two lines");
        };
        assert_eq!((add.kind, add.count, add.line), (Plain, 1, 1));
        assert_eq!((counted.kind, counted.count, counted.line), (Count, 3, 5));
        assert_eq!(counted.pattern, "x  y");
        assert_eq!(counted.elements, parse_check_pattern("x y").unwrap());
        let [excluded] = file.check_lines_for("SECOND") else {
            panic!("SECOND has one line");
        };
        assert_eq!((excluded.kind, excluded.line), (Not, 4));
    }

    #[test]
    fn check_kinds() {
        let text = "// RUN: lower\n// CHECK-LABEL: a\n// CHECK-NEXT: b\n// CHECK-COUNT-1000: c\n";
        let kinds = [(Label, 1), (Next, 1), (Count, 1000)];
        assert_eq!(check_kinds_of(text, "CHECK"), kinds);
        assert_eq!(parse_check_kind(None), Ok((Plain, 1)));
        assert_eq!(parse_check_kind(Some("NEXT")), Ok((Next, 1)));
        assert_eq!(parse_check_kind(Some("NOT")), Ok((Not, 1)));
        assert_eq!(parse_check_kind(Some("LABEL")), Ok((Label, 1)));
        assert_eq!(parse_check_kind(Some("COUNT-1")), Ok((Count, 1)));
        assert_eq!(
            parse_check_kind(Some("COUNT-1000")),
            Ok((Count, MAX_CHECK_COUNT))
        );
    }

    #[test]
    fn check_kind_errors() {
        for suffix in ["", "NXT", "next", "COUNT"] {
            assert_eq!(
                parse_check_kind(Some(suffix)),
                Err(format!("unknown directive CHECK-{suffix}")),
                "{suffix}"
            );
        }
        for suffix in [
            "COUNT-",
            "COUNT-0",
            "COUNT-1001",
            "COUNT-+1",
            "COUNT-1-2",
            "COUNT-A",
            "COUNT-99999999999",
        ] {
            assert_eq!(
                parse_check_kind(Some(suffix)),
                Err(format!("the count must be 1 to {MAX_CHECK_COUNT}")),
                "{suffix}"
            );
        }
    }

    #[test]
    fn prefix_may_equal_check_suffix() {
        let text = "// RUN(NEXT): lower\n// NEXT: a\n// NEXT-NEXT: b\n// NEXT-COUNT-2: c\n\
            // NEXT-COUNT-1: d\n";
        let kinds = [(Plain, 1), (Next, 1), (Count, 2), (Count, 1)];
        assert_eq!(check_kinds_of(text, "NEXT"), kinds);
    }

    #[test]
    fn run_without_check_lines() {
        let file = parse_without_errors("// RUN: link\n");
        assert!(file.check_lines_for("CHECK").is_empty());
    }

    #[test]
    #[should_panic(expected = "every RUN has a check group")]
    fn check_lines_for_unknown_prefix() {
        parse_test_file("// RUN: link\n").check_lines_for("OTHER");
    }

    #[test]
    fn directives_are_whole_line_comments() {
        let text = "//RUN: lower\n  // CHECK: Add\n# RUN: link\nconst a = 1; // CHECK: no\n";
        let file = parse_without_errors(text);
        assert_eq!(file.runs.len(), 1);
        assert_eq!(file.runs[0].command, "lower");
        assert_eq!(file.check_lines_for("CHECK").len(), 1);
        expect_error("# RUN: lower\n", 1, "the file has no RUN line");
    }

    #[test]
    fn other_lines_are_input() {
        let text = [
            "// RUN: lower",
            "// A comment",
            "//",
            "// CHECK without a colon",
            "// check: x",
            "// 1CHECK: x",
            "// -CHECK: x",
            "// CHECK : x",
            "// CHECK (x): y",
            "// CHECK(x: y",
            "// CHECK(x) : y",
            "// CHECK-next: x",
            "// CHECK-COUNT-+1: x",
            "/// CHECK: x",
            "/* CHECK: x */",
            "const sum = a + b;   // CHECK: NoSuchText",
        ]
        .join("\n");
        let file = parse_without_errors(&text);
        assert!(file.check_lines_for("CHECK").is_empty());
    }

    #[test]
    fn run_errors() {
        expect_error("export {};\n", 1, "the file has no RUN line");
        expect_error("", 1, "the file has no RUN line");
        expect_error("// RUN:\n", 1, "RUN needs a command");
        expect_error("// RUN:\n// CHECK: x\n", 1, "RUN needs a command");
        expect_error("// RUN(lower): lower\n", 1, "lower cannot be a prefix");
        expect_error("// RUN(A-B): lower\n", 1, "A-B cannot be a prefix");
        expect_error("// RUN(1A): lower\n", 1, "1A cannot be a prefix");
        expect_error("// RUN(): lower\n", 1, " cannot be a prefix");
        for name in RESERVED_NAMES {
            let text = format!("// RUN({name}): lower\n");
            expect_error(&text, 1, &format!("{name} cannot be a prefix"));
        }
        expect_error("// RUN(ONLY): lower\n", 1, "no line has the prefix ONLY");
        let text = "// RUN: lower\n// RUN(ONLY): lower\n// RUN(ONLY): link\n";
        expect_error(text, 2, "no line has the prefix ONLY");
    }

    #[test]
    fn unknown_directives() {
        expect_error_after_run("// FORM(X): AsRead", "unknown directive FORM(..)");
        expect_error_after_run("// CHECK(X): x", "unknown directive CHECK(..)");
        for name in [
            "NOTE",
            "L0",
            "OTHER",
            "OTHER-NOT",
            "CHECK-NXT",
            "CHECK-COUNT",
            "CHECK-",
        ] {
            let message = format!("unknown directive {name}");
            expect_error_after_run(&format!("// {name}: x"), &message);
        }
        let text = "// RUN(ONLY): lower\n// ONLY: x\n// CHECK: x\n";
        expect_error(text, 3, "unknown directive CHECK");
    }

    #[test]
    fn check_line_errors() {
        for name in [
            "CHECK-COUNT-0",
            "CHECK-COUNT-1001",
            "CHECK-COUNT-",
            "CHECK-COUNT-1-2",
            "CHECK-COUNT-A",
            "CHECK-COUNT-99999999999",
        ] {
            expect_error_after_run(&format!("// {name}: x"), "the count must be 1 to 1000");
        }
        expect_error_after_run("// CHECK:", "the pattern is empty");
        let message = "only {{*}} can be written with {{: there are no regular expressions";
        expect_error_after_run("// CHECK: {{x}}", message);
        expect_error_after_run("// CHECK: [[1]]", "a variable is written [[name]]");
        expect_error_after_run("// CHECK-NOT: {{*}}", "the pattern matches every line");
        let message = "CHECK-NEXT needs a match directly before it";
        expect_error_after_run("// CHECK-NEXT: x", message);
        expect_error_after_run("// CHECK-LABEL: [[x]]", "a label cannot use a variable");
    }

    #[test]
    fn options() {
        let text = "// RUN: lower\n// OPTIONS: a \t b=1\n// OPTIONS: c\n";
        let file = parse_without_errors(text);
        let words = file.option_words.iter();
        let words: Vec<_> = words.map(|word| (&*word.word, word.line)).collect();
        assert_eq!(words, [("a", 2), ("b=1", 2), ("c", 3)]);
        expect_error_after_run("// OPTIONS:", "OPTIONS needs a word");
    }

    #[test]
    fn form_belongs_to_engine_tests() {
        for value in ["AsRead", "Placed", "Later", ""] {
            let directive = format!("// FORM: {value}");
            expect_error_after_run(&directive, "FORM is for the engine's tests");
        }
    }

    #[test]
    fn diagnostics() {
        let text = "// RUN: link\n// DIAGNOSTIC: UnprovenInt32 2\n\
            // DIAGNOSTIC: IdOutOfRange\n// DIAGNOSTIC: TS2322";
        let file = parse_without_errors(text);
        let listed = file.diagnostics.iter();
        let listed: Vec<_> = listed.map(|one| (one.name, one.count, one.line)).collect();
        let unproven = DiagnosticName::User(UserDiagnosticKind::UnprovenInt32);
        let out_of_range = DiagnosticName::Internal(InternalErrorKind::IdOutOfRange);
        let type_error = DiagnosticName::FrontEnd(2322);
        let expected = [
            (unproven, Some(2), 2),
            (out_of_range, None, 3),
            (type_error, None, 4),
        ];
        assert_eq!(listed, expected);
        let largest_code = Some(DiagnosticName::FrontEnd(999_999_999));
        assert_eq!(parse_diagnostic_name("TS999999999"), largest_code);
        assert_eq!(parse_diagnostic_name("TS0"), None);
        assert_eq!(parse_diagnostic_name("Build"), Some(DiagnosticName::Build));
        let resolve = Some(DiagnosticName::Resolve);
        assert_eq!(parse_diagnostic_name("Resolve"), resolve);
    }

    #[test]
    fn engine_names_are_engine_kinds_only() {
        for kind in UserDiagnosticKind::ALL.into_iter().skip(1) {
            let parsed = parse_engine_diagnostic_name(kind.name());
            assert_eq!(parsed, Some(DiagnosticName::User(kind)));
        }
        for kind in InternalErrorKind::ALL.into_iter().skip(1) {
            let parsed = parse_engine_diagnostic_name(kind.name());
            assert_eq!(parsed, Some(DiagnosticName::Internal(kind)));
        }
        for word in ["Unknown", "TS2322", "Build", "Resolve", "unprovenInt32", ""] {
            assert_eq!(parse_engine_diagnostic_name(word), None, "{word}");
        }
    }

    #[test]
    fn diagnostic_errors() {
        for word in [
            "Nothing",
            "Unknown",
            "TS",
            "TS0",
            "TS00",
            "ts2322",
            "TS1234567890",
            "TS12x",
            "TS+1",
            "build",
            "resolve",
        ] {
            let directive = format!("// DIAGNOSTIC: {word}");
            expect_error_after_run(&directive, &format!("unknown diagnostic {word}"));
        }
        for count in ["0", "x", "-1", "+1", "4294967296"] {
            let directive = format!("// DIAGNOSTIC: UnprovenInt32 {count}");
            expect_error_after_run(&directive, "the count must be above 0");
        }
        expect_error_after_run("// DIAGNOSTIC:", DIAGNOSTIC_SYNTAX);
        expect_error_after_run("// DIAGNOSTIC: UnprovenInt32 1 2", DIAGNOSTIC_SYNTAX);
        let text = "// RUN: lower\n// DIAGNOSTIC: UnprovenInt32\n\
            // DIAGNOSTIC: UnprovenInt32 2\n";
        expect_error(text, 3, "UnprovenInt32 is listed twice");
        let text = "// RUN: lower\n// DIAGNOSTIC: TS2322\n// DIAGNOSTIC: TS2322\n";
        expect_error(text, 3, "TS2322 is listed twice");
    }

    #[test]
    fn statistics() {
        let text = [
            "// RUN: lower",
            "// STATISTIC: FunctionsLowered >= 1",
            "// STATISTIC: FunctionsLowered <= 18446744073709551615",
            "// STATISTIC: ProgramBytes = 64",
            "// STATISTIC: MaxNestingDepthHits = 0",
        ]
        .join("\n");
        let file = parse_without_errors(&text);
        let listed = file.statistics.iter();
        let listed: Vec<_> = listed
            .map(|listed| (listed.name, listed.comparison, listed.value, listed.line))
            .collect();
        let expected = [
            (StatisticId::FunctionsLowered, AtLeast, 1, 2),
            (StatisticId::FunctionsLowered, AtMost, u64::MAX, 3),
            (StatisticId::ProgramBytes, Equal, 64, 4),
            (StatisticId::MaxNestingDepthHits, Equal, 0, 5),
        ];
        assert_eq!(listed, expected);
    }

    #[test]
    fn statistic_errors() {
        for value in [
            "",
            "ProgramBytes",
            "ProgramBytes 1",
            "ProgramBytes = 1 2",
            "ProgramBytes == 1",
            "ProgramBytes > 1",
            "ProgramBytes = x",
            "ProgramBytes = +1",
            "ProgramBytes = 18446744073709551616",
        ] {
            expect_error_after_run(&format!("// STATISTIC: {value}"), STATISTIC_SYNTAX);
        }
        for word in [
            "None",
            "program_bytes",
            "MAX_NESTING_DEPTH",
            "9lives",
            "a-b",
        ] {
            let directive = format!("// STATISTIC: {word} = 0");
            expect_error_after_run(&directive, &format!("unknown statistic {word}"));
        }
    }

    #[test]
    fn errors_are_sorted_by_line() {
        let text = "// CHECK-NEXT: x\n// NOTE: y\n// RUN(lower): lower\n// RUN: lower\n";
        let file = parse_test_file(text);
        let lines: Vec<_> = file.errors.iter().map(|error| error.line).collect();
        assert_eq!(lines, [1, 2, 3]);
    }

    #[test]
    fn comparisons() {
        let outcomes = |comparison| [4, 5, 6].map(|actual| holds(comparison, actual, 5));
        assert_eq!(outcomes(Equal), [false, true, false]);
        assert_eq!(outcomes(AtLeast), [false, true, true]);
        assert_eq!(outcomes(AtMost), [true, true, false]);
    }
}
