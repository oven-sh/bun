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
/// Behind the names of packages: for each entry point where its image begins in `CompiledProgramRecord::image`, and its length.
const HAS_IMAGE_FOR_EACH_ENTRY_POINT: u32 = 2;
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
    /// 0: `CompiledProgramInput::image`. Above: a position in `further_images`, plus one.
    pub image_index: u32,
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
    /// Of an executable whose entry points begin programs of their own.
    pub further_images: &'a [&'a [u8]],
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
    let further_images: usize = input.further_images.iter().map(|image| image.len()).sum();
    let image_ranges = match input.further_images.len() {
        0 => 0,
        _ => input.entry_points.len() * size_of::<StringPointer>(),
    };
    input.image.len()
        + further_images
        + image_ranges
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
    let alignment = input.image_alignment;
    let images = || core::iter::once(input.image).chain(input.further_images.iter().copied());
    if !alignment.is_power_of_two()
        || alignment < PAYLOAD_HEADER_SIZE
        || images().any(|image| image.is_empty() || !image.len().is_multiple_of(alignment))
    {
        return Err(Error::ImageMisaligned);
    }
    let unaligned_start = PAYLOAD_HEADER_SIZE + builder.len;
    let padding = unaligned_start.next_multiple_of(alignment) - unaligned_start;
    builder.writable()[..padding].fill(0);
    let offset = builder.len + padding;
    builder.len = offset;
    for image in images() {
        let destination = &mut builder.writable()[..image.len()];
        // SAFETY: `destination` is `image.len()` writable bytes of the builder's own buffer, which `image` does not overlap.
        unsafe {
            bun_core::copy_in_parallel(destination.as_mut_ptr(), image.as_ptr(), image.len());
        }
        builder.len += image.len();
    }
    Ok(StringPointer {
        offset: offset as u32,
        length: (builder.len - offset) as u32,
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
    let has_images = !input.further_images.is_empty();
    let header = CompiledProgramRecord {
        image,
        entry_point_count,
        flags: (u32::from(input.preserves_source_paths) * PRESERVES_SOURCE_PATHS)
            | (u32::from(has_images) * HAS_IMAGE_FOR_EACH_ENTRY_POINT),
    };
    let mut image_ranges: Vec<u32> = Vec::new();
    if has_images {
        let lengths = core::iter::once(input.image).chain(input.further_images.iter().copied());
        let mut ranges = Vec::with_capacity(1 + input.further_images.len());
        let mut start = 0u32;
        for length in lengths.map(|image| image.len() as u32) {
            ranges.push([start, length]);
            start += length;
        }
        for entry in &entries {
            let index = entry_points[entry.3].image_index as usize;
            image_ranges.extend(ranges.get(index).ok_or(CORRUPTED)?);
        }
    }
    let _ = builder.add_concat(&[
        bytes_of(&header),
        slice_as_bytes(&records),
        slice_as_bytes(&source_path_order),
        slice_as_bytes(&module_paths),
        &package_names,
        slice_as_bytes(&image_ranges),
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
    let mut images: Vec<&'static [u8]> = Vec::new();
    if header.flags & HAS_IMAGE_FOR_EACH_ENTRY_POINT != 0 {
        let ranges = payload.bytes(
            end,
            entry_point_count.checked_mul(size_of::<StringPointer>())?,
        )?;
        end += ranges.len();
        for [offset, length] in ranges.as_chunks::<4>().0.as_chunks::<2>().0 {
            let offset = u32::from_le_bytes(*offset) as usize;
            let part = image
                .get(offset..)?
                .get(..u32::from_le_bytes(*length) as usize)?;
            images.push(part);
        }
    }
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
    let program = program.with_images(images.into_boxed_slice());
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

#[cfg(test)]
pub(crate) mod tests {
    use bun_aot::engine::EngineModuleId;
    use bun_ast::Loader;
    use bun_bundler::options::{OutputFile, OutputFileValue, OutputKind};
    use bun_core::ZBox;
    use bun_options_types::bundle_enums::Format;

    use super::*;
    use crate::StandaloneModuleGraph::{
        BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX, CompileTarget, Flags, GraphRequest, Offsets,
        RuntimeOptions, to_graph_bytes,
    };
    use crate::executable_request::graph_bytes;

    const ALIGNMENT: usize = 4096;
    const IMAGE: [u8; ALIGNMENT] = [0xC3; ALIGNMENT];
    const FILE_COUNT: usize = 3;
    type EntryPoint<'a> = CompiledEntryPointInput<'a>;
    /// The bytes, the offset of the record in them, and the image.
    type Written = (Vec<u8>, usize, StringPointer);

    fn entry_point(id: u32, source_path: &[u8]) -> EntryPoint<'_> {
        EntryPoint {
            module_id: EngineModuleId(id),
            source_path,
            module_path: source_path,
            image_index: 0,
        }
    }

    fn program<'a>(
        image: &'a [u8],
        image_alignment: usize,
        entry_points: &'a [EntryPoint<'a>],
        preserves_source_paths: bool,
    ) -> CompiledProgramInput<'a> {
        CompiledProgramInput {
            image,
            further_images: &[],
            image_alignment,
            entry_points,
            package_names: &[],
            preserves_source_paths,
            symbols: b"",
        }
    }

    fn write(
        input: &CompiledProgramInput<'_>,
        file_indices: &[Option<u32>],
        prefix_length: usize,
    ) -> crate::Result<Written> {
        let mut builder = StringBuilder::init_capacity(prefix_length + capacity(input));
        let _ = builder.append_count(&vec![0xAA; prefix_length]);
        let image = append_image(&mut builder, input)?;
        let paths = append_entry_point_paths(&mut builder, input);
        let record_at = builder.len;
        append_record(&mut builder, input, image, &paths, file_indices)?;
        Ok((builder.written_slice().to_vec(), record_at, image))
    }

    fn write_three(preserves_source_paths: bool) -> Written {
        let entry_points = [
            entry_point(10, b"/a/b.ts"),
            entry_point(11, b"/ab/e.ts"),
            entry_point(12, b"/a/c/d.ts"),
        ];
        let input = program(&IMAGE, ALIGNMENT, &entry_points, preserves_source_paths);
        write(&input, &[Some(2), Some(1), Some(0)], 5).unwrap()
    }

    fn read_back(bytes: Vec<u8>, mut record_at: usize) -> crate::Result<(CompiledProgram, usize)> {
        let bytes: &'static [u8] = bytes.leak();
        let payload = Payload {
            base: bytes.as_ptr(),
            length: bytes.len(),
            file: None,
        };
        let program = read(&payload, &mut record_at, FILE_COUNT)?;
        Ok((program, record_at))
    }

    fn patch(bytes: &mut [u8], at: usize, word: u32) {
        bytes[at..at + 4].copy_from_slice(&word.to_le_bytes());
    }

    #[test]
    fn module_paths_follow_their_entry_points() {
        let mut entry_points = [entry_point(10, b"/a/b.ts"), entry_point(11, b"/a/c.mjs")];
        entry_points[0].module_path = b"/$bunfs/root/b.ts";
        entry_points[1].module_path = b"/$bunfs/root/c.mjs";
        let input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        let (bytes, record_at, _) = write(&input, &[Some(1), Some(0)], 3).unwrap();
        let length = bytes.len();
        let (program, record_end) = read_back(bytes, record_at).unwrap();
        assert_eq!(record_end, length);
        let paths = program
            .entry_points
            .iter()
            .map(|entry| (entry.module_id, entry.module_path));
        let expected: [(u32, &[u8]); 2] = [(11, b"/$bunfs/root/c.mjs"), (10, b"/$bunfs/root/b.ts")];
        assert!(paths.eq(expected));
    }

    #[test]
    fn each_entry_point_finds_its_image() {
        const SECOND: [u8; 2 * ALIGNMENT] = [0xA5; 2 * ALIGNMENT];
        const THIRD: [u8; ALIGNMENT] = [0x5A; ALIGNMENT];
        let mut entry_points = [
            entry_point(10, b"/a/b.ts"),
            entry_point(1, b"/a/c.ts"),
            entry_point(1, b"/a/d.ts"),
        ];
        entry_points[1].image_index = 1;
        entry_points[2].image_index = 2;
        let input = CompiledProgramInput {
            further_images: &[&SECOND[..], &THIRD[..]],
            ..program(&IMAGE, ALIGNMENT, &entry_points, false)
        };
        let (bytes, record_at, image) = write(&input, &[Some(2), Some(0), Some(1)], 7).unwrap();
        assert_eq!(image.length as usize, 4 * ALIGNMENT);
        assert_eq!((PAYLOAD_HEADER_SIZE + image.offset as usize) % ALIGNMENT, 0);
        let length = bytes.len();
        let (program, record_end) = read_back(bytes, record_at).unwrap();
        assert_eq!(record_end, length);
        assert_eq!(program.image.len(), 4 * ALIGNMENT);
        assert_eq!(program.first_image(), IMAGE);
        assert_eq!(program.image_beginning_at(b"/a/b.ts"), IMAGE);
        assert_eq!(program.image_beginning_at(b"/a/c.ts"), SECOND);
        assert_eq!(program.image_beginning_at(b"/a/d.ts"), THIRD);
        assert_eq!(program.image_beginning_at(b"/a/elsewhere.ts"), IMAGE);
        assert_eq!(program.images().count(), 3);
    }

    #[test]
    fn one_image_adds_nothing_to_the_record() {
        let (bytes, record_at, _) = write_three(false);
        let (program, _) = read_back(bytes, record_at).unwrap();
        assert_eq!(program.images().count(), 1);
        assert_eq!(program.first_image(), IMAGE);
        assert_eq!(program.image_beginning_at(b"/a/b.ts"), IMAGE);
    }

    #[test]
    fn record_round_trips() {
        let (mut bytes, record_at, _) = write_three(true);
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        assert_eq!(program.image, IMAGE);
        assert_eq!(program.backing_file, None);
        assert!(program.preserves_source_paths);
        let fields = program
            .entry_points
            .iter()
            .map(|entry| (entry.file_index, entry.module_id, entry.source_path));
        let expected: [(u32, u32, &[u8]); 3] = [
            (0, 12, b"/a/c/d.ts"),
            (1, 11, b"/ab/e.ts"),
            (2, 10, b"/a/b.ts"),
        ];
        assert_eq!(fields.collect::<Vec<_>>(), expected);
        for entry_point in program.entry_points.iter() {
            let found = program.entry_point_by_source_path(entry_point.source_path);
            assert_eq!(found, Some(entry_point));
        }
        let in_directory = program.entry_points_in_directory(b"/a");
        let module_ids: Vec<u32> = in_directory.map(|entry| entry.module_id).collect();
        assert_eq!(module_ids, [10, 12]);

        patch(&mut bytes, record_at + 12, !PRESERVES_SOURCE_PATHS);
        let (program, _) = read_back(bytes, record_at).unwrap();
        assert!(!program.preserves_source_paths);
    }

    #[test]
    fn package_names_round_trip() {
        let entry_points = [
            entry_point(10, b"/$bunfs/root/main.js"),
            entry_point(11, b"/$bunfs/root/node_modules/both/es.mjs"),
            entry_point(12, b"/$bunfs/root/node_modules/both/common.cjs"),
        ];
        let name = |path, required, imported, hides_other_paths| CompiledPackageNameInput {
            path,
            required,
            imported,
            hides_other_paths,
        };
        let names = [
            name(
                &b"/$bunfs/root/node_modules/both/feature"[..],
                None,
                Some(1),
                false,
            ),
            name(b"/$bunfs/root/node_modules/both", Some(2), Some(1), true),
        ];
        let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        input.package_names = &names;
        // The files of the graph are in another order than the entry points of the build.
        let (bytes, record_at, _) = write(&input, &[Some(2), Some(0), Some(1)], 5).unwrap();
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        program.set_module_lookup(|_| None);
        let search = bun_resolver::compiled_program::ExtensionSearch {
            extensions: &[],
            extra_extensions: &[],
            rewritten_extensions: &|_, _| &[],
        };
        let find = |specifier: &[u8], is_require| {
            program.resolve_package(
                b"/$bunfs/root/",
                b"/$bunfs/root/lib/",
                specifier,
                is_require,
                &search,
            )
        };
        assert_eq!(
            find(b"both", true),
            Some(&b"/$bunfs/root/node_modules/both/common.cjs"[..])
        );
        assert_eq!(
            find(b"both", false),
            Some(&b"/$bunfs/root/node_modules/both/es.mjs"[..])
        );
        assert_eq!(
            find(b"both/feature", false),
            Some(&b"/$bunfs/root/node_modules/both/es.mjs"[..])
        );
        assert_eq!(find(b"both/feature", true), None);
        assert_eq!(find(b"other", true), None);

        let names_at = bytes.len()
            - names
                .iter()
                .map(|name| PACKAGE_NAME_SIZE + name.path.len())
                .sum::<usize>();
        let mut out_of_range = bytes.clone();
        patch(&mut out_of_range, names_at + 4, 3);
        assert_eq!(read_back(out_of_range, record_at).err(), Some(CORRUPTED));
        let mut too_many = bytes.clone();
        patch(&mut too_many, names_at - 4, 3);
        assert_eq!(read_back(too_many, record_at).err(), Some(CORRUPTED));
        assert_eq!(
            read_back(bytes[..bytes.len() - 1].to_vec(), record_at).err(),
            Some(CORRUPTED)
        );

        let twice = [
            name(&b"/a"[..], Some(0), None, false),
            name(b"/a", None, Some(0), false),
        ];
        input.package_names = &twice;
        assert_eq!(
            write(&input, &[Some(2), Some(0), Some(1)], 0).err(),
            Some(CORRUPTED)
        );
        let no_such_entry_point = [name(&b"/a"[..], Some(3), None, false)];
        input.package_names = &no_such_entry_point;
        assert_eq!(
            write(&input, &[Some(2), Some(0), Some(1)], 0).err(),
            Some(CORRUPTED)
        );
    }

    #[test]
    fn image_alignment_after_prefix() {
        for page in [4096, 16384, 65536] {
            let image = vec![0xC3u8; page];
            let input = program(&image, page, &[], false);
            for prefix_length in [0, 1, 7, 8, page - 9, page - 8, page - 7, page + 3] {
                let (bytes, _, pointer) = write(&input, &[], prefix_length).unwrap();
                let offset = pointer.offset as usize;
                assert_eq!((PAYLOAD_HEADER_SIZE + offset) % page, 0);
                assert!(offset >= prefix_length && offset - prefix_length < page);
                assert!(bytes[prefix_length..offset].iter().all(|&byte| byte == 0));
                assert_eq!(bytes[offset..][..page], image[..]);
            }
        }
    }

    #[test]
    fn bad_input_is_rejected() {
        let (page, image) = (ALIGNMENT, [0u8; ALIGNMENT + 1]);
        for (length, alignment) in [(page, 3), (page, 0), (page, 4), (page + 1, page), (0, page)] {
            let input = program(&image[..length], alignment, &[], false);
            assert_eq!(write(&input, &[], 0).err(), Some(Error::ImageMisaligned));
        }
        let entry_points = [entry_point(1, b"/a/b.ts"), entry_point(2, b"/a/c.ts")];
        let input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        let bad_file_indices: [&[Option<u32>]; 4] = [
            &[Some(2), None],
            &[Some(2), Some(2)],
            &[Some(2)],
            &[Some(0), Some(1), Some(2)],
        ];
        for file_indices in bad_file_indices {
            assert_eq!(
                write(&input, file_indices, 0).err(),
                Some(CORRUPTED),
                "{file_indices:?}"
            );
        }
    }

    #[test]
    fn corrupted_records_are_rejected() {
        let (bytes, record, _) = write_three(false);
        let entry = |index: usize| record + RECORD_SIZE * (1 + index);
        let (length, file_count) = (bytes.len() as u32, FILE_COUNT as u32);
        for (name, at, word) in [
            ("more entry points than files", record + 8, file_count + 1),
            ("entry point count overflows", record + 8, u32::MAX),
            ("image offset past the end", record, length),
            ("image length past the end", record + 4, length),
            ("empty image", record + 4, 0),
            ("file index out of range", entry(2), file_count),
            ("repeated file index", entry(1), 0),
            ("descending file indices", entry(0), 2),
            ("source path offset past the end", entry(0) + 8, length),
            ("source path length past the end", entry(2) + 12, length),
            ("order entry out of range", entry(3) + 4, 3),
        ] {
            let mut bytes = bytes.clone();
            patch(&mut bytes, at, word);
            assert_eq!(read_back(bytes, record).err(), Some(CORRUPTED), "{name}");
        }
        for length in [record, entry(0) - 1, entry(3) - 1, bytes.len() - 1] {
            let truncated = bytes[..length].to_vec();
            assert_eq!(read_back(truncated, record).err(), Some(CORRUPTED));
        }
        for record_at in [bytes.len() + 1, usize::MAX] {
            assert_eq!(read_back(bytes.clone(), record_at).err(), Some(CORRUPTED));
        }
    }

    #[test]
    fn shared_library_names() {
        let is_library = |name: &str| is_shared_library_name(name.as_bytes());
        for name in ["x.so", "libx.so.1.2", "x.dylib", "x.dll", "/a.so.d/x.so.6"] {
            assert!(is_library(name), "{name}");
        }
        for name in ["x.song", "so", "a.node", "x.so.", "x.so.1a", "x.so.1/a", ""] {
            assert!(!is_library(name), "{name}");
        }
    }

    pub(crate) struct TemporaryFolder(Vec<u8>);

    impl TemporaryFolder {
        pub(crate) fn create(name: &str) -> TemporaryFolder {
            let mut path = std::env::temp_dir().into_os_string().into_encoded_bytes();
            let name = format!("/bun-compiled-program-{}-{name}", std::process::id());
            path.extend_from_slice(name.as_bytes());
            bun_sys::mkdir_recursive(&path).unwrap();
            let mut buffer = path_buffer_pool::get();
            let real_path = bun_sys::realpath(&ZBox::from_vec(path), &mut buffer).unwrap();
            let mut real_path = real_path.to_vec();
            resolve_path::platform_to_posix_in_place(&mut real_path);
            TemporaryFolder(real_path)
        }

        pub(crate) fn join(&self, relative: &str) -> Vec<u8> {
            [&self.0[..], b"/", relative.as_bytes()].concat()
        }

        pub(crate) fn write(&self, relative: &str, contents: &[u8]) -> ZBox {
            let path = ZBox::from_vec(self.join(relative));
            let file = bun_sys::File::create(Fd::cwd(), path.as_bytes(), true).unwrap();
            file.write_all(contents).unwrap();
            path
        }
    }

    impl Drop for TemporaryFolder {
        fn drop(&mut self) {
            let _ = bun_sys::delete_tree_absolute(&self.0);
        }
    }

    fn asset(dest_path: &[u8], contents: &[u8]) -> OutputFile {
        OutputFile {
            value: OutputFileValue::Buffer {
                bytes: contents.into(),
            },
            output_kind: OutputKind::Asset,
            dest_path: dest_path.into(),
            ..OutputFile::zero_value()
        }
    }

    fn entry_point_file(dest_path: &[u8], entry_point_index: Option<u32>) -> OutputFile {
        OutputFile {
            loader: Loader::Js,
            output_kind: OutputKind::EntryPoint,
            entry_point_index,
            ..asset(dest_path, b"")
        }
    }

    fn in_virtual_root(relative: &str) -> Vec<u8> {
        format!("{BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX}{relative}").into_bytes()
    }

    /// A program of two entry points and two assets whose sources were in `folder`.
    fn with_request<R>(
        folder: &TemporaryFolder,
        preserves_source_paths: bool,
        use_request: impl FnOnce(&GraphRequest<'_>) -> R,
    ) -> R {
        let entry_point_indices = [Some(0), Some(1)];
        with_entry_point_indices(
            folder,
            preserves_source_paths,
            entry_point_indices,
            use_request,
        )
    }

    /// `entry_point_indices` are those of the files `main.js` and `plugins/a.js`.
    fn with_entry_point_indices<R>(
        folder: &TemporaryFolder,
        preserves_source_paths: bool,
        entry_point_indices: [Option<u32>; 2],
        use_request: impl FnOnce(&GraphRequest<'_>) -> R,
    ) -> R {
        let names = ["main.js", "plugins/a.js", "data/note.txt", "lib/libx.so.1"];
        let [main, plugin, note, library] = names.map(|name| folder.join(name));
        let (skipped, module_prefix) = match preserves_source_paths {
            true => (0, Vec::new()),
            false => (folder.0.len() + 1, in_virtual_root("")),
        };
        let output_files = [
            entry_point_file(&main[skipped..], entry_point_indices[0]),
            entry_point_file(&plugin[skipped..], entry_point_indices[1]),
            asset(&note[skipped..], b"a note"),
            asset(&library[skipped..], b"a library"),
        ];
        let entry_points = [entry_point(1, &main), entry_point(2, &plugin)];
        let program = program(&IMAGE, ALIGNMENT, &entry_points, preserves_source_paths);
        use_request(&GraphRequest {
            target: &CompileTarget::default(),
            output_files: &output_files,
            module_prefix: &module_prefix,
            output_format: Format::Esm,
            exec_argv: b"",
            flags: Flags::default(),
            runtime_options: RuntimeOptions::default(),
            compiled_program: Some(program),
        })
    }

    fn read_graph(request: &GraphRequest<'_>) -> StandaloneModuleGraph {
        let bytes: &'static mut [u8] = graph_bytes(request).unwrap().bytes.leak();
        let offsets_at = bytes.len() - b"\n---- Bun! ----\n".len() - size_of::<Offsets>();
        // SAFETY: `to_bytes` ends the graph with its `Offsets` and the trailer.
        let offsets: Offsets = unsafe { read_unaligned(bytes[offsets_at..].as_ptr().cast()) };
        let (base, length) = (bytes.as_mut_ptr(), bytes.len());
        StandaloneModuleGraph::from_bytes(base, length, offsets, None).unwrap()
    }

    fn directory_key(graph: &StandaloneModuleGraph, name: &[u8]) -> Option<Vec<u8>> {
        let mut buffer = path_buffer_pool::get();
        graph.directory_key(name, &mut buffer).map(<[u8]>::to_vec)
    }

    fn find_module_id(graph: &StandaloneModuleGraph, relative: &str) -> Option<u32> {
        let entry_point = graph.entry_point_by_name(&in_virtual_root(relative))?;
        Some(entry_point.module_id)
    }

    #[cfg(not(windows))]
    #[test]
    fn a_path_that_is_normalized_is_its_own_key() {
        let key = |name: &[u8]| {
            let mut buffer = path_buffer_pool::get();
            absolute_key(name, &mut buffer).map(|key| key.as_bytes().to_vec())
        };
        for (name, expected) in [
            (&b"/"[..], &b""[..]),
            (b"/a", b"/a"),
            (b"/a/", b"/a"),
            (b"/a/b.c/.d/..e/...", b"/a/b.c/.d/..e/..."),
            (b"/a//", b"/a"),
            (b"//a", b"/a"),
            (b"/a//b", b"/a/b"),
            (b"/a/./b", b"/a/b"),
            (b"/a/.", b"/a"),
            (b"/a/b/..", b"/a"),
            (b"/a/../b/", b"/b"),
            (b"/..", b""),
        ] {
            assert_eq!(
                key(name).as_deref(),
                Some(expected),
                "{}",
                String::from_utf8_lossy(name)
            );
        }
        for normalized in [&b"/"[..], b"/a", b"/a/", b"/a/b.c/.d/..e/..."] {
            assert!(
                is_normalized_posix_path(normalized),
                "{}",
                String::from_utf8_lossy(normalized)
            );
        }
        for other in [
            &b""[..],
            b"a",
            b"a/b",
            b"./a",
            b"//",
            b"/a//",
            b"//a",
            b"/a//b",
            b"/a/./b",
            b"/a/.",
            b"/a/..",
            b"/.",
            b"/..",
        ] {
            assert!(
                !is_normalized_posix_path(other),
                "{}",
                String::from_utf8_lossy(other)
            );
        }
    }

    #[test]
    fn in_place_paths() {
        let folder = TemporaryFolder::create("in-place");
        let graph = with_request(&folder, true, read_graph);
        let find = |name: &[u8]| Some(graph.find_at_source_path(name)?.contents.as_bytes());
        let contents = |relative: &str| find(&folder.join(relative));
        let owns = |relative: &str| graph.owns_directory(&folder.join(relative));
        let key = |relative: &str| directory_key(&graph, &folder.join(relative));
        let (note, data) = (Some(&b"a note"[..]), folder.join("data"));

        assert_eq!(contents("data/note.txt"), note);
        assert_eq!(contents("lib/../data/./note.txt"), note);
        for absent in ["data/none.txt", "data", "main.js"] {
            assert_eq!(contents(absent), None, "{absent}");
        }
        assert_eq!((find(b""), find(b"/a\0b")), (None, None));
        assert_eq!(key("data/"), Some(data.clone()));
        assert!(owns("data") && owns("plugins"));
        assert!(!owns("none") && !owns("data/note.txt"));
        assert!(!graph.owns_directory(&folder.0) && !graph.owns_directory(b"/"));

        bun_sys::mkdir_recursive(&data).unwrap();
        folder.write("data/note.txt", b"on the disk");
        folder.write("data/none.txt", b"on the disk");
        assert_eq!(contents("data/note.txt"), None);
        assert_eq!(contents("data/none.txt"), None);
        assert_eq!(key("data"), None);
        assert!(!owns("data") && owns("plugins"));

        bun_sys::delete_tree_absolute(&data).unwrap();
        assert_eq!(contents("data/note.txt"), note);
        assert!(owns("data"));

        let libraries: Vec<_> = graph.preserved_shared_libraries().collect();
        let library = folder.join("lib/libx.so.1");
        assert_eq!(libraries, [(&library[..], &b"a library"[..])]);
    }

    #[test]
    fn entry_point_source_paths() {
        let folder = TemporaryFolder::create("entry-points");
        for preserves_source_paths in [true, false] {
            let graph = with_request(&folder, preserves_source_paths, read_graph);
            let kind = |relative: &str| graph.source_path_kind(&folder.join(relative));
            assert_eq!(kind("plugins/a.js"), Some(SourcePathKind::File));
            assert_eq!(kind("plugins"), Some(SourcePathKind::Directory));
            assert_eq!(kind("plugins/"), Some(SourcePathKind::Directory));
            for absent in ["data", "plug", "plugins/a.js/b"] {
                assert_eq!(kind(absent), None, "{absent}");
            }
            let stat = |relative: &str| graph.source_path_stat(&folder.join(relative));
            let file = stat("plugins/a.js").unwrap();
            assert!(bun_sys::S::ISREG(file.st_mode as _) && file.st_size == 0);
            assert!(bun_sys::S::ISDIR(stat("plugins").unwrap().st_mode as _));
            assert!(stat("none").is_none());
            bun_sys::mkdir_recursive(&folder.join("plugins")).unwrap();
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn a_path_far_from_the_sources_is_turned_away_at_once() {
        let folder = TemporaryFolder::create("far-away");
        for preserves_source_paths in [true, false] {
            let graph = with_request(&folder, preserves_source_paths, read_graph);
            for near in [
                "plugins/a.js",
                "plugins",
                "plugins/",
                "plugins/../plugins/a.js",
                "plugins/a.js/b",
            ] {
                assert!(graph.may_answer_for(&folder.join(near)), "{near}");
            }
            // A directory above them all is listed as one.
            let mut above = &folder.0[..];
            while let Some(at) = bun_core::strings::last_index_of_char(above, b'/') {
                above = &above[..at];
                assert!(graph.may_answer_for(if above.is_empty() { b"/" } else { above }));
            }
            for far in [
                &b"/no-such-root/plugins/a.js"[..],
                b"/no-such-root",
                b"/proc/self/none",
            ] {
                assert!(!graph.may_answer_for(far));
                assert!(
                    graph.stat(far).is_none()
                        && graph.source_path_kind(far).is_none()
                        && !graph.owns_directory(far)
                );
            }
            assert!(graph.may_answer_for(&in_virtual_root("anything")));
        }
    }

    #[test]
    fn relative_names() {
        let folder = TemporaryFolder::create("relative");
        let graph = with_request(&folder, true, read_graph);
        let answers = || {
            let is_found = graph.find_at_source_path(b"data/note.txt").is_some();
            let kind = graph.source_path_kind(b"./plugins/a.js");
            (is_found, graph.owns_directory(b"data"), kind)
        };
        assert_eq!(answers(), (false, false, None));

        let previous = bun_sys::getcwd_alloc().unwrap();
        bun_sys::chdir(&ZBox::from_bytes(&folder.0)).unwrap();
        let answers_in_folder = answers();
        bun_sys::chdir(&previous).unwrap();
        assert_eq!(answers_in_folder, (true, true, Some(SourcePathKind::File)));
    }

    #[test]
    fn virtual_root_paths() {
        let folder = TemporaryFolder::create("virtual-root");
        let mut graph = with_request(&folder, false, read_graph);
        let (note, plugins) = (folder.join("data/note.txt"), folder.join("plugins"));
        let none = in_virtual_root("none");

        assert!(graph.find_at_source_path(&note).is_none());
        assert_eq!(graph.preserved_shared_libraries().count(), 0);
        assert!(graph.owns_directory(&plugins) && !graph.owns_directory(&folder.0));
        assert_eq!(find_module_id(&graph, "plugins/a.js"), Some(2));
        assert_eq!(find_module_id(&graph, "data/note.txt"), None);
        assert_eq!(find_module_id(&graph, "none.js"), None);
        assert!(directory_key(&graph, &in_virtual_root("data/")).is_some());
        assert!(directory_key(&graph, &none).is_none() && graph.owns_directory(&none));

        graph.compiled_program = None;
        assert!(!graph.owns_directory(&plugins) && graph.owns_directory(&none));
        assert!(graph.source_path_kind(&plugins).is_none());
        assert!(graph.source_path_stat(&plugins).is_none());
        assert_eq!(find_module_id(&graph, "plugins/a.js"), None);
    }

    #[test]
    fn files_pair_with_entry_points_by_index() {
        let folder = TemporaryFolder::create("pairing");
        let graph = with_entry_point_indices(&folder, false, [Some(1), Some(0)], read_graph);
        assert_eq!(find_module_id(&graph, "main.js"), Some(2));
        assert_eq!(find_module_id(&graph, "plugins/a.js"), Some(1));

        for (name, entry_point_indices) in [
            ("entry point without a file", [Some(0), None]),
            ("two files of one entry point", [Some(0), Some(0)]),
            ("index past the entry points", [Some(0), Some(2)]),
        ] {
            let written =
                with_entry_point_indices(&folder, false, entry_point_indices, graph_bytes);
            assert_eq!(written.err(), Some(CORRUPTED), "{name}");
        }
    }

    #[test]
    fn graph_from_descriptor() {
        let folder = TemporaryFolder::create("descriptor");
        for malformed in [&b""[..], b"1234567", b"\x09\0\0\0\0\0\0\0payload."] {
            let path = folder.write("malformed", malformed);
            let file = bun_sys::File::open(&path, bun_sys::O::RDONLY, 0).unwrap();
            let graph = StandaloneModuleGraph::from_descriptor(file.handle());
            assert_eq!(graph.err(), Some(CORRUPTED));
        }

        let bytes = with_request(&folder, true, |request| to_graph_bytes(request).unwrap());
        let path = folder.write("graph", &bytes);
        let descriptor = bun_sys::open(&path, bun_sys::O::RDONLY, 0).unwrap();
        let graph = StandaloneModuleGraph::from_descriptor(descriptor).unwrap();
        // SAFETY: the process-wide graph, which is never freed. No other test installs one.
        let graph = unsafe { &*graph.unwrap() };
        let program = graph.compiled_program.as_ref().unwrap();
        let backing_file = program.backing_file.unwrap();
        assert_eq!(backing_file.descriptor, descriptor.native() as isize);
        assert_eq!(backing_file.offset % ALIGNMENT as i64, 0);
        assert_eq!(program.image, IMAGE);
        assert_eq!(bytes[backing_file.offset as usize..][..ALIGNMENT], IMAGE);
    }
}
