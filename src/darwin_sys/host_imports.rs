//! The import table of the portable image for macOS.
//!
//! The image is linked for Linux and has no import table of its own for macOS. What an `extern` block
//! declares in a build for macOS is, in the image, one [`Import`] for each function that is called: its
//! library, its symbol, and the address that the host found (`dlsym`). The entries are one array, the
//! section `bun_imports_macos`; the functions of Windows have their own (`bun_windows_sys::host_imports`),
//! so a host is asked for the functions of its own system only.
//!
//! An entry is bound when it is first called. [`bind_all`] binds every one, which is how a host is
//! checked against the bindings.
//!
//! A call that cannot be bound does not return: the image runs on a host that is not macOS, or this
//! macOS does not have the symbol.

use core::ffi::{CStr, c_char, c_int, c_ulong, c_void};
use core::sync::atomic::{AtomicPtr, Ordering};

unsafe extern "C" {
    /// The C library of the image: the entry `lookup` of the host table, null without one.
    fn __bun_host_lookup(library: *const c_char, symbol: *const c_char) -> *mut c_void;
    /// The C library of the image: 1 Linux, 2 Windows, 3 macOS.
    safe fn __bun_host_os() -> c_ulong;
    /// The C library of the image: where the error number of this thread is.
    safe fn __errno_location() -> *mut c_int;
}

const HOST_MACOS: c_ulong = 3;

#[repr(C)]
pub struct Import {
    address: AtomicPtr<c_void>,
    library: *const c_char,
    symbol: *const c_char,
}

// SAFETY: `library` and `symbol` point at string literals, and `address` is atomic.
unsafe impl Sync for Import {}

/// Why an import has no address.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Unbound {
    /// The host OS is not macOS: its number as `__bun_host_os` gives it.
    HostIsNotMacos(u64),
    /// This macOS does not have the symbol, or the host has no function of its own for it.
    NotFound,
}

impl Import {
    /// `library` and `symbol` end with a NUL.
    pub const fn new(library: &'static [u8], symbol: &'static [u8]) -> Import {
        assert!(matches!(library.last(), Some(0)) && matches!(symbol.last(), Some(0)));
        Import {
            address: AtomicPtr::new(core::ptr::null_mut()),
            library: library.as_ptr().cast(),
            symbol: symbol.as_ptr().cast(),
        }
    }

    pub fn library(&self) -> &'static CStr {
        // SAFETY: `new` checked the terminator of a `'static` slice.
        unsafe { CStr::from_ptr(self.library) }
    }

    pub fn symbol(&self) -> &'static CStr {
        // SAFETY: `new` checked the terminator of a `'static` slice.
        unsafe { CStr::from_ptr(self.symbol) }
    }

    /// The address of the function. Does not return if there is none.
    #[inline(always)]
    pub fn address(&self) -> *mut c_void {
        let address = self.address.load(Ordering::Relaxed);
        if address.is_null() {
            return self.bind_or_stop();
        }
        address
    }

    /// Asks the host. Two threads that ask at once store the same address.
    pub fn bind(&self) -> Result<*mut c_void, Unbound> {
        let address = self.address.load(Ordering::Relaxed);
        if !address.is_null() {
            return Ok(address);
        }
        // SAFETY: both are NUL-terminated strings that live as long as the image.
        let address = unsafe { __bun_host_lookup(self.library, self.symbol) };
        if address.is_null() {
            let host = __bun_host_os();
            return Err(if host == HOST_MACOS {
                Unbound::NotFound
            } else {
                Unbound::HostIsNotMacos(host as u64)
            });
        }
        self.address.store(address, Ordering::Relaxed);
        Ok(address)
    }

    #[cold]
    #[inline(never)]
    fn bind_or_stop(&self) -> *mut c_void {
        match self.bind() {
            Ok(address) => address,
            Err(Unbound::HostIsNotMacos(host)) => panic!(
                "{}!{} is a function of macOS, and this host is {}",
                self.library().to_str().unwrap_or("?"),
                self.symbol().to_str().unwrap_or("?"),
                match host {
                    1 => "Linux",
                    2 => "Windows",
                    _ => "unknown",
                },
            ),
            Err(Unbound::NotFound) => panic!(
                "{}!{} was not found by the host of the image",
                self.library().to_str().unwrap_or("?"),
                self.symbol().to_str().unwrap_or("?"),
            ),
        }
    }
}

/// Keeps the section, and with it the two symbols the linker makes for it, in an image that calls no import.
#[used]
#[unsafe(link_section = "bun_imports_macos")]
static FIRST: Import = Import::new(b"\0", b"\0");

/// Every import of the image that the linker kept: the ones a function that was linked can call.
pub fn all() -> impl Iterator<Item = &'static Import> {
    unsafe extern "C" {
        static __start_bun_imports_macos: Import;
        static __stop_bun_imports_macos: Import;
    }
    // SAFETY: the linker defines both for a section whose name is a C identifier: its first byte and the
    // byte after its last. The section holds `Import`s only, each one written by `#[imports]` or here.
    let table = unsafe {
        let start = &raw const __start_bun_imports_macos;
        let stop = &raw const __stop_bun_imports_macos;
        core::slice::from_raw_parts(start, stop.offset_from(start) as usize)
    };
    table.iter().filter(|import| !import.symbol().is_empty())
}

/// Binds every import, and calls `missing` for each one that has no address.
pub fn bind_all(mut missing: impl FnMut(&'static Import, Unbound)) {
    for import in all() {
        if let Err(why) = import.bind() {
            missing(import, why);
        }
    }
}

/// `int *__error(void)`: where the C library of macOS keeps the error number of this thread.
#[unsafe(link_section = "bun_imports_macos")]
static ERROR_NUMBER: Import = Import::new(b"libSystem\0", b"__error\0");

/// The error number of macOS's C library, as that library has it.
#[inline]
pub fn error_number_of_macos() -> *mut c_int {
    // SAFETY: `__error` takes nothing and returns the address of an `int` of this thread.
    unsafe {
        core::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> *mut c_int>(
            ERROR_NUMBER.address(),
        )()
    }
}

/// Calls a function of macOS, and makes the error number it set the error number of the image: the one
/// number that bun reads after a call (`bun_sys::last_errno`), in the numbers of the image. A function
/// that sets none leaves the error number of the image as it is.
#[inline(always)]
pub fn keep_errno<R>(call: impl FnOnce() -> R) -> R {
    let of_macos = error_number_of_macos();
    // SAFETY: the address of an `int` of this thread, which nothing else holds during this function.
    unsafe { of_macos.write(0) };
    let result = call();
    // SAFETY: as above.
    let error = unsafe { of_macos.read() };
    if error != 0 {
        // SAFETY: the address of the error number of this thread.
        unsafe { __errno_location().write(crate::errno::to_image(error)) };
    }
    result
}
