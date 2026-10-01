//! The `jsc_abi_extern!` macro: declare an `extern` block with the JSC
//! calling convention (`"sysv64"` on win-x64, `"C"` elsewhere). Rust forbids
//! non-literal ABI strings, so the cfg-split lives here once instead of being
//! hand-duplicated at each site.

/// Two call shapes:
/// ```ignore
/// jsc_abi_extern! { fn foo(); safe fn bar(); }              // bare body
/// jsc_abi_extern! { #[allow(improper_ctypes)] { fn x(); } } // + outer attrs
/// ```
/// Body tokens pass through verbatim, so `#[link_name = …]`, `safe fn`,
/// `concat!()` link names, and outer-macro metavariables all work.
#[macro_export]
#[doc(hidden)]
macro_rules! jsc_abi_extern {
    ($(#[$outer:meta])* { $($body:tt)* }) => {
        $(#[$outer])*
        #[cfg(all(windows, target_arch = "x86_64"))]
        unsafe extern "sysv64" { $($body)* }
        $(#[$outer])*
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        unsafe extern "C" { $($body)* }
    };
    ($($body:tt)*) => {
        $crate::jsc_abi_extern! { { $($body)* } }
    };
}
