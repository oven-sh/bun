//! Writes "restricted pax": plain ustar, with a pax header in front of the entries whose name
//! ustar cannot hold. Only regular files, which is all Bun archives.

use crate::error::{Error, Result};
use crate::header::Block;
use bun_core::strings;

/// Where the bytes go. The size of each write is part of the contract: behind a compressor it
/// decides what the compressed bytes are.
pub trait Output {
    fn write(&mut self, bytes: &[u8]) -> Result<()>;
}

impl Output for Vec<u8> {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.try_reserve(bytes.len())
            .map_err(|_| Error::OutOfMemory)?;
        self.extend_from_slice(bytes);
        Ok(())
    }
}

impl<F: FnMut(&[u8])> Output for F {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self(bytes);
        Ok(())
    }
}

/// How a name that is not ASCII is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Names {
    /// POSIX: the bytes as they are, marked `hdrcharset=BINARY`.
    Binary,
    /// Windows: UTF-8 with its characters composed, and `\` turned into `/`.
    Utf8,
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
/// The last time that fits in eleven octal digits. It is written through a pax record all the
/// same.
const USTAR_MTIME_MAX: i64 = (1 << 33) - 1;
const USTAR_SIZE_END: u64 = 1 << 33;
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

        let given = match strings::index_of_char_usize(file.path, 0) {
            Some(end) => file.path.get(..end).unwrap_or_default(),
            None => file.path,
        };
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
            let mut digits = itoa_buffer();
            add_record(&mut pax, b"mtime", format_int(&mut digits, file.mtime))?;
        }
        if file.size >= USTAR_SIZE_END {
            let mut digits = itoa_buffer();
            let size = i64::try_from(file.size).unwrap_or(i64::MAX);
            add_record(&mut pax, b"size", format_int(&mut digits, size))?;
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
    pub fn finish_entry(&mut self) -> Result<()> {
        let zeros = self.remaining.saturating_add(self.padding);
        self.remaining = 0;
        self.padding = 0;
        self.put_zeros(zeros)
    }

    /// Ends the archive. `pad_to_record` fills the last 10 KiB record up, the way tar writes to a
    /// tape.
    pub fn finish(mut self, pad_to_record: bool) -> Result<O> {
        self.finish_entry()?;
        self.put_zeros(1024)?;
        if pad_to_record {
            let over = self.written % RECORD_SIZE;
            if over != 0 {
                self.put_zeros(RECORD_SIZE.saturating_sub(over))?;
            }
        }
        Ok(self.out)
    }
}

fn padding_for(size: u64) -> u64 {
    0x1ff & size.wrapping_neg()
}

fn itoa_buffer() -> [u8; 20] {
    [0; 20]
}

fn format_int(buffer: &mut [u8; 20], value: i64) -> &[u8] {
    let mut at = buffer.len();
    let mut left = value.unsigned_abs();
    loop {
        at = at.saturating_sub(1);
        if let Some(slot) = buffer.get_mut(at) {
            *slot = b'0'.wrapping_add((left % 10) as u8);
        }
        left /= 10;
        if left == 0 {
            break;
        }
    }
    if value < 0 {
        at = at.saturating_sub(1);
        if let Some(slot) = buffer.get_mut(at) {
            *slot = b'-';
        }
    }
    buffer.get(at..).unwrap_or_default()
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
    pax.try_reserve(length).map_err(|_| Error::OutOfMemory)?;
    let mut buffer = itoa_buffer();
    pax.extend_from_slice(format_int(
        &mut buffer,
        i64::try_from(length).unwrap_or(i64::MAX),
    ));
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

/// Where to cut a name longer than 100 bytes into `prefix` and `name`: at the first `/` that
/// leaves a name of at most 100. The prefix may not be empty.
fn split_point(path: &[u8]) -> Option<usize> {
    let mut at = find_slash(path, path.len().saturating_sub(101))?;
    if at == 0 {
        at = find_slash(path, 1)?;
    }
    (at.saturating_add(1) < path.len() && at <= 155).then_some(at)
}

fn fits_in_ustar(path: &[u8]) -> bool {
    path.len() <= 100 || split_point(path).is_some()
}

fn byte_at(path: &[u8], index: usize) -> u8 {
    path.get(index).copied().unwrap_or(0)
}

/// A stand-in for a name ustar cannot hold, for readers that do not know pax. It keeps as many
/// of the leading directories as fit and the start of the file name. `insert` goes in as one more
/// directory in front of the file name.
fn ustar_entry_name(src: &[u8], insert: Option<&[u8]>) -> Vec<u8> {
    let insert_length = insert.map_or(0, |name| name.len().saturating_add(2));
    if src.len() < 100 && insert.is_none() {
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

    let mut suffix_length = if need_slash { 97usize } else { 98 };
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
    let prefix_end = directory_end(0, 154);
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

/// `digits` is the field without its terminator and `field` all of it. A number that needs the
/// room overwrites the terminator, and base-256 takes whatever still does not fit.
fn format_number(value: i64, field: &mut [u8], digits: usize, strict: bool) {
    if strict {
        return format_octal(value, field.get_mut(..digits).unwrap_or_default());
    }
    if value >= 0 {
        for width in digits..=field.len() {
            if width >= 21 || value < 1i64 << width.saturating_mul(3) {
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
    let mut h: Block = [0; 512];
    for (at, digits) in [(100, 6), (108, 6), (116, 6), (329, 6), (337, 6)] {
        copy_into(&mut h, at, b"000000 ".get(..digits + 1).unwrap_or_default());
    }
    copy_into(&mut h, 124, b"00000000000 ");
    copy_into(&mut h, 136, b"00000000000 ");
    copy_into(&mut h, 148, b"        ");
    copy_into(&mut h, 257, b"ustar\x0000");

    if fields.name.len() <= 100 {
        copy_into(&mut h, 0, fields.name);
    } else if let Some(at) = split_point(fields.name) {
        copy_into(&mut h, 345, fields.name.get(..at).unwrap_or_default());
        copy_into(
            &mut h,
            0,
            fields.name.get(at.saturating_add(1)..).unwrap_or_default(),
        );
    }
    format_number(
        i64::from(fields.perm & 0o7777),
        &mut h[100..108],
        6,
        fields.strict,
    );
    format_number(
        i64::try_from(fields.size).unwrap_or(i64::MAX),
        &mut h[124..136],
        11,
        fields.strict,
    );
    format_number(fields.mtime, &mut h[136..147], 11, fields.strict);
    h[156] = fields.typeflag;

    let checksum: u32 = h.iter().map(|&b| u32::from(b)).sum();
    h[154] = 0;
    format_octal(i64::from(checksum), &mut h[148..154]);
    h
}
