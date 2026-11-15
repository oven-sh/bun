//! A large blob lives in a memfd, so that a clone is a copy-on-write `mmap` instead of a copy.

use core::sync::atomic::{AtomicUsize, Ordering};

use bun_sys as sys;

use super::store::Bytes;

static MEMFD_COUNTER: AtomicUsize = AtomicUsize::new(0);

pub(super) fn should_use(bytes: &[u8]) -> bool {
    if !sys::can_use_memfd() {
        return false;
    }

    if crate::jsc::VirtualMachine::is_smol_mode() {
        return bytes.len() >= 1024 * 1024;
    }

    // This is a net 2x - 4x slowdown to new Blob([huge]), so we must be careful
    bytes.len() >= 1024 * 1024 * 8
}

pub(super) fn create(bytes: &[u8]) -> sys::Result<Bytes> {
    let mut label_buf = [0u8; 128];
    let label: &core::ffi::CStr = {
        use std::io::Write as _;
        let n = MEMFD_COUNTER.fetch_add(1, Ordering::Relaxed);
        let cap = label_buf.len() - 1;
        let mut cursor = std::io::Cursor::new(&mut label_buf[..cap]);
        match write!(cursor, "memfd-num-{}", n) {
            Ok(()) => {
                let written = cursor.position() as usize;
                label_buf[written] = 0;
                // `written` ASCII bytes (no interior NUL) + NUL at `label_buf[written]`.
                bun_core::ZStr::from_buf(&label_buf, written).as_cstr()
            }
            Err(_) => c"",
        }
    };

    // Using huge pages was slower.
    let fd = match sys::memfd_create(label, sys::MemfdFlags::NonExecutable) {
        Err(err) => {
            return Err(sys::Error::from_code(err.get_errno(), sys::Tag::open));
        }
        Ok(fd) => fd,
    };
    let memfd = sys::File::from_fd(fd);

    if !bytes.is_empty() {
        // Hint at the size of the file
        let _ = sys::ftruncate(fd, i64::try_from(bytes.len()).expect("int cast"));
    }

    // Dump all the bytes in there
    let mut written: i64 = 0;

    let mut remain = bytes;
    while !remain.is_empty() {
        match sys::pwrite(fd, remain, written) {
            Err(err) => {
                if err.get_errno() == sys::E::EAGAIN {
                    continue;
                }

                bun_core::debug_warn!("Failed to write to memfd: {}", err);
                return Err(err);
            }
            Ok(result) => {
                if result == 0 {
                    bun_core::debug_warn!("Failed to write to memfd: EOF");
                    return Err(sys::Error::from_code(sys::E::ENOMEM, sys::Tag::write));
                }
                written += i64::try_from(result).expect("int cast");
                remain = &remain[result..];
            }
        }
    }

    let ptr = sys::mmap(
        core::ptr::null_mut(),
        bytes.len(),
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_SHARED,
        fd,
        0,
    )?;
    let mapping = core::ptr::slice_from_raw_parts_mut(ptr, bytes.len());
    // SAFETY: just mapped.
    Ok(unsafe { Bytes::from_memfd_mapping(mapping, memfd) })
}
