// NEGATIVE corpus — `sg scan` MUST NOT warn on any line below.
// Verifies the lint stays scoped to dealloc-shaped sinks.
//
// Run from repo root:
//   sg scan --config .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/sgconfig.yml \
//          .unsafe-audit/audit/tests/clippy_lint_from_ref_cast_mut/test_corpus/negative.rs
//
// Expected count: 0 warnings.

#![allow(unused)]

mod bun_ptr {
    pub struct ThreadSafeRefCount<T>(core::marker::PhantomData<T>);
    impl<T> ThreadSafeRefCount<T> {
        pub fn ref_(_: *mut T) {}
        pub fn deref_(_: *mut T) {}
    }
}

struct T;

fn refcount_increment_is_a_different_cluster() {
    let t = T;
    // U3 cluster, NOT U2. Different fix template. Lint must stay silent.
    bun_ptr::ThreadSafeRefCount::<T>::ref_(core::ptr::from_ref(&t).cast_mut());
}

fn deref_method_resolution_is_fine() {
    // Storing the *mut into a struct field is not a deallocation.
    let t = T;
    let _ptr: *mut T = core::ptr::from_ref(&t).cast_mut();
}

fn arena_owned_pointer_is_fine() {
    use core::ptr::NonNull;
    let t = T;
    let _nn: NonNull<T> = unsafe { NonNull::new_unchecked(core::ptr::from_ref(&t).cast_mut()) };
}

mod foreign_destroy_function {
    pub unsafe fn destroy_handle(_: *mut ()) {}
}

fn foreign_destroy_unrelated_path_is_fine() {
    // Lint deliberately only matches `heap::destroy` / `bun_core::heap::destroy`,
    // not arbitrary functions called `destroy_*`. Caller-defined destructors
    // for unrelated handles are not the U2 pattern.
    let t = ();
    unsafe {
        foreign_destroy_function::destroy_handle(core::ptr::from_ref(&t).cast_mut());
    }
}
