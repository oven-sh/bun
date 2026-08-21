//! `Picker` (a pop-up button) and `Segmented`: one index chosen from a list
//! of titles.

use super::{Cx, Event, Orientation, Prop, TITLE_COMPRESSION, Widget};
use crate::error::Result;
use crate::geometry::Rect;
use crate::objc;
use crate::objc::appkit::{
    NSMenuItem, NSPopUpButton, NSSegmentedControl, NSView, SegmentDistribution,
    SegmentSwitchTracking,
};
use crate::objc::foundation::{NSArray, NSString};

const DEFAULT_SELECTED: Option<usize> = Some(0);

/// The index to show for `wanted` given `count` items: the wanted one if it
/// exists, else nothing. `wanted` outlives the item list so a `selectedIndex`
/// that arrives before `items` still takes effect.
fn resolve(wanted: Option<usize>, count: usize) -> Option<usize> {
    wanted.filter(|&i| i < count)
}

fn from_native(index: isize) -> Option<usize> {
    usize::try_from(index).ok()
}

fn to_native(index: Option<usize>) -> isize {
    index.and_then(|i| isize::try_from(i).ok()).unwrap_or(-1)
}

pub(crate) struct Picker {
    view: NSPopUpButton,
    wanted: Option<usize>,
    /// Key equivalent for every menu item.
    empty: NSString,
}

impl Picker {
    pub(crate) fn new(cx: &Cx<'_>) -> Picker {
        let view =
            NSPopUpButton::init_pulls_down(objc::alloc::<NSPopUpButton>(), Rect::default(), false);
        view.set_content_compression_resistance_priority(
            TITLE_COMPRESSION,
            Orientation::Horizontal,
        );
        super::wire_action(cx, &view);
        Picker {
            view,
            wanted: DEFAULT_SELECTED,
            empty: NSString::from(""),
        }
    }

    fn count(&self) -> usize {
        from_native(self.view.number_of_items()).unwrap_or(0)
    }

    fn apply(&self) {
        self.view
            .select_item_at(to_native(resolve(self.wanted, self.count())));
    }
}

impl Widget for Picker {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Items(items) => {
                // Built item by item rather than with `addItemsWithTitles:`,
                // which drops an earlier item with the same title and so
                // shifts every index after it.
                self.view.remove_all_items();
                let menu = self.view.menu().expect("a pop-up button always has a menu");
                for title in &items {
                    let title = NSString::from_str(*title);
                    let item = NSMenuItem::init_with_title(
                        objc::alloc::<NSMenuItem>(),
                        &title,
                        None,
                        &self.empty,
                    );
                    menu.add_item(&item);
                }
                self.apply();
            }
            Prop::SelectedIndex(i) => {
                self.wanted = i.unwrap_or(DEFAULT_SELECTED);
                self.apply();
            }
            Prop::Enabled(b) => self.view.set_enabled(b),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn selected_index(&self) -> Option<Option<usize>> {
        Some(from_native(self.view.index_of_selected_item()))
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        self.wanted = from_native(self.view.index_of_selected_item());
        emit(Event::IndexChanged(self.wanted));
    }

    fn detach(&mut self) {
        super::unwire_action(&self.view);
    }
}

pub(crate) struct Segmented {
    view: NSSegmentedControl,
    wanted: Option<usize>,
}

impl Segmented {
    pub(crate) fn new(cx: &Cx<'_>) -> Segmented {
        let empty = NSArray::empty();
        let view =
            NSSegmentedControl::with_labels(&empty, SegmentSwitchTracking::SelectOne, None, None);
        // Fill, so the control spans a Fill-aligned stack.
        view.set_segment_distribution(SegmentDistribution::Fill);
        view.set_content_compression_resistance_priority(
            TITLE_COMPRESSION,
            Orientation::Horizontal,
        );
        super::wire_action(cx, &view);
        Segmented {
            view,
            wanted: DEFAULT_SELECTED,
        }
    }

    fn count(&self) -> usize {
        from_native(self.view.segment_count()).unwrap_or(0)
    }

    fn apply(&self) {
        self.view
            .set_selected_segment(to_native(resolve(self.wanted, self.count())));
    }
}

impl Widget for Segmented {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Items(items) => {
                let count = isize::try_from(items.len()).unwrap_or(isize::MAX);
                self.view.set_segment_count(count);
                for (i, label) in (0..count).zip(&items) {
                    self.view
                        .set_label_for_segment(&NSString::from_str(*label), i);
                    self.view.set_width_for_segment(0.0, i);
                }
                self.apply();
            }
            Prop::SelectedIndex(i) => {
                self.wanted = i.unwrap_or(DEFAULT_SELECTED);
                self.apply();
            }
            Prop::Enabled(b) => self.view.set_enabled(b),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn selected_index(&self) -> Option<Option<usize>> {
        Some(from_native(self.view.selected_segment()))
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        self.wanted = from_native(self.view.selected_segment());
        emit(Event::IndexChanged(self.wanted));
    }

    fn detach(&mut self) {
        super::unwire_action(&self.view);
    }
}
