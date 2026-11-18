//! A class that is evaluated again has other names. The inline case is for one of them, and those in the list say which
//! they are for.

use super::cases::{NoCase, Overflow};
use super::load::prepare;
use super::store::{self, Before};
use super::{AccessCase, AccessCases, AccessKind, PrototypeLookup, StoreMode};
use crate::caches::{
    define_megamorphic, get_private_megamorphic, has_private_megamorphic,
    replace_private_megamorphic,
};
use crate::code::metadata::{GetPrivateName, PutPrivateName, WeakCell};
use crate::{
    CodeBlock, Cx, Gc, InternalMethod, JsObject, JsResult, JsSymbol, PropertySlot, PutContext,
    PutPropertySlot, Value, Vm,
};

const OVERFLOW: Overflow<'_> = Overflow::Megamorphic(None);

fn ensure_list(
    vm: &Vm,
    owner: &CodeBlock,
    cases: &AccessCases,
    only: Option<AccessCase>,
    name: &WeakCell,
) {
    if !cases.has_list() {
        cases.start_with(owner, None);
        if let (Some(case), Some(symbol)) = (only, name.get().map(Gc::cast::<JsSymbol>)) {
            cases.add(vm, owner, &case, Some(symbol.anchor().name()), OVERFLOW);
        }
    }
}

impl GetPrivateName {
    /// For when no case applies.
    #[inline]
    pub fn get_slow(
        &self,
        cx: &Cx,
        owner: &CodeBlock,
        base: Value,
        symbol: Gc<JsSymbol>,
    ) -> JsResult<Value> {
        let (cases, name) = (self.cache.all_cases(), symbol.anchor().name());
        if cases.is_megamorphic()
            && let Some(value) =
                (base.as_object()).and_then(|it| get_private_megamorphic(cx, it, name))
        {
            return Ok(value);
        }
        let mut slot = PropertySlot::new(base, InternalMethod::GetOwnProperty);
        let value = base.get_private_field(cx, name, &mut slot)?;
        let is_first = self.cache.inline().key.shape().is_none();
        if let Some(object) = slot.base()
            && (is_first || cases.should_cache())
            && prepare(cx, &object, false).is_ok()
        {
            let case = AccessCase::new(AccessKind::LoadOwn, object.shape_id())
                .with_offset(slot.cached_offset());
            if is_first {
                self.cache.set_inline_slot(cx, owner, &case);
                self.name.set(owner, &symbol);
            }
            if !is_first || cases.has_list() {
                ensure_list(cx, owner, cases, self.cache.only_case(), &self.name);
                cases.add(cx, owner, &case, Some(name), OVERFLOW);
            }
        }
        Ok(value)
    }
}

impl PutPrivateName {
    fn apply(
        &self,
        cx: &Cx,
        owner: &CodeBlock,
        plan: &Result<AccessCase, NoCase>,
        symbol: Gc<JsSymbol>,
    ) {
        debug_assert!(
            (plan.iter().flat_map(AccessCase::lookup))
                .all(|it| it == PrototypeLookup::of_empty_chain(cx))
        );
        match plan {
            Ok(case) if self.cache.try_set_only_case(cx, owner, case) => {
                return self.name.set(owner, &symbol);
            }
            Err(NoCase::Retry) => return,
            _ => {}
        }
        let cases = self.cache.all_cases();
        if plan.is_ok() || cases.lone_lookup().is_some() {
            ensure_list(cx, owner, cases, self.cache.only_case(), &self.name);
        }
        cases.apply(cx, owner, plan, Some(symbol.anchor().name()), OVERFLOW);
    }

    #[inline(always)]
    fn store(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        object: Gc<JsObject>,
        symbol: Gc<JsSymbol>,
        value: Value,
        uncached: impl FnOnce(&Cx, &mut PutPropertySlot) -> JsResult<()>,
    ) -> JsResult<()> {
        let (cases, shape, name) = (
            self.cache.all_cases(),
            object.shape_id(),
            symbol.anchor().name(),
        );
        let is_inline_name = self.name.bits() == symbol.address();
        // SAFETY: `execute` does not look at the case once it has called out.
        if let Some(list) = unsafe { cases.list() } {
            if is_inline_name {
                self.cache.renew_private_case(cx, shape);
            }
            if let Some(case) = list.find(shape, name.address())
                && let Some(result) =
                    store::execute(cx, case, object, object.into(), name, value, true)
            {
                return result;
            }
        } else if is_inline_name
            && let Some(case) = self.cache.renewed_only_case(cx, shape)
            && let Some(result) =
                store::execute(cx, &case, object, object.into(), name, value, true)
        {
            return result;
        }
        let before = Before::new(object);
        let mut slot = PutPropertySlot::with_context(object.into(), true, PutContext::PutById);
        uncached(cx, &mut slot)?;
        if cases.should_cache() {
            let mode = StoreMode::Define { is_strict: true };
            self.apply(
                cx,
                owner,
                &store::plan(cx, &before, name, &slot, mode),
                symbol,
            );
        }
        Ok(())
    }

    #[inline(always)]
    fn add(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        object: Gc<JsObject>,
        symbol: Gc<JsSymbol>,
        value: Value,
        uncached: impl FnOnce(&Cx, &mut PutPropertySlot) -> JsResult<()>,
    ) -> JsResult<()> {
        if !self.cache.all_cases().is_megamorphic() {
            return self.store(cx, owner, object, symbol, value, uncached);
        }
        let (name, context) = (symbol.anchor().name(), PutContext::PutById);
        define_megamorphic(cx, object, name, value, context, |cx, slot| {
            uncached(cx, slot)
        })
    }

    #[inline]
    pub fn set_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Value,
        symbol: Gc<JsSymbol>,
        value: Value,
    ) -> JsResult<()> {
        let name = symbol.anchor().name();
        let uncached =
            |cx: &Cx, slot: &mut PutPropertySlot| base.set_private_field(cx, name, value, slot);
        match base.as_object() {
            Some(object) if !self.cache.all_cases().is_megamorphic() => {
                self.store(cx, owner, object, symbol, value, uncached)
            }
            Some(object) if replace_private_megamorphic(cx, object, name, value) => Ok(()),
            _ => uncached(cx, &mut PutPropertySlot::new(base, true)),
        }
    }

    #[inline]
    pub fn define_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Gc<JsObject>,
        symbol: Gc<JsSymbol>,
        value: Value,
    ) -> JsResult<()> {
        self.add(cx, owner, base, symbol, value, |cx, slot| {
            base.define_private_field(cx, symbol.anchor().name(), value, slot)
        })
    }

    #[inline]
    pub fn set_brand_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        base: Gc<JsObject>,
        brand: Gc<JsSymbol>,
    ) -> JsResult<()> {
        let value = JsObject::PRIVATE_BRAND_VALUE;
        self.add(cx, owner, base, brand, value, |cx, slot| {
            base.set_private_brand(cx, brand.anchor().name(), slot)
        })
    }

    /// A case says only that the shape has the brand, which nothing takes away.
    #[inline]
    pub fn check_brand_slow(
        &self,
        cx: &Cx,
        owner: &CodeBlock,
        base: Value,
        brand: Gc<JsSymbol>,
    ) -> JsResult<()> {
        let (cases, name) = (self.cache.all_cases(), brand.anchor().name());
        if let Some(object) = base.as_object() {
            // SAFETY: nothing is called while it is looked at.
            let has_brand = match unsafe { cases.list() } {
                Some(list) => (list.find(object.shape_id(), name.address()))
                    .is_some_and(|case| case.renewed_answer(cx).is_some()),
                None => cases.is_megamorphic() && has_private_megamorphic(cx, object, name),
            };
            if has_brand {
                return Ok(());
            }
        }
        let mut slot = PropertySlot::new(base, InternalMethod::GetOwnProperty);
        base.check_private_brand(cx, name, &mut slot)?;
        if let Some(object) = slot.base()
            && cases.should_cache()
        {
            let case = AccessCase::new(AccessKind::HasOwn, object.shape_id()).with_answer(true);
            self.apply(cx, owner, &Ok(case), brand);
        }
        Ok(())
    }
}
