//! What VoiceOver expects of a page, which is what browsers do.

mod notifications;
mod roles;
mod values;

use std::cell::RefCell;
use std::fmt::Write as _;
use std::ops::Range;

pub use notifications::{Notification, notifications};
pub use values::{is_settable, set, value, value_for};

use super::forest::{Forest, Id, Node};
use super::text::Position;
use super::{perform, read};
use crate::abi::Rect;
use crate::abi::accessibility::{self as abi, Action, Number, Role, Text};

/// What is in no document.
#[derive(Clone, Copy, PartialEq)]
enum Extra {
    ScrollArea(Id),
    Column(Id, u32),
    Header(Id),
}

const TREE_OF_EXTRAS: u32 = u32::MAX;

thread_local! {
    static EXTRAS: RefCell<Vec<Option<Extra>>> = RefCell::default();
}

impl Extra {
    fn id(self) -> Id {
        EXTRAS.with_borrow_mut(|all| {
            let index = all
                .iter()
                .position(|it| *it == Some(self))
                .unwrap_or_else(|| {
                    all.push(Some(self));
                    all.len() - 1
                });
            Id {
                tree: TREE_OF_EXTRAS,
                node: index as u32,
            }
        })
    }

    fn of(id: Id) -> Option<Extra> {
        (id.tree == TREE_OF_EXTRAS)
            .then(|| EXTRAS.with_borrow(|all| *all.get(id.node as usize)?))
            .flatten()
    }

    fn owner(self) -> Id {
        match self {
            Extra::ScrollArea(it) | Extra::Column(it, _) | Extra::Header(it) => it,
        }
    }

    fn remove_orphans(forest: &Forest) -> Vec<Id> {
        EXTRAS.with_borrow_mut(|all| {
            let orphans = (0..)
                .zip(all)
                .filter(|it| it.1.is_some_and(|it| forest.get(it.owner()).is_none()));
            orphans
                .filter_map(|(node, it)| {
                    it.take().map(|_| Id {
                        tree: TREE_OF_EXTRAS,
                        node,
                    })
                })
                .collect()
        })
    }
}

pub enum Value {
    Bool(bool),
    Number(f64),
    Text(String),
    Url(String),
    /// A phrase in English, and after a `|` what to look its translation up by. Without one, what the system calls the role and the subrole.
    RoleDescription(Option<&'static str>, &'static str, Option<&'static str>),
    /// `0xRRGGBBAA`
    Color(u32),
    Element(Id),
    View(u32),
    Window(u32),
    List(Vec<Value>),
    Dictionary(Vec<(&'static str, Value)>),
    /// In a window.
    Rect(u32, Rect),
    Position(u32, Rect),
    Size(Rect),
    Range(Range<usize>),
    Marker(Position),
    MarkerRange([Position; 2]),
    /// The ranges count UTF-16 code units.
    Attributed(String, Vec<(Range<usize>, &'static str, Value)>),
}

pub enum Parameter {
    Number(f64),
    Numbers(Vec<f64>),
    Range(Range<usize>),
    /// In the window.
    Point([f32; 2]),
    Rect(Rect),
    Text(String),
    Element(Id),
    Marker(Position),
    Markers([Position; 2]),
    Replacement(Range<usize>, String),
    Search {
        keys: String,
        start: Option<Id>,
        is_backwards: bool,
        limit: usize,
        text: String,
        only_visible: bool,
        only_children: bool,
    },
}

fn elements(ids: impl IntoIterator<Item = Id>) -> Value {
    Value::List(ids.into_iter().map(Value::Element).collect())
}

pub fn window_of(forest: &Forest, id: Id) -> Option<u32> {
    Some(
        forest
            .place_of(Extra::of(id).map_or(id, Extra::owner).tree)?
            .0,
    )
}

pub fn roots(forest: &Forest, window: u32) -> Value {
    elements(
        forest
            .roots(window)
            .into_iter()
            .map(|it| Extra::ScrollArea(it).id()),
    )
}

pub fn focus(forest: &Forest, window: u32) -> Option<Value> {
    Some(Value::Element(forest.exposed(forest.focus(window)?)))
}

pub fn hit(forest: &Forest, within: Option<Id>, window: u32, point: [f32; 2]) -> Option<Value> {
    let found = match within {
        Some(within) => forest.hit(Extra::of(within).map_or(within, Extra::owner), point),
        None => forest.hit_in_window(window, point),
    };
    Some(Value::Element(forest.exposed(found?)))
}

/// What is read out after the rest.
pub fn custom_description(forest: &Forest, id: Id) -> Option<Value> {
    Some(Value::Text(
        forest
            .get(id)
            .filter(|it| it.has(abi::DESCRIBED_BY_ARIA))?
            .text(Text::Description)?
            .to_owned(),
    ))
}

fn has_range(node: &Node) -> bool {
    node.number(Number::Now)
        .or(node.number(Number::Max))
        .is_some()
        || node.role == Role::SpinButton
}

/// VoiceOver takes it for granted of a combo box.
fn has_characters(node: &Node) -> bool {
    node.has(abi::TEXT_FIELD)
        || node.is_text()
        || node.role == Role::Combobox && !node.has(abi::MENU_LIST)
}

fn is_row(node: &Node) -> bool {
    matches!(node.role, Role::Row | Role::TreeItem)
}

fn is_menu_item(node: &Node) -> bool {
    matches!(
        node.role,
        Role::MenuItem | Role::MenuItemCheckbox | Role::MenuItemRadio
    )
}

/// In the order of the children.
fn parts_in_math(tag: &str) -> &'static str {
    match tag {
        "mfrac" => "AXMathFractionNumerator AXMathFractionDenominator",
        "mmultiscripts" => "AXMathBase AXMathPostscripts AXMathPrescripts",
        "mover" => "AXMathBase AXMathOver",
        "mroot" => "AXMathRootRadicand AXMathRootIndex",
        "msqrt" => "AXMathRootRadicand",
        "msub" => "AXMathBase AXMathSubscript",
        "msubsup" => "AXMathBase AXMathSubscript AXMathSuperscript",
        "msup" => "AXMathBase AXMathSuperscript",
        "munder" => "AXMathBase AXMathUnder",
        "munderover" => "AXMathBase AXMathUnder AXMathOver",
        _ => "",
    }
}

pub fn attribute_names(forest: &Forest, id: Id) -> Vec<&'static str> {
    const PLACE: &str = "AXChildren AXEnabled AXFocused AXParent AXPosition AXRole AXRoleDescription AXSize AXTopLevelUIElement AXWindow";
    let mut names: Vec<_> = PLACE.split(' ').collect();
    let mut add = |is_due: bool, more: &'static str| {
        names.extend(more.split_ascii_whitespace().filter(|_| is_due))
    };
    let extra = Extra::of(id);
    add(matches!(extra, Some(Extra::ScrollArea(_))), "AXContents");
    add(
        matches!(extra, Some(Extra::Column(..))),
        "AXHeader AXIndex AXRows AXVisibleRows",
    );
    add(matches!(extra, Some(Extra::Header(_))), "AXSubrole");
    let Some(node) = forest.get(id) else {
        return names;
    };
    let has_text = |key| node.text(key).is_some();
    add(
        true,
        "AXBlockQuoteLevel AXDescription AXDOMClassList AXDOMIdentifier AXElementBusy AXEndTextMarker AXFocusableAncestor AXHelp AXInvalid \
         AXLinkedUIElements AXSelected AXSelectedTextMarkerRange AXStartTextMarker AXSubrole AXTitle AXValue AXVisited",
    );
    add(node.role == Role::WebArea, "AXLoaded AXLoadingProgress");
    add(
        has_characters(node),
        "AXInsertionPointLineNumber AXNumberOfCharacters AXSelectedText AXSelectedTextRange AXSelectedTextRanges AXVisibleCharacterRange",
    );
    add(
        node.has(abi::EDITABLE),
        "AXEditableAncestor AXHighestEditableAncestor",
    );
    add(
        node.has(abi::TEXT_FIELD) || node.role == Role::Combobox,
        "AXOwns",
    );
    add(
        node.is_table(),
        "AXColumnCount AXColumnHeaderUIElements AXColumns AXHeader AXRowCount AXRowHeaderUIElements AXVisibleCells AXVisibleColumns AXARIAColumnCount AXARIARowCount",
    );
    add(
        node.is_table() || node.role == Role::Tree,
        "AXRows AXSelectedRows AXVisibleRows",
    );
    add(
        matches!(node.role, Role::Grid | Role::TreeGrid),
        "AXSelectedCells",
    );
    add(
        node.is_cell(),
        "AXColumnHeaderUIElements AXColumnIndexRange AXRowHeaderUIElements AXRowIndexRange AXSortDirection",
    );
    add(
        has_text(Text::ColumnIndex),
        "AXARIAColumnIndex AXColumnIndexDescription",
    );
    add(
        has_text(Text::RowIndex),
        "AXARIARowIndex AXRowIndexDescription",
    );
    add(
        is_row(node),
        "AXIndex AXDisclosing AXDisclosedByRow AXDisclosureLevel AXDisclosedRows",
    );
    add(node.role == Role::TabList, "AXTabs AXContents");
    add(
        matches!(
            node.role,
            Role::List
                | Role::DescriptionList
                | Role::Listbox
                | Role::Menu
                | Role::Menubar
                | Role::Combobox
                | Role::MenuListPopup
        ),
        "AXSelectedChildren AXVisibleChildren",
    );
    add(
        is_menu_item(node) || node.role == Role::Option,
        "AXMenuItemMarkChar",
    );
    add(
        has_range(node) && (node.role != Role::ProgressBar || node.number(Number::Now).is_some()),
        "AXMaxValue AXMinValue",
    );
    add(has_range(node), "AXValueDescription");
    add(node.has(abi::HORIZONTAL | abi::VERTICAL), "AXOrientation");
    add(node.has(abi::EXPANDED | abi::COLLAPSED), "AXExpanded");
    add(
        node.has(abi::REQUIRED | abi::TEXT_FIELD)
            || matches!(
                node.role,
                Role::Checkbox | Role::Combobox | Role::Listbox | Role::RadioGroup
            ),
        "AXRequired",
    );
    add(node.has(abi::MULTISELECTABLE), "AXIsMultiSelectable");
    add(
        matches!(node.role, Role::Dialog | Role::AlertDialog),
        "AXModal",
    );
    add(
        node.is_live() || node.has(abi::LIVE_OFF),
        "AXARIAAtomic AXARIALive AXARIARelevant",
    );
    // VoiceOver counts by itself unless these are named, and then drops the place of the last one.
    add(
        node.number(Number::PositionInSet).is_some(),
        "AXARIAPosInSet",
    );
    add(node.number(Number::SetSize).is_some(), "AXARIASetSize");
    add(has_text(Text::Url), "AXURL");
    add(
        has_text(Text::Placeholder) || node.has(abi::TEXT_FIELD),
        "AXPlaceholderValue",
    );
    add(node.has(abi::TEXT_FIELD), "AXValueAutofillAvailable");
    add(node.role == Role::Heading, "AXDisclosureLevel");
    add(has_text(Text::Current), "AXARIACurrent");
    add(has_text(Text::HasPopup), "AXHasPopup AXPopupValue");
    add(has_text(Text::Autocomplete), "AXAutocompleteValue");
    add(has_text(Text::AccessKey), "AXAccessKey");
    add(has_text(Text::KeyShortcuts), "AXKeyShortcutsValue");
    add(has_text(Text::BrailleLabel), "AXBrailleLabel");
    add(
        has_text(Text::BrailleRoleDescription),
        "AXBrailleRoleDescription",
    );
    add(
        forest.inherited_text(id, Text::Language).is_some(),
        "AXLanguage",
    );
    add(
        true,
        parts_in_math(forest.math_tag(id, node).unwrap_or_default()),
    );
    let relations = [
        (abi::Relation::Details, "AXDetailsElements"),
        (abi::Relation::ErrorMessage, "AXErrorMessageElements"),
        (abi::Relation::Controls, "AXARIAControls"),
    ];
    relations
        .into_iter()
        .for_each(|it| add(forest.related(id, it.0).next().is_some(), it.1));
    names
}

pub fn parameterized_names(forest: &Forest, id: Id) -> Vec<&'static str> {
    let Some(node) = forest.get(id) else {
        return Vec::new();
    };
    let mut names: Vec<_> = values::WITH_MARKERS.split_ascii_whitespace().collect();
    names.extend(
        values::WITH_RANGES
            .split_ascii_whitespace()
            .filter(|_| has_characters(node)),
    );
    names.extend(node.is_table().then_some("AXCellForColumnAndRow"));
    names.extend(
        node.has(abi::TEXT_FIELD)
            .then_some("AXReplaceRangeWithText"),
    );
    names
}

pub fn action_names(forest: &Forest, id: Id) -> Vec<&'static str> {
    let Some(node) = forest.get(id) else {
        return Vec::new();
    };
    let is_adjustable = matches!(node.role, Role::Slider | Role::SpinButton)
        || node.role == Role::Separator && node.has(abi::FOCUSABLE);
    let actions = [
        (node.has(abi::CLICKABLE | abi::TEXT_FIELD), "AXPress"),
        (is_adjustable, "AXIncrement"),
        (is_adjustable, "AXDecrement"),
        (
            is_menu_item(node)
                || matches!(node.role, Role::Menu | Role::Menubar | Role::MenuListPopup),
            "AXCancel",
        ),
        (true, "AXShowMenu"),
        (true, "AXScrollToVisible"),
    ];
    let is_possible =
        |it: &(bool, &str)| it.0 && (!node.has(abi::DISABLED) || it.1.starts_with("AXS"));
    actions
        .into_iter()
        .filter(is_possible)
        .map(|it| it.1)
        .collect()
}

pub fn act(id: Id, name: &str) {
    let has_popup = || {
        read(|it| {
            it.get(id)
                .is_some_and(|it| it.text(Text::HasPopup).is_some() && !it.has(abi::TEXT_FIELD))
        })
    };
    let action = match name {
        _ if !read(|it| action_names(it, id).contains(&name)) => return,
        "AXPress" => Action::Click,
        "AXIncrement" => Action::Increment,
        "AXDecrement" => Action::Decrement,
        "AXCancel" => Action::Cancel,
        "AXShowMenu" if has_popup() => Action::Click,
        "AXShowMenu" => Action::ShowContextMenu,
        _ => Action::ScrollIntoView,
    };
    perform(id, action, [0; 4], "");
}

// ───────────────────────────── for tests ─────────────────────────────

fn label(forest: &Forest, id: Id) -> String {
    let dom_id = forest.get(id).and_then(|it| it.text(Text::DomId));
    let role = || {
        value(forest, id, "AXRole")
            .map_or("gone".to_owned(), |it| it.describe(forest).replace('"', ""))
    };
    dom_id.map_or_else(role, |it| format!("#{it}"))
}

impl Value {
    fn describe(&self, forest: &Forest) -> String {
        let marker = |it: &Position| match forest.get(it.node).filter(|it| it.is_text()) {
            Some(node) => format!("{:?}@{}", node.name(), it.offset),
            None => format!("{}@{}", label(forest, it.node), it.offset),
        };
        let join = |all: Vec<String>| all.join(", ");
        match self {
            Value::Bool(it) => it.to_string(),
            Value::Number(it) => it.to_string(),
            Value::Text(it) | Value::Url(it) => format!("{it:?}"),
            Value::RoleDescription(Some(it), ..) => {
                format!("{:?}", it.split('|').next().unwrap_or(it))
            }
            Value::RoleDescription(None, ..) => "system".to_owned(),
            Value::Color(it) => format!("#{it:08x}"),
            Value::Element(it) => label(forest, *it),
            Value::View(_) => "view".to_owned(),
            Value::Window(_) => "window".to_owned(),
            Value::List(it) => format!(
                "[{}]",
                join(it.iter().map(|it| it.describe(forest)).collect())
            ),
            Value::Dictionary(it) => format!(
                "{{{}}}",
                join(
                    it.iter()
                        .map(|it| format!("{}: {}", it.0, it.1.describe(forest)))
                        .collect()
                )
            ),
            Value::Rect(_, it) => format!("{} {} {} {}", it.x, it.y, it.width, it.height),
            Value::Position(_, it) => format!("{} {}", it.x, it.y),
            Value::Size(it) => format!("{} {}", it.width, it.height),
            Value::Range(it) => format!("{it:?}"),
            Value::Marker(it) => marker(it),
            Value::MarkerRange([start, end]) => format!("{}..{}", marker(start), marker(end)),
            Value::Attributed(text, all) => format!(
                "{text:?} {}",
                join(
                    all.iter()
                        .map(|it| format!("{:?} {} {}", it.0, it.1, it.2.describe(forest)))
                        .collect()
                )
            ),
        }
    }

    fn into_parameter(self) -> Option<Parameter> {
        Some(match self {
            Value::Number(it) => Parameter::Number(it),
            Value::Range(it) => Parameter::Range(it),
            Value::Element(it) => Parameter::Element(it),
            Value::Marker(it) => Parameter::Marker(it),
            Value::MarkerRange(it) => Parameter::Markers(it),
            _ => return None,
        })
    }
}

impl Notification {
    pub fn describe(&self, forest: &Forest) -> String {
        let info = self
            .info
            .as_ref()
            .map_or(String::new(), |it| format!(" {}", it.describe(forest)));
        format!("{} {}{info}", self.name, self.target.describe(forest))
    }
}

fn dump(forest: &Forest, id: Id, depth: usize, is_complete: bool, out: &mut String) {
    const SHOWN: &str = "AXRole AXSubrole AXTitle AXDescription AXValue AXHelp AXPlaceholderValue AXFocused AXSelected AXExpanded AXRequired AXElementBusy";
    let names = attribute_names(forest, id);
    out.push_str(&"  ".repeat(depth));
    let some = SHOWN.split(' ').filter(|it| names.contains(it)).collect();
    for name in if is_complete { names } else { some } {
        match value(forest, id, name)
            .map(|it| it.describe(forest))
            .filter(|it| it != "\"\"" && (it != "false" || name == "AXExpanded"))
        {
            Some(it) if name.ends_with("ole") => _ = write!(out, "{} ", it.replace('"', "")),
            Some(it) => _ = write!(out, "{name}={it} "),
            None => {}
        }
    }
    out.truncate(out.trim_end().len());
    out.push('\n');
    if let Some(Value::List(children)) = value(forest, id, "AXChildren") {
        for child in children {
            if let Value::Element(child) = child {
                dump(forest, child, depth + 1, is_complete, out);
            }
        }
    }
}

/// `#id`, `focus`, or `root`, and after a `>` the index of a child.
fn find(forest: &Forest, name: &str) -> Option<Id> {
    if let Some((parent, index)) = name.rsplit_once('>') {
        return forest
            .children(find(forest, parent)?)
            .nth(index.parse().ok()?);
    }
    let roots = || forest.windows().flat_map(|it| forest.roots(it));
    match name.strip_prefix('#') {
        Some(wanted) => roots().flat_map(|it| forest.descendants(it)).find(|it| {
            forest
                .get(*it)
                .is_some_and(|it| it.text(Text::DomId) == Some(wanted))
        }),
        None if name == "focus" => forest.windows().find_map(|it| forest.focus(it)),
        None => roots().next(),
    }
}

/// `1`, `1..2`, `1,2`, `@1,2`, `"text"`, `#id`, or `?keys start direction`.
fn parse(forest: &Forest, text: &str) -> Option<Parameter> {
    let numbers = |text: &str| {
        text.split(',')
            .map(|it| it.parse().ok())
            .collect::<Option<Vec<f64>>>()
    };
    Some(match text.split_at_checked(1)? {
        ("\"", rest) => Parameter::Text(rest.strip_suffix('"')?.to_owned()),
        ("#", _) => Parameter::Element(find(forest, text)?),
        ("@", rest) => Parameter::Point(numbers(rest)?.first_chunk()?.map(|it| it as f32)),
        ("?", rest) => {
            let mut words = rest.split(' ');
            let (keys, start) = (
                words.next()?.replace(',', " "),
                words.next().and_then(|it| find(forest, it)),
            );
            let is_backwards = words.next() == Some("back");
            Parameter::Search {
                keys,
                start,
                is_backwards,
                limit: usize::MAX,
                text: String::new(),
                only_visible: false,
                only_children: false,
            }
        }
        _ => match text.split_once("..") {
            Some((start, end)) => Parameter::Range(start.parse().ok()?..end.parse().ok()?),
            None if text.contains(',') => Parameter::Numbers(numbers(text)?),
            None => Parameter::Number(text.parse().ok()?),
        },
    })
}

/// `name`, `name parameter`, or several of them with ` | ` between them, each of which gets the result of the one before.
fn evaluate(forest: &Forest, id: Id, expression: &str) -> Option<Value> {
    let mut steps = expression.split(" | ");
    let first = match steps.next()?.split_once(' ') {
        Some((name, parameter)) => value_for(forest, id, name, parse(forest, parameter)?),
        None => value(forest, id, expression.split(' ').next()?),
    };
    steps.try_fold(first?, |last, name| match last {
        Value::Element(element) if attribute_names(forest, element).contains(&name) => {
            value(forest, element, name)
        }
        last => value_for(forest, id, name, last.into_parameter()?),
    })
}

/// `tree element`, `names element`, `get element expression`, `set element name (parameter | = expression)`, `do element action`, `hit element x,y`
pub fn inspect(verb: &str, rest: &str) -> Option<String> {
    let (element, rest) = rest.split_once(' ').unwrap_or((rest, ""));
    let id = read(|it| find(it, element))?;
    match verb {
        "tree" | "everything" => read(|forest| {
            let mut out = String::new();
            dump(forest, id, 0, verb == "everything", &mut out);
            Some(out)
        }),
        "names" => read(|forest| {
            Some(
                [attribute_names(forest, id), action_names(forest, id)]
                    .concat()
                    .join(" "),
            )
        }),
        "get" => read(|forest| {
            Some(evaluate(forest, id, rest).map_or("nil".to_owned(), |it| it.describe(forest)))
        }),
        "set" => {
            let (name, to) = rest.split_once(' ')?;
            let to = read(|forest| {
                to.strip_prefix("= ").map_or_else(
                    || parse(forest, to),
                    |it| evaluate(forest, id, it)?.into_parameter(),
                )
            })?;
            Some(set(id, name, to).to_string())
        }
        "hit" => read(|forest| {
            let Parameter::Point(point) = parse(forest, &format!("@{rest}"))? else {
                return None;
            };
            Some(hit(forest, Some(id), window_of(forest, id)?, point)?.describe(forest))
        }),
        "do" => {
            act(id, rest);
            Some(String::new())
        }
        _ => None,
    }
}
