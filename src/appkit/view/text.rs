//! Static text: an `NSTextField` label.

use super::{Cx, Orientation, Prop, Widget, priority};
use crate::error::Result;
use crate::objc::appkit::{LineBreakMode, NSColor, NSTextField, NSView};
use crate::objc::foundation::NSString;

const DEFAULT_LINE_LIMIT: usize = 1;
const DEFAULT_SELECTABLE: bool = false;

pub(crate) struct Text {
    view: NSTextField,
}

impl Text {
    pub(crate) fn new(_cx: &Cx<'_>) -> Text {
        let view = NSTextField::label(&NSString::from(""));
        view.set_selectable(DEFAULT_SELECTABLE);
        // A long label truncates instead of pushing the window wider.
        view.set_content_compression_resistance_priority(
            priority::DEFAULT_LOW,
            Orientation::Horizontal,
        );
        let text = Text { view };
        text.set_line_limit(DEFAULT_LINE_LIMIT);
        text
    }

    fn set_line_limit(&self, lines: usize) {
        // Truncating modes turn the cell's wrapping off, so "n lines then
        // an ellipsis" is word wrapping plus truncatesLastVisibleLine.
        let (single, mode, truncate_last) = match lines {
            1 => (true, LineBreakMode::ByTruncatingTail, false),
            0 => (false, LineBreakMode::ByWordWrapping, false),
            _ => (false, LineBreakMode::ByWordWrapping, true),
        };
        self.view
            .set_maximum_number_of_lines(isize::try_from(lines).unwrap_or(isize::MAX));
        self.view.set_uses_single_line_mode(single);
        self.view.set_line_break_mode(mode);
        if let Some(cell) = self.view.cell() {
            cell.set_truncates_last_visible_line(truncate_last);
        }
    }
}

impl Widget for Text {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Text(s) => self.view.set_string_value(&NSString::from_str(s)),
            Prop::Font(font) => super::apply_font(&self.view, font),
            Prop::Color(color) => {
                let color = match color {
                    Some(c) => c.to_nscolor(),
                    None => NSColor::label_color(),
                };
                self.view.set_text_color(Some(&color));
            }
            Prop::TextAlign(align) => self.view.set_alignment(align.into()),
            Prop::Selectable(v) => self.view.set_selectable(v.unwrap_or(DEFAULT_SELECTABLE)),
            Prop::LineLimit(lines) => self.set_line_limit(lines.unwrap_or(DEFAULT_LINE_LIMIT)),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }
}
