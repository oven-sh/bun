//! Finds a data item. ICU4C: udata.cpp, udatamem.cpp

use crate::common::bytes::U_IS_BIG_ENDIAN;
use crate::common::charstr::SmallChars;
use crate::common::memory::{self, Appendable};
use crate::common::umutex::OnceBox;
use crate::common::utypes::{
    U_FILE_ACCESS_ERROR, U_ILLEGAL_ARGUMENT_ERROR, U_INVALID_FORMAT_ERROR, UErrorCode,
};
use crate::sys::package;
use bun_core::strings;
use bun_paths::SEP;
use bun_sys::{CloseOnDrop, File};

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

/// Returns `ICU_TIMEZONE_FILES_DIR` as it was at the first call, so that all files come from one setting.
fn time_zone_files_directories() -> Result<&'static Vec<u8>, UErrorCode> {
    static DIRECTORIES: OnceBox<Vec<u8>> = OnceBox::new();
    DIRECTORIES.get_or_try_init(|| {
        let variable = bun_core::getenv_z(bun_core::zstr!("ICU_TIMEZONE_FILES_DIR"));
        let mut directories = memory::try_to_vec(variable.unwrap_or_default())?;
        bun_paths::resolve_path::posix_to_platform_in_place(&mut directories);
        Ok(directories)
    })
}

#[cfg(unix)]
fn open_file(path: &[u8]) -> Result<Option<File>, UErrorCode> {
    use bun_sys::{Fd, O};
    Ok(File::openat(Fd::cwd(), path, O::RDONLY | O::NOCTTY, 0).ok())
}

/// `File::openat` does not resolve `\tz`, `D:tz` and `\\?\UNC\server\share`.
#[cfg(windows)]
fn open_file(path: &[u8]) -> Result<Option<File>, UErrorCode> {
    use bun_sys::windows::*;
    let mut wide = memory::try_filled(0, path.len() + 1)?;
    match CreateFileW(
        strings::convert_utf8_to_utf16_in_buffer_z(&mut wide, path),
        GENERIC_READ,
        FILE_SHARE_READ,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
    ) {
        Err(Win32Error::OUTOFMEMORY) => Err(memory::set_oom(())),
        file => Ok(file.ok().map(File::from)),
    }
}

/// Returns `None` unless the file has the size that it states, from 1 to `i32::MAX`. ICU4C: umapfile.cpp, uprv_mapFile
fn read_file(path: &[u8]) -> Result<Option<Vec<u8>>, UErrorCode> {
    const MAX_SIZE: usize = i32::MAX as usize;
    let Some(file) = open_file(path)?.map(CloseOnDrop::from) else {
        return Ok(None);
    };
    let Ok(size @ 1..=MAX_SIZE) = file.get_end_pos() else {
        return Ok(None);
    };
    let mut contents = memory::try_filled(0, size)?;
    let count = file.pread_all(&mut contents, 0);
    Ok(count.is_ok_and(|count| count == size).then_some(contents))
}

/// Returns the first `<name>.res` in `time_zone_files_directories` that is acceptable. Fails if there are only others.
fn time_zone_file(
    name: &[u8],
    is_acceptable: impl Fn(&[u8]) -> bool,
) -> Result<Option<&'static Vec<u8>>, UErrorCode> {
    const NAMES: [&[u8]; 4] = [
        b"zoneinfo64",
        b"timezoneTypes",
        b"windowsZones",
        b"metaZones",
    ];
    static FILES: [OnceBox<Vec<u8>>; NAMES.len()] = [const { OnceBox::new() }; _];
    let Some((_, file)) = NAMES.iter().zip(&FILES).find(|(known, _)| **known == name) else {
        return Ok(None);
    };
    let file = file.get_or_try_init(|| {
        let mut error = U_FILE_ACCESS_ERROR;
        for directory in strings::split(time_zone_files_directories()?, &[bun_paths::DELIMITER])
            .filter(|it| !it.is_empty() && !it.ends_with(b".dat"))
        {
            let directory = directory.strip_suffix(&[SEP]).unwrap_or(directory);
            let path = memory::try_concat(&[directory, &[SEP], name, b".res"])?;
            match read_file(&path)? {
                Some(file) if is_acceptable(&file) => return Ok(file),
                Some(_) => error = U_INVALID_FORMAT_ERROR,
                None => {}
            }
        }
        Err(error)
    });
    match file {
        Err(U_FILE_ACCESS_ERROR) => Ok(None),
        file => file.map(Some),
    }
}

/// `udata_openChoice`. `tree` is a directory of the package.
pub(crate) fn open_choice(
    tree: Option<&[u8]>,
    type_: &[u8],
    name: &[u8],
    is_acceptable: fn(&UDataInfo) -> bool,
) -> Result<UDataMemory, UErrorCode> {
    if name.is_empty() {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let accepts = |item: &[u8]| {
        UDataInfo::split_item(item)
            .is_some_and(|(info, _)| info.matches_platform() && is_acceptable(&info))
    };
    let accept = |item: &'static [u8]| {
        let (info, memory) = UDataInfo::split_item(item).filter(|_| accepts(item))?;
        Some(UDataMemory { info, memory })
    };
    if tree.is_none()
        && type_ == b"res"
        && let Some(file) = time_zone_file(name, accepts)?
    {
        return accept(file).ok_or(U_INVALID_FORMAT_ERROR);
    }
    // "icudt79l/coll/ar.res"
    let mut entry = SmallChars::new();
    entry.add_all(b"icudt79l");
    for (separator, part) in [
        (b'/', tree.unwrap_or_default()),
        (b'/', name),
        (b'.', type_),
    ] {
        if !part.is_empty() {
            entry.add(separator);
            entry.add_all(part);
        }
    }
    memory::check_oom()?;
    let item = memory::oom_checked(package::find(&entry))?;
    accept(item.ok_or(U_FILE_ACCESS_ERROR)?).ok_or(U_INVALID_FORMAT_ERROR)
}
