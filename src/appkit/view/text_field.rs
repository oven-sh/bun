//! `TextField`, `SecureField` and `SearchField`: one-line text input.

use super::{Cx, Event, Orientation, Prop, TextEvent, Widget, priority};
use crate::error::Result;
use crate::geometry::Rect;
use crate::objc;
use crate::objc::appkit::{NSSearchField, NSSecureTextField, NSTextField, NSView};
use crate::objc::foundation::{NSString, Upcast};

#[derive(Clone, Copy)]
pub(crate) enum Style {
    Plain,
    Secure,
    Search,
}

const DEFAULT_CONTINUOUS: bool = true;

pub(crate) struct TextField {
    view: NSTextField,
    /// `false` holds `TextChanged` back until editing ends or Return.
    continuous: bool,
    /// The text changed while `continuous` was off and nobody has been told yet.
    dirty: bool,
}

impl TextField {
    pub(crate) fn new(cx: &Cx<'_>, style: Style) -> TextField {
        let frame = Rect::default();
        let view: NSTextField = match style {
            Style::Plain => NSTextField::init_with_frame(objc::alloc(), frame),
            Style::Secure => (*NSSecureTextField::init_with_frame(objc::alloc(), frame)).clone(),
            Style::Search => {
                let field = NSSearchField::init_with_frame(objc::alloc(), frame);
                // Submitted means Return (or the search glyph), not every pause in typing.
                field.set_sends_whole_search_string(true);
                (*field).clone()
            }
        };
        match style {
            Style::Plain | Style::Secure => {
                view.set_bezeled(true);
                view.set_draws_background(true);
            }
            // NSSearchField draws its own rounded bezel.
            Style::Search => {}
        }
        view.set_editable(true);
        view.set_selectable(true);
        super::apply_font(&view, None);
        if let Some(cell) = view.cell() {
            cell.set_scrollable(true);
            cell.set_sends_action_on_end_editing(false);
        }
        // A long value scrolls inside the field instead of pushing the window wider.
        view.set_content_compression_resistance_priority(
            priority::DEFAULT_LOW,
            Orientation::Horizontal,
        );
        view.set_delegate(Some(cx.target));
        super::wire_action(cx, &view);
        TextField {
            view,
            continuous: DEFAULT_CONTINUOUS,
            dirty: false,
        }
    }
}

impl Widget for TextField {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Text(s) => {
                let value = NSString::from_str(s);
                // Re-assigning the text the field already shows would still
                // reset the caret and selection while the user is typing.
                if !self.view.string_value().is_equal(Some(value.upcast())) {
                    self.view.set_string_value(&value);
                    // The user's unreported edit was just replaced from code.
                    self.dirty = false;
                }
            }
            Prop::Placeholder(p) => self
                .view
                .set_placeholder_string(p.map(NSString::from_str).as_ref()),
            Prop::Editable(v) => self.view.set_editable(v),
            Prop::Enabled(v) => self.view.set_enabled(v),
            Prop::Font(font) => super::apply_font(&self.view, font),
            Prop::TextAlign(align) => self.view.set_alignment(align.into()),
            Prop::Continuous(v) => self.continuous = v.unwrap_or(DEFAULT_CONTINUOUS),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn text(&self) -> Option<Vec<u16>> {
        Some(self.view.string_value().to_utf16())
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        if core::mem::take(&mut self.dirty) {
            emit(Event::TextChanged);
        }
        emit(Event::Submitted);
    }

    fn on_text(&mut self, which: TextEvent, emit: &mut dyn FnMut(Event)) {
        match which {
            TextEvent::Changed => {
                if self.continuous {
                    emit(Event::TextChanged);
                } else {
                    self.dirty = true;
                }
            }
            TextEvent::Began => {
                self.dirty = false;
                emit(Event::EditingBegan);
            }
            TextEvent::Ended => {
                if core::mem::take(&mut self.dirty) {
                    emit(Event::TextChanged);
                }
                emit(Event::EditingEnded);
            }
        }
    }

    fn detach(&mut self) {
        self.view.set_delegate(None);
        super::unwire_action(&self.view);
    }
}
