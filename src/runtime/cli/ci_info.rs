// A modified port of ci-info@4.0.0 (https://github.com/watson/ci-info)
// Only gets the CI name, `isPR` is not implemented.
// Table maintained in `ci_info_generated` below

use bun_core::env_var;
// The CI table in `cli::ci_info_generated` mirrors watson/ci-info vendors.json
use super::ci_info_generated as generated;

static DETECT_CI_ONCE: bun_core::Once<Option<&'static [u8]>> =
    <bun_core::Once<Option<&'static [u8]>>>::new();
static IS_CI_ONCE: bun_core::Once<bool> = <bun_core::Once<bool>>::new();

/// returns true if the current process is running in a CI environment
pub(crate) fn is_ci() -> bool {
    IS_CI_ONCE.call(is_ci_uncached)
}

/// returns the CI name, or None if the CI name could not be determined. note that this can be None even if `is_ci` is true.
pub(crate) fn detect_ci_name() -> Option<&'static [u8]> {
    DETECT_CI_ONCE.call(detect_uncached)
}

fn is_ci_uncached() -> bool {
    env_var::CI
        .get()
        .unwrap_or_else(generated::is_ci_uncached_generated)
        || detect_ci_name().is_some()
}

fn detect_uncached() -> Option<&'static [u8]> {
    if env_var::CI.get() == Some(false) {
        return None;
    }
    generated::detect_uncached_generated()
}
