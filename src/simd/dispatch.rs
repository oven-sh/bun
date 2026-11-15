//! Chooses among the copies that the CPU can run. Safety does not depend on it.
use crate::Target;

pub const IS_FOR_TESTS: bool = cfg!(feature = "test_support");

cfg_select! {
    feature = "test_support" => {
        extern crate std;
        use core::cell::Cell;

        std::thread_local!(static LIMIT: Cell<u8> = const { Cell::new(0) });

        /// Makes this thread run `target`, or the best copy below it.
        pub fn limit_to(target: Target) {
            LIMIT.set(target as u8);
        }

        fn limit() -> u8 {
            LIMIT.get()
        }
    }
    _ => {
        use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

        static LIMIT: AtomicU8 = AtomicU8::new(0);

        /// Rules out the targets above `target`, for exports that have not been called yet.
        pub fn limit_to(target: Target) {
            LIMIT.store(target as u8, Relaxed);
        }

        fn limit() -> u8 {
            LIMIT.load(Relaxed)
        }
    }
}

/// No target below it needs a copy.
pub const fn is_floor(target: Target) -> bool {
    !IS_FOR_TESTS && target.is_in_build()
}

/// The CPU makes no difference.
pub const fn is_direct(best_first: &[Target]) -> bool {
    match best_first {
        [best, ..] => is_floor(*best),
        [] => true,
    }
}

pub fn is_allowed(target: Target) -> bool {
    target as u8 >= limit()
}

pub fn is_asked_for(target: Target) -> bool {
    target as u8 == limit()
}

/// The function that `#[export]` adds.
#[doc(hidden)]
#[macro_export]
macro_rules! export {
    (
        native[$($is_wanted:ident ($cfg:meta) $Target:ident $module:ident $features:tt)*]
        portable_for_tests[$($Portable:ident $portable:ident)*]
        $(#[$meta:meta])* $vis:vis fn $name:ident $(<$($life:lifetime),+>)?
        ($($arg:ident: $ty:ty),* $(,)?) $(-> $ret:ty)?
    ) => {
        $(#[$meta])*
        #[inline(always)]
        $vis fn $name $(<$($life),+>)? ($($arg: $ty),*) $(-> $ret)? {
            type __Kernel = $(for<$($life),+>)? fn($($ty),*) $(-> $ret)?;

            // rustc generates no code for a branch that a constant rules out.
            #[inline(always)]
            fn __choose() -> __Kernel {
                use $crate::{Target, dispatch::*};
                $(
                    if is_asked_for(Target::$Portable) {
                        return $portable::$name;
                    }
                )*
                $(
                    #[cfg($cfg)]
                    if (const { is_floor(Target::$Target) } || $is_wanted(Target::$Target))
                        && let Some(kernel) =
                            $crate::if_supported!($features, __Kernel, $module::$name)
                    {
                        return kernel;
                    }
                )*
                if const { $(is_floor(Target::$Target))||* } {
                    unreachable!()
                } else {
                    portable::$name
                }
            }

            if const {
                use $crate::{Target, dispatch::*};
                IS_FOR_TESTS || is_direct(&[$(#[cfg($cfg)] Target::$Target),*])
            } {
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
