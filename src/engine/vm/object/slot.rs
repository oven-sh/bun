use bun_engine_macros::{FieldOffsets, native_abi};
use bun_engine_text::{Identifier, PropertyName};

use crate::{
    Attributes, Class, Cx, Gc, GetterSetter, JsObject, JsResult, ModuleEnvironment, PropertyOffset,
    TypeFlags, Value, errors,
};

/// `this` is the receiver for `CUSTOM_ACCESSOR`, and the object that has the property for `CUSTOM_VALUE`.
#[native_abi]
pub type CustomGetter = fn(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value>;
#[native_abi]
pub type CustomSetter = fn(cx: &mut Cx, this: Value, value: Value, name: PropertyName<'_>) -> bool;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum InternalMethod {
    Get,
    HasProperty,
    GetOwnProperty,
    /// The engine is looking around: nothing that a script could observe may happen.
    Inquiry,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum SlotKind {
    Unset,
    Value,
    Getter,
    Custom,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum AdditionalData {
    None,
    RequiredClass,
    ModuleBinding,
}

/// The result of looking a property up.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct PropertySlot {
    /// The value, or the `GetterSetter`.
    value: Option<Value>,
    custom_getter: Option<CustomGetter>,
    custom_setter: Option<CustomSetter>,
    attributes: Attributes,
    offset: PropertyOffset,
    this_value: Option<Value>,
    base: Option<Gc<JsObject>>,
    is_cacheable: bool,
    kind: SlotKind,
    method: InternalMethod,
    additional_data: AdditionalData,
    is_tainted_by_opaque_object: bool,
    scope_offset: u32,
    required_class: Option<&'static Class>,
    environment: Option<Gc<ModuleEnvironment>>,
}

impl PropertySlot {
    #[inline(always)]
    pub fn new(this_value: Value, method: InternalMethod) -> PropertySlot {
        PropertySlot {
            value: None,
            custom_getter: None,
            custom_setter: None,
            attributes: Attributes::NONE,
            offset: PropertyOffset::INVALID,
            this_value: Some(this_value),
            base: None,
            is_cacheable: false,
            kind: SlotKind::Unset,
            method,
            additional_data: AdditionalData::None,
            is_tainted_by_opaque_object: false,
            scope_offset: 0,
            required_class: None,
            environment: None,
        }
    }

    #[inline(always)]
    pub fn value(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        if self.kind == SlotKind::Value {
            return Ok(self.value.unwrap_or_default());
        }
        self.value_slow(cx, name)
    }

    #[inline(always)]
    pub fn value_at_index(&self, cx: &mut Cx, index: u32) -> JsResult<Value> {
        if self.kind == SlotKind::Value {
            return Ok(self.value.unwrap_or_default());
        }
        self.value_slow(cx, Identifier::from_index(index).name())
    }

    #[inline(never)]
    fn value_slow(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        if let Some(accessor) = self.getter_setter() {
            return accessor.call_getter(cx, self.this_value());
        }
        let (Some(getter), Some(base)) = (self.custom_getter, self.base) else {
            return Ok(Value::UNDEFINED);
        };
        let this = if self.attributes.contains(Attributes::CUSTOM_ACCESSOR) {
            self.this_value()
        } else {
            base.into()
        };
        let cx = cx.in_realm_of(&base);
        if let Some(class) = self.required_class()
            && !this.as_cell().is_some_and(|cell| cell.inherits(class))
        {
            return Err(errors::throw_getter_type_error(cx, class, name));
        }
        let result = getter(cx, this, name);
        cx.check_exception()?;
        Ok(result.unwrap_or_default())
    }

    /// The value, if getting it runs no code.
    #[inline(always)]
    pub fn plain_value(&self) -> Option<Value> {
        self.value.filter(|_| self.kind == SlotKind::Value)
    }

    #[inline(always)]
    pub fn is_unset(&self) -> bool {
        self.kind == SlotKind::Unset
    }

    #[inline(always)]
    pub fn is_value(&self) -> bool {
        self.kind == SlotKind::Value
    }

    #[inline(always)]
    pub fn is_accessor(&self) -> bool {
        self.kind == SlotKind::Getter
    }

    #[inline(always)]
    pub fn is_custom(&self) -> bool {
        self.kind == SlotKind::Custom
    }

    #[inline(always)]
    pub fn is_cacheable(&self) -> bool {
        (self.is_unset() || self.is_cacheable) && !self.is_tainted_by_opaque_object
    }

    #[inline(always)]
    pub fn disable_caching(&mut self) {
        self.is_cacheable = false;
    }

    #[inline(always)]
    pub fn method(&self) -> InternalMethod {
        self.method
    }

    #[inline(always)]
    pub fn is_inquiry(&self) -> bool {
        self.method == InternalMethod::Inquiry
    }

    pub fn taint_by_opaque_object(&mut self) {
        self.is_tainted_by_opaque_object = true;
    }

    #[inline(always)]
    pub fn is_tainted_by_opaque_object(&self) -> bool {
        self.is_tainted_by_opaque_object
    }

    #[inline(always)]
    pub fn attributes(&self) -> Attributes {
        self.attributes
    }

    /// For `for`-`in`.
    pub(crate) fn is_enumerable(&self) -> bool {
        let unreliable = TypeFlags::GET_OWN_PROPERTY_SLOT_MAY_BE_WRONG_ABOUT_DONT_ENUM;
        !self.is_unset()
            && (self.attributes.is_enumerable()
                || (self.base).is_some_and(|base| base.shape().type_flags().contains(unreliable)))
    }

    #[inline(always)]
    pub fn cached_offset(&self) -> PropertyOffset {
        self.offset
    }

    #[inline(always)]
    pub fn this_value(&self) -> Value {
        self.this_value.unwrap_or_default()
    }

    pub fn set_this_value(&mut self, this_value: Value) {
        self.this_value = Some(this_value);
    }

    /// The object that has the property.
    #[inline(always)]
    pub fn base(&self) -> Option<Gc<JsObject>> {
        self.base
    }

    pub fn getter_setter(&self) -> Option<Gc<GetterSetter>> {
        self.value.filter(|_| self.is_accessor())?.downcast()
    }

    pub fn custom_getter(&self) -> Option<CustomGetter> {
        self.custom_getter.filter(|_| self.is_custom())
    }

    pub fn custom_setter(&self) -> Option<CustomSetter> {
        self.custom_setter.filter(|_| self.is_custom())
    }

    /// What `this` has to inherit from for the custom getter to be called.
    pub fn required_class(&self) -> Option<&'static Class> {
        self.required_class
            .filter(|_| self.additional_data == AdditionalData::RequiredClass)
    }

    pub fn module_binding(&self) -> Option<(Gc<ModuleEnvironment>, u32)> {
        let environment = self
            .environment
            .filter(|_| self.additional_data == AdditionalData::ModuleBinding)?;
        Some((environment, self.scope_offset))
    }

    #[inline(always)]
    pub fn set_value(&mut self, base: &JsObject, attributes: Attributes, value: Value) {
        self.base = Some(base.into());
        self.set_value_without_base(attributes, value);
    }

    #[inline(always)]
    pub(crate) fn set_value_without_base(&mut self, attributes: Attributes, value: Value) {
        self.value = Some(value);
        self.attributes = attributes;
        self.kind = SlotKind::Value;
    }

    pub fn set_getter(&mut self, base: &JsObject, attributes: Attributes, accessor: &GetterSetter) {
        self.value = Some(accessor.into());
        self.attributes = attributes;
        self.base = Some(base.into());
        self.kind = SlotKind::Getter;
    }

    pub fn set_custom(
        &mut self,
        base: &JsObject,
        attributes: Attributes,
        getter: Option<CustomGetter>,
        setter: Option<CustomSetter>,
    ) {
        self.custom_getter = getter;
        self.custom_setter = setter;
        self.attributes = attributes;
        self.base = Some(base.into());
        self.kind = SlotKind::Custom;
    }

    /// Every object with the shape of the base has the property.
    pub fn set_cacheable_custom(
        &mut self,
        base: &JsObject,
        attributes: Attributes,
        getter: CustomGetter,
    ) {
        self.set_custom(base, attributes, Some(getter), None);
        self.allow_caching(PropertyOffset::INVALID);
    }

    pub(crate) fn set_required_class(&mut self, class: Option<&'static Class>) {
        if class.is_some() {
            self.additional_data = AdditionalData::RequiredClass;
            self.required_class = class;
        }
    }

    pub(crate) fn set_module_binding(&mut self, environment: Gc<ModuleEnvironment>, offset: u32) {
        self.additional_data = AdditionalData::ModuleBinding;
        self.environment = Some(environment);
        self.scope_offset = offset;
    }

    /// Every object with the shape of the base has the property there.
    #[inline(always)]
    pub(crate) fn allow_caching(&mut self, offset: PropertyOffset) {
        self.offset = offset;
        self.is_cacheable = true;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PutKind {
    Uncacheable,
    ExistingProperty,
    NewProperty,
    Setter,
    CustomValue,
    CustomAccessor,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PutContext {
    Unknown,
    PutById,
    PutByIdInEval,
    ReflectSet,
}

/// The receiver and the mode of a store, and what it came to.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct PutPropertySlot {
    base: Option<Gc<JsObject>>,
    this_value: Value,
    offset: PropertyOffset,
    is_strict: bool,
    is_initialization: bool,
    is_tainted_by_opaque_object: bool,
    kind: PutKind,
    context: PutContext,
    is_cacheable: bool,
    custom_setter: Option<CustomSetter>,
}

impl PutPropertySlot {
    #[inline(always)]
    pub fn new(this_value: Value, is_strict: bool) -> PutPropertySlot {
        Self::with_context(this_value, is_strict, PutContext::Unknown)
    }

    #[inline(always)]
    pub fn with_context(this_value: Value, is_strict: bool, context: PutContext) -> Self {
        PutPropertySlot {
            base: None,
            this_value,
            offset: PropertyOffset::INVALID,
            is_strict,
            is_initialization: false,
            is_tainted_by_opaque_object: false,
            kind: PutKind::Uncacheable,
            context,
            is_cacheable: true,
            custom_setter: None,
        }
    }

    #[inline(always)]
    pub(crate) fn set(&mut self, kind: PutKind, base: &JsObject, offset: PropertyOffset) {
        self.kind = kind;
        self.base = Some(base.into());
        self.offset = offset;
    }

    pub(crate) fn set_custom(
        &mut self,
        kind: PutKind,
        base: &JsObject,
        offset: PropertyOffset,
        setter: CustomSetter,
    ) {
        self.set(kind, base, offset);
        self.custom_setter = Some(setter);
    }

    /// `Uncacheable` if caching has been disabled.
    #[inline(always)]
    pub fn cacheable_kind(&self) -> PutKind {
        if self.is_cacheable {
            self.kind
        } else {
            PutKind::Uncacheable
        }
    }

    pub fn kind(&self) -> PutKind {
        self.kind
    }

    pub fn base(&self) -> Option<Gc<JsObject>> {
        self.base
    }

    pub fn cached_offset(&self) -> PropertyOffset {
        self.offset
    }

    pub fn custom_setter(&self) -> Option<CustomSetter> {
        self.custom_setter
    }

    #[inline(always)]
    pub fn this_value(&self) -> Value {
        self.this_value
    }

    pub fn set_this_value(&mut self, this_value: Value) {
        self.this_value = this_value;
    }

    #[inline(always)]
    pub fn is_receiver(&self, object: &JsObject) -> bool {
        self.this_value == object.as_value() || self.is_proxy_of_global(object)
    }

    #[cold]
    fn is_proxy_of_global(&self, object: &JsObject) -> bool {
        self.this_value
            .downcast::<crate::GlobalProxy>()
            .is_some_and(|proxy| proxy.target().is_same(object))
    }

    #[inline(always)]
    pub fn is_strict(&self) -> bool {
        self.is_strict
    }

    pub fn set_strict(&mut self, is_strict: bool) {
        self.is_strict = is_strict;
    }

    pub fn is_initialization(&self) -> bool {
        self.is_initialization
    }

    #[inline(always)]
    pub fn context(&self) -> PutContext {
        // SAFETY: a field. A load that takes in its neighbours waits for the stores to all of them.
        unsafe { (&raw const self.context).read_volatile() }
    }

    pub fn disable_caching(&mut self) {
        self.is_cacheable = false;
    }

    pub fn taint_by_opaque_object(&mut self) {
        self.is_tainted_by_opaque_object = true;
    }

    pub fn is_tainted_by_opaque_object(&self) -> bool {
        self.is_tainted_by_opaque_object
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DeleteKind {
    Uncacheable,
    Hit,
    Miss,
    NonConfigurable,
}

#[derive(FieldOffsets)]
#[repr(C)]
pub struct DeletePropertySlot {
    offset: PropertyOffset,
    is_cacheable: bool,
    kind: DeleteKind,
}

impl Default for DeletePropertySlot {
    fn default() -> DeletePropertySlot {
        DeletePropertySlot {
            offset: PropertyOffset::INVALID,
            is_cacheable: true,
            kind: DeleteKind::Uncacheable,
        }
    }
}

impl DeletePropertySlot {
    pub(crate) fn set(&mut self, kind: DeleteKind, offset: PropertyOffset) {
        self.kind = kind;
        self.offset = offset;
    }

    pub fn cacheable_kind(&self) -> DeleteKind {
        if self.is_cacheable {
            self.kind
        } else {
            DeleteKind::Uncacheable
        }
    }

    pub fn cached_offset(&self) -> PropertyOffset {
        self.offset
    }

    pub fn disable_caching(&mut self) {
        self.is_cacheable = false;
    }
}
