pub const AnyPostgresError = error{
    ConnectionClosed,
    ExpectedRequest,
    ExpectedStatement,
    InvalidBackendKeyData,
    InvalidBinaryData,
    InvalidByteSequence,
    InvalidByteSequenceForEncoding,
    InvalidCharacter,
    InvalidMessage,
    InvalidMessageLength,
    InvalidQueryBinding,
    InvalidServerKey,
    InvalidServerSignature,
    JSError,
    MultidimensionalArrayNotSupportedYet,
    NullsInArrayNotSupportedYet,
    OutOfMemory,
    Overflow,
    PBKDFD2,
    SASL_SIGNATURE_MISMATCH,
    SASL_SIGNATURE_INVALID_BASE64,
    ShortRead,
    TLSNotAvailable,
    TLSUpgradeFailed,
    UnexpectedMessage,
    UNKNOWN_AUTHENTICATION_METHOD,
    UNSUPPORTED_AUTHENTICATION_METHOD,
    UnsupportedByteaFormat,
    UnsupportedIntegerSize,
    UnsupportedArrayFormat,
    UnsupportedNumericFormat,
    UnknownFormatCode,
};

pub fn postgresErrorToJS(globalObject: *JSC.JSGlobalObject, message: ?[]const u8, err: AnyPostgresError) JSValue {
    const error_code: JSC.Error = switch (err) {
        error.ConnectionClosed => .POSTGRES_CONNECTION_CLOSED,
        error.ExpectedRequest => .POSTGRES_EXPECTED_REQUEST,
        error.ExpectedStatement => .POSTGRES_EXPECTED_STATEMENT,
        error.InvalidBackendKeyData => .POSTGRES_INVALID_BACKEND_KEY_DATA,
        error.InvalidBinaryData => .POSTGRES_INVALID_BINARY_DATA,
        error.InvalidByteSequence => .POSTGRES_INVALID_BYTE_SEQUENCE,
        error.InvalidByteSequenceForEncoding => .POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING,
        error.InvalidCharacter => .POSTGRES_INVALID_CHARACTER,
        error.InvalidMessage => .POSTGRES_INVALID_MESSAGE,
        error.InvalidMessageLength => .POSTGRES_INVALID_MESSAGE_LENGTH,
        error.InvalidQueryBinding => .POSTGRES_INVALID_QUERY_BINDING,
        error.InvalidServerKey => .POSTGRES_INVALID_SERVER_KEY,
        error.InvalidServerSignature => .POSTGRES_INVALID_SERVER_SIGNATURE,
        error.MultidimensionalArrayNotSupportedYet => .POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET,
        error.NullsInArrayNotSupportedYet => .POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET,
        error.Overflow => .POSTGRES_OVERFLOW,
        error.PBKDFD2 => .POSTGRES_AUTHENTICATION_FAILED_PBKDF2,
        error.SASL_SIGNATURE_MISMATCH => .POSTGRES_SASL_SIGNATURE_MISMATCH,
        error.SASL_SIGNATURE_INVALID_BASE64 => .POSTGRES_SASL_SIGNATURE_INVALID_BASE64,
        error.TLSNotAvailable => .POSTGRES_TLS_NOT_AVAILABLE,
        error.TLSUpgradeFailed => .POSTGRES_TLS_UPGRADE_FAILED,
        error.UnexpectedMessage => .POSTGRES_UNEXPECTED_MESSAGE,
        error.UNKNOWN_AUTHENTICATION_METHOD => .POSTGRES_UNKNOWN_AUTHENTICATION_METHOD,
        error.UNSUPPORTED_AUTHENTICATION_METHOD => .POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD,
        error.UnsupportedByteaFormat => .POSTGRES_UNSUPPORTED_BYTEA_FORMAT,
        error.UnsupportedArrayFormat => .POSTGRES_UNSUPPORTED_ARRAY_FORMAT,
        error.UnsupportedIntegerSize => .POSTGRES_UNSUPPORTED_INTEGER_SIZE,
        error.UnsupportedNumericFormat => .POSTGRES_UNSUPPORTED_NUMERIC_FORMAT,
        error.UnknownFormatCode => .POSTGRES_UNKNOWN_FORMAT_CODE,
        error.JSError => {
            return globalObject.takeException(error.JSError);
        },
        error.OutOfMemory => {
            // TODO: add binding for creating an out of memory error?
            return globalObject.takeException(globalObject.throwOutOfMemory());
        },
        error.ShortRead => {
            bun.unreachablePanic("Assertion failed: ShortRead should be handled by the caller in postgres", .{});
        },
    };
    if (message) |msg| {
        return error_code.fmt(globalObject, "{s}", .{msg});
    }
    return error_code.fmt(globalObject, "Failed to bind query: {s}", .{@errorName(err)});
}
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
