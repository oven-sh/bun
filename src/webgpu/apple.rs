//! macOS: the system frameworks of wgpu's Metal backend, bound on first use.
//!
//! The objc2 crates under wgpu-hal import a handful of C functions and
//! constants from Metal, CoreFoundation, CoreGraphics and Foundation. Linking
//! those frameworks would load them into every Bun process, and
//! CoreFoundation's initializer has side effects: among other things it adds
//! `__CF_USER_TEXT_ENCODING` to the environment, which then shows up in
//! `process.env` and in every child process.
//!
//! Mach-O has no delay-load, so this file is the delay-load: it defines those
//! symbols itself. The functions forward to the real ones, found with `dlsym`
//! in frameworks that [`load`] `dlopen`s when `navigator.gpu` is first used.
//! The constants are copied over at the same moment. Objective-C classes and
//! selectors need nothing: objc2 looks them up by name in the runtime, and
//! libobjc is already part of every process through libSystem.
//!
//! The list is exactly what `nm -u` shows for the Metal backend. A wgpu
//! upgrade that imports one more symbol fails the darwin link with that
//! symbol's name, which is the cue to add it here.
#![allow(non_snake_case, non_upper_case_globals, clippy::missing_safety_doc)]

use core::ffi::{CStr, c_void};
use std::sync::OnceLock;

use bun_core::zstr;

/// `symbol_name!(CFRetain)` is `c"CFRetain"`.
macro_rules! symbol_name {
    ($name:ident) => {
        const {
            match CStr::from_bytes_with_nul(concat!(stringify!($name), "\0").as_bytes()) {
                Ok(name) => name,
                Err(_) => unreachable!(),
            }
        }
    };
}

#[derive(Copy, Clone)]
struct Framework(*mut c_void);

impl Framework {
    fn open(path: &bun_core::ZStr) -> Option<Self> {
        bun_sys::dlopen(path, bun_sys::RTLD::LAZY | bun_sys::RTLD::LOCAL).map(Self)
    }

    /// Looks `name` up in this framework and the libraries it depends on. The
    /// lookup cannot land on the definitions below, which live in the executable.
    fn symbol<T>(self, name: &CStr) -> Option<T> {
        const { assert!(size_of::<T>() == size_of::<*mut c_void>()) };
        // SAFETY: `self.0` is a live `dlopen` handle (never closed) and `name` is NUL-terminated.
        let address = unsafe { bun_sys::c::dlsym(self.0, name.as_ptr()) };
        if address.is_null() {
            return None;
        }
        // SAFETY: `dlsym` yields an untyped, non-null address. Every caller names `T` as the
        // pointer type that matches the system's declaration of `name`: an `extern "C"`
        // function pointer in `forward!`, a pointer to a pointer-sized constant in
        // `constants!`. The assert above rules out any other size.
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&address) })
    }
}

struct Frameworks {
    CoreFoundation: Framework,
    CoreGraphics: Framework,
    Foundation: Framework,
    Metal: Framework,
}

impl Frameworks {
    fn open() -> Option<Self> {
        Some(Self {
            CoreFoundation: Framework::open(zstr!(
                "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
            ))?,
            CoreGraphics: Framework::open(zstr!(
                "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
            ))?,
            Foundation: Framework::open(zstr!(
                "/System/Library/Frameworks/Foundation.framework/Foundation"
            ))?,
            Metal: Framework::open(zstr!("/System/Library/Frameworks/Metal.framework/Metal"))?,
        })
    }
}

/// Declares the forwarded functions: one table entry and one exported
/// definition under the system's name for each.
macro_rules! forward {
    ($( $framework:ident :: fn $name:ident ( $($arg:ident : $ty:ty),* ) $(-> $ret:ty)? ; )+) => {
        struct Functions {
            $( $name: unsafe extern "C" fn($($ty),*) $(-> $ret)?, )+
        }

        impl Functions {
            fn resolve(frameworks: &Frameworks) -> Option<Self> {
                Some(Self {
                    $( $name: frameworks.$framework.symbol(symbol_name!($name))?, )+
                })
            }
        }

        $(
            #[unsafe(no_mangle)]
            unsafe extern "C" fn $name($($arg: $ty),*) $(-> $ret)? {
                // SAFETY: the caller upholds `$name`'s own contract; this only forwards.
                unsafe { (functions().$name)($($arg),*) }
            }
        )+
    };
}

forward! {
    CoreFoundation::fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    CoreFoundation::fn CFDataGetLength(data: *const c_void) -> isize;
    CoreFoundation::fn CFDateCreate(allocator: *const c_void, at: f64) -> *const c_void;
    CoreFoundation::fn CFDateGetAbsoluteTime(date: *const c_void) -> f64;
    CoreFoundation::fn CFGetRetainCount(cf: *const c_void) -> isize;
    CoreFoundation::fn CFRelease(cf: *const c_void);
    CoreFoundation::fn CFRetain(cf: *const c_void) -> *const c_void;
    CoreFoundation::fn CFURLGetFileSystemRepresentation(url: *const c_void, resolve_against_base: u8, buffer: *mut u8, capacity: isize) -> u8;
    CoreFoundation::fn CFURLGetString(url: *const c_void) -> *const c_void;
    CoreGraphics::fn CGColorSpaceCreateWithName(name: *const c_void) -> *mut c_void;
    Metal::fn MTLCopyAllDevices() -> *mut c_void;
}

/// `CFTimeInterval` between 1970 and 2001. A plain number in CoreFoundation too.
#[unsafe(no_mangle)]
static kCFAbsoluteTimeIntervalSince1970: f64 = 978_307_200.0;

/// Declares the forwarded object constants (`NSString * const`,
/// `CFStringRef const`): null until [`load`] copies the system's values in.
macro_rules! constants {
    ($( $framework:ident :: $name:ident ; )+) => {
        $(
            #[unsafe(no_mangle)]
            static mut $name: *const c_void = core::ptr::null();
        )+

        fn copy_constants(frameworks: &Frameworks) -> Option<()> {
            $(
                let theirs: *const *const c_void = frameworks.$framework.symbol(symbol_name!($name))?;
                // SAFETY: `theirs` is the system's `$name`, an initialized pointer-sized
                // constant. The write happens once, inside `FUNCTIONS`' initializer, and
                // Metal code (the only reader) runs only after that has returned.
                unsafe { $name = theirs.read() };
            )+
            Some(())
        }
    };
}

constants! {
    Foundation::NSKeyValueChangeNewKey;
    Foundation::NSLocalizedDescriptionKey;
    CoreGraphics::kCGColorSpaceDisplayP3;
    CoreGraphics::kCGColorSpaceExtendedLinearSRGB;
    CoreGraphics::kCGColorSpaceExtendedSRGB;
}

static FUNCTIONS: OnceLock<Option<Functions>> = OnceLock::new();

fn functions() -> &'static Functions {
    // `instance()` enables the Metal backend only after `load()` returned true.
    FUNCTIONS
        .get()
        .and_then(Option::as_ref)
        .expect("the Metal backend ran before its frameworks were loaded")
}

/// Loads the frameworks and binds the symbols above. Returns `false` if any of
/// it is missing, in which case the Metal backend must not be used.
pub(crate) fn load() -> bool {
    FUNCTIONS
        .get_or_init(|| {
            let frameworks = Frameworks::open()?;
            copy_constants(&frameworks)?;
            Functions::resolve(&frameworks)
        })
        .is_some()
}
