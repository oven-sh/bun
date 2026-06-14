use core::marker::PhantomData;
use core::mem::{align_of, size_of, ManuallyDrop, MaybeUninit};
use std::os::raw::c_uint;

trait Bindgen {
    type ZigType;
    type ExternType;

    const SAME_REPR: bool = false;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType;
}

struct BindgenArray<Child>(PhantomData<Child>);

#[repr(C)]
struct ExternArrayList<Child> {
    data: *mut Child,
    length: c_uint,
    capacity: c_uint,
}

impl<Child: Bindgen> Bindgen for BindgenArray<Child> {
    type ZigType = Vec<Child::ZigType>;
    type ExternType = ExternArrayList<Child::ExternType>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        let length = extern_value.length as usize;
        let capacity = extern_value.capacity as usize;
        let data = extern_value.data;

        let unmanaged: Vec<Child::ExternType> =
            unsafe { Vec::from_raw_parts(data, length, capacity) };

        if size_of::<Child::ZigType>() == size_of::<Child::ExternType>()
            && align_of::<Child::ZigType>() == align_of::<Child::ExternType>()
            && Child::SAME_REPR
        {
            let (ptr, len, cap) = {
                let mut v = ManuallyDrop::new(unmanaged);
                (v.as_mut_ptr(), v.len(), v.capacity())
            };
            return unsafe { Vec::from_raw_parts(ptr.cast::<Child::ZigType>(), len, cap) };
        }

        if size_of::<Child::ZigType>() <= size_of::<Child::ExternType>()
            && align_of::<Child::ZigType>() <= 16
        {
            let mut v = ManuallyDrop::new(unmanaged);
            let storage_ptr = v.as_mut_ptr().cast::<u8>();
            let storage_len = v.capacity() * size_of::<Child::ExternType>();

            for i in 0..length {
                let mut old_elem = MaybeUninit::<Child::ExternType>::uninit();
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        storage_ptr.add(i * size_of::<Child::ExternType>()),
                        old_elem.as_mut_ptr().cast::<u8>(),
                        size_of::<Child::ExternType>(),
                    );
                }

                let new_elem = ManuallyDrop::new(Child::convert_from_extern(unsafe {
                    old_elem.assume_init()
                }));

                unsafe {
                    core::ptr::copy_nonoverlapping(
                        (&raw const *new_elem).cast::<u8>(),
                        storage_ptr.add(i * size_of::<Child::ZigType>()),
                        size_of::<Child::ZigType>(),
                    );
                }
            }

            let new_size_is_multiple =
                size_of::<Child::ExternType>() % size_of::<Child::ZigType>() == 0;
            let new_capacity = if new_size_is_multiple {
                capacity * (size_of::<Child::ExternType>() / size_of::<Child::ZigType>())
            } else {
                storage_len / size_of::<Child::ZigType>()
            };

            let items_ptr = storage_ptr.cast::<Child::ZigType>();
            return unsafe { Vec::from_raw_parts(items_ptr, length, new_capacity) };
        }

        unreachable!("fallback fresh-alloc path is not the audited branch");
    }
}

#[repr(C, align(8))]
struct Extern([u8; 8]);

#[repr(C)]
struct Zig([u32; 2]); // size 8, align 4

struct BadChild;

impl Bindgen for BadChild {
    type ZigType = Zig;
    type ExternType = Extern;

    fn convert_from_extern(_extern_value: Self::ExternType) -> Self::ZigType {
        Zig([0x1234, 0x5678])
    }
}

fn main() {
    assert_eq!(size_of::<Extern>(), size_of::<Zig>());
    assert_ne!(align_of::<Extern>(), align_of::<Zig>());
    assert!(align_of::<Zig>() <= 16);

    let mut v = vec![Extern([0; 8])];
    let ext = ExternArrayList {
        data: v.as_mut_ptr(),
        length: v.len() as c_uint,
        capacity: v.capacity() as c_uint,
    };
    core::mem::forget(v);

    let converted = BindgenArray::<BadChild>::convert_from_extern(ext);
    drop(converted);
}
