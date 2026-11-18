//! The shapes of structs and arrays, one for each type.

use core::cell::UnsafeCell;
use core::mem::{MaybeUninit, offset_of};

use bun_alloc::AllocError;
use bun_engine_vm::{GcFree, Vm};
use bun_engine_wasm_compiler::abi::ObjectType;
use bun_engine_wasm_format::{CanonicalType, TypeKind};

use crate::object::{WasmArray, WasmStruct};
use crate::prelude::*;

/// Written once the shape has an id, which is the number of the type.
#[repr(transparent)]
struct NumberedType(UnsafeCell<MaybeUninit<ObjectType>>);

// SAFETY: it has the ids of shapes, which `supertype` keeps alive.
unsafe impl GcFree for NumberedType {}

struct Canonical(CanonicalType);

// SAFETY: it refers to no cell.
unsafe impl GcFree for Canonical {}

#[cell(name = "Structure")]
pub(crate) struct ObjectShape {
    base: Shape,
    numbered: NumberedType,
    canonical: Canonical,
    supertype: Option<Gc<ObjectShape>>,
}

impl ObjectShape {
    pub(crate) const OFFSET_OF_TYPE: usize = offset_of!(ObjectShape, numbered);

    /// `supertype` is the shape for the supertype of `ty`, which is that of a struct or an array.
    pub(crate) fn for_type(
        vm: &Vm,
        ty: CanonicalType,
        supertype: Option<Gc<ObjectShape>>,
    ) -> Result<Gc<Shape>, AllocError> {
        let address = ty.rtt().address();
        vm.wasm_object_shape(address, || Self::create(vm, ty, supertype))
    }

    fn create(
        vm: &Vm,
        ty: CanonicalType,
        supertype: Option<Gc<ObjectShape>>,
    ) -> Result<Gc<Shape>, AllocError> {
        let spec = match ty.rtt().kind() {
            TypeKind::Array => ShapeSpec::of::<WasmArray>(),
            _ => ShapeSpec::of::<WasmStruct>(),
        };
        let shape = vm.try_allocate::<ObjectShape>(ObjectShapeInit {
            base: Shape::init_for_objects_without_storage::<ObjectShape>(vm, spec),
            numbered: NumberedType(UnsafeCell::new(MaybeUninit::uninit())),
            canonical: Canonical(ty),
            supertype,
        })?;
        let inherited = supertype.as_ref().map(|it| it.object_type());
        let numbered = ObjectType::new(shape.id().bits(), shape.canonical().rtt(), inherited);
        // SAFETY: nothing has seen it.
        unsafe { (*shape.numbered.0.get()).write(numbered) };
        Ok(shape.upcast())
    }

    #[inline(always)]
    pub(crate) fn object_type(&self) -> &ObjectType {
        // SAFETY: `create` has written it.
        unsafe { (*self.numbered.0.get()).assume_init_ref() }
    }

    pub(crate) fn canonical(&self) -> &CanonicalType {
        &self.canonical.0
    }
}
