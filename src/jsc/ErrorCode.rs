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
        // bun_core::Error is #[repr(transparent)] NonZeroU16 — extract the raw u16.
        // TODO(port): confirm exact accessor name on bun_core::Error (.as_u16() / .raw())
        ErrorCode(code.as_u16())
    }

    #[inline]
    pub fn to_error(self) -> Error {
        // Zig: @errorFromInt(@intFromEnum(self))
        // SAFETY: self.0 was produced from a valid Error via `from()`; non-zero and
        // registered in the link-time error-name table by construction.
        // TODO(port): confirm exact constructor name on bun_core::Error (from_raw / from_u16)
        unsafe { Error::from_raw(self.0) }
    }

    // TODO(port): requires bun_core::err! and .as_u16() to be const-evaluable
    pub const PARSER_ERROR: ErrorCodeInt = bun_core::err!("ParserError").as_u16();
    pub const JS_ERROR_OBJECT: ErrorCodeInt = bun_core::err!("JSErrorObject").as_u16();

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
