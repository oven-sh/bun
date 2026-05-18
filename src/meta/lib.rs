//! Zig comptime-reflection helpers.
//!
//! Almost everything in `meta.zig` is built on `@typeInfo` / `@TypeOf` /
//! `@hasDecl` / `@Type`, which have **no Rust equivalent** (see PORTING.md
//! §Comptime reflection). In Rust the call sites should use:
//!   - a generic `<T>` directly instead of `@TypeOf(anytype)`
//!   - a trait bound instead of `@hasDecl` duck-typing
//!   - `#[derive(...)]` instead of field iteration
//!   - `core::any::type_name::<T>()` instead of `@typeName`
//!
//! The few items that *do* have a Rust shape are ported below; the rest are
//! stubbed with `// TODO(port):` pointing callers at the idiomatic
//! replacement.

pub mod tagged_union;
pub use tagged_union::TaggedUnion;

// ──────────────────────────────────────────────────────────────────────────
// Type-level reflection helpers — no Rust equivalent
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): `OptionalChild(T)` extracts `U` from `*?U`. Rust has no
// type-level reflection; callers should name the inner type directly or use
// an associated type on a trait. No replacement provided.

// TODO(port): `EnumFields(T)` returns `std.builtin.Type.EnumField` slice.
// Rust enums do not expose field metadata at runtime. Callers that need the
// variant list should `#[derive(strum::VariantNames)]` / `EnumIter` on the
// enum itself.

// TODO(port): `ReturnOfMaybe(function)` / `MaybeResult(MaybeType)` extract
// the `Ok` payload type from a `bun_sys::Result<T>`-returning fn. In Rust
// the `T` is already named at the call site; no helper needed.

// TODO(port): `ReturnOf(function)` / `ReturnOfType(Type)` extract a fn's
// return type. Rust has no fn-signature reflection; callers must name the
// return type or use an associated type (`FnOnce() -> R` bound gives `R`).

/// `@typeName(T)` with the namespace prefix stripped.
///
/// Note: unlike the Zig version this is **not** `const` — `type_name` is not
/// a `const fn` and string slicing on it cannot be done at compile time.
/// Callers that needed a comptime string should use a literal or
/// `const_format::formatcp!`.
pub fn type_name<T: ?Sized>() -> &'static str {
    type_base_name(core::any::type_name::<T>())
}

/// partially emulates behaviour of @typeName in previous Zig versions,
/// converting "some.namespace.MyType" to "MyType"
#[inline]
pub fn type_base_name(fullname: &'static str) -> &'static str {
    // leave type name like "namespace.WrapperType(namespace.MyType)" as it is
    // PORT NOTE: Rust uses `<...>` for generics and `::` for paths, not `(` / `.`.
    // Keep the Zig delimiters for parity (this fn is fed Zig-style names in
    // some snapshot paths) and also handle the Rust forms.
    if fullname.contains('(') || fullname.contains('<') {
        return fullname;
    }
    let after_dot = match fullname.rfind('.') {
        None => fullname,
        Some(idx) => &fullname[idx + 1..],
    };
    match after_dot.rfind("::") {
        None => after_dot,
        Some(idx) => &after_dot[idx + 2..],
    }
}

// TODO(port): `enumFieldNames(Type)` returns variant names minus
// `"_none" | "" | "_"`. Replace at call sites with
// `#[derive(strum::VariantNames)]` and filter there. No generic helper —
// Rust cannot iterate an arbitrary enum's variants without a derive.

// TODO(port): `banFieldType(Container, T)` — compile-time assertion that no
// field of `Container` has type `T`. No Rust equivalent; would require a
// proc-macro. Callers should drop the check (it was a lint, not load-bearing).

// TODO(port): `Item(T)` — element type of a slice/array/pointer. In Rust the
// element type is always nameable directly (`&[T]` → `T`); no helper needed.

// ──────────────────────────────────────────────────────────────────────────
// ConcatArgs* — build an ArgsTuple for `@call`
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): `ConcatArgs1/2/4` prepend fixed args to an `anytype` tuple to
// form a `std.meta.ArgsTuple` for `@call(.auto, func, args)`. Rust has no
// `@call`/ArgsTuple; callers invoke the fn directly with the args spelled
// out. Delete at call sites.

// TODO(port): `CreateUniqueTuple(N, types)` — `@Type` synthesis of a tuple
// struct. Rust tuples `(T0, T1, ...)` are the direct equivalent; no helper
// needed. (This was `fn`-private in Zig anyway.)

// ──────────────────────────────────────────────────────────────────────────
// Layout / copy / eql predicates — become marker-trait bounds
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): `hasStableMemoryLayout(T)` — recursive check that a type's
// layout is FFI-stable. In Rust this is `#[repr(C)]` / `#[repr(transparent)]`
// and is enforced by the type definition, not queried generically. Callers
// that gated on this should add a `: bytemuck::Pod` (or local marker trait)
// bound instead.

// TODO(port): `isSimpleCopyType(T)` — recursive "is this trivially
// copyable". In Rust this is exactly the `Copy` bound. Callers: `T: Copy`.

// TODO(port): `isScalar(T)` — `i32|u32|i64|u64|f32|f64|bool|enum`. Callers
// should use a sealed `Scalar` marker trait impl'd for those types, or just
// accept `T: Copy + PartialEq` if that was the intent.

// TODO(port): `isSimpleEqlType(T)` — types where `a == b` is bitwise. In
// Rust: `T: Eq` (or `bytemuck::Pod` for the bitwise guarantee). Callers:
// add the bound.

// ──────────────────────────────────────────────────────────────────────────
// List-container duck-typing
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ListContainerType {
    ArrayList,
    Vec,
    SmallList,
}

// TODO(port): `looksLikeListContainerType(T)` inspects field names /
// `@hasDecl` to classify a type as ArrayList/Vec/SmallList and extract
// its element type. Per PORTING.md §Comptime reflection, `@hasDecl` →
// trait bound. Replace with:
//
//     pub trait ListContainer {
//         type Child;
//         const KIND: ListContainerType;
//     }
//
// impl'd by `Vec<T>`, `Vec<T>`,
// `bun_collections::SmallList<T, N>`. Callers bound on `T: ListContainer`.

// TODO(port): `Tagged(U, T)` — re-synthesize a `union` with a new tag type
// via `@Type`. Rust enums are always tagged; there is no "retag" operation.
// Callers must define the enum they want directly.

// TODO(port): `SliceChild(T)` — `&[U]` → `U`, else `T`. Same as `Item`;
// callers name `U` directly.

// ──────────────────────────────────────────────────────────────────────────
// useAllFields — exhaustive-field-use lint (ziglang/zig#21879)
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): `useAllFields(T, _: VoidFields(T))` + `VoidFields(T)` are a
// userland workaround forcing the caller to mention every field of `T` so
// the compiler errors when a field is added. Rust's exhaustive struct
// patterns (`let Foo { a, b, c } = x;` without `..`) provide this natively.
// Callers: use a destructuring `let` with no `..`. Delete here.

#[inline]
pub fn void_field_type_discard_helper<T>(_data: T) {
    // intentionally empty
}

// TODO(port): `hasDecl(T, name)` / `hasField(T, name)` — wrappers around
// `@hasDecl`/`@hasField` that return `false` for non-container types instead
// of erroring. Per PORTING.md: `@hasDecl` checks become trait bounds;
// `@hasField` checks become exhaustive `match`/destructure. No runtime
// helper is possible.

// ported from: src/meta/meta.zig
