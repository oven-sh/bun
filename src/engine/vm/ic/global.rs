//! Names in the global scope.

use bun_engine_bytecode::Unresolved;
use bun_engine_text::PropertyName;

use super::slot_at;
use crate::code::metadata::GlobalAccess;
use crate::{
    Attributes, CellKind, CodeBlock, CustomGetter, CustomGetterSetter, Cx, GlobalObject,
    GlobalPlace, JsResult, ShapeId, Value,
};

impl GlobalAccess {
    fn remember(&self, cx: &Cx, owner: &CodeBlock, place: GlobalPlace<'_>) {
        let (shape, byte_offset, pointer) = match place {
            GlobalPlace::Lexical(binding) | GlobalPlace::Variable(binding) => (
                ShapeId::NONE,
                0,
                core::ptr::from_ref(binding).expose_provenance(),
            ),
            GlobalPlace::Property(shape, offset) => (
                shape.id(),
                offset.byte_offset() as i32,
                cx.global().address(),
            ),
            GlobalPlace::Unknown => (ShapeId::NONE, Self::NO_EPOCH, 0),
        };
        self.shape.set(shape);
        self.byte_offset.set(byte_offset);
        self.pointer.set(pointer);
        owner.write_barrier_for_cell();
    }

    /// For when the place that it remembers does not have the value.
    #[inline(always)]
    pub fn get_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        name: PropertyName<'_>,
        unresolved: Unresolved,
    ) -> JsResult<Value> {
        let may_be_static = self.byte_offset.get() as u32 ^ cx.prototype_chain_epoch() << 1;
        if self.pointer.get() == 0 {
            if self.shape.get().is_none() {
                if may_be_static <= 1 && !cx.services.caches.has_wrapped_epoch() {
                    return cx.get_global_property(name, unresolved, may_be_static != 0);
                }
            } else if let Some((getter, this)) = self.custom_getter(&cx.global()) {
                let result = getter(cx, this, name);
                return cx.check_exception().map(|()| result.unwrap_or_default());
            }
        }
        self.get_and_remember(cx, owner, name, unresolved)
    }

    /// And what it gets. There is a shape, and no pointer.
    #[inline(always)]
    fn custom_getter(&self, global: &GlobalObject) -> Option<(CustomGetter, Value)> {
        let this = match self.shape.get().bits() ^ global.shape_id().bits() {
            Self::CUSTOM_VALUE_TAG => global.as_value(),
            Self::CUSTOM_ACCESSOR_TAG => global.global_this().into(),
            _ => return None,
        };
        // SAFETY: the shape has the slot.
        let stored = unsafe { slot_at(global, self.byte_offset.get()) }.get()?;
        let custom = stored.downcast::<CustomGetterSetter>()?;
        Some((
            custom
                .getter()
                .filter(|_| custom.required_class().is_none())?,
            this,
        ))
    }

    /// False unless it is one that `custom_getter` finds.
    fn remember_custom_getter(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        name: PropertyName<'_>,
    ) -> JsResult<bool> {
        let global = cx.global();
        global.reify_custom_accessor(cx, name)?;
        let shape = global.shape();
        let Some((offset, attributes)) = shape.get(name) else {
            return Ok(false);
        };
        let tag = match attributes & Attributes::ANY_ACCESSOR {
            Attributes::CUSTOM_VALUE => Self::CUSTOM_VALUE_TAG,
            Attributes::CUSTOM_ACCESSOR => Self::CUSTOM_ACCESSOR_TAG,
            _ => return Ok(false),
        };
        self.shape.set(ShapeId::from_bits(shape.id().bits() ^ tag));
        self.byte_offset.set(offset.byte_offset() as i32);
        let is_found = self.custom_getter(&global).is_some();
        if is_found {
            owner.write_barrier_for_cell();
        } else {
            self.remember(cx, owner, GlobalPlace::Unknown);
        }
        Ok(is_found)
    }

    #[inline(never)]
    fn get_and_remember(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        name: PropertyName<'_>,
        unresolved: Unresolved,
    ) -> JsResult<Value> {
        let lexicals = owner.global_lexicals();
        let value = cx.get_global(name, unresolved, lexicals)?;
        let global = cx.global();
        global.make_dictionary_cacheable(cx);
        let place = global.place_for_load(name, lexicals);
        self.remember(cx, owner, place);
        if !matches!(place, GlobalPlace::Unknown)
            || !global.class().has_lookup_of(GlobalObject::CLASS)
            || !global.shape().property_accesses_are_cacheable()
            || self.remember_custom_getter(cx, owner, name)?
        {
            return Ok(value);
        }
        if global.variables().find(name).is_none() && !global.may_inherit_from_proxy() {
            let may_be_static = global.shape().find_static_property(name).is_some();
            let epoch = cx.prototype_chain_epoch() << 1 | u32::from(may_be_static);
            self.byte_offset.set(epoch as i32);
        }
        Ok(value)
    }

    pub fn put_slow(
        &self,
        cx: &mut Cx,
        owner: &CodeBlock,
        name: PropertyName<'_>,
        value: Value,
        is_strict: bool,
    ) -> JsResult<()> {
        let lexicals = owner.global_lexicals();
        cx.put_global(name, value, is_strict, lexicals)?;
        let global = cx.global();
        global.make_dictionary_cacheable(cx);
        let mut place = global.place_for_store(name, lexicals);
        if let GlobalPlace::Property(shape, offset) = place {
            // What is assigned once is as good as a constant.
            if self.has_run() {
                shape.did_cache_property_replacement(cx, offset);
            } else {
                place = GlobalPlace::Unknown;
            }
        }
        self.remember(cx, owner, place);
        Ok(())
    }
}
