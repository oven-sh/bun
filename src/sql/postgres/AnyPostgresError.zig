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
    InvalidTimeFormat,
    JSError,
    JSTerminated,
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

/// Options for creating a PostgresError
pub const PostgresErrorOptions = struct {
    code: []const u8,
    errno: ?[]const u8 = null,
    detail: ?[]const u8 = null,
    hint: ?[]const u8 = null,
    severity: ?[]const u8 = null,
    position: ?[]const u8 = null,
    internalPosition: ?[]const u8 = null,
    internalQuery: ?[]const u8 = null,
    where: ?[]const u8 = null,
    schema: ?[]const u8 = null,
    table: ?[]const u8 = null,
    column: ?[]const u8 = null,
    dataType: ?[]const u8 = null,
    constraint: ?[]const u8 = null,
    file: ?[]const u8 = null,
    line: ?[]const u8 = null,
    routine: ?[]const u8 = null,
};

pub fn createPostgresError(
    globalObject: *jsc.JSGlobalObject,
    message: []const u8,
    options: PostgresErrorOptions,
) bun.JSError!JSValue {
    const opts_obj = JSValue.createEmptyObject(globalObject, 0);
    opts_obj.ensureStillAlive();
    opts_obj.put(globalObject, jsc.ZigString.static("code"), try bun.String.createUTF8ForJS(globalObject, options.code));
    inline for (std.meta.fields(PostgresErrorOptions)) |field| {
        const FieldType = @typeInfo(@TypeOf(@field(options, field.name)));
        if (FieldType == .optional) {
            if (@field(options, field.name)) |value| {
                opts_obj.put(globalObject, jsc.ZigString.static(field.name), try bun.String.createUTF8ForJS(globalObject, value));
            }
        }
    }
    opts_obj.put(globalObject, jsc.ZigString.static("message"), try bun.String.createUTF8ForJS(globalObject, message));

    return opts_obj;
}

pub fn postgresErrorToJS(globalObject: *jsc.JSGlobalObject, message: ?[]const u8, err: AnyPostgresError) JSValue {
    const code = switch (err) {
        error.ConnectionClosed => "ERR_POSTGRES_CONNECTION_CLOSED",
        error.ExpectedRequest => "ERR_POSTGRES_EXPECTED_REQUEST",
        error.ExpectedStatement => "ERR_POSTGRES_EXPECTED_STATEMENT",
        error.InvalidBackendKeyData => "ERR_POSTGRES_INVALID_BACKEND_KEY_DATA",
        error.InvalidBinaryData => "ERR_POSTGRES_INVALID_BINARY_DATA",
        error.InvalidByteSequence => "ERR_POSTGRES_INVALID_BYTE_SEQUENCE",
        error.InvalidByteSequenceForEncoding => "ERR_POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING",
        error.InvalidCharacter => "ERR_POSTGRES_INVALID_CHARACTER",
        error.InvalidMessage => "ERR_POSTGRES_INVALID_MESSAGE",
        error.InvalidMessageLength => "ERR_POSTGRES_INVALID_MESSAGE_LENGTH",
        error.InvalidQueryBinding => "ERR_POSTGRES_INVALID_QUERY_BINDING",
        error.InvalidServerKey => "ERR_POSTGRES_INVALID_SERVER_KEY",
        error.InvalidServerSignature => "ERR_POSTGRES_INVALID_SERVER_SIGNATURE",
        error.InvalidTimeFormat => "ERR_POSTGRES_INVALID_TIME_FORMAT",
        error.MultidimensionalArrayNotSupportedYet => "ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET",
        error.NullsInArrayNotSupportedYet => "ERR_POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET",
        error.Overflow => "ERR_POSTGRES_OVERFLOW",
        error.PBKDFD2 => "ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2",
        error.SASL_SIGNATURE_MISMATCH => "ERR_POSTGRES_SASL_SIGNATURE_MISMATCH",
        error.SASL_SIGNATURE_INVALID_BASE64 => "ERR_POSTGRES_SASL_SIGNATURE_INVALID_BASE64",
        error.TLSNotAvailable => "ERR_POSTGRES_TLS_NOT_AVAILABLE",
        error.TLSUpgradeFailed => "ERR_POSTGRES_TLS_UPGRADE_FAILED",
        error.UnexpectedMessage => "ERR_POSTGRES_UNEXPECTED_MESSAGE",
        error.UNKNOWN_AUTHENTICATION_METHOD => "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD",
        error.UNSUPPORTED_AUTHENTICATION_METHOD => "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD",
        error.UnsupportedByteaFormat => "ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT",
        error.UnsupportedArrayFormat => "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT",
        error.UnsupportedIntegerSize => "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
        error.UnsupportedNumericFormat => "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
        error.UnknownFormatCode => "ERR_POSTGRES_UNKNOWN_FORMAT_CODE",
        error.JSError => {
            return globalObject.takeException(error.JSError);
        },
        error.JSTerminated => {
            return globalObject.takeException(error.JSTerminated);
        },
        error.OutOfMemory => {
            // TODO: add binding for creating an out of memory error?
            return globalObject.takeException(globalObject.throwOutOfMemory());
        },
        error.ShortRead => {
            bun.unreachablePanic("Assertion failed: ShortRead should be handled by the caller in postgres", .{});
        },
    };

    var buffer_message = [_]u8{0} ** 256;
    const msg = message orelse std.fmt.bufPrint(buffer_message[0..], "Failed to bind query: {s}", .{@errorName(err)}) catch "Failed to bind query";

    return createPostgresError(globalObject, msg, .{ .code = code }) catch |e| globalObject.takeError(e);
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
