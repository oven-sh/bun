pub const Error = error{
    ConnectionClosed,
    ConnectionTimedOut,
    LifetimeTimeout,
    IdleTimeout,
    PasswordRequired,
    MissingAuthData,
    AuthenticationFailed,
    FailedToEncryptPassword,
    InvalidPublicKey,
    UnsupportedAuthPlugin,
    UnsupportedProtocolVersion,

    LocalInfileNotSupported,
    JSError,
    JSTerminated,
    OutOfMemory,
    Overflow,

    WrongNumberOfParametersProvided,

    UnsupportedColumnType,

    InvalidLocalInfileRequest,
    InvalidAuthSwitchRequest,
    InvalidQueryBinding,
    InvalidResultRow,
    InvalidBinaryValue,
    InvalidEncodedInteger,
    InvalidEncodedLength,

    InvalidPrepareOKPacket,
    InvalidOKPacket,
    InvalidErrorPacket,
    UnexpectedPacket,
    ShortRead,
    UnknownError,
    InvalidState,
};

pub fn mysqlErrorToJS(globalObject: *jsc.JSGlobalObject, message: ?[]const u8, err: Error) JSValue {
    const msg = message orelse @errorName(err);
    const code = switch (err) {
        error.ConnectionClosed => "ERR_MYSQL_CONNECTION_CLOSED",
        error.Overflow => "ERR_MYSQL_OVERFLOW",
        error.AuthenticationFailed => "ERR_MYSQL_AUTHENTICATION_FAILED",
        error.UnsupportedAuthPlugin => "ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN",
        error.UnsupportedProtocolVersion => "ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION",
        error.LocalInfileNotSupported => "ERR_MYSQL_LOCAL_INFILE_NOT_SUPPORTED",
        error.WrongNumberOfParametersProvided => "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
        error.UnsupportedColumnType => "ERR_MYSQL_UNSUPPORTED_COLUMN_TYPE",
        error.InvalidLocalInfileRequest => "ERR_MYSQL_INVALID_LOCAL_INFILE_REQUEST",
        error.InvalidAuthSwitchRequest => "ERR_MYSQL_INVALID_AUTH_SWITCH_REQUEST",
        error.InvalidQueryBinding => "ERR_MYSQL_INVALID_QUERY_BINDING",
        error.InvalidResultRow => "ERR_MYSQL_INVALID_RESULT_ROW",
        error.InvalidBinaryValue => "ERR_MYSQL_INVALID_BINARY_VALUE",
        error.InvalidEncodedInteger => "ERR_MYSQL_INVALID_ENCODED_INTEGER",
        error.InvalidEncodedLength => "ERR_MYSQL_INVALID_ENCODED_LENGTH",
        error.InvalidPrepareOKPacket => "ERR_MYSQL_INVALID_PREPARE_OK_PACKET",
        error.InvalidOKPacket => "ERR_MYSQL_INVALID_OK_PACKET",
        error.InvalidErrorPacket => "ERR_MYSQL_INVALID_ERROR_PACKET",
        error.UnexpectedPacket => "ERR_MYSQL_UNEXPECTED_PACKET",
        error.ConnectionTimedOut => "ERR_MYSQL_CONNECTION_TIMEOUT",
        error.IdleTimeout => "ERR_MYSQL_IDLE_TIMEOUT",
        error.LifetimeTimeout => "ERR_MYSQL_LIFETIME_TIMEOUT",
        error.PasswordRequired => "ERR_MYSQL_PASSWORD_REQUIRED",
        error.MissingAuthData => "ERR_MYSQL_MISSING_AUTH_DATA",
        error.FailedToEncryptPassword => "ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD",
        error.InvalidPublicKey => "ERR_MYSQL_INVALID_PUBLIC_KEY",
        error.UnknownError => "ERR_MYSQL_UNKNOWN_ERROR",
        error.InvalidState => "ERR_MYSQL_INVALID_STATE",
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

    return createMySQLError(globalObject, msg, .{
        .code = code,
        .errno = null,
        .sqlState = null,
    }) catch |ex| globalObject.takeException(ex);
}

const bun = @import("bun");
const createMySQLError = @import("./ErrorPacket.zig").createMySQLError;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
