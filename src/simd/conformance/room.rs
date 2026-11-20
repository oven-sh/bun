use core::mem::MaybeUninit;

/// A multiple of the page size.
const SIZE: usize = 1 << 18;

/// Memory between inaccessible pages.
pub(crate) struct Room(&'static mut [MaybeUninit<u8>; SIZE]);

#[cfg(unix)]
fn map() -> *mut u8 {
    use libc::{MAP_ANON, MAP_FAILED, MAP_PRIVATE, PROT_NONE, PROT_READ, PROT_WRITE};
    // SAFETY: maps new addresses, and makes a part of them accessible.
    unsafe {
        let anywhere = core::ptr::null_mut();
        let all = libc::mmap(anywhere, 3 * SIZE, PROT_NONE, MAP_PRIVATE | MAP_ANON, -1, 0);
        assert_ne!(all, MAP_FAILED);
        assert_eq!(
            libc::mprotect(all.add(SIZE), SIZE, PROT_READ | PROT_WRITE),
            0
        );
        all.add(SIZE).cast()
    }
}

#[cfg(windows)]
fn map() -> *mut u8 {
    const MEM_COMMIT: u32 = 0x1000;
    const MEM_RESERVE: u32 = 0x2000;
    const PAGE_NOACCESS: u32 = 1;
    const PAGE_READWRITE: u32 = 4;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn VirtualAlloc(at: *mut u8, size: usize, how: u32, protection: u32) -> *mut u8;
    }
    // SAFETY: reserves new addresses, and commits part of them.
    let middle = unsafe {
        let all = VirtualAlloc(core::ptr::null_mut(), 3 * SIZE, MEM_RESERVE, PAGE_NOACCESS);
        assert!(!all.is_null());
        VirtualAlloc(all.add(SIZE), SIZE, MEM_COMMIT, PAGE_READWRITE)
    };
    assert!(!middle.is_null());
    middle
}

impl Room {
    #[inline(never)]
    pub(crate) fn new() -> Self {
        // SAFETY: `SIZE` bytes that nothing else refers to, and that are never unmapped.
        Self(unsafe { &mut *map().cast() })
    }

    /// At `offset` bytes, or as far in as it fits. Has nothing of the last use.
    pub(crate) fn uninit<T>(&mut self, len: usize, offset: usize) -> &mut [MaybeUninit<T>] {
        let size = len * size_of::<T>();
        let bytes = &mut self.0[offset.min(SIZE - size) & !(align_of::<T>() - 1)..][..size];
        bytes.fill(MaybeUninit::new(0xA5));
        // SAFETY: the room is aligned to a page, and the offset into it for `T`.
        unsafe { core::slice::from_raw_parts_mut(bytes.as_mut_ptr().cast(), len) }
    }

    pub(crate) fn copy_of<T: Copy>(&mut self, items: &[T], offset: usize) -> &mut [T] {
        self.uninit(items.len(), offset).write_copy_of_slice(items)
    }
}
