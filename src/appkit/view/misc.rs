//! `Divider` (a one-pixel separator line) and `Spacer` (empty stretch).

use super::{Attr, Cx, Orientation, Prop, Rel, Widget, priority};
use crate::error::Result;
use crate::geometry::{Positive, Rect};
use crate::objc;
use crate::objc::appkit::{BoxType, NSBox, NSLayoutConstraint, NSView};

/// A divider with no `vertical` prop and no parent axis to go by.
const DEFAULT_DIVIDER_VERTICAL: bool = false;

pub(crate) struct Divider {
    view: NSBox,
    /// The `vertical` prop, when set; otherwise the line runs across the
    /// parent container's axis.
    explicit: Option<bool>,
    /// The parent container's main axis, known once the divider has one.
    axis: Option<Orientation>,
    vertical: bool,
    /// Pins the short axis to one pixel; swapped when `vertical` changes.
    thickness: NSLayoutConstraint,
}

impl Divider {
    pub(crate) fn new(_cx: &Cx<'_>) -> Divider {
        let view = NSBox::init_with_frame(objc::alloc::<NSBox>(), Rect::new(0.0, 0.0, 100.0, 1.0));
        view.set_box_type(BoxType::Separator);
        let thickness = Divider::orient(&view, DEFAULT_DIVIDER_VERTICAL);
        Divider {
            view,
            explicit: None,
            axis: None,
            vertical: DEFAULT_DIVIDER_VERTICAL,
            thickness,
        }
    }

    /// An `NSBoxSeparator` draws along whichever side is longer, so besides
    /// the one-pixel constraint the long axis must be the one that stretches.
    fn orient(view: &NSBox, vertical: bool) -> NSLayoutConstraint {
        let (short, long, attr) = if vertical {
            (Orientation::Horizontal, Orientation::Vertical, Attr::Width)
        } else {
            (Orientation::Vertical, Orientation::Horizontal, Attr::Height)
        };
        view.set_content_hugging_priority(priority::YIELDING, long);
        view.set_content_hugging_priority(priority::DEFAULT_LOW, short);
        let thickness = NSLayoutConstraint::with_items(
            view,
            attr,
            Rel::Equal,
            None,
            Attr::NotAnAttribute,
            1.0,
            1.0,
        );
        thickness.set_active(true);
        thickness
    }

    fn reorient(&mut self) {
        let vertical = self.explicit.unwrap_or(match self.axis {
            Some(Orientation::Horizontal) => true,
            Some(Orientation::Vertical) => false,
            None => DEFAULT_DIVIDER_VERTICAL,
        });
        if vertical != self.vertical {
            self.thickness.set_active(false);
            self.thickness = Divider::orient(&self.view, vertical);
            self.vertical = vertical;
        }
    }
}

impl Widget for Divider {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Vertical(b) => {
                self.explicit = b;
                self.reorient();
            }
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn attached(&mut self, axis: Option<Orientation>) {
        self.axis = axis;
        self.reorient();
    }

    fn rewrites_own_priorities(&self, prop: &Prop<'_>) -> bool {
        matches!(prop, Prop::Vertical(_))
    }
}

pub(crate) struct Spacer {
    view: NSView,
    min_length: Option<Positive>,
    /// The parent container's main axis, known once the spacer has one.
    axis: Option<Orientation>,
    constraint: Option<NSLayoutConstraint>,
}

impl Spacer {
    pub(crate) fn new(_cx: &Cx<'_>) -> Spacer {
        let view = NSView::init_with_frame(objc::alloc::<NSView>(), Rect::default());
        for axis in Orientation::BOTH {
            view.set_content_hugging_priority(priority::YIELDING, axis);
            view.set_content_compression_resistance_priority(priority::YIELDING, axis);
        }
        Spacer {
            view,
            min_length: None,
            axis: None,
            constraint: None,
        }
    }

    fn apply_min_length(&mut self) {
        if let Some(old) = self.constraint.take() {
            old.set_active(false);
        }
        let (Some(length), Some(axis)) = (self.min_length, self.axis) else {
            return;
        };
        let attr = match axis {
            Orientation::Horizontal => Attr::Width,
            Orientation::Vertical => Attr::Height,
        };
        let c = NSLayoutConstraint::with_items(
            &self.view,
            attr,
            Rel::GreaterOrEqual,
            None,
            Attr::NotAnAttribute,
            1.0,
            length.get(),
        );
        c.set_priority(priority::ALMOST_REQUIRED);
        c.set_active(true);
        self.constraint = Some(c);
    }
}

impl Widget for Spacer {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::MinLength(v) => {
                self.min_length = v;
                self.apply_min_length();
                Ok(None)
            }
            other => Ok(Some(other)),
        }
    }

    fn attached(&mut self, axis: Option<Orientation>) {
        self.axis = axis;
        self.apply_min_length();
    }
}
