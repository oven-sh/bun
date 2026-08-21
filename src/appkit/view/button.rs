//! `PushButton`, `Toggle` (checkbox, radio) and `Switch`.

use super::{ButtonKind, Cx, Event, Orientation, Prop, TITLE_COMPRESSION, Widget, priority};
use crate::color::Color;
use crate::error::Result;
use crate::geometry::Rect;
use crate::objc;
use crate::objc::NsStr;
use crate::objc::appkit::{
    BezelStyle, CellImagePosition, ControlStateValue, NSButton, NSSwitch, NSView,
};
use crate::objc::foundation::NSString;

const DEFAULT_KIND: ButtonKind = ButtonKind::Default;

pub(crate) struct PushButton {
    view: NSButton,
    kind: ButtonKind,
    /// An explicit `keyEquivalent`; `None` lets `kind` decide (Return for Primary).
    key_equivalent: Option<NSString>,
    has_image: bool,
}

impl PushButton {
    pub(crate) fn new(cx: &Cx<'_>) -> PushButton {
        let view = NSButton::with_title(&NSString::from(""), None, None);
        view.set_bezel_style(BezelStyle::Push);
        // A button keeps its natural width in a Fill stack instead of stretching.
        view.set_content_hugging_priority(priority::DEFAULT_HIGH, Orientation::Horizontal);
        view.set_content_compression_resistance_priority(
            TITLE_COMPRESSION,
            Orientation::Horizontal,
        );
        super::wire_action(cx, &view);
        PushButton {
            view,
            kind: DEFAULT_KIND,
            key_equivalent: None,
            has_image: false,
        }
    }

    fn place_image(&self) {
        let title_empty = self.view.title().length() == 0;
        self.view.set_image_position(if !self.has_image {
            CellImagePosition::NoImage
        } else if title_empty {
            CellImagePosition::ImageOnly
        } else {
            CellImagePosition::ImageLeft
        });
    }

    /// Return is what makes a button the window's default (accent) button.
    fn apply_key_equivalent(&self) {
        match &self.key_equivalent {
            Some(key) => self.view.set_key_equivalent(key),
            None => {
                self.view
                    .set_key_equivalent(&NSString::from(if self.kind == ButtonKind::Primary {
                        "\r"
                    } else {
                        ""
                    }))
            }
        }
    }

    fn set_kind(&mut self, kind: ButtonKind) {
        self.kind = kind;
        self.view.set_bordered(kind != ButtonKind::Link);
        self.view.set_bezel_style(if kind == ButtonKind::Toolbar {
            BezelStyle::Toolbar
        } else {
            BezelStyle::Push
        });
        self.view
            .set_has_destructive_action(kind == ButtonKind::Destructive);
        self.apply_key_equivalent();
    }

    fn set_symbol(&mut self, name: Option<NsStr<'_>>) -> Result<()> {
        match name {
            Some(name) => {
                let image = super::image::system_symbol(name)?;
                self.view.set_image(Some(&image));
                self.has_image = true;
            }
            None => {
                self.view.set_image(None);
                self.has_image = false;
            }
        }
        self.place_image();
        Ok(())
    }
}

impl Widget for PushButton {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Text(s) => {
                self.view.set_title(&NSString::from_str(s));
                if self.has_image {
                    self.place_image();
                }
            }
            Prop::Enabled(v) => self.view.set_enabled(v),
            Prop::Font(font) => super::apply_font(&self.view, font),
            Prop::ButtonKind(kind) => self.set_kind(kind.unwrap_or(DEFAULT_KIND)),
            Prop::Symbol(name) => self.set_symbol(name)?,
            Prop::KeyEquivalent(key) => {
                self.key_equivalent = key.map(NSString::from_str);
                self.apply_key_equivalent();
            }
            Prop::Tint(color) => self
                .view
                .set_content_tint_color(color.as_ref().map(Color::to_nscolor).as_ref()),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        emit(Event::Action);
    }

    fn click(&self) -> bool {
        self.view.perform_click(None);
        true
    }

    fn detach(&mut self) {
        super::unwire_action(&self.view);
    }
}

/// A checkbox or radio button.
pub(crate) struct Toggle {
    view: NSButton,
}

impl Toggle {
    pub(crate) fn checkbox(cx: &Cx<'_>) -> Toggle {
        Toggle::wired(cx, NSButton::checkbox(&NSString::from(""), None, None))
    }

    pub(crate) fn radio(cx: &Cx<'_>) -> Toggle {
        Toggle::wired(cx, NSButton::radio(&NSString::from(""), None, None))
    }

    fn wired(cx: &Cx<'_>, view: NSButton) -> Toggle {
        view.set_content_compression_resistance_priority(
            TITLE_COMPRESSION,
            Orientation::Horizontal,
        );
        super::wire_action(cx, &view);
        Toggle { view }
    }

    fn is_on(&self) -> bool {
        ControlStateValue::is_on(self.view.state())
    }
}

impl Widget for Toggle {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Text(s) => self.view.set_title(&NSString::from_str(s)),
            Prop::Enabled(v) => self.view.set_enabled(v),
            Prop::Font(font) => super::apply_font(&self.view, font),
            Prop::Checked(v) => self.view.set_state(ControlStateValue::from(v)),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn checked(&self) -> Option<bool> {
        Some(self.is_on())
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        emit(Event::Toggled(self.is_on()));
    }

    fn click(&self) -> bool {
        self.view.perform_click(None);
        true
    }

    fn detach(&mut self) {
        super::unwire_action(&self.view);
    }
}

pub(crate) struct Switch {
    view: NSSwitch,
}

impl Switch {
    pub(crate) fn new(cx: &Cx<'_>) -> Switch {
        let view = NSSwitch::init_with_frame(objc::alloc::<NSSwitch>(), Rect::default());
        super::wire_action(cx, &view);
        Switch { view }
    }

    fn is_on(&self) -> bool {
        ControlStateValue::is_on(self.view.state())
    }
}

impl Widget for Switch {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Checked(v) => self.view.set_state(ControlStateValue::from(v)),
            Prop::Enabled(v) => self.view.set_enabled(v),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn checked(&self) -> Option<bool> {
        Some(self.is_on())
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        emit(Event::Toggled(self.is_on()));
    }

    fn click(&self) -> bool {
        self.view.perform_click(None);
        true
    }

    fn detach(&mut self) {
        super::unwire_action(&self.view);
    }
}
