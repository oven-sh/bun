use super::TestFailure;
use std::iter::once;
use std::ops::Range;

pub(super) const BLANKS: [char; 2] = [' ', '\t'];
const ANY_TEXT: &[u8] = b"{{*}}";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CheckKind {
    Plain,
    Next,
    Not,
    Label,
    Count,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PatternElement {
    Text(Vec<u8>),
    Blanks,
    AnyText,
    Variable(Vec<u8>),
}

#[derive(Clone, Debug)]
pub struct CheckLine {
    pub kind: CheckKind,
    pub count: u32,
    pub line: u32,
    pub pattern: String,
    pub elements: Vec<PatternElement>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CheckFailureKind {
    NoMatch,
    NotOnNextLine,
    ExcludedTextFound,
    LabelNotFound,
}

#[derive(Debug)]
pub struct CheckFailure {
    pub kind: CheckFailureKind,
    pub line: u32,
    pub message: String,
}

pub fn parse_check_pattern(pattern: &str) -> Result<Vec<PatternElement>, &'static str> {
    let mut rest = pattern.trim_matches(BLANKS).as_bytes();
    if rest.is_empty() {
        return Err("the pattern is empty");
    }
    let mut elements = Vec::new();
    let mut text = Vec::new();
    while let Some(&first) = rest.first() {
        let (element, length) = if is_blank(first) {
            (PatternElement::Blanks, count_leading(rest, is_blank))
        } else if rest.starts_with(b"{{") {
            if !rest.starts_with(ANY_TEXT) {
                return Err("only {{*}} can be written with {{: there are no regular expressions");
            }
            (PatternElement::AnyText, ANY_TEXT.len())
        } else if let Some(name_start) = rest.strip_prefix(b"[[") {
            let name = parse_variable_name(name_start).ok_or("a variable is written [[name]]")?;
            let length = name.len() + b"[[]]".len();
            (PatternElement::Variable(name.to_vec()), length)
        } else {
            text.push(first);
            rest = &rest[1..];
            continue;
        };
        if !text.is_empty() {
            elements.push(PatternElement::Text(std::mem::take(&mut text)));
        }
        elements.push(element);
        rest = &rest[length..];
    }
    if !text.is_empty() {
        elements.push(PatternElement::Text(text));
    }
    let matches_every_line = elements
        .iter()
        .all(|element| matches!(element, PatternElement::Blanks | PatternElement::AnyText));
    if matches_every_line {
        return Err("the pattern matches every line");
    }
    Ok(elements)
}

pub fn validate_check_lines(lines: &[CheckLine]) -> Result<(), TestFailure> {
    let mut previous_kind: Option<CheckKind> = None;
    for check in lines {
        let follows_match = previous_kind.is_some_and(|kind| kind != CheckKind::Not);
        if check.kind == CheckKind::Next && !follows_match {
            let message = "CHECK-NEXT needs a match directly before it";
            return Err(TestFailure::new(check.line, message));
        }
        let uses_variable = check
            .elements
            .iter()
            .any(|element| matches!(element, PatternElement::Variable(_)));
        if is_label(check) && uses_variable {
            let message = "a label cannot use a variable";
            return Err(TestFailure::new(check.line, message));
        }
        previous_kind = Some(check.kind);
    }
    Ok(())
}

pub fn match_check_lines(checks: &[CheckLine], output: &str) -> Result<(), CheckFailure> {
    let mut matcher = Matcher {
        lines: output.lines().map(str::as_bytes).collect(),
        bindings: Vec::new(),
    };
    let output_end = Position::line_start(matcher.lines.len());
    let mut labels: Vec<Span> = Vec::new();
    let mut cursor = Position::line_start(0);
    for check in checks.iter().filter(|check| is_label(check)) {
        let Some(label) = matcher.find(&check.elements, cursor..output_end) else {
            let summary = describe_no_match(check, cursor);
            return Err(matcher.fail(CheckFailureKind::LabelNotFound, check, summary, None));
        };
        cursor = label.end;
        labels.push(label);
    }
    let groups = checks.split(is_label);
    let opening_labels = once(None).chain(labels.iter().map(Some));
    let closing_labels = labels.iter().map(Some).chain(once(None));
    for ((group, opening), closing) in groups.zip(opening_labels).zip(closing_labels) {
        let end = closing.map_or(output_end, |label| Position::line_start(label.start.line));
        matcher.match_block(group, opening, end)?;
    }
    Ok(())
}

fn is_label(check: &CheckLine) -> bool {
    check.kind == CheckKind::Label
}

fn is_blank(byte: u8) -> bool {
    BLANKS.contains(&char::from(byte))
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'$')
}

fn is_variable_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn count_leading(bytes: &[u8], is_counted: fn(u8) -> bool) -> usize {
    bytes.iter().take_while(|&&byte| is_counted(byte)).count()
}

fn parse_variable_name(bytes: &[u8]) -> Option<&[u8]> {
    let (name, rest) = bytes.split_at(count_leading(bytes, is_variable_name_byte));
    let is_name = name.first().is_some_and(|first| !first.is_ascii_digit());
    (is_name && rest.starts_with(b"]]")).then_some(name)
}

fn describe_no_match(check: &CheckLine, from: Position) -> String {
    let (line, pattern) = (from.line + 1, &check.pattern);
    format!("nothing from output line {line} on matches: {pattern}")
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Position {
    line: usize,
    column: usize,
}

type Span = Range<Position>;

impl Position {
    fn line_start(line: usize) -> Position {
        Position { line, column: 0 }
    }

    fn start_column_on(self, line: usize) -> usize {
        if line == self.line { self.column } else { 0 }
    }
}

struct Matcher<'a> {
    lines: Vec<&'a [u8]>,
    bindings: Vec<(&'a [u8], &'a [u8])>,
}

impl<'a> Matcher<'a> {
    fn match_elements(
        &mut self,
        mut elements: &'a [PatternElement],
        text: &'a [u8],
        mut column: usize,
    ) -> Option<usize> {
        while let [element, following @ ..] = elements {
            let rest = &text[column..];
            column += match element {
                PatternElement::Text(expected) if rest.starts_with(expected) => expected.len(),
                PatternElement::Text(_) => return None,
                PatternElement::Blanks => match count_leading(rest, is_blank) {
                    0 => return None,
                    length => length,
                },
                PatternElement::Variable(name) => self.match_variable(name, text, column)?,
                PatternElement::AnyText => {
                    let (_, end) = self.find_in_text(following, text, column)?;
                    return Some(end);
                }
            };
            elements = following;
        }
        Some(column)
    }

    fn match_variable(&mut self, name: &'a [u8], text: &'a [u8], column: usize) -> Option<usize> {
        if column > 0 && is_token_byte(text[column - 1]) {
            return None;
        }
        let rest = &text[column..];
        let token = &rest[..count_leading(rest, is_token_byte)];
        if token.is_empty() {
            return None;
        }
        let bound = self.bindings.iter().find(|binding| binding.0 == name);
        match bound.map(|binding| binding.1) {
            Some(value) if value != token => return None,
            Some(_) => {}
            None => self.bindings.push((name, token)),
        }
        Some(token.len())
    }

    fn find_in_text(
        &mut self,
        elements: &'a [PatternElement],
        text: &'a [u8],
        first_start: usize,
    ) -> Option<(usize, usize)> {
        let binding_count = self.bindings.len();
        for start in first_start..=text.len() {
            if let Some(end) = self.match_elements(elements, text, start) {
                return Some((start, end));
            }
            self.bindings.truncate(binding_count);
        }
        None
    }

    fn visible_text(&self, line: usize, limit: Position) -> &'a [u8] {
        let Some(&text) = self.lines.get(line) else {
            return &[];
        };
        if line == limit.line {
            &text[..limit.column.min(text.len())]
        } else {
            text
        }
    }

    fn find(&mut self, elements: &'a [PatternElement], span: Span) -> Option<Span> {
        for line in span.start.line..=span.end.line {
            let text = self.visible_text(line, span.end);
            let first_start = span.start.start_column_on(line);
            if let Some((start, end)) = self.find_in_text(elements, text, first_start) {
                let at = |column| Position { line, column };
                return Some(at(start)..at(end));
            }
        }
        None
    }

    fn find_without_binding(&mut self, elements: &'a [PatternElement], span: Span) -> Option<Span> {
        let binding_count = self.bindings.len();
        let found = self.find(elements, span);
        self.bindings.truncate(binding_count);
        found
    }

    fn match_block(
        &mut self,
        checks: &'a [CheckLine],
        opening_label: Option<&Span>,
        end: Position,
    ) -> Result<(), CheckFailure> {
        let output_start = Position::line_start(0);
        let mut cursor = opening_label.map_or(output_start, |label| label.end);
        let mut previous_line = opening_label.map(|label| label.start.line);
        let mut pending = Vec::new();
        for check in checks {
            for _ in 0..check.count {
                let found = match check.kind {
                    CheckKind::Plain | CheckKind::Count => {
                        let found = self.find(&check.elements, cursor..end);
                        found.ok_or_else(|| {
                            let summary = describe_no_match(check, cursor);
                            let searched = Some(cursor..end);
                            self.fail(CheckFailureKind::NoMatch, check, summary, searched)
                        })?
                    }
                    CheckKind::Next => self.find_on_next_line(check, previous_line, end)?,
                    CheckKind::Not => {
                        pending.push(check);
                        continue;
                    }
                    CheckKind::Label => unreachable!("labels separate blocks"),
                };
                self.check_excluded(&pending, cursor..found.start)?;
                pending.clear();
                cursor = found.end;
                previous_line = Some(found.start.line);
            }
        }
        self.check_excluded(&pending, cursor..end)
    }

    fn find_on_next_line(
        &mut self,
        check: &'a CheckLine,
        previous_line: Option<usize>,
        block_end: Position,
    ) -> Result<Span, CheckFailure> {
        let next = Position::line_start(previous_line.map_or(0, |line| line + 1));
        let limit = Position::line_start(next.line + 1).min(block_end);
        if let Some(found) = self.find(&check.elements, next..limit) {
            return Ok(found);
        }
        let pattern = &check.pattern;
        let mut summary = format!("output line {} does not match: {pattern}", next.line + 1);
        if let Some(later) = self.find_without_binding(&check.elements, limit..block_end) {
            summary.push_str(&format!(" (line {} does)", later.start.line + 1));
        }
        let searched = Some(next..limit);
        Err(self.fail(CheckFailureKind::NotOnNextLine, check, summary, searched))
    }

    fn check_excluded(&mut self, checks: &[&'a CheckLine], span: Span) -> Result<(), CheckFailure> {
        for &check in checks {
            if let Some(found) = self.find_without_binding(&check.elements, span.clone()) {
                let (line, pattern) = (found.start.line + 1, &check.pattern);
                let summary = format!("output line {line} matches the excluded: {pattern}");
                return Err(self.fail(CheckFailureKind::ExcludedTextFound, check, summary, None));
            }
        }
        Ok(())
    }

    fn fail(
        &self,
        kind: CheckFailureKind,
        check: &CheckLine,
        summary: String,
        searched: Option<Span>,
    ) -> CheckFailure {
        let mut parts = vec![summary];
        if let Some(searched) = searched
            && let Some(nearest) = self.find_nearest_line(&check.elements, searched)
        {
            let nearest = String::from_utf8_lossy(nearest);
            parts.push(format!("nearest: {}", nearest.trim_matches(BLANKS)));
        }
        for &(name, value) in &self.bindings {
            let variable = PatternElement::Variable(name.to_vec());
            if check.elements.contains(&variable) {
                let [name, value] = [name, value].map(String::from_utf8_lossy);
                parts.push(format!("[[{name}]] is {value}"));
            }
        }
        CheckFailure {
            kind,
            line: check.line,
            message: parts.join("; "),
        }
    }

    fn find_nearest_line(&self, elements: &[PatternElement], span: Span) -> Option<&'a [u8]> {
        let mut longest: &[u8] = &[];
        for element in elements {
            if let PatternElement::Text(text) = element
                && text.len() > longest.len()
            {
                longest = text;
            }
        }
        if longest.is_empty() {
            return None;
        }
        (span.start.line..=span.end.line).find_map(|line| {
            let text = self.visible_text(line, span.end);
            let searched = text.get(span.start.start_column_on(line)..)?;
            let mut windows = searched.windows(longest.len());
            windows.any(|window| window == longest).then_some(text)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::CheckFailureKind::{ExcludedTextFound, LabelNotFound, NoMatch, NotOnNextLine};
    use super::*;

    const OUTPUT: &str = r#"function f0 "sum"
  v2 = Add v0, v1
  v3 = Mul v2, v2
  v12 = Sub v3, v0
  Return v12
function f1 "sum2"
  v1 = Negate v0
  Return v1
"#;
    const SUM: &str = "\"sum\"";
    const SUM2: &str = "\"sum2\"";

    type Outcome = Result<(), (CheckFailureKind, u32)>;

    fn check(kind: CheckKind, count: u32, pattern: &str) -> CheckLine {
        CheckLine {
            kind,
            count,
            line: 0,
            pattern: pattern.to_owned(),
            elements: parse_check_pattern(pattern).unwrap(),
        }
    }

    fn plain(pattern: &str) -> CheckLine {
        check(CheckKind::Plain, 1, pattern)
    }

    fn next(pattern: &str) -> CheckLine {
        check(CheckKind::Next, 1, pattern)
    }

    fn not(pattern: &str) -> CheckLine {
        check(CheckKind::Not, 1, pattern)
    }

    fn label(pattern: &str) -> CheckLine {
        check(CheckKind::Label, 1, pattern)
    }

    fn count(count: u32, pattern: &str) -> CheckLine {
        check(CheckKind::Count, count, pattern)
    }

    fn number_lines<const N: usize>(checks: [CheckLine; N]) -> Vec<CheckLine> {
        let number = |(check, line)| CheckLine { line, ..check };
        checks.into_iter().zip(1..).map(number).collect()
    }

    fn run_on<const N: usize>(output: &str, checks: [CheckLine; N]) -> Outcome {
        let checks = number_lines(checks);
        assert_eq!(validate_check_lines(&checks), Ok(()));
        match_check_lines(&checks, output).map_err(|failure| (failure.kind, failure.line))
    }

    fn run<const N: usize>(checks: [CheckLine; N]) -> Outcome {
        run_on(OUTPUT, checks)
    }

    fn failure_message<const N: usize>(checks: [CheckLine; N]) -> String {
        let failure = match_check_lines(&number_lines(checks), OUTPUT).unwrap_err();
        failure.message
    }

    fn text(text: &str) -> PatternElement {
        PatternElement::Text(text.as_bytes().to_vec())
    }

    #[test]
    fn pattern_elements() {
        use PatternElement::{AnyText, Blanks};
        let x_1 = PatternElement::Variable(b"x_1".to_vec());
        let elements = vec![text("Mul"), Blanks, x_1, text(","), AnyText, text("v2")];
        let parsed = parse_check_pattern(" \t Mul  \t [[x_1]],{{*}}v2 ");
        assert_eq!(parsed, Ok(elements));
        let elements = ["a", "}}", "]]", "{", "[", "b"].map(|word| vec![text(word)]);
        let elements = elements.join(&Blanks);
        assert_eq!(parse_check_pattern("a }} ]] { [ b"), Ok(elements));
    }

    #[test]
    fn pattern_errors() {
        let cases: [(&[&str], &str); 4] = [
            (&["", " \t "], "the pattern is empty"),
            (
                &["{{a}}", "a{{", "{{*}", "{{{*}}"],
                "only {{*}} can be written with {{: there are no regular expressions",
            ),
            (
                &["[[1x]]", "[[x", "[[x]", "[[]]", "[[x y]]"],
                "a variable is written [[name]]",
            ),
            (&["{{*}}", "{{*}} {{*}}"], "the pattern matches every line"),
        ];
        for (patterns, message) in cases {
            for pattern in patterns {
                assert_eq!(parse_check_pattern(pattern), Err(message), "{pattern}");
            }
        }
    }

    #[test]
    fn sequence_errors() {
        let next_without_match = "CHECK-NEXT needs a match directly before it";
        let fail = |line, message: &str| Err(TestFailure::new(line, message));
        let checks = number_lines([next("x")]);
        assert_eq!(validate_check_lines(&checks), fail(1, next_without_match));
        let checks = number_lines([plain("a"), not("b"), next("c")]);
        assert_eq!(validate_check_lines(&checks), fail(3, next_without_match));
        let checks = number_lines([label("a"), next("b")]);
        assert_eq!(validate_check_lines(&checks), Ok(()));
        let checks = number_lines([plain("[[x]]"), label("[[x]]")]);
        let expected = fail(2, "a label cannot use a variable");
        assert_eq!(validate_check_lines(&checks), expected);
    }

    #[test]
    fn plain_checks_match_in_order() {
        assert_eq!(run([plain("Add"), plain("Sub"), plain("Negate")]), Ok(()));
        assert_eq!(run([plain("Div")]), Err((NoMatch, 1)));
        assert_eq!(run([plain("Negate"), plain("Add")]), Err((NoMatch, 2)));
        assert_eq!(run_on("a b", [plain("b"), plain("a")]), Err((NoMatch, 2)));
    }

    #[test]
    fn blanks_match_blanks() {
        assert_eq!(run([plain("Add \t v0,\tv1")]), Ok(()));
        assert_eq!(run([plain("A dd")]), Err((NoMatch, 1)));
    }

    #[test]
    fn any_text_stays_on_one_line() {
        assert_eq!(run([plain("function{{*}}f0{{*}}sum")]), Ok(()));
        assert_eq!(run([plain("Ret{{*}}urn")]), Ok(()));
        assert_eq!(run([plain("Add{{*}}Mul")]), Err((NoMatch, 1)));
    }

    #[test]
    fn search_continues_on_matched_line() {
        assert_eq!(run([plain("Mul"), plain("v2"), next("Sub")]), Ok(()));
        assert_eq!(run([plain("Mul"), count(3, "v2")]), Err((NoMatch, 2)));
    }

    #[test]
    fn next_requires_following_line() {
        assert_eq!(run([plain("Add"), next("Mul"), next("Sub")]), Ok(()));
        assert_eq!(run([plain("Add"), next("Sub")]), Err((NotOnNextLine, 2)));
        let checks = [plain("Negate"), next("Return"), next("x")];
        assert_eq!(run(checks), Err((NotOnNextLine, 3)));
        assert_eq!(run([label(SUM2), next("Negate")]), Ok(()));
        let checks = [label(SUM), plain("Return"), next("function"), label(SUM2)];
        assert_eq!(run(checks), Err((NotOnNextLine, 3)));
    }

    #[test]
    fn not_excludes_text_between_matches() {
        let checks = [plain("Add"), not("Mul"), plain("Sub")];
        assert_eq!(run(checks), Err((ExcludedTextFound, 2)));
        assert_eq!(run([plain("Add"), not("Negate"), plain("Sub")]), Ok(()));
        assert_eq!(run([not("Negate"), plain("Return")]), Ok(()));
        assert_eq!(run_on("x a y", [plain("x"), not("y"), plain("a")]), Ok(()));
        let checks = [plain("x"), not("a"), plain("y")];
        assert_eq!(run_on("x a y", checks), Err((ExcludedTextFound, 2)));
    }

    #[test]
    fn trailing_not_runs_to_block_end() {
        let checks = [plain("Negate"), not("Return")];
        assert_eq!(run(checks), Err((ExcludedTextFound, 2)));
        assert_eq!(run([plain("Negate"), not("Add")]), Ok(()));
        assert_eq!(run([not("Div")]), Ok(()));
        assert_eq!(run([not("Add")]), Err((ExcludedTextFound, 1)));
        let checks = [label(SUM), not("Negate"), label(SUM2), plain("Negate")];
        assert_eq!(run(checks), Ok(()));
    }

    #[test]
    fn labels_bound_blocks() {
        assert_eq!(run([label("f2")]), Err((LabelNotFound, 1)));
        assert_eq!(run([label(SUM2), label(SUM)]), Err((LabelNotFound, 2)));
        let checks = [label(SUM), plain("Negate"), label(SUM2)];
        assert_eq!(run(checks), Err((NoMatch, 2)));
        assert_eq!(run([plain("Negate"), label(SUM2)]), Err((NoMatch, 1)));
        assert_eq!(run([plain("Div"), label("f2")]), Err((LabelNotFound, 2)));
    }

    #[test]
    fn variables_match_whole_tokens() {
        let checks = [plain("a [[x]]"), plain("b [[x]]")];
        assert_eq!(run_on("a v1\nb v12", checks), Err((NoMatch, 2)));
        assert_eq!(run_on("sum2", [plain("su[[x]]")]), Err((NoMatch, 1)));
        let checks = [plain("su"), plain("[[x]]")];
        assert_eq!(run_on("sum2", checks), Err((NoMatch, 2)));
        assert_eq!(run_on("load a.b$c_1;", [plain("load [[x]];")]), Ok(()));
    }

    #[test]
    fn token_ends_at_search_limit() {
        let checks = [plain("a [[x]]"), not("[[x]]"), plain("2")];
        assert_eq!(run_on("a v1\nv12", checks), Err((ExcludedTextFound, 2)));
    }

    #[test]
    fn bindings_cross_labels() {
        let add = plain("[[x]] = Add");
        let checks = [label(SUM), add, label(SUM2), plain("[[x]] = Negate")];
        assert_eq!(run(checks), Err((NoMatch, 4)));
    }

    #[test]
    fn failed_attempts_undo_bindings() {
        let checks = [plain("p [[x]] r"), plain("s [[x]]")];
        assert_eq!(run_on("p v1 q\np v2 r\ns v2", checks), Ok(()));
        let checks = [plain("a{{*}}[[x]] b"), next("use [[x]]")];
        assert_eq!(run_on("a v1 c v2 b\nuse v2", checks), Ok(()));
    }

    #[test]
    fn not_reads_bindings_and_adds_none() {
        let read = plain("c [[x]]");
        let checks = [plain("a"), not("z [[x]]"), plain("b [[x]]"), read];
        assert_eq!(run_on("a v1\nb v2\nc v2", checks), Ok(()));
        let checks = [plain("a"), not("m [[x]]"), plain("b [[x]]")];
        assert_eq!(run_on("a v1\nm v2\nb v1", checks.clone()), Ok(()));
        let excluded: Outcome = Err((ExcludedTextFound, 2));
        assert_eq!(run_on("a v1\nm v1\nb v1\n", checks), excluded);
        let checks = [plain("a"), not("m [[x]]"), plain("b")];
        assert_eq!(run_on("a\nm v9\nb", checks), excluded);
    }

    #[test]
    fn count_repeats_check() {
        assert_eq!(run([count(2, "Return")]), Ok(()));
        assert_eq!(run([count(3, "Return")]), Err((NoMatch, 1)));
        assert_eq!(run([count(2, "Mul")]), Err((NoMatch, 1)));
        assert_eq!(run([count(2, "Return"), not("Return")]), Ok(()));
        let checks = [count(1, "Return"), not("Return")];
        assert_eq!(run(checks), Err((ExcludedTextFound, 2)));
        assert_eq!(run([count(2, "Return [[x]]")]), Err((NoMatch, 1)));
    }

    #[test]
    fn line_endings() {
        let output = OUTPUT.replace('\n', "\r\n");
        let checks = [plain("Add"), next("Mul"), not("\r")];
        assert_eq!(run_on(&output, checks), Ok(()));
        assert_eq!(run_on("a\rb", [plain("a\rb")]), Ok(()));
        assert_eq!(run_on("a\nb", [plain("a"), next("b")]), Ok(()));
        assert_eq!(run_on("", [plain("a")]), Err((NoMatch, 1)));
        assert_eq!(run_on("", [not("a")]), Ok(()));
    }

    #[test]
    fn messages_show_evidence() {
        let no_match = failure_message([plain("[[x]] = Add"), plain("Negate [[x]]")]);
        assert!(no_match.contains("nearest: v1 = Negate v0"), "{no_match}");
        assert!(no_match.contains("[[x]] is v2"), "{no_match}");
        let not_next = failure_message([plain("Add"), next("Sub")]);
        assert!(not_next.contains("(line 4 does)"), "{not_next}");
    }
}
