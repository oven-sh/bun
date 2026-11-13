//! Reads entries out of a ZIP archive held in memory (PKWARE APPNOTE 6.3.10):
//! stored and deflated entries, ZIP64 sizes and offsets, one disk.
//!
//! `bun upgrade` takes the executable out of the release archive with this on
//! Windows. It used to run PowerShell's `Expand-Archive`, which depends on the
//! `PSModulePath` it inherits: started from PowerShell 7, Windows PowerShell
//! 5.1 loads the Archive module of PowerShell 7, whose
//! `ZipFileExtensions.ExtractToDirectory(archive, path, overwrite)` overload
//! does not exist on .NET Framework (`MethodCountCouldNotFindBest`). Nothing
//! was extracted, the exit code stayed 0, and the upgrade then failed with
//! `Failed to verify Bun (code: ENOENT)`.

use bun_libdeflate_sys::libdeflate::{Encoding, OwnedDecompressor, Status};

const EOCD_SIGNATURE: u32 = 0x0605_4b50;
const EOCD_LEN: usize = 22;
const ZIP64_LOCATOR_SIGNATURE: u32 = 0x0706_4b50;
const ZIP64_LOCATOR_LEN: usize = 20;
const ZIP64_EOCD_SIGNATURE: u32 = 0x0606_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const CENTRAL_LEN: usize = 46;
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const LOCAL_LEN: usize = 30;
const ZIP64_EXTRA_ID: u16 = 0x0001;
const SATURATED_U32: u64 = 0xFFFF_FFFF;

const METHOD_STORED: u16 = 0;
const METHOD_DEFLATED: u16 = 8;
const FLAG_ENCRYPTED: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ZipError {
    #[error("not a zip archive")]
    NotZip,
    #[error("truncated zip archive")]
    Truncated,
    #[error("zip archive split over several disks")]
    MultiDisk,
    #[error("encrypted zip entry")]
    Encrypted,
    #[error("unsupported zip compression method {0}")]
    UnsupportedMethod(u16),
    #[error("corrupt deflate stream")]
    Corrupt,
    #[error("zip entry size does not match its header")]
    SizeMismatch,
    #[error("zip entry CRC-32 does not match its header")]
    Crc,
    #[error("out of memory")]
    OutOfMemory,
}

fn field<const N: usize>(bytes: &[u8], at: usize) -> Result<[u8; N], ZipError> {
    let end = at.checked_add(N).ok_or(ZipError::Truncated)?;
    let slice = bytes.get(at..end).ok_or(ZipError::Truncated)?;
    let mut out = [0u8; N];
    out.copy_from_slice(slice);
    Ok(out)
}
fn u16_at(bytes: &[u8], at: usize) -> Result<u16, ZipError> {
    field::<2>(bytes, at).map(u16::from_le_bytes)
}
fn u32_at(bytes: &[u8], at: usize) -> Result<u32, ZipError> {
    field::<4>(bytes, at).map(u32::from_le_bytes)
}
fn u64_at(bytes: &[u8], at: usize) -> Result<u64, ZipError> {
    field::<8>(bytes, at).map(u64::from_le_bytes)
}
fn to_usize(v: u64) -> Result<usize, ZipError> {
    usize::try_from(v).map_err(|_| ZipError::Truncated)
}
fn span(bytes: &[u8], start: usize, len: usize) -> Result<&[u8], ZipError> {
    let end = start.checked_add(len).ok_or(ZipError::Truncated)?;
    bytes.get(start..end).ok_or(ZipError::Truncated)
}

/// Archive names use `/`; archives written by some Windows tools use `\`.
fn same_name(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(&x, &y)| {
            let norm = |c: u8| if c == b'\\' { b'/' } else { c };
            norm(x) == norm(y)
        })
}

/// A ZIP archive in memory: its bytes and its central directory.
pub struct Archive<'a> {
    bytes: &'a [u8],
    central: &'a [u8],
    count: u64,
}

impl<'a> Archive<'a> {
    pub fn open(bytes: &'a [u8]) -> Result<Self, ZipError> {
        if bytes.len() < EOCD_LEN {
            return Err(ZipError::NotZip);
        }
        // The end of central directory record is followed only by its comment
        // (at most 65535 bytes), so it is searched for backwards from the end.
        let lowest = bytes.len().saturating_sub(EOCD_LEN + usize::from(u16::MAX));
        let mut at = bytes.len() - EOCD_LEN;
        let eocd = loop {
            if u32_at(bytes, at)? == EOCD_SIGNATURE
                && at + EOCD_LEN + usize::from(u16_at(bytes, at + 20)?) <= bytes.len()
            {
                break at;
            }
            if at == lowest {
                return Err(ZipError::NotZip);
            }
            at -= 1;
        };

        let mut disk = u32::from(u16_at(bytes, eocd + 4)?);
        let mut central_disk = u32::from(u16_at(bytes, eocd + 6)?);
        let mut count = u64::from(u16_at(bytes, eocd + 10)?);
        let mut central_size = u64::from(u32_at(bytes, eocd + 12)?);
        let mut central_offset = u64::from(u32_at(bytes, eocd + 16)?);

        if count == u64::from(u16::MAX)
            || central_size == SATURATED_U32
            || central_offset == SATURATED_U32
        {
            // ZIP64: the locator sits right before the end of central directory record.
            if let Some(locator) = eocd.checked_sub(ZIP64_LOCATOR_LEN) {
                if u32_at(bytes, locator)? == ZIP64_LOCATOR_SIGNATURE {
                    let record = to_usize(u64_at(bytes, locator + 8)?)?;
                    if u32_at(bytes, record)? != ZIP64_EOCD_SIGNATURE {
                        return Err(ZipError::NotZip);
                    }
                    disk = u32_at(bytes, record + 16)?;
                    central_disk = u32_at(bytes, record + 20)?;
                    count = u64_at(bytes, record + 32)?;
                    central_size = u64_at(bytes, record + 40)?;
                    central_offset = u64_at(bytes, record + 48)?;
                }
            }
        }

        if disk != 0 || central_disk != 0 {
            return Err(ZipError::MultiDisk);
        }

        let central = span(bytes, to_usize(central_offset)?, to_usize(central_size)?)?;
        Ok(Self {
            bytes,
            central,
            count,
        })
    }

    /// The entry whose name is `name` (`/` and `\` compare equal).
    pub fn find(&self, name: &[u8]) -> Result<Option<Entry<'a>>, ZipError> {
        let mut at = 0usize;
        for _ in 0..self.count {
            let (entry, next) = self.central_entry(at)?;
            if same_name(entry.name, name) {
                return Ok(Some(entry));
            }
            at = next;
        }
        Ok(None)
    }

    fn central_entry(&self, at: usize) -> Result<(Entry<'a>, usize), ZipError> {
        let central = self.central;
        if u32_at(central, at)? != CENTRAL_SIGNATURE {
            return Err(ZipError::NotZip);
        }
        let name_len = usize::from(u16_at(central, at + 28)?);
        let extra_len = usize::from(u16_at(central, at + 30)?);
        let comment_len = usize::from(u16_at(central, at + 32)?);
        let name = span(central, at + CENTRAL_LEN, name_len)?;
        let extra = span(central, at + CENTRAL_LEN + name_len, extra_len)?;

        let mut entry = Entry {
            archive: self.bytes,
            name,
            flags: u16_at(central, at + 8)?,
            method: u16_at(central, at + 10)?,
            crc32: u32_at(central, at + 16)?,
            compressed_size: u64::from(u32_at(central, at + 20)?),
            uncompressed_size: u64::from(u32_at(central, at + 24)?),
            local_header_offset: u64::from(u32_at(central, at + 42)?),
        };

        // ZIP64 extended information: holds, in this order, each of the three
        // values whose 32-bit field is saturated.
        if entry.uncompressed_size == SATURATED_U32
            || entry.compressed_size == SATURATED_U32
            || entry.local_header_offset == SATURATED_U32
        {
            let mut x = 0usize;
            while x + 4 <= extra.len() {
                let id = u16_at(extra, x)?;
                let len = usize::from(u16_at(extra, x + 2)?);
                let data = span(extra, x + 4, len)?;
                if id == ZIP64_EXTRA_ID {
                    let mut f = 0usize;
                    for value in [
                        &mut entry.uncompressed_size,
                        &mut entry.compressed_size,
                        &mut entry.local_header_offset,
                    ] {
                        if *value == SATURATED_U32 {
                            *value = u64_at(data, f)?;
                            f += 8;
                        }
                    }
                    break;
                }
                x += 4 + len;
            }
        }

        let next = at + CENTRAL_LEN + name_len + extra_len + comment_len;
        Ok((entry, next))
    }
}

/// One file of an [`Archive`].
pub struct Entry<'a> {
    archive: &'a [u8],
    name: &'a [u8],
    flags: u16,
    method: u16,
    crc32: u32,
    compressed_size: u64,
    uncompressed_size: u64,
    local_header_offset: u64,
}

impl Entry<'_> {
    /// The entry's data as stored in the archive (compressed or not).
    fn raw(&self) -> Result<&[u8], ZipError> {
        let header = to_usize(self.local_header_offset)?;
        if u32_at(self.archive, header)? != LOCAL_SIGNATURE {
            return Err(ZipError::NotZip);
        }
        // The local header's name and extra field may differ in length from
        // the central directory's, so its own lengths locate the data.
        let start = header
            + LOCAL_LEN
            + usize::from(u16_at(self.archive, header + 26)?)
            + usize::from(u16_at(self.archive, header + 28)?);
        span(self.archive, start, to_usize(self.compressed_size)?)
    }

    /// The entry's contents, decompressed and checked against its CRC-32.
    pub fn read(&self) -> Result<Vec<u8>, ZipError> {
        if self.flags & FLAG_ENCRYPTED != 0 {
            return Err(ZipError::Encrypted);
        }
        let raw = self.raw()?;
        let size = usize::try_from(self.uncompressed_size).map_err(|_| ZipError::OutOfMemory)?;
        let mut out: Vec<u8> = Vec::new();
        out.try_reserve_exact(size)
            .map_err(|_| ZipError::OutOfMemory)?;
        match self.method {
            METHOD_STORED => {
                if raw.len() != size {
                    return Err(ZipError::SizeMismatch);
                }
                out.extend_from_slice(raw);
            }
            METHOD_DEFLATED => {
                bun_libdeflate_sys::libdeflate::load();
                let mut decompressor = OwnedDecompressor::new().ok_or(ZipError::OutOfMemory)?;
                let result = decompressor.decompress_to_vec(raw, &mut out, Encoding::Deflate);
                match result.status {
                    Status::Success if out.len() == size => {}
                    Status::BadData => return Err(ZipError::Corrupt),
                    _ => return Err(ZipError::SizeMismatch),
                }
            }
            method => return Err(ZipError::UnsupportedMethod(method)),
        }
        if bun_zlib::crc32_bytes(0, &out) != self.crc32 {
            return Err(ZipError::Crc);
        }
        Ok(out)
    }
}
