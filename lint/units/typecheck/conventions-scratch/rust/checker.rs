// The checker owns every arena. Ported methods take `&mut self`; upstream free functions take `c: &mut Checker` first.
use crate::arena::{Arena, Overlay};
use crate::flags::{ObjectFlags, TypeFlags};
use crate::golang::{List, Map, Memo, OrderedMap, SliceBuf, Text};
use crate::ids::*;
use crate::internal::{FaultKind, InternalFault, InternalLog, StandInLog};
use crate::keys::CacheHashKey;
use crate::shims::{Bump, StackCheck};
use crate::types::*;

pub struct Program<'p> {
    pub nodes: &'p [Node],
    pub symbols: &'p [Symbol<'p>],
    // The value of the lazy symbol id counter when binding ended.
    pub next_symbol_id: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeSystemEntity {
    #[default]
    Nil,
    Symbol(SymbolId),
    Type(TypeId),
    Signature(SignatureId),
    Node(NodeId),
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeSystemPropertyName {
    #[default]
    Type,
    ResolvedBaseConstructorType,
    DeclaredType,
    ResolvedReturnType,
    ResolvedBaseConstraint,
    ResolvedTypeArguments,
    ResolvedBaseTypes,
    WriteType,
    InitializerIsUndefined,
    AliasTarget,
}

#[derive(Clone, Copy, Default)]
pub struct TypeResolution {
    pub target: TypeSystemEntity,
    pub property_name: TypeSystemPropertyName,
    pub result: bool,
}

// core.LinkStore and the two stores of checker/links.go. `get` hands out a handle, never a reference.
pub struct LinkStore<K, V> {
    entries: Map<K, u32>,
    arena: Vec<V>,
    nil: V,
    sink: V,
}

pub struct Link<V>(u32, core::marker::PhantomData<fn() -> V>);

impl<V> Clone for Link<V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<V> Copy for Link<V> {}

impl<K: Ord + Copy, V: Default> LinkStore<K, V> {
    pub fn new() -> Self {
        Self {
            entries: Map::make(),
            arena: Vec::new(),
            nil: V::default(),
            sink: V::default(),
        }
    }
    pub fn get(&mut self, key: K) -> Link<V> {
        if let Some(index) = self.entries.get_ok(&key) {
            return Link(index, core::marker::PhantomData);
        }
        let Ok(index) = u32::try_from(self.arena.len() + 1) else {
            return Link(0, core::marker::PhantomData);
        };
        self.arena.push(V::default());
        let _ = self.entries.set(key, index);
        Link(index, core::marker::PhantomData)
    }
    pub fn has(&self, key: K) -> bool {
        self.entries.get_ok(&key).is_some()
    }
    pub fn try_get(&self, key: K) -> Option<Link<V>> {
        self.entries
            .get_ok(&key)
            .map(|index| Link(index, core::marker::PhantomData))
    }
}

impl<K, V> core::ops::Index<Link<V>> for LinkStore<K, V> {
    type Output = V;
    fn index(&self, link: Link<V>) -> &V {
        (link.0 as usize)
            .checked_sub(1)
            .and_then(|i| self.arena.get(i))
            .unwrap_or(&self.nil)
    }
}

impl<K, V: Default> core::ops::IndexMut<Link<V>> for LinkStore<K, V> {
    fn index_mut(&mut self, link: Link<V>) -> &mut V {
        match (link.0 as usize)
            .checked_sub(1)
            .and_then(|i| self.arena.get_mut(i))
        {
            Some(value) => value,
            None => {
                self.sink = V::default();
                &mut self.sink
            }
        }
    }
}

pub struct Checker<'a> {
    pub arena: &'a Bump,
    pub program: &'a Program<'a>,
    pub stack_check: StackCheck,
    pub internal: InternalLog,
    pub stand_ins: StandInLog,
    pub file_index_map: Map<NodeId, isize>,
    pub type_count: u32,
    pub symbol_count: u32,
    pub signature_count: u32,
    pub total_instantiation_count: u32,
    pub instantiation_count: u32,
    pub instantiation_depth: u32,
    pub current_node: NodeId,
    pub strict_null_checks: bool,
    pub next_symbol_id: u64,
    pub symbol_ids: Vec<u32>,
    pub nodes: Overlay<'a, NodeId, Node>,
    pub symbols: Overlay<'a, SymbolId, Symbol<'a>>,
    pub symbol_tables: Arena<SymbolTableId, OrderedMap<Text<'a>, SymbolId>>,
    pub types: Arena<TypeId, Type<'a>>,
    pub signatures: Arena<SignatureId, Signature<'a>>,
    pub type_mappers: Arena<TypeMapperId, TypeMapper<'a>>,
    pub type_aliases: Arena<TypeAliasId, TypeAlias<'a>>,
    pub conditional_roots: Arena<ConditionalRootId, ConditionalRoot>,
    pub value_symbol_links: LinkStore<u64, ValueSymbolLinks>,
    pub type_alias_links: LinkStore<SymbolId, TypeAliasLinks<'a>>,
    pub alias_symbol_links: LinkStore<SymbolId, AliasSymbolLinks>,
    pub node_links: LinkStore<NodeId, NodeLinks>,
    pub type_resolutions: Vec<TypeResolution>,
    pub resolution_start: isize,
    pub active_mappers: Vec<TypeMapperId>,
    pub active_type_mappers_caches: Vec<Map<CacheHashKey, TypeId>>,
    pub active_type_mappers_caches_len: usize,
    pub get_global_promise_type: Memo<TypeId>,
    pub any_type: TypeId,
    pub error_type: TypeId,
    pub never_type: TypeId,
    pub intrinsic_marker_type: TypeId,
    pub unknown_signature: SignatureId,
    pub nil_sections: NilSections<'a>,
    pub sink_sections: NilSections<'a>,
    pub nil_cache: Map<CacheHashKey, TypeId>,
    pub deferred_diagnostic_callbacks: Vec<Box<dyn FnOnce(&mut Checker<'a>) + 'a>>,
    pub resolving_explicit_type_of_symbol: Vec<SymbolId>,
}

// What a cast returns when the type has no such part. Go returns nil there and panics on the next field read.
#[derive(Default)]
pub struct NilSections<'a> {
    pub intrinsic: IntrinsicType<'a>,
    pub literal: LiteralType<'a>,
    pub constrained: ConstrainedType,
    pub structured: StructuredType<'a>,
    pub object: ObjectType<'a>,
    pub reference: TypeReference<'a>,
    pub interface: InterfaceType<'a>,
    pub tuple: TupleType<'a>,
    pub union_or_intersection: UnionOrIntersectionType<'a>,
    pub union: UnionType<'a>,
    pub type_parameter: TypeParameter,
    pub index: IndexType,
    pub indexed_access: IndexedAccessType,
    pub conditional: ConditionalType,
    pub substitution: SubstitutionType,
    pub template_literal: TemplateLiteralType<'a>,
    pub string_mapping: StringMappingType,
}

// The value that replaces the result of a function that upstream leaves through a panic, and of a stand-in.
pub trait Fallback<'a>: Sized {
    fn fallback(c: &Checker<'a>) -> Self;
}
impl<'a> Fallback<'a> for () {
    fn fallback(_: &Checker<'a>) -> Self {}
}
impl<'a> Fallback<'a> for bool {
    fn fallback(_: &Checker<'a>) -> Self {
        false
    }
}
impl<'a> Fallback<'a> for isize {
    fn fallback(_: &Checker<'a>) -> Self {
        0
    }
}
impl<'a> Fallback<'a> for TypeId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.error_type
    }
}
impl<'a> Fallback<'a> for SignatureId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.unknown_signature
    }
}
impl<'a> Fallback<'a> for SymbolId {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}
impl<'a> Fallback<'a> for DiagnosticId {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}
impl<'a> Fallback<'a> for &'a [u8] {
    fn fallback(_: &Checker<'a>) -> Self {
        b""
    }
}
impl<'a> Fallback<'a> for NodeId {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}
impl<'a> Fallback<'a> for TypeMapperId {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}
impl<'a> Fallback<'a> for CacheHashKey {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::default()
    }
}
impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}

// ast.GetNodeId: the value is only ever a key, so the table index stands for it.
pub fn get_node_id(node: NodeId) -> u64 {
    u64::from(node.0)
}

impl<'a> Checker<'a> {
    // panic("message")
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T {
        self.fail_detail(message, 0)
    }
    // panic("message" + x.String())
    pub fn fail_detail<T: Fallback<'a>>(&self, message: &'static str, detail: u32) -> T {
        self.internal.record(InternalFault {
            kind: FaultKind::Panic,
            message,
            detail,
            node: self.current_node,
        });
        T::fallback(self)
    }
    // debug.Assert(value, "message")
    pub fn assert(&self, value: bool, message: &'static str) {
        if !value {
            self.internal.record(InternalFault {
                kind: FaultKind::Assert,
                message,
                detail: 0,
                node: self.current_node,
            });
        }
    }
    pub fn bad_cast(&self, message: &'static str) {
        self.internal.record(InternalFault {
            kind: FaultKind::BadCast,
            message,
            detail: 0,
            node: self.current_node,
        });
    }
    // The whole body of a function that is not ported yet.
    pub fn stand_in<T: Fallback<'a>>(&self, name: &'static str) -> T {
        self.stand_ins.record(name);
        T::fallback(self)
    }
    // `m[k] = v` on a map that can be nil.
    pub fn map_set(&self, ok: bool) {
        if !ok {
            self.internal.record(InternalFault {
                kind: FaultKind::NilMapWrite,
                message: "assignment to entry in nil map",
                detail: 0,
                node: self.current_node,
            });
        }
    }

    // A `[]T` that leaves the function: frozen in the arena, nil stays nil.
    pub fn list<T: Copy + Default>(&self, buf: &SliceBuf<T>) -> List<'a, T> {
        if buf.is_nil() {
            return List::NIL;
        }
        List::from_slice(self.arena.alloc_slice_copy(&buf.items))
    }
    // slices.Clone
    pub fn clone_list<T: Copy + Default>(&self, list: List<'_, T>) -> List<'a, T> {
        if list.is_nil() {
            return List::NIL;
        }
        List::from_slice(self.arena.alloc_slice_copy(list.as_slice()))
    }
    pub fn text(&self, bytes: &[u8]) -> Text<'a> {
        self.arena.alloc_slice_copy(bytes)
    }

    // ast.GetSymbolId: assigned on first request, in request order.
    pub fn get_symbol_id(&mut self, symbol: SymbolId) -> u64 {
        let bound = self.symbols[symbol].id;
        if bound != 0 {
            return u64::from(bound);
        }
        let index = symbol.index();
        if index >= self.symbol_ids.len() {
            self.symbol_ids.resize(index + 1, 0);
        }
        let Some(slot) = self.symbol_ids.get_mut(index) else {
            return 0;
        };
        if *slot == 0 {
            self.next_symbol_id += 1;
            *slot = u32::try_from(self.next_symbol_id).unwrap_or(u32::MAX);
        }
        u64::from(*slot)
    }

    // t.Types()
    pub fn type_types(&self, t: TypeId) -> List<'a, TypeId> {
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            return self.as_union_or_intersection_type(t).types;
        }
        if self.types[t].flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            return self.as_template_literal_type(t).types;
        }
        self.fail("Unhandled case in Type.Types")
    }

    pub fn new_type(
        &mut self,
        flags: TypeFlags,
        object_flags: ObjectFlags,
        data: TypeData<'a>,
    ) -> TypeId {
        self.type_count += 1;
        let t = self.types.alloc(Type::default());
        self.types[t].flags = flags;
        self.types[t].object_flags = object_flags.without(
            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
                | ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                | ObjectFlags::MEMBERS_RESOLVED,
        );
        self.types[t].id = TypeId(self.type_count);
        self.types[t].data = data;
        t
    }

    pub fn new_intrinsic_type(
        &mut self,
        flags: TypeFlags,
        intrinsic_name: &'static [u8],
    ) -> TypeId {
        self.new_intrinsic_type_ex(flags, intrinsic_name, ObjectFlags::NONE)
    }

    pub fn new_intrinsic_type_ex(
        &mut self,
        flags: TypeFlags,
        intrinsic_name: &'static [u8],
        object_flags: ObjectFlags,
    ) -> TypeId {
        let data = IntrinsicType { intrinsic_name };
        self.new_type(flags, object_flags, TypeData::Intrinsic(data))
    }

    pub fn new_literal_type(
        &mut self,
        flags: TypeFlags,
        value: LiteralValue<'a>,
        regular_type: TypeId,
    ) -> TypeId {
        let data = LiteralType {
            value,
            ..Default::default()
        };
        let t = self.new_type(flags, ObjectFlags::NONE, TypeData::Literal(data));
        if !regular_type.is_nil() {
            self.as_literal_type_mut(t).regular_type = regular_type;
        } else {
            self.as_literal_type_mut(t).regular_type = t;
        }
        t
    }
}
