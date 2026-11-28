//! Finds a data item in files and packages. ICU4C: udata.cpp, udatamem.cpp

use crate::common::bytes::U_IS_BIG_ENDIAN;
use crate::common::charstr::SmallChars;
use crate::common::cstring::{find_last_byte, split_once};
use crate::common::linked::{self, Text};
use crate::common::memory::{self, Appendable, oom_checked, try_box, try_to_vec};
use crate::common::slice_ext::SliceExt;
use crate::common::ucmndata::Package;
use crate::common::umutex::{OnceBox, StaticMap};
use crate::common::utypes::{
    U_FILE_ACCESS_ERROR, U_ILLEGAL_ARGUMENT_ERROR, U_INVALID_FORMAT_ERROR,
    U_MEMORY_ALLOCATION_ERROR, UErrorCode,
};
use crate::sys::file::{self, Mapping, ok_or_oom};
use bun_core::{ZStr, strings, zstr};
use bun_paths::{DELIMITER, SEP, to_native_in_place};
use bun_sys::CloseOnDrop;
use std::ffi::{CStr, CString};

pub(crate) const U_ICUDATA_NAME: &[u8] = b"icudt79l";
pub(crate) const U_ICUDATA_ALIAS: &[u8] = b"ICUDATA";
const U_TREE_SEPARATOR: u8 = b'-';

/// `UDataInfo` as C reads it on this platform: `size` is not swapped for data of the opposite byte order.
#[derive(Clone, Copy)]
pub(crate) struct UDataInfo {
    pub size: u16,
    pub is_big_endian: u8,
    pub charset_family: u8,
    pub(crate) sizeof_uchar: u8,
    pub data_format: [u8; 4],
    pub format_version: [u8; 4],
    pub data_version: [u8; 4],
}

#[derive(Clone, Copy)]
pub(crate) struct UDataMemory {
    pub info: UDataInfo,
    /// `udata_getMemory`: the bytes after the header.
    pub memory: &'static [u8],
}

impl UDataInfo {
    /// Returns the info and the bytes after the header, or `None` if `item` does not contain a complete header.
    pub(crate) fn split_item(item: &[u8]) -> Option<(Self, &[u8])> {
        let (info, header_size) = Self::with_header_size(item)?;
        Some((info, item.get(header_size..)?))
    }

    /// Parses `DataHeader { headerSize, magic1, magic2, info }`. Returns the info and `udata_getHeaderSize`.
    pub(crate) fn with_header_size(item: &[u8]) -> Option<(Self, usize)> {
        let &[
            [header_size @ .., 0xda, 0x27],
            [size @ .., _, _],
            [is_big_endian, charset_family, sizeof_uchar, _],
            data_format,
            format_version,
            data_version,
            ..,
        ] = item.as_chunks::<4>().0
        else {
            return None;
        };
        let (size, header_size) = (u16::from_ne_bytes(size), u16::from_ne_bytes(header_size));
        let header_size = if is_big_endian == U_IS_BIG_ENDIAN {
            header_size
        } else {
            header_size.swap_bytes()
        };
        let info = Self {
            size,
            is_big_endian,
            charset_family,
            sizeof_uchar,
            data_format,
            format_version,
            data_version,
        };
        Some((info, header_size.into()))
    }

    fn matches_platform(&self) -> bool {
        self.size >= 20 && self.is_big_endian == U_IS_BIG_ENDIAN && self.charset_family == 0
    }
}

/// Aligned like an item in a package.
#[repr(C, align(16))]
pub(crate) struct Aligned<T>(pub(crate) T);

macro_rules! compiled_in_bytes {
    ($file:literal) => {
        include_bytes!(concat!("../data/", $file))
    };
}

/// Embeds a file of ICU4C: source/data/in. Evaluates to the data version and the bytes after the header.
macro_rules! compiled_in {
    ($file:literal, $format:literal, $format_version:literal) => {
        const {
            use $crate::common::udata::{Aligned, compiled_in_bytes};
            static ITEM: Aligned<[u8; compiled_in_bytes!($file).len()]> =
                Aligned(*compiled_in_bytes!($file));
            let [
                size0,
                size1,
                _,
                _,
                _,
                _,
                _,
                _,
                _,
                _,
                _,
                _,
                format @ ..,
                version0,
                version1,
                version2,
                version3,
            ] = *ITEM.0.first_chunk::<24>().unwrap();
            assert!(matches!(
                format.split_at(4),
                ($format, [$format_version, ..])
            ));
            let header_size = u16::from_ne_bytes([size0, size1]) as usize;
            (
                [version0, version1, version2, version3],
                ITEM.0.split_at(header_size).1,
            )
        }
    };
}

/// Evaluates to `indexes[index]` of a table from `compiled_in!` that starts with `int32_t indexes[]`.
macro_rules! compiled_in_index {
    ($bytes:expr, $index:expr) => {
        const { u32::from_ne_bytes(*$bytes.split_at($index * 4).1.first_chunk().unwrap()) as usize }
    };
}
pub(crate) use {compiled_in, compiled_in_bytes, compiled_in_index};

/// Returns a list of directories as it was at the first call, so that all files come from one setting.
fn directories(
    list: &'static OnceBox<Vec<u8>>,
    variable: &ZStr,
) -> Result<&'static [u8], UErrorCode> {
    let list = list.get_or_try_init(|| {
        let mut directories = try_to_vec(bun_core::getenv_z(variable).unwrap_or_default())?;
        to_native_in_place(&mut directories);
        Ok(directories)
    });
    list.map(Vec::as_slice)
}

fn data_directories() -> Result<&'static [u8], UErrorCode> {
    static LIST: OnceBox<Vec<u8>> = OnceBox::new();
    directories(&LIST, zstr!("ICU_DATA"))
}

fn time_zone_files_directories() -> Result<&'static [u8], UErrorCode> {
    static LIST: OnceBox<Vec<u8>> = OnceBox::new();
    directories(&LIST, zstr!("ICU_TIMEZONE_FILES_DIR"))
}

fn find_basename(path: &[u8]) -> &[u8] {
    path.slice(find_last_byte(path, SEP).map_or(0, |at| at + 1)..)
}

/// Yields the paths at which a package (`suffix` is `None`) or an item ("coll/de.res") can be. ICU4C: udata.cpp, UDataPathIterator
fn candidate_paths<'a>(
    directories: &'a [u8],
    package: &'a [u8],
    suffix: Option<&'a [u8]>,
) -> impl Iterator<Item = Result<CString, UErrorCode>> {
    let separator = |is_needed: bool| if is_needed { &[SEP][..] } else { &[] };
    let path = move |directory: &[u8]| {
        let &last = directory.last()?;
        if let Some(stem) = directory.strip_suffix(b".dat") {
            return (suffix.is_none() && find_basename(stem) == package)
                .then(|| memory::try_cstring(directory));
        }
        // A directory with the name of the package is replaced by its parent.
        let parent = (!package.is_empty() && last != SEP)
            .then(|| directory.strip_suffix(package)?.strip_suffix(&[SEP]))
            .flatten()
            .filter(|parent| !parent.is_empty());
        let suffix = suffix.unwrap_or(b".dat");
        let path = memory::try_concat(&[
            parent.unwrap_or(directory),
            separator(last != SEP),
            package,
            separator(suffix.len() > 4 && package.last().is_some_and(|&last| last != SEP)),
            suffix,
        ]);
        Some(path.and_then(|path| memory::try_cstring(&path)))
    };
    strings::split(directories, &[DELIMITER]).filter_map(path)
}

/// Returns `None` unless the size is from 1 to `i32::MAX`.
fn open_with_size(path: &CStr) -> Result<Option<(CloseOnDrop, usize)>, UErrorCode> {
    const MAX_SIZE: usize = i32::MAX as usize;
    oom_checked(file::open(path).and_then(|file| {
        let size = ok_or_oom(file.get_end_pos())?;
        matches!(size, 1..=MAX_SIZE).then_some((file, size))
    }))
}

/// Returns a copy of the file, so that it can be replaced while the process runs. Only what `accepts` is kept.
fn read_item_file(
    path: CString,
    accepts: &dyn Fn(&UDataInfo) -> bool,
) -> Result<Option<&'static [u8]>, UErrorCode> {
    static FILES: StaticMap<CString, &[u8]> = StaticMap::new();
    if let Some(contents) = FILES.get(&path) {
        return Ok(Some(contents));
    }
    let Some((file, size)) = open_with_size(&path)? else {
        return Ok(None);
    };
    let mut header = [0; 24];
    if ok_or_oom(file.pread_all(&mut header, 0)).is_none() {
        return oom_checked(None);
    } else if !UDataInfo::with_header_size(&header).is_some_and(|(info, _)| accepts(&info)) {
        return Err(U_INVALID_FORMAT_ERROR);
    }
    let mut contents = memory::try_filled(0, size)?;
    if ok_or_oom(file.pread_all(&mut contents, 0)) != Some(size) {
        return oom_checked(None);
    }
    FILES.get_or_insert_with(path, || contents.leak()).map(Some)
}

/// Returns the first `<name>.dat` that can be mapped. ICU4C: udata.cpp, openCommonData
fn package_by_name(name: &[u8]) -> Result<Package<'static>, UErrorCode> {
    static PACKAGES: StaticMap<Vec<u8>, &Mapping> = StaticMap::new();
    if name.is_empty() {
        return Err(U_FILE_ACCESS_ERROR);
    }
    if let Some(mapping) = PACKAGES.get(name) {
        return Package::new(mapping);
    }
    for path in candidate_paths(data_directories()?, name, None) {
        if let Some((file, size)) = open_with_size(&path?)?
            && let Some(mapping) = oom_checked(Mapping::new(&file, size))?
        {
            Package::new(&mapping)?;
            let mapping = try_box(mapping)?;
            return Package::new(
                PACKAGES.get_or_insert_with(try_to_vec(name)?, || Box::leak(mapping))?,
            );
        }
    }
    Err(U_FILE_ACCESS_ERROR)
}

/// The parts of the argument `path` of `udata_open`. It has no directory: an alias ends it at the first slash.
struct DataPath<'a> {
    is_icu_data: bool,
    package: &'a [u8],
    tree: &'a [u8],
}

impl<'a> DataPath<'a> {
    fn parse(path: &'a [u8]) -> Self {
        let has_drive = cfg!(windows) && matches!(path, [b'A'..=b'Z' | b'a'..=b'z', b':', ..]);
        let (package, tree) = if has_drive {
            (path, None)
        } else {
            split_once(path, U_TREE_SEPARATOR)
        };
        let is_icu_data =
            package == U_ICUDATA_ALIAS || (package == U_ICUDATA_NAME && tree.is_some());
        Self {
            is_icu_data,
            package: if is_icu_data { U_ICUDATA_NAME } else { package },
            tree: tree.unwrap_or_default(),
        }
    }
}

struct Search {
    /// `None` accepts any item, also one for another platform.
    is_acceptable: Option<fn(&UDataInfo) -> bool>,
    /// The error if no item is accepted.
    error: Option<UErrorCode>,
}

type Found = Result<Option<UDataMemory>, UErrorCode>;

impl Search {
    fn accepts(&self, info: &UDataInfo) -> bool {
        (self.is_acceptable).is_none_or(|accepts| info.matches_platform() && accepts(info))
    }

    /// C reads strings where they are, so an odd address is not accepted.
    fn accept(&mut self, item: &'static [u8]) -> Option<UDataMemory> {
        let accepted = UDataInfo::split_item(item)
            .filter(|(info, memory)| self.accepts(info) && memory.as_ptr().addr() % 2 == 0);
        if accepted.is_none() {
            self.error = Some(U_INVALID_FORMAT_ERROR);
        }
        accepted.map(|(info, memory)| UDataMemory { info, memory })
    }

    fn keep_error<T>(&mut self, result: Result<T, UErrorCode>) -> Result<Option<T>, UErrorCode> {
        match result {
            Err(U_MEMORY_ALLOCATION_ERROR) => Err(U_MEMORY_ALLOCATION_ERROR),
            result => Ok(result.map_err(|error| self.error = Some(error)).ok()),
        }
    }

    #[cold]
    fn in_files(&mut self, directories: &[u8], package: &[u8], suffix: &[u8]) -> Found {
        let mut suffix = try_to_vec(suffix)?;
        to_native_in_place(&mut suffix);
        for path in candidate_paths(directories, package, Some(&suffix)) {
            let file = read_item_file(path?, &|info| self.accepts(info));
            if let Some(Some(file)) = self.keep_error(file)?
                && let Some(data) = self.accept(file)
            {
                return Ok(Some(data));
            }
        }
        Ok(None)
    }

    fn in_package_files(&mut self, path: &DataPath<'_>, entry: &[u8]) -> Found {
        /// `icudt79l.dat`, which is looked for once, when the linked package first gives nothing.
        static EXTENSION: OnceBox<Option<Package<'static>>> = OnceBox::new();
        let package = if path.is_icu_data {
            *EXTENSION.get_or_try_init(|| self.keep_error(package_by_name(U_ICUDATA_NAME)))?
        } else {
            self.keep_error(package_by_name(path.package))?
        };
        let item = package.and_then(|package| package.find(entry));
        Ok(item.and_then(|item| self.accept(item)))
    }
}

/// Returns whether `ICU_DATA` is set. If not, a caller can skip what the linked data do not need.
pub(crate) fn searches_files() -> Result<bool, UErrorCode> {
    Ok(!data_directories()?.is_empty())
}

#[inline(always)]
fn is_time_zone_bundle(name: &[u8]) -> bool {
    matches!(
        name,
        b"zoneinfo64" | b"timezoneTypes" | b"windowsZones" | b"metaZones"
    )
}

/// Returns whether the bundle `name` of ICU's data can be another one than the linked package has.
#[inline(always)]
pub(crate) fn bundle_may_be_replaced(name: &[u8]) -> Result<bool, UErrorCode> {
    Ok(searches_files()?
        || (is_time_zone_bundle(name) && !time_zone_files_directories()?.is_empty()))
}

/// An item, or a bundle in a form that only the linked package has.
pub(crate) enum Data {
    Item(UDataMemory),
    Image {
        bytes: &'static [u8],
        keys: &'static [u8],
        root: u32,
        no_fallback: bool,
    },
    Text(Box<Text>),
}

impl Data {
    fn into_item(self) -> Result<UDataMemory, UErrorCode> {
        match self {
            Self::Item(item) => Ok(item),
            _ => Err(U_INVALID_FORMAT_ERROR),
        }
    }
}

/// `udata_openChoice`
#[inline(always)]
pub(crate) fn open_choice(
    path: Option<&[u8]>,
    type_: &[u8],
    name: &[u8],
    is_acceptable: fn(&UDataInfo) -> bool,
) -> Result<UDataMemory, UErrorCode> {
    do_open_choice(path, type_, name, Some(is_acceptable), Places::All)?.into_item()
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Places {
    All,
    ExceptDirectories,
}

pub(crate) fn open_bundle(
    path: Option<&[u8]>,
    name: &[u8],
    is_acceptable: fn(&UDataInfo) -> bool,
    places: Places,
) -> Result<Data, UErrorCode> {
    do_open_choice(path, b"res", name, Some(is_acceptable), places)
}

/// Ends the search at the first item, and fails if that is for another platform.
pub(crate) fn open(path: &[u8], type_: &[u8], name: &[u8]) -> Result<UDataMemory, UErrorCode> {
    let data = do_open_choice(Some(path), type_, name, None, Places::All)?.into_item()?;
    (data.info.matches_platform())
        .then_some(data)
        .ok_or(U_INVALID_FORMAT_ERROR)
}

// ICU4C: udata.cpp, doOpenChoice
fn do_open_choice(
    path: Option<&[u8]>,
    type_: &[u8],
    name: &[u8],
    is_acceptable: Option<fn(&UDataInfo) -> bool>,
    places: Places,
) -> Result<Data, UErrorCode> {
    if name.is_empty() {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let path = DataPath::parse(path.unwrap_or(U_ICUDATA_ALIAS));
    // "icudt79l/coll/ar.res"
    let mut entry = SmallChars::new();
    entry.add_all(path.package);
    for (separator, part) in [(b'/', path.tree), (b'/', name), (b'.', type_)] {
        if !part.is_empty() {
            entry.add(separator);
            entry.add_all(part);
        }
    }
    memory::check_oom()?;
    let suffix = entry.slice(path.package.len() + 1..);
    let mut search = Search {
        is_acceptable,
        error: None,
    };
    if path.is_icu_data
        && type_ == b"res"
        && is_time_zone_bundle(name)
        && places == Places::All
        && let Some(data) = search.in_files(time_zone_files_directories()?, b"", suffix)?
    {
        return Ok(Data::Item(data));
    }
    let directories = data_directories()?;
    if (!directories.is_empty() || !path.is_icu_data)
        && places == Places::All
        && let Some(data) = search.in_files(directories, path.package, suffix)?
    {
        return Ok(Data::Item(data));
    }
    if path.is_icu_data {
        let bundle = (type_ == b"res").then_some((path.tree, name));
        let accept = &mut |item| search.accept(item).map(Data::Item);
        if let Some(data) = linked::find(suffix, bundle, accept)? {
            return Ok(data);
        }
    }
    let found = search.in_package_files(&path, &entry)?.map(Data::Item);
    found.ok_or_else(|| search.error.unwrap_or(U_FILE_ACCESS_ERROR))
}
