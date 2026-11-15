//! Maps a writable, copy-on-write copy of read-only bytes of this process's executable.

use core::ffi::c_void;

/// Smaller files are copied.
pub const MIN_MAPPED_BYTES: usize = 1 << 20;
/// What an allocator gives a buffer. `Atomics` on a typed array over the bytes needs it.
pub const ALIGNMENT: usize = 16;

/// `None` if the bytes have to be copied instead.
#[cfg(target_os = "linux")]
pub fn map(bytes: &[u8]) -> Option<core::ptr::NonNull<u8>> {
    use crate::{CloseOnDrop, O};

    // The writer aligns a file of `MIN_MAPPED_BYTES`. Another writer or an older layout may not have.
    let offset = offset_in_executable(bytes).filter(|it| it.is_multiple_of(ALIGNMENT))?;
    let executable =
        crate::open(bun_core::zstr!("/proc/self/exe"), O::RDONLY | O::CLOEXEC, 0).ok()?;
    let _close = CloseOnDrop::new(executable);
    let delta = offset % bun_alloc::page_size();
    let base = crate::mmap(
        core::ptr::null_mut(),
        bytes.len() + delta,
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_PRIVATE,
        executable,
        i64::try_from(offset - delta).ok()?,
    )
    .ok()?;
    core::ptr::NonNull::new(base.wrapping_add(delta))
}

#[cfg(not(target_os = "linux"))]
pub fn map(_bytes: &[u8]) -> Option<core::ptr::NonNull<u8>> {
    None
}

/// A read-only mapping of the executable.
#[cfg(target_os = "linux")]
#[derive(Copy, Clone)]
struct Mapping {
    low: usize,
    high: usize,
    /// Where the byte at `low` lies in the file.
    offset: usize,
}

/// The offset of the bytes in the executable, if a single read-only mapping contains them.
#[cfg(target_os = "linux")]
fn offset_in_executable(bytes: &[u8]) -> Option<usize> {
    // What an executable embeds lies in one section, so the mapping around the first bytes serves the process.
    static MAPPING: std::sync::OnceLock<Mapping> = std::sync::OnceLock::new();
    let mapping = MAPPING.get().copied().or_else(|| {
        let found = find_mapping_around(bytes)?;
        Some(*MAPPING.get_or_init(|| found))
    })?;
    let begin = bytes.as_ptr().addr();
    (mapping.low <= begin && begin + bytes.len() <= mapping.high)
        .then(|| mapping.offset + (begin - mapping.low))
}

#[cfg(target_os = "linux")]
fn find_mapping_around(bytes: &[u8]) -> Option<Mapping> {
    let mut path = bun_paths::path_buffer_pool::get();
    let length = crate::readlink(bun_core::zstr!("/proc/self/exe"), &mut path[..]).ok()?;
    let executable = &path[..length];
    let begin = bytes.as_ptr().addr();
    let end = begin + bytes.len();
    let maps = crate::File::read_from(crate::Fd::cwd(), b"/proc/self/maps").ok()?;
    bun_core::strings::split(&maps, b"\n").find_map(|line| {
        let mut fields = line.splitn(6, |&byte| byte == b' ');
        let mut range = bun_core::strings::split(fields.next()?, b"-").map(parse_hex);
        let low = range.next()??;
        let high = range.next()??;
        let protection = fields.next()?;
        let offset = parse_hex(fields.next()?)?;
        let (_device, _inode) = (fields.next()?, fields.next()?);
        let file = fields.next()?.trim_ascii_start();
        (low <= begin && end <= high && protection == b"r--p" && file == executable)
            .then_some(Mapping { low, high, offset })
    })
}

#[cfg(target_os = "linux")]
fn parse_hex(digits: &[u8]) -> Option<usize> {
    usize::from_str_radix(core::str::from_utf8(digits).ok()?, 16).ok()
}

/// `bytes` is what [`map`] returned for `len` bytes.
pub extern "C" fn unmap(bytes: *mut c_void, len: *mut c_void) {
    let delta = bytes.addr() % bun_alloc::page_size();
    let _ = crate::munmap(bytes.cast::<u8>().wrapping_sub(delta), len.addr() + delta);
}
