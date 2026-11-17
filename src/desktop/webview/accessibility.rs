//! The accessibility tree of a page in the web engine, for src/dom/accessibility/remote.rs.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use bun_ui::AccessibilityAction as Action;

use super::view::{Target, View};
use crate::prelude::*;
use crate::task::LocalFuture;
use crate::value::Value;

const SELECTION: &str = r#"(() => {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  if (typeof at?.selectionStart === "number") {
    const ends = [at.selectionStart, at.selectionEnd];
    return [at, at, ...(at.selectionDirection === "backward" ? ends.reverse() : ends)];
  }
  if (at?.nodeName === "INPUT") return [at, at, at.value.length, at.value.length];
  const { anchorNode, focusNode, anchorOffset, focusOffset } = getSelection();
  return [anchorNode, focusNode, anchorOffset, focusOffset];
})()"#;

/// Not every change is painted.
const NEXT_CHANGE: &str = r#"new Promise(resolve => {
  const observer = new MutationObserver(() => resolve(observer.disconnect()));
  (function observe(root) {
    observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
    for (const it of root.querySelectorAll("*")) [it.shadowRoot, it.contentDocument].filter(Boolean).forEach(observe);
  })(document);
})"#;

const ACT: &str = r#"function (action, text) {
  const element = this.nodeType === 1 ? this : this.parentElement;
  if (action === "blur") return element.blur();
  element.focus();
  const at = element.getRootNode().activeElement;
  if (action !== "click" && !element.contains(at) && !at?.contains(element)) return;
  if (action === "replaceSelectedText") return document.execCommand("insertText", false, text);
  if (action === "setValue" && element.type !== "range") return document.execCommand("selectAll"), document.execCommand("insertText", false, text);
  if (action === "setValue") {
    element.value = text;
    for (const type of ["input", "change"]) element.dispatchEvent(new Event(type, { bubbles: true }));
    return;
  }
  const { x, y, width, height } = element.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x + width / 2, clientY: y + height / 2, pointerType: "mouse" };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    element.dispatchEvent(new (type[0] === "p" ? PointerEvent : MouseEvent)(type, { ...init, buttons: +type.endsWith("down") }));
  }
  element.click();
}"#;

const SELECT: &str = r#"function (from, other, to) {
  const field = this.getRootNode().host ?? this;
  if (!/^(INPUT|TEXTAREA)$/.test(field.nodeName)) {
    const within = (node, offset) => Math.min(offset, node.length ?? node.childNodes.length);
    return getSelection().setBaseAndExtent(this, within(this, from), other, within(other, to));
  }
  field.focus();
  field.setSelectionRange(Math.min(from, to), Math.max(from, to), from > to ? "backward" : "forward");
}"#;

unsafe extern "Rust" {
    safe fn __bun_dom_submit_remote_accessibility(
        image: u32,
        zoom: f64,
        head: [u32; 6],
        selected: [&str; 2],
        ids: &[u32],
        strings: &[String],
        numbers: &[f64],
    );
}

const DEEPEST_NODE: u32 = 500;
const DEEPEST_FRAME: u32 = 8;

struct Place {
    target: Rc<Target>,
    element: Value,
    text: String,
}

#[derive(Default)]
pub(super) struct Tree {
    /// By session and `nodeId`.
    ids: RefCell<BTreeMap<(Rc<str>, Box<str>), u32>>,
    places: RefCell<BTreeMap<u32, Rc<Place>>>,
    last_id: Cell<u32>,
}

struct Update<'a> {
    tree: &'a Tree,
    view: &'a Rc<View>,
    /// The page is only there to hold a frame.
    is_wrapper: bool,
    ids: Vec<u32>,
    strings: Vec<String>,
    numbers: Vec<f64>,
    places: BTreeMap<u32, Rc<Place>>,
    elements: BTreeMap<(*const Target, i32), u32>,
    focus: u32,
    last_block: (u32, i32),
    /// The name of the date or the time whose parts are being added.
    date: Option<String>,
    /// Over all frames.
    level: u32,
    /// A renderer that has been taken over may send a tree that is none.
    added: BTreeSet<u32>,
}

/// A document of a snapshot, and its tree.
struct Document<'a> {
    target: &'a Rc<Target>,
    snapshot: &'a Value,
    dom: &'a Value,
    layout: &'a Value,
    text_boxes: &'a Value,
    scrolled: [f64; 2],
    nodes: BTreeMap<&'a str, &'a Value>,
    /// By `backendNodeId`.
    indexes: BTreeMap<i32, usize>,
    ids_of_elements: BTreeMap<i32, u32>,
    owners: BTreeMap<i32, Rc<Target>>,
    /// By the index of the DOM node.
    boxes: BTreeMap<usize, usize>,
    documents: BTreeMap<usize, usize>,
    clickable: BTreeSet<usize>,
    /// By the index of the box.
    lines: BTreeMap<usize, Vec<usize>>,
    visited: RefCell<BTreeSet<&'a str>>,
    root: u32,
    container: u32,
    depth: u32,
}

fn indexes(list: &Value) -> impl Iterator<Item = usize> {
    list.items().iter().map(|it| it.number() as usize)
}

fn rectangle(it: &Value) -> [f64; 4] {
    [0, 1, 2, 3].map(|at| it[at].number())
}

fn is_piece_of_text(node: &Value) -> bool {
    node["role"]["value"].is("InlineTextBox")
}

fn units(text: &Value) -> f64 {
    text.text().encode_utf16().count() as f64
}

impl<'a> Document<'a> {
    fn string(&self, index: &Value) -> &'a str {
        index
            .as_number()
            .filter(|it| *it >= 0.)
            .map_or("", |it| self.snapshot["strings"][it as usize].text())
    }

    fn children(&self, node: &'a Value) -> impl Iterator<Item = &'a Value> {
        node["childIds"]
            .items()
            .iter()
            .filter_map(|it| self.nodes.get(it.text()).copied())
    }

    fn collect_shown(&self, node: &'a Value, level: u32, shown: &mut Vec<&'a Value>) {
        for child in self
            .children(node)
            .filter(|it| level <= DEEPEST_NODE && !is_piece_of_text(it))
        {
            if !self.visited.borrow_mut().insert(child["nodeId"].text()) {
                continue;
            }
            match child["ignored"].is_truthy() {
                true => self.collect_shown(child, level + 1, shown),
                false => shown.push(child),
            }
        }
    }

    fn is_block(&self, at: usize) -> bool {
        let display = self
            .boxes
            .get(&at)
            .map_or("", |it| self.string(&self.layout["styles"][*it][0]));
        !display.is_empty()
            && !["inline", "contents", "ruby"]
                .iter()
                .any(|it| display.starts_with(it))
    }

    fn block_of(&self, at: usize) -> i32 {
        let mut at = at as i32;
        while at >= 0
            && (self.dom["nodeType"][at as usize].int() != 1 || !self.is_block(at as usize))
        {
            // A parent comes before its children.
            at = self.dom["parentIndex"][at as usize].int().min(at - 1);
        }
        at
    }
}

impl Update<'_> {
    fn add_target<'a>(
        &'a mut self,
        target: Rc<Target>,
        container: u32,
        depth: u32,
    ) -> LocalFuture<'a, u32> {
        Box::pin(async move {
            self.view.watch(&target, NEXT_CHANGE).await;
            let styles = record! { "computedStyles": list!["display"] };
            let snapshot = self
                .view
                .ask(&target, "DOMSnapshot.captureSnapshot", styles)
                .await;
            if snapshot.is_truthy() {
                self.add_frame(&target, &snapshot, 0, container, depth)
                    .await
            } else {
                0
            }
        })
    }

    fn add_frame<'a>(
        &'a mut self,
        target: &'a Rc<Target>,
        snapshot: &'a Value,
        index: usize,
        container: u32,
        depth: u32,
    ) -> LocalFuture<'a, u32> {
        Box::pin(async move {
            let document = &snapshot["documents"][index];
            let (dom, layout, text_boxes) = (
                &document["nodes"],
                &document["layout"],
                &document["textBoxes"],
            );
            let (contents, children) = (
                &dom["contentDocumentIndex"],
                target.children.borrow().clone(),
            );
            if self.is_wrapper && depth == 0 {
                return match (
                    indexes(&contents["value"]).next(),
                    children.into_iter().next(),
                ) {
                    (Some(inner), _) => self.add_frame(target, snapshot, inner, 0, 1).await,
                    (None, Some(child)) => self.add_target(child, 0, 1).await,
                    (None, None) => 0,
                };
            }
            let frame =
                record! { "frameId": &snapshot["strings"][document["frameId"].number() as usize] };
            let tree = self
                .view
                .ask(target, "Accessibility.getFullAXTree", frame)
                .await;
            let all = tree["nodes"].items();
            let Some(root) = all
                .first()
                .filter(|it| self.added.insert(self.tree.id_of(target, it)))
            else {
                return 0;
            };
            let mut owners = BTreeMap::default();
            for child in children {
                let owner = self
                    .view
                    .ask(
                        target,
                        "DOM.getFrameOwner",
                        record! { "frameId": &*child.frame },
                    )
                    .await;
                owners.extend(
                    owner["backendNodeId"]
                        .as_number()
                        .map(|it| (it as i32, child)),
                );
            }
            let mut lines: BTreeMap<usize, Vec<usize>> = BTreeMap::default();
            for (line, of) in indexes(&text_boxes["layoutIndex"]).enumerate() {
                lines.entry(of).or_default().push(line);
            }
            let shown = all.iter().filter(|it| !it["ignored"].is_truthy());
            let document = Document {
                target,
                snapshot,
                dom,
                layout,
                text_boxes,
                scrolled: [
                    document["scrollOffsetX"].number(),
                    document["scrollOffsetY"].number(),
                ],
                nodes: all.iter().map(|it| (it["nodeId"].text(), it)).collect(),
                indexes: dom["backendNodeId"]
                    .items()
                    .iter()
                    .map(Value::int)
                    .zip(0..)
                    .collect(),
                ids_of_elements: shown
                    .filter_map(|it| {
                        Some((
                            it["backendDOMNodeId"].as_number()? as i32,
                            self.tree.id_of(target, it),
                        ))
                    })
                    .collect(),
                owners,
                boxes: indexes(&layout["nodeIndex"]).zip(0..).collect(),
                documents: indexes(&contents["index"])
                    .zip(indexes(&contents["value"]))
                    .collect(),
                clickable: indexes(&dom["isClickable"]["index"]).collect(),
                lines,
                visited: BTreeSet::from([root["nodeId"].text()]).into(),
                root: self.tree.id_of(target, root),
                container,
                depth,
            };
            self.add(&document, root, [0.; 4], 0).await
        })
    }

    fn add<'a, 'b: 'a>(
        &'a mut self,
        of: &'a Document<'b>,
        node: &'b Value,
        around: [f64; 4],
        around_at: usize,
    ) -> LocalFuture<'a, u32> {
        Box::pin(async move {
            let (id, element) = (self.tree.id_of(of.target, node), &node["backendDOMNodeId"]);
            let own = element
                .as_number()
                .and_then(|it| of.indexes.get(&(it as i32)).copied());
            let (at, own_box) = (
                own.unwrap_or(around_at),
                own.and_then(|it| of.boxes.get(&it)),
            );
            let rect = own_box.map_or(around, |it| rectangle(&of.layout["bounds"][*it]));
            let mut shown = Vec::new();
            if self.level <= DEEPEST_NODE {
                of.collect_shown(node, self.level, &mut shown);
            }
            let (role, name, value) = (node["role"]["value"].text(), &node["name"], &node["value"]);
            let is_source =
                |it: &&Value| it["value"]["value"].is_truthy() && !it["superseded"].is_truthy();
            let block = (of.root, of.block_of(at));
            let mut properties = vec![
                (
                    "name".to_owned(),
                    if role == "StaticText" {
                        name["value"].text()
                    } else {
                        name["value"].text().trim()
                    }
                    .to_owned(),
                ),
                (
                    "description".to_owned(),
                    node["description"]["value"].text().to_owned(),
                ),
                (
                    "nameFrom".to_owned(),
                    name["sources"]
                        .items()
                        .iter()
                        .find(is_source)
                        .map_or("", |it| it["type"].text())
                        .to_owned(),
                ),
                (
                    "startsParagraph".to_owned(),
                    (block != self.last_block).to_string(),
                ),
            ];
            // The protocol has the name of the part where that of the whole belongs.
            if let Some(date) = &self.date
                && let Some((first, second)) =
                    (properties[0].1).split_at_checked(properties[0].1.len() / 2)
                && second.strip_prefix(' ') == Some(first)
            {
                properties[0].1 = match date.is_empty() {
                    true => first.to_owned(),
                    false => format!("{first} {date}"),
                };
            }
            let is_date = matches!(role, "Date" | "DateTime" | "InputTime");
            if is_date {
                self.date = Some(properties[0].1.clone());
            }
            if value.is_truthy() {
                properties.insert(2, ("value".to_owned(), value["value"].display()));
            }
            if shown.is_empty() {
                self.last_block = block;
            }
            let mut relations = Vec::new();
            for property in node["properties"].items() {
                let (name, value) = (property["name"].text(), &property["value"]);
                if value["relatedNodes"].is_list() {
                    let related = value["relatedNodes"].items().iter();
                    let ids = related.filter_map(|it| {
                        of.ids_of_elements
                            .get(&it["backendDOMNodeId"].int())
                            .copied()
                    });
                    relations.push((name, ids.collect::<Vec<u32>>()));
                } else {
                    properties.push((name.to_owned(), value["value"].display()));
                }
                if name == "focused" && value["value"].is_truthy() {
                    self.focus = id;
                }
            }
            if own.is_some() {
                properties.extend([
                    (
                        "nodeName".to_owned(),
                        of.string(&of.dom["nodeName"][at]).to_owned(),
                    ),
                    (
                        "isClickable".to_owned(),
                        of.clickable.contains(&at).to_string(),
                    ),
                    ("isBlock".to_owned(), of.is_block(at).to_string()),
                ]);
                for [name, value] in of.dom["attributes"][at].items().as_chunks().0 {
                    properties.push((format!("@{}", of.string(name)), of.string(value).to_owned()));
                }
            }
            let pieces: Vec<&Value> = of
                .children(node)
                .filter(|it| is_piece_of_text(it))
                .collect();
            let lines = own_box
                .and_then(|it| of.lines.get(it))
                .map_or(&[][..], |it| it);
            let runs: Vec<(f64, [f64; 4])> = match pieces.len() {
                0 => Vec::new(),
                count if count == lines.len() => (pieces.iter().zip(lines))
                    .map(|(piece, line)| {
                        (
                            units(&piece["name"]["value"]),
                            rectangle(&of.text_boxes["bounds"][*line]),
                        )
                    })
                    .collect(),
                _ => vec![(units(&name["value"]), rect)],
            };

            let mut children = Vec::new();
            self.level += 1;
            for child in shown {
                children.push(self.add(of, child, rect, at).await);
            }
            self.date.take_if(|_| is_date);
            let other = element
                .as_number()
                .and_then(|it| of.owners.get(&(it as i32)));
            let inner = match (other, own.and_then(|it| of.documents.get(&it))) {
                _ if of.depth > DEEPEST_FRAME => 0,
                (Some(other), _) => self.add_target(Rc::clone(other), id, of.depth + 1).await,
                (None, Some(&inner)) => {
                    self.add_frame(of.target, of.snapshot, inner, id, of.depth + 1)
                        .await
                }
                (None, None) => 0,
            };
            children.extend((inner != 0).then_some(inner));
            self.level -= 1;

            let (container, scrolled) = if id == of.root {
                (of.container, of.scrolled)
            } else {
                (of.root, [0.; 2])
            };
            let counts = [
                properties.len(),
                relations.len(),
                children.len(),
                runs.len(),
            ]
            .map(|it| it as u32);
            self.ids
                .extend([id, container].into_iter().chain(counts).chain(children));
            self.strings.push(role.to_owned());
            self.strings
                .extend(properties.into_iter().flat_map(<[String; 2]>::from));
            for (name, related) in relations {
                self.ids
                    .extend([related.len() as u32].into_iter().chain(related));
                self.strings.push(name.to_owned());
            }
            self.numbers.extend(rect.into_iter().chain(scrolled));
            self.numbers.extend(
                runs.into_iter()
                    .flat_map(|it| [it.0].into_iter().chain(it.1)),
            );
            let text = [&value["value"], &name["value"]]
                .into_iter()
                .find(|it| !it.is_nothing());
            let place = Place {
                target: Rc::clone(of.target),
                element: if element.is_nothing() {
                    &of.dom["backendNodeId"][at]
                } else {
                    element
                }
                .clone(),
                text: text.map(Value::display).unwrap_or_default(),
            };
            self.places.insert(id, Rc::new(place));
            if let Some(element) = element.as_number() {
                self.elements
                    .insert((Rc::as_ptr(of.target), element as i32), id);
            }
            id
        })
    }
}

async fn selection(view: &View, target: &Target) -> [u32; 4] {
    let group = record! { "objectGroup": "accessibility" };
    let list = view
        .ask(
            target,
            "Runtime.evaluate",
            record! { "expression": SELECTION, "silent": true }.and(&group),
        )
        .await;
    let own = record! { "objectId": &list["result"]["objectId"], "ownProperties": true };
    let items = view.ask(target, "Runtime.getProperties", own).await;
    let mut all = [0; 4];
    for (slot, item) in all.iter_mut().zip(items["result"].items()) {
        let value = &item["value"];
        *slot = match value["objectId"].is_truthy() {
            true => view
                .ask(target, "DOM.describeNode", value.pick(&["objectId"]))
                .await["node"]["backendNodeId"]
                .number(),
            false => value["value"].number(),
        } as u32;
    }
    view.engine
        .command("Runtime.releaseObjectGroup", group, &target.session);
    all
}

impl Tree {
    fn id_of(&self, target: &Target, node: &Value) -> u32 {
        let key = (Rc::clone(&target.session), node["nodeId"].text().into());
        *self.ids.borrow_mut().entry(key).or_insert_with(|| {
            self.last_id.update(|it| it + 1);
            self.last_id.get()
        })
    }

    pub(super) async fn update(&self, view: &Rc<View>, root: Rc<Target>, is_wrapper: bool) {
        let mut update = Update {
            tree: self,
            view,
            is_wrapper,
            ids: Vec::new(),
            strings: Vec::new(),
            numbers: Vec::new(),
            places: BTreeMap::default(),
            elements: BTreeMap::default(),
            focus: 0,
            last_block: (0, 0),
            date: None,
            level: 0,
            added: BTreeSet::default(),
        };
        let root_id = update.add_target(Rc::clone(&root), 0, 0).await;
        if root_id == 0 {
            return;
        }
        let Update {
            ids,
            strings,
            numbers,
            places,
            elements,
            focus,
            ..
        } = update;
        let with_focus = places.get(&focus).map_or(root, |it| Rc::clone(&it.target));
        let [anchor, end, from, to] = selection(view, &with_focus).await;
        let ends = [anchor, end].map(|it| {
            elements
                .get(&(Rc::as_ptr(&with_focus), it as i32))
                .copied()
                .unwrap_or(0)
        });
        let head = [
            root_id,
            if focus == 0 { root_id } else { focus },
            ends[0],
            from,
            ends[1],
            to,
        ];
        let selected = ends.map(|it| places.get(&it).map_or("", |it| &it.text));
        __bun_dom_submit_remote_accessibility(
            view.image,
            1. / view.scale,
            head,
            selected,
            &ids,
            &strings,
            &numbers,
        );
        self.ids
            .borrow_mut()
            .retain(|_, it| places.contains_key(it));
        self.places.replace(places);
    }

    fn place(&self, id: u32) -> Option<Rc<Place>> {
        self.places.borrow().get(&id).cloned()
    }

    async fn object_of(view: &View, place: &Place) -> Value {
        let resolved = view
            .ask(
                &place.target,
                "DOM.resolveNode",
                record! { "backendNodeId": &place.element, "objectGroup": "accessibility" },
            )
            .await;
        resolved["object"].pick(&["objectId"])
    }

    async fn call(
        view: &View,
        on: &Place,
        function: &str,
        arguments: Value,
    ) -> Option<&'static str> {
        let call = record! { "functionDeclaration": function, "arguments": arguments, "userGesture": true };
        view.ask(
            &on.target,
            "Runtime.callFunctionOn",
            call.and(&Tree::object_of(view, on).await),
        )
        .await;
        None
    }

    /// Returns the key that has to be pressed.
    pub(super) async fn perform(
        &self,
        view: &View,
        node: u32,
        action: Action,
        [a, b, c, d]: [u32; 4],
        text: &str,
    ) -> Option<&'static str> {
        let place = self.place(node)?;
        let element = record! { "backendNodeId": &place.element };
        let act = |name: &str| list![record! { "value": name }, record! { "value": text }];
        let key = match action {
            Action::ScrollIntoView => {
                view.ask(&place.target, "DOM.scrollIntoViewIfNeeded", element)
                    .await;
                return None;
            }
            Action::SelectText => {
                let (first, last) = (self.place(a)?, self.place(c)?);
                let units_before = |it: &Place, offset: u32| {
                    record! { "value": it.text[..it.text.floor_char_boundary(offset as usize)].encode_utf16().count() }
                };
                let ends = list![
                    units_before(&first, b),
                    Tree::object_of(view, &last).await,
                    units_before(&last, d)
                ];
                return Tree::call(view, &first, SELECT, ends).await;
            }
            Action::Focus => None,
            Action::Increment => Some("ArrowUp"),
            Action::Decrement => Some("ArrowDown"),
            Action::ShowContextMenu => Some("ContextMenu"),
            Action::Cancel => Some("Escape"),
            Action::Blur => return Tree::call(view, &place, ACT, act("blur")).await,
            Action::SetValue => return Tree::call(view, &place, ACT, act("setValue")).await,
            Action::ReplaceSelectedText => {
                return Tree::call(view, &place, ACT, act("replaceSelectedText")).await;
            }
            _ => return Tree::call(view, &place, ACT, act("click")).await,
        };
        view.ask(&place.target, "DOM.focus", element).await;
        key
    }
}
