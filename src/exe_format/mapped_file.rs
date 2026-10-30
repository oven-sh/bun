//! A private, writable mapping of a file. Writes stay in memory.

use bun_core::ZStr;

/// Every page from `pointer` to the end of `mapped_length` stays mapped until `drop`. The kernel can give
/// an address that is unmapped, even briefly, to another thread, and `drop` would unmap that thread's memory.
pub struct MappedFile {
    file: bun_sys::File,
    pointer: *mut u8,
    length: usize,
    mapped_length: usize,
    /// `move_down` moves pages of this size whole: a multiple of the system's.
    #[cfg(not(windows))]
    page: usize,
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
            page: MappedFile::page_size(),
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

    /// The first `size` bytes, which are read for the last time, and the others.
    pub fn split_read_once(&mut self, size: usize) -> (ReadOnce<'_>, &mut [u8]) {
        let (first, others) = self.split_at_mut(size);
        let bytes = Part::OfMapping(first);
        (ReadOnce { offset: 0, bytes }, others)
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
        // SAFETY: the addresses belong to this mapping, and no reference to its bytes is alive.
        unsafe { MappedFile::map_zero_pages_at(self.pointer.add(start), end - start) };
    }

    /// # Safety
    /// The pages belong to a `MappedFile`, and the caller has the only reference to their bytes.
    unsafe fn map_zero_pages_at(pointer: *mut u8, size: usize) {
        let (access, flags) = (
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_FIXED,
        );
        // SAFETY: the caller's contract.
        let pages = unsafe { libc::mmap(pointer.cast(), size, access, flags, -1, 0) };
        assert!(
            pages != libc::MAP_FAILED,
            "no memory for the pages of an executable"
        );
    }

    /// Takes pages out of this process. They stay mapped, and no longer hold what was written to them.
    ///
    /// # Safety
    /// The pages belong to a `MappedFile`, and the caller has the only reference to their bytes.
    unsafe fn let_go_of_pages_at(pointer: *mut u8, size: usize) {
        // SAFETY: the caller's contract.
        unsafe {
            #[cfg(target_os = "linux")]
            libc::madvise(pointer.cast(), size, libc::MADV_DONTNEED);
            #[cfg(not(target_os = "linux"))]
            MappedFile::map_zero_pages_at(pointer, size);
        }
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

/// A part of the bytes of a file that is read for the last time. Nothing else refers to it.
/// Where it is a part of a mapping, its whole pages leave this process when it is dropped, and the mapping no longer holds their bytes.
pub struct ReadOnce<'a> {
    offset: usize,
    bytes: Part<'a>,
}

enum Part<'a> {
    Kept(&'a [u8]),
    OfMapping(&'a mut [u8]),
}

impl<'a> ReadOnce<'a> {
    /// Bytes at the start of a file that stay as they are.
    pub fn kept(bytes: &'a [u8]) -> ReadOnce<'a> {
        ReadOnce {
            offset: 0,
            bytes: Part::Kept(bytes),
        }
    }

    /// Where the first byte is in the file.
    pub fn offset(&self) -> usize {
        self.offset
    }

    /// One part of `size` bytes after the other. The last one may be shorter.
    pub fn blocks(self, size: usize) -> Blocks<'a> {
        assert!(size > 0);
        Blocks { others: self, size }
    }

    /// Takes the first `size` bytes away.
    pub fn take_first(&mut self, size: usize) -> ReadOnce<'a> {
        let offset = self.offset;
        self.offset += size;
        let bytes = match &mut self.bytes {
            Part::Kept(bytes) => {
                let (first, others) = bytes.split_at(size);
                *bytes = others;
                Part::Kept(first)
            }
            Part::OfMapping(bytes) => {
                let (first, others) = core::mem::take(bytes).split_at_mut(size);
                *bytes = others;
                Part::OfMapping(first)
            }
        };
        ReadOnce { offset, bytes }
    }
}

impl core::ops::Deref for ReadOnce<'_> {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match &self.bytes {
            Part::Kept(bytes) => bytes,
            Part::OfMapping(bytes) => bytes,
        }
    }
}

impl Drop for ReadOnce<'_> {
    fn drop(&mut self) {
        #[cfg(not(windows))]
        if let Part::OfMapping(bytes) = &mut self.bytes {
            let page = MappedFile::page_size();
            let start = bytes.as_ptr().align_offset(page);
            let end = bytes
                .len()
                .saturating_sub(bytes.as_ptr_range().end.addr() % page);
            if let Some(pages) = bytes.get_mut(start..end)
                && !pages.is_empty()
            {
                // SAFETY: only a `MappedFile` makes this kind of part, and `pages` is the only reference to these bytes.
                unsafe { MappedFile::let_go_of_pages_at(pages.as_mut_ptr(), pages.len()) };
            }
        }
    }
}

/// The bytes that a file is made from, which nothing else refers to.
pub enum TemplateBytes<'a> {
    Kept(&'a mut [u8]),
    /// Whoever reads them is the last to do so.
    ReadOnce(&'a mut MappedFile),
}

impl<'a> TemplateBytes<'a> {
    pub fn read_once(self) -> ReadOnce<'a> {
        match self {
            TemplateBytes::Kept(bytes) => ReadOnce::kept(bytes),
            TemplateBytes::ReadOnce(mapping) => mapping.split_read_once(mapping.len()).0,
        }
    }
}

impl core::ops::Deref for TemplateBytes<'_> {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            TemplateBytes::Kept(bytes) => bytes,
            TemplateBytes::ReadOnce(mapping) => mapping,
        }
    }
}

impl core::ops::DerefMut for TemplateBytes<'_> {
    fn deref_mut(&mut self) -> &mut [u8] {
        match self {
            TemplateBytes::Kept(bytes) => bytes,
            TemplateBytes::ReadOnce(mapping) => mapping,
        }
    }
}

pub struct Blocks<'a> {
    others: ReadOnce<'a>,
    size: usize,
}

impl<'a> Iterator for Blocks<'a> {
    type Item = ReadOnce<'a>;

    fn next(&mut self) -> Option<ReadOnce<'a>> {
        let size = self.size.min(self.others.len());
        (size > 0).then(|| self.others.take_first(size))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let count = self.others.len().div_ceil(self.size);
        (count, Some(count))
    }
}

impl ExactSizeIterator for Blocks<'_> {}

#[cfg(not(windows))]
impl crate::image::ImageBytes for MappedFile {
    // Pages that nothing wrote stay pages of the file.
    fn move_down(&mut self, source: core::ops::Range<usize>, target: usize) {
        let page = self.page;
        let distance = source.start - target;
        if distance == 0 || source.is_empty() {
            return;
        }
        if !source.start.is_multiple_of(page) || !target.is_multiple_of(page) {
            self.copy_within(source, target);
            return;
        }
        // What follows `source` in its last page stays where it is.
        let length = source.len() / page * page;
        self.move_pages_down(source.start, target, length);
        self.copy_within(source.start + length..source.end, target + length);
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

#[cfg(not(windows))]
impl MappedFile {
    /// `source`, `target` and `length` are multiples of the size of a page.
    fn move_pages_down(&mut self, source: usize, target: usize, length: usize) {
        if length == 0 || self.remap_pages(source, target, length) {
            return;
        }
        let distance = source - target;
        // What has been copied is let go of, so that only the copy stays in memory.
        const MOST_BYTES_AT_ONCE: usize = 4 << 20;
        let mut copied = 0;
        while copied < length {
            let size = distance.min(MOST_BYTES_AT_ONCE).min(length - copied);
            self.map_zero_pages(target + copied, target + copied + size);
            // SAFETY: both ranges lie in this mapping. `size` is at most the distance between them, so they don't overlap.
            unsafe {
                let from = self.pointer.add(source + copied);
                core::ptr::copy_nonoverlapping(from, self.pointer.add(target + copied), size);
            }
            self.map_zero_pages(source + copied, source + copied + size);
            copied += size;
        }
    }
}

/// The bytes of a file that is made from a template: a vector, or a private mapping of the template with room behind it.
pub enum FileBytes {
    Vector(Vec<u8>),
    Mapping(MappedFile),
}

impl FileBytes {
    #[cfg(all(test, not(windows)))]
    pub(crate) fn is_mapping(&self) -> bool {
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

    /// The first `size` bytes, which are read for the last time, and the others.
    pub fn split_read_once(&mut self, size: usize) -> (ReadOnce<'_>, &mut [u8]) {
        match self {
            FileBytes::Vector(vector) => {
                let (first, others) = vector.split_at_mut(size);
                (ReadOnce::kept(first), others)
            }
            FileBytes::Mapping(mapping) => mapping.split_read_once(size),
        }
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
    fn whole_pages_of_a_mapping_are_given_up_once_they_were_read() {
        let page = MappedFile::page_size();
        let original: Vec<u8> = (0..4 * page).map(|index| (index / 7) as u8 | 1).collect();
        let file = TemporaryFile::create("read-once", &original);
        let mut bytes = FileBytes::Mapping(MappedFile::open(&file.0).unwrap());
        let mut expected = original.clone();
        for written in [5, page, 2 * page] {
            bytes[written] = 0xEE;
            expected[written] = 0xEE;
        }

        let (first, others) = bytes.split_read_once(2 * page + 1);
        assert!(*others == expected[2 * page + 1..]);
        let blocks = first.blocks(page + 1);
        assert_eq!(blocks.len(), 2);
        for block in blocks {
            assert!(*block == expected[block.offset()..][..block.len()]);
        }

        assert_ne!(bytes[5], 0xEE);
        assert!(bytes[page..] == expected[page..]);
        bytes[5] = 0xEE;
        assert_eq!(bytes[5], 0xEE);
        assert!(file.read() == original);
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
        fn what_follows_a_moved_range_in_its_last_page_stays() {
            let page = MappedFile::page_size();
            let large_page = 4 * page;
            let original: Vec<u8> = (0..large_page * 6)
                .map(|index| (index / 13) as u8)
                .collect();
            let kept = [
                large_page * 2..large_page * 3 + page,
                large_page * 3 + page * 2..large_page * 6,
            ];
            for (name, split_at) in [
                ("large-pages", None),
                ("large-pages-copied", Some(large_page * 2)),
            ] {
                let file = TemporaryFile::create(name, &original);
                let mut mapped = MappedFile::open(&file.0).unwrap();
                mapped.page = large_page;
                let mut vector = original.clone();
                if let Some(start) = split_at {
                    mapped.map_zero_pages(start, start + page);
                    vector[start..start + page].fill(0);
                }
                let edit = |bytes: &mut dyn ImageBytes| {
                    bytes[kept[1].start] = 0xEE;
                    let mut target = large_page;
                    for source in kept.clone() {
                        bytes.move_down(source.clone(), target);
                        target += source.len();
                    }
                    bytes.truncate(target);
                };
                edit(&mut mapped);
                edit(&mut vector);
                assert!(*mapped == *vector);
                assert!(!has_unmapped_page(&mapped));
                assert!(file.read() == original);
            }
        }

        #[test]
        fn pages_that_cannot_be_remapped_are_copied() {
            let page = MappedFile::page_size();
            check_edit("copied-pages", move_whole_pages, Some(page * 7));
        }
    }
}
