// checker.go:17471-17620. The digest is two in-tree 64-bit hashes of upstream's byte stream.
use crate::checker::Checker;
use crate::flags::TypeFlags;
use crate::golang::List;
use crate::ids::*;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct CacheHashKey {
    pub hi: u64,
    pub lo: u64,
}

impl CacheHashKey {
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            hi: crate::shims::hash_b(bytes),
            lo: crate::shims::hash_a(bytes),
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

    pub fn write_symbol(&mut self, c: &mut Checker<'_>, s: SymbolId) {
        self.write_uint64(c.get_symbol_id(s));
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

    pub fn write_alias(&mut self, c: &mut Checker<'_>, alias: TypeAliasId) {
        if !alias.is_nil() {
            self.write_byte(1);
            let symbol = c.type_aliases[alias].symbol;
            self.write_symbol(c, symbol);
            self.write_types(c.type_aliases[alias].type_arguments);
        } else {
            self.write_byte(0);
        }
    }

    pub fn write_node_id(&mut self, id: u64) {
        self.write_uint64(id);
    }

    pub fn write_node(&mut self, node: NodeId) {
        if !node.is_nil() {
            self.write_node_id(crate::checker::get_node_id(node));
        }
    }
}

pub fn get_type_list_key(types: List<'_, TypeId>) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_types(types);
    b.hash()
}

pub fn get_union_key(
    c: &mut Checker<'_>,
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
