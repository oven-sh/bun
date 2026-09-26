//! Code that has one definition for each OS, in a build that has them all.
//!
//! A build for one OS picks a definition with `cfg`. The portable image (`cfg(bun_portable)`) is compiled
//! once, for a Linux target, and runs on Linux, macOS and Windows: it holds every definition and picks with
//! [`crate::host`] when it runs. Each pattern below is, in a build for one OS, the `cfg` it replaces.
//!
//! | what                    | how                                                                       |
//! | ----------------------- | ------------------------------------------------------------------------- |
//! | a function, a method    | `#[cfg_attr(bun_portable, bun_portable_macros::host_os(..))]` on each      |
//! |                         | definition; the last one adds `dispatch(..)`                               |
//! | two modules of the same | [`host_dispatch!`] lists the functions both have                           |
//! | functions               |                                                                            |
//! | blocks in a body        | [`host_select!`]                                                           |
//! | a constant              | [`host_const!`]: the constant, and a function that every build has         |
//! | a type                  | one type that holds what either OS needs (`Fd`), or one alias for each     |
//! |                         | flavour of the code (`bun_core::flavor`)                                   |

/// Called by a function that has no definition for the OS of this host.
#[cold]
#[inline(never)]
pub fn no_definition_for_this_host(function: &'static str) -> ! {
    panic!(
        "{function} has no definition for this host ({})",
        crate::host::os().name_string()
    )
}

/// The block for the OS. A build for one OS compiles one block; the portable image compiles the ones
/// for its hosts and runs the one for the host it is on.
///
/// ```ignore
/// bun_core::host_select! {
///     windows => { kernel32_path(path) }
///     posix => { path }
/// }
/// ```
///
/// An arm is named as the `cfg` it stands for: `windows`, `posix` (`not(windows)`), `unix`, `linux`
/// (Linux and Android), `macos`, `freebsd`. The portable image is compiled for Linux: it runs the arm
/// `windows` on a Windows host and the arm `linux`, `posix` or `unix` on every other one, and has no
/// use for the other arms.
#[cfg(not(bun_portable))]
#[macro_export]
macro_rules! host_select {
    ($($os:ident => $block:block)+) => {{
        $( $crate::__host_select_arm! { $os $block } )+
    }};
}

#[cfg(not(bun_portable))]
#[doc(hidden)]
#[macro_export]
macro_rules! __host_select_arm {
    (windows $block:block) => {
        #[cfg(windows)]
        $block
    };
    (posix $block:block) => {
        #[cfg(not(windows))]
        $block
    };
    (unix $block:block) => {
        #[cfg(unix)]
        $block
    };
    (linux $block:block) => {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        $block
    };
    (macos $block:block) => {
        #[cfg(target_os = "macos")]
        $block
    };
    (freebsd $block:block) => {
        #[cfg(target_os = "freebsd")]
        $block
    };
}

#[cfg(bun_portable)]
#[macro_export]
macro_rules! host_select {
    ($($os:ident => $block:block)+) => {
        $crate::__host_select_portable!([] [] $($os => $block)+)
    };
}

#[cfg(bun_portable)]
#[doc(hidden)]
#[macro_export]
macro_rules! __host_select_portable {
    ([$windows:block] [$other:block]) => {
        if $crate::host::is_windows() $windows else $other
    };
    ([$windows:block] []) => {
        if $crate::host::is_windows() $windows else {
            $crate::host_dispatch::no_definition_for_this_host(concat!(file!(), ":", line!()))
        }
    };
    ([] [$other:block]) => {
        if $crate::host::is_windows() {
            $crate::host_dispatch::no_definition_for_this_host(concat!(file!(), ":", line!()))
        } else $other
    };
    ([] [$($other:block)?] windows => $block:block $($rest:tt)*) => {
        $crate::__host_select_portable!([$block] [$($other)?] $($rest)*)
    };
    ([$($windows:block)?] [] linux => $block:block $($rest:tt)*) => {
        $crate::__host_select_portable!([$($windows)?] [$block] $($rest)*)
    };
    ([$($windows:block)?] [] posix => $block:block $($rest:tt)*) => {
        $crate::__host_select_portable!([$($windows)?] [$block] $($rest)*)
    };
    ([$($windows:block)?] [] unix => $block:block $($rest:tt)*) => {
        $crate::__host_select_portable!([$($windows)?] [$block] $($rest)*)
    };
    ([$($windows:block)?] [$($other:block)?] macos => $block:block $($rest:tt)*) => {
        $crate::__host_select_portable!([$($windows)?] [$($other)?] $($rest)*)
    };
    ([$($windows:block)?] [$($other:block)?] freebsd => $block:block $($rest:tt)*) => {
        $crate::__host_select_portable!([$($windows)?] [$($other)?] $($rest)*)
    };
}

/// A constant whose value depends on the OS, and the function that returns it.
///
/// ```ignore
/// bun_core::host_const! {
///     /// The timestamp that means "now" to `futimens`.
///     pub const UTIME_NOW: i64, fn utime_now = { windows => -1, posix => libc::UTIME_NOW };
/// }
/// ```
///
/// A build for one OS has the constant, as it had before, and the function, which is `const` and returns
/// it. The portable image has the function only: what it returns is known when the image runs, so a use
/// of the constant does not compile there and shows where a decision has to move to run time.
///
/// The sets of hosts are the ones of [`host_select!`].
#[cfg(not(bun_portable))]
#[macro_export]
macro_rules! host_const {
    ($(
        $(#[$attribute:meta])*
        $visibility:vis const $name:ident: $ty:ty, fn $function:ident = { $($os:ident => $value:expr),+ $(,)? };
    )+) => {$(
        $crate::__host_const_items! {
            [$(#[$attribute])* $visibility const $name: $ty] $($os => $value),+
        }
        $(#[$attribute])*
        #[inline(always)]
        $visibility const fn $function() -> $ty {
            $name
        }
    )+};
}

#[cfg(not(bun_portable))]
#[doc(hidden)]
#[macro_export]
macro_rules! __host_const_items {
    ([$($declaration:tt)*] windows => $windows:expr, posix => $posix:expr) => {
        #[cfg(windows)]
        $($declaration)* = $windows;
        #[cfg(not(windows))]
        $($declaration)* = $posix;
    };
    ([$($declaration:tt)*] linux => $linux:expr, macos => $macos:expr, windows => $windows:expr) => {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        $($declaration)* = $linux;
        #[cfg(target_os = "macos")]
        $($declaration)* = $macos;
        #[cfg(windows)]
        $($declaration)* = $windows;
    };
}

#[cfg(bun_portable)]
#[macro_export]
macro_rules! host_const {
    ($(
        $(#[$attribute:meta])*
        $visibility:vis const $name:ident: $ty:ty, fn $function:ident = { $($os:ident => $value:expr),+ $(,)? };
    )+) => {$(
        $(#[$attribute])*
        #[inline]
        $visibility fn $function() -> $ty {
            $crate::__host_const_value!($($os => $value),+)
        }
    )+};
}

#[cfg(bun_portable)]
#[doc(hidden)]
#[macro_export]
macro_rules! __host_const_value {
    (windows => $windows:expr, posix => $posix:expr) => {
        if $crate::host::is_windows() { $windows } else { $posix }
    };
    (linux => $linux:expr, macos => $macos:expr, windows => $windows:expr) => {
        if $crate::host::is_windows() {
            $windows
        } else if $crate::host::is_mac() {
            $macos
        } else {
            $linux
        }
    };
}

/// The functions that two modules both define, one module for Windows and one for every other host, as
/// functions of the module that invokes the macro: each calls the module for the host.
///
/// ```ignore
/// #[cfg(bun_portable)]
/// bun_core::host_dispatch! {
///     windows = windows_impl, posix = posix_impl;
///     pub fn close(fd: Fd) -> Maybe<()>;
///     pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize>;
/// }
/// ```
///
/// Only the portable image has two such modules at once. The list is checked against both: a function
/// that one module lacks, or declares with other types, does not compile.
#[cfg(bun_portable)]
#[macro_export]
macro_rules! host_dispatch {
    (
        windows = $windows:path, posix = $posix:path;
        $(
            $(#[$attribute:meta])*
            $visibility:vis fn $name:ident $(<$lifetime:lifetime>)? ($($argument:ident: $ty:ty),* $(,)?) $(-> $result:ty)?;
        )*
    ) => {$(
        $(#[$attribute])*
        #[inline]
        $visibility fn $name $(<$lifetime>)? ($($argument: $ty),*) $(-> $result)? {
            if $crate::host::is_windows() {
                use $windows as for_host;
                for_host::$name($($argument),*)
            } else {
                use $posix as for_host;
                for_host::$name($($argument),*)
            }
        }
    )*};
}
