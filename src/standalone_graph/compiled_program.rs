//! What a compiled program adds to the standalone module graph: its record, the graph handed over by descriptor, and the paths outside the virtual root that the graph answers for.

use core::mem::size_of;
use core::ptr::read_unaligned;
#[cfg(not(windows))]
use core::sync::atomic::{AtomicU64, Ordering};
use std::borrow::Cow;

use bun_collections::StringArrayHashMap;
use bun_collections::index_sort;
use bun_core::{StringBuilder, StringPointer, ZStr, bytes_of, slice_as_bytes};
use bun_paths::{PathBuffer, path_buffer_pool, platform, resolve_path, strings};
use bun_resolver::compiled_program::{
    CompiledEntryPoint, CompiledFurtherPackageName, CompiledPackageName, CompiledPathAlias,
    CompiledProgram, FoundForFileSystemAlone, ImageFile, RefusedData, compare_source_paths,
    name_in_plain_executable,
};
use bun_resolver::package_names::FurtherPackageName;
use bun_sys::{Fd, Stat};
#[cfg(not(windows))]
use bun_sys::{Maybe, PosixStat};

use crate::Error;
#[cfg(windows)]
use crate::StandaloneModuleGraph::normalize_file_key;
use crate::StandaloneModuleGraph::{
    BASE_PUBLIC_PATH, BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX, File, StandaloneModuleGraph, dir_stat,
    is_bun_standalone_file_path,
};

const CORRUPTED: Error = Error::CorruptedCompiledProgram;
/// The `u64` length before the payload, in a section of an executable and in `to_graph_bytes`.
const PAYLOAD_HEADER_SIZE: usize = size_of::<u64>();
const RECORD_SIZE: usize = 4 * size_of::<u32>();
const PRESERVES_SOURCE_PATHS: u32 = 1;
/// Behind the path aliases: the length of `CompiledProgramInput::root_below_working_directory`, then the path.
const HAS_ROOT_BELOW_WORKING_DIRECTORY: u32 = 4;
const ALLOWS_CODE_FROM_DISK: u32 = 8;
const HAS_ROOT_FOLDERS_SPELLED: u32 = 16;
const HAS_ROOT_FROM_EXECUTABLE: u32 = 32;
const HAS_FURTHER_PACKAGE_NAMES: u32 = 64;
const HAS_ROOT_ON_BUILD_MACHINE: u32 = 128;
const HAS_ASSETS_NAMED_AT_ROOT: u32 = 256;
const NAMES_PLUGIN: u32 = 512;
const HAS_LEVELS_ABOVE_ROOT: u32 = 1024;
/// Behind the further names of packages: the length of `CompiledProgramInput::refused_data`, then the records.
const HAS_REFUSED_DATA: u32 = 2048;
/// Behind the refused data: the length of `CompiledProgramInput::loaders_given_to_build`, then the bytes.
const HAS_LOADERS_GIVEN_TO_BUILD: u32 = 4096;
/// `st_dev` of embedded files and folders. No real device has this number.
const EMBEDDED_FILES_DEVICE: u32 = 0x6275_6e66;

/// Behind the loaders: the length of `CompiledProgramInput::files_for_file_system_alone`, then the bytes.
const HAS_FILES_FOR_FILE_SYSTEM_ALONE: u32 = 8192;
/// The length of the path, what `require` and what `import` find, and what the name hides.
const PACKAGE_NAME_SIZE: usize = 4 * size_of::<u32>();
const HIDES_OTHER_PATHS: u32 = 1;
const IS_HIDDEN_FROM_REQUIRE: u32 = 2;
const IS_HIDDEN_FROM_IMPORT: u32 = 4;
const PATH_ALIAS_SIZE: usize = 4 * size_of::<u32>();
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

bun_core::impl_no_uninit!(CompiledProgramRecord, CompiledEntryPointRecord);

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
    pub is_hidden_from_require: bool,
    pub is_hidden_from_import: bool,
}

/// `CompiledPathAlias`
pub struct CompiledPathAliasInput<'a> {
    pub folder: &'a [u8],
    pub key: &'a [u8],
    pub target: &'a [u8],
    pub is_base_url: bool,
}

#[derive(Copy, Clone)]
pub(crate) struct EntryPointPathPointers {
    source_path: StringPointer,
    module_path: StringPointer,
}

/// Where the bytes of the image are when the graph is written.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ImagePlace {
    InGraph,
    /// They stay where they lie. Their room in the graph holds nothing.
    OutsideGraph,
}

pub struct CompiledProgramInput<'a> {
    /// Where the engine left it. While an executable is written the addresses in it are those of the executable.
    pub image: &'a mut [u8],
    pub image_alignment: usize,
    /// Entry point `i` belongs to the output file whose `entry_point_index` is `Some(i)`.
    pub entry_points: &'a [CompiledEntryPointInput<'a>],
    pub package_names: &'a [CompiledPackageNameInput<'a>],
    pub path_aliases: &'a [CompiledPathAliasInput<'a>],
    /// `CompiledProgram::root_below_working_directory`
    pub root_below_working_directory: Option<&'a [u8]>,
    /// `--aot-allow-code-from-disk`
    pub allows_code_from_disk: bool,
    pub names_plugin: bool,
    /// `CompiledProgram::root_folders_spelled`. Empty where the program spells none.
    pub root_folders_spelled: &'a [u8],
    /// `CompiledProgram::root_from_executable`
    pub root_from_executable: Option<&'a [u8]>,
    /// `CompiledProgram::root_on_build_machine`
    pub root_on_build_machine: Option<&'a [u8]>,
    /// `CompiledProgram::assets_named_at_root`. Empty where there are none.
    pub assets_named_at_root: &'a [u8],
    /// `CompiledProgram::refused_data`. Empty where no parser refused a file.
    pub refused_data: &'a [u8],
    /// `CompiledProgram::loaders_given_to_build`. Empty where the build was given none.
    pub loaders_given_to_build: &'a [u8],
    /// `CompiledProgram::files_for_file_system_alone`. Empty where the build laid none.
    pub files_for_file_system_alone: &'a [u8],
    /// `CompiledProgram::levels_above_root`
    pub levels_above_root: u32,
    /// Ascending by path.
    pub further_package_names: &'a [FurtherPackageName],
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
    let path_aliases: usize = input
        .path_aliases
        .iter()
        .map(|it| PATH_ALIAS_SIZE + it.folder.len() + it.key.len() + it.target.len())
        .sum();
    input.image.len()
        + input.image_alignment
        + RECORD_SIZE
        + entry_points
        + size_of::<u32>()
        + package_names
        + size_of::<u32>()
        + path_aliases
        + size_of::<u32>()
        + input.root_below_working_directory.map_or(0, <[u8]>::len)
        + size_of::<u32>()
        + input.root_folders_spelled.len()
        + size_of::<u32>()
        + input.root_from_executable.map_or(0, <[u8]>::len)
        + size_of::<u32>()
        + input.root_on_build_machine.map_or(0, <[u8]>::len)
        + size_of::<u32>()
        + input.assets_named_at_root.len()
        + size_of::<u32>()
        + input.refused_data.len()
        + size_of::<u32>()
        + input.loaders_given_to_build.len()
        + size_of::<u32>()
        + input.files_for_file_system_alone.len()
        + size_of::<u32>()
        + encode_further_package_names(input.further_package_names).len()
}

pub(crate) fn append_image(
    builder: &mut StringBuilder,
    input: &CompiledProgramInput<'_>,
    place: ImagePlace,
) -> crate::Result<StringPointer> {
    let alignment = input.image_alignment;
    let image = &*input.image;
    if !alignment.is_power_of_two()
        || alignment < PAYLOAD_HEADER_SIZE
        || image.is_empty()
        || !image.len().is_multiple_of(alignment)
    {
        return Err(Error::ImageMisaligned);
    }
    let unaligned_start = PAYLOAD_HEADER_SIZE + builder.len;
    let padding = unaligned_start.next_multiple_of(alignment) - unaligned_start;
    builder.writable()[..padding].fill(0);
    let offset = builder.len + padding;
    builder.len = offset;
    let destination = &mut builder.writable()[..image.len()];
    if place == ImagePlace::InGraph {
        // SAFETY: `destination` is `image.len()` writable bytes of the builder's own buffer, which `image` does not overlap.
        unsafe {
            bun_core::copy_in_parallel(destination.as_mut_ptr(), image.as_ptr(), image.len());
        }
    }
    builder.len += image.len();
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
    let path_aliases = encode_path_aliases(input.path_aliases).ok_or(CORRUPTED)?;
    let header = CompiledProgramRecord {
        image,
        entry_point_count,
        flags: (u32::from(input.preserves_source_paths) * PRESERVES_SOURCE_PATHS)
            | (u32::from(input.root_below_working_directory.is_some())
                * HAS_ROOT_BELOW_WORKING_DIRECTORY)
            | (u32::from(input.allows_code_from_disk) * ALLOWS_CODE_FROM_DISK)
            | (u32::from(input.names_plugin) * NAMES_PLUGIN)
            | (u32::from(!input.root_folders_spelled.is_empty()) * HAS_ROOT_FOLDERS_SPELLED)
            | (u32::from(input.root_from_executable.is_some()) * HAS_ROOT_FROM_EXECUTABLE)
            | (u32::from(input.root_on_build_machine.is_some()) * HAS_ROOT_ON_BUILD_MACHINE)
            | (u32::from(!input.assets_named_at_root.is_empty()) * HAS_ASSETS_NAMED_AT_ROOT)
            | (u32::from(input.levels_above_root != 0) * HAS_LEVELS_ABOVE_ROOT)
            | (u32::from(!input.further_package_names.is_empty()) * HAS_FURTHER_PACKAGE_NAMES)
            | (u32::from(!input.refused_data.is_empty()) * HAS_REFUSED_DATA)
            | (u32::from(!input.loaders_given_to_build.is_empty()) * HAS_LOADERS_GIVEN_TO_BUILD)
            | (u32::from(!input.files_for_file_system_alone.is_empty())
                * HAS_FILES_FOR_FILE_SYSTEM_ALONE),
    };
    let root = match input.root_below_working_directory {
        Some(root) => [
            &u32::try_from(root.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            root,
        ]
        .concat(),
        None => Vec::new(),
    };
    let root_folders = match input.root_folders_spelled {
        b"" => Vec::new(),
        folders => [
            &u32::try_from(folders.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            folders,
        ]
        .concat(),
    };
    let root_from_executable = match input.root_from_executable {
        Some(root) => [
            &u32::try_from(root.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            root,
        ]
        .concat(),
        None => Vec::new(),
    };
    let root_on_build_machine = match input.root_on_build_machine {
        Some(root) => [
            &u32::try_from(root.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            root,
        ]
        .concat(),
        None => Vec::new(),
    };
    let assets_named_at_root = match input.assets_named_at_root {
        b"" => Vec::new(),
        paths => [
            &u32::try_from(paths.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            paths,
        ]
        .concat(),
    };
    let levels_above_root = match input.levels_above_root {
        0 => Vec::new(),
        levels => levels.to_le_bytes().to_vec(),
    };
    let refused_data = match input.refused_data {
        b"" => Vec::new(),
        records => [
            &u32::try_from(records.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            records,
        ]
        .concat(),
    };
    let loaders_given_to_build = match input.loaders_given_to_build {
        b"" => Vec::new(),
        loaders => [
            &u32::try_from(loaders.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            loaders,
        ]
        .concat(),
    };
    let files_for_file_system_alone = match input.files_for_file_system_alone {
        b"" => Vec::new(),
        files => [
            &u32::try_from(files.len())
                .map_err(|_| CORRUPTED)?
                .to_le_bytes()[..],
            files,
        ]
        .concat(),
    };
    let _ = builder.add_concat(&[
        bytes_of(&header),
        slice_as_bytes(&records),
        slice_as_bytes(&source_path_order),
        slice_as_bytes(&module_paths),
        &package_names,
        &path_aliases,
        &root,
        &root_folders,
        &root_from_executable,
        &root_on_build_machine,
        &assets_named_at_root,
        &levels_above_root,
        &encode_further_package_names(input.further_package_names),
        &refused_data,
        &loaders_given_to_build,
        &files_for_file_system_alone,
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
            (u32::from(name.hides_other_paths) * HIDES_OTHER_PATHS)
                | (u32::from(name.is_hidden_from_require) * IS_HIDDEN_FROM_REQUIRE)
                | (u32::from(name.is_hidden_from_import) * IS_HIDDEN_FROM_IMPORT),
        ];
        bytes.extend(words.into_iter().flat_map(u32::to_le_bytes));
    }
    for name in &names {
        bytes.extend_from_slice(name.path);
    }
    Some(bytes)
}

// The number of names, then of each: its three strings, each behind its length, a length of u32::MAX for none, and a word for `hides_other_paths`.
fn encode_further_package_names(names: &[FurtherPackageName]) -> Vec<u8> {
    if names.is_empty() {
        return Vec::new();
    }
    let mut bytes = (names.len() as u32).to_le_bytes().to_vec();
    let add = |bytes: &mut Vec<u8>, text: Option<&[u8]>| match text {
        Some(text) => {
            bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
            bytes.extend_from_slice(text);
        }
        None => bytes.extend_from_slice(&u32::MAX.to_le_bytes()),
    };
    for name in names {
        add(&mut bytes, Some(&name.path));
        add(&mut bytes, name.required.as_deref());
        add(&mut bytes, name.imported.as_deref());
        bytes.extend_from_slice(&u32::from(name.hides_other_paths).to_le_bytes());
    }
    bytes
}

fn read_further_package_names(
    payload: &Payload,
    at: &mut usize,
) -> Option<Vec<CompiledFurtherPackageName>> {
    let word = |at: &mut usize| {
        let bytes = payload.bytes(*at, size_of::<u32>())?;
        *at += size_of::<u32>();
        Some(u32::from_le_bytes(bytes.try_into().ok()?))
    };
    let text = |at: &mut usize| -> Option<Option<&'static [u8]>> {
        let length = word(at)?;
        if length == u32::MAX {
            return Some(None);
        }
        let bytes = payload.bytes(*at, length as usize)?;
        *at += bytes.len();
        Some(Some(bytes))
    };
    let count = word(at)? as usize;
    let mut names = Vec::new();
    for _ in 0..count {
        let path = text(at)??;
        let required = text(at)?;
        let imported = text(at)?;
        let hides_other_paths = word(at)? != 0;
        names.push(CompiledFurtherPackageName {
            path,
            required,
            imported,
            hides_other_paths,
        });
    }
    names.is_sorted_by(|a, b| a.path < b.path).then_some(names)
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
    for [length, required, imported, hidden] in records.as_chunks::<4>().0.as_chunks::<4>().0 {
        let path = payload.bytes(path_at, u32::from_le_bytes(*length) as usize)?;
        path_at += path.len();
        let hidden = u32::from_le_bytes(*hidden);
        names.push(CompiledPackageName {
            path,
            required: entry_point(u32::from_le_bytes(*required))?,
            imported: entry_point(u32::from_le_bytes(*imported))?,
            hides_other_paths: hidden & HIDES_OTHER_PATHS != 0,
            is_hidden_from_require: hidden & IS_HIDDEN_FROM_REQUIRE != 0,
            is_hidden_from_import: hidden & IS_HIDDEN_FROM_IMPORT != 0,
        });
    }
    if !names.is_sorted_by(|a, b| a.path < b.path) {
        return None;
    }
    *at = path_at;
    Some(names.into_boxed_slice())
}

/// The number of aliases, a record an alias, then the three strings of each one after the other.
fn encode_path_aliases(aliases: &[CompiledPathAliasInput<'_>]) -> Option<Vec<u8>> {
    let mut bytes = u32::try_from(aliases.len()).ok()?.to_le_bytes().to_vec();
    for alias in aliases {
        let words = [
            u32::try_from(alias.folder.len()).ok()?,
            u32::try_from(alias.key.len()).ok()?,
            u32::try_from(alias.target.len()).ok()?,
            u32::from(alias.is_base_url),
        ];
        bytes.extend(words.into_iter().flat_map(u32::to_le_bytes));
    }
    for alias in aliases {
        bytes.extend([alias.folder, alias.key, alias.target].concat());
    }
    Some(bytes)
}

fn read_path_aliases(payload: &Payload, at: &mut usize) -> Option<Box<[CompiledPathAlias]>> {
    let count = payload.bytes(*at, size_of::<u32>())?;
    let count = u32::from_le_bytes(count.try_into().ok()?) as usize;
    let records_at = at.checked_add(size_of::<u32>())?;
    let records = payload.bytes(records_at, count.checked_mul(PATH_ALIAS_SIZE)?)?;
    let mut string_at = records_at.checked_add(records.len())?;
    let mut read_string = |length: &[u8; 4]| {
        let string = payload.bytes(string_at, u32::from_le_bytes(*length) as usize)?;
        string_at += string.len();
        Some(string)
    };
    let mut aliases = Vec::with_capacity(count);
    for [folder, key, target, is_base_url] in records.as_chunks::<4>().0.as_chunks::<4>().0 {
        aliases.push(CompiledPathAlias {
            folder: read_string(folder)?,
            key: read_string(key)?,
            target: read_string(target)?,
            is_base_url: u32::from_le_bytes(*is_base_url) != 0,
        });
    }
    *at = string_at;
    Some(aliases.into_boxed_slice())
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
    let path_aliases = read_path_aliases(payload, &mut end)?;
    let mut root_below_working_directory = None;
    if header.flags & HAS_ROOT_BELOW_WORKING_DIRECTORY != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        root_below_working_directory = Some(payload.bytes(end, length)?);
        end += length;
    }
    let mut root_folders_spelled: &'static [u8] = b"";
    if header.flags & HAS_ROOT_FOLDERS_SPELLED != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        root_folders_spelled = payload.bytes(end, length)?;
        end += length;
    }
    let mut root_from_executable = None;
    if header.flags & HAS_ROOT_FROM_EXECUTABLE != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        root_from_executable = Some(payload.bytes(end, length)?);
        end += length;
    }
    let mut root_on_build_machine = None;
    if header.flags & HAS_ROOT_ON_BUILD_MACHINE != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        root_on_build_machine = Some(payload.bytes(end, length)?);
        end += length;
    }
    let mut assets_named_at_root: &'static [u8] = b"";
    if header.flags & HAS_ASSETS_NAMED_AT_ROOT != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        assets_named_at_root = payload.bytes(end, length)?;
        end += length;
    }
    let mut levels_above_root = 0;
    if header.flags & HAS_LEVELS_ABOVE_ROOT != 0 {
        let levels = payload.bytes(end, size_of::<u32>())?;
        levels_above_root = u32::from_le_bytes(levels.try_into().ok()?) as usize;
        end += size_of::<u32>();
    }
    let mut further_package_names = Vec::new();
    if header.flags & HAS_FURTHER_PACKAGE_NAMES != 0 {
        further_package_names = read_further_package_names(payload, &mut end)?;
    }
    let mut refused_data: &'static [u8] = b"";
    if header.flags & HAS_REFUSED_DATA != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        refused_data = payload.bytes(end, length)?;
        end += length;
    }
    let mut loaders_given_to_build: &'static [u8] = b"";
    if header.flags & HAS_LOADERS_GIVEN_TO_BUILD != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        loaders_given_to_build = payload.bytes(end, length)?;
        end += length;
    }
    let mut files_for_file_system_alone: &'static [u8] = b"";
    if header.flags & HAS_FILES_FOR_FILE_SYSTEM_ALONE != 0 {
        let length = payload.bytes(end, size_of::<u32>())?;
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        end += size_of::<u32>();
        files_for_file_system_alone = payload.bytes(end, length)?;
        end += length;
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
    let program = program.with_package_names(package_names);
    let program = program.with_root_below_working_directory(root_below_working_directory);
    let program = program.with_code_from_disk(header.flags & ALLOWS_CODE_FROM_DISK != 0);
    let program = program.with_plugin_named(header.flags & NAMES_PLUGIN != 0);
    let program = program.with_root_folders_spelled(root_folders_spelled);
    let program = program.with_root_from_executable(root_from_executable);
    let program = program.with_root_on_build_machine(root_on_build_machine);
    let program = program.with_assets_named_at_root(assets_named_at_root);
    let program = program.with_refused_data(refused_data);
    let program = program.with_loaders_given_to_build(loaders_given_to_build);
    let program = program.with_files_for_file_system_alone(files_for_file_system_alone);
    let program = program.with_levels_above_root(levels_above_root);
    let program = program.with_further_package_names(further_package_names.into_boxed_slice());
    Some(program.with_path_aliases(path_aliases))
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
    if !name.starts_with(b"/") {
        return false;
    }
    let name = name.strip_suffix(b"/").unwrap_or(name);
    name.is_empty() || (!name.ends_with(b"/") && bun_highway::index_of_untidy_slash(name).is_none())
}

/// The keys of what the program has removed from the disk or renamed there.
static REMOVED_PATHS: bun_threading::Guarded<Vec<Box<[u8]>>> =
    bun_threading::Guarded::new(Vec::new());
/// Almost no program removes what its executable holds.
static HAS_REMOVED_PATHS: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// Whether the program has removed `key`, or a folder around it. `key` is a path on the disk or that of a file in the executable. What is not on the disk was never deployed, or was there until a moment ago, and the disk does not say which.
pub(crate) fn is_removed_by_program(key: &[u8]) -> bool {
    if !HAS_REMOVED_PATHS.load(core::sync::atomic::Ordering::Acquire) {
        return false;
    }
    let removed = REMOVED_PATHS.lock();
    removed.iter().any(|it| is_at_or_below(key, it))
}

fn record_removed_path(key: &[u8]) {
    let mut removed = REMOVED_PATHS.lock();
    if removed.iter().any(|it| is_at_or_below(key, it)) {
        return;
    }
    removed.retain(|it| !is_at_or_below(it, key));
    removed.push(key.into());
    HAS_REMOVED_PATHS.store(true, core::sync::atomic::Ordering::Release);
}

fn is_at_or_below(path: &[u8], ancestor: &[u8]) -> bool {
    let below = path.strip_prefix(ancestor);
    below.is_some_and(|it| it.is_empty() || it[0] == b'/')
}

/// A file that nobody asked the build to embed, which the program has written on the disk.
struct WrittenFile {
    /// Its path under the root of the executable.
    path: Box<[u8]>,
    /// Its key in the graph.
    key: Box<[u8]>,
    path_on_disk: Box<[u8]>,
}

static WRITTEN_FILES: bun_threading::Guarded<Vec<WrittenFile>> =
    bun_threading::Guarded::new(Vec::new());
static HAS_WRITTEN_FILES: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// `name` as an absolute path without `.` and `..`.
pub fn normalize_source_path(name: &[u8]) -> Option<Box<[u8]>> {
    let mut buffer = path_buffer_pool::get();
    Some(absolute_key(name, &mut buffer)?.as_bytes().into())
}

pub fn has_written_files() -> bool {
    HAS_WRITTEN_FILES.load(core::sync::atomic::Ordering::Acquire)
}

/// Where the disk has the file that the program has written, if `name` is its path under the root of the executable. What another process has laid there is not trusted.
pub fn find_written_file(name: &[u8]) -> Option<Box<[u8]>> {
    if !has_written_files() || !is_bun_standalone_file_path(name) {
        return None;
    }
    let mut buffer = path_buffer_pool::get();
    let name = absolute_key(name, &mut buffer)?.as_bytes();
    let graph = StandaloneModuleGraph::get_ref();
    let key = graph.and_then(|it| Some(it.lookup_file(name)?.name));
    let path = {
        let written = WRITTEN_FILES.lock();
        let is_meant = |it: &&WrittenFile| *it.path == *name || key == Some(&*it.key);
        written.iter().find(is_meant)?.path_on_disk.clone()
    };
    // A write that fails leaves the copy in the executable.
    bun_sys::exists(&path).then_some(path)
}

/// Visits the paths under the root of the executable of what the program has written in `folder`, as far as it is on the disk.
pub(crate) fn for_each_written_file(folder: &[u8], visit: &mut dyn FnMut(&[u8])) {
    if has_written_files() {
        let written = WRITTEN_FILES.lock();
        let below = written.iter().filter(|it| is_at_or_below(&it.path, folder));
        let on_disk = below.filter(|it| bun_sys::exists(&it.path_on_disk));
        on_disk.for_each(|it| visit(&it.path));
    }
}

fn record_written_file(path: &[u8], key: &[u8], path_on_disk: &[u8]) {
    let mut written = WRITTEN_FILES.lock();
    if !written.iter().any(|it| *it.path == *path) {
        written.push(WrittenFile {
            path: path.into(),
            key: key.into(),
            path_on_disk: path_on_disk.into(),
        });
        HAS_WRITTEN_FILES.store(true, core::sync::atomic::Ordering::Release);
    }
}

/// What of the program the disk had when the program was about to start its first process, or to remove a folder. What is gone later was removed, by whomever.
struct FoundOnDisk {
    /// The files that nobody asked the build to embed, by their keys in the graph.
    files: StringArrayHashMap<Box<[u8]>>,
    /// Those files, and the folders with them and with entry points.
    paths: StringArrayHashMap<()>,
}

static FOUND_ON_DISK: std::sync::OnceLock<FoundOnDisk> = std::sync::OnceLock::new();

fn found_on_disk() -> Option<&'static FoundOnDisk> {
    FOUND_ON_DISK.get().filter(|found| found.paths.count() != 0)
}

impl FoundOnDisk {
    /// Returns true if the disk has `folder`, a folder of the program. Then it has the folders around it too.
    fn find_folder(&mut self, folder: &[u8], missing: &mut StringArrayHashMap<()>) -> bool {
        if self.paths.contains(folder) || missing.contains(folder) {
            return self.paths.contains(folder);
        }
        if !bun_sys::exists(folder) {
            let _ = missing.put(folder, ());
            return false;
        }
        let mut around = Some(folder);
        while let Some(folder) = around.filter(|it| !self.paths.contains(it)) {
            let _ = self.paths.put(folder, ());
            around = bun_paths::dirname(folder);
        }
        true
    }
}

/// Whether the disk had `path`, or the nearest folder around it that is known, and has it no longer.
fn has_vanished(path: &[u8]) -> bool {
    let Some(found) = found_on_disk() else {
        return false;
    };
    let mut nearest = Some(path);
    while let Some(path) = nearest {
        if found.paths.contains(path) {
            return !bun_sys::exists(path);
        }
        nearest = bun_paths::dirname(path);
    }
    false
}

fn is_file_on_disk(path: &[u8]) -> bool {
    let mut buffer = path_buffer_pool::get();
    let found = absolute_key(path, &mut buffer).and_then(|it| bun_sys::stat(it).ok());
    found.is_some_and(|it| {
        bun_sys::kind_from_mode(it.st_mode as bun_sys::Mode) == bun_sys::FileKind::File
    })
}

/// Returns the text in front of each `..` of `name`.
fn split_at_parent_steps(name: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut searched = 0;
    core::iter::from_fn(move || {
        loop {
            let start = searched + strings::index_of(&name[searched..], b"..")?;
            searched = start + 2;
            let is_whole_name = start > 0
                && name[start - 1] == b'/'
                && name.get(searched).is_none_or(|&byte| byte == b'/');
            if is_whole_name {
                return Some(&name[..start]);
            }
        }
    })
}

/// Whether the disk has a folder where `path` leads once it is normalized. The disk does not know a path as written that runs through a folder of the executable alone. A link in front of a `..` has another parent than the text says, and a file has none, so the text is normalized only past what the disk has as a folder or not at all.
fn is_folder_once_normalized(path: &[u8]) -> bool {
    let mut buffer = path_buffer_pool::get();
    let mut find_kind = |folder: &[u8]| {
        let found = bun_sys::lstat(absolute_key(folder, &mut buffer)?).ok()?;
        Some(bun_sys::kind_from_mode(found.st_mode as bun_sys::Mode))
    };
    let mut left = split_at_parent_steps(path);
    left.all(|folder| matches!(find_kind(folder), None | Some(bun_sys::FileKind::Directory)))
        && find_kind(path) == Some(bun_sys::FileKind::Directory)
}

/// Whether `name` ends like `a.json/`, `a.json/.` or `a.json/..`, which only a folder can match. Windows strips those endings first.
fn requests_directory(name: &[u8]) -> bool {
    let without_dots = name.strip_suffix(b"..").or_else(|| name.strip_suffix(b"."));
    !cfg!(windows) && without_dots.unwrap_or(name).last() == Some(&b'/')
}

/// Writes `path.resolve(base, name)` without a trailing `/` and returns its length. `resolve_path` takes a backslash for a separator on every host; off Windows it is part of a name.
fn join_posix_key(base: &[u8], name: &[u8], buffer: &mut PathBuffer) -> Option<usize> {
    let mut length = 0;
    for part in strings::split(base, b"/").chain(strings::split(name, b"/")) {
        match part {
            b"" | b"." => {}
            b".." => length = strings::last_index_of_char(&buffer[..length], b'/').unwrap_or(0),
            _ => {
                let end = length + 1 + part.len();
                buffer.get_mut(length + 1..end)?.copy_from_slice(part);
                buffer[length] = b'/';
                length = end;
            }
        }
    }
    (length < buffer.len()).then_some(length)
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
    if cfg!(not(windows)) {
        let length = join_posix_key(base, name, buffer)?;
        buffer[length] = 0;
        return Some(ZStr::from_buf(&buffer[..], length));
    }
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

#[cfg(unix)]
const ALIGNMENT_OF_PROGRAMS: usize = 64 * 1024;

#[cfg(unix)]
fn reserve_range_of_programs(size: usize) -> Option<usize> {
    let size = size + ALIGNMENT_OF_PROGRAMS;
    // SAFETY: a new mapping, which nothing else refers to.
    let range = unsafe {
        libc::mmap(
            core::ptr::null_mut(),
            size,
            libc::PROT_NONE,
            libc::MAP_PRIVATE | libc::MAP_ANON,
            -1,
            0,
        )
    };
    (range != libc::MAP_FAILED).then(|| (range as usize).next_multiple_of(ALIGNMENT_OF_PROGRAMS))
}

#[cfg(unix)]
fn load_graph_file_at_its_address(descriptor: Fd, offset: usize, size: usize) -> Option<*mut u8> {
    let address = reserve_range_of_programs(size)?;
    let (access, flags) = (
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_PRIVATE | libc::MAP_FIXED,
    );
    let address = address as *mut u8;
    bun_sys::mmap(address, size, access, flags, descriptor, offset as _).ok()
}

#[cfg(windows)]
fn load_graph_file_at_its_address(descriptor: Fd, offset: usize, size: usize) -> Option<*mut u8> {
    (offset == 0).then(|| load_graph_file(descriptor, size))?
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

#[cfg(not(windows))]
struct Descriptor {
    opened: PosixStat,
    path: &'static [u8],
}

#[cfg(not(windows))]
static DESCRIPTORS: bun_threading::Guarded<Vec<Option<Box<Descriptor>>>> =
    bun_threading::Guarded::new(Vec::new());

/// Has a bit for each index of `DESCRIPTORS`, modulo 64.
#[cfg(not(windows))]
static DESCRIPTOR_FILTER: AtomicU64 = AtomicU64::new(0);

/// Whether a descriptor of an embedded path was ever opened.
#[cfg(not(windows))]
#[inline(always)]
pub fn has_descriptors() -> bool {
    DESCRIPTOR_FILTER.load(Ordering::Relaxed) != 0
}

#[cfg(not(windows))]
fn filter_bit(fd: Fd) -> u64 {
    1 << (fd.native() as u64 % 64)
}

/// Whether `stat_descriptor` gives the time at which a file was made. Without `statx`, Linux gives the change time in its place, which `fchmod()`, `fchown()` and `futimes()` move.
#[cfg(not(windows))]
fn has_birth_time() -> bool {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    return bun_sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed);
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    true
}

/// Whether a descriptor still names the file that it named when `opened` was taken.
#[cfg(not(windows))]
fn is_same_file(now: &PosixStat, opened: &PosixStat, has_birth_time: bool) -> bool {
    (now.dev, now.ino, now.nlink) == (opened.dev, opened.ino, opened.nlink)
        && (!has_birth_time || now.birthtim == opened.birthtim)
}

#[cfg(not(windows))]
fn stat_descriptor(fd: Fd) -> Maybe<PosixStat> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if bun_sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
        return bun_sys::fstatx(fd, bun_sys::STATX_MASK_FOR_STATS);
    }
    bun_sys::fstat(fd).map(|stat| PosixStat::init(&stat))
}

/// `fd` reads the file at `path` from here on, from the same offset, if it still is what `is_meant` asks for when that is open.
#[cfg(not(windows))]
fn reopen_at(fd: Fd, path: &ZStr, is_meant: impl FnOnce() -> bool) -> Maybe<bool> {
    use bun_sys::FdExt as _;
    let opened = bun_sys::open(path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0)?;
    let reopened = (|| {
        let offset = bun_sys::lseek(fd, 0, libc::SEEK_CUR)?;
        bun_sys::lseek(opened, offset, libc::SEEK_SET)?;
        if !is_meant() {
            return Ok(false);
        }
        // With FD_CLOEXEC from the start, so that a child of that moment has it no longer than it would have.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // For Android, libc has the number of the call alone.
            let (from, to) = (opened.native(), fd.native());
            // SAFETY: both are descriptors of this process.
            let moved = unsafe { libc::syscall(libc::SYS_dup3, from, to, libc::O_CLOEXEC) };
            match moved {
                -1 => Err(bun_sys::Error::from_code(
                    bun_sys::E::EIO,
                    bun_sys::Tag::dup,
                )),
                _ => Ok(true),
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            bun_sys::dup2(opened, fd)?;
            bun_sys::set_close_on_exec(fd).map(|()| true)
        }
    })();
    opened.close();
    reopened
}

impl StandaloneModuleGraph {
    /// `descriptor` holds the result of `to_graph_bytes` and stays open: the engine maps the code from it.
    pub fn from_descriptor(descriptor: Fd) -> crate::Result<Option<*mut StandaloneModuleGraph>> {
        Self::from_descriptor_at(descriptor, 0)
    }

    /// `offset`: a multiple of the size of a page.
    pub fn from_descriptor_at(
        descriptor: Fd,
        offset: usize,
    ) -> crate::Result<Option<*mut StandaloneModuleGraph>> {
        let size = bun_sys::get_file_size(descriptor).map_err(|_| CORRUPTED)?;
        let size = usize::try_from(size).map_err(|_| CORRUPTED)?;
        let size = size.checked_sub(offset).ok_or(CORRUPTED)?;
        if size < PAYLOAD_HEADER_SIZE {
            return Err(CORRUPTED);
        }
        let base = load_graph_file_at_its_address(descriptor, offset, size).ok_or(CORRUPTED)?;
        // SAFETY: `size >= PAYLOAD_HEADER_SIZE` bytes are readable at `base`.
        let length = u64::from_le_bytes(unsafe { base.cast::<[u8; PAYLOAD_HEADER_SIZE]>().read() });
        if length > (size - PAYLOAD_HEADER_SIZE) as u64 {
            return Err(CORRUPTED);
        }
        let file = ImageFile {
            descriptor: descriptor.native() as isize,
            offset: (offset + PAYLOAD_HEADER_SIZE) as i64,
        };
        // SAFETY: `PAYLOAD_HEADER_SIZE <= size`.
        let payload = unsafe { base.add(PAYLOAD_HEADER_SIZE) };
        Self::from_payload(payload, length as usize, Some(file))
    }

    /// What the file of `from_descriptor` holds after the graph.
    pub fn read_after_graph(descriptor: Fd) -> Option<Vec<u8>> {
        let mut header = [0u8; PAYLOAD_HEADER_SIZE];
        if bun_sys::pread(descriptor, &mut header, 0).ok()? != header.len() {
            return None;
        }
        let start = i64::try_from(u64::from_le_bytes(header)).ok()? + PAYLOAD_HEADER_SIZE as i64;
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match bun_sys::pread(descriptor, &mut chunk, start + bytes.len() as i64).ok()? {
                0 => return Some(bytes),
                count => bytes.extend_from_slice(&chunk[..count]),
            }
        }
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

    /// How long the folders above the folder in which the program was built are, the nearest first, as far up as code lay.
    fn find_folders_above_root_with_code(program: &CompiledProgram) -> Box<[usize]> {
        let Some(root) = program.root_on_build_machine() else {
            return Box::default();
        };
        let mut folder = root.strip_suffix(b"/").unwrap_or(root);

        let mut lengths = Vec::new();
        for _ in 1..program.levels_above_root() {
            let Some(end) = strings::last_index_of_char(folder, b'/') else {
                break;
            };
            folder = &folder[..end];
            lengths.push(end);
        }
        lengths.into()
    }

    /// How many folders above the folder in which the program was built the nearest one lies that `key` is or lies below, and what of `key` stands behind it.
    fn split_at_known_folder<'k>(
        root: &[u8],
        lengths: &[usize],
        key: &'k [u8],
    ) -> Option<(usize, &'k [u8])> {
        let above = lengths.iter().map(|&length| &root[..length]);
        let folders = core::iter::once(root.strip_suffix(b"/").unwrap_or(root)).chain(above);
        folders.enumerate().find_map(|(level, folder)| {
            let below = key.strip_prefix(folder)?;
            match below.is_empty() {
                true => Some((level, below)),
                false => Some((level, below.strip_prefix(b"/")?)),
            }
        })
    }

    /// The path in the executable of what lay at `below`, `level` folders above the folder of the build, and a `/` behind it. `None` where it does not fit.
    fn spell_under_own_root<'b>(
        program: &CompiledProgram,
        level: usize,
        below: &[u8],
        buffer: &'b mut [u8],
    ) -> Option<&'b [u8]> {
        let (start, folders) = match level {
            0 => (BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes(), 0),
            _ => (
                BASE_PUBLIC_PATH.as_bytes(),
                (program.levels_above_root() + 1).checked_sub(level)?,
            ),
        };
        let up = start.len() + 5 * folders;
        let end = up + below.len();
        buffer.get_mut(..start.len())?.copy_from_slice(start);
        for step in buffer.get_mut(start.len()..up)?.as_chunks_mut::<5>().0 {
            *step = *b"_.._/";
        }
        buffer.get_mut(up..end)?.copy_from_slice(below);
        *buffer.get_mut(end)? = b'/';
        Some(&buffer[..=end])
    }

    /// `key`, as `absolute_key` makes it, under the root of the executable, as the loader reads it.
    /// `__dirname` and `__filename` hold paths of the machine that built the program, as with `bun build --compile`: in, below or above the folder in which it was built. Where the disk has them no longer, what the executable holds answers.
    /// `/$bunfs/commands` is what `path.join(import.meta.dir, "../commands")` makes.
    fn key_under_own_root(program: &CompiledProgram, key: &[u8]) -> Option<Vec<u8>> {
        if program.preserves_source_paths {
            return None;
        }
        let own_root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        if is_bun_standalone_file_path(key) {
            return program.join_public_file_path(own_root, key);
        }
        if cfg!(windows) {
            return program.public_path_of_source(own_root, key);
        }
        // `absolute_key` has left nothing in it to resolve, and above the highest folder with code the executable holds nothing.
        let lengths = program
            .folders_above_root_with_code
            .get_or_init(|| Self::find_folders_above_root_with_code(program));
        let root = program.root_on_build_machine()?;
        let (level, below) = Self::split_at_known_folder(root, lengths, key)?;
        let most = own_root.len() + 5 * program.levels_above_root() + below.len() + 1;
        let mut buffer = vec![0; most];
        let length = Self::spell_under_own_root(program, level, below, &mut buffer)?.len();
        buffer.truncate(length - 1 - usize::from(below.is_empty()));
        Some(buffer)
    }

    /// Whether `key`, as `absolute_key` makes it, can be a file or a directory that the graph answers for outside of its own root: each of those begins as all of them do, or is a directory above them all.
    fn is_near_source_paths(&self, program: &CompiledProgram, key: &[u8]) -> bool {
        if cfg!(windows) {
            return true;
        }
        let root = program.root_on_build_machine();
        if let Some(root) = root.filter(|_| !program.preserves_source_paths) {
            let lengths = program
                .folders_above_root_with_code
                .get_or_init(|| Self::find_folders_above_root_with_code(program));
            let nearest = root.strip_suffix(b"/").unwrap_or(root);
            let highest = lengths.last().map_or(nearest, |&length| &root[..length]);
            if !key.starts_with(highest) {
                // A folder above them all is listed as one.
                let below = highest.strip_prefix(key);
                return below.is_some_and(|rest| rest.starts_with(b"/"));
            }
            let Some((level, below)) = Self::split_at_known_folder(root, lengths, key) else {
                return false;
            };
            let mut buffer = [0; 512];
            let spelled = Self::spell_under_own_root(program, level, below, &mut buffer);
            let Some(spelled) = spelled.filter(|_| !below.is_empty()) else {
                return true;
            };
            if program.may_hold_module_at_or_below(spelled).unwrap_or(true) {
                return true;
            }
            // The folders above each file that the graph carries are among `dirs`.
            let path = &spelled[..spelled.len() - 1];
            let folder = strings::last_index_of_char(path, b'/').unwrap_or(0);
            let is_held = self.dirs.contains(&path[..folder])
                && (self.files.contains(path) || self.dirs.contains(path));
            return is_held
                || self.key_of_mounted_asset(path).is_some()
                || self.contains_written_file(path);
        }
        if root.is_some_and(|root| key.starts_with(root)) {
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
        // Most of them are keys as they stand.
        if cfg!(not(windows)) && is_normalized_posix_path(path) {
            return self.is_near_source_paths(program, path.strip_suffix(b"/").unwrap_or(path));
        }
        let mut buffer = path_buffer_pool::get();
        absolute_key(path, &mut buffer).is_some_and(|key| {
            // A relative path may lead into the executable.
            is_bun_standalone_file_path(key.as_bytes())
                || self.is_near_source_paths(program, key.as_bytes())
        })
    }

    /// For a path the disk does not have.
    pub fn source_path_kind(&self, path: &[u8]) -> Option<SourcePathKind> {
        let program = self.compiled_program.as_ref()?;
        let mut buffer = path_buffer_pool::get();
        let key = absolute_key(path, &mut buffer)?.as_bytes();
        if is_removed_by_program(key) || has_vanished(key) {
            return None;
        }
        let under_own_root = Self::key_under_own_root(program, key);
        let key = under_own_root.as_deref().unwrap_or(key);
        if program.entry_point_by_source_path(key).is_some() || program.holds_module_at(key) {
            return Some(SourcePathKind::File);
        }
        let mut entry_points = program.entry_points_in_directory(key);
        let is_directory = entry_points.next().is_some() || program.holds_module_below(key);
        is_directory.then_some(SourcePathKind::Directory)
    }

    pub fn is_source_file(&self, path: &[u8]) -> bool {
        matches!(self.source_path_kind(path), Some(SourcePathKind::File))
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

    /// The file of an entry point is empty: its text is on the disk or nowhere.
    pub(crate) fn is_file_of_compiled_entry_point(&self, file: &File) -> bool {
        let Some(program) = self.compiled_program.as_ref() else {
            return false;
        };
        if !file.loader.is_javascript_like() || !file.contents.as_bytes().is_empty() {
            return false;
        }
        let mut files = self.files.values().iter();
        let index = files.position(|each| core::ptr::eq(each, file));
        let index = index.and_then(|index| u32::try_from(index).ok());
        index.is_some_and(|index| program.entry_point_by_file_index(index).is_some())
    }

    fn find_for_file_system_alone(&self, key: &[u8]) -> Option<FoundForFileSystemAlone> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let program = self.compiled_program.as_ref()?;
        program.find_for_file_system_alone(key.strip_prefix(root)?)
    }

    /// `Bun.embeddedFiles` passes over it.
    pub fn is_file_for_file_system_alone(&self, file: &File) -> bool {
        let found = self.find_file_record(file.name);
        found.is_some_and(|found| !found.is_asset)
    }

    pub(crate) fn has_no_file_contents(&self, file: &File) -> bool {
        // Every read of an embedded file asks, and only an empty file needs its record.
        let is_empty = file.contents.as_bytes().is_empty();
        let found = is_empty.then(|| self.find_file_record(file.name)).flatten();
        found.is_some_and(|found| found.size_without_bytes.is_some())
    }

    fn find_file_record(&self, key: &[u8]) -> Option<FoundForFileSystemAlone> {
        let found = self.find_for_file_system_alone(key);
        found.or_else(|| self.find_record_above_root(key))
    }

    /// The records name a file above the root by its path from the root, `../a.json`.
    fn find_record_above_root(&self, key: &[u8]) -> Option<FoundForFileSystemAlone> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let program = self.compiled_program.as_ref()?;
        let name = name_in_plain_executable(root, program.levels_above_root(), key)?;
        let levels = name.as_chunks::<5>().0.iter();
        let levels = levels.take_while(|&it| it == b"_.._/").count();
        let path = [&b"../".repeat(levels)[..], &name[5 * levels..]].concat();
        program.find_for_file_system_alone(&path)
    }

    /// Records that `fd` was opened for the embedded `path`.
    #[cfg(not(windows))]
    pub fn add_descriptor(&self, fd: Fd, path: &'static [u8]) {
        let Ok(opened) = stat_descriptor(fd) else {
            return;
        };
        let index = fd.native() as usize;
        let mut descriptors = DESCRIPTORS.lock();
        if descriptors.len() <= index {
            descriptors.resize_with(index + 1, || None);
        }
        descriptors[index] = Some(Box::new(Descriptor { opened, path }));
        DESCRIPTOR_FILTER.fetch_or(filter_bit(fd), Ordering::Relaxed);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        bun_sys::IS_FSTATX_DIRECT.store(false, Ordering::Relaxed);
    }

    /// The program has written the file at the source path `name` whole. What has the embedded file open reads there.
    #[cfg(not(windows))]
    pub fn move_descriptors_to_disk(&self, name: &[u8]) {
        let mut buffer = path_buffer_pool::get();
        let path = absolute_key(name, &mut buffer);
        let Some((program, path)) = self.compiled_program.as_ref().zip(path) else {
            return;
        };
        let key = Self::key_under_own_root(program, path.as_bytes());
        let Some(file) = key.and_then(|it| self.lookup_file(&it)) else {
            return;
        };
        let mut descriptors = DESCRIPTORS.lock();
        for (index, slot) in descriptors.iter_mut().enumerate() {
            let Some(descriptor) = slot.as_deref().filter(|it| it.path == file.name) else {
                continue;
            };
            let fd = Fd::from_native(index as _);
            let is_open = || {
                stat_descriptor(fd)
                    .is_ok_and(|now| is_same_file(&now, &descriptor.opened, has_birth_time()))
            };
            if !is_open() || reopen_at(fd, path, is_open).is_ok() {
                *slot = None;
            }
        }
    }

    /// For a descriptor of an embedded path, returns the `lstat()` of the path with any changes made through the descriptor.
    #[cfg(not(windows))]
    #[cold]
    pub fn fstat(&self, fd: Fd) -> Maybe<PosixStat> {
        let now = stat_descriptor(fd)?;
        if DESCRIPTOR_FILTER.load(Ordering::Relaxed) & filter_bit(fd) == 0 {
            return Ok(now);
        }
        let mut descriptors = DESCRIPTORS.lock();
        let Some(slot) = descriptors.get_mut(fd.native() as usize) else {
            return Ok(now);
        };
        let Some(Descriptor { opened, path }) = slot.as_deref_mut() else {
            return Ok(now);
        };
        // macOS and FreeBSD move the birth time back to a modification time that is set earlier. A file that reuses the inode is born later.
        let (born, recorded) = (now.birthtim, opened.birthtim);
        if born == now.mtim && (born.sec, born.nsec) < (recorded.sec, recorded.nsec) {
            opened.birthtim = born;
        }
        if !is_same_file(&now, opened, has_birth_time()) {
            *slot = None;
            return Ok(now);
        }
        let mut shown = self
            .stat(*path)
            .map_or(now, |named| PosixStat::init(&named));
        if now.mode != opened.mode {
            shown.mode = now.mode;
        }
        if (now.uid, now.gid) != (opened.uid, opened.gid) {
            (shown.uid, shown.gid) = (now.uid, now.gid);
        }
        if (now.size, now.blocks) != (opened.size, opened.blocks) {
            (shown.size, shown.blocks) = (now.size, now.blocks);
        }
        if now.atim != opened.atim {
            shown.atim = now.atim;
        }
        if now.mtim != opened.mtim {
            shown.mtim = now.mtim;
        }
        if now.ctim != opened.ctim {
            shown.ctim = now.ctim;
        }
        Ok(shown)
    }

    /// Fills in what only files on disk have: device, inode, link count, owner, blocks, and the times as of the build.
    pub(crate) fn fill_stat_for_file_system_alone(&self, key: &[u8], stat: &mut Stat) {
        let without_bytes = self.find_record_above_root(key);
        let without_bytes = without_bytes.filter(|it| it.size_without_bytes.is_some());
        let Some(found) = self.find_for_file_system_alone(key).or(without_bytes) else {
            return;
        };
        if let Some(size) = found.size_without_bytes {
            stat.st_size = size as _;
        }
        let (seconds, nanoseconds) = (
            found.modified_at.div_euclid(1000),
            found.modified_at.rem_euclid(1000) * 1_000_000,
        );
        if found.is_folder {
            stat.st_size = 4096;
        }
        stat.st_dev = EMBEDDED_FILES_DEVICE as _;
        stat.st_ino = found.number as _;
        stat.st_nlink = if found.is_folder { 2 } else { 1 };
        stat.st_blksize = 4096;
        stat.st_blocks = ((stat.st_size as u64).div_ceil(512)) as _;
        #[cfg(not(windows))]
        {
            // SAFETY: they take nothing and cannot fail.
            (stat.st_uid, stat.st_gid) = unsafe { (libc::getuid(), libc::getgid()) };
            stat.st_atime = seconds as _;
            stat.st_atime_nsec = nanoseconds as _;
            stat.st_mtime = seconds as _;
            stat.st_mtime_nsec = nanoseconds as _;
            stat.st_ctime = seconds as _;
            stat.st_ctime_nsec = nanoseconds as _;
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            stat.st_birthtime = seconds as _;
            stat.st_birthtime_nsec = nanoseconds as _;
        }
        #[cfg(windows)]
        for time in [
            &mut stat.atim,
            &mut stat.mtim,
            &mut stat.ctim,
            &mut stat.birthtim,
        ] {
            time.sec = seconds as _;
            time.nsec = nanoseconds as _;
        }
    }

    pub fn find_refused_data(&self, name: &[u8]) -> Option<RefusedData<'static>> {
        self.compiled_program.as_ref()?.find_refused_data(name)
    }

    pub fn find_asset_under_root(&self, name: &[u8]) -> Option<&File> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        self.lookup_file(name)
            .filter(|file| self.is_asset_of_compiled_program(name, file))
    }

    pub(crate) fn root_asset_key(&self, name: &[u8]) -> Option<Vec<u8>> {
        self.root_asset_keys(name)?.next()
    }

    fn root_asset_keys<'a>(&'a self, name: &'a [u8]) -> Option<impl Iterator<Item = Vec<u8>> + 'a> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let program = self.compiled_program.as_ref()?;
        let below_root = name.strip_prefix(root)?;
        let end = strings::index_of_char_usize(below_root, b'/').unwrap_or(below_root.len());
        let (base_name, below_asset) = below_root.split_at(end);
        let mut paths = program.assets_named_at_root(base_name).peekable();
        paths.peek()?;
        if self.traverses_non_directory(name) {
            return None;
        }
        let may_be_file = !requests_directory(name);
        let keys = paths.filter_map(move |path| {
            if !path.starts_with(b"../") {
                let at_root = || ([root, path].concat(), 0);
                return below_asset.is_empty().then(at_root);
            }
            let asset = program.join_public_asset_path(root, path)?;
            let key = program.join_public_asset_path(root, &[path, below_asset].concat())?;
            key.starts_with(&asset).then_some((key, asset.len()))
        });
        let mut earlier_folders: Vec<Vec<u8>> = Vec::new();
        Some(keys.filter_map(move |(key, folder_length)| {
            let (folder, below) = key.split_at(folder_length);
            let is_file = may_be_file && self.files.contains(&key);
            let normalized_name = [root, base_name, below].concat();
            let mut earlier = earlier_folders.iter();
            let is_found = (is_file || self.dirs.contains(&key))
                && self.is_unshadowed_by_root(program, &normalized_name, is_file)
                && earlier.all(|it| self.is_unshadowed_by_folder(it, below, is_file));
            earlier_folders.push(folder.to_vec());
            is_found.then_some(key)
        }))
    }

    /// Outside folders with the same base name are tried in order, so an earlier one shadows a later one as the root shadows both.
    fn is_unshadowed_by_folder(&self, earlier_folder: &[u8], below: &[u8], is_file: bool) -> bool {
        let name_prefix = |end: usize| [earlier_folder, &below[..end]].concat();
        let ends = (1..below.len()).filter(|&at| below[at] == b'/');
        let mut ancestor_names = ends.chain([below.len()]).map(name_prefix);
        !ancestor_names.any(|name| self.files.contains(&name))
            && !(is_file && self.dirs.contains(&name_prefix(below.len())))
    }

    /// Entries of the root come first, as in `bun run`: a file shadows its name and everything below it, and a folder shadows a file. Folders merge.
    fn is_unshadowed_by_root(
        &self,
        program: &CompiledProgram,
        normalized_name: &[u8],
        is_file: bool,
    ) -> bool {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        // The graph has no file for a compiled module that is no entry point.
        let is_own_file = |path: &[u8]| self.files.contains(path) || program.holds_module_at(path);
        let is_own_folder =
            || self.dirs.contains(normalized_name) || program.holds_module_below(normalized_name);
        let ends = (root.len()..normalized_name.len()).filter(|&at| normalized_name[at] == b'/');
        let mut ancestor_names = ends
            .chain([normalized_name.len()])
            .map(|end| &normalized_name[..end]);
        !ancestor_names.any(is_own_file) && !(is_file && is_own_folder())
    }

    /// Whether `name`, below the root, resolves to the file or folder at `key`. Listings only show what can be read.
    pub(crate) fn is_named_at_root(&self, name: &[u8], key: &[u8]) -> bool {
        self.root_asset_keys(name)
            .is_some_and(|mut keys| keys.any(|it| it == key))
    }

    /// `pub/a.txt` for the key of `../lib/pub/a.txt`, where `--asset ../lib/pub` is also found by its base name and that name leads to this file.
    fn find_name_at_root(&self, program: &CompiledProgram, key: &[u8]) -> Option<Vec<u8>> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let paths = program.paths_named_at_root();
        paths.filter(|it| it.starts_with(b"../")).find_map(|path| {
            let asset = program.join_public_asset_path(root, path)?;
            let below = key.strip_prefix(&asset[..])?;
            if !matches!(below, [] | [b'/', ..]) {
                return None;
            }
            let name = [bun_paths::basename(path), below].concat();
            let found = self.root_asset_key(&[root, &name[..]].concat())?;
            (found == key).then_some(name)
        })
    }

    /// What a listing of the root directory holds besides its own files: the assets from outside it that are also found by their base names.
    pub(crate) fn list_assets_named_at_root(
        &self,
        folder: &[u8],
        recursive: bool,
    ) -> Vec<(Box<[u8]>, bool)> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let is_root = root.strip_suffix(b"/") == Some(folder);
        let Some(program) = self.compiled_program.as_ref().filter(|_| is_root) else {
            return Vec::new();
        };
        let mut listed: Vec<(Box<[u8]>, bool)> = Vec::new();
        let paths = program.paths_named_at_root();
        for path in paths.filter(|it| it.starts_with(b"../")) {
            let Some(key) = program.join_public_asset_path(root, path) else {
                continue;
            };
            let base_name = bun_paths::basename(path);
            let is_folder = self.dirs.contains(&key);
            listed.push((base_name.into(), is_folder));
            if !recursive || !is_folder {
                continue;
            }
            for (below, is_dir) in self.list_folder(&key, true) {
                let name = [base_name, b"/", &below[..]].concat();
                let place = [&key[..], b"/", &below[..]].concat();
                if self.is_named_at_root(&[root, &name[..]].concat(), &place) {
                    listed.push((name.into(), is_dir));
                }
            }
        }
        listed
    }

    /// The key that `name` shares with other folders, and those folders. `found` is its `directory_key`. A folder outside the root that is named by its own path shares no key.
    pub(crate) fn find_folders_named_alike(
        &self,
        name: &[u8],
        found: &[u8],
    ) -> Option<(Vec<u8>, Vec<Vec<u8>>)> {
        let mut buffer = path_buffer_pool::get();
        let written = match is_bun_standalone_file_path(name) {
            true => Some(Self::normalize_dir_path(name, &mut buffer)),
            false => absolute_key(name, &mut buffer).map(|key| key.as_bytes()),
        };
        let program = self.compiled_program.as_ref().zip(written);
        let as_read = program.and_then(|it| Self::key_under_own_root(it.0, it.1));
        let as_read = as_read?;
        let is_other_folder = |key: &Vec<u8>| key != found && self.dirs.contains(key);
        let keys = self.root_asset_keys(&as_read)?;
        let others: Vec<Vec<u8>> = keys.filter(is_other_folder).collect();
        (!others.is_empty()).then_some((as_read, others))
    }

    /// Before it was mounted, the base name of such an asset was its key, so `__dirname` led to it.
    fn key_of_mounted_asset(&self, name: &[u8]) -> Option<Vec<u8>> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let key = self.root_asset_key(name)?;
        let is_mounted = key
            .strip_prefix(root)
            .is_none_or(|it| it.starts_with(b"_.._/"));
        is_mounted.then_some(key)
    }

    /// `path.join(import.meta.dir, "../a")` is `/$bunfs/a`; `import.meta.dir + "/../a"` is `/$bunfs/root/../a`.
    pub(crate) fn key_of_file_above_root(&self, name: &[u8]) -> Option<Vec<u8>> {
        let program = self.compiled_program.as_ref()?;
        let is_below_root = name.starts_with(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes());
        if is_below_root && is_normalized_posix_path(name) {
            return None;
        }
        if requests_directory(name) || self.traverses_non_directory(name) {
            return None;
        }
        let key = Self::key_under_own_root(program, name)?;
        let named_at_root = || self.root_asset_key(&key);
        let is_file = self.files.contains(&key);
        Some((!is_file).then(named_at_root).flatten().unwrap_or(key))
    }

    /// `File::display_name`, with `_.._` for each folder above the root directory.
    pub fn display_name_of<'f>(&self, file: &'f File) -> Cow<'f, [u8]> {
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let program = self.compiled_program.as_ref();
        if let Some(name) = program.and_then(|it| self.find_name_at_root(it, file.name)) {
            return Cow::Owned(name);
        }
        let is_mounted = !file.name.starts_with(root) && is_bun_standalone_file_path(file.name);
        let program = self.compiled_program.as_ref().filter(|_| is_mounted);
        let name = program.and_then(|program| {
            name_in_plain_executable(root, program.levels_above_root(), file.name)
        });
        name.map_or_else(|| Cow::Borrowed(file.display_name()), Cow::Owned)
    }

    /// Keys are normalized lexically, but `sub/../a.json` is `a.json` only if `sub` is a folder. Windows normalizes lexically too.
    fn traverses_non_directory(&self, name: &[u8]) -> bool {
        if cfg!(windows) {
            return false;
        }
        let is_folder = |path: &[u8]| {
            self.find_dir(path)
                || matches!(
                    bun_sys::directory_exists_at(Fd::cwd(), &bun_core::ZBox::from_bytes(path)),
                    Ok(true)
                )
                || is_folder_once_normalized(path)
        };
        !split_at_parent_steps(name).all(is_folder)
    }

    /// The program has removed the file or folder `name` from the disk, or renamed it. The executable no longer answers for that source path or below it.
    pub fn forget_source_path(&self, name: &[u8]) {
        let mut buffer = path_buffer_pool::get();
        let Some(key) = absolute_key(name, &mut buffer) else {
            return;
        };
        let program = self.compiled_program.as_ref();
        if let Some(it) = program.and_then(|it| Self::key_under_own_root(it, key.as_bytes())) {
            self.forget_implicit_files(&it);
        }
        // A program that makes and removes files of its own changes nothing in the executable.
        if self.holds_at_or_below(key.as_bytes()) {
            record_removed_path(key.as_bytes());
        }
    }

    /// Whether the executable holds something for the path `key` of the disk, or below it.
    fn holds_at_or_below(&self, key: &[u8]) -> bool {
        let Some(program) = self.compiled_program.as_ref() else {
            return false;
        };
        let holds = |key: &[u8]| {
            self.files.contains(key)
                || self.dirs.contains(key)
                || program.holds_module_at(key)
                || program.holds_module_below(key)
                || program.entry_point_by_source_path(key).is_some()
                || program.entry_points_in_directory(key).next().is_some()
                || self.key_of_mounted_asset(key).is_some()
                || self.contains_written_file(key)
        };
        holds(key) || Self::key_under_own_root(program, key).is_some_and(|it| holds(&it))
    }

    /// The program has written the file at the source path `name` on the disk, or has moved a folder there. The copy in the executable of a file that nobody asked the build to embed is outdated.
    pub fn note_written_file(&self, name: &[u8]) {
        let mut buffer = path_buffer_pool::get();
        let path_on_disk = absolute_key(name, &mut buffer);
        let Some((program, path_on_disk)) = self.compiled_program.as_ref().zip(path_on_disk) else {
            return;
        };
        let path_on_disk = path_on_disk.as_bytes();
        let folder = Self::key_under_own_root(program, path_on_disk);
        let Some(folder) = folder.filter(|it| *it != path_on_disk) else {
            return;
        };
        if let Some(file) = self.lookup_file(&folder) {
            if self.is_file_for_file_system_alone(file) {
                record_written_file(&folder, file.name, path_on_disk);
            }
            return;
        }
        if !self.dirs.contains(&folder) {
            return;
        }
        for (key, file) in self.files.keys().iter().zip(self.files.values()) {
            if !is_at_or_below(key, &folder) || !self.is_file_for_file_system_alone(file) {
                continue;
            }
            let path_on_disk = [path_on_disk, &key[folder.len()..]].concat();
            if bun_sys::exists(&path_on_disk) {
                record_written_file(key, key, &path_on_disk);
            }
        }
    }

    /// Where the file or folder `key` of the graph was when the program was built.
    fn path_on_build_machine(program: &CompiledProgram, key: &[u8]) -> Option<Vec<u8>> {
        if program.preserves_source_paths {
            return (!is_bun_standalone_file_path(key)).then(|| key.to_vec());
        }
        let root = program.root_on_build_machine()?;
        let mut root = root.strip_suffix(b"/").unwrap_or(root);
        let own_root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes();
        let below = match key.strip_prefix(own_root) {
            Some(below) => below,
            None => {
                let steps = key.strip_prefix(BASE_PUBLIC_PATH.as_bytes())?;
                let folders = steps.as_chunks::<5>().0.iter();
                let folders = folders.take_while(|&it| it == b"_.._/").count();
                for _ in 0..(program.levels_above_root() + 1).checked_sub(folders)? {
                    root = bun_paths::dirname(root)?;
                }
                &steps[5 * folders..]
            }
        };
        let path = [root.strip_suffix(b"/").unwrap_or(root), b"/", below].concat();
        // A name that leads elsewhere is none of it.
        (*Self::key_under_own_root(program, &path)? == *key).then_some(path)
    }

    /// For what may remove files of the program: `FoundOnDisk`.
    pub fn note_found_on_disk(&self) {
        FOUND_ON_DISK.get_or_init(|| self.find_on_disk());
    }

    fn find_on_disk(&self) -> FoundOnDisk {
        let mut found = FoundOnDisk {
            files: StringArrayHashMap::new(),
            paths: StringArrayHashMap::new(),
        };
        let Some(program) = self.compiled_program.as_ref() else {
            return found;
        };
        // An executable that was moved finds nothing.
        let root = program.root_on_build_machine();
        if root.is_some_and(|it| !bun_sys::exists(strings::without_trailing_slash(it))) {
            return found;
        }
        let mut missing: StringArrayHashMap<()> = StringArrayHashMap::new();
        for (key, file) in self.files.keys().iter().zip(self.files.values()) {
            if !self.is_file_for_file_system_alone(file) {
                continue;
            }
            let Some(path) = Self::path_on_build_machine(program, key) else {
                continue;
            };
            let folder = bun_paths::dirname(&path);
            if folder.is_some_and(|it| found.find_folder(it, &mut missing))
                && bun_sys::exists(&path)
            {
                let _ = found.files.put(key, path.as_slice().into());
                let _ = found.paths.put(&path, ());
            }
        }
        for entry_point in &program.entry_points {
            let path = Self::path_on_build_machine(program, entry_point.source_path);
            if let Some(folder) = path.as_deref().and_then(bun_paths::dirname) {
                found.find_folder(folder, &mut missing);
            }
        }
        found
    }

    /// Whether the disk had the file `key`, which nobody asked the build to embed, and has it no longer.
    pub(crate) fn has_file_vanished(&self, key: &[u8]) -> bool {
        let path = found_on_disk().and_then(|found| found.files.get(key));
        path.is_some_and(|path| !bun_sys::exists(path))
    }

    /// Whether the disk had the folder `key` and has it no longer. What somebody asked the build to embed keeps its folder.
    pub(crate) fn has_folder_vanished(&self, key: &[u8]) -> bool {
        if found_on_disk().is_none() {
            return false;
        }
        let program = self.compiled_program.as_ref();
        let path = program.and_then(|it| Self::path_on_build_machine(it, key));
        if !path.is_some_and(|path| has_vanished(&path)) {
            return false;
        }
        let mut files = self.files.keys().iter().zip(self.files.values());
        !files.any(|(it, file)| {
            is_at_or_below(it, key)
                && !self.is_file_for_file_system_alone(file)
                && !self.is_file_of_compiled_entry_point(file)
        })
    }

    /// `import.meta.dirname` leads to `key`, at or below which the program has removed what `__dirname` leads to. Only a file that nobody asked the build to embed is gone.
    fn forget_implicit_files(&self, key: &[u8]) {
        if let Some(file) = self.files.get(key) {
            if self.is_file_for_file_system_alone(file) {
                record_removed_path(file.name);
            }
        } else if self.dirs.contains(key) && !self.forget_folder(key) {
            let files = self.files.keys().iter().zip(self.files.values());
            files
                .filter(|it| is_at_or_below(it.0, key) && !is_removed_by_program(it.0))
                .filter(|it| self.is_file_for_file_system_alone(it.1))
                .for_each(|it| record_removed_path(it.0));
        }
    }

    /// The disk has the source folder `name`. What the executable still answers for in it, where the sources are not there: that can't be moved or removed with the folder. Where they are, the disk has all the names there are.
    pub fn list_beside_disk(&self, name: &[u8], recursive: bool) -> Vec<(Box<[u8]>, bool)> {
        let name = strings::without_trailing_slash(name);
        let mut buffer = path_buffer_pool::get();
        let found = absolute_key(name, &mut buffer);
        let Some((program, found)) = self.compiled_program.as_ref().zip(found) else {
            return Vec::new();
        };
        let found = found.as_bytes();
        let key = Self::key_under_own_root(program, found);
        let Some(key) = key.filter(|it| self.dirs.contains(it)) else {
            return Vec::new();
        };
        let in_folder = |folder: &[u8]| [folder, b"/x"].concat();
        if self.has_source_on_disk(&in_folder(&key), &in_folder(found)) {
            return Vec::new();
        }
        // The build has named what is imported as a file. No folder of the sources holds such a name.
        let has_name_of_source = |file: &File| self.find_file_record(file.name).is_some();
        let mut entries = self.list_folder(&key, recursive);
        entries.retain(|(below, is_folder)| {
            let path = [name, b"/", below].concat();
            match is_folder {
                true => self.find_dir(&path),
                false => self
                    .find_at_source_path(&path)
                    .is_some_and(has_name_of_source),
            }
        });
        entries
    }

    /// Whether the program finds at `path`, a source path, what the executable holds there.
    pub(crate) fn holds_at_source_path(&self, path: &[u8], is_folder: bool) -> bool {
        match is_folder {
            true => self.find_dir(path),
            false => self.find_at_source_path(path).is_some() || self.is_source_file(path),
        }
    }

    /// The program asks that nothing is at the source path `name`, and the disk had nothing there. That holds for what nobody asked the build to embed.
    pub fn forget_unasked_files(&self, name: &[u8]) {
        let mut buffer = path_buffer_pool::get();
        let key = absolute_key(name, &mut buffer);
        let program = self.compiled_program.as_ref().zip(key);
        let Some(key) = program.and_then(|it| Self::key_under_own_root(it.0, it.1.as_bytes()))
        else {
            return;
        };
        let mut files = self.files.keys().iter().zip(self.files.values());
        let holds_asset = files.any(|(it, file)| {
            is_at_or_below(it, &key)
                && !self.is_file_for_file_system_alone(file)
                && !self.is_file_of_compiled_entry_point(file)
        });
        match holds_asset || self.key_of_mounted_asset(&key).is_some() {
            true => self.forget_implicit_files(&key),
            false => self.forget_source_path(name),
        }
    }

    fn holds_code_below(&self, folder: &[u8]) -> bool {
        self.compiled_program.as_ref().is_some_and(|program| {
            program.holds_module_below(folder)
                || program.entry_points_in_directory(folder).next().is_some()
        })
    }

    /// The folder `key` is gone with what is in it, unless an asset or code is.
    fn forget_folder(&self, key: &[u8]) -> bool {
        let is_below = |it: &[u8]| it.len() > key.len() && is_at_or_below(it, key);
        let mut files = self.files.keys().iter().zip(self.files.values());
        let is_kept = files.any(|(it, file)| {
            is_below(it) && !is_removed_by_program(it) && !self.is_file_for_file_system_alone(file)
        });
        if is_kept || self.holds_code_below(key) {
            return false;
        }
        record_removed_path(key);
        true
    }

    /// The program has removed the source path `key` or renamed it, and has written nothing below it since.
    fn is_gone(&self, program: &CompiledProgram, key: &[u8]) -> bool {
        let is_written_to = |it: Vec<u8>| self.contains_written_file(&it);
        is_removed_by_program(key)
            && !Self::key_under_own_root(program, key).is_some_and(is_written_to)
    }

    /// Whether the program has written a file of `folder`.
    fn contains_written_file(&self, folder: &[u8]) -> bool {
        let is_below = |path: &[u8]| path.len() > folder.len() && is_at_or_below(path, folder);
        let is_written = |it: &WrittenFile| is_below(&it.path) && bun_sys::exists(&it.path_on_disk);
        has_written_files() && WRITTEN_FILES.lock().iter().any(is_written)
    }

    pub fn find_at_source_path(&self, name: &[u8]) -> Option<&File> {
        let program = self.compiled_program.as_ref()?;
        if !bun_paths::is_absolute(name) {
            let mut buffer = path_buffer_pool::get();
            // It may lead into the executable.
            let key = absolute_key(name, &mut buffer)?.as_bytes();
            if is_bun_standalone_file_path(key) {
                return self.find_ref(key);
            }
        }
        if !program.preserves_source_paths && program.root_on_build_machine().is_none() {
            return None;
        }
        if requests_directory(name) || self.traverses_non_directory(name) {
            return None;
        }
        let mut buffer = path_buffer_pool::get();
        let key =
            absolute_key(name, &mut buffer).filter(|it| !self.is_gone(program, it.as_bytes()))?;
        let under_own_root = Self::key_under_own_root(program, key.as_bytes());
        if !program.preserves_source_paths && under_own_root.is_none() {
            return None;
        }
        let key_in_graph = under_own_root.as_deref().unwrap_or(key.as_bytes());
        let file_index = self.files.get_index(key_in_graph).or_else(|| {
            self.files
                .get_index(&self.key_of_mounted_asset(key_in_graph)?)
        })?;
        // The file of an entry point is empty: its text is on the disk or nowhere.
        let is_entry_point = program
            .entry_point_by_file_index(u32::try_from(file_index).ok()?)
            .is_some();
        if is_entry_point && self.files.values()[file_index].loader.is_javascript_like() {
            return None;
        }
        // As for a directory, the disk wins: the file may have been written since the build, and the program may write it.
        if bun_sys::exists(key.as_bytes()) {
            return None;
        }
        let file = &self.files.values()[file_index];
        let has_source = |it: &[u8]| self.has_source_on_disk(it, key.as_bytes());
        let is_gone = self.has_file_vanished(file.name)
            || self.is_file_for_file_system_alone(file)
                && under_own_root.as_deref().is_some_and(has_source);
        (!is_gone && !is_removed_by_program(file.name)).then_some(file)
    }

    /// Whether the program runs beside its sources, as far as `key` tells: the disk has the source of a compiled file from the nearest folder around `key` that holds one. Then a file that nobody named is gone if the disk says so. `key_in_graph` is `key` in the executable. Neither the folder nor a data file tells: a container often has the folder of the build with only the executable in it, and one file may be laid at its old place to stand for the embedded one.
    fn has_source_on_disk(&self, key_in_graph: &[u8], key: &[u8]) -> bool {
        let Some(program) = self.compiled_program.as_ref() else {
            return false;
        };
        let mut cut = bun_paths::basename(key).len() + 1;
        if cut >= key.len() || !bun_sys::exists(&key[..key.len() - cut]) {
            return false;
        }
        while cut < key.len() && cut < key_in_graph.len() {
            let folder = &key[..key.len() - cut];
            let folder_in_graph = &key_in_graph[..key_in_graph.len() - cut];
            let mut entry_points = program.entry_points_in_directory(folder_in_graph);
            let mut source = entry_points.next().map(|it| it.source_path.to_vec());
            program.for_each_module_below(folder_in_graph, &mut |path| {
                source = Some(path.to_vec());
                false
            });
            if let Some(source) = source {
                return is_file_on_disk(&[folder, &source[folder_in_graph.len()..]].concat());
            }
            let name = bun_paths::basename(folder);
            if name != bun_paths::basename(folder_in_graph) {
                return false;
            }
            cut += name.len() + 1;
        }
        false
    }

    pub(crate) fn directory_key<'a>(
        &self,
        name: &'a [u8],
        buffer: &'a mut PathBuffer,
    ) -> Option<&'a [u8]> {
        if is_bun_standalone_file_path(name) {
            let program = self.compiled_program.as_ref();
            let is_directory = |key: &[u8]| {
                self.dirs.contains_key(key)
                    && !is_removed_by_program(key)
                    && !self.has_folder_vanished(key)
                    || program.is_some_and(|program| program.holds_module_below(key))
                    || self.contains_written_file(key)
            };
            if is_directory(Self::normalize_dir_path(name, buffer)) {
                return Some(Self::normalize_dir_path(name, buffer));
            }
            let written = Self::normalize_dir_path(name, buffer);
            let as_read = Self::key_under_own_root(program?, written)?;
            let as_read = match is_directory(&as_read) {
                true => as_read,
                false => self.key_of_mounted_asset(&as_read)?,
            };
            if as_read.len() > buffer.len() || !is_directory(&as_read) {
                return None;
            }
            buffer[..as_read.len()].copy_from_slice(&as_read);
            return Some(&buffer[..as_read.len()]);
        }
        let program = self.compiled_program.as_ref()?;
        if !program.preserves_source_paths {
            // Every key of such a graph lies under its own root.
            program.root_on_build_machine()?;
            let mut on_build_machine = path_buffer_pool::get();
            // The key of the root is empty. The disk has the root.
            let key = absolute_key(name, &mut on_build_machine)
                .filter(|it| !it.as_bytes().is_empty())
                .filter(|it| !self.is_gone(program, it.as_bytes()))?;
            let under_own_root = Self::key_under_own_root(program, key.as_bytes())?;
            let is_directory = |key: &[u8]| {
                self.dirs.contains_key(key)
                    || program.holds_module_below(key)
                    || self.contains_written_file(key)
            };
            let under_own_root = match is_directory(&under_own_root) {
                true => under_own_root,
                false => self.key_of_mounted_asset(&under_own_root)?,
            };
            let is_directory =
                is_directory(&under_own_root) && !self.has_folder_vanished(&under_own_root);
            let length = under_own_root.len();
            if !is_directory || length > buffer.len() || bun_sys::exists(key.as_bytes()) {
                return None;
            }
            buffer[..length].copy_from_slice(&under_own_root);
            return Some(&buffer[..length]);
        }
        let key = absolute_key(name, buffer)
            .filter(|it| !it.as_bytes().is_empty() && !is_removed_by_program(it.as_bytes()))?;
        if !self.is_near_source_paths(program, key.as_bytes())
            || !self.dirs.contains_key(key.as_bytes())
            || self.has_folder_vanished(key.as_bytes())
        {
            return None;
        }
        (!bun_sys::exists(key.as_bytes())).then_some(key.as_bytes())
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
        RuntimeOptions, normalize_windows_key, to_bytes, to_graph_bytes, with_graph_slices,
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
        }
    }

    fn program<'a>(
        image: &'a [u8],
        image_alignment: usize,
        entry_points: &'a [EntryPoint<'a>],
        preserves_source_paths: bool,
    ) -> CompiledProgramInput<'a> {
        CompiledProgramInput {
            image: image.to_vec().leak(),
            image_alignment,
            entry_points,
            package_names: &[],
            path_aliases: &[],
            root_below_working_directory: None,
            allows_code_from_disk: false,
            names_plugin: false,
            root_folders_spelled: b"",
            root_from_executable: None,
            root_on_build_machine: None,
            assets_named_at_root: b"",
            refused_data: b"",
            loaders_given_to_build: b"",
            files_for_file_system_alone: b"",
            levels_above_root: 0,
            further_package_names: &[],
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
        let image = append_image(&mut builder, input, ImagePlace::InGraph)?;
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

        patch(&mut bytes, record_at + 12, 0);
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
            is_hidden_from_require: false,
            is_hidden_from_import: false,
        };
        let names = [
            name(
                &b"/$bunfs/root/node_modules/both/feature"[..],
                None,
                Some(1),
                false,
            ),
            name(b"/$bunfs/root/node_modules/both", Some(2), Some(1), true),
            CompiledPackageNameInput {
                is_hidden_from_require: true,
                ..name(
                    b"/$bunfs/root/node_modules/open/inner.js",
                    None,
                    None,
                    false,
                )
            },
            CompiledPackageNameInput {
                is_hidden_from_import: true,
                ..name(
                    b"/$bunfs/root/node_modules/open/other.js",
                    None,
                    None,
                    false,
                )
            },
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
        use bun_resolver::compiled_program::PackageLookup::{Found, Hidden, Unknown};
        assert_eq!(find(b"open/inner.js", true), Hidden);
        assert_eq!(find(b"open/inner.js", false), Unknown);
        assert_eq!(find(b"open/other.js", true), Unknown);
        assert_eq!(find(b"open/other.js", false), Hidden);
        assert_eq!(
            find(b"both", true),
            Found(b"/$bunfs/root/node_modules/both/common.cjs")
        );
        assert_eq!(
            find(b"both", false),
            Found(b"/$bunfs/root/node_modules/both/es.mjs")
        );
        assert_eq!(
            find(b"both/feature", false),
            Found(b"/$bunfs/root/node_modules/both/es.mjs")
        );
        assert_eq!(find(b"both/feature", true), Unknown);
        assert_eq!(find(b"other", true), Unknown);

        let names_at = bytes.len()
            - size_of::<u32>()
            - names
                .iter()
                .map(|name| PACKAGE_NAME_SIZE + name.path.len())
                .sum::<usize>();
        let mut out_of_range = bytes.clone();
        patch(&mut out_of_range, names_at + 4, 3);
        assert_eq!(read_back(out_of_range, record_at).err(), Some(CORRUPTED));
        let mut too_many = bytes.clone();
        patch(&mut too_many, names_at - 4, names.len() as u32 + 1);
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
    fn root_below_working_directory_round_trips() {
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        for root in [None, Some(&b""[..]), Some(&b"packages/app/src"[..])] {
            let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
            input.root_below_working_directory = root;
            let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
            let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
            assert_eq!(record_end, bytes.len());
            let expected = root.map(|root| [b"/work/", root].concat());
            let expected = expected.map(|path| path.strip_suffix(b"/").unwrap_or(&path).to_vec());
            #[cfg(not(windows))]
            assert_eq!(program.root_on_disk(b"/work"), expected);
            assert_eq!(program.knows_root_on_disk(), root.is_some());
        }
    }

    #[test]
    fn root_on_build_machine_round_trips() {
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        for root in [None, Some(&b"/work/app"[..])] {
            let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
            input.root_on_build_machine = root;
            let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
            let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
            assert_eq!(record_end, bytes.len());
            assert_eq!(program.root_on_build_machine(), root);
        }
    }

    #[test]
    fn path_aliases_round_trip() {
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        let aliases = [
            CompiledPathAliasInput {
                folder: b"/$bunfs/root",
                key: b"@lib/*",
                target: b"./aliased/*",
                is_base_url: false,
            },
            CompiledPathAliasInput {
                folder: b"/$bunfs/root",
                key: b"*",
                target: b"./src/*",
                is_base_url: true,
            },
        ];
        let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        input.path_aliases = &aliases;
        let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        program.set_module_lookup(|path| match path {
            b"/$bunfs/root/aliased/job.js" => Some(b"/$bunfs/root/aliased/job.js"),
            b"/$bunfs/root/src/task.js" => Some(b"/$bunfs/root/src/task.js"),
            _ => None,
        });
        let search = bun_resolver::compiled_program::ExtensionSearch {
            extensions: &[],
            extra_extensions: &[],
            rewritten_extensions: &|_, _| &[],
        };
        let find = |specifier: &[u8]| {
            program.resolve_package(b"/$bunfs/root/", b"/$bunfs/root/", specifier, true, &search)
        };
        use bun_resolver::compiled_program::PackageLookup::Found;
        assert_eq!(find(b"@lib/job.js"), Found(b"/$bunfs/root/aliased/job.js"));
        assert_eq!(find(b"task.js"), Found(b"/$bunfs/root/src/task.js"));
        assert_eq!(
            read_back(bytes[..bytes.len() - 1].to_vec(), record_at).err(),
            Some(CORRUPTED)
        );
    }

    #[test]
    fn refused_data_round_trip() {
        use bun_resolver::compiled_program::encode_refused_data;
        let said = |message: &'static [u8], line: i32| RefusedData {
            is_syntax_error: line < 0,
            message,
            line,
            column: 3,
            offset: 40,
            length: 1,
        };
        let records = [
            encode_refused_data(b"/$bunfs/root/data/bad.toml", &said(b"not toml", 1)),
            encode_refused_data(b"/$bunfs/root/data/odd.txt?xml", &said(b"", -1)),
        ]
        .concat();
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        input.refused_data = &records;
        let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        let find = |path: &[u8]| program.find_refused_data(path);
        let toml = find(b"/$bunfs/root/data/bad.toml");
        assert_eq!(toml, Some(said(b"not toml", 1)));
        assert_eq!(find(b"/$bunfs/root/data/odd.txt?xml"), Some(said(b"", -1)));
        assert_eq!(find(b"/$bunfs/root/data/odd.txt"), None);
        assert_eq!(find(b"/$bunfs/root/data/bad.toml?toml"), None);
        assert_eq!(find(b""), None);
    }

    #[test]
    fn removed_paths_are_recorded_once() {
        let record = |path: &str| record_removed_path(format!("/recorded-once/{path}").as_bytes());
        ["a/b", "a/b", "a/bc", "d"].into_iter().for_each(record);
        record("a");
        record("a/c");
        let removed = REMOVED_PATHS.lock();
        let mut of_test: Vec<&[u8]> = (removed.iter())
            .filter_map(|it| it.strip_prefix(b"/recorded-once/"))
            .collect();
        of_test.sort_unstable();
        assert_eq!(of_test, [&b"a"[..], b"d"]);
        drop(removed);
        assert!(is_removed_by_program(b"/recorded-once/a/b/c"));
        assert!(!is_removed_by_program(b"/recorded-once/ab"));
    }

    #[test]
    fn change_time_is_no_birth_time() {
        let at = |sec: i64| bun_sys::Timespec { sec, nsec: 0 };
        let opened = PosixStat {
            ino: 7,
            nlink: 1,
            ctim: at(100),
            birthtim: at(100),
            ..bun_core::ffi::zeroed()
        };
        // As behind `fchmod()` where `fstat()` fills the birth time from the change time.
        let changed = PosixStat {
            ctim: at(200),
            birthtim: at(200),
            ..opened
        };
        assert!(is_same_file(&changed, &opened, false));
        // With `statx`, a later birth is another file that reuses the inode.
        assert!(!is_same_file(&changed, &opened, true));
        let born_as_before = PosixStat {
            birthtim: at(100),
            ..changed
        };
        assert!(is_same_file(&born_as_before, &opened, true));
        let other = PosixStat { ino: 8, ..opened };
        assert!(!is_same_file(&other, &opened, false));
    }

    #[test]
    fn files_for_file_system_alone_round_trip() {
        use bun_resolver::compiled_program::{
            FoundForFileSystemAlone, PathForFileSystemAlone, encode_files_for_file_system_alone,
        };
        let laid = |path: &[u8], modified_at: i64, is_folder: bool| PathForFileSystemAlone {
            path_below_root: path.to_vec(),
            modified_at,
            is_folder,
            is_asset: path.ends_with(b".toml"),
            size_without_bytes: path.ends_with(b".json").then_some(4_020_736),
        };
        let files = encode_files_for_file_system_alone(vec![
            laid(b"data/b.json", 1_700_000_000_123, false),
            laid(b"data/a.toml", -5, false),
            laid(b"data", 7, true),
        ]);
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        input.files_for_file_system_alone = &files;
        input.loaders_given_to_build = b".pic\0text\0";
        let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        assert_eq!(program.loaders_given_to_build(), b".pic\0text\0");
        let found = |number: u32, modified_at: i64, is_folder: bool, is_asset: bool| {
            Some(FoundForFileSystemAlone {
                number,
                modified_at,
                is_folder,
                is_asset,
                size_without_bytes: (number == 3).then_some(4_020_736),
            })
        };
        let find = |path: &[u8]| program.find_for_file_system_alone(path);
        assert_eq!(find(b"data"), found(1, 7, true, false));
        assert_eq!(find(b"data/a.toml"), found(2, -5, false, true));
        assert_eq!(
            find(b"data/b.json"),
            found(3, 1_700_000_000_123, false, false)
        );
        for path in [&b"data/b.jso"[..], b"data/b.json5", b"data/", b""] {
            assert_eq!(find(path), None);
        }
        assert!(encode_files_for_file_system_alone(Vec::new()).is_empty());
    }

    #[test]
    fn loaders_given_to_build_round_trip() {
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        input.loaders_given_to_build = b".pic\0text\0";
        let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        assert_eq!(program.loaders_given_to_build(), b".pic\0text\0");
    }

    #[test]
    fn assets_named_at_root_round_trip() {
        let entry_points = [entry_point(10, b"/$bunfs/root/main.js")];
        let mut input = program(&IMAGE, ALIGNMENT, &entry_points, false);
        input.assets_named_at_root = b"a/config.json\0deep/down/one.txt\0";
        let (bytes, record_at, _) = write(&input, &[Some(0)], 5).unwrap();
        let (program, record_end) = read_back(bytes.clone(), record_at).unwrap();
        assert_eq!(record_end, bytes.len());
        let find = |name: &[u8]| program.assets_named_at_root(name).next();
        assert_eq!(find(b"config.json"), Some(&b"a/config.json"[..]));
        assert_eq!(find(b"one.txt"), Some(&b"deep/down/one.txt"[..]));
        assert_eq!(find(b"a/config.json"), None);
        assert_eq!(find(b"down"), None);
        assert_eq!(find(b""), None);
        assert_eq!(
            read_back(bytes[..bytes.len() - 1].to_vec(), record_at).err(),
            Some(CORRUPTED)
        );
    }

    #[test]
    fn normalizes_windows_keys() {
        for (key, tidy) in [
            (&b"b:/~BUN/root/a.txt"[..], &b"B:/~BUN/root/a.txt"[..]),
            (b"B:/~BUN/root/a.txt/", b"B:/~BUN/root/a.txt"),
            (b"B:/~BUN/root/a.txt//", b"B:/~BUN/root/a.txt"),
            (b"B:/", b"B:/"),
            (b"", b""),
        ] {
            let mut key = key.to_vec();
            let length = normalize_windows_key(&mut key);
            assert_eq!(&key[..length], tidy);
        }
    }

    #[test]
    fn mounts_asset_above_root() {
        let entry_points = [entry_point(1, b"/$bunfs/root/main.js")];
        for (levels, key) in [
            (0, &b"/$bunfs/root/_.._/lib/data.txt"[..]),
            (2, b"/$bunfs/_.._/_.._/lib/data.txt"),
        ] {
            let mut program = program(&IMAGE, ALIGNMENT, &entry_points, false);
            program.levels_above_root = levels;
            program.root_folders_spelled = b"app";
            program.assets_named_at_root = b"../lib/data.txt\0../elsewhere\0../other/elsewhere\0";
            let graph = read_graph(&GraphRequest {
                target: &CompileTarget::default(),
                output_files: &[
                    entry_point_file(b"main.js", Some(0)),
                    asset(b"../lib/data.txt", b"the text"),
                    asset(b"inner/below.txt", b"below the root"),
                    asset(b"../elsewhere/sub/note.txt", b"a note"),
                    asset(b"../other/elsewhere/more.txt", b"more"),
                ],
                module_prefix: &in_virtual_root(""),
                output_format: Format::Esm,
                exec_argv: b"",
                flags: Flags::default(),
                runtime_options: RuntimeOptions::default(),
                compiled_program: Some(program),
            });
            for name in [key, b"/$bunfs/lib/data.txt", b"/$bunfs/root/data.txt"] {
                let file = graph.find_ref(name);
                let shown = String::from_utf8_lossy(name);
                assert_eq!(file.map(|file| file.name), Some(key), "{levels} {shown}");
            }
            assert!(graph.find_ref(b"/$bunfs/root/lib/data.txt").is_none());
            assert!(graph.find_ref(b"/$bunfs/root/data.txt/sub").is_none());
            let note = graph.find_ref(b"/$bunfs/root/elsewhere/sub/note.txt");
            let mounted = graph.find_ref(b"/$bunfs/elsewhere/sub/note.txt");
            assert_eq!(note.map(|file| file.name), mounted.map(|file| file.name));
            assert!(note.is_some(), "{levels}");
            let more = graph.find_ref(b"/$bunfs/root/elsewhere/more.txt");
            let mounted = graph.find_ref(b"/$bunfs/other/elsewhere/more.txt");
            assert_eq!(more.map(|file| file.name), mounted.map(|file| file.name));
            assert!(more.is_some(), "{levels}");
            assert!(graph.find_ref(b"/$bunfs/root/elsewhere/none.txt").is_none());
            let sub = (Box::from(&b"sub"[..]), true);
            let more = (Box::from(&b"more.txt"[..]), false);
            let listed = graph.readdir(b"/$bunfs/root/elsewhere", false).unwrap();
            assert_eq!(listed, [sub.clone(), more.clone()], "{levels}");
            let listed = graph.readdir(b"/$bunfs/elsewhere", false).unwrap();
            assert_eq!(listed, [sub], "{levels}");
            let listed = graph.readdir(b"/$bunfs/other/elsewhere", false).unwrap();
            assert_eq!(listed, [more], "{levels}");
            assert!(graph.find_dir(b"/$bunfs/root/elsewhere/sub"));
            assert!(!graph.find_dir(b"/$bunfs/root/sub"));
            assert!(graph.find_ref(b"/$bunfs/data.txt").is_none());
            let below = graph.find_ref(b"/$bunfs/app/inner/below.txt");
            let name = &b"/$bunfs/root/inner/below.txt"[..];
            assert_eq!(below.map(|file| file.name), Some(name), "{levels}");
            assert!(graph.find_dir(b"/$bunfs/app/inner") && graph.find_dir(b"/$bunfs/app"));
            assert!(graph.find_ref(b"/$bunfs/apps/inner/below.txt").is_none());
            for untidy in [
                &b"/$bunfs/root/../lib/data.txt"[..],
                b"/$bunfs/root/../lib/./data.txt",
                b"/$bunfs/root/../lib//data.txt",
                b"/$bunfs/root/../lib/../lib/data.txt",
            ] {
                let file = graph.find_ref(untidy);
                let shown = String::from_utf8_lossy(untidy);
                assert_eq!(file.map(|file| file.name), Some(key), "{levels} {shown}");
            }
            assert!(
                graph
                    .find_ref(b"/$bunfs/root/../none/../lib/data.txt")
                    .is_none()
            );
            assert!(graph.find_ref(b"/$bunfs/root/../lib/data.txt/").is_none());
            let folder = &key[..key.len() - b"/data.txt".len()];
            let listed = graph.readdir(folder, false).unwrap();
            assert_eq!(listed, [(Box::from(&b"data.txt"[..]), false)]);
            let file = graph.find_ref(key).unwrap();
            assert_eq!(&graph.display_name_of(file)[..], b"data.txt");
            for untidy in [&b"/$bunfs/root/./data.txt"[..], b"/$bunfs/root//data.txt"] {
                let file = graph.find_ref(untidy);
                assert_eq!(file.map(|file| file.name), Some(key), "{levels}");
            }
            assert!(graph.find_ref(b"/$bunfs/root/./data.txt/").is_none());
            assert!(graph.find_ref(b"/$bunfs/root/data.txt/").is_none());
            let climbs = &b"/$bunfs/root/data.txt/../data.txt"[..];
            assert!(graph.find_ref(climbs).is_none());
            #[cfg(not(windows))]
            assert!(graph.find_ref(b"/$bunfs/root/data.txt\\").is_none());
            let at_root = graph.readdir(b"/$bunfs/root", false).unwrap();
            assert!(at_root.contains(&(Box::from(&b"data.txt"[..]), false)));
            assert!(at_root.contains(&(Box::from(&b"elsewhere"[..]), true)));
            let lists_mount = at_root.iter().any(|it| &it.0[..] == b"_.._");
            assert_eq!(lists_mount, levels == 0);
        }
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
    #[cfg(not(windows))]
    fn root_of_the_disk_is_no_folder_of_the_executable() {
        fn list_modules(start: &[u8], each: &mut dyn FnMut(&[u8]) -> bool) {
            for path in [
                &b"/$bunfs/_.._/_.._/no-such-lib/x.js"[..],
                b"/$bunfs/root/main.js",
            ] {
                if path.starts_with(start) && !each(path) {
                    return;
                }
            }
        }
        let folder = TemporaryFolder::create("root-of-the-disk");
        let mut graph = with_request(&folder, false, read_graph);
        let program = graph.compiled_program.take().unwrap();
        program.set_module_listing(list_modules);
        program.set_test_of_path_starts(|start| {
            let folder = &start[..=strings::last_index_of_char(start, b'/').unwrap()];
            let mut holds_one = false;
            list_modules(folder, &mut |_| {
                holds_one = true;
                false
            });
            holds_one
        });
        let program = program.with_root_on_build_machine(Some(b"/no-such-app"));
        graph.compiled_program = Some(program.with_levels_above_root(2));
        for name in [&b"/"[..], b"//", b"/tmp/..", b"/."] {
            let shown = String::from_utf8_lossy(name);
            assert_eq!(directory_key(&graph, name), None, "{shown}");
            assert!(!graph.owns_directory(name), "{shown}");
        }
        let library = directory_key(&graph, b"/no-such-lib");
        let key = &b"/$bunfs/_.._/_.._/no-such-lib"[..];
        assert_eq!(library.as_deref(), Some(key));
    }

    #[test]
    #[cfg(not(windows))]
    fn files_above_the_folder_of_the_build_are_found_as_the_loader_reads_their_paths() {
        fn list_modules(start: &[u8], each: &mut dyn FnMut(&[u8]) -> bool) {
            for path in [
                "/$bunfs/_.._/_.._/_.._/commands/build.js",
                "/$bunfs/_.._/_.._/top.js",
                "/$bunfs/_.._/_.._/two-more/x.js",
                "/$bunfs/root/main.js",
            ] {
                let path = path.as_bytes();
                if path.starts_with(start) && !each(path) {
                    return;
                }
            }
        }
        use SourcePathKind::{Directory, File};
        let folder = TemporaryFolder::create("above-the-root");
        // The program was built in `one/two/app`, which the disk has no longer. Its entry points lay there.
        let app = TemporaryFolder(folder.join("one/two/app"));
        let mut graph = with_request(&app, false, read_graph);
        let program = graph.compiled_program.take().unwrap();
        program.set_module_listing(list_modules);
        // As the image answers: a bit for each folder with code or above code, and a lookup of a whole path.
        program.set_test_of_path_starts(|start| {
            let folder = &start[..=strings::last_index_of_char(start, b'/').unwrap()];
            let mut holds_one = false;
            list_modules(folder, &mut |_| {
                holds_one = true;
                false
            });
            holds_one
        });
        program.set_module_lookup(|path| {
            let mut is_held = false;
            list_modules(path, &mut |held| {
                is_held = held == path;
                false
            });
            is_held.then_some(&b"held"[..])
        });
        let root: &'static [u8] = app.0.clone().leak();
        let program = program.with_root_on_build_machine(Some(root));
        graph.compiled_program = Some(program.with_levels_above_root(3));
        let rows = [
            (folder.join("one/two/commands"), Some(Directory)),
            (folder.join("one/two/commands/build.js"), Some(File)),
            (folder.join("one/top.js"), Some(File)),
            // Its path begins as the folder above the root does, and not at a separator.
            (folder.join("one/two-more/x.js"), Some(File)),
            (folder.join("one/two/app/main.js"), Some(File)),
            // What `path.join(import.meta.dir, "../commands")` makes.
            (b"/$bunfs/commands".to_vec(), Some(Directory)),
            (b"/$bunfs/commands/build.js".to_vec(), Some(File)),
            (b"/$bunfs/none".to_vec(), None),
        ];
        for (path, kind) in rows {
            let shown = String::from_utf8_lossy(&path);
            assert!(graph.may_answer_for(&path), "{shown}");
            assert_eq!(graph.source_path_kind(&path), kind, "{shown}");
            let key = b"/$bunfs/_.._/_.._/_.._/commands".to_vec();
            let key = (kind == Some(Directory)).then_some(key);
            assert_eq!(directory_key(&graph, &path), key, "{shown}");
        }
        let listed = graph.readdir(b"/$bunfs/commands", false).unwrap();
        assert_eq!(listed, [(Box::from(&b"build.js"[..]), false)]);
        assert!(!graph.may_answer_for(b"/no-such-root/commands"));
        // Beside the code above the root, and what merely begins as it does.
        for beside in [
            "one/two/commands/none.js",
            "one/two/commands/none/a.js",
            "one/two/app/none.js",
            "one/two/app/none/a.js",
            "one/two/app/main.js/none",
            "one/two/none",
            "one/two/commands-of-others/a.js",
            "one/none.js",
            "none",
        ] {
            let path = folder.join(beside);
            assert!(!graph.may_answer_for(&path), "{beside}");
            assert_eq!(graph.source_path_kind(&path), None, "{beside}");
        }
        assert!(graph.may_answer_for(&folder.join("one/two")));
        assert!(graph.may_answer_for(&folder.join("one")));
    }

    #[test]
    fn virtual_root_paths() {
        let folder = TemporaryFolder::create("virtual-root");
        let mut graph = with_request(&folder, false, read_graph);
        let (note, plugins) = (folder.join("data/note.txt"), folder.join("plugins"));
        let none = in_virtual_root("none");

        assert!(graph.find_at_source_path(&note).is_none());
        let library = in_virtual_root("lib/libx.so.1");
        let libraries: Vec<_> = graph.preserved_shared_libraries().collect();
        assert_eq!(libraries, [(&library[..], &b"a library"[..])]);
        // It tells nobody the folders of the machine that built it.
        assert!(!graph.owns_directory(&plugins) && !graph.owns_directory(&folder.0));
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
    fn graph_with_room_for_its_image_differs_in_the_room_alone() {
        let folder = TemporaryFolder::create("room");
        let (joined, with_room) = with_request(&folder, false, |request| {
            let with_room = to_bytes(
                request.target,
                request.module_prefix,
                request.output_files,
                request.output_format,
                request.exec_argv,
                request.flags,
                request.runtime_options,
                request.compiled_program.as_ref(),
                ImagePlace::OutsideGraph,
            );
            (graph_bytes(request).unwrap(), with_room.unwrap())
        });
        let (image, room) = (joined.image.unwrap(), with_room.image.unwrap());
        assert_eq!((image.offset, image.length), (room.offset, room.length));
        let start = image.offset as usize;
        let end = start + image.length as usize;
        assert_eq!(joined.bytes[start..end], IMAGE);
        assert_eq!(joined.bytes.len(), with_room.bytes.len());
        assert!(joined.bytes[..start] == with_room.bytes[..start]);
        assert!(joined.bytes[end..] == with_room.bytes[end..]);
    }

    #[test]
    fn slices_of_a_graph_follow_one_another_as_its_bytes_do() {
        let folder = TemporaryFolder::create("slices");
        let (graph, slices, bytes) = with_request(&folder, false, |request| {
            let slices = with_graph_slices(request, |slices| {
                assert!(core::ptr::eq(
                    slices[2].as_ptr(),
                    request.compiled_program.as_ref().unwrap().image.as_ptr()
                ));
                slices.concat()
            });
            (
                graph_bytes(request).unwrap().bytes,
                slices.unwrap(),
                to_graph_bytes(request).unwrap(),
            )
        });
        assert_eq!(slices[..8], (graph.len() as u64).to_le_bytes());
        assert!(slices[8..] == graph[..]);
        assert!(slices == bytes);
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
