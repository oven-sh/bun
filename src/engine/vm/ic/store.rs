use core::mem::{offset_of, transmute};

use bun_engine_text::{PropertyName, names};

use super::cases::{NoCase, Overflow, visit_transition};
use super::inline::InlineCache;
use super::load::{
    case_for_global_binding, case_for_proxy, constant_function, is_custom_accessor_fixed,
    lookup_beyond, prepare,
};
use super::{
    AccessCase, AccessCases, AccessKind, InlineCase, InlineKind, InlineStore, Key, NUMBER_SHAPE,
    PrototypeLookup, is_live, slot_at,
};
use crate::caches::{define_megamorphic, put_megamorphic_in};
use crate::code::metadata::{Entry, SetPrototype};
use crate::heap::Survivors;
use crate::{
    Attributes, CellType, CodeBlock, CustomSetter, Cx, Gc, GetterSetter, GlobalBinding,
    GlobalObject, GlobalProxy, JsArray, JsObject, JsResult, ProxyObject, PutContext, PutKind,
    PutPropertySlot, Shape, ShapeId, Storage, Value, Visitor, Vm,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StoreMode {
    Set {
        is_strict: bool,
    },
    /// CreateDataProperty
    Define {
        is_strict: bool,
    },
}

impl StoreMode {
    #[inline(always)]
    pub fn is_strict(self) -> bool {
        let (StoreMode::Set { is_strict } | StoreMode::Define { is_strict }) = self;
        is_strict
    }
}

#[repr(C)]
pub struct StoreCache {
    inline: InlineCase,
    cases: AccessCases,
}

impl InlineCache for StoreCache {
    type Kind = InlineStore;

    #[inline(always)]
    fn inline_case(&self) -> &InlineCase {
        &self.inline
    }

    #[inline(always)]
    fn listed(&self) -> &AccessCases {
        &self.cases
    }
}

impl StoreCache {
    pub const OFFSET_OF_INLINE: usize = offset_of!(StoreCache, inline);
    pub const OFFSET_OF_CASES: usize = offset_of!(StoreCache, cases);

    #[inline(always)]
    pub fn inline(&self) -> &InlineCase {
        &self.inline
    }

    /// What is worth a place in compiled code.
    pub fn likely_kind(&self) -> Option<InlineStore> {
        self.kind_for_compiled_code()
    }

    /// That of the case which is not in the list, if there is one.
    pub fn shape(&self) -> ShapeId {
        self.unlisted_shape()
    }

    /// Of the inline case, if it has a slot.
    #[inline(always)]
    pub fn new_shape(&self) -> ShapeId {
        self.inline.new_shape()
    }

    #[inline(always)]
    pub fn byte_offset(&self) -> i32 {
        self.inline.stored_slot()
    }

    /// The same, whatever it is.
    #[inline(always)]
    fn added_shape(&self) -> ShapeId {
        match self.preferred_kind() {
            _ if self.inline.key.shape().is_none() => ShapeId::NONE,
            InlineStore::AddInObject | InlineStore::AddInStorage => self.new_shape(),
            _ => ShapeId::NONE,
        }
    }

    /// If the case which is not in the list is `Transition`.
    pub fn inline_lookup(&self) -> Option<Gc<PrototypeLookup>> {
        self.cases.lone_lookup()
    }

    pub fn cases(&self) -> Option<&AccessCases> {
        self.inline_lookup().is_none().then_some(&self.cases)
    }

    #[inline(always)]
    pub fn all_cases(&self) -> &AccessCases {
        &self.cases
    }

    pub fn has_run(&self) -> bool {
        !self.inline.key.shape().is_none() || self.cases.has_run()
    }

    pub(crate) fn reset(&self) {
        self.clear_inline_case();
    }

    /// The case that is not in the list.
    pub fn only_case(&self) -> Option<AccessCase> {
        let shape = Some(self.shape()).filter(|it| !it.is_none())?;
        let case = match self.preferred_kind() {
            InlineStore::AddInObject | InlineStore::AddInStorage => {
                AccessCase::new(AccessKind::Transition, shape)
                    .with_new_shape(self.new_shape())
                    .with_lookup(self.cases.lone_lookup()?)
            }
            InlineStore::InObject if self.byte_offset() == 0 => {
                return Some(AccessCase::new(AccessKind::HasOwn, shape).with_answer(true));
            }
            InlineStore::InObject | InlineStore::InStorage => {
                AccessCase::new(AccessKind::Replace, shape)
            }
            _ => return None,
        };
        Some(case.with_byte_offset(self.byte_offset()))
    }

    /// False if it has to go in the list.
    pub(super) fn try_set_only_case(&self, vm: &Vm, owner: &CodeBlock, case: &AccessCase) -> bool {
        use AccessKind::{HasOwn, Replace, Transition};
        let (HasOwn | Replace | Transition, Some(kind)) = (case.kind(), InlineStore::of_case(case))
        else {
            return false;
        };
        if !self.inline.key.shape().is_none()
            || self.cases.has_list()
            || (kind.is_checked() && !self.cases.is_blank())
        {
            return false;
        }
        if let Some(lookup) = case.lookup() {
            self.cases.set_lone_lookup(owner, lookup);
        }
        self.inline.set_unlisted(vm, owner, case, kind);
        true
    }

    fn ensure_list(&self, owner: &CodeBlock) {
        if !self.cases.has_list() {
            let only = self.only_case().filter(AccessCase::is_valid);
            self.cases.start_with(owner, only);
        }
    }

    fn did_change_cases(&self, vm: &Vm) {
        if self.cases.has_list() {
            self.choose_inline_case(vm, self.inline.key.shape());
        } else if !matches!(
            self.preferred_kind(),
            InlineStore::InObject | InlineStore::InStorage
        ) {
            self.clear_inline_case();
        }
    }

    fn apply(
        &self,
        vm: &Vm,
        owner: &CodeBlock,
        plan: &Result<AccessCase, NoCase>,
        name: PropertyName<'_>,
    ) {
        let has_case = plan.is_ok();
        match plan {
            Ok(case) if self.try_set_only_case(vm, owner, case) => return,
            Err(NoCase::Retry) => return,
            Err(_) if self.cases.lone_lookup().is_none() => {}
            _ => self.ensure_list(owner),
        }
        let overflow = Overflow::Megamorphic(Some(name));
        self.cases.apply(vm, owner, plan, None, overflow);
        if has_case || self.cases.is_megamorphic() {
            self.did_change_cases(vm);
        }
    }

    /// For a slow path, if it is for the shape and holds. The fast one is taken next time.
    #[inline(always)]
    pub(super) fn renewed_only_case(&self, vm: &Vm, shape: ShapeId) -> Option<AccessCase> {
        if shape != self.inline.key.shape() {
            return None;
        }
        let case = self.only_case().filter(AccessCase::is_valid)?;
        self.inline.key.renew(vm);
        Some(case)
    }

    /// About which no prototype has a say.
    #[inline(always)]
    pub(super) fn renew_private_case(&self, vm: &Vm, shape: ShapeId) {
        if shape == self.inline.key.shape() {
            self.inline.key.renew(vm);
        }
    }

    /// For when the inline case does not apply.
    #[inline(always)]
    pub fn put_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Value,
        name: PropertyName<'_>,
        value: Value,
        mode: StoreMode,
    ) -> JsResult<()> {
        if let Some(object) = base.as_object() {
            // SAFETY: `execute` does not look at the case once it has called out.
            if let Some(list) = unsafe { self.cases.list() } {
                self.tend_inline_case(cx, list, object.shape_id());
                if let Some(case) = list.find_by_shape(object.shape_id())
                    && let Some(result) =
                        execute(cx, case, object, base, name, value, mode.is_strict())
                {
                    return result;
                }
            } else if self.cases.is_megamorphic() {
                return store_megamorphic(cx, object, name, value, mode, context_in(owner));
            } else if let Some(case) = self.renewed_only_case(cx, object.shape_id())
                && let Some(result) = execute(cx, &case, object, base, name, value, false)
            {
                return result;
            }
        }
        self.put_and_cache(cx, owner, base, name, value, mode)
    }

    #[inline(never)]
    fn put_and_cache(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Value,
        name: PropertyName<'_>,
        value: Value,
        mode: StoreMode,
    ) -> JsResult<()> {
        let mut slot = PutPropertySlot::with_context(base, mode.is_strict(), context_in(owner));
        let Some(object) = base.as_object() else {
            return put_uncached(cx, name, value, mode, &mut slot).map(|_| ());
        };
        let before = Before::new(object);
        put_uncached(cx, name, value, mode, &mut slot)?;
        if self.cases.should_cache() {
            self.apply(cx, owner, &plan(cx, &before, name, &slot, mode), name);
        }
        Ok(())
    }

    pub(crate) fn reconcile_with_variable_key(&self, owner: &CodeBlock, survivors: &Survivors) {
        let shapes = [self.inline.key.shape(), self.added_shape()];
        self.renew_inline_case_if(shapes.iter().all(|&it| is_live(it, survivors)), survivors);
        self.cases.reconcile(owner, survivors);
    }
}

#[inline(always)]
fn context_in(owner: &CodeBlock) -> PutContext {
    if owner.body().kind() == bun_engine_bytecode::CodeKind::Eval {
        PutContext::PutByIdInEval
    } else {
        PutContext::PutById
    }
}

// SAFETY: integers.
unsafe impl Entry for StoreCache {
    #[inline]
    fn visit(&self, visitor: &mut Visitor) {
        self.cases.visit(visitor);
    }

    #[inline]
    fn visit_transitions(&self, visitor: &mut Visitor) {
        visit_transition(self.inline.key.shape(), self.added_shape(), visitor);
        self.cases.visit_transitions(visitor);
    }

    #[inline]
    fn reconcile(&self, owner: &CodeBlock, survivors: &Survivors) {
        self.reconcile_with_variable_key(owner, survivors);
        if self.cases.has_list() {
            self.choose_inline_case(survivors.vm(), self.inline.key.shape());
        }
    }

    #[inline]
    fn release(&self) {
        self.cases.release();
    }
}

#[inline(always)]
fn put_uncached(
    cx: &mut Cx,
    name: PropertyName<'_>,
    value: Value,
    mode: StoreMode,
    slot: &mut PutPropertySlot,
) -> JsResult<bool> {
    let base = slot.this_value();
    if let StoreMode::Set { .. } = mode {
        base.put(cx, name, value, slot)
    } else {
        (base.cast::<JsObject>()).create_data_property_with_slot(cx, name, value, slot)
    }
}

#[inline(always)]
fn store_megamorphic(
    cx: &mut Cx,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    value: Value,
    mode: StoreMode,
    context: PutContext,
) -> JsResult<()> {
    match mode {
        StoreMode::Set { is_strict } => {
            put_megamorphic_in(cx, object, name, value, is_strict, context)
        }
        StoreMode::Define { is_strict } => {
            define_megamorphic(cx, object, name, value, context, |cx, slot| {
                slot.set_strict(is_strict);
                (object.create_data_property_with_slot(cx, name, value, slot)).map(|_| ())
            })
        }
    }
}

/// An object, and the shape that it had before a store.
pub(super) struct Before {
    object: Gc<JsObject>,
    shape: Gc<Shape>,
    /// That of the target, if it is a `GlobalProxy`.
    target: Option<(Gc<GlobalObject>, Gc<Shape>)>,
}

impl Before {
    #[inline(always)]
    pub(super) fn new(object: Gc<JsObject>) -> Before {
        let target = object.downcast::<GlobalProxy>().map(|it| it.target());
        Before {
            object,
            shape: object.shape(),
            target: target.map(|it| (it, it.shape())),
        }
    }
}

pub(super) fn plan(
    cx: &Cx,
    before: &Before,
    name: PropertyName<'_>,
    slot: &PutPropertySlot,
    mode: StoreMode,
) -> Result<AccessCase, NoCase> {
    let (object, old) = (before.object, before.shape);
    let is_set = matches!(mode, StoreMode::Set { .. });
    let (kind, offset) = (slot.cacheable_kind(), slot.cached_offset());
    if object.is::<ProxyObject>() && is_set && !name.is_private() {
        cx.private_proxy_set();
        let case = case_for_proxy(cx, AccessKind::ProxySet, &object, name);
        return Ok(case.with_operand(mode.is_strict().into()));
    }
    if let Some((target, shape)) = before.target.filter(|_| !name.is_private_element()) {
        return plan_through_global_proxy(cx, object.cast(), target, shape, name, slot, mode);
    }
    if is_set && !old.reports_stores() {
        return Err(NoCase::Uncacheable);
    }
    let is_own = slot.base() == Some(object);
    if kind == PutKind::NewProperty && is_own {
        return plan_transition(cx, object, old, name, is_set);
    }
    // A setter or a conversion may have changed anything.
    if object.shape() != old {
        return Err(NoCase::Retry);
    }
    if name == names::length
        && is_set
        && object.cell_type() == CellType::Array
        && object.has_plain_writable_elements()
    {
        return Ok(AccessCase::new(AccessKind::SetArrayLength, old.id()));
    }
    if kind == PutKind::Uncacheable || slot.is_tainted_by_opaque_object() {
        return Err(NoCase::Uncacheable);
    }
    let holder = slot.base().ok_or(NoCase::Uncacheable)?;
    let (found, attributes) = match holder.shape().get(name) {
        Some(found) => found,
        None => {
            let (_, entry) = (holder.shape().find_static_property(name)).ok_or(NoCase::Retry)?;
            (crate::PropertyOffset::INVALID, entry.attributes())
        }
    };
    let expected = match kind {
        PutKind::Setter => Attributes::ACCESSOR,
        PutKind::CustomAccessor => Attributes::CUSTOM_ACCESSOR,
        PutKind::CustomValue => Attributes::CUSTOM_VALUE,
        _ => Attributes::NONE,
    };
    if found != offset
        || attributes & (Attributes::ANY_ACCESSOR | Attributes::READ_ONLY) != expected
    {
        return Err(NoCase::Retry);
    }
    let case = |kind| -> Result<AccessCase, NoCase> {
        if is_own {
            prepare(cx, &object, !offset.is_valid())?;
            return Ok(AccessCase::new(kind, old.id()));
        }
        let mut prototypes = object.chain_direct().skip(1);
        let last = prototypes.find(|&it| it == holder || !it.shape().stores_ordinarily(name));
        if !last.is_some_and(|it| it.shape().stores_ordinarily(name)) {
            return Err(NoCase::Uncacheable);
        }
        let lookup = lookup_beyond(cx, object.into(), name, Some((holder, offset)))?;
        Ok(AccessCase::new(kind, old.id()).with_lookup(lookup))
    };
    match kind {
        PutKind::ExistingProperty if is_own => {
            let case = case(AccessKind::Replace)?;
            old.did_cache_property_replacement(cx, offset);
            Ok(case.with_offset(offset))
        }
        // It gets the proxy.
        PutKind::Setter if slot.this_value().is::<GlobalObject>() => Err(NoCase::Uncacheable),
        PutKind::Setter if is_own => Ok(case(AccessKind::CallOwnSetter)?.with_offset(offset)),
        PutKind::Setter => case(AccessKind::CallInheritedSetter).map(|case| {
            let function =
                (case.lookup()).map_or(0, |it| constant_function(&it, GetterSetter::setter));
            case.with_pointer(function)
        }),
        PutKind::CustomAccessor | PutKind::CustomValue => {
            let setter = slot.custom_setter().ok_or(NoCase::Uncacheable)?;
            let case = case(if kind == PutKind::CustomValue {
                AccessKind::CallCustomValueSetter
            } else {
                AccessKind::CallCustomAccessorSetter
            })?;
            let is_plain_call = holder.realm() == Some(cx.global());
            if !is_custom_accessor_fixed(&holder, offset, case.lookup())? {
                let case = AccessCase::new(AccessKind::CallCustomSetterInSlot, old.id());
                return Ok(case.with_offset(offset).with_operand(is_plain_call.into()));
            }
            Ok((case.with_pointer(setter as usize)).with_operand(is_plain_call.into()))
        }
        _ => Err(NoCase::Uncacheable),
    }
}

fn plan_transition(
    cx: &Cx,
    object: Gc<JsObject>,
    old: Gc<Shape>,
    name: PropertyName<'_>,
    is_set: bool,
) -> Result<AccessCase, NoCase> {
    let new = object.shape();
    if old.is_dictionary() {
        return Err(NoCase::AddsToDictionary);
    }
    if new.is_dictionary() {
        return Err(NoCase::Retry);
    }
    if old.may_be_prototype()
        || !old.property_accesses_are_cacheable()
        || old.has_non_reified_static_properties()
        || old.instance_header() != new.instance_header()
        || old.existing_add_transition(name, new.transition_attributes()) != Some(new)
        || object.overrides_get_prototype()
    {
        return Err(NoCase::Uncacheable);
    }
    let first = new.prototype_object().filter(|_| is_set);
    let lookup = PrototypeLookup::for_setter_miss(cx, first, name).ok_or(NoCase::Unwatchable)?;
    let (capacity, new_capacity) = (old.out_of_line_capacity(), new.out_of_line_capacity());
    let case = if capacity == new_capacity {
        AccessCase::new(AccessKind::Transition, old.id()).with_offset(new.transition_offset())
    } else {
        let allocator = (cx
            .heap
            .auxiliary
            .allocator_for(Storage::size(new_capacity, None)))
        .filter(|_| !old.instance_indexing_mode().has_elements());
        AccessCase::new(AccessKind::TransitionAndGrow, old.id())
            .with_growth(capacity.try_into().or(Err(NoCase::Uncacheable))?, allocator)
    };
    debug_assert!(case.byte_offset() as isize == new.transition_offset().byte_offset());
    Ok(case.with_new_shape(new.id()).with_lookup(lookup))
}

fn plan_through_global_proxy(
    cx: &Cx,
    proxy: Gc<GlobalProxy>,
    target: Gc<GlobalObject>,
    shape: Gc<Shape>,
    name: PropertyName<'_>,
    slot: &PutPropertySlot,
    mode: StoreMode,
) -> Result<AccessCase, NoCase> {
    if proxy.target() != target || target.shape() != shape {
        return Err(NoCase::Retry);
    }
    if matches!(mode, StoreMode::Define { .. })
        || slot.kind() == PutKind::NewProperty
        || !shape.reports_stores()
    {
        return Err(NoCase::Uncacheable);
    }
    if slot.kind() == PutKind::Uncacheable {
        return case_for_global_binding(cx, proxy, name, AccessKind::StoreGlobalBinding);
    }
    let case = plan(cx, &Before::new(target.upcast()), name, slot, mode)?;
    Ok(case.through_global_proxy(proxy.shape_id()))
}

impl JsObject {
    /// # Safety
    /// `new_shape` adds the slot to the current shape, and there is room for it.
    #[inline(always)]
    pub unsafe fn add_cached_property(&self, new_shape: ShapeId, byte_offset: i32, value: Value) {
        // SAFETY: the caller's.
        unsafe {
            slot_at(self, byte_offset).set_without_barrier(Some(value));
            self.set_shape_id_directly(new_shape);
        }
        self.write_barrier_for_cell();
    }

    /// # Safety
    /// The same, but there is none.
    pub(crate) unsafe fn grow_and_add_cached_property(
        &self,
        vm: &Vm,
        new_shape: ShapeId,
        byte_offset: i32,
        value: Value,
    ) {
        // SAFETY: the caller's.
        unsafe {
            let new = new_shape.decode();
            let old_capacity = self.shape().out_of_line_capacity();
            let storage =
                self.storage_with_more_slots(vm, old_capacity, new.out_of_line_capacity());
            self.nuke_shape_and_set_storage(storage, false);
            self.add_cached_property(new.id(), byte_offset, value);
        }
    }
}

/// `None` if the case no longer holds. `object` has its shape, and `receiver` is the same or its proxy.
#[inline(never)]
pub(super) fn execute(
    cx: &mut Cx,
    case: &AccessCase,
    object: Gc<JsObject>,
    receiver: Value,
    name: PropertyName<'_>,
    value: Value,
    is_strict: bool,
) -> Option<JsResult<()>> {
    // SAFETY: each has what its kind says.
    unsafe {
        match case.kind() {
            AccessKind::Replace => {
                slot_at(&object, case.plain_offset()).set(&object, Some(value));
            }
            AccessKind::Transition if case.is_valid() => {
                case.renew(cx);
                object.add_cached_property(case.new_shape(), case.plain_offset(), value);
            }
            AccessKind::TransitionAndGrow if case.is_valid() => {
                let (new, byte_offset) = (case.new_shape(), case.byte_offset());
                object.grow_and_add_cached_property(cx, new, byte_offset, value);
            }
            AccessKind::ProxySet => {
                return Some(object.set(cx, name, value, is_strict).map(|_| ()));
            }
            AccessKind::CallOwnSetter | AccessKind::CallInheritedSetter => {
                let accessor = case.accessor(&object)?;
                let result = accessor.call_setter(cx, receiver, value, is_strict);
                return Some(result.map(|_| ()));
            }
            kind @ (AccessKind::CallCustomAccessorSetter | AccessKind::CallCustomValueSetter) => {
                let holder = match case.lookup() {
                    Some(lookup) => lookup.holder()?,
                    None => object,
                };
                let this = if kind == AccessKind::CallCustomValueSetter {
                    holder.into()
                } else {
                    receiver
                };
                let setter = transmute::<usize, CustomSetter>(case.pointer());
                let cx = cx.in_realm_of(&holder);
                setter(cx, this, value, name);
                return Some(cx.check_exception());
            }
            AccessKind::CallCustomSetterInSlot => {
                let setter = case.custom_in_slot(&object)?.setter()?;
                let cx = cx.in_realm_of(&object);
                setter(cx, receiver, value, name);
                return Some(cx.check_exception());
            }
            AccessKind::SetArrayLength => {
                let (array, length) = (object.cast_unchecked::<JsArray>(), value.as_index_int32()?);
                return Some(array.set_length(cx, length, is_strict).map(|_| ()));
            }
            AccessKind::StoreGlobalBinding => {
                let binding = &*core::ptr::with_exposed_provenance::<GlobalBinding>(case.pointer());
                if !binding.attributes().is_writable() {
                    return None;
                }
                binding.set(cx, &object.cast_unchecked::<GlobalObject>(), value);
            }
            AccessKind::ThroughGlobalProxy => {
                let target = object.cast_unchecked::<GlobalProxy>().target();
                if target.shape_id() != case.new_shape() {
                    return None;
                }
                let (case, target) = (case.for_target(), target.upcast());
                return execute(cx, &case, target, receiver, name, value, is_strict);
            }
            _ => return None,
        }
    }
    Some(Ok(()))
}

/// `base[name] = value`, where the name varies. It is no index, unless the base is a proxy.
#[inline(always)]
pub fn put_by_key(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    base: Value,
    name: PropertyName<'_>,
    value: Value,
    mode: StoreMode,
) -> JsResult<()> {
    if let Some(object) = base.as_object() {
        if cases.is_megamorphic() {
            return store_megamorphic(cx, object, name, value, mode, PutContext::Unknown);
        }
        // SAFETY: `execute` does not look at the case once it has called out.
        if let Some(list) = unsafe { cases.list() }
            && let Some(case) = list.find_by_name(object.shape_id(), name, Key::Variable)
            && let Some(result) = execute(cx, case, object, base, name, value, mode.is_strict())
        {
            return result;
        }
    }
    put_by_key_and_cache(cx, owner, cases, base, name, value, mode)
}

#[inline(never)]
fn put_by_key_and_cache(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    base: Value,
    name: PropertyName<'_>,
    value: Value,
    mode: StoreMode,
) -> JsResult<()> {
    let mut slot = PutPropertySlot::new(base, mode.is_strict());
    let Some(object) = base.as_object() else {
        return put_uncached(cx, name, value, mode, &mut slot).map(|_| ());
    };
    let before = Before::new(object);
    put_uncached(cx, name, value, mode, &mut slot)?;
    if cases.should_cache_in_list() {
        let plan = plan(cx, &before, name, &slot, mode);
        cases.apply_by_key(cx, owner, &plan, name, Key::Variable);
    }
    Ok(())
}

impl SetPrototype {
    pub fn set_slow(&self, vm: &Vm, owner: &CodeBlock, object: &JsObject, prototype: Value) {
        let old = object.shape();
        object.set_prototype_direct(vm, prototype);
        let new = object.shape();
        if old.existing_prototype_transition(prototype) == Some(new)
            && old.instance_header() == new.instance_header()
            && !old.instance_indexing_mode().has_elements()
            && !old.may_be_prototype()
        {
            self.from.set(old.id());
            self.to.set(new.id());
            owner.has_transitions.set(true);
            owner.write_barrier_for_cell();
        }
    }
}

// SAFETY: integers.
unsafe impl Entry for SetPrototype {
    fn visit_transitions(&self, visitor: &mut Visitor) {
        let to = self.to.get();
        // SAFETY: it has not been swept, or it would have been cleared.
        let prototype = (!to.is_none()).then(|| unsafe { to.decode() }.prototype_object());
        if (prototype.flatten()).is_none_or(|it| visitor.is_address_marked(it.address())) {
            visit_transition(self.from.get(), to, visitor);
        }
    }

    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        if !is_live(self.from.get(), survivors) || !is_live(self.to.get(), survivors) {
            self.from.set(NUMBER_SHAPE);
            self.to.set(ShapeId::NONE);
        }
    }
}
