//! Writes "restricted pax": ustar, plus a pax header where that falls short. Regular files only.

use crate::error::Result;
use crate::header::{
    BLOCK_SIZE, Block, CHECKSUM, DEVMAJOR, DEVMINOR, GID, MAGIC, MODE, MTIME, NAME, PREFIX, SIZE,
    TYPEFLAG, UID, USTAR_MAGIC, padding_for,
};
use crate::output::Output;
use bun_core::{slice_to_nul, strings};
use core::ops::Range;

/// How a name that is not ASCII is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Names {
    /// POSIX: the bytes as they are, marked `hdrcharset=BINARY`.
    Binary,
    /// Windows: UTF-8 with its characters composed, and `\` turned into `/`.
    Utf8,
}

impl Names {
    pub fn for_host() -> Self {
        if cfg!(windows) {
            Self::Utf8
        } else {
            Self::Binary
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct File<'a> {
    /// Ends at its first NUL.
    pub path: &'a [u8],
    pub size: u64,
    pub perm: u32,
    pub mtime: i64,
}

const RECORD_SIZE: u64 = 10240;
/// The last time that fits in eleven octal digits, which still gets a pax record.
const USTAR_MTIME_MAX: i64 = (1 << 33) - 1;
const USTAR_SIZE_END: u64 = 1 << 33;
const MODE_DIGITS: usize = 6;
const SIZE_DIGITS: usize = 11;
const MTIME_DIGITS: usize = 11;
/// As many as always fit in an `i64`.
const MAX_OCTAL_DIGITS: usize = (i64::BITS / 3) as usize;
/// A NUL and a space follow them.
const CHECKSUM_DIGITS: Range<usize> = CHECKSUM.start..CHECKSUM.start + 6;
static ZEROS: [u8; 1024] = [0; 1024];

pub struct Writer<O: Output> {
    out: O,
    names: Names,
    written: u64,
    /// Of the current entry: the data still owed, and the zeros behind it.
    remaining: u64,
    padding: u64,
}

impl<O: Output> Writer<O> {
    pub fn new(out: O, names: Names) -> Self {
        Self {
            out,
            names,
            written: 0,
            remaining: 0,
            padding: 0,
        }
    }

    fn put(&mut self, bytes: &[u8]) -> Result<()> {
        self.written = self.written.saturating_add(bytes.len() as u64);
        self.out.write(bytes)
    }

    fn put_zeros(&mut self, mut count: u64) -> Result<()> {
        while count > 0 {
            let take = count.min(ZEROS.len() as u64);
            self.put(ZEROS.get(..take as usize).unwrap_or_default())?;
            count = count.saturating_sub(take);
        }
        Ok(())
    }

    /// Starts an entry, after finishing the one before it.
    pub fn header(&mut self, file: &File<'_>) -> Result<()> {
        self.finish_entry()?;

        let given = slice_to_nul(file.path);
        let converted;
        let (path, binary) = match self.names {
            Names::Binary => (given, !given.is_ascii()),
            Names::Utf8 => match crate::compose::windows_name(given)? {
                Some(name) => {
                    converted = name;
                    (&converted[..], false)
                }
                None => (given, true),
            },
        };

        let mut pax: Vec<u8> = Vec::new();
        if binary {
            add_record(&mut pax, b"hdrcharset", b"BINARY")?;
        }
        let shortened;
        let mut name = path;
        if !path.is_ascii() || !fits_in_ustar(path) {
            add_record(&mut pax, b"path", path)?;
            shortened = ustar_entry_name(path, None);
            name = &shortened;
        }
        let mtime_fits = (0..USTAR_MTIME_MAX).contains(&file.mtime);
        if !mtime_fits {
            add_record(
                &mut pax,
                b"mtime",
                itoa::Buffer::new().format(file.mtime).as_bytes(),
            )?;
        }
        if file.size >= USTAR_SIZE_END {
            let size = i64::try_from(file.size).unwrap_or(i64::MAX);
            add_record(
                &mut pax,
                b"size",
                itoa::Buffer::new().format(size).as_bytes(),
            )?;
        }

        if !pax.is_empty() {
            let block = format_header(&Fields {
                name: &pax_attribute_name(name),
                perm: file.perm & 0o777,
                size: pax.len() as u64,
                mtime: file.mtime.clamp(0, USTAR_MTIME_MAX),
                typeflag: b'x',
                strict: true,
            });
            self.put(&block)?;
            self.put(&pax)?;
            self.put_zeros(padding_for(pax.len() as u64))?;
        }

        let block = format_header(&Fields {
            name,
            perm: file.perm,
            size: file.size,
            mtime: file.mtime,
            typeflag: b'0',
            strict: false,
        });
        self.put(&block)?;
        self.remaining = file.size;
        self.padding = padding_for(file.size);
        Ok(())
    }

    /// Returns how much was taken. What goes past the size in the header is dropped.
    pub fn data(&mut self, bytes: &[u8]) -> Result<usize> {
        let take = usize::try_from(self.remaining)
            .unwrap_or(usize::MAX)
            .min(bytes.len());
        if take > 0 {
            self.put(bytes.get(..take).unwrap_or_default())?;
            self.remaining = self.remaining.saturating_sub(take as u64);
        }
        Ok(take)
    }

    /// Data that was announced and never written is made up with zeros.
    fn finish_entry(&mut self) -> Result<()> {
        let zeros = self.remaining.saturating_add(self.padding);
        self.remaining = 0;
        self.padding = 0;
        self.put_zeros(zeros)
    }

    /// `pad_to_record` fills the last 10 KiB record up, the way tar writes to a tape.
    pub fn finish(mut self, pad_to_record: bool) -> Result<O> {
        self.finish_entry()?;
        self.put_zeros(2 * BLOCK_SIZE as u64)?;
        if pad_to_record {
            let over = self.written % RECORD_SIZE;
            if over != 0 {
                self.put_zeros(RECORD_SIZE.saturating_sub(over))?;
            }
        }
        Ok(self.out)
    }
}

/// `<length> <key>=<value>\n`, where the length counts its own digits too.
fn add_record(pax: &mut Vec<u8>, key: &[u8], value: &[u8]) -> Result<()> {
    let without_length = key.len().saturating_add(value.len()).saturating_add(3);
    let mut digits = 0usize;
    let mut next_ten = 1usize;
    let mut left = without_length;
    while left > 0 {
        left /= 10;
        digits = digits.saturating_add(1);
        next_ten = next_ten.saturating_mul(10);
    }
    if without_length.saturating_add(digits) >= next_ten {
        digits = digits.saturating_add(1);
    }
    let length = without_length.saturating_add(digits);
    pax.try_reserve(length)?;
    pax.extend_from_slice(itoa::Buffer::new().format(length).as_bytes());
    pax.push(b' ');
    pax.extend_from_slice(key);
    pax.push(b'=');
    pax.extend_from_slice(value);
    pax.push(b'\n');
    Ok(())
}

fn find_slash(path: &[u8], from: usize) -> Option<usize> {
    let tail = path.get(from..)?;
    Some(from.saturating_add(strings::index_of_char_usize(tail, b'/')?))
}

/// The first `/` that leaves a name of at most 100 bytes behind a prefix that is not empty.
fn split_point(path: &[u8]) -> Option<usize> {
    let mut at = find_slash(path, path.len().saturating_sub(NAME.len() + 1))?;
    if at == 0 {
        at = find_slash(path, 1)?;
    }
    (at.saturating_add(1) < path.len() && at <= PREFIX.len()).then_some(at)
}

fn fits_in_ustar(path: &[u8]) -> bool {
    path.len() <= NAME.len() || split_point(path).is_some()
}

fn byte_at(path: &[u8], index: usize) -> u8 {
    path.get(index).copied().unwrap_or(0)
}

/// A stand-in for readers that do not know pax. `insert` becomes the last directory.
fn ustar_entry_name(src: &[u8], insert: Option<&[u8]>) -> Vec<u8> {
    let insert_length = insert.map_or(0, |name| name.len().saturating_add(2));
    if src.len() < NAME.len() && insert.is_none() {
        return src.to_vec();
    }

    let mut need_slash = false;
    let mut filename_end = src.len();
    loop {
        if filename_end > 0 && byte_at(src, filename_end.wrapping_sub(1)) == b'/' {
            filename_end = filename_end.saturating_sub(1);
        } else if filename_end > 1
            && byte_at(src, filename_end.wrapping_sub(1)) == b'.'
            && byte_at(src, filename_end.wrapping_sub(2)) == b'/'
        {
            filename_end = filename_end.saturating_sub(2);
        } else {
            break;
        }
        need_slash = true;
    }
    let mut dest = Vec::new();
    if filename_end == 0 {
        dest.extend_from_slice(insert.unwrap_or_default());
        dest.push(b'/');
        return dest;
    }

    let mut suffix_length = NAME.len() - 2 - usize::from(need_slash);
    let mut filename = filename_end.saturating_sub(1);
    while filename > 0 && byte_at(src, filename) != b'/' {
        filename = filename.saturating_sub(1);
    }
    if byte_at(src, filename) == b'/' && filename < filename_end.saturating_sub(1) {
        filename = filename.saturating_add(1);
    }
    suffix_length = suffix_length.saturating_sub(insert_length);
    filename_end = filename_end.min(filename.saturating_add(suffix_length));
    suffix_length = suffix_length.saturating_sub(filename_end.saturating_sub(filename));

    // Backs up to a `/`, and then takes it along.
    let directory_end = |start: usize, limit: usize| {
        let mut end = limit.min(filename).max(start);
        while end > start && byte_at(src, end) != b'/' {
            end = end.saturating_sub(1);
        }
        if end < filename && byte_at(src, end) == b'/' {
            end = end.saturating_add(1);
        }
        end
    };
    let prefix_end = directory_end(0, PREFIX.len() - 1);
    let suffix_end = directory_end(prefix_end, prefix_end.saturating_add(suffix_length));

    dest.extend_from_slice(src.get(..suffix_end).unwrap_or_default());
    if let Some(insert) = insert {
        dest.extend_from_slice(insert);
        dest.push(b'/');
    }
    dest.extend_from_slice(src.get(filename..filename_end).unwrap_or_default());
    if need_slash {
        dest.push(b'/');
    }
    dest
}

/// The name of the pax header's own entry: `dir/PaxHeader/file` for `dir/file`.
fn pax_attribute_name(src: &[u8]) -> Vec<u8> {
    if src.is_empty() {
        return b"PaxHeader/blank".to_vec();
    }
    let mut end = src.len();
    loop {
        let slash = end > 0 && byte_at(src, end.wrapping_sub(1)) == b'/';
        let slash_dot = end > 1
            && byte_at(src, end.wrapping_sub(1)) == b'.'
            && byte_at(src, end.wrapping_sub(2)) == b'/';
        if !slash && !slash_dot {
            break;
        }
        end = end.saturating_sub(1);
    }
    if end == 0 {
        return b"/PaxHeader/rootdir".to_vec();
    }
    if end == 1 && src.first() == Some(&b'.') {
        return b"PaxHeader/currentdir".to_vec();
    }
    ustar_entry_name(src.get(..end).unwrap_or_default(), Some(b"PaxHeader"))
}

struct Fields<'a> {
    name: &'a [u8],
    perm: u32,
    size: u64,
    mtime: i64,
    typeflag: u8,
    /// Keep every number in octal with its terminator, whatever it takes.
    strict: bool,
}

fn copy_into(block: &mut Block, at: usize, bytes: &[u8]) {
    if let Some(dest) = block.get_mut(at..at.saturating_add(bytes.len())) {
        dest.copy_from_slice(bytes);
    }
}

/// A value too large for the field fills it with sevens.
fn format_octal(mut value: i64, field: &mut [u8]) {
    if value < 0 {
        field.fill(b'0');
        return;
    }
    for slot in field.iter_mut().rev() {
        *slot = b'0'.wrapping_add((value & 7) as u8);
        value >>= 3;
    }
    if value != 0 {
        field.fill(b'7');
    }
}

/// A number too long for `digits` overwrites the terminator. Base-256 takes what still won't fit.
fn format_number(value: i64, field: &mut [u8], digits: usize, strict: bool) {
    if strict {
        return format_octal(value, field.get_mut(..digits).unwrap_or_default());
    }
    if value >= 0 {
        for width in digits..=field.len() {
            if width >= MAX_OCTAL_DIGITS || value < 1i64 << width.saturating_mul(3) {
                return format_octal(value, field.get_mut(..width).unwrap_or_default());
            }
        }
    }
    let mut left = value;
    for slot in field.iter_mut().rev() {
        *slot = (left & 0xff) as u8;
        left >>= 8;
    }
    if let Some(first) = field.first_mut() {
        *first |= 0x80;
    }
}

fn format_header(fields: &Fields<'_>) -> Block {
    let mut h: Block = [0; BLOCK_SIZE];
    for field in [MODE, UID, GID, DEVMAJOR, DEVMINOR] {
        copy_into(&mut h, field.start, b"000000 ");
    }
    copy_into(&mut h, SIZE.start, b"00000000000 ");
    copy_into(&mut h, MTIME.start, b"00000000000 ");
    h[CHECKSUM].fill(b' ');
    h[MAGIC].copy_from_slice(USTAR_MAGIC);

    if fields.name.len() <= NAME.len() {
        copy_into(&mut h, NAME.start, fields.name);
    } else if let Some(at) = split_point(fields.name) {
        copy_into(
            &mut h,
            PREFIX.start,
            fields.name.get(..at).unwrap_or_default(),
        );
        copy_into(
            &mut h,
            NAME.start,
            fields.name.get(at.saturating_add(1)..).unwrap_or_default(),
        );
    }
    format_number(
        i64::from(fields.perm & 0o7777),
        &mut h[MODE],
        MODE_DIGITS,
        fields.strict,
    );
    format_number(
        i64::try_from(fields.size).unwrap_or(i64::MAX),
        &mut h[SIZE],
        SIZE_DIGITS,
        fields.strict,
    );
    format_number(
        fields.mtime,
        &mut h[MTIME.start..MTIME.start + MTIME_DIGITS],
        MTIME_DIGITS,
        fields.strict,
    );
    h[TYPEFLAG] = fields.typeflag;

    let checksum: u32 = h.iter().map(|&b| u32::from(b)).sum();
    h[CHECKSUM_DIGITS.end] = 0;
    format_octal(i64::from(checksum), &mut h[CHECKSUM_DIGITS]);
    h
}
