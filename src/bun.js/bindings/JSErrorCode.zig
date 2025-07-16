/// Represents JavaScript error types
pub const JSErrorCode = enum(u8) {
    Error = 0,
    EvalError = 1,
    RangeError = 2,
    ReferenceError = 3,
    SyntaxError = 4,
    TypeError = 5,
    URIError = 6,
    AggregateError = 7,

    // StackOverflow & OutOfMemoryError is not an ErrorType in "JavaScriptCore/ErrorType.h" within JSC, so the number here is just totally made up
    OutOfMemoryError = 8,
    BundlerError = 252,
    StackOverflow = 253,
    UserErrorCode = 254,
    _,
};

// keep in sync with ExceptionCode in src/bun.js/bindings/ExceptionCode.h
pub const DOMExceptionCode = enum(u8) {
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
    TypeMismatchError, // Deprecated. Use TypeError instead.
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
};
