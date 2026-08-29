use core::marker::PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// A `Bindgen` adapter supplies associated `ZigType`/`ExternType` plus
// `convert_from_extern`.
// ──────────────────────────────────────────────────────────────────────────

pub trait Bindgen {
    type ZigType;
    type ExternType;

    /// `true` when `ZigType` and `ExternType` are layout-identical.
    /// Defaults to `false`; override per adapter.
    const SAME_REPR: bool = false;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType;
}

pub struct BindgenTrivial<T>(PhantomData<T>);

impl<T> Bindgen for BindgenTrivial<T> {
    type ZigType = T;
    type ExternType = T;
    const SAME_REPR: bool = true;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        extern_value
    }
}
