//! expensive heap reference-counted string type
//! only use this for big strings
//! like source code
//! not little ones

use core::ptr::NonNull;

// `bun_core::WTFStringImpl` is the *pointer* type (= `*mut WTFStringImplStruct`).
use bun_core::WTFStringImpl;

use crate::virtual_machine::VirtualMachine;

pub(crate) type Hash = u32;

/// `std.HashMap(Hash, *RefString, bun.IdentityContext(Hash), 80)`
// `bun.IdentityContext` is an identity hasher (key is already a hash). The `80`
// max-load-percentage has no direct knob on the Rust side.
pub type Map =
    bun_collections::HashMap<Hash, NonNull<RefString>, bun_collections::IdentityContext<Hash>>;

/// Error for bytes that aren't interned yet and are longer than [`bun_core::String::max_length`].
#[derive(Debug)]
pub struct StringTooLong;

pub struct RefString {
    pub(crate) bytes: Box<[u8]>,
    pub(crate) hash: Hash,
    // `impl` is a Rust keyword — renamed to `impl_`.
    pub(crate) impl_: WTFStringImpl,
    /// Whether the VM's `ref_strings` holds it under `hash`.
    pub(crate) interned: bool,
}

impl RefString {
    pub(crate) fn compute_hash(input: &[u8]) -> u32 {
        bun_hash::XxHash32::hash(0, input)
    }

    /// Single audited deref of the set-once `impl_` backref so `ref_` /
    /// `deref` below are safe callers. `impl_` is assigned at construction
    /// from a live refcounted `WTF::StringImpl*` and remains valid until
    /// `destroy` consumes `self`.
    #[inline]
    fn wtf_impl(&self) -> &bun_core::WTFStringImplStruct {
        // SAFETY: `impl_` is a live `WTF::StringImpl*` for the lifetime of
        // `self` (set at construction; freed only after `destroy`).
        unsafe { &*self.impl_ }
    }

    pub fn ref_(&self) {
        self.wtf_impl().r#ref();
    }

    pub fn leak(&self) -> &[u8] {
        &self.bytes
    }

    pub fn deref(&self) {
        self.wtf_impl().deref();
    }

    /// Called when the underlying `WTF::StringImpl` refcount reaches zero.
    ///
    /// Frees the byte
    /// buffer and then the `RefString` itself (self-destroying). Because
    /// `RefString` is heap-allocated and held as `NonNull<RefString>` (see `Map`),
    /// this stays an explicit raw-pointer destroy rather than `impl Drop`.
    ///
    /// SAFETY: `this` must be the unique live reference to a `RefString`
    /// previously allocated via `heap::alloc` (or equivalent). After this
    /// call `this` is dangling.
    pub(crate) unsafe fn destroy(this: *mut RefString) {
        // SAFETY: caller contract — `this` is the unique live pointer to a
        // `Box<RefString>`-allocated value.
        unsafe {
            if (*this).interned {
                VirtualMachine::get()
                    .as_mut()
                    .ref_strings
                    .remove(&(*this).hash);
            }
            drop(bun_core::heap::take(this));
        }
    }
}
