use bun_lint::prelude::*;
use std::sync::LazyLock;

/// Disallow specified warning terms in comments.
pub struct NoWarningComments {
    /// Each term, and what matches a comment that has it in the configured location.
    terms: Vec<(Vec<u8>, Regex)>,
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
        NoWarningComments {
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
                let mut matches = rule.terms.iter().filter(|term| term.1.test(value)).peekable();
                if matches.peek().is_none()
                    || ast_utils::is_directive_comment(&comment) && SELF_CONFIG.test(value)
                {
                    continue;
                }
                let shown = comment_to_display(value);
                for (term, _) in matches {
                    cx.report(comment, UNEXPECTED_COMMENT)
                        .data("matchedTerm", term.clone())
                        .data("comment", shown.clone());
                }
            }
        });
    }
}
