//! https://w3c.github.io/core-aam/, and what Chromium makes of it.

use crate::abi::accessibility::{self as abi, Number, Role, Text};
use crate::accessibility::forest::Node;
use crate::accessibility::search::{is_landmark, is_link};
use crate::accessibility::{Forest, Id};
use crate::win32::*;

pub fn control_type(forest: &Forest, id: Id, node: &Node) -> i32 {
    use Role::*;
    match node.role {
        _ if is_link(node) => UIA_HYPERLINK_CONTROL_TYPE_ID,
        Abbreviation | Alert | Caption | Code | Emphasis | Figcaption | Heading | Label
        | Legend | LineBreak | ListMarker | Mark | StaticText | Strong | Subscript
        | Superscript | Time => UIA_TEXT_CONTROL_TYPE_ID,
        AlertDialog | Dialog => UIA_WINDOW_CONTROL_TYPE_ID,
        Application | EmbeddedObject | GraphicsObject | Iframe | TabPanel | Timer => {
            UIA_PANE_CONTROL_TYPE_ID
        }
        Button | ColorWell | DisclosureTriangle | Switch => UIA_BUTTON_CONTROL_TYPE_ID,
        Canvas | DocCover | GraphicsSymbol | Image => UIA_IMAGE_CONTROL_TYPE_ID,
        Row if forest.closest(id, |it| it.role == TreeGrid).is_some() => {
            UIA_TREE_ITEM_CONTROL_TYPE_ID
        }
        Cell | ColumnHeader | GridCell | Row | RowHeader => UIA_DATA_ITEM_CONTROL_TYPE_ID,
        Checkbox | MenuItemCheckbox => UIA_CHECK_BOX_CONTROL_TYPE_ID,
        Combobox => UIA_COMBO_BOX_CONTROL_TYPE_ID,
        Date | DateTime | Searchbox | Textbox => UIA_EDIT_CONTROL_TYPE_ID,
        DescriptionList | List | Listbox | MenuListPopup => UIA_LIST_CONTROL_TYPE_ID,
        DocBiblioEntry | DocEndnote | ListItem | Option | Term => UIA_LIST_ITEM_CONTROL_TYPE_ID,
        Separator if node.has(abi::FOCUSABLE) => UIA_THUMB_CONTROL_TYPE_ID,
        DocPageBreak | Separator => UIA_SEPARATOR_CONTROL_TYPE_ID,
        Document | GraphicsDocument | WebArea => UIA_DOCUMENT_CONTROL_TYPE_ID,
        Grid | TreeGrid => UIA_DATA_GRID_CONTROL_TYPE_ID,
        Menu => UIA_MENU_CONTROL_TYPE_ID,
        Menubar => UIA_MENU_BAR_CONTROL_TYPE_ID,
        MenuItem => UIA_MENU_ITEM_CONTROL_TYPE_ID,
        MenuItemRadio | Radio => UIA_RADIO_BUTTON_CONTROL_TYPE_ID,
        Meter | ProgressBar => UIA_PROGRESS_BAR_CONTROL_TYPE_ID,
        Scrollbar => UIA_SCROLL_BAR_CONTROL_TYPE_ID,
        Slider => UIA_SLIDER_CONTROL_TYPE_ID,
        SpinButton => UIA_SPINNER_CONTROL_TYPE_ID,
        Status => UIA_STATUS_BAR_CONTROL_TYPE_ID,
        Tab => UIA_TAB_ITEM_CONTROL_TYPE_ID,
        Table => UIA_TABLE_CONTROL_TYPE_ID,
        TabList => UIA_TAB_CONTROL_TYPE_ID,
        Toolbar => UIA_TOOL_BAR_CONTROL_TYPE_ID,
        Tooltip => UIA_TOOL_TIP_CONTROL_TYPE_ID,
        Tree => UIA_TREE_CONTROL_TYPE_ID,
        TreeItem => UIA_TREE_ITEM_CONTROL_TYPE_ID,
        _ => UIA_GROUP_CONTROL_TYPE_ID,
    }
}

/// If it says more than the control type, which the system has a name for.
pub fn type_name(node: &Node) -> Option<&str> {
    use Role::*;
    node.text(Text::RoleDescription).or(Some(match node.role {
        Button if node.has(abi::CHECKABLE) => "toggle button",
        Alert | Application | Article | Banner | Blockquote | Code | Comment | Complementary
        | Definition | Emphasis | Feed | Figure | Form | Heading | Log | Main | Marquee | Math
        | Meter | Navigation | Note | Region | Search | Status | Strong | Suggestion | Switch
        | Term | Time | Timer => node.role.name(),
        Audio => "audio",
        ColorWell => "color picker",
        ColumnHeader => "column header",
        ContentInfo => "content information",
        Date => "date picker",
        DateTime => "local date and time picker",
        InputTime => "time picker",
        Mark => "highlight",
        RowHeader => "row header",
        Searchbox => "search box",
        Video => "video",
        _ => return core::option::Option::None,
    }))
}

pub fn aria_role(node: &Node) -> &'static str {
    use Role::*;
    match node.role {
        Abbreviation | Figcaption | Label | Legend | LineBreak | StaticText => "description",
        Audio | Generic | InputTime | ListMarker | Ruby | Video => "group",
        Canvas | Image => "img",
        Cell => "gridcell",
        ColorWell | Date | DateTime => "textbox",
        DescriptionList => "list",
        DisclosureTriangle => "button",
        EmbeddedObject | Iframe | WebArea => "document",
        MenuListPopup => "listbox",
        Table => "grid",
        role => role.name(),
    }
}

pub fn landmark(node: &Node) -> Option<i32> {
    (is_landmark(node) && node.role != Role::Application).then_some(match node.role {
        Role::Form => UIA_FORM_LANDMARK_TYPE_ID,
        Role::Main => UIA_MAIN_LANDMARK_TYPE_ID,
        Role::Navigation => UIA_NAVIGATION_LANDMARK_TYPE_ID,
        Role::Search => UIA_SEARCH_LANDMARK_TYPE_ID,
        _ => UIA_CUSTOM_LANDMARK_TYPE_ID,
    })
}

/// Whether it is more than a holder of others, or a part of a name.
pub fn is_control(forest: &Forest, id: Id, node: &Node) -> bool {
    use Role::*;
    if node.is_text() {
        let speaks_for_it = |it: &Node| {
            it.has(abi::NAMED_BY_CONTENT)
                || matches!(it.role, Label | ListMarker)
                || it.has(abi::ATOMIC_FIELD)
        };
        return !matches!(node.role, LineBreak | ListMarker)
            && forest
                .closest(id, |it| !it.is_text() && speaks_for_it(it))
                .is_none();
    }
    let kind = control_type(forest, id, node);
    kind != UIA_GROUP_CONTROL_TYPE_ID
        && (kind != UIA_TEXT_CONTROL_TYPE_ID || matches!(node.role, Alert | Heading | Label | Time))
        || matches!(node.role, Article | Blockquote | Figure | RadioGroup)
        || is_landmark(node)
        || node.is_live()
        || node.has(abi::FOCUSABLE)
        || !node.name().is_empty()
        || node.text(Text::Description).is_some()
}

pub fn has_range(node: &Node) -> bool {
    node.number(Number::Now)
        .or(node.number(Number::Max))
        .is_some()
}

fn is_radio(node: &Node) -> bool {
    matches!(node.role, Role::Radio | Role::MenuItemRadio)
}

pub fn is_selectable(node: &Node) -> bool {
    node.has(abi::SELECTABLE) || is_radio(node) || node.role == Role::Tab
}

pub fn is_selected(node: &Node) -> bool {
    node.has(if is_radio(node) {
        abi::CHECKED
    } else {
        abi::SELECTED
    })
}

pub fn supports(forest: &Forest, id: Id, node: &Node, pattern: i32) -> bool {
    let toggles = node.has(abi::CHECKABLE) && !is_radio(node);
    let expands = node.has(abi::EXPANDED | abi::COLLAPSED)
        || node.role == Role::TreeItem
        || node.text(Text::HasPopup).is_some();
    let has_text = node.has(abi::TEXT_FIELD) || node.is_text() || node.role == Role::WebArea;
    match pattern {
        UIA_INVOKE_PATTERN_ID => {
            node.has(abi::CLICKABLE)
                && !toggles
                && !expands
                && !is_selectable(node)
                && !node.has(abi::TEXT_FIELD)
        }
        UIA_TOGGLE_PATTERN_ID => toggles,
        UIA_EXPAND_COLLAPSE_PATTERN_ID => expands,
        UIA_VALUE_PATTERN_ID => {
            node.has(abi::TEXT_FIELD)
                || node.text(Text::Value).or(node.text(Text::Url)).is_some()
                || has_range(node)
                || node.role == Role::Combobox
        }
        UIA_RANGE_VALUE_PATTERN_ID => has_range(node),
        UIA_SELECTION_PATTERN_ID => {
            node.holds_selection() && node.role != Role::Table || node.role == Role::RadioGroup
        }
        UIA_SELECTION_ITEM_PATTERN_ID => is_selectable(node),
        UIA_SCROLL_ITEM_PATTERN_ID => true,
        UIA_GRID_PATTERN_ID | UIA_TABLE_PATTERN_ID => node.is_table(),
        UIA_GRID_ITEM_PATTERN_ID | UIA_TABLE_ITEM_PATTERN_ID => {
            node.is_cell() && forest.closest(id, Node::is_table).is_some()
        }
        UIA_TEXT_PATTERN_ID | UIA_TEXT_PATTERN2_ID => has_text,
        UIA_TEXT_CHILD_PATTERN_ID => forest.parent(id).is_some(),
        UIA_WINDOW_PATTERN_ID => matches!(node.role, Role::Dialog | Role::AlertDialog),
        _ => false,
    }
}

/// `name=value;name=value;`
pub fn aria_properties(forest: &Forest, id: Id, node: &Node) -> String {
    let checked = if node.has(abi::MIXED) {
        "mixed"
    } else if node.has(abi::CHECKED) {
        "true"
    } else {
        "false"
    };
    let said = |states| if node.has(states) { "true" } else { "false" };
    let states = [
        (abi::LIVE_ATOMIC, "atomic", "true"),
        (abi::BUSY, "busy", "true"),
        (
            abi::CHECKABLE,
            if node.role == Role::Button {
                "pressed"
            } else {
                "checked"
            },
            checked,
        ),
        (abi::DISABLED, "disabled", "true"),
        (
            abi::EXPANDED | abi::COLLAPSED,
            "expanded",
            said(abi::EXPANDED),
        ),
        (abi::LIVE_POLITE, "live", "polite"),
        (abi::LIVE_ASSERTIVE, "live", "assertive"),
        (abi::LIVE_OFF, "live", "off"),
        (abi::TEXT_FIELD, "multiline", said(abi::MULTILINE)),
        (abi::MULTISELECTABLE, "multiselectable", "true"),
        (abi::READ_ONLY, "readonly", "true"),
        (abi::REQUIRED, "required", "true"),
        (abi::SELECTABLE, "selected", said(abi::SELECTED)),
    ];
    let texts = [
        (Text::BrailleLabel, "braillelabel"),
        (Text::BrailleRoleDescription, "brailleroledescription"),
        (Text::Current, "current"),
        (Text::HasPopup, "haspopup"),
        (Text::Invalid, "invalid"),
        (Text::Placeholder, "placeholder"),
        (Text::LiveRelevant, "relevant"),
        (Text::RoleDescription, "roledescription"),
        (Text::Sort, "sort"),
    ];
    let numbers = [
        (Number::Level, "level"),
        (Number::Max, "valuemax"),
        (Number::Min, "valuemin"),
        (Number::Now, "valuenow"),
    ];
    let mut all: Vec<_> = states
        .into_iter()
        .filter(|it| node.has(it.0))
        .map(|it| (it.1, it.2.to_owned()))
        .collect();
    all.extend(
        texts
            .into_iter()
            .filter_map(|it| Some((it.1, node.text(it.0)?.to_owned()))),
    );
    all.extend(
        numbers
            .into_iter()
            .filter_map(|it| Some((it.1, node.number(it.0)?.to_string()))),
    );
    all.extend(
        node.text(Text::Value)
            .filter(|_| has_range(node))
            .map(|it| ("valuetext", it.to_owned())),
    );
    if node.has(abi::CLICKABLE) && !node.has(abi::NAMED_BY_CONTENT) && !node.name().is_empty() {
        all.push(("label", node.name().to_owned()));
    }
    if let Some([position, size]) = forest.place_in_set(id).filter(|_| node.may_be_in_set()) {
        all.extend([
            ("posinset", position.to_string()),
            ("setsize", size.to_string()),
        ]);
    }
    let escaped = |it: &str| {
        it.chars()
            .flat_map(|it| [matches!(it, '\\' | ';' | '=').then_some('\\'), Some(it)])
            .flatten()
            .collect::<String>()
    };
    all.iter()
        .map(|it| format!("{}={};", it.0, escaped(&it.1)))
        .collect()
}

pub fn culture(forest: &Forest, id: Id) -> Option<i32> {
    let language = Wide::new(forest.inherited_text(id, Text::Language)?);
    Some(LocaleNameToLCID(language.str(), LOCALE_ALLOW_NEUTRAL_NAMES) as i32).filter(|it| *it != 0)
}
