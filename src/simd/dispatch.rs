//! Which of the copies that the CPU can run to take. None of it bears on safety.

macro_rules! targets {
    ($($arch:literal $target:ident)* ; $($portable:ident)*) => {
        /// The best comes first.
        #[allow(non_camel_case_types)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum Target {
            $($target,)*
            $($portable,)*
        }

        impl Target {
            pub const ALL: &[Self] = &[$(Self::$target,)* $(Self::$portable,)*];

            pub fn name(self) -> &'static str {
                [$(stringify!($target),)* $(stringify!($portable),)*][self as usize]
            }

            pub fn is_supported(self) -> bool {
                $(
                    #[cfg(target_arch = $arch)]
                    if self == Self::$target {
                        return crate::gate::$target::is_supported();
                    }
                )*
                matches!(self, $(Self::$portable)|*)
            }
        }
    };
}

targets! {
    "x86_64" avx512_icl "x86_64" avx512_skx "x86_64" avx2 "x86_64" sse4 "aarch64" neon;
    portable64 portable32 portable
}

cfg_select! {
    feature = "test_support" => {
        extern crate std;

        std::thread_local!(static LIMIT: core::cell::Cell<u8> = const { core::cell::Cell::new(0) });

        /// From now on, this thread runs `target`, or the best below it that an export has.
        pub fn limit_to(target: Target) {
            LIMIT.set(target as u8);
        }

        impl Target {
            #[doc(hidden)]
            pub fn is_allowed(self) -> bool {
                self as u8 >= LIMIT.get()
            }

            #[doc(hidden)]
            pub fn is_asked_for(self) -> bool {
                self as u8 == LIMIT.get()
            }
        }

        #[doc(hidden)]
        #[macro_export]
        macro_rules! for_tests {
            ($($code:tt)*) => { $($code)* };
        }

        #[doc(hidden)]
        #[macro_export]
        macro_rules! is_in_build {
            ($target:ident) => {
                false
            };
        }

        #[doc(hidden)]
        #[macro_export]
        macro_rules! call_chosen {
            ($choose:ident($($arg:ident: $ty:ty),*) $(-> $ret:ty)?) => { $choose()($($arg),*) };
        }
    }
    _ => {
        use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

        static LIMIT: AtomicU8 = AtomicU8::new(0);

        /// Leaves out the targets above `target` that are not in the build, in exports not yet called.
        pub fn limit_to(target: Target) {
            LIMIT.store(target as u8, Relaxed);
        }

        impl Target {
            #[doc(hidden)]
            pub fn is_allowed(self) -> bool {
                self as u8 >= LIMIT.load(Relaxed)
            }
        }

        #[doc(hidden)]
        #[macro_export]
        macro_rules! for_tests {
            ($($code:tt)*) => {};
        }

        #[doc(hidden)]
        #[macro_export]
        macro_rules! is_in_build {
            ($target:ident) => {
                $crate::gate::$target::IS_IN_BUILD
            };
        }

        #[doc(hidden)]
        #[macro_export]
        macro_rules! call_chosen {
            ($choose:ident($($arg:ident: $ty:ty),*) $(-> $ret:ty)?) => {{
                static CHOSEN: $crate::AtomicFn<fn($($ty),*) $(-> $ret)?> =
                    $crate::AtomicFn::new(first_call);
                #[cold]
                #[inline(never)]
                fn first_call($($arg: $ty),*) $(-> $ret)? {
                    let chosen = $choose();
                    CHOSEN.set(chosen);
                    chosen($($arg),*)
                }
                CHOSEN.get()($($arg),*)
            }};
        }
    }
}

#[doc(hidden)]
#[macro_export]
macro_rules! export {
    (
        best[$($best:ident)*]
        all[$($arch:literal $target:ident)*]
        on_request[$($other_arch:literal $other:ident)*]
        $(#[$meta:meta])* $vis:vis fn $name:ident($($arg:ident: $ty:ty),* $(,)?) $(-> $ret:ty)?
    ) => {
        $(#[$meta])*
        #[inline(always)]
        $vis fn $name($($arg: $ty),*) $(-> $ret)? {
            type F = fn($($ty),*) $(-> $ret)?;
            #[inline(always)]
            fn choose() -> F {
                $crate::for_tests! {
                    $(
                        #[cfg(target_arch = $other_arch)]
                        if $crate::Target::$other.is_asked_for()
                            && let Some(f) = $crate::if_supported!($other, F, $other::$name)
                        {
                            return f;
                        }
                    )*
                    if $crate::Target::portable64.is_asked_for() {
                        return portable64::$name;
                    } else if $crate::Target::portable32.is_asked_for() {
                        return portable32::$name;
                    }
                }
                $(
                    #[cfg(target_arch = $arch)]
                    if ($crate::is_in_build!($target) || $crate::Target::$target.is_allowed())
                        && let Some(f) = $crate::if_supported!($target, F, $target::$name)
                    {
                        return f;
                    }
                )*
                // rustc generates no code for the branch that a constant rules out.
                if const { $($crate::is_in_build!($target))||* } {
                    unreachable!()
                } else {
                    portable::$name
                }
            }

            if const { $($crate::is_in_build!($best))||* } {
                // Nothing to choose: this comes out as a direct call.
                choose()($($arg),*)
            } else {
                $crate::call_chosen!(choose($($arg: $ty),*) $(-> $ret)?)
            }
        }
    };
}
