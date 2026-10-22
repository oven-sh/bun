use std::iter::once;

pub(super) const BLANKS: [char; 2] = [' ', '\t'];
pub const MAX_CHECK_COUNT: u32 = 1000;
const ANY_TEXT: &[u8] = b"{{*}}";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CheckKind {
    Plain,
    Next,
    Not,
    Label,
    Count,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CheckKindError {
    UnknownSuffix,
    InvalidCount,
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

#[derive(PartialEq, Eq, Debug)]
pub struct CheckLineError {
    pub line: u32,
    pub message: &'static str,
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

pub fn parse_check_kind(suffix: Option<&str>) -> Result<(CheckKind, u32), CheckKindError> {
    let Some(suffix) = suffix else {
        return Ok((CheckKind::Plain, 1));
    };
    match suffix {
        "NEXT" => Ok((CheckKind::Next, 1)),
        "NOT" => Ok((CheckKind::Not, 1)),
        "LABEL" => Ok((CheckKind::Label, 1)),
        _ => {
            let digits = suffix
                .strip_prefix("COUNT-")
                .ok_or(CheckKindError::UnknownSuffix)?;
            let count = parse_check_count(digits).ok_or(CheckKindError::InvalidCount)?;
            Ok((CheckKind::Count, count))
        }
    }
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

pub fn validate_check_lines(lines: &[CheckLine]) -> Result<(), CheckLineError> {
    let mut previous_kind: Option<CheckKind> = None;
    for check in lines {
        let follows_match = previous_kind.is_some_and(|kind| kind != CheckKind::Not);
        if check.kind == CheckKind::Next && !follows_match {
            return Err(CheckLineError {
                line: check.line,
                message: "CHECK-NEXT needs a match directly before it",
            });
        }
        let uses_variable = check
            .elements
            .iter()
            .any(|element| matches!(element, PatternElement::Variable(_)));
        if is_label(check) && uses_variable {
            return Err(CheckLineError {
                line: check.line,
                message: "a label cannot use a variable",
            });
        }
        previous_kind = Some(check.kind);
    }
    Ok(())
}

pub fn match_check_lines(lines: &[CheckLine], output: &str) -> Result<(), CheckFailure> {
    let mut matcher = Matcher {
        lines: output.lines().map(str::as_bytes).collect(),
        bindings: Vec::new(),
    };
    matcher.match_blocks(lines)
}

fn parse_check_count(digits: &str) -> Option<u32> {
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let count = digits.parse::<u32>().ok()?;
    (1..=MAX_CHECK_COUNT).contains(&count).then_some(count)
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

fn contains(text: &[u8], needle: &[u8]) -> bool {
    text.windows(needle.len()).any(|window| window == needle)
}

fn parse_variable_name(bytes: &[u8]) -> Option<&[u8]> {
    let (name, rest) = bytes.split_at(count_leading(bytes, is_variable_name_byte));
    let is_name = name.first().is_some_and(|first| !first.is_ascii_digit());
    (is_name && rest.starts_with(b"]]")).then_some(name)
}

fn describe_no_match(check: &CheckLine, from: Position) -> String {
    format!(
        "nothing from output line {} on matches: {}",
        from.line + 1,
        check.pattern
    )
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Position {
    line: usize,
    column: usize,
}

impl Position {
    fn line_start(line: usize) -> Position {
        Position { line, column: 0 }
    }

    fn start_column_on(self, line: usize) -> usize {
        if line == self.line { self.column } else { 0 }
    }
}

#[derive(Copy, Clone)]
struct Match {
    line: usize,
    start: usize,
    end: usize,
}

impl Match {
    fn start_position(self) -> Position {
        Position {
            line: self.line,
            column: self.start,
        }
    }

    fn end_position(self) -> Position {
        Position {
            line: self.line,
            column: self.end,
        }
    }
}

struct Block {
    start: Position,
    end: Position,
    label_line: Option<usize>,
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
        match self.bound_value(name) {
            Some(value) if value != token => return None,
            Some(_) => {}
            None => self.bindings.push((name, token)),
        }
        Some(token.len())
    }

    fn bound_value(&self, name: &[u8]) -> Option<&'a [u8]> {
        let binding = self.bindings.iter().find(|binding| binding.0 == name)?;
        Some(binding.1)
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

    fn find(
        &mut self,
        elements: &'a [PatternElement],
        from: Position,
        limit: Position,
    ) -> Option<Match> {
        for line in from.line..=limit.line {
            let text = self.visible_text(line, limit);
            let first_start = from.start_column_on(line);
            if let Some((start, end)) = self.find_in_text(elements, text, first_start) {
                return Some(Match { line, start, end });
            }
        }
        None
    }

    fn find_without_binding(
        &mut self,
        elements: &'a [PatternElement],
        from: Position,
        limit: Position,
    ) -> Option<Match> {
        let binding_count = self.bindings.len();
        let found = self.find(elements, from, limit);
        self.bindings.truncate(binding_count);
        found
    }

    fn match_blocks(&mut self, checks: &'a [CheckLine]) -> Result<(), CheckFailure> {
        let output_start = Position::line_start(0);
        let output_end = Position::line_start(self.lines.len());
        let mut labels = Vec::new();
        let mut cursor = output_start;
        for check in checks.iter().filter(|check| is_label(check)) {
            let Some(label) = self.find(&check.elements, cursor, output_end) else {
                let summary = describe_no_match(check, cursor);
                return Err(self.fail(CheckFailureKind::LabelNotFound, check, summary, None));
            };
            cursor = label.end_position();
            labels.push(label);
        }
        let groups = checks.split(is_label);
        let opening_labels = once(None).chain(labels.iter().map(Some));
        let closing_labels = labels.iter().map(Some).chain(once(None));
        for ((group, opening), closing) in groups.zip(opening_labels).zip(closing_labels) {
            let block = Block {
                start: opening.map_or(output_start, |label| label.end_position()),
                end: closing.map_or(output_end, |label| Position::line_start(label.line)),
                label_line: opening.map(|label| label.line),
            };
            self.match_block(group, &block)?;
        }
        Ok(())
    }

    fn match_block(&mut self, checks: &'a [CheckLine], block: &Block) -> Result<(), CheckFailure> {
        let mut cursor = block.start;
        let mut previous_line = block.label_line;
        let mut pending = Vec::new();
        for check in checks {
            for _ in 0..check.count {
                let found = match check.kind {
                    CheckKind::Plain | CheckKind::Count => {
                        self.find_in_order(check, cursor, block.end)?
                    }
                    CheckKind::Next => self.find_on_next_line(check, previous_line, block.end)?,
                    CheckKind::Not => {
                        pending.push(check);
                        continue;
                    }
                    CheckKind::Label => unreachable!("labels separate blocks"),
                };
                self.check_excluded(&pending, cursor, found.start_position())?;
                pending.clear();
                cursor = found.end_position();
                previous_line = Some(found.line);
            }
        }
        self.check_excluded(&pending, cursor, block.end)
    }

    fn find_in_order(
        &mut self,
        check: &'a CheckLine,
        from: Position,
        block_end: Position,
    ) -> Result<Match, CheckFailure> {
        if let Some(found) = self.find(&check.elements, from, block_end) {
            return Ok(found);
        }
        let summary = describe_no_match(check, from);
        let searched = Some((from, block_end));
        Err(self.fail(CheckFailureKind::NoMatch, check, summary, searched))
    }

    fn find_on_next_line(
        &mut self,
        check: &'a CheckLine,
        previous_line: Option<usize>,
        block_end: Position,
    ) -> Result<Match, CheckFailure> {
        let next = Position::line_start(previous_line.map_or(0, |line| line + 1));
        let limit = Position::line_start(next.line + 1).min(block_end);
        if let Some(found) = self.find(&check.elements, next, limit) {
            return Ok(found);
        }
        let pattern = &check.pattern;
        let mut summary = format!("output line {} does not match: {pattern}", next.line + 1);
        if let Some(later) = self.find_without_binding(&check.elements, limit, block_end) {
            summary.push_str(&format!(" (line {} does)", later.line + 1));
        }
        let searched = Some((next, limit));
        Err(self.fail(CheckFailureKind::NotOnNextLine, check, summary, searched))
    }

    fn check_excluded(
        &mut self,
        pending: &[&'a CheckLine],
        from: Position,
        limit: Position,
    ) -> Result<(), CheckFailure> {
        for &check in pending {
            if let Some(found) = self.find_without_binding(&check.elements, from, limit) {
                let summary = format!(
                    "output line {} matches the excluded: {}",
                    found.line + 1,
                    check.pattern
                );
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
        searched: Option<(Position, Position)>,
    ) -> CheckFailure {
        let mut parts = vec![summary];
        if let Some((from, limit)) = searched
            && let Some(nearest) = self.find_nearest_line(&check.elements, from, limit)
        {
            let nearest = String::from_utf8_lossy(nearest);
            parts.push(format!("nearest: {}", nearest.trim_matches(BLANKS)));
        }
        for &(name, value) in &self.bindings {
            if check.elements.contains(&PatternElement::Variable(name.to_vec())) {
                parts.push(format!(
                    "[[{}]] is {}",
                    String::from_utf8_lossy(name),
                    String::from_utf8_lossy(value)
                ));
            }
        }
        CheckFailure {
            kind,
            line: check.line,
            message: parts.join("; "),
        }
    }

    fn find_nearest_line(
        &self,
        elements: &[PatternElement],
        from: Position,
        limit: Position,
    ) -> Option<&'a [u8]> {
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
        (from.line..=limit.line).find_map(|line| {
            let text = self.visible_text(line, limit);
            let searched = text.get(from.start_column_on(line)..)?;
            contains(searched, longest).then_some(text)
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
        checks
            .into_iter()
            .zip(1..)
            .map(|(check, line)| CheckLine { line, ..check })
            .collect()
    }

    fn run<const N: usize>(checks: [CheckLine; N], output: &str) -> Outcome {
        let checks = number_lines(checks);
        assert_eq!(validate_check_lines(&checks), Ok(()));
        match_check_lines(&checks, output).map_err(|failure| (failure.kind, failure.line))
    }

    fn failure_message<const N: usize>(checks: [CheckLine; N]) -> String {
        match_check_lines(&number_lines(checks), OUTPUT)
            .unwrap_err()
            .message
    }

    fn text(text: &str) -> PatternElement {
        PatternElement::Text(text.as_bytes().to_vec())
    }

    fn variable(name: &str) -> PatternElement {
        PatternElement::Variable(name.as_bytes().to_vec())
    }

    #[test]
    fn pattern_elements() {
        assert_eq!(
            parse_check_pattern(" \t Mul  \t [[x_1]],{{*}}v2 "),
            Ok(vec![
                text("Mul"),
                PatternElement::Blanks,
                variable("x_1"),
                text(","),
                PatternElement::AnyText,
                text("v2"),
            ])
        );
        assert_eq!(
            parse_check_pattern("a }} ]] { [ b"),
            Ok(vec![
                text("a"),
                PatternElement::Blanks,
                text("}}"),
                PatternElement::Blanks,
                text("]]"),
                PatternElement::Blanks,
                text("{"),
                PatternElement::Blanks,
                text("["),
                PatternElement::Blanks,
                text("b"),
            ])
        );
    }

    #[test]
    fn check_kinds() {
        assert_eq!(parse_check_kind(None), Ok((CheckKind::Plain, 1)));
        assert_eq!(parse_check_kind(Some("NEXT")), Ok((CheckKind::Next, 1)));
        assert_eq!(parse_check_kind(Some("NOT")), Ok((CheckKind::Not, 1)));
        assert_eq!(parse_check_kind(Some("LABEL")), Ok((CheckKind::Label, 1)));
        assert_eq!(parse_check_kind(Some("COUNT-1")), Ok((CheckKind::Count, 1)));
        assert_eq!(
            parse_check_kind(Some("COUNT-1000")),
            Ok((CheckKind::Count, MAX_CHECK_COUNT))
        );
    }

    #[test]
    fn check_kind_errors() {
        for suffix in ["", "NXT", "next", "COUNT"] {
            assert_eq!(
                parse_check_kind(Some(suffix)),
                Err(CheckKindError::UnknownSuffix),
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
                Err(CheckKindError::InvalidCount),
                "{suffix}"
            );
        }
    }

    #[test]
    fn pattern_errors() {
        for pattern in ["", " \t "] {
            assert_eq!(parse_check_pattern(pattern), Err("the pattern is empty"));
        }
        for pattern in ["{{a}}", "a{{", "{{*}", "{{{*}}"] {
            assert_eq!(
                parse_check_pattern(pattern),
                Err("only {{*}} can be written with {{: there are no regular expressions")
            );
        }
        for pattern in ["[[1x]]", "[[x", "[[x]", "[[]]", "[[x y]]"] {
            assert_eq!(
                parse_check_pattern(pattern),
                Err("a variable is written [[name]]")
            );
        }
        for pattern in ["{{*}}", "{{*}} {{*}}"] {
            assert_eq!(
                parse_check_pattern(pattern),
                Err("the pattern matches every line")
            );
        }
    }

    #[test]
    fn sequence_errors() {
        let next_without_match = |line| {
            Err(CheckLineError {
                line,
                message: "CHECK-NEXT needs a match directly before it",
            })
        };
        let checks = number_lines([next("x")]);
        assert_eq!(validate_check_lines(&checks), next_without_match(1));
        let checks = number_lines([plain("a"), not("b"), next("c")]);
        assert_eq!(validate_check_lines(&checks), next_without_match(3));
        let checks = number_lines([label("a"), next("b")]);
        assert_eq!(validate_check_lines(&checks), Ok(()));
        let checks = number_lines([plain("[[x]]"), label("[[x]]")]);
        assert_eq!(
            validate_check_lines(&checks),
            Err(CheckLineError {
                line: 2,
                message: "a label cannot use a variable",
            })
        );
    }

    #[test]
    fn plain_checks_match_in_order() {
        assert_eq!(
            run([plain("Add"), plain("Sub"), plain("Negate")], OUTPUT),
            Ok(())
        );
        assert_eq!(run([plain("Div")], OUTPUT), Err((NoMatch, 1)));
        assert_eq!(
            run([plain("Negate"), plain("Add")], OUTPUT),
            Err((NoMatch, 2))
        );
        assert_eq!(run([plain("b"), plain("a")], "a b"), Err((NoMatch, 2)));
    }

    #[test]
    fn blanks_match_blanks() {
        assert_eq!(run([plain("Add \t v0,\tv1")], OUTPUT), Ok(()));
        assert_eq!(run([plain("A dd")], OUTPUT), Err((NoMatch, 1)));
    }

    #[test]
    fn any_text_stays_on_one_line() {
        assert_eq!(run([plain("function{{*}}f0{{*}}sum")], OUTPUT), Ok(()));
        assert_eq!(run([plain("Ret{{*}}urn")], OUTPUT), Ok(()));
        assert_eq!(run([plain("Add{{*}}Mul")], OUTPUT), Err((NoMatch, 1)));
    }

    #[test]
    fn search_continues_on_matched_line() {
        assert_eq!(
            run([plain("Mul"), plain("v2"), next("Sub")], OUTPUT),
            Ok(())
        );
        assert_eq!(
            run([plain("Mul"), count(3, "v2")], OUTPUT),
            Err((NoMatch, 2))
        );
    }

    #[test]
    fn next_requires_following_line() {
        assert_eq!(
            run([plain("Add"), next("Mul"), next("Sub")], OUTPUT),
            Ok(())
        );
        assert_eq!(
            run([plain("Add"), next("Sub")], OUTPUT),
            Err((NotOnNextLine, 2))
        );
        assert_eq!(
            run([plain("Negate"), next("Return"), next("x")], OUTPUT),
            Err((NotOnNextLine, 3))
        );
        assert_eq!(run([label(SUM2), next("Negate")], OUTPUT), Ok(()));
        let checks = [label(SUM), plain("Return"), next("function"), label(SUM2)];
        assert_eq!(run(checks, OUTPUT), Err((NotOnNextLine, 3)));
    }

    #[test]
    fn not_excludes_text_between_matches() {
        assert_eq!(
            run([plain("Add"), not("Mul"), plain("Sub")], OUTPUT),
            Err((ExcludedTextFound, 2))
        );
        assert_eq!(
            run([plain("Add"), not("Negate"), plain("Sub")], OUTPUT),
            Ok(())
        );
        assert_eq!(run([not("Negate"), plain("Return")], OUTPUT), Ok(()));
        assert_eq!(run([plain("x"), not("y"), plain("a")], "x a y"), Ok(()));
        assert_eq!(
            run([plain("x"), not("a"), plain("y")], "x a y"),
            Err((ExcludedTextFound, 2))
        );
    }

    #[test]
    fn trailing_not_runs_to_block_end() {
        assert_eq!(
            run([plain("Negate"), not("Return")], OUTPUT),
            Err((ExcludedTextFound, 2))
        );
        assert_eq!(run([plain("Negate"), not("Add")], OUTPUT), Ok(()));
        assert_eq!(run([not("Div")], OUTPUT), Ok(()));
        assert_eq!(run([not("Add")], OUTPUT), Err((ExcludedTextFound, 1)));
        let checks = [label(SUM), not("Negate"), label(SUM2), plain("Negate")];
        assert_eq!(run(checks, OUTPUT), Ok(()));
    }

    #[test]
    fn labels_bound_blocks() {
        assert_eq!(run([label("f2")], OUTPUT), Err((LabelNotFound, 1)));
        assert_eq!(
            run([label(SUM2), label(SUM)], OUTPUT),
            Err((LabelNotFound, 2))
        );
        assert_eq!(
            run([label(SUM), plain("Negate"), label(SUM2)], OUTPUT),
            Err((NoMatch, 2))
        );
        assert_eq!(
            run([plain("Negate"), label(SUM2)], OUTPUT),
            Err((NoMatch, 1))
        );
        assert_eq!(
            run([plain("Div"), label("f2")], OUTPUT),
            Err((LabelNotFound, 2))
        );
    }

    #[test]
    fn variables_match_whole_tokens() {
        let checks = [plain("a [[x]]"), plain("b [[x]]")];
        assert_eq!(run(checks, "a v1\nb v12"), Err((NoMatch, 2)));
        assert_eq!(run([plain("su[[x]]")], "sum2"), Err((NoMatch, 1)));
        assert_eq!(
            run([plain("su"), plain("[[x]]")], "sum2"),
            Err((NoMatch, 2))
        );
        assert_eq!(run([plain("load [[x]];")], "load a.b$c_1;"), Ok(()));
    }

    #[test]
    fn token_ends_at_search_limit() {
        let checks = [plain("a [[x]]"), not("[[x]]"), plain("2")];
        assert_eq!(run(checks, "a v1\nv12"), Err((ExcludedTextFound, 2)));
    }

    #[test]
    fn bindings_cross_labels() {
        let checks = [
            label(SUM),
            plain("[[x]] = Add"),
            label(SUM2),
            plain("[[x]] = Negate"),
        ];
        assert_eq!(run(checks, OUTPUT), Err((NoMatch, 4)));
    }

    #[test]
    fn failed_attempts_undo_bindings() {
        let checks = [plain("p [[x]] r"), plain("s [[x]]")];
        assert_eq!(run(checks, "p v1 q\np v2 r\ns v2"), Ok(()));
        let checks = [plain("a{{*}}[[x]] b"), next("use [[x]]")];
        assert_eq!(run(checks, "a v1 c v2 b\nuse v2"), Ok(()));
    }

    #[test]
    fn not_reads_bindings_and_adds_none() {
        let checks = [
            plain("a"),
            not("z [[x]]"),
            plain("b [[x]]"),
            plain("c [[x]]"),
        ];
        assert_eq!(run(checks, "a v1\nb v2\nc v2"), Ok(()));
        let checks = [plain("a"), not("m [[x]]"), plain("b [[x]]")];
        assert_eq!(run(checks.clone(), "a v1\nm v2\nb v1"), Ok(()));
        assert_eq!(
            run(checks, "a v1\nm v1\nb v1\n"),
            Err((ExcludedTextFound, 2))
        );
        let checks = [plain("a"), not("m [[x]]"), plain("b")];
        assert_eq!(run(checks, "a\nm v9\nb"), Err((ExcludedTextFound, 2)));
    }

    #[test]
    fn count_repeats_check() {
        assert_eq!(run([count(2, "Return")], OUTPUT), Ok(()));
        assert_eq!(run([count(3, "Return")], OUTPUT), Err((NoMatch, 1)));
        assert_eq!(run([count(2, "Mul")], OUTPUT), Err((NoMatch, 1)));
        assert_eq!(run([count(2, "Return"), not("Return")], OUTPUT), Ok(()));
        assert_eq!(
            run([count(1, "Return"), not("Return")], OUTPUT),
            Err((ExcludedTextFound, 2))
        );
        assert_eq!(run([count(2, "Return [[x]]")], OUTPUT), Err((NoMatch, 1)));
    }

    #[test]
    fn line_endings() {
        let output = OUTPUT.replace('\n', "\r\n");
        let checks = [plain("Add"), next("Mul"), not("\r")];
        assert_eq!(run(checks, &output), Ok(()));
        assert_eq!(run([plain("a\rb")], "a\rb"), Ok(()));
        assert_eq!(run([plain("a"), next("b")], "a\nb"), Ok(()));
        assert_eq!(run([plain("a")], ""), Err((NoMatch, 1)));
        assert_eq!(run([not("a")], ""), Ok(()));
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
