//! ESLint's `lib/rules/utils/regular-expressions.js`.

use crate::regex::Regex;

/// ESLint's `REGEXPP_LATEST_ECMA_VERSION`.
pub const REGEXPP_LATEST_ECMA_VERSION: u32 = 2025;

/// The `flag` of [`is_valid_with_unicode_flag`].
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum UnicodeFlag {
    #[default]
    U,
    V,
}

/// ESLint's `isValidWithUnicodeFlag`. Whether `pattern` is valid with the flag `u` or `v`. It is not
/// if `ecma_version`, which is `file.language().ecma_version`, does not have the flag. Upstream's
/// default for `flag` is `u`.
pub fn is_valid_with_unicode_flag(ecma_version: u32, pattern: &[u8], flag: UnicodeFlag) -> bool {
    let (first_version, flags) = match flag {
        UnicodeFlag::U => (2015, "u"),
        UnicodeFlag::V => (2024, "v"),
    };
    ecma_version >= first_version && Regex::new(&String::from_utf8_lossy(pattern), flags).is_ok()
}
