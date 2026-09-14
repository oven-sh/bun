// POSITIVE corpus — `sg scan` MUST warn on every line marked WARN below.
// Run from repo root:
//   sg scan --config .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/sgconfig.yml \
//          .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/test_corpus/positive.rs
//
// Expected count: 8 warnings (the lint is intentionally precise — see comments).

#![allow(unused)]

mod bun_core {
    pub mod heap {
        pub unsafe fn destroy<T>(_: *mut T) {}
    }
}

struct T;

fn audit_pattern_dealloc_through_from_ref() {
    let t = T;
    unsafe {
        bun_core::heap::destroy(core::ptr::from_ref(&t).cast_mut()); // WARN
    }
    // Note: arbitrary `mod::destroy` paths are deliberately NOT linted, to
    // avoid false-positive cascades on third-party `destroy_*` symbols.
    // If your project introduces a new heap-style destroy path, extend the
    // rule's `any:` list with the new module name.
}

fn box_from_raw_through_from_ref() {
    let t = T;
    unsafe {
        let _ = Box::from_raw(core::ptr::from_ref(&t).cast_mut()); // WARN
        let _ = std::boxed::Box::from_raw(core::ptr::from_ref(&t).cast_mut()); // WARN
    }
}

fn drop_in_place_through_from_ref() {
    let t = T;
    unsafe {
        core::ptr::drop_in_place(core::ptr::from_ref(&t).cast_mut()); // WARN
        std::ptr::drop_in_place(core::ptr::from_ref(&t).cast_mut()); // WARN
        drop_in_place(core::ptr::from_ref(&t).cast_mut()); // WARN
    }
}

unsafe fn drop_in_place<T>(_: *mut T) {}

unsafe fn dealloc(_: *mut u8, _: core::alloc::Layout) {}
unsafe fn mi_free(_: *mut u8) {}

fn dealloc_through_from_ref() {
    let t = T;
    unsafe {
        let layout = core::alloc::Layout::new::<T>();
        dealloc(core::ptr::from_ref(&t).cast_mut() as *mut u8, layout); // WARN
    }
}

fn mi_free_through_from_ref() {
    let t = T;
    unsafe {
        mi_free(core::ptr::from_ref(&t).cast_mut() as *mut u8); // WARN
    }
}
