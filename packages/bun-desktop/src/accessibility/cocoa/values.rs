use std::ops::Range;

use super::{
    Extra, Parameter, Value, attribute_names, elements, has_range, is_row, parts_in_math, roles,
    window_of,
};
use crate::abi::Rect;
use crate::abi::accessibility::{self as abi, Action, Number, Relation, Role, Text};
use crate::accessibility::forest::{Forest, Id, Node};
use crate::accessibility::search::{Search, is_link};
use crate::accessibility::text::{Block, Position, Unit, from_utf16, to_utf16};
use crate::accessibility::{perform, read};

pub const WITH_RANGES: &str = "AXAttributedStringForRange AXBoundsForRange AXLineForIndex AXRangeForIndex AXRangeForLine AXRangeForPosition
    AXStringForRange AXStyleRangeForIndex";

pub const WITH_MARKERS: &str = "AXAttributedStringForTextMarkerRange AXAttributedStringForTextMarkerRangeWithOptions AXBoundsForTextMarkerRange
    AXEndTextMarkerForBounds AXEndTextMarkerForTextMarkerRange AXIndexForChildUIElement AXIndexForTextMarker AXLeftLineTextMarkerRangeForTextMarker
    AXLeftWordTextMarkerRangeForTextMarker AXLengthForTextMarkerRange AXLineForTextMarker AXLineTextMarkerRangeForTextMarker
    AXNextLineEndTextMarkerForTextMarker AXNextParagraphEndTextMarkerForTextMarker AXNextSentenceEndTextMarkerForTextMarker
    AXNextTextMarkerForTextMarker AXNextWordEndTextMarkerForTextMarker AXParagraphTextMarkerRangeForTextMarker
    AXPreviousLineStartTextMarkerForTextMarker AXPreviousParagraphStartTextMarkerForTextMarker AXPreviousSentenceStartTextMarkerForTextMarker
    AXPreviousTextMarkerForTextMarker AXPreviousWordStartTextMarkerForTextMarker AXRightLineTextMarkerRangeForTextMarker
    AXRightWordTextMarkerRangeForTextMarker AXSentenceTextMarkerRangeForTextMarker AXStartTextMarkerForBounds AXStartTextMarkerForTextMarkerRange
    AXStringForTextMarkerRange AXStyleTextMarkerRangeForTextMarker AXTextMarkerForIndex AXTextMarkerForPosition AXTextMarkerIsValid
    AXTextMarkerRangeForLine AXTextMarkerRangeForUIElement AXTextMarkerRangeForUnorderedTextMarkers AXUIElementCountForSearchPredicate
    AXUIElementForTextMarker AXUIElementsForSearchPredicate";

fn text(it: &str) -> Option<Value> {
    Some(Value::Text(it.to_owned()))
}

fn count(it: usize) -> Option<Value> {
    Some(Value::Number(it as f64))
}

// ───────────────────────────── names and values ─────────────────────────────

fn has_name_as_value(node: &Node) -> bool {
    matches!(
        node.role,
        Role::StaticText | Role::ListMarker | Role::Option
    )
}

fn title(node: &Node) -> &str {
    let is_said_elsewhere = has_name_as_value(node)
        || node.text(Text::Placeholder) == Some(node.name())
        || node.is_cell() && node.has(abi::NAMED_BY_CONTENT);
    if is_said_elsewhere || node.role == Role::LineBreak {
        ""
    } else {
        node.name()
    }
}

/// The name, unless it can be seen.
fn description(node: &Node) -> &str {
    let is_needed = is_link(node)
        || matches!(
            node.role,
            Role::Generic | Role::Group | Role::RadioGroup | Role::TabPanel
        )
        || !node.has(abi::NAMED_BY_CONTENT | abi::NAMED_BY_RELATION) && node.role != Role::WebArea;
    if is_needed { title(node) } else { "" }
}

fn main_value(forest: &Forest, id: Id, node: &Node) -> Option<Value> {
    match node.role {
        _ if has_name_as_value(node) => text(node.name()),
        _ if node.has(abi::CHECKABLE) => count(if node.has(abi::MIXED) {
            2
        } else {
            node.has(abi::CHECKED).into()
        }),
        Role::Heading => node.number(Number::Level).map(Value::Number),
        Role::Tab => count(node.has(abi::SELECTED).into()),
        Role::TabList => forest
            .descendants(id)
            .find(|it| forest.get(*it).is_some_and(|it| it.has(abi::SELECTED)))
            .map(Value::Element),
        Role::ColorWell => {
            let [_, red, green, blue] =
                u32::from_str_radix(node.text(Text::Value)?.strip_prefix('#')?, 16)
                    .ok()?
                    .to_be_bytes()
                    .map(|it| f32::from(it) / 255.);
            text(&format!("rgb {red:7.5} {green:7.5} {blue:7.5} 1"))
        }
        _ if has_range(node) && node.number(Number::Now).is_some() => {
            node.number(Number::Now).map(Value::Number)
        }
        _ if node.has(abi::TEXT_FIELD) => Some(Value::Text(forest.field_text(id).text)),
        _ => text(node.text(Text::Value).unwrap_or_default()),
    }
}

// ───────────────────────────── tables and outlines ─────────────────────────────

fn columns(forest: &Forest, table: Id) -> Vec<Id> {
    (0..forest.grid(table).columns as u32)
        .map(|it| Extra::Column(table, it).id())
        .collect()
}

fn rows_around(forest: &Forest, row: Id) -> Option<(Vec<Id>, usize)> {
    let rows = forest.members(
        forest.closest(row, |it| it.is_table() || it.role == Role::Tree)?,
        is_row,
    );
    let index = rows.iter().position(|it| *it == row)?;
    Some((rows, index))
}

fn level(forest: &Forest, id: Id) -> f64 {
    forest
        .get(id)
        .and_then(|it| it.number(Number::Level))
        .unwrap_or(1.)
}

fn visible(forest: &Forest, mut ids: Vec<Id>) -> Value {
    ids.retain(|it| !forest.is_offscreen(*it));
    elements(ids)
}

fn selected(forest: &Forest, mut ids: Vec<Id>) -> Value {
    ids.retain(|it| forest.get(*it).is_some_and(|it| it.has(abi::SELECTED)));
    elements(ids)
}

fn children(forest: &Forest, id: Id, node: &Node) -> Vec<Id> {
    let mut children = forest.exposed_children(id);
    if node.is_table() {
        children.extend(
            columns(forest, id)
                .into_iter()
                .chain([Extra::Header(id).id()]),
        );
    }
    children
}

fn part_in_math(forest: &Forest, id: Id, node: &Node, name: &str) -> Option<Value> {
    let (tag, children) = (forest.math_tag(id, node)?, forest.exposed_children(id));
    let pairs = |index| {
        let is_delimiter = |it: &Id| {
            forest
                .get(*it)
                .is_some_and(|it| it.text(Text::Tag) == Some("mprescripts"))
        };
        let scripts = children
            .get(1..)?
            .split(is_delimiter)
            .nth(index)
            .unwrap_or_default()
            .as_chunks()
            .0
            .iter();
        Some(Value::List(
            scripts
                .map(|&[low, high]| {
                    Value::Dictionary(vec![
                        ("AXMathSubscript", Value::Element(low)),
                        ("AXMathSuperscript", Value::Element(high)),
                    ])
                })
                .collect(),
        ))
    };
    match name {
        "AXMathPostscripts" => pairs(0),
        "AXMathPrescripts" => pairs(1),
        "AXMathRootRadicand" => Some(elements(children.iter().copied().take(if tag == "mroot" {
            1
        } else {
            usize::MAX
        }))),
        _ => children
            .get(parts_in_math(tag).split(' ').position(|it| it == name)?)
            .copied()
            .map(Value::Element),
    }
}

fn value_of_extra(forest: &Forest, extra: Extra, name: &str) -> Option<Value> {
    let (owner, window) = (extra.owner(), forest.place_of(extra.owner().tree)?.0);
    let children = || match extra {
        Extra::ScrollArea(root) => vec![root],
        Extra::Column(table, column) => forest
            .grid(table)
            .cells
            .iter()
            .filter(|it| it.columns.contains(&(column as usize)))
            .map(|it| it.id)
            .collect(),
        Extra::Header(table) => forest.members(table, |it| it.role == Role::ColumnHeader),
    };
    let bounds = || {
        children()
            .into_iter()
            .map(|it| forest.bounds(it, None, false))
            .reduce(crate::accessibility::text::union)
            .unwrap_or_default()
    };
    let role = match extra {
        Extra::ScrollArea(_) => "AXScrollArea",
        Extra::Column(..) => "AXColumn",
        Extra::Header(_) => "AXGroup",
    };
    Some(match (name, extra) {
        ("AXChildren" | "AXContents" | "AXRows", _) => elements(children()),
        ("AXVisibleRows", _) => visible(forest, children()),
        ("AXEnabled", _) => Value::Bool(true),
        ("AXFocused", _) => Value::Bool(false),
        ("AXParent", Extra::ScrollArea(_)) => Value::View(window),
        ("AXParent", _) => Value::Element(owner),
        ("AXPosition", _) => Value::Position(window, bounds()),
        ("AXSize", _) => Value::Size(bounds()),
        ("AXFrame", _) => Value::Rect(window, bounds()),
        ("AXRole", _) => Value::Text(role.to_owned()),
        ("AXRoleDescription", _) => Value::RoleDescription(None, role, None),
        ("AXSubrole", Extra::Header(_)) if children().is_empty() => {
            Value::Text("AXEmptyGroup".to_owned())
        }
        ("AXTopLevelUIElement" | "AXWindow", _) => Value::Window(window),
        ("AXIndex", Extra::Column(_, column)) => Value::Number(column.into()),
        ("AXHeader", Extra::Column(..)) => Value::Element(children().into_iter().find(|it| {
            forest
                .get(*it)
                .is_some_and(|it| it.role == Role::ColumnHeader)
        })?),
        _ => return None,
    })
}

// ───────────────────────────── text ─────────────────────────────

fn utf16_range(block: &Block, range: Range<usize>) -> Range<usize> {
    to_utf16(&block.text, range.start)..to_utf16(&block.text, range.end)
}

fn utf8_range(block: &Block, range: Range<usize>) -> Range<usize> {
    let start = from_utf16(&block.text, range.start);
    start..from_utf16(&block.text, range.end).max(start)
}

/// In bytes.
fn selected_in(forest: &Forest, id: Id, block: &Block) -> Option<Range<usize>> {
    let [start, end] = forest.ordered(forest.selection(id.tree)?);
    let is_inside = forest.contains(id, start.node) || forest.contains(id, end.node);
    is_inside.then_some(
        block.offset_of(forest, start).unwrap_or(0)
            ..block.offset_of(forest, end).unwrap_or(block.text.len()),
    )
}

fn line_at(starts: &[usize], offset: usize, is_upstream: bool) -> usize {
    starts
        .partition_point(|it| {
            if is_upstream {
                *it < offset
            } else {
                *it <= offset
            }
        })
        .saturating_sub(1)
}

fn attributes_of(forest: &Forest, leaf: Id, node: &Node) -> Vec<(&'static str, Value)> {
    let family = node.text(Text::FontFamily).unwrap_or_default();
    let mut font = vec![
        ("AXFontFamily", Value::Text(family.to_owned())),
        ("AXFontName", Value::Text(family.to_owned())),
    ];
    font.extend(
        node.number(Number::FontSize)
            .map(|it| ("AXFontSize", Value::Number(it))),
    );
    font.extend(
        [(abi::BOLD, "AXFontBold"), (abi::ITALIC, "AXFontItalic")]
            .iter()
            .filter(|it| node.has(it.0))
            .map(|it| (it.1, Value::Bool(true))),
    );
    let mut all = vec![("AXFont", Value::Dictionary(font))];
    all.extend(
        node.number(Number::Color)
            .map(|it| ("AXForegroundColor", Value::Color(it as u32))),
    );
    all.extend(
        node.has(abi::UNDERLINED)
            .then_some(("AXUnderline", Value::Number(1.))),
    );
    all.extend(
        node.has(abi::STRUCK)
            .then_some(("AXStrikethrough", Value::Bool(true))),
    );
    for (id, around) in forest
        .ancestors(leaf)
        .filter_map(|it| Some((it, forest.get(it)?)))
    {
        all.push(match around.role {
            _ if is_link(around) => ("AXLink", Value::Element(id)),
            Role::Blockquote => (
                "AXBlockQuoteLevel",
                Value::Number(forest.depth_in(id, |it| it.role == Role::Blockquote) as f64),
            ),
            Role::Deletion => ("AXIsSuggestedDeletion", Value::Bool(true)),
            Role::Heading => ("AXHeadingLevel", Value::Number(level(forest, id))),
            Role::Insertion => ("AXIsSuggestedInsertion", Value::Bool(true)),
            Role::Mark => ("AXHighlight", Value::Bool(true)),
            Role::Subscript => ("AXSuperscript", Value::Number(-1.)),
            Role::Suggestion => ("AXIsSuggestion", Value::Bool(true)),
            Role::Superscript => ("AXSuperscript", Value::Number(1.)),
            _ => continue,
        });
    }
    all.reverse();
    all
}

fn attributed(forest: &Forest, block: &Block, range: Range<usize>) -> Value {
    let (text, mut all) = (&block.text[range.clone()], Vec::new());
    let inside = |part: Range<usize>| {
        let [start, end] = [part.start, part.end].map(|it| {
            to_utf16(
                text,
                text.floor_char_boundary(it.clamp(range.start, range.end) - range.start),
            )
        });
        (start < end).then_some(start..end)
    };
    for (leaf, own) in &block.leaves {
        let Some((node, part)) = forest.get(*leaf).zip(inside(own.clone())) else {
            continue;
        };
        all.extend(
            attributes_of(forest, *leaf, node)
                .into_iter()
                .map(|it| (part.clone(), it.0, it.1)),
        );
        for wrong in node
            .misspelled
            .iter()
            .filter_map(|it| inside(own.start + it[0] as usize..own.start + it[1] as usize))
        {
            all.extend(
                ["AXMisspelled", "AXMarkedMisspelled"]
                    .map(|it| (wrong.clone(), it, Value::Bool(true))),
            );
        }
    }
    Value::Attributed(text.to_owned(), all)
}

fn text_value(forest: &Forest, id: Id, name: &str) -> Option<Value> {
    let block = forest.field_text(id);
    let selected = selected_in(forest, id, &block);
    match name {
        "AXInsertionPointLineNumber" => {
            let line = || {
                Some(line_at(
                    &block.line_starts(forest),
                    selected.filter(Range::is_empty)?.start,
                    forest.selection(id.tree)?[1].is_upstream,
                ))
            };
            Some(Value::Number(line().map_or(f64::INFINITY, |it| it as f64)))
        }
        "AXNumberOfCharacters" => count(block.text.encode_utf16().count()),
        "AXSelectedText" => text(&block.text[selected.unwrap_or_default()]),
        "AXSelectedTextRange" => Some(Value::Range(utf16_range(
            &block,
            selected.unwrap_or_default(),
        ))),
        "AXSelectedTextRanges" => Some(Value::List(vec![Value::Range(utf16_range(
            &block,
            selected.unwrap_or_default(),
        ))])),
        _ => Some(Value::Range(utf16_range(&block, 0..block.text.len()))),
    }
}

pub fn value(forest: &Forest, id: Id, name: &str) -> Option<Value> {
    if let Some(extra) = Extra::of(id) {
        return value_of_extra(forest, extra, name);
    }
    let is_of_all = matches!(
        name,
        "AXARIAPosInSet"
            | "AXARIASetSize"
            | "AXChildren"
            | "AXChildrenInNavigationOrder"
            | "AXFrame"
            | "AXParent"
            | "AXPosition"
            | "AXRole"
            | "AXSize"
            | "AXSubrole"
    );
    let node = forest
        .get(id)
        .filter(|_| is_of_all || attribute_names(forest, id).contains(&name))?;
    let (of_text, of_number) = (
        |key| text(node.text(key)?),
        |key| node.number(key).map(Value::Number),
    );
    let (flag, related) = (
        |state| Some(Value::Bool(node.has(state))),
        |key| Some(elements(forest.related(id, key))),
    );
    let (window, bounds) = (|| window_of(forest, id), || forest.bounds(id, None, false));
    let top = || forest.ancestors(id).last().unwrap_or(id);
    let active = || forest.related(id, Relation::ActiveDescendant).next();
    let options = || forest.members(id, |it| it.role == Role::Option || super::is_menu_item(it));
    match name {
        _ if name.starts_with("AXMath") => part_in_math(forest, id, node, name),
        "AXAccessKey" => of_text(Text::AccessKey),
        "AXARIAAtomic" => flag(abi::LIVE_ATOMIC),
        "AXARIAColumnCount" => {
            of_number(Number::ColumnCount).or_else(|| count(forest.grid(id).columns))
        }
        "AXARIAColumnIndex" => node
            .text(Text::ColumnIndex)?
            .parse()
            .ok()
            .map(Value::Number),
        "AXARIAControls" => related(Relation::Controls),
        "AXARIACurrent" => of_text(Text::Current),
        "AXARIALive" => text(if node.has(abi::LIVE_ASSERTIVE) {
            "assertive"
        } else if node.has(abi::LIVE_POLITE) {
            "polite"
        } else {
            "off"
        }),
        "AXARIAPosInSet" => Some(Value::Number(forest.place_in_set(id)?[0])),
        "AXARIARelevant" => of_text(Text::LiveRelevant),
        "AXARIARowCount" => {
            of_number(Number::RowCount).or_else(|| count(forest.grid(id).rows.len()))
        }
        "AXARIARowIndex" => node.text(Text::RowIndex)?.parse().ok().map(Value::Number),
        "AXARIASetSize" => forest.size_of_set(id).map(Value::Number),
        "AXAutocompleteValue" => of_text(Text::Autocomplete),
        "AXBlockQuoteLevel" => count(forest.depth_in(id, |it| it.role == Role::Blockquote)),
        "AXBrailleLabel" => of_text(Text::BrailleLabel),
        "AXBrailleRoleDescription" => of_text(Text::BrailleRoleDescription),
        "AXChildren" | "AXChildrenInNavigationOrder" | "AXContents" => {
            Some(elements(children(forest, id, node)))
        }
        "AXColumnCount" => count(forest.grid(id).columns),
        "AXColumnHeaderUIElements" => Some(elements(forest.headers(id, Role::ColumnHeader))),
        "AXColumnIndexDescription" => of_text(Text::ColumnIndex),
        "AXColumnIndexRange" => Some(Value::Range(forest.cell(id)?.columns)),
        "AXColumns" | "AXVisibleColumns" => Some(elements(columns(forest, id))),
        "AXDescription" => text(description(node)),
        "AXDetailsElements" => related(Relation::Details),
        "AXDisclosedByRow" => {
            let (rows, index) = rows_around(forest, id)?;
            rows[..index]
                .iter()
                .rfind(|it| level(forest, **it) < level(forest, id))
                .copied()
                .map(Value::Element)
        }
        "AXDisclosedRows" => {
            let ((rows, index), own) = (rows_around(forest, id)?, level(forest, id));
            Some(elements(
                rows[index + 1..]
                    .iter()
                    .copied()
                    .take_while(|it| level(forest, *it) > own)
                    .filter(|it| level(forest, *it) == own + 1.),
            ))
        }
        "AXDisclosing" | "AXExpanded" => flag(abi::EXPANDED),
        "AXDisclosureLevel" => Some(Value::Number(level(forest, id) - 1.)),
        "AXDOMClassList" => Some(Value::List(
            node.text(Text::DomClass)
                .unwrap_or_default()
                .split_ascii_whitespace()
                .filter_map(text)
                .collect(),
        )),
        "AXDOMIdentifier" => text(node.text(Text::DomId).unwrap_or_default()),
        "AXEditableAncestor" => forest
            .closest(id, |it| it.has(abi::TEXT_FIELD))
            .map(Value::Element),
        "AXElementBusy" => flag(abi::BUSY),
        "AXEnabled" => Some(Value::Bool(!node.has(abi::DISABLED))),
        "AXEndTextMarker" => Some(Value::Marker(forest.end_of(top()))),
        "AXErrorMessageElements" => related(Relation::ErrorMessage),
        "AXFocusableAncestor" => forest
            .closest(id, |it| it.has(abi::FOCUSABLE))
            .map(Value::Element),
        "AXFocused" => Some(Value::Bool(forest.is_focused(id))),
        "AXFrame" => Some(Value::Rect(window()?, bounds())),
        "AXHasPopup" => Some(Value::Bool(node.text(Text::HasPopup).is_some())),
        "AXHeader" => Some(Value::Element(Extra::Header(id).id())),
        "AXHelp" => text(
            node.text(Text::Description)
                .filter(|_| !node.has(abi::DESCRIBED_BY_ARIA))?,
        ),
        "AXHighestEditableAncestor" => std::iter::once(id)
            .chain(forest.ancestors(id))
            .filter(|it| forest.get(*it).is_some_and(|it| it.has(abi::TEXT_FIELD)))
            .last()
            .map(Value::Element),
        "AXIndex" => count(rows_around(forest, id)?.1),
        "AXInsertionPointLineNumber"
        | "AXNumberOfCharacters"
        | "AXSelectedText"
        | "AXSelectedTextRange"
        | "AXSelectedTextRanges"
        | "AXVisibleCharacterRange" => text_value(forest, id, name),
        "AXInvalid" => text(node.text(Text::Invalid).unwrap_or("false")),
        "AXIsMultiSelectable" => flag(abi::MULTISELECTABLE),
        "AXKeyShortcutsValue" => of_text(Text::KeyShortcuts),
        "AXLanguage" => text(forest.inherited_text(id, Text::Language)?),
        "AXLinkedUIElements" => {
            let keys = [
                Relation::Controls,
                Relation::FlowTo,
                Relation::Target,
                Relation::RadioGroup,
            ];
            let is = |it, role| forest.get(it).is_some_and(|it| it.role == role);
            let group = forest.parent(id).filter(|it| {
                node.role == Role::Radio
                    && is(*it, Role::RadioGroup)
                    && forest.related(id, Relation::RadioGroup).next().is_none()
            });
            let radios = group
                .into_iter()
                .flat_map(|it| forest.children(it))
                .filter(|it| is(*it, Role::Radio));
            Some(elements(
                keys.into_iter()
                    .flat_map(|it| forest.related(id, it))
                    .chain(radios),
            ))
        }
        "AXLoaded" => Some(Value::Bool(!node.has(abi::LOADING))),
        "AXLoadingProgress" => count((!node.has(abi::LOADING)).into()),
        "AXMaxValue" => of_number(Number::Max),
        "AXMenuItemMarkChar" => text(if node.has(abi::MIXED) {
            "-"
        } else {
            node.has(abi::CHECKED).then_some("✓")?
        }),
        "AXMinValue" => of_number(Number::Min),
        "AXModal" => flag(abi::MODAL),
        "AXOrientation" => text(if node.has(abi::HORIZONTAL) {
            "AXHorizontalOrientation"
        } else {
            "AXVerticalOrientation"
        }),
        "AXOwns" => Some(elements([forest.closest(active()?, |it| {
            it.is_table() || matches!(it.role, Role::Listbox | Role::Menu | Role::Tree)
        })?])),
        "AXParent" => Some(Value::Element(
            forest
                .parent(id)
                .unwrap_or_else(|| Extra::ScrollArea(id).id()),
        )),
        "AXPlaceholderValue" => of_text(Text::Placeholder),
        "AXPopupValue" => of_text(Text::HasPopup),
        "AXPosition" => Some(Value::Position(window()?, bounds())),
        "AXRequired" => flag(abi::REQUIRED),
        "AXRole" => text(roles::role(forest, id, node)),
        "AXRoleDescription" => Some(roles::description(forest, id, node)),
        "AXRowCount" => count(forest.members(id, is_row).len()),
        "AXRowHeaderUIElements" => Some(elements(forest.headers(id, Role::RowHeader))),
        "AXRowIndexDescription" => of_text(Text::RowIndex),
        "AXRowIndexRange" => Some(Value::Range(forest.cell(id)?.rows)),
        "AXRows" => Some(elements(forest.members(id, is_row))),
        "AXSelected" => flag(abi::SELECTED),
        "AXSelectedCells" => Some(active().map_or_else(
            || selected(forest, forest.members(id, Node::is_cell)),
            |it| elements([it]),
        )),
        // VoiceOver calls the options of a list box selected that are among these.
        "AXSelectedChildren" if node.role == Role::Listbox || node.has(abi::MULTISELECTABLE) => {
            Some(selected(forest, options()))
        }
        "AXSelectedChildren" => {
            Some(active().map_or_else(|| selected(forest, options()), |it| elements([it])))
        }
        "AXSelectedRows" => Some(selected(forest, forest.members(id, is_row))),
        "AXSelectedTextMarkerRange" => forest
            .selection(forest.real_focus(window()?).unwrap_or(id).tree)
            .map(Value::MarkerRange),
        "AXSize" => Some(Value::Size(bounds())),
        "AXSortDirection" => text(match node.text(Text::Sort)? {
            "ascending" => "AXAscendingSortDirection",
            "descending" => "AXDescendingSortDirection",
            _ => "AXUnknownSortDirection",
        }),
        "AXStartTextMarker" => Some(Value::Marker(forest.start_of(top()))),
        "AXSubrole" => text(roles::subrole(forest, id, node)?),
        "AXTabs" => Some(elements(forest.members(id, |it| it.role == Role::Tab))),
        "AXTitle" => text(title(node)),
        "AXTopLevelUIElement" | "AXWindow" => window().map(Value::Window),
        "AXURL" => Some(Value::Url(node.text(Text::Url)?.to_owned())),
        "AXValue" => main_value(forest, id, node),
        "AXValueDescription" => match node.text(Text::Value) {
            // VoiceOver would say a percentage.
            None if forest
                .closest(id, |it| {
                    matches!(it.role, Role::Date | Role::DateTime | Role::InputTime)
                })
                .is_some() =>
            {
                text("0")
            }
            value => text(value.unwrap_or_default()),
        },
        "AXVisibleCells" => Some(visible(forest, forest.members(id, Node::is_cell))),
        "AXVisibleChildren" => Some(visible(forest, forest.exposed_children(id))),
        "AXVisibleRows" => Some(visible(forest, forest.members(id, is_row))),
        "AXValueAutofillAvailable" | "AXVisited" => Some(Value::Bool(false)),
        _ => None,
    }
}

fn value_for_index(forest: &Forest, id: Id, name: &str, index: usize) -> Option<Value> {
    let block = forest.field_text(id);
    let unit = |unit| {
        block
            .units(forest, unit)
            .into_iter()
            .find(|it| it.end > from_utf16(&block.text, index))
    };
    match name {
        "AXLineForIndex" if from_utf16(&block.text, index) >= block.text.len() => {
            Some(Value::Number(f64::INFINITY))
        }
        "AXLineForIndex" => count(line_at(
            &block.line_starts(forest),
            from_utf16(&block.text, index),
            false,
        )),
        "AXRangeForIndex" => Some(Value::Range(utf16_range(&block, unit(Unit::Character)?))),
        "AXStyleRangeForIndex" => Some(Value::Range(utf16_range(&block, unit(Unit::Style)?))),
        "AXRangeForLine" => Some(Value::Range(utf16_range(
            &block,
            block
                .units(forest, Unit::Line)
                .get(index)
                .cloned()
                .unwrap_or_default(),
        ))),
        "AXTextMarkerForIndex" => block
            .position(from_utf16(&block.text, index), false)
            .map(Value::Marker),
        "AXTextMarkerRangeForLine" => {
            let line = block.trimmed(block.units(forest, Unit::Line).get(index)?.clone());
            Some(Value::MarkerRange([
                block.position(line.start, false)?,
                block.position(line.end, !line.is_empty())?,
            ]))
        }
        _ => None,
    }
}

fn value_for_text(
    forest: &Forest,
    id: Id,
    kind: &str,
    block: &Block,
    range: Range<usize>,
    is_upstream: bool,
) -> Option<Value> {
    match kind {
        "AXAttributedString" => Some(attributed(forest, block, range)),
        "AXBounds" => Some(Value::Rect(
            window_of(forest, id)?,
            forest
                .bounds_of_text(block, range, is_upstream)
                .unwrap_or_else(|| Rect {
                    width: 0.,
                    ..forest.bounds(id, None, false)
                }),
        )),
        "AXLength" => count(block.text[range].encode_utf16().count()),
        "AXString" => text(&block.text[range]),
        _ => None,
    }
}

fn value_for_marker(forest: &Forest, id: Id, name: &str, at: Position) -> Option<Value> {
    let name = name.strip_prefix("AX")?.strip_suffix("ForTextMarker")?;
    let units = [
        ("Word", Unit::Word),
        ("Line", Unit::Line),
        ("Sentence", Unit::Sentence),
        ("Paragraph", Unit::Paragraph),
        ("Style", Unit::Style),
    ];
    let unit = units
        .into_iter()
        .find(|it| name.contains(it.0))
        .map(|it| it.1);
    let within = || {
        forest.field_text(
            forest
                .closest(at.node, |it| it.has(abi::TEXT_FIELD))
                .unwrap_or(id),
        )
    };
    match name {
        "UIElement" => Some(Value::Element(forest.exposed(at.node))),
        "Index" => {
            let block = forest.field_text(id);
            count(to_utf16(&block.text, block.offset_of(forest, at)?))
        }
        "Line" => {
            let block = within();
            count(line_at(
                &block.line_starts(forest),
                block.offset_of(forest, at)?,
                at.is_upstream,
            ))
        }
        "NextTextMarker" => forest.step(at, true).map(Value::Marker),
        "PreviousTextMarker" => forest.step(at, false).map(Value::Marker),
        _ if name.starts_with("Next") => forest.next_end(at, unit?).map(Value::Marker),
        _ if name.starts_with("Previous") => forest.previous_start(at, unit?).map(Value::Marker),
        "LeftWordTextMarkerRange" | "RightWordTextMarkerRange" => forest
            .word_beside(at, name.starts_with('R'))
            .map(Value::MarkerRange),
        "LeftLineTextMarkerRange" | "RightLineTextMarkerRange" => forest
            .line_beside(at, name.starts_with('R'))
            .map(Value::MarkerRange),
        _ => forest.unit_at(at, unit?).map(Value::MarkerRange),
    }
}

pub fn value_for(forest: &Forest, id: Id, name: &str, parameter: Parameter) -> Option<Value> {
    match parameter {
        Parameter::Number(index) => value_for_index(forest, id, name, index as usize),
        Parameter::Numbers(numbers) => {
            let [column, row] = numbers.first_chunk()?.map(|it| it as usize);
            forest.grid(id).at(row, column).map(Value::Element)
        }
        Parameter::Range(range) => {
            let block = forest.field_text(id);
            value_for_text(
                forest,
                id,
                name.strip_suffix("ForRange")?,
                &block,
                utf8_range(&block, range),
                false,
            )
        }
        Parameter::Point(point) if name == "AXRangeForPosition" => {
            let block = forest.field_text(id);
            value_for_index(
                forest,
                id,
                "AXRangeForIndex",
                to_utf16(
                    &block.text,
                    block.offset_of(forest, forest.position_near(id, point)?)?,
                ),
            )
        }
        Parameter::Point(point) => forest.position_near(id, point).map(Value::Marker),
        Parameter::Rect(it) if name.starts_with("AXStart") => {
            forest.position_near(id, [it.x, it.y]).map(Value::Marker)
        }
        Parameter::Rect(it) => forest
            .position_near(id, [it.x + it.width - 1., it.y + it.height - 1.])
            .map(Value::Marker),
        Parameter::Element(child) if name == "AXIndexForChildUIElement" => count(
            children(forest, id, forest.get(id)?)
                .iter()
                .position(|it| *it == child)?,
        ),
        Parameter::Element(it) => forest
            .get(it)
            .map(|_| Value::MarkerRange([forest.start_of(it), forest.end_of(it)])),
        Parameter::Marker(at) if name == "AXTextMarkerIsValid" => {
            Some(Value::Bool(forest.validated(at).is_some()))
        }
        Parameter::Marker(at) => value_for_marker(forest, id, name, forest.validated(at)?),
        Parameter::Markers([a, b]) => {
            let range = forest.ordered([forest.validated(a)?, forest.validated(b)?]);
            match name.split_once("For")?.0 {
                "AXTextMarkerRange" => Some(Value::MarkerRange(range)),
                "AXStartTextMarker" => Some(Value::Marker(range[0])),
                "AXEndTextMarker" => Some(Value::Marker(range[1])),
                kind => {
                    let (block, part) = forest.between(range);
                    value_for_text(
                        forest,
                        range[0].node,
                        kind,
                        &block,
                        part,
                        range[0].is_upstream,
                    )
                }
            }
        }
        Parameter::Search {
            keys,
            start,
            is_backwards,
            limit,
            text,
            only_visible,
            only_children,
        } => {
            let search = Search {
                keys: keys.split_ascii_whitespace().collect(),
                start,
                is_backwards,
                limit,
                text: &text,
                only_visible,
                only_children,
            };
            let found = forest.search(id, &search);
            if name.contains("Count") {
                count(found.len())
            } else {
                Some(elements(found))
            }
        }
        Parameter::Text(_) | Parameter::Replacement(..) => None,
    }
}

// ───────────────────────────── changes ─────────────────────────────

pub fn is_settable(forest: &Forest, id: Id, name: &str) -> bool {
    forest.get(id).is_some_and(|node| {
        let is_writable = !node.has(abi::DISABLED | abi::READ_ONLY);
        match name {
            "AXFocused" => node.has(abi::FOCUSABLE),
            // After an increment VoiceOver would set a slider to a step of its own.
            "AXValue" => {
                is_writable
                    && (node.has(abi::TEXT_FIELD)
                        || matches!(node.role, Role::Date | Role::DateTime | Role::InputTime))
            }
            "AXSelectedText" | "AXReplaceRangeWithText" => is_writable && node.has(abi::TEXT_FIELD),
            "AXSelectedTextRange" => node.has(abi::TEXT_FIELD) || node.is_text(),
            "AXSelectedTextMarkerRange" => true,
            "AXDisclosing" | "AXExpanded" => {
                node.has(abi::EXPANDED | abi::COLLAPSED) && !node.has(abi::DISABLED)
            }
            _ => false,
        }
    })
}

fn select(id: Id, range: Range<usize>) -> Option<()> {
    let ends = read(|forest| {
        let block = forest.field_text(id);
        let range = utf8_range(&block, range);
        Some([
            block.position(range.start, false)?,
            block.position(range.end, !range.is_empty())?,
        ])
    });
    crate::accessibility::select_text(ends?);
    Some(())
}

/// Whether it was possible.
pub fn set(id: Id, name: &str, to: Parameter) -> bool {
    if !read(|it| is_settable(it, id, name)) {
        return false;
    }
    let has = |state| read(|it| it.get(id).is_some_and(|it| it.has(state)));
    let either = |is_on: f64, on, off| perform(id, if is_on == 0. { off } else { on }, [0; 4], "");
    match (name, to) {
        ("AXFocused", Parameter::Number(it)) => either(it, Action::Focus, Action::Blur),
        ("AXDisclosing" | "AXExpanded", Parameter::Number(it))
            if (it != 0.) != has(abi::EXPANDED) =>
        {
            either(it, Action::Expand, Action::Collapse)
        }
        ("AXValue", Parameter::Number(it)) => {
            perform(id, Action::SetValue, [0; 4], &it.to_string())
        }
        ("AXValue", Parameter::Text(it)) => perform(id, Action::SetValue, [0; 4], &it),
        ("AXSelectedText", Parameter::Text(it)) => {
            perform(id, Action::ReplaceSelectedText, [0; 4], &it)
        }
        ("AXSelectedTextRange", Parameter::Range(it)) => return select(id, it).is_some(),
        ("AXSelectedTextMarkerRange", Parameter::Markers(ends)) => {
            crate::accessibility::select_text(ends)
        }
        ("AXReplaceRangeWithText", Parameter::Replacement(range, text)) => {
            select(id, range);
            perform(id, Action::ReplaceSelectedText, [0; 4], &text);
        }
        _ => return false,
    }
    true
}
