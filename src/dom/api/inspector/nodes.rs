//! The domain DOM.

use super::*;
use crate::api::markup::{parse_fragment, serialize_document, serialize_outer};
use crate::api::range::{self, Point};
use crate::api::ui::{Ui, layout};
use crate::name::Set;

/// What the client has been told about a node.
struct Told {
    parent: u32,
    children: Option<Vec<u32>>,
    count: usize,
    attributes: Vec<(Atom, u64)>,
    data: u64,
    /// The shadow root, the contents of a template and what is generated.
    parts: Vec<u32>,
}

#[derive(Default)]
pub(super) struct Reported {
    told: RefCell<Map<u32, Told>>,
    version: Cell<u64>,
    looks: Cell<u32>,
    was_loading: Cell<bool>,
    top_layer: RefCell<Vec<u32>>,
    searches: RefCell<Map<u32, Vec<u32>>>,
    last_search: Cell<u32>,
}

impl Reported {
    /// Whether there was anything.
    pub(super) fn forget(&self) -> bool {
        drop((self.searches.take(), self.top_layer.take()));
        !self.told.take().is_empty()
    }

    /// Of nodes.
    pub(super) fn ids(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self
            .told
            .borrow()
            .keys()
            .copied()
            .filter(|it| it.is_multiple_of(1 << SLOT_BITS))
            .collect();
        ids.sort_unstable();
        ids
    }

    fn knows(&self, id: u32) -> bool {
        self.told.borrow().contains_key(&id)
    }

    fn forget_subtree(&self, id: u32) {
        let (mut told, mut pending) = (self.told.borrow_mut(), vec![id]);
        while let Some(id) = pending.pop() {
            pending.extend(
                told.remove(&id)
                    .into_iter()
                    .flat_map(|it| it.children.into_iter().flatten().chain(it.parts)),
            );
        }
    }
}

pub(super) fn hash(text: &DomString) -> u64 {
    bun_wyhash::hash(text.to_utf8().as_bytes())
}

fn data_of(node: &Node) -> u64 {
    node.as_character_data().map_or(0, |it| it.with_data(hash))
}

pub(super) fn name_of<'a>(heap: &JsHeap<'a>, node: &'a Node) -> String {
    describe(global_of(heap), node.get_node_name(heap).to_js())
}

fn shown_children(node: &Node) -> impl Iterator<Item = &Node> {
    node.children().filter(|it| {
        !it.as_text()
            .is_some_and(|it| it.with_data(|it| it.units().all(is_ascii_whitespace)))
    })
}

fn attributes_of<'a>(cx: Cx<'_, 'a>, element: &'a Element) -> Vec<(Atom, DomString)> {
    element.flush_style(cx);
    element
        .attrs()
        .into_iter()
        .map(|(name, value)| (name.qualified(), value))
        .collect()
}

fn flat(attributes: &[(Atom, DomString)]) -> Value {
    attributes
        .iter()
        .flat_map(|it| [(&*it.0.as_utf8()).into(), utf8(&it.1)])
        .collect()
}

fn parts_of<'a>(cx: Cx<'_, 'a>, node: &'a Node) -> Vec<u32> {
    let Some(element) = node.as_element() else {
        return Vec::new();
    };
    let generated = node.read(|tree, id| tree.element(id).map_or([0; 4], |it| it.generated));
    let generated = (0..GENERATED.len())
        .filter(|it| generated[*it] != 0)
        .map(|slot| {
            Target {
                node,
                slot: Some(slot),
            }
            .id()
        });
    let contents = element.template_contents(cx).map(|it| id_of(it));
    element
        .shadow_root()
        .map(|it| id_of(it))
        .into_iter()
        .chain(contents)
        .chain(generated)
        .collect()
}

fn depth_in(params: &Value, otherwise: u32) -> u32 {
    params["depth"]
        .as_number()
        .map_or(otherwise, |it| if it < 0.0 { u32::MAX } else { it as u32 })
}

pub(super) fn quad([left, top, width, height]: [f64; 4]) -> Value {
    let [right, bottom] = [left + width, top + height];
    list![left, top, right, top, right, bottom, left, bottom]
}

fn everything_in(doc: &Doc) -> impl Iterator<Item = &Node> {
    doc.shadow_including_descendants()
        .filter(|it| !it.has(NodeFlags::USER_AGENT))
}

impl Inspector {
    /// With a `parent`, which may be 0, the client keeps what it is told.
    fn describe<'a>(
        &self,
        cx: Cx<'_, 'a>,
        target: Target<'a>,
        parent: Option<u32>,
        depth: u32,
    ) -> Value {
        self.describe_within(cx, target, parent, depth, 200)
    }

    /// `room` is for how many levels there is.
    fn describe_within<'a>(
        &self,
        cx: Cx<'_, 'a>,
        target: Target<'a>,
        parent: Option<u32>,
        depth: u32,
        room: u32,
    ) -> Value {
        let (id, node) = (target.id(), target.node);
        let mut told = Told {
            parent: parent.unwrap_or(0),
            children: None,
            count: 0,
            attributes: Vec::new(),
            data: 0,
            parts: Vec::new(),
        };
        let mut it = record! { "nodeId": parent.map_or(0, |_| id), "backendNodeId": id, "parentId": parent.filter(|it| *it != 0) };
        if let (Some(slot), Some(name)) = (target.slot, target.pseudo()) {
            parent.inspect(|_| _ = self.nodes.told.borrow_mut().insert(id, told));
            let about = record! { "nodeType": 1, "nodeName": &*name, "localName": name, "nodeValue": "", "pseudoType": GENERATED[slot].1, "childNodeCount": 0, "attributes": list![] };
            return it.and(&about);
        }
        it.set("nodeType", node.node_type() as u32);
        it.set("nodeName", name_of(&cx.heap, node));
        it.set(
            "localName",
            node.as_element()
                .map(|it| it.local().as_utf8().into_owned())
                .unwrap_or_default(),
        );
        it.set("nodeValue", utf8(&node.node_value().unwrap_or_default()));
        told.data = data_of(node);
        told.parts = parts_of(cx, node);
        if let Some(element) = node.as_element() {
            let attributes = attributes_of(cx, element);
            it.set("attributes", flat(&attributes));
            told.attributes = attributes
                .into_iter()
                .map(|it| (it.0, hash(&it.1)))
                .collect();
            let is_root = node.is_rendered() && node.doc().document_element() == Some(element);
            it.set(
                "frameId",
                if is_root {
                    Some(self.session.frame())
                } else {
                    self.session.frame_in(node.to_js())
                },
            );
            it.set("isSVG", (element.ns() == Ns::Svg).then_some(true));
            let (mut roots, mut generated) = (Vec::new(), Vec::new());
            for part in told
                .parts
                .iter()
                .filter_map(|it| Target::with_id(&cx.heap, *it))
                .collect::<smallvec::SmallVec<[_; 6]>>()
            {
                let described =
                    self.describe_within(cx, part, parent.map(|_| id), 0, room.saturating_sub(1));
                match (part.slot, part.node.as_shadow_root()) {
                    (Some(_), _) => generated.push(described),
                    (_, Some(_)) => roots.push(described),
                    _ => it.set("templateContent", described),
                }
            }
            it.set(
                "shadowRoots",
                Some(roots).filter(|it| !it.is_empty()).map(Value::List),
            );
            it.set(
                "pseudoElements",
                Some(generated).filter(|it| !it.is_empty()).map(Value::List),
            );
            let brief = |node: &'a Node| record! { "nodeType": node.node_type() as u32, "nodeName": name_of(&cx.heap, node), "backendNodeId": id_of(node) };
            it.set(
                "distributedNodes",
                node.has(NodeFlags::SLOT)
                    .then(|| node.assigned_nodes().map(brief).collect::<Value>()),
            );
        } else if let Some(doc) = node.as_doc() {
            it.set("documentURL", utf8(&doc.url()));
            it.set("baseURL", utf8(&doc.base_url()));
            it.set("xmlVersion", if doc.is_html_doc() { "" } else { "1.0" });
            it.set(
                "compatibilityMode",
                if doc.quirks() {
                    "QuirksMode"
                } else {
                    "NoQuirksMode"
                },
            );
        } else if let Some(root) = node.as_shadow_root() {
            it.set(
                "shadowRootType",
                if node.has(NodeFlags::USER_AGENT) {
                    "user-agent"
                } else if root.is(ShadowFlags::CLOSED) {
                    "closed"
                } else {
                    "open"
                },
            );
        } else if node.node_type() == NodeType::Doctype {
            it.set("publicId", node.with_inert(|it| utf8(&it.data)));
            it.set("systemId", node.with_inert(|it| utf8(&it.system_id)));
        }
        let slot = node.assigned_slot().map(|it| record! { "nodeType": 1, "nodeName": name_of(&cx.heap, it), "backendNodeId": id_of(it) });
        it.set("assignedSlot", slot);
        if node.is_element() || node.as_doc().is_some() || node.as_fragment().is_some() {
            told.count = shown_children(node).count();
            it.set("childNodeCount", told.count);
            let is_only_text = node
                .first_child()
                .is_some_and(|it| it.as_text().is_some() && it.next_sibling().is_none());
            if is_only_text || room > 0 && (depth > 0 || !told.parts.is_empty()) {
                let children = Rooted::from_nodes(&cx.heap, shown_children(node));
                told.children = Some(children.iter().map(id_of).collect());
                let [depth, room] = [depth, room].map(|it| it.saturating_sub(1));
                it.set(
                    "children",
                    children
                        .iter()
                        .map(|it| {
                            self.describe_within(cx, it.into(), parent.map(|_| id), depth, room)
                        })
                        .collect::<Value>(),
                );
            }
        }
        parent.inspect(|_| _ = self.nodes.told.borrow_mut().insert(id, told));
        it
    }

    fn push_children<'a>(&self, cx: Cx<'_, 'a>, node: &'a Node, depth: u32) {
        let (id, children) = (
            id_of(node),
            Rooted::from_nodes(&cx.heap, shown_children(node)),
        );
        let were_pushed = self
            .nodes
            .told
            .borrow()
            .get(&id)
            .map(|it| it.children.is_some());
        match were_pushed {
            Some(true) if depth > 1 => children
                .iter()
                .for_each(|it| self.push_children(cx, it, depth.min(200) - 1)),
            Some(false) => {
                let nodes = children
                    .iter()
                    .map(|it| self.describe(cx, it.into(), Some(id), depth - 1))
                    .collect::<Value>();
                self.nodes
                    .told
                    .borrow_mut()
                    .get_mut(&id)
                    .into_iter()
                    .for_each(|it| it.children = Some(children.iter().map(id_of).collect()));
                self.emit(
                    "DOM.setChildNodes",
                    record! { "parentId": id, "nodes": nodes },
                );
            }
            _ => {}
        }
    }

    /// With its ancestors. Returns the id, or 0.
    pub(super) fn push<'a>(&self, cx: Cx<'_, 'a>, target: Target<'a>) -> u32 {
        let unknown = core::iter::successors(Some(target.node), |it| it.parent_or_host())
            .take_while(|it| !self.nodes.knows(id_of(it)));
        let unknown = Rooted::from_nodes(&cx.heap, unknown);
        for node in (0..unknown.len()).rev().filter_map(|it| unknown.get(it)) {
            match node.parent_or_host() {
                Some(parent) => self.push_children(cx, parent, 1),
                None if node.as_doc().is_some_and(|it| it.is_rendered()) => return 0,
                None => {
                    let root = self.describe(cx, node.into(), Some(0), 0);
                    self.emit(
                        "DOM.setChildNodes",
                        record! { "parentId": 0, "nodes": list![root] },
                    );
                }
            }
        }
        Some(target.id())
            .filter(|it| self.nodes.knows(*it))
            .unwrap_or(0)
    }

    fn push_all<'a>(&self, cx: Cx<'_, 'a>, nodes: impl Iterator<Item = &'a Node>) -> Value {
        Rooted::from_nodes(&cx.heap, nodes)
            .iter()
            .map(|it| self.push(cx, it.into()))
            .collect()
    }

    fn compare_attributes<'a>(&self, cx: Cx<'_, 'a>, id: u32, element: &'a Element) {
        let now = attributes_of(cx, element);
        let hashes: Vec<_> = now.iter().map(|it| (it.0.clone(), hash(&it.1))).collect();
        let before = self
            .nodes
            .told
            .borrow_mut()
            .get_mut(&id)
            .filter(|it| it.attributes != hashes)
            .map(|it| core::mem::replace(&mut it.attributes, hashes.clone()));
        let Some(before) = before else { return };
        for (name, _) in before
            .iter()
            .filter(|old| !hashes.iter().any(|it| it.0 == old.0))
        {
            self.emit(
                "DOM.attributeRemoved",
                record! { "nodeId": id, "name": &*name.as_utf8() },
            );
        }
        for ((name, value), _) in now.iter().zip(&hashes).filter(|it| !before.contains(it.1)) {
            self.emit(
                "DOM.attributeModified",
                record! { "nodeId": id, "name": &*name.as_utf8(), "value": utf8(value) },
            );
        }
    }

    /// Leaves what is still there, in the same order.
    fn remove_children(&self, id: u32, now: &[u32]) {
        let Some(before) = self
            .nodes
            .told
            .borrow_mut()
            .get_mut(&id)
            .and_then(|it| it.children.take())
        else {
            return;
        };
        let places: Map<u32, usize> = now.iter().copied().zip(0..).collect();
        let in_order = |is_backwards: bool| {
            let mut last = None;
            let mut keeps = |it: &u32| {
                places
                    .get(it)
                    .filter(|it| last.is_none_or(|last| (**it > last) != is_backwards))
                    .map(|it| last = Some(*it))
                    .is_some()
            };
            if is_backwards {
                before
                    .iter()
                    .rev()
                    .filter(|it| keeps(it))
                    .copied()
                    .collect::<Set<u32>>()
            } else {
                before.iter().filter(|it| keeps(it)).copied().collect()
            }
        };
        let kept = core::cmp::max_by_key(in_order(true), in_order(false), Set::len);
        for gone in before.iter().filter(|it| !kept.contains(*it)) {
            self.nodes.forget_subtree(*gone);
            self.emit(
                "DOM.childNodeRemoved",
                record! { "parentNodeId": id, "nodeId": *gone },
            );
        }
        self.nodes
            .told
            .borrow_mut()
            .get_mut(&id)
            .into_iter()
            .for_each(|it| {
                it.children = Some(
                    before
                        .iter()
                        .copied()
                        .filter(|it| kept.contains(it))
                        .collect(),
                )
            });
    }

    fn insert_children<'a>(&self, cx: Cx<'_, 'a>, id: u32, now: &[u32]) {
        for (child, previous) in now
            .iter()
            .copied()
            .zip([0].into_iter().chain(now.iter().copied()))
        {
            let is_there = self
                .nodes
                .told
                .borrow()
                .get(&child)
                .is_some_and(|it| it.parent == id);
            if let Some(target) = Target::with_id(&cx.heap, child).filter(|_| !is_there) {
                self.nodes.forget_subtree(child);
                let node = self.describe(cx, target, Some(id), 0);
                self.emit(
                    "DOM.childNodeInserted",
                    record! { "parentNodeId": id, "previousNodeId": previous, "node": node },
                );
            }
        }
        self.nodes
            .told
            .borrow_mut()
            .get_mut(&id)
            .into_iter()
            .for_each(|it| it.children = Some(now.to_vec()));
    }

    fn compare_parts<'a>(&self, cx: Cx<'_, 'a>, id: u32, node: &'a Node) {
        let now = parts_of(cx, node);
        let before = self
            .nodes
            .told
            .borrow_mut()
            .get_mut(&id)
            .filter(|it| it.parts != now)
            .map(|it| core::mem::replace(&mut it.parts, now.clone()));
        let Some(before) = before else { return };
        for gone in before.iter().copied().filter(|it| !now.contains(it)) {
            self.nodes.forget_subtree(gone);
            self.emit(
                "DOM.pseudoElementRemoved",
                record! { "parentId": id, "pseudoElementId": gone },
            );
        }
        self.push_children(cx, node, 1);
        for part in now.into_iter().filter(|it| !before.contains(it)) {
            let Some(part) = Target::with_id(&cx.heap, part) else {
                continue;
            };
            let described = self.describe(cx, part, Some(id), 0);
            match part.slot {
                Some(_) => self.emit(
                    "DOM.pseudoElementAdded",
                    record! { "parentId": id, "pseudoElement": described },
                ),
                None => self.emit(
                    "DOM.shadowRootPushed",
                    record! { "hostId": id, "root": described },
                ),
            }
        }
    }

    pub(super) fn compare_nodes<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
        let reported = &self.nodes;
        if !reported.knows(id_of(doc)) {
            return false;
        }
        let is_loading = doc.ready_state() == ReadyState::Loading;
        if reported.was_loading.replace(is_loading) && !is_loading {
            reported.forget();
            self.emit("DOM.documentUpdated", Value::empty());
            return true;
        }
        // Text that was blank shows up without a new version.
        reported.looks.update(|it| it + 1);
        let has_moved = reported.version.replace(doc.version()) != doc.version()
            || reported.looks.get().is_multiple_of(16);
        let (ids, mut changed) = (reported.ids(), Vec::new());
        for id in ids.iter().copied().filter(|_| has_moved) {
            let Some(Target { node, .. }) =
                Target::with_id(&cx.heap, id).filter(|_| reported.knows(id))
            else {
                continue;
            };
            let (is_expanded, count) = reported
                .told
                .borrow()
                .get(&id)
                .map_or((false, 0), |it| (it.children.is_some(), it.count));
            if is_expanded {
                let now: Vec<u32> = shown_children(node).map(id_of).collect();
                if reported
                    .told
                    .borrow()
                    .get(&id)
                    .is_some_and(|it| it.children.as_ref() != Some(&now))
                {
                    self.remove_children(id, &now);
                    changed.push((id, now));
                }
            } else if let Some(now) = Some(shown_children(node).count()).filter(|it| *it != count) {
                reported
                    .told
                    .borrow_mut()
                    .get_mut(&id)
                    .into_iter()
                    .for_each(|it| it.count = now);
                self.emit(
                    "DOM.childNodeCountUpdated",
                    record! { "nodeId": id, "childNodeCount": now },
                );
            }
        }
        changed
            .into_iter()
            .filter(|it| reported.knows(it.0))
            .for_each(|(id, now)| self.insert_children(cx, id, &now));
        for id in ids {
            let Some(Target { node, .. }) =
                Target::with_id(&cx.heap, id).filter(|_| reported.knows(id))
            else {
                continue;
            };
            if let Some(element) = node.as_element() {
                self.compare_attributes(cx, id, element);
                self.compare_parts(cx, id, node);
            } else if reported
                .told
                .borrow_mut()
                .get_mut(&id)
                .is_some_and(|it| core::mem::replace(&mut it.data, data_of(node)) != it.data)
            {
                self.emit("DOM.characterDataModified", record! { "nodeId": id, "characterData": utf8(&node.node_value().unwrap_or_default()) });
            }
        }
        let top_layer: Vec<u32> = Ui::of(doc)
            .into_iter()
            .flat_map(|it| it.top_layer().iter())
            .map(|it| id_of(it))
            .collect();
        if reported.top_layer.replace(top_layer) != *reported.top_layer.borrow() {
            self.emit("DOM.topLayerElementsUpdated", Value::empty());
        }
        true
    }

    fn set_attributes_as_text<'a>(
        &self,
        cx: Cx<'_, 'a>,
        element: &'a Element,
        params: &Value,
    ) -> Outcome {
        let (text, context) = (
            params["text"].text(),
            element.doc().create_html(&cx.heap, atom!("div")),
        );
        let markup = if element.ns() == Ns::Svg {
            format!("<svg {text}></svg>")
        } else {
            format!("<span {text}></span>")
        };
        let parsed = parse_fragment(
            cx,
            context,
            &DomString::from_utf8(&markup),
            context,
            Default::default(),
        );
        let parsed = or_message(cx, parsed)?
            .first_child()
            .and_then(Node::as_element)
            .ok_or("Could not parse value as attributes")?
            .attrs();
        let edited = params["name"]
            .as_text()
            .map(Atom::new)
            .filter(|old| !parsed.iter().any(|it| it.0.qualified() == *old));
        parsed
            .into_iter()
            .for_each(|(name, value)| element.set_attr_ns(cx, name, value));
        edited
            .and_then(|it| element.attr_name_by_qualified_name(&it))
            .inspect(|it| _ = element.remove_attr_ns(cx, it));
        empty()
    }

    fn rename<'a>(&self, cx: Cx<'_, 'a>, element: &'a Element, name: &str) -> Outcome {
        let (name, parent) = (
            Atom::new(name),
            element.parent().ok_or("Node has no parent")?,
        );
        let name = QualName::validate_and_extract(
            &cx.heap,
            element.ns(),
            &if element.ns() == Ns::Html {
                name.to_ascii_lowercase()
            } else {
                name
            },
            NameFor::Element,
        );
        let name = or_message(cx, name)?;
        let made =
            element
                .doc()
                .create_element(cx, name, None, Synchronous::Yes, JSValue::UNDEFINED);
        attributes_of(cx, element);
        element
            .attrs()
            .into_iter()
            .for_each(|(name, value)| made.set_attr_ns(cx, name, value));
        for child in Rooted::from_nodes(&cx.heap, element.children()).iter() {
            let moved = append(cx, child, made);
            or_message(cx, moved)?;
        }
        let replaced = replace(cx, element, made, parent);
        or_message(cx, replaced)?;
        self.compare_nodes(cx, parent.doc());
        Ok(record! { "nodeId": self.push(cx, (&**made).into()) })
    }

    fn set_outer_html<'a>(&self, cx: Cx<'_, 'a>, child: &'a Node, markup: &str) -> Outcome {
        let parent = child
            .parent()
            .filter(|it| it.as_doc().is_none())
            .ok_or("Cannot edit this node as HTML")?;
        let context = parent
            .as_element()
            .unwrap_or_else(|| parent.body_as_context(&cx.heap));
        let result = parse_fragment(
            cx,
            context,
            &DomString::from_utf8(markup),
            context,
            Default::default(),
        )
        .and_then(|it| replace(cx, child, it, parent));
        or_message(cx, result).and_then(|_| empty())
    }

    fn place<'a>(&self, cx: Cx<'_, 'a>, node: &'a Node, params: &Value) -> Outcome {
        let find = |name: &str| Some(Target::with_id(&cx.heap, params[name].number() as u32)?.node);
        let (parent, before) = (
            find("targetNodeId").ok_or("No node with given id found")?,
            find("insertBeforeNodeId"),
        );
        let inserted = pre_insert(cx, node, parent, before);
        or_message(cx, inserted)?;
        self.compare_nodes(cx, parent.doc());
        Ok(record! { "nodeId": self.push(cx, node.into()) })
    }

    /// For text, tags and attributes, and as a selector.
    fn search<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc, query: &str) -> Outcome {
        let query = query.trim();
        let lower = query.to_lowercase();
        let has = |text: &str| {
            bun_core::strings::contains(text.to_lowercase().as_bytes(), lower.as_bytes())
        };
        let tag = lower.strip_prefix('<').unwrap_or(&lower);
        let (starts, ends, tag) = (
            tag.len() < lower.len(),
            tag.ends_with('>'),
            tag.trim_end_matches('>'),
        );
        let is_tag = |name: &str| match (starts, ends) {
            (true, true) => name == tag,
            (true, false) => name.starts_with(tag),
            (false, true) => name.ends_with(tag),
            (false, false) => has(name),
        };
        let matches = |it: &&Node| match it.as_element() {
            Some(element) => {
                is_tag(&element.local().as_utf8().to_lowercase())
                    || element
                        .attrs()
                        .iter()
                        .any(|it| has(&it.0.local.as_utf8()) || has(&it.1.to_utf8()))
            }
            None => it
                .as_character_data()
                .is_some_and(|it| it.with_data(|it| has(&it.to_utf8()))),
        };
        let mut found: Vec<u32> = everything_in(doc).filter(matches).map(id_of).collect();
        let (mut seen, selector) = (
            found.iter().copied().collect::<Set<u32>>(),
            DomString::from_utf8(query).to_js(&cx.heap),
        );
        let scopes = Rooted::from_nodes(
            &cx.heap,
            [&**doc]
                .into_iter()
                .chain(everything_in(doc).filter(|it| it.as_shadow_root().is_some())),
        );
        for scope in scopes.iter() {
            let selected = scope.query_selector_all(cx, selector);
            found.extend(
                or_message(cx, selected)
                    .into_iter()
                    .flat_map(List::nodes)
                    .map(id_of)
                    .filter(|it| seen.insert(*it)),
            );
        }
        self.nodes.last_search.update(|it| it + 1);
        let result = record! { "searchId": self.nodes.last_search.get().to_string(), "resultCount": found.len() };
        self.nodes
            .searches
            .borrow_mut()
            .insert(self.nodes.last_search.get(), found);
        Ok(result)
    }

    fn push_ids<'a>(&self, cx: Cx<'_, 'a>, ids: impl Iterator<Item = u32>) -> Outcome {
        Ok(
            record! { "nodeIds": ids.map(|it| Target::with_id(&cx.heap, it).map_or(0, |it| self.push(cx, it))).collect::<Value>() },
        )
    }

    /// As `1,HTML,1,BODY`. `a` and `u` stand for shadow roots.
    fn follow_path<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc, path: &str) -> Outcome {
        let steps: Vec<_> = bun_core::strings::split(path.as_bytes(), b",").collect();
        let found = steps
            .as_chunks()
            .0
            .iter()
            .try_fold(&**doc, |node: &'a Node, [index, name]| match *index {
                b"a" | b"u" => node.as_element()?.shadow_root().map(|it| -> &Node { it }),
                index => shown_children(node)
                    .nth(core::str::from_utf8(index).ok()?.parse().ok()?)
                    .filter(|it| name_of(&cx.heap, it).as_bytes() == *name),
            });
        Ok(
            record! { "nodeId": self.push(cx, found.ok_or("No node with given path found")?.into()) },
        )
    }

    fn find_by_style<'a>(&self, cx: Cx<'_, 'a>, root: &'a Node, wanted: &[Value]) -> Outcome {
        let all = Rooted::from_nodes(
            &cx.heap,
            root.shadow_including_descendants()
                .filter(|it| it.is_element() && !it.has(NodeFlags::USER_AGENT)),
        );
        let matches = |it: &&'a Node| {
            it.as_element().is_some_and(|element| {
                wanted.iter().any(|it| {
                    layout::computed(cx, element, it["name"].text())
                        == it["value"].text().as_bytes()
                })
            })
        };
        let found: Vec<u32> = all.iter().filter(matches).map(id_of).collect();
        self.push_ids(cx, found.into_iter())
    }

    fn container_of<'a>(&self, cx: Cx<'_, 'a>, node: &'a Node, name: &str) -> Outcome {
        let ancestors = Rooted::from_nodes(
            &cx.heap,
            core::iter::successors(node.flat_parent(), |it| it.flat_parent()),
        );
        for it in ancestors.iter().filter_map(Node::as_element) {
            let names = layout::computed(cx, it, "container-name");
            if layout::computed(cx, it, "container-type") != b"normal"
                && (name.is_empty()
                    || bun_core::strings::split(&names, b" ").any(|it| it == name.as_bytes()))
            {
                return Ok(record! { "nodeId": self.push(cx, (&**it).into()) });
            }
        }
        empty()
    }

    fn box_model<'a>(&self, cx: Cx<'_, 'a>, target: Target<'a>) -> Outcome {
        let it = overlay::box_model(cx, target).ok_or("Could not compute box model.")?;
        let [content, padding, border, margin] = it
            .quads
            .map(|it| it.as_flattened().iter().copied().collect::<Value>());
        Ok(
            record! { "model": record! { "content": content, "padding": padding, "border": border, "margin": margin, "width": it.size[0].round(), "height": it.size[1].round() } },
        )
    }

    fn about_node<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &str,
        target: Target<'a>,
        params: &Value,
    ) -> Outcome {
        let (node, text) = (target.node, |name: &str| {
            DomString::from_utf8(params[name].text())
        });
        let is_edit = name.starts_with("set") || name.starts_with("remove") || name == "moveTo";
        if is_edit && (target.slot.is_some() || node.has(NodeFlags::USER_AGENT)) {
            return Err(
                "Cannot edit pseudo elements and nodes from user-agent shadow trees".into(),
            );
        }
        match name {
            "describeNode" => {
                Ok(record! { "node": self.describe(cx, target, None, depth_in(params, 0)) })
            }
            "requestNode" => Ok(record! { "nodeId": self.push(cx, target) }),
            "requestChildNodes" => {
                self.push_children(cx, node, depth_in(params, 1).max(1));
                empty()
            }
            "getAttributes" => {
                Ok(record! { "attributes": flat(&attributes_of(cx, target.element()?)) })
            }
            "setAttributeValue" => {
                let (element, name) = (target.element()?, Atom::new(params["name"].text()));
                let is_valid = validate_attribute_name(&cx.heap, &name);
                or_message(cx, is_valid)?;
                element.set_attr_ns(
                    cx,
                    element
                        .attr_name_by_qualified_name(&name)
                        .unwrap_or_else(|| QualName::plain(name)),
                    text("value"),
                );
                empty()
            }
            "setAttributesAsText" => self.set_attributes_as_text(cx, target.element()?, params),
            "removeAttribute" => {
                let element = target.element()?;
                element
                    .attr_name_by_qualified_name(&Atom::new(params["name"].text()))
                    .inspect(|it| _ = element.remove_attr_ns(cx, it));
                empty()
            }
            "setNodeName" => self.rename(cx, target.element()?, params["name"].text()),
            "setNodeValue" => {
                node.as_character_data()
                    .ok_or("Can only set value of text nodes or processing instructions")?
                    .replace_all_data(cx, &text("value"));
                empty()
            }
            "removeNode" => {
                node.parent().ok_or("Cannot remove detached node")?;
                remove(cx, node, Observers::Notify);
                empty()
            }
            "getOuterHTML" => {
                let markup = match node.as_doc() {
                    Some(doc) => serialize_document(cx, doc).map(|it| it.0),
                    None => serialize_outer(cx, node),
                };
                Ok(record! { "outerHTML": utf8(&or_message(cx, markup)?) })
            }
            "setOuterHTML" => self.set_outer_html(cx, node, params["outerHTML"].text()),
            "moveTo" => self.place(cx, node, params),
            "copyTo" => {
                let copy = clone_node(cx, node, node.doc(), true, None, JSValue::UNDEFINED);
                let copy = or_message(cx, copy)?;
                self.place(cx, copy, params)
            }
            "querySelector" => {
                let found = node.query_selector(cx, text("selector").to_js(&cx.heap));
                Ok(
                    record! { "nodeId": or_message(cx, found)?.map_or(0, |it| self.push(cx, (&**it).into())) },
                )
            }
            "querySelectorAll" => {
                let found = node.query_selector_all(cx, text("selector").to_js(&cx.heap));
                let found = or_message(cx, found)?;
                Ok(record! { "nodeIds": self.push_all(cx, found.nodes()) })
            }
            "getBoxModel" => self.box_model(cx, target),
            "getContentQuads" => {
                let rects = match node.as_element() {
                    Some(element) => element.client_rects(cx),
                    None => range::client_rects(
                        cx,
                        Point::new(node, 0),
                        Point::new(node, node.length()),
                    ),
                };
                Ok(record! { "quads": rects.into_iter().map(quad).collect::<Value>() })
            }
            "collectClassNamesFromSubtree" => {
                let mut names = Set::<String>::default();
                node.inclusive_descendants()
                    .filter_map(Node::as_element)
                    .for_each(|it| {
                        _ = it.with_attr(atom!("class"), |it| {
                            names.extend(it.split_ascii_whitespace().map(String::from))
                        })
                    });
                Ok(record! { "classNames": names.into_iter().collect::<Value>() })
            }
            "getNodesForSubtreeByStyle" => {
                self.find_by_style(cx, node, params["computedStyles"].items())
            }
            _ => self.container_of(cx, node, params["containerName"].text()),
        }
    }

    pub(super) fn about_nodes<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        name: &str,
        params: &Value,
    ) -> Option<Outcome> {
        let search = || params["searchId"].text().parse().unwrap_or(0);
        Some(match name {
            "getDocument" => {
                self.nodes.forget();
                self.nodes
                    .was_loading
                    .set(doc.ready_state() == ReadyState::Loading);
                Ok(
                    record! { "root": self.describe(cx, (&**doc).into(), Some(0), depth_in(params, 2)) },
                )
            }
            "disable" => {
                self.nodes.forget();
                empty()
            }
            "pushNodesByBackendIdsToFrontend" => self.push_ids(
                cx,
                params["backendNodeIds"]
                    .items()
                    .iter()
                    .map(|it| it.number() as u32),
            ),
            "pushNodeByPathToFrontend" => self.follow_path(cx, doc, params["path"].text()),
            "performSearch" => self.search(cx, doc, params["query"].text()),
            "getSearchResults" => {
                let found = self.nodes.searches.borrow().get(&search()).and_then(|it| {
                    Some(
                        it.get(
                            params["fromIndex"].number() as usize
                                ..params["toIndex"].number() as usize,
                        )?
                        .to_vec(),
                    )
                });
                found.map_or_else(
                    || Err("Invalid search result range".into()),
                    |it| self.push_ids(cx, it.into_iter()),
                )
            }
            "discardSearchResults" => {
                self.nodes.searches.borrow_mut().remove(&search());
                empty()
            }
            "getNodeForLocation" => {
                match layout::hit_test(cx, doc, [params["x"].number(), params["y"].number()])
                    .map(Node::out_of_control)
                {
                    Some(node) => Ok(
                        record! { "backendNodeId": id_of(node), "frameId": self.session.frame(), "nodeId": self.push(cx, node.into()) },
                    ),
                    None => Err("No node found at given location".into()),
                }
            }
            "getTopLayerElements" => Ok(
                record! { "nodeIds": self.push_all(cx, Ui::of(doc).into_iter().flat_map(|it| it.top_layer().iter()).map(|it| &**it)) },
            ),
            "describeNode"
            | "requestNode"
            | "requestChildNodes"
            | "getAttributes"
            | "setAttributeValue"
            | "setAttributesAsText"
            | "removeAttribute"
            | "setNodeName"
            | "setNodeValue"
            | "removeNode"
            | "getOuterHTML"
            | "setOuterHTML"
            | "moveTo"
            | "copyTo"
            | "querySelector"
            | "querySelectorAll"
            | "getBoxModel"
            | "getContentQuads"
            | "collectClassNamesFromSubtree"
            | "getNodesForSubtreeByStyle"
            | "getContainerForNode" => self
                .target(&cx.heap, params)
                .and_then(|it| self.about_node(cx, name, it, params)),
            _ => return None,
        })
    }
}
