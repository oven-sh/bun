//! `TextEditor`: a plain-text `NSTextView` inside its scroll view.

use super::{Cx, Event, Prop, TextEvent, Widget};
use crate::error::Result;
use crate::objc::Object;
use crate::objc::appkit::{NSColor, NSScrollView, NSTextView, NSView};
use crate::objc::foundation::{NSString, Upcast};

pub(crate) struct TextEditor {
    scroll: NSScrollView,
    text: NSTextView,
}

impl TextEditor {
    pub(crate) fn new(cx: &Cx<'_>) -> TextEditor {
        let scroll = NSTextView::scrollable_text_view();
        let text = scroll
            .document_view()
            .and_then(|v| v.downcast::<NSTextView>().ok())
            .expect("scrollableTextView document is an NSTextView");
        text.set_rich_text(false);
        text.set_automatic_quote_substitution_enabled(false);
        text.set_automatic_dash_substitution_enabled(false);
        text.set_automatic_text_replacement_enabled(false);
        text.set_allows_undo(true);
        text.set_uses_adaptive_color_mapping_for_dark_appearance(true);
        // NSTextView's own default is Helvetica 12; match the other controls.
        text.set_font(Some(&crate::font::Font::default().to_nsfont()));
        text.set_text_color(Some(&NSColor::text_color()));
        text.set_delegate(Some(cx.target));
        TextEditor { scroll, text }
    }
}

impl Widget for TextEditor {
    fn view(&self) -> &NSView {
        &self.scroll
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Text(s) => {
                let value = NSString::from_str(s);
                // Same reason as TextField: leave the caret alone when nothing changed.
                if !self.text.string().is_equal(Some(value.upcast())) {
                    self.text.set_string(&value);
                    // setString: bypasses the shouldChangeText/didChangeText bracket, so
                    // pending undo groups refer to ranges that no longer exist and Cmd-Z
                    // would raise NSRangeException. This is the view's own manager (see
                    // `undoManagerForTextView:`), so siblings keep their history.
                    self.text.break_undo_coalescing();
                    if let Some(undo) = self.text.undo_manager() {
                        undo.remove_all_actions();
                    }
                }
            }
            Prop::Editable(v) => self.text.set_editable(v),
            Prop::Font(font) => self
                .text
                .set_font(Some(&font.unwrap_or_default().to_nsfont())),
            Prop::Color(color) => {
                let color = match color {
                    Some(c) => c.to_nscolor(),
                    None => NSColor::text_color(),
                };
                self.text.set_text_color(Some(&color));
            }
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn text(&self) -> Option<Vec<u16>> {
        Some(self.text.string().to_utf16())
    }

    fn on_text(&mut self, which: TextEvent, emit: &mut dyn FnMut(Event)) {
        match which {
            TextEvent::Changed => emit(Event::TextChanged),
            TextEvent::Began | TextEvent::Ended => {}
        }
    }

    fn detach(&mut self) {
        self.text.set_delegate(None);
    }
}
