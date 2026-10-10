use crate::a11y::{cow_to_ascii_lowercase, is_hidden_from_screen_reader};
use crate::jsx::{AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that `img` alt attributes do not contain redundant words like "image", "picture", or "photo".
pub struct ImgRedundantAlt {
    components: Vec<String>,
    /// In lower case, as far as they are ASCII.
    words: Vec<String>,
}

const IMG_REDUNDANT_ALT: Message = Message::new("", "Redundant `alt` attribute.");

impl Rule for ImgRedundantAlt {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "img-redundant-alt", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        ImgRedundantAlt {
            components: config.strings("components").into_iter().chain(["img"]).map(String::from).collect(),
            words: (config.strings("words").into_iter().chain(["image", "photo", "picture"]))
                .map(str::to_ascii_lowercase)
                .collect(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let element_type = get_element_type(cx.file(), jsx_el);
        if !self.components.iter().any(|it| *it.as_bytes() == *element_type)
            || is_hidden_from_screen_reader(cx.file(), jsx_el)
        {
            return;
        }
        let Some(alt_prop) = has_jsx_prop_ignore_case(jsx_el, "alt") else {
            return;
        };
        let (Some(alt_attribute), Some(name)) = (get_prop_value(alt_prop), alt_prop.key()) else {
            return;
        };
        let check = |alt_text: &[u8]| {
            if self.is_redundant_alt_text(alt_text) {
                cx.report(name.span(cx.file()), IMG_REDUNDANT_ALT);
            }
        };
        match alt_attribute {
            AttributeValue::StringLiteral(literal) => check(literal.value),
            AttributeValue::ExpressionContainer(e) if !e.is_parenthesized() => match e.kind() {
                ExprKind::String(value) => check(value.bytes()),
                ExprKind::Template(template) => (0..template.quasi_count()).for_each(|i| check(template.raw(i))),
                _ => {}
            },
            _ => {}
        }
    }
}

impl ImgRedundantAlt {
    fn is_redundant_alt_text(&self, alt_text: &[u8]) -> bool {
        let alt_text = cow_to_ascii_lowercase(alt_text);
        self.words.iter().any(|word| has_word(&alt_text, word.as_bytes()))
    }
}

/// Whether `word` is somewhere in `text` with no ASCII letter or digit before and after it.
fn has_word(text: &[u8], word: &[u8]) -> bool {
    let is_boundary = |at: usize| !text.get(at).is_some_and(u8::is_ascii_alphanumeric);
    let is_word_boundary = |start: usize, end: usize| (start == 0 || is_boundary(start - 1)) && is_boundary(end);
    if word.is_empty() {
        let is_between_characters = |at: usize| !matches!(text.get(at), Some(0x80..=0xBF));
        return (0..=text.len()).any(|at| is_between_characters(at) && is_word_boundary(at, at));
    }
    let mut from = 0;
    while let Some(found) = text.get(from..).and_then(|rest| bun_core::strings::index_of(rest, word)) {
        let start = from + found;
        from = start + word.len();
        if is_word_boundary(start, from) {
            return true;
        }
    }
    false
}
