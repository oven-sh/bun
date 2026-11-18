use std::cell::Cell;

use super::properties::{self, supports};
use super::range::Range;
use crate::abi::Rect;
use crate::abi::accessibility::{self as abi, Action, Number, Relation, Role, Text};
use crate::accessibility::forest::Node;
use crate::accessibility::search::is_link;
use crate::accessibility::text::Position;
use crate::accessibility::{self, Forest, Id, read};
use crate::host::system::callback;
use crate::platform::windows::window;
use crate::win32::com::{
    Array, BasicString, Borrowed, Class, Guid, Object, Out, Outcome, Status, Unknown, VT_UNKNOWN,
    Variant, class, made,
};
use crate::win32::*;

pub const GONE: Status = Status(UIA_E_ELEMENTNOTAVAILABLE);

thread_local! {
    pub static WERE_ASKED_FOR: Cell<bool> = const { Cell::new(false) };
}

/// A node, the window itself, or the pane in between, which is where screen readers expect a document.
#[derive(Clone, Copy, PartialEq)]
pub struct Element {
    window: u32,
    id: Option<Id>,
    is_pane: bool,
}

type Found = Out<Option<Unknown>>;

class! { Element, if Element::has_facet {
    0 [IID_I_RAW_ELEMENT_PROVIDER_SIMPLE, IID_I_RAW_ELEMENT_PROVIDER_SIMPLE2] {
        options(it: Out<i32>), pattern(id: i32, it: Found), property(id: i32, it: Out<Variant>), host(it: Found), show_context_menu(),
    }
    1 [IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT] {
        navigate(direction: i32, it: Found), identity(it: Out<Array>), bounds(it: Out<UiaRect>), no_array(it: Out<Array>), focus(), root(it: Found),
    }
    2 [IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT_ROOT] { hit(x: f64, y: f64, it: Found), focused(it: Found) }
    3 [IID_I_INVOKE_PROVIDER] { click() }
    4 [IID_I_TOGGLE_PROVIDER] { click(), toggle_state(it: Out<i32>) }
    5 [IID_I_EXPAND_COLLAPSE_PROVIDER] { expand(), collapse(), expansion(it: Out<i32>) }
    6 [IID_I_VALUE_PROVIDER] { set_value(value: Str), value(it: Out<BasicString>), is_read_only(it: Out<Bool>) }
    7 [IID_I_RANGE_VALUE_PROVIDER] {
        set_number(value: f64), now(it: Out<f64>), is_read_only(it: Out<Bool>), max(it: Out<f64>), min(it: Out<f64>), large_step(it: Out<f64>), step(it: Out<f64>),
    }
    8 [IID_I_SELECTION_PROVIDER] { selected(it: Out<Array>), selects_many(it: Out<Bool>), is_required(it: Out<Bool>) }
    9 [IID_I_SELECTION_ITEM_PROVIDER] { select(), select(), deselect(), is_selected(it: Out<Bool>), selection_container(it: Found) }
    10 [IID_I_SCROLL_ITEM_PROVIDER] { scroll_into_view() }
    11 [IID_I_GRID_PROVIDER] { cell_at(row: i32, column: i32, it: Found), rows(it: Out<i32>), columns(it: Out<i32>) }
    12 [IID_I_GRID_ITEM_PROVIDER] { row(it: Out<i32>), column(it: Out<i32>), row_span(it: Out<i32>), column_span(it: Out<i32>), table(it: Found) }
    13 [IID_I_TABLE_PROVIDER] { row_headers(it: Out<Array>), column_headers(it: Out<Array>), zero(it: Out<i32>) }
    14 [IID_I_TABLE_ITEM_PROVIDER] { row_headers(it: Out<Array>), column_headers(it: Out<Array>) }
    15 [IID_I_TEXT_PROVIDER, IID_I_TEXT_PROVIDER2] {
        selected_text(it: Out<Array>), visible_text(it: Out<Array>), text_of(child: Borrowed, it: Found), text_at(point: UiaPoint, it: Found),
        all_text(it: Found), kind_of_selection(it: Out<i32>), text_of(annotation: Borrowed, it: Found), caret(is_active: Out<Bool>, it: Found),
    }
    16 [IID_I_TEXT_CHILD_PROVIDER] { text_container(it: Found), text_in_container(it: Found) }
    17 [IID_I_WINDOW_PROVIDER] {
        _(), cancel(), _(), zero(it: Out<i32>), zero(it: Out<i32>), is_modal(it: Out<Bool>), zero(it: Out<i32>), is_ready(it: Out<i32>), zero(it: Out<i32>),
    }
} }

fn facet_of(pattern: i32) -> Option<Guid> {
    Some(match pattern {
        UIA_INVOKE_PATTERN_ID => IID_I_INVOKE_PROVIDER,
        UIA_TOGGLE_PATTERN_ID => IID_I_TOGGLE_PROVIDER,
        UIA_EXPAND_COLLAPSE_PATTERN_ID => IID_I_EXPAND_COLLAPSE_PROVIDER,
        UIA_VALUE_PATTERN_ID => IID_I_VALUE_PROVIDER,
        UIA_RANGE_VALUE_PATTERN_ID => IID_I_RANGE_VALUE_PROVIDER,
        UIA_SELECTION_PATTERN_ID => IID_I_SELECTION_PROVIDER,
        UIA_SELECTION_ITEM_PATTERN_ID => IID_I_SELECTION_ITEM_PROVIDER,
        UIA_SCROLL_ITEM_PATTERN_ID => IID_I_SCROLL_ITEM_PROVIDER,
        UIA_GRID_PATTERN_ID => IID_I_GRID_PROVIDER,
        UIA_GRID_ITEM_PATTERN_ID => IID_I_GRID_ITEM_PROVIDER,
        UIA_TABLE_PATTERN_ID => IID_I_TABLE_PROVIDER,
        UIA_TABLE_ITEM_PATTERN_ID => IID_I_TABLE_ITEM_PROVIDER,
        UIA_TEXT_PATTERN_ID | UIA_TEXT_PATTERN2_ID => IID_I_TEXT_PROVIDER2,
        UIA_TEXT_CHILD_PATTERN_ID => IID_I_TEXT_CHILD_PROVIDER,
        UIA_WINDOW_PATTERN_ID => IID_I_WINDOW_PROVIDER,
        _ => return None,
    })
}

pub fn perform(id: Id, action: Action, text: &str) -> Outcome {
    callback((), || accessibility::perform(id, action, [0; 4], text));
    Ok(())
}

pub fn objects(forest: &Forest, ids: impl IntoIterator<Item = Id>) -> Array {
    Array::of_objects(
        &ids.into_iter()
            .filter_map(|it| Some(Element::of(forest, it)?.object()))
            .collect::<Vec<_>>(),
    )
}

/// What ranges that start in it stay in.
fn holder_of_text(forest: &Forest, id: Id) -> Option<Id> {
    forest
        .closest(id, |it| it.has(abi::TEXT_FIELD))
        .or_else(|| std::iter::once(id).chain(forest.ancestors(id)).last())
}

impl Element {
    pub fn of(forest: &Forest, id: Id) -> Option<Element> {
        forest.get(id)?;
        Some(Element {
            window: forest.place_of(id.tree)?.0,
            id: Some(id),
            is_pane: false,
        })
    }

    pub fn of_window(window: u32) -> Unknown {
        WERE_ASKED_FOR.set(true);
        Element {
            window,
            id: None,
            is_pane: false,
        }
        .object()
    }

    pub fn pane(window: u32) -> Element {
        Element {
            window,
            id: None,
            is_pane: true,
        }
    }

    pub fn object(self) -> Unknown {
        Object::create(self)
    }

    fn facet(self, id: &Guid) -> Option<Unknown> {
        self.object().cast_to(id).ok()
    }

    fn fragment(self) -> Option<Unknown> {
        self.facet(&IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT)
    }

    fn has_facet(&self, id: &Guid) -> bool {
        match self.id {
            Some(_) => *id != IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT_ROOT,
            None => Self::IDS[..if self.is_pane { 2 } else { 3 }]
                .iter()
                .any(|it| it.contains(id)),
        }
    }

    fn ask<T>(&self, question: impl FnOnce(&Forest, Id, &Node) -> T) -> Outcome<T> {
        let id = self.id.ok_or(Status::NOT_IMPLEMENTED)?;
        accessibility::note_use();
        read(|forest| Ok(question(forest, id, forest.get(id).ok_or(GONE)?)))
    }

    fn act(&self, action: Action, text: &str) -> Outcome {
        match self.ask(|_, id, node| (id, node.has(abi::DISABLED)))? {
            (_, true) if action != Action::ScrollIntoView => Err(Status(UIA_E_ELEMENTNOTENABLED)),
            (id, _) => perform(id, action, text),
        }
    }

    fn find(&self, it: Found, find: impl FnOnce(&Forest, Id) -> Option<Id>) -> Outcome {
        it.answer(self.ask(|forest, id, _| Some(Element::of(forest, find(forest, id)?)?.object())))
    }

    fn has(&self, it: Out<Bool>, states: u64) -> Outcome {
        it.answer(self.ask(|_, _, node| node.has(states).into()))
    }

    fn need_trees(&self) {
        callback((), || {
            accessibility::note_use();
            accessibility::wait_for_trees(self.window);
        });
    }

    pub fn on_screen(window: u32, it: Rect) -> [f64; 4] {
        let Some(window) = window::with_id(window) else {
            return [0.; 4];
        };
        let (origin, scale) = (window.origin(), window.scale());
        let (left, top) = ((it.x * scale).floor(), (it.y * scale).floor());
        let (right, bottom) = (
            ((it.x + it.width) * scale).ceil(),
            ((it.y + it.height) * scale).ceil(),
        );
        [
            origin.x as f32 + left,
            origin.y as f32 + top,
            right - left,
            bottom - top,
        ]
        .map(f64::from)
    }

    fn in_window(&self, x: f64, y: f64) -> Outcome<[f32; 2]> {
        let window = window::with_id(self.window).ok_or(GONE)?;
        let (origin, scale) = (window.origin(), window.scale());
        Ok([
            (x as f32 - origin.x as f32) / scale,
            (y as f32 - origin.y as f32) / scale,
        ])
    }

    pub fn runtime_id(&self) -> Option<Vec<i32>> {
        match self.id {
            Some(it) => Some(vec![UIA_APPEND_RUNTIME_ID, it.tree as i32, it.node as i32]),
            None => self.is_pane.then(|| vec![UIA_APPEND_RUNTIME_ID, -1]),
        }
    }

    // ───────────────────────────── every element ─────────────────────────────

    fn options(&self, it: Out<i32>) -> Outcome {
        let lacks_title_bar =
            self.id.is_none() && window::with_id(self.window).is_some_and(|it| !it.has_title_bar());
        it.set(
            PROVIDER_OPTIONS_SERVER_SIDE_PROVIDER
                | PROVIDER_OPTIONS_USE_COM_THREADING
                | if lacks_title_bar {
                    PROVIDER_OPTIONS_REFUSE_NON_CLIENT_SUPPORT
                } else {
                    0
                },
        )
    }

    fn pattern(&self, pattern: i32, it: Found) -> Outcome {
        match self.id {
            Some(_) => it.answer(self.ask(|forest, id, node| {
                self.facet(&facet_of(pattern).filter(|_| supports(forest, id, node, pattern))?)
            })),
            None => it.set(None),
        }
    }

    fn property(&self, property: i32, it: Out<Variant>) -> Outcome {
        match self.id {
            Some(_) => it.answer(self.ask(|forest, id, node| {
                Self::property_of(forest, id, node, property).unwrap_or_default()
            })),
            None if property == UIA_FRAMEWORK_ID_PROPERTY_ID => it.set(FRAMEWORK.into()),
            None if property == UIA_CONTROL_TYPE_PROPERTY_ID && self.is_pane => {
                it.set(UIA_PANE_CONTROL_TYPE_ID.into())
            }
            None if property == UIA_IS_ENABLED_PROPERTY_ID && self.is_pane => it.set(true.into()),
            None => it.set(Variant::default()),
        }
    }

    pub fn value_of(&self, property: i32) -> Variant {
        self.ask(|forest, id, node| Self::property_of(forest, id, node, property))
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    fn property_of(forest: &Forest, id: Id, node: &Node, property: i32) -> Option<Variant> {
        let text = |key| node.text(key).map(Variant::from);
        let related = |keys: &[Relation]| {
            Variant::array(
                VT_UNKNOWN,
                objects(forest, keys.iter().flat_map(|it| forest.related(id, *it))),
            )
        };
        let place = || forest.place_in_set(id).filter(|_| node.may_be_in_set());
        Some(match property {
            UIA_ACCELERATOR_KEY_PROPERTY_ID => text(Text::KeyShortcuts)?,
            UIA_ACCESS_KEY_PROPERTY_ID => format!("Alt+{}", node.text(Text::AccessKey)?)
                .as_str()
                .into(),
            UIA_ARIA_PROPERTIES_PROPERTY_ID => properties::aria_properties(forest, id, node)
                .as_str()
                .into(),
            UIA_ARIA_ROLE_PROPERTY_ID => properties::aria_role(node).into(),
            UIA_AUTOMATION_ID_PROPERTY_ID if forest.parent(id).is_none() => "RootWebArea".into(),
            UIA_AUTOMATION_ID_PROPERTY_ID => text(Text::DomId)?,
            UIA_CLASS_NAME_PROPERTY_ID => text(Text::DomClass)?,
            UIA_CONTROL_TYPE_PROPERTY_ID => properties::control_type(forest, id, node).into(),
            UIA_CONTROLLER_FOR_PROPERTY_ID => {
                related(&[Relation::Controls, Relation::ErrorMessage])
            }
            UIA_CULTURE_PROPERTY_ID => properties::culture(forest, id)?.into(),
            UIA_DESCRIBED_BY_PROPERTY_ID => related(&[Relation::Details]),
            UIA_EXPAND_COLLAPSE_EXPAND_COLLAPSE_STATE_PROPERTY_ID => expansion_of(node).into(),
            UIA_FLOWS_FROM_PROPERTY_ID => Variant::array(
                VT_UNKNOWN,
                objects(forest, forest.related_to(id, Relation::FlowTo)),
            ),
            UIA_FLOWS_TO_PROPERTY_ID => related(&[Relation::FlowTo]),
            UIA_FRAMEWORK_ID_PROPERTY_ID => FRAMEWORK.into(),
            UIA_FULL_DESCRIPTION_PROPERTY_ID => text(Text::Description)?,
            UIA_HAS_KEYBOARD_FOCUS_PROPERTY_ID => (forest.is_focused(id)
                && forest.is_window_active(forest.place_of(id.tree)?.0))
            .into(),
            UIA_HEADING_LEVEL_PROPERTY_ID => (HEADING_LEVEL_NONE
                + node
                    .number(Number::Level)
                    .filter(|_| node.role == Role::Heading)?
                    .min(9.) as i32)
                .into(),
            UIA_HELP_TEXT_PROPERTY_ID => text(Text::Placeholder).or_else(|| {
                text(Text::Description).filter(|_| !node.has(abi::DESCRIBED_BY_ARIA))
            })?,
            UIA_IS_CONTENT_ELEMENT_PROPERTY_ID | UIA_IS_CONTROL_ELEMENT_PROPERTY_ID => {
                properties::is_control(forest, id, node).into()
            }
            UIA_IS_DATA_VALID_FOR_FORM_PROPERTY_ID => node
                .text(Text::Invalid)
                .is_none_or(|it| it == "false")
                .into(),
            UIA_IS_DIALOG_PROPERTY_ID => {
                matches!(node.role, Role::Dialog | Role::AlertDialog).into()
            }
            UIA_IS_ENABLED_PROPERTY_ID => (!node.has(abi::DISABLED)).into(),
            UIA_IS_KEYBOARD_FOCUSABLE_PROPERTY_ID => {
                (node.has(abi::FOCUSABLE) || forest.is_focused(id)).into()
            }
            UIA_IS_OFFSCREEN_PROPERTY_ID => forest.is_offscreen(id).into(),
            UIA_IS_PASSWORD_PROPERTY_ID => node.has(abi::PROTECTED).into(),
            UIA_IS_PERIPHERAL_PROPERTY_ID => {
                matches!(node.role, Role::Menu | Role::MenuListPopup | Role::Tooltip).into()
            }
            UIA_IS_REQUIRED_FOR_FORM_PROPERTY_ID => node.has(abi::REQUIRED).into(),
            UIA_ITEM_STATUS_PROPERTY_ID => text(Text::Sort)?,
            UIA_LABELED_BY_PROPERTY_ID => Variant::object(
                VT_UNKNOWN,
                Element::of(forest, forest.related(id, Relation::LabelledBy).next()?)?.object(),
            ),
            UIA_LANDMARK_TYPE_PROPERTY_ID => properties::landmark(node)?.into(),
            UIA_LEVEL_PROPERTY_ID => (node.number(Number::Level)? as i32).into(),
            UIA_LIVE_SETTING_PROPERTY_ID => (i32::from(node.has(abi::LIVE_POLITE))
                + 2 * i32::from(node.has(abi::LIVE_ASSERTIVE)))
            .into(),
            UIA_LOCALIZED_CONTROL_TYPE_PROPERTY_ID => properties::type_name(node)?.into(),
            UIA_LOCALIZED_LANDMARK_TYPE_PROPERTY_ID
                if properties::landmark(node)? == UIA_CUSTOM_LANDMARK_TYPE_ID =>
            {
                properties::type_name(node)?.into()
            }
            UIA_NAME_PROPERTY_ID => name_of(forest, id, node).as_str().into(),
            UIA_ORIENTATION_PROPERTY_ID => (i32::from(node.has(abi::HORIZONTAL))
                + 2 * i32::from(node.has(abi::VERTICAL)))
            .into(),
            UIA_POSITION_IN_SET_PROPERTY_ID => (place()?[0] as i32).into(),
            UIA_RANGE_VALUE_VALUE_PROPERTY_ID => node.number(Number::Now)?.into(),
            UIA_SELECTION_ITEM_IS_SELECTED_PROPERTY_ID => properties::is_selected(node).into(),
            UIA_SIZE_OF_SET_PROPERTY_ID if node.is_set() => (forest.size_of_set(id)? as i32).into(),
            UIA_SIZE_OF_SET_PROPERTY_ID => (place()?[1] as i32).into(),
            UIA_TOGGLE_TOGGLE_STATE_PROPERTY_ID => toggle_state_of(node).into(),
            UIA_VALUE_IS_READ_ONLY_PROPERTY_ID => is_read_only(node).into(),
            UIA_VALUE_VALUE_PROPERTY_ID => value_of(forest, id, node).as_str().into(),
            _ => return None,
        })
    }

    fn host(&self, it: Found) -> Outcome {
        match self.id.is_some() || self.is_pane {
            true => it.set(None),
            false => it.answer(
                made(|it| uia_host_provider(window::handle_of(Some(self.window)), it)).map(Some),
            ),
        }
    }

    fn show_context_menu(&self) -> Outcome {
        self.act(Action::ShowContextMenu, "")
    }

    fn navigate(&self, direction: i32, it: Found) -> Outcome {
        let is_down = matches!(
            direction,
            NAVIGATE_DIRECTION_FIRST_CHILD | NAVIGATE_DIRECTION_LAST_CHILD
        );
        let edge = |all: Vec<Id>| {
            if direction == NAVIGATE_DIRECTION_FIRST_CHILD {
                all.first()
            } else {
                all.last()
            }
            .copied()
        };
        if self.id.is_none() && (!self.is_pane || direction == NAVIGATE_DIRECTION_PARENT) {
            return it.set(
                (is_down || self.is_pane)
                    .then(|| {
                        Element {
                            is_pane: !self.is_pane,
                            ..*self
                        }
                        .fragment()
                    })
                    .flatten(),
            );
        }
        if self.is_pane {
            if is_down {
                self.need_trees();
            }
            return it.set(read(|forest| {
                Element::of(forest, edge(forest.roots(self.window)).filter(|_| is_down)?)?
                    .fragment()
            }));
        }
        it.answer(self.ask(|forest, id, _| {
            let is_next = direction == NAVIGATE_DIRECTION_NEXT_SIBLING;
            let found = match forest.parent(id) {
                _ if is_down => edge(forest.exposed_children(id)),
                None if direction == NAVIGATE_DIRECTION_PARENT => {
                    return Element::pane(self.window).fragment();
                }
                parent if direction == NAVIGATE_DIRECTION_PARENT => parent,
                Some(_) => forest.sibling(id, is_next),
                None => {
                    let roots = forest.roots(self.window);
                    let index = roots.iter().position(|it| *it == id)?;
                    roots
                        .get(if is_next {
                            index + 1
                        } else {
                            index.checked_sub(1)?
                        })
                        .copied()
                }
            };
            Element::of(forest, found?)?.fragment()
        }))
    }

    fn identity(&self, it: Out<Array>) -> Outcome {
        it.set(
            self.runtime_id()
                .map(|it| Array::of_integers(&it))
                .unwrap_or_default(),
        )
    }

    fn bounds(&self, it: Out<UiaRect>) -> Outcome {
        match self.id {
            Some(_) => it.answer(self.ask(|forest, id, _| {
                let [left, top, width, height] =
                    Self::on_screen(self.window, forest.bounds(id, None, true));
                UiaRect {
                    left,
                    top,
                    width,
                    height,
                }
            })),
            None if self.is_pane => it.answer(window::with_id(self.window).ok_or(GONE).map(|it| {
                let (origin, (width, height)) = (it.origin(), it.client_size());
                UiaRect {
                    left: origin.x.into(),
                    top: origin.y.into(),
                    width: width.into(),
                    height: height.into(),
                }
            })),
            None => it.set(UiaRect::default()),
        }
    }

    fn no_array(&self, it: Out<Array>) -> Outcome {
        it.set(Array::default())
    }

    fn focus(&self) -> Outcome {
        if self.id.is_some() {
            self.act(Action::Focus, "")
        } else {
            Ok(())
        }
    }

    fn root(&self, it: Found) -> Outcome {
        it.set(
            Element {
                id: None,
                is_pane: false,
                ..*self
            }
            .facet(&IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT_ROOT),
        )
    }

    fn hit(&self, x: f64, y: f64, it: Found) -> Outcome {
        self.need_trees();
        it.answer(self.in_window(x, y).map(|at| {
            read(|forest| {
                Element::of(
                    forest,
                    forest.exposed(forest.hit_in_window(self.window, at)?),
                )?
                .fragment()
            })
        }))
    }

    fn focused(&self, it: Found) -> Outcome {
        callback((), || accessibility::wait_for_trees(self.window));
        it.set(read(|forest| {
            Element::of(forest, forest.exposed(forest.focus(self.window)?))?.fragment()
        }))
    }

    // ───────────────────────────── controls ─────────────────────────────

    fn click(&self) -> Outcome {
        self.act(Action::Click, "")
    }

    fn cancel(&self) -> Outcome {
        self.act(Action::Cancel, "")
    }

    fn toggle_state(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|_, _, node| toggle_state_of(node)))
    }

    fn expand(&self) -> Outcome {
        if self.ask(|_, _, node| node.has(abi::EXPANDED))? {
            Ok(())
        } else {
            self.act(Action::Expand, "")
        }
    }

    fn collapse(&self) -> Outcome {
        if self.ask(|_, _, node| node.has(abi::EXPANDED))? {
            self.act(Action::Collapse, "")
        } else {
            Ok(())
        }
    }

    fn expansion(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|_, _, node| expansion_of(node)))
    }

    fn set_value(&self, value: Str) -> Outcome {
        if self.ask(|_, _, node| is_read_only(node))? {
            Err(Status(UIA_E_ELEMENTNOTENABLED))
        } else {
            self.act(Action::SetValue, &value.text())
        }
    }

    fn value(&self, it: Out<BasicString>) -> Outcome {
        it.answer(self.ask(|forest, id, node| BasicString::new(&value_of(forest, id, node))))
    }

    fn is_read_only(&self, it: Out<Bool>) -> Outcome {
        it.answer(self.ask(|_, _, node| is_read_only(node).into()))
    }

    fn set_number(&self, value: f64) -> Outcome {
        self.act(Action::SetValue, &value.to_string())
    }

    fn number(&self, it: Out<f64>, key: Number, times: f64) -> Outcome {
        it.answer(self.ask(|_, _, node| node.number(key).unwrap_or(0.) * times))
    }

    fn now(&self, it: Out<f64>) -> Outcome {
        self.number(it, Number::Now, 1.)
    }

    fn max(&self, it: Out<f64>) -> Outcome {
        self.number(it, Number::Max, 1.)
    }

    fn min(&self, it: Out<f64>) -> Outcome {
        self.number(it, Number::Min, 1.)
    }

    fn large_step(&self, it: Out<f64>) -> Outcome {
        self.number(it, Number::Step, 10.)
    }

    fn step(&self, it: Out<f64>) -> Outcome {
        self.number(it, Number::Step, 1.)
    }

    fn selected(&self, it: Out<Array>) -> Outcome {
        it.answer(
            self.ask(|forest, id, _| objects(forest, forest.members(id, properties::is_selected))),
        )
    }

    fn selects_many(&self, it: Out<Bool>) -> Outcome {
        self.has(it, abi::MULTISELECTABLE)
    }

    fn is_required(&self, it: Out<Bool>) -> Outcome {
        self.has(it, abi::REQUIRED)
    }

    fn select(&self) -> Outcome {
        match self.ask(|_, _, node| (properties::is_selected(node), node.has(abi::SELECTABLE)))? {
            (true, _) => Ok(()),
            (_, true) => self.act(Action::Select, ""),
            _ => self.act(Action::Click, ""),
        }
    }

    fn deselect(&self) -> Outcome {
        if self.ask(|_, _, node| node.has(abi::SELECTED))? {
            self.act(Action::Deselect, "")
        } else {
            Ok(())
        }
    }

    fn is_selected(&self, it: Out<Bool>) -> Outcome {
        it.answer(self.ask(|_, _, node| properties::is_selected(node).into()))
    }

    fn selection_container(&self, it: Found) -> Outcome {
        self.find(it, |forest, id| {
            forest.closest(id, |it| it.holds_selection() || it.role == Role::RadioGroup)
        })
    }

    fn scroll_into_view(&self) -> Outcome {
        self.act(Action::ScrollIntoView, "")
    }

    fn zero(&self, it: Out<i32>) -> Outcome {
        it.set(0)
    }

    fn is_modal(&self, it: Out<Bool>) -> Outcome {
        self.has(it, abi::MODAL)
    }

    fn is_ready(&self, it: Out<i32>) -> Outcome {
        it.set(WINDOW_INTERACTION_STATE_READY_FOR_USER_INTERACTION)
    }

    // ───────────────────────────── tables ─────────────────────────────

    fn cell_at(&self, row: i32, column: i32, it: Found) -> Outcome {
        self.find(it, |forest, id| {
            forest.grid(id).at(row as usize, column as usize)
        })
    }

    fn rows(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|forest, id, _| forest.grid(id).rows.len() as i32))
    }

    fn columns(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|forest, id, _| forest.grid(id).columns as i32))
    }

    fn row(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|forest, id, _| forest.cell(id).map_or(0, |it| it.rows.start as i32)))
    }

    fn column(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|forest, id, _| forest.cell(id).map_or(0, |it| it.columns.start as i32)))
    }

    fn row_span(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|forest, id, _| forest.cell(id).map_or(1, |it| it.rows.len() as i32)))
    }

    fn column_span(&self, it: Out<i32>) -> Outcome {
        it.answer(self.ask(|forest, id, _| forest.cell(id).map_or(1, |it| it.columns.len() as i32)))
    }

    fn table(&self, it: Found) -> Outcome {
        self.find(it, |forest, id| forest.closest(id, Node::is_table))
    }

    fn row_headers(&self, it: Out<Array>) -> Outcome {
        it.answer(self.ask(|forest, id, _| objects(forest, forest.headers(id, Role::RowHeader))))
    }

    fn column_headers(&self, it: Out<Array>) -> Outcome {
        it.answer(self.ask(|forest, id, _| objects(forest, forest.headers(id, Role::ColumnHeader))))
    }

    // ───────────────────────────── text ─────────────────────────────

    fn range(
        &self,
        ends: impl FnOnce(&Forest, Id) -> Option<[Position; 2]>,
    ) -> Outcome<Option<Unknown>> {
        self.ask(|forest, id, _| {
            Some(Range::create(
                forest,
                self.window,
                holder_of_text(forest, id)?,
                ends(forest, id)?,
            ))
        })
    }

    fn selection(forest: &Forest, id: Id) -> Option<[Position; 2]> {
        let tree = forest
            .real_focus(forest.place_of(id.tree)?.0)
            .filter(|it| forest.contains(id, *it))
            .unwrap_or(id)
            .tree;
        forest
            .selection(tree)
            .filter(|it| it.iter().all(|it| forest.contains(id, it.node)))
    }

    fn selected_text(&self, it: Out<Array>) -> Outcome {
        it.answer(
            self.range(|forest, id| Some(forest.ordered(Self::selection(forest, id)?)))
                .map(|it| Array::of_objects(it.as_slice())),
        )
    }

    fn visible_text(&self, it: Out<Array>) -> Outcome {
        let visible = self.range(|forest, id| {
            let mut shown = std::iter::once(id)
                .chain(forest.descendants(id))
                .filter(|it| forest.children(*it).next().is_none() && !forest.is_offscreen(*it));
            let first = shown.next()?;
            Some([
                forest.start_of(first),
                forest.end_of(shown.last().unwrap_or(first)),
            ])
        });
        it.answer(visible.map(|it| Array::of_objects(it.as_slice())))
    }

    fn text_of(&self, child: Borrowed, it: Found) -> Outcome {
        let child = child
            .get()
            .ok()
            .and_then(Object::<Element>::behind)
            .and_then(|it| it.id);
        it.answer(child.ok_or(Status::INVALID_ARGUMENT).and_then(|child| {
            self.range(|forest, _| Some([forest.start_of(child), forest.end_of(child)]))
        }))
    }

    fn text_at(&self, point: UiaPoint, it: Found) -> Outcome {
        it.answer(
            self.in_window(point.x, point.y)
                .and_then(|at| self.range(|forest, id| Some([forest.position_near(id, at)?; 2]))),
        )
    }

    fn all_text(&self, it: Found) -> Outcome {
        it.answer(self.range(|forest, id| Some([forest.start_of(id), forest.end_of(id)])))
    }

    fn kind_of_selection(&self, it: Out<i32>) -> Outcome {
        it.set(SUPPORTED_TEXT_SELECTION_SINGLE)
    }

    fn caret(&self, is_active: Out<Bool>, it: Found) -> Outcome {
        is_active.answer(self.ask(|forest, id, _| {
            forest
                .real_focus(self.window)
                .is_some_and(|it| forest.contains(id, it))
                .into()
        }))?;
        it.answer(self.range(|forest, id| {
            Some([Self::selection(forest, id).map_or_else(|| forest.start_of(id), |it| it[1]); 2])
        }))
    }

    fn text_container(&self, it: Found) -> Outcome {
        self.find(it, |forest, id| holder_of_text(forest, forest.parent(id)?))
    }

    fn text_in_container(&self, it: Found) -> Outcome {
        let range = |forest: &Forest, id| {
            Some(Range::create(
                forest,
                self.window,
                holder_of_text(forest, forest.parent(id)?)?,
                [forest.start_of(id), forest.end_of(id)],
            ))
        };
        it.answer(self.ask(|forest, id, _| range(forest, id)))
    }
}

/// Screen readers treat its elements as those of a web page.
const FRAMEWORK: &str = "Chrome";

/// Screen readers read the name of a live region when it changes.
fn name_of(forest: &Forest, id: Id, node: &Node) -> String {
    match node.name() {
        "" if node.is_live() && node.has(abi::LIVE_ATOMIC) => forest.field_text(id).text,
        "" if node.role == Role::ListItem => {
            let is_phrase = |it: &Id| {
                forest
                    .get(*it)
                    .is_some_and(|it| it.role != Role::ListMarker && !it.has(abi::BLOCK))
            };
            forest
                .children(id)
                .filter(is_phrase)
                .map(|it| forest.field_text(it).text)
                .collect()
        }
        name => name.to_owned(),
    }
}

fn value_of(forest: &Forest, id: Id, node: &Node) -> String {
    match node.has(abi::TEXT_FIELD) {
        true => forest.field_text(id).text,
        false if is_link(node) => node.text(Text::Url).unwrap_or_default().to_owned(),
        false => node
            .text(Text::Value)
            .or(node.text(Text::Url))
            .map(str::to_owned)
            .or_else(|| Some(node.number(Number::Now)?.to_string()))
            .unwrap_or_default(),
    }
}

fn is_read_only(node: &Node) -> bool {
    let can_be_set = node.has(abi::TEXT_FIELD)
        || matches!(
            node.role,
            Role::Combobox | Role::Scrollbar | Role::Separator | Role::Slider | Role::SpinButton
        );
    node.has(abi::READ_ONLY | abi::DISABLED) || !can_be_set
}

fn toggle_state_of(node: &Node) -> i32 {
    if node.has(abi::MIXED) {
        TOGGLE_STATE_INDETERMINATE
    } else {
        node.has(abi::CHECKED).into()
    }
}

fn expansion_of(node: &Node) -> i32 {
    match node.has(abi::EXPANDED) {
        true => EXPAND_COLLAPSE_STATE_EXPANDED,
        false if node.has(abi::COLLAPSED) || node.text(Text::HasPopup).is_some() => {
            EXPAND_COLLAPSE_STATE_COLLAPSED
        }
        false => EXPAND_COLLAPSE_STATE_LEAF_NODE,
    }
}
