//! The answers to calls.

use super::{Connection, Message, Object, PROPERTIES, Value, roles};
use crate::abi::Rect;
use crate::abi::accessibility::{self as abi, Action, Number, Relation, Role, Text};
use crate::accessibility::forest::{Forest, Id, Node};
use crate::accessibility::search::is_link;
use crate::accessibility::{self, perform};
use crate::window;

pub struct Call<'a> {
    pub connection: &'a Connection,
    pub forest: &'a Forest,
    pub id: Id,
    arguments: &'a Value,
    /// What cannot be done while the forest is being read.
    deferred: Vec<Box<dyn FnOnce()>>,
}

pub fn rectangle(it: [i32; 4]) -> Vec<Value> {
    it.map(Value::I32).into()
}

fn integer(it: usize) -> Value {
    Value::I32(it as i32)
}

fn state_set(states: u64) -> Value {
    Value::Array(
        "u".into(),
        vec![Value::U32(states as u32), Value::U32((states >> 32) as u32)],
    )
}

fn interfaces(node: &Node) -> Vec<&'static str> {
    let all = [
        ("Accessible", true),
        ("Action", true),
        ("Collection", true),
        ("Component", true),
        ("Document", node.role == Role::WebArea),
        ("EditableText", node.has(abi::TEXT_FIELD)),
        ("Hyperlink", !node.is_text() && node.role != Role::WebArea),
        ("Hypertext", !node.is_text()),
        (
            "Image",
            matches!(
                node.role,
                Role::Image | Role::GraphicsSymbol | Role::DocCover
            ),
        ),
        (
            "Selection",
            node.holds_selection() && node.role != Role::Table,
        ),
        ("Table", node.is_table()),
        ("TableCell", node.is_cell()),
        (
            "Text",
            !matches!(
                node.role,
                Role::Image | Role::Separator | Role::Slider | Role::ProgressBar | Role::Meter
            ),
        ),
        (
            "Value",
            node.number(Number::Now)
                .or(node.number(Number::Max))
                .is_some(),
        ),
    ];
    all.into_iter().filter(|it| it.1).map(|it| it.0).collect()
}

fn qualified(interfaces: &[&str]) -> Value {
    Value::Array(
        "s".into(),
        interfaces
            .iter()
            .map(|it| Value::Str(format!("org.a11y.atspi.{it}")))
            .collect(),
    )
}

fn properties(interface: &str) -> &'static str {
    match interface {
        "Accessible" => "Name Description Parent ChildCount Locale AccessibleId",
        "Action" => "NActions",
        "Application" => "ToolkitName Version AtspiVersion Id",
        "Document" => "CurrentPageNumber PageCount",
        "Hyperlink" => "NAnchors StartIndex EndIndex",
        "Image" => "ImageDescription ImageLocale",
        "Selection" => "NSelectedChildren",
        "Table" => "NRows NColumns Caption Summary NSelectedRows NSelectedColumns",
        "TableCell" => "ColumnSpan Position RowSpan Table",
        "Text" => "CharacterCount CaretOffset",
        "Value" => "MinimumValue MaximumValue MinimumIncrement CurrentValue Text",
        _ => "",
    }
}

fn actions(node: &Node) -> Vec<(&'static str, Action)> {
    let default = match node.role {
        _ if node.has(abi::TEXT_FIELD) => "activate",
        _ if node.has(abi::MENU_LIST) => "open",
        Role::Button => "press",
        Role::Checkbox | Role::MenuItemCheckbox | Role::Switch if node.has(abi::CHECKED) => {
            "uncheck"
        }
        Role::Checkbox
        | Role::MenuItemCheckbox
        | Role::Radio
        | Role::MenuItemRadio
        | Role::Switch => "check",
        _ if is_link(node) => "jump",
        Role::MenuItem | Role::Option | Role::Tab => "select",
        _ => "click",
    };
    let is_adjustable =
        matches!(node.role, Role::Slider | Role::SpinButton) && !node.has(abi::DISABLED);
    let all = [
        (
            node.has(abi::CLICKABLE | abi::TEXT_FIELD) && !node.has(abi::DISABLED),
            default,
            Action::Click,
        ),
        (is_adjustable, "increment", Action::Increment),
        (is_adjustable, "decrement", Action::Decrement),
        (true, "showContextMenu", Action::ShowContextMenu),
    ];
    all.into_iter()
        .filter(|it| it.0)
        .map(|it| (it.1, it.2))
        .collect()
}

/// `kind` is 1 for all, 2 for any, 3 for none, and 4 for all or both empty.
fn meets(kind: Option<i64>, mut found: impl ExactSizeIterator<Item = bool>) -> bool {
    match kind {
        _ if found.len() == 0 => true,
        Some(2) => found.any(|it| it),
        Some(3) => !found.any(|it| it),
        _ => found.all(|it| it),
    }
}

fn bits(words: &Value) -> Vec<u32> {
    let set = |(index, word): (u32, &Value)| {
        let word = word.number().unwrap_or(0) as u32;
        (0..32)
            .filter(move |it| word >> it & 1 != 0)
            .map(move |it| index * 32 + it)
    };
    (0..).zip(words.items()).flat_map(set).collect()
}

impl Call<'_> {
    pub fn number(&self, index: usize) -> i64 {
        self.arguments.at(index).number().unwrap_or(0)
    }

    pub fn string(&self, index: usize) -> &str {
        self.arguments.at(index).str()
    }

    pub fn afterwards(&mut self, job: impl FnOnce() + 'static) -> Value {
        self.deferred.push(Box::new(job));
        Value::Bool(true)
    }

    pub fn act(&mut self, action: Action, text: String) -> Value {
        self.act_on(Some(self.id), action, text)
    }

    fn act_on(&mut self, id: Option<Id>, action: Action, text: String) -> Value {
        id.map_or(Value::Bool(false), |id| {
            self.afterwards(move || perform(id, action, [0; 4], &text))
        })
    }

    fn node(&self, id: Option<Id>) -> Value {
        self.connection.reference(id.map(Object::Node))
    }

    fn nodes(&self, ids: impl IntoIterator<Item = Id>) -> Value {
        self.connection
            .references(ids.into_iter().map(Object::Node))
    }

    /// What is added to a point in the window, and the scale. `kind` is 0 for the screen, 1 for the window and 2 for the parent.
    fn space(&self, kind: i64) -> ([f32; 2], f32) {
        let metrics = self
            .forest
            .place_of(self.id.tree)
            .and_then(|it| window::state(it.0).ok())
            .map(|it| it.metrics.get());
        let parent = || {
            self.forest
                .parent(self.id)
                .map_or_else(Rect::default, |it| self.forest.bounds(it, None, false))
        };
        let offset = match kind {
            0 => metrics.map_or([0.; 2], |it| it.origin.into()),
            1 => [0.; 2],
            _ => [-parent().x, -parent().y],
        };
        (offset, metrics.map_or(1., |it| it.scale))
    }

    pub fn to_client(&self, it: Rect, kind: i64) -> [i32; 4] {
        let ([x, y], scale) = self.space(kind);
        [it.x + x, it.y + y, it.width, it.height].map(|it| (it * scale).round() as i32)
    }

    pub fn point(&self, first: usize, kind: i64) -> [f32; 2] {
        let ([x, y], scale) = self.space(kind);
        [
            self.number(first) as f32 / scale - x,
            self.number(first + 1) as f32 / scale - y,
        ]
    }

    fn relations(&self, node: &Node) -> Value {
        let (forest, id) = (self.forest, self.id);
        let mut all: Vec<(u32, Vec<Id>)> = Vec::new();
        for (key, forward, reverse) in roles::RELATIONS {
            all.extend([
                (forward, forest.related(id, key).collect()),
                (reverse, forest.related_to(id, key)),
            ]);
        }
        all.push((
            roles::MEMBER_OF,
            forest.related(id, Relation::RadioGroup).collect(),
        ));
        if node.role == Role::TreeItem {
            all.push((
                roles::NODE_CHILD_OF,
                forest
                    .parent(id)
                    .and_then(|it| {
                        forest.closest(it, |it| matches!(it.role, Role::TreeItem | Role::Tree))
                    })
                    .into_iter()
                    .collect(),
            ));
        }
        Value::Array(
            "(ua(so))".into(),
            all.into_iter()
                .filter(|it| !it.1.is_empty())
                .map(|it| Value::Struct(vec![Value::U32(it.0), self.nodes(it.1)]))
                .collect(),
        )
    }

    fn accessible(&self, node: &Node, member: &str) -> Option<Value> {
        let (forest, id) = (self.forest, self.id);
        let window = || Some(forest.place_of(id.tree)?.0);
        Some(match member {
            "Name" => node.name().into(),
            "Description" => node.text(Text::Description).unwrap_or_default().into(),
            "HelpText" => "".into(),
            "Parent" => self.connection.reference(
                forest
                    .parent(id)
                    .map(Object::Node)
                    .or_else(|| window().map(Object::Window)),
            ),
            "ChildCount" => integer(forest.exposed_children(id).len()),
            "Locale" => forest
                .inherited_text(id, Text::Language)
                .unwrap_or_default()
                .into(),
            "AccessibleId" => node.text(Text::DomId).unwrap_or_default().into(),
            "GetChildAtIndex" => self.node(
                forest
                    .exposed_children(id)
                    .get(self.number(0) as usize)
                    .copied(),
            ),
            "GetChildren" => self.nodes(forest.exposed_children(id)),
            "GetIndexInParent" => forest
                .index_in_parent(id)
                .or_else(|| forest.roots(window()?).iter().position(|it| *it == id))
                .map_or(Value::I32(-1), integer),
            "GetRelationSet" => self.relations(node),
            "GetRole" => Value::U32(roles::role(forest, id, node).0),
            "GetRoleName" | "GetLocalizedRoleName" => roles::role(forest, id, node).1.into(),
            "GetState" => state_set(roles::states(forest, id, node)),
            "GetAttributes" => Value::attributes(
                &roles::attributes(forest, id, node)
                    .iter()
                    .map(|it| (it.0, &*it.1))
                    .collect::<Vec<_>>(),
            ),
            "GetInterfaces" => qualified(&interfaces(node)),
            _ => return None,
        })
    }

    fn component(&mut self, member: &str) -> Option<Vec<Value>> {
        let (forest, id) = (self.forest, self.id);
        let extents = |kind| rectangle(self.to_client(forest.bounds(id, None, false), kind));
        Some(vec![match member {
            "Contains" => {
                let [x, y] = self.point(0, self.number(2));
                Value::Bool(crate::surface::contains(
                    forest.bounds(id, None, false),
                    x,
                    y,
                ))
            }
            "GetAccessibleAtPoint" => self.node(
                forest
                    .hit(id, self.point(0, self.number(2)))
                    .map(|it| forest.exposed(it))
                    .filter(|it| *it != id),
            ),
            "GetExtents" | "GetImageExtents" => Value::Struct(extents(self.number(0))),
            "GetPosition" | "GetImagePosition" => {
                return Some(extents(self.number(0))[..2].to_vec());
            }
            "GetSize" | "GetImageSize" => return Some(extents(1)[2..].to_vec()),
            "GetLayer" => Value::U32(3),
            "GetAlpha" => Value::F64(1.),
            "GrabFocus" => self.act(Action::Focus, String::new()),
            "ScrollTo" | "ScrollToPoint" => self.act(Action::ScrollIntoView, String::new()),
            "ImageDescription" => forest.get(id)?.name().into(),
            "ImageLocale" => "".into(),
            _ => return None,
        }])
    }

    fn action(&mut self, node: &Node, member: &str) -> Option<Value> {
        let all = actions(node);
        let chosen = all.get(self.number(0) as usize).copied();
        let binding = || {
            node.text(Text::AccessKey)
                .map_or(String::new(), |it| format!("<Alt>{it};;"))
        };
        Some(match member {
            "NActions" => integer(all.len()),
            "GetName" | "GetLocalizedName" => chosen.map_or("", |it| it.0).into(),
            "GetDescription" => "".into(),
            "GetKeyBinding" => Value::Str(binding()),
            "GetActions" => Value::Array(
                "(sss)".into(),
                all.iter()
                    .map(|it| Value::Struct(vec![it.0.into(), "".into(), Value::Str(binding())]))
                    .collect(),
            ),
            "DoAction" => chosen.map_or(Value::Bool(false), |it| self.act(it.1, String::new())),
            _ => return None,
        })
    }

    fn value(&self, node: &Node, member: &str) -> Option<Value> {
        let number = |key| Value::F64(node.number(key).unwrap_or(0.));
        Some(match member {
            "MinimumValue" => number(Number::Min),
            "MaximumValue" => number(Number::Max),
            "MinimumIncrement" => number(Number::Step),
            "CurrentValue" => number(Number::Now),
            "Text" => node.text(Text::Value).unwrap_or_default().into(),
            _ => return None,
        })
    }

    fn selection(&mut self, member: &str) -> Option<Value> {
        let (forest, index) = (self.forest, self.number(0) as usize);
        let is_selected = |it: &Id| forest.get(*it).is_some_and(|it| it.has(abi::SELECTED));
        let selected = || forest.members(self.id, |it| it.has(abi::SELECTED));
        let child = forest.exposed_children(self.id).get(index).copied();
        Some(match member {
            "NSelectedChildren" => integer(selected().len()),
            "GetSelectedChild" => self.node(selected().get(index).copied()),
            "IsChildSelected" => Value::Bool(child.as_ref().is_some_and(is_selected)),
            "SelectChild" => self.act_on(
                child.filter(|it| !is_selected(it)),
                Action::Select,
                String::new(),
            ),
            "DeselectChild" => {
                self.act_on(child.filter(is_selected), Action::Deselect, String::new())
            }
            "DeselectSelectedChild" => self.act_on(
                selected().get(index).copied(),
                Action::Deselect,
                String::new(),
            ),
            "SelectAll" | "ClearSelection" => Value::Bool(false),
            _ => return None,
        })
    }

    fn table(&self, member: &str) -> Option<Vec<Value>> {
        let (forest, grid) = (self.forest, self.forest.grid(self.id));
        let [first, second] = [0, 1].map(|it| self.number(it) as usize);
        let at = || {
            grid.cells
                .iter()
                .position(|it| it.rows.contains(&first) && it.columns.contains(&second))
        };
        let has_role = |id, role| forest.get(id).is_some_and(|it| it.role == role);
        let row_header = || {
            grid.cells
                .iter()
                .find(|it| it.rows.contains(&first) && has_role(it.id, Role::RowHeader))
                .map(|it| it.id)
        };
        let column_header = || {
            grid.cells
                .iter()
                .find(|it| it.columns.contains(&first) && has_role(it.id, Role::ColumnHeader))
                .map(|it| it.id)
        };
        let name = |id: Option<Id>| {
            id.and_then(|it| forest.get(it))
                .map_or("", Node::name)
                .into()
        };
        let is_selected = |id: Option<&Id>| {
            id.and_then(|it| forest.get(*it))
                .is_some_and(|it| it.has(abi::SELECTED))
        };
        let selected_rows = || {
            grid.rows
                .iter()
                .enumerate()
                .filter(|it| is_selected(Some(it.1)))
                .map(|it| integer(it.0))
        };
        Some(vec![match member {
            "NRows" => integer(grid.rows.len()),
            "NColumns" => integer(grid.columns),
            "Caption" => self.node(
                forest
                    .children(self.id)
                    .find(|it| has_role(*it, Role::Caption)),
            ),
            "Summary" => self.node(None),
            "NSelectedRows" => integer(selected_rows().count()),
            "NSelectedColumns" => integer(0),
            "GetAccessibleAt" => self.node(grid.at(first, second)),
            "GetIndexAt" => at().map_or(Value::I32(-1), integer),
            "GetRowAtIndex" => grid
                .cells
                .get(first)
                .map_or(Value::I32(-1), |it| integer(it.rows.start)),
            "GetColumnAtIndex" => grid
                .cells
                .get(first)
                .map_or(Value::I32(-1), |it| integer(it.columns.start)),
            "GetRowDescription" => name(row_header()),
            "GetColumnDescription" => name(column_header()),
            "GetRowExtentAt" => integer(at().map_or(0, |it| grid.cells[it].rows.len())),
            "GetColumnExtentAt" => integer(at().map_or(0, |it| grid.cells[it].columns.len())),
            "GetRowHeader" => self.node(row_header()),
            "GetColumnHeader" => self.node(column_header()),
            "GetSelectedRows" => Value::Array("i".into(), selected_rows().collect()),
            "GetSelectedColumns" => Value::Array("i".into(), Vec::new()),
            "IsRowSelected" => Value::Bool(is_selected(grid.rows.get(first))),
            "IsSelected" => Value::Bool(
                is_selected(grid.rows.get(first)) || is_selected(grid.at(first, second).as_ref()),
            ),
            "IsColumnSelected"
            | "AddRowSelection"
            | "AddColumnSelection"
            | "RemoveRowSelection"
            | "RemoveColumnSelection" => Value::Bool(false),
            "GetRowColumnExtentsAtIndex" => {
                let cell = grid.cells.get(first);
                let numbers = cell
                    .map_or([0; 4], |it| {
                        [
                            it.rows.start,
                            it.columns.start,
                            it.rows.len(),
                            it.columns.len(),
                        ]
                    })
                    .map(integer);
                return Some(
                    [Value::Bool(cell.is_some())]
                        .into_iter()
                        .chain(numbers)
                        .chain([Value::Bool(is_selected(cell.map(|it| &it.id)))])
                        .collect(),
                );
            }
            _ => return None,
        }])
    }

    fn table_cell(&self, member: &str) -> Option<Vec<Value>> {
        let cell = self.forest.cell(self.id)?;
        Some(vec![match member {
            "ColumnSpan" => integer(cell.columns.len()),
            "RowSpan" => integer(cell.rows.len()),
            "Position" => {
                Value::Struct(vec![integer(cell.rows.start), integer(cell.columns.start)])
            }
            "Table" => self.node(self.forest.closest(self.id, Node::is_table)),
            "GetRowColumnSpan" => {
                return Some(
                    [
                        cell.rows.start,
                        cell.columns.start,
                        cell.rows.len(),
                        cell.columns.len(),
                    ]
                    .map(integer)
                    .into(),
                );
            }
            "GetColumnHeaderCells" => self.nodes(self.forest.headers(self.id, Role::ColumnHeader)),
            "GetRowHeaderCells" => self.nodes(self.forest.headers(self.id, Role::RowHeader)),
            _ => return None,
        }])
    }

    fn document(&self, node: &Node, member: &str) -> Option<Value> {
        let url = node.text(Text::Url).unwrap_or_default();
        let all = [
            ("DocType", "html"),
            ("MimeType", "text/html"),
            ("Title", node.name()),
            ("URI", url),
            ("DocURL", url),
        ];
        Some(match member {
            "CurrentPageNumber" | "PageCount" => Value::I32(-1),
            "GetLocale" => node.text(Text::Language).unwrap_or_default().into(),
            "GetAttributeValue" => all
                .iter()
                .find(|it| it.0.eq_ignore_ascii_case(self.string(0)))
                .map_or("", |it| it.1)
                .into(),
            "GetAttributes" => Value::attributes(&all),
            _ => return None,
        })
    }

    /// `GetMatches`, below `roots`.
    fn matches(&self, roots: Vec<Id>) -> Value {
        let (forest, rule) = (self.forest, self.arguments.at(0));
        let (states, roles, kind) = (bits(rule.at(0)), bits(rule.at(4)), |index| {
            rule.at(index).number()
        });
        let matches = |id: &Id| {
            let Some(node) = forest.get(*id) else {
                return false;
            };
            let has_attribute = |all: &[(&str, String)], wanted: &Value| match wanted {
                Value::Entry(it) => all.iter().any(|own| {
                    own.0 == it.0.str()
                        && it
                            .1
                            .str()
                            .split(':')
                            .any(|it| it.eq_ignore_ascii_case(&own.1))
                }),
                _ => false,
            };
            let has_interface = |wanted: &Value| {
                interfaces(node).iter().any(|it| {
                    wanted
                        .str()
                        .rsplit('.')
                        .next()
                        .is_some_and(|wanted| it.eq_ignore_ascii_case(wanted))
                })
            };
            let is_met = meets(
                kind(5),
                roles
                    .iter()
                    .map(|it| *it == roles::role(forest, *id, node).0),
            ) && meets(kind(7), rule.at(6).items().iter().map(has_interface))
                && (states.is_empty() || {
                    let own = roles::states(forest, *id, node);
                    meets(
                        kind(1),
                        states
                            .iter()
                            .map(|it| own.checked_shr(*it).is_some_and(|it| it & 1 != 0)),
                    )
                })
                && (rule.at(2).items().is_empty() || {
                    let own = roles::attributes(forest, *id, node);
                    meets(
                        kind(3),
                        rule.at(2).items().iter().map(|it| has_attribute(&own, it)),
                    )
                });
            is_met != rule.at(8).is_true()
        };
        let (mut found, mut pending) = (Vec::new(), roots);
        pending.reverse();
        while let Some(id) = pending.pop() {
            found.extend(matches(&id).then_some(id));
            if self.arguments.at(3).is_true() {
                pending.extend(forest.exposed_children(id).into_iter().rev());
            }
        }
        if self.number(1) >= 4 {
            found.reverse();
        }
        found.truncate(if self.number(2) > 0 {
            self.number(2) as usize
        } else {
            usize::MAX
        });
        self.nodes(found)
    }

    fn of_node(&mut self, interface: &str, member: &str) -> Option<Vec<Value>> {
        let Some(node) = self.forest.get(self.id) else {
            return (member == "GetState").then(|| vec![state_set(1 << roles::DEFUNCT)]);
        };
        let one = |it: Option<Value>| it.map(|it| vec![it]);
        match interface {
            "Accessible" => one(self.accessible(node, member)),
            "Action" => one(self.action(node, member)),
            "Collection" if member == "GetMatches" => {
                Some(vec![self.matches(self.forest.exposed_children(self.id))])
            }
            "Collection" if member == "GetActiveDescendant" => Some(vec![
                self.node(
                    self.forest
                        .related(self.id, Relation::ActiveDescendant)
                        .next(),
                ),
            ]),
            "Component" | "Image" => self.component(member),
            "Document" => one(self.document(node, member)),
            "EditableText" => self.editable_text(member),
            "Hyperlink" => self.hyperlink(member),
            "Hypertext" => self.hypertext(member),
            "Selection" => one(self.selection(member)),
            "Table" => self.table(member),
            "TableCell" => self.table_cell(member),
            "Text" => self.text(member),
            "Value" => one(self.value(node, member)),
            _ => None,
        }
    }

    fn container(&self, children: Vec<Object>, role: (u32, &str), member: &str) -> Option<Value> {
        Some(match member {
            "Description" | "HelpText" | "Locale" | "AccessibleId" => "".into(),
            "ChildCount" => integer(children.len()),
            "GetChildAtIndex" => self
                .connection
                .reference(children.get(self.number(0) as usize).copied()),
            "GetChildren" => self.connection.references(children),
            "GetRole" => Value::U32(role.0),
            "GetRoleName" | "GetLocalizedRoleName" => role.1.into(),
            "GetAttributes" => Value::attributes(&[]),
            _ => return None,
        })
    }

    fn of_application(&self, member: &str) -> Option<Value> {
        Some(match member {
            "Name" => Value::Str(super::super::desktop::name_of_app()),
            "Parent" => self.connection.desktop.borrow().clone(),
            "GetIndexInParent" => Value::I32(-1),
            "GetRelationSet" => Value::Array("(ua(so))".into(), Vec::new()),
            "GetState" => state_set(0),
            "GetInterfaces" => qualified(&["Accessible", "Application"]),
            // Orca only lets the user browse the pages of toolkits that it knows, and the tree has the shape of this one's.
            "ToolkitName" => "Chromium".into(),
            "Version" => "1.0".into(),
            "AtspiVersion" => "2.1".into(),
            "Id" => Value::I32(self.connection.id.get()),
            "GetLocale" | "GetApplicationBusAddress" => "".into(),
            _ => {
                return self.container(
                    window::ids().into_iter().map(Object::Window).collect(),
                    roles::APPLICATION,
                    member,
                );
            }
        })
    }

    fn of_window(&self, id: u32, member: &str) -> Option<Vec<Value>> {
        let (state, platform, roots) = (
            window::state(id).ok()?,
            window::platform_window(id)?,
            self.forest.roots(id),
        );
        let (geometry, is_on_screen) = (
            platform.geometry(),
            self.number(if member == "GetAccessibleAtPoint" {
                2
            } else {
                0
            }) == 0,
        );
        let [x, y] = if is_on_screen {
            [geometry.x, geometry.y]
        } else {
            [0.; 2]
        };
        let extents = rectangle(
            [x, y, geometry.width, geometry.height].map(|it| (it * geometry.scale) as i32),
        );
        let states = [
            (roles::ACTIVE, state.is_active.get()),
            (roles::ENABLED, true),
            (roles::RESIZABLE, true),
            (roles::SENSITIVE, true),
            (roles::SHOWING, platform.is_visible()),
            (roles::VISIBLE, platform.is_visible()),
        ];
        Some(vec![match member {
            "Name" => (&*state.options.borrow().title).into(),
            "Parent" => self.connection.reference(Some(Object::Application)),
            "GetIndexInParent" => integer(window::ids().iter().position(|it| *it == id)?),
            "GetRelationSet" => Value::Array(
                "(ua(so))".into(),
                vec![Value::Struct(vec![
                    Value::U32(roles::EMBEDS),
                    self.nodes(roots),
                ])],
            ),
            "GetState" => state_set(
                states
                    .iter()
                    .fold(0, |all, it| all | u64::from(it.1) << it.0),
            ),
            "GetInterfaces" => qualified(&["Accessible", "Collection", "Component"]),
            "GetMatches" => self.matches(roots),
            "GetExtents" => Value::Struct(extents),
            "GetPosition" => return Some(extents[..2].to_vec()),
            "GetSize" => return Some(extents[2..].to_vec()),
            "GetLayer" => Value::U32(7),
            "GetAlpha" => Value::F64(1.),
            "GetAccessibleAtPoint" => {
                let point = [
                    self.number(0) as f32 / geometry.scale - x,
                    self.number(1) as f32 / geometry.scale - y,
                ];
                self.node(
                    self.forest
                        .hit_in_window(id, point)
                        .map(|it| self.forest.exposed(it)),
                )
            }
            _ => self.container(
                roots.into_iter().map(Object::Node).collect(),
                roles::FRAME,
                member,
            )?,
        }])
    }

    fn answer(&mut self, object: Object, interface: &str, member: &str) -> Option<Vec<Value>> {
        match object {
            _ if member == "GetApplication" => {
                Some(vec![self.connection.reference(Some(Object::Application))])
            }
            _ if object == Object::Application || interface == "Application" => {
                self.of_application(member).map(|it| vec![it])
            }
            Object::Application => None,
            Object::Window(id) => self.of_window(id, member),
            Object::Node(_) => self.of_node(interface, member),
        }
    }

    fn property(&mut self, object: Object, member: &str) -> Option<Vec<Value>> {
        let arguments = self.arguments;
        let (interface, name) = (
            arguments.at(0).str().rsplit('.').next()?,
            arguments.at(1).str(),
        );
        match (member, name, arguments.at(2)) {
            ("Get", ..) => Some(vec![self.answer(object, interface, name)?.pop()?.variant()]),
            ("GetAll", ..) => {
                let all: Vec<_> = properties(interface)
                    .split(' ')
                    .filter_map(|it| Some((it, self.answer(object, interface, it)?.pop()?)))
                    .collect();
                Some(vec![Value::options(all)])
            }
            ("Set", "Id", value) => {
                self.connection.id.set(value.number()? as i32);
                Some(Vec::new())
            }
            ("Set", "CurrentValue", Value::Variant(value)) => {
                let Value::F64(value) = **value else {
                    return None;
                };
                self.act(Action::SetValue, value.to_string());
                Some(Vec::new())
            }
            _ => None,
        }
    }
}

pub fn answer(connection: &Connection, message: &Message) -> Option<Vec<Value>> {
    if message.is("org.a11y.atspi.Cache", "GetItems") {
        return Some(vec![Value::Array(
            "((so)(so)(so)iiassusau)".into(),
            Vec::new(),
        )]);
    } else if message.is("org.freedesktop.DBus.Peer", "Ping") {
        return Some(Vec::new());
    }
    let object = Object::parse(&message.path)?;
    if object != Object::Application {
        accessibility::note_use();
    }
    if let Object::Window(id) = object {
        accessibility::wait_for_trees(id);
    }
    let (answer, deferred) = accessibility::read(|forest| {
        let id = if let Object::Node(id) = object {
            id
        } else {
            Id::default()
        };
        let mut call = Call {
            connection,
            forest,
            id,
            arguments: &message.body,
            deferred: Vec::new(),
        };
        let answer = match message.interface == PROPERTIES {
            true => call.property(object, &message.member),
            false => call.answer(
                object,
                message.interface.rsplit('.').next().unwrap_or_default(),
                &message.member,
            ),
        };
        (answer, call.deferred)
    });
    deferred.into_iter().for_each(|it| it());
    answer
}
