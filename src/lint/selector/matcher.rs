//! `esquery.matches`, on the nodes of [`crate::estree`].

use super::program::{Bound, Id, Key, Op, Program, Relation, Test};
use super::value::Val;
use crate::ast::Node;
use crate::estree::{Dialect, FieldEntry, NodeType, Nodes, VNode, Value};
use smallvec::SmallVec;
use std::cmp::Ordering;

/// Where `esquery` passes the ancestors of a node along, this asks the node for its parent.
#[derive(Copy, Clone)]
pub(super) struct Matcher<'s, 'a> {
    pub(super) program: &'s Program,
    pub(super) dialect: Dialect,
    /// The node that a `:has()` is asked about. What is in the parentheses does not see above it.
    pub(super) limit: Option<VNode<'a>>,
}

#[derive(Copy, Clone)]
enum Side {
    Left,
    Right,
}

/// The children of a node, in the order of the visitor keys.
struct Children<'a> {
    node: VNode<'a>,
    entries: std::slice::Iter<'static, FieldEntry>,
    list: Option<Nodes<'a>>,
    dialect: Dialect,
}

impl<'a> Iterator for Children<'a> {
    type Item = VNode<'a>;

    fn next(&mut self) -> Option<VNode<'a>> {
        loop {
            if let Some(child) = self.list.as_mut().and_then(|list| list.flatten().next()) {
                return Some(child);
            }
            self.list = None;
            let entry = self.entries.next().filter(|it| it.is_child)?;
            if !entry.is_in(self.dialect) {
                continue;
            }
            match (entry.get)(self.node) {
                Value::Node(child) => return Some(child),
                Value::Nodes(list) => self.list = Some(list),
                _ => {}
            }
        }
    }
}

impl<'s, 'a> Matcher<'s, 'a> {
    /// `ancestry[0]`
    #[inline]
    fn parent(&self, node: VNode<'a>) -> Option<VNode<'a>> {
        if self.limit == Some(node) {
            return None;
        }
        node.parent()
    }

    fn children(&self, node: VNode<'a>, node_type: NodeType) -> Children<'a> {
        Children {
            node,
            entries: node_type.fields().iter(),
            list: None,
            dialect: self.dialect,
        }
    }

    /// The value of the field of `entry` in `node`, which is of the type that `entry` is of.
    #[inline]
    fn value_of(&self, entry: &FieldEntry, node: VNode<'a>) -> Val<'a> {
        match entry.is_in(self.dialect) {
            true => (entry.get)(node).into(),
            false => Val::Undefined,
        }
    }

    /// `getPath`
    fn follow(&self, mut value: Val<'a>, path: &[Key]) -> Val<'a> {
        for &key in path {
            if value.is_nullish() {
                break;
            }
            value = value.get(key, self.dialect);
        }
        value
    }

    fn test(&self, test: u32, value: Val<'a>) -> bool {
        match self.program.tests.get(test as usize) {
            None => false,
            Some(Test::Exists) => !value.is_nullish(),
            Some(Test::Regex { regex, is_negated: false }) => match value {
                Val::Str(text) => regex.test(text),
                Val::Short(_) => value.with_string(|text| regex.test(text)),
                _ => false,
            },
            Some(Test::Regex { regex, is_negated: true }) => !value.with_string(|text| regex.test(text)),
            Some(Test::Type { js_type, is_negated }) => (*js_type == Some(value.js_type())) != *is_negated,
            Some(Test::Equals { literal, is_negated }) => value.equals(literal) != *is_negated,
            Some(Test::Compare { literal, relation }) => matches!(
                (value.compare(literal), relation),
                (Some(Ordering::Less), Relation::Less | Relation::LessOrEqual)
                    | (Some(Ordering::Equal), Relation::LessOrEqual | Relation::GreaterOrEqual)
                    | (Some(Ordering::Greater), Relation::Greater | Relation::GreaterOrEqual)
            ),
        }
    }

    /// `inPath`
    fn is_in_path(&self, node: VNode<'a>, ancestor: Val<'a>, path: &[Key]) -> bool {
        let mut current = ancestor;
        for (i, &key) in path.iter().enumerate() {
            if current.is_nullish() {
                return false;
            }
            current = current.get(key, self.dialect);
            if let Val::Nodes(mut nodes) = current {
                let rest = path.get(i + 1..).unwrap_or_default();
                return nodes.any(|it| self.is_in_path(node, it.map_or(Val::Null, Val::Node), rest));
            }
        }
        matches!(current, Val::Node(found) if self.is_same(found, node))
    }

    /// `a === b`. For espree the `imported` and the `local` of `import { a }` are one object, which is visited twice, and so are
    /// the `local` and the `exported` of `export { a }`.
    // TODO(api): replace by `==` once estree has one `VNode` for the two.
    fn is_same(&self, a: VNode<'a>, b: VNode<'a>) -> bool {
        a == b
            || (self.dialect == Dialect::Espree
                && a.base() == b.base()
                && matches!(a.base(), Node::ImportSpec(_) | Node::ExportSpec(_))
                && a.span() == b.span()
                && a.node_type() == b.node_type())
    }

    /// The fields of the parent of `node` that are lists.
    fn lists_around(&self, node: VNode<'a>) -> impl Iterator<Item = Nodes<'a>> {
        let dialect = self.dialect;
        let parent = self.parent(node);
        let entries = parent.map_or(&[][..], |it| it.node_type().fields()).iter();
        let entries = entries.take_while(|it| it.is_child).filter(move |it| it.is_in(dialect));
        entries.filter_map(move |it| match (it.get)(parent?) {
            Value::Nodes(list) => Some(list),
            _ => None,
        })
    }

    /// `sibling`
    fn has_sibling(&self, node: VNode<'a>, selector: Id, side: Side) -> bool {
        let Some((list, at)) = self.lists_around(node).find_map(|it| Some((it, it.index_of(node)?))) else {
            return false;
        };
        let mut matches = |it: Option<VNode<'a>>| it.is_some_and(|it| self.matches_node(selector, it));
        match side {
            Side::Left => list.take(at).any(&mut matches),
            Side::Right => list.skip(at + 1).any(&mut matches),
        }
    }

    /// `adjacent`
    fn has_adjacent(&self, node: VNode<'a>, selector: Id, side: Side) -> bool {
        let Some((list, at)) = self.lists_around(node).find_map(|it| Some((it, it.index_of(node)?))) else {
            return false;
        };
        let neighbor = match side {
            Side::Left => at.checked_sub(1),
            Side::Right => Some(at + 1),
        };
        let neighbor = neighbor.and_then(|it| list.get(it)).flatten();
        neighbor.is_some_and(|it| self.matches_node(selector, it))
    }

    /// `nthChild`
    fn is_nth_child(&self, node: VNode<'a>, nth: i32) -> bool {
        self.lists_around(node).any(|list| {
            let at = match nth {
                0 => None,
                1.. => Some(nth as usize - 1),
                _ => list.len().checked_sub(nth.unsigned_abs() as usize),
            };
            at.and_then(|at| list.get(at)) == Some(Some(node))
        })
    }

    fn has(&self, selectors: &[Id], is_about_children: bool, node: VNode<'a>, node_type: NodeType) -> bool {
        let inside = Matcher {
            limit: Some(node),
            ..*self
        };
        let matches = |it: VNode<'a>, node_type: NodeType| selectors.iter().any(|&id| inside.matches(id, it, node_type));
        if matches(node, node_type) {
            return true;
        }
        let mut open: SmallVec<[Children<'a>; 8]> = SmallVec::new();
        open.push(self.children(node, node_type));
        while let Some(innermost) = open.last_mut() {
            let Some(child) = innermost.next() else {
                open.pop();
                continue;
            };
            let node_type = child.node_type();
            if matches(child, node_type) {
                return true;
            }
            if !is_about_children {
                open.push(self.children(child, node_type));
            }
        }
        false
    }

    #[inline]
    fn matches_node(&self, id: Id, node: VNode<'a>) -> bool {
        matches!(self.program.ops.get(id as usize), Some(Op::Wildcard)) || self.matches(id, node, node.node_type())
    }

    /// Whether `node`, which is of the type `node_type`, matches the selector `id`.
    pub(super) fn matches(&self, id: Id, node: VNode<'a>, node_type: NodeType) -> bool {
        let program = self.program;
        let Some(&op) = program.ops.get(id as usize) else {
            return false;
        };
        match op {
            Op::Wildcard => true,
            Op::Identifier { node_type: wanted, .. } => wanted == Some(node_type),
            Op::Class {
                types,
                excludes_names_of_meta_properties,
                ..
            } => {
                types.contains(node_type)
                    && !(excludes_names_of_meta_properties
                        && node_type == NodeType::Identifier
                        && self.parent(node).is_some_and(|it| it.node_type() == NodeType::MetaProperty))
            }
            Op::UnknownClass(_) => false,
            Op::ExactNode => self.limit == Some(node),
            Op::Field(path) => {
                let path = path.of(&program.keys);
                let ancestor = path.iter().try_fold(node, |at, _| self.parent(at));
                ancestor.is_some_and(|it| self.is_in_path(node, Val::Node(it), path))
            }
            Op::Any(list) => list.of(&program.lists).iter().any(|&it| self.matches(it, node, node_type)),
            Op::All(list) => list.of(&program.lists).iter().all(|&it| self.matches(it, node, node_type)),
            Op::NotAny(list) => !list.of(&program.lists).iter().any(|&it| self.matches(it, node, node_type)),
            Op::Has {
                selectors,
                is_about_children,
            } => self.has(selectors.of(&program.lists), is_about_children, node, node_type),
            Op::Child(left, right) => {
                self.matches(right, node, node_type) && self.parent(node).is_some_and(|it| self.matches_node(left, it))
            }
            Op::Descendant(left, right) => {
                self.matches(right, node, node_type)
                    && std::iter::successors(self.parent(node), |it| self.parent(*it))
                        .any(|it| self.matches_node(left, it))
            }
            Op::Sibling {
                left,
                right,
                left_is_subject,
            } => {
                (self.matches(right, node, node_type) && self.has_sibling(node, left, Side::Left))
                    || (left_is_subject
                        && self.matches(left, node, node_type)
                        && self.has_sibling(node, right, Side::Right))
            }
            Op::Adjacent {
                left,
                right,
                right_is_subject,
            } => {
                (self.matches(right, node, node_type) && self.has_adjacent(node, left, Side::Left))
                    || (right_is_subject
                        && self.matches(left, node, node_type)
                        && self.has_adjacent(node, right, Side::Right))
            }
            Op::Attribute { path, test, first } => {
                let path = path.of(&program.keys);
                let rest = path.get(1..).unwrap_or_default();
                let value = match first {
                    Bound::Entry(entry) => self.follow(self.value_of(entry, node), rest),
                    Bound::Missing => Val::Undefined,
                    Bound::No => match path.first() {
                        Some(key) if !key.property.is_of_nodes() => {
                            let entry = key.field.and_then(|it| node_type.field(it));
                            self.follow(entry.map_or(Val::Undefined, |it| self.value_of(it, node)), rest)
                        }
                        _ => self.follow(Val::Node(node), path),
                    },
                };
                self.test(test, value)
            }
            Op::NthChild(nth) => self.is_nth_child(node, nth),
        }
    }
}
