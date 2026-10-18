use crate::declared::DeclaredTable;
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use std::ptr::NonNull;

pub use crate::builtins_generated::Operation;

pub struct Args(Option<NonNull<ArgsHead>>);

#[repr(C)]
struct ArgsHead {
    len: u32,
    cap: u32,
}

const _: () = assert!(size_of::<Args>() == 8 && align_of::<V>() <= align_of::<ArgsHead>());

// SAFETY: it owns its block, as a `Vec<V>` does.
unsafe impl Send for Args {}
// SAFETY: the same.
unsafe impl Sync for Args {}

impl Args {
    pub const fn new() -> Args {
        Args(None)
    }
    pub fn with_capacity(cap: usize) -> Args {
        let mut list = Args::new();
        list.reserve(cap);
        list
    }
    pub fn from_slice(values: &[V]) -> Args {
        let mut list = Args::new();
        list.extend_from_slice(values);
        list
    }
    fn layout(cap: usize) -> std::alloc::Layout {
        std::alloc::Layout::from_size_align(size_of::<ArgsHead>() + cap * size_of::<V>(), align_of::<ArgsHead>()).expect("a list of values")
    }
    pub fn capacity(&self) -> usize {
        // SAFETY: the head is initialized as long as there is a block.
        self.0.map_or(0, |head| unsafe { head.as_ref() }.cap as usize)
    }
    pub fn reserve(&mut self, more: usize) {
        let (len, cap) = (self.len(), self.capacity());
        let wanted = len + more;
        if wanted <= cap {
            return;
        }
        let new_cap = wanted.max(cap + cap / 2).max(2);
        assert!(new_cap <= u32::MAX as usize);
        // SAFETY: the block was allocated with `layout(cap)`. The new size is not 0.
        let block = unsafe {
            match self.0 {
                Some(head) => std::alloc::realloc(head.as_ptr().cast(), Args::layout(cap), Args::layout(new_cap).size()),
                None => std::alloc::alloc(Args::layout(new_cap)),
            }
        };
        let Some(head) = NonNull::new(block).map(NonNull::cast::<ArgsHead>) else { std::alloc::handle_alloc_error(Args::layout(new_cap)) };
        // SAFETY: the block has room for a head.
        unsafe { head.write(ArgsHead { len: len as u32, cap: new_cap as u32 }) };
        self.0 = Some(head);
    }
    fn set_len(&mut self, len: usize) {
        if let Some(mut head) = self.0 {
            // SAFETY: the head is initialized. The callers have initialized the values below `len`.
            unsafe { head.as_mut() }.len = len as u32;
        }
    }
    pub fn push(&mut self, value: V) {
        self.extend_from_slice(&[value]);
    }
    pub fn extend_from_slice(&mut self, values: &[V]) {
        if values.is_empty() {
            return;
        }
        let len = self.len();
        self.reserve(values.len());
        let head = self.0.expect("room was made");
        // SAFETY: there is room for `values.len()` more behind the first `len`. `values` is borrowed, so it is no part of this list.
        unsafe { std::ptr::copy_nonoverlapping(values.as_ptr(), head.as_ptr().add(1).cast::<V>().add(len), values.len()) };
        self.set_len(len + values.len());
    }
    pub fn pop(&mut self) -> Option<V> {
        let last = *self.last()?;
        self.set_len(self.len() - 1);
        Some(last)
    }
    pub fn truncate(&mut self, len: usize) {
        if len < self.len() {
            self.set_len(len);
        }
    }
    pub fn clear(&mut self) {
        self.truncate(0);
    }
    pub fn insert(&mut self, at: usize, value: V) {
        self.push(value);
        self[at..].rotate_right(1);
    }
    pub fn remove(&mut self, at: usize) -> V {
        let value = self[at];
        self[at..].rotate_left(1);
        self.set_len(self.len() - 1);
        value
    }
    pub fn retain(&mut self, mut keep: impl FnMut(&mut V) -> bool) {
        let mut retained = 0;
        for at in 0..self.len() {
            let mut value = self[at];
            if keep(&mut value) {
                self[retained] = value;
                retained += 1;
            }
        }
        self.set_len(retained);
    }
    pub fn as_slice(&self) -> &[V] {
        self
    }
    pub fn as_mut_slice(&mut self) -> &mut [V] {
        self
    }
    pub fn into_vec(self) -> Vec<V> {
        self.to_vec()
    }
}

impl Drop for Args {
    fn drop(&mut self) {
        if let Some(head) = self.0 {
            // SAFETY: the block was allocated with this layout.
            unsafe { std::alloc::dealloc(head.as_ptr().cast(), Args::layout(self.capacity())) };
        }
    }
}

impl std::ops::Deref for Args {
    type Target = [V];
    fn deref(&self) -> &[V] {
        match self.0 {
            // SAFETY: `len` values behind the head are initialized.
            Some(head) => unsafe { std::slice::from_raw_parts(head.as_ptr().add(1).cast::<V>(), head.as_ref().len as usize) },
            None => &[],
        }
    }
}

impl std::ops::DerefMut for Args {
    fn deref_mut(&mut self) -> &mut [V] {
        match self.0 {
            // SAFETY: `len` values behind the head are initialized, and the list is borrowed mutably.
            Some(head) => unsafe { std::slice::from_raw_parts_mut(head.as_ptr().add(1).cast::<V>(), head.as_ref().len as usize) },
            None => &mut [],
        }
    }
}

impl Default for Args {
    fn default() -> Args {
        Args::new()
    }
}

impl Clone for Args {
    fn clone(&self) -> Args {
        Args::from_slice(self)
    }
}

impl PartialEq for Args {
    fn eq(&self, other: &Args) -> bool {
        **self == **other
    }
}

impl Eq for Args {}

impl std::hash::Hash for Args {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        (**self).hash(state);
    }
}

impl std::fmt::Debug for Args {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        (**self).fmt(f)
    }
}

impl Extend<V> for Args {
    fn extend<I: IntoIterator<Item = V>>(&mut self, values: I) {
        let values = values.into_iter();
        self.reserve(values.size_hint().0);
        for value in values {
            self.push(value);
        }
    }
}

impl FromIterator<V> for Args {
    fn from_iter<I: IntoIterator<Item = V>>(values: I) -> Args {
        let mut list = Args::new();
        list.extend(values);
        list
    }
}

impl From<Vec<V>> for Args {
    fn from(values: Vec<V>) -> Args {
        Args::from_slice(&values)
    }
}

impl From<&[V]> for Args {
    fn from(values: &[V]) -> Args {
        Args::from_slice(values)
    }
}

impl<const N: usize> From<[V; N]> for Args {
    fn from(values: [V; N]) -> Args {
        Args::from_slice(&values)
    }
}

pub struct ArgsIntoIter {
    list: Args,
    next: usize,
}

impl Iterator for ArgsIntoIter {
    type Item = V;
    fn next(&mut self) -> Option<V> {
        let value = *self.list.get(self.next)?;
        self.next += 1;
        Some(value)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        let left = self.list.len() - self.next;
        (left, Some(left))
    }
}

impl ExactSizeIterator for ArgsIntoIter {}

impl IntoIterator for Args {
    type Item = V;
    type IntoIter = ArgsIntoIter;
    fn into_iter(self) -> ArgsIntoIter {
        ArgsIntoIter { list: self, next: 0 }
    }
}

impl<'a> IntoIterator for &'a Args {
    type Item = &'a V;
    type IntoIter = std::slice::Iter<'a, V>;
    fn into_iter(self) -> std::slice::Iter<'a, V> {
        self.iter()
    }
}

impl<'a> IntoIterator for &'a mut Args {
    type Item = &'a mut V;
    type IntoIter = std::slice::IterMut<'a, V>;
    fn into_iter(self) -> std::slice::IterMut<'a, V> {
        self.iter_mut()
    }
}

#[derive(Default)]
pub struct Strs {
    bytes: Vec<u8>,
    ends: Vec<u32>,
    hashes: Vec<u64>,
    ids: hashbrown::HashTable<StrId>,
    has_unindexed_strings: bool,
}

impl Strs {
    pub fn with_capacity(strings: usize) -> Strs {
        Strs { bytes: Vec::new(), ends: Vec::with_capacity(strings), hashes: Vec::with_capacity(strings), ids: hashbrown::HashTable::with_capacity(strings), has_unindexed_strings: false }
    }
    pub fn with_capacities(strings: usize, bytes: usize) -> Strs {
        Strs { bytes: Vec::with_capacity(bytes), ..Strs::with_capacity(strings) }
    }
    pub fn hash_of(bytes: &[u8]) -> u64 {
        std::hash::BuildHasher::hash_one(&rustc_hash::FxBuildHasher, bytes)
    }
    pub fn intern(&mut self, bytes: &[u8]) -> StrId {
        self.intern_hashed(Strs::hash_of(bytes), bytes)
    }
    pub fn intern_hashed(&mut self, hash: u64, bytes: &[u8]) -> StrId {
        assert!(!self.has_unindexed_strings, "a string table without an index cannot be searched");
        if let Some(&id) = self.ids.find(hash, |&id| self.get(id) == bytes) {
            return id;
        }
        self.add(hash, bytes)
    }
    pub fn add(&mut self, hash: u64, bytes: &[u8]) -> StrId {
        let id = StrId::new(self.ends.len());
        self.bytes.extend_from_slice(bytes);
        self.ends.push(u32::try_from(self.bytes.len()).expect("the strings of a program are under 4 GB"));
        self.hashes.push(hash);
        let hashes = &self.hashes;
        self.ids.insert_unique(hash, id, |&id| hashes[id.idx()]);
        id
    }
    pub fn reserve_bytes(&mut self, bytes: usize) {
        self.bytes.reserve_exact(bytes);
    }
    pub fn unindexed_with_capacities(strings: usize, bytes: usize) -> Strs {
        Strs { bytes: Vec::with_capacity(bytes), ends: Vec::with_capacity(strings), hashes: Vec::with_capacity(strings), ids: hashbrown::HashTable::new(), has_unindexed_strings: true }
    }
    pub fn add_unindexed(&mut self, hash: u64, bytes: &[u8]) {
        debug_assert!(self.has_unindexed_strings);
        self.bytes.extend_from_slice(bytes);
        self.ends.push(u32::try_from(self.bytes.len()).expect("the strings of a program are under 4 GB"));
        self.hashes.push(hash);
    }
    pub fn add_all(&mut self, bytes: &[u8], lengths: &[u32], hashes: &[u64]) {
        let mut end = self.bytes.len();
        self.bytes.extend_from_slice(bytes);
        for (&length, &hash) in lengths.iter().zip(hashes) {
            end += length as usize;
            let id = StrId::new(self.ends.len());
            self.ends.push(u32::try_from(end).expect("the strings of a program are under 4 GB"));
            self.hashes.push(hash);
            let hashes = &self.hashes;
            self.ids.insert_unique(hash, id, |&id| hashes[id.idx()]);
        }
    }
    pub fn find(&self, bytes: &[u8]) -> Option<StrId> {
        assert!(!self.has_unindexed_strings, "a string table without an index cannot be searched");
        self.ids.find(Strs::hash_of(bytes), |&id| self.get(id) == bytes).copied()
    }
    #[inline]
    pub fn hash(&self, id: StrId) -> u64 {
        self.hashes[id.idx()]
    }
    #[inline]
    pub fn get(&self, id: StrId) -> &[u8] {
        let start = if id.0 == 0 { 0 } else { self.ends[id.idx() - 1] as usize };
        &self.bytes[start..self.ends[id.idx()] as usize]
    }
    pub fn len(&self) -> usize {
        self.ends.len()
    }
    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum LayoutKind {
    Record,
    Instance,
    Environment,
}

pub mod field_flags {
    pub const OPTIONAL: u16 = 1;
    pub const EXPECTED_INT32: u16 = 1 << 1;
    pub const IMMUTABLE: u16 = 1 << 2;
    pub const METHOD: u16 = 1 << 3;
    pub const ANNOTATED: u16 = 1 << 4;
    pub const NEVER_READ_UNINITIALIZED: u16 = 1 << 5;
    pub const STORED_ONCE: u16 = 1 << 6;
    pub const NEVER_STORED: u16 = 1 << 7;
    pub const SET_AT_CREATION: u16 = 1 << 8;
    pub const MAY_BE_SET_AT_CREATION: u16 = 1 << 9;
    pub const ABSENT_AT_CREATION: u16 = 1 << 10;
    pub const NEVER_OBSERVED_ABSENT: u16 = 1 << 11;
    pub const DECLARED_WITHOUT_UNDEFINED: u16 = 1 << 12;
    pub const UNDECLARED: u16 = 1 << 13;
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Literal {
    Str(StrId),
    Num(f64),
}

pub struct Field {
    pub name: StrId,
    pub declared: TyId,
    pub flags: u16,
    pub literals: Vec<Literal>,
    pub type_text: StrId,
    pub single_function: FuncId,
    pub single_function_flags: u8,
}

impl Field {
    pub fn new(name: StrId, declared: TyId, flags: u16) -> Field {
        Field { name, declared, flags, literals: Vec::new(), type_text: StrId::NONE, single_function: FuncId::NONE, single_function_flags: 0 }
    }
}

pub mod single_function_flags {
    pub const IS_PROVEN: u8 = 1;
    pub const OR_NULLISH: u8 = 1 << 2;
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MethodKind {
    Method,
    Getter,
    Setter,
}

pub mod method_flags {
    pub const STATIC: u8 = 1;
    pub const KEY_IS_SYMBOL: u8 = 1 << 1;
    pub const MAY_BE_REPLACED: u8 = 1 << 2;
}

pub struct Method {
    pub name: StrId,
    pub func: FuncId,
    pub kind: MethodKind,
    pub flags: u8,
    pub key: u32,
}

pub const NO_VARIABLE: u32 = u32::MAX;

pub mod class_flags {
    pub const HAS_FIXED_LAYOUT: u32 = 1 << 2;
    pub const IS_EVALUATED_ONCE: u32 = 1 << 3;
    pub const HAS_UNTYPED_BASE: u32 = 1 << 4;
    pub const HAS_FIXED_MEMBERS: u32 = 1 << 5;
    pub const MAY_HAVE_OTHER_PROTOTYPE: u32 = 1 << 6;
    pub const HAS_COMPUTED_STATIC_MEMBER: u32 = 1 << 8;
    pub const CONSTRUCTOR_MAY_BE_REPLACED: u32 = 1 << 9;
    pub const MAY_BE_REUSED: u32 = 1 << 10;
    pub const PROTOTYPE_IS_SET_BY_TYPED_CODE: u32 = 1 << 13;
    pub const PROTOTYPE_MAY_GAIN_MEMBERS: u32 = 1 << 15;
    pub const HAS_NO_OWN_INSTANCES: u32 = 1 << 14;
}

pub struct Layout {
    pub kind: LayoutKind,
    pub name: StrId,
    pub base: LayoutId,
    pub fields: Vec<Field>,
    pub methods: Vec<Method>,
    pub constructor: FuncId,
    pub class_flags: u32,
    pub environment: LayoutId,
    pub static_fields: Vec<(StrId, TyId)>,
    pub is_allocated: bool,
    pub may_be_frozen: bool,
    pub accepts_untyped: bool,
    pub is_relaxed_for_logging: bool,
    pub accepts_only_other_layouts: bool,
    pub members: Vec<LayoutId>,
    pub structural_subtypes: Vec<LayoutId>,
    pub specializations: Vec<LayoutId>,
    pub declared_path: StrId,
    pub declared_line: u32,
}

pub struct FieldsByName(Option<rustc_hash::FxHashMap<StrId, u32>>);

impl FieldsByName {
    pub fn get(&self, layout: &Layout, name: StrId) -> Option<u32> {
        match &self.0 {
            Some(by_name) => by_name.get(&name).copied(),
            None => layout.field(name),
        }
    }
}

impl Layout {
    pub const FIELD_INDEX_THRESHOLD: usize = 32;

    pub fn field(&self, name: StrId) -> Option<u32> {
        self.fields.iter().position(|f| f.name == name).map(|i| i as u32)
    }

    pub fn fields_by_name(&self) -> FieldsByName {
        if self.fields.len() < Layout::FIELD_INDEX_THRESHOLD {
            return FieldsByName(None);
        }
        let mut by_name = rustc_hash::FxHashMap::with_capacity_and_hasher(self.fields.len(), Default::default());
        for (index, field) in self.fields.iter().enumerate() {
            by_name.entry(field.name).or_insert(index as u32);
        }
        FieldsByName(Some(by_name))
    }

    pub fn accepts_unchecked_objects(&self) -> bool {
        self.accepts_untyped && !self.accepts_only_other_layouts
    }
}

pub struct Global {
    pub name: StrId,
    pub module: ModuleId,
    pub declared: TyId,
    pub initialization: Initialization,
    pub single_function: FuncId,
    pub single_function_flags: u8,
}

#[derive(Copy, Clone, PartialEq, Eq)]
#[repr(u32)]
pub enum Initialization {
    Uninitialized = 0,
    Undefined = 1,
    NeverReadUninitialized = 2,
    NeverReadUninitializedStoredOnce = 3,
    Lazy = 4,
}

pub struct Module {
    pub path: StrId,
    pub init: FuncId,
    pub display_path: StrId,
    pub line_table: Vec<u8>,
    pub printed: Vec<u8>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FuncKind {
    Plain,
    Arrow,
    Method,
    Constructor,
    Module,
}

pub mod func_flags {
    pub const ASYNC: u16 = 1;
    pub const GENERATOR: u16 = 1 << 1;
    pub const IS_VALUE: u16 = 1 << 2;
    pub const HAS_REST: u16 = 1 << 3;
    pub const HAS_THIS: u16 = 1 << 4;
    pub const STARTS_EAGERLY: u16 = 1 << 5;
    pub const IS_TYPED: u16 = 1 << 6;
    pub const HAS_NEW_TARGET: u16 = 1 << 7;
    pub const IS_BUILTIN: u16 = 1 << 8;
    pub const IS_IN_BUILTIN_MODULE: u16 = 1 << 9;
    pub const IS_HIDDEN_IN_STACK_TRACES: u16 = 1 << 10;
    pub const HAS_EXPLICIT_NAME: u16 = 1 << 11;
    pub const IS_MODULE_BODY: u16 = 1 << 12;
    pub const IS_SLOPPY: u16 = 1 << 13;
    pub const IS_GENERIC_ENTRYPOINT: u16 = 1 << 14;
    pub const HAS_NO_FIELD_NAMES_ON_PROTOTYPE: u16 = 1 << 15;
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Exp,
    BitAnd,
    BitOr,
    BitXor,
    Shl,
    Shr,
    UShr,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum UnOp {
    Neg,
    ToNumber,
    ToNumeric,
    BitNot,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum RelOp {
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CoerceReason {
    Store,
    Cast,
    NonNull(StrId),
    Claim,
    Flow,
    Upcast,
    Coerce,
    Forced,
    CoerceFreshGraph,
    CastFresh,
    ArgumentClaim(u8),
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum Op {
    Undefined,
    Null,
    Bool(bool),
    Int(i64),
    Double(u64),
    Str(StrId),
    BigInt(StrId),
    Symbol(StrId),
    FuncRef(FuncId),

    GlobalGet(GlobalId),
    GlobalSet(GlobalId, V),
    FreeGet { name: StrId, is_typeof: bool },
    FreeSet { name: StrId, value: V },

    New(LayoutId),
    NewWith { layout: LayoutId, name: StrId, value: V },
    FieldGet { obj: V, layout: LayoutId, field: u32 },
    FieldSet { obj: V, layout: LayoutId, field: u32, value: V },
    Closure { func: FuncId, captures: Args },
    ClosureOnce { func: FuncId, captures: Args, env: V, field: u32 },

    PropGet { obj: V, name: StrId },
    PropSet { obj: V, name: StrId, value: V },
    PropHas { obj: V, name: StrId },
    PropDelete { obj: V, name: StrId },
    ElemGet { obj: V, key: V },
    ElemSet { obj: V, key: V, value: V },
    ElemHas { obj: V, key: V },
    ElemDelete { obj: V, key: V },

    NewArray(Args),
    NewObject,

    Binary { op: BinOp, a: V, b: V },
    Unary { op: UnOp, a: V },
    Relational { op: RelOp, a: V, b: V },
    StrictEq { a: V, b: V },
    LooseEq { a: V, b: V },
    Not(V),
    Truthy(V),
    TypeOf(V),
    InstanceOf { value: V, of: V },
    ToStr(V),
    ToKey(V),
    IsNullish(V),
    IsInstance { value: V, layout: LayoutId },
    StrConcat(Args),

    IterOpen(V),
    IterHas { iter: V, index: V },
    IterGet { iter: V, index: V },
    IterClose(V),
    IterCloseForThrow(V),

    Call { callee: V, this: V, args: Args },
    Construct { callee: V, args: Args },
    CallMethod { obj: V, name: StrId, args: Args },
    CallDirect { func: FuncId, args: Args },

    Coerce { value: V, to: TyId, why: CoerceReason },
    Caught,
    CaughtException,
    Poll,
    UnlikelyHint,
    Operation { which: Operation, args: Args },
    Yield(V),
    ResumeMode,
    ExternalModule(StrId),
    Await(V),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Target {
    pub block: BlockId,
    pub args: Args,
}

impl Target {
    pub fn new(block: BlockId) -> Target {
        Target { block, args: Args::new() }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Term {
    Jump(Target),
    Branch { cond: V, then: Target, otherwise: Target },
    Switch { value: V, cases: Vec<(i64, Target)>, default: Target },
    Return(V),
    Throw { value: V, unwind: Option<Target>, pos: u32 },
    Invoke { normal: Target, unwind: Target },
    Unreachable,
}

#[derive(Clone, Debug)]
pub enum Def {
    Param(BlockId, u32),
    Op(Op),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum Prediction {
    #[default]
    None,
    Ty(TyId),
    Closure(FuncId),
    ByKey(StrId),
    Field(TyId),
}

#[derive(Clone, Debug)]
pub struct Value {
    pub def: Def,
    pub pos: u32,
    pub ty: TyId,
    prediction_and_flags: u32,
    pub signature: TyId,
}

const _: () = assert!(size_of::<Value>() == 40);

impl Value {
    const INDEX_BITS: u32 = 26;
    const KEEPS_UNCONVERTIBLE_OBJECTS: u32 = 1 << 29;
    const IS_KNOWN_INITIALIZED: u32 = 1 << 30;
    const IS_IN_TAIL_POSITION: u32 = 1 << 31;

    #[inline]
    pub fn new(def: Def, pos: u32, ty: TyId) -> Value {
        Value { def, pos, ty, prediction_and_flags: 0, signature: TyId::NONE }
    }

    #[inline]
    pub fn prediction(&self) -> Prediction {
        let index = self.prediction_and_flags & ((1 << Self::INDEX_BITS) - 1);
        match self.prediction_and_flags >> Self::INDEX_BITS & 7 {
            1 => Prediction::Ty(TyId(index)),
            2 => Prediction::Closure(FuncId(index)),
            3 => Prediction::ByKey(StrId(index)),
            4 => Prediction::Field(TyId(index)),
            _ => Prediction::None,
        }
    }

    #[inline]
    pub fn set_prediction(&mut self, prediction: Prediction) {
        let (kind, index) = match prediction {
            Prediction::None => (0, 0),
            Prediction::Ty(ty) => (1, ty.0),
            Prediction::Closure(func) => (2, func.0),
            Prediction::ByKey(property) => (3, property.0),
            Prediction::Field(ty) => (4, ty.0),
        };
        let packed = if index < 1 << Self::INDEX_BITS { kind << Self::INDEX_BITS | index } else { 0 };
        self.prediction_and_flags = self.prediction_and_flags & (Self::KEEPS_UNCONVERTIBLE_OBJECTS | Self::IS_KNOWN_INITIALIZED | Self::IS_IN_TAIL_POSITION) | packed;
    }

    #[inline]
    pub fn is_known_initialized(&self) -> bool {
        self.prediction_and_flags & Self::IS_KNOWN_INITIALIZED != 0
    }

    #[inline]
    pub fn set_is_known_initialized(&mut self, is_known_initialized: bool) {
        self.prediction_and_flags = self.prediction_and_flags & !Self::IS_KNOWN_INITIALIZED | if is_known_initialized { Self::IS_KNOWN_INITIALIZED } else { 0 };
    }

    #[inline]
    pub fn keeps_unconvertible_objects(&self) -> bool {
        self.prediction_and_flags & Self::KEEPS_UNCONVERTIBLE_OBJECTS != 0
    }

    #[inline]
    pub fn set_keeps_unconvertible_objects(&mut self) {
        self.prediction_and_flags |= Self::KEEPS_UNCONVERTIBLE_OBJECTS;
    }

    #[inline]
    pub fn is_in_tail_position(&self) -> bool {
        self.prediction_and_flags & Self::IS_IN_TAIL_POSITION != 0
    }

    #[inline]
    pub fn set_is_in_tail_position(&mut self, is_in_tail_position: bool) {
        self.prediction_and_flags = self.prediction_and_flags & !Self::IS_IN_TAIL_POSITION | if is_in_tail_position { Self::IS_IN_TAIL_POSITION } else { 0 };
    }
}

#[derive(Default, Clone)]
pub struct Block {
    pub params: Vec<V>,
    pub ops: Vec<V>,
    pub term: Option<Term>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Span {
    pub value: V,
    pub start: u32,
    pub end: u32,
    pub step: i32,
}

pub struct Func {
    pub name: StrId,
    pub module: ModuleId,
    pub pos: u32,
    pub source_start: u32,
    pub source_end: u32,
    pub kind: FuncKind,
    pub flags: u16,
    pub length: u16,
    pub captures: Vec<TyId>,
    pub declared_this_type: TyId,
    pub params: Vec<TyId>,
    pub annotated: Vec<bool>,
    pub result: TyId,
    pub blocks: Vec<Block>,
    pub values: Vec<Value>,
    pub spans: Vec<Span>,
}

impl Func {
    pub const ENTRY: BlockId = BlockId(0);

    #[inline]
    pub fn op(&self, v: V) -> Option<&Op> {
        match &self.values[v.idx()].def {
            Def::Op(op) => Some(op),
            Def::Param(..) => None,
        }
    }
    pub fn has(&self, flag: u16) -> bool {
        self.flags & flag != 0
    }
    pub fn param_cast_reason(&self, index: usize) -> CoerceReason {
        if self.annotated.get(index) == Some(&true) { CoerceReason::Cast } else { CoerceReason::Store }
    }
    #[inline]
    pub fn ty(&self, v: V) -> TyId {
        self.values[v.idx()].ty
    }
    #[inline]
    pub fn prediction(&self, v: V) -> Prediction {
        self.values[v.idx()].prediction()
    }
    pub fn add_block(&mut self) -> BlockId {
        self.blocks.push(Block::default());
        BlockId::new(self.blocks.len() - 1)
    }
    pub fn add_param(&mut self, block: BlockId, ty: TyId) -> V {
        let index = self.blocks[block.idx()].params.len() as u32;
        let v = V::new(self.values.len());
        self.values.push(Value::new(Def::Param(block, index), 0, ty));
        self.blocks[block.idx()].params.push(v);
        v
    }
    pub fn add_value(&mut self, op: Op, pos: u32, ty: TyId) -> V {
        let v = V::new(self.values.len());
        self.values.push(Value::new(Def::Op(op), pos, ty));
        v
    }
    pub fn append(&mut self, block: BlockId, op: Op, pos: u32, ty: TyId) -> V {
        let v = self.add_value(op, pos, ty);
        self.blocks[block.idx()].ops.push(v);
        v
    }
}

impl Op {
    pub fn for_each_operand(&self, mut f: impl FnMut(V)) {
        match self {
            Op::Undefined
            | Op::Null
            | Op::Bool(_)
            | Op::Int(_)
            | Op::Double(_)
            | Op::Str(_)
            | Op::BigInt(_)
            | Op::Symbol(_)
            | Op::FuncRef(_)
            | Op::GlobalGet(_)
            | Op::FreeGet { .. }
            | Op::New(_)
            | Op::NewObject
            | Op::Caught
            | Op::CaughtException
            | Op::Poll
            | Op::UnlikelyHint
            | Op::ResumeMode
            | Op::ExternalModule(_) => {}
            Op::GlobalSet(_, a)
            | Op::FreeSet { value: a, .. }
            | Op::NewWith { value: a, .. }
            | Op::Coerce { value: a, .. }
            | Op::IsInstance { value: a, .. }
            | Op::FieldGet { obj: a, .. }
            | Op::PropGet { obj: a, .. }
            | Op::PropHas { obj: a, .. }
            | Op::PropDelete { obj: a, .. }
            | Op::Unary { a, .. }
            | Op::Not(a)
            | Op::Truthy(a)
            | Op::TypeOf(a)
            | Op::ToStr(a)
            | Op::ToKey(a)
            | Op::IsNullish(a)
            | Op::IterOpen(a)
            | Op::IterClose(a)
            | Op::IterCloseForThrow(a)
            | Op::Yield(a)
            | Op::Await(a) => f(*a),
            Op::FieldSet { obj: a, value: b, .. }
            | Op::PropSet { obj: a, value: b, .. }
            | Op::ElemGet { obj: a, key: b }
            | Op::ElemHas { obj: a, key: b }
            | Op::ElemDelete { obj: a, key: b }
            | Op::Binary { a, b, .. }
            | Op::Relational { a, b, .. }
            | Op::StrictEq { a, b }
            | Op::LooseEq { a, b }
            | Op::InstanceOf { value: a, of: b }
            | Op::IterHas { iter: a, index: b }
            | Op::IterGet { iter: a, index: b } => {
                f(*a);
                f(*b);
            }
            Op::ElemSet { obj, key, value } => {
                f(*obj);
                f(*key);
                f(*value);
            }
            Op::Closure { captures: args, .. } | Op::NewArray(args) | Op::StrConcat(args) | Op::Operation { args, .. } | Op::CallDirect { args, .. } => args.iter().copied().for_each(f),
            Op::ClosureOnce { captures, env, .. } => {
                captures.iter().copied().for_each(&mut f);
                f(*env);
            }
            Op::Call { callee, this, args } => {
                f(*callee);
                f(*this);
                args.iter().copied().for_each(f);
            }
            Op::Construct { callee: a, args } | Op::CallMethod { obj: a, args, .. } => {
                f(*a);
                args.iter().copied().for_each(f);
            }
        }
    }
}

impl Term {
    pub fn for_each_operand(&self, mut f: impl FnMut(V)) {
        match self {
            Term::Branch { cond: value, .. } | Term::Switch { value, .. } | Term::Return(value) | Term::Throw { value, .. } => f(*value),
            Term::Jump(_) | Term::Invoke { .. } | Term::Unreachable => {}
        }
        self.for_each_target(|target| target.args.iter().copied().for_each(&mut f));
    }

    pub fn for_each_target(&self, mut f: impl FnMut(&Target)) {
        match self {
            Term::Return(_) | Term::Unreachable => {}
            Term::Throw { unwind, .. } => {
                if let Some(t) = unwind {
                    f(t);
                }
            }
            Term::Jump(t) => f(t),
            Term::Branch { then, otherwise, .. } => {
                f(then);
                f(otherwise);
            }
            Term::Switch { cases, default, .. } => {
                for (_, t) in cases {
                    f(t);
                }
                f(default);
            }
            Term::Invoke { normal, unwind } => {
                f(normal);
                f(unwind);
            }
        }
    }
    pub fn for_each_target_mut(&mut self, mut f: impl FnMut(&mut Target)) {
        match self {
            Term::Return(_) | Term::Unreachable => {}
            Term::Throw { unwind, .. } => {
                if let Some(t) = unwind {
                    f(t);
                }
            }
            Term::Jump(t) => f(t),
            Term::Branch { then, otherwise, .. } => {
                f(then);
                f(otherwise);
            }
            Term::Switch { cases, default, .. } => {
                for (_, t) in cases {
                    f(t);
                }
                f(default);
            }
            Term::Invoke { normal, unwind } => {
                f(normal);
                f(unwind);
            }
        }
    }
}

#[derive(Default)]
pub struct Program {
    pub strs: Strs,
    pub tys: DeclaredTable,
    pub layouts: Vec<Layout>,
    pub funcs: Vec<Func>,
    pub globals: Vec<Global>,
    pub modules: Vec<Module>,
    pub extended_globals: Vec<StrId>,
    pub prototype_property_names: Vec<StrId>,
    pub regexp_literals: Vec<(StrId, StrId)>,
    pub webassembly_modules: Vec<Vec<u8>>,
    pub logs_type_errors: bool,
    pub flagged_values: Vec<Vec<V>>,
    pub builtin_modules: Vec<(u32, FuncId)>,
    pub builtin_functions: Vec<(u32, FuncId, u32)>,
    pub functions_by_key: Vec<(StrId, StrId, FuncId)>,
    pub single_structure_accesses: Vec<(FuncId, V)>,
    pub declared_parameter_types: rustc_hash::FxHashMap<u32, Vec<TyId>>,
    pub may_receive_untyped_arguments: rustc_hash::FxHashSet<u32>,
    pub known_slots: Vec<(FuncId, V, u32)>,
    pub entries: Vec<FuncId>,
}

impl Default for FuncId {
    fn default() -> FuncId {
        FuncId::NONE
    }
}
