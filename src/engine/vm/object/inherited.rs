use bun_engine_text::PropertyName;

use crate::{
    CellKind, Cx, DeletePropertySlot, DontEnumMode, Extends, Gc, JsObject, JsResult,
    PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot, Value,
};

macro_rules! inherited {
    ($(fn $name:ident = $op:ident($($argument:ident: $type:ty),*) -> $result:ty;)*) => {
        /// The internal methods of the type that a type extends, for its overrides to fall back on.
        pub trait Inherited: CellKind<Base: CellKind> + Extends<JsObject> {
            $(
                #[inline]
                fn $name(&self, cx: &mut Cx, $($argument: $type),*) -> JsResult<$result> {
                    let object = Gc::from(self).upcast::<JsObject>();
                    // SAFETY: a `Self` starts with its base.
                    let result = unsafe { (<Self::Base as CellKind>::OPS.$op)(&object, cx, $($argument),*) };
                    cx.check_exception()?;
                    Ok(result)
                }
            )*
        }
    };
}

inherited! {
    fn base_put = put(name: PropertyName<'_>, value: Value, slot: &mut PutPropertySlot) -> bool;
    fn base_delete_property = delete_property(name: PropertyName<'_>, slot: &mut DeletePropertySlot) -> bool;
    fn base_get_own_property_slot = get_own_property_slot(name: PropertyName<'_>, slot: &mut PropertySlot) -> bool;
    fn base_own_property_names = own_property_names(list: &mut PropertyNameList, mode: DontEnumMode) -> ();
    fn base_define_own_property = define_own_property(name: PropertyName<'_>, descriptor: &PropertyDescriptor, should_throw: bool) -> bool;
}

impl<T: CellKind<Base: CellKind> + Extends<JsObject>> Inherited for T {}
