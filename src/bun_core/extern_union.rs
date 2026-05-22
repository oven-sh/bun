// ─── extern_union_accessors! ──────────────────────────────────────────────────
// Zig accesses bare-union fields inline (`this.value.npm`) with no ceremony; the
// Rust port wraps each read in a tag-asserted `unsafe` accessor so call sites
// stay safe. Four crates hand-rolled the same accessor shape (Resolution, Bin,
// DependencyVersion, PackageManager Task) — this macro is the single definition.
//
// Emits, per arm, `pub fn $field(&self) -> &$Ty` and optionally
// `pub fn $field_mut(&mut self) -> &mut $Ty`, each guarded by
// `debug_assert!(self.$tag_field == $TagTy::$Variant)`.
//
// Projection uses `addr_of!`/`addr_of_mut!` so no intermediate `&Union` is
// formed (defensive against partially-initialized padding). The trailing
// `as *const $Ty` cast is identity for plain fields and unwraps
// `ManuallyDrop<$Ty>` (`#[repr(transparent)]`) for the `Task::Request`/`Data`
// case without needing a separate macro arm.
//
// Syntax:
//   extern_union_accessors! {
//       tag: <tag_field> as <TagTy>, value: <union_field>;
//       Variant => accessor: Ty;                          // ro, accessor==union field
//       Variant => accessor: Ty, mut accessor_mut;        // ro+rw
//       Variant => accessor @ union_field: Ty;            // ro, accessor≠union field
//       Variant => accessor @ union_field: Ty, mut accessor_mut;
//   }
#[macro_export]
macro_rules! extern_union_accessors {
    (
        tag: $tag_field:ident as $TagTy:ident, value: $value_field:ident;
        $($arms:tt)*
    ) => {
        $crate::extern_union_accessors!(@arms [$tag_field, $TagTy, $value_field] $($arms)*);
    };

    // arm: accessor name == union-field name, ro only
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $field:ident: $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $field, $field, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    // arm: accessor name == union-field name, ro + rw
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $field:ident: $Ty:ty, mut $field_mut:ident;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $field, $field, $Ty);
        $crate::extern_union_accessors!(@emit_rw [$tf, $TT, $vf] $Variant, $field, $field_mut, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    // arm: accessor name ≠ union-field name (`accessor @ ufield`), ro only
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $accessor:ident @ $ufield:ident: $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $ufield, $accessor, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    // arm: accessor name ≠ union-field name, ro + rw
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $accessor:ident @ $ufield:ident: $Ty:ty, mut $accessor_mut:ident;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $ufield, $accessor, $Ty);
        $crate::extern_union_accessors!(@emit_rw [$tf, $TT, $vf] $Variant, $ufield, $accessor_mut, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    (@arms [$tf:ident, $TT:ident, $vf:ident]) => {};

    (@emit_ro [$tf:ident, $TT:ident, $vf:ident] $Variant:ident, $ufield:ident, $accessor:ident, $Ty:ty) => {
        #[inline]
        pub fn $accessor(&self) -> &$Ty {
            debug_assert!(self.$tf == $TT::$Variant);
            // SAFETY: tag-guarded; `addr_of!` projects without forming an
            // intermediate `&Union`. Cast is identity for plain fields and
            // unwraps `ManuallyDrop<$Ty>` (repr(transparent)).
            unsafe { &*(::core::ptr::addr_of!(self.$vf.$ufield) as *const $Ty) }
        }
    };
    (@emit_rw [$tf:ident, $TT:ident, $vf:ident] $Variant:ident, $ufield:ident, $accessor_mut:ident, $Ty:ty) => {
        #[inline]
        pub fn $accessor_mut(&mut self) -> &mut $Ty {
            debug_assert!(self.$tf == $TT::$Variant);
            // SAFETY: tag-guarded; `&mut self` exclusive over union storage.
            unsafe { &mut *(::core::ptr::addr_of_mut!(self.$vf.$ufield) as *mut $Ty) }
        }
    };
}
