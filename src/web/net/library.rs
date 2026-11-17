/// The symbols of a library of the system, which is opened when it is needed.
macro_rules! library {
    ($library:ident $path:literal $([$($constant:ident)*])? $($name:ident: fn($($argument:ty),*) $(-> $result:ty)?;)*) => {
        #[allow(non_snake_case)]
        struct $library {
            $($name: unsafe extern "C" fn($($argument),*) $(-> $result)?,)*
            $($($constant: &'static Constant,)*)?
            _opened: bun_sys::DynLib,
        }

        impl $library {
            fn open() -> Option<$library> {
                // SAFETY: a library of the system, whose headers have these types. `_opened` keeps it loaded.
                unsafe {
                    let opened = bun_sys::DynLib::open($path).ok()?;
                    Some($library {
                        $($name: opened.lookup_as(ZStr::from_slice_with_nul(concat!(stringify!($name), "\0").as_bytes()))?,)*
                        $($($constant: opened.lookup_as(ZStr::from_slice_with_nul(concat!(stringify!($constant), "\0").as_bytes()))?,)*)?
                        _opened: opened,
                    })
                }
            }
        }
    };
}

pub(super) use library;
