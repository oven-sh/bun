//! https://learn.microsoft.com/windows/win32/winauto/uiauto-providerportal

mod element;
mod properties;
mod range;

use element::Element;

use super::window::Window;
use crate::abi::accessibility::{self as abi, Role, Text};
use crate::accessibility::{self, Event, Forest, Id, read};
use crate::win32::com::{BasicString, Borrowed, Variant};
use crate::win32::*;

/// Narrator does not say so.
pub fn has_screen_reader() -> bool {
    let narrates = registry::number(
        wide!("Software\\Microsoft\\Narrator\\NoRoam"),
        wide!("RunningState"),
    )
    .is_some_and(|it| it != 0);
    narrates || system_parameter::<Bool>(SPI_GETSCREENREADER, 0) != 0
}

/// Parts of the system ask every window for it. That is no reason to build trees.
pub fn object_for(window: &Window, w: usize, l: isize) -> Option<isize> {
    if l as i32 != UIA_ROOT_OBJECT_ID {
        return None;
    }
    accessibility::set_clients(false, has_screen_reader());
    Some(uia_return_provider(
        window.handle,
        w,
        l,
        Element::of_window(window.id).borrowed(),
    ))
}

pub fn window_closes(window: &Window) {
    if element::WERE_ASKED_FOR.get() {
        uia_return_provider(window.handle, 0, 0, Borrowed::default());
        _ = uia_disconnect_provider(Element::of_window(window.id).borrowed());
    }
}

enum Notice {
    Plain(i32),
    Property(i32),
    ChildrenChanged,
    Loaded,
    Says(String, bool),
}

/// Of a live region that is not read as a whole, only what is new is.
fn news(forest: &Forest, events: &[Event], event: &Event) -> Option<(Element, Notice)> {
    let (at, text) = match event {
        Event::HypertextChanged { id, inserted } => (*id, inserted.replace('\u{fffc}', "")),
        Event::ChildrenChanged { parent, added, .. } => {
            let objects = added
                .iter()
                .filter(|it| forest.get(**it).is_some_and(|it| !it.is_text()));
            (
                *parent,
                objects
                    .map(|it| forest.field_text(*it).text)
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        }
        _ => return None,
    };
    let region = forest.live_region(at).filter(|region| {
        events
            .iter()
            .any(|it| matches!(it, Event::LiveRegionChanged(it) if it == region))
    })?;
    let node = forest
        .get(region)
        .filter(|it| !it.has(abi::LIVE_ATOMIC) && !text.trim().is_empty())?;
    Some((
        Element::of(forest, region)?,
        Notice::Says(text, node.has(abi::LIVE_ASSERTIVE)),
    ))
}

fn notices(forest: &Forest, event: &Event, all: &mut Vec<(Element, Notice)>) -> Option<()> {
    use Notice::*;
    let mut add = |id: Id, notice| all.extend(Element::of(forest, id).map(|it| (it, notice)));
    match event {
        Event::Focused { window, to } if forest.is_window_active(*window) => add(
            forest.exposed((*to)?),
            Plain(UIA_AUTOMATION_FOCUS_CHANGED_EVENT_ID),
        ),
        Event::RootsChanged(window) => all.push((Element::pane(*window), ChildrenChanged)),
        Event::ChildrenChanged { parent, .. } if !forest.is_leaf(*parent) => {
            add(*parent, ChildrenChanged)
        }
        Event::Loaded(id) => add(*id, Loaded),
        Event::Created(id) => match forest.get(*id)?.role {
            Role::Menu => add(*id, Plain(UIA_MENU_OPENED_EVENT_ID)),
            Role::Tooltip => add(*id, Plain(UIA_TOOL_TIP_OPENED_EVENT_ID)),
            Role::Dialog | Role::AlertDialog => add(*id, Plain(UIA_WINDOW_WINDOW_OPENED_EVENT_ID)),
            _ => {}
        },
        Event::Destroyed(id, Role::Menu) => {
            add(forest.root_of(id.tree)?, Plain(UIA_MENU_CLOSED_EVENT_ID))
        }
        Event::ActiveDescendantChanged(id) => add(*id, Property(UIA_CONTROLLER_FOR_PROPERTY_ID)),
        Event::NameChanged(id) if properties::is_control(forest, *id, forest.get(*id)?) => {
            add(*id, Property(UIA_NAME_PROPERTY_ID))
        }
        Event::DescriptionChanged(id) => add(*id, Property(UIA_FULL_DESCRIPTION_PROPERTY_ID)),
        Event::ValueChanged(id) if properties::has_range(forest.get(*id)?) => {
            add(*id, Property(UIA_RANGE_VALUE_VALUE_PROPERTY_ID))
        }
        Event::ValueChanged(id) => add(*id, Property(UIA_VALUE_VALUE_PROPERTY_ID)),
        Event::TextChanged(id, Text::Invalid) => {
            add(*id, Property(UIA_IS_DATA_VALID_FOR_FORM_PROPERTY_ID))
        }
        Event::TextChanged(id, Text::Sort) => add(*id, Property(UIA_ITEM_STATUS_PROPERTY_ID)),
        Event::TextChanged(id, _) => add(*id, Property(UIA_ARIA_PROPERTIES_PROPERTY_ID)),
        Event::StatesChanged(id, changed) => {
            let node = forest.get(*id)?;
            let properties = [
                (abi::DISABLED, UIA_IS_ENABLED_PROPERTY_ID),
                (abi::READ_ONLY, UIA_VALUE_IS_READ_ONLY_PROPERTY_ID),
                (abi::REQUIRED, UIA_IS_REQUIRED_FOR_FORM_PROPERTY_ID),
                (
                    abi::EXPANDED | abi::COLLAPSED,
                    UIA_EXPAND_COLLAPSE_EXPAND_COLLAPSE_STATE_PROPERTY_ID,
                ),
                (
                    abi::CHECKED | abi::MIXED,
                    UIA_TOGGLE_TOGGLE_STATE_PROPERTY_ID,
                ),
                (
                    abi::BUSY | abi::CHECKED | abi::MIXED | abi::SELECTED | abi::EXPANDED,
                    UIA_ARIA_PROPERTIES_PROPERTY_ID,
                ),
            ];
            properties
                .into_iter()
                .filter(|it| changed & it.0 != 0)
                .for_each(|it| add(*id, Property(it.1)));
            if properties::is_selectable(node) && changed & (abi::SELECTED | abi::CHECKED) != 0 {
                let is_one_of_many = forest
                    .selection_container(*id)
                    .and_then(|it| forest.get(it))
                    .is_some_and(|it| it.has(abi::MULTISELECTABLE));
                add(*id, Property(UIA_SELECTION_ITEM_IS_SELECTED_PROPERTY_ID));
                match (properties::is_selected(node), is_one_of_many) {
                    (true, false) => add(*id, Plain(UIA_SELECTION_ITEM_ELEMENT_SELECTED_EVENT_ID)),
                    (true, true) => add(
                        *id,
                        Plain(UIA_SELECTION_ITEM_ELEMENT_ADDED_TO_SELECTION_EVENT_ID),
                    ),
                    (false, true) => add(
                        *id,
                        Plain(UIA_SELECTION_ITEM_ELEMENT_REMOVED_FROM_SELECTION_EVENT_ID),
                    ),
                    (false, false) => {}
                }
            }
            if changed & abi::LOADING != 0 && !node.has(abi::LOADING) {
                add(*id, Loaded);
            }
        }
        Event::Edited { field, .. } => {
            add(*field, Plain(UIA_TEXT_TEXT_CHANGED_EVENT_ID));
            add(*field, Property(UIA_VALUE_VALUE_PROPERTY_ID));
        }
        Event::HypertextChanged { id, .. } if !forest.get(*id)?.has(abi::EDITABLE) => add(
            forest.root_of(id.tree)?,
            Plain(UIA_TEXT_TEXT_CHANGED_EVENT_ID),
        ),
        Event::SelectionChanged { within, .. } => {
            add(*within, Plain(UIA_TEXT_TEXT_SELECTION_CHANGED_EVENT_ID))
        }
        Event::LiveRegionChanged(id) | Event::LiveRegionCreated(id)
            if forest.get(*id)?.has(abi::LIVE_ATOMIC) && forest.children(*id).next().is_some() =>
        {
            add(*id, Plain(UIA_LIVE_REGION_CHANGED_EVENT_ID))
        }
        Event::Announced {
            tree,
            text,
            is_urgent,
        } => add(forest.root_of(*tree)?, Says(text.clone(), *is_urgent)),
        _ => {}
    }
    Some(())
}

pub fn post(events: &[Event]) {
    if !element::WERE_ASKED_FOR.get() || uia_clients_are_listening() == 0 {
        return;
    }
    let mut all = Vec::new();
    read(|forest| {
        events
            .iter()
            .for_each(|it| _ = notices(forest, it, &mut all));
        all.extend(events.iter().filter_map(|it| news(forest, events, it)));
    });
    all.dedup_by(|a, b| {
        a.0 == b.0 && matches!((&a.1, &b.1), (Notice::Plain(a), Notice::Plain(b)) if a == b)
    });
    for (element, notice) in all {
        let object = element.object();
        _ = match notice {
            Notice::Plain(event) => uia_raise(object.borrowed(), event),
            Notice::Property(property) => uia_raise_property_changed(
                object.borrowed(),
                property,
                &Variant::default(),
                &element.value_of(property),
            ),
            Notice::Loaded => uia_raise_loaded(
                object.borrowed(),
                ASYNC_CONTENT_LOADED_STATE_COMPLETED,
                100.,
            ),
            Notice::ChildrenChanged => {
                let id = element.runtime_id().unwrap_or_default();
                let address = if id.is_empty() {
                    std::ptr::null()
                } else {
                    id.as_ptr()
                };
                // SAFETY: a slice with its length.
                unsafe {
                    uia_raise_structure_changed(
                        object.borrowed(),
                        STRUCTURE_CHANGE_TYPE_CHILDREN_INVALIDATED,
                        address,
                        id.len() as i32,
                    )
                }
            }
            Notice::Says(text, is_urgent) => {
                let processing = if is_urgent {
                    NOTIFICATION_PROCESSING_IMPORTANT_ALL
                } else {
                    NOTIFICATION_PROCESSING_ALL
                };
                uia_raise_notification(
                    object.borrowed(),
                    NOTIFICATION_KIND_OTHER,
                    processing,
                    BasicString::new(&text).lent(),
                    BasicString::new("").lent(),
                )
            }
        };
    }
}
