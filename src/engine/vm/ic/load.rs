use core::mem::{offset_of, transmute};

use bun_engine_regexp::Flags;
use bun_engine_text::{PropertyName, names};

use super::cases::{NoCase, Overflow};
use super::inline::InlineCache;
use super::{
    AccessCase, AccessCases, AccessKind, InlineCase, InlineKind, InlineLoad, Key, PrototypeLookup,
    is_live, shape_for_lookup, slot_at,
};
use crate::caches::{get_megamorphic, get_megamorphic_with_receiver, get_own_megamorphic};
use crate::code::metadata::Entry;
use crate::heap::Survivors;
use crate::{
    Attributes, CellType, CodeBlock, CustomGetter, Cx, Field, Gc, GetterSetter, GlobalObject,
    GlobalProxy, InternalMethod, Intrinsic, JsArray, JsArrayBufferView, JsFunction, JsMap,
    JsObject, JsResult, JsSet, JsString, MappedArguments, PropertyOffset, PropertySlot,
    ProxyObject, RegExpObject, ShapeFlags, ShapeId, Value, Visitor, Vm,
};

#[repr(C)]
pub struct LoadCache {
    /// The operand is the address of the name, if the site is megamorphic.
    inline: InlineCase,
    cases: AccessCases,
}

impl InlineCache for LoadCache {
    type Kind = InlineLoad;

    #[inline(always)]
    fn inline_case(&self) -> &InlineCase {
        &self.inline
    }

    #[inline(always)]
    fn listed(&self) -> &AccessCases {
        &self.cases
    }
}

impl LoadCache {
    pub const OFFSET_OF_INLINE: usize = offset_of!(LoadCache, inline);
    pub const OFFSET_OF_CASES: usize = offset_of!(LoadCache, cases);

    #[inline(always)]
    pub fn inline(&self) -> &InlineCase {
        &self.inline
    }

    /// What is worth a place in compiled code.
    pub fn likely_kind(&self) -> Option<InlineLoad> {
        self.kind_for_compiled_code()
    }

    /// That of the case which is not in the list, if there is one.
    pub fn shape(&self) -> ShapeId {
        self.unlisted_shape()
    }

    /// Of the slot of that case, unless it has a lookup.
    #[inline(always)]
    pub fn byte_offset(&self) -> i32 {
        self.inline.loaded_slot()
    }

    /// If that case is `LoadConstant`.
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

    /// The case that is not in the list.
    pub fn only_case(&self) -> Option<AccessCase> {
        let shape = Some(self.shape()).filter(|it| !it.is_none())?;
        Some(match self.preferred_kind() {
            InlineLoad::Constant => AccessCase::new(AccessKind::LoadConstant, shape)
                .with_lookup(self.cases.lone_lookup()?)
                .with_pointer(self.inline.constant() as usize),
            InlineLoad::InObject | InlineLoad::InStorage => {
                AccessCase::new(AccessKind::LoadOwn, shape).with_byte_offset(self.byte_offset())
            }
            _ => return None,
        })
    }

    fn ensure_list(&self, owner: &CodeBlock) {
        if !self.cases.has_list() {
            let only = self.only_case().filter(AccessCase::is_valid);
            self.cases.start_with(owner, only);
        }
    }

    fn did_change_cases(&self, vm: &Vm, name: PropertyName<'_>) {
        if self.cases.has_list() {
            self.choose_inline_case(vm, self.inline.key.shape());
        } else if self.cases.is_megamorphic() {
            if !matches!(
                self.preferred_kind(),
                InlineLoad::InObject | InlineLoad::InStorage
            ) {
                self.clear_inline_case();
            }
            self.inline.keep_name(name.address());
        }
    }

    fn add(&self, vm: &Vm, owner: &CodeBlock, case: &AccessCase, name: PropertyName<'_>) {
        if !self.cases.has_list() && self.inline.key.shape().is_none() {
            if case.kind() == AccessKind::LoadOwn {
                return self.set_inline_slot(vm, owner, case);
            }
            if let (AccessKind::LoadConstant, Some(lookup)) = (case.kind(), case.lookup())
                && self.cases.is_blank()
            {
                self.cases.set_lone_lookup(owner, lookup);
                return (self.inline).set_unlisted(vm, owner, case, InlineLoad::Constant);
            }
        }
        self.ensure_list(owner);
        let overflow = Overflow::Megamorphic(Some(name));
        self.cases.add(vm, owner, case, None, overflow);
        self.did_change_cases(vm, name);
    }

    fn did_fail(&self, vm: &Vm, owner: &CodeBlock, reason: NoCase, name: PropertyName<'_>) {
        if reason == NoCase::Retry {
            return;
        }
        if self.cases.lone_lookup().is_some() {
            self.ensure_list(owner);
        }
        let overflow = Overflow::Megamorphic(Some(name));
        self.cases.did_fail(reason, overflow);
        if self.cases.is_megamorphic() {
            self.did_change_cases(vm, name);
        }
    }

    /// The site is not megamorphic.
    #[inline(always)]
    fn try_cases(
        &self,
        cx: &mut Cx,
        base: Value,
        name: PropertyName<'_>,
    ) -> Option<JsResult<Value>> {
        let shape = shape_for_lookup(base);
        // SAFETY: `execute` does not look at the case once it has called out.
        if let Some(list) = unsafe { self.cases.list() } {
            self.tend_inline_case(cx, list, shape);
            return execute(cx, list.find_by_shape(shape)?, base, base, name);
        }
        if shape != self.inline.key.shape() {
            return None;
        }
        let case = self.only_case().filter(AccessCase::is_valid)?;
        self.inline.key.renew(cx);
        execute(cx, &case, base, base, name)
    }

    /// For when the inline case does not apply.
    #[inline(always)]
    pub fn get_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Value,
        name: PropertyName<'_>,
    ) -> JsResult<Value> {
        if self.cases.is_megamorphic() {
            return get_megamorphic(cx, base, name);
        }
        match self.try_cases(cx, base, name) {
            Some(result) => result,
            None => self.look_up(cx, owner, base, name),
        }
    }

    #[inline(never)]
    fn look_up(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Value,
        name: PropertyName<'_>,
    ) -> JsResult<Value> {
        let mut slot = PropertySlot::new(base, InternalMethod::Get);
        let found = base.get_property_slot(cx, name, &mut slot)?;
        self.update(cx, owner, base, name, &slot, Reach::Chain);
        value_if_found(cx, found, &slot, name)
    }

    /// The same for an own property, which is undefined if there is none.
    pub fn get_own_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> JsResult<Value> {
        if self.cases.is_megamorphic() {
            return get_own_megamorphic(cx, base, name);
        }
        let value = base.into();
        if let Some(result) = self.try_cases(cx, value, name) {
            return result;
        }
        let mut slot = PropertySlot::new(value, InternalMethod::GetOwnProperty);
        let found = base.get_own_property_slot(cx, name, &mut slot)?;
        self.update(cx, owner, value, name, &slot, Reach::Own);
        value_if_found(cx, found, &slot, name)
    }

    #[inline(always)]
    fn update(
        &self,
        cx: &Cx,
        owner: &CodeBlock,
        base: Value,
        name: PropertyName<'_>,
        slot: &PropertySlot,
        reach: Reach,
    ) {
        let is_cheap = self.inline.key.shape().is_none()
            && !self.cases.is_megamorphic()
            && slot.is_value()
            && slot.base().is_some_and(|it| base == it.into());
        let should_cache = || match slot.is_value() || slot.is_unset() {
            true => self.cases.should_cache(),
            false => self.cases.should_cache_in_list(),
        };
        if is_cheap || should_cache() {
            match &plan(cx, base, name, slot, reach) {
                Ok(case) => self.add(cx, owner, case, name),
                &Err(reason) => self.did_fail(cx, owner, reason, name),
            }
        }
    }

    // For a private name, which varies and is always in a slot of the object.

    /// The case is `LoadOwn`.
    pub(super) fn set_inline_slot(&self, vm: &Vm, owner: &CodeBlock, case: &AccessCase) {
        let kind = InlineLoad::of_case(case).expect("a plain load");
        self.inline.set_unlisted(vm, owner, case, kind);
    }

    pub(crate) fn reset(&self) {
        self.clear_inline_case();
    }

    pub(crate) fn reconcile_with_variable_key(&self, owner: &CodeBlock, survivors: &Survivors) {
        self.renew_inline_case_if(is_live(self.inline.key.shape(), survivors), survivors);
        self.cases.reconcile(owner, survivors);
    }
}

// SAFETY: integers.
unsafe impl Entry for LoadCache {
    #[inline]
    fn visit(&self, visitor: &mut Visitor) {
        self.cases.visit(visitor);
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Reach {
    Own,
    Chain,
    /// The receiver need not be where the lookup starts.
    ChainForReceiver,
}

#[inline(always)]
fn value_if_found(
    cx: &mut Cx,
    found: bool,
    slot: &PropertySlot,
    name: PropertyName<'_>,
) -> JsResult<Value> {
    if found {
        slot.value(cx, name)
    } else {
        Ok(Value::UNDEFINED)
    }
}

/// Whether the shape of the object says where its properties are. `needs_absence`: and which it does not have.
pub(super) fn prepare(vm: &Vm, object: &JsObject, needs_absence: bool) -> Result<(), NoCase> {
    let shape = object.shape();
    if shape.is_uncacheable_dictionary() && object.is::<GlobalObject>() {
        object.make_dictionary_cacheable(vm);
        return Err(NoCase::Retry);
    }
    if shape.is_uncacheable_dictionary() || (needs_absence && shape.is_dictionary()) {
        if shape.has(ShapeFlags::HAS_BEEN_FLATTENED) {
            return Err(NoCase::Unwatchable);
        }
        object.flatten_dictionary(vm);
        return Err(NoCase::Retry);
    }
    if !shape.property_accesses_are_cacheable()
        || (needs_absence && (!shape.absence_is_cacheable() || object.overrides_get_prototype()))
    {
        return Err(NoCase::Uncacheable);
    }
    if needs_absence && let Some(global) = object.downcast::<GlobalObject>() {
        global.did_cache_absence();
    }
    Ok(())
}

/// Where an object keeps what a getter returns for it.
pub struct KeptResult {
    /// Of a `Field<Option<Gc<_>>>` that all objects of the class have.
    pub offset: u16,
    /// Does what the getter does.
    pub getter: CustomGetter,
}

/// What the rest of the chain says, for a receiver that does not have the property. `holder` is where it has been found.
pub(super) fn lookup_beyond(
    cx: &Cx,
    base: Value,
    name: PropertyName<'_>,
    holder: Option<(Gc<JsObject>, PropertyOffset)>,
) -> Result<Gc<PrototypeLookup>, NoCase> {
    let first = match base.as_object() {
        Some(object) => {
            prepare(cx, &object, true)?;
            // What makes a value on demand can run scripts.
            if object.shape().get(name).is_some()
                || (CellType::TYPED_ARRAYS.contains(object.cell_type())
                    && !object.shape().is_ordinary_name(name))
            {
                return Err(NoCase::Uncacheable);
            }
            object.prototype_object_direct()
        }
        None if base.is_undefined_or_null() => return Err(NoCase::Uncacheable),
        None => base.synthesize_prototype(cx).ok(),
    };
    match (first, holder) {
        (Some(first), Some((holder, offset))) => PrototypeLookup::for_hit(cx, first, holder, name)
            .filter(|lookup| lookup.has_slot() == offset.is_valid()),
        (None, Some(_)) => None,
        (first, None) => PrototypeLookup::for_miss(cx, first, name),
    }
    .ok_or(NoCase::Unwatchable)
}

pub(super) fn place_of(slot: &PropertySlot) -> Option<(Gc<JsObject>, PropertyOffset)> {
    Some((slot.base()?, slot.cached_offset()))
}

/// Whether a native accessor stays the same for as long as a case holds. If not, it is in a slot of the object.
pub(super) fn is_custom_accessor_fixed(
    holder: &JsObject,
    offset: PropertyOffset,
    lookup: Option<Gc<PrototypeLookup>>,
) -> Result<bool, NoCase> {
    match lookup {
        _ if !offset.is_valid() => Ok(true),
        Some(lookup) => lookup.constant().map(|_| true).ok_or(NoCase::Unwatchable),
        None if holder.shape().has(ShapeFlags::IS_CLAIMED) => Ok(true),
        None if holder.is::<GlobalObject>() => Err(NoCase::Uncacheable),
        None => Ok(false),
    }
}

fn kind_for_length(base: Value) -> Option<AccessKind> {
    let cell = base.as_cell()?;
    match cell.cell_type() {
        CellType::Array => (cell.indexing_mode().has_elements()).then_some(AccessKind::ArrayLength),
        CellType::String => Some(AccessKind::StringLength),
        _ => (base.downcast::<MappedArguments>()?.original_length())
            .map(|_| AccessKind::ArgumentsLength),
    }
}

fn plan(
    cx: &Cx,
    base: Value,
    name: PropertyName<'_>,
    slot: &PropertySlot,
    reach: Reach,
) -> Result<AccessCase, NoCase> {
    if !slot.is_cacheable() || name.as_index().is_some() {
        return plan_for_exotic_property(cx, base, name, slot, reach);
    }
    if let Some(proxy) = base.downcast::<GlobalProxy>() {
        let case = plan(cx, proxy.target().into(), name, slot, reach)?;
        return Ok(case.through_global_proxy(proxy.shape_id()));
    }
    let own = base.as_object().filter(|&it| slot.base() == Some(it));
    let lookup = match (own, base.as_object()) {
        (Some(object), _) => {
            prepare(cx, &object, !slot.cached_offset().is_valid())?;
            None
        }
        (None, Some(object)) if reach == Reach::Own => {
            if !slot.is_unset() {
                return Err(NoCase::Uncacheable);
            }
            prepare(cx, &object, true)?;
            Some(PrototypeLookup::of_empty_chain(cx))
        }
        _ => Some(lookup_beyond(cx, base, name, place_of(slot))?),
    };
    let case = |kind| AccessCase::new(kind, shape_for_lookup(base));
    if let Some(lookup) = lookup.filter(|_| reach == Reach::Chain)
        && let Some(kept) = kept_result(cx, base, slot, &lookup)
    {
        let case = case(AccessKind::LoadKeptResult).with_operand(kept.offset);
        return Ok(case.with_pointer(kept.getter as usize).with_lookup(lookup));
    }
    if let Some(getter) = slot.custom_getter() {
        let is_accessor = slot.attributes().contains(Attributes::CUSTOM_ACCESSOR);
        let this = if is_accessor {
            (slot.this_value().as_cell()).filter(|_| reach != Reach::ChainForReceiver)
        } else {
            slot.base().map(Gc::cell)
        };
        if let Some(class) = slot.required_class()
            && !this.is_some_and(|it| it.inherits(class))
        {
            return Err(NoCase::Uncacheable);
        }
        let (holder, offset) = place_of(slot).ok_or(NoCase::Uncacheable)?;
        let is_plain_call = (is_accessor || own.is_some()) && holder.realm() == Some(cx.global());
        if !is_custom_accessor_fixed(&holder, offset, lookup)? {
            if slot.required_class().is_some() {
                return Err(NoCase::Uncacheable);
            }
            let is_value = if is_accessor {
                0
            } else {
                AccessCase::IS_CUSTOM_VALUE
            };
            let case = case(AccessKind::CallCustomGetterInSlot).with_offset(offset);
            return Ok(case.with_operand(is_value | u16::from(is_plain_call)));
        }
        let case = case(if is_accessor {
            AccessKind::CallCustomAccessorGetter
        } else {
            AccessKind::CallCustomValueGetter
        });
        let case = (case.with_pointer(getter as usize)).with_operand(is_plain_call.into());
        return Ok(match lookup {
            Some(lookup) => case.with_lookup(lookup),
            None => case,
        });
    }
    Ok(match lookup {
        _ if slot.is_custom() => return Err(NoCase::Uncacheable),
        // It gets the proxy.
        _ if slot.is_accessor() && slot.this_value().is::<GlobalObject>() => {
            return Err(NoCase::Uncacheable);
        }
        None if slot.is_accessor() => {
            case(AccessKind::CallOwnGetter).with_offset(slot.cached_offset())
        }
        None => case(AccessKind::LoadOwn).with_offset(slot.cached_offset()),
        Some(lookup) if slot.is_accessor() => (case_for_builtin_getter(base, &lookup))
            .filter(|_| reach == Reach::Chain)
            .unwrap_or_else(|| {
                let function = constant_function(&lookup, GetterSetter::getter);
                case(AccessKind::CallInheritedGetter).with_pointer(function)
            })
            .with_lookup(lookup),
        Some(lookup) => match lookup.constant() {
            Some(constant) => case(AccessKind::LoadConstant).with_answer(constant),
            None => case(AccessKind::LoadInherited),
        }
        .with_lookup(lookup),
    })
}

/// The address of the getter or the setter, if that stays the same and has an executable. Otherwise zero.
pub(super) fn constant_function(
    lookup: &PrototypeLookup,
    which: fn(&GetterSetter) -> Option<Gc<JsObject>>,
) -> usize {
    let function = (lookup.constant()).and_then(|it| which(&it.cast::<GetterSetter>()));
    (function.filter(|it| CellType::FUNCTIONS.contains(it.cell_type()))).map_or(0, Gc::address)
}

fn kept_result(
    cx: &Cx,
    base: Value,
    slot: &PropertySlot,
    lookup: &PrototypeLookup,
) -> Option<KeptResult> {
    let getter = match slot.custom_getter() {
        Some(getter) if slot.attributes().contains(Attributes::CUSTOM_ACCESSOR) => getter as usize,
        None if slot.is_accessor() => {
            let getter = lookup.constant()?.cast::<GetterSetter>().getter()?;
            (getter.downcast::<JsFunction>()?.native_executable()?).function() as usize
        }
        _ => return None,
    };
    (cx.hooks().kept_result_of_wasm_getter)(getter, &*base.as_object()?)
}

/// One that is in no slot of an object.
fn plan_for_exotic_property(
    cx: &Cx,
    base: Value,
    name: PropertyName<'_>,
    slot: &PropertySlot,
    reach: Reach,
) -> Result<AccessCase, NoCase> {
    if name == names::length
        && let Some(kind) = kind_for_length(base)
    {
        return Ok(AccessCase::new(kind, shape_for_lookup(base)));
    }
    let object = base.as_object().ok_or(NoCase::Uncacheable)?;
    if object.is::<ProxyObject>() && reach != Reach::Own && !name.is_private() {
        cx.private_proxy_get();
        return Ok(case_for_proxy(cx, AccessKind::ProxyGet, &object, name));
    }
    if name.as_index().is_some() || slot.is_tainted_by_opaque_object() {
        return Err(NoCase::Uncacheable);
    }
    if let Some((environment, offset)) = slot.module_binding()
        && slot.base() == Some(object)
    {
        object.claim_shape(cx);
        // SAFETY: from the namespace, which keeps the environment alive.
        let address = core::ptr::from_ref(unsafe { environment.slot_unchecked(offset) });
        let case = AccessCase::new(AccessKind::LoadModuleBinding, object.shape_id());
        return Ok(case.with_pointer(address.expose_provenance()));
    }
    if let Some(proxy) = object.downcast::<GlobalProxy>()
        && slot.is_value()
        && slot.base() == Some(proxy.target().upcast())
    {
        return case_for_global_binding(cx, proxy, name, AccessKind::LoadGlobalBinding);
    }
    Err(NoCase::Uncacheable)
}

pub(super) fn case_for_proxy(
    vm: &Vm,
    kind: AccessKind,
    proxy: &JsObject,
    name: PropertyName<'_>,
) -> AccessCase {
    let key = Value::from_name(vm, name);
    AccessCase::new(kind, proxy.shape_id()).with_pointer(key.to_bits() as usize)
}

pub(super) fn case_for_global_binding(
    vm: &Vm,
    proxy: Gc<GlobalProxy>,
    name: PropertyName<'_>,
    kind: AccessKind,
) -> Result<AccessCase, NoCase> {
    let target = proxy.target();
    prepare(vm, &target, false)?;
    let binding = (target.variables().find(name))
        .filter(|it| kind == AccessKind::LoadGlobalBinding || it.attributes().is_writable())
        .ok_or(NoCase::Uncacheable)?;
    let address = core::ptr::from_ref(binding).expose_provenance();
    let case = AccessCase::new(kind, target.shape_id()).with_pointer(address);
    Ok(case.through_global_proxy(proxy.shape_id()))
}

fn case_for_builtin_getter(base: Value, lookup: &PrototypeLookup) -> Option<AccessCase> {
    let getter = lookup.constant()?.cast::<GetterSetter>().getter()?;
    let object = base.as_object()?;
    let case = |kind| Some(AccessCase::new(kind, object.shape_id()));
    let of_view = |fixed, resizable| match object.downcast::<JsArrayBufferView>() {
        Some(view) if view.cell_type() == CellType::DataView => None,
        Some(view) => case(if view.is_resizable_or_growable() {
            resizable
        } else {
            fixed
        })
        .map(|it| it.with_operand(view.size_shift() as u16)),
        None => None,
    };
    let flag = |flag: Flags| {
        let case = case(AccessKind::RegExpFlag).filter(|_| object.is::<RegExpObject>());
        case.map(|it| it.with_operand(flag.bits().into()))
    };
    match (
        getter.downcast::<JsFunction>()?.intrinsic(),
        object.cell_type(),
    ) {
        (Intrinsic::TypedArrayLength, _) => of_view(
            AccessKind::TypedArrayLength,
            AccessKind::ResizableTypedArrayLength,
        ),
        (Intrinsic::TypedArrayByteLength, _) => of_view(
            AccessKind::TypedArrayByteLength,
            AccessKind::ResizableTypedArrayByteLength,
        ),
        (Intrinsic::TypedArrayByteOffset, _) => of_view(
            AccessKind::TypedArrayByteOffset,
            AccessKind::ResizableTypedArrayByteOffset,
        ),
        (Intrinsic::DataViewByteLength, CellType::DataView)
            if !object
                .cast::<JsArrayBufferView>()
                .is_resizable_or_growable() =>
        {
            case(AccessKind::DataViewByteLength)
        }
        (Intrinsic::MapSize, CellType::Map) | (Intrinsic::SetSize, CellType::Set) => {
            case(AccessKind::CollectionSize)
        }
        (Intrinsic::UnderscoreProto, _) => {
            case(AccessKind::LoadPrototype).map(|it| it.with_answer(object.prototype_direct()))
        }
        (Intrinsic::RegExpHasIndices, _) => flag(Flags::HAS_INDICES),
        (Intrinsic::RegExpGlobal, _) => flag(Flags::GLOBAL),
        (Intrinsic::RegExpIgnoreCase, _) => flag(Flags::IGNORE_CASE),
        (Intrinsic::RegExpMultiline, _) => flag(Flags::MULTILINE),
        (Intrinsic::RegExpDotAll, _) => flag(Flags::DOT_ALL),
        (Intrinsic::RegExpUnicode, _) => flag(Flags::UNICODE),
        (Intrinsic::RegExpUnicodeSets, _) => flag(Flags::UNICODE_SETS),
        (Intrinsic::RegExpSticky, _) => flag(Flags::STICKY),
        _ => None,
    }
}

/// # Safety
/// The address of a slot that outlives the borrow.
#[inline(always)]
unsafe fn field_at<'a>(address: usize) -> &'a Field<Option<Value>> {
    // SAFETY: the caller's.
    unsafe { &*core::ptr::with_exposed_provenance(address) }
}

#[inline(always)]
fn call_custom_getter(
    cx: &mut Cx,
    getter: CustomGetter,
    holder: &JsObject,
    this: Value,
    name: PropertyName<'_>,
) -> JsResult<Value> {
    let cx = cx.in_realm_of(holder);
    let result = getter(cx, this, name);
    cx.check_exception().map(|()| result.unwrap_or_default())
}

/// `None` if the case no longer holds. `base` has its shape.
#[inline(never)]
fn execute(
    cx: &mut Cx,
    case: &AccessCase,
    base: Value,
    receiver: Value,
    name: PropertyName<'_>,
) -> Option<JsResult<Value>> {
    // SAFETY: only the kinds that were made for a cell look at it, and each has what its kind says.
    unsafe {
        let object = Gc::<JsObject>::from_address(base.to_bits() as usize);
        let view = || object.cast_unchecked::<JsArrayBufferView>();
        Some(Ok(match case.kind() {
            AccessKind::LoadOwn => slot_at(&object, case.plain_offset()).get()?,
            AccessKind::LoadConstant | AccessKind::LoadPrototype => case.renewed_answer(cx)?,
            AccessKind::LoadInherited => case.lookup()?.stored_value()?,
            AccessKind::CallOwnGetter | AccessKind::CallInheritedGetter => {
                return Some(case.accessor(&object)?.call_getter(cx, receiver));
            }
            kind @ (AccessKind::CallCustomAccessorGetter
            | AccessKind::CallCustomValueGetter
            | AccessKind::LoadKeptResult) => {
                let holder = match case.lookup() {
                    Some(lookup) => lookup.holder()?,
                    None => object,
                };
                let this = if kind == AccessKind::CallCustomValueGetter {
                    holder.into()
                } else {
                    receiver
                };
                let getter = transmute::<usize, CustomGetter>(case.pointer());
                return Some(call_custom_getter(cx, getter, &holder, this, name));
            }
            AccessKind::CallCustomGetterInSlot => {
                let getter = case.custom_in_slot(&object)?.getter()?;
                let is_value = case.operand() & AccessCase::IS_CUSTOM_VALUE != 0;
                let this = if is_value { base } else { receiver };
                return Some(call_custom_getter(cx, getter, &object, this, name));
            }
            AccessKind::ArrayLength => object.cast_unchecked::<JsArray>().length().into(),
            AccessKind::StringLength => object.cast_unchecked::<JsString>().len().into(),
            AccessKind::ArgumentsLength => {
                (object.cast_unchecked::<MappedArguments>().original_length())?.into()
            }
            AccessKind::ProxyGet => {
                let proxy = object.cast_unchecked::<ProxyObject>();
                return Some(proxy.get_through(cx, name, receiver));
            }
            AccessKind::LoadModuleBinding | AccessKind::LoadGlobalBinding => {
                field_at(case.pointer()).get()?
            }
            AccessKind::ThroughGlobalProxy => {
                let target = object.cast_unchecked::<GlobalProxy>().target();
                if target.shape_id() != case.new_shape() {
                    return None;
                }
                return execute(cx, &case.for_target(), target.into(), receiver, name);
            }
            _ if !case.is_valid() => return None,
            AccessKind::TypedArrayLength | AccessKind::ResizableTypedArrayLength => {
                view().length().into()
            }
            AccessKind::TypedArrayByteLength | AccessKind::ResizableTypedArrayByteLength => {
                view().byte_length().into()
            }
            AccessKind::TypedArrayByteOffset | AccessKind::ResizableTypedArrayByteOffset => {
                view().byte_offset().into()
            }
            AccessKind::DataViewByteLength => view().checked_length()?.into(),
            AccessKind::CollectionSize => match object.downcast::<JsMap>() {
                Some(map) => map.size().into(),
                None => object.cast::<JsSet>().size().into(),
            },
            AccessKind::RegExpFlag => {
                let flags = object.cast_unchecked::<RegExpObject>().regexp().flags();
                (u16::from(flags.bits()) & case.operand() != 0).into()
            }
            _ => return None,
        }))
    }
}

/// `base[name]`, at a site that has no inline case. `receiver` is what it has for `this`, if it has that operand.
#[inline(always)]
pub fn get_by_key(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    base: Value,
    receiver: Option<Value>,
    name: PropertyName<'_>,
    key: Key,
) -> JsResult<Value> {
    let this = receiver.unwrap_or(base);
    if cases.is_megamorphic() {
        return get_megamorphic_with_receiver(cx, base, name, this);
    }
    // SAFETY: `execute` does not look at the case once it has called out.
    if let Some(list) = unsafe { cases.list() }
        && let Some(case) = list.find_by_name(shape_for_lookup(base), name, key)
        && let Some(result) = execute(cx, case, base, this, name)
    {
        return result;
    }
    look_up_by_key(cx, owner, cases, base, receiver, name, key)
}

#[inline(never)]
fn look_up_by_key(
    cx: &mut Cx,
    owner: &CodeBlock,
    cases: &AccessCases,
    base: Value,
    receiver: Option<Value>,
    name: PropertyName<'_>,
    key: Key,
) -> JsResult<Value> {
    let mut slot = PropertySlot::new(receiver.unwrap_or(base), InternalMethod::Get);
    let found = base.get_property_slot(cx, name, &mut slot)?;
    if cases.should_cache_in_list() {
        let reach = receiver.map_or(Reach::Chain, |_| Reach::ChainForReceiver);
        let plan = plan(cx, base, name, &slot, reach);
        cases.apply_by_key(cx, owner, &plan, name, key);
    }
    value_if_found(cx, found, &slot, name)
}
