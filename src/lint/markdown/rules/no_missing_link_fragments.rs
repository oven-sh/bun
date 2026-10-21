use crate::prelude::*;
use crate::slugger::Slugger;
use bun_lint::utils::text::decode_uri;

/// Disallow link fragments that do not reference valid headings
pub struct NoMissingLinkFragments {
    ignore_case: bool,
    allow_pattern: util::PatternOption,
}

const INVALID_FRAGMENT: Message = Message::new(
    "invalidFragment",
    "Link fragment '#{{fragment}}' does not reference a heading or anchor in this document.",
);

static GITHUB_LINE_REFERENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r"/^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/u"));
/// Upstream's regex starts with `(?<!<)` instead of `^` and has the `g` flag. See `html_ids`.
static HTML_ID_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(r#"/^<[^>]+\s(?:id|name)\s*=\s*["']?(?<id>[^"'\s>]+)["']?/iu"#)
});

/// The `id` group of the match of `/\{#(?<id>[^}\s]+)\}\s*$/u` in `text`.
fn custom_heading_id(text: &[u8]) -> Option<&[u8]> {
    let before = strings::trim_js_whitespace_end(text).strip_suffix(b"}")?;
    // Walk back over the characters that an id can contain.
    let mut start = before.len();
    while start > 0 && before[start - 1] != b'}' {
        match strings::js_whitespace_len_back(&before[..start]) {
            0 => start -= 1,
            _ => break,
        }
    }
    let run = &before[start..];
    let id = &run[strings::index_of(run, b"{#")? + 2..];
    (!id.is_empty()).then_some(id)
}

/// The `id` group of each match of upstream's regex in `html`. A match never crosses a `>`, and it captures the last
/// candidate attribute before the `>`. So there's at most one match between a `<` and the next `>`, and it starts at
/// that `<`.
fn html_ids(html: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut from = 0;
    std::iter::from_fn(move || {
        loop {
            let start = from + strings::index_of_char_usize(html.get(from..)?, b'<')?;
            let rest = &html[start..];
            let tag = &rest[..strings::index_of_char_usize(rest, b'>').unwrap_or(rest.len())];
            from = start + tag.len() + 1;
            if strings::contains_char(tag, b'=')
                && let Some(found) = HTML_ID_NAME.exec_at(tag, 0)
            {
                return Some(found.bytes(1));
            }
        }
    })
}

#[derive(Default)]
pub(crate) struct Seen<'d> {
    /// Doesn't include `top`, which is always valid.
    fragment_ids: FxHashSet<Vec<u8>>,
    slugger: Slugger,
    relevant_nodes: Vec<Node<'d>>,
    heading_text: Vec<u8>,
}

impl Rule for NoMissingLinkFragments {
    const META: Meta = meta("no-missing-link-fragments").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let allow_pattern = options.str("allowPattern").unwrap_or_default();
        NoMissingLinkFragments {
            ignore_case: options.bool_or("ignoreCase", true),
            allow_pattern: util::pattern_option(&Self::META, allow_pattern, "u"),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        Self::new(options).allow_pattern.map(|_| ())
    }
}

impl Listens for NoMissingLinkFragments {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("heading", Kinds::of(&[Kind::Heading])),
        Listener::new("heading *:not(html)", Kinds::ALL).within(Within::Heading),
        Listener::new("heading:exit", Kinds::of(&[Kind::Heading])),
        Listener::new("html", Kinds::of(&[Kind::Html])),
        Listener::new(
            "definition, link",
            Kinds::of(&[Kind::Definition, Kind::Link]),
        ),
        Listener::new("root:exit", Kinds::of(&[Kind::Root])),
    ];
    type Seen<'d> = Seen<'d>;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        state: &mut Seen<'d>,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        match listener {
            0 => state.heading_text.clear(),
            1 => {
                if node.kind() != Kind::Html {
                    let value = node.value().unwrap_or_default();
                    state.heading_text.extend_from_slice(value);
                }
            }
            2 => {
                let text = &state.heading_text[..];
                let slug = state.slugger.slug(custom_heading_id(text).unwrap_or(text));
                state.fragment_ids.insert(slug);
            }
            3 => {
                let html = util::strip_html_comments(node.value().unwrap_or_default());
                for id in html_ids(&html) {
                    let slug = state.slugger.slug(id);
                    state.fragment_ids.insert(slug);
                }
                for found in util::html_headings(&html, (1, 6)) {
                    let children = &html[found.children.0..found.children.1];
                    let (mut text, mut from) = (Vec::new(), 0);
                    for tag in util::tags(children, util::TagPattern::OpeningOrClosing) {
                        text.extend_from_slice(&children[from..tag.start]);
                        from = tag.end;
                    }
                    text.extend_from_slice(&children[from..]);
                    let slug = state.slugger.slug(&text);
                    state.fragment_ids.insert(slug);
                }
            }
            4 => {
                if node.url().len() > 1 && node.url().starts_with(b"#") {
                    state.relevant_nodes.push(node);
                }
            }
            _ => {
                for &node in &state.relevant_nodes {
                    let fragment = &node.url()[1..];
                    let decoded = match strings::contains_char(fragment, b'%') {
                        true => decode_uri(fragment, b"").map_or(Cow::Borrowed(fragment), Cow::Owned),
                        false => Cow::Borrowed(fragment),
                    };
                    if matches!(&self.allow_pattern, Ok(Some(allowed)) if allowed.test(&decoded))
                        || (decoded.starts_with(b"L") && GITHUB_LINE_REFERENCE.test(&decoded))
                    {
                        continue;
                    }
                    let normalized = match self.ignore_case {
                        true => to_lower_case(&decoded),
                        false => Cow::Borrowed(&*decoded),
                    };
                    if &*normalized != b"top" && !state.fragment_ids.contains(&*normalized) {
                        cx.report_node(node, INVALID_FRAGMENT, &[("fragment", fragment)]);
                    }
                }
            }
        }
        Ok(())
    }
}
