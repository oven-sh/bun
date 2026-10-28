//! A private, writable mapping of a file. Writes stay in memory.

use bun_core::ZStr;

/// Every page from `pointer` to the end of `mapped_length` stays mapped until `drop`. The kernel can give
/// an address that is unmapped, even briefly, to another thread, and `drop` would unmap that thread's memory.
pub struct MappedFile {
    file: bun_sys::File,
    pointer: *mut u8,
    length: usize,
    mapped_length: usize,
}

impl MappedFile {
    pub fn open(path: &ZStr) -> Option<MappedFile> {
        MappedFile::open_with_room(path, |_| 0)
    }

    /// `room` is told the size of the file and says how many bytes `grow` can add behind its end.
    #[cfg(not(windows))]
    pub fn open_with_room(path: &ZStr, room: impl FnOnce(usize) -> usize) -> Option<MappedFile> {
        let file = bun_sys::File::open(path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0).ok()?;
        let length = file.get_end_pos().ok().filter(|length| *length > 0)?;
        let room = room(length);
        let access = libc::PROT_READ | libc::PROT_WRITE;
        let mapped_length = match room {
            0 => length,
            _ => length
                .next_multiple_of(MappedFile::page_size())
                .checked_add(room)?,
        };
        let mut address: *mut u8 = core::ptr::null_mut();
        if room > 0 {
            let flags = libc::MAP_PRIVATE | libc::MAP_ANON;
            // SAFETY: the kernel chooses the address.
            let pages = unsafe { libc::mmap(address.cast(), mapped_length, access, flags, -1, 0) };
            if pages == libc::MAP_FAILED {
                return None;
            }
            address = pages.cast();
        }
        let flags = libc::MAP_PRIVATE | if room > 0 { libc::MAP_FIXED } else { 0 };
        let Ok(pointer) = bun_sys::mmap(address, length, access, flags, file.handle(), 0) else {
            if room > 0 {
                let _ = bun_sys::munmap(address, mapped_length);
            }
            return None;
        };
        Some(MappedFile {
            file,
            pointer,
            length,
            mapped_length,
        })
    }

    #[cfg(windows)]
    pub fn open_with_room(_path: &ZStr, _room: impl FnOnce(usize) -> usize) -> Option<MappedFile> {
        None
    }

    /// The longest that `grow` can make it.
    pub fn capacity(&self) -> usize {
        self.mapped_length
    }

    pub fn addresses(&self) -> core::ops::Range<usize> {
        self.pointer as usize..self.pointer as usize + self.length
    }

    pub fn bytes_and_file(&mut self) -> (&mut [u8], &bun_sys::File) {
        // SAFETY: the mapping holds `length` writable bytes until `drop`, and nothing else refers to them.
        (
            unsafe { core::slice::from_raw_parts_mut(self.pointer, self.length) },
            &self.file,
        )
    }
}

impl Drop for MappedFile {
    fn drop(&mut self) {
        let _ = bun_sys::munmap(self.pointer, self.mapped_length);
    }
}

impl core::ops::Deref for MappedFile {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        // SAFETY: the mapping holds `length` readable bytes until `drop`.
        unsafe { core::slice::from_raw_parts(self.pointer, self.length) }
    }
}

impl core::ops::DerefMut for MappedFile {
    fn deref_mut(&mut self) -> &mut [u8] {
        self.bytes_and_file().0
    }
}

#[cfg(not(windows))]
impl MappedFile {
    pub fn page_size() -> usize {
        // SAFETY: sysconf has no precondition.
        unsafe { libc::sysconf(libc::_SC_PAGESIZE) as usize }
    }

    fn map_zero_pages(&mut self, start: usize, end: usize) {
        assert!(start < end && end <= self.mapped_length.next_multiple_of(MappedFile::page_size()));
        let (access, flags) = (
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_FIXED,
        );
        // SAFETY: the addresses belong to this mapping, and no reference to its bytes is alive.
        let pages = unsafe {
            libc::mmap(
                self.pointer.add(start).cast(),
                end - start,
                access,
                flags,
                -1,
                0,
            )
        };
        assert!(
            pages != libc::MAP_FAILED,
            "no memory for the pages of an executable"
        );
    }

    /// Changes the address of whole pages without reading them. False: nothing has changed.
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn remap_pages(&mut self, _source: usize, _target: usize, _size: usize) -> bool {
        false
    }

    /// Changes the address of whole pages without reading them. False: nothing has changed.
    #[cfg(target_os = "macos")]
    fn remap_pages(&mut self, source: usize, target: usize, size: usize) -> bool {
        unsafe extern "C" {
            fn mach_vm_remap(
                target_task: libc::mach_port_t,
                target_address: *mut u64,
                size: u64,
                mask: u64,
                flags: libc::c_int,
                source_task: libc::mach_port_t,
                source_address: u64,
                copy: libc::boolean_t,
                current_protection: *mut libc::vm_prot_t,
                maximum_protection: *mut libc::vm_prot_t,
                inheritance: libc::vm_inherit_t,
            ) -> libc::kern_return_t;
        }
        const VM_FLAGS_FIXED: libc::c_int = 0;
        const VM_FLAGS_OVERWRITE: libc::c_int = 0x4000;
        const VM_INHERIT_COPY: libc::vm_inherit_t = 1;
        const COPIES_ON_WRITE: libc::boolean_t = 1;
        let task = bun_sys::c::mach_task_self();
        let mut address = self.pointer as u64 + target as u64;
        let (mut current, mut maximum) = (0, 0);
        // SAFETY: both ranges lie in this mapping, and no reference to its bytes is alive. What was mapped at the target is dropped, which the caller allows.
        let result = unsafe {
            mach_vm_remap(
                task,
                &mut address,
                size.next_multiple_of(MappedFile::page_size()) as u64,
                0,
                VM_FLAGS_FIXED | VM_FLAGS_OVERWRITE,
                task,
                self.pointer as u64 + source as u64,
                COPIES_ON_WRITE,
                &mut current,
                &mut maximum,
                VM_INHERIT_COPY,
            )
        };
        result == libc::KERN_SUCCESS
    }

    /// Changes the address of whole pages without reading them. False: nothing has changed.
    #[cfg(target_os = "linux")]
    fn remap_pages(&mut self, source: usize, target: usize, size: usize) -> bool {
        // SAFETY: both ranges lie in this mapping.
        let (from, to) = unsafe { (self.pointer.add(source), self.pointer.add(target)) };
        // MREMAP_FIXED unmaps the target before it looks at the source, so only a move that can't fail uses it.
        // Linux before 5.13 refuses MREMAP_DONTUNMAP for the pages of a file.
        let flags = libc::MREMAP_MAYMOVE | libc::MREMAP_DONTUNMAP;
        let anywhere = core::ptr::null_mut::<libc::c_void>();
        // SAFETY: no reference to the bytes of the mapping is alive.
        let elsewhere = unsafe { libc::mremap(from.cast(), size, size, flags, anywhere) };
        if elsewhere == libc::MAP_FAILED {
            return false;
        }
        let flags = libc::MREMAP_MAYMOVE | libc::MREMAP_FIXED;
        // SAFETY: as above. What was mapped at `to` is dropped, which the caller allows.
        let moved =
            unsafe { libc::mremap(elsewhere, size, size, flags, to.cast::<libc::c_void>()) };
        assert!(
            moved != libc::MAP_FAILED,
            "no memory for the pages of an executable"
        );
        true
    }
}

/// Takes the whole pages of `bytes`, a part of a private mapping, out of this process. The caller reads none of them again.
#[cfg(not(windows))]
pub fn let_go_of_pages(bytes: &[u8]) {
    let page = MappedFile::page_size();
    let start = (bytes.as_ptr() as usize).next_multiple_of(page);
    let end = (bytes.as_ptr() as usize + bytes.len()) / page * page;
    if start >= end {
        return;
    }
    let (access, flags) = (
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_FIXED,
    );
    // SAFETY: the pages lie in a mapping, which stays one.
    unsafe {
        libc::mmap(
            start as *mut libc::c_void,
            end - start,
            access,
            flags,
            -1,
            0,
        )
    };
}

#[cfg(windows)]
pub fn let_go_of_pages(_bytes: &[u8]) {}

#[cfg(not(windows))]
impl crate::image::ImageBytes for MappedFile {
    // Pages that nothing wrote stay pages of the file.
    fn move_down(&mut self, source: core::ops::Range<usize>, target: usize) {
        let page = MappedFile::page_size();
        let distance = source.start - target;
        if distance == 0 || source.is_empty() {
            return;
        }
        if !source.start.is_multiple_of(page) || !target.is_multiple_of(page) {
            self.copy_within(source, target);
            return;
        }
        let length = source
            .len()
            .next_multiple_of(page)
            .min(self.mapped_length - source.start);
        if self.remap_pages(source.start, target, length) {
            return;
        }
        // What has been copied is let go of, so that only the copy stays in memory.
        const MOST_BYTES_AT_ONCE: usize = 4 << 20;
        let mut copied = 0;
        while copied < length {
            let size = distance.min(MOST_BYTES_AT_ONCE).min(length - copied);
            self.map_zero_pages(target + copied, target + copied + size);
            // SAFETY: both ranges lie in this mapping. `size` is at most the distance between them, so they don't overlap.
            unsafe {
                let from = self.pointer.add(source.start + copied);
                core::ptr::copy_nonoverlapping(from, self.pointer.add(target + copied), size);
            }
            self.map_zero_pages(source.start + copied, source.start + copied + size);
            copied += size;
        }
    }

    fn truncate(&mut self, len: usize) {
        self.length = self.length.min(len);
    }

    fn grow(&mut self, len: usize) {
        let first_new_page = self.length.next_multiple_of(MappedFile::page_size());
        if len > first_new_page {
            self.map_zero_pages(
                first_new_page,
                len.next_multiple_of(MappedFile::page_size()),
            );
        }
        let old_length = core::mem::replace(&mut self.length, len);
        self[old_length..first_new_page.min(len)].fill(0);
    }

    fn as_vec(&mut self) -> Option<&mut Vec<u8>> {
        None
    }
}

/// The bytes of a file that is made from a template: a vector, or a private mapping of the template with room behind it.
pub enum FileBytes {
    Vector(Vec<u8>),
    Mapping(MappedFile),
}

impl FileBytes {
    pub fn is_mapping(&self) -> bool {
        matches!(self, FileBytes::Mapping(_))
    }

    /// The bytes that are added are zero.
    pub fn resize(&mut self, len: usize) {
        use crate::image::ImageBytes;
        if len <= self.len() {
            return self.truncate(len);
        }
        if let FileBytes::Mapping(mapping) = self
            && len > mapping.capacity()
        {
            let mut vector = Vec::with_capacity(len);
            vector.extend_from_slice(mapping);
            *self = FileBytes::Vector(vector);
        }
        self.grow(len);
    }

    pub fn extend_from_slice(&mut self, bytes: &[u8]) {
        let start = self.len();
        self.resize(start + bytes.len());
        self[start..].copy_from_slice(bytes);
    }
}

impl Default for FileBytes {
    fn default() -> FileBytes {
        FileBytes::Vector(Vec::new())
    }
}

impl core::ops::Deref for FileBytes {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            FileBytes::Vector(vector) => vector,
            FileBytes::Mapping(mapping) => mapping,
        }
    }
}

impl core::ops::DerefMut for FileBytes {
    fn deref_mut(&mut self) -> &mut [u8] {
        match self {
            FileBytes::Vector(vector) => vector,
            FileBytes::Mapping(mapping) => mapping,
        }
    }
}

impl crate::image::ImageBytes for FileBytes {
    fn move_down(&mut self, source: core::ops::Range<usize>, target: usize) {
        self.as_image_bytes().move_down(source, target);
    }

    fn truncate(&mut self, len: usize) {
        self.as_image_bytes().truncate(len);
    }

    fn grow(&mut self, len: usize) {
        self.as_image_bytes().grow(len);
    }

    fn as_vec(&mut self) -> Option<&mut Vec<u8>> {
        self.as_image_bytes().as_vec()
    }
}

impl FileBytes {
    fn as_image_bytes(&mut self) -> &mut dyn crate::image::ImageBytes {
        match self {
            FileBytes::Vector(vector) => vector,
            #[cfg(not(windows))]
            FileBytes::Mapping(mapping) => mapping,
            #[cfg(windows)]
            FileBytes::Mapping(_) => unreachable!("no file is mapped on Windows"),
        }
    }
}

#[cfg(all(test, not(windows)))]
pub(crate) mod tests {
    use bun_core::ZBox;
    use bun_sys::Fd;

    use super::*;

    pub(crate) struct TemporaryFile(pub(crate) ZBox);

    impl TemporaryFile {
        fn path(name: &str) -> ZBox {
            let mut path = std::env::temp_dir().into_os_string().into_encoded_bytes();
            let name = format!("/bun-mapped-file-{}-{name}", std::process::id());
            path.extend_from_slice(name.as_bytes());
            ZBox::from_vec(path)
        }

        pub(crate) fn create(name: &str, contents: &[u8]) -> TemporaryFile {
            let path = TemporaryFile::path(name);
            let file = bun_sys::File::create(Fd::cwd(), path.as_bytes(), true).unwrap();
            file.write_all(contents).unwrap();
            TemporaryFile(path)
        }

        pub(crate) fn read(&self) -> Vec<u8> {
            bun_sys::File::read_from(Fd::cwd(), self.0.as_bytes()).unwrap()
        }
    }

    impl Drop for TemporaryFile {
        fn drop(&mut self) {
            let _ = bun_sys::unlink(&self.0);
        }
    }

    #[test]
    fn writes_stay_in_memory() {
        let file = TemporaryFile::create("writes", b"0123456789");
        let mut mapped = MappedFile::open(&file.0).unwrap();
        mapped.bytes_and_file().0[3] = b'x';
        assert_eq!(mapped.bytes_and_file().0, b"012x456789");
        assert!(file.read() == b"0123456789");
        assert!(MappedFile::open(&TemporaryFile::path("missing")).is_none());
    }

    #[test]
    fn bytes_grow_into_the_room_and_past_it() {
        let page = MappedFile::page_size();
        let original: Vec<u8> = (0..page + 100).map(|index| (index / 7) as u8).collect();
        let file = TemporaryFile::create("room", &original);
        let mapped = MappedFile::open_with_room(&file.0, |size| size + page).unwrap();
        assert_eq!(mapped.capacity(), 2 * page + original.len() + page);
        let mut bytes = FileBytes::Mapping(mapped);
        let mut vector = original.clone();

        bytes.extend_from_slice(&[1, 2, 3]);
        vector.extend_from_slice(&[1, 2, 3]);
        bytes.resize(3 * page + 5);
        vector.resize(3 * page + 5, 0);
        bytes[3 * page] = 9;
        vector[3 * page] = 9;
        bytes.resize(page);
        bytes.resize(3 * page + 5);
        vector.truncate(page);
        vector.resize(3 * page + 5, 0);
        assert!(bytes.is_mapping() && *bytes == *vector);

        bytes.resize(6 * page);
        vector.resize(6 * page, 0);
        assert!(!bytes.is_mapping() && *bytes == *vector);
        assert!(file.read() == original);
    }

    #[test]
    fn pages_that_are_let_go_of_stay_mapped() {
        let page = MappedFile::page_size();
        let file = TemporaryFile::create("let-go", &vec![7u8; 4 * page]);
        let mut mapped = MappedFile::open(&file.0).unwrap();
        mapped[page] = 8;
        let_go_of_pages(&mapped[page - 1..3 * page + 1]);
        assert_eq!((mapped[page - 1], mapped[3 * page]), (7, 7));
        mapped[2 * page] = 1;
        assert_eq!(mapped[2 * page], 1);
    }

    mod edits {
        use super::*;
        use crate::image::ImageBytes;

        fn has_unmapped_page(mapped: &MappedFile) -> bool {
            let page = MappedFile::page_size();
            let mut residency = vec![0u8; mapped.mapped_length.div_ceil(page)];
            // SAFETY: `residency` has a byte for every page, and mincore() reads none of them.
            let result = unsafe {
                libc::mincore(
                    mapped.pointer.cast(),
                    mapped.mapped_length,
                    residency.as_mut_ptr().cast(),
                )
            };
            result != 0
        }

        fn check_edit(name: &str, edit: impl Fn(&mut dyn ImageBytes), split_at: Option<usize>) {
            let page = MappedFile::page_size();
            let original: Vec<u8> = (0..page * 12 + 100)
                .map(|index| (index / 13) as u8)
                .collect();
            let file = TemporaryFile::create(name, &original);
            let mut mapped = MappedFile::open(&file.0).unwrap();
            let mut vector = original.clone();
            // mremap() refuses a range of more than one mapping, so the pages are copied.
            if let Some(start) = split_at {
                mapped.map_zero_pages(start, start + page);
                vector[start..start + page].fill(0);
            }
            edit(&mut mapped);
            edit(&mut vector);
            assert!(*mapped == *vector);
            assert!(!has_unmapped_page(&mapped));
            assert!(file.read() == original);
        }

        fn move_whole_pages(bytes: &mut dyn ImageBytes) {
            let page = MappedFile::page_size();
            bytes[page * 5 + 7] = 0xEE;
            bytes.move_down(page * 2..page * 3, page);
            bytes.move_down(page * 5..page * 12 + 100, page * 2);
            bytes.truncate(page * 9 + 100);
            bytes.grow(page * 10 + 50);
            bytes[page * 10 + 1] = 1;
        }

        fn move_parts_of_pages(bytes: &mut dyn ImageBytes) {
            let page = MappedFile::page_size();
            bytes.move_down(page * 5..page * 7, page * 2);
            bytes.move_down(page * 8 + 16..page * 12 + 100, page * 4);
            bytes.truncate(page * 8 + 84);
            bytes.grow(page * 8 + 90);
        }

        #[test]
        fn whole_pages_move_like_bytes_of_a_vector() {
            check_edit("whole-pages", move_whole_pages, None);
        }

        #[test]
        fn parts_of_pages_move_like_bytes_of_a_vector() {
            check_edit("parts-of-pages", move_parts_of_pages, None);
        }

        #[test]
        fn pages_that_cannot_be_remapped_are_copied() {
            let page = MappedFile::page_size();
            check_edit("copied-pages", move_whole_pages, Some(page * 7));
        }
    }
}
