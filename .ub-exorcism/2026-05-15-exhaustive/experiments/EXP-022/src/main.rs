// EXP-022: DirectoryWatchStore::owner(&mut self) -> &mut DevServer
// Sibling-projection from &mut self while &mut self is still live.
// Mirror of src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81 (author TODO "unsound under stacked borrows").
//
// The hazard: from a &mut SubField, walk back to &mut Parent containing it,
// while the original &mut SubField is still live. The borrow checker normally
// rejects this; bun's `from_field_ptr!` macro bypasses it via raw pointers,
// producing two live &mut to overlapping memory.
//
// To reproduce that hazard in a standalone repro we have to also bypass borrowck
// via raw pointers throughout — otherwise rustc rejects at compile time (which
// is what the bun macro is hiding from rustc).

struct Parent {
    sub: SubField,
    other: u32,
}

struct SubField {
    _x: u32,
}

// Mirror of from_field_ptr!: returns &mut Parent given a *mut SubField field.
unsafe fn owner_via_sibling_projection(sub_ptr: *mut SubField) -> &'static mut Parent {
    let offset = std::mem::offset_of!(Parent, sub);
    let parent_ptr = (sub_ptr as *mut u8).wrapping_sub(offset) as *mut Parent;
    unsafe { &mut *parent_ptr }
}

unsafe fn sub_via_raw(parent_ptr: *mut Parent) -> &'static mut SubField {
    let sub_ptr = unsafe { std::ptr::addr_of_mut!((*parent_ptr).sub) };
    unsafe { &mut *sub_ptr }
}

fn main() {
    let mut parent = Parent {
        sub: SubField { _x: 1 },
        other: 42,
    };
    let parent_ptr: *mut Parent = &mut parent as *mut Parent;

    // Take &mut SubField via raw projection (mirrors having a stored *mut SubField in a struct).
    let sub_ref: &mut SubField = unsafe { sub_via_raw(parent_ptr) };
    let sub_ptr: *mut SubField = sub_ref as *mut SubField;

    // Now obtain &mut Parent via sibling-projection from the still-live &mut SubField.
    let owner_ref: &mut Parent = unsafe { owner_via_sibling_projection(sub_ptr) };

    // Mutate through owner_ref — this aliases with sub_ref.
    owner_ref.other = owner_ref.other.wrapping_add(1);

    // Re-touch sub_ref *after* the owner mutation — TB/SB violation.
    sub_ref._x = sub_ref._x.wrapping_add(1);

    // Print to force the compiler to keep both borrows live.
    println!("other = {}, _x = {}", owner_ref.other, sub_ref._x);
}
