// checker.go 17471-17775 (c30_type_keys): CacheHashKey, keyBuilder and the key functions. The digest is two in-tree 64-bit hashes of upstream's byte stream.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    AccessFlags, ElementFlags, IntersectionFlags, IntersectionState, ObjectFlags, TypeFlags,
};
use crate::checker::ids::TypeAliasId;
use crate::checker::types::TupleElementInfo;
use crate::tscore::golang::{List, SliceBuf};
use crate::tscore::gomore::TextList;
use crate::tscore::ids::{NodeId, SymbolId, TypeId};

// xxh3.Uint128 upstream. Only equality is ever asked of a key, so any 128 bits of the same bytes serve.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct CacheHashKey {
    pub hi: u64,
    pub lo: u64,
}

impl CacheHashKey {
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            hi: bun_wyhash::Wyhash11::hash(0, bytes),
            lo: bun_wyhash::hash(bytes),
        }
    }
    pub fn is_zero(self) -> bool {
        self == Self::default()
    }
}

// checker.go 176-182 and flow.go 1651: keys of one fixed string.
pub fn signature_key_erased() -> CacheHashKey {
    CacheHashKey::of(b"-")
}
pub fn signature_key_canonical() -> CacheHashKey {
    CacheHashKey::of(b"*")
}
pub fn signature_key_base() -> CacheHashKey {
    CacheHashKey::of(b"#")
}
pub fn signature_key_inner() -> CacheHashKey {
    CacheHashKey::of(b"<")
}
pub fn signature_key_outer() -> CacheHashKey {
    CacheHashKey::of(b">")
}

pub struct KeyBuilder {
    inline_length: usize,
    overflow_buffer: Vec<u8>,
    // Upstream tests `overflowBuffer == nil`: a spill of zero bytes leaves it nil.
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
    fn inline(&self) -> &[u8] {
        self.inline_buffer.get(..self.inline_length).unwrap_or(&[])
    }

    pub fn hash(&self) -> CacheHashKey {
        if self.overflow_buffer.is_empty() {
            return CacheHashKey::of(self.inline());
        }
        CacheHashKey::of(&[self.overflow_buffer.as_slice(), self.inline()].concat())
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

    // ast.GetSymbolId: the first key that names a symbol gives the symbol its id.
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

    pub fn write_generic_type_references(
        &mut self,
        c: &mut Checker<'_>,
        source: TypeId,
        target: TypeId,
        ignore_constraints: bool,
    ) -> bool {
        let mut constrained = false;
        let mut type_parameters: SliceBuf<TypeId> = SliceBuf::make(0, 8);
        self.write_type_reference(
            c,
            source,
            0,
            ignore_constraints,
            &mut type_parameters,
            &mut constrained,
        );
        self.write_byte(b',');
        self.write_type_reference(
            c,
            target,
            0,
            ignore_constraints,
            &mut type_parameters,
            &mut constrained,
        );
        constrained
    }

    // The recursive closure writeTypeReference of writeGenericTypeReferences: its captured variables are parameters.
    fn write_type_reference(
        &mut self,
        c: &mut Checker<'_>,
        reference: TypeId,
        depth: isize,
        ignore_constraints: bool,
        type_parameters: &mut SliceBuf<TypeId>,
        constrained: &mut bool,
    ) {
        self.write_type(c.type_target(reference));
        let type_arguments = c.as_type_reference(reference).resolved_type_arguments;
        for t in type_arguments.iter() {
            if c.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
                if ignore_constraints || c.get_constraint_of_type_parameter(t).is_nil() {
                    let mut index = type_parameters.items.iter().position(|&p| p == t);
                    if index.is_none() {
                        index = Some(type_parameters.items.len());
                        type_parameters.push(t);
                    }
                    self.write_byte(b'=');
                    self.write_int(index.map_or(0, |i| i as isize));
                    continue;
                }
                *constrained = true;
            } else if depth < 4 && is_type_reference_with_generic_arguments(c, t) {
                self.write_byte(b'<');
                self.write_type_reference(
                    c,
                    t,
                    depth + 1,
                    ignore_constraints,
                    type_parameters,
                    constrained,
                );
                self.write_byte(b'>');
                continue;
            }
            self.write_byte(b'-');
            self.write_type(t);
        }
    }

    // ast.GetNodeId: the value is only ever a key, so the id of the node table stands for it.
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

pub fn get_type_alias_instantiation_key(
    c: &Checker<'_>,
    type_arguments: List<'_, TypeId>,
    alias: TypeAliasId,
) -> CacheHashKey {
    get_type_instantiation_key(c, type_arguments, alias, false)
}

pub fn get_type_instantiation_key(
    c: &Checker<'_>,
    type_arguments: List<'_, TypeId>,
    alias: TypeAliasId,
    single_signature: bool,
) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_types(type_arguments);
    b.write_alias(c, alias);
    if single_signature {
        b.write_byte(b'!');
    }
    b.hash()
}

pub fn get_indexed_access_key(
    c: &Checker<'_>,
    object_type: TypeId,
    index_type: TypeId,
    access_flags: AccessFlags,
    alias: TypeAliasId,
) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_type(object_type);
    b.write_type(index_type);
    b.write_uint32(access_flags.0);
    b.write_alias(c, alias);
    b.hash()
}

pub fn get_template_type_key(texts: TextList<'_>, types: List<'_, TypeId>) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_types(types);
    b.write_byte(b'|');
    for s in texts.iter() {
        b.write_int(s.len() as isize);
    }
    b.write_byte(b'|');
    for s in texts.iter() {
        b.write_string(s);
    }
    b.hash()
}

pub fn get_conditional_type_key(
    c: &Checker<'_>,
    type_arguments: List<'_, TypeId>,
    alias: TypeAliasId,
    for_constraint: bool,
) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_types(type_arguments);
    b.write_alias(c, alias);
    if for_constraint {
        b.write_byte(b'!');
    }
    b.hash()
}

pub fn get_relation_key(
    c: &mut Checker<'_>,
    source: TypeId,
    target: TypeId,
    intersection_state: IntersectionState,
    is_identity: bool,
    ignore_constraints: bool,
) -> (CacheHashKey, bool) {
    let (mut source, mut target) = (source, target);
    if is_identity && c.types[source].id.0 > c.types[target].id.0 {
        (source, target) = (target, source);
    }
    let mut b = KeyBuilder::default();
    let mut constrained = false;
    if is_type_reference_with_generic_arguments(c, source)
        && is_type_reference_with_generic_arguments(c, target)
    {
        b.write_byte(b'g');
        constrained = b.write_generic_type_references(c, source, target, ignore_constraints);
    } else {
        b.write_byte(b's');
        b.write_type(source);
        b.write_type(target);
    }
    b.write_uint32(intersection_state.0);
    (b.hash(), constrained)
}

pub fn get_node_list_key(nodes: List<'_, NodeId>) -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_int(nodes.len());
    for n in nodes.iter() {
        b.write_node(n);
    }
    b.hash()
}

pub fn is_type_reference_with_generic_arguments(c: &mut Checker<'_>, t: TypeId) -> bool {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    if !is_non_deferred_type_reference(c, t) {
        return false;
    }
    let type_arguments = c.get_type_arguments(t);
    for t in type_arguments.iter() {
        if c.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER)
            || is_type_reference_with_generic_arguments(c, t)
        {
            return true;
        }
    }
    false
}

pub fn is_non_deferred_type_reference(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].object_flags.intersects(ObjectFlags::REFERENCE)
        && c.as_type_reference(t).node.is_nil()
}
