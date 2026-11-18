//! Each type of view has a class, and another for views on buffers whose length can change.

use super::view::ResizableView;
use crate::{
    CellKind, CellType, CellTypeRange, ClampedU8, Class, ElementType, Float16, IndexingMode,
    JsDataView, JsTypedArray, ShapeSpec, TypedArray, ascii_literal,
};

macro_rules! classes {
    ($($cell_type:ident, $element:ty, $name:literal;)*) => {
        #[allow(non_upper_case_globals)]
        mod fixed {
            use super::*;
            $(
                #[unsafe(export_name = concat!("engine_class_", $name))]
                pub(super) static $cell_type: Class = Class::new::<TypedArray<$element>>(
                    ascii_literal!($name),
                    None,
                    CellTypeRange::new(CellType::$cell_type, CellType::$cell_type),
                );
            )*
        }

        #[allow(non_upper_case_globals)]
        mod resizable {
            use super::*;
            $(
                pub(super) static $cell_type: Class =
                    Class::extending::<TypedArray<$element>>(ascii_literal!($name), size_of::<ResizableView>());
            )*
            pub(super) static DataView: Class =
                Class::extending::<JsDataView>(ascii_literal!("DataView"), size_of::<ResizableView>());
        }

        const FIXED: [&Class; 13] = [$(&fixed::$cell_type,)* JsDataView::CLASS];
        static CLASSES: [[&Class; 13]; 2] = [FIXED, [$(&resizable::$cell_type,)* &resizable::DataView]];
    };
}

classes! {
    Int8Array, i8, "Int8Array";
    Uint8Array, u8, "Uint8Array";
    Uint8ClampedArray, ClampedU8, "Uint8ClampedArray";
    Int16Array, i16, "Int16Array";
    Uint16Array, u16, "Uint16Array";
    Int32Array, i32, "Int32Array";
    Uint32Array, u32, "Uint32Array";
    Float16Array, Float16, "Float16Array";
    Float32Array, f32, "Float32Array";
    Float64Array, f64, "Float64Array";
    BigInt64Array, i64, "BigInt64Array";
    BigUint64Array, u64, "BigUint64Array";
}

pub(super) const fn class_of_typed_array(element_type: ElementType) -> &'static Class {
    FIXED[element_type as usize]
}

/// Panics unless the type is one of `BUFFER_VIEWS`.
#[inline(always)]
pub fn class_of_view(cell_type: CellType, is_resizable: bool) -> &'static Class {
    CLASSES[usize::from(is_resizable)][usize::from(cell_type.0.wrapping_sub(CellType::Int8Array.0))]
}

/// Panics unless the type is one of `BUFFER_VIEWS`.
pub fn shape_spec_of_view(cell_type: CellType, is_resizable: bool) -> ShapeSpec {
    let flags = if cell_type == CellType::DataView {
        JsDataView::FLAGS
    } else {
        JsTypedArray::FLAGS
    };
    let class = class_of_view(cell_type, is_resizable);
    // SAFETY: only this module makes cells with such a shape, and it looks at the class.
    unsafe { ShapeSpec::from_parts(class, cell_type, flags, IndexingMode::NON_ARRAY, 0) }
}
