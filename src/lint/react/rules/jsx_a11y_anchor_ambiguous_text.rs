use crate::a11y::is_hidden_from_screen_reader;
use crate::jsx::{
    Child, as_jsx_element, children, get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Inspects anchor link text for the use of ambiguous words.
pub struct AnchorAmbiguousText {
    words: Vec<String>,
}

const ANCHOR_HAS_AMBIGUOUS_TEXT: Message =
    Message::new("", "Ambiguous text within anchor, screen reader users rely on link text for context.");

impl Rule for AnchorAmbiguousText {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "anchor-ambiguous-text", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = Texts;

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let words = match config.has("words") {
            true => config.strings("words"),
            false => vec!["click here", "here", "link", "a link", "learn more"],
        };
        AnchorAmbiguousText { words: words.into_iter().map(String::from).collect() }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(Texts::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(jsx_el) = as_jsx_element(e)
            && *get_element_type(cx.file(), jsx_el) == *b"a"
            && let Some(text) = self.ambiguous_text(cx.file(), jsx_el, &mut cx.state)
        {
            cx.report(e, ANCHOR_HAS_AMBIGUOUS_TEXT).data("text", text);
        }
    }
}

/// The text of the children of the anchors that have been read, by where the name in the tag is: anchors can be in each other.
/// `None`: it is longer than every word.
pub type Texts = FxHashMap<u32, Option<Normalized>>;

/// What a screen reader says for an element.
enum AccessibleText<'a> {
    Of(&'a [u8]),
    OfChildren,
    None,
}

fn get_accessible_text<'a>(file: &'a File<'a>, jsx_el: Jsx<'a>) -> AccessibleText<'a> {
    let string_of = |name: &str| has_jsx_prop_ignore_case(jsx_el, name).and_then(get_string_literal_prop_value);
    if let Some(label_text) = string_of("aria-label") {
        return AccessibleText::Of(label_text);
    }
    if *get_element_type(file, jsx_el) == *b"img"
        && let Some(alt_text) = string_of("alt")
    {
        return AccessibleText::Of(alt_text);
    }
    match is_hidden_from_screen_reader(file, jsx_el) {
        true => AccessibleText::None,
        false => AccessibleText::OfChildren,
    }
}

/// `normalize_str` of pieces of text with a blank between them: in lower case, without punctuation, one blank for any whitespace.
#[derive(Clone, Default)]
pub struct Normalized {
    text: String,
    /// Whether a piece had more than whitespace.
    has_text: bool,
}

impl Normalized {
    fn push(&mut self, piece: &[u8]) {
        let mut is_after_whitespace = true;
        for c in std::str::from_utf8(&text::to_lower_case(piece)).unwrap_or_default().chars() {
            if c.is_whitespace() {
                is_after_whitespace = true;
                continue;
            }
            self.has_text = true;
            if matches!(c, ',' | '.' | '?' | '¿' | '!' | '‽' | '¡' | ';' | ':') {
                continue;
            }
            if is_after_whitespace && !self.text.is_empty() {
                self.text.push(' ');
            }
            is_after_whitespace = false;
            self.text.push(c);
        }
    }

    /// The same for pieces that have been put together.
    fn append(&mut self, pieces: &Normalized) {
        self.has_text |= pieces.has_text;
        if !pieces.text.is_empty() {
            if !self.text.is_empty() {
                self.text.push(' ');
            }
            self.text.push_str(&pieces.text);
        }
    }
}

impl AnchorAmbiguousText {
    /// The text of `anchor`, if it is one of the words.
    fn ambiguous_text<'a>(&self, file: &'a File<'a>, anchor: Jsx<'a>, texts: &mut Texts) -> Option<String> {
        let longest = self.words.iter().map(String::len).max().unwrap_or(0);
        let normalized = match get_accessible_text(file, anchor) {
            AccessibleText::Of(text) => {
                let mut normalized = Normalized::default();
                normalized.push(text);
                Some(normalized)
            }
            AccessibleText::OfChildren => text_of_children(file, anchor, longest, texts),
            AccessibleText::None => None,
        };
        normalized.filter(|it| it.has_text && self.words.contains(&it.text)).map(|it| it.text)
    }
}

/// `None`: it is longer than `longest`.
fn text_of_children<'a>(file: &'a File<'a>, anchor: Jsx<'a>, longest: usize, texts: &mut Texts) -> Option<Normalized> {
    let key_of_anchor = |jsx_el: Jsx<'a>| match *get_element_type(file, jsx_el) == *b"a" {
        true => jsx_el.tag().map(|it| it.span().start),
        false => None,
    };
    let key = key_of_anchor(anchor);
    if let Some(known) = key.and_then(|it| texts.get(&it)) {
        return known.clone();
    }
    // The elements that are being read, each in the one before: the key of an anchor, the children that are still to be read, and
    // the text of those that are read.
    let mut open = SmallVec::<[_; 4]>::new();
    open.push((key, children(file, anchor), Normalized::default()));
    loop {
        let (_, siblings, text) = open.last_mut()?;
        let mut is_too_long = false;
        match siblings.next() {
            Some(Child::Text(piece)) => text.push(piece),
            Some(Child::Element(child_el)) => match get_accessible_text(file, child_el) {
                AccessibleText::Of(piece) => text.push(piece),
                AccessibleText::OfChildren => {
                    let key = key_of_anchor(child_el);
                    match key.and_then(|it| texts.get(&it)) {
                        Some(Some(known)) => text.append(known),
                        Some(None) => is_too_long = true,
                        None => open.push((key, children(file, child_el), Normalized::default())),
                    }
                }
                AccessibleText::None => {}
            },
            Some(_) => {}
            None => {
                let (key, _, text) = open.pop()?;
                if let Some(key) = key {
                    texts.insert(key, Some(text.clone()));
                }
                match open.last_mut() {
                    Some(parent) => parent.2.append(&text),
                    None => return Some(text),
                }
            }
        }
        // Then the text of all that it is in is too long too.
        if is_too_long || open.last().is_some_and(|it| it.2.text.len() > longest) {
            texts.extend(open.iter().filter_map(|it| it.0).map(|key| (key, None)));
            return None;
        }
    }
}
