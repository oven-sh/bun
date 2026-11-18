use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{PropertyName, names, symbols};

use crate::heap::Owned;
use crate::{
    Attributes, CallFrame, CellKind, CellType, Cx, DeletePropertySlot, DontEnumMode, Environment,
    Field, Gc, GlobalObject, JsObject, JsObjectInit, JsResult, PropertyDescriptor,
    PropertyNameList, PropertySlot, PutPropertySlot, Shape, ShapeSpec, SparseEntry, Storage,
    TypeFlags, Value, Visitor, Vm,
};

/// Only this module knows how much memory to ask for.
pub struct FollowedBySlots(());

/// The `arguments` of a function whose parameters it is another name for. Slots follow. With the type
/// `DirectArguments` the first of them are the parameters, and there is one for each argument. With `ScopedArguments`
/// the parameters are the first slots of `scope`, and these are for the arguments after them.
///
/// The per-cell bit says that `length`, `callee` and `Symbol.iterator` have become ordinary properties.
#[cell(name = "Arguments", cell_type = DirectArguments..=ScopedArguments, ops, visit_children, flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS)]
pub struct MappedArguments {
    base: JsObject,
    callee: Gc<JsObject>,
    length: u32,
    /// The indices below it are properties with default attributes that are only in the slots.
    plain_length: Cell<u32>,
    parameters: u32,
    scope: Option<Gc<Environment>>,
    slots: FollowedBySlots,
}

impl MappedArguments {
    pub const OFFSET_OF_CALLEE: usize = offset_of!(MappedArguments, callee);
    pub const OFFSET_OF_LENGTH: usize = offset_of!(MappedArguments, length);
    pub const OFFSET_OF_PLAIN_LENGTH: usize = offset_of!(MappedArguments, plain_length);
    pub const OFFSET_OF_PARAMETERS: usize = offset_of!(MappedArguments, parameters);
    pub const OFFSET_OF_SCOPE: usize = offset_of!(MappedArguments, scope);
    pub const OFFSET_OF_SLOTS: usize = size_of::<MappedArguments>();

    #[inline(always)]
    pub const fn offset_of_slot(index: u32) -> usize {
        Self::OFFSET_OF_SLOTS + index as usize * size_of::<u64>()
    }

    pub fn create_shapes(cx: &Cx) {
        let (global, prototype) = (cx.global(), cx.object_prototype().into());
        let shape = |cell_type| {
            let spec = ShapeSpec::of::<MappedArguments>().with_type(cell_type);
            Shape::create(cx, Some(global), prototype, spec)
        };
        global.init_direct_arguments_shape(shape(CellType::DirectArguments));
        global.init_scoped_arguments_shape(shape(CellType::ScopedArguments));
    }

    #[inline(always)]
    fn create(
        cx: &Cx,
        shape: Gc<Shape>,
        callee: Gc<JsObject>,
        arguments: &[Value],
        parameters: u32,
        scope: Option<Gc<Environment>>,
    ) -> JsResult<Gc<MappedArguments>> {
        let length = u32::try_from(arguments.len()).map_err(|_| cx.throw_out_of_memory())?;
        let slot_count = slot_count(length, parameters, scope.is_some());
        let size = Self::offset_of_slot(slot_count);
        let address = cx.heap.cells.try_allocate(&cx.heap, size);
        if address == 0 {
            return Err(cx.throw_out_of_memory());
        }
        let init = MappedArgumentsInit {
            base: JsObjectInit::new(cx, shape),
            callee,
            length,
            plain_length: Cell::new(length),
            parameters,
            scope,
            slots: FollowedBySlots(()),
        };
        let stored = &arguments[arguments.len() - length.min(slot_count) as usize..];
        let cell = core::ptr::with_exposed_provenance_mut::<MappedArguments>(address);
        // SAFETY: a new cell of that size. The shape is empty, so nothing has been allocated since.
        unsafe {
            Self::initialize(cell, init);
            let slots = cell.add(1).cast::<Value>();
            slots.copy_from_nonoverlapping(stored.as_ptr(), stored.len());
            for index in stored.len()..slot_count as usize {
                slots.add(index).write(Value::UNDEFINED);
            }
            Ok(Gc::from_address(address))
        }
    }

    /// All but the slots.
    ///
    /// # Safety
    /// A new cell with room for them, and the `direct_arguments_shape` of a realm.
    #[inline(always)]
    pub unsafe fn initialize_direct(
        address: usize,
        shape: Gc<Shape>,
        callee: Gc<JsObject>,
        length: u32,
        parameters: u32,
    ) {
        // SAFETY: the caller's. The shape is empty.
        unsafe {
            let init = MappedArgumentsInit {
                base: JsObjectInit::with_storage(shape, Storage::NONE),
                callee,
                length,
                plain_length: Cell::new(length),
                parameters,
                scope: None,
                slots: FollowedBySlots(()),
            };
            Self::initialize(core::ptr::with_exposed_provenance_mut(address), init);
        }
    }

    /// `parameters` does not count `this`.
    #[inline]
    pub fn create_direct(
        cx: &Cx,
        callee: Gc<JsObject>,
        arguments: &[Value],
        parameters: u32,
    ) -> JsResult<Gc<MappedArguments>> {
        let shape = cx.direct_arguments_shape();
        Self::create(cx, shape, callee, arguments, parameters, None)
    }

    #[inline]
    pub fn create_scoped(
        cx: &Cx,
        callee: Gc<JsObject>,
        arguments: &[Value],
        scope: Gc<Environment>,
    ) -> JsResult<Gc<MappedArguments>> {
        let shape = cx.scoped_arguments_shape();
        let parameters = scope.template().scope().mapped_parameters();
        Self::create(cx, shape, callee, arguments, parameters, Some(scope))
    }

    /// `create_direct_arguments`, and `ensure_arguments` if it is mapped.
    #[inline]
    pub fn direct_from_frame(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<MappedArguments>> {
        let parameters = frame.code_block().map_or(0, |it| it.parameters() - 1);
        Self::create_direct(cx, frame.callee(), frame.arguments(), parameters)
    }

    /// `create_scoped_arguments`
    #[inline]
    pub fn scoped_from_frame(
        cx: &Cx,
        frame: &CallFrame,
        scope: Gc<Environment>,
    ) -> JsResult<Gc<MappedArguments>> {
        Self::create_scoped(cx, frame.callee(), frame.arguments(), scope)
    }

    #[inline(always)]
    fn fields(&self) -> &[Field<Value>] {
        let count = slot_count(self.length, self.parameters, self.scope.is_some());
        let first = core::ptr::with_exposed_provenance(self.address() + Self::OFFSET_OF_SLOTS);
        // SAFETY: allocated with that many.
        unsafe { core::slice::from_raw_parts(first, count as usize) }
    }

    /// For `get_from_arguments` and `put_to_arguments`.
    ///
    /// # Safety
    /// There is such a slot.
    #[inline(always)]
    pub unsafe fn slot_unchecked(&self, index: u32) -> &Field<Value> {
        let address = self.address() + Self::offset_of_slot(index);
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(address) }
    }

    #[inline(always)]
    fn load(&self, index: u32) -> Value {
        match self.scope {
            None => self.fields()[index as usize].get(),
            Some(scope) => match index.checked_sub(self.parameters) {
                Some(index) => self.fields()[index as usize].get(),
                None => scope.get(index).unwrap_or_default(),
            },
        }
    }

    #[inline(always)]
    fn store(&self, index: u32, value: Value) {
        // SAFETY: visited by `visit_children`.
        let fields = unsafe { Owned::new(self, self.fields()) };
        match self.scope {
            None => fields.set(index as usize, value),
            Some(scope) => match index.checked_sub(self.parameters) {
                Some(index) => fields.set(index as usize, value),
                // SAFETY: the code of the function knows that its parameters are written to in this way.
                None => unsafe { scope.set(index, Some(value)) },
            },
        }
    }

    #[inline(always)]
    pub fn try_get(&self, index: u32) -> Option<Value> {
        (index < self.plain_length.get()).then(|| self.load(index))
    }

    /// The same without any check but that of the index.
    ///
    /// # Safety
    /// The type is `DirectArguments`.
    #[inline(always)]
    pub unsafe fn try_get_direct(&self, index: usize) -> Option<Value> {
        // SAFETY: each argument has a slot.
        (index < self.plain_length() as usize)
            .then(|| unsafe { self.slot_unchecked(index as u32) }.get())
    }

    #[inline(always)]
    pub fn try_set(&self, index: u32, value: Value) -> bool {
        let is_plain = index < self.plain_length.get();
        if is_plain {
            self.store(index, value);
        }
        is_plain
    }

    /// `try_get` succeeds below it.
    #[inline(always)]
    pub fn plain_length(&self) -> u32 {
        self.plain_length.get()
    }

    #[inline(always)]
    fn has_defined_properties(&self) -> bool {
        self.per_cell_bit()
    }

    /// The value of `length`, unless a script may have changed it.
    #[inline(always)]
    pub fn original_length(&self) -> Option<u32> {
        (!self.has_defined_properties()).then_some(self.length)
    }

    /// What reading `length` and the indices below it gives, if that runs no code.
    #[inline]
    pub fn pristine_values(&self) -> Option<impl ExactSizeIterator<Item = Value> + Clone> {
        let length = self.original_length()?;
        (length == self.plain_length()).then(|| (0..length).map(|index| self.load(index)))
    }

    /// Whether iterating over it gives `pristine_values`.
    #[inline]
    pub fn is_iteration_pristine(&self) -> bool {
        self.original_length() == Some(self.plain_length())
            && self.global().array_iterator_protocol_is_pristine()
    }

    fn global(&self) -> Gc<GlobalObject> {
        self.realm().expect("made with a shape of a realm")
    }

    fn initial_properties(&self) -> [(PropertyName<'static>, Value); 3] {
        let values = self.global().array_prototype_values();
        [
            (names::length, self.length.into()),
            (names::callee, self.callee.into()),
            (symbols::iterator, values.into()),
        ]
    }

    /// Before anything happens to a property with a name, so that these stay first. Whether that was now.
    fn define_properties(&self, vm: &Vm) -> bool {
        if self.has_defined_properties() {
            return false;
        }
        for (name, value) in self.initial_properties() {
            self.put_direct(vm, name, value, Attributes::DONT_ENUM);
        }
        self.set_per_cell_bit(true);
        true
    }

    /// Makes elements of them, which can have attributes and holes between them.
    fn define_plain_indices(&self, cx: &Cx) -> JsResult<()> {
        let elements = cx.or_out_of_memory(self.convert_to_sparse(cx))?;
        let length = self.plain_length.replace(0);
        for index in 0..length {
            let mut attributes = Attributes::NONE;
            attributes.set(Attributes::MAPPED, index < self.parameters);
            elements.insert(index, self.load(index), attributes);
        }
        // SAFETY: not dense.
        unsafe { (self.storage()).set_public_length(self.public_length().max(length)) };
        Ok(())
    }

    /// The value in it is out of date.
    fn mapped_element(&self, index: u32) -> Option<SparseEntry> {
        if index >= self.parameters {
            return None;
        }
        let entry = self.sparse_elements()?.get(index)?;
        entry
            .attributes
            .contains(Attributes::MAPPED)
            .then_some(entry)
    }

    fn update_element(&self, index: u32, update: impl FnOnce(&mut SparseEntry)) {
        if let (Some(elements), Some(mut entry)) =
            (self.sparse_elements(), self.mapped_element(index))
        {
            update(&mut entry);
            elements.insert(index, entry.value, entry.attributes);
        }
    }

    fn define_index(
        &self,
        cx: &mut Cx,
        index: u32,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        if let Some(value) = self.try_get(index) {
            let current = PropertyDescriptor::data(value, Attributes::NONE);
            if descriptor.attributes_overriding(&current).is_empty() {
                self.store(index, descriptor.value().unwrap_or(value));
                return Ok(true);
            }
            self.define_plain_indices(cx)?;
        }
        self.update_element(index, |entry| entry.value = self.load(index));
        if !self.define_own_indexed_property(cx, index, descriptor, should_throw)? {
            return Ok(false);
        }
        self.update_element(index, |entry| {
            if let Some(value) = descriptor.value() {
                self.store(index, value);
            }
            if entry.attributes.intersects(Attributes::REJECTS_PLAIN_STORE) {
                entry.attributes -= Attributes::MAPPED;
            }
        });
        Ok(true)
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        crate::Trace::trace(self.fields(), visitor);
    }
}

#[inline(always)]
fn slot_count(length: u32, parameters: u32, is_scoped: bool) -> u32 {
    if is_scoped {
        length.saturating_sub(parameters)
    } else {
        length.max(parameters)
    }
}

#[object_ops]
impl MappedArguments {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            return self.op_get_own_property_slot_by_index(cx, index, slot);
        }
        if !self.has_defined_properties()
            && let Some((_, value)) =
                (self.initial_properties().into_iter()).find(|it| it.0 == name)
        {
            slot.set_value(self, Attributes::DONT_ENUM, value);
            return Ok(true);
        }
        self.ordinary_get_own_property_slot(cx, name, slot)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if let Some(value) = self.try_get(index) {
            slot.set_value(self, Attributes::NONE, value);
        } else if let Some(entry) = self.mapped_element(index) {
            let attributes = entry.attributes - Attributes::MAPPED;
            slot.set_value(self, attributes, self.load(index));
        } else {
            return self.ordinary_get_own_property_slot_by_index(cx, index, slot);
        }
        Ok(true)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if name.as_index().is_none() && self.define_properties(cx) {
            slot.disable_caching();
        }
        self.ordinary_put(cx, name, value, slot)
    }

    fn put_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        if index < self.plain_length() || self.mapped_element(index).is_some() {
            self.store(index, value);
            return Ok(true);
        }
        self.ordinary_put_by_index(cx, index, value, should_throw)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        if name.as_index().is_none() && self.define_properties(cx) {
            slot.disable_caching();
        }
        self.ordinary_delete_property(cx, name, slot)
    }

    fn delete_property_by_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        if index < self.plain_length() {
            if index + 1 == self.plain_length() {
                self.plain_length.set(index);
                return Ok(true);
            }
            self.define_plain_indices(cx)?;
        }
        self.ordinary_delete_property_by_index(cx, index)
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        if let Some(index) = name.as_index() {
            return self.define_index(cx, index, descriptor, should_throw);
        }
        self.define_properties(cx);
        self.define_own_non_index_property(cx, name, descriptor, should_throw)
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        list.add_indices(self.plain_length() as usize, 0..self.plain_length());
        self.own_indexed_property_names(list, mode);
        if mode == DontEnumMode::Include && !self.has_defined_properties() {
            for (name, _) in self.initial_properties() {
                list.add(name);
            }
        }
        self.own_non_index_property_names(cx, list, mode)
    }
}
