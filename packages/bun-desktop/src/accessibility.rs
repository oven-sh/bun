//! The trees of a window's surfaces, as one tree for AccessKit.

use std::cell::Cell;

use gpui::accesskit::{
    self, Action, ActionData, ActionRequest, Live, NodeId, Role, Toggled, TreeId, TreeUpdate,
};
use rustc_hash::FxHashMap;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::surface::{self, Surface};
use crate::window::{self, WindowState};
use crate::{bridge, host};

#[derive(Default, Deserialize)]
#[serde(default)]
struct Node {
    id: u32,
    role: String,
    label: Option<String>,
    value: Option<String>,
    description: Option<String>,
    placeholder: Option<String>,
    bounds: [f64; 4],
    children: Vec<u32>,
    checked: Option<Value>,
    pressed: Option<Value>,
    expanded: Option<bool>,
    selected: Option<bool>,
    disabled: bool,
    readonly: bool,
    required: bool,
    focusable: bool,
    clickable: bool,
    modal: bool,
    level: Option<usize>,
    min: Option<f64>,
    max: Option<f64>,
    now: Option<f64>,
    live: Option<String>,
    url: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct Tree {
    /// The first one is the root.
    nodes: Vec<Node>,
    focus: Option<u32>,
}

fn role(name: &str) -> Role {
    match name {
        "alert" => Role::Alert,
        "alertdialog" => Role::AlertDialog,
        "article" => Role::Article,
        "banner" => Role::Banner,
        "blockquote" => Role::Blockquote,
        "button" => Role::Button,
        "cell" => Role::Cell,
        "checkbox" => Role::CheckBox,
        "code" => Role::Code,
        "columnheader" => Role::ColumnHeader,
        "combobox" => Role::ComboBox,
        "complementary" => Role::Complementary,
        "contentinfo" => Role::ContentInfo,
        "dialog" => Role::Dialog,
        "document" => Role::Document,
        "feed" => Role::Feed,
        "form" => Role::Form,
        "grid" => Role::Grid,
        "gridcell" => Role::GridCell,
        "group" => Role::Group,
        "heading" => Role::Heading,
        "img" | "image" => Role::Image,
        "link" => Role::Link,
        "list" => Role::List,
        "listbox" => Role::ListBox,
        "listitem" => Role::ListItem,
        "log" => Role::Log,
        "main" => Role::Main,
        "menu" => Role::Menu,
        "menubar" => Role::MenuBar,
        "menuitem" => Role::MenuItem,
        "menuitemcheckbox" => Role::MenuItemCheckBox,
        "menuitemradio" => Role::MenuItemRadio,
        "meter" => Role::Meter,
        "navigation" => Role::Navigation,
        "note" => Role::Note,
        "option" => Role::ListBoxOption,
        "paragraph" => Role::Paragraph,
        "progressbar" => Role::ProgressIndicator,
        "radio" => Role::RadioButton,
        "radiogroup" => Role::RadioGroup,
        "region" => Role::Region,
        "row" => Role::Row,
        "rowheader" => Role::RowHeader,
        "search" => Role::Search,
        "separator" => Role::Splitter,
        "slider" => Role::Slider,
        "spinbutton" => Role::SpinButton,
        "status" => Role::Status,
        "switch" => Role::Switch,
        "tab" => Role::Tab,
        "table" => Role::Table,
        "tablist" => Role::TabList,
        "tabpanel" => Role::TabPanel,
        "timer" => Role::Timer,
        "toolbar" => Role::Toolbar,
        "tooltip" => Role::Tooltip,
        "tree" => Role::Tree,
        "treeitem" => Role::TreeItem,
        "application" => Role::Application,
        "caption" => Role::Caption,
        "definition" => Role::Definition,
        "emphasis" => Role::Emphasis,
        "figure" => Role::Figure,
        "mark" => Role::Mark,
        "math" => Role::Math,
        "multilineTextbox" => Role::MultilineTextInput,
        "passwordbox" => Role::PasswordInput,
        "rowgroup" => Role::RowGroup,
        "scrollbar" => Role::ScrollBar,
        "searchbox" => Role::SearchInput,
        "strong" => Role::Strong,
        "term" => Role::Term,
        "text" => Role::Label,
        "textbox" => Role::TextInput,
        "treegrid" => Role::TreeGrid,
        _ => Role::GenericContainer,
    }
}

const ACTIONS: [(Action, &str); 9] = [
    (Action::Click, "click"),
    (Action::Focus, "focus"),
    (Action::Blur, "blur"),
    (Action::SetValue, "setValue"),
    (Action::Increment, "increment"),
    (Action::Decrement, "decrement"),
    (Action::Expand, "expand"),
    (Action::Collapse, "collapse"),
    (Action::ScrollIntoView, "scrollIntoView"),
];

fn convert(from: &Node, surface: &Surface) -> accesskit::Node {
    let mut node = accesskit::Node::new(role(&from.role));
    let ([x, y, width, height], scale) = (from.bounds, f64::from(surface.scale));
    let (x, y) = (x + f64::from(surface.rect.x), y + f64::from(surface.rect.y));
    node.set_bounds(accesskit::Rect::new(
        x * scale,
        y * scale,
        (x + width) * scale,
        (y + height) * scale,
    ));
    macro_rules! set {
        ($($field:ident => $setter:ident),*) => {
            $(if let Some(value) = from.$field.clone() { node.$setter(value); })*
        };
    }
    macro_rules! flag {
        ($($field:ident => $setter:ident),*) => {
            $(if from.$field { node.$setter(); })*
        };
    }
    set!(label => set_label, value => set_value, description => set_description, placeholder => set_placeholder);
    set!(url => set_url, expanded => set_expanded, selected => set_selected, level => set_level);
    set!(min => set_min_numeric_value, max => set_max_numeric_value, now => set_numeric_value);
    flag!(disabled => set_disabled, readonly => set_read_only, required => set_required, modal => set_modal);
    if let Some(toggled) = from.checked.as_ref().or(from.pressed.as_ref()) {
        node.set_toggled(if toggled == "mixed" {
            Toggled::Mixed
        } else {
            (toggled == true).into()
        });
    }
    match from.live.as_deref() {
        Some("polite") => node.set_live(Live::Polite),
        Some("assertive") => node.set_live(Live::Assertive),
        _ => {}
    }
    let is_text = matches!(
        node.role(),
        Role::TextInput | Role::MultilineTextInput | Role::PasswordInput | Role::SearchInput
    );
    let is_adjustable = matches!(node.role(), Role::Slider | Role::SpinButton);
    for (action, _) in ACTIONS {
        let is_supported = match action {
            Action::ScrollIntoView => true,
            _ if from.disabled => false,
            Action::Click => from.clickable,
            Action::Focus | Action::Blur => from.focusable,
            Action::SetValue => (is_text || is_adjustable) && !from.readonly,
            Action::Expand => from.expanded == Some(false),
            Action::Collapse => from.expanded == Some(true),
            _ => is_adjustable,
        };
        if is_supported {
            node.add_action(action);
        }
    }
    node.add_action(Action::ShowContextMenu);
    node
}

fn node_id(surface: u32, node: u32) -> NodeId {
    NodeId(u64::from(surface) << 32 | u64::from(node))
}

/// AccessKit panics unless the nodes are a tree.
fn tree_update(state: &WindowState) -> TreeUpdate {
    let (mut root, mut nodes, mut focus) =
        (accesskit::Node::new(Role::Window), Vec::new(), NodeId(0));
    root.set_label(state.options.borrow().title.clone());
    for surface in surface::in_window(state) {
        let surface = surface.borrow();
        let tree = &surface.accessibility;
        let Some(first) = tree.nodes.first().filter(|_| surface.is_visible) else {
            continue;
        };
        let mut unplaced: FxHashMap<_, _> = tree.nodes.iter().map(|node| (node.id, node)).collect();
        unplaced.remove(&first.id);
        root.push_child(node_id(surface.id, first.id));
        let mut pending = vec![first];
        while let Some(from) = pending.pop() {
            let mut node = convert(from, &surface);
            for child in from
                .children
                .iter()
                .filter_map(|child| unplaced.remove(child))
            {
                node.push_child(node_id(surface.id, child.id));
                pending.push(child);
            }
            if state.focused_surface.get() == Some(surface.id) && tree.focus == Some(from.id) {
                focus = node_id(surface.id, from.id);
            }
            nodes.push((node_id(surface.id, from.id), node));
        }
    }
    nodes.push((NodeId(0), root));
    TreeUpdate {
        nodes,
        tree: Some(accesskit::TreeInfo::new(NodeId(0))),
        tree_id: TreeId::ROOT,
        focus,
    }
}

pub fn update(state: &WindowState) {
    if let Some(handle) = window::handle(state.id).filter(|_| state.is_accessible.get()) {
        host::update_window(handle.into(), |window, _| {
            window.send_a11y_update(tree_update(state))
        })
        .ok();
    }
}

/// While the window is drawn.
pub fn observe(state: &WindowState, window: &gpui::Window) {
    thread_local! {
        static IS_ACTIVE: Cell<bool> = const { Cell::new(false) };
    }
    let is_active = window.is_a11y_active();
    #[cfg(target_os = "macos")]
    let is_active = is_active && crate::native::has_assistive_technology();
    if state.is_accessible.replace(is_active) == is_active {
        return;
    }
    if is_active {
        window.send_a11y_update(tree_update(state));
    }
    let states = window::ids()
        .into_iter()
        .filter_map(|id| window::state(id).ok());
    let is_active = is_active || states.into_iter().any(|state| state.is_accessible.get());
    if IS_ACTIVE.replace(is_active) != is_active {
        bridge::emit(json!({ "t": "a11y", "active": is_active }));
    }
}

pub fn perform(request: &ActionRequest) {
    let action = match request.action {
        Action::ShowContextMenu => "showContextMenu",
        action => match ACTIONS.iter().find(|(known, _)| *known == action) {
            Some((_, name)) => name,
            None => return,
        },
    };
    let data = match &request.data {
        Some(ActionData::Value(text)) => json!(text),
        Some(ActionData::NumericValue(number)) => json!(number),
        _ => Value::Null,
    };
    let (surface, node) = (request.target_node.0 >> 32, request.target_node.0 as u32);
    bridge::emit(
        json!({ "t": "a11yAction", "s": surface, "node": node, "action": action, "data": data }),
    );
}
