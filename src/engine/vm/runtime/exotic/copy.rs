//! Spread and rest properties, and `Object.assign`.

use core::cell::Cell;

use bun_engine_text::{Identifier, PropertyName};
use smallvec::SmallVec;

use crate::caches::{Move, put_megamorphic};
use crate::{
    Attributes, CellType, Cx, DeferredFire, DontEnumMode, ElementKind, Gc, GlobalObject,
    IndexingMode, InternalMethod, JsFinalObject, JsObject, JsResult, PropertyNameMode,
    PropertyOffset, PropertySlot, PutContext, Shape, ShapeFlags, Value, Vm,
};

/// Such a shape may change in place, and there is nobody to share a plan with.
const HAS_ONE_INSTANCE: ShapeFlags = ShapeFlags::DICTIONARY
    .union(ShapeFlags::HAS_BEEN_DICTIONARY)
    .union(ShapeFlags::IS_CLAIMED);

/// Without these, `[[Set]]` on the object itself and CreateDataProperty come to the same.
const RESTRICTS_STORES: ShapeFlags = ShapeFlags::DID_PREVENT_EXTENSIONS
    .union(ShapeFlags::HAS_ANY_ACCESSOR)
    .union(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO)
    .union(ShapeFlags::HAS_NON_ENUMERABLE)
    .union(ShapeFlags::HAS_NON_CONFIGURABLE)
    .union(ShapeFlags::MAY_HAVE_INDEXED_ACCESSORS);

impl Shape {
    /// Whether `{ ...object }` is an object with the same shape and the same slots.
    #[inline]
    pub fn is_shape_of_clones(&self, global: &GlobalObject) -> bool {
        let unlike_a_literal = HAS_ONE_INSTANCE
            | RESTRICTS_STORES
            | ShapeFlags::MAY_BE_PROTOTYPE
            | ShapeFlags::HAS_PRIVATE_NAMES;
        !self.has(unlike_a_literal)
            && self.instance_type() == CellType::FinalObject
            && self.instance_indexing_mode() == IndexingMode::NON_ARRAY
            && self.max_offset().is_valid()
            && self.prototype() == global.object_prototype().into()
    }

    fn copied_properties(
        &self,
        is_excluded: impl Fn(PropertyName<'_>) -> bool,
        mut visit: impl FnMut(PropertyName<'_>, PropertyOffset) -> Option<()>,
    ) -> Option<()> {
        (self.properties().iter())
            .filter(|&(name, _, attributes)| {
                attributes.is_enumerable() && !name.is_private() && !is_excluded(name)
            })
            .try_for_each(|(name, offset, _)| visit(name, offset))
    }
}

type Moves = SmallVec<[Cell<Move>; 32]>;

/// `None` if there are too many properties.
fn plan(
    vm: &Vm,
    target: Gc<Shape>,
    source: &Shape,
    is_excluded: impl Fn(PropertyName<'_>) -> bool,
    deferred: &mut DeferredFire<'_>,
) -> Option<(Gc<Shape>, Moves)> {
    if target.slot_count() + source.slot_count() > Shape::MAX_TRANSITIONS {
        return None;
    }
    let (mut shape, mut moves) = (target, Moves::new());
    source.copied_properties(is_excluded, |name, from| {
        let (attributes, context) = (Attributes::NONE, PutContext::Unknown);
        let to;
        (shape, to) = if let Some(next) = shape.existing_add_transition(name, attributes) {
            (next, next.transition_offset())
        } else if let Some((offset, _)) = shape.get(name) {
            (shape, offset)
        } else {
            shape.add_new_property_transition(vm, name, attributes, context, deferred)
        };
        moves.push(Cell::new(Move::new(from, to)?));
        Some(())
    })?;
    Some((shape, moves))
}

impl JsObject {
    /// The value, if `[[GetOwnProperty]]` says that there is such a property and that it is enumerable.
    pub fn get_if_own_and_enumerable(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Option<Value>> {
        if self.cell_type() == CellType::FinalObject
            && let Some((value, attributes)) = self.get_direct_with_attributes(name)
            && !attributes.intersects(Attributes::ANY_ACCESSOR)
        {
            return Ok(attributes.is_enumerable().then_some(value));
        }
        cx.check_traps()?;
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        if !self.get_own_property_slot(cx, name, &mut slot)? || !slot.attributes().is_enumerable() {
            return Ok(None);
        }
        if slot.is_tainted_by_opaque_object() {
            return self.get(cx, name).map(Some);
        }
        slot.value(cx, name).map(Some)
    }

    /// The enumerable own properties are plain values in the slots and in dense elements.
    #[inline]
    pub fn has_only_plain_enumerable_properties(&self) -> bool {
        let shape = self.shape();
        (shape.has_only_stored_properties()
            || (self.cell_type() == CellType::Array && !shape.has(ShapeFlags::HAS_ANY_ACCESSOR)))
            && self.element_kind() != ElementKind::Sparse
    }

    /// # Safety
    /// Both have the slots, and the barrier follows.
    #[inline(always)]
    unsafe fn move_values(&self, source: &JsObject, moves: &[Cell<Move>]) {
        for step in moves.iter().map(Cell::get) {
            // SAFETY: the caller's.
            unsafe {
                let value = source.slot_unchecked(step.from()).get();
                self.slot_unchecked(step.to()).set_without_barrier(value);
            }
        }
    }

    /// # Safety
    /// The plan is for the shapes that the two have.
    #[inline(always)]
    unsafe fn follow_plan(&self, vm: &Vm, source: &JsObject, new: &Shape, moves: &[Cell<Move>]) {
        let (old_capacity, new_capacity) = (
            self.shape().out_of_line_capacity(),
            new.out_of_line_capacity(),
        );
        // SAFETY: there is room for the slots that `new` adds, and `set_shape` has the barrier.
        unsafe {
            if old_capacity != new_capacity {
                let storage = self.storage_with_more_slots(vm, old_capacity, new_capacity);
                self.nuke_shape_and_set_storage(storage, false);
            }
            self.move_values(source, moves);
            self.set_shape(new);
        }
    }

    /// Of a source that has only plain ones, to an ordinary object that does not restrict stores.
    fn copy_named_properties(&self, vm: &Vm, source: &JsObject) {
        let (target_shape, source_shape) = (self.shape(), source.shape());
        if !source_shape.max_offset().is_valid() {
            return;
        }
        let needs_notice = ShapeFlags::IS_WATCHING_REPLACEMENT | ShapeFlags::MAY_BE_PROTOTYPE;
        if !target_shape.has(HAS_ONE_INSTANCE | needs_notice) {
            let (plans, context) = (&vm.services.caches.copy_plans, target_shape.address());
            if let Some((shape, moves)) = plans.find(vm, context, source_shape.id()) {
                // SAFETY: what it was found by.
                return unsafe { self.follow_plan(vm, source, &shape, moves) };
            }
            let deferred = &mut DeferredFire::new(vm);
            if let Some((shape, moves)) = plan(vm, target_shape, &source_shape, |_| false, deferred)
            {
                if !source_shape.has(HAS_ONE_INSTANCE) {
                    plans.insert(vm, context, &source_shape, &shape, &moves);
                }
                // SAFETY: what it was made for.
                return unsafe { self.follow_plan(vm, source, &shape, &moves) };
            }
        }
        self.put_named_properties(vm, source, |_| false);
    }

    fn put_named_properties(
        &self,
        vm: &Vm,
        source: &JsObject,
        is_excluded: impl Fn(PropertyName<'_>) -> bool,
    ) {
        source.shape().copied_properties(is_excluded, |name, from| {
            self.put_direct(vm, name, source.get_direct_at(from), Attributes::NONE);
            Some(())
        });
    }

    fn copy_dense_elements(
        &self,
        cx: &mut Cx,
        source: &JsObject,
        is_excluded: impl Fn(u32) -> bool,
    ) -> JsResult<()> {
        for index in (0..source.public_length()).filter(|&index| !is_excluded(index)) {
            if let Some(value) = source.try_get_dense(index) {
                self.put_direct_index(cx, index, value)?;
            }
        }
        Ok(())
    }

    fn copy_observably(
        &self,
        cx: &mut Cx,
        source: &JsObject,
        is_excluded: impl Fn(PropertyName<'_>) -> bool,
    ) -> JsResult<()> {
        source.reify_all_static_properties(cx)?;
        let kinds = PropertyNameMode::StringsAndSymbols;
        let keys = source.snapshot_own_keys(cx, kinds, DontEnumMode::Include)?;
        for name in keys.iter() {
            if !is_excluded(name)
                && let Some(value) = source.get_if_own_and_enumerable(cx, name)?
            {
                self.create_data_property(cx, name, value, true)?;
            }
        }
        Ok(())
    }

    #[inline]
    fn takes_any_property(&self) -> bool {
        self.cell_type() == CellType::FinalObject
            && !self.shape().has(RESTRICTS_STORES)
            && self.element_kind() != ElementKind::Sparse
    }

    /// CopyDataProperties, with nothing excluded.
    pub fn copy_data_properties(&self, cx: &mut Cx, source: Value) -> JsResult<()> {
        if source.is_undefined_or_null() {
            return Ok(());
        }
        let source = source.to_object(cx)?;
        if !self.takes_any_property() || !source.has_only_plain_enumerable_properties() {
            return self.copy_observably(cx, &source, |_| false);
        }
        self.copy_dense_elements(cx, &source, |_| false)?;
        self.copy_named_properties(cx, &source);
        Ok(())
    }

    /// `Object.assign` with one source.
    pub fn assign(&self, cx: &mut Cx, source: &JsObject) -> JsResult<()> {
        if self.takes_any_property()
            && source.has_only_plain_enumerable_properties()
            && !source.shape().has(ShapeFlags::HAS_UNDERSCORE_PROTO)
            && self.nothing_intercepts_put_except_to_proto()
            && (source.public_length() == 0 || !self.chain_may_intercept_indexed_access())
        {
            self.copy_dense_elements(cx, source, |_| false)?;
            self.copy_named_properties(cx, source);
            return Ok(());
        }
        let kinds = PropertyNameMode::StringsAndSymbols;
        let keys = source.snapshot_own_keys(cx, kinds, DontEnumMode::Include)?;
        for name in keys.iter() {
            if let Some(value) = source.get_if_own_and_enumerable(cx, name)? {
                put_megamorphic(cx, self.as_object(), name, value, true)?;
            }
        }
        Ok(())
    }
}

/// A new object with the named properties of `source`, which has only plain ones. `context` stands for `is_excluded`.
fn copy_of_named_properties(
    cx: &Cx,
    source: &JsObject,
    context: Option<usize>,
    is_excluded: impl Fn(PropertyName<'_>) -> bool + Copy,
) -> Gc<JsObject> {
    let create = |shape: Gc<Shape>, moves: &[Cell<Move>]| {
        let object = JsFinalObject::create(cx, shape);
        // SAFETY: the plan is for these shapes, and the object is new.
        unsafe { object.move_values(source, moves) };
        object.upcast()
    };
    let (plans, source_shape) = (&cx.services.caches.copy_plans, source.shape());
    if let Some(context) = context
        && let Some((shape, moves)) = plans.find(cx, context, source_shape.id())
        && shape.prototype() == cx.object_prototype().into()
    {
        return create(shape, moves);
    }
    let capacity = (source_shape.slot_count()).max(JsFinalObject::DEFAULT_INLINE_CAPACITY);
    let empty = Shape::for_new_object(cx, capacity);
    let deferred = &mut DeferredFire::new(cx);
    let Some((shape, moves)) = plan(cx, empty, &source_shape, is_excluded, deferred) else {
        let object = cx.new_object();
        object.convert_to_dictionary(cx);
        object.put_named_properties(cx, source, is_excluded);
        return object;
    };
    if let Some(context) = context.filter(|_| !source_shape.has(HAS_ONE_INSTANCE)) {
        plans.insert(cx, context, &source_shape, &shape, &moves);
    }
    create(shape, &moves)
}

/// `{ ...source }`
#[inline]
pub fn clone_object(cx: &mut Cx, source: Value) -> JsResult<Gc<JsObject>> {
    if let Some(object) = source.downcast::<JsFinalObject>()
        && object.shape().is_shape_of_clones(&cx.global())
    {
        // SAFETY: just checked.
        return Ok(unsafe { object.clone_unchecked(cx) }.upcast());
    }
    copy_rest(cx, source, &[], &[])
}

/// A new object with the enumerable own properties of `source` but those in the two lists. `excluded` is part of the
/// code that is running. Converting a member of `computed` to a property key runs no script.
pub fn copy_rest(
    cx: &mut Cx,
    source: Value,
    excluded: &[Identifier],
    computed: &[Value],
) -> JsResult<Gc<JsObject>> {
    if source.is_undefined_or_null() {
        return Ok(cx.new_object());
    }
    let source = source.to_object(cx)?;
    let mut keys = SmallVec::<[Identifier; 4]>::new();
    for key in computed {
        keys.push(key.to_property_key(cx)?.to_identifier());
    }
    let all_excluded = || excluded.iter().chain(&keys).map(Identifier::name);
    let is_excluded = |name: PropertyName<'_>| all_excluded().any(|it| it == name);
    if !source.has_only_plain_enumerable_properties() {
        let target = cx.new_object();
        target.copy_observably(cx, &source, is_excluded)?;
        return Ok(target);
    }
    let context = match (excluded, computed) {
        ([], []) => Some(0),
        (_, []) => Some(excluded.as_ptr().addr()),
        _ => None,
    };
    let target = copy_of_named_properties(cx, &source, context, is_excluded);
    if source.public_length() != 0 {
        let indices: SmallVec<[u32; 4]> = all_excluded().filter_map(|it| it.as_index()).collect();
        target.copy_dense_elements(cx, &source, |index| indices.contains(&index))?;
    }
    Ok(target)
}
