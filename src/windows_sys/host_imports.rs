//! The import table of the portable image.
//!
//! The image is linked for Linux and has no import table of its own for Windows. What an `extern` block
//! declares in a build for Windows is, in the image, one [`Import`] for each function that is called: its
//! library, its symbol, and the address the host's resolver found. The entries are one array, the section
//! `bun_imports`.
//!
//! An entry is bound when it is first called. Binding everything at start would load every DLL a binding
//! names (`ws2_32`, `advapi32`, ...) into a process that may only print its version. [`bind_all`] does it
//! on request, which is how a host is checked against the bindings.
//!
//! A call that cannot be bound does not return: the image runs on a host that is not Windows, the host has
//! no resolver, or this Windows does not export the symbol. A host that is not Windows resolves nothing,
//! except the test host on Linux, which has a library of its own for the tests of this table.

use core::ffi::{CStr, c_char, c_ulong, c_void};
use core::sync::atomic::{AtomicPtr, Ordering};

unsafe extern "C" {
    /// The C library of the image: the entry `lookup` of the host table, null without one.
    fn __bun_host_lookup(library: *const c_char, symbol: *const c_char) -> *mut c_void;
    /// The C library of the image: 1 Linux, 2 Windows, 3 macOS.
    safe fn __bun_host_os() -> c_ulong;
}

const HOST_WINDOWS: c_ulong = 2;

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
    /// The host OS is not Windows: its number as `__bun_host_os` gives it.
    HostIsNotWindows(u64),
    /// The library is not on this system, or it does not export the symbol, or the host has no resolver.
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
            return Err(if host == HOST_WINDOWS {
                Unbound::NotFound
            } else {
                Unbound::HostIsNotWindows(host as u64)
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
            Err(Unbound::HostIsNotWindows(host)) => panic!(
                "{}!{} is a function of Windows, and this host is {}",
                self.library().to_str().unwrap_or("?"),
                self.symbol().to_str().unwrap_or("?"),
                match host {
                    1 => "Linux",
                    3 => "macOS",
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
#[unsafe(link_section = "bun_imports")]
static FIRST: Import = Import::new(b"\0", b"\0");

/// Every import of the image that the linker kept: the ones a function that was linked can call.
pub fn all() -> impl Iterator<Item = &'static Import> {
    unsafe extern "C" {
        static __start_bun_imports: Import;
        static __stop_bun_imports: Import;
    }
    // SAFETY: the linker defines both for a section whose name is a C identifier: its first byte and the
    // byte after its last. The section holds `Import`s only, each one written by `#[imports]` or above.
    let table = unsafe {
        let start = &raw const __start_bun_imports;
        let stop = &raw const __stop_bun_imports;
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
