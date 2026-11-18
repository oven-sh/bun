use core::ffi::c_void;

use bun_engine_macros::FieldOffsets;
use bun_engine_text::{PropertyName, Text};

use crate::heap::{HeapAnalyzer, Survivors};
use crate::{
    CallData, CellKind, CellTypeRange, Cx, DeletePropertySlot, DontEnumMode, JsArray, JsCell,
    JsObject, JsResult, PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot,
    StaticTable, Value, Visitor, Vm,
};

/// ASCII text in static memory that is followed by a zero byte.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct AsciiLiteral {
    characters: *const u8,
    /// Counts the zero byte.
    size: usize,
}

// SAFETY: a `&'static [u8]`.
unsafe impl Send for AsciiLiteral {}
// SAFETY: as above.
unsafe impl Sync for AsciiLiteral {}

impl AsciiLiteral {
    pub const NULL: AsciiLiteral = AsciiLiteral {
        characters: core::ptr::null(),
        size: 0,
    };

    pub const fn new(terminated: &'static str) -> AsciiLiteral {
        assert!(terminated.is_ascii() && matches!(terminated.as_bytes().last(), Some(0)));
        AsciiLiteral {
            characters: terminated.as_ptr(),
            size: terminated.len(),
        }
    }

    /// # Safety
    /// ASCII in static memory. The size counts the zero byte that ends it.
    pub const unsafe fn from_raw_parts(characters: *const u8, size: usize) -> AsciiLiteral {
        AsciiLiteral { characters, size }
    }

    pub const fn is_null(self) -> bool {
        self.size == 0
    }

    #[inline]
    pub const fn as_str(self) -> &'static str {
        if self.is_null() {
            return "";
        }
        // SAFETY: static ASCII of that size.
        unsafe {
            core::str::from_utf8_unchecked(core::slice::from_raw_parts(
                self.characters,
                self.size - 1,
            ))
        }
    }

    #[inline]
    pub const fn text(self) -> Text<'static> {
        Text::Latin1(self.as_str().as_bytes())
    }
}

#[macro_export]
macro_rules! ascii_literal {
    ($text:literal) => {
        $crate::AsciiLiteral::new(concat!($text, "\0"))
    };
}

/// The methods of a class. An exception is left pending in the `Vm`.
///
/// An `#[object_ops]` block has the ones that a type overrides, each with `&self` for the first parameter and a
/// `JsResult` of what it returns here. `call_data` and `construct_data` return the `CallData`.
#[derive(Clone, Copy, FieldOffsets)]
#[repr(C)]
pub struct ClassOps {
    pub destroy: unsafe extern "C" fn(*mut JsCell),
    pub call_data: unsafe extern "C" fn(&JsObject, &mut CallData),
    pub construct_data: unsafe extern "C" fn(&JsObject, &mut CallData),
    pub put: unsafe extern "C" fn(
        &JsObject,
        &mut Cx,
        PropertyName<'_>,
        Value,
        &mut PutPropertySlot,
    ) -> bool,
    pub put_by_index:
        unsafe extern "C" fn(&JsObject, &mut Cx, u32, Value, should_throw: bool) -> bool,
    pub delete_property:
        unsafe extern "C" fn(&JsObject, &mut Cx, PropertyName<'_>, &mut DeletePropertySlot) -> bool,
    pub delete_property_by_index: unsafe extern "C" fn(&JsObject, &mut Cx, u32) -> bool,
    pub get_own_property_slot:
        unsafe extern "C" fn(&JsObject, &mut Cx, PropertyName<'_>, &mut PropertySlot) -> bool,
    pub get_own_property_slot_by_index:
        unsafe extern "C" fn(&JsObject, &mut Cx, u32, &mut PropertySlot) -> bool,
    pub own_property_names:
        unsafe extern "C" fn(&JsObject, &mut Cx, &mut PropertyNameList, DontEnumMode),
    pub own_special_property_names:
        unsafe extern "C" fn(&JsObject, &mut Cx, &mut PropertyNameList, DontEnumMode),
    pub custom_has_instance: unsafe extern "C" fn(&JsObject, &mut Cx, Value) -> bool,
    pub define_own_property: unsafe extern "C" fn(
        &JsObject,
        &mut Cx,
        PropertyName<'_>,
        &PropertyDescriptor,
        should_throw: bool,
    ) -> bool,
    pub prevent_extensions: unsafe extern "C" fn(&JsObject, &mut Cx) -> bool,
    pub is_extensible: unsafe extern "C" fn(&JsObject, &mut Cx) -> bool,
    pub set_prototype_of:
        unsafe extern "C" fn(&JsObject, &mut Cx, Value, should_throw: bool) -> bool,
    pub get_prototype_of: unsafe extern "C" fn(&JsObject, &mut Cx) -> JsResult<Value>,
    pub analyze_heap: unsafe extern "C" fn(&JsCell, &mut HeapAnalyzer),
    pub estimated_size: unsafe extern "C" fn(&JsCell, &Vm) -> usize,
    pub visit_children: unsafe extern "C" fn(&JsCell, &mut Visitor),
    pub visit_output_constraints: unsafe extern "C" fn(&JsCell, &mut Visitor),
    pub reconcile_weak_references: unsafe extern "C" fn(&JsCell, &Survivors),
}

macro_rules! not_an_object {
    ($($argument:ty),* => $result:ty) => {{
        unsafe extern "C" fn unreachable($(_: $argument),*) -> $result {
            unreachable!()
        }
        unreachable
    }};
}

macro_rules! nothing {
    ($($argument:ty),*) => {{
        unsafe extern "C" fn nothing($(_: $argument),*) {}
        nothing
    }};
}

unsafe extern "C" fn cell_size(cell: &JsCell, _: &Vm) -> usize {
    cell.cell_size()
}

impl ClassOps {
    pub(crate) const CELL: ClassOps = ClassOps {
        destroy: nothing!(*mut JsCell),
        call_data: nothing!(&JsObject, &mut CallData),
        construct_data: nothing!(&JsObject, &mut CallData),
        put: not_an_object!(&JsObject, &mut Cx, PropertyName<'_>, Value, &mut PutPropertySlot => bool),
        put_by_index: not_an_object!(&JsObject, &mut Cx, u32, Value, bool => bool),
        delete_property: not_an_object!(&JsObject, &mut Cx, PropertyName<'_>, &mut DeletePropertySlot => bool),
        delete_property_by_index: not_an_object!(&JsObject, &mut Cx, u32 => bool),
        get_own_property_slot: not_an_object!(&JsObject, &mut Cx, PropertyName<'_>, &mut PropertySlot => bool),
        get_own_property_slot_by_index: not_an_object!(&JsObject, &mut Cx, u32, &mut PropertySlot => bool),
        own_property_names: not_an_object!(&JsObject, &mut Cx, &mut PropertyNameList, DontEnumMode => ()),
        own_special_property_names: nothing!(
            &JsObject,
            &mut Cx,
            &mut PropertyNameList,
            DontEnumMode
        ),
        custom_has_instance: not_an_object!(&JsObject, &mut Cx, Value => bool),
        define_own_property: not_an_object!(&JsObject, &mut Cx, PropertyName<'_>, &PropertyDescriptor, bool => bool),
        prevent_extensions: not_an_object!(&JsObject, &mut Cx => bool),
        is_extensible: not_an_object!(&JsObject, &mut Cx => bool),
        set_prototype_of: not_an_object!(&JsObject, &mut Cx, Value, bool => bool),
        get_prototype_of: not_an_object!(&JsObject, &mut Cx => JsResult<Value>),
        analyze_heap: nothing!(&JsCell, &mut HeapAnalyzer),
        estimated_size: cell_size,
        visit_children: crate::heap::visit_children_of::<JsCell>,
        visit_output_constraints: nothing!(&JsCell, &mut Visitor),
        reconcile_weak_references: nothing!(&JsCell, &Survivors),
    };
}

/// What all cells of a native type have in common.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct Class {
    name: AsciiLiteral,
    parent: Option<&'static Class>,
    static_table: Option<&'static StaticTable>,
    reserved: *const c_void,
    types: CellTypeRange,
    is_of_embedder: bool,
    size: u32,
    ops: ClassOps,
}

// SAFETY: immutable.
unsafe impl Sync for Class {}

impl Class {
    #[inline(always)]
    pub(crate) fn is_of_embedder(&self) -> bool {
        self.is_of_embedder
    }

    pub const OFFSET_OF_PARENT: usize = core::mem::offset_of!(Class, parent);

    pub(crate) const fn root() -> Class {
        Class {
            name: ascii_literal!("Cell"),
            parent: None,
            static_table: None,
            reserved: core::ptr::null(),
            types: CellTypeRange::NONE,
            is_of_embedder: false,
            size: size_of::<JsCell>() as u32,
            ops: ClassOps::CELL,
        }
    }

    pub const fn new<T: CellKind<Base: CellKind>>(
        name: AsciiLiteral,
        static_table: Option<&'static StaticTable>,
        types: CellTypeRange,
    ) -> Class {
        Class {
            name,
            parent: Some(<T::Base as CellKind>::CLASS),
            static_table,
            reserved: core::ptr::null(),
            types,
            is_of_embedder: false,
            size: size_of::<T>() as u32,
            ops: T::OPS,
        }
    }

    /// Of cells of that size that start with a `T` and behave as one.
    pub(crate) const fn extending<T: CellKind>(name: AsciiLiteral, size: usize) -> Class {
        Class {
            name,
            parent: Some(T::CLASS),
            static_table: None,
            reserved: core::ptr::null(),
            types: CellTypeRange::NONE,
            is_of_embedder: false,
            size: size as u32,
            ops: T::OPS,
        }
    }

    pub fn name(&self) -> &'static str {
        self.name.as_str()
    }

    pub fn name_literal(&self) -> AsciiLiteral {
        self.name
    }

    #[inline(always)]
    pub fn parent(&self) -> Option<&'static Class> {
        self.parent
    }

    #[inline(always)]
    pub fn static_table(&self) -> Option<&'static StaticTable> {
        self.static_table
    }

    pub const fn types(&self) -> CellTypeRange {
        self.types
    }

    pub fn size(&self) -> usize {
        self.size as usize
    }

    #[inline(always)]
    pub fn ops(&self) -> &ClassOps {
        &self.ops
    }

    #[inline(always)]
    pub fn is(&self, other: &Class) -> bool {
        core::ptr::eq(self, other)
    }

    #[inline]
    pub fn is_subclass_of(&self, other: &Class) -> bool {
        let mut class = self;
        loop {
            if class.is(other) {
                return true;
            }
            match class.parent {
                Some(parent) => class = parent,
                None => return false,
            }
        }
    }

    pub fn has_ordinary_define_own_property(&self) -> bool {
        let ordinary = JsObject::CLASS.ops.define_own_property;
        core::ptr::fn_addr_eq(self.ops.define_own_property, ordinary)
    }

    pub(crate) fn has_lookup_of(&self, other: &Class) -> bool {
        core::ptr::fn_addr_eq(
            self.ops.get_own_property_slot,
            other.ops.get_own_property_slot,
        )
    }

    /// Whether the internal methods that get a name are the same.
    pub(super) fn treats_names_like(&self, other: &Class) -> bool {
        let (ops, others) = (&self.ops, &other.ops);
        self.has_lookup_of(other)
            && core::ptr::fn_addr_eq(ops.put, others.put)
            && core::ptr::fn_addr_eq(ops.delete_property, others.delete_property)
            && core::ptr::fn_addr_eq(ops.define_own_property, others.define_own_property)
    }

    pub(super) fn has_ordinary_lookup_by_index(&self) -> bool {
        let ordinary = JsObject::CLASS.ops.get_own_property_slot_by_index;
        core::ptr::fn_addr_eq(self.ops.get_own_property_slot_by_index, ordinary)
    }

    pub(super) fn has_ordinary_put_by_index(&self) -> bool {
        core::ptr::fn_addr_eq(self.ops.put_by_index, JsObject::CLASS.ops.put_by_index)
    }

    pub(super) fn has_ordinary_prevent_extensions(&self) -> bool {
        let ordinary = JsObject::CLASS.ops.prevent_extensions;
        core::ptr::fn_addr_eq(self.ops.prevent_extensions, ordinary)
    }

    pub(super) fn has_properties_of_arrays(&self) -> bool {
        let (ops, array) = (&self.ops, &JsArray::CLASS.ops);
        core::ptr::fn_addr_eq(ops.get_own_property_slot, array.get_own_property_slot)
            && core::ptr::fn_addr_eq(ops.define_own_property, array.define_own_property)
    }

    /// This class and those that it extends.
    pub fn ancestry(&'static self) -> impl Iterator<Item = &'static Class> {
        core::iter::successors(Some(self), |class| class.parent)
    }
}
