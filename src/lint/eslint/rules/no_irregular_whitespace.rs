use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow irregular whitespace.
pub struct NoIrregularWhitespace {
    skip_comments: bool,
    skip_jsx_text: Option<bool>,
    skip_reg_exps: Option<bool>,
    skip_strings: bool,
    skip_templates: Option<bool>,
}

const NO_IRREGULAR_WHITESPACE: Message =
    Message::new("noIrregularWhitespace", "Irregular whitespace not allowed.");

#[derive(Copy, Clone, PartialEq)]
enum Irregular {
    Whitespace,
    LineTerminator,
}

/// What irregular whitespace character `text` starts with, and its length in bytes.
#[inline]
fn irregular_at(text: &[u8]) -> Option<(Irregular, usize)> {
    Some(match text {
        [0x0B | 0x0C, ..] => (Irregular::Whitespace, 1),
        // U+0085, U+00A0
        [0xC2, 0x85 | 0xA0, ..] => (Irregular::Whitespace, 2),
        // U+2028, U+2029
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => (Irregular::LineTerminator, 3),
        // U+1680, U+180E, U+2000 to U+200B, U+202F, U+205F, U+3000, U+FEFF
        [0xE1, 0x9A, 0x80, ..]
        | [0xE1, 0xA0, 0x8E, ..]
        | [0xE2, 0x80, 0x80..=0x8B | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => (Irregular::Whitespace, 3),
        _ => return None,
    })
}

/// What `skipJSXText`, `skipRegExps` and `skipTemplates` are where the options do not say: on in oxlint 1.87.
fn skips_by_default(file: &File) -> bool {
    file.language().is_oxlint
}

/// oxlint reports each character, and not each run of them.
fn oxlint_reports_each_character(file: &File) -> bool {
    file.language().is_oxlint
}

/// The kind of the token that `offset` is in, if `node`, the innermost around it in a file without JSX, tells.
/// `piece`: the piece of a template that was looked at last.
fn kind_of_token_in(node: Node, offset: u32, piece: &mut Span) -> Option<TokenKind> {
    match node {
        Node::Expr(e) => match e.kind() {
            ExprKind::String(_) => Some(TokenKind::String),
            ExprKind::Regex(_) => Some(TokenKind::RegularExpression),
            ExprKind::Template(template) => {
                if !piece.contains_offset(offset) {
                    let (exprs, mut before, mut end) =
                        (template.exprs(), 0, template.exprs().len());
                    while before < end {
                        let middle = before.midpoint(end);
                        match exprs.get(middle).is_some_and(|it| it.span().end <= offset) {
                            true => before = middle + 1,
                            false => end = middle,
                        }
                    }
                    *piece = template.quasi_span(before);
                }
                piece.contains_offset(offset).then_some(TokenKind::Template)
            }
            _ => None,
        },
        Node::Prop(prop) => {
            let key = prop
                .key()
                .filter(|it| matches!(it.kind(), KeyKind::String(_)))?;
            key.span(prop.file())
                .contains_offset(offset)
                .then_some(TokenKind::String)
        }
        _ => None,
    }
}

/// For each of `places`, which are in order: the kind of the token that it starts in, where that shows without the tokens of the
/// file. Only what is around one of them is looked at.
fn kinds_of_tokens_around<'a>(file: &'a File<'a>, places: &[Span]) -> Vec<Option<TokenKind>> {
    let mut kinds = vec![None; places.len()];
    // There, what a string is depends on where it is.
    if file.has_exprs([ExprTag::Jsx]) {
        return kinds;
    }
    let mut piece = Span::default();
    let mut pending = vec![(Node::File(file), 0..places.len())];
    while let Some((node, within)) = pending.pop() {
        // In `node` and in none of its children.
        let mut look_at = |own: std::ops::Range<usize>| {
            let own = (kinds.get_mut(own.clone()).unwrap_or_default().iter_mut())
                .zip(places.get(own).unwrap_or_default());
            own.for_each(|(kind, place)| *kind = kind_of_token_in(node, place.start, &mut piece));
        };
        let mut next = within.start;
        node.for_each_child(|child| {
            if next == within.end {
                return;
            }
            let (span, rest) = (
                child.span(),
                places.get(next..within.end).unwrap_or_default(),
            );
            let first = next + rest.partition_point(|it| it.start < span.start);
            let after = next + rest.partition_point(|it| it.start < span.end);
            look_at(next..first);
            if first < after {
                pending.push((child, first..after));
            }
            next = after.max(first);
        });
        look_at(next..within.end);
    }
    kinds
}

impl NoIrregularWhitespace {
    /// Whether the whitespace at `offset` is in something that the options allow it in. Each of
    /// the nodes that upstream looks at is one token: a string or a regular expression `Literal`,
    /// a `TemplateElement`, a `JSXText`.
    ///
    /// `known`: the kind of the token that it is in.
    fn is_skipped<'a>(&self, file: &'a File<'a>, offset: u32, known: Option<TokenKind>) -> bool {
        debug_assert!(
            known.is_none() || known == file.token_or_comment_around(offset).map(Token::kind)
        );
        let token = match known {
            Some(_) => None,
            None => file.token_or_comment_around(offset),
        };
        let Some(kind) = known.or_else(|| token.map(Token::kind)) else {
            return false;
        };
        match kind {
            TokenKind::String => self.skip_strings,
            TokenKind::RegularExpression => {
                self.skip_reg_exps.unwrap_or_else(|| skips_by_default(file))
            }
            TokenKind::Template => self
                .skip_templates
                .unwrap_or_else(|| skips_by_default(file)),
            // The value of an attribute is a string `Literal`.
            TokenKind::JsxText => match token.and_then(|it| file.token_before(it)) {
                Some(before) if before.is_punctuator("=") => self.skip_strings,
                _ => self.skip_jsx_text.unwrap_or_else(|| skips_by_default(file)),
            },
            TokenKind::Line | TokenKind::Block | TokenKind::Shebang => self.skip_comments,
            _ => false,
        }
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let text = cx.text();
        let rest_from = |at: usize| text.get(at..).unwrap_or_default();
        // ESLint takes a byte order mark off the text.
        let mut at = if text.starts_with(b"\xEF\xBB\xBF") {
            3
        } else {
            0
        };
        // Nearly all is ASCII, in which there are two such characters. Where the ASCII ends that `at` is in.
        let mut ascii_end = at;
        let mut found = Vec::new();
        while let Some(&byte) = text.get(at) {
            let ahead = match byte.is_ascii() {
                true => {
                    if at >= ascii_end {
                        ascii_end = strings::first_non_ascii(rest_from(at))
                            .map_or(text.len(), |first| at + first as usize);
                    }
                    let ascii = text.get(at..ascii_end).unwrap_or_default();
                    strings::index_of_any(ascii, b"\x0B\x0C").unwrap_or(ascii.len())
                }
                false => 0,
            };
            let start = at + ahead;
            let Some((kind, len)) = irregular_at(rest_from(start)) else {
                at = start + 1;
                continue;
            };
            at = start + len;
            if kind == Irregular::Whitespace && !oxlint_reports_each_character(cx.file()) {
                while let Some((Irregular::Whitespace, len)) = irregular_at(rest_from(at)) {
                    at += len;
                }
            }
            found.push(Span::new(start as u32, at as u32));
        }
        if found.is_empty() {
            return;
        }
        // oxc's lexer takes the line separator that ends a `//` comment with the comment, and does not note it.
        let ends_comment = |place: Span| {
            let before = place.start.checked_sub(1);
            cx.language().is_oxlint
                && matches!(
                    irregular_at(cx.slice(place)),
                    Some((Irregular::LineTerminator, _))
                )
                && before
                    .and_then(|it| cx.file().token_or_comment_around(it))
                    .is_some_and(|it| it.kind() == TokenKind::Line && it.span().end == place.start)
        };
        for (&place, kind) in found.iter().zip(kinds_of_tokens_around(cx.file(), &found)) {
            if !self.is_skipped(cx.file(), place.start, kind) && !ends_comment(place) {
                cx.report(place, NO_IRREGULAR_WHITESPACE).hint_with(|| {
                    let character = strings::wtf8_first_codepoint(cx.slice(place))?;
                    Some(format!("It is the character U+{character:04X}. Replace it with a plain space or a line break."))
                });
            }
        }
    }
}

impl Rule for NoIrregularWhitespace {
    const META: Meta = Meta::eslint("no-irregular-whitespace", Kind::Problem)
        .recommended()
        .reports_at_the_end()
        .hints();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoIrregularWhitespace {
            skip_comments: options.bool_or("skipComments", false),
            skip_jsx_text: options.bool("skipJSXText"),
            skip_reg_exps: options.bool("skipRegExps"),
            skip_strings: options.bool_or("skipStrings", true),
            skip_templates: options.bool("skipTemplates"),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check(cx);
    }
}
