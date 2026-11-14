/// Represents JavaScript error types
//
// Non-exhaustive on the C++ side — any u8 is a valid bit pattern. A Rust
// `#[repr(u8)] enum` would make non-listed values UB, so this is a
// transparent u8 newtype with associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct JSErrorCode(pub u8);

#[allow(non_upper_case_globals)]
impl JSErrorCode {
    pub const Error: Self = Self(0);

    // StackOverflow & OutOfMemoryError is not an ErrorType in "JavaScriptCore/ErrorType.h" within JSC, so the number here is just totally made up
}

/// The `WebCore::ExceptionCode` values Rust sends. A new one needs its number here and its `static_assert` in bindings.cpp.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub enum DOMExceptionCode {
    TypeMismatchError = 13,
}
