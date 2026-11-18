use core::cell::{Cell, RefCell};
use core::mem::offset_of;
use core::sync::atomic::{AtomicI32, Ordering};
use std::rc::Rc;

use bun_engine_macros::{Trace, cell};
use bun_engine_number::canonical_numeric_index;
use bun_engine_text::{Identifier, PropertyName, names};

use super::property_table::{Keys, PropertyEntry, PropertyTable};
use super::static_table::StaticProperty;
use super::transition_table::{TransitionKey, TransitionKind, TransitionTable};
use crate::heap::{CellState, OnceBox, Scope, Survivors, shape_base};
use crate::{
    Attributes, CellKind, CellType, Class, DeferredFire, DontEnumMode, ElementKind, ErrorInstance,
    FastHashMap, Field, Gc, GlobalObject, GlobalProxy, ImmutableArray, IndexingMode,
    InlineWatchpointSet, JsArray, JsCell, JsFunction, JsObject, JsString, JsTypedArray,
    MappedArguments, ModuleNamespace, NoGc, PropertyNameEnumerator, PropertyNameList,
    PropertyNameMode, PropertyOffset, ProxyObject, PutContext, StaticTable, StringObject,
    TypeFlags, Value, Visitor, Vm, WatchpointSet, WatchpointState,
};

/// The address of a shape in 32 bits. It does not keep the shape alive, except in the header of a cell.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[repr(transparent)]
pub struct ShapeId(u32);

impl ShapeId {
    pub const NONE: ShapeId = ShapeId(0);
    pub const NUKED_BIT: u32 = 1;
    /// What every id that is not nuked has under `LAST_BITS_MASK`. Caches flip them to tag it.
    pub const LAST_BITS: u32 = 0b0010;
    pub const LAST_BITS_MASK: u32 = 0b1111;

    #[inline(always)]
    pub const fn from_bits(bits: u32) -> ShapeId {
        ShapeId(bits)
    }

    #[inline(always)]
    pub const fn bits(self) -> u32 {
        self.0
    }

    #[inline(always)]
    pub const fn is_none(self) -> bool {
        self.0 == 0
    }

    #[inline(always)]
    pub(crate) const fn nuked(self) -> ShapeId {
        ShapeId(self.0 | Self::NUKED_BIT)
    }

    #[inline(always)]
    pub(crate) const fn is_nuked(self) -> bool {
        self.0 & Self::NUKED_BIT != 0
    }

    #[inline(always)]
    pub(crate) fn address(self) -> usize {
        shape_base() + (self.0 & !Self::NUKED_BIT) as usize
    }

    /// # Safety
    /// The shape is alive, and the id is not nuked.
    #[inline(always)]
    pub unsafe fn decode(self) -> Gc<Shape> {
        debug_assert!(!self.is_none() && !self.is_nuked());
        // SAFETY: the caller's.
        unsafe { Gc::from_address(shape_base() + self.0 as usize) }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct ShapeFlags: u32 {
        /// Belongs to one object. Properties are added in place, so only presence can be cached.
        const CACHEABLE_DICTIONARY = 1 << 0;
        /// Belongs to one object. Everything changes in place.
        const UNCACHEABLE_DICTIONARY = 1 << 1;
        /// The table cannot be rebuilt from the previous shapes.
        const IS_PINNED = 1 << 2;
        const HAS_ANY_ACCESSOR = 1 << 3;
        const HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO = 1 << 4;
        const PREVENTS_QUICK_ENUMERATION = 1 << 5;
        const HAS_NON_ENUMERABLE = 1 << 6;
        const HAS_NON_CONFIGURABLE = 1 << 7;
        const HAS_NON_CONFIGURABLE_READ_ONLY_OR_ACCESSOR = 1 << 8;
        const HAS_UNDERSCORE_PROTO = 1 << 9;
        const HAS_THEN = 1 << 10;
        const DID_PREVENT_EXTENSIONS = 1 << 11;
        const DID_TRANSITION = 1 << 12;
        const STATIC_PROPERTIES_REIFIED = 1 << 13;
        const HAS_BEEN_FLATTENED = 1 << 14;
        const HAS_BEEN_DICTIONARY = 1 << 15;
        const TRANSITION_IS_LIKELY = 1 << 16;
        const MAY_BE_PROTOTYPE = 1 << 17;
        const IS_WATCHING_REPLACEMENT = 1 << 18;
        const MAY_HAVE_INDEXED_ACCESSORS = 1 << 19;
        /// Of dense elements.
        const ELEMENTS_ARE_SEALED = 1 << 20;
        /// Of dense elements.
        const ELEMENTS_ARE_FROZEN = 1 << 21;
        const LENGTH_IS_READ_ONLY = 1 << 22;
        /// Belongs to one object, which exists.
        const IS_CLAIMED = 1 << 23;
        /// Has or has had a property of that name, so a function no longer makes it on demand.
        const HAS_REIFIED_LENGTH = 1 << 24;
        const HAS_REIFIED_NAME = 1 << 25;
        const HAS_PRIVATE_NAMES = 1 << 26;
        /// The own keys of an instance have been listed before.
        const DID_LIST_NAMES = 1 << 27;
        /// There is no telling what the internal methods that get a name do.
        const HAS_FOREIGN_METHODS = 1 << 30;

        const DICTIONARY = Self::CACHEABLE_DICTIONARY.bits() | Self::UNCACHEABLE_DICTIONARY.bits();
        const NOT_INHERITED = Self::IS_PINNED.bits() | Self::IS_WATCHING_REPLACEMENT.bits()
            | Self::DID_LIST_NAMES.bits();
        const MAY_HAVE_ANY_ATTRIBUTES = Self::HAS_NON_ENUMERABLE.bits() | Self::HAS_NON_CONFIGURABLE.bits()
            | Self::HAS_NON_CONFIGURABLE_READ_ONLY_OR_ACCESSOR.bits();
        /// Without these, an object as the target of a proxy leaves the traps free to answer anything.
        const BINDS_GET_AND_SET_TRAPS = Self::HAS_NON_CONFIGURABLE_READ_ONLY_OR_ACCESSOR.bits();
        const BINDS_OTHER_TRAPS = Self::DID_PREVENT_EXTENSIONS.bits() | Self::HAS_NON_CONFIGURABLE.bits();
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CachedNames {
    EnumerableStrings,
    Strings,
    Symbols,
    StringsAndSymbols,
}

#[derive(Trace)]
#[repr(C)]
pub struct ShapeRareData {
    pub(crate) enumerator: Field<Option<Gc<PropertyNameEnumerator>>>,
    /// The `Vm::full_prototype_chain_epoch` in which the enumerator was found to be right for any instance.
    pub(crate) enumerator_epoch: Cell<u64>,
    cached_names: [Field<Option<Gc<ImmutableArray>>>; 4],
    /// What `Object.prototype.toString` makes of the cached `Symbol.toStringTag`.
    pub(super) tagged_string: Field<Option<Gc<JsString>>>,
    pub(crate) special_properties: super::special_property_cache::SpecialPropertyCache,
    pub(crate) json_plan: crate::json::Plan,
    replacement_sets: RefCell<FastHashMap<PropertyOffset, Rc<WatchpointSet>>>,
    active_replacement_sets: Cell<u32>,
}

impl ShapeRareData {
    pub const OFFSET_OF_ENUMERATOR: usize = offset_of!(ShapeRareData, enumerator);
    pub const OFFSET_OF_ENUMERATOR_EPOCH: usize = offset_of!(ShapeRareData, enumerator_epoch);

    pub const fn offset_of_cached_names(kind: CachedNames) -> usize {
        offset_of!(ShapeRareData, cached_names) + kind as usize * size_of::<u64>()
    }
}

impl Default for ShapeRareData {
    fn default() -> ShapeRareData {
        ShapeRareData {
            replacement_sets: RefCell::default(),
            active_replacement_sets: Cell::new(0),
            cached_names: core::array::from_fn(|_| Field::new(None)),
            enumerator: Field::new(None),
            enumerator_epoch: Cell::new(0),
            tagged_string: Field::new(None),
            special_properties: Default::default(),
            json_plan: Default::default(),
        }
    }
}

/// What objects with the same class, prototype and properties share.
#[cell(name = "Structure", cell_type = Shape, export = "engine_class_Shape", flags = TypeFlags::SHAPE_IS_IMMORTAL,
    visit_children, reconcile_weak_references, estimated_size)]
pub struct Shape {
    base: JsCell,
    /// The second half of the header of an instance.
    instance_header: u32,
    out_of_line_type_flags: u16,
    inline_capacity: u8,
    transition_kind: Cell<TransitionKind>,
    flags: Cell<ShapeFlags>,
    max_offset: AtomicI32,
    transition_offset: Cell<PropertyOffset>,
    transition_attributes: Cell<u8>,
    transition_count: Cell<u8>,
    has_survived: Cell<bool>,
    /// The union of the addresses of all names that have been added.
    seen_names: Cell<usize>,
    pub global: Field<Option<Gc<GlobalObject>>>,
    pub(self) stored_prototype: Field<Value>,
    pub(self) previous_shape: Field<Option<Gc<Shape>>>,
    instance_class: &'static Class,
    /// The `Vm::full_prototype_chain_epoch` in which `JsObject::has_only_own_elements` was found to hold.
    pub(super) own_elements_epoch: Cell<u64>,
    transition_name: Cell<Option<Identifier>>,
    /// A bit for each of the first slots: there is code that replaces the value and tells nobody.
    silently_replaced_slots: Cell<u64>,
    transitions: TransitionTable,
    table: Cell<Option<Rc<PropertyTable>>>,
    transition_watchpoints: InlineWatchpointSet,
    rare_data: OnceBox<ShapeRareData>,
}

/// The properties that a shape had when it was asked.
#[repr(transparent)]
pub struct Properties(Option<Rc<PropertyTable>>);

impl Properties {
    pub(super) const NONE: Properties = Properties(None);

    pub(super) fn keys(&self, kinds: PropertyNameMode, mode: DontEnumMode) -> Option<Keys<'_>> {
        Some(self.0.as_ref()?.keys(kinds, mode))
    }

    /// With those that have been removed.
    pub fn entries(&self) -> &[PropertyEntry] {
        self.0.as_ref().map_or_default(|table| table.entries())
    }

    pub fn iter(&self) -> impl Iterator<Item = (PropertyName<'_>, PropertyOffset, Attributes)> {
        self.0.iter().flat_map(|table| table.iter())
    }

    /// Whether the shape has the same entries now. Whoever changes a table that is shared makes a copy.
    #[inline]
    pub(crate) fn are_those_of(&self, shape: &Shape) -> bool {
        match &self.0 {
            Some(table) => shape.peek_table(|it| it.is_some_and(|it| Rc::ptr_eq(it, table))),
            None => !shape.max_offset().is_valid(),
        }
    }

    pub fn len(&self) -> usize {
        self.0.as_ref().map_or(0, |table| table.len())
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// What a new root shape describes.
#[derive(Clone, Copy)]
pub struct ShapeSpec {
    class: &'static Class,
    cell_type: CellType,
    flags: TypeFlags,
    indexing_mode: IndexingMode,
    inline_capacity: u8,
}

impl ShapeSpec {
    pub const fn of<T: CellKind>() -> ShapeSpec {
        ShapeSpec {
            class: T::CLASS,
            cell_type: T::CELL_TYPE,
            flags: T::FLAGS,
            indexing_mode: IndexingMode::NON_ARRAY,
            inline_capacity: 0,
        }
    }

    /// # Safety
    /// What the arguments say is true of the cells that are made with the shape.
    pub const unsafe fn from_parts(
        class: &'static Class,
        cell_type: CellType,
        flags: TypeFlags,
        indexing_mode: IndexingMode,
        inline_capacity: u8,
    ) -> ShapeSpec {
        ShapeSpec {
            class,
            cell_type,
            flags,
            indexing_mode,
            inline_capacity,
        }
    }

    /// Panics unless the type is one of those of the class.
    pub const fn with_type(mut self, cell_type: CellType) -> ShapeSpec {
        assert!(self.class.types().contains(cell_type));
        self.cell_type = cell_type;
        self
    }

    pub const fn with_flags(mut self, flags: TypeFlags) -> ShapeSpec {
        self.flags = self.flags.union(flags);
        self
    }

    pub(crate) const fn with_mutable_prototype(mut self) -> ShapeSpec {
        self.flags = (self.flags).difference(TypeFlags::IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT);
        self
    }

    /// For `Array.prototype`.
    pub const fn array_without_elements(self) -> ShapeSpec {
        self.with_indexing_mode(IndexingMode::array(ElementKind::None))
    }

    pub(crate) const fn with_indexing_mode(mut self, mode: IndexingMode) -> ShapeSpec {
        self.indexing_mode = mode;
        self
    }

    pub(crate) const fn with_inline_capacity(mut self, capacity: usize) -> ShapeSpec {
        assert!(capacity < PropertyOffset::FIRST_OUT_OF_LINE as usize);
        self.inline_capacity = capacity as u8;
        self
    }

    pub(super) const fn instance_header(self) -> u32 {
        instance_header(self.indexing_mode, self.cell_type, self.flags)
    }

    pub(super) fn identity(self) -> (&'static Class, u32) {
        let header = self.instance_header();
        let capacity = u32::from(self.inline_capacity);
        (self.class, header & 0x00ff_ffff | capacity << 24)
    }

    fn initial_flags(self) -> ShapeFlags {
        let mut flags = ShapeFlags::empty();
        if self
            .flags
            .contains(TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT)
        {
            flags |= ShapeFlags::HAS_NON_ENUMERABLE | ShapeFlags::HAS_NON_CONFIGURABLE;
            if self.cell_type != CellType::Array {
                flags |= ShapeFlags::HAS_NON_CONFIGURABLE_READ_ONLY_OR_ACCESSOR;
            }
        }
        if self.cell_type.is_object()
            && !(self.class).treats_names_like(class_for_type(self.cell_type))
        {
            assert!(!matches!(
                self.cell_type,
                CellType::FinalObject | CellType::Array
            ));
            flags |= ShapeFlags::HAS_FOREIGN_METHODS;
        }
        if self.indexing_mode.kind() == ElementKind::Sparse {
            flags |= ShapeFlags::MAY_HAVE_ANY_ATTRIBUTES;
        }
        if self.flags.contains(TypeFlags::OVERRIDES_IS_EXTENSIBLE) {
            flags |= ShapeFlags::DID_PREVENT_EXTENSIONS;
        }
        if self.flags.contains(TypeFlags::HAS_STATIC_PROPERTY_TABLE) {
            for table in self.class.ancestry().filter_map(Class::static_table) {
                flags |= flags_for_attributes(table.seen_attributes());
                if table.find(names::then).is_some() {
                    flags |= ShapeFlags::HAS_THEN;
                }
            }
            flags -= ShapeFlags::PREVENTS_QUICK_ENUMERATION;
        }
        flags
    }
}

/// The one whose internal methods objects of that type have, unless theirs overrides them.
#[inline]
fn class_for_type(cell_type: CellType) -> &'static Class {
    match cell_type {
        CellType::Array | CellType::DerivedArray => JsArray::CLASS,
        CellType::StringObject | CellType::DerivedStringObject => StringObject::CLASS,
        CellType::Function => JsFunction::CLASS,
        CellType::ErrorInstance => ErrorInstance::CLASS,
        CellType::DirectArguments | CellType::ScopedArguments => MappedArguments::CLASS,
        CellType::GlobalObject => GlobalObject::CLASS,
        CellType::GlobalProxy => GlobalProxy::CLASS,
        CellType::Proxy => ProxyObject::CLASS,
        CellType::ModuleNamespaceObject => ModuleNamespace::CLASS,
        other if CellType::TYPED_ARRAYS.contains(other) => JsTypedArray::CLASS,
        _ => JsObject::CLASS,
    }
}

fn flags_for_attributes(attributes: Attributes) -> ShapeFlags {
    let mut flags = ShapeFlags::empty();
    if attributes.contains(Attributes::DONT_ENUM) {
        flags |= ShapeFlags::HAS_NON_ENUMERABLE | ShapeFlags::PREVENTS_QUICK_ENUMERATION;
    }
    if attributes.intersects(Attributes::ANY_ACCESSOR) {
        flags |= ShapeFlags::HAS_ANY_ACCESSOR;
    }
    if attributes.intersects(Attributes::ANY_ACCESSOR | Attributes::READ_ONLY) {
        flags |= ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO;
        if attributes.contains(Attributes::DONT_DELETE) {
            flags |= ShapeFlags::HAS_NON_CONFIGURABLE_READ_ONLY_OR_ACCESSOR;
        }
    }
    if attributes.contains(Attributes::DONT_DELETE) {
        flags |= ShapeFlags::HAS_NON_CONFIGURABLE;
    }
    flags
}

const fn instance_header(mode: IndexingMode, cell_type: CellType, flags: TypeFlags) -> u32 {
    u32::from_le_bytes([
        mode.bits(),
        cell_type.0,
        flags.bits() as u8,
        CellState::DefinitelyWhite as u8,
    ])
}

impl Shape {
    pub const OFFSET_OF_INSTANCE_HEADER: usize = offset_of!(Shape, instance_header);
    pub const OFFSET_OF_INLINE_CAPACITY: usize = offset_of!(Shape, inline_capacity);
    pub const OFFSET_OF_FLAGS: usize = offset_of!(Shape, flags);
    pub const OFFSET_OF_OWN_ELEMENTS_EPOCH: usize = offset_of!(Shape, own_elements_epoch);
    pub const OFFSET_OF_GLOBAL: usize = offset_of!(Shape, global);
    pub const OFFSET_OF_PROTOTYPE: usize = offset_of!(Shape, stored_prototype);
    pub const OFFSET_OF_CLASS: usize = offset_of!(Shape, instance_class);
    pub const OFFSET_OF_RARE_DATA: usize = offset_of!(Shape, rare_data);

    pub(crate) const MAX_TRANSITIONS: usize = 128;
    pub const MAX_TRANSITIONS_BY_PUT_BY_ID: usize = 512;
    const MAX_SLOTS_FOR_REMOVAL: usize = 4096;

    fn root_init(
        shape_of_shapes: Gc<Shape>,
        global: Option<Gc<GlobalObject>>,
        prototype: Value,
        spec: ShapeSpec,
    ) -> ShapeInit {
        ShapeInit {
            base: shape_of_shapes,
            instance_header: instance_header(spec.indexing_mode, spec.cell_type, spec.flags),
            out_of_line_type_flags: (spec.flags.bits() >> 8) as u16,
            inline_capacity: spec.inline_capacity,
            transition_kind: Cell::new(TransitionKind::None),
            flags: Cell::new(spec.initial_flags()),
            max_offset: AtomicI32::new(PropertyOffset::INVALID.get()),
            transition_offset: Cell::new(PropertyOffset::INVALID),
            transition_attributes: Cell::new(0),
            transition_count: Cell::new(0),
            has_survived: Cell::new(false),
            seen_names: Cell::new(0),
            own_elements_epoch: Cell::new(0),
            global,
            stored_prototype: prototype,
            previous_shape: None,
            instance_class: spec.class,
            transition_name: Cell::new(None),
            silently_replaced_slots: Cell::new(0),
            transitions: TransitionTable::default(),
            table: Cell::new(None),
            transition_watchpoints: InlineWatchpointSet::new(WatchpointState::Watched),
            rare_data: OnceBox::new(),
        }
    }

    /// The shape of shapes, which is its own.
    pub(crate) fn bootstrap(vm: &Vm) -> Gc<Shape> {
        let spec = ShapeSpec::of::<Shape>();
        let address = vm.heap.shapes.allocator.try_allocate(&vm.heap);
        if address == 0 {
            bun_alloc::out_of_memory();
        }
        // SAFETY: a new cell. The header is copied from the one field that is written first.
        unsafe {
            let shape = Gc::<Shape>::from_address(address);
            (&raw mut (*shape.as_ptr()).instance_header).write(instance_header(
                spec.indexing_mode,
                spec.cell_type,
                spec.flags,
            ));
            let init = Self::root_init(shape, None, Value::NULL, spec);
            Shape::initialize(shape.as_ptr(), init);
            shape
        }
    }

    /// Panics unless `prototype` is an object or null.
    pub fn create(
        vm: &Vm,
        global: Option<Gc<GlobalObject>>,
        prototype: Value,
        mut spec: ShapeSpec,
    ) -> Gc<Shape> {
        // Compiled code reads the length of what has that type.
        assert!(spec.cell_type != CellType::Array || spec.indexing_mode.has_elements());
        match prototype.as_object() {
            Some(object) => {
                object.did_become_prototype(vm);
                if spec.indexing_mode.has_elements() {
                    object.will_have_heirs_with_elements();
                    if object.chain_may_intercept_indexed_access() {
                        spec.indexing_mode = spec.indexing_mode.slow_put();
                    }
                }
            }
            None => assert!(prototype.is_null()),
        }
        let init = Self::root_init(vm.shapes.shape(), global, prototype, spec);
        vm.allocate::<Shape>(init)
    }

    /// For a type `T` that extends this one and describes objects without storage.
    pub fn init_for_objects_without_storage<T: CellKind>(vm: &Vm, spec: ShapeSpec) -> ShapeInit {
        assert!(!spec.cell_type.has_storage());
        let init = Self::root_init(vm.shape_for::<T>(), None, Value::NULL, spec);
        init.flags.update(|it| it | ShapeFlags::MAY_BE_PROTOTYPE);
        init
    }

    /// For an object that is the only one of its kind and is about to get many properties.
    pub fn create_dictionary(
        vm: &Vm,
        global: Option<Gc<GlobalObject>>,
        prototype: Value,
        spec: ShapeSpec,
    ) -> Gc<Shape> {
        let shape = Self::create(vm, global, prototype, spec);
        shape.set_flags(ShapeFlags::CACHEABLE_DICTIONARY | ShapeFlags::IS_PINNED);
        shape
    }

    fn derive(
        &self,
        vm: &Vm,
        kind: TransitionKind,
        mode: IndexingMode,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        assert!(self.instance_type().has_storage());
        if self.transition_watchpoints.is_being_watched() {
            self.set_flags(ShapeFlags::TRANSITION_IS_LIKELY);
        }
        let shape = vm.allocate::<Shape>(ShapeInit {
            base: vm.shapes.shape(),
            instance_header: self.instance_header & !0xff | u32::from(mode.bits()),
            out_of_line_type_flags: self.out_of_line_type_flags,
            inline_capacity: self.inline_capacity,
            transition_kind: Cell::new(kind),
            flags: Cell::new(
                (self.flags() - ShapeFlags::NOT_INHERITED) | ShapeFlags::DID_TRANSITION,
            ),
            max_offset: AtomicI32::new(self.max_offset().get()),
            transition_offset: Cell::new(PropertyOffset::INVALID),
            transition_attributes: Cell::new(0),
            transition_count: Cell::new(self.transition_count.get().saturating_add(1)),
            has_survived: Cell::new(false),
            seen_names: self.seen_names.clone(),
            own_elements_epoch: Cell::new(0),
            global: self.global(),
            stored_prototype: self.prototype(),
            previous_shape: Some(self.into()),
            instance_class: self.instance_class,
            transition_name: Cell::new(None),
            silently_replaced_slots: Cell::new(0),
            transitions: TransitionTable::default(),
            table: Cell::new(None),
            transition_watchpoints: InlineWatchpointSet::new(WatchpointState::Watched),
            rare_data: OnceBox::new(),
        });
        self.transition_watchpoints.invalidate_into(deferred);
        shape
    }

    #[inline(always)]
    pub fn id(&self) -> ShapeId {
        ShapeId((self.address() - shape_base()) as u32)
    }

    #[inline(always)]
    pub fn instance_header(&self) -> u32 {
        self.instance_header
    }

    #[inline(always)]
    pub fn instance_indexing_mode(&self) -> IndexingMode {
        // SAFETY: what the header was made of.
        unsafe { IndexingMode::from_bits_unchecked(self.instance_header as u8) }
    }

    #[inline(always)]
    pub fn instance_type(&self) -> CellType {
        CellType((self.instance_header >> 8) as u8)
    }

    #[inline(always)]
    pub fn type_flags(&self) -> TypeFlags {
        TypeFlags::from_bits_retain(
            self.instance_header >> 16 & 0xff | u32::from(self.out_of_line_type_flags) << 8,
        )
    }

    /// That of the instances.
    #[inline(always)]
    pub fn class(&self) -> &'static Class {
        self.instance_class
    }

    #[inline(always)]
    pub fn inline_capacity(&self) -> usize {
        usize::from(self.inline_capacity)
    }

    /// An object or null.
    #[inline(always)]
    pub fn prototype(&self) -> Value {
        self.stored_prototype()
    }

    #[inline(always)]
    pub fn prototype_object(&self) -> Option<Gc<JsObject>> {
        // SAFETY: an object if it is a cell.
        self.prototype()
            .as_cell()
            .map(|cell| unsafe { cell.cast_unchecked() })
    }

    pub fn previous(&self) -> Option<Gc<Shape>> {
        self.previous_shape()
    }

    #[inline(always)]
    pub fn flags(&self) -> ShapeFlags {
        self.flags.get()
    }

    #[inline(always)]
    pub fn has(&self, flags: ShapeFlags) -> bool {
        self.flags().intersects(flags)
    }

    #[inline(always)]
    pub(crate) fn set_flags(&self, flags: ShapeFlags) {
        self.flags.set(self.flags() | flags);
    }

    #[inline(always)]
    pub fn is_dictionary(&self) -> bool {
        self.has(ShapeFlags::DICTIONARY)
    }

    #[inline(always)]
    pub fn is_uncacheable_dictionary(&self) -> bool {
        self.has(ShapeFlags::UNCACHEABLE_DICTIONARY)
    }

    #[inline(always)]
    pub fn is_extensible(&self) -> bool {
        !self.has(ShapeFlags::DID_PREVENT_EXTENSIONS)
    }

    #[inline(always)]
    pub fn may_be_prototype(&self) -> bool {
        self.has(ShapeFlags::MAY_BE_PROTOTYPE)
    }

    #[inline(always)]
    pub fn has_non_reified_static_properties(&self) -> bool {
        self.type_flags()
            .contains(TypeFlags::HAS_STATIC_PROPERTY_TABLE)
            && !self.has(ShapeFlags::STATIC_PROPERTIES_REIFIED)
    }

    #[inline]
    pub fn may_intercept_indexed_access(&self) -> bool {
        self.has(ShapeFlags::MAY_HAVE_INDEXED_ACCESSORS)
            || self
                .type_flags()
                .contains(TypeFlags::INTERCEPTS_INDEXED_ACCESS)
    }

    pub fn property_accesses_are_cacheable(&self) -> bool {
        !self.is_uncacheable_dictionary() && self.class_allows_property_caching()
    }

    pub(crate) fn class_allows_property_caching(&self) -> bool {
        !self.type_flags().intersects(
            TypeFlags::PROHIBITS_PROPERTY_CACHING | TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE,
        )
    }

    pub fn absence_is_cacheable(&self) -> bool {
        !self.is_dictionary()
            && !self
                .type_flags()
                .contains(TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE)
    }

    /// Whether the internal methods of an instance do for the name, which is no index, what those of ordinary objects do.
    #[inline]
    pub(crate) fn is_ordinary_name(&self, name: PropertyName<'_>) -> bool {
        !self.has(ShapeFlags::HAS_FOREIGN_METHODS)
            && match self.instance_type() {
                CellType::Array
                | CellType::DerivedArray
                | CellType::StringObject
                | CellType::DerivedStringObject => name != names::length,
                CellType::Function => {
                    name != names::length && name != names::name && name != names::prototype
                }
                CellType::ErrorInstance => !ErrorInstance::is_lazy_property(name),
                other if CellType::TYPED_ARRAYS.contains(other) => {
                    name.is_symbol() || canonical_numeric_index(name.text()).is_none()
                }
                other => class_for_type(other).is(JsObject::CLASS),
            }
    }

    /// The same for `[[Set]]` alone. A cache does a store by itself only if this holds for each prototype that it gets to.
    pub(crate) fn stores_ordinarily(&self, name: PropertyName<'_>) -> bool {
        let flags = self.type_flags();
        !flags.contains(TypeFlags::OVERRIDES_GET_PROTOTYPE)
            && (!flags.contains(TypeFlags::OVERRIDES_PUT) || self.is_ordinary_name(name))
    }

    /// And only if this holds for the receiver: the slot says all that `[[Set]]` has done.
    pub(crate) fn reports_stores(&self) -> bool {
        !(self.type_flags().contains(TypeFlags::OVERRIDES_PUT)
            && self.has(ShapeFlags::HAS_FOREIGN_METHODS))
    }

    /// Each property in the table is enumerable, has a string for a key, and a plain value in the slot whose number is
    /// its position.
    #[inline]
    pub fn has_properties_in_slot_order(&self) -> bool {
        !self.has(
            ShapeFlags::PREVENTS_QUICK_ENUMERATION
                | ShapeFlags::HAS_ANY_ACCESSOR
                | ShapeFlags::UNCACHEABLE_DICTIONARY,
        )
    }

    /// The table and the elements have all own properties, and reading those of the table runs no code.
    #[inline]
    pub fn has_only_stored_properties(&self) -> bool {
        !self.type_flags().intersects(
            TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT
                | TypeFlags::OVERRIDES_OWN_PROPERTY_NAMES
                | TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES,
        ) && !self.has(ShapeFlags::HAS_ANY_ACCESSOR)
            && !self.has_non_reified_static_properties()
    }

    #[inline(always)]
    pub fn max_offset(&self) -> PropertyOffset {
        self.load_max_offset(Ordering::Relaxed)
    }

    #[inline(always)]
    pub(super) fn load_max_offset(&self, order: Ordering) -> PropertyOffset {
        PropertyOffset::new(self.max_offset.load(order))
    }

    #[inline(always)]
    pub(super) fn set_max_offset(&self, offset: PropertyOffset) {
        self.max_offset.store(offset.get(), Ordering::Release);
    }

    #[inline(always)]
    pub fn out_of_line_capacity(&self) -> usize {
        self.max_offset().out_of_line_capacity()
    }

    #[inline(always)]
    pub fn out_of_line_size(&self) -> usize {
        self.max_offset().out_of_line_size()
    }

    pub fn inline_size(&self) -> usize {
        ((self.max_offset().get() + 1) as usize).min(self.inline_capacity())
    }

    pub fn slot_count(&self) -> usize {
        self.max_offset().slot_count(self.inline_capacity())
    }

    /// Whether an instance has a slot there.
    #[inline(always)]
    pub fn is_valid_offset(&self, offset: PropertyOffset) -> bool {
        offset.is_valid()
            && offset <= self.max_offset()
            && (!offset.is_inline() || (offset.get() as usize) < self.inline_capacity())
    }

    pub fn transition_kind(&self) -> TransitionKind {
        self.transition_kind.get()
    }

    pub fn transition_offset(&self) -> PropertyOffset {
        self.transition_offset.get()
    }

    pub fn transition_attributes(&self) -> Attributes {
        Attributes::from_bits_retain(u32::from(self.transition_attributes.get()))
    }

    pub fn transition_name(&self) -> Option<Identifier> {
        self.peek_transition_name(|name| name.cloned())
    }

    #[inline(always)]
    fn transition_name_address(&self) -> usize {
        // SAFETY: a pointer or null.
        unsafe { self.transition_name.as_ptr().cast::<*const u8>().read() }.addr()
    }

    fn peek_transition_name<R>(&self, read: impl FnOnce(Option<&Identifier>) -> R) -> R {
        let name = self.transition_name.take();
        let result = read(name.as_ref());
        self.transition_name.set(name);
        result
    }

    #[inline(always)]
    pub(super) fn transition_key(&self) -> TransitionKey {
        let address = if self.transition_kind() == TransitionKind::ChangePrototype {
            self.prototype().to_bits() as usize
        } else {
            self.transition_name_address()
        };
        TransitionKey::new(
            address,
            self.transition_attributes(),
            self.transition_kind(),
        )
    }

    fn add_transition(&self, target: &Shape) {
        if self.has(ShapeFlags::IS_CLAIMED) {
            return;
        }
        self.transitions.add(target);
        self.write_barrier_for_cell();
    }

    #[inline(always)]
    pub fn transition_watchpoints(&self) -> &InlineWatchpointSet {
        &self.transition_watchpoints
    }

    /// Whether compiled code should count on instances keeping this shape.
    pub fn is_worth_watching(&self) -> bool {
        self.transition_watchpoints.is_still_valid()
            && !self.has(ShapeFlags::TRANSITION_IS_LIKELY | ShapeFlags::HAS_BEEN_DICTIONARY)
            && !self.is_dictionary()
    }

    #[inline(always)]
    pub(crate) fn rare_data(&self) -> Option<&ShapeRareData> {
        self.rare_data.get()
    }

    pub(crate) fn ensure_rare_data(&self) -> &ShapeRareData {
        self.rare_data.get_or_default()
    }

    #[inline(always)]
    fn peek_table<R>(&self, read: impl FnOnce(Option<&Rc<PropertyTable>>) -> R) -> R {
        // SAFETY: the callers in this file do not replace the table meanwhile.
        read(unsafe { &*self.table.as_ptr() }.as_ref())
    }

    #[cold]
    #[inline(never)]
    fn materialize_table(&self) -> Rc<PropertyTable> {
        let capacity = self.slot_count() + 1;
        let mut chain = crate::heap::root_vec();
        let mut shape = Some(Gc::from(self));
        let mut table = loop {
            let Some(current) = shape else {
                break PropertyTable::with_capacity(capacity);
            };
            let copy = current.peek_table(|it| it.map(|it| it.clone_with_capacity(capacity)));
            if let Some(copy) = copy {
                break copy;
            }
            chain.push(current);
            shape = current.previous();
        };
        for step in chain.iter().rev() {
            let attributes = step.transition_attributes();
            let offset = step.peek_transition_name(|name| {
                let name = name?.name();
                match step.transition_kind() {
                    TransitionKind::AddProperty => {
                        Some(table.add(name, attributes, self.inline_capacity()))
                    }
                    TransitionKind::RemoveProperty => table.remove(name),
                    TransitionKind::ChangeAttributes => table.set_attributes(name, attributes),
                    _ => unreachable!(),
                }
            });
            debug_assert!(offset.unwrap_or(PropertyOffset::INVALID) == step.transition_offset());
        }
        Rc::new(table)
    }

    #[inline]
    fn set_table(&self, table: Rc<PropertyTable>) {
        let growth = table.take_growth();
        self.table.set(Some(table));
        if growth != 0 {
            self.heap().note_extra_memory_allocated(self, growth);
        }
    }

    #[inline(always)]
    fn ensure_table(&self) {
        if self.peek_table(|table| table.is_none()) {
            self.set_table(self.materialize_table());
        }
    }

    fn take_table_or_clone_if_pinned(&self) -> Rc<PropertyTable> {
        if self.has(ShapeFlags::IS_PINNED) {
            return self.share_table();
        }
        self.table
            .take()
            .unwrap_or_else(|| self.materialize_table())
    }

    /// Whoever changes it first makes a copy.
    fn share_table(&self) -> Rc<PropertyTable> {
        self.peek_table(|table| table.cloned())
            .unwrap_or_else(|| self.materialize_table())
    }

    #[inline]
    fn change_table<R>(&self, change: impl FnOnce(&mut PropertyTable) -> R) -> R {
        let mut table = self
            .table
            .take()
            .unwrap_or_else(|| self.materialize_table());
        let result = change(Rc::make_mut(&mut table));
        self.set_table(table);
        result
    }

    fn pin(&self) {
        self.ensure_table();
        self.set_flags(ShapeFlags::IS_PINNED);
        self.set_previous_shape(None);
        self.transition_name.take();
        self.transition_count.set(0);
    }

    #[inline(always)]
    pub fn rules_out(&self, name: PropertyName<'_>) -> bool {
        name.address() & !self.seen_names.get() != 0
    }

    #[inline]
    pub fn get(&self, name: PropertyName<'_>) -> Option<(PropertyOffset, Attributes)> {
        if self.rules_out(name) {
            return None;
        }
        match self.peek_table(|table| table.map(|table| table.get(name))) {
            Some(found) => found,
            None => self.get_slow(name),
        }
    }

    #[inline(never)]
    fn get_slow(&self, name: PropertyName<'_>) -> Option<(PropertyOffset, Attributes)> {
        self.ensure_table();
        self.peek_table(|table| table?.get(name))
    }

    #[inline]
    pub fn properties(&self) -> Properties {
        if !self.max_offset().is_valid() {
            return Properties(None);
        }
        self.ensure_table();
        Properties(self.peek_table(|table| table.cloned()))
    }

    /// What `properties` has.
    #[inline]
    pub(crate) fn entries<'a>(&self, _: &'a NoGc<'_>) -> &'a [PropertyEntry] {
        if !self.max_offset().is_valid() {
            return &[];
        }
        self.ensure_table();
        let entries = self.peek_table(|it| it.map(|it| core::ptr::from_ref(it.entries())));
        // SAFETY: it takes the `Vm` to change a table, to take it away or to free the shape.
        entries.map_or_default(|it| unsafe { &*it })
    }

    pub(crate) fn collect_property_names(&self, list: &mut PropertyNameList, mode: DontEnumMode) {
        let properties = self.properties();
        let is_known_unique = list.has_only_indices();
        let has_private_names = self.has(ShapeFlags::HAS_PRIVATE_NAMES);
        let private_names = (properties.iter())
            .take_while(|_| has_private_names)
            .filter(|&(name, _, attributes)| name.is_private() && mode.includes(attributes));
        (properties.keys(list.mode(), mode).into_iter().flatten())
            .chain(private_names.map(|it| it.0))
            .for_each(|name| {
                if is_known_unique {
                    list.add_known_unique(name);
                } else {
                    list.add(name);
                }
            });
    }

    pub fn find_static_property(
        &self,
        name: PropertyName<'_>,
    ) -> Option<(&'static StaticTable, &'static StaticProperty)> {
        self.class()
            .ancestry()
            .filter_map(Class::static_table)
            .find_map(|table| Some((table, table.find(name)?)))
    }

    #[inline]
    fn did_add_property(&self, name: PropertyName<'_>, attributes: Attributes) {
        self.seen_names.set(self.seen_names.get() | name.address());
        let mut flags = ShapeFlags::empty();
        if !attributes.is_empty() {
            flags = flags_for_attributes(attributes);
        }
        if name.is_symbol() {
            flags |= ShapeFlags::PREVENTS_QUICK_ENUMERATION;
            if name.is_private() {
                flags |= ShapeFlags::HAS_PRIVATE_NAMES;
            }
            // The brand of a class, which restricts nothing.
            if name.is_private_element() && attributes == Attributes::DONT_ENUM {
                flags -= ShapeFlags::HAS_NON_ENUMERABLE;
            }
        } else if name == names::__proto__ {
            if attributes.intersects(Attributes::ANY_ACCESSOR) {
                flags -= ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO;
            }
            flags |= ShapeFlags::HAS_UNDERSCORE_PROTO;
        } else if name == names::then {
            flags |= ShapeFlags::HAS_THEN;
        } else if name == names::length {
            flags |= ShapeFlags::HAS_REIFIED_LENGTH;
        } else if name == names::name {
            flags |= ShapeFlags::HAS_REIFIED_NAME;
        }
        self.set_flags(flags);
    }

    /// The caller raises `max_offset`.
    fn add(&self, name: PropertyName<'_>, attributes: Attributes) -> PropertyOffset {
        debug_assert!(attributes == attributes.for_shape() && name.as_index().is_none());
        self.did_add_property(name, attributes);
        self.change_table(|table| table.add(name, attributes, self.inline_capacity()))
    }

    fn remove(&self, name: PropertyName<'_>) -> PropertyOffset {
        self.set_flags(ShapeFlags::PREVENTS_QUICK_ENUMERATION);
        self.change_table(|table| table.remove(name))
            .unwrap_or(PropertyOffset::INVALID)
    }

    fn change_attributes(&self, name: PropertyName<'_>, attributes: Attributes) -> PropertyOffset {
        self.did_add_property(name, attributes);
        self.change_table(|table| table.set_attributes(name, attributes))
            .unwrap_or(PropertyOffset::INVALID)
    }

    /// The shape has neither properties nor instances yet, and nothing has been removed from the table.
    pub(super) fn adopt_table(&self, table: PropertyTable) {
        for (name, offset, attributes) in table.iter() {
            self.did_add_property(name, attributes);
            self.set_max_offset(offset);
        }
        self.set_table(Rc::new(table));
        self.set_flags(ShapeFlags::IS_PINNED);
    }

    /// Where the property goes that is added next.
    #[inline]
    pub(super) fn next_offset(&self) -> PropertyOffset {
        self.ensure_table();
        let next = |table: &Rc<PropertyTable>| table.next_offset(self.inline_capacity());
        self.peek_table(|table| table.map_or(PropertyOffset::INVALID, next))
    }

    /// At `next_offset`. The caller has made room for the only instance, and raises `max_offset`.
    pub(super) fn add_property_in_place(&self, name: PropertyName<'_>, attributes: Attributes) {
        assert!(self.instance_type().has_storage());
        if !self.has(ShapeFlags::IS_PINNED) || self.previous().is_some() {
            self.pin();
        }
        self.transition_kind.set(TransitionKind::None);
        self.add(name, attributes);
    }

    /// They go on enumerating first, in the order of `names`.
    pub(super) fn did_reify_static_properties(&self, names: impl Iterator<Item = Identifier>) {
        assert!(self.has(ShapeFlags::IS_CLAIMED));
        self.pin();
        self.transition_kind.set(TransitionKind::None);
        self.change_table(|table| table.move_to_front(names));
        self.set_flags(
            ShapeFlags::STATIC_PROPERTIES_REIFIED | ShapeFlags::PREVENTS_QUICK_ENUMERATION,
        );
    }

    pub(super) fn remove_property_in_place(&self, name: PropertyName<'_>) -> PropertyOffset {
        debug_assert!(self.is_uncacheable_dictionary());
        self.remove(name)
    }

    #[inline(always)]
    fn existing_transition(
        &self,
        name: PropertyName<'_>,
        attributes: Attributes,
        kind: TransitionKind,
    ) -> Option<Gc<Shape>> {
        self.transitions
            .get(TransitionKey::new(name.address(), attributes, kind))
    }

    #[inline]
    pub fn existing_add_transition(
        &self,
        name: PropertyName<'_>,
        attributes: Attributes,
    ) -> Option<Gc<Shape>> {
        self.existing_transition(name, attributes, TransitionKind::AddProperty)
    }

    fn derive_for_property(
        &self,
        vm: &Vm,
        kind: TransitionKind,
        name: PropertyName<'_>,
        attributes: Attributes,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        let mode = self.instance_indexing_mode().writable();
        let target = self.derive(vm, kind, mode, deferred);
        target.transition_name.set(Some(name.to_identifier()));
        target.transition_attributes.set(attributes.bits() as u8);
        target.set_table(self.take_table_or_clone_if_pinned());
        let offset = match kind {
            TransitionKind::AddProperty => target.add(name, attributes),
            TransitionKind::RemoveProperty => target.remove(name),
            _ => target.change_attributes(name, attributes),
        };
        target.transition_offset.set(offset);
        target.set_max_offset(target.max_offset().max(offset));
        if !self.has(ShapeFlags::HAS_BEEN_DICTIONARY) {
            self.add_transition(&target);
        }
        target
    }

    /// The shape is no dictionary, does not have the property and has no such transition yet.
    pub(crate) fn add_new_property_transition(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        attributes: Attributes,
        context: PutContext,
        deferred: &mut DeferredFire<'_>,
    ) -> (Gc<Shape>, PropertyOffset) {
        debug_assert!(!self.is_dictionary());
        let limit = if context == PutContext::PutById {
            Self::MAX_TRANSITIONS_BY_PUT_BY_ID
        } else {
            Self::MAX_TRANSITIONS
        };
        if self.slot_count() > limit {
            let target = self.to_dictionary(vm, ShapeFlags::CACHEABLE_DICTIONARY, deferred);
            let offset = target.add(name, attributes);
            target.set_max_offset(target.max_offset().max(offset));
            return (target, offset);
        }
        let kind = TransitionKind::AddProperty;
        let target = self.derive_for_property(vm, kind, name, attributes, deferred);
        (target, target.transition_offset())
    }

    /// For building the shape of objects that are yet to be made. Panics if the shape has the property.
    pub fn add_property_transition(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        attributes: Attributes,
    ) -> (Gc<Shape>, PropertyOffset) {
        if let Some(target) = self.existing_add_transition(name, attributes) {
            return (target, target.transition_offset());
        }
        assert!(!self.is_dictionary() && self.get(name).is_none() && name.as_index().is_none());
        let deferred = &mut DeferredFire::new(vm);
        self.add_new_property_transition(vm, name, attributes, PutContext::PutById, deferred)
    }

    fn has_too_many_transitions(&self) -> bool {
        self.slot_count() > Self::MAX_SLOTS_FOR_REMOVAL
            || usize::from(self.transition_count.get()) >= Self::MAX_TRANSITIONS
    }

    /// What the only instance becomes then. The properties of a global object are read far more often than changed.
    fn dictionary_for_changes(&self, vm: &Vm, deferred: &mut DeferredFire<'_>) -> Gc<Shape> {
        let kind = match self.instance_type() {
            CellType::GlobalObject => ShapeFlags::CACHEABLE_DICTIONARY,
            _ => ShapeFlags::UNCACHEABLE_DICTIONARY,
        };
        self.to_dictionary(vm, kind, deferred)
    }

    pub fn existing_remove_transition(&self, name: PropertyName<'_>) -> Option<Gc<Shape>> {
        self.existing_transition(name, Attributes::NONE, TransitionKind::RemoveProperty)
    }

    pub(super) fn remove_property_transition(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        debug_assert!(!self.is_uncacheable_dictionary());
        if let Some(target) = self.existing_remove_transition(name) {
            return target;
        }
        if self.is_dictionary() || self.has_too_many_transitions() {
            let target = self.dictionary_for_changes(vm, deferred);
            target.remove(name);
            return target;
        }
        let kind = TransitionKind::RemoveProperty;
        self.derive_for_property(vm, kind, name, Attributes::NONE, deferred)
    }

    pub(super) fn change_attributes_transition(
        &self,
        vm: &Vm,
        name: PropertyName<'_>,
        attributes: Attributes,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        if self.is_uncacheable_dictionary() {
            self.change_attributes(name, attributes);
            return self.into();
        }
        let kind = TransitionKind::ChangeAttributes;
        if let Some(target) = self.existing_transition(name, attributes, kind) {
            return target;
        }
        if self.is_dictionary() {
            let target = self.to_dictionary(vm, ShapeFlags::CACHEABLE_DICTIONARY, deferred);
            target.change_attributes(name, attributes);
            return target;
        }
        if self.has_too_many_transitions() {
            let target = self.dictionary_for_changes(vm, deferred);
            target.change_attributes(name, attributes);
            return target;
        }
        self.derive_for_property(vm, kind, name, attributes, deferred)
    }

    pub(crate) fn existing_prototype_transition(&self, prototype: Value) -> Option<Gc<Shape>> {
        let (address, kind) = (
            prototype.to_bits() as usize,
            TransitionKind::ChangePrototype,
        );
        (self.transitions).get(TransitionKey::new(address, Attributes::NONE, kind))
    }

    pub(super) fn change_prototype_transition(
        &self,
        vm: &Vm,
        prototype: Value,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        let kind = TransitionKind::ChangePrototype;
        let is_chained = self.instance_type() != CellType::GlobalObject
            && !self.has(ShapeFlags::HAS_BEEN_DICTIONARY | ShapeFlags::DICTIONARY);
        if is_chained && let Some(target) = self.existing_prototype_transition(prototype) {
            return target;
        }
        let target = self.derive(vm, kind, self.instance_indexing_mode(), deferred);
        target.set_table(self.share_table());
        target.pin();
        target.set_stored_prototype(prototype);
        if is_chained {
            self.add_transition(&target);
        }
        target
    }

    pub(super) fn to_dictionary(
        &self,
        vm: &Vm,
        kind: ShapeFlags,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        let mode = self.instance_indexing_mode().writable();
        let target = self.derive(vm, TransitionKind::None, mode, deferred);
        // The only instance leaves a dictionary for good.
        target.set_table(if self.is_dictionary() {
            self.table
                .take()
                .unwrap_or_else(|| self.materialize_table())
        } else {
            self.share_table()
        });
        target.pin();
        target.flags.set(
            (target.flags() - ShapeFlags::DICTIONARY)
                | kind
                | ShapeFlags::HAS_BEEN_DICTIONARY
                | ShapeFlags::IS_CLAIMED,
        );
        target
    }

    /// The same, but without a history of transitions, for one object.
    pub(super) fn clone_for_watching(&self, vm: &Vm, deferred: &mut DeferredFire<'_>) -> Gc<Shape> {
        debug_assert!(!self.is_dictionary());
        let mode = self.instance_indexing_mode();
        let target = self.derive(vm, TransitionKind::None, mode, deferred);
        target.set_table(self.share_table());
        target.pin();
        target
    }

    pub(super) fn flatten_cacheable_dictionary(&self) {
        debug_assert!(self.has(ShapeFlags::CACHEABLE_DICTIONARY));
        let mut flags = self.flags() - ShapeFlags::DICTIONARY;
        if flags.contains(ShapeFlags::HAS_BEEN_DICTIONARY) {
            flags |= ShapeFlags::HAS_BEEN_FLATTENED;
        }
        self.flags.set(flags);
    }

    /// A shape without gaps, and the old offset of each of its slots.
    pub(super) fn flatten_uncacheable_dictionary(
        &self,
        vm: &Vm,
        deferred: &mut DeferredFire<'_>,
    ) -> (Gc<Shape>, Vec<PropertyOffset>) {
        let mode = self.instance_indexing_mode();
        let target = self.derive(vm, TransitionKind::None, mode, deferred);
        target.set_table(self.share_table());
        target.pin();
        let old_offsets = target.change_table(|table| table.renumber(self.inline_capacity()));
        target.set_max_offset(match old_offsets.len() {
            0 => PropertyOffset::INVALID,
            count => PropertyOffset::for_slot(count - 1, self.inline_capacity()),
        });
        target
            .flags
            .set((target.flags() - ShapeFlags::DICTIONARY) | ShapeFlags::HAS_BEEN_FLATTENED);
        (target, old_offsets)
    }

    fn indexing_mode_after(&self, kind: TransitionKind) -> IndexingMode {
        let mode = self.instance_indexing_mode();
        match kind {
            TransitionKind::AllocateUndecided => mode.with_kind(ElementKind::Undecided),
            TransitionKind::AllocateInt32 => mode.with_kind(ElementKind::Int32),
            TransitionKind::AllocateDouble => mode.with_kind(ElementKind::Double),
            TransitionKind::AllocateContiguous => mode.with_kind(ElementKind::Contiguous),
            TransitionKind::AllocateSparse => mode.with_kind(ElementKind::Sparse),
            TransitionKind::SwitchToSlowPut
            | TransitionKind::PreventExtensions
            | TransitionKind::Seal
            | TransitionKind::Freeze
            | TransitionKind::MakeLengthReadOnly => mode.slow_put(),
            _ => mode,
        }
    }

    pub(crate) fn non_property_transition(
        &self,
        vm: &Vm,
        kind: TransitionKind,
        deferred: &mut DeferredFire<'_>,
    ) -> Gc<Shape> {
        let mode = self.indexing_mode_after(kind);
        if mode != self.instance_indexing_mode()
            && !mode.is_slow_put()
            && let Some(global) = self.global()
            && global.is_original_array_shape(self)
        {
            self.transition_watchpoints.invalidate_into(deferred);
            return global.original_array_shape(mode);
        }
        let key = TransitionKey::new(0, Attributes::NONE, kind);
        if let Some(target) = self.transitions.get(key) {
            return target;
        }
        if mode.has_elements()
            && let Some(prototype) = self.prototype_object()
        {
            prototype.will_have_heirs_with_elements();
        }
        let target = self.derive(vm, kind, mode, deferred);
        let restricted = ShapeFlags::HAS_NON_CONFIGURABLE
            | ShapeFlags::HAS_NON_CONFIGURABLE_READ_ONLY_OR_ACCESSOR;
        target.set_flags(match kind {
            TransitionKind::AllocateSparse => ShapeFlags::MAY_HAVE_ANY_ATTRIBUTES,
            TransitionKind::AddIndexedAccessors => ShapeFlags::MAY_HAVE_INDEXED_ACCESSORS,
            TransitionKind::PreventExtensions => ShapeFlags::DID_PREVENT_EXTENSIONS,
            TransitionKind::Seal => {
                restricted | ShapeFlags::DID_PREVENT_EXTENSIONS | ShapeFlags::ELEMENTS_ARE_SEALED
            }
            TransitionKind::Freeze => {
                restricted
                    | ShapeFlags::DID_PREVENT_EXTENSIONS
                    | ShapeFlags::ELEMENTS_ARE_SEALED
                    | ShapeFlags::ELEMENTS_ARE_FROZEN
                    | ShapeFlags::LENGTH_IS_READ_ONLY
            }
            TransitionKind::MakeLengthReadOnly => restricted | ShapeFlags::LENGTH_IS_READ_ONLY,
            TransitionKind::BecomePrototype => ShapeFlags::MAY_BE_PROTOTYPE,
            _ => ShapeFlags::empty(),
        });
        if matches!(kind, TransitionKind::Seal | TransitionKind::Freeze) {
            target.set_table(self.share_table());
            target.set_flags(ShapeFlags::IS_PINNED);
            let is_empty = target.change_table(|table| {
                table.update_attributes(|attributes| {
                    if kind == TransitionKind::Freeze
                        && !attributes
                            .intersects(Attributes::ACCESSOR | Attributes::CUSTOM_ACCESSOR)
                    {
                        attributes | Attributes::DONT_DELETE | Attributes::READ_ONLY
                    } else {
                        attributes | Attributes::DONT_DELETE
                    }
                });
                table.len() == 0
            });
            if kind == TransitionKind::Freeze && !is_empty {
                target.set_flags(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO);
            }
        } else if self.is_dictionary() {
            target.table.set(self.table.take());
        } else if self.max_offset().is_valid() {
            target.set_table(self.take_table_or_clone_if_pinned());
        }
        // Elements can change their kind back and forth for ever.
        if self.is_dictionary() || self.transition_count.get() == u8::MAX {
            target.pin();
        }
        if !self.is_dictionary() {
            self.add_transition(&target);
        }
        target
    }

    fn all_properties(&self, test: impl Fn(Attributes) -> bool) -> bool {
        let properties = self.properties();
        properties
            .iter()
            .all(|(name, _, attributes)| name.is_private() || test(attributes))
    }

    /// As far as the table goes.
    pub fn is_sealed(&self) -> bool {
        !self.is_extensible() && self.all_properties(|it| !it.is_configurable())
    }

    /// As far as the table goes.
    pub fn is_frozen(&self) -> bool {
        !self.is_extensible()
            && self.all_properties(|it| {
                !it.is_configurable() && it.intersects(Attributes::REJECTS_PLAIN_STORE)
            })
    }

    /// In `silently_replaced_slots`, or zero.
    fn bit_for_slot(&self, offset: PropertyOffset) -> u64 {
        let number = offset.slot_count(self.inline_capacity()) - 1;
        1u64.unbounded_shl(number as u32)
    }

    /// Fires when the value of the property is replaced in any instance. `None` unless there is such a slot, or if it
    /// is too late for that.
    pub fn ensure_replacement_watchpoints(
        &self,
        offset: PropertyOffset,
    ) -> Option<Rc<WatchpointSet>> {
        if !self.is_valid_offset(offset)
            || self.silently_replaced_slots.get() & self.bit_for_slot(offset) != 0
        {
            return None;
        }
        let rare_data = self.ensure_rare_data();
        let mut sets = rare_data.replacement_sets.borrow_mut();
        let set = sets.entry(offset).or_insert_with(|| {
            rare_data.active_replacement_sets.update(|count| count + 1);
            self.set_flags(ShapeFlags::IS_WATCHING_REPLACEMENT);
            WatchpointSet::create(WatchpointState::Watched)
        });
        Some(Rc::clone(set))
    }

    pub fn replacement_watchpoints(&self, offset: PropertyOffset) -> Option<Rc<WatchpointSet>> {
        let sets = self.rare_data()?.replacement_sets.borrow();
        sets.get(&offset).cloned()
    }

    #[inline(always)]
    pub fn did_replace_property(&self, vm: &Vm, offset: PropertyOffset) {
        if self.has(ShapeFlags::IS_WATCHING_REPLACEMENT) {
            self.fire_replacement_watchpoints(vm, offset);
        }
    }

    /// From now on there is code that replaces the value and tells nobody.
    pub fn did_cache_property_replacement(&self, vm: &Vm, offset: PropertyOffset) {
        let bit = self.bit_for_slot(offset);
        if bit == 0 {
            self.ensure_replacement_watchpoints(offset);
        }
        self.silently_replaced_slots.update(|slots| slots | bit);
        self.did_replace_property(vm, offset);
    }

    /// The same, unless something may be watching.
    pub(super) fn try_to_cache_property_replacement(&self, offset: PropertyOffset) -> bool {
        if let Some(set) = self.replacement_watchpoints(offset) {
            return !set.is_still_valid();
        }
        let bit = self.bit_for_slot(offset);
        if bit == 0 {
            let set = WatchpointSet::create(WatchpointState::Invalidated);
            (self.ensure_rare_data().replacement_sets.borrow_mut()).insert(offset, set);
        }
        self.silently_replaced_slots.update(|slots| slots | bit);
        true
    }

    pub(super) fn is_replaced_silently(&self, offset: PropertyOffset) -> bool {
        self.silently_replaced_slots.get() & self.bit_for_slot(offset) != 0
            || (self.replacement_watchpoints(offset)).is_some_and(|it| !it.is_still_valid())
    }

    #[cold]
    fn fire_replacement_watchpoints(&self, vm: &Vm, offset: PropertyOffset) {
        let Some(set) = self
            .replacement_watchpoints(offset)
            .filter(|set| set.is_still_valid())
        else {
            return;
        };
        let active = &self.ensure_rare_data().active_replacement_sets;
        active.update(|count| count - 1);
        if active.get() == 0 {
            self.flags
                .set(self.flags() - ShapeFlags::IS_WATCHING_REPLACEMENT);
        }
        set.invalidate(vm);
    }

    #[inline]
    pub fn cached_names(&self, kind: CachedNames) -> Option<Gc<ImmutableArray>> {
        self.rare_data()?.cached_names[kind as usize].get()
    }

    /// Whether these own keys of an instance follow from its shape.
    pub fn can_cache_names(&self, kind: CachedNames) -> bool {
        let lists_other_names = self.type_flags().intersects(
            TypeFlags::OVERRIDES_OWN_PROPERTY_NAMES
                | TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES,
        );
        if self.is_dictionary() {
            false
        } else if kind == CachedNames::Symbols {
            let cell_type = self.instance_type();
            !lists_other_names
                || matches!(cell_type, CellType::Array | CellType::Function)
                || CellType::TYPED_ARRAYS.contains(cell_type)
        } else {
            !lists_other_names && !self.instance_indexing_mode().has_elements()
        }
    }

    /// Not the first time: many a shape is asked only once.
    pub fn should_cache_names(&self, kind: CachedNames) -> bool {
        self.lists_names_again() && self.can_cache_names(kind)
    }

    /// False the first time.
    pub(crate) fn lists_names_again(&self) -> bool {
        let did_list_names = self.has(ShapeFlags::DID_LIST_NAMES);
        self.set_flags(ShapeFlags::DID_LIST_NAMES);
        did_list_names
    }

    pub fn set_cached_names(&self, kind: CachedNames, names: Gc<ImmutableArray>) {
        debug_assert!(self.can_cache_names(kind));
        // SAFETY: the shape traces its rare data.
        unsafe { self.ensure_rare_data().cached_names[kind as usize].set(self, Some(names)) }
    }

    /// There can be instances again, and it keeps little else alive.
    pub fn visit_if_class_lives(&self, visitor: &mut Visitor) {
        if self.global().is_none_or(|it| visitor.is_marked(it))
            && (self.prototype_object()).is_none_or(|it| visitor.is_marked(it))
            && !self.is_dictionary()
        {
            visitor.append(Gc::from(self));
        }
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.reconcile_current_cell_later();
    }

    fn reconcile_weak_references(&self, survivors: &Survivors) {
        self.transitions.reconcile(survivors);
        if survivors.scope() == Scope::Full
            && !self.has(ShapeFlags::IS_PINNED)
            && !self.transitions.is_empty()
        {
            self.table.take();
        }
        if !self.has_survived.replace(true) || survivors.scope() == Scope::Full {
            let share = |table: &Rc<PropertyTable>| table.memory_size() / Rc::strong_count(table);
            let of_table = self.peek_table(|table| table.map_or(0, share));
            survivors.report_extra_memory(of_table + self.json_plan_size());
        }
        if let Some(rare_data) = self.rare_data() {
            rare_data.special_properties.reconcile(survivors);
        }
    }

    fn estimated_size(&self, _: &Vm) -> usize {
        let of_table = self.peek_table(|table| table.map_or(0, |table| table.memory_size()));
        self.cell_size() + of_table + self.json_plan_size()
    }

    fn json_plan_size(&self) -> usize {
        self.rare_data().map_or(0, |it| it.json_plan.memory_size())
    }
}
