use bun_lint::prelude::*;
use std::sync::LazyLock;

/// Disallow specified warning terms in comments.
pub struct NoWarningComments {
    /// Each term, and what matches a comment that has it in the configured location.
    terms: Vec<(Vec<u8>, Regex)>,
    /// If the terms are looked for at the start of a comment: what can be before them beside whitespace, and what they start
    /// with, both in lower case. `None`: it is not told from a byte whether a comment can match.
    starts: Option<(Vec<u8>, Vec<u8>)>,
}

const UNEXPECTED_COMMENT: Message = Message::new(
    "unexpectedComment",
    "Unexpected '{{matchedTerm}}' comment: '{{comment}}'.",
);

const CHAR_LIMIT: u32 = 40;

static SELF_CONFIG: LazyLock<Regex> = LazyLock::new(|| Regex::literal("/\\bno-warning-comments\\b/u"));

fn is_word_character(byte: Option<&u8>) -> bool {
    byte.is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
}

/// The words of `comment` with one space between them, as many as fit in `CHAR_LIMIT`.
fn comment_to_display(comment: &[u8]) -> Vec<u8> {
    let mut shown = Vec::new();
    let mut shown_len = 0;
    let mut rest = text::trim(comment);
    while !rest.is_empty() {
        let mut characters = text::code_points(rest);
        let end = characters.find(|it| text::is_js_whitespace(it.1)).map_or(rest.len(), |it| it.0);
        let (word, after) = rest.split_at(end);
        let len = shown_len + u32::from(!shown.is_empty()) + text::utf16_len(word);
        if len > CHAR_LIMIT {
            shown.extend_from_slice(b"...");
            break;
        }
        if !shown.is_empty() {
            shown.push(b' ');
        }
        shown.extend_from_slice(word);
        shown_len = len;
        rest = text::trim_start(after);
    }
    shown
}

/// Whether `byte` is whitespace or, but for its case, in `decoration`.
fn is_before(decoration: &[u8], byte: u8) -> bool {
    matches!(byte, b'\t'..=b'\r' | b' ') || decoration.contains(&byte.to_ascii_lowercase())
}

impl NoWarningComments {
    /// Whether a term can match `value`, as far as its first byte after whitespace tells.
    fn may_match(&self, value: &[u8]) -> bool {
        let Some((before, first_bytes)) = &self.starts else {
            return true;
        };
        match value.iter().find(|byte| !is_before(before, **byte)) {
            Some(first) => !first.is_ascii() || first_bytes.contains(&first.to_ascii_lowercase()),
            None => false,
        }
    }
}

impl Rule for NoWarningComments {
    const META: Meta = Meta::eslint("no-warning-comments", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let is_at_start = object.str("location") != Some("anywhere");
        let decoration = object.strings("decoration").concat();
        let decoration = text::escape_string_regexp(decoration.as_bytes());
        let terms = match object.has("terms") {
            true => object.strings("terms"),
            false => vec!["todo", "fixme", "xxx"],
        };
        let convert_to_reg_exp = |term: &[u8]| {
            let mut pattern = Vec::new();
            if is_at_start {
                pattern.extend_from_slice(b"^[\\s");
                pattern.extend_from_slice(&decoration);
                pattern.extend_from_slice(b"]*");
            } else if is_word_character(term.first()) {
                pattern.extend_from_slice(b"\\b");
            }
            pattern.extend_from_slice(&text::escape_string_regexp(term));
            if is_word_character(term.last()) {
                pattern.extend_from_slice(b"\\b");
            }
            Regex::from_bytes(&pattern, b"iu").ok()
        };
        let first_bytes: Option<Vec<u8>> = (terms.iter())
            .map(|term| term.as_bytes().first().filter(|it| it.is_ascii()).map(u8::to_ascii_lowercase))
            .collect();
        let before = object.strings("decoration").concat().into_bytes().to_ascii_lowercase();
        // A term that starts with what can be before it starts anywhere in that.
        let is_told_by_a_byte = |first_bytes: &Vec<u8>| {
            is_at_start && before.is_ascii() && !first_bytes.iter().any(|it| is_before(&before, *it))
        };
        NoWarningComments {
            starts: first_bytes.filter(is_told_by_a_byte).map(|first_bytes| (before, first_bytes)),
            terms: terms
                .iter()
                .filter_map(|term| Some((term.as_bytes().to_vec(), convert_to_reg_exp(term.as_bytes())?)))
                .collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                if comment.kind() == TokenKind::Shebang {
                    continue;
                }
                let value = comment.comment_value();
                if !rule.may_match(value) {
                    continue;
                }
                let mut matches = rule.terms.iter().filter(|term| term.1.test(value)).peekable();
                if matches.peek().is_none()
                    || ast_utils::is_directive_comment(&comment) && SELF_CONFIG.test(value)
                {
                    continue;
                }
                let shown = comment_to_display(value);
                // oxlint says one thing about a comment.
                let count = if cx.language().is_oxlint { 1 } else { usize::MAX };
                for (term, _) in matches.take(count) {
                    cx.report(comment, UNEXPECTED_COMMENT)
                        .data("matchedTerm", term.clone())
                        .data("comment", shown.clone());
                }
            }
        });
    }
}
