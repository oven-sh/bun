use crate::error::{Error, Result};
use crate::header::{self, BLOCK_SIZE, Block, gnu};
use crate::num::{parse_decimal, parse_field, parse_pax_time};
use crate::output::Output as _;
use bun_core::{FileKind, S, kind_from_mode, slice_to_nul, strings};
use std::borrow::Cow;

/// Whose answer to give where tar readers disagree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    /// Zero blocks never end the archive, so archives that were concatenated read as one.
    General,
    /// What npm's own tar reader does with a package.
    Npm,
}

/// Which pax strings convert. An entry with one that does not has its headers trusted less.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Charset {
    /// POSIX in the "C" locale: only ASCII converts.
    Ascii,
    /// Windows, where names become UTF-16: valid UTF-8 converts.
    Utf8,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub dialect: Dialect,
    pub charset: Charset,
    /// macOS: an entry named `._name` is the AppleDouble metadata of the entry behind it, and dropped.
    pub mac_metadata: bool,
}

impl Options {
    /// What the platform this was compiled for has always done.
    pub fn for_host(dialect: Dialect) -> Self {
        Self {
            dialect,
            charset: if cfg!(windows) {
                Charset::Utf8
            } else {
                Charset::Ascii
            },
            mac_metadata: cfg!(target_os = "macos"),
        }
    }
}

#[derive(Debug, Default)]
pub struct Entry {
    path: Vec<u8>,
    path_is_utf8: bool,
    link: Vec<u8>,
    is_symlink: bool,
    mode: u32,
    size: i64,
    mtime: Option<i64>,
}

impl Entry {
    /// Never holds a NUL.
    pub fn path(&self) -> &[u8] {
        &self.path
    }
    /// The path is a pax record that [`Charset`] could convert. Otherwise its encoding is unknown.
    pub fn path_is_utf8(&self) -> bool {
        self.path_is_utf8
    }
    pub fn symlink(&self) -> Option<&[u8]> {
        self.is_symlink.then_some(&self.link[..])
    }
    /// One of `S::IF*`, or what the mode field held for the few types that say nothing about it.
    pub fn filetype(&self) -> u32 {
        self.mode & S::IFMT
    }
    pub fn kind(&self) -> FileKind {
        kind_from_mode(self.filetype())
    }
    /// Not masked to the permission bits: a base-256 mode field can hold more.
    pub fn perm(&self) -> u32 {
        self.mode & !S::IFMT
    }
    /// The length of the file on disk, which for a sparse entry is more than the archive stores.
    pub fn size(&self) -> i64 {
        self.size
    }
    pub fn mtime(&self) -> i64 {
        self.mtime.unwrap_or(0)
    }
}

#[derive(Debug)]
pub enum Event<'a> {
    /// Everything given was consumed. Call again with more, or with `eof` set.
    NeedInput,
    Entry(&'a Entry),
    /// `offset` only jumps for a sparse entry.
    Data {
        offset: i64,
        bytes: &'a [u8],
    },
    /// `size` is the length of the file, which may lie past the last `Data`.
    EndOfEntry {
        size: i64,
    },
    EndOfArchive,
}

/// Ordered so that the worse of two is the smaller one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Status {
    /// Becomes an error once the entry's own header has been read.
    Failed,
    Warn,
    Ok,
}

impl Status {
    fn warn_unless(ok: bool) -> Self {
        if ok { Self::Ok } else { Self::Warn }
    }
}

/// Sticks across entries. It decides whether the size of a hardlink entry is believed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Old,
    Ustar,
    Pax,
    Gnu,
}

#[derive(Debug, Clone, Copy)]
struct SparseBlock {
    offset: i64,
    remaining: i64,
    hole: bool,
}

mod seen {
    pub(super) const SOLARIS_ACL: u32 = 1;
    pub(super) const PAX_GLOBAL: u32 = 2;
    pub(super) const LONG_LINK: u32 = 4;
    pub(super) const LONG_NAME: u32 = 8;
    pub(super) const VOLUME: u32 = 16;
    pub(super) const PAX: u32 = 32;
    pub(super) const MAC_METADATA: u32 = 512;
}

mod size_field {
    pub(super) const GNU_SPARSE_REALSIZE: u8 = 1;
    pub(super) const GNU_SPARSE_SIZE: u8 = 2;
    pub(super) const SCHILY_REALSIZE: u8 = 4;
    pub(super) const PAX_SIZE: u8 = 8;
}

// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_read_support_format_tar.c#L247
const PATHNAME_LIMIT: i64 = 1024 * 1024;
const USER_NAME_LIMIT: i64 = 65536;
const SPARSE_MAP_LIMIT: i64 = 8 * 1024 * 1024;
const XATTR_LIMIT: i64 = 16 * 1024 * 1024;
const FFLAGS_LIMIT: i64 = 512;
const ENTRY_LIMIT: i64 = 0x0fff_ffff_ffff_ffff;
const PAX_BODY_LIMIT: i64 = 1024 * 1024 * 1024;
const PAX_LINE_LIMIT: i64 = 99_999_999;
const NUMBER_LIMIT: i64 = 64;
const TIME_LIMIT: i64 = 128;
const SYMLINK_TYPE_LIMIT: i64 = 16;
const CHARSET_LIMIT: i64 = 64;
const XATTR_NAME_LIMIT: usize = 128;
const SPARSE_VERSION_LIMIT: i64 = 10;
const SPARSE_MAP_LINE_LIMIT: usize = 100;
const LIBARCHIVE_XATTR: &[u8] = b"LIBARCHIVE.xattr.";
const SCHILY_XATTR: &[u8] = b"SCHILY.xattr.";
/// Longer than every key that is matched in full.
const KEY_CAPACITY: usize = 32;

fn padding_for(size: i64) -> i64 {
    header::padding_for(size.cast_unsigned()).cast_signed()
}

fn assign(dest: &mut Vec<u8>, bytes: &[u8]) -> Result<()> {
    dest.clear();
    dest.write(bytes)
}

#[derive(Debug, Clone, Copy)]
enum AfterSkip {
    /// The body of a header that says something about the entry behind it.
    BetweenHeaders(Status),
    PaxNewline(Status),
    MacMetadata,
    SparseMap,
    EndOfEntry,
    NextEntry,
}

#[derive(Debug, Clone, Copy)]
enum Number {
    SparseOffset,
    SparseNumBytes,
    SparseSize,
    SparseMajor,
    SparseMinor,
    SparseRealSize,
    SchilyRealSize,
    Size,
    /// Only whether it parses matters.
    Unused,
}

#[derive(Debug, Clone, Copy)]
enum Text {
    Path,
    PathOverride,
    LinkPath,
    UserName,
    GroupName,
}

#[derive(Debug, Clone, Copy)]
enum Collect {
    LongName,
    LongLink,
    Number(Number),
    /// `true` for `mtime`. Of the others only whether they parse matters.
    Time(bool),
    Text(Text),
    HeaderCharset,
    SymlinkType,
    SparseMap,
    HolesData,
}

#[derive(Debug, Clone, Copy)]
enum SparseMapField {
    Count,
    Offset,
    Size,
}

#[derive(Debug, Clone, Copy)]
enum State {
    NextEntry,
    Header,
    Skip(i64, AfterSkip),
    Collect(usize, Collect),
    PaxLength,
    PaxKey,
    PaxNewline(Status),
    OldSparseExtension,
    SparseMapLine(SparseMapField),
    Emit,
    Data,
    /// Behind the end of an npm archive, which is still read to its end so that all of it is checked.
    Drain,
    Done,
    Failed(Error),
}

enum Step {
    Continue,
    NeedInput,
    Entry,
    Data { offset: i64, len: usize },
    EndOfEntry,
    EndOfArchive,
}

/// [`Event`] without the borrows. `Data` is `input[start..start + len]`.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Poll {
    NeedInput,
    Entry,
    Data {
        offset: i64,
        start: usize,
        len: usize,
    },
    EndOfEntry {
        size: i64,
    },
    EndOfArchive,
}

impl Poll {
    pub(crate) fn event<'a>(self, entry: &'a Entry, input: &'a [u8]) -> Event<'a> {
        match self {
            Poll::NeedInput => Event::NeedInput,
            Poll::Entry => Event::Entry(entry),
            Poll::Data { offset, start, len } => Event::Data {
                offset,
                bytes: input
                    .get(start..start.saturating_add(len))
                    .unwrap_or_default(),
            },
            Poll::EndOfEntry { size } => Event::EndOfEntry { size },
            Poll::EndOfArchive => Event::EndOfArchive,
        }
    }
}

pub struct Reader {
    options: Options,
    state: State,

    block: Block,
    block_len: usize,
    /// The entry's own header, kept while the sparse extension blocks behind it are read.
    main_header: Block,
    collected: Vec<u8>,

    // One sequence of headers, which ends with the entry's own.
    status: Status,
    eof_is_fatal: bool,
    seen: u32,
    pax_is_utf8: bool,
    sparse_attributes_seen: bool,
    pax_path: Vec<u8>,
    pax_path_override: Vec<u8>,
    pax_link: Vec<u8>,
    user_name_converts: bool,
    group_name_converts: bool,

    // One pax header.
    pax_status: Status,
    pax_left: i64,
    pax_padding: i64,
    pax_line_length: i64,
    pax_line_pos: i64,
    pax_key: [u8; KEY_CAPACITY],
    /// Up to the first NUL, and possibly more than `pax_key` holds.
    pax_key_len: usize,
    pax_key_ended: bool,
    pax_key_started: bool,

    // One entry.
    entry: Entry,
    size_fields: u8,
    sparse: Vec<SparseBlock>,
    sparse_head: usize,
    sparse_map_left: i64,
    sparse_map_entries: i64,
    sparse_map_offset: i64,
    line: [u8; SPARSE_MAP_LINE_LIMIT],
    line_len: usize,

    // Never reset, so a header that leaves one out inherits it from an earlier entry.
    format: Format,
    typeflag: u8,
    sparse_major: i64,
    sparse_minor: i64,
    sparse_offset: i64,
    sparse_num_bytes: i64,
    gnu_sparse_size: i64,
    gnu_sparse_real_size: i64,
    schily_real_size: i64,
    pax_size: i64,
    disk_size: i64,
    bytes_remaining: i64,
    /// How much of the current `State::Skip` is behind us.
    skipped: i64,
    padding: i64,
    null_blocks: u32,
}

impl Reader {
    pub fn new(options: Options) -> Self {
        Self {
            options,
            state: State::NextEntry,
            block: [0; BLOCK_SIZE],
            block_len: 0,
            main_header: [0; BLOCK_SIZE],
            collected: Vec::new(),
            status: Status::Ok,
            eof_is_fatal: false,
            seen: 0,
            pax_is_utf8: true,
            sparse_attributes_seen: false,
            pax_path: Vec::new(),
            pax_path_override: Vec::new(),
            pax_link: Vec::new(),
            user_name_converts: true,
            group_name_converts: true,
            pax_status: Status::Ok,
            pax_left: 0,
            pax_padding: 0,
            pax_line_length: 0,
            pax_line_pos: 0,
            pax_key: [0; KEY_CAPACITY],
            pax_key_len: 0,
            pax_key_ended: false,
            pax_key_started: false,
            entry: Entry::default(),
            size_fields: 0,
            sparse: Vec::new(),
            sparse_head: 0,
            sparse_map_left: 0,
            sparse_map_entries: 0,
            sparse_map_offset: 0,
            line: [0; SPARSE_MAP_LINE_LIMIT],
            line_len: 0,
            format: Format::Old,
            typeflag: 0,
            sparse_major: 0,
            sparse_minor: 0,
            sparse_offset: 0,
            sparse_num_bytes: 0,
            gnu_sparse_size: 0,
            gnu_sparse_real_size: 0,
            schily_real_size: 0,
            pax_size: 0,
            disk_size: 0,
            bytes_remaining: 0,
            skipped: 0,
            padding: 0,
            null_blocks: 0,
        }
    }

    fn is_npm(&self) -> bool {
        self.options.dialect == Dialect::Npm
    }

    /// Returns how much of `input` was consumed. `eof`: nothing follows it. An error is final.
    pub fn next<'a>(&'a mut self, input: &'a [u8], eof: bool) -> Result<(usize, Event<'a>)> {
        let (used, poll) = self.poll(input, eof)?;
        Ok((used, poll.event(&self.entry, input)))
    }

    /// The entry of the last [`Event::Entry`].
    pub fn entry(&self) -> &Entry {
        &self.entry
    }

    /// Refuses input that does not start like tar, given its first block if there is that much.
    pub(crate) fn detect(&mut self, start: &[u8]) -> Result<usize> {
        let mut used = 0usize;
        if self.fill_block(start, &mut used).is_none()
            || !(header::is_null(&self.block) || header::is_plausible(&self.block))
        {
            self.state = State::Failed(Error::UnrecognizedFormat);
            return Err(Error::UnrecognizedFormat);
        }
        // `block` stays full, so `Header` takes it from here.
        Ok(used)
    }

    pub(crate) fn poll(&mut self, input: &[u8], eof: bool) -> Result<(usize, Poll)> {
        let mut pos = 0usize;
        loop {
            let rest = input.get(pos..).unwrap_or_default();
            let mut used = 0usize;
            let step = match self.step(rest, eof, &mut used) {
                Ok(step) => step,
                Err(error) => {
                    self.state = State::Failed(error);
                    return Err(error);
                }
            };
            let start = pos;
            pos = pos.saturating_add(used);
            let poll = match step {
                Step::Continue => continue,
                Step::NeedInput => Poll::NeedInput,
                Step::Entry => Poll::Entry,
                Step::Data { offset, len } => Poll::Data { offset, start, len },
                Step::EndOfEntry => Poll::EndOfEntry {
                    size: self.disk_size,
                },
                Step::EndOfArchive => Poll::EndOfArchive,
            };
            return Ok((pos, poll));
        }
    }

    /// Drops what is left of the current entry's data. No `EndOfEntry` follows.
    pub fn skip_entry(&mut self) {
        if matches!(self.state, State::Data) {
            self.state = State::NextEntry;
        }
    }

    /// `None` when `input` ran out first.
    fn fill_block(&mut self, input: &[u8], used: &mut usize) -> Option<()> {
        let want = self.block.len().saturating_sub(self.block_len);
        let take = want.min(input.len());
        if let (Some(dest), Some(src)) = (
            self.block
                .get_mut(self.block_len..self.block_len.saturating_add(take)),
            input.get(..take),
        ) {
            dest.copy_from_slice(src);
        }
        self.block_len = self.block_len.saturating_add(take);
        *used = take;
        (self.block_len == self.block.len()).then_some(())
    }

    /// Like `fill_block`, but a block that `input` holds all of is not copied.
    fn take_block<'a>(&mut self, input: &'a [u8], used: &mut usize) -> Option<Cow<'a, Block>> {
        if self.block_len == 0
            && let Some(block) = input.first_chunk()
        {
            *used = block.len();
            return Some(Cow::Borrowed(block));
        }
        self.fill_block(input, used)?;
        self.block_len = 0;
        Some(Cow::Owned(self.block))
    }

    fn step(&mut self, input: &[u8], eof: bool, used: &mut usize) -> Result<Step> {
        match self.state {
            State::Failed(error) => Err(error),
            State::Done => Ok(Step::EndOfArchive),

            State::NextEntry => {
                let left = self.bytes_remaining.saturating_add(self.padding);
                self.bytes_remaining = 0;
                self.padding = 0;
                self.state = State::Skip(left, AfterSkip::NextEntry);
                Ok(Step::Continue)
            }

            State::Header => {
                let Some(block) = self.take_block(input, used) else {
                    if !eof {
                        return Ok(Step::NeedInput);
                    }
                    if self.block_len != 0 {
                        return Err(Error::TruncatedHeader);
                    }
                    if self.eof_is_fatal && !self.is_npm() {
                        return Err(Error::EndWithinHeaders);
                    }
                    self.state = State::Done;
                    return Ok(Step::EndOfArchive);
                };
                self.on_header(&block)?;
                Ok(Step::Continue)
            }

            State::Skip(left, after) => {
                let take = usize::try_from(left).unwrap_or(usize::MAX).min(input.len());
                *used = take;
                let taken = i64::try_from(take).unwrap_or(i64::MAX);
                let left = left.saturating_sub(taken);
                self.skipped = self.skipped.saturating_add(taken);
                if left > 0 {
                    self.state = State::Skip(left, after);
                    if !eof {
                        return Ok(Step::NeedInput);
                    }
                    return Err(match after {
                        AfterSkip::EndOfEntry | AfterSkip::NextEntry => Error::TruncatedSkip,
                        AfterSkip::MacMetadata => Error::TruncatedMacMetadata,
                        _ => Error::TruncatedInput {
                            needed: left.saturating_add(self.skipped),
                            available: self.skipped,
                        },
                    });
                }
                self.skipped = 0;
                self.after_skip(after)
            }

            State::Collect(left, what) => {
                let take = left.min(input.len());
                self.collected
                    .write(input.get(..take).unwrap_or_default())?;
                *used = take;
                let left = left.saturating_sub(take);
                if left > 0 {
                    self.state = State::Collect(left, what);
                    if !eof {
                        return Ok(Step::NeedInput);
                    }
                    return Err(Error::TruncatedMetadata);
                }
                self.on_collected(what)?;
                Ok(Step::Continue)
            }

            State::PaxLength => {
                for &c in input {
                    if self.pax_line_pos >= self.pax_left {
                        break;
                    }
                    *used = used.saturating_add(1);
                    self.pax_line_pos = self.pax_line_pos.saturating_add(1);
                    match c {
                        b' ' => {
                            if self.pax_line_length > self.pax_left {
                                self.ignore_rest_of_pax();
                            } else {
                                self.pax_key_len = 0;
                                self.pax_key_ended = false;
                                self.state = State::PaxKey;
                            }
                            return Ok(Step::Continue);
                        }
                        b'0'..=b'9' => {
                            self.pax_line_length = self
                                .pax_line_length
                                .saturating_mul(10)
                                .saturating_add(i64::from(c.wrapping_sub(b'0')));
                            if self.pax_line_length > PAX_LINE_LIMIT {
                                self.ignore_rest_of_pax();
                                return Ok(Step::Continue);
                            }
                        }
                        _ => {
                            self.ignore_rest_of_pax();
                            return Ok(Step::Continue);
                        }
                    }
                }
                self.pax_prologue_ran_out(eof)
            }

            State::PaxKey => {
                for &c in input {
                    if self.pax_line_pos >= self.pax_left
                        || self.pax_line_pos >= self.pax_line_length
                    {
                        break;
                    }
                    *used = used.saturating_add(1);
                    self.pax_line_pos = self.pax_line_pos.saturating_add(1);
                    if c != b'=' {
                        if c == 0 {
                            self.pax_key_ended = true;
                        }
                        if !self.pax_key_ended {
                            if let Some(slot) = self.pax_key.get_mut(self.pax_key_len) {
                                *slot = c;
                            }
                            self.pax_key_len = self.pax_key_len.saturating_add(1);
                        }
                        // A key that starts with a NUL is still a key.
                        self.pax_key_started = true;
                        continue;
                    }
                    if !self.pax_key_started {
                        self.ignore_rest_of_pax();
                        return Ok(Step::Continue);
                    }
                    self.on_pax_key()?;
                    return Ok(Step::Continue);
                }
                self.pax_prologue_ran_out(eof)
            }

            State::PaxNewline(status) => {
                self.pax_line_pos = 0;
                if status == Status::Failed {
                    self.skip_rest_of_pax(Status::Failed);
                    return Ok(Step::Continue);
                }
                let Some(&c) = input.first() else {
                    if !eof {
                        return Ok(Step::NeedInput);
                    }
                    return Err(Error::TruncatedMetadata);
                };
                self.pax_status = self.pax_status.min(status);
                if c != b'\n' {
                    self.ignore_rest_of_pax();
                    return Ok(Step::Continue);
                }
                *used = 1;
                self.pax_left = self.pax_left.saturating_sub(1);
                if self.pax_left > 0 {
                    self.begin_pax_line();
                } else {
                    self.finish_pax()?;
                }
                Ok(Step::Continue)
            }

            State::OldSparseExtension => {
                let Some(block) = self.take_block(input, used) else {
                    if !eof {
                        return Ok(Step::NeedInput);
                    }
                    return Err(Error::TruncatedSparse);
                };
                self.add_old_sparse_entries(gnu::extension_sparse(&block))?;
                if !gnu::extension_is_extended(&block) {
                    let h = self.main_header;
                    self.header_common(&h)?;
                }
                Ok(Step::Continue)
            }

            State::SparseMapLine(field) => {
                let limit = self.sparse_map_left.min(SPARSE_MAP_LINE_LIMIT as i64);
                let limit = usize::try_from(limit).unwrap_or(0);
                for &c in input {
                    *used = used.saturating_add(1);
                    if self.line_len >= limit {
                        return Err(Error::LineTooLong);
                    }
                    if let Some(slot) = self.line.get_mut(self.line_len) {
                        *slot = c;
                    }
                    self.line_len = self.line_len.saturating_add(1);
                    if c == b'\n' {
                        self.on_sparse_map_line(field)?;
                        return Ok(Step::Continue);
                    }
                }
                if !eof {
                    return Ok(Step::NeedInput);
                }
                Err(Error::MalformedSparseMap)
            }

            State::Emit => {
                self.state = State::Data;
                Ok(Step::Entry)
            }

            State::Data => {
                while self
                    .sparse
                    .get(self.sparse_head)
                    .is_some_and(|block| block.remaining == 0)
                {
                    self.sparse_head = self.sparse_head.saturating_add(1);
                }
                let Some(block) = self
                    .sparse
                    .get_mut(self.sparse_head)
                    .filter(|_| self.bytes_remaining != 0)
                else {
                    let left = self.bytes_remaining.saturating_add(self.padding);
                    self.bytes_remaining = 0;
                    self.padding = 0;
                    self.state = State::Skip(left, AfterSkip::EndOfEntry);
                    return Ok(Step::Continue);
                };
                if input.is_empty() {
                    if !eof {
                        return Ok(Step::NeedInput);
                    }
                    return Err(Error::TruncatedData);
                }
                let len = i64::try_from(input.len())
                    .unwrap_or(i64::MAX)
                    .min(self.bytes_remaining)
                    .min(block.remaining);
                let offset = block.offset;
                block.remaining = block.remaining.saturating_sub(len);
                block.offset = block.offset.saturating_add(len);
                self.bytes_remaining = self.bytes_remaining.saturating_sub(len);
                let len = usize::try_from(len).unwrap_or(0);
                *used = len;
                if block.hole {
                    return Ok(Step::Continue);
                }
                Ok(Step::Data { offset, len })
            }

            State::Drain => {
                *used = input.len();
                if !eof {
                    return Ok(Step::NeedInput);
                }
                self.state = State::Done;
                Ok(Step::EndOfArchive)
            }
        }
    }

    fn after_skip(&mut self, after: AfterSkip) -> Result<Step> {
        match after {
            AfterSkip::BetweenHeaders(status) => self.between_headers(status),
            AfterSkip::PaxNewline(status) => self.state = State::PaxNewline(status),
            AfterSkip::MacMetadata => {
                self.entry.clear();
                self.seen = seen::MAC_METADATA;
                self.reset_header_state();
                self.between_headers(Status::Ok);
            }
            AfterSkip::SparseMap => self.finish_header(self.status)?,
            AfterSkip::EndOfEntry => {
                self.state = State::NextEntry;
                return Ok(Step::EndOfEntry);
            }
            AfterSkip::NextEntry => {
                self.entry.clear();
                self.sparse.clear();
                self.sparse_head = 0;
                self.size_fields = 0;
                self.status = Status::Ok;
                self.eof_is_fatal = false;
                self.seen = 0;
                self.reset_header_state();
                self.state = State::Header;
            }
        }
        Ok(Step::Continue)
    }

    fn reset_header_state(&mut self) {
        self.pax_is_utf8 = true;
        self.sparse_attributes_seen = false;
        self.pax_path.clear();
        self.pax_path_override.clear();
        self.pax_link.clear();
        self.user_name_converts = true;
        self.group_name_converts = true;
    }

    fn between_headers(&mut self, status: Status) {
        self.status = self.status.min(status);
        if self.seen & !(seen::VOLUME | seen::PAX_GLOBAL) != 0 {
            self.eof_is_fatal = true;
        }
        self.state = State::Header;
    }

    fn mark_seen(&mut self, bit: u32) -> bool {
        let before = self.seen & bit != 0;
        self.seen |= bit;
        before
    }

    fn on_header(&mut self, block: &Block) -> Result<()> {
        if header::is_null(block) {
            if self.is_npm() {
                self.null_blocks = self.null_blocks.saturating_add(1);
                if self.null_blocks == 2 {
                    self.state = State::Drain;
                }
            }
            return Ok(());
        }
        self.null_blocks = 0;

        if !header::checksum_ok(block) {
            if self.eof_is_fatal {
                return Err(Error::BadChecksum);
            }
            // Look for a header one block further on, with nothing carried over.
            self.state = State::NextEntry;
            return Ok(());
        }

        let size = header::size(block);
        match header::typeflag(block) {
            b'A' => {
                if self.mark_seen(seen::SOLARIS_ACL) {
                    return Err(Error::RedundantHeader("A"));
                }
                self.format = Format::Pax;
                // A Solaris ACL. As in GNU tar and node-tar, permissions come from the header's mode alone.
                self.begin_body(size, None)
            }
            b'g' => {
                if self.mark_seen(seen::PAX_GLOBAL) {
                    return Err(Error::RedundantHeader("g"));
                }
                self.format = Format::Pax;
                if !(0..=ENTRY_LIMIT).contains(&size) {
                    return Err(Error::InvalidSpecialHeaderSize(size));
                }
                if size == 0 {
                    return Err(Error::EmptyPaxGlobalHeader);
                }
                self.skip_body(size, Status::Ok);
                Ok(())
            }
            b'K' => {
                if self.mark_seen(seen::LONG_LINK) {
                    self.status = self.status.min(Status::Warn);
                }
                self.format = Format::Gnu;
                self.begin_body(size, Some(Collect::LongLink))
            }
            b'L' => {
                if self.mark_seen(seen::LONG_NAME) {
                    self.status = self.status.min(Status::Warn);
                }
                self.format = Format::Gnu;
                self.begin_body(size, Some(Collect::LongName))
            }
            b'V' => {
                if self.mark_seen(seen::VOLUME) {
                    self.status = self.status.min(Status::Warn);
                }
                self.format = Format::Gnu;
                if !(0..=PATHNAME_LIMIT).contains(&size) {
                    return Err(Error::InvalidSpecialHeaderSize(size));
                }
                self.skip_body(size, Status::Ok);
                Ok(())
            }
            flag @ (b'x' | b'X') => {
                if self.mark_seen(seen::PAX) {
                    return Err(Error::RedundantHeader(if flag == b'x' {
                        "x"
                    } else {
                        "X'/'x"
                    }));
                }
                self.format = Format::Pax;
                self.begin_pax(size)
            }
            _ => self.on_main_header(block),
        }
    }

    fn skip_body(&mut self, size: i64, status: Status) {
        self.state = State::Skip(
            size.saturating_add(padding_for(size)),
            AfterSkip::BetweenHeaders(status),
        );
    }

    /// The body of a header whose size is not trusted past [`PATHNAME_LIMIT`].
    fn begin_body(&mut self, size: i64, collect: Option<Collect>) -> Result<()> {
        if !(0..=ENTRY_LIMIT).contains(&size) {
            return Err(Error::InvalidSpecialHeaderSize(size));
        }
        if size > PATHNAME_LIMIT {
            self.skip_body(size, Status::Warn);
            return Ok(());
        }
        let Some(collect) = collect else {
            self.skip_body(size, Status::Ok);
            return Ok(());
        };
        self.collected.clear();
        self.state = State::Collect(usize::try_from(size).unwrap_or(0), collect);
        Ok(())
    }

    fn begin_pax(&mut self, size: i64) -> Result<()> {
        if !(0..=ENTRY_LIMIT).contains(&size) {
            return Err(Error::InvalidPaxHeaderSize(size));
        }
        if size == 0 {
            return Err(Error::EmptyPaxHeader);
        }
        if size > PAX_BODY_LIMIT {
            self.skip_body(size, Status::Warn);
            return Ok(());
        }
        self.pax_status = Status::Ok;
        self.pax_left = size;
        self.pax_padding = padding_for(size);
        self.begin_pax_line();
        Ok(())
    }

    fn begin_pax_line(&mut self) {
        self.pax_line_length = 0;
        self.pax_line_pos = 0;
        self.pax_key_started = false;
        self.state = State::PaxLength;
    }

    /// One malformed record makes the rest of the header unreadable. What came before it counts.
    fn ignore_rest_of_pax(&mut self) {
        self.skip_rest_of_pax(Status::Warn);
    }

    fn skip_rest_of_pax(&mut self, status: Status) {
        let left = self
            .pax_left
            .saturating_sub(self.pax_line_pos)
            .saturating_add(self.pax_padding);
        self.state = State::Skip(left, AfterSkip::BetweenHeaders(status));
    }

    fn pax_prologue_ran_out(&mut self, eof: bool) -> Result<Step> {
        let at_end = self.pax_line_pos >= self.pax_left
            || (matches!(self.state, State::PaxKey) && self.pax_line_pos >= self.pax_line_length);
        if at_end {
            self.ignore_rest_of_pax();
            return Ok(Step::Continue);
        }
        if !eof {
            return Ok(Step::NeedInput);
        }
        Err(Error::TruncatedPaxName)
    }

    fn on_pax_key(&mut self) -> Result<()> {
        self.pax_left = self.pax_left.saturating_sub(self.pax_line_pos);
        let with_newline = self.pax_line_length.saturating_sub(self.pax_line_pos);
        self.pax_line_pos = 0;
        if with_newline == 0 {
            self.ignore_rest_of_pax();
            return Ok(());
        }
        let length = with_newline.saturating_sub(1);
        self.pax_left = self.pax_left.saturating_sub(length);

        enum Value {
            Skip(Status),
            Collect(Collect),
        }
        use Value::{Collect as Take, Skip};

        let number = |which: Number| -> Result<Value> {
            if length > NUMBER_LIMIT {
                return Err(Error::MalformedPaxAttribute);
            }
            Ok(Take(Collect::Number(which)))
        };
        let time = |is_mtime: bool| -> Result<Value> {
            if length > TIME_LIMIT {
                return Err(Error::MalformedPaxAttribute);
            }
            Ok(Take(Collect::Time(is_mtime)))
        };
        let warn_unless = |ok: bool| Skip(Status::warn_unless(ok));

        let stored = self.pax_key_len.min(KEY_CAPACITY);
        let key_buf = self.pax_key;
        let key = key_buf.get(..stored).unwrap_or_default();
        let whole = self.pax_key_len <= KEY_CAPACITY;
        let is = |name: &[u8]| whole && key == name;

        let value = if self.is_npm() && key.first().is_some_and(u8::is_ascii_uppercase) {
            Skip(Status::Ok)
        } else if let Some(sparse) = key.strip_prefix(b"GNU.sparse") {
            if sparse.is_empty() || (sparse.len() > 1 && sparse.first() == Some(&b'.')) {
                self.sparse_attributes_seen = true;
            }
            match sparse {
                _ if !whole => Skip(Status::Ok),
                b".numblocks" => {
                    self.sparse_offset = -1;
                    self.sparse_num_bytes = -1;
                    self.sparse_major = 0;
                    self.sparse_minor = 0;
                    Skip(Status::Ok)
                }
                b".offset" => number(Number::SparseOffset)?,
                b".numbytes" => number(Number::SparseNumBytes)?,
                b".size" => number(Number::SparseSize)?,
                b".map" => {
                    self.sparse_major = 0;
                    self.sparse_minor = 1;
                    if length > SPARSE_MAP_LIMIT {
                        Skip(Status::Failed)
                    } else {
                        Take(Collect::SparseMap)
                    }
                }
                b".major" => number(Number::SparseMajor)?,
                b".minor" => number(Number::SparseMinor)?,
                b".name" if length > PATHNAME_LIMIT => Skip(Status::Warn),
                b".name" => Take(Collect::Text(Text::PathOverride)),
                b".realsize" => number(Number::SparseRealSize)?,
                _ => Skip(Status::Ok),
            }
        } else if is(b"LIBARCHIVE.creationtime") || is(b"atime") || is(b"ctime") {
            time(false)?
        } else if is(b"LIBARCHIVE.symlinktype") {
            if length < SYMLINK_TYPE_LIMIT {
                Take(Collect::SymlinkType)
            } else {
                Skip(Status::Warn)
            }
        } else if (key.starts_with(LIBARCHIVE_XATTR) && self.pax_key_len > LIBARCHIVE_XATTR.len())
            || is(b"RHT.security.selinux")
        {
            warn_unless(length <= XATTR_LIMIT)
        } else if is(b"SCHILY.devmajor")
            || is(b"SCHILY.devminor")
            || is(b"SCHILY.dev")
            || is(b"SCHILY.ino")
            || is(b"SCHILY.nlink")
            || is(b"gid")
            || is(b"uid")
        {
            number(Number::Unused)?
        } else if is(b"SCHILY.fflags") {
            warn_unless(length < FFLAGS_LIMIT)
        } else if is(b"SCHILY.realsize") {
            number(Number::SchilyRealSize)?
        } else if key.starts_with(SCHILY_XATTR) && self.pax_key_len > SCHILY_XATTR.len() {
            let name_len = self.pax_key_len.saturating_sub(SCHILY_XATTR.len());
            warn_unless(length < XATTR_LIMIT && name_len <= XATTR_NAME_LIMIT)
        } else if is(b"SUN.holesdata") {
            if length < SPARSE_MAP_LIMIT {
                Take(Collect::HolesData)
            } else {
                Skip(Status::Failed)
            }
        } else if is(b"gname") || is(b"uname") {
            if length > USER_NAME_LIMIT {
                Skip(Status::Warn)
            } else if is(b"gname") {
                Take(Collect::Text(Text::GroupName))
            } else {
                Take(Collect::Text(Text::UserName))
            }
        } else if is(b"hdrcharset") {
            if length < CHARSET_LIMIT {
                Take(Collect::HeaderCharset)
            } else {
                Skip(Status::Warn)
            }
        } else if is(b"linkpath") || is(b"path") {
            if length > PATHNAME_LIMIT {
                Skip(Status::Warn)
            } else if is(b"path") {
                Take(Collect::Text(Text::Path))
            } else {
                Take(Collect::Text(Text::LinkPath))
            }
        } else if is(b"mtime") {
            time(true)?
        } else if is(b"size") {
            number(Number::Size)?
        } else {
            Skip(Status::Ok)
        };

        match value {
            Skip(status) => self.state = State::Skip(length, AfterSkip::PaxNewline(status)),
            Take(what) => {
                self.collected.clear();
                self.state = State::Collect(usize::try_from(length).unwrap_or(0), what);
            }
        }
        Ok(())
    }

    fn converts(&self, text: &[u8]) -> Result<bool> {
        let text = slice_to_nul(text);
        match self.options.charset {
            Charset::Ascii => Ok(text.is_ascii()),
            Charset::Utf8 => crate::compose::converts(text),
        }
    }

    fn finish_pax(&mut self) -> Result<()> {
        let mut status = self.pax_status;
        let utf8 = self.pax_is_utf8;

        let path = if self.pax_path_override.is_empty() {
            &self.pax_path
        } else {
            &self.pax_path_override
        };
        if !path.is_empty() {
            let converts = !utf8 || self.converts(path)?;
            assign(&mut self.entry.path, slice_to_nul(path))?;
            self.entry.path_is_utf8 = utf8 && converts;
            if !converts {
                status = Status::Warn;
            }
        }
        if utf8 && !(self.user_name_converts && self.group_name_converts) {
            status = Status::Warn;
        }
        if !self.pax_link.is_empty() {
            let converts = !utf8 || self.converts(&self.pax_link)?;
            assign(&mut self.entry.link, slice_to_nul(&self.pax_link))?;
            if !converts {
                status = Status::Warn;
            }
        }
        self.state = State::Skip(
            self.pax_left.saturating_add(self.pax_padding),
            AfterSkip::BetweenHeaders(status),
        );
        Ok(())
    }

    fn on_collected(&mut self, what: Collect) -> Result<()> {
        let collected = core::mem::take(&mut self.collected);
        let result = self.use_collected(what, &collected);
        self.collected = collected;
        result
    }

    fn use_collected(&mut self, what: Collect, value: &[u8]) -> Result<()> {
        let status = match what {
            Collect::LongName | Collect::LongLink => {
                if matches!(what, Collect::LongName) {
                    assign(&mut self.entry.path, slice_to_nul(value))?;
                    self.entry.path_is_utf8 = false;
                } else {
                    assign(&mut self.entry.link, slice_to_nul(value))?;
                }
                let padding = padding_for(i64::try_from(value.len()).unwrap_or(0));
                self.state = State::Skip(padding, AfterSkip::BetweenHeaders(Status::Ok));
                return Ok(());
            }
            Collect::Number(which) => {
                let parsed = parse_decimal(value);
                let valid = parsed >= 0 && parsed != i64::MAX;
                if valid {
                    self.on_pax_number(which, parsed)?;
                } else if matches!(which, Number::Size) {
                    return Err(Error::PaxSizeOverflow);
                }
                Status::warn_unless(valid)
            }
            Collect::Time(is_mtime) => {
                let seconds = parse_pax_time(value);
                if is_mtime && seconds.is_some() {
                    self.entry.mtime = seconds;
                }
                Status::warn_unless(seconds.is_some())
            }
            Collect::Text(which) => {
                match which {
                    Text::Path => assign(&mut self.pax_path, value)?,
                    Text::PathOverride => assign(&mut self.pax_path_override, value)?,
                    Text::LinkPath => assign(&mut self.pax_link, value)?,
                    Text::UserName => self.user_name_converts = self.converts(value)?,
                    Text::GroupName => self.group_name_converts = self.converts(value)?,
                }
                Status::Ok
            }
            Collect::HeaderCharset => {
                let utf8 = match value {
                    b"BINARY" => Some(false),
                    b"ISO-IR 10646 2000 UTF-8" => Some(true),
                    _ => None,
                };
                self.pax_is_utf8 = utf8.unwrap_or(self.pax_is_utf8);
                Status::warn_unless(utf8.is_some())
            }
            Collect::SymlinkType => Status::warn_unless(matches!(value, b"file" | b"dir")),
            Collect::SparseMap => Status::warn_unless(self.parse_sparse_map_0_1(value)?),
            Collect::HolesData => Status::warn_unless(self.parse_holes_data(value)?),
        };
        self.state = State::PaxNewline(status);
        Ok(())
    }

    fn on_pax_number(&mut self, which: Number, value: i64) -> Result<()> {
        match which {
            Number::SparseOffset => {
                self.sparse_offset = value;
                if self.sparse_num_bytes != -1 {
                    self.add_pending_sparse_block()?;
                }
            }
            Number::SparseNumBytes => {
                self.sparse_num_bytes = value;
                if self.sparse_offset != -1 {
                    self.add_pending_sparse_block()?;
                }
            }
            Number::SparseSize => {
                self.gnu_sparse_size = value;
                self.size_fields |= size_field::GNU_SPARSE_SIZE;
            }
            Number::SparseMajor if value <= SPARSE_VERSION_LIMIT => self.sparse_major = value,
            Number::SparseMinor if value <= SPARSE_VERSION_LIMIT => self.sparse_minor = value,
            Number::SparseMajor | Number::SparseMinor | Number::Unused => {}
            Number::SparseRealSize => {
                self.gnu_sparse_real_size = value;
                self.size_fields |= size_field::GNU_SPARSE_REALSIZE;
            }
            Number::SchilyRealSize => {
                self.schily_real_size = value;
                self.size_fields |= size_field::SCHILY_REALSIZE;
            }
            Number::Size => {
                self.pax_size = value;
                self.size_fields |= size_field::PAX_SIZE;
            }
        }
        Ok(())
    }

    fn add_pending_sparse_block(&mut self) -> Result<()> {
        if !self.add_sparse_block(self.sparse_offset, self.sparse_num_bytes, false)? {
            return Err(Error::MalformedSparseMap);
        }
        self.sparse_offset = -1;
        self.sparse_num_bytes = -1;
        Ok(())
    }

    /// `false` for a block that cannot be. An empty one takes its place, so the list is not empty.
    fn add_sparse_block(&mut self, offset: i64, remaining: i64, hole: bool) -> Result<bool> {
        self.sparse.try_reserve(1)?;
        let valid = remaining >= 0 && offset >= 0 && offset.checked_add(remaining).is_some();
        self.sparse.push(if valid {
            SparseBlock {
                offset,
                remaining,
                hole,
            }
        } else {
            SparseBlock {
                offset: 0,
                remaining: 0,
                hole: false,
            }
        });
        Ok(valid)
    }

    /// `offset,size,offset,size,...`
    fn parse_sparse_map_0_1(&mut self, map: &[u8]) -> Result<bool> {
        let mut offset: Option<i64> = None;
        for field in strings::split(map, b",") {
            if !field.iter().all(u8::is_ascii_digit) {
                return Ok(false);
            }
            let value = parse_decimal(field);
            match offset.take() {
                None => offset = Some(value),
                Some(offset) => {
                    if !self.add_sparse_block(offset, value, false)? {
                        return Ok(false);
                    }
                }
            }
        }
        Ok(true)
    }

    /// ` end end end ...`, where the ranges between the ends alternate between hole and data.
    fn parse_holes_data(&mut self, value: &[u8]) -> Result<bool> {
        let Some(mut rest) = value.strip_prefix(b" ") else {
            return Ok(false);
        };
        let mut end: i64 = 0;
        let mut hole = true;
        loop {
            let len = strings::index_of_char_usize(rest, b' ').unwrap_or(rest.len());
            let (field, tail) = rest.split_at(len);
            if !field.iter().all(u8::is_ascii_digit) {
                return Ok(false);
            }
            let start = end;
            end = parse_decimal(field);
            if start < end && !self.add_sparse_block(start, end.saturating_sub(start), hole)? {
                return Err(Error::MalformedSparseMap);
            }
            let Some(tail) = tail.strip_prefix(b" ") else {
                return Ok(true);
            };
            rest = tail;
            hole = !hole;
        }
    }

    fn add_old_sparse_entries(&mut self, entries: &[u8]) -> Result<()> {
        for entry in entries.as_chunks::<{ gnu::SPARSE_ENTRY_SIZE }>().0 {
            let (offset, num_bytes) = entry.split_at(gnu::SPARSE_NUMBER_SIZE);
            if offset.first() == Some(&0) {
                break;
            }
            if !self.add_sparse_block(parse_field(offset), parse_field(num_bytes), false)? {
                return Err(Error::MalformedSparseMap);
            }
        }
        Ok(())
    }

    fn on_main_header(&mut self, h: &Block) -> Result<()> {
        let magic = header::magic(h);
        let npm = self.is_npm();

        if magic == gnu::MAGIC {
            self.format = Format::Gnu;
            if self.entry.path.is_empty() {
                self.entry.path_is_utf8 = false;
                assign(&mut self.entry.path, slice_to_nul(header::name(h)))?;
            }
            if !npm {
                if gnu::real_size(h).first() != Some(&0) {
                    self.gnu_sparse_real_size = parse_field(gnu::real_size(h));
                    self.size_fields |= size_field::GNU_SPARSE_REALSIZE;
                }
                if gnu::sparse(h).first() != Some(&0) {
                    self.add_old_sparse_entries(gnu::sparse(h))?;
                    if gnu::is_extended(h) {
                        self.main_header = *h;
                        self.state = State::OldSparseExtension;
                        return Ok(());
                    }
                }
            }
        } else if magic.starts_with(b"ustar") && (!npm || magic == header::USTAR_MAGIC) {
            if self.format != Format::Pax {
                self.format = Format::Ustar;
            }
            if self.entry.path.is_empty() {
                self.entry.path_is_utf8 = false;
                let prefix = slice_to_nul(header::prefix(h));
                assign(&mut self.entry.path, prefix)?;
                if !prefix.is_empty() && prefix.last() != Some(&b'/') {
                    self.entry.path.write(b"/")?;
                }
                self.entry.path.write(slice_to_nul(header::name(h)))?;
            }
        } else {
            self.format = Format::Old;
            if self.entry.path.is_empty() {
                self.entry.path_is_utf8 = false;
                assign(&mut self.entry.path, slice_to_nul(header::name(h)))?;
            }
        }
        self.header_common(h)
    }

    fn header_common(&mut self, h: &Block) -> Result<()> {
        // Truncated the way a 32-bit `mode_t` is.
        self.entry.mode = header::mode(h) as u32;
        if self.entry.mtime.is_none() {
            self.entry.mtime = Some(header::mtime(h));
        }

        let header_size = header::size(h);
        let has = |field: u8| self.size_fields & field != 0;

        self.disk_size = if has(size_field::GNU_SPARSE_REALSIZE) {
            self.gnu_sparse_real_size
        } else if has(size_field::GNU_SPARSE_SIZE) && self.sparse_major == 0 {
            self.gnu_sparse_size
        } else if has(size_field::SCHILY_REALSIZE) {
            self.schily_real_size
        } else if has(size_field::PAX_SIZE) {
            self.pax_size
        } else {
            header_size
        };
        if self.disk_size < 0 {
            return Err(Error::NegativeFileSize);
        }
        if self.disk_size > ENTRY_LIMIT {
            return Err(Error::SizeOverflow);
        }
        self.entry.size = self.disk_size;

        self.bytes_remaining = if has(size_field::GNU_SPARSE_SIZE) && self.sparse_major == 1 {
            self.gnu_sparse_size
        } else if has(size_field::PAX_SIZE) {
            self.pax_size
        } else {
            header_size
        };
        if self.bytes_remaining < 0 {
            self.bytes_remaining = 0;
            return Err(Error::NegativeSize);
        }
        if self.bytes_remaining > ENTRY_LIMIT {
            self.bytes_remaining = 0;
            return Err(Error::SizeOverflow);
        }

        self.typeflag = header::typeflag(h);
        let mut no_body = |entry: &mut Entry, filetype: u32| {
            entry.set_filetype(filetype);
            entry.size = 0;
            self.bytes_remaining = 0;
        };
        match self.typeflag {
            b'1' => {
                if self.entry.size > 0 {
                    self.entry.set_filetype(S::IFREG);
                    // Only pax lets a hardlink carry a body, and a ustar header does not say whether it is pax.
                    let ignore_size = match self.format {
                        Format::Pax => false,
                        Format::Old | Format::Gnu => true,
                        Format::Ustar => header::has_magic(h) && header::is_plausible(h),
                    };
                    if ignore_size {
                        self.entry.size = 0;
                        self.bytes_remaining = 0;
                    }
                }
            }
            b'2' => {
                self.entry.is_symlink = true;
                if self.entry.link.is_empty() {
                    assign(&mut self.entry.link, slice_to_nul(header::linkname(h)))?;
                }
                no_body(&mut self.entry, S::IFLNK);
            }
            b'3' => no_body(&mut self.entry, S::IFCHR),
            b'4' => no_body(&mut self.entry, S::IFBLK),
            b'5' => no_body(&mut self.entry, S::IFDIR),
            b'6' => no_body(&mut self.entry, S::IFIFO),
            b'D' => self.entry.set_filetype(S::IFDIR),
            b'M' => {}
            _ => self.entry.set_filetype(S::IFREG),
        }
        self.padding = padding_for(self.bytes_remaining);
        self.after_main_header()
    }

    fn after_main_header(&mut self) -> Result<()> {
        if self.status == Status::Failed {
            return Err(Error::SparseMapTooLarge);
        }

        if self.options.mac_metadata
            && self.seen & seen::MAC_METADATA == 0
            && is_mac_metadata_name(&self.entry.path)
        {
            let size = self.entry.size;
            if size > XATTR_LIMIT {
                return Err(Error::OversizedMacMetadata);
            }
            self.state = State::Skip(
                size.saturating_add(padding_for(size)),
                AfterSkip::MacMetadata,
            );
            return Ok(());
        }

        if self.sparse_attributes_seen {
            if !matches!(self.typeflag, b'S' | b'0') {
                return self.finish_header(Status::Warn);
            }
            match (self.sparse_major, self.sparse_minor) {
                (0, 0 | 1) => {}
                (1, 0) => {
                    self.sparse.clear();
                    self.sparse_head = 0;
                    self.sparse_map_left = self.bytes_remaining;
                    self.line_len = 0;
                    self.state = State::SparseMapLine(SparseMapField::Count);
                    return Ok(());
                }
                _ => return self.finish_header(Status::Warn),
            }
        }
        self.finish_header(self.status)
    }

    /// Format 1.0: a count, then pairs of offset and size, each on a line, in front of the data.
    fn on_sparse_map_line(&mut self, field: SparseMapField) -> Result<()> {
        let line_buf = self.line;
        let line = line_buf.get(..self.line_len).unwrap_or_default();
        self.sparse_map_left = self
            .sparse_map_left
            .saturating_sub(i64::try_from(line.len()).unwrap_or(0));
        self.line_len = 0;
        if line.first() == Some(&b'#') {
            return Ok(());
        }
        let digits = line.strip_suffix(b"\n").unwrap_or(line);
        if !digits.iter().all(u8::is_ascii_digit) {
            return Err(Error::MalformedSparseMap);
        }
        let value = parse_decimal(digits);

        match field {
            SparseMapField::Count => self.sparse_map_entries = value,
            SparseMapField::Offset => {
                self.sparse_map_offset = value;
                self.state = State::SparseMapLine(SparseMapField::Size);
                return Ok(());
            }
            SparseMapField::Size => {
                if !self.add_sparse_block(self.sparse_map_offset, value, false)? {
                    return Err(Error::MalformedSparseMap);
                }
            }
        }
        if self.sparse_map_entries > 0 {
            self.sparse_map_entries = self.sparse_map_entries.saturating_sub(1);
            self.state = State::SparseMapLine(SparseMapField::Offset);
            return Ok(());
        }

        let read = self.bytes_remaining.saturating_sub(self.sparse_map_left);
        let to_skip = padding_for(read);
        if to_skip > self.sparse_map_left {
            return Err(Error::MalformedSparseMap);
        }
        self.bytes_remaining = self
            .bytes_remaining
            .saturating_sub(read.saturating_add(to_skip));
        self.state = State::Skip(to_skip, AfterSkip::SparseMap);
        Ok(())
    }

    fn finish_header(&mut self, status: Status) -> Result<()> {
        if self.sparse.is_empty() {
            self.add_sparse_block(0, self.bytes_remaining, false)?;
        }

        let plain_file = matches!(self.typeflag, b'0' | 0);
        let may_be_directory = if self.is_npm() {
            plain_file
        } else {
            status == Status::Ok
        };
        if may_be_directory
            && self.entry.filetype() == S::IFREG
            && self.entry.path.last() == Some(&b'/')
        {
            self.entry.set_filetype(S::IFDIR);
            self.bytes_remaining = 0;
            self.padding = 0;
        }

        if self.is_npm()
            && self.entry.filetype() == S::IFREG
            && (!(plain_file || self.typeflag == b'7') || strings::contains_char(&self.pax_path, 0))
        {
            self.entry.set_filetype(0);
        }

        self.state = State::Emit;
        Ok(())
    }
}

impl Entry {
    fn clear(&mut self) {
        self.path.clear();
        self.link.clear();
        *self = Entry {
            path: core::mem::take(&mut self.path),
            link: core::mem::take(&mut self.link),
            ..Entry::default()
        };
    }

    fn set_filetype(&mut self, filetype: u32) {
        self.mode = (self.mode & !S::IFMT) | filetype;
    }
}

/// The last component is `._` and at least one more character.
fn is_mac_metadata_name(path: &[u8]) -> bool {
    let mut name = path;
    let mut rest = path;
    while let Some(slash) = strings::index_of_char_usize(rest, b'/') {
        rest = rest.get(slash.saturating_add(1)..).unwrap_or_default();
        if !rest.is_empty() {
            name = rest;
        }
    }
    name.len() > 2 && name.starts_with(b"._")
}
