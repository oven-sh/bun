//! Code that has one definition for each OS, in a build that has them all.
//!
//! A build for one OS picks a definition with `cfg`. The portable image (`cfg(bun_portable)`) is compiled
//! once, for a Linux target, and runs on Linux, macOS and Windows: it holds every definition and picks with
//! [`crate::host`] when it runs.
//!
//! In a build for one OS every pattern below is, token for token, the `cfg` it stands for: the attribute
//! macros are `cfg_attr(bun_portable, ..)` and do not exist there, and the macros of this module expand to
//! the attributes and the code that were written before them, with nothing around them. The macros are at
//! the root of the crate; this module is the portable image's.
//! `misctools/portable/tools/compare-asm.ts --mode expanded` compares exactly that.
//!
//! | what                    | how                                                                       |
//! | ----------------------- | ------------------------------------------------------------------------- |
//! | a function, a method    | `#[cfg_attr(bun_portable, bun_portable_macros::host_os(..))]` on each      |
//! |                         | definition; the last one adds `dispatch(..)`                               |
//! | two modules of the same | [`host_dispatch!`](crate::host_dispatch!) lists the functions both have    |
//! | functions               |                                                                            |
//! | blocks in a body        | [`host_select!`](crate::host_select), where statements are                 |
//! | a `let`                 | [`host_let!`](crate::host_let)                                             |
//! | `cfg!(..)` in a         | [`host_cfg!`](crate::host_cfg)                                             |
//! | condition               |                                                                            |
//! | an expression the image | `cfg_select! { bun_portable => { .. } _ => { .. } }`, which leaves the     |
//! | writes in another way   | tokens of one arm and nothing else                                         |
//! | a type                  | one type that holds what either OS needs (`Fd`, `bun_sys::Stat`); the     |
//! |                         | definition for one OS keeps its name inside of the code for that OS        |
//! |                         | (`bun_portable_macros::flavor`, `bun_sys::flavor`)                        |

/// Called by a function that has no definition for the OS of this host.
#[cold]
#[inline(never)]
pub fn no_definition_for_this_host(function: &'static str) -> ! {
    panic!(
        "{function} has no definition for this host ({})",
        crate::host::name()
    )
}
