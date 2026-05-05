use bun_core::Error;

type ErrorCodeInt = u16;

/// Non-exhaustive `enum(u16) { _ }` in Zig — a newtype wrapper around the raw
/// integer code of a `bun_core::Error` (Zig `anyerror`).
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct ErrorCode(ErrorCodeInt);

impl ErrorCode {
    #[inline]
    pub fn from(code: Error) -> ErrorCode {
        // Zig: @as(ErrorCode, @enumFromInt(@intFromError(code)))
        // TODO(b2-blocked): bun_core::Error::as_u16 — bun_core::Error is currently the
        // wide errno-carrying struct, not the NonZeroU16 anyerror code. Use errno as a
        // stand-in until the interning table lands.
        ErrorCode(code.errno as ErrorCodeInt)
    }

    #[inline]
    pub fn to_error(self) -> Error {
        // Zig: @errorFromInt(@intFromEnum(self))
        // TODO(b2-blocked): bun_core::Error::from_raw — see `from` above.
        Error::from_errno(self.0 as i32)
    }

    // TODO(b2-blocked): bun_core::err! is not const-evaluable yet (no NonZeroU16 table).
    // Use sentinel codes; the C++ side only compares for equality.
    pub const PARSER_ERROR: ErrorCodeInt = 0xFFFE;
    pub const JS_ERROR_OBJECT: ErrorCodeInt = 0xFFFD;

    // Zig: `pub const Type = ErrorCodeInt;`
    // TODO(port): inherent associated types are unstable; callers should use u16 directly
}

// Zig: comptime { @export(&ErrorCode.ParserError, .{ .name = "Zig_ErrorCodeParserError" }); ... }
#[unsafe(no_mangle)]
pub static Zig_ErrorCodeParserError: ErrorCodeInt = ErrorCode::PARSER_ERROR;

#[unsafe(no_mangle)]
pub static Zig_ErrorCodeJSErrorObject: ErrorCodeInt = ErrorCode::JS_ERROR_OBJECT;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ErrorCode.zig (23 lines)
//   confidence: medium
//   todos:      4
//   notes:      depends on const-fn raw u16 accessors on bun_core::Error; exported statics keep Zig_ symbol names verbatim
// ──────────────────────────────────────────────────────────────────────────
