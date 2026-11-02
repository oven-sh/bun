use crate::prelude::*;

/// Disallow multiple H1 headings in the same document
pub struct NoMultipleH1 {
    title: util::PatternOption,
}

const MULTIPLE_H1: &Message =
    &Message::new("multipleH1", "Unexpected additional H1 heading found.");


impl Rule for NoMultipleH1 {
    const META: Meta = meta("no-multiple-h1").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        NoMultipleH1 {
            title: util::front_matter_title(&Self::META, options.object(0)),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        Self::new(options).title.map(|_| ())
    }
}

impl Listens for NoMultipleH1 {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("yaml, toml, json", Kinds::of(&[Kind::FrontMatter])),
        Listener::new("html", Kinds::of(&[Kind::Html])),
        Listener::new("heading", Kinds::of(&[Kind::Heading])),
    ];
    /// `h1Count`
    type Seen<'d> = u32;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        count: &mut u32,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        match listener {
            0 => {
                let value = node.value().unwrap_or_default();
                if let Ok(title) = &self.title {
                    *count += u32::from(util::front_matter_has_title(value, title.as_ref()));
                }
            }
            1 => {
                let text = util::strip_html_comments(node.value().unwrap_or_default());
                // Like upstream, these index into the value, which isn't the source text if the HTML is in a container.
                let mut indices = Indices::new(&text, node.start_index());
                // `/<h1[^>]*>[\s\S]*?<\/h1\s*>/giu`
                for found in util::html_headings(&text, (1, 1)) {
                    *count += 1;
                    if *count > 1 {
                        let locs = cx.locs(indices.at(found.start), indices.at(found.end))?;
                        cx.report(locs, MULTIPLE_H1, &[]);
                    }
                }
            }
            _ => {
                if node.depth() == 1 {
                    *count += 1;
                    if *count > 1 {
                        cx.report_node(node, MULTIPLE_H1, &[]);
                    }
                }
            }
        }
        Ok(())
    }
}
