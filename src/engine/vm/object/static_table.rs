//! The properties that the instances of a class start with. They become ordinary properties when they are first used.

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_engine_macros::FieldOffsets;
use bun_engine_text::{Identifier, PropertyName, Text, names};

use crate::{
    AsciiLiteral, Attributes, BuiltinId, Class, CustomGetter, CustomSetter, FunctionExecutable, Gc,
    Intrinsic, JsObject, NativeFunction, RealmSlot, Value, Vm,
};

pub type BuiltinGenerator = unsafe extern "C" fn(&Vm) -> Gc<FunctionExecutable>;
#[cfg(not(windows))]
pub type PropertyCallback = unsafe extern "C" fn(&Vm, &JsObject) -> Option<Value>;
/// C++ returns a class that has a constructor through memory.
#[cfg(windows)]
pub type PropertyCallback =
    for<'a> unsafe extern "C" fn(&'a mut Option<Value>, &Vm, &JsObject) -> &'a Option<Value>;
/// For a value that takes no script to make.
pub type PropertyMaker = fn(&crate::Cx, &JsObject) -> Value;

/// Kinds of entries that only tables in Rust have.
const ENGINE_BUILTIN: u32 = 1 << 24;
const REALM_SLOT: u32 = 1 << 25;
const CONSTANT_DOUBLE: u32 = 1 << 26;
const CONSTANT_NAME: u32 = 1 << 27;
const MADE_VALUE: u32 = 1 << 28;
const POSITION: u32 = 1 << 29;
const PROTO_ACCESSOR: u32 = 1 << 30;

/// In place of a size: the key is a static atom or symbol, not characters.
const KEY_IS_NAME: usize = usize::MAX;

#[derive(Clone, Copy, FieldOffsets)]
#[repr(C)]
pub struct StaticProperty {
    key: *const c_void,
    /// Counts a zero byte at the end. Zero: not an entry.
    key_size: usize,
    attributes: Attributes,
    intrinsic: Intrinsic,
    first: *const c_void,
    second: *const c_void,
}

pub(crate) enum StaticValue {
    Function {
        function: NativeFunction,
        length: u32,
        intrinsic: Intrinsic,
        is_constructor: bool,
    },
    Accessor {
        getter: Option<NativeFunction>,
        setter: Option<NativeFunction>,
        intrinsic: Intrinsic,
    },
    Builtin(BuiltinGenerator),
    BuiltinGetter(BuiltinGenerator),
    EngineBuiltin(BuiltinId),
    Constant(Value),
    /// A string or a symbol.
    Name(PropertyName<'static>),
    /// The offset of a `LazyField` in the object.
    LazyCell(usize),
    /// The offset of a `LazyClass` in the object.
    LazyClass(usize),
    RealmSlot(RealmSlot),
    Callback(PropertyCallback),
    Made(PropertyMaker),
    Custom {
        getter: Option<CustomGetter>,
        setter: Option<CustomSetter>,
    },
}

const fn word(value: usize) -> *const c_void {
    core::ptr::without_provenance(value)
}

impl StaticProperty {
    const fn new(
        name: PropertyName<'static>,
        attributes: Attributes,
        kind: u32,
        first: *const c_void,
        second: *const c_void,
    ) -> StaticProperty {
        StaticProperty {
            key: name.as_ptr().as_ptr().cast_const().cast(),
            key_size: KEY_IS_NAME,
            attributes: Attributes::from_bits_retain(attributes.bits() | kind),
            intrinsic: Intrinsic::None,
            first,
            second,
        }
    }

    pub const fn function(
        name: PropertyName<'static>,
        function: NativeFunction,
        length: u32,
    ) -> StaticProperty {
        let attributes = Attributes::DONT_ENUM.union(Attributes::FUNCTION);
        let function = function as *const c_void;
        Self::new(name, attributes, 0, function, word(length as usize))
    }

    /// A function that is written in JavaScript.
    pub const fn builtin(name: PropertyName<'static>, id: BuiltinId) -> StaticProperty {
        let attributes = Attributes::DONT_ENUM.union(Attributes::BUILTIN);
        Self::new(
            name,
            attributes,
            ENGINE_BUILTIN,
            word(id.0 as usize),
            word(0),
        )
    }

    pub const fn getter(name: PropertyName<'static>, getter: NativeFunction) -> StaticProperty {
        let attributes = Attributes::DONT_ENUM.union(Attributes::ACCESSOR);
        Self::new(name, attributes, 0, getter as *const c_void, word(0))
    }

    pub const fn accessor(
        name: PropertyName<'static>,
        getter: NativeFunction,
        setter: NativeFunction,
    ) -> StaticProperty {
        let attributes = Attributes::DONT_ENUM.union(Attributes::ACCESSOR);
        let (getter, setter) = (getter as *const c_void, setter as *const c_void);
        Self::new(name, attributes, 0, getter, setter)
    }

    /// `kind` is `CUSTOM_ACCESSOR` or `CUSTOM_VALUE`, with whatever else applies.
    pub const fn custom(
        name: PropertyName<'static>,
        kind: Attributes,
        getter: CustomGetter,
        setter: Option<CustomSetter>,
    ) -> StaticProperty {
        assert!(kind.intersects(Attributes::CUSTOM));
        let setter = match setter {
            Some(setter) => setter as *const c_void,
            None => word(0),
        };
        Self::new(name, kind, 0, getter as *const c_void, setter)
    }

    pub const fn number(name: PropertyName<'static>, value: f64) -> StaticProperty {
        let attributes = Attributes::CONSTANT.union(Attributes::CONSTANT_INTEGER);
        let bits = word(value.to_bits() as usize);
        Self::new(name, attributes, CONSTANT_DOUBLE, bits, word(0))
    }

    /// Read-only, as `Symbol.toStringTag` is.
    pub const fn string(name: PropertyName<'static>, value: PropertyName<'static>) -> Self {
        let attributes = Attributes::DONT_ENUM
            .union(Attributes::READ_ONLY)
            .union(Attributes::PROPERTY_CALLBACK);
        let value = value.as_ptr().as_ptr().cast_const().cast();
        Self::new(name, attributes, CONSTANT_NAME, value, word(0))
    }

    pub const fn symbol(name: PropertyName<'static>, value: PropertyName<'static>) -> Self {
        Self::string(name, value).with(Attributes::DONT_DELETE)
    }

    /// Where a property enumerates that is defined when the object is made, such as the `length` of a constructor.
    pub const fn position_of(name: PropertyName<'static>) -> StaticProperty {
        Self::new(name, Attributes::DONT_ENUM, POSITION, word(0), word(0))
    }

    /// `Object.prototype.__proto__`, which stores to other names need not know of.
    pub const fn proto_accessor(getter: NativeFunction, setter: NativeFunction) -> StaticProperty {
        let mut property = Self::accessor(names::__proto__, getter, setter);
        property.attributes =
            Attributes::from_bits_retain(property.attributes.bits() | PROTO_ACCESSOR);
        property
    }

    pub const fn realm_slot(name: PropertyName<'static>, slot: RealmSlot) -> StaticProperty {
        let attributes = Attributes::DONT_ENUM.union(Attributes::PROPERTY_CALLBACK);
        Self::new(name, attributes, REALM_SLOT, word(slot as usize), word(0))
    }

    pub const fn made(name: PropertyName<'static>, make: PropertyMaker) -> StaticProperty {
        let attributes = Attributes::DONT_ENUM.union(Attributes::PROPERTY_CALLBACK);
        Self::new(name, attributes, MADE_VALUE, make as *const c_void, word(0))
    }

    /// For a name that is not among the static ones.
    pub const fn renamed(mut self, name: AsciiLiteral) -> StaticProperty {
        self.key = name.as_str().as_ptr().cast();
        self.key_size = name.as_str().len() + 1;
        self
    }

    pub const fn with_intrinsic(mut self, intrinsic: Intrinsic) -> StaticProperty {
        self.intrinsic = intrinsic;
        self
    }

    pub const fn with(mut self, attributes: Attributes) -> StaticProperty {
        self.attributes = self.attributes.union(attributes);
        self
    }

    pub const fn without(mut self, attributes: Attributes) -> StaticProperty {
        self.attributes = self.attributes.difference(attributes);
        self
    }

    /// An entry that says nothing else is a custom value.
    pub fn attributes(&self) -> Attributes {
        let explicit = Attributes::LAZY_VALUE
            | Attributes::ACCESSOR
            | Attributes::CUSTOM_ACCESSOR
            | Attributes::CONSTANT_INTEGER;
        if self.attributes.intersects(explicit) {
            self.attributes
        } else {
            self.attributes | Attributes::CUSTOM_VALUE
        }
    }

    pub(super) fn is_position(&self) -> bool {
        self.attributes.bits() & POSITION != 0
    }

    fn static_name(pointer: *const c_void) -> PropertyName<'static> {
        // SAFETY: from a `PropertyName<'static>` in a constructor.
        unsafe { PropertyName::from_raw(NonNull::new_unchecked(pointer.cast_mut().cast())) }
    }

    const fn characters(&self) -> &'static [u8] {
        // SAFETY: a literal of that size.
        unsafe { core::slice::from_raw_parts(self.key.cast(), self.key_size - 1) }
    }

    #[inline(always)]
    fn has_name(&self, name: PropertyName<'_>) -> bool {
        match self.key_size {
            KEY_IS_NAME => self.key.addr() == name.address(),
            0 => false,
            _ => !name.is_symbol() && name.text() == Text::Latin1(self.characters()),
        }
    }

    pub fn is_entry(&self) -> bool {
        self.key_size != 0
    }

    pub fn name(&self) -> Identifier {
        if self.key_size == KEY_IS_NAME {
            Self::static_name(self.key).to_identifier()
        } else {
            bun_engine_text::Atom::from_static_latin1(self.characters()).into()
        }
    }

    pub(crate) fn value(&self) -> StaticValue {
        use core::mem::transmute;
        let (attributes, first, second) = (self.attributes, self.first, self.second);
        let has = |kind: u32| attributes.bits() & kind != 0;
        // SAFETY: the attributes say what the two words are.
        unsafe {
            if has(ENGINE_BUILTIN) {
                StaticValue::EngineBuiltin(BuiltinId(first.addr() as u16))
            } else if has(REALM_SLOT) {
                StaticValue::RealmSlot(RealmSlot::from_index(first.addr()))
            } else if has(CONSTANT_DOUBLE) {
                StaticValue::Constant(Value::number(f64::from_bits(first.addr() as u64)))
            } else if has(CONSTANT_NAME) {
                StaticValue::Name(Self::static_name(first))
            } else if has(MADE_VALUE) {
                StaticValue::Made(transmute::<*const c_void, PropertyMaker>(first))
            } else if attributes.contains(Attributes::BUILTIN) {
                let generator = transmute::<*const c_void, BuiltinGenerator>(first);
                if attributes.contains(Attributes::ACCESSOR) {
                    StaticValue::BuiltinGetter(generator)
                } else {
                    StaticValue::Builtin(generator)
                }
            } else if attributes.contains(Attributes::FUNCTION) {
                StaticValue::Function {
                    function: transmute::<*const c_void, NativeFunction>(first),
                    length: second.addr() as u32,
                    intrinsic: self.intrinsic,
                    is_constructor: attributes.contains(Attributes::CONSTRUCTABLE),
                }
            } else if attributes.contains(Attributes::CONSTANT_INTEGER) {
                StaticValue::Constant((first.addr() as i64).into())
            } else if attributes.contains(Attributes::ACCESSOR) {
                StaticValue::Accessor {
                    getter: transmute::<*const c_void, Option<NativeFunction>>(first),
                    setter: transmute::<*const c_void, Option<NativeFunction>>(second),
                    intrinsic: self.intrinsic,
                }
            } else if attributes.contains(Attributes::CELL_PROPERTY) {
                StaticValue::LazyCell(first.addr())
            } else if attributes.contains(Attributes::CLASS_STRUCTURE) {
                StaticValue::LazyClass(first.addr())
            } else if attributes.contains(Attributes::PROPERTY_CALLBACK) {
                StaticValue::Callback(transmute::<*const c_void, PropertyCallback>(first))
            } else {
                StaticValue::Custom {
                    getter: transmute::<*const c_void, Option<CustomGetter>>(first),
                    setter: transmute::<*const c_void, Option<CustomSetter>>(second),
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
#[repr(C)]
pub struct StaticIndex {
    value: i16,
    next: i16,
}

#[derive(FieldOffsets)]
#[repr(C)]
pub struct StaticTable {
    count: i32,
    index_mask: i32,
    /// Only of a table that is made in Rust.
    seen_attributes: u8,
    class_for_this: Option<&'static Class>,
    values: *const StaticProperty,
    index: *const StaticIndex,
}

// SAFETY: immutable.
unsafe impl Sync for StaticTable {}
// SAFETY: as above.
unsafe impl Sync for StaticProperty {}

/// `static_table!(static NAME = [StaticProperty::function(..), ..]);`
#[macro_export]
macro_rules! static_table {
    ($visibility:vis static $name:ident = [$($property:expr),* $(,)?]) => {
        $visibility static $name: $crate::StaticTable = {
            const COUNT: usize = <[&str]>::len(&[$(stringify!($property)),*]);
            static VALUES: [$crate::StaticProperty; COUNT] = [$($property),*];
            static INDEX: [$crate::StaticIndex; $crate::StaticTable::index_length(COUNT)] =
                $crate::StaticTable::build_index(&VALUES);
            $crate::StaticTable::new(&VALUES, &INDEX)
        };
    };
}

impl StaticTable {
    const fn bucket_count(count: usize) -> usize {
        (count * 2).next_power_of_two()
    }

    pub const fn index_length(count: usize) -> usize {
        Self::bucket_count(count) + count
    }

    pub const fn build_index<const N: usize>(values: &[StaticProperty]) -> [StaticIndex; N] {
        let mut index = [StaticIndex {
            value: -1,
            next: -1,
        }; N];
        let mut overflow = Self::bucket_count(values.len());
        let mask = overflow - 1;
        let mut position = 0;
        while position < values.len() {
            let hash = match values[position].key_size {
                // SAFETY: what the size says.
                KEY_IS_NAME => unsafe { PropertyName::hash_of_static(values[position].key) },
                _ => bun_engine_text::hash_latin1(values[position].characters()),
            };
            let mut slot = hash as usize & mask;
            if index[slot].value != -1 {
                while index[slot].next != -1 {
                    slot = index[slot].next as usize;
                }
                index[slot].next = overflow as i16;
                slot = overflow;
                overflow += 1;
            }
            index[slot].value = position as i16;
            position += 1;
        }
        index
    }

    /// Panics unless `index` has the length that `build_index` gives it.
    pub const fn new<const N: usize>(
        values: &'static [StaticProperty],
        index: &'static [StaticIndex; N],
    ) -> StaticTable {
        assert!(N == Self::index_length(values.len()));
        let (mut seen_attributes, mut position) = (0, 0);
        while position < values.len() {
            let attributes = values[position].attributes.bits();
            if attributes & PROTO_ACCESSOR == 0 {
                seen_attributes |= attributes as u8;
            }
            position += 1;
        }
        StaticTable {
            count: values.len() as i32,
            index_mask: Self::bucket_count(values.len()) as i32 - 1,
            seen_attributes,
            class_for_this: None,
            values: values.as_ptr(),
            index: index.as_ptr(),
        }
    }

    pub fn seen_attributes(&self) -> Attributes {
        if (self.values().first()).is_some_and(|first| first.key_size != KEY_IS_NAME) {
            let seen = self.iter().map(|entry| entry.attributes().for_shape());
            return seen.fold(Attributes::NONE, Attributes::union);
        }
        Attributes::from_bits_retain(u32::from(self.seen_attributes))
    }

    pub fn class_for_this(&self) -> Option<&'static Class> {
        self.class_for_this
    }

    fn values(&self) -> &'static [StaticProperty] {
        // SAFETY: a static array of that length.
        unsafe { core::slice::from_raw_parts(self.values, self.count as usize) }
    }

    pub(super) fn entries_and_positions(
        &self,
    ) -> impl Iterator<Item = &'static StaticProperty> + use<> {
        self.values().iter().filter(|entry| entry.key_size != 0)
    }

    pub fn iter(&self) -> impl Iterator<Item = &'static StaticProperty> + use<> {
        self.entries_and_positions().filter(|it| !it.is_position())
    }

    #[inline]
    pub fn find(&self, name: PropertyName<'_>) -> Option<&'static StaticProperty> {
        self.find_entry_or_position(name)
            .filter(|it| !it.is_position())
    }

    #[inline]
    pub(super) fn find_entry_or_position(
        &self,
        name: PropertyName<'_>,
    ) -> Option<&'static StaticProperty> {
        let mut slot = (name.hash() & self.index_mask as u32) as usize;
        loop {
            // SAFETY: a bucket, or a link that the generator of the index wrote.
            let entry = unsafe { *self.index.add(slot) };
            let value = self.values().get(entry.value as usize)?;
            if value.has_name(name) {
                return Some(value);
            }
            slot = usize::try_from(entry.next).ok()?;
        }
    }
}
