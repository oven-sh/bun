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
