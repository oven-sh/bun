//! What a compiled program adds to the standalone module graph: its record, the graph handed over by descriptor, and the paths outside the virtual root that the graph answers for.

use core::mem::size_of;
use core::ptr::read_unaligned;

use bun_collections::StringArrayHashMap;
use bun_collections::index_sort;
use bun_core::{StringBuilder, StringPointer, ZStr, bytes_of, slice_as_bytes};
use bun_paths::{PathBuffer, path_buffer_pool, platform, resolve_path, strings};
use bun_resolver::compiled_program::{
    CompiledEntryPoint, CompiledPackageName, CompiledProgram, ImageFile, compare_source_paths,
};
use bun_sys::{Fd, Stat};

use crate::Error;
#[cfg(windows)]
use crate::StandaloneModuleGraph::normalize_file_key;
use crate::StandaloneModuleGraph::{
    File, StandaloneModuleGraph, dir_stat, is_bun_standalone_file_path,
};

const CORRUPTED: Error = Error::CorruptedCompiledProgram;
/// The `u64` length before the payload, in a section of an executable and in `to_graph_bytes`.
const PAYLOAD_HEADER_SIZE: usize = size_of::<u64>();
const RECORD_SIZE: usize = 4 * size_of::<u32>();
const PRESERVES_SOURCE_PATHS: u32 = 1;
/// The length of the path, what `require` and what `import` find, and whether the name hides other paths.
const PACKAGE_NAME_SIZE: usize = 4 * size_of::<u32>();
const NO_ENTRY_POINT: u32 = u32::MAX;
const SHARED_LIBRARY_EXTENSIONS: [&[u8]; 3] = [b".dylib", b".dll", b".so"];
const VERSIONED_SHARED_LIBRARY_EXTENSION: &[u8] = b".so.";

#[repr(C)]
#[derive(Copy, Clone)]
struct CompiledProgramRecord {
    image: StringPointer,
    entry_point_count: u32,
    flags: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct CompiledEntryPointRecord {
    file_index: u32,
    module_id: u32,
    source_path: StringPointer,
}

const _: () = assert!(size_of::<CompiledProgramRecord>() == RECORD_SIZE);
const _: () = assert!(size_of::<CompiledEntryPointRecord>() == RECORD_SIZE);
const _: () = assert!(cfg!(target_endian = "little"));

// SAFETY: four `u32`s, so there is no padding.
unsafe impl bun_core::NoUninit for CompiledProgramRecord {}
// SAFETY: four `u32`s, so there is no padding.
unsafe impl bun_core::NoUninit for CompiledEntryPointRecord {}

pub struct CompiledEntryPointInput<'a> {
    pub module_id: bun_aot::engine::EngineModuleId,
    pub source_path: &'a [u8],
    pub module_path: &'a [u8],
}

/// `CompiledPackageName`. The indices are positions in `CompiledProgramInput::entry_points`.
pub struct CompiledPackageNameInput<'a> {
    pub path: &'a [u8],
    pub required: Option<u32>,
    pub imported: Option<u32>,
    pub hides_other_paths: bool,
}

#[derive(Copy, Clone)]
pub(crate) struct EntryPointPathPointers {
    source_path: StringPointer,
    module_path: StringPointer,
}

pub struct CompiledProgramInput<'a> {
    pub image: &'a [u8],
    pub image_alignment: usize,
    /// Entry point `i` belongs to the output file whose `entry_point_index` is `Some(i)`.
    pub entry_points: &'a [CompiledEntryPointInput<'a>],
    pub package_names: &'a [CompiledPackageNameInput<'a>],
    pub preserves_source_paths: bool,
    pub symbols: &'a [u8],
}

pub(crate) fn capacity(input: &CompiledProgramInput<'_>) -> usize {
    let entry_point_overhead = RECORD_SIZE + size_of::<u32>() + size_of::<StringPointer>() + 2;
    let entry_points: usize = input
        .entry_points
        .iter()
        .map(|entry_point| {
            entry_point_overhead + entry_point.source_path.len() + entry_point.module_path.len()
        })
        .sum();
    let package_names: usize = input
        .package_names
        .iter()
        .map(|name| PACKAGE_NAME_SIZE + name.path.len())
        .sum();
    input.image.len()
        + input.image_alignment
        + RECORD_SIZE
        + entry_points
        + size_of::<u32>()
        + package_names
}

pub(crate) fn append_image(
    builder: &mut StringBuilder,
    input: &CompiledProgramInput<'_>,
) -> crate::Result<StringPointer> {
    let (image, alignment) = (input.image, input.image_alignment);
    if !alignment.is_power_of_two()
        || alignment < PAYLOAD_HEADER_SIZE
        || image.is_empty()
        || !image.len().is_multiple_of(alignment)
    {
        return Err(Error::ImageMisaligned);
    }
    let unaligned_start = PAYLOAD_HEADER_SIZE + builder.len;
    let padding = unaligned_start.next_multiple_of(alignment) - unaligned_start;
    let (zeros, rest) = builder.writable().split_at_mut(padding);
    zeros.fill(0);
    let destination = &mut rest[..image.len()];
    // SAFETY: `destination` is `image.len()` writable bytes of the builder's own buffer, which `image` does not overlap.
    unsafe { bun_core::copy_in_parallel(destination.as_mut_ptr(), image.as_ptr(), image.len()) };
    let offset = builder.len + padding;
    builder.len = offset + image.len();
    Ok(StringPointer {
        offset: offset as u32,
        length: image.len() as u32,
    })
}

pub(crate) fn append_entry_point_paths(
    builder: &mut StringBuilder,
    input: &CompiledProgramInput<'_>,
) -> Vec<EntryPointPathPointers> {
    let entry_points = input.entry_points.iter();
    entry_points
        .map(|entry_point| EntryPointPathPointers {
            source_path: builder.append_count_z(entry_point.source_path),
            module_path: builder.append_count_z(entry_point.module_path),
        })
        .collect()
}

pub(crate) fn append_record(
    builder: &mut StringBuilder,
    input: &CompiledProgramInput<'_>,
    image: StringPointer,
    paths: &[EntryPointPathPointers],
    file_indices: &[Option<u32>],
) -> crate::Result<()> {
    let entry_points = input.entry_points;
    let entry_point_count = u32::try_from(entry_points.len()).map_err(|_| CORRUPTED)?;
    if paths.len() != entry_points.len() || file_indices.len() != entry_points.len() {
        return Err(CORRUPTED);
    }
    let mut entries = Vec::with_capacity(entry_points.len());
    for (index, entry_point) in entry_points.iter().enumerate() {
        let record = CompiledEntryPointRecord {
            file_index: file_indices[index].ok_or(CORRUPTED)?,
            module_id: entry_point.module_id.0,
            source_path: paths[index].source_path,
        };
        entries.push((
            record,
            entry_point.source_path,
            paths[index].module_path,
            index,
        ));
    }
    index_sort::sort_slice_unstable_by_key(&mut entries, |(record, ..)| record.file_index);
    if !entries.is_sorted_by(|(a, ..), (b, ..)| a.file_index < b.file_index) {
        return Err(CORRUPTED);
    }
    let mut source_path_order: Vec<u32> = (0..entry_point_count).collect();
    index_sort::sort_slice_unstable_by(&mut source_path_order, |&a, &b| {
        compare_source_paths(entries[a as usize].1, entries[b as usize].1).then(a.cmp(&b))
    });
    let records: Vec<CompiledEntryPointRecord> = entries.iter().map(|entry| entry.0).collect();
    let module_paths = entries
        .iter()
        .flat_map(|entry| [entry.2.offset, entry.2.length]);
    let module_paths: Vec<u32> = module_paths.collect();
    let mut places = vec![NO_ENTRY_POINT; entries.len()];
    for (place, entry) in (0..).zip(&entries) {
        places[entry.3] = place;
    }
    let package_names = encode_package_names(input.package_names, &places).ok_or(CORRUPTED)?;
    let header = CompiledProgramRecord {
        image,
        entry_point_count,
        flags: u32::from(input.preserves_source_paths) * PRESERVES_SOURCE_PATHS,
    };
    let _ = builder.add_concat(&[
        bytes_of(&header),
        slice_as_bytes(&records),
        slice_as_bytes(&source_path_order),
        slice_as_bytes(&module_paths),
        &package_names,
    ]);
    Ok(())
}

/// The number of names, a record a name, then the paths one after the other.
fn encode_package_names(names: &[CompiledPackageNameInput<'_>], places: &[u32]) -> Option<Vec<u8>> {
    let mut names: Vec<&CompiledPackageNameInput<'_>> = names.iter().collect();
    index_sort::sort_slice_unstable_by_key(&mut names, |name| name.path);
    if !names.is_sorted_by(|a, b| a.path < b.path) {
        return None;
    }
    let place_of = |entry_point: Option<u32>| match entry_point {
        Some(index) => places.get(index as usize).copied(),
        None => Some(NO_ENTRY_POINT),
    };
    let mut bytes = u32::try_from(names.len()).ok()?.to_le_bytes().to_vec();
    for name in &names {
        let length = u32::try_from(name.path.len()).ok()?;
        let words = [
            length,
            place_of(name.required)?,
            place_of(name.imported)?,
            u32::from(name.hides_other_paths),
        ];
        bytes.extend(words.into_iter().flat_map(u32::to_le_bytes));
    }
    for name in &names {
        bytes.extend_from_slice(name.path);
    }
    Some(bytes)
}

fn read_package_names(
    payload: &Payload,
    at: &mut usize,
    entry_point_count: usize,
) -> Option<Box<[CompiledPackageName]>> {
    let count = payload.bytes(*at, size_of::<u32>())?;
    let count = u32::from_le_bytes(count.try_into().ok()?) as usize;
    let records_at = at.checked_add(size_of::<u32>())?;
    let records = payload.bytes(records_at, count.checked_mul(PACKAGE_NAME_SIZE)?)?;
    let mut path_at = records_at.checked_add(records.len())?;
    let entry_point = |index: u32| match index {
        NO_ENTRY_POINT => Some(None),
        index => ((index as usize) < entry_point_count).then_some(Some(index)),
    };
    let mut names = Vec::with_capacity(count);
    for [length, required, imported, hides_other_paths] in
        records.as_chunks::<4>().0.as_chunks::<4>().0
    {
        let path = payload.bytes(path_at, u32::from_le_bytes(*length) as usize)?;
        path_at += path.len();
        names.push(CompiledPackageName {
            path,
            required: entry_point(u32::from_le_bytes(*required))?,
            imported: entry_point(u32::from_le_bytes(*imported))?,
            hides_other_paths: u32::from_le_bytes(*hides_other_paths) != 0,
        });
    }
    if !names.is_sorted_by(|a, b| a.path < b.path) {
        return None;
    }
    *at = path_at;
    Some(names.into_boxed_slice())
}

/// `base[..length]` stays readable as long as the graph read from it is in use (the contract of `from_bytes`).
#[derive(Copy, Clone)]
pub(crate) struct Payload {
    pub(crate) base: *const u8,
    pub(crate) length: usize,
    /// The descriptor `base` was mapped from, and the offset of `base` in that file.
    pub(crate) file: Option<ImageFile>,
}

impl Payload {
    fn bytes(&self, offset: usize, length: usize) -> Option<&'static [u8]> {
        if offset.checked_add(length)? > self.length {
            return None;
        }
        // SAFETY: the range lies in `base[..length]`; see `Payload`.
        Some(unsafe { core::slice::from_raw_parts(self.base.add(offset), length) })
    }

    fn pointed_bytes(&self, pointer: StringPointer) -> Option<&'static [u8]> {
        self.bytes(pointer.offset as usize, pointer.length as usize)
    }
}

pub(crate) fn read(
    payload: &Payload,
    record_at: &mut usize,
    file_count: usize,
) -> crate::Result<CompiledProgram> {
    try_read(payload, record_at, file_count).ok_or(CORRUPTED)
}

fn try_read(
    payload: &Payload,
    record_at: &mut usize,
    file_count: usize,
) -> Option<CompiledProgram> {
    let header = payload.bytes(*record_at, RECORD_SIZE)?.as_ptr();
    // SAFETY: `RECORD_SIZE` readable bytes, and every bit pattern is a valid record.
    let header: CompiledProgramRecord = unsafe { read_unaligned(header.cast()) };
    let entry_point_count = header.entry_point_count as usize;
    if entry_point_count > file_count {
        return None;
    }
    let entries_at = record_at.checked_add(RECORD_SIZE)?;
    let entries = payload.bytes(entries_at, entry_point_count.checked_mul(RECORD_SIZE)?)?;
    let order_at = entries_at.checked_add(entries.len())?;
    let order = payload.bytes(order_at, entry_point_count.checked_mul(size_of::<u32>())?)?;
    let module_paths_at = order_at.checked_add(order.len())?;
    let module_paths_size = entry_point_count.checked_mul(size_of::<StringPointer>())?;
    let module_paths = payload.bytes(module_paths_at, module_paths_size)?;
    let image = payload.pointed_bytes(header.image)?;
    if image.is_empty() {
        return None;
    }

    let mut entry_points: Vec<CompiledEntryPoint> = Vec::with_capacity(entry_point_count);
    let mut lowest_file_index: usize = 0;
    let module_paths = module_paths.as_chunks::<4>().0.as_chunks::<2>().0;
    for (bytes, [offset, length]) in entries
        .as_chunks::<RECORD_SIZE>()
        .0
        .iter()
        .zip(module_paths)
    {
        // SAFETY: `RECORD_SIZE` readable bytes, and every bit pattern is a valid record.
        let record: CompiledEntryPointRecord = unsafe { read_unaligned(bytes.as_ptr().cast()) };
        let module_path = StringPointer {
            offset: u32::from_le_bytes(*offset),
            length: u32::from_le_bytes(*length),
        };
        let file_index = record.file_index as usize;
        if file_index < lowest_file_index || file_index >= file_count {
            return None;
        }
        lowest_file_index = file_index + 1;
        entry_points.push(CompiledEntryPoint {
            file_index: record.file_index,
            module_id: record.module_id,
            source_path: payload.pointed_bytes(record.source_path)?,
            module_path: payload.pointed_bytes(module_path)?,
        });
    }

    let order = order.as_chunks::<4>().0.iter();
    let source_path_order: Box<[u32]> = order.map(|bytes| u32::from_le_bytes(*bytes)).collect();
    let is_in_range = |index: &u32| (*index as usize) < entry_point_count;
    if !source_path_order.iter().all(is_in_range) {
        return None;
    }

    let mut end = module_paths_at + module_paths_size;
    let package_names = read_package_names(payload, &mut end, entry_point_count)?;
    *record_at = end;
    let backing_file = payload.file.map(|file| ImageFile {
        descriptor: file.descriptor,
        offset: file.offset + i64::from(header.image.offset),
    });
    let program = CompiledProgram::new(
        image,
        backing_file,
        entry_points.into_boxed_slice(),
        source_path_order,
        header.flags & PRESERVES_SOURCE_PATHS != 0,
    );
    Some(program.with_package_names(package_names))
}

fn add_ancestor_directories(dirs: &mut StringArrayHashMap<()>, path: &[u8]) {
    let root_length = strings::index_of_char_usize(path, b'/').unwrap_or(path.len());
    let mut rest = path;
    while let Some(separator) = strings::last_index_of_char(rest, b'/') {
        rest = &rest[..separator];
        if rest.len() <= root_length || dirs.get_or_put(rest).is_ok_and(|dir| dir.found_existing) {
            return;
        }
    }
}

pub(crate) fn add_source_directories(
    dirs: &mut StringArrayHashMap<()>,
    files: &StringArrayHashMap<File>,
    program: &CompiledProgram,
) {
    if program.preserves_source_paths {
        for key in files.keys() {
            if !is_bun_standalone_file_path(key) {
                add_ancestor_directories(dirs, key);
            }
        }
    }
    let mut buffer = path_buffer_pool::get();
    for entry_point in program.entry_points.iter() {
        let source_path = entry_point.source_path;
        if source_path.len() <= buffer.len() {
            let source_path = resolve_path::platform_to_posix_buf(source_path, &mut buffer[..]);
            add_ancestor_directories(dirs, source_path);
        }
    }
}

/// Whether normalizing `name` changes nothing but a separator at its end: it starts at the root and none of its components is empty, `.` or `..`.
fn is_normalized_posix_path(name: &[u8]) -> bool {
    let Some(rest) = name.strip_prefix(b"/") else {
        return false;
    };
    let rest = rest.strip_suffix(b"/").unwrap_or(rest);
    rest.is_empty()
        || bun_core::strings::split(rest, b"/")
            .all(|component| !matches!(component, b"" | b"." | b".."))
}

/// `name` as a key of `files` and `dirs`: absolute, normalized, posix-separated, without trailing separators.
fn absolute_key<'a>(name: &[u8], buffer: &'a mut PathBuffer) -> Option<&'a ZStr> {
    let name = bun_paths::string_paths::without_nt_prefix::<u8>(name);
    if name.is_empty() || strings::contains_char(name, 0) {
        return None;
    }
    // Every `stat` that the disk fails comes by here, most of them with a path that is a key as it stands.
    if cfg!(not(windows)) && name.len() < buffer.len() && is_normalized_posix_path(name) {
        let length = name.strip_suffix(b"/").unwrap_or(name).len();
        buffer[..length].copy_from_slice(&name[..length]);
        buffer[length] = 0;
        return Some(ZStr::from_buf(&buffer[..], length));
    }
    let mut working_directory = path_buffer_pool::get();
    // On Windows an absolute name can still take its drive from the working directory.
    let base: &[u8] = if cfg!(windows) || !bun_paths::is_absolute(name) {
        let length = bun_sys::getcwd(&mut working_directory).ok()?;
        &working_directory[..length]
    } else {
        b"/"
    };
    let joined = resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
        base,
        &mut buffer[..],
        &[name],
    )?;
    let mut length = joined.len();
    resolve_path::platform_to_posix_in_place(&mut buffer[..length]);
    while length > 0 && buffer[length - 1] == b'/' {
        length -= 1;
    }
    buffer[length] = 0;
    Some(ZStr::from_buf(&buffer[..], length))
}

fn is_shared_library_name(name: &[u8]) -> bool {
    let has_extension = |extension: &&[u8]| name.ends_with(extension);
    if SHARED_LIBRARY_EXTENSIONS.iter().any(has_extension) {
        return true;
    }
    let Some(at) = strings::last_index_of(name, VERSIONED_SHARED_LIBRARY_EXTENSION) else {
        return false;
    };
    let version = &name[at + VERSIONED_SHARED_LIBRARY_EXTENSION.len()..];
    let is_version_byte = |byte: &u8| byte.is_ascii_digit() || *byte == b'.';
    !version.is_empty() && version.iter().all(is_version_byte)
}

#[cfg(not(windows))]
fn load_graph_file(descriptor: Fd, size: usize) -> Option<*mut u8> {
    let (access, flags) = (libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE);
    bun_sys::mmap(core::ptr::null_mut(), size, access, flags, descriptor, 0).ok()
}

#[cfg(windows)]
fn load_graph_file(descriptor: Fd, size: usize) -> Option<*mut u8> {
    const ALLOCATION_ALIGNMENT: usize = 64 * 1024;
    let layout = core::alloc::Layout::from_size_align(size, ALLOCATION_ALIGNMENT).ok()?;
    // SAFETY: `from_descriptor` passes at least `PAYLOAD_HEADER_SIZE`, so the layout is not empty.
    let base = unsafe { std::alloc::alloc_zeroed(layout) };
    if base.is_null() {
        return None;
    }
    // SAFETY: `size` initialized bytes that nothing else refers to. They are never freed.
    let bytes = unsafe { core::slice::from_raw_parts_mut(base, size) };
    let file = bun_sys::File::borrow(&descriptor);
    (file.pread_all(bytes, 0).ok()? == size).then_some(base)
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourcePathKind {
    File,
    Directory,
}

impl StandaloneModuleGraph {
    /// `descriptor` holds the result of `to_graph_bytes` and stays open: the engine maps the code from it.
    pub fn from_descriptor(descriptor: Fd) -> crate::Result<Option<*mut StandaloneModuleGraph>> {
        let size = bun_sys::get_file_size(descriptor).map_err(|_| CORRUPTED)?;
        let size = usize::try_from(size).map_err(|_| CORRUPTED)?;
        if size < PAYLOAD_HEADER_SIZE {
            return Err(CORRUPTED);
        }
        let base = load_graph_file(descriptor, size).ok_or(CORRUPTED)?;
        // SAFETY: `size >= PAYLOAD_HEADER_SIZE` bytes are readable at `base`.
        let length = u64::from_le_bytes(unsafe { base.cast::<[u8; PAYLOAD_HEADER_SIZE]>().read() });
        if length > (size - PAYLOAD_HEADER_SIZE) as u64 {
            return Err(CORRUPTED);
        }
        let file = ImageFile {
            descriptor: descriptor.native() as isize,
            offset: PAYLOAD_HEADER_SIZE as i64,
        };
        // SAFETY: `PAYLOAD_HEADER_SIZE <= size`.
        let payload = unsafe { base.add(PAYLOAD_HEADER_SIZE) };
        Self::from_payload(payload, length as usize, Some(file))
    }

    /// Whether a listing of `path` comes from the graph.
    pub fn owns_directory(&self, path: &[u8]) -> bool {
        if is_bun_standalone_file_path(path) {
            return true;
        }
        if self.compiled_program.is_none() {
            return false;
        }
        let mut buffer = path_buffer_pool::get();
        self.directory_key(path, &mut buffer).is_some()
    }

    fn find_common_start_of_source_paths(&self, program: &CompiledProgram) -> Option<Box<[u8]>> {
        let source_paths = program
            .entry_points
            .iter()
            .map(|entry_point| entry_point.source_path);
        let files = self
            .files
            .keys()
            .iter()
            .map(|key| &key[..])
            .filter(|key| !is_bun_standalone_file_path(key));
        source_paths
            .chain(files)
            .reduce(|common, path| {
                let length = common.iter().zip(path).take_while(|(a, b)| a == b).count();
                &common[..length]
            })
            .map(Box::from)
    }

    /// Whether `key`, as `absolute_key` makes it, can be a file or a directory that the graph answers for outside of its own root: each of those begins as all of them do, or is a directory above them all.
    fn is_near_source_paths(&self, program: &CompiledProgram, key: &[u8]) -> bool {
        if cfg!(windows) {
            return true;
        }
        let common = program
            .common_start_of_source_paths
            .get_or_init(|| self.find_common_start_of_source_paths(program));
        common.as_deref().is_some_and(|common| {
            let length = common.len().min(key.len());
            common[..length] == key[..length]
        })
    }

    /// For a path the disk does not have: whether any of `stat`, `find_ref`, `find_dir` and `source_path_kind` can find something there.
    pub fn may_answer_for(&self, path: &[u8]) -> bool {
        if is_bun_standalone_file_path(path) {
            return true;
        }
        let Some(program) = self.compiled_program.as_ref() else {
            return false;
        };
        let mut buffer = path_buffer_pool::get();
        absolute_key(path, &mut buffer)
            .is_some_and(|key| self.is_near_source_paths(program, key.as_bytes()))
    }

    /// For a path the disk does not have.
    pub fn source_path_kind(&self, path: &[u8]) -> Option<SourcePathKind> {
        let program = self.compiled_program.as_ref()?;
        let mut buffer = path_buffer_pool::get();
        let key = absolute_key(path, &mut buffer)?.as_bytes();
        if program.entry_point_by_source_path(key).is_some() {
            return Some(SourcePathKind::File);
        }
        let mut entry_points = program.entry_points_in_directory(key);
        entry_points.next().map(|_| SourcePathKind::Directory)
    }

    pub fn source_path_stat(&self, path: &[u8]) -> Option<Stat> {
        match self.source_path_kind(path)? {
            SourcePathKind::File => {
                let mut stat: Stat = bun_core::ffi::zeroed();
                stat.st_mode = (libc::S_IFREG | 0o644) as _;
                Some(stat)
            }
            SourcePathKind::Directory => Some(dir_stat()),
        }
    }

    /// `(path, contents)`.
    pub fn preserved_shared_libraries(&self) -> impl Iterator<Item = (&[u8], &[u8])> + '_ {
        let preserves_source_paths = self
            .compiled_program
            .as_ref()
            .map(|program| program.preserves_source_paths);
        self.files
            .iter()
            .take_while(move |_| preserves_source_paths.is_some())
            .filter(move |(key, _)| {
                preserves_source_paths != Some(is_bun_standalone_file_path(key))
                    && is_shared_library_name(key)
            })
            .map(|(key, file)| (&key[..], file.contents.as_bytes()))
    }

    /// A file that `--asset` or an import put into the executable of a compiled program as it is.
    pub fn is_asset_of_compiled_program(&self, name: &[u8], file: &File) -> bool {
        let Some(program) = self.compiled_program.as_ref() else {
            return false;
        };
        file.loader == bun_ast::Loader::File
            && program.preserves_source_paths != is_bun_standalone_file_path(name)
    }

    pub fn find_asset_under_root(&self, name: &[u8]) -> Option<&File> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        self.files
            .get(name)
            .filter(|file| self.is_asset_of_compiled_program(name, file))
    }

    pub fn find_at_source_path(&self, name: &[u8]) -> Option<&File> {
        let program = self.compiled_program.as_ref()?;
        if !program.preserves_source_paths {
            return None;
        }
        let mut buffer = path_buffer_pool::get();
        let key = absolute_key(name, &mut buffer)?;
        let file_index = self.files.get_index(key.as_bytes())?;
        // The file of an entry point is empty: its text is on the disk or nowhere.
        let is_entry_point = program
            .entry_point_by_file_index(u32::try_from(file_index).ok()?)
            .is_some();
        if is_entry_point && self.files.values()[file_index].loader.is_javascript_like() {
            return None;
        }
        // As for a directory, the disk wins: the file may have been written since the build, and the program may write it.
        let is_on_disk = bun_sys::exists(key.as_bytes());
        (!is_on_disk).then(|| &self.files.values()[file_index])
    }

    pub(crate) fn directory_key<'a>(
        &self,
        name: &'a [u8],
        buffer: &'a mut PathBuffer,
    ) -> Option<&'a [u8]> {
        if is_bun_standalone_file_path(name) {
            let key = Self::normalize_dir_path(name, buffer);
            return self.dirs.contains_key(key).then_some(key);
        }
        let program = self.compiled_program.as_ref()?;
        let key = absolute_key(name, buffer)?;
        if !self.is_near_source_paths(program, key.as_bytes())
            || !self.dirs.contains_key(key.as_bytes())
        {
            return None;
        }
        let is_on_disk = matches!(bun_sys::directory_exists_at(Fd::cwd(), key), Ok(true));
        (!is_on_disk).then_some(key.as_bytes())
    }

    pub(crate) fn entry_point_by_name(&self, name: &[u8]) -> Option<&CompiledEntryPoint> {
        let program = self.compiled_program.as_ref()?;
        #[cfg(windows)]
        let mut buffer = path_buffer_pool::get();
        #[cfg(windows)]
        let name = normalize_file_key(name, &mut buffer);
        match self.files.get_index(name) {
            Some(file_index) => program.entry_point_by_file_index(u32::try_from(file_index).ok()?),
            None => program.entry_point_by_module_path(name),
        }
    }

    /// The key of the module that the executable starts with.
    pub fn main_module_path(&self) -> &'static [u8] {
        let name = self.files.values()[self.entry_point_id as usize].name;
        match self.entry_point_by_name(name) {
            Some(entry_point) => entry_point.module_path,
            None => name,
        }
    }
}
