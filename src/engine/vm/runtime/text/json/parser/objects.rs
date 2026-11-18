//! Keys that were not foreseen, and objects whose shape is not known yet.

use bun_alloc::AllocError;
use bun_engine_text::{Atom, Identifier, PropertyName, Text, parse_array_index};
use smallvec::SmallVec;

use super::keys::{KeyTree, NodeId};
use super::reader::Cursor;
use super::{Parser, Tables};
use crate::json::records::Recorder;
use crate::json::syntax_error::Expected;
use crate::{Attributes, Cx, Gc, JsFinalObject, JsObject, Shape, Value};

/// Of an object outside the tree.
pub(super) enum Key {
    Name(Identifier),
    Index(u32),
}

impl Key {
    fn name(&self) -> Option<PropertyName<'_>> {
        match self {
            Key::Name(name) => Some(name.name()),
            Key::Index(_) => None,
        }
    }
}

impl Tables {
    /// Where the key `text` leads from `parent`.
    #[inline(always)]
    fn follow(&mut self, parent: NodeId, text: Text<'_>) -> Result<NodeId, AllocError> {
        let index = parse_array_index(text);
        if parent != NodeId::OUTSIDE {
            if index.is_none()
                && let Some(node) = self.tree.follow(parent, text, text.hash())
            {
                return Ok(node);
            }
            let (start, depth) = (self.keys.len(), self.tree[parent].depth);
            self.keys
                .try_reserve(depth.into())
                .map_err(|_| AllocError)?;
            let path = self.tree.path(parent);
            (self.keys).extend(path.map(|name| Key::Name(name.to_identifier())));
            self.keys[start..].reverse();
            self.tree[NodeId::OUTSIDE].child = self.tree[parent].child;
        }
        self.keys.try_reserve(1).map_err(|_| AllocError)?;
        self.keys.push(match index {
            Some(index) => Key::Index(index),
            None => Key::Name(Atom::try_new(text)?.into()),
        });
        Ok(NodeId::OUTSIDE)
    }

    pub(super) fn identifier(&self, node: NodeId) -> Result<Identifier, AllocError> {
        match self.keys.last().filter(|_| node == NodeId::OUTSIDE) {
            Some(Key::Name(name)) => Ok(name.clone()),
            Some(&Key::Index(index)) => Identifier::try_from_index(index),
            None => Ok(self.tree[node].name().to_identifier()),
        }
    }

    /// An object that ends at `node`.
    pub(super) fn create_object(
        &mut self,
        cx: &Cx,
        node: NodeId,
        values: &mut [Value],
    ) -> Result<Gc<JsObject>, AllocError> {
        if let Some(shape) = self.tree[node].shape() {
            return JsFinalObject::try_create_with_values(cx, shape, values).map(Gc::upcast);
        }
        if node == NodeId::OUTSIDE {
            let first = self.keys.len() - values.len();
            let object = object_with_keys(cx, &self.keys[first..], values);
            self.keys.truncate(first);
            return object;
        }
        let mut names: SmallVec<[_; 32]> = self.tree.path(node).collect();
        names.reverse();
        let Some(shape) = shape_with(cx, &names) else {
            return Ok(object_with_names(cx, names.into_iter(), values));
        };
        drop(names);
        self.tree.set_shape(node, &shape);
        JsFinalObject::try_create_with_values(cx, shape, values).map(Gc::upcast)
    }
}

/// `None` if a name repeats.
fn shape_with(cx: &Cx, names: &[PropertyName<'_>]) -> Option<Gc<Shape>> {
    let empty = Shape::for_new_object(cx, names.len());
    names.iter().try_fold(empty, |shape, &name| {
        (shape.existing_add_transition(name, Attributes::NONE)).or_else(|| {
            let is_new = shape.get(name).is_none();
            is_new.then(|| shape.add_property_transition(cx, name, Attributes::NONE).0)
        })
    })
}

fn object_with_names<'a>(
    cx: &Cx,
    names: impl Iterator<Item = PropertyName<'a>>,
    values: &[Value],
) -> Gc<JsObject> {
    let object = JsFinalObject::create(cx, Shape::for_new_object(cx, values.len()));
    for (name, &value) in names.zip(values) {
        object.put_direct(cx, name, value, Attributes::NONE);
    }
    object.upcast()
}

fn object_with_keys(
    cx: &Cx,
    keys: &[Key],
    values: &mut [Value],
) -> Result<Gc<JsObject>, AllocError> {
    let mut elements = crate::root_vec();
    let mut named = 0;
    for (position, key) in keys.iter().enumerate() {
        if let Key::Index(index) = *key {
            elements.try_reserve(1).map_err(|_| AllocError)?;
            elements.push((index, values[position]));
        } else {
            values[named] = values[position];
            named += 1;
        }
    }
    let (names, values) = (keys.iter().filter_map(Key::name), &mut values[..named]);
    let object = if named > usize::from(KeyTree::MAX_DEPTH) {
        JsFinalObject::try_create_dictionary(cx, names, values)?.upcast()
    } else {
        object_with_names(cx, names, values)
    };
    for (index, value) in elements {
        if !object.try_set_dense(cx, index, value) {
            object.store_element(cx, index, value)?;
        }
    }
    Ok(object)
}

impl<'a, R: Recorder> Parser<'a, R> {
    /// Reads a key and the colon. Returns where the key leads from `parent`, which is not where it was `expected` to
    /// as far as it could be told at a glance.
    #[inline(always)]
    fn read_key(
        &mut self,
        tables: &mut Tables,
        cursor: &mut Cursor<'a>,
        parent: NodeId,
        expected: NodeId,
    ) -> Option<NodeId> {
        const GUESSES: usize = 3;
        let start = self.reader.window(cursor).first_chunk().expect("a part");
        let mut guess = expected;
        for _ in 0..GUESSES {
            guess = tables.tree[guess].other;
            if guess == NodeId::NONE {
                break;
            }
            if let Some(length) = tables.tree[guess].find_in(start) {
                cursor.advance(length);
                tables.tree[expected].other = guess;
                return Some(guess);
            }
        }
        let node = self.with_characters(cursor, |text| {
            if tables.tree[expected].is_unusual_key(text) {
                return Ok(expected);
            }
            tables.follow(parent, text)
        })?;
        let node = self.or_out_of_memory(node)?;
        if expected != NodeId::NONE && node != NodeId::OUTSIDE && node != expected {
            tables.tree[expected].other = node;
        }
        if self.reader.window(cursor)[0] != b':' {
            self.skip_white_space(cursor);
            if self.reader.window(cursor)[0] != b':' {
                return self.unexpected(cursor, Expected::Colon);
            }
        }
        cursor.advance(1);
        Some(node)
    }

    /// In the value of the key `context`. No node: it has failed.
    #[inline(never)]
    pub(super) extern "rust-cold" fn unforeseen_first_key(
        &mut self,
        tables: &mut Tables,
        mut cursor: Cursor<'a>,
        context: NodeId,
    ) -> (Cursor<'a>, NodeId) {
        let expected = tables.tree[context].child;
        let first = self.read_key(tables, &mut cursor, self.root, expected);
        if let Some(first) = first.filter(|&it| it != NodeId::OUTSIDE) {
            tables.tree[context].child = first;
        }
        (cursor, first.unwrap_or(NodeId::NONE))
    }

    /// The same.
    #[inline(never)]
    pub(super) extern "rust-cold" fn unforeseen_next_key(
        &mut self,
        tables: &mut Tables,
        mut cursor: Cursor<'a>,
        previous: NodeId,
    ) -> (Cursor<'a>, NodeId) {
        let expected = tables.tree[previous].next;
        let next = self.read_key(tables, &mut cursor, previous, expected);
        if let Some(next) = next.filter(|&it| it != NodeId::OUTSIDE) {
            tables.tree[previous].next = next;
        }
        (cursor, next.unwrap_or(NodeId::NONE))
    }

    #[inline(never)]
    pub(super) extern "rust-cold" fn any_object(
        &mut self,
        tables: &mut Tables,
        node: NodeId,
        members: &mut [Value],
    ) -> Option<Value> {
        let object = tables.create_object(self.cx, node, members);
        self.or_out_of_memory(object).map(Into::into)
    }
}
