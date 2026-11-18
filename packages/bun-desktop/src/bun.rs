//! What Bun lends to the library.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::OnceLock;

#[path = "../../../src/runtime/desktop/host_abi.rs"]
pub mod abi;

static HOST: OnceLock<&'static abi::Host> = OnceLock::new();

/// Before everything else.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_set_host(host: &'static abi::Host) {
    HOST.set(host).ok();
}

pub fn host() -> &'static abi::Host {
    HOST.get().expect("Bun has set it")
}

/// What `call` passes to the sink, if it succeeds.
pub fn collect(call: impl FnOnce(abi::Sink, *mut c_void) -> bool) -> Option<Vec<u8>> {
    unsafe extern "C" fn sink(context: *mut c_void, bytes: *const u8, len: usize) {
        // SAFETY: `context` is the vector below, and the rest is the contract of `Sink`.
        unsafe {
            (*context.cast::<Vec<u8>>()).extend_from_slice(std::slice::from_raw_parts(bytes, len))
        };
    }
    let mut bytes = Vec::new();
    call(sink, (&raw mut bytes).cast()).then_some(bytes)
}

pub struct Inflater(NonNull<c_void>);

impl Inflater {
    pub fn new() -> Option<Inflater> {
        NonNull::new((host().inflate_begin)()).map(Inflater)
    }

    /// How much was read and written, and whether that was all.
    pub fn inflate(&mut self, input: &[u8], output: &mut [u8]) -> Option<(usize, usize, bool)> {
        let (mut read, mut written) = (input.len(), output.len());
        // SAFETY: live slices with their lengths.
        let status = unsafe {
            (host().inflate)(
                self.0.as_ptr(),
                input.as_ptr(),
                &raw mut read,
                output.as_mut_ptr(),
                &raw mut written,
            )
        };
        (status >= 0).then_some((read, written, status > 0))
    }
}

impl Drop for Inflater {
    fn drop(&mut self) {
        // SAFETY: it came from `inflate_begin`.
        unsafe { (host().inflate_end)(self.0.as_ptr()) };
    }
}

/// How much was written.
pub fn decode_brotli(input: &[u8], output: &mut [u8]) -> usize {
    // SAFETY: live slices with their lengths.
    unsafe {
        (host().decode_brotli)(
            input.as_ptr(),
            input.len(),
            output.as_mut_ptr(),
            output.len(),
        )
    }
}

pub fn crc32(bytes: &[u8]) -> u32 {
    // SAFETY: a live slice with its length.
    unsafe { (host().crc32)(bytes.as_ptr(), bytes.len()) }
}
