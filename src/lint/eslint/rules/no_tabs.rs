use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow all tabs.
pub struct NoTabs {
    allow_indentation_tabs: bool,
}

const UNEXPECTED_TAB: Message = Message::new("unexpectedTab", "Unexpected tab character.");

impl Rule for NoTabs {
    const META: Meta = Meta::eslint("no-tabs", Kind::Layout).deprecated();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoTabs {
            allow_indentation_tabs: options.object(0).bool_or("allowIndentationTabs", false),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let source = cx.text();
        let mut at = 0;
        // Where the line that has been looked at last starts, and where its indentation ends.
        let mut indentation = Span::default();
        while let Some(rest) = source.get(at..)
            && let Some(found) = strings::index_of_char_usize(rest, b'\t')
        {
            let start = at + found;
            at = start + rest[found..].iter().take_while(|b| **b == b'\t').count();
            let tabs = Span::new(start as u32, at as u32);
            if self.allow_indentation_tabs {
                let line = cx.line_span(cx.line_of(tabs.start));
                if indentation.start != line.start || indentation.is_empty() {
                    let rest = strings::trim_js_whitespace_start(cx.slice(line)).len() as u32;
                    indentation = Span::new(line.start, line.end - rest);
                }
                if tabs.start <= indentation.end {
                    continue;
                }
            }
            cx.report(tabs, UNEXPECTED_TAB);
        }
    }
}
