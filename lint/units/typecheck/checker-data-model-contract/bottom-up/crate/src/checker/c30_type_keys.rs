// checker.go 17471-17640 (c30_type_keys): CacheHashKey, keyBuilder and the first key functions.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{ElementFlags, IntersectionFlags, TypeFlags};
use crate::checker::types::TupleElementInfo;
use crate::tscore::deps::{hash_bytes, hash_bytes_second};
use crate::tscore::golang::List;
use crate::tscore::ids::{NodeId, SymbolId, TypeAliasId, TypeId};

// xxh3.Uint128 upstream: a digest of the key bytes. Here two 64-bit hashes of the same bytes. The value never reaches output.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct CacheHashKey {
    pub hi: u64,
    pub lo: u64,
}

impl CacheHashKey {
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            hi: hash_bytes_second(bytes),
            lo: hash_bytes(bytes),
        }
    }
    pub fn is_zero(self) -> bool {
        self == Self::default()
    }
}

pub struct KeyBuilder {
    inline_length: usize,
    overflow_buffer: Vec<u8>,
    inline_buffer: [u8; 192],
}

impl Default for KeyBuilder {
    fn default() -> Self {
        Self {
            inline_length: 0,
            overflow_buffer: Vec::new(),
            inline_buffer: [0; 192],
        }
    }
}

impl KeyBuilder {
    pub fn hash(&self) -> CacheHashKey {
        let inline = self.inline_buffer.get(..self.inline_length).unwrap_or(&[]);
        if self.overflow_buffer.is_empty() {
            return CacheHashKey::of(inline);
        }
        CacheHashKey::of(&[self.overflow_buffer.as_slice(), inline].concat())
    }

    // spill moves the buffered bytes onto the end of overflowBuffer, so the key's byte stream stays overflowBuffer followed by inlineBuffer.
    fn spill(&mut self) {
        let inline = self.inline_buffer.get(..self.inline_length).unwrap_or(&[]);
        self.overflow_buffer.extend_from_slice(inline);
        self.inline_length = 0;
    }

    pub fn write_byte(&mut self, c: u8) {
        if self.inline_length == self.inline_buffer.len() {
            self.spill();
        }
        if let Some(slot) = self.inline_buffer.get_mut(self.inline_length) {
            *slot = c;
        }
        self.inline_length += 1;
    }

    pub fn write_string(&mut self, s: &[u8]) {
        if self.inline_length + s.len() > self.inline_buffer.len() {
            self.spill();
            if s.len() > self.inline_buffer.len() {
                self.overflow_buffer.extend_from_slice(s);
                return;
            }
        }
        if let Some(dst) = self
            .inline_buffer
            .get_mut(self.inline_length..self.inline_length + s.len())
        {
            dst.copy_from_slice(s);
            self.inline_length += s.len();
        }
    }

    pub fn write_uint32(&mut self, v: u32) {
        if self.inline_length + 4 > self.inline_buffer.len() {
            self.spill();
        }
        if let Some(dst) = self
            .inline_buffer
            .get_mut(self.inline_length..self.inline_length + 4)
        {
            dst.copy_from_slice(&v.to_le_bytes());
        }
        self.inline_length += 4;
    }

    pub fn write_uint64(&mut self, v: u64) {
        if self.inline_length + 8 > self.inline_buffer.len() {
            self.spill();
        }
        if let Some(dst) = self
            .inline_buffer
            .get_mut(self.inline_length..self.inline_length + 8)
        {
            dst.copy_from_slice(&v.to_le_bytes());
        }
        self.inline_length += 8;
    }

    pub fn write_int(&mut self, value: isize) {
        self.write_uint64(value as u64);
    }

    // The byte stream holds ast.GetSymbolId: writing a symbol assigns its id.
    pub fn write_symbol(&mut self, c: &Checker<'_>, s: SymbolId) {
        self.write_uint64(c.ast.get_symbol_id(s));
    }

    pub fn write_type(&mut self, t: TypeId) {
        self.write_uint32(t.0);
    }

    pub fn write_types(&mut self, types: List<'_, TypeId>) {
        self.write_int(types.len());
        for t in types.iter() {
            self.write_type(t);
        }
    }

    pub fn write_alias(&mut self, c: &Checker<'_>, alias: TypeAliasId) {
        if !alias.is_nil() {
            self.write_byte(1);
            self.write_symbol(c, c.type_aliases[alias].symbol);
            self.write_types(c.type_aliases[alias].type_arguments);
        } else {
            self.write_byte(0);
        }
    }

    // ast.GetNodeId is only ever a key: the id of the node table stands for it.
    pub fn write_node_id(&mut self, id: NodeId) {
        self.write_uint64(u64::from(id.0));
    }

    pub fn write_node(&mut self, node: NodeId) {
        if !node.is_nil() {
            self.write_node_id(node);
        }
    }
}

pub fn get_type_list_key(types: List<'_, TypeId>) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_types(types);
    b.hash()
}

pub fn get_alias_key(c: &Checker<'_>, alias: TypeAliasId) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_alias(c, alias);
    b.hash()
}

pub fn get_union_key(
    c: &Checker<'_>,
    types: List<'_, TypeId>,
    origin: TypeId,
    alias: TypeAliasId,
) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    if origin.is_nil() {
        b.write_types(types);
    } else if c.types[origin].flags.intersects(TypeFlags::UNION) {
        b.write_byte(b'|');
        b.write_types(c.type_types(origin));
    } else if c.types[origin].flags.intersects(TypeFlags::INTERSECTION) {
        b.write_byte(b'&');
        b.write_types(c.type_types(origin));
    } else if c.types[origin].flags.intersects(TypeFlags::INDEX) {
        // origin type id alone is insufficient, as `keyof x` may resolve to multiple WIP values while `x` is still resolving
        b.write_byte(b'#');
        b.write_type(origin);
        b.write_byte(b'|');
        b.write_types(types);
    } else {
        return c.fail("Unhandled case in getUnionKey");
    }
    b.write_alias(c, alias);
    b.hash()
}

pub fn get_intersection_key(
    c: &Checker<'_>,
    types: List<'_, TypeId>,
    flags: IntersectionFlags,
    alias: TypeAliasId,
) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_types(types);
    if !flags.intersects(IntersectionFlags::NO_CONSTRAINT_REDUCTION) {
        b.write_alias(c, alias);
    } else {
        b.write_byte(b'*');
    }
    b.hash()
}

pub fn get_tuple_key(element_infos: List<'_, TupleElementInfo>, readonly: bool) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    for e in element_infos.iter() {
        if e.flags.intersects(ElementFlags::REQUIRED) {
            b.write_byte(b'#');
        } else if e.flags.intersects(ElementFlags::OPTIONAL) {
            b.write_byte(b'?');
        } else if e.flags.intersects(ElementFlags::REST) {
            b.write_byte(b'.');
        } else {
            b.write_byte(b'*');
        }
        if !e.labeled_declaration.is_nil() {
            b.write_node(e.labeled_declaration);
        }
    }
    if readonly {
        b.write_byte(b'!');
    }
    b.hash()
}
