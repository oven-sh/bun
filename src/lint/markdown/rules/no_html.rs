use crate::prelude::*;

/// Disallow HTML tags
pub struct NoHtml {
    allowed: FxHashSet<Vec<u8>>,
    allowed_ignore_case: bool,
}

const DISALLOWED_ELEMENT: &Message = &Message::new(
    "disallowedElement",
    "HTML element \"{{name}}\" is not allowed.",
);

impl NoHtml {
    fn normalize<'n>(&self, name: &'n [u8]) -> Cow<'n, [u8]> {
        match self.allowed_ignore_case {
            true => to_lower_case(name),
            false => Cow::Borrowed(name),
        }
    }
}

impl Rule for NoHtml {
    const META: Meta = meta("no-html");
    listens!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut rule = NoHtml {
            allowed: FxHashSet::default(),
            allowed_ignore_case: options.bool_or("allowedIgnoreCase", false),
        };
        let allowed = options.strings("allowed");
        rule.allowed = (allowed.iter())
            .map(|it| rule.normalize(it.as_bytes()).into_owned())
            .collect();
        rule
    }
}

impl Listens for NoHtml {
    const LISTENERS: &'static [Listener] = &[Listener::new("html", Kinds::of(&[Kind::Html]))];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        _: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let text = util::strip_html_comments(node.text());
        let mut indices = Indices::new(&text, node.start_index());
        for tag in util::tags(&text, util::TagPattern::Opening) {
            let name = &text[tag.name.0..tag.name.1];
            if self.allowed.contains(&*self.normalize(name)) {
                continue;
            }
            let first_line = util::lines(&text[tag.start..tag.end]).next().unwrap_or_default();
            let start = indices.at(tag.start);
            let locs = cx.locs(start, start + length(first_line))?;
            cx.report(locs, DISALLOWED_ELEMENT, &[("name", name)]);
        }
        Ok(())
    }
}
