use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow specified warning terms in comments.
pub struct NoWarningComments {
    terms: Vec<Term>,
    /// They are looked for at the start of a comment, and not anywhere in it.
    is_at_start: bool,
    /// What can be before them at the start beside whitespace, without capitals.
    decoration: Vec<u8>,
}

struct Term {
    text: Vec<u8>,
    matcher: Matcher,
}

/// What tells that a comment has a term in the configured location.
enum Matcher {
    /// The term without capitals. It and the decoration are of ASCII, so it takes no regular expression.
    Ascii(Vec<u8>),
    Pattern(Box<Regex>),
}

const UNEXPECTED_COMMENT: Message = Message::new(
    "unexpectedComment",
    "Unexpected '{{matchedTerm}}' comment: '{{comment}}'.",
);

const CHAR_LIMIT: u32 = 40;

fn is_word_character(byte: Option<&u8>) -> bool {
    byte.is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
}

/// `/\bno-warning-comments\b/u`
fn is_self_config(value: &[u8]) -> bool {
    const NAME: &[u8] = b"no-warning-comments";
    let mut at = 0;
    while let Some(found) = strings::index_of(value.get(at..).unwrap_or_default(), NAME) {
        at += found;
        let before = at.checked_sub(1).and_then(|it| value.get(it));
        if !is_word_character(before) && !is_word_character(value.get(at + NAME.len())) {
            return true;
        }
        at += 1;
    }
    false
}

/// The words of `comment` with one space between them, as many as fit in `CHAR_LIMIT`.
fn comment_to_display(comment: &[u8]) -> Vec<u8> {
    let mut shown = Vec::new();
    let mut shown_len = 0;
    let mut rest = strings::trim_js_whitespace(comment);
    while !rest.is_empty() {
        let mut characters = strings::wtf8_codepoints(rest);
        let end = characters.find(|it| strings::is_js_whitespace(it.1)).map_or(rest.len(), |it| it.0);
        let (word, after) = rest.split_at(end);
        let len = shown_len + u32::from(!shown.is_empty()) + strings::wtf8_len_utf16(word);
        if len > CHAR_LIMIT {
            shown.extend_from_slice(b"...");
            break;
        }
        if !shown.is_empty() {
            shown.push(b' ');
        }
        shown.extend_from_slice(word);
        shown_len = len;
        rest = strings::trim_js_whitespace_start(after);
    }
    shown
}

/// `/^term\b/iu`, with the `\b` if `term` ends with a `\w`.
fn is_here(term: &[u8], rest: &[u8]) -> bool {
    text::strip_prefix_ignoring_case(rest, term)
        .is_some_and(|after| !(is_word_character(term.last()) && text::starts_with_word_ignoring_case(after)))
}

/// `/\bterm\b/iu`, each `\b` if there is a `\w` on that side of `term`.
fn is_anywhere(term: &[u8], value: &[u8]) -> bool {
    let Some(first) = term.first() else {
        return true;
    };
    // The bytes that a character starts with that is `first` but for its case.
    let starts = [*first, first.to_ascii_uppercase(), text::first_byte_of_other_case(*first)];
    let mut at = 0;
    while let Some(found) = strings::index_of_any(value.get(at..).unwrap_or_default(), &starts) {
        at += found;
        let Some((before, rest)) = value.split_at_checked(at) else {
            return false;
        };
        if !(is_word_character(Some(first)) && text::ends_with_word_ignoring_case(before)) && is_here(term, rest) {
            return true;
        }
        at += 1;
    }
    false
}

impl NoWarningComments {
    /// `/^[\s<decoration>]*term\b/iu`
    fn starts_with(&self, term: &[u8], value: &[u8]) -> bool {
        let mut rest = value;
        while !is_here(term, rest) {
            let after_decoration = |c| text::strip_prefix_ignoring_case(rest, std::slice::from_ref(c));
            rest = match strings::js_whitespace_len(rest) {
                0 => match self.decoration.iter().find_map(after_decoration) {
                    Some(rest) => rest,
                    None => return false,
                },
                len => rest.get(len..).unwrap_or_default(),
            };
        }
        true
    }

    fn has(&self, term: &Term, value: &[u8]) -> bool {
        match &term.matcher {
            Matcher::Ascii(term) if self.is_at_start => self.starts_with(term, value),
            Matcher::Ascii(term) => is_anywhere(term, value),
            Matcher::Pattern(pattern) => pattern.test(value),
        }
    }
}

impl Rule for NoWarningComments {
    const META: Meta = Meta::eslint("no-warning-comments", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let is_at_start = object.str("location") != Some("anywhere");
        let decoration = object.strings("decoration").concat().into_bytes();
        let terms = match object.has("terms") {
            true => object.strings("terms"),
            false => vec!["todo", "fixme", "xxx"],
        };
        let convert_to_reg_exp = |term: &[u8]| {
            let mut pattern = Vec::new();
            if is_at_start {
                pattern.extend_from_slice(b"^[\\s");
                pattern.extend_from_slice(&text::escape_string_regexp(&decoration));
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
        let matcher = |term: &[u8]| match term.is_ascii() && (!is_at_start || decoration.is_ascii()) {
            true => Some(Matcher::Ascii(term.to_ascii_lowercase())),
            false => Some(Matcher::Pattern(Box::new(convert_to_reg_exp(term)?))),
        };
        NoWarningComments {
            terms: (terms.iter().map(|term| term.as_bytes()))
                .filter_map(|term| Some(Term { text: term.to_vec(), matcher: matcher(term)? }))
                .collect(),
            is_at_start,
            decoration: decoration.to_ascii_lowercase(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                if comment.kind() == TokenKind::Shebang {
                    continue;
                }
                let value = comment.comment_value();
                let mut matches = rule.terms.iter().filter(|term| rule.has(term, value)).peekable();
                if matches.peek().is_none() || ast_utils::is_directive_comment(&comment) && is_self_config(value) {
                    continue;
                }
                let shown = comment_to_display(value);
                // oxlint says one thing about a comment.
                let count = if cx.language().is_oxlint { 1 } else { usize::MAX };
                for term in matches.take(count) {
                    cx.report(comment, UNEXPECTED_COMMENT)
                        .data("matchedTerm", term.text.clone())
                        .data("comment", shown.clone());
                }
            }
        });
    }
}
