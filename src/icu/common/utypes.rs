//! `unicode/utypes.h`, `utypes.cpp`.

use core::ffi::CStr;

/// Below zero is a warning, zero is success, above zero is a failure.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub(crate) struct UErrorCode(pub i32);

/// Lets `result.as_ref()?` borrow a large value instead of moving it out of the `Result`.
impl From<&UErrorCode> for UErrorCode {
    fn from(code: &UErrorCode) -> Self {
        *code
    }
}

impl UErrorCode {
    #[inline(always)]
    pub(crate) const fn is_success(self) -> bool {
        self.0 <= 0
    }

    #[inline(always)]
    pub(crate) const fn is_failure(self) -> bool {
        self.0 > 0
    }

    /// `u_errorName` for the standard errors.
    pub(crate) fn c_name(self) -> &'static CStr {
        STANDARD_NAMES
            .get(self.0 as u32 as usize)
            .map_or(c"[BOGUS UErrorCode]", |name| name)
    }
}

pub(crate) const U_USING_DEFAULT_WARNING: UErrorCode = UErrorCode(-127);
pub(crate) const U_STRING_NOT_TERMINATED_WARNING: UErrorCode = UErrorCode(-124);
pub(crate) const U_ZERO_ERROR: UErrorCode = UErrorCode(0);
pub(crate) const U_ILLEGAL_ARGUMENT_ERROR: UErrorCode = UErrorCode(1);
pub(crate) const U_MISSING_RESOURCE_ERROR: UErrorCode = UErrorCode(2);
pub(crate) const U_INVALID_FORMAT_ERROR: UErrorCode = UErrorCode(3);
pub(crate) const U_FILE_ACCESS_ERROR: UErrorCode = UErrorCode(4);
pub(crate) const U_INTERNAL_PROGRAM_ERROR: UErrorCode = UErrorCode(5);
pub(crate) const U_MEMORY_ALLOCATION_ERROR: UErrorCode = UErrorCode(7);
pub(crate) const U_INDEX_OUTOFBOUNDS_ERROR: UErrorCode = UErrorCode(8);
pub(crate) const U_PARSE_ERROR: UErrorCode = UErrorCode(9);
pub(crate) const U_INVALID_CHAR_FOUND: UErrorCode = UErrorCode(10);
pub(crate) const U_BUFFER_OVERFLOW_ERROR: UErrorCode = UErrorCode(15);
pub(crate) const U_UNSUPPORTED_ERROR: UErrorCode = UErrorCode(16);
pub(crate) const U_RESOURCE_TYPE_MISMATCH: UErrorCode = UErrorCode(17);
pub(crate) const U_TOO_MANY_ALIASES_ERROR: UErrorCode = UErrorCode(24);
pub(crate) const U_INVARIANT_CONVERSION_ERROR: UErrorCode = UErrorCode(26);
pub(crate) const U_INVALID_STATE_ERROR: UErrorCode = UErrorCode(27);
pub(crate) const U_COLLATOR_VERSION_MISMATCH: UErrorCode = UErrorCode(28);
pub(crate) const U_INPUT_TOO_LONG_ERROR: UErrorCode = UErrorCode(31);
pub(crate) const U_UNQUOTED_SPECIAL: UErrorCode = UErrorCode(65555);
pub(crate) const U_ILLEGAL_CHARACTER: UErrorCode = UErrorCode(65567);
pub(crate) const U_UNEXPECTED_TOKEN: UErrorCode = UErrorCode(65792);
pub(crate) const U_PATTERN_SYNTAX_ERROR: UErrorCode = UErrorCode(65799);
pub(crate) const U_DECIMAL_NUMBER_SYNTAX_ERROR: UErrorCode = UErrorCode(65808);

// ICU4C: utypes.cpp, _uErrorName
static STANDARD_NAMES: &[&CStr] = &[
    c"U_ZERO_ERROR",
    c"U_ILLEGAL_ARGUMENT_ERROR",
    c"U_MISSING_RESOURCE_ERROR",
    c"U_INVALID_FORMAT_ERROR",
    c"U_FILE_ACCESS_ERROR",
    c"U_INTERNAL_PROGRAM_ERROR",
    c"U_MESSAGE_PARSE_ERROR",
    c"U_MEMORY_ALLOCATION_ERROR",
    c"U_INDEX_OUTOFBOUNDS_ERROR",
    c"U_PARSE_ERROR",
    c"U_INVALID_CHAR_FOUND",
    c"U_TRUNCATED_CHAR_FOUND",
    c"U_ILLEGAL_CHAR_FOUND",
    c"U_INVALID_TABLE_FORMAT",
    c"U_INVALID_TABLE_FILE",
    c"U_BUFFER_OVERFLOW_ERROR",
    c"U_UNSUPPORTED_ERROR",
    c"U_RESOURCE_TYPE_MISMATCH",
    c"U_ILLEGAL_ESCAPE_SEQUENCE",
    c"U_UNSUPPORTED_ESCAPE_SEQUENCE",
    c"U_NO_SPACE_AVAILABLE",
    c"U_CE_NOT_FOUND_ERROR",
    c"U_PRIMARY_TOO_LONG_ERROR",
    c"U_STATE_TOO_OLD_ERROR",
    c"U_TOO_MANY_ALIASES_ERROR",
    c"U_ENUM_OUT_OF_SYNC_ERROR",
    c"U_INVARIANT_CONVERSION_ERROR",
    c"U_INVALID_STATE_ERROR",
    c"U_COLLATOR_VERSION_MISMATCH",
    c"U_USELESS_COLLATOR_ERROR",
    c"U_NO_WRITE_PERMISSION",
    c"U_INPUT_TOO_LONG_ERROR",
];
