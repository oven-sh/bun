use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow mixed spaces and tabs for indentation.
pub struct NoMixedSpacesAndTabs {
    smart_tabs: bool,
}

const MIXED_SPACES_AND_TABS: Message = Message::new("mixedSpacesAndTabs", "Mixed spaces and tabs.");

/// How many times `byte` is repeated at the start of `text`.
fn run(text: &[u8], byte: u8) -> usize {
    text.iter().take_while(|&&it| it == byte).count()
}

impl NoMixedSpacesAndTabs {
    /// The length of the indentation of `line` up to and including the first character that does
    /// not belong there.
    fn mixed_indentation(&self, line: &[u8]) -> Option<usize> {
        if self.smart_tabs {
            let tabs = run(line, b'\t');
            let spaces = run(&line[tabs..], b' ');
            return (spaces > 0 && line.get(tabs + spaces) == Some(&b'\t')).then_some(tabs + spaces + 1);
        }
        let (first, other) = match line.first()? {
            b' ' => (b' ', b'\t'),
            b'\t' => (b'\t', b' '),
            _ => return None,
        };
        let same = run(line, first);
        (line.get(same) == Some(&other)).then_some(same + 1)
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for number in 1..=file.line_count() {
            let mut line = file.line_span(number);
            if number == 1 && file.has_bom() {
                line.start += 3;
            }
            let Some(len) = self.mixed_indentation(file.slice(line)) else {
                continue;
            };
            let end = line.start + len as u32;
            let at = Span::new(end - 2, end);
            // A comment that the line starts in has started on an earlier line.
            if file.comment_around(line.start).is_none()
                && !matches!(utils::estree_type_at(file, at.start), "Literal" | "TemplateElement")
            {
                cx.report(at, MIXED_SPACES_AND_TABS);
            }
        }
    }
}

impl Rule for NoMixedSpacesAndTabs {
    const META: Meta = Meta::eslint("no-mixed-spaces-and-tabs", Kind::Layout).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoMixedSpacesAndTabs {
            smart_tabs: options.bool(0) == Some(true) || options.str(0) == Some("smart-tabs"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let text = file.text();
        if strings::contains(text, b" \t") || !self.smart_tabs && strings::contains(text, b"\t ") {
            on.finish(Self::check);
        }
    }
}
