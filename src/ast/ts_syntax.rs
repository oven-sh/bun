//! Handles to the TypeScript syntax the parser saves for the type checker
//! (`bun_js_parser::sema::ts_syntax`).

macro_rules! handle {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Copy, Clone, PartialEq, Eq)]
        pub struct $name(pub u32);

        impl $name {
            pub const NONE: Self = $name(u32::MAX);
        }

        impl Default for $name {
            #[inline]
            fn default() -> Self {
                Self::NONE
            }
        }
    };
}

handle!(
    /// Of `S::TypeScript`.
    StatementId
);
handle!(
    /// Of `E::JSXElement`.
    JsxId
);
