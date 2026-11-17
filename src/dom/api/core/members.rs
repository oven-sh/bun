//! What core.bind.ts declares.

use bun_jsc::bindgen::{self, ClassStructure, JsAtom, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSString, JSValue};

use super::{NodeFlags as F, *};
use crate::api::trusted::Trusted;
use crate::generated_bindgen::core::{
    ChildNode, DomComment as Comment, ElementLookups, GetRootNodeOptions, NonDocumentTypeChildNode,
    NonElementParentNode, ParentNode, ProcessingInstruction, Slottable,
};

type Any<'a> = JsLocal<'a>;
type Str<'a> = JsLocal<'a, JSString>;
type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

#[inline]
fn string<'a>(heap: &JsHeap<'a>, value: Str<'a>) -> Result<'a, DomString> {
    DomString::from_js_string(heap, value)
}

fn string_or_empty<'a>(heap: &JsHeap<'a>, value: Option<Str<'a>>) -> Result<'a, DomString> {
    value.map_or_else(|| Ok(DomString::default()), |it| string(heap, it))
}

/// The empty string is none.
fn optional_atom<'a>(heap: &JsHeap<'a>, value: Option<Str<'a>>) -> Result<'a, Option<Atom>> {
    Ok(value
        .map(|it| Atom::from_js_string(heap, it))
        .transpose()?
        .filter(|it| !it.is_empty()))
}

fn namespace<'a>(heap: &JsHeap<'a>, value: Option<Str<'a>>) -> Result<'a, Ns> {
    Ok(Ns::from_uri(optional_atom(heap, value)?.as_ref()))
}

fn as_string<'a>(heap: &JsHeap<'a>, value: JSValue) -> Str<'a> {
    JsLocal::new(heap, value)
        .as_string()
        .unwrap_or_else(|| Atom::EMPTY.to_js(heap))
}

impl Node {
    pub(crate) fn get_node_type(&self) -> i32 {
        self.node_type() as i32
    }

    pub(crate) fn inspect<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if self.is_element() {
            return seams::serialize_outer(cx, self);
        }
        let name = self.get_node_name(&cx.heap);
        let Some(data) = self.as_character_data().map(CharacterData::data) else {
            return Ok(name.to_js());
        };
        let text = format!(
            "{} {:?}",
            DomString::from_js_string(&cx.heap, name)?.to_utf8(),
            data.to_utf8()
        );
        Ok(DomString::from_utf8(&text).to_js(&cx.heap).to_js())
    }

    pub(crate) fn get_node_name<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        match self.node_type() {
            NodeType::Element => self
                .as_element()
                .map_or(Atom::EMPTY, Element::tag_name)
                .to_js(heap),
            NodeType::Text => Atom::of(atom!("#text")).to_js(heap),
            NodeType::Comment => Atom::of(atom!("#comment")).to_js(heap),
            NodeType::CData => Atom::of(atom!("#cdata-section")).to_js(heap),
            NodeType::Document => Atom::of(atom!("#document")).to_js(heap),
            NodeType::Fragment => Atom::of(atom!("#document-fragment")).to_js(heap),
            _ => self
                .with_inert(|it| it.name.clone())
                .qualified()
                .to_js(heap),
        }
    }

    pub(crate) fn get_base_uri<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.doc().base_url().to_js(heap)
    }

    pub(crate) fn get_is_connected(&self) -> bool {
        self.is_connected()
    }

    pub(crate) fn get_owner_document(&self) -> Option<&Doc> {
        (!self.kind().is_document()).then(|| self.doc())
    }

    pub(crate) fn get_child_nodes<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.child_nodes(heap)
    }

    pub(crate) fn get_parent_element(&self) -> Option<&Element> {
        self.parent_element()
    }

    pub(crate) fn node_value<'a>(&'a self, cx: Cx<'_, 'a>) -> Option<DomString> {
        let Some(attr) = self.downcast::<Attr>() else {
            return self.as_character_data().map(CharacterData::data);
        };
        attr.owner().into_iter().for_each(|it| it.flush_style(cx));
        Some(attr.value())
    }

    fn change_value<'a>(&'a self, cx: Cx<'_, 'a>, value: DomString) -> Result<'a> {
        if let Some(data) = self.as_character_data() {
            data.replace_all_data(cx, &value);
        } else if let Some(attr) = self.downcast::<Attr>() {
            attr.change_value(cx, value)?;
        }
        Ok(())
    }

    pub(crate) fn get_node_value<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Option<Str<'a>>> {
        Ok(self.node_value(cx).map(|it| it.to_js(&cx.heap)))
    }

    pub(crate) fn set_node_value<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: Option<Str<'a>>,
    ) -> Result<'a> {
        let value = string_or_empty(&cx.heap, value)?;
        self.change_value(cx, value)
    }

    pub(crate) fn get_text_content<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Option<Str<'a>>> {
        let text = if self.is_element() || self.as_fragment().is_some() {
            Some(self.descendant_text_content())
        } else {
            self.node_value(cx)
        };
        Ok(text.map(|it| it.to_js(&cx.heap)))
    }

    pub(crate) fn set_text_content<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: Option<Str<'a>>,
    ) -> Result<'a> {
        let value = string_or_empty(&cx.heap, value)?;
        match self.is_element() || self.as_fragment().is_some() {
            true => string_replace_all(cx, value, self),
            false => self.change_value(cx, value)?,
        }
        Ok(())
    }

    pub(crate) fn get_root_node(&self, options: &GetRootNodeOptions) -> &Node {
        if options.composed {
            self.shadow_including_root()
        } else {
            self.root()
        }
    }

    pub(crate) fn has_child_nodes(&self) -> bool {
        self.has_children()
    }

    pub(crate) fn get_first_child(&self) -> Option<&Node> {
        self.first_child()
    }

    pub(crate) fn get_last_child(&self) -> Option<&Node> {
        self.last_child()
    }

    pub(crate) fn js_normalize<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        normalize(cx, self);
        Ok(())
    }

    pub(crate) fn clone_node<'a>(&'a self, cx: Cx<'_, 'a>, subtree: bool) -> Result<'a, &'a Node> {
        if self.has(F::SHADOW_ROOT) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "ShadowRoot nodes are not clonable.",
            ));
        }
        clone_node(cx, self, self.doc(), subtree, None, JSValue::NULL)
    }

    fn equals_without_children<'a>(&'a self, cx: Cx<'_, 'a>, other: &'a Node) -> bool {
        if self.node_type() != other.node_type() {
            return false;
        }
        if let (Some(a), Some(b)) = (self.as_element(), other.as_element()) {
            [a, b].into_iter().for_each(|it| it.flush_style(cx));
            let attributes = a.attrs();
            return a.qual_name() == b.qual_name()
                && attributes.len() as u32 == b.attr_count()
                && attributes
                    .into_iter()
                    .all(|(name, value)| b.attr_ns(&name.ns, &name.local) == Some(value));
        }
        let inert = |it: &Node| {
            it.with_inert(|it| {
                (
                    it.name.ns.clone(),
                    it.name.local.clone(),
                    it.system_id.clone(),
                )
            })
        };
        match self.kind() {
            Kind::Doctype => {
                inert(self) == inert(other)
                    && self.with_inert(|it| it.data.clone())
                        == other.with_inert(|it| it.data.clone())
            }
            Kind::Attr | Kind::Instruction => {
                inert(self) == inert(other) && self.node_value(cx) == other.node_value(cx)
            }
            _ => self.node_value(cx) == other.node_value(cx),
        }
    }

    pub(crate) fn is_equal_node<'a>(&'a self, cx: Cx<'_, 'a>, other: &'a Node) -> bool {
        let (mut a, mut b) = (Some(self), Some(other));
        while let (Some(x), Some(y)) = (a, b) {
            let shape = |it: &Node, root: &Node| {
                (
                    it.first_child().is_some(),
                    it != root && it.next_sibling().is_some(),
                )
            };
            if shape(x, self) != shape(y, other) || !x.equals_without_children(cx, y) {
                return false;
            }
            (a, b) = (x.following(Some(self)), y.following(Some(other)));
        }
        true
    }

    pub(crate) fn js_is_equal_node<'a>(&'a self, cx: Cx<'_, 'a>, other: Option<&'a Node>) -> bool {
        other.is_some_and(|it| self.is_equal_node(cx, it))
    }

    pub(crate) fn is_same_node(&self, other: Option<&Node>) -> bool {
        other == Some(self)
    }

    pub(crate) fn compare_document_position(&self, other: &Node) -> i32 {
        const DISCONNECTED: i32 = 1;
        const PRECEDING: i32 = 2;
        const FOLLOWING: i32 = 4;
        const CONTAINS: i32 = 8;
        const CONTAINED_BY: i32 = 16;
        const IMPLEMENTATION_SPECIFIC: i32 = 32;
        if self == other {
            return 0;
        }
        let (own_attr, other_attr) = (self.downcast::<Attr>(), other.downcast::<Attr>());
        let this = own_attr.and_then(Attr::owner).map_or(self, |it| it);
        let other = other_attr.and_then(Attr::owner).map_or(other, |it| it);
        if this == other {
            let (Some(own_attr), Some(other_attr), Some(element)) =
                (own_attr, other_attr, this.as_element())
            else {
                return if own_attr.is_some() {
                    CONTAINS | PRECEDING
                } else {
                    CONTAINED_BY | FOLLOWING
                };
            };
            let index = |attr: &Attr| {
                element
                    .attrs()
                    .iter()
                    .position(|it| it.0 == attr.qual_name())
            };
            return IMPLEMENTATION_SPECIFIC
                | if index(other_attr) < index(own_attr) {
                    PRECEDING
                } else {
                    FOLLOWING
                };
        }
        match other.compare_order(this) {
            core::cmp::Ordering::Equal => {
                DISCONNECTED
                    | IMPLEMENTATION_SPECIFIC
                    | if core::ptr::from_ref(other.root()) < core::ptr::from_ref(this.root()) {
                        PRECEDING
                    } else {
                        FOLLOWING
                    }
            }
            core::cmp::Ordering::Less if other_attr.is_none() && other.contains(this) => {
                CONTAINS | PRECEDING
            }
            core::cmp::Ordering::Less => PRECEDING,
            core::cmp::Ordering::Greater if own_attr.is_none() && this.contains(other) => {
                CONTAINED_BY | FOLLOWING
            }
            core::cmp::Ordering::Greater => FOLLOWING,
        }
    }

    pub(crate) fn js_contains(&self, other: Option<&Node>) -> bool {
        other.is_some_and(|it| self.contains(it))
    }

    /// Where the search for a namespace or a prefix begins.
    fn element_for_lookup(&self) -> Option<&Element> {
        match (self.as_doc(), self.downcast::<Attr>()) {
            (Some(doc), _) => doc.document_element(),
            (_, Some(attr)) => attr.owner(),
            _ => self.as_element().or_else(|| self.parent_element()),
        }
    }

    /// <https://dom.spec.whatwg.org/#locate-a-namespace>
    pub(crate) fn locate_namespace(&self, prefix: Option<&Atom>) -> Ns {
        let Some(first) = self.element_for_lookup() else {
            return Ns::None;
        };
        match prefix.map(Atom::known) {
            Some(atom!("xml")) => return Ns::Xml,
            Some(atom!("xmlns")) => return Ns::Xmlns,
            _ => {}
        }
        let declares = |name: &QualName| {
            name.ns == Ns::Xmlns
                && prefix.map_or_else(
                    || name.prefix.is_none() && name.local == atom!("xmlns"),
                    |it| name.prefix.is_some() && name.local == *it,
                )
        };
        for element in core::iter::successors(Some(first), |it| it.parent_element()) {
            if element.ns() != Ns::None && element.prefix().as_ref() == prefix {
                return element.ns();
            }
            if let Some((_, value)) = element.attrs().into_iter().find(|it| declares(&it.0)) {
                return Ns::from_uri(Some(&Atom::from_string(&value)));
            }
        }
        Ns::None
    }

    pub(crate) fn lookup_prefix<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
    ) -> Result<'a, Option<Str<'a>>> {
        let Some(uri) = optional_atom(heap, ns)? else {
            return Ok(None);
        };
        let (ns, text) = (Ns::from_uri(Some(&uri)), uri.to_dom_string());
        let declared = |it: &Element| {
            it.attrs()
                .into_iter()
                .find(|it| {
                    it.0.prefix.as_ref().is_some_and(|it| *it == atom!("xmlns")) && it.1 == text
                })
                .map(|it| it.0.local)
        };
        let mut elements =
            core::iter::successors(self.element_for_lookup(), |it| it.parent_element());
        Ok(elements
            .find_map(|it| {
                it.prefix()
                    .filter(|_| it.ns() == ns)
                    .or_else(|| declared(it))
            })
            .map(|it| it.to_js(heap)))
    }

    pub(crate) fn lookup_namespace_uri<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        prefix: Option<Str<'a>>,
    ) -> Result<'a, Option<Str<'a>>> {
        Ok(self
            .locate_namespace(optional_atom(heap, prefix)?.as_ref())
            .uri()
            .map(|it| it.to_js(heap)))
    }

    pub(crate) fn is_default_namespace<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
    ) -> Result<'a, bool> {
        Ok(self.locate_namespace(None) == namespace(heap, ns)?)
    }

    pub(crate) fn insert_before<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        child: Option<&'a Node>,
    ) -> Result<'a, &'a Node> {
        pre_insert(cx, node, self, child).map(|()| node)
    }

    pub(crate) fn append_child<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
    ) -> Result<'a, &'a Node> {
        append(cx, node, self).map(|()| node)
    }

    pub(crate) fn replace_child<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        child: &'a Node,
    ) -> Result<'a, &'a Node> {
        replace(cx, child, node, self).map(|()| child)
    }

    pub(crate) fn remove_child<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        child: &'a Node,
    ) -> Result<'a, &'a Node> {
        pre_remove(cx, child, self).map(|()| child)
    }
}

/// <https://dom.spec.whatwg.org/#convert-nodes-into-a-node>, with the conversion of `(Node or DOMString)`.
fn convert_nodes<'a>(cx: Cx<'_, 'a>, values: &[Any<'a>], doc: &'a Doc) -> Result<'a, Rooted<'a>> {
    let mut nodes = Rooted::default();
    for value in values {
        let node = match Node::from_js(&cx.heap, value.to_js()) {
            Some(node) => node,
            None => {
                let text = DomString::from_js(cx, *value)?;
                doc.create_text(&cx.heap, text)
            }
        };
        nodes.push(&cx.heap, node);
    }
    Ok(nodes)
}

fn into_one_node<'a>(cx: Cx<'_, 'a>, nodes: &Rooted<'a>, doc: &'a Doc) -> Result<'a, &'a Node> {
    if let Some(only) = nodes.get(0).filter(|_| nodes.len() == 1) {
        return Ok(only);
    }
    let fragment = doc.create_fragment(&cx.heap);
    nodes.iter().try_for_each(|it| append(cx, it, fragment))?;
    Ok(fragment)
}

fn to_node<'a>(cx: Cx<'_, 'a>, values: &[Any<'a>], doc: &'a Doc) -> Result<'a, &'a Node> {
    let nodes = convert_nodes(cx, values, doc)?;
    into_one_node(cx, &nodes, doc)
}

impl ParentNode {
    pub(crate) fn get_children<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.children_collection(heap)
    }

    pub(crate) fn get_first_element_child(&self) -> Option<&Element> {
        self.element_children().next()
    }

    pub(crate) fn get_last_element_child(&self) -> Option<&Element> {
        core::iter::successors(self.last_child(), |it| it.previous_sibling())
            .find_map(Node::as_element)
    }

    pub(crate) fn get_child_element_count<'a>(&'a self, heap: &JsHeap<'a>) -> u32 {
        const FEW: usize = 32;
        if self.has(NodeFlags::HAS_BARE_CHILDREN) {
            return self.read(|tree, id| tree.element_children(id).count() as u32);
        }
        match self.element_children().take(FEW).count() {
            FEW => {
                HTMLCollection::from_value(self.children_collection(heap)).map_or(0, |it| it.len())
            }
            count => count as u32,
        }
    }

    pub(crate) fn prepend<'a>(&'a self, cx: Cx<'_, 'a>, nodes: &[Any<'a>]) -> Result<'a> {
        let node = to_node(cx, nodes, self.doc())?;
        pre_insert(cx, node, self, self.first_child())
    }

    pub(crate) fn append<'a>(&'a self, cx: Cx<'_, 'a>, nodes: &[Any<'a>]) -> Result<'a> {
        let node = to_node(cx, nodes, self.doc())?;
        append(cx, node, self)
    }

    pub(crate) fn replace_children<'a>(&'a self, cx: Cx<'_, 'a>, nodes: &[Any<'a>]) -> Result<'a> {
        let node = to_node(cx, nodes, self.doc())?;
        let parent: &Node = match self.as_doc() {
            Some(doc) => doc.new_windowless(cx, Kind::Document),
            None => self,
        };
        ensure_pre_insert_validity(&cx.heap, node, parent, None, Validity::Inserting)?;
        replace_all(cx, Some(node), self);
        Ok(())
    }

    pub(crate) fn move_before<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        child: Option<&'a Node>,
    ) -> Result<'a> {
        move_before(cx, node, self, child)
    }

    pub(crate) fn js_query_selector<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        selectors: &[u8],
    ) -> Result<'a, Option<&'a Element>> {
        self.query_selector(cx, selectors)
    }
}

impl ParentNode {
    pub(crate) fn js_query_selector_all<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        selectors: &[u8],
    ) -> Result<'a, &'a NodeList> {
        let found = self.query_selector_all(cx, selectors)?;
        Ok(NodeList::from_list(&cx.heap, found))
    }
}

impl ElementLookups {
    pub(crate) fn get_elements_by_tag_name<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: JsAtom<'a>,
    ) -> JSValue {
        self.elements_by_tag_name(heap, Atom::from_impl(name.get()))
    }

    pub(crate) fn get_elements_by_tag_name_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<JsAtom<'a>>,
        local: JsAtom<'a>,
    ) -> &'a HTMLCollection {
        self.elements_by_tag_name_ns(
            heap,
            ns.map(|it| Atom::from_impl(it.get()))
                .filter(|it| !it.is_empty())
                .as_ref(),
            Atom::from_impl(local.get()),
        )
    }

    pub(crate) fn get_elements_by_class_name<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        names: JsAtom<'a>,
    ) -> JSValue {
        self.elements_by_class_name(heap, Atom::from_impl(names.get()))
    }
}

impl NonElementParentNode {
    pub(crate) fn get_element_by_id<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        id: Str<'a>,
    ) -> Result<'a, Option<&'a Element>> {
        Ok(self.element_by_id(&Atom::from_js_string(heap, id)?))
    }
}

impl ChildNode {
    pub(crate) fn before<'a>(&'a self, cx: Cx<'_, 'a>, nodes: &[Any<'a>]) -> Result<'a> {
        let nodes = convert_nodes(cx, nodes, self.doc())?;
        let Some(parent) = self.parent() else {
            return Ok(());
        };
        let previous = self.previous_siblings().find(|it| !nodes.contains(it));
        let node = into_one_node(cx, &nodes, self.doc())?;
        pre_insert(
            cx,
            node,
            parent,
            previous.map_or_else(|| parent.first_child(), Node::next_sibling),
        )
    }

    pub(crate) fn after<'a>(&'a self, cx: Cx<'_, 'a>, nodes: &[Any<'a>]) -> Result<'a> {
        let nodes = convert_nodes(cx, nodes, self.doc())?;
        let Some(parent) = self.parent() else {
            return Ok(());
        };
        let next = self.next_siblings().find(|it| !nodes.contains(it));
        let node = into_one_node(cx, &nodes, self.doc())?;
        pre_insert(cx, node, parent, next)
    }

    pub(crate) fn replace_with<'a>(&'a self, cx: Cx<'_, 'a>, nodes: &[Any<'a>]) -> Result<'a> {
        let nodes = convert_nodes(cx, nodes, self.doc())?;
        let Some(parent) = self.parent() else {
            return Ok(());
        };
        let next = self.next_siblings().find(|it| !nodes.contains(it));
        let node = into_one_node(cx, &nodes, self.doc())?;
        if self.parent() == Some(parent) {
            replace(cx, self, node, parent)
        } else {
            pre_insert(cx, node, parent, next)
        }
    }

    pub(crate) fn remove<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        remove(cx, self, Observers::Notify);
        Ok(())
    }
}

impl NonDocumentTypeChildNode {
    pub(crate) fn get_previous_element_sibling(&self) -> Option<&Element> {
        self.previous_siblings().find_map(Node::as_element)
    }

    pub(crate) fn get_next_element_sibling(&self) -> Option<&Element> {
        self.next_siblings().find_map(Node::as_element)
    }
}

impl Slottable {
    pub(crate) fn get_assigned_slot(&self) -> Option<&Element> {
        self.assigned_slot().filter(|_| {
            self.parent_element()
                .and_then(Element::get_shadow_root)
                .is_some()
        })
    }
}

impl CharacterData {
    pub(crate) fn get_data<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Str<'a>> {
        Ok(self.data().to_js(&cx.heap))
    }

    pub(crate) fn set_data<'a>(&'a self, cx: Cx<'_, 'a>, value: Str<'a>) -> Result<'a> {
        let value = string(&cx.heap, value)?;
        self.replace_all_data(cx, &value);
        Ok(())
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.data_length()
    }

    pub(crate) fn substring_data<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        offset: u32,
        count: u32,
    ) -> Result<'a, Str<'a>> {
        if offset > self.data_length() {
            return Err(dom_error(
                heap,
                DomError::IndexSizeError,
                "The offset is greater than the node's length.",
            ));
        }
        Ok(self.data().substring(offset, count).to_js(heap))
    }

    pub(crate) fn js_append_data<'a>(&'a self, cx: Cx<'_, 'a>, data: Str<'a>) -> Result<'a> {
        let data = string(&cx.heap, data)?;
        self.append_data(cx, &data);
        Ok(())
    }

    pub(crate) fn insert_data<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        offset: u32,
        data: Str<'a>,
    ) -> Result<'a> {
        self.js_replace_data(cx, offset, 0, data)
    }

    pub(crate) fn delete_data<'a>(&'a self, cx: Cx<'_, 'a>, offset: u32, count: u32) -> Result<'a> {
        self.replace_data(cx, offset, count, &DomString::default())
    }

    pub(crate) fn js_replace_data<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        offset: u32,
        count: u32,
        data: Str<'a>,
    ) -> Result<'a> {
        let data = string(&cx.heap, data)?;
        self.replace_data(cx, offset, count, &data)
    }
}

impl Text {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Text>,
        data: Option<Str<'a>>,
    ) -> Result<'a, &'a Text> {
        let (data, doc) = (
            string_or_empty(&cx.heap, data)?,
            seams::current_document(cx)?,
        );
        Ok(doc.construct(
            &cx.heap,
            structure,
            Kind::Text,
            crate::tree::Data::Text(data.into()),
        ))
    }

    pub(crate) fn split_text<'a>(&'a self, cx: Cx<'_, 'a>, offset: u32) -> Result<'a, &'a Text> {
        self.split(cx, offset)
    }

    pub(crate) fn get_whole_text<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        let first = self
            .previous_siblings()
            .map_while(Node::as_text)
            .last()
            .unwrap_or(self);
        let mut all = StringBuilder::default();
        core::iter::once(first)
            .chain(first.next_siblings().map_while(Node::as_text))
            .for_each(|it| it.with_data(|it| all.push(it)));
        all.finish().to_js(heap)
    }
}

impl Comment {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Comment>,
        data: Option<Str<'a>>,
    ) -> Result<'a, &'a Comment> {
        let (data, doc) = (
            string_or_empty(&cx.heap, data)?,
            seams::current_document(cx)?,
        );
        let inert = crate::tree::Inert {
            name: QualName::plain(Atom::EMPTY),
            data,
            system_id: DomString::default(),
        };
        Ok(doc.construct(
            &cx.heap,
            structure,
            Kind::Comment,
            crate::tree::Data::Inert(Box::new(inert)),
        ))
    }
}

impl ProcessingInstruction {
    pub(crate) fn get_target<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.get_node_name(heap)
    }
}

impl DocumentType {
    pub(crate) fn get_name<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.get_node_name(heap)
    }

    pub(crate) fn get_public_id<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.with_inert(|it| it.data.clone()).to_js(heap)
    }

    pub(crate) fn get_system_id<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.with_inert(|it| it.system_id.clone()).to_js(heap)
    }
}

impl DocumentFragment {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, DocumentFragment>,
    ) -> Result<'a, &'a DocumentFragment> {
        let doc = seams::current_document(cx)?;
        Ok(doc.construct(&cx.heap, structure, Kind::Fragment, crate::tree::Data::Root))
    }
}

impl ShadowRoot {
    pub(crate) fn get_mode<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        Atom::of(if self.is(ShadowFlags::CLOSED) {
            atom!("closed")
        } else {
            atom!("open")
        })
        .to_js(heap)
    }

    pub(crate) fn get_host(&self) -> &Element {
        self.host_element()
    }

    pub(crate) fn get_delegates_focus(&self) -> bool {
        self.is(ShadowFlags::DELEGATES_FOCUS)
    }

    pub(crate) fn get_slot_assignment<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        Atom::of(if self.is(ShadowFlags::MANUAL_SLOTS) {
            atom!("manual")
        } else {
            atom!("named")
        })
        .to_js(heap)
    }

    pub(crate) fn get_clonable(&self) -> bool {
        self.is(ShadowFlags::CLONABLE)
    }

    pub(crate) fn get_serializable(&self) -> bool {
        self.is(ShadowFlags::SERIALIZABLE)
    }

    pub(crate) fn get_js_reference_target<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, Option<Str<'a>>> {
        Ok(self.reference_target().map(|it| it.to_js(heap)))
    }

    pub(crate) fn set_js_reference_target<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        value: Option<Str<'a>>,
    ) -> Result<'a> {
        self.set_reference_target(value.map(|it| string(heap, it)).transpose()?);
        Ok(())
    }

    pub(crate) fn get_inner_html<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Str<'a>> {
        seams::serialize_inner(cx, self).map(|it| as_string(&cx.heap, it))
    }

    pub(crate) fn set_inner_html<'a>(&'a self, cx: Cx<'_, 'a>, markup: JsLocal<'a>) -> Result<'a> {
        let markup = Trusted::Html.string_or_empty_for(cx, self, markup, "ShadowRoot innerHTML")?;
        let fragment = seams::parse_fragment(cx, self.host_element(), &markup, self)?;
        replace_all(cx, Some(fragment), self);
        Ok(())
    }
}

impl Attr {
    pub(crate) fn get_namespace_uri<'a>(&'a self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        self.qual_name().ns.uri().map(|it| it.to_js(heap))
    }

    pub(crate) fn get_prefix<'a>(&'a self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        self.qual_name().prefix.map(|it| it.to_js(heap))
    }

    pub(crate) fn get_local_name<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.qual_name().local.to_js(heap)
    }

    pub(crate) fn get_name<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.get_node_name(heap)
    }

    pub(crate) fn get_value<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Str<'a>> {
        Ok(Node::node_value(self, cx)
            .unwrap_or_default()
            .to_js(&cx.heap))
    }

    pub(crate) fn set_value<'a>(&'a self, cx: Cx<'_, 'a>, value: Str<'a>) -> Result<'a> {
        let value = string(&cx.heap, value)?;
        self.change_value(cx, value)
    }

    pub(crate) fn get_owner_element(&self) -> Option<&Element> {
        self.owner()
    }

    pub(crate) fn get_specified(&self) -> bool {
        true
    }
}

macro_rules! reflect {
    ($($get:ident $set:ident $name:tt;)*) => {
        $(pub(crate) fn $get<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Str<'a>> {
            Ok(self.with_attr_string(atom!($name), |it| it.to_js(&cx.heap)).unwrap_or_else(|| DomString::default().to_js(&cx.heap)))
        }

        pub(crate) fn $set<'a>(&'a self, cx: Cx<'_, 'a>, value: Str<'a>) -> Result<'a> {
            let value = string(&cx.heap, value)?;
            self.set_attr(cx, atom!($name), value);
            Ok(())
        })*
    };
}

#[derive(Clone, Copy)]
enum Adjacent {
    BeforeBegin,
    AfterBegin,
    BeforeEnd,
    AfterEnd,
}

impl Adjacent {
    fn parse<'a>(heap: &JsHeap<'a>, position: Str<'a>) -> Result<'a, Adjacent> {
        let position = string(heap, position)?;
        let all = [
            ("beforebegin", Adjacent::BeforeBegin),
            ("afterbegin", Adjacent::AfterBegin),
            ("beforeend", Adjacent::BeforeEnd),
            ("afterend", Adjacent::AfterEnd),
        ];
        all.into_iter()
            .find(|it| position.eq_ignore_ascii_case(it.0))
            .map(|it| it.1)
            .ok_or_else(|| {
                dom_error(
                    heap,
                    DomError::SyntaxError,
                    &format!(
                        "'{}' is not 'beforeBegin', 'afterBegin', 'beforeEnd' or 'afterEnd'.",
                        position.to_utf8()
                    ),
                )
            })
    }
}

impl Element {
    pub(crate) fn get_namespace_uri<'a>(&'a self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        self.ns().uri().map(|it| it.to_js(heap))
    }

    pub(crate) fn get_prefix<'a>(&'a self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        self.prefix().map(|it| it.to_js(heap))
    }

    pub(crate) fn get_local_name<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.local().to_js(heap)
    }

    pub(crate) fn get_tag_name<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.tag_name().to_js(heap)
    }

    reflect! {
        get_id set_id "id";
        get_class_name set_class_name "class";
        get_slot set_slot "slot";
    }

    pub(crate) fn get_shadow_root(&self) -> Option<&ShadowRoot> {
        self.shadow_root()
            .filter(|it| !it.has(F::USER_AGENT) && !it.is(ShadowFlags::CLOSED))
    }

    pub(crate) fn has_attributes(&self) -> bool {
        self.attr_count() > 0
    }

    pub(crate) fn get_attribute_names<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let names = List::new(heap);
        self.attrs()
            .iter()
            .for_each(|it| names.push(heap, it.0.qualified().to_js(heap).to_js()));
        names.to_js()
    }

    #[inline]
    fn attribute_name<'a>(&'a self, heap: &JsHeap<'a>, name: Str<'a>) -> Result<'a, Atom> {
        if self.ignores_case() {
            Atom::from_js_string_lowercased(heap, name)
        } else {
            Atom::from_js_string(heap, name)
        }
    }

    fn existing_name<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, Option<QualName>> {
        Ok(self.attr_name_by_qualified_name(&self.attribute_name(heap, name)?))
    }

    fn existing_name_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a, Option<QualName>> {
        Ok(self.attr_name_ns(&namespace(heap, ns)?, &Atom::from_js_string(heap, local)?))
    }

    /// Of the one that it has, or else of the one to add.
    #[inline]
    fn name_to_set<'a>(&'a self, heap: &JsHeap<'a>, name: Str<'a>) -> Result<'a, QualName> {
        let name = self.attribute_name(heap, name)?;
        validate_attribute_name(heap, &name)?;
        let existing = if self.has(F::HAS_NAMESPACED_ATTR) {
            self.attr_name_by_qualified_name(&name)
        } else {
            None
        };
        Ok(existing.unwrap_or_else(|| QualName::plain(name)))
    }

    pub(crate) fn get_attribute<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
    ) -> Result<'a, Option<Str<'a>>> {
        if self.ignores_case() && !self.has(F::HAS_NAMESPACED_ATTR | F::STYLE_DIRTY) {
            return Atom::with_lowercased(&cx.heap, name, |name| {
                self.with_attr_string(name, |it| it.to_js(&cx.heap))
            });
        }
        let name = self.attribute_name(&cx.heap, name)?;
        if name == atom!("style") {
            self.flush_style(cx);
        }
        Ok(self
            .attr_by_qualified_name(&name)
            .map(|it| it.to_js(&cx.heap)))
    }

    pub(crate) fn get_attribute_ns<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a, Option<Str<'a>>> {
        self.flush_style(cx);
        Ok(self
            .attr_ns(
                &namespace(&cx.heap, ns)?,
                &Atom::from_js_string(&cx.heap, local)?,
            )
            .map(|it| it.to_js(&cx.heap)))
    }

    pub(crate) fn set_attribute<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
        value: JsLocal<'a>,
    ) -> Result<'a> {
        if let Some(value) = value.as_string()
            && self.set_attribute_unnoticed(&cx.heap, name, value)?
        {
            return Ok(());
        }
        let checked = self.name_to_set(&cx.heap, name)?;
        let value = self.compliant_attribute_value(cx, &checked, value)?;
        let name = if self.has(F::HAS_NAMESPACED_ATTR) || checked.ns != Ns::None {
            self.name_to_set(&cx.heap, name)?
        } else {
            checked
        };
        self.set_attr_ns(cx, name, value);
        Ok(())
    }

    pub(crate) fn set_attribute_ns<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        ns: Option<Str<'a>>,
        name: Str<'a>,
        value: JsLocal<'a>,
    ) -> Result<'a> {
        let heap = &cx.heap;
        let name = QualName::validate_and_extract(
            heap,
            namespace(heap, ns)?,
            &Atom::from_js_string(heap, name)?,
            NameFor::Attribute,
        )?;
        let value = self.compliant_attribute_value(cx, &name, value)?;
        self.set_attr_ns(cx, name, value);
        Ok(())
    }

    pub(crate) fn remove_attribute<'a>(&'a self, cx: Cx<'_, 'a>, name: Str<'a>) -> Result<'a> {
        if let Some(name) = self.existing_name(&cx.heap, name)? {
            self.remove_attr_ns(cx, name);
        }
        Ok(())
    }

    pub(crate) fn remove_attribute_ns<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a> {
        if let Some(name) = self.existing_name_ns(&cx.heap, ns, local)? {
            self.remove_attr_ns(cx, name);
        }
        Ok(())
    }

    pub(crate) fn toggle_attribute<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
        force: Option<bool>,
    ) -> Result<'a, bool> {
        let name = self.name_to_set(&cx.heap, name)?;
        let has = self.attr_ns(&name.ns, &name.local).is_some();
        let on = force.unwrap_or(!has);
        if on && !has {
            self.set_attr_ns(cx, name, DomString::default());
        } else if has && !on {
            self.remove_attr_ns(cx, name);
        }
        Ok(on)
    }

    pub(crate) fn has_attribute<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, bool> {
        Ok(self.existing_name(heap, name)?.is_some())
    }

    pub(crate) fn has_attribute_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a, bool> {
        Ok(self.existing_name_ns(heap, ns, local)?.is_some())
    }

    pub(crate) fn get_attribute_node<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, Option<&'a Attr>> {
        Ok(self
            .existing_name(heap, name)?
            .map(|it| self.attr_node(heap, it)))
    }

    pub(crate) fn get_attribute_node_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a, Option<&'a Attr>> {
        Ok(self
            .existing_name_ns(heap, ns, local)?
            .map(|it| self.attr_node(heap, it)))
    }

    pub(crate) fn set_attribute_node<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        attr: &'a Attr,
    ) -> Result<'a, Option<&'a Attr>> {
        self.set_attr_node(cx, attr)
    }

    pub(crate) fn remove_attribute_node<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        attr: &'a Attr,
    ) -> Result<'a, &'a Attr> {
        self.remove_attr_node(cx, Some(attr))
    }

    pub(crate) fn js_closest<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        selectors: &[u8],
    ) -> Result<'a, Option<&'a Element>> {
        self.closest(cx, selectors)
    }

    /// False if there is no such place.
    fn insert_adjacent<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        position: Adjacent,
        node: &'a Node,
    ) -> Result<'a, bool> {
        let (parent, child) = match position {
            Adjacent::BeforeBegin => (self.parent(), Some(&**self)),
            Adjacent::AfterBegin => (Some(&**self), self.first_child()),
            Adjacent::BeforeEnd => (Some(&**self), None),
            Adjacent::AfterEnd => (self.parent(), self.next_sibling()),
        };
        parent.map_or(Ok(false), |it| {
            pre_insert(cx, node, it, child).map(|()| true)
        })
    }

    pub(crate) fn insert_adjacent_element<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        position: Str<'a>,
        element: &'a Element,
    ) -> Result<'a, Option<&'a Element>> {
        let position = Adjacent::parse(&cx.heap, position)?;
        Ok(self
            .insert_adjacent(cx, position, element)?
            .then_some(element))
    }

    pub(crate) fn insert_adjacent_text<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        position: Str<'a>,
        data: Str<'a>,
    ) -> Result<'a> {
        let (position, text) = (
            Adjacent::parse(&cx.heap, position)?,
            self.doc().create_text(&cx.heap, string(&cx.heap, data)?),
        );
        self.insert_adjacent(cx, position, text).map(|_| ())
    }

    pub(crate) fn insert_adjacent_html<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        position: Str<'a>,
        markup: JsLocal<'a>,
    ) -> Result<'a> {
        let markup = Trusted::Html.string_for(cx, self, markup, "Element insertAdjacentHTML")?;
        let position = Adjacent::parse(&cx.heap, position)?;
        let context = if matches!(position, Adjacent::BeforeBegin | Adjacent::AfterEnd) {
            self.parent()
        } else {
            Some(&**self)
        };
        let Some(context) = context.filter(|it| !it.kind().is_document()) else {
            return Err(dom_error(
                &cx.heap,
                DomError::NoModificationAllowedError,
                "The element has no parent.",
            ));
        };
        let context = match context
            .as_element()
            .filter(|it| !(self.doc().is_html_doc() && it.kind() == Kind::Html))
        {
            Some(element) => element,
            None => context.body_as_context(&cx.heap),
        };
        let fragment = seams::parse_fragment(cx, context, &markup, context)?;
        self.insert_adjacent(cx, position, fragment).map(|_| ())
    }

    pub(crate) fn get_inner_html<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Str<'a>> {
        seams::serialize_inner(cx, self).map(|it| as_string(&cx.heap, it))
    }

    pub(crate) fn set_inner_html<'a>(&'a self, cx: Cx<'_, 'a>, markup: JsLocal<'a>) -> Result<'a> {
        let markup = Trusted::Html.string_or_empty_for(cx, self, markup, "Element innerHTML")?;
        if crate::api::markup::is_only_text(self, &markup) {
            string_replace_all(cx, markup, self);
            return Ok(());
        }
        let fragment = if markup.is_empty() && self.tag() != atom!("html") {
            None
        } else {
            Some(seams::parse_fragment(cx, self, &markup, self)?)
        };
        let contents = self.contents(cx);
        replace_all(cx, fragment, contents);
        Ok(())
    }

    pub(crate) fn get_outer_html<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Str<'a>> {
        seams::serialize_outer(cx, self).map(|it| as_string(&cx.heap, it))
    }

    pub(crate) fn set_outer_html<'a>(&'a self, cx: Cx<'_, 'a>, markup: JsLocal<'a>) -> Result<'a> {
        let markup = Trusted::Html.string_or_empty_for(cx, self, markup, "Element outerHTML")?;
        let Some(parent) = self.parent() else {
            return Ok(());
        };
        if parent.kind().is_document() {
            return Err(dom_error(
                &cx.heap,
                DomError::NoModificationAllowedError,
                "The parent is the document.",
            ));
        }
        let context = parent
            .as_element()
            .unwrap_or_else(|| parent.body_as_context(&cx.heap));
        let fragment = seams::parse_fragment(cx, context, &markup, context)?;
        replace(cx, self, fragment, parent)
    }
}

macro_rules! collections {
    ($($get:ident $key:literal $test:expr;)*) => {
        $(pub(crate) fn $get<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
            self.cached_collection(heap, $key, Atom::EMPTY, |_| HTMLCollection::new(heap, self, Filter::descendants(const { &$test })).to_js())
        })*
    };
}

impl Doc {
    collections! {
        get_anchors 4 Test { tags: &[atom!("a")], reads: Reads::Ties, matches: |it| it.kind() == Kind::Anchor && it.has_attr(atom!("name")), ..Test::ALL };
        get_applets 5 Test { lists: |_, _| true, ..Test::ALL };
        get_embeds 6 Test { tags: &[atom!("embed")], matches: |it| it.kind() == Kind::Embed, ..Test::ALL };
        get_forms 7 Test { tags: &[atom!("form")], matches: |it| it.kind() == Kind::Form, ..Test::ALL };
        get_images 8 Test { tags: &[atom!("img")], matches: |it| it.kind() == Kind::Image, ..Test::ALL };
        get_links 9 Test { tags: &[atom!("a"), atom!("area")], reads: Reads::Ties, matches: |it| matches!(it.kind(), Kind::Anchor | Kind::Area) && it.has_attr(atom!("href")), ..Test::ALL };
        get_scripts 10 Test { tags: &[atom!("script")], matches: |it| it.kind() == Kind::Script, ..Test::ALL };
    }

    pub(crate) fn get_all<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::All, || {
            HTMLAllCollection::new(heap, self).to_js()
        })
    }

    pub(crate) fn get_elements_by_name<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: JsAtom<'a>,
    ) -> JSValue {
        self.elements_by_name(heap, Atom::from_impl(name.get()))
    }

    pub(crate) fn get_doctype(&self) -> Option<&DocumentType> {
        self.children().find_map(Node::downcast)
    }

    pub(crate) fn get_document_element(&self) -> Option<&Element> {
        self.document_element()
    }

    pub(crate) fn get_head(&self) -> Option<&Element> {
        self.head()
    }

    pub(crate) fn get_body<'a>(&'a self) -> Option<&'a Element> {
        self.body()
    }

    pub(crate) fn set_body<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        body: Option<&'a crate::generated_bindgen::html::HTMLElement>,
    ) -> Result<'a> {
        let (Some(body), Some(root)) = (
            body.filter(|it| matches!(it.kind(), Kind::Body | Kind::FrameSet)),
            self.document_element(),
        ) else {
            return Err(dom_error(
                &cx.heap,
                DomError::HierarchyRequestError,
                "The new body element must be a 'BODY' or a 'FRAMESET' element.",
            ));
        };
        match self.body() {
            None => append(cx, body, root),
            Some(old) if **old != ***body => replace(cx, old, body, root),
            Some(_) => Ok(()),
        }
    }

    fn create_for_script<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: QualName,
        options: Any<'a>,
    ) -> Result<'a, &'a Element> {
        let (mut registry, mut is, options) = (None, None, options.to_js());
        if options.is_object() {
            registry = options.get(cx.global(), "customElementRegistry")?;
            is = options
                .get(cx.global(), "is")?
                .map(|it| DomString::from_js(cx, JsLocal::new(&cx.heap, it)))
                .transpose()?
                .map(|it| Atom::from_string(&it));
        }
        if registry.is_some() && is.is_some() {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "The custom element registry and the is value cannot both be given.",
            ));
        }
        let registry =
            custom::registry_option(&cx.heap, registry.unwrap_or(JSValue::UNDEFINED), self)?;
        Ok(self.create_element(cx, name, is.as_ref(), Synchronous::Yes, registry))
    }

    pub(crate) fn js_create_element<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
        options: Any<'a>,
    ) -> Result<'a, &'a Element> {
        let local = if self.is_html_doc() {
            Atom::from_js_string_lowercased(&cx.heap, name)?
        } else {
            Atom::from_js_string(&cx.heap, name)?
        };
        if self.is_html_doc()
            && options.is_undefined()
            && Kind::of_html(local.known()) != Kind::Unknown
            && !has_scoped_registries()
        {
            return Ok(self.create_html(&cx.heap, local.known()));
        }
        validate_element_name(&cx.heap, &local)?;
        let ns = if self.is_html_doc() || self.is(DocFlags::IS_XHTML) {
            Ns::Html
        } else {
            Ns::None
        };
        self.create_for_script(cx, QualName::parsed(ns, None, local), options)
    }

    pub(crate) fn create_element_ns<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        ns: Option<Str<'a>>,
        name: Str<'a>,
        options: Any<'a>,
    ) -> Result<'a, &'a Element> {
        let (ns, name) = (
            namespace(&cx.heap, ns)?,
            Atom::from_js_string(&cx.heap, name)?,
        );
        let name = match ns == Ns::Svg && Kind::of_svg(name.known()) != Kind::SvgElement {
            true => QualName::parsed(ns, None, name),
            false => QualName::validate_and_extract(&cx.heap, ns, &name, NameFor::Element)?,
        };
        self.create_for_script(cx, name, options)
    }

    pub(crate) fn create_document_fragment<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> &'a DocumentFragment {
        self.create_fragment(heap)
    }

    pub(crate) fn create_text_node<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        data: Str<'a>,
    ) -> Result<'a, &'a Text> {
        Ok(self.create_text(heap, string(heap, data)?))
    }

    pub(crate) fn js_create_comment<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        data: Str<'a>,
    ) -> Result<'a, &'a Node> {
        Ok(self.create_comment(heap, string(heap, data)?))
    }

    pub(crate) fn create_cdata_section<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        data: Str<'a>,
    ) -> Result<'a, &'a Text> {
        if self.is_html_doc() {
            return Err(dom_error(
                heap,
                DomError::NotSupportedError,
                "This is not supported for HTML documents.",
            ));
        }
        let data = string(heap, data)?;
        if bun_core::strings::contains(data.to_utf8().as_bytes(), b"]]>") {
            return Err(dom_error(
                heap,
                DomError::InvalidCharacterError,
                "The data contains ']]>'.",
            ));
        }
        Ok(self.create_cdata(heap, data))
    }

    pub(crate) fn create_attribute<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, &'a Attr> {
        let name = if self.is_html_doc() {
            Atom::from_js_string_lowercased(heap, name)?
        } else {
            Atom::from_js_string(heap, name)?
        };
        validate_attribute_name(heap, &name)?;
        Ok(self.create_attr(heap, QualName::plain(name), DomString::default()))
    }

    pub(crate) fn create_attribute_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
        name: Str<'a>,
    ) -> Result<'a, &'a Attr> {
        let name = QualName::validate_and_extract(
            heap,
            namespace(heap, ns)?,
            &Atom::from_js_string(heap, name)?,
            NameFor::Attribute,
        )?;
        Ok(self.create_attr(heap, name, DomString::default()))
    }
}
