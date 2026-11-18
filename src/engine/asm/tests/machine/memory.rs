//! The memory that generated code runs on.

use super::host;

/// How far from the stack pointer an address without an index may be.
pub(crate) const STACK_REACH: usize = 17 << 20;
pub(crate) const WINDOW_SIZE: usize = 128 << 10;

pub(crate) struct Arena {
    bytes: Vec<u8>,
    low_windows: Vec<usize>,
}

impl Arena {
    pub(crate) fn new() -> Self {
        Self {
            bytes: vec![0; 2 * STACK_REACH + WINDOW_SIZE],
            low_windows: [1 << 28, 5 << 29]
                .into_iter()
                .filter_map(map_near)
                .collect(),
        }
    }

    pub(crate) fn stack_pointer(&mut self) -> usize {
        let middle = self.bytes.as_mut_ptr().expose_provenance() + STACK_REACH + WINDOW_SIZE / 2;
        middle.next_multiple_of(64) + host::STACK_MISALIGNMENT
    }

    /// Below 2 GiB and below 4 GiB if the system has memory there, and where it likes.
    pub(crate) fn windows(&mut self) -> Vec<usize> {
        let high = self.stack_pointer() + (1 << 20);
        let all = self.low_windows.iter().copied().chain([high]);
        all.collect()
    }
}

#[cfg(unix)]
fn map_near(first: usize) -> Option<usize> {
    (0..256).find_map(|attempt| {
        let wanted = first + attempt * WINDOW_SIZE;
        // SAFETY: the address is a hint, so nothing is replaced.
        let start = unsafe {
            libc::mmap(
                std::ptr::with_exposed_provenance_mut(wanted),
                WINDOW_SIZE,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANON,
                -1,
                0,
            )
        };
        if start == libc::MAP_FAILED {
            return None;
        }
        let start = start.expose_provenance();
        if start != wanted {
            unmap(start);
        }
        (start == wanted).then_some(start)
    })
}

#[cfg(unix)]
fn unmap(window: usize) {
    // SAFETY: mapped by `map_near`, and no longer in use.
    unsafe { libc::munmap(std::ptr::with_exposed_provenance_mut(window), WINDOW_SIZE) };
}

#[cfg(not(unix))]
fn map_near(_first: usize) -> Option<usize> {
    None
}

#[cfg(not(unix))]
fn unmap(_window: usize) {}

impl Drop for Arena {
    fn drop(&mut self) {
        self.low_windows.iter().copied().for_each(unmap);
    }
}

pub(crate) fn read(address: usize, bytes: &mut [u8]) {
    let src = std::ptr::with_exposed_provenance(address);
    // SAFETY: the harness makes addresses in its arena only.
    unsafe { std::ptr::copy_nonoverlapping(src, bytes.as_mut_ptr(), bytes.len()) };
}

pub(crate) fn write(address: usize, bytes: &[u8]) {
    let dst = std::ptr::with_exposed_provenance_mut(address);
    // SAFETY: as above.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), dst, bytes.len()) };
}
