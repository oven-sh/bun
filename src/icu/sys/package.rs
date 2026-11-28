//! The linked package of data.

use bun_icu_format::package::{HEADER_SIZE, Package};

unsafe extern "C" {
    /// `data/package.S`. The tests fill theirs in.
    static mut bun_icu_package: u8;

    safe fn Bun__abortForRemovedLocaleData() -> !;
}

/// Ends with the last item. `--trim` removes the pages after it.
#[inline]
pub(crate) fn linked() -> Package<'static> {
    // SAFETY: the symbol is a package, which has a header, the offsets that it counts, and the items that they lead to.
    let up_to = |end| unsafe { std::slice::from_raw_parts(&raw const bun_icu_package, end) };
    let count = Package::new(up_to(HEADER_SIZE)).count();
    let end = Package::new(up_to(Package::offset_field(count + 1))).offset(count);
    Package::new(up_to(end))
}

#[cold]
pub(crate) fn abort_for_removed_language() -> ! {
    Bun__abortForRemovedLocaleData()
}
