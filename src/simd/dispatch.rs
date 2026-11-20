//! Chooses among the copies that the CPU can run. Safety does not depend on it.
use crate::Target;

const IS_FOR_TESTS: bool = cfg!(feature = "test_support");

cfg_select! {
    feature = "test_support" => {
        extern crate std;
        use core::cell::Cell;

        std::thread_local!(static LIMIT: Cell<(u8, u64)> = const { Cell::new((0, 0)) });

        /// Makes this thread run what a CPU with the features of `target` and `more` would.
        pub fn limit_to_with<'a>(target: Target, more: impl IntoIterator<Item = &'a str>) {
            LIMIT.set((target as u8, target.lacks(more)));
        }

        fn limit() -> (u8, u64) {
            LIMIT.get()
        }
    }
    _ => {
        use core::sync::atomic::{AtomicU8, AtomicU64, Ordering::Relaxed};

        static LIMIT: (AtomicU8, AtomicU64) = (AtomicU8::new(0), AtomicU64::new(0));

        /// Rules out what `target` and `more` lack, for exports that have not been called yet.
        pub fn limit_to_with<'a>(target: Target, more: impl IntoIterator<Item = &'a str>) {
            LIMIT.0.store(target as u8, Relaxed);
            LIMIT.1.store(target.lacks(more), Relaxed);
        }

        fn limit() -> (u8, u64) {
            (LIMIT.0.load(Relaxed), LIMIT.1.load(Relaxed))
        }
    }
}

pub fn limit_to(target: Target) {
    limit_to_with(target, []);
}

/// As in `sse4+pclmulqdq`. Ignores a name that starts with no target, and features that the CPU lacks.
pub fn limit_to_named(name: &[u8]) {
    let parts = name.split(|&it| it == b'+');
    let mut parts = parts.map(|it| str::from_utf8(it).unwrap_or_default());
    let (name, mut targets) = (parts.next(), Target::ALL.into_iter());
    if let Some(target) = targets.find(|it| Some(it.name()) == name) {
        limit_to_with(target, parts);
    }
}

/// Nothing below the copy with these features is needed.
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
pub const fn is_floor(features: &[&str]) -> bool {
    use crate::Features;
    !IS_FOR_TESTS && Features::IN_BUILD.contains(Features::named(features))
}

pub const fn is_any(list: &[bool]) -> bool {
    matches!(list, [first, rest @ ..] if *first || is_any(rest))
}

/// There is no choice, or each thread has its own.
pub const fn remembers_nothing(are_floors: &[bool]) -> bool {
    IS_FOR_TESTS || matches!(are_floors, [] | [true, ..])
}

pub fn unreachable() -> ! {
    unreachable!()
}

pub fn is_allowed(target: Target, features: u64) -> bool {
    let (best, lacking) = limit();
    target as u8 >= best && features & lacking == 0
}

pub fn is_asked_for(target: Target, features: u64) -> bool {
    target as u8 == limit().0 && is_allowed(target, features)
}

/// Compiles `run`, and what is inlined into it, a second time for CPUs with BMI1, BMI2 and LZCNT.
#[inline(always)]
pub fn with_bmi2<R, F: FnOnce() -> R>(run: F) -> R {
    #[cfg(target_arch = "x86_64")]
    {
        #[inline(never)]
        #[rustc_align(64)]
        #[target_feature(enable = "bmi1,bmi2,lzcnt")]
        fn bmi2<R, F: FnOnce() -> R>(run: F) -> R {
            run()
        }
        const FEATURES: &[&str] = &["bmi1", "bmi2", "lzcnt"];
        const BITS: u64 = crate::Features::named(FEATURES).bits();
        if (const { is_floor(FEATURES) } || is_allowed(Target::Sse4, BITS))
            && let Some(bmi2) = crate::if_supported!(
                <R, F: FnOnce() -> R> ["bmi1", "bmi2", "lzcnt"], fn(F) -> R, bmi2
            )
        {
            return bmi2(run);
        }
    }
    out_of_line(run)
}

/// In an aligned function, the speed of a loop does not depend on what is linked before it.
#[inline(never)]
#[rustc_align(64)]
pub fn out_of_line<R>(run: impl FnOnce() -> R) -> R {
    run()
}

/// The function that `#[export]` adds. A macro without `$crate` could be the caller's, and get these tokens.
#[doc(hidden)]
#[macro_export]
macro_rules! export {
    (@first $first:path $(, $other:path)?) => {
        $first
    };
    (
        native[$($is_wanted:ident ($cfg:meta) $Target:ident $module:ident $features:tt)*]
        portable_for_tests[$($Portable:ident $portable:ident)*]
        or[$($otherwise:path)?]
        $(#[$meta:meta])* $vis:vis fn $name:ident $(<$($life:lifetime),+>)?
        ($($arg:ident: $ty:ty),* $(,)?) $(-> $ret:ty)?
    ) => {
        $(#[$meta])*
        #[inline(always)]
        $vis fn $name $(<$($life),+>)? ($($arg: $ty),*) $(-> $ret)? {
            type __Kernel = $(for<$($life),+>)? fn($($ty),*) $(-> $ret)?;
            const __ARE_FLOORS: &[bool] = &[$(#[cfg($cfg)] $crate::dispatch::is_floor(&$features)),*];

            // rustc generates no code for a branch that a constant rules out.
            #[inline(always)]
            fn __choose() -> __Kernel {
                $(
                    if $crate::dispatch::is_asked_for($crate::Target::$Portable, 0) {
                        return $portable::$name;
                    }
                )*
                $(
                    #[cfg($cfg)]
                    if (const { $crate::dispatch::is_floor(&$features) }
                        || $crate::dispatch::$is_wanted(
                            $crate::Target::$Target,
                            const { $crate::Features::named(&$features).bits() },
                        ))
                        && let Some(kernel) =
                            $crate::if_supported!($features, __Kernel, $module::$name)
                    {
                        return kernel;
                    }
                )*
                if const { $crate::dispatch::is_any(__ARE_FLOORS) } {
                    $crate::dispatch::unreachable()
                } else {
                    $crate::export!(@first $($otherwise,)? portable::$name)
                }
            }

            if const { $crate::dispatch::remembers_nothing(__ARE_FLOORS) } {
                // Outside of tests, this is a direct call.
                __choose()($($arg),*)
            } else {
                static __CHOSEN: $crate::AtomicFn<__Kernel> = $crate::AtomicFn::new(__first_call);
                #[cold]
                #[inline(never)]
                fn __first_call $(<$($life),+>)? ($($arg: $ty),*) $(-> $ret)? {
                    let chosen = __choose();
                    __CHOSEN.set(chosen);
                    chosen($($arg),*)
                }
                __CHOSEN.get()($($arg),*)
            }
        }
    };
}
