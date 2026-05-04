/// Represents JavaScript error types
//
// PORT NOTE: Zig source is `enum(u8) { ..., _ }` (non-exhaustive — any u8 is a
// valid bit pattern). A Rust `#[repr(u8)] enum` would make non-listed values
// UB, so this is ported as a transparent u8 newtype with associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct JSErrorCode(pub u8);

#[allow(non_upper_case_globals)]
impl JSErrorCode {
    pub const Error: Self = Self(0);
    pub const EvalError: Self = Self(1);
    pub const RangeError: Self = Self(2);
    pub const ReferenceError: Self = Self(3);
    pub const SyntaxError: Self = Self(4);
    pub const TypeError: Self = Self(5);
    pub const URIError: Self = Self(6);
    pub const AggregateError: Self = Self(7);

    // StackOverflow & OutOfMemoryError is not an ErrorType in "JavaScriptCore/ErrorType.h" within JSC, so the number here is just totally made up
    pub const OutOfMemoryError: Self = Self(8);
    pub const BundlerError: Self = Self(252);
    pub const StackOverflow: Self = Self(253);
    pub const UserErrorCode: Self = Self(254);
}

// keep in sync with ExceptionCode in src/jsc/bindings/ExceptionCode.h
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub enum DOMExceptionCode {
    // DOMException error names (https://webidl.spec.whatwg.org/#idl-DOMException-error-names).
    // Those need to be kept in sync with the array in DOMException.cpp.
    IndexSizeError, // Deprecated. Use RangeError instead.
    HierarchyRequestError,
    WrongDocumentError,
    InvalidCharacterError,
    NoModificationAllowedError,
    NotFoundError,
    NotSupportedError,
    InUseAttributeError,
    InvalidStateError,
    SyntaxError,
    InvalidModificationError,
    NamespaceError,
    InvalidAccessError, // Deprecated. use NotAllowedError instead.
    TypeMismatchError,  // Deprecated. Use TypeError instead.
    SecurityError,
    NetworkError,
    AbortError,
    URLMismatchError,
    QuotaExceededError,
    TimeoutError,
    InvalidNodeTypeError,
    DataCloneError,
    EncodingError,
    NotReadableError,
    UnknownError,
    ConstraintError,
    DataError,
    TransactionInactiveError,
    ReadonlyError,
    VersionError,
    OperationError,
    NotAllowedError,

    // Simple exceptions (https://webidl.spec.whatwg.org/#idl-exceptions).
    RangeError,
    TypeError,
    JSSyntaxError, // Different from DOM SYNTAX_ERR.

    // Non-standard error.
    StackOverflowError,
    OutOfMemoryError,

    // Used to indicate to the bindings that a JS exception was thrown below and it should be propagated.
    ExistingExceptionError,

    InvalidThisError,
    InvalidURLError,
    CryptoOperationFailedError,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSErrorCode.zig (72 lines)
//   confidence: high
//   todos:      0
//   notes:      JSErrorCode is non-exhaustive `enum(u8){_}` → transparent u8 newtype + consts; DOMExceptionCode is exhaustive #[repr(u8)] enum.
// ──────────────────────────────────────────────────────────────────────────
