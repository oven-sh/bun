//! <https://dom.spec.whatwg.org/#xpath>

use core::cell::{Cell, RefCell};
use core::cmp::Ordering;

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSObject, JSString, JSValue};
use bun_markup::xpath::{self, Expression, NameTest, NodeKind, ParseError, Value};
use bun_markup::{Chars, Text as Buffer};

use crate::api::core::{NodeFlags as F, *};
use crate::api::support::*;
use crate::generated_bindgen::xpath::{
    DocumentXPath, XPathEvaluator, js_XPathExpression, js_XPathResult as js,
};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Str<'a> = JsLocal<'a, JSString>;
type Resolver<'a> = Option<JsLocal<'a, JSObject>>;

/// A node, or an attribute of an element, which may have no node yet.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Item<'a> {
    node: &'a Node,
    attribute: Option<u32>,
}

impl core::hash::Hash for Item<'_> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        (core::ptr::from_ref(self.node), self.attribute).hash(state);
    }
}

impl<'a> Item<'a> {
    fn of(node: &'a Node) -> Item<'a> {
        Item {
            node,
            attribute: None,
        }
    }

    fn context(node: &'a Node) -> Item<'a> {
        let owned = node.downcast::<Attr>().and_then(|attr| {
            let (owner, name) = (attr.owner()?, attr.qual_name());
            let index = owner
                .attrs()
                .iter()
                .position(|it| it.0.ns == name.ns && it.0.local == name.local)?;
            Some(Item {
                node: owner,
                attribute: Some(index as u32),
            })
        });
        owned.unwrap_or_else(|| Item::of(node))
    }

    fn with_attribute<R>(
        self,
        read: impl FnOnce(&crate::tree::Attribute, &DomString) -> R,
    ) -> Option<R> {
        let (wanted, mut index, mut read, mut found) = (self.attribute?, 0, Some(read), None);
        self.node.as_element()?.for_each_attr(|attribute, value| {
            if index == wanted {
                found = read.take().map(|read| read(attribute, value));
            }
            index += 1;
        });
        found
    }

    fn name(self) -> Option<QualName> {
        match (self.attribute, self.node.as_element()) {
            (Some(_), _) => self.with_attribute(|it, _| it.qual_name()),
            (None, Some(element)) => Some(element.qual_name()),
            _ => matches!(self.node.kind(), Kind::Attr | Kind::Instruction)
                .then(|| self.node.with_inert(|it| it.name.clone())),
        }
    }

    fn step(self, to: fn(&'a Node) -> Option<&'a Node>) -> Option<Item<'a>> {
        if self.attribute.is_some() {
            None
        } else {
            to(self.node).map(Item::of)
        }
    }

    fn to_node(self, heap: &JsHeap<'a>) -> &'a Node {
        match (
            self.node.as_element(),
            self.with_attribute(|it, _| it.qual_name()),
        ) {
            (Some(element), Some(name)) => element.attr_node(heap, name),
            _ => self.node,
        }
    }
}

struct Tree<'c, 'a>(RefCell<Cx<'c, 'a>>);

impl<'a> xpath::Tree for Tree<'_, 'a> {
    type Node = Item<'a>;
    type Name = Atom;

    #[inline]
    fn kind(&self, item: Item<'a>) -> NodeKind {
        match item.node.kind() {
            _ if item.attribute.is_some() => NodeKind::Attribute,
            Kind::Attr => NodeKind::Attribute,
            Kind::Text | Kind::CData => NodeKind::Text,
            Kind::Comment => NodeKind::Comment,
            Kind::Instruction => NodeKind::Instruction,
            kind if kind.is_element() => NodeKind::Element,
            _ => NodeKind::Other,
        }
    }

    fn parent(&self, item: Item<'a>) -> Option<Item<'a>> {
        if item.attribute.is_some() {
            Some(Item::of(item.node))
        } else {
            item.step(Node::parent)
        }
    }

    fn first_child(&self, item: Item<'a>) -> Option<Item<'a>> {
        item.step(Node::first_child)
    }

    fn last_child(&self, item: Item<'a>) -> Option<Item<'a>> {
        item.step(Node::last_child)
    }

    fn next_sibling(&self, item: Item<'a>) -> Option<Item<'a>> {
        item.step(Node::next_sibling)
    }

    fn previous_sibling(&self, item: Item<'a>) -> Option<Item<'a>> {
        item.step(Node::previous_sibling)
    }

    fn attributes(&self, item: Item<'a>) -> impl Iterator<Item = Item<'a>> {
        let element = item.node.as_element().filter(|_| item.attribute.is_none());
        element
            .into_iter()
            .for_each(|it| it.flush_style(&mut self.0.borrow_mut()));
        let all = (0..element.map_or(0, Element::attr_count)).map(move |it| Item {
            attribute: Some(it),
            ..item
        });
        all.filter(|it| {
            !it.node.has(F::HAS_NAMESPACED_ATTR) || it.name().is_some_and(|it| it.ns != Ns::Xmlns)
        })
    }

    fn compare_order(&self, a: Item<'a>, b: Item<'a>) -> Ordering {
        a.node
            .compare_order(b.node)
            .then(a.attribute.cmp(&b.attribute))
    }

    fn matches(&self, item: Item<'a>, test: &NameTest<Atom>) -> bool {
        let is_element = self.kind(item) == NodeKind::Element;
        match test {
            NameTest::Any => true,
            NameTest::InNamespace { namespace, local } => item.name().is_some_and(|it| {
                it.ns.uri().unwrap_or(Atom::EMPTY) == *namespace
                    && local.as_ref().is_none_or(|local| it.local == *local)
            }),
            NameTest::Unprefixed { lowercase, .. }
                if item.node.as_element().is_some_and(Element::ignores_case) =>
            {
                item.name().is_some_and(|it| {
                    (it.local == *lowercase
                        || it.local.as_known().is_none()
                            && it.local.to_ascii_lowercase() == *lowercase)
                        && (is_element || it.ns == Ns::None)
                })
            }
            NameTest::Unprefixed { local, .. } => {
                !(is_element && item.node.doc().is_html_doc())
                    && item
                        .name()
                        .is_some_and(|it| it.local == *local && it.ns == Ns::None)
            }
        }
    }

    fn element_by_id(&self, root: Item<'a>, id: Chars<'_>) -> Option<Item<'a>> {
        root.node
            .element_by_id(&Atom::from_chars(id))
            .map(|it| Item::of(it))
    }

    fn language(&self, item: Item<'a>) -> Option<Buffer> {
        let element = item
            .node
            .as_element()
            .filter(|_| item.attribute.is_none())?;
        element
            .attr_ns(&Ns::Xml, &atom!("lang").into())
            .map(|it| it.chars().into())
    }

    fn push_string_value(&self, item: Item<'a>, out: &mut Buffer) {
        if item.attribute.is_some() {
            item.with_attribute(|_, value| out.push(value.chars()));
        } else if let Some(attr) = item.node.downcast::<Attr>() {
            out.push(attr.value().chars());
        } else if let Some(data) = item.node.as_character_data() {
            data.with_data(|it| out.push(it.chars()));
        } else {
            item.node
                .descendants()
                .filter_map(Node::as_text)
                .for_each(|it| it.with_data(|it| out.push(it.chars())));
        }
    }

    fn push_local_name(&self, item: Item<'a>, out: &mut Buffer) {
        item.name()
            .into_iter()
            .for_each(|it| out.push(it.local.chars()));
    }

    fn push_qualified_name(&self, item: Item<'a>, out: &mut Buffer) {
        if let Some(prefix) = item.name().and_then(|it| it.prefix) {
            out.push(prefix.chars());
            out.push_byte(b':');
        }
        self.push_local_name(item, out);
    }

    fn push_namespace(&self, item: Item<'a>, out: &mut Buffer) {
        item.name()
            .and_then(|it| it.ns.uri())
            .into_iter()
            .for_each(|it| out.push(it.chars()));
    }
}

struct Names<'c, 'a> {
    cx: Cx<'c, 'a>,
    resolver: Resolver<'a>,
}

impl<'a> Names<'_, 'a> {
    fn look_up(
        &mut self,
        resolver: JsLocal<'a, JSObject>,
        prefix: Chars<'_>,
    ) -> Result<'a, Option<Atom>> {
        let prefix = DomString::from_chars(prefix)
            .to_js(&self.cx.heap)
            .as_value();
        let namespace = resolver.call_operation(self.cx, "lookupNamespaceURI", &[prefix])?;
        match namespace.to_js().is_undefined_or_null() {
            true => Ok(None),
            false => Ok(Some(Atom::from_string(&DomString::from_js(
                self.cx, namespace,
            )?))),
        }
    }
}

impl xpath::Names for Names<'_, '_> {
    type Name = Atom;

    fn intern(&mut self, name: Chars<'_>) -> Atom {
        Atom::from_chars(name)
    }

    fn resolve(&mut self, prefix: Chars<'_>) -> Option<Atom> {
        self.look_up(self.resolver?, prefix)
            .unwrap_or_else(|error| {
                report_exception(self.cx, error);
                None
            })
    }
}

fn compile<'a>(
    cx: Cx<'_, 'a>,
    source: Str<'a>,
    resolver: Resolver<'a>,
) -> Result<'a, Expression<Atom>> {
    let source = DomString::from_js_string(&cx.heap, source)?;
    xpath::parse(source.chars(), &mut Names { cx, resolver }).map_err(|error| match error {
        ParseError::Syntax => cx.heap.dom_exception(
            DomError::SyntaxError,
            format_args!(
                "The string '{}' is not a valid XPath expression.",
                source.to_utf8()
            ),
        ),
        ParseError::Namespace => cx.heap.dom_exception(
            DomError::NamespaceError,
            format_args!(
                "The string '{}' contains unresolvable namespaces.",
                source.to_utf8()
            ),
        ),
    })
}

enum Outcome {
    Number(f64),
    String(DomString),
    Boolean(bool),
    Iterator { next: Cell<u32>, versions: [u64; 2] },
    Snapshot,
    SingleNode,
}

pub(crate) struct XPathResult {
    result_type: u16,
    outcome: Outcome,
}

fn versions_of(doc: &Doc) -> [u64; 2] {
    [doc.version(), doc.attribute_version()]
}

fn run<'a>(
    cx: Cx<'_, 'a>,
    expression: &Expression<Atom>,
    context: &'a Node,
    wanted: u16,
) -> Result<'a, &'a XPathResult> {
    if context.kind() == Kind::Doctype || context.as_fragment().is_some() {
        return Err(dom_error(
            &cx.heap,
            DomError::NotSupportedError,
            "The node is not a valid context node.",
        ));
    }
    let global = core::ptr::from_ref(&cx.heap);
    // SAFETY: the caller holds it.
    let (heap, tree) = (unsafe { &*global }, Tree(RefCell::new(cx)));
    let not_nodes = |_| {
        heap.type_error(format_args!(
            "The expression does not evaluate to a node set."
        ))
    };
    let value = xpath::evaluate(&tree, expression, Item::context(context)).map_err(not_nodes)?;
    let result_type = match (wanted, &value) {
        (0, Value::Number(_)) => 1,
        (0, Value::Text(_)) => 2,
        (0, Value::Boolean(_)) => 3,
        (0, Value::Nodes(_)) => 4,
        (1..=9, _) => wanted,
        _ => {
            return Err(dom_error(
                heap,
                DomError::NotSupportedError,
                "The result type is not supported.",
            ));
        }
    };
    let mut nodes = JSValue::ZERO;
    let outcome = match result_type {
        1 => Outcome::Number(value.to_number(&tree)),
        2 => Outcome::String(DomString::from_chars(value.into_text(&tree).chars())),
        3 => Outcome::Boolean(value.to_boolean()),
        _ => {
            let mut items = value.into_nodes().map_err(not_nodes)?;
            items.truncate(if result_type >= 8 { 1 } else { usize::MAX });
            nodes = match items.iter().any(|it| it.attribute.is_some()) {
                true => List::from_nodes(heap, items.iter().map(|it| it.to_node(heap))),
                false => List::from_fn(heap, items.len() as u32, |it| {
                    items[it as usize].node.to_js()
                }),
            }
            .to_js();
            match result_type {
                4 | 5 => Outcome::Iterator {
                    next: Cell::new(0),
                    versions: versions_of(context.doc()),
                },
                6 | 7 => Outcome::Snapshot,
                _ => Outcome::SingleNode,
            }
        }
    };
    let result = js::create(
        heap,
        XPathResult {
            result_type,
            outcome,
        },
    );
    js::set_document(result, Some(context.doc()));
    js::set_nodes(result, nodes);
    Ok(result)
}

fn wrong_type<'a, T>(heap: &JsHeap<'a>, what: &str) -> Result<'a, T> {
    Err(heap.type_error(format_args!("The result type is not {what}.")))
}

impl XPathResult {
    fn nodes(&self) -> List<'_> {
        List::from_value(js::nodes(self).expect("it is a node set"))
    }

    pub(crate) fn get_result_type(&self) -> u16 {
        self.result_type
    }

    pub(crate) fn get_number_value<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, f64> {
        if let Outcome::Number(number) = self.outcome {
            Ok(number)
        } else {
            wrong_type(heap, "a number")
        }
    }

    pub(crate) fn get_string_value<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, Str<'a>> {
        if let Outcome::String(string) = &self.outcome {
            Ok(string.to_js(heap))
        } else {
            wrong_type(heap, "a string")
        }
    }

    pub(crate) fn get_boolean_value<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, bool> {
        if let Outcome::Boolean(boolean) = self.outcome {
            Ok(boolean)
        } else {
            wrong_type(heap, "a boolean")
        }
    }

    pub(crate) fn get_single_node_value<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, Option<&'a Node>> {
        if let Outcome::SingleNode = self.outcome {
            Ok(self.nodes().node(0))
        } else {
            wrong_type(heap, "a single node")
        }
    }

    pub(crate) fn get_invalid_iterator_state(&self) -> bool {
        matches!(self.outcome, Outcome::Iterator { versions, .. } if Some(versions) != js::document(self).map(versions_of))
    }

    pub(crate) fn get_snapshot_length<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, u32> {
        if let Outcome::Snapshot = self.outcome {
            Ok(self.nodes().len())
        } else {
            wrong_type(heap, "a snapshot")
        }
    }

    pub(crate) fn iterate_next<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, Option<&'a Node>> {
        let Outcome::Iterator { next, .. } = &self.outcome else {
            return wrong_type(heap, "an iterator");
        };
        if self.get_invalid_iterator_state() {
            return Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The document has mutated since the result was returned.",
            ));
        }
        Ok(self
            .nodes()
            .node(next.get())
            .inspect(|_| next.set(next.get() + 1)))
    }

    pub(crate) fn snapshot_item<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        index: u32,
    ) -> Result<'a, Option<&'a Node>> {
        if let Outcome::Snapshot = self.outcome {
            Ok(self.nodes().node(index))
        } else {
            wrong_type(heap, "a snapshot")
        }
    }
}

pub(crate) struct XPathExpression(Expression<Atom>);

impl XPathExpression {
    pub(crate) fn evaluate<'a>(
        &self,
        cx: Cx<'_, 'a>,
        context: &'a Node,
        r#type: u16,
        _: Option<&'a XPathResult>,
    ) -> Result<'a, &'a XPathResult> {
        run(cx, &self.0, context, r#type)
    }
}

macro_rules! evaluator_base {
    ($($name:ty),*) => {$(
        impl $name {
            pub(crate) fn create_expression<'a>(&self, cx: Cx<'_, 'a>, expression: Str<'a>, resolver: Resolver<'a>) -> Result<'a, &'a XPathExpression> {
                let compiled = compile(cx, expression, resolver)?;
                Ok(js_XPathExpression::create(&cx.heap, XPathExpression(compiled)))
            }

            pub(crate) fn create_ns_resolver<'a>(&self, node: &'a Node) -> &'a Node {
                node
            }

            pub(crate) fn evaluate<'a>(&self, cx: Cx<'_, 'a>, expression: Str<'a>, context: &'a Node, resolver: Resolver<'a>, r#type: u16, _: Option<&'a XPathResult>) -> Result<'a, &'a XPathResult> {
                let compiled = compile(cx, expression, resolver)?;
                run(cx, &compiled, context, r#type)
            }
        }
    )*};
}

evaluator_base!(XPathEvaluator, DocumentXPath);

impl XPathEvaluator {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }
}
