//! expensive heap reference-counted string type
//! only use this for big strings
//! like source code
//! not little ones

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
// Zig's `bun.WTF.StringImpl` is the *pointer* type `*WTFStringImplStruct`;
// in Rust that's `bun_string::WTFStringImpl` (= `*mut WTFStringImplStruct`).
use bun_string::WTFStringImpl;
use bun_jsc::StringJsc as _; // extension trait providing `.to_js()` on `bun_string::String`

pub type Hash = u32;

/// `std.HashMap(Hash, *RefString, bun.IdentityContext(Hash), 80)`
// `bun.IdentityContext` is an identity hasher (key is already a hash). The `80`
// max-load-percentage has no direct knob on the Rust side.
pub type Map = bun_collections::HashMap<Hash, *mut RefString, bun_collections::IdentityContext<Hash>>;

pub type Callback = unsafe fn(ctx: *mut c_void, str: *mut RefString);

pub struct RefString {
    pub ptr: *const u8,
    pub len: usize,
    pub hash: Hash,
    // `impl` is a Rust keyword — renamed to `impl_`.
    pub impl_: WTFStringImpl,

    // Zig field `allocator: std.mem.Allocator` dropped — non-AST crate uses the
    // global mimalloc allocator (see PORTING.md §Allocators). `destroy` below
    // frees via `Box::from_raw`.
    pub ctx: Option<NonNull<c_void>>,
    pub on_before_deinit: Option<Callback>,
}

impl RefString {
    pub fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // Zig: `bun.String.init(this.impl).toJS(global)` — wrap the raw
        // `WTFStringImpl` pointer without bumping the refcount (`String` has
        // no `Drop`, so this is the same adopt-then-forget as Zig's init).
        bun_string::String::adopt_wtf_impl(self.impl_).to_js(global)
    }

    pub fn compute_hash(input: &[u8]) -> u32 {
        // Zig: `std.hash.XxHash32.hash(0, input)`.
        bun_hash::XxHash32::hash(0, input)
    }

    pub fn slice(&self) -> &[u8] {
        self.ref_();

        self.leak()
    }

    pub fn ref_(&self) {
        // SAFETY: `impl_` is a live `WTF::StringImpl*` for the lifetime of `self`.
        unsafe { (*self.impl_).r#ref() };
    }

    pub fn leak(&self) -> &[u8] {
        // Zig: `@setRuntimeSafety(false); return this.ptr[0..this.len];`
        // SAFETY: `ptr` points to a live allocation of `len` bytes for the
        // lifetime of `self` (freed only in `destroy`).
        unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
    }

    pub fn deref(&self) {
        // SAFETY: `impl_` is a live `WTF::StringImpl*` for the lifetime of `self`.
        unsafe { (*self.impl_).deref() };
    }

    /// Called when the underlying `WTF::StringImpl` refcount reaches zero.
    ///
    /// Zig signature: `pub fn deinit(this: *RefString) void` — frees the byte
    /// buffer and then `allocator.destroy(this)` (self-destroying). Because
    /// `RefString` is heap-allocated and held as `*mut RefString` (see `Map`),
    /// this stays an explicit raw-pointer destroy rather than `impl Drop`.
    ///
    /// SAFETY: `this` must be the unique live reference to a `RefString`
    /// previously allocated via `Box::into_raw` (or equivalent). After this
    /// call `this` is dangling.
    // TODO(port): revisit ownership in Phase B — intrusive refcount via
    // WTF::StringImpl; may become `impl Drop` if `RefString` ends up `Box`-owned.
    pub unsafe fn destroy(this: *mut RefString) {
        // SAFETY: caller contract — `this` is the unique live pointer to a
        // `Box<RefString>`-allocated value whose `ptr`/`len` describe a
        // `Box<[u8]>`-allocated buffer. All raw derefs and `from_raw` calls
        // below operate on those owned allocations.
        unsafe {
            if let Some(on_before_deinit) = (*this).on_before_deinit {
                // Zig does `this.ctx.?` — caller guarantees `ctx` is set
                // whenever `on_before_deinit` is set.
                on_before_deinit((*this).ctx.unwrap().as_ptr(), this);
            }

            // `allocator.free(this.leak())` — reconstitute the owned byte slice and drop it.
            drop(Box::from_raw(core::slice::from_raw_parts_mut(
                (*this).ptr.cast_mut(),
                (*this).len,
            )));
            // `allocator.destroy(this)`
            drop(Box::from_raw(this));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/RefString.zig (62 lines)
//   confidence: medium
//   todos:      3
//   notes:      intrusive WTF::StringImpl refcount + self-destroy kept as explicit `unsafe fn destroy`; xxhash32 / IdentityHasher / StringImpl import paths need Phase-B wiring
// ──────────────────────────────────────────────────────────────────────────
